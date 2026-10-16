import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import destinationsConfig from "../../config/notion-destinations.json";
import promptDashboardSnapshot from "../../config/notion-snapshots/prompt-engineering-dashboard.json";
import { buildPreview, type Preview } from "../notion/preview.js";
import { executeBatch, previewDigest, MemoryWriteLedger, type ExecResult, type NotionWriter } from "../notion/execute.js";
import type { Destination, ExistsAnswer, NotionIndex, SchemaSnapshot, SyncRecord } from "../notion/types.js";

export const SyncQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
  explore: z.enum(["0", "1", "true", "false"]).default("0").transform((v) => v === "1" || v === "true"),
}).strict();
export const DryRunBody = z.object({ limit: z.number().int().min(1).max(200).default(50), offset: z.number().int().min(0).max(100_000).default(0), explore: z.boolean().default(false) }).strict();

const must = <T>(r: { data: T; error: { message: string } | null }): T => { if (r.error) throw new Error(r.error.message); return r.data; };
const splitTags = (v: unknown) => (typeof v === "string" ? v.split(/[,;]/).map((t) => t.trim()).filter(Boolean) : []);

/** Newest filed records with everything the Notion layer needs. Read-only. */
export async function loadSyncRecords(db: SupabaseClient, limit: number, offset: number): Promise<SyncRecord[]> {
  const rows = must(await db.from("records")
    .select("id, original_title, suggested_title, original_content, content_hash, filing_status, record_type, metadata_json, categories(name), record_occurrences(external_record_id, source_path, source_url, sources(source_type))")
    .eq("filing_status", "filed").is("deleted_at", null)
    .order("created_at", { ascending: false }).order("id").range(offset, offset + limit - 1)) as any[];
  return rows.map((r): SyncRecord => {
    const m = (r.metadata_json ?? {}) as Record<string, any>;
    const c = m.classification ?? {};
    return {
      id: r.id, title: r.suggested_title ?? r.original_title ?? String(r.original_content).split("\n")[0].slice(0, 80),
      content: r.original_content, contentHash: r.content_hash, filingStatus: r.filing_status, recordType: r.record_type,
      category: r.categories?.name ?? null, subcategory: c.subcategory ?? m.Subcategory ?? null, outputType: c.output_type ?? m["Output Type"] ?? null,
      tags: [...(c.tags ?? []), ...splitTags(m.Tags)], topicTags: c.topic_tags ?? [],
      sources: (r.record_occurrences ?? []).map((o: any) => ({ sourceType: o.sources?.source_type ?? "unknown", externalId: o.external_record_id, path: o.source_path, url: o.source_url })),
    };
  });
}

// No live Notion lookup exists yet, so by default every duplicate check is honestly "unknown" and blocks the item.
const unknownIndex: NotionIndex = { lookup: (): ExistsAnswer => "unknown" };
const assumeAbsentIndex: NotionIndex = { lookup: (): ExistsAnswer => "absent" };

export interface SyncPreviewResult {
  mode: "strict" | "explore"; preview: Preview; digest: string; approvable: false; approvableReason: string;
  destination: { name: string; dataSourceId: string; confirmed: boolean; rowCount: number };
  schema: { fetchedAt: string; ageMinutes: number; properties: number };
  limit: number; offset: number; loaded: number;
}

/**
 * Read-only preview for the newest filed records. `explore` assumes Notion has no copy and ignores schema age so you can see
 * what the mapping would produce; it is never approvable. Strict mode reports the real blockers.
 */
export async function buildSyncPreview(db: SupabaseClient, q: { limit: number; offset: number; explore: boolean }, now = new Date()): Promise<SyncPreviewResult> {
  const records = await loadSyncRecords(db, q.limit, q.offset);
  const destinations = destinationsConfig.destinations as unknown as Destination[];
  const snapshot = { ...(promptDashboardSnapshot as unknown as SchemaSnapshot) };
  const preview = buildPreview(records, {
    destinations, snapshots: { prompt_library: snapshot }, index: q.explore ? assumeAbsentIndex : unknownIndex,
    libraryIdPrefix: destinationsConfig.libraryIdPrefix, now, maxSnapshotAgeMs: q.explore ? Number.MAX_SAFE_INTEGER : undefined,
  });
  const dest = destinations.find((d) => d.key === "prompt_library")!;
  return {
    mode: q.explore ? "explore" : "strict", preview, digest: previewDigest(preview), approvable: false,
    approvableReason: "No live Notion lookup or write adapter is connected, so no preview can be approved yet.",
    destination: { name: dest.name, dataSourceId: dest.dataSourceId, confirmed: dest.confirmed, rowCount: dest.rowCount },
    schema: { fetchedAt: snapshot.fetchedAt, ageMinutes: Math.round((now.getTime() - new Date(snapshot.fetchedAt).getTime()) / 60000), properties: Object.keys(snapshot.properties).length },
    limit: q.limit, offset: q.offset, loaded: records.length,
  };
}

const noWriter: NotionWriter = {
  createPage: async () => { throw new Error("no Notion writer is configured"); },
  fetchPage: async () => { throw new Error("no Notion writer is configured"); },
};

/** Always a dry run: the executor is given no approval, no kill-switch and a writer that throws if touched. */
export async function dryRun(db: SupabaseClient, q: { limit: number; offset: number; explore: boolean }): Promise<{ result: ExecResult; digest: string; mode: string }> {
  const p = await buildSyncPreview(db, q);
  const result = await executeBatch(p.preview, {
    writer: noWriter, index: unknownIndex, ledger: new MemoryWriteLedger(), destinations: destinationsConfig.destinations as unknown as Destination[],
    now: () => Date.now(), sleep: async () => {}, dryRun: true, writesEnabled: false,
  });
  return { result, digest: p.digest, mode: p.mode };
}
