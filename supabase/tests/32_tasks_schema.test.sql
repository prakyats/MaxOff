-- 4A (4.1) Staff tasks, the schema (PRODUCT §4.6, WORKFLOWS §3, PERMISSIONS §2/§3, DATA-MODEL §6;
-- ADR-0004, ADR-0005, ADR-0013): the enums and tables, the seeded task types and the Owner-only
-- guard, no API writes on the function-only tables, visibility per role on tasks and every child
-- table (the Owner, the creator, the approving Admin, an assignee, an Admin with the client label,
-- a coordinator, a former coordinator, a removed assignee, a stranger, anon), client_labels for
-- Staff, the activity log and the directory, comments through the API (author, on behalf),
-- stages through the API (a manager's edits, a worker's ticks, on behalf, locking), the task
-- custom fields guard and field_definitions.task_type_id, and member_availability.
begin;
create extension if not exists pgtap with schema extensions;
select plan(113);

-- Fixtures as 31: keep the organization, replace the people. Rolled back at the end.
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
  ('owner',       '00000000-0000-4000-8000-000000000501'),
  ('admin1',      '00000000-0000-4000-8000-000000000502'),
  ('admin2',      '00000000-0000-4000-8000-000000000503'),
  ('staff1',      '00000000-0000-4000-8000-000000000504'),
  ('staff2',      '00000000-0000-4000-8000-000000000505'),
  ('coord',       '00000000-0000-4000-8000-000000000506'),
  ('old',         '00000000-0000-4000-8000-000000000507'),
  ('deactivated', '00000000-0000-4000-8000-000000000508'),
  ('client_a',    '00000000-0000-4000-8000-000000000511'),
  ('client_b',    '00000000-0000-4000-8000-000000000512');
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

create function pg_temp.as_anon() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  perform set_config('role', 'anon', true);
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

-- A deadline tomorrow at 18:00 IST (never in the past, whatever the wall clock).
create function pg_temp.due() returns timestamptz language sql stable as $$
  select app.ist_day_start(app.today_ist() + 1) + interval '18 hours';
$$;

create function pg_temp.stage(task uuid, n text) returns public.task_stages language sql stable as $$
  select s.* from public.task_stages s where s.task_id = task and s.name = n;
$$;

insert into auth.users (id, email)
select id, key || '@example.com' from fx where key not in ('org', 'client_a', 'client_b');

insert into public.members (id, org_id, full_name, email, role, status, joined_at)
select pg_temp.fx(k), pg_temp.fx('org'), k, k || '@example.com', r::public.member_role, 'active', now() - interval '30 days'
from (values ('owner', 'owner'), ('admin1', 'admin'), ('admin2', 'admin'), ('staff1', 'staff'), ('staff2', 'staff'),
             ('coord', 'staff'), ('old', 'staff')) as v(k, r);
insert into public.members (id, org_id, full_name, email, role, status, joined_at, deactivated_at) values
  (pg_temp.fx('deactivated'), pg_temp.fx('org'), 'Gone Staff', 'deactivated@example.com', 'staff', 'deactivated', now() - interval '30 days', now());

insert into public.clients (id, org_id, name, state, admin_id, activated_at) values
  (pg_temp.fx('client_a'), pg_temp.fx('org'), 'Sharma Weddings', 'active', pg_temp.fx('admin1'), now()),
  (pg_temp.fx('client_b'), pg_temp.fx('org'), 'Blue Bakery', 'active', pg_temp.fx('admin2'), now());

-- The freelancer: coordinated by old first, then by coord (so old is a former coordinator).
select pg_temp.as_member('owner');
insert into fx values ('asha', public.member_add_freelancer('Asha', null, 'asha-phone', pg_temp.fx('old')));
select public.member_set_coordinator(pg_temp.fx('asha'), pg_temp.fx('coord'), 'handover');
select pg_temp.as_system();
update public.members set phone = 'staff1-phone' where id = pg_temp.fx('staff1');
update public.members set phone = 'owner-phone' where id = pg_temp.fx('owner');

