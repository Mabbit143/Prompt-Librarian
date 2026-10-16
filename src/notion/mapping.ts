import type { SchemaSnapshot, SyncRecord, Warning } from "./types.js";

// Notion limits one rich-text object to 2000 characters; the Prompt Engineering Dashboard holds longer prompts in Prompt..Prompt 6.
export const CHUNK = 2000;
const PROMPT_PROPS = ["Prompt", "Prompt 2", "Prompt 3", "Prompt 4", "Prompt 5", "Prompt 6"];
export const MAX_CHARS = CHUNK * PROMPT_PROPS.length;

// Our record types vs the dashboard's Record Type options. A Template is stored as a Prompt with Output Type "Template".
const RECORD_TYPE_MAP: Record<string, string> = {
  Prompt: "Prompt", Template: "Prompt", Workflow: "Workflow", "Prompt bundle": "Prompt bundle",
  "Prompt fragment": "Prompt fragment", Idea: "Idea", Reference: "Reference",
};

export const libraryIdFor = (recordId: string, prefix: string) => `${prefix}${recordId.replace(/-/g, "").slice(0, 10).toUpperCase()}`;

const text = (content: string) => [{ text: { content } }];
export const chunk = (s: string): string[] => Array.from({ length: Math.ceil(s.length / CHUNK) }, (_, i) => s.slice(i * CHUNK, (i + 1) * CHUNK));

export interface Mapped { properties: Record<string, unknown>; warnings: Warning[]; blocked?: string }

/**
 * Builds the property payload for the Prompt Engineering Dashboard, validated against the live schema snapshot.
 * Unknown select values are never auto-created: blocked for required ones (Category, Record Type), omitted with a warning otherwise.
 */
export function mapToPromptLibrary(r: SyncRecord, snap: SchemaSnapshot, libraryId: string): Mapped {
  const warnings: Warning[] = [];
  const props: Record<string, unknown> = {};
  const opts = (name: string) => snap.properties[name]?.options ?? [];
  const missing = ["Prompt Name", "Library ID", "Prompt", "Category", "Record Type"].filter((p) => !snap.properties[p]);
  if (missing.length) return { properties: {}, warnings, blocked: `schema is missing expected properties: ${missing.join(", ")}` };

  if (r.content.length > MAX_CHARS) return { properties: {}, warnings, blocked: `content is ${r.content.length} characters; the dashboard holds at most ${MAX_CHARS} in Prompt..Prompt 6` };
  const type = r.recordType ? RECORD_TYPE_MAP[r.recordType] : undefined;
  if (!type || !opts("Record Type").includes(type)) return { properties: {}, warnings, blocked: `record type ${r.recordType} has no matching Record Type option` };
  if (!r.category || !opts("Category").includes(r.category)) return { properties: {}, warnings, blocked: `category ${r.category} is not an option in Notion; choose an existing one` };

  props["Prompt Name"] = { title: text(r.title.slice(0, 200)) };
  props["Library ID"] = { rich_text: text(libraryId) };
  props["Record Type"] = { select: { name: type } };
  props["Category"] = { select: { name: r.category } };
  chunk(r.content).forEach((c, i) => { props[PROMPT_PROPS[i]!] = { rich_text: text(c) }; });

  const optional = (prop: string, value: string | null, label: string) => {
    if (!value) return;
    if (opts(prop).includes(value)) props[prop] = { select: { name: value } };
    else warnings.push({ code: "value_not_in_options", message: `${label} "${value}" is not an option in Notion; left empty` });
  };
  optional("Subcategory", r.subcategory, "Subcategory");
  optional("Output Type", r.recordType === "Template" ? "Template" : r.outputType, "Output Type");

  const knownTags = new Set(opts("Tags"));
  const tags = [...new Set(r.tags.map((t) => t.toLowerCase()))];
  const keep = tags.filter((t) => knownTags.has(t));
  if (keep.length) props["Tags"] = { multi_select: keep.map((name) => ({ name })) };
  const dropped = tags.filter((t) => !knownTags.has(t));
  if (dropped.length) warnings.push({ code: "tags_not_in_options", message: `tags not in Notion, left out rather than creating options: ${dropped.join(", ")}` });

  const ids = r.sources.map((s) => s.externalId).filter(Boolean) as string[];
  if (ids.length) props["Source IDs"] = { rich_text: text(ids.join("; ").slice(0, CHUNK)) };
  const path = r.sources.find((s) => s.path)?.path;
  if (path) props["Source Locator"] = { rich_text: text(path.slice(0, CHUNK)) };
  const url = r.sources.find((s) => s.url && /^https?:\/\//.test(s.url))?.url;
  if (url) props["Source URL"] = { url };
  props["Occurrence Count"] = { number: Math.max(1, r.sources.length) };
  if (opts("Use Status").includes("To try")) props["Use Status"] = { select: { name: "To try" } };
  if (opts("Review").includes("Ready")) props["Review"] = { select: { name: "Ready" } };
  return { properties: props, warnings };
}

/** Plain-text view of a stored property for read-back comparison. */
export function plain(v: any): string {
  if (v == null) return "";
  if (v.title || v.rich_text) return (v.title ?? v.rich_text).map((t: any) => t.text?.content ?? t.plain_text ?? "").join("");
  if (v.select) return v.select.name ?? "";
  if (v.multi_select) return v.multi_select.map((o: any) => o.name).sort().join(",");
  if (v.url !== undefined) return v.url ?? "";
  if (v.number !== undefined) return String(v.number);
  return "";
}
