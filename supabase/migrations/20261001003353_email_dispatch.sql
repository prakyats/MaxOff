-- 5.2 (unit 5A, step 3): notification email on the database side (WORKFLOWS §9a "Settled at
-- kickoff 5", kickoff 5 decisions 6, 7 and 10; ARCHITECTURE §9). Expand-only: two new functions
-- and an index.
--
-- The seam: the email row is created by the DISPATCHER at claim time (email_claim), not by
-- app.notify(). The dispatcher already owns every delivery state; deciding here keeps the
-- 30-odd producers untouched and lets "no working push" be judged when the mail is about to
-- go, after the same run's push pass:
--   * an always_email kind (notification_kinds.always_email): always;
--   * an actionable kind (notification_kinds.actionable): only when the recipient has no active
--     push subscription and the row's push was not sent (a device that answered gone counts as
--     none: push_subscription_result disables it);
--   * anything else (comments, task changed, information rows): never.
-- Only rows created in the last 24 hours are considered (a cron that was down for a day does
-- not mail stale news), only for an active member with an email address.
--
-- The ceilings (decision 7), race-safe: email_claim takes a transaction-level advisory lock, so
-- two runs never count at the same time. A delivery is counted once, when it is first leased
-- (attempts 0 → 1), against the IST day the email row was created on:
--   * org-wide org_settings.email_daily_cap_org (90): every counted email row of the org that day;
--   * per person email_daily_cap_per_member (20): that person's;
--   * over either: state 'skipped_cap' (last_error 'org_cap' | 'member_cap'); the notification
--     row and its push are untouched;
--   * an escalation (notifications.escalation_level > 0; 5B) bypasses the per-person cap only.
--     5B's digest is mailed the same way, flagged as an escalation-like bypass then;
--   * rows that failed as not_configured (no RESEND_API_KEY) are never counted.
-- Invites, password and email-change mails never go through deliveries (sendEmail directly,
-- and Supabase Auth's own mail), so they are never counted or skipped.
--
-- Retries: email_record() uses the push backoff (app.push_backoff: 1, 5, 15, 60 minutes, failed
-- after the fifth attempt); a retry is never re-counted or re-capped.

create index if not exists notifications_created_at_idx on public.notifications (created_at);

-- 1. Claim ----------------------------------------------------------------------------------------
create or replace function public.email_claim(p_now timestamptz default now(), p_limit integer default 20)
returns table (
  delivery_id uuid, recipient_id uuid, email text, notification_id uuid, kind text,
  title text, body text, link text, attempts integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lease interval := interval '5 minutes';
  v_row record;
  v_day_start timestamptz;
  v_org_count integer;
  v_member_count integer;
  v_new uuid[] := '{}';
begin
  -- Every run counts under one lock: two overlapping runs cannot both take the 90th email.
  perform pg_advisory_xact_lock(hashtext('public.email_claim'));

  -- a. Queue the email rows that are needed and not there yet.
  insert into public.notification_deliveries (notification_id, channel, state, next_attempt_at, created_at)
  select n.id, 'email', 'queued', p_now, p_now
  from public.notifications n
  join public.notification_kinds k on k.kind = n.kind
  join public.members m on m.id = n.recipient_id
  where n.created_at > p_now - interval '24 hours' and n.created_at <= p_now
    and m.status = 'active' and m.email is not null
    and (k.always_email
         or (k.actionable
             and not exists (select 1 from public.push_subscriptions s
                             where s.member_id = n.recipient_id and s.disabled_at is null)
             and not exists (select 1 from public.notification_deliveries p
                             where p.notification_id = n.id and p.channel = 'push' and p.state = 'sent')))
    and not exists (select 1 from public.notification_deliveries e
                    where e.notification_id = n.id and e.channel = 'email')
  order by n.created_at
  on conflict on constraint notification_deliveries_notification_id_channel_key do nothing;

  -- b. New rows: each passes both ceilings or is skipped_cap, oldest first.
  for v_row in
    select d.id, d.created_at, n.recipient_id, n.org_id, n.escalation_level,
           s.email_daily_cap_org, s.email_daily_cap_per_member
    from public.notification_deliveries d
    join public.notifications n on n.id = d.notification_id
    join public.org_settings s on s.org_id = n.org_id
    where d.channel = 'email' and d.state = 'queued' and d.attempts = 0 and d.next_attempt_at <= p_now
    order by d.created_at, n.created_at, d.id
    limit p_limit
    for update of d skip locked
  loop
    v_day_start := app.ist_day_start((v_row.created_at at time zone 'Asia/Kolkata')::date);
    select count(*),
           count(*) filter (where x.recipient_id = v_row.recipient_id)
      into v_org_count, v_member_count
    from public.notification_deliveries e
    join public.notifications x on x.id = e.notification_id
    where e.channel = 'email' and x.org_id = v_row.org_id
      and e.created_at >= v_day_start and e.created_at < v_day_start + interval '1 day'
      and e.attempts > 0 and e.last_error is distinct from 'not_configured';

    if v_org_count >= v_row.email_daily_cap_org then
      update public.notification_deliveries set state = 'skipped_cap', last_error = 'org_cap' where id = v_row.id;
    elsif v_row.escalation_level = 0 and v_member_count >= v_row.email_daily_cap_per_member then
      update public.notification_deliveries set state = 'skipped_cap', last_error = 'member_cap' where id = v_row.id;
    else
      update public.notification_deliveries set attempts = 1, next_attempt_at = p_now + v_lease where id = v_row.id;
      v_new := v_new || v_row.id;
    end if;
  end loop;

  -- c. What goes out now: the rows just leased, and the retries that are due (a lease that
  --    expired after a crashed run is claimed again the same way).
  return query
  with retry as (
    select d.id
    from public.notification_deliveries d
    where d.channel = 'email' and d.state = 'queued' and d.attempts > 0 and d.next_attempt_at <= p_now
      and not (d.id = any (v_new))
    order by d.next_attempt_at, d.created_at
    limit p_limit
    for update of d skip locked
  ), leased as (
    update public.notification_deliveries d
    set attempts = d.attempts + 1, next_attempt_at = p_now + v_lease
    from retry where d.id = retry.id
    returning d.id, d.attempts, d.notification_id
  ), outgoing as (
    select l.id, l.attempts, l.notification_id from leased l
    union all
    select d.id, d.attempts, d.notification_id from public.notification_deliveries d where d.id = any (v_new)
  )
  select o.id, n.recipient_id, m.email, n.id, n.kind, n.title, n.body, n.link, o.attempts
  from outgoing o
  join public.notifications n on n.id = o.notification_id
  join public.members m on m.id = n.recipient_id;
end;
$$;
comment on function public.email_claim(timestamptz, integer) is
  '5.2, service_role only (the dispatcher, ARCHITECTURE §9): queues the email rows a notification '
  'needs (always_email kinds; actionable kinds when the person has no active push subscription and '
  'the push was not sent; never anything else; rows of the last 24 hours, active members with an '
  'address), applies the two daily ceilings under an advisory lock (org email_daily_cap_org, per '
  'person email_daily_cap_per_member, the latter bypassed by escalation_level > 0; over either: '
  'skipped_cap), leases what may go (attempts + 1, next_attempt_at + 5 min, FOR UPDATE SKIP LOCKED) '
  'and returns it with the address. The caller sends and records each through email_record().';
revoke all on function public.email_claim(timestamptz, integer) from public, anon, authenticated;
grant execute on function public.email_claim(timestamptz, integer) to service_role;

-- 2. Record ---------------------------------------------------------------------------------------
create or replace function public.email_record(p_id uuid, p_outcome text, p_error text default null, p_now timestamptz default now())
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n integer;
begin
  if p_outcome not in ('sent', 'retry', 'failed') then
    perform app.fail('VALIDATION', 'Unknown email outcome.');
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
  where d.id = p_id and d.channel = 'email' and d.state = 'queued';
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;
comment on function public.email_record(uuid, text, text, timestamptz) is
  '5.2, service_role only: a claimed email''s outcome. sent: sent + sent_at; retry (Resend 429 or '
  '5xx, a network failure): queued again after 1, 5, 15 or 60 minutes by the attempt, failed after '
  'the fifth; failed (another 4xx; not_configured when RESEND_API_KEY is unset): failed with '
  'last_error. Only rows still queued (leased) move. Returns the rows written.';
revoke all on function public.email_record(uuid, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.email_record(uuid, text, text, timestamptz) to service_role;
