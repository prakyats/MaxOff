-- 5.3 (unit 5B): task reminders and escalations (WORKFLOWS §3.1, §3.2, §8, §9 and "Settled at
-- kickoff 5"; kickoff 5 decisions 11-13; 5B decision 12; owner answers 2026-10-02 in PROGRESS).
-- Expand-only: new kinds, two new tables, new functions, a trigger on tasks, CHECK constraints
-- added NOT VALID (they guard new writes; every stored list is '[]' today), and the cron job
-- `end_day_reminder` folded into `reminders_tick` (same function, same 5 minutes).
--
-- **No backfill (owner, 2026-10-02):** a task gets reminders only once it is *armed*
-- (`task_reminder_arms`): when it is created after this migration. A task that exists now has no
-- arm row, so nothing here ever reminds or escalates about it (acknowledgement repeats and
-- escalations included) until the owner says otherwise. `org_settings.default_task_reminders`
-- stays '[]': an empty list at every level means "the next level", and the last level is the
-- launch schedule built in below (2 days, 1 day, Due now), so nothing is written to any row.
--
-- The rules (a reminder rule list, `app.reminder_rules_valid`): up to 5 objects
-- {"before": N, "unit": "minutes" | "hours" | "days"}, N a whole number from 0 (0 = "Due now"),
-- at most 60 days, no two the same. Resolution, each replacing the one below (no merge): the
-- task's own, its template's, its type's, the organisation's, the launch schedule.
--
-- What is armed for a task (`app.task_arm_reminders`, by the trigger on insert and when the
-- deadline, the rules, the event date or a reopen change it):
--   * one `before_due` row per rule with N > 0 (the latest-firing of them is `last_before_due`:
--     the one that is always emailed), and `due` for N = 0;
--   * `overdue` 1 h after the deadline; `overdue_escalation` `overdue_escalate_hours` after it;
--   * `event` at 18:00 IST the day before `event_date`, for an event task.
-- A time already past when it is armed is skipped, never sent late. Re-arming cancels whatever is
-- not sent yet; a row already sent for the same deadline (and offset) is never armed again, so a
-- reopen with an unchanged deadline sends nothing twice.
--
-- `reminders_tick` (every 5 minutes): the deadline rows that are due, while the task is todo,
-- in_progress or changes_requested (anything else cancels them); held rows coming back;
-- acknowledgement repeats every `ack_repeat_hours` to an assignee who has not tapped Task Noted;
-- the not-noted escalations at `ack_escalate_hours` (level 1: the approving Admin, or the creator)
-- and `ack_escalate_owner_hours` (level 2: the Owner; skipped when level 1 already went to the
-- Owner), one notification a task and level naming everyone not noted; and the end-day reminder.
-- **Pause (kickoff 5 decision 13, owner 2026-10-02):** on a day of approved full-day leave or comp
-- leave, or a holiday (weekly days off pause nothing; half days pause nothing), the person's
-- before-due and Due now reminders are **held** to the start of their next working day (the next
-- day that is none of those, at the end of the overnight quiet hours) and then go as one message,
-- if the deadline is still ahead (else dropped: the overdue reminder covers it); their
-- acknowledgement repeats are skipped and restart at that time. Escalations are never paused.
--
-- Recipients (WORKFLOWS §9): before-due, Due now and repeats: the assignee (a freelancer's to their
-- coordinator, `app.notify`); overdue: the assignees and the approving Admin (or creator); event:
-- the assignees and the approving Admin; escalations as above. Nobody is the actor (a job).
-- Email (5B decision 12): always emailed: the last before-due, overdue, event, both escalations;
-- push and in-app only: earlier before-due, Due now, the repeats. Escalations carry
-- `escalation_level` 1 or 2 (they bypass the per-person cap).

-- 1. Kinds ------------------------------------------------------------------------------------------
insert into public.notification_kinds (kind, actionable, always_email, description) values
  ('reminder_before_due',      false, false, 'A task you are on is due soon (an earlier before-due reminder)'),
  ('reminder_before_due_last', false, true,  'A task you are on is due soon (the last before-due reminder, always emailed)'),
  ('reminder_due_now',         false, false, 'A task you are on is due now'),
  ('reminder_overdue',         false, true,  'A task is past its deadline (1 h after, always emailed)'),
  ('reminder_event',           false, true,  'An event task is tomorrow (18:00 IST the day before, always emailed)'),
  ('reminder_not_noted',       false, false, 'You have not tapped Task Noted yet (every 2 h)'),
  ('escalation_not_noted',     false, true,  'Someone has not noted a task (4 h: the approving Admin; 8 h: the Owner)'),
  ('escalation_overdue',       false, true,  'A task is a day overdue with nothing handed in (the approving Admin and the Owner)')
on conflict (kind) do nothing;

-- 2. The rule lists ---------------------------------------------------------------------------------
create or replace function app.reminder_rules_valid(p_rules jsonb)
returns boolean
language sql
immutable
parallel safe
set search_path = ''
as $$
  select p_rules is not null
    and jsonb_typeof(p_rules) = 'array'
    and jsonb_array_length(p_rules) <= 5
    and not exists (
      select 1 from jsonb_array_elements(p_rules) e
      where jsonb_typeof(e) <> 'object'
         or (select count(*) from jsonb_object_keys(e)) <> 2
         or not (e ? 'before' and e ? 'unit')
         or jsonb_typeof(e -> 'before') <> 'number'
         or (e ->> 'unit') not in ('minutes', 'hours', 'days')
         or (e ->> 'before') !~ '^[0-9]{1,5}$'
         or (e ->> 'before')::integer * case e ->> 'unit' when 'minutes' then 1 when 'hours' then 60 else 1440 end > 86400)
    and (select count(distinct (e ->> 'before')::integer
                  * case e ->> 'unit' when 'minutes' then 1 when 'hours' then 60 else 1440 end)
         from jsonb_array_elements(p_rules) e
         where jsonb_typeof(e) = 'object' and (e ->> 'before') ~ '^[0-9]{1,5}$')
        = jsonb_array_length(p_rules);
$$;
comment on function app.reminder_rules_valid(jsonb) is
  '5.3: a reminder rule list: up to 5 {"before": N, "unit": minutes|hours|days}, N a whole number '
  'from 0 (Due now) up to 60 days, no two the same. An empty list means "use the next level".';
revoke all on function app.reminder_rules_valid(jsonb) from public;
grant execute on function app.reminder_rules_valid(jsonb) to authenticated, service_role;

-- A rule's distance before the deadline.
create or replace function app.reminder_offset(p_rule jsonb)
returns interval
language sql
immutable
parallel safe
strict
set search_path = ''
as $$
  select make_interval(mins => (p_rule ->> 'before')::integer
    * case p_rule ->> 'unit' when 'minutes' then 1 when 'hours' then 60 else 1440 end);
$$;
revoke all on function app.reminder_offset(jsonb) from public, authenticated;
grant execute on function app.reminder_offset(jsonb) to service_role;

-- The caller-given lists of task_create / task_update_assignment (phase 4 L2 kept: 4 KB).
create or replace function app.task_check_reminders(p_rules jsonb)
returns void
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_rules is null or jsonb_typeof(p_rules) <> 'array' then
    perform app.fail('VALIDATION', 'Reminder rules are a list.');
  end if;
  if jsonb_array_length(p_rules) > 5 or octet_length(p_rules::text) > 4096 then
    perform app.fail('VALIDATION', 'Up to 5 reminders.');
  end if;
  if not app.reminder_rules_valid(p_rules) then
    perform app.fail('VALIDATION', 'Each reminder is a whole number of minutes, hours or days before the deadline, up to 60 days, each different.');
  end if;
end;
$$;
comment on function app.task_check_reminders(jsonb) is
  'Internal (phase 4 review L2; 5.3): VALIDATION unless the reminder rules a caller gives '
  'task_create / task_update_assignment are a valid list (app.reminder_rules_valid), 4 KB in all.';

alter table public.tasks
  add constraint tasks_reminder_rules_valid check (app.reminder_rules_valid(reminder_rules)) not valid;
alter table public.task_types
  add constraint task_types_default_reminders_valid check (app.reminder_rules_valid(default_reminders)) not valid;
alter table public.task_templates
  add constraint task_templates_reminder_rules_valid check (app.reminder_rules_valid(reminder_rules)) not valid;
alter table public.org_settings
  add constraint org_settings_default_task_reminders_valid check (app.reminder_rules_valid(default_task_reminders)) not valid;

-- The list a task follows: its own, its template's, its type's, the organisation's, the launch one.
create or replace function app.task_reminder_rules(p_task_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    nullif(t.reminder_rules, '[]'::jsonb),
    nullif(tpl.reminder_rules, '[]'::jsonb),
    nullif(ty.default_reminders, '[]'::jsonb),
    nullif(s.default_task_reminders, '[]'::jsonb),
    '[{"before": 2, "unit": "days"}, {"before": 1, "unit": "days"}, {"before": 0, "unit": "minutes"}]'::jsonb)
  from public.tasks t
  join public.task_types ty on ty.id = t.task_type_id
  left join public.task_templates tpl on tpl.id = t.template_id
  left join public.org_settings s on s.org_id = t.org_id
  where t.id = p_task_id;
$$;
comment on function app.task_reminder_rules(uuid) is
  '5.3, service_role only: the reminder list a task follows (its own, its template''s, its type''s, '
  'the organisation''s, then the launch schedule: 2 days, 1 day, Due now); an empty list is "the next level".';
revoke all on function app.task_reminder_rules(uuid) from public, authenticated;
grant execute on function app.task_reminder_rules(uuid) to service_role;

-- 3. Tables -----------------------------------------------------------------------------------------
create table public.task_reminder_arms (
  task_id uuid primary key references public.tasks (id) on delete cascade,
  armed_at timestamptz not null default now()
);
comment on table public.task_reminder_arms is
  '5.3: the tasks that get reminders and escalations: those created after migration task_reminders '
  '(no backfill of existing tasks without the owner''s OK). Written by the tasks trigger only. RLS: '
  'no API access. Not audited (a schedule, not a fact about the task).';
alter table public.task_reminder_arms enable row level security;
revoke all on public.task_reminder_arms from anon, authenticated;

create table public.task_reminders (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id),
  task_id uuid not null references public.tasks (id) on delete cascade,
  member_id uuid null references public.members (id) on delete cascade,
  kind text not null check (kind in
    ('before_due', 'due', 'overdue', 'ack', 'ack_escalation', 'overdue_escalation', 'event')),
  escalation_level integer null check (escalation_level is null or escalation_level in (1, 2)),
  offset_minutes integer null,
  last_before_due boolean not null default false,
  deadline timestamptz null,
  held boolean not null default false,
  fire_at timestamptz not null,
  sent_at timestamptz null,
  cancelled_at timestamptz null,
  created_at timestamptz not null default now(),
  constraint task_reminders_one_end check (sent_at is null or cancelled_at is null)
);
comment on table public.task_reminders is
  '5.3 (ADR-0009): the materialized reminder schedule and the record of what was sent. Deadline '
  'rows (member_id null: before_due, due, overdue, overdue_escalation, event) are armed by '
  'app.task_arm_reminders; held rows (held, member_id) bring a paused person''s before-due / Due now '
  'back on their next working day; ack and ack_escalation rows (member_id = the assignee) record '
  'each repeat and escalation sent. sent_at = sent; cancelled_at = re-armed, skipped or no longer due. '
  'RLS: no API access (the job and the trigger write it). Not audited.';
