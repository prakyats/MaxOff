-- Release 2 (v1.7.1) review fixes, 2026-10-16. EXPAND-ONLY (ARCHITECTURE §18): two functions redefined in
-- place with their signatures, grants and every other behaviour kept; no table, column, policy, row or
-- grant changes. The migrations that first made them (20261015045552_tasks_for_owner,
-- 20261015174021_client_work_bulk_and_rounds) are applied and stay untouched.
--
-- 1. public.task_remind(task_id): the permission check now reads app.task_manager(task) AND
--    app.has_permission('tasks.create'), as task_stage_move does since 20261015155412, so the RPC itself
--    says what WORKFLOWS §3.1 "Remind", PERMISSIONS §3 and DATA-MODEL §6 say: the task's creator, its
--    approving Admin and the Owner, each holding tasks.create. app.task_manager already counted a creator
--    only while they hold tasks.create; the explicit key keeps the rule in this function, where a
--    later change to app.task_manager cannot widen it. A creator made Crew is refused (NOT_FOUND when they
--    no longer see the task, FORBIDDEN when they still do as an assignee). NOT_FOUND before FORBIDDEN,
--    the hourly rate limit, the activity row and the notification are unchanged.
-- 2. app.client_work_bulk_items(ids): the projects and then the deliverables of a selection are locked
--    in id order first, then checked and returned in the order given (items_rename numbers them in that
--    order). Two overlapping selections made in opposite orders no longer take the same rows in
--    opposite orders, so they wait for each other instead of deadlocking. The lock order is the one
--    every client-work function keeps (a project before its deliverables, app.item_lock). Only the
--    rows the caller may see are locked up front (their organization, a client they may see), as
--    app.project_lock does; the checks and their errors stay the original's, item by item.

-- 1. task_remind ---------------------------------------------------------------------------------------------
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
  '6b.2 (owner 2026-10-07): Remind, on the task page only. app.task_manager holding tasks.create (the '
  'creator, the approving Admin, the Owner; Release 2 review 2026-10-16, as task_stage_move); NOT_FOUND '
  'when the caller cannot see the task, FORBIDDEN otherwise; INVALID_STATE unless todo / in_progress / '
  'changes_requested; RATE_LIMITED within an hour of the task''s last reminder_sent entry; '
  'VALIDATION when nobody but the sender is on it. Writes activity_log (tasks, reminder_sent, '
  'meta.recipients) and notifies every active assignee but the sender (task_asked_about, "<name> is '
  'asking about <task>") through app.notify(). Returns when it can be used again.';

-- 2. client_work_bulk_items ----------------------------------------------------------------------------------
create or replace function app.client_work_bulk_items(p_ids uuid[])
returns public.project_items[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := (select m.org_id from app.current_member() m);
  v_ids uuid[];
  v_id uuid;
  v_item public.project_items;
  v_project public.projects;
  v_out public.project_items[] := '{}';
begin
  select array_agg(d.id order by d.first) into v_ids
  from (select u.id, min(u.n) as first from unnest(p_ids) with ordinality as u(id, n)
        where u.id is not null group by u.id) d;
  if v_ids is null or cardinality(v_ids) = 0 then
    perform app.fail('VALIDATION', 'Select at least one deliverable.');
  end if;
  if cardinality(v_ids) > 100 then
    perform app.fail('VALIDATION', 'Select at most 100 deliverables at a time.');
  end if;
  -- The locks first, in id order: the projects, then their deliverables (the order app.item_lock keeps),
  -- only rows the caller may see. The loop below takes the same locks again (already held by this
  -- transaction) and checks item by item, in the order given, as before.
  perform 1 from public.projects p
  where p.org_id = v_org and app.client_visible(p.client_id)
    and p.id in (select i.project_id from public.project_items i where i.id = any (v_ids) and i.org_id = v_org)
  order by p.id
  for update of p;
  perform 1 from public.project_items i
  join public.projects p on p.id = i.project_id
  where i.id = any (v_ids) and i.org_id = v_org and app.client_visible(p.client_id)
  order by i.id
  for update of i;
  foreach v_id in array v_ids loop
    v_item := app.item_lock(v_id);
    select p.* into v_project from public.projects p where p.id = v_item.project_id;
    perform app.project_check_writable(v_project);
    if v_item.state <> 'open' then
      perform app.fail('INVALID_STATE', format('%s is %s: only open deliverables change together.', v_item.title,
        case v_item.state when 'cancelled' then 'closed' when 'carried' then 'carried forward' else 'done' end));
    end if;
    v_out := v_out || v_item;
  end loop;
  return v_out;
end;
$$;
revoke all on function app.client_work_bulk_items(uuid[]) from public, anon, authenticated;
grant execute on function app.client_work_bulk_items(uuid[]) to service_role;
comment on function app.client_work_bulk_items(uuid[]) is
  'Internal (6b Release 2, ROADMAP 6b.16 (e)): the selected deliverables, de-duplicated (first place kept), '
  '1..100 (VALIDATION); their projects and then the deliverables locked in id order first (only rows the '
  'caller may see; Release 2 review 2026-10-16: no deadlock between overlapping selections), then each '
  'through app.item_lock (NOT_FOUND outside the caller''s clients), its project writable, the deliverable '
  'open (INVALID_STATE naming it). Returned in the order given.';
