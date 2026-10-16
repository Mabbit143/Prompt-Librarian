// Read-API query layer against the local Supabase stack. Each user is fresh, so counts are exact.
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeAll } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { SupabaseRepo } from "../../src/server/supabaseRepo.js";
import { capture } from "../../src/core/capture.js";
import { Budget } from "../../src/core/budget.js";
import type { ModelCall } from "../../src/core/classify.js";
import { BadFilterError, IdParam, ListQuery, NotFoundError, SearchQuery, getRecord, listRecords, searchRecords } from "../../src/server/queries.js";

const env = Object.fromEntries(readFileSync(".env.local", "utf8").split(/\r?\n/).filter(Boolean).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, "")]));
const mkUser = async () => {
  const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL!, env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } });
  const { data, error } = await db.auth.signUp({ email: `t${randomUUID()}@example.test`, password: "test-password-123" });
  if (error || !data.user) throw new Error(error?.message);
  return { db: db as SupabaseClient, id: data.user.id };
};
const model: ModelCall = async (t) => ({
  json: {
    record_type: "Prompt", suggested_title: `Title ${t.slice(0, 20)}`, primary_category: t.includes("ledger") ? "Finance & Money" : "Writing & Editing",
    subcategory: null, proposed_category: null, prompt_family: null, output_type: null, tags: [], topic_tags: [], confidence: t.includes("shaky") ? 0.3 : 0.95,
    confidence_reason: "x", potential_duplicate: false, review_required: false, classifier_version: "v1",
  }, costUsd: 0,
});
const run = async (repo: SupabaseRepo, content: string, extra: { sourcePath?: string } = {}) =>
  capture({ content, ...extra }, { repo, budget: new Budget(5, 3), model, newId: randomUUID, now: () => new Date().toISOString(), autoFileMinConfidence: 0.85 });

describe("read API queries", () => {
  const tag = `qz${randomUUID().replace(/-/g, "").slice(0, 8)}`;
  let a: Awaited<ReturnType<typeof mkUser>>, b: Awaited<ReturnType<typeof mkUser>>;
  let firstId = "";
  beforeAll(async () => {
    a = await mkUser(); b = await mkUser();
    const repo = await SupabaseRepo.init(a.db, a.id);
    for (let i = 0; i < 24; i++) {
      const r = await run(repo, `${tag} writing prompt number ${i} about ${["essays", "emails", "posts"][i % 3]} and style`, { sourcePath: `notes/${i}.md` });
      if (i === 0) firstId = r.recordId;
    }
    await run(repo, `${tag} ledger reconciliation checklist for the month end close`);
    await run(repo, `${tag} shaky ambiguous thing to review later`);
    await run(repo, `${tag} writing prompt number 0 about essays and style`, { sourcePath: "second/place.md" }); // exact duplicate -> 2nd occurrence
    await run(repo, `${tag} writing prompt number 0 about essays and style please`); // near duplicate of #0
    const repoB = await SupabaseRepo.init(b.db, b.id);
    await run(repoB, `${tag} belongs to user b`);
  }, 120_000);

  it("search: ranks, filters, pages without overlap, and returns provenance", async () => {
    const all = await searchRecords(a.db, SearchQuery.parse({ q: tag, limit: 10 }));
    expect(all.items).toHaveLength(10);
    expect(all.hasMore).toBe(true);
    expect(all.items[0]!.sources[0]).toMatchObject({ sourceType: "internal", sourceName: "Quick Capture" });
    const p2 = await searchRecords(a.db, SearchQuery.parse({ q: tag, limit: 10, offset: 10 }));
    expect(p2.items.some((i) => all.items.some((j) => j.id === i.id))).toBe(false);

    const fin = await searchRecords(a.db, SearchQuery.parse({ q: tag, category: "Finance & Money" }));
    expect(fin.items).toHaveLength(1);
    expect(fin.items[0]).toMatchObject({ category: "Finance & Money", filingStatus: "filed" });
    const review = await searchRecords(a.db, SearchQuery.parse({ q: `${tag} shaky`, status: "needs_review" }));
    expect(review.items).toHaveLength(1);
    const phrase = await searchRecords(a.db, SearchQuery.parse({ q: `"number 5 about"` }));
    expect(phrase.items.length).toBeGreaterThanOrEqual(1);
  });

  it("search: rejects bad input and unknown categories, and never leaks another user's rows", async () => {
    expect(SearchQuery.safeParse({ q: "" }).success).toBe(false);
    expect(SearchQuery.safeParse({ q: "x", limit: 500 }).success).toBe(false);
    expect(SearchQuery.safeParse({ q: "x", bogus: 1 }).success).toBe(false);
    await expect(searchRecords(a.db, SearchQuery.parse({ q: tag, category: "Nope" }))).rejects.toBeInstanceOf(BadFilterError);
    const mine = await searchRecords(b.db, SearchQuery.parse({ q: tag, limit: 100 }));
    expect(mine.items).toHaveLength(1);
    expect(mine.items[0]!.snippet).toContain("user b");
  });

  it("list: paginates without gaps or overlap, sorts, and filters", async () => {
    const seen: string[] = [];
    for (let off = 0; ; off += 10) {
      const p = await listRecords(a.db, ListQuery.parse({ limit: 10, offset: off }));
      seen.push(...p.items.map((i) => i.id));
      if (!p.hasMore) break;
    }
    expect(seen).toHaveLength(27); // 24 + ledger + shaky + near-dup (exact dup adds no record)
    expect(new Set(seen).size).toBe(27);
    const newest = await listRecords(a.db, ListQuery.parse({ limit: 5 }));
    const oldest = await listRecords(a.db, ListQuery.parse({ limit: 5, sort: "oldest" }));
    expect(oldest.items[0]!.id).toBe(firstId);
    expect(newest.items[0]!.id).not.toBe(firstId);
    expect((await listRecords(a.db, ListQuery.parse({ status: "needs_review" }))).items).toHaveLength(1);
    expect((await listRecords(a.db, ListQuery.parse({ category: "Finance & Money" }))).items).toHaveLength(1);
    expect((await listRecords(a.db, ListQuery.parse({ sourceType: "internal", limit: 100 }))).items).toHaveLength(27);
    expect((await listRecords(a.db, ListQuery.parse({ sourceType: "csv" }))).items).toHaveLength(0);
    expect(ListQuery.safeParse({ sort: "random" }).success).toBe(false);
  });

  it("detail: full original, classification, every source occurrence, and relationships", async () => {
    const d = await getRecord(a.db, firstId);
    expect(d.originalContent).toBe(`${tag} writing prompt number 0 about essays and style`);
    expect(d.category).toBe("Writing & Editing");
    expect(d.filingStatus).toBe("filed");
    expect(d.classification).toMatchObject({ classifier_version: "v1" });
    expect(d.occurrences.map((o) => o.path)).toEqual(["notes/0.md", "second/place.md"]);
    expect(d.occurrences[0]).toMatchObject({ sourceType: "internal" });
    expect(d.relationships).toHaveLength(1);
    expect(d.relationships[0]).toMatchObject({ type: "near_duplicate", reviewStatus: "pending" });
    expect(d.relationships[0]!.otherTitle).toBeTruthy();
  });

  it("detail: other users' and unknown ids are not found; ids must be UUIDs", async () => {
    await expect(getRecord(b.db, firstId)).rejects.toBeInstanceOf(NotFoundError);
    await expect(getRecord(a.db, randomUUID())).rejects.toBeInstanceOf(NotFoundError);
    expect(IdParam.safeParse("not-a-uuid").success).toBe(false);
  });
});
