-- 2.4 Owner review (WORKFLOWS §1/§2 "Settled in 2.4", DATA-MODEL §3).
--
-- 1. Lock order. attendance_decide locked day → request, while leave_decide / leave_owner_edit /
--    leave_owner_cancel locked request → (gate request →) days, and attendance_submit locked the
--    day before the leave: lock. Two actions on one person could deadlock. From here on every
--    function that writes a member's days or leave takes pg_advisory_xact_lock('leave:' || member)
--    BEFORE any row lock. A function that starts from a row id reads the row's member without a
--    lock (member_id never changes), takes the advisory lock, then locks the row and re-checks it.
--    leave_submit and leave_request_change already took it first and are unchanged.
-- 2. leave_owner_edit returns (new_id, kept_dates) like leave_decide.
-- 3. attendance_today(): the Owner's view of today for the card and the people board.
-- 4. attendance_touch takes the leave: lock before opening a day (touch: -> leave: -> rows).
-- 5. A partial index for the waiting days (the Approvals list and badge).
-- Bodies are otherwise the 2.1 / 2.2 ones; the lines that moved are marked "2.4".

-- attendance_submit ------------------------------------------------------------------------------
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
  'attendance.self. Today''s own day: awaiting_choice → pending_review, or approved + '
  'proposed_by_system → pending_review for present only ("I''m working today"). A leave choice '
  'creates leave_requests(source = attendance) for today and links it. Reason optional. for_date '
  '(2.2): a gate screen shown for another IST date is INVALID_STATE ("The day changed"). 2.4: takes '
  'the member''s leave: advisory lock before any row lock. Audit action: submitted. Notifies nobody '
  '(WORKFLOWS §9: the Owner''s Today counts are the digest).';

-- attendance_decide ------------------------------------------------------------------------------
create or replace function public.attendance_decide(
  day_id uuid, decision text, status public.day_status default null, reason text default null)
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

    if v_req.id is not null and v_req.state = 'submitted' then
      if v_req.type::text = v_to::text then
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

    if v_to in ('leave', 'half_day', 'comp_leave')
       and not (v_req.id is not null and v_req.state = 'approved' and v_req.type::text = v_to::text
                and v_day.work_date between v_req.start_date and v_req.end_date) then
      -- A leave status with no approved request of that type behind it gets one, born approved,
      -- so the calendar and availability stay right (WORKFLOWS §1).
      perform set_config('app.audit_override', jsonb_build_object(
        'action', 'approved', 'meta', jsonb_build_object('via', 'correction', 'reason', v_reason))::text, true);
      insert into public.leave_requests (
        member_id, type, start_date, end_date, reason, state, source, decided_by, decided_at, decision_reason)
      values (
        v_day.member_id, v_to::text::public.leave_type, v_day.work_date, v_day.work_date, v_reason,
        'approved', 'owner', v_caller, now(), v_reason)
      returning id into v_link;
    end if;

    v_state := 'corrected';
    perform set_config('app.audit_override', jsonb_build_object(
      'action', 'corrected',
      'meta', jsonb_build_object('status', v_to, 'reason', v_reason, 'from_status', v_day.final_status))::text, true);
    update public.attendance_days
    set state = 'corrected', final_status = v_to, decided_by = v_caller, decided_at = now(),
        decision_reason = v_reason, proposed_by_system = false,
        worked_on_leave = (v_to = 'present' and v_day.worked_on_leave),
        leave_request_id = v_link
    where id = v_day.id;
    perform app.attendance_event(v_day.id, 'corrected', v_day.final_status, v_to, v_reason, v_caller);
  end if;

  return v_state;
end;
$$;

comment on function public.attendance_decide(uuid, text, public.day_status, text) is
  'attendance.decide. approve: pending_review → approved with the submitted choice (or the '
  'proposed absent); worked_on_leave when Present was submitted on an approved-leave day. correct: '
  'any state → corrected with the given status, reason required. A linked submitted request is '
  'decided in the same call; a leave status with no approved request behind it creates one '
  '(source = owner). 2.4: takes the member''s leave: advisory lock before any row lock. Bulk = one '
  'call per row. Audit action: approved | corrected. Notifies the member (5.1).';

-- leave_withdraw ---------------------------------------------------------------------------------
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
  return 'withdrawn';
end;
$$;

comment on function public.leave_withdraw(uuid) is
  'attendance.self, own request, submitted → withdrawn. Never a source = attendance request: the '
  'attendance day is its single door. 2.4: takes the leave: advisory lock first. Audit action: '
  'withdrawn. Notifies nobody.';

