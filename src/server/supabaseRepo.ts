import type { SupabaseClient } from "@supabase/supabase-js";
import type { Occurrence, RecordRow, Relationship, Repo, ReviewProposal } from "../core/capture.js";
import { CATEGORIES } from "../core/taxonomy.js";

/** Supabase-backed Repo. Uses the caller's JWT client, so Row Level Security applies to every query. */
export class SupabaseRepo implements Repo {
  private constructor(
    private db: SupabaseClient, private ownerId: string, private sourceId: string,
    private catByName: Map<string, string>, private catById: Map<string, string>,
  ) {}

  /** Idempotent bootstrap: user row, the internal source, and the 19 categories. */
  static async init(db: SupabaseClient, ownerId: string): Promise<SupabaseRepo> {
    const ok = <T>(r: { data: T; error: { message: string } | null }): NonNullable<T> => {
      if (r.error || r.data === null) throw new Error(r.error?.message ?? "empty result");
      return r.data as NonNullable<T>;
    };
    ok(await db.from("users").upsert({ id: ownerId }, { onConflict: "id", ignoreDuplicates: true }).select());
    const src = ok(await db.from("sources").upsert(
      { owner_id: ownerId, source_type: "internal", external_id: "internal", name: "Quick Capture", connection_status: "connected" },
      { onConflict: "owner_id,source_type,external_id" }).select("id").single());
    ok(await db.from("categories").upsert(
      CATEGORIES.map((name) => ({ owner_id: ownerId, name })), { onConflict: "owner_id,name", ignoreDuplicates: true }).select());
    const cats = ok(await db.from("categories").select("id,name").eq("owner_id", ownerId));
    return new SupabaseRepo(db, ownerId, src.id,
      new Map(cats.map((c) => [c.name as string, c.id as string])), new Map(cats.map((c) => [c.id as string, c.name as string])));
  }

  private fromDb(r: any): RecordRow {
    return {
      id: r.id, originalTitle: r.original_title ?? undefined, originalContent: r.original_content, contentHash: r.content_hash,
      filingStatus: r.filing_status, category: r.primary_category_id ? this.catById.get(r.primary_category_id) : undefined,
      recordType: r.record_type ?? undefined, metadata: r.metadata_json ?? undefined,
    };
  }
  private throwIf(e: { message: string } | null) { if (e) throw new Error(e.message); }

  async findByHash(hash: string) {
    const { data, error } = await this.db.from("records").select("*")
      .eq("owner_id", this.ownerId).eq("content_hash", hash).is("canonical_record_id", null).is("deleted_at", null).maybeSingle();
    this.throwIf(error);
    return data ? this.fromDb(data) : undefined;
  }

  async insert(r: RecordRow) {
    const { error } = await this.db.from("records").insert({
      id: r.id, owner_id: this.ownerId, source_id: this.sourceId, original_title: r.originalTitle ?? null,
      original_content: r.originalContent, content_hash: r.contentHash, record_type: r.recordType ?? null,
      // Provisional display title until a classifier or the user supplies one.
      suggested_title: r.originalTitle ?? r.originalContent.trim().split(/\r?\n/)[0]!.slice(0, 80),
      filing_status: r.filingStatus, metadata_json: r.metadata ?? {},
    });
    this.throwIf(error);
  }

  async update(r: RecordRow) {
    const c = r.classification;
    const { error } = await this.db.from("records").update({
      ...(c ? { suggested_title: c.suggested_title } : {}), record_type: c?.record_type ?? r.recordType ?? null,
      primary_category_id: r.category ? this.catByName.get(r.category) ?? null : null,
      filing_status: r.filingStatus, classification_version: c?.classifier_version ?? null,
      metadata_json: { ...(r.metadata ?? {}), ...(c ? { classification: c } : {}), ...(r.reviewReason ? { reviewReason: r.reviewReason } : {}) },
      updated_at: new Date().toISOString(),
    }).eq("id", r.id);
    this.throwIf(error);
  }

  async addOccurrence(o: Occurrence) {
    const { error } = await this.db.from("record_occurrences").insert({
      record_id: o.recordId, source_id: this.sourceId, source_path: o.sourcePath ?? null,
      source_url: o.sourceUrl ?? null, first_seen_at: o.capturedAt, last_seen_at: o.capturedAt,
    });
    this.throwIf(error);
  }

  async addRelationship(r: Relationship) {
    const { error } = await this.db.from("record_relationships").upsert(
      { record_a_id: r.a, record_b_id: r.b, relationship_type: r.type, similarity_score: r.score, detection_method: "trigram+shingle" },
      { onConflict: "record_a_id,record_b_id,relationship_type", ignoreDuplicates: true });
    this.throwIf(error);
  }

  async addReview(p: ReviewProposal) {
    const { error } = await this.db.from("review_items").insert({
      record_id: p.recordId, proposal_type: p.proposalType, proposed_change_json: p.proposedChange ?? null,
      original_value_json: p.originalValue ?? null, confidence: p.confidence ?? null, reason: p.reason,
    });
    this.throwIf(error);
  }

  async candidates(text: string) {
    const { data, error } = await this.db.rpc("near_candidates", { p_text: text, p_limit: 20 });
    this.throwIf(error);
    return (data ?? []).map((r: any): RecordRow => ({
      id: r.id, originalContent: r.original_content, contentHash: "", filingStatus: "inbox",
    }));
  }
}
