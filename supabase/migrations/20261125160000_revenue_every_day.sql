-- v2.5 "Revenue every day" (release plan; kickoff 9 R3, R5, Q3, Q7 and decisions 4, 6, 7): the database step.
--   * Q3: the Owner is notified when a deliverable is added to a retainer cycle that has an amount (it is
--     "Not priced" in a priced month). A new kind, in-app and push, never email, never an amount, only the
--     Owner. Raised by the plan-or-added trigger, which is re-created with that one addition.
--   * Q7: project_billing_history, the Owner's Billing history of one project (the money tables' own audit
--     rows: who, when, what, the old and new figures). Owner only.
--   * R5: revenue_month_totals, the four figures of the Owner's Today line. Owner only.
--   * The Billing section's and the Revenue page's reads gain what the v2.5 screens show: the billing
--     status, the Owner's adjustment beside the calculated figure, and a cycle's plan deliverables with
--     their values. New keys only: the v2.1 screens ignore them.
-- Money stays the Owner's alone (invariant 2): every read is FORBIDDEN without finance.view, and the
-- notification goes to the Owner alone with no amount in its title, body or payload.
-- EXPAND-ONLY: one notification kind, two new functions, three functions re-created with the same
-- signatures and grants. Append-only: never edit once applied.

insert into public.notification_kinds (kind, actionable, always_email, in_app, description) values
  ('deliverable_not_priced', false, false, true,
   'A deliverable was added to a retainer cycle that has an amount, so it is not priced (the Owner; never an amount)');

create or replace function app.item_billing_mark_added()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_stack text;
  v_amount numeric;
  v_project public.projects;
  v_label text;
begin
  if new.carried_from_item_id is not null then
    return null;
  end if;
  if (select p.recurrence from public.projects p where p.id = new.project_id) = 'one_time' then
    return null;
  end if;
  get diagnostics v_stack = pg_context;
  -- The names only: the words around them follow the server's message language (lc_messages).
  if v_stack like '%app.cycle_create(%' or v_stack like '%app.cycle_copy_item_list(%' then
    return null;
  end if;
  insert into public.item_billing (item_id, org_id, added) values (new.id, new.org_id, true)
  on conflict (item_id) do nothing;
  -- v2.5 (kickoff 9 Q3): the Owner is told when the cycle has an amount to bill, so the new deliverable is
  -- "Not priced" in a priced month. Never an amount in the text; nobody else is told; whoever added it is
  -- left out (the Owner adding one himself gets nothing).
  select cb.cycle_amount into v_amount from public.cycle_billing cb where cb.cycle_id = new.cycle_id;
  if v_amount is not null and v_amount > 0 then
    select p.* into v_project from public.projects p where p.id = new.project_id;
    select c.label into v_label from public.project_cycles c where c.id = new.cycle_id;
    perform app.notify(
      array[app.org_owner_id(new.org_id)], 'deliverable_not_priced',
      format('%s: a deliverable isn''t priced', v_project.name),
      format('"%s" was added to %s. Set its price in Billing.', new.title, coalesce(v_label, 'this cycle')),
      app.project_link(v_project) || '?cycle=' || new.cycle_id || '#project-billing',
      'projects', v_project.id,
      jsonb_build_object('item_id', new.id, 'cycle_id', new.cycle_id));
  end if;
  return null;
end;
$$;

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
  return v_out || jsonb_build_object(
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
      from app.item_values(array[v_cycle_id]) v
      where v_cycle_id is not null and v.kind = 'plan'),
    'added', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'item_id', v.item_id, 'title', v.title, 'method', v.method, 'value', v.value,
        'achieved', v.achieved, 'closed', v.closed_not_achieved)
        order by v.position collate "C", v.item_id), '[]'::jsonb)
      from app.item_values(array[v_cycle_id]) v
      where v_cycle_id is not null and v.kind = 'added' and v.in_potential));
end;
$$;

create or replace function public.revenue_month_read(month date default null)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_month date := app.month_start(coalesce(revenue_month_read.month, app.today_ist()));
  v_cycles uuid[];
