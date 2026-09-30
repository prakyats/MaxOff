-- The phase 4 review's fixes (migration phase4_review_fixes):
-- S-M1  an Admin demoted to Staff keeps nothing of a manager's reach: none of the tasks they created
--       or approve (unless assigned), no checklist edits through the API, no client labels or names
--       from those tasks; an Admin keeps it all.
-- S-S2  a coordinator stands for an ACTIVE freelancer only: a coordinator set on a deactivated
--       freelancer neither sees nor acts on their tasks, nor unticks their stages.
-- S-S3  a sign-in on a freelancer's id resolves to no member and holds no permission.
-- A-M2  the approving Admin added as an assignee while the task is submitted: admin_approved, admin
--       step skipped, audited (meta.reason approver_is_assignee); anyone else added changes nothing.
-- A-S4  task_unread_counts() takes the list's ids: null refused, at most 500.
-- L2    payload bounds: stages, assignees, reminder rules, warnings and their details.
-- L4    a tick on a ticked stage keeps the first one.
begin;
create extension if not exists pgtap with schema extensions;
select plan(88);

-- Fixtures as 39. Rolled back at the end.
delete from public.task_reads;
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
  ('owner',    '00000000-0000-4000-8000-000000000d01'),
  ('admin1',   '00000000-0000-4000-8000-000000000d02'),
  ('admin2',   '00000000-0000-4000-8000-000000000d03'),
  ('staff1',   '00000000-0000-4000-8000-000000000d04'),
  ('staff2',   '00000000-0000-4000-8000-000000000d05'),
  ('coord',    '00000000-0000-4000-8000-000000000d06'),
  ('client_a', '00000000-0000-4000-8000-000000000d21'),
  ('client_b', '00000000-0000-4000-8000-000000000d22');
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

-- How many of these tasks the caller reads (RLS).
create function pg_temp.reads(variadic ks text[]) returns bigint language sql stable as $$
  select count(*) from public.tasks t where t.id in (select pg_temp.fx(k) from unnest(ks) k);
$$;

-- Whether the caller's directory holds that person.
create function pg_temp.sees(k text) returns boolean language sql stable as $$
  select exists (select 1 from public.member_directory d where d.id = pg_temp.fx(k));
$$;

-- How many rows a statement touched, as the caller (RLS decides).
create function pg_temp.rows(q text) returns bigint language plpgsql as $$
declare
  n bigint;
begin
  execute q;
  get diagnostics n = row_count;
  return n;
end;
$$;

create function pg_temp.stage(k text, n text) returns public.task_stages language sql stable as $$
  select s.* from public.task_stages s where s.task_id = pg_temp.fx(k) and s.name = n;
$$;

-- The task as the database holds it (read as the system, past RLS).
create function pg_temp.task(k text) returns public.tasks language sql stable security definer as $$
  select t.* from public.tasks t where t.id = pg_temp.fx(k);
$$;

insert into auth.users (id, email)
select id, key || '@example.com' from fx where key not like 'client%' and key <> 'org';

insert into public.members (id, org_id, full_name, email, role, status, joined_at)
select pg_temp.fx(k), pg_temp.fx('org'), k, k || '@example.com', r::public.member_role, 'active', now() - interval '30 days'
from (values ('owner', 'owner'), ('admin1', 'admin'), ('admin2', 'admin'), ('staff1', 'staff'),
             ('staff2', 'staff'), ('coord', 'staff')) as v(k, r);

-- A is admin1's, B is admin2's.
insert into public.clients (id, org_id, name, state, admin_id, activated_at) values
  (pg_temp.fx('client_a'), pg_temp.fx('org'), 'Sharma Weddings', 'active', pg_temp.fx('admin1'), now()),
  (pg_temp.fx('client_b'), pg_temp.fx('org'), 'Bloom Bakery', 'active', pg_temp.fx('admin2'), now());

