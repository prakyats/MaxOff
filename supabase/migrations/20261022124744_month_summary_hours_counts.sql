-- v1.9 month counts per person (owner 2026-10-22 via the advisor, #89): month_summary_hours(month, member_id)
-- gains, per person, the late days with their total minutes, "left early, not answered", the approved early
-- leaves and the half days by half (morning / afternoon), beside the counts W0 gave it. The Owner only
-- (attendance.view_all); the screens are W4's (the person's Month tab, the Month report's columns).
--
-- The function's result columns grow, so it is dropped and re-created (a function's return type cannot be
-- replaced in place). It came with migration working_hours (v1.9 W0) on this unreleased branch and has no
-- caller yet; the old three counts keep their names and meaning. Expand-only for data: no table changes.
-- Append-only: never edit once applied.

drop function public.month_summary_hours(date, uuid);

create function public.month_summary_hours(month date, member_id uuid default null)
returns table (
  id uuid,
  late_days integer,
  early_leaves integer,
  left_unanswered integer,
  late_minutes integer,
  early_leaves_approved integer,
  half_days_morning integer,
  half_days_afternoon integer)
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
begin
  select m.id, m.org_id into v_caller, v_org from app.current_member() m;
  if v_caller is null then
    perform app.fail('UNAUTHENTICATED', 'Your account is not active.');
  end if;
  if not app.has_permission('attendance.view_all') then
    perform app.fail('FORBIDDEN', 'The month summary is the Owner''s.');
  end if;
  if month_summary_hours.month is null then
    perform app.fail('VALIDATION', 'Pick a month.');
  end if;
  v_first := date_trunc('month', month_summary_hours.month::timestamp)::date;
  v_last := app.ist_month_end(v_first);
  return query
  with people as (
    select m.id, m.full_name
    from public.members m
    where m.org_id = v_org
      and (month_summary_hours.member_id is null or m.id = month_summary_hours.member_id)
      and m.status <> 'invited' and m.joined_at is not null
      and app.to_ist_date(m.joined_at) <= v_last
      and (m.deactivated_at is null or app.to_ist_date(m.deactivated_at) >= v_first)
      and m.engagement = 'permanent'
      and exists (select 1 from public.role_permissions rp where rp.role = m.role and rp.permission = 'attendance.self')
  ),
  days as (
    select d.member_id,
           count(*) filter (where d.late_minutes is not null) as late_days,
           coalesce(sum(d.late_minutes), 0) as late_minutes,
           -- A half day the Owner settled (approved or corrected), by the half its leave records.
           count(*) filter (where d.state in ('approved', 'corrected') and d.final_status = 'half_day'
                              and l.half = 'morning') as half_morning,
           count(*) filter (where d.state in ('approved', 'corrected') and d.final_status = 'half_day'
                              and l.half = 'afternoon') as half_afternoon
    from public.attendance_days d
    left join public.leave_requests l on l.id = d.leave_request_id
    where d.member_id in (select p.id from people p) and d.work_date between v_first and v_last
    group by d.member_id
  ),
  early as (
    select e.member_id,
           count(*) filter (where e.state in ('approved', 'left_unanswered', 'corrected')) as early_leaves,
           count(*) filter (where e.left_at is not null) as left_unanswered,
           count(*) filter (where e.state = 'approved') as approved
    from public.early_leave_requests e
    join public.attendance_days d on d.id = e.day_id
    where e.member_id in (select p.id from people p) and d.work_date between v_first and v_last
    group by e.member_id
  )
  select p.id,
         coalesce(x.late_days, 0)::integer,
         coalesce(e.early_leaves, 0)::integer,
         coalesce(e.left_unanswered, 0)::integer,
         coalesce(x.late_minutes, 0)::integer,
         coalesce(e.approved, 0)::integer,
         coalesce(x.half_morning, 0)::integer,
         coalesce(x.half_afternoon, 0)::integer
  from people p
  left join days x on x.member_id = p.id
  left join early e on e.member_id = p.id
  order by p.full_name, p.id;
end;
$$;
comment on function public.month_summary_hours(date, uuid) is
  'v1.9, attendance.view_all (the Owner), read only, beside month_summary() and with its people (one row '
  'each, or the one member_id): late_days and late_minutes (their sum), early_leaves (approved, left '
  'unanswered or corrected), left_unanswered (ended after the wait with no answer, whatever the Owner '
  'decided later), early_leaves_approved (state approved), half_days_morning / half_days_afternoon '
  '(settled half days by the half their leave records; a half day with no half is in neither).';
revoke all on function public.month_summary_hours(date, uuid) from public, anon;
grant execute on function public.month_summary_hours(date, uuid) to authenticated, service_role;
