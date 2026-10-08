-- 4B independent review fixes (migration phase4b_review_fixes): S5 a stage tick's time is the
-- server's (app.task_stages_guard stamps done_at := now(), whatever the caller sent, and the audit
-- entry carries that time); S6 no new client label on an Inactive client (WORKFLOWS §4: create and
-- edit, the Owner and an Admin with their own client alike; a task labelled before the client closed
-- keeps its label and stays editable, and the label can be removed or moved to an active client);
-- S7 an archived task type is refused only when it is chosen (create, or a change to it), never on
-- an edit of a task that already has it.
begin;
create extension if not exists pgtap with schema extensions;
select plan(30);

-- 7A: client work rows reference clients and members, and the presets the organization (a
-- Playwright run leaves some behind).
delete from public.item_reviews;
delete from public.project_item_stages;
delete from public.project_items;
delete from public.project_cycles;
delete from public.project_item_blueprints;
delete from public.project_stages;
delete from public.projects;
delete from public.project_templates;
delete from public.stage_presets;
delete from public.task_requests;
delete from public.task_warnings;
delete from public.task_reviews;
delete from public.task_submissions;
delete from public.task_comments;
delete from public.task_stages;
delete from public.task_assignees;
delete from public.tasks;
delete from public.task_templates;
delete from public.member_coordinators;
-- Fixtures as 34. Rolled back at the end.
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
  ('owner',    '00000000-0000-4000-8000-000000000801'),
  ('admin1',   '00000000-0000-4000-8000-000000000802'),
  ('admin2',   '00000000-0000-4000-8000-000000000803'),
  ('staff1',   '00000000-0000-4000-8000-000000000804'),
  ('staff2',   '00000000-0000-4000-8000-000000000805'),
  ('client_a', '00000000-0000-4000-8000-000000000811'),
  ('client_b', '00000000-0000-4000-8000-000000000812'),
  ('client_c', '00000000-0000-4000-8000-000000000813');
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

create function pg_temp.stage(t text, n text) returns public.task_stages language sql stable as $$
  select s.* from public.task_stages s where s.task_id = pg_temp.fx(t) and s.name = n;
$$;

insert into auth.users (id, email)
select id, key || '@example.com' from fx where key not like 'client%' and key <> 'org';

insert into public.members (id, org_id, full_name, email, role, status, joined_at)
select pg_temp.fx(k), pg_temp.fx('org'), k, k || '@example.com', r::public.member_role, 'active', now() - interval '30 days'
from (values ('owner', 'owner'), ('admin1', 'admin'), ('admin2', 'admin'), ('staff1', 'staff'), ('staff2', 'staff')) as v(k, r);

-- Client A and C are admin1's (C already inactive), B is admin2's.
insert into public.clients (id, org_id, name, state, admin_id, activated_at) values
  (pg_temp.fx('client_a'), pg_temp.fx('org'), 'Sharma Weddings', 'active', pg_temp.fx('admin1'), now()),
  (pg_temp.fx('client_b'), pg_temp.fx('org'), 'Blue Bakery', 'active', pg_temp.fx('admin2'), now()),
  (pg_temp.fx('client_c'), pg_temp.fx('org'), 'Closed Studio', 'inactive', pg_temp.fx('admin1'), now() - interval '60 days');

-- S5: a tick's time is the server's --------------------------------------------------------------
select pg_temp.as_member('owner');
insert into fx values ('t1', public.task_create('Reel edit', null, pg_temp.type_id('Normal'), null, 'medium',
  pg_temp.due(), array[pg_temp.fx('staff1'), pg_temp.fx('staff2')], pg_temp.fx('staff1'), pg_temp.fx('admin1'),
  stages => array['Cut', 'Grade']));

select pg_temp.as_member('staff1');
select lives_ok(format($$ update public.task_stages set done_at = '2020-01-01T00:00:00Z' where task_id = %L and name = 'Cut' $$,
  pg_temp.fx('t1')), 'an assignee ticks a stage, sending a time in the past');
select is((pg_temp.stage('t1', 'Cut')).done_at, now(), 'the tick carries the server''s time, not the one sent (S5)');
select is((pg_temp.stage('t1', 'Cut')).done_by, pg_temp.fx('staff1'), 'and the caller as done_by');
select is(((select a.diff -> 'new' ->> 'done_at' from public.activity_log a
            where a.entity = 'task_stages' and a.actor_id = pg_temp.fx('staff1') order by a.id desc limit 1))::timestamptz,
  now(), 'the tick''s audit entry records the server''s time too');
select pg_temp.as_member('staff2');
select lives_ok(format($$ update public.task_stages set done_at = '2099-12-31T00:00:00Z' where task_id = %L and name = 'Grade' $$,
  pg_temp.fx('t1')), 'a co-assignee ticks another, sending a time in the future');
select is((pg_temp.stage('t1', 'Grade')).done_at, now(), 'which is stamped with the server''s time as well');
select lives_ok(format($$ update public.task_stages set done_at = '2030-06-01T00:00:00Z' where task_id = %L and name = 'Grade' $$,
  pg_temp.fx('t1')), 'a second write to a ticked stage with another time');
select is((pg_temp.stage('t1', 'Grade')).done_at, now(), 'cannot move the tick''s time either');
select pg_temp.as_member('staff1');
select lives_ok(format($$ update public.task_stages set done_at = null where task_id = %L and name = 'Cut' $$, pg_temp.fx('t1')),
  'an untick');
select results_eq(format($$ select s.done_at, s.done_by from public.task_stages s where s.task_id = %L and s.name = 'Cut' $$, pg_temp.fx('t1')),
  $$ values (null::timestamptz, null::uuid) $$, 'clears the time and who ticked it');

