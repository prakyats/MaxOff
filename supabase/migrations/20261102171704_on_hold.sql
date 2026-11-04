-- v1.9 W7: On hold, the database (owner 2026-10-23, 29 Oct, 2 Nov; ROADMAP v1.9 W7; the approved sample
-- docs/design/v19-screens-sample.html §1-2; ADR-0016; WORKFLOWS §3.1a, §5.5, §8, §9; DATA-MODEL §5 and §6
-- "On hold"; PERMISSIONS "As built (v1.9 W7)").
--
-- A task or a project can be put On hold with a reason, and resumed. On hold is NOT a new enum value: it is
-- a pair of columns beside the state (held_at, held_by, hold_reason, plus resumed_at), so a held task keeps
-- the state it resumes to, every existing state check and transition stays as it is, and nothing that
-- switches on task_state / project_state changes meaning (ADR-0016). While held the clocks stop:
--   tasks:    no before-due, Due now, overdue or event reminders, no acknowledgement repeats, no not-noted
--             or overdue escalations, not overdue in any count (Today's risks, the end-of-day report, the
--             digest, the badge), no Start, Done or stage tick (INVALID_STATE), no Remind; acknowledging,
--             comments, edits, a new approver and Cancel stay (a cancel ends the hold);
--   projects: no new cycle (cycle_generate skips it; cycle_start_next and a carry's new cycle are refused),
--             no "cycle ready", E1-E3 or end-of-cycle prompt, no stage tick, Mark done, send-back or carry
--             decision (INVALID_STATE); edits, Close (item_cancel), Complete and Cancel stay.
-- Resume: a task whose deadline passed needs a new one; a project gives every deliverable whose planned date
-- passed a new date and every open deliverable of an ended month a carry forward / close / leave pending
-- choice, in one transaction (project_resume), which refuses a resume that leaves either out. The
-- acknowledgement clock and the cycle catch-up start again from the resume (resumed_at).
-- Every change is a transition function (ADR-0006) with its activity_log entry ('held' / 'resumed', the
-- reason and the old and new dates kept: invariant 9) and its notifications through app.notify(): four new
-- kinds, all in-app and push, never email.
-- No new table, so no new policy: the columns are read under the tables' existing RLS (a task's people see
-- its hold and reason; a project's, the Owner and the client's Admin). No money anywhere (invariant 2):
-- revenue is unchanged (invariant 3), and the reports' read is a count of deliverables.
-- Expand-only: nullable columns, checks every existing row meets, functions re-created with the same
-- signatures (bodies copied from their latest migration, the hold lines added) or added beside the old.
-- Append-only: never edit once applied.

-- 1. The columns ----------------------------------------------------------------------------------------------
alter table public.tasks
  add column held_at timestamptz null,
  add column held_by uuid null references public.members (id),
  add column hold_reason text null,
  add column resumed_at timestamptz null;
alter table public.tasks
  add constraint tasks_hold_pair check ((held_at is null) = (held_by is null) and (held_at is null) = (hold_reason is null)),
  add constraint tasks_hold_reason_length check (hold_reason is null or length(btrim(hold_reason)) between 1 and 1000),
  -- Only a task with its people is held (to do, in progress, changes requested): its state is the one it
  -- resumes to.
  add constraint tasks_hold_state check (held_at is null or state in ('todo', 'in_progress', 'changes_requested'));
comment on column public.tasks.held_at is
  'v1.9 W7: when the task was put On hold (null: not held). With held_by and hold_reason; the state stays the one it resumes to (ADR-0016).';
comment on column public.tasks.hold_reason is 'v1.9 W7: why it is On hold (required, ≤ 1000), shown on the task; history keeps it after the resume.';
comment on column public.tasks.resumed_at is
  'v1.9 W7: the last resume. The acknowledgement repeats and not-noted escalations count from it (the clock starts again).';
create index tasks_held_idx on public.tasks (org_id) where held_at is not null;
create index tasks_held_by_idx on public.tasks (held_by);

alter table public.projects
  add column held_at timestamptz null,
  add column held_by uuid null references public.members (id),
  add column hold_reason text null,
  add column resumed_at timestamptz null;
alter table public.projects
  add constraint projects_hold_pair check ((held_at is null) = (held_by is null) and (held_at is null) = (hold_reason is null)),
  add constraint projects_hold_reason_length check (hold_reason is null or length(btrim(hold_reason)) between 1 and 1000),
  add constraint projects_hold_state check (held_at is null or state in ('open', 'in_progress'));
comment on column public.projects.held_at is
  'v1.9 W7: when the project was put On hold (null: not held); its deliverables read as On hold. With held_by and hold_reason (ADR-0016).';
comment on column public.projects.hold_reason is 'v1.9 W7: why it is On hold (required, ≤ 1000); history keeps it after the resume.';
comment on column public.projects.resumed_at is
  'v1.9 W7: the last resume. cycle_generate makes no period that ended before it (as after a reopen).';
create index projects_held_idx on public.projects (org_id) where held_at is not null;
create index projects_held_by_idx on public.projects (held_by);

-- Neither table takes an API write; the hold columns are protected like the state all the same.
create trigger protect_hold_columns before update on public.tasks
  for each row execute function app.protect_columns('held_at', 'held_by', 'hold_reason', 'resumed_at');
create trigger protect_hold_columns before update on public.projects
  for each row execute function app.protect_columns('held_at', 'held_by', 'hold_reason', 'resumed_at');

