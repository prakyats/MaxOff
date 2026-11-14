-- X5+ (#89 6785187529, "the §3 role gaps"; PERMISSIONS §3): the v2.0 X3 folds and helpers for the
-- callers their own files leave out. Who may execute the four member-only reads (never service_role);
-- service_role without a member (no `sub`) on the two security-definer reads it may call; a
-- deactivated and an invited member on the page folds (135 own_week's counts, 136
-- templates_library, 137 task_page, 139 client_overview, 140 project_page): RLS gives them
-- nothing; and one shared second organisation, so each invoker fold proves no cross-org ids.
-- Neutral names only.
begin;
create extension if not exists pgtap with schema extensions;
select plan(25);

create temporary table fx (key text primary key, id uuid);
insert into fx values
  ('owner',    '10000000-0000-4000-8000-000000000001'),
  ('admin',    '10000000-0000-4000-8000-000000000002'),
  ('staff',    '10000000-0000-4000-8000-000000000003'),
  ('gone',     '00000000-0000-4000-8000-000000014301'),
  ('invited',  '00000000-0000-4000-8000-000000014302'),
  ('client',   '00000000-0000-4000-8000-000000014303'),
  ('org_b',    '00000000-0000-4000-8000-000000014310'),
  ('b_owner',  '00000000-0000-4000-8000-000000014311'),
  ('b_admin',  '00000000-0000-4000-8000-000000014312'),
  ('b_staff',  '00000000-0000-4000-8000-000000014313'),
  ('b_client', '00000000-0000-4000-8000-000000014314'),
  ('b_type',   '00000000-0000-4000-8000-000000014315');
insert into fx select 'org', id from public.organizations order by created_at limit 1;
insert into fx select 'type', id from public.task_types where org_id = (select id from fx where key = 'org') and kind = 'normal' order by position limit 1;
grant select, insert on fx to authenticated;
create function pg_temp.fx(k text) returns uuid language sql stable as $$ select id from fx where key = k; $$;
create function pg_temp.as_member(k text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(pg_temp.fx(k)::text, ''), true);
  perform set_config('request.jwt.claims', json_build_object('sub', pg_temp.fx(k), 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end;
$$;
create function pg_temp.as_system() returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', '', true);
end;
$$;
create function pg_temp.raised(sql text) returns text language plpgsql as $$
begin
  execute sql;
  return null;
exception when others then
  return sqlerrm;
end;
$$;

-- Org A: the Admin's client with a contact, the Admin's project, a client task, a pending request
-- the Owner decides; a deactivated and an invited Admin.
insert into public.clients (id, org_id, name, state, admin_id, activated_at) values
  (pg_temp.fx('client'), pg_temp.fx('org'), 'Gaps client 143', 'active', pg_temp.fx('admin'), now());
insert into public.client_contacts (client_id, name, is_primary) values (pg_temp.fx('client'), 'Gaps contact 143', true);
insert into public.tasks (org_id, title, task_type_id, priority, due_at, state, created_by, primary_owner_id, client_id) values
  (pg_temp.fx('org'), 'Gaps task 143', pg_temp.fx('type'), 'medium', now() + interval '2 days', 'todo',
   pg_temp.fx('owner'), pg_temp.fx('staff'), pg_temp.fx('client'));
insert into fx select 'task', id from public.tasks where title = 'Gaps task 143';
insert into public.task_assignees (task_id, member_id, is_primary) values (pg_temp.fx('task'), pg_temp.fx('staff'), true);
insert into public.task_requests (org_id, requested_by, title, client_id) values
  (pg_temp.fx('org'), pg_temp.fx('staff'), 'Gaps request 143', null);
insert into auth.users (id, email) values
  (pg_temp.fx('gone'), 'gaps-gone-14301@example.com'), (pg_temp.fx('invited'), 'gaps-invited-14302@example.com');
insert into public.members (id, org_id, full_name, email, role, status, engagement, joined_at, deactivated_at) values
  (pg_temp.fx('gone'),    pg_temp.fx('org'), 'Gaps gone 143',    'gaps-gone-14301@example.com',    'admin', 'deactivated', 'permanent', now() - interval '9 days', now()),
  (pg_temp.fx('invited'), pg_temp.fx('org'), 'Gaps invited 143', 'gaps-invited-14302@example.com', 'admin', 'invited',     'permanent', null, null);
select pg_temp.as_member('admin');
insert into fx values ('project', public.project_create(pg_temp.fx('client'), 'Gaps project 143', 'monthly',
  stages => array['Shoot'], items => array['Gaps reel 143']));
select pg_temp.as_system();

-- Org B, shared by the cross-org checks: a member in each role, an Admin's client with a contact and
-- a project, a task, a task type and a holiday (written as its own people: the audit trigger files
-- each row under the writer's organisation).
insert into public.organizations (id, name) values (pg_temp.fx('org_b'), 'Gaps other org 143');
insert into auth.users (id, email)
select pg_temp.fx(k), 'gaps-' || k || '-143@example.com' from unnest(array['b_owner', 'b_admin', 'b_staff']) k;
insert into public.members (id, org_id, full_name, email, role, status, engagement, joined_at)
select pg_temp.fx(k), pg_temp.fx('org_b'), 'Gaps ' || k || ' 143', 'gaps-' || k || '-143@example.com',
       r::public.member_role, 'active', 'permanent', now() - interval '20 days'
from (values ('b_owner', 'owner'), ('b_admin', 'admin'), ('b_staff', 'staff')) v(k, r);
select pg_temp.as_member('b_owner');
reset role;
insert into public.task_types (id, org_id, name) values (pg_temp.fx('b_type'), pg_temp.fx('org_b'), 'Gaps B type 143');
insert into public.clients (id, org_id, name, state, admin_id, activated_at) values
  (pg_temp.fx('b_client'), pg_temp.fx('org_b'), 'Gaps B client 143', 'active', pg_temp.fx('b_admin'), now());
insert into public.client_contacts (client_id, name, is_primary) values (pg_temp.fx('b_client'), 'Gaps B contact 143', true);
insert into public.tasks (org_id, title, task_type_id, priority, due_at, state, created_by, primary_owner_id, client_id) values
  (pg_temp.fx('org_b'), 'Gaps B task 143', pg_temp.fx('b_type'), 'medium', now() + interval '2 days', 'todo',
   pg_temp.fx('b_owner'), pg_temp.fx('b_staff'), pg_temp.fx('b_client'));
insert into fx select 'b_task', id from public.tasks where title = 'Gaps B task 143';
insert into public.task_assignees (task_id, member_id, is_primary) values (pg_temp.fx('b_task'), pg_temp.fx('b_staff'), true);
insert into public.holidays (org_id, date, name) values (pg_temp.fx('org_b'), app.today_ist() + 2, 'Gaps B holiday 143');
select pg_temp.as_member('b_admin');
insert into fx values ('b_project', public.project_create(pg_temp.fx('b_client'), 'Gaps B project 143', 'monthly',
  stages => array['Shoot'], items => array['Gaps B reel 143']));
select pg_temp.as_system();

-- 1. Member-only reads: never service_role (PERMISSIONS §3) -----------------------------------------
select ok(not has_function_privilege('service_role', 'public.own_week(date, date)', 'execute'), 'own_week: not service_role');
select ok(not has_function_privilege('service_role', 'public.attendance_board_today()', 'execute'), 'attendance_board_today: not service_role');
select ok(not has_function_privilege('service_role', 'public.own_comp_leave()', 'execute'), 'own_comp_leave: not service_role');
select ok(not has_function_privilege('service_role', 'public.working_day_rule(date, date)', 'execute'), 'working_day_rule: not service_role');

-- 2. service_role with no member (no `sub`) on the security-definer reads it may call --------------
select pg_temp.as_member('owner');
select ok(app.requests_to_decide_count() > 0, 'the Owner counts the pending request (so the next 0 is not vacuous)');
select pg_temp.as_system();
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select is(pg_temp.raised('select * from public.attendance_hours_today()'), 'UNAUTHENTICATED',
  'attendance_hours_today: service_role without a member is refused');
select is(app.requests_to_decide_count(), 0, 'requests_to_decide_count: service_role without a member counts nothing');
select pg_temp.as_system();

-- 3. A deactivated and an invited member get nothing from the page folds ------------------------------
select pg_temp.as_member('gone');
select is(public.task_page(pg_temp.fx('task'), 20, 20)->'task', 'null'::jsonb, 'deactivated: task_page has no task');
select is(public.client_overview(pg_temp.fx('client'))->'contacts', '[]'::jsonb, 'deactivated: client_overview has no contacts');
select is(public.project_page(pg_temp.fx('project'))->'project', 'null'::jsonb, 'deactivated: project_page has no project');
select is(public.templates_library()->'task_types', '[]'::jsonb, 'deactivated: templates_library has no task types');
select is((public.own_week(app.today_ist(), app.today_ist() + 6)->>'requests_to_decide')::int, 0,
  'deactivated: own_week counts no requests');
select pg_temp.as_member('invited');
select is(public.task_page(pg_temp.fx('task'), 20, 20)->'task', 'null'::jsonb, 'invited: task_page has no task');
select is(public.client_overview(pg_temp.fx('client'))->'contacts', '[]'::jsonb, 'invited: client_overview has no contacts');
select is(public.project_page(pg_temp.fx('project'))->'project', 'null'::jsonb, 'invited: project_page has no project');
select is(public.templates_library()->'task_types', '[]'::jsonb, 'invited: templates_library has no task types');
select is((public.own_week(app.today_ist(), app.today_ist() + 6)->>'requests_to_decide')::int, 0,
  'invited: own_week counts no requests');
-- Not vacuous: the client's Admin gets them.
select pg_temp.as_member('admin');
select ok(public.project_page(pg_temp.fx('project'))->'project' <> 'null'::jsonb
          and jsonb_array_length(public.client_overview(pg_temp.fx('client'))->'contacts') = 1,
  'the client''s Admin gets the project and the contact');

-- 4. One second organisation: no fold hands org A a single org B id ---------------------------------
select pg_temp.as_member('owner');
select is(public.task_page(pg_temp.fx('b_task'), 20, 20)->'task', 'null'::jsonb, 'Owner A: task_page of an org B task is empty');
select is(public.client_overview(pg_temp.fx('b_client'))->'contacts', '[]'::jsonb, 'Owner A: client_overview of an org B client is empty');
select is(public.project_page(pg_temp.fx('b_project'))->'project', 'null'::jsonb, 'Owner A: project_page of an org B project is empty');
select ok(not (public.templates_library()->'task_types' @> jsonb_build_array(jsonb_build_object('id', pg_temp.fx('b_type')))),
  'Owner A: templates_library never lists org B''s task type');
select ok(not exists (select 1 from jsonb_array_elements(public.own_week(app.today_ist(), app.today_ist() + 6)->'holidays') h
                      where h->>'name' = 'Gaps B holiday 143'),
  'Owner A: own_week never shows org B''s holiday');
-- Not vacuous: org B's own people see their rows.
select pg_temp.as_member('b_owner');
select ok(public.task_page(pg_temp.fx('b_task'), 20, 20)->'task' <> 'null'::jsonb
          and public.project_page(pg_temp.fx('b_project'))->'project' <> 'null'::jsonb,
  'org B''s Owner sees its task and project');
select ok(exists (select 1 from jsonb_array_elements(public.own_week(app.today_ist(), app.today_ist() + 6)->'holidays') h
                  where h->>'name' = 'Gaps B holiday 143'),
  'org B''s Owner sees its holiday in own_week');
select pg_temp.as_system();

select * from finish();
rollback;
