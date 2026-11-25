-- v3.5 "Month close", U3: the correction, the close screen's read and "Changed since close" (WORKFLOWS §7.1,
-- §7.2 and §7.4; DATA-MODEL §9 and §9a; PERMISSIONS "Month close"; ADR-0007 amendment 2026-11-25; ADR-0006).
--
--   month_snapshots: the correction chain sealed at the table level. A correction points at a version of the
--                    SAME organization and the SAME month (a composite foreign key onto a new unique
--                    (org_id, month, id)), and a version is corrected at most once (unique corrects_id), so the
--                    versions of a month form one line v1 <- v2 <- v3: "v3 corrects v1 while v2 exists" and a
--                    cross-organization corrects_id are refused by the table itself, whoever writes.
--   app.month_snapshot_figures(data)     the document without its names (client_name, project_name, title,
--                                        full_name, label): what a correction compares, so a rename alone is
--                                        "Nothing changed." (WORKFLOWS §7.1: "a renamed client is not a change").
--   app.month_revenue_changes(...)       "Changed since close": the revenue lines and totals of two documents
--                                        compared by stable id (names never compared), with who changed a
--                                        deliverable since the close when the history says.
--   app.month_waiting(org, month, today) the close screen's waiting list (§7.2): counts only, no amount.
--   public.month_correct(month, note)    the Owner's correction: a full rebuild stored as version N+1.
--   public.month_close_read(month)       the close screen's and the closed month's one read (security definer
--                                        with its own finance.view check: it rebuilds live through the builder,
--                                        which stays service_role only; U2 handoff and the U2 review).
--
-- Money (CLAUDE.md invariant 2): the three helpers are service_role only; month_correct returns no amount and
-- refuses with no amount; its history entry holds the month and the version only (no diff, no note).
-- month_close_read is the Owner's alone (finance.view) and refuses everyone else the same way whatever the
-- month, so an Admin or Crew never learns whether a month is closed.
--
-- The clock: as month_close (U2), "ended" and "today" are the IST date of app.now(), which is now() for the app
-- and every API session (so app.today_ist() exactly); only a direct database session may set app.test_now, so
-- pgTAP tests the boundary at explicit instants. app.today_ist() itself reads now() and cannot be steered, so
-- it is not used here (WORKFLOWS §7.4 "As built (U3)").
--
-- EXPAND-ONLY: two unique constraints and a foreign key on a table that is empty in production, three new
-- app functions, two new public functions. Nothing existing changes. Append-only: never edit once applied.

-- 1. The chain, at the table level -----------------------------------------------------------------------------
alter table public.month_snapshots
  add constraint month_snapshots_org_month_id_key unique (org_id, month, id);
alter table public.month_snapshots
  add constraint month_snapshots_corrects_same_month_fkey
  foreign key (org_id, month, corrects_id) references public.month_snapshots (org_id, month, id);
alter table public.month_snapshots
  add constraint month_snapshots_corrects_once_key unique (corrects_id);
comment on constraint month_snapshots_corrects_same_month_fkey on public.month_snapshots is
  'v3.5 U3: a correction corrects a version of the same organization and the same month.';
comment on constraint month_snapshots_corrects_once_key on public.month_snapshots is
  'v3.5 U3: a version is corrected at most once, so the versions of a month form one line (each correction corrects the latest).';

-- 2. The document without its names ---------------------------------------------------------------------------
create function app.month_snapshot_figures(p_data jsonb)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_data is null then
    return null;
  end if;
  case jsonb_typeof(p_data)
    when 'object' then
      return (select coalesce(jsonb_object_agg(e.key, app.month_snapshot_figures(e.value)), '{}'::jsonb)
              from jsonb_each(p_data) e
              where e.key not in ('client_name', 'project_name', 'title', 'full_name', 'label'));
    when 'array' then
      return (select coalesce(jsonb_agg(app.month_snapshot_figures(a.value) order by a.n), '[]'::jsonb)
              from jsonb_array_elements(p_data) with ordinality a(value, n));
    else
      return p_data;
  end case;
