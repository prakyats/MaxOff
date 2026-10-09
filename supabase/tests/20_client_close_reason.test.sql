-- Phase 3 review: the client close reason is the Owner's (client_close_reasons), never in the
-- activity entry the client's Admin reads; and the deactivation reason still stays the Owner's.
begin;
create extension if not exists pgtap with schema extensions;
select plan(22);

-- The local seed holds an organization and sign-ins. Keep the organization; replace the people
-- with fixtures. Rolled back at the end. Order follows the foreign keys.
delete from public.attendance_events;
delete from public.attendance_days;
delete from public.expense_claims;
delete from public.comp_leave_credit_uses;
delete from public.comp_leave_credits;
delete from public.extra_work_notes;
delete from public.leave_requests;
delete from public.session_events;
delete from public.activity_log;
-- 7A: client work rows reference clients and members, and the presets the organization (a
-- Playwright run leaves some behind).
delete from public.item_reviews;
delete from public.project_item_stage_list;
delete from public.project_item_stages;
delete from public.project_items;
delete from public.project_cycles;
delete from public.project_item_blueprints;
delete from public.project_stages;
delete from public.projects;
delete from public.project_templates;
delete from public.stage_presets;
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
update public.organizations set logo_file_id = null;
delete from public.files;
delete from public.members;
delete from auth.identities;
delete from auth.users;
delete from public.activity_log; -- again: the deletes above were audited

create temporary table fx (key text primary key, id uuid not null);
insert into fx values
  ('owner',    '00000000-0000-4000-8000-000000000001'),
  ('admin',    '00000000-0000-4000-8000-000000000002'),
  ('admin2',   '00000000-0000-4000-8000-000000000003'),
  ('staff',    '00000000-0000-4000-8000-000000000004'),
  ('staff2',   '00000000-0000-4000-8000-000000000005'),
  ('client_a', '00000000-0000-4000-8000-0000000000a1'),
  ('client_b', '00000000-0000-4000-8000-0000000000b1');
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

insert into auth.users (id, email)
select id, key || '@example.com' from fx where key <> 'org' and key not like 'client_%';

insert into public.members (id, org_id, full_name, email, role, status, joined_at) values
  (pg_temp.fx('owner'),  pg_temp.fx('org'), 'Test Owner',  'owner@example.com',  'owner', 'active', now()),
  (pg_temp.fx('admin'),  pg_temp.fx('org'), 'Test Admin',  'admin@example.com',  'admin', 'active', now()),
  (pg_temp.fx('admin2'), pg_temp.fx('org'), 'Other Admin', 'admin2@example.com', 'admin', 'active', now()),
  (pg_temp.fx('staff'),  pg_temp.fx('org'), 'Test Staff',  'staff@example.com',  'staff', 'active', now()),
  (pg_temp.fx('staff2'), pg_temp.fx('org'), 'Leaving',     'staff2@example.com', 'staff', 'active', now());
insert into public.clients (id, org_id, name, admin_id) values
  (pg_temp.fx('client_a'), pg_temp.fx('org'), 'Sharma Weddings', pg_temp.fx('admin')),
  (pg_temp.fx('client_b'), pg_temp.fx('org'), 'Blue Bakery',     pg_temp.fx('admin'));
delete from public.activity_log; -- the fixture writes are not under test

-- Structure ----------------------------------------------------------------------------------
select has_table('public', 'client_close_reasons', 'client_close_reasons exists');
select ok((select relrowsecurity from pg_class where oid = 'public.client_close_reasons'::regclass),
  'RLS is on');
select ok(
  not has_table_privilege('anon', 'public.client_close_reasons', 'select, insert, update, delete')
  and not has_table_privilege('authenticated', 'public.client_close_reasons', 'insert, update, delete, truncate'),
  'anon has nothing; authenticated never writes (client_close() only)');

-- The Owner closes, with and without a reason ---------------------------------------------------
select pg_temp.as_member('owner');
select lives_ok($$ select public.client_activate(pg_temp.fx('client_a')) $$, 'the Owner activates client A');
select lives_ok($$ select public.client_activate(pg_temp.fx('client_b')) $$, 'the Owner activates client B');
select is(public.client_close(pg_temp.fx('client_a'), '  Late payments, twice  '), 'inactive'::public.client_state,
  'the Owner closes A with a reason');
select is(public.client_close(pg_temp.fx('client_b')), 'inactive'::public.client_state,
  'the Owner closes B without one');
select is((select reason from public.client_close_reasons where client_id = pg_temp.fx('client_a')),
  'Late payments, twice', 'Owner allowed: reads the trimmed reason');
select is((select count(*) from public.client_close_reasons where client_id = pg_temp.fx('client_b')),
  0::bigint, 'no reason given, no row');

select pg_temp.as_system();
select is(
  (select r.activity_id from public.client_close_reasons r where r.client_id = pg_temp.fx('client_a')),
  (select l.id from public.activity_log l
   where l.entity = 'clients' and l.entity_id = pg_temp.fx('client_a') and l.action = 'closed'),
  'the reason is keyed by its closed entry');
select is(
  (select count(*) from public.activity_log where entity = 'clients' and action = 'closed' and meta ? 'reason'),
  0::bigint, 'no closed entry carries the reason in meta');
select is(
  (select meta ->> 'from_state' from public.activity_log
   where entity = 'clients' and entity_id = pg_temp.fx('client_a') and action = 'closed'),
  'active', 'the entry keeps from_state');

-- The client's Admin reads the entry, never the reason ------------------------------------------
select pg_temp.as_member('admin');
select is(
  (select count(*) from public.activity_log
   where entity = 'clients' and entity_id = pg_temp.fx('client_a') and action = 'closed'),
  1::bigint, 'the client''s Admin still reads the closed entry');
select is((select count(*) from public.activity_log where meta ? 'reason'), 0::bigint,
  'Admin denied: no entry they read carries a reason');
select is((select count(*) from public.client_close_reasons), 0::bigint,
  'Admin denied: client_close_reasons returns nothing');

select pg_temp.as_member('admin2');
select is((select count(*) from public.client_close_reasons), 0::bigint,
  'another Admin denied too');

select pg_temp.as_member('staff');
select is((select count(*) from public.client_close_reasons), 0::bigint,
  'Staff denied: client_close_reasons returns nothing');
select is((select count(*) from public.activity_log where entity = 'clients'), 0::bigint,
  'Staff read no client entry at all');

-- The deactivation reason still stays the Owner's (phase 1 review) --------------------------------
select pg_temp.as_member('owner');
select is(public.member_deactivate(pg_temp.fx('staff2'), 'Left without notice'), 'deactivated',
  'the Owner deactivates a member with a reason');
select is(
  (select meta ->> 'reason' from public.activity_log
   where entity = 'members' and entity_id = pg_temp.fx('staff2') and action = 'deactivated'),
  'Left without notice', 'Owner allowed: reads the deactivation reason');

select pg_temp.as_member('admin');
select is(
  (select count(*) from public.activity_log where entity = 'members' and action = 'deactivated'),
  0::bigint, 'Admin denied: never reads a deactivation entry (no phase 3 policy adds members)');

select pg_temp.as_member('staff');
select is(
  (select count(*) from public.activity_log where entity = 'members' and action = 'deactivated'),
  0::bigint, 'Staff denied: never reads a deactivation entry');

select pg_temp.as_system();
select * from finish();
rollback;
