# Status and inventory (2026-10-15)

## Milestone 1: inventory (read-only, nothing modified)

**Notion** (found via search; counts not yet taken)
- "Research Prompt Library" database (`4b27c921-13e2-4b7f-9a01-456d73dbbf3f`), data source `e55be9c7-37b1-4dbe-9343-77a3a7603d1f`. Properties seen: Name, Category (Research, Learning, Audio Overview, Writing, ...), Prompt Family, Output Type, Topic Tags, Section, Source, Purpose, Best For, Notes; a "Needs Review" view exists. It already uses Prompt Family and Output Type, so the spec taxonomy should be reconciled with these options, not replace them.
- "DA Idea Bank" database (`a714bdc0-f70f-418d-a89f-875246873f7b`) under Deconstructing Academia Command Center. Schema not yet fetched.
- Other pages: "Prompt Systems Library", "Research Prompt Library, Cleanup Rules & Triage Plan" (existing filing rules; read before finalizing rules.ts).

**Google Sheets** (Drive search; row counts are grid sizes, not data rows)
- "Prompt Library" `1qmE6dPNsBhSUt3Yr09UPZ0o2muoAegl9PqrjJjmwQsw`: 12.8 MB, main tab ~20,320 grid rows x 33 cols, plus Source Occurrences (~24,972 rows), Source Coverage, Category Guide, Source Text Archive, Read Me, Notion Setup, Completeness Check, Notion Import Verification, and 4 hidden Archive tabs. It already models occurrences and a category guide, so import should reuse them.
- "Prompt Library (backup)" `1s-Tr3d5JnNQoWNU9z2DuXf3lHCBWkTB5iQCPDlJNzJA`: one tab, 34 cols, 1000-row grid. Not assumed identical to the main sheet.
- "Prompt Library, Removed for Review, Usefulness Cleanup, 2026-10-12" `1h1s7H4WYwaRf7iJOUsg4QgjYmnBsJjufCQfBHYGg_wE`: removed items; treat as a review source, not live records.
- Smaller unrelated-looking: "Fallout Aesthetic Prompt...", "UNotebook prompt library", "15000+ ChatGPT Prompts" (third-party).

**Obsidian** `C:\Users\mabbi\Desktop\Mabbitopia`: 579 `.md` files (find count). Top folders include 00 Inbox, 99 System, ChatGPT_MD, RookeryBrain, MabbitSpace, WorkSpace, Zotero. Other copies: `Desktop\Projects\Mabbitopia`, `Desktop\Resources\Mabbitopia Backups`, `Mabbitopia.zip`. Which one is canonical is unconfirmed. Not scanned yet.

**Skills**: no "Prompt & Idea Classifier", "Notion Idea Librarian" or "Academic Voice Keeper" definition found in `~/.claude/skills` by name search. Not searched in Cowork output folders or the vault.

**Tooling**: Node v26, Docker present, no psql/Supabase CLI, no Python.

## Dry run on the full Prompt Library (in memory, nothing written anywhere)

Input: `Downloads\Prompt Library - Prompt Library.csv`, an export dated 2026-10-12 10:03. The live sheet was last modified 20:03 that day, so this is an earlier snapshot, not the live data. Run: `node --import tsx scripts/dry-run.ts <csv>`, 5.3 s.

- 19,795 data rows, all mapped, 0 skipped, 0 repeated Library IDs, 0 exact-duplicate texts, so 19,795 records would be created. The sheet is already deduplicated; near-duplicates were not checked.
- Record types: Prompt 19,596; Idea 89; Prompt fragment 63; Prompt bundle 23; Reference 17; Workflow 7. "Prompt fragment" and "Prompt bundle" are not in the spec's type list.
- 19 existing categories; only "Prompt Engineering" matches the provisional taxonomy. Largest: Writing & Editing 7,289; E-commerce 2,569; Business Strategy 1,240; Audio & Video 1,152; Teaching & Learning 974; Relationships & Parenting 935; Travel & Events 767; Design & Visuals 711; Prompt Engineering 669; Home & Lifestyle 640; Marketing & Sales 583; Health & Wellbeing 518; Creative Writing 415; Finance & Money 380; Social Media 366; Productivity & Systems 274; Research & Analysis 234; Coding & Data 43; Career & Freelancing 36.
- Consequence: the spec's subject categories (Anthropology, Public Policy, etc.) are not the user's current scheme. Before any auto-filing, seed `categories` from these 19 (plus the Category Guide tab) and decide how the spec's labels map onto them.

## Build state

| Item | State |
|---|---|
| Normalization, hashing, near-dup similarity | done, tested |
| Taxonomy schema (strict Zod) | done, seeded from the 19 existing categories; spec labels are optional topic tags |
| Deterministic rules | done, 5 placeholder rules (2 assert a category, 3 add topic tags only) |
| Classifier retry + validation + budget reservation | done, tested with a fake model |
| Capture pipeline (save-first, exact dup, near-dup flag, review routing) | done, in-memory repo, 10 tests pass |
| Postgres schema (0001), trigram near-dup prefilter (0002), RLS, FTS, pgvector | applied to a local Supabase (Docker) with no errors; 5 integration tests pass (`npm run test:db`): filing, exact-dup provenance, near-dup flag, review on model failure, RLS cross-user read/update/forged-insert blocked, immutable snapshots. Not applied to any hosted project |
| OpenAI adapter | not started (model IDs unverified); the route uses a stub that throws, so every live capture is saved and lands in Needs Review ("classifier error"), never auto-filed |
| Persistent budget (ai_usage-backed) | not started; the route builds a fresh in-memory Budget per request |
| SupabaseRepo, Next.js 15 shell (sign-in + Quick Capture page), `POST /api/records/capture` (Zod, bearer/cookie auth, RLS-scoped client, 30/min limiter, structured errors) | done; `next build` passes; verified by curl against local stack (401, 400, capture, duplicate). The page UI was not clicked through in a browser |
| Rest of the API (search, records, review, etc.), dashboard/library/review UI | not started |
| CSV parser, Prompt Library sheet mapping (33 real columns), resumable idempotent import | done, 7 tests; mapping verified against 2 real rows only, never run on the full 20k-row sheet |
| Live Sheets/Notion fetch, Obsidian, JSON adapters | not started (import takes `string[][]`, so a Sheets API pull plugs in directly) |
| 30k benchmark, classification accuracy sample, Notion writeback | not started |

Acceptance tests covered so far: 1, 2, 3, 4, 5, 6, 14, 15 (against the in-memory repo only).