end;
$$;
revoke all on function app.month_snapshot_figures(jsonb) from public, anon, authenticated;
grant execute on function app.month_snapshot_figures(jsonb) to service_role;
comment on function app.month_snapshot_figures(jsonb) is
  'v3.5 U3 (WORKFLOWS §7.1): a snapshot document with every name removed at any depth (client_name, project_name, title, full_name, label); what month_correct compares, so a rename alone is not a change. Internal (service_role).';

-- 3. "Changed since close" ------------------------------------------------------------------------------------
-- Revenue only (v3.5 Q6): the cycles (by cycle_id), their deliverables (by item_id, only inside a cycle that is
-- in both documents), the one-time lines (by project_id), the advance events (by advance_id and event) and the
-- six totals. Each line is compared on its figures only, never on a name or a note:
--   cycle, project: amount, potential, achieved, remaining, closed_not_achieved
--   item:           value, achieved, in_potential, closed_not_achieved
--   advance:        amount
-- A difference: { kind (added | removed | changed), line (cycle | item | project | advance_received |
-- advance_returned), id, cycle_id (an item's cycle, else null), what (plain words, today's names, else the
-- stored ones), before, after (the figures above, null on the missing side), cause }. cause is only for a
-- deliverable: the latest state change of the deliverable (or of the deliverable that carries its state) in
-- the history at or after p_since: { action (done | reopened | sent_back | cancelled | closed), by_id, by_name,
-- at }, or null. Ordered by line (cycle, item, project, advance received, advance returned), then id
-- (bytewise: JavaScript's string order). modules/revenue/domain has the twin (changedSinceClose).
create function app.month_revenue_changes(p_org uuid, p_stored jsonb, p_live jsonb, p_since timestamptz)
returns jsonb
language sql
stable
set search_path = ''
as $$
  with
  sc as (select e ->> 'cycle_id' as id, e from jsonb_array_elements(coalesce(p_stored #> '{revenue,cycles}', '[]'::jsonb)) e),
  lc as (select e ->> 'cycle_id' as id, e from jsonb_array_elements(coalesce(p_live #> '{revenue,cycles}', '[]'::jsonb)) e),
  sp as (select e ->> 'project_id' as id, e from jsonb_array_elements(coalesce(p_stored #> '{revenue,projects}', '[]'::jsonb)) e),
  lp as (select e ->> 'project_id' as id, e from jsonb_array_elements(coalesce(p_live #> '{revenue,projects}', '[]'::jsonb)) e),
  sa as (select e ->> 'advance_id' as id, e ->> 'event' as event, e from jsonb_array_elements(coalesce(p_stored #> '{revenue,advances}', '[]'::jsonb)) e),
  la as (select e ->> 'advance_id' as id, e ->> 'event' as event, e from jsonb_array_elements(coalesce(p_live #> '{revenue,advances}', '[]'::jsonb)) e),
  si as (select c.id as cycle_id, i ->> 'item_id' as id, i from sc c, jsonb_array_elements(coalesce(c.e -> 'items', '[]'::jsonb)) i),
  li as (select c.id as cycle_id, i ->> 'item_id' as id, i from lc c, jsonb_array_elements(coalesce(c.e -> 'items', '[]'::jsonb)) i),
  both_cycles as (select s.id, coalesce(l.e, s.e) ->> 'project_name' as project_name from sc s join lc l on l.id = s.id),
  lines as (
    select 1 as ord, coalesce(l.id, s.id) as id, null::text as cycle_id, 'cycle' as line,
      case when l.e is null then 'removed' when s.e is null then 'added' else 'changed' end as kind,
      format('%s · %s · %s', coalesce(l.e, s.e) ->> 'project_name', coalesce(l.e, s.e) ->> 'client_name',
             coalesce(l.e, s.e) ->> 'label') as what,
      case when s.e is null then null else jsonb_build_object('amount', s.e -> 'amount', 'potential', s.e -> 'potential',
        'achieved', s.e -> 'achieved', 'remaining', s.e -> 'remaining', 'closed_not_achieved', s.e -> 'closed_not_achieved') end as before,
      case when l.e is null then null else jsonb_build_object('amount', l.e -> 'amount', 'potential', l.e -> 'potential',
        'achieved', l.e -> 'achieved', 'remaining', l.e -> 'remaining', 'closed_not_achieved', l.e -> 'closed_not_achieved') end as after,
      null::jsonb as cause
    from sc s full join lc l on l.id = s.id
    union all
    select 2, coalesce(l.id, s.id), coalesce(l.cycle_id, s.cycle_id), 'item',
      case when l.i is null then 'removed' when s.i is null then 'added' else 'changed' end,
      format('%s · %s', coalesce(l.i, s.i) ->> 'title', b.project_name),
      case when s.i is null then null else jsonb_build_object('value', s.i -> 'value', 'achieved', s.i -> 'achieved',
        'in_potential', s.i -> 'in_potential', 'closed_not_achieved', s.i -> 'closed_not_achieved') end,
      case when l.i is null then null else jsonb_build_object('value', l.i -> 'value', 'achieved', l.i -> 'achieved',
        'in_potential', l.i -> 'in_potential', 'closed_not_achieved', l.i -> 'closed_not_achieved') end,
      (select jsonb_build_object('action', a.action, 'by_id', a.actor_id, 'by_name', m.full_name, 'at', a.at)
       from public.activity_log a
       left join public.members m on m.id = a.actor_id
       where a.org_id = p_org and a.entity = 'project_items'
         and a.entity_id in (select x::uuid from unnest(array[
               coalesce(l.id, s.id), l.i ->> 'leaf_item_id', s.i ->> 'leaf_item_id']) x where x is not null)
         and a.at >= p_since
         and a.action in ('done', 'reopened', 'sent_back', 'cancelled', 'closed')
       order by a.at desc, a.id desc
       limit 1)
    from si s
    full join li l on l.id = s.id
    join both_cycles b on b.id = coalesce(l.cycle_id, s.cycle_id)
    union all
    select 3, coalesce(l.id, s.id), null, 'project',
      case when l.e is null then 'removed' when s.e is null then 'added' else 'changed' end,
      format('%s · %s', coalesce(l.e, s.e) ->> 'project_name', coalesce(l.e, s.e) ->> 'client_name'),
      case when s.e is null then null else jsonb_build_object('amount', s.e -> 'amount', 'potential', s.e -> 'potential',
        'achieved', s.e -> 'achieved', 'remaining', s.e -> 'remaining', 'closed_not_achieved', s.e -> 'closed_not_achieved') end,
      case when l.e is null then null else jsonb_build_object('amount', l.e -> 'amount', 'potential', l.e -> 'potential',
        'achieved', l.e -> 'achieved', 'remaining', l.e -> 'remaining', 'closed_not_achieved', l.e -> 'closed_not_achieved') end,
      null
    from sp s full join lp l on l.id = s.id
    union all
    select case coalesce(l.event, s.event) when 'received' then 4 else 5 end, coalesce(l.id, s.id), null,
      'advance_' || coalesce(l.event, s.event),
      case when l.e is null then 'removed' when s.e is null then 'added' else 'changed' end,
      format('Advance %s · %s', coalesce(l.event, s.event), coalesce(l.e, s.e) ->> 'project_name'),
      case when s.e is null then null else jsonb_build_object('amount', s.e -> 'amount') end,
      case when l.e is null then null else jsonb_build_object('amount', l.e -> 'amount') end,
      null
    from sa s full join la l on l.id = s.id and l.event = s.event
  ),
  totals as (
    select k.ord, k.key, p_stored #> array['revenue', 'totals', k.key] as before, p_live #> array['revenue', 'totals', k.key] as after
    from (values (1, 'potential'), (2, 'achieved'), (3, 'remaining'), (4, 'closed_not_achieved'),
                 (5, 'advances_received'), (6, 'advances_returned')) k(ord, key)
  )
  select jsonb_build_object(
    'lines', coalesce((
      select jsonb_agg(jsonb_build_object('kind', x.kind, 'line', x.line, 'id', x.id, 'cycle_id', x.cycle_id,
          'what', x.what, 'before', x.before, 'after', x.after, 'cause', x.cause)
          order by x.ord, x.id collate "C")
      from lines x
      where x.before is null or x.after is null or x.before <> x.after), '[]'::jsonb),
    'totals', coalesce((
      select jsonb_agg(jsonb_build_object('key', t.key, 'before', t.before, 'after', t.after) order by t.ord)
      from totals t
      where t.before is distinct from t.after), '[]'::jsonb));
$$;
revoke all on function app.month_revenue_changes(uuid, jsonb, jsonb, timestamptz) from public, anon, authenticated;
grant execute on function app.month_revenue_changes(uuid, jsonb, jsonb, timestamptz) to service_role;
comment on function app.month_revenue_changes(uuid, jsonb, jsonb, timestamptz) is
  'v3.5 U3 (WORKFLOWS §7.1, v3.5 Q6): "Changed since close": two snapshot documents'' revenue lines and totals compared by stable id, figures only (never a name), with a deliverable''s latest state change since p_since. Holds amounts: internal (service_role), read only inside month_close_read.';

-- 4. The waiting list -----------------------------------------------------------------------------------------
-- WORKFLOWS §7.2 (v3.5 Q7): counts only, never an amount, for the organization's month M. An open deliverable of
-- an ended cycle with no carry decision is counted once, under carry_decisions; every other open deliverable of
-- M's cycles (an open or in-progress project's) is open_work. no_amount counts M's retainer cycles and one-time
-- lines reading "No amount set". claims_until is the 5th of the month after M (decision 16).
create function app.month_waiting(p_org uuid, p_month date, p_today date)
returns jsonb
language sql
stable
set search_path = ''
as $$
  with
  m as (select app.month_start(p_month) as d0, (app.month_start(p_month) + interval '1 month')::date as d1),
  cycle_ids as (
    select coalesce(array_agg(c.id), '{}'::uuid[]) as ids
    from public.project_cycles c
    join public.projects p on p.id = c.project_id and p.recurrence <> 'one_time'
    cross join m
    where c.org_id = p_org and c.period_start >= m.d0 and c.period_start < m.d1
  ),
  open_items as (
    select (c.period_end < p_today and i.carry_decision is null) as to_decide
    from public.project_items i
    join public.project_cycles c on c.id = i.cycle_id
    join public.projects p on p.id = c.project_id
    cross join m
    where c.org_id = p_org and i.state = 'open' and p.state in ('open', 'in_progress')
      and c.period_start >= m.d0 and c.period_start < m.d1
  ),
  k as (
    select
      (select count(*) from public.attendance_days a join public.members x on x.id = a.member_id cross join m
        where x.org_id = p_org and a.state = 'pending_review' and a.work_date >= m.d0 and a.work_date < m.d1)::integer as attendance,
      (select count(*) from public.leave_requests r join public.members x on x.id = r.member_id cross join m
        where x.org_id = p_org and r.state = 'submitted' and r.start_date < m.d1 and r.end_date >= m.d0)::integer as leave,
      (select count(*) from public.early_leave_requests r join public.attendance_days a on a.id = r.day_id cross join m
        where r.org_id = p_org and r.state = 'left_unanswered' and a.work_date >= m.d0 and a.work_date < m.d1)::integer as leaving_early,
      (select count(*) from public.extra_work_notes n join public.members x on x.id = n.member_id cross join m
        where x.org_id = p_org and n.state = 'submitted' and n.work_date >= m.d0 and n.work_date < m.d1)::integer as extra_work,
      (select count(*) from public.expense_claims e join public.members x on x.id = e.member_id cross join m
        where x.org_id = p_org and e.state = 'submitted' and e.expense_date >= m.d0 and e.expense_date < m.d1)::integer as expense_claims,
      (select count(*) from open_items o where not o.to_decide)::integer as open_work,
      (select count(*) from open_items o where o.to_decide)::integer as carry_decisions,
      ((select count(*) from app.revenue_cycles((select c.ids from cycle_ids c)) r where r.org_id = p_org and r.amount is null)
       + (select count(*) from public.revenue_project_lines_v l cross join m
           where l.org_id = p_org and l.month = m.d0 and l.amount is null))::integer as no_amount,
      (select count(*) from public.revenue_project_lines_v l cross join m
        where l.org_id = p_org and l.month = m.d0 and l.ready_to_complete)::integer as ready_to_complete
  )
  select jsonb_build_object(
    'attendance', k.attendance, 'leave', k.leave, 'leaving_early', k.leaving_early, 'extra_work', k.extra_work,
    'expense_claims', k.expense_claims, 'open_work', k.open_work, 'carry_decisions', k.carry_decisions,
    'no_amount', k.no_amount, 'ready_to_complete', k.ready_to_complete,
    'total', k.attendance + k.leave + k.leaving_early + k.extra_work + k.expense_claims + k.open_work
             + k.carry_decisions + k.no_amount + k.ready_to_complete,
    'claims_until', (select m.d1 + 4 from m),
    'claims_open', p_today <= (select m.d1 + 4 from m))
  from k;
$$;
revoke all on function app.month_waiting(uuid, date, date) from public, anon, authenticated;
grant execute on function app.month_waiting(uuid, date, date) to service_role;
comment on function app.month_waiting(uuid, date, date) is
  'v3.5 U3 (WORKFLOWS §7.2, v3.5 Q7): the close screen''s waiting list for an organization''s month: counts per kind and their total, never an amount; claims_until = the 5th of the next month. Reads the money views for the caller, so it runs only inside month_close_read for the Owner. Internal (service_role).';

-- 5. month_correct --------------------------------------------------------------------------------------------
create function public.month_correct(month date, note text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller public.members;
  v_month date := app.month_start(month_correct.month);
  v_note text := btrim(coalesce(month_correct.note, ''));
  v_name text;
  v_latest public.month_snapshots;
  v_data jsonb;
  v_id uuid;
begin
  if not app.has_permission('months.close') then
    perform app.fail('FORBIDDEN', 'Only the Owner corrects a month.');
  end if;
  select m.* into v_caller from app.current_member() m;
  if v_month is null then
    perform app.fail('VALIDATION', 'Pick a month.');
  end if;
  if length(v_note) < 10 or length(v_note) > 500 then
    perform app.fail('VALIDATION', 'Write a note of 10 to 500 characters.');
  end if;
  v_name := to_char(v_month, 'FMMonth YYYY');

  -- The same lock as month_close: a close and a correction of one month never run side by side, and two
  -- taps never store two versions N+1 (the unique (org_id, month, version) and corrects_id are the backstop).
  perform pg_advisory_xact_lock(hashtextextended('month_close:' || v_caller.org_id::text || ':' || v_month::text, 0));
  select s.* into v_latest from public.month_snapshots s
  where s.org_id = v_caller.org_id and s.month = v_month
  order by s.version desc limit 1;
  if v_latest.id is null then
    perform app.fail('INVALID_STATE', format('%s isn''t closed.', v_name));
  end if;

  v_data := app.month_snapshot_build(v_caller.org_id, v_month);
  if app.month_snapshot_figures(v_data) = app.month_snapshot_figures(v_latest.data) then
    perform app.fail('INVALID_STATE', 'Nothing changed.');
  end if;

  insert into public.month_snapshots (org_id, month, version, data, closed_by, corrects_id, correction_note)
  values (v_caller.org_id, v_month, v_latest.version + 1, v_data, v_caller.id, v_latest.id, v_note)
  returning id into v_id;

  -- The history entry: the month and the version only. No diff, no amount, no note (WORKFLOWS §7.4).
  insert into public.activity_log (org_id, actor_id, entity, entity_id, action, meta)
  values (v_caller.org_id, v_caller.id, 'month_snapshots', v_id, 'corrected',
          jsonb_build_object('month', v_month, 'version', v_latest.version + 1));
  return v_latest.version + 1;
end;
$$;
revoke all on function public.month_correct(date, text) from public, anon;
grant execute on function public.month_correct(date, text) to authenticated, service_role;
comment on function public.month_correct(date, text) is
  'v3.5 (months.close, WORKFLOWS §7.4): the Owner corrects a closed IST month: a full rebuild from live data stored as version N+1 (corrects_id = the latest version, the trimmed note 10-500 characters), every earlier version kept; refused "Nothing changed." when the rebuild equals the latest version with names ignored. One history entry (month and version, no amount, no note), nobody notified. Returns the new version.';

-- 6. month_close_read -----------------------------------------------------------------------------------------
-- Security definer (WORKFLOWS §7.4 first said invoker): "Changed since close" rebuilds the month live through
-- app.month_snapshot_build, which authenticated may never execute. So the read checks finance.view itself,
-- first, with one refusal whatever the month (an Admin never learns whether a month is closed), and every read
-- in it is filtered to the caller's organization.
create function public.month_close_read(month date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_month date := app.month_start(month_close_read.month);
  v_today date := app.to_ist_date(app.now());
  v_name text;
  v_first date;
  v_latest public.month_snapshots;
  v_reason text;
  v_message text;
  v_versions jsonb;
begin
  if not app.has_permission('finance.view') then
    perform app.fail('FORBIDDEN', 'Only the Owner sees a month''s close.');
  end if;
  select c.org_id into v_org from app.current_member() c;
  if v_month is null then
    perform app.fail('VALIDATION', 'Pick a month.');
  end if;
  v_name := to_char(v_month, 'FMMonth YYYY');
  v_first := app.first_priced_month(v_org);

  select s.* into v_latest from public.month_snapshots s
  where s.org_id = v_org and s.month = v_month
  order by s.version desc limit 1;

  -- Can it be closed, and why not: month_close's checks in its order, with its wordings.
  if v_month >= app.month_start(v_today) then
    v_reason := 'not_ended';
    v_message := format('%s hasn''t ended yet.', v_name);
  elsif v_latest.id is null and (v_first is null or v_month < v_first) then
    v_reason := 'nothing_to_close';
    v_message := 'Nothing to close.';
  elsif v_latest.id is not null then
    v_reason := 'closed';
    v_message := format('%s is already closed.', v_name);
  end if;

  if v_latest.id is null then
    return jsonb_build_object(
      'month', v_month, 'month_name', v_name, 'closed', false,
      'can_close', v_reason is null,
      'cannot_close', case when v_reason is null then null
                           else jsonb_build_object('reason', v_reason, 'message', v_message) end,
      'waiting', case when v_reason = 'nothing_to_close' then null else app.month_waiting(v_org, v_month, v_today) end,
      'latest', null, 'versions', '[]'::jsonb, 'changed_since_close', null);
  end if;

  select jsonb_agg(jsonb_build_object(
      'id', s.id, 'version', s.version, 'closed_at', s.closed_at, 'closed_by_id', s.closed_by,
      'closed_by_name', m.full_name, 'corrects_id', s.corrects_id, 'note', s.correction_note)
      order by s.version)
  into v_versions
  from public.month_snapshots s
  left join public.members m on m.id = s.closed_by
  where s.org_id = v_org and s.month = v_month;

  return jsonb_build_object(
    'month', v_month, 'month_name', v_name, 'closed', true,
    'can_close', false,
    'cannot_close', jsonb_build_object('reason', v_reason, 'message', v_message),
    'waiting', null,
    'latest', jsonb_build_object(
      'id', v_latest.id, 'version', v_latest.version, 'closed_at', v_latest.closed_at,
      'closed_by_id', v_latest.closed_by,
      'closed_by_name', (select m.full_name from public.members m where m.id = v_latest.closed_by),
      'data', v_latest.data),
    'versions', v_versions,
    'changed_since_close', app.month_revenue_changes(v_org, v_latest.data,
                             app.month_snapshot_build(v_org, v_month), v_latest.closed_at));
end;
$$;
revoke all on function public.month_close_read(date) from public, anon;
grant execute on function public.month_close_read(date) to authenticated, service_role;
comment on function public.month_close_read(date) is
  'v3.5 (finance.view, WORKFLOWS §7.4): the close screen''s and a closed month''s one read: can it be closed and why not, the waiting list''s counts (not closed), the latest snapshot with who closed it, every version''s header, and "Changed since close" (the revenue lines and totals of a live rebuild against the latest version, by stable id). Security definer with its own finance.view check (the live rebuild uses the internal builder); one refusal for everyone else.';
