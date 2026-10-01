-- 5.2 (unit 5A, step 2): Web Push on the database side (WORKFLOWS §9a, "Settled at kickoff 5",
-- kickoff 5 decisions 1, 5 and 9; ARCHITECTURE §9). Expand-only: new functions only.
--
-- 1. push_subscription_upsert(): the API's way to subscribe a device. It takes over an endpoint
--    already stored for another member or as a disabled row (a second person on the same
--    browser subscribes; a re-subscribe after 'gone' reuses the row), records platform,
--    is_standalone, label and user_agent, and clears the result columns.
-- 2. push_subscription_remove(endpoint): "Sign out of this device" deletes this device's row
--    (own rows only; kickoff 5 decision 1: a subscription goes only with sign-out or deactivation).
-- 3. push_subscriptions_tested(): "Send a test notification" stamps last_test_at on the caller's
--    active rows; the push itself is sent by the app (it needs the network).
-- 4. The dispatcher's functions in public (PostgREST reaches only public), service_role only,
--    like file_cleanup_candidates; called by /api/cron/push-dispatch (a Worker
--    cron every minute, and after() a transition): push_claim() leases due push deliveries
--    (FOR UPDATE SKIP LOCKED, so two runs never send one twice), holds rows in quiet hours and
--    releases held rows as one summary item per person once the window is over (decision 5);
--    push_targets() lists a recipient's active subscriptions; push_record() writes a delivery's
--    outcome (sent / retry with backoff / failed); push_subscription_result() writes a
--    subscription's (success, gone, error; 5 errors in a row = 'expired', WORKFLOWS §9a).
-- 5. public.push_quiet(at, org): the quiet-hours window, IST, crossing midnight when start > end,
--    no window when they are equal. Rows and email are never held (decision 5).

-- 1. Subscribe --------------------------------------------------------------------------------------
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
  'endpoint is taken over from another member or a disabled row (the same browser, another '
  'person; a re-subscribe after ''gone''), with the keys, platform, is_standalone, label and '
  'user_agent recorded and the result columns cleared. Returns the row id. Not audited (device '
  'state, see the table).';
revoke all on function public.push_subscription_upsert(text, text, text, text, boolean, text, text) from public, anon;
grant execute on function public.push_subscription_upsert(text, text, text, text, boolean, text, text) to authenticated, service_role;

-- 2. Sign out of this device ------------------------------------------------------------------------
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
  where s.member_id = v_caller and s.endpoint = btrim(coalesce(push_subscription_remove.endpoint, ''));
  get diagnostics v_n = row_count;
  return v_n > 0;
end;
$$;
comment on function public.push_subscription_remove(text) is
  '5.2: "Sign out of this device" deletes the caller''s subscription for this endpoint (kickoff 5 '
  'decision 1; WORKFLOWS §9a). Own rows only; another member''s endpoint is left alone (false).';
revoke all on function public.push_subscription_remove(text) from public, anon;
grant execute on function public.push_subscription_remove(text) to authenticated, service_role;

-- 3. The test notification --------------------------------------------------------------------------
create or replace function public.push_subscriptions_tested()
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
  update public.push_subscriptions s set last_test_at = now()
  where s.member_id = v_caller and s.disabled_at is null;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;
comment on function public.push_subscriptions_tested() is
  '5.2: "Send a test notification" (Me) stamps last_test_at on the caller''s active subscriptions '
  'after the app sent the test push (no notifications row: a device check is not an event). '
  'Returns how many rows were stamped.';
revoke all on function public.push_subscriptions_tested() from public, anon;
grant execute on function public.push_subscriptions_tested() to authenticated, service_role;

