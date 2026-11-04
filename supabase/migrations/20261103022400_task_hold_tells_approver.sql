-- v1.9 (owner 2026-11-03, W7 Q2): a held or resumed task's approving Admin is TOLD (the quiet task_held /
-- task_resumed notice), but still cannot hold or resume it (the creator with tasks.create and the Owner
-- only, unchanged). Expand-only: task_hold and task_resume re-created from their latest definitions
-- (20261102171704_on_hold), the only change being the approving Admin added to the recipients;
-- app.notify drops the actor, a null and a person already named (no duplicate when the approver is also
-- the creator). WORKFLOWS §3.1a and §9.

create or replace function public.task_hold(task_id uuid, reason text)
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

  -- WORKFLOWS §9 "Task put on hold": the assignees, quietly (a freelancer's to their coordinator), the
  -- creator when the Owner holds an Admin's task, and the task's approving Admin (owner 2026-11-03: told,
  -- never able to hold). app.notify skips the actor, a null and anyone already named.
  select m.* into v_creator from public.members m where m.id = v_task.created_by;
  perform app.notify(
    app.task_people(v_task.id, false)
      || case when app.is_owner() and v_creator.role = 'admin' then array[v_creator.id] else '{}'::uuid[] end
      || v_task.approving_admin_id,
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
  'audited ''held'' (meta reason, state). Notifies the assignees (task_held), its approving Admin (told, '
  'never able to hold: owner 2026-11-03) and, when the Owner holds an Admin''s task, its creator; never the '
  'actor. Returns held_at.';
revoke all on function public.task_hold(uuid, text) from public, anon;
grant execute on function public.task_hold(uuid, text) to authenticated, service_role;

create or replace function public.task_resume(task_id uuid, new_due_at timestamptz default null)
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

  -- As the hold: the assignees, the creator when the Owner resumes an Admin's task, the approving Admin.
  select m.* into v_creator from public.members m where m.id = v_task.created_by;
  perform app.notify(
    app.task_people(v_task.id, false)
      || case when app.is_owner() and v_creator.role = 'admin' then array[v_creator.id] else '{}'::uuid[] end
      || v_task.approving_admin_id,
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
