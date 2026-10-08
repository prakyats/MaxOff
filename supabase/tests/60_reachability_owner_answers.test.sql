-- 5B 5.5 follow-up (migration reachability_owner_answers; the owner's answers of 2026-10-06, PROGRESS
-- "Slice 9"). (1) Remove sticks: Remove keeps the row, marked 'removed'; the automatic subscribe
-- (push_subscription_upsert) is refused for it, also after "Sign out of this device", so the device
-- stays off when opened again (no active row, push_status_own without it, the band off); the explicit
-- tap (push_subscription_turn_on) clears it, the same row, with every other rule of the upsert; the
-- dispatcher never targets it; Remove's own rule is kept. (3) A test the push service accepted lets
-- the walkthrough finish by test; a claimed test nobody accepted does not. (4) The band counts any
-- delivery on record: a real dispatched push exactly like a test; neither keeps it ('unconfirmed').
-- push_band_census(): the band's 'unconfirmed' people and their active devices, active members only,
-- read-only, service_role only.
begin;
create extension if not exists pgtap with schema extensions;
select plan(40);

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
  ('owner',    '00000000-0000-4000-8000-000000006001'),
  ('admin',    '00000000-0000-4000-8000-000000006002'),
  ('staff',    '00000000-0000-4000-8000-000000006003'),
  ('joiner',   '00000000-0000-4000-8000-000000006004'),
  ('reallive', '00000000-0000-4000-8000-000000006005'),
  ('neither',  '00000000-0000-4000-8000-000000006006'),
  ('testonly', '00000000-0000-4000-8000-000000006007'),
  ('claimed',  '00000000-0000-4000-8000-000000006008'),
  ('invited',  '00000000-0000-4000-8000-000000006009'),
  ('gone',     '00000000-0000-4000-8000-000000006010');
insert into fx select 'org', id from public.organizations limit 1;
grant all on fx to authenticated, anon, service_role;
create function pg_temp.fx(k text) returns uuid language sql stable as $$ select id from fx where key = k; $$;
-- Web Push keys in the shape the browser hands over (the upsert checks them strictly; pgTAP 47).
create function pg_temp.p256(tag text) returns text language sql immutable as $k$
  select rtrim(translate(replace(encode('\x04'::bytea || sha256(convert_to(tag, 'utf8'))
    || sha256(convert_to(tag || '.', 'utf8')), 'base64'), E'\n', ''), '+/', '-_'), '=') $k$;
create function pg_temp.auth16(tag text) returns text language sql immutable as $k$
  select rtrim(translate(encode(substring(sha256(convert_to(tag, 'utf8')) from 1 for 16), 'base64'), '+/', '-_'), '=') $k$;
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
-- The caller subscribes this device: automatically (the re-subscribe on load) or by their tap.
create function pg_temp.auto(tag text) returns uuid language sql as $$
  select public.push_subscription_upsert('https://push.example/' || tag, pg_temp.p256(tag), pg_temp.auth16(tag), 'android');
$$;
create function pg_temp.tap(tag text) returns uuid language sql as $$
  select public.push_subscription_turn_on('https://push.example/' || tag, pg_temp.p256(tag), pg_temp.auth16(tag), 'android');
$$;
create function pg_temp.sub(k text, tag text, reason text default null) returns uuid language sql as $$
  insert into public.push_subscriptions (member_id, endpoint, p256dh, auth, platform, disabled_at, disabled_reason)
  values (pg_temp.fx(k), 'https://push.example/' || tag, 'k', 'a', 'android',
          case when reason is not null then now() end, reason)
  returning id;
$$;
create function pg_temp.row_of(tag text) returns text language sql stable as $$
  select (s.member_id = (select id from fx where key = 'staff'), s.disabled_at is not null, s.disabled_reason, s.failure_count)::text
  from public.push_subscriptions s where s.endpoint = 'https://push.example/' || tag;
$$;
create function pg_temp.band(k text) returns text language sql stable as $$ select app.push_band(pg_temp.fx(k)); $$;

insert into auth.users (id, email) select id, key || '@example.com' from fx where key <> 'org';
insert into public.members (id, org_id, full_name, email, role, status, joined_at)
select pg_temp.fx(k), pg_temp.fx('org'), initcap(k), k || '@example.com', r::public.member_role, 'active',
       now() - interval '2 days'
from (values ('owner', 'owner'), ('admin', 'admin'), ('staff', 'staff'), ('joiner', 'staff'),
             ('reallive', 'staff'), ('neither', 'staff'), ('testonly', 'staff'), ('claimed', 'staff'),
             ('gone', 'staff')) as v(k, r);
