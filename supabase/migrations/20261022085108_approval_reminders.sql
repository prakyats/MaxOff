-- v1.9 W3: approval reminders to the Owner and the decision-email policy (ROADMAP v1.9 W3; 6b.5 and
--   6b.9; kickoff 6b decisions 2 and 6, owner 2026-10-16 "all as recommended"; WORKFLOWS §8
--   approval_reminders, §9; DATA-MODEL org_settings, notifications, approval_reminder_sends;
--   PERMISSIONS "As built (v1.9 W3)").
--
-- 1. org_settings: the working hours (work_start_time 10:00, work_end_time 18:00; W0 reads them too)
--    and the reminder cadence (urgent every 60 minutes, high at 11:00 / 14:00 / 17:00, medium and
--    low daily at 11:00), in the API UPDATE grant (settings.manage through the existing policy).
-- 2. The kind approval_reminder: in-app and push, never email.
-- 3. notifications.no_email + app.notify() (same signature) setting it on an approved decision, and
--    email_claim() (same signature) skipping such rows: an approved attendance day, leave, comp
--    leave or expense claim is never emailed; rejected or corrected keep the fallback (6b.9).
-- 4. approval_reminder_sends (RLS, no API access) and app.approval_reminders(now), scheduled every
--    5 minutes: idempotent per slot, working days only, the Owner only.
--
-- Expand-only (ARCHITECTURE §18): new columns are defaulted, functions are re-created with the same
-- signatures, nothing is dropped or renamed. Append-only: never edit once applied (a pushed
-- migration counts as applied).

-- 1. Settings -------------------------------------------------------------------------------------
alter table public.org_settings
  add column work_start_time time not null default '10:00',
  add column work_end_time time not null default '18:00',
  add column approval_reminder_urgent_minutes integer not null default 60,
  add column approval_reminder_high_times time[] not null default '{11:00,14:00,17:00}',
  add column approval_reminder_daily_time time not null default '11:00',
  add constraint org_settings_work_hours_order check (work_start_time < work_end_time),
  add constraint org_settings_approval_urgent_range check (approval_reminder_urgent_minutes between 15 and 480),
  add constraint org_settings_approval_high_times_count check (
    cardinality(approval_reminder_high_times) between 1 and 8
    and array_position(approval_reminder_high_times, null) is null);
grant update (work_start_time, work_end_time, approval_reminder_urgent_minutes,
              approval_reminder_high_times, approval_reminder_daily_time)
  on public.org_settings to authenticated;

comment on column public.org_settings.work_start_time is
  'v1.9 (6b.1, 6b.5): the working day''s start, IST (10:00). Owner-editable (settings.manage).';
comment on column public.org_settings.work_end_time is
  'v1.9 (6b.1, 6b.5): the working day''s end, IST (18:00); after the start. Owner-editable.';
comment on column public.org_settings.approval_reminder_urgent_minutes is
  'v1.9 W3 (6b.5): an urgent task waiting for the Owner is reminded this often (minutes, 15-480) '
  'from work_start_time to before work_end_time, one push per task.';
comment on column public.org_settings.approval_reminder_high_times is
  'v1.9 W3 (6b.5): the IST times of the grouped reminder for high-priority tasks waiting for the '
  'Owner (11:00, 14:00, 17:00; 1-8 times).';
comment on column public.org_settings.approval_reminder_daily_time is
  'v1.9 W3 (6b.5): the IST time of the grouped reminder for medium and low tasks waiting for the '
  'Owner, with the leave and attendance waiting as one line each (11:00).';

-- 2. The kind -------------------------------------------------------------------------------------
insert into public.notification_kinds (kind, actionable, always_email, description) values
  ('approval_reminder', false, false,
   'Tasks (and, at the daily time, leave and attendance) still waiting for the Owner''s approval (v1.9 W3)');

-- 3. The decision-email policy ----------------------------------------------------------------------
alter table public.notifications
  add column no_email boolean not null default false;
comment on column public.notifications.no_email is
  'v1.9 W3 (6b.9): never emailed, even as the fallback for a person with no working push. Set by '
  'app.notify() on an approved attendance day, leave or expense decision; read by email_claim().';

