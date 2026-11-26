-- v7.5 Q1 (owner 2026-11-26; migration v75_privacy_notice): privacy_notice_reads' RLS for each role
-- (own row only; no API write) and privacy_notice_read() on every path (the caller's own row
-- inserted, the same version again changes nothing, a new version moves it, a malformed version is
-- refused, a deactivated or invited caller is refused, anon may not call it), with the audit
-- history. Neutral names only.
begin;
create extension if not exists pgtap with schema extensions;
select plan(20);

create temporary table fx (key text primary key, id uuid);
insert into fx values
  ('owner',   '10000000-0000-4000-8000-000000000001'),
  ('admin',   '10000000-0000-4000-8000-000000000002'),
  ('staff',   '10000000-0000-4000-8000-000000000003'),
  ('gone',    '00000000-0000-4000-8000-000000017701'),
  ('invited', '00000000-0000-4000-8000-000000017702');
insert into fx select 'org', id from public.organizations order by created_at limit 1;
grant select on fx to authenticated;
create function pg_temp.fx(k text) returns uuid language sql stable as $$ select id from fx where key = k; $$;
create function pg_temp.as_member(k text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(pg_temp.fx(k)::text, ''), true);
  perform set_config('request.jwt.claims', json_build_object('sub', pg_temp.fx(k), 'role', 'authenticated')::text, true);
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
create function pg_temp.raised(sql text) returns text language plpgsql as $$
begin
  execute sql;
  return null;
exception when others then
  return sqlerrm;
end;
$$;
create function pg_temp.version_of(k text) returns text language sql stable as $$
  select version from public.privacy_notice_reads where member_id = pg_temp.fx(k);
$$;

delete from public.privacy_notice_reads;
insert into auth.users (id, email) values
  (pg_temp.fx('gone'), 'privacy-gone-17701@example.com'),
  (pg_temp.fx('invited'), 'privacy-invited-17702@example.com');
insert into public.members (id, org_id, full_name, email, role, status, engagement, joined_at, deactivated_at) values
  (pg_temp.fx('gone'),    pg_temp.fx('org'), 'Privacy gone 177',    'privacy-gone-17701@example.com',    'staff', 'deactivated', 'permanent', now() - interval '9 days', now()),
  (pg_temp.fx('invited'), pg_temp.fx('org'), 'Privacy invited 177', 'privacy-invited-17702@example.com', 'staff', 'invited',     'permanent', null, null);

-- 1. Grants -----------------------------------------------------------------------------------------
select ok((select relrowsecurity from pg_class where oid = 'public.privacy_notice_reads'::regclass),
  'privacy_notice_reads has RLS on');
select ok(has_table_privilege('authenticated', 'public.privacy_notice_reads', 'select')
          and not has_table_privilege('authenticated', 'public.privacy_notice_reads', 'insert')
          and not has_table_privilege('authenticated', 'public.privacy_notice_reads', 'update')
          and not has_table_privilege('authenticated', 'public.privacy_notice_reads', 'delete'),
  'a member may read and never write privacy_notice_reads directly');
select ok(not has_table_privilege('anon', 'public.privacy_notice_reads', 'select'),
  'anon reads nothing');
select ok(not has_function_privilege('anon', 'public.privacy_notice_read(text)', 'execute'),
  'anon may not call privacy_notice_read');

-- 2. Each role confirms its own reading -------------------------------------------------------------
select pg_temp.as_member('staff');
select lives_ok($$select public.privacy_notice_read('2026-11-26')$$, 'Crew confirms reading');
select pg_temp.as_member('admin');
select lives_ok($$select public.privacy_notice_read('2026-11-26')$$, 'an Admin confirms reading');
select pg_temp.as_member('owner');
select lives_ok($$select public.privacy_notice_read('2026-11-26')$$, 'the Owner confirms reading');
select pg_temp.as_system();
select is((select count(*) from public.privacy_notice_reads where version = '2026-11-26'), 3::bigint,
  'one row each');
select is((select org_id from public.privacy_notice_reads where member_id = pg_temp.fx('staff')), pg_temp.fx('org'),
  'in the caller''s organisation');

-- 3. Each reads only their own row ------------------------------------------------------------------
select pg_temp.as_member('staff');
select is((select count(*) from public.privacy_notice_reads), 1::bigint, 'Crew reads their own row only');
select pg_temp.as_member('admin');
select is((select count(*) from public.privacy_notice_reads), 1::bigint, 'an Admin reads their own row only');
select pg_temp.as_member('owner');
select is((select count(*) from public.privacy_notice_reads), 1::bigint, 'the Owner reads their own row only');
select pg_temp.as_member('staff');
select is(pg_temp.raised($$insert into public.privacy_notice_reads (member_id, org_id, version) values ('10000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002', '2026-11-26')$$),
  'permission denied for table privacy_notice_reads', 'Crew cannot write a row, for anyone');

-- 4. The same version again; a new one; the history ------------------------------------------------
select pg_temp.as_system();
select is((select count(*) from public.activity_log where entity = 'privacy_notice_reads' and entity_id = pg_temp.fx('staff')),
  1::bigint, 'the first confirmation is audited');
select pg_temp.as_member('staff');
select public.privacy_notice_read('2026-11-26');
select pg_temp.as_system();
select is((select count(*) from public.activity_log where entity = 'privacy_notice_reads' and entity_id = pg_temp.fx('staff')),
  1::bigint, 'the same version again changes nothing');
select pg_temp.as_member('staff');
select public.privacy_notice_read('2027-01-15');
select pg_temp.as_system();
select is(pg_temp.version_of('staff'), '2027-01-15', 'a new version moves the row');
select is((select count(*) from public.activity_log where entity = 'privacy_notice_reads' and entity_id = pg_temp.fx('staff')),
  2::bigint, 'and the history keeps both');

-- 5. Refused ------------------------------------------------------------------------------------------
select pg_temp.as_member('staff');
select is(pg_temp.raised($$select public.privacy_notice_read('soon')$$), 'VALIDATION', 'a malformed version is refused');
select pg_temp.as_member('gone');
select is(pg_temp.raised($$select public.privacy_notice_read('2026-11-26')$$), 'FORBIDDEN',
  'a deactivated member is refused');
select pg_temp.as_member('invited');
select is(pg_temp.raised($$select public.privacy_notice_read('2026-11-26')$$), 'FORBIDDEN',
  'an invited member who has not joined is refused');

select * from finish();
rollback;
