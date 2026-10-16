import { randomUUID } from "node:crypto";
import { z } from "zod";
import { capture } from "../../../../src/core/capture";
import { Budget } from "../../../../src/core/budget";
import { SupabaseRepo } from "../../../../src/server/supabaseRepo";
import { unconfiguredModel } from "../../../../src/server/model";
import { getUserClient } from "../../../../src/server/auth";

const Body = z.object({
  content: z.string().trim().min(1).max(200_000),
  title: z.string().trim().max(300).optional(),
  sourceUrl: z.string().url().max(2000).optional(),
  sourcePath: z.string().max(1000).optional(),
}).strict();

// Per-process limiter (30 captures/min/user). Replace with a shared store if the app runs on several instances.
const hits = new Map<string, number[]>();
const limited = (uid: string) => {
  const now = Date.now(), recent = (hits.get(uid) ?? []).filter((t) => now - t < 60_000);
  recent.push(now); hits.set(uid, recent);
  return recent.length > 30;
};

const fail = (status: number, code: string, message: string) =>
  Response.json({ success: false, error: { code, message } }, { status });

export async function POST(req: Request) {
  const auth = await getUserClient(req);
  if (!auth) return fail(401, "unauthorized", "Sign in required");
  if (limited(auth.user.id)) return fail(429, "rate_limited", "Too many captures; try again shortly");

  const raw = await req.json().catch(() => null);
  const body = Body.safeParse(raw);
  if (!body.success) return fail(400, "invalid_input", body.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));

  try {
    const repo = await SupabaseRepo.init(auth.db, auth.user.id);
    // Capture is naturally idempotent: identical text maps to the same record via its content hash.
    const out = await capture(
      { content: body.data.content, title: body.data.title, sourceUrl: body.data.sourceUrl, sourcePath: body.data.sourcePath },
      // The budget is per-request until ai_usage-backed accounting lands; harmless while the model is unconfigured.
      { repo, budget: new Budget(5, 3), model: unconfiguredModel, newId: randomUUID, now: () => new Date().toISOString(), autoFileMinConfidence: 0.85 },
    );
    return Response.json({ success: true, data: out });
  } catch (e) {
    console.error("capture failed", e instanceof Error ? e.message : "unknown");
    return fail(500, "capture_failed", "Could not save the capture");
  }
}
