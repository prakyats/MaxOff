-- 3.1 Clients: the five relations for every role (allowed and denied), the scope helpers, the
-- protected columns, the activity policy, and every path of the lifecycle and contact functions.
begin;
create extension if not exists pgtap with schema extensions;
select plan(160);

-- The local seed holds an organization and sign-ins. Keep the organization; replace the people
-- with fixtures. Rolled back at the end. Order follows the foreign keys.
delete from public.attendance_events;
delete from public.attendance_days;
delete from public.leave_requests;
delete from public.session_events;
delete from public.activity_log;
delete from public.client_contacts;
delete from public.client_admin_assignments;
delete from public.client_brand;
delete from public.client_private;
delete from public.clients;
delete from public.members;
delete from auth.identities;
delete from auth.users;
delete from public.activity_log; -- again: the deletes above were audited

create temporary table fx (key text primary key, id uuid not null);
insert into fx values
  ('owner',       '00000000-0000-4000-8000-000000000001'),
  ('admin',       '00000000-0000-4000-8000-000000000002'),
  ('admin2',      '00000000-0000-4000-8000-000000000003'),
  ('staff',       '00000000-0000-4000-8000-000000000004'),
  ('deactivated', '00000000-0000-4000-8000-000000000005'),
  ('gone_admin',  '00000000-0000-4000-8000-000000000006'),
  ('nobody',      '00000000-0000-4000-8000-000000000009'),
  ('client_a',    '00000000-0000-4000-8000-0000000000a1'),
  ('client_b',    '00000000-0000-4000-8000-0000000000b1'),
  ('client_c',    '00000000-0000-4000-8000-0000000000c1'),
  ('contact_1',   '00000000-0000-4000-8000-0000000000d1'),
  ('contact_2',   '00000000-0000-4000-8000-0000000000d2'),
  ('contact_3',   '00000000-0000-4000-8000-0000000000d3');
insert into fx select 'org', id from public.organizations limit 1;
grant select on fx to authenticated, anon, service_role;

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

create function pg_temp.update_count(sql text) returns bigint language plpgsql as $$
declare n bigint;
begin
  execute sql;
  get diagnostics n = row_count;
  return n;
end;
$$;

insert into auth.users (id, email)
select id, key || '@example.com' from fx where key not in ('org', 'nobody') and key not like 'client_%' and key not like 'contact_%';

insert into public.members (id, org_id, full_name, email, phone, role, status, joined_at, deactivated_at) values
  (pg_temp.fx('owner'),       pg_temp.fx('org'), 'Test Owner',  'owner@example.com',       '9000000001', 'owner', 'active',      now(), null),
  (pg_temp.fx('admin'),       pg_temp.fx('org'), 'Test Admin',  'admin@example.com',       '9000000002', 'admin', 'active',      now(), null),
  (pg_temp.fx('admin2'),      pg_temp.fx('org'), 'Other Admin', 'admin2@example.com',      null,         'admin', 'active',      now(), null),
  (pg_temp.fx('staff'),       pg_temp.fx('org'), 'Test Staff',  'staff@example.com',       null,         'staff', 'active',      now(), null),
  (pg_temp.fx('deactivated'), pg_temp.fx('org'), 'Gone Staff',  'deactivated@example.com', null,         'staff', 'deactivated', now(), now()),
  (pg_temp.fx('gone_admin'),  pg_temp.fx('org'), 'Gone Admin',  'gone_admin@example.com',  null,         'admin', 'deactivated', now(), now());
delete from public.activity_log; -- the fixture writes are not under test

