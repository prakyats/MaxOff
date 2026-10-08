-- 6.5: the Owner's end-of-day report and the weekly Owner digest (Kickoff 6 decisions 16–18 and
-- 23, owner 2026-10-01 / 2026-10-07; WORKFLOWS §8, §8a, §9; DATA-MODEL eod_reports, org_settings;
-- ADR-0007 amendment 2026-10-01: eod_reports holds no money, ever, and stays Owner-only).
-- Expand-only, production is live: one column with a default, one table, two kinds, functions
-- and cron rows; nothing is renamed, dropped or rewritten. digest_daily stays as history (its
-- cron row is unscheduled, the function kept); email_claim is re-created with the same signature.
--
-- * org_settings.weekly_digest_day (0 = Sunday .. 6 = Saturday, default 1 = Monday): the day the
--   weekly digest goes, settings.manage through the existing UPDATE policy plus a column grant.
-- * eod_reports: one row per organisation and IST date, written only by the job (no API INSERT,
--   UPDATE or DELETE), readable with reports.all (the Owner). data holds counts, names, times and
--   titles: never an amount (pgTAP 64 checks no amount-like key at any depth).
-- * app.eod_report_payload(org, date, now): the report for date D built at `now` (the same
--   builder for the saved row and the live view; eod_report_preview is the Owner's live read).
-- * app.eod_report(now): every 5 minutes (a frequent job that acts once the setting's time has
--   passed, as end_day_reminder did): date D is saved once D+1's end_day_cutoff_time has passed
--   (app.job_day(now, cutoff) - 1), the last 7 IST dates oldest first, a date with a row skipped,
--   every date including days off, never rewritten. Then "Yesterday's report is ready" to the
--   Owner through app.notify() (kind eod_report_ready: in_app, not actionable, no email of its
--   own; quiet hours hold its push until they end), unless every count is zero.
-- * public.digest_weekly(now): every 5 minutes; sends once a week, on org_settings.weekly_digest_day
--   at or after 08:00 IST, once the last day's report (yesterday's) is saved (so with a cutoff past
--   08:00 it goes straight after the save), one per Owner per week. Built only from the seven
--   saved reports (each day linking to its report), then "now" and "the week ahead". Email only
--   (kind owner_digest_weekly: in_app false, always_email, written directly like the daily, read
--   at insert, no push), skipped when every count is zero. email_claim takes it like the daily:
--   its own email, first among ordinary emails.

-- 1. The setting --------------------------------------------------------------------------------------
alter table public.org_settings
  add column weekly_digest_day smallint not null default 1
  check (weekly_digest_day between 0 and 6);
comment on column public.org_settings.weekly_digest_day is
  '6.5 (kickoff 6 decision 23): the weekday (0 = Sunday .. 6 = Saturday) the weekly Owner digest '
  'goes at 08:00 IST, or straight after the End-day cutoff saves the last day''s report if later. '
  'Default Monday. settings.manage (Settings -> Thresholds).';
grant update (weekly_digest_day) on public.org_settings to authenticated;

-- 2. The table ----------------------------------------------------------------------------------------
create table public.eod_reports (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id),
  report_date date not null,
  data jsonb not null check (jsonb_typeof(data) = 'object'),
  generated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (org_id, report_date)
);
comment on table public.eod_reports is
  '6.5 (kickoff 6 decisions 16-17; ADR-0007 amendment 2026-10-01): the Owner''s end-of-day report, '
  'one row per organisation and IST date, every date including days off, written only by '
  'app.eod_report() once the next day''s end_day_cutoff_time has passed and never rewritten. '
  'data holds no money, ever. Owner-only (reports.all); no API writes.';
create index eod_reports_org_date_idx on public.eod_reports (org_id, report_date desc);

alter table public.eod_reports enable row level security;
create policy eod_reports_select on public.eod_reports for select to authenticated
  using (org_id = (select c.org_id from app.current_member() c)
         and (select app.has_permission('reports.all')));
grant select on public.eod_reports to authenticated;
-- No INSERT, UPDATE or DELETE grant for the API role: the job writes, nothing changes a row.
create trigger audit_row_change after insert or update or delete on public.eod_reports
  for each row execute function app.audit_row_change();

