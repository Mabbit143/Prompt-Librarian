-- Prefilter for near-duplicate detection. SECURITY INVOKER (default) so RLS limits it to the caller's records.
create index records_content_trgm on records using gin (left(original_content, 1000) gin_trgm_ops);

create function near_candidates(p_text text, p_limit int default 20)
returns table (id uuid, original_content text, score real)
language sql stable as $$
  select r.id, r.original_content, similarity(left(r.original_content, 1000), left(p_text, 1000))
  from records r
  where r.deleted_at is null and left(r.original_content, 1000) % left(p_text, 1000)
  order by 3 desc limit p_limit
$$;
