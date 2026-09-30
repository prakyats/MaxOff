-- Phase 4 review fixes (`/review-phase 4`, 2026-09-30: the architecture and the security review of
-- main...phase-4). Expand-only (ARCHITECTURE §18, 3c decision 7): every function keeps its name,
-- arguments and result; only phase-4 functions and app.* helpers are re-created, and every change
-- narrows (nothing main's code reads loses a column or a row it is entitled to).
--
-- 1. (S-M1) A demoted Admin keeps nothing of a manager's reach (PERMISSIONS §2: Staff see only the
--    tasks they are assigned to or coordinate). Being a task's creator counts only with
--    tasks.create, being its approving Admin only with tasks.approve_admin: app.task_manager,
--    app.is_approving_admin, app.task_visible, app.labelled_client_ids and the visible-tasks set of
--    app.directory_visible_ids. The stage guard's manager paths (add, rename, reorder, delete) also
--    require tasks.create. What happens to the pending approvals of a demoted or deactivated Admin
--    is an owner question (PROGRESS "Phase 4 review"): nothing moves here.
-- 2. (S-S2) A coordinator stands for an ACTIVE freelancer only, as app.task_on_behalf_ok already
--    says: app.task_actor refuses a deactivated subject, the coordinator branch of
--    app.task_visible (and of app.labelled_client_ids, app.directory_visible_ids' visible set and
--    task_counts()) counts only active freelancers, and so does the stage guard's untick path.
-- 3. (S-S3 c) Defence in depth for "Invite as employee": app.current_member() and
--    app.has_permission() resolve a permanent member only. A freelancer has no sign-in (Kickoff 4
--    decision 6); a sign-in left on a freelancer's id by a failed rollback now resolves to nobody.
--    member_invite_employee() makes the row permanent before the invitee can accept, so the door
--    it opens is unchanged.
-- 4. (A-M2) The approval route when the approving Admin joins the assignees while the task is
--    submitted: task_update_assignment() moves it to admin_approved with admin_step skipped, as
--    task_set_approver() and task_submit_done() do (WORKFLOWS §3.1), audited as
--    admin_step_skipped with meta.reason approver_is_assignee. Before this the task sat in
--    submitted with nobody allowed to decide it.
-- 5. (A-S4 / security L5) task_unread_counts(task_ids) takes the list's own task ids: null is
--    VALIDATION, and at most 500 ids a call (the data layer sends them in chunks); it no longer
--    scans every comment in the organization.
-- 6. (Security L2) Payload bounds in the database: task_create() takes at most 30 stages (the
--    templates' cap) and 20 assignees (ASSIGNEES_MAX), a stage added through the API stops at 30;
--    reminder_rules given to task_create() or task_update_assignment() is a list of at most 10
--    objects, 4 KB in all; the warnings are at most 60 (ASSIGNEES_MAX x 3), each details object at
--    most 512 bytes holding only the keys the dialog writes for its kind.
-- 7. (Security L4) A tick on an already ticked stage keeps its first done_at, done_by and
--    on_behalf_of: the guard ignores a re-tick.
--
-- The owner's answers to the review's questions (2026-09-30), Kickoff 4 decisions 33 to 36:
-- 8. (33) An approving Admin deactivated or made Staff: their submitted tasks go straight to the
--    Owner (admin_approved, admin_step none) and their other open tasks lose that approver (the
--    route is the Owner's), in the same transaction as the change: an AFTER UPDATE OF role, status
--    trigger on members (app.members_task_route, beside client_admin_guard), so member_deactivate()
--    and a role edit both do it. Audit: approver_changed per task, meta.reason approver_deactivated
--    or approver_role_changed.
-- 9. (34) A coordinator is treated like an assignee for the route: the approving Admin who is the
--    current coordinator of an active freelancer assignee skips the Admin step at Done
--    (task_submit_done, meta.reason approver_is_coordinator), cannot review at the Admin step
--    (task_review), is skipped when named approver (task_set_approver); and a task already
--    submitted moves to the Owner when that link appears later (an assignee added: A-M2; a
--    coordinator set: a member_coordinators trigger; a freelancer reactivated: the members
--    trigger). app.task_approver_on_task() is the one rule; app.task_skip_admin_step() the move.
-- 10. (35) An Admin's suggestion without a client label is decided by the Owner only: a decider's
--    view of the no-client suggestions leaves out those an Admin made (app.task_request_visible),
--    so another Admin neither lists, counts, converts nor declines them (NOT_FOUND).
-- 11. (36) Unread markers count only on the tasks the viewer is on or decides: an assignee, the
--    current coordinator of an active freelancer assignee, the approving Admin, the creator; for
--    the Owner also every task routed to them (no approving Admin) and every task at their step
--    (admin_approved). task_unread_counts() applies it; the task page's own Chat count is
--    unchanged (anyone who opens a task sees its new comments).

-- 9. The route's one rule (decision 34) -------------------------------------------------------------------
-- Is this Admin on the task for the route: an active assignee, or the current coordinator of an
-- active freelancer assignee (who acts for them)? Such an approver never checks the task.
create function app.task_approver_on_task(p_task_id uuid, p_admin_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_admin_id is not null
    and (app.is_task_assignee(p_task_id, p_admin_id)
         or exists (select 1 from public.task_assignees a
                    join public.members f on f.id = a.member_id
                    where a.task_id = p_task_id and a.removed_at is null
                      and f.engagement = 'freelance' and f.status = 'active'
                      and app.coordinator_of(f.id) = p_admin_id));
$$;

revoke all on function app.task_approver_on_task(uuid, uuid) from public, anon, authenticated;
grant execute on function app.task_approver_on_task(uuid, uuid) to service_role;

comment on function app.task_approver_on_task(uuid, uuid) is
  'Internal (phase 4 review, Kickoff 4 decisions 34 and A-M2): true when the Admin is an active '
  'assignee of the task or the current coordinator of an active freelancer assignee. The route '
  'skips the Admin step for such an approver (task_submit_done, task_set_approver, '
  'app.task_skip_admin_step) and task_review refuses them at that step.';

-- A submitted task whose approving Admin is now on it moves to the Owner (admin_approved, admin
-- step skipped), audited as admin_step_skipped. True when it moved. The callers hold the task's
-- row lock or change what the rule reads in the same transaction.
create function app.task_skip_admin_step(p_task_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_task public.tasks;
begin
  select t.* into v_task from public.tasks t where t.id = p_task_id for update;
  if v_task.id is null or v_task.state <> 'submitted'
     or not app.task_approver_on_task(v_task.id, v_task.approving_admin_id) then
    return false;
  end if;
  perform set_config('app.audit_override', jsonb_build_object(
    'action', 'admin_step_skipped',
    'meta', jsonb_build_object(
      'reason', case when app.is_task_assignee(v_task.id, v_task.approving_admin_id)
                     then 'approver_is_assignee' else 'approver_is_coordinator' end,
      'approving_admin_id', v_task.approving_admin_id,
      'from_state', v_task.state, 'to_state', 'admin_approved'))::text, true);
  update public.tasks set state = 'admin_approved', admin_step = 'skipped' where id = v_task.id;
  return true;
end;
$$;

revoke all on function app.task_skip_admin_step(uuid) from public, anon, authenticated;
grant execute on function app.task_skip_admin_step(uuid) to service_role;

comment on function app.task_skip_admin_step(uuid) is
  'Internal (phase 4 review A-M2, Kickoff 4 decision 34): a submitted task whose approving Admin '
  'is now on it (app.task_approver_on_task) moves to admin_approved with admin_step skipped, '
  'audited as admin_step_skipped (meta.reason approver_is_assignee | approver_is_coordinator). '
  'Returns whether it moved. Notifies the Owner (WORKFLOWS §9; 5.1).';

-- 3. Who the caller is ---------------------------------------------------------------------------------
create or replace function app.current_member()
returns setof public.members
language sql
stable
security definer
set search_path = ''
rows 1
as $$
  select m.* from public.members m
  where m.id = auth.uid() and m.status = 'active' and m.engagement = 'permanent';
$$;

comment on function app.current_member() is
  'The caller''s member row while status = active and engagement = permanent. Deactivated or '
  'invited means no rows, so every policy that uses it ends access immediately; a freelancer never '
  'signs in (Kickoff 4 decision 6), so a sign-in on a freelancer''s id resolves to nobody (phase 4 '
  'review S-S3).';

create or replace function app.has_permission(key text)
returns boolean
language sql
stable
strict
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.members m
    join public.role_permissions rp on rp.role = m.role
    where m.id = auth.uid() and m.status = 'active' and m.engagement = 'permanent'
      and rp.permission = key
  );
$$;

comment on function app.has_permission(text) is
  'True when the caller is an active permanent member whose role holds this PERMISSIONS §1 key '
  '(a sign-in on a freelancer''s id holds none: phase 4 review S-S3). Use as '
  '(select app.has_permission(''x'')) in policies so it is evaluated once per statement.';

-- 1, 2. Task visibility and management -----------------------------------------------------------------
create or replace function app.is_approving_admin(p_task_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.tasks t
    where t.id = p_task_id and t.approving_admin_id = auth.uid()
      and (select app.has_permission('tasks.approve_admin'))
      and t.org_id = (select m.org_id from app.current_member() m));
$$;

comment on function app.is_approving_admin(uuid) is
  'True when the caller is the task''s approving Admin and still holds tasks.approve_admin.';

create or replace function app.task_manager(p_task_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.tasks t
    where t.id = p_task_id
      and t.org_id = (select m.org_id from app.current_member() m)
      and ((select app.is_owner())
           or (t.created_by = auth.uid() and (select app.has_permission('tasks.create')))
           or (t.approving_admin_id = auth.uid() and (select app.has_permission('tasks.approve_admin')))));
$$;

comment on function app.task_manager(uuid) is
  'True when the caller may edit, reassign, cancel or reopen the task (PERMISSIONS §3): its '
  'creator while they hold tasks.create, its approving Admin while they hold tasks.approve_admin, '
  'or the Owner. Other Admins who see it cannot change it; a creator or approver demoted to Staff '
  'loses it (phase 4 review S-M1).';

create or replace function app.task_visible(p_task_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.tasks t
    where t.id = p_task_id
      and t.org_id = (select m.org_id from app.current_member() m)
      and ((select app.is_owner())
           or (t.created_by = auth.uid() and (select app.has_permission('tasks.create')))
           or (t.approving_admin_id = auth.uid() and (select app.has_permission('tasks.approve_admin')))
           or exists (select 1 from public.task_assignees a
                      where a.task_id = t.id and a.removed_at is null and a.member_id = auth.uid())
           or exists (select 1 from public.task_assignees a
                      join public.members f on f.id = a.member_id
                      where a.task_id = t.id and a.removed_at is null
                        and f.engagement = 'freelance' and f.status = 'active'
                        and app.coordinator_of(f.id) = auth.uid())
           or (t.client_id is not null
               and (select app.has_permission('clients.edit_assigned'))
               and t.client_id in (select app.admin_client_ids()))));
$$;

comment on function app.task_visible(uuid) is
  'May the caller see this task (PERMISSIONS §2)? The Owner: every task of the organization. An '
  'Admin: tasks they created (tasks.create), approve (tasks.approve_admin), are assigned to, or '
  'labelled with one of their clients. Staff: tasks they are assigned to. A coordinator: their '
  'current ACTIVE freelancers'' tasks as well (ADR-0013 §6). A removed assignee, a former '
  'coordinator, the coordinator of a deactivated freelancer and a creator or approver demoted to '
  'Staff see nothing of it (phase 4 review S-M1, S-S2).';

create or replace function app.labelled_client_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select distinct t.client_id
  from public.tasks t
  where t.client_id is not null
    and t.org_id = (select m.org_id from app.current_member() m)
    and ((select app.is_owner())
         or (t.created_by = auth.uid() and (select app.has_permission('tasks.create')))
         or (t.approving_admin_id = auth.uid() and (select app.has_permission('tasks.approve_admin')))
         or exists (select 1 from public.task_assignees a
                    where a.task_id = t.id and a.removed_at is null and a.member_id = auth.uid())
         or exists (select 1 from public.task_assignees a
                    join public.members f on f.id = a.member_id
                    where a.task_id = t.id and a.removed_at is null
                      and f.engagement = 'freelance' and f.status = 'active'
                      and app.coordinator_of(f.id) = auth.uid()));
$$;

comment on function app.labelled_client_ids() is
  'The clients whose label sits on a task the caller can see (4A; app.task_visible''s rule without '
  'the Admin''s own-client branch, which client_visible covers): the second half of '
  'client_labels'' WHERE, a label at most (ADR-0005), never the client record.';

create or replace function app.directory_visible_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  with me as (
    select m.id, m.org_id from app.current_member() m
  ),
  -- The freelancers the caller coordinates now (ADR-0013).
  coordinated as (
    select mc.member_id
    from public.member_coordinators mc
    join me on mc.coordinator_id = me.id
    where mc.to_at is null
  ),
  -- Of those, the active ones: a coordinator stands for an active freelancer only (S-S2).
  coordinated_active as (
    select c.member_id
    from coordinated c
    join public.members f on f.id = c.member_id
    where f.engagement = 'freelance' and f.status = 'active'
  ),
  -- The caller's visible tasks: app.task_visible()'s rule, once for the whole set.
  visible as (
    select t.id, t.created_by, t.approving_admin_id, t.primary_owner_id, t.submitted_by,
           t.submitted_on_behalf_of
    from public.tasks t
    join me on t.org_id = me.org_id
    where (select app.is_owner())
       or (t.created_by = me.id and (select app.has_permission('tasks.create')))
       or (t.approving_admin_id = me.id and (select app.has_permission('tasks.approve_admin')))
       or exists (select 1 from public.task_assignees a
                  where a.task_id = t.id and a.removed_at is null
                    and (a.member_id = me.id
                         or a.member_id in (select ca.member_id from coordinated_active ca)))
       or (t.client_id is not null
           and (select app.has_permission('clients.edit_assigned'))
           and t.client_id in (select app.admin_client_ids()))
  ),
  named (id) as (
    select me.id from me
    union all
    select c.member_id from coordinated c
    -- The task's own people: creator, current approver, primary owner, who marked it done.
    union all
    select x.id from visible v
    cross join lateral (values (v.created_by), (v.approving_admin_id), (v.primary_owner_id),
                               (v.submitted_by), (v.submitted_on_behalf_of)) x(id)
    -- Current and removed assignees, and who noted it for a freelancer.
    union all
    select x.id from public.task_assignees a
    join visible v on v.id = a.task_id
    cross join lateral (values (a.member_id), (a.acknowledged_by)) x(id)
    union all
    select r.reviewer_id from public.task_reviews r join visible v on v.id = r.task_id
    union all
    select x.id from public.task_comments c
    join visible v on v.id = c.task_id
    cross join lateral (values (c.author_id), (c.on_behalf_of)) x(id)
    union all
    select x.id from public.task_stages s
    join visible v on v.id = s.task_id
    cross join lateral (values (s.done_by), (s.on_behalf_of)) x(id)
    union all
    select x.id from public.task_submissions s
    join visible v on v.id = s.task_id
    cross join lateral (values (s.submitted_by), (s.on_behalf_of)) x(id)
    -- Whoever acted on it (every audit entry about the task, warnings aside: they are
    -- availability.view's), and the approvers and primary owners an entry names (past approvers).
    union all
    select x.id from public.activity_log l
    join visible v on v.id = l.entity_id
    cross join lateral (values
      (l.actor_id),
      (l.on_behalf_of_id),
      (case when l.action in ('approver_changed', 'primary_changed')
                 and l.meta ->> 'from' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
            then (l.meta ->> 'from')::uuid end),
      (case when l.action in ('approver_changed', 'primary_changed')
                 and l.meta ->> 'to' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
            then (l.meta ->> 'to')::uuid end)) x(id)
    where l.entity in ('tasks', 'task_assignees', 'task_stages', 'task_comments', 'task_reviews',
                       'task_submissions')
    -- The current coordinator of a freelancer on the task.
    union all
    select mc.coordinator_id from public.member_coordinators mc
    join public.task_assignees a on a.member_id = mc.member_id and a.removed_at is null
    join visible v on v.id = a.task_id
    where mc.to_at is null
  )
  select distinct n.id from named n where n.id is not null;
$$;

comment on function app.directory_visible_ids() is
  'The members whose directory row a caller without team.view reads (PERMISSIONS §2; Kickoff 4 '
  'decision 21): themselves, the freelancers they coordinate now, and everyone who was on or acted '
  'on a task they can see (app.task_visible''s rule, computed once: a creator with tasks.create, an '
  'approver with tasks.approve_admin, an active freelancer''s coordinator; phase 4 review S-M1, '
  'S-S2): creator, current and past approvers, current and removed assignees, reviewers, '
  'commenters, tickers, submitters, every actor of the task''s audit entries (warnings aside) and '
  'the current coordinator of a freelancer assignee.';

-- The badge counts follow the same rule: a deactivated freelancer's tasks are nobody's to note.
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
      and t.state not in ('completed', 'cancelled')
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

comment on function public.task_counts() is
  'The caller''s task counts for the nav badges (Kickoff 4 decision 16, WORKFLOWS §9 "Phase 4 ships '
  'before phase 5"): open tasks not yet noted by the caller or an active freelancer they coordinate, '
  'those in changes_requested, the badge (either, each task once), and the tasks the caller may '
  'decide now (the Owner: waiting for the final approval; an approving Admin: waiting for their '
  'check, not on a task they are assigned to). One row for an active member, none otherwise.';

-- 2. Who acts, and for whom ------------------------------------------------------------------------------
create or replace function app.task_actor(p_task_id uuid, p_on_behalf_of uuid, out actor_id uuid, out subject_id uuid, out org_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller public.members;
  v_subject public.members;
begin
  select m.* into v_caller from app.current_member() m;
  if v_caller.id is null then
    perform app.fail('UNAUTHENTICATED', 'Your account is not active.');
  end if;
  if not app.has_permission('tasks.work') then
    perform app.fail('FORBIDDEN', 'You cannot work on tasks.');
  end if;
  if v_caller.engagement <> 'permanent' then
    perform app.fail('FORBIDDEN', 'A freelancer''s work is recorded by their coordinator.');
  end if;
  actor_id := v_caller.id;
  org_id := v_caller.org_id;

  if p_on_behalf_of is null then
    if not app.is_task_assignee(p_task_id, v_caller.id) then
      perform app.fail('FORBIDDEN', 'Only an assignee of this task can do that.');
    end if;
    subject_id := v_caller.id;
    return;
  end if;

  if p_on_behalf_of = v_caller.id then
    perform app.fail('VALIDATION', 'on_behalf_of names the freelancer you act for, not yourself.');
  end if;
  select m.* into v_subject from public.members m where m.id = p_on_behalf_of and m.org_id = v_caller.org_id;
  if v_subject.id is null then
    perform app.fail('NOT_FOUND', 'This person is not on the team.');
  end if;
  if v_subject.engagement <> 'freelance' then
    perform app.fail('FORBIDDEN', 'You can act on behalf of a freelancer only.');
  end if;
  -- A deactivated freelancer has nobody acting for them (S-S2, as app.task_on_behalf_ok).
  if v_subject.status <> 'active' then
    perform app.fail('FORBIDDEN', format('%s is not active, so nobody acts for them.', v_subject.full_name));
  end if;
  if not app.is_task_assignee(p_task_id, v_subject.id) then
    perform app.fail('FORBIDDEN', 'This freelancer is not assigned to the task.');
  end if;
  if app.coordinator_of(v_subject.id) is distinct from v_caller.id then
    perform app.fail('FORBIDDEN', format('Only %s''s current coordinator can act for them.', v_subject.full_name));
  end if;
  subject_id := v_subject.id;
end;
$$;

comment on function app.task_actor(uuid, uuid) is
  'Internal (4A, ADR-0013 §3): (actor_id, subject_id, org_id) for a task action. Without '
  'on_behalf_of the caller must be an active assignee; with it, a permanent member acting for an '
  'ACTIVE freelance assignee whose current coordinator they are (phase 4 review S-S2). A '
  'freelancer''s own id, a former coordinator, another member, a deactivated freelancer and a '
  'non-freelancer subject are FORBIDDEN.';

-- 1, 2, 6, 7. The stage guard ----------------------------------------------------------------------------
create or replace function app.task_stages_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_task_id uuid := case when tg_op = 'DELETE' then old.task_id else new.task_id end;
  v_state public.task_state;
  v_tick boolean;
  v_edit boolean;
begin
  if app.in_transition() then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;
  select t.state into v_state from public.tasks t where t.id = v_task_id;
  if v_state is null then
    perform app.fail('NOT_FOUND', 'This task does not exist.');
  end if;

  if tg_op = 'DELETE' then
    if not (app.task_manager(old.task_id) and app.has_permission('tasks.create')) then
      perform app.fail('FORBIDDEN', 'Only the task''s creator, its approving Admin or the Owner edits the checklist.');
    end if;
    if v_state in ('completed', 'cancelled') then
      perform app.fail('INVALID_STATE', 'Reopen the task to change its checklist.');
    end if;
    if old.done_at is not null then
      perform app.fail('INVALID_STATE', 'A ticked stage stays in the history. Untick it first.');
    end if;
    return old;
  end if;

  if tg_op = 'INSERT' then
    if not (app.task_manager(new.task_id) and app.has_permission('tasks.create')) then
      perform app.fail('FORBIDDEN', 'Only the task''s creator, its approving Admin or the Owner edits the checklist.');
    end if;
    if v_state in ('completed', 'cancelled') then
      perform app.fail('INVALID_STATE', 'Reopen the task to change its checklist.');
    end if;
    -- A checklist this long is a project, not a task (STAGES_MAX, the templates' cap; L2).
    if (select count(*) from public.task_stages s where s.task_id = new.task_id) >= 30 then
      perform app.fail('VALIDATION', 'A task has up to 30 stages.');
    end if;
    -- A new stage is unticked (the column grant already keeps the tick columns out of an insert).
    new.done_at := null; new.done_by := null; new.on_behalf_of := null;
    return new;
  end if;

  -- UPDATE
  if new.task_id <> old.task_id then
    perform app.fail('FORBIDDEN', 'A stage stays on its task.');
  end if;
  v_edit := new.name <> old.name or new.position <> old.position;
  -- A tick on a ticked stage is ignored: the first tick's time and author stay (L4).
  if old.done_at is not null and new.done_at is not null then
    new.done_at := old.done_at;
    new.done_by := old.done_by;
    new.on_behalf_of := old.on_behalf_of;
  end if;
  v_tick := new.done_at is distinct from old.done_at or new.done_by is distinct from old.done_by
            or new.on_behalf_of is distinct from old.on_behalf_of;
  if v_edit then
    if not (app.task_manager(new.task_id) and app.has_permission('tasks.create')) then
      perform app.fail('FORBIDDEN', 'Only the task''s creator, its approving Admin or the Owner edits the checklist.');
    end if;
    if v_state in ('completed', 'cancelled') then
      perform app.fail('INVALID_STATE', 'Reopen the task to change its checklist.');
    end if;
  end if;
  if v_tick then
    -- Locked from submitted onwards (WORKFLOWS §3.1): editing resumes only through changes_requested.
    if v_state not in ('todo', 'in_progress', 'changes_requested') then
      perform app.fail('INVALID_STATE', 'This task is with its reviewers. Stages can be ticked again if changes are requested.');
    end if;
    if new.done_at is not null then
      -- The tick's time is the server's, whatever the caller sent (4B review S5).
      new.done_at := now();
      new.done_by := auth.uid();
      if new.on_behalf_of is null then
        if not app.is_task_assignee(new.task_id, auth.uid()) then
          perform app.fail('FORBIDDEN', 'Only an assignee ticks a stage.');
        end if;
      elsif not app.task_on_behalf_ok(new.task_id, new.on_behalf_of) then
        perform app.fail('FORBIDDEN', 'You can tick for a freelancer only as their current coordinator, on their task.');
      end if;
    else
      new.done_by := null;
      new.on_behalf_of := null;
      -- An assignee, or the current coordinator of an active freelancer assignee (S-S2; the
      -- guard runs as the caller, so the freelancer's row is read by app.task_on_behalf_ok).
      if not app.is_task_assignee(new.task_id, auth.uid())
         and not exists (select 1 from public.task_assignees a
                         where a.task_id = new.task_id and a.removed_at is null
                           and app.task_on_behalf_ok(new.task_id, a.member_id)) then
        perform app.fail('FORBIDDEN', 'Only an assignee unticks a stage.');
      end if;
    end if;
  end if;
  return new;
end;
$$;

comment on function app.task_stages_guard() is
  'BEFORE INSERT OR UPDATE OR DELETE on task_stages (API path). A manager holding tasks.create '
  '(creator, approving Admin, Owner; phase 4 review S-M1) adds (up to 30 stages), renames, reorders '
  'and deletes unticked stages while the task is not completed / cancelled. A worker ticks '
  '(done_at = now(), whatever was sent, 4B review S5; done_by = the caller; on_behalf_of = an active '
  'freelancer assignee the caller coordinates) or unticks (an assignee, or the current coordinator '
  'of an active freelancer assignee) while the task is todo / in_progress / changes_requested: '
  'locked from submitted (WORKFLOWS §3.1). A tick on a ticked stage keeps the first one (L4).';

-- 6. Payload bounds ------------------------------------------------------------------------------------
-- reminder_rules as a caller gives them: a list of at most 10 objects, 4 KB in all. Their fields are
-- 5.3's (the reminder editor); until then nothing in the app sends any.
create function app.task_check_reminders(p_rules jsonb)
returns void
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_rules is null or jsonb_typeof(p_rules) <> 'array' then
    perform app.fail('VALIDATION', 'Reminder rules are a list.');
  end if;
  if jsonb_array_length(p_rules) > 10 or octet_length(p_rules::text) > 4096 then
    perform app.fail('VALIDATION', 'Up to 10 reminder rules.');
  end if;
  if exists (select 1 from jsonb_array_elements(p_rules) e where jsonb_typeof(e) <> 'object') then
    perform app.fail('VALIDATION', 'Each reminder rule is an object.');
  end if;
end;
$$;

revoke all on function app.task_check_reminders(jsonb) from public, anon, authenticated;
grant execute on function app.task_check_reminders(jsonb) to service_role;

comment on function app.task_check_reminders(jsonb) is
  'Internal (phase 4 review, security L2): VALIDATION unless the reminder rules a caller gives '
  'task_create / task_update_assignment are a list of at most 10 objects, 4 KB in all.';

create or replace function app.task_record_warnings(p_task_id uuid, p_caller uuid, p_assignees uuid[], p_warnings jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  w jsonb;
  v_member uuid;
  v_details jsonb;
  v_allowed text[];
begin
  if p_warnings is null then
    return;
  end if;
  if jsonb_typeof(p_warnings) <> 'array' then
    perform app.fail('VALIDATION', 'warnings is a list.');
  end if;
  -- ASSIGNEES_MAX x 3 kinds (L2).
  if jsonb_array_length(p_warnings) > 60 then
    perform app.fail('VALIDATION', 'Too many warnings.');
  end if;
  for w in select * from jsonb_array_elements(p_warnings) loop
    if jsonb_typeof(w) <> 'object' or (w ->> 'kind') is null
       or (w ->> 'kind') not in ('overlap', 'workload', 'on_leave') or (w ->> 'member_id') is null then
      perform app.fail('VALIDATION', 'Each warning names its kind and the person it is about.');
    end if;
    begin
      v_member := (w ->> 'member_id')::uuid;
    exception when invalid_text_representation then
      perform app.fail('VALIDATION', 'A warning names its person by id.');
    end;
    if not (v_member = any (p_assignees)) then
      perform app.fail('VALIDATION', 'A warning is about one of the assignees.');
    end if;
    -- What the dialog showed, and only that (L2): the keys it writes for the kind, each a short
    -- text or a number, 512 bytes in all.
    v_details := case when jsonb_typeof(w -> 'details') = 'object' then w -> 'details' else '{}'::jsonb end;
    v_allowed := case w ->> 'kind'
                   when 'workload' then array['date', 'open_tasks', 'threshold']
                   when 'overlap' then array['date', 'start_at', 'end_at']
                   else array['date', 'leave'] end;
    if octet_length(v_details::text) > 512
       or exists (select 1 from jsonb_each(v_details) e
                  where not (e.key = any (v_allowed))
                     or jsonb_typeof(e.value) not in ('string', 'number')
                     or (jsonb_typeof(e.value) = 'string' and length(e.value #>> '{}') > 64)) then
      perform app.fail('VALIDATION', 'A warning carries only what the dialog showed.');
    end if;
    perform set_config('app.audit_override', jsonb_build_object(
      'action', 'warning_overridden',
      'meta', jsonb_build_object('kind', w ->> 'kind', 'member_id', v_member))::text, true);
    insert into public.task_warnings (task_id, kind, member_id, details, overridden_by)
    values (p_task_id, w ->> 'kind', v_member, v_details, p_caller);
  end loop;
end;
$$;

comment on function app.task_record_warnings(uuid, uuid, uuid[], jsonb) is
  'Internal (4A): records each warning the caller proceeded past (warning_overridden). At most 60; '
  'each names its kind and one of the assignees; details hold only the keys the dialog writes for '
  'the kind (workload: date, open_tasks, threshold; overlap: date, start_at, end_at; on_leave: '
  'date, leave), texts up to 64 characters or numbers, 512 bytes in all (phase 4 review, L2).';

create or replace function public.task_create(
  title text,
  description text,
  task_type_id uuid,
  client_id uuid,
  priority public.priority,
  due_at timestamptz,
  assignee_ids uuid[],
  primary_owner_id uuid,
  approving_admin_id uuid default null,
  event_date date default null,
  event_start_at timestamptz default null,
  event_end_at timestamptz default null,
  location text default null,
  purpose text default null,
  stages text[] default '{}',
  custom_fields jsonb default '{}',
  reminder_rules jsonb default null,
  template_id uuid default null,
  warnings jsonb default '[]'
)
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
  -- ASSIGNEES_MAX (L2).
  if cardinality(v_ids) > 20 then
    perform app.fail('VALIDATION', 'Up to 20 people.');
  end if;
  if task_create.primary_owner_id is null or not (task_create.primary_owner_id = any (v_ids)) then
    perform app.fail('VALIDATION', 'The primary owner must be one of the assignees.');
  end if;
  foreach v_member in array v_ids loop
    perform app.task_assignee_check(v_org, v_member);
  end loop;

  -- STAGES_MAX, the templates' cap (L2).
  if coalesce(cardinality(task_create.stages), 0) > 30 then
    perform app.fail('VALIDATION', 'Up to 30 stages.');
  end if;
  foreach v_stage in array coalesce(task_create.stages, '{}'::text[]) loop
    if length(btrim(coalesce(v_stage, ''))) not between 1 and 120 then
      perform app.fail('VALIDATION', 'Each stage needs a name of up to 120 characters.');
    end if;
  end loop;

  if task_create.custom_fields is null or jsonb_typeof(task_create.custom_fields) <> 'object' then
    perform app.fail('VALIDATION', 'Custom fields are an object.');
  end if;
  -- Kickoff 4 decision 14: no reminder editor yet; a task takes its type's defaults. Rules a caller
  -- gives are bounded (L2).
  if task_create.reminder_rules is not null then
    perform app.task_check_reminders(task_create.reminder_rules);
  end if;
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

  return v_task_id;
end;
$$;

comment on function public.task_create(text, text, uuid, uuid, public.priority, timestamptz, uuid[], uuid, uuid, date, timestamptz, timestamptz, text, text, text[], jsonb, jsonb, uuid, jsonb) is
  'tasks.create (the Owner and Admins). A task in todo with its route resolved (PRODUCT §4.6): the '
  'Owner names any active Admin as approver or none; an Admin''s task routes to that Admin and its '
  'client label must be one of their clients. Assignees are 1 to 20 active Admins, Staff or '
  'freelancers, never the Owner; the primary owner is one of them. due_at is required and not in '
  'the past; the type decides the event fields (app.task_check_fields); reminder_rules default to '
  'the type''s (given ones: a list of at most 10 objects, 4 KB); stages are up to 30 typed names; '
  'warnings = [{kind, member_id, details}] the caller proceeded past (app.task_record_warnings '
  'bounds them). Audit: created (meta.route), assigned per person, stage_added, '
  'warning_overridden. Notifies each assignee (a freelancer''s coordinator, worded for them; '
  'WORKFLOWS §9; the rows are 5.1''s).';

-- 4, 6. task_update_assignment ----------------------------------------------------------------------------
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
  -- Rules a caller gives are bounded (L2); the task's own stay as they are.
  if changes ? 'reminder_rules' then
    perform app.task_check_reminders(v_reminder_rules);
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
    -- ASSIGNEES_MAX (L2).
    if cardinality(v_new_ids) > 20 then
      perform app.fail('VALIDATION', 'Up to 20 people.');
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
    end if;
  end loop;
  if v_primary <> v_task.primary_owner_id then
    perform set_config('app.audit_override', jsonb_build_object(
      'action', 'primary_changed',
      'meta', jsonb_build_object('from', v_task.primary_owner_id, 'to', v_primary))::text, true);
    update public.task_assignees set is_primary = true
    where task_assignees.task_id = v_task.id and member_id = v_primary and not is_primary;
    v_changed := array_append(v_changed, 'primary_owner_id');
  end if;

  -- The task's own fields: the trigger's diff is the field-level record (action updated).
  if v_title <> v_task.title then v_changed := array_append(v_changed, 'title'); end if;
  if v_description is distinct from v_task.description then v_changed := array_append(v_changed, 'description'); end if;
  if v_task_type_id <> v_task.task_type_id then v_changed := array_append(v_changed, 'task_type_id'); end if;
  if v_client_id is distinct from v_task.client_id then v_changed := array_append(v_changed, 'client_id'); end if;
  if v_priority <> v_task.priority then v_changed := array_append(v_changed, 'priority'); end if;
  if v_due_at <> v_task.due_at then v_changed := array_append(v_changed, 'due_at'); end if;
  if v_event_date is distinct from v_task.event_date then v_changed := array_append(v_changed, 'event_date'); end if;
  if v_event_start_at is distinct from v_task.event_start_at then v_changed := array_append(v_changed, 'event_start_at'); end if;
  if v_event_end_at is distinct from v_task.event_end_at then v_changed := array_append(v_changed, 'event_end_at'); end if;
  if v_location is distinct from v_task.location then v_changed := array_append(v_changed, 'location'); end if;
  if v_purpose is distinct from v_task.purpose then v_changed := array_append(v_changed, 'purpose'); end if;
  if v_custom_fields <> v_task.custom_fields then v_changed := array_append(v_changed, 'custom_fields'); end if;
  if v_reminder_rules <> v_task.reminder_rules then v_changed := array_append(v_changed, 'reminder_rules'); end if;

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

  -- The route (A-M2): the approving Admin now on a task waiting for their check (an assignee, or
  -- the coordinator of a freelancer added to it: decision 34) can no longer decide it, so the
  -- Admin step is skipped and the task waits for the Owner, as task_set_approver and
  -- task_submit_done do.
  if app.task_skip_admin_step(v_task.id) then
    v_changed := array(select distinct c from unnest(array_append(v_changed, 'state')) c order by c);
  end if;

  perform app.task_record_warnings(v_task.id, v_caller, v_new_ids, task_update_assignment.warnings);

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
  'purpose, custom_fields, reminder_rules (a list of at most 10 objects, 4 KB), assignee_ids (the '
  'full new set of 1 to 20: added people start their acknowledgement, removed ones keep their row '
  'with removed_at, a re-added person starts again), primary_owner_id (an active assignee, never '
  'the Owner). warnings as task_create. When the task is submitted and its approving Admin is '
  'among the new assignees, it moves to admin_approved with admin_step skipped (audit '
  'admin_step_skipped, meta.reason approver_is_assignee; phase 4 review A-M2) and the result '
  'includes state. Returns the fields that changed (VALIDATION when none did, or when a value, an '
  'assignee id included, has the wrong shape). Audit: updated (the trigger''s diff, meta.fields) '
  'plus assigned / unassigned / primary_changed rows. Notifies the affected assignees, and the '
  'Owner when the task moves to them (WORKFLOWS §9; 5.1).';

-- 5. task_unread_counts -------------------------------------------------------------------------------
create or replace function public.task_unread_counts(task_ids uuid[] default null)
returns table (task_id uuid, unread integer)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if task_unread_counts.task_ids is null then
    perform app.fail('VALIDATION', 'Name the tasks to count.');
  end if;
  if cardinality(task_unread_counts.task_ids) > 500 then
    perform app.fail('VALIDATION', 'Count up to 500 tasks at a time.');
  end if;
  return query
    with me as (
      select m.id, m.org_id from app.current_member() m
      where (select app.has_permission('tasks.work'))
    ),
    counted as (
      select c.task_id, count(*)::integer as unread
      from public.task_comments c
      join public.tasks t on t.id = c.task_id
      join me on t.org_id = me.org_id
      left join public.task_reads r on r.task_id = c.task_id and r.member_id = me.id
      where c.task_id = any (task_unread_counts.task_ids)
        and c.author_id <> me.id
        and (r.last_read_at is null or c.created_at > r.last_read_at)
      group by c.task_id
    )
    select counted.task_id, counted.unread
    from counted
    join public.tasks t on t.id = counted.task_id
    where app.task_visible(counted.task_id)
      -- Decision 36: only the tasks the viewer is on or decides.
      and (app.is_task_assignee(t.id, auth.uid())
           or exists (select 1 from public.task_assignees a
                      join public.members f on f.id = a.member_id
                      where a.task_id = t.id and a.removed_at is null
                        and f.engagement = 'freelance' and f.status = 'active'
                        and app.coordinator_of(f.id) = auth.uid())
           or (t.approving_admin_id = auth.uid() and (select app.has_permission('tasks.approve_admin')))
           or (t.created_by = auth.uid() and (select app.has_permission('tasks.create')))
           or ((select app.is_owner()) and (t.approving_admin_id is null or t.state = 'admin_approved')));
end;
$$;

comment on function public.task_unread_counts(uuid[]) is
  'The caller''s unread comments per task (Kickoff 4 decision 28): comments by anyone else '
  '(author_id is never the caller: their own, written for a freelancer included, never count) '
  'after the caller''s own last read (task_reads; every comment when there is none), on the named '
  'tasks the caller sees and is on or decides (Kickoff 4 decision 36): an assignee, the current '
  'coordinator of an active freelancer assignee, the approving Admin (tasks.approve_admin), the '
  'creator (tasks.create), and for the Owner also every task with no approving Admin and every '
  'task at their step (admin_approved); only tasks with any. task_ids is required, at most 500 '
  '(VALIDATION otherwise; phase 4 review A-S4: a list sends its own rows, never the whole '
  'organization). No rows for an inactive member or without tasks.work.';

-- 9. The route with a coordinator (decision 34) -------------------------------------------------------
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
  return v_state;
end;
$$;

comment on function public.task_submit_done(uuid, text, text, uuid) is
  'tasks.work, the primary owner (or their current coordinator with on_behalf_of, ADR-0013), from '
  'todo / in_progress / changes_requested. Records the primary owner''s acknowledgement if missing '
  '(audit acknowledged, meta.implied), writes the next task_submissions version (the optional note, '
  'links allowed), requires late_reason past due_at (REASON_REQUIRED), then routes: submitted with '
  'admin_step required when an approving Admin exists and is not on the task; otherwise '
  'admin_approved with admin_step none (no approver) or skipped (the approver is an assignee, '
  'meta.reason approver_is_assignee, or the current coordinator of an active freelancer assignee, '
  'meta.reason approver_is_coordinator: Kickoff 4 decision 34). Audit action: submitted. Notifies '
  'the approving Admin, or the Owner when there is no Admin step (WORKFLOWS §9; 5.1).';

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
    -- The Admin step: the approving Admin, never one on the task (PERMISSIONS §3). The Owner's
    -- way past a waiting Admin is task_set_approver.
    if v_task.approving_admin_id is distinct from v_caller or not app.has_permission('tasks.approve_admin') then
      if app.is_owner() then
        perform app.fail('INVALID_STATE', 'This task is waiting for its approving Admin. Change or remove the approver to decide it yourself.');
      end if;
      perform app.fail('FORBIDDEN', 'Only the task''s approving Admin reviews it at this step.');
    end if;
    if app.is_task_assignee(v_task.id, v_caller) then
      perform app.fail('FORBIDDEN', 'An assignee cannot approve their own task.');
    end if;
    -- Decision 34: a coordinator is treated like an assignee (they act for the freelancer on it).
    if app.task_approver_on_task(v_task.id, v_caller) then
      perform app.fail('FORBIDDEN', 'You coordinate a freelancer on this task, so the Owner approves it.');
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
  return v_state;
end;
$$;

comment on function public.task_review(uuid, public.review_decision, text) is
  'The review (WORKFLOWS §3.3). submitted: the approving Admin (tasks.approve_admin, never an '
  'assignee nor the current coordinator of an active freelancer assignee, Kickoff 4 decision 34; '
  'the Owner is INVALID_STATE here and changes the approver instead) -> admin_approved or '
  'changes_requested. admin_approved: tasks.approve_final (the Owner) -> completed or '
  'changes_requested. rejected needs a reason (REASON_REQUIRED). One task_reviews row per call, '
  'pointing at the latest submission; bulk approve is this function once per task (approved only, '
  'kickoff 4 decision 5). Audit: review_recorded, then admin_approved | completed | '
  'changes_requested. Notifies: the Owner after an Admin approval; the assignees (a freelancer''s '
  'coordinator) on changes requested or completion (WORKFLOWS §9; 5.1).';

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
    -- The review moves to the new approver, or the task goes to the Owner at once (no approver,
    -- or one on the task: an assignee or a freelancer's coordinator, decision 34).
    if task_set_approver.approving_admin_id is null then
      v_state := 'admin_approved'; v_step := 'none';
    elsif app.task_approver_on_task(v_task.id, task_set_approver.approving_admin_id) then
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
  return v_state;
end;
$$;

comment on function public.task_set_approver(uuid, uuid) is
  'The Owner. Changes or removes (null) a task''s approving Admin (an active permanent Admin), not '
  'on a completed or cancelled task. admin_step follows (none without an approver, else required); '
  'while submitted the review moves to the new approver, or the task goes to admin_approved at '
  'once when the approver is removed (none) or is on the task (skipped: an assignee, or the '
  'current coordinator of an active freelancer assignee, Kickoff 4 decision 34); while '
  'admin_approved only a removal changes the record. Audit action: approver_changed (meta.from / '
  'to). Notifies the new approver when a review is waiting (WORKFLOWS §9; 5.1).';

-- A coordinator set while a freelancer's task waits for that same Admin's check (decision 34).
create function app.member_coordinators_task_route()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_task uuid;
begin
  if new.to_at is not null then
    return null;
  end if;
  for v_task in
    select t.id from public.tasks t
    join public.task_assignees a on a.task_id = t.id and a.removed_at is null
    where a.member_id = new.member_id and t.state = 'submitted' and t.approving_admin_id = new.coordinator_id
    order by t.id
  loop
    perform app.task_skip_admin_step(v_task);
  end loop;
  return null;
end;
$$;

revoke all on function app.member_coordinators_task_route() from public, anon;
grant execute on function app.member_coordinators_task_route() to authenticated, service_role;

comment on function app.member_coordinators_task_route() is
  'AFTER INSERT on member_coordinators (Kickoff 4 decision 34): when the new current coordinator '
  'is the approving Admin of a submitted task the freelancer is on, that task goes to the Owner '
  '(app.task_skip_admin_step, meta.reason approver_is_coordinator).';

-- Named after audit_row_change, so the coordinator row's own entry is written first.
create trigger task_route after insert on public.member_coordinators
  for each row execute function app.member_coordinators_task_route();

-- 8, 9. A member's change moves the route (decisions 33 and 34) ---------------------------------------
create function app.members_task_route()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_task public.tasks;
  v_reason text;
  v_state public.task_state;
  v_id uuid;
begin
  -- (33) An approving Admin who stops being an active Admin: their open tasks lose the approver,
  -- and what waits for their check goes to the Owner (admin_step none), in this transaction.
  if old.role = 'admin' and old.status = 'active' and (new.role <> 'admin' or new.status <> 'active') then
    v_reason := case when new.status <> 'active' then 'approver_deactivated' else 'approver_role_changed' end;
    for v_task in
      select t.* from public.tasks t
      where t.approving_admin_id = old.id and t.state not in ('completed', 'cancelled')
      order by t.id
      for update
    loop
      v_state := case when v_task.state = 'submitted' then 'admin_approved' else v_task.state end;
      perform set_config('app.audit_override', jsonb_build_object(
        'action', 'approver_changed',
        'meta', jsonb_build_object('from', old.id, 'to', null, 'reason', v_reason,
                                   'from_state', v_task.state, 'to_state', v_state))::text, true);
      update public.tasks set approving_admin_id = null, admin_step = 'none', state = v_state
      where id = v_task.id;
    end loop;
  end if;

  -- (34) A freelancer back at work: a submitted task of theirs waiting for their coordinator's
  -- check goes to the Owner.
  if new.engagement = 'freelance' and old.status <> 'active' and new.status = 'active' then
    for v_id in
      select t.id from public.tasks t
      join public.task_assignees a on a.task_id = t.id and a.removed_at is null
      where a.member_id = new.id and t.state = 'submitted'
      order by t.id
    loop
      perform app.task_skip_admin_step(v_id);
    end loop;
  end if;
  return null;
end;
$$;

revoke all on function app.members_task_route() from public, anon;
grant execute on function app.members_task_route() to authenticated, service_role;

comment on function app.members_task_route() is
  'AFTER UPDATE OF role, status on members (Kickoff 4 decisions 33 and 34), in the same '
  'transaction as member_deactivate() or a role edit. An active Admin who is deactivated or no '
  'longer an Admin: every open task they approve loses its approver (admin_step none; submitted -> '
  'admin_approved, the Owner decides), audited as approver_changed with meta.reason '
  'approver_deactivated | approver_role_changed. A freelancer reactivated: a submitted task of '
  'theirs whose approving Admin is their coordinator goes to the Owner (app.task_skip_admin_step).';

-- After audit_row_change and client_admin_guard (a refused change never gets here).
create trigger task_route after update of role, status on public.members
  for each row execute function app.members_task_route();

-- 10. An Admin's no-client suggestion is the Owner's (decision 35) -------------------------------------
create or replace function app.task_request_visible(p_requested_by uuid, p_client_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select app.is_owner())
    or p_requested_by = auth.uid()
    or ((select app.has_permission('task_requests.decide'))
        and ((p_client_id is null
              and not exists (select 1 from public.members m where m.id = p_requested_by and m.role = 'admin'))
             -- Never null: a null here would read as "not refused" in a plpgsql IF (the lock).
             or (p_client_id is not null and p_client_id in (select app.admin_client_ids()))));
$$;

comment on function app.task_request_visible(uuid, uuid) is
  'May the caller see a task request (PERMISSIONS §2), and so decide it with task_requests.decide? '
  'The Owner: all. Anyone: their own. A decider (an Admin): those labelled with their own clients, '
  'and those with no client that an Admin did not make (an Admin''s no-client suggestion is the '
  'Owner''s to decide: Kickoff 4 decision 35).';
