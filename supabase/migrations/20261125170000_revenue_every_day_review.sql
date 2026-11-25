-- v2.5 "Revenue every day", the review's fixes (database):
--   * billing_mark_unbilled: the Revenue page's "Mark all N billed" marks only the lines still not
--     billed. billing_mark overwrites a line's day and note, so a page left open could re-mark a line
--     the Owner had billed elsewhere since; this one leaves a billed line exactly as it is and counts
--     only the lines it changed. The same checks as billing_mark (finance.edit, the caller's org, at
--     most 200, no day in the future, NOT_FOUND when an id is not the caller's).
--   * project_billing_history: the five money tables' rows are found branch by branch, each by its
--     own list of ids (UNION ALL), so activity_log_entity_idx (entity, entity_id, at desc) serves each
--     branch. The OR'ed filter of v2.5 read every money row of the organisation (EXPLAIN on volume,
--     ~25k other rows: ~600 ms, 59k buffers). Same signature, grants, rows and order.
--   * project_billing_read: a retainer cycle's deliverables are valued once (one CTE over
--     app.item_values feeding both "items" and "added"). Same signature, grants and output keys.
-- Money stays the Owner's alone (invariant 2): each function is FORBIDDEN without finance.view /
-- finance.edit. EXPAND-ONLY: one new function; two functions re-created with the same signatures and
-- grants. Append-only: never edit once applied.

-- "Mark all N billed": Billed on a day (default today IST), only where the line is not billed yet.
create function public.billing_mark_unbilled(cycle_ids uuid[], billed_on date)
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
  if cardinality(v_ids) > 200 then
    perform app.fail('VALIDATION', 'Mark at most 200 at a time.');
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
revoke all on function public.billing_mark_unbilled(uuid[], date) from public, anon;
grant execute on function public.billing_mark_unbilled(uuid[], date) to authenticated, service_role;
comment on function public.billing_mark_unbilled(uuid[], date) is
  'v2.5 (finance.edit; the Revenue page''s "Mark all N billed"): Billed on a day (default today IST, never later) for the cycles given that are not billed yet; a billed one keeps its day and note. Returns how many it changed.';

-- The Owner's Billing history of one project (Q7), each money table by its own ids.
create or replace function public.project_billing_history(project_id uuid, limit_count integer default 50)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_project public.projects;
  v_limit integer := least(greatest(coalesce(limit_count, 50), 1), 200);
  v_cycles uuid[];
  v_items uuid[];
  v_advances uuid[];
  v_overrides uuid[];
begin
  if not (select app.has_permission('finance.view')) then
    perform app.fail('FORBIDDEN', 'Only the Owner sees billing.');
  end if;
  select p.* into v_project from public.projects p where p.id = project_billing_history.project_id;
  if v_project.id is null then
    perform app.fail('NOT_FOUND', 'This project is not one of yours.');
  end if;
  -- The project's own ids, one list per money table.
  v_cycles := array(select c.id from public.project_cycles c where c.project_id = v_project.id);
  v_items := array(select i.id from public.project_items i where i.project_id = v_project.id);
  v_advances := array(select x.id from public.project_advances x where x.project_id = v_project.id);
  v_overrides := array(
    select o.id from public.revenue_overrides o
    where (o.scope = 'project' and o.ref_id = v_project.id)
       or (o.scope = 'cycle' and o.ref_id = any (v_cycles)));
  return (
    select coalesce(jsonb_agg(to_jsonb(h) order by h.at desc, h.id desc), '[]'::jsonb)
    from (
      select a.id, a.at, a.entity, a.action, m.full_name as actor_name,
             a.diff -> 'old' as old, a.diff -> 'new' as new,
             case a.entity
               when 'cycle_billing' then (select c.label from public.project_cycles c where c.id = a.entity_id)
               when 'item_billing' then (select i.title from public.project_items i where i.id = a.entity_id)
               when 'revenue_overrides' then (
                 select c.label from public.revenue_overrides o
                 join public.project_cycles c on c.id = o.ref_id where o.id = a.entity_id and o.scope = 'cycle')
             end as subject
      from (
        -- Each branch is the newest `v_limit` of one table's rows (the index's order is at desc
        -- within one id), so no branch reads more than it can show.
        (select b.* from public.activity_log b
         where b.entity = 'project_billing' and b.entity_id = v_project.id
         order by b.at desc, b.id desc limit v_limit)
        union all
        (select b.* from public.activity_log b
         where b.entity = 'cycle_billing' and b.entity_id = any (v_cycles)
         order by b.at desc, b.id desc limit v_limit)
        union all
        -- A deliverable's price or value; the bare "added" mark is not a billing change.
        (select b.* from public.activity_log b
         where b.entity = 'item_billing' and b.entity_id = any (v_items)
           and b.action in ('value_set', 'value_cleared')
         order by b.at desc, b.id desc limit v_limit)
        union all
        (select b.* from public.activity_log b
         where b.entity = 'project_advances' and b.entity_id = any (v_advances)
         order by b.at desc, b.id desc limit v_limit)
        union all
        (select b.* from public.activity_log b
         where b.entity = 'revenue_overrides' and b.entity_id = any (v_overrides)
         order by b.at desc, b.id desc limit v_limit)
      ) a
      left join public.members m on m.id = a.actor_id
      where a.org_id = v_project.org_id
      order by a.at desc, a.id desc
      limit v_limit
    ) h);