-- Structure and grants ----------------------------------------------------------------------
select has_type('public', 'client_state', 'client_state exists');
select has_table('public', 'clients', 'clients exists');
select has_table('public', 'client_private', 'client_private exists');
select has_table('public', 'client_admin_assignments', 'client_admin_assignments exists');
select has_table('public', 'client_contacts', 'client_contacts exists');
select has_table('public', 'client_brand', 'client_brand exists');
select has_view('public', 'client_labels', 'client_labels exists');
select has_function('app', 'admin_client_ids', array[]::text[], 'app.admin_client_ids() exists');
select has_function('app', 'client_visible', array['uuid'], 'app.client_visible(uuid) exists');
select has_function('app', 'labelled_client_ids', array[]::text[], 'app.labelled_client_ids() exists');
select has_function('app', 'is_owner', array[]::text[], 'app.is_owner() exists');
select has_function('public', 'client_activate', array['uuid'], 'client_activate exists');
select has_function('public', 'client_pause', array['uuid'], 'client_pause exists');
select has_function('public', 'client_close', array['uuid', 'text'], 'client_close exists');
select has_function('public', 'client_reactivate', array['uuid'], 'client_reactivate exists');
select has_function('public', 'client_assign_admin', array['uuid', 'uuid'], 'client_assign_admin exists');
select has_function('public', 'client_contact_set_primary', array['uuid'], 'client_contact_set_primary exists');
select has_function('public', 'client_contact_archive', array['uuid', 'uuid'], 'client_contact_archive exists');
select has_function('public', 'client_contact_restore', array['uuid'], 'client_contact_restore exists');

select ok(
  not has_table_privilege('anon', 'public.clients', 'select, insert, update, delete')
  and not has_table_privilege('anon', 'public.client_private', 'select, insert, update, delete')
  and not has_table_privilege('anon', 'public.client_admin_assignments', 'select, insert, update, delete')
  and not has_table_privilege('anon', 'public.client_contacts', 'select, insert, update, delete')
  and not has_table_privilege('anon', 'public.client_brand', 'select, insert, update, delete')
  and not has_table_privilege('anon', 'public.client_labels', 'select'),
  'anon has no privilege on the client relations');
select ok(
  not has_table_privilege('authenticated', 'public.clients', 'delete, truncate, references, trigger')
  and not has_table_privilege('authenticated', 'public.client_private', 'delete, truncate, references, trigger')
  and not has_table_privilege('authenticated', 'public.client_admin_assignments', 'delete, truncate, references, trigger')
  and not has_table_privilege('authenticated', 'public.client_contacts', 'delete, truncate, references, trigger')
  and not has_table_privilege('authenticated', 'public.client_brand', 'delete, truncate, references, trigger'),
  'authenticated never deletes, truncates, references or adds triggers on the client tables');
select ok(
  not has_table_privilege('authenticated', 'public.client_private', 'insert')
  and not has_table_privilege('authenticated', 'public.client_brand', 'insert')
  and not has_table_privilege('authenticated', 'public.client_admin_assignments', 'insert, update'),
  'the trigger-created rows and the assignment history have no API write');
select ok(
  has_column_privilege('authenticated', 'public.clients', 'name', 'update')
  and has_column_privilege('authenticated', 'public.clients', 'custom_fields', 'update')
  and not has_column_privilege('authenticated', 'public.clients', 'state', 'update')
  and not has_column_privilege('authenticated', 'public.clients', 'admin_id', 'update')
  and not has_column_privilege('authenticated', 'public.clients', 'activated_at', 'update')
  and not has_column_privilege('authenticated', 'public.clients', 'archived_at', 'update')
  and not has_column_privilege('authenticated', 'public.clients', 'org_id', 'update'),
  'clients: the editable columns are granted, the protected and key columns are not');
select ok(
  has_column_privilege('authenticated', 'public.client_contacts', 'name', 'update')
  and not has_column_privilege('authenticated', 'public.client_contacts', 'is_primary', 'update')
  and not has_column_privilege('authenticated', 'public.client_contacts', 'archived_at', 'update')
  and not has_column_privilege('authenticated', 'public.client_contacts', 'client_id', 'update'),
  'client_contacts: is_primary, archived_at and client_id move only through functions');
select ok(
  not has_function_privilege('anon', 'public.client_activate(uuid)', 'execute')
  and not has_function_privilege('anon', 'public.client_assign_admin(uuid, uuid)', 'execute')
  and not has_function_privilege('anon', 'public.client_contact_archive(uuid, uuid)', 'execute')
  and has_function_privilege('authenticated', 'public.client_activate(uuid)', 'execute')
  and has_function_privilege('service_role', 'public.client_close(uuid, text)', 'execute'),
  'anon may call none of the client functions; authenticated and service_role may (the functions decide)');

