-- Unit 7B (7.3 + 7.4, kickoff 7 decisions 24 and 25, amendment C E4; ARCHITECTURE §10, WORKFLOWS §8a):
-- what the client-work screens need from the database. EXPAND-ONLY: one table joins a publication,
-- one partial index, and functions re-created with the same signatures (nothing dropped, no grant
-- changed, no column touched).
--
-- 1. Realtime (kickoff 7 decision 24): `project_items` joins the supabase_realtime publication that
--    5.1 and 6A grew, so Today's Client work and Approvals' Client items re-read through
--    `LiveUpdates` (the same client and channel; RLS authorises each change: Crew get nothing, an
--    Admin only their clients' items). `project_items` carries no amount, ever (ADR-0007).
-- 2. The end-of-day report's Client work section (kickoff 7 decision 25, refreshed 2026-10-08):
--    `app.eod_report_payload` gains `client_work`: per client Admin (the Admin who ran the client at
--    the moment, `client_admin_assignments`; a client with no Admin is the Owner's own, admin_id
--    null), the items marked done (the history's `done` entries: "Not done" and a rejection clear
--    `done_at`, 7A mechanics (11)), approved and sent back (`item_reviews`), closed (cancelled that
--    day: a cancel, a carry "close" or a project cancel), carried forward, and the projects
--    completed that day (the history's `completed` entries); counts and titles, never an amount.
--    `app.eod_report_zero` and `app.eod_report_text` read it too.
-- 3. The weekly digest's client work per Admin (amendment C E4, replacing issue #56 Q3's line):
--    `app.digest_weekly_payload` gains `client_work`: per Admin, the items done and projects
--    completed in the window (from the saved end-of-day reports only, as every other weekly number)
--    and the items overdue now (live: open, planned before today IST, by the client's current
--    Admin); counts only. `app.digest_weekly_zero` reads it.

-- 1. Realtime ---------------------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'project_items'
  ) then
    alter publication supabase_realtime add table public.project_items;
  end if;
end;
$$;

-- 2. The end-of-day report's Client work section -----------------------------------------------------
-- The day's `done` and `completed` history entries are read by time, never by row: a partial index
-- keeps that read small as the history grows.
create index activity_log_client_work_day_idx on public.activity_log (org_id, at)
  where (entity = 'project_items' and action = 'done') or (entity = 'projects' and action = 'completed');

create or replace function app.eod_report_payload(p_org uuid, p_date date, p_now timestamptz)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_from timestamptz := app.ist_day_start(p_date);
  v_to timestamptz := app.ist_day_start(p_date + 1);
  v_holiday text;
  v_weekly_off boolean;
  v_attendance jsonb;
  v_decisions jsonb;
  v_tasks jsonb;
  v_approvals jsonb;
  v_tomorrow jsonb;
  v_client_work jsonb;
  v_empty constant jsonb := '{"count": 0, "more": 0, "items": []}'::jsonb;
