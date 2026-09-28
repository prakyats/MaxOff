-- 3c.1 Contract migration after phase 3b (PROGRESS "Contract migration after phase 3b merges";
--   ARCHITECTURE §18 "expand-only"; kickoff 3c decisions 6 and 7; kickoff 3b decision 31).
--
-- Phase 3b added the Start day / End day columns and functions BESIDE the 2.x day gate so that
-- main's app kept running on the shared staging database. 3b is merged: nothing in the app calls
-- the gate any more, so this migration removes it. It is the ONE sanctioned removal of the
-- release; from here on migrations stay expand-only across a release (decision 7).
--
-- 1. Backfill started_at / ended_at / end_not_recorded from the 2.x sign-in columns (decision 31:
--    a day recorded the 2.x way keeps its start and end), audited per row as 'backfilled'.
-- 2. Drop attendance_touch(), session_logout(), app.attendance_logout(), attendance_today() and
--    app.logout_not_recorded() with its cron row.
-- 3. Re-create what still read the columns: app.attendance_open_day(member, date) (no sign-in
--    time), app.absent_check(), attendance_flag_overtime_today(), attendance_own_today(),
--    attendance_start_day(), attendance_choose_leave_today(), attendance_today_detail().
-- 4. Drop first_login_at, last_logout_at and logout_not_recorded; re-create protect_columns.
-- 5. Close the 'logout' attendance event for new rows with a NOT VALID check: the rows that
--    exist stay (history is never destroyed), no function writes it any more.
-- 6. Comp leave without a credit is refused on every route (/review-phase 3b): leave_submit(),
--    attendance_submit() and leave_request_change() say VALIDATION; comp leave comes only through
--    leave_submit_comp(), which reserves a credit.
--
-- Every write is labelled through app.audit_override (ADR-0006). Append-only: never edit once applied.

-- 1. Backfill --------------------------------------------------------------------------------------
-- One audit row per day: the trigger clears the override after each row, so the label is set
-- inside the loop. No row lock order to worry about: the migration is the only writer.
do $$
declare
  v_day record;
begin
  for v_day in
    select d.id, d.first_login_at, d.last_logout_at, d.logout_not_recorded, d.started_at, d.ended_at, d.end_not_recorded
    from public.attendance_days d
    where (d.started_at is null and d.first_login_at is not null)
       or (d.ended_at is null and d.last_logout_at is not null)
       or (d.logout_not_recorded and not d.end_not_recorded)
    order by d.id
  loop
    perform set_config('app.audit_override', jsonb_build_object(
      'action', 'backfilled',
      'meta', jsonb_build_object('system', true, 'from', 'first_login_at/last_logout_at (2.x)'))::text, true);
    update public.attendance_days d
    set started_at = coalesce(d.started_at, d.first_login_at),
        -- An end needs a start it is not before (attendance_days_ended_after_start).
        ended_at = coalesce(d.ended_at,
                     case when d.last_logout_at >= coalesce(d.started_at, d.first_login_at)
                          then d.last_logout_at end),
        end_not_recorded = (d.end_not_recorded or d.logout_not_recorded)
                           and coalesce(d.started_at, d.first_login_at) is not null
                           and coalesce(d.ended_at,
                                 case when d.last_logout_at >= coalesce(d.started_at, d.first_login_at)
                                      then d.last_logout_at end) is null
    where d.id = v_day.id;
  end loop;
  perform set_config('app.audit_override', '', true);
end;
$$;

-- 2. The 2.x functions and job ---------------------------------------------------------------------
do $$
begin
  if exists (select 1 from cron.job where jobname = 'logout_not_recorded') then
    perform cron.unschedule('logout_not_recorded');
  end if;
end;
$$;

drop function public.attendance_touch(text, text);
drop function public.session_logout(text, text);
drop function app.attendance_logout(uuid);
drop function public.attendance_today();
drop function app.logout_not_recorded(date);

-- 3. The readers, re-created without the columns --------------------------------------------------

-- app.attendance_open_day(member, date): the sign-in argument is gone (a start is a tap, 3b.1).
drop function app.attendance_open_day(uuid, date, timestamptz);
create function app.attendance_open_day(p_member_id uuid, p_date date)
returns public.attendance_days
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_day public.attendance_days;
  v_leave public.leave_requests;
  v_day_off boolean;
