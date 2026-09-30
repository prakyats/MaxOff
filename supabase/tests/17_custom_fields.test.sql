-- 3.2 Custom fields: field_definitions for every role (allowed and denied), the writable rule
-- (PERMISSIONS ¹ ²), the guard (type immutable once a value exists; entity, key and scope fixed;
-- options shape) and the activity policy.
begin;
create extension if not exists pgtap with schema extensions;
select plan(57);

delete from public.attendance_events;
delete from public.attendance_days;
delete from public.expense_claims;
delete from public.comp_leave_credit_uses;
delete from public.comp_leave_credits;
delete from public.extra_work_notes;
delete from public.leave_requests;
delete from public.session_events;
delete from public.activity_log;
-- 4A: task rows and coordinator rows reference members (a Playwright run leaves some behind).
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
delete from public.field_definitions;
delete from public.client_contacts;
delete from public.client_admin_assignments;
delete from public.client_brand;
delete from public.client_private;
delete from public.clients;
-- File rows (3.3) reference members and are referenced by the organization's logo.
update public.organizations set logo_file_id = null;
delete from public.files;
delete from public.members;
delete from auth.identities;
delete from auth.users;
delete from public.activity_log;

create temporary table fx (key text primary key, id uuid not null);
insert into fx values
  ('owner',    '00000000-0000-4000-8000-000000000001'),
  ('admin',    '00000000-0000-4000-8000-000000000002'),
  ('admin2',   '00000000-0000-4000-8000-000000000003'),
  ('staff',    '00000000-0000-4000-8000-000000000004'),
  ('nobody',   '00000000-0000-4000-8000-000000000009'),
  ('client_a', '00000000-0000-4000-8000-0000000000a1'),
  ('client_b', '00000000-0000-4000-8000-0000000000b1'),
  ('global',   '00000000-0000-4000-8000-0000000000f1'),
  ('scoped',   '00000000-0000-4000-8000-0000000000f2'),
  ('contact',  '00000000-0000-4000-8000-0000000000f3'),
  ('project',  '00000000-0000-4000-8000-0000000000f4'),
  ('task',     '00000000-0000-4000-8000-0000000000f5'),
  ('choice',   '00000000-0000-4000-8000-0000000000f6');
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
select id, key || '@example.com' from fx where key in ('owner', 'admin', 'admin2', 'staff');

insert into public.members (id, org_id, full_name, email, phone, role, status, joined_at, deactivated_at) values
  (pg_temp.fx('owner'),  pg_temp.fx('org'), 'Test Owner',  'owner@example.com',  '9000000001', 'owner', 'active', now(), null),
  (pg_temp.fx('admin'),  pg_temp.fx('org'), 'Test Admin',  'admin@example.com',  '9000000002', 'admin', 'active', now(), null),
  (pg_temp.fx('admin2'), pg_temp.fx('org'), 'Other Admin', 'admin2@example.com', null,         'admin', 'active', now(), null),
  (pg_temp.fx('staff'),  pg_temp.fx('org'), 'Test Staff',  'staff@example.com',  null,         'staff', 'active', now(), null);
insert into public.clients (id, org_id, name, admin_id) values
  (pg_temp.fx('client_a'), pg_temp.fx('org'), 'Client A', pg_temp.fx('admin')),
  (pg_temp.fx('client_b'), pg_temp.fx('org'), 'Client B', pg_temp.fx('admin2'));
delete from public.activity_log;

-- Structure and grants ----------------------------------------------------------------------
select has_type('public', 'field_type', 'field_type exists');
select has_table('public', 'field_definitions', 'field_definitions exists');
select has_function('app', 'field_definition_writable', array['text', 'uuid'], 'app.field_definition_writable exists');
select has_function('app', 'field_definitions_guard', array[]::text[], 'app.field_definitions_guard exists');
select ok(not has_table_privilege('anon', 'public.field_definitions', 'select, insert, update, delete'),
  'anon has no privilege on field_definitions');
select ok(not has_table_privilege('authenticated', 'public.field_definitions', 'delete, truncate, references, trigger'),
  'authenticated never deletes a definition (archive instead)');
