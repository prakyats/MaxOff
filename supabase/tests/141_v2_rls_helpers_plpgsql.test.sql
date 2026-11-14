-- v2.0 X3 (b) (2026-11-06, migration rls_helpers_plpgsql; DATA-MODEL §0 "RLS helpers"): the fifteen hot
-- helpers (the ten RLS helpers and five date and organisation helpers) were re-created as PL/pgSQL with their bodies unchanged. A DRIFT GUARD: each is held
-- equal to a reference copy of its SQL body (pg_temp.ref_*, the old `language sql` function), for
-- EVERY member in the database (active, deactivated, invited, freelancers) and every row it decides
-- (every task, client, member, permission key and task request, plus null and unknown ids), and
-- every attribute is checked (security definer, volatility, strictness, rows, search_path, grants).
-- Neutral names only.
begin;
create extension if not exists pgtap with schema extensions;
select plan(58);

-- The reference copies: the SQL bodies exactly as before the migration.
create function pg_temp.ref_current_member() returns setof public.members language sql stable security definer rows 1 set search_path = '' as $ref$
select m.* from public.members m
  where m.id = auth.uid() and m.status = 'active' and m.engagement = 'permanent';
$ref$;
create function pg_temp.ref_has_permission(key text) returns boolean language sql stable strict security definer set search_path = '' as $ref$
select exists (
    select 1
    from public.members m
    join public.role_permissions rp on rp.role = m.role
    where m.id = auth.uid() and m.status = 'active' and m.engagement = 'permanent'
      and rp.permission = key
  );
$ref$;
create function pg_temp.ref_is_owner() returns boolean language sql stable security definer set search_path = '' as $ref$
select coalesce((select m.role = 'owner' from app.current_member() m), false);
$ref$;
create function pg_temp.ref_task_visible(p_task_id uuid) returns boolean language sql stable security definer set search_path = '' as $ref$
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
$ref$;
create function pg_temp.ref_client_visible(p_client_id uuid) returns boolean language sql stable security definer set search_path = '' as $ref$
select exists (
    select 1
    from public.clients c
    where c.id = p_client_id
      and c.org_id = (select m.org_id from app.current_member() m)
      and ((select app.has_permission('clients.manage'))
           or ((select app.has_permission('clients.edit_assigned'))
               and c.admin_id = (select m.id from app.current_member() m)))
  );
$ref$;
create function pg_temp.ref_admin_client_ids() returns SETOF uuid language sql stable security definer set search_path = '' as $ref$
select c.id
  from public.clients c
  where c.org_id = (select m.org_id from app.current_member() m)
    and c.admin_id = (select m.id from app.current_member() m)
    and (select app.has_permission('clients.edit_assigned'));
$ref$;
create function pg_temp.ref_coordinator_of(p_member_id uuid) returns uuid language sql stable security definer set search_path = '' as $ref$
select mc.coordinator_id
  from public.member_coordinators mc
  where mc.member_id = p_member_id and mc.to_at is null;
$ref$;
create function pg_temp.ref_directory_visible_ids() returns SETOF uuid language sql stable security definer set search_path = '' as $ref$
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
$ref$;
create function pg_temp.ref_labelled_client_ids() returns SETOF uuid language sql stable security definer set search_path = '' as $ref$
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
$ref$;
create function pg_temp.ref_task_request_visible(p_requested_by uuid, p_client_id uuid) returns boolean language sql stable security definer set search_path = '' as $ref$
select (select app.is_owner())
    or p_requested_by = auth.uid()
    or ((select app.has_permission('task_requests.decide'))
        and ((p_client_id is null
              and not exists (select 1 from public.members m where m.id = p_requested_by and m.role = 'admin'))
             -- Never null: a null here would read as "not refused" in a plpgsql IF (the lock).
             or (p_client_id is not null and p_client_id in (select app.admin_client_ids()))));
$ref$;
create function pg_temp.ref_current_org_id() returns uuid language sql stable security definer set search_path = '' as $ref$
select coalesce(
    (select m.org_id from public.members m where m.id = auth.uid()),
    (select o.id from public.organizations o
      where not exists (select 1 from public.organizations o2 where o2.id <> o.id))
  );
$ref$;
create function pg_temp.ref_leave_covering(p_member_id uuid, d date) returns public.leave_requests language sql stable security definer set search_path = '' as $ref$
select r.*
  from public.leave_requests r
  where r.member_id = p_member_id and r.state = 'approved' and r.start_date <= d and r.end_date >= d
  order by r.decided_at desc, r.created_at desc
  limit 1;
$ref$;
create function pg_temp.ref_is_working_day(d date) returns boolean language sql stable security definer set search_path = '' as $ref$
select case
    when d is null then null
    -- No organization in scope: "unknown", never "yes" (DATA-MODEL §0a).
    when app.current_org_id() is null then null
    else not (
      exists (
        select 1
        from public.org_settings s
        where s.org_id = app.current_org_id()
          and extract(dow from d)::smallint = any (s.weekly_off_days)
      )
      or exists (
        select 1
        from public.holidays h
        where h.org_id = app.current_org_id() and h.date = d
      )
    )
  end;