begin
  select d.* into v_day
  from public.attendance_days d
  where d.member_id = p_member_id and d.work_date = p_date
  for update;
  if v_day.id is not null then
    return v_day;
  end if;

  -- null from is_working_day() means "unknown", which is not a day off.
  v_day_off := app.is_working_day(p_date) is false;
  v_leave := app.leave_covering(p_member_id, p_date);

  if v_leave.id is not null then
    perform set_config('app.audit_override', jsonb_build_object(
      'action', 'derived_from_leave',
      'meta', jsonb_build_object('leave_request_id', v_leave.id))::text, true);
    insert into public.attendance_days (
      member_id, work_date, is_day_off, state, proposed_by_system, final_status, decided_at, leave_request_id)
    values (
      p_member_id, p_date, v_day_off, 'approved', true,
      v_leave.type::text::public.day_status, now(), v_leave.id)
    on conflict on constraint attendance_days_member_date_key do nothing
    returning * into v_day;
  else
    perform set_config('app.audit_override', jsonb_build_object('action', 'opened')::text, true);
    insert into public.attendance_days (member_id, work_date, is_day_off)
    values (p_member_id, p_date, v_day_off)
    on conflict on constraint attendance_days_member_date_key do nothing
    returning * into v_day;
  end if;

  if v_day.id is null then
    -- Another writer won the race: nothing was written, so the label must not linger.
    perform set_config('app.audit_override', '', true);
    select d.* into v_day
    from public.attendance_days d
    where d.member_id = p_member_id and d.work_date = p_date;
  elsif v_day.state = 'approved' then
    perform app.attendance_event(v_day.id, 'derived_from_leave', null, v_day.final_status, null, null);
  end if;
  return v_day;
end;
$$;

revoke all on function app.attendance_open_day(uuid, date) from public, anon, authenticated;
grant execute on function app.attendance_open_day(uuid, date) to service_role;

comment on function app.attendance_open_day(uuid, date) is
  'The member''s day for that date, opened when there is none: approved leave covering it gives an '
  'approved derived day (event and audit derived_from_leave), otherwise awaiting_choice (audit '
  'opened). No sign-in time: a start is the Start day tap (3b.1). The caller holds the member''s '
  'leave: lock. Used by attendance_start_day, attendance_choose_leave_today and app.absent_check.';

-- app.absent_check: the same job, the day opener without the sign-in argument.
create or replace function app.absent_check(for_date date default null)
returns table (work_date date, member_id uuid, day_id uuid, outcome text)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_last date := app.job_day(now(), '23:59');
  v_first date;
  v_date date;
  v_working boolean;
  v_member record;
  v_day public.attendance_days;