create or replace function app.notify(
  p_recipients uuid[],
  p_kind text,
  p_title text,
  p_body text default null,
  p_link text default null,
  p_entity text default null,
  p_entity_id uuid default null,
  p_payload jsonb default '{}'::jsonb,
  p_actor uuid default auth.uid(),
  p_escalation_level integer default 0
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_target record;
  v_seen uuid[] := '{}';
  v_count integer := 0;
  v_id uuid;
  v_title text;
  v_payload jsonb;
  v_no_email boolean;
begin
  if p_kind is null or not exists (select 1 from public.notification_kinds k where k.kind = p_kind) then
    perform app.fail('VALIDATION', format('"%s" is not a notification kind.', coalesce(p_kind, '')));
  end if;
  if nullif(btrim(coalesce(p_title, '')), '') is null then
    perform app.fail('VALIDATION', 'A notification needs a title.');
  end if;

  -- v1.9 W3 (6b.9, kickoff 6b decision 6): an approved attendance day, leave (comp leave included) or
  -- expense claim is never emailed. The decision is the one this transaction audited on the record:
  -- 'approved' (rejected, corrected, cancelled, changed and paid keep the actionable fallback).
  v_no_email := p_kind in ('attendance_decided', 'leave_decided', 'expense_decided')
    and p_entity_id is not null
    and exists (select 1 from public.activity_log a
                where a.entity = p_entity and a.entity_id = p_entity_id
                  and a.at = now() and a.action = 'approved');

  -- Each named recipient in turn: an active member gets the row; a freelancer's row goes to their
  -- current coordinator, worded for them (ADR-0013 §4); anyone else (deactivated, invited, unknown)
  -- is dropped. The actor is never told (kickoff 5 decision 2), and a person reached twice (two
  -- roles, or two freelancers with one coordinator) gets one row.
  for v_target in
    select
      case when m.engagement = 'freelance' then app.coordinator_of(m.id) else m.id end as recipient_id,
      m.org_id,
      case when m.engagement = 'freelance' then m.id end as for_member_id,
      case when m.engagement = 'freelance' then m.full_name end as for_member_name
    from unnest(p_recipients) with ordinality as r(id, ord)
    join public.members m on m.id = r.id and m.status = 'active'
    order by r.ord
  loop
    if v_target.recipient_id is null or v_target.recipient_id = p_actor or v_target.recipient_id = any (v_seen) then
      continue;
    end if;
    if not exists (select 1 from public.members c where c.id = v_target.recipient_id and c.status = 'active') then
      continue;
    end if;
    v_seen := array_append(v_seen, v_target.recipient_id);
    v_title := left(btrim(p_title), 200);
    v_payload := coalesce(p_payload, '{}'::jsonb);
    if v_target.for_member_id is not null then
      v_title := left(btrim(p_title) || ' · for ' || v_target.for_member_name, 200);
      v_payload := v_payload || jsonb_build_object('for_member_id', v_target.for_member_id);
    end if;
    insert into public.notifications (
      org_id, recipient_id, actor_id, kind, title, body, link, entity, entity_id, payload, escalation_level,
      no_email)
    values (
      v_target.org_id, v_target.recipient_id, p_actor, p_kind, v_title, left(p_body, 2000), p_link,
      p_entity, p_entity_id, v_payload, coalesce(p_escalation_level, 0), v_no_email)
    returning id into v_id;
    insert into public.notification_deliveries (notification_id, channel) values (v_id, 'push');
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;
comment on function app.notify(uuid[], text, text, text, text, text, uuid, jsonb, uuid, integer) is
  '5.1, service_role only (called by the transition functions and jobs, ADR-0006): one '
  'notifications row per remaining recipient plus a queued push delivery each. Drops the actor, '
  'duplicates and anyone not active; a freelancer''s row goes to their current coordinator with '
  '" · for <name>" on the title and payload.for_member_id (ADR-0013 §4; nobody when they have '
  'none, or the coordinator is the actor). Email rows are the dispatcher''s (notification_kinds). '
  'Returns the number of rows written. Never pass money in the title, body, link or payload. '
  'v1.9 W3 (6b.9): no_email is set on an attendance_decided, leave_decided or expense_decided row '
  'about a record this transaction audited ''approved'' (an approval is never emailed).';
revoke all on function app.notify(uuid[], text, text, text, text, text, uuid, jsonb, uuid, integer) from public, authenticated;
grant execute on function app.notify(uuid[], text, text, text, text, text, uuid, jsonb, uuid, integer) to service_role;

create or replace function public.email_claim(p_now timestamptz default now(), p_limit integer default 20)
returns table (
  delivery_id uuid, recipient_id uuid, email text, notification_id uuid, kind text,
  title text, body text, link text, attempts integer, batch_id uuid, escalation_level integer,
  payload jsonb)
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
    -- v1.9 W3 (6b.9): an approved decision is never emailed, not even as the fallback.
    and not n.no_email
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

  -- b. New rows, as groups: a person's always-emailed rows together, a fallback row alone, the
  --    Owner's digest alone (5B: never batched; 6.5: the weekly one the same). The digest is taken
  --    into the run before other rows; groups holding an escalation first, then the digest, then
  --    the oldest; each passes the ceilings once or is skipped (the digest as an ordinary email).
  for v_group in
    with fresh as (
      select d.id, d.created_at, n.recipient_id, n.org_id, n.escalation_level, k.always_email,
             n.kind in ('owner_digest', 'owner_digest_weekly') as digest,
             s.email_daily_cap_org, s.email_daily_cap_per_member
      from public.notification_deliveries d
      join public.notifications n on n.id = d.notification_id
      join public.notification_kinds k on k.kind = n.kind
      join public.org_settings s on s.org_id = n.org_id
      where d.channel = 'email' and d.state = 'queued' and d.attempts = 0 and d.next_attempt_at <= p_now
      order by (n.kind in ('owner_digest', 'owner_digest_weekly')) desc, d.created_at, n.created_at, d.id
      limit p_limit
      for update of d skip locked
    )
    select array_agg(f.id order by f.created_at, f.id) as ids,
           min(f.created_at) as created_at, f.recipient_id, f.org_id,
           bool_or(f.escalation_level > 0) as escalation,
           bool_and(f.always_email and not f.digest) as batched,
           max(f.email_daily_cap_org) as cap_org, max(f.email_daily_cap_per_member) as cap_member
    from fresh f
    group by f.recipient_id, f.org_id, case when f.always_email and not f.digest then null else f.id end
    order by bool_or(f.escalation_level > 0) desc, bool_or(f.digest) desc, min(f.created_at)
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
  select o.id, n.recipient_id, m.email, n.id, n.kind, n.title, n.body, n.link, o.attempts, o.batch_id,
         n.escalation_level, n.payload
  from outgoing o
  join public.notifications n on n.id = o.notification_id
  join public.members m on m.id = n.recipient_id;
end;
$$;
comment on function public.email_claim(timestamptz, integer) is
  '5.2, 5.3, 5B, 6.5, v1.9 W3; service_role only (the dispatcher, ARCHITECTURE §9): queues the email rows a '
  'notification needs (always_email kinds; actionable kinds when the person has no active push '
  'subscription and the push was not sent; never a no_email row (v1.9 W3: an approved decision); rows of the last 24 hours, active members with an '
  'address), then leases them in groups under an advisory lock: a person''s always-emailed rows as '
  'one batch (one email, counted once), a fallback row alone, the Owner''s digest (owner_digest, '
  'owner_digest_weekly) alone and taken into the run first; escalations first, then the digest, '
  'then the oldest. Ceilings: ordinary groups (the digest included) stop at email_daily_cap_org - '
  '10 and at email_daily_cap_per_member; an escalation only at email_daily_cap_org (skipped_cap, '
  'last_error org_cap | member_cap). Returns what goes out now with batch_id, escalation_level and '
  'the notification''s payload; the caller sends a batch as one email and records each row through '
  'email_record().';
revoke all on function public.email_claim(timestamptz, integer) from public, anon, authenticated;
grant execute on function public.email_claim(timestamptz, integer) to service_role;

-- 4. The reminders --------------------------------------------------------------------------------
create table public.approval_reminder_sends (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id),
  -- Cascades exist for the local stack's fixture deletes only: production never deletes a member or a task.
  recipient_id uuid not null references public.members (id) on delete cascade,
  slot_at timestamptz not null,
  slot text not null check (slot in ('urgent', 'grouped')),
  task_id uuid null references public.tasks (id) on delete cascade,
  notified boolean not null,
  created_at timestamptz not null default now(),
  constraint approval_reminder_sends_task_matches_slot check ((slot = 'urgent') = (task_id is not null))
);
comment on table public.approval_reminder_sends is
  'v1.9 W3 (6b.5): each reminder slot handled once (a grouped slot per organisation, an urgent slot '
  'per task); notified false = the slot was decided and nothing was waiting. Written only by '
  'app.approval_reminders(); no API access for any role.';
