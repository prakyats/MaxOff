-- 9.1 review fixes (advisor, #89 6986070155; the first migration reached staging through the branch
-- preview, so it is not edited):
--   M1  Q1 holds for weekly retainers. A cycle that started before priced_from (the 1st of the IST month the
--       first amount was entered) is never priced by the project's amount: not by a later change (which
--       reached every cycle ending today or later, so a week that began last month), and not by the copy
--       made when a cycle is created (a back-filled earlier week). Only billing_set_cycle_amount prices an
--       earlier cycle, one at a time, on purpose ("No amount set" until the Owner fills each one).
--   S4  the over-amount check counts the same deliverables as the split: a plan deliverable that left
--       Potential ("Not needed", or cancelled before its cycle started) no longer holds room in the amount.
--   S3  the plan-or-added trigger matches the two function names alone, not the English word before them,
--       so it does not depend on the server's lc_messages.
--   S5  revenue_by_cycle_v sums item_values_v once, grouped by cycle, instead of once per cycle row (the
--       recursive walk ran for every cycle). Same columns, same figures.
-- EXPAND-ONLY: four functions and one view re-created with the same signatures and grants. Append-only.

create or replace function app.cycle_billing_copy_amount()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_amount numeric(12, 2);
  v_from date;
begin
  select b.cycle_amount, b.priced_from into v_amount, v_from
  from public.project_billing b where b.project_id = new.project_id;
  if v_amount is null or v_from is null or new.period_start is null or new.period_start < v_from then
    return null;
  end if;
  insert into public.cycle_billing (cycle_id, org_id, project_id, cycle_amount)
  values (new.id, new.org_id, new.project_id, v_amount)
  on conflict on constraint cycle_billing_pkey do nothing;
  return null;
end;
$$;
comment on function app.cycle_billing_copy_amount() is
  '9.1 (decision 3, Q1): a new retainer cycle starting on or after priced_from copies the project''s cycle amount into its own cycle_billing row; an earlier one stays "No amount set".';

-- The explicit values of a cycle's plan deliverables that count in its Potential (decision 4), leaving one
-- item out: exactly the rows item_values_v values as 'explicit'.
create or replace function app.cycle_explicit_total(p_cycle_id uuid, p_except_item uuid default null)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(v.value), 0)
  from public.item_values_v v
  where v.cycle_id = p_cycle_id and v.kind = 'plan' and v.method = 'explicit'
    and (p_except_item is null or v.item_id <> p_except_item);
$$;

create or replace function public.billing_set_project(
  project_id uuid,
  amount numeric,
  set_amount boolean,
  category public.billing_category
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller public.members;
  v_project public.projects;
  v_row public.project_billing;
  v_today date := app.today_ist();
  v_first boolean;
  v_from date;
  v_cycle record;
  v_advances numeric;
begin
  v_caller := app.client_work_caller('finance.edit', 'Only the Owner sets billing.');
  v_project := app.project_lock(billing_set_project.project_id);
  if not coalesce(set_amount, false) and category is null then
    perform app.fail('VALIDATION', 'Nothing to change.');
  end if;

  select b.* into v_row from public.project_billing b where b.project_id = v_project.id for update;
  if v_row.project_id is null then
    perform set_config('app.audit_override', jsonb_build_object('action', 'billing_started')::text, true);
    insert into public.project_billing (project_id, org_id) values (v_project.id, v_project.org_id)
    returning * into v_row;
  end if;

  if category is not null and category is distinct from v_row.billing_category then
    perform set_config('app.audit_override', jsonb_build_object('action', 'category_set')::text, true);
    update public.project_billing b set billing_category = category where b.project_id = v_project.id;
  end if;

  if not coalesce(set_amount, false) then
    return true;
  end if;
  perform app.money_check(amount, 'The amount');
  v_first := v_row.priced_from is null;
  v_from := coalesce(v_row.priced_from, case when amount is not null then app.month_start(v_today) end);

  if v_project.recurrence = 'one_time' then
    select coalesce(sum(a.amount), 0) into v_advances from public.project_advances a
    where a.project_id = v_project.id and a.returned_on is null;
    if v_advances > 0 and (amount is null or amount < v_advances) then
      perform app.fail('VALIDATION', 'The amount can''t be less than the advances received.');
    end if;
    perform set_config('app.audit_override', jsonb_build_object('action', 'amount_set')::text, true);
    update public.project_billing b set fixed_amount = amount, priced_from = v_from where b.project_id = v_project.id;
    return true;
  end if;

  -- A retainer: the first amount covers every cycle starting this IST month or later (Q1); a later change
  -- covers the cycle current today and later ones (decision 3). Never a cycle that started before
  -- priced_from: a week that began in the month before the first amount stays "No amount set" (Q1), and
  -- clearing the amount (null) with no priced_from reaches nothing.
  if v_from is null then
    return true;
  end if;
  for v_cycle in
    select c.id, c.label from public.project_cycles c
    where c.project_id = v_project.id
      and c.period_start >= v_from
      and (v_first or c.period_end >= v_today)
    order by c.period_start
  loop
    if amount is not null and app.cycle_explicit_total(v_cycle.id) > amount then
      perform app.fail('VALIDATION', format('Deliverable values in %s add up to more than this amount.', v_cycle.label));
    end if;
    perform set_config('app.audit_override', jsonb_build_object('action', 'amount_set', 'meta', jsonb_build_object('from', 'project'))::text, true);
    insert into public.cycle_billing (cycle_id, org_id, project_id, cycle_amount)
    values (v_cycle.id, v_project.org_id, v_project.id, amount)
    on conflict on constraint cycle_billing_pkey do update set cycle_amount = excluded.cycle_amount;
  end loop;
  perform set_config('app.audit_override', jsonb_build_object('action', 'amount_set')::text, true);
  update public.project_billing b set cycle_amount = amount, priced_from = v_from where b.project_id = v_project.id;
  perform set_config('app.audit_override', '', true);
  return true;
end;
$$;

comment on function public.billing_set_project(uuid, numeric, boolean, public.billing_category) is
  '9.1 (finance.edit): a project''s amount (set_amount; null = No amount set) and / or billing category. A retainer''s first amount covers cycles starting this IST month or later (Q1); a later change the current cycle on (decision 3), never a cycle that started before priced_from.';

create or replace function app.item_billing_mark_added()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_stack text;
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
  return null;
end;
$$;

create or replace view public.revenue_by_cycle_v
with (security_invoker = true)
as
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
  from public.item_values_v v
  group by v.cycle_id
) t on t.cycle_id = c.id
where (select app.has_permission('finance.view'));
