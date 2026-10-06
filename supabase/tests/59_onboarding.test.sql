-- 5B 5.5 (migration onboarding_reachability; owner decisions 2026-10-03, PROGRESS "Slice 9").
-- (1) member_onboarding: RLS on, read only, own row. (2) A new joiner gets a row at their first login
-- (member_accept_invite, behaviour kept); a member who joined before never does. (3) Reads per role:
-- own row only. (4) onboarding_finish: 'later', 'test' only after a delivered push, once, audited;
-- a member with no row, an unknown way, anon. (5) push_subscription_remove_own at every role: own
-- allowed; another member's refused for the Owner, an Admin and Staff; anon refused; not audited.
-- (6) The band (app.push_band, push_status_own): no device → band; on but nothing received →
-- band; a delivered device → no band; failing → band again; revoked and iPhone reasons; own only.
begin;
create extension if not exists pgtap with schema extensions;
select plan(61);

delete from public.task_requests;
delete from public.task_warnings;
delete from public.task_reviews;
delete from public.task_submissions;
delete from public.task_comments;
delete from public.task_stages;
delete from public.task_assignees;
delete from public.task_reminders;
delete from public.task_reminder_arms;
delete from public.tasks;
delete from public.task_templates;
delete from public.member_coordinators;
delete from public.attendance_events;
delete from public.attendance_days;
delete from public.expense_claims;
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
delete from public.client_close_reasons;
delete from public.clients;
update public.organizations set logo_file_id = null;
delete from public.files;
delete from public.notification_deliveries;
delete from public.notifications;
delete from public.push_subscriptions;
delete from public.member_app_reports;
delete from public.member_reachability;
delete from public.member_onboarding;
delete from public.members;
delete from auth.identities;
delete from auth.users;
delete from public.activity_log;
delete from public.holidays;

create temporary table fx (key text primary key, id uuid not null);
insert into fx values
  ('owner',  '00000000-0000-4000-8000-000000005901'),
  ('admin',  '00000000-0000-4000-8000-000000005902'),
  ('staff',  '00000000-0000-4000-8000-000000005903'),
  ('joiner', '00000000-0000-4000-8000-000000005904'),
  ('second', '00000000-0000-4000-8000-000000005905'),
  ('iphone', '00000000-0000-4000-8000-000000005906');
