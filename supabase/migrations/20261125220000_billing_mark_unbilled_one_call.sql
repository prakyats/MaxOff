-- v2.5, from the advisor's review of f847ce9: "Mark all N billed" is ONE transaction. The screen sent the
-- month's lines in batches of 200 (the function's cap), each its own transaction, so a refusal in a later
-- batch left the earlier ones billed while the Owner saw only the error. The cap rises to 2,000 (far
-- above any month) and the screen sends the whole list in one call: all marked, or none.
-- EXPAND-ONLY: one function re-created with the same signature and grants. Append-only.

create or replace function public.billing_mark_unbilled(cycle_ids uuid[], billed_on date)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller public.members;
  v_ids uuid[];
  v_on date := coalesce(billed_on, app.today_ist());
  v_cycle public.project_cycles;
  v_found integer := 0;
  v_count integer := 0;
  v_rows integer;
begin
  v_caller := app.client_work_caller('finance.edit', 'Only the Owner sets billing.');
  select array_agg(distinct x order by x) into v_ids from unnest(cycle_ids) x where x is not null;
  if v_ids is null then
    perform app.fail('VALIDATION', 'Nothing to mark.');
  end if;
  if cardinality(v_ids) > 2000 then
    perform app.fail('VALIDATION', 'Mark at most 2,000 at a time.');
  end if;
  if v_on > app.today_ist() then
    perform app.fail('VALIDATION', 'The billed date can''t be in the future.');
  end if;
  for v_cycle in
    select c.* from public.project_cycles c where c.id = any (v_ids) and c.org_id = v_caller.org_id order by c.id
  loop
    v_found := v_found + 1;
    perform set_config('app.audit_override', jsonb_build_object('action', 'billed')::text, true);
    -- A line billed already (on another screen, since this page was drawn) is left as it is: its
    -- day, its note and its history. The row lock of ON CONFLICT makes two of these at once safe.
    insert into public.cycle_billing (cycle_id, org_id, project_id, billing_status, billed_on, note)
    values (v_cycle.id, v_cycle.org_id, v_cycle.project_id, 'billed', v_on, null)
    on conflict on constraint cycle_billing_pkey do update
    set billing_status = excluded.billing_status, billed_on = excluded.billed_on, note = null
    where public.cycle_billing.billing_status <> 'billed';
    get diagnostics v_rows = row_count;
    v_count := v_count + v_rows;
  end loop;
  perform set_config('app.audit_override', '', true);
  if v_found <> cardinality(v_ids) then
    perform app.fail('NOT_FOUND', 'One of these cycles is not yours.');
  end if;
  return v_count;
end;
$$;
comment on function public.billing_mark_unbilled(uuid[], date) is
  'v2.5 (finance.edit; the Revenue page''s "Mark all N billed"): Billed on a day (default today IST, never later) for the cycles given that are not billed yet; a billed one keeps its day and note. Returns how many it changed.';