-- The freelancers: Asha (coord's) and Bina (admin2's).
select pg_temp.as_member('owner');
insert into fx values ('asha', public.member_add_freelancer('Asha', null, null, pg_temp.fx('coord')));
insert into fx values ('bina', public.member_add_freelancer('Bina', null, null, pg_temp.fx('admin2')));
-- O1 routes through admin1, O2 through admin2 (both to staff2); FA is Asha's.
insert into fx values ('o1', public.task_create('Owner via admin1', null, pg_temp.type_id('Normal'), null, 'medium',
  pg_temp.due(), array[pg_temp.fx('staff2')], pg_temp.fx('staff2'), pg_temp.fx('admin1')));
insert into fx values ('o2', public.task_create('Owner via admin2', null, pg_temp.type_id('Normal'), null, 'medium',
  pg_temp.due(), array[pg_temp.fx('staff2')], pg_temp.fx('staff2'), pg_temp.fx('admin2')));
insert into fx values ('fa', public.task_create('Asha''s cut', null, pg_temp.type_id('Normal'), null, 'medium',
  pg_temp.due(), array[pg_temp.fx('asha')], pg_temp.fx('asha')));
-- A1 is admin1's (label A, staff1); A1OWN is admin1's with admin1 on it.
select pg_temp.as_member('admin1');
insert into fx values ('a1', public.task_create('Admin1 edit', null, pg_temp.type_id('Normal'), pg_temp.fx('client_a'), 'medium',
  pg_temp.due(), array[pg_temp.fx('staff1')], pg_temp.fx('staff1'), stages => array['Cut', 'Grade', 'Spare']));
insert into fx values ('a1own', public.task_create('Admin1 on it', null, pg_temp.type_id('Normal'), null, 'medium',
  pg_temp.due(), array[pg_temp.fx('admin1'), pg_temp.fx('staff2')], pg_temp.fx('staff2'), stages => array['Plan']));
-- A2 is admin2's (label B, staff1); FB is admin2's for Bina.
select pg_temp.as_member('admin2');
insert into fx values ('a2', public.task_create('Admin2 edit', null, pg_temp.type_id('Normal'), pg_temp.fx('client_b'), 'medium',
  pg_temp.due(), array[pg_temp.fx('staff1')], pg_temp.fx('staff1'), stages => array['Cut', 'Grade', 'Spare']));
insert into fx values ('fb', public.task_create('Bina''s poster', null, pg_temp.type_id('Normal'), null, 'medium',
  pg_temp.due(), array[pg_temp.fx('bina')], pg_temp.fx('bina'), stages => array['Draft', 'Final']));

-- S-M1: an Admin demoted to Staff --------------------------------------------------------------------
select pg_temp.as_member('admin1');
select is(pg_temp.reads('a1', 'o1', 'a1own'), 3::bigint, 'as an Admin, admin1 reads what they created and approve');
select ok((select count(*) from public.client_labels l where l.id = pg_temp.fx('client_a')) = 1, '(and their client''s label)');

-- Their client goes to admin2 first (a demotion leaves no client behind, phase 3); the label on the
-- task they created was theirs to see only as its creator.
select pg_temp.as_system();
update public.clients set admin_id = pg_temp.fx('admin2') where id = pg_temp.fx('client_a');
update public.members set role = 'staff' where id = pg_temp.fx('admin1');
select pg_temp.as_member('admin1');
select is(pg_temp.reads('a1', 'o1'), 0::bigint, 'made Staff, they read none of the tasks they created or approve (S-M1)');
select is(pg_temp.reads('a1own'), 1::bigint, 'but still the one they are assigned to');
select ok(not app.task_manager(pg_temp.fx('a1')) and not app.task_manager(pg_temp.fx('a1own')),
  'and manage none of them');
select ok(not app.is_approving_admin(pg_temp.fx('o1')), 'nor count as the approving Admin of O1');
select throws_ok(format($$ insert into public.task_stages (task_id, name, position) values (%L, 'Extra', 'b0') $$, pg_temp.fx('a1')),
  'P0001', 'NOT_FOUND', 'they cannot add a stage to the task they created (it is not theirs to see)');
