import type { SupabaseClient } from "@supabase/supabase-js";
import type { Occurrence, RecordRow, Relationship, Repo } from "../core/capture.js";

/**
 * Repo for large imports: buffers inserts and writes them in batches (records first, then occurrences).
 * Exact-duplicate lookups use a preloaded hash set plus the buffer. Call flush() when done.
 * Near-duplicate detection is intentionally off for bulk loads (candidates() is empty).
 */
export class BulkSupabaseRepo implements Repo {
  private rows: RecordRow[] = [];
  private occ: Occurrence[] = [];
  private known = new Map<string, RecordRow>();
  constructor(private db: SupabaseClient, private ownerId: string, private sourceId: string,
    private catByName: Map<string, string>, private batch = 200) {}

  async preload() {
    for (let from = 0; ; from += 1000) {
      const { data, error } = await this.db.from("records").select("id,content_hash").eq("owner_id", this.ownerId).is("deleted_at", null).range(from, from + 999);
      if (error) throw new Error(error.message);
      for (const r of data) this.known.set(r.content_hash, { id: r.id, originalContent: "", contentHash: r.content_hash, filingStatus: "filed" });
      if (data.length < 1000) break;
    }
  }
  async findByHash(h: string) { return this.known.get(h); }
  async insert(r: RecordRow) { this.known.set(r.contentHash, r); this.rows.push(r); if (this.rows.length >= this.batch) await this.flush(); }
  async update(): Promise<void> { throw new Error("bulk repo does not update"); }
  async addOccurrence(o: Occurrence) { this.occ.push(o); }
  async addRelationship(_r: Relationship) {}
  async candidates() { return []; }

  async flush() {
    if (this.rows.length) {
      const { error } = await this.db.from("records").insert(this.rows.map((r) => ({
        id: r.id, owner_id: this.ownerId, source_id: this.sourceId, original_title: r.originalTitle ?? null,
        original_content: r.originalContent, content_hash: r.contentHash, record_type: r.recordType ?? null,
        primary_category_id: r.category ? this.catByName.get(r.category) ?? null : null,
        filing_status: r.filingStatus, metadata_json: r.metadata ?? {},
      })));
      if (error) throw new Error(`records insert: ${error.message}`);
      this.rows = [];
    }
    if (this.occ.length) {
      const { error } = await this.db.from("record_occurrences").insert(this.occ.map((o) => ({
        record_id: o.recordId, source_id: this.sourceId, source_path: o.sourcePath ?? null, source_url: o.sourceUrl ?? null,
        first_seen_at: o.capturedAt, last_seen_at: o.capturedAt,
      })));
      if (error) throw new Error(`occurrences insert: ${error.message}`);
      this.occ = [];
    }
  }
}