insert into fx select 'org', id from public.organizations limit 1;
grant all on fx to authenticated, anon, service_role;
create function pg_temp.fx(k text) returns uuid language sql stable as $$ select id from fx where key = k; $$;
create function pg_temp.as_member(k text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', pg_temp.fx(k)::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', pg_temp.fx(k), 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end;
$$;
create function pg_temp.as_anon() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  perform set_config('role', 'anon', true);
end;
$$;
create function pg_temp.as_system() returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', '', true);
end;
$$;
create function pg_temp.sub(k text, endpoint text, failures integer default 0, reason text default null,
                            success timestamptz default null, platform text default 'android')
returns uuid language sql as $$
  insert into public.push_subscriptions (member_id, endpoint, p256dh, auth, platform, failure_count,
                                         disabled_at, disabled_reason, last_success_at)
  values (pg_temp.fx(k), 'https://push.example/' || endpoint, 'k', 'a', platform, failures,
          case when reason is not null then now() end, reason, success)
  returning id;
$$;
create function pg_temp.band(k text) returns text language sql stable as $$ select app.push_band(pg_temp.fx(k)); $$;

-- The Owner, an Admin and Staff joined before 5.5; the joiner, the second joiner and the iPhone joiner
-- are invited.
insert into auth.users (id, email) select id, key || '@example.com' from fx where key <> 'org';
insert into public.members (id, org_id, full_name, email, role, status, joined_at)
select pg_temp.fx(k), pg_temp.fx('org'), initcap(k), k || '@example.com', r::public.member_role, 'active',
       now() - interval '2 days'
from (values ('owner', 'owner'), ('admin', 'admin'), ('staff', 'staff')) as v(k, r);
insert into public.members (id, org_id, full_name, email, role, status, invited_at)
select pg_temp.fx(k), pg_temp.fx('org'), initcap(k), k || '@example.com', r::public.member_role, 'invited', now()
from (values ('joiner', 'staff'), ('second', 'admin'), ('iphone', 'staff')) as v(k, r);

-- 1. The table ------------------------------------------------------------------------------------------
select ok((select relrowsecurity from pg_class where oid = 'public.member_onboarding'::regclass), 'RLS is on');
select ok(has_table_privilege('authenticated', 'public.member_onboarding', 'select')
          and not has_table_privilege('authenticated', 'public.member_onboarding', 'insert')
          and not has_table_privilege('authenticated', 'public.member_onboarding', 'update')
          and not has_table_privilege('authenticated', 'public.member_onboarding', 'delete'),
  'the API role reads, never writes');
select ok(not has_table_privilege('anon', 'public.member_onboarding', 'select'), 'anon holds nothing');

-- 2. The first login ------------------------------------------------------------------------------------
select is((select count(*) from public.member_onboarding), 0::bigint, 'members who joined before have no walkthrough');
select pg_temp.as_member('joiner');
select is(public.member_accept_invite(), pg_temp.fx('joiner'), 'the new joiner accepts their invite');
select pg_temp.as_system();
select is((select (status, joined_at is not null)::text from public.members where id = pg_temp.fx('joiner')),
  '(active,t)', 'the accept still makes them active with joined_at');
select is((select (started_at is not null, finished_at, finished_via, org_id)::text from public.member_onboarding
           where member_id = pg_temp.fx('joiner')),
  (true, null::timestamptz, null::text, pg_temp.fx('org'))::text, 'and starts their walkthrough, unfinished');
select is((select count(*) from public.activity_log
           where entity = 'members' and entity_id = pg_temp.fx('joiner') and action = 'accepted'),
  1::bigint, 'the accept is still audited as accepted');
select is((select action from public.activity_log where entity = 'member_onboarding' and entity_id = pg_temp.fx('joiner')),
  'insert', 'the walkthrough row is audited as its own insert');
select pg_temp.as_member('joiner');
select throws_ok($$ select public.member_accept_invite() $$, 'P0001', 'INVALID_STATE', 'a second accept is still refused');
select pg_temp.as_member('second');
select public.member_accept_invite();
select pg_temp.as_member('iphone');
select public.member_accept_invite();
select pg_temp.as_system();
select is((select count(*) from public.member_onboarding), 3::bigint, 'one row per new joiner');
select is((select count(*) from public.member_onboarding
           where member_id in (pg_temp.fx('owner'), pg_temp.fx('admin'), pg_temp.fx('staff'))),
  0::bigint, 'never for the Owner, Admin or Staff who joined before');

-- 3. Reads: own row only --------------------------------------------------------------------------------
select pg_temp.as_member('joiner');
select is((select array_agg(member_id) from public.member_onboarding), array[pg_temp.fx('joiner')],
  'Staff (a new joiner) reads their own row only');
select throws_ok($$ insert into public.member_onboarding (member_id, org_id) values (auth.uid(), (select org_id from public.members limit 1)) $$,
  '42501', null, 'no direct insert');
select throws_ok($$ update public.member_onboarding set finished_at = now(), finished_via = 'later' $$,
  '42501', null, 'no direct update');
select throws_ok($$ delete from public.member_onboarding $$, '42501', null, 'no direct delete');
select pg_temp.as_member('second');
select is((select array_agg(member_id) from public.member_onboarding), array[pg_temp.fx('second')],
  'an Admin (a new joiner) reads their own row only');
select pg_temp.as_member('admin');
select is((select count(*) from public.member_onboarding), 0::bigint, 'an Admin reads nobody else''s');
select pg_temp.as_member('owner');
select is((select count(*) from public.member_onboarding), 0::bigint, 'the Owner reads nobody else''s');
select pg_temp.as_anon();
select throws_ok($$ select * from public.member_onboarding $$, '42501', null, 'anon reads nothing');

-- 4. Finishing ------------------------------------------------------------------------------------------
select pg_temp.as_member('joiner');
select throws_ok($$ select public.onboarding_finish('soon') $$, 'P0001', 'VALIDATION', 'an unknown way is refused');
select throws_ok($$ select public.onboarding_finish('test') $$, 'P0001', 'INVALID_STATE',
  'test is refused while no device has received a push');
select pg_temp.as_system();
select pg_temp.sub('joiner', 'joiner-new');
select pg_temp.as_member('joiner');
select throws_ok($$ select public.onboarding_finish('test') $$, 'P0001', 'INVALID_STATE',
  'a device turned on but never delivered to is not enough');
select pg_temp.as_system();
update public.push_subscriptions set last_success_at = now() where endpoint = 'https://push.example/joiner-new';
select pg_temp.as_member('joiner');
select is(public.onboarding_finish('test'), true, 'once the test was delivered, the walkthrough finishes');
select is(public.onboarding_finish('later'), false, 'a finished walkthrough stays finished');
select is((select (finished_at is not null, finished_via)::text from public.member_onboarding), '(t,test)',
  'finished by the test');
select pg_temp.as_member('second');
select is(public.onboarding_finish('later'), true, '"Later" finishes it too');
select is((select finished_via from public.member_onboarding), 'later', 'finished by Later');
select pg_temp.as_member('staff');
select is(public.onboarding_finish('later'), false, 'a member who joined before has nothing to finish');
select pg_temp.as_member('owner');
select is(public.onboarding_finish('later'), false, 'nor the Owner');
select pg_temp.as_system();
select is((select finished_at from public.member_onboarding where member_id = pg_temp.fx('iphone')), null,
  'another joiner''s walkthrough is untouched');
select is((select count(*) from public.member_onboarding), 3::bigint, 'and no row was added for those who joined before');
select is((select count(*) from public.activity_log where entity = 'member_onboarding' and action = 'update'),
  2::bigint, 'each finish is audited');
select pg_temp.as_anon();
select throws_ok($$ select public.onboarding_finish('later') $$, '42501', null, 'anon cannot finish anything');
select pg_temp.as_system();

-- 5. Remove another device --------------------------------------------------------------------------------
insert into fx select 'owner-a', pg_temp.sub('owner', 'owner-a');
insert into fx select 'owner-b', pg_temp.sub('owner', 'owner-b');
insert into fx select 'admin-a', pg_temp.sub('admin', 'admin-a');
insert into fx select 'admin-b', pg_temp.sub('admin', 'admin-b');
insert into fx select 'staff-a', pg_temp.sub('staff', 'staff-a');
insert into fx select 'staff-b', pg_temp.sub('staff', 'staff-b');
select pg_temp.as_member('owner');
select is(public.push_subscription_remove_own(pg_temp.fx('owner-b')), true, 'the Owner removes one of their own devices');
select throws_ok(format('select public.push_subscription_remove_own(%L)', pg_temp.fx('staff-a')), 'P0001', 'NOT_FOUND',
  'the Owner cannot remove a Staff member''s device');
select throws_ok(format('select public.push_subscription_remove_own(%L)', pg_temp.fx('admin-a')), 'P0001', 'NOT_FOUND',
  'nor an Admin''s');
select pg_temp.as_member('admin');
select is(public.push_subscription_remove_own(pg_temp.fx('admin-b')), true, 'an Admin removes one of their own');
select throws_ok(format('select public.push_subscription_remove_own(%L)', pg_temp.fx('staff-a')), 'P0001', 'NOT_FOUND',
  'an Admin cannot remove a Staff member''s device');
select throws_ok(format('select public.push_subscription_remove_own(%L)', pg_temp.fx('owner-a')), 'P0001', 'NOT_FOUND',
  'nor the Owner''s');
select pg_temp.as_member('staff');
select is(public.push_subscription_remove_own(pg_temp.fx('staff-b')), true, 'Staff remove one of their own');
select throws_ok(format('select public.push_subscription_remove_own(%L)', pg_temp.fx('admin-a')), 'P0001', 'NOT_FOUND',
  'Staff cannot remove an Admin''s device');
select throws_ok(format('select public.push_subscription_remove_own(%L)', pg_temp.fx('staff-b')), 'P0001', 'NOT_FOUND',
  'a device already removed is not found');
select pg_temp.as_anon();
select throws_ok(format('select public.push_subscription_remove_own(%L)', pg_temp.fx('staff-a')), '42501', null,
  'anon cannot remove anything');
select pg_temp.as_system();
select is((select array_agg(endpoint order by endpoint) from public.push_subscriptions
           where member_id in (pg_temp.fx('owner'), pg_temp.fx('admin'), pg_temp.fx('staff'))
             and disabled_at is null),
  array['https://push.example/admin-a', 'https://push.example/owner-a', 'https://push.example/staff-a'],
  'only the three removed devices stop (kept, marked removed since 2026-10-06); every refused one stays');
select is((select count(*) from public.activity_log where entity = 'push_subscriptions'), 0::bigint,
  'not audited, as "Sign out of this device" (a member''s own device state)');

-- 6. The band ----------------------------------------------------------------------------------------------
select is(pg_temp.band('iphone'), 'no_subscription', 'no device at all: the band (notifications off)');
select pg_temp.as_member('iphone');
select public.app_open_report('ios', false);
select pg_temp.as_system();
select is(pg_temp.band('iphone'), 'ios_not_installed', 'an iPhone without the app: the band (install)');
select pg_temp.sub('iphone', 'iphone-installed', 0, null, null, 'ios');
select is(pg_temp.band('iphone'), 'unconfirmed', 'turned on but nothing received yet: the band stays');
update public.push_subscriptions set last_success_at = now() where endpoint = 'https://push.example/iphone-installed';
select is(pg_temp.band('iphone'), null, 'a device that received a push: no band');
update public.push_subscriptions set failure_count = 1 where endpoint = 'https://push.example/iphone-installed';
select is(pg_temp.band('iphone'), null, 'one error is not repeated: still no band');
update public.push_subscriptions set failure_count = 2 where endpoint = 'https://push.example/iphone-installed';
select is(pg_temp.band('iphone'), 'failing', 'the delivered device now fails twice in a row: the band returns (failing)');
select pg_temp.sub('iphone', 'iphone-second');
select is(pg_temp.band('iphone'), 'unconfirmed', 'a second device turned on, nothing received there yet: still the band');
update public.push_subscriptions set disabled_at = now(), disabled_reason = 'expired', failure_count = 5
where endpoint = 'https://push.example/iphone-installed';
delete from public.push_subscriptions where endpoint = 'https://push.example/iphone-second';
select pg_temp.as_member('iphone');
select public.app_open_report('ios', true);
select pg_temp.as_system();
select is(pg_temp.band('iphone'), 'failing', 'the device stopped after repeated failures: the band (failing)');
select pg_temp.sub('staff', 'staff-revoked', 0, 'gone');
delete from public.push_subscriptions where endpoint = 'https://push.example/staff-a';
select is(pg_temp.band('staff'), 'permission_revoked', 'the last device went gone: the band (blocked)');
select is(pg_temp.band('joiner'), null, 'the joiner''s delivered device: no band');
-- push_status_own: the layout's one read.
select pg_temp.as_member('joiner');
select is((select (endpoints, band)::text from public.push_status_own()),
  (array['https://push.example/joiner-new'], null::text)::text, 'own endpoints, no band');
select pg_temp.as_member('owner');
select is((select (endpoints, band)::text from public.push_status_own()),
  (array['https://push.example/owner-a'], 'unconfirmed')::text, 'the Owner: their own endpoint and their own band');
select pg_temp.as_member('staff');
select is((select (endpoints, band)::text from public.push_status_own()),
  ('{}'::text[], 'permission_revoked')::text, 'Staff: no active endpoint, the blocked band');
select pg_temp.as_anon();
select throws_ok($$ select * from public.push_status_own() $$, '42501', null, 'anon is refused');
select pg_temp.as_system();
select is((select count(*) from pg_proc where proname = 'push_band' and pronamespace = 'app'::regnamespace
           and has_function_privilege('authenticated', oid, 'execute')), 0::bigint,
  'the band''s rule is service_role only');

select * from finish();
rollback;
