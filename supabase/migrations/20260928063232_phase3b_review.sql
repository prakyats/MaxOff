-- /review-phase 3b (owner decisions 2026-09-28, PROGRESS "Phase 3b review decisions"):
-- 1. A late End day has a cutoff: yesterday's open day can be ended after midnight only until
--    org_settings.end_day_cutoff_time (default 05:00 IST) and never once today's Start day exists.
--    After it, yesterday stays "End of day not recorded"; late work goes in an overtime note.
--    attendance_own_today() stops offering yesterday's end past the cutoff.
-- 2. Comp leave is never on a day off: leave_submit_comp() refuses a weekly off or a holiday, and
--    comp_leave_dates() lists the working dates the leave form offers (with the free days on each).
-- 3. A holiday added (or moved) onto a date with a waiting or approved comp leave request cancels
--    that request with a reason the member reads, and the credit goes back (audited).
-- 4. comp_leave_grant() is idempotent: a client request key (one per opened dialog) returns the
--    first grant's credit instead of creating a second one on a double tap.
--
-- EXPAND-ONLY (ARCHITECTURE §18): one defaulted column on org_settings, one nullable column on
-- comp_leave_credits, new functions and a trigger, same-signature re-creations of 3b's functions.
-- comp_leave_grant() is 3b's (never main's), so it is dropped and re-created with the key.
-- Append-only: never edit once applied.

-- org_settings.end_day_cutoff_time ---------------------------------------------------------------
alter table public.org_settings
  add column end_day_cutoff_time time not null default '05:00';

comment on column public.org_settings.end_day_cutoff_time is
  'IST time of day until which yesterday''s open day can still be ended (3b review, default 05:00). '
  'Never once today''s Start day exists. After it, yesterday stays end_not_recorded.';

grant update (end_day_cutoff_time) on public.org_settings to authenticated;

create function app.end_day_late_allowed(at_time timestamptz, cutoff time)
returns boolean
language sql
stable
parallel safe
set search_path = ''
as $$
  select (at_time at time zone 'Asia/Kolkata')::time < cutoff;
$$;

revoke all on function app.end_day_late_allowed(timestamptz, time) from public;
grant execute on function app.end_day_late_allowed(timestamptz, time) to authenticated, service_role;

comment on function app.end_day_late_allowed(timestamptz, time) is
  'True while the IST time of day of at_time is before cutoff: yesterday''s open day can still be '
  'ended (3b review). Stable, not immutable: it depends on the timezone database.';

create function app.end_day_cutoff(p_org uuid)
returns time
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select s.end_day_cutoff_time from public.org_settings s where s.org_id = p_org), time '05:00');
$$;

revoke all on function app.end_day_cutoff(uuid) from public, authenticated;
grant execute on function app.end_day_cutoff(uuid) to service_role;

comment on function app.end_day_cutoff(uuid) is
  'Internal (3b review). The organization''s end_day_cutoff_time, 05:00 when unset.';

-- attendance_own_today: yesterday's end only before the cutoff -------------------------------------
create or replace function public.attendance_own_today()
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
  v_late_allowed boolean;
begin
  select r.caller_id, r.org_id into v_caller, v_org from app.attendance_require_self() r;
  select m.joined_at into v_joined from public.members m where m.id = v_caller;
  v_late_allowed := app.end_day_late_allowed(now(), app.end_day_cutoff(v_org));

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
  -- 3b review: only before the cutoff, and attendance_end_day() refuses it once today started.
  left join public.attendance_days y
    on v_late_allowed
       and y.member_id = v_caller and y.work_date = v_today - 1
       and y.started_at is not null and y.ended_at is null;
end;
$$;

comment on function public.attendance_own_today() is
  'attendance.self (FORBIDDEN otherwise). Read only. The caller''s own day for today (IST) with '
  'attendance_started (today > the IST date of joined_at), is_working_day (app.is_working_day is '
  'not false), the day''s columns or nulls, the linked leave''s type, yesterday''s day when it has '
  'a start and no end and the IST time is before org_settings.end_day_cutoff_time (the one '
  'attendance_end_day() closes; 3b review), and covering_leave_type: approved leave covering today '
  'while no row exists yet (no prompt on a leave day). One read for the Start-day prompt and the '
  'attendance strip (3b.1).';