-- Schema ---------------------------------------------------------------------------------------
select pg_temp.as_system();
select enum_has_labels('public', 'task_state',
  array['todo', 'in_progress', 'submitted', 'admin_approved', 'changes_requested', 'completed', 'cancelled'], 'task_state');
select enum_has_labels('public', 'admin_step', array['required', 'none', 'skipped'], 'admin_step');
select enum_has_labels('public', 'priority', array['low', 'medium', 'high', 'urgent'], 'priority');
select enum_has_labels('public', 'task_type_kind', array['normal', 'event', 'custom'], 'task_type_kind');
select enum_has_labels('public', 'review_decision', array['approved', 'rejected'], 'review_decision');
select has_table('public', 'task_types', 'task_types exists');
select has_table('public', 'tasks', 'tasks exists');
select has_table('public', 'task_assignees', 'task_assignees exists');
select has_table('public', 'task_stages', 'task_stages exists');
select has_table('public', 'task_comments', 'task_comments exists');
select has_table('public', 'task_reviews', 'task_reviews exists');
select has_table('public', 'task_submissions', 'task_submissions exists');
select has_table('public', 'task_warnings', 'task_warnings exists');
select fk_ok('public', 'field_definitions', 'task_type_id', 'public', 'task_types', 'id', 'field_definitions.task_type_id has its FK (4A)');
select results_eq(
  $$ select tt.name, tt.kind::text, tt.shows_on_calendar, tt.has_location from public.task_types tt
     where tt.org_id = pg_temp.fx('org') order by tt.position $$,
  $$ values ('Normal', 'normal', false, false), ('Shoot / Site Visit', 'event', true, true), ('Meeting', 'event', true, true),
            ('Posting', 'event', true, false), ('Review / Approval', 'normal', false, false), ('Other', 'normal', false, false),
            ('Custom', 'custom', false, false) $$,
  'the seven launch task types are seeded (PRODUCT §4.6)');
select ok(
  not has_table_privilege('anon', 'public.task_types', 'select, insert, update, delete')
  and not has_table_privilege('anon', 'public.tasks', 'select, insert, update, delete')
  and not has_table_privilege('anon', 'public.task_assignees', 'select, insert, update, delete')
  and not has_table_privilege('anon', 'public.task_stages', 'select, insert, update, delete')
  and not has_table_privilege('anon', 'public.task_comments', 'select, insert, update, delete')
  and not has_table_privilege('anon', 'public.task_reviews', 'select, insert, update, delete')
  and not has_table_privilege('anon', 'public.task_submissions', 'select, insert, update, delete')
  and not has_table_privilege('anon', 'public.task_warnings', 'select, insert, update, delete'),
  'anon has no privilege on any task table');
select ok(
  not has_table_privilege('authenticated', 'public.tasks', 'insert, update, delete')
  and not has_table_privilege('authenticated', 'public.task_assignees', 'insert, update, delete')
  and not has_table_privilege('authenticated', 'public.task_reviews', 'insert, update, delete')
  and not has_table_privilege('authenticated', 'public.task_submissions', 'insert, update, delete')
  and not has_table_privilege('authenticated', 'public.task_warnings', 'insert, update, delete'),
  'tasks, assignees, reviews, submissions and warnings have no API writes (functions only)');
select ok(
  not has_table_privilege('authenticated', 'public.task_comments', 'update, delete')
  and has_column_privilege('authenticated', 'public.task_comments', 'body', 'insert')
  and not has_column_privilege('authenticated', 'public.task_comments', 'author_id', 'insert'),
  'comments: insert (never the author column), no update or delete');
