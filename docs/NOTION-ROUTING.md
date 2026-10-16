# Notion destination routing and write preview

Status 2026-10-16: inspection done (read-only), routing and preview built and tested as pure code. **No Notion write path exists and nothing was written.** Counts below were read via search, fetch and single-source SQL queries.

## What the live workspace contains

| Database | Data source | Rows | Notes |
|---|---|---|---|
| Prompt Engineering Dashboard | `4b40e2ad-27a1-8332-a2a8-07b66128a21c` | 20,051 | The Notion copy of the cleaned Prompt Library sheet: same 33 columns (Library ID, Record Type, Category, Subcategory, Output Type, Prompt..Prompt 6, Source IDs/Locator/URL, Occurrence Count, Review, Use Status), same 35 Output Types and 106 Subcategories. IDs: 6,373 `NTN-`, 13,675 `STG-`. Category counts match the sheet; 22 distinct values, 3 stray single-row options (Research, Content Creation, Code Generation). Full schema captured in `config/notion-snapshots/`. |
| Research Prompt Library | `e55be9c7-37b1-4dbe-9343-77a3a7603d1f` | 998 | Older library: title `Name`, Category uses a different scheme ("Writing & Content"), has Prompt Family ("Content Marketing"). Not used as a destination. |
| DA Idea Bank | `4d6633d9-fdec-46ac-9ae6-92fc2a7f56da` | 103 | Title `Idea`; Category means content form (Core Content 38, Series Post 31, Hook Template 20, Pinterest Board 10, Long-form Article 5, Research 3, Admin / Reference 2, App / Tool 1); also Pillar, Editorial Series, Format, Idea Type, Emotional Trigger, Hook Function, Template Text, Production Items. Property types and options not yet captured in full. |
| Ideas | `c190e2ad-27a1-83c0-9aa0-8796f95e533e` | 4 | Title `Name`, Status (status type), Favorite, Projects relation. A second database, "Ideas Box", also exists. |
| Content Planning Kanban | not inspected | n/a | Downstream only. |

Limits met: the multi-source SQL query needs a Notion Business plan and was refused; single-source queries work. Large schema fetches exceed the tool output limit, so schemas are captured through the saved result file (`scripts/make-notion-snapshot.cjs`).

## Findings that change the plan

1. **Our 19 categories are the Notion dashboard's categories.** The prompt destination already speaks our taxonomy, which is why mapping is mostly one-to-one. Approved new categories (migration 0008) would need a matching Notion option; the layer blocks such records instead of creating options.
2. **`Library ID` is a stable identity key** (`NTN-`/`STG-`). New records need an ID in a non-colliding scheme. Proposed: `LIBR-` + 10 hex characters of the record UUID (`libraryIdPrefix` in config). Unconfirmed.
3. **Templates are Prompts with Output Type "Template"** in Notion; Record Type has no Template or Research Note option.
4. **Rich text is capped at 2,000 characters per block**, which is why the sheet has Prompt..Prompt 6. The layer splits across those six and blocks anything over 12,000 characters (overflow to page body is not built).
5. **89 existing Idea rows live in the prompt library**, but `organize-notion-ideas` says ideas go to the Ideas inbox or the DA bank. The router follows the skill for new ideas.

## Design

Records flow: `filed` Librarian record, then **route**, then **preview**, then (future) **approve**, **write**, **read back**, **rerun check**.

- **Route** (`src/notion/route.ts`): one destination per record by the skill's rules. Reusable prompt types go to the prompt library; an Idea goes to the DA bank only on an explicit signal (topic tag or source path naming Deconstructing Academia), otherwise to the Ideas inbox; a reusable prompt that also has a DA signal, or a Mixed/Research Note/Project Concept record, becomes `needs_destination_decision`. Only `filed` records are eligible; Skill Definitions are never mirrored.
- **Preview** (`src/notion/preview.ts`): pure function with no Notion client, so it cannot write. Each record gets exactly one outcome: `create`, `skip_exists`, `needs_destination_decision`, `blocked` (with the reason), or `not_eligible`. A write is blocked unless the destination is user-confirmed, the schema snapshot is verified and under an hour old, a read-only existence lookup answered (an unsure answer blocks), and the payload validates against the live options.
- **Mapping** (`src/notion/mapping.ts`): select values are never auto-created. Category and Record Type must match an option or the record is blocked; Subcategory, Output Type and Tags that are not options are left out with a warning.
- **Idempotency**: key = destination + Library ID. After creates land, a rerun's lookups return `exists` and the preview proposes zero creates (tested).
- **Read-back**: `verifyReadBack` compares stored property text with the preview item; any mismatch is reported.

Provenance and the original text stay in Postgres; Notion is a mirror (as `organize-notion-ideas` requires). Writes are internal to Notion only; nothing flows back into Postgres from Notion edits yet.

## Write executor (`src/notion/execute.ts`)

Built and tested against an in-memory fake only. **There is no real Notion adapter, so nothing in this repository can write to Notion.** To go live someone must implement the two-method `NotionWriter` interface and turn on `writesEnabled`.

Gates, all required for a live run: `dryRun:false` (default is dry run), `writesEnabled:true` (kill switch), an approval whose digest equals the digest of exactly this preview (any change to a payload invalidates it), preview younger than 15 minutes, batch within the limit (default 10, hard cap 50), every destination confirmed. Per item: ledger check, fresh read-only existence check (an unsure answer stops the batch), rate-limited create (350 ms spacing, about 3 per second), read-back comparison. First failure, mismatch or unsure check stops the batch; creates are never retried blindly, and a create that errored after landing is found by the next run's existence check instead of duplicated. `rerunCheck` confirms a fresh preview proposes nothing for what was written.

## Decisions needed from you

1. ~~Confirm `prompt_library` = Prompt Engineering Dashboard as the destination.~~ Confirmed by the user 2026-10-16 (`confirmed: true`; DA Idea Bank and Ideas stay `false`). Confirming it does not enable writes: there is no executor.
2. ~~Confirm the `LIBR-` Library ID scheme.~~ Confirmed 2026-10-16.
3. Pick the general ideas inbox: "Ideas" or "Ideas Box".
4. Decide whether the 89 Idea rows already in the dashboard stay there.
5. Allow new Notion select options (default: no) or keep blocking unknown values.

## Not built (needed before any write)

- A real `NotionWriter` adapter (not written, on purpose) and a persistent write ledger (the in-memory one forgets on restart, so a restart falls back to the existence check alone).
- An approval screen in the Review UI that shows the exact preview and produces the digest.
- Live existence lookup (`NotionIndex`) by Library ID and text hash.
- Schema snapshots and mappings for the DA Idea Bank and Ideas inbox (their types and options must be fetched untruncated).
- Persisting preview, approval and sync results (`sync_runs`) and a Review-queue item type for `needs_destination_decision`.
- Overflow of prompts over 12,000 characters to the page body.
