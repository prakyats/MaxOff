-- 1.3 Team: list_items for every role, members.job_title_id, and the membership transitions
-- (invite, invite link refresh, accept, deactivate incl. auth session deletion, reactivate).
begin;
create extension if not exists pgtap with schema extensions;
select plan(97);

-- The local seed holds an organization (with its seeded job titles) and five sign-ins. Keep the
-- organization and its lists; replace the people with fixtures. Rolled back at the end.
-- activity_log first: its actor_id references members (rows exist after a Playwright run).
delete from public.session_events;
delete from public.activity_log;
delete from public.members;
delete from auth.identities;
delete from auth.users;
delete from public.activity_log; -- again: the member deletes were audited

create temporary table fx (key text primary key, id uuid not null);
insert into fx values
  ('owner',       '00000000-0000-4000-8000-000000000001'),
  ('admin',       '00000000-0000-4000-8000-000000000002'),
  ('staff',       '00000000-0000-4000-8000-000000000003'),
  ('deactivated', '00000000-0000-4000-8000-000000000004'),
  ('invited',     '00000000-0000-4000-8000-000000000005'),
  ('never',       '00000000-0000-4000-8000-000000000006'),
  ('newcomer',    '00000000-0000-4000-8000-000000000007'),
  ('mismatch',    '00000000-0000-4000-8000-000000000008'),
  ('nobody',      '00000000-0000-4000-8000-000000000009');
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

create function pg_temp.job_title(n text) returns uuid language sql stable as $$
  select id from public.list_items where list_key = 'job_title' and name = n;
$$;

insert into auth.users (id, email)
select id, key || '@example.com' from fx where key not in ('org', 'nobody');
-- 'mismatch' is an auth user whose email differs from what the invite will claim.

-- Members written as the owner: in_transition() is true, so every status passes the guards.
insert into public.members (id, org_id, full_name, email, phone, role, status, joined_at, deactivated_at) values
  (pg_temp.fx('owner'),       pg_temp.fx('org'), 'Test Owner', 'owner@example.com',       '9000000001', 'owner', 'active',      now(), null),
  (pg_temp.fx('admin'),       pg_temp.fx('org'), 'Test Admin', 'admin@example.com',       '9000000002', 'admin', 'active',      now(), null),
  (pg_temp.fx('staff'),       pg_temp.fx('org'), 'Test Staff', 'staff@example.com',       null,         'staff', 'active',      now(), null),
  (pg_temp.fx('deactivated'), pg_temp.fx('org'), 'Gone Staff', 'deactivated@example.com', null,         'staff', 'deactivated', now(), now()),
  (pg_temp.fx('invited'),     pg_temp.fx('org'), 'New Admin',  'invited@example.com',     null,         'admin', 'invited',     null,  null),
  (pg_temp.fx('never'),       pg_temp.fx('org'), 'Never Came', 'never@example.com',       null,         'staff', 'deactivated', null,  now());
delete from public.activity_log; -- the fixture writes are not under test

-- Structure and grants ----------------------------------------------------------------------
select has_table('public', 'list_items', 'list_items exists');
select has_column('public', 'members', 'job_title_id', 'members.job_title_id exists');
select has_column('public', 'member_directory', 'job_title_id', 'member_directory carries job_title_id');
select ok(not has_table_privilege('anon', 'public.list_items', 'select, insert, update, delete'),
  'anon has no privilege on list_items');
select ok(not has_table_privilege('authenticated', 'public.list_items', 'delete, truncate, references, trigger'),
  'authenticated cannot delete, truncate, reference or add triggers on list_items');
select has_function('public', 'member_invite', array['uuid', 'text', 'text', 'public.member_role', 'uuid'], 'member_invite exists');
select has_function('public', 'member_invite_refresh', array['uuid'], 'member_invite_refresh exists');
select has_function('public', 'member_accept_invite', array[]::text[], 'member_accept_invite exists');
select has_function('public', 'member_deactivate', array['uuid', 'text'], 'member_deactivate exists');
select has_function('public', 'member_reactivate', array['uuid'], 'member_reactivate exists');
select ok(
  not has_function_privilege('anon', 'public.member_invite(uuid, text, text, public.member_role, uuid)', 'execute')
  and not has_function_privilege('anon', 'public.member_invite_refresh(uuid)', 'execute')
  and not has_function_privilege('anon', 'public.member_accept_invite()', 'execute')
  and not has_function_privilege('anon', 'public.member_deactivate(uuid, text)', 'execute')
  and not has_function_privilege('anon', 'public.member_reactivate(uuid)', 'execute'),
  'anon may call none of the team functions');