select ok(
  not has_table_privilege('authenticated', 'public.task_types', 'delete')
  and not has_column_privilege('authenticated', 'public.task_types', 'position', 'update')
  and not has_column_privilege('authenticated', 'public.task_types', 'is_system', 'update')
  and has_column_privilege('authenticated', 'public.task_types', 'name', 'update'),
  'task_types: no delete, position and is_system out of the grant');

-- task_types: the Owner's list (PERMISSIONS ³) -----------------------------------------------------
select pg_temp.as_member('admin1');
select is((select count(*) from public.task_types), 7::bigint, 'an Admin reads the types');
select throws_ok($$ insert into public.task_types (name) values ('Voice-over') $$,
  'P0001', 'FORBIDDEN', 'an Admin cannot add a type although they hold lists.manage');
select lives_ok($$ update public.task_types set name = 'Hijacked' where name = 'Normal' $$, 'an Admin''s update matches no row');
select is((select count(*) from public.task_types where name = 'Hijacked'), 0::bigint, 'and changed nothing');
select pg_temp.as_member('staff1');
select is((select count(*) from public.task_types), 7::bigint, 'Staff read the types (the create dialog offers them)');
select throws_ok($$ insert into public.task_types (name) values ('Voice-over') $$, 'P0001', 'FORBIDDEN', 'Staff cannot add one');
select pg_temp.as_member('owner');
select lives_ok($$ insert into public.task_types (name, kind, position) values ('Voice-over', 'normal', 'a7') $$, 'the Owner adds a type');
select throws_ok($$ insert into public.task_types (name, position) values (' voice-over ', 'a8') $$,
  '23505', null, 'an active name is unique (case-insensitive)');
select lives_ok($$ update public.task_types set archived_at = now() where name = 'Voice-over' $$, 'the Owner archives it');
select lives_ok($$ update public.task_types set name = 'Normal task' where name = 'Normal' $$, 'the Owner renames one');
select is((select count(*) from public.activity_log a where a.entity = 'task_types'), 3::bigint, 'each write is audited');
update public.task_types set name = 'Normal' where name = 'Normal task';
select pg_temp.as_anon();
select throws_ok($$ select count(*) from public.task_types $$, '42501', null, 'anon reads no type');
select throws_ok($$ select count(*) from public.tasks $$, '42501', null, 'anon reads no task');

-- Tasks for the visibility checks ----------------------------------------------------------------
select pg_temp.as_member('owner');
insert into fx values ('t1', public.task_create('Reel edit', 'the brief', pg_temp.type_id('Normal'), pg_temp.fx('client_a'), 'medium',
  pg_temp.due(), array[pg_temp.fx('staff1'), pg_temp.fx('asha')], pg_temp.fx('staff1'), pg_temp.fx('admin1'),
  stages => array['Cut', 'Grade']));
insert into fx values ('t4', public.task_create('Bakery posters', null, pg_temp.type_id('Normal'), pg_temp.fx('client_b'), 'low',
  pg_temp.due(), array[pg_temp.fx('staff2')], pg_temp.fx('staff2')));
select pg_temp.as_member('admin1');
insert into fx values ('t2', public.task_create('Wedding teaser', null, pg_temp.type_id('Normal'), pg_temp.fx('client_a'), 'high',
  pg_temp.due(), array[pg_temp.fx('staff2')], pg_temp.fx('staff2')));
select pg_temp.as_member('admin2');
insert into fx values ('t3', public.task_create('Office cleanup', null, pg_temp.type_id('Normal'), null, 'medium',
  pg_temp.due(), array[pg_temp.fx('staff1')], pg_temp.fx('staff1')));

-- Visibility (PERMISSIONS §2) ---------------------------------------------------------------------
select pg_temp.as_member('owner');
select is((select count(*) from public.tasks), 4::bigint, 'the Owner sees every task');
select pg_temp.as_member('admin1');
select set_eq($$ select id from public.tasks $$, array[pg_temp.fx('t1'), pg_temp.fx('t2')],
  'admin1 sees the task they approve (t1, their client''s label too) and the one they created (t2), not t3 or t4');