select ok(
  has_column_privilege('authenticated', 'public.field_definitions', 'label', 'update')
  and has_column_privilege('authenticated', 'public.field_definitions', 'type', 'update')
  and has_column_privilege('authenticated', 'public.field_definitions', 'archived_at', 'update')
  and not has_column_privilege('authenticated', 'public.field_definitions', 'key', 'update')
  and not has_column_privilege('authenticated', 'public.field_definitions', 'entity', 'update')
  and not has_column_privilege('authenticated', 'public.field_definitions', 'client_id', 'update'),
  'the editable columns are granted; entity, key and scope are not');
select ok(
  (select enumlabel from pg_enum where enumtypid = 'public.field_type'::regtype and enumlabel = 'currency') is null,
  'there is no currency type (invariant 2)');

-- Writes per role (PERMISSIONS ¹ ²) -----------------------------------------------------------
select pg_temp.as_member('owner');
select lives_ok(
  $$ insert into public.field_definitions (id, entity, key, label, type, position) values (pg_temp.fx('global'), 'client', 'industry', 'Industry', 'text', 'a0') $$,
  'the Owner adds a global client field');
select lives_ok(
  $$ insert into public.field_definitions (id, entity, key, label, type, position) values (pg_temp.fx('contact'), 'contact', 'birthday', 'Birthday', 'date', 'a0') $$,
  'the Owner adds a global contact field');
select lives_ok(
  $$ insert into public.field_definitions (id, entity, key, label, type, position) values (pg_temp.fx('project'), 'project', 'po_number', 'PO number', 'text', 'a0') $$,
  'the Owner adds a project field');
select lives_ok(
  $$ insert into public.field_definitions (id, entity, key, label, type, position) values (pg_temp.fx('task'), 'task', 'shot_list', 'Shot list', 'long_text', 'a0') $$,
  'the Owner adds a task field');
select lives_ok(
  $$ insert into public.field_definitions (id, entity, client_id, key, label, type, options, position)
     values (pg_temp.fx('choice'), 'client', pg_temp.fx('client_b'), 'tier', 'Tier', 'select', '[{"key":"gold","label":"Gold"},{"key":"silver","label":"Silver"}]', 'a0') $$,
  'the Owner adds a field scoped to any client');
select throws_ok(
  $$ insert into public.field_definitions (entity, key, label, type, position) values ('client', 'industry', 'Industry again', 'text', 'a1') $$,
  '23505', null, 'a key is unique per entity and scope');
select lives_ok(
  $$ insert into public.field_definitions (entity, client_id, key, label, type, position) values ('client', pg_temp.fx('client_a'), 'industry', 'Industry (A)', 'text', 'a0') $$,
  'the same key may exist for one client');
select throws_ok(
  $$ insert into public.field_definitions (entity, key, label, type, position) values ('client', 'Bad Key', 'Bad', 'text', 'a2') $$,
  '23514', null, 'a key is lower-case snake case');
select throws_ok(
  $$ insert into public.field_definitions (entity, key, label, type, position) values ('client', 'nochoice', 'No choice', 'select', 'a2') $$,
  '23514', null, 'a select needs options');
select throws_ok(
  $$ insert into public.field_definitions (entity, key, label, type, options, position) values ('client', 'textopts', 'Text with options', 'text', '[{"key":"a","label":"A"}]', 'a2') $$,
  '23514', null, 'a text field has no options');
select throws_ok(
  $$ insert into public.field_definitions (entity, key, label, type, options, position) values ('client', 'badopts', 'Bad options', 'select', '["gold"]', 'a2') $$,
  'P0001', 'VALIDATION', 'an option is a {key, label} object');
select throws_ok(
  $$ insert into public.field_definitions (entity, key, label, type, options, position) values ('client', 'dupopts', 'Dup options', 'select', '[{"key":"a","label":"A"},{"key":"a","label":"B"}]', 'a2') $$,
  'P0001', 'VALIDATION', 'option keys are distinct');
select throws_ok(
  $$ insert into public.field_definitions (entity, client_id, key, label, type, position) values ('project', pg_temp.fx('client_a'), 'scoped_project', 'Scoped', 'text', 'a0') $$,
  '42501', null, 'a client scope fits client and contact fields only (the writable rule refuses it before the check)');
