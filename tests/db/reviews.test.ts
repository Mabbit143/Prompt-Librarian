import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeAll } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { SupabaseRepo } from "../../src/server/supabaseRepo.js";
import { capture } from "../../src/core/capture.js";
import { Budget } from "../../src/core/budget.js";
import type { ModelCall } from "../../src/core/classify.js";
import { DecisionBody, ReviewListQuery, decideReview, listReviews } from "../../src/server/reviews.js";
import { HttpError } from "../../src/server/http.js";

const env = Object.fromEntries(readFileSync(".env.local", "utf8").split(/\r?\n/).filter(Boolean).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, "")]));
const mkUser = async () => {
  const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL!, env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } });
  const { data, error } = await db.auth.signUp({ email: `t${randomUUID()}@example.test`, password: "test-password-123" });
  if (error || !data.user) throw new Error(error?.message);
  return { db: db as SupabaseClient, id: data.user.id };
};
const model: ModelCall = async (t) => {
  if (t.includes("boom")) throw new Error("model down");
  return { json: {
    record_type: "Prompt", suggested_title: "Proposed title", primary_category: "Business Strategy", secondary_category: null,
    prompt_family: null, output_type: null, tags: [], topic_tags: [], confidence: t.includes("lowconf") ? 0.3 : 0.95,
    confidence_reason: "x", potential_duplicate: false, review_required: false, classifier_version: "v1" }, costUsd: 0 };
};
const cap = (repo: SupabaseRepo, content: string) =>
  capture({ content }, { repo, budget: new Budget(5, 3), model, newId: randomUUID, now: () => new Date().toISOString(), autoFileMinConfidence: 0.85 });
const L = (extra: object = {}) => ReviewListQuery.parse(extra);
const status = async (db: SupabaseClient, id: string) => (await db.from("records").select("filing_status,primary_category_id,record_type,suggested_title").eq("id", id).single()).data!;
const code = async (p: Promise<unknown>) => { try { await p; return "ok"; } catch (e) { return e instanceof HttpError ? e.code : String(e); } };

