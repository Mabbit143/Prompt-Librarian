-- psql -v target=100000 -v email=... : tops the owner's records up to :target with SYNTHETIC copies (metadata_json.synthetic).
select id as owner from auth.users where email = :'email' \gset
select count(*) as have from records where owner_id = :'owner' \gset
select greatest(:target - :have, 0) as need \gset
insert into records (owner_id, source_id, original_title, original_content, content_hash, record_type, primary_category_id, filing_status, metadata_json)
select r.owner_id, r.source_id, r.original_title, r.original_content || ' ' || md5(random()::text || g::text),
       md5(random()::text || g::text || r.id::text), r.record_type, r.primary_category_id, r.filing_status, '{"synthetic":true}'
from (select * from records where owner_id = :'owner' and not (metadata_json ? 'synthetic') order by id) r
cross join generate_series(1, ceil(:need / 19795.0)::int) g
limit :need;
analyze records;