-- 3. The kinds ----------------------------------------------------------------------------------------
insert into public.notification_kinds (kind, actionable, always_email, in_app, description) values
  ('eod_report_ready', false, false, true,
   'Yesterday''s end-of-day report is ready (the Owner, when it is saved at the End-day cutoff)'),
  ('owner_digest_weekly', false, true, false,
   'The Owner''s weekly summary (email only, from the saved end-of-day reports; counts, never an amount)');

-- 4. The end-of-day report's content ------------------------------------------------------------------
create function app.eod_report_payload(p_org uuid, p_date date, p_now timestamptz)
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

  return jsonb_build_object(
    'date', p_date,
    'day_off', jsonb_build_object('holiday', v_holiday, 'weekly_off', coalesce(v_weekly_off, false)),
    'attendance', v_attendance,
    'decisions', v_decisions,
    'tasks', v_tasks,
    'approvals', v_approvals,
    'tomorrow', v_tomorrow);
end;
$$;
comment on function app.eod_report_payload(uuid, date, timestamptz) is
  '6.5, service_role only: the end-of-day report for an organisation and IST date, built at p_now '
  '(the same builder for the saved row and the live view): the day off, attendance (counts and '
  'each employee''s times and flags), the decisions made that day (attendance, leave, comp leave, '
  'expense claims as a count), tasks (completed that day, handed in now, overdue now with the late '
  'reason, cancelled and created that day; freelancers counted separately), approvals per approver '
  'and step, tomorrow''s events. Never an amount.';
revoke all on function app.eod_report_payload(uuid, date, timestamptz) from public, anon, authenticated;
grant execute on function app.eod_report_payload(uuid, date, timestamptz) to service_role;

