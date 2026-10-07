-- 5.1 (unit 5A, step 1): the notification tables, app.notify() and the retrofit of every existing
-- producer (WORKFLOWS §9, "Settled at kickoff 5", the 5A build decisions 15-26 in PROGRESS).
-- Expand-only (ARCHITECTURE §18, kickoff 3c decision 7): new tables and columns, new helpers, and
-- CREATE OR REPLACE of the existing transition functions with the same signatures, adding only the
-- notification rows they name in their comments.
--
-- 1. notification_kinds: the kinds the code depends on, as data (DATA-MODEL §0): `actionable`
--    (email fallback for a person with no working push; kickoff 5 decision 6) and `always_email`
--    (the always-email set). Comments and information-only rows are neither, so never email.
-- 2. notifications: one row per person per event (the in-app history and the deep link);
--    RLS: the recipient only, select + update of read_at (a column grant). No API insert/delete.
--    Not audited: a row records that a person was told; the event itself is audited by the
--    transition that produced it (as task_reads, 4C).
-- 3. notification_deliveries: one row per channel; `queued` push at insert, the rest is the
--    dispatcher's (5.2 push, 5.1 step 4 email, quiet hours `held`, the caps `skipped_cap`).
--    No API access at all (service_role only).
-- 4. push_subscriptions (WORKFLOWS §9a): own rows; the delivery-result columns are the
--    dispatcher's (service_role).
-- 5. org_settings: quiet_hours_start / quiet_hours_end / email_daily_cap_org (kickoff 5).
-- 6. app.notify(): the one writer (kickoff 5 decision 3): dedupes recipients, drops the actor and
--    anyone not active, routes a freelancer's rows to their current coordinator "for Asha"
--    (ADR-0013 §4), inserts the rows and a queued push delivery each. Service_role only.
-- 7. notifications_mark_read(entity, entity_id) and notifications_mark_all_read(): the caller's
--    own rows.
-- 8. The retrofits (part 2 of this file).

-- 1. Kinds ------------------------------------------------------------------------------------------
create table public.notification_kinds (
  kind text primary key,
  -- Email fallback for a person with no working push (kickoff 5 decision 6): assigned, changes
  -- requested, due-now and overdue reminders, escalations, leave / attendance / comp leave /
  -- expense decisions. Never comments, "task changed" or information rows.
  actionable boolean not null default false,
  -- The always-email set (ADR-0009): task assigned, escalations, an event tomorrow, the digest.
  always_email boolean not null default false,
  description text not null
);
comment on table public.notification_kinds is
  '5.1: the notification kinds the code depends on, as data. actionable = email fallback when '
  'the person has no working push (kickoff 5 decision 6); always_email = emailed to everyone '
  '(ADR-0009). Neither = in-app and push only (comments, information rows). 5B adds the reminder, '
  'escalation, digest and reachability kinds.';

insert into public.notification_kinds (kind, actionable, always_email, description) values
  ('task_assigned',           true,  true,  'A task was assigned to you (or a person you coordinate)'),
  ('task_unassigned',         false, false, 'You were taken off a task (no task named: decision 25)'),
  ('task_changed',            false, false, 'A task you are on changed (deadline, scope, priority, people)'),
  ('task_submitted',          false, false, 'A task was marked Done and waits for your review'),
  ('task_admin_approved',     false, false, 'The approving Admin approved a task; the Owner decides'),
  ('task_changes_requested',  true,  false, 'A reviewer asked for changes'),
  ('task_completed',          false, false, 'The Owner completed a task'),
  ('task_cancelled',          false, false, 'A task was cancelled'),
  ('task_reopened',           false, false, 'A task was reopened'),
  ('task_comment',            false, false, 'A comment on a task you are part of (never email: decision 15)'),
  ('task_request_created',    false, false, 'Someone suggested a task'),
  ('task_request_converted',  false, false, 'Your suggestion became a task'),
  ('task_request_declined',   false, false, 'Your suggestion was declined'),
  ('coordinator_assigned',    false, false, 'You now coordinate a freelancer'),
  ('coordinator_removed',     false, false, 'A freelancer you coordinated has another coordinator'),
  ('coordinator_missing',     false, false, 'A freelancer has no coordinator (decision 17)'),
  ('client_admin_assigned',   false, false, 'You now run a client (or several: decision 18)'),
  ('client_admin_removed',    false, false, 'A client you ran was handed over (no client named: decision 25)'),
  ('attendance_decided',      true,  false, 'The Owner approved or corrected an attendance day'),
  ('absent_proposed',         false, false, 'The 23:59 job proposed absences (one row per run)'),
  ('leave_requested',         false, false, 'A leave request, change or cancellation for the Owner'),
  ('leave_decided',           true,  false, 'Leave approved, rejected, cancelled or changed'),
  ('extra_work_submitted',    false, false, 'An overtime or day-off work note for the Owner'),
  ('extra_work_decided',      true,  false, 'An extra work note was reviewed (comp leave or not)'),
  ('comp_leave_granted',      true,  false, 'Comp leave granted'),
  ('comp_leave_revoked',      true,  false, 'Comp leave revoked'),
  ('expense_submitted',       false, false, 'An expense claim for the Owner (never an amount)'),
  ('expense_decided',         true,  false, 'An expense claim approved, rejected or paid (never an amount)'),
  ('end_day_reminder',        false, false, 'You have not ended your day (20:30)');

revoke all on public.notification_kinds from anon;
revoke insert, update, delete, truncate, references, trigger on public.notification_kinds from authenticated;
alter table public.notification_kinds enable row level security;
create policy notification_kinds_select on public.notification_kinds for select to authenticated using (true);

-- 2. notifications ----------------------------------------------------------------------------------
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id),
  -- cascade: a member row is deleted only on the local stack (e2e fixtures); production
  -- deactivates. A person's rows go with them, as their view state would.
  recipient_id uuid not null references public.members (id) on delete cascade,
  actor_id uuid null references public.members (id) on delete set null,
  kind text not null references public.notification_kinds (kind),
  title text not null check (length(title) between 1 and 200),
  body text null check (body is null or length(body) <= 2000),
  -- An app route the recipient can open (ARCHITECTURE §14.2 h: the parent list underneath).
  link text null check (link is null or (link like '/%' and length(link) <= 500)),
  entity text null,
  entity_id uuid null,
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  escalation_level integer not null default 0 check (escalation_level between 0 and 2),
  created_at timestamptz not null default now(),
  read_at timestamptz null,
  constraint notifications_entity_pair check ((entity is null) = (entity_id is null))
);
comment on table public.notifications is
  '5.1: one row per person per event (kickoff 5 decision 2), written only by app.notify() inside '
  'the transition that caused it (ADR-0006). The in-app history and the deep link; deliveries are '
  'notification_deliveries. RLS: the recipient only; the API may update read_at alone. Never '
  'purged (decision 4). Money never appears in title, body, link or payload (invariant 2, '
  'decision 24). Not audited: the event is audited by its transition; a read is view state.';

create index notifications_recipient_unread_idx on public.notifications (recipient_id, read_at, created_at desc);
create index notifications_recipient_created_idx on public.notifications (recipient_id, created_at desc);
create index notifications_entity_idx on public.notifications (entity, entity_id) where entity is not null;
create index notifications_actor_idx on public.notifications (actor_id);
create index notifications_org_idx on public.notifications (org_id);

-- The recipient's read receipt is the only API write: read_at, and nothing about the row.
create trigger protect_columns before update on public.notifications
  for each row execute function app.protect_columns(
    'org_id', 'recipient_id', 'actor_id', 'kind', 'title', 'body', 'link', 'entity', 'entity_id',
    'payload', 'escalation_level', 'created_at');

revoke all on public.notifications from anon;
revoke insert, update, delete, truncate, references, trigger on public.notifications from authenticated;
grant update (read_at) on public.notifications to authenticated;
alter table public.notifications enable row level security;
create policy notifications_select on public.notifications for select to authenticated
  using (recipient_id = auth.uid());
create policy notifications_update on public.notifications for update to authenticated
  using (recipient_id = auth.uid())
  with check (recipient_id = auth.uid());

-- 3. notification_deliveries -------------------------------------------------------------------------
create table public.notification_deliveries (
  id uuid primary key default gen_random_uuid(),
  notification_id uuid not null references public.notifications (id) on delete cascade,
  channel text not null check (channel in ('push', 'email')),
  -- queued → sent | failed; held (push inside quiet hours, released as one summary push);
  -- skipped_cap (email over the per-person or org ceiling). The dispatcher owns every move.
  state text not null default 'queued' check (state in ('queued', 'held', 'sent', 'failed', 'skipped_cap')),
  attempts integer not null default 0 check (attempts >= 0),
  last_error text null,
  sent_at timestamptz null,
  next_attempt_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (notification_id, channel)
);
comment on table public.notification_deliveries is
  '5.1: one delivery per notification and channel. app.notify() queues the push row; the '
  'dispatcher (push_dispatch, worker, 5.2 / step 3) sends it, holds it in quiet hours and '
  'releases one summary per person (kickoff 5 decision 5); the email row is queued by the '
  'dispatcher for actionable kinds when the person has no working push and for always_email kinds '
  '(step 4), within the two ceilings (skipped_cap). No API access: service_role only.';
create index notification_deliveries_due_idx on public.notification_deliveries (next_attempt_at)
  where state in ('queued', 'held');
create index notification_deliveries_notification_idx on public.notification_deliveries (notification_id);

revoke all on public.notification_deliveries from anon, authenticated;
alter table public.notification_deliveries enable row level security;

-- 4. push_subscriptions -----------------------------------------------------------------------------
create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null default auth.uid() references public.members (id) on delete cascade,
  endpoint text not null unique check (length(endpoint) between 1 and 2048),
  p256dh text not null check (length(p256dh) between 1 and 512),
  auth text not null check (length(auth) between 1 and 512),
  user_agent text null check (user_agent is null or length(user_agent) <= 512),
  platform text not null default 'other' check (platform in ('android', 'ios', 'desktop', 'other')),
  is_standalone boolean not null default false,
  label text null check (label is null or length(label) <= 120),
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  last_success_at timestamptz null,
  last_failure_at timestamptz null,
  failure_count integer not null default 0 check (failure_count >= 0),
  disabled_at timestamptz null,
  disabled_reason text null check (disabled_reason in ('gone', 'expired', 'signed_out', 'deactivated')),
  last_test_at timestamptz null,
  constraint push_subscriptions_disabled_pair check ((disabled_at is null) = (disabled_reason is null))
);
comment on table public.push_subscriptions is
  '5.1 (WORKFLOWS §9a): a member''s Web Push subscriptions, one per browser or installed app. Own '
  'rows only: a member inserts (endpoint, keys, platform, is_standalone, label, user_agent), '
  'updates the keys, label, platform, is_standalone, user_agent and last_seen_at, and deletes '
  '("Sign out of this device"); the result columns (last_success_at, last_failure_at, '
  'failure_count, disabled_*, last_test_at) are the dispatcher''s (service_role). A freelancer '
  'has no login, so never a row. Deactivation disables every row (''deactivated''). Nobody but the '
  'member ever reads an endpoint.';
create index push_subscriptions_member_idx on public.push_subscriptions (member_id) where disabled_at is null;

create trigger protect_columns before update on public.push_subscriptions
  for each row execute function app.protect_columns(
    'id', 'member_id', 'endpoint', 'created_at', 'last_success_at', 'last_failure_at', 'failure_count',
    'disabled_at', 'disabled_reason', 'last_test_at');

-- Only a permanent active member with a login subscribes, for themselves.
create or replace function app.push_subscriptions_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if app.in_transition() then
    return new;
  end if;
  if new.member_id is distinct from auth.uid() then
    perform app.fail('FORBIDDEN', 'A subscription belongs to the person who made it.');
  end if;
  if not exists (select 1 from app.current_member() m where m.engagement = 'permanent') then
    perform app.fail('FORBIDDEN', 'Your account cannot receive push notifications.');
  end if;
  return new;
end;
$$;
revoke all on function app.push_subscriptions_guard() from public;
grant execute on function app.push_subscriptions_guard() to authenticated, service_role;
create trigger subscriptions_guard before insert on public.push_subscriptions
  for each row execute function app.push_subscriptions_guard();

revoke all on public.push_subscriptions from anon;
revoke insert, update, delete, truncate, references, trigger on public.push_subscriptions from authenticated;
grant insert (member_id, endpoint, p256dh, auth, user_agent, platform, is_standalone, label)
  on public.push_subscriptions to authenticated;
grant update (p256dh, auth, user_agent, platform, is_standalone, label, last_seen_at)
  on public.push_subscriptions to authenticated;
grant delete on public.push_subscriptions to authenticated;
alter table public.push_subscriptions enable row level security;
create policy push_subscriptions_select on public.push_subscriptions for select to authenticated
  using (member_id = auth.uid());
create policy push_subscriptions_insert on public.push_subscriptions for insert to authenticated
  with check (member_id = auth.uid());
create policy push_subscriptions_update on public.push_subscriptions for update to authenticated
  using (member_id = auth.uid()) with check (member_id = auth.uid());
create policy push_subscriptions_delete on public.push_subscriptions for delete to authenticated
  using (member_id = auth.uid());

-- 5. org_settings (kickoff 5 decisions 5 and 7) ------------------------------------------------------
alter table public.org_settings
  add column quiet_hours_start time not null default '22:00',
  add column quiet_hours_end time not null default '07:00',
  add column email_daily_cap_org integer not null default 90 check (email_daily_cap_org > 0);
grant update (quiet_hours_start, quiet_hours_end, email_daily_cap_org) on public.org_settings to authenticated;

-- 6. Helpers and app.notify() ------------------------------------------------------------------------
create or replace function app.org_owner_id(p_org uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.id from public.members m
  where m.org_id = p_org and m.role = 'owner' and m.status = 'active'
  limit 1;
$$;
comment on function app.org_owner_id(uuid) is
  '5.1, service_role only: the organization''s active Owner (the recipient of every "→ Owner" row).';
revoke all on function app.org_owner_id(uuid) from public, authenticated;
grant execute on function app.org_owner_id(uuid) to service_role;

create or replace function app.member_name(p_member uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select m.full_name from public.members m where m.id = p_member), 'Someone');
$$;
comment on function app.member_name(uuid) is '5.1, service_role only: a person''s name for notification text.';
revoke all on function app.member_name(uuid) from public, authenticated;
grant execute on function app.member_name(uuid) to service_role;

create or replace function app.notify_date(d date)
returns text
language sql
immutable
parallel safe
strict
set search_path = ''
as $$
  select to_char(d, 'FMDD Mon');
$$;
create or replace function app.notify_when(t timestamptz)
returns text
language sql
immutable
parallel safe
strict
set search_path = ''
as $$
  select to_char(t at time zone 'Asia/Kolkata', 'FMDD Mon, HH24:MI');
$$;
create or replace function app.notify_span(s date, e date)
returns text
language sql
immutable
parallel safe
strict
set search_path = ''
as $$
  select case when s = e then app.notify_date(s) else app.notify_date(s) || ' to ' || app.notify_date(e) end;
$$;
comment on function app.notify_date(date) is '5.1: a date in notification text (IST, "12 Sep").';
comment on function app.notify_when(timestamptz) is '5.1: a moment in notification text (IST, "12 Sep, 18:00").';
comment on function app.notify_span(date, date) is '5.1: a date span in notification text ("12 Sep to 14 Sep").';
revoke all on function app.notify_date(date), app.notify_when(timestamptz), app.notify_span(date, date) from public, authenticated;
grant execute on function app.notify_date(date), app.notify_when(timestamptz), app.notify_span(date, date) to service_role;

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
begin
  if p_kind is null or not exists (select 1 from public.notification_kinds k where k.kind = p_kind) then
    perform app.fail('VALIDATION', format('"%s" is not a notification kind.', coalesce(p_kind, '')));
  end if;
  if nullif(btrim(coalesce(p_title, '')), '') is null then
    perform app.fail('VALIDATION', 'A notification needs a title.');
  end if;

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
      org_id, recipient_id, actor_id, kind, title, body, link, entity, entity_id, payload, escalation_level)
    values (
      v_target.org_id, v_target.recipient_id, p_actor, p_kind, v_title, left(p_body, 2000), p_link,
      p_entity, p_entity_id, v_payload, coalesce(p_escalation_level, 0))
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
  'Returns the number of rows written. Never pass money in the title, body, link or payload.';
revoke all on function app.notify(uuid[], text, text, text, text, text, uuid, jsonb, uuid, integer) from public, authenticated;
grant execute on function app.notify(uuid[], text, text, text, text, text, uuid, jsonb, uuid, integer) to service_role;

-- The task people a task row goes to: the active assignees, and the creator when asked.
create or replace function app.task_people(p_task_id uuid, p_with_creator boolean default false)
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select array(
    select a.member_id from public.task_assignees a
    where a.task_id = p_task_id and a.removed_at is null
    union
    select t.created_by from public.tasks t where t.id = p_task_id and p_with_creator);
$$;
comment on function app.task_people(uuid, boolean) is
  '5.1, service_role only: a task''s active assignees (+ the creator), the WORKFLOWS §9 recipients.';
revoke all on function app.task_people(uuid, boolean) from public, authenticated;
grant execute on function app.task_people(uuid, boolean) to service_role;

