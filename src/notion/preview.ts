import { createHash } from "node:crypto";
import type { Action, Destination, DestKey, NotionIndex, PreviewItem, SchemaSnapshot, SyncRecord } from "./types.js";
import { routeRecord } from "./route.js";
import { libraryIdFor, mapToPromptLibrary, plain } from "./mapping.js";

export interface PreviewDeps {
  destinations: Destination[];
  snapshots: Partial<Record<DestKey, SchemaSnapshot>>;
  index: NotionIndex;
  libraryIdPrefix: string;
  now: Date;
  maxSnapshotAgeMs?: number;
}
export interface Preview { items: PreviewItem[]; summary: Record<Action, number>; builtAt: string }

/**
 * Pure, read-only: decides what WOULD happen for each record. It has no Notion client, so it cannot write.
 * Every record gets exactly one outcome; nothing is dropped silently.
 */
export function buildPreview(records: SyncRecord[], d: PreviewDeps): Preview {
  const maxAge = d.maxSnapshotAgeMs ?? 60 * 60 * 1000;
  const items = records.map((r): PreviewItem => {
    const base = { recordId: r.id, warnings: [], sourceRef: { paths: r.sources.map((s) => s.path).filter(Boolean) as string[], urls: r.sources.map((s) => s.url).filter(Boolean) as string[] } };
    const item = (action: Action, reason: string, extra: Partial<PreviewItem> = {}): PreviewItem => ({ ...base, action, reason, ...extra });

    const route = routeRecord(r);
    if (route.kind === "not_eligible") return item("not_eligible", route.reason);
    if (route.kind === "needs_destination_decision") return item("needs_destination_decision", `${route.reason} (candidates: ${route.candidates.join(", ")})`);

    const dest = d.destinations.find((x) => x.key === route.destination);
    if (!dest) return item("blocked", `no destination configured for ${route.destination}`, { destination: route.destination });
    const at = { destination: dest.key };
    if (!dest.confirmed) return item("blocked", `destination "${dest.name}" has not been confirmed by the user`, at);
    if (dest.key !== "prompt_library") return item("blocked", `property mapping for "${dest.name}" is not built; its schema has not been fetched in full`, at);

    const snap = d.snapshots[dest.key];
    if (!snap || !snap.verified) return item("blocked", "no verified schema snapshot; inspect the live database first", at);
    if (d.now.getTime() - new Date(snap.fetchedAt).getTime() > maxAge) return item("blocked", "schema snapshot is stale; refresh the live schema before writing", at);

    const libraryId = libraryIdFor(r.id, d.libraryIdPrefix);
    const seen = d.index.lookup(dest.key, { libraryId, contentHash: r.contentHash });
    if (seen === "exists") return item("skip_exists", "already in Notion (matched by Library ID or identical text)", { ...at, libraryId });
    if (seen === "unknown") return item("blocked", "could not check Notion for an existing copy; not writing when unsure", { ...at, libraryId });

    const m = mapToPromptLibrary(r, snap, libraryId);
    if (m.blocked) return item("blocked", m.blocked, { ...at, libraryId, warnings: m.warnings });
    const idempotencyKey = createHash("sha256").update(`${dest.key}:${libraryId}`).digest("hex").slice(0, 32);
    return item("create", `new ${r.recordType} for ${dest.name}`, { ...at, libraryId, contentHash: r.contentHash, properties: m.properties, warnings: m.warnings, idempotencyKey });
  });
  const summary = { create: 0, skip_exists: 0, needs_destination_decision: 0, blocked: 0, not_eligible: 0 } as Record<Action, number>;
  for (const i of items) summary[i.action]++;
  return { items, summary, builtAt: d.now.toISOString() };
}

/** The only items a writer may act on, and only after the user approves this exact preview. */
export const safeCreates = (p: Preview) => p.items.filter((i) => i.action === "create");

/** Compares what Notion stored (fetched back) with what the preview intended. Empty list = verified. */
export function verifyReadBack(item: PreviewItem, stored: Record<string, unknown>): string[] {
  const bad: string[] = [];
  for (const [prop, want] of Object.entries(item.properties ?? {})) {
    if (plain(stored[prop]) !== plain(want)) bad.push(`${prop}: expected "${plain(want).slice(0, 60)}", found "${plain(stored[prop]).slice(0, 60)}"`);
  }
  return bad;
}