-- attendance_end_day: the cutoff for yesterday ---------------------------------------------------
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
          to_char(v_cutoff, 'HH24:MI')));
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
  'end, only before org_settings.end_day_cutoff_time IST (default 05:00) and never once today has '
  'started (3b review; INVALID_STATE past the cutoff). ended_at = now() and end_not_recorded = '
  'false in one write; final, no resume. INVALID_STATE with no started day ("Start your day '
  'first") or once today has ended. 3b.2: a non-empty overtime_note becomes an '
  'extra_work_note_submit(overtime) for that day in the same transaction. Returns (day_id, '
  'work_date, note_id). Audit action: ended. Notifies nobody.';

-- leave_submit_comp: never on a day off ----------------------------------------------------------
create or replace function public.leave_submit_comp(start_date date, half_day boolean default false, reason text default null)
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
begin
  select r.caller_id, r.org_id into v_caller, v_org from app.attendance_require_self() r;
  perform app.leave_validate(v_type, start_date, start_date, app.today_ist());
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
  insert into public.leave_requests (member_id, type, start_date, end_date, reason, state, source, credit_days)
  values (v_caller, v_type, start_date, start_date, v_reason, 'submitted', 'form', v_needed)
  returning id into v_id;

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

  return v_id;
end;
$$;

comment on function public.leave_submit_comp(date, boolean, text) is
  'attendance.self. A comp leave request for one working date, today or later: a full day (type '
  'comp_leave, credit_days 1.0) or a half day (type half_day, credit_days 0.5), reason optional, '
  'VALIDATION on a weekly day off or a holiday (3b review), CONFLICT on overlap. Draws the '
  'caller''s free credits valid on that date oldest first and reserves them; VALIDATION when they '
  'do not cover it. Still a leave request the Owner approves or rejects (decision 16). Audit '
  'action: submitted (+ reserved on the credits). Notifies the Owner (5.1).';

-- comp_leave_dates: what the leave form's date list offers --------------------------------------
create function public.comp_leave_dates()
returns table (work_date date, available_days numeric)
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
  v_last date;
begin
  select r.caller_id, r.org_id into v_caller, v_org from app.attendance_require_self() r;
  select max(c.expires_on) into v_last
  from public.comp_leave_credits c
  where c.member_id = v_caller and c.revoked_at is null and c.expires_on >= v_today
    and c.days - c.used_days - c.reserved_days > 0;
  if v_last is null then
    return;
  end if;

  return query
  select g.d::date,
         (select coalesce(sum(c.days - c.used_days - c.reserved_days), 0)
          from public.comp_leave_credits c
          where c.member_id = v_caller and c.revoked_at is null and c.expires_on >= g.d::date)
  from generate_series(v_today::timestamp, v_last::timestamp, interval '1 day') as g(d)
  where app.is_working_day(g.d::date) is not false
  order by 1;
end;
$$;

revoke all on function public.comp_leave_dates() from public, anon;
grant execute on function public.comp_leave_dates() to authenticated, service_role;

comment on function public.comp_leave_dates() is
  'attendance.self. Read only (3b review). The dates the leave form offers for comp leave: every '
  'working day (no weekly day off, no holiday) from today (IST) to the latest use-by date of the '
  'caller''s free credits, each with the free days valid on it. Empty with no free credit. The '
  'form offers a full day where available_days >= 1 and a half day where >= 0.5; '
  'leave_submit_comp() stays the rule.';

-- A holiday on a comp leave date gives the credit back -------------------------------------------
create function app.holiday_release_comp()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_member uuid;
  v_req public.leave_requests;
  v_by uuid := (select m.id from app.current_member() m);
  v_reason text := format('%s became a holiday (%s): this comp leave was cancelled and the credit went back.',
                          to_char(new.date, 'FMDD Mon'), new.name);
begin
  if tg_op = 'UPDATE' and new.date = old.date then
    return null;
  end if;

  for v_member in
    select distinct r.member_id
    from public.leave_requests r
    join public.members m on m.id = r.member_id and m.org_id = new.org_id
    where r.credit_days is not null and r.state in ('submitted', 'approved')
      and new.date between r.start_date and r.end_date
    order by r.member_id
  loop
    -- The member's leave: lock before any row lock (2.4).
    perform pg_advisory_xact_lock(hashtext('leave:' || v_member::text));
    for v_req in
      select r.* from public.leave_requests r
      where r.member_id = v_member and r.credit_days is not null and r.state in ('submitted', 'approved')
        and new.date between r.start_date and r.end_date
      order by r.start_date, r.id
      for update
    loop
      perform set_config('app.audit_override', jsonb_build_object(
        'action', 'cancelled',
        'meta', jsonb_build_object('holiday', true, 'holiday_date', new.date, 'reason', v_reason))::text, true);
      update public.leave_requests
      set state = 'cancelled', decided_by = v_by, decided_at = now(), decision_reason = v_reason
      where id = v_req.id;
      if v_req.state = 'approved' then
        perform app.attendance_release_leave(v_req, null, null);
      end if;
      perform app.comp_credit_settle(v_req.id, 'released');
    end loop;
  end loop;
  return null;
