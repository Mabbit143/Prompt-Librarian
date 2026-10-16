// node --import tsx scripts/import-local.ts <prompt-library.csv>   (local Supabase only, no AI calls)
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { randomUUID } from "node:crypto";
import { parseCsv } from "../src/import/csv.js";
import { mapPromptLibraryRows } from "../src/import/promptLibrary.js";
import { runImport, MemoryLedger } from "../src/import/run.js";
import { SupabaseRepo } from "../src/server/supabaseRepo.js";
import { BulkSupabaseRepo } from "../src/server/bulkRepo.js";
import { localUser } from "./localEnv.js";

const file = process.argv[2]!;
const { db, id: owner } = await localUser();
await SupabaseRepo.init(db, owner); // user row, internal source, 19 categories

// A DB-backed ledger doesn't exist yet, so refuse to run twice for the same file.
const extId = basename(file);
const existing = await db.from("sources").select("id").eq("owner_id", owner).eq("source_type", "csv").eq("external_id", extId).maybeSingle();
if (existing.data) throw new Error(`${extId} was already imported for this user; wipe the local DB to redo it`);
const src = await db.from("sources").insert({ owner_id: owner, source_type: "csv", external_id: extId, name: extId, connection_status: "connected" }).select("id").single();
if (src.error) throw new Error(src.error.message);

const cats = await db.from("categories").select("id,name").eq("owner_id", owner);
const repo = new BulkSupabaseRepo(db, owner, src.data.id, new Map(cats.data!.map((c) => [c.name as string, c.id as string])));
await repo.preload();

const t0 = Date.now();
const { items, skipped } = mapPromptLibraryRows(parseCsv(readFileSync(file, "utf8")));
const stats = await runImport(items, { repo, ledger: new MemoryLedger(), sourceId: src.data.id, newId: randomUUID, now: () => new Date().toISOString() });
await repo.flush();
await db.from("sources").update({ last_sync_at: new Date().toISOString() }).eq("id", src.data.id);
console.log(JSON.stringify({ items: items.length, skipped: skipped.length, ...stats, seconds: (Date.now() - t0) / 1000 }));
