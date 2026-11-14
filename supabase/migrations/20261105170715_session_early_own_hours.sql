-- v2.0 X3 step 3 (2026-11-05; DATA-MODEL §1 "v2.0 X3"; advisor-approved on #89). Expand-only:
-- public.session_early() re-created (create or replace: the same name, no arguments, jsonb, the
-- same security invoker, stable, empty search_path, the same grants) with ONE more key,
-- own_hours: attendance_own_hours()'s row as an object, only where own_day is answered, else
-- null. Every existing key keeps its shape exactly, so a Worker still on the previous release
-- reads the answer as before while the deploy rolls out.

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

  return jsonb_build_object(
    'member', v_member,
    'own_day', v_own,
    'own_day_refused', v_refused,
    'push', v_push,
    'own_hours', v_own_hours
  );
end;
$$;

comment on function public.session_early() is
  'v2.0 X3: the shell''s first-byte reads in one: member (the caller''s own members row as the app '
  'reads it, under RLS, or null), own_day (attendance_own_today()''s row for an active permanent '
  'member with attendance.self, else null), own_day_refused (UNAUTHENTICATED / FORBIDDEN as that '
  'function would refuse, else null), push (push_status_own()''s row or null), own_hours '
  '(attendance_own_hours()''s row where own_day is answered, else null). Security invoker; own '
  'data only (auth.uid()).';

revoke all on function public.session_early() from public, anon, service_role;
grant execute on function public.session_early() to authenticated;
