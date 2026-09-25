-- 2.5 Jobs (WORKFLOWS §1 "Settled in 2.5", §8; DATA-MODEL §3 "Jobs"; ADR-0008).
--
-- 1. app.job_day(): the IST date a nightly job is about, derived from the instant it runs, so a
--    run pg_cron starts late still processes the day that ended, and an early run repeats
--    yesterday (which writes nothing).
-- 2. app.attendance_open_day(): today's derivation factored out of attendance_touch (2.1 note),
--    shared with the absent check. attendance_touch is re-created on top of it, same behaviour.
-- 3. app.absent_check(): leave-derived days for anyone who never logged in, proposed absences on
--    working days, the last 7 IST dates per run (catch-up, owner decision 2026-09-25).
-- 4. app.logout_not_recorded(): flags days with a login and no logout; a logout after midnight
--    clears it (app.attendance_logout re-created, owner decision 2026-09-25).
-- 5. pg_cron: absent_check at 18:29 UTC (23:59 IST), logout_not_recorded at 18:30 UTC (00:00 IST).
--
-- Both jobs take each member's leave: advisory lock BEFORE that member's rows, members in id
-- order (DATA-MODEL §3 "Lock order"; pgTAP 14). Every write is labelled through
-- app.audit_override with actor null (the audit trigger reads auth.uid(), which pg_cron has not).
-- No notification rows yet: the WORKFLOWS §9 recipient is named in each comment for 5.1.

-- job_day ---------------------------------------------------------------------------------------
create function app.job_day(p_at timestamptz, p_cutoff time)
returns date
language sql
stable
strict
parallel safe
set search_path = ''
as $$
  select (p_at at time zone 'Asia/Kolkata')::date
         - case when (p_at at time zone 'Asia/Kolkata')::time >= p_cutoff then 0 else 1 end;
$$;

revoke all on function app.job_day(timestamptz, time) from public;
grant execute on function app.job_day(timestamptz, time) to authenticated, service_role;

comment on function app.job_day(timestamptz, time) is
  'The most recent IST date whose cutoff time has passed at the given instant: 23:59 IST on D is '
  'D, 00:00 IST on D+1 is still D, 23:58 IST on D is D-1. The attendance jobs default to '
  'job_day(now(), ''23:59'') (WORKFLOWS §8).';

-- attendance_open_day ---------------------------------------------------------------------------
-- The caller holds the member's leave: lock (attendance_touch: touch: -> leave: -> rows; the
-- absent check: leave: -> rows). Body: the 2.4 attendance_touch branch, with the date and the
-- login time as parameters.
create function app.attendance_open_day(p_member_id uuid, p_date date, p_first_login timestamptz)
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
      member_id, work_date, first_login_at, is_day_off, state, proposed_by_system, final_status,
      decided_at, leave_request_id)
    values (
      p_member_id, p_date, p_first_login, v_day_off, 'approved', true,
      v_leave.type::text::public.day_status, now(), v_leave.id)
    on conflict on constraint attendance_days_member_date_key do nothing
    returning * into v_day;
  else
    perform set_config('app.audit_override', jsonb_build_object('action', 'opened')::text, true);
    insert into public.attendance_days (member_id, work_date, first_login_at, is_day_off)
    values (p_member_id, p_date, p_first_login, v_day_off)
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

revoke all on function app.attendance_open_day(uuid, date, timestamptz) from public, authenticated;
grant execute on function app.attendance_open_day(uuid, date, timestamptz) to service_role;

comment on function app.attendance_open_day(uuid, date, timestamptz) is
  'The member''s day for that date, opened when there is none: approved leave covering it gives '
  'an approved derived day (event and audit derived_from_leave), otherwise awaiting_choice (audit '
  'opened). first_login is null for a job. The caller holds the member''s leave: lock. Used by '
  'attendance_touch and app.absent_check (2.5).';

