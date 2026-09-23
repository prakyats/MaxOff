-- 1.4 Settings: the holidays table for every role, the company and threshold settings only the
-- Owner may write, app.is_working_day(), and member_change_email() on every path.
begin;
create extension if not exists pgtap with schema extensions;
select plan(63);

-- The local seed holds an organization (with its org_settings and job titles) and five sign-ins.
-- Keep the organization; replace the people with fixtures. Rolled back at the end.
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

insert into auth.users (id, email)
select id, key || '@example.com' from fx where key not in ('org', 'nobody');

-- Members written as the owner: in_transition() is true, so every status passes the guards.
insert into public.members (id, org_id, full_name, email, role, status, joined_at, deactivated_at) values
  (pg_temp.fx('owner'),       pg_temp.fx('org'), 'Test Owner', 'owner@example.com',       'owner', 'active',      now(), null),
  (pg_temp.fx('admin'),       pg_temp.fx('org'), 'Test Admin', 'admin@example.com',       'admin', 'active',      now(), null),
  (pg_temp.fx('staff'),       pg_temp.fx('org'), 'Test Staff', 'staff@example.com',       'staff', 'active',      now(), null),
  (pg_temp.fx('deactivated'), pg_temp.fx('org'), 'Gone Staff', 'deactivated@example.com', 'staff', 'deactivated', now(), now()),
  (pg_temp.fx('invited'),     pg_temp.fx('org'), 'New Admin',  'invited@example.com',     'admin', 'invited',     null,  null);
delete from public.activity_log; -- the fixture writes are not under test

-- Structure and grants -------------------------------------------------------------------------
select has_table('public', 'holidays', 'holidays exists');
select ok(not has_table_privilege('anon', 'public.holidays', 'select, insert, update, delete'),
  'anon has no privilege on holidays');
select ok(not has_table_privilege('authenticated', 'public.holidays', 'truncate, references, trigger'),
  'authenticated cannot truncate, reference or add triggers on holidays');
select ok(has_table_privilege('authenticated', 'public.holidays', 'delete'),
  'holidays keeps a real DELETE for the API role: it has no archived_at (DATA-MODEL §1)');
select has_function('app', 'is_working_day', array['date'], 'app.is_working_day exists');
select has_function('public', 'member_change_email', array['uuid', 'text'], 'member_change_email exists');
select ok(
  not has_function_privilege('anon', 'app.is_working_day(date)', 'execute')
  and not has_function_privilege('anon', 'public.member_change_email(uuid, text)', 'execute'),
  'anon may call neither of the new functions');
select ok(
  has_function_privilege('authenticated', 'app.is_working_day(date)', 'execute')
  and has_function_privilege('service_role', 'app.is_working_day(date)', 'execute')
  and has_function_privilege('authenticated', 'public.member_change_email(uuid, text)', 'execute')
  and has_function_privilege('service_role', 'public.member_change_email(uuid, text)', 'execute'),
  'authenticated and service_role may call them (the functions decide)');

-- holidays RLS ---------------------------------------------------------------------------------
select pg_temp.as_member('owner');
select lives_ok(
  $$ insert into public.holidays (date, name) values ('2026-10-02', 'Gandhi Jayanti') $$,
  'the Owner adds a holiday (settings.manage)');
select is((select org_id from public.holidays where date = '2026-10-02'), pg_temp.fx('org'),
  'org_id defaults to the caller''s organization');
select throws_ok(
  $$ insert into public.holidays (date, name) values ('2026-10-02', 'Duplicate') $$,
  '23505', null, 'the same date twice is refused');
select throws_ok(
  $$ insert into public.holidays (date, name) values ('2026-10-03', '   ') $$,
  '23514', null, 'a blank name is refused');

select pg_temp.as_member('admin');
select throws_ok(
  $$ insert into public.holidays (date, name) values ('2026-12-25', 'Christmas') $$,
  '42501', null, 'an Admin cannot add a holiday (lists.manage is not settings.manage)');
select pg_temp.as_member('staff');
select throws_ok(
  $$ insert into public.holidays (date, name) values ('2026-12-25', 'Christmas') $$,
  '42501', null, 'Staff cannot add a holiday');

select pg_temp.as_member('owner');
select is((select count(*) from public.holidays), 1::bigint, 'the Owner reads the holidays');
select pg_temp.as_member('admin');
select is((select count(*) from public.holidays), 1::bigint, 'an Admin reads them (it is everyone''s calendar)');
select pg_temp.as_member('staff');
select is((select count(*) from public.holidays), 1::bigint, 'Staff read them');
select pg_temp.as_member('deactivated');
select is((select count(*) from public.holidays), 0::bigint, 'a deactivated member reads nothing');
select pg_temp.as_member('invited');
select is((select count(*) from public.holidays), 0::bigint, 'an invited member reads nothing yet');
select pg_temp.as_system();
set local role anon;
select throws_ok($$ select count(*) from public.holidays $$, '42501', null, 'anon cannot read holidays');
select pg_temp.as_system();