-- leave_decide -----------------------------------------------------------------------------------
create or replace function public.leave_decide(request_id uuid, decision text, reason text default null)
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
  v_member uuid;
  v_req public.leave_requests;
  v_orig public.leave_requests;
  v_clash public.leave_requests;
  v_kept date[];
begin
  select r.caller_id, r.org_id into v_caller, v_org from app.attendance_require_decider() r;

  if decision is null or decision not in ('approve', 'reject') then
    perform app.fail('VALIDATION', 'The decision is approve or reject.');
  end if;

  -- 2.4: whose request it is (no lock), then that person's leave: lock, then the rows. Both
  -- branches, the cancellation one included, now run under it.
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

comment on function public.leave_decide(uuid, text, text) is
  'attendance.decide, submitted only, never source = attendance. reject needs a reason. approve '
  'supersedes (or, for a cancellation, cancels) the original, supersedes an approved gate leave '
  'on those dates (2.2), then "a later leave wins" over the member''s days in range and a '
  'cancelled leave hands today''s untouched derived day back to the gate. CONFLICT names an '
  'approved form or owner request on those dates. Returns (state, kept_dates): the dates of days '
  'the Owner decided (approved or corrected), which keep that decision. 2.4: takes the member''s '
  'leave: advisory lock before any row lock. Audit action: approved | rejected | cancelled '
  '(+ superseded | cancelled on the original). Notifies the member (5.1).';

-- leave_owner_edit -------------------------------------------------------------------------------
-- 2.4 returns (new_id, kept_dates), so the function is dropped and created again.
drop function public.leave_owner_edit(uuid, public.leave_type, date, date, text);
create function public.leave_owner_edit(
  request_id uuid, type public.leave_type, start_date date, end_date date, reason text default null)
returns table (new_id uuid, kept_dates date[])
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
  -- The later decision wins over a gate leave (WORKFLOWS §1, 2.2).
  perform app.leave_supersede_gate(v_orig.member_id, leave_owner_edit.start_date, leave_owner_edit.end_date,
                                   v_new_id, v_orig.id);
  -- A pending change or cancellation the person opened against it counts too: decide it first.
  v_clash := app.leave_clash(v_orig.member_id, leave_owner_edit.start_date, leave_owner_edit.end_date,
                             v_orig.id, false);
  if v_clash.id is not null then
    perform app.fail('CONFLICT', format('This person has another open request on these dates (%s, %s). Decide it first.',
                                        app.leave_clash_label(v_clash),
                                        case v_clash.state when 'submitted' then 'waiting' else 'approved' end));
  end if;

  perform set_config('app.audit_override', jsonb_build_object(
    'action', 'superseded', 'meta', jsonb_build_object('by_owner', true, 'reason', v_reason))::text, true);
  update public.leave_requests r set state = 'superseded' where r.id = v_orig.id;

  perform set_config('app.audit_override', jsonb_build_object(
    'action', 'approved', 'meta', jsonb_build_object('via', 'owner_edit', 'reason', v_reason))::text, true);
  insert into public.leave_requests (
    id, member_id, type, start_date, end_date, reason, state, source, supersedes_id, decided_by, decided_at, decision_reason)
  values (
    v_new_id, v_orig.member_id, leave_owner_edit.type, leave_owner_edit.start_date, leave_owner_edit.end_date,
    v_reason, 'approved', 'owner', v_orig.id, v_caller, now(), v_reason)
  returning * into v_new;

  perform app.attendance_release_leave(v_orig, v_new.start_date, v_new.end_date);
  v_kept := app.attendance_apply_leave(v_new);
  return query select v_new.id, coalesce(v_kept, '{}'::date[]);
end;
$$;

revoke all on function public.leave_owner_edit(uuid, public.leave_type, date, date, text) from public, anon;
grant execute on function public.leave_owner_edit(uuid, public.leave_type, date, date, text) to authenticated, service_role;

comment on function public.leave_owner_edit(uuid, public.leave_type, date, date, text) is
  'attendance.decide, approved only: the original becomes superseded by a new source = owner, '
  'approved row with the given dates, then the same day corrections as leave_decide. An approved '
  'gate leave on the new dates is superseded first (2.2). CONFLICT, naming the request, while the '
  'member has another open request on those dates (a pending change included: decide it first). '
  '2.4: takes the member''s leave: advisory lock before any row lock, and returns (new_id, '
  'kept_dates) like leave_decide. Audit action: superseded + approved. Notifies the member (5.1).';

