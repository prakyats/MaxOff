-- v2.0 X3 (b), the Owner's Today board (2026-11-06; DATA-MODEL §1 "v2.0 X3"; the advisor on #89
-- approved the change, to be posted BEFORE push): attendance_hours_today() computed each member's
-- hours through app.attendance_hours(), which read the organisation's settings and ran
-- is_working_day() (three current_org_id() calls) for every member, although both are the same for
-- every member of the organisation on that day: 35 ms for 131 members after the helper change.
--
-- One body, no copy: app.attendance_hours_on(member, date, settings, working) is
-- app.attendance_hours's body with the settings and the day's working-day rule given, character for
-- character otherwise; app.attendance_hours(member, date) now reads them and calls it, so every
-- transition and job that calls it gets exactly what it got; attendance_hours_today() reads them
-- once per call and calls it for each member. Read-only: nothing is written, no rule changes
-- (attendance is still the Owner's to decide, invariant 7). attendance_hours_on is internal like
-- app.attendance_hours (service_role only). pgTAP 142 holds app.attendance_hours equal to a
-- reference copy of its old body for every member over 50 days (holiday, leave, half days, a
-- freelancer, joined today, a shoot, a stay-until, working hours on and off), and
-- attendance_hours_today() equal to its old body as the Owner.

create function app.attendance_hours_on(p_member uuid, p_date date, p_set public.org_settings, p_working boolean)
returns table(rules_on boolean, late_applies boolean, early_applies boolean, half text, start_at timestamp with time zone, late_after timestamp with time zone, end_at timestamp with time zone, end_source text, stay_until timestamp with time zone, shoot_end timestamp with time zone)
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_day public.attendance_days;
  v_leave public.leave_requests;
  v_on boolean;
  v_rules boolean;
  v_shoot timestamptz;
  v_end timestamptz;
  v_source text := 'work';
begin
  select d.* into v_day from public.attendance_days d where d.member_id = p_member and d.work_date = p_date;
  v_leave := app.leave_covering(p_member, p_date);
  v_on := coalesce(p_set.working_hours_on, false);
  -- No rules on a weekly off, a holiday, a day marked off, or a day of approved full or comp leave
  -- (null from is_working_day() means "unknown", which is not a day off).
  v_rules := v_on and p_working is not false and not coalesce(v_day.is_day_off, false)
             and (v_leave.id is null or v_leave.type = 'half_day');

  select max(t.event_end_at) into v_shoot
  from public.tasks t
  join public.task_assignees a on a.task_id = t.id and a.member_id = p_member and a.removed_at is null
  where t.event_date = p_date and t.event_end_at is not null and t.state <> 'cancelled' and t.archived_at is null;

  v_end := app.ist_day_start(p_date) + (p_set.work_end_time - time '00:00');
  -- A shoot only moves the end later, never earlier (owner 2026-10-07 (a)); then the Owner's Stay until.
  if v_shoot > v_end then
    v_end := v_shoot;
    v_source := 'shoot';
  end if;
  if v_day.stay_until > v_end then
    v_end := v_day.stay_until;
    v_source := 'stay';
  end if;

  return query select
    v_on,
    -- A morning half day (off in the morning) is never Late; an afternoon one never an early leave;
    -- a half day with no half recorded has neither rule (owner 2026-10-07 (c)).
    coalesce(v_rules and (v_leave.id is null or v_leave.half = 'afternoon'), false),
    coalesce(v_rules and (v_leave.id is null or v_leave.half = 'morning'), false),
    case when v_leave.type = 'half_day' then v_leave.half end,
    app.ist_day_start(p_date) + (p_set.work_start_time - time '00:00'),
    app.ist_day_start(p_date) + (p_set.work_start_time - time '00:00') + make_interval(mins => p_set.late_grace_minutes),
    v_end, v_source, v_day.stay_until, v_shoot;
end;
$function$;

revoke all on function app.attendance_hours_on(uuid, date, public.org_settings, boolean) from public, anon, authenticated;
grant execute on function app.attendance_hours_on(uuid, date, public.org_settings, boolean) to service_role;

create or replace function app.attendance_hours(p_member uuid, p_date date)
returns table(rules_on boolean, late_applies boolean, early_applies boolean, half text, start_at timestamp with time zone, late_after timestamp with time zone, end_at timestamp with time zone, end_source text, stay_until timestamp with time zone, shoot_end timestamp with time zone)
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_set public.org_settings;
begin
  select s.* into v_set
  from public.org_settings s join public.members m on m.org_id = s.org_id
  where m.id = p_member;
  return query select * from app.attendance_hours_on(p_member, p_date, v_set, app.is_working_day(p_date));
end;
$function$;

create or replace function public.attendance_hours_today()
 RETURNS TABLE(member_id uuid, full_name text, rules_on boolean, started_at timestamp with time zone, ended_at timestamp with time zone, late_minutes integer, late_reason text, end_at timestamp with time zone, end_source text, stay_until timestamp with time zone, early_leave_id uuid, early_leave_state text, early_leave_reason text, early_leave_requested_at timestamp with time zone, left_early boolean, ended_after_end boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
#variable_conflict use_column
declare
  v_caller uuid;
  v_org uuid;
  v_today date := app.to_ist_date(app.now());
  v_set public.org_settings;
  v_working boolean;
begin
  select m.id, m.org_id into v_caller, v_org from app.current_member() m;
  if v_caller is null then
    perform app.fail('UNAUTHENTICATED', 'Your account is not active.');
  end if;
  if not app.has_permission('attendance.view_all') then
    perform app.fail('FORBIDDEN', 'Everyone''s working hours are the Owner''s.');
  end if;
  -- v2.0 X3 (b): the organisation's settings and the day's working-day rule, once per call (the
  -- same for every member of the organisation), not once per member.
  select s.* into v_set from public.org_settings s where s.org_id = v_org;
  v_working := app.is_working_day(v_today);
  return query
  select m.id, m.full_name, h.rules_on, d.started_at, d.ended_at, d.late_minutes, d.late_reason,
         h.end_at, h.end_source, h.stay_until, e.id, e.state, e.reason, e.requested_at,
         coalesce(e.state in ('approved', 'left_unanswered', 'corrected'), false),
         coalesce(d.ended_at > h.end_at, false)
  from public.members m
  cross join lateral app.attendance_hours_on(m.id, v_today, v_set, v_working) h
  left join public.attendance_days d on d.member_id = m.id and d.work_date = v_today
  left join lateral (
    select x.* from public.early_leave_requests x where x.day_id = d.id order by x.requested_at desc limit 1) e on true
  where m.org_id = v_org and m.status = 'active' and m.engagement = 'permanent'
    and app.to_ist_date(m.joined_at) < v_today
    and exists (select 1 from public.role_permissions rp where rp.role = m.role and rp.permission = 'attendance.self')
  order by m.full_name, m.id;
end;
$function$