-- 2. The guard: what a hold freezes, for every caller (functions included) -------------------------------------
create function app.on_hold_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_table_name = 'tasks' then
    -- A held task keeps its state; Cancel ends the hold (the cancel's history shows it cleared).
    if old.held_at is not null and new.held_at is not null and new.state is distinct from old.state then
      if new.state = 'cancelled' then
        new.held_at := null;
        new.held_by := null;
        new.hold_reason := null;
      else
        perform app.fail('INVALID_STATE', 'This task is on hold, so it can''t move on until it is resumed.');
      end if;
    end if;
    return new;
  elsif tg_table_name = 'task_stages' then
    if new.done_at is distinct from old.done_at
       and exists (select 1 from public.tasks t where t.id = new.task_id and t.held_at is not null) then
      perform app.fail('INVALID_STATE', 'This task is on hold, so its stages can''t be ticked until it is resumed.');
    end if;
    return new;
  elsif tg_table_name = 'projects' then
    -- Complete and Cancel end the hold; nothing else moves a held project's state.
    if old.held_at is not null and new.held_at is not null and new.state is distinct from old.state then
      if new.state in ('completed', 'cancelled') then
        new.held_at := null;
        new.held_by := null;
        new.hold_reason := null;
      else
        perform app.fail('INVALID_STATE', 'This project is on hold, so it can''t move on until it is resumed.');
      end if;
    end if;
    return new;
  elsif tg_table_name = 'project_items' then
    -- Mark done, send back, reopen and every carry decision wait for the resume; a close (cancelled) stays.
    if ((new.state is distinct from old.state and new.state <> 'cancelled')
        or new.carry_decision is distinct from old.carry_decision)
       and exists (select 1 from public.projects p where p.id = new.project_id and p.held_at is not null) then
      perform app.fail('INVALID_STATE',
        'This project is on hold, so its deliverables can''t be marked done or decided until it is resumed.');
    end if;
    return new;
  elsif tg_table_name = 'project_item_stage_list' then
    if new.done_at is distinct from old.done_at
       and exists (select 1 from public.projects p where p.id = new.project_id and p.held_at is not null) then
      perform app.fail('INVALID_STATE', 'This project is on hold, so its stages can''t be ticked until it is resumed.');
    end if;
    return new;
  elsif tg_table_name = 'project_cycles' then
    if exists (select 1 from public.projects p where p.id = new.project_id and p.held_at is not null) then
      perform app.fail('INVALID_STATE', 'This project is on hold, so no new cycle starts until it is resumed.');
    end if;
    return new;
  end if;
  return new;
end;
$$;
comment on function app.on_hold_guard() is
  'Internal (v1.9 W7, ADR-0016): BEFORE trigger on tasks, task_stages, projects, project_items, '
  'project_item_stage_list (UPDATE) and project_cycles (INSERT). While a task is held its state does not '
  'move (INVALID_STATE) except to cancelled, which clears the hold, and its stages are not ticked; while a '
  'project is held its state moves only to completed or cancelled (clearing the hold), its deliverables are '
  'not marked done, sent back, reopened or carry-decided (a close stays), their stages are not ticked and '
  'no cycle is made. For every caller, transition functions included, so no path is missed.';
revoke all on function app.on_hold_guard() from public, authenticated;
grant execute on function app.on_hold_guard() to service_role;

create trigger on_hold_guard before update on public.tasks
  for each row execute function app.on_hold_guard();
create trigger on_hold_guard before update of done_at on public.task_stages
  for each row execute function app.on_hold_guard();
create trigger on_hold_guard before update on public.projects
  for each row execute function app.on_hold_guard();
create trigger on_hold_guard before update on public.project_items
  for each row execute function app.on_hold_guard();
create trigger on_hold_guard before update of done_at on public.project_item_stage_list
  for each row execute function app.on_hold_guard();
create trigger on_hold_guard before insert on public.project_cycles
  for each row execute function app.on_hold_guard();

-- 3. The kinds (WORKFLOWS §9): quiet, in-app and push, never email ---------------------------------------------
insert into public.notification_kinds (kind, actionable, always_email, description) values
  ('task_held',       false, false, 'A task you are on was put On hold, with the reason (v1.9 W7)'),
  ('task_resumed',    false, false, 'A task you are on was resumed, with its deadline (v1.9 W7)'),
  ('project_held',    false, false, 'The Owner put a project of your client On hold, with the reason (v1.9 W7)'),
  ('project_resumed', false, false, 'The Owner resumed a project of your client (v1.9 W7)');

-- 4. Reminders: re-armed by the hold and the resume; nothing while held ---------------------------------------
-- The reminders trigger also fires when the hold starts or ends (held_at), so the hold cancels every
-- unsent deadline reminder and the resume arms them again from the deadline then in force.
create trigger tasks_reminders_hold after update of held_at on public.tasks
  for each row when (old.held_at is distinct from new.held_at)
  execute function app.tasks_reminders_trigger();

-- 5. Re-created with the hold lines (bodies copied from their latest migration) ---------------------------------

-- app.task_arm_reminders: A held task keeps no deadline reminder (the hold cancels them; the resume arms them again).
-- (from 20261015045552_tasks_for_owner.sql)
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
  -- v1.9 W7: a held task keeps none either (the resume arms them again).
  if v_task.state in ('completed', 'cancelled') or v_task.held_at is not null then
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

  -- 6b.2: no escalation about the Owner: a task whose primary owner is the Owner arms no overdue
  -- escalation (nobody is above the Owner).
  insert into public.task_reminders (org_id, task_id, kind, deadline, fire_at, escalation_level)
  select v_task.org_id, p_task_id, x.kind, v_task.due_at, x.fire_at, x.level
  from (values
    ('overdue', v_task.due_at + interval '1 hour', null::integer),
    ('overdue_escalation', v_task.due_at + make_interval(hours => coalesce(v_hours, 24)), null::integer)) as x(kind, fire_at, level)
  where x.fire_at > p_now
    and not (x.kind = 'overdue_escalation' and v_task.primary_owner_id = app.org_owner_id(v_task.org_id))
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

-- app.tasks_reminders_trigger: The hold and the resume re-arm too (with the tasks_reminders_hold trigger above).
-- (from 20261015045552_tasks_for_owner.sql)
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
     or new.primary_owner_id is distinct from old.primary_owner_id
     or new.held_at is distinct from old.held_at
     or (new.state in ('completed', 'cancelled')) <> (old.state in ('completed', 'cancelled')) then
    -- Only an armed task (one created after migration task_reminders) is (re)armed.
    perform app.task_arm_reminders(new.id);
  end if;
  return null;
end;
$$;

-- app.reminders_tick: Nothing about a held task; the acknowledgement clock counts from the last resume.
-- (from 20261015045552_tasks_for_owner.sql)
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
  -- One run at a time (two would send twice).
  perform pg_advisory_xact_lock(hashtext('app.reminders_tick'));

  -- 0. The end-day reminder first, in its own savepoint: it was a job of its own until 5.3. Every
  --    row below runs in a savepoint of its own too (phase 5 review), so one task that fails is
  --    logged and skipped, never costing the end-day reminder or anyone else's reminders.
  begin
    perform app.end_day_reminder(p_now);
  exception when others then
    raise warning 'reminders_tick: the end-day reminder failed: %', sqlerrm;
  end;

  -- a. Deadline rows that are due.
  for v_row in
    select r.* from public.task_reminders r
    where r.member_id is null and r.sent_at is null and r.cancelled_at is null and r.fire_at <= p_now
    order by r.fire_at, r.id
    for update skip locked
  loop
    begin
      select * into v_task from public.tasks t where t.id = v_row.task_id;
      -- A reminder whose moment passed over an hour ago (the job was down) is skipped, never sent
      -- late; an escalation is sent late while its condition still holds (owner 2026-10-06): the
      -- task still with its people and still overdue on the same deadline. A task no longer with
      -- its people, or a moved deadline: skipped, both.
      -- 6b.2: never an escalation about the Owner (the Owner became the primary owner after it was
      -- armed): dropped.
      if (v_row.fire_at < p_now - interval '1 hour' and v_row.kind <> 'overdue_escalation')
         or v_task.state not in ('todo', 'in_progress', 'changes_requested')
         -- v1.9 W7: nothing about a held task (its rows were cancelled by the hold).
         or v_task.held_at is not null
         or v_task.due_at is distinct from v_row.deadline
         or (v_row.kind = 'overdue_escalation' and v_task.primary_owner_id = app.org_owner_id(v_task.org_id)) then
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
    exception when others then
      raise warning 'reminders_tick: section a (a deadline row) skipped: %', sqlerrm;
    end;
  end loop;

  -- b. Held rows coming back: one message a person, when their deadlines are still ahead.
  for v_member in
    select distinct r.member_id from public.task_reminders r
    where r.held and r.sent_at is null and r.cancelled_at is null and r.fire_at <= p_now
  loop
    begin
      update public.task_reminders r set cancelled_at = p_now
      from public.tasks t
      where t.id = r.task_id and r.member_id = v_member and r.held and r.sent_at is null and r.cancelled_at is null
        and r.fire_at <= p_now
        and (t.state not in ('todo', 'in_progress', 'changes_requested') or t.held_at is not null
             or t.due_at <> r.deadline or t.due_at <= p_now
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
    exception when others then
      raise warning 'reminders_tick: section b (a held person) skipped: %', sqlerrm;
    end;
  end loop;

  -- c. Acknowledgement repeats: every ack_repeat_hours after assignment, to whoever has not noted.
  for v_row in
    select a.task_id, a.member_id, greatest(a.assigned_at, arm.armed_at, t.resumed_at) as since, t.org_id, t.title, s.ack_repeat_hours
    from public.task_assignees a
    join public.tasks t on t.id = a.task_id
    join public.task_reminder_arms arm on arm.task_id = t.id
    join public.org_settings s on s.org_id = t.org_id
    join public.members m on m.id = a.member_id and m.status = 'active'
    where a.removed_at is null and a.acknowledged_at is null
      and t.state not in ('completed', 'cancelled') and t.held_at is null
      and p_now >= greatest(a.assigned_at, arm.armed_at, t.resumed_at) + make_interval(hours => s.ack_repeat_hours)
      and not exists (select 1 from public.task_reminders r
        where r.task_id = a.task_id and r.member_id = a.member_id and r.kind = 'ack'
          and r.created_at >= a.assigned_at and r.fire_at > p_now - make_interval(hours => s.ack_repeat_hours))
  loop
    begin
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
    exception when others then
      raise warning 'reminders_tick: section c (an acknowledgement repeat) skipped: %', sqlerrm;
    end;
  end loop;

  -- d. Not-noted escalations: one a task and level, naming everyone past the threshold. Never paused.
  for v_row in
    select t.id as task_id, t.org_id, t.title, lvl.level,
      case when lvl.level = 1 then coalesce(t.approving_admin_id, t.created_by) else app.org_owner_id(t.org_id) end as recipient,
      coalesce(t.approving_admin_id, t.created_by) as lead,
      array_agg(a.member_id order by m.full_name, a.member_id) as members,
      min(greatest(a.assigned_at, arm.armed_at, t.resumed_at)) as since
    from public.task_assignees a
    join public.tasks t on t.id = a.task_id
    join public.task_reminder_arms arm on arm.task_id = t.id
    join public.org_settings s on s.org_id = t.org_id
    -- 6b.2: never about the Owner (nobody is above the Owner); the Owner's repeats (c) stay.
    join public.members m on m.id = a.member_id and m.status = 'active' and m.role <> 'owner'
    cross join (values (1), (2)) as lvl(level)
    where a.removed_at is null and a.acknowledged_at is null
      and t.state not in ('completed', 'cancelled') and t.held_at is null
      and p_now >= greatest(a.assigned_at, arm.armed_at, t.resumed_at) + make_interval(hours =>
            case when lvl.level = 1 then s.ack_escalate_hours else s.ack_escalate_owner_hours end)
      and not exists (select 1 from public.task_reminders r
        where r.task_id = a.task_id and r.member_id = a.member_id and r.kind = 'ack_escalation'
          and r.escalation_level = lvl.level and r.created_at >= a.assigned_at)
    group by t.id, t.org_id, t.title, lvl.level, t.approving_admin_id, t.created_by
    order by lvl.level
  loop
    begin
      -- In a fixed order (owner, 2026-10-02: wording never changes between runs): by name, then id.
      select string_agg(app.member_name(x.id), ', ' order by x.ord) into v_names
      from unnest(v_row.members) with ordinality as x(id, ord);
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
    exception when others then
      raise warning 'reminders_tick: section d (a not-noted escalation) skipped: %', sqlerrm;
    end;
  end loop;

  return (select count(*)::integer from public.task_reminders r where r.sent_at = p_now);
end;
$$;

-- public.dashboard_not_noted: The Owner's not-noted risks agree with the job: never a held task, the clock from the last resume.
-- (from 20261015045552_tasks_for_owner.sql)
create or replace function public.dashboard_not_noted()
returns table (task_id uuid, member_id uuid, waiting_since timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_me public.members;
begin
  select m.* into v_me from app.current_member() m;
  if v_me.id is null then
    perform app.fail('UNAUTHENTICATED', 'Sign in again.');
  end if;
  if not app.has_permission('attendance.view_all') then
    perform app.fail('FORBIDDEN', 'Only the Owner sees the team''s risks.');
  end if;

  return query
    select a.task_id, a.member_id, greatest(a.assigned_at, arm.armed_at, t.resumed_at)
    from public.task_assignees a
    join public.tasks t on t.id = a.task_id
    join public.task_reminder_arms arm on arm.task_id = t.id
    join public.org_settings s on s.org_id = t.org_id
    join public.members m on m.id = a.member_id and m.status = 'active' and m.role <> 'owner'
    where t.org_id = v_me.org_id and t.archived_at is null
      and a.removed_at is null and a.acknowledged_at is null
      and t.state not in ('completed', 'cancelled') and t.held_at is null
      and now() >= greatest(a.assigned_at, arm.armed_at, t.resumed_at) + make_interval(hours => s.ack_escalate_owner_hours)
    order by greatest(a.assigned_at, arm.armed_at, t.resumed_at), a.task_id, a.member_id;
end;
$$;

-- public.task_counts: A held task leaves the to-do counts and the Tasks badge.
-- (from 20260930070616_phase4_review_fixes.sql)
create or replace function public.task_counts()
returns table (not_noted integer, changes_requested integer, badge integer, to_decide integer)
language sql
stable
security definer
set search_path = ''
as $$
  with me as (
    select m.id, m.org_id from app.current_member() m
  ),
  -- The caller and the active freelancers they coordinate now (ADR-0013: a freelancer's work is theirs).
  mine as (
    select me.id as member_id from me
    union all
    select mc.member_id from public.member_coordinators mc
    join me on mc.coordinator_id = me.id
    join public.members f on f.id = mc.member_id
    where mc.to_at is null and f.engagement = 'freelance' and f.status = 'active'
  ),
  work as (
    select t.id, t.state, bool_or(a.acknowledged_at is null) as unnoted
    from public.tasks t
    join me on t.org_id = me.org_id
    join public.task_assignees a on a.task_id = t.id and a.removed_at is null
    where a.member_id in (select mine.member_id from mine)
      and t.state not in ('completed', 'cancelled') and t.held_at is null
    group by t.id, t.state
  ),
  deciding as (
    select t.id
    from public.tasks t
    join me on t.org_id = me.org_id
    where ((select app.has_permission('tasks.approve_final')) and t.state = 'admin_approved')
       or ((select app.has_permission('tasks.approve_admin'))
           and t.state = 'submitted' and t.approving_admin_id = me.id
           and not exists (select 1 from public.task_assignees a
                           where a.task_id = t.id and a.member_id = me.id and a.removed_at is null))
  )
  select (select count(*) from work where work.unnoted)::integer,
         (select count(*) from work where work.state = 'changes_requested')::integer,
         (select count(*) from work where work.unnoted or work.state = 'changes_requested')::integer,
         (select count(*) from deciding)::integer
  from me;
$$;

-- public.task_remind: No reminder about a held task.
-- (from 20261020223504_b1_one_time_format.sql)
create or replace function public.task_remind(task_id uuid)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid;
  v_org uuid;
  v_task public.tasks;
  v_last timestamptz;
  v_recipients uuid[];
begin
  select m.id, m.org_id into v_caller, v_org from app.current_member() m;
  if v_caller is null then
    perform app.fail('UNAUTHENTICATED', 'Your account is not active.');
  end if;
  v_task := app.task_lock(task_remind.task_id, v_org);
  -- Scope, then permission: a task the caller cannot see does not exist for them.
  if not app.task_visible(v_task.id) then
    perform app.fail('NOT_FOUND', 'This task does not exist.');
  end if;
  -- Those who manage the task, holding tasks.create (the Owner, the creator, the approving Admin).
  if not (app.task_manager(v_task.id) and app.has_permission('tasks.create')) then
    perform app.fail('FORBIDDEN', 'Only the task''s creator, its approving Admin or the Owner can send a reminder.');
  end if;
  if v_task.state not in ('todo', 'in_progress', 'changes_requested') then
    perform app.fail('INVALID_STATE', 'A reminder is for a task still with its people.');
  end if;
  -- v1.9 W7: a held task waits; nobody is asked about it until it is resumed.
  if v_task.held_at is not null then
    perform app.fail('INVALID_STATE', 'This task is on hold, so there is nothing to ask until it is resumed.');
  end if;
  -- At most once an hour per task, whoever sent the last one (the task row is locked above, so two
  -- taps never both pass).
  select max(l.at) into v_last from public.activity_log l
  where l.entity = 'tasks' and l.entity_id = v_task.id and l.action = 'reminder_sent';
  if v_last is not null and v_last > now() - interval '1 hour' then
    perform app.fail('RATE_LIMITED', format('A reminder went at %s. You can send another at %s.',
      app.ist_time(v_last),
      app.ist_time(v_last + interval '1 hour')));
  end if;
  v_recipients := array(
    select a.member_id from public.task_assignees a
    join public.members m on m.id = a.member_id and m.status = 'active'
    where a.task_id = v_task.id and a.removed_at is null and a.member_id <> v_caller
    order by a.is_primary desc, m.full_name, a.member_id);
  if cardinality(v_recipients) = 0 then
    perform app.fail('VALIDATION', 'Nobody else is on this task to remind.');
  end if;

  insert into public.activity_log (org_id, actor_id, entity, entity_id, action, meta)
  values (v_org, v_caller, 'tasks', v_task.id, 'reminder_sent',
          jsonb_build_object('recipients', to_jsonb(v_recipients)));
  -- WORKFLOWS §9 "Task asked about": every active assignee but the sender (a freelancer's row goes
  -- to their coordinator; app.notify never tells the actor).
  perform app.notify(v_recipients, 'task_asked_about',
    format('%s is asking about %s', app.member_name(v_caller), v_task.title),
    'Due ' || app.notify_when(v_task.due_at) || '.',
    '/tasks/' || v_task.id, 'tasks', v_task.id, jsonb_build_object('task_id', v_task.id), v_caller);
  return now() + interval '1 hour';
end;
$$;

-- app.eod_report_payload: The end-of-day report's "overdue now" leaves out a held task.
-- (from 20261022090443_working_hours.sql)
create or replace function app.eod_report_payload(p_org uuid, p_date date, p_now timestamptz)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_from timestamptz := app.ist_day_start(p_date);
  v_to timestamptz := app.ist_day_start(p_date + 1);
  v_holiday text;
  v_weekly_off boolean;
  v_attendance jsonb;
  v_decisions jsonb;
  v_tasks jsonb;
  v_approvals jsonb;
  v_tomorrow jsonb;
  v_client_work jsonb;
  v_empty constant jsonb := '{"count": 0, "more": 0, "items": []}'::jsonb;
  v_owner uuid := app.org_owner_id(p_org);
begin
  select h.name into v_holiday from public.holidays h where h.org_id = p_org and h.date = p_date;
  select extract(dow from p_date)::int = any (s.weekly_off_days) into v_weekly_off
  from public.org_settings s where s.org_id = p_org;

  -- Attendance: every active employee (never the Owner, never a freelancer: they have no day) with
  -- a day on the date: their times, what the day stands at, and the flags. A day still waiting for
  -- the Owner counts by its choice or the system's proposal, as the digest and Start day read it.
  with days as (
    select m.id, m.full_name,
           case when d.state = 'pending_review'
                then coalesce(d.submitted_choice::text::public.day_status, d.final_status)
                else d.final_status end as status,
           d.state = 'pending_review' as waiting,
           d.proposed_by_system and d.state = 'pending_review' as proposed,
           d.started_at, d.ended_at, d.end_not_recorded, d.overtime_flag, d.overtime_reason,
           -- v1.9 W0 (6b.1): Late with its reason, and how the day ended early (if it did).
           d.late_minutes, d.late_reason,
           (select e.state from public.early_leave_requests e
            where e.day_id = d.id and e.state in ('approved', 'left_unanswered', 'corrected')
            order by e.requested_at desc limit 1) as left_early
    from public.members m
    join public.attendance_days d on d.member_id = m.id and d.work_date = p_date
    where m.org_id = p_org and m.status = 'active' and m.role <> 'owner' and m.engagement = 'permanent'
  )
  select jsonb_build_object(
    'counts', jsonb_build_object(
      'present', count(*) filter (where status = 'present'),
      'on_leave', count(*) filter (where status in ('leave', 'half_day', 'comp_leave')),
      'absent', count(*) filter (where status = 'absent'),
      'proposed_absent', count(*) filter (where status = 'absent' and proposed),
      'waiting', count(*) filter (where waiting),
      'end_not_recorded', count(*) filter (where end_not_recorded),
      'overtime', count(*) filter (where overtime_flag),
      'late', count(*) filter (where late_minutes is not null),
      'left_early', count(*) filter (where left_early is not null)),
    'people', coalesce(jsonb_agg(jsonb_build_object(
      'member_id', id, 'name', full_name, 'status', status, 'waiting', waiting, 'proposed', proposed,
      'started_at', started_at, 'ended_at', ended_at, 'end_not_recorded', end_not_recorded,
      'overtime', overtime_flag, 'overtime_reason', overtime_reason,
      'late_minutes', late_minutes, 'late_reason', late_reason, 'left_early', left_early)
      order by full_name, id), '[]'::jsonb))
  into v_attendance
  from days;

  -- The decisions made that day: the Owner's attendance decisions (events with an actor: the
  -- automatic ones have none), leave decided, comp leave granted, revoked or reviewed, and expense
  -- claims decided or paid as a count (never an amount).
  select jsonb_build_object(
    'attendance', (
      select count(*) from public.attendance_events e
      join public.attendance_days d on d.id = e.attendance_day_id
      join public.members m on m.id = d.member_id
      where m.org_id = p_org and e.action in ('approved', 'corrected') and e.actor_id is not null
        and e.at >= v_from and e.at < v_to),
    'leave', jsonb_build_object(
      'approved', (
        select count(*) from public.leave_requests r join public.members m on m.id = r.member_id
        where m.org_id = p_org and r.state = 'approved' and r.decided_at >= v_from and r.decided_at < v_to),
      'rejected', (
        select count(*) from public.leave_requests r join public.members m on m.id = r.member_id
        where m.org_id = p_org and r.state = 'rejected' and r.decided_at >= v_from and r.decided_at < v_to)),
    'comp_leave', jsonb_build_object(
      'granted', (
        select count(*) from public.comp_leave_credits c join public.members m on m.id = c.member_id
        where m.org_id = p_org and c.granted_at >= v_from and c.granted_at < v_to),
      'revoked', (
        select count(*) from public.comp_leave_credits c join public.members m on m.id = c.member_id
        where m.org_id = p_org and c.revoked_at >= v_from and c.revoked_at < v_to),
      'reviewed', (
        select count(*) from public.extra_work_notes n join public.members m on m.id = n.member_id
        where m.org_id = p_org and n.decided_at >= v_from and n.decided_at < v_to)),
    'expense_claims', (
      select count(*) from public.expense_claims c join public.members m on m.id = c.member_id
      where m.org_id = p_org
        and ((c.decided_at >= v_from and c.decided_at < v_to) or (c.paid_at >= v_from and c.paid_at < v_to))))
  into v_decisions;

  -- Tasks: completed (Owner-approved) that day; handed in and waiting now; overdue now with the
  -- primary owner's late reason; cancelled that day with the reason; created that day. Freelancers
  -- are counted separately (the primary owner's engagement). Lists of up to 50, then a count.
  with t as (
    select t.id, t.title, t.state, t.due_at, t.late_reason, t.cancelled_reason, t.completed_at,
           t.cancelled_at, t.created_at, t.submitted_at, t.held_at,
           m.full_name as owner_name, m.engagement = 'freelance' as freelance
    from public.tasks t
    join public.members m on m.id = t.primary_owner_id
    where t.org_id = p_org and t.archived_at is null
  ),
  groups as (
    select 'completed' as grp, t.* from t where t.completed_at >= v_from and t.completed_at < v_to
    union all
    select 'handed_in', t.* from t where t.state in ('submitted', 'admin_approved')
    union all
    select 'overdue', t.* from t where t.state not in ('completed', 'cancelled') and t.due_at < p_now
                                      and t.held_at is null
    union all
    select 'cancelled', t.* from t where t.cancelled_at >= v_from and t.cancelled_at < v_to
    union all
    select 'created', t.* from t where t.created_at >= v_from and t.created_at < v_to
  ),
  numbered as (
    select g.*, row_number() over (partition by g.grp order by g.due_at, g.title, g.id) as n from groups g
  ),
  per_group as (
    select grp,
           count(*) as total,
           count(*) filter (where freelance) as freelance_total,
           coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
             'id', id, 'title', title, 'owner', owner_name, 'freelance', freelance,
             'due_at', case when grp = 'overdue' then due_at end,
             'late_reason', case when grp = 'overdue' then late_reason end,
             'since', case when grp = 'handed_in' then submitted_at end,
             'reason', case when grp = 'cancelled' then cancelled_reason end))
             order by n) filter (where n <= 50), '[]'::jsonb) as items
    from numbered
    group by grp
  ),
  shaped as (
    select grp, jsonb_build_object(
      'count', total, 'freelance', freelance_total, 'more', greatest(total - 50, 0), 'items', items) as value
    from per_group
  )
  select jsonb_build_object(
    'completed', coalesce((select value from shaped where grp = 'completed'), '{"count": 0, "freelance": 0, "more": 0, "items": []}'::jsonb),
    'handed_in', coalesce((select value from shaped where grp = 'handed_in'), '{"count": 0, "freelance": 0, "more": 0, "items": []}'::jsonb),
    'overdue', coalesce((select value from shaped where grp = 'overdue'), '{"count": 0, "freelance": 0, "more": 0, "items": []}'::jsonb),
    'cancelled', coalesce((select value from shaped where grp = 'cancelled'), '{"count": 0, "freelance": 0, "more": 0, "items": []}'::jsonb),
    'created', coalesce((select value from shaped where grp = 'created'), '{"count": 0, "freelance": 0, "more": 0, "items": []}'::jsonb))
  into v_tasks;

  -- Approvals: a count per approver at each step that day (an approval, or changes requested).
  select coalesce(jsonb_agg(jsonb_build_object(
    'reviewer_id', a.reviewer_id, 'name', a.name, 'step', a.step,
    'approved', a.approved, 'changes_requested', a.changes_requested)
    order by a.step desc, a.name, a.reviewer_id), '[]'::jsonb)
  into v_approvals
  from (
    select r.reviewer_id, coalesce(m.full_name, 'Someone') as name, r.step,
           count(*) filter (where r.decision = 'approved') as approved,
           count(*) filter (where r.decision = 'rejected') as changes_requested
    from public.task_reviews r
    join public.tasks t on t.id = r.task_id
    left join public.members m on m.id = r.reviewer_id
    where t.org_id = p_org and r.at >= v_from and r.at < v_to
    group by r.reviewer_id, m.full_name, r.step
  ) a;

  -- Tomorrow's events: the event tasks on the next IST date, with their people.
  select jsonb_build_object(
    'date', p_date + 1,
    'events', coalesce(jsonb_agg(jsonb_build_object(
      'id', e.id, 'title', e.title, 'start_at', e.event_start_at, 'end_at', e.event_end_at,
      'location', e.location, 'people', e.people)
      order by e.event_start_at nulls first, e.title, e.id), '[]'::jsonb))
  into v_tomorrow
  from (
    select t.id, t.title, t.event_start_at, t.event_end_at, t.location,
           coalesce((select jsonb_agg(m.full_name order by m.full_name)
                     from public.task_assignees a join public.members m on m.id = a.member_id
                     where a.task_id = t.id and a.removed_at is null), '[]'::jsonb) as people
    from public.tasks t
    where t.org_id = p_org and t.archived_at is null and t.state <> 'cancelled' and t.event_date = p_date + 1
  ) e;


  -- Client work (7.4, kickoff 7 decision 25): what happened to client items that IST day, per client
  -- Admin (the one who ran the client at that moment; null: a client with no Admin, the Owner's own).
  -- Done = the history's `done` entries ("Not done" and a rejection clear done_at); approved = the
  -- reviews' approvals (before amendment D3); sent back = the Owner's rejections, reopened = an Admin's
  -- (D3: the client's Admin reopening a done item); closed = cancelled that day (a cancel, a carry "close", a project cancel);
  -- carried = carried forward that day; projects completed = the history's `completed` entries. An
  -- item counts once per group however often it moved. Lists of up to 50, then a count. No amount.
  with ev as (
    select distinct on (e.grp, e.id) e.*
    from (
      select 'done'::text as grp, i.id, i.title, p.name as project, c.name as client, p.client_id,
             a.at, null::text as reason
      from public.activity_log a
      join public.project_items i on i.id = a.entity_id
      join public.projects p on p.id = i.project_id
      join public.clients c on c.id = p.client_id
      where a.org_id = p_org and a.entity = 'project_items' and a.action = 'done'
        and a.at >= v_from and a.at < v_to
      union all
      -- Review fix (amendment D3): a rejection is the Owner's send-back or an Admin's own reopen.
      select case when r.decision = 'approved' then 'approved'
                  when r.reviewer_id = v_owner then 'sent_back'
                  else 'reopened' end, i.id, i.title,
             p.name, c.name, p.client_id, r.at, case when r.decision = 'rejected' then r.reason end
      from public.item_reviews r
      join public.project_items i on i.id = r.item_id
      join public.projects p on p.id = i.project_id
      join public.clients c on c.id = p.client_id
      where r.org_id = p_org and r.at >= v_from and r.at < v_to
      union all
      select 'closed', i.id, i.title, p.name, c.name, p.client_id, i.cancelled_at, i.cancelled_reason
      from public.project_items i
      join public.projects p on p.id = i.project_id
      join public.clients c on c.id = p.client_id
      where i.org_id = p_org and i.cancelled_at >= v_from and i.cancelled_at < v_to
      union all
      select 'carried', i.id, i.title, p.name, c.name, p.client_id, i.carry_decided_at, null
      from public.project_items i
      join public.projects p on p.id = i.project_id
      join public.clients c on c.id = p.client_id
      where i.org_id = p_org and i.carry_decision = 'carry_forward'
        and i.carry_decided_at >= v_from and i.carry_decided_at < v_to
      union all
      select 'projects_completed', p.id, p.name, p.name, c.name, p.client_id, a.at, null
      from public.activity_log a
      join public.projects p on p.id = a.entity_id
      join public.clients c on c.id = p.client_id
      where a.org_id = p_org and a.entity = 'projects' and a.action = 'completed'
        and a.at >= v_from and a.at < v_to
    ) e
    order by e.grp, e.id, e.at desc
  ),
  attributed as (
    select ev.*, (
      select s.admin_id from public.client_admin_assignments s
      where s.client_id = ev.client_id and s.from_at <= ev.at and (s.to_at is null or s.to_at > ev.at)
      order by s.from_at desc limit 1) as admin_id
    from ev
  ),
  numbered as (
    select x.*, row_number() over (partition by x.admin_id, x.grp order by x.at, x.title, x.id) as n
    from attributed x
  ),
  per_group as (
    select admin_id, grp, jsonb_build_object(
      'count', count(*), 'more', greatest(count(*) - 50, 0),
      'items', coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
        'id', id, 'title', title, 'project', case when grp <> 'projects_completed' then project end,
        'client', client, 'reason', reason)) order by n) filter (where n <= 50), '[]'::jsonb)) as value
    from numbered
    group by admin_id, grp
  ),
  per_admin as (
    select g.admin_id, m.full_name as name, jsonb_object_agg(g.grp, g.value) as groups
    from per_group g
    left join public.members m on m.id = g.admin_id
    group by g.admin_id, m.full_name
  )
  select jsonb_build_object(
    'admins', coalesce((
      select jsonb_agg(jsonb_build_object(
        'admin_id', a.admin_id, 'name', a.name,
        'done', coalesce(a.groups -> 'done', v_empty),
        'approved', coalesce(a.groups -> 'approved', v_empty),
        'sent_back', coalesce(a.groups -> 'sent_back', v_empty),
        'reopened', coalesce(a.groups -> 'reopened', v_empty),
        'closed', coalesce(a.groups -> 'closed', v_empty),
        'carried', coalesce(a.groups -> 'carried', v_empty),
        'projects_completed', coalesce(a.groups -> 'projects_completed', v_empty))
        order by a.name nulls last, a.admin_id)
      from per_admin a), '[]'::jsonb),
    'counts', (
      select jsonb_build_object(
        'done', count(*) filter (where grp = 'done'),
        'approved', count(*) filter (where grp = 'approved'),
        'sent_back', count(*) filter (where grp = 'sent_back'),
        'reopened', count(*) filter (where grp = 'reopened'),
        'closed', count(*) filter (where grp = 'closed'),
        'carried', count(*) filter (where grp = 'carried'),
        'projects_completed', count(*) filter (where grp = 'projects_completed'))
      from attributed))
  into v_client_work;

  return jsonb_build_object(
    'date', p_date,
    'day_off', jsonb_build_object('holiday', v_holiday, 'weekly_off', coalesce(v_weekly_off, false)),
    'attendance', v_attendance,
    'decisions', v_decisions,
    'tasks', v_tasks,
    'approvals', v_approvals,
    'tomorrow', v_tomorrow,
    'client_work', v_client_work);
