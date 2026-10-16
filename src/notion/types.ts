export type DestKey = "prompt_library" | "da_idea_bank" | "ideas_inbox";

export interface PropSchema { type: string; options?: string[] }
/** Live schema of one Notion data source, captured read-only. Writes require a fresh, verified snapshot. */
export interface SchemaSnapshot { dataSourceId: string; name: string; fetchedAt: string; verified: boolean; properties: Record<string, PropSchema> }

export interface Destination {
  key: DestKey; name: string; dataSourceId: string; titleProperty: string; identityProperty?: string;
  rowCount: number; schemaSnapshot: string | null; confirmed: boolean; note?: string;
}

/** A Librarian record as the sync layer sees it. Only `filed` records are ever eligible. */
export interface SyncRecord {
  id: string; title: string; content: string; contentHash: string; filingStatus: string;
  recordType: string | null; category: string | null; subcategory: string | null; outputType: string | null;
  tags: string[]; topicTags: string[];
  sources: { sourceType: string; externalId?: string | null; path?: string | null; url?: string | null }[];
}

export type Route =
  | { kind: "routed"; destination: DestKey; reason: string }
  | { kind: "needs_destination_decision"; candidates: DestKey[]; reason: string }
  | { kind: "not_eligible"; reason: string };

export type Action = "create" | "skip_exists" | "needs_destination_decision" | "blocked" | "not_eligible";
export interface Warning { code: string; message: string }
export interface PreviewItem {
  recordId: string; action: Action; destination?: DestKey; reason: string;
  properties?: Record<string, unknown>; libraryId?: string; idempotencyKey?: string; warnings: Warning[];
  sourceRef: { paths: string[]; urls: string[] };
}

/** Answer from a read-only lookup in Notion. "unknown" (lookup failed or not run) must never lead to a write. */
export type ExistsAnswer = "exists" | "absent" | "unknown";
export interface NotionIndex {
  lookup(destination: DestKey, key: { libraryId: string; contentHash: string }): ExistsAnswer;
}