begin
  if not (select app.has_permission('finance.view')) then
    perform app.fail('FORBIDDEN', 'Only the Owner sees revenue.');
  end if;
  -- The month's retainer cycles, found first so only their deliverables are valued. Never null: a null
  -- list would mean every cycle.
  select coalesce(array_agg(c.id), '{}'::uuid[]) into v_cycles
  from public.project_cycles c
  join public.projects p on p.id = c.project_id and p.recurrence <> 'one_time'
  where c.period_start >= v_month and c.period_start < (v_month + interval '1 month')::date;
  return jsonb_build_object(
    'month', v_month,
    'this_month', app.month_start(app.today_ist()),
    'months', (
      select coalesce(jsonb_agg(m.month order by m.month), '[]'::jsonb)
      from (
        select app.month_start(c.period_start) as month
        from public.project_cycles c
        join public.projects p on p.id = c.project_id and p.recurrence <> 'one_time'
        union
        select l.month from public.revenue_project_lines_v l
      ) m),
    'cycles', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'client_id', c.client_id, 'client_name', cl.name, 'project_id', c.project_id, 'project_name', p.name,
        'cycle_id', c.cycle_id, 'label', c.label, 'category', c.billing_category, 'amount', c.amount,
        'potential', c.potential, 'achieved', c.achieved, 'achieved_calculated', c.achieved_calculated,
        'closed_not_achieved', c.closed_not_achieved, 'remaining', c.remaining,
        'added_value', c.added_value, 'added_count', c.added_count, 'not_priced_count', c.not_priced_count,
        'plan_count', c.plan_count, 'done_count', c.done_count, 'held', c.held,
        'billing_status', c.billing_status, 'billed_on', c.billed_on, 'adjusted', c.override_id is not null)
        order by cl.name, p.name, c.period_start), '[]'::jsonb)
      from app.revenue_cycles(v_cycles) c
      join public.projects p on p.id = c.project_id
      join public.clients cl on cl.id = c.client_id
      ),
    'projects', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'client_id', l.client_id, 'client_name', cl.name, 'project_id', l.project_id, 'project_name', l.name,
        'category', l.billing_category, 'state', l.state, 'delivery_date', l.delivery_date,
        'amount', l.amount, 'potential', l.potential, 'achieved', l.achieved,
        'achieved_calculated', l.achieved_calculated, 'closed_not_achieved', l.closed_not_achieved,
        'was_due', l.was_due, 'ready_to_complete', l.ready_to_complete, 'held', l.held,
        'advances_kept', l.advances_kept, 'cycle_id', l.cycle_id,
        'billing_status', l.billing_status, 'billed_on', l.billed_on, 'adjusted', l.override_id is not null)
        order by cl.name, l.name), '[]'::jsonb)
      from public.revenue_project_lines_v l
      join public.clients cl on cl.id = l.client_id
      where l.month = v_month),
    'advances', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'advance_id', a.advance_id, 'event', a.event, 'on_date', a.on_date, 'amount', a.amount,
        'client_id', a.client_id, 'client_name', cl.name, 'project_id', a.project_id, 'project_name', p.name,
        'returned', a.returned)
        order by a.on_date, a.advance_id), '[]'::jsonb)
      from public.revenue_advances_v a
      join public.projects p on p.id = a.project_id
      join public.clients cl on cl.id = a.client_id
      where a.month = v_month));
end;
$$;

-- The Owner's Billing history of one project (Q7): the money tables' audit rows, newest first.
create function public.project_billing_history(project_id uuid, limit_count integer default 50)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_project public.projects;
begin
  if not (select app.has_permission('finance.view')) then
    perform app.fail('FORBIDDEN', 'Only the Owner sees billing.');
  end if;
  select p.* into v_project from public.projects p where p.id = project_billing_history.project_id;
  if v_project.id is null then
    perform app.fail('NOT_FOUND', 'This project is not one of yours.');
  end if;
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
      from public.activity_log a
      left join public.members m on m.id = a.actor_id
      where a.org_id = v_project.org_id
        and (
          (a.entity = 'project_billing' and a.entity_id = v_project.id)
          or (a.entity = 'cycle_billing' and a.entity_id in (
                select c.id from public.project_cycles c where c.project_id = v_project.id))
          -- A deliverable's price or value; the bare "added" mark is not a billing change.
          or (a.entity = 'item_billing' and a.action in ('value_set', 'value_cleared') and a.entity_id in (
                select i.id from public.project_items i where i.project_id = v_project.id))
          or (a.entity = 'project_advances' and a.entity_id in (
                select x.id from public.project_advances x where x.project_id = v_project.id))
          or (a.entity = 'revenue_overrides' and a.entity_id in (
                select o.id from public.revenue_overrides o
                where (o.scope = 'project' and o.ref_id = v_project.id)
                   or (o.scope = 'cycle' and o.ref_id in (
                         select c.id from public.project_cycles c where c.project_id = v_project.id))))
        )
      order by a.at desc, a.id desc
      limit least(greatest(coalesce(limit_count, 50), 1), 200)
    ) h);
end;
$$;
revoke all on function public.project_billing_history(uuid, integer) from public, anon;
grant execute on function public.project_billing_history(uuid, integer) to authenticated, service_role;
comment on function public.project_billing_history(uuid, integer) is
  'v2.5 (finance.view, security invoker; Q7): the Owner''s Billing history of one project: the money tables'' audit rows (amounts, values, advances, adjustments, billed), newest first, at most 200.';

-- The Owner's Today line (R5): this IST month's four figures and the two counts that need a look.
create function public.revenue_month_totals()
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_month date := app.month_start(app.today_ist());
  v_cycles uuid[];
begin
  if not (select app.has_permission('finance.view')) then
    perform app.fail('FORBIDDEN', 'Only the Owner sees revenue.');
  end if;
  select coalesce(array_agg(c.id), '{}'::uuid[]) into v_cycles
  from public.project_cycles c
  join public.projects p on p.id = c.project_id and p.recurrence <> 'one_time'
  where c.period_start >= v_month and c.period_start < (v_month + interval '1 month')::date;
  return (
    select jsonb_build_object(
      'month', v_month,
      'potential', coalesce(sum(x.potential), 0),
      'achieved', coalesce(sum(x.achieved), 0),
      'remaining', coalesce(sum(greatest(x.potential - x.achieved, 0)), 0),
      'not_priced', coalesce(sum(x.not_priced), 0),
      'no_amount', count(*) filter (where x.amount is null))
    from (
      select c.amount, c.potential, c.achieved, c.not_priced_count as not_priced
      from app.revenue_cycles(v_cycles) c
      union all
      select l.amount, l.potential, l.achieved, 0
      from public.revenue_project_lines_v l where l.month = v_month
    ) x);
end;
$$;
revoke all on function public.revenue_month_totals() from public, anon;
grant execute on function public.revenue_month_totals() to authenticated, service_role;
comment on function public.revenue_month_totals() is
  'v2.5 (finance.view, security invoker; R5): this IST month''s Potential, Achieved, Remaining and the not-priced and no-amount counts, for the Owner''s Today line.';
