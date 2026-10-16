import { contentHash } from "../core/normalize.js";

/** One normalized row from the user's "Prompt Library" sheet (tab "Prompt Library", 33 columns). */
export interface ImportItem {
  externalId: string;          // Library ID (e.g. NTN-004486); falls back to a content hash, never a row number
  title: string;
  content: string;             // Prompt, plus Prompt 2..6 variants appended in order
  recordType: string;
  category?: string;           // the user's existing category, kept verbatim (not forced into the provisional taxonomy)
  sourceUrl?: string;
  sourceLocator?: string;      // sheet position, e.g. "Prompt Library!2:2"
  metadata: Record<string, unknown>;
}

const col = (h: string[], name: string) => h.findIndex((x) => x.trim().toLowerCase() === name.toLowerCase());

export function mapPromptLibraryRows(values: string[][], tab = "Prompt Library"): { items: ImportItem[]; skipped: { row: number; reason: string }[] } {
  const [header, ...rows] = values;
  if (!header) return { items: [], skipped: [] };
  const idx = (n: string) => col(header, n);
  const get = (r: string[], n: string) => (idx(n) >= 0 ? (r[idx(n)] ?? "").trim() : "");
  const items: ImportItem[] = [];
  const skipped: { row: number; reason: string }[] = [];

  rows.forEach((r, i) => {
    const sheetRow = i + 2;
    const variants = ["Prompt", "Prompt 2", "Prompt 3", "Prompt 4", "Prompt 5", "Prompt 6"].map((n) => get(r, n)).filter(Boolean);
    if (variants.length === 0) { skipped.push({ row: sheetRow, reason: "no prompt text" }); return; }
    const content = variants.join("\n\n---\n\n");
    const libId = get(r, "Library ID");
    const meta: Record<string, unknown> = {};
    for (const n of ["Subcategory", "Task", "Output Type", "Purpose", "Tags", "Channels", "Tools", "Inputs", "Required Context", "Use Status", "Review", "Source IDs", "Original Name", "Original Category", "Occurrence Count", "Notes", "Questions", "Instructions", "Instructions 2", "Instructions 3"]) {
      const v = get(r, n);
      if (v) meta[n] = v;
    }
    items.push({
      externalId: libId || `hash:${contentHash(content)}`,
      title: get(r, "Name"),
      content,
      recordType: get(r, "Record Type") || "Prompt",
      category: get(r, "Category") || undefined,
      sourceUrl: get(r, "Source URL") || undefined,
      sourceLocator: `${tab}!${sheetRow}:${sheetRow}`,
      metadata: meta,
    });
  });
  return { items, skipped };
}