-- Create path (Owner, clients.manage) --------------------------------------------------------
select pg_temp.as_member('owner');
select lives_ok(
  $$ insert into public.clients (id, name, admin_id) values (pg_temp.fx('client_a'), 'Sharma Weddings', pg_temp.fx('admin')) $$,
  'the Owner creates a client with its Admin');
select lives_ok(
  $$ insert into public.clients (id, name, state, activated_at) values (pg_temp.fx('client_b'), 'Blue Bakery', 'active', now()) $$,
  'the Owner creates a client without an Admin (the given state is ignored)');
select is((select state from public.clients where id = pg_temp.fx('client_b')), 'draft'::public.client_state,
  'a client is born a draft whatever the API sent');
select is((select created_by from public.clients where id = pg_temp.fx('client_a')), pg_temp.fx('owner'),
  'created_by is the caller');
select is((select count(*) from public.client_private where client_id in (pg_temp.fx('client_a'), pg_temp.fx('client_b'))), 2::bigint,
  'the Owner-only notes row is created with the client');
select is((select count(*) from public.client_brand where client_id in (pg_temp.fx('client_a'), pg_temp.fx('client_b'))), 2::bigint,
  'the brand row is created with the client');
select results_eq(
  $$ select admin_id, assigned_by, to_at is null from public.client_admin_assignments where client_id = pg_temp.fx('client_a') $$,
  $$ values (pg_temp.fx('admin'), pg_temp.fx('owner'), true) $$,
  'an Admin given at creation opens the first assignment row');
select is((select count(*) from public.client_admin_assignments where client_id = pg_temp.fx('client_b')), 0::bigint,
  'no Admin, no assignment row');
select throws_ok(
  $$ insert into public.clients (name, admin_id) values ('Staff Run', pg_temp.fx('staff')) $$,
  'P0001', 'VALIDATION', 'the Admin must hold the Admin role');
select throws_ok(
  $$ insert into public.clients (name, admin_id) values ('Gone Run', pg_temp.fx('gone_admin')) $$,
  'P0001', 'VALIDATION', 'the Admin must be active');
select throws_ok(
  $$ insert into public.clients (name) values ('  sharma weddings ') $$,
  '23505', null, 'the name is unique, case-insensitively, among clients not Inactive (kickoff 3)');
select throws_ok(
  $$ insert into public.clients (name, gstin) values ('Bad GST', '12345') $$,
  '23514', null, 'a GSTIN must match the 15-character format');
select lives_ok(
  $$ update public.clients set gstin = '27AAPFU0939F1ZV' where id = pg_temp.fx('client_a') $$,
  'a well-formed GSTIN is accepted');
select throws_ok(
  $$ update public.clients set website = 'http://example.com' where id = pg_temp.fx('client_a') $$,
  '23514', null, 'the website must be https');
select throws_ok(
  $$ update public.clients set drive_url = 'ftp://drive' where id = pg_temp.fx('client_a') $$,
  '23514', null, 'the Drive link must be https');
select lives_ok(
  $$ update public.clients set website = 'https://sharma.example', drive_url = 'https://drive.google.com/x' where id = pg_temp.fx('client_a') $$,
  'https links are accepted');
select throws_ok(
  $$ update public.clients set state = 'active' where id = pg_temp.fx('client_a') $$,
  '42501', null, 'even the Owner cannot set the state directly (column not granted)');

select pg_temp.as_member('admin');
select throws_ok(
  $$ insert into public.clients (name) values ('Admin Made') $$,
  '42501', null, 'an Admin cannot create a client');
select pg_temp.as_member('staff');
select throws_ok(
  $$ insert into public.clients (name) values ('Staff Made') $$,
  '42501', null, 'Staff cannot create a client');

