// node --import tsx scripts/import-obsidian-local.ts <vault>   Local Supabase only. Reads the vault, never writes to it. No AI calls.
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { scanVault, toImportItems } from "../src/import/obsidian/scan.js";
import { runImport } from "../src/import/run.js";
import { SupabaseRepo } from "../src/server/supabaseRepo.js";
import { BulkSupabaseRepo } from "../src/server/bulkRepo.js";
import { loadLedger } from "../src/server/dbLedger.js";
import { localUser } from "./localEnv.js";

const root = process.argv[2]!;
const { db, id: owner } = await localUser();
await SupabaseRepo.init(db, owner);

const src = await db.from("sources").upsert(
  { owner_id: owner, source_type: "obsidian", external_id: "mabbitopia", name: "Mabbitopia vault", permission_level: "read", connection_status: "connected" },
  { onConflict: "owner_id,source_type,external_id" }).select("id").single();
if (src.error) throw new Error(src.error.message);
const sourceId = src.data.id as string;

const scan = await scanVault(root, {}, JSON.parse(readFileSync("config/obsidian.json", "utf8")));
const items = scan.notes.flatMap((n) => toImportItems("mabbitopia", n));

// Immutable per-note snapshot rows (path + content hash) for every note that yielded items.
const snaps = scan.notes.filter((n) => n.parsed.items.length).map((n) => ({ source_id: sourceId, external_record_id: n.path, content_hash: n.noteHash, version: "sha256" }));
if (snaps.length) {
  const s = await db.from("source_snapshots").upsert(snaps, { onConflict: "source_id,external_record_id,content_hash", ignoreDuplicates: true });
  if (s.error) throw new Error(s.error.message);
}

const cats = await db.from("categories").select("id,name").eq("owner_id", owner);
const repo = new BulkSupabaseRepo(db, owner, sourceId, new Map(cats.data!.map((c) => [c.name as string, c.id as string])));
await repo.preload();
const stats = await runImport(items, { repo, ledger: await loadLedger(db, sourceId), sourceId, newId: randomUUID, now: () => new Date().toISOString() });
await repo.flush();
await db.from("sources").update({ last_sync_at: new Date().toISOString() }).eq("id", sourceId);
console.log(JSON.stringify({ notes: Object.keys(scan.manifest).length, items: items.length, snapshots: snaps.length, ...stats }));
