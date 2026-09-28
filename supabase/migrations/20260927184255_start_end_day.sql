-- 3b.1 Start day / End day (PRODUCT §4.2 as reworked 2026-09-27, ADR-0012 amendment, kickoff 3b
--   decisions 1-9 and 28; DATA-MODEL §3 "3b.1"; WORKFLOWS §1 "Settled in 3b.1", §8).
--
-- The working day is two explicit taps, Start day and End day, separate from signing in and out.
-- The blocking first-request day gate (2.2) gives way to an in-app prompt; sign-out records only
-- session_events.
--
-- EXPAND-ONLY (ARCHITECTURE §18, owner decision 2026-09-27): this migration reaches the shared
-- staging database while main's app (the 2.x gate) still runs against it. Everything here is
-- ADDED beside the 2.x shape: three nullable / defaulted columns, a widened check constraint, new
-- functions, one more cron row. attendance_touch(), attendance_submit(), app.attendance_logout(),
-- session_logout(), attendance_today() and the jobs keep their signatures and meaning; the
-- contract migration after the merge removes what Start/End day replaces (listed in PROGRESS).
--
-- Every write is labelled through app.audit_override (ADR-0006); the leave: advisory lock comes
-- before any row lock (DATA-MODEL §3 "Lock order"). No notification rows yet: the WORKFLOWS §9
-- recipient is named in each function's comment for 5.1 (kickoff 3b decision 32).
-- Append-only: never edit once applied.

-- attendance_days: the day's start and end ------------------------------------------------------
alter table public.attendance_days
  add column started_at timestamptz null,
  add column ended_at timestamptz null,
  add column end_not_recorded boolean not null default false,
  add constraint attendance_days_ended_after_start
    check (ended_at is null or (started_at is not null and ended_at >= started_at));

comment on column public.attendance_days.started_at is
  'The Start day tap (3b.1): the moment the member said they started working. Null for a day '
  'recorded the 2.x way (first_login_at stands in, kickoff 3b decision 31) or never started.';
comment on column public.attendance_days.ended_at is
  'The End day tap (3b.1): final for the day, no resume. An End day after midnight lands on the '
  'previous day. Never made up: the 00:00 job flags end_not_recorded instead.';
comment on column public.attendance_days.end_not_recorded is
  'The 00:00 IST job found a start with no end (3b.1). A late End day clears it.';

-- The three new columns move only through transition functions, like every other state column.
drop trigger protect_columns on public.attendance_days;
create trigger protect_columns before update on public.attendance_days
  for each row execute function app.protect_columns(
    'member_id', 'work_date', 'first_login_at', 'is_day_off', 'state', 'submitted_choice',
    'submitted_at', 'proposed_by_system', 'final_status', 'decided_by', 'decided_at',
    'decision_reason', 'last_logout_at', 'logout_not_recorded', 'overtime_flag', 'overtime_reason',
    'worked_on_leave', 'leave_request_id', 'started_at', 'ended_at', 'end_not_recorded');

-- attendance_events: two more actions (widened, never narrowed) -----------------------------------
alter table public.attendance_events drop constraint attendance_events_action_check;
alter table public.attendance_events add constraint attendance_events_action_check check (action in (
  'submitted', 'proposed_absent', 'derived_from_leave', 'approved', 'corrected', 'logout',
  'overtime_flagged', 'started', 'ended'));

-- attendance_own_today: what the prompt and the strip need, in one read ------------------------------
create function public.attendance_own_today()
returns table (
  work_date date, attendance_started boolean, is_working_day boolean, day_id uuid,
  state public.attendance_state, submitted_choice public.attendance_choice,
  final_status public.day_status, proposed_by_system boolean, decided_by_system boolean,
  decision_reason text, worked_on_leave boolean, leave_type public.leave_type, is_day_off boolean,
  first_login_at timestamptz, started_at timestamptz, ended_at timestamptz, end_not_recorded boolean,
  overtime_flag boolean, overtime_reason text,
  yesterday_open_day_id uuid, yesterday_started_at timestamptz, covering_leave_type public.leave_type)
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
  v_joined timestamptz;
