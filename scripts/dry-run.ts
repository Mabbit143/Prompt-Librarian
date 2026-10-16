// Read-only dry run: node --import tsx scripts/dry-run.ts <file.csv>. Imports into memory only.
import { readFileSync } from "node:fs";
import { parseCsv } from "../src/import/csv.js";
import { mapPromptLibraryRows } from "../src/import/promptLibrary.js";
import { runImport, MemoryLedger } from "../src/import/run.js";
import { MemoryRepo } from "../src/core/capture.js";
import { CATEGORIES } from "../src/core/taxonomy.js";

const t0 = Date.now();
const rows = parseCsv(readFileSync(process.argv[2]!, "utf8"));
const { items, skipped } = mapPromptLibraryRows(rows);
const repo = new MemoryRepo();
let n = 0;
const stats = await runImport(items, { repo, ledger: new MemoryLedger(), sourceId: "dry", newId: () => `r${++n}`, now: () => "t" });

const count = (xs: (string | undefined)[]) => {
  const m = new Map<string, number>();
  for (const x of xs) m.set(x ?? "(none)", (m.get(x ?? "(none)") ?? 0) + 1);
  return [...m].sort((a, b) => b[1] - a[1]);
};
const ids = count(items.map((i) => i.externalId)).filter(([, c]) => c > 1);
const cats = count(items.map((i) => i.category));
const prov = new Set<string>(CATEGORIES);
console.log(JSON.stringify({
  dataRows: rows.length - 1, mapped: items.length, skipped: skipped.length, skippedSample: skipped.slice(0, 5),
  recordsCreated: stats.added, linkedExactDuplicates: stats.linkedDuplicates, unchanged: stats.unchanged,
  conflictsSameIdDifferentText: stats.conflicts.length, repeatedLibraryIds: ids.length, repeatedIdSample: ids.slice(0, 5),
  recordTypes: count(items.map((i) => i.recordType)),
  distinctCategories: cats.length, categoriesInProvisionalTaxonomy: cats.filter(([c]) => prov.has(c)).length,
  topCategories: cats.slice(0, 40), noCategory: cats.find(([c]) => c === "(none)")?.[1] ?? 0,
  seconds: (Date.now() - t0) / 1000,
}, null, 1));