-- Every count zero: nothing happened that day (a quiet day off), so no notification goes.
create function app.eod_report_zero(p jsonb)
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
     and coalesce(jsonb_array_length(p #> '{tomorrow,events}'), 0) = 0;
$$;
comment on function app.eod_report_zero(jsonb) is
  '6.5: whether an end-of-day report holds nothing at all (every count zero, no one on it, no '
  'event tomorrow): the notification is skipped (kickoff 6 decision 18).';
revoke all on function app.eod_report_zero(jsonb) from public, anon, authenticated;
grant execute on function app.eod_report_zero(jsonb) to service_role;

-- The notification's one-line body: the headline counts (the page holds the rest).
create function app.eod_report_text(p jsonb)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_parts text[] := '{}';
  v_tasks text[] := '{}';
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
comment on function app.eod_report_text(jsonb) is
  '6.5: the end-of-day notification''s one line ("6 present · 1 on leave · Tasks: 3 completed, 2 '
  'overdue · 1 event tomorrow"), from the report''s counts. Never an amount.';
revoke all on function app.eod_report_text(jsonb) from public, anon, authenticated;
grant execute on function app.eod_report_text(jsonb) to service_role;

-- 5. The job ----------------------------------------------------------------------------------------------
create function app.eod_report(p_now timestamptz default now())
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org record;
  v_owner uuid;
  v_last date;
  v_date date;
  v_payload jsonb;
  v_id uuid;
  v_title text;
  v_count integer := 0;
begin
  for v_org in
    select o.id, s.end_day_cutoff_time as cutoff
    from public.organizations o
    join public.org_settings s on s.org_id = o.id
    order by o.id
  loop
    -- One run at a time per organisation: two overlapping ticks cannot both write a date's row.
    perform pg_advisory_xact_lock(hashtext('eod_report:' || v_org.id::text));
    -- Date D is saved once D+1's cutoff has passed: the most recent date whose cutoff has passed
    -- is D+1 itself, so the day to save is the one before it (kickoff 6 decision 17).
    v_last := app.job_day(p_now, v_org.cutoff) - 1;
    v_owner := app.org_owner_id(v_org.id);
    -- The catch-up (WORKFLOWS §8): the last 7 IST dates, oldest first; a date with a row is skipped.
    for v_date in select s::date from generate_series(v_last - 6, v_last, interval '1 day') s loop
      if exists (select 1 from public.eod_reports r where r.org_id = v_org.id and r.report_date = v_date) then
        continue;
      end if;
      v_payload := app.eod_report_payload(v_org.id, v_date, p_now);
      perform set_config('app.audit_override', jsonb_build_object('action', 'generated')::text, true);
      insert into public.eod_reports (org_id, report_date, data, generated_at)
      values (v_org.id, v_date, v_payload, p_now)
      returning id into v_id;
      v_count := v_count + 1;
      -- "Yesterday's report is ready" (decision 18), through app.notify() like every job (no
      -- actor): one row, for yesterday's report only. A date further back (the catch-up after an
      -- outage) is saved quietly: the history fills, the Owner is not told seven times. Nothing
      -- when every count is zero.
      if v_owner is not null and v_date = app.to_ist_date(p_now) - 1
         and not app.eod_report_zero(v_payload) then
        v_title := 'Yesterday''s report is ready';
        perform app.notify(array[v_owner], 'eod_report_ready', v_title,
          app.eod_report_text(v_payload), '/reports/end-of-day/' || v_date::text,
          'eod_reports', v_id, jsonb_build_object('report_date', v_date), null);
      end if;
    end loop;
  end loop;
  return v_count;
end;
$$;
comment on function app.eod_report(timestamptz) is
  '6.5 (WORKFLOWS §8 eod_report, §8a; kickoff 6 decisions 17-18): the end-of-day job, pg_cron every '
  '5 minutes. For each organisation, saves the report for every IST date up to app.job_day(p_now, '
  'end_day_cutoff_time) - 1 (date D once D+1''s cutoff has passed), the last 7 dates oldest first, '
  'a date with a row skipped, days off included, never rewritten; then one eod_report_ready row to '
  'the Owner through app.notify() ("Yesterday''s report is ready") for yesterday''s report only '
  '(an older catch-up date is saved quietly), none when every count is zero. Returns the rows '
  'written. Idempotent: the row is the record.';
revoke all on function app.eod_report(timestamptz) from public, anon, authenticated;
grant execute on function app.eod_report(timestamptz) to service_role;

-- The Owner's live read (today so far; yesterday until the cutoff), the same builder.
create function public.eod_report_preview(p_date date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_me public.members;
begin
  select m.* into v_me from app.current_member() m;
  if v_me.id is null then
    perform app.fail('UNAUTHENTICATED', 'Your account is not active.');
  end if;
  if not app.has_permission('reports.all') then
    perform app.fail('FORBIDDEN', 'Only the Owner reads the end-of-day report.');
  end if;
  if p_date is null or p_date > app.today_ist() then
    perform app.fail('VALIDATION', 'That day has not come yet.');
  end if;
  return app.eod_report_payload(v_me.org_id, p_date, now());
end;
$$;
comment on function public.eod_report_preview(date) is
  '6.5: the end-of-day report for a date computed now, for reports.all (the Owner; FORBIDDEN for '
  'anyone else, VALIDATION for a future date). Reads only, writes nothing. The page uses it for '
  'today and for yesterday until the End-day cutoff; a saved date shows its row instead.';
revoke all on function public.eod_report_preview(date) from public, anon;
grant execute on function public.eod_report_preview(date) to authenticated, service_role;

-- 6. The weekly digest's content --------------------------------------------------------------------------
create function app.digest_weekly_payload(p_org uuid, p_now timestamptz)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_today date := app.to_ist_date(p_now);
  v_from date := app.to_ist_date(p_now) - 7;
  v_to date := app.to_ist_date(p_now) - 1;
  v_days jsonb;
  v_totals jsonb;
  v_daily jsonb;
  v_now jsonb;
  v_ahead jsonb;
begin
  -- The week's numbers, from the seven saved reports only (so the email and the reports agree).
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

  return jsonb_build_object(
    'date', v_today,
    'week', jsonb_build_object('from', v_from, 'to', v_to),
    'days', v_days,
    'totals', v_totals,
    'now', v_now,
    'ahead', v_ahead);
end;
$$;
comment on function app.digest_weekly_payload(uuid, timestamptz) is
  '6.5, service_role only (kickoff 6 decision 23): the weekly Owner digest at p_now: the seven IST '
  'days before it from their saved end-of-day reports only (a day with no report reads as zero, '
  'saved false), their totals; now (waiting for the Owner, overdue, can''t be reached, from the '
  'daily digest''s own builder); the week ahead (leave approved and pending, event tasks, '
  'holidays, today to six days on). Never an amount.';
revoke all on function app.digest_weekly_payload(uuid, timestamptz) from public, anon, authenticated;
grant execute on function app.digest_weekly_payload(uuid, timestamptz) to service_role;

-- Every count zero: nothing happened, nothing waits, nothing is ahead: no email (decision 23).
create function app.digest_weekly_zero(p jsonb)
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
     and coalesce(jsonb_array_length(p #> '{ahead,holidays}'), 0) = 0;
$$;
comment on function app.digest_weekly_zero(jsonb) is
  '6.5: whether a weekly digest holds nothing at all (every total, every "now" count and the week '
  'ahead all zero or empty): the email is skipped (kickoff 6 decision 23).';
revoke all on function app.digest_weekly_zero(jsonb) from public, anon, authenticated;
grant execute on function app.digest_weekly_zero(jsonb) to service_role;

-- The digest's lines as plain text, for the row's body (the email is rendered from the payload).
create function app.digest_weekly_text(p jsonb)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_lines text[] := '{}';
  v_section text[];
  v_item jsonb;
  v_n integer;
begin
  v_section := '{}';
  if (p #>> '{totals,present}')::int > 0 then v_section := v_section || ('Present: ' || (p #>> '{totals,present}') || ' person-days'); end if;
  if (p #>> '{totals,on_leave}')::int > 0 then v_section := v_section || ('On leave: ' || (p #>> '{totals,on_leave}') || ' person-days'); end if;
  if (p #>> '{totals,absent}')::int > 0 then v_section := v_section || ('Absent: ' || (p #>> '{totals,absent}') || ' person-days'); end if;
  if (p #>> '{totals,end_not_recorded}')::int > 0 then v_section := v_section || ('End of day not recorded: ' || (p #>> '{totals,end_not_recorded}')); end if;
  if (p #>> '{totals,overtime}')::int > 0 then v_section := v_section || ('Overtime flagged: ' || (p #>> '{totals,overtime}')); end if;
  if (p #>> '{totals,completed}')::int > 0 then v_section := v_section || ('Tasks completed: ' || (p #>> '{totals,completed}')); end if;
  if (p #>> '{totals,created}')::int > 0 then v_section := v_section || ('Tasks created: ' || (p #>> '{totals,created}')); end if;
  if (p #>> '{totals,cancelled}')::int > 0 then v_section := v_section || ('Tasks cancelled: ' || (p #>> '{totals,cancelled}')); end if;
  if (p #>> '{totals,decisions}')::int > 0 then v_section := v_section || ('Decisions you made: ' || (p #>> '{totals,decisions}')); end if;
  if (p #>> '{totals,missing}')::int > 0 then v_section := v_section || ('Days without a saved report: ' || (p #>> '{totals,missing}')); end if;
  if cardinality(v_section) > 0 then
    v_lines := v_lines || array['', 'The week: ' || app.notify_span((p #>> '{week,from}')::date, (p #>> '{week,to}')::date)] || v_section;
  end if;

  v_section := '{}';
  if (p #>> '{now,waiting,tasks}')::int > 0 then v_section := v_section || ('Tasks waiting for your approval: ' || (p #>> '{now,waiting,tasks}')); end if;
  if (p #>> '{now,waiting,attendance}')::int > 0 then v_section := v_section || ('Attendance waiting for a decision: ' || (p #>> '{now,waiting,attendance}')); end if;
  if (p #>> '{now,waiting,leave}')::int > 0 then v_section := v_section || ('Leave requests: ' || (p #>> '{now,waiting,leave}')); end if;
  if (p #>> '{now,waiting,extra_work}')::int > 0 then v_section := v_section || ('Extra work notes: ' || (p #>> '{now,waiting,extra_work}')); end if;
  if (p #>> '{now,waiting,expense_claims}')::int > 0 then v_section := v_section || ('Expense claims: ' || (p #>> '{now,waiting,expense_claims}')); end if;
  if (p #>> '{now,overdue}')::int > 0 then v_section := v_section || ('Overdue now: ' || (p #>> '{now,overdue}')); end if;
  if (p #>> '{now,unreachable,count}')::int > 0 then v_section := v_section || ('Can''t be reached: ' || (p #>> '{now,unreachable,count}')); end if;
  if cardinality(v_section) > 0 then
    v_lines := v_lines || array['', 'Now'] || v_section;
  end if;

  v_section := '{}';
  v_n := coalesce(jsonb_array_length(p #> '{ahead,leave}'), 0);
  if v_n > 0 then v_section := v_section || ('On leave or asking for it: ' || v_n); end if;
  v_n := coalesce(jsonb_array_length(p #> '{ahead,events}'), 0);
  if v_n > 0 then v_section := v_section || ('Events: ' || v_n); end if;
  for v_item in select * from jsonb_array_elements(coalesce(p #> '{ahead,holidays}', '[]'::jsonb)) loop
    v_section := v_section || ('Holiday ' || app.notify_date((v_item ->> 'date')::date) || ': ' || (v_item ->> 'name'));
  end loop;
  if cardinality(v_section) > 0 then
    v_lines := v_lines || array['', 'The week ahead'] || v_section;
  end if;

  if cardinality(v_lines) = 0 then
    return 'Nothing needs you this week.';
  end if;
  return btrim(array_to_string(v_lines, E'\n'), E'\n');
end;
$$;
comment on function app.digest_weekly_text(jsonb) is
  '6.5, service_role only: the weekly digest payload''s lines as plain text (zero lines and empty '
  'sections left out; "Nothing needs you this week." when all are), the row''s body.';
revoke all on function app.digest_weekly_text(jsonb) from public, anon, authenticated;
grant execute on function app.digest_weekly_text(jsonb) to service_role;

-- 7. The weekly job ------------------------------------------------------------------------------------------
create function public.digest_weekly(p_now timestamptz default now())
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org record;
  v_owner uuid;
  v_today date := app.to_ist_date(p_now);
  v_payload jsonb;
  v_count integer := 0;
begin
  for v_org in
    select o.id, s.weekly_digest_day
    from public.organizations o
    join public.org_settings s on s.org_id = o.id
    order by o.id
  loop
    perform pg_advisory_xact_lock(hashtext('digest_weekly:' || v_org.id::text));
    -- The digest day, at or after 08:00 IST (decision 23).
    if extract(dow from v_today)::int <> v_org.weekly_digest_day
       or (p_now at time zone 'Asia/Kolkata')::time < time '08:00' then
      continue;
    end if;
    v_owner := app.org_owner_id(v_org.id);
    if v_owner is null then
      continue;
    end if;
    -- Straight after the End-day cutoff saved the last day's report, whichever is later: not
    -- before yesterday's row exists (so all seven reports the week needs are there).
    if not exists (select 1 from public.eod_reports r where r.org_id = v_org.id and r.report_date = v_today - 1) then
      continue;
    end if;
    -- One per Owner per week: none since the week began (a re-fired tick never sends two).
    if exists (
      select 1 from public.notifications n
      where n.recipient_id = v_owner and n.kind = 'owner_digest_weekly'
        and n.created_at >= app.ist_day_start(v_today - 6)
    ) then
      continue;
    end if;
    v_payload := app.digest_weekly_payload(v_org.id, p_now);
    if app.digest_weekly_zero(v_payload) then
      continue;
    end if;
    -- Written directly (not app.notify), as the daily digest was: no push delivery; read at once.
    insert into public.notifications (org_id, recipient_id, kind, title, body, link, payload, created_at, read_at)
    values (v_org.id, v_owner, 'owner_digest_weekly',
            'Your week · ' || app.notify_span(v_today - 7, v_today - 1),
            left(app.digest_weekly_text(v_payload), 2000), '/reports/end-of-day', v_payload, p_now, p_now);
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;
comment on function public.digest_weekly(timestamptz) is
  '6.5, service_role only (pg_cron digest_weekly, every 5 minutes; kickoff 6 decision 23): on '
  'org_settings.weekly_digest_day at or after 08:00 IST, once yesterday''s end-of-day report is '
  'saved (so after a late End-day cutoff), one owner_digest_weekly row for the active Owner, none '
  'when one went in the last week, none when every count is zero. Read at insert, no push; the '
  'dispatcher emails it (email_claim). Returns how many rows it wrote.';
revoke all on function public.digest_weekly(timestamptz) from public, anon, authenticated;
grant execute on function public.digest_weekly(timestamptz) to service_role;

-- The sample on the preview (/diagnostics/digest): the Owner only, writing nothing.
create function public.owner_digest_weekly_preview()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_me public.members;
begin
  select m.* into v_me from app.current_member() m;
  if v_me.id is null or v_me.role <> 'owner' or app.org_owner_id(v_me.org_id) is distinct from v_me.id then
    perform app.fail('FORBIDDEN', 'Only the Owner can see the weekly summary.');
  end if;
  return app.digest_weekly_payload(v_me.org_id, now());
end;
$$;
comment on function public.owner_digest_weekly_preview() is
  '6.5: the weekly digest''s payload for now, for the organisation''s Owner only (FORBIDDEN for '
  'anyone else). Reads only: writes no notification and no delivery. For /diagnostics/digest.';
revoke all on function public.owner_digest_weekly_preview() from public, anon;
grant execute on function public.owner_digest_weekly_preview() to authenticated, service_role;

-- 8. The email path: both digests are "the digest" (their own email, first among ordinary emails) ---
create or replace function public.email_claim(p_now timestamptz default now(), p_limit integer default 20)
returns table (
  delivery_id uuid, recipient_id uuid, email text, notification_id uuid, kind text,
  title text, body text, link text, attempts integer, batch_id uuid, escalation_level integer,
  payload jsonb)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lease interval := interval '5 minutes';
  v_group record;
  v_day_start timestamptz;
  v_org_count integer;
  v_member_count integer;
  v_batch uuid;
  v_new uuid[] := '{}';
begin
  -- Every run counts under one lock: two overlapping runs cannot both take the last email.
  perform pg_advisory_xact_lock(hashtext('public.email_claim'));

  -- a. Queue the email rows that are needed and not there yet (unchanged from email_dispatch).
  insert into public.notification_deliveries (notification_id, channel, state, next_attempt_at, created_at)
  select n.id, 'email', 'queued', p_now, p_now
  from public.notifications n
  join public.notification_kinds k on k.kind = n.kind
  join public.members m on m.id = n.recipient_id
  where n.created_at > p_now - interval '24 hours' and n.created_at <= p_now
    and m.status = 'active' and m.email is not null
    and (k.always_email
         or (k.actionable
             and not exists (select 1 from public.push_subscriptions s
                             where s.member_id = n.recipient_id and s.disabled_at is null)
             and not exists (select 1 from public.notification_deliveries p
                             where p.notification_id = n.id and p.channel = 'push' and p.state = 'sent')))
    and not exists (select 1 from public.notification_deliveries e
                    where e.notification_id = n.id and e.channel = 'email')
  order by n.created_at
  on conflict on constraint notification_deliveries_notification_id_channel_key do nothing;

  -- b. New rows, as groups: a person's always-emailed rows together, a fallback row alone, the
  --    Owner's digest alone (5B: never batched; 6.5: the weekly one the same). The digest is taken
  --    into the run before other rows; groups holding an escalation first, then the digest, then
  --    the oldest; each passes the ceilings once or is skipped (the digest as an ordinary email).
  for v_group in
    with fresh as (
      select d.id, d.created_at, n.recipient_id, n.org_id, n.escalation_level, k.always_email,
             n.kind in ('owner_digest', 'owner_digest_weekly') as digest,
             s.email_daily_cap_org, s.email_daily_cap_per_member
      from public.notification_deliveries d
      join public.notifications n on n.id = d.notification_id
      join public.notification_kinds k on k.kind = n.kind
      join public.org_settings s on s.org_id = n.org_id
      where d.channel = 'email' and d.state = 'queued' and d.attempts = 0 and d.next_attempt_at <= p_now
      order by (n.kind in ('owner_digest', 'owner_digest_weekly')) desc, d.created_at, n.created_at, d.id
      limit p_limit
      for update of d skip locked
    )
    select array_agg(f.id order by f.created_at, f.id) as ids,
           min(f.created_at) as created_at, f.recipient_id, f.org_id,
           bool_or(f.escalation_level > 0) as escalation,
           bool_and(f.always_email and not f.digest) as batched,
           max(f.email_daily_cap_org) as cap_org, max(f.email_daily_cap_per_member) as cap_member
    from fresh f
    group by f.recipient_id, f.org_id, case when f.always_email and not f.digest then null else f.id end
    order by bool_or(f.escalation_level > 0) desc, bool_or(f.digest) desc, min(f.created_at)
  loop
    v_day_start := app.ist_day_start((v_group.created_at at time zone 'Asia/Kolkata')::date);
    select count(distinct coalesce(e.batch_id, e.id)),
           count(distinct coalesce(e.batch_id, e.id)) filter (where x.recipient_id = v_group.recipient_id)
      into v_org_count, v_member_count
    from public.notification_deliveries e
    join public.notifications x on x.id = e.notification_id
    where e.channel = 'email' and x.org_id = v_group.org_id
      and e.created_at >= v_day_start and e.created_at < v_day_start + interval '1 day'
      and e.attempts > 0 and e.last_error is distinct from 'not_configured';

    if v_group.escalation and v_org_count >= v_group.cap_org then
      update public.notification_deliveries set state = 'skipped_cap', last_error = 'org_cap' where id = any (v_group.ids);
    elsif not v_group.escalation and v_org_count >= greatest(v_group.cap_org - 10, 0) then
      update public.notification_deliveries set state = 'skipped_cap', last_error = 'org_cap' where id = any (v_group.ids);
    elsif not v_group.escalation and v_member_count >= v_group.cap_member then
      update public.notification_deliveries set state = 'skipped_cap', last_error = 'member_cap' where id = any (v_group.ids);
    else
      v_batch := case when v_group.batched then gen_random_uuid() else null end;
      update public.notification_deliveries
      set attempts = 1, next_attempt_at = p_now + v_lease, batch_id = v_batch
      where id = any (v_group.ids);
      v_new := v_new || v_group.ids;
    end if;
  end loop;

  -- c. What goes out now: the rows just leased, and the retries that are due (a lease that
  --    expired after a crashed run is claimed again the same way; a batch's rows retry together).
  return query
  with retry as (
    select d.id
    from public.notification_deliveries d
    where d.channel = 'email' and d.state = 'queued' and d.attempts > 0 and d.next_attempt_at <= p_now
      and not (d.id = any (v_new))
    order by d.next_attempt_at, d.created_at
    limit p_limit
    for update of d skip locked
  ), leased as (
    update public.notification_deliveries d
    set attempts = d.attempts + 1, next_attempt_at = p_now + v_lease
    from retry where d.id = retry.id
    returning d.id, d.attempts, d.notification_id, d.batch_id
  ), outgoing as (
    select l.id, l.attempts, l.notification_id, l.batch_id from leased l
    union all
    select d.id, d.attempts, d.notification_id, d.batch_id from public.notification_deliveries d where d.id = any (v_new)
  )
  select o.id, n.recipient_id, m.email, n.id, n.kind, n.title, n.body, n.link, o.attempts, o.batch_id,
         n.escalation_level, n.payload
  from outgoing o
  join public.notifications n on n.id = o.notification_id
  join public.members m on m.id = n.recipient_id;
end;
$$;
comment on function public.email_claim(timestamptz, integer) is
  '5.2, 5.3, 5B, 6.5; service_role only (the dispatcher, ARCHITECTURE §9): queues the email rows a '
  'notification needs (always_email kinds; actionable kinds when the person has no active push '
  'subscription and the push was not sent; rows of the last 24 hours, active members with an '
  'address), then leases them in groups under an advisory lock: a person''s always-emailed rows as '
  'one batch (one email, counted once), a fallback row alone, the Owner''s digest (owner_digest, '
  'owner_digest_weekly) alone and taken into the run first; escalations first, then the digest, '
  'then the oldest. Ceilings: ordinary groups (the digest included) stop at email_daily_cap_org - '
  '10 and at email_daily_cap_per_member; an escalation only at email_daily_cap_org (skipped_cap, '
  'last_error org_cap | member_cap). Returns what goes out now with batch_id, escalation_level and '
  'the notification''s payload; the caller sends a batch as one email and records each row through '
  'email_record().';
revoke all on function public.email_claim(timestamptz, integer) from public, anon, authenticated;
grant execute on function public.email_claim(timestamptz, integer) to service_role;

-- 9. The schedule: the daily digest's row goes, the two ticks come (the daily function stays as history)
select cron.unschedule('digest_daily');
select cron.schedule('eod_report', '*/5 * * * *', $$select app.eod_report()$$);
select cron.schedule('digest_weekly', '*/5 * * * *', $$select public.digest_weekly(now())$$);