select pg_temp.as_member('admin2');
select set_eq($$ select id from public.tasks $$, array[pg_temp.fx('t3'), pg_temp.fx('t4')],
  'admin2 sees the task they created (t3) and the one labelled with their client (t4)');
select pg_temp.as_member('staff1');
select set_eq($$ select id from public.tasks $$, array[pg_temp.fx('t1'), pg_temp.fx('t3')], 'staff1 sees the tasks assigned to them');
select is((select count(*) from public.task_assignees), 3::bigint, 'and their rows: the assignees of t1 and t3');
select is((select count(*) from public.task_stages), 2::bigint, 'and t1''s stages');
select pg_temp.as_member('staff2');
select set_eq($$ select id from public.tasks $$, array[pg_temp.fx('t2'), pg_temp.fx('t4')], 'staff2 sees theirs');
select is((select count(*) from public.task_stages), 0::bigint, 'and no stage of t1');
select pg_temp.as_member('coord');
select set_eq($$ select id from public.tasks $$, array[pg_temp.fx('t1')], 'the coordinator sees their freelancer''s task (ADR-0013 §6)');
select pg_temp.as_member('old');
select is((select count(*) from public.tasks), 0::bigint, 'a former coordinator sees nothing');
select pg_temp.as_member('deactivated');
select is((select count(*) from public.tasks), 0::bigint, 'a deactivated member sees nothing');

-- client_labels for Staff (ADR-0005): the labels on their tasks, never the record.
select pg_temp.as_member('staff1');
select set_eq($$ select id from public.client_labels $$, array[pg_temp.fx('client_a')], 'staff1 reads the label of client A (on t1)');
select is((select count(*) from public.clients), 0::bigint, 'and never the client record');
select pg_temp.as_member('staff2');
select set_eq($$ select id from public.client_labels $$, array[pg_temp.fx('client_a'), pg_temp.fx('client_b')], 'staff2 reads both labels (t2, t4)');
select pg_temp.as_member('coord');
select set_eq($$ select id from public.client_labels $$, array[pg_temp.fx('client_a')], 'the coordinator reads the label on their freelancer''s task');
select pg_temp.as_member('old');
select is((select count(*) from public.client_labels), 0::bigint, 'a former coordinator reads no label');

-- The activity log and the directory follow the task.
select pg_temp.as_member('staff1');
select ok((select count(*) from public.activity_log a where a.entity_id = pg_temp.fx('t1')) > 0, 'staff1 reads t1''s history');
select is((select count(*) from public.activity_log a where a.entity_id = pg_temp.fx('t2')), 0::bigint, 'and none of t2''s');
select set_eq($$ select id from public.member_directory $$,
  array[pg_temp.fx('staff1'), pg_temp.fx('owner'), pg_temp.fx('admin1'), pg_temp.fx('asha'), pg_temp.fx('admin2')],
  'staff1''s directory: themselves and the people on their tasks (creators, approvers, co-assignees)');
select is((select d.phone from public.member_directory d where d.id = pg_temp.fx('owner')), null,
  'a co-worker seen through a task comes without a phone number (the Owner has one)');
select is((select d.phone from public.member_directory d where d.id = pg_temp.fx('staff1')), 'staff1-phone', 'the caller''s own number is there');
select pg_temp.as_member('coord');
select is((select d.phone from public.member_directory d where d.id = pg_temp.fx('asha')), 'asha-phone', 'a coordinator reads their freelancer''s number');
select pg_temp.as_member('admin1');
select is((select d.phone from public.member_directory d where d.id = pg_temp.fx('staff1')), 'staff1-phone', 'team.view reads everyone''s (a work contact)');
select pg_temp.as_member('old');
select set_eq($$ select id from public.member_directory $$, array[pg_temp.fx('old')], 'a former coordinator''s directory: themselves only');

