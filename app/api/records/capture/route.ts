import { randomUUID } from "node:crypto";
import { z } from "zod";
import { capture } from "../../../../src/core/capture";
import OpenAI from "openai";
import { SupabaseBudget } from "../../../../src/server/supabaseBudget";
import { openaiClassifier, estimateUsd } from "../../../../src/server/openaiClassifier";
import { SupabaseRepo } from "../../../../src/server/supabaseRepo";
import { unconfiguredModel } from "../../../../src/server/model";
import { getUserClient } from "../../../../src/server/auth";
import { fail, ok, rateLimited, zodMessage } from "../../../../src/server/http";

const Body = z.object({
  content: z.string().trim().min(1).max(200_000),
  title: z.string().trim().max(300).optional(),
  sourceUrl: z.string().url().max(2000).optional(),
  sourcePath: z.string().max(1000).optional(),
}).strict();


export async function POST(req: Request) {
  const auth = await getUserClient(req);
  if (!auth) return fail(401, "unauthorized", "Sign in required");
  if (rateLimited(auth.user.id, "capture", 30)) return fail(429, "rate_limited", "Too many captures; try again shortly");

  const raw = await req.json().catch(() => null);
  const body = Body.safeParse(raw);
  if (!body.success) return fail(400, "invalid_input", zodMessage(body.error));

  try {
    const repo = await SupabaseRepo.init(auth.db, auth.user.id);
    const model = process.env.OPENAI_API_KEY ? openaiClassifier(new OpenAI({ apiKey: process.env.OPENAI_API_KEY })) : unconfiguredModel;
    // Capture is naturally idempotent: identical text maps to the same record via its content hash.
    const out = await capture(
      { content: body.data.content, title: body.data.title, sourceUrl: body.data.sourceUrl, sourcePath: body.data.sourcePath },
      // Without OPENAI_API_KEY the stub throws, so captures are saved and queued for review.
      { repo, budget: new SupabaseBudget(auth.db, "classify", "gpt-6-luna"), model, estimateUsd: estimateUsd("gpt-6-luna", body.data.content.length), newId: randomUUID, now: () => new Date().toISOString(), autoFileMinConfidence: 0.85 },
    );
    return ok(out);
  } catch (e) {
    console.error("capture failed", e instanceof Error ? e.message : "unknown");
    return fail(500, "capture_failed", "Could not save the capture");
  }
}
