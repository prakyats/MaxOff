-- 2.2 Day gate hardening (WORKFLOWS §1/§2 "Settled in 2.2", DATA-MODEL §3). Owner decisions,
--   2026-09-23:
--   * attendance_touch() is serialised per member: two devices at once give one day and one
--     session_events(login) from the touch.
--   * Attendance starts the IST day after joined_at: on the joining day the touch records the
--     login and nothing else.
--   * "The later decision wins" in both orders: approving a form request (leave_decide) or an
--     Owner edit (leave_owner_edit) supersedes an APPROVED gate leave (source = attendance) on
--     those dates, and its day follows the new leave even when the type is the same. The CONFLICT
--     stays for form and owner requests only, and names the clashing leave.
--   * A day the Owner DECIDED (approved or corrected) keeps that decision, unless it still is the
--     superseded gate leave's own day (same status). "The leave wins" over a day still waiting
--     (pending_review), an unanswered day and a day derived from leave. leave_decide returns the
--     kept dates (kept_dates).
--   * attendance_submit() refuses a choice made on a gate screen shown for another IST date.
--   * attendance_flag_overtime() requires a reason (VALIDATION), as the form does.
-- Append-only: never edit once applied.

-- Helpers (internal: service_role only, like the 2.1 helpers; 00_core_base lists them) ----------

-- "Leave, 3 Oct 2026" / "Half day, 3 Oct 2026" / "Leave, 3 Oct 2026 to 5 Oct 2026": how a
-- CONFLICT names the clashing request so the Owner knows which one to cancel or edit.
create or replace function app.leave_clash_label(r public.leave_requests)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case r.type
           when 'leave' then 'Leave'
           when 'half_day' then 'Half day'
           when 'comp_leave' then 'Comp leave'
         end
         || ', ' || to_char(r.start_date, 'FMDD Mon YYYY')
         || case when r.end_date <> r.start_date then ' to ' || to_char(r.end_date, 'FMDD Mon YYYY') else '' end;
$$;

revoke all on function app.leave_clash_label(public.leave_requests) from public, anon, authenticated;
grant execute on function app.leave_clash_label(public.leave_requests) to service_role;

-- The first request of that member overlapping the range: approved only, or submitted as well.
create or replace function app.leave_clash(
  p_member_id uuid, p_start date, p_end date, p_exclude uuid, p_approved_only boolean)
returns public.leave_requests
language sql
stable
security definer
set search_path = ''
as $$
  select r.*
  from public.leave_requests r
  where r.member_id = p_member_id
    and (r.state = 'approved' or (not p_approved_only and r.state = 'submitted'))
    and r.id is distinct from p_exclude
    and r.start_date <= p_end and r.end_date >= p_start
  order by r.start_date, r.created_at
  limit 1;
$$;

revoke all on function app.leave_clash(uuid, date, date, uuid, boolean) from public, anon, authenticated;
grant execute on function app.leave_clash(uuid, date, date, uuid, boolean) to service_role;