create index task_reminders_due_idx on public.task_reminders (fire_at) where sent_at is null and cancelled_at is null;
create index task_reminders_task_idx on public.task_reminders (task_id, kind);
create index task_reminders_member_idx on public.task_reminders (member_id) where member_id is not null;
alter table public.task_reminders enable row level security;
revoke all on public.task_reminders from anon, authenticated;

-- 4. Arming -----------------------------------------------------------------------------------------
create or replace function app.task_arm_reminders(p_task_id uuid, p_now timestamptz default now())
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_task public.tasks;
  v_hours integer;
  v_rules jsonb;
  v_rule jsonb;
  v_offset interval;
  v_last interval;
begin
  select * into v_task from public.tasks where id = p_task_id;
  if not found or not exists (select 1 from public.task_reminder_arms a where a.task_id = p_task_id) then
    return 0;
  end if;
  -- Re-arm: whatever is not sent yet goes (sent rows stay sent).
  update public.task_reminders set cancelled_at = p_now
  where task_id = p_task_id and sent_at is null and cancelled_at is null
    and kind in ('before_due', 'due', 'overdue', 'overdue_escalation', 'event');
  if v_task.state in ('completed', 'cancelled') then
    return 0;
  end if;

  select s.overdue_escalate_hours into v_hours from public.org_settings s where s.org_id = v_task.org_id;
  v_rules := app.task_reminder_rules(p_task_id);
  -- The last before-due reminder (always emailed) is the latest-firing one: the smallest offset
  -- above zero. It keeps that role even when its time has passed and it is skipped (owner,
  -- 2026-10-02: nothing replaces a skipped reminder).
  select min(app.reminder_offset(e)) into v_last
  from jsonb_array_elements(v_rules) e where (e ->> 'before')::integer > 0;

  for v_rule in select e from jsonb_array_elements(v_rules) e loop
    v_offset := app.reminder_offset(v_rule);
    insert into public.task_reminders (org_id, task_id, kind, offset_minutes, last_before_due, deadline, fire_at)
    select v_task.org_id, p_task_id,
      case when v_offset = interval '0' then 'due' else 'before_due' end,
      (extract(epoch from v_offset) / 60)::integer,
      v_offset > interval '0' and v_offset = v_last,
      v_task.due_at, v_task.due_at - v_offset
    where v_task.due_at - v_offset > p_now
      and not exists (select 1 from public.task_reminders r
        where r.task_id = p_task_id and r.sent_at is not null and r.member_id is null
          and r.kind in ('before_due', 'due') and r.deadline = v_task.due_at
          and r.offset_minutes = (extract(epoch from v_offset) / 60)::integer);
  end loop;

  insert into public.task_reminders (org_id, task_id, kind, deadline, fire_at, escalation_level)
  select v_task.org_id, p_task_id, x.kind, v_task.due_at, x.fire_at, x.level
  from (values
    ('overdue', v_task.due_at + interval '1 hour', null::integer),
    ('overdue_escalation', v_task.due_at + make_interval(hours => coalesce(v_hours, 24)), null::integer)) as x(kind, fire_at, level)
  where x.fire_at > p_now
    and not exists (select 1 from public.task_reminders r
      where r.task_id = p_task_id and r.sent_at is not null and r.kind = x.kind and r.deadline = v_task.due_at);

  if v_task.event_date is not null then
    insert into public.task_reminders (org_id, task_id, kind, deadline, fire_at)
    select v_task.org_id, p_task_id, 'event', v_task.due_at,
      app.ist_day_start(v_task.event_date - 1) + interval '18 hours'
    where app.ist_day_start(v_task.event_date - 1) + interval '18 hours' > p_now
      and not exists (select 1 from public.task_reminders r
        where r.task_id = p_task_id and r.sent_at is not null and r.kind = 'event'
          and r.fire_at = app.ist_day_start(v_task.event_date - 1) + interval '18 hours');
  end if;

  return (select count(*)::integer from public.task_reminders r
    where r.task_id = p_task_id and r.sent_at is null and r.cancelled_at is null);