select ok(
  has_function_privilege('authenticated', 'public.member_invite(uuid, text, text, public.member_role, uuid)', 'execute')
  and has_function_privilege('authenticated', 'public.member_invite_refresh(uuid)', 'execute')
  and has_function_privilege('authenticated', 'public.member_accept_invite()', 'execute')
  and has_function_privilege('authenticated', 'public.member_deactivate(uuid, text)', 'execute')
  and has_function_privilege('authenticated', 'public.member_reactivate(uuid)', 'execute')
  and has_function_privilege('service_role', 'public.member_deactivate(uuid, text)', 'execute'),
  'authenticated and service_role may call the team functions (the functions decide)');

-- Seeds ---------------------------------------------------------------------------------------
select results_eq(
  $$ select name from public.list_items where org_id = pg_temp.fx('org') and list_key = 'job_title' order by position $$,
  $$ values ('Video Editor'), ('Graphic Designer') $$,
  'the launch job titles are seeded for the existing organization (PRODUCT §7)');
savepoint second_org;
insert into public.organizations (id, name) values ('00000000-0000-4000-8000-0000000000aa', 'Another Org');
select is(
  (select count(*) from public.list_items where org_id = '00000000-0000-4000-8000-0000000000aa' and list_key = 'job_title'),
  2::bigint, 'a new organization gets the launch job titles by trigger');
rollback to savepoint second_org;

-- list_items RLS -------------------------------------------------------------------------------
select pg_temp.as_member('owner');
select is((select count(*) from public.list_items), 2::bigint, 'the Owner reads the job titles');
select pg_temp.as_member('admin');
select is((select count(*) from public.list_items), 2::bigint, 'an Admin reads the job titles');
select pg_temp.as_member('staff');
select is((select count(*) from public.list_items), 2::bigint, 'Staff read the job titles (shown on /me and the directory)');
select pg_temp.as_member('deactivated');
select is((select count(*) from public.list_items), 0::bigint, 'a deactivated member reads nothing');
select pg_temp.as_member('invited');
select is((select count(*) from public.list_items), 0::bigint, 'an invited member reads nothing yet');
select pg_temp.as_system();
set local role anon;
select throws_ok($$ select count(*) from public.list_items $$, '42501', null, 'anon cannot read list_items');
select pg_temp.as_system();

select pg_temp.as_member('owner');
select lives_ok(
  $$ insert into public.list_items (list_key, name, position) values ('job_title', 'Colorist', 'a2') $$,
  'the Owner adds a job title (lists.manage)');
select throws_ok(
  $$ insert into public.list_items (list_key, name, position) values ('job_title', ' colorist ', 'a3') $$,
  '23505', null, 'the same name again (case and spaces aside) is refused while the first is active');
select pg_temp.as_member('admin');
select lives_ok(
  $$ insert into public.list_items (list_key, name, position) values ('job_title', 'Motion Designer', 'a3') $$,
  'an Admin adds a job title (lists.manage, PERMISSIONS §1)');
select pg_temp.as_member('staff');
select throws_ok(
  $$ insert into public.list_items (list_key, name, position) values ('job_title', 'Intern', 'a4') $$,
  '42501', null, 'Staff cannot add a job title');
update public.list_items set name = 'Hacked' where name = 'Colorist';
select pg_temp.as_system();
select is((select count(*) from public.list_items where name = 'Hacked'), 0::bigint,
  'Staff cannot edit a job title (the row is invisible to their UPDATE)');
select pg_temp.as_member('owner');
select lives_ok(
  $$ update public.list_items set archived_at = now() where name = 'Motion Designer' $$,
  'the Owner archives a job title');
select throws_ok(
  $$ delete from public.list_items where name = 'Motion Designer' $$,
  '42501', null, 'nobody deletes a list item through the API (archive instead)');