create unique index approval_reminder_sends_grouped_key
  on public.approval_reminder_sends (org_id, slot_at) where task_id is null;
create unique index approval_reminder_sends_task_key
  on public.approval_reminder_sends (org_id, slot_at, task_id) where task_id is not null;
create index approval_reminder_sends_task_idx on public.approval_reminder_sends (task_id) where task_id is not null;
create index approval_reminder_sends_recipient_idx on public.approval_reminder_sends (recipient_id);
alter table public.approval_reminder_sends enable row level security;
revoke all on public.approval_reminder_sends from public, anon, authenticated;

-- Is an IST time of day inside the organisation's quiet hours (start > end wraps midnight)?
create function app.in_quiet_hours(p_at time, p_start time, p_end time)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case
    when p_start is null or p_end is null or p_start = p_end then false
    when p_start < p_end then p_at >= p_start and p_at < p_end
    else p_at >= p_start or p_at < p_end
  end;
$$;
comment on function app.in_quiet_hours(time, time, time) is
  'v1.9 W3, service_role only: true when the IST time falls in [start, end), wrapping midnight when '
  'start > end; never when start = end.';
revoke all on function app.in_quiet_hours(time, time, time) from public, anon, authenticated;
grant execute on function app.in_quiet_hours(time, time, time) to service_role;