begin
  select r.caller_id, r.org_id into v_caller, v_org from app.attendance_require_self() r;
  select m.joined_at into v_joined from public.members m where m.id = v_caller;

  return query
  select v_today,
         app.to_ist_date(v_joined) < v_today,
         -- null from is_working_day() means "unknown", which is not a day off (as attendance_touch).
         app.is_working_day(v_today) is not false,
         d.id, d.state, d.submitted_choice, d.final_status,
         coalesce(d.proposed_by_system, false),
         d.id is not null and d.decided_by is null,
         d.decision_reason, coalesce(d.worked_on_leave, false), l.type,
         coalesce(d.is_day_off, app.is_working_day(v_today) is false),
         d.first_login_at, d.started_at, d.ended_at, coalesce(d.end_not_recorded, false),
         coalesce(d.overtime_flag, false), d.overtime_reason,
         y.id, y.started_at,
         -- Approved leave covering today when nobody has opened the day yet: no prompt, and the
         -- strip says "On leave today" before any row exists (a Start day would derive the row).
         case when d.id is null then (app.leave_covering(v_caller, v_today)).type end
  from (select 1) as one
  left join public.attendance_days d on d.member_id = v_caller and d.work_date = v_today
  left join public.leave_requests l on l.id = d.leave_request_id
  left join public.attendance_days y
    on y.member_id = v_caller and y.work_date = v_today - 1
       and y.started_at is not null and y.ended_at is null;
end;
$$;

revoke all on function public.attendance_own_today() from public, anon;
grant execute on function public.attendance_own_today() to authenticated, service_role;

comment on function public.attendance_own_today() is
  'attendance.self (FORBIDDEN otherwise). Read only. The caller''s own day for today (IST) with '
  'attendance_started (today > the IST date of joined_at), is_working_day (app.is_working_day is '
  'not false), the day''s columns or nulls, the linked leave''s type, yesterday''s day when it has '
  'a start and no end (the one attendance_end_day() closes), and covering_leave_type: approved '
  'leave covering today while no row exists yet (no prompt on a leave day). One read for the '
  'Start-day prompt and the attendance strip (3b.1).';

-- attendance_start_day ---------------------------------------------------------------------------
create function public.attendance_start_day()
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
    -- A start is not a sign-in: first_login_at stays null (kickoff 3b decision 2).
    v_day := app.attendance_open_day(v_caller, v_today, null);
  elsif v_day.is_day_off then
    perform app.fail('INVALID_STATE', 'Today is a day off. Worked anyway? Add an "I worked today" note.');
  end if;

  if v_day.started_at is not null then
    perform app.fail('INVALID_STATE', 'Your day has already started.');
  end if;

  v_standing := coalesce(v_day.submitted_choice::text, v_day.final_status::text);

  if v_day.state = 'awaiting_choice' then
    -- The ordinary morning: the tap is the start, and the day waits for the Owner as Present.
    perform set_config('app.audit_override', jsonb_build_object(
      'action', 'started', 'meta', jsonb_build_object('choice', 'present'))::text, true);
    update public.attendance_days
    set state = 'pending_review', submitted_choice = 'present', submitted_at = now(), started_at = now(),
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
        final_status = null, proposed_by_system = false, decided_by = null, decided_at = null,
        decision_reason = null, worked_on_leave = false
    where id = v_day.id;
    perform app.attendance_event(v_day.id, 'started', v_day.final_status, 'present', null, v_caller);
  elsif v_standing in ('present', 'half_day') then
    -- A half-day leave day (Start and End stay available, PRODUCT §4.2), or a day already Present
    -- (a 2.x gate choice on the shared staging database, or one the Owner decided): the start time
    -- is recorded and the day's standing is not touched.
    perform set_config('app.audit_override', jsonb_build_object('action', 'started')::text, true);
    update public.attendance_days set started_at = now() where id = v_day.id;
    perform app.attendance_event(v_day.id, 'started', null, null, null, v_caller);
  elsif v_standing in ('leave', 'comp_leave') then
    perform app.fail('INVALID_STATE', 'You''re on leave today. Ask the Owner to correct it if you are working.');
  else
    perform app.fail('INVALID_STATE', 'Today''s attendance has already been decided. Ask the Owner to correct it.');
  end if;

  return v_day.id;