-- Reads per role ---------------------------------------------------------------------------
select pg_temp.as_member('owner');
select is((select count(*) from public.clients), 2::bigint, 'the Owner reads every client');
select is((select count(*) from public.client_private), 2::bigint, 'the Owner reads every private row');
select is((select count(*) from public.client_labels), 2::bigint, 'the Owner reads every label');
select is((select count(*) from app.admin_client_ids()), 0::bigint, 'admin_client_ids() is empty for the Owner (clients.manage instead)');
select pg_temp.as_member('admin');
select results_eq(
  $$ select id from public.clients $$, $$ select pg_temp.fx('client_a') $$,
  'an Admin reads their assigned client only');
select results_eq(
  $$ select * from app.admin_client_ids() $$, $$ select pg_temp.fx('client_a') $$,
  'admin_client_ids() names the assigned client');
select is((select count(*) from public.client_private), 0::bigint, 'an Admin never reads client_private');
select is((select count(*) from public.client_brand), 1::bigint, 'an Admin reads the brand of their client');
select is((select count(*) from public.client_labels), 1::bigint, 'an Admin reads the label of their client');
select is((select count(*) from public.client_admin_assignments), 1::bigint, 'an Admin reads their own assignment rows');
select pg_temp.as_member('admin2');
select is((select count(*) from public.clients), 0::bigint, 'another Admin reads nothing');
select is((select count(*) from public.client_labels), 0::bigint, 'another Admin reads no label');
select is((select count(*) from public.client_admin_assignments), 0::bigint, 'another Admin reads no assignment');
select pg_temp.as_member('staff');
select is((select count(*) from public.clients), 0::bigint, 'Staff never read a client record');
select is((select count(*) from public.client_brand), 0::bigint, 'Staff never read client_brand');
select is((select count(*) from public.client_contacts), 0::bigint, 'Staff never read client_contacts');
select is((select count(*) from public.client_labels), 0::bigint, 'Staff read no label until a task carries one (4.1)');
select pg_temp.as_member('deactivated');
select is((select count(*) from public.clients), 0::bigint, 'a deactivated member reads nothing');
select pg_temp.as_system();
set local role anon;
select throws_ok($$ select count(*) from public.clients $$, '42501', null, 'anon cannot read clients');
select throws_ok($$ select count(*) from public.client_labels $$, '42501', null, 'anon cannot read client_labels');
select pg_temp.as_system();

-- Plain edits per role ---------------------------------------------------------------------
select pg_temp.as_member('admin');
select lives_ok(
  $$ update public.clients set city = 'Pune', requirements = 'Two reels a week' where id = pg_temp.fx('client_a') $$,
  'the Admin edits their client');
select is((select city from public.clients where id = pg_temp.fx('client_a')), 'Pune', 'the edit landed');
select throws_ok(
  $$ update public.clients set state = 'active' where id = pg_temp.fx('client_a') $$,
  '42501', null, 'an Admin cannot touch the state column');
select throws_ok(
  $$ update public.clients set admin_id = pg_temp.fx('admin2') where id = pg_temp.fx('client_a') $$,
  '42501', null, 'an Admin cannot move admin_id');
select lives_ok(
  $$ update public.client_brand set colors = '[{"name":"Rose","hex":"#e11d48"}]'::jsonb, tone_of_voice = 'Warm' where client_id = pg_temp.fx('client_a') $$,
  'the Admin edits the brand of their client');
select throws_ok(
  $$ update public.client_brand set colors = '{}'::jsonb where client_id = pg_temp.fx('client_a') $$,
  '23514', null, 'colors must be an array');
select is(
  pg_temp.update_count($$ update public.client_private set owner_notes = 'peek' where client_id = pg_temp.fx('client_a') $$),
  0::bigint, 'an Admin''s update of client_private matches no row');
select pg_temp.as_member('admin2');
select is(
  pg_temp.update_count($$ update public.clients set city = 'Nope' where id = pg_temp.fx('client_a') $$),
  0::bigint, 'another Admin''s update matches no row');
select is(
  pg_temp.update_count($$ update public.client_brand set tone_of_voice = 'Nope' where client_id = pg_temp.fx('client_a') $$),
  0::bigint, 'another Admin''s brand update matches no row');
select pg_temp.as_member('staff');
select is(
  pg_temp.update_count($$ update public.clients set city = 'Nope' where id = pg_temp.fx('client_a') $$),
  0::bigint, 'a Staff update matches no row');