select pg_temp.as_member('admin');
select lives_ok(
  $$ update public.list_items set archived_at = now() where name = 'Colorist' $$,
  'an Admin archives a job title too (lists.manage)');
select pg_temp.as_system();
select is((select count(*) from public.list_items where archived_at is not null), 2::bigint,
  'both archives took effect');
select is(
  (select count(*) from public.activity_log where entity = 'list_items' and action = 'insert'),
  2::bigint, 'both inserts were audited');
select results_eq(
  $$ select actor_id from public.activity_log where entity = 'list_items' and action = 'update' order by id $$,
  $$ values (pg_temp.fx('owner')), (pg_temp.fx('admin')) $$,
  'each archive was audited with its actor');

-- members.job_title_id ------------------------------------------------------------------------
select pg_temp.as_member('owner');
select lives_ok(
  format($$ update public.members set job_title_id = %L where id = %L $$,
    pg_temp.job_title('Video Editor'), pg_temp.fx('staff')),
  'the Owner sets a job title on a member (team.manage)');
select throws_ok(
  format($$ update public.members set job_title_id = %L where id = %L $$,
    pg_temp.job_title('Motion Designer'), pg_temp.fx('staff')),
  'P0001', 'VALIDATION', 'an archived job title cannot be assigned');
select throws_ok(
  format($$ update public.members set job_title_id = %L where id = %L $$,
    '00000000-0000-4000-8000-0000000000ff', pg_temp.fx('staff')),
  'P0001', 'VALIDATION', 'an unknown job title cannot be assigned');
select pg_temp.as_member('staff');
select throws_ok(
  format($$ update public.members set job_title_id = %L where id = %L $$,
    pg_temp.job_title('Graphic Designer'), pg_temp.fx('staff')),
  'P0001', 'FORBIDDEN', 'a member cannot change their own job title (PERMISSIONS §3)');
select pg_temp.as_member('admin');
select is(
  (select job_title_id from public.member_directory where id = pg_temp.fx('staff')),
  pg_temp.job_title('Video Editor'), 'an Admin sees the job title through member_directory');
update public.members set job_title_id = pg_temp.job_title('Graphic Designer'), role = 'admin'
  where id = pg_temp.fx('staff');
select pg_temp.as_system();
select results_eq(
  $$ select job_title_id, role::text from public.members where id = pg_temp.fx('staff') $$,
  $$ select pg_temp.job_title('Video Editor'), 'staff' $$,
  'an Admin cannot change another member''s job title or role (the row is invisible to their UPDATE)');
select pg_temp.as_member('staff');
select results_eq(
  $$ select id from public.member_directory $$,
  $$ values (pg_temp.fx('staff')) $$,
  'Staff still see only their own row in the recreated member_directory');
select pg_temp.as_system();

-- member_invite ---------------------------------------------------------------------------------
select pg_temp.as_member('owner');
select is(
  public.member_invite(pg_temp.fx('newcomer'), 'Newcomer@Example.com ', ' New Person ', 'staff', pg_temp.job_title('Graphic Designer')),
  pg_temp.fx('newcomer'), 'the Owner invites a new person');
select results_eq(
  $$ select full_name, email, role::text, status::text, joined_at, job_title_id
     from public.members where id = pg_temp.fx('newcomer') $$,
  $$ select 'New Person', 'newcomer@example.com', 'staff', 'invited', null::timestamptz, pg_temp.job_title('Graphic Designer') $$,
  'the row is invited, trimmed and lower-cased, with the job title');
select pg_temp.as_system();
select results_eq(
  $$ select action, actor_id from public.activity_log where entity = 'members' and entity_id = pg_temp.fx('newcomer') $$,
  $$ values ('invited', pg_temp.fx('owner')) $$,
  'one audit row, action invited, by the Owner (no generic insert row)');
select pg_temp.as_member('owner');
select throws_ok(
  $$ select public.member_invite(pg_temp.fx('staff'), 'staff@example.com', 'Again', 'staff', null) $$,
  'P0001', 'CONFLICT', 'someone already on the team cannot be invited again');
select throws_ok(
  $$ select public.member_invite(pg_temp.fx('mismatch'), 'other@example.com', 'Other', 'staff', null) $$,
  'P0001', 'VALIDATION', 'the email must be the auth user''s');