-- "2 days", "1 day", "today": how long the oldest waited, in IST dates.
create function app.approval_waited(p_since timestamptz, p_today date)
returns text
language sql
stable
set search_path = ''
as $$
  select case greatest(p_today - app.to_ist_date(p_since), 0)
    when 0 then 'today'
    when 1 then '1 day'
    else (p_today - app.to_ist_date(p_since))::text || ' days'
  end;
$$;
revoke all on function app.approval_waited(timestamptz, date) from public, anon, authenticated;
grant execute on function app.approval_waited(timestamptz, date) to service_role;

create function app.approval_reminders(p_now timestamptz default now())
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_today date := app.to_ist_date(p_now);
  v_time time := (p_now at time zone 'Asia/Kolkata')::time;
  v_set public.org_settings;
  v_owner uuid;
  v_every interval;
  v_slot time;
  v_slot_at timestamptz;
  v_task record;
  v_high boolean;
  v_daily boolean;
  v_tasks integer;
  v_oldest timestamptz;
  v_leave integer;
  v_days integer;
  v_lines text[];
  v_title text;
  v_send uuid;
  v_written integer := 0;
begin
  -- Working days only (kickoff 6b decision 2): a weekly off or a holiday sends nothing. Null from
  -- is_working_day() means "unknown", which is not a day off.
  if app.is_working_day(v_today) is false then
    return 0;
  end if;

  for v_set in select s.* from public.org_settings s order by s.org_id loop
    -- One run per organisation at a time: two overlapping runs never send a slot twice.
    perform pg_advisory_xact_lock(hashtext('app.approval_reminders:' || v_set.org_id::text));
    v_owner := app.org_owner_id(v_set.org_id);
    -- No active Owner: nothing is sent and no slot is used up.
    continue when v_owner is null;

    -- a. Urgent: one push per task at each slot of the working hours (start, then every N minutes,
    --    before the end), for a task that has waited at least N minutes; the latest slot passed only.
    v_every := make_interval(mins => v_set.approval_reminder_urgent_minutes);
    if v_time >= v_set.work_start_time and v_time < v_set.work_end_time then
      v_slot := v_set.work_start_time
        + v_every * floor(extract(epoch from (v_time - v_set.work_start_time)) / extract(epoch from v_every))::integer;
      v_slot_at := app.ist_day_start(v_today) + (v_slot - time '00:00');
      -- A slot inside the quiet hours sends nothing: the next slot covers the task.
      if not app.in_quiet_hours(v_slot, v_set.quiet_hours_start, v_set.quiet_hours_end) then
        for v_task in
          select t.id, t.title, t.admin_approved_at
          from public.tasks t
          where t.org_id = v_set.org_id and t.state = 'admin_approved' and t.priority = 'urgent'
            and t.archived_at is null and t.admin_approved_at <= v_slot_at - v_every
          order by t.admin_approved_at, t.id
        loop
          insert into public.approval_reminder_sends (org_id, recipient_id, slot_at, slot, task_id, notified)
          values (v_set.org_id, v_owner, v_slot_at, 'urgent', v_task.id, true)
          on conflict do nothing
          returning id into v_send;
          continue when v_send is null;
          v_written := v_written + app.notify(array[v_owner], 'approval_reminder',
            format('%s is waiting for your approval', v_task.title),
            format('Urgent · waiting since %s', app.notify_when(v_task.admin_approved_at)),
            '/tasks/' || v_task.id, 'tasks', v_task.id,
            jsonb_build_object('slot', 'urgent', 'slot_at', v_slot_at, 'task_id', v_task.id), null);
        end loop;
      end if;
    end if;

    -- b. Grouped: the latest slot passed today among the high times and the daily time (the same
    --    time twice is one slot), once.
    select max(x.t) into v_slot
    from unnest(v_set.approval_reminder_high_times || v_set.approval_reminder_daily_time) as x(t)
    where x.t <= v_time;
    continue when v_slot is null;
    v_slot_at := app.ist_day_start(v_today) + (v_slot - time '00:00');
    v_high := v_slot = any (v_set.approval_reminder_high_times);
    v_daily := v_slot = v_set.approval_reminder_daily_time;

    select count(*)::integer, min(t.admin_approved_at) into v_tasks, v_oldest
    from public.tasks t
    where t.org_id = v_set.org_id and t.state = 'admin_approved' and t.archived_at is null
      and ((v_high and t.priority = 'high') or (v_daily and t.priority in ('medium', 'low')));

    v_leave := 0;
    v_days := 0;
    if v_daily then
      select count(*)::integer into v_leave
      from public.leave_requests l
      join public.members m on m.id = l.member_id
      where m.org_id = v_set.org_id and l.state = 'submitted' and l.source <> 'attendance';
      select count(*)::integer into v_days
      from public.attendance_days d
      join public.members m on m.id = d.member_id
      where m.org_id = v_set.org_id and d.state = 'pending_review';
    end if;

    insert into public.approval_reminder_sends (org_id, recipient_id, slot_at, slot, task_id, notified)
    values (v_set.org_id, v_owner, v_slot_at, 'grouped', null, v_tasks + v_leave + v_days > 0)
    on conflict do nothing
    returning id into v_send;
    continue when v_send is null or v_tasks + v_leave + v_days = 0;

    v_lines := array[]::text[];
    if v_leave > 0 then
      v_lines := v_lines || format('%s leave %s waiting', v_leave,
        case when v_leave = 1 then 'request' else 'requests' end);
    end if;
    if v_days > 0 then
      v_lines := v_lines || format('%s attendance %s waiting', v_days,
        case when v_days = 1 then 'day' else 'days' end);
    end if;
    v_title := case
      when v_tasks = 0 then 'Waiting for your approval'
      when v_tasks = 1 then format('1 task waiting for your approval · %s',
        case app.approval_waited(v_oldest, v_today) when 'today' then 'since today'
             else 'waiting ' || app.approval_waited(v_oldest, v_today) end)
      else format('%s tasks waiting for your approval · oldest %s', v_tasks,
        app.approval_waited(v_oldest, v_today))
    end;
    v_written := v_written + app.notify(array[v_owner], 'approval_reminder', v_title,
      nullif(array_to_string(v_lines, E'\n'), ''),
      case when v_tasks > 0 then '/approvals#tasks' else '/approvals' end, null, null,
      jsonb_build_object('slot', 'grouped', 'slot_at', v_slot_at, 'tasks', v_tasks, 'leave', v_leave,
        'attendance', v_days),
      null);
  end loop;
  return v_written;