end;
$$;
comment on function app.task_arm_reminders(uuid, timestamptz) is
  '5.3, service_role only: (re)arms an armed task''s deadline reminders from its rule list (cancels '
  'what is not sent; skips a time already past and anything already sent for the same deadline); '
  'returns how many are waiting. A completed or cancelled task keeps none.';
revoke all on function app.task_arm_reminders(uuid, timestamptz) from public, authenticated;
grant execute on function app.task_arm_reminders(uuid, timestamptz) to service_role;

create or replace function app.tasks_reminders_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.task_reminder_arms (task_id) values (new.id) on conflict do nothing;
    perform app.task_arm_reminders(new.id);
  elsif new.due_at is distinct from old.due_at
     or new.reminder_rules is distinct from old.reminder_rules
     or new.event_date is distinct from old.event_date
     or (new.state in ('completed', 'cancelled')) <> (old.state in ('completed', 'cancelled')) then
    -- Only an armed task (one created after migration task_reminders) is (re)armed.
    perform app.task_arm_reminders(new.id);
  end if;
  return null;
end;
$$;
revoke all on function app.tasks_reminders_trigger() from public, authenticated;
grant execute on function app.tasks_reminders_trigger() to service_role;
create trigger tasks_reminders after insert or update of due_at, reminder_rules, event_date, state
  on public.tasks for each row execute function app.tasks_reminders_trigger();