select throws_ok(
  $$ insert into public.field_definitions (entity, client_id, key, label, type, position) values ('client', '00000000-0000-4000-8000-0000000000ff', 'ghost', 'Ghost', 'text', 'a0') $$,
  'P0001', 'NOT_FOUND', 'a client scope must exist');

select pg_temp.as_member('admin');
select throws_ok(
  $$ insert into public.field_definitions (entity, key, label, type, position) values ('client', 'admin_global', 'Admin global', 'text', 'a3') $$,
  '42501', null, 'an Admin cannot add a global client field (kickoff 3, ²)');
select throws_ok(
  $$ insert into public.field_definitions (entity, key, label, type, position) values ('contact', 'admin_global', 'Admin global', 'text', 'a3') $$,
  '42501', null, 'an Admin cannot add a global contact field');
select throws_ok(
  $$ insert into public.field_definitions (entity, key, label, type, position) values ('project', 'admin_project', 'Admin project', 'number', 'a3') $$,
  '42501', null, 'an Admin cannot add a project field (¹)');
select throws_ok(
  $$ insert into public.field_definitions (entity, key, label, type, position) values ('item', 'admin_item', 'Admin item', 'number', 'a3') $$,
  '42501', null, 'an Admin cannot add an item field (¹)');
select lives_ok(
  $$ insert into public.field_definitions (id, entity, client_id, key, label, type, position) values (pg_temp.fx('scoped'), 'client', pg_temp.fx('client_a'), 'shoot_days', 'Shoot days', 'number', 'a1') $$,
  'an Admin adds a field scoped to their own client');
select lives_ok(
  $$ insert into public.field_definitions (entity, client_id, key, label, type, position) values ('contact', pg_temp.fx('client_a'), 'whatsapp', 'WhatsApp', 'phone', 'a1') $$,
  'an Admin adds a contact field scoped to their own client');
select throws_ok(
  $$ insert into public.field_definitions (entity, client_id, key, label, type, position) values ('client', pg_temp.fx('client_b'), 'not_mine', 'Not mine', 'text', 'a1') $$,
  '42501', null, 'an Admin cannot add a field for a client that is not theirs');
select lives_ok(
  $$ insert into public.field_definitions (entity, key, label, type, position) values ('task', 'admin_task', 'Admin task field', 'checkbox', 'a1') $$,
  'an Admin adds a task field (lists.manage)');
select pg_temp.as_member('staff');
select throws_ok(
  $$ insert into public.field_definitions (entity, key, label, type, position) values ('task', 'staff_task', 'Staff task', 'text', 'a4') $$,
  '42501', null, 'Staff add nothing');

-- Reads per role -------------------------------------------------------------------------------
select pg_temp.as_member('owner');
select is((select count(*) from public.field_definitions), 9::bigint, 'the Owner reads every definition');
select pg_temp.as_member('admin');
select results_eq(
  $$ select key from public.field_definitions order by key $$,
  $$ values ('admin_task'), ('birthday'), ('industry'), ('industry'), ('po_number'), ('shoot_days'), ('shot_list'), ('whatsapp') $$,
  'an Admin reads the global rows and their own clients'' rows, never another client''s');
select pg_temp.as_member('admin2');
select ok(not exists (select 1 from public.field_definitions where key = 'shoot_days'),
  'another Admin does not see a client-scoped field of a client that is not theirs');
select ok(exists (select 1 from public.field_definitions where key = 'tier'),
  'but sees the Owner-made field scoped to their own client');
select pg_temp.as_member('staff');
select results_eq(
  $$ select key from public.field_definitions order by key $$,
  $$ values ('admin_task'), ('shot_list') $$,
  'Staff read task definitions only (their forms, 4.1)');
select pg_temp.as_system();
set local role anon;
select throws_ok($$ select count(*) from public.field_definitions $$, '42501', null, 'anon cannot read definitions');
select pg_temp.as_system();

