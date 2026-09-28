-- 3.3 Files: the files table for every role (allowed and denied), app.file_visible() for the
-- company logo, an avatar, a client logo and a preview, the reference guards on the consumers,
-- the replace trigger, member_directory's new column, the status functions on every path and
-- the service-only cleanup functions. The 3A review additions (migration 20260927065451): the
-- activity policy per role, the preview's archive audit, a client logo replacement, file_fail by
-- the wrong actor, and a failed upload as a cleanup candidate. Phase 3 review (migration
-- 20260927144619): no API insert; file_begin() and file_complete() are service_role only (the
-- storage actions call them after their checks), file_begin() builds the key.
begin;
create extension if not exists pgtap with schema extensions;
select plan(88);

delete from public.attendance_events;
delete from public.attendance_days;
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

create temporary table fx (key text primary key, id uuid not null);
insert into fx values
  ('owner',    '00000000-0000-4000-8000-000000000001'),
  ('admin',    '00000000-0000-4000-8000-000000000002'),
  ('admin2',   '00000000-0000-4000-8000-000000000003'),
  ('staff',    '00000000-0000-4000-8000-000000000004'),
  ('staff2',   '00000000-0000-4000-8000-000000000005'),
  ('nobody',   '00000000-0000-4000-8000-000000000009'),
  ('client_a', '00000000-0000-4000-8000-0000000000a1'),
  ('logo',     '00000000-0000-4000-8000-0000000000e1'),
  ('logo_prev','00000000-0000-4000-8000-0000000000e2'),
  ('avatar',   '00000000-0000-4000-8000-0000000000e3'),
  ('svg',      '00000000-0000-4000-8000-0000000000e4'),
  ('clogo',    '00000000-0000-4000-8000-0000000000e5'),
  ('logo2',    '00000000-0000-4000-8000-0000000000e6'),
  ('stale',    '00000000-0000-4000-8000-0000000000e7'),
  ('clogo2',   '00000000-0000-4000-8000-0000000000e8'),
  ('p1',       '00000000-0000-4000-8000-0000000000e9'),
  ('p2',       '00000000-0000-4000-8000-0000000000ea'),
  ('dots',     '00000000-0000-4000-8000-0000000000eb');
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

