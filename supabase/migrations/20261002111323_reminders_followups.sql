-- 5.3 follow-ups (owner, 2026-10-02). Expand-only: functions re-created or added, nothing else.
--
-- 1. reminders_tick re-created:
--    * the not-noted escalation names people in a fixed order (by name, then id): a message whose
--      wording changed between runs was a defect;
--    * the end-day reminder runs first, in its own savepoint, so nothing in the task reminders can
--      cost it (it was a cron job of its own until migration task_reminders folded it in; same
--      function, same 5-minute schedule, same window [logout_reminder_time, +5 min), same
--      recipients, and its notification row is still the record that stops a second one);
--    * acknowledgement repeats and the not-noted escalations count from greatest(assigned_at,
--      armed_at): for a task created after 5.3 that is the assignment; for a task armed by the
--      backfill below it is the backfill, so no old task repeats or escalates on release day.
-- 2. app.reminders_backfill(p_now, p_dry_run): the owner's decision of 2026-10-02 (PROGRESS): arm
--    the tasks that are open when the release ships (todo, in_progress, changes_requested; never
--    submitted, admin-approved, completed, cancelled or archived) and not armed yet. Only reminders
--    still ahead are created (app.task_arm_reminders skips the past); for a task already overdue
--    the overdue escalation counts from the backfill (p_now + overdue_escalate_hours); idempotent
--    (a task is armed once, so a second run arms nothing). **Not run by any migration:** it runs
--    once, at the release, on the owner's word. A dry run (the default) returns the counts and
--    rolls everything back.

-- 1. The tick ---------------------------------------------------------------------------------------
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

  -- 0. The end-day reminder first, in its own savepoint: it was a job of its own until 5.3, and a
  --    failure in the task reminders below must never cost it (nor it them).
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
      array_agg(a.member_id order by m.full_name, a.member_id) as members,
      min(greatest(a.assigned_at, arm.armed_at)) as since
    from public.task_assignees a
    join public.tasks t on t.id = a.task_id
    join public.task_reminder_arms arm on arm.task_id = t.id
    join public.org_settings s on s.org_id = t.org_id
    join public.members m on m.id = a.member_id and m.status = 'active'
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
  end loop;

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

-- 2. The backfill -----------------------------------------------------------------------------------
create or replace function app.reminders_backfill(p_now timestamptz default now(), p_dry_run boolean default true)
returns table (tasks integer, reminders integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_task record;
  v_tasks integer := 0;
  v_reminders integer := 0;
begin
  perform pg_advisory_xact_lock(hashtext('app.reminders_backfill'));
  begin
    for v_task in
      select t.id, t.org_id, t.due_at, s.overdue_escalate_hours
      from public.tasks t
      join public.org_settings s on s.org_id = t.org_id
      where t.state in ('todo', 'in_progress', 'changes_requested') and t.archived_at is null
        and not exists (select 1 from public.task_reminder_arms a where a.task_id = t.id)
      order by t.created_at, t.id
    loop
      insert into public.task_reminder_arms (task_id, armed_at) values (v_task.id, p_now);
      perform app.task_arm_reminders(v_task.id, p_now);
      if v_task.due_at <= p_now then
        -- Already overdue: the escalation counts from the backfill, not from the deadline.
        update public.task_reminders set cancelled_at = p_now
        where task_id = v_task.id and kind = 'overdue_escalation' and sent_at is null and cancelled_at is null;
        insert into public.task_reminders (org_id, task_id, kind, deadline, fire_at)
        values (v_task.org_id, v_task.id, 'overdue_escalation', v_task.due_at,
                p_now + make_interval(hours => coalesce(v_task.overdue_escalate_hours, 24)));
      end if;
      v_tasks := v_tasks + 1;
      v_reminders := v_reminders + (select count(*)::integer from public.task_reminders r
        where r.task_id = v_task.id and r.sent_at is null and r.cancelled_at is null);
    end loop;
    if p_dry_run then
      raise exception using errcode = 'MX001', message = 'reminders_backfill dry run';
    end if;
  exception when sqlstate 'MX001' then
    -- The dry run: everything above is rolled back; the counts are what a real run would make.
    null;
  end;
  return query select v_tasks, v_reminders;
end;
$$;
comment on function app.reminders_backfill(timestamptz, boolean) is
  '5.3 (owner, 2026-10-02), service_role only, run once at the release on the owner''s word, never by '
  'a migration: arms the open tasks (todo, in_progress, changes_requested; not archived) that are not '
  'armed yet, with only the reminders still ahead; an already overdue task''s escalation counts from '
  'p_now; acknowledgement repeats and escalations count from p_now (armed_at). Idempotent. p_dry_run '
  '(the default) returns the counts (tasks, reminders) and rolls back.';
revoke all on function app.reminders_backfill(timestamptz, boolean) from public, authenticated;
grant execute on function app.reminders_backfill(timestamptz, boolean) to service_role;
