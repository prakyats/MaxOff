-- 4C, first commit: Kickoff 4 decisions (21) and (22) (owner, 2026-09-29, answering the 4B review's
-- S8 and S9). Expand-only (ARCHITECTURE §18): the view keeps its columns, the functions their
-- signatures; only phase 4 reads what changes.
--
-- 1. (21) Names on a task (ADR-0013 "every screen that names 'who' shows both"): a member without
--    team.view reads the names of everyone who was on or acted on a task they can see: its
--    creator, current and past approvers, current and removed assignees, reviewers, whoever acted
--    on it (comments, ticks, submissions, changes: every audit entry about the task), and the
--    current coordinator of a freelancer assignee. Names only: the phone rule of PERMISSIONS §2 is
--    unchanged (team.view, the person, a freelancer's current coordinator).
--    Rewritten set-based at the same time (4A later item (a), 4B mechanics (1)): the view no longer
--    calls app.task_visible() per task per member row (2 s for one Staff read of 82 members); the
--    caller's visible tasks and the people on them are computed once per query by
--    app.directory_visible_ids().
-- 2. (22) A task's client label is an Active or Paused client only: app.task_check_fields() refuses
--    a Draft client when the label is set or changed (task_create, task_update_assignment), like
--    the Inactive refusal of the 4B review (S6). A label set before this stays (p_client_changed).

-- 1. The directory ------------------------------------------------------------------------------------

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
  -- The caller's visible tasks: app.task_visible()'s rule, once for the whole set.
  visible as (
    select t.id, t.created_by, t.approving_admin_id, t.primary_owner_id, t.submitted_by,
           t.submitted_on_behalf_of
    from public.tasks t
    join me on t.org_id = me.org_id
    where (select app.is_owner())
       or t.created_by = me.id
       or t.approving_admin_id = me.id
       or exists (select 1 from public.task_assignees a
                  where a.task_id = t.id and a.removed_at is null
                    and (a.member_id = me.id or a.member_id in (select c.member_id from coordinated c)))
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

revoke all on function app.directory_visible_ids() from public;
grant execute on function app.directory_visible_ids() to authenticated, service_role;

comment on function app.directory_visible_ids() is
  'The members whose directory row a caller without team.view reads (PERMISSIONS §2; Kickoff 4 '
  'decision 21): themselves, the freelancers they coordinate now, and everyone who was on or acted '
  'on a task they can see: creator, current and past approvers, current and removed assignees, '
  'reviewers, commenters, tickers, submitters, every actor of the task''s audit entries (warnings '
  'aside) and the current coordinator of a freelancer assignee. Set-based: the caller''s visible '
  'tasks are computed once (4C; 4A later item (a)).';

create or replace function app.directory_visible(p_member_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_member_id = auth.uid()
    or (select app.has_permission('team.view'))
    or p_member_id in (select app.directory_visible_ids());
$$;

comment on function app.directory_visible(uuid) is
  'Whose directory row (name, job title, role, status, phone, engagement; never email) the caller '
  'may read: their own, everyone''s for team.view, and app.directory_visible_ids() (their current '
  'freelancers and everyone on or acting on their visible tasks; Kickoff 4 decision 21). The view '
  'uses the set directly; this is the single-row form.';

-- Same columns, same order (expand-only): only the WHERE is set-based and wider (decision 21).
-- The phone stays team.view's, the person's own and a freelancer's current coordinator's.
create or replace view public.member_directory
with (security_invoker = false, security_barrier = true)
as
  select m.id, m.org_id, m.full_name,
         case when m.id = auth.uid() or (select app.has_permission('team.view'))
                   or app.coordinator_of(m.id) = auth.uid()
              then m.phone end as phone,
         m.role, m.status, m.created_at, m.job_title_id,
         m.avatar_file_id, m.engagement
  from public.members m
  where m.org_id = (select c.org_id from app.current_member() c)
    and ((select app.has_permission('team.view'))
         or m.id in (select app.directory_visible_ids()));

comment on view public.member_directory is
  'Who is on the team, without email. Everyone''s row for team.view; otherwise the caller''s own, '
  'their current freelancers and everyone who was on or acted on a task they can see (Kickoff 4 '
  'decision 21, app.directory_visible_ids(), computed once per query). phone for team.view, the '
  'person and a freelancer''s current coordinator only. engagement marks a freelancer.';

-- Who coordinates a freelancer now, for whoever may name both (decision 21: a Staff co-assignee
-- reads "Asha · Freelancer · with Ravi" on a shared task). The current rows only and never the
-- reason (decision 20: member_coordinators and its reasons stay team.view's).
create view public.freelancer_coordinators
with (security_invoker = false, security_barrier = true)
as
  select mc.member_id, mc.coordinator_id, mc.from_at
  from public.member_coordinators mc
  join public.members m on m.id = mc.member_id
  where mc.to_at is null
    and m.org_id = (select c.org_id from app.current_member() c)
    and ((select app.has_permission('team.view'))
         or (mc.member_id in (select app.directory_visible_ids())
             and mc.coordinator_id in (select app.directory_visible_ids())));

comment on view public.freelancer_coordinators is
  'The current coordinator of each freelancer (4C, ADR-0013), without the reason: every row for '
  'team.view; otherwise the rows whose freelancer and coordinator the caller may both name '
  '(member_directory, Kickoff 4 decision 21), such as a freelancer on their task. The history and '
  'its reasons stay in member_coordinators (team.view, decision 20).';

revoke all on public.freelancer_coordinators from anon;
revoke all on public.freelancer_coordinators from authenticated;
grant select on public.freelancer_coordinators to authenticated;

-- 2. The client label: Active or Paused only (decision 22) -------------------------------------------
-- Same signature as the 4B review's; the Draft refusal joins the Inactive one.
create or replace function app.task_check_fields(
  p_org uuid, p_is_owner boolean, p_type public.task_types, p_client_id uuid, p_due_at timestamptz,
  p_new boolean, p_event_date date, p_event_start_at timestamptz, p_event_end_at timestamptz,
  p_location text, p_purpose text, p_client_changed boolean, p_type_changed boolean default true)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_client public.clients;
begin
  if p_type.id is null or p_type.org_id <> p_org then
    perform app.fail('NOT_FOUND', 'This task type does not exist.');
  end if;
  -- A task keeps an archived type; only choosing one is refused (4B review S7).
  if p_type_changed and p_type.archived_at is not null then
    perform app.fail('VALIDATION', 'Choose a task type from the list.');
  end if;
  if p_client_id is not null then
    select c.* into v_client from public.clients c where c.id = p_client_id and c.org_id = p_org;
    if v_client.id is null then
      perform app.fail('NOT_FOUND', 'This client does not exist.');
    end if;
    -- Kickoff 4 decision 2: an Admin labels a task only with their own clients. Checked when the
    -- label is set or changed (PERMISSIONS §3), not when an approving Admin edits another field of
    -- a task the Owner labelled with someone else's client (4A review S1).
    if p_client_changed and not p_is_owner and p_client_id not in (select app.admin_client_ids()) then
      perform app.fail('FORBIDDEN', 'You can label a task only with your own clients.');
    end if;
    -- Kickoff 4 decision 22: a label is an Active or Paused client. A Draft client may have no
    -- Admin yet, and a labelled task routes to the client's Admin; WORKFLOWS §4 refuses an
    -- Inactive one (4B review S6). A task labelled before keeps its label.
    if p_client_changed and v_client.state = 'draft' then
      perform app.fail('VALIDATION', format('%s is still a draft: label the task with an active or paused client, or with none.', v_client.name));
    end if;
    if p_client_changed and v_client.state = 'inactive' then
      perform app.fail('VALIDATION', format('%s is inactive: label the task with another client, or with none.', v_client.name));
    end if;
  end if;
  if p_due_at is null then
    perform app.fail('VALIDATION', 'Set a deadline.');
  end if;
  -- Kickoff 4 decision 4: a past deadline is refused at creation; a later edit may move it anywhere.
  if p_new and p_due_at <= now() then
    perform app.fail('VALIDATION', 'The deadline has already passed. Pick a later time.');
  end if;
  if p_type.kind = 'event' then
    if p_event_date is null then
      perform app.fail('VALIDATION', 'Pick the event date.');
    end if;
  elsif p_event_date is not null or p_event_start_at is not null or p_event_end_at is not null then
    perform app.fail('VALIDATION', format('A %s has no event date.', p_type.name));
  elsif p_purpose is not null then
    perform app.fail('VALIDATION', 'Only an event has a purpose.');
  end if;
  if p_event_end_at is not null and p_event_start_at is null then
    perform app.fail('VALIDATION', 'An event with an end time needs a start time.');
  end if;
  if p_event_start_at is not null and app.to_ist_date(p_event_start_at) <> p_event_date then
    perform app.fail('VALIDATION', 'The event time must be on the event date.');
  end if;
  if p_event_end_at is not null and p_event_end_at <= p_event_start_at then
    perform app.fail('VALIDATION', 'The event must end after it starts.');
  end if;
  if p_location is not null and not p_type.has_location then
    perform app.fail('VALIDATION', format('A %s has no location.', p_type.name));
  end if;
end;
$$;

comment on function app.task_check_fields(uuid, boolean, public.task_types, uuid, timestamptz, boolean, date, timestamptz, timestamptz, text, text, boolean, boolean) is
  'Internal (4A, 4B review, 4C): the type, label, deadline and event field rules of a task (PRODUCT '
  '§4.6): a type of the organization, active when it is set or changed (p_type_changed, default '
  'true: task_create; 4B review S7); a label from the caller''s own clients unless the Owner, and '
  'only an Active or Paused client (never Draft: Kickoff 4 decision 22; never Inactive: 4B review '
  'S6, WORKFLOWS §4), all checked when p_client_changed (a label set or changed; 4A review S1); a '
  'deadline, not in the past when p_new; event_date required for an event type and refused for the '
  'rest, times on that IST date and in order, purpose only on an event, location only when the type '
  'has one.';