begin
  select h.name into v_holiday from public.holidays h where h.org_id = p_org and h.date = p_date;
  select extract(dow from p_date)::int = any (s.weekly_off_days) into v_weekly_off
  from public.org_settings s where s.org_id = p_org;

  -- Attendance: every active employee (never the Owner, never a freelancer: they have no day) with
  -- a day on the date: their times, what the day stands at, and the flags. A day still waiting for
  -- the Owner counts by its choice or the system's proposal, as the digest and Start day read it.
  with days as (
    select m.id, m.full_name,
           case when d.state = 'pending_review'
                then coalesce(d.submitted_choice::text::public.day_status, d.final_status)
                else d.final_status end as status,
           d.state = 'pending_review' as waiting,
           d.proposed_by_system and d.state = 'pending_review' as proposed,
           d.started_at, d.ended_at, d.end_not_recorded, d.overtime_flag, d.overtime_reason
    from public.members m
    join public.attendance_days d on d.member_id = m.id and d.work_date = p_date
    where m.org_id = p_org and m.status = 'active' and m.role <> 'owner' and m.engagement = 'permanent'
  )
  select jsonb_build_object(
    'counts', jsonb_build_object(
      'present', count(*) filter (where status = 'present'),
      'on_leave', count(*) filter (where status in ('leave', 'half_day', 'comp_leave')),
      'absent', count(*) filter (where status = 'absent'),
      'proposed_absent', count(*) filter (where status = 'absent' and proposed),
      'waiting', count(*) filter (where waiting),
      'end_not_recorded', count(*) filter (where end_not_recorded),
      'overtime', count(*) filter (where overtime_flag)),
    'people', coalesce(jsonb_agg(jsonb_build_object(
      'member_id', id, 'name', full_name, 'status', status, 'waiting', waiting, 'proposed', proposed,
      'started_at', started_at, 'ended_at', ended_at, 'end_not_recorded', end_not_recorded,
      'overtime', overtime_flag, 'overtime_reason', overtime_reason)
      order by full_name, id), '[]'::jsonb))
  into v_attendance
  from days;

  -- The decisions made that day: the Owner's attendance decisions (events with an actor: the
  -- automatic ones have none), leave decided, comp leave granted, revoked or reviewed, and expense
  -- claims decided or paid as a count (never an amount).
  select jsonb_build_object(
    'attendance', (
      select count(*) from public.attendance_events e
      join public.attendance_days d on d.id = e.attendance_day_id
      join public.members m on m.id = d.member_id
      where m.org_id = p_org and e.action in ('approved', 'corrected') and e.actor_id is not null
        and e.at >= v_from and e.at < v_to),
    'leave', jsonb_build_object(
      'approved', (
        select count(*) from public.leave_requests r join public.members m on m.id = r.member_id
        where m.org_id = p_org and r.state = 'approved' and r.decided_at >= v_from and r.decided_at < v_to),
      'rejected', (
        select count(*) from public.leave_requests r join public.members m on m.id = r.member_id
        where m.org_id = p_org and r.state = 'rejected' and r.decided_at >= v_from and r.decided_at < v_to)),
    'comp_leave', jsonb_build_object(
      'granted', (
        select count(*) from public.comp_leave_credits c join public.members m on m.id = c.member_id
        where m.org_id = p_org and c.granted_at >= v_from and c.granted_at < v_to),
      'revoked', (
        select count(*) from public.comp_leave_credits c join public.members m on m.id = c.member_id
        where m.org_id = p_org and c.revoked_at >= v_from and c.revoked_at < v_to),
      'reviewed', (
        select count(*) from public.extra_work_notes n join public.members m on m.id = n.member_id
        where m.org_id = p_org and n.decided_at >= v_from and n.decided_at < v_to)),
    'expense_claims', (
      select count(*) from public.expense_claims c join public.members m on m.id = c.member_id
      where m.org_id = p_org
        and ((c.decided_at >= v_from and c.decided_at < v_to) or (c.paid_at >= v_from and c.paid_at < v_to))))
  into v_decisions;

  -- Tasks: completed (Owner-approved) that day; handed in and waiting now; overdue now with the
  -- primary owner's late reason; cancelled that day with the reason; created that day. Freelancers
  -- are counted separately (the primary owner's engagement). Lists of up to 50, then a count.
  with t as (
    select t.id, t.title, t.state, t.due_at, t.late_reason, t.cancelled_reason, t.completed_at,
           t.cancelled_at, t.created_at, t.submitted_at,
           m.full_name as owner_name, m.engagement = 'freelance' as freelance
    from public.tasks t
    join public.members m on m.id = t.primary_owner_id
    where t.org_id = p_org and t.archived_at is null
  ),
  groups as (
    select 'completed' as grp, t.* from t where t.completed_at >= v_from and t.completed_at < v_to
    union all
    select 'handed_in', t.* from t where t.state in ('submitted', 'admin_approved')
    union all
    select 'overdue', t.* from t where t.state not in ('completed', 'cancelled') and t.due_at < p_now
    union all
    select 'cancelled', t.* from t where t.cancelled_at >= v_from and t.cancelled_at < v_to
    union all
    select 'created', t.* from t where t.created_at >= v_from and t.created_at < v_to
  ),
  numbered as (
    select g.*, row_number() over (partition by g.grp order by g.due_at, g.title, g.id) as n from groups g
  ),
  per_group as (
    select grp,
           count(*) as total,
           count(*) filter (where freelance) as freelance_total,
           coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
             'id', id, 'title', title, 'owner', owner_name, 'freelance', freelance,
             'due_at', case when grp = 'overdue' then due_at end,
             'late_reason', case when grp = 'overdue' then late_reason end,
             'since', case when grp = 'handed_in' then submitted_at end,
             'reason', case when grp = 'cancelled' then cancelled_reason end))
             order by n) filter (where n <= 50), '[]'::jsonb) as items
    from numbered
    group by grp
  ),
  shaped as (
    select grp, jsonb_build_object(
      'count', total, 'freelance', freelance_total, 'more', greatest(total - 50, 0), 'items', items) as value
    from per_group
  )
  select jsonb_build_object(
    'completed', coalesce((select value from shaped where grp = 'completed'), '{"count": 0, "freelance": 0, "more": 0, "items": []}'::jsonb),
    'handed_in', coalesce((select value from shaped where grp = 'handed_in'), '{"count": 0, "freelance": 0, "more": 0, "items": []}'::jsonb),
    'overdue', coalesce((select value from shaped where grp = 'overdue'), '{"count": 0, "freelance": 0, "more": 0, "items": []}'::jsonb),
    'cancelled', coalesce((select value from shaped where grp = 'cancelled'), '{"count": 0, "freelance": 0, "more": 0, "items": []}'::jsonb),
    'created', coalesce((select value from shaped where grp = 'created'), '{"count": 0, "freelance": 0, "more": 0, "items": []}'::jsonb))
  into v_tasks;

  -- Approvals: a count per approver at each step that day (an approval, or changes requested).
  select coalesce(jsonb_agg(jsonb_build_object(
    'reviewer_id', a.reviewer_id, 'name', a.name, 'step', a.step,
    'approved', a.approved, 'changes_requested', a.changes_requested)
    order by a.step desc, a.name, a.reviewer_id), '[]'::jsonb)
  into v_approvals
  from (
    select r.reviewer_id, coalesce(m.full_name, 'Someone') as name, r.step,
           count(*) filter (where r.decision = 'approved') as approved,
           count(*) filter (where r.decision = 'rejected') as changes_requested
    from public.task_reviews r
    join public.tasks t on t.id = r.task_id
    left join public.members m on m.id = r.reviewer_id
    where t.org_id = p_org and r.at >= v_from and r.at < v_to
    group by r.reviewer_id, m.full_name, r.step
  ) a;

  -- Tomorrow's events: the event tasks on the next IST date, with their people.
  select jsonb_build_object(
    'date', p_date + 1,
    'events', coalesce(jsonb_agg(jsonb_build_object(
      'id', e.id, 'title', e.title, 'start_at', e.event_start_at, 'end_at', e.event_end_at,
      'location', e.location, 'people', e.people)
      order by e.event_start_at nulls first, e.title, e.id), '[]'::jsonb))
  into v_tomorrow
  from (
    select t.id, t.title, t.event_start_at, t.event_end_at, t.location,
           coalesce((select jsonb_agg(m.full_name order by m.full_name)
                     from public.task_assignees a join public.members m on m.id = a.member_id
                     where a.task_id = t.id and a.removed_at is null), '[]'::jsonb) as people
    from public.tasks t
    where t.org_id = p_org and t.archived_at is null and t.state <> 'cancelled' and t.event_date = p_date + 1
  ) e;


  -- Client work (7.4, kickoff 7 decision 25): what happened to client items that IST day, per client
  -- Admin (the one who ran the client at that moment; null: a client with no Admin, the Owner's own).
  -- Done = the history's `done` entries ("Not done" and a rejection clear done_at); approved and sent
  -- back = the reviews; closed = cancelled that day (a cancel, a carry "close", a project cancel);
  -- carried = carried forward that day; projects completed = the history's `completed` entries. An
  -- item counts once per group however often it moved. Lists of up to 50, then a count. No amount.
  with ev as (
    select distinct on (e.grp, e.id) e.*
    from (
      select 'done'::text as grp, i.id, i.title, p.name as project, c.name as client, p.client_id,
             a.at, null::text as reason
      from public.activity_log a
      join public.project_items i on i.id = a.entity_id
      join public.projects p on p.id = i.project_id
      join public.clients c on c.id = p.client_id
      where a.org_id = p_org and a.entity = 'project_items' and a.action = 'done'
        and a.at >= v_from and a.at < v_to
      union all
      select case when r.decision = 'approved' then 'approved' else 'sent_back' end, i.id, i.title,
             p.name, c.name, p.client_id, r.at, case when r.decision = 'rejected' then r.reason end
      from public.item_reviews r
      join public.project_items i on i.id = r.item_id
      join public.projects p on p.id = i.project_id
      join public.clients c on c.id = p.client_id
      where r.org_id = p_org and r.at >= v_from and r.at < v_to
      union all
      select 'closed', i.id, i.title, p.name, c.name, p.client_id, i.cancelled_at, i.cancelled_reason
      from public.project_items i
      join public.projects p on p.id = i.project_id
      join public.clients c on c.id = p.client_id
      where i.org_id = p_org and i.cancelled_at >= v_from and i.cancelled_at < v_to
      union all
      select 'carried', i.id, i.title, p.name, c.name, p.client_id, i.carry_decided_at, null
      from public.project_items i
      join public.projects p on p.id = i.project_id
      join public.clients c on c.id = p.client_id
      where i.org_id = p_org and i.carry_decision = 'carry_forward'
        and i.carry_decided_at >= v_from and i.carry_decided_at < v_to
      union all
      select 'projects_completed', p.id, p.name, p.name, c.name, p.client_id, a.at, null
      from public.activity_log a
      join public.projects p on p.id = a.entity_id
      join public.clients c on c.id = p.client_id
      where a.org_id = p_org and a.entity = 'projects' and a.action = 'completed'
        and a.at >= v_from and a.at < v_to
    ) e
    order by e.grp, e.id, e.at desc
  ),
  attributed as (
    select ev.*, (
      select s.admin_id from public.client_admin_assignments s
      where s.client_id = ev.client_id and s.from_at <= ev.at and (s.to_at is null or s.to_at > ev.at)
      order by s.from_at desc limit 1) as admin_id
    from ev
  ),
  numbered as (
    select x.*, row_number() over (partition by x.admin_id, x.grp order by x.at, x.title, x.id) as n
    from attributed x
  ),
  per_group as (
    select admin_id, grp, jsonb_build_object(
      'count', count(*), 'more', greatest(count(*) - 50, 0),
      'items', coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
        'id', id, 'title', title, 'project', case when grp <> 'projects_completed' then project end,
        'client', client, 'reason', reason)) order by n) filter (where n <= 50), '[]'::jsonb)) as value
    from numbered
    group by admin_id, grp
  ),
  per_admin as (
    select g.admin_id, m.full_name as name, jsonb_object_agg(g.grp, g.value) as groups
    from per_group g
    left join public.members m on m.id = g.admin_id
    group by g.admin_id, m.full_name
  )
  select jsonb_build_object(
    'admins', coalesce((
      select jsonb_agg(jsonb_build_object(
        'admin_id', a.admin_id, 'name', a.name,
        'done', coalesce(a.groups -> 'done', v_empty),
        'approved', coalesce(a.groups -> 'approved', v_empty),
        'sent_back', coalesce(a.groups -> 'sent_back', v_empty),
        'closed', coalesce(a.groups -> 'closed', v_empty),
        'carried', coalesce(a.groups -> 'carried', v_empty),
        'projects_completed', coalesce(a.groups -> 'projects_completed', v_empty))
        order by a.name nulls last, a.admin_id)
      from per_admin a), '[]'::jsonb),
    'counts', (
      select jsonb_build_object(
        'done', count(*) filter (where grp = 'done'),
        'approved', count(*) filter (where grp = 'approved'),
        'sent_back', count(*) filter (where grp = 'sent_back'),
        'closed', count(*) filter (where grp = 'closed'),
        'carried', count(*) filter (where grp = 'carried'),
        'projects_completed', count(*) filter (where grp = 'projects_completed'))
      from attributed))
  into v_client_work;

  return jsonb_build_object(
    'date', p_date,
    'day_off', jsonb_build_object('holiday', v_holiday, 'weekly_off', coalesce(v_weekly_off, false)),
    'attendance', v_attendance,
    'decisions', v_decisions,
    'tasks', v_tasks,
    'approvals', v_approvals,
    'tomorrow', v_tomorrow,
    'client_work', v_client_work);
