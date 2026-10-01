-- 5A push item 4 (2026-10-01): push_subscription_upsert() takes over ANOTHER member's ACTIVE
-- subscription only when the caller presents that subscription's own keys (p256dh and auth).
-- Before, anyone who knew an endpoint could move it to themselves, silencing the device's owner
-- (their notifications would then go to the taker's account). A browser gives every person
-- signed in on it the same subscription, endpoint and keys together, so the shared-browser case
-- (review S3) still works; disabled rows and the caller's own rows are unchanged. Same
-- signature, re-created (expand-only: behaviour narrowed only for a forged request).

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
  -- https, as every push service is; plain http only on the loopback host, where the local e2e
  -- run's fake push service stands in for one (e2e/push.spec.ts).
  if v_endpoint !~ '^(https://|http://(127\.0\.0\.1|localhost)(:[0-9]+)?/)' or length(v_endpoint) > 2048 then
    perform app.fail('VALIDATION', 'The push endpoint must be an https URL.');
  end if;
  if nullif(btrim(coalesce(push_subscription_upsert.p256dh, '')), '') is null
     or nullif(btrim(coalesce(push_subscription_upsert.auth, '')), '') is null then
    perform app.fail('VALIDATION', 'The subscription keys are missing.');
  end if;
  if push_subscription_upsert.platform not in ('android', 'ios', 'desktop', 'other') then
    perform app.fail('VALIDATION', 'Unknown platform.');
  end if;

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
  if v_id is not null then
    return v_id;
  end if;

  insert into public.push_subscriptions (member_id, endpoint, p256dh, auth, platform, is_standalone, label, user_agent)
  values (v_caller.id, v_endpoint, push_subscription_upsert.p256dh, push_subscription_upsert.auth,
          push_subscription_upsert.platform, coalesce(push_subscription_upsert.is_standalone, false),
          left(nullif(btrim(coalesce(push_subscription_upsert.label, '')), ''), 120),
          left(nullif(btrim(coalesce(push_subscription_upsert.user_agent, '')), ''), 512))
  returning id into v_id;
  return v_id;
end;
$$;
comment on function public.push_subscription_upsert(text, text, text, text, boolean, text, text) is
  '5.2: an active permanent member subscribes this browser or installed app (WORKFLOWS §9a). The '
  'endpoint is taken over from a disabled row (a re-subscribe after ''gone'') or from another '
  'member''s active row with the same p256dh and auth (the same browser, another person; '
  'different keys: FORBIDDEN, 20261001003242), with the keys, platform, is_standalone, label and '
  'user_agent recorded and the result columns cleared. Returns the row id. Not audited (device '
  'state, see the table).';
revoke all on function public.push_subscription_upsert(text, text, text, text, boolean, text, text) from public, anon;
grant execute on function public.push_subscription_upsert(text, text, text, text, boolean, text, text) to authenticated, service_role;