describe("review queue", () => {
  const tag = `rv${randomUUID().replace(/-/g, "").slice(0, 8)}`;
  let a: Awaited<ReturnType<typeof mkUser>>, b: Awaited<ReturnType<typeof mkUser>>, repo: SupabaseRepo;
  beforeAll(async () => { a = await mkUser(); b = await mkUser(); repo = await SupabaseRepo.init(a.db, a.id); }, 60_000);

  const itemFor = async (recordId: string, type?: string) => {
    const r = await listReviews(a.db, L({ limit: 100, ...(type ? { type } : {}) }));
    return r.items.find((i) => i.record?.id === recordId)!;
  };

  it("queues a low-confidence capture and approving applies the proposal, audited, once", async () => {
    const r = await cap(repo, `${tag} lowconf one`);
    expect(r.status).toBe("needs_review");
    const item = await itemFor(r.recordId);
    expect(item).toMatchObject({ type: "uncertain_classification", status: "pending", proposed: { category: "Business Strategy", title: "Proposed title" } });
    expect(item.record!.snippet).toContain("lowconf one");

    const out = await decideReview(a.db, item.id, DecisionBody.parse({ decision: "approve" }));
    expect(out).toMatchObject({ status: "approved", record_id: r.recordId, writeback: false });
    const rec = await status(a.db, r.recordId);
    expect(rec).toMatchObject({ filing_status: "filed", suggested_title: "Proposed title" });
    const log = await a.db.from("change_log").select("operation,actor,before_json,after_json").eq("record_id", r.recordId);
    expect(log.data).toHaveLength(1);
    expect(log.data![0]).toMatchObject({ operation: "review_uncertain_classification_approve", actor: "user" });
    expect((log.data![0]!.before_json as any).filing_status).toBe("needs_review");
    expect(await code(decideReview(a.db, item.id, DecisionBody.parse({ decision: "approve" })))).toBe("already_decided");
    expect((await listReviews(a.db, L({ status: "approved" }))).items.map((i) => i.id)).toContain(item.id);
  });

  it("failed classification: approve has nothing to apply, edit supplies the category", async () => {
    const r = await cap(repo, `${tag} boom failure`);
    const item = await itemFor(r.recordId);
    expect(item.proposed).toBeNull();
    expect(await code(decideReview(a.db, item.id, DecisionBody.parse({ decision: "approve" })))).toBe("nothing_to_apply");
    const out = await decideReview(a.db, item.id, DecisionBody.parse({ decision: "edit", change: { category: "Finance & Money", title: "My title" } }));
    expect(out.status).toBe("edited");
    expect(await status(a.db, r.recordId)).toMatchObject({ filing_status: "filed", suggested_title: "My title" });
  });

  it("reject leaves the record in review", async () => {
    const r = await cap(repo, `${tag} lowconf two`);
    const item = await itemFor(r.recordId);
    expect((await decideReview(a.db, item.id, DecisionBody.parse({ decision: "reject" }))).status).toBe("rejected");
    expect((await status(a.db, r.recordId)).filing_status).toBe("needs_review");
  });

  it("near duplicates: confirm as revision or keep separate; nothing is ever merged", async () => {
    const base = `${tag} write a detailed literature review of the topic with at least ten peer reviewed sources and a clear thesis statement now`;
    const first = await cap(repo, base);
    const second = await cap(repo, base + " please");
    const third = await cap(repo, base + " thanks");
    const dupItem = await itemFor(second.recordId, "potential_duplicate");
    expect(dupItem).toMatchObject({ type: "potential_duplicate", proposed: { record_b_id: first.recordId, relationship_type: "near_duplicate" } });

    await decideReview(a.db, dupItem.id, DecisionBody.parse({ decision: "edit", change: { relationship_type: "revision_of" } }));
    const rel = await a.db.from("record_relationships").select("relationship_type,review_status").eq("record_a_id", second.recordId).eq("record_b_id", first.recordId);
    expect(rel.data).toEqual([{ relationship_type: "revision_of", review_status: "confirmed" }]);

    const items3 = (await listReviews(a.db, L({ type: "potential_duplicate", limit: 100 }))).items.filter((i) => i.record?.id === third.recordId);
    expect(items3.length).toBeGreaterThan(0);
    await decideReview(a.db, items3[0]!.id, DecisionBody.parse({ decision: "reject" }));
    const dismissed = await a.db.from("record_relationships").select("review_status").eq("record_a_id", third.recordId).eq("record_b_id", items3[0]!.proposed.record_b_id);
    expect(dismissed.data).toEqual([{ review_status: "dismissed" }]);

    const live = await a.db.from("records").select("id").in("id", [first.recordId, second.recordId, third.recordId]).is("deleted_at", null);
    expect(live.data).toHaveLength(3);
  });

  it("lists pending counts by type with filtering and pagination", async () => {
    const all = await listReviews(a.db, L({ limit: 1 }));
    expect(all.items).toHaveLength(1);
    expect(all.hasMore).toBe(true);
    expect(all.pending.uncertain_classification).toBeGreaterThanOrEqual(1);
    const dups = await listReviews(a.db, L({ type: "potential_duplicate", limit: 100 }));
    expect(dups.items.every((i) => i.type === "potential_duplicate")).toBe(true);
  });

  it("another user cannot see or decide these items", async () => {
    const r = await cap(repo, `${tag} lowconf private`);
    const item = await itemFor(r.recordId);
    expect((await listReviews(b.db, L({ limit: 100 }))).items).toHaveLength(0);
    expect(await code(decideReview(b.db, item.id, DecisionBody.parse({ decision: "approve" })))).toBe("not_found");
    expect((await itemFor(r.recordId)).status).toBe("pending");
  });

  it("validates bodies strictly", () => {
    expect(DecisionBody.safeParse({ decision: "merge" }).success).toBe(false);
    expect(DecisionBody.safeParse({ decision: "edit", change: { category: "Anthropology" } }).success).toBe(false);
    expect(DecisionBody.safeParse({ decision: "approve", extra: 1 }).success).toBe(false);
    expect(ReviewListQuery.parse({}).status).toBe("pending");
  });
});