select throws_ok(
  $$ select public.member_invite(pg_temp.fx('mismatch'), 'mismatch@example.com', 'Other', 'owner', null) $$,
  'P0001', 'VALIDATION', 'nobody is invited as Owner');
select throws_ok(
  $$ select public.member_invite(pg_temp.fx('mismatch'), 'mismatch@example.com', '   ', 'staff', null) $$,
  'P0001', 'VALIDATION', 'a name is required');
select throws_ok(
  $$ select public.member_invite(pg_temp.fx('nobody'), 'nobody@example.com', 'Nobody', 'staff', null) $$,
  'P0001', 'NOT_FOUND', 'the auth user must exist first');
select throws_ok(
  format($$ select public.member_invite(pg_temp.fx('mismatch'), 'mismatch@example.com', 'Other', 'staff', %L) $$,
    pg_temp.job_title('Motion Designer')),
  'P0001', 'VALIDATION', 'an archived job title is refused on invite too');
select pg_temp.as_member('admin');
select throws_ok(
  $$ select public.member_invite(pg_temp.fx('mismatch'), 'mismatch@example.com', 'Other', 'staff', null) $$,
  'P0001', 'FORBIDDEN', 'an Admin cannot invite');
select pg_temp.as_member('staff');
select throws_ok(
  $$ select public.member_invite(pg_temp.fx('mismatch'), 'mismatch@example.com', 'Other', 'staff', null) $$,
  'P0001', 'FORBIDDEN', 'Staff cannot invite');
select pg_temp.as_member('invited');
select throws_ok(
  $$ select public.member_invite(pg_temp.fx('mismatch'), 'mismatch@example.com', 'Other', 'staff', null) $$,
  'P0001', 'UNAUTHENTICATED', 'an invited member cannot invite');
select pg_temp.as_system();
set local role anon;
select throws_ok(
  $$ select public.member_invite(pg_temp.fx('mismatch'), 'mismatch@example.com', 'Other', 'staff', null) $$,
  '42501', null, 'anon cannot call member_invite');
select pg_temp.as_system();

-- member_invite_refresh -------------------------------------------------------------------------
update public.members set invited_at = now() - interval '2 days' where id = pg_temp.fx('newcomer');
select pg_temp.as_member('owner');
select is(public.member_invite_refresh(pg_temp.fx('newcomer')), pg_temp.fx('newcomer'),
  'the Owner refreshes a pending invite');
select ok(
  (select invited_at > now() - interval '1 minute' from public.members where id = pg_temp.fx('newcomer')),
  'invited_at moves to now');
select pg_temp.as_system();
select is(
  (select count(*) from public.activity_log
    where entity = 'members' and entity_id = pg_temp.fx('newcomer') and action = 'invite_link_issued'
      and actor_id = pg_temp.fx('owner')),
  1::bigint, 'issuing a link is audited');
select pg_temp.as_member('owner');
select throws_ok($$ select public.member_invite_refresh(pg_temp.fx('staff')) $$,
  'P0001', 'INVALID_STATE', 'an active member has no invite to refresh');
select throws_ok($$ select public.member_invite_refresh(pg_temp.fx('nobody')) $$,
  'P0001', 'NOT_FOUND', 'an unknown id is not found');
select throws_ok($$ select public.member_invite_refresh(pg_temp.fx('deactivated')) $$,
  'P0001', 'INVALID_STATE', 'a deactivated person has no invite to refresh (reactivate first)');
select pg_temp.as_member('admin');
select throws_ok($$ select public.member_invite_refresh(pg_temp.fx('newcomer')) $$,
  'P0001', 'FORBIDDEN', 'an Admin cannot refresh an invite');
select pg_temp.as_system();

-- member_self_status ------------------------------------------------------------------------------
select pg_temp.as_member('invited');
select is(public.member_self_status(), 'invited'::public.member_status,
  'an invited person reads their own status (RLS would show them nothing)');
select pg_temp.as_member('deactivated');
select is(public.member_self_status(), 'deactivated'::public.member_status,
  'a deactivated person reads their own status');
