-- v3.5 "Month close", U2: the snapshot builder, the first priced month and month_close (WORKFLOWS §7.1 and
-- §7.4; DATA-MODEL §9 and §9a; PERMISSIONS "Month close"; ADR-0007 amendment 2026-11-25; ADR-0006).
--
--   app.first_priced_month(org)          the earliest month with a cycle amount or a priced one-time line
--                                        in the organization, ₹0 ("Not billable") included; null when
--                                        nothing is priced (v3.5 Q1, advisor autopilot 2026-11-25).
--   app.month_snapshot_build(org, month) the month's frozen report as one JSON document, schema 1. It reads
--                                        the v2.1 money reads themselves (app.revenue_cycles,
--                                        app.item_values, revenue_project_lines_v, revenue_advances_v,
--                                        revenue_overrides, cycle_billing) and month_summary(), so the
--                                        snapshot and the live Revenue page share one definition. Every
--                                        line carries the id it came from; every array is ordered by ids
--                                        and dates only (never by a name), and the document holds no build
--                                        time, so the same data always builds the same document (U3
--                                        compares by id).
--   public.month_close(month)            the Owner closes an ended month: version 1, one history entry with
--                                        no amount, nobody notified. Returns the version (1).
--
-- Money (CLAUDE.md invariant 2): the builder is never executable by authenticated; month_close returns no
-- amount and refuses with no amount; the history entry holds the month and the version only (no diff, no
-- note), under the entity month_snapshots, which no Admin-readable activity_log policy matches.
--
-- EXPAND-ONLY: three new functions. Nothing existing changes. Append-only: never edit once applied.

-- 1. The first priced month ---------------------------------------------------------------------------------
-- Read from the tables, not through revenue_project_lines_v: the views are gated on the CALLER's
-- finance.view, and the reminder (U6) asks from the digest job, which has no caller. A one-time line's month
-- is therefore the view's own rule, repeated here (completed: its completion month; cancelled: its
-- cancellation month; still open past its delivery month: the current IST month; else its delivery month)
-- with the view's Q1 rule for "priced" (an amount set, and the line's month on or after priced_from).
-- pgTAP 161 pins it against the view.
create function app.first_priced_month(p_org uuid)
returns date
language sql
stable
set search_path = ''
as $$
  select min(x.month)
  from (
    select app.month_start(c.period_start) as month
    from public.cycle_billing cb
    join public.project_cycles c on c.id = cb.cycle_id
    join public.projects p on p.id = c.project_id and p.recurrence <> 'one_time'
    where cb.org_id = p_org and c.org_id = p_org and cb.cycle_amount is not null
    union all
    select l.month
    from (
      select pb.priced_from,
        case
          when p.state = 'completed' then app.month_start(app.to_ist_date(p.completed_at))
          when p.state = 'cancelled' then app.month_start(app.to_ist_date(p.cancelled_at))
          when app.month_start(p.delivery_date) < app.month_start(app.today_ist()) then app.month_start(app.today_ist())
          else app.month_start(p.delivery_date)
        end as month
      from public.projects p
      join public.project_billing pb on pb.project_id = p.id
      where p.org_id = p_org and p.recurrence = 'one_time' and pb.fixed_amount is not null and pb.priced_from is not null
    ) l
    where l.month >= l.priced_from
  ) x;
$$;
revoke all on function app.first_priced_month(uuid) from public, anon, authenticated;
grant execute on function app.first_priced_month(uuid) to service_role;
comment on function app.first_priced_month(uuid) is
  'v3.5 (WORKFLOWS §7.1, v3.5 Q1): the earliest IST month (its 1st) with a retainer cycle amount or a priced one-time line in the organization, ₹0 included; null when nothing is priced. Internal (service_role).';

