import { ZodError } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getUserClient } from "./auth";
import { HttpError, fail, ok, rateLimited, zodMessage } from "./http";
import { BadFilterError, NotFoundError } from "./queries";

/** Auth + rate limit + error mapping for read endpoints. `run` receives the caller's RLS-scoped client. */
export async function guard(req: Request, run: (db: SupabaseClient) => Promise<unknown>): Promise<Response> {
  const auth = await getUserClient(req);
  if (!auth) return fail(401, "unauthorized", "Sign in required");
  if (rateLimited(auth.user.id, "read", 120)) return fail(429, "rate_limited", "Too many requests; try again shortly");
  try {
    return ok(await run(auth.db));
  } catch (e) {
    if (e instanceof HttpError) return fail(e.status, e.code, e.message);
    if (e instanceof ZodError) return fail(400, "invalid_input", zodMessage(e));
    if (e instanceof BadFilterError) return fail(400, "invalid_filter", e.message);
    if (e instanceof NotFoundError) return fail(404, "not_found", e.message);
    console.error("read failed", e instanceof Error ? e.message : "unknown");
    return fail(500, "read_failed", "Could not load data");
  }
}
