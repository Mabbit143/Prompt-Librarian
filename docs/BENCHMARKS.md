# Benchmarks (2026-10-15)

**Environment:** Windows 11 Pro 10.0.26220, AMD Ryzen 5 7535U (12 threads), 15 GB RAM. PostgreSQL 17.11 in local Supabase on Docker Desktop with default settings (`shared_buffers` 128 MB), sharing the machine with other running containers and apps. Client and server on the same host. Not a production-like environment.

**Method:** `scripts/bench.ts`. 20 warm-up then 200 timed calls per query, sequential, through PostgREST as an RLS-scoped signed-in user (so numbers include HTTP and auth, not just SQL). Keyword queries are 100 random 1-word, 2-word and quoted-phrase terms taken from record titles. `search_records` uses `websearch_to_tsquery` + `ts_rank_cd` over a stored `tsvector` (title weight A, content B) with a GIN index.

**Data:** the 2026-10-12 CSV export of the Prompt Library (19,795 rows, imported in 20.5 s through the real importer, no AI calls). The 30,000 and 100,000 runs add **synthetic** rows: copies of real rows with a random suffix on the text. This makes word frequencies far more repetitive than real data, so match counts per query (and ranking cost) are inflated at 100k. Synthetic rows were deleted afterwards.

| Query (ms) | 19,795 real: p50 / p95 | 30,000: p50 / p95 | 100,000: p50 / p95 |
|---|---|---|---|
| Keyword search, top 20 | 140 / 170 | 199 / 241 | 655 / **831** |
| Keyword search + category filter | 28 / 47 | 32 / 53 | 71 / 253 |
| Filtered browse (category + status, newest 20) | 24 / 53 | 31 / 75 | 68 / 254 |
| Filtered browse, page 6 | 26 / 43 | 31 / 66 | 67 / 248 |
| Record detail with occurrences | 15 / 17 | 16 / 17 | 15 / 17 |

**Against the target (p95 < 500 ms):** met at 19.8k and 30k for every query. At 100k, unfiltered keyword search misses (831 ms) in this environment; the rest pass. Table plus indexes at 100k: 194 MB.

**Not measured:** concurrent users, semantic (pgvector) search, near-duplicate prefilter at scale, hosted Supabase, cold cache after restart, search over the Purpose/Tags/Search Terms columns (they are stored in `metadata_json` and not indexed).

**Likely fixes for the 100k miss (untested):** rank only a bounded candidate set instead of every match, raise `shared_buffers` to fit the table, index a lighter tsvector (title + first N characters), or cache common queries.