select pg_temp.as_member('staff');
select is(public.member_self_status(), 'active'::public.member_status, 'an active member reads active');
select pg_temp.as_member('nobody');
select is(public.member_self_status(), null, 'an auth user with no member row gets null');
select pg_temp.as_system();
set local role anon;
select throws_ok($$ select public.member_self_status() $$, '42501', null, 'anon cannot call member_self_status');
select pg_temp.as_system();
select ok(not has_function_privilege('anon', 'public.member_self_status()', 'execute')
  and has_function_privilege('authenticated', 'public.member_self_status()', 'execute'),
  'member_self_status is granted to authenticated only');

-- member_accept_invite ---------------------------------------------------------------------------
select pg_temp.as_member('invited');
select is(public.member_accept_invite(), pg_temp.fx('invited'), 'an invited person accepts');
select ok(
  (select status = 'active' and joined_at is not null from public.members where id = pg_temp.fx('invited')),
  'they are active with joined_at set');
select isnt(public.session_login('UA', null), null, 'and can record a login right away');
select throws_ok($$ select public.member_accept_invite() $$,
  'P0001', 'INVALID_STATE', 'accepting twice is refused');
select pg_temp.as_system();
select is(
  (select count(*) from public.activity_log
    where entity = 'members' and entity_id = pg_temp.fx('invited') and action = 'accepted'
      and actor_id = pg_temp.fx('invited')),
  1::bigint, 'accepting is audited by the person themselves');
select pg_temp.as_member('deactivated');
select throws_ok($$ select public.member_accept_invite() $$,
  'P0001', 'FORBIDDEN', 'a deactivated person cannot accept');
select pg_temp.as_member('nobody');
select throws_ok($$ select public.member_accept_invite() $$,
  'P0001', 'UNAUTHENTICATED', 'an auth user with no member row cannot accept');
select pg_temp.as_system();
set local role anon;
select throws_ok($$ select public.member_accept_invite() $$, '42501', null, 'anon cannot call member_accept_invite');
select pg_temp.as_system();

-- member_deactivate -------------------------------------------------------------------------------
-- Live auth sessions for Staff (two devices) and the Admin, the way GoTrue stores them.
insert into auth.sessions (id, user_id, created_at, updated_at) values
  ('00000000-0000-4000-8000-0000000000b1', pg_temp.fx('staff'), now(), now()),
  ('00000000-0000-4000-8000-0000000000b2', pg_temp.fx('staff'), now(), now()),
  ('00000000-0000-4000-8000-0000000000b3', pg_temp.fx('admin'), now(), now());
insert into auth.refresh_tokens (instance_id, token, user_id, revoked, created_at, updated_at, session_id) values
  ('00000000-0000-0000-0000-000000000000', 'tok-staff-1', pg_temp.fx('staff')::text, false, now(), now(), '00000000-0000-4000-8000-0000000000b1'),
  ('00000000-0000-0000-0000-000000000000', 'tok-staff-2', pg_temp.fx('staff')::text, false, now(), now(), '00000000-0000-4000-8000-0000000000b2'),
  ('00000000-0000-0000-0000-000000000000', 'tok-admin-1', pg_temp.fx('admin')::text, false, now(), now(), '00000000-0000-4000-8000-0000000000b3');

select pg_temp.as_member('owner');
select is(public.member_deactivate(pg_temp.fx('staff'), '  Left the company  '), 'deactivated',
  'the Owner deactivates an active member with a reason');
select ok(
  (select status = 'deactivated' and deactivated_at is not null and joined_at is not null
     from public.members where id = pg_temp.fx('staff')),
  'the row is deactivated, keeping joined_at');
select pg_temp.as_system();
select results_eq(
  $$ select action, actor_id, meta from public.activity_log
     where entity = 'members' and entity_id = pg_temp.fx('staff') order by id desc limit 1 $$,
  $$ select 'deactivated', pg_temp.fx('owner'), '{"reason": "Left the company", "from_status": "active"}'::jsonb $$,
  'the audit row names the action, the Owner and the trimmed reason');
select is((select count(*) from auth.sessions where user_id = pg_temp.fx('staff')), 0::bigint,
  'every auth session of the deactivated person is gone');
select is((select count(*) from auth.refresh_tokens where user_id = pg_temp.fx('staff')::text), 0::bigint,
  'every refresh token of the deactivated person is gone');