select pg_temp.as_member('admin');
update public.holidays set name = 'Renamed by an Admin' where date = '2026-10-02';
delete from public.holidays where date = '2026-10-02';
select pg_temp.as_member('staff');
update public.holidays set name = 'Renamed by Staff' where date = '2026-10-02';
delete from public.holidays where date = '2026-10-02';
select pg_temp.as_system();
select is((select name from public.holidays where date = '2026-10-02'), 'Gandhi Jayanti',
  'neither an Admin nor Staff can rename or delete a holiday (the row is invisible to their write)');

select pg_temp.as_member('owner');
select lives_ok(
  $$ update public.holidays set name = 'Gandhi Jayanti (national)' where date = '2026-10-02' $$,
  'the Owner renames a holiday');
select pg_temp.as_system();
select results_eq(
  $$ select action, actor_id from public.activity_log
     where entity = 'holidays' order by id $$,
  $$ values ('insert', pg_temp.fx('owner')), ('update', pg_temp.fx('owner')) $$,
  'adding and renaming a holiday are audited with the Owner as actor');

-- Company and thresholds (organizations + org_settings, the 1.1 policies) ----------------------
select pg_temp.as_member('owner');
select lives_ok(
  $$ update public.organizations set name = 'Pixora Clips Pvt Ltd' where id = pg_temp.fx('org') $$,
  'the Owner renames the company');
select lives_ok(
  $$ update public.org_settings
       set weekly_off_days = array[0, 6]::smallint[], logout_reminder_time = '21:00',
           ack_repeat_hours = 3, ack_escalate_hours = 5, ack_escalate_owner_hours = 9,
           overdue_escalate_hours = 20, email_daily_cap_per_member = 30
     where org_id = pg_temp.fx('org') $$,
  'the Owner edits the weekly off days and every threshold');
select throws_ok(
  $$ update public.org_settings set ack_repeat_hours = 0 where org_id = pg_temp.fx('org') $$,
  '23514', null, 'a threshold of zero hours is refused by the table''s own check');
select throws_ok(
  $$ update public.org_settings set weekly_off_days = array[7]::smallint[] where org_id = pg_temp.fx('org') $$,
  '23514', null, 'a weekday outside 0..6 is refused');

select pg_temp.as_member('admin');
update public.organizations set name = 'Renamed by an Admin' where id = pg_temp.fx('org');
update public.org_settings set email_daily_cap_per_member = 999 where org_id = pg_temp.fx('org');
select pg_temp.as_member('staff');
update public.org_settings set email_daily_cap_per_member = 999 where org_id = pg_temp.fx('org');
select pg_temp.as_system();
select is((select name from public.organizations where id = pg_temp.fx('org')), 'Pixora Clips Pvt Ltd',
  'an Admin cannot rename the company');
select is((select email_daily_cap_per_member from public.org_settings where org_id = pg_temp.fx('org')), 30,
  'neither an Admin nor Staff can move a threshold (settings.manage only)');
select pg_temp.as_member('staff');
select is((select count(*) from public.org_settings), 1::bigint,
  'every active member reads the settings (the thresholds drive their own reminders)');
select pg_temp.as_system();
set local role anon;
select throws_ok($$ select count(*) from public.org_settings $$, '42501', null,
  'anon cannot read the settings');
select pg_temp.as_system();

-- app.is_working_day() -------------------------------------------------------------------------
-- Sunday and Saturday are off (set above), and 2 October is a holiday.
select is(app.is_working_day(null), null, 'null in, null out');
select is(app.is_working_day('2026-09-21'), true, 'a Monday is a working day');
select is(app.is_working_day('2026-09-20'), false, 'a Sunday is a weekly off day');
select is(app.is_working_day('2026-09-26'), false, 'a Saturday is off once it is in weekly_off_days');
select is(app.is_working_day('2026-10-02'), false, 'a holiday is not a working day');
select pg_temp.as_member('staff');
select is(app.is_working_day('2026-10-02'), false,
  'a Staff member gets the same answer (they read holidays under RLS anyway)');
select pg_temp.as_member('deactivated');
select is(app.is_working_day('2026-10-02'), false,
  'security definer: the answer does not depend on the caller''s RLS view');
select pg_temp.as_system();
set local role service_role;
select is(app.is_working_day('2026-10-02'), false,
  'a job on the service role gets the same answer (no member row, single organization)');
select pg_temp.as_system();
update public.org_settings set weekly_off_days = array[0]::smallint[] where org_id = pg_temp.fx('org');
select is(app.is_working_day('2026-09-26'), true, 'putting Saturday back makes it a working day again');
select pg_temp.as_member('owner');
select lives_ok($$ delete from public.holidays where date = '2026-10-02' $$,
  'the Owner removes a holiday (settings.manage), the one real DELETE in the configuration tables');
select pg_temp.as_system();
select is((select count(*) from public.holidays where date = '2026-10-02'), 0::bigint,
  'the row is gone');
select is(app.is_working_day('2026-10-02'), true, 'deleting the holiday makes the date ordinary again');
select is(
  (select action from public.activity_log where entity = 'holidays' order by id desc limit 1),
  'delete', 'the removed holiday is kept in the activity log');

