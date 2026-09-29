-- 4C, Kickoff 4 decisions (21) and (22) (migration phase4c_names_and_labels).
-- (21) A member without team.view reads the names of everyone who was on or acted on a task they
--      can see: creator, current and past approvers, current and removed assignees, reviewers,
--      whoever acted on it (a comment, a tick, a submission, a change) and the current coordinator
--      of a freelancer assignee; never a stranger's, and the phone stays hidden (PERMISSIONS §2).
--      The rule is set-based now (app.directory_visible_ids()); app.directory_visible() is its
--      single-row form.
-- (22) A client label is an Active or Paused client: a Draft one is refused when the label is set
--      or changed (create and edit, the Owner and an Admin with their own client alike); a task
--      labelled before keeps its label and stays editable.
begin;
create extension if not exists pgtap with schema extensions;
select plan(43);

-- Fixtures as 35. Rolled back at the end.
delete from public.task_warnings;
delete from public.task_reviews;
delete from public.task_submissions;
delete from public.task_comments;
delete from public.task_stages;
delete from public.task_assignees;
delete from public.tasks;
delete from public.member_coordinators;
delete from public.attendance_events;
delete from public.attendance_days;
delete from public.expense_claims;
delete from public.comp_leave_credit_uses;
delete from public.comp_leave_credits;
delete from public.extra_work_notes;
delete from public.leave_requests;
delete from public.session_events;
delete from public.activity_log;
delete from public.field_definitions;
delete from public.client_contacts;
delete from public.client_admin_assignments;
delete from public.client_brand;
delete from public.client_private;
delete from public.client_close_reasons;
delete from public.clients;
update public.organizations set logo_file_id = null;
delete from public.files;
delete from public.members;
delete from auth.identities;
delete from auth.users;
delete from public.activity_log;
delete from public.holidays;
update public.org_settings set weekly_off_days = '{}';

create temporary table fx (key text primary key, id uuid not null);
insert into fx values
  ('owner',    '00000000-0000-4000-8000-000000000901'),
  ('admin1',   '00000000-0000-4000-8000-000000000902'),
  ('admin2',   '00000000-0000-4000-8000-000000000903'),
  ('admin3',   '00000000-0000-4000-8000-000000000904'),
  ('staff1',   '00000000-0000-4000-8000-000000000905'),
  ('staff2',   '00000000-0000-4000-8000-000000000906'),
  ('staff3',   '00000000-0000-4000-8000-000000000907'),
  ('staff4',   '00000000-0000-4000-8000-000000000908'),
  ('coord',    '00000000-0000-4000-8000-000000000909'),
  ('coord2',   '00000000-0000-4000-8000-000000000910'),
  ('client_a', '00000000-0000-4000-8000-000000000921'),
  ('client_p', '00000000-0000-4000-8000-000000000922'),
  ('client_d', '00000000-0000-4000-8000-000000000923'),
  ('client_e', '00000000-0000-4000-8000-000000000924');
insert into fx select 'org', id from public.organizations limit 1;
grant all on fx to authenticated, anon, service_role;

create function pg_temp.fx(k text) returns uuid language sql stable as $$
  select id from fx where key = k;
$$;

create function pg_temp.as_member(k text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', pg_temp.fx(k)::text, true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', pg_temp.fx(k), 'role', 'authenticated')::text, true);
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

create function pg_temp.type_id(n text) returns uuid language sql stable as $$
  select tt.id from public.task_types tt where tt.org_id = pg_temp.fx('org') and tt.name = n;
$$;

create function pg_temp.due() returns timestamptz language sql stable as $$
  select app.ist_day_start(app.today_ist() + 1) + interval '18 hours';
$$;

-- Whether the current caller's directory holds that person.
create function pg_temp.sees(k text) returns boolean language sql stable as $$
  select exists (select 1 from public.member_directory d where d.id = pg_temp.fx(k));
$$;

-- The keys of everyone in the current caller's directory, sorted.
create function pg_temp.seen() returns text language sql stable as $$
  select string_agg(f.key, ',' order by f.key)
  from public.member_directory d join fx f on f.id = d.id;