end;
$$;

-- 3. The weekly digest's client work per Admin ------------------------------------------------------
create or replace function app.digest_weekly_payload(p_org uuid, p_now timestamptz)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_today date := app.to_ist_date(p_now);
  -- The window (amended decision 23): since the last digest sent before today, capped at seven days.
  v_last date := (
    select max(app.to_ist_date(n.created_at))
    from public.notifications n
    where n.org_id = p_org and n.kind = 'owner_digest_weekly'
      and n.created_at < app.ist_day_start(app.to_ist_date(p_now)));
  v_from date := greatest(app.to_ist_date(p_now) - 7, coalesce(v_last, app.to_ist_date(p_now) - 7));
  v_to date := app.to_ist_date(p_now) - 1;
  v_days jsonb;
  v_totals jsonb;
  v_daily jsonb;
  v_now jsonb;
  v_ahead jsonb;
  v_client_work jsonb;
begin
  -- The window's numbers, from its saved reports only (so the email and the reports agree).
  with dates as (
    select s::date as day from generate_series(v_from, v_to, interval '1 day') s
  ),
  days as (
    select d.day, r.id as report_id, r.data
    from dates d
    left join public.eod_reports r on r.org_id = p_org and r.report_date = d.day
  )
  select jsonb_agg(jsonb_build_object(
           'date', day, 'report_id', report_id, 'saved', data is not null,
           'present', coalesce((data #>> '{attendance,counts,present}')::int, 0),
           'on_leave', coalesce((data #>> '{attendance,counts,on_leave}')::int, 0),
           'absent', coalesce((data #>> '{attendance,counts,absent}')::int, 0),
           'end_not_recorded', coalesce((data #>> '{attendance,counts,end_not_recorded}')::int, 0),
           'overtime', coalesce((data #>> '{attendance,counts,overtime}')::int, 0),
           'completed', coalesce((data #>> '{tasks,completed,count}')::int, 0),
           'cancelled', coalesce((data #>> '{tasks,cancelled,count}')::int, 0),
           'created', coalesce((data #>> '{tasks,created,count}')::int, 0),
           'decisions', coalesce((data #>> '{decisions,attendance}')::int, 0)
             + coalesce((data #>> '{decisions,leave,approved}')::int, 0)
             + coalesce((data #>> '{decisions,leave,rejected}')::int, 0)
             + coalesce((data #>> '{decisions,comp_leave,granted}')::int, 0)
             + coalesce((data #>> '{decisions,comp_leave,revoked}')::int, 0)
             + coalesce((data #>> '{decisions,comp_leave,reviewed}')::int, 0)
             + coalesce((data #>> '{decisions,expense_claims}')::int, 0),
           'holiday', data #>> '{day_off,holiday}',
           'weekly_off', coalesce((data #>> '{day_off,weekly_off}')::boolean, false))
         order by day)
  into v_days
  from days;

  select jsonb_build_object(
    'present', sum((d ->> 'present')::int),
    'on_leave', sum((d ->> 'on_leave')::int),
    'absent', sum((d ->> 'absent')::int),
    'end_not_recorded', sum((d ->> 'end_not_recorded')::int),
    'overtime', sum((d ->> 'overtime')::int),
    'completed', sum((d ->> 'completed')::int),
    'cancelled', sum((d ->> 'cancelled')::int),
    'created', sum((d ->> 'created')::int),
    'decisions', sum((d ->> 'decisions')::int),
    'missing', count(*) filter (where not (d ->> 'saved')::boolean))
  into v_totals
  from jsonb_array_elements(v_days) d;

  -- Now: what waits for the Owner, what is overdue, who can't be reached (the daily digest's own
  -- counts, so the two agree), plus the attendance days and extra-work notes waiting.
  v_daily := app.owner_digest_payload(p_org, p_now);
  select jsonb_build_object(
    'waiting', jsonb_build_object(
      'tasks', coalesce((v_daily #>> '{tasks,waiting_for_owner}')::int, 0),
      'leave', coalesce((v_daily #>> '{requests,leave}')::int, 0),
      'expense_claims', coalesce((v_daily #>> '{requests,expense_claims}')::int, 0),
      'attendance', (
        select count(*) from public.attendance_days d join public.members m on m.id = d.member_id
        where m.org_id = p_org and m.status = 'active' and d.state = 'pending_review'),
      'extra_work', (
        select count(*) from public.extra_work_notes n join public.members m on m.id = n.member_id
        where m.org_id = p_org and m.status = 'active' and n.state = 'submitted')),
    'overdue', coalesce((v_daily #>> '{tasks,overdue}')::int, 0),
    'unreachable', coalesce(v_daily -> 'unreachable', '{"count": 0, "names": [], "more": 0}'::jsonb))
  into v_now;

  -- The week ahead (today and the next six days): approved and pending leave, event tasks, holidays.
  select jsonb_build_object(
    'from', v_today, 'to', v_today + 6,
    'leave', coalesce((
      select jsonb_agg(jsonb_build_object(
        'member_id', r.member_id, 'name', m.full_name, 'type', r.type,
        'from', greatest(r.start_date, v_today), 'to', least(r.end_date, v_today + 6),
        'pending', r.state = 'submitted')
        order by greatest(r.start_date, v_today), m.full_name, r.id)
      from public.leave_requests r
      join public.members m on m.id = r.member_id
      where m.org_id = p_org and m.status = 'active'
        and r.state in ('approved', 'submitted') and not (r.state = 'submitted' and r.requests_cancellation)
        and r.start_date <= v_today + 6 and r.end_date >= v_today), '[]'::jsonb),
    'events', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', t.id, 'title', t.title, 'date', t.event_date, 'start_at', t.event_start_at, 'location', t.location)
        order by t.event_date, t.event_start_at nulls first, t.title, t.id)
      from public.tasks t
      where t.org_id = p_org and t.archived_at is null and t.state <> 'cancelled'
        and t.event_date between v_today and v_today + 6), '[]'::jsonb),
    'holidays', coalesce((
      select jsonb_agg(jsonb_build_object('date', h.date, 'name', h.name) order by h.date)
      from public.holidays h where h.org_id = p_org and h.date between v_today and v_today + 6), '[]'::jsonb))
  into v_ahead;


  -- Client work per Admin (amendment C E4, owner 2026-10-08; replaces issue #56 Q3's line): the items
  -- done and the projects completed in the window from its saved reports (each event under the Admin
  -- who ran the client then), and the items overdue now (open, planned before today IST), under the
  -- client's current Admin. A client with no Admin is the Owner's own (admin_id null). Counts only.
  with saved as (
    select coalesce(e ->> 'admin_id', '') as admin_key,
           sum(coalesce((e #>> '{done,count}')::int, 0)) as done,
           sum(coalesce((e #>> '{projects_completed,count}')::int, 0)) as completed
    from public.eod_reports r
    cross join lateral jsonb_array_elements(coalesce(r.data #> '{client_work,admins}', '[]'::jsonb)) e
    where r.org_id = p_org and r.report_date between v_from and v_to
    group by 1
  ),
  overdue as (
    select coalesce(c.admin_id::text, '') as admin_key, count(*) as overdue
    from public.project_items i
    join public.projects p on p.id = i.project_id
    join public.clients c on c.id = p.client_id
    where i.org_id = p_org and i.state = 'open' and i.planned_date < v_today
    group by 1
  ),
  merged as (
    select coalesce(s.admin_key, o.admin_key) as admin_key, coalesce(s.done, 0) as done,
           coalesce(s.completed, 0) as completed, coalesce(o.overdue, 0) as overdue
    from saved s
    full join overdue o on o.admin_key = s.admin_key
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'admin_id', nullif(x.admin_key, ''), 'name', m.full_name,
           'done', x.done, 'overdue', x.overdue, 'projects_completed', x.completed)
           order by m.full_name nulls last, x.admin_key), '[]'::jsonb)
  into v_client_work
  from merged x
  left join public.members m on m.id = nullif(x.admin_key, '')::uuid
  where x.done + x.overdue + x.completed > 0;

  return jsonb_build_object(
    'date', v_today,
    'week', jsonb_build_object('from', v_from, 'to', v_to),
    'days', v_days,
    'totals', v_totals,
    'now', v_now,
    'ahead', v_ahead,
    'client_work', v_client_work);
end;
$$;

-- The zero checks and the notification line read the new sections too. --------------------------------
create or replace function app.eod_report_zero(p jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce((p #>> '{attendance,counts,present}')::int, 0) = 0
     and coalesce((p #>> '{attendance,counts,on_leave}')::int, 0) = 0
     and coalesce((p #>> '{attendance,counts,absent}')::int, 0) = 0
     and coalesce((p #>> '{attendance,counts,waiting}')::int, 0) = 0
     and coalesce((p #>> '{attendance,counts,end_not_recorded}')::int, 0) = 0
     and coalesce((p #>> '{attendance,counts,overtime}')::int, 0) = 0
     and coalesce(jsonb_array_length(p #> '{attendance,people}'), 0) = 0
     and coalesce((p #>> '{decisions,attendance}')::int, 0) = 0
     and coalesce((p #>> '{decisions,leave,approved}')::int, 0) = 0
     and coalesce((p #>> '{decisions,leave,rejected}')::int, 0) = 0
     and coalesce((p #>> '{decisions,comp_leave,granted}')::int, 0) = 0
     and coalesce((p #>> '{decisions,comp_leave,revoked}')::int, 0) = 0
     and coalesce((p #>> '{decisions,comp_leave,reviewed}')::int, 0) = 0
     and coalesce((p #>> '{decisions,expense_claims}')::int, 0) = 0
     and coalesce((p #>> '{tasks,completed,count}')::int, 0) = 0
     and coalesce((p #>> '{tasks,handed_in,count}')::int, 0) = 0
     and coalesce((p #>> '{tasks,overdue,count}')::int, 0) = 0
     and coalesce((p #>> '{tasks,cancelled,count}')::int, 0) = 0
     and coalesce((p #>> '{tasks,created,count}')::int, 0) = 0
     and coalesce(jsonb_array_length(p -> 'approvals'), 0) = 0
     and coalesce(jsonb_array_length(p #> '{tomorrow,events}'), 0) = 0
     -- 7.4: the Client work section (absent from reports saved before it).
     and coalesce((p #>> '{client_work,counts,done}')::int, 0) = 0
     and coalesce((p #>> '{client_work,counts,approved}')::int, 0) = 0
     and coalesce((p #>> '{client_work,counts,sent_back}')::int, 0) = 0
     and coalesce((p #>> '{client_work,counts,closed}')::int, 0) = 0
     and coalesce((p #>> '{client_work,counts,carried}')::int, 0) = 0
     and coalesce((p #>> '{client_work,counts,projects_completed}')::int, 0) = 0;
$$;

create or replace function app.eod_report_text(p jsonb)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_parts text[] := '{}';
  v_tasks text[] := '{}';
  v_items text[] := '{}';
begin
  if (p #>> '{attendance,counts,present}')::int > 0 then
    v_parts := v_parts || ((p #>> '{attendance,counts,present}') || ' present');
  end if;
  if (p #>> '{attendance,counts,on_leave}')::int > 0 then
    v_parts := v_parts || ((p #>> '{attendance,counts,on_leave}') || ' on leave');
  end if;
  if (p #>> '{attendance,counts,absent}')::int > 0 then
    v_parts := v_parts || ((p #>> '{attendance,counts,absent}') || ' absent');
  end if;
  if (p #>> '{attendance,counts,end_not_recorded}')::int > 0 then
    v_parts := v_parts || ((p #>> '{attendance,counts,end_not_recorded}') || ' end not recorded');
  end if;
  if (p #>> '{tasks,completed,count}')::int > 0 then
    v_tasks := v_tasks || ((p #>> '{tasks,completed,count}') || ' completed');
  end if;
  if (p #>> '{tasks,overdue,count}')::int > 0 then
    v_tasks := v_tasks || ((p #>> '{tasks,overdue,count}') || ' overdue');
  end if;
  if (p #>> '{tasks,handed_in,count}')::int > 0 then
    v_tasks := v_tasks || ((p #>> '{tasks,handed_in,count}') || ' waiting');
  end if;
  if cardinality(v_tasks) > 0 then
    v_parts := v_parts || ('Tasks: ' || array_to_string(v_tasks, ', '));
  end if;
  -- 7.4: the client items (counts only).
  if (p #>> '{client_work,counts,done}')::int > 0 then
    v_items := v_items || ((p #>> '{client_work,counts,done}') || ' done');
  end if;
  if (p #>> '{client_work,counts,approved}')::int > 0 then
    v_items := v_items || ((p #>> '{client_work,counts,approved}') || ' approved');
  end if;
  if (p #>> '{client_work,counts,sent_back}')::int > 0 then
    v_items := v_items || ((p #>> '{client_work,counts,sent_back}') || ' sent back');
  end if;
  if cardinality(v_items) > 0 then
    v_parts := v_parts || ('Client items: ' || array_to_string(v_items, ', '));
  end if;
  if (p #>> '{tomorrow,events}') is not null and jsonb_array_length(p #> '{tomorrow,events}') > 0 then
    v_parts := v_parts || (jsonb_array_length(p #> '{tomorrow,events}')::text
      || case when jsonb_array_length(p #> '{tomorrow,events}') = 1 then ' event tomorrow' else ' events tomorrow' end);
  end if;
  if cardinality(v_parts) = 0 then
    return 'A quiet day.';
  end if;
  return array_to_string(v_parts, ' · ');
end;
$$;

create or replace function app.digest_weekly_zero(p jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce((p #>> '{totals,present}')::int, 0) = 0
     and coalesce((p #>> '{totals,on_leave}')::int, 0) = 0
     and coalesce((p #>> '{totals,absent}')::int, 0) = 0
     and coalesce((p #>> '{totals,end_not_recorded}')::int, 0) = 0
     and coalesce((p #>> '{totals,overtime}')::int, 0) = 0
     and coalesce((p #>> '{totals,completed}')::int, 0) = 0
     and coalesce((p #>> '{totals,cancelled}')::int, 0) = 0
     and coalesce((p #>> '{totals,created}')::int, 0) = 0
     and coalesce((p #>> '{totals,decisions}')::int, 0) = 0
     and coalesce((p #>> '{now,waiting,tasks}')::int, 0) = 0
     and coalesce((p #>> '{now,waiting,leave}')::int, 0) = 0
     and coalesce((p #>> '{now,waiting,expense_claims}')::int, 0) = 0
     and coalesce((p #>> '{now,waiting,attendance}')::int, 0) = 0
     and coalesce((p #>> '{now,waiting,extra_work}')::int, 0) = 0
     and coalesce((p #>> '{now,overdue}')::int, 0) = 0
     and coalesce((p #>> '{now,unreachable,count}')::int, 0) = 0
     and coalesce(jsonb_array_length(p #> '{ahead,leave}'), 0) = 0
     and coalesce(jsonb_array_length(p #> '{ahead,events}'), 0) = 0
     and coalesce(jsonb_array_length(p #> '{ahead,holidays}'), 0) = 0
     -- 7.4 (amendment C E4): an Admin is listed only with something to count.
     and coalesce(jsonb_array_length(p -> 'client_work'), 0) = 0;
$$;

comment on function app.eod_report_payload(uuid, date, timestamptz) is
  '6.5, service_role only: the end-of-day report for an organisation and IST date, built at p_now '
  '(the same builder for the saved row and the live view): the day off, attendance (counts and '
  'each employee''s times and flags), the decisions made that day (attendance, leave, comp leave, '
  'expense claims as a count), tasks (completed that day, handed in now, overdue now with the late '
  'reason, cancelled and created that day; freelancers counted separately), approvals per approver '
  'and step, tomorrow''s events, and since 7.4 the client work per client Admin (items done, '
  'approved, sent back with the reason, closed with the reason, carried forward, projects '
  'completed that day; counts and titles). Never an amount.';
comment on function app.digest_weekly_payload(uuid, timestamptz) is
  '6.5, service_role only (kickoff 6 decision 23, amended 2026-10-08): the weekly Owner digest at '
  'p_now: the IST days since the last weekly digest was sent (one sent before p_now''s day) up to '
  'yesterday, at most the seven days before p_now, from their saved end-of-day reports only (a day '
  'with no report reads as zero, saved false), and their totals; now (waiting for the Owner, '
  'overdue, can''t be reached, from the daily digest''s own builder); the week ahead (leave approved '
  'and pending, event tasks, holidays, today to six days on); since 7.4 the client work per Admin '
  '(amendment C E4: items done and projects completed in the window from the saved reports, items '
  'overdue now). Never an amount.';