select is(pg_temp.rows(format($$ update public.task_stages set name = 'Renamed' where task_id = %L and name = 'Cut' $$, pg_temp.fx('a1'))),
  0::bigint, 'nor rename one');
select is(pg_temp.rows(format($$ update public.task_stages set position = 'z0' where task_id = %L and name = 'Grade' $$, pg_temp.fx('a1'))),
  0::bigint, 'nor reorder one');
select is(pg_temp.rows(format($$ delete from public.task_stages where task_id = %L and name = 'Spare' $$, pg_temp.fx('a1'))),
  0::bigint, 'nor delete one');
select pg_temp.as_system();
select is((select string_agg(s.name || ':' || s.position, ',' order by s.position) from public.task_stages s where s.task_id = pg_temp.fx('a1')),
  'Cut:a0,Grade:a1,Spare:a2', '(the checklist is untouched)');
select pg_temp.as_member('admin1');
select throws_ok(format($$ insert into public.task_stages (task_id, name, position) values (%L, 'Extra', 'b0') $$, pg_temp.fx('a1own')),
  'P0001', 'FORBIDDEN', 'on the task they still see as an assignee, the stage guard refuses the add (tasks.create)');
select throws_ok(format($$ update public.task_stages set name = 'Renamed' where task_id = %L and name = 'Plan' $$, pg_temp.fx('a1own')),
  'P0001', 'FORBIDDEN', 'and the rename');
select throws_ok(format($$ delete from public.task_stages where task_id = %L and name = 'Plan' $$, pg_temp.fx('a1own')),
  'P0001', 'FORBIDDEN', 'and the delete');
select throws_ok(format($$ select public.task_update_assignment(%L, '{"title": "Mine now"}') $$, pg_temp.fx('a1own')),
  'P0001', 'FORBIDDEN', 'nor edit it');
select is((select count(*) from public.client_labels l where l.id = pg_temp.fx('client_a')), 0::bigint,
  'the label of the task they created is gone with it');
select ok(not pg_temp.sees('staff1'), 'and the name of its assignee');
select ok(pg_temp.sees('staff2'), '(the co-assignee of the task they are on stays named)');

select pg_temp.as_member('admin2');
select is(pg_temp.reads('a2', 'o2'), 2::bigint, 'an Admin reads what they created and approve');
select lives_ok(format($$ insert into public.task_stages (task_id, name, position) values (%L, 'Extra', 'b0') $$, pg_temp.fx('a2')),
  'adds a stage');
select is(pg_temp.rows(format($$ update public.task_stages set name = 'First cut' where task_id = %L and name = 'Cut' $$, pg_temp.fx('a2'))),
  1::bigint, 'renames one');
select is(pg_temp.rows(format($$ update public.task_stages set position = 'z0' where task_id = %L and name = 'Grade' $$, pg_temp.fx('a2'))),
  1::bigint, 'reorders one');
select is(pg_temp.rows(format($$ delete from public.task_stages where task_id = %L and name = 'Spare' $$, pg_temp.fx('a2'))),
  1::bigint, 'deletes one');
select is((select count(*) from public.client_labels l where l.id = pg_temp.fx('client_b')), 1::bigint, 'reads their client''s label');
select ok(pg_temp.sees('staff1'), 'and names the assignee');

-- S-S2: a coordinator of a deactivated freelancer ------------------------------------------------------
select pg_temp.as_member('admin2');
select lives_ok(format($$ select public.task_acknowledge(%L, %L) $$, pg_temp.fx('fb'), pg_temp.fx('bina')),
  'admin2 notes Bina''s task for her');
select lives_ok(format($$ update public.task_stages set done_at = now(), on_behalf_of = %L where task_id = %L and name = 'Draft' $$,
  pg_temp.fx('bina'), pg_temp.fx('fb')), 'and ticks a stage for her');
