import type { SupabaseClient } from "@supabase/supabase-js";
import { MemoryLedger } from "../import/run.js";

/** Rebuilds the import ledger for one source from stored occurrences, so reruns skip what is already imported. */
export async function loadLedger(db: SupabaseClient, sourceId: string): Promise<MemoryLedger> {
  const ledger = new MemoryLedger();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from("record_occurrences").select("external_record_id, record_id, records(content_hash)")
      .eq("source_id", sourceId).not("external_record_id", "is", null).range(from, from + 999);
    if (error) throw new Error(error.message);
    for (const r of data as any[]) await ledger.set(sourceId, r.external_record_id, { recordId: r.record_id, hash: r.records.content_hash });
    if (data.length < 1000) break;
  }
  return ledger;
}