-- 5. Pauses -----------------------------------------------------------------------------------------
-- A person's reminders are paused on a day of approved full-day leave or comp leave, or a holiday.
create or replace function app.reminder_paused(p_member uuid, p_org uuid, p_day date)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.holidays h where h.org_id = p_org and h.date = p_day)
    or exists (select 1 from public.leave_requests r
               where r.member_id = p_member and r.state = 'approved' and r.type in ('leave', 'comp_leave')
                 and r.start_date <= p_day and r.end_date >= p_day);
$$;
comment on function app.reminder_paused(uuid, uuid, date) is
  '5.3, service_role only (kickoff 5 decision 13, owner 2026-10-02): approved full-day leave or comp '
  'leave, or a holiday. Half days and weekly days off pause nothing.';
revoke all on function app.reminder_paused(uuid, uuid, date) from public, authenticated;
grant execute on function app.reminder_paused(uuid, uuid, date) to service_role;

-- When a paused person's reminders come back: their next day that is not paused, at the end of the
-- overnight quiet hours (07:00 IST at launch), so the message is not held again.
create or replace function app.reminder_resume_at(p_member uuid, p_org uuid, p_day date)
returns timestamptz
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_day date := p_day + 1;
  v_start time;
  v_end time;
begin
  select s.quiet_hours_start, s.quiet_hours_end into v_start, v_end from public.org_settings s where s.org_id = p_org;
  while app.reminder_paused(p_member, p_org, v_day) and v_day < p_day + 366 loop
    v_day := v_day + 1;
  end loop;
  return app.ist_day_start(v_day) + case when v_start > v_end then v_end - time '00:00' else interval '0' end;