select pg_temp.as_member('coord');
select is(pg_temp.reads('fa'), 1::bigint, 'coord reads Asha''s task');
select is((select t.not_noted from public.task_counts() t), 1, '(and counts it as not noted in their badge)');

select pg_temp.as_member('owner');
select is(public.member_deactivate(pg_temp.fx('asha'), 'contract ended'), 'deactivated', 'Asha is deactivated');
select is(public.member_deactivate(pg_temp.fx('bina'), 'contract ended'), 'deactivated', 'Bina is deactivated');
select lives_ok($$ select public.member_set_coordinator(pg_temp.fx('asha'), pg_temp.fx('coord'), 'for her return') $$,
  'a coordinator is set on deactivated Asha, to prepare a return');
select lives_ok($$ select public.member_set_coordinator(pg_temp.fx('bina'), pg_temp.fx('admin2'), 'for her return') $$,
  'and on Bina');

select pg_temp.as_member('coord');
select is(app.coordinator_of(pg_temp.fx('asha')), pg_temp.fx('coord'), 'coord is Asha''s current coordinator');
select is(pg_temp.reads('fa'), 0::bigint, 'but reads none of her tasks while she is deactivated (S-S2)');
select ok(not app.task_visible(pg_temp.fx('fa')), '(app.task_visible agrees)');
select is((select t.not_noted from public.task_counts() t), 0, 'and her tasks are not in coord''s badge');
select throws_ok(format($$ select public.task_acknowledge(%L, %L) $$, pg_temp.fx('fa'), pg_temp.fx('asha')),
  'P0001', 'FORBIDDEN', 'nor acts for her');

select pg_temp.as_member('admin2');
select is(pg_temp.reads('fb'), 1::bigint, 'admin2 still reads Bina''s task: they created it');
select throws_ok(format($$ select public.task_start(%L, %L) $$, pg_temp.fx('fb'), pg_temp.fx('bina')),
  'P0001', 'FORBIDDEN', 'but no longer acts for her (app.task_actor)');
select throws_ok(format($$ update public.task_stages set done_at = null where task_id = %L and name = 'Draft' $$, pg_temp.fx('fb')),
  'P0001', 'FORBIDDEN', 'nor unticks her stage (the guard''s untick path)');
select throws_ok(format($$ update public.task_stages set done_at = now(), on_behalf_of = %L where task_id = %L and name = 'Final' $$,
  pg_temp.fx('bina'), pg_temp.fx('fb')), 'P0001', 'FORBIDDEN', 'nor ticks one for her');

select pg_temp.as_member('owner');
select is(public.member_reactivate(pg_temp.fx('bina')), 'active', 'Bina comes back');
select pg_temp.as_member('admin2');
select lives_ok(format($$ update public.task_stages set done_at = null where task_id = %L and name = 'Draft' $$, pg_temp.fx('fb')),
  'and her coordinator unticks her stage again');
select lives_ok(format($$ select public.task_start(%L, %L) $$, pg_temp.fx('fb'), pg_temp.fx('bina')),
  'and acts for her');

-- S-S3: a sign-in on a freelancer's id ----------------------------------------------------------------
select pg_temp.as_member('bina');
select is((select count(*) from app.current_member()), 0::bigint, 'a session on a freelancer''s id is no member (S-S3)');
select ok(not app.has_permission('tasks.work'), 'and holds no permission');
select is(pg_temp.reads('fb'), 0::bigint, 'and reads none of her tasks');
select pg_temp.as_member('staff1');
select is((select count(*) from app.current_member()), 1::bigint, '(a permanent member is still themselves)');
select ok(app.has_permission('tasks.work'), '(with their permissions)');

-- A-M2: the approving Admin joins a submitted task ------------------------------------------------------
select pg_temp.as_member('owner');
insert into fx values ('r1', public.task_create('Route one', null, pg_temp.type_id('Normal'), null, 'medium',
  pg_temp.due(), array[pg_temp.fx('staff1')], pg_temp.fx('staff1'), pg_temp.fx('admin2')));
