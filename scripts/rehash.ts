// node --import tsx scripts/rehash.ts   Recomputes records.content_hash with the current normalization (local Supabase, bench user).
// Only the derived hash changes; original text is never touched. Safe to rerun.
import { contentHash } from "../src/core/normalize.js";
import { localUser } from "./localEnv.js";

const { db } = await localUser();
let seen = 0, changed = 0;
for (let from = 0; ; from += 500) {
  const { data, error } = await db.from("records").select("id,original_content,content_hash").order("id").range(from, from + 499);
  if (error) throw new Error(error.message);
  for (const r of data) {
    seen++;
    const h = contentHash(r.original_content);
    if (h === r.content_hash) continue;
    const u = await db.from("records").update({ content_hash: h }).eq("id", r.id);
    if (u.error) throw new Error(`${r.id}: ${u.error.message}`);
    changed++;
  }
  if (data.length < 500) break;
}
console.log(JSON.stringify({ seen, changed }));