$$;

insert into auth.users (id, email)
select id, key || '@example.com' from fx where key not like 'client%' and key <> 'org';

insert into public.members (id, org_id, full_name, email, phone, role, status, joined_at)
select pg_temp.fx(k), pg_temp.fx('org'), k, k || '@example.com', '98' || right(pg_temp.fx(k)::text, 8),
       r::public.member_role, 'active', now() - interval '30 days'
from (values ('owner', 'owner'), ('admin1', 'admin'), ('admin2', 'admin'), ('admin3', 'admin'),
             ('staff1', 'staff'), ('staff2', 'staff'), ('staff3', 'staff'), ('staff4', 'staff'),
             ('coord', 'staff'), ('coord2', 'staff')) as v(k, r);

-- A (active), P (paused), D (draft) and E (active, turned back to draft below) are admin1's.
insert into public.clients (id, org_id, name, state, admin_id, activated_at) values
  (pg_temp.fx('client_a'), pg_temp.fx('org'), 'Sharma Weddings', 'active', pg_temp.fx('admin1'), now()),
  (pg_temp.fx('client_p'), pg_temp.fx('org'), 'Paused Studio', 'paused', pg_temp.fx('admin1'), now()),
  (pg_temp.fx('client_d'), pg_temp.fx('org'), 'Draft Bakery', 'draft', pg_temp.fx('admin1'), null),
  (pg_temp.fx('client_e'), pg_temp.fx('org'), 'Early Label', 'active', pg_temp.fx('admin1'), now());

-- The story of T1: the Owner routes it through admin1, to staff1 (primary), staff2, staff4 and the
-- freelancer Asha (coordinated by coord). staff4 is taken off; coord ticks a stage for Asha and is
-- then replaced by coord2; staff1 comments and marks it done; admin1 asks for changes; the Owner
-- moves the approval to admin2. T2 is a stranger's task (staff3's).
select pg_temp.as_member('owner');
insert into fx values ('asha', public.member_add_freelancer('Asha', null, '9811111111', pg_temp.fx('coord')));
insert into fx values ('t1', public.task_create('Reel edit', null, pg_temp.type_id('Normal'), null, 'medium',
  pg_temp.due(), array[pg_temp.fx('staff1'), pg_temp.fx('staff2'), pg_temp.fx('staff4'), pg_temp.fx('asha')],
  pg_temp.fx('staff1'), pg_temp.fx('admin1'), stages => array['Cut']));
select public.task_update_assignment(pg_temp.fx('t1'), jsonb_build_object('assignee_ids',
  jsonb_build_array(pg_temp.fx('staff1'), pg_temp.fx('staff2'), pg_temp.fx('asha'))));
insert into fx values ('t2', public.task_create('Poster', null, pg_temp.type_id('Normal'), null, 'medium',
  pg_temp.due(), array[pg_temp.fx('staff3')], pg_temp.fx('staff3')));

select pg_temp.as_member('coord');
update public.task_stages set done_at = now(), on_behalf_of = pg_temp.fx('asha')
where task_id = pg_temp.fx('t1') and name = 'Cut';

select pg_temp.as_member('owner');
select public.member_set_coordinator(pg_temp.fx('asha'), pg_temp.fx('coord2'), 'Moved teams');

select pg_temp.as_member('staff1');
insert into public.task_comments (task_id, body) values (pg_temp.fx('t1'), 'On it');
select public.task_submit_done(pg_temp.fx('t1'), 'https://drive.example/cut');

select pg_temp.as_member('admin1');
select public.task_review(pg_temp.fx('t1'), 'rejected', 'Tighter cut');

select pg_temp.as_member('owner');
select public.task_set_approver(pg_temp.fx('t1'), pg_temp.fx('admin2'));