insert into fx values ('r2', public.task_create('Route two', null, pg_temp.type_id('Normal'), null, 'medium',
  pg_temp.due(), array[pg_temp.fx('staff1')], pg_temp.fx('staff1'), pg_temp.fx('admin2')));
insert into fx values ('r3', public.task_create('Route three', null, pg_temp.type_id('Normal'), null, 'medium',
  pg_temp.due(), array[pg_temp.fx('staff1')], pg_temp.fx('staff1'), pg_temp.fx('admin2')));
select pg_temp.as_member('staff1');
select is(public.task_submit_done(pg_temp.fx('r1')), 'submitted'::public.task_state, 'R1 is handed in to admin2');
select is(public.task_submit_done(pg_temp.fx('r2')), 'submitted'::public.task_state, 'so is R2');

select pg_temp.as_member('owner');
select is(public.task_update_assignment(pg_temp.fx('r1'), jsonb_build_object('assignee_ids',
  jsonb_build_array(pg_temp.fx('staff1'), pg_temp.fx('admin2')))), array['assignee_ids', 'state'],
  'the Owner adds the approving Admin to submitted R1: the result names the state too (A-M2)');
select is(((pg_temp.task('r1')).state, (pg_temp.task('r1')).admin_step)::text, '(admin_approved,skipped)',
  'R1 waits for the Owner, the Admin step skipped');
select is((select l.meta ->> 'reason' from public.activity_log l
           where l.entity = 'tasks' and l.entity_id = pg_temp.fx('r1') and l.action = 'admin_step_skipped'),
  'approver_is_assignee', 'audited: admin_step_skipped, meta.reason approver_is_assignee');
select is((select l.actor_id from public.activity_log l
           where l.entity = 'tasks' and l.entity_id = pg_temp.fx('r1') and l.action = 'admin_step_skipped'),
  pg_temp.fx('owner'), '(by whoever made the change)');
select pg_temp.as_member('admin2');
select throws_ok(format($$ select public.task_review(%L, 'approved') $$, pg_temp.fx('r1')),
  'P0001', 'FORBIDDEN', 'admin2 cannot decide it');
select pg_temp.as_member('owner');
select is(public.task_review(pg_temp.fx('r1'), 'approved'), 'completed'::public.task_state, 'the Owner completes it');

select is(public.task_update_assignment(pg_temp.fx('r2'), jsonb_build_object('assignee_ids',
  jsonb_build_array(pg_temp.fx('staff1'), pg_temp.fx('staff2')))), array['assignee_ids'],
  'someone else added to submitted R2 changes only the assignees');
select is(((pg_temp.task('r2')).state, (pg_temp.task('r2')).admin_step)::text, '(submitted,required)',
  'R2 still waits for admin2');
select pg_temp.as_member('admin2');
select is(public.task_review(pg_temp.fx('r2'), 'approved'), 'admin_approved'::public.task_state, 'who checks it');

select pg_temp.as_member('owner');
select is(public.task_update_assignment(pg_temp.fx('r3'), jsonb_build_object('assignee_ids',
  jsonb_build_array(pg_temp.fx('staff1'), pg_temp.fx('admin2')))), array['assignee_ids'],
  'the approver added before Done leaves the route to Done');
select is(((pg_temp.task('r3')).state, (pg_temp.task('r3')).admin_step)::text, '(todo,required)', '(R3 is still to do)');

-- A-S4: task_unread_counts takes the list's ids ---------------------------------------------------------
select pg_temp.as_member('staff1');
select throws_ok($$ select * from public.task_unread_counts(null) $$, 'P0001', 'VALIDATION', 'a null list is refused (A-S4)');
select throws_ok($$ select * from public.task_unread_counts() $$, 'P0001', 'VALIDATION', 'and so is no list');
select throws_ok($$ select * from public.task_unread_counts(array(select gen_random_uuid() from generate_series(1, 501))) $$,
  'P0001', 'VALIDATION', 'and more than 500 ids');