end;
$$;

revoke all on function public.attendance_start_day() from public, anon;
grant execute on function public.attendance_start_day() to authenticated, service_role;

comment on function public.attendance_start_day() is
  'attendance.self, the caller''s own day for today (IST). Opens the day when there is none '
  '(first_login_at null: a start is not a sign-in). awaiting_choice -> pending_review as Present '
  'with started_at = now(); an untouched day derived from full leave or comp leave -> the same '
  '("I''m working today", leave kept); a half-day leave day or a day already Present -> started_at '
  'only. INVALID_STATE on the joining day, on a day off ("add an I worked today note"), when '
  'already started, or when today is a leave or a decided absence. The start time is the tap. Takes '
  'the leave: lock first. Audit action: started. Notifies nobody (WORKFLOWS §9: the Owner''s Today '
  'counts are the digest).';

-- attendance_choose_leave_today ------------------------------------------------------------------
create function public.attendance_choose_leave_today(choice public.attendance_choice, reason text default null)
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
begin
  select r.caller_id, r.org_id into v_caller, v_org from app.attendance_require_self() r;
  if choice is null or choice not in ('leave', 'half_day') then
    perform app.fail('VALIDATION', 'Choose Leave or Half day. Comp leave is requested from the leave form.');
  end if;
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
    v_day := app.attendance_open_day(v_caller, v_today, null);
  end if;

  -- The 2.1 rules, request and audit, unchanged: the day is the single door for this request.
  return public.attendance_submit(choice, reason, v_today);
end;
$$;

revoke all on function public.attendance_choose_leave_today(public.attendance_choice, text) from public, anon;
grant execute on function public.attendance_choose_leave_today(public.attendance_choice, text) to authenticated, service_role;

comment on function public.attendance_choose_leave_today(public.attendance_choice, text) is
  'attendance.self. The Start-day prompt''s "On leave today? Choose leave" (3b.1): leave or '
  'half_day only (VALIDATION otherwise; comp leave is requested from the leave form, kickoff 3b '
  'decision 16). Joining day and a day off are INVALID_STATE. Opens today''s row when there is '
  'none, then attendance_submit(choice, reason, today): the source = attendance request, the '
  'rules and the audit are 2.1''s. Notifies nobody.';

-- attendance_end_day -----------------------------------------------------------------------------
create function public.attendance_end_day()
returns table (day_id uuid, work_date date)
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
begin
  select r.caller_id, r.org_id into v_caller, v_org from app.attendance_require_self() r;

  perform pg_advisory_xact_lock(hashtext('leave:' || v_caller::text));

  select d.* into v_day
  from public.attendance_days d
  where d.member_id = v_caller and d.work_date = v_today and d.started_at is not null and d.ended_at is null
  for update;
  if v_day.id is null then
    -- Today started and ended: final, no resume. Checked before yesterday, or a second tap (another
    -- device, a stale tab) would write a false end onto an open yesterday.
    if exists (select 1 from public.attendance_days d
               where d.member_id = v_caller and d.work_date = v_today and d.started_at is not null) then
      perform app.fail('INVALID_STATE', 'Your day has already ended.');
    end if;
    -- Worked past midnight: the end belongs to yesterday's day, a real time, never made up.
    select d.* into v_day
    from public.attendance_days d
    where d.member_id = v_caller and d.work_date = v_today - 1 and d.started_at is not null and d.ended_at is null
    for update;
  end if;
  if v_day.id is null then
    if exists (select 1 from public.attendance_days d
               where d.member_id = v_caller and d.work_date = v_today and d.ended_at is not null) then
      perform app.fail('INVALID_STATE', 'Your day has already ended.');
    end if;
    perform app.fail('INVALID_STATE', 'Start your day first.');
  end if;

  -- Only the end moves: state, final_status and the Owner's decision are never touched. An end is
  -- recorded now, so the 00:00 job's flag no longer holds (the 2.5 rule for a late logout).
  perform set_config('app.audit_override', jsonb_build_object('action', 'ended')::text, true);
  update public.attendance_days set ended_at = now(), end_not_recorded = false where id = v_day.id;
  perform app.attendance_event(v_day.id, 'ended', null, null, null, v_caller);

  return query select v_day.id, v_day.work_date;