-- (21) A Staff co-assignee ---------------------------------------------------------------------------
select pg_temp.as_member('staff2');
select ok(pg_temp.sees('owner'), 'a Staff co-assignee sees the task''s creator (the Owner)');
select ok(pg_temp.sees('admin1'), 'and a past approver, who asked for changes (decision 21)');
select ok(pg_temp.sees('admin2'), 'and the current approver');
select ok(pg_temp.sees('staff1'), 'and the primary owner');
select ok(pg_temp.sees('asha'), 'and the freelancer on the task');
select ok(pg_temp.sees('staff4'), 'and a removed assignee');
select ok(pg_temp.sees('coord'), 'and a former coordinator who ticked a stage for the freelancer');
select ok(pg_temp.sees('coord2'), 'and the freelancer''s current coordinator');
select ok(not pg_temp.sees('staff3'), 'never a stranger (a Staff member on another task)');
select ok(not pg_temp.sees('admin3'), 'nor an Admin who has nothing to do with the task');
select is(pg_temp.seen(), 'admin1,admin2,asha,coord,coord2,owner,staff1,staff2,staff4',
  'exactly the people on or acting on their task, and themselves');
select is((select d.phone from public.member_directory d where d.id = pg_temp.fx('staff1')), null,
  'names only: a co-worker''s phone stays hidden (PERMISSIONS §2)');
select is((select d.phone from public.member_directory d where d.id = pg_temp.fx('asha')), null,
  'and the freelancer''s phone too (their coordinator''s only)');
select is((select d.phone from public.member_directory d where d.id = pg_temp.fx('admin2')), null,
  'and the approver''s');
select isnt((select d.phone from public.member_directory d where d.id = pg_temp.fx('staff2')), null,
  'their own phone is there');
select ok(app.directory_visible(pg_temp.fx('admin1')), 'the single-row form agrees: a past approver is visible');
select ok(not app.directory_visible(pg_temp.fx('staff3')), 'and a stranger is not');
select results_eq($$ select f.member_id, f.coordinator_id from public.freelancer_coordinators f $$,
  format($$ values (%L::uuid, %L::uuid) $$, pg_temp.fx('asha'), pg_temp.fx('coord2')),
  'freelancer_coordinators: the co-assignee reads who coordinates the freelancer on their task now');

-- A stranger, the coordinators --------------------------------------------------------------------
select pg_temp.as_member('staff3');
select is(pg_temp.seen(), 'owner,staff3', 'a Staff member on another task sees only that task''s people');
select ok(not pg_temp.sees('staff1'), 'never the people on a task they are not on');
select is((select count(*) from public.freelancer_coordinators), 0::bigint,
  'nor who coordinates a freelancer they have nothing to do with');

select pg_temp.as_member('coord2');
select is(pg_temp.seen(), 'admin1,admin2,asha,coord,coord2,owner,staff1,staff2,staff4',
  'the current coordinator sees the freelancer''s task''s people');
select isnt((select d.phone from public.member_directory d where d.id = pg_temp.fx('asha')), null,
  'with the freelancer''s phone (a work contact)');
select is((select d.phone from public.member_directory d where d.id = pg_temp.fx('staff1')), null,
  'but not a co-worker''s');

select pg_temp.as_member('coord');
select is(pg_temp.seen(), 'coord', 'a former coordinator no longer sees the freelancer or their task');

-- team.view and the rest ----------------------------------------------------------------------------
select pg_temp.as_member('admin3');
select is((select count(*) from public.member_directory), 11::bigint,
  'an Admin (team.view) still reads everyone, with nothing to do with the task');
select is((select count(*) from public.freelancer_coordinators), 1::bigint,
  'and every current coordination (team.view)');
select ok(not exists (select 1 from information_schema.columns
                      where table_schema = 'public' and table_name = 'freelancer_coordinators' and column_name = 'reason'),
  'the view carries no reason (decision 20)');
select isnt((select d.phone from public.member_directory d where d.id = pg_temp.fx('staff3')), null,
  'phones included (a work contact for team.view)');
select pg_temp.as_member('owner');
select is((select count(*) from public.member_directory), 11::bigint, 'the Owner reads everyone');

select pg_temp.as_system();
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000999', true);
select set_config('role', 'authenticated', true);
select is((select count(*) from app.directory_visible_ids()), 0::bigint,
  'a session with no member row: an empty set');
