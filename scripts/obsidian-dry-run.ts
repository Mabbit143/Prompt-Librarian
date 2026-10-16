// Read-only: node --import tsx scripts/obsidian-dry-run.ts <vault-path> [--save-manifest]
// Writes nothing to the vault. The manifest (if saved) goes to ./.local-obsidian-manifest.json in this repo.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { scanVault, toImportItems, type Manifest } from "../src/import/obsidian/scan.js";
import { contentHash } from "../src/core/normalize.js";

const root = process.argv[2]!;
const MANIFEST = ".local-obsidian-manifest.json";
const prev: Manifest = existsSync(MANIFEST) ? JSON.parse(readFileSync(MANIFEST, "utf8")) : {};
const t0 = Date.now();
const res = await scanVault(root, prev);
const items = res.notes.flatMap((n) => toImportItems("mabbitopia", n));
const tally = (xs: string[]) => Object.fromEntries([...xs.reduce((m, x) => m.set(x, (m.get(x) ?? 0) + 1), new Map<string, number>())].sort((a, b) => b[1] - a[1]));
const hashes = items.map((i) => contentHash(i.content));
const sampleOf = (i: (typeof items)[number]) => `${i.recordType} | ${i.sourceLocator} | ${i.title.slice(0, 40)} | ${i.content.replace(/\s+/g, " ").slice(0, 70)}`;

console.log(JSON.stringify({
  notesFound: Object.keys(res.manifest).length, skipped: res.skipped,
  incremental: Object.keys(prev).length > 0, diff: { added: res.diff.added.length, changed: res.diff.changed.length, unchanged: res.diff.unchanged.length, removed: res.diff.removed.length, moved: res.diff.moved },
  notesParsed: res.notes.length,
  notesWithFrontmatter: res.notes.filter((n) => Object.keys(n.parsed.frontmatter).length).length,
  frontmatterParseErrors: res.notes.filter((n) => n.parsed.frontmatterError).map((n) => n.path),
  notesWithWikiLinks: res.notes.filter((n) => n.parsed.links.length).length,
  extractedItems: items.length, byRule: tally(items.map((i) => String(i.metadata.rule))), byType: tally(items.map((i) => i.recordType)),
  byTopFolder: tally(items.map((i) => String(i.metadata.path).split("/")[0]!)),
  uniqueContents: new Set(hashes).size, unqualifiedFencedBlocksSkipped: res.notes.reduce((t, n) => t + n.parsed.unqualifiedFences, 0),
  sample: items.slice(0, 12).map(sampleOf), seconds: (Date.now() - t0) / 1000,
}, null, 1));
if (process.argv.includes("--save-manifest")) writeFileSync(MANIFEST, JSON.stringify(res.manifest));
