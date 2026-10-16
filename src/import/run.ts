import { contentHash } from "../core/normalize.js";
import type { Repo } from "../core/capture.js";
import type { ImportItem } from "./promptLibrary.js";

/** Remembers what each source id has already imported, so reruns and resumes are idempotent. */
export interface Ledger {
  get(sourceId: string, externalId: string): Promise<{ recordId: string; hash: string } | undefined>;
  set(sourceId: string, externalId: string, v: { recordId: string; hash: string }): Promise<void>;
}
export class MemoryLedger implements Ledger {
  m = new Map<string, { recordId: string; hash: string }>();
  async get(s: string, e: string) { return this.m.get(`${s}\u0000${e}`); }
  async set(s: string, e: string, v: { recordId: string; hash: string }) { this.m.set(`${s}\u0000${e}`, v); }
}

export interface ImportStats { added: number; linkedDuplicates: number; unchanged: number; conflicts: { externalId: string; recordId: string }[]; nextIndex: number; done: boolean }
export interface ImportDeps { repo: Repo; ledger: Ledger; sourceId: string; newId: () => string; now: () => string; batchSize?: number; shouldStop?: () => boolean }

/**
 * Imports items starting at `startIndex` (the checkpoint). Read-only toward the source, no AI calls.
 * - same id + same content: skipped
 * - same id + changed content: original kept, conflict recorded (never overwritten)
 * - new id with content already known: occurrence added to the existing record (no duplicate)
 */
export async function runImport(items: ImportItem[], d: ImportDeps, startIndex = 0): Promise<ImportStats> {
  const st: ImportStats = { added: 0, linkedDuplicates: 0, unchanged: 0, conflicts: [], nextIndex: startIndex, done: false };
  const batch = d.batchSize ?? 500;
  for (let i = startIndex; i < items.length; i++) {
    if (i > startIndex && (i - startIndex) % batch === 0 && d.shouldStop?.()) return st;
    const it = items[i]!;
    const hash = contentHash(it.content);
    const seen = await d.ledger.get(d.sourceId, it.externalId);
    if (seen) {
      if (seen.hash === hash) st.unchanged++;
      else st.conflicts.push({ externalId: it.externalId, recordId: seen.recordId });
    } else {
      const occ = { externalId: it.externalId, sourcePath: it.sourceLocator, sourceUrl: it.sourceUrl, capturedAt: d.now() };
      const existing = await d.repo.findByHash(hash);
      if (existing) {
        await d.repo.addOccurrence({ recordId: existing.id, ...occ });
        await d.ledger.set(d.sourceId, it.externalId, { recordId: existing.id, hash });
        st.linkedDuplicates++;
      } else {
        const id = d.newId();
        await d.repo.insert({
          id, originalTitle: it.title, originalContent: it.content, contentHash: hash,
          // Already categorized by the user; keep their label and mark filed without any model call.
          filingStatus: it.category ? "filed" : "inbox", category: it.category,
          recordType: it.recordType, metadata: { ...it.metadata, externalId: it.externalId, sourceId: d.sourceId },
        });
        await d.repo.addOccurrence({ recordId: id, ...occ });
        await d.ledger.set(d.sourceId, it.externalId, { recordId: id, hash });
        st.added++;
      }
    }
    st.nextIndex = i + 1;
  }
  st.done = true;
  return st;
}