-- Comments through the API --------------------------------------------------------------------------
select pg_temp.as_member('staff1');
select lives_ok(format($$ insert into public.task_comments (task_id, body) values (%L, 'Started on the cut') $$, pg_temp.fx('t1')),
  'an assignee comments');
select is((select c.author_id from public.task_comments c where c.task_id = pg_temp.fx('t1')), pg_temp.fx('staff1'), 'author_id = the caller');
select throws_ok(format($$ insert into public.task_comments (task_id, body, on_behalf_of) values (%L, 'x', %L) $$, pg_temp.fx('t1'), pg_temp.fx('asha')),
  'P0001', 'FORBIDDEN', 'not for a freelancer they do not coordinate');
select pg_temp.as_member('coord');
select lives_ok(format($$ insert into public.task_comments (task_id, body, on_behalf_of) values (%L, 'Asha sent the first cut', %L) $$, pg_temp.fx('t1'), pg_temp.fx('asha')),
  'the coordinator comments for their freelancer');
select throws_ok(format($$ insert into public.task_comments (task_id, body, on_behalf_of) values (%L, 'x', %L) $$, pg_temp.fx('t1'), pg_temp.fx('staff1')),
  'P0001', 'FORBIDDEN', 'never for an employee');
select pg_temp.as_member('admin1');
select lives_ok(format($$ insert into public.task_comments (task_id, body) values (%L, 'Looks good so far') $$, pg_temp.fx('t1')),
  'the approving Admin comments too');
select pg_temp.as_member('staff2');
select throws_ok(format($$ insert into public.task_comments (task_id, body) values (%L, 'x') $$, pg_temp.fx('t1')),
  '42501', null, 'a stranger cannot comment (RLS)');
select pg_temp.as_member('old');
select throws_ok(format($$ insert into public.task_comments (task_id, body, on_behalf_of) values (%L, 'x', %L) $$, pg_temp.fx('t1'), pg_temp.fx('asha')),
  'P0001', 'FORBIDDEN', 'nor a former coordinator (the guard answers before RLS would)');
select pg_temp.as_member('staff1');
select throws_ok($$ update public.task_comments set body = 'edited' $$, '42501', null, 'a comment is never edited');
select throws_ok($$ delete from public.task_comments $$, '42501', null, 'nor deleted');
select is((select count(*) from public.activity_log a where a.entity = 'task_comments' and a.entity_id = pg_temp.fx('t1')), 3::bigint,
  'each comment is audited on the task');
select is((select a.on_behalf_of_id from public.activity_log a where a.entity = 'task_comments' and a.actor_id = pg_temp.fx('coord')), pg_temp.fx('asha'),
  'the API path carries the audit''s on_behalf_of_id from the row (4A review S2)');

-- Stages through the API ----------------------------------------------------------------------------
select pg_temp.as_member('admin1');
select lives_ok(format($$ insert into public.task_stages (task_id, name, position) values (%L, 'Export', 'a2') $$, pg_temp.fx('t1')),
  'the approving Admin (a manager) adds a stage');
select lives_ok(format($$ update public.task_stages set name = 'Colour grade' where id = %L $$, (pg_temp.stage(pg_temp.fx('t1'), 'Grade')).id),
  'and renames one');
select throws_ok(format($$ update public.task_stages set done_at = now() where id = %L $$, (pg_temp.stage(pg_temp.fx('t1'), 'Cut')).id),
  'P0001', 'FORBIDDEN', 'but does not tick (not an assignee)');
select pg_temp.as_member('staff1');
select throws_ok(format($$ update public.task_stages set name = 'Rough cut' where id = %L $$, (pg_temp.stage(pg_temp.fx('t1'), 'Cut')).id),
  'P0001', 'FORBIDDEN', 'an assignee does not rename');
select throws_ok(format($$ insert into public.task_stages (task_id, name, position) values (%L, 'Mine', 'a3') $$, pg_temp.fx('t1')),
  'P0001', 'FORBIDDEN', 'nor add');