select lives_ok($$ select * from public.task_unread_counts(array(select gen_random_uuid() from generate_series(1, 500))) $$,
  '500 are counted');
select lives_ok($$ select * from public.task_unread_counts('{}') $$, 'and an empty list');

-- L2: payload bounds ----------------------------------------------------------------------------------
select pg_temp.as_member('owner');
select throws_ok(format($$ select public.task_create('Long list', null, %L::uuid, null, 'medium', pg_temp.due(), array[%L::uuid], %L::uuid,
    stages => array(select 'Stage ' || n from generate_series(1, 31) n)) $$, pg_temp.type_id('Normal'), pg_temp.fx('staff1'), pg_temp.fx('staff1')),
  'P0001', 'VALIDATION', 'task_create takes at most 30 stages (L2)');
insert into fx values ('s30', public.task_create('Thirty', null, pg_temp.type_id('Normal'), null, 'medium',
  pg_temp.due(), array[pg_temp.fx('staff1')], pg_temp.fx('staff1'), stages => array(select 'Stage ' || n from generate_series(1, 30) n)));
select is((select count(*) from public.task_stages s where s.task_id = pg_temp.fx('s30')), 30::bigint, '30 are fine');
select throws_ok(format($$ insert into public.task_stages (task_id, name, position) values (%L, 'One more', 'z0') $$, pg_temp.fx('s30')),
  'P0001', 'VALIDATION', 'and a 31st through the API is refused');
select throws_ok(format($$ select public.task_create('Crowd', null, %L::uuid, null, 'medium', pg_temp.due(),
    array(select gen_random_uuid() from generate_series(1, 21)), %L::uuid) $$, pg_temp.type_id('Normal'), pg_temp.fx('staff1')),
  'P0001', 'VALIDATION', 'at most 20 assignees');
select throws_ok(format($$ select public.task_create('Rules', null, %L::uuid, null, 'medium', pg_temp.due(), array[%L::uuid], %L::uuid,
    reminder_rules => '{"hours": 2}') $$, pg_temp.type_id('Normal'), pg_temp.fx('staff1'), pg_temp.fx('staff1')),
  'P0001', 'VALIDATION', 'reminder rules are a list');
select throws_ok(format($$ select public.task_create('Rules', null, %L::uuid, null, 'medium', pg_temp.due(), array[%L::uuid], %L::uuid,
    reminder_rules => '[2]') $$, pg_temp.type_id('Normal'), pg_temp.fx('staff1'), pg_temp.fx('staff1')),
  'P0001', 'VALIDATION', 'of objects');
select throws_ok(format($$ select public.task_create('Rules', null, %L::uuid, null, 'medium', pg_temp.due(), array[%L::uuid], %L::uuid,
    reminder_rules => (select jsonb_agg(jsonb_build_object('hours', n)) from generate_series(1, 11) n)) $$,
    pg_temp.type_id('Normal'), pg_temp.fx('staff1'), pg_temp.fx('staff1')),
  'P0001', 'VALIDATION', 'at most 10');
insert into fx values ('rules', public.task_create('Rules', null, pg_temp.type_id('Normal'), null, 'medium',
  pg_temp.due(), array[pg_temp.fx('staff1')], pg_temp.fx('staff1'), reminder_rules => '[{"kind": "due", "hours": 2}]'));
select is((pg_temp.task('rules')).reminder_rules, '[{"kind": "due", "hours": 2}]'::jsonb, 'a list of objects is kept');
select throws_ok(format($$ select public.task_update_assignment(%L, '{"reminder_rules": ["soon"]}') $$, pg_temp.fx('rules')),
  'P0001', 'VALIDATION', 'task_update_assignment checks the rules it is given');