-- attendance_touch on top of it (2.5). Same behaviour as 2.4: a day another writer opened before
-- this person ever logged in (the absent check) gets first_login_at now.
create or replace function public.attendance_touch(user_agent text default null, ip_hash text default null)
returns table (
  day_id uuid, work_date date, state public.attendance_state, gate_required boolean,
  is_day_off boolean, final_status public.day_status, proposed_by_system boolean, leave_request_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_member public.members;
  v_today date := app.today_ist();
  v_day public.attendance_days;
begin
  select m.* into v_member from app.current_member() m;
  if v_member.id is null then
    perform app.fail('UNAUTHENTICATED', 'Your account is not active.');
  end if;

  -- 2.2: one touch at a time per member (a phone and a laptop at 9 AM). The second waits for the
  -- first to commit, then finds its login row and its day. Nothing else takes this lock.
  perform pg_advisory_xact_lock(hashtext('touch:' || v_member.id::text));

  -- A session kept across midnight has no login today: record one so "logged in today" holds
  -- for the 20:30 reminder and the 23:59 jobs (WORKFLOWS §1).
  if not exists (
    select 1 from public.session_events e
    where e.member_id = v_member.id and e.kind = 'login'
      and e.at >= app.ist_day_start(v_today) and e.at < app.ist_day_start(v_today + 1)
  ) then
    insert into public.session_events (member_id, kind, user_agent, ip_hash)
    values (v_member.id, 'login', nullif(left(user_agent, 512), ''), nullif(left(ip_hash, 128), ''));
  end if;

  -- Whoever lacks attendance.self (the Owner, PERMISSIONS §1) is exempt from the gate: no day row.
  -- 2.2: so is the joining day; attendance starts the IST day after joined_at.
  if not app.has_permission('attendance.self') or app.to_ist_date(v_member.joined_at) >= v_today then
    return query select null::uuid, v_today, null::public.attendance_state, false, false,
                        null::public.day_status, false, null::uuid;
    return;
  end if;

  select d.* into v_day
  from public.attendance_days d
  where d.member_id = v_member.id and d.work_date = v_today
  for update;

  if v_day.id is null then
    -- 2.4: a day derived from leave must not race the Owner's leave decisions (an approval or a
    -- cancellation covering today). Take the member's leave: lock (touch: -> leave: -> rows, the
    -- same order everywhere); open_day looks again under it, so the Owner's transaction has
    -- committed by then.
    perform pg_advisory_xact_lock(hashtext('leave:' || v_member.id::text));
    v_day := app.attendance_open_day(v_member.id, v_today, now());
  end if;

  if v_day.first_login_at is null then
    -- The 23:59 job (2.5) opened the day before this person ever logged in.
    perform set_config('app.audit_override', jsonb_build_object('action', 'first_login')::text, true);
    update public.attendance_days set first_login_at = now() where id = v_day.id returning * into v_day;
  end if;

  return query select v_day.id, v_day.work_date, v_day.state, v_day.state = 'awaiting_choice',
                      v_day.is_day_off, v_day.final_status, v_day.proposed_by_system, v_day.leave_request_id;
end;
$$;

comment on function public.attendance_touch(text, text) is
  'Every active member, on the first request of the day (ARCHITECTURE §8). Serialised per member '
  '(2.2). Records a login event when there is none today, opens today''s attendance day for an '
  'Admin or Staff member through app.attendance_open_day (derived from approved leave when there '
  'is one, otherwise awaiting_choice) and answers whether the gate must ask. Idempotent. The '
  'Owner, and anyone on their joining day (IST date of joined_at), gets gate_required = false and '
  'no day. 2.4: opening a day takes the leave: lock first (touch: -> leave: -> rows). Audit '
  'action: opened | derived_from_leave | first_login. Notifies nobody.';

-- absent_check ----------------------------------------------------------------------------------
create function app.absent_check(for_date date default null)
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

    -- Everyone the gate applies to (attendance.self by role, PERMISSIONS §1) whose attendance
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
          -- Approved leave comes first: the day they never logged in for is a leave day.
          v_day := app.attendance_open_day(v_member.id, v_date, null);
          return query select v_date, v_member.id, v_day.id, 'derived_from_leave'::text;
          continue;
        end if;
        perform set_config('app.audit_override', jsonb_build_object('action', 'proposed_absent')::text, true);
        insert into public.attendance_days (
          member_id, work_date, first_login_at, is_day_off, state, proposed_by_system, final_status)
        values (v_member.id, v_date, null, false, 'pending_review', true, 'absent')
        returning * into v_day;
        perform app.attendance_event(v_day.id, 'proposed_absent', null, 'absent', null, null);
        return query select v_date, v_member.id, v_day.id, 'proposed_absent'::text;
      elsif v_day.state = 'awaiting_choice' and not v_day.is_day_off then
        -- Logged in, never chose: "no submission" (WORKFLOWS §1). first_login_at stays.
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

