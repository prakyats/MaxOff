-- v1.9 W0 review (advisor must-fix, 2026-10-22, #89): one clock for the working-hours functions, so pgTAP
-- runs them on fixed instants instead of skipping near midnight IST (a test never passes by skipping).
--
-- app.now() is now(), unless the transaction-local setting app.test_now is set on a session that is not
-- the API's (`authenticator`, PostgREST: the app, Playwright and every client). Only a direct database
-- session (pgTAP as postgres) can set it, and only for its own transaction. Production never sets it.
-- Kept narrow on purpose (ARCHITECTURE §15 "Deterministic by construction" keeps the real clock for
-- the app and Playwright): app.today_ist() and every other function keep reading now(); only the eight
-- v1.9 W0 functions below read app.now() (re-created, same signatures and bodies, now() ->
-- app.now() and app.today_ist() -> app.to_ist_date(app.now())). The frozen working_hours migration is
-- not edited. Expand-only. Append-only: never edit once applied.

create function app.now()
returns timestamptz
language sql
stable
set search_path = ''
as $$
  select case
    when session_user <> 'authenticator' and nullif(current_setting('app.test_now', true), '') is not null
      then current_setting('app.test_now', true)::timestamptz
    else now()
  end;
$$;
comment on function app.now() is
  'v1.9 W0: the working-hours functions'' clock. now(), unless the transaction-local app.test_now is set '
  'on a non-API session (pgTAP); the API role (authenticator) always gets now(). service_role only.';
revoke all on function app.now() from public, anon, authenticated;
grant execute on function app.now() to service_role;

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
  v_today date := app.to_ist_date(app.now());
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
  if v_hours.late_applies and app.now() > v_hours.late_after then
    v_late := floor(extract(epoch from (app.now() - v_hours.start_at)) / 60)::integer;
  end if;

  if v_day.state = 'awaiting_choice' then
    -- The ordinary morning: the tap is the start, and the day waits for the Owner as Present.
    perform set_config('app.audit_override', jsonb_build_object(
      'action', 'started', 'meta', jsonb_build_object('choice', 'present'))::text, true);
    update public.attendance_days
    set state = 'pending_review', submitted_choice = 'present', submitted_at = app.now(), started_at = app.now(),
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
    set state = 'pending_review', submitted_choice = 'present', submitted_at = app.now(), started_at = app.now(),
        late_minutes = v_late,
        final_status = null, proposed_by_system = false, decided_by = null, decided_at = null,
        decision_reason = null, worked_on_leave = false
    where id = v_day.id;
    perform app.attendance_event(v_day.id, 'started', v_day.final_status, 'present', null, v_caller);
  elsif v_standing in ('present', 'half_day') then
    -- A half-day leave day (Start and End stay available, PRODUCT §4.2), or a day already Present
    -- (one the Owner decided): the start time is recorded and the day's standing is not touched.
    perform set_config('app.audit_override', jsonb_build_object('action', 'started')::text, true);
    update public.attendance_days set started_at = app.now(), late_minutes = v_late where id = v_day.id;
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
  v_today date := app.to_ist_date(app.now());
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
      if not app.end_day_late_allowed(app.now(), v_cutoff) then
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
    if v_hours.early_applies and app.now() < v_hours.end_at then
      if v_req.id is null then
        perform app.fail('INVALID_STATE', format('Your day ends at %s. Ask to leave early instead.',
          app.ist_time(v_hours.end_at)));
      end if;
      select make_interval(mins => s.early_leave_wait_minutes) into v_wait
      from public.org_settings s where s.org_id = v_org;
      if app.now() < v_req.requested_at + v_wait then
        perform app.fail('INVALID_STATE', format('The Owner hasn''t answered yet. You can end your day from %s.',
          app.ist_time(v_req.requested_at + v_wait)));
      end if;
      perform set_config('app.audit_override', jsonb_build_object('action', 'left_unanswered')::text, true);
      update public.early_leave_requests set state = 'left_unanswered', left_at = app.now() where id = v_req.id;
    elsif v_req.id is not null then
      perform set_config('app.audit_override', jsonb_build_object('action', 'lapsed')::text, true);
      update public.early_leave_requests set state = 'lapsed' where id = v_req.id;
    end if;
  end if;

  -- Only the end moves: state, final_status and the Owner's decision are never touched. An end is
  -- recorded now, so the 00:00 job's flag no longer holds (the 2.5 rule for a late logout).
  perform set_config('app.audit_override', jsonb_build_object('action', 'ended')::text, true);
  update public.attendance_days set ended_at = app.now(), end_not_recorded = false where id = v_day.id;
  perform app.attendance_event(v_day.id, 'ended', null, null, null, v_caller);

  -- The confirmation's optional overtime note (PRODUCT §4.2, 3b.2), on the day that just ended.
  if app.clean_reason(overtime_note) is not null then
    v_note_id := public.extra_work_note_submit('overtime', v_day.work_date, overtime_note, overtime_minutes);
  end if;

  return query select v_day.id, v_day.work_date, v_note_id;
end;
$$;

create or replace function public.attendance_late_reason(reason text)
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
  where d.member_id = v_caller and d.work_date = app.to_ist_date(app.now())
  for update;
  if v_day.late_minutes is null then
    perform app.fail('INVALID_STATE', 'Today isn''t marked Late.');
  end if;
  perform set_config('app.audit_override', jsonb_build_object('action', 'late_reason')::text, true);
  update public.attendance_days set late_reason = v_reason where id = v_day.id;
  return v_day.id;
end;
$$;

create or replace function public.attendance_stay_until(member_id uuid, until timestamptz)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid;
  v_org uuid;
  v_today date := app.to_ist_date(app.now());
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
  if until is not null and (until <= app.now() or app.to_ist_date(until) <> v_today
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

create or replace function public.attendance_ask_leave_early(reason text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid;
  v_org uuid;
  v_today date := app.to_ist_date(app.now());
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
  if app.now() >= v_hours.end_at then
    perform app.fail('INVALID_STATE', format('Your day ended at %s: you can end it now.', app.ist_time(v_hours.end_at)));
  end if;
  if exists (select 1 from public.early_leave_requests e where e.day_id = v_day.id and e.state = 'waiting') then
    perform app.fail('CONFLICT', 'You have already asked. The Owner will answer.');
  end if;

  perform set_config('app.audit_override', jsonb_build_object('action', 'requested')::text, true);
  insert into public.early_leave_requests (org_id, member_id, day_id, requested_at, reason, end_at)
  values (v_org, v_caller, v_day.id, app.now(), v_reason, v_hours.end_at)
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

create or replace function public.early_leave_decide(
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
  set state = v_state, decided_by = v_caller, decided_at = app.now(), decision_reason = v_reason
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

create or replace function public.attendance_own_hours()
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
  v_today date := app.to_ist_date(app.now());
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
      and (not v_hours.early_applies or app.now() >= v_hours.end_at
           or (v_req.state = 'waiting' and app.now() >= v_req.requested_at + make_interval(mins => v_wait))), false);
end;
$$;

create or replace function public.attendance_hours_today()
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
  v_today date := app.to_ist_date(app.now());
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