select pg_temp.as_member('owner');
select lives_ok(
  $$ update public.client_private set owner_notes = 'Pays late in Q4' where client_id = pg_temp.fx('client_a') $$,
  'the Owner writes the private notes');
select lives_ok(
  $$ update public.clients set legal_name = 'Sharma Weddings LLP' where id = pg_temp.fx('client_b') $$,
  'the Owner edits any client');

-- Activity (PERMISSIONS §2) ----------------------------------------------------------------
select pg_temp.as_member('admin');
select ok(
  exists (select 1 from public.activity_log where entity = 'clients' and entity_id = pg_temp.fx('client_a')),
  'an Admin reads the activity about their client');
select ok(
  exists (select 1 from public.activity_log where entity = 'client_brand' and entity_id = pg_temp.fx('client_a')),
  'an Admin reads the brand activity of their client');
select is((select count(*) from public.activity_log where entity = 'client_private'), 0::bigint,
  'an Admin never reads an entry about the Owner''s notes');
select is((select count(*) from public.activity_log where entity = 'clients' and entity_id = pg_temp.fx('client_b')), 0::bigint,
  'an Admin reads nothing about a client that is not theirs');
select pg_temp.as_member('staff');
select is((select count(*) from public.activity_log where entity like 'client%'), 0::bigint,
  'Staff read no client activity');
select pg_temp.as_member('owner');
select ok(
  exists (select 1 from public.activity_log where entity = 'client_private' and entity_id = pg_temp.fx('client_a') and action = 'update'),
  'the Owner reads the private-notes entry (audited by trigger)');

-- Lifecycle: activate / pause / close / reactivate ----------------------------------------
select pg_temp.as_member('admin');
select throws_ok($$ select public.client_activate(pg_temp.fx('client_a')) $$, 'P0001', 'FORBIDDEN',
  'an Admin cannot activate');
select throws_ok($$ select public.client_assign_admin(pg_temp.fx('client_a'), pg_temp.fx('admin2')) $$, 'P0001', 'FORBIDDEN',
  'an Admin cannot reassign a client');
select pg_temp.as_member('staff');
select throws_ok($$ select public.client_pause(pg_temp.fx('client_a')) $$, 'P0001', 'FORBIDDEN',
  'Staff cannot pause');
select pg_temp.as_member('nobody');
select throws_ok($$ select public.client_activate(pg_temp.fx('client_a')) $$, 'P0001', 'UNAUTHENTICATED',
  'a sign-in without a member row is UNAUTHENTICATED');

select pg_temp.as_member('owner');
select throws_ok($$ select public.client_activate('00000000-0000-4000-8000-0000000000ff') $$, 'P0001', 'NOT_FOUND',
  'activating an unknown client is NOT_FOUND');
select throws_ok($$ select public.client_activate(pg_temp.fx('client_b')) $$, 'P0001', 'VALIDATION',
  'a draft without an Admin cannot be activated');
select throws_ok($$ select public.client_pause(pg_temp.fx('client_a')) $$, 'P0001', 'INVALID_STATE',
  'a draft cannot be paused');
select throws_ok($$ select public.client_close(pg_temp.fx('client_a')) $$, 'P0001', 'INVALID_STATE',
  'a draft cannot be closed');
select throws_ok($$ select public.client_reactivate(pg_temp.fx('client_a')) $$, 'P0001', 'INVALID_STATE',
  'a draft cannot be reactivated');
select is(public.client_activate(pg_temp.fx('client_a')), 'active'::public.client_state, 'draft → active');
select ok((select activated_at is not null from public.clients where id = pg_temp.fx('client_a')),
  'activated_at is set');
select is((select action from public.activity_log where entity = 'clients' and entity_id = pg_temp.fx('client_a') order by id desc limit 1),
  'activated', 'the activation is audited under its own action');
select throws_ok($$ select public.client_activate(pg_temp.fx('client_a')) $$, 'P0001', 'INVALID_STATE',
  'an active client cannot be activated again');
