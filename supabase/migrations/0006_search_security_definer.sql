-- Under RLS the planner cannot push `search @@ tsquery` into the GIN index (ts_match_vq is not leakproof),
-- so search_records seq-scanned every row. Run it as definer with an explicit owner filter instead.
create or replace function search_records(
  p_query text, p_category_id uuid default null, p_status text default null,
  p_limit int default 20, p_offset int default 0)
returns table (id uuid, title text, category_id uuid, filing_status text, rank real, snippet text)
language sql stable security definer set search_path = public as $$
  select r.id, coalesce(r.suggested_title, r.original_title), r.primary_category_id, r.filing_status,
         ts_rank_cd(r.search, q.tsq), left(r.original_content, 200)
  from records r, websearch_to_tsquery('english', p_query) q(tsq)
  where r.owner_id = auth.uid() and r.deleted_at is null and r.search @@ q.tsq
    and (p_category_id is null or r.primary_category_id = p_category_id)
    and (p_status is null or r.filing_status = p_status)
  order by 5 desc, r.id
  limit least(p_limit, 100) offset p_offset
$$;
revoke execute on function search_records from public, anon;
grant execute on function search_records to authenticated;
