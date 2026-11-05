-- v2.0 X3 step 3, /my-day (2026-11-05; DATA-MODEL §1 "v2.0 X3"; review on #89 before push).
-- Expand-only: two functions re-created (create or replace: the same names, arguments, jsonb
-- result, security invoker, stable, empty search_path and grants), each with ONE more key and
-- every existing key unchanged, so the previous Worker reads them as before during a deploy.
--   session_early(): freelancers, the members the caller coordinates now (the
--     coordinated_freelancers read, to_at null), so /my-day, /tasks and /me do not read it apart.
--   own_week(): leave, the caller's own approved leave touching the window
--     (listApprovedLeaveBetween), so the week strip's own leave rides in the same read.

create or replace function public.session_early()
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_member jsonb;
  v_status public.member_status;
  v_engagement public.engagement;
  v_own jsonb := null;
  v_own_hours jsonb := null;
  v_freelancers jsonb;
  v_refused text := null;
  v_push jsonb := null;
begin
  -- The member row as the app reads it (getSessionState), under RLS: own row only.
  select jsonb_build_object(
           'id', m.id,
           'email', m.email,
           'full_name', m.full_name,
           'role', m.role,
           'status', m.status,
           'avatar_file_id', m.avatar_file_id,
           'job_title', case when li.id is null then null else jsonb_build_object('name', li.name) end
         ),
         m.status, m.engagement
    into v_member, v_status, v_engagement
  from public.members m
  left join public.list_items li on li.id = m.job_title_id
  where m.id = auth.uid();

  -- The own day exactly when attendance_own_today() answers; otherwise the refusal it would raise
  -- (app.attendance_require_self): never raised here, so the other two parts still answer.
  if v_status is distinct from 'active' or not exists (select 1 from app.current_member()) then
    v_refused := 'UNAUTHENTICATED';
  elsif not app.has_permission('attendance.self') or v_engagement <> 'permanent' then
    v_refused := 'FORBIDDEN';
  else
    select to_jsonb(t) into v_own from public.attendance_own_today() t limit 1;
    -- v2.0 X3: the own working hours (the strip) ride along, only where the own day is answered.
    select to_jsonb(h) into v_own_hours from public.attendance_own_hours() h limit 1;
  end if;

  select to_jsonb(p) into v_push from public.push_status_own() p limit 1;

  -- v2.0 X3: the freelancers the caller coordinates now (the coordinated_freelancers read, to_at
  -- null), under the same view and RLS.
  select coalesce(jsonb_agg(f.member_id order by f.member_id), '[]'::jsonb) into v_freelancers
  from public.coordinated_freelancers f
  where f.to_at is null and f.member_id is not null;

  return jsonb_build_object(
    'member', v_member,
    'own_day', v_own,
    'own_day_refused', v_refused,
    'push', v_push,
    'own_hours', v_own_hours,
    'freelancers', v_freelancers
  );
end;
$$;

comment on function public.session_early() is
  'v2.0 X3: the shell''s first-byte reads in one: member (the caller''s own members row as the app '
  'reads it, under RLS, or null), own_day (attendance_own_today()''s row for an active permanent '
  'member with attendance.self, else null), own_day_refused (UNAUTHENTICATED / FORBIDDEN as that '
  'function would refuse, else null), push (push_status_own()''s row or null), own_hours '
  '(attendance_own_hours()''s row where own_day is answered, else null), freelancers (the member '
  'ids the caller coordinates now). Security invoker; own data only (auth.uid()).';

revoke all on function public.session_early() from public, anon, service_role;
grant execute on function public.session_early() to authenticated;

create or replace function public.own_week(from_date date, to_date date)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  if from_date is null or to_date is null or to_date < from_date or to_date - from_date > 61 then
    perform app.fail('VALIDATION', 'The window runs from_date to to_date, at most 62 days.');
  end if;
  return jsonb_build_object(
    'holidays', coalesce((
      select jsonb_agg(jsonb_build_object('id', h.id, 'date', h.date, 'name', h.name) order by h.date, h.id)
      from public.holidays h
      where h.date between from_date and to_date), '[]'::jsonb),
    'events', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', t.id,
               'title', t.title,
               'state', t.state,
               'event_date', t.event_date,
               'event_start_at', t.event_start_at,
               'event_end_at', t.event_end_at,
               'location', t.location,
               'client_id', t.client_id,
               'task_type_id', t.task_type_id,
               'primary_owner_id', t.primary_owner_id,
               'assignee_ids', coalesce((
                 select jsonb_agg(a.member_id order by a.member_id)
                 from public.task_assignees a
                 where a.task_id = t.id and a.removed_at is null), '[]'::jsonb))
             order by t.event_date, t.event_start_at nulls first, t.id)
      from public.tasks t
      where t.event_date between from_date and to_date and t.state <> 'cancelled'), '[]'::jsonb),
    -- v2.0 X3: the caller's own approved leave touching the window (listApprovedLeaveBetween).
    'leave', coalesce((
      select jsonb_agg(jsonb_build_object('type', l.type, 'start_date', l.start_date, 'end_date', l.end_date)
                       order by l.start_date, l.id)
      from public.leave_requests l
      where l.member_id = auth.uid() and l.state = 'approved'
        and l.start_date <= to_date and l.end_date >= from_date), '[]'::jsonb)
  );
end;
$$;

comment on function public.own_week(date, date) is
  'v2.0 X3: the week strip''s holidays and event tasks in [from_date, to_date] (at most 62 days, '
  'else VALIDATION) in one read: holidays {id, date, name} by date; tasks with an event date in the '
  'window, not cancelled, {id, title, state, event_date, event_start_at, event_end_at, location, '
  'client_id, task_type_id, primary_owner_id, assignee_ids (current)} by event date and start; '
  'leave, the caller''s own approved leave touching the window {type, start_date, end_date}. '
  'Security invoker: RLS decides every row, as for the API reads.';

revoke all on function public.own_week(date, date) from public, anon, service_role;
grant execute on function public.own_week(date, date) to authenticated;