-- Edits and the guard ---------------------------------------------------------------------------
select pg_temp.as_member('admin');
select lives_ok(
  $$ update public.field_definitions set label = 'Shoot days (planned)', required = true, help_text = 'Per month' where id = pg_temp.fx('scoped') $$,
  'an Admin edits their own client-scoped field');
select is(pg_temp.update_count($$ update public.field_definitions set label = 'Peek' where id = pg_temp.fx('global') $$), 0::bigint,
  'an Admin''s edit of a global field matches no row');
select is(pg_temp.update_count($$ update public.field_definitions set label = 'Peek' where id = pg_temp.fx('choice') $$), 0::bigint,
  'an Admin''s edit of another client''s field matches no row');
select throws_ok(
  $$ update public.field_definitions set key = 'renamed' where id = pg_temp.fx('scoped') $$,
  '42501', null, 'the key is not editable');
select pg_temp.as_member('owner');
select lives_ok(
  $$ update public.field_definitions set type = 'long_text' where id = pg_temp.fx('global') $$,
  'the type changes while no record holds a value');
-- A value appears (a plain client edit under RLS), and the type is locked.
select lives_ok(
  $$ update public.clients set custom_fields = '{"industry": "Weddings"}'::jsonb where id = pg_temp.fx('client_a') $$,
  'a client stores a value for the field');
select throws_ok(
  $$ update public.field_definitions set type = 'text' where id = pg_temp.fx('global') $$,
  'P0001', 'INVALID_STATE', 'the type is immutable once a value exists (kickoff 3)');
select lives_ok(
  $$ update public.field_definitions set label = 'Industry / sector', section = 'Business', options = '[]'::jsonb where id = pg_temp.fx('global') $$,
  'label, section and help stay editable');
-- The scoped definition with the same key: client_b holds no value under it, so its type moves.
select lives_ok(
  $$ update public.field_definitions set type = 'text' where id = pg_temp.fx('scoped') $$,
  'a scoped field''s type looks only at records in its scope');
select lives_ok(
  $$ update public.clients set custom_fields = custom_fields || '{"shoot_days": "4"}'::jsonb where id = pg_temp.fx('client_a') $$,
  'the scoped client stores a value');
select throws_ok(
  $$ update public.field_definitions set type = 'number' where id = pg_temp.fx('scoped') $$,
  'P0001', 'INVALID_STATE', 'and now the scoped field is locked too');
select lives_ok(
  $$ update public.field_definitions set options = '[{"key":"gold","label":"Gold"},{"key":"silver","label":"Silver"},{"key":"bronze","label":"Bronze"}]'::jsonb where id = pg_temp.fx('choice') $$,
  'select options stay editable (a renamed option rewrites nothing)');
select throws_ok(
  $$ update public.field_definitions set options = '[]'::jsonb where id = pg_temp.fx('choice') $$,
  '23514', null, 'a select keeps at least one option');
select lives_ok(
  $$ update public.field_definitions set archived_at = now() where id = pg_temp.fx('global') $$,
  'the Owner archives a field');
select is((select custom_fields ->> 'industry' from public.clients where id = pg_temp.fx('client_a')), 'Weddings',
  'archiving keeps the values (kickoff 3)');
select lives_ok(
  $$ update public.field_definitions set archived_at = null where id = pg_temp.fx('global') $$,
  'and restores it');
select throws_ok(
  $$ delete from public.field_definitions where id = pg_temp.fx('global') $$,
  '42501', null, 'nothing is deleted');

-- Activity --------------------------------------------------------------------------------------
select pg_temp.as_member('admin');
select ok(
  exists (select 1 from public.activity_log where entity = 'field_definitions' and entity_id = pg_temp.fx('scoped') and action = 'update'),
  'an Admin reads the activity of a definition they may see');
select is((select count(*) from public.activity_log where entity = 'field_definitions' and entity_id = pg_temp.fx('choice')), 0::bigint,
  'and not of one they may not');
select pg_temp.as_member('owner');
select ok(
  exists (select 1 from public.activity_log where entity = 'field_definitions' and entity_id = pg_temp.fx('global') and action = 'update'),
  'the Owner reads every definition''s activity');

select * from finish();
rollback;
