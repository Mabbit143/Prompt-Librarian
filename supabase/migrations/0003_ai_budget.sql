-- Persistent AI budget: reservations and settlements live in ai_usage, serialized per owner.
-- Clients may read usage but never write it directly; only these SECURITY DEFINER functions do.
alter table ai_usage
  add column status text not null default 'settled' check (status in ('reserved', 'settled')),
  add column settled_at timestamptz;

drop policy own_ai_usage on ai_usage;
create policy read_own_ai_usage on ai_usage for select using (owner_id = auth.uid());

create function reserve_ai_budget(p_estimate numeric, p_operation text, p_model text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_owner uuid := auth.uid(); v_cap numeric; v_spent numeric; v_id uuid;
begin
  if v_owner is null then raise exception 'unauthenticated'; end if;
  perform pg_advisory_xact_lock(hashtext(v_owner::text));
  select coalesce((settings ->> 'ai_budget_usd')::numeric, 5) into v_cap from users where id = v_owner;
  -- Unsettled reservations count for 15 minutes so a crashed job cannot block the budget forever.
  select coalesce(sum(estimated_cost_usd), 0) into v_spent from ai_usage
    where owner_id = v_owner and created_at >= date_trunc('month', now())
      and (status = 'settled' or created_at > now() - interval '15 minutes');
  if v_spent + p_estimate > coalesce(v_cap, 5) then raise exception 'budget_exceeded'; end if;
  insert into ai_usage (owner_id, operation, model, estimated_cost_usd, status)
    values (v_owner, p_operation, p_model, p_estimate, 'reserved') returning id into v_id;
  return v_id;
end $$;

create function settle_ai_usage(p_id uuid, p_input int, p_output int, p_cost numeric)
returns void language sql security definer set search_path = public as $$
  update ai_usage set status = 'settled', input_tokens = p_input, output_tokens = p_output,
    estimated_cost_usd = p_cost, settled_at = now()
  where id = p_id and owner_id = auth.uid() and status = 'reserved'
$$;

create function release_ai_usage(p_id uuid)
returns void language sql security definer set search_path = public as $$
  delete from ai_usage where id = p_id and owner_id = auth.uid() and status = 'reserved'
$$;

revoke execute on function reserve_ai_budget, settle_ai_usage, release_ai_usage from public, anon;
grant execute on function reserve_ai_budget, settle_ai_usage, release_ai_usage to authenticated;