revoke all on function app.absent_check(date) from public, authenticated;
grant execute on function app.absent_check(date) to service_role;

comment on function app.absent_check(date) is
  'The 23:59 IST job (WORKFLOWS §1/§8). For the last 7 IST dates up to job_day(now(), ''23:59''), '
  'or the one date given (INVALID_STATE before its cutoff): on a working day, every active member '
  'with attendance.self whose attendance has started gets a leave-derived day when approved leave '
  'covers the date and they never logged in, or a proposed absence (pending_review, absent, '
  'proposed_by_system) when they have no day or an awaiting_choice one. Nothing on a day off. '
  'Idempotent. Each member under their leave: lock. Returns one row per day written. Notifies '
  'the Owner once per run with everyone proposed (WORKFLOWS §9; the notification row is 5.1''s).';

-- logout_not_recorded ---------------------------------------------------------------------------
create function app.logout_not_recorded(for_date date default null)
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
        and d.first_login_at is not null and d.last_logout_at is null and not d.logout_not_recorded
      order by d.member_id
    loop
      perform pg_advisory_xact_lock(hashtext('leave:' || v_row.member_id::text));
      -- Under the lock, look again: a logout may have landed in between.
      select d.* into v_day from public.attendance_days d where d.id = v_row.id for update;
      if v_day.last_logout_at is not null or v_day.logout_not_recorded then
        continue;
      end if;
      perform set_config('app.audit_override', jsonb_build_object('action', 'logout_not_recorded')::text, true);
      update public.attendance_days set logout_not_recorded = true where id = v_day.id;
      return query select v_date, v_day.member_id, v_day.id;
    end loop;
  end loop;
end;
$$;

revoke all on function app.logout_not_recorded(date) from public, authenticated;
grant execute on function app.logout_not_recorded(date) to service_role;

comment on function app.logout_not_recorded(date) is
  'The 00:00 IST job (WORKFLOWS §1/§8), the same dates as absent_check: every day with a login '
  'and no logout gets logout_not_recorded = true (audit logout_not_recorded, no event). No time is '
  'made up. Idempotent. Each member under their leave: lock. Notifies nobody.';

-- attendance_logout: a logout after midnight clears the flag (owner decision 2026-09-25). The
-- audit diff carries the cleared column only when it was set, so a normal logout still holds
-- last_logout_at alone (pgTAP 07).
create or replace function app.attendance_logout(p_member_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_today date := app.today_ist();
  v_day public.attendance_days;
begin
  select d.* into v_day
  from public.attendance_days d
  where d.member_id = p_member_id and d.work_date = v_today
  for update;
  if v_day.id is null then
    -- Worked past midnight: the logout belongs to yesterday's day, a real time, never made up.
    select d.* into v_day
    from public.attendance_days d
    where d.member_id = p_member_id and d.work_date = v_today - 1
      and d.first_login_at is not null and d.last_logout_at is null
    for update;
  end if;
  if v_day.id is null then
    return null;
  end if;

  -- Only the logout columns move: a late logout is information, never a re-opening. A logout is
  -- recorded now, so the 00:00 job's flag (2.5) no longer holds.
  perform set_config('app.audit_override', jsonb_build_object('action', 'logout')::text, true);
  update public.attendance_days set last_logout_at = now(), logout_not_recorded = false where id = v_day.id;
  perform app.attendance_event(v_day.id, 'logout', null, null, null, p_member_id);
  return v_day.id;
end;
$$;

comment on function app.attendance_logout(uuid) is
  'Called by session_logout(). Sets last_logout_at on today''s day, or on yesterday''s when there is '
  'none today and yesterday has a login and no logout, and clears logout_not_recorded when the '
  '00:00 job had set it (2.5). Writes nothing else. Returns the day id or null (the Owner, or no '
  'day). Audit action: logout.';

-- pg_cron ---------------------------------------------------------------------------------------
-- UTC schedules (ARCHITECTURE §7): 18:29 = 23:59 IST, 18:30 = 00:00 IST. The three-argument form
-- updates a job of the same name, so re-applying never adds a second one. Jobs run as the role
-- that scheduled them (postgres, the migration's role).
select cron.schedule('absent_check', '29 18 * * *', $$select app.absent_check()$$);
select cron.schedule('logout_not_recorded', '30 18 * * *', $$select app.logout_not_recorded()$$);