select is(public.client_pause(pg_temp.fx('client_a')), 'paused'::public.client_state, 'active → paused');
select throws_ok($$ select public.client_pause(pg_temp.fx('client_a')) $$, 'P0001', 'INVALID_STATE',
  'a paused client cannot be paused again');
select pg_temp.as_member('admin');
select lives_ok(
  $$ update public.clients set notes = 'Still editable while paused' where id = pg_temp.fx('client_a') $$,
  'a paused client stays editable (kickoff 3)');
select pg_temp.as_member('owner');
select is(public.client_activate(pg_temp.fx('client_a')), 'active'::public.client_state, 'paused → active (resume)');
select is(public.client_pause(pg_temp.fx('client_a')), 'paused'::public.client_state, 'active → paused again');
select is(public.client_close(pg_temp.fx('client_a'), 'Moved to another agency'), 'inactive'::public.client_state,
  'paused → inactive');
select is(
  (select meta ->> 'reason' from public.activity_log where entity = 'clients' and entity_id = pg_temp.fx('client_a') and action = 'closed'),
  'Moved to another agency', 'the close reason is kept in the activity log');
select throws_ok($$ select public.client_close(pg_temp.fx('client_a')) $$, 'P0001', 'INVALID_STATE',
  'an inactive client cannot be closed again');
select throws_ok($$ select public.client_pause(pg_temp.fx('client_a')) $$, 'P0001', 'INVALID_STATE',
  'an inactive client cannot be paused');
select pg_temp.as_member('admin');
select lives_ok(
  $$ update public.clients set notes = 'Still editable while inactive' where id = pg_temp.fx('client_a') $$,
  'an inactive client stays editable (kickoff 3)');
select pg_temp.as_member('owner');
-- The name is free again once the client is inactive.
select lives_ok(
  $$ insert into public.clients (id, name, admin_id) values (pg_temp.fx('client_c'), 'SHARMA WEDDINGS', pg_temp.fx('admin2')) $$,
  'an inactive client''s name can be reused');
select throws_ok($$ select public.client_reactivate(pg_temp.fx('client_a')) $$, 'P0001', 'CONFLICT',
  'reactivating refuses a name another not-inactive client now uses');
select lives_ok($$ update public.clients set name = 'Sharma Weddings 2' where id = pg_temp.fx('client_c') $$,
  'the newer client is renamed');
select is(public.client_reactivate(pg_temp.fx('client_a')), 'active'::public.client_state, 'inactive → active');
select throws_ok($$ select public.client_reactivate(pg_temp.fx('client_a')) $$, 'P0001', 'INVALID_STATE',
  'an active client cannot be reactivated');
select is(public.client_close(pg_temp.fx('client_a')), 'inactive'::public.client_state, 'active → inactive (close from active)');
select is(public.client_reactivate(pg_temp.fx('client_a')), 'active'::public.client_state, 'and back to active for the rest');

-- Assigning the Admin ----------------------------------------------------------------------
select throws_ok($$ select public.client_assign_admin(pg_temp.fx('client_a'), pg_temp.fx('admin')) $$, 'P0001', 'INVALID_STATE',
  'the current Admin cannot be assigned again');
select throws_ok($$ select public.client_assign_admin(pg_temp.fx('client_a'), pg_temp.fx('staff')) $$, 'P0001', 'VALIDATION',
  'a Staff member cannot be the Admin');
select throws_ok($$ select public.client_assign_admin(pg_temp.fx('client_a'), pg_temp.fx('gone_admin')) $$, 'P0001', 'VALIDATION',
  'a deactivated Admin cannot be assigned');
select throws_ok($$ select public.client_assign_admin(pg_temp.fx('client_a'), '00000000-0000-4000-8000-0000000000ff') $$, 'P0001', 'NOT_FOUND',
  'an unknown person is NOT_FOUND');
select lives_ok($$ select public.client_assign_admin(pg_temp.fx('client_a'), pg_temp.fx('admin2')) $$,
  'the Owner moves the client to another Admin');
select is((select admin_id from public.clients where id = pg_temp.fx('client_a')), pg_temp.fx('admin2'),
  'clients.admin_id moved');