end;
$$;
revoke all on function app.reminder_resume_at(uuid, uuid, date) from public, authenticated;
grant execute on function app.reminder_resume_at(uuid, uuid, date) to service_role;

-- "in 2 days", "in 3 hours", "in 30 minutes": a before-due reminder's title.
create or replace function app.reminder_in(p_minutes integer)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select case
    when p_minutes is null or p_minutes <= 0 then 'now'
    when p_minutes % 1440 = 0 then 'in ' || (p_minutes / 1440) || case when p_minutes = 1440 then ' day' else ' days' end
    when p_minutes % 60 = 0 then 'in ' || (p_minutes / 60) || case when p_minutes = 60 then ' hour' else ' hours' end
    else 'in ' || p_minutes || case when p_minutes = 1 then ' minute' else ' minutes' end
  end;
$$;
revoke all on function app.reminder_in(integer) from public, authenticated;
grant execute on function app.reminder_in(integer) to service_role;

-- 6. The tick ---------------------------------------------------------------------------------------
create or replace function app.reminders_tick(p_now timestamptz default now())
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row record;
  v_task public.tasks;
  v_today date := app.to_ist_date(p_now);
  v_send uuid[];
  v_member uuid;
  v_lead uuid;
  v_owner uuid;
  v_kind text;
  v_title text;
  v_body text;
  v_link text;
  v_n integer := 0;
  v_names text;
  v_ids uuid[];
