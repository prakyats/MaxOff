-- 3c review (2026-09-29): the Owner's comp leave uses a credit.
--
-- attendance_decide(…, 'correct', …, 'comp_leave') and leave_owner_edit(…, type = 'comp_leave')
-- created an approved source = owner comp leave request with no credit behind it ("3cA later
-- items (a)"): the member routes have refused credit-free comp leave since 3c.1, the Owner's did
-- not. Kickoff 3b decision 16 (approval consumes a credit, oldest first; the leave date must be on
-- or before the credit's expiry), with 12, 14 and 15, is the rule for every comp leave; the two
-- docs lines that said the opposite were a 3b.2 deferral. From here both Owner routes draw the
-- member's free credits valid on that date, oldest first, and use them at once; with none the
-- whole call is refused (VALIDATION: "Comp leave needs an earned credit valid on that date. Grant
-- one first from their Leave tab."). A day off is refused ("That date is a day off. Comp leave is
-- for a working day."), an Owner edit into comp leave is one date ("Comp leave is one day at a
-- time. Edit it to a single date."), and these routes take a full day only (credit_days 1.0; the
-- half comp day stays leave_submit_comp's).
--
-- Release afterwards needs nothing new: the row carries credit_days = 1.0 and its
-- comp_leave_credit_uses rows, so leave_owner_cancel, leave_owner_edit (app.comp_credit_settle
-- 'released' on the superseded row runs before the new draw, so a moved comp day re-uses its own
-- credit), app.holiday_release_comp() and leave_decide(approve) of a cancellation release it as
-- they release a member's. Re-correcting a day that already has an approved comp request behind
-- it creates nothing and needs no credit; the approve branch and the linked-submitted-request
-- branch of attendance_decide are untouched.
--
-- Lock order unchanged (DATA-MODEL §3): the member's leave: lock before any row lock; the draw
-- locks credit rows after the day and request rows, the order leave_decide(approve) →
-- app.comp_credit_settle already uses. No grant or signature changes.

-- app.comp_credit_draw: the oldest-first loop of leave_submit_comp, as an internal helper ------------
-- (leave_submit_comp keeps its own copy: pgTAP 25 and 28 pin it; folding it onto this helper is
-- under PROGRESS Ideas.)
create function app.comp_credit_draw(p_member uuid, p_request_id uuid, p_on date, p_days numeric)
returns numeric
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_left numeric := p_days;
  v_credit public.comp_leave_credits;
  v_take numeric;
begin
  -- Oldest first (decision 16); the date counts, not the decision: only credits still valid on
  -- p_on can cover it.
  for v_credit in
    select c.* from public.comp_leave_credits c
    where c.member_id = p_member and c.revoked_at is null and c.expires_on >= p_on
      and c.days - c.used_days - c.reserved_days > 0
    order by c.granted_at, c.id
    for update
  loop
    exit when v_left <= 0;
    v_take := least(v_credit.days - v_credit.used_days - v_credit.reserved_days, v_left);
    perform set_config('app.audit_override', jsonb_build_object(
      'action', 'reserved', 'meta', jsonb_build_object('leave_request_id', p_request_id, 'days', v_take))::text, true);
    update public.comp_leave_credits set reserved_days = reserved_days + v_take where id = v_credit.id;
    perform set_config('app.audit_override', jsonb_build_object('action', 'reserved')::text, true);
    insert into public.comp_leave_credit_uses (credit_id, leave_request_id, days, state)
    values (v_credit.id, p_request_id, v_take, 'reserved');
    v_left := v_left - v_take;
  end loop;
  return v_left;
end;
$$;

revoke all on function app.comp_credit_draw(uuid, uuid, date, numeric) from public, authenticated;
grant execute on function app.comp_credit_draw(uuid, uuid, date, numeric) to service_role;

comment on function app.comp_credit_draw(uuid, uuid, date, numeric) is
  'Internal (3c review). Reserves p_days of the member''s free comp leave credits valid on p_on '
  '(unrevoked, expires_on >= p_on) for the request, oldest first: reserved_days on each credit, one '
  'comp_leave_credit_uses row (reserved) per credit drawn, audit reserved. Returns the days left '
  'undrawn: the caller refuses the request when it is above zero. The caller holds the member''s '
  'leave: lock; credit rows are locked here, after the day and request rows.';

-- attendance_decide: a correction to comp leave draws and uses a credit ------------------------------
-- The body of 20260926175013_correction_worked_on_leave with one change, inside the block "A
-- leave status with no approved request of that type behind it gets one".
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
  'linked submitted request is decided in the same call; a leave status with no approved request '
  'behind it creates one (source = owner). 3c review: a correction to comp_leave creates it with '
  'credit_days 1.0, draws the member''s free credits valid on that date oldest first '
  '(app.comp_credit_draw) and uses them at once; VALIDATION with no credit ("Grant one first from '
  'their Leave tab") or on a day off; ½ is not offered here. 2.4: takes the member''s leave: '
  'advisory lock before any row lock. Bulk = one call per row. Audit action: approved | '
  'corrected. Notifies the member (5.1).';

-- leave_owner_edit: an edit into comp leave is one working day and draws a credit --------------------
-- The body of 20260927192652_extra_work_comp_leave (same returns table (new_id, kept_dates)) with
-- the comp leave limits after leave_validate, credit_days on the insert and the draw after it.
create or replace function public.leave_owner_edit(
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
  v_comp boolean := leave_owner_edit.type = 'comp_leave';
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
  -- 3b.2: the Owner's replacement is owner-set leave; the comp credit goes back to the member
  -- (before the draw below, so a comp day moved to another date re-uses its own credit).
  perform app.comp_credit_settle(v_orig.id, 'released');

  perform set_config('app.audit_override', jsonb_build_object(
    'action', 'approved',
    'meta', jsonb_build_object('via', 'owner_edit', 'reason', v_reason)
            || case when v_comp then jsonb_build_object('comp', true, 'credit_days', 1.0) else '{}'::jsonb end)::text, true);
  insert into public.leave_requests (
    id, member_id, type, start_date, end_date, reason, state, source, supersedes_id, decided_by, decided_at, decision_reason,
    credit_days)
  values (
    v_new_id, v_orig.member_id, leave_owner_edit.type, leave_owner_edit.start_date, leave_owner_edit.end_date,
    v_reason, 'approved', 'owner', v_orig.id, v_caller, now(), v_reason,
    case when v_comp then 1.0 end)
  returning * into v_new;

  -- 3c review: the Owner's comp leave uses one of the member's credits valid on that date, oldest
  -- first, at once; none refuses the whole edit (the original then stays approved).
  if v_comp then
    if app.comp_credit_draw(v_new.member_id, v_new.id, v_new.start_date, 1.0) > 0 then
      perform app.fail('VALIDATION', 'Comp leave needs an earned credit valid on that date. Grant one first from their Leave tab.');
    end if;
    perform app.comp_credit_settle(v_new.id, 'used');
  end if;

  perform app.attendance_release_leave(v_orig, v_new.start_date, v_new.end_date);
  v_kept := app.attendance_apply_leave(v_new);
  return query select v_new.id, coalesce(v_kept, '{}'::date[]);
end;
$$;

comment on function public.leave_owner_edit(uuid, public.leave_type, date, date, text) is
  'attendance.decide, approved only: the original becomes superseded by a new source = owner, '
  'approved row with the given dates, then the same day corrections as leave_decide. An approved '
  'gate leave on the new dates is superseded first (2.2). CONFLICT, naming the request, while the '
  'member has another open request on those dates. 3b.2: the superseded row''s comp credit is '
  'released. 3c review: type = comp_leave is one date on a working day (VALIDATION otherwise), '
  'carries credit_days 1.0 and draws the member''s free credits valid on that date oldest first '
  '(app.comp_credit_draw, after the release above) and uses them at once; VALIDATION with none '
  '("Grant one first from their Leave tab"). 2.4: takes the member''s leave: advisory lock before '
  'any row lock; returns (new_id, kept_dates), the dates whose Owner decision was kept. Audit '
  'superseded + approved. Notifies the member (5.1).';
