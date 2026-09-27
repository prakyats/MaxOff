-- 3B review (owner decision 2026-09-27, migration 20260927130730): a `ready` original that nothing
-- references, older than 7 days, joins the storage cleanup; its previews follow it. Every path of
-- file_cleanup_candidates' orphan rule: a file referenced by each consumer (company logo, avatar,
-- client logo) is kept however old; an unreferenced one younger than 7 days is kept; one older is
-- a candidate; a preview follows its original (kept with a referenced or young one, a candidate
-- with an orphan, and still one once the original is deleted); a new table that declares a
-- foreign key to files protects its files with no change to the function; archived and pending
-- rows are not orphans; and the orphan window is the caller's. The review fixes (migration
-- 20260927134340): a preview a foreign key references is kept even once its original is deleted
-- (ADR-0010: submission previews outlive the local original), and an upload 6 days old can no
-- longer be attached, so nothing the cleanup is about to take can be referenced.
begin;
create extension if not exists pgtap with schema extensions;
select plan(18);

delete from public.attendance_events;
delete from public.attendance_days;
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
update public.members set avatar_file_id = null;
delete from public.files;
delete from public.members;
delete from auth.identities;
delete from auth.users;

create temporary table fx (key text primary key, id uuid not null);
insert into fx values
  ('owner',      '00000000-0000-4000-8000-000000000001'),
  ('staff',      '00000000-0000-4000-8000-000000000004'),
  ('client_a',   '00000000-0000-4000-8000-0000000000a1'),
  ('ref_org',    '00000000-0000-4000-8000-0000000000f1'),
  ('ref_avatar', '00000000-0000-4000-8000-0000000000f2'),
  ('ref_client', '00000000-0000-4000-8000-0000000000f3'),
  ('young',      '00000000-0000-4000-8000-0000000000f4'),
  ('old',        '00000000-0000-4000-8000-0000000000f5'),
  ('old_prev',   '00000000-0000-4000-8000-0000000000f6'),
  ('ref_prev',   '00000000-0000-4000-8000-0000000000f7'),
  ('young_prev', '00000000-0000-4000-8000-0000000000f8'),
  ('new_ref',    '00000000-0000-4000-8000-0000000000f9'),
  ('archived',   '00000000-0000-4000-8000-0000000000fa'),
  ('pending',    '00000000-0000-4000-8000-0000000000fb'),
  ('sub_orig',   '00000000-0000-4000-8000-0000000000fc'),
  ('sub_prev',   '00000000-0000-4000-8000-0000000000fd'),
  ('fresh',      '00000000-0000-4000-8000-0000000000fe');
insert into fx select 'org', id from public.organizations limit 1;
grant select on fx to service_role, authenticated;

create function pg_temp.fx(k text) returns uuid language sql stable as $$
  select id from fx where key = k;
$$;

insert into auth.users (id, email)
select id, key || '@example.com' from fx where key in ('owner', 'staff');
insert into public.members (id, org_id, full_name, email, role, status, joined_at) values
  (pg_temp.fx('owner'), pg_temp.fx('org'), 'Test Owner', 'owner@example.com', 'owner', 'active', now()),
  (pg_temp.fx('staff'), pg_temp.fx('org'), 'Test Staff', 'staff@example.com', 'staff', 'active', now());
insert into public.clients (id, org_id, name) values (pg_temp.fx('client_a'), pg_temp.fx('org'), 'Client A');

