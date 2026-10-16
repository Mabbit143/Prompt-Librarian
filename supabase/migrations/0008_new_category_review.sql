-- Adds the new_category proposal type to decide_review (approve creates the category and files the record).
-- Review queue decisions. SECURITY INVOKER: RLS limits every read/write to the caller's own rows.
-- One transaction per decision: apply the change, close the review item, write an audit row.
-- Decisions are internal metadata edits only; nothing here writes back to any source platform.
create or replace function decide_review(p_id uuid, p_decision text, p_change jsonb default '{}')
returns jsonb language plpgsql as $$
declare
  v_item review_items; v_rec records; v_cat uuid; v_change jsonb; v_status text;
  v_before jsonb; v_after jsonb; v_type text; v_a uuid; v_b uuid; v_old_type text;
begin
  if p_decision not in ('approve', 'reject', 'edit') then raise exception 'invalid_decision'; end if;
  select * into v_item from review_items where id = p_id for update;
  if not found then raise exception 'not_found'; end if;
  if v_item.status <> 'pending' then raise exception 'already_decided'; end if;
  select * into v_rec from records where id = v_item.record_id for update;
  if not found then raise exception 'not_found'; end if;

  if v_item.proposal_type in ('uncertain_classification', 'new_category') then
    if p_decision = 'reject' then
      v_status := 'rejected';
    else
      v_change := case p_decision when 'approve' then v_item.proposed_change_json else p_change end;
      if v_item.proposal_type = 'new_category' and p_decision = 'approve' then
        -- A human approved the model's proposed name: only now does it become a real category.
        if length(btrim(coalesce(v_change ->> 'proposed_category', ''))) not between 1 and 60 then raise exception 'nothing_to_apply'; end if;
        insert into categories (owner_id, name) values (v_rec.owner_id, btrim(v_change ->> 'proposed_category'))
          on conflict (owner_id, name) do nothing;
        select id into v_cat from categories where owner_id = v_rec.owner_id and name = btrim(v_change ->> 'proposed_category');
      else
        if v_change is null or (v_change ->> 'category') is null then raise exception 'nothing_to_apply'; end if;
        select id into v_cat from categories where owner_id = v_rec.owner_id and name = v_change ->> 'category';
      end if;
      if v_cat is null then raise exception 'unknown_category'; end if;
      v_before := jsonb_build_object('filing_status', v_rec.filing_status, 'category_id', v_rec.primary_category_id,
                                     'record_type', v_rec.record_type, 'suggested_title', v_rec.suggested_title);
      update records set primary_category_id = v_cat, record_type = coalesce(v_change ->> 'record_type', record_type),
        suggested_title = coalesce(v_change ->> 'title', suggested_title), filing_status = 'filed', updated_at = now()
        where id = v_rec.id returning jsonb_build_object('filing_status', filing_status, 'category_id', primary_category_id,
                                     'record_type', record_type, 'suggested_title', suggested_title) into v_after;
      v_status := case p_decision when 'approve' then 'approved' else 'edited' end;
    end if;

  elsif v_item.proposal_type = 'potential_duplicate' then
    v_a := (v_item.proposed_change_json ->> 'record_a_id')::uuid;
    v_b := (v_item.proposed_change_json ->> 'record_b_id')::uuid;
    v_old_type := v_item.proposed_change_json ->> 'relationship_type';
    if p_decision = 'reject' then
      -- "keep separate": the link stays on file but is dismissed. Records are never merged.
      update record_relationships set review_status = 'dismissed'
        where record_a_id = v_a and record_b_id = v_b and relationship_type = v_old_type;
      v_status := 'rejected';
    else
      v_type := coalesce(p_change ->> 'relationship_type', v_old_type);
      if p_decision = 'edit' and p_change ->> 'relationship_type' is null then raise exception 'nothing_to_apply'; end if;
      update record_relationships set relationship_type = v_type, review_status = 'confirmed'
        where record_a_id = v_a and record_b_id = v_b and relationship_type = v_old_type;
      if not found then raise exception 'not_found'; end if;
      v_before := jsonb_build_object('relationship_type', v_old_type, 'review_status', 'pending');
      v_after := jsonb_build_object('relationship_type', v_type, 'review_status', 'confirmed');
      v_status := case p_decision when 'approve' then 'approved' else 'edited' end;
    end if;
  else
    raise exception 'unsupported_proposal';
  end if;

  update review_items set status = v_status, reviewed_at = now() where id = p_id;
  insert into change_log (owner_id, record_id, operation, before_json, after_json, actor)
    values (v_rec.owner_id, v_rec.id, 'review_' || v_item.proposal_type || '_' || p_decision, v_before, v_after, 'user');
  return jsonb_build_object('status', v_status, 'record_id', v_rec.id, 'writeback', false);
end $$;

