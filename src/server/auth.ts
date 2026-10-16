import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

const url = () => process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anon = () => process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

/** Returns a client acting as the signed-in user (RLS applies), or null. Accepts a Bearer token or session cookies. */
export async function getUserClient(req: Request): Promise<{ db: SupabaseClient; user: User } | null> {
  const bearer = req.headers.get("authorization")?.match(/^Bearer (.+)$/i)?.[1];
  const db = bearer
    ? createClient(url(), anon(), { global: { headers: { Authorization: `Bearer ${bearer}` } }, auth: { persistSession: false } })
    : createServerClient(url(), anon(), {
        cookies: { getAll: async () => (await cookies()).getAll(), setAll: () => {} },
      });
  const { data, error } = await db.auth.getUser(bearer);
  return error || !data.user ? null : { db, user: data.user };
}
