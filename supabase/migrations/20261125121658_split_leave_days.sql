-- v2.0.1 "Flexible comp leave" (owner 23 and 25 Nov 2026; #89 7105109291, plan 7162082104).
-- "Make the requirements as flexible as possible so people can make use of their comp leave, half
-- day or full day. If it's a half-day comp leave, the other half can be their normal leave."
--
--   * Two half days on one date when their halves differ (morning / afternoon), in any mix of comp
--     and ordinary leave. A full day, the same half, or an older half day with no half (null)
--     still conflicts.
--   * One request for a split day: leave_submit_split() makes the two halves at once (pair_id),
--     and the Owner decides them together.
--   * The day: when both halves of a date are approved, the attendance day is `leave` (or
--     `comp_leave` when both halves are comp) and links both requests (leave_request_id,
--     second_leave_request_id). No new status: every reader of the day keeps working, and
--     month_summary counts comp from the linked requests' credit.
--   * app.leave_covering() gives a fully-off split day as one whole-day leave (no half), so the
--     working-hours rules, the Start-day prompt and the reminders treat it as a day off.
--   * Cancelling either half (member, Owner, holiday) brings a today-or-later untouched day back
--     to the half that stands; the cancelled comp half's credit goes back as before.
--   * Fixed on the way: a change request and the Owner's edit kept no `half`, and the Owner's edit
--     turned a ½ comp day into ordinary leave (its credit released).
--
-- Expand-only: two nullable columns, one check, two indexes, new helpers, functions re-created
-- (same names; three gain trailing defaulted arguments, so their old signatures are dropped first
-- and a call without the new arguments resolves to the new function). Nothing is deleted or
-- rewritten. Append-only: never edit once applied.

-- 1. Columns -----------------------------------------------------------------------------------
alter table public.leave_requests add column pair_id uuid null;
comment on column public.leave_requests.pair_id is
  'v2.0.1: the two halves of one "Full day: ½ comp + ½ leave" request share it (leave_submit_split, '
  'or the Owner''s split-day correction). Each half is a half_day row with its own half; the Owner '
  'decides a waiting pair together, and once approved each half stands on its own. Null otherwise.';
alter table public.leave_requests add constraint leave_requests_pair_half
  check (pair_id is null or (type = 'half_day' and half is not null));
create index leave_requests_pair_idx on public.leave_requests (pair_id) where pair_id is not null;

alter table public.attendance_days add column second_leave_request_id uuid null
  references public.leave_requests (id);
comment on column public.attendance_days.second_leave_request_id is
  'v2.0.1: on a day where both halves are off through two half-day requests (morning and '
  'afternoon), the afternoon''s request; leave_request_id is then the morning''s. Null otherwise.';
alter table public.attendance_days add constraint attendance_days_second_leave
  check (second_leave_request_id is null
         or (leave_request_id is not null and second_leave_request_id <> leave_request_id));
create index attendance_days_second_leave_request_idx on public.attendance_days (second_leave_request_id)
  where second_leave_request_id is not null;

drop trigger protect_columns on public.leave_requests;
create trigger protect_columns before update on public.leave_requests
  for each row execute function app.protect_columns(
    'member_id', 'type', 'start_date', 'end_date', 'reason', 'state', 'source', 'supersedes_id',
    'requests_cancellation', 'decided_by', 'decided_at', 'decision_reason', 'credit_days',
    'half', 'pair_id');

drop trigger protect_columns on public.attendance_days;
create trigger protect_columns before update on public.attendance_days
  for each row execute function app.protect_columns(
    'member_id', 'work_date', 'is_day_off', 'state', 'submitted_choice',
    'submitted_at', 'proposed_by_system', 'final_status', 'decided_by', 'decided_at',
    'decision_reason', 'overtime_flag', 'overtime_reason',
    'worked_on_leave', 'leave_request_id', 'started_at', 'ended_at', 'end_not_recorded',
    'second_leave_request_id');

-- 2. Conflicts are per half ----------------------------------------------------------------------
-- The first request of that member overlapping the range that the new one can't sit beside:
-- approved only, or waiting as well. Two half days of one date sit side by side when both name
-- a half and the halves differ; a full day, the same half, or a half day with no half (null, the
-- older rows) conflicts as before. Replaces app.leave_overlaps / app.leave_clash in every writer.
create function app.leave_conflict(
  p_member_id uuid, p_start date, p_end date, p_type public.leave_type, p_half text,
  p_exclude uuid, p_approved_only boolean)
returns public.leave_requests
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_row public.leave_requests;
begin
  for v_row in
    select r.*
    from public.leave_requests r
    where r.member_id = p_member_id
      and (r.state = 'approved' or (not p_approved_only and r.state = 'submitted'))
      and r.id is distinct from p_exclude
      and r.start_date <= p_end and r.end_date >= p_start
      and not (p_type = 'half_day' and p_half is not null
               and r.type = 'half_day' and r.half is not null and r.half <> p_half)
    order by r.start_date, r.created_at
    limit 1
  loop
    return v_row;
  end loop;
  return null;
end;
$$;
revoke all on function app.leave_conflict(uuid, date, date, public.leave_type, text, uuid, boolean)
  from public, anon, authenticated;
grant execute on function app.leave_conflict(uuid, date, date, public.leave_type, text, uuid, boolean)
  to service_role;
comment on function app.leave_conflict(uuid, date, date, public.leave_type, text, uuid, boolean) is
  'v2.0.1, service_role only: the first approved (or, unless p_approved_only, waiting) request of '
  'the member overlapping [p_start, p_end] that a new request of p_type / p_half can''t sit beside, '
  'other than p_exclude; null when none. Two half days with different non-null halves never conflict.';

-- What the person reads when a half is in the way: "You already have the morning off on 25 Nov.
-- Request the afternoon instead." Null when the clash is not a half day with a half (the caller
-- keeps its own words for a full day or an older half day).
create function app.leave_conflict_message(p_clash public.leave_requests, p_type public.leave_type, p_half text)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_day text;
  v_other text;
  v_other_taken boolean;
  v_have text;
begin
  if p_clash.id is null or p_clash.type <> 'half_day' or p_clash.half is null then
    return null;
  end if;
  v_day := to_char(p_clash.start_date, 'FMDD Mon');
  v_other := case p_clash.half when 'morning' then 'afternoon' else 'morning' end;
  v_have := case p_clash.state when 'approved' then 'You already have the ' else 'You''ve already asked for the ' end;
  select exists (
    select 1 from public.leave_requests r
    where r.member_id = p_clash.member_id and r.state in ('submitted', 'approved')
      and r.start_date <= p_clash.start_date and r.end_date >= p_clash.start_date
      and r.id <> p_clash.id
      and (r.type <> 'half_day' or r.half is null or r.half = v_other)
  ) into v_other_taken;
  if v_other_taken then
    return format('You already have %s off. Request a change to one of those requests instead.', v_day);
  end if;
  if p_type = 'half_day' and p_half is not null then
    return format('%s%s off on %s. Request the %s instead.', v_have, p_clash.half, v_day, v_other);
  end if;
  return format('%s%s off on %s. Request the %s as a half day instead.', v_have, p_clash.half, v_day, v_other);
end;
$$;
revoke all on function app.leave_conflict_message(public.leave_requests, public.leave_type, text)
  from public, anon, authenticated;
grant execute on function app.leave_conflict_message(public.leave_requests, public.leave_type, text)
  to service_role;

-- "Half day (morning), 25 Nov 2026": app.leave_clash_label with the half named.
create function app.leave_label(r public.leave_requests)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case when r.type = 'half_day' and r.half is not null
              then replace(app.leave_clash_label(r), 'Half day,',
                           'Half day (' || case when r.credit_days is not null then 'comp, ' else '' end
                           || r.half || '),')
              else app.leave_clash_label(r) end;
$$;
revoke all on function app.leave_label(public.leave_requests) from public, anon, authenticated;
grant execute on function app.leave_label(public.leave_requests) to service_role;