select pg_temp.as_system();
select ok(has_function_privilege('authenticated', 'app.directory_visible_ids()', 'execute'),
  'the set is callable by the API role (the view is its only caller)');

-- (22) Active or Paused labels only -----------------------------------------------------------------
select pg_temp.as_member('owner');
select throws_ok(format($$ select public.task_create('For a draft client', null, %L::uuid, %L::uuid, 'medium', pg_temp.due(), array[%L::uuid], %L::uuid) $$,
  pg_temp.type_id('Normal'), pg_temp.fx('client_d'), pg_temp.fx('staff1'), pg_temp.fx('staff1')),
  'P0001', 'VALIDATION', 'the Owner cannot label a new task with a Draft client (decision 22)');
select pg_temp.as_member('admin1');
select throws_ok(format($$ select public.task_create('For my draft client', null, %L::uuid, %L::uuid, 'medium', pg_temp.due(), array[%L::uuid], %L::uuid) $$,
  pg_temp.type_id('Normal'), pg_temp.fx('client_d'), pg_temp.fx('staff1'), pg_temp.fx('staff1')),
  'P0001', 'VALIDATION', 'nor can the Admin whose draft it is');
select lives_ok(format($$ insert into fx values ('t3', public.task_create('For my paused client', null, %L::uuid, %L::uuid, 'medium', pg_temp.due(), array[%L::uuid], %L::uuid)) $$,
  pg_temp.type_id('Normal'), pg_temp.fx('client_p'), pg_temp.fx('staff1'), pg_temp.fx('staff1')),
  'a Paused client is a label');
select lives_ok(format($$ insert into fx values ('t4', public.task_create('For my active client', null, %L::uuid, %L::uuid, 'medium', pg_temp.due(), array[%L::uuid], %L::uuid)) $$,
  pg_temp.type_id('Normal'), pg_temp.fx('client_a'), pg_temp.fx('staff1'), pg_temp.fx('staff1')),
  'and an Active one');
select throws_ok(format($$ select public.task_update_assignment(%L::uuid, jsonb_build_object('client_id', %L::uuid)) $$,
  pg_temp.fx('t4'), pg_temp.fx('client_d')),
  'P0001', 'VALIDATION', 'changing a label to a Draft client is refused');
select pg_temp.as_member('owner');
select throws_ok(format($$ select public.task_update_assignment(%L::uuid, jsonb_build_object('client_id', %L::uuid)) $$,
  pg_temp.fx('t4'), pg_temp.fx('client_d')),
  'P0001', 'VALIDATION', 'the Owner''s too');
select is((select t.client_id from public.tasks t where t.id = pg_temp.fx('t4')), pg_temp.fx('client_a'),
  'and the label stays what it was');

-- A task labelled while the client was not a draft keeps the label and stays editable.
select pg_temp.as_member('owner');
insert into fx values ('t5', public.task_create('Early task', null, pg_temp.type_id('Normal'), pg_temp.fx('client_e'), 'medium',
  pg_temp.due(), array[pg_temp.fx('staff1')], pg_temp.fx('staff1')));
select pg_temp.as_system();
update public.clients set state = 'draft', activated_at = null where id = pg_temp.fx('client_e');
select pg_temp.as_member('owner');
select lives_ok(format($$ select public.task_update_assignment(%L::uuid, '{"title": "Early task, renamed"}'::jsonb) $$, pg_temp.fx('t5')),
  'a task labelled before stays editable');
select is((select t.client_id from public.tasks t where t.id = pg_temp.fx('t5')), pg_temp.fx('client_e'),
  'and keeps its label');
select lives_ok(format($$ select public.task_update_assignment(%L::uuid, jsonb_build_object('client_id', %L::uuid)) $$,
  pg_temp.fx('t5'), pg_temp.fx('client_a')),
  'the label can move to an active client');
select lives_ok(format($$ select public.task_update_assignment(%L::uuid, jsonb_build_object('client_id', null)) $$,
  pg_temp.fx('t4')),
  'or be removed');

select * from finish();
rollback;
