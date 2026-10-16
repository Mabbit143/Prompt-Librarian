// Local demo data for the Review UI: node --import tsx scripts/seed-review-demo.ts   (local Supabase only; every item starts with "[demo]")
import { randomUUID } from "node:crypto";
import { SupabaseRepo } from "../src/server/supabaseRepo.js";
import { capture } from "../src/core/capture.js";
import { Budget } from "../src/core/budget.js";
import type { ModelCall } from "../src/core/classify.js";
import { localUser } from "./localEnv.js";

const model: ModelCall = async (t) => {
  if (t.includes("[fail]")) throw new Error("down");
  return { json: { record_type: "Prompt", suggested_title: t.includes("itinerary") ? "Weekend trip itinerary planner" : "Brainstorm product names", primary_category: t.includes("itinerary") ? "Travel & Events" : "Marketing & Sales",
    subcategory: null, proposed_category: null, prompt_family: null, output_type: null, tags: ["demo"], topic_tags: [], confidence: 0.4, confidence_reason: "ambiguous wording",
    potential_duplicate: false, review_required: false, classifier_version: "demo-v1" }, costUsd: 0 };
};
const { db, id } = await localUser();
const repo = await SupabaseRepo.init(db, id);
const run = (content: string) => capture({ content }, { repo, budget: new Budget(5, 3), model, newId: randomUUID, now: () => new Date().toISOString(), autoFileMinConfidence: 0.85 });
const stamp = Date.now();
const base = `[demo ${stamp}] Write a detailed literature review of the topic with at least ten peer reviewed sources and a clear thesis statement now`;
for (const c of [`[demo ${stamp}] Plan a relaxed weekend itinerary for two people`, `[demo ${stamp}] Give me ten ideas for names for a new product line`, `[demo ${stamp}] [fail] Summarize this meeting transcript`, base, base + " please"]) console.log(JSON.stringify(await run(c)));
