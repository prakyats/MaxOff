-- 1.2 Auth: session_login / session_logout for every role, and the CEO bootstrap.
begin;
create extension if not exists pgtap with schema extensions;
select plan(49);

-- Start from nothing: the local seed (1.2) holds an organization and five sign-ins, and the
-- bootstrap must be proven on an empty install. Rolled back with everything else at the end.
-- The audit trigger would reference the organization being removed, so it is paused for the
-- cleanup only (the ALTER is rolled back too).
alter table public.organizations disable trigger audit_row_change;
alter table public.org_settings disable trigger audit_row_change;
delete from public.session_events;
delete from public.members;
delete from auth.identities;
delete from auth.users;
delete from public.activity_log;
delete from public.org_settings;
delete from public.organizations;
alter table public.organizations enable trigger audit_row_change;
alter table public.org_settings enable trigger audit_row_change;

create temporary table fx (key text primary key, id uuid not null);
insert into fx values
  ('ceo',         '00000000-0000-4000-8000-000000000001'),
  ('admin',       '00000000-0000-4000-8000-000000000002'),
  ('staff',       '00000000-0000-4000-8000-000000000003'),
  ('deactivated', '00000000-0000-4000-8000-000000000004'),
  ('invited',     '00000000-0000-4000-8000-000000000005'),
  ('nobody',      '00000000-0000-4000-8000-000000000009');
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

-- Auth users only: members arrive through the bootstrap below and as fixtures.
insert into auth.users (id, email)
select id, key || '@example.com' from fx where key <> 'nobody';

-- Structure and grants ----------------------------------------------------------------------
select has_function('public', 'session_login', array['text', 'text'], 'session_login(text, text) exists');
select has_function('public', 'session_logout', array['text', 'text'], 'session_logout(text, text) exists');
select has_function('public', 'bootstrap_ceo', array['uuid', 'text', 'text', 'text'], 'bootstrap_ceo(uuid, text, text, text) exists');
select ok(
  has_function_privilege('authenticated', 'public.session_login(text, text)', 'execute')
  and has_function_privilege('authenticated', 'public.session_logout(text, text)', 'execute')
  and has_function_privilege('service_role', 'public.session_login(text, text)', 'execute')
  and has_function_privilege('service_role', 'public.session_logout(text, text)', 'execute'),
  'authenticated and service_role may call the session functions');
select ok(
  not has_function_privilege('anon', 'public.session_login(text, text)', 'execute')
  and not has_function_privilege('anon', 'public.session_logout(text, text)', 'execute')
  and not has_function_privilege('anon', 'public.bootstrap_ceo(uuid, text, text, text)', 'execute'),
  'anon may call none of them');
select ok(
  not has_function_privilege('authenticated', 'public.bootstrap_ceo(uuid, text, text, text)', 'execute')
  and has_function_privilege('service_role', 'public.bootstrap_ceo(uuid, text, text, text)', 'execute'),
  'bootstrap_ceo is service_role only');

-- bootstrap_ceo: validation on an empty team -------------------------------------------------
select is((select count(*) from public.members), 0::bigint, 'the team starts empty');
select is((select count(*) from public.organizations), 0::bigint, 'no organization exists yet');
select throws_ok(
  $$ select public.bootstrap_ceo(pg_temp.fx('nobody'), 'nobody@example.com', 'Nobody', 'Boot Org') $$,
  'P0001', 'NOT_FOUND', 'the auth user must exist first');
select throws_ok(
  $$ select public.bootstrap_ceo(pg_temp.fx('ceo'), 'not-an-email', 'Test CEO', 'Boot Org') $$,
  'P0001', 'VALIDATION', 'the email must look like one');
select throws_ok(
  $$ select public.bootstrap_ceo(pg_temp.fx('ceo'), 'ceo@example.com', '  ', 'Boot Org') $$,
  'P0001', 'VALIDATION', 'the name is required');
select throws_ok(
  $$ select public.bootstrap_ceo(pg_temp.fx('ceo'), 'other@example.com', 'Test CEO', 'Boot Org') $$,
  'P0001', 'VALIDATION', 'the member email must be the auth user''s email');