insert into public.members (id, org_id, full_name, email, role, status, invited_at)
values (pg_temp.fx('invited'), pg_temp.fx('org'), 'Invited', 'invited@example.com', 'staff', 'invited', now());
update public.members set status = 'deactivated', deactivated_at = now() where id = pg_temp.fx('gone');
-- The joiner accepted their invite after 5.5 shipped: an unfinished walkthrough.
insert into public.member_onboarding (member_id, org_id) values (pg_temp.fx('joiner'), pg_temp.fx('org'));

-- 1. Remove sticks ----------------------------------------------------------------------------------------
select pg_temp.as_member('staff');
insert into fx select 'phone', pg_temp.auto('staff-phone');
insert into fx select 'laptop', pg_temp.auto('staff-laptop');
select is(public.push_subscription_remove_own(pg_temp.fx('phone')), true, 'Staff remove their phone from the laptop');
select pg_temp.as_system();
select is(pg_temp.row_of('staff-phone'), '(t,t,removed,0)', 'the row is kept, disabled as removed');
select pg_temp.as_member('staff');
select throws_ok($$ select pg_temp.auto('staff-phone') $$, 'P0001', 'INVALID_STATE',
  'opened again: the automatic re-subscribe is refused for the removed device');
select pg_temp.as_system();
select is(pg_temp.row_of('staff-phone'), '(t,t,removed,0)', 'and the device stays off');
select is((select count(*) from public.push_subscriptions where endpoint = 'https://push.example/staff-phone'), 1::bigint,
  'no second row for it either');
select pg_temp.as_member('staff');
select is((select (endpoints)::text from public.push_status_own()), (array['https://push.example/staff-laptop'])::text,
  'the layout''s read leaves it out: this device reads as off');
select is(public.push_subscription_remove('https://push.example/staff-phone'), false,
  '"Sign out of this device" on the removed device deletes nothing');
select throws_ok($$ select pg_temp.auto('staff-phone') $$, 'P0001', 'INVALID_STATE',
  'so signing in there again does not turn it back on');
select pg_temp.as_system();
select is((select count(*) from public.push_targets(pg_temp.fx('staff')) t where t.id = pg_temp.fx('phone')), 0::bigint,
  'the dispatcher never pushes to a removed device');
select pg_temp.as_member('staff');
select is(pg_temp.tap('staff-phone'), pg_temp.fx('phone'), 'an explicit Turn on on that device brings back the same row');
select pg_temp.as_system();
select is(pg_temp.row_of('staff-phone'), '(t,f,,0)', 'active again, the marker cleared');
select pg_temp.as_member('staff');
select is((select array(select unnest(endpoints) order by 1) from public.push_status_own()),
  array['https://push.example/staff-laptop', 'https://push.example/staff-phone'], 'and on again for the layout');
select is(pg_temp.auto('staff-phone'), pg_temp.fx('phone'), 'the automatic re-subscribe works for it again');

-- The only device removed: the band says notifications are off.
select pg_temp.as_member('admin');
insert into fx select 'admin-only', pg_temp.auto('admin-only');
select public.push_subscription_remove_own(pg_temp.fx('admin-only'));
select throws_ok($$ select pg_temp.auto('admin-only') $$, 'P0001', 'INVALID_STATE', 'an Admin''s removed device stays off too');
select is((select (endpoints, band)::text from public.push_status_own()), ('{}'::text[], 'no_subscription')::text,
  'no active device and the band reads off (Turn on)');
select is(pg_temp.tap('admin-only'), pg_temp.fx('admin-only'), 'Turn on there restores it');

-- Remove's own rule is kept, and the explicit Turn on keeps every rule of the upsert.
select throws_ok(format('select public.push_subscription_remove_own(%L)', pg_temp.fx('laptop')), 'P0001', 'NOT_FOUND',
  'an Admin still cannot remove a Staff member''s device');
select pg_temp.as_member('owner');
select throws_ok(format('select public.push_subscription_remove_own(%L)', pg_temp.fx('laptop')), 'P0001', 'NOT_FOUND',
  'nor the Owner');
select throws_ok($$ select public.push_subscription_turn_on('https://push.example/staff-laptop', pg_temp.p256('other'),
                    pg_temp.auth16('other'), 'android') $$, 'P0001', 'FORBIDDEN',
  'Turn on never takes another member''s active device without its keys');
select throws_ok($$ select public.push_subscription_turn_on('http://push.example/x', pg_temp.p256('x'), pg_temp.auth16('x'), 'android') $$,
  'P0001', 'VALIDATION', 'Turn on checks the endpoint as the upsert does');
-- A shared browser: the removed mark is the remover's, not the device's for everyone.
select pg_temp.as_member('staff');
select public.push_subscription_remove_own(pg_temp.fx('phone'));
select pg_temp.as_member('owner');
select is(pg_temp.auto('staff-phone'), pg_temp.fx('phone'),
  'someone else signed in on that browser still turns it on for themselves');