select lives_ok(format($$ update public.task_stages set done_at = now(), done_by = %L where id = %L $$, pg_temp.fx('admin1'), (pg_temp.stage(pg_temp.fx('t1'), 'Cut')).id),
  'an assignee ticks a stage');
select is((pg_temp.stage(pg_temp.fx('t1'), 'Cut')).done_by, pg_temp.fx('staff1'), 'done_by is the caller, whatever was sent');
select throws_ok(format($$ update public.task_stages set done_at = now(), on_behalf_of = %L where id = %L $$, pg_temp.fx('asha'), (pg_temp.stage(pg_temp.fx('t1'), 'Colour grade')).id),
  'P0001', 'FORBIDDEN', 'not on behalf of a freelancer they do not coordinate');
select pg_temp.as_member('coord');
select lives_ok(format($$ update public.task_stages set done_at = now(), on_behalf_of = %L where id = %L $$, pg_temp.fx('asha'), (pg_temp.stage(pg_temp.fx('t1'), 'Colour grade')).id),
  'the coordinator ticks for their freelancer');
select results_eq(
  format($$ select s.done_by, s.on_behalf_of from public.task_stages s where s.id = %L $$, (pg_temp.stage(pg_temp.fx('t1'), 'Colour grade')).id),
  $$ values (pg_temp.fx('coord'), pg_temp.fx('asha')) $$, 'done_by = the coordinator, on_behalf_of = the freelancer');
select pg_temp.as_member('staff2');
select is((select count(*) from public.task_stages s where s.task_id = pg_temp.fx('t1')), 0::bigint, 'a stranger sees no stage of t1');
select pg_temp.as_member('staff1');
select lives_ok(format($$ update public.task_stages set done_at = null where id = %L $$, (pg_temp.stage(pg_temp.fx('t1'), 'Cut')).id),
  'an assignee unticks');
select is((pg_temp.stage(pg_temp.fx('t1'), 'Cut')).done_by, null, 'done_by cleared with it');
select pg_temp.as_member('admin1');
select throws_ok(format($$ delete from public.task_stages where id = %L $$, (pg_temp.stage(pg_temp.fx('t1'), 'Colour grade')).id),
  'P0001', 'INVALID_STATE', 'a ticked stage is not deleted');
select lives_ok(format($$ delete from public.task_stages where id = %L $$, (pg_temp.stage(pg_temp.fx('t1'), 'Export')).id),
  'an unticked one is (a manager)');
select pg_temp.as_member('staff1');
select lives_ok(format($$ select public.task_submit_done(%L, 'first cut', null, null) $$, pg_temp.fx('t1')), 'the primary owner submits Done');
select throws_ok(format($$ update public.task_stages set done_at = now() where id = %L $$, (pg_temp.stage(pg_temp.fx('t1'), 'Cut')).id),
  'P0001', 'INVALID_STATE', 'locked from submitted: no tick');
select is((select count(*) from public.task_submissions s where s.task_id = pg_temp.fx('t1')), 1::bigint, 'the assignee reads the submission');
select pg_temp.as_member('coord');
select is((select count(*) from public.task_submissions s where s.task_id = pg_temp.fx('t1')), 1::bigint, 'the coordinator too');
select pg_temp.as_member('staff2');
select is((select count(*) from public.task_submissions), 0::bigint, 'a stranger reads no submission');
select is((select count(*) from public.task_reviews), 0::bigint, 'nor a review');
select is((select count(*) from public.task_warnings), 0::bigint, 'nor a warning');
select pg_temp.as_member('old');
select is((select count(*) from public.task_submissions), 0::bigint, 'a former coordinator reads no submission');
select pg_temp.as_member('admin1');
select lives_ok(format($$ update public.task_stages set name = 'Grade' where id = %L $$, (pg_temp.stage(pg_temp.fx('t1'), 'Colour grade')).id),
  'a manager still renames while submitted');