end;
$$;

revoke all on function public.attendance_end_day() from public, anon;
grant execute on function public.attendance_end_day() to authenticated, service_role;

comment on function public.attendance_end_day() is
  'attendance.self. Ends the caller''s started day: today''s, else yesterday''s with a start and no '
  'end (an End day after midnight lands on the previous day, the 2.1 late-logout rule). ended_at = '
  'now() and end_not_recorded = false in one write; final, no resume. INVALID_STATE with no started '
  'day ("Start your day first") or once today has ended. Returns (day_id, work_date). Audit '
  'action: ended. Notifies nobody.';

-- session_sign_out: sign-out is no longer attendance ---------------------------------------------
create function public.session_sign_out(user_agent text default null, ip_hash text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_member_id uuid;
  v_id uuid;
begin
  select m.id into v_member_id from app.current_member() m;
  if v_member_id is null then
    perform app.fail('UNAUTHENTICATED', 'Your account is not active.');
  end if;

  insert into public.session_events (member_id, kind, user_agent, ip_hash)
  values (v_member_id, 'logout', nullif(left(user_agent, 512), ''), nullif(left(ip_hash, 128), ''))
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.session_sign_out(text, text) from public, anon;
grant execute on function public.session_sign_out(text, text) to authenticated, service_role;

comment on function public.session_sign_out(text, text) is
  '"Sign out of this device" (ADR-0012 amendment 2026-09-27): session_events(logout) for the '
  'calling active member and nothing else; the attendance day is never touched. The 3b app calls '
  'this; session_logout() stays for main until the contract migration.';

-- attendance_today_detail: the Owner's board with the day's start and end -----------------------
create function public.attendance_today_detail()
returns table (
  member_id uuid, full_name text, job_title text, started boolean, day_id uuid,
  state public.attendance_state, final_status public.day_status,
  submitted_choice public.attendance_choice, proposed_by_system boolean,
  first_login_at timestamptz, last_logout_at timestamptz, logout_not_recorded boolean,
  overtime_flag boolean, is_day_off boolean, on_leave boolean, leave_type public.leave_type,
  started_at timestamptz, ended_at timestamptz, end_not_recorded boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_org uuid;
  v_today date := app.today_ist();
  v_day_off boolean;
begin
  select m.org_id into v_org from app.current_member() m;
  if v_org is null then
    perform app.fail('UNAUTHENTICATED', 'Your account is not active.');
  end if;
  if not app.has_permission('attendance.view_all') then
    perform app.fail('FORBIDDEN', 'Only the Owner sees everyone''s attendance.');
  end if;

  v_day_off := app.is_working_day(v_today) is false;

  return query
  select m.id, m.full_name, j.name,
         app.to_ist_date(m.joined_at) < v_today,
         d.id, d.state, d.final_status, d.submitted_choice,
         coalesce(d.proposed_by_system, false), d.first_login_at, d.last_logout_at,
         coalesce(d.logout_not_recorded, false), coalesce(d.overtime_flag, false),
         coalesce(d.is_day_off, v_day_off),
         l.id is not null, l.type,
         d.started_at, d.ended_at, coalesce(d.end_not_recorded, false)
  from public.members m
  left join public.list_items j on j.id = m.job_title_id
  left join public.attendance_days d on d.member_id = m.id and d.work_date = v_today
  left join lateral app.leave_covering(m.id, v_today) l on true
  where m.org_id = v_org
    and m.status = 'active'
    and exists (select 1 from public.role_permissions rp
                where rp.role = m.role and rp.permission = 'attendance.self')
  order by m.full_name, m.id;
end;
$$;

revoke all on function public.attendance_today_detail() from public, anon;
grant execute on function public.attendance_today_detail() to authenticated, service_role;

comment on function public.attendance_today_detail() is
  'attendance.view_all (FORBIDDEN otherwise). Read only. attendance_today() (2.4) plus '
  'started_at, ended_at and end_not_recorded per row, for the Owner''s Today card and people board '
  '(3b.1). The 2.4 function keeps its shape for main until the contract migration.';

-- end_not_recorded: the 00:00 job ----------------------------------------------------------------
create function app.end_not_recorded(for_date date default null)
returns table (work_date date, member_id uuid, day_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_last date := app.job_day(now(), '23:59');
  v_first date;
  v_date date;
  v_row record;
  v_day public.attendance_days;
begin
  if for_date is null then
    -- Catch-up (WORKFLOWS §8): the last 7 IST dates, oldest first, like the 2.5 jobs.
    v_first := v_last - 6;
  elsif for_date > v_last then
    perform app.fail('INVALID_STATE', 'That day has not ended yet.');
  else
    v_first := for_date;
    v_last := for_date;
  end if;

  for v_date in select s::date from generate_series(v_first, v_last, interval '1 day') s loop
    for v_row in
      select d.id, d.member_id
      from public.attendance_days d
      where d.work_date = v_date
        and d.started_at is not null and d.ended_at is null and not d.end_not_recorded
      order by d.member_id
    loop
      perform pg_advisory_xact_lock(hashtext('leave:' || v_row.member_id::text));
      -- Under the lock, look again: an End day may have landed in between.
      select d.* into v_day from public.attendance_days d where d.id = v_row.id for update;
      if v_day.ended_at is not null or v_day.end_not_recorded then
        continue;
      end if;
      perform set_config('app.audit_override', jsonb_build_object('action', 'end_not_recorded')::text, true);
      update public.attendance_days set end_not_recorded = true where id = v_day.id;
      return query select v_date, v_day.member_id, v_day.id;
    end loop;
  end loop;
end;
$$;

revoke all on function app.end_not_recorded(date) from public, authenticated;
grant execute on function app.end_not_recorded(date) to service_role;

comment on function app.end_not_recorded(date) is
  'The 00:00 IST job (WORKFLOWS §1 "Settled in 3b.1", §8), the same dates as absent_check: every '
  'day with a Start day and no End day gets end_not_recorded = true (audit end_not_recorded, no '
  'event). No time is made up. Idempotent. Each member under their leave: lock. Notifies nobody '
  '(the 20:30 reminder before it is 5.1''s, see app.end_day_reminder_due).';

-- end_day_reminder_due: who gets "You haven't ended your day" ------------------------------------
create function app.end_day_reminder_due(p_at timestamptz default now())
returns table (member_id uuid, day_id uuid, started_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select d.member_id, d.id, d.started_at
  from public.attendance_days d
  join public.members m on m.id = d.member_id and m.status = 'active'
  where d.work_date = app.to_ist_date(p_at)
    and d.started_at is not null and d.ended_at is null
  order by d.member_id;
$$;

revoke all on function app.end_day_reminder_due(timestamptz) from public, authenticated;
grant execute on function app.end_day_reminder_due(timestamptz) to service_role;

comment on function app.end_day_reminder_due(timestamptz) is
  'Read only, service_role. The members to remind at org_settings.logout_reminder_time (20:30 IST): '
  'every day on the IST date of p_at with a Start day and no End day, for active members. '
  'WORKFLOWS §9 recipient: that member ("You haven''t ended your day. If you''re done, end it; if '
  'you''re working late, carry on."). The notification rows and the schedule arrive with 5.1 '
  '(kickoff 3b decision 32).';

-- pg_cron ---------------------------------------------------------------------------------------
-- 18:30 UTC = 00:00 IST, the minute after absent_check, beside logout_not_recorded (kept for main).
select cron.schedule('end_not_recorded', '30 18 * * *', $$select app.end_not_recorded()$$);
