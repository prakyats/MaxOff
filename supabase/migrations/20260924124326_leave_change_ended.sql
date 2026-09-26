-- 2.3 (owner decision 2026-09-24): a member may ask to change or cancel approved leave only while
-- it has not ended (end_date >= today, IST). Leave that is ongoing (started, not yet ended) stays
-- changeable. A leave that has fully passed is corrected by the Owner only, through the
-- attendance day, which already carries a reason and its own history (WORKFLOWS §1/§2).
-- Same signature, same grants; the one new refusal sits right after the state check.

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

revoke all on function public.leave_request_change(uuid, public.leave_type, date, date, text, boolean) from public, anon;
grant execute on function public.leave_request_change(uuid, public.leave_type, date, date, text, boolean)
  to authenticated, service_role;

comment on function public.leave_request_change(uuid, public.leave_type, date, date, text, boolean) is
  'attendance.self, own approved request that has not ended (end_date >= today IST; INVALID_STATE '
  'otherwise: past leave is the Owner''s, through the attendance day) → a new submitted row with '
  'supersedes_id (cancel = true copies the dates and sets requests_cancellation). One open change '
  'per request. The original stays approved until the Owner decides. Audit action: '
  'change_requested | cancellation_requested. Notifies the Owner (5.1).';