select ok((select count(*) from public.activity_log a where a.entity = 'task_stages' and a.entity_id = pg_temp.fx('t1')) >= 7,
  'every stage write is audited on the task');

-- A removed assignee loses the task (RLS follows the rows).
select pg_temp.as_member('admin2');
select lives_ok(format($$ select public.task_update_assignment(%L, jsonb_build_object('assignee_ids', jsonb_build_array(%L), 'primary_owner_id', %L)) $$,
  pg_temp.fx('t3'), pg_temp.fx('staff2'), pg_temp.fx('staff2')), 'the creator reassigns t3 to staff2');
select pg_temp.as_member('staff1');
select set_eq($$ select id from public.tasks $$, array[pg_temp.fx('t1')], 'staff1, removed from t3, no longer sees it');
select pg_temp.as_member('staff2');
select set_eq($$ select id from public.tasks $$, array[pg_temp.fx('t2'), pg_temp.fx('t3'), pg_temp.fx('t4')], 'staff2 gained it');

-- Custom fields on tasks (DATA-MODEL §2, core/custom-fields) -----------------------------------------
select pg_temp.as_member('owner');
select lives_ok($$ insert into public.field_definitions (entity, key, label, type, position) values ('task', 'brief_url', 'Brief', 'url', 'a0') $$,
  'the Owner adds a task field');
select lives_ok(format($$ insert into public.field_definitions (entity, key, label, type, position, task_type_id) values ('task', 'attendees', 'Attendees', 'number', 'a1', %L) $$, pg_temp.type_id('Meeting')),
  'and one for meetings only');
select throws_ok($$ insert into public.field_definitions (entity, key, label, type, position, task_type_id) values ('task', 'ghost', 'Ghost', 'text', 'a2', gen_random_uuid()) $$,
  'P0001', 'NOT_FOUND', 'a per-type field names a real task type');
select throws_ok(format($$ select public.task_create('Bad brief', null, %L::uuid, null, 'medium', pg_temp.due(), array[%L::uuid], %L::uuid, custom_fields => '{"brief_url": "not a url"}') $$,
  pg_temp.type_id('Normal'), pg_temp.fx('staff1'), pg_temp.fx('staff1')), 'P0001', 'VALIDATION', 'a value that does not fit its type is refused');
select throws_ok(format($$ select public.task_create('Unknown field', null, %L::uuid, null, 'medium', pg_temp.due(), array[%L::uuid], %L::uuid, custom_fields => '{"nope": 1}') $$,
  pg_temp.type_id('Normal'), pg_temp.fx('staff1'), pg_temp.fx('staff1')), 'P0001', 'VALIDATION', 'an unknown key is refused');
select throws_ok(format($$ select public.task_create('Wrong type', null, %L::uuid, null, 'medium', pg_temp.due(), array[%L::uuid], %L::uuid, custom_fields => '{"attendees": 3}') $$,
  pg_temp.type_id('Normal'), pg_temp.fx('staff1'), pg_temp.fx('staff1')), 'P0001', 'VALIDATION', 'a meetings-only field on a Normal task is refused');
insert into fx values ('t5', public.task_create('Client meeting', null, pg_temp.type_id('Meeting'), null, 'medium', pg_temp.due(),
  array[pg_temp.fx('staff2')], pg_temp.fx('staff2'), event_date => app.today_ist() + 1,
  event_start_at => app.ist_day_start(app.today_ist() + 1) + interval '10 hours', location => 'Client office',
  custom_fields => '{"attendees": 3, "brief_url": "https://example.com/brief"}'));
select is((select t.custom_fields from public.tasks t where t.id = pg_temp.fx('t5')), '{"attendees": 3, "brief_url": "https://example.com/brief"}'::jsonb,
  'valid values are stored');
