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

## Build state

| Item | State |
|---|---|
| Normalization, hashing, near-dup similarity | done, tested |
| Taxonomy schema (strict Zod) | done, provisional labels |
| Deterministic rules | done, 5 placeholder rules |
| Classifier retry + validation + budget reservation | done, tested with a fake model |
| Capture pipeline (save-first, exact dup, near-dup flag, review routing) | done, in-memory repo, 10 tests pass |
| Postgres schema, RLS, FTS, pgvector | written, **never run** against a database |
| OpenAI adapter | not started (model IDs unverified) |
| Supabase repo, Next.js app, auth, API, UI | not started |
| CSV parser, Prompt Library sheet mapping (33 real columns), resumable idempotent import | done, 7 tests; mapping verified against 2 real rows only, never run on the full 20k-row sheet |
| Live Sheets/Notion fetch, Obsidian, JSON adapters | not started (import takes `string[][]`, so a Sheets API pull plugs in directly) |
| 30k benchmark, classification accuracy sample, Notion writeback | not started |

Acceptance tests covered so far: 1, 2, 3, 4, 5, 6, 14, 15 (against the in-memory repo only).
