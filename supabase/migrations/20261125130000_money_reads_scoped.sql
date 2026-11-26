-- v2.1 speed (review S5 and its follow-up; EXPLAIN on a year of data, #89): one month of revenue, or one
-- cycle's billing, cost the same as every month, because item_values_v walked every retainer deliverable
-- before any filter applied (about 0.75 s on 12,600 deliverables). The two retainer views become functions
-- that take the cycles wanted and start from those cycles' deliverables only; the views keep their names,
-- columns and gate and are the same functions asked for everything. The split is per cycle and a carried
-- deliverable is followed from its origin cycle, so a whole cycle is always valued alone correctly.
-- The reads that know their cycles (the Revenue page's month, the Billing section's cycle, the over-amount
-- check) now ask for just those. Security is unchanged: invoker functions over the Owner-only tables, each
-- still gated on finance.view; granted like every app function (authenticated and service_role, never anon).
-- EXPAND-ONLY: two new functions; two views and three functions re-created with the same columns,
-- signatures and grants. Append-only: never edit once applied.

create function app.item_values(p_cycle_ids uuid[])
returns table (
  org_id uuid, client_id uuid, project_id uuid, cycle_id uuid, item_id uuid, title text, "position" text,
  month date, kind text, method text, value numeric, in_potential boolean, achieved boolean,
  closed_not_achieved boolean, leaf_item_id uuid, leaf_state public.item_state, leaf_approved_at timestamptz
)
language sql
stable
set search_path = ''
as $$
with recursive chain as (
  select i.id as root_id, i.id as item_id, 0 as depth
  from public.project_items i
  join public.projects p on p.id = i.project_id and p.recurrence <> 'one_time'
  where i.carried_from_item_id is null
    and (p_cycle_ids is null or i.cycle_id = any (p_cycle_ids))
    and (select app.has_permission('finance.view'))
  union all
  select ch.root_id, n.id, ch.depth + 1
  from chain ch
  join public.project_items n on n.carried_from_item_id = ch.item_id
),
leaf as (
  select distinct on (ch.root_id) ch.root_id, ch.item_id as leaf_id
  from chain ch
  order by ch.root_id, ch.depth desc
),
base as (
  select
    r.org_id, p.client_id, r.project_id, r.cycle_id, r.id as item_id, r.title, r.position,
    c.period_start, app.month_start(c.period_start) as month,
    cb.cycle_amount,
    coalesce(ib.added, false) as added,
    ib.value as explicit_value,
    l.id as leaf_item_id, l.state as leaf_state, l.approved_at as leaf_approved_at,
    not (l.state = 'cancelled' and l.close_kind is not distinct from 'not_needed')
      and not (r.state = 'cancelled' and app.to_ist_date(r.cancelled_at) < c.period_start) as in_potential
  from leaf lf
  join public.project_items r on r.id = lf.root_id
  join public.project_items l on l.id = lf.leaf_id
  join public.project_cycles c on c.id = r.cycle_id
  join public.projects p on p.id = r.project_id
  left join public.cycle_billing cb on cb.cycle_id = r.cycle_id
  left join public.item_billing ib on ib.item_id = r.id
),
split as (
  select b.*,
    coalesce(sum(b.explicit_value) filter (where not b.added and b.in_potential) over w, 0) as explicit_total,
    count(*) filter (where not b.added and b.in_potential and b.explicit_value is null) over w as split_count,
    row_number() over (
      partition by b.cycle_id, (not b.added and b.in_potential and b.explicit_value is null)
      order by b.position collate "C", b.item_id) as split_rank
  from base b
  window w as (partition by b.cycle_id)
),
valued as (
  select s.*,
    case
      when not s.in_potential then 'excluded'
      when s.added and s.explicit_value is null then 'not_priced'
      when s.added then 'added'
      when s.explicit_value is not null then 'explicit'
      when s.cycle_amount is null then 'no_amount'
      else 'split'
    end as method,
    case
      when not s.in_potential then 0
      when s.explicit_value is not null then s.explicit_value
      when s.added or s.cycle_amount is null then 0
      when s.split_rank = 1 then
        greatest(s.cycle_amount - s.explicit_total, 0)
          - trunc(greatest(s.cycle_amount - s.explicit_total, 0) / s.split_count, 2) * (s.split_count - 1)
      else trunc(greatest(s.cycle_amount - s.explicit_total, 0) / s.split_count, 2)
    end::numeric(12, 2) as value
  from split s
)
select
  v.org_id, v.client_id, v.project_id, v.cycle_id, v.item_id, v.title, v.position, v.month,
  case when v.added then 'added' else 'plan' end as kind,
  v.method, v.value, v.in_potential,
  (v.in_potential and v.leaf_state = 'approved') as achieved,
  (v.in_potential and v.leaf_state = 'cancelled') as closed_not_achieved,
  v.leaf_item_id, v.leaf_state, v.leaf_approved_at
from valued v;
$$;
revoke all on function app.item_values(uuid[]) from public, anon;
grant execute on function app.item_values(uuid[]) to authenticated, service_role;
comment on function app.item_values(uuid[]) is
  'v2.1 (Owner only, WORKFLOWS §6.1): item_values_v for the given cycles (null = every cycle): each retainer deliverable valued in its origin cycle.';

create function app.revenue_cycles(p_cycle_ids uuid[])
returns table (
  org_id uuid, client_id uuid, project_id uuid, cycle_id uuid, label text, period_start date, period_end date,
  month date, billing_category public.billing_category, amount numeric, potential numeric,
  achieved_calculated numeric, achieved numeric, override_id uuid, closed_not_achieved numeric,
  remaining numeric, added_value numeric, added_count integer, not_priced_count integer, plan_count integer,
  done_count integer, billing_status public.billing_status, billed_on date, billing_note text, held boolean
)
language sql
stable
set search_path = ''
as $$
select
  c.org_id, p.client_id, c.project_id, c.id as cycle_id, c.label, c.period_start, c.period_end,
  app.month_start(c.period_start) as month,
  coalesce(pb.billing_category, 'retainer'::public.billing_category) as billing_category,
  cb.cycle_amount as amount,
  coalesce(t.potential, 0)::numeric(12, 2) as potential,
  coalesce(t.achieved, 0)::numeric(12, 2) as achieved_calculated,
  coalesce(o.adjusted_value, t.achieved, 0)::numeric(12, 2) as achieved,
  o.id as override_id,
  coalesce(t.closed_not_achieved, 0)::numeric(12, 2) as closed_not_achieved,
  greatest(coalesce(t.potential, 0) - coalesce(o.adjusted_value, t.achieved, 0), 0)::numeric(12, 2) as remaining,
  coalesce(t.added_value, 0)::numeric(12, 2) as added_value,
  coalesce(t.added_count, 0)::integer as added_count,
  coalesce(t.not_priced_count, 0)::integer as not_priced_count,
  coalesce(t.plan_count, 0)::integer as plan_count,
  coalesce(t.done_count, 0)::integer as done_count,
  coalesce(cb.billing_status, 'not_billed'::public.billing_status) as billing_status,
  cb.billed_on, cb.note as billing_note,
  (p.held_at is not null) as held
from public.project_cycles c
join public.projects p on p.id = c.project_id and p.recurrence <> 'one_time'
left join public.project_billing pb on pb.project_id = c.project_id
left join public.cycle_billing cb on cb.cycle_id = c.id
left join public.revenue_overrides o on o.scope = 'cycle' and o.ref_id = c.id and o.superseded_at is null
left join (
  select
    v.cycle_id,
    sum(v.value) filter (where v.in_potential) as potential,
    sum(v.value) filter (where v.achieved) as achieved,
    sum(v.value) filter (where v.closed_not_achieved) as closed_not_achieved,
    sum(v.value) filter (where v.in_potential and v.kind = 'added') as added_value,
    count(*) filter (where v.in_potential and v.kind = 'added') as added_count,
    count(*) filter (where v.method = 'not_priced') as not_priced_count,
    count(*) filter (where v.in_potential and v.kind = 'plan') as plan_count,
    count(*) filter (where v.achieved) as done_count
  from app.item_values(p_cycle_ids) v
  group by v.cycle_id
) t on t.cycle_id = c.id
where (p_cycle_ids is null or c.id = any (p_cycle_ids))
  and (select app.has_permission('finance.view'));
$$;
revoke all on function app.revenue_cycles(uuid[]) from public, anon;
grant execute on function app.revenue_cycles(uuid[]) to authenticated, service_role;
comment on function app.revenue_cycles(uuid[]) is
  'v2.1 (Owner only): revenue_by_cycle_v for the given cycles (null = every cycle).';

create or replace view public.item_values_v
with (security_invoker = true)
as
select v.org_id, v.client_id, v.project_id, v.cycle_id, v.item_id, v.title, v."position", v.month, v.kind, v.method,
       v.value::numeric(12, 2) as value, v.in_potential, v.achieved, v.closed_not_achieved, v.leaf_item_id,
       v.leaf_state, v.leaf_approved_at
from app.item_values(null) v;

create or replace view public.revenue_by_cycle_v
with (security_invoker = true)
as
select c.org_id, c.client_id, c.project_id, c.cycle_id, c.label, c.period_start, c.period_end, c.month,
       c.billing_category, c.amount::numeric(12, 2) as amount, c.potential::numeric(12, 2) as potential,
       c.achieved_calculated::numeric(12, 2) as achieved_calculated, c.achieved::numeric(12, 2) as achieved,
       c.override_id, c.closed_not_achieved::numeric(12, 2) as closed_not_achieved,
       c.remaining::numeric(12, 2) as remaining, c.added_value::numeric(12, 2) as added_value, c.added_count,
       c.not_priced_count, c.plan_count, c.done_count, c.billing_status, c.billed_on, c.billing_note, c.held
from app.revenue_cycles(null) c;

-- The reads that know their cycles ask for just those.
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
          'advances_kept', l.advances_kept, 'advances_returned', l.advances_returned)
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
        'added_count', c.added_count, 'not_priced_count', c.not_priced_count, 'plan_count', c.plan_count)
      from app.revenue_cycles(array[v_cycle_id]) c where v_cycle_id is not null),
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
        'plan_count', c.plan_count, 'done_count', c.done_count, 'held', c.held)
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
        'advances_kept', l.advances_kept)
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

create or replace function app.cycle_explicit_total(p_cycle_id uuid, p_except_item uuid default null)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(v.value), 0)
  from app.item_values(array[p_cycle_id]) v
  where v.kind = 'plan' and v.method = 'explicit'
    and (p_except_item is null or v.item_id <> p_except_item);
$$;
