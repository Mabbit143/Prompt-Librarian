import { z } from "zod";

export const fail = (status: number, code: string, message: string) =>
  Response.json({ success: false, error: { code, message } }, { status });
export const ok = (data: unknown) => Response.json({ success: true, data });

// Per-process sliding-window limiter. Replace with a shared store if the app runs on several instances.
const hits = new Map<string, number[]>();
export function rateLimited(uid: string, bucket: string, max: number, windowMs = 60_000): boolean {
  const key = `${bucket}:${uid}`, now = Date.now();
  const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  recent.push(now);
  hits.set(key, recent);
  return recent.length > max;
}

export const zodMessage = (e: z.ZodError) => e.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("; ");

/** Query-string object from a request URL; repeated keys keep the last value. */
export const queryOf = (req: Request) => Object.fromEntries(new URL(req.url).searchParams);
