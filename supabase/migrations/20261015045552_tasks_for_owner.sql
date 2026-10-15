-- 6b.2 Tasks for the Owner (owner request and decision 2026-10-07; ROADMAP 6b.2, v1.7.1;
-- WORKFLOWS §3.1 "Tasks for the Owner", §9; PERMISSIONS §3; DATA-MODEL §6). Expand-only: no table
-- or column changes; functions re-created with the same names, arguments, results and grants; one
-- function (task_remind), one trigger (tasks_reminders_primary) and one notification kind
-- (task_asked_about) added. Existing tasks and their rows are untouched: nothing is backfilled.
--
--   1. app.task_assignee_check: the Owner may be an assignee or the primary owner (task_create and
--      task_update_assignment call it, so both accept the Owner; Crew never assign anyone).
--   2. task_submit_done: a task whose primary owner is the Owner completes on Done.
--   3. Escalations never about the Owner: app.task_arm_reminders (no overdue escalation for an
--      Owner-primary task), app.tasks_reminders_trigger + trigger tasks_reminders_primary (re-arm
--      when the primary owner changes), app.reminders_tick (drops a waiting one; section d leaves
--      the Owner out), dashboard_not_noted() (the Owner's risk rows agree).
--   4. member_availability(): the Owner too (busy blocks and open tasks; leave and present null),
--      so an Admin sees the Owner's shoots as Busy and the dialog warns about the Owner's load.
--   5. task_remind(task_id) and its notification kind task_asked_about.

-- 1. The Owner may be an assignee ---------------------------------------------------------------------
create or replace function app.task_assignee_check(p_org uuid, p_member_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.members;
begin
  select m.* into v from public.members m where m.id = p_member_id and m.org_id = p_org;
  if v.id is null then
    perform app.fail('NOT_FOUND', 'This person is not on the team.');
  end if;
  if v.status <> 'active' then
    perform app.fail('VALIDATION', format('%s is not active and cannot be assigned.', v.full_name));
  end if;
end;
$$;
revoke all on function app.task_assignee_check(uuid, uuid) from public, authenticated;
grant execute on function app.task_assignee_check(uuid, uuid) to service_role;

comment on function app.task_assignee_check(uuid, uuid) is
  'Internal (4A; 6b.2): NOT_FOUND / VALIDATION unless the member is an active member of the '
  'organization: an Admin, Staff, a freelancer or, since 6b.2 (owner 2026-10-07), the Owner.';

-- 2. Done completes an Owner-primary task -------------------------------------------------------------
create or replace function public.task_submit_done(
  task_id uuid, note text default null, late_reason text default null, on_behalf_of uuid default null)
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

  -- 6b.2 (owner 2026-10-07): a task whose primary owner is the Owner completes on Done. Final
  -- completion is always the Owner's, and here the Owner did the work: no Admin check, no review
  -- row (nobody reviewed it). The audit entry is "completed", meta.step owner_done.
  if v_task.primary_owner_id = app.org_owner_id(v_org) then
    v_step := case when v_task.approving_admin_id is null then 'none' else 'skipped' end;
    perform set_config('app.audit_override', jsonb_build_object(
      'action', 'completed',
      'meta', jsonb_build_object('step', 'owner_done', 'version', v_version, 'late', v_late,
                                 'submission_id', v_submission))::text, true);
    update public.tasks
    set state = 'completed', admin_step = v_step, submitted_at = now(), submitted_by = v_actor,
        submitted_on_behalf_of = null,
        late_reason = case when v_late then v_late_reason else tasks.late_reason end,
        admin_approved_at = null, completed_at = now()
    where id = v_task.id;
    -- WORKFLOWS §9 "Task completed": the assignees and the creator; never the actor (the Owner).
    perform app.notify(app.task_people(v_task.id, true), 'task_completed',
      'Completed: ' || v_task.title,
      format('%s marked it done%s', app.member_name(v_subject), case when v_late then ' (late)' else '' end),
      '/tasks/' || v_task.id, 'tasks', v_task.id,
      jsonb_build_object('task_id', v_task.id, 'version', v_version), v_actor);
    return 'completed'::public.task_state;
  end if;

  -- The route (PRODUCT §4.6): the Admin step is required, none (no approver) or skipped (the
  -- approver is on the task: an assignee, or the coordinator of a freelancer on it, decision 34;
  -- the reason lives only in the activity log).
  if v_task.approving_admin_id is null then
    v_state := 'admin_approved'; v_step := 'none';
    v_meta := jsonb_build_object('version', v_version, 'late', v_late, 'admin_step', 'none');
  elsif app.task_approver_on_task(v_task.id, v_task.approving_admin_id) then
    v_state := 'admin_approved'; v_step := 'skipped';
    v_meta := jsonb_build_object('version', v_version, 'late', v_late, 'admin_step', 'skipped',
      'reason', case when app.is_task_assignee(v_task.id, v_task.approving_admin_id)
                     then 'approver_is_assignee' else 'approver_is_coordinator' end);
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

revoke all on function public.task_submit_done(uuid, text, text, uuid) from public, anon;
grant execute on function public.task_submit_done(uuid, text, text, uuid) to authenticated, service_role;

comment on function public.task_submit_done(uuid, text, text, uuid) is
  'tasks.work, the primary owner (or their current coordinator with on_behalf_of, ADR-0013), from '
  'todo / in_progress / changes_requested. Records the primary owner''s acknowledgement if missing '
  '(audit acknowledged, meta.implied), writes the next task_submissions version (the optional note, '
  'links allowed), requires late_reason past due_at (REASON_REQUIRED), then routes: submitted with '
  'admin_step required when an approving Admin exists and is not on the task; otherwise '
  'admin_approved with admin_step none (no approver) or skipped (the approver is an assignee, '
  'meta.reason approver_is_assignee, or the current coordinator of an active freelancer assignee, '
  'meta.reason approver_is_coordinator: Kickoff 4 decision 34). Audit action: submitted. 5.1: '
  'notifies the approving Admin, or the Owner when there is no Admin step (task_submitted) through '
  'app.notify(). 6b.2: when the primary owner is the Owner the task goes straight to completed '
  '(admin_step skipped with an approver, else none; audit completed, meta.step owner_done; no '
  'task_reviews row) and the assignees and creator get task_completed.';

-- 3. Escalations never about the Owner ----------------------------------------------------------------
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
comment on function app.task_arm_reminders(uuid, timestamptz) is
  '5.3, service_role only: (re)arms an armed task''s deadline reminders from its rule list (cancels '
  'what is not sent; skips a time already past and anything already sent for the same deadline); '
  'returns how many are waiting. A completed or cancelled task keeps none. 6b.2: no overdue '
  'escalation when the primary owner is the Owner.';
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
     or new.primary_owner_id is distinct from old.primary_owner_id
     or (new.state in ('completed', 'cancelled')) <> (old.state in ('completed', 'cancelled')) then
    -- Only an armed task (one created after migration task_reminders) is (re)armed.
    perform app.task_arm_reminders(new.id);
  end if;
  return null;
end;
$$;
revoke all on function app.tasks_reminders_trigger() from public, authenticated;
grant execute on function app.tasks_reminders_trigger() to service_role;

-- Re-arm when the primary owner changes (6b.2: the overdue escalation follows who the primary is).
create trigger tasks_reminders_primary after update of primary_owner_id on public.tasks
  for each row when (old.primary_owner_id is distinct from new.primary_owner_id)
  execute function app.tasks_reminders_trigger();

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
    exception when others then
      raise warning 'reminders_tick: section b (a held person) skipped: %', sqlerrm;
    end;
  end loop;

  -- c. Acknowledgement repeats: every ack_repeat_hours after assignment, to whoever has not noted.
  for v_row in
    select a.task_id, a.member_id, greatest(a.assigned_at, arm.armed_at) as since, t.org_id, t.title, s.ack_repeat_hours
    from public.task_assignees a
    join public.tasks t on t.id = a.task_id
    join public.task_reminder_arms arm on arm.task_id = t.id
    join public.org_settings s on s.org_id = t.org_id
    join public.members m on m.id = a.member_id and m.status = 'active'
    where a.removed_at is null and a.acknowledged_at is null
      and t.state not in ('completed', 'cancelled')
      and p_now >= greatest(a.assigned_at, arm.armed_at) + make_interval(hours => s.ack_repeat_hours)
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
      min(greatest(a.assigned_at, arm.armed_at)) as since
    from public.task_assignees a
    join public.tasks t on t.id = a.task_id
    join public.task_reminder_arms arm on arm.task_id = t.id
    join public.org_settings s on s.org_id = t.org_id
    -- 6b.2: never about the Owner (nobody is above the Owner); the Owner's repeats (c) stay.
    join public.members m on m.id = a.member_id and m.status = 'active' and m.role <> 'owner'
    cross join (values (1), (2)) as lvl(level)
    where a.removed_at is null and a.acknowledged_at is null
      and t.state not in ('completed', 'cancelled')
      and p_now >= greatest(a.assigned_at, arm.armed_at) + make_interval(hours =>
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
comment on function app.reminders_tick(timestamptz) is
  '5.3, service_role only, pg_cron every 5 minutes: the end-day reminder first, then the due deadline '
  'reminders of armed tasks (holding a paused person''s before-due / Due now to their next working '
  'day), the held ones back as one message, the acknowledgement repeats and the not-noted '
  'escalations (an escalation is sent late while its condition holds; a reminder whose moment passed over an hour ago is skipped). Each row in a savepoint of its own (phase 5 review): one that fails is logged and '
  'retried next run, never costing the others. Records sent_at so nothing is sent twice. Returns the '
  'rows marked sent at p_now. 6b.2: no escalation is about the Owner (an Owner-primary task''s '
  'overdue escalation is dropped; the Owner is never named in a not-noted escalation).';
revoke all on function app.reminders_tick(timestamptz) from public, authenticated;
grant execute on function app.reminders_tick(timestamptz) to service_role;

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
    select a.task_id, a.member_id, greatest(a.assigned_at, arm.armed_at)
    from public.task_assignees a
    join public.tasks t on t.id = a.task_id
    join public.task_reminder_arms arm on arm.task_id = t.id
    join public.org_settings s on s.org_id = t.org_id
    join public.members m on m.id = a.member_id and m.status = 'active' and m.role <> 'owner'
    where t.org_id = v_me.org_id and t.archived_at is null
      and a.removed_at is null and a.acknowledged_at is null
      and t.state not in ('completed', 'cancelled')
      and now() >= greatest(a.assigned_at, arm.armed_at) + make_interval(hours => s.ack_escalate_owner_hours)
    order by greatest(a.assigned_at, arm.armed_at), a.task_id, a.member_id;
end;
$$;
comment on function public.dashboard_not_noted() is
  '6.2 (Kickoff 6 decision 6, attendance.view_all: the Owner): the active assignees of open, armed '
  'tasks who have not tapped Task Noted for ack_escalate_owner_hours, on 5.3''s clock '
  '(greatest(assigned_at, armed_at), reminders_tick section d''s conditions), so Today''s row and the '
  'Owner''s escalation agree. waiting_since is that clock''s start. Anyone else FORBIDDEN. 6b.2: '
  'never the Owner as an assignee (no escalation is about the Owner).';
revoke all on function public.dashboard_not_noted() from public, anon;
grant execute on function public.dashboard_not_noted() to authenticated, service_role;

-- 4. member_availability(): the Owner too --------------------------------------------------------------
create or replace function public.member_availability(from_date date, to_date date, member_ids uuid[] default null)
returns table (
  member_id uuid, engagement public.engagement, day date,
  open_tasks_due integer, event_blocks jsonb, leave text, present boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_caller uuid;
  v_org uuid;
  v_today date := app.today_ist();
begin
  select m.id, m.org_id into v_caller, v_org from app.current_member() m;
  if v_caller is null then
    perform app.fail('UNAUTHENTICATED', 'Your account is not active.');
  end if;
  if not app.has_permission('availability.view') then
    perform app.fail('FORBIDDEN', 'Only the Owner and Admins see other people''s availability.');
  end if;
  if from_date is null or to_date is null or to_date < from_date then
    perform app.fail('VALIDATION', 'Pick a date range.');
  end if;
  if to_date - from_date > 61 then
    perform app.fail('VALIDATION', 'Ask for two months at most.');
  end if;

  return query
  with people as (
    -- 6b.2: the Owner too (the Owner may be on tasks now): busy blocks and open tasks, never leave.
    select m.id, m.engagement, m.role = 'owner' as is_owner
    from public.members m
    where m.org_id = v_org and m.status = 'active'
      and (member_availability.member_ids is null or m.id = any (member_availability.member_ids))
  ),
  days as (
    select s::date as day from generate_series(from_date, to_date, interval '1 day') s
  ),
  open_tasks as (
    select a.member_id, app.to_ist_date(t.due_at) as day, count(*)::integer as n
    from public.tasks t
    join public.task_assignees a on a.task_id = t.id and a.removed_at is null
    where t.org_id = v_org
      and t.state not in ('completed', 'cancelled')
      and app.to_ist_date(t.due_at) between from_date and to_date
    group by a.member_id, app.to_ist_date(t.due_at)
  ),
  events as (
    select a.member_id, t.event_date as day,
           jsonb_agg(jsonb_build_object(
             'start_at', t.event_start_at,
             'end_at', coalesce(t.event_end_at, t.event_start_at + interval '1 hour'))
             order by t.event_start_at) as blocks
    from public.tasks t
    join public.task_assignees a on a.task_id = t.id and a.removed_at is null
    where t.org_id = v_org
      and t.state not in ('completed', 'cancelled')
      and t.event_start_at is not null
      and t.event_date between from_date and to_date
    group by a.member_id, t.event_date
  )
  select p.id, p.engagement, d.day,
         coalesce(o.n, 0),
         coalesce(e.blocks, '[]'::jsonb),
         case when p.engagement = 'freelance' or p.is_owner then null
              else coalesce(
                (select r.type::text from public.leave_requests r
                 where r.member_id = p.id and r.state = 'approved'
                   and r.start_date <= d.day and r.end_date >= d.day
                 order by r.decided_at desc, r.created_at desc limit 1),
                (select 'requested' from public.leave_requests r
                 where r.member_id = p.id and r.state = 'submitted' and not r.requests_cancellation
                   and r.start_date <= d.day and r.end_date >= d.day limit 1)) end,
         case when d.day = v_today and p.engagement = 'permanent' and not p.is_owner
              then exists (select 1 from public.attendance_days ad
                           where ad.member_id = p.id and ad.work_date = d.day and ad.started_at is not null)
              end
  from people p
  cross join days d
  left join open_tasks o on o.member_id = p.id and o.day = d.day
  left join events e on e.member_id = p.id and e.day = d.day
  order by p.id, d.day;
end;
$$;

revoke all on function public.member_availability(date, date, uuid[]) from public, anon;
grant execute on function public.member_availability(date, date, uuid[]) to authenticated, service_role;

comment on function public.member_availability(date, date, uuid[]) is
  'availability.view (the Owner and Admins; FORBIDDEN otherwise). Read only. One row per active '
  'member, the Owner too since 6b.2 with leave and present null (or the ids given) per IST day of the range (62 days at most): open_tasks_due '
  '(tasks not completed / cancelled due that day), event_blocks ([{start_at, end_at}] of their '
  'timed event tasks that day, no end = one hour; no titles or ids), leave (the approved leave '
  'type covering the day, else requested for a pending request; null for a freelancer), present '
  '(today only, for an employee: a Start day recorded). Counts and busy blocks, never the tasks '
  'themselves (ADR-0004). What the 4.3 assignment warnings are computed from.';

-- 5. Remind ------------------------------------------------------------------------------------------
insert into public.notification_kinds (kind, actionable, always_email, in_app, description) values
  ('task_asked_about', false, false, true, 'Someone who runs the task is asking about it (Remind, 6b.2; the assignees)');

create function public.task_remind(task_id uuid)
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
  if not app.task_manager(v_task.id) then
    perform app.fail('FORBIDDEN', 'Only the task''s creator, its approving Admin or the Owner can send a reminder.');
  end if;
  if v_task.state not in ('todo', 'in_progress', 'changes_requested') then
    perform app.fail('INVALID_STATE', 'A reminder is for a task still with its people.');
  end if;
  -- At most once an hour per task, whoever sent the last one (the task row is locked above, so two
  -- taps never both pass).
  select max(l.at) into v_last from public.activity_log l
  where l.entity = 'tasks' and l.entity_id = v_task.id and l.action = 'reminder_sent';
  if v_last is not null and v_last > now() - interval '1 hour' then
    perform app.fail('RATE_LIMITED', format('A reminder went at %s. You can send another at %s.',
      to_char(v_last at time zone 'Asia/Kolkata', 'FMHH12:MI AM'),
      to_char((v_last + interval '1 hour') at time zone 'Asia/Kolkata', 'FMHH12:MI AM')));
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
revoke all on function public.task_remind(uuid) from public, anon;
grant execute on function public.task_remind(uuid) to authenticated, service_role;

comment on function public.task_remind(uuid) is
  '6b.2 (owner 2026-10-07): Remind, on the task page only. app.task_manager (the creator with '
  'tasks.create, the approving Admin with tasks.approve_admin, the Owner); NOT_FOUND when the caller '
  'cannot see the task, FORBIDDEN otherwise; INVALID_STATE unless todo / in_progress / '
  'changes_requested; RATE_LIMITED within an hour of the task''s last reminder_sent entry; '
  'VALIDATION when nobody but the sender is on it. Writes activity_log (tasks, reminder_sent, '
  'meta.recipients) and notifies every active assignee but the sender (task_asked_about, "<name> is '
  'asking about <task>") through app.notify(). Returns when it can be used again.';
