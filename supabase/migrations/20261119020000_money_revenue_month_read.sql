-- 9.2 (v2.1 "Money in"): the Revenue page (/reports/revenue) in one read. Owner only: FORBIDDEN without
-- finance.view. Security invoker over the 9.1 views, whose own gate and the tables' policies apply as well.
-- One IST month: every retainer cycle starting in it and every one-time project sitting in it (WORKFLOWS §6),
-- with the client's and project's names, the advances received and returned in it, and the months that have
-- anything (for the month switcher).
-- EXPAND-ONLY: one new function. Append-only: never edit once applied.
create function public.revenue_month_read(month date default null)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_month date := app.month_start(coalesce(revenue_month_read.month, app.today_ist()));
begin
  if not (select app.has_permission('finance.view')) then
    perform app.fail('FORBIDDEN', 'Only the Owner sees revenue.');
  end if;
  return jsonb_build_object(
    'month', v_month,
    'this_month', app.month_start(app.today_ist()),
    'months', (
      select coalesce(jsonb_agg(m.month order by m.month), '[]'::jsonb)
      from (select distinct x.month from public.revenue_by_client_month_v x) m),
    'cycles', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'client_id', c.client_id, 'client_name', cl.name, 'project_id', c.project_id, 'project_name', p.name,
        'cycle_id', c.cycle_id, 'label', c.label, 'category', c.billing_category, 'amount', c.amount,
        'potential', c.potential, 'achieved', c.achieved, 'achieved_calculated', c.achieved_calculated,
        'closed_not_achieved', c.closed_not_achieved, 'remaining', c.remaining,
        'added_value', c.added_value, 'added_count', c.added_count, 'not_priced_count', c.not_priced_count,
        'plan_count', c.plan_count, 'done_count', c.done_count, 'held', c.held)
        order by cl.name, p.name, c.period_start), '[]'::jsonb)
      from public.revenue_by_cycle_v c
      join public.projects p on p.id = c.project_id
      join public.clients cl on cl.id = c.client_id
      where c.month = v_month),
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
revoke all on function public.revenue_month_read(date) from public, anon;
grant execute on function public.revenue_month_read(date) to authenticated, service_role;
comment on function public.revenue_month_read(date) is
  '9.2 (finance.view, security invoker): the Revenue page for one IST month in one read: retainer cycles, one-time projects, advances received and returned, and the months that have revenue lines.';
