// node --import tsx scripts/bench.ts [label]   Latency of search / browse / detail through PostgREST as an RLS-scoped user.
import { cpus, totalmem, platform, release } from "node:os";
import { localUser } from "./localEnv.js";

const N = 200, WARM = 20;
const { db } = await localUser();
const pct = (xs: number[], p: number) => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.ceil((p / 100) * xs.length) - 1)]!;
const pick = <T>(xs: T[]) => xs[Math.floor(Math.random() * xs.length)]!;
async function time(name: string, fn: () => Promise<{ error: { message: string } | null; data?: unknown }>) {
  const ms: number[] = [];
  for (let i = 0; i < N + WARM; i++) {
    const t = performance.now();
    const r = await fn();
    const d = performance.now() - t;
    if (r.error) throw new Error(`${name}: ${r.error.message}`);
    if (i >= WARM) ms.push(d);
  }
  return { name, n: ms.length, p50: +pct(ms, 50).toFixed(1), p95: +pct(ms, 95).toFixed(1), p99: +pct(ms, 99).toFixed(1), max: +Math.max(...ms).toFixed(1) };
}

const count = await db.from("records").select("id", { count: "exact", head: true });
const sample = await db.from("records").select("id,original_title,primary_category_id").order("id").range(0, 4999);
const rows = sample.data!;
const words = rows.flatMap((r) => (r.original_title ?? "").toLowerCase().match(/[a-z]{4,}/g) ?? []);
const queries = Array.from({ length: 100 }, (_, i) => (i % 3 === 0 ? pick(words) : i % 3 === 1 ? `${pick(words)} ${pick(words)}` : `"${pick(words)} ${pick(words)}"`));
const cats = [...new Set(rows.map((r) => r.primary_category_id as string))];
let qi = 0, ci = 0, di = 0;

const results = [
  await time("keyword search (top 20)", () => db.rpc("search_records", { p_query: queries[qi++ % queries.length], p_limit: 20 })),
  await time("keyword search + category filter", () => db.rpc("search_records", { p_query: queries[qi++ % queries.length], p_category_id: cats[ci++ % cats.length], p_limit: 20 })),
  await time("filtered browse (category+status, newest 20)", () => db.from("records").select("id,original_title,filing_status,created_at").eq("primary_category_id", cats[ci++ % cats.length]).eq("filing_status", "filed").order("created_at", { ascending: false }).range(0, 19)),
  await time("filtered browse, page 6", () => db.from("records").select("id,original_title,filing_status,created_at").eq("primary_category_id", cats[ci++ % cats.length]).eq("filing_status", "filed").order("created_at", { ascending: false }).range(100, 119)),
  await time("record detail (+occurrences)", () => db.from("records").select("*, record_occurrences(*)").eq("id", rows[di++ % rows.length]!.id).single()),
];
console.log(JSON.stringify({
  label: process.argv[2] ?? "run", records: count.count, iterations: N, warmup: WARM,
  env: { os: `${platform()} ${release()}`, cpu: `${cpus()[0]?.model} x${cpus().length}`, ramGB: Math.round(totalmem() / 2 ** 30), db: "local Supabase (Docker Desktop, shared with other running containers)" },
  results,
}, null, 1));
