-- Ranked keyword/phrase search with optional filters. SECURITY INVOKER: RLS limits it to the caller's records.
create function search_records(
  p_query text, p_category_id uuid default null, p_status text default null,
  p_limit int default 20, p_offset int default 0)
returns table (id uuid, title text, category_id uuid, filing_status text, rank real, snippet text)
language sql stable as $$
  select r.id, coalesce(r.suggested_title, r.original_title), r.primary_category_id, r.filing_status,
         ts_rank_cd(r.search, q.tsq), left(r.original_content, 200)
  from records r, websearch_to_tsquery('english', p_query) q(tsq)
  where r.deleted_at is null and r.search @@ q.tsq
    and (p_category_id is null or r.primary_category_id = p_category_id)
    and (p_status is null or r.filing_status = p_status)
  order by 5 desc, r.id
  limit least(p_limit, 100) offset p_offset
$$;