select results_eq(
  $$ select admin_id, to_at is null from public.client_admin_assignments where client_id = pg_temp.fx('client_a') order by to_at nulls last $$,
  $$ values (pg_temp.fx('admin'), false), (pg_temp.fx('admin2'), true) $$,
  'the history closed the first row and opened the next');
select is(
  (select meta from public.activity_log where entity = 'clients' and entity_id = pg_temp.fx('client_a') and action = 'admin_assigned'),
  jsonb_build_object('from_admin_id', pg_temp.fx('admin'), 'to_admin_id', pg_temp.fx('admin2')),
  'the reassignment is audited with both Admins');
select lives_ok($$ select public.client_assign_admin(pg_temp.fx('client_b'), pg_temp.fx('admin')) $$,
  'a draft gets its first Admin through the function');
select is((select count(*) from public.client_admin_assignments where client_id = pg_temp.fx('client_b') and to_at is null), 1::bigint,
  'the draft now has one open assignment');
select pg_temp.as_member('admin');
select results_eq(
  $$ select id from public.clients order by name $$, $$ select pg_temp.fx('client_b') $$,
  'the previous Admin lost the client at once and sees only the newly assigned draft');
select pg_temp.as_member('admin2');
select results_eq(
  $$ select id from public.clients order by name $$, $$ values (pg_temp.fx('client_a')), (pg_temp.fx('client_c')) $$,
  'the new Admin sees the client at once');
select pg_temp.as_member('owner');
select lives_ok($$ select public.client_assign_admin(pg_temp.fx('client_a'), pg_temp.fx('admin')) $$,
  'moved back for the contact tests');

-- Contacts ------------------------------------------------------------------------------------
select pg_temp.as_member('admin');
select lives_ok(
  $$ insert into public.client_contacts (id, client_id, name, email) values (pg_temp.fx('contact_1'), pg_temp.fx('client_a'), 'Priya', 'priya@example.com') $$,
  'the Admin adds the first contact');
select is((select is_primary from public.client_contacts where id = pg_temp.fx('contact_1')), true,
  'the first live contact is the primary one');
select lives_ok(
  $$ insert into public.client_contacts (id, client_id, name, phone) values (pg_temp.fx('contact_2'), pg_temp.fx('client_a'), 'Rahul', '9876543210') $$,
  'a second contact is added');
select is((select is_primary from public.client_contacts where id = pg_temp.fx('contact_2')), false,
  'a later contact is not primary');
select throws_ok(
  $$ insert into public.client_contacts (id, client_id, name, is_primary) values (pg_temp.fx('contact_3'), pg_temp.fx('client_a'), 'Two', true) $$,
  'P0001', 'VALIDATION', 'a second primary at insert is refused');
select lives_ok(
  $$ insert into public.client_contacts (id, client_id, name, email) values (pg_temp.fx('contact_3'), pg_temp.fx('client_a'), 'Priya', 'priya@example.com') $$,
  'no uniqueness on a contact''s name, email or phone (kickoff 3)');
select throws_ok(
  $$ insert into public.client_contacts (client_id, name) values (pg_temp.fx('client_c'), 'Not Mine') $$,
  '42501', null, 'an Admin cannot add a contact to a client that is not theirs');
select throws_ok(
  $$ update public.client_contacts set is_primary = true where id = pg_temp.fx('contact_2') $$,
  '42501', null, 'is_primary is not editable directly');
select lives_ok(
  $$ update public.client_contacts set designation = 'Founder' where id = pg_temp.fx('contact_1') $$,
  'a contact''s details are a plain edit');
select lives_ok($$ select public.client_contact_set_primary(pg_temp.fx('contact_2')) $$, 'set primary swaps');
select results_eq(
  $$ select id from public.client_contacts where client_id = pg_temp.fx('client_a') and is_primary and archived_at is null $$,
  $$ select pg_temp.fx('contact_2') $$, 'exactly one primary after the swap, the chosen one');
select throws_ok($$ select public.client_contact_set_primary(pg_temp.fx('contact_2')) $$, 'P0001', 'INVALID_STATE',
  'the primary cannot be set primary again');
