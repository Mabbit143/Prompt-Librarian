import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeAll } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { SupabaseRepo } from "../../src/server/supabaseRepo.js";
import { capture } from "../../src/core/capture.js";
import { Budget } from "../../src/core/budget.js";
import type { ModelCall } from "../../src/core/classify.js";
import { DryRunBody, SyncQuery, buildSyncPreview, dryRun } from "../../src/server/sync.js";

const env = Object.fromEntries(readFileSync(".env.local", "utf8").split(/\r?\n/).filter(Boolean).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, "")]));
const mkUser = async () => {
  const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL!, env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } });
  const { data, error } = await db.auth.signUp({ email: `t${randomUUID()}@example.test`, password: "test-password-123" });
  if (error || !data.user) throw new Error(error?.message);
  return { db: db as SupabaseClient, id: data.user.id };
};
const model: ModelCall = async (t) => ({ json: {
  record_type: "Prompt", suggested_title: `Title ${t.slice(0, 12)}`, primary_category: "Home & Lifestyle", subcategory: null, proposed_category: null,
  prompt_family: null, output_type: "Plan", tags: [], topic_tags: [], confidence: t.includes("unsure") ? 0.2 : 0.95, confidence_reason: "x",
  potential_duplicate: false, review_required: false, classifier_version: "v1" }, costUsd: 0 });
const run = (repo: SupabaseRepo, content: string) => capture({ content }, { repo, budget: new Budget(5, 3), model, newId: randomUUID, now: () => new Date().toISOString(), autoFileMinConfidence: 0.85 });
const strict = { limit: 50, offset: 0, explore: false }, explore = { limit: 50, offset: 0, explore: true };

describe("sync preview (read-only)", () => {
  let a: Awaited<ReturnType<typeof mkUser>>, b: Awaited<ReturnType<typeof mkUser>>;
  let fromNotion = "";
  beforeAll(async () => {
    a = await mkUser(); b = await mkUser();
    const repo = await SupabaseRepo.init(a.db, a.id);
    await run(repo, `plan the weekly dinners ${randomUUID()}`);
    await run(repo, `unsure about this one ${randomUUID()}`); // needs_review: must not appear
    fromNotion = (await run(repo, `a prompt that came from the notion library ${randomUUID()}`)).recordId;
    const src = await a.db.from("sources").select("id").eq("owner_id", a.id).eq("source_type", "internal").single();
    const ins = await a.db.from("record_occurrences").insert({ record_id: fromNotion, source_id: src.data!.id, external_record_id: "NTN-000123" });
    expect(ins.error).toBeNull();
    await run(await SupabaseRepo.init(b.db, b.id), `belongs to user b ${randomUUID()}`);
  }, 60_000);

  it("strict mode lists only filed records and reports the real blockers", async () => {
    const r = await buildSyncPreview(a.db, strict);
    expect(r.mode).toBe("strict");
    expect(r.loaded).toBe(2);
    expect(r.preview.items.map((i) => i.title).join(" ")).not.toContain("unsure");
    expect(r.preview.summary.create).toBe(0);
    const blocked = r.preview.items.find((i) => i.action === "blocked")!;
    expect(blocked.reason).toMatch(/stale|could not check Notion/);
    expect(r.approvable).toBe(false);
    expect(r.destination).toMatchObject({ name: "Prompt Engineering Dashboard", confirmed: true });
  });

  it("records that came from the Notion library are never proposed again", async () => {
    const r = await buildSyncPreview(a.db, strict);
    const item = r.preview.items.find((i) => i.recordId === fromNotion)!;
    expect(item).toMatchObject({ action: "skip_exists", libraryId: "NTN-000123" });
  });

  it("explore mode shows what the mapping would create, with a stable digest, but is not approvable", async () => {
    const r = await buildSyncPreview(a.db, explore);
    expect(r.mode).toBe("explore");
    const create = r.preview.items.find((i) => i.action === "create")!;
    expect(create.libraryId).toMatch(/^LIBR-[0-9A-F]{10}$/);
    expect((create.properties!["Category"] as any).select.name).toBe("Home & Lifestyle");
    expect(r.digest).toMatch(/^[0-9a-f]{64}$/);
    expect((await buildSyncPreview(a.db, explore)).digest).toBe(r.digest);
    expect(r.approvable).toBe(false);
  });

  it("dry run counts what would be created and never touches a writer", async () => {
    const d = await dryRun(a.db, explore);
    expect(d.result).toMatchObject({ mode: "dry_run", wouldCreate: 1 });
    expect(d.digest).toMatch(/^[0-9a-f]{64}$/);
    expect((await dryRun(a.db, strict)).result.wouldCreate).toBe(0);
  });

  it("pages and isolates users", async () => {
    expect((await buildSyncPreview(a.db, { ...strict, limit: 1 })).loaded).toBe(1);
    expect((await buildSyncPreview(a.db, { ...strict, limit: 1, offset: 1 })).loaded).toBe(1);
    expect((await buildSyncPreview(a.db, { ...strict, limit: 1, offset: 2 })).loaded).toBe(0);
    const other = await buildSyncPreview(b.db, strict);
    expect(other.loaded).toBe(1);
    expect(other.preview.items.every((i) => i.title !== "")).toBe(true);
  });

  it("validates input strictly", () => {
    expect(SyncQuery.safeParse({ limit: "500" }).success).toBe(false);
    expect(SyncQuery.parse({ explore: "1" }).explore).toBe(true);
    expect(SyncQuery.parse({}).explore).toBe(false);
    expect(DryRunBody.safeParse({ write: true }).success).toBe(false);
  });
});