-- leave_owner_cancel -----------------------------------------------------------------------------
create or replace function public.leave_owner_cancel(request_id uuid, reason text default null)
returns public.leave_state
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
begin
  select r.caller_id, r.org_id into v_caller, v_org from app.attendance_require_decider() r;

  -- 2.4: whose request it is (no lock), then that person's leave: lock, then the row.
  select r.member_id into v_member
  from public.leave_requests r
  join public.members m on m.id = r.member_id and m.org_id = v_org
  where r.id = request_id;
  if v_member is null then
    perform app.fail('NOT_FOUND', 'This leave request does not exist.');
  end if;
  perform pg_advisory_xact_lock(hashtext('leave:' || v_member::text));

  select r.* into v_orig from public.leave_requests r where r.id = request_id for update;
  if v_orig.state <> 'approved' then
    perform app.fail('INVALID_STATE', 'Only approved leave can be cancelled.');
  end if;
  if v_reason is null then
    perform app.fail('REASON_REQUIRED', 'Cancelling approved leave needs a reason.');
  end if;

  perform set_config('app.audit_override', jsonb_build_object(
    'action', 'cancelled', 'meta', jsonb_build_object('by_owner', true, 'reason', v_reason))::text, true);
  update public.leave_requests
  set state = 'cancelled', decided_by = v_caller, decided_at = now(), decision_reason = v_reason
  where id = v_orig.id;
  perform app.attendance_release_leave(v_orig, null, null);
  return 'cancelled';
end;
$$;

comment on function public.leave_owner_cancel(uuid, text) is
  'attendance.decide, approved only, reason required: → cancelled, and today''s untouched derived '
  'day goes back to awaiting_choice. 2.4: takes the member''s leave: advisory lock before any row '
  'lock. Audit action: cancelled. Notifies the member (5.1).';

-- attendance_today -------------------------------------------------------------------------------
create function public.attendance_today()
returns table (
  member_id uuid, full_name text, job_title text, started boolean, day_id uuid,
  state public.attendance_state, final_status public.day_status,
  submitted_choice public.attendance_choice, proposed_by_system boolean,
  first_login_at timestamptz, last_logout_at timestamptz, logout_not_recorded boolean,
  overtime_flag boolean, is_day_off boolean, on_leave boolean, leave_type public.leave_type)
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

  -- null from is_working_day() means "unknown", which is not a day off (as attendance_touch).
  v_day_off := app.is_working_day(v_today) is false;

  return query
  select m.id, m.full_name, j.name,
         app.to_ist_date(m.joined_at) < v_today,
         d.id, d.state, d.final_status, d.submitted_choice,
         coalesce(d.proposed_by_system, false), d.first_login_at, d.last_logout_at,
         coalesce(d.logout_not_recorded, false), coalesce(d.overtime_flag, false),
         coalesce(d.is_day_off, v_day_off),
         l.id is not null, l.type
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

revoke all on function public.attendance_today() from public, anon;
grant execute on function public.attendance_today() to authenticated, service_role;

comment on function public.attendance_today() is
  'attendance.view_all (FORBIDDEN otherwise). Read only. One row per active member who marks '
  'attendance (attendance.self: not the Owner) for today (IST): started = attendance has begun '
  '(the IST day after joined_at), the day row when there is one, is_day_off (the row''s, else '
  'the working-day rule), on_leave and leave_type from approved leave covering today. The Owner''s '
  'Today card and people board derive their buckets from it (WORKFLOWS §1 "Settled in 2.4").';

-- attendance_touch -------------------------------------------------------------------------------
-- 2.4 (architecture review): opening today's day reads approved leave, so when there is no day
-- yet touch also takes the member's leave: lock, after its own touch: lock and before any row
-- lock. Otherwise a first sign-in at the moment the Owner cancels today's leave could derive a
-- day from the leave being cancelled, and the gate would never ask. Body otherwise the 2.2 one.
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
    -- 2.4: a day derived from leave must not race the Owner's leave decisions (an approval or a
    -- cancellation covering today). Take the member's leave: lock (touch: -> leave: -> rows, the
    -- same order everywhere) and look again: the Owner's transaction has committed by now.
    perform pg_advisory_xact_lock(hashtext('leave:' || v_member.id::text));
    select d.* into v_day
    from public.attendance_days d
    where d.member_id = v_member.id and d.work_date = v_today
    for update;
  end if;

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
  'their joining day (IST date of joined_at), gets gate_required = false and no day. 2.4: opening '
  'a day takes the leave: lock first (touch: -> leave: -> rows). Audit action: opened | '
  'derived_from_leave | first_login. Notifies nobody.';

-- The Approvals list and badge count read the waiting days on every Owner page load (2.4).
create index attendance_days_pending_idx on public.attendance_days (work_date)
  where state = 'pending_review';