-- "The later decision wins" over an approved gate leave (WORKFLOWS §1): the one place the rule
-- lives. Called by leave_decide() and leave_owner_edit() before their clash checks; the days that
-- linked the superseded request follow in app.attendance_apply_leave(). p_keep is a request the
-- caller supersedes itself (the Owner editing a gate leave directly), so it is superseded once,
-- with the caller's own audit label.
create or replace function app.leave_supersede_gate(
  p_member_id uuid, p_start date, p_end date, p_by uuid, p_keep uuid default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_gate public.leave_requests;
  v_count integer := 0;
begin
  for v_gate in
    select r.*
    from public.leave_requests r
    where r.member_id = p_member_id
      and r.source = 'attendance' and r.state = 'approved'
      and r.id is distinct from p_by and r.id is distinct from p_keep
      and r.start_date <= p_end and r.end_date >= p_start
    order by r.start_date
    for update
  loop
    perform set_config('app.audit_override', jsonb_build_object(
      'action', 'superseded', 'meta', jsonb_build_object('by', p_by, 'system', true))::text, true);
    update public.leave_requests set state = 'superseded' where id = v_gate.id;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

revoke all on function app.leave_supersede_gate(uuid, date, date, uuid, uuid) from public, anon, authenticated;
grant execute on function app.leave_supersede_gate(uuid, date, date, uuid, uuid) to service_role;

comment on function app.leave_supersede_gate(uuid, date, date, uuid, uuid) is
  'Every APPROVED source = attendance request of that member overlapping the range becomes '
  'superseded (audit meta {by, system: true}), except p_keep. Returns how many.';

-- "A later leave wins", 2.1 + 2.2. Returns the dates it left alone because the Owner decided them.
drop function app.attendance_apply_leave(public.leave_requests);
create function app.attendance_apply_leave(req public.leave_requests)
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
  return v_kept;
end;
$$;

revoke all on function app.attendance_apply_leave(public.leave_requests) from public, anon, authenticated;
grant execute on function app.attendance_apply_leave(public.leave_requests) to service_role;

comment on function app.attendance_apply_leave(public.leave_requests) is
  '"A later leave wins" over the member''s days in the request''s range (WORKFLOWS §1): days with '
  'no answer yet, days still waiting for review, days derived from leave and days of a superseded '
  'gate leave follow it. Returns the dates of days the Owner decided (approved or corrected), '
  'which keep that decision.';

-- attendance_touch -------------------------------------------------------------------------------
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
  v_leave public.leave_requests;
  v_day_off boolean;
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
    -- null from is_working_day() means "unknown", which is not a day off.
    v_day_off := app.is_working_day(v_today) is false;
    v_leave := app.leave_covering(v_member.id, v_today);

    if v_leave.id is not null then
      perform set_config('app.audit_override', jsonb_build_object(
        'action', 'derived_from_leave',
        'meta', jsonb_build_object('leave_request_id', v_leave.id))::text, true);
      insert into public.attendance_days (
        member_id, work_date, first_login_at, is_day_off, state, proposed_by_system, final_status,
        decided_at, leave_request_id)
      values (
        v_member.id, v_today, now(), v_day_off, 'approved', true, v_leave.type::text::public.day_status,
        now(), v_leave.id)
      on conflict on constraint attendance_days_member_date_key do nothing
      returning * into v_day;
    else
      perform set_config('app.audit_override', jsonb_build_object('action', 'opened')::text, true);
      insert into public.attendance_days (member_id, work_date, first_login_at, is_day_off)
      values (v_member.id, v_today, now(), v_day_off)
      on conflict on constraint attendance_days_member_date_key do nothing
      returning * into v_day;
    end if;

    if v_day.id is null then
      -- Another writer (the 23:59 job, 2.5) won the race: nothing was written, so the label must
      -- not linger.
      perform set_config('app.audit_override', '', true);
      select d.* into v_day
      from public.attendance_days d
      where d.member_id = v_member.id and d.work_date = v_today;
    elsif v_day.state = 'approved' then
      perform app.attendance_event(v_day.id, 'derived_from_leave', null, v_day.final_status, null, null);
    end if;
  elsif v_day.first_login_at is null then
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
  'Admin or Staff member (derived from approved leave when there is one, otherwise '
  'awaiting_choice) and answers whether the gate must ask. Idempotent. The Owner, and anyone on '
  'their joining day (IST date of joined_at), gets gate_required = false and no day. Audit action: '
  'opened | derived_from_leave | first_login. Notifies nobody.';

-- attendance_submit ------------------------------------------------------------------------------
-- 2.2 adds for_date: the IST date the gate screen was shown for.
drop function public.attendance_submit(public.attendance_choice, text);
create function public.attendance_submit(
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

  if for_date is not null and for_date <> app.today_ist() then
    perform app.fail('INVALID_STATE', 'The day changed. Choose again for today.');
  end if;

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
    perform pg_advisory_xact_lock(hashtext('leave:' || v_caller::text));
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

revoke all on function public.attendance_submit(public.attendance_choice, text, date) from public, anon;
grant execute on function public.attendance_submit(public.attendance_choice, text, date) to authenticated, service_role;

comment on function public.attendance_submit(public.attendance_choice, text, date) is
  'attendance.self. Today''s own day: awaiting_choice → pending_review, or approved + '
  'proposed_by_system → pending_review for present only ("I''m working today"). A leave choice '
  'creates leave_requests(source = attendance) for today and links it. Reason optional. for_date '
  '(2.2): a gate screen shown for another IST date is INVALID_STATE ("The day changed"). Audit '
  'action: submitted. Notifies nobody (WORKFLOWS §9: the Owner''s Today counts are the digest).';

-- leave_decide -----------------------------------------------------------------------------------
-- 2.2 returns (state, kept_dates) and supersedes approved gate leave before the clash check.
drop function public.leave_decide(uuid, text, text);
create function public.leave_decide(request_id uuid, decision text, reason text default null)
returns table (state public.leave_state, kept_dates date[])
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_caller uuid;
  v_org uuid;
  v_reason text := app.clean_reason(reason);
  v_req public.leave_requests;
  v_orig public.leave_requests;
  v_clash public.leave_requests;
  v_kept date[];
begin
  select r.caller_id, r.org_id into v_caller, v_org from app.attendance_require_decider() r;

  if decision is null or decision not in ('approve', 'reject') then
    perform app.fail('VALIDATION', 'The decision is approve or reject.');
  end if;

  select r.* into v_req
  from public.leave_requests r
  join public.members m on m.id = r.member_id and m.org_id = v_org
  where r.id = leave_decide.request_id
  for update of r;
  if v_req.id is null then
    perform app.fail('NOT_FOUND', 'This leave request does not exist.');
  end if;
  if v_req.source = 'attendance' then
    perform app.fail('INVALID_STATE', 'Decide this one from the attendance day: it was made at the gate.');
  end if;
  if v_req.state <> 'submitted' then
    perform app.fail('INVALID_STATE', 'This request has already been decided.');
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

    perform set_config('app.audit_override', jsonb_build_object(
      'action', 'cancelled', 'meta', jsonb_build_object('reason', v_reason))::text, true);
    update public.leave_requests r
    set state = 'cancelled', decided_by = v_caller, decided_at = now(), decision_reason = v_reason
    where r.id = v_req.id;
    return query select 'cancelled'::public.leave_state, '{}'::date[];
    return;
  end if;

  perform pg_advisory_xact_lock(hashtext('leave:' || v_req.member_id::text));
  if v_orig.id is not null and v_orig.state = 'approved' then
    perform set_config('app.audit_override', jsonb_build_object(
      'action', 'superseded', 'meta', jsonb_build_object('by', v_req.id))::text, true);
    update public.leave_requests r set state = 'superseded' where r.id = v_orig.id;
    perform app.attendance_release_leave(v_orig, v_req.start_date, v_req.end_date);
  end if;
  -- The later decision wins over a gate leave (WORKFLOWS §1, 2.2).
  perform app.leave_supersede_gate(v_req.member_id, v_req.start_date, v_req.end_date, v_req.id);
  -- Approved form or owner leave that already covers these dates (a race at submit time, or an
  -- Owner correction since): the Owner cancels or edits that one first. Submitted overlaps are
  -- not checked here; "the leave wins" supersedes a gate request, and the Owner rejects the rest.
  v_clash := app.leave_clash(v_req.member_id, v_req.start_date, v_req.end_date, v_req.id, true);
  if v_clash.id is not null then
    perform app.fail('CONFLICT', format('Approved leave (%s) already covers these dates. Cancel or edit it first.',
                                        app.leave_clash_label(v_clash)));
  end if;

  perform set_config('app.audit_override', jsonb_build_object(
    'action', 'approved', 'meta', jsonb_build_object('reason', v_reason))::text, true);
  update public.leave_requests r
  set state = 'approved', decided_by = v_caller, decided_at = now(), decision_reason = v_reason
  where r.id = v_req.id
  returning r.* into v_req;
  v_kept := app.attendance_apply_leave(v_req);
  return query select 'approved'::public.leave_state, v_kept;
end;
$$;

revoke all on function public.leave_decide(uuid, text, text) from public, anon;
grant execute on function public.leave_decide(uuid, text, text) to authenticated, service_role;

comment on function public.leave_decide(uuid, text, text) is
  'attendance.decide, submitted only, never source = attendance. reject needs a reason. approve '
  'supersedes (or, for a cancellation, cancels) the original, supersedes an approved gate leave '
  'on those dates (2.2), then "a later leave wins" over the member''s days in range and a '
  'cancelled leave hands today''s untouched derived day back to the gate. CONFLICT names an '
  'approved form or owner request on those dates. Returns (state, kept_dates): the dates of days '
  'the Owner decided (approved or corrected), which keep that decision. Audit action: approved | rejected | cancelled '
  '(+ superseded | cancelled on the original). Notifies the member (5.1).';

-- leave_owner_edit -------------------------------------------------------------------------------
create or replace function public.leave_owner_edit(
  request_id uuid, type public.leave_type, start_date date, end_date date, reason text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid;
  v_org uuid;
  v_reason text := app.clean_reason(reason);
  v_orig public.leave_requests;
  v_new public.leave_requests;
  v_new_id uuid := gen_random_uuid();
  v_clash public.leave_requests;
begin
  select r.caller_id, r.org_id into v_caller, v_org from app.attendance_require_decider() r;

  select r.* into v_orig
  from public.leave_requests r
  join public.members m on m.id = r.member_id and m.org_id = v_org
  where r.id = request_id
  for update of r;
  if v_orig.id is null then
    perform app.fail('NOT_FOUND', 'This leave request does not exist.');
  end if;
  if v_orig.state <> 'approved' then
    perform app.fail('INVALID_STATE', 'Only approved leave can be edited.');
  end if;
  perform app.leave_validate(type, start_date, end_date, null);
  perform pg_advisory_xact_lock(hashtext('leave:' || v_orig.member_id::text));
  -- The later decision wins over a gate leave (WORKFLOWS §1, 2.2).
  perform app.leave_supersede_gate(v_orig.member_id, start_date, end_date, v_new_id, v_orig.id);
  -- A pending change or cancellation the person opened against it counts too: decide it first.
  v_clash := app.leave_clash(v_orig.member_id, start_date, end_date, v_orig.id, false);
  if v_clash.id is not null then
    perform app.fail('CONFLICT', format('This person has another open request on these dates (%s, %s). Decide it first.',
                                        app.leave_clash_label(v_clash),
                                        case v_clash.state when 'submitted' then 'waiting' else 'approved' end));
  end if;

  perform set_config('app.audit_override', jsonb_build_object(
    'action', 'superseded', 'meta', jsonb_build_object('by_owner', true, 'reason', v_reason))::text, true);
  update public.leave_requests set state = 'superseded' where id = v_orig.id;

  perform set_config('app.audit_override', jsonb_build_object(
    'action', 'approved', 'meta', jsonb_build_object('via', 'owner_edit', 'reason', v_reason))::text, true);
  insert into public.leave_requests (
    id, member_id, type, start_date, end_date, reason, state, source, supersedes_id, decided_by, decided_at, decision_reason)
  values (
    v_new_id, v_orig.member_id, type, start_date, end_date, v_reason, 'approved', 'owner', v_orig.id, v_caller, now(), v_reason)
  returning * into v_new;

  perform app.attendance_release_leave(v_orig, v_new.start_date, v_new.end_date);
  perform app.attendance_apply_leave(v_new);
  return v_new.id;
end;
$$;

comment on function public.leave_owner_edit(uuid, public.leave_type, date, date, text) is
  'attendance.decide, approved only: the original becomes superseded by a new source = owner, '
  'approved row with the given dates, then the same day corrections as leave_decide. An approved '
  'gate leave on the new dates is superseded first (2.2). CONFLICT, naming the request, while the '
  'member has another open request on those dates (a pending change included: decide it first). '
  'Returns the new id. Audit action: superseded + approved. Notifies the member (5.1).';

-- attendance_flag_overtime -----------------------------------------------------------------------
-- 2.2: overtime is flagged "with a reason" (WORKFLOWS §1): the database refuses an empty one, as
-- the form does.
create or replace function public.attendance_flag_overtime(day_id uuid, reason text default null)
returns boolean
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
    perform app.fail('VALIDATION', 'Say what kept you: overtime needs a reason.');
  end if;

  select d.* into v_day
  from public.attendance_days d
  where d.id = day_id and d.member_id = v_caller
  for update;
  if v_day.id is null then
    perform app.fail('NOT_FOUND', 'This attendance day is not yours.');
  end if;

  perform set_config('app.audit_override', jsonb_build_object(
    'action', 'overtime_flagged', 'meta', jsonb_build_object('reason', v_reason))::text, true);
  update public.attendance_days set overtime_flag = true, overtime_reason = v_reason where id = v_day.id;
  perform app.attendance_event(v_day.id, 'overtime_flagged', null, null, v_reason, v_caller);
  return true;
end;
$$;

comment on function public.attendance_flag_overtime(uuid, text) is
  'attendance.self, own day, any state: overtime_flag with a REQUIRED reason (VALIDATION when '
  'empty, 2.2; a second call replaces the reason). Notice only: no approval, no notification. '
  'Audit action: overtime_flagged.';