-- 2. The builder ----------------------------------------------------------------------------------------------
-- Not security definer: it runs inside month_close (and U3's functions), as their owner. The money reads it
-- uses are gated on the caller's finance.view and month_summary() on the caller's organization, so the
-- builder refuses to build for anyone but an Owner of p_org: it never answers an empty document by mistake.
-- Running as the functions' owner, the views see every organization: every read below is filtered by p_org.
create function app.month_snapshot_build(p_org uuid, p_month date)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_month date := app.month_start(p_month);
  v_cycle_ids uuid[];
  v_cycles jsonb;
  v_projects jsonb;
  v_advances jsonb;
  v_totals jsonb;
  v_expenses jsonb;
  v_summary jsonb;
begin
  if p_org is null or v_month is null then
    perform app.fail('VALIDATION', 'Pick a month.');
  end if;
  if not (select app.has_permission('finance.view'))
     or (select c.org_id from app.current_member() c) is distinct from p_org then
    perform app.fail('FORBIDDEN', 'Only the Owner closes a month.');
  end if;

  -- The month's retainer cycles, first, so only their deliverables are valued (as revenue_month_read).
  select coalesce(array_agg(c.id order by c.id), '{}'::uuid[]) into v_cycle_ids
  from public.project_cycles c
  join public.projects p on p.id = c.project_id and p.recurrence <> 'one_time'
  where c.org_id = p_org
    and c.period_start >= v_month and c.period_start < (v_month + interval '1 month')::date;

  -- Retainer cycles, each with its deliverables (value, method, approval) and its override.
  with items as (
    select v.cycle_id,
      jsonb_agg(jsonb_build_object(
        'item_id', v.item_id, 'title', v.title, 'position', v.position, 'kind', v.kind, 'method', v.method,
        'value', v.value, 'in_potential', v.in_potential, 'achieved', v.achieved,
        'closed_not_achieved', v.closed_not_achieved, 'leaf_item_id', v.leaf_item_id, 'leaf_state', v.leaf_state,
        'approved_at', v.leaf_approved_at, 'approved_by', l.approved_by)
        order by v.item_id) as list
    from app.item_values(v_cycle_ids) v
    left join public.project_items l on l.id = v.leaf_item_id
    group by v.cycle_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'cycle_id', c.cycle_id, 'label', c.label, 'period_start', c.period_start, 'period_end', c.period_end,
      'client_id', c.client_id, 'client_name', cl.name, 'project_id', c.project_id, 'project_name', p.name,
      'category', c.billing_category, 'amount', c.amount, 'potential', c.potential,
      'achieved_calculated', c.achieved_calculated, 'achieved', c.achieved,
      'override', case when o.id is null then null else jsonb_build_object(
        'id', o.id, 'calculated_value', o.calculated_value, 'adjusted_value', o.adjusted_value, 'note', o.note,
        'by_id', o.by_id, 'at', o.at) end,
      'closed_not_achieved', c.closed_not_achieved, 'remaining', c.remaining,
      'added_value', c.added_value, 'added_count', c.added_count, 'not_priced_count', c.not_priced_count,
      'plan_count', c.plan_count, 'done_count', c.done_count, 'held', c.held,
      'billing_status', c.billing_status, 'billed_on', c.billed_on, 'billing_note', c.billing_note,
      'items', coalesce(i.list, '[]'::jsonb))
      order by c.period_start, c.cycle_id), '[]'::jsonb)
  into v_cycles
  from app.revenue_cycles(v_cycle_ids) c
  join public.projects p on p.id = c.project_id
  join public.clients cl on cl.id = c.client_id
  left join public.revenue_overrides o on o.id = c.override_id
  left join items i on i.cycle_id = c.cycle_id
  where c.org_id = p_org;

  -- One-time projects sitting in the month. remaining as the page (totalsOf) and revenue_by_client_month_v.
  select coalesce(jsonb_agg(jsonb_build_object(
      'project_id', l.project_id, 'cycle_id', l.cycle_id, 'client_id', l.client_id, 'client_name', cl.name,
      'project_name', l.name, 'category', l.billing_category, 'state', l.state, 'delivery_date', l.delivery_date,
      'amount', l.amount, 'potential', l.potential, 'achieved_calculated', l.achieved_calculated,
      'achieved', l.achieved,
      'override', case when o.id is null then null else jsonb_build_object(
        'id', o.id, 'calculated_value', o.calculated_value, 'adjusted_value', o.adjusted_value, 'note', o.note,
        'by_id', o.by_id, 'at', o.at) end,
      'closed_not_achieved', l.closed_not_achieved,
      'remaining', greatest(l.potential - l.achieved, 0)::numeric(12, 2),
      'was_due', l.was_due, 'ready_to_complete', l.ready_to_complete, 'held', l.held,
      'advances_kept', l.advances_kept, 'advances_returned', l.advances_returned,
      'billing_status', l.billing_status, 'billed_on', l.billed_on, 'billing_note', l.billing_note)
      order by l.project_id), '[]'::jsonb)
  into v_projects
  from public.revenue_project_lines_v l
  join public.clients cl on cl.id = l.client_id
  left join public.revenue_overrides o on o.id = l.override_id
  where l.org_id = p_org and l.month = v_month;

  -- Advances received and returned in the month, each event in its own month.
  select coalesce(jsonb_agg(jsonb_build_object(
      'advance_id', a.advance_id, 'event', a.event, 'on_date', a.on_date, 'amount', a.amount, 'note', a.note,
      'returned', a.returned, 'client_id', a.client_id, 'client_name', cl.name, 'project_id', a.project_id,
      'project_name', p.name)
      order by a.on_date, a.event, a.advance_id), '[]'::jsonb)
  into v_advances
  from public.revenue_advances_v a
  join public.projects p on p.id = a.project_id
  join public.clients cl on cl.id = a.client_id
  where a.org_id = p_org and a.month = v_month;

  -- The totals: the lines above summed, exactly as the page sums them (totalsOf, advanceTotals).
  with lines as (
    select e ->> 'client_id' as client_id, e ->> 'client_name' as client_name, e ->> 'category' as category,
      (e ->> 'potential')::numeric as potential, (e ->> 'achieved')::numeric as achieved,
      (e ->> 'remaining')::numeric as remaining, (e ->> 'closed_not_achieved')::numeric as closed_not_achieved
    from jsonb_array_elements(v_cycles || v_projects) e
  )
  select jsonb_build_object(
    'potential', coalesce((select sum(x.potential) from lines x), 0)::numeric(12, 2),
    'achieved', coalesce((select sum(x.achieved) from lines x), 0)::numeric(12, 2),
    'remaining', coalesce((select sum(x.remaining) from lines x), 0)::numeric(12, 2),
    'closed_not_achieved', coalesce((select sum(x.closed_not_achieved) from lines x), 0)::numeric(12, 2),
    'advances_received', coalesce((select sum((e ->> 'amount')::numeric) from jsonb_array_elements(v_advances) e
                                   where e ->> 'event' = 'received'), 0)::numeric(12, 2),
    'advances_returned', coalesce((select sum((e ->> 'amount')::numeric) from jsonb_array_elements(v_advances) e
                                   where e ->> 'event' = 'returned'), 0)::numeric(12, 2),
    'by_client', (
      select coalesce(jsonb_agg(jsonb_build_object(
          'client_id', g.client_id, 'client_name', g.client_name, 'potential', g.potential, 'achieved', g.achieved,
          'remaining', g.remaining, 'closed_not_achieved', g.closed_not_achieved) order by g.client_id), '[]'::jsonb)
      from (
        select x.client_id, min(x.client_name) as client_name, sum(x.potential)::numeric(12, 2) as potential,
          sum(x.achieved)::numeric(12, 2) as achieved, sum(x.remaining)::numeric(12, 2) as remaining,
          sum(x.closed_not_achieved)::numeric(12, 2) as closed_not_achieved
        from lines x group by x.client_id
      ) g),
    'by_category', (
      select coalesce(jsonb_agg(jsonb_build_object(
          'category', g.category, 'potential', g.potential, 'achieved', g.achieved,
          'remaining', g.remaining, 'closed_not_achieved', g.closed_not_achieved) order by g.category), '[]'::jsonb)
      from (
        select x.category, sum(x.potential)::numeric(12, 2) as potential, sum(x.achieved)::numeric(12, 2) as achieved,
          sum(x.remaining)::numeric(12, 2) as remaining, sum(x.closed_not_achieved)::numeric(12, 2) as closed_not_achieved
        from lines x group by x.category
      ) g))
  into v_totals;

  -- Expense totals per person (claims with an expense date in the month): approved = approved, not paid yet
  -- (the month summary's expense line, modules/expenses unpaidTotal); paid = paid. A person with neither is
  -- left out. Totals and counts only; never a claim.
  select coalesce(jsonb_agg(jsonb_build_object(
      'member_id', x.member_id, 'full_name', x.full_name, 'approved', x.approved, 'approved_count', x.approved_count,
      'paid', x.paid, 'paid_count', x.paid_count)
      order by x.member_id), '[]'::jsonb)
  into v_expenses
  from (
    select m.id as member_id, m.full_name,
      coalesce(sum(e.amount) filter (where e.state = 'approved'), 0)::numeric(12, 2) as approved,
      count(*) filter (where e.state = 'approved')::integer as approved_count,
      coalesce(sum(e.amount) filter (where e.state = 'paid'), 0)::numeric(12, 2) as paid,
      count(*) filter (where e.state = 'paid')::integer as paid_count
    from public.expense_claims e
    join public.members m on m.id = e.member_id and m.org_id = p_org
    where e.state in ('approved', 'paid')
      and e.expense_date >= v_month and e.expense_date < (v_month + interval '1 month')::date
    group by m.id, m.full_name
  ) x;

  -- month_summary() per person, its own columns as they are (id = the member).
  select coalesce(jsonb_agg(to_jsonb(s) order by s.id), '[]'::jsonb)
  into v_summary
  from public.month_summary(v_month) s;

  return jsonb_build_object(
    'schema', 1,
    'month', v_month,
    'revenue', jsonb_build_object(
      'cycles', v_cycles, 'projects', v_projects, 'advances', v_advances, 'totals', v_totals),
    'expenses', v_expenses,
    'month_summary', v_summary);
end;
$$;
revoke all on function app.month_snapshot_build(uuid, date) from public, anon, authenticated;
grant execute on function app.month_snapshot_build(uuid, date) to service_role;
comment on function app.month_snapshot_build(uuid, date) is
  'v3.5 (DATA-MODEL §9a, schema 1): a month''s report as one JSON document from the live money reads: revenue cycles (with deliverables and overrides), one-time lines, advances and totals; expense totals per person; month_summary() per person. Ordered by ids and dates only, no build time: the same data builds the same document. Internal: built only for an Owner of p_org (service_role, never authenticated).';

-- 3. month_close ---------------------------------------------------------------------------------------------
-- "Ended" reads app.now() (= now() for the app and every API session; only a direct database session may
-- set app.test_now, migration w0_test_clock) so pgTAP tests the IST month boundary at explicit instants.
-- For the app it is app.today_ist() exactly.
create function public.month_close(month date)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller public.members;
  v_month date := app.month_start(month_close.month);
  v_today date := app.to_ist_date(app.now());
  v_first date;
  v_name text;
  v_id uuid;
begin
  if not app.has_permission('months.close') then
    perform app.fail('FORBIDDEN', 'Only the Owner closes a month.');
  end if;
  select m.* into v_caller from app.current_member() m;
  if v_month is null then
    perform app.fail('VALIDATION', 'Pick a month.');
  end if;
  v_name := to_char(v_month, 'FMMonth YYYY');
  if v_month >= app.month_start(v_today) then
    perform app.fail('VALIDATION', format('%s hasn''t ended yet.', v_name));
  end if;
  v_first := app.first_priced_month(v_caller.org_id);
  if v_first is null or v_month < v_first then
    perform app.fail('VALIDATION', 'Nothing to close.');
  end if;

  -- Two taps never store two v1: one lock per organization and month, then the check (the unique
  -- (org_id, month, version) is the backstop).
  perform pg_advisory_xact_lock(hashtextextended('month_close:' || v_caller.org_id::text || ':' || v_month::text, 0));
  if exists (select 1 from public.month_snapshots s where s.org_id = v_caller.org_id and s.month = v_month) then
    perform app.fail('INVALID_STATE', format('%s is already closed.', v_name));
  end if;

  insert into public.month_snapshots (org_id, month, version, data, closed_by)
  values (v_caller.org_id, v_month, 1, app.month_snapshot_build(v_caller.org_id, v_month), v_caller.id)
  returning id into v_id;

  -- The history entry: the month and the version only. No diff, no amount, no note (WORKFLOWS §7.4).
  insert into public.activity_log (org_id, actor_id, entity, entity_id, action, meta)
  values (v_caller.org_id, v_caller.id, 'month_snapshots', v_id, 'closed',
          jsonb_build_object('month', v_month, 'version', 1));
  return 1;
end;
$$;
revoke all on function public.month_close(date) from public, anon;
grant execute on function public.month_close(date) to authenticated, service_role;
comment on function public.month_close(date) is
  'v3.5 (months.close, WORKFLOWS §7.4): the Owner closes an ended IST month (any date of it) from the first priced month on: snapshot version 1, one history entry (month and version, no amount), nobody notified. Returns 1.';
