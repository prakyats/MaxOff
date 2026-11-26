-- v7.5 Q2 (owner 2026-11-26; migration v75_second_step): members.second_step and second_step_set()
-- on every path for each role (the Owner and an Admin may, from an aal2 session only; Crew never; a
-- deactivated caller and anon never), the same value again writes nothing, every change is audited,
-- the column cannot be written directly, and session_early() carries it. Neutral names only.
begin;
create extension if not exists pgtap with schema extensions;
select plan(16);

create temporary table fx (key text primary key, id uuid);
insert into fx values
  ('owner', '10000000-0000-4000-8000-000000000001'),
  ('admin', '10000000-0000-4000-8000-000000000002'),
  ('staff', '10000000-0000-4000-8000-000000000003'),
  ('gone',  '00000000-0000-4000-8000-000000017801');
insert into fx select 'org', id from public.organizations order by created_at limit 1;
grant select on fx to authenticated;
create function pg_temp.fx(k text) returns uuid language sql stable as $$ select id from fx where key = k; $$;
-- A session as the member, at the given assurance level (the token's `aal` claim).
create function pg_temp.as_member(k text, aal text default 'aal1') returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(pg_temp.fx(k)::text, ''), true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', pg_temp.fx(k), 'role', 'authenticated', 'aal', aal)::text, true);
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
create function pg_temp.flag(k text) returns boolean language sql stable as $$
  select second_step from public.members where id = pg_temp.fx(k);
$$;
create function pg_temp.audits(k text) returns bigint language sql stable as $$
  select count(*) from public.activity_log
  where entity = 'members' and entity_id = pg_temp.fx(k) and action = 'update'
    and (diff -> 'new' ->> 'second_step') is distinct from (diff -> 'old' ->> 'second_step');
$$;

update public.members set second_step = false where id in (pg_temp.fx('owner'), pg_temp.fx('admin'), pg_temp.fx('staff'));
insert into auth.users (id, email) values (pg_temp.fx('gone'), 'second-gone-17801@example.com');
insert into public.members (id, org_id, full_name, email, role, status, engagement, joined_at, deactivated_at) values
  (pg_temp.fx('gone'), pg_temp.fx('org'), 'Second gone 178', 'second-gone-17801@example.com', 'admin', 'deactivated', 'permanent', now() - interval '9 days', now());

select is((select column_default from information_schema.columns
           where table_schema = 'public' and table_name = 'members' and column_name = 'second_step'),
  'false', 'second_step is off by default');
select ok(not has_function_privilege('anon', 'public.second_step_set(boolean)', 'execute'),
  'anon may not call second_step_set');
select ok(not has_column_privilege('authenticated', 'public.members', 'second_step', 'update'),
  'the API role cannot write the column directly');

-- An Admin: only after the second step ------------------------------------------------------------
select pg_temp.as_member('admin', 'aal1');
select is(pg_temp.raised('select public.second_step_set(true)'), 'FORBIDDEN',
  'an Admin with a password alone (aal1) cannot turn it on');
select is(pg_temp.raised('select public.second_step_set(false)'), 'FORBIDDEN',
  '... nor off');
select pg_temp.as_member('admin', 'aal2');
select lives_ok('select public.second_step_set(true)', 'an Admin past the second step turns it on');
select pg_temp.as_system();
select is(pg_temp.flag('admin'), true, 'it is on');
select is(pg_temp.audits('admin'), 1::bigint, 'and audited');
select pg_temp.as_member('admin', 'aal2');
select public.second_step_set(true);
select pg_temp.as_system();
select is(pg_temp.audits('admin'), 1::bigint, 'the same value again writes nothing');
select pg_temp.as_member('admin', 'aal2');
select public.second_step_set(false);
select pg_temp.as_system();
select ok(pg_temp.flag('admin') = false and pg_temp.audits('admin') = 2, 'an Admin turns it off again, audited');

-- The Owner, Crew, a deactivated member -----------------------------------------------------------------
select pg_temp.as_member('owner', 'aal2');
select lives_ok('select public.second_step_set(true)', 'the Owner past the second step turns it on');
select pg_temp.as_member('staff', 'aal2');
select is(pg_temp.raised('select public.second_step_set(true)'), 'FORBIDDEN', 'Crew is never offered it');
select pg_temp.as_member('staff', 'aal1');
select is(pg_temp.raised('update public.members set second_step = true where id = ''10000000-0000-4000-8000-000000000003'''),
  'permission denied for table members', 'Crew cannot set it directly');
select pg_temp.as_member('gone', 'aal2');
select is(pg_temp.raised('select public.second_step_set(true)'), 'UNAUTHENTICATED', 'a deactivated member is refused');

-- The shell's first read carries it --------------------------------------------------------------------
select pg_temp.as_member('owner', 'aal2');
select is((public.session_early() -> 'member' ->> 'second_step')::boolean, true,
  'session_early() carries the Owner''s second_step');
select pg_temp.as_member('staff', 'aal1');
select is((public.session_early() -> 'member' ->> 'second_step')::boolean, false,
  'and Crew''s (off)');

select * from finish();
rollback;