select throws_ok($$ update public.field_definitions set type = 'text' where key = 'brief_url' $$,
  'P0001', 'INVALID_STATE', 'a field''s type is immutable once a task holds a value');

-- member_availability (PERMISSIONS §2, ADR-0004) ------------------------------------------------------
select pg_temp.as_system();
insert into public.leave_requests (member_id, type, start_date, end_date, state, source, decided_by, decided_at)
values (pg_temp.fx('staff1'), 'leave', app.today_ist() + 2, app.today_ist() + 2, 'approved', 'form', pg_temp.fx('owner'), now());
insert into public.leave_requests (member_id, type, start_date, end_date, state, source)
values (pg_temp.fx('staff1'), 'half_day', app.today_ist() + 3, app.today_ist() + 3, 'submitted', 'form');
insert into public.attendance_days (member_id, work_date, state, submitted_choice, submitted_at, started_at)
values (pg_temp.fx('staff2'), app.today_ist(), 'pending_review', 'present', now(), now());
select pg_temp.as_member('staff1');
select throws_ok($$ select * from public.member_availability(app.today_ist(), app.today_ist() + 1) $$,
  'P0001', 'FORBIDDEN', 'Staff read nobody''s availability');
select pg_temp.as_member('admin1');
select throws_ok($$ select * from public.member_availability(app.today_ist() + 1, app.today_ist()) $$, 'P0001', 'VALIDATION', 'a range in order');
select throws_ok($$ select * from public.member_availability(app.today_ist(), app.today_ist() + 62) $$, 'P0001', 'VALIDATION', 'two months at most');
select is((select count(*) from public.member_availability(app.today_ist(), app.today_ist() + 3) a where a.member_id = pg_temp.fx('owner')), 0::bigint,
  'the Owner is never listed (never an assignee)');
select is((select count(*) from public.member_availability(app.today_ist(), app.today_ist() + 3) a where a.member_id = pg_temp.fx('deactivated')), 0::bigint,
  'nor a deactivated member');
select results_eq(
  format($$ select a.day, a.open_tasks_due, a.leave, a.present from public.member_availability(app.today_ist(), app.today_ist() + 3, array[%L::uuid]) a order by a.day $$, pg_temp.fx('staff1')),
  $$ values (app.today_ist(), 0, null::text, false), (app.today_ist() + 1, 1, null, null),
            (app.today_ist() + 2, 0, 'leave', null), (app.today_ist() + 3, 0, 'requested', null) $$,
  'staff1: one open task due tomorrow (t1; t3 was reassigned), approved leave, a pending request, not started today');
select results_eq(
  format($$ select a.day, a.open_tasks_due, a.event_blocks, a.present from public.member_availability(app.today_ist(), app.today_ist() + 1, array[%L::uuid]) a order by a.day $$, pg_temp.fx('staff2')),
  format($$ values (app.today_ist(), 0, '[]'::jsonb, true), (app.today_ist() + 1, 4, jsonb_build_array(jsonb_build_object('start_at', %L::timestamptz, 'end_at', %L::timestamptz)), null) $$,
    app.ist_day_start(app.today_ist() + 1) + interval '10 hours', app.ist_day_start(app.today_ist() + 1) + interval '11 hours'),
  'staff2: started today, four tasks due tomorrow, one event block (no end = one hour); no titles or ids');
select results_eq(
  format($$ select a.engagement::text, a.open_tasks_due, a.leave from public.member_availability(app.today_ist() + 1, app.today_ist() + 1, array[%L::uuid]) a $$, pg_temp.fx('asha')),
  $$ values ('freelance', 1, null::text) $$, 'the freelancer counts for workload and never has leave');
select pg_temp.as_member('owner');
select is((select count(distinct a.member_id) from public.member_availability(app.today_ist(), app.today_ist()) a), 7::bigint,
  'the Owner reads every active non-Owner member (seven, the freelancer included)');

select * from finish();
rollback;