-- 7. Mark read ----------------------------------------------------------------------------------------
create or replace function public.notifications_mark_read(entity text, entity_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid := (select m.id from app.current_member() m);
  v_count integer;
begin
  if v_caller is null then
    perform app.fail('UNAUTHENTICATED', 'Your account is not active.');
  end if;
  if notifications_mark_read.entity is null or notifications_mark_read.entity_id is null then
    perform app.fail('VALIDATION', 'Name the record that was opened.');
  end if;
  update public.notifications n
  set read_at = now()
  where n.recipient_id = v_caller and n.read_at is null
    and n.entity = notifications_mark_read.entity and n.entity_id = notifications_mark_read.entity_id;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
comment on function public.notifications_mark_read(text, uuid) is
  '5.1: opening a record marks the caller''s unread notifications about it read (kickoff 5 '
  'decision 4). Own rows only. Returns how many were marked.';
revoke all on function public.notifications_mark_read(text, uuid) from public, anon;
grant execute on function public.notifications_mark_read(text, uuid) to authenticated, service_role;

create or replace function public.notifications_mark_all_read()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid := (select m.id from app.current_member() m);
  v_count integer;
begin
  if v_caller is null then
    perform app.fail('UNAUTHENTICATED', 'Your account is not active.');
  end if;
  update public.notifications n set read_at = now()
  where n.recipient_id = v_caller and n.read_at is null;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
comment on function public.notifications_mark_all_read() is
  '5.1: "Mark all read" for the caller (kickoff 5 decision 4). Own rows only. Returns how many.';
revoke all on function public.notifications_mark_all_read() from public, anon;
grant execute on function public.notifications_mark_all_read() to authenticated, service_role;

-- 8. Retrofits ----------------------------------------------------------------------------------------
-- Each function below is the definition on main with its notification rows added (WORKFLOWS §9,
-- the kickoff 5 and 5A decisions), same signature and behaviour otherwise. Links are app routes
-- the recipient can open; a person who lost access is told without the task or client named
-- or linked (decision 25); the actor is never told; no amounts (decision 24).

-- 8a. Tasks --------------------------------------------------------------------------------------------
create or replace function public.task_create(
  title text, description text, task_type_id uuid, client_id uuid, priority public.priority,
  due_at timestamptz, assignee_ids uuid[], primary_owner_id uuid, approving_admin_id uuid default null,
  event_date date default null, event_start_at timestamptz default null, event_end_at timestamptz default null,
  location text default null, purpose text default null, stages text[] default '{}',
  custom_fields jsonb default '{}', reminder_rules jsonb default null, template_id uuid default null,
  warnings jsonb default '[]')
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid;
  v_org uuid;
  v_is_owner boolean;
  v_title text := btrim(coalesce(task_create.title, ''));
  v_description text := nullif(btrim(coalesce(task_create.description, '')), '');
  v_location text := nullif(btrim(coalesce(task_create.location, '')), '');
  v_purpose text := nullif(btrim(coalesce(task_create.purpose, '')), '');
  v_type public.task_types;
  v_approver uuid;
  v_route text;
  v_ids uuid[];
  v_id uuid;
  v_member uuid;
  v_stage text;
  v_position text := null;
  v_reminders jsonb;
  v_task_id uuid := gen_random_uuid();
begin
  select r.caller_id, r.org_id, r.is_owner into v_caller, v_org, v_is_owner from app.task_require_creator() r;

  if v_title = '' then
    perform app.fail('VALIDATION', 'A title is required.');
  end if;
  if length(v_title) > 200 then
    perform app.fail('VALIDATION', 'Keep the title under 200 characters.');
  end if;
  if v_description is not null and length(v_description) > 10000 then
    perform app.fail('VALIDATION', 'Keep the description under 10000 characters.');
  end if;
  if task_create.priority is null then
    perform app.fail('VALIDATION', 'Pick a priority.');
  end if;

  select tt.* into v_type from public.task_types tt where tt.id = task_create.task_type_id;
  perform app.task_check_fields(v_org, v_is_owner, v_type, task_create.client_id, task_create.due_at, true,
    task_create.event_date, task_create.event_start_at, task_create.event_end_at, v_location, v_purpose, true);

  -- The approval route (PRODUCT §4.6 table; kickoff 4 decisions 2 and 3).
  if v_is_owner then
    v_approver := task_create.approving_admin_id;
    if v_approver is not null and not exists (
      select 1 from public.members m
      where m.id = v_approver and m.org_id = v_org and m.role = 'admin'
        and m.status = 'active' and m.engagement = 'permanent') then
      perform app.fail('VALIDATION', 'Choose an active Admin as the approver.');
    end if;
    v_route := case when v_approver is null then 'owner_direct' else 'owner_via_admin' end;
  else
    if task_create.approving_admin_id is not null and task_create.approving_admin_id <> v_caller then
      perform app.fail('VALIDATION', 'A task you create routes to you for approval.');
    end if;
    v_approver := v_caller;
    v_route := 'admin';
  end if;

  -- Assignees: active Admins, Staff or freelancers, never the Owner; the primary among them.
  v_ids := array(select distinct a from unnest(coalesce(task_create.assignee_ids, '{}'::uuid[])) a where a is not null);
  if coalesce(cardinality(v_ids), 0) = 0 then
    perform app.fail('VALIDATION', 'Assign at least one person.');
  end if;
  if task_create.primary_owner_id is null or not (task_create.primary_owner_id = any (v_ids)) then
    perform app.fail('VALIDATION', 'The primary owner must be one of the assignees.');
  end if;
  foreach v_member in array v_ids loop
    perform app.task_assignee_check(v_org, v_member);
  end loop;

  foreach v_stage in array coalesce(task_create.stages, '{}'::text[]) loop
    if length(btrim(coalesce(v_stage, ''))) not between 1 and 120 then
      perform app.fail('VALIDATION', 'Each stage needs a name of up to 120 characters.');
    end if;
  end loop;

  if task_create.custom_fields is null or jsonb_typeof(task_create.custom_fields) <> 'object' then
    perform app.fail('VALIDATION', 'Custom fields are an object.');
  end if;
  -- Kickoff 4 decision 14: no reminder editor yet; a task takes its type's defaults.
  v_reminders := coalesce(task_create.reminder_rules, v_type.default_reminders, '[]'::jsonb);
  if jsonb_typeof(v_reminders) <> 'array' then
    perform app.fail('VALIDATION', 'Reminder rules are a list.');
  end if;

  perform set_config('app.audit_override', jsonb_build_object(
    'action', 'created',
    'meta', jsonb_build_object('route', v_route, 'approving_admin_id', v_approver,
                               'assignee_ids', to_jsonb(v_ids), 'primary_owner_id', task_create.primary_owner_id))::text, true);
  insert into public.tasks (
    id, org_id, title, description, task_type_id, client_id, priority, due_at,
    event_date, event_start_at, event_end_at, location, purpose,
    state, approving_admin_id, admin_step, created_by, primary_owner_id,
    reminder_rules, custom_fields, template_id)
  values (
    v_task_id, v_org, v_title, v_description, v_type.id, task_create.client_id, task_create.priority, task_create.due_at,
    task_create.event_date, task_create.event_start_at, task_create.event_end_at, v_location, v_purpose,
    'todo', v_approver, (case when v_approver is null then 'none' else 'required' end)::public.admin_step, v_caller, task_create.primary_owner_id,
    v_reminders, task_create.custom_fields, task_create.template_id);

  foreach v_member in array v_ids loop
    perform set_config('app.audit_override', jsonb_build_object(
      'action', 'assigned',
      'meta', jsonb_build_object('member_id', v_member, 'is_primary', v_member = task_create.primary_owner_id))::text, true);
    insert into public.task_assignees (task_id, member_id, is_primary, assigned_by)
    values (v_task_id, v_member, v_member = task_create.primary_owner_id, v_caller);
  end loop;

  foreach v_stage in array coalesce(task_create.stages, '{}'::text[]) loop
    v_position := app.next_position(v_position);
    perform set_config('app.audit_override', jsonb_build_object(
      'action', 'stage_added', 'meta', jsonb_build_object('name', btrim(v_stage)))::text, true);
    insert into public.task_stages (task_id, name, position) values (v_task_id, btrim(v_stage), v_position);
  end loop;

  perform app.task_record_warnings(v_task_id, v_caller, v_ids, task_create.warnings);

  -- WORKFLOWS §9 "Task assigned": each assignee (a freelancer's goes to their coordinator).
  perform app.notify(v_ids, 'task_assigned', 'New task: ' || v_title,
    format('Assigned by %s · due %s', app.member_name(v_caller), app.notify_when(task_create.due_at)),
    '/tasks/' || v_task_id, 'tasks', v_task_id, jsonb_build_object('task_id', v_task_id));

  return v_task_id;
end;
$$;
comment on function public.task_create(text, text, uuid, uuid, public.priority, timestamptz, uuid[], uuid, uuid, date, timestamptz, timestamptz, text, text, text[], jsonb, jsonb, uuid, jsonb) is
  'tasks.create (the Owner and Admins). A task in todo with its route resolved (PRODUCT §4.6): the '
  'Owner names any active Admin as approver or none; an Admin''s task routes to that Admin and its '
  'client label must be one of their clients. Assignees are active Admins, Staff or freelancers, '
  'never the Owner; the primary owner is one of them. due_at is required and not in the past; the '
  'type decides the event fields (app.task_check_fields); reminder_rules default to the type''s; '
  'stages are typed names; warnings = [{kind, member_id, details}] the caller proceeded past. '
  'Audit: created (meta.route), assigned per person, stage_added, warning_overridden. 5.1: '
  'notifies each assignee (task_assigned; a freelancer''s coordinator, worded for them, ADR-0013) '
  'through app.notify().';

create or replace function public.task_update_assignment(task_id uuid, changes jsonb, warnings jsonb default '[]')
returns text[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid;
  v_org uuid;
  v_is_owner boolean;
  v_task public.tasks;
  v_type public.task_types;
  v_key text;
  v_changed text[] := '{}';
  -- The values after the change (start from the row, overwrite what `changes` names).
  v_title text;
  v_description text;
  v_task_type_id uuid;
  v_client_id uuid;
  v_priority public.priority;
  v_due_at timestamptz;
  v_event_date date;
  v_event_start_at timestamptz;
  v_event_end_at timestamptz;
  v_location text;
  v_purpose text;
  v_custom_fields jsonb;
  v_reminder_rules jsonb;
  v_primary uuid;
  v_new_ids uuid[];
  v_current_ids uuid[];
  v_member uuid;
  v_row public.task_assignees;
  -- 5.1
  v_removed uuid[] := '{}';
  v_added uuid[] := '{}';
  v_labels text[] := '{}';
begin
  select r.caller_id, r.org_id, r.is_owner into v_caller, v_org, v_is_owner from app.task_require_creator() r;
  if task_update_assignment.changes is null or jsonb_typeof(task_update_assignment.changes) <> 'object'
     or task_update_assignment.changes = '{}'::jsonb then
    perform app.fail('VALIDATION', 'Nothing to change.');
  end if;
  for v_key in select jsonb_object_keys(task_update_assignment.changes) loop
    if v_key not in ('title', 'description', 'task_type_id', 'client_id', 'priority', 'due_at',
                     'event_date', 'event_start_at', 'event_end_at', 'location', 'purpose',
                     'custom_fields', 'reminder_rules', 'assignee_ids', 'primary_owner_id') then
      perform app.fail('VALIDATION', format('"%s" is not a task field that can be changed here.', v_key));
    end if;
  end loop;

  v_task := app.task_lock(task_update_assignment.task_id, v_org);
  if not app.task_manager(v_task.id) then
    perform app.fail('FORBIDDEN', 'Only the task''s creator, its approving Admin or the Owner changes it.');
  end if;
  if v_task.state in ('completed', 'cancelled') then
    perform app.fail('INVALID_STATE', 'Reopen the task to change it.');
  end if;

  -- The values after the change; a value of the wrong shape is VALIDATION, never a raw cast error.
  begin
    v_title := case when changes ? 'title' then btrim(coalesce(changes ->> 'title', '')) else v_task.title end;
    v_description := case when changes ? 'description' then nullif(btrim(coalesce(changes ->> 'description', '')), '') else v_task.description end;
    v_task_type_id := case when changes ? 'task_type_id' then (changes ->> 'task_type_id')::uuid else v_task.task_type_id end;
    v_client_id := case when changes ? 'client_id' then (changes ->> 'client_id')::uuid else v_task.client_id end;
    v_priority := case when changes ? 'priority' then (changes ->> 'priority')::public.priority else v_task.priority end;
    v_due_at := case when changes ? 'due_at' then (changes ->> 'due_at')::timestamptz else v_task.due_at end;
    v_event_date := case when changes ? 'event_date' then (changes ->> 'event_date')::date else v_task.event_date end;
    v_event_start_at := case when changes ? 'event_start_at' then (changes ->> 'event_start_at')::timestamptz else v_task.event_start_at end;
    v_event_end_at := case when changes ? 'event_end_at' then (changes ->> 'event_end_at')::timestamptz else v_task.event_end_at end;
    v_location := case when changes ? 'location' then nullif(btrim(coalesce(changes ->> 'location', '')), '') else v_task.location end;
    v_purpose := case when changes ? 'purpose' then nullif(btrim(coalesce(changes ->> 'purpose', '')), '') else v_task.purpose end;
    v_custom_fields := case when changes ? 'custom_fields' then changes -> 'custom_fields' else v_task.custom_fields end;
    v_reminder_rules := case when changes ? 'reminder_rules' then changes -> 'reminder_rules' else v_task.reminder_rules end;
    v_primary := case when changes ? 'primary_owner_id' then (changes ->> 'primary_owner_id')::uuid else v_task.primary_owner_id end;
  exception
    when invalid_text_representation or invalid_datetime_format or datetime_field_overflow or data_exception then
      perform app.fail('VALIDATION', 'A field has the wrong format.');
  end;

  if v_title = '' then
    perform app.fail('VALIDATION', 'A title is required.');
  end if;
  if length(v_title) > 200 then
    perform app.fail('VALIDATION', 'Keep the title under 200 characters.');
  end if;
  if v_description is not null and length(v_description) > 10000 then
    perform app.fail('VALIDATION', 'Keep the description under 10000 characters.');
  end if;
  if v_priority is null then
    perform app.fail('VALIDATION', 'Pick a priority.');
  end if;
  if v_custom_fields is null or jsonb_typeof(v_custom_fields) <> 'object' then
    perform app.fail('VALIDATION', 'Custom fields are an object.');
  end if;
  if v_reminder_rules is null or jsonb_typeof(v_reminder_rules) <> 'array' then
    perform app.fail('VALIDATION', 'Reminder rules are a list.');
  end if;
  select tt.* into v_type from public.task_types tt where tt.id = v_task_type_id;
  perform app.task_check_fields(v_org, v_is_owner, v_type, v_client_id, v_due_at, false,
    v_event_date, v_event_start_at, v_event_end_at, v_location, v_purpose,
    (changes ? 'client_id') and v_client_id is distinct from v_task.client_id,
    -- An archived type blocks only a change to it, never an edit of a task that has it (4B review S7).
    (changes ? 'task_type_id') and v_task_type_id is distinct from v_task.task_type_id);

  -- Assignees: the full new set when given; the primary owner among the active rows either way.
  v_current_ids := array(select a.member_id from public.task_assignees a where a.task_id = v_task.id and a.removed_at is null);
  if changes ? 'assignee_ids' then
    if jsonb_typeof(changes -> 'assignee_ids') <> 'array' then
      perform app.fail('VALIDATION', 'assignee_ids is a list.');
    end if;
    begin
      v_new_ids := array(select distinct (e #>> '{}')::uuid from jsonb_array_elements(changes -> 'assignee_ids') e);
    exception when invalid_text_representation then
      perform app.fail('VALIDATION', 'assignee_ids names people by id.');
    end;
    if coalesce(cardinality(v_new_ids), 0) = 0 then
      perform app.fail('VALIDATION', 'Assign at least one person.');
    end if;
    foreach v_member in array v_new_ids loop
      perform app.task_assignee_check(v_org, v_member);
    end loop;
  else
    v_new_ids := v_current_ids;
  end if;
  if v_primary is null or not (v_primary = any (v_new_ids)) then
    perform app.fail('VALIDATION', 'The primary owner must be one of the assignees.');
  end if;

  -- Removed people keep their row with removed_at (WORKFLOWS §3.2).
  foreach v_member in array v_current_ids loop
    if not (v_member = any (v_new_ids)) then
      perform set_config('app.audit_override', jsonb_build_object(
        'action', 'unassigned', 'meta', jsonb_build_object('member_id', v_member))::text, true);
      update public.task_assignees set removed_at = now(), is_primary = false
      where task_assignees.task_id = v_task.id and member_id = v_member;
      v_changed := array_append(v_changed, 'assignee_ids');
      v_removed := array_append(v_removed, v_member);
    end if;
  end loop;
  -- A primary change first clears the old flag (one active primary per task).
  if v_primary <> v_task.primary_owner_id then
    perform set_config('app.audit_override', jsonb_build_object(
      'action', 'primary_changed',
      'meta', jsonb_build_object('from', v_task.primary_owner_id, 'to', v_primary))::text, true);
    update public.task_assignees set is_primary = false
    where task_assignees.task_id = v_task.id and member_id = v_task.primary_owner_id and is_primary;
  end if;
  -- Added people start their own acknowledgement; someone re-added starts again.
  foreach v_member in array v_new_ids loop
    if not (v_member = any (v_current_ids)) then
      select a.* into v_row from public.task_assignees a where a.task_id = v_task.id and a.member_id = v_member;
      perform set_config('app.audit_override', jsonb_build_object(
        'action', 'assigned',
        'meta', jsonb_build_object('member_id', v_member, 'is_primary', v_member = v_primary, 'again', v_row.task_id is not null))::text, true);
      if v_row.task_id is not null then
        update public.task_assignees
        set removed_at = null, assigned_at = now(), assigned_by = v_caller,
            acknowledged_at = null, acknowledged_by = null, is_primary = (v_member = v_primary)
        where task_assignees.task_id = v_task.id and member_id = v_member;
      else
        insert into public.task_assignees (task_id, member_id, is_primary, assigned_by)
        values (v_task.id, v_member, v_member = v_primary, v_caller);
      end if;
      v_changed := array_append(v_changed, 'assignee_ids');
      v_added := array_append(v_added, v_member);
    end if;
  end loop;
  if v_primary <> v_task.primary_owner_id then
    perform set_config('app.audit_override', jsonb_build_object(
      'action', 'primary_changed',
      'meta', jsonb_build_object('from', v_task.primary_owner_id, 'to', v_primary))::text, true);
    update public.task_assignees set is_primary = true
    where task_assignees.task_id = v_task.id and member_id = v_primary and not is_primary;
    v_changed := array_append(v_changed, 'primary_owner_id');
    v_labels := array_append(v_labels, 'primary owner');
  end if;

  -- The task's own fields: the trigger's diff is the field-level record (action updated).
  if v_title <> v_task.title then v_changed := array_append(v_changed, 'title'); v_labels := array_append(v_labels, 'title'); end if;
  if v_description is distinct from v_task.description then v_changed := array_append(v_changed, 'description'); v_labels := array_append(v_labels, 'description'); end if;
  if v_task_type_id <> v_task.task_type_id then v_changed := array_append(v_changed, 'task_type_id'); v_labels := array_append(v_labels, 'type'); end if;
  if v_client_id is distinct from v_task.client_id then v_changed := array_append(v_changed, 'client_id'); v_labels := array_append(v_labels, 'client'); end if;
  if v_priority <> v_task.priority then v_changed := array_append(v_changed, 'priority'); v_labels := array_append(v_labels, 'priority'); end if;
  if v_due_at <> v_task.due_at then v_changed := array_append(v_changed, 'due_at'); v_labels := array_append(v_labels, 'deadline (now ' || app.notify_when(v_due_at) || ')'); end if;
  if v_event_date is distinct from v_task.event_date then v_changed := array_append(v_changed, 'event_date'); v_labels := array_append(v_labels, 'event date'); end if;
  if v_event_start_at is distinct from v_task.event_start_at then v_changed := array_append(v_changed, 'event_start_at'); v_labels := array_append(v_labels, 'event time'); end if;
  if v_event_end_at is distinct from v_task.event_end_at then v_changed := array_append(v_changed, 'event_end_at'); v_labels := array_append(v_labels, 'event time'); end if;
  if v_location is distinct from v_task.location then v_changed := array_append(v_changed, 'location'); v_labels := array_append(v_labels, 'location'); end if;
  if v_purpose is distinct from v_task.purpose then v_changed := array_append(v_changed, 'purpose'); v_labels := array_append(v_labels, 'purpose'); end if;
  if v_custom_fields <> v_task.custom_fields then v_changed := array_append(v_changed, 'custom_fields'); v_labels := array_append(v_labels, 'details'); end if;
  if v_reminder_rules <> v_task.reminder_rules then v_changed := array_append(v_changed, 'reminder_rules'); v_labels := array_append(v_labels, 'reminders'); end if;

  v_changed := array(select distinct c from unnest(v_changed) c order by c);
  if coalesce(cardinality(v_changed), 0) = 0 then
    perform app.fail('VALIDATION', 'Nothing changed.');
  end if;

  perform set_config('app.audit_override', jsonb_build_object(
    'action', 'updated', 'meta', jsonb_build_object('fields', to_jsonb(v_changed)))::text, true);
  update public.tasks
  set title = v_title, description = v_description, task_type_id = v_task_type_id, client_id = v_client_id,
      priority = v_priority, due_at = v_due_at, event_date = v_event_date,
      event_start_at = v_event_start_at, event_end_at = v_event_end_at,
      location = v_location, purpose = v_purpose, custom_fields = v_custom_fields,
      reminder_rules = v_reminder_rules, primary_owner_id = v_primary
  where id = v_task.id;
  -- A no-op on the row itself (assignees only) leaves the override unconsumed: clear it.
  perform set_config('app.audit_override', '', true);

  perform app.task_record_warnings(v_task.id, v_caller, v_new_ids, task_update_assignment.warnings);

  -- WORKFLOWS §9 (5.1): an added person is assigned; a removed person is told without the task
  -- named or linked (decision 25); everyone who stays is told what changed ("Task changed").
  perform app.notify(v_added, 'task_assigned', 'New task: ' || v_title,
    format('Assigned by %s · due %s', app.member_name(v_caller), app.notify_when(v_due_at)),
    '/tasks/' || v_task.id, 'tasks', v_task.id, jsonb_build_object('task_id', v_task.id));
  perform app.notify(v_removed, 'task_unassigned', 'You were taken off a task',
    format('%s reassigned it.', app.member_name(v_caller)));
  if cardinality(v_labels) > 0 then
    v_labels := array(select distinct l from unnest(v_labels) l order by l);
    perform app.notify(
      array(select a from unnest(v_new_ids) a where a = any (v_current_ids)),
      'task_changed', 'Task changed: ' || v_title,
      'Changed: ' || array_to_string(v_labels, ', '),
      '/tasks/' || v_task.id, 'tasks', v_task.id,
      jsonb_build_object('task_id', v_task.id, 'fields', to_jsonb(v_changed)));
  end if;

  return v_changed;
end;
$$;
comment on function public.task_update_assignment(uuid, jsonb, jsonb) is
  'tasks.create and app.task_manager (the creator, the approving Admin, the Owner), not on a '
  'completed or cancelled task. changes = a jsonb object of the fields to change: title, '
  'description, task_type_id (an archived type is kept by a task that has it, never chosen: 4B '
  'review S7), client_id (a label an Admin sets or changes must be one of their own clients; the '
  'approving Admin edits the other fields of a task labelled with another Admin''s client, 4A '
  'review S1; a label is never set or changed to an inactive client, 4B review S6), priority, '
  'due_at (any value; overdue follows), event_date, event_start_at, event_end_at, location, '
  'purpose, custom_fields, reminder_rules, assignee_ids (the full new set: added people start '
  'their acknowledgement, removed ones keep their row with removed_at, a re-added person starts '
  'again), primary_owner_id (an active assignee, never the Owner). warnings as task_create. '
  'Returns the fields that changed (VALIDATION when none did, or when a value, an assignee id '
  'included, has the wrong shape). Audit: updated (the trigger''s diff, meta.fields) plus assigned '
  '/ unassigned / primary_changed rows. 5.1: notifies added people (task_assigned), removed people '
  '(task_unassigned, no task named or linked: 5A decision 25) and the people who stay when a field '
  'changed (task_changed) through app.notify().';

create or replace function public.task_submit_done(task_id uuid, note text default null, late_reason text default null, on_behalf_of uuid default null)
returns public.task_state
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid;
  v_subject uuid;
  v_org uuid;
  v_task public.tasks;
  v_row public.task_assignees;
  v_note text := nullif(btrim(coalesce(task_submit_done.note, '')), '');
  v_late boolean;
  v_late_reason text := app.clean_reason(task_submit_done.late_reason);
  v_version integer;
  v_submission uuid;
  v_state public.task_state;
  v_step public.admin_step;
  v_meta jsonb;
begin
  select a.actor_id, a.subject_id, a.org_id into v_actor, v_subject, v_org
  from app.task_actor(task_submit_done.task_id, task_submit_done.on_behalf_of) a;
  v_task := app.task_lock(task_submit_done.task_id, v_org);
  if v_subject <> v_task.primary_owner_id then
    perform app.fail('FORBIDDEN', 'Only the primary owner marks a task Done.');
  end if;
  if v_task.state in ('submitted', 'admin_approved') then
    perform app.fail('INVALID_STATE', 'Already submitted: the task is waiting for its review.');
  end if;
  if v_task.state = 'completed' then
    perform app.fail('INVALID_STATE', 'This task is complete.');
  end if;
  if v_task.state = 'cancelled' then
    perform app.fail('INVALID_STATE', 'This task was cancelled.');
  end if;
  if v_note is not null and length(v_note) > 5000 then
    perform app.fail('VALIDATION', 'Keep the note under 5000 characters.');
  end if;
  v_late := now() > v_task.due_at;
  if v_late and v_late_reason is null then
    perform app.fail('REASON_REQUIRED', 'The deadline has passed: say why the task is late.');
  end if;

  -- Done does not wait for acknowledgements: the primary owner's is recorded now if missing.
  select ta.* into v_row from public.task_assignees ta
  where ta.task_id = v_task.id and ta.member_id = v_subject for update;
  if v_row.acknowledged_at is null then
    perform set_config('app.audit_override', jsonb_build_object(
      'action', 'acknowledged',
      'on_behalf_of', task_submit_done.on_behalf_of,
      'meta', jsonb_build_object('member_id', v_subject, 'implied', true))::text, true);
    update public.task_assignees set acknowledged_at = now(), acknowledged_by = v_actor
    where task_assignees.task_id = v_task.id and member_id = v_subject;
  end if;

  -- The hand-in: one version per Done or resubmit (WORKFLOWS §3.3).
  select coalesce(max(s.version), 0) + 1 into v_version from public.task_submissions s where s.task_id = v_task.id;
  perform set_config('app.audit_override', jsonb_build_object(
    'action', 'submission_added',
    'on_behalf_of', task_submit_done.on_behalf_of,
    'meta', jsonb_build_object('version', v_version))::text, true);
  insert into public.task_submissions (task_id, version, note, submitted_by, on_behalf_of)
  values (v_task.id, v_version, v_note, v_actor, task_submit_done.on_behalf_of)
  returning id into v_submission;

  -- The route (PRODUCT §4.6): the Admin step is required, none (no approver) or skipped
  -- (the approver is an assignee; the reason lives only in the activity log).
  if v_task.approving_admin_id is null then
    v_state := 'admin_approved'; v_step := 'none';
    v_meta := jsonb_build_object('version', v_version, 'late', v_late, 'admin_step', 'none');
  elsif app.is_task_assignee(v_task.id, v_task.approving_admin_id) then
    v_state := 'admin_approved'; v_step := 'skipped';
    v_meta := jsonb_build_object('version', v_version, 'late', v_late, 'admin_step', 'skipped', 'reason', 'approver_is_assignee');
  else
    v_state := 'submitted'; v_step := 'required';
    v_meta := jsonb_build_object('version', v_version, 'late', v_late, 'admin_step', 'required');
  end if;

  perform set_config('app.audit_override', jsonb_build_object(
    'action', 'submitted', 'on_behalf_of', task_submit_done.on_behalf_of, 'meta', v_meta)::text, true);
  update public.tasks
  set state = v_state, admin_step = v_step, submitted_at = now(), submitted_by = v_actor,
      submitted_on_behalf_of = task_submit_done.on_behalf_of,
      late_reason = case when v_late then v_late_reason else tasks.late_reason end,
      admin_approved_at = null
  where id = v_task.id;

  -- WORKFLOWS §9 "Task submitted (Done)": the approving Admin, or the Owner when there is no
  -- Admin step (5.1).
  perform app.notify(
    array[case when v_state = 'submitted' then v_task.approving_admin_id else app.org_owner_id(v_org) end],
    'task_submitted', 'Done: ' || v_task.title,
    format('%s marked it Done%s', app.member_name(v_subject), case when v_late then ' (late)' else '' end),
    '/tasks/' || v_task.id, 'tasks', v_task.id,
    jsonb_build_object('task_id', v_task.id, 'version', v_version), v_actor);
  return v_state;
end;
$$;
comment on function public.task_submit_done(uuid, text, text, uuid) is
  'tasks.work, the primary owner (or their current coordinator with on_behalf_of, ADR-0013), from '
  'todo / in_progress / changes_requested. Records the primary owner''s acknowledgement if missing '
  '(audit acknowledged, meta.implied), writes the next task_submissions version (the optional '
  'note, links allowed), requires late_reason past due_at (REASON_REQUIRED), then routes: '
  'submitted with admin_step required when an approving Admin exists and is not an assignee; '
  'otherwise admin_approved with admin_step none (no approver) or skipped (the approver is an '
  'assignee; meta.reason approver_is_assignee). Audit action: submitted. 5.1: notifies the '
  'approving Admin, or the Owner when there is no Admin step (task_submitted) through '
  'app.notify().';

create or replace function public.task_review(task_id uuid, decision public.review_decision, reason text default null)
returns public.task_state
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid;
  v_org uuid;
  v_task public.tasks;
  v_reason text := app.clean_reason(task_review.reason);
  v_step text;
  v_state public.task_state;
  v_submission uuid;
  v_action text;
begin
  select m.id, m.org_id into v_caller, v_org from app.current_member() m;
  if v_caller is null then
    perform app.fail('UNAUTHENTICATED', 'Your account is not active.');
  end if;
  if task_review.decision is null then
    perform app.fail('VALIDATION', 'The decision is approved or rejected.');
  end if;
  if task_review.decision = 'rejected' and v_reason is null then
    perform app.fail('REASON_REQUIRED', 'Say what needs to change.');
  end if;
  v_task := app.task_lock(task_review.task_id, v_org);

  if v_task.state = 'submitted' then
    -- The Admin step: the approving Admin, never an assignee (PERMISSIONS §3). The Owner's way
    -- past a waiting Admin is task_set_approver.
    if v_task.approving_admin_id is distinct from v_caller or not app.has_permission('tasks.approve_admin') then
      if app.is_owner() then
        perform app.fail('INVALID_STATE', 'This task is waiting for its approving Admin. Change or remove the approver to decide it yourself.');
      end if;
      perform app.fail('FORBIDDEN', 'Only the task''s approving Admin reviews it at this step.');
    end if;
    if app.is_task_assignee(v_task.id, v_caller) then
      perform app.fail('FORBIDDEN', 'An assignee cannot approve their own task.');
    end if;
    v_step := 'admin';
    v_state := case when task_review.decision = 'approved' then 'admin_approved' else 'changes_requested' end;
  elsif v_task.state = 'admin_approved' then
    if not app.has_permission('tasks.approve_final') then
      perform app.fail('FORBIDDEN', 'Only the Owner gives the final approval.');
    end if;
    v_step := 'owner';
    v_state := case when task_review.decision = 'approved' then 'completed' else 'changes_requested' end;
  elsif v_task.state = 'completed' then
    perform app.fail('INVALID_STATE', 'This task is already complete.');
  elsif v_task.state = 'cancelled' then
    perform app.fail('INVALID_STATE', 'This task was cancelled.');
  else
    perform app.fail('INVALID_STATE', 'Nothing to review: the task has not been submitted.');
  end if;

  select s.id into v_submission from public.task_submissions s
  where s.task_id = v_task.id order by s.version desc limit 1;

  perform set_config('app.audit_override', jsonb_build_object(
    'action', 'review_recorded',
    'meta', jsonb_build_object('step', v_step, 'decision', task_review.decision, 'reason', v_reason))::text, true);
  insert into public.task_reviews (task_id, step, decision, reason, reviewer_id, submission_id)
  values (v_task.id, v_step, task_review.decision, v_reason, v_caller, v_submission);

  v_action := case v_state when 'admin_approved' then 'admin_approved'
                           when 'completed' then 'completed'
                           else 'changes_requested' end;
  perform set_config('app.audit_override', jsonb_build_object(
    'action', v_action,
    'meta', jsonb_build_object('step', v_step, 'reason', v_reason, 'submission_id', v_submission))::text, true);
  update public.tasks
  set state = v_state,
      admin_approved_at = case when v_state = 'admin_approved' then now() else admin_approved_at end,
      completed_at = case when v_state = 'completed' then now() else null end
  where id = v_task.id;

  -- WORKFLOWS §9 (5.1): "Admin approved" → the Owner; "Changes requested" → the assignees only
  -- (an Owner rejection too, kickoff 5 decision 2); "Task completed" → the assignees + creator.
  if v_state = 'admin_approved' then
    perform app.notify(array[app.org_owner_id(v_org)], 'task_admin_approved',
      'Approved by ' || app.member_name(v_caller) || ': ' || v_task.title,
      'Waiting for your final approval.',
      '/tasks/' || v_task.id, 'tasks', v_task.id, jsonb_build_object('task_id', v_task.id));
  elsif v_state = 'completed' then
    perform app.notify(app.task_people(v_task.id, true), 'task_completed',
      'Completed: ' || v_task.title, 'Approved by the Owner.',
      '/tasks/' || v_task.id, 'tasks', v_task.id, jsonb_build_object('task_id', v_task.id));
  else
    perform app.notify(app.task_people(v_task.id, false), 'task_changes_requested',
      'Changes requested: ' || v_task.title, v_reason,
      '/tasks/' || v_task.id, 'tasks', v_task.id, jsonb_build_object('task_id', v_task.id, 'step', v_step));
  end if;
  return v_state;
end;
$$;
comment on function public.task_review(uuid, public.review_decision, text) is
  'The review (WORKFLOWS §3.3). submitted: the approving Admin (tasks.approve_admin, never an '
  'assignee; the Owner is INVALID_STATE here and changes the approver instead) -> admin_approved '
  'or changes_requested. admin_approved: tasks.approve_final (the Owner) -> completed or '
  'changes_requested. rejected needs a reason (REASON_REQUIRED). One task_reviews row per call, '
  'pointing at the latest submission; bulk approve is this function once per task (approved only, '
  'kickoff 4 decision 5). Audit: review_recorded, then admin_approved | completed | '
  'changes_requested. 5.1 (WORKFLOWS §9, kickoff 5 decision 2): notifies the Owner after an Admin '
  'approval (task_admin_approved); the assignees only, an Owner rejection included, on changes '
  'requested (task_changes_requested); the assignees and the creator on completion '
  '(task_completed); through app.notify().';

create or replace function public.task_reopen(task_id uuid, reason text)
returns public.task_state
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid;
  v_org uuid;
  v_task public.tasks;
  v_reason text := app.clean_reason(task_reopen.reason);
  v_state public.task_state;
begin
  select m.id, m.org_id into v_caller, v_org from app.current_member() m;
  if v_caller is null then
    perform app.fail('UNAUTHENTICATED', 'Your account is not active.');
  end if;
  if v_reason is null then
    perform app.fail('REASON_REQUIRED', 'Say why the task is reopened.');
  end if;
  v_task := app.task_lock(task_reopen.task_id, v_org);
  -- The key and the scope (PERMISSIONS §1/§3): tasks.create, and the creator / approver / Owner.
  if not app.has_permission('tasks.create') or not app.task_manager(v_task.id) then
    perform app.fail('FORBIDDEN', 'Only the task''s creator, its approving Admin or the Owner reopens it.');
  end if;
  if v_task.state = 'completed' then
    v_state := 'in_progress';
  elsif v_task.state = 'cancelled' then
    v_state := 'todo';
  else
    perform app.fail('INVALID_STATE', 'Only a completed or cancelled task can be reopened.');
  end if;

  -- The same route again (WORKFLOWS §3.1): the Admin step is re-evaluated at the next Done;
  -- acknowledgements stay. The stamps are cleared; the audit diff keeps them.
  perform set_config('app.audit_override', jsonb_build_object(
    'action', 'reopened',
    'meta', jsonb_build_object('reason', v_reason, 'from_state', v_task.state))::text, true);
  update public.tasks
  set state = v_state,
      admin_step = (case when approving_admin_id is null then 'none' else 'required' end)::public.admin_step,
      submitted_at = null, submitted_by = null, submitted_on_behalf_of = null,
      admin_approved_at = null, completed_at = null, cancelled_at = null, cancelled_reason = null
  where id = v_task.id;
  -- WORKFLOWS §9 "Task reopened": the assignees (+ creator) (5.1).
  perform app.notify(app.task_people(v_task.id, true), 'task_reopened',
    'Reopened: ' || v_task.title, v_reason,
    '/tasks/' || v_task.id, 'tasks', v_task.id, jsonb_build_object('task_id', v_task.id));
  return v_state;
end;
$$;
comment on function public.task_reopen(uuid, text) is
  'The task''s creator, its approving Admin or the Owner (app.task_manager). completed -> '
  'in_progress, cancelled -> todo; reason required (REASON_REQUIRED, kept only in the activity '
  'log). The route is walked again: admin_step back to required / none, the submission, approval '
  'and cancellation stamps cleared; acknowledgements kept. Audit action: reopened. 5.1: notifies '
  'the assignees and the creator (task_reopened) through app.notify().';

create or replace function public.task_cancel(task_id uuid, reason text)
returns public.task_state
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid;
  v_org uuid;
  v_task public.tasks;
  v_reason text := app.clean_reason(task_cancel.reason);
begin
  select m.id, m.org_id into v_caller, v_org from app.current_member() m;
  if v_caller is null then
    perform app.fail('UNAUTHENTICATED', 'Your account is not active.');
  end if;
  if v_reason is null then
    perform app.fail('REASON_REQUIRED', 'Say why the task is cancelled.');
  end if;
  v_task := app.task_lock(task_cancel.task_id, v_org);
  -- The key and the scope (PERMISSIONS §1/§3): tasks.create, and the creator / approver / Owner.
  if not app.has_permission('tasks.create') or not app.task_manager(v_task.id) then
    perform app.fail('FORBIDDEN', 'Only the task''s creator, its approving Admin or the Owner cancels it.');
  end if;
  if v_task.state = 'cancelled' then
    perform app.fail('INVALID_STATE', 'This task is already cancelled.');
  end if;
  if v_task.state = 'completed' then
    perform app.fail('INVALID_STATE', 'A completed task is reopened, not cancelled.');
  end if;

  perform set_config('app.audit_override', jsonb_build_object(
    'action', 'cancelled',
    'meta', jsonb_build_object('reason', v_reason, 'from_state', v_task.state))::text, true);
  update public.tasks
  set state = 'cancelled', cancelled_at = now(), cancelled_reason = v_reason
  where id = v_task.id;
  -- WORKFLOWS §9 "Task cancelled": the assignees (+ creator) (5.1).
  perform app.notify(app.task_people(v_task.id, true), 'task_cancelled',
    'Cancelled: ' || v_task.title, v_reason,
    '/tasks/' || v_task.id, 'tasks', v_task.id, jsonb_build_object('task_id', v_task.id));
  return 'cancelled';
end;
$$;
comment on function public.task_cancel(uuid, text) is
  'The task''s creator, its approving Admin or the Owner (app.task_manager). Any state but '
  'completed or cancelled -> cancelled with the reason (REASON_REQUIRED); the task stays in '
  'history and reports, reminders stop (5.1). Audit action: cancelled. 5.1: notifies the assignees '
  'and the creator (task_cancelled) through app.notify().';

create or replace function public.task_set_approver(task_id uuid, approving_admin_id uuid)
returns public.task_state
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid;
  v_org uuid;
  v_task public.tasks;
  v_state public.task_state;
  v_step public.admin_step;
begin
  select m.id, m.org_id into v_caller, v_org from app.current_member() m;
  if v_caller is null then
    perform app.fail('UNAUTHENTICATED', 'Your account is not active.');
  end if;
  if not app.is_owner() then
    perform app.fail('FORBIDDEN', 'Only the Owner changes who approves a task.');
  end if;
  v_task := app.task_lock(task_set_approver.task_id, v_org);
  if v_task.state in ('completed', 'cancelled') then
    perform app.fail('INVALID_STATE', 'Reopen the task to change its approver.');
  end if;
  if task_set_approver.approving_admin_id is not null and not exists (
    select 1 from public.members m
    where m.id = task_set_approver.approving_admin_id and m.org_id = v_org and m.role = 'admin'
      and m.status = 'active' and m.engagement = 'permanent') then
    perform app.fail('VALIDATION', 'Choose an active Admin as the approver.');
  end if;
  if task_set_approver.approving_admin_id is not distinct from v_task.approving_admin_id then
    perform app.fail('VALIDATION', 'That is already the approving Admin.');
  end if;

  v_state := v_task.state;
  if v_task.state = 'submitted' then
    -- The review moves to the new approver, or the task goes to the Owner at once.
    if task_set_approver.approving_admin_id is null then
      v_state := 'admin_approved'; v_step := 'none';
    elsif app.is_task_assignee(v_task.id, task_set_approver.approving_admin_id) then
      v_state := 'admin_approved'; v_step := 'skipped';
    else
      v_step := 'required';
    end if;
  elsif v_task.state = 'admin_approved' then
    -- The Admin step is behind the task: only a removed approver changes the record.
    v_step := case when task_set_approver.approving_admin_id is null then 'none' else v_task.admin_step end;
  else
    v_step := case when task_set_approver.approving_admin_id is null then 'none' else 'required' end;
  end if;

  perform set_config('app.audit_override', jsonb_build_object(
    'action', 'approver_changed',
    'meta', jsonb_build_object('from', v_task.approving_admin_id, 'to', task_set_approver.approving_admin_id,
                               'from_state', v_task.state, 'to_state', v_state))::text, true);
  update public.tasks
  set approving_admin_id = task_set_approver.approving_admin_id, admin_step = v_step, state = v_state
  where id = v_task.id;
  -- Kickoff 5 decision 2 (5.1): a new approving Admin, when the review is waiting, gets the
  -- "Task submitted" notification.
  if v_state = 'submitted' then
    perform app.notify(array[task_set_approver.approving_admin_id], 'task_submitted',
      'Done: ' || v_task.title, 'Waiting for your review (the Owner made you its approver).',
      '/tasks/' || v_task.id, 'tasks', v_task.id, jsonb_build_object('task_id', v_task.id));
  end if;
  return v_state;
end;
$$;
comment on function public.task_set_approver(uuid, uuid) is
  'The Owner. Changes or removes (null) a task''s approving Admin (an active permanent Admin), not '
  'on a completed or cancelled task. admin_step follows (none without an approver, else required); '
  'while submitted the review moves to the new approver, or the task goes to admin_approved at '
  'once when the approver is removed (none) or is an assignee (skipped); while admin_approved only '
  'a removal changes the record. Audit action: approver_changed (meta.from / to). 5.1 (kickoff 5 '
  'decision 2): notifies the new approver when a review is waiting (task_submitted) through '
  'app.notify().';

-- Task comments (5A decision 15): every assignee, the creator, the current approving Admin and
-- every earlier commenter (their author and the freelancer they wrote for), never the author.
-- In-app and push only (the kind is neither actionable nor always_email). An API insert runs as
-- authenticated, so the trigger function is security definer to reach app.notify().
create or replace function app.task_comments_notify()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_task public.tasks;
  v_people uuid[];
  v_who text;
begin
  select t.* into v_task from public.tasks t where t.id = new.task_id;
  v_people := array(
    select p from unnest(app.task_people(v_task.id, true)) p
    union
    select v_task.approving_admin_id where v_task.approving_admin_id is not null
    union
    select c.author_id from public.task_comments c where c.task_id = v_task.id and c.id <> new.id
    union
    select c.on_behalf_of from public.task_comments c
    where c.task_id = v_task.id and c.id <> new.id and c.on_behalf_of is not null);
  v_who := case when new.on_behalf_of is null then app.member_name(new.author_id)
                else app.member_name(new.on_behalf_of) || ' (via ' || app.member_name(new.author_id) || ')' end;
  perform app.notify(
    array(select p from unnest(v_people) p where p <> new.author_id and p is distinct from new.on_behalf_of),
    'task_comment', 'Comment on ' || v_task.title,
    v_who || ': ' || left(new.body, 280),
    '/tasks/' || v_task.id, 'tasks', v_task.id,
    jsonb_build_object('task_id', v_task.id, 'comment_id', new.id), new.author_id);
  return null;
end;
$$;
comment on function app.task_comments_notify() is
  '5.1 (5A decision 15): AFTER INSERT on task_comments: notifies the task''s assignees, creator, '
  'approving Admin and earlier commenters, never the author (task_comment; a freelancer''s row to '
  'their coordinator), through app.notify().';
revoke all on function app.task_comments_notify() from public;
grant execute on function app.task_comments_notify() to authenticated, service_role;
create trigger comments_notify after insert on public.task_comments
  for each row execute function app.task_comments_notify();

-- 8b. Task requests ----------------------------------------------------------------------------------
create or replace function public.task_request_create(title text, details text default null, client_id uuid default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller public.members;
  v_title text := btrim(coalesce(task_request_create.title, ''));
  v_details text := nullif(btrim(coalesce(task_request_create.details, '')), '');
  v_client public.clients;
  v_id uuid;
  v_to uuid[];
begin
  select m.* into v_caller from app.current_member() m;
  if v_caller.id is null then
    perform app.fail('UNAUTHENTICATED', 'Your account is not active.');
  end if;
  if not app.has_permission('task_requests.create') then
    perform app.fail('FORBIDDEN', 'You create tasks yourself.');
  end if;
  if v_title = '' then
    perform app.fail('VALIDATION', 'Give the suggestion a title.');
  end if;
  if length(v_title) > 200 then
    perform app.fail('VALIDATION', 'Keep the title under 200 characters.');
  end if;
  if v_details is not null and length(v_details) > 5000 then
    perform app.fail('VALIDATION', 'Keep the details under 5000 characters.');
  end if;
  if task_request_create.client_id is not null then
    -- A label the caller can see (ADR-0005: Staff see the labels on their own tasks), Active or
    -- Paused like a task's (Kickoff 4 decision 22).
    select c.* into v_client from public.clients c
    where c.id = task_request_create.client_id and c.org_id = v_caller.org_id;
    if v_client.id is null
       or not (app.client_visible(v_client.id) or v_client.id in (select app.labelled_client_ids())) then
      perform app.fail('NOT_FOUND', 'This client does not exist.');
    end if;
    -- An Admin labels with their own clients only (Kickoff 4 decision 2, WORKFLOWS §3.4; 4C review
    -- S8a), never another Admin's client they see on a task they are on. The Owner never suggests.
    if app.has_permission('clients.edit_assigned')
       and v_client.id not in (select app.admin_client_ids()) then
      perform app.fail('FORBIDDEN', 'Suggest it with one of your own clients, or with none.');
    end if;
    if v_client.state not in ('active', 'paused') then
      perform app.fail('VALIDATION', format('%s takes no new work: suggest it with another client, or with none.', v_client.name));
    end if;
  end if;

  perform set_config('app.audit_override', jsonb_build_object('action', 'requested')::text, true);
  insert into public.task_requests (org_id, requested_by, title, details, client_id)
  values (v_caller.org_id, v_caller.id, v_title, v_details, task_request_create.client_id)
  returning id into v_id;

  -- WORKFLOWS §9 (5.1): the Owner and the client's Admin; the Owner only when the labelled client
  -- has no Admin (5A decision 20); every Admin and the Owner when there is no client.
  if v_client.id is not null then
    v_to := array[app.org_owner_id(v_caller.org_id), v_client.admin_id];
  else
    v_to := array(select m.id from public.members m
                  where m.org_id = v_caller.org_id and m.status = 'active'
                    and (m.role = 'owner' or (m.role = 'admin' and m.engagement = 'permanent'))
                  order by m.role, m.id);
  end if;
  perform app.notify(v_to, 'task_request_created', 'Suggested task: ' || v_title,
    format('%s suggested it%s.', v_caller.full_name,
           case when v_client.id is null then '' else ' for ' || v_client.name end),
    '/tasks/requests', 'task_requests', v_id, jsonb_build_object('request_id', v_id));
  return v_id;
end;
$$;
comment on function public.task_request_create(text, text, uuid) is
  'task_requests.create (Admins and Staff; PRODUCT §4.6): a suggested task, pending. The client is '
  'a label the caller can see, Active or Paused; an Admin''s is one of their own clients (Kickoff '
  '4 decision 2, 4C review S8a: FORBIDDEN otherwise). Audit action: requested. 5.1: notifies the '
  'Owner and the client''s Admin, the Owner only when the labelled client has no Admin (5A '
  'decision 20), or every Admin and the Owner when there is no client (task_request_created) '
  'through app.notify().';

create or replace function public.task_request_decline(request_id uuid, reason text)
returns public.request_state
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request public.task_requests;
  v_reason text := app.clean_reason(task_request_decline.reason);
begin
  if (select m.id from app.current_member() m) is null then
    perform app.fail('UNAUTHENTICATED', 'Your account is not active.');
  end if;
  if not app.has_permission('task_requests.decide') then
    perform app.fail('FORBIDDEN', 'You cannot decide suggested tasks.');
  end if;
  v_request := app.task_request_lock(task_request_decline.request_id);
  -- Kickoff 4 decision 23: an Admin never decides their own suggestion (it goes to the Owner).
  if v_request.requested_by = auth.uid() and not app.is_owner() then
    perform app.fail('FORBIDDEN', 'Your own suggestion goes to the Owner: you can withdraw it.');
  end if;
  if v_request.state <> 'pending' then
    perform app.fail('INVALID_STATE', 'This suggestion was already decided.');
  end if;
  if v_reason is null then
    perform app.fail('REASON_REQUIRED', 'Say why, so they know.');
  end if;
  perform set_config('app.audit_override', jsonb_build_object(
    'action', 'declined', 'meta', jsonb_build_object('reason', v_reason))::text, true);
  update public.task_requests
  set state = 'declined', decision_reason = v_reason, decided_by = auth.uid(), decided_at = now()
  where id = v_request.id;
  -- WORKFLOWS §9 (Kickoff 4 decision 24, from Kickoff 5 decision 9): the requester is told, with
  -- the reason (5.1).
  perform app.notify(array[v_request.requested_by], 'task_request_declined',
    'Suggestion declined: ' || v_request.title, v_reason,
    '/tasks/requests', 'task_requests', v_request.id, jsonb_build_object('request_id', v_request.id));
  return 'declined';
end;
$$;
comment on function public.task_request_decline(uuid, text) is
  'task_requests.decide on a request the caller sees (the Owner any; an Admin those with no client '
  'or their own clients'', never their own suggestion: Kickoff 4 decision 23): pending → declined '
  'with a required reason the requester reads. Audit action: declined (meta.reason). 5.1: notifies '
  'the requester with the reason (task_request_declined) through app.notify().';

create or replace function public.task_request_convert(
  request_id uuid, title text, description text, task_type_id uuid, client_id uuid, priority public.priority,
  due_at timestamptz, assignee_ids uuid[], primary_owner_id uuid, approving_admin_id uuid default null,
  event_date date default null, event_start_at timestamptz default null, event_end_at timestamptz default null,
  location text default null, purpose text default null, stages text[] default '{}',
  custom_fields jsonb default '{}', reminder_rules jsonb default null, template_id uuid default null,
  warnings jsonb default '[]')
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request public.task_requests;
  v_task_id uuid;
begin
  if (select m.id from app.current_member() m) is null then
    perform app.fail('UNAUTHENTICATED', 'Your account is not active.');
  end if;
  if not app.has_permission('task_requests.decide') then
    perform app.fail('FORBIDDEN', 'You cannot decide suggested tasks.');
  end if;
  v_request := app.task_request_lock(task_request_convert.request_id);
  -- Kickoff 4 decision 23: an Admin never decides their own suggestion (it goes to the Owner).
  if v_request.requested_by = auth.uid() and not app.is_owner() then
    perform app.fail('FORBIDDEN', 'Your own suggestion goes to the Owner: you can withdraw it.');
  end if;
  if v_request.state <> 'pending' then
    perform app.fail('INVALID_STATE', 'This suggestion was already decided.');
  end if;

  -- The task is the decider's own, with every rule of task_create (the route, the label, the people).
  v_task_id := public.task_create(
    task_request_convert.title, task_request_convert.description, task_request_convert.task_type_id,
    task_request_convert.client_id, task_request_convert.priority, task_request_convert.due_at,
    task_request_convert.assignee_ids, task_request_convert.primary_owner_id,
    task_request_convert.approving_admin_id, task_request_convert.event_date,
    task_request_convert.event_start_at, task_request_convert.event_end_at,
    task_request_convert.location, task_request_convert.purpose, task_request_convert.stages,
    task_request_convert.custom_fields, task_request_convert.reminder_rules,
    task_request_convert.template_id, task_request_convert.warnings);

  perform set_config('app.audit_override', jsonb_build_object(
    'action', 'converted', 'meta', jsonb_build_object('task_id', v_task_id))::text, true);
  update public.task_requests
  set state = 'converted', task_id = v_task_id, decided_by = auth.uid(), decided_at = now()
  where id = v_request.id;
  -- WORKFLOWS §9 (Kickoff 4 decision 24, from Kickoff 5 decision 9): the requester is told it
  -- became a task; the row links the request, never the task (5A decision 25: the requester may
  -- not be on it); task_create told the assignees (5.1).
  perform app.notify(array[v_request.requested_by], 'task_request_converted',
    'Suggestion accepted: ' || v_request.title, 'It is now a task.',
    '/tasks/requests', 'task_requests', v_request.id,
    jsonb_build_object('request_id', v_request.id));
  return v_task_id;
end;
$$;
comment on function public.task_request_convert(uuid, text, text, uuid, uuid, public.priority, timestamptz, uuid[], uuid, uuid, date, timestamptz, timestamptz, text, text, text[], jsonb, jsonb, uuid, jsonb) is
  'task_requests.decide (and task_create''s own checks: tasks.create, the route, the label, the '
  'people) on a pending request the caller sees, never an Admin''s own (Kickoff 4 decision 23): '
  'creates the task and marks the request converted (task_id) in one transaction. Returns the task '
  'id. Audit actions: task_create''s, then converted (meta.task_id). 5.1: notifies the requester '
  '(task_request_converted, linking the request, never the task: 5A decision 25) through '
  'app.notify(); task_create notifies the assignees.';

-- 8c. Leave and attendance -----------------------------------------------------------------------
-- The Owner's rows link Approvals; a member's rows link their own Leave / Attendance tabs.
create or replace function app.notify_leave_owner(p_req public.leave_requests, p_org uuid, p_action text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_what text := case p_req.type when 'comp_leave' then 'comp leave' when 'half_day' then 'a half day' else 'leave' end;
begin
  perform app.notify(array[app.org_owner_id(p_org)], 'leave_requested',
    format('%s %s',
      app.member_name(p_req.member_id),
      case p_action
        when 'cancel' then 'asked to cancel their ' || v_what
        when 'change' then 'asked to change their ' || v_what
        else 'requested ' || v_what end),
    app.notify_span(p_req.start_date, p_req.end_date)
      || case when p_req.reason is null then '' else ' · ' || p_req.reason end,
    '/approvals', 'leave_requests', p_req.id,
    jsonb_build_object('leave_request_id', p_req.id, 'member_id', p_req.member_id));
end;
$$;
comment on function app.notify_leave_owner(public.leave_requests, uuid, text) is
  '5.1, service_role only: the Owner''s "leave requested / changed" row for a submitted request '
  '(WORKFLOWS §9), used by leave_submit, leave_submit_comp, leave_request_change and '
  'attendance_choose_leave_today (5A decision 19).';
revoke all on function app.notify_leave_owner(public.leave_requests, uuid, text) from public, authenticated;
grant execute on function app.notify_leave_owner(public.leave_requests, uuid, text) to service_role;

create or replace function public.leave_submit(type public.leave_type, start_date date, end_date date, reason text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid;
  v_org uuid;
  v_reason text := app.clean_reason(reason);
  v_id uuid;
  v_req public.leave_requests;
begin
  select r.caller_id, r.org_id into v_caller, v_org from app.attendance_require_self() r;
  -- 3c.1: comp leave is a credit being used, so it goes through leave_submit_comp() only.
  if type = 'comp_leave' then
    perform app.fail('VALIDATION', 'Comp leave comes from a credit. Choose "Comp leave" in the leave form when you have one.');
  end if;
  perform app.leave_validate(type, start_date, end_date, app.today_ist());
  -- One member's leave writes run one at a time, so two tabs cannot both pass the overlap check.
  perform pg_advisory_xact_lock(hashtext('leave:' || v_caller::text));
  if app.leave_overlaps(v_caller, start_date, end_date, null) then
    perform app.fail('CONFLICT', 'You already have a request for these dates. Request a change to it instead.');
  end if;

  perform set_config('app.audit_override', jsonb_build_object(
    'action', 'submitted', 'meta', jsonb_build_object('source', 'form'))::text, true);
  insert into public.leave_requests (member_id, type, start_date, end_date, reason, state, source)
  values (v_caller, type, start_date, end_date, v_reason, 'submitted', 'form')
  returning * into v_req;
  v_id := v_req.id;
  -- WORKFLOWS §9 "Leave requested": the Owner (5.1).
  perform app.notify_leave_owner(v_req, v_org, 'request');
  return v_id;
end;
$$;

create or replace function public.leave_submit_comp(start_date date, half_day boolean default false, reason text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid;
  v_org uuid;
  v_reason text := app.clean_reason(reason);
  v_type public.leave_type := case when coalesce(half_day, false) then 'half_day' else 'comp_leave' end;
  v_needed numeric := case when coalesce(half_day, false) then 0.5 else 1.0 end;
  v_left numeric;
  v_credit public.comp_leave_credits;
  v_take numeric;
  v_id uuid;
  v_req public.leave_requests;
begin
  select r.caller_id, r.org_id into v_caller, v_org from app.attendance_require_self() r;
  perform app.leave_validate(v_type, start_date, start_date, app.today_ist());
  -- 3b review: a weekly day off or a holiday is already off; a credit spent on it would be lost.
  if app.is_working_day(start_date) is false then
    perform app.fail('VALIDATION', 'That date is a day off. Comp leave is for a working day.');
  end if;
  perform pg_advisory_xact_lock(hashtext('leave:' || v_caller::text));
  if app.leave_overlaps(v_caller, start_date, start_date, null) then
    perform app.fail('CONFLICT', 'You already have a request for this date. Request a change to it instead.');
  end if;

  -- The date counts, not the decision: only credits still valid on that date can cover it.
  select coalesce(sum(c.days - c.used_days - c.reserved_days), 0) into v_left
  from public.comp_leave_credits c
  where c.member_id = v_caller and c.revoked_at is null and c.expires_on >= start_date;
  if v_left < v_needed then
    perform app.fail('VALIDATION', 'You don''t have enough comp leave for that date.');
  end if;

  perform set_config('app.audit_override', jsonb_build_object(
    'action', 'submitted', 'meta', jsonb_build_object('source', 'form', 'comp', true, 'credit_days', v_needed))::text, true);
  insert into public.leave_requests (member_id, type, start_date, end_date, reason, state, source, credit_days)
  values (v_caller, v_type, start_date, start_date, v_reason, 'submitted', 'form', v_needed)
  returning * into v_req;
  v_id := v_req.id;

  -- Oldest first (decision 16).
  v_left := v_needed;
  for v_credit in
    select c.* from public.comp_leave_credits c
    where c.member_id = v_caller and c.revoked_at is null and c.expires_on >= start_date
      and c.days - c.used_days - c.reserved_days > 0
    order by c.granted_at, c.id
    for update
  loop
    exit when v_left <= 0;
    v_take := least(v_credit.days - v_credit.used_days - v_credit.reserved_days, v_left);
    perform set_config('app.audit_override', jsonb_build_object(
      'action', 'reserved', 'meta', jsonb_build_object('leave_request_id', v_id, 'days', v_take))::text, true);
    update public.comp_leave_credits set reserved_days = reserved_days + v_take where id = v_credit.id;
    perform set_config('app.audit_override', jsonb_build_object('action', 'reserved')::text, true);
    insert into public.comp_leave_credit_uses (credit_id, leave_request_id, days, state)
    values (v_credit.id, v_id, v_take, 'reserved');
    v_left := v_left - v_take;
  end loop;
  -- The sum above is read before the credits are locked: a credit revoked in between is skipped
  -- by the loop, and the request must not stand on nothing.
  if v_left > 0 then
    perform app.fail('VALIDATION', 'You don''t have enough comp leave for that date.');
  end if;

  -- WORKFLOWS §9 "Leave requested": the Owner (5.1). The comp label is the person's own kind of
  -- leave, never an amount (decision 24).
  perform app.notify_leave_owner(v_req, v_org, 'request');
  return v_id;
end;
$$;

create or replace function public.leave_request_change(request_id uuid, type public.leave_type default null, start_date date default null, end_date date default null, reason text default null, cancel boolean default false)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid;
  v_org uuid;
  v_reason text := app.clean_reason(reason);
  v_req public.leave_requests;
  v_type public.leave_type;
  v_start date;
  v_end date;
  v_id uuid;
  v_new public.leave_requests;
begin
  select r.caller_id, r.org_id into v_caller, v_org from app.attendance_require_self() r;

  perform pg_advisory_xact_lock(hashtext('leave:' || v_caller::text));
  select r.* into v_req from public.leave_requests r where r.id = request_id and r.member_id = v_caller for update;
  if v_req.id is null then
    perform app.fail('NOT_FOUND', 'This leave request is not yours.');
  end if;
  if v_req.state <> 'approved' then
    perform app.fail('INVALID_STATE', 'Only approved leave can be changed or cancelled.');
  end if;
  if v_req.end_date < app.today_ist() then
    perform app.fail('INVALID_STATE', 'This leave has ended. Ask the Owner to correct it.');
  end if;
  if exists (select 1 from public.leave_requests r where r.supersedes_id = v_req.id and r.state = 'submitted') then
    perform app.fail('CONFLICT', 'A change to this leave is already waiting for the Owner.');
  end if;
  -- 3b.2: a comp leave request is tied to the credits it drew for that date; it is cancelled
  -- (the credit comes back) and requested again, never moved.
  if not coalesce(cancel, false) and v_req.credit_days is not null then
    perform app.fail('INVALID_STATE', 'Comp leave can''t be changed. Ask to cancel it and request it again for the new date.');
  end if;
  -- 3c.1: a change never turns leave into comp leave: that would spend no credit.
  if not coalesce(cancel, false) and type = 'comp_leave' then
    perform app.fail('VALIDATION', 'A change can''t make this comp leave. Cancel it and request comp leave from your credit.');
  end if;

  if coalesce(cancel, false) then
    v_type := v_req.type; v_start := v_req.start_date; v_end := v_req.end_date;
  else
    v_type := type; v_start := start_date; v_end := end_date;
    perform app.leave_validate(v_type, v_start, v_end, null);
    if v_start < app.today_ist() and v_start <> v_req.start_date then
      perform app.fail('VALIDATION', 'Leave cannot start in the past.');
    end if;
    if v_end < app.today_ist() then
      perform app.fail('VALIDATION', 'The changed leave must end today or later.');
    end if;
    if app.leave_overlaps(v_caller, v_start, v_end, v_req.id) then
      perform app.fail('CONFLICT', 'You already have another request for these dates.');
    end if;
  end if;

  perform set_config('app.audit_override', jsonb_build_object(
    'action', case when coalesce(cancel, false) then 'cancellation_requested' else 'change_requested' end,
    'meta', jsonb_build_object('supersedes_id', v_req.id))::text, true);
  insert into public.leave_requests (
    member_id, type, start_date, end_date, reason, state, source, supersedes_id, requests_cancellation)
  values (v_caller, v_type, v_start, v_end, v_reason, 'submitted', 'form', v_req.id, coalesce(cancel, false))
  returning * into v_new;
  v_id := v_new.id;
  -- WORKFLOWS §9 "Leave requested / changed": the Owner (5.1).
  perform app.notify_leave_owner(v_new, v_org, case when coalesce(cancel, false) then 'cancel' else 'change' end);
  return v_id;
end;
$$;

create or replace function public.attendance_choose_leave_today(choice public.attendance_choice, reason text default null)
returns public.attendance_state
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid;
  v_org uuid;
  v_joined timestamptz;
  v_today date := app.today_ist();
  v_day public.attendance_days;
  v_state public.attendance_state;
  v_req public.leave_requests;
begin
  select r.caller_id, r.org_id into v_caller, v_org from app.attendance_require_self() r;
  if choice is null or choice not in ('leave', 'half_day') then
    perform app.fail('VALIDATION', 'Choose Leave or Half day. Comp leave is requested from the leave form.');
  end if;
  select m.joined_at into v_joined from public.members m where m.id = v_caller;
  if app.to_ist_date(v_joined) >= v_today then
    perform app.fail('INVALID_STATE', 'Your attendance starts tomorrow.');
  end if;

  perform pg_advisory_xact_lock(hashtext('leave:' || v_caller::text));

  select d.* into v_day
  from public.attendance_days d
  where d.member_id = v_caller and d.work_date = v_today
  for update;
  if v_day.id is null then
    if app.is_working_day(v_today) is false then
      perform app.fail('INVALID_STATE', 'Today is a day off: nothing to record.');
    end if;
    v_day := app.attendance_open_day(v_caller, v_today);
  end if;

  -- The 2.1 rules, request and audit, unchanged: the day is the single door for this request.
  v_state := public.attendance_submit(choice, reason, v_today);
  -- 5A decision 19: the Owner is told exactly like a leave request (5.1). The request the gate
  -- made (source = attendance) is on today's day.
  select r.* into v_req from public.leave_requests r
  join public.attendance_days d on d.leave_request_id = r.id
  where d.member_id = v_caller and d.work_date = v_today and r.state = 'submitted';
  if v_req.id is not null then
    perform app.notify_leave_owner(v_req, v_org, 'request');
  end if;
  return v_state;
end;
$$;

-- The member's leave decision rows ("Leave decided": that member).
create or replace function app.notify_leave_member(p_req public.leave_requests, p_title text, p_body text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.notify(array[p_req.member_id], 'leave_decided', p_title, p_body,
    '/leave', 'leave_requests', p_req.id, jsonb_build_object('leave_request_id', p_req.id));
end;
$$;
comment on function app.notify_leave_member(public.leave_requests, text, text) is
  '5.1, service_role only: a member''s "leave decided" row (WORKFLOWS §9), linking their Leave tab.';
revoke all on function app.notify_leave_member(public.leave_requests, text, text) from public, authenticated;
grant execute on function app.notify_leave_member(public.leave_requests, text, text) to service_role;

create or replace function public.leave_decide(request_id uuid, decision text, reason text default null)
returns table(state public.leave_state, kept_dates date[])
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_caller uuid;
  v_org uuid;
  v_reason text := app.clean_reason(reason);
  v_member uuid;
  v_req public.leave_requests;
  v_orig public.leave_requests;
  v_clash public.leave_requests;
  v_kept date[];
  v_what text;
begin
  select r.caller_id, r.org_id into v_caller, v_org from app.attendance_require_decider() r;

  if decision is null or decision not in ('approve', 'reject') then
    perform app.fail('VALIDATION', 'The decision is approve or reject.');
  end if;

  -- 2.4: whose request it is (no lock), then that person's leave: lock, then the rows.
  select r.member_id into v_member
  from public.leave_requests r
  join public.members m on m.id = r.member_id and m.org_id = v_org
  where r.id = leave_decide.request_id;
  if v_member is null then
    perform app.fail('NOT_FOUND', 'This leave request does not exist.');
  end if;
  perform pg_advisory_xact_lock(hashtext('leave:' || v_member::text));

  select r.* into v_req from public.leave_requests r where r.id = leave_decide.request_id for update;
  if v_req.source = 'attendance' then
    perform app.fail('INVALID_STATE', 'Decide this one from the attendance day: it was made at the gate.');
  end if;
  if v_req.state <> 'submitted' then
    perform app.fail('INVALID_STATE', 'This request has already been decided.');
  end if;
  v_what := case v_req.type when 'comp_leave' then 'Comp leave' when 'half_day' then 'Half day' else 'Leave' end;

  if decision = 'reject' then
    if v_reason is null then
      perform app.fail('REASON_REQUIRED', 'A rejection needs a reason.');
    end if;
    perform set_config('app.audit_override', jsonb_build_object(
      'action', 'rejected', 'meta', jsonb_build_object('reason', v_reason))::text, true);
    update public.leave_requests r
    set state = 'rejected', decided_by = v_caller, decided_at = now(), decision_reason = v_reason
    where r.id = v_req.id;
    -- 3b.2: a rejected comp leave request gives its credit back.
    perform app.comp_credit_settle(v_req.id, 'released');
    -- WORKFLOWS §9 "Leave decided": the member (5.1).
    perform app.notify_leave_member(v_req,
      case when v_req.requests_cancellation then 'Cancellation not approved'
           when v_req.supersedes_id is not null then 'Change not approved'
           else v_what || ' rejected' end,
      app.notify_span(v_req.start_date, v_req.end_date) || ' · ' || v_reason);
    return query select 'rejected'::public.leave_state, '{}'::date[];
    return;
  end if;

  if v_req.supersedes_id is not null then
    select r.* into v_orig from public.leave_requests r where r.id = v_req.supersedes_id for update;
  end if;

  if v_req.requests_cancellation then
    if v_orig.state <> 'approved' then
      perform app.fail('INVALID_STATE', 'The leave this cancellation refers to is no longer approved.');
    end if;
    perform set_config('app.audit_override', jsonb_build_object(
      'action', 'cancelled', 'meta', jsonb_build_object('by_request', v_req.id, 'reason', v_reason))::text, true);
    update public.leave_requests r
    set state = 'cancelled', decided_by = v_caller, decided_at = now(),
        decision_reason = coalesce(v_reason, 'cancellation approved')
    where r.id = v_orig.id;
    perform app.attendance_release_leave(v_orig, null, null);
    -- 3b.2: a cancelled comp leave gives its credit back (expired by now, or not).
    perform app.comp_credit_settle(v_orig.id, 'released');

    perform set_config('app.audit_override', jsonb_build_object(
      'action', 'cancelled', 'meta', jsonb_build_object('reason', v_reason))::text, true);
    update public.leave_requests r
    set state = 'cancelled', decided_by = v_caller, decided_at = now(), decision_reason = v_reason
    where r.id = v_req.id;
    perform app.notify_leave_member(v_req, v_what || ' cancelled, as you asked',
      app.notify_span(v_req.start_date, v_req.end_date)
        || case when v_reason is null then '' else ' · ' || v_reason end);
    return query select 'cancelled'::public.leave_state, '{}'::date[];
    return;
  end if;

  if v_orig.id is not null and v_orig.state = 'approved' then
    perform set_config('app.audit_override', jsonb_build_object(
      'action', 'superseded', 'meta', jsonb_build_object('by', v_req.id))::text, true);
    update public.leave_requests r set state = 'superseded' where r.id = v_orig.id;
    perform app.attendance_release_leave(v_orig, v_req.start_date, v_req.end_date);
    -- 3b.2: a superseded comp leave gives its credit back.
    perform app.comp_credit_settle(v_orig.id, 'released');
  end if;
  -- The later decision wins over a gate leave (WORKFLOWS §1, 2.2).
  perform app.leave_supersede_gate(v_req.member_id, v_req.start_date, v_req.end_date, v_req.id);
  -- Approved form or owner leave that already covers these dates (a race at submit time, or an
  -- Owner correction since): the Owner cancels or edits that one first. Submitted overlaps are
  -- not checked here; "the leave wins" supersedes a gate request, and the Owner rejects the rest.
  v_clash := app.leave_clash(v_req.member_id, v_req.start_date, v_req.end_date, v_req.id, true);
  if v_clash.id is not null then
    perform app.fail('CONFLICT', format('Approved leave (%s) already covers these dates. Cancel or edit it first.',
                                        app.leave_clash_label(v_clash)));
  end if;

  perform set_config('app.audit_override', jsonb_build_object(
    'action', 'approved', 'meta', jsonb_build_object('reason', v_reason))::text, true);
  update public.leave_requests r
  set state = 'approved', decided_by = v_caller, decided_at = now(), decision_reason = v_reason
  where r.id = v_req.id
  returning r.* into v_req;
  -- 3b.2: an approved comp leave uses its credit (oldest first, reserved at submit).
  perform app.comp_credit_settle(v_req.id, 'used');
  v_kept := app.attendance_apply_leave(v_req);
  perform app.notify_leave_member(v_req,
    case when v_orig.id is not null then v_what || ' change approved' else v_what || ' approved' end,
    app.notify_span(v_req.start_date, v_req.end_date)
      || case when v_reason is null then '' else ' · ' || v_reason end);
  return query select 'approved'::public.leave_state, v_kept;
end;
$$;

create or replace function public.leave_owner_cancel(request_id uuid, reason text default null)
returns public.leave_state
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid;
  v_org uuid;
  v_reason text := app.clean_reason(reason);
  v_member uuid;
  v_orig public.leave_requests;
begin
  select r.caller_id, r.org_id into v_caller, v_org from app.attendance_require_decider() r;

  -- 2.4: whose request it is (no lock), then that person's leave: lock, then the row.
  select r.member_id into v_member
  from public.leave_requests r
  join public.members m on m.id = r.member_id and m.org_id = v_org
  where r.id = request_id;
  if v_member is null then
    perform app.fail('NOT_FOUND', 'This leave request does not exist.');
  end if;
  perform pg_advisory_xact_lock(hashtext('leave:' || v_member::text));

  select r.* into v_orig from public.leave_requests r where r.id = request_id for update;
  if v_orig.state <> 'approved' then
    perform app.fail('INVALID_STATE', 'Only approved leave can be cancelled.');
  end if;
  if v_reason is null then
    perform app.fail('REASON_REQUIRED', 'Cancelling approved leave needs a reason.');
  end if;

  perform set_config('app.audit_override', jsonb_build_object(
    'action', 'cancelled', 'meta', jsonb_build_object('by_owner', true, 'reason', v_reason))::text, true);
  update public.leave_requests
  set state = 'cancelled', decided_by = v_caller, decided_at = now(), decision_reason = v_reason
  where id = v_orig.id;
  perform app.attendance_release_leave(v_orig, null, null);
  -- 3b.2: a cancelled comp leave gives its credit back.
  perform app.comp_credit_settle(v_orig.id, 'released');
  -- WORKFLOWS §9 "Leave decided": the member (5.1).
  perform app.notify_leave_member(v_orig,
    case v_orig.type when 'comp_leave' then 'Comp leave' when 'half_day' then 'Half day' else 'Leave' end
      || ' cancelled by the Owner',
    app.notify_span(v_orig.start_date, v_orig.end_date) || ' · ' || v_reason);
  return 'cancelled';
end;
$$;

create or replace function public.leave_owner_edit(request_id uuid, type public.leave_type, start_date date, end_date date, reason text default null)
returns table(new_id uuid, kept_dates date[])
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid;
  v_org uuid;
  v_reason text := app.clean_reason(reason);
  v_member uuid;
  v_orig public.leave_requests;
  v_new public.leave_requests;
  v_new_id uuid := gen_random_uuid();
  v_clash public.leave_requests;
  v_kept date[];
  v_comp boolean := leave_owner_edit.type = 'comp_leave';
begin
  select r.caller_id, r.org_id into v_caller, v_org from app.attendance_require_decider() r;

  -- 2.4: whose request it is (no lock), then that person's leave: lock, then the row.
  select r.member_id into v_member
  from public.leave_requests r
  join public.members m on m.id = r.member_id and m.org_id = v_org
  where r.id = leave_owner_edit.request_id;
  if v_member is null then
    perform app.fail('NOT_FOUND', 'This leave request does not exist.');
  end if;
  perform pg_advisory_xact_lock(hashtext('leave:' || v_member::text));

  select r.* into v_orig from public.leave_requests r where r.id = leave_owner_edit.request_id for update;
  if v_orig.state <> 'approved' then
    perform app.fail('INVALID_STATE', 'Only approved leave can be edited.');
  end if;
  perform app.leave_validate(leave_owner_edit.type, leave_owner_edit.start_date, leave_owner_edit.end_date, null);
  -- 3c review: comp leave uses a credit (kickoff 3b decision 16), so it keeps leave_submit_comp's
  -- limits here too: one date, on a working day.
  if v_comp and leave_owner_edit.start_date <> leave_owner_edit.end_date then
    perform app.fail('VALIDATION', 'Comp leave is one day at a time. Edit it to a single date.');
  end if;
  if v_comp and app.is_working_day(leave_owner_edit.start_date) is false then
    perform app.fail('VALIDATION', 'That date is a day off. Comp leave is for a working day.');
  end if;
  -- The later decision wins over a gate leave (WORKFLOWS §1, 2.2).
  perform app.leave_supersede_gate(v_orig.member_id, leave_owner_edit.start_date, leave_owner_edit.end_date,
                                   v_new_id, v_orig.id);
  -- A pending change or cancellation the person opened against it counts too: decide it first.
  v_clash := app.leave_clash(v_orig.member_id, leave_owner_edit.start_date, leave_owner_edit.end_date,
                             v_orig.id, false);
  if v_clash.id is not null then
    perform app.fail('CONFLICT', format('This person has another open request on these dates (%s, %s). Decide it first.',
                                        app.leave_clash_label(v_clash),
                                        case v_clash.state when 'submitted' then 'waiting' else 'approved' end));
  end if;

  perform set_config('app.audit_override', jsonb_build_object(
    'action', 'superseded', 'meta', jsonb_build_object('by_owner', true, 'reason', v_reason))::text, true);
  update public.leave_requests r set state = 'superseded' where r.id = v_orig.id;
  -- 3b.2: the Owner's replacement is owner-set leave; the comp credit goes back to the member
  -- (before the draw below, so a comp day moved to another date re-uses its own credit).
  perform app.comp_credit_settle(v_orig.id, 'released');

  perform set_config('app.audit_override', jsonb_build_object(
    'action', 'approved',
    'meta', jsonb_build_object('via', 'owner_edit', 'reason', v_reason)
            || case when v_comp then jsonb_build_object('comp', true, 'credit_days', 1.0) else '{}'::jsonb end)::text, true);
  insert into public.leave_requests (
    id, member_id, type, start_date, end_date, reason, state, source, supersedes_id, decided_by, decided_at, decision_reason,
    credit_days)
  values (
    v_new_id, v_orig.member_id, leave_owner_edit.type, leave_owner_edit.start_date, leave_owner_edit.end_date,
    v_reason, 'approved', 'owner', v_orig.id, v_caller, now(), v_reason,
    case when v_comp then 1.0 end)
  returning * into v_new;

  -- 3c review: the Owner's comp leave uses one of the member's credits valid on that date, oldest
  -- first, at once; none refuses the whole edit (the original then stays approved).
  if v_comp then
    if app.comp_credit_draw(v_new.member_id, v_new.id, v_new.start_date, 1.0) > 0 then
      perform app.fail('VALIDATION', 'Comp leave needs an earned credit valid on that date. Grant one first from their Leave tab.');
    end if;
    perform app.comp_credit_settle(v_new.id, 'used');
  end if;

  perform app.attendance_release_leave(v_orig, v_new.start_date, v_new.end_date);
  v_kept := app.attendance_apply_leave(v_new);
  -- WORKFLOWS §9 "Leave decided": the member (5.1).
  perform app.notify_leave_member(v_new, 'Leave changed by the Owner',
    format('Now %s, %s%s',
      case v_new.type when 'comp_leave' then 'comp leave' when 'half_day' then 'a half day' else 'leave' end,
      app.notify_span(v_new.start_date, v_new.end_date),
      case when v_reason is null then '' else ' · ' || v_reason end));
  return query select v_new.id, coalesce(v_kept, '{}'::date[]);
end;
$$;

create or replace function public.attendance_decide(day_id uuid, decision text, status public.day_status default null, reason text default null)
returns public.attendance_state
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid;
  v_org uuid;
  v_reason text := app.clean_reason(reason);
  v_member uuid;
  v_day public.attendance_days;
  v_req public.leave_requests;
  v_to public.day_status;
  v_link uuid;
  v_worked boolean := false;
  v_state public.attendance_state;
begin
  select r.caller_id, r.org_id into v_caller, v_org from app.attendance_require_decider() r;

  if decision is null or decision not in ('approve', 'correct') then
    perform app.fail('VALIDATION', 'The decision is approve or correct.');
  end if;

  -- 2.4: whose day it is (no lock), then that person's leave: lock, then the rows.
  select d.member_id into v_member
  from public.attendance_days d
  join public.members m on m.id = d.member_id and m.org_id = v_org
  where d.id = day_id;
  if v_member is null then
    perform app.fail('NOT_FOUND', 'This attendance day does not exist.');
  end if;
  perform pg_advisory_xact_lock(hashtext('leave:' || v_member::text));

  select d.* into v_day from public.attendance_days d where d.id = day_id for update;

  if v_day.leave_request_id is not null then
    select r.* into v_req from public.leave_requests r where r.id = v_day.leave_request_id for update;
  end if;

  if decision = 'approve' then
    if v_day.state <> 'pending_review' then
      perform app.fail('INVALID_STATE', 'Only a day awaiting review can be approved.');
    end if;
    v_to := coalesce(v_day.submitted_choice::text::public.day_status, v_day.final_status);
    if v_to is null then
      perform app.fail('INVALID_STATE', 'This day has nothing to approve.');
    end if;
    v_link := v_day.leave_request_id;
    v_worked := coalesce(
      v_day.submitted_choice = 'present' and v_req.id is not null and v_req.state = 'approved'
      and v_day.work_date between v_req.start_date and v_req.end_date, false);
    if v_req.id is not null and v_req.state = 'submitted' then
      -- The gate's leave request is decided with the day (WORKFLOWS §2).
      perform set_config('app.audit_override', jsonb_build_object(
        'action', 'approved', 'meta', jsonb_build_object('via', 'attendance', 'reason', v_reason))::text, true);
      update public.leave_requests
      set state = 'approved', decided_by = v_caller, decided_at = now(), decision_reason = v_reason
      where id = v_req.id;
    end if;
    v_state := 'approved';
    perform set_config('app.audit_override', jsonb_build_object(
      'action', 'approved',
      'meta', jsonb_build_object('status', v_to, 'reason', v_reason, 'worked_on_leave', v_worked))::text, true);
    update public.attendance_days
    set state = 'approved', final_status = v_to, decided_by = v_caller, decided_at = now(),
        decision_reason = v_reason, worked_on_leave = v_worked, leave_request_id = v_link
    where id = v_day.id;
    perform app.attendance_event(v_day.id, 'approved', v_day.final_status, v_to, v_reason, v_caller);
  else
    if status is null then
      perform app.fail('VALIDATION', 'Choose the status the day should have.');
    end if;
    if v_reason is null then
      perform app.fail('REASON_REQUIRED', 'A correction needs a reason.');
    end if;
    v_to := status;
    v_link := v_day.leave_request_id;

    if v_req.id is not null and v_req.state = 'submitted' then
      if v_req.type::text = v_to::text then
        perform set_config('app.audit_override', jsonb_build_object(
          'action', 'approved', 'meta', jsonb_build_object('via', 'attendance', 'reason', v_reason))::text, true);
        update public.leave_requests
        set state = 'approved', decided_by = v_caller, decided_at = now(), decision_reason = v_reason
        where id = v_req.id;
        v_req.state := 'approved';
      else
        perform set_config('app.audit_override', jsonb_build_object(
          'action', 'rejected', 'meta', jsonb_build_object('via', 'attendance', 'reason', v_reason))::text, true);
        update public.leave_requests
        set state = 'rejected', decided_by = v_caller, decided_at = now(), decision_reason = v_reason
        where id = v_req.id;
        v_req.state := 'rejected';
        v_link := null;
      end if;
    end if;

    if v_to in ('leave', 'half_day', 'comp_leave')
       and not (v_req.id is not null and v_req.state = 'approved' and v_req.type::text = v_to::text
                and v_day.work_date between v_req.start_date and v_req.end_date) then
      -- A leave status with no approved request of that type behind it gets one, born approved,
      -- so the calendar and availability stay right (WORKFLOWS §1).
      if v_to = 'comp_leave' then
        -- 3c review: the Owner's comp leave uses one of the member's credits, like everyone's
        -- (kickoff 3b decision 16): a full day, drawn oldest first over the credits valid on that
        -- date and used at once; none, or a day off, refuses the whole correction.
        if v_day.is_day_off then
          perform app.fail('VALIDATION', 'That date is a day off. Comp leave is for a working day.');
        end if;
        perform set_config('app.audit_override', jsonb_build_object(
          'action', 'approved',
          'meta', jsonb_build_object('via', 'correction', 'reason', v_reason, 'comp', true, 'credit_days', 1.0))::text, true);
        insert into public.leave_requests (
          member_id, type, start_date, end_date, reason, state, source, decided_by, decided_at, decision_reason, credit_days)
        values (
          v_day.member_id, 'comp_leave', v_day.work_date, v_day.work_date, v_reason,
          'approved', 'owner', v_caller, now(), v_reason, 1.0)
        returning id into v_link;
        if app.comp_credit_draw(v_day.member_id, v_link, v_day.work_date, 1.0) > 0 then
          perform app.fail('VALIDATION', 'Comp leave needs an earned credit valid on that date. Grant one first from their Leave tab.');
        end if;
        perform app.comp_credit_settle(v_link, 'used');
      else
        perform set_config('app.audit_override', jsonb_build_object(
          'action', 'approved', 'meta', jsonb_build_object('via', 'correction', 'reason', v_reason))::text, true);
        insert into public.leave_requests (
          member_id, type, start_date, end_date, reason, state, source, decided_by, decided_at, decision_reason)
        values (
          v_day.member_id, v_to::text::public.leave_type, v_day.work_date, v_day.work_date, v_reason,
          'approved', 'owner', v_caller, now(), v_reason)
        returning id into v_link;
      end if;
    end if;

    v_state := 'corrected';
    perform set_config('app.audit_override', jsonb_build_object(
      'action', 'corrected',
      'meta', jsonb_build_object('status', v_to, 'reason', v_reason, 'from_status', v_day.final_status))::text, true);
    update public.attendance_days
    set state = 'corrected', final_status = v_to, decided_by = v_caller, decided_at = now(),
        decision_reason = v_reason, proposed_by_system = false,
        -- Present on a date covered by the linked approved leave counts as a day worked, exactly
        -- like an approved "I'm working today" (owner decision 2026-09-26); the leave stays.
        worked_on_leave = (v_to = 'present' and v_req.id is not null and v_req.state = 'approved'
                           and v_day.work_date between v_req.start_date and v_req.end_date),
        leave_request_id = v_link
    where id = v_day.id;
    perform app.attendance_event(v_day.id, 'corrected', v_day.final_status, v_to, v_reason, v_caller);
  end if;

  -- WORKFLOWS §9 "Attendance decided / corrected": the member (5.1).
  perform app.notify(array[v_day.member_id], 'attendance_decided',
    format('%s: %s %s', app.notify_date(v_day.work_date),
      case v_state when 'approved' then 'approved as' else 'corrected to' end,
      case v_to when 'present' then 'Present' when 'leave' then 'Leave' when 'half_day' then 'Half day'
                when 'comp_leave' then 'Comp leave' else 'Absent' end),
    v_reason, '/leave/attendance', 'attendance_days', v_day.id,
    jsonb_build_object('day_id', v_day.id, 'work_date', v_day.work_date, 'status', v_to));
  return v_state;
end;
$$;

-- 8d. Extra work and comp leave ---------------------------------------------------------------------
create or replace function public.extra_work_note_submit(kind text, work_date date, note text, duration_minutes integer default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid;
  v_org uuid;
  v_note text := app.clean_reason(note);
  v_today date := app.today_ist();
  v_working boolean;
  v_id uuid;
begin
  select r.caller_id, r.org_id into v_caller, v_org from app.attendance_require_self() r;

  if kind is null or kind not in ('overtime', 'day_off') then
    perform app.fail('VALIDATION', 'A note is about overtime or a day off worked.');
  end if;
  if work_date is null or work_date > v_today or work_date < v_today - 7 then
    perform app.fail('VALIDATION', 'Pick a day from the last 7 days.');
  end if;
  if v_note is null then
    perform app.fail('VALIDATION', 'Say what you worked on.');
  end if;
  if kind = 'overtime' and duration_minutes is not null and (duration_minutes <= 0 or duration_minutes > 1440) then
    perform app.fail('VALIDATION', 'The duration must be between a minute and a day.');
  end if;

  -- null from is_working_day() means "unknown", which is not a day off (as attendance_touch).
  v_working := app.is_working_day(work_date) is not false;
  if kind = 'day_off' and v_working then
    perform app.fail('VALIDATION', 'That was a working day: add an overtime note instead.');
  end if;
  if kind = 'overtime' and not v_working then
    perform app.fail('VALIDATION', 'That was a day off: add an "I worked today" note instead.');
  end if;

  if exists (select 1 from public.extra_work_notes n
             where n.member_id = v_caller and n.work_date = extra_work_note_submit.work_date and n.kind = extra_work_note_submit.kind) then
    perform app.fail('CONFLICT', 'You already added a note for that day.');
  end if;
  if app.to_ist_date((select m.joined_at from public.members m where m.id = v_caller)) >= work_date then
    perform app.fail('VALIDATION', 'Your attendance had not started on that day.');
  end if;

  perform set_config('app.audit_override', jsonb_build_object(
    'action', 'submitted', 'meta', jsonb_build_object('kind', kind))::text, true);
  begin
    insert into public.extra_work_notes (member_id, work_date, kind, duration_minutes, note)
    values (v_caller, work_date, kind, case when kind = 'overtime' then duration_minutes end, v_note)
    returning id into v_id;
  exception when unique_violation then
    -- Two submits at once (two devices): the second reads as the rule, not a raw 23505.
    perform app.fail('CONFLICT', 'You already added a note for that day.');
  end;
  -- WORKFLOWS §9 "Extra work note added": the Owner (5.1). The minutes never appear (decision 24).
  perform app.notify(array[app.org_owner_id(v_org)], 'extra_work_submitted',
    format('%s %s', app.member_name(v_caller),
      case when kind = 'overtime' then 'added an overtime note' else 'worked on a day off' end),
    app.notify_date(work_date) || ' · ' || v_note,
    '/approvals', 'extra_work_notes', v_id,
    jsonb_build_object('note_id', v_id, 'member_id', v_caller, 'kind', kind));
  return v_id;
end;
$$;

create or replace function public.extra_work_note_decide(note_id uuid, decision text, days numeric default null, mark_day_worked boolean default false, note text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid;
  v_org uuid;
  v_owner_note text := app.clean_reason(note);
  v_note public.extra_work_notes;
  v_member uuid;
  v_credit uuid;
  v_day public.attendance_days;
  v_today date := app.today_ist();
begin
  select r.caller_id, r.org_id into v_caller, v_org from app.attendance_require_decider() r;

  if decision is null or decision not in ('grant', 'no_comp_leave') then
    perform app.fail('VALIDATION', 'The decision is grant or no_comp_leave.');
  end if;
  if decision = 'grant' and (days is null or days not in (0.5, 1.0)) then
    perform app.fail('VALIDATION', 'Grant half a day or one day.');
  end if;

  -- Whose note (no lock), then that person's leave: lock (the day may be written), then the row.
  select n.member_id into v_member
  from public.extra_work_notes n
  join public.members m on m.id = n.member_id and m.org_id = v_org
  where n.id = extra_work_note_decide.note_id;
  if v_member is null then
    perform app.fail('NOT_FOUND', 'This note does not exist.');
  end if;
  perform pg_advisory_xact_lock(hashtext('leave:' || v_member::text));

  select n.* into v_note from public.extra_work_notes n where n.id = extra_work_note_decide.note_id for update;
  if v_note.state <> 'submitted' then
    perform app.fail('INVALID_STATE', 'This note has already been reviewed.');
  end if;
  if coalesce(mark_day_worked, false) and v_note.kind <> 'day_off' then
    perform app.fail('VALIDATION', 'Only a day off can be marked as worked.');
  end if;

  if decision = 'grant' then
    perform set_config('app.audit_override', jsonb_build_object(
      'action', 'granted', 'meta', jsonb_build_object('note_id', v_note.id, 'days', days))::text, true);
    insert into public.comp_leave_credits (member_id, days, granted_by, granted_on, expires_on, note, note_id)
    values (v_member, days, v_caller, v_today, app.ist_month_end(v_today), v_owner_note, v_note.id)
    returning id into v_credit;
  end if;

  if coalesce(mark_day_worked, false) then
    select d.* into v_day
    from public.attendance_days d
    where d.member_id = v_member and d.work_date = v_note.work_date
    for update;
    if v_day.id is null then
      perform set_config('app.audit_override', jsonb_build_object(
        'action', 'corrected', 'meta', jsonb_build_object('via', 'extra_work_note', 'note_id', v_note.id,
                                                          'status', 'present', 'reason', 'worked on a day off'))::text, true);
      insert into public.attendance_days (
        member_id, work_date, is_day_off, state, final_status, decided_by, decided_at, decision_reason)
      values (v_member, v_note.work_date, true, 'corrected', 'present', v_caller, now(), 'worked on a day off')
      returning * into v_day;
      perform app.attendance_event(v_day.id, 'corrected', null, 'present', 'worked on a day off', v_caller);
    elsif not (v_day.state in ('approved', 'corrected') and v_day.final_status = 'present') then
      -- Whatever the day had (a 2.x sign-in with no choice, or a choice still waiting), the Owner
      -- says the day was worked; the leave request behind it, if any, is not touched.
      perform set_config('app.audit_override', jsonb_build_object(
        'action', 'corrected', 'meta', jsonb_build_object('via', 'extra_work_note', 'note_id', v_note.id,
                                                          'status', 'present', 'reason', 'worked on a day off',
                                                          'from_status', v_day.final_status))::text, true);
      update public.attendance_days
      set state = 'corrected', final_status = 'present', decided_by = v_caller, decided_at = now(),
          decision_reason = 'worked on a day off', proposed_by_system = false
      where id = v_day.id;
      perform app.attendance_event(v_day.id, 'corrected', v_day.final_status, 'present', 'worked on a day off', v_caller);
    end if;
  end if;

  perform set_config('app.audit_override', jsonb_build_object(
    'action', 'reviewed',
    'meta', jsonb_build_object('decision', decision, 'days', days, 'credit_id', v_credit,
                               'day_marked_worked', coalesce(mark_day_worked, false)))::text, true);
  update public.extra_work_notes
  set state = 'reviewed',
      decision = case when extra_work_note_decide.decision = 'grant' then 'granted' else 'no_comp_leave' end,
      day_marked_worked = coalesce(mark_day_worked, false), decided_by = v_caller, decided_at = now()
  where id = v_note.id;

  -- WORKFLOWS §9 "Extra work note decided": the member (5.1). Comp-leave days may appear in the
  -- person's own row (decision 24).
  perform app.notify(array[v_member], 'extra_work_decided',
    case when decision = 'grant'
         then format('Comp leave granted: %s · use by %s',
                     case when days = 0.5 then '½ day' else '1 day' end,
                     app.notify_date(app.ist_month_end(v_today)))
         else 'Your extra work note was reviewed' end,
    format('%s, %s%s', app.notify_date(v_note.work_date),
      case when v_note.kind = 'overtime' then 'overtime' else 'a day off worked' end,
      case when v_owner_note is null then '' else ' · ' || v_owner_note end),
    '/leave/extra-work', 'extra_work_notes', v_note.id,
    jsonb_build_object('note_id', v_note.id, 'decision', decision, 'credit_id', v_credit));

  return v_credit;
end;
$$;

create or replace function public.comp_leave_grant(member_id uuid, days numeric, note text default null, request_key uuid default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
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
    perform app.fail('NOT_FOUND', 'Comp leave is granted to an active Admin or Staff employee.');
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
$$;

create or replace function public.comp_leave_revoke(credit_id uuid, reason text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid;
  v_org uuid;
  v_reason text := app.clean_reason(reason);
  v_credit public.comp_leave_credits;
  v_member uuid;
begin
  select r.caller_id, r.org_id into v_caller, v_org from app.attendance_require_decider() r;
  if v_reason is null then
    perform app.fail('REASON_REQUIRED', 'Revoking comp leave needs a reason the person will read.');
  end if;

  -- Whose credit (no lock), then that person's leave: lock, then the row (DATA-MODEL §3 lock
  -- order), so a revoke and a comp leave request for the same person serialise.
  select c.member_id into v_member
  from public.comp_leave_credits c
  join public.members m on m.id = c.member_id and m.org_id = v_org
  where c.id = comp_leave_revoke.credit_id;
  if v_member is not null then
    perform pg_advisory_xact_lock(hashtext('leave:' || v_member::text));
  end if;
  select c.* into v_credit
  from public.comp_leave_credits c
  join public.members m on m.id = c.member_id and m.org_id = v_org
  where c.id = comp_leave_revoke.credit_id
  for update of c;
  if v_credit.id is null then
    perform app.fail('NOT_FOUND', 'This comp leave credit does not exist.');
  end if;
  if v_credit.revoked_at is not null then
    perform app.fail('INVALID_STATE', 'This credit was already revoked.');
  end if;
  if v_credit.used_days > 0 then
    perform app.fail('INVALID_STATE', 'This credit has been used: correct the leave instead.');
  end if;
  if v_credit.reserved_days > 0 then
    perform app.fail('INVALID_STATE', 'A leave request is waiting on this credit: decide that first.');
  end if;
  if v_credit.expires_on < app.today_ist() then
    perform app.fail('INVALID_STATE', 'This credit has expired; there is nothing to revoke.');
  end if;

  perform set_config('app.audit_override', jsonb_build_object(
    'action', 'revoked', 'meta', jsonb_build_object('reason', v_reason))::text, true);
  update public.comp_leave_credits
  set revoked_at = now(), revoked_by = v_caller, revoke_reason = v_reason
  where id = v_credit.id;
  -- WORKFLOWS §9 "comp leave revoked": the member (5.1).
  perform app.notify(array[v_credit.member_id], 'comp_leave_revoked',
    format('Comp leave revoked: %s', case when v_credit.days = 0.5 then '½ day' else '1 day' end),
    v_reason, '/leave', 'comp_leave_credits', v_credit.id, jsonb_build_object('credit_id', v_credit.id));
end;
$$;

create or replace function app.holiday_release_comp()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_member uuid;
  v_req public.leave_requests;
  v_by uuid := (select m.id from app.current_member() m);
  v_reason text := format('%s became a holiday (%s): this comp leave was cancelled and the credit went back.',
                          to_char(new.date, 'FMDD Mon'), new.name);
begin
  if tg_op = 'UPDATE' and new.date = old.date then
    return null;
  end if;

  for v_member in
    select distinct r.member_id
    from public.leave_requests r
    join public.members m on m.id = r.member_id and m.org_id = new.org_id
    where r.credit_days is not null and r.state in ('submitted', 'approved')
      and new.date between r.start_date and r.end_date
    order by r.member_id
  loop
    -- The member's leave: lock before any row lock (2.4).
    perform pg_advisory_xact_lock(hashtext('leave:' || v_member::text));
    for v_req in
      select r.* from public.leave_requests r
      where r.member_id = v_member and r.credit_days is not null and r.state in ('submitted', 'approved')
        and new.date between r.start_date and r.end_date
      order by r.start_date, r.id
      for update
    loop
      perform set_config('app.audit_override', jsonb_build_object(
        'action', 'cancelled',
        'meta', jsonb_build_object('holiday', true, 'holiday_date', new.date, 'reason', v_reason))::text, true);
      update public.leave_requests
      set state = 'cancelled', decided_by = v_by, decided_at = now(), decision_reason = v_reason
      where id = v_req.id;
      if v_req.state = 'approved' then
        perform app.attendance_release_leave(v_req, null, null);
      end if;
      perform app.comp_credit_settle(v_req.id, 'released');
      -- 5A decision 16 (5.1): the person is told, with the credit back.
      perform app.notify(array[v_req.member_id], 'leave_decided',
        format('Comp leave cancelled: %s is now a holiday', app.notify_date(new.date)),
        format('Your comp leave on %s was cancelled because it''s now a holiday; the credit is back.',
               app.notify_date(v_req.start_date)),
        '/leave', 'leave_requests', v_req.id,
        jsonb_build_object('leave_request_id', v_req.id, 'holiday', true), v_by);
    end loop;
  end loop;
  return null;
end;
$$;

-- 8e. Expense claims (never an amount: invariant 2, decision 24) ------------------------------------
create or replace function public.expense_claim_submit(expense_date date, amount numeric, category_id uuid, note text, receipt_file_id uuid default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid;
  v_org uuid;
  v_today date := app.today_ist();
  v_note text := nullif(btrim(coalesce(note, '')), '');
  v_above numeric;
  v_file public.files;
  v_id uuid;
  v_category text;
begin
  select r.caller_id, r.org_id into v_caller, v_org from app.attendance_require_self() r;

  if amount is null or amount <= 0 then
    perform app.fail('VALIDATION', 'Enter an amount above ₹0.');
  end if;
  if amount <> round(amount, 2) then
    perform app.fail('VALIDATION', 'Use rupees and paise: two decimals at most.');
  end if;
  if amount >= 10000000000 then
    perform app.fail('VALIDATION', 'That amount is too large.');
  end if;
  if expense_date is null then
    perform app.fail('VALIDATION', 'Pick the day of the expense.');
  end if;
  if expense_date > v_today then
    perform app.fail('VALIDATION', 'An expense can''t be in the future.');
  end if;
  if expense_date < app.expense_window_start(v_today) then
    perform app.fail('VALIDATION', 'Claims are for this month (and last month until the 5th).');
  end if;
  select li.name into v_category from public.list_items li
  where li.id = expense_claim_submit.category_id and li.org_id = v_org
    and li.list_key = 'expense_category' and li.archived_at is null;
  if v_category is null then
    perform app.fail('VALIDATION', 'Choose a category from the list.');
  end if;
  if v_note is null then
    perform app.fail('VALIDATION', 'Say what it was for.');
  end if;
  if length(v_note) > 500 then
    perform app.fail('VALIDATION', 'Keep the note under 500 characters.');
  end if;

  select s.expense_receipt_above into v_above from public.org_settings s where s.org_id = v_org;
  if receipt_file_id is null and amount > coalesce(v_above, 500) then
    v_above := coalesce(v_above, 500);
    perform app.fail('VALIDATION', 'Add a receipt photo: it''s needed above ₹'
      || case when v_above = trunc(v_above) then trunc(v_above)::text else v_above::text end || '.');
  end if;

  if receipt_file_id is not null then
    -- The checks app.files_reference_guard makes on a plain column update, here because a
    -- security definer function passes that guard (app.in_transition()).
    select f.* into v_file from public.files f where f.id = expense_claim_submit.receipt_file_id for update;
    if v_file.id is null or v_file.org_id <> v_org then
      perform app.fail('NOT_FOUND', 'This file does not exist.');
    end if;
    if v_file.uploaded_by is distinct from v_caller then
      perform app.fail('FORBIDDEN', 'Only the person who uploaded a file can attach it.');
    end if;
    if v_file.status <> 'ready' then
      perform app.fail('INVALID_STATE', 'The upload has not finished.');
    end if;
    if v_file.archived_at is not null then
      perform app.fail('INVALID_STATE', 'This file was replaced. Upload it again.');
    end if;
    if v_file.created_at <= now() - interval '6 days' then
      perform app.fail('INVALID_STATE', 'This upload has expired. Upload the file again.');
    end if;
    if v_file.preview_of is not null then
      perform app.fail('VALIDATION', 'Attach the original, not its preview.');
    end if;
    if v_file.mime not in ('image/png', 'image/jpeg', 'image/webp') then
      perform app.fail('VALIDATION', 'A receipt is a PNG, JPEG or WebP photo.');
    end if;
    if app.file_reference_count(v_file.id) > 0 then
      perform app.fail('CONFLICT', 'This file is already used elsewhere. Upload it again.');
    end if;
  end if;

  perform set_config('app.audit_override', jsonb_build_object('action', 'submitted')::text, true);
  insert into public.expense_claims (member_id, expense_date, amount, category_id, note, receipt_file_id)
  values (v_caller, expense_date, amount, category_id, v_note, receipt_file_id)
  returning id into v_id;
  -- WORKFLOWS §9 "Expense claim submitted": the Owner, no amount in the text (5.1).
  perform app.notify(array[app.org_owner_id(v_org)], 'expense_submitted',
    app.member_name(v_caller) || ' added an expense claim',
    format('%s · %s', v_category, app.notify_date(expense_date)),
    '/approvals', 'expense_claims', v_id,
    jsonb_build_object('claim_id', v_id, 'member_id', v_caller));
  return v_id;
end;
$$;

create or replace function public.expense_claim_decide(claim_id uuid, decision text, reason text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid;
  v_org uuid;
  v_reason text := app.clean_reason(reason);
  v_claim public.expense_claims;
begin
  select r.caller_id, r.org_id into v_caller, v_org from app.expenses_require_decider() r;
  if decision is null or decision not in ('approve', 'reject') then
    perform app.fail('VALIDATION', 'The decision is approve or reject.');
  end if;
  if decision = 'reject' and v_reason is null then
    perform app.fail('REASON_REQUIRED', 'A rejection needs a reason.');
  end if;
  v_claim := app.expense_claim_lock(claim_id, v_org);
  if v_claim.state <> 'submitted' then
    perform app.fail('INVALID_STATE', case v_claim.state
      when 'withdrawn' then 'This claim was withdrawn.'
      else 'This claim has already been decided.' end);
  end if;

  if decision = 'approve' then
    perform set_config('app.audit_override', jsonb_build_object('action', 'approved')::text, true);
    update public.expense_claims
    set state = 'approved', decided_by = v_caller, decided_at = now()
    where id = v_claim.id;
  else
    perform set_config('app.audit_override', jsonb_build_object('action', 'rejected')::text, true);
    update public.expense_claims
    set state = 'rejected', decided_by = v_caller, decided_at = now(), decision_reason = v_reason
    where id = v_claim.id;
  end if;
  -- WORKFLOWS §9 "Expense claim approved / rejected": the member, no amount in the text (5.1).
  perform app.notify(array[v_claim.member_id], 'expense_decided',
    case when decision = 'approve' then 'Expense claim approved' else 'Expense claim rejected' end,
    format('%s%s', app.notify_date(v_claim.expense_date),
      case when v_reason is null then '' else ' · ' || v_reason end),
    '/leave/expenses', 'expense_claims', v_claim.id,
    jsonb_build_object('claim_id', v_claim.id, 'decision', decision));
  return v_claim.id;
end;
$$;

create or replace function public.expense_claim_mark_paid(claim_id uuid, paid_on date default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid;
  v_org uuid;
  v_today date := app.today_ist();
  v_paid_on date := coalesce(paid_on, app.today_ist());
  v_claim public.expense_claims;
begin
  select r.caller_id, r.org_id into v_caller, v_org from app.expenses_require_decider() r;
  if v_paid_on > v_today then
    perform app.fail('VALIDATION', 'The payment date can''t be in the future.');
  end if;
  v_claim := app.expense_claim_lock(claim_id, v_org);
  if v_claim.state <> 'approved' then
    perform app.fail('INVALID_STATE', case v_claim.state
      when 'paid' then 'This claim is already marked paid.'
      else 'Only an approved claim can be marked paid.' end);
  end if;
  if v_paid_on < v_claim.expense_date then
    perform app.fail('VALIDATION', 'The payment date can''t be before the expense.');
  end if;
  perform set_config('app.audit_override', jsonb_build_object('action', 'paid')::text, true);
  update public.expense_claims
  set state = 'paid', paid_on = v_paid_on, paid_by = v_caller, paid_at = now()
  where id = v_claim.id;
  -- WORKFLOWS §9 "Expense claim marked paid": the member, no amount in the text (5.1).
  perform app.notify(array[v_claim.member_id], 'expense_decided', 'Expense claim paid',
    format('%s · paid on %s', app.notify_date(v_claim.expense_date), app.notify_date(v_paid_on)),
    '/leave/expenses', 'expense_claims', v_claim.id,
    jsonb_build_object('claim_id', v_claim.id, 'decision', 'paid'));
  return v_claim.id;
end;
$$;

-- 8f. Team: freelancers and coordinators ----------------------------------------------------------
-- A coordinator's link: their People page for an Admin, none for Staff (no team.view).
create or replace function app.coordinator_link(p_coordinator uuid, p_freelancer uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case when exists (
    select 1 from public.members m join public.role_permissions rp on rp.role = m.role
    where m.id = p_coordinator and rp.permission = 'team.view')
    then '/people/' || p_freelancer end;
$$;
comment on function app.coordinator_link(uuid, uuid) is
  '5.1, service_role only: the deep link of a coordinator row (the freelancer''s People page when '
  'the coordinator holds team.view, none for Staff).';
revoke all on function app.coordinator_link(uuid, uuid) from public, authenticated;
grant execute on function app.coordinator_link(uuid, uuid) to service_role;

create or replace function public.member_add_freelancer(full_name text, job_title_id uuid default null, phone text default null, coordinator_id uuid default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid;
  v_org uuid;
  v_name text := btrim(coalesce(full_name, ''));
  v_phone text := nullif(btrim(coalesce(phone, '')), '');
  v_id uuid := gen_random_uuid();
begin
  select r.caller_id, r.org_id into v_caller, v_org from app.require_team_manager() r;

  if v_name = '' then
    perform app.fail('VALIDATION', 'A name is required.');
  end if;
  if length(v_name) > 120 then
    perform app.fail('VALIDATION', 'Keep the name under 120 characters.');
  end if;
  if v_phone is not null and length(v_phone) not between 3 and 32 then
    perform app.fail('VALIDATION', 'Enter a phone number between 3 and 32 characters.');
  end if;
  perform app.coordinator_eligible(coordinator_id, v_org, v_id);

  -- Active from the start: nothing to accept (no login). joined_at = now() keeps the row's
  -- invariants (an active row has joined) and marks when the person was added.
  perform set_config('app.audit_override', jsonb_build_object('action', 'freelancer_added')::text, true);
  insert into public.members (id, org_id, full_name, email, phone, role, status, engagement, job_title_id, invited_at, joined_at)
  values (v_id, v_org, v_name, null, v_phone, 'staff', 'active', 'freelance', job_title_id, now(), now());

  perform set_config('app.audit_override', jsonb_build_object(
    'action', 'coordinator_set', 'meta', jsonb_build_object('coordinator_id', coordinator_id))::text, true);
  insert into public.member_coordinators (member_id, coordinator_id, set_by)
  values (v_id, coordinator_id, v_caller);

  -- WORKFLOWS §9 "Coordinator changed": the new coordinator (5.1).
  perform app.notify(array[coordinator_id], 'coordinator_assigned',
    'You now coordinate ' || v_name,
    format('%s added them as a freelancer.', app.member_name(v_caller)),
    app.coordinator_link(coordinator_id, v_id), 'members', v_id,
    jsonb_build_object('freelancer_id', v_id));
  return v_id;
end;
$$;

create or replace function public.member_set_coordinator(member_id uuid, coordinator_id uuid, reason text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid;
  v_org uuid;
  v_reason text := app.clean_reason(reason);
  v_target public.members;
  v_current public.member_coordinators;
  v_id uuid;
begin
  select r.caller_id, r.org_id into v_caller, v_org from app.require_team_manager() r;

  select m.* into v_target
  from public.members m
  where m.id = member_set_coordinator.member_id and m.org_id = v_org
  for update;
  if v_target.id is null then
    perform app.fail('NOT_FOUND', 'This person is not on the team.');
  end if;
  if v_target.engagement <> 'freelance' then
    perform app.fail('VALIDATION', 'Only a freelancer has a coordinator.');
  end if;
  perform app.coordinator_eligible(member_set_coordinator.coordinator_id, v_org, v_target.id);

  select mc.* into v_current
  from public.member_coordinators mc
  where mc.member_id = v_target.id and mc.to_at is null
  for update;
  if v_current.coordinator_id = member_set_coordinator.coordinator_id then
    perform app.fail('INVALID_STATE', 'They already coordinate this freelancer.');
  end if;

  if v_current.id is not null then
    perform set_config('app.audit_override', jsonb_build_object(
      'action', 'coordinator_closed',
      'meta', jsonb_build_object('reason', v_reason, 'next_coordinator_id', member_set_coordinator.coordinator_id))::text, true);
    update public.member_coordinators set to_at = now() where id = v_current.id;
  end if;

  perform set_config('app.audit_override', jsonb_build_object(
    'action', case when v_current.id is null then 'coordinator_set' else 'coordinator_changed' end,
    'meta', jsonb_build_object('reason', v_reason, 'coordinator_id', member_set_coordinator.coordinator_id,
                               'previous_coordinator_id', v_current.coordinator_id))::text, true);
  insert into public.member_coordinators (member_id, coordinator_id, set_by, reason)
  values (v_target.id, member_set_coordinator.coordinator_id, v_caller, v_reason)
  returning id into v_id;

  -- WORKFLOWS §9 "Coordinator changed": the new coordinator, and the previous one if still active
  -- (5.1; app.notify drops a deactivated one). The previous coordinator loses the freelancer's
  -- tasks: their row names the person, never a task (decision 25). The reason is the Owner's and
  -- Admins' (Kickoff 4 decision 20), so neither row carries it.
  perform app.notify(array[member_set_coordinator.coordinator_id], 'coordinator_assigned',
    'You now coordinate ' || v_target.full_name,
    format('%s made you their coordinator.', app.member_name(v_caller)),
    app.coordinator_link(member_set_coordinator.coordinator_id, v_target.id), 'members', v_target.id,
    jsonb_build_object('freelancer_id', v_target.id));
  if v_current.coordinator_id is not null then
    perform app.notify(array[v_current.coordinator_id], 'coordinator_removed',
      v_target.full_name || ' now has another coordinator',
      'Their tasks are no longer yours to act on.',
      null, 'members', v_target.id, jsonb_build_object('freelancer_id', v_target.id));
  end if;
  return v_id;
end;
$$;

create or replace function public.member_deactivate(member_id uuid, reason text default null)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid;
  v_org uuid;
  v_target public.members;
  v_reason text := nullif(btrim(coalesce(reason, '')), '');
  v_count int;
  v_row record;
begin
  select r.caller_id, r.org_id into v_caller, v_org from app.require_team_manager() r;

  if length(v_reason) > 1000 then
    perform app.fail('VALIDATION', 'Keep the reason under 1000 characters.');
  end if;

  select m.* into v_target
  from public.members m
  where m.id = member_id and m.org_id = v_org
  for update;
  if v_target.id is null then
    perform app.fail('NOT_FOUND', 'This person is not on the team.');
  end if;
  if v_target.id = v_caller then
    perform app.fail('FORBIDDEN', 'You cannot deactivate yourself.');
  end if;
  if v_target.role = 'owner' then
    perform app.fail('FORBIDDEN', 'The Owner cannot be deactivated.');
  end if;
  if v_target.status = 'deactivated' then
    perform app.fail('INVALID_STATE', 'This person is already deactivated.');
  end if;
  -- 4A (WORKFLOWS §1b): no freelancer is left without a coordinator.
  select count(*) into v_count
  from public.member_coordinators mc
  join public.members f on f.id = mc.member_id and f.status = 'active'
  where mc.coordinator_id = v_target.id and mc.to_at is null;
  if v_count > 0 then
    perform app.fail('CONFLICT', format(
      'Move %s''s %s to another coordinator first.', v_target.full_name,
      case when v_count = 1 then '1 freelancer' else v_count || ' freelancers' end));
  end if;

  if v_target.engagement = 'freelance' then
    perform set_config('app.audit_override', jsonb_build_object(
      'action', 'coordinator_closed', 'meta', jsonb_build_object('reason', 'deactivated'))::text, true);
    update public.member_coordinators mc set to_at = now()
    where mc.member_id = v_target.id and mc.to_at is null;
  end if;
  -- 4A review (M2): past the CONFLICT above, a current row still pointing at this person belongs to
  -- a deactivated freelancer (a coordinator set to prepare a reactivation). It is closed with them,
  -- so nobody is ever reactivated behind a coordinator who has left (ADR-0013 §2); the
  -- reactivation asks for a coordinator again. One row per statement: the audit override labels
  -- only the first row a statement writes. `to_at is null` again in the update, so a change that
  -- closed the row meanwhile is never overwritten (history is never rewritten).
  for v_row in
    select mc.id, mc.member_id as freelancer_id from public.member_coordinators mc
    where mc.coordinator_id = v_target.id and mc.to_at is null
  loop
    perform set_config('app.audit_override', jsonb_build_object(
      'action', 'coordinator_closed',
      'meta', jsonb_build_object('reason', 'coordinator_deactivated', 'coordinator_id', v_target.id))::text, true);
    update public.member_coordinators set to_at = now() where id = v_row.id and to_at is null;
    -- 5A decision 17 (5.1): the Owner, once per affected freelancer. Only the Owner manages the
    -- team, so the Owner is this transition's actor: the row is written with no actor (the one
    -- place the "never the actor" rule yields), because the decision names the Owner and the row
    -- is a to-do ("choose one") that would otherwise never exist.
    perform app.notify(array[app.org_owner_id(v_org)], 'coordinator_missing',
      app.member_name(v_row.freelancer_id) || ' has no coordinator: choose one',
      format('%s was deactivated.', v_target.full_name),
      '/people/' || v_row.freelancer_id, 'members', v_row.freelancer_id,
      jsonb_build_object('freelancer_id', v_row.freelancer_id, 'coordinator_id', v_target.id), null);
  end loop;

  perform set_config('app.audit_override', jsonb_build_object(
    'action', 'deactivated',
    'meta', jsonb_build_object('reason', v_reason, 'from_status', v_target.status)
  )::text, true);
  update public.members set status = 'deactivated', deactivated_at = now() where id = member_id;

  -- Access ends now, not when the JWT expires: no refresh token of theirs survives (ADR-0012).
  -- A freelancer has neither (no auth user): the deletes find nothing.
  delete from auth.refresh_tokens where user_id = member_id::text;
  delete from auth.sessions where user_id = member_id;
  -- 5.1 (WORKFLOWS §9a): their push subscriptions end with them; the rows stay as history.
  update public.push_subscriptions
  set disabled_at = now(), disabled_reason = 'deactivated'
  where push_subscriptions.member_id = member_deactivate.member_id and disabled_at is null;

  return 'deactivated';
end;
$$;

-- 8g. Clients -----------------------------------------------------------------------------------------
create or replace function public.client_assign_admin(client_id uuid, admin_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid;
  v_org uuid;
  v_client public.clients;
  v_previous uuid;
  v_assignment uuid;
begin
  select r.caller_id, r.org_id into v_caller, v_org from app.require_client_manager() r;
  select c.* into v_client from public.clients c
  where c.id = client_assign_admin.client_id and c.org_id = v_org for update;
  if v_client.id is null then
    perform app.fail('NOT_FOUND', 'This client does not exist.');
  end if;
  perform app.client_check_admin(client_assign_admin.admin_id, v_org);
  if v_client.admin_id = client_assign_admin.admin_id then
    perform app.fail('INVALID_STATE', 'This person already runs this client.');
  end if;
  v_previous := v_client.admin_id;

  update public.client_admin_assignments
  set to_at = now()
  where client_admin_assignments.client_id = v_client.id and to_at is null;
  insert into public.client_admin_assignments (client_id, admin_id, assigned_by)
  values (v_client.id, client_assign_admin.admin_id, v_caller)
  returning id into v_assignment;

  perform set_config('app.audit_override', jsonb_build_object(
    'action', 'admin_assigned',
    'meta', jsonb_build_object('from_admin_id', v_previous, 'to_admin_id', client_assign_admin.admin_id)
  )::text, true);
  update public.clients set admin_id = client_assign_admin.admin_id where id = v_client.id;

  -- Notifications (WORKFLOWS §9 "Client's Admin assigned or changed", 5.1): the new Admin
  -- ("You now run <client>") and, when still active, the previous one, without the client named
  -- or linked (decision 25). Inside client_hand_over the rows are combined there instead
  -- (decision 18): the setting below tells this function to stay quiet.
  if coalesce(current_setting('app.notify_hand_over', true), '') <> 'on' then
    perform app.notify(array[client_assign_admin.admin_id], 'client_admin_assigned',
      'You now run ' || v_client.name,
      format('Handed to you by %s.', app.member_name(v_caller)),
      '/clients/' || v_client.id, 'clients', v_client.id, jsonb_build_object('client_id', v_client.id));
    if v_previous is not null then
      perform app.notify(array[v_previous], 'client_admin_removed',
        'A client was handed to another Admin',
        format('%s moved it.', app.member_name(v_caller)));
    end if;
  end if;
  return v_assignment;
end;
$$;

create or replace function public.client_hand_over(from_admin uuid, moves jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid;
  v_org uuid;
  v_move jsonb;
  v_client uuid;
  v_count int := 0;
  v_group record;
begin
  select r.caller_id, r.org_id into v_caller, v_org from app.require_client_manager() r;
  if jsonb_typeof(moves) is distinct from 'array' or jsonb_array_length(moves) = 0 then
    perform app.fail('VALIDATION', 'Choose where the clients go.');
  end if;
  -- 5A decision 18: one combined notification per new Admin (below), not one per client.
  perform set_config('app.notify_hand_over', 'on', true);
  for v_move in select value from jsonb_array_elements(moves) loop
    v_client := nullif(v_move ->> 'client_id', '')::uuid;
    if not exists (
      select 1 from public.clients c
      where c.id = v_client and c.org_id = v_org and c.admin_id = client_hand_over.from_admin
    ) then
      perform app.fail('VALIDATION', 'Only a client this person runs can be handed over.');
    end if;
    perform public.client_assign_admin(v_client, nullif(v_move ->> 'admin_id', '')::uuid);
    v_count := v_count + 1;
  end loop;
  perform set_config('app.notify_hand_over', '', true);

  for v_group in
    select (m ->> 'admin_id')::uuid as admin_id,
           count(*) as n,
           string_agg(c.name, ', ' order by c.name) as names
    from jsonb_array_elements(moves) m
    join public.clients c on c.id = (m ->> 'client_id')::uuid
    group by (m ->> 'admin_id')::uuid
    order by 1
  loop
    perform app.notify(array[v_group.admin_id], 'client_admin_assigned',
      case when v_group.n = 1 then 'You now run ' || v_group.names
           else format('You now run %s clients', v_group.n) end,
      case when v_group.n = 1 then format('Handed to you by %s.', app.member_name(v_caller))
           else format('%s · handed to you by %s.', v_group.names, app.member_name(v_caller)) end,
      '/clients', null, null,
      jsonb_build_object('client_ids', (select jsonb_agg(m ->> 'client_id') from jsonb_array_elements(moves) m
                                         where (m ->> 'admin_id')::uuid = v_group.admin_id)));
  end loop;
  -- The previous Admin, once, without the clients named (decision 25); dropped when deactivated.
  perform app.notify(array[client_hand_over.from_admin], 'client_admin_removed',
    case when v_count = 1 then 'A client was handed to another Admin'
         else format('%s clients were handed to other Admins', v_count) end,
    format('%s moved them.', app.member_name(v_caller)));
  return v_count;
end;
$$;

-- 8h. The 23:59 job ------------------------------------------------------------------------------------
create or replace function app.absent_check(for_date date default null)
returns table(work_date date, member_id uuid, day_id uuid, outcome text)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_last date := app.job_day(now(), '23:59');
  v_first date;
  v_date date;
  v_working boolean;
  v_member record;
  v_day public.attendance_days;
  v_org uuid;
  v_proposed text[] := '{}';
  v_n integer := 0;
begin
  if for_date is null then
    -- Catch-up (WORKFLOWS §8): the last 7 IST dates, oldest first. Idempotent, so a processed
    -- day writes nothing and a missed night is filled on the next run.
    v_first := v_last - 6;
  elsif for_date > v_last then
    perform app.fail('INVALID_STATE', 'That day has not ended yet.');
  else
    v_first := for_date;
    v_last := for_date;
  end if;

  for v_date in select s::date from generate_series(v_first, v_last, interval '1 day') s loop
    v_working := app.is_working_day(v_date);
    if v_working is null then
      -- No single organization in scope: "unknown" is never a working day (DATA-MODEL §0a).
      perform app.fail('INVALID_STATE', 'No organization is in scope; the absent check did nothing.');
    end if;
    if not v_working then
      -- A day off: nothing is expected, so nothing is written, leave-derived days included.
      continue;
    end if;

    -- Everyone attendance applies to (attendance.self by role, PERMISSIONS §1; permanent members
    -- only, ADR-0013 §5) whose attendance had started on that date (the IST day after joined_at,
    -- WORKFLOWS §1), in id order so two overlapping runs take the members' locks in the same order.
    for v_member in
      select m.id, m.org_id, m.full_name
      from public.members m
      where m.status = 'active'
        and m.engagement = 'permanent'
        and app.to_ist_date(m.joined_at) < v_date
        and exists (
          select 1 from public.role_permissions rp
          where rp.role = m.role and rp.permission = 'attendance.self')
      order by m.id
    loop
      perform pg_advisory_xact_lock(hashtext('leave:' || v_member.id::text));

      select d.* into v_day
      from public.attendance_days d
      where d.member_id = v_member.id and d.work_date = v_date
      for update;

      if v_day.id is null then
        if (app.leave_covering(v_member.id, v_date)).id is not null then
          -- Approved leave comes first: the day they never started is a leave day.
          v_day := app.attendance_open_day(v_member.id, v_date);
          return query select v_date, v_member.id, v_day.id, 'derived_from_leave'::text;
          continue;
        end if;
        perform set_config('app.audit_override', jsonb_build_object('action', 'proposed_absent')::text, true);
        insert into public.attendance_days (
          member_id, work_date, is_day_off, state, proposed_by_system, final_status)
        values (v_member.id, v_date, false, 'pending_review', true, 'absent')
        returning * into v_day;
        perform app.attendance_event(v_day.id, 'proposed_absent', null, 'absent', null, null);
        v_org := v_member.org_id; v_n := v_n + 1;
        v_proposed := array_append(v_proposed, v_member.full_name || ' (' || app.notify_date(v_date) || ')');
        return query select v_date, v_member.id, v_day.id, 'proposed_absent'::text;
      elsif v_day.state = 'awaiting_choice' and not v_day.is_day_off then
        -- Opened (by a leave choice that was cancelled, say) and never chosen: "no submission".
        perform set_config('app.audit_override', jsonb_build_object('action', 'proposed_absent')::text, true);
        update public.attendance_days
        set state = 'pending_review', proposed_by_system = true, final_status = 'absent'
        where id = v_day.id
        returning * into v_day;
        perform app.attendance_event(v_day.id, 'proposed_absent', null, 'absent', null, null);
        v_org := v_member.org_id; v_n := v_n + 1;
        v_proposed := array_append(v_proposed, v_member.full_name || ' (' || app.notify_date(v_date) || ')');
        return query select v_date, v_member.id, v_day.id, 'proposed_absent'::text;
      end if;
      -- pending_review, approved, corrected, or a row marked is_day_off: nothing to do.
    end loop;
  end loop;

  -- WORKFLOWS §9 "Absent proposed": the Owner, one row per run listing everyone (5.1). No actor:
  -- the job's. Held by quiet hours until 07:00 (kickoff 5 decision 5, the dispatcher's).
  if v_n > 0 then
    perform app.notify(array[app.org_owner_id(v_org)], 'absent_proposed',
      case when v_n = 1 then '1 person proposed absent' else v_n || ' people proposed absent' end,
      left(array_to_string(v_proposed, ', '), 2000),
      '/approvals', null, null, jsonb_build_object('count', v_n), null);
  end if;
end;
$$;

-- 8i. The 20:30 reminder (3b.1's list, now a job) ------------------------------------------------------
create or replace function app.end_day_reminder(p_at timestamptz default now())
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row record;
  v_n integer := 0;
begin
  -- The org's own time (org_settings.logout_reminder_time, default 20:30 IST): nothing before it.
  -- pg_cron runs this every 5 minutes through the evening; each day is reminded once per person.
  for v_row in
    select d.member_id, d.day_id, d.started_at, m.org_id, m.role
    from app.end_day_reminder_due(p_at) d
    join public.members m on m.id = d.member_id
    join public.org_settings s on s.org_id = m.org_id
    where (p_at at time zone 'Asia/Kolkata')::time >= s.logout_reminder_time
      and not exists (
        select 1 from public.notifications n
        where n.recipient_id = d.member_id and n.kind = 'end_day_reminder'
          and n.entity = 'attendance_days' and n.entity_id = d.day_id)
    order by d.member_id
  loop
    v_n := v_n + app.notify(array[v_row.member_id], 'end_day_reminder',
      'You haven''t ended your day',
      format('Started at %s. If you''re done, end it; if you''re working late, carry on.',
             to_char(v_row.started_at at time zone 'Asia/Kolkata', 'HH24:MI')),
      case when v_row.role = 'admin' then '/today' else '/my-day' end,
      'attendance_days', v_row.day_id, jsonb_build_object('day_id', v_row.day_id), null);
  end loop;
  return v_n;
end;
$$;
comment on function app.end_day_reminder(timestamptz) is
  '5.1 (WORKFLOWS §8/§9 "Forgot to end the day"): the 20:30 reminder job. Once per person and '
  'day, from org_settings.logout_reminder_time on (IST), to everyone app.end_day_reminder_due() '
  'lists (a Start day and no End day today). pg_cron runs it every 5 minutes from 17:30 to 00:25 '
  'IST; idempotent (the notifications row is the record). Returns the rows written. No actor.';
revoke all on function app.end_day_reminder(timestamptz) from public, authenticated;
grant execute on function app.end_day_reminder(timestamptz) to service_role;
select cron.schedule('end_day_reminder', '*/5 12-18 * * *', $$select app.end_day_reminder()$$);

-- Comments of the retrofitted functions (the originals, with their 5.1 sentence) ---------------
comment on function public.leave_submit(public.leave_type, date, date, text) is
  'attendance.self. A leave request from today on (half day: one date), reason optional. Never '
  'comp_leave (VALIDATION, 3c.1: a comp leave request reserves a credit through '
  'leave_submit_comp()). CONFLICT when it overlaps the caller''s own submitted or approved '
  'request; closed requests never block. Audit action: submitted. 5.1: notifies the Owner '
  '(leave_requested) through app.notify().';

comment on function public.leave_submit_comp(date, boolean, text) is
  'attendance.self. A comp leave request for one working date, today or later: a full day (type '
  'comp_leave, credit_days 1.0) or a half day (type half_day, credit_days 0.5), reason optional, '
  'VALIDATION on a weekly day off or a holiday (3b review), CONFLICT on overlap. Draws the '
  'caller''s free credits valid on that date oldest first and reserves them; VALIDATION when they '
  'do not cover it. Still a leave request the Owner approves or rejects (decision 16). Audit '
  'action: submitted (+ reserved on the credits). 5.1: notifies the Owner (leave_requested; the '
  'kind of leave, never an amount) through app.notify().';

comment on function public.leave_request_change(uuid, public.leave_type, date, date, text, boolean) is
  'attendance.self, own approved request that has not ended (end_date >= today IST; INVALID_STATE '
  'otherwise: past leave is the Owner''s, through the attendance day) -> a new submitted row with '
  'supersedes_id (cancel = true copies the dates and sets requests_cancellation). One open change '
  'per request. 3b.2: a comp leave request (credit_days set) cannot be changed, only cancelled. '
  '3c.1: a change to type comp_leave is VALIDATION (no credit would be spent). The original stays '
  'approved until the Owner decides. Audit action: change_requested | cancellation_requested. 5.1: '
  'notifies the Owner (leave_requested, worded as a change or a cancellation) through '
  'app.notify().';

comment on function public.attendance_choose_leave_today(public.attendance_choice, text) is
  'attendance.self. The Start-day prompt''s "On leave today? Choose leave" (3b.1): leave or '
  'half_day only (VALIDATION otherwise; comp leave is requested from the leave form, kickoff 3b '
  'decision 16). Joining day and a day off are INVALID_STATE. Opens today''s row when there is '
  'none, then attendance_submit(choice, reason, today): the source = attendance request, the rules '
  'and the audit are 2.1''s. 5.1 (5A decision 19): notifies the Owner exactly like a leave request '
  '(leave_requested) through app.notify().';

comment on function public.leave_decide(uuid, text, text) is
  'attendance.decide, submitted only, never source = attendance. reject needs a reason. approve '
  'supersedes (or, for a cancellation, cancels) the original, supersedes an approved gate leave on '
  'those dates (2.2), then "a later leave wins" over the member''s days in range and a cancelled '
  'leave hands today''s untouched derived day back to the gate. CONFLICT names an approved form or '
  'owner request on those dates. Returns (state, kept_dates): the dates of days the Owner decided '
  '(approved or corrected), which keep that decision. 2.4: takes the member''s leave: advisory '
  'lock before any row lock. 3b.2: a comp leave request''s credit is used on approval and released '
  'on reject, cancel or supersede. Audit action: approved | rejected | cancelled (+ superseded | '
  'cancelled on the original). 5.1: notifies the member (leave_decided: approved, rejected, '
  'cancelled as asked, change approved or not) through app.notify().';

comment on function public.leave_owner_cancel(uuid, text) is
  'attendance.decide, approved only, reason required: → cancelled, and today''s untouched derived '
  'day goes back to awaiting_choice. 2.4: takes the member''s leave: advisory lock before any row '
  'lock. 3b.2: releases a comp leave credit. Audit action: cancelled. 5.1: notifies the member '
  '(leave_decided) through app.notify().';

comment on function public.leave_owner_edit(uuid, public.leave_type, date, date, text) is
  'attendance.decide, approved only: the original becomes superseded by a new source = owner, '
  'approved row with the given dates, then the same day corrections as leave_decide. An approved '
  'gate leave on the new dates is superseded first (2.2). CONFLICT, naming the request, while the '
  'member has another open request on those dates. 3b.2: the superseded row''s comp credit is '
  'released. 3c review: type = comp_leave is one date on a working day (VALIDATION otherwise), '
  'carries credit_days 1.0 and draws the member''s free credits valid on that date oldest first '
  '(app.comp_credit_draw, after the release above) and uses them at once; VALIDATION with none '
  '("Grant one first from their Leave tab"). 2.4: takes the member''s leave: advisory lock before '
  'any row lock; returns (new_id, kept_dates), the dates whose Owner decision was kept. Audit '
  'superseded + approved. 5.1: notifies the member (leave_decided, the new dates) through '
  'app.notify().';

comment on function public.attendance_decide(uuid, text, public.day_status, text) is
  'attendance.decide. approve: pending_review → approved with the submitted choice (or the '
  'proposed absent); worked_on_leave when Present was submitted on an approved-leave day. correct: '
  'any state → corrected with the given status, reason required; Present on a date covered by the '
  'linked approved leave sets worked_on_leave, and that leave is never touched (2026-09-26). A '
  'linked submitted request is decided in the same call; a leave status with no approved request '
  'behind it creates one (source = owner). 3c review: a correction to comp_leave creates it with '
  'credit_days 1.0, draws the member''s free credits valid on that date oldest first '
  '(app.comp_credit_draw) and uses them at once; VALIDATION with no credit ("Grant one first from '
  'their Leave tab") or on a day off; ½ is not offered here. 2.4: takes the member''s leave: '
  'advisory lock before any row lock. Bulk = one call per row. Audit action: approved | corrected. '
  '5.1: notifies the member (attendance_decided, the date and the status) through app.notify().';

comment on function public.extra_work_note_submit(text, date, text, integer) is
  'attendance.self. An overtime note (a working day, duration optional) or an "I worked today" '
  'note (a day off), for today or up to 7 days back, the note required (PRODUCT §4.3a). One per '
  'member, date and kind (CONFLICT). Audit action: submitted. 5.1: notifies the Owner '
  '(extra_work_submitted; the minutes never appear, decision 24) through app.notify().';

comment on function public.extra_work_note_decide(uuid, text, numeric, boolean, text) is
  'attendance.decide, a submitted note only. grant (days 0.5 | 1.0) creates a comp leave credit '
  'expiring at the end of this IST month, linked to the note, with the Owner''s optional note; '
  'no_comp_leave reviews it with nothing ("Reviewed by the Owner"). mark_day_worked, for a day-off '
  'note only, records the attendance day as Present on a day off (created, or corrected when it '
  'did not already count as worked; reason "worked on a day off"; any leave request stays). Takes '
  'the member''s leave: lock first. Audit: reviewed (+ granted, corrected). Returns the credit id '
  'or null. 5.1: notifies the member (extra_work_decided; the comp-leave days may appear in their '
  'own row, decision 24) through app.notify().';

comment on function public.comp_leave_grant(uuid, numeric, text, uuid) is
  'attendance.decide. A standalone comp leave grant (PRODUCT §4.3a, decision 14): half a day or '
  'one day to an active permanent member who marks attendance (never a freelancer, 4A), expiring '
  'at the end of this IST month, with an optional note the member sees. Idempotent on request_key '
  '(3b review): the same key returns the first credit (CONFLICT when the amount differs). Audit '
  'action: granted. 5.1: notifies the member (comp_leave_granted) through app.notify(), once per '
  'grant.';

comment on function public.comp_leave_revoke(uuid, text) is
  'attendance.decide, REASON_REQUIRED. Revokes an unused, unreserved, unexpired credit (decision '
  '17); the reason is shown to the member. Audit action: revoked. 5.1: notifies the member '
  '(comp_leave_revoked, with the reason) through app.notify().';

comment on function app.holiday_release_comp() is
  'AFTER INSERT / UPDATE OF date on holidays (3b review): a waiting or approved comp leave request '
  'covering the new holiday is cancelled with a reason the member reads, today''s untouched '
  'derived day goes back to awaiting_choice, and the credit is released (app.comp_credit_settle). '
  'Audit: cancelled on the request, released on the credit and its use. 5.1 (5A decision 16): '
  'notifies the member (leave_decided: "Your comp leave on <date> was cancelled because it''s now '
  'a holiday; the credit is back") through app.notify().';

comment on function public.expense_claim_submit(date, numeric, uuid, text, uuid) is
  'attendance.self (Admins and Staff; the Owner has no claims). The claim window: this IST month, '
  'or last month through the 5th, never a future date; an active expense_category; amount > 0 with '
  'at most two decimals; the note required (≤ 500); a receipt required above '
  'org_settings.expense_receipt_above: a ready, unarchived PNG / JPEG / WebP original the caller '
  'uploaded less than 6 days ago and attached nowhere else. Audit action: submitted. 5.1: notifies '
  'the Owner (expense_submitted: the category and the date, never the amount) through '
  'app.notify().';

comment on function public.expense_claim_decide(uuid, text, text) is
  'expenses.decide (the Owner), a submitted claim only. approve -> approved; reject -> rejected '
  'with the reason (REASON_REQUIRED without one), which the member reads. Audit: approved | '
  'rejected. 5.1: notifies the member (expense_decided, with the reason, never the amount) through '
  'app.notify().';

comment on function public.expense_claim_mark_paid(uuid, date) is
  'expenses.decide, an approved claim only -> paid on paid_on (default today, IST; not in the '
  'future, not before the expense). Audit action: paid. 5.1: notifies the member (expense_decided, '
  'the payment date, never the amount) through app.notify().';

comment on function public.member_add_freelancer(text, uuid, text, uuid) is
  'team.manage. "Add person -> Freelancer" (ADR-0013): a members row with a fresh id, role staff, '
  'status active, engagement freelance, no email and no auth user, plus the first '
  'member_coordinators row. The coordinator is an active permanent Admin or Staff, never the '
  'Owner. Audit actions: freelancer_added (members), coordinator_set (member_coordinators). 5.1: '
  'notifies the coordinator (coordinator_assigned) through app.notify().';

comment on function public.member_set_coordinator(uuid, uuid, text) is
  'team.manage. "Change coordinator": closes the freelancer''s current member_coordinators row '
  '(to_at) and opens the next (set_by, reason) in one transaction; allowed on a deactivated '
  'freelancer too, which is how a reactivation is prepared. VALIDATION for a permanent member or '
  'an ineligible coordinator (not active permanent Admin / Staff, the Owner, the freelancer), '
  'INVALID_STATE when that coordinator is already current. Returns the new row''s id. Audit '
  'actions: coordinator_closed, then coordinator_changed (or coordinator_set when none was '
  'current). 5.1: notifies the new coordinator (coordinator_assigned) and the previous one if '
  'still active (coordinator_removed, naming the freelancer, never a task: decision 25) through '
  'app.notify().';

comment on function public.member_deactivate(uuid, text) is
  'team.manage. active | invited → deactivated; never the caller, never the Owner; CONFLICT while '
  'an active freelancer has them as current coordinator (4A). Closes every current coordinator row '
  'of the person: their own as a freelancer (reason deactivated) and the rows of deactivated '
  'freelancers still pointing at them (reason coordinator_deactivated; 4A review M2). Deletes the '
  'person''s auth.refresh_tokens and auth.sessions in the same transaction. The optional reason is '
  'kept in the activity log (meta.reason). Audit action: deactivated. 5.1: the person''s push '
  'subscriptions are disabled (''deactivated''); the Owner is told once per freelancer whose '
  'coordinator row this closes (coordinator_missing, 5A decision 17) through app.notify().';

comment on function public.client_assign_admin(uuid, uuid) is
  'clients.manage, any state. Closes the open client_admin_assignments row, opens the next and '
  'moves clients.admin_id, so access moves at once (PERMISSIONS §2). Refuses the current Admin '
  '(INVALID_STATE) and anyone who is not an active Admin (VALIDATION). Returns the new assignment '
  'id. Audit action: admin_assigned (meta.from_admin_id, meta.to_admin_id). 5.1: notifies the new '
  'Admin (client_admin_assigned, "You now run <client>") and the previous one if still active '
  '(client_admin_removed, the client neither named nor linked: decision 25) through app.notify(); '
  'quiet inside client_hand_over (app.notify_hand_over), which combines them.';

comment on function public.client_hand_over(uuid, jsonb) is
  'clients.manage. Moves some or all of from_admin''s clients to other active Admins in one '
  'transaction: moves = [{client_id, admin_id}], each through client_assign_admin() (its history '
  'row, audit and notifications). Refuses a client from_admin does not run (VALIDATION). Used '
  'before a demotion or deactivation (members_client_admin_guard). Returns the number moved. 5.1 '
  '(5A decision 18): one combined notification per new Admin listing the clients '
  '(client_admin_assigned) and one to from_admin (client_admin_removed, no clients named), through '
  'app.notify(); client_assign_admin stays quiet meanwhile.';

comment on function app.absent_check(date) is
  'The 23:59 IST job (WORKFLOWS §1/§8). For the last 7 IST dates up to job_day(now(), ''23:59''), '
  'or the one date given (INVALID_STATE before its cutoff): on a working day, every active '
  'permanent member with attendance.self whose attendance has started gets a leave-derived day '
  'when approved leave covers the date and they never started, or a proposed absence '
  '(pending_review, absent, proposed_by_system) when they have no day or an awaiting_choice one. '
  'Nothing on a day off, nothing for a freelancer (4A). Idempotent. Each member under their leave: '
  'lock. Returns one row per day written. 5.1: notifies the Owner once per run with everyone '
  'proposed absent (absent_proposed, names and dates; no actor) through app.notify().';
