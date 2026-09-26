-- Phase 2 review, fix 5 (2026-09-26, owner decision): when the Owner corrects a day covered by
-- approved leave to Present, worked_on_leave = true ("1 day worked"), exactly like an approved
-- "I'm working today"; the leave request stays approved and untouched, whatever the correction
-- (Absent included: the Owner cancels it from the person's Leave tab if it should go).
--
-- Before, the correct branch kept only a flag the day already had
-- (`v_to = 'present' and v_day.worked_on_leave`), so a person on approved leave who came in
-- and was corrected to Present read as Present with no day worked, and the day's audit said
-- nothing about the leave still standing. The body below is 2.4's with that one expression
-- changed; the lock order (leave: before any row lock) is unchanged.

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
        -- Present on a date covered by the linked approved leave counts as a day worked, exactly
        -- like an approved "I'm working today" (owner decision 2026-09-26); the leave stays.
        worked_on_leave = (v_to = 'present' and v_req.id is not null and v_req.state = 'approved'
                           and v_day.work_date between v_req.start_date and v_req.end_date),
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
  'any state → corrected with the given status, reason required; Present on a date covered by the '
  'linked approved leave sets worked_on_leave, and that leave is never touched (2026-09-26). A '
  'linked submitted request is '
  'decided in the same call; a leave status with no approved request behind it creates one '
  '(source = owner). 2.4: takes the member''s leave: advisory lock before any row lock. Bulk = one '
  'call per row. Audit action: approved | corrected. Notifies the member (5.1).';