begin
  -- a. Deadline rows that are due. One run at a time (two would send twice).
  perform pg_advisory_xact_lock(hashtext('app.reminders_tick'));
  for v_row in
    select r.* from public.task_reminders r
    where r.member_id is null and r.sent_at is null and r.cancelled_at is null and r.fire_at <= p_now
    order by r.fire_at, r.id
    for update skip locked
  loop
    select * into v_task from public.tasks t where t.id = v_row.task_id;
    -- Gone stale (the job was down for over an hour) or the task is not with its people: skipped.
    if v_row.fire_at < p_now - interval '1 hour'
       or v_task.state not in ('todo', 'in_progress', 'changes_requested')
       or v_task.due_at is distinct from v_row.deadline then
      update public.task_reminders set cancelled_at = p_now where id = v_row.id;
      continue;
    end if;
    v_lead := coalesce(v_task.approving_admin_id, v_task.created_by);
    v_owner := app.org_owner_id(v_task.org_id);
    v_link := '/tasks/' || v_task.id;

    if v_row.kind in ('before_due', 'due') then
      v_send := '{}';
      for v_member in select unnest(app.task_people(v_task.id, false)) loop
        if app.reminder_paused(v_member, v_task.org_id, v_today) then
          -- Held to the person's next working day (kickoff 5 decision 13, owner 2026-10-02).
          insert into public.task_reminders (org_id, task_id, member_id, kind, offset_minutes, last_before_due, deadline, held, fire_at)
          values (v_task.org_id, v_task.id, v_member, v_row.kind, v_row.offset_minutes, v_row.last_before_due,
                  v_row.deadline, true, app.reminder_resume_at(v_member, v_task.org_id, v_today));
        else
          v_send := v_send || v_member;
        end if;
      end loop;
      v_kind := case when v_row.kind = 'due' then 'reminder_due_now'
                     when v_row.last_before_due then 'reminder_before_due_last' else 'reminder_before_due' end;
      v_title := case when v_row.kind = 'due' then 'Due now: ' else 'Due ' || app.reminder_in(v_row.offset_minutes) || ': ' end || v_task.title;
      perform app.notify(v_send, v_kind, v_title, 'Due ' || app.notify_when(v_task.due_at) || '.',
        v_link, 'tasks', v_task.id, jsonb_build_object('task_id', v_task.id), null);
    elsif v_row.kind = 'overdue' then
      perform app.notify(app.task_people(v_task.id, false) || v_lead, 'reminder_overdue', 'Overdue: ' || v_task.title,
        'It was due ' || app.notify_when(v_task.due_at) || '.', v_link, 'tasks', v_task.id,
        jsonb_build_object('task_id', v_task.id), null);
    elsif v_row.kind = 'event' then
      perform app.notify(app.task_people(v_task.id, false) || v_task.approving_admin_id, 'reminder_event',
        'Tomorrow: ' || v_task.title,
        coalesce('Starts ' || app.notify_when(v_task.event_start_at), app.notify_date(v_task.event_date))
          || coalesce(' · ' || v_task.location, '') || '.',
        v_link, 'tasks', v_task.id, jsonb_build_object('task_id', v_task.id), null);
    elsif v_row.kind = 'overdue_escalation' then
      v_title := 'A day overdue: ' || v_task.title;
      v_body := 'It was due ' || app.notify_when(v_task.due_at) || ' and nothing has been handed in.';
      perform app.notify(array[v_lead], 'escalation_overdue', v_title, v_body, v_link, 'tasks', v_task.id,
        jsonb_build_object('task_id', v_task.id), null, 1);
      if v_owner is distinct from v_lead then
        perform app.notify(array[v_owner], 'escalation_overdue', v_title, v_body, v_link, 'tasks', v_task.id,
          jsonb_build_object('task_id', v_task.id), null, 2);
      end if;
    end if;
    update public.task_reminders set sent_at = p_now where id = v_row.id;
  end loop;

  -- b. Held rows coming back: one message a person, when their deadlines are still ahead.
  for v_member in
    select distinct r.member_id from public.task_reminders r
    where r.held and r.sent_at is null and r.cancelled_at is null and r.fire_at <= p_now
  loop
    update public.task_reminders r set cancelled_at = p_now
    from public.tasks t
    where t.id = r.task_id and r.member_id = v_member and r.held and r.sent_at is null and r.cancelled_at is null
      and r.fire_at <= p_now
      and (t.state not in ('todo', 'in_progress', 'changes_requested') or t.due_at <> r.deadline or t.due_at <= p_now
           or not exists (select 1 from public.task_assignees a
                          where a.task_id = t.id and a.member_id = v_member and a.removed_at is null));
    select array_agg(r.id), count(distinct r.task_id)::integer,
      case when bool_or(r.last_before_due) then 'reminder_before_due_last'
           when bool_or(r.kind = 'due') then 'reminder_due_now' else 'reminder_before_due' end
      into v_ids, v_n, v_kind
    from public.task_reminders r
    where r.member_id = v_member and r.held and r.sent_at is null and r.cancelled_at is null and r.fire_at <= p_now;
    if coalesce(array_length(v_ids, 1), 0) = 0 then
      continue;
    end if;
    if v_n = 1 then
      select t.* into v_task from public.tasks t
      join public.task_reminders r on r.task_id = t.id where r.id = v_ids[1];
      perform app.notify(array[v_member], v_kind, 'While you were away: ' || v_task.title || ' is due soon',
        'Due ' || app.notify_when(v_task.due_at) || '.', '/tasks/' || v_task.id, 'tasks', v_task.id,
        jsonb_build_object('task_id', v_task.id), null);
    else
      select string_agg(t.title || ' (due ' || app.notify_when(t.due_at) || ')', E'\n' order by t.due_at)
        into v_body
      from public.tasks t where t.id in (select r.task_id from public.task_reminders r where r.id = any (v_ids));
      perform app.notify(array[v_member], v_kind, format('While you were away: %s tasks are due soon', v_n),
        v_body, '/tasks', null, null, jsonb_build_object('task_ids',
          (select jsonb_agg(distinct r.task_id) from public.task_reminders r where r.id = any (v_ids))), null);
    end if;
    update public.task_reminders set sent_at = p_now where id = any (v_ids);
  end loop;

  -- c. Acknowledgement repeats: every ack_repeat_hours after assignment, to whoever has not noted.
  for v_row in
    select a.task_id, a.member_id, a.assigned_at, t.org_id, t.title, s.ack_repeat_hours
    from public.task_assignees a
    join public.tasks t on t.id = a.task_id
    join public.task_reminder_arms arm on arm.task_id = t.id
    join public.org_settings s on s.org_id = t.org_id
    join public.members m on m.id = a.member_id and m.status = 'active'
    where a.removed_at is null and a.acknowledged_at is null
      and t.state not in ('completed', 'cancelled')
      and p_now >= a.assigned_at + make_interval(hours => s.ack_repeat_hours)
      and not exists (select 1 from public.task_reminders r
        where r.task_id = a.task_id and r.member_id = a.member_id and r.kind = 'ack'
          and r.created_at >= a.assigned_at and r.fire_at > p_now - make_interval(hours => s.ack_repeat_hours))
  loop
    -- Paused today, or the first morning after a pause before the quiet hours end: skipped.
    if app.reminder_paused(v_row.member_id, v_row.org_id, v_today)
       or (app.reminder_paused(v_row.member_id, v_row.org_id, v_today - 1)
           and p_now < app.reminder_resume_at(v_row.member_id, v_row.org_id, v_today - 1)) then
      continue;
    end if;
    perform app.notify(array[v_row.member_id], 'reminder_not_noted', 'Please note this task: ' || v_row.title,
      'Open it and tap Task Noted so everyone knows you have seen it.', '/tasks/' || v_row.task_id,
      'tasks', v_row.task_id, jsonb_build_object('task_id', v_row.task_id), null);
    insert into public.task_reminders (org_id, task_id, member_id, kind, fire_at, sent_at)
    values (v_row.org_id, v_row.task_id, v_row.member_id, 'ack', p_now, p_now);
  end loop;

  -- d. Not-noted escalations: one a task and level, naming everyone past the threshold. Never paused.
  for v_row in
    select t.id as task_id, t.org_id, t.title, lvl.level,
      case when lvl.level = 1 then coalesce(t.approving_admin_id, t.created_by) else app.org_owner_id(t.org_id) end as recipient,
      coalesce(t.approving_admin_id, t.created_by) as lead,
      array_agg(a.member_id order by a.assigned_at) as members,
      min(a.assigned_at) as since
    from public.task_assignees a
    join public.tasks t on t.id = a.task_id
    join public.task_reminder_arms arm on arm.task_id = t.id
    join public.org_settings s on s.org_id = t.org_id
    join public.members m on m.id = a.member_id and m.status = 'active'
    cross join (values (1), (2)) as lvl(level)
    where a.removed_at is null and a.acknowledged_at is null
      and t.state not in ('completed', 'cancelled')
      and p_now >= a.assigned_at + make_interval(hours =>
            case when lvl.level = 1 then s.ack_escalate_hours else s.ack_escalate_owner_hours end)
      and not exists (select 1 from public.task_reminders r
        where r.task_id = a.task_id and r.member_id = a.member_id and r.kind = 'ack_escalation'
          and r.escalation_level = lvl.level and r.created_at >= a.assigned_at)
    group by t.id, t.org_id, t.title, lvl.level, t.approving_admin_id, t.created_by
    order by lvl.level
  loop
    select string_agg(app.member_name(x), ', ') into v_names from unnest(v_row.members) x;
    -- Level 2 is skipped when level 1 already went to the Owner (the Owner is told once).
    if not (v_row.level = 2 and v_row.lead = v_row.recipient)
       and v_row.recipient is not null and not (v_row.recipient = any (v_row.members)) then
      perform app.notify(array[v_row.recipient], 'escalation_not_noted', 'Not noted yet: ' || v_row.title,
        v_names || case when cardinality(v_row.members) = 1 then ' has' else ' have' end
          || ' not tapped Task Noted since ' || app.notify_when(v_row.since) || '.',
        '/tasks/' || v_row.task_id, 'tasks', v_row.task_id, jsonb_build_object('task_id', v_row.task_id), null, v_row.level);
    end if;
    insert into public.task_reminders (org_id, task_id, member_id, kind, escalation_level, fire_at, sent_at)
    select v_row.org_id, v_row.task_id, x, 'ack_escalation', v_row.level, p_now, p_now from unnest(v_row.members) x;
  end loop;

  -- e. The end-day reminder (3b.1 / 5.1), folded in from its own cron job.
  perform app.end_day_reminder(p_now);
  return (select count(*)::integer from public.task_reminders r where r.sent_at = p_now);
end;
$$;
comment on function app.reminders_tick(timestamptz) is
  '5.3, service_role only, pg_cron every 5 minutes: sends the due deadline reminders of armed tasks '
  '(holding a paused person''s before-due / Due now to their next working day), brings held ones back '
  'as one message, the acknowledgement repeats and the not-noted escalations, then the end-day '
  'reminder. Records sent_at so nothing is sent twice. Returns the rows marked sent at p_now.';
revoke all on function app.reminders_tick(timestamptz) from public, authenticated;
grant execute on function app.reminders_tick(timestamptz) to service_role;

-- 7. The schedule: reminders_tick every 5 minutes takes over end_day_reminder's own job.
select cron.unschedule('end_day_reminder');
select cron.schedule('reminders_tick', '*/5 * * * *', $$select app.reminders_tick()$$);
