// Shared helpers for local-only scripts (import-local.ts, bench.ts). Targets the local Supabase stack from .env.local.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const env = Object.fromEntries(readFileSync(".env.local", "utf8").split(/\r?\n/).filter(Boolean)
  .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, "")]));
if (!/^https?:\/\/(127\.0\.0\.1|localhost)/.test(env.NEXT_PUBLIC_SUPABASE_URL ?? "")) throw new Error("refusing to run against a non-local Supabase");

const FILE = ".local-bench.json"; // gitignored; local test account only
export async function localUser(): Promise<{ db: SupabaseClient; id: string }> {
  const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL!, env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } });
  if (existsSync(FILE)) {
    const c = JSON.parse(readFileSync(FILE, "utf8"));
    const { data, error } = await db.auth.signInWithPassword(c);
    if (error || !data.user) throw new Error(`sign-in failed: ${error?.message}`);
    return { db, id: data.user.id };
  }
  const creds = { email: `bench${randomUUID().slice(0, 8)}@example.test`, password: randomUUID() };
  const { data, error } = await db.auth.signUp(creds);
  if (error || !data.user) throw new Error(`sign-up failed: ${error?.message}`);
  writeFileSync(FILE, JSON.stringify(creds));
  return { db, id: data.user.id };
}