-- 3. The two halves of a date --------------------------------------------------------------------
-- The approved morning and afternoon half-day requests on that date (newest decision of each half),
-- by id, or nulls.
create function app.leave_halves(p_member_id uuid, d date)
returns table (morning_id uuid, afternoon_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  select
    (select r.id from public.leave_requests r
     where r.member_id = p_member_id and r.state = 'approved' and r.type = 'half_day'
       and r.half = 'morning' and r.start_date = d
     order by r.decided_at desc, r.created_at desc limit 1),
    (select r.id from public.leave_requests r
     where r.member_id = p_member_id and r.state = 'approved' and r.type = 'half_day'
       and r.half = 'afternoon' and r.start_date = d
     order by r.decided_at desc, r.created_at desc limit 1);
$$;
revoke all on function app.leave_halves(uuid, date) from public, anon, authenticated;
grant execute on function app.leave_halves(uuid, date) to service_role;

-- 4. app.leave_covering: a fully-off split day reads as one whole-day leave ----------------------
-- The body of 20261106030000_rls_helpers_plpgsql, plus: when the covering row is a half day and
-- the other half of that date is approved too, the result is the morning's row as a whole day
-- (`leave`, or `comp_leave` when both halves are comp; no half). Its callers (the day opener, the
-- absent check, today's strip, working hours and their reminder tick) then treat the date as a
-- day off, which it is.
create or replace function app.leave_covering(p_member_id uuid, d date)
returns public.leave_requests
language plpgsql
stable security definer
set search_path = ''
as $fn$
#variable_conflict use_column
declare
  v_row public.leave_requests;
  v_morning public.leave_requests;
  v_afternoon public.leave_requests;
begin
  -- The first row of the body, in its own order, or null: what the SQL function returned.
  for v_row in select r.*
  from public.leave_requests r
  where r.member_id = p_member_id and r.state = 'approved' and r.start_date <= d and r.end_date >= d
  order by r.decided_at desc, r.created_at desc
  limit 1 loop
    if v_row.type = 'half_day' and v_row.half is not null then
      select r.* into v_morning from public.leave_requests r
      where r.id = (select h.morning_id from app.leave_halves(p_member_id, d) h);
      select r.* into v_afternoon from public.leave_requests r
      where r.id = (select h.afternoon_id from app.leave_halves(p_member_id, d) h);
      if v_morning.id is not null and v_afternoon.id is not null then
        v_row := v_morning;
        v_row.type := case when v_morning.credit_days is not null and v_afternoon.credit_days is not null
                           then 'comp_leave' else 'leave' end;
        v_row.half := null;
        v_row.credit_days := case when v_row.type = 'comp_leave' then 1.0 end;
      end if;
    end if;
    return v_row;
  end loop;
  return null;
end;
$fn$;

-- 5. The day of a split date ----------------------------------------------------------------------
-- Re-derives one day the system holds from leave (approved or system-corrected, never decided by
-- the Owner) from the approved halves of its date: both halves → `leave` / `comp_leave` with both
-- links; one half left after the other went → `half_day` with that half. Any other day is left
-- alone. Called after a half day is applied or released, and by the day opener.
create function app.attendance_settle_halves(p_member_id uuid, p_date date)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_day public.attendance_days;
  v_morning public.leave_requests;
  v_afternoon public.leave_requests;
  v_status public.day_status;
  v_first uuid;
  v_second uuid;
begin
  select d.* into v_day
  from public.attendance_days d
  where d.member_id = p_member_id and d.work_date = p_date
  for update;
  if v_day.id is null
     or v_day.state not in ('approved', 'corrected')
     or not v_day.proposed_by_system or v_day.decided_by is not null
     or v_day.final_status not in ('half_day', 'leave', 'comp_leave') then
    return;
  end if;

  select r.* into v_morning from public.leave_requests r
  where r.id = (select h.morning_id from app.leave_halves(p_member_id, p_date) h);
  select r.* into v_afternoon from public.leave_requests r
  where r.id = (select h.afternoon_id from app.leave_halves(p_member_id, p_date) h);
  if v_day.leave_request_id is distinct from v_morning.id and v_day.leave_request_id is distinct from v_afternoon.id
     and v_day.second_leave_request_id is null then
    -- The day stands on something else (a full day, a gate leave): not a split matter.
    return;
  end if;

  if v_morning.id is not null and v_afternoon.id is not null then
    v_status := case when v_morning.credit_days is not null and v_afternoon.credit_days is not null
                     then 'comp_leave' else 'leave' end;
    v_first := v_morning.id;
    v_second := v_afternoon.id;
  elsif coalesce(v_morning.id, v_afternoon.id) is not null then
    v_status := 'half_day';
    v_first := coalesce(v_morning.id, v_afternoon.id);
    v_second := null;
  else
    return;
  end if;

  if v_day.final_status is distinct from v_status
     or v_day.leave_request_id is distinct from v_first
     or v_day.second_leave_request_id is distinct from v_second then
    perform set_config('app.audit_override', jsonb_build_object(
      'action', 'derived_from_leave',
      'meta', jsonb_build_object('leave_request_id', v_first, 'second_leave_request_id', v_second,
                                 'from_status', v_day.final_status, 'system', true))::text, true);
    update public.attendance_days
    set final_status = v_status, leave_request_id = v_first, second_leave_request_id = v_second,
        decided_at = now()
    where id = v_day.id;
    if v_day.final_status is distinct from v_status then
      perform app.attendance_event(v_day.id, 'derived_from_leave', v_day.final_status, v_status, null, null);
    end if;
  end if;
end;
$$;
revoke all on function app.attendance_settle_halves(uuid, date) from public, anon, authenticated;
grant execute on function app.attendance_settle_halves(uuid, date) to service_role;
comment on function app.attendance_settle_halves(uuid, date) is
  'v2.0.1, service_role only: a system-held leave day re-derived from the approved halves of its '
  'date (both → leave / comp_leave with both links; one → half_day). The caller holds the member''s '
  'leave: lock.';

-- 6. "A later leave wins", with halves --------------------------------------------------------
-- The body of 20260923171029_attendance_gate_hardening, unchanged, plus the halves of a split date
-- at the end.
create or replace function app.attendance_apply_leave(req public.leave_requests)
returns date[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_day public.attendance_days;
  v_gate public.leave_requests;
  v_status public.day_status := req.type::text::public.day_status;
  v_kept date[] := '{}';
begin
  for v_day in
    select d.*
    from public.attendance_days d
    where d.member_id = req.member_id
      and d.work_date between req.start_date and req.end_date
    order by d.work_date
    for update
  loop
    if v_day.state in ('approved', 'corrected')
       and v_day.leave_request_id is not null and v_day.leave_request_id <> req.id
       and exists (select 1 from public.leave_requests g
                   where g.id = v_day.leave_request_id and g.source = 'attendance' and g.state = 'superseded'
                     and v_day.final_status = g.type::text::public.day_status) then
      -- 2.2: the day of an approved gate leave that was just superseded follows the later
      -- decision, even with the same type, so the history shows which decision won. A day the
      -- Owner has since corrected to something else (e.g. Present) is the Owner's decision and
      -- falls through to "kept" below.
      perform set_config('app.audit_override', jsonb_build_object(
        'action', 'corrected',
        'meta', jsonb_build_object('reason', 'leave approved', 'leave_request_id', req.id,
                                   'superseded_request_id', v_day.leave_request_id,
                                   'from_status', v_day.final_status, 'system', true))::text, true);
      update public.attendance_days
      set state = 'corrected', final_status = v_status, proposed_by_system = true,
          decided_by = null, decided_at = now(), decision_reason = 'leave approved',
          leave_request_id = req.id, worked_on_leave = false
      where id = v_day.id;
      perform app.attendance_event(v_day.id, 'corrected', v_day.final_status, v_status, 'leave approved', null);
    elsif v_day.state = 'awaiting_choice' then
      -- Logged in, never chose: the day is derived now and the gate stops asking.
      perform set_config('app.audit_override', jsonb_build_object(
        'action', 'derived_from_leave',
        'meta', jsonb_build_object('leave_request_id', req.id))::text, true);
      update public.attendance_days
      set state = 'approved', final_status = v_status, proposed_by_system = true,
          decided_by = null, decided_at = now(), decision_reason = null, leave_request_id = req.id
      where id = v_day.id;
      perform app.attendance_event(v_day.id, 'derived_from_leave', null, v_status, null, null);
    elsif v_day.state = 'pending_review' then
      -- The leave wins over a Present (or a proposed absent) still waiting for the Owner: a
      -- system correction. Once the Owner has decided the day, the decision stays (2.2, below).
      -- A leave choice made at the gate is still a submitted request of its own; the approved
      -- leave wins over it too, or it would sit in the Owner's list with no door (WORKFLOWS §1).
      if v_day.leave_request_id is not null and v_day.leave_request_id <> req.id then
        select r.* into v_gate from public.leave_requests r
        where r.id = v_day.leave_request_id and r.state = 'submitted' for update;
        if v_gate.id is not null then
          perform set_config('app.audit_override', jsonb_build_object(
            'action', 'superseded', 'meta', jsonb_build_object('by', req.id, 'system', true))::text, true);
          update public.leave_requests set state = 'superseded' where id = v_gate.id;
        end if;
      end if;
      perform set_config('app.audit_override', jsonb_build_object(
        'action', 'corrected',
        'meta', jsonb_build_object('reason', 'leave approved', 'leave_request_id', req.id,
                                   'from_status', v_day.final_status, 'system', true))::text, true);
      update public.attendance_days
      set state = 'corrected', final_status = v_status, proposed_by_system = true,
          decided_by = null, decided_at = now(), decision_reason = 'leave approved',
          leave_request_id = req.id, worked_on_leave = false
      where id = v_day.id;
      perform app.attendance_event(v_day.id, 'corrected', v_day.final_status, v_status, 'leave approved', null);
    elsif v_day.state = 'approved' and v_day.proposed_by_system and v_day.submitted_choice is null
       and v_day.decided_by is null
       and (v_day.leave_request_id is distinct from req.id or v_day.final_status <> v_status) then
      -- An untouched derived day follows the request that now covers it.
      perform set_config('app.audit_override', jsonb_build_object(
        'action', 'derived_from_leave',
        'meta', jsonb_build_object('leave_request_id', req.id, 'from_status', v_day.final_status, 'system', true))::text, true);
      update public.attendance_days
      set final_status = v_status, decided_at = now(), leave_request_id = req.id
      where id = v_day.id;
      perform app.attendance_event(v_day.id, 'derived_from_leave', v_day.final_status, v_status, null, null);
    elsif v_day.state in ('approved', 'corrected') and v_day.decided_by is not null
       and v_day.leave_request_id is distinct from req.id then
      -- 2.2: a day the Owner decided (an approved Present, a correction, an approved absence)
      -- stays as the Owner decided it; the caller reports the date.
      v_kept := v_kept || v_day.work_date;
    end if;
    -- Anything else (a system correction, a day already derived from this request) is already
    -- the outcome of a decision: kept, and not reported.
  end loop;
  -- v2.0.1: a half day can be one of two halves of its date; the day follows both.
  if req.type = 'half_day' then
    perform app.attendance_settle_halves(req.member_id, req.start_date);
  end if;
  return v_kept;
end;
$$;

-- 7. Releasing a half gives the day back to the half that stands -------------------------------
-- The body of 20260923160918_attendance_leave, plus: a day linked through either column, and when
-- the other half of a split date is still approved, the day becomes that half day instead of
-- asking again.
create or replace function app.attendance_release_leave(req public.leave_requests, keep_from date, keep_to date)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_day public.attendance_days;
  v_rest uuid;
begin
  for v_day in
    select d.*
    from public.attendance_days d
    where (d.leave_request_id = req.id or d.second_leave_request_id = req.id)
      and d.work_date >= app.today_ist()
      and d.state = 'approved' and d.proposed_by_system and d.submitted_choice is null
      and (keep_from is null or d.work_date < keep_from or d.work_date > keep_to)
    order by d.work_date
    for update
  loop
    v_rest := case when v_day.leave_request_id = req.id then v_day.second_leave_request_id
                   else v_day.leave_request_id end;
    if v_rest is not null
       and exists (select 1 from public.leave_requests r where r.id = v_rest and r.state = 'approved') then
      perform set_config('app.audit_override', jsonb_build_object(
        'action', 'corrected',
        'meta', jsonb_build_object('reason', 'leave cancelled', 'leave_request_id', req.id,
                                   'kept_request_id', v_rest,
                                   'from_status', v_day.final_status, 'system', true))::text, true);
      update public.attendance_days
      set final_status = 'half_day', leave_request_id = v_rest, second_leave_request_id = null,
          decided_at = now()
      where id = v_day.id;
      perform app.attendance_event(v_day.id, 'corrected', v_day.final_status, 'half_day', 'leave cancelled', null);
    else
      perform set_config('app.audit_override', jsonb_build_object(
        'action', 'corrected',
        'meta', jsonb_build_object('reason', 'leave cancelled', 'leave_request_id', req.id,
                                   'from_status', v_day.final_status, 'system', true))::text, true);
      update public.attendance_days
      set state = 'awaiting_choice', final_status = null, proposed_by_system = false,
          decided_by = null, decided_at = null, decision_reason = null, leave_request_id = null,
          second_leave_request_id = null
      where id = v_day.id;
      perform app.attendance_event(v_day.id, 'corrected', v_day.final_status, null, 'leave cancelled', null);
    end if;
  end loop;
end;
$$;

-- 8. The day opener links both halves of a fully-off split date --------------------------------
-- The body of 20260928131234_contract_phase3b with the second link.
create or replace function app.attendance_open_day(p_member_id uuid, p_date date)
returns public.attendance_days
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_day public.attendance_days;
  v_leave public.leave_requests;
  v_day_off boolean;
  v_second uuid;
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
    -- v2.0.1: a fully-off split date (leave_covering gives the morning as a whole day) links the
    -- afternoon's request too.
    if v_leave.half is null and v_leave.type in ('leave', 'comp_leave') then
      select h.afternoon_id into v_second from app.leave_halves(p_member_id, p_date) h
      where h.morning_id = v_leave.id;
    end if;
    perform set_config('app.audit_override', jsonb_build_object(
      'action', 'derived_from_leave',
      'meta', jsonb_build_object('leave_request_id', v_leave.id, 'second_leave_request_id', v_second))::text, true);
    insert into public.attendance_days (
      member_id, work_date, is_day_off, state, proposed_by_system, final_status, decided_at, leave_request_id,
      second_leave_request_id)
    values (
      p_member_id, p_date, v_day_off, 'approved', true,
      v_leave.type::text::public.day_status, now(), v_leave.id, v_second)
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

-- 9. The request paths with per-half conflicts -------------------------------------------------
-- leave_submit and leave_submit_comp: the bodies of 20261022090443_working_hours with the overlap
-- check per half (app.leave_conflict) and its message.
create or replace function public.leave_submit(type public.leave_type, start_date date, end_date date, reason text default null,
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
  v_clash public.leave_requests;
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
  -- v2.0.1: two half days of one date sit side by side when their halves differ.
  v_clash := app.leave_conflict(v_caller, start_date, end_date, type, half, null, false);
  if v_clash.id is not null then
    perform app.fail('CONFLICT', coalesce(app.leave_conflict_message(v_clash, type, half),
      'You already have a request for these dates. Request a change to it instead.'));
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

create or replace function public.leave_submit_comp(start_date date, half_day boolean default false, reason text default null,
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
  v_clash public.leave_requests;
begin
  select r.caller_id, r.org_id into v_caller, v_org from app.attendance_require_self() r;
  perform app.leave_validate(v_type, start_date, start_date, app.today_ist());
  perform app.leave_half_check(v_type, half);
  -- 3b review: a weekly day off or a holiday is already off; a credit spent on it would be lost.
  if app.is_working_day(start_date) is false then
    perform app.fail('VALIDATION', 'That date is a day off. Comp leave is for a working day.');
  end if;
  perform pg_advisory_xact_lock(hashtext('leave:' || v_caller::text));
  -- v2.0.1: a comp half sits beside the other half of that date (comp or ordinary leave).
  v_clash := app.leave_conflict(v_caller, start_date, start_date, v_type, half, null, false);
  if v_clash.id is not null then
    perform app.fail('CONFLICT', coalesce(app.leave_conflict_message(v_clash, v_type, half),
      'You already have a request for this date. Request a change to it instead.'));
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

-- 10. One request for a split day: "Full day: ½ comp + ½ leave" ----------------------------------
-- Two half-day rows sharing a pair_id: the comp half (credit_days 0.5, drawn oldest first and
-- reserved like leave_submit_comp) and the other half as ordinary leave. The whole date must be
-- free; the Owner decides the two together (leave_decide). Returns the pair_id.
create function public.leave_submit_split(work_date date, comp_half text, reason text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid;
  v_org uuid;
  v_reason text := app.clean_reason(reason);
  v_pair uuid := gen_random_uuid();
  v_other text;
  v_left numeric;
  v_clash public.leave_requests;
  v_comp public.leave_requests;
  v_leave public.leave_requests;
begin
  select r.caller_id, r.org_id into v_caller, v_org from app.attendance_require_self() r;
  if comp_half is null or comp_half not in ('morning', 'afternoon') then
    perform app.fail('VALIDATION', 'Choose which half is comp leave: Morning or Afternoon.');
  end if;
  v_other := case comp_half when 'morning' then 'afternoon' else 'morning' end;
  perform app.leave_validate('half_day', work_date, work_date, app.today_ist());
  if app.is_working_day(work_date) is false then
    perform app.fail('VALIDATION', 'That date is a day off. Comp leave is for a working day.');
  end if;
  perform pg_advisory_xact_lock(hashtext('leave:' || v_caller::text));
  -- The whole date has to be free: both halves are asked for here.
  v_clash := app.leave_conflict(v_caller, work_date, work_date, 'leave', null, null, false);
  if v_clash.id is not null then
    perform app.fail('CONFLICT', coalesce(app.leave_conflict_message(v_clash, 'leave', null),
      'You already have a request for this date. Request a change to it instead.'));
  end if;

  select coalesce(sum(c.days - c.used_days - c.reserved_days), 0) into v_left
  from public.comp_leave_credits c
  where c.member_id = v_caller and c.revoked_at is null and c.expires_on >= work_date;
  if v_left < 0.5 then
    perform app.fail('VALIDATION', 'You don''t have enough comp leave for that date.');
  end if;

  perform set_config('app.audit_override', jsonb_build_object(
    'action', 'submitted', 'meta', jsonb_build_object('source', 'form', 'comp', true, 'credit_days', 0.5,
                                                      'pair_id', v_pair))::text, true);
  insert into public.leave_requests (member_id, type, start_date, end_date, reason, state, source, credit_days, half, pair_id)
  values (v_caller, 'half_day', work_date, work_date, v_reason, 'submitted', 'form', 0.5, comp_half, v_pair)
  returning * into v_comp;
  if app.comp_credit_draw(v_caller, v_comp.id, work_date, 0.5) > 0 then
    perform app.fail('VALIDATION', 'You don''t have enough comp leave for that date.');
  end if;

  perform set_config('app.audit_override', jsonb_build_object(
    'action', 'submitted', 'meta', jsonb_build_object('source', 'form', 'pair_id', v_pair))::text, true);
  insert into public.leave_requests (member_id, type, start_date, end_date, reason, state, source, half, pair_id)
  values (v_caller, 'half_day', work_date, work_date, v_reason, 'submitted', 'form', v_other, v_pair)
  returning * into v_leave;

  -- WORKFLOWS §9 "Leave requested": the Owner (5.1), once for the pair. Never an amount.
  perform app.notify(array[app.org_owner_id(v_org)], 'leave_requested',
    format('%s requested a full day: ½ comp + ½ leave', app.member_name(v_caller)),
    app.notify_span(work_date, work_date) || ' · comp in the ' || comp_half
      || case when v_reason is null then '' else ' · ' || v_reason end,
    '/approvals', 'leave_requests', v_comp.id,
    jsonb_build_object('leave_request_id', v_comp.id, 'member_id', v_caller, 'pair_id', v_pair));
  return v_pair;
end;
$$;
revoke all on function public.leave_submit_split(date, text, text) from public, anon;
grant execute on function public.leave_submit_split(date, text, text) to authenticated, service_role;
comment on function public.leave_submit_split(date, text, text) is
  'v2.0.1, attendance.self: "Full day: ½ comp + ½ leave" on one working date, today or later and '
  'within a credit''s use-by date. Two submitted half-day rows sharing a pair_id: comp_half with '
  'credit_days 0.5 (reserved oldest first) and the other half as ordinary leave. The whole date must '
  'be free (CONFLICT names a half in the way). Audited (submitted, reserved); notifies the Owner once. '
  'Returns the pair_id.';

-- 11. Withdraw: a waiting pair goes back together ------------------------------------------------
-- The body of 20260927192652_extra_work_comp_leave, plus the waiting other half of a pair.
create or replace function public.leave_withdraw(request_id uuid)
returns public.leave_state
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid;
  v_org uuid;
  v_req public.leave_requests;
  v_partner public.leave_requests;
begin
  select r.caller_id, r.org_id into v_caller, v_org from app.attendance_require_self() r;

  -- 2.4: the caller's leave: lock first, like every other leave write.
  perform pg_advisory_xact_lock(hashtext('leave:' || v_caller::text));
  select r.* into v_req from public.leave_requests r where r.id = request_id and r.member_id = v_caller for update;
  if v_req.id is null then
    perform app.fail('NOT_FOUND', 'This leave request is not yours.');
  end if;
  if v_req.source = 'attendance' then
    perform app.fail('INVALID_STATE', 'Today''s attendance is under review; the Owner decides it with the day.');
  end if;
  if v_req.state <> 'submitted' then
    perform app.fail('INVALID_STATE', 'Only a request that is still waiting can be withdrawn.');
  end if;

  perform set_config('app.audit_override', jsonb_build_object('action', 'withdrawn')::text, true);
  update public.leave_requests set state = 'withdrawn' where id = v_req.id;
  -- 3b.2: a comp leave request gives its credit back.
  perform app.comp_credit_settle(v_req.id, 'released');

  -- v2.0.1: a split day asked for in one go is withdrawn in one go while it waits.
  if v_req.pair_id is not null then
    for v_partner in
      select r.* from public.leave_requests r
      where r.pair_id = v_req.pair_id and r.id <> v_req.id and r.state = 'submitted'
      for update
    loop
      perform set_config('app.audit_override', jsonb_build_object(
        'action', 'withdrawn', 'meta', jsonb_build_object('pair_id', v_req.pair_id))::text, true);
      update public.leave_requests set state = 'withdrawn' where id = v_partner.id;
      perform app.comp_credit_settle(v_partner.id, 'released');
    end loop;
  end if;
  return 'withdrawn';
end;
$$;

-- 12. Ask to change or cancel: the half is kept (or chosen) --------------------------------------
-- The body of 20260930050132_notifications_core with a `half` argument: a change of a half day keeps
-- the original's half unless another is given, a cancellation carries it, and the overlap check is
-- per half. The old signature is dropped so the released app's call resolves here.
drop function public.leave_request_change(uuid, public.leave_type, date, date, text, boolean);
create function public.leave_request_change(
  request_id uuid, type public.leave_type default null, start_date date default null, end_date date default null,
  reason text default null, cancel boolean default false, half text default null)
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
  v_half text;
  v_id uuid;
  v_new public.leave_requests;
  v_clash public.leave_requests;
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
    v_type := v_req.type; v_start := v_req.start_date; v_end := v_req.end_date; v_half := v_req.half;
  else
    v_type := type; v_start := start_date; v_end := end_date;
    -- v2.0.1: a half day keeps its half unless another is chosen.
    v_half := case when v_type = 'half_day'
                   then coalesce(half, case when v_req.type = 'half_day' then v_req.half end) end;
    perform app.leave_validate(v_type, v_start, v_end, null);
    perform app.leave_half_check(v_type, half);
    if v_start < app.today_ist() and v_start <> v_req.start_date then
      perform app.fail('VALIDATION', 'Leave cannot start in the past.');
    end if;
    if v_end < app.today_ist() then
      perform app.fail('VALIDATION', 'The changed leave must end today or later.');
    end if;
    v_clash := app.leave_conflict(v_caller, v_start, v_end, v_type, v_half, v_req.id, false);
    if v_clash.id is not null then
      perform app.fail('CONFLICT', coalesce(app.leave_conflict_message(v_clash, v_type, v_half),
        'You already have another request for these dates.'));
    end if;
  end if;

  perform set_config('app.audit_override', jsonb_build_object(
    'action', case when coalesce(cancel, false) then 'cancellation_requested' else 'change_requested' end,
    'meta', jsonb_build_object('supersedes_id', v_req.id))::text, true);
  insert into public.leave_requests (
    member_id, type, start_date, end_date, reason, state, source, supersedes_id, requests_cancellation, half)
  values (v_caller, v_type, v_start, v_end, v_reason, 'submitted', 'form', v_req.id, coalesce(cancel, false), v_half)
  returning * into v_new;
  v_id := v_new.id;
  -- WORKFLOWS §9 "Leave requested / changed": the Owner (5.1).
  perform app.notify_leave_owner(v_new, v_org, case when coalesce(cancel, false) then 'cancel' else 'change' end);
  return v_id;
end;
$$;
revoke all on function public.leave_request_change(uuid, public.leave_type, date, date, text, boolean, text) from public, anon;
grant execute on function public.leave_request_change(uuid, public.leave_type, date, date, text, boolean, text)
  to authenticated, service_role;
comment on function public.leave_request_change(uuid, public.leave_type, date, date, text, boolean, text) is
  'attendance.self, own approved leave not yet ended: a submitted change (or, with cancel, a '
  'cancellation) row superseding it, decided by the Owner in leave_decide. v2.0.1: `half` chooses '
  'the half of a half-day change (default: the original''s); a cancellation carries the original''s '
  'half; the overlap check is per half. A comp request can only be cancelled. Notifies the Owner.';

-- 13. leave_decide: per-half clashes, and a waiting pair decided together -----------------------
-- The body of 20260930073623_notifications_review_fixes with the pair block and app.leave_conflict.
create or replace function public.leave_decide(request_id uuid, decision text, reason text default null)
returns table(state public.leave_state, kept_dates date[])
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_caller uuid;
  v_org uuid;
  v_reason text := app.clean_reason(reason);
  v_member uuid;
  v_req public.leave_requests;
  v_orig public.leave_requests;
  v_clash public.leave_requests;
  v_kept date[];
  v_what text;
  v_partner public.leave_requests;
  v_half public.leave_requests;
begin
  select r.caller_id, r.org_id into v_caller, v_org from app.attendance_require_decider() r;

  if decision is null or decision not in ('approve', 'reject') then
    perform app.fail('VALIDATION', 'The decision is approve or reject.');
  end if;

  -- 2.4: whose request it is (no lock), then that person's leave: lock, then the rows.
  select r.member_id into v_member
  from public.leave_requests r
  join public.members m on m.id = r.member_id and m.org_id = v_org
  where r.id = leave_decide.request_id;
  if v_member is null then
    perform app.fail('NOT_FOUND', 'This leave request does not exist.');
  end if;
  perform pg_advisory_xact_lock(hashtext('leave:' || v_member::text));

  select r.* into v_req from public.leave_requests r where r.id = leave_decide.request_id for update;
  if v_req.source = 'attendance' then
    perform app.fail('INVALID_STATE', 'Decide this one from the attendance day: it was made at the gate.');
  end if;
  if v_req.state <> 'submitted' then
    perform app.fail('INVALID_STATE', 'This request has already been decided.');
  end if;
  v_what := case v_req.type when 'comp_leave' then 'Comp leave' when 'half_day' then 'Half day' else 'Leave' end;

  -- v2.0.1: a split day asked for in one go ("Full day: ½ comp + ½ leave") is decided in one go
  -- while it waits: the same decision and reason for both halves, one notification.
  if v_req.pair_id is not null then
    select r.* into v_partner from public.leave_requests r
    where r.pair_id = v_req.pair_id and r.id <> v_req.id and r.state = 'submitted'
    for update;
  end if;
  if v_partner.id is not null then
    if decision = 'reject' then
      if v_reason is null then
        perform app.fail('REASON_REQUIRED', 'A rejection needs a reason.');
      end if;
      foreach v_half in array array[v_req, v_partner] loop
        perform set_config('app.audit_override', jsonb_build_object(
          'action', 'rejected', 'meta', jsonb_build_object('reason', v_reason, 'pair_id', v_req.pair_id))::text, true);
        update public.leave_requests r
        set state = 'rejected', decided_by = v_caller, decided_at = now(), decision_reason = v_reason
        where r.id = v_half.id;
        perform app.comp_credit_settle(v_half.id, 'released');
      end loop;
      perform app.notify_leave_member(v_req, 'Full day (½ comp + ½ leave) rejected',
        app.notify_span(v_req.start_date, v_req.end_date) || ' · ' || v_reason);
      return query select 'rejected'::public.leave_state, '{}'::date[];
      return;
    end if;

    v_kept := '{}';
    foreach v_half in array array[v_req, v_partner] loop
      perform app.leave_supersede_gate(v_half.member_id, v_half.start_date, v_half.end_date, v_half.id);
      v_clash := app.leave_conflict(v_half.member_id, v_half.start_date, v_half.end_date, v_half.type, v_half.half,
                                    v_half.id, true);
      if v_clash.id is not null then
        perform app.fail('CONFLICT', format('Approved leave (%s) already covers these dates. Cancel or edit it first.',
                                            app.leave_label(v_clash)));
      end if;
      perform set_config('app.audit_override', jsonb_build_object(
        'action', 'approved', 'meta', jsonb_build_object('reason', v_reason, 'pair_id', v_req.pair_id))::text, true);
      update public.leave_requests r
      set state = 'approved', decided_by = v_caller, decided_at = now(), decision_reason = v_reason
      where r.id = v_half.id
      returning r.* into v_half;
      perform app.comp_credit_settle(v_half.id, 'used');
      v_kept := v_kept || app.attendance_apply_leave(v_half);
    end loop;
    perform app.notify_leave_member(v_req, 'Full day (½ comp + ½ leave) approved',
      app.notify_span(v_req.start_date, v_req.end_date)
        || case when v_reason is null then '' else ' · ' || v_reason end);
    return query select 'approved'::public.leave_state, (select coalesce(array_agg(distinct k order by k), '{}') from unnest(v_kept) k);
    return;
  end if;

  if decision = 'reject' then
    if v_reason is null then
      perform app.fail('REASON_REQUIRED', 'A rejection needs a reason.');
    end if;
    perform set_config('app.audit_override', jsonb_build_object(
      'action', 'rejected', 'meta', jsonb_build_object('reason', v_reason))::text, true);
    update public.leave_requests r
    set state = 'rejected', decided_by = v_caller, decided_at = now(), decision_reason = v_reason
    where r.id = v_req.id;
    -- 3b.2: a rejected comp leave request gives its credit back.
    perform app.comp_credit_settle(v_req.id, 'released');
    -- WORKFLOWS §9 "Leave decided": the member (5.1).
    perform app.notify_leave_member(v_req,
      case when v_req.requests_cancellation then 'Cancellation not approved'
           when v_req.supersedes_id is not null then 'Change not approved'
           else v_what || ' rejected' end,
      app.notify_span(v_req.start_date, v_req.end_date)
        || case when v_reason is null then '' else ' · ' || v_reason end);
    return query select 'rejected'::public.leave_state, '{}'::date[];
    return;
  end if;

  if v_req.supersedes_id is not null then
    select r.* into v_orig from public.leave_requests r where r.id = v_req.supersedes_id for update;
  end if;

  if v_req.requests_cancellation then
    if v_orig.state <> 'approved' then
      perform app.fail('INVALID_STATE', 'The leave this cancellation refers to is no longer approved.');
    end if;
    perform set_config('app.audit_override', jsonb_build_object(
      'action', 'cancelled', 'meta', jsonb_build_object('by_request', v_req.id, 'reason', v_reason))::text, true);
    update public.leave_requests r
    set state = 'cancelled', decided_by = v_caller, decided_at = now(),
        decision_reason = coalesce(v_reason, 'cancellation approved')
    where r.id = v_orig.id;
    perform app.attendance_release_leave(v_orig, null, null);
    -- 3b.2: a cancelled comp leave gives its credit back (expired by now, or not).
    perform app.comp_credit_settle(v_orig.id, 'released');

    perform set_config('app.audit_override', jsonb_build_object(
      'action', 'cancelled', 'meta', jsonb_build_object('reason', v_reason))::text, true);
    update public.leave_requests r
    set state = 'cancelled', decided_by = v_caller, decided_at = now(), decision_reason = v_reason
    where r.id = v_req.id;
    perform app.notify_leave_member(v_req, v_what || ' cancelled, as you asked',
      app.notify_span(v_req.start_date, v_req.end_date)
        || case when v_reason is null then '' else ' · ' || v_reason end);
    return query select 'cancelled'::public.leave_state, '{}'::date[];
    return;
  end if;

  if v_orig.id is not null and v_orig.state = 'approved' then
    perform set_config('app.audit_override', jsonb_build_object(
      'action', 'superseded', 'meta', jsonb_build_object('by', v_req.id))::text, true);
    update public.leave_requests r set state = 'superseded' where r.id = v_orig.id;
    perform app.attendance_release_leave(v_orig, v_req.start_date, v_req.end_date);
    -- 3b.2: a superseded comp leave gives its credit back.
    perform app.comp_credit_settle(v_orig.id, 'released');
  end if;
  -- The later decision wins over a gate leave (WORKFLOWS §1, 2.2).
  perform app.leave_supersede_gate(v_req.member_id, v_req.start_date, v_req.end_date, v_req.id);
  -- Approved form or owner leave that already covers these dates (a race at submit time, or an
  -- Owner correction since): the Owner cancels or edits that one first. Submitted overlaps are
  -- not checked here; "the leave wins" supersedes a gate request, and the Owner rejects the rest.
  -- v2.0.1: per half (two half days of one date with different halves sit side by side).
  v_clash := app.leave_conflict(v_req.member_id, v_req.start_date, v_req.end_date, v_req.type, v_req.half,
                                v_req.id, true);
  if v_clash.id is not null then
    perform app.fail('CONFLICT', format('Approved leave (%s) already covers these dates. Cancel or edit it first.',
                                        app.leave_label(v_clash)));
  end if;

  perform set_config('app.audit_override', jsonb_build_object(
    'action', 'approved', 'meta', jsonb_build_object('reason', v_reason))::text, true);
  update public.leave_requests r
  set state = 'approved', decided_by = v_caller, decided_at = now(), decision_reason = v_reason
  where r.id = v_req.id
  returning r.* into v_req;
  -- 3b.2: an approved comp leave uses its credit (oldest first, reserved at submit).
  perform app.comp_credit_settle(v_req.id, 'used');
  v_kept := app.attendance_apply_leave(v_req);
  perform app.notify_leave_member(v_req,
    case when v_orig.id is not null then v_what || ' change approved' else v_what || ' approved' end,
    app.notify_span(v_req.start_date, v_req.end_date)
      || case when v_reason is null then '' else ' · ' || v_reason end);
  return query select 'approved'::public.leave_state, v_kept;
end;
$$;

-- 14. The Owner's edit keeps (or sets) the half and a ½ comp -----------------------------------
-- The body of 20260930050132_notifications_core with `half` and `comp` (a ½ comp day: half_day
-- with credit 0.5, drawn and used at once like a full comp day). Defaults keep the original's half
-- and comp, so an edit no longer turns a ½ comp day into ordinary leave. The old signature is
-- dropped so the released app's call resolves here.
drop function public.leave_owner_edit(uuid, public.leave_type, date, date, text);
create function public.leave_owner_edit(request_id uuid, type public.leave_type, start_date date, end_date date, reason text default null,
                                        half text default null, comp boolean default null)
returns table(new_id uuid, kept_dates date[])
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid;
  v_org uuid;
  v_reason text := app.clean_reason(reason);
  v_member uuid;
  v_orig public.leave_requests;
  v_new public.leave_requests;
  v_new_id uuid := gen_random_uuid();
  v_clash public.leave_requests;
  v_kept date[];
  v_comp boolean := leave_owner_edit.type = 'comp_leave';
  v_half text;
  v_comp_half boolean;
  v_credit numeric;
begin
  select r.caller_id, r.org_id into v_caller, v_org from app.attendance_require_decider() r;

  -- 2.4: whose request it is (no lock), then that person's leave: lock, then the row.
  select r.member_id into v_member
  from public.leave_requests r
  join public.members m on m.id = r.member_id and m.org_id = v_org
  where r.id = leave_owner_edit.request_id;
  if v_member is null then
    perform app.fail('NOT_FOUND', 'This leave request does not exist.');
  end if;
  perform pg_advisory_xact_lock(hashtext('leave:' || v_member::text));

  select r.* into v_orig from public.leave_requests r where r.id = leave_owner_edit.request_id for update;
  if v_orig.state <> 'approved' then
    perform app.fail('INVALID_STATE', 'Only approved leave can be edited.');
  end if;
  perform app.leave_validate(leave_owner_edit.type, leave_owner_edit.start_date, leave_owner_edit.end_date, null);
  -- v2.0.1: a half day keeps its half and, if it was a ½ comp day, its comp, unless the Owner
  -- says otherwise (the edit used to drop both).
  if leave_owner_edit.type = 'half_day' then
    v_half := coalesce(leave_owner_edit.half, case when v_orig.type = 'half_day' then v_orig.half end);
    v_comp_half := coalesce(leave_owner_edit.comp, v_orig.type = 'half_day' and v_orig.credit_days is not null);
  else
    perform app.leave_half_check(leave_owner_edit.type, leave_owner_edit.half);
    v_comp_half := false;
  end if;
  perform app.leave_half_check(leave_owner_edit.type, v_half);
  if v_comp_half and v_half is null then
    perform app.fail('VALIDATION', 'Choose Morning or Afternoon for a ½ comp day.');
  end if;
  if v_comp_half and app.is_working_day(leave_owner_edit.start_date) is false then
    perform app.fail('VALIDATION', 'That date is a day off. Comp leave is for a working day.');
  end if;
  v_credit := case when v_comp then 1.0 when v_comp_half then 0.5 end;
  -- 3c review: comp leave uses a credit (kickoff 3b decision 16), so it keeps leave_submit_comp's
  -- limits here too: one date, on a working day.
  if v_comp and leave_owner_edit.start_date <> leave_owner_edit.end_date then
    perform app.fail('VALIDATION', 'Comp leave is one day at a time. Edit it to a single date.');
  end if;
  if v_comp and app.is_working_day(leave_owner_edit.start_date) is false then
    perform app.fail('VALIDATION', 'That date is a day off. Comp leave is for a working day.');
  end if;
  -- The later decision wins over a gate leave (WORKFLOWS §1, 2.2).
  perform app.leave_supersede_gate(v_orig.member_id, leave_owner_edit.start_date, leave_owner_edit.end_date,
                                   v_new_id, v_orig.id);
  -- A pending change or cancellation the person opened against it counts too: decide it first.
  -- v2.0.1: per half, so the other half of a split date stays beside the edited one.
  v_clash := app.leave_conflict(v_orig.member_id, leave_owner_edit.start_date, leave_owner_edit.end_date,
                                leave_owner_edit.type, v_half, v_orig.id, false);
  if v_clash.id is not null then
    perform app.fail('CONFLICT', format('This person has another open request on these dates (%s, %s). Decide it first.',
                                        app.leave_label(v_clash),
                                        case v_clash.state when 'submitted' then 'waiting' else 'approved' end));
  end if;

  perform set_config('app.audit_override', jsonb_build_object(
    'action', 'superseded', 'meta', jsonb_build_object('by_owner', true, 'reason', v_reason))::text, true);
  update public.leave_requests r set state = 'superseded' where r.id = v_orig.id;
  -- 3b.2: the Owner's replacement is owner-set leave; the comp credit goes back to the member
  -- (before the draw below, so a comp day moved to another date re-uses its own credit).
  perform app.comp_credit_settle(v_orig.id, 'released');

  perform set_config('app.audit_override', jsonb_build_object(
    'action', 'approved',
    'meta', jsonb_build_object('via', 'owner_edit', 'reason', v_reason)
            || case when v_credit is not null then jsonb_build_object('comp', true, 'credit_days', v_credit) else '{}'::jsonb end)::text, true);
  insert into public.leave_requests (
    id, member_id, type, start_date, end_date, reason, state, source, supersedes_id, decided_by, decided_at, decision_reason,
    credit_days, half)
  values (
    v_new_id, v_orig.member_id, leave_owner_edit.type, leave_owner_edit.start_date, leave_owner_edit.end_date,
    v_reason, 'approved', 'owner', v_orig.id, v_caller, now(), v_reason,
    v_credit, v_half)
  returning * into v_new;

  -- 3c review: the Owner's comp leave uses one of the member's credits valid on that date, oldest
  -- first, at once; none refuses the whole edit (the original then stays approved).
  if v_credit is not null then
    if app.comp_credit_draw(v_new.member_id, v_new.id, v_new.start_date, v_credit) > 0 then
      perform app.fail('VALIDATION', 'Comp leave needs an earned credit valid on that date. Grant one first from their Leave tab.');
    end if;
    perform app.comp_credit_settle(v_new.id, 'used');
  end if;

  perform app.attendance_release_leave(v_orig, v_new.start_date, v_new.end_date);
  v_kept := app.attendance_apply_leave(v_new);
  -- WORKFLOWS §9 "Leave decided": the member (5.1).
  perform app.notify_leave_member(v_new, 'Leave changed by the Owner',
    format('Now %s, %s%s',
      case when v_new.type = 'comp_leave' then 'comp leave'
           when v_new.type = 'half_day' and v_new.credit_days is not null then 'a ½ comp day' || coalesce(' (' || v_new.half || ')', '')
           when v_new.type = 'half_day' then 'a half day' || coalesce(' (' || v_new.half || ' off)', '')
           else 'leave' end,
      app.notify_span(v_new.start_date, v_new.end_date),
      case when v_reason is null then '' else ' · ' || v_reason end));
  return query select v_new.id, coalesce(v_kept, '{}'::date[]);
end;
$$;
revoke all on function public.leave_owner_edit(uuid, public.leave_type, date, date, text, text, boolean) from public, anon;
grant execute on function public.leave_owner_edit(uuid, public.leave_type, date, date, text, text, boolean)
  to authenticated, service_role;
comment on function public.leave_owner_edit(uuid, public.leave_type, date, date, text, text, boolean) is
  'attendance.decide (the Owner): supersede an approved request with an Owner-made approved one. '
  'v2.0.1: `half` (morning | afternoon) for a half day, default the original''s; `comp` makes a half '
  'day a ½ comp day (credit 0.5, drawn and used at once), default: kept if the original was one. A '
  'comp_leave is a full comp day (credit 1.0). Overlaps are per half. Returns new_id and kept_dates.';

-- 15. The Owner's correction can set a half day, a ½ comp day or a split day ---------------------
-- The body of 20260930050132_notifications_core with `half` (which half is off, for a half day) and
-- `comp_half` (with Half day: the same half, a ½ comp day; with Leave: a split day, ½ comp + ½
-- leave, two approved half days born together). Credits are drawn and used at once, as for the
-- Owner's full comp day. The old signature is dropped so the released app's call resolves here.
drop function public.attendance_decide(uuid, text, public.day_status, text);
create function public.attendance_decide(day_id uuid, decision text, status public.day_status default null, reason text default null,
                                         half text default null, comp_half text default null)
returns public.attendance_state
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid;
  v_org uuid;
  v_reason text := app.clean_reason(reason);
  v_member uuid;
  v_day public.attendance_days;
  v_req public.leave_requests;
  v_to public.day_status;
  v_link uuid;
  v_worked boolean := false;
  v_state public.attendance_state;
  v_second uuid;
  v_split boolean := false;
  v_matches boolean;
  v_pair uuid;
  v_other uuid;
  v_old public.leave_requests;
begin
  select r.caller_id, r.org_id into v_caller, v_org from app.attendance_require_decider() r;

  if decision is null or decision not in ('approve', 'correct') then
    perform app.fail('VALIDATION', 'The decision is approve or correct.');
  end if;

  -- 2.4: whose day it is (no lock), then that person's leave: lock, then the rows.
  select d.member_id into v_member
  from public.attendance_days d
  join public.members m on m.id = d.member_id and m.org_id = v_org
  where d.id = day_id;
  if v_member is null then
    perform app.fail('NOT_FOUND', 'This attendance day does not exist.');
  end if;
  perform pg_advisory_xact_lock(hashtext('leave:' || v_member::text));

  select d.* into v_day from public.attendance_days d where d.id = day_id for update;

  if v_day.leave_request_id is not null then
    select r.* into v_req from public.leave_requests r where r.id = v_day.leave_request_id for update;
  end if;

  if decision = 'approve' then
    if v_day.state <> 'pending_review' then
      perform app.fail('INVALID_STATE', 'Only a day awaiting review can be approved.');
    end if;
    v_to := coalesce(v_day.submitted_choice::text::public.day_status, v_day.final_status);
    if v_to is null then
      perform app.fail('INVALID_STATE', 'This day has nothing to approve.');
    end if;
    v_link := v_day.leave_request_id;
    v_worked := coalesce(
      v_day.submitted_choice = 'present' and v_req.id is not null and v_req.state = 'approved'
      and v_day.work_date between v_req.start_date and v_req.end_date, false);
    if v_req.id is not null and v_req.state = 'submitted' then
      -- The gate's leave request is decided with the day (WORKFLOWS §2).
      perform set_config('app.audit_override', jsonb_build_object(
        'action', 'approved', 'meta', jsonb_build_object('via', 'attendance', 'reason', v_reason))::text, true);
      update public.leave_requests
      set state = 'approved', decided_by = v_caller, decided_at = now(), decision_reason = v_reason
      where id = v_req.id;
    end if;
    v_state := 'approved';
    perform set_config('app.audit_override', jsonb_build_object(
      'action', 'approved',
      'meta', jsonb_build_object('status', v_to, 'reason', v_reason, 'worked_on_leave', v_worked))::text, true);
    update public.attendance_days
    set state = 'approved', final_status = v_to, decided_by = v_caller, decided_at = now(),
        decision_reason = v_reason, worked_on_leave = v_worked, leave_request_id = v_link
    where id = v_day.id;
    perform app.attendance_event(v_day.id, 'approved', v_day.final_status, v_to, v_reason, v_caller);
  else
    if status is null then
      perform app.fail('VALIDATION', 'Choose the status the day should have.');
    end if;
    if v_reason is null then
      perform app.fail('REASON_REQUIRED', 'A correction needs a reason.');
    end if;
    v_to := status;
    v_link := v_day.leave_request_id;
    v_second := v_day.second_leave_request_id;
    -- v2.0.1: which half is off (a half day), and which half is comp: with Half day it must be the
    -- same half (a ½ comp day); with Leave it makes a split day (½ comp + ½ leave).
    if half is not null and half not in ('morning', 'afternoon') then
      perform app.fail('VALIDATION', 'Choose Morning or Afternoon.');
    end if;
    if comp_half is not null and comp_half not in ('morning', 'afternoon') then
      perform app.fail('VALIDATION', 'Choose which half is comp leave: Morning or Afternoon.');
    end if;
    if half is not null and v_to <> 'half_day' then
      perform app.fail('VALIDATION', 'Morning or Afternoon is only for a half day.');
    end if;
    if comp_half is not null and v_to not in ('half_day', 'leave') then
      perform app.fail('VALIDATION', 'A comp half is for a half day or a split day.');
    end if;
    if comp_half is not null and v_to = 'half_day' and comp_half is distinct from half then
      perform app.fail('VALIDATION', 'A ½ comp day is comp leave in the half that is off.');
    end if;
    v_split := comp_half is not null and v_to = 'leave';

    if v_req.id is not null and v_req.state = 'submitted' then
      -- v2.0.1: a split day is never the gate's request approved as it stands.
      if v_req.type::text = v_to::text and not v_split then
        perform set_config('app.audit_override', jsonb_build_object(
          'action', 'approved', 'meta', jsonb_build_object('via', 'attendance', 'reason', v_reason))::text, true);
        update public.leave_requests
        set state = 'approved', decided_by = v_caller, decided_at = now(), decision_reason = v_reason
        where id = v_req.id;
        v_req.state := 'approved';
      else
        perform set_config('app.audit_override', jsonb_build_object(
          'action', 'rejected', 'meta', jsonb_build_object('via', 'attendance', 'reason', v_reason))::text, true);
        update public.leave_requests
        set state = 'rejected', decided_by = v_caller, decided_at = now(), decision_reason = v_reason
        where id = v_req.id;
        v_req.state := 'rejected';
        v_link := null;
      end if;
    end if;

    -- The linked approved request already says what the Owner chose (for a half day: the same
    -- half, and comp or not), so nothing new is made.
    v_matches := v_req.id is not null and v_req.state = 'approved' and v_req.type::text = v_to::text
                 and v_day.work_date between v_req.start_date and v_req.end_date
                 and not v_split
                 and (v_to <> 'half_day'
                      or ((half is null or v_req.half is not distinct from half)
                          and (comp_half is null) = (v_req.credit_days is null)));
    if v_split or (v_to = 'half_day' and not v_matches) then
      -- v2.0.1: the Owner's halves replace the day's own: an approved request linked to this day
      -- and covering only this date is superseded and its comp credit goes back, so correcting a
      -- day twice never books the date or the credit twice. Leave over several days stays.
      for v_old in
        select r.* from public.leave_requests r
        where r.id in (v_day.leave_request_id, v_day.second_leave_request_id)
          and r.state = 'approved' and r.start_date = v_day.work_date and r.end_date = v_day.work_date
        for update
      loop
        perform set_config('app.audit_override', jsonb_build_object(
          'action', 'superseded', 'meta', jsonb_build_object('by_owner', true, 'via', 'correction',
                                                             'reason', v_reason))::text, true);
        update public.leave_requests set state = 'superseded' where id = v_old.id;
        perform app.comp_credit_settle(v_old.id, 'released');
      end loop;
    end if;
    if v_split then
      -- v2.0.1: a split day, ½ comp + ½ leave: two approved half days, born together (pair_id),
      -- the comp half drawing ½ credit valid on that date and using it at once.
      if v_day.is_day_off then
        perform app.fail('VALIDATION', 'That date is a day off. Comp leave is for a working day.');
      end if;
      v_pair := gen_random_uuid();
      perform set_config('app.audit_override', jsonb_build_object(
        'action', 'approved',
        'meta', jsonb_build_object('via', 'correction', 'reason', v_reason, 'comp', true, 'credit_days', 0.5,
                                   'pair_id', v_pair))::text, true);
      insert into public.leave_requests (
        member_id, type, start_date, end_date, reason, state, source, decided_by, decided_at, decision_reason,
        credit_days, half, pair_id)
      values (
        v_day.member_id, 'half_day', v_day.work_date, v_day.work_date, v_reason,
        'approved', 'owner', v_caller, now(), v_reason, 0.5, comp_half, v_pair)
      returning id into v_link;
      if app.comp_credit_draw(v_day.member_id, v_link, v_day.work_date, 0.5) > 0 then
        perform app.fail('VALIDATION', 'Comp leave needs an earned credit valid on that date. Grant one first from their Leave tab.');
      end if;
      perform app.comp_credit_settle(v_link, 'used');
      perform set_config('app.audit_override', jsonb_build_object(
        'action', 'approved', 'meta', jsonb_build_object('via', 'correction', 'reason', v_reason, 'pair_id', v_pair))::text, true);
      insert into public.leave_requests (
        member_id, type, start_date, end_date, reason, state, source, decided_by, decided_at, decision_reason,
        half, pair_id)
      values (
        v_day.member_id, 'half_day', v_day.work_date, v_day.work_date, v_reason,
        'approved', 'owner', v_caller, now(), v_reason,
        case comp_half when 'morning' then 'afternoon' else 'morning' end, v_pair)
      returning id into v_other;
      -- The morning's request is the day's first link, the afternoon's the second.
      if comp_half = 'morning' then
        v_second := v_other;
      else
        v_second := v_link;
        v_link := v_other;
      end if;
    elsif v_to = 'half_day' and not v_matches then
      -- v2.0.1: the half (and a ½ comp) is part of the Owner's choice.
      if comp_half is not null and v_day.is_day_off then
        perform app.fail('VALIDATION', 'That date is a day off. Comp leave is for a working day.');
      end if;
      perform set_config('app.audit_override', jsonb_build_object(
        'action', 'approved',
        'meta', jsonb_build_object('via', 'correction', 'reason', v_reason)
                || case when comp_half is not null then jsonb_build_object('comp', true, 'credit_days', 0.5)
                        else '{}'::jsonb end)::text, true);
      insert into public.leave_requests (
        member_id, type, start_date, end_date, reason, state, source, decided_by, decided_at, decision_reason,
        credit_days, half)
      values (
        v_day.member_id, 'half_day', v_day.work_date, v_day.work_date, v_reason,
        'approved', 'owner', v_caller, now(), v_reason,
        case when comp_half is not null then 0.5 end, half)
      returning id into v_link;
      if comp_half is not null then
        if app.comp_credit_draw(v_day.member_id, v_link, v_day.work_date, 0.5) > 0 then
          perform app.fail('VALIDATION', 'Comp leave needs an earned credit valid on that date. Grant one first from their Leave tab.');
        end if;
        perform app.comp_credit_settle(v_link, 'used');
      end if;
      v_second := null;
    elsif v_to in ('leave', 'half_day', 'comp_leave') and not v_matches then
      -- A leave status with no approved request of that type behind it gets one, born approved,
      -- so the calendar and availability stay right (WORKFLOWS §1).
      if v_to = 'comp_leave' then
        -- 3c review: the Owner's comp leave uses one of the member's credits, like everyone's
        -- (kickoff 3b decision 16): a full day, drawn oldest first over the credits valid on that
        -- date and used at once; none, or a day off, refuses the whole correction.
        if v_day.is_day_off then
          perform app.fail('VALIDATION', 'That date is a day off. Comp leave is for a working day.');
        end if;
        perform set_config('app.audit_override', jsonb_build_object(
          'action', 'approved',
          'meta', jsonb_build_object('via', 'correction', 'reason', v_reason, 'comp', true, 'credit_days', 1.0))::text, true);
        insert into public.leave_requests (
          member_id, type, start_date, end_date, reason, state, source, decided_by, decided_at, decision_reason, credit_days)
        values (
          v_day.member_id, 'comp_leave', v_day.work_date, v_day.work_date, v_reason,
          'approved', 'owner', v_caller, now(), v_reason, 1.0)
        returning id into v_link;
        if app.comp_credit_draw(v_day.member_id, v_link, v_day.work_date, 1.0) > 0 then
          perform app.fail('VALIDATION', 'Comp leave needs an earned credit valid on that date. Grant one first from their Leave tab.');
        end if;
        perform app.comp_credit_settle(v_link, 'used');
      else
        perform set_config('app.audit_override', jsonb_build_object(
          'action', 'approved', 'meta', jsonb_build_object('via', 'correction', 'reason', v_reason))::text, true);
        insert into public.leave_requests (
          member_id, type, start_date, end_date, reason, state, source, decided_by, decided_at, decision_reason)
        values (
          v_day.member_id, v_to::text::public.leave_type, v_day.work_date, v_day.work_date, v_reason,
          'approved', 'owner', v_caller, now(), v_reason)
        returning id into v_link;
      end if;
      v_second := null;
    end if;
    if v_link is distinct from v_day.leave_request_id and not v_split then
      v_second := null;
    end if;

    v_state := 'corrected';
    perform set_config('app.audit_override', jsonb_build_object(
      'action', 'corrected',
      'meta', jsonb_build_object('status', v_to, 'reason', v_reason, 'from_status', v_day.final_status))::text, true);
    update public.attendance_days
    set state = 'corrected', final_status = v_to, decided_by = v_caller, decided_at = now(),
        decision_reason = v_reason, proposed_by_system = false,
        -- Present on a date covered by the linked approved leave counts as a day worked, exactly
        -- like an approved "I'm working today" (owner decision 2026-09-26); the leave stays.
        worked_on_leave = (v_to = 'present' and v_req.id is not null and v_req.state = 'approved'
                           and v_day.work_date between v_req.start_date and v_req.end_date),
        leave_request_id = v_link, second_leave_request_id = v_second
    where id = v_day.id;
    perform app.attendance_event(v_day.id, 'corrected', v_day.final_status, v_to, v_reason, v_caller);
  end if;

  -- WORKFLOWS §9 "Attendance decided / corrected": the member (5.1).
  perform app.notify(array[v_day.member_id], 'attendance_decided',
    format('%s: %s %s', app.notify_date(v_day.work_date),
      case v_state when 'approved' then 'approved as' else 'corrected to' end,
      case when v_split then 'Full day: ½ comp + ½ leave'
           when v_to = 'present' then 'Present' when v_to = 'leave' then 'Leave'
           when v_to = 'half_day' then 'Half day' || coalesce(' (' || half || ' off)', '')
           when v_to = 'comp_leave' then 'Comp leave' else 'Absent' end),
    v_reason, '/leave/attendance', 'attendance_days', v_day.id,
    jsonb_build_object('day_id', v_day.id, 'work_date', v_day.work_date, 'status', v_to));
  return v_state;
end;
$$;
revoke all on function public.attendance_decide(uuid, text, public.day_status, text, text, text) from public, anon;
grant execute on function public.attendance_decide(uuid, text, public.day_status, text, text, text)
  to authenticated, service_role;
comment on function public.attendance_decide(uuid, text, public.day_status, text, text, text) is
  'attendance.decide (the Owner): approve a day awaiting review, or correct a day to a status with a '
  'reason. A leave status with no matching approved request gets one, born approved. v2.0.1: `half` '
  'names the half off of a half day; `comp_half` with half_day (the same half) makes it a ½ comp day '
  '(credit 0.5) and with leave makes a split day (½ comp + ½ leave: two approved half days sharing a '
  'pair_id, the day linking both). Comp draws the member''s credits valid on that date and uses them.';

-- 16. month_summary counts a split day by its halves --------------------------------------------
-- The body of 20260929053632_freelancers with one change: a decided `leave` day linking two half
-- days of which exactly one is comp (½ comp + ½ leave) counts ½ comp and ½ additional leave, and
-- is one of the half days (half_days), not a leave day. Two ordinary halves stay a leave day; two
-- comp halves are a comp_leave day (comp_full). days_worked is unchanged by either.
create or replace function public.month_summary(month date, member_id uuid default null)
returns table (
  id uuid,
  full_name text,
  role public.member_role,
  status public.member_status,
  working_days integer,
  days_worked numeric,
  present_days integer,
  leave_days integer,
  half_days integer,
  absent_days integer,
  comp_leave_days numeric,
  additional_leave numeric,
  days_off_worked integer,
  pending_days integer,
  overtime_notes integer,
  overtime_granted integer,
  credits_granted numeric,
  credits_used numeric,
  credits_expired numeric
)
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
  v_today date := app.today_ist();
  v_working integer;
begin
  select m.id, m.org_id into v_caller, v_org from app.current_member() m;
  if v_caller is null then
    perform app.fail('UNAUTHENTICATED', 'Your account is not active.');
  end if;
  if not app.has_permission('attendance.view_all') then
    perform app.fail('FORBIDDEN', 'The month summary is the Owner''s.');
  end if;
  if month_summary.month is null then
    perform app.fail('VALIDATION', 'Pick a month.');
  end if;

  v_first := date_trunc('month', month_summary.month::timestamp)::date;
  v_last := app.ist_month_end(v_first);
  select count(*)::integer into v_working
  from generate_series(v_first, v_last, interval '1 day') g(d)
  where app.is_working_day(g.d::date) is not false;

  return query
  with people as (
    select m.id, m.full_name, m.role, m.status
    from public.members m
    where m.org_id = v_org
      and (month_summary.member_id is null or m.id = month_summary.member_id)
      and m.status <> 'invited'
      and m.joined_at is not null
      and app.to_ist_date(m.joined_at) <= v_last
      and (m.deactivated_at is null or app.to_ist_date(m.deactivated_at) >= v_first)
      -- Whoever marks attendance (Admins and Staff): the Owner has no day, and a freelancer has
      -- none either (4A, kickoff 3b decisions 20 and 27).
      and m.engagement = 'permanent'
      and exists (select 1 from public.role_permissions rp
                  where rp.role = m.role and rp.permission = 'attendance.self')
  ),
  days as (
    select d.member_id,
           count(*) filter (where d.decided and d.final_status = 'present' and not d.is_day_off) as present,
           count(*) filter (where d.decided and d.final_status = 'present' and d.is_day_off) as off_worked,
           count(*) filter (where d.decided and d.final_status = 'leave' and not d.is_day_off and not d.split_mixed) as leave,
           -- v2.0.1: a split day of ½ comp + ½ leave is a half day of leave and half a day of comp.
           count(*) filter (where d.decided and d.final_status = 'leave' and not d.is_day_off and d.split_mixed) as split_mixed,
           count(*) filter (where d.decided and d.final_status = 'half_day' and not d.is_day_off and not d.comp_half) as half,
           count(*) filter (where d.decided and d.final_status = 'half_day' and not d.is_day_off and d.comp_half) as comp_half,
           count(*) filter (where d.decided and d.final_status = 'comp_leave' and not d.is_day_off) as comp_full,
           count(*) filter (where d.decided and d.final_status = 'absent' and not d.is_day_off) as absent,
           count(*) filter (where d.state = 'pending_review') as pending
    from (
      select a.member_id, a.final_status, a.is_day_off, a.state,
             a.state in ('approved', 'corrected') as decided,
             -- A half day that used a comp credit (3b.2) is comp leave, never additional leave.
             coalesce(r.credit_days is not null, false) as comp_half,
             -- v2.0.1: both halves off through two half days, exactly one of them comp.
             coalesce(a.second_leave_request_id is not null
                      and (r.credit_days is not null) <> (r2.credit_days is not null), false) as split_mixed
      from public.attendance_days a
      left join public.leave_requests r on r.id = a.leave_request_id
      left join public.leave_requests r2 on r2.id = a.second_leave_request_id
      where a.member_id in (select p.id from people p)
        and a.work_date between v_first and v_last
    ) d
    group by d.member_id
  ),
  notes as (
    select n.member_id,
           count(*) as total,
           count(*) filter (where n.decision = 'granted') as granted
    from public.extra_work_notes n
    where n.member_id in (select p.id from people p)
      and n.kind = 'overtime'
      and n.work_date between v_first and v_last
    group by n.member_id
  ),
  credits as (
    select c.member_id,
           sum(c.days) as granted,
           sum(c.used_days) as used,
           sum(case when c.expires_on < v_today then c.days - c.used_days - c.reserved_days else 0 end) as expired
    from public.comp_leave_credits c
    where c.member_id in (select p.id from people p)
      and c.revoked_at is null
      and c.granted_on between v_first and v_last
    group by c.member_id
  )
  select p.id,
         p.full_name,
         p.role,
         p.status,
         v_working,
         coalesce(d.present, 0) + 0.5 * (coalesce(d.half, 0) + coalesce(d.comp_half, 0)),
         coalesce(d.present, 0)::integer,
         coalesce(d.leave, 0)::integer,
         (coalesce(d.half, 0) + coalesce(d.split_mixed, 0))::integer,
         coalesce(d.absent, 0)::integer,
         coalesce(d.comp_full, 0) + 0.5 * (coalesce(d.comp_half, 0) + coalesce(d.split_mixed, 0)),
         coalesce(d.leave, 0) + 0.5 * (coalesce(d.half, 0) + coalesce(d.split_mixed, 0)) + coalesce(d.absent, 0),
         coalesce(d.off_worked, 0)::integer,
         coalesce(d.pending, 0)::integer,
         coalesce(n.total, 0)::integer,
         coalesce(n.granted, 0)::integer,
         coalesce(c.granted, 0),
         coalesce(c.used, 0),
         coalesce(c.expired, 0)
  from people p
  left join days d on d.member_id = p.id
  left join notes n on n.member_id = p.id
  left join credits c on c.member_id = p.id
  order by p.full_name, p.id;
end;
$$;
comment on function public.month_summary(date, uuid) is
  'attendance.view_all (the Owner). One row per permanent person who marks attendance (id = the '
  'member; freelancers are out, 4A), over the IST month of `month` (one person with member_id): '
  'working_days, days_worked (decided Present on a working day + ½ per decided half day), present / '
  'leave / half / absent days, comp_leave_days (comp_leave days + ½ per half day that used a comp '
  'credit + ½ per split day of ½ comp + ½ leave), additional_leave (leave + ½ × half days, split days '
  'included, + absent; comp leave never counts), days_off_worked, pending_days, overtime notes and '
  'grants, the month''s unrevoked comp credits granted / used / expired. Decided = approved | '
  'corrected. Live: no snapshot. No money. Notifies nobody.';

-- 17. The Approvals badge counts a waiting split day once ----------------------------------------
-- The body of 20261102144808_session_bundle_early_leaves with one change: pending_leave counts a
-- pair (leave_submit_split's two halves) as one request, as Approvals lists it.
create or replace function public.session_bundle()
returns table (
  not_noted integer,
  changes_requested integer,
  badge integer,
  to_decide integer,
  unread integer,
  pending_days integer,
  pending_requests integer,
  pending_notes integer,
  pending_claims integer,
  pending_early_leaves integer
)
language sql
stable
security invoker
set search_path = ''
as $$
  select tc.not_noted,
         tc.changes_requested,
         tc.badge,
         tc.to_decide,
         (select count(*) from public.notifications n where n.read_at is null)::integer,
         case when (select app.has_permission('attendance.decide')) then
           (select count(*) from public.attendance_days d where d.state = 'pending_review')::integer
         end,
         case when (select app.has_permission('attendance.decide')) then
           -- v2.0.1: a waiting split day (two halves sharing a pair_id) is one request.
           (select count(distinct coalesce(r.pair_id, r.id)) from public.leave_requests r
            where r.state = 'submitted' and r.source <> 'attendance')::integer
         end,
         case when (select app.has_permission('attendance.decide')) then
           (select count(*) from public.extra_work_notes x where x.state = 'submitted')::integer
         end,
         case when (select app.has_permission('attendance.decide'))
                and (select app.has_permission('expenses.decide')) then
           (select count(*) from public.expense_claims c where c.state = 'submitted')::integer
         end,
         case when (select app.has_permission('attendance.decide')) then
           (select count(*) from public.early_leave_requests e
            where e.state in ('waiting', 'left_unanswered'))::integer
         else 0
         end
  from (values (1)) as one (x)
  left join lateral public.task_counts() tc on true;
$$;