-- S6: no new label on an Inactive client ---------------------------------------------------------
select pg_temp.as_member('owner');
select throws_ok(format($$ select public.task_create('For a closed client', null, %L::uuid, %L::uuid, 'medium', pg_temp.due(), array[%L::uuid], %L::uuid) $$,
  pg_temp.type_id('Normal'), pg_temp.fx('client_c'), pg_temp.fx('staff1'), pg_temp.fx('staff1')),
  'P0001', 'VALIDATION', 'the Owner cannot create a task labelled with an Inactive client (S6)');
select pg_temp.as_member('admin1');
select throws_ok(format($$ select public.task_create('For my closed client', null, %L::uuid, %L::uuid, 'medium', pg_temp.due(), array[%L::uuid], %L::uuid) $$,
  pg_temp.type_id('Normal'), pg_temp.fx('client_c'), pg_temp.fx('staff1'), pg_temp.fx('staff1')),
  'P0001', 'VALIDATION', 'nor can the Admin whose client it is');
select lives_ok(format($$ insert into fx values ('t2', public.task_create('Sharma album', null, %L::uuid, %L::uuid, 'medium', pg_temp.due(), array[%L::uuid], %L::uuid)) $$,
  pg_temp.type_id('Normal'), pg_temp.fx('client_a'), pg_temp.fx('staff1'), pg_temp.fx('staff1')),
  'the Admin labels a task with their active client');
select pg_temp.as_member('owner');
select is(public.client_close(pg_temp.fx('client_a'), 'Season over'), 'inactive'::public.client_state, 'then the client closes');
select pg_temp.as_member('admin1');
select is(public.task_update_assignment(pg_temp.fx('t2'), '{"title": "Sharma album, final"}'), array['title'],
  'the labelled task stays editable');
select is((select t.client_id from public.tasks t where t.id = pg_temp.fx('t2')), pg_temp.fx('client_a'), 'and keeps its label');
select is(public.task_update_assignment(pg_temp.fx('t2'), jsonb_build_object('client_id', pg_temp.fx('client_a'), 'priority', 'high')),
  array['priority'], 'the same label sent with another change is not a new label');
select pg_temp.as_member('owner');
select throws_ok(format($$ select public.task_update_assignment(%L, jsonb_build_object('client_id', %L)) $$, pg_temp.fx('t1'), pg_temp.fx('client_a')),
  'P0001', 'VALIDATION', 'an edit cannot put the label of an Inactive client on a task');
select is(public.task_update_assignment(pg_temp.fx('t2'), '{"client_id": null}'), array['client_id'], 'the label can be taken off');
select throws_ok(format($$ select public.task_update_assignment(%L, jsonb_build_object('client_id', %L)) $$, pg_temp.fx('t2'), pg_temp.fx('client_a')),
  'P0001', 'VALIDATION', 'and once off, not put back while the client is Inactive');
select is(public.task_update_assignment(pg_temp.fx('t2'), jsonb_build_object('client_id', pg_temp.fx('client_b'))), array['client_id'],
  'the Owner moves it to an active client');

-- S7: an archived type is kept, never chosen -------------------------------------------------------
select pg_temp.as_member('owner');
insert into public.task_types (name, kind, position) values ('Old format', 'normal', 'z9');
insert into fx values ('t3', public.task_create('Old format job', null, pg_temp.type_id('Old format'), null, 'medium',
  pg_temp.due(), array[pg_temp.fx('staff2')], pg_temp.fx('staff2'), pg_temp.fx('admin1')));
select lives_ok($$ update public.task_types set archived_at = now() where name = 'Old format' $$, 'the Owner archives the type');
select is(public.task_update_assignment(pg_temp.fx('t3'), '{"title": "Old format job, v2"}'), array['title'],
  'a task of the archived type stays editable (S7)');
select is(public.task_update_assignment(pg_temp.fx('t3'),
    jsonb_build_object('task_type_id', pg_temp.type_id('Old format'), 'priority', 'high')), array['priority'],
  'sending its own type again with another change is no change of type');
select pg_temp.as_member('admin1');
select is(public.task_update_assignment(pg_temp.fx('t3'), jsonb_build_object('due_at', (pg_temp.due() + interval '1 day')::text)),
  array['due_at'], 'its approving Admin edits it too');
select throws_ok(format($$ select public.task_update_assignment(%L, jsonb_build_object('task_type_id', %L)) $$,
    pg_temp.fx('t2'), pg_temp.type_id('Old format')),
  'P0001', 'VALIDATION', 'nor can an Admin choose it for the task they created');
select pg_temp.as_member('owner');
select throws_ok(format($$ select public.task_update_assignment(%L, jsonb_build_object('task_type_id', %L)) $$,
    pg_temp.fx('t1'), pg_temp.type_id('Old format')),
  'P0001', 'VALIDATION', 'changing a task to the archived type is refused');
select throws_ok(format($$ select public.task_create('New old job', null, %L::uuid, null, 'medium', pg_temp.due(), array[%L::uuid], %L::uuid) $$,
    pg_temp.type_id('Old format'), pg_temp.fx('staff1'), pg_temp.fx('staff1')),
  'P0001', 'VALIDATION', 'and so is creating a task with it');
select is(public.task_update_assignment(pg_temp.fx('t3'), jsonb_build_object('task_type_id', pg_temp.type_id('Normal'))),
  array['task_type_id'], 'a task leaves the archived type for an active one');
select throws_ok(format($$ select public.task_update_assignment(%L, jsonb_build_object('task_type_id', %L)) $$,
    pg_temp.fx('t3'), pg_temp.type_id('Old format')),
  'P0001', 'VALIDATION', 'and cannot go back to it');

select * from finish();
rollback;
