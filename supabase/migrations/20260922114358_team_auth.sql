-- 1.2 Auth: session events are written by functions, and the first CEO is created by a
-- bootstrap function that only the service role may call (DATA-MODEL §1, WORKFLOWS §1,
-- ARCHITECTURE §5, ADR-0012).
--
-- session_events has no INSERT grant for the API role (1.1), so login and logout go through
-- public.session_login() / public.session_logout(): the caller must be an active member
-- (app.current_member()), which is what makes a deactivated or invited person unable to
-- record anything. There is no activity_log row for these: the session_events row is the
-- record (decided 2026-09-22).

-- session_login / session_logout ---------------------------------------------------------------

create or replace function public.session_login(user_agent text default null, ip_hash text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_member_id uuid;
  v_id uuid;
begin
  select m.id into v_member_id from app.current_member() m;
  if v_member_id is null then
    perform app.fail('UNAUTHENTICATED', 'Your account is not active.');
  end if;

  insert into public.session_events (member_id, kind, user_agent, ip_hash)
  values (v_member_id, 'login', nullif(left(user_agent, 512), ''), nullif(left(ip_hash, 128), ''))
  returning id into v_id;

  return v_id;
end;
$$;

-- Supabase's default privileges grant EXECUTE on public functions to anon too, so the revoke
-- names it (the pgTAP grant tests caught this).
revoke all on function public.session_login(text, text) from public, anon;
grant execute on function public.session_login(text, text) to authenticated, service_role;

comment on function public.session_login(text, text) is
  'Records session_events(login) for the calling active member. Called once per sign-in and '
  'after a password is set from a recovery link. UNAUTHENTICATED for anyone who is not an '
  'active member. 2.1''s attendance_touch() records the first login of a day on its own.';

create or replace function public.session_logout(user_agent text default null, ip_hash text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_member_id uuid;
  v_id uuid;
begin
  select m.id into v_member_id from app.current_member() m;
  if v_member_id is null then
    perform app.fail('UNAUTHENTICATED', 'Your account is not active.');
  end if;

  insert into public.session_events (member_id, kind, user_agent, ip_hash)
  values (v_member_id, 'logout', nullif(left(user_agent, 512), ''), nullif(left(ip_hash, 128), ''))
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.session_logout(text, text) from public, anon;
grant execute on function public.session_logout(text, text) to authenticated, service_role;

comment on function public.session_logout(text, text) is
  'Records session_events(logout) for the calling active member, before the auth session is '
  'ended. 2.1 extends it with attendance_days.last_logout_at (WORKFLOWS §1).';

-- bootstrap_ceo --------------------------------------------------------------------------------
-- Called by scripts/bootstrap-ceo.mjs with the service role after auth.admin.createUser().
-- Service role only: the API roles hold no EXECUTE, and the function refuses once any member
-- exists, so it can never be used to add a second CEO or to re-run on a live database.

create or replace function public.bootstrap_ceo(user_id uuid, email text, full_name text, org_name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text := lower(trim(email));
  v_name text := trim(full_name);
  v_org_id uuid;
  v_org_count bigint;
begin
  if exists (select 1 from public.members) then
    perform app.fail('CONFLICT', 'The team already has members; the bootstrap runs only once.');
  end if;
  if user_id is null or not exists (select 1 from auth.users u where u.id = user_id) then
    perform app.fail('NOT_FOUND', 'Create the auth user first (auth.admin.createUser).');
  end if;
  if v_email is null or position('@' in v_email) <= 1 then
    perform app.fail('VALIDATION', 'A valid email is required.');
  end if;
  -- members.email is the login identity (PERMISSIONS §2): it must be the auth user's email.
  if not exists (select 1 from auth.users u where u.id = user_id and lower(u.email) = v_email) then
    perform app.fail('VALIDATION', 'The email must match the auth user''s email.');
  end if;
  if v_name is null or v_name = '' then
    perform app.fail('VALIDATION', 'The CEO''s name is required.');
  end if;

  select count(*) into v_org_count from public.organizations;
  if v_org_count > 1 then
    perform app.fail('CONFLICT', 'Several organizations exist; the bootstrap needs exactly one or none.');
  elsif v_org_count = 1 then
    select o.id into v_org_id from public.organizations o;
  else
    if org_name is null or trim(org_name) = '' then
      perform app.fail('VALIDATION', 'The organization name is required when none exists yet.');
    end if;
    insert into public.organizations (name) values (trim(org_name)) returning id into v_org_id;
  end if;

  -- Runs as the owner, so the insert guard accepts an already-active member (the CEO sets a
  -- password from the printed recovery link; there is no invite to accept).
  insert into public.members (id, org_id, full_name, email, role, status, joined_at)
  values (user_id, v_org_id, v_name, v_email, 'ceo', 'active', now());

  return user_id;
end;
$$;

revoke all on function public.bootstrap_ceo(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.bootstrap_ceo(uuid, text, text, text) to service_role;

comment on function public.bootstrap_ceo(uuid, text, text, text) is
  'Creates the single organization (if none) and the first, active CEO member for an existing '
  'auth user. Service role only, and only while the team is empty. The members insert is '
  'audited by app.audit_row_change() with actor_id null (system).';
