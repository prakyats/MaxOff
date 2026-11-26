-- v7.5 Q2 (owner 2026-11-26): two-factor sign-in, **required for the Owner** (an authenticator app),
-- **optional for Admins**, not offered to Crew (docs/handoff/v7.5-plan.md §6; ARCHITECTURE §6).
-- The factors themselves are Supabase Auth's (auth.mfa_factors, TOTP); the app decides who must
-- pass the second step, from the verified token's `aal` claim:
--   - the Owner, when the environment requires it (OWNER_MFA_REQUIRED: on for production, off on
--     staging until its Owner's secret is in GitHub; the app's rule, no schema);
--   - anyone whose members.second_step is on (an Admin who turned it on, or the Owner after setting it
--     up), read with the member row the app already reads, so no request pays an extra read.
--
-- 1. members.second_step: whether this member's sign-in asks for the authenticator code.
-- 2. public.second_step_set(p_on): the caller's own flag, only from a session that has passed the
--    second step (aal2), so a password alone can never turn it off. Owner and Admin only. Audited
--    (the members audit trigger).
-- 3. public.session_early(): the member object carries second_step (one more key; every other key
--    keeps its shape, so a Worker on the previous release reads it as before).
--
-- Expand-only: a new column with a default, a new function, a function re-created with one more key.

-- 1. The flag --------------------------------------------------------------------------------------
alter table public.members add column second_step boolean not null default false;
comment on column public.members.second_step is
  'v7.5 Q2: this member''s sign-in asks for an authenticator code (Supabase Auth TOTP). Set only by '
  'second_step_set(), from a session that passed the second step. The Owner is asked whenever the '
  'environment requires it (OWNER_MFA_REQUIRED), whatever this says.';

-- 2. The member's own switch ---------------------------------------------------------------------
create function public.second_step_set(p_on boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me public.members;
begin
  select * into v_me from app.current_member();
  if v_me.id is null then
    perform app.fail('UNAUTHENTICATED');
  end if;
  if v_me.role not in ('owner', 'admin') then
    perform app.fail('FORBIDDEN', 'Two-step sign-in is for the Owner and Admins.');
  end if;
  if coalesce(auth.jwt() ->> 'aal', '') <> 'aal2' then
    perform app.fail('FORBIDDEN', 'Enter a code from your authenticator app first.');
  end if;
  if p_on is null then
    perform app.fail('VALIDATION');
  end if;
  update public.members set second_step = p_on
  where id = v_me.id and second_step is distinct from p_on;
end;
$$;
comment on function public.second_step_set(boolean) is
  'v7.5 Q2: the caller turns their own two-step sign-in on or off. The Owner and Admins only '
  '(FORBIDDEN for Crew), and only from a session that passed the second step (aal2; FORBIDDEN '
  'otherwise), so a password alone never changes it. The same value again changes nothing.';
revoke all on function public.second_step_set(boolean) from public, anon;
grant execute on function public.second_step_set(boolean) to authenticated, service_role;

-- 3. The shell's first read carries the flag ---------------------------------------------------------
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
           'second_step', m.second_step,
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
  'reads it, under RLS, or null; since v7.5 with second_step), own_day (attendance_own_today()''s row '
  'for an active permanent member with attendance.self, else null), own_day_refused '
  '(UNAUTHENTICATED / FORBIDDEN as that function would refuse, else null), push (push_status_own()''s '
  'row or null), own_hours (attendance_own_hours()''s row where own_day is answered, else null). '
  'Security invoker; own data only (auth.uid()).';
revoke all on function public.session_early() from public, anon, service_role;
grant execute on function public.session_early() to authenticated;