end;
$$;
comment on function public.project_billing_history(uuid, integer) is
  'v2.5 (finance.view, security invoker; Q7): the Owner''s Billing history of one project: the money tables'' audit rows (amounts, values, advances, adjustments, billed), newest first, at most 200. Each table''s rows are found by the project''s own ids (activity_log_entity_idx).';

create or replace function public.project_billing_read(project_id uuid, cycle_id uuid default null)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_project public.projects;
  v_cycle_id uuid;
  v_out jsonb;
begin
  if not (select app.has_permission('finance.view')) then
    perform app.fail('FORBIDDEN', 'Only the Owner sees billing.');
  end if;
  select p.* into v_project from public.projects p where p.id = project_billing_read.project_id;
  if v_project.id is null then
    perform app.fail('NOT_FOUND', 'This project is not one of yours.');
  end if;

  v_out := jsonb_build_object(
    'project_id', v_project.id,
    'recurrence', v_project.recurrence,
    'billing', (
      select jsonb_build_object(
        'category', coalesce(b.billing_category::text,
          case when v_project.recurrence = 'one_time' then 'project' else 'retainer' end),
        'category_is_default', b.billing_category is null,
        'cycle_amount', b.cycle_amount,
        'fixed_amount', b.fixed_amount,
        'priced_from', b.priced_from)
      from (select 1) one
      left join public.project_billing b on b.project_id = v_project.id));

  if v_project.recurrence = 'one_time' then
    return v_out || jsonb_build_object(
      'line', (
        select jsonb_build_object(
          'month', l.month, 'amount', l.amount, 'potential', l.potential, 'achieved', l.achieved,
          'closed_not_achieved', l.closed_not_achieved, 'was_due', l.was_due,
          'ready_to_complete', l.ready_to_complete, 'state', l.state, 'delivery_date', l.delivery_date,
          'advances_kept', l.advances_kept, 'advances_returned', l.advances_returned,
          'cycle_id', l.cycle_id, 'achieved_calculated', l.achieved_calculated,
          'billing_status', l.billing_status, 'billed_on', l.billed_on, 'billing_note', l.billing_note,
          'override', (select jsonb_build_object('adjusted_value', o.adjusted_value, 'calculated_value', o.calculated_value,
                                                  'note', o.note, 'at', o.at)
                       from public.revenue_overrides o where o.id = l.override_id))
        from public.revenue_project_lines_v l where l.project_id = v_project.id),
      'advances', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'id', a.id, 'amount', a.amount, 'received_on', a.received_on, 'note', a.note,
          'returned_on', a.returned_on, 'return_note', a.return_note)
          order by a.received_on, a.recorded_at), '[]'::jsonb)
        from public.project_advances a where a.project_id = v_project.id));
  end if;

  -- A retainer: the cycle asked for (when it is this project's), else nothing cycle-shaped.
  select c.id into v_cycle_id from public.project_cycles c
  where c.id = project_billing_read.cycle_id and c.project_id = v_project.id;
  return v_out || (
    -- The cycle's deliverables, valued once for both lists (a CTE used twice is materialised).
    with v as materialized (
      select x.* from app.item_values(array[v_cycle_id]) x where v_cycle_id is not null
    )
    select jsonb_build_object(
      'cycle', (
        select jsonb_build_object(
          'cycle_id', c.cycle_id, 'label', c.label, 'month', c.month, 'amount', c.amount,
          'potential', c.potential, 'achieved', c.achieved, 'remaining', c.remaining,
          'closed_not_achieved', c.closed_not_achieved, 'added_value', c.added_value,
          'added_count', c.added_count, 'not_priced_count', c.not_priced_count, 'plan_count', c.plan_count,
          'achieved_calculated', c.achieved_calculated,
          'billing_status', c.billing_status, 'billed_on', c.billed_on, 'billing_note', c.billing_note,
          'override', (select jsonb_build_object('adjusted_value', o.adjusted_value, 'calculated_value', o.calculated_value,
                                                  'note', o.note, 'at', o.at)
                       from public.revenue_overrides o where o.id = c.override_id))
        from app.revenue_cycles(array[v_cycle_id]) c where v_cycle_id is not null),
      -- v2.5: the cycle's plan deliverables with their values (the Owner's own value, or the even share).
      'items', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'item_id', v.item_id, 'title', v.title, 'method', v.method, 'value', v.value,
          'achieved', v.achieved, 'closed', v.closed_not_achieved)
          order by v."position" collate "C", v.item_id), '[]'::jsonb)
        from v where v.kind = 'plan'),
      'added', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'item_id', v.item_id, 'title', v.title, 'method', v.method, 'value', v.value,
          'achieved', v.achieved, 'closed', v.closed_not_achieved)
          order by v."position" collate "C", v.item_id), '[]'::jsonb)
        from v where v.kind = 'added' and v.in_potential)));
end;
$$;