-- The storage actions' two server-side writes, run as service_role for a member, then back to
-- that member (what the action does: the member's request, the service client for these two).
create function pg_temp.begin(k text, who text, fname text, fmime text, fsize bigint, original text default null)
returns uuid language plpgsql as $$
declare r public.files;
begin
  perform set_config('role', 'service_role', true);
  select * into r from public.file_begin(pg_temp.fx(k), pg_temp.fx(who), fname, fmime, fsize,
    case when original is null then null else pg_temp.fx(original) end);
  perform pg_temp.as_member(who);
  return r.id;
end;
$$;

create function pg_temp.complete(k text, who text, fsize bigint) returns text language plpgsql as $$
declare r text;
begin
  perform set_config('role', 'service_role', true);
  r := public.file_complete(pg_temp.fx(k), pg_temp.fx(who), fsize);
  perform pg_temp.as_member(who);
  return r;
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
select id, key || '@example.com' from fx where key in ('owner', 'admin', 'admin2', 'staff', 'staff2');

insert into public.members (id, org_id, full_name, email, phone, role, status, joined_at, deactivated_at) values
  (pg_temp.fx('owner'),  pg_temp.fx('org'), 'Test Owner',  'owner@example.com',  '9000000001', 'owner', 'active', now(), null),
  (pg_temp.fx('admin'),  pg_temp.fx('org'), 'Test Admin',  'admin@example.com',  null,         'admin', 'active', now(), null),
  (pg_temp.fx('admin2'), pg_temp.fx('org'), 'Other Admin', 'admin2@example.com', null,         'admin', 'active', now(), null),
  (pg_temp.fx('staff'),  pg_temp.fx('org'), 'Test Staff',  'staff@example.com',  null,         'staff', 'active', now(), null),
  (pg_temp.fx('staff2'), pg_temp.fx('org'), 'Other Staff', 'staff2@example.com', null,         'staff', 'active', now(), null);
insert into public.clients (id, org_id, name, admin_id) values
  (pg_temp.fx('client_a'), pg_temp.fx('org'), 'Client A', pg_temp.fx('admin'));
delete from public.activity_log;

-- Structure and grants ----------------------------------------------------------------------
select has_table('public', 'files', 'files exists');
select has_column('public', 'organizations', 'logo_file_id', 'organizations.logo_file_id exists');
select has_column('public', 'members', 'avatar_file_id', 'members.avatar_file_id exists');
select has_column('public', 'member_directory', 'avatar_file_id', 'member_directory carries avatar_file_id (appended)');
select has_function('app', 'file_visible', array['uuid'], 'app.file_visible exists');
select has_function('public', 'file_begin', array['uuid', 'uuid', 'text', 'text', 'bigint', 'uuid'], 'file_begin exists');
select has_function('public', 'file_complete', array['uuid', 'uuid', 'bigint', 'text'], 'file_complete names the uploader');
select hasnt_function('public', 'file_complete', array['uuid', 'bigint', 'text'], 'the member-callable file_complete is gone');
select ok(
  not has_table_privilege('authenticated', 'public.files', 'insert')
  and not has_function_privilege('authenticated', 'public.file_begin(uuid, uuid, text, text, bigint, uuid)', 'execute')
  and not has_function_privilege('authenticated', 'public.file_complete(uuid, uuid, bigint, text)', 'execute')
  and has_function_privilege('service_role', 'public.file_begin(uuid, uuid, text, text, bigint, uuid)', 'execute')
  and has_function_privilege('service_role', 'public.file_complete(uuid, uuid, bigint, text)', 'execute'),
  'members never insert a file row or complete an upload themselves: service_role only (phase 3 review)');
select has_function('public', 'file_fail', array['uuid'], 'file_fail exists');
select has_function('public', 'file_mark_deleted', array['uuid'], 'file_mark_deleted exists');
select has_function('public', 'file_cleanup_candidates', array['timestamptz', 'timestamptz', 'timestamptz', 'integer'], 'file_cleanup_candidates exists (the orphan window since 20260927130730)');
select ok(not has_table_privilege('anon', 'public.files', 'select, insert, update, delete'),
  'anon has no privilege on files');
select ok(not has_table_privilege('authenticated', 'public.files', 'delete, truncate, references, trigger'),
  'authenticated never deletes a file row');
select ok(
  has_column_privilege('authenticated', 'public.files', 'name', 'update')
  and not has_column_privilege('authenticated', 'public.files', 'status', 'update')
  and not has_column_privilege('authenticated', 'public.files', 'storage_key', 'update')
  and not has_column_privilege('authenticated', 'public.files', 'archived_at', 'update'),
  'only the name is editable through the API; status and the key are the functions''');
select ok(
  has_column_privilege('authenticated', 'public.organizations', 'logo_file_id', 'update')
  and has_column_privilege('authenticated', 'public.members', 'avatar_file_id', 'update'),
  'the two consumer columns are granted');
select ok(
  not has_function_privilege('authenticated', 'public.file_mark_deleted(uuid)', 'execute')
  and not has_function_privilege('authenticated', 'public.file_cleanup_candidates(timestamptz, timestamptz, timestamptz, integer)', 'execute')
  and has_function_privilege('service_role', 'public.file_mark_deleted(uuid)', 'execute')
  and has_function_privilege('service_role', 'public.file_cleanup_candidates(timestamptz, timestamptz, timestamptz, integer)', 'execute'),
  'the cleanup functions are service_role only');

-- Uploading: a pending row of one''s own ------------------------------------------------------
select pg_temp.as_member('staff');
select throws_ok(
  $$ insert into public.files (id, org_id, storage_key, name, mime, size_bytes)
     values (pg_temp.fx('p1'), pg_temp.fx('org'), pg_temp.fx('org') || '/2026/09/x/../y/logo.png', 'l.png', 'image/png', 1) $$,
  '42501', null, 'a member cannot insert a file row with a key of their choosing (phase 3 review)');
select throws_ok($$ select public.file_complete(pg_temp.fx('p1'), pg_temp.fx('staff'), 1) $$, '42501', null,
  'nor call file_complete directly');
select lives_ok($$ select pg_temp.begin('logo', 'owner', 'logo.png', 'image/png', 1234) $$,
  'the Owner starts an upload (through file_begin)');
select results_eq(
  $$ select status, uploaded_by, storage_key from public.files where id = pg_temp.fx('logo') $$,
  $$ values ('pending', pg_temp.fx('owner'),
             pg_temp.fx('org') || '/' || to_char(app.today_ist(), 'YYYY/MM') || '/' || pg_temp.fx('logo') || '/logo.png') $$,
  'the row is pending, the uploader''s, and its key is built by the database (IST month)');
select is(
  (select actor_id from public.activity_log where entity = 'files' and entity_id = pg_temp.fx('logo') and action = 'insert'),
  pg_temp.fx('owner'), 'the insert is audited as the uploader, not the service');
select lives_ok($$ select pg_temp.begin('dots', 'owner', '..', 'image/png', 5) $$, 'a file named .. still starts');
select is((select storage_key like '%/' || pg_temp.fx('dots') || '/file' from public.files where id = pg_temp.fx('dots')), true,
  'but its key never ends in a dot segment');
select lives_ok($$ select pg_temp.complete('dots', 'owner', 5) $$, 'and completes like any other');
select throws_ok(
  $$ update public.organizations set logo_file_id = pg_temp.fx('logo') where id = pg_temp.fx('org') $$,
  'P0001', 'INVALID_STATE', 'a pending file cannot be attached');
select pg_temp.as_member('staff');
select throws_ok(
  $$ select pg_temp.complete('logo', 'staff', 1234) $$,
  'P0001', 'NOT_FOUND', 'someone else cannot complete the upload (and does not learn it exists)');
select is((select count(*) from public.files), 0::bigint, 'a pending upload is visible to its uploader only');
select pg_temp.as_member('owner');
select throws_ok($$ select pg_temp.complete('logo', 'owner', 0) $$, 'P0001', 'VALIDATION',
  'completing needs the size');
select is(pg_temp.complete('logo', 'owner', 1234), 'ready', 'pending → ready');
select is(
  (select actor_id from public.activity_log where entity = 'files' and entity_id = pg_temp.fx('logo') and action = 'ready'),
  pg_temp.fx('owner'), 'ready is audited as the uploader');
select throws_ok($$ select pg_temp.complete('logo', 'owner', 1234) $$, 'P0001', 'INVALID_STATE',
  'ready cannot be completed again');
select throws_ok($$ select public.file_fail(pg_temp.fx('logo')) $$, 'P0001', 'INVALID_STATE',
  'ready cannot fail');
select throws_ok(
  $$ update public.files set status = 'pending' where id = pg_temp.fx('logo') $$,
  '42501', null, 'status is not editable directly');

-- Previews ---------------------------------------------------------------------------------------
select lives_ok($$ select pg_temp.begin('logo_prev', 'owner', 'logo-preview.jpg', 'image/jpeg', 300, 'logo') $$,
  'a preview points at the uploader''s original');
select lives_ok($$ select pg_temp.complete('logo_prev', 'owner', 300) $$, 'the preview completes');
select throws_ok(
  $$ select pg_temp.begin('p1', 'owner', 'p.jpg', 'image/jpeg', 10, 'logo_prev') $$,
  'P0001', 'VALIDATION', 'a preview never points at a preview');
select pg_temp.as_member('staff');
select throws_ok(
  $$ select pg_temp.begin('p2', 'staff', 'p.jpg', 'image/jpeg', 10, 'logo') $$,
  'P0001', 'VALIDATION', 'a preview of someone else''s original is refused');

-- The company logo: any member may see it once attached -----------------------------------------
select pg_temp.as_member('owner');
select throws_ok(
  $$ update public.organizations set logo_file_id = pg_temp.fx('logo_prev') where id = pg_temp.fx('org') $$,
  'P0001', 'VALIDATION', 'the original is attached, never its preview');
select lives_ok(
  $$ update public.organizations set logo_file_id = pg_temp.fx('logo') where id = pg_temp.fx('org') $$,
  'the Owner attaches the company logo');
select pg_temp.as_member('staff');
select is((select count(*) from public.files where id in (pg_temp.fx('logo'), pg_temp.fx('logo_prev'))), 2::bigint,
  'Staff read the company logo and its preview');
select pg_temp.as_member('admin');
select is(pg_temp.update_count($$ update public.organizations set logo_file_id = null where id = pg_temp.fx('org') $$), 0::bigint,
  'an Admin''s change of the company logo matches no row (settings.manage)');

-- Avatars: own upload, raster only, team.view or the person ---------------------------------------
select pg_temp.as_member('staff');
select lives_ok($$ select pg_temp.begin('avatar', 'staff', 'me.jpg', 'image/jpeg', 2000) $$,
  'Staff start their own avatar upload');
select lives_ok($$ select pg_temp.complete('avatar', 'staff', 2000) $$, 'and complete it');
select lives_ok($$ select pg_temp.begin('svg', 'staff', 'me.svg', 'image/svg+xml', 500) $$,
  'an SVG upload is a file like any other');
select lives_ok($$ select pg_temp.complete('svg', 'staff', 480) $$, 'it completes (sanitised, a new size)');
select throws_ok(
  $$ update public.members set avatar_file_id = pg_temp.fx('svg') where id = pg_temp.fx('staff') $$,
  'P0001', 'VALIDATION', 'an avatar is never an SVG (kickoff 3)');
select throws_ok(
  $$ update public.members set avatar_file_id = pg_temp.fx('logo') where id = pg_temp.fx('staff') $$,
  'P0001', 'FORBIDDEN', 'only the uploader attaches a file');
select lives_ok(
  $$ update public.members set avatar_file_id = pg_temp.fx('avatar') where id = pg_temp.fx('staff') $$,
  'a member sets their own avatar (self edit, PERMISSIONS §3)');
select is((select avatar_file_id from public.member_directory where id = pg_temp.fx('staff')), pg_temp.fx('avatar'),
  'the directory shows it');
select pg_temp.as_member('staff2');
select is((select count(*) from public.files where id = pg_temp.fx('avatar')), 0::bigint,
  'another Staff member (no team.view) cannot read the avatar');
select pg_temp.as_member('admin');
select is((select count(*) from public.files where id = pg_temp.fx('avatar')), 1::bigint,
  'an Admin (team.view) reads it');
select is(pg_temp.update_count($$ update public.members set avatar_file_id = null where id = pg_temp.fx('staff') $$), 0::bigint,
  'an Admin cannot touch someone else''s avatar');

-- Replacing archives the previous file and its previews --------------------------------------------
select pg_temp.as_member('owner');
select lives_ok($$ select pg_temp.begin('logo2', 'owner', 'logo2.png', 'image/png', 999) $$,
  'a second logo is uploaded');
select lives_ok($$ select pg_temp.complete('logo2', 'owner', 999) $$, 'and completed');
select lives_ok(
  $$ update public.organizations set logo_file_id = pg_temp.fx('logo2') where id = pg_temp.fx('org') $$,
  'the logo is replaced');
select results_eq(
  $$ select id, archived_at is not null from public.files where id in (pg_temp.fx('logo'), pg_temp.fx('logo_prev'), pg_temp.fx('logo2')) order by name $$,
  $$ values (pg_temp.fx('logo_prev'), true), (pg_temp.fx('logo'), true), (pg_temp.fx('logo2'), false) $$,
  'the previous logo and its preview are archived; the new one is live');
select ok(
  exists (select 1 from public.activity_log where entity = 'files' and entity_id = pg_temp.fx('logo') and action = 'archived'),
  'the archive is audited');
select ok(
  exists (select 1 from public.activity_log where entity = 'files' and entity_id = pg_temp.fx('logo_prev') and action = 'archived'),
  'the preview''s archive is audited as archived too (3A review)');
select pg_temp.as_member('staff');
select is((select count(*) from public.files where id = pg_temp.fx('logo')), 0::bigint,
  'the replaced logo is no longer anyone''s to see but its uploader''s');

-- A client logo follows the client ------------------------------------------------------------
select pg_temp.as_member('admin');
select lives_ok($$ select pg_temp.begin('clogo', 'admin', 'c.png', 'image/png', 50) $$,
  'the Admin uploads a client logo');
select lives_ok($$ select pg_temp.complete('clogo', 'admin', 50) $$, 'and completes it');
select lives_ok(
  $$ update public.client_brand set logo_file_id = pg_temp.fx('clogo') where client_id = pg_temp.fx('client_a') $$,
  'and attaches it to their client');
select pg_temp.as_member('owner');
select is((select count(*) from public.files where id = pg_temp.fx('clogo')), 1::bigint, 'the Owner sees a client logo');
select pg_temp.as_member('admin2');
select is((select count(*) from public.files where id = pg_temp.fx('clogo')), 0::bigint, 'another Admin does not');
select pg_temp.as_member('staff');
select is((select count(*) from public.files where id = pg_temp.fx('clogo')), 0::bigint,
  'Staff do not until a task carries the label (4.1)');

-- The activity policy follows app.file_visible() (3A review) ------------------------------------
select ok((select count(*) from public.activity_log where entity = 'files' and entity_id = pg_temp.fx('logo2')) > 0,
  'Staff read the company logo''s activity');
select is((select count(*) from public.activity_log where entity = 'files' and entity_id = pg_temp.fx('clogo')), 0::bigint,
  'Staff read nothing of a client logo');
select pg_temp.as_member('admin2');
select is((select count(*) from public.activity_log where entity = 'files' and entity_id = pg_temp.fx('clogo')), 0::bigint,
  'nor does another Admin');
select pg_temp.as_member('admin');
select ok((select count(*) from public.activity_log where entity = 'files' and entity_id = pg_temp.fx('clogo')) > 0,
  'the client''s Admin reads its logo''s activity');

-- Replacing a client logo archives the previous one too (3A review) ----------------------------
select lives_ok($$ select pg_temp.begin('clogo2', 'admin', 'c2.png', 'image/png', 60) $$,
  'the Admin uploads a second client logo');
select lives_ok($$ select pg_temp.complete('clogo2', 'admin', 60) $$, 'and completes it');
select lives_ok(
  $$ update public.client_brand set logo_file_id = pg_temp.fx('clogo2') where client_id = pg_temp.fx('client_a') $$,
  'and replaces the client logo (the guard resolves the organization through the client)');
select results_eq(
  $$ select id, archived_at is not null from public.files where id in (pg_temp.fx('clogo'), pg_temp.fx('clogo2')) order by name $$,
  $$ values (pg_temp.fx('clogo'), true), (pg_temp.fx('clogo2'), false) $$,
  'the previous client logo is archived; the new one is live');
select ok(
  exists (select 1 from public.activity_log where entity = 'files' and entity_id = pg_temp.fx('clogo') and action = 'archived'),
  'audited as archived');

-- Failing and the cleanup job --------------------------------------------------------------------
select pg_temp.as_member('staff');
select lives_ok($$ select pg_temp.begin('stale', 'staff', 'x.png', 'image/png', 10) $$,
  'an upload that will be abandoned');
select pg_temp.as_member('staff2');
select throws_ok($$ select public.file_fail(pg_temp.fx('stale')) $$, 'P0001', 'NOT_FOUND',
  'someone else cannot fail the upload (and does not learn it exists)');
select pg_temp.as_member('staff');
select is(public.file_fail(pg_temp.fx('stale')), 'failed', 'pending → failed');
select throws_ok($$ select public.file_mark_deleted(pg_temp.fx('stale')) $$, '42501', null,
  'the API role cannot mark a file deleted');
select pg_temp.as_system();
set local role service_role;
select results_eq(
  $$ select id from public.file_cleanup_candidates(now(), now() - interval '1 second', now() - interval '7 days') order by name $$,
  $$ values (pg_temp.fx('clogo')), (pg_temp.fx('logo_prev')), (pg_temp.fx('logo')) $$,
  'archived rows are candidates once the threshold has passed; a failed row waits for its pending window');
select results_eq(
  $$ select id from public.file_cleanup_candidates(now() - interval '31 days', now(), now() - interval '7 days') $$,
  $$ values (pg_temp.fx('stale')) $$,
  'a failed upload is a candidate once its pending window has passed (3A review)');
select is((select count(*) from public.file_cleanup_candidates(now() - interval '31 days', now() - interval '25 hours', now() - interval '7 days')), 0::bigint,
  'nothing is old enough with the real thresholds');
select is(public.file_mark_deleted(pg_temp.fx('logo')), 'deleted', 'the job marks the object gone');
select is(public.file_mark_deleted(pg_temp.fx('logo')), 'deleted', 'idempotent');
select is((select count(*) from public.file_cleanup_candidates(now(), now(), now() - interval '7 days')), 3::bigint,
  'a deleted row is never a candidate again (the preview, the client logo and the failed upload still are)');
select is(public.file_mark_deleted(pg_temp.fx('stale')), 'deleted', 'a failed upload''s object goes the same way');
select is((select status from public.files where id = pg_temp.fx('logo')), 'deleted', 'the row stays, as deleted');
select pg_temp.as_system();
set local role anon;
select throws_ok($$ select count(*) from public.files $$, '42501', null, 'anon cannot read files');
select pg_temp.as_system();

select * from finish();
rollback;