-- member_change_email() ------------------------------------------------------------------------
-- The action moves the sign-in first; these tests do the same before calling the function.
select pg_temp.as_member('owner');
select throws_ok(
  $$ select public.member_change_email(pg_temp.fx('staff'), 'moved@example.com') $$,
  'P0001', 'CONFLICT', 'the function refuses while the sign-in still carries the old address');
select pg_temp.as_system();
update auth.users set email = 'moved@example.com' where id = pg_temp.fx('staff');
select pg_temp.as_member('owner');
select is(public.member_change_email(pg_temp.fx('staff'), '  Moved@Example.com  '), 'moved@example.com',
  'the Owner moves an active member to a trimmed, lower-cased address');
select is((select email from public.members where id = pg_temp.fx('staff')), 'moved@example.com',
  'the member row carries the new address');
select pg_temp.as_system();
select results_eq(
  $$ select action, actor_id, meta from public.activity_log
     where entity = 'members' and entity_id = pg_temp.fx('staff') order by id desc limit 1 $$,
  $$ select 'email_changed', pg_temp.fx('owner'),
     '{"from": "staff@example.com", "to": "moved@example.com"}'::jsonb $$,
  'the audit row names the action, the Owner and both addresses');

select pg_temp.as_member('owner');
select throws_ok(
  $$ select public.member_change_email(pg_temp.fx('staff'), 'moved@example.com') $$,
  'P0001', 'VALIDATION', 'the same address again is refused');
select throws_ok(
  $$ select public.member_change_email(pg_temp.fx('staff'), 'not-an-email') $$,
  'P0001', 'VALIDATION', 'a malformed address is refused');
select throws_ok(
  $$ select public.member_change_email(pg_temp.fx('staff'), 'admin@example.com') $$,
  'P0001', 'CONFLICT', 'an address another member signs in with is refused');
select throws_ok(
  $$ select public.member_change_email(pg_temp.fx('nobody'), 'someone@example.com') $$,
  'P0001', 'NOT_FOUND', 'an unknown id is not found');
select throws_ok(
  $$ select public.member_change_email(pg_temp.fx('deactivated'), 'back@example.com') $$,
  'P0001', 'INVALID_STATE', 'a deactivated person is reactivated first');

select pg_temp.as_system();
update auth.users set email = 'fixed-typo@example.com' where id = pg_temp.fx('invited');
select pg_temp.as_member('owner');
select is(public.member_change_email(pg_temp.fx('invited'), 'fixed-typo@example.com'), 'fixed-typo@example.com',
  'an invite that went to a typo is corrected (WORKFLOWS §1a)');
select ok((select status from public.members where id = pg_temp.fx('invited')) = 'invited',
  'the invited status is untouched');

select pg_temp.as_system();
update auth.users set email = 'owner-new@example.com' where id = pg_temp.fx('owner');
select pg_temp.as_member('owner');
select is(public.member_change_email(pg_temp.fx('owner'), 'owner-new@example.com'), 'owner-new@example.com',
  'the Owner may move their own sign-in');

select pg_temp.as_system();
insert into auth.sessions (id, user_id, created_at, updated_at) values
  ('00000000-0000-4000-8000-0000000000c1', pg_temp.fx('staff'), now(), now());
update auth.users set email = 'moved-again@example.com' where id = pg_temp.fx('staff');
select pg_temp.as_member('owner');
select lives_ok(
  $$ select public.member_change_email(pg_temp.fx('staff'), 'moved-again@example.com') $$,
  'a second move is fine');
select pg_temp.as_system();
select is((select count(*) from auth.sessions where user_id = pg_temp.fx('staff')), 1::bigint,
  'sessions are left alive: an email change is not a deactivation');

select pg_temp.as_member('admin');
select throws_ok(
  $$ select public.member_change_email(pg_temp.fx('staff'), 'nope@example.com') $$,
  'P0001', 'FORBIDDEN', 'an Admin cannot change anyone''s email');
select pg_temp.as_member('staff');
select throws_ok(
  $$ select public.member_change_email(pg_temp.fx('staff'), 'nope@example.com') $$,
  'P0001', 'FORBIDDEN', 'a member cannot change their own email either (PERMISSIONS §3)');
select pg_temp.as_member('deactivated');
select throws_ok(
  $$ select public.member_change_email(pg_temp.fx('staff'), 'nope@example.com') $$,
  'P0001', 'UNAUTHENTICATED', 'a deactivated caller is not a member at all');
select pg_temp.as_system();
set local role anon;
select throws_ok(
  $$ select public.member_change_email(pg_temp.fx('staff'), 'nope@example.com') $$,
  '42501', null, 'anon cannot call member_change_email');
select pg_temp.as_system();

-- The column itself stays closed, so there is no way round the function.
select pg_temp.as_member('owner');
select throws_ok(
  $$ update public.members set email = 'direct@example.com' where id = pg_temp.fx('staff') $$,
  '42501', null,
  'even the Owner cannot write members.email directly (no column grant, plus protect_columns)');
select pg_temp.as_system();

select * from finish();
rollback;
