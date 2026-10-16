import { readdir, readFile } from "node:fs/promises";
import { join, basename } from "node:path";
import { createHash } from "node:crypto";
import type { ImportItem } from "../promptLibrary.js";
import { parseNote, type ParsedNote } from "./parse.js";

export interface ManifestEntry { noteHash: string; size: number }
export type Manifest = Record<string, ManifestEntry>;
export interface Diff { added: string[]; changed: string[]; unchanged: string[]; removed: string[]; moved: { from: string; to: string }[] }
export interface ScannedNote { path: string; noteHash: string; parsed: ParsedNote }
export interface ScanResult { manifest: Manifest; notes: ScannedNote[]; diff: Diff; skipped: { path: string; reason: string }[] }

const MAX_BYTES = 5 * 1024 * 1024;
const SKIP_DIR = (n: string) => n.startsWith(".") || n === "node_modules";

/** Read-only recursive walk. Never follows symlinks; skips dot-folders (.obsidian, .git, .trash). */
export async function listMarkdown(root: string, rel = ""): Promise<string[]> {
  const out: string[] = [];
  for (const e of await readdir(join(root, rel), { withFileTypes: true })) {
    if (e.isSymbolicLink()) continue;
    const p = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) { if (!SKIP_DIR(e.name)) out.push(...(await listMarkdown(root, p))); }
    else if (e.isFile() && e.name.toLowerCase().endsWith(".md")) out.push(p);
  }
  return out;
}

export function diffManifest(prev: Manifest, curr: Manifest): Diff {
  const d: Diff = { added: [], changed: [], unchanged: [], removed: [], moved: [] };
  const gone = new Set(Object.keys(prev).filter((p) => !(p in curr)));
  const goneByHash = new Map<string, string[]>();
  for (const p of gone) goneByHash.set(prev[p]!.noteHash, [...(goneByHash.get(prev[p]!.noteHash) ?? []), p]);
  for (const [p, e] of Object.entries(curr)) {
    if (p in prev) (prev[p]!.noteHash === e.noteHash ? d.unchanged : d.changed).push(p);
    else {
      const from = goneByHash.get(e.noteHash)?.shift();
      if (from) { d.moved.push({ from, to: p }); gone.delete(from); } else d.added.push(p);
    }
  }
  d.removed = [...gone];
  return d;
}

/** Scans the vault. With a previous manifest, only added/changed/moved notes are parsed (incremental). */
export async function scanVault(root: string, prev: Manifest = {}): Promise<ScanResult> {
  const files = (await listMarkdown(root)).sort();
  const manifest: Manifest = {};
  const raws = new Map<string, string>();
  const skipped: ScanResult["skipped"] = [];
  for (const p of files) {
    const buf = await readFile(join(root, p));
    if (buf.length > MAX_BYTES) { skipped.push({ path: p, reason: "larger than 5 MB" }); continue; }
    const raw = buf.toString("utf8");
    manifest[p] = { noteHash: createHash("sha256").update(buf).digest("hex"), size: buf.length };
    raws.set(p, raw);
  }
  const diff = diffManifest(prev, manifest);
  // SKILL.md files are skill definitions, a separate asset class; they are indexed elsewhere, not mined for prompts.
  const toParse = new Set([...diff.added, ...diff.changed, ...diff.moved.map((m) => m.to)]);
  for (const p of [...toParse]) if (basename(p).toUpperCase() === "SKILL.MD") { toParse.delete(p); skipped.push({ path: p, reason: "skill definition" }); }
  const notes: ScannedNote[] = [];
  for (const p of toParse) notes.push({ path: p, noteHash: manifest[p]!.noteHash, parsed: parseNote(raws.get(p)!, basename(p, ".md")) });
  return { manifest, notes, diff, skipped };
}

/** Maps extracted blocks to the shared ImportItem shape. Identity = vault + path + content fingerprint, never a line number. */
export function toImportItems(vaultId: string, note: ScannedNote): ImportItem[] {
  return note.parsed.items.map((x) => ({
    externalId: `obsidian:${vaultId}:${note.path}#${x.anchor.fingerprint}`,
    title: x.title,
    content: x.content,
    recordType: x.recordType,
    sourceLocator: `${note.path}#L${x.anchor.startLine}-L${x.anchor.endLine}`,
    metadata: {
      vault: vaultId, path: note.path, noteHash: note.noteHash, rule: x.rule, anchor: x.anchor,
      links: x.links, noteLinks: note.parsed.links, frontmatter: note.parsed.frontmatter,
    },
  }));
}