$ref$;
create function pg_temp.ref_ist_day_start(d date) returns timestamp with time zone language sql stable strict set search_path = '' as $ref$
select (d::timestamp at time zone 'Asia/Kolkata');
$ref$;
create function pg_temp.ref_to_ist_date(ts timestamp with time zone) returns date language sql stable strict set search_path = '' as $ref$
select (ts at time zone 'Asia/Kolkata')::date;
$ref$;

create function pg_temp.as_member(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(uid::text, ''), true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end;
$$;

-- Fixtures, so every branch has rows to decide: tasks of every shape (assigned, created, approving
-- Admin, client-labelled, a freelancer's), a client of the Admin's, a coordinated freelancer, and
-- task requests with and without a client.
create temporary table fx (key text primary key, id uuid);
insert into fx values
  ('owner', '10000000-0000-4000-8000-000000000001'),
  ('admin', '10000000-0000-4000-8000-000000000002'),
  ('staff', '10000000-0000-4000-8000-000000000003'),
  ('client', '00000000-0000-4000-8000-000000014101'),
  ('free',   '00000000-0000-4000-8000-000000014102');
insert into fx select 'org', id from public.organizations limit 1;
insert into fx select 'type', id from public.task_types where org_id = (select id from fx where key = 'org') and kind = 'normal' order by position limit 1;
create function pg_temp.fx(k text) returns uuid language sql stable as $$ select id from fx where key = k; $$;
insert into public.clients (id, org_id, name, state, admin_id, activated_at) values
  (pg_temp.fx('client'), pg_temp.fx('org'), 'Guard client 141', 'active', pg_temp.fx('admin'), now()),
  (gen_random_uuid(), pg_temp.fx('org'), 'Guard other Admin client 141', 'active',
   (select m.id from public.members m where m.role = 'admin' and m.status = 'active' and m.id <> pg_temp.fx('admin') limit 1), now()),
  (gen_random_uuid(), pg_temp.fx('org'), 'Guard no Admin client 141', 'active', null, now());
insert into public.clients (org_id, name, admin_id) values (pg_temp.fx('org'), 'Guard draft client 141', pg_temp.fx('admin'));
insert into public.members (id, org_id, full_name, email, role, status, engagement, joined_at) values
  (pg_temp.fx('free'), pg_temp.fx('org'), 'Guard freelancer 141', null, 'staff', 'active', 'freelance', now() - interval '9 days');
insert into public.member_coordinators (member_id, coordinator_id, from_at) values (pg_temp.fx('free'), pg_temp.fx('admin'), now() - interval '1 day');
insert into public.tasks (org_id, title, task_type_id, priority, due_at, state, created_by, primary_owner_id, approving_admin_id, client_id) values
  (pg_temp.fx('org'), 'Guard 141 a', pg_temp.fx('type'), 'medium', now() + interval '2 days', 'todo', pg_temp.fx('owner'), pg_temp.fx('staff'), null, null),
  (pg_temp.fx('org'), 'Guard 141 b', pg_temp.fx('type'), 'medium', now() + interval '2 days', 'todo', pg_temp.fx('owner'), pg_temp.fx('staff'), pg_temp.fx('admin'), null),
  (pg_temp.fx('org'), 'Guard 141 c', pg_temp.fx('type'), 'medium', now() + interval '2 days', 'todo', pg_temp.fx('admin'), pg_temp.fx('admin'), null, pg_temp.fx('client')),
  (pg_temp.fx('org'), 'Guard 141 d', pg_temp.fx('type'), 'medium', now() + interval '2 days', 'todo', pg_temp.fx('owner'), pg_temp.fx('free'), null, null),
  (pg_temp.fx('org'), 'Guard 141 e', pg_temp.fx('type'), 'medium', now() + interval '2 days', 'todo', pg_temp.fx('owner'), pg_temp.fx('owner'), null, pg_temp.fx('client')),
  (pg_temp.fx('org'), 'Guard 141 f', pg_temp.fx('type'), 'medium', now() + interval '2 days', 'todo', pg_temp.fx('owner'), pg_temp.fx('staff'), null,
   (select id from public.clients where name = 'Guard other Admin client 141'));
insert into public.task_assignees (task_id, member_id, is_primary)
select t.id, t.primary_owner_id, true from public.tasks t where t.title like 'Guard 141 %';
insert into public.holidays (org_id, date, name) values (pg_temp.fx('org'), app.today_ist() + 3, 'Guard holiday 141');
insert into public.leave_requests (member_id, type, start_date, end_date, state, source, decided_at) values
  (pg_temp.fx('staff'), 'leave', app.today_ist() + 5, app.today_ist() + 7, 'approved', 'form', now() - interval '2 hours'),
  (pg_temp.fx('staff'), 'half_day', app.today_ist() + 6, app.today_ist() + 6, 'approved', 'form', now() - interval '1 hour');
insert into public.task_requests (org_id, requested_by, title, client_id) values
  (pg_temp.fx('org'), pg_temp.fx('staff'), 'Guard rq 141 a', null),
  (pg_temp.fx('org'), pg_temp.fx('staff'), 'Guard rq 141 b', pg_temp.fx('client'));

-- X5+ H1: a row for each branch of directory_visible_ids() that had none here, each naming a
-- person of its own (a comment, a stage, a submission, a review, approver_changed naming a uuid
-- and a non-uuid, a removed assignee), an ended coordinator and an inactive freelancer.
insert into fx values
  ('commenter',    '00000000-0000-4000-8000-000000014111'),
  ('stager',       '00000000-0000-4000-8000-000000014112'),
  ('submitter',    '00000000-0000-4000-8000-000000014113'),
  ('reviewer',     '00000000-0000-4000-8000-000000014114'),
  ('was_approver', '00000000-0000-4000-8000-000000014115'),
  ('removed',      '00000000-0000-4000-8000-000000014116'),
  ('ended_coord',  '00000000-0000-4000-8000-000000014117'),
  ('gone_free',    '00000000-0000-4000-8000-000000014118');
insert into auth.users (id, email)
select pg_temp.fx(k), 'guard-' || k || '-141@example.com'
from unnest(array['commenter', 'stager', 'submitter', 'reviewer', 'was_approver', 'removed', 'ended_coord']) k;
insert into public.members (id, org_id, full_name, email, role, status, engagement, joined_at, deactivated_at)
select pg_temp.fx(k), pg_temp.fx('org'), 'Guard ' || k || ' 141', 'guard-' || k || '-141@example.com',
       r::public.member_role, 'active', 'permanent', now() - interval '20 days', null
from (values ('commenter', 'staff'), ('stager', 'staff'), ('submitter', 'staff'), ('reviewer', 'admin'),
             ('was_approver', 'admin'), ('removed', 'staff'), ('ended_coord', 'admin')) v(k, r);
insert into public.members (id, org_id, full_name, email, role, status, engagement, joined_at, deactivated_at) values
  (pg_temp.fx('gone_free'), pg_temp.fx('org'), 'Guard gone freelancer 141', null, 'staff', 'deactivated', 'freelance',
   now() - interval '20 days', now() - interval '1 day');
insert into fx select 'task_a', id from public.tasks where title = 'Guard 141 a';
insert into public.task_comments (task_id, author_id, body) values (pg_temp.fx('task_a'), pg_temp.fx('commenter'), 'Guard comment 141');
insert into public.task_stages (task_id, name, done_at, done_by) values (pg_temp.fx('task_a'), 'Guard stage 141', now(), pg_temp.fx('stager'));
insert into public.task_submissions (task_id, version, submitted_by) values (pg_temp.fx('task_a'), 1, pg_temp.fx('submitter'));
insert into public.task_reviews (task_id, step, decision, reviewer_id) values (pg_temp.fx('task_a'), 'admin', 'approved', pg_temp.fx('reviewer'));
insert into public.activity_log (org_id, actor_id, entity, entity_id, action, meta) values
  (pg_temp.fx('org'), pg_temp.fx('owner'), 'tasks', pg_temp.fx('task_a'), 'approver_changed',
   jsonb_build_object('from', pg_temp.fx('was_approver'), 'to', 'not a uuid'));
insert into public.task_assignees (task_id, member_id, is_primary, removed_at) values
  (pg_temp.fx('task_a'), pg_temp.fx('removed'), false, now() - interval '1 hour');
-- The freelancer had another coordinator before the Admin (ended), and the Admin also coordinates
-- a deactivated freelancer, whose task the coordination never shows.
insert into public.member_coordinators (member_id, coordinator_id, from_at, to_at) values
  (pg_temp.fx('free'), pg_temp.fx('ended_coord'), now() - interval '8 days', now() - interval '2 days'),
  (pg_temp.fx('gone_free'), pg_temp.fx('admin'), now() - interval '8 days', null);
insert into public.tasks (org_id, title, task_type_id, priority, due_at, state, created_by, primary_owner_id) values
  (pg_temp.fx('org'), 'Guard 141 g', pg_temp.fx('type'), 'medium', now() + interval '2 days', 'todo', pg_temp.fx('owner'), pg_temp.fx('gone_free'));
insert into public.task_assignees (task_id, member_id, is_primary)
select t.id, t.primary_owner_id, true from public.tasks t where t.title = 'Guard 141 g';

-- X5+ C2: a second organisation with a member in each role, a task, an Admin's client, a request,
-- a holiday and other weekly days off. The guard below runs over its people too.
insert into fx values
  ('org_b',       '00000000-0000-4000-8000-000000014120'),
  ('b_owner',     '00000000-0000-4000-8000-000000014121'),
  ('b_admin',     '00000000-0000-4000-8000-000000014122'),
  ('b_staff',     '00000000-0000-4000-8000-000000014123'),
  ('b_client',    '00000000-0000-4000-8000-000000014124'),
  ('b_type',      '00000000-0000-4000-8000-000000014125');
insert into public.organizations (id, name) values (pg_temp.fx('org_b'), 'Guard other org 141');
insert into auth.users (id, email)
select pg_temp.fx(k), 'guard-' || k || '-141@example.com' from unnest(array['b_owner', 'b_admin', 'b_staff']) k;
insert into public.members (id, org_id, full_name, email, role, status, engagement, joined_at)
select pg_temp.fx(k), pg_temp.fx('org_b'), 'Guard ' || k || ' 141', 'guard-' || k || '-141@example.com',
       r::public.member_role, 'active', 'permanent', now() - interval '20 days'
from (values ('b_owner', 'owner'), ('b_admin', 'admin'), ('b_staff', 'staff')) v(k, r);
-- Written as org B's Owner: with two organisations and no session, the audit trigger has no
-- organisation to file a row under (current_org_id() is null, as C2 checks below).
select pg_temp.as_member(pg_temp.fx('b_owner'));
insert into public.task_types (id, org_id, name) values (pg_temp.fx('b_type'), pg_temp.fx('org_b'), 'Guard type 141');
insert into public.clients (id, org_id, name, state, admin_id, activated_at) values
  (pg_temp.fx('b_client'), pg_temp.fx('org_b'), 'Guard B client 141', 'active', pg_temp.fx('b_admin'), now());
insert into public.tasks (org_id, title, task_type_id, priority, due_at, state, created_by, primary_owner_id, client_id) values
  (pg_temp.fx('org_b'), 'Guard 141 B', pg_temp.fx('b_type'), 'medium', now() + interval '2 days', 'todo',
   pg_temp.fx('b_owner'), pg_temp.fx('b_staff'), pg_temp.fx('b_client'));
insert into fx select 'b_task', id from public.tasks where title = 'Guard 141 B';
insert into public.task_assignees (task_id, member_id, is_primary) values (pg_temp.fx('b_task'), pg_temp.fx('b_staff'), true);
insert into public.task_requests (org_id, requested_by, title, client_id) values
  (pg_temp.fx('org_b'), pg_temp.fx('b_staff'), 'Guard rq 141 B', pg_temp.fx('b_client'));
insert into public.holidays (org_id, date, name) values (pg_temp.fx('org_b'), app.today_ist() + 4, 'Guard B holiday 141');
update public.org_settings set weekly_off_days = '{2}' where org_id = pg_temp.fx('org_b');
select pg_temp.as_member(null);

-- Every caller: every member, and no one (null).
create temporary table callers as select m.id from public.members m union all select null::uuid;
-- Every row each helper decides, plus null and an unknown id.
create temporary table task_ids as select id from public.tasks union all select null::uuid union all select '00000000-0000-4000-8000-000000014199'::uuid;
create temporary table client_ids as select id from public.clients union all select null::uuid union all select '00000000-0000-4000-8000-000000014198'::uuid;
create temporary table member_ids as select id from public.members union all select null::uuid;
create temporary table perm_keys as select distinct permission as key from public.role_permissions union all select 'no.such.key' union all select null;
create temporary table days as select app.today_ist() + n as d from generate_series(-10, 40) n union all select null::date;
create temporary table instants as select now() + make_interval(hours => n * 7) as ts from generate_series(-30, 30) n union all select null::timestamptz;
create temporary table requests as select requested_by, client_id from public.task_requests
  union all select m.id, c.id from (select id from public.members limit 5) m cross join (select id from public.clients limit 3) c;

-- The mismatches of one helper, over every caller (0 = equal everywhere).
create temporary table mismatch (helper text, n bigint);
create function pg_temp.check_all() returns void language plpgsql as $$
declare c uuid; n bigint;
begin
  for c in select id from callers loop
    perform pg_temp.as_member(c);
    insert into mismatch select 'current_member', count(*) from (
      (select to_jsonb(x) from app.current_member() x except all select to_jsonb(y) from pg_temp.ref_current_member() y)
      union all (select to_jsonb(y) from pg_temp.ref_current_member() y except all select to_jsonb(x) from app.current_member() x)) d;
    insert into mismatch select 'is_owner', count(*) where app.is_owner() is distinct from pg_temp.ref_is_owner();
    insert into mismatch select 'has_permission', count(*) from perm_keys k where app.has_permission(k.key) is distinct from pg_temp.ref_has_permission(k.key);
    insert into mismatch select 'task_visible', count(*) from task_ids t where app.task_visible(t.id) is distinct from pg_temp.ref_task_visible(t.id);
    insert into mismatch select 'client_visible', count(*) from client_ids k where app.client_visible(k.id) is distinct from pg_temp.ref_client_visible(k.id);
    insert into mismatch select 'coordinator_of', count(*) from member_ids m where app.coordinator_of(m.id) is distinct from pg_temp.ref_coordinator_of(m.id);
    insert into mismatch select 'task_request_visible', count(*) from requests r
      where app.task_request_visible(r.requested_by, r.client_id) is distinct from pg_temp.ref_task_request_visible(r.requested_by, r.client_id);
    insert into mismatch select 'admin_client_ids', count(*) from (
      (select app.admin_client_ids() except all select pg_temp.ref_admin_client_ids())
      union all (select pg_temp.ref_admin_client_ids() except all select app.admin_client_ids())) d;
    insert into mismatch select 'directory_visible_ids', count(*) from (
      (select app.directory_visible_ids() except all select pg_temp.ref_directory_visible_ids())
      union all (select pg_temp.ref_directory_visible_ids() except all select app.directory_visible_ids())) d;
    insert into mismatch select 'labelled_client_ids', count(*) from (
      (select app.labelled_client_ids() except all select pg_temp.ref_labelled_client_ids())
      union all (select pg_temp.ref_labelled_client_ids() except all select app.labelled_client_ids())) d;
    insert into mismatch select 'current_org_id', count(*) where app.current_org_id() is distinct from pg_temp.ref_current_org_id();
    insert into mismatch select 'is_working_day', count(*) from days x where app.is_working_day(x.d) is distinct from pg_temp.ref_is_working_day(x.d);
  end loop;
  -- Not caller-dependent (no auth.uid() in them): once, over every member, day and instant.
  insert into mismatch select 'leave_covering', count(*) from member_ids m cross join days x
    where to_jsonb(app.leave_covering(m.id, x.d)) is distinct from to_jsonb(pg_temp.ref_leave_covering(m.id, x.d));
  insert into mismatch select 'ist_day_start', count(*) from days x where app.ist_day_start(x.d) is distinct from pg_temp.ref_ist_day_start(x.d);
  insert into mismatch select 'to_ist_date', count(*) from instants x where app.to_ist_date(x.ts) is distinct from pg_temp.ref_to_ist_date(x.ts);
end;
$$;
select pg_temp.check_all();

-- 1. The drift guard: equal for every caller and every row ---------------------------------------------
select is((select sum(n) from mismatch where helper = h), 0::numeric, h || ': equal to its SQL body for every member and row')
from unnest(array['current_member', 'is_owner', 'has_permission', 'task_visible', 'client_visible', 'coordinator_of',
                  'task_request_visible', 'admin_client_ids', 'directory_visible_ids', 'labelled_client_ids',
                  'current_org_id', 'is_working_day', 'leave_covering', 'ist_day_start', 'to_ist_date']) h;
select ok((select count(*) from callers) > 10, 'the guard ran over many members (and no one)');
select ok((select count(*) from task_ids) > 5 and (select count(*) from client_ids) > 3, '... and over many tasks and clients');
-- The guard is not vacuous: the reference shows something true and something false for one caller.
select pg_temp.as_member(pg_temp.fx('staff'));
select ok(pg_temp.ref_task_visible((select id from public.tasks where title = 'Guard 141 a'))
          and not pg_temp.ref_task_visible((select id from public.tasks where title = 'Guard 141 c')),
  'Crew sees their task and not the Admin''s client task (both by the reference)');
select ok(pg_temp.ref_is_working_day(app.today_ist() + 3) is false
          and (pg_temp.ref_leave_covering(pg_temp.fx('staff'), app.today_ist() + 6)).type = 'half_day',
  'the holiday is a day off, and the latest-decided leave covers its day (both by the reference)');

-- X5+ H1: each helper the guard compares is true somewhere and false somewhere (by the reference).
select pg_temp.as_member(pg_temp.fx('admin'));
select ok(pg_temp.fx('client') in (select pg_temp.ref_admin_client_ids())
          and (select id from public.clients where name = 'Guard other Admin client 141') not in (select pg_temp.ref_admin_client_ids()),
  'admin_client_ids: the Admin''s client, not another Admin''s');
select ok(pg_temp.ref_client_visible(pg_temp.fx('client'))
          and not pg_temp.ref_client_visible((select id from public.clients where name = 'Guard other Admin client 141')),
  'client_visible: true and false for the Admin');
select ok(pg_temp.ref_task_request_visible(pg_temp.fx('staff'), pg_temp.fx('client'))
          and not pg_temp.ref_task_request_visible(pg_temp.fx('staff'), (select id from public.clients where name = 'Guard other Admin client 141')),
  'task_request_visible: a Crew request on the Admin''s client, not on another Admin''s');
select ok(pg_temp.ref_coordinator_of(pg_temp.fx('free')) = pg_temp.fx('admin')
          and pg_temp.ref_coordinator_of(pg_temp.fx('staff')) is null,
  'coordinator_of: the current coordinator (the ended one is not), none for a permanent member');
select ok(pg_temp.ref_task_visible((select id from public.tasks where title = 'Guard 141 d'))
          and not pg_temp.ref_task_visible((select id from public.tasks where title = 'Guard 141 g')),
  'the coordinator sees an active freelancer''s task, never an inactive one''s');
select pg_temp.as_member(pg_temp.fx('ended_coord'));
select ok(not pg_temp.ref_task_visible((select id from public.tasks where title = 'Guard 141 d')),
  'an ended coordinator no longer sees the freelancer''s task');
select pg_temp.as_member(pg_temp.fx('staff'));
select ok((select id from public.clients where name = 'Guard other Admin client 141') in (select pg_temp.ref_labelled_client_ids())
          and pg_temp.fx('client') not in (select pg_temp.ref_labelled_client_ids()),
  'labelled_client_ids: a label on Crew''s own task, not on a task they are not on');
select ok(array(select pg_temp.fx(k) from unnest(array['commenter', 'stager', 'submitter', 'reviewer', 'was_approver', 'removed']) k)
          <@ array(select pg_temp.ref_directory_visible_ids()),
  'directory_visible_ids names whoever commented, ticked, handed in, reviewed, was the approver or was removed');

-- X5+ C2: nothing crosses organisations, and no member means no organisation.
select pg_temp.as_member(pg_temp.fx('owner'));
select ok(not app.task_visible(pg_temp.fx('b_task')), 'the Owner never sees another organisation''s task');
select ok(not app.client_visible(pg_temp.fx('b_client')), '... nor its client');
select is((select count(*) from app.directory_visible_ids() d
           where d in (select pg_temp.fx(k) from unnest(array['b_owner', 'b_admin', 'b_staff']) k)), 0::bigint,
  '... nor its people in the directory');
select pg_temp.as_member(pg_temp.fx('b_owner'));
select ok(app.task_visible(pg_temp.fx('b_task')) and app.current_org_id() = pg_temp.fx('org_b'),
  'its own Owner sees it (the check is not vacuous)');
select pg_temp.as_member(null);
select ok(app.current_org_id() is null, 'no member, two organisations: no organisation');
select ok(app.is_working_day(app.today_ist() + 4) is null, '... and a day is unknown, never a working day of either');

-- 2. Every attribute kept --------------------------------------------------------------------------------
select is((select count(*) from pg_proc p where p.pronamespace = 'app'::regnamespace
             and p.proname in ('current_member', 'has_permission', 'is_owner', 'task_visible', 'client_visible', 'admin_client_ids',
                               'coordinator_of', 'directory_visible_ids', 'labelled_client_ids', 'task_request_visible',
                               'current_org_id', 'is_working_day', 'leave_covering', 'ist_day_start', 'to_ist_date')
             and p.prolang = (select oid from pg_language where lanname = 'plpgsql')), 15::bigint, 'the fifteen are PL/pgSQL');
select is((select count(*) from pg_proc p where p.pronamespace = 'app'::regnamespace
             and p.proname in ('ist_day_start', 'to_ist_date') and not p.prosecdef and p.proisstrict and p.provolatile = 's'
             and p.proconfig = array['search_path=""']), 2::bigint, 'the two date helpers stay invoker, strict, stable');
select is((select count(*) from pg_proc p where p.pronamespace = 'app'::regnamespace
             and p.proname in ('current_member', 'has_permission', 'is_owner', 'task_visible', 'client_visible', 'admin_client_ids',
                               'coordinator_of', 'directory_visible_ids', 'labelled_client_ids', 'task_request_visible')
             and p.prosecdef and p.provolatile = 's' and p.proconfig = array['search_path=""']), 10::bigint,
  'each security definer, stable, with the empty search_path');
select ok((select proisstrict from pg_proc where oid = 'app.has_permission(text)'::regprocedure), 'has_permission stays strict');
select is((select prorows from pg_proc where oid = 'app.current_member()'::regprocedure), 1::real, 'current_member keeps rows 1');
select ok(has_function_privilege('authenticated', 'app.task_visible(uuid)', 'execute')
          and has_function_privilege('authenticated', 'app.current_member()', 'execute')
          and not has_function_privilege('anon', 'app.task_visible(uuid)', 'execute'), 'the grants are unchanged');
select ok(pg_temp.ref_has_permission(null) is null and app.has_permission(null) is null, 'strict: a null key is null both ways');

-- 3. Every attribute per function, against its value before the migration (the advisor, #89) --------
select is((select concat_ws('|', p.prosecdef, p.provolatile, p.proisstrict, p.proparallel, p.proleakproof, p.prorows, p.proretset, pg_get_function_result(p.oid), p.proconfig, p.proacl, p.procost) from pg_proc p where p.pronamespace = 'app'::regnamespace and p.proname = 'admin_client_ids'),
  $exp$t|s|f|u|f|1000|t|SETOF uuid|{"search_path=\"\""}|{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}|100$exp$, 'admin_client_ids: every attribute as before (secdef, volatility, strict, parallel, leakproof, rows, retset, result, config, ACL, cost)');
select is((select concat_ws('|', p.prosecdef, p.provolatile, p.proisstrict, p.proparallel, p.proleakproof, p.prorows, p.proretset, pg_get_function_result(p.oid), p.proconfig, p.proacl, p.procost) from pg_proc p where p.pronamespace = 'app'::regnamespace and p.proname = 'client_visible'),
  $exp$t|s|f|u|f|0|f|boolean|{"search_path=\"\""}|{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}|100$exp$, 'client_visible: every attribute as before (secdef, volatility, strict, parallel, leakproof, rows, retset, result, config, ACL, cost)');
select is((select concat_ws('|', p.prosecdef, p.provolatile, p.proisstrict, p.proparallel, p.proleakproof, p.prorows, p.proretset, pg_get_function_result(p.oid), p.proconfig, p.proacl, p.procost) from pg_proc p where p.pronamespace = 'app'::regnamespace and p.proname = 'coordinator_of'),
  $exp$t|s|f|u|f|0|f|uuid|{"search_path=\"\""}|{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}|100$exp$, 'coordinator_of: every attribute as before (secdef, volatility, strict, parallel, leakproof, rows, retset, result, config, ACL, cost)');
select is((select concat_ws('|', p.prosecdef, p.provolatile, p.proisstrict, p.proparallel, p.proleakproof, p.prorows, p.proretset, pg_get_function_result(p.oid), p.proconfig, p.proacl, p.procost) from pg_proc p where p.pronamespace = 'app'::regnamespace and p.proname = 'current_member'),
  $exp$t|s|f|u|f|1|t|SETOF members|{"search_path=\"\""}|{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}|100$exp$, 'current_member: every attribute as before (secdef, volatility, strict, parallel, leakproof, rows, retset, result, config, ACL, cost)');
select is((select concat_ws('|', p.prosecdef, p.provolatile, p.proisstrict, p.proparallel, p.proleakproof, p.prorows, p.proretset, pg_get_function_result(p.oid), p.proconfig, p.proacl, p.procost) from pg_proc p where p.pronamespace = 'app'::regnamespace and p.proname = 'current_org_id'),
  $exp$t|s|f|u|f|0|f|uuid|{"search_path=\"\""}|{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}|100$exp$, 'current_org_id: every attribute as before (secdef, volatility, strict, parallel, leakproof, rows, retset, result, config, ACL, cost)');
select is((select concat_ws('|', p.prosecdef, p.provolatile, p.proisstrict, p.proparallel, p.proleakproof, p.prorows, p.proretset, pg_get_function_result(p.oid), p.proconfig, p.proacl, p.procost) from pg_proc p where p.pronamespace = 'app'::regnamespace and p.proname = 'directory_visible_ids'),
  $exp$t|s|f|u|f|1000|t|SETOF uuid|{"search_path=\"\""}|{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}|100$exp$, 'directory_visible_ids: every attribute as before (secdef, volatility, strict, parallel, leakproof, rows, retset, result, config, ACL, cost)');
select is((select concat_ws('|', p.prosecdef, p.provolatile, p.proisstrict, p.proparallel, p.proleakproof, p.prorows, p.proretset, pg_get_function_result(p.oid), p.proconfig, p.proacl, p.procost) from pg_proc p where p.pronamespace = 'app'::regnamespace and p.proname = 'has_permission'),
  $exp$t|s|t|u|f|0|f|boolean|{"search_path=\"\""}|{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}|100$exp$, 'has_permission: every attribute as before (secdef, volatility, strict, parallel, leakproof, rows, retset, result, config, ACL, cost)');
select is((select concat_ws('|', p.prosecdef, p.provolatile, p.proisstrict, p.proparallel, p.proleakproof, p.prorows, p.proretset, pg_get_function_result(p.oid), p.proconfig, p.proacl, p.procost) from pg_proc p where p.pronamespace = 'app'::regnamespace and p.proname = 'is_owner'),
  $exp$t|s|f|u|f|0|f|boolean|{"search_path=\"\""}|{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}|100$exp$, 'is_owner: every attribute as before (secdef, volatility, strict, parallel, leakproof, rows, retset, result, config, ACL, cost)');
select is((select concat_ws('|', p.prosecdef, p.provolatile, p.proisstrict, p.proparallel, p.proleakproof, p.prorows, p.proretset, pg_get_function_result(p.oid), p.proconfig, p.proacl, p.procost) from pg_proc p where p.pronamespace = 'app'::regnamespace and p.proname = 'is_working_day'),
  $exp$t|s|f|s|f|0|f|boolean|{"search_path=\"\""}|{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}|100$exp$, 'is_working_day: every attribute as before (secdef, volatility, strict, parallel, leakproof, rows, retset, result, config, ACL, cost)');
select is((select concat_ws('|', p.prosecdef, p.provolatile, p.proisstrict, p.proparallel, p.proleakproof, p.prorows, p.proretset, pg_get_function_result(p.oid), p.proconfig, p.proacl, p.procost) from pg_proc p where p.pronamespace = 'app'::regnamespace and p.proname = 'ist_day_start'),
  $exp$f|s|t|s|f|0|f|timestamp with time zone|{"search_path=\"\""}|{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}|100$exp$, 'ist_day_start: every attribute as before (secdef, volatility, strict, parallel, leakproof, rows, retset, result, config, ACL, cost)');
select is((select concat_ws('|', p.prosecdef, p.provolatile, p.proisstrict, p.proparallel, p.proleakproof, p.prorows, p.proretset, pg_get_function_result(p.oid), p.proconfig, p.proacl, p.procost) from pg_proc p where p.pronamespace = 'app'::regnamespace and p.proname = 'labelled_client_ids'),
  $exp$t|s|f|u|f|1000|t|SETOF uuid|{"search_path=\"\""}|{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}|100$exp$, 'labelled_client_ids: every attribute as before (secdef, volatility, strict, parallel, leakproof, rows, retset, result, config, ACL, cost)');
select is((select concat_ws('|', p.prosecdef, p.provolatile, p.proisstrict, p.proparallel, p.proleakproof, p.prorows, p.proretset, pg_get_function_result(p.oid), p.proconfig, p.proacl, p.procost) from pg_proc p where p.pronamespace = 'app'::regnamespace and p.proname = 'leave_covering'),
  $exp$t|s|f|u|f|0|f|leave_requests|{"search_path=\"\""}|{postgres=X/postgres,service_role=X/postgres}|100$exp$, 'leave_covering: every attribute as before (secdef, volatility, strict, parallel, leakproof, rows, retset, result, config, ACL, cost)');
select is((select concat_ws('|', p.prosecdef, p.provolatile, p.proisstrict, p.proparallel, p.proleakproof, p.prorows, p.proretset, pg_get_function_result(p.oid), p.proconfig, p.proacl, p.procost) from pg_proc p where p.pronamespace = 'app'::regnamespace and p.proname = 'task_request_visible'),
  $exp$t|s|f|u|f|0|f|boolean|{"search_path=\"\""}|{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}|100$exp$, 'task_request_visible: every attribute as before (secdef, volatility, strict, parallel, leakproof, rows, retset, result, config, ACL, cost)');
select is((select concat_ws('|', p.prosecdef, p.provolatile, p.proisstrict, p.proparallel, p.proleakproof, p.prorows, p.proretset, pg_get_function_result(p.oid), p.proconfig, p.proacl, p.procost) from pg_proc p where p.pronamespace = 'app'::regnamespace and p.proname = 'task_visible'),
  $exp$t|s|f|u|f|0|f|boolean|{"search_path=\"\""}|{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}|100$exp$, 'task_visible: every attribute as before (secdef, volatility, strict, parallel, leakproof, rows, retset, result, config, ACL, cost)');
select is((select concat_ws('|', p.prosecdef, p.provolatile, p.proisstrict, p.proparallel, p.proleakproof, p.prorows, p.proretset, pg_get_function_result(p.oid), p.proconfig, p.proacl, p.procost) from pg_proc p where p.pronamespace = 'app'::regnamespace and p.proname = 'to_ist_date'),
  $exp$f|s|t|s|f|0|f|date|{"search_path=\"\""}|{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}|100$exp$, 'to_ist_date: every attribute as before (secdef, volatility, strict, parallel, leakproof, rows, retset, result, config, ACL, cost)');
select is((select count(*) from pg_index i where coalesce(pg_get_expr(i.indexprs, i.indrelid), '') ~ '(admin_client_ids|client_visible|coordinator_of|current_member|current_org_id|directory_visible_ids|has_permission|is_owner|is_working_day|ist_day_start|labelled_client_ids|leave_covering|task_request_visible|task_visible|to_ist_date)\(' or coalesce(pg_get_expr(i.indpred, i.indrelid), '') ~ '(admin_client_ids|client_visible|coordinator_of|current_member|current_org_id|directory_visible_ids|has_permission|is_owner|is_working_day|ist_day_start|labelled_client_ids|leave_covering|task_request_visible|task_visible|to_ist_date)\('), 0::bigint,
  'none of the fifteen is in an index expression or predicate');
select is((select count(*) from pg_constraint c where c.contype = 'c' and pg_get_constraintdef(c.oid) ~ '(admin_client_ids|client_visible|coordinator_of|current_member|current_org_id|directory_visible_ids|has_permission|is_owner|is_working_day|ist_day_start|labelled_client_ids|leave_covering|task_request_visible|task_visible|to_ist_date)\('), 0::bigint,
  'none of the fifteen is in a check constraint');
select is((select count(*) from pg_attrdef a join pg_attribute att on att.attrelid = a.adrelid and att.attnum = a.adnum
             where att.attgenerated <> '' and pg_get_expr(a.adbin, a.adrelid) ~ '(admin_client_ids|client_visible|coordinator_of|current_member|current_org_id|directory_visible_ids|has_permission|is_owner|is_working_day|ist_day_start|labelled_client_ids|leave_covering|task_request_visible|task_visible|to_ist_date)\('), 0::bigint,
  'none of the fifteen is in a generated column (plain defaults only: org_id default app.current_org_id())');

select * from finish();
rollback;
