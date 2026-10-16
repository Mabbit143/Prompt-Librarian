// node --import tsx scripts/obsidian-review.ts <vault> > docs/obsidian-extract-review.md   (read-only on the vault)
import { scanVault, toImportItems } from "../src/import/obsidian/scan.js";

const res = await scanVault(process.argv[2]!);
const items = res.notes.flatMap((n) => toImportItems("mabbitopia", n)).sort((a, b) => a.sourceLocator!.localeCompare(b.sourceLocator!));
const cell = (s: string) => s.replace(/\s+/g, " ").replace(/\|/g, "\\|").trim();
const out = [
  "# Obsidian extraction review",
  "",
  `${items.length} extracted items from ${Object.keys(res.manifest).length} notes. Mark the **Wrong?** column with \`x\` for false positives (not a prompt/idea worth filing), or add a note.`,
  "",
  "| # | Wrong? | Rule | Title | Location | First 100 characters |",
  "|---|---|---|---|---|---|",
  ...items.map((i, n) => `| ${n + 1} |  | ${i.metadata.rule} | ${cell(i.title).slice(0, 50)} | ${cell(i.sourceLocator!)} | ${cell(i.content).slice(0, 100)} |`),
];
console.log(out.join("\n"));
