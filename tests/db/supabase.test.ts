// Integration tests against the local Supabase stack (`npx supabase start`). Reads NEXT_PUBLIC_* from .env.local.
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeAll } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { SupabaseRepo } from "../../src/server/supabaseRepo.js";
import { capture } from "../../src/core/capture.js";
import { Budget } from "../../src/core/budget.js";
import type { ModelCall } from "../../src/core/classify.js";

const env = Object.fromEntries(readFileSync(".env.local", "utf8").split(/\r?\n/).filter(Boolean).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, "")]));
const mkUser = async () => {
  const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL!, env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } });
  const { data, error } = await db.auth.signUp({ email: `t${randomUUID()}@example.test`, password: "test-password-123" });
  if (error || !data.user || !data.session) throw new Error(`signup failed: ${error?.message}`);
  return { db: db as SupabaseClient, id: data.user.id };
};
const good = {
  record_type: "Prompt", suggested_title: "T", primary_category: "Writing & Editing", secondary_category: null, prompt_family: null,
  output_type: null, tags: [], topic_tags: [], confidence: 0.95, confidence_reason: "clear", potential_duplicate: false,
  review_required: false, classifier_version: "v1",
};
const model: ModelCall = async () => ({ json: good, costUsd: 0 });
const deps = (repo: SupabaseRepo, m = model) => ({ repo, budget: new Budget(5, 3), model: m, newId: randomUUID, now: () => new Date().toISOString(), autoFileMinConfidence: 0.85 });

describe("capture against Postgres", () => {
  let a: Awaited<ReturnType<typeof mkUser>>, b: Awaited<ReturnType<typeof mkUser>>;
  beforeAll(async () => { a = await mkUser(); b = await mkUser(); });

  it("files, dedupes identical text with provenance, and keeps the original", async () => {
    const repo = await SupabaseRepo.init(a.db, a.id);
    const text = `Write a haiku about testing ${randomUUID()}`;
    const r1 = await capture({ content: text, sourceUrl: "https://example.test/1" }, deps(repo));
    expect(r1.status).toBe("filed");
    const r2 = await capture({ content: text + "  \n", sourcePath: "note.md" }, deps(repo));
    expect(r2).toMatchObject({ status: "duplicate", recordId: r1.recordId });
    const rec = await a.db.from("records").select("original_content,filing_status,suggested_title").eq("id", r1.recordId).single();
    expect(rec.data).toMatchObject({ original_content: text, filing_status: "filed", suggested_title: "T" });
    const occ = await a.db.from("record_occurrences").select("id").eq("record_id", r1.recordId);
    expect(occ.data).toHaveLength(2);
  });

  it("saves the prompt and queues review when the model fails", async () => {
    const repo = await SupabaseRepo.init(a.db, a.id);
    const text = `unclassifiable ${randomUUID()}`;
    const r = await capture({ content: text }, deps(repo, async () => { throw new Error("down"); }));
    expect(r.status).toBe("needs_review");
    const rec = await a.db.from("records").select("original_content,filing_status").eq("id", r.recordId).single();
    expect(rec.data).toEqual({ original_content: text, filing_status: "needs_review" });
  });

  it("flags near duplicates via trigram prefilter without merging", async () => {
    const repo = await SupabaseRepo.init(a.db, a.id);
    const base = `Write a detailed literature review of ${randomUUID()} with at least ten peer reviewed sources and a clear thesis statement`;
    const r1 = await capture({ content: base }, deps(repo));
    const r2 = await capture({ content: base + " please" }, deps(repo));
    expect(r2.recordId).not.toBe(r1.recordId);
    const rel = await a.db.from("record_relationships").select("relationship_type,record_b_id").eq("record_a_id", r2.recordId);
    expect(rel.data).toEqual([{ relationship_type: "near_duplicate", record_b_id: r1.recordId }]);
  });

  it("RLS: another user cannot read or write these records", async () => {
    const repoA = await SupabaseRepo.init(a.db, a.id);
    const r = await capture({ content: `private ${randomUUID()}` }, deps(repoA));
    const seen = await b.db.from("records").select("id").eq("id", r.recordId);
    expect(seen.data).toEqual([]);
    const upd = await b.db.from("records").update({ original_title: "hacked" }).eq("id", r.recordId).select();
    expect(upd.data).toEqual([]);
    const forged = await b.db.from("records").insert({ owner_id: a.id, original_content: "x", content_hash: "h" });
    expect(forged.error).not.toBeNull();
  });

  it("snapshots are immutable", async () => {
    const repo = await SupabaseRepo.init(a.db, a.id);
    void repo;
    const src = await a.db.from("sources").select("id").eq("owner_id", a.id).single();
    const snap = await a.db.from("source_snapshots").insert({ source_id: src.data!.id, external_record_id: "e", content_hash: "h" }).select("id").single();
    const upd = await a.db.from("source_snapshots").update({ version: "2" }).eq("id", snap.data!.id);
    expect(upd.error?.message).toMatch(/immutable/);
  });
});
