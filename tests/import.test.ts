import { describe, it, expect } from "vitest";
import { parseCsv } from "../src/import/csv.js";
import { mapPromptLibraryRows } from "../src/import/promptLibrary.js";
import { runImport, MemoryLedger } from "../src/import/run.js";
import { MemoryRepo } from "../src/core/capture.js";

const H = ["Name", "Library ID", "Record Type", "Category", "Output Type", "Tags", "Prompt", "Prompt 2", "Source URL", "Source Locator"];
const sheet = [
  H,
  ["Event Template", "NTN-1", "Prompt", "Writing & Editing", "Template", "events", "Write an event blog post.", "", "https://n/1", "Numbered item 287"],
  ["Peer Review", "NTN-2", "Prompt", "Research", "Audit", "", "Act as a peer reviewer in [FIELD].", "Then list weaknesses.", "", ""],
  ["Blank", "NTN-3", "Prompt", "Research", "", "", "", "", "", ""],
  ["Copy of Event", "NTN-4", "Prompt", "Writing & Editing", "Template", "", "Write an event blog post.", "", "", ""],
];
const deps = (extra = {}) => {
  let n = 0;
  return { repo: new MemoryRepo(), ledger: new MemoryLedger(), sourceId: "sheet1", newId: () => `r${++n}`, now: () => "t", ...extra };
};

describe("csv", () => {
  it("handles quotes, commas and newlines in fields", () => {
    expect(parseCsv('a,b\r\n"x, ""y""","line1\nline2"\r\n')).toEqual([["a", "b"], ['x, "y"', "line1\nline2"]]);
  });
});

describe("mapping", () => {
  it("maps columns, joins prompt variants, skips empty prompts", () => {
    const { items, skipped } = mapPromptLibraryRows(sheet);
    expect(items).toHaveLength(3);
    expect(skipped).toEqual([{ row: 4, reason: "no prompt text" }]);
    expect(items[1]!.content).toBe("Act as a peer reviewer in [FIELD].\n\n---\n\nThen list weaknesses.");
    expect(items[0]).toMatchObject({ externalId: "NTN-1", category: "Writing & Editing", sourceLocator: "Prompt Library!2:2", sourceUrl: "https://n/1" });
  });
  it("never uses row number as identity", () => {
    const { items } = mapPromptLibraryRows([H, ["T", "", "Prompt", "", "", "", "Some prompt", "", "", ""]]);
    expect(items[0]!.externalId.startsWith("hash:")).toBe(true);
  });
});

describe("import", () => {
  const { items } = mapPromptLibraryRows(sheet);
  it("keeps the user's category, makes no duplicate for identical text", async () => {
    const d = deps();
    const s = await runImport(items, d);
    expect(s).toMatchObject({ added: 2, linkedDuplicates: 1, done: true });
    expect(d.repo.rows).toHaveLength(2);
    expect(d.repo.rows[0]).toMatchObject({ category: "Writing & Editing", filingStatus: "filed" });
    expect(d.repo.occurrences).toHaveLength(3);
  });
  it("repeat import adds nothing", async () => {
    const d = deps();
    await runImport(items, d);
    const again = await runImport(items, d);
    expect(again).toMatchObject({ added: 0, linkedDuplicates: 0, unchanged: 3 });
    expect(d.repo.rows).toHaveLength(2);
    expect(d.repo.occurrences).toHaveLength(3);
  });
  it("interrupted import resumes from checkpoint without duplicates", async () => {
    const d = deps({ batchSize: 1 });
    let stop = false;
    const first = await runImport(items, { ...d, shouldStop: () => (stop = true) });
    expect(first.done).toBe(false);
    const rest = await runImport(items, d, first.nextIndex);
    expect(rest.done).toBe(true);
    expect(d.repo.rows).toHaveLength(2);
    expect(d.repo.occurrences).toHaveLength(3);
    expect(stop).toBe(true);
  });
  it("changed source content is a conflict; original is not overwritten", async () => {
    const d = deps();
    await runImport(items, d);
    const changed = items.map((i) => (i.externalId === "NTN-1" ? { ...i, content: "Edited text" } : i));
    const s = await runImport(changed, d);
    expect(s.conflicts).toEqual([{ externalId: "NTN-1", recordId: "r1" }]);
    expect(d.repo.rows[0]!.originalContent).toBe("Write an event blog post.");
  });
});
