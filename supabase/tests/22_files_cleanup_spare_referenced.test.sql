-- Phase 3 review: the cleanup never deletes the object of a file a record still uses. An archived
-- file cannot be attached again, one upload is attached in one place only, and the archived branch
-- of file_cleanup_candidates spares a referenced file and a preview whose original is referenced.
begin;
create extension if not exists pgtap with schema extensions;
select plan(10);

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
  ('owner',     '00000000-0000-4000-8000-000000000001'),
  ('admin',     '00000000-0000-4000-8000-000000000002'),
  ('client_a',  '00000000-0000-4000-8000-0000000000a1'),
  ('arch',      '00000000-0000-4000-8000-0000000000f1'),
  ('shared',    '00000000-0000-4000-8000-0000000000f2'),
  ('kept',      '00000000-0000-4000-8000-0000000000f3'),
  ('kept_prev', '00000000-0000-4000-8000-0000000000f4'),
  ('gone',      '00000000-0000-4000-8000-0000000000f5'),
  ('gone_prev', '00000000-0000-4000-8000-0000000000f6');
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
select id, key || '@example.com' from fx where key in ('owner', 'admin');
insert into public.members (id, org_id, full_name, email, role, status, joined_at) values
  (pg_temp.fx('owner'), pg_temp.fx('org'), 'Test Owner', 'owner@example.com', 'owner', 'active', now()),
  (pg_temp.fx('admin'), pg_temp.fx('org'), 'Test Admin', 'admin@example.com', 'admin', 'active', now());
insert into public.clients (id, org_id, name, admin_id) values
  (pg_temp.fx('client_a'), pg_temp.fx('org'), 'Client A', pg_temp.fx('admin'));

-- The files, written as the system (a fixture: the upload protocol itself is 18's), all the
-- Owner's, recent unless archived long ago.
create function pg_temp.file(k text, archived interval default null, original text default null)
returns void language sql as $$
  insert into public.files (id, org_id, storage_key, name, mime, size_bytes, uploaded_by, status,
                            preview_of, archived_at)
  values (pg_temp.fx(k), pg_temp.fx('org'), 'org/2026/09/' || k || '/f.png', k || '.png', 'image/png', 10,
          pg_temp.fx('owner'), 'ready', case when original is null then null else pg_temp.fx(original) end,
          case when archived is null then null else now() - archived end);
$$;
select pg_temp.file('arch', '1 minute');
select pg_temp.file('shared');
select pg_temp.file('kept', '40 days');
select pg_temp.file('kept_prev', '40 days', 'kept');
select pg_temp.file('gone', '40 days');
select pg_temp.file('gone_prev', '40 days', 'gone');
-- Referenced while archived: how data could get here before this migration.
update public.organizations set logo_file_id = pg_temp.fx('kept') where id = pg_temp.fx('org');
update public.client_brand set logo_file_id = pg_temp.fx('shared') where client_id = pg_temp.fx('client_a');
delete from public.activity_log;

-- The count --------------------------------------------------------------------------------------
select has_function('app', 'file_reference_count', array['uuid'], 'app.file_reference_count exists');
select is(app.file_reference_count(pg_temp.fx('shared')), 1, 'a client logo counts as one use');
select is(app.file_reference_count(pg_temp.fx('gone')), 0, 'an unattached file has none');

-- The guard ----------------------------------------------------------------------------------------
select pg_temp.as_member('owner');
select throws_ok(
  $$ update public.client_brand set logo_file_id = pg_temp.fx('arch') where client_id = pg_temp.fx('client_a') $$,
  'P0001', 'INVALID_STATE', 'an archived (replaced) file cannot be attached again');
select throws_ok(
  $$ update public.organizations set logo_file_id = pg_temp.fx('shared') where id = pg_temp.fx('org') $$,
  'P0001', 'CONFLICT', 'a file attached to a client logo cannot also be the company logo');
select is((select logo_file_id from public.organizations where id = pg_temp.fx('org')), pg_temp.fx('kept'),
  'and the company logo is unchanged');

-- The cleanup --------------------------------------------------------------------------------------
select pg_temp.as_system();
set local role service_role;
select results_eq(
  $$ select id from public.file_cleanup_candidates(now() - interval '30 days', now() - interval '1 day', now() - interval '7 days') order by id $$,
  $$ values (pg_temp.fx('gone')), (pg_temp.fx('gone_prev')) $$,
  'archived 30 days ago: only the unreferenced file and its preview are candidates');
select ok(
  not exists (select 1 from public.file_cleanup_candidates(now(), now(), now()) where id = pg_temp.fx('kept')),
  'an archived file a record still uses is never a candidate');
select ok(
  not exists (select 1 from public.file_cleanup_candidates(now(), now(), now()) where id = pg_temp.fx('kept_prev')),
  'nor its preview');
select ok(
  not exists (select 1 from public.file_cleanup_candidates(now(), now(), now()) where id = pg_temp.fx('shared')),
  'nor a live file in use');

select pg_temp.as_system();
select * from finish();
rollback;
