-- 5A combined architecture + security review, the fix pass (2026-10-01). Expand-only: one new
-- table (local-only switches), one new function (the test push's cooldown), and existing
-- functions re-created with their latest bodies and the same signatures.
--
--   M2  push_subscriptions: INSERT and UPDATE revoked from authenticated (a direct insert skipped
--       every check of push_subscription_upsert: any http URL, any number of rows, which the
--       dispatcher would then POST to). The upsert takes https endpoints on a DNS host only, http
--       on the loopback host only where app.local_flags says so (the local seed), validates the
--       keys strictly, and caps a member at 10 active rows.
--   M1  the same strict key check (a malformed p256dh/auth threw inside the dispatcher).
--   S2  push_test_claim(): "Send a test notification" refuses while a test is under 30 s old.
--   M4  the four guard messages that still said "Staff" say "Crew" (CLAUDE.md invariant 1: the
--       role is shown as Crew; SQL text cannot read ROLE_LABELS, so it is written by hand).

-- 1. Local-only switches ----------------------------------------------------------------------------
create table app.local_flags (
  flag text primary key check (flag in ('push_loopback_endpoints')),
  set_at timestamptz not null default now()
);
comment on table app.local_flags is
  '5A review fixes: switches that exist only on a local or CI database. Written by '
  'supabase/seed.sql, which no hosted project runs (deploy runs db push only), so staging and '
  'production never hold a row. Read only inside SECURITY DEFINER functions. '
  '''push_loopback_endpoints'': push_subscription_upsert also takes http endpoints on the loopback '
  'host (the e2e fake push service).';
alter table app.local_flags enable row level security;
revoke all on app.local_flags from public, anon, authenticated;

create or replace function app.local_flag(p_flag text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from app.local_flags f where f.flag = p_flag);
$$;
comment on function app.local_flag(text) is
  '5A review fixes: whether a local-only switch is on (app.local_flags). Never true on a hosted '
  'project.';
revoke all on function app.local_flag(text) from public, anon, authenticated;
grant execute on function app.local_flag(text) to service_role;

-- 2. Strict subscription keys and endpoints ---------------------------------------------------------
-- A base64url (no padding) value that decodes to exactly p_length bytes; with p_point, the first
-- byte is 0x04 (an uncompressed P-256 point, RFC 8291 §3.1). p256dh: 65 bytes; auth: 16.
create or replace function app.push_key_valid(p_value text, p_length integer, p_point boolean)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_bytes bytea;
begin
  if p_value is null or p_value !~ '^[A-Za-z0-9_-]+$' or length(p_value) <> ceil(p_length * 4 / 3.0) then
    return false;
  end if;
  v_bytes := decode(rpad(translate(p_value, '-_', '+/'), ((length(p_value) + 3) / 4) * 4, '='), 'base64');
  return length(v_bytes) = p_length and (not p_point or get_byte(v_bytes, 0) = 4);
end;
$$;
comment on function app.push_key_valid(text, integer, boolean) is
  '5A review M1: a Web Push key as the browser hands it over: base64url without padding, '
  'decoding to p_length bytes (p256dh 65 starting 0x04, auth 16).';
revoke all on function app.push_key_valid(text, integer, boolean) from public, anon;
grant execute on function app.push_key_valid(text, integer, boolean) to authenticated, service_role;

-- An endpoint the dispatcher may POST to: https on a DNS name (never an IP literal, localhost or
-- a private suffix: every push service is a public DNS name), or, only where the local switch is
-- on, plain http on the loopback host (the e2e fake push service).
create or replace function app.push_endpoint_valid(p_endpoint text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_host text;
begin
  if p_endpoint is null or length(p_endpoint) > 2048 then
    return false;
  end if;
  if p_endpoint ~ '^http://(127\.0\.0\.1|localhost)(:[0-9]{1,5})?/' then
    return app.local_flag('push_loopback_endpoints');
  end if;
  if p_endpoint !~ '^https://([A-Za-z0-9-]+\.)+[A-Za-z][A-Za-z0-9-]*(:[0-9]{1,5})?/' then
    return false;
  end if;
  v_host := lower(substring(p_endpoint from '^https://([^/:]+)'));
  return v_host !~ '(^|\.)(localhost|local|internal|localdomain|home|lan)$';
end;
$$;
comment on function app.push_endpoint_valid(text) is
  '5A review M2: https on a public DNS name (no IP literal, no localhost / .local / .internal); '
  'http on the loopback host only while app.local_flags holds push_loopback_endpoints.';
revoke all on function app.push_endpoint_valid(text) from public, anon;
grant execute on function app.push_endpoint_valid(text) to authenticated, service_role;

-- 3. push_subscription_upsert: the latest body (20261001003242) with the checks and the cap --------
create or replace function public.push_subscription_upsert(
  endpoint text, p256dh text, auth text,
  platform text default 'other', is_standalone boolean default false,
  label text default null, user_agent text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller public.members;
  v_endpoint text := btrim(coalesce(push_subscription_upsert.endpoint, ''));
  v_id uuid;
begin
  select m.* into v_caller from app.current_member() m;
  if v_caller.id is null then
    perform app.fail('UNAUTHENTICATED', 'Your account is not active.');
  end if;
  if v_caller.engagement <> 'permanent' then
    perform app.fail('FORBIDDEN', 'Your account cannot receive push notifications.');
  end if;
  -- https on a public DNS name, as every push service is; plain http on the loopback host only on
  -- a local database (app.local_flags, written by the seed), where the e2e fake push service runs.
  if not app.push_endpoint_valid(v_endpoint) then
    perform app.fail('VALIDATION', 'The push endpoint must be an https URL.');
  end if;
  if nullif(btrim(coalesce(push_subscription_upsert.p256dh, '')), '') is null
     or nullif(btrim(coalesce(push_subscription_upsert.auth, '')), '') is null then
    perform app.fail('VALIDATION', 'The subscription keys are missing.');
  end if;
  -- The keys exactly as the browser makes them (5A review M1): anything else would only fail later,
  -- inside the dispatcher.
  if not app.push_key_valid(push_subscription_upsert.p256dh, 65, true)
     or not app.push_key_valid(push_subscription_upsert.auth, 16, false) then
    perform app.fail('VALIDATION', 'The subscription keys are not valid.');
  end if;
  if push_subscription_upsert.platform not in ('android', 'ios', 'desktop', 'other') then
    perform app.fail('VALIDATION', 'Unknown platform.');
  end if;
  -- One member's subscribes run one at a time, so the cap below counts exactly.
  perform pg_advisory_xact_lock(hashtext('push_subscriptions:' || v_caller.id::text));

  -- The endpoint is unique across everyone: whoever subscribes on this browser now owns it, and
  -- a disabled row (gone, signed out elsewhere, deactivated) comes back to life for the caller.
  -- Another member's ACTIVE row is taken over only with its own keys: the same browser hands
  -- every person signed in on it the same subscription (endpoint, p256dh and auth together), so
  -- a second person on a shared browser still takes it over, while someone who learnt only an
  -- endpoint cannot silence that device's owner (5A push review item 4, 2026-10-01).
  if exists (
    select 1 from public.push_subscriptions s
    where s.endpoint = v_endpoint and s.member_id <> v_caller.id and s.disabled_at is null
      and (s.p256dh is distinct from push_subscription_upsert.p256dh
           or s.auth is distinct from push_subscription_upsert.auth)
  ) then
    perform app.fail('FORBIDDEN', 'This device is registered to someone else.');
  end if;

  update public.push_subscriptions s
  set member_id = v_caller.id,
      p256dh = push_subscription_upsert.p256dh,
      auth = push_subscription_upsert.auth,
      platform = push_subscription_upsert.platform,
      is_standalone = coalesce(push_subscription_upsert.is_standalone, false),
      label = left(nullif(btrim(coalesce(push_subscription_upsert.label, '')), ''), 120),
      user_agent = left(nullif(btrim(coalesce(push_subscription_upsert.user_agent, '')), ''), 512),
      last_seen_at = now(),
      failure_count = 0,
      disabled_at = null,
      disabled_reason = null
  where s.endpoint = v_endpoint
  returning s.id into v_id;
  if v_id is null then
    insert into public.push_subscriptions (member_id, endpoint, p256dh, auth, platform, is_standalone, label, user_agent)
    values (v_caller.id, v_endpoint, push_subscription_upsert.p256dh, push_subscription_upsert.auth,
            push_subscription_upsert.platform, coalesce(push_subscription_upsert.is_standalone, false),
            left(nullif(btrim(coalesce(push_subscription_upsert.label, '')), ''), 120),
            left(nullif(btrim(coalesce(push_subscription_upsert.user_agent, '')), ''), 512))
    returning id into v_id;
  end if;

  -- At most 10 active devices a person (5A review M2: every push goes to every device). The one
  -- just subscribed always works; past 10, the least recently seen others are disabled as
  -- 'expired', as a device that stopped answering would be. Never refused: a new phone must work.
  update public.push_subscriptions s
  set disabled_at = now(), disabled_reason = 'expired'
  where s.id in (
    select o.id from public.push_subscriptions o
    where o.member_id = v_caller.id and o.disabled_at is null and o.id <> v_id
    order by o.last_seen_at desc, o.created_at desc, o.id
    offset 9);
  return v_id;
end;
$$;
comment on function public.push_subscription_upsert(text, text, text, text, boolean, text, text) is
  '5.2: an active permanent member subscribes this browser or installed app (WORKFLOWS §9a). The '
  'endpoint is taken over from a disabled row (a re-subscribe after ''gone'') or from another '
  'member''s active row with the same p256dh and auth (the same browser, another person; '
  'different keys: FORBIDDEN, 20261001003242), with the keys, platform, is_standalone, label and '
  'user_agent recorded and the result columns cleared. 5A review (20261001053934): https on a '
  'public DNS name only (http on the loopback host only with the local switch), strict keys, and '
  'at most 10 active rows a member (the least recently seen others disabled ''expired''). Returns '
  'the row id. Not audited (device state, see the table). The only way the API writes a row: '
  'INSERT and UPDATE are revoked from authenticated.';

-- 4. The API writes only through the RPCs -----------------------------------------------------------
-- Revoking the table privilege revokes the column grants of 20260930050132 with it. DELETE stays
-- (own rows, RLS): removing one's own device is harmless, and the app uses push_subscription_remove.
revoke insert, update on public.push_subscriptions from authenticated;

-- 5. "Send a test notification": a cooldown, checked before anything is sent ------------------------
create or replace function public.push_test_claim()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid := (select m.id from app.current_member() m);
  v_n integer;
begin
  if v_caller is null then
    perform app.fail('UNAUTHENTICATED', 'Your account is not active.');
  end if;
  -- The caller's active rows locked: two taps at once see each other's stamp.
  perform 1 from public.push_subscriptions s
  where s.member_id = v_caller and s.disabled_at is null
  for update;
  if exists (select 1 from public.push_subscriptions s
             where s.member_id = v_caller and s.disabled_at is null
               and s.last_test_at > now() - interval '30 seconds') then
    perform app.fail('RATE_LIMITED', 'A test was sent a moment ago. Try again in half a minute.');
  end if;
  update public.push_subscriptions s set last_test_at = now()
  where s.member_id = v_caller and s.disabled_at is null;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;
comment on function public.push_test_claim() is
  '5A review S2: "Send a test notification" claims its send before it goes: RATE_LIMITED while any '
  'active subscription of the caller was tested under 30 seconds ago, else last_test_at is stamped '
  'on every active one (under a row lock) and their number returned. The app sends only after it.';
revoke all on function public.push_test_claim() from public, anon;
grant execute on function public.push_test_claim() to authenticated, service_role;

-- 6. Guard messages say "Crew" (M4) -----------------------------------------------------------------
-- Each is the function's latest body (member_invite: 20260929053632; app.coordinator_eligible:
-- 20260929053632; comp_leave_grant: 20260930050132) with only the message changed.
create or replace function public.member_invite(user_id uuid, email text, full_name text, role member_role, job_title_id uuid default null::uuid)
returns uuid
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_caller uuid;
  v_org uuid;
  v_email text := lower(btrim(coalesce(email, '')));
  v_name text := btrim(coalesce(full_name, ''));
  v_auth_email text;
begin
  select r.caller_id, r.org_id into v_caller, v_org from app.require_team_manager() r;

  if role = 'owner' then
    perform app.fail('VALIDATION', 'Invite people as Admin or Crew.');
  end if;
  if v_name = '' then
    perform app.fail('VALIDATION', 'A name is required.');
  end if;
  if position('@' in v_email) <= 1 or length(v_email) > 254 then
    perform app.fail('VALIDATION', 'Enter a valid email address.');
  end if;

  select lower(u.email) into v_auth_email from auth.users u where u.id = user_id;
  if v_auth_email is null then
    perform app.fail('NOT_FOUND', 'No sign-in exists for this invite.');
  end if;
  if v_auth_email <> v_email then
    perform app.fail('VALIDATION', 'The email does not match the sign-in.');
  end if;
  -- 4A: a freelancer joins as an employee through member_invite_employee(), same id.
  if exists (select 1 from public.members m where m.id = user_id and m.engagement = 'freelance') then
    perform app.fail('CONFLICT', 'This person is a freelancer. Use "Invite as employee" on their page.');
  end if;
  if exists (select 1 from public.members m where lower(m.email) = v_email or m.id = user_id) then
    perform app.fail('CONFLICT', 'Someone with this email is already on the team. Reactivate them instead.');
  end if;

  perform set_config('app.audit_override', jsonb_build_object('action', 'invited')::text, true);
  insert into public.members (id, org_id, full_name, email, role, status, job_title_id, invited_at)
  values (user_id, v_org, v_name, v_email, role, 'invited', job_title_id, now());

  return user_id;
end;
$function$;

create or replace function app.coordinator_eligible(p_coordinator_id uuid, p_org uuid, p_member_id uuid)
returns void
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v public.members;
begin
  if p_coordinator_id is null then
    perform app.fail('VALIDATION', 'Choose a coordinator.');
  end if;
  if p_coordinator_id = p_member_id then
    perform app.fail('VALIDATION', 'A freelancer cannot coordinate themselves.');
  end if;
  -- Locked, so a deactivation running at the same instant waits and then counts this freelancer
  -- (member_deactivate locks the coordinator's row first; no cycle: it takes no other member row).
  select m.* into v from public.members m where m.id = p_coordinator_id and m.org_id = p_org for update;
  if v.id is null then
    perform app.fail('NOT_FOUND', 'This coordinator is not on the team.');
  end if;
  if v.role = 'owner' then
    perform app.fail('VALIDATION', 'The Owner approves the work, so the Owner cannot coordinate. Choose an Admin or Crew member.');
  end if;
  if v.status <> 'active' or v.engagement <> 'permanent' then
    perform app.fail('VALIDATION', 'A coordinator is an active employee (Admin or Crew).');
  end if;
end;
$function$;

create or replace function public.comp_leave_grant(member_id uuid, days numeric, note text default null::text, request_key uuid default null::uuid)
returns uuid
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_caller uuid;
  v_org uuid;
  v_note text := app.clean_reason(note);
  v_today date := app.today_ist();
  v_id uuid;
  v_prior public.comp_leave_credits;
begin
  select r.caller_id, r.org_id into v_caller, v_org from app.attendance_require_decider() r;
  if days is null or days not in (0.5, 1.0) then
    perform app.fail('VALIDATION', 'Grant half a day or one day.');
  end if;
  if not exists (
    select 1 from public.members m
    where m.id = comp_leave_grant.member_id and m.org_id = v_org and m.status = 'active'
      and m.engagement = 'permanent'
      and exists (select 1 from public.role_permissions rp where rp.role = m.role and rp.permission = 'attendance.self')) then
    perform app.fail('NOT_FOUND', 'Comp leave is granted to an active Admin or Crew employee.');
  end if;
  perform pg_advisory_xact_lock(hashtext('leave:' || comp_leave_grant.member_id::text));

  -- A double tap (or a retried request) with the same key is the same grant.
  if request_key is not null then
    select c.* into v_prior from public.comp_leave_credits c
    where c.member_id = comp_leave_grant.member_id and c.request_key = comp_leave_grant.request_key;
    if v_prior.id is not null then
      if v_prior.days <> days then
        perform app.fail('CONFLICT', 'This grant was already made with a different amount. Reload and check.');
      end if;
      return v_prior.id;
    end if;
  end if;

  perform set_config('app.audit_override', jsonb_build_object(
    'action', 'granted', 'meta', jsonb_build_object('days', days, 'standalone', true))::text, true);
  insert into public.comp_leave_credits (member_id, days, granted_by, granted_on, expires_on, note, request_key)
  values (comp_leave_grant.member_id, days, v_caller, v_today, app.ist_month_end(v_today), v_note, request_key)
  returning id into v_id;
  -- WORKFLOWS §9 "comp leave granted standalone": the member (5.1); once per grant (the same key
  -- returned above).
  perform app.notify(array[comp_leave_grant.member_id], 'comp_leave_granted',
    format('Comp leave granted: %s · use by %s',
      case when days = 0.5 then '½ day' else '1 day' end, app.notify_date(app.ist_month_end(v_today))),
    v_note, '/leave', 'comp_leave_credits', v_id, jsonb_build_object('credit_id', v_id));
  return v_id;
end;
$function$;
