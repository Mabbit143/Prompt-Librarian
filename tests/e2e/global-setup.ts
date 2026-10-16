// Creates a fresh local user and seeds records so every E2E run starts from known data. Local Supabase only.
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { SupabaseRepo } from "../../src/server/supabaseRepo";
import { capture } from "../../src/core/capture";
import { Budget } from "../../src/core/budget";
import type { ModelCall } from "../../src/core/classify";

export default async function globalSetup() {
  const env = Object.fromEntries(readFileSync(".env.local", "utf8").split(/\r?\n/).filter(Boolean).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, "")]));
  if (!/^https?:\/\/(127\.0\.0\.1|localhost)/.test(env.NEXT_PUBLIC_SUPABASE_URL ?? "")) throw new Error("E2E seeding only runs against a local Supabase");

  const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL!, env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } });
  const creds = { email: `e2e${randomUUID().slice(0, 8)}@example.test`, password: randomUUID() };
  const { data, error } = await db.auth.signUp(creds);
  if (error || !data.user) throw new Error(`E2E sign-up failed: ${error?.message}`);

  const tag = `e2e${Date.now().toString(36)}`;
  const model: ModelCall = async (t) => {
    if (t.includes("[fail]")) throw new Error("classifier down");
    const confident = t.includes("[sure]");
    return { json: {
      record_type: "Prompt", suggested_title: t.includes("[sure]") ? "Weekly meal planner" : "Product naming brainstorm",
      primary_category: t.includes("[sure]") ? "Home & Lifestyle" : "Marketing & Sales", secondary_category: null, prompt_family: null,
      output_type: null, tags: [], topic_tags: [], confidence: confident ? 0.95 : 0.4, confidence_reason: "fixture", potential_duplicate: false,
      review_required: false, classifier_version: "e2e-v1" }, costUsd: 0 };
  };
  const repo = await SupabaseRepo.init(db, data.user.id);
  const run = (content: string, sourcePath?: string) => capture({ content, sourcePath }, {
    repo, budget: new Budget(5, 3), model, newId: randomUUID, now: () => new Date().toISOString(), autoFileMinConfidence: 0.85 });

  await run(`${tag} [sure] Plan a week of healthy dinners with a shopping list and prep schedule`, "notes/meals.md");
  await run(`${tag} Give me twenty names for a new product line aimed at students`);
  await run(`${tag} [fail] Summarize this meeting transcript into decisions and actions`);
  const dup = `${tag} Write a detailed literature review of the topic with at least ten sources and a clear thesis statement now`;
  await run(dup);
  await run(dup + " please");

  process.env.E2E_EMAIL = creds.email;
  process.env.E2E_PASSWORD = creds.password;
  process.env.E2E_TAG = tag;
}
