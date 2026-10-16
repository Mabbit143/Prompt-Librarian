-- Prompt & Idea Librarian: initial schema. Run transactionally (supabase db push wraps each file).
-- NOT yet executed against a live database; see docs/STATUS.md.
create extension if not exists vector;
create extension if not exists pg_trgm;

create table users (
  id uuid primary key references auth.users on delete cascade,
  created_at timestamptz not null default now(),
  settings jsonb not null default '{"ai_budget_usd":5,"ai_warn_usd":3,"auto_file_min_confidence":0.85,"auto_file_enabled":false}'
);

create table sources (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references users(id) on delete cascade,
  source_type text not null check (source_type in ('internal','notion','gsheets','obsidian','csv','json','markdown')),
  external_id text, name text not null,
  connection_status text not null default 'disconnected',
  permission_level text not null default 'read' check (permission_level in ('read','write')),
  last_sync_at timestamptz, cursor jsonb, created_at timestamptz not null default now(),
  unique (owner_id, source_type, external_id)
);

create table categories (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references users(id) on delete cascade,
  name text not null, parent_id uuid references categories(id), description text, active boolean not null default true,
  unique (owner_id, name)
);

create table records (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references users(id) on delete cascade,
  source_id uuid references sources(id),
  canonical_record_id uuid references records(id),
  original_title text, original_content text not null, suggested_title text,
  content_hash text not null,
  record_type text, primary_category_id uuid references categories(id),
  metadata_json jsonb not null default '{}',
  filing_status text not null default 'inbox' check (filing_status in ('inbox','filed','needs_review')),
  classification_version text,
  search tsvector generated always as (
    setweight(to_tsvector('english', coalesce(suggested_title, original_title, '')), 'A') ||
    setweight(to_tsvector('english', left(original_content, 200000)), 'B')) stored,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deleted_at timestamptz
);
-- One canonical record per owner per normalized content; exact dupes become occurrences.
create unique index records_owner_hash_uq on records (owner_id, content_hash) where deleted_at is null and canonical_record_id is null;
create index records_search_gin on records using gin (search);
create index records_title_trgm on records using gin (coalesce(suggested_title, original_title) gin_trgm_ops);
create index records_browse on records (owner_id, filing_status, primary_category_id, created_at desc) where deleted_at is null;

create table source_snapshots (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references sources(id) on delete cascade,
  external_record_id text not null, content_hash text not null, snapshot_location text,
  version text, created_at timestamptz not null default now(),
  unique (source_id, external_record_id, content_hash)
);

create table record_occurrences (
  id uuid primary key default gen_random_uuid(),
  record_id uuid not null references records(id) on delete cascade,
  source_id uuid not null references sources(id),
  external_record_id text, source_path text, source_url text, source_version text, source_anchor text,
  original_snapshot_id uuid references source_snapshots(id),
  first_seen_at timestamptz not null default now(), last_seen_at timestamptz not null default now(),
  unique (source_id, external_record_id, source_anchor)
);
create index occ_record on record_occurrences (record_id);

create table tags (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references users(id) on delete cascade,
  name text not null, normalized_name text not null, unique (owner_id, normalized_name)
);
create table record_tags (
  record_id uuid references records(id) on delete cascade, tag_id uuid references tags(id) on delete cascade,
  primary key (record_id, tag_id)
);

create table record_embeddings (
  record_id uuid primary key references records(id) on delete cascade,
  embedding_model text not null, embedding_dimensions int not null, content_hash text not null,
  vector vector(1536) not null, updated_at timestamptz not null default now()
);
create index emb_hnsw on record_embeddings using hnsw (vector vector_cosine_ops);

create table record_relationships (
  id uuid primary key default gen_random_uuid(),
  record_a_id uuid not null references records(id) on delete cascade,
  record_b_id uuid not null references records(id) on delete cascade,
  relationship_type text not null check (relationship_type in ('exact_duplicate','near_duplicate','related','revision_of','expands_on','references','belongs_to_project')),
  similarity_score real, detection_method text, review_status text not null default 'pending',
  check (record_a_id <> record_b_id),
  unique (record_a_id, record_b_id, relationship_type)
);

create table review_items (
  id uuid primary key default gen_random_uuid(),
  record_id uuid not null references records(id) on delete cascade,
  proposal_type text not null, proposed_change_json jsonb, original_value_json jsonb,
  confidence real, reason text, status text not null default 'pending',
  created_at timestamptz not null default now(), reviewed_at timestamptz
);

create table import_jobs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references users(id) on delete cascade, source_id uuid references sources(id),
  job_type text not null, status text not null default 'queued',
  idempotency_key text not null, checkpoint jsonb, attempts int not null default 0,
  created_at timestamptz not null default now(), unique (owner_id, idempotency_key)
);
create table sync_runs (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references sources(id) on delete cascade, status text not null,
  started_at timestamptz not null default now(), finished_at timestamptz, checkpoint_json jsonb,
  records_scanned int default 0, records_added int default 0, records_updated int default 0, records_skipped int default 0, errors_json jsonb
);

create table change_log (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references users(id) on delete cascade, record_id uuid,
  operation text not null, before_json jsonb, after_json jsonb, actor text not null, timestamp timestamptz not null default now()
);
create table ai_usage (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references users(id) on delete cascade, job_id uuid,
  operation text not null, model text not null, input_tokens int, output_tokens int,
  estimated_cost_usd numeric(10,6) not null, created_at timestamptz not null default now()
);
create index ai_usage_month on ai_usage (owner_id, created_at);

-- Snapshots are immutable.
create function forbid_mutation() returns trigger language plpgsql as $$ begin raise exception 'immutable table'; end $$;
create trigger snapshots_immutable before update or delete on source_snapshots for each row execute function forbid_mutation();

-- RLS: every table owned directly or through its parent.
do $$ declare t text; begin
  foreach t in array array['users','sources','categories','records','source_snapshots','record_occurrences','tags','record_tags','record_embeddings','record_relationships','review_items','import_jobs','sync_runs','change_log','ai_usage'] loop
    execute format('alter table %I enable row level security', t);
  end loop;
end $$;
create policy own_users on users using (id = auth.uid()) with check (id = auth.uid());
do $$ declare t text; begin
  foreach t in array array['sources','categories','records','tags','import_jobs','change_log','ai_usage'] loop
    execute format('create policy own_%1$s on %1$I using (owner_id = auth.uid()) with check (owner_id = auth.uid())', t);
  end loop;
end $$;
create policy own_snapshots on source_snapshots using (exists (select 1 from sources s where s.id = source_id and s.owner_id = auth.uid()));
create policy own_sync_runs on sync_runs using (exists (select 1 from sources s where s.id = source_id and s.owner_id = auth.uid()));
create policy own_occ on record_occurrences using (exists (select 1 from records r where r.id = record_id and r.owner_id = auth.uid()));
create policy own_rtags on record_tags using (exists (select 1 from records r where r.id = record_id and r.owner_id = auth.uid()));
create policy own_emb on record_embeddings using (exists (select 1 from records r where r.id = record_id and r.owner_id = auth.uid()));
create policy own_rev on review_items using (exists (select 1 from records r where r.id = record_id and r.owner_id = auth.uid()));
create policy own_rel on record_relationships using (exists (select 1 from records r where r.id = record_a_id and r.owner_id = auth.uid()) and exists (select 1 from records r where r.id = record_b_id and r.owner_id = auth.uid()));