end;
$$;

revoke all on function app.holiday_release_comp() from public, authenticated;
grant execute on function app.holiday_release_comp() to service_role;

comment on function app.holiday_release_comp() is
  'AFTER INSERT / UPDATE OF date on holidays (3b review): a waiting or approved comp leave request '
  'covering the new holiday is cancelled with a reason the member reads, today''s untouched derived '
  'day goes back to awaiting_choice, and the credit is released (app.comp_credit_settle). Audit: '
  'cancelled on the request, released on the credit and its use. Notifies the member (5.1).';

create trigger holiday_release_comp
  after insert or update of date on public.holidays
  for each row execute function app.holiday_release_comp();

-- comp_leave_grant: idempotent with a request key ------------------------------------------------
alter table public.comp_leave_credits add column request_key uuid null;

comment on column public.comp_leave_credits.request_key is
  'The client''s key for a standalone grant (one per opened dialog, 3b review): a repeat with the '
  'same key returns the first credit. Null for grants from a note and for callers that send none.';

create unique index comp_leave_credits_request_key_idx
  on public.comp_leave_credits (member_id, request_key) where request_key is not null;

drop trigger protect_columns on public.comp_leave_credits;
create trigger protect_columns before update on public.comp_leave_credits
  for each row execute function app.protect_columns(
    'member_id', 'days', 'used_days', 'reserved_days', 'granted_by', 'granted_at', 'granted_on',
    'expires_on', 'note', 'note_id', 'revoked_at', 'revoked_by', 'revoke_reason', 'request_key');

drop function public.comp_leave_grant(uuid, numeric, text);
create function public.comp_leave_grant(member_id uuid, days numeric, note text default null, request_key uuid default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid;
  v_org uuid;
  v_note text := app.clean_reason(note);
  v_today date := app.today_ist();
  v_id uuid;
  v_prior public.comp_leave_credits;
begin
  select r.caller_id, r.org_id into v_caller, v_org from app.attendance_require_decider() r;
  if days is null or days not in (0.5, 1.0) then
    perform app.fail('VALIDATION', 'Grant half a day or one day.');
  end if;
  if not exists (
    select 1 from public.members m
    where m.id = comp_leave_grant.member_id and m.org_id = v_org and m.status = 'active'
      and exists (select 1 from public.role_permissions rp where rp.role = m.role and rp.permission = 'attendance.self')) then
    perform app.fail('NOT_FOUND', 'Comp leave is granted to an active Admin or Staff member.');
  end if;
  perform pg_advisory_xact_lock(hashtext('leave:' || comp_leave_grant.member_id::text));

  -- A double tap (or a retried request) with the same key is the same grant.
  if request_key is not null then
    select c.* into v_prior from public.comp_leave_credits c
    where c.member_id = comp_leave_grant.member_id and c.request_key = comp_leave_grant.request_key;
    if v_prior.id is not null then
      if v_prior.days <> days then
        perform app.fail('CONFLICT', 'This grant was already made with a different amount. Reload and check.');
      end if;
      return v_prior.id;
    end if;
  end if;

  perform set_config('app.audit_override', jsonb_build_object(
    'action', 'granted', 'meta', jsonb_build_object('days', days, 'standalone', true))::text, true);
  insert into public.comp_leave_credits (member_id, days, granted_by, granted_on, expires_on, note, request_key)
  values (comp_leave_grant.member_id, days, v_caller, v_today, app.ist_month_end(v_today), v_note, request_key)
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.comp_leave_grant(uuid, numeric, text, uuid) from public, anon;
grant execute on function public.comp_leave_grant(uuid, numeric, text, uuid) to authenticated, service_role;

comment on function public.comp_leave_grant(uuid, numeric, text, uuid) is
  'attendance.decide. A standalone comp leave grant (PRODUCT §4.3a, decision 14): half a day or one '
  'day to an active member who marks attendance, expiring at the end of this IST month, with an '
  'optional note the member sees. Idempotent on request_key (3b review): the same key returns the '
  'first credit (CONFLICT when the amount differs). Audit action: granted. Notifies the member (5.1).';