end;
$$;

-- app.owner_digest_payload: The digest's "overdue now" (the weekly digest reads it) leaves out a held task.
-- (from 20261003094742_reachability_clock_from_release.sql)
create or replace function app.owner_digest_payload(p_org uuid, p_now timestamptz)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_today date := app.to_ist_date(p_now);
  v_yesterday date := app.to_ist_date(p_now) - 1;
  v_from timestamptz := app.ist_day_start(app.to_ist_date(p_now) - 1);
  v_to timestamptz := app.ist_day_start(app.to_ist_date(p_now));
  v_owner uuid := app.org_owner_id(p_org);
  v_attendance jsonb;
  v_tasks jsonb;
  v_requests jsonb;
  v_held jsonb;
  v_unreachable jsonb;
begin
  -- Attendance yesterday: the days of the organisation's active members. A day still waiting for
  -- the Owner counts by what it stands at (the choice made, else the system's proposal: the
  -- `coalesce(submitted_choice, final_status)` that attendance_decide approves and Start day reads).
  with days as (
    select m.id, m.full_name, d.end_not_recorded,
           case when d.state = 'pending_review'
                then coalesce(d.submitted_choice::text::public.day_status, d.final_status)
                else d.final_status end as status
    from public.attendance_days d
    join public.members m on m.id = d.member_id
    where m.org_id = p_org and m.status = 'active' and d.work_date = v_yesterday
  ),
  absent as (
    select d.full_name, row_number() over (order by d.full_name, d.id) as n
    from days d where d.status = 'absent'
  ),
  not_ended as (
    select d.full_name, row_number() over (order by d.full_name, d.id) as n
    from days d where d.end_not_recorded
  )
  select jsonb_build_object(
    'present', (select count(*) from days where status = 'present'),
    'on_leave', (select count(*) from days where status in ('leave', 'half_day', 'comp_leave')),
    'absent', (select count(*) from absent),
    'absent_names', coalesce((select jsonb_agg(a.full_name order by a.n) from absent a where a.n <= 5), '[]'::jsonb),
    'absent_more', greatest((select count(*) from absent) - 5, 0),
    'day_not_ended', (select count(*) from not_ended),
    'day_not_ended_names', coalesce((select jsonb_agg(e.full_name order by e.n) from not_ended e where e.n <= 5), '[]'::jsonb),
    'day_not_ended_more', greatest((select count(*) from not_ended) - 5, 0))
  into v_attendance;

  -- Tasks: approved (completed) yesterday; overdue now (tasks/domain isOverdue: not completed or
  -- cancelled, past due_at); waiting for the Owner (task_counts().to_decide for the Owner).
  select jsonb_build_object(
    'approved_yesterday', (
      select count(*) from public.tasks t
      where t.org_id = p_org and t.archived_at is null and t.completed_at >= v_from and t.completed_at < v_to),
    'overdue', (
      select count(*) from public.tasks t
      where t.org_id = p_org and t.archived_at is null
        and t.state not in ('completed', 'cancelled') and t.due_at < p_now and t.held_at is null),
    'waiting_for_owner', (
      select count(*) from public.tasks t
      where t.org_id = p_org and v_owner is not null
        and ((exists (select 1 from public.role_permissions rp
                      where rp.role = 'owner' and rp.permission = 'tasks.approve_final')
              and t.state = 'admin_approved')
          or (exists (select 1 from public.role_permissions rp
                      where rp.role = 'owner' and rp.permission = 'tasks.approve_admin')
              and t.state = 'submitted' and t.approving_admin_id = v_owner
              and not exists (select 1 from public.task_assignees a
                              where a.task_id = t.id and a.member_id = v_owner and a.removed_at is null)))))
  into v_tasks;

  -- Requests waiting for the Owner: leave (countPendingRequests: submitted, not the attendance
  -- prompt's) and expense claims (countPendingClaims: submitted). A count only: no amount is read.
  select jsonb_build_object(
    'leave', (
      select count(*) from public.leave_requests r
      join public.members m on m.id = r.member_id
      where m.org_id = p_org and r.state = 'submitted' and r.source <> 'attendance'),
    'expense_claims', (
      select count(*) from public.expense_claims c
      join public.members m on m.id = c.member_id
      where m.org_id = p_org and c.state = 'submitted'))
  into v_requests;

  -- Emails the daily limit held back yesterday, by kind (the dispatcher's skipped_cap rows).
  select coalesce(jsonb_agg(jsonb_build_object('kind', h.kind, 'description', h.description, 'count', h.n)
                            order by h.n desc, h.kind), '[]'::jsonb)
  into v_held
  from (
    select n.kind, k.description, count(*) as n
    from public.notification_deliveries d
    join public.notifications n on n.id = d.notification_id
    join public.notification_kinds k on k.kind = n.kind
    where n.org_id = p_org and d.channel = 'email' and d.state = 'skipped_cap'
      and d.created_at >= v_from and d.created_at < v_to
    group by n.kind, k.description
  ) h;

  -- 5.4: the tracked people (not the Owner) not reachable for 48 h or more, as the hourly
  -- reachability_check last recorded them.
  with unreachable as (
    select m.full_name, row_number() over (order by m.full_name, m.id) as n
    from public.member_reachability r
    join public.members m on m.id = r.member_id
    where m.org_id = p_org and m.status = 'active' and m.engagement = 'permanent' and m.joined_at is not null
      and m.id is distinct from v_owner
      and r.state <> 'ok' and greatest(r.since, (select o.reachability_clock_from from public.org_settings o where o.org_id = p_org))
          <= p_now - interval '48 hours'
  )
  select jsonb_build_object(
    'count', (select count(*) from unreachable),
    'names', coalesce((select jsonb_agg(u.full_name order by u.n) from unreachable u where u.n <= 5), '[]'::jsonb),
    'more', greatest((select count(*) from unreachable) - 5, 0))
  into v_unreachable;

  return jsonb_build_object(
    'date', v_today,
    'yesterday', v_yesterday,
    'attendance', v_attendance,
    'tasks', v_tasks,
    'requests', v_requests,
    'held_back', v_held,
    'unreachable', v_unreachable);
end;
$$;

-- app.digest_weekly_payload: The weekly digest's client items overdue now leave out a held project's.
-- (from 20261008192424_client_work_screens.sql)
create or replace function app.digest_weekly_payload(p_org uuid, p_now timestamptz)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_today date := app.to_ist_date(p_now);
  -- The window (amended decision 23): since the last digest sent before today, capped at seven days.
  v_last date := (
    select max(app.to_ist_date(n.created_at))
    from public.notifications n
    where n.org_id = p_org and n.kind = 'owner_digest_weekly'
      and n.created_at < app.ist_day_start(app.to_ist_date(p_now)));
  v_from date := greatest(app.to_ist_date(p_now) - 7, coalesce(v_last, app.to_ist_date(p_now) - 7));
  v_to date := app.to_ist_date(p_now) - 1;
  v_days jsonb;
  v_totals jsonb;
  v_daily jsonb;
  v_now jsonb;
  v_ahead jsonb;
  v_client_work jsonb;
begin
  -- The window's numbers, from its saved reports only (so the email and the reports agree).
  with dates as (
    select s::date as day from generate_series(v_from, v_to, interval '1 day') s
  ),
  days as (
    select d.day, r.id as report_id, r.data
    from dates d
    left join public.eod_reports r on r.org_id = p_org and r.report_date = d.day
  )
  select jsonb_agg(jsonb_build_object(
           'date', day, 'report_id', report_id, 'saved', data is not null,
           'present', coalesce((data #>> '{attendance,counts,present}')::int, 0),
           'on_leave', coalesce((data #>> '{attendance,counts,on_leave}')::int, 0),
           'absent', coalesce((data #>> '{attendance,counts,absent}')::int, 0),
           'end_not_recorded', coalesce((data #>> '{attendance,counts,end_not_recorded}')::int, 0),
           'overtime', coalesce((data #>> '{attendance,counts,overtime}')::int, 0),
           'completed', coalesce((data #>> '{tasks,completed,count}')::int, 0),
           'cancelled', coalesce((data #>> '{tasks,cancelled,count}')::int, 0),
           'created', coalesce((data #>> '{tasks,created,count}')::int, 0),
           'decisions', coalesce((data #>> '{decisions,attendance}')::int, 0)
             + coalesce((data #>> '{decisions,leave,approved}')::int, 0)
             + coalesce((data #>> '{decisions,leave,rejected}')::int, 0)
             + coalesce((data #>> '{decisions,comp_leave,granted}')::int, 0)
             + coalesce((data #>> '{decisions,comp_leave,revoked}')::int, 0)
             + coalesce((data #>> '{decisions,comp_leave,reviewed}')::int, 0)
             + coalesce((data #>> '{decisions,expense_claims}')::int, 0),
           'holiday', data #>> '{day_off,holiday}',
           'weekly_off', coalesce((data #>> '{day_off,weekly_off}')::boolean, false))
         order by day)
  into v_days
  from days;

  select jsonb_build_object(
    'present', sum((d ->> 'present')::int),
    'on_leave', sum((d ->> 'on_leave')::int),
    'absent', sum((d ->> 'absent')::int),
    'end_not_recorded', sum((d ->> 'end_not_recorded')::int),
    'overtime', sum((d ->> 'overtime')::int),
    'completed', sum((d ->> 'completed')::int),
    'cancelled', sum((d ->> 'cancelled')::int),
    'created', sum((d ->> 'created')::int),
    'decisions', sum((d ->> 'decisions')::int),
    'missing', count(*) filter (where not (d ->> 'saved')::boolean))
  into v_totals
  from jsonb_array_elements(v_days) d;

  -- Now: what waits for the Owner, what is overdue, who can't be reached (the daily digest's own
  -- counts, so the two agree), plus the attendance days and extra-work notes waiting.
  v_daily := app.owner_digest_payload(p_org, p_now);
  select jsonb_build_object(
    'waiting', jsonb_build_object(
      'tasks', coalesce((v_daily #>> '{tasks,waiting_for_owner}')::int, 0),
      'leave', coalesce((v_daily #>> '{requests,leave}')::int, 0),
      'expense_claims', coalesce((v_daily #>> '{requests,expense_claims}')::int, 0),
      'attendance', (
        select count(*) from public.attendance_days d join public.members m on m.id = d.member_id
        where m.org_id = p_org and m.status = 'active' and d.state = 'pending_review'),
      'extra_work', (
        select count(*) from public.extra_work_notes n join public.members m on m.id = n.member_id
        where m.org_id = p_org and m.status = 'active' and n.state = 'submitted')),
    'overdue', coalesce((v_daily #>> '{tasks,overdue}')::int, 0),
    'unreachable', coalesce(v_daily -> 'unreachable', '{"count": 0, "names": [], "more": 0}'::jsonb))
  into v_now;

  -- The week ahead (today and the next six days): approved and pending leave, event tasks, holidays.
  select jsonb_build_object(
    'from', v_today, 'to', v_today + 6,
    'leave', coalesce((
      select jsonb_agg(jsonb_build_object(
        'member_id', r.member_id, 'name', m.full_name, 'type', r.type,
        'from', greatest(r.start_date, v_today), 'to', least(r.end_date, v_today + 6),
        'pending', r.state = 'submitted')
        order by greatest(r.start_date, v_today), m.full_name, r.id)
      from public.leave_requests r
      join public.members m on m.id = r.member_id
      where m.org_id = p_org and m.status = 'active'
        and r.state in ('approved', 'submitted') and not (r.state = 'submitted' and r.requests_cancellation)
        and r.start_date <= v_today + 6 and r.end_date >= v_today), '[]'::jsonb),
    'events', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', t.id, 'title', t.title, 'date', t.event_date, 'start_at', t.event_start_at, 'location', t.location)
        order by t.event_date, t.event_start_at nulls first, t.title, t.id)
      from public.tasks t
      where t.org_id = p_org and t.archived_at is null and t.state <> 'cancelled'
        and t.event_date between v_today and v_today + 6), '[]'::jsonb),
    'holidays', coalesce((
      select jsonb_agg(jsonb_build_object('date', h.date, 'name', h.name) order by h.date)
      from public.holidays h where h.org_id = p_org and h.date between v_today and v_today + 6), '[]'::jsonb))
  into v_ahead;


  -- Client work per Admin (amendment C E4, owner 2026-10-08; replaces issue #56 Q3's line): the items
  -- done and the projects completed in the window from its saved reports (each event under the Admin
  -- who ran the client then), and the items overdue now (open, planned before today IST), under the
  -- client's current Admin. A client with no Admin is the Owner's own (admin_id null). Counts only.
  with saved as (
    select coalesce(e ->> 'admin_id', '') as admin_key,
           sum(coalesce((e #>> '{done,count}')::int, 0)) as done,
           sum(coalesce((e #>> '{projects_completed,count}')::int, 0)) as completed
    from public.eod_reports r
    cross join lateral jsonb_array_elements(coalesce(r.data #> '{client_work,admins}', '[]'::jsonb)) e
    where r.org_id = p_org and r.report_date between v_from and v_to
    group by 1
  ),
  overdue as (
    select coalesce(c.admin_id::text, '') as admin_key, count(*) as overdue
    from public.project_items i
    join public.projects p on p.id = i.project_id
    join public.clients c on c.id = p.client_id
    where i.org_id = p_org and i.state = 'open' and i.planned_date < v_today and p.held_at is null
    group by 1
  ),
  merged as (
    select coalesce(s.admin_key, o.admin_key) as admin_key, coalesce(s.done, 0) as done,
           coalesce(s.completed, 0) as completed, coalesce(o.overdue, 0) as overdue
    from saved s
    full join overdue o on o.admin_key = s.admin_key
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'admin_id', nullif(x.admin_key, ''), 'name', m.full_name,
           'done', x.done, 'overdue', x.overdue, 'projects_completed', x.completed)
           order by m.full_name nulls last, x.admin_key), '[]'::jsonb)
  into v_client_work
  from merged x
  left join public.members m on m.id = nullif(x.admin_key, '')::uuid
  where x.done + x.overdue + x.completed > 0;

  return jsonb_build_object(
    'date', v_today,
    'week', jsonb_build_object('from', v_from, 'to', v_to),
    'days', v_days,
    'totals', v_totals,
    'now', v_now,
    'ahead', v_ahead,
    'client_work', v_client_work);
end;
$$;

-- public.client_work_summary: The Clients list's late count leaves out a held project's deliverables (they read On hold).
-- (from 20261023030855_v18_client_work_summary.sql)
create or replace function public.client_work_summary(on_date date default app.today_ist())
returns table (
  client_id uuid,
  total integer,
  done integer,
  closed integer,
  late integer,
  next_planned date
)
language sql
stable
security invoker
set search_path = ''
as $$
  select p.client_id,
         (count(*) filter (where i.state not in ('cancelled', 'carried')))::integer,
         (count(*) filter (where i.state in ('done', 'approved')))::integer,
         (count(*) filter (where i.state = 'cancelled'))::integer,
         (count(*) filter (where i.state = 'open' and i.planned_date < on_date and p.held_at is null))::integer,
         min(i.planned_date) filter (where i.state = 'open' and i.planned_date >= on_date)
  from public.project_cycles c
  join public.projects p on p.id = c.project_id
  join public.project_items i on i.cycle_id = c.id
  where p.state in ('open', 'in_progress')
    and (c.period_start is null or (c.period_start <= on_date and c.period_end >= on_date))
  group by p.client_id;
$$;

-- app.client_items_overdue_due: E1 (and every read of it): a held project's deliverables are On hold, never overdue.
-- (from 20261008174151_client_work_alerts_once_per_date.sql)
create or replace function app.client_items_overdue_due(p_org uuid, p_today date)
returns table (id uuid, title text, planned_date date, project_id uuid, project text, link text, client text,
               admin_id uuid, basis timestamptz, due_from timestamptz)
language sql
stable
set search_path = ''
as $$
  with c as materialized (
    select cl.id, cl.name, cl.admin_id,
           (select max(coalesce(a.to_at, a.from_at)) from public.client_admin_assignments a
            where a.client_id = cl.id) as since
    from public.clients cl
    where cl.org_id = p_org
  ), o as (
    select i.id, i.title, i.planned_date, p.id as project_id, p.name as project, app.project_link(p) as link,
           c.name as client, c.admin_id, i.overdue_armed_at,
           greatest(((i.planned_date + 1)::timestamp at time zone 'Asia/Kolkata'), i.reopened_at, c.since) as basis
    from public.project_items i
    join public.projects p on p.id = i.project_id
    join c on c.id = p.client_id
    where i.org_id = p_org and i.state = 'open' and i.planned_date < p_today
      and p.state in ('open', 'in_progress') and p.held_at is null
  )
  select o.id, o.title, o.planned_date, o.project_id, o.project, o.link, o.client, o.admin_id, o.basis,
         greatest(o.basis, o.overdue_armed_at)
  from o;
$$;

-- app.cycle_undecided_due: E2 and the prompt: no undecided cycle of a held project.
-- (from 20261008171629_client_work_alerts_armed.sql)
create or replace function app.cycle_undecided_due(p_org uuid)
returns table (cycle_id uuid, period_end date, label text, project_id uuid, project text, link text,
               client text, admin_id uuid, undecided integer, told timestamptz, due_at timestamptz)
language sql
stable
set search_path = ''
as $$
  select c.id, c.period_end, c.label, p.id, p.name, app.project_link(p), cl.name, cl.admin_id,
         u.n::integer, t.told,
         least(u.reopened, case when s.since > t.told then s.since end)
  from public.project_cycles c
  join public.projects p on p.id = c.project_id
  join public.clients cl on cl.id = p.client_id
  cross join lateral (
    select greatest(c.prompted_at, max(a.sent_at)) as told from public.client_work_alerts a
    where a.kind = 'cycle_undecided_notice' and a.entity_id = c.id and a.armed_for = c.period_end) t
  cross join lateral (
    select count(*) as n, min(i.reopened_at) filter (where i.reopened_at > t.told) as reopened
    from public.project_items i
    where i.cycle_id = c.id and i.state = 'open' and i.carry_decision is null) u
  cross join lateral (
    select max(coalesce(a.to_at, a.from_at)) as since from public.client_admin_assignments a
    where a.client_id = cl.id) s
  where c.org_id = p_org and c.state = 'open' and c.prompted_at is not null and c.period_end is not null
    and p.state in ('open', 'in_progress') and p.held_at is null and cl.admin_id is not null and u.n > 0;
$$;

-- app.cycle_generate: No cycle for a held project; after a resume, none for a period that ended before it.
-- (from 20261008182234_client_work_morning_window.sql)
create or replace function app.cycle_generate(p_now timestamptz default now())
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_today date := app.to_ist_date(p_now);
  v_row record;
  v_project public.projects;
  v_client public.clients;
  v_start date;
  v_cycle public.project_cycles;
  v_project_count integer;
  v_count integer := 0;
begin
  for v_org in select o.id from public.organizations o order by o.id loop
    -- One run at a time per organisation (a late run and the next cannot both create a cycle).
    perform pg_advisory_xact_lock(hashtext('cycle_generate:' || v_org::text));
    -- Each project's first date still to cover (decision 2's 7-day catch-up): the last 7 IST dates,
    -- never before the project existed, before its client last became Active (a period spent
    -- paused is skipped on purpose, decisions 1 and 2) or before the project was last reopened
    -- (cycles resume from then, decision 14).
    for v_row in
      select p.id, p.recurrence,
             greatest(
               v_today - 6,
               app.to_ist_date(p.created_at),
               app.to_ist_date(c.activated_at),
               (select app.to_ist_date(max(a.at)) from public.activity_log a
                where a.entity = 'clients' and a.entity_id = c.id and a.action in ('activated', 'reactivated')),
               (select app.to_ist_date(max(a.at)) from public.activity_log a
                where a.entity = 'projects' and a.entity_id = p.id and a.action = 'reopened'),
               -- v1.9 W7: a period that ended before the last resume stays without a cycle.
               app.to_ist_date(p.resumed_at)
             ) as first_day
      from public.projects p
      join public.clients c on c.id = p.client_id
      where p.org_id = v_org and p.recurrence <> 'one_time' and p.state in ('open', 'in_progress')
        and p.held_at is null
        and c.state = 'active'
      order by p.id
    loop
      -- Nothing to lock when every period from the first day to today has its cycle and no running
      -- cycle still waits for the item list (Q4 (a): carried in while the client was not Active).
      continue when not exists (
        select 1
        from generate_series(app.period_start(v_row.recurrence, v_row.first_day)::timestamp,
                             app.period_start(v_row.recurrence, v_today)::timestamp,
                             case when v_row.recurrence = 'weekly' then interval '7 days' else interval '1 month' end) g
        where not exists (select 1 from public.project_cycles c
                          where c.project_id = v_row.id and c.period_start = g::date))
        and not exists (
        select 1 from public.project_cycles c
        where c.project_id = v_row.id and not c.item_list_copied and c.period_end >= v_today);
      -- Each project in a savepoint of its own: one that fails is logged and retried the next night,
      -- never costing the others their cycles (as reminders_tick, phase 5 review).
      begin
        -- The project first (the lock order of every client-work function), then re-checked under it.
        select p.* into v_project from public.projects p where p.id = v_row.id for update;
        continue when v_project.state not in ('open', 'in_progress') or v_project.held_at is not null;
        select c.* into v_client from public.clients c where c.id = v_project.client_id;
        continue when v_client.state <> 'active';
        v_project_count := 0;
        -- Oldest first: an earlier missed period is made before the current one. Each new cycle arms
        -- its "cycle ready" notice (ready_armed_at, by trigger), which client_work_alerts sends at
        -- 08:00 IST while its period is running (Q12 (b)); an ended one goes to the prompt.
        for v_start in
          select g::date
          from generate_series(app.period_start(v_project.recurrence, v_row.first_day)::timestamp,
                               app.period_start(v_project.recurrence, v_today)::timestamp,
                               case when v_project.recurrence = 'weekly' then interval '7 days' else interval '1 month' end) g
          order by 1
        loop
          continue when exists (
            select 1 from public.project_cycles c where c.project_id = v_project.id and c.period_start = v_start);
          v_cycle := app.cycle_create(v_project, v_start, 'schedule', null);
          -- A past period may already have a later cycle (a manual start, a carry): settle it then.
          perform app.cycle_refresh(v_cycle.id);
          v_project_count := v_project_count + 1;
        end loop;
        -- Q4 (a): a running cycle made by a carry while the client was not Active gets the item list
        -- now, once (a past one never takes new items, decision 9); the list joining arms its notice.
        for v_cycle in
          select c.* from public.project_cycles c
          where c.project_id = v_project.id and not c.item_list_copied and c.period_end >= v_today
          order by c.period_start
        loop
          perform app.cycle_copy_item_list(v_project, v_cycle.id, null);
        end loop;
        v_count := v_count + v_project_count;
      exception when others then
        raise warning 'cycle_generate: project % skipped: %', v_row.id, sqlerrm;
      end;
    end loop;
  end loop;
  return v_count;
end;
$$;

-- app.cycle_close_prompt: No end-of-cycle prompt for a held project (its choices come with the resume).
-- (from 20261008182234_client_work_morning_window.sql)
create or replace function app.cycle_close_prompt(p_now timestamptz default now())
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_today date := app.to_ist_date(p_now);
  v_rows jsonb;
  v_cycle record;
  v_admin record;
  v_cycle_id uuid;
  v_sent integer;
  v_count integer := 0;
begin
  -- Q13 (a): prompts only in the morning window (08:00 to before 08:30 IST; the job runs at 08:05). A
  -- run outside it marks nothing prompted, so the next morning's run prompts what is still undecided.
  if not app.client_work_send_window(p_now) then
    return 0;
  end if;

  for v_org in select o.id from public.organizations o order by o.id loop
    perform pg_advisory_xact_lock(hashtext('cycle_close_prompt:' || v_org::text));
    v_rows := '[]'::jsonb;
    -- Every ended cycle of an open or in-progress project holding open items: its undecided items
    -- and the items left pending. 'new' marks a cycle not yet announced with undecided items.
    for v_cycle in
      select c.id, c.label, c.prompted_at, p.id as project_id, p.client_id, p.name as project,
             cl.name as client, app.cycle_close_prompt_recipient(cl) as recipient,
             count(*) filter (where i.carry_decision is null) as undecided,
             count(*) filter (where i.carry_decision = 'leave_pending') as pending
      from public.project_cycles c
      join public.projects p on p.id = c.project_id
      join public.clients cl on cl.id = p.client_id
      join public.project_items i on i.cycle_id = c.id and i.state = 'open'
      where c.org_id = v_org and c.period_end is not null and c.period_end < v_today
        and p.state in ('open', 'in_progress') and p.held_at is null
      group by c.id, c.label, c.prompted_at, p.id, p.client_id, p.name, cl.id, cl.name
      order by c.id
    loop
      continue when v_cycle.recipient is null;
      v_rows := v_rows || jsonb_build_object(
        'recipient', v_cycle.recipient, 'cycle_id', v_cycle.id,
        'new', v_cycle.prompted_at is null and v_cycle.undecided > 0,
        'items', v_cycle.undecided + v_cycle.pending,
        'pending', v_cycle.pending,
        'line', format('%s (%s) · %s', v_cycle.project, v_cycle.client, v_cycle.label),
        'link', '/clients/' || v_cycle.client_id || '/projects/' || v_cycle.project_id,
        'project_id', v_cycle.project_id);
    end loop;

    -- S1: prompted_at decides only whether an Admin is prompted (a newly ended cycle with undecided
    -- items); the prompt then counts and lists everything they still have to decide, the cycles
    -- announced before and the items left pending included.
    for v_admin in
      select (x ->> 'recipient')::uuid as recipient,
             sum((x ->> 'items')::integer) as items,
             sum((x ->> 'pending')::integer) as pending,
             count(distinct x ->> 'project_id') as projects,
             string_agg((x ->> 'line') || ': ' || (x ->> 'items'), '; ' order by x ->> 'line') as lines,
             min(x ->> 'link') as link, min(x ->> 'project_id') as project_id,
             array_agg((x ->> 'cycle_id')::uuid order by x ->> 'cycle_id')
               filter (where (x ->> 'new')::boolean) as new_cycles
      from jsonb_array_elements(v_rows) x
      group by 1
      having bool_or((x ->> 'new')::boolean)
      order by 1
    loop
      -- L1: each Admin's prompt and the marking of their cycles in a savepoint of their own: one that
      -- fails is logged and prompted the next morning (prompted_at stays null), never costing the
      -- others theirs.
      begin
        v_sent := app.notify(array[v_admin.recipient], 'items_to_decide',
          format('%s unfinished %s to decide', v_admin.items, case when v_admin.items = 1 then 'item' else 'items' end),
          v_admin.lines || case when v_admin.pending > 0
            then format('. %s left pending, listed again.', v_admin.pending) else '.' end,
          case when v_admin.projects = 1 then v_admin.link else '/today' end,
          case when v_admin.projects = 1 then 'projects' end,
          case when v_admin.projects = 1 then v_admin.project_id::uuid end,
          jsonb_build_object('items', v_admin.items, 'pending', v_admin.pending), null);
        -- The 7A review's L1: the prompt lists every undecided item, so it is the Admin's fresh E2
        -- notice for each earlier cycle that had one due (an item back to open or a new Admin since
        -- they were last told): recorded, so client_work_alerts sends no second items_to_decide. An
        -- answer the job already recorded is kept as it is (never costs the Admin the prompt).
        if v_sent > 0 then
          insert into public.client_work_alerts (org_id, kind, entity_id, armed_for, sent_at, recipient_id, answers_at)
          select v_org, 'cycle_undecided_notice', d.cycle_id, d.period_end, p_now, v_admin.recipient, d.due_at
          from app.cycle_undecided_due(v_org) d
          where d.admin_id = v_admin.recipient and d.due_at is not null and d.due_at <= p_now
            and d.period_end < v_today
          on conflict do nothing;
        end if;
        -- Each newly announced cycle is marked, so it alone never prompts again.
        foreach v_cycle_id in array v_admin.new_cycles loop
          perform set_config('app.audit_override', jsonb_build_object('action', 'prompted')::text, true);
          update public.project_cycles set prompted_at = p_now where id = v_cycle_id;
        end loop;
        v_count := v_count + 1;
      exception when others then
        raise warning 'cycle_close_prompt: Admin % skipped: %', v_admin.recipient, sqlerrm;
      end;
    end loop;
  end loop;
  return v_count;
end;
$$;

-- app.client_work_alerts: No "cycle ready", E2 or E3 about a held project (E1 and E2 read the helpers above).
-- (from 20261008182234_client_work_morning_window.sql)
create or replace function app.client_work_alerts(p_now timestamptz default now())
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org record;
  v_today date := app.to_ist_date(p_now);
  v_group record;
  v_owner uuid;
  v_sent integer;
  v_count integer := 0;
begin
  -- S2: the "already sent?" checks below read what the run before committed once the advisory lock is
  -- held, which only read committed gives (a repeatable-read snapshot predates the lock).
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'client_work_alerts runs only at read committed, not %',
      current_setting('transaction_isolation');
  end if;
  -- Q13 (a): sends only in the morning window (08:00 to before 08:30 IST). A run outside it, such as the
  -- first run after an outage, sends nothing; the next morning's run sends what still holds.
  if not app.client_work_send_window(p_now) then
    return 0;
  end if;

  for v_org in
    select s.org_id, s.item_overdue_escalate_hours as hours, s.cycle_decide_escalate_days as days
    from public.org_settings s order by s.org_id
  loop
    -- One run at a time per organisation: a late run and the next cannot both send.
    perform pg_advisory_xact_lock(hashtext('client_work_alerts:' || v_org.org_id::text));
    v_owner := app.org_owner_id(v_org.org_id);

    -- Q12 (b), cycle ready: running cycles (the period has begun and not ended) of open or in-progress
    -- projects of Active clients whose notice was armed (made by the 00:00 schedule, by a carry not the
    -- Admin's own, or given their item list) and not yet sent since, from the first 08:00 IST after the
    -- arming: the client's Admin, one combined cycle_generated per Admin per run (actionable), no actor.
    for v_group in
      select cl.admin_id,
             count(*) as n,
             min(c.label) as first_label, max(c.label) as last_label,
             string_agg(p.name || ' (' || cl.name || ')', ', ' order by cl.name, p.name, c.id) as projects,
             min(app.project_link(p)) as link, min(p.id::text)::uuid as project_id,
             array_agg(c.id order by c.id) as ids,
             array_agg(c.period_start order by c.id) as dates,
             array_agg(c.ready_armed_at order by c.id) as answers
      from public.project_cycles c
      join public.projects p on p.id = c.project_id
      join public.clients cl on cl.id = p.client_id
      where c.org_id = v_org.org_id and c.ready_armed_at is not null
        and c.period_start <= v_today and c.period_end >= v_today
        and p.state in ('open', 'in_progress') and p.held_at is null and cl.state = 'active' and cl.admin_id is not null
        and p_now >= app.client_work_morning(c.ready_armed_at)
        and not exists (select 1 from public.client_work_alerts a
                        where a.kind = 'cycle_generated' and a.entity_id = c.id and a.sent_at >= c.ready_armed_at)
      group by cl.admin_id
      order by cl.admin_id
    loop
      begin
        v_sent := app.notify(array[v_group.admin_id], 'cycle_generated',
          case
            when v_group.n = 1 then format('%s is ready: %s', v_group.first_label, v_group.projects)
            when v_group.first_label = v_group.last_label then format('%s is ready for %s projects', v_group.first_label, v_group.n)
            else format('New cycles are ready for %s projects', v_group.n)
          end,
          case when v_group.n = 1 then 'Rename this period''s items where needed.'
               else v_group.projects || '. Rename this period''s items where needed.' end,
          case when v_group.n = 1 then v_group.link else '/today' end,
          case when v_group.n = 1 then 'projects' end,
          case when v_group.n = 1 then v_group.project_id end,
          jsonb_build_object('cycles', v_group.n), null);
        if v_sent > 0 then
          insert into public.client_work_alerts (org_id, kind, entity_id, armed_for, sent_at, recipient_id, answers_at)
          select v_org.org_id, 'cycle_generated', x.id, x.d, p_now, v_group.admin_id, x.b
          from unnest(v_group.ids, v_group.dates, v_group.answers) as x(id, d, b);
          v_count := v_count + v_sent;
        end if;
      exception when others then
        raise warning 'client_work_alerts: cycle ready for Admin % skipped: %', v_group.admin_id, sqlerrm;
      end;
    end loop;

    -- E1, the notice: overdue items whose recipient (the client's Admin; the Owner for a client with no
    -- Admin, Q9) has no notice for this planned date counting for them (sent at or after the basis), from
    -- the first 08:00 IST after due_from (Q10; the later of the basis and the item's last arming, M1: the
    -- arming decides only when, so a date moved back to one already noticed is not told again); one row
    -- per recipient, each answering its item's basis.
    for v_group in
      select o.recipient,
             count(*) as n,
             count(distinct o.project_id) as projects,
             min(o.project_id::text)::uuid as project_id,
             min(o.link) as link,
             array_agg(o.id order by o.planned_date, o.project, o.title, o.id) as ids,
             array_agg(o.planned_date order by o.planned_date, o.project, o.title, o.id) as dates,
             array_agg(o.basis order by o.planned_date, o.project, o.title, o.id) as answers,
             array_agg(format('%s (%s · %s, %s)', o.title, o.project, o.client, app.notify_date(o.planned_date))
                       order by o.planned_date, o.project, o.title, o.id) as lines,
             min(o.title) as title, min(o.project) as project, min(o.client) as client, min(o.planned_date) as planned
      from (select x.*, coalesce(x.admin_id, v_owner) as recipient
            from app.client_items_overdue_due(v_org.org_id, v_today) x) o
      where o.recipient is not null
        and p_now >= app.client_work_morning(o.due_from)
        and not exists (select 1 from public.client_work_alerts a
                        where a.kind = 'item_overdue' and a.entity_id = o.id and a.armed_for = o.planned_date
                          and a.sent_at >= o.basis and coalesce(a.recipient_id, o.recipient) = o.recipient)
      group by o.recipient
      order by o.recipient
    loop
      begin
        v_sent := app.notify(array[v_group.recipient], 'reminder_item_overdue',
          case when v_group.n = 1 then format('Overdue: %s', v_group.title)
               else format('%s client items overdue', v_group.n) end,
          case when v_group.n = 1
               then format('%s · %s. Planned for %s.', v_group.project, v_group.client, app.notify_date(v_group.planned))
               else app.client_work_alert_lines(v_group.lines) || '.' end,
          case when v_group.projects = 1 then v_group.link else app.client_items_overdue_link() end,
          case when v_group.projects = 1 then 'projects' end,
          case when v_group.projects = 1 then v_group.project_id end,
          jsonb_build_object('items', v_group.n), null);
        if v_sent > 0 then
          insert into public.client_work_alerts (org_id, kind, entity_id, armed_for, sent_at, recipient_id, answers_at)
          select v_org.org_id, 'item_overdue', x.id, x.d, p_now, v_group.recipient, x.b
          from unnest(v_group.ids, v_group.dates, v_group.answers) as x(id, d, b);
          v_count := v_count + v_sent;
        end if;
      exception when others then
        raise warning 'client_work_alerts: overdue notice for % skipped: %', v_group.recipient, sqlerrm;
      end;
    end loop;

    -- E1, then the Owner: items of a client with an Admin, still open and overdue, whose notice to that
    -- Admin counts and has had no escalation yet, from the first 08:00 IST at least
    -- item_overdue_escalate_hours after it (an hour's grace for the run after 08:00); one escalation per
    -- Admin, naming the Admin who was told (Q11). Never for a client with no Admin (Q9); none without
    -- an active Owner (L2). A date moved back to one already noticed finds that notice and its
    -- escalation still counting: nothing again.
    for v_group in
      select o.admin_id, m.full_name as admin_name,
             count(*) as n,
             array_agg(o.id order by o.planned_date, o.project, o.title, o.id) as ids,
             array_agg(o.planned_date order by o.planned_date, o.project, o.title, o.id) as dates,
             array_agg(n.told order by o.planned_date, o.project, o.title, o.id) as answers,
             array_agg(format('%s (%s · %s, %s)', o.title, o.project, o.client, app.notify_date(o.planned_date))
                       order by o.planned_date, o.project, o.title, o.id) as lines
      from app.client_items_overdue_due(v_org.org_id, v_today) o
      join public.members m on m.id = o.admin_id
      cross join lateral (
        select max(a.sent_at) as told from public.client_work_alerts a
        where a.kind = 'item_overdue' and a.entity_id = o.id and a.armed_for = o.planned_date
          and a.sent_at >= o.basis and coalesce(a.recipient_id, o.admin_id) = o.admin_id) n
      where v_owner is not null and n.told is not null
        and p_now >= app.client_work_morning(n.told + make_interval(hours => v_org.hours) - interval '1 hour')
        and not exists (select 1 from public.client_work_alerts a
                        where a.kind = 'item_overdue_escalation' and a.entity_id = o.id
                          and a.armed_for = o.planned_date and a.sent_at >= n.told)
      group by o.admin_id, m.full_name
      order by o.admin_id
    loop
      begin
        v_sent := app.notify(array[v_owner], 'escalation_item_overdue',
          case when v_group.n = 1 then format('%s has a client item overdue', v_group.admin_name)
               else format('%s has %s client items overdue', v_group.admin_name, v_group.n) end,
          app.client_work_alert_lines(v_group.lines)
            || format('. Still not done %s h after %s was told.', v_org.hours, v_group.admin_name),
          app.client_items_overdue_link(), null, null,
          jsonb_build_object('items', v_group.n, 'admin_id', v_group.admin_id), null, 1);
        if v_sent > 0 then
          insert into public.client_work_alerts (org_id, kind, entity_id, armed_for, sent_at, recipient_id, answers_at)
          select v_org.org_id, 'item_overdue_escalation', x.id, x.d, p_now, v_group.admin_id, x.b
          from unnest(v_group.ids, v_group.dates, v_group.answers) as x(id, d, b);
          v_count := v_count + v_sent;
        end if;
      exception when others then
        raise warning 'client_work_alerts: overdue escalation for Admin % skipped: %', v_group.admin_id, sqlerrm;
      end;
    end loop;

    -- E2, a fresh notice (Q8, Q11): a prompted, ended cycle whose undecided items include one back to
    -- open since the Admin was last told, or whose client's Admin changed since: the client's Admin,
    -- from the first 08:00 IST after the earliest such moment; one items_to_decide per Admin per run.
    -- L1: not for an Admin whom the 08:05 prompt reaches this morning (a newly ended cycle of theirs not
    -- yet prompted, the prompt's own condition): the prompt lists these cycles too and records the
    -- fresh notices, so the Admin gets one items_to_decide that morning.
    for v_group in
      select d.admin_id,
             count(*) as cycles,
             sum(d.undecided)::integer as items,
             count(distinct d.project_id) as projects,
             min(d.project_id::text)::uuid as project_id,
             min(d.link) as link,
             array_agg(d.cycle_id order by d.period_end, d.project, d.cycle_id) as ids,
             array_agg(d.period_end order by d.period_end, d.project, d.cycle_id) as dates,
             array_agg(d.due_at order by d.period_end, d.project, d.cycle_id) as answers,
             array_agg(format('%s (%s) · %s: %s', d.project, d.client, d.label, d.undecided)
                       order by d.period_end, d.project, d.cycle_id) as lines
      from app.cycle_undecided_due(v_org.org_id) d
      where d.due_at is not null and d.period_end < v_today
        and p_now >= app.client_work_morning(d.due_at)
        and not exists (
          select 1 from public.project_cycles c
          join public.projects p on p.id = c.project_id
          join public.clients cl on cl.id = p.client_id
          where c.org_id = v_org.org_id and c.state = 'open' and c.prompted_at is null
            and c.period_end is not null and c.period_end < v_today
            and p.state in ('open', 'in_progress') and p.held_at is null
            and app.cycle_close_prompt_recipient(cl) = d.admin_id
            and exists (select 1 from public.project_items i
                        where i.cycle_id = c.id and i.state = 'open' and i.carry_decision is null))
      group by d.admin_id
      order by d.admin_id
    loop
      begin
        v_sent := app.notify(array[v_group.admin_id], 'items_to_decide',
          format('%s unfinished %s to decide', v_group.items, case when v_group.items = 1 then 'item' else 'items' end),
          app.client_work_alert_lines(v_group.lines) || '.',
          case when v_group.projects = 1 then v_group.link else '/today' end,
          case when v_group.projects = 1 then 'projects' end,
          case when v_group.projects = 1 then v_group.project_id end,
          jsonb_build_object('items', v_group.items, 'cycles', v_group.cycles), null);
        if v_sent > 0 then
          insert into public.client_work_alerts (org_id, kind, entity_id, armed_for, sent_at, recipient_id, answers_at)
          select v_org.org_id, 'cycle_undecided_notice', x.id, x.d, p_now, v_group.admin_id, x.b
          from unnest(v_group.ids, v_group.dates, v_group.answers) as x(id, d, b);
          v_count := v_count + v_sent;
        end if;
      exception when others then
        raise warning 'client_work_alerts: cycle notice for Admin % skipped: %', v_group.admin_id, sqlerrm;
      end;
    end loop;

    -- E2, the escalation: those cycles, with no item back to open and no Admin change since the Admin
    -- was last told, at the first 08:00 IST at least cycle_decide_escalate_days after both the period's
    -- end and that notice (an hour's grace for the run after 08:00), not yet escalated since it; one
    -- escalation per Admin; none without an active Owner (L2).
    for v_group in
      select d.admin_id, m.full_name as admin_name,
             count(*) as n,
             count(distinct d.project_id) as projects,
             min(d.project_id::text)::uuid as project_id,
             min(d.link) as link,
             array_agg(d.cycle_id order by d.period_end, d.project, d.cycle_id) as ids,
             array_agg(d.period_end order by d.period_end, d.project, d.cycle_id) as dates,
             array_agg(d.told order by d.period_end, d.project, d.cycle_id) as answers,
             array_agg(format('%s (%s) · %s: %s undecided', d.project, d.client, d.label, d.undecided)
                       order by d.period_end, d.project, d.cycle_id) as lines,
             min(d.label) as label, min(d.project) as project
      from app.cycle_undecided_due(v_org.org_id) d
      join public.members m on m.id = d.admin_id
      where v_owner is not null and d.due_at is null
        and p_now >= app.client_work_morning(
                       greatest(((d.period_end + 1)::timestamp at time zone 'Asia/Kolkata'), d.told)
                       + make_interval(days => v_org.days) - interval '1 hour')
        and not exists (select 1 from public.client_work_alerts a
                        where a.kind = 'cycle_undecided_escalation' and a.entity_id = d.cycle_id
                          and a.armed_for = d.period_end and a.sent_at >= d.told)
      group by d.admin_id, m.full_name
      order by d.admin_id
    loop
      begin
        v_sent := app.notify(array[v_owner], 'escalation_cycle_undecided',
          case when v_group.n = 1 then format('%s has not decided %s · %s', v_group.admin_name, v_group.label, v_group.project)
               else format('%s has not decided %s ended cycles', v_group.admin_name, v_group.n) end,
          app.client_work_alert_lines(v_group.lines)
            || format('. Unfinished items still undecided %s %s after the period ended.',
                      v_org.days, case when v_org.days = 1 then 'day' else 'days' end),
          case when v_group.projects = 1 then v_group.link else '/clients' end,
          case when v_group.projects = 1 then 'projects' end,
          case when v_group.projects = 1 then v_group.project_id end,
          jsonb_build_object('cycles', v_group.n, 'admin_id', v_group.admin_id), null, 1);
        if v_sent > 0 then
          insert into public.client_work_alerts (org_id, kind, entity_id, armed_for, sent_at, recipient_id, answers_at)
          select v_org.org_id, 'cycle_undecided_escalation', x.id, x.d, p_now, v_group.admin_id, x.b
          from unnest(v_group.ids, v_group.dates, v_group.answers) as x(id, d, b);
          v_count := v_count + v_sent;
        end if;
      exception when others then
        raise warning 'client_work_alerts: cycle escalation for Admin % skipped: %', v_group.admin_id, sqlerrm;
      end;
    end loop;

    -- E3: one-time projects still open or in progress at the later of 08:00 IST the morning after their
    -- delivery date and the first 08:00 IST after the project was created, its date moved or it was
    -- reopened (M1); once per delivery date (a moved date re-arms). One escalation per Admin naming
    -- them; a client with no Admin: one reminder to the Owner, no Admin named (Q9). Nothing without an
    -- active Owner (L2).
    for v_group in
      select cl.admin_id, m.full_name as admin_name,
             count(*) as n,
             min(p.id::text)::uuid as project_id,
             min(app.project_link(p)) as link,
             array_agg(p.id order by p.delivery_date, p.name, p.id) as ids,
             array_agg(p.delivery_date order by p.delivery_date, p.name, p.id) as dates,
             array_agg(((p.delivery_date + 1)::timestamp + time '08:00') at time zone 'Asia/Kolkata'
                       order by p.delivery_date, p.name, p.id) as answers,
             array_agg(format('%s (%s, due %s)', p.name, cl.name, app.notify_date(p.delivery_date))
                       order by p.delivery_date, p.name, p.id) as lines,
             min(p.name) as project, min(cl.name) as client, min(p.delivery_date) as due
      from public.projects p
      join public.clients cl on cl.id = p.client_id
      left join public.members m on m.id = cl.admin_id
      where v_owner is not null
        and p.org_id = v_org.org_id and p.recurrence = 'one_time' and p.state in ('open', 'in_progress')
        and p.held_at is null
        and p.delivery_date is not null
        and p_now >= greatest(((p.delivery_date + 1)::timestamp + time '08:00') at time zone 'Asia/Kolkata',
                              app.client_work_morning(p.delivery_armed_at))
        and not exists (select 1 from public.client_work_alerts a
                        where a.kind = 'delivery_escalation' and a.entity_id = p.id and a.armed_for = p.delivery_date)
      group by cl.admin_id, m.full_name
      order by cl.admin_id nulls first
    loop
      begin
        if v_group.admin_id is null then
          v_sent := app.notify(array[v_owner], 'reminder_delivery_missed',
            case when v_group.n = 1 then format('Past delivery: %s', v_group.project)
                 else format('%s one-time projects past delivery', v_group.n) end,
            case when v_group.n = 1
                 then format('%s. Due %s, not completed.', v_group.client, app.notify_date(v_group.due))
                 else app.client_work_alert_lines(v_group.lines) || '. Not completed.' end,
            case when v_group.n = 1 then v_group.link else '/clients' end,
            case when v_group.n = 1 then 'projects' end,
            case when v_group.n = 1 then v_group.project_id end,
            jsonb_build_object('projects', v_group.n), null);
        else
          v_sent := app.notify(array[v_owner], 'escalation_delivery_missed',
            case when v_group.n = 1 then format('Past delivery: %s · %s', v_group.project, v_group.admin_name)
                 else format('%s one-time projects past delivery · %s', v_group.n, v_group.admin_name) end,
            case when v_group.n = 1
                 then format('%s. Due %s, not completed. %s runs it.', v_group.client, app.notify_date(v_group.due), v_group.admin_name)
                 else app.client_work_alert_lines(v_group.lines) || format('. Not completed. %s runs them.', v_group.admin_name) end,
            case when v_group.n = 1 then v_group.link else '/clients' end,
            case when v_group.n = 1 then 'projects' end,
            case when v_group.n = 1 then v_group.project_id end,
            jsonb_build_object('projects', v_group.n, 'admin_id', v_group.admin_id), null, 1);
        end if;
        if v_sent > 0 then
          insert into public.client_work_alerts (org_id, kind, entity_id, armed_for, sent_at, recipient_id, answers_at)
          select v_org.org_id, 'delivery_escalation', x.id, x.d, p_now, coalesce(v_group.admin_id, v_owner), x.b
          from unnest(v_group.ids, v_group.dates, v_group.answers) as x(id, d, b);
          v_count := v_count + v_sent;
        end if;
      exception when others then
        raise warning 'client_work_alerts: delivery escalation for Admin % skipped: %', v_group.admin_id, sqlerrm;
      end;
    end loop;
  end loop;
  return v_count;
end;
$$;

-- app.client_work_activity_shown: The project's history shows a hold and a resume (describeProjectActivity says them).
-- (from 20261022091951_w1_close_kinds.sql)
create or replace function app.client_work_activity_shown(p_entity text, p_action text, p_diff jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(case p_entity
    when 'projects' then
      p_action in ('insert', 'started', 'completed', 'cancelled', 'reopened', 'saved_as_template', 'held', 'resumed')
      or (p_action = 'update'
          and coalesce(p_diff -> 'new', '{}'::jsonb) ?| array['delivery_date', 'name', 'description', 'custom_fields'])
    when 'project_stages' then
      p_action in ('insert', 'archived', 'group_renamed', 'group_moved')
      or (p_action = 'update'
          and coalesce(p_diff -> 'new', '{}'::jsonb) ?| array['name', 'position', 'group_label', 'group_position'])
    when 'project_item_blueprints' then
      p_action in ('insert', 'archived')
      or (p_action = 'update'
          and coalesce(p_diff -> 'new', '{}'::jsonb) ?| array['title', 'position', 'stages', 'stage_groups'])
    when 'project_item_stage_list' then
      p_action in ('insert', 'archived', 'ticked', 'unticked', 'group_renamed', 'group_moved')
      or (p_action = 'update'
          and coalesce(p_diff -> 'new', '{}'::jsonb) ?| array['name', 'position', 'group_label', 'group_position'])
    when 'project_cycles' then
      p_action in ('generated', 'insert', 'item_list_added', 'extras_kept', 'extras_not_kept')
    when 'project_items' then
      p_action in ('insert', 'done', 'not_done', 'approved', 'rejected', 'sent_back', 'reopened', 'cancelled',
                   'closed', 'carried', 'carried_in', 'left_pending', 'saved_as_template', 'close_kind_set',
                   'close_kind_cleared')
      or (p_action = 'update'
          and coalesce(p_diff -> 'new', '{}'::jsonb) ?| array['title', 'notes', 'planned_date', 'custom_fields', 'position'])
    when 'project_item_stages' then
      p_action in ('ticked', 'unticked')
  end, false);
$$;

-- 6. Tasks: Hold and Resume (WORKFLOWS §3.1a) --------------------------------------------------------------------
create function public.task_hold(task_id uuid, reason text)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller public.members;
  v_task public.tasks;
  v_reason text := nullif(btrim(coalesce(task_hold.reason, '')), '');
  v_creator public.members;
begin
  select m.* into v_caller from app.current_member() m;
  if v_caller.id is null then
    perform app.fail('UNAUTHENTICATED', 'Your account is not active.');
  end if;
  v_task := app.task_lock(task_hold.task_id, v_caller.org_id);
  -- Scope, then permission: a task the caller cannot see does not exist for them.
  if not app.task_visible(v_task.id) then
    perform app.fail('NOT_FOUND', 'This task does not exist.');
  end if;
  -- The task's creator (holding tasks.create: the Owner or an Admin) or the Owner (owner 2026-10-23).
  if not (app.is_owner() or (v_task.created_by = v_caller.id and app.has_permission('tasks.create'))) then
    perform app.fail('FORBIDDEN', 'Only the task''s creator or the Owner can put it on hold.');
  end if;
  if v_task.held_at is not null then
    perform app.fail('INVALID_STATE', 'This task is already on hold.');
  end if;
  if v_task.state in ('completed', 'cancelled') then
    perform app.fail('INVALID_STATE', format('This task is %s, so it can''t be put on hold.', v_task.state));
  end if;
  if v_task.state in ('submitted', 'admin_approved') then
    perform app.fail('INVALID_STATE', 'This task has been handed in and waits for approval, so it can''t be put on hold.');
  end if;
  if v_reason is null then
    perform app.fail('REASON_REQUIRED', 'Say why the task is on hold.');
  end if;
  if length(v_reason) > 1000 then
    perform app.fail('VALIDATION', 'Keep the reason under 1000 characters.');
  end if;

  perform set_config('app.audit_override', jsonb_build_object(
    'action', 'held', 'meta', jsonb_build_object('reason', v_reason, 'state', v_task.state))::text, true);
  update public.tasks set held_at = now(), held_by = v_caller.id, hold_reason = v_reason where id = v_task.id;

  -- WORKFLOWS §9 "Task put on hold": the assignees, quietly (a freelancer's to their coordinator), and the
  -- creator when the Owner holds an Admin's task; an Admin holding their own tells nobody else.
  select m.* into v_creator from public.members m where m.id = v_task.created_by;
  perform app.notify(
    app.task_people(v_task.id, false)
      || case when app.is_owner() and v_creator.role = 'admin' then array[v_creator.id] else '{}'::uuid[] end,
    'task_held', format('%s put %s on hold', v_caller.full_name, v_task.title), v_reason,
    '/tasks/' || v_task.id, 'tasks', v_task.id, jsonb_build_object('task_id', v_task.id), v_caller.id);
  return now();
end;
$$;
comment on function public.task_hold(uuid, text) is
  'v1.9 W7 (WORKFLOWS §3.1a, ADR-0016): the task''s creator (tasks.create) or the Owner puts a task with its '
  'people (to do, in progress, changes requested) On hold with a reason (REASON_REQUIRED, ≤ 1000). A task '
  'the caller cannot see NOT_FOUND; anyone else who sees it FORBIDDEN; held already, handed in, completed '
  'or cancelled INVALID_STATE. The state stays; reminders and escalations stop (the reminders trigger); '
  'audited ''held'' (meta reason, state). Notifies the assignees (task_held) and, when the Owner holds an '
  'Admin''s task, its creator. Returns held_at.';
revoke all on function public.task_hold(uuid, text) from public, anon;
grant execute on function public.task_hold(uuid, text) to authenticated, service_role;

create function public.task_resume(task_id uuid, new_due_at timestamptz default null)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller public.members;
  v_task public.tasks;
  v_creator public.members;
  v_due timestamptz;
  v_passed boolean;
begin
  select m.* into v_caller from app.current_member() m;
  if v_caller.id is null then
    perform app.fail('UNAUTHENTICATED', 'Your account is not active.');
  end if;
  v_task := app.task_lock(task_resume.task_id, v_caller.org_id);
  if not app.task_visible(v_task.id) then
    perform app.fail('NOT_FOUND', 'This task does not exist.');
  end if;
  if not (app.is_owner() or (v_task.created_by = v_caller.id and app.has_permission('tasks.create'))) then
    perform app.fail('FORBIDDEN', 'Only the task''s creator or the Owner can resume it.');
  end if;
  if v_task.held_at is null then
    perform app.fail('INVALID_STATE', 'This task is not on hold.');
  end if;
  -- The deadline passed while it was held: a new one is required (owner 2026-10-23); otherwise it simply
  -- resumes (a new one may still be given). A new deadline is in the future.
  v_passed := v_task.due_at <= now();
  if v_passed and task_resume.new_due_at is null then
    perform app.fail('VALIDATION', format('The deadline (%s) has passed: set a new one.', app.notify_when(v_task.due_at)));
  end if;
  if task_resume.new_due_at is not null and task_resume.new_due_at <= now() then
    perform app.fail('VALIDATION', 'Choose a new deadline in the future.');
  end if;
  v_due := coalesce(task_resume.new_due_at, v_task.due_at);

  -- One history entry: the hold it ends (reason, since when, by whom) and, in its diff, the old and new
  -- deadline (invariant 9).
  perform set_config('app.audit_override', jsonb_build_object(
    'action', 'resumed', 'meta', jsonb_build_object(
      'reason', v_task.hold_reason, 'held_at', v_task.held_at, 'held_by', v_task.held_by,
      'deadline_passed', v_passed))::text, true);
  update public.tasks
  set held_at = null, held_by = null, hold_reason = null, resumed_at = now(), due_at = v_due
  where id = v_task.id;

  select m.* into v_creator from public.members m where m.id = v_task.created_by;
  perform app.notify(
    app.task_people(v_task.id, false)
      || case when app.is_owner() and v_creator.role = 'admin' then array[v_creator.id] else '{}'::uuid[] end,
    'task_resumed', format('%s resumed %s', v_caller.full_name, v_task.title),
    case when v_due is distinct from v_task.due_at then 'New deadline: ' || app.notify_when(v_due) || '.'
         else 'Due ' || app.notify_when(v_due) || '.' end,
    '/tasks/' || v_task.id, 'tasks', v_task.id, jsonb_build_object('task_id', v_task.id), v_caller.id);
  return v_due;
end;
$$;
comment on function public.task_resume(uuid, timestamptz) is
  'v1.9 W7 (WORKFLOWS §3.1a): the task''s creator (tasks.create) or the Owner resumes a held task. When its '
  'deadline has passed, new_due_at is required (VALIDATION); a new deadline is in the future. The state is '
  'the one it had; the reminders are armed again from the deadline in force and the acknowledgement clock '
  'counts from now (resumed_at). Audited ''resumed'' (meta reason, held_at, held_by, deadline_passed; the '
  'diff holds the old and new deadline). Notifies as task_hold (task_resumed). Returns the deadline.';
revoke all on function public.task_resume(uuid, timestamptz) from public, anon;
grant execute on function public.task_resume(uuid, timestamptz) to authenticated, service_role;

-- 7. Projects: Hold, the resume list and Resume (WORKFLOWS §5.5) --------------------------------------------------
create function public.project_hold(project_id uuid, reason text)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller public.members;
  v_project public.projects;
  v_client public.clients;
  v_reason text := nullif(btrim(coalesce(project_hold.reason, '')), '');
begin
  v_caller := app.client_work_caller('projects.complete', 'You cannot put projects on hold.');
  v_project := app.project_lock(project_hold.project_id);
  perform app.project_check_writable(v_project);
  if v_project.held_at is not null then
    perform app.fail('INVALID_STATE', 'This project is already on hold.');
  end if;
  if v_reason is null then
    perform app.fail('REASON_REQUIRED', 'Say why the project is on hold.');
  end if;
  if length(v_reason) > 1000 then
    perform app.fail('VALIDATION', 'Keep the reason under 1000 characters.');
  end if;

  perform set_config('app.audit_override', jsonb_build_object(
    'action', 'held', 'meta', jsonb_build_object('reason', v_reason))::text, true);
  update public.projects set held_at = now(), held_by = v_caller.id, hold_reason = v_reason
  where id = v_project.id;

  -- WORKFLOWS §9 "Project put on hold": the Owner's hold tells the client's Admin; an Admin's own tells
  -- nobody.
  v_client := app.project_client(v_project);
  if v_caller.role = 'owner' then
    perform app.notify(array[v_client.admin_id], 'project_held',
      format('%s put %s on hold', v_caller.full_name, v_project.name),
      format('%s. Reason: %s', v_client.name, v_reason),
      app.project_link(v_project), 'projects', v_project.id,
      jsonb_build_object('project_id', v_project.id, 'client_id', v_project.client_id), v_caller.id);
  end if;
  return now();
end;
$$;
comment on function public.project_hold(uuid, text) is
  'v1.9 W7 (WORKFLOWS §5.5, ADR-0016): projects.complete on the caller''s clients (the Owner any, the '
  'client''s Admin theirs; another Admin NOT_FOUND, Crew FORBIDDEN) puts an open or in-progress project On '
  'hold with a reason (REASON_REQUIRED, ≤ 1000; held already, completed or cancelled INVALID_STATE). While '
  'held: no new cycle, no cycle-ready notice, E1-E3 or end-of-cycle prompt, no tick, Mark done or carry '
  'decision (app.on_hold_guard). Audited ''held''. The Owner''s hold notifies the client''s Admin '
  '(project_held); an Admin''s notifies nobody. Returns held_at.';
revoke all on function public.project_hold(uuid, text) from public, anon;
grant execute on function public.project_hold(uuid, text) to authenticated, service_role;

-- What a resume must settle: every open deliverable of an ended month (a choice) and every other open
-- deliverable whose planned date has passed (a new date). One rule, read by the list and the resume.
create function app.project_resume_items(p_project_id uuid, p_today date)
returns table (item_id uuid, cycle_id uuid, cycle_label text, period_end date, title text, planned_date date,
               month_ended boolean, date_passed boolean, left_pending boolean, item_position text,
               period_start date)
language sql
stable
security definer
set search_path = ''
as $$
  select i.id, c.id, c.label, c.period_end, i.title, i.planned_date,
         coalesce(c.period_end < p_today, false),
         coalesce(i.planned_date < p_today, false),
         coalesce(i.carry_decision = 'leave_pending', false),
         i.position, c.period_start
  from public.project_items i
  join public.project_cycles c on c.id = i.cycle_id
  where i.project_id = p_project_id and i.state = 'open'
    and (c.period_end < p_today or i.planned_date < p_today);
$$;
comment on function app.project_resume_items(uuid, date) is
  'Internal (v1.9 W7): the open deliverables a project''s resume settles on an IST date: those of an ended '
  'cycle (month_ended: carry forward, close or leave pending) and those planned before the date '
  '(date_passed: a new date, unless carried or closed). Read by project_resume_list and project_resume.';
revoke all on function app.project_resume_items(uuid, date) from public, authenticated;
grant execute on function app.project_resume_items(uuid, date) to service_role;

create function public.project_resume_list(project_id uuid)
returns table (item_id uuid, cycle_id uuid, cycle_label text, period_end date, title text, planned_date date,
               month_ended boolean, needs_date boolean, needs_choice boolean, left_pending boolean,
               carry_forward_allowed boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_caller public.members;
  v_project public.projects;
  v_client public.clients;
  v_today date := app.today_ist();
begin
  v_caller := app.client_work_caller('projects.complete', 'You cannot resume projects.');
  select p.* into v_project from public.projects p
  where p.id = project_resume_list.project_id and p.org_id = v_caller.org_id;
  if v_project.id is null or not app.client_visible(v_project.client_id) then
    perform app.fail('NOT_FOUND', 'This project is not one of yours.');
  end if;
  v_client := app.project_client(v_project);
  return query
    select r.item_id, r.cycle_id, r.cycle_label, r.period_end, r.title, r.planned_date, r.month_ended,
           r.date_passed and not r.month_ended,
           r.month_ended,
           r.left_pending,
           r.month_ended and v_client.state <> 'inactive'
    from app.project_resume_items(v_project.id, v_today) r
    order by r.period_start nulls last, r.planned_date nulls last, r.item_position collate "C", r.item_id;
end;
$$;
comment on function public.project_resume_list(uuid) is
  'v1.9 W7 (WORKFLOWS §5.5): the resume sheet''s list, for projects.complete on the caller''s clients '
  '(another Admin NOT_FOUND, Crew FORBIDDEN): the open deliverables a resume must settle today (IST), '
  'oldest cycle first. needs_date: planned before today in a running (or one-time) cycle, a new date '
  'required; needs_choice: its month (or week) has ended, carry forward / close / leave pending required '
  '(leave pending with a passed date needs a new date too); carry_forward_allowed false on an Inactive '
  'client. Read only; never an amount.';
revoke all on function public.project_resume_list(uuid) from public, anon;
grant execute on function public.project_resume_list(uuid) to authenticated, service_role;

create function public.project_resume(project_id uuid, items jsonb default '[]'::jsonb,
                                      new_delivery_date date default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller public.members;
  v_project public.projects;
  v_client public.clients;
  v_today date := app.today_ist();
  v_items jsonb := coalesce(project_resume.items, '[]'::jsonb);
  v_map jsonb := '{}'::jsonb;
  v_el jsonb;
  v_e jsonb;
  v_id uuid;
  v_date date;
  v_decision text;
  v_key text;
  v_row record;
  v_group record;
  v_res jsonb;
  v_bad jsonb;
  v_x jsonb;
  v_dates integer := 0;
  v_carried integer := 0;
  v_closed integer := 0;
  v_pending integer := 0;
begin
  v_caller := app.client_work_caller('projects.complete', 'You cannot resume projects.');
  v_project := app.project_lock(project_resume.project_id);
  if v_project.held_at is null then
    perform app.fail('INVALID_STATE', 'This project is not on hold.');
  end if;
  if jsonb_typeof(v_items) <> 'array' then
    perform app.fail('VALIDATION', 'Send the deliverables as a list.');
  end if;
  if jsonb_array_length(v_items) > 500 then
    perform app.fail('VALIDATION', 'A resume settles at most 500 deliverables.');
  end if;

  -- The entries: {item_id, planned_date?, decision?, reason?, close_kind?}, each deliverable once.
  for v_el in select e from jsonb_array_elements(v_items) e loop
    if jsonb_typeof(v_el) <> 'object' then
      perform app.fail('VALIDATION', 'Each deliverable is an object with its id.');
    end if;
    begin
      v_id := (v_el ->> 'item_id')::uuid;
      v_date := (v_el ->> 'planned_date')::date;
    exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow then
      perform app.fail('VALIDATION', 'Each deliverable needs its id, and a date like 2026-11-04.');
    end;
    if v_id is null then
      perform app.fail('VALIDATION', 'Each deliverable needs its id.');
    end if;
    if v_map ? v_id::text then
      perform app.fail('VALIDATION', 'A deliverable is listed twice.');
    end if;
    v_decision := nullif(btrim(coalesce(v_el ->> 'decision', '')), '');
    if v_decision is not null and v_decision not in ('carry_forward', 'close', 'leave_pending') then
      perform app.fail('VALIDATION', 'Choose carry forward, close or leave pending.');
    end if;
    v_map := v_map || jsonb_build_object(v_id::text, jsonb_build_object(
      'planned_date', v_date, 'decision', v_decision,
      'reason', nullif(btrim(coalesce(v_el ->> 'reason', '')), ''),
      'close_kind', nullif(btrim(coalesce(v_el ->> 'close_kind', '')), '')));
  end loop;

  -- Only the deliverables the resume settles take an entry.
  for v_key in select jsonb_object_keys(v_map) loop
    if not exists (select 1 from app.project_resume_items(v_project.id, v_today) r where r.item_id = v_key::uuid) then
      perform app.fail('VALIDATION', 'Only the deliverables listed for the resume take a new date or a choice.');
    end if;
  end loop;

  -- Every one of them is settled: the transaction never resumes with a passed date or an ended month left
  -- undecided (owner 2026-10-29).
  for v_row in
    select r.* from app.project_resume_items(v_project.id, v_today) r
    order by r.period_start nulls last, r.planned_date nulls last, r.item_position collate "C", r.item_id
  loop
    v_e := coalesce(v_map -> v_row.item_id::text, '{}'::jsonb);
    v_decision := v_e ->> 'decision';
    v_date := (v_e ->> 'planned_date')::date;
    if v_date is not null and v_date < v_today then
      perform app.fail('VALIDATION', format('%s: choose a date from today on.', v_row.title));
    end if;
    if v_row.month_ended then
      if v_decision is null then
        perform app.fail('VALIDATION', format('%s: %s has ended. Choose carry forward, close or leave pending.',
          v_row.title, v_row.cycle_label));
      end if;
      if v_decision = 'close' then
        if v_date is not null then
          perform app.fail('VALIDATION', format('%s: a closed deliverable takes no new date.', v_row.title));
        end if;
        if v_e ->> 'reason' is null then
          perform app.fail('REASON_REQUIRED', format('Say why %s is closed.', v_row.title));
        end if;
      elsif v_decision = 'leave_pending' and v_row.date_passed and v_date is null then
        perform app.fail('VALIDATION', format('%s was planned for %s: give it a new date.',
          v_row.title, app.notify_date(v_row.planned_date)));
      end if;
    else
      if v_decision is not null then
        perform app.fail('VALIDATION', format('%s: %s has not ended, so it takes a new date only.',
          v_row.title, coalesce(v_row.cycle_label, 'its cycle')));
      end if;
      if v_date is null then
        perform app.fail('VALIDATION', format('%s was planned for %s: give it a new date.',
          v_row.title, app.notify_date(v_row.planned_date)));
      end if;
    end if;
  end loop;
  if project_resume.new_delivery_date is not null then
    if v_project.recurrence <> 'one_time' then
      perform app.fail('VALIDATION', 'Only a one-time project has a delivery date.');
    end if;
    if project_resume.new_delivery_date < v_today then
      perform app.fail('VALIDATION', 'Choose a delivery date from today on.');
    end if;
  end if;

  -- 1. The project resumes: one history entry with the hold it ends; its diff keeps an old and new
  --    delivery date.
  perform set_config('app.audit_override', jsonb_build_object(
    'action', 'resumed', 'meta', jsonb_build_object(
      'reason', v_project.hold_reason, 'held_at', v_project.held_at, 'held_by', v_project.held_by,
      'settled', (select count(*) from jsonb_object_keys(v_map))))::text, true);
  update public.projects
  set held_at = null, held_by = null, hold_reason = null, resumed_at = now(),
      delivery_date = coalesce(project_resume.new_delivery_date, delivery_date)
  where id = v_project.id;

  -- 2. New dates on the running deliverables (each audited with its old and new date).
  for v_row in
    select r.item_id, (v_map -> r.item_id::text ->> 'planned_date')::date as d
    from app.project_resume_items(v_project.id, v_today) r
    where not r.month_ended
    order by r.item_id
  loop
    perform set_config('app.audit_override', jsonb_build_object(
      'action', 'update', 'meta', jsonb_build_object('resumed', true))::text, true);
    update public.project_items set planned_date = v_row.d where id = v_row.item_id;
    v_dates := v_dates + 1;
  end loop;

  -- 3. The ended months' choices, by cycle_carry_decide's own rules (carry forward and leave pending a
  --    cycle at a time, close one at a time with its reason and kind). Any refusal refuses the resume.
  for v_group in
    select r.cycle_id, x.d as decision, array_agg(r.item_id order by r.item_id) as ids
    from app.project_resume_items(v_project.id, v_today) r
    cross join lateral (select v_map -> r.item_id::text ->> 'decision' as d) x
    where r.month_ended and x.d in ('carry_forward', 'leave_pending')
    group by r.cycle_id, x.d
    order by r.cycle_id, x.d
  loop
    v_res := public.cycle_carry_decide(v_group.ids, v_group.decision::public.carry_decision);
    select x into v_bad from jsonb_array_elements(v_res) x where not coalesce((x ->> 'ok')::boolean, false) limit 1;
    if v_bad is not null then
      perform app.fail(v_bad ->> 'code', v_bad ->> 'message');
    end if;
    for v_x in select x from jsonb_array_elements(v_res) x loop
      v_date := (v_map -> (v_x ->> 'id') ->> 'planned_date')::date;
      if v_date is not null then
        perform set_config('app.audit_override', jsonb_build_object(
          'action', 'update', 'meta', jsonb_build_object('resumed', true))::text, true);
        update public.project_items set planned_date = v_date
        where id = case when v_group.decision = 'carry_forward' then (v_x ->> 'new_item_id')::uuid
                        else (v_x ->> 'id')::uuid end;
        v_dates := v_dates + 1;
      end if;
    end loop;
    if v_group.decision = 'carry_forward' then
      v_carried := v_carried + cardinality(v_group.ids);
    else
      v_pending := v_pending + cardinality(v_group.ids);
    end if;
  end loop;
  for v_row in
    select r.item_id from app.project_resume_items(v_project.id, v_today) r
    where r.month_ended and v_map -> r.item_id::text ->> 'decision' = 'close'
    order by r.item_id
  loop
    v_e := v_map -> v_row.item_id::text;
    v_res := public.cycle_carry_decide(array[v_row.item_id], 'close', v_e ->> 'reason', v_e ->> 'close_kind');
    select x into v_bad from jsonb_array_elements(v_res) x where not coalesce((x ->> 'ok')::boolean, false) limit 1;
    if v_bad is not null then
      perform app.fail(v_bad ->> 'code', v_bad ->> 'message');
    end if;
    v_closed := v_closed + 1;
  end loop;

  -- 4. WORKFLOWS §9 "Project resumed": the Owner's resume tells the client's Admin; an Admin's own tells
  --    nobody. (The carry decisions above notify as the carry screen's do.)
  v_client := app.project_client(v_project);
  if v_caller.role = 'owner' then
    perform app.notify(array[v_client.admin_id], 'project_resumed',
      format('%s resumed %s', v_caller.full_name, v_project.name),
      v_client.name || case when v_dates > 0
        then format('. %s %s a new date.', v_dates, case when v_dates = 1 then 'deliverable has' else 'deliverables have' end)
        else '.' end,
      app.project_link(v_project), 'projects', v_project.id,
      jsonb_build_object('project_id', v_project.id, 'client_id', v_project.client_id), v_caller.id);
  end if;
  return jsonb_build_object('resumed_at', now(), 'dates', v_dates, 'carried', v_carried, 'closed', v_closed,
                            'left_pending', v_pending);
end;
$$;
comment on function public.project_resume(uuid, jsonb, date) is
  'v1.9 W7 (WORKFLOWS §5.5): projects.complete on the caller''s clients resumes a held project in one '
  'transaction. items = [{item_id, planned_date?, decision?, reason?, close_kind?}], one per deliverable of '
  'project_resume_list and nothing else (VALIDATION): a running cycle''s deliverable planned before today '
  'takes a new date (from today on); an ended cycle''s open deliverable takes carry_forward (an optional '
  'date for the new deliverable), close (reason required, an optional close kind) or leave_pending (a new '
  'date when its date passed), done by cycle_carry_decide''s rules (any refusal refuses the resume). A '
  'resume leaving any of them out is refused. new_delivery_date optionally moves a one-time project''s '
  'delivery date (from today on). Audited ''resumed'' (meta: the hold''s reason, held_at, held_by), each new '
  'date an update. The Owner''s resume notifies the client''s Admin (project_resumed). Returns {resumed_at, '
  'dates, carried, closed, left_pending}.';
revoke all on function public.project_resume(uuid, jsonb, date) from public, anon;
grant execute on function public.project_resume(uuid, jsonb, date) to authenticated, service_role;

-- 8. The reports' count: "On hold · n deliverables" (no money, never Crew) --------------------------------------------
create function public.client_work_on_hold(from_date date default null, to_date date default null)
returns table (client_id uuid, project_id uuid, held_at timestamptz, held_by uuid, hold_reason text,
               deliverables integer)
language sql
stable
security invoker
set search_path = ''
as $$
  select p.client_id, p.id, p.held_at, p.held_by, p.hold_reason,
         (count(i.id) filter (where i.state in ('open', 'done')))::integer
  from public.projects p
  left join public.project_cycles c on c.project_id = p.id
    and (c.period_start is null
         or ((from_date is null or c.period_end >= from_date) and (to_date is null or c.period_start <= to_date)))
  left join public.project_items i on i.cycle_id = c.id
  where p.held_at is not null
  group by p.client_id, p.id, p.held_at, p.held_by, p.hold_reason;
$$;
comment on function public.client_work_on_hold(date, date) is
  'v1.9 W7 (WORKFLOWS §5.5; the Owner''s reports'' "On hold · n deliverables"): every held project the caller '
  'sees (security invoker, RLS: the Owner every client, an Admin their own, Crew none) with its unfinished '
  'deliverables (open or done) in the cycles overlapping from_date..to_date (a one-time cycle always; '
  'no bounds: every cycle). Neither earned nor lost: revenue still counts only what is done (invariant 3). '
  'A count, never an amount.';
revoke all on function public.client_work_on_hold(date, date) from public, anon, service_role;
grant execute on function public.client_work_on_hold(date, date) to authenticated;