select pg_temp.as_system();
select is((select (member_id, disabled_reason)::text from public.push_subscriptions where id = pg_temp.fx('phone')),
  (pg_temp.fx('owner'), null::text)::text, 'now theirs and active');
select pg_temp.as_anon();
select throws_ok($$ select pg_temp.tap('anon-device') $$, '42501', null, 'anon cannot turn anything on');
select pg_temp.as_system();
select is((select count(*) from pg_proc where proname = 'push_subscription_save' and pronamespace = 'app'::regnamespace
           and has_function_privilege('authenticated', oid, 'execute')), 0::bigint,
  'the shared body is service_role only: only the two RPCs reach it');
select is((select count(*) from public.activity_log where entity = 'push_subscriptions'), 0::bigint,
  'device state, not audited (as before)');

-- 2. Any delivery on record ends the band (answer 4) ---------------------------------------------------------
insert into fx select 'real', pg_temp.sub('reallive', 'reallive');
insert into fx select 'neither-a', pg_temp.sub('neither', 'neither-a');
select pg_temp.sub('neither', 'neither-b');
select pg_temp.sub('neither', 'neither-removed', 'removed');
insert into fx select 'test', pg_temp.sub('testonly', 'testonly');
select pg_temp.sub('claimed', 'claimed');
select pg_temp.sub('invited', 'invited');
-- A real notification dispatched to the device: the dispatcher's own result for it (push/dispatcher.ts).
select public.push_subscription_result(pg_temp.fx('real'), 'sent');
select is(pg_temp.band('reallive'), null, 'a device with a real dispatched push and never a test: no band');
select is((select last_test_at from public.push_subscriptions where id = pg_temp.fx('real')), null,
  '(it was never tested)');
select is(pg_temp.band('neither'), 'unconfirmed', 'a device with neither: Check notifications reach you');
select pg_temp.as_member('testonly');
select is(public.push_test_claim(), 1, 'a test is claimed');
select pg_temp.as_system();
select public.push_subscription_result(pg_temp.fx('test'), 'sent');
select is(pg_temp.band('testonly'), null, 'a device whose only success is a test: no band');
select pg_temp.as_member('claimed');
select public.push_test_claim();
select pg_temp.as_system();
select is(pg_temp.band('claimed'), 'unconfirmed', 'a test claimed that no device accepted: still the band');

-- 3. A delivered test finishes the walkthrough; one nobody accepted does not (answer 3) ---------------------
insert into fx select 'joiner-d', pg_temp.sub('joiner', 'joiner');
select pg_temp.as_member('joiner');
select public.push_test_claim();
select throws_ok($$ select public.onboarding_finish('test') $$, 'P0001', 'INVALID_STATE',
  'a test no device accepted cannot finish the walkthrough');
select pg_temp.as_system();
select public.push_subscription_result(pg_temp.fx('joiner-d'), 'sent');
select pg_temp.as_member('joiner');
select is(public.onboarding_finish('test'), true, 'once a device accepted the test, it finishes (from Me, the band or its own step)');
select is((select finished_via from public.member_onboarding), 'test', 'finished by the test');
select pg_temp.as_system();

-- 4. The census ------------------------------------------------------------------------------------------------
-- Unconfirmed now: the Owner (the shared browser's device), the Admin (their restored device), Staff
-- (the laptop), neither (two active devices; the removed one left out) and claimed; not the invited
-- person whose devices say the same (not an active member), nor reallive, testonly or the joiner.
select is((select array_agg(k order by k) from (values ('owner'), ('admin'), ('staff'), ('joiner'), ('reallive'),
           ('neither'), ('testonly'), ('claimed'), ('invited')) as v(k) where pg_temp.band(k) = 'unconfirmed'),
  array['admin', 'claimed', 'invited', 'neither', 'owner', 'staff'], 'the band''s own answer, person by person');
create temporary table before_census as
  select (select count(*) from public.push_subscriptions) as subs, (select count(*) from public.activity_log) as audit,
         (select count(*) from public.member_reachability) as reach;
select pg_temp.as_member('owner');
select throws_ok($$ select * from public.push_band_census() $$, '42501', null, 'the Owner''s session cannot run the census');
select pg_temp.as_anon();
select throws_ok($$ select * from public.push_band_census() $$, '42501', null, 'nor anon');
select set_config('role', 'service_role', true);
select is((select (people, devices)::text from public.push_band_census()), '(5,6)',
  'the census as the service role: 5 active people, 6 active devices (neither has two)');
select pg_temp.as_system();
select is((select (subs, audit, reach)::text from before_census),
  ((select count(*) from public.push_subscriptions), (select count(*) from public.activity_log),
   (select count(*) from public.member_reachability))::text, 'it wrote nothing');
select is((select provolatile::text from pg_proc where proname = 'push_band_census'), 's', 'declared read-only (stable)');

select * from finish();
rollback;
