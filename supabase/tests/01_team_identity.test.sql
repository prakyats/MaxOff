-- pgTAP for the 1.1 team identity migration. Run with `pnpm db:test` (local stack running).
-- Every table for every role (allowed and denied), the helpers, the audit trigger, the column
-- guards and the PERMISSIONS §1 seed. Everything rolls back.
begin;
create extension if not exists pgtap with schema extensions;
select plan(143);

-- The local seed (1.2) holds five sign-ins; the tests build their own team on an empty one.
-- Rolled back with everything else at the end.
-- activity_log first: its actor_id references members (rows exist after a Playwright run).
-- Attendance and leave rows (2.1) reference members: a Playwright run leaves some behind (2.2).
delete from public.attendance_events;
delete from public.attendance_days;
delete from public.leave_requests;
delete from public.session_events;
delete from public.activity_log;
delete from public.members;
delete from auth.identities;
delete from auth.users;
delete from public.activity_log; -- again: the member deletes were audited

-- Fixtures --------------------------------------------------------------------------------
-- Fixed uuids keep the assertions readable. The organization is the seeded one when present
-- (current_org_id() falls back to the single organizations row), else one made here.
create temporary table fx (key text primary key, id uuid not null);
insert into fx values
  ('owner',         '00000000-0000-4000-8000-000000000001'),
  ('admin',       '00000000-0000-4000-8000-000000000002'),
  ('staff',       '00000000-0000-4000-8000-000000000003'),
  ('deactivated', '00000000-0000-4000-8000-000000000004'),
  ('invited',     '00000000-0000-4000-8000-000000000005'),
  ('newcomer',    '00000000-0000-4000-8000-000000000006'),
  ('second_ceo',  '00000000-0000-4000-8000-000000000007');

insert into public.organizations (name)
select 'Test Org' where not exists (select 1 from public.organizations);
insert into fx select 'org', id from public.organizations limit 1;
-- The fixtures are read while acting as the API roles too.
grant select on fx to authenticated, anon;

create function pg_temp.fx(k text) returns uuid language sql stable as $$
  select id from fx where key = k;
$$;

