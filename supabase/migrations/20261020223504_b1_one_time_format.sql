-- B1 (UX review 2026-10-21, v1.8 unit V0): one time format everywhere, `6:00 pm` (lower-case,
-- 12-hour, IST), the same as `core/time`'s formatTime / formatWallTime. EXPAND-ONLY: two new
-- helpers, and `create or replace` of the four functions that wrote a time into a notification
-- body or a message (bodies already sent keep their words: history is never rewritten).
--   app.notify_when       `19 Oct, 18:00` -> `19 Oct, 6:00 pm` (every "due …" body)
--   app.end_day_reminder  "Started at 21:51" -> "Started at 9:51 pm"
--   public.attendance_end_day  the cutoff refusal "until 05:00" -> "until 5:00 am"
--   public.task_remind    the rate-limit refusal "at 4:05 PM" -> "at 4:05 pm"
-- Each body below is the latest definition copied unchanged except for the time.

-- `6:00 pm`: an instant's IST time of day.
create or replace function app.ist_time(t timestamptz)
returns text
language sql
immutable
parallel safe
strict
set search_path = ''
as $$
  select lower(to_char(t at time zone 'Asia/Kolkata', 'FMHH12:MI AM'));
$$;

comment on function app.ist_time(timestamptz) is
  'B1: an instant''s IST time of day as MaxOff shows every time, `6:00 pm` (core/time formatTime).';

-- `5:00 am`: a stored wall-clock time (a settings cutoff or reminder time).
create or replace function app.wall_time(t time)
returns text
language sql
immutable
parallel safe
strict
set search_path = ''
as $$
  select lower(to_char(t, 'FMHH12:MI AM'));
$$;

comment on function app.wall_time(time) is
  'B1: a wall-clock time as MaxOff shows every time, `5:00 am` (core/time formatWallTime).';

create or replace function app.notify_when(t timestamptz)
returns text
language sql
immutable
parallel safe
strict
set search_path = ''
as $$
  select to_char(t at time zone 'Asia/Kolkata', 'FMDD Mon') || ', ' || app.ist_time(t);
$$;

-- Same reach as app.notify_when: the security-definer functions use them, no API role calls them.
revoke all on function app.ist_time(timestamptz), app.wall_time(time) from public, authenticated;
grant execute on function app.ist_time(timestamptz), app.wall_time(time) to service_role;

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
  -- The org's own time (org_settings.logout_reminder_time, default 20:30 IST). pg_cron runs this
  -- every 5 minutes all day; a run sends only when the IST time is within [time, time + 5 min),
  -- so the reminder goes out at its time and never at the first run of some later window
  -- (5.1 review S1). Each day is reminded once per person (the notifications row is the record).
  for v_row in
    select d.member_id, d.day_id, d.started_at, m.org_id, m.role
    from app.end_day_reminder_due(p_at) d
    join public.members m on m.id = d.member_id
    join public.org_settings s on s.org_id = m.org_id
    where (p_at at time zone 'Asia/Kolkata')::time >= s.logout_reminder_time
      and (p_at at time zone 'Asia/Kolkata')::time < s.logout_reminder_time + interval '5 minutes'
      and not exists (
        select 1 from public.notifications n
        where n.recipient_id = d.member_id and n.kind = 'end_day_reminder'
          and n.entity = 'attendance_days' and n.entity_id = d.day_id)
    order by d.member_id
  loop
    v_n := v_n + app.notify(array[v_row.member_id], 'end_day_reminder',
      'You haven''t ended your day',
      format('Started at %s. If you''re done, end it; if you''re working late, carry on.',
             app.ist_time(v_row.started_at)),
      case when v_row.role = 'admin' then '/today' else '/my-day' end,
      'attendance_days', v_row.day_id, jsonb_build_object('day_id', v_row.day_id), null);
  end loop;
  return v_n;
end;
$$;


create or replace function public.attendance_end_day(overtime_note text default null, overtime_minutes integer default null)
returns table (day_id uuid, work_date date, note_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_caller uuid;
  v_org uuid;
  v_today date := app.today_ist();
  v_day public.attendance_days;
  v_note_id uuid;
  v_cutoff time;
begin
  select r.caller_id, r.org_id into v_caller, v_org from app.attendance_require_self() r;

  perform pg_advisory_xact_lock(hashtext('leave:' || v_caller::text));

  select d.* into v_day
  from public.attendance_days d
  where d.member_id = v_caller and d.work_date = v_today and d.started_at is not null and d.ended_at is null
  for update;
  if v_day.id is null then
    -- Today started (ended or not): yesterday is never ended from here. Checked before yesterday,
    -- or a second tap (another device, a stale tab) would write a false end onto an open yesterday.
    if exists (select 1 from public.attendance_days d
               where d.member_id = v_caller and d.work_date = v_today and d.started_at is not null) then
      perform app.fail('INVALID_STATE', 'Your day has already ended.');
    end if;
    -- Worked past midnight: the end belongs to yesterday's day, a real time, never made up.
    select d.* into v_day
    from public.attendance_days d
    where d.member_id = v_caller and d.work_date = v_today - 1 and d.started_at is not null and d.ended_at is null
    for update;
    -- 3b review: only until the cutoff (05:00 IST by default). After it, yesterday stays "End of
    -- day not recorded" and late work goes in an overtime note.
    if v_day.id is not null then
      v_cutoff := app.end_day_cutoff(v_org);
      if not app.end_day_late_allowed(now(), v_cutoff) then
        perform app.fail('INVALID_STATE', format(
          'Yesterday''s day can be ended only until %s. It stays "End of day not recorded"; add an overtime note for the late work.',
          app.wall_time(v_cutoff)));
      end if;
    end if;
  end if;
  if v_day.id is null then
    if exists (select 1 from public.attendance_days d
               where d.member_id = v_caller and d.work_date = v_today and d.ended_at is not null) then
      perform app.fail('INVALID_STATE', 'Your day has already ended.');
    end if;
    perform app.fail('INVALID_STATE', 'Start your day first.');
  end if;

  -- Only the end moves: state, final_status and the Owner's decision are never touched. An end is
  -- recorded now, so the 00:00 job's flag no longer holds (the 2.5 rule for a late logout).
  perform set_config('app.audit_override', jsonb_build_object('action', 'ended')::text, true);
  update public.attendance_days set ended_at = now(), end_not_recorded = false where id = v_day.id;
  perform app.attendance_event(v_day.id, 'ended', null, null, null, v_caller);

  -- The confirmation's optional overtime note (PRODUCT §4.2, 3b.2), on the day that just ended.
  if app.clean_reason(overtime_note) is not null then
    v_note_id := public.extra_work_note_submit('overtime', v_day.work_date, overtime_note, overtime_minutes);
  end if;

  return query select v_day.id, v_day.work_date, v_note_id;
end;
$$;


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