select throws_ok($$ select public.client_contact_archive(pg_temp.fx('contact_2')) $$, 'P0001', 'VALIDATION',
  'archiving the primary while others exist asks for the next');
select throws_ok($$ select public.client_contact_archive(pg_temp.fx('contact_2'), pg_temp.fx('contact_2')) $$, 'P0001', 'VALIDATION',
  'the next primary must be another contact');
select lives_ok($$ select public.client_contact_archive(pg_temp.fx('contact_2'), pg_temp.fx('contact_1')) $$,
  'archiving the primary with a next one');
select results_eq(
  $$ select id, is_primary, archived_at is null from public.client_contacts where id in (pg_temp.fx('contact_1'), pg_temp.fx('contact_2')) order by name $$,
  $$ values (pg_temp.fx('contact_1'), true, true), (pg_temp.fx('contact_2'), false, false) $$,
  'the next contact is primary and the archived one is not');
select throws_ok($$ select public.client_contact_archive(pg_temp.fx('contact_2')) $$, 'P0001', 'INVALID_STATE',
  'an archived contact cannot be archived again');
select throws_ok($$ select public.client_contact_set_primary(pg_temp.fx('contact_2')) $$, 'P0001', 'INVALID_STATE',
  'an archived contact cannot be made primary');
select lives_ok($$ select public.client_contact_restore(pg_temp.fx('contact_2')) $$, 'restore');
select is((select is_primary from public.client_contacts where id = pg_temp.fx('contact_2')), false,
  'a restored contact is not primary while one exists');
select throws_ok($$ select public.client_contact_restore(pg_temp.fx('contact_2')) $$, 'P0001', 'INVALID_STATE',
  'a live contact cannot be restored');
select lives_ok($$ select public.client_contact_archive(pg_temp.fx('contact_3')) $$,
  'archiving a non-primary contact needs no next');
select lives_ok($$ select public.client_contact_archive(pg_temp.fx('contact_2')) $$, 'and another');
select lives_ok($$ select public.client_contact_archive(pg_temp.fx('contact_1')) $$,
  'the last live contact, the primary, archives without a next');
select is((select count(*) from public.client_contacts where client_id = pg_temp.fx('client_a') and archived_at is null), 0::bigint,
  'no live contact is left');
select lives_ok($$ select public.client_contact_restore(pg_temp.fx('contact_3')) $$, 'restore one');
select is((select is_primary from public.client_contacts where id = pg_temp.fx('contact_3')), true,
  'the only live contact becomes primary on restore');
select is(
  (select count(*) from public.activity_log where entity = 'client_contacts' and action in ('primary_set', 'primary_removed', 'archived', 'restored')),
  9::bigint, 'every contact move is audited under its own action');
select pg_temp.as_member('admin2');
select throws_ok($$ select public.client_contact_set_primary(pg_temp.fx('contact_3')) $$, 'P0001', 'NOT_FOUND',
  'another Admin does not learn the contact exists');
select pg_temp.as_member('staff');
select throws_ok($$ select public.client_contact_archive(pg_temp.fx('contact_3')) $$, 'P0001', 'NOT_FOUND',
  'Staff do not learn the contact exists');
select pg_temp.as_member('owner');
select lives_ok($$ select public.client_contact_restore(pg_temp.fx('contact_1')) $$, 'the Owner restores on any client');
select is((select count(*) from public.client_contacts where client_id = pg_temp.fx('client_a')), 3::bigint,
  'the Owner reads every contact');

-- Deactivating the Admin ends their scope; the client keeps the reference for history --------
select pg_temp.as_member('owner');
select lives_ok($$ select public.member_deactivate(pg_temp.fx('admin2')) $$, 'the Owner deactivates an Admin');
select throws_ok($$ select public.client_activate(pg_temp.fx('client_c')) $$, 'P0001', 'VALIDATION',
  'a client whose Admin is deactivated cannot be activated until reassigned');
select pg_temp.as_member('admin2');
select is((select count(*) from public.clients), 0::bigint, 'a deactivated Admin reads nothing');

select * from finish();
rollback;