-- The files, written as the system (a fixture: the upload protocol itself is 18's). Ages are
-- relative to now; the window under test is 7 days.
create function pg_temp.file(k text, age interval, status text default 'ready', original text default null,
                             archived interval default null)
returns void language sql as $$
  insert into public.files (id, org_id, storage_key, name, mime, size_bytes, uploaded_by, status,
                            preview_of, created_at, archived_at)
  values (pg_temp.fx(k), pg_temp.fx('org'), 'org/2026/09/' || k || '/f.png', k || '.png', 'image/png', 10,
          pg_temp.fx('staff'), status, case when original is null then null else pg_temp.fx(original) end,
          now() - age, case when archived is null then null else now() - archived end);
$$;
select pg_temp.file('ref_org',    '40 days');
select pg_temp.file('ref_avatar', '40 days');
select pg_temp.file('ref_client', '40 days');
select pg_temp.file('young',      '6 days');
select pg_temp.file('old',        '8 days');
select pg_temp.file('old_prev',   '8 days', 'ready', 'old');
select pg_temp.file('ref_prev',   '40 days', 'ready', 'ref_org');
select pg_temp.file('young_prev', '6 days', 'ready', 'young');
select pg_temp.file('new_ref',    '40 days');
select pg_temp.file('archived',   '40 days', 'ready', null, '1 day');
select pg_temp.file('pending',    '40 days', 'pending');
-- A submission original whose local copy the retention job has deleted, and its preview, which a
-- submission still shows (ADR-0010).
select pg_temp.file('sub_orig',   '40 days', 'deleted');
select pg_temp.file('sub_prev',   '40 days', 'ready', 'sub_orig');
select pg_temp.file('fresh',      '1 hour');

update public.organizations set logo_file_id = pg_temp.fx('ref_org') where id = pg_temp.fx('org');
update public.members set avatar_file_id = pg_temp.fx('ref_avatar') where id = pg_temp.fx('staff');
update public.client_brand set logo_file_id = pg_temp.fx('ref_client') where client_id = pg_temp.fx('client_a');

-- A consumer added later (phase 5's submissions, say): declaring the foreign key is enough. A real
-- table (a temporary one cannot reference files), gone with the rollback.
create table public.pgtap_later_consumer (file_id uuid references public.files (id));
insert into public.pgtap_later_consumer values (pg_temp.fx('new_ref')), (pg_temp.fx('sub_prev'));

create function pg_temp.orphans() returns setof uuid language sql as $$
  -- Only the orphan rule: the archived and pending windows are closed (nothing that old).
  select id from public.file_cleanup_candidates(now() - interval '100 years', now() - interval '100 years',
                                                now() - interval '7 days');
$$;

set local role service_role;

select ok(pg_temp.fx('ref_org') not in (select pg_temp.orphans()),
  'a ready file referenced as the company logo is kept, however old');
select ok(pg_temp.fx('ref_avatar') not in (select pg_temp.orphans()),
  'a ready file referenced as an avatar is kept');
select ok(pg_temp.fx('ref_client') not in (select pg_temp.orphans()),
  'a ready file referenced as a client logo is kept');
select ok(pg_temp.fx('new_ref') not in (select pg_temp.orphans()),
  'a later table''s foreign key protects its file with no change to the function');
select ok(pg_temp.fx('young') not in (select pg_temp.orphans()),
  'an unreferenced ready file younger than 7 days is kept');
select ok(pg_temp.fx('old') in (select pg_temp.orphans()),
  'an unreferenced ready file older than 7 days is a candidate');
select ok(pg_temp.fx('old_prev') in (select pg_temp.orphans()),
  'its preview follows it');
select ok(pg_temp.fx('ref_prev') not in (select pg_temp.orphans())
          and pg_temp.fx('young_prev') not in (select pg_temp.orphans()),
  'a preview of a referenced or a young original is kept, however old the preview');
select ok(pg_temp.fx('archived') not in (select pg_temp.orphans())
          and pg_temp.fx('pending') not in (select pg_temp.orphans()),
  'archived and pending rows are not orphans: they keep their own windows');
select results_eq(
  $$ select o from pg_temp.orphans() o order by 1 $$,
  $$ values (pg_temp.fx('old')), (pg_temp.fx('old_prev')) $$,
  'exactly the orphan and its preview');
select is(
  (select count(*) from public.file_cleanup_candidates(now() - interval '100 years', now() - interval '100 years',
                                                       now() - interval '9 days')),
  0::bigint,
  'the window is the caller''s: at 9 days nothing is old enough');

-- The job deletes the original first; its preview stays a candidate on the next run.
select is(public.file_mark_deleted(pg_temp.fx('old')), 'deleted', 'the orphan''s object is gone');
select results_eq(
  $$ select o from pg_temp.orphans() o order by 1 $$,
  $$ values (pg_temp.fx('old_prev')) $$,
  'a deleted row is never a candidate again; its preview still is');
select is(
  (select count(*) from public.file_cleanup_candidates(now() - interval '100 years', now() - interval '100 years',
                                                       now() - interval '100 years')
    where id = pg_temp.fx('old_prev')),
  1::bigint,
  'a preview whose original is deleted is a candidate whatever the windows');

select ok(pg_temp.fx('sub_prev') not in (select pg_temp.orphans())
          and not exists (select 1 from public.file_cleanup_candidates(now(), now(), now())
                          where id = pg_temp.fx('sub_prev')),
  'a preview a foreign key references is kept, even once its original is deleted (ADR-0010)');

-- Attaching stops a day before the cleanup can take an upload ------------------------------------
reset role;
select set_config('request.jwt.claim.sub', pg_temp.fx('staff')::text, true);
select set_config('request.jwt.claims',
  json_build_object('sub', pg_temp.fx('staff'), 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_ok(
  $$ update public.members set avatar_file_id = pg_temp.fx('young') where id = pg_temp.fx('staff') $$,
  'P0001', 'INVALID_STATE', 'an upload 6 days old can no longer be attached');
select lives_ok(
  $$ update public.members set avatar_file_id = pg_temp.fx('fresh') where id = pg_temp.fx('staff') $$,
  'a fresh upload attaches as before');
select is((select avatar_file_id from public.members where id = pg_temp.fx('staff')), pg_temp.fx('fresh'),
  'and is the avatar now');

select * from finish();
rollback;