-- Act as a signed-in member: the claims PostgREST would set, plus the API role.
create function pg_temp.as_member(k text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', pg_temp.fx(k)::text, true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', pg_temp.fx(k), 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end;
$$;

-- Back to the migration owner with no claims.
create function pg_temp.as_system() returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', '', true);
end;
$$;

insert into auth.users (id, email)
select id, key || '@example.com' from fx where key <> 'org';

-- Written as the owner: in_transition() is true here, so status/joined_at pass the guard.
insert into public.members (id, org_id, full_name, email, phone, role, status, joined_at, deactivated_at)
values
  (pg_temp.fx('owner'),         pg_temp.fx('org'), 'Test Owner',   'owner@example.com',   '9000000001', 'owner',   'active', now(), null),
  (pg_temp.fx('admin'),       pg_temp.fx('org'), 'Test Admin', 'admin@example.com', '9000000002', 'admin', 'active', now(), null),
  (pg_temp.fx('staff'),       pg_temp.fx('org'), 'Test Staff', 'staff@example.com', null,         'staff', 'active', now(), null),
  (pg_temp.fx('deactivated'), pg_temp.fx('org'), 'Gone Staff', 'deactivated@example.com', null,   'staff', 'deactivated', now(), now()),
  (pg_temp.fx('invited'),     pg_temp.fx('org'), 'New Admin',  'invited@example.com', null,       'admin', 'invited', null, null);

-- Structure -------------------------------------------------------------------------------
select has_type('public', 'member_role', 'member_role enum exists');
select has_type('public', 'member_status', 'member_status enum exists');
select has_table('public', 'organizations', 'organizations exists');
select has_table('public', 'org_settings', 'org_settings exists');
select has_table('public', 'members', 'members exists');
select has_table('public', 'role_permissions', 'role_permissions exists');
select has_table('public', 'session_events', 'session_events exists');
select has_table('public', 'activity_log', 'activity_log exists');
select has_view('public', 'member_directory', 'member_directory view exists');
select hasnt_column('public', 'member_directory', 'email', 'the directory has no email column');
select has_column('public', 'member_directory', 'phone', 'the directory shows the phone');
select has_index('public', 'members', 'members_single_owner', 'the single-Owner index exists');
select has_index('public', 'members', 'members_email_unique', 'the email index exists');
select has_function('app', 'current_org_id', array[]::text[], 'app.current_org_id() exists');
select has_function('app', 'current_member', array[]::text[], 'app.current_member() exists');
select has_function('app', 'has_permission', array['text'], 'app.has_permission(text) exists');
select has_function('app', 'in_transition', array[]::text[], 'app.in_transition() exists');
select has_function('app', 'protect_columns', array[]::text[], 'app.protect_columns() exists');
select has_function('app', 'audit_row_change', array[]::text[], 'app.audit_row_change() exists');
select has_function('app', 'members_insert_guard', array[]::text[], 'app.members_insert_guard() exists');
select is(
  (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity),
  0::bigint, 'RLS is enabled on every public table');
select is((select count(*) from public.org_settings where org_id = pg_temp.fx('org')), 1::bigint,
  'the organization got its org_settings row by trigger');
-- On a NEW organization: the seeded one is editable from Settings (1.4), so asserting its
-- current values would only say what the last person saved.
savepoint fresh_org;
insert into public.organizations (id, name) values ('00000000-0000-4000-8000-0000000000ff', 'Defaults Org');
select results_eq(
  $$ select weekly_off_days, logout_reminder_time::text, ack_repeat_hours, ack_escalate_hours,
            ack_escalate_owner_hours, overdue_escalate_hours, email_daily_cap_per_member
       from public.org_settings where org_id = '00000000-0000-4000-8000-0000000000ff' $$,
  $$ values ('{0}'::smallint[], '20:30:00', 2, 4, 8, 24, 20) $$,
  'a new organization''s org_settings carry the PRODUCT §7 launch defaults');
rollback to savepoint fresh_org;

-- Seed (PERMISSIONS §1) -------------------------------------------------------------------
select is((select count(*) from public.role_permissions), 49::bigint, '49 grants are seeded');
select is((select count(*) from public.role_permissions where role = 'owner'), 29::bigint, 'the Owner holds 29 keys');
select is((select count(*) from public.role_permissions where role = 'admin'), 16::bigint, 'Admins hold 16 keys');
select results_eq(
  $$ select permission from public.role_permissions where role = 'staff' order by 1 $$,
  $$ values ('attendance.self'), ('drive.view_status'), ('task_requests.create'), ('tasks.work') $$,
  'Staff hold exactly the four PERMISSIONS §1 keys');
select ok(exists (select 1 from public.role_permissions where role = 'admin' and permission = 'tasks.approve_admin'),
  'the Admin approval step belongs to Admins');
select ok(not exists (select 1 from public.role_permissions where role = 'owner' and permission = 'tasks.approve_admin'),
  'the Owner does not hold the Admin approval step');
select ok(not exists (select 1 from public.role_permissions where role = 'owner' and permission = 'attendance.self'),
  'the Owner does not mark attendance');
select ok(exists (select 1 from public.role_permissions where role = 'owner' and permission = 'finance.view'),
  'money is an Owner key');

-- Helpers ---------------------------------------------------------------------------------
select is(app.current_org_id(), pg_temp.fx('org'), 'without a caller, current_org_id() is the single organization');
select is(app.in_transition(), true, 'the owner is "in transition"');
set local role service_role;
select is(app.in_transition(), true, 'service_role is "in transition": jobs bypass the column guards and must call transition functions');
select pg_temp.as_system();

select pg_temp.as_member('owner');
select is((select id from app.current_member()), pg_temp.fx('owner'), 'current_member() is the caller');
select is(app.current_org_id(), pg_temp.fx('org'), 'current_org_id() is the caller''s organization');
select is(app.has_permission('team.manage'), true, 'the Owner has team.manage');
select is(app.has_permission('tasks.approve_admin'), false, 'the Owner lacks tasks.approve_admin');
select is(app.has_permission('no.such_key'), false, 'an unknown key is false, not an error');
select is(app.in_transition(), false, 'the API role is not in transition');

select pg_temp.as_member('staff');
select is(app.has_permission('tasks.work'), true, 'Staff have tasks.work');
select is(app.has_permission('team.manage'), false, 'Staff lack team.manage');

select pg_temp.as_member('deactivated');
select is_empty($$ select * from app.current_member() $$, 'a deactivated member has no current_member() row');
select is(app.has_permission('tasks.work'), false, 'a deactivated member has no permissions');

select pg_temp.as_member('invited');
select is_empty($$ select * from app.current_member() $$, 'an invited member has no current_member() row yet');

select pg_temp.as_system();
set local role anon;
select throws_ok($$ select app.current_member() $$, '42501', null, 'anon cannot call app.current_member()');
select throws_ok($$ select count(*) from public.members $$, '42501', null, 'anon cannot read members');
select throws_ok($$ select count(*) from public.member_directory $$, '42501', null, 'anon cannot read the directory');
select throws_ok($$ select count(*) from public.activity_log $$, '42501', null, 'anon cannot read the activity log');
select pg_temp.as_system();

-- organizations ---------------------------------------------------------------------------
select pg_temp.as_member('owner');
select is((select count(*) from public.organizations), 1::bigint, 'the Owner sees the organization');
update public.organizations set name = 'Renamed Org' where id = pg_temp.fx('org');
select is((select name from public.organizations where id = pg_temp.fx('org')), 'Renamed Org',
  'settings.manage may rename the organization');
select throws_ok($$ insert into public.organizations (name) values ('Second') $$, '42501', null,
  'nobody inserts organizations through the API');
select throws_ok($$ delete from public.organizations where id = pg_temp.fx('org') $$, '42501', null,
  'nobody deletes organizations through the API');

select pg_temp.as_member('staff');
select is((select count(*) from public.organizations), 1::bigint, 'Staff see the organization');
update public.organizations set name = 'Staff Rename' where id = pg_temp.fx('org');
select is((select name from public.organizations where id = pg_temp.fx('org')), 'Renamed Org',
  'Staff cannot rename the organization');

select pg_temp.as_member('deactivated');
select is((select count(*) from public.organizations), 0::bigint, 'a deactivated member sees nothing');

-- org_settings ----------------------------------------------------------------------------
select pg_temp.as_member('staff');
select is((select count(*) from public.org_settings), 1::bigint, 'Staff read the settings');
update public.org_settings set ack_repeat_hours = 3 where org_id = pg_temp.fx('org');
select is((select ack_repeat_hours from public.org_settings where org_id = pg_temp.fx('org')), 2,
  'Staff cannot change the settings');
select pg_temp.as_member('admin');
update public.org_settings set ack_repeat_hours = 3 where org_id = pg_temp.fx('org');
select is((select ack_repeat_hours from public.org_settings where org_id = pg_temp.fx('org')), 2,
  'Admins cannot change the settings');
select pg_temp.as_member('owner');
update public.org_settings set ack_repeat_hours = 3 where org_id = pg_temp.fx('org');
select is((select ack_repeat_hours from public.org_settings where org_id = pg_temp.fx('org')), 3,
  'the Owner changes the settings');
select throws_ok($$ update public.org_settings set ack_repeat_hours = 0 where org_id = pg_temp.fx('org') $$,
  '23514', null, 'thresholds must be positive');
select is(
  (select diff from public.activity_log where entity = 'org_settings' and action = 'update'
     and entity_id = pg_temp.fx('org') order by id desc limit 1),
  '{"old": {"ack_repeat_hours": 2}, "new": {"ack_repeat_hours": 3}}'::jsonb,
  'the settings change is audited under the org_id (trigger argument)');

-- members: reading ------------------------------------------------------------------------
select pg_temp.as_member('owner');
select is((select count(*) from public.members), 5::bigint, 'the Owner reads every member row');
select is((select count(*) from public.member_directory), 5::bigint, 'the Owner reads the whole directory');

select pg_temp.as_member('admin');
select is((select count(*) from public.members), 1::bigint, 'an Admin reads only their own member row');
select is((select count(*) from public.member_directory), 5::bigint,
  'an Admin reads everyone in the directory (team.view)');
select is((select phone from public.member_directory where id = pg_temp.fx('owner')), '9000000001',
  'the directory gives an Admin a colleague''s phone');

select pg_temp.as_member('staff');
select is((select count(*) from public.members), 1::bigint, 'Staff read only their own member row');
select is((select email from public.members where id = pg_temp.fx('staff')), 'staff@example.com',
  'Staff read their own email');
select results_eq($$ select id from public.member_directory $$, $$ select pg_temp.fx('staff') $$,
  'Staff see only themselves in the directory');

select pg_temp.as_member('deactivated');
select is((select count(*) from public.members), 0::bigint, 'a deactivated member reads no member row, not even their own');
select is((select count(*) from public.member_directory), 0::bigint, 'a deactivated member reads no directory');

select pg_temp.as_member('invited');
select is((select count(*) from public.members), 0::bigint, 'an invited member reads nothing until they accept');

-- members: writing ------------------------------------------------------------------------
select pg_temp.as_member('owner');
insert into public.members (id, full_name, email, role)
values (pg_temp.fx('newcomer'), 'New Comer', 'Newcomer@Example.com', 'staff');
select results_eq(
  $$ select org_id, status, joined_at is null from public.members where id = pg_temp.fx('newcomer') $$,
  $$ select pg_temp.fx('org'), 'invited'::public.member_status, true $$,
  'team.manage invites a member: org_id defaults to the caller''s org, status to invited');
select results_eq(
  $$ select actor_id, action, diff -> 'new' ->> 'full_name' from public.activity_log
       where entity = 'members' and entity_id = pg_temp.fx('newcomer') $$,
  $$ select pg_temp.fx('owner'), 'insert', 'New Comer' $$,
  'the invite is audited with the Owner as actor and the new values');
select throws_ok(
  $$ insert into public.members (id, full_name, email, role) values (pg_temp.fx('second_ceo'), 'Two', 'two@example.com', 'owner') $$,
  '23505', null, 'a second Owner is refused by the unique index');
select throws_ok(
  $$ insert into public.members (id, full_name, email, role) values (pg_temp.fx('second_ceo'), 'Dup', 'STAFF@example.com', 'staff') $$,
  '23505', null, 'emails are unique regardless of case');
update public.members set full_name = 'Test Staff Edited', role = 'admin' where id = pg_temp.fx('staff');
select results_eq(
  $$ select full_name, role from public.members where id = pg_temp.fx('staff') $$,
  $$ values ('Test Staff Edited', 'admin'::public.member_role) $$,
  'team.manage edits a name and a role directly');
select is(
  (select diff from public.activity_log where entity = 'members' and entity_id = pg_temp.fx('staff')
     and action = 'update' order by id desc limit 1),
  '{"old": {"role": "staff", "full_name": "Test Staff"}, "new": {"role": "admin", "full_name": "Test Staff Edited"}}'::jsonb,
  'the edit is audited with only the changed columns');
update public.members set full_name = 'Test Staff Edited' where id = pg_temp.fx('staff');
select is(
  (select count(*) from public.activity_log where entity = 'members' and entity_id = pg_temp.fx('staff') and action = 'update'),
  1::bigint, 'a no-op update writes no audit row');
select throws_ok(
  $$ update public.members set status = 'deactivated', deactivated_at = now() where id = pg_temp.fx('staff') $$,
  '42501', null, 'status has no UPDATE privilege for the API role, even with team.manage');
select throws_ok(
  $$ update public.members set email = 'other@example.com' where id = pg_temp.fx('staff') $$,
  '42501', null, 'email has no UPDATE privilege for the API role (changes go through a transition function)');
select throws_ok(
  $$ insert into public.members (id, full_name, email, role, status, joined_at)
     values (pg_temp.fx('second_ceo'), 'Early', 'early@example.com', 'staff', 'active', now()) $$,
  'P0001', 'FORBIDDEN', 'team.manage cannot invite someone as already active');
select throws_ok(
  $$ insert into public.members (id, full_name, email, role, status, deactivated_at)
     values (pg_temp.fx('second_ceo'), 'Early', 'early@example.com', 'staff', 'deactivated', now()) $$,
  'P0001', 'FORBIDDEN', 'team.manage cannot invite someone as deactivated');
-- The second layer: with the column privilege back, the guard trigger still refuses.
select pg_temp.as_system();
grant update (status, deactivated_at, email) on public.members to authenticated;
select pg_temp.as_member('owner');
select throws_ok(
  $$ update public.members set status = 'deactivated', deactivated_at = now() where id = pg_temp.fx('staff') $$,
  'P0001', 'FORBIDDEN', 'protect_columns refuses a status change even when the privilege exists');
select throws_ok(
  $$ update public.members set email = 'other@example.com' where id = pg_temp.fx('staff') $$,
  'P0001', 'FORBIDDEN', 'protect_columns refuses an email change even when the privilege exists');
select pg_temp.as_system();
revoke update (status, deactivated_at, email) on public.members from authenticated;
select pg_temp.as_member('owner');
select throws_ok(
  $$ update public.members set role = 'admin' where id = pg_temp.fx('owner') $$,
  'P0001', 'FORBIDDEN', 'the Owner cannot demote themselves (exactly one Owner)');
select throws_ok(
  $$ delete from public.members where id = pg_temp.fx('newcomer') $$,
  '42501', null, 'members are never deleted through the API');
select is(
  (select count(*) from public.activity_log where entity = 'members' and entity_id = pg_temp.fx('staff') and action = 'update'),
  1::bigint, 'a refused change leaves no audit row');

select pg_temp.as_member('admin');
select throws_ok(
  $$ insert into public.members (id, full_name, email, role) values (pg_temp.fx('second_ceo'), 'X', 'x@example.com', 'staff') $$,
  '42501', null, 'an Admin cannot invite (team.manage)');
update public.members set full_name = 'Hacked' where id = pg_temp.fx('staff');
select pg_temp.as_member('owner');
select is((select full_name from public.members where id = pg_temp.fx('staff')), 'Test Staff Edited',
  'an Admin cannot edit another member');

select pg_temp.as_member('staff');
update public.members set full_name = 'Staff Self', phone = '9000000003' where id = pg_temp.fx('staff');
select results_eq(
  $$ select full_name, phone from public.members where id = pg_temp.fx('staff') $$,
  $$ values ('Staff Self', '9000000003') $$,
  'a member edits their own name and phone');
select is(
  (select actor_id from public.activity_log where entity = 'members' and entity_id = pg_temp.fx('staff')
     order by id desc limit 1),
  pg_temp.fx('staff'), 'the self-edit is audited with the member as actor');
select throws_ok(
  $$ update public.members set role = 'owner' where id = pg_temp.fx('staff') $$,
  'P0001', 'FORBIDDEN', 'a member cannot change their own role');
select throws_ok(
  $$ update public.members set email = 'me@example.com' where id = pg_temp.fx('staff') $$,
  '42501', null, 'a member cannot change their own email');
select throws_ok(
  $$ update public.members set status = 'deactivated', deactivated_at = now() where id = pg_temp.fx('staff') $$,
  '42501', null, 'a member cannot change their own status');

select pg_temp.as_member('admin');
update public.members set full_name = 'Admin Self', phone = '9000000022' where id = pg_temp.fx('admin');
select results_eq(
  $$ select full_name, phone from public.members where id = pg_temp.fx('admin') $$,
  $$ values ('Admin Self', '9000000022') $$,
  'an Admin edits their own name and phone');
select throws_ok(
  $$ update public.members set role = 'owner' where id = pg_temp.fx('admin') $$,
  'P0001', 'FORBIDDEN', 'an Admin cannot change their own role');
select throws_ok(
  $$ update public.members set email = 'admin2@example.com' where id = pg_temp.fx('admin') $$,
  '42501', null, 'an Admin cannot change their own email');
-- RLS alone holds the line too: with the self-edit guard off, the WITH CHECK still refuses.
select pg_temp.as_system();
alter table public.members disable trigger self_edit_guard;
select pg_temp.as_member('staff');
-- (the Owner promoted this fixture to admin above, so 'staff' is a real change here)
select throws_ok(
  $$ update public.members set role = 'staff' where id = pg_temp.fx('staff') $$,
  '42501', null, 'members_update_own WITH CHECK refuses a self role change without the trigger');
select pg_temp.as_system();
alter table public.members enable trigger self_edit_guard;
select pg_temp.as_member('staff');
select throws_ok(
  $$ insert into public.members (id, full_name, email, role) values (pg_temp.fx('second_ceo'), 'X', 'x@example.com', 'staff') $$,
  '42501', null, 'Staff cannot insert members');

select pg_temp.as_member('deactivated');
update public.members set full_name = 'Back' where id = pg_temp.fx('deactivated');
select pg_temp.as_system();
select is((select full_name from public.members where id = pg_temp.fx('deactivated')), 'Gone Staff',
  'a deactivated member cannot edit their row');

-- members: the transition path (owner) ------------------------------------------------------
update public.members set status = 'deactivated', deactivated_at = now() where id = pg_temp.fx('newcomer');
select is((select status from public.members where id = pg_temp.fx('newcomer')), 'deactivated'::public.member_status,
  'a transition function (owner) may change status');
select is(
  (select diff -> 'new' ->> 'status' from public.activity_log where entity = 'members'
     and entity_id = pg_temp.fx('newcomer') and action = 'update' order by id desc limit 1),
  'deactivated', 'the transition is audited too');
select throws_ok(
  $$ update public.members set status = 'active' where id = pg_temp.fx('newcomer') $$,
  '23514', null, 'active requires joined_at (check constraint)');
select throws_ok(
  $$ update public.members set deactivated_at = null where id = pg_temp.fx('newcomer') $$,
  '23514', null, 'deactivated_at and status move together (check constraint)');

-- role_permissions ------------------------------------------------------------------------
select pg_temp.as_member('staff');
select is((select count(*) from public.role_permissions), 49::bigint, 'any active member reads the grants');
select pg_temp.as_member('deactivated');
select is((select count(*) from public.role_permissions), 0::bigint, 'a deactivated member reads no grants');
select pg_temp.as_member('owner');
select throws_ok($$ insert into public.role_permissions values ('staff', 'finance.view') $$, '42501', null,
  'grants are not editable through the API, not even by the Owner');
select throws_ok($$ delete from public.role_permissions where role = 'staff' $$, '42501', null,
  'grants are not deletable through the API');

-- session_events --------------------------------------------------------------------------
select pg_temp.as_system();
insert into public.session_events (member_id, kind, user_agent) values
  (pg_temp.fx('owner'), 'login', 'test'),
  (pg_temp.fx('admin'), 'login', 'test'),
  (pg_temp.fx('staff'), 'login', 'test'),
  (pg_temp.fx('staff'), 'logout', 'test');
select throws_ok($$ insert into public.session_events (member_id, kind) values (pg_temp.fx('owner'), 'other') $$,
  '23514', null, 'kind is login or logout');

select pg_temp.as_member('owner');
select is((select count(*) from public.session_events), 4::bigint, 'the Owner sees every session event');
select throws_ok($$ delete from public.session_events $$, '42501', null, 'session events are never deleted');
select throws_ok($$ update public.session_events set kind = 'logout' $$, '42501', null, 'session events are never updated');
select throws_ok($$ insert into public.session_events (member_id, kind) values (pg_temp.fx('owner'), 'login') $$,
  '42501', null, 'session events are written by functions only');

select pg_temp.as_member('admin');
select results_eq($$ select member_id from public.session_events $$, $$ select pg_temp.fx('admin') $$,
  'an Admin sees only their own session events');
select pg_temp.as_member('staff');
select is((select count(*) from public.session_events), 2::bigint, 'Staff see only their own session events');
select pg_temp.as_member('deactivated');
select is((select count(*) from public.session_events), 0::bigint, 'a deactivated member sees no session events');

-- activity_log ----------------------------------------------------------------------------
select pg_temp.as_member('owner');
select ok((select count(*) from public.activity_log where entity = 'organizations') >= 1,
  'the Owner sees organization entries (activity.view_all)');
select results_eq(
  $$ select diff -> 'new', diff -> 'old' ? 'name', diff -> 'old' ? 'updated_at', diff -> 'new' ? 'updated_at'
       from public.activity_log where entity = 'organizations' and action = 'update'
       and entity_id = pg_temp.fx('org') order by id desc limit 1 $$,
  $$ values ('{"name": "Renamed Org"}'::jsonb, true, false, false) $$,
  'the rename diff holds only the changed column, without updated_at');
select throws_ok(
  $$ insert into public.activity_log (org_id, entity, entity_id, action) values (pg_temp.fx('org'), 'x', pg_temp.fx('org'), 'insert') $$,
  '42501', null, 'the activity log is written by triggers and functions only');
select throws_ok($$ update public.activity_log set meta = '{"x": 1}' $$, '42501', null, 'the activity log is never updated');
select throws_ok($$ delete from public.activity_log $$, '42501', null, 'the activity log is never deleted');

select pg_temp.as_member('staff');
select is((select count(*) from public.activity_log where entity in ('organizations', 'org_settings')), 0::bigint,
  'Staff see no organization entries');
select is((select count(*) from public.activity_log where entity = 'members' and entity_id <> pg_temp.fx('staff')), 0::bigint,
  'Staff see no entries about other members');
select ok(
  (select count(*) from public.activity_log where entity = 'members' and entity_id = pg_temp.fx('staff') and actor_id = pg_temp.fx('owner')) >= 1,
  'Staff see the Owner''s edit of their own member row');
select is((select count(*) from public.activity_log where entity_id <> pg_temp.fx('staff')), 0::bigint,
  'Staff see no entry outside their own member row, not even ones they caused');

select pg_temp.as_member('admin');
select is((select count(*) from public.activity_log where entity_id <> pg_temp.fx('admin')), 0::bigint,
  'an Admin sees only entries about their own member row (until modules widen it)');

select pg_temp.as_member('deactivated');
select is((select count(*) from public.activity_log), 0::bigint, 'a deactivated member sees no activity');

-- Grants (defence in depth behind the policies) -------------------------------------------
select pg_temp.as_system();
select is(
  (select count(*) from (values ('organizations'), ('org_settings'), ('members'), ('role_permissions'),
     ('session_events'), ('activity_log'), ('member_directory')) t(name)
    where has_table_privilege('anon', 'public.' || name, 'select, insert, update, delete')),
  0::bigint, 'anon has no privilege on any identity table or the directory');
select ok(not has_table_privilege('authenticated', 'public.activity_log', 'insert, update, delete, truncate'),
  'authenticated cannot write or truncate the activity log');
select ok(not has_table_privilege('authenticated', 'public.session_events', 'insert, update, delete, truncate'),
  'authenticated cannot write or truncate session events');
select is(
  (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r'
      and (has_table_privilege('authenticated', c.oid, 'truncate, references, trigger')
        or has_table_privilege('anon', c.oid, 'truncate, references, trigger'))),
  0::bigint, 'no public table lets the API roles truncate, reference or add triggers');
select ok(has_column_privilege('authenticated', 'public.members', 'full_name', 'update')
  and has_column_privilege('authenticated', 'public.members', 'phone', 'update')
  and has_column_privilege('authenticated', 'public.members', 'role', 'update')
  and has_column_privilege('authenticated', 'public.members', 'job_title_id', 'update'),
  'authenticated may update name, phone, role and job title (1.3) on members');
select is(
  (select count(*) from unnest(array['status', 'invited_at', 'joined_at', 'deactivated_at', 'email', 'id', 'org_id']) col
    where has_column_privilege('authenticated', 'public.members', col, 'update')),
  0::bigint, 'the protected and identity columns of members carry no UPDATE privilege');
select ok(not has_table_privilege('authenticated', 'public.role_permissions', 'insert, update, delete'),
  'authenticated cannot write grants');
select ok(not has_table_privilege('authenticated', 'public.members', 'delete'),
  'authenticated cannot delete members');
select ok(not has_table_privilege('authenticated', 'public.organizations', 'insert, delete'),
  'authenticated cannot insert or delete organizations');
select ok(not has_table_privilege('authenticated', 'public.org_settings', 'insert, delete'),
  'authenticated cannot insert or delete settings');
select ok(has_table_privilege('authenticated', 'public.member_directory', 'select')
  and not has_table_privilege('authenticated', 'public.member_directory', 'insert, update, delete'),
  'the directory is read-only for authenticated');

-- current_org_id() with several organizations ----------------------------------------------
insert into public.organizations (name) values ('Another Org');
select is(app.current_org_id(), null, 'without a caller and with several organizations, current_org_id() is null');
select pg_temp.as_member('owner');
select is(app.current_org_id(), pg_temp.fx('org'), 'a member''s org wins over the fallback');
select is((select count(*) from public.organizations), 1::bigint, 'a member sees only their own organization');
select pg_temp.as_system();

select * from finish();
rollback;
