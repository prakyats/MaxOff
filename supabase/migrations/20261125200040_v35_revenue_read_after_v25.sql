-- v3.5 "Month close", after the merge of v2.5 "Revenue every day" into phase-v35 (advisor, 26 Nov 2026).
--
-- 1. revenue_month_read, again as v2.5 built it. v2.5's 20261125160000_revenue_every_day re-creates the read
--    with `billing_status`, `billed_on` and `adjusted` on every cycle and `cycle_id`, `billing_status`,
--    `billed_on` and `adjusted` on every one-time line. v3.5's 20261125181943_v35_revenue_read_billing sorts
--    AFTER it and re-creates the same function with only `billing_status` added, so on a fresh database
--    v3.5's would win and drop v2.5's keys (the Revenue page's "Billed 3 Dec", "· Adjusted" and "Mark all N
--    billed" would read nothing). Both migrations are pushed and frozen, so this one re-creates the read
--    exactly as v2.5's: the body below is v2.5's, copied verbatim. It is a superset of v3.5's: the one key
--    v3.5 added, `billing_status`, is the same key from the same source in both (app.revenue_cycles'
--    billing_status for a cycle, revenue_project_lines_v's for a one-time line), so v3.5's closed month
--    ("Not billed at close") reads it unchanged. As in v2.5, no grant or comment: `create or replace` keeps
--    both (authenticated and service_role, never anon).
--
-- 2. month_snapshots_read(month), the Revenue page's light read of an ended month (v3.5 U4, U5), now with the
--    organization's first priced month (the advisor's should-fix 2, 26 Nov): Revenue hides "Close month" on
--    an ended month before it, whose close screen says "Nothing to close.". It replaces the page's select of
--    month_snapshots (the same versions' numbers and dates and the latest version's data->schema and
--    data->revenue, never the expense totals, the month summary or the note), so the page still sends one
--    request for it, in the same wave. Security definer: app.first_priced_month reads the money tables and
--    is not executable by authenticated. finance.view first, one refusal for everyone else; every read is
--    filtered to the caller's organization.
--
-- EXPAND-ONLY: one function replaced in place (same signature), one new. The earlier migrations are untouched.
-- Append-only.

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

create function public.month_snapshots_read(month date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_month date := app.month_start(month_snapshots_read.month);
begin
  if not app.has_permission('finance.view') then
    perform app.fail('FORBIDDEN', 'Only the Owner sees which months are closed.');
  end if;
  if v_month is null then
    perform app.fail('VALIDATION', 'Pick a month.');
  end if;
  select c.org_id into v_org from app.current_member() c;
  return jsonb_build_object(
    'month', v_month,
    'first_priced_month', app.first_priced_month(v_org),
    'versions', (
      select coalesce(jsonb_agg(jsonb_build_object('version', s.version, 'closed_at', s.closed_at)
        order by s.version), '[]'::jsonb)
      from public.month_snapshots s
      where s.org_id = v_org and s.month = v_month),
    'latest', (
      select jsonb_build_object('schema', s.data -> 'schema', 'revenue', s.data -> 'revenue')
      from public.month_snapshots s
      where s.org_id = v_org and s.month = v_month
      order by s.version desc
      limit 1));
end;
$$;
revoke all on function public.month_snapshots_read(date) from public, anon;
grant execute on function public.month_snapshots_read(date) to authenticated, service_role;
comment on function public.month_snapshots_read(date) is
  'v3.5 (finance.view, security definer; WORKFLOWS §7.4): the Revenue page''s light read of an ended IST month: its snapshot versions (number, closed_at), the latest version''s schema and revenue section (never the expense totals, the month summary or the note), and the organization''s first priced month, for "Close month" / "Closed 3 Oct · v1". One refusal for everyone else.';