begin
  if for_date is null then
    -- Catch-up (WORKFLOWS §8): the last 7 IST dates, oldest first. Idempotent, so a processed
    -- day writes nothing and a missed night is filled on the next run.
    v_first := v_last - 6;
  elsif for_date > v_last then
    perform app.fail('INVALID_STATE', 'That day has not ended yet.');
  else
    v_first := for_date;
    v_last := for_date;
  end if;

  for v_date in select s::date from generate_series(v_first, v_last, interval '1 day') s loop
    v_working := app.is_working_day(v_date);
    if v_working is null then
      -- No single organization in scope: "unknown" is never a working day (DATA-MODEL §0a).
      perform app.fail('INVALID_STATE', 'No organization is in scope; the absent check did nothing.');
    end if;
    if not v_working then
      -- A day off: nothing is expected, so nothing is written, leave-derived days included.
      continue;
    end if;

    -- Everyone attendance applies to (attendance.self by role, PERMISSIONS §1) whose attendance
    -- had started on that date (the IST day after joined_at, WORKFLOWS §1), in id order so two
    -- overlapping runs take the members' locks in the same order.
    for v_member in
      select m.id
      from public.members m
      where m.status = 'active'
        and app.to_ist_date(m.joined_at) < v_date
        and exists (
          select 1 from public.role_permissions rp
          where rp.role = m.role and rp.permission = 'attendance.self')
      order by m.id
    loop
      perform pg_advisory_xact_lock(hashtext('leave:' || v_member.id::text));

      select d.* into v_day
      from public.attendance_days d
      where d.member_id = v_member.id and d.work_date = v_date
      for update;

      if v_day.id is null then
        if (app.leave_covering(v_member.id, v_date)).id is not null then
          -- Approved leave comes first: the day they never started is a leave day.
          v_day := app.attendance_open_day(v_member.id, v_date);
          return query select v_date, v_member.id, v_day.id, 'derived_from_leave'::text;
          continue;
        end if;
        perform set_config('app.audit_override', jsonb_build_object('action', 'proposed_absent')::text, true);
        insert into public.attendance_days (
          member_id, work_date, is_day_off, state, proposed_by_system, final_status)
        values (v_member.id, v_date, false, 'pending_review', true, 'absent')
        returning * into v_day;
        perform app.attendance_event(v_day.id, 'proposed_absent', null, 'absent', null, null);
        return query select v_date, v_member.id, v_day.id, 'proposed_absent'::text;
      elsif v_day.state = 'awaiting_choice' and not v_day.is_day_off then
        -- Opened (by a leave choice that was cancelled, say) and never chosen: "no submission".
        perform set_config('app.audit_override', jsonb_build_object('action', 'proposed_absent')::text, true);
        update public.attendance_days
        set state = 'pending_review', proposed_by_system = true, final_status = 'absent'
        where id = v_day.id
        returning * into v_day;
        perform app.attendance_event(v_day.id, 'proposed_absent', null, 'absent', null, null);
        return query select v_date, v_member.id, v_day.id, 'proposed_absent'::text;
      end if;
      -- pending_review, approved, corrected, or a row marked is_day_off: nothing to do.
    end loop;
  end loop;
end;
$$;

comment on function app.absent_check(date) is
  'The 23:59 IST job (WORKFLOWS §1/§8). For the last 7 IST dates up to job_day(now(), ''23:59''), '
  'or the one date given (INVALID_STATE before its cutoff): on a working day, every active member '
  'with attendance.self whose attendance has started gets a leave-derived day when approved leave '
  'covers the date and they never started, or a proposed absence (pending_review, absent, '
  'proposed_by_system) when they have no day or an awaiting_choice one. Nothing on a day off. '
  'Idempotent. Each member under their leave: lock. Returns one row per day written. Notifies the '
  'Owner once per run with everyone proposed (WORKFLOWS §9; the notification row is 5.1''s).';

