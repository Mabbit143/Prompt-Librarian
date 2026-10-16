import { contentHash, normalizeContent, similarity } from "./normalize.js";
import { applyRules } from "./rules.js";
import { classifyWithRetry, type ModelCall } from "./classify.js";
import type { BudgetPort } from "./budget.js";
import type { Classification } from "./taxonomy.js";

export type FilingStatus = "filed" | "needs_review" | "inbox";
export interface RecordRow {
  id: string; originalTitle?: string; originalContent: string; contentHash: string;
  filingStatus: FilingStatus; classification?: Classification; category?: string; reviewReason?: string;
  recordType?: string; metadata?: Record<string, unknown>;
}
export interface Occurrence { recordId: string; sourcePath?: string; sourceUrl?: string; capturedAt: string }
export interface Relationship { a: string; b: string; type: "exact_duplicate" | "near_duplicate"; score: number }

/** Storage port. The Supabase implementation lives behind this; tests use the in-memory one. */
export interface Repo {
  findByHash(hash: string): Promise<RecordRow | undefined>;
  insert(row: RecordRow): Promise<void>;
  update(row: RecordRow): Promise<void>;
  addOccurrence(o: Occurrence): Promise<void>;
  addRelationship(r: Relationship): Promise<void>;
  candidates(text: string): Promise<RecordRow[]>;
}

export class MemoryRepo implements Repo {
  rows: RecordRow[] = []; occurrences: Occurrence[] = []; relationships: Relationship[] = [];
  async findByHash(h: string) { return this.rows.find((r) => r.contentHash === h); }
  async insert(r: RecordRow) { this.rows.push({ ...r }); }
  async update(r: RecordRow) { const i = this.rows.findIndex((x) => x.id === r.id); this.rows[i] = { ...r }; }
  async addOccurrence(o: Occurrence) { this.occurrences.push(o); }
  async addRelationship(r: Relationship) { this.relationships.push(r); }
  async candidates(_text: string) { return this.rows; }
}

export interface CaptureDeps { repo: Repo; budget: BudgetPort; model: ModelCall; newId: () => string; now: () => string; autoFileMinConfidence: number; nearDupThreshold?: number; estimateUsd?: number }
export interface CaptureInput { content: string; title?: string; sourcePath?: string; sourceUrl?: string }
export type CaptureOutcome = { status: FilingStatus | "duplicate"; recordId: string; category?: string; reason?: string };

export async function capture(input: CaptureInput, d: CaptureDeps): Promise<CaptureOutcome> {
  const hash = contentHash(input.content);
  const occ = { sourcePath: input.sourcePath, sourceUrl: input.sourceUrl, capturedAt: d.now() };

  // Exact duplicate: keep provenance, create no new canonical record.
  const dup = await d.repo.findByHash(hash);
  if (dup) {
    await d.repo.addOccurrence({ recordId: dup.id, ...occ });
    return { status: "duplicate", recordId: dup.id, category: dup.category };
  }

  // Save the original first so nothing downstream can lose it.
  const row: RecordRow = { id: d.newId(), originalTitle: input.title, originalContent: input.content, contentHash: hash, filingStatus: "inbox" };
  await d.repo.insert(row);
  await d.repo.addOccurrence({ recordId: row.id, ...occ });

  // Near duplicates are flagged, never merged. (Linear scan: fine for tests; production uses pgvector/trigram candidates.)
  const threshold = d.nearDupThreshold ?? 0.8;
  const norm = normalizeContent(input.content);
  for (const other of await d.repo.candidates(norm)) {
    if (other.id === row.id) continue;
    const score = similarity(norm, other.originalContent);
    if (score >= threshold) await d.repo.addRelationship({ a: row.id, b: other.id, type: "near_duplicate", score });
  }

  const rule = applyRules(norm);
  const res = await classifyWithRetry(norm, d.model, d.budget, d.estimateUsd);
  if (res.ok) {
    const c = res.value;
    const disagree = !!rule?.category && rule.category !== c.primary_category;
    const confident = c.confidence >= d.autoFileMinConfidence && !c.review_required && !disagree;
    const out: RecordRow = {
      ...row, classification: c, category: c.primary_category,
      filingStatus: confident ? "filed" : "needs_review",
      reviewReason: confident ? undefined : disagree ? `rule/model disagree (${rule!.rule})` : "low confidence",
    };
    await d.repo.update(out);
    return { status: out.filingStatus, recordId: row.id, category: out.category, reason: out.reviewReason };
  }

  // Model unavailable or invalid: a rule hit still yields a reviewable category; otherwise it stays queued.
  const out: RecordRow = { ...row, filingStatus: "needs_review", category: rule?.category, reviewReason: `classifier ${res.reason}` };
  await d.repo.update(out);
  return { status: "needs_review", recordId: row.id, category: out.category, reason: out.reviewReason };
}