select throws_ok(
  $$ select public.bootstrap_ceo(pg_temp.fx('ceo'), 'ceo@example.com', 'Test CEO', null) $$,
  'P0001', 'VALIDATION', 'the organization name is required when none exists');

-- bootstrap_ceo: creates the organization when there is none ---------------------------------
savepoint fresh_install;
select is(public.bootstrap_ceo(pg_temp.fx('ceo'), '  CEO@Example.com ', ' Test CEO ', ' Boot Org '), pg_temp.fx('ceo'),
  'bootstrap_ceo returns the member id');
select is((select count(*) from public.organizations), 1::bigint, 'the organization was created');
select is((select name from public.organizations), 'Boot Org', 'with the trimmed name');
select is((select count(*) from public.org_settings), 1::bigint, 'and got its org_settings by trigger');
select results_eq(
  $$ select full_name, email, role::text, status::text, joined_at is not null, deactivated_at is null,
            org_id = (select id from public.organizations)
       from public.members where id = pg_temp.fx('ceo') $$,
  $$ values ('Test CEO', 'ceo@example.com', 'ceo', 'active', true, true, true) $$,
  'the CEO is active, joined, lower-cased and trimmed, in the new organization');
select is(
  (select count(*) from public.activity_log
     where entity = 'members' and entity_id = pg_temp.fx('ceo') and action = 'insert' and actor_id is null),
  1::bigint, 'the bootstrap insert is audited as a system action');
select throws_ok(
  $$ select public.bootstrap_ceo(pg_temp.fx('admin'), 'admin@example.com', 'Second', 'Boot Org') $$,
  'P0001', 'CONFLICT', 'a second call is refused once a member exists');
rollback to savepoint fresh_install;

-- bootstrap_ceo: uses the existing single organization ---------------------------------------
insert into public.organizations (name) values ('Test Org');
insert into fx select 'org', id from public.organizations limit 1;
select is(public.bootstrap_ceo(pg_temp.fx('ceo'), 'ceo@example.com', 'Test CEO', null), pg_temp.fx('ceo'),
  'with one organization, bootstrap_ceo needs no organization name');
select is((select count(*) from public.organizations), 1::bigint, 'no second organization was created');
select is((select org_id from public.members where id = pg_temp.fx('ceo')), pg_temp.fx('org'),
  'the CEO belongs to the existing organization');

-- The rest of the team, written as the owner (in_transition() is true here).
insert into public.members (id, org_id, full_name, email, phone, role, status, joined_at, deactivated_at)
values
  (pg_temp.fx('admin'),       pg_temp.fx('org'), 'Test Admin', 'admin@example.com',       '9000000002', 'admin', 'active',      now(), null),
  (pg_temp.fx('staff'),       pg_temp.fx('org'), 'Test Staff', 'staff@example.com',       null,         'staff', 'active',      now(), null),
  (pg_temp.fx('deactivated'), pg_temp.fx('org'), 'Gone Staff', 'deactivated@example.com', null,         'staff', 'deactivated', now(), now()),
  (pg_temp.fx('invited'),     pg_temp.fx('org'), 'New Admin',  'invited@example.com',     null,         'admin', 'invited',     null,  null);

select pg_temp.as_member('ceo');
select throws_ok(
  $$ select public.bootstrap_ceo(pg_temp.fx('nobody'), 'x@example.com', 'X', 'Y') $$,
  '42501', null, 'not even the CEO may call bootstrap_ceo through the API');
select pg_temp.as_system();
set local role service_role;
select throws_ok(
  $$ select public.bootstrap_ceo(pg_temp.fx('nobody'), 'x@example.com', 'X', 'Y') $$,
  'P0001', 'CONFLICT', 'the service role may call it, and it refuses on a live team');
select pg_temp.as_system();