select is((select count(*) from auth.sessions where user_id = pg_temp.fx('admin')), 1::bigint,
  'other people''s sessions are untouched');
select is((select count(*) from auth.refresh_tokens where user_id = pg_temp.fx('admin')::text), 1::bigint,
  'other people''s refresh tokens are untouched');
select pg_temp.as_member('staff');
select is((select count(*) from app.current_member()), 0::bigint,
  'the deactivated person has no current member row (RLS closes at once)');
select pg_temp.as_member('owner');
select throws_ok($$ select public.member_deactivate(pg_temp.fx('staff'), null) $$,
  'P0001', 'INVALID_STATE', 'deactivating twice is refused');
select throws_ok($$ select public.member_deactivate(pg_temp.fx('owner'), null) $$,
  'P0001', 'FORBIDDEN', 'the Owner cannot deactivate themselves');
select is(public.member_deactivate(pg_temp.fx('newcomer'), null), 'deactivated',
  'a pending invite is revoked through the same transition');
select pg_temp.as_system();
select is(
  (select meta from public.activity_log
     where entity = 'members' and entity_id = pg_temp.fx('newcomer') order by id desc limit 1),
  '{"reason": null, "from_status": "invited"}'::jsonb,
  'the audit row records that it was an invite, with no reason');
select pg_temp.as_member('owner');
select throws_ok(
  format($$ select public.member_deactivate(pg_temp.fx('admin'), %L) $$, repeat('x', 1001)),
  'P0001', 'VALIDATION', 'an overlong reason is refused before anything changes');
select throws_ok($$ select public.member_deactivate(pg_temp.fx('nobody'), null) $$,
  'P0001', 'NOT_FOUND', 'an unknown id is not found');
select pg_temp.as_member('admin');
select throws_ok($$ select public.member_deactivate(pg_temp.fx('staff'), null) $$,
  'P0001', 'FORBIDDEN', 'an Admin cannot deactivate');
select pg_temp.as_system();
set local role anon;
select throws_ok($$ select public.member_deactivate(pg_temp.fx('staff'), null) $$, '42501', null,
  'anon cannot call member_deactivate');
select pg_temp.as_system();

-- member_reactivate -------------------------------------------------------------------------------
select pg_temp.as_member('owner');
select is(public.member_reactivate(pg_temp.fx('staff')), 'active',
  'someone who had joined comes back active');
select ok(
  (select status = 'active' and deactivated_at is null and joined_at is not null
     from public.members where id = pg_temp.fx('staff')),
  'deactivated_at is cleared and joined_at kept');
select is(public.member_reactivate(pg_temp.fx('never')), 'invited',
  'someone who never accepted goes back to invited');
select throws_ok($$ select public.member_reactivate(pg_temp.fx('admin')) $$,
  'P0001', 'INVALID_STATE', 'an active member cannot be reactivated');
select throws_ok($$ select public.member_reactivate(pg_temp.fx('nobody')) $$,
  'P0001', 'NOT_FOUND', 'an unknown id is not found');
select pg_temp.as_system();
select results_eq(
  $$ select entity_id, meta ->> 'to_status' from public.activity_log
     where entity = 'members' and action = 'reactivated' order by at $$,
  $$ values (pg_temp.fx('staff'), 'active'), (pg_temp.fx('never'), 'invited') $$,
  'both reactivations are audited with the resulting status');
select pg_temp.as_member('admin');
select throws_ok($$ select public.member_reactivate(pg_temp.fx('deactivated')) $$,
  'P0001', 'FORBIDDEN', 'an Admin cannot reactivate');
select pg_temp.as_member('staff');
select isnt(public.session_login('UA', null), null, 'the reactivated member can sign in again');

-- The override never leaks: a plain edit after a transition is a plain 'update' row.
select pg_temp.as_member('owner');
update public.members set full_name = 'Test Staff Renamed' where id = pg_temp.fx('staff');
select pg_temp.as_system();
select is(
  (select action from public.activity_log
     where entity = 'members' and entity_id = pg_temp.fx('staff') order by at desc, id desc limit 1),
  'update', 'a plain edit after a transition is audited as a plain update');

select * from finish();
rollback;