-- 4. Quiet hours ------------------------------------------------------------------------------------
create or replace function public.push_quiet(p_at timestamptz, p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when s.quiet_hours_start = s.quiet_hours_end then false
    when s.quiet_hours_start < s.quiet_hours_end then
      (p_at at time zone 'Asia/Kolkata')::time >= s.quiet_hours_start
      and (p_at at time zone 'Asia/Kolkata')::time < s.quiet_hours_end
    else
      (p_at at time zone 'Asia/Kolkata')::time >= s.quiet_hours_start
      or (p_at at time zone 'Asia/Kolkata')::time < s.quiet_hours_end
  end
  from public.org_settings s
  where s.org_id = p_org;
$$;
comment on function public.push_quiet(timestamptz, uuid) is
  '5.2 (kickoff 5 decision 5), service_role only: is this moment inside the organization''s quiet '
  'hours, IST? [start, end), crossing midnight when start > end; no window when they are equal.';
revoke all on function public.push_quiet(timestamptz, uuid) from public, anon, authenticated;
grant execute on function public.push_quiet(timestamptz, uuid) to service_role;

-- 5. The dispatcher ---------------------------------------------------------------------------------
-- A work item: the rows it sends (one, or every held row of a person as the summary), who gets it
-- and what the push says. `attempts` is the highest of the rows, after this claim.
create or replace function public.push_claim(p_now timestamptz default now(), p_limit integer default 50)
returns table (
  delivery_ids uuid[], recipient_id uuid, org_id uuid, notification_id uuid, kind text,
  title text, body text, link text, attempts integer, is_summary boolean, held_count integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lease interval := interval '5 minutes';
begin
  -- a. Queued rows that are due while their organization is in quiet hours: held. Rows created
  --    inside the window and retries falling into it alike (decision 5; the test push bypasses
  --    all of this because it never has a delivery row).
  update public.notification_deliveries d
  set state = 'held'
  from public.notifications n
  where d.notification_id = n.id and d.channel = 'push' and d.state = 'queued'
    and d.next_attempt_at <= p_now and public.push_quiet(p_now, n.org_id);

  -- b. Held rows whose window is over: leased and returned, one item per person. One row goes as
  --    itself; several go as one summary ("N updates while you were away", opening the history).
  return query
  with released as (
    select d.id, d.attempts, n.recipient_id, n.org_id, n.id as notification_id, n.kind, n.title, n.body, n.link
    from public.notification_deliveries d
    join public.notifications n on n.id = d.notification_id
    where d.channel = 'push' and d.state = 'held' and not public.push_quiet(p_now, n.org_id)
    order by n.recipient_id, n.created_at
    for update of d skip locked
  ), leased as (
    update public.notification_deliveries d
    set state = 'queued', attempts = d.attempts + 1, next_attempt_at = p_now + v_lease
    from released r where d.id = r.id
    returning d.id, d.attempts
  ), grouped as (
    select r.recipient_id, r.org_id,
           array_agg(r.id order by r.notification_id) as ids,
           count(*)::integer as n,
           max(l.attempts) as attempts,
           (array_agg(r.notification_id order by r.notification_id))[1] as one_notification_id,
           (array_agg(r.kind order by r.notification_id))[1] as one_kind,
           (array_agg(r.title order by r.notification_id))[1] as one_title,
           (array_agg(r.body order by r.notification_id))[1] as one_body,
           (array_agg(r.link order by r.notification_id))[1] as one_link
    from released r join leased l on l.id = r.id
    group by r.recipient_id, r.org_id
  )
  select g.ids, g.recipient_id, g.org_id,
         case when g.n = 1 then g.one_notification_id end,
         case when g.n = 1 then g.one_kind else 'summary' end,
         case when g.n = 1 then g.one_title else format('%s updates while you were away', g.n) end,
         case when g.n = 1 then g.one_body else 'Open MaxOff to see what happened.' end,
         case when g.n = 1 then g.one_link else '/notifications' end,
         g.attempts, g.n > 1, g.n
  from grouped g;

  -- c. Queued rows that are due: leased and returned one by one.
  return query
  with due as (
    select d.id
    from public.notification_deliveries d
    join public.notifications n on n.id = d.notification_id
    where d.channel = 'push' and d.state = 'queued' and d.next_attempt_at <= p_now
      and not public.push_quiet(p_now, n.org_id)
    order by d.next_attempt_at, d.created_at
    limit p_limit
    for update of d skip locked
  ), leased as (
    update public.notification_deliveries d
    set attempts = d.attempts + 1, next_attempt_at = p_now + v_lease
    from due where d.id = due.id
    returning d.id, d.attempts, d.notification_id
  )
  select array[l.id], n.recipient_id, n.org_id, n.id, n.kind, n.title, n.body, n.link, l.attempts, false, 1
  from leased l join public.notifications n on n.id = l.notification_id;
end;
$$;
comment on function public.push_claim(timestamptz, integer) is
  '5.2, service_role only (the push dispatcher, ARCHITECTURE §9): holds due push rows inside quiet '
  'hours; leases (attempts + 1, next_attempt_at + 5 min, FOR UPDATE SKIP LOCKED: two runs never '
  'send one row twice, a crashed run retries after the lease) and returns the work: held rows '
  'whose window is over as one item per person (one row as itself, several as a summary opening '
  '/notifications; decision 5), then due queued rows one by one, up to p_limit each. The caller '
  'sends and records each item through push_record().';
revoke all on function public.push_claim(timestamptz, integer) from public, anon, authenticated;
grant execute on function public.push_claim(timestamptz, integer) to service_role;

create or replace function public.push_targets(p_recipient uuid)
returns table (id uuid, endpoint text, p256dh text, auth text)
language sql
stable
security definer
set search_path = ''
as $$
  select s.id, s.endpoint, s.p256dh, s.auth
  from public.push_subscriptions s
  where s.member_id = p_recipient and s.disabled_at is null
  order by s.created_at;
$$;
comment on function public.push_targets(uuid) is
  '5.2, service_role only: a recipient''s active subscriptions (every device gets every push).';
revoke all on function public.push_targets(uuid) from public, anon, authenticated;
grant execute on function public.push_targets(uuid) to service_role;

-- Retry backoff by the attempt just made: 1, 5, 15 and 60 minutes, then failed.
create or replace function app.push_backoff(p_attempts integer)
returns interval
language sql
immutable
parallel safe
set search_path = ''
as $$
  select case p_attempts
    when 1 then interval '1 minute'
    when 2 then interval '5 minutes'
    when 3 then interval '15 minutes'
    when 4 then interval '60 minutes'
  end;
$$;
revoke all on function app.push_backoff(integer) from public, authenticated;
grant execute on function app.push_backoff(integer) to service_role;

create or replace function public.push_record(p_ids uuid[], p_outcome text, p_error text default null, p_now timestamptz default now())
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n integer;
begin
  if p_outcome not in ('sent', 'retry', 'failed') then
    perform app.fail('VALIDATION', 'Unknown push outcome.');
  end if;
  update public.notification_deliveries d
  set state = case
        when p_outcome = 'sent' then 'sent'
        when p_outcome = 'failed' or app.push_backoff(d.attempts) is null then 'failed'
        else 'queued' end,
      sent_at = case when p_outcome = 'sent' then p_now else d.sent_at end,
      next_attempt_at = case
        when p_outcome = 'retry' and app.push_backoff(d.attempts) is not null then p_now + app.push_backoff(d.attempts)
        else d.next_attempt_at end,
      last_error = case when p_outcome = 'sent' then null else left(p_error, 500) end
  where d.id = any (p_ids) and d.channel = 'push' and d.state = 'queued';
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;
comment on function public.push_record(uuid[], text, text, timestamptz) is
  '5.2, service_role only: a claimed item''s outcome. sent: sent + sent_at; retry: queued again '
  'after 1, 5, 15 or 60 minutes by the attempt count, failed after the fifth; failed: failed with '
  'last_error (''no_subscription'' when the person has no active device: the seam step 3 reads '
  'for the email fallback). Only rows still queued (leased) move. Returns the rows written.';
revoke all on function public.push_record(uuid[], text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.push_record(uuid[], text, text, timestamptz) to service_role;

create or replace function public.push_subscription_result(p_id uuid, p_outcome text, p_now timestamptz default now())
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_state text;
begin
  if p_outcome not in ('sent', 'gone', 'error') then
    perform app.fail('VALIDATION', 'Unknown subscription outcome.');
  end if;
  update public.push_subscriptions s
  set last_success_at = case when p_outcome = 'sent' then p_now else s.last_success_at end,
      last_failure_at = case when p_outcome = 'sent' then s.last_failure_at else p_now end,
      failure_count = case when p_outcome = 'sent' then 0 else s.failure_count + 1 end,
      disabled_at = case
        when s.disabled_at is not null then s.disabled_at
        when p_outcome = 'gone' then p_now
        when p_outcome = 'error' and s.failure_count + 1 >= 5 then p_now
        else null end,
      disabled_reason = case
        when s.disabled_at is not null then s.disabled_reason
        when p_outcome = 'gone' then 'gone'
        when p_outcome = 'error' and s.failure_count + 1 >= 5 then 'expired'
        else null end
  where s.id = p_id
  returning coalesce(s.disabled_reason, 'active') into v_state;
  return v_state;
end;
$$;
comment on function public.push_subscription_result(uuid, text, timestamptz) is
  '5.2, service_role only: a push service''s answer for one subscription (WORKFLOWS §9a). sent: '
  'last_success_at, failure_count 0; gone (404/410): disabled ''gone''; error: failure_count + 1, '
  'disabled ''expired'' at the fifth in a row. Returns ''active'' or the disabled reason.';
revoke all on function public.push_subscription_result(uuid, text, timestamptz) from public, anon, authenticated;
grant execute on function public.push_subscription_result(uuid, text, timestamptz) to service_role;