end;
$$;
comment on function app.approval_reminders(timestamptz) is
  'v1.9 W3 (6b.5, kickoff 6b decision 2), service_role only (pg_cron every 5 minutes): repeat '
  'reminders to the Owner for what waits for their approval, working days only, per organisation '
  'under an advisory lock, nothing without an active Owner. Urgent admin_approved tasks: one '
  'approval_reminder each at the latest slot of the working hours (work_start_time, then every '
  'approval_reminder_urgent_minutes, before work_end_time) once they have waited that long; none '
  'inside the quiet hours. Grouped: at the latest slot passed among approval_reminder_high_times '
  '(high tasks) and approval_reminder_daily_time (medium and low tasks, plus the leave requests and '
  'attendance days waiting as one line each), one row "N tasks waiting for your approval · oldest D '
  'days" opening /approvals#tasks, nothing when nothing waits. Each slot once '
  '(approval_reminder_sends). Never emailed. Returns the notification rows written.';
revoke all on function app.approval_reminders(timestamptz) from public, anon, authenticated;
grant execute on function app.approval_reminders(timestamptz) to service_role;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'approval_reminders') then
    perform cron.unschedule('approval_reminders');
  end if;
  perform cron.schedule('approval_reminders', '*/5 * * * *', 'select app.approval_reminders(now())');
end;
$$;
