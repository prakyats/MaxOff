-- v3.5 "Month close", U5: revenue_month_read also answers each line's billing status (Not billed / Billed),
-- so the Revenue page of a closed month can show the status "at close" (the snapshot's) and "now" (this
-- read's) side by side when they differ (decision 10, v3.5 Q13; WORKFLOWS §7.1). `billing_status` is added to
-- every cycle and one-time line: the same value app.month_snapshot_build stores (app.revenue_cycles'
-- billing_status for a cycle, revenue_project_lines_v's for a one-time project), already joined by both, so
-- the read does no extra work. Nothing else changes: the same lines, order, figures, check and wording.
--
-- EXPAND-ONLY: the function is replaced in place (same signature; `create or replace` keeps its grants:
-- authenticated and service_role, never anon); the answer gains one key per line, nothing is removed.
-- The earlier v3.5 migrations are untouched. Append-only.

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
        'billing_status', c.billing_status)
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
        'advances_kept', l.advances_kept, 'billing_status', l.billing_status)
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