select throws_ok(format($$ select public.task_create('Warned', null, %L::uuid, null, 'medium', pg_temp.due(), array[%L::uuid], %L::uuid,
    warnings => jsonb_build_array(jsonb_build_object('kind', 'workload', 'member_id', %L::uuid,
      'details', jsonb_build_object('date', '2026-10-01', 'open_tasks', 5, 'note', 'anything')))) $$,
    pg_temp.type_id('Normal'), pg_temp.fx('staff1'), pg_temp.fx('staff1'), pg_temp.fx('staff1')),
  'P0001', 'VALIDATION', 'a warning''s details hold only the keys the dialog writes');
select throws_ok(format($$ select public.task_create('Warned', null, %L::uuid, null, 'medium', pg_temp.due(), array[%L::uuid], %L::uuid,
    warnings => jsonb_build_array(jsonb_build_object('kind', 'on_leave', 'member_id', %L::uuid,
      'details', jsonb_build_object('date', repeat('x', 600))))) $$,
    pg_temp.type_id('Normal'), pg_temp.fx('staff1'), pg_temp.fx('staff1'), pg_temp.fx('staff1')),
  'P0001', 'VALIDATION', 'short values only');
select throws_ok(format($$ select public.task_create('Warned', null, %L::uuid, null, 'medium', pg_temp.due(), array[%L::uuid], %L::uuid,
    warnings => jsonb_build_array(jsonb_build_object('kind', 'overlap', 'member_id', %L::uuid,
      'details', jsonb_build_object('start_at', jsonb_build_object('nested', true))))) $$,
    pg_temp.type_id('Normal'), pg_temp.fx('staff1'), pg_temp.fx('staff1'), pg_temp.fx('staff1')),
  'P0001', 'VALIDATION', 'texts or numbers');
select throws_ok(format($$ select public.task_create('Warned', null, %L::uuid, null, 'medium', pg_temp.due(), array[%L::uuid], %L::uuid,
    warnings => (select jsonb_agg(jsonb_build_object('kind', 'workload', 'member_id', %L::uuid)) from generate_series(1, 61))) $$,
    pg_temp.type_id('Normal'), pg_temp.fx('staff1'), pg_temp.fx('staff1'), pg_temp.fx('staff1')),
  'P0001', 'VALIDATION', 'at most 60 warnings');
insert into fx values ('warned', public.task_create('Warned', null, pg_temp.type_id('Normal'), null, 'medium',
  pg_temp.due(), array[pg_temp.fx('staff1')], pg_temp.fx('staff1'), warnings => jsonb_build_array(
    jsonb_build_object('kind', 'workload', 'member_id', pg_temp.fx('staff1'),
      'details', jsonb_build_object('date', '2026-10-01', 'open_tasks', 5, 'threshold', 4)))));
select is((select w.details from public.task_warnings w where w.task_id = pg_temp.fx('warned')),
  '{"date": "2026-10-01", "open_tasks": 5, "threshold": 4}'::jsonb, 'what the dialog writes is kept');

-- L4: a tick on a ticked stage keeps the first -------------------------------------------------------
select pg_temp.as_member('staff1');
select lives_ok(format($$ update public.task_stages set done_at = now() where task_id = %L and name = 'Stage 1' $$, pg_temp.fx('s30')),
  'staff1 ticks a stage');
select pg_temp.as_system();
update public.task_stages set done_at = now() - interval '1 day' where task_id = pg_temp.fx('s30') and name = 'Stage 1';
select pg_temp.as_member('staff1');
select lives_ok(format($$ update public.task_stages set done_at = now() where task_id = %L and name = 'Stage 1' $$, pg_temp.fx('s30')),
  'a second tick goes through');
select is((pg_temp.stage('s30', 'Stage 1')).done_at, now() - interval '1 day', 'but the first tick''s time stays (L4)');
select is((pg_temp.stage('s30', 'Stage 1')).done_by, pg_temp.fx('staff1'), 'and its author');
select lives_ok(format($$ update public.task_stages set done_at = null where task_id = %L and name = 'Stage 1' $$, pg_temp.fx('s30')),
  'an untick still works');
select is((pg_temp.stage('s30', 'Stage 1')).done_at, null, '(the stage is open again)');

select * from finish();
rollback;
