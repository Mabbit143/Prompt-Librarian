-- Unindexed foreign keys made deletes on records O(n^2) (found while removing 80k benchmark rows).
create index records_canonical_idx on records (canonical_record_id) where canonical_record_id is not null;
create index records_source_idx on records (source_id);
create index rel_a_idx on record_relationships (record_a_id);
create index rel_b_idx on record_relationships (record_b_id);
create index review_record_idx on review_items (record_id);
