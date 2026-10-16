import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { RECORD_TYPES } from "../core/taxonomy.js";
import { HttpError } from "./http.js";

const PROPOSALS = ["uncertain_classification", "potential_duplicate", "title_suggestion", "category_change", "conflicting_metadata", "failed_sync", "new_category"] as const;

export const ReviewListQuery = z.object({
  status: z.enum(["pending", "approved", "rejected", "edited"]).default("pending"),
  type: z.enum(PROPOSALS).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
}).strict();

export const DecisionBody = z.object({
  decision: z.enum(["approve", "reject", "edit"]),
  change: z.object({
    category: z.string().trim().min(1).max(100).optional(),
    record_type: z.enum(RECORD_TYPES).optional(),
    title: z.string().trim().min(1).max(100).optional(),
    relationship_type: z.enum(["exact_duplicate", "near_duplicate", "related", "revision_of", "expands_on", "references", "belongs_to_project"]).optional(),
  }).strict().optional(),
}).strict();

const DB_ERRORS: Record<string, [number, string, string]> = {
  not_found: [404, "not_found", "Review item not found"],
  already_decided: [409, "already_decided", "This item was already decided"],
  nothing_to_apply: [409, "nothing_to_apply", "There is no proposed change to apply; use edit and supply one"],
  unknown_category: [400, "unknown_category", "Category does not exist"],
  invalid_decision: [400, "invalid_decision", "Unsupported decision"],
  unsupported_proposal: [409, "unsupported_proposal", "This proposal type cannot be decided yet"],
};

export async function listReviews(db: SupabaseClient, q: z.infer<typeof ReviewListQuery>) {
  let req = db.from("review_items")
    .select("id, proposal_type, proposed_change_json, original_value_json, confidence, reason, status, created_at, reviewed_at, records(id, original_title, suggested_title, filing_status, original_content, categories(name))")
    .eq("status", q.status);
  if (q.type) req = req.eq("proposal_type", q.type);
  const [rows, counts] = await Promise.all([
    req.order("created_at", { ascending: false }).order("id").range(q.offset, q.offset + q.limit),
    db.rpc("review_counts"),
  ]);
  if (rows.error) throw new Error(rows.error.message);
  if (counts.error) throw new Error(counts.error.message);
  const page = (rows.data as any[]).slice(0, q.limit);
  return {
    items: page.map((r) => ({
      id: r.id, type: r.proposal_type, status: r.status, reason: r.reason, confidence: r.confidence,
      proposed: r.proposed_change_json, original: r.original_value_json, createdAt: r.created_at, reviewedAt: r.reviewed_at,
      record: r.records && {
        id: r.records.id, title: r.records.suggested_title ?? r.records.original_title, category: r.records.categories?.name ?? null,
        filingStatus: r.records.filing_status, snippet: String(r.records.original_content).slice(0, 200),
      },
    })),
    pending: Object.fromEntries((counts.data as { proposal_type: string; n: number }[]).map((c) => [c.proposal_type, Number(c.n)])),
    limit: q.limit, offset: q.offset, hasMore: (rows.data as any[]).length > q.limit,
  };
}

export async function decideReview(db: SupabaseClient, id: string, body: z.infer<typeof DecisionBody>) {
  const { data, error } = await db.rpc("decide_review", { p_id: id, p_decision: body.decision, p_change: body.change ?? {} });
  if (error) {
    const known = DB_ERRORS[error.message];
    if (known) throw new HttpError(...known);
    if (error.code === "23505") throw new HttpError(409, "conflict", "That relationship already exists for these records");
    throw new Error(error.message);
  }
  return data as { status: string; record_id: string; writeback: false };
}
