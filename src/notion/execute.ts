import { createHash } from "node:crypto";
import type { Destination, DestKey, NotionIndex, PreviewItem } from "./types.js";
import { safeCreates, verifyReadBack, type Preview } from "./preview.js";

/** The only way this code touches Notion. A real adapter implements it; tests pass a fake. */
export interface NotionWriter {
  createPage(dataSourceId: string, properties: Record<string, unknown>): Promise<{ pageId: string; url?: string }>;
  fetchPage(pageId: string): Promise<{ properties: Record<string, unknown> }>;
}

/** Remembers what was already created, keyed by idempotency key, so a resumed batch never repeats a create. */
export interface WriteLedger {
  get(key: string): { pageId: string } | undefined;
  set(key: string, v: { pageId: string }): void;
}
export class MemoryWriteLedger implements WriteLedger {
  private m = new Map<string, { pageId: string }>();
  get(k: string) { return this.m.get(k); }
  set(k: string, v: { pageId: string }) { this.m.set(k, v); }
}

const stable = (v: unknown): string =>
  JSON.stringify(v, (_k, x) => (x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a.localeCompare(b))) : x));

/** Fingerprint of exactly what would be written. A human approval binds to this value, so any change invalidates it. */
export function previewDigest(p: Preview): string {
  const creates = safeCreates(p).map((i) => ({ r: i.recordId, d: i.destination, id: i.libraryId, k: i.idempotencyKey, p: i.properties }))
    .sort((a, b) => a.r.localeCompare(b.r));
  return createHash("sha256").update(stable(creates)).digest("hex");
}

export interface Approval { digest: string; approvedBy: string; approvedAt: string }

export function createRateLimiter(minIntervalMs: number, now: () => number, sleep: (ms: number) => Promise<void>) {
  let last = -Infinity;
  return async () => {
    const wait = last + minIntervalMs - now();
    if (wait > 0) await sleep(wait);
    last = now();
  };
}

export type ItemStatus = "created_verified" | "already_written" | "skipped_exists" | "failed" | "not_attempted";
export interface ItemResult { recordId: string; libraryId?: string; status: ItemStatus; pageId?: string; errors: string[] }
export interface ExecResult {
  mode: "dry_run" | "refused" | "live";
  refusal?: string;
  wouldCreate: number;
  items: ItemResult[];
  stoppedEarly: boolean;
}

export interface ExecDeps {
  writer: NotionWriter;
  index: NotionIndex;
  ledger: WriteLedger;
  destinations: Destination[];
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  /** Global kill switch. Writes are off unless the operator turns this on. */
  writesEnabled?: boolean;
  /** Dry run is the default; a live run needs dryRun:false, writesEnabled, and a matching approval. */
  dryRun?: boolean;
  approval?: Approval;
  maxBatch?: number;
  minIntervalMs?: number;
  maxPreviewAgeMs?: number;
}

export const HARD_MAX_BATCH = 50;

const refuse = (reason: string, wouldCreate: number): ExecResult => ({ mode: "refused", refusal: reason, wouldCreate, items: [], stoppedEarly: false });

/**
 * Applies the `create` items of an approved preview. Safety properties:
 * - dry run by default; no writer call happens unless every gate passes
 * - the approval must match the digest of exactly this preview, and the preview must be fresh
 * - small batches only; each create is preceded by a read-only existence check and followed by a read-back
 * - the first failure, unsure check, or mismatch stops the batch (no blind retries); a rerun resumes safely
 */
export async function executeBatch(preview: Preview, d: ExecDeps): Promise<ExecResult> {
  const creates = safeCreates(preview);
  const dry = d.dryRun ?? true;
  if (dry) {
    return { mode: "dry_run", wouldCreate: creates.length, stoppedEarly: false,
      items: creates.map((i) => ({ recordId: i.recordId, libraryId: i.libraryId, status: "not_attempted", errors: [] })) };
  }
  if (!d.writesEnabled) return refuse("writes are disabled (writesEnabled is off)", creates.length);
  if (creates.length === 0) return { mode: "live", wouldCreate: 0, items: [], stoppedEarly: false };
  if (!d.approval) return refuse("no approval for this preview", creates.length);
  if (d.approval.digest !== previewDigest(preview)) return refuse("approval does not match this preview; it changed after approval", creates.length);
  const cap = Math.min(d.maxBatch ?? 10, HARD_MAX_BATCH);
  if (creates.length > cap) return refuse(`batch of ${creates.length} exceeds the limit of ${cap}; approve a smaller preview`, creates.length);
  if (d.now() - new Date(preview.builtAt).getTime() > (d.maxPreviewAgeMs ?? 15 * 60 * 1000)) return refuse("preview is too old; rebuild it and approve again", creates.length);

  const dests = new Map<DestKey, Destination>(d.destinations.map((x) => [x.key, x]));
  for (const i of creates) {
    if (!i.destination || !dests.get(i.destination)?.confirmed) return refuse(`destination ${i.destination} is not confirmed`, creates.length);
  }

  const wait = createRateLimiter(d.minIntervalMs ?? 350, d.now, d.sleep);
  const results: ItemResult[] = [];
  let stopped = false;

  for (const item of creates) {
    const out = (status: ItemStatus, extra: Partial<ItemResult> = {}): ItemResult => ({ recordId: item.recordId, libraryId: item.libraryId, status, errors: [], ...extra });
    if (stopped) { results.push(out("not_attempted")); continue; }

    const done = d.ledger.get(item.idempotencyKey!);
    if (done) { results.push(out("already_written", { pageId: done.pageId })); continue; }

    const dest = dests.get(item.destination!)!;
    const seen = d.index.lookup(item.destination!, { libraryId: item.libraryId!, contentHash: item.contentHash! });
    if (seen === "exists") { results.push(out("skipped_exists")); continue; }
    if (seen === "unknown") { results.push(out("failed", { errors: ["existence check was unsure; not writing"] })); stopped = true; continue; }

    await wait();
    let page: { pageId: string };
    try {
      page = await d.writer.createPage(dest.dataSourceId, item.properties!);
    } catch (e) {
      // Unknown whether the page exists, so no retry here: a rerun's existence check will find it if it does.
      results.push(out("failed", { errors: [`create failed: ${e instanceof Error ? e.message : "unknown error"}`] }));
      stopped = true; continue;
    }
    d.ledger.set(item.idempotencyKey!, { pageId: page.pageId });

    let stored: { properties: Record<string, unknown> };
    try { stored = await d.writer.fetchPage(page.pageId); }
    catch (e) { results.push(out("failed", { pageId: page.pageId, errors: [`read-back failed: ${e instanceof Error ? e.message : "unknown error"}`] })); stopped = true; continue; }
    const mismatches = verifyReadBack(item as PreviewItem, stored.properties);
    if (mismatches.length) { results.push(out("failed", { pageId: page.pageId, errors: mismatches })); stopped = true; continue; }
    results.push(out("created_verified", { pageId: page.pageId }));
  }
  return { mode: "live", wouldCreate: creates.length, items: results, stoppedEarly: stopped };
}

/** After a live run, a fresh preview must propose no create for anything this run wrote. */
export function rerunCheck(result: ExecResult, rerun: Preview): { clean: boolean; offenders: string[] } {
  const written = new Set(result.items.filter((i) => i.status === "created_verified" || i.status === "already_written").map((i) => i.recordId));
  const offenders = rerun.items.filter((i) => i.action === "create" && written.has(i.recordId)).map((i) => i.recordId);
  return { clean: offenders.length === 0, offenders };
}