-- attendance_flag_overtime_today: yesterday is the started, unended day (the one End day closes).
create or replace function public.attendance_flag_overtime_today(reason text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid;
  v_org uuid;
  v_today date := app.today_ist();
  v_day_id uuid;
begin
  select r.caller_id, r.org_id into v_caller, v_org from app.attendance_require_self() r;

  select d.id into v_day_id
  from public.attendance_days d
  where d.member_id = v_caller and d.work_date = v_today;
  if v_day_id is null then
    -- Worked past midnight: the note belongs on yesterday's still-open day.
    select d.id into v_day_id
    from public.attendance_days d
    where d.member_id = v_caller and d.work_date = v_today - 1
      and d.started_at is not null and d.ended_at is null;
  end if;
  if v_day_id is null then
    perform app.fail('INVALID_STATE', 'There is no attendance day to add a note to yet.');
  end if;

  perform public.attendance_flag_overtime(v_day_id, reason);
  return v_day_id;
end;
$$;

comment on function public.attendance_flag_overtime_today(text) is
  'attendance.self. attendance_flag_overtime() on the caller''s day for today, or on yesterday''s '
  'when there is none today and yesterday has a start and no end (the day attendance_end_day() '
  'will close; keep the two rules in step). INVALID_STATE when neither exists (the joining day). '
  'Returns the day id. Audit action: overtime_flagged (the inner call).';

-- attendance_own_today: the same read without first_login_at.
drop function public.attendance_own_today();
create function public.attendance_own_today()
returns table (
  work_date date, attendance_started boolean, is_working_day boolean, day_id uuid,
  state public.attendance_state, submitted_choice public.attendance_choice,
  final_status public.day_status, proposed_by_system boolean, decided_by_system boolean,
  decision_reason text, worked_on_leave boolean, leave_type public.leave_type, is_day_off boolean,
  started_at timestamptz, ended_at timestamptz, end_not_recorded boolean,
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
  v_late_allowed boolean;
begin
  select r.caller_id, r.org_id into v_caller, v_org from app.attendance_require_self() r;
  select m.joined_at into v_joined from public.members m where m.id = v_caller;
  v_late_allowed := app.end_day_late_allowed(now(), app.end_day_cutoff(v_org));

  return query
  select v_today,
         app.to_ist_date(v_joined) < v_today,
         -- null from is_working_day() means "unknown", which is not a day off.
         app.is_working_day(v_today) is not false,
         d.id, d.state, d.submitted_choice, d.final_status,
         coalesce(d.proposed_by_system, false),
         d.id is not null and d.decided_by is null,
         d.decision_reason, coalesce(d.worked_on_leave, false), l.type,
         coalesce(d.is_day_off, app.is_working_day(v_today) is false),
         d.started_at, d.ended_at, coalesce(d.end_not_recorded, false),
         coalesce(d.overtime_flag, false), d.overtime_reason,
         y.id, y.started_at,
         -- Approved leave covering today when nobody has opened the day yet: no prompt, and the
         -- strip says "On leave today" before any row exists (a Start day would derive the row).
         case when d.id is null then (app.leave_covering(v_caller, v_today)).type end
  from (select 1) as one
  left join public.attendance_days d on d.member_id = v_caller and d.work_date = v_today
  left join public.leave_requests l on l.id = d.leave_request_id
  -- 3b review: only before the cutoff, and attendance_end_day() refuses it once today started.
  left join public.attendance_days y
    on v_late_allowed
       and y.member_id = v_caller and y.work_date = v_today - 1
       and y.started_at is not null and y.ended_at is null;
end;
$$;

revoke all on function public.attendance_own_today() from public, anon;
grant execute on function public.attendance_own_today() to authenticated, service_role;

comment on function public.attendance_own_today() is
  'attendance.self (FORBIDDEN otherwise). Read only. The caller''s own day for today (IST) with '
  'attendance_started (today > the IST date of joined_at), is_working_day (app.is_working_day is '
  'not false), the day''s columns or nulls, the linked leave''s type, yesterday''s day when it has '
  'a start and no end and the IST time is before org_settings.end_day_cutoff_time (the one '
  'attendance_end_day() closes; 3b review), and covering_leave_type: approved leave covering today '
  'while no row exists yet (no prompt on a leave day). One read for the Start-day prompt and the '
  'attendance strip (3b.1).';

-- attendance_start_day: opens the day through the two-argument opener.
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
    -- (one the Owner decided): the start time is recorded and the day's standing is not touched.
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

comment on function public.attendance_start_day() is
  'attendance.self, the caller''s own day for today (IST). Opens the day when there is none. '
  'awaiting_choice -> pending_review as Present with started_at = now(); an untouched day derived '
  'from full leave or comp leave -> the same ("I''m working today", leave kept); a half-day leave '
  'day or a day already Present -> started_at only. INVALID_STATE on the joining day, on a day off '
  '("add an I worked today note"), when already started, or when today is a leave or a decided '
  'absence. The start time is the tap. Takes the leave: lock first. Audit action: started. '
  'Notifies nobody (WORKFLOWS §9: the Owner''s Today counts are the digest).';

-- attendance_choose_leave_today: the same, through the two-argument opener.
create or replace function public.attendance_choose_leave_today(choice public.attendance_choice, reason text default null)
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
    v_day := app.attendance_open_day(v_caller, v_today);
  end if;

  -- The 2.1 rules, request and audit, unchanged: the day is the single door for this request.
  return public.attendance_submit(choice, reason, v_today);
end;
$$;

-- attendance_today_detail: the Owner's board without the 2.x columns.
drop function public.attendance_today_detail();
create function public.attendance_today_detail()
returns table (
  member_id uuid, full_name text, job_title text, started boolean, day_id uuid,
  state public.attendance_state, final_status public.day_status, submitted_choice public.attendance_choice,
  proposed_by_system boolean, overtime_flag boolean, is_day_off boolean,
  on_leave boolean, leave_type public.leave_type,
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
         coalesce(d.proposed_by_system, false), coalesce(d.overtime_flag, false),
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
  'attendance.view_all (FORBIDDEN otherwise). Read only. One row per active member other than the '
  'Owner, for today (IST): (member_id, full_name, job_title, started: attendance has begun, i.e. '
  'today > the IST date of joined_at; day_id, state, final_status, submitted_choice, '
  'proposed_by_system, overtime_flag, is_day_off: the day row''s value, else app.is_working_day(today) '
  'is false; on_leave: approved leave covers today, leave_type; started_at, ended_at, '
  'end_not_recorded). The Owner''s Today card and people board derive their buckets from it.';

-- 4. The columns ------------------------------------------------------------------------------------
alter table public.attendance_days
  drop column first_login_at,
  drop column last_logout_at,
  drop column logout_not_recorded;

drop trigger protect_columns on public.attendance_days;
create trigger protect_columns before update on public.attendance_days
  for each row execute function app.protect_columns(
    'member_id', 'work_date', 'is_day_off', 'state', 'submitted_choice',
    'submitted_at', 'proposed_by_system', 'final_status', 'decided_by', 'decided_at',
    'decision_reason', 'overtime_flag', 'overtime_reason',
    'worked_on_leave', 'leave_request_id', 'started_at', 'ended_at', 'end_not_recorded');

-- 5. The logout event is closed, its history kept ------------------------------------------------
-- NOT VALID: rows written by the 2.x logout stay readable (never destroy history), and no new
-- row may carry the action (nothing writes it: app.attendance_logout() is gone).
alter table public.attendance_events drop constraint attendance_events_action_check;
alter table public.attendance_events add constraint attendance_events_action_check check (action in (
  'submitted', 'proposed_absent', 'derived_from_leave', 'approved', 'corrected',
  'overtime_flagged', 'started', 'ended')) not valid;

-- 6. Comp leave without a credit is refused on every route ------------------------------------------
create or replace function public.leave_submit(
  type public.leave_type, start_date date, end_date date, reason text default null)
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
begin
  select r.caller_id, r.org_id into v_caller, v_org from app.attendance_require_self() r;
  -- 3c.1: comp leave is a credit being used, so it goes through leave_submit_comp() only.
  if type = 'comp_leave' then
    perform app.fail('VALIDATION', 'Comp leave comes from a credit. Choose "Comp leave" in the leave form when you have one.');
  end if;
  perform app.leave_validate(type, start_date, end_date, app.today_ist());
  -- One member's leave writes run one at a time, so two tabs cannot both pass the overlap check.
  perform pg_advisory_xact_lock(hashtext('leave:' || v_caller::text));
  if app.leave_overlaps(v_caller, start_date, end_date, null) then
    perform app.fail('CONFLICT', 'You already have a request for these dates. Request a change to it instead.');
  end if;

  perform set_config('app.audit_override', jsonb_build_object(
    'action', 'submitted', 'meta', jsonb_build_object('source', 'form'))::text, true);
  insert into public.leave_requests (member_id, type, start_date, end_date, reason, state, source)
  values (v_caller, type, start_date, end_date, v_reason, 'submitted', 'form')
  returning id into v_id;
  return v_id;
end;
$$;

comment on function public.leave_submit(public.leave_type, date, date, text) is
  'attendance.self. A leave request from today on (half day: one date), reason optional. Never '
  'comp_leave (VALIDATION, 3c.1: a comp leave request reserves a credit through '
  'leave_submit_comp()). CONFLICT when it overlaps the caller''s own submitted or approved request; '
  'closed requests never block. Audit action: submitted. Notifies the Owner (5.1).';

create or replace function public.attendance_submit(
  choice public.attendance_choice, reason text default null, for_date date default null)
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
    insert into public.leave_requests (member_id, type, start_date, end_date, reason, state, source)
    values (v_caller, choice::text::public.leave_type, v_day.work_date, v_day.work_date, v_reason, 'submitted', 'attendance')
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

comment on function public.attendance_submit(public.attendance_choice, text, date) is
  'attendance.self. Today''s own day: awaiting_choice -> pending_review, or approved + '
  'proposed_by_system -> pending_review for present only ("I''m working today"). A leave choice '
  'creates leave_requests(source = attendance) for today and links it; comp_leave is VALIDATION '
  '(3c.1: a credit is used only through leave_submit_comp()). Reason optional. for_date: a screen '
  'shown for another IST date is INVALID_STATE ("The day changed"). Takes the member''s leave: '
  'advisory lock before any row lock. Audit action: submitted. Notifies nobody (WORKFLOWS §9: the '
  'Owner''s Today counts are the digest).';

create or replace function public.leave_request_change(
  request_id uuid, type public.leave_type default null, start_date date default null,
  end_date date default null, reason text default null, cancel boolean default false)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid;
  v_org uuid;
  v_reason text := app.clean_reason(reason);
  v_req public.leave_requests;
  v_type public.leave_type;
  v_start date;
  v_end date;
  v_id uuid;
begin
  select r.caller_id, r.org_id into v_caller, v_org from app.attendance_require_self() r;

  perform pg_advisory_xact_lock(hashtext('leave:' || v_caller::text));
  select r.* into v_req from public.leave_requests r where r.id = request_id and r.member_id = v_caller for update;
  if v_req.id is null then
    perform app.fail('NOT_FOUND', 'This leave request is not yours.');
  end if;
  if v_req.state <> 'approved' then
    perform app.fail('INVALID_STATE', 'Only approved leave can be changed or cancelled.');
  end if;
  if v_req.end_date < app.today_ist() then
    perform app.fail('INVALID_STATE', 'This leave has ended. Ask the Owner to correct it.');
  end if;
  if exists (select 1 from public.leave_requests r where r.supersedes_id = v_req.id and r.state = 'submitted') then
    perform app.fail('CONFLICT', 'A change to this leave is already waiting for the Owner.');
  end if;
  -- 3b.2: a comp leave request is tied to the credits it drew for that date; it is cancelled
  -- (the credit comes back) and requested again, never moved.
  if not coalesce(cancel, false) and v_req.credit_days is not null then
    perform app.fail('INVALID_STATE', 'Comp leave can''t be changed. Ask to cancel it and request it again for the new date.');
  end if;
  -- 3c.1: a change never turns leave into comp leave: that would spend no credit.
  if not coalesce(cancel, false) and type = 'comp_leave' then
    perform app.fail('VALIDATION', 'A change can''t make this comp leave. Cancel it and request comp leave from your credit.');
  end if;

  if coalesce(cancel, false) then
    v_type := v_req.type; v_start := v_req.start_date; v_end := v_req.end_date;
  else
    v_type := type; v_start := start_date; v_end := end_date;
    perform app.leave_validate(v_type, v_start, v_end, null);
    if v_start < app.today_ist() and v_start <> v_req.start_date then
      perform app.fail('VALIDATION', 'Leave cannot start in the past.');
    end if;
    if v_end < app.today_ist() then
      perform app.fail('VALIDATION', 'The changed leave must end today or later.');
    end if;
    if app.leave_overlaps(v_caller, v_start, v_end, v_req.id) then
      perform app.fail('CONFLICT', 'You already have another request for these dates.');
    end if;
  end if;

  perform set_config('app.audit_override', jsonb_build_object(
    'action', case when coalesce(cancel, false) then 'cancellation_requested' else 'change_requested' end,
    'meta', jsonb_build_object('supersedes_id', v_req.id))::text, true);
  insert into public.leave_requests (
    member_id, type, start_date, end_date, reason, state, source, supersedes_id, requests_cancellation)
  values (v_caller, v_type, v_start, v_end, v_reason, 'submitted', 'form', v_req.id, coalesce(cancel, false))
  returning id into v_id;
  return v_id;
end;
$$;

comment on function public.leave_request_change(uuid, public.leave_type, date, date, text, boolean) is
  'attendance.self, own approved request that has not ended (end_date >= today IST; INVALID_STATE '
  'otherwise: past leave is the Owner''s, through the attendance day) -> a new submitted row with '
  'supersedes_id (cancel = true copies the dates and sets requests_cancellation). One open change '
  'per request. 3b.2: a comp leave request (credit_days set) cannot be changed, only cancelled. '
  '3c.1: a change to type comp_leave is VALIDATION (no credit would be spent). The original stays '
  'approved until the Owner decides. Audit action: change_requested | cancellation_requested. '
  'Notifies the Owner (5.1).';
