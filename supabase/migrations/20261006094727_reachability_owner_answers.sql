-- 5B 5.5 follow-up: the owner's answers of 2026-10-06 (PROGRESS "Slice 9", "Owner answers
-- (2026-10-06)"; WORKFLOWS §9a). Expand-only: one CHECK widened, functions re-created with the same
-- signatures, two new functions. No row is rewritten.
--
-- * **Remove sticks** (answer 1). "Remove" on Me's device list no longer deletes the row: it keeps it,
--   disabled with the new reason 'removed' (the CHECK widened). The automatic turn-on (the page's
--   re-subscribe on load, PushSync, and the service worker's pushsubscriptionchange) goes through
--   push_subscription_upsert(), which now refuses that device's endpoint for the member who removed it
--   (INVALID_STATE): opened again, it stays off. The way back is an explicit tap on that device ("Turn
--   on" in the band's sheet, on Me, or in the walkthrough): push_subscription_turn_on(), the same
--   arguments and rules, which clears the marker and subscribes again (the same row). "Sign out of
--   this device" on a removed device keeps the marker (the row is not deleted), so signing in there
--   again does not turn it back on either. Both bodies are app.push_subscription_save(…, explicit),
--   the latest upsert (20261001053934) plus that one check. A marker, not a second table: the row is
--   already keyed by the endpoint, every reader of active devices (the dispatcher's push_targets, the
--   test, the cap, push_status_own, reachability) already skips disabled rows, and RLS keeps it the
--   member's own; the endpoint stays off every screen as before.
-- * **The band's census** (answer 4): app.push_band already counts any delivery on record, a real
--   dispatched push (push_subscription_result(id, 'sent') → last_success_at) exactly like a test
--   (tests in 60_reachability_owner_answers). push_band_census() counts, read-only and for the service
--   role only, the active members the band would ask to "Check notifications reach you" (reason
--   'unconfirmed') and their active devices: the staging-only dispatch job push-band-count
--   (.github/workflows/preview.yml) prints it for the owner.
-- (Answers 2 and 3, the sign-in's landing and a delivered test finishing the walkthrough, are the
-- app's: no database change.)

-- 1. The reason 'removed' -------------------------------------------------------------------------------
alter table public.push_subscriptions drop constraint push_subscriptions_disabled_reason_check;
alter table public.push_subscriptions add constraint push_subscriptions_disabled_reason_check
  check (disabled_reason in ('gone', 'expired', 'signed_out', 'deactivated', 'removed'));
comment on column public.push_subscriptions.disabled_reason is
  'Why the row no longer gets pushes: gone (404/410), expired (5 errors in a row, or past the cap of '
  '10), signed_out, deactivated, removed (owner 2026-10-06: "Remove" on Me''s device list; the '
  'automatic re-subscribe leaves it off, an explicit Turn on on that device clears it).';

-- 2. The subscribe, automatic or explicit ---------------------------------------------------------------
create function app.push_subscription_save(
  p_endpoint text, p_p256dh text, p_auth text, p_platform text, p_is_standalone boolean,
  p_label text, p_user_agent text, p_explicit boolean)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller public.members;
  v_endpoint text := btrim(coalesce(p_endpoint, ''));
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
  if nullif(btrim(coalesce(p_p256dh, '')), '') is null
     or nullif(btrim(coalesce(p_auth, '')), '') is null then
    perform app.fail('VALIDATION', 'The subscription keys are missing.');
  end if;
  -- The keys exactly as the browser makes them (5A review M1).
  if not app.push_key_valid(p_p256dh, 65, true) or not app.push_key_valid(p_auth, 16, false) then
    perform app.fail('VALIDATION', 'The subscription keys are not valid.');
  end if;
  if p_platform is null or p_platform not in ('android', 'ios', 'desktop', 'other') then
    perform app.fail('VALIDATION', 'Unknown platform.');
  end if;
  -- One member's subscribes run one at a time, so the cap below counts exactly.
  perform pg_advisory_xact_lock(hashtext('push_subscriptions:' || v_caller.id::text));

  -- Remove sticks (owner 2026-10-06): a device the member removed from Me's list is turned on again
  -- only by their own tap on it, never by the automatic re-subscribe.
  if not p_explicit and exists (
    select 1 from public.push_subscriptions s
    where s.endpoint = v_endpoint and s.member_id = v_caller.id and s.disabled_reason = 'removed'
  ) then
    perform app.fail('INVALID_STATE',
      'This device was removed from your devices. Turn notifications on here to get them again.');
  end if;

  -- Another member's ACTIVE row is taken over only with its own keys (5A push review item 4).
  if exists (
    select 1 from public.push_subscriptions s
    where s.endpoint = v_endpoint and s.member_id <> v_caller.id and s.disabled_at is null
      and (s.p256dh is distinct from p_p256dh or s.auth is distinct from p_auth)
  ) then
    perform app.fail('FORBIDDEN', 'This device is registered to someone else.');
  end if;

  update public.push_subscriptions s
  set member_id = v_caller.id,
      p256dh = p_p256dh,
      auth = p_auth,
      platform = p_platform,
      is_standalone = coalesce(p_is_standalone, false),
      label = left(nullif(btrim(coalesce(p_label, '')), ''), 120),
      user_agent = left(nullif(btrim(coalesce(p_user_agent, '')), ''), 512),
      last_seen_at = now(),
      failure_count = 0,
      disabled_at = null,
      disabled_reason = null
  where s.endpoint = v_endpoint
  returning s.id into v_id;
  if v_id is null then
    insert into public.push_subscriptions (member_id, endpoint, p256dh, auth, platform, is_standalone, label, user_agent)
    values (v_caller.id, v_endpoint, p_p256dh, p_auth, p_platform, coalesce(p_is_standalone, false),
            left(nullif(btrim(coalesce(p_label, '')), ''), 120),
            left(nullif(btrim(coalesce(p_user_agent, '')), ''), 512))
    returning id into v_id;
  end if;

  -- At most 10 active devices a person (5A review M2); past 10, the least recently seen others are
  -- disabled as 'expired'. Never refused: a new phone must work.
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
comment on function app.push_subscription_save(text, text, text, text, boolean, text, text, boolean) is
  'Owner answers 2026-10-06, service_role only (called inside push_subscription_upsert and '
  'push_subscription_turn_on): the subscribe of 20261001053934 plus Remove sticks: when not '
  'p_explicit, the caller''s own row for this endpoint disabled ''removed'' is refused with '
  'INVALID_STATE; when p_explicit it is cleared and subscribed again like any disabled row.';
revoke all on function app.push_subscription_save(text, text, text, text, boolean, text, text, boolean)
  from public, anon, authenticated;
grant execute on function app.push_subscription_save(text, text, text, text, boolean, text, text, boolean)
  to service_role;

create or replace function public.push_subscription_upsert(
  endpoint text, p256dh text, auth text,
  platform text default 'other', is_standalone boolean default false,
  label text default null, user_agent text default null)
returns uuid
language sql
security definer
set search_path = ''
as $$
  select app.push_subscription_save(push_subscription_upsert.endpoint, push_subscription_upsert.p256dh,
    push_subscription_upsert.auth, push_subscription_upsert.platform, push_subscription_upsert.is_standalone,
    push_subscription_upsert.label, push_subscription_upsert.user_agent, false);
$$;
comment on function public.push_subscription_upsert(text, text, text, text, boolean, text, text) is
  '5.2: the automatic subscribe (the page''s re-subscribe on load, the service worker''s '
  'pushsubscriptionchange). The endpoint is taken over from a disabled row or from another member''s '
  'active row with the same p256dh and auth (else FORBIDDEN), keys and device facts recorded, the '
  'result columns cleared; https on a public DNS name, strict keys, at most 10 active rows a member '
  '(20261001053934). Since 2026-10-06 (Remove sticks) the caller''s own row removed from Me''s list '
  'is refused with INVALID_STATE: only push_subscription_turn_on brings it back. Returns the row id. '
  'Not audited (device state).';
revoke all on function public.push_subscription_upsert(text, text, text, text, boolean, text, text) from public, anon;
grant execute on function public.push_subscription_upsert(text, text, text, text, boolean, text, text) to authenticated, service_role;

create function public.push_subscription_turn_on(
  endpoint text, p256dh text, auth text,
  platform text default 'other', is_standalone boolean default false,
  label text default null, user_agent text default null)
returns uuid
language sql
security definer
set search_path = ''
as $$
  select app.push_subscription_save(push_subscription_turn_on.endpoint, push_subscription_turn_on.p256dh,
    push_subscription_turn_on.auth, push_subscription_turn_on.platform, push_subscription_turn_on.is_standalone,
    push_subscription_turn_on.label, push_subscription_turn_on.user_agent, true);
$$;
comment on function public.push_subscription_turn_on(text, text, text, text, boolean, text, text) is
  'Owner answers 2026-10-06: the member''s own tap on "Turn on" on this device (the band''s sheet, '
  'Me, the walkthrough). Every rule of push_subscription_upsert, and it also clears this device''s '
  '''removed'' marker (the way back after Remove). Returns the row id. Not audited (device state).';
revoke all on function public.push_subscription_turn_on(text, text, text, text, boolean, text, text) from public, anon;
grant execute on function public.push_subscription_turn_on(text, text, text, text, boolean, text, text) to authenticated, service_role;

-- 3. Remove keeps the row, marked -----------------------------------------------------------------------
create or replace function public.push_subscription_remove_own(p_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := (select m.id from app.current_member() m);
  v_n integer;
begin
  if v_me is null then
    perform app.fail('UNAUTHENTICATED', 'Your account is not active.');
  end if;
  update public.push_subscriptions s
  set disabled_at = now(), disabled_reason = 'removed'
  where s.id = p_id and s.member_id = v_me and s.disabled_reason is distinct from 'removed';
  get diagnostics v_n = row_count;
  if v_n = 0 then
    perform app.fail('NOT_FOUND', 'This device is not one of yours.');
  end if;
  return true;
end;
$$;
comment on function public.push_subscription_remove_own(uuid) is
  '5B 5.5 (owner decision 2026-10-03; Remove sticks, owner 2026-10-06): "Remove" on Me''s device '
  'list stops notifications to one of the caller''s own devices: the row is kept, disabled '
  '''removed'', so the automatic re-subscribe leaves it off (only push_subscription_turn_on on that '
  'device clears it); that device is not signed out. Anyone else''s row, the Owner''s included, and a '
  'row already removed are NOT_FOUND. Not audited, as push_subscription_remove: a member''s own '
  'device state (5.1 review S5).';
revoke all on function public.push_subscription_remove_own(uuid) from public, anon;
grant execute on function public.push_subscription_remove_own(uuid) to authenticated, service_role;

-- "Sign out of this device" deletes this device's row, but never a removed one: the marker stays, so
-- signing in on that device again does not turn it back on by itself.
create or replace function public.push_subscription_remove(endpoint text)
returns boolean
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
  delete from public.push_subscriptions s
  where s.member_id = v_caller and s.endpoint = btrim(coalesce(push_subscription_remove.endpoint, ''))
    and s.disabled_reason is distinct from 'removed';
  get diagnostics v_n = row_count;
  return v_n > 0;
end;
$$;
comment on function public.push_subscription_remove(text) is
  '5.2: "Sign out of this device" deletes the caller''s subscription for this endpoint (kickoff 5 '
  'decision 1; WORKFLOWS §9a). Own rows only; another member''s endpoint is left alone (false). A '
  'row removed from Me''s list keeps its marker (owner 2026-10-06, Remove sticks): not deleted.';
revoke all on function public.push_subscription_remove(text) from public, anon;
grant execute on function public.push_subscription_remove(text) to authenticated, service_role;

-- 4. The band's census (staging, before the release) -----------------------------------------------------
create function public.push_band_census()
returns table (people integer, devices integer)
language sql
stable
security definer
set search_path = ''
as $$
  with banded as (
    select m.id from public.members m
    where m.status = 'active' and app.push_band(m.id) = 'unconfirmed'
  )
  select (select count(*) from banded)::integer,
         (select count(*) from public.push_subscriptions s
          join banded b on b.id = s.member_id
          where s.disabled_at is null)::integer;
$$;
comment on function public.push_band_census() is
  'Owner answers 2026-10-06, service_role only, read-only: how many active members the band would '
  'ask to "Check notifications reach you" (app.push_band = ''unconfirmed'': a device turned on, no '
  'working device with a delivery on record, a real push or a test) and how many active devices '
  'they have. Run by the staging-only dispatch job push-band-count (.github/workflows/preview.yml).';
revoke all on function public.push_band_census() from public, anon, authenticated;
grant execute on function public.push_band_census() to service_role;
