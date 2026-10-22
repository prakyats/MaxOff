-- v1.9 W0: working hours, late starts and leaving early, the database (ROADMAP v1.9 W0; 6b.1; owner
--   and Anna 2026-10-07, kickoff 6b decision 1 2026-10-16, the owner's answers 2026-10-22: attendance
--   is Owner-only, OPEN 1-3 as recommended, a shoot later that day pre-fills "Shoot at ‹time›";
--   WORKFLOWS §1 "Working hours, late starts and leaving early", §8, §9; DATA-MODEL §3; PERMISSIONS
--   "As built (v1.9 W0)"). The screens are W4.
--
-- 1. org_settings: working_hours_on (the switch, default false: nothing changes on a running app
--    until the release turns it on with the W4 screens), late_grace_minutes 15,
--    early_leave_wait_minutes 30 (work_start_time / work_end_time came with W3).
-- 2. attendance_days: late_minutes, late_reason, stay_until, stay_until_by. leave_requests.half
--    (morning | afternoon) for a half day.
-- 3. early_leave_requests with RLS (own rows; the Owner through attendance.view_all; no API write).
-- 4. Five kinds, all in-app and push, never email.
-- 5. app.attendance_hours(member, date): the day's rules, start, late threshold and end time.
-- 6. Re-created, same signatures: attendance_start_day() marks Late; attendance_end_day() refuses
--    before the end time unless the request went unanswered for the wait (then "Left early, not
--    answered"); eod_report_payload() carries the late and early-leave counts and fields.
-- 7. Re-created with one more defaulted argument, half (the old signatures dropped first so a call
--    without it still resolves): leave_submit, leave_submit_comp, attendance_submit,
--    attendance_choose_leave_today.
-- 8. New: attendance_late_reason, attendance_stay_until (the Owner), attendance_ask_leave_early,
--    early_leave_decide (the Owner), app.attendance_hours_tick (pg_cron every 5 minutes: "Start your
--    day" and the end-time reminder after "Stay"), and the reads attendance_own_hours,
--    attendance_hours_today, month_summary_hours.
--
-- Expand-only (ARCHITECTURE §18): new columns nullable or defaulted, nothing renamed or rewritten.
-- Append-only: never edit once applied (a pushed migration counts as applied).

-- 1. Settings -------------------------------------------------------------------------------------
alter table public.org_settings
  add column working_hours_on boolean not null default false,
  add column late_grace_minutes integer not null default 15,
  add column early_leave_wait_minutes integer not null default 30,
  add constraint org_settings_late_grace_range check (late_grace_minutes between 0 and 120),
  add constraint org_settings_early_leave_wait_range check (early_leave_wait_minutes between 5 and 240);
grant update (working_hours_on, late_grace_minutes, early_leave_wait_minutes) on public.org_settings to authenticated;
comment on column public.org_settings.working_hours_on is
  'v1.9 W0 (6b.1): the working-hours rules (Late, the end time, Ask to leave early, the start and '
  'end-time reminders) apply only while true. Off by default; the release turns it on.';
comment on column public.org_settings.late_grace_minutes is
  'v1.9 W0 (6b.1): a Start day this many minutes after work_start_time or later is Late (0-120).';
comment on column public.org_settings.early_leave_wait_minutes is
  'v1.9 W0 (6b.1): an early-leave request unanswered this long lets the person end the day (5-240).';

-- 2. Columns ---------------------------------------------------------------------------------------
alter table public.attendance_days
  add column late_minutes integer null,
  add column late_reason text null,
  add column stay_until timestamptz null,
  add column stay_until_by uuid null references public.members (id),
  add constraint attendance_days_late_minutes_positive check (late_minutes is null or late_minutes > 0),
  add constraint attendance_days_late_reason_length check (late_reason is null or length(late_reason) <= 200),
  add constraint attendance_days_late_reason_needs_late check (late_reason is null or late_minutes is not null);
comment on column public.attendance_days.late_minutes is
  'v1.9 W0: minutes after work_start_time at the Start day tap, when past the grace (Late). Never blocks.';
comment on column public.attendance_days.late_reason is
  'v1.9 W0: the person''s one-line reason for a late start (attendance_late_reason).';
comment on column public.attendance_days.stay_until is
  'v1.9 W0: the Owner''s "Stay until" for that day (attendance_stay_until); the end time is the latest '
  'of work_end_time, a shoot''s end and this.';

alter table public.leave_requests
  add column half text null,
  add constraint leave_requests_half_values check (half is null or half in ('morning', 'afternoon')),
  add constraint leave_requests_half_needs_half_day check (half is null or type = 'half_day');
comment on column public.leave_requests.half is
  'v1.9 W0 (6b.1 (c)): which half of a half day is off, morning or afternoon. A morning half day is '
  'never Late, an afternoon one never an early leave. Older half days stay null (no rule).';

-- 3. Early-leave requests ----------------------------------------------------------------------------
create table public.early_leave_requests (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id),
  member_id uuid not null references public.members (id),
  day_id uuid not null references public.attendance_days (id),
  requested_at timestamptz not null default now(),
  reason text not null check (length(btrim(reason)) between 1 and 300),
  end_at timestamptz not null,
  state text not null default 'waiting'
    check (state in ('waiting', 'approved', 'stay', 'left_unanswered', 'corrected', 'lapsed')),
  left_at timestamptz null,
  decided_by uuid null references public.members (id),
  decided_at timestamptz null,
  decision_reason text null check (decision_reason is null or length(decision_reason) <= 500),
  stay_reminded_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint early_leave_requests_decided check (
    (state in ('approved', 'stay', 'corrected')) = (decided_by is not null and decided_at is not null)),
  constraint early_leave_requests_left check (state <> 'left_unanswered' or left_at is not null)
);
comment on table public.early_leave_requests is
  'v1.9 W0 (6b.1): "Ask to leave early" requests, decided by the Owner only (owner 2026-10-22). '
  'waiting -> approved (the day ends at requested_at) | stay; waiting past early_leave_wait_minutes '
  '-> left_unanswered at the End day tap -> approved | corrected (attendance_decide correct beside '
  'the original); a waiting request when the day ends at its end time -> lapsed. RLS: own rows, or '
  'attendance.view_all; no API write. Audited.';
create unique index early_leave_requests_one_waiting on public.early_leave_requests (day_id) where state = 'waiting';
create index early_leave_requests_member_idx on public.early_leave_requests (member_id, requested_at desc);
create index early_leave_requests_org_state_idx on public.early_leave_requests (org_id, state);
create index early_leave_requests_decided_by_idx on public.early_leave_requests (decided_by) where decided_by is not null;
alter table public.early_leave_requests enable row level security;
revoke all on public.early_leave_requests from public, anon, authenticated;
grant select on public.early_leave_requests to authenticated;
create policy early_leave_requests_select on public.early_leave_requests for select to authenticated
  using (member_id = (select c.id from app.current_member() c)
         or (org_id = (select c.org_id from app.current_member() c)
             and (select app.has_permission('attendance.view_all'))));
create trigger set_updated_at before update on public.early_leave_requests
  for each row execute function app.set_updated_at();
create trigger audit_row_change after insert or update or delete on public.early_leave_requests
  for each row execute function app.audit_row_change();

-- 4. The kinds ------------------------------------------------------------------------------------
insert into public.notification_kinds (kind, actionable, always_email, description) values
  ('early_leave_requested', false, false, 'Someone asks to leave early: the Owner approves or asks them to stay (v1.9 W0)'),
  ('early_leave_decided',   false, false, 'Your early-leave request was answered (v1.9 W0)'),
  ('stay_until_set',        false, false, 'The Owner set or removed a Stay until time for your day (v1.9 W0)'),
  ('start_day_reminder',    false, false, 'Work has started and your day has not (v1.9 W0)'),
  ('end_time_reminder',     false, false, 'Your end time has come after a Stay answer (v1.9 W0)');

-- 5. The day's hours --------------------------------------------------------------------------------
create function app.attendance_hours(p_member uuid, p_date date)
returns table (
  rules_on boolean, late_applies boolean, early_applies boolean, half text,
  start_at timestamptz, late_after timestamptz, end_at timestamptz, end_source text,
  stay_until timestamptz, shoot_end timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_set public.org_settings;
  v_day public.attendance_days;
  v_leave public.leave_requests;
  v_on boolean;
  v_rules boolean;
  v_shoot timestamptz;
  v_end timestamptz;
  v_source text := 'work';
begin
  select s.* into v_set
  from public.org_settings s join public.members m on m.org_id = s.org_id
  where m.id = p_member;
  select d.* into v_day from public.attendance_days d where d.member_id = p_member and d.work_date = p_date;
  v_leave := app.leave_covering(p_member, p_date);
  v_on := coalesce(v_set.working_hours_on, false);
  -- No rules on a weekly off, a holiday, a day marked off, or a day of approved full or comp leave
  -- (null from is_working_day() means "unknown", which is not a day off).
  v_rules := v_on and app.is_working_day(p_date) is not false and not coalesce(v_day.is_day_off, false)
             and (v_leave.id is null or v_leave.type = 'half_day');

  select max(t.event_end_at) into v_shoot
  from public.tasks t
  join public.task_assignees a on a.task_id = t.id and a.member_id = p_member and a.removed_at is null
  where t.event_date = p_date and t.event_end_at is not null and t.state <> 'cancelled' and t.archived_at is null;

  v_end := app.ist_day_start(p_date) + (v_set.work_end_time - time '00:00');
  -- A shoot only moves the end later, never earlier (owner 2026-10-07 (a)); then the Owner's Stay until.
  if v_shoot > v_end then
    v_end := v_shoot;
    v_source := 'shoot';
  end if;
  if v_day.stay_until > v_end then
    v_end := v_day.stay_until;
    v_source := 'stay';
  end if;

  return query select
    v_on,
    -- A morning half day (off in the morning) is never Late; an afternoon one never an early leave;
    -- a half day with no half recorded has neither rule (owner 2026-10-07 (c)).
    coalesce(v_rules and (v_leave.id is null or v_leave.half = 'afternoon'), false),
    coalesce(v_rules and (v_leave.id is null or v_leave.half = 'morning'), false),
    case when v_leave.type = 'half_day' then v_leave.half end,
    app.ist_day_start(p_date) + (v_set.work_start_time - time '00:00'),
    app.ist_day_start(p_date) + (v_set.work_start_time - time '00:00') + make_interval(mins => v_set.late_grace_minutes),
    v_end, v_source, v_day.stay_until, v_shoot;
end;
$$;
comment on function app.attendance_hours(uuid, date) is
  'v1.9 W0, service_role only: a member''s working hours for a date. rules_on = org_settings.'
  'working_hours_on; late_applies / early_applies only on a working day not marked off and not of '
  'full or comp leave (a morning half day: no Late; an afternoon one: no early leave; a half day '
  'with no half: neither); start_at, late_after (start + grace), end_at = the latest of '
  'work_end_time, the end of a shoot that day (an event task they are an active assignee on) and '
  'the day''s stay_until, with end_source work | shoot | stay.';
revoke all on function app.attendance_hours(uuid, date) from public, anon, authenticated;
grant execute on function app.attendance_hours(uuid, date) to service_role;

-- 6. Re-created with the same signatures ---------------------------------------------------------
create or replace function public.attendance_start_day()
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid;
  v_org uuid;
  v_joined timestamptz;
  v_today date := app.today_ist();
  v_day public.attendance_days;
  v_standing text;
  v_hours record;
  v_late integer;
begin
  select r.caller_id, r.org_id into v_caller, v_org from app.attendance_require_self() r;
  select m.joined_at into v_joined from public.members m where m.id = v_caller;
  if app.to_ist_date(v_joined) >= v_today then
    perform app.fail('INVALID_STATE', 'Your attendance starts tomorrow.');
  end if;

  -- The leave: lock before any row lock, like every writer of a member's days (DATA-MODEL §3).
  perform pg_advisory_xact_lock(hashtext('leave:' || v_caller::text));

  select d.* into v_day
  from public.attendance_days d
  where d.member_id = v_caller and d.work_date = v_today
  for update;

  if v_day.id is null then
    if app.is_working_day(v_today) is false then
      perform app.fail('INVALID_STATE', 'Today is a day off. Worked anyway? Add an "I worked today" note.');
    end if;
    v_day := app.attendance_open_day(v_caller, v_today);
  elsif v_day.is_day_off then
    perform app.fail('INVALID_STATE', 'Today is a day off. Worked anyway? Add an "I worked today" note.');
  end if;

  if v_day.started_at is not null then
    perform app.fail('INVALID_STATE', 'Your day has already started.');
  end if;

  v_standing := coalesce(v_day.submitted_choice::text, v_day.final_status::text);

  -- v1.9 W0 (6b.1): a start after the grace is Late, in minutes after the start time. Never blocked,
  -- nobody told (OPEN 1); no rule on a day off, a full or comp leave day or a morning half day.
  select h.* into v_hours from app.attendance_hours(v_caller, v_today) h;
  if v_hours.late_applies and now() > v_hours.late_after then
    v_late := floor(extract(epoch from (now() - v_hours.start_at)) / 60)::integer;
  end if;

  if v_day.state = 'awaiting_choice' then
    -- The ordinary morning: the tap is the start, and the day waits for the Owner as Present.
    perform set_config('app.audit_override', jsonb_build_object(
      'action', 'started', 'meta', jsonb_build_object('choice', 'present'))::text, true);
    update public.attendance_days
    set state = 'pending_review', submitted_choice = 'present', submitted_at = now(), started_at = now(),
        late_minutes = v_late,
        final_status = null, proposed_by_system = false, decided_by = null, decided_at = null,
        decision_reason = null, worked_on_leave = false
    where id = v_day.id;
    perform app.attendance_event(v_day.id, 'started', null, 'present', null, v_caller);
  elsif v_day.state = 'approved' and v_day.proposed_by_system and v_day.submitted_choice is null
        and v_day.final_status in ('leave', 'comp_leave') then
    -- "I'm working today" on a day of approved full leave (WORKFLOWS §1): the leave stays as it is.
    perform set_config('app.audit_override', jsonb_build_object(
      'action', 'started',
      'meta', jsonb_build_object('choice', 'present', 'on_leave', true, 'leave_request_id', v_day.leave_request_id))::text, true);
    update public.attendance_days
    set state = 'pending_review', submitted_choice = 'present', submitted_at = now(), started_at = now(),
        late_minutes = v_late,
        final_status = null, proposed_by_system = false, decided_by = null, decided_at = null,
        decision_reason = null, worked_on_leave = false
    where id = v_day.id;
    perform app.attendance_event(v_day.id, 'started', v_day.final_status, 'present', null, v_caller);
  elsif v_standing in ('present', 'half_day') then
    -- A half-day leave day (Start and End stay available, PRODUCT §4.2), or a day already Present
    -- (one the Owner decided): the start time is recorded and the day's standing is not touched.
    perform set_config('app.audit_override', jsonb_build_object('action', 'started')::text, true);
    update public.attendance_days set started_at = now(), late_minutes = v_late where id = v_day.id;
    perform app.attendance_event(v_day.id, 'started', null, null, null, v_caller);
  elsif v_standing in ('leave', 'comp_leave') then
    perform app.fail('INVALID_STATE', 'You''re on leave today. Ask the Owner to correct it if you are working.');
  else
    perform app.fail('INVALID_STATE', 'Today''s attendance has already been decided. Ask the Owner to correct it.');
  end if;

  return v_day.id;
end;
$$;

create or replace function public.attendance_end_day(overtime_note text default null, overtime_minutes integer default null)
returns table (day_id uuid, work_date date, note_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_caller uuid;
  v_org uuid;
  v_today date := app.today_ist();
  v_day public.attendance_days;
  v_note_id uuid;
  v_cutoff time;
  v_hours record;
  v_req public.early_leave_requests;
  v_wait interval;
begin
  select r.caller_id, r.org_id into v_caller, v_org from app.attendance_require_self() r;

  perform pg_advisory_xact_lock(hashtext('leave:' || v_caller::text));

  select d.* into v_day
  from public.attendance_days d
  where d.member_id = v_caller and d.work_date = v_today and d.started_at is not null and d.ended_at is null
  for update;
  if v_day.id is null then
    -- Today started (ended or not): yesterday is never ended from here. Checked before yesterday,
    -- or a second tap (another device, a stale tab) would write a false end onto an open yesterday.
    if exists (select 1 from public.attendance_days d
               where d.member_id = v_caller and d.work_date = v_today and d.started_at is not null) then
      perform app.fail('INVALID_STATE', 'Your day has already ended.');
    end if;
    -- Worked past midnight: the end belongs to yesterday's day, a real time, never made up.
    select d.* into v_day
    from public.attendance_days d
    where d.member_id = v_caller and d.work_date = v_today - 1 and d.started_at is not null and d.ended_at is null
    for update;
    -- 3b review: only until the cutoff (05:00 IST by default). After it, yesterday stays "End of
    -- day not recorded" and late work goes in an overtime note.
    if v_day.id is not null then
      v_cutoff := app.end_day_cutoff(v_org);
      if not app.end_day_late_allowed(now(), v_cutoff) then
        perform app.fail('INVALID_STATE', format(
          'Yesterday''s day can be ended only until %s. It stays "End of day not recorded"; add an overtime note for the late work.',
          app.wall_time(v_cutoff)));
      end if;
    end if;
  end if;
  if v_day.id is null then
    if exists (select 1 from public.attendance_days d
               where d.member_id = v_caller and d.work_date = v_today and d.ended_at is not null) then
      perform app.fail('INVALID_STATE', 'Your day has already ended.');
    end if;
    perform app.fail('INVALID_STATE', 'Start your day first.');
  end if;

  -- v1.9 W0 (6b.1): before the day's end time, End day waits for the Owner's answer to "Ask to leave
  -- early", or for the wait to pass unanswered ("Left early, not answered"); at or after it, a
  -- request still waiting has nothing left to decide (lapsed). The end is always the real tap.
  if v_day.work_date = v_today then
    select h.* into v_hours from app.attendance_hours(v_caller, v_today) h;
    select e.* into v_req from public.early_leave_requests e
    where e.day_id = v_day.id and e.state = 'waiting'
    for update;
    if v_hours.early_applies and now() < v_hours.end_at then
      if v_req.id is null then
        perform app.fail('INVALID_STATE', format('Your day ends at %s. Ask to leave early instead.',
          app.ist_time(v_hours.end_at)));
      end if;
      select make_interval(mins => s.early_leave_wait_minutes) into v_wait
      from public.org_settings s where s.org_id = v_org;
      if now() < v_req.requested_at + v_wait then
        perform app.fail('INVALID_STATE', format('The Owner hasn''t answered yet. You can end your day from %s.',
          app.ist_time(v_req.requested_at + v_wait)));
      end if;
      perform set_config('app.audit_override', jsonb_build_object('action', 'left_unanswered')::text, true);
      update public.early_leave_requests set state = 'left_unanswered', left_at = now() where id = v_req.id;
    elsif v_req.id is not null then
      perform set_config('app.audit_override', jsonb_build_object('action', 'lapsed')::text, true);
      update public.early_leave_requests set state = 'lapsed' where id = v_req.id;
    end if;
  end if;

  -- Only the end moves: state, final_status and the Owner's decision are never touched. An end is
  -- recorded now, so the 00:00 job's flag no longer holds (the 2.5 rule for a late logout).
  perform set_config('app.audit_override', jsonb_build_object('action', 'ended')::text, true);
  update public.attendance_days set ended_at = now(), end_not_recorded = false where id = v_day.id;
  perform app.attendance_event(v_day.id, 'ended', null, null, null, v_caller);

  -- The confirmation's optional overtime note (PRODUCT §4.2, 3b.2), on the day that just ended.
  if app.clean_reason(overtime_note) is not null then
    v_note_id := public.extra_work_note_submit('overtime', v_day.work_date, overtime_note, overtime_minutes);
  end if;

  return query select v_day.id, v_day.work_date, v_note_id;
end;
$$;

comment on function public.attendance_end_day(text, integer) is
  'attendance.self. Ends the caller''s started day: today''s, else yesterday''s with a start and no '
  'end, only before org_settings.end_day_cutoff_time IST and never once today has started. v1.9 W0: '
  'while working_hours_on, today''s day before its end time (app.attendance_hours) is INVALID_STATE '
  '("Ask to leave early instead") unless an early-leave request has waited early_leave_wait_minutes '
  'unanswered (it becomes left_unanswered); a request still waiting at or after the end time becomes '
  'lapsed. ended_at = now() and end_not_recorded = false in one write; final, no resume. A non-empty '
  'overtime_note becomes an extra_work_note_submit(overtime). Returns (day_id, work_date, note_id). '
  'Audit action: ended. Notifies nobody.';

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
  v_owner uuid := app.org_owner_id(p_org);
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
           d.started_at, d.ended_at, d.end_not_recorded, d.overtime_flag, d.overtime_reason,
           -- v1.9 W0 (6b.1): Late with its reason, and how the day ended early (if it did).
           d.late_minutes, d.late_reason,
           (select e.state from public.early_leave_requests e
            where e.day_id = d.id and e.state in ('approved', 'left_unanswered', 'corrected')
            order by e.requested_at desc limit 1) as left_early
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
      'overtime', count(*) filter (where overtime_flag),
      'late', count(*) filter (where late_minutes is not null),
      'left_early', count(*) filter (where left_early is not null)),
    'people', coalesce(jsonb_agg(jsonb_build_object(
      'member_id', id, 'name', full_name, 'status', status, 'waiting', waiting, 'proposed', proposed,
      'started_at', started_at, 'ended_at', ended_at, 'end_not_recorded', end_not_recorded,
      'overtime', overtime_flag, 'overtime_reason', overtime_reason,
      'late_minutes', late_minutes, 'late_reason', late_reason, 'left_early', left_early)
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
  -- Done = the history's `done` entries ("Not done" and a rejection clear done_at); approved = the
  -- reviews' approvals (before amendment D3); sent back = the Owner's rejections, reopened = an Admin's
  -- (D3: the client's Admin reopening a done item); closed = cancelled that day (a cancel, a carry "close", a project cancel);
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
      -- Review fix (amendment D3): a rejection is the Owner's send-back or an Admin's own reopen.
      select case when r.decision = 'approved' then 'approved'
                  when r.reviewer_id = v_owner then 'sent_back'
                  else 'reopened' end, i.id, i.title,
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
        'reopened', coalesce(a.groups -> 'reopened', v_empty),
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
        'reopened', count(*) filter (where grp = 'reopened'),
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


-- 7. Which half of a half day: the four request paths take `half`. Each old signature is dropped
--    first, so a call without the new argument (the released app) resolves to the new function.
create function app.leave_half_check(p_type public.leave_type, p_half text)
returns void
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_half is null then
    return;
  end if;
  if p_half not in ('morning', 'afternoon') then
    perform app.fail('VALIDATION', 'Choose Morning or Afternoon.');
  end if;
  if p_type is distinct from 'half_day' then
    perform app.fail('VALIDATION', 'Morning or Afternoon is only for a half day.');
  end if;
end;
$$;
comment on function app.leave_half_check(public.leave_type, text) is
  'v1.9 W0, service_role only: a half (morning | afternoon) is valid only with a half day.';
revoke all on function app.leave_half_check(public.leave_type, text) from public, anon, authenticated;
grant execute on function app.leave_half_check(public.leave_type, text) to service_role;

drop function public.attendance_choose_leave_today(public.attendance_choice, text);
drop function public.attendance_submit(public.attendance_choice, text, date);
drop function public.leave_submit_comp(date, boolean, text);
drop function public.leave_submit(public.leave_type, date, date, text);

create function public.leave_submit(type public.leave_type, start_date date, end_date date, reason text default null,
                                    half text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid;
  v_org uuid;
  v_reason text := app.clean_reason(reason);
  v_id uuid;
  v_req public.leave_requests;
begin
  select r.caller_id, r.org_id into v_caller, v_org from app.attendance_require_self() r;
  -- 3c.1: comp leave is a credit being used, so it goes through leave_submit_comp() only.
  if type = 'comp_leave' then
    perform app.fail('VALIDATION', 'Comp leave comes from a credit. Choose "Comp leave" in the leave form when you have one.');
  end if;
  perform app.leave_validate(type, start_date, end_date, app.today_ist());
  perform app.leave_half_check(type, half);
  -- One member's leave writes run one at a time, so two tabs cannot both pass the overlap check.
  perform pg_advisory_xact_lock(hashtext('leave:' || v_caller::text));
  if app.leave_overlaps(v_caller, start_date, end_date, null) then
    perform app.fail('CONFLICT', 'You already have a request for these dates. Request a change to it instead.');
  end if;

  perform set_config('app.audit_override', jsonb_build_object(
    'action', 'submitted', 'meta', jsonb_build_object('source', 'form'))::text, true);
  insert into public.leave_requests (member_id, type, start_date, end_date, reason, state, source, half)
  values (v_caller, type, start_date, end_date, v_reason, 'submitted', 'form', half)
  returning * into v_req;
  v_id := v_req.id;
  -- WORKFLOWS §9 "Leave requested": the Owner (5.1).
  perform app.notify_leave_owner(v_req, v_org, 'request');
  return v_id;
end;
$$;

create function public.leave_submit_comp(start_date date, half_day boolean default false, reason text default null,
                                         half text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid;
  v_org uuid;
  v_reason text := app.clean_reason(reason);
  v_type public.leave_type := case when coalesce(half_day, false) then 'half_day' else 'comp_leave' end;
  v_needed numeric := case when coalesce(half_day, false) then 0.5 else 1.0 end;
  v_left numeric;
  v_credit public.comp_leave_credits;
  v_take numeric;
  v_id uuid;
  v_req public.leave_requests;
begin
  select r.caller_id, r.org_id into v_caller, v_org from app.attendance_require_self() r;
  perform app.leave_validate(v_type, start_date, start_date, app.today_ist());
  perform app.leave_half_check(v_type, half);
  -- 3b review: a weekly day off or a holiday is already off; a credit spent on it would be lost.
  if app.is_working_day(start_date) is false then
    perform app.fail('VALIDATION', 'That date is a day off. Comp leave is for a working day.');
  end if;
  perform pg_advisory_xact_lock(hashtext('leave:' || v_caller::text));
  if app.leave_overlaps(v_caller, start_date, start_date, null) then
    perform app.fail('CONFLICT', 'You already have a request for this date. Request a change to it instead.');
  end if;

  -- The date counts, not the decision: only credits still valid on that date can cover it.
  select coalesce(sum(c.days - c.used_days - c.reserved_days), 0) into v_left
  from public.comp_leave_credits c
  where c.member_id = v_caller and c.revoked_at is null and c.expires_on >= start_date;
  if v_left < v_needed then
    perform app.fail('VALIDATION', 'You don''t have enough comp leave for that date.');
  end if;

  perform set_config('app.audit_override', jsonb_build_object(
    'action', 'submitted', 'meta', jsonb_build_object('source', 'form', 'comp', true, 'credit_days', v_needed))::text, true);
  insert into public.leave_requests (member_id, type, start_date, end_date, reason, state, source, credit_days, half)
  values (v_caller, v_type, start_date, start_date, v_reason, 'submitted', 'form', v_needed, half)
  returning * into v_req;
  v_id := v_req.id;

  -- Oldest first (decision 16).
  v_left := v_needed;
  for v_credit in
    select c.* from public.comp_leave_credits c
    where c.member_id = v_caller and c.revoked_at is null and c.expires_on >= start_date
      and c.days - c.used_days - c.reserved_days > 0
    order by c.granted_at, c.id
    for update
  loop
    exit when v_left <= 0;
    v_take := least(v_credit.days - v_credit.used_days - v_credit.reserved_days, v_left);
    perform set_config('app.audit_override', jsonb_build_object(
      'action', 'reserved', 'meta', jsonb_build_object('leave_request_id', v_id, 'days', v_take))::text, true);
    update public.comp_leave_credits set reserved_days = reserved_days + v_take where id = v_credit.id;
    perform set_config('app.audit_override', jsonb_build_object('action', 'reserved')::text, true);
    insert into public.comp_leave_credit_uses (credit_id, leave_request_id, days, state)
    values (v_credit.id, v_id, v_take, 'reserved');
    v_left := v_left - v_take;
  end loop;
  -- The sum above is read before the credits are locked: a credit revoked in between is skipped
  -- by the loop, and the request must not stand on nothing.
  if v_left > 0 then
    perform app.fail('VALIDATION', 'You don''t have enough comp leave for that date.');
  end if;

  -- WORKFLOWS §9 "Leave requested": the Owner (5.1). The comp label is the person's own kind of
  -- leave, never an amount (decision 24).
  perform app.notify_leave_owner(v_req, v_org, 'request');
  return v_id;
end;
$$;

create function public.attendance_submit(
  choice public.attendance_choice, reason text default null, for_date date default null, half text default null)
returns public.attendance_state
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid;
  v_org uuid;
  v_reason text := app.clean_reason(reason);
  v_day public.attendance_days;
  v_leave_id uuid;
  v_to public.day_status := choice::text::public.day_status;
begin
  select r.caller_id, r.org_id into v_caller, v_org from app.attendance_require_self() r;

  -- 3c.1: a comp leave day is a credit being used, never a choice made here.
  if choice = 'comp_leave' then
    perform app.fail('VALIDATION', 'Comp leave is not chosen here. Request it from the leave form when you have a credit.');
  end if;
  if for_date is not null and for_date <> app.today_ist() then
    perform app.fail('INVALID_STATE', 'The day changed. Choose again for today.');
  end if;

  -- 2.4: the leave: lock comes before the day's row lock, for every choice.
  perform pg_advisory_xact_lock(hashtext('leave:' || v_caller::text));

  select d.* into v_day
  from public.attendance_days d
  where d.member_id = v_caller and d.work_date = app.today_ist()
  for update;
  if v_day.id is null then
    perform app.fail('NOT_FOUND', 'Today''s attendance is not open yet. Reload and try again.');
  end if;

  if v_day.state = 'awaiting_choice' then
    v_leave_id := null;
  elsif v_day.state = 'approved' and v_day.proposed_by_system and choice = 'present' then
    -- "I'm working today" on an approved-leave day: the leave request stays as it is.
    v_leave_id := v_day.leave_request_id;
  elsif v_day.state = 'approved' and v_day.proposed_by_system then
    perform app.fail('INVALID_STATE', 'You are on approved leave today. Only "I''m working today" can be sent.');
  else
    perform app.fail('INVALID_STATE', 'Today''s attendance has already been submitted.');
  end if;

  if choice <> 'present' then
    perform set_config('app.audit_override', jsonb_build_object(
      'action', 'submitted', 'meta', jsonb_build_object('source', 'attendance'))::text, true);
    insert into public.leave_requests (member_id, type, start_date, end_date, reason, state, source, half)
    values (v_caller, choice::text::public.leave_type, v_day.work_date, v_day.work_date, v_reason, 'submitted', 'attendance',
            attendance_submit.half)
    returning id into v_leave_id;
  end if;

  perform set_config('app.audit_override', jsonb_build_object(
    'action', 'submitted',
    'meta', jsonb_build_object('choice', choice, 'reason', v_reason))::text, true);
  update public.attendance_days
  set state = 'pending_review', submitted_choice = choice, submitted_at = now(),
      final_status = null, proposed_by_system = false, decided_by = null, decided_at = null,
      decision_reason = null, leave_request_id = v_leave_id, worked_on_leave = false
  where id = v_day.id;
  perform app.attendance_event(v_day.id, 'submitted', v_day.final_status, v_to, v_reason, v_caller);

  return 'pending_review';
end;
$$;

create function public.attendance_choose_leave_today(choice public.attendance_choice, reason text default null,
                                                     half text default null)
returns public.attendance_state
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid;
  v_org uuid;
  v_joined timestamptz;
  v_today date := app.today_ist();
  v_day public.attendance_days;
  v_state public.attendance_state;
  v_req public.leave_requests;
begin
  select r.caller_id, r.org_id into v_caller, v_org from app.attendance_require_self() r;
  if choice is null or choice not in ('leave', 'half_day') then
    perform app.fail('VALIDATION', 'Choose Leave or Half day. Comp leave is requested from the leave form.');
  end if;
  perform app.leave_half_check(choice::text::public.leave_type, half);
  select m.joined_at into v_joined from public.members m where m.id = v_caller;
  if app.to_ist_date(v_joined) >= v_today then
    perform app.fail('INVALID_STATE', 'Your attendance starts tomorrow.');
  end if;

  perform pg_advisory_xact_lock(hashtext('leave:' || v_caller::text));

  select d.* into v_day
  from public.attendance_days d
  where d.member_id = v_caller and d.work_date = v_today
  for update;
  if v_day.id is null then
    if app.is_working_day(v_today) is false then
      perform app.fail('INVALID_STATE', 'Today is a day off: nothing to record.');
    end if;
    v_day := app.attendance_open_day(v_caller, v_today);
  end if;

  -- The 2.1 rules, request and audit, unchanged: the day is the single door for this request.
  v_state := public.attendance_submit(choice, reason, v_today, half);
  -- 5A decision 19: the Owner is told exactly like a leave request (5.1). The request the gate
  -- made (source = attendance) is on today's day.
  select r.* into v_req from public.leave_requests r
  join public.attendance_days d on d.leave_request_id = r.id
  where d.member_id = v_caller and d.work_date = v_today and r.state = 'submitted';
  if v_req.id is not null then
    perform app.notify_leave_owner(v_req, v_org, 'request');
  end if;
  return v_state;
end;
$$;


revoke all on function public.leave_submit(public.leave_type, date, date, text, text) from public, anon;
grant execute on function public.leave_submit(public.leave_type, date, date, text, text) to authenticated, service_role;
comment on function public.leave_submit(public.leave_type, date, date, text, text) is
  'attendance.self. A leave request from the form (source form, submitted), the Owner told (5.1). '
  'v1.9 W0: half (morning | afternoon) for a half day, VALIDATION otherwise; null keeps the old form.';
revoke all on function public.leave_submit_comp(date, boolean, text, text) from public, anon;
grant execute on function public.leave_submit_comp(date, boolean, text, text) to authenticated, service_role;
comment on function public.leave_submit_comp(date, boolean, text, text) is
  'attendance.self. Comp leave for a working day from the member''s credits, oldest first (reserved). '
  'v1.9 W0: half (morning | afternoon) with half_day.';
revoke all on function public.attendance_submit(public.attendance_choice, text, date, text) from public, anon;
grant execute on function public.attendance_submit(public.attendance_choice, text, date, text) to authenticated, service_role;
comment on function public.attendance_submit(public.attendance_choice, text, date, text) is
  'attendance.self. Today''s own day: awaiting_choice -> pending_review, or approved + '
  'proposed_by_system -> pending_review for present only ("I''m working today"). A leave choice '
  'creates the source = attendance request. v1.9 W0: half (morning | afternoon) for a half day.';
revoke all on function public.attendance_choose_leave_today(public.attendance_choice, text, text) from public, anon;
grant execute on function public.attendance_choose_leave_today(public.attendance_choice, text, text) to authenticated, service_role;
comment on function public.attendance_choose_leave_today(public.attendance_choice, text, text) is
  'attendance.self. Leave or Half day at the Start-day prompt (3b.1), through attendance_submit(); '
  'the Owner told like a leave request. v1.9 W0: half (morning | afternoon) for a half day.';

-- 8. New functions ---------------------------------------------------------------------------------

-- The person's one-line reason for a late start today.
create function public.attendance_late_reason(reason text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid;
  v_org uuid;
  v_reason text := app.clean_reason(reason);
  v_day public.attendance_days;
begin
  select r.caller_id, r.org_id into v_caller, v_org from app.attendance_require_self() r;
  if v_reason is null then
    perform app.fail('VALIDATION', 'Add a short reason.');
  end if;
  if length(v_reason) > 200 then
    perform app.fail('VALIDATION', 'Keep the reason to one line (200 characters).');
  end if;
  perform pg_advisory_xact_lock(hashtext('leave:' || v_caller::text));
  select d.* into v_day from public.attendance_days d
  where d.member_id = v_caller and d.work_date = app.today_ist()
  for update;
  if v_day.late_minutes is null then
    perform app.fail('INVALID_STATE', 'Today isn''t marked Late.');
  end if;
  perform set_config('app.audit_override', jsonb_build_object('action', 'late_reason')::text, true);
  update public.attendance_days set late_reason = v_reason where id = v_day.id;
  return v_day.id;
end;
$$;
comment on function public.attendance_late_reason(text) is
  'v1.9 W0, attendance.self: the caller''s one-line reason (1-200 characters) on today''s Late day; '
  'INVALID_STATE when today is not Late. Audit action late_reason. Notifies nobody (OPEN 1).';
revoke all on function public.attendance_late_reason(text) from public, anon;
grant execute on function public.attendance_late_reason(text) to authenticated, service_role;

-- The Owner's "Stay until" for someone's day today (owner 2026-10-22: the Owner only).
create function public.attendance_stay_until(member_id uuid, until timestamptz)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid;
  v_org uuid;
  v_today date := app.today_ist();
  v_member public.members;
  v_set public.org_settings;
  v_day public.attendance_days;
  v_hours record;
begin
  select r.caller_id, r.org_id into v_caller, v_org from app.attendance_require_decider() r;
  select m.* into v_member from public.members m
  where m.id = attendance_stay_until.member_id and m.org_id = v_org;
  if v_member.id is null then
    perform app.fail('NOT_FOUND', 'That person isn''t in your team.');
  end if;
  if v_member.engagement <> 'permanent' then
    perform app.fail('VALIDATION', 'Freelancers have no attendance in MaxOff.');
  end if;
  if v_member.status <> 'active' or not exists (
      select 1 from public.role_permissions rp where rp.role = v_member.role and rp.permission = 'attendance.self') then
    perform app.fail('VALIDATION', 'Stay until is for an active member who records attendance.');
  end if;
  select s.* into v_set from public.org_settings s where s.org_id = v_org;
  if not v_set.working_hours_on then
    perform app.fail('INVALID_STATE', 'Working hours are switched off.');
  end if;

  perform pg_advisory_xact_lock(hashtext('leave:' || v_member.id::text));
  select d.* into v_day from public.attendance_days d
  where d.member_id = v_member.id and d.work_date = v_today
  for update;
  if v_day.started_at is null or v_day.ended_at is not null then
    perform app.fail('INVALID_STATE', format('%s''s day today hasn''t started or has already ended.', v_member.full_name));
  end if;
  if until is not null and (until <= now() or app.to_ist_date(until) <> v_today
      or until <= app.ist_day_start(v_today) + (v_set.work_end_time - time '00:00')) then
    perform app.fail('VALIDATION', format('Choose a time later today, after %s.', app.wall_time(v_set.work_end_time)));
  end if;

  perform set_config('app.audit_override', jsonb_build_object(
    'action', case when until is null then 'stay_until_cleared' else 'stay_until_set' end)::text, true);
  update public.attendance_days set stay_until = until, stay_until_by = v_caller where id = v_day.id;

  select h.* into v_hours from app.attendance_hours(v_member.id, v_today) h;
  -- WORKFLOWS §9: the person, at once; never email.
  perform app.notify(array[v_member.id], 'stay_until_set',
    case when until is null then 'Your Stay until was removed'
         else format('Please stay until %s today', app.ist_time(until)) end,
    format('Your day ends at %s.', app.ist_time(v_hours.end_at)),
    case when v_member.role = 'admin' then '/today' else '/my-day' end,
    'attendance_days', v_day.id, jsonb_build_object('day_id', v_day.id, 'until', until), v_caller);
  return v_hours.end_at;
end;
$$;
comment on function public.attendance_stay_until(uuid, timestamptz) is
  'v1.9 W0, attendance.decide (the Owner only; owner 2026-10-22): sets (or with null clears) the '
  'Stay until time on an active permanent member''s started, unended day today; until later today '
  'and after work_end_time (VALIDATION); INVALID_STATE while working hours are off or the day is not '
  'running; NOT_FOUND outside the org; a freelancer or the Owner refused. Audit stay_until_set / '
  'stay_until_cleared; the person is told (stay_until_set). Returns the day''s end time.';
revoke all on function public.attendance_stay_until(uuid, timestamptz) from public, anon;
grant execute on function public.attendance_stay_until(uuid, timestamptz) to authenticated, service_role;

-- "Ask to leave early": before the end time, with a reason; the Owner decides.
create function public.attendance_ask_leave_early(reason text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid;
  v_org uuid;
  v_today date := app.today_ist();
  v_reason text := app.clean_reason(reason);
  v_day public.attendance_days;
  v_hours record;
  v_req public.early_leave_requests;
  v_name text;
begin
  select r.caller_id, r.org_id into v_caller, v_org from app.attendance_require_self() r;
  if v_reason is null then
    perform app.fail('VALIDATION', 'Say why you need to leave early.');
  end if;
  if length(v_reason) > 300 then
    perform app.fail('VALIDATION', 'Keep the reason short (300 characters).');
  end if;
  perform pg_advisory_xact_lock(hashtext('leave:' || v_caller::text));
  select d.* into v_day from public.attendance_days d
  where d.member_id = v_caller and d.work_date = v_today
  for update;
  if v_day.started_at is null then
    perform app.fail('INVALID_STATE', 'Start your day first.');
  end if;
  if v_day.ended_at is not null then
    perform app.fail('INVALID_STATE', 'Your day has already ended.');
  end if;
  select h.* into v_hours from app.attendance_hours(v_caller, v_today) h;
  if not v_hours.early_applies then
    perform app.fail('INVALID_STATE', 'Today has no set end time: you can end your day.');
  end if;
  if now() >= v_hours.end_at then
    perform app.fail('INVALID_STATE', format('Your day ended at %s: you can end it now.', app.ist_time(v_hours.end_at)));
  end if;
  if exists (select 1 from public.early_leave_requests e where e.day_id = v_day.id and e.state = 'waiting') then
    perform app.fail('CONFLICT', 'You have already asked. The Owner will answer.');
  end if;

  perform set_config('app.audit_override', jsonb_build_object('action', 'requested')::text, true);
  insert into public.early_leave_requests (org_id, member_id, day_id, requested_at, reason, end_at)
  values (v_org, v_caller, v_day.id, now(), v_reason, v_hours.end_at)
  returning * into v_req;

  -- WORKFLOWS §9: the Owner only, an actionable push + in-app, never email (OPEN 1).
  select m.full_name into v_name from public.members m where m.id = v_caller;
  perform app.notify(array[app.org_owner_id(v_org)], 'early_leave_requested',
    format('%s asks to leave early', v_name),
    format('%s · asked at %s, day ends %s', v_reason, app.ist_time(v_req.requested_at), app.ist_time(v_req.end_at)),
    '/approvals#early-leave', 'early_leave_requests', v_req.id,
    jsonb_build_object('request_id', v_req.id, 'member_id', v_caller, 'day_id', v_day.id), v_caller);
  return v_req.id;
end;
$$;
comment on function public.attendance_ask_leave_early(text) is
  'v1.9 W0, attendance.self: an early-leave request (reason 1-300) on the caller''s started, unended '
  'day today, before its end time (app.attendance_hours); INVALID_STATE when no end-time rule applies '
  'or the end time has passed, CONFLICT while one waits. The person stays checked in. Audit '
  'requested; the Owner is told (early_leave_requested, never email). Returns the request id.';
revoke all on function public.attendance_ask_leave_early(text) from public, anon;
grant execute on function public.attendance_ask_leave_early(text) to authenticated, service_role;

-- The Owner's answer: Approve, Stay, or (after "Left early, not answered") Approve or Correct.
create function public.early_leave_decide(
  request_id uuid, decision text, status public.day_status default null, reason text default null)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid;
  v_org uuid;
  v_member uuid;
  v_req public.early_leave_requests;
  v_day public.attendance_days;
  v_role public.member_role;
  v_reason text := app.clean_reason(reason);
  v_hours record;
  v_title text;
  v_body text;
  v_state text;
begin
  select r.caller_id, r.org_id into v_caller, v_org from app.attendance_require_decider() r;
  if decision is null or decision not in ('approve', 'stay', 'correct') then
    perform app.fail('VALIDATION', 'Choose Approve, Stay or Correct.');
  end if;
  select e.member_id into v_member from public.early_leave_requests e
  where e.id = early_leave_decide.request_id and e.org_id = v_org;
  if v_member is null then
    perform app.fail('NOT_FOUND', 'That request doesn''t exist.');
  end if;
  -- The leave: lock first, like every writer of a member's days (DATA-MODEL §3).
  perform pg_advisory_xact_lock(hashtext('leave:' || v_member::text));
  select e.* into v_req from public.early_leave_requests e where e.id = early_leave_decide.request_id for update;
  select d.* into v_day from public.attendance_days d where d.id = v_req.day_id for update;
  select m.role into v_role from public.members m where m.id = v_member;

  if decision = 'approve' and v_req.state = 'waiting' then
    -- Approve ends the day at the time they asked: the real tap, whenever the Owner answers.
    if v_day.ended_at is null then
      perform set_config('app.audit_override', jsonb_build_object(
        'action', 'ended', 'meta', jsonb_build_object('early_leave_request_id', v_req.id))::text, true);
      update public.attendance_days set ended_at = v_req.requested_at, end_not_recorded = false where id = v_day.id;
      perform app.attendance_event(v_day.id, 'ended', null, null, 'Left early, approved', v_caller);
    end if;
    v_state := 'approved';
    v_title := 'You can leave: early leave approved';
    v_body := format('Your day ended at %s.', app.ist_time(v_req.requested_at));
  elsif decision = 'approve' and v_req.state = 'left_unanswered' then
    v_state := 'approved';
    v_title := 'Your early leave was approved';
    v_body := format('You left at %s.', app.ist_time(v_req.left_at));
  elsif decision = 'stay' and v_req.state = 'waiting' then
    select h.* into v_hours from app.attendance_hours(v_member, v_day.work_date) h;
    v_state := 'stay';
    v_title := format('Please stay until %s', app.ist_time(v_hours.end_at));
    v_body := coalesce(v_reason, 'You''ll be reminded at your end time.');
  elsif decision = 'correct' and v_req.state = 'left_unanswered' then
    if status is null or v_reason is null then
      perform app.fail('VALIDATION', 'Choose what the day should be and give a reason.');
    end if;
    -- A correction beside the original (invariant 7): the day's start and end stay as tapped.
    perform public.attendance_decide(v_day.id, 'correct', status, v_reason);
    v_state := 'corrected';
  else
    perform app.fail('INVALID_STATE', case v_req.state
      when 'waiting' then 'Approve or ask them to stay.'
      when 'left_unanswered' then 'Approve it or correct the day.'
      else 'This request has already been answered.' end);
  end if;

  perform set_config('app.audit_override', jsonb_build_object('action', v_state)::text, true);
  update public.early_leave_requests
  set state = v_state, decided_by = v_caller, decided_at = now(), decision_reason = v_reason
  where id = v_req.id;

  -- WORKFLOWS §9: the person, never email (a correction is attendance_decide's own row).
  if v_title is not null then
    perform app.notify(array[v_member], 'early_leave_decided', v_title, v_body,
      case when v_role = 'admin' then '/today' else '/my-day' end,
      'early_leave_requests', v_req.id, jsonb_build_object('request_id', v_req.id, 'decision', v_state), v_caller);
  end if;
  return v_state;
end;
$$;
comment on function public.early_leave_decide(uuid, text, public.day_status, text) is
  'v1.9 W0, attendance.decide (the Owner only; invariant 7, owner 2026-10-22). waiting: approve (the '
  'day ends at requested_at unless already ended) or stay; left_unanswered: approve (it stands) or '
  'correct (status + reason through attendance_decide, beside the original). INVALID_STATE otherwise, '
  'NOT_FOUND outside the org. Audit approved | stay | corrected; the person told (early_leave_decided) '
  'except on correct (attendance_decided). Returns the new state.';
revoke all on function public.early_leave_decide(uuid, text, public.day_status, text) from public, anon;
grant execute on function public.early_leave_decide(uuid, text, public.day_status, text) to authenticated, service_role;

-- The reminders: "Start your day" at the start time, and the end time after a "Stay" answer.
create function app.attendance_hours_tick(p_now timestamptz default now())
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_today date := app.to_ist_date(p_now);
  v_time time := (p_now at time zone 'Asia/Kolkata')::time;
  v_set public.org_settings;
  v_row record;
  v_hours record;
  v_leave public.leave_requests;
  v_n integer := 0;
begin
  if app.is_working_day(v_today) is false then
    return 0;
  end if;
  for v_set in select s.* from public.org_settings s where s.working_hours_on order by s.org_id loop
    perform pg_advisory_xact_lock(hashtext('app.attendance_hours_tick:' || v_set.org_id::text));

    if v_time >= v_set.work_start_time and v_time < v_set.work_end_time then
      for v_row in
        select m.id, m.role
        from public.members m
        where m.org_id = v_set.org_id and m.status = 'active' and m.engagement = 'permanent'
          and app.to_ist_date(m.joined_at) < v_today
          and exists (select 1 from public.role_permissions rp where rp.role = m.role and rp.permission = 'attendance.self')
          and not exists (select 1 from public.attendance_days d
                          where d.member_id = m.id and d.work_date = v_today
                            and (d.state <> 'awaiting_choice' or d.started_at is not null or d.is_day_off))
          and not exists (select 1 from public.notifications n
                          where n.recipient_id = m.id and n.kind = 'start_day_reminder'
                            and n.payload ->> 'work_date' = v_today::text)
        order by m.id
      loop
        -- Not on leave: full or comp leave and a morning half day are off at the start time; an
        -- afternoon half day works the morning and is reminded.
        v_leave := app.leave_covering(v_row.id, v_today);
        continue when v_leave.id is not null and (v_leave.type <> 'half_day' or v_leave.half is distinct from 'afternoon');
        v_n := v_n + app.notify(array[v_row.id], 'start_day_reminder', 'Start your day',
          format('Work started at %s. Tap Start day when you begin.', app.wall_time(v_set.work_start_time)),
          case when v_row.role = 'admin' then '/today' else '/my-day' end, null, null,
          jsonb_build_object('work_date', v_today), null);
      end loop;
    end if;

    for v_row in
      select e.id, e.member_id, m.role
      from public.early_leave_requests e
      join public.attendance_days d on d.id = e.day_id
      join public.members m on m.id = e.member_id
      where e.org_id = v_set.org_id and e.state = 'stay' and e.stay_reminded_at is null
        and d.work_date = v_today and d.ended_at is null and m.status = 'active'
      order by e.requested_at, e.id
    loop
      select h.* into v_hours from app.attendance_hours(v_row.member_id, v_today) h;
      continue when v_hours.end_at > p_now;
      perform set_config('app.audit_override', jsonb_build_object('action', 'stay_reminded')::text, true);
      update public.early_leave_requests set stay_reminded_at = p_now where id = v_row.id;
      v_n := v_n + app.notify(array[v_row.member_id], 'end_time_reminder',
        format('It''s %s: you can end your day', app.ist_time(v_hours.end_at)), null,
        case when v_row.role = 'admin' then '/today' else '/my-day' end,
        'early_leave_requests', v_row.id, jsonb_build_object('request_id', v_row.id), null);
    end loop;
  end loop;
  return v_n;
end;
$$;
comment on function app.attendance_hours_tick(timestamptz) is
  'v1.9 W0, service_role only (pg_cron every 5 minutes): while working_hours_on and on a working '
  'day, "Start your day" (start_day_reminder, once a day; the row is the record) from work_start_time '
  'to before work_end_time to each active permanent member with attendance.self, attendance started, '
  'not started, not on leave (an afternoon half day is reminded); and after a Stay answer the '
  'end_time_reminder once the day''s end time has passed and the day is still open '
  '(stay_reminded_at). Never emailed. Returns the rows written.';
revoke all on function app.attendance_hours_tick(timestamptz) from public, anon, authenticated;
grant execute on function app.attendance_hours_tick(timestamptz) to service_role;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'attendance_hours_tick') then
    perform cron.unschedule('attendance_hours_tick');
  end if;
  perform cron.schedule('attendance_hours_tick', '*/5 * * * *', 'select app.attendance_hours_tick(now())');
end;
$$;

-- The reads for W4's screens --------------------------------------------------------------------------

-- The caller's working hours today.
create function public.attendance_own_hours()
returns table (
  work_date date, rules_on boolean, late_applies boolean, early_applies boolean, half text,
  start_at timestamptz, late_after timestamptz, end_at timestamptz, end_source text, stay_until timestamptz,
  late_minutes integer, late_reason text, late_reason_suggestion text,
  early_leave_id uuid, early_leave_state text, early_leave_reason text, early_leave_requested_at timestamptz,
  early_leave_end_from timestamptz, can_end_now boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_caller uuid;
  v_org uuid;
  v_today date := app.today_ist();
  v_hours record;
  v_day public.attendance_days;
  v_req public.early_leave_requests;
  v_wait integer;
  v_shoot timestamptz;
begin
  select r.caller_id, r.org_id into v_caller, v_org from app.attendance_require_self() r;
  select h.* into v_hours from app.attendance_hours(v_caller, v_today) h;
  select d.* into v_day from public.attendance_days d where d.member_id = v_caller and d.work_date = v_today;
  select e.* into v_req from public.early_leave_requests e
  where e.day_id = v_day.id order by e.requested_at desc limit 1;
  select s.early_leave_wait_minutes into v_wait from public.org_settings s where s.org_id = v_org;
  -- The pre-filled late reason: a timed event (a shoot) later that day, the earliest still to start.
  select min(t.event_start_at) into v_shoot
  from public.tasks t
  join public.task_assignees a on a.task_id = t.id and a.member_id = v_caller and a.removed_at is null
  where t.event_date = v_today and t.event_start_at is not null and t.event_start_at > v_hours.start_at
    and t.state <> 'cancelled' and t.archived_at is null;

  return query select
    v_today, v_hours.rules_on, v_hours.late_applies, v_hours.early_applies, v_hours.half,
    v_hours.start_at, v_hours.late_after, v_hours.end_at, v_hours.end_source, v_hours.stay_until,
    v_day.late_minutes, v_day.late_reason,
    case when v_hours.late_applies and v_shoot is not null then 'Shoot at ' || app.ist_time(v_shoot) end,
    v_req.id, v_req.state, v_req.reason, v_req.requested_at,
    case when v_req.state = 'waiting' then v_req.requested_at + make_interval(mins => v_wait) end,
    coalesce(v_day.started_at is not null and v_day.ended_at is null
      and (not v_hours.early_applies or now() >= v_hours.end_at
           or (v_req.state = 'waiting' and now() >= v_req.requested_at + make_interval(mins => v_wait))), false);
end;
$$;
comment on function public.attendance_own_hours() is
  'v1.9 W0, attendance.self, read only: the caller''s working hours today (app.attendance_hours), '
  'Late and its reason, late_reason_suggestion "Shoot at <time>" when a timed event task starts later '
  'that day, the latest early-leave request with when End day opens (early_leave_end_from), and '
  'can_end_now. One row.';
revoke all on function public.attendance_own_hours() from public, anon;
grant execute on function public.attendance_own_hours() to authenticated, service_role;

-- The Owner's view of everyone's hours today.
create function public.attendance_hours_today()
returns table (
  member_id uuid, full_name text, rules_on boolean, started_at timestamptz, ended_at timestamptz,
  late_minutes integer, late_reason text, end_at timestamptz, end_source text, stay_until timestamptz,
  early_leave_id uuid, early_leave_state text, early_leave_reason text, early_leave_requested_at timestamptz,
  left_early boolean, ended_after_end boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_caller uuid;
  v_org uuid;
  v_today date := app.today_ist();
begin
  select m.id, m.org_id into v_caller, v_org from app.current_member() m;
  if v_caller is null then
    perform app.fail('UNAUTHENTICATED', 'Your account is not active.');
  end if;
  if not app.has_permission('attendance.view_all') then
    perform app.fail('FORBIDDEN', 'Everyone''s working hours are the Owner''s.');
  end if;
  return query
  select m.id, m.full_name, h.rules_on, d.started_at, d.ended_at, d.late_minutes, d.late_reason,
         h.end_at, h.end_source, h.stay_until, e.id, e.state, e.reason, e.requested_at,
         coalesce(e.state in ('approved', 'left_unanswered', 'corrected'), false),
         coalesce(d.ended_at > h.end_at, false)
  from public.members m
  cross join lateral app.attendance_hours(m.id, v_today) h
  left join public.attendance_days d on d.member_id = m.id and d.work_date = v_today
  left join lateral (
    select x.* from public.early_leave_requests x where x.day_id = d.id order by x.requested_at desc limit 1) e on true
  where m.org_id = v_org and m.status = 'active' and m.engagement = 'permanent'
    and app.to_ist_date(m.joined_at) < v_today
    and exists (select 1 from public.role_permissions rp where rp.role = m.role and rp.permission = 'attendance.self')
  order by m.full_name, m.id;
end;
$$;
comment on function public.attendance_hours_today() is
  'v1.9 W0, attendance.view_all (the Owner), read only: each active permanent member with '
  'attendance.self (attendance started) today: start and end taps, Late and its reason, the end time '
  'and its source, Stay until, the latest early-leave request, left_early, ended_after_end.';
revoke all on function public.attendance_hours_today() from public, anon;
grant execute on function public.attendance_hours_today() to authenticated, service_role;

-- Late days and early leaves per person for a month, beside month_summary().
create function public.month_summary_hours(month date, member_id uuid default null)
returns table (id uuid, late_days integer, early_leaves integer, left_unanswered integer)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_caller uuid;
  v_org uuid;
  v_first date;
  v_last date;
begin
  select m.id, m.org_id into v_caller, v_org from app.current_member() m;
  if v_caller is null then
    perform app.fail('UNAUTHENTICATED', 'Your account is not active.');
  end if;
  if not app.has_permission('attendance.view_all') then
    perform app.fail('FORBIDDEN', 'The month summary is the Owner''s.');
  end if;
  if month_summary_hours.month is null then
    perform app.fail('VALIDATION', 'Pick a month.');
  end if;
  v_first := date_trunc('month', month_summary_hours.month::timestamp)::date;
  v_last := app.ist_month_end(v_first);
  return query
  select m.id,
         (select count(*)::integer from public.attendance_days d
          where d.member_id = m.id and d.work_date between v_first and v_last and d.late_minutes is not null),
         (select count(*)::integer from public.early_leave_requests e
          join public.attendance_days d on d.id = e.day_id
          where e.member_id = m.id and d.work_date between v_first and v_last
            and e.state in ('approved', 'left_unanswered', 'corrected')),
         (select count(*)::integer from public.early_leave_requests e
          join public.attendance_days d on d.id = e.day_id
          where e.member_id = m.id and d.work_date between v_first and v_last and e.left_at is not null)
  from public.members m
  where m.org_id = v_org
    and (month_summary_hours.member_id is null or m.id = month_summary_hours.member_id)
    and m.status <> 'invited' and m.joined_at is not null
    and app.to_ist_date(m.joined_at) <= v_last
    and (m.deactivated_at is null or app.to_ist_date(m.deactivated_at) >= v_first)
    and m.engagement = 'permanent'
    and exists (select 1 from public.role_permissions rp where rp.role = m.role and rp.permission = 'attendance.self')
  order by m.full_name, m.id;
end;
$$;
comment on function public.month_summary_hours(date, uuid) is
  'v1.9 W0, attendance.view_all (the Owner), read only, beside month_summary() and with its people: '
  'per member the month''s late_days, early_leaves (approved, left unanswered or corrected) and '
  'left_unanswered (ended after the wait with no answer).';
revoke all on function public.month_summary_hours(date, uuid) from public, anon;
grant execute on function public.month_summary_hours(date, uuid) to authenticated, service_role;
