import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";

const Status = z.enum(["inbox", "filed", "needs_review"]);
const page = {
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
};

export const SearchQuery = z.object({
  q: z.string().trim().min(1).max(200),
  category: z.string().trim().max(100).optional(),
  status: Status.optional(),
  ...page,
}).strict();

export const ListQuery = z.object({
  category: z.string().trim().max(100).optional(),
  status: Status.optional(),
  type: z.string().trim().max(60).optional(),
  sourceType: z.enum(["internal", "notion", "gsheets", "obsidian", "csv", "json", "markdown"]).optional(),
  sort: z.enum(["newest", "oldest"]).default("newest"),
  ...page,
}).strict();

export const IdParam = z.string().uuid();

export class NotFoundError extends Error {}
export class BadFilterError extends Error {}

export interface Provenance { sourceType: string | null; sourceName: string | null; externalId: string | null; path: string | null; url: string | null }
const prov = (o: any): Provenance => ({
  sourceType: o.sources?.source_type ?? null, sourceName: o.sources?.name ?? null,
  externalId: o.external_record_id ?? null, path: o.source_path ?? null, url: o.source_url ?? null,
});
const must = <T>(r: { data: T; error: { message: string } | null }): T => {
  if (r.error) throw new Error(r.error.message);
  return r.data;
};

async function categoryId(db: SupabaseClient, name?: string): Promise<string | null> {
  if (!name) return null;
  const rows = must(await db.from("categories").select("id").eq("name", name).limit(1));
  if (!rows?.length) throw new BadFilterError(`unknown category: ${name}`);
  return rows[0]!.id;
}

async function provenanceFor(db: SupabaseClient, ids: string[]): Promise<Map<string, Provenance[]>> {
  const out = new Map<string, Provenance[]>();
  if (!ids.length) return out;
  const rows = must(await db.from("record_occurrences")
    .select("record_id, external_record_id, source_path, source_url, sources(source_type,name)").in("record_id", ids));
  for (const o of rows as any[]) out.set(o.record_id, [...(out.get(o.record_id) ?? []), prov(o)]);
  return out;
}

export async function searchRecords(db: SupabaseClient, q: z.infer<typeof SearchQuery>) {
  const catId = await categoryId(db, q.category);
  const hits = must(await db.rpc("search_records", {
    p_query: q.q, p_category_id: catId, p_status: q.status ?? null, p_limit: q.limit + 1, p_offset: q.offset,
  })) as any[];
  const page = hits.slice(0, q.limit);
  const [prv, cats] = await Promise.all([
    provenanceFor(db, page.map((h) => h.id)),
    must(await db.from("categories").select("id,name")) as { id: string; name: string }[],
  ]);
  const catName = new Map(cats.map((c) => [c.id, c.name]));
  return {
    items: page.map((h) => ({
      id: h.id, title: h.title, category: h.category_id ? catName.get(h.category_id) ?? null : null,
      filingStatus: h.filing_status, rank: h.rank, snippet: h.snippet, sources: prv.get(h.id) ?? [],
    })),
    limit: q.limit, offset: q.offset, hasMore: hits.length > q.limit,
  };
}

export async function listRecords(db: SupabaseClient, q: z.infer<typeof ListQuery>) {
  const catId = await categoryId(db, q.category);
  let req = db.from("records")
    .select(`id, original_title, suggested_title, record_type, filing_status, created_at, categories(name), sources${q.sourceType ? "!inner" : ""}(source_type,name)`);
  if (catId) req = req.eq("primary_category_id", catId);
  if (q.status) req = req.eq("filing_status", q.status);
  if (q.type) req = req.eq("record_type", q.type);
  if (q.sourceType) req = req.eq("sources.source_type", q.sourceType);
  const rows = must(await req.is("deleted_at", null)
    .order("created_at", { ascending: q.sort === "oldest" }).order("id")
    .range(q.offset, q.offset + q.limit)) as any[];
  const page = rows.slice(0, q.limit);
  return {
    items: page.map((r) => ({
      id: r.id, title: r.suggested_title ?? r.original_title, recordType: r.record_type, category: r.categories?.name ?? null,
      filingStatus: r.filing_status, createdAt: r.created_at, firstSource: r.sources ? { type: r.sources.source_type, name: r.sources.name } : null,
    })),
    limit: q.limit, offset: q.offset, hasMore: rows.length > q.limit,
  };
}

export async function getRecord(db: SupabaseClient, id: string) {
  const r = must(await db.from("records").select("*, categories(name)").eq("id", id).is("deleted_at", null).maybeSingle()) as any;
  if (!r) throw new NotFoundError("record not found");
  const [occ, rels] = await Promise.all([
    must(await db.from("record_occurrences")
      .select("external_record_id, source_path, source_url, first_seen_at, last_seen_at, sources(source_type,name)")
      .eq("record_id", id).order("first_seen_at")) as any[],
    must(await db.from("record_relationships")
      .select("record_a_id, record_b_id, relationship_type, similarity_score, review_status")
      .or(`record_a_id.eq.${id},record_b_id.eq.${id}`).limit(50)) as any[],
  ]);
  const otherIds = [...new Set(rels.map((x) => (x.record_a_id === id ? x.record_b_id : x.record_a_id)))];
  const others = otherIds.length ? must(await db.from("records").select("id, original_title, suggested_title").in("id", otherIds)) as any[] : [];
  const title = new Map(others.map((o) => [o.id, o.suggested_title ?? o.original_title]));
  const { classification, reviewReason, ...metadata } = (r.metadata_json ?? {}) as Record<string, unknown>;
  return {
    id: r.id, title: r.suggested_title ?? r.original_title, originalTitle: r.original_title, originalContent: r.original_content,
    recordType: r.record_type, category: r.categories?.name ?? null, filingStatus: r.filing_status,
    classificationVersion: r.classification_version, classification: classification ?? null, reviewReason: reviewReason ?? null,
    metadata, createdAt: r.created_at, updatedAt: r.updated_at,
    occurrences: occ.map((o) => ({ ...prov(o), firstSeenAt: o.first_seen_at, lastSeenAt: o.last_seen_at })),
    relationships: rels.map((x) => {
      const other = x.record_a_id === id ? x.record_b_id : x.record_a_id;
      return { type: x.relationship_type, score: x.similarity_score, reviewStatus: x.review_status, otherId: other, otherTitle: title.get(other) ?? null };
    }),
  };
}
