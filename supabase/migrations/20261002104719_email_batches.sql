-- 5.3 (unit 5B): the email caps and one email per person per run (owner answers 2026-10-02, PROGRESS
-- "Slice 6"). Expand-only: one nullable column, and email_claim re-created with two more result
-- columns (a function, not data: the old dispatcher ignores the extra columns during a rollout).
--
-- * **Escalations are the last thing a cap drops.** Ordinary emails stop at the organisation's
--   ceiling less 10 (80 of 90 at launch); the last 10 are kept for escalations
--   (notifications.escalation_level > 0), which are taken first in every run and still ignore the
--   per-person cap (5A). An escalation is skipped only past the full ceiling.
-- * **One email per person per run** for the always-emailed rows (notification_kinds.always_email):
--   every such row of a person leased in one run shares a `batch_id`, the dispatcher sends them as
--   one email, and the batch counts **once** against both ceilings; a batch holding an escalation is
--   treated as one. Fallback emails (actionable kinds, no working push) stay one email each.
-- * Counting: one per distinct coalesce(batch_id, id) of the IST day, as before only rows leased
--   at least once and never `not_configured` ones.
-- * Not counted at all: invites, password and email-change mails (Supabase Auth and sendEmail
--   directly, never these deliveries), so 90 is not the account's true daily total (ARCHITECTURE §9).

alter table public.notification_deliveries add column batch_id uuid null;
comment on column public.notification_deliveries.batch_id is
  '5.3: the email rows of one person sent as one email in one run (always-emailed kinds); counted once '
  'against the daily ceilings. Null for a push row or an email sent on its own.';
create index notification_deliveries_batch_idx on public.notification_deliveries (batch_id) where batch_id is not null;

drop function public.email_claim(timestamptz, integer);
create function public.email_claim(p_now timestamptz default now(), p_limit integer default 20)
returns table (
  delivery_id uuid, recipient_id uuid, email text, notification_id uuid, kind text,
  title text, body text, link text, attempts integer, batch_id uuid, escalation_level integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lease interval := interval '5 minutes';
  v_group record;
  v_day_start timestamptz;
  v_org_count integer;
  v_member_count integer;
  v_batch uuid;
  v_new uuid[] := '{}';
begin
  -- Every run counts under one lock: two overlapping runs cannot both take the last email.
  perform pg_advisory_xact_lock(hashtext('public.email_claim'));

  -- a. Queue the email rows that are needed and not there yet (unchanged from email_dispatch).
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

  -- b. New rows, as groups: a person's always-emailed rows together, a fallback row alone. Groups
  --    holding an escalation first, then the oldest; each passes the ceilings once or is skipped.
  for v_group in
    with fresh as (
      select d.id, d.created_at, n.recipient_id, n.org_id, n.escalation_level, k.always_email,
             s.email_daily_cap_org, s.email_daily_cap_per_member
      from public.notification_deliveries d
      join public.notifications n on n.id = d.notification_id
      join public.notification_kinds k on k.kind = n.kind
      join public.org_settings s on s.org_id = n.org_id
      where d.channel = 'email' and d.state = 'queued' and d.attempts = 0 and d.next_attempt_at <= p_now
      order by d.created_at, n.created_at, d.id
      limit p_limit
      for update of d skip locked
    )
    select array_agg(f.id order by f.created_at, f.id) as ids,
           min(f.created_at) as created_at, f.recipient_id, f.org_id,
           bool_or(f.escalation_level > 0) as escalation, bool_and(f.always_email) as batched,
           max(f.email_daily_cap_org) as cap_org, max(f.email_daily_cap_per_member) as cap_member
    from fresh f
    group by f.recipient_id, f.org_id, case when f.always_email then null else f.id end
    order by bool_or(f.escalation_level > 0) desc, min(f.created_at)
  loop
    v_day_start := app.ist_day_start((v_group.created_at at time zone 'Asia/Kolkata')::date);
    select count(distinct coalesce(e.batch_id, e.id)),
           count(distinct coalesce(e.batch_id, e.id)) filter (where x.recipient_id = v_group.recipient_id)
      into v_org_count, v_member_count
    from public.notification_deliveries e
    join public.notifications x on x.id = e.notification_id
    where e.channel = 'email' and x.org_id = v_group.org_id
      and e.created_at >= v_day_start and e.created_at < v_day_start + interval '1 day'
      and e.attempts > 0 and e.last_error is distinct from 'not_configured';

    if v_group.escalation and v_org_count >= v_group.cap_org then
      update public.notification_deliveries set state = 'skipped_cap', last_error = 'org_cap' where id = any (v_group.ids);
    elsif not v_group.escalation and v_org_count >= greatest(v_group.cap_org - 10, 0) then
      update public.notification_deliveries set state = 'skipped_cap', last_error = 'org_cap' where id = any (v_group.ids);
    elsif not v_group.escalation and v_member_count >= v_group.cap_member then
      update public.notification_deliveries set state = 'skipped_cap', last_error = 'member_cap' where id = any (v_group.ids);
    else
      v_batch := case when v_group.batched then gen_random_uuid() else null end;
      update public.notification_deliveries
      set attempts = 1, next_attempt_at = p_now + v_lease, batch_id = v_batch
      where id = any (v_group.ids);
      v_new := v_new || v_group.ids;
    end if;
  end loop;

  -- c. What goes out now: the rows just leased, and the retries that are due (a lease that
  --    expired after a crashed run is claimed again the same way; a batch's rows retry together).
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
    returning d.id, d.attempts, d.notification_id, d.batch_id
  ), outgoing as (
    select l.id, l.attempts, l.notification_id, l.batch_id from leased l
    union all
    select d.id, d.attempts, d.notification_id, d.batch_id from public.notification_deliveries d where d.id = any (v_new)
  )
  select o.id, n.recipient_id, m.email, n.id, n.kind, n.title, n.body, n.link, o.attempts, o.batch_id, n.escalation_level
  from outgoing o
  join public.notifications n on n.id = o.notification_id
  join public.members m on m.id = n.recipient_id;
end;
$$;
comment on function public.email_claim(timestamptz, integer) is
  '5.2, 5.3; service_role only (the dispatcher, ARCHITECTURE §9): queues the email rows a notification '
  'needs (always_email kinds; actionable kinds when the person has no active push subscription and '
  'the push was not sent; rows of the last 24 hours, active members with an address), then leases '
  'them in groups under an advisory lock: a person''s always-emailed rows as one batch (one email, '
  'counted once), a fallback row alone; escalations first. Ceilings: ordinary groups stop at '
  'email_daily_cap_org - 10 and at email_daily_cap_per_member; an escalation only at '
  'email_daily_cap_org (skipped_cap, last_error org_cap | member_cap). Returns what goes out now '
  'with batch_id and escalation_level; the caller sends a batch as one email and records each row '
  'through email_record().';
revoke all on function public.email_claim(timestamptz, integer) from public, anon, authenticated;
grant execute on function public.email_claim(timestamptz, integer) to service_role;
