-- Phase 5 review fixes (2026-10-06; the architecture and security reviews of origin/main...phase-5b).
-- Expand-only: three functions re-created with the same signatures, grants and meaning.
-- 1. app.reminders_tick: each row of its four sections (deadline rows, held people, acknowledgement
--    repeats, not-noted escalations) runs in a savepoint of its own; a row that fails is logged
--    (RAISE WARNING) and left for the next run, and the rest of the run, the end-day reminder
--    included, commits. Before, one failing task rolled back the whole run: on main the end-day
--    reminder was a job of its own, so a bad task row at 20:30 IST would have cost the whole Crew
--    their "You haven't ended your day".
-- 2. app.reminder_resume_at: a quiet-hours window that starts at 00:00 now holds a reminder until
--    its end, as one that crosses midnight did; before, a held always-emailed reminder came back at
--    00:00 IST.
-- 3. public.app_open_report: refuses anyone but an active permanent member, as its comment said.

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
  'escalations. Each row in a savepoint of its own (phase 5 review): one that fails is logged and '
  'retried next run, never costing the others. Records sent_at so nothing is sent twice. Returns the '
  'rows marked sent at p_now.';
revoke all on function app.reminders_tick(timestamptz) from public, authenticated;
grant execute on function app.reminders_tick(timestamptz) to service_role;

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
  -- The quiet hours' end on that day whenever the window covers midnight: one that crosses it, or
  -- one that starts at 00:00 (phase 5 review: a 00:00-07:00 window sent a held email at midnight).
  return app.ist_day_start(v_day)
    + case when v_start > v_end or v_start = time '00:00' then v_end - time '00:00' else interval '0' end;
end;
$$;
revoke all on function app.reminder_resume_at(uuid, uuid, date) from public, authenticated;
grant execute on function app.reminder_resume_at(uuid, uuid, date) to service_role;

create or replace function public.app_open_report(platform text, is_standalone boolean)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me public.members;
  v_changed integer;
begin
  select m.* into v_me from app.current_member() m;
  if v_me.id is null then
    perform app.fail('UNAUTHENTICATED', 'Sign in again.');
  end if;
  -- An active permanent member, as the comment always said (phase 5 review): a freelancer has no
  -- login and is never tracked.
  if v_me.engagement <> 'permanent' then
    perform app.fail('FORBIDDEN', 'Only team members report their device.');
  end if;
  if platform is null or platform not in ('android', 'ios', 'desktop', 'other') or is_standalone is null then
    perform app.fail('VALIDATION', 'Not a device report.');
  end if;
  insert into public.member_app_reports as r (member_id, org_id, platform, is_standalone, reported_at)
  values (v_me.id, v_me.org_id, app_open_report.platform, app_open_report.is_standalone, now())
  on conflict (member_id) do update
    set platform = excluded.platform, is_standalone = excluded.is_standalone, reported_at = excluded.reported_at
    where (r.platform, r.is_standalone) is distinct from (excluded.platform, excluded.is_standalone);
  get diagnostics v_changed = row_count;
  return v_changed > 0;
end;
$$;
revoke all on function public.app_open_report(text, boolean) from public, anon;
grant execute on function public.app_open_report(text, boolean) to authenticated, service_role;
