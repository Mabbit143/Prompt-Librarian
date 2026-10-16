import { mkdtempSync, mkdirSync, writeFileSync, renameSync, readFileSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import { parseNote } from "../src/import/obsidian/parse.js";
import { scanVault, toImportItems, diffManifest } from "../src/import/obsidian/scan.js";
import { runImport, MemoryLedger } from "../src/import/run.js";
import { MemoryRepo } from "../src/core/capture.js";

const PROMPT = "Act as a careful peer reviewer. Read the attached paper and list its methodological weaknesses, then rank them by severity and suggest one fix for each.";
const note = (extra = "") => `---\ntype: note\n---\n# Research\n\n## Prompts\n\nCopy this:\n\n\`\`\`\n${PROMPT}\n\`\`\`\n${extra}`;

describe("parseNote", () => {
  it("extracts a fenced prompt under a Prompt heading with anchor and links", () => {
    const p = parseNote(note(), "Research");
    expect(p.items).toHaveLength(1);
    expect(p.items[0]).toMatchObject({ rule: "fenced-in-prompt-context", recordType: "Prompt", content: PROMPT, title: "Prompts" });
    expect(p.items[0]!.anchor).toMatchObject({ heading: "Research > Prompts", startLine: 10 });
  });
  it("fingerprint is stable when lines are inserted above", () => {
    const a = parseNote(note(), "n").items[0]!.anchor;
    const b = parseNote("Intro line\n\nAnother\n" + note(), "n").items[0]!.anchor;
    expect(b.fingerprint).toBe(a.fingerprint);
    expect(b.startLine).toBeGreaterThan(a.startLine);
  });
  it("ignores dataview, short, checklist and unlabeled fenced blocks", () => {
    const md = "# Prompts\n\n```dataview\nTABLE file.name FROM \"x\" WHERE something is true and more words here to be long enough for sure yes\n```\n\n```\nshort\n```\n\n```\n- [ ] Task one with enough words to pass length checks if it were a prompt, due date and course name\n  - Course:\n```\n\n# Misc\n\n```\n" + PROMPT + "\n```\n";
    const p = parseNote(md, "n");
    expect(p.items).toHaveLength(0);
    expect(p.unqualifiedFences).toBe(1);
  });
  it("extracts idea and prompt callouts", () => {
    const p = parseNote("> [!idea] Podcast angle\n> Interview first-gen students about how advisors describe office hours.\n\n> [!prompt]\n> " + PROMPT + "\n", "n");
    expect(p.items.map((i) => [i.rule, i.recordType, i.title])).toEqual([["callout-idea", "Idea", "Podcast angle"], ["callout-prompt", "Prompt", "n"]]);
  });
  it("treats a note typed prompt as one record, and tolerates bad frontmatter", () => {
    const p = parseNote(`---\ntype: prompt\n---\n${PROMPT}\n`, "Reviewer");
    expect(p.items).toMatchObject([{ rule: "frontmatter-type", title: "Reviewer" }]);
    const bad = parseNote("---\nfoo: [unclosed\n---\n# Prompts\n```\n" + PROMPT + "\n```\n", "n");
    expect(bad.frontmatterError).toBe(true);
    expect(bad.items).toHaveLength(1);
  });
  it("collects wiki links without aliases and headings", () => {
    expect(parseNote("See [[Alpha|a]] and [[Beta#Sec]] and [[Alpha]]", "n").links).toEqual(["Alpha", "Beta"]);
  });
});

describe("vault scan", () => {
  const vault = () => {
    const root = mkdtempSync(join(tmpdir(), "vault-"));
    mkdirSync(join(root, "A"));
    mkdirSync(join(root, ".obsidian"));
    writeFileSync(join(root, "A", "one.md"), note());
    writeFileSync(join(root, "A", "SKILL.md"), note());
    writeFileSync(join(root, ".obsidian", "hidden.md"), note());
    writeFileSync(join(root, "plain.md"), "# Nothing here\n");
    return root;
  };
  const snapshot = (root: string): string[] => readdirSync(root, { recursive: true, withFileTypes: false }).map(String).sort().map((p) => `${p}:${statSync(join(root, p)).isFile() ? readFileSync(join(root, p), "utf8").length : "d"}`);

  it("skips dot-folders and skill files, and never modifies the vault", async () => {
    const root = vault();
    const before = snapshot(root);
    const r = await scanVault(root);
    expect(Object.keys(r.manifest).sort()).toEqual(["A/SKILL.md", "A/one.md", "plain.md"]);
    expect(r.skipped).toEqual([{ path: "A/SKILL.md", reason: "skill definition" }]);
    expect(r.notes.flatMap((n) => toImportItems("v", n))).toHaveLength(1);
    expect(snapshot(root)).toEqual(before);
  });

  it("incremental rescan parses nothing when unchanged, and detects moves", async () => {
    const root = vault();
    const first = await scanVault(root);
    const again = await scanVault(root, first.manifest);
    expect(again.notes).toHaveLength(0);
    expect(again.diff.unchanged).toHaveLength(3);
    renameSync(join(root, "A", "one.md"), join(root, "A", "renamed.md"));
    const moved = await scanVault(root, first.manifest);
    expect(moved.diff.moved).toEqual([{ from: "A/one.md", to: "A/renamed.md" }]);
    expect(moved.diff.added).toHaveLength(0);
    expect(moved.diff.removed).toHaveLength(0);
  });

  it("diffManifest reports changed, added and removed", () => {
    const d = diffManifest({ a: { noteHash: "1", size: 1 }, b: { noteHash: "2", size: 1 } }, { a: { noteHash: "9", size: 1 }, c: { noteHash: "3", size: 1 } });
    expect(d).toMatchObject({ changed: ["a"], added: ["c"], removed: ["b"], moved: [] });
  });

  it("a moved note adds an occurrence instead of a duplicate record; reimport is a no-op", async () => {
    const root = vault();
    const first = await scanVault(root);
    const deps = { repo: new MemoryRepo(), ledger: new MemoryLedger(), sourceId: "vault", newId: (() => { let n = 0; return () => `r${++n}`; })(), now: () => "t" };
    await runImport(first.notes.flatMap((n) => toImportItems("v", n)), deps);
    renameSync(join(root, "A", "one.md"), join(root, "A", "renamed.md"));
    const moved = await scanVault(root, first.manifest);
    const s = await runImport(moved.notes.flatMap((n) => toImportItems("v", n)), deps);
    expect(s).toMatchObject({ added: 0, linkedDuplicates: 1 });
    expect(deps.repo.rows).toHaveLength(1);
    expect(deps.repo.occurrences.map((o) => o.sourcePath?.split("#")[0])).toEqual(["A/one.md", "A/renamed.md"]);
    const again = await runImport(moved.notes.flatMap((n) => toImportItems("v", n)), deps);
    expect(again).toMatchObject({ added: 0, linkedDuplicates: 0, unchanged: 1 });
  });
});

describe("scaffolding filters", () => {
  it("skips Templater templates and folder-tree blocks", () => {
    const tpl = parseNote("---\ntype: prompt\n---\n# <% tp.file.title %>\n\n## Prompt\n\nPlaceholder text that is long enough to pass the length check for notes.\n", "Prompt");
    expect(tpl.items).toHaveLength(0);
    const tree = "# Prompts\n\n```\nMabbitopia/\n├── RookeryBrain/ with a long enough listing of folders and files to count as words here\n└── Another folder name and more words so this is clearly longer than eighty characters\n```\n";
    expect(parseNote(tree, "n").items).toHaveLength(0);
  });
});

describe("ignore list", () => {
  it("matches exact paths and wildcards, and ignored notes are skipped but still tracked", async () => {
    const { isIgnored } = await import("../src/import/obsidian/scan.js");
    expect(isIgnored("A/b.md", ["A/b.md"])).toBe(true);
    expect(isIgnored("A/b.md", ["A/c.md"])).toBe(false);
    expect(isIgnored("A/x/y.md", ["A/*.md"])).toBe(false);
    expect(isIgnored("A/x/y.md", ["A/**"])).toBe(true);
    expect(isIgnored("Axb.md", ["A.b.md"])).toBe(false);
    const root = mkdtempSync(join(tmpdir(), "vault-"));
    writeFileSync(join(root, "keep.md"), note());
    writeFileSync(join(root, "skip.md"), note());
    const r = await scanVault(root, {}, { ignore: ["skip.md"] });
    expect(Object.keys(r.manifest).sort()).toEqual(["keep.md", "skip.md"]);
    expect(r.notes.map((n) => n.path)).toEqual(["keep.md"]);
    expect(r.skipped).toEqual([{ path: "skip.md", reason: "ignored by config" }]);
  });
});