-- session_login ------------------------------------------------------------------------------
select pg_temp.as_member('ceo');
select isnt(public.session_login('Mozilla/5.0 test', 'abc123'), null, 'the CEO records a login');
select results_eq(
  $$ select member_id, kind, user_agent, ip_hash from public.session_events $$,
  $$ values (pg_temp.fx('ceo'), 'login', 'Mozilla/5.0 test', 'abc123') $$,
  'the login row carries the caller, the user agent and the ip hash');

select pg_temp.as_member('admin');
select isnt(public.session_login('UA', null), null, 'an Admin records a login');
select results_eq(
  $$ select member_id, kind, ip_hash from public.session_events $$,
  $$ values (pg_temp.fx('admin'), 'login', null::text) $$,
  'the Admin sees only their own row, with a null ip hash when none was given');

select pg_temp.as_member('staff');
select isnt(public.session_login(repeat('x', 600), ''), null, 'Staff record a login');
select results_eq(
  $$ select member_id, kind, length(user_agent), ip_hash from public.session_events $$,
  $$ values (pg_temp.fx('staff'), 'login', 512, null::text) $$,
  'the user agent is capped at 512 characters and an empty ip hash becomes null');

select pg_temp.as_member('deactivated');
select throws_ok($$ select public.session_login('UA', null) $$, 'P0001', 'UNAUTHENTICATED',
  'a deactivated member cannot record a login');
select pg_temp.as_member('invited');
select throws_ok($$ select public.session_login('UA', null) $$, 'P0001', 'UNAUTHENTICATED',
  'an invited member cannot record a login yet');
select pg_temp.as_member('nobody');
select throws_ok($$ select public.session_login('UA', null) $$, 'P0001', 'UNAUTHENTICATED',
  'an auth user with no member row cannot record a login');
select pg_temp.as_system();
set local role anon;
select throws_ok($$ select public.session_login('UA', null) $$, '42501', null, 'anon cannot call session_login');
select pg_temp.as_system();

-- session_logout -----------------------------------------------------------------------------
select pg_temp.as_member('ceo');
select isnt(public.session_logout('Mozilla/5.0 test', 'abc123'), null, 'the CEO records a logout');
select pg_temp.as_member('admin');
select isnt(public.session_logout('UA', 'h2'), null, 'an Admin records a logout');
select pg_temp.as_member('staff');
select isnt(public.session_logout(null, null), null, 'Staff record a logout with no metadata');
select results_eq(
  $$ select kind, user_agent, ip_hash from public.session_events order by at $$,
  $$ values ('login', repeat('x', 512), null::text), ('logout', null::text, null::text) $$,
  'Staff see their own login then logout');

select pg_temp.as_member('deactivated');
select throws_ok($$ select public.session_logout('UA', null) $$, 'P0001', 'UNAUTHENTICATED',
  'a deactivated member cannot record a logout');
select pg_temp.as_member('invited');
select throws_ok($$ select public.session_logout('UA', null) $$, 'P0001', 'UNAUTHENTICATED',
  'an invited member cannot record a logout');
select pg_temp.as_system();
set local role anon;
select throws_ok($$ select public.session_logout('UA', null) $$, '42501', null, 'anon cannot call session_logout');
select pg_temp.as_system();

-- What was written -------------------------------------------------------------------------
select is((select count(*) from public.session_events), 6::bigint, 'six session events in total');
select is((select count(*) from public.session_events where kind = 'login'), 3::bigint, 'three logins');
select is((select count(*) from public.session_events where kind = 'logout'), 3::bigint, 'three logouts');
select is((select count(*) from public.activity_log where entity = 'session_events'), 0::bigint,
  'login and logout write no activity_log row: session_events is the record');
select is((select count(*) from public.session_events where member_id in (pg_temp.fx('deactivated'), pg_temp.fx('invited'))),
  0::bigint, 'nothing was recorded for the deactivated or invited members');

select pg_temp.as_member('ceo');
select is((select count(*) from public.session_events), 6::bigint, 'the CEO (attendance.view_all) sees every event');
select pg_temp.as_member('deactivated');
select is((select count(*) from public.session_events), 0::bigint, 'a deactivated member still sees nothing');
select pg_temp.as_system();

select * from finish();
rollback;
