begin;
create extension if not exists pgtap with schema extensions;
select plan(80);

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
delete from public.notifications;
delete from public.push_subscriptions;
delete from public.members;
delete from auth.identities;
delete from auth.users;
delete from public.activity_log;
delete from public.holidays;
update public.org_settings set weekly_off_days = '{}';

create temporary table fx (key text primary key, id uuid not null);
insert into fx values
  ('owner',       '00000000-0000-4000-8000-000000000e01'),
  ('admin1',      '00000000-0000-4000-8000-000000000e02'),
  ('admin2',      '00000000-0000-4000-8000-000000000e03'),
  ('staff1',      '00000000-0000-4000-8000-000000000e04'),
  ('staff2',      '00000000-0000-4000-8000-000000000e05'),
  ('coord',       '00000000-0000-4000-8000-000000000e06'),
  ('old',         '00000000-0000-4000-8000-000000000e07'),
  ('gone',        '00000000-0000-4000-8000-000000000e08'),
  ('client_a',    '00000000-0000-4000-8000-000000000e11'),
  ('client_b',    '00000000-0000-4000-8000-000000000e12'),
  ('client_c',    '00000000-0000-4000-8000-000000000e13');
insert into fx select 'org', id from public.organizations limit 1;
grant all on fx to authenticated, anon, service_role;

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

create function pg_temp.as_nobody() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000e99', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', '00000000-0000-4000-8000-000000000e99', 'role', 'authenticated')::text, true);
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

create function pg_temp.type_id(n text) returns uuid language sql stable as $$
  select tt.id from public.task_types tt where tt.org_id = pg_temp.fx('org') and tt.name = n;
$$;

create function pg_temp.due() returns timestamptz language sql stable as $$
  select app.ist_day_start(app.today_ist() + 1) + interval '18 hours';
$$;

create function pg_temp.today() returns date language sql stable as $$ select app.today_ist() $$;

-- How many rows a statement touched, as the caller (RLS decides).
create function pg_temp.rows(q text) returns bigint language plpgsql as $$
declare
  n bigint;
begin
  execute q;
  get diagnostics n = row_count;
  return n;
end;
$$;

-- The rows a person holds of a kind (read as the system: RLS is tested on its own below).
-- $2, not the parameter's name: in a SQL function a column wins over a same-named parameter,
-- so "x.kind = kind" compared the column with itself and counted every row (5.1 review).
create function pg_temp.n(k text, kind text default null) returns bigint language sql stable as $$
  select count(*) from public.notifications x
  where x.recipient_id = pg_temp.fx(k) and ($2 is null or x.kind = $2);
$$;
create function pg_temp.last(k text, kind text) returns public.notifications language sql stable as $$
  select x.* from public.notifications x
  where x.recipient_id = pg_temp.fx(k) and x.kind = kind order by x.created_at desc, x.id desc limit 1;
$$;
create function pg_temp.total() returns bigint language sql stable as $$ select count(*) from public.notifications $$;
-- Clears the rows as the system (whatever role the test was in), so a scenario starts clean.
create function pg_temp.clear() returns void language plpgsql as $$
begin
  perform pg_temp.as_system();
  delete from public.notifications;
end;
$$;

create function pg_temp.mk(title text, assignees text[], primary_key text, approver text default null, client text default null)
returns uuid language plpgsql as $$
declare
  v_ids uuid[] := array(select pg_temp.fx(k) from unnest(assignees) k);
begin
  return public.task_create(title, null, pg_temp.type_id('Normal'),
    case when client is null then null else pg_temp.fx(client) end, 'medium', pg_temp.due(),
    v_ids, pg_temp.fx(primary_key), case when approver is null then null else pg_temp.fx(approver) end);
end;
$$;

insert into auth.users (id, email)
select id, key || '@example.com' from fx where key not in ('org', 'client_a', 'client_b', 'client_c');

insert into public.members (id, org_id, full_name, email, role, status, joined_at)
select pg_temp.fx(k), pg_temp.fx('org'), initcap(k), k || '@example.com', r::public.member_role, 'active', now() - interval '30 days'
from (values ('owner', 'owner'), ('admin1', 'admin'), ('admin2', 'admin'), ('staff1', 'staff'), ('staff2', 'staff'),
             ('coord', 'staff'), ('old', 'staff')) as v(k, r);
insert into public.members (id, org_id, full_name, email, role, status, joined_at, deactivated_at) values
  (pg_temp.fx('gone'), pg_temp.fx('org'), 'Gone Staff', 'gone@example.com', 'staff', 'deactivated', now() - interval '30 days', now());

insert into public.clients (id, org_id, name, state, admin_id, activated_at) values
  (pg_temp.fx('client_a'), pg_temp.fx('org'), 'Sharma Weddings', 'active', pg_temp.fx('admin1'), now()),
  (pg_temp.fx('client_b'), pg_temp.fx('org'), 'Blue Bakery', 'active', pg_temp.fx('admin2'), now()),
  (pg_temp.fx('client_c'), pg_temp.fx('org'), 'No Admin Cafe', 'active', null, now());

select pg_temp.as_member('owner');
insert into fx values ('asha', public.member_add_freelancer('Asha', null, null, pg_temp.fx('coord')));
insert into fx values ('bina', public.member_add_freelancer('Bina', null, null, pg_temp.fx('admin1')));
select pg_temp.as_system();
select pg_temp.clear();

-- The dispatcher's helpers as one function: the deliveries of a person, as the system.
create function pg_temp.states(k text) returns text[] language sql stable as $$
  select array_agg(d.state order by n.created_at, d.id) from public.notification_deliveries d
  join public.notifications n on n.id = d.notification_id where n.recipient_id = pg_temp.fx(k);
$$;
-- A moment on today's IST date. The rows app.notify() writes are due at the real now(), so a
-- scenario backdates them to the day's start before claiming at a chosen moment.
create function pg_temp.at(t text) returns timestamptz language sql stable as $$
  select app.ist_day_start(app.today_ist()) + t::interval;
$$;
create function pg_temp.backdate() returns void language sql as $$
  update public.notification_deliveries set next_attempt_at = pg_temp.at('00:00'), created_at = pg_temp.at('00:00')
  where state = 'queued' and next_attempt_at > pg_temp.at('00:00');
$$;

-- 1. Grants ------------------------------------------------------------------------------------------
select ok(has_function_privilege('authenticated', 'public.push_subscription_upsert(text, text, text, text, boolean, text, text)', 'execute')
          and has_function_privilege('authenticated', 'public.push_subscription_remove(text)', 'execute')
          and has_function_privilege('authenticated', 'public.push_subscriptions_tested()', 'execute')
          and not has_function_privilege('anon', 'public.push_subscription_upsert(text, text, text, text, boolean, text, text)', 'execute'),
  'the three subscription RPCs are the API''s, never anon''s');
select ok(not has_function_privilege('authenticated', 'public.push_claim(timestamptz, integer)', 'execute')
          and not has_function_privilege('anon', 'public.push_claim(timestamptz, integer)', 'execute')
          and not has_function_privilege('authenticated', 'public.push_record(uuid[], text, text, timestamptz)', 'execute')
          and not has_function_privilege('authenticated', 'public.push_targets(uuid)', 'execute')
          and not has_function_privilege('authenticated', 'public.push_subscription_result(uuid, text, timestamptz)', 'execute')
          and not has_function_privilege('authenticated', 'public.push_quiet(timestamptz, uuid)', 'execute')
          and has_function_privilege('service_role', 'public.push_claim(timestamptz, integer)', 'execute'),
  'the dispatcher''s functions (public, for PostgREST) are service_role only');

-- 2. push_subscription_upsert: per role, take-over, validation ---------------------------------------
select pg_temp.as_member('staff1');
insert into fx values ('s1', public.push_subscription_upsert('https://push.example/one', 'k1', 'a1', 'android', true, 'Phone', 'Chrome/1'));
select is((select (member_id, platform, is_standalone, label, user_agent)::text from public.push_subscriptions where id = pg_temp.fx('s1')),
  (pg_temp.fx('staff1'), 'android', true, 'Phone', 'Chrome/1')::text, 'Staff subscribe: the device is recorded');
select is(public.push_subscription_upsert('https://push.example/one', 'k1b', 'a1b', 'android', true, 'Phone', 'Chrome/2'), pg_temp.fx('s1'),
  'the same endpoint again updates the row (same id)');
select is((select (p256dh, auth, user_agent)::text from public.push_subscriptions where id = pg_temp.fx('s1')), ('k1b', 'a1b', 'Chrome/2')::text,
  'with the new keys');
select pg_temp.as_member('admin1');
select lives_ok($$ select public.push_subscription_upsert('https://push.example/admin', 'k', 'a', 'desktop') $$, 'an Admin subscribes');
select pg_temp.as_member('owner');
select lives_ok($$ select public.push_subscription_upsert('https://push.example/owner', 'k', 'a', 'ios', true, 'iPhone') $$, 'the Owner too (decision 9)');
select pg_temp.as_member('asha');
-- UNAUTHENTICATED, not FORBIDDEN: since the phase 4 review (20260930070616, S-S3 c)
-- app.current_member() resolves a permanent member only, so a sign-in on a freelancer's id is nobody.
select throws_ok($$ select public.push_subscription_upsert('https://push.example/asha', 'k', 'a') $$, 'P0001', 'UNAUTHENTICATED',
  'a freelancer (no login) cannot');
select pg_temp.as_member('gone');
select throws_ok($$ select public.push_subscription_upsert('https://push.example/gone', 'k', 'a') $$, 'P0001', 'UNAUTHENTICATED',
  'a deactivated person cannot');
select pg_temp.as_nobody();
select throws_ok($$ select public.push_subscription_upsert('https://push.example/nobody', 'k', 'a') $$, 'P0001', 'UNAUTHENTICATED', 'nor a stranger');
select pg_temp.as_member('staff1');
select throws_ok($$ select public.push_subscription_upsert('http://push.example/plain', 'k', 'a') $$, 'P0001', 'VALIDATION', 'https only');
select lives_ok($$ select public.push_subscription_upsert('http://127.0.0.1:3111/push/e2e', 'k', 'a') $$, 'except plain http on the loopback host (the local e2e fake push service)');
select is(public.push_subscription_remove('http://127.0.0.1:3111/push/e2e'), true, '(and removed again)');
select throws_ok($$ select public.push_subscription_upsert('https://push.example/nokeys', '', 'a') $$, 'P0001', 'VALIDATION', 'keys required');
select throws_ok($$ select public.push_subscription_upsert('https://push.example/p', 'k', 'a', 'tv') $$, 'P0001', 'VALIDATION', 'a known platform');
-- Take-over: staff2 subscribes on staff1's browser (the same endpoint).
select pg_temp.as_member('staff2');
select is(public.push_subscription_upsert('https://push.example/one', 'k2', 'a2', 'android', true, 'Shared phone'), pg_temp.fx('s1'),
  'a second person on the same browser takes the endpoint over (review S3)');
select pg_temp.as_system();
select is((select (member_id, p256dh, label)::text from public.push_subscriptions where id = pg_temp.fx('s1')),
  (pg_temp.fx('staff2'), 'k2', 'Shared phone')::text, 'the row is theirs now');
select pg_temp.as_member('staff1');
select is((select count(*) from public.push_subscriptions), 0::bigint, 'and staff1 no longer sees it');
-- A disabled row comes back to life for whoever subscribes.
select pg_temp.as_system();
update public.push_subscriptions set disabled_at = now(), disabled_reason = 'gone', failure_count = 3 where id = pg_temp.fx('s1');
select pg_temp.as_member('staff1');
select is(public.push_subscription_upsert('https://push.example/one', 'k3', 'a3', 'android', true), pg_temp.fx('s1'), 'a gone row is reused');
select pg_temp.as_system();
select is((select (member_id, disabled_at, disabled_reason, failure_count)::text from public.push_subscriptions where id = pg_temp.fx('s1')),
  (pg_temp.fx('staff1'), null, null, 0)::text, 'active again, the failures cleared');

-- 3. push_subscription_remove and push_subscriptions_tested ---------------------------------------------
select pg_temp.as_member('staff2');
select is(public.push_subscription_remove('https://push.example/one'), false, 'sign-out removes only your own row (someone else''s endpoint: false)');
select pg_temp.as_member('staff1');
select is(public.push_subscriptions_tested(), 1, 'the test stamps the caller''s active rows');
select pg_temp.as_system();
select ok((select last_test_at is not null from public.push_subscriptions where id = pg_temp.fx('s1')), 'last_test_at is set');
select pg_temp.as_member('staff1');
select is(public.push_subscription_remove('https://push.example/one'), true, 'sign out of this device deletes the row');
select pg_temp.as_system();
select is((select count(*) from public.push_subscriptions where id = pg_temp.fx('s1')), 0::bigint, 'gone');
select pg_temp.as_nobody();
select throws_ok($$ select public.push_subscription_remove('https://push.example/one') $$, 'P0001', 'UNAUTHENTICATED', 'a stranger: refused');
select throws_ok($$ select public.push_subscriptions_tested() $$, 'P0001', 'UNAUTHENTICATED', 'and cannot test');

-- 4. app.push_quiet: the window, IST, the edges, midnight -----------------------------------------------
select pg_temp.as_system();
update public.org_settings set quiet_hours_start = '22:00', quiet_hours_end = '07:00';
select ok(not public.push_quiet(pg_temp.at('21:59:59'), pg_temp.fx('org')), '21:59:59 is not quiet');
select ok(public.push_quiet(pg_temp.at('22:00'), pg_temp.fx('org')), '22:00:00 is (the start is inclusive)');
select ok(public.push_quiet(pg_temp.at('23:59:59'), pg_temp.fx('org')), '23:59:59 is');
select ok(public.push_quiet(pg_temp.at('24:00'), pg_temp.fx('org')), 'midnight is (the window crosses it)');
select ok(public.push_quiet(pg_temp.at('30:59:59'), pg_temp.fx('org')), '06:59:59 is');
select ok(not public.push_quiet(pg_temp.at('31:00'), pg_temp.fx('org')), '07:00:00 is not (the end is exclusive)');
select ok(not public.push_quiet(pg_temp.at('12:00'), pg_temp.fx('org')), 'noon is not');
update public.org_settings set quiet_hours_start = '13:00', quiet_hours_end = '14:00';
select ok(public.push_quiet(pg_temp.at('13:30'), pg_temp.fx('org')) and not public.push_quiet(pg_temp.at('14:00'), pg_temp.fx('org'))
          and not public.push_quiet(pg_temp.at('12:59'), pg_temp.fx('org')), 'a window inside one day');
update public.org_settings set quiet_hours_start = '09:00', quiet_hours_end = '09:00';
select ok(not public.push_quiet(pg_temp.at('09:00'), pg_temp.fx('org')) and not public.push_quiet(pg_temp.at('03:00'), pg_temp.fx('org')),
  'equal times: no window');
update public.org_settings set quiet_hours_start = '22:00', quiet_hours_end = '07:00';

-- 5. push_claim, push_targets, push_record, push_subscription_result ---------------------------------------
select pg_temp.clear();
select pg_temp.as_member('staff1');
insert into fx values ('s2', public.push_subscription_upsert('https://push.example/s1-phone', 'k', 'a', 'android', true, 'Phone'));
insert into fx values ('s3', public.push_subscription_upsert('https://push.example/s1-laptop', 'k', 'a', 'desktop'));
select pg_temp.as_system();
select app.notify(array[pg_temp.fx('staff1')], 'task_changed', 'Daytime one', 'b', '/tasks', null, null, '{}', null);
select pg_temp.backdate();
select app.notify(array[pg_temp.fx('staff2')], 'task_changed', 'Nobody listening', null, '/tasks', null, null, '{}', null);
select pg_temp.backdate();
-- A run at noon: both are due, nothing is quiet.
create temporary table claimed as select * from public.push_claim(pg_temp.at('12:00'), 50);
select is((select count(*) from claimed), 2::bigint, 'noon: two items claimed');
select is((select (c.title, c.link, c.is_summary, c.held_count, c.attempts, cardinality(c.delivery_ids))::text from claimed c where c.recipient_id = pg_temp.fx('staff1')),
  ('Daytime one', '/tasks', false, 1, 1, 1)::text, 'an item carries the row''s title and link, one attempt');
select is((select count(*) from public.push_claim(pg_temp.at('12:00'), 50)), 0::bigint, 'a second run at once claims nothing (leased)');
select is((select array_agg(t.endpoint order by t.endpoint) from public.push_targets(pg_temp.fx('staff1')) t),
  array['https://push.example/s1-laptop', 'https://push.example/s1-phone'], 'push_targets: every active device of the person');
select is((select count(*) from public.push_targets(pg_temp.fx('staff2'))), 0::bigint, 'none for a person with no device');
-- Outcomes.
select is(public.push_record((select c.delivery_ids from claimed c where c.recipient_id = pg_temp.fx('staff1')), 'sent', null, pg_temp.at('12:00:01')), 1,
  'push_record sent: one row');
select is((select (d.state, d.sent_at, d.last_error)::text from public.notification_deliveries d join public.notifications n on n.id = d.notification_id
           where n.recipient_id = pg_temp.fx('staff1')), ('sent', pg_temp.at('12:00:01'), null)::text, 'sent, with sent_at');
select is(public.push_record((select c.delivery_ids from claimed c where c.recipient_id = pg_temp.fx('staff2')), 'failed', 'no_subscription', pg_temp.at('12:00:01')), 1,
  'no device: failed with no_subscription (the seam for the email fallback)');
select is((select (d.state, d.last_error)::text from public.notification_deliveries d join public.notifications n on n.id = d.notification_id
           where n.recipient_id = pg_temp.fx('staff2')), ('failed', 'no_subscription')::text, 'recorded so');
select is(public.push_record((select c.delivery_ids from claimed c where c.recipient_id = pg_temp.fx('staff1')), 'sent', null, pg_temp.at('12:00:02')), 0,
  'a row already sent is never written again (idempotent)');
drop table claimed;
-- Retries with backoff: 1, 5, 15, 60 minutes, then failed.
select pg_temp.clear();
select app.notify(array[pg_temp.fx('staff1')], 'task_changed', 'Flaky', null, '/tasks', null, null, '{}', null);
select pg_temp.backdate();
create temporary table claimed as select * from public.push_claim(pg_temp.at('12:00'), 50);
select is(public.push_record((select c.delivery_ids from claimed c), 'retry', 'HTTP 500', pg_temp.at('12:00')), 1, 'retry after the first attempt');
select is((select (d.state, d.attempts, d.next_attempt_at, d.last_error)::text from public.notification_deliveries d), ('queued', 1, pg_temp.at('12:01'), 'HTTP 500')::text,
  'queued again one minute later');
select is((select count(*) from public.push_claim(pg_temp.at('12:00:30'), 50)), 0::bigint, 'not before it is due');
delete from claimed; insert into claimed select * from public.push_claim(pg_temp.at('12:01'), 50);
select is((select c.attempts from claimed c), 2, 'the second attempt');
select public.push_record((select c.delivery_ids from claimed c), 'retry', 'HTTP 500', pg_temp.at('12:01'));
select is((select d.next_attempt_at from public.notification_deliveries d), pg_temp.at('12:06'), 'then five minutes');
delete from claimed; insert into claimed select * from public.push_claim(pg_temp.at('12:06'), 50);
select public.push_record((select c.delivery_ids from claimed c), 'retry', 'HTTP 500', pg_temp.at('12:06'));
select is((select d.next_attempt_at from public.notification_deliveries d), pg_temp.at('12:21'), 'then fifteen');
delete from claimed; insert into claimed select * from public.push_claim(pg_temp.at('12:21'), 50);
select public.push_record((select c.delivery_ids from claimed c), 'retry', 'HTTP 500', pg_temp.at('12:21'));
select is((select d.next_attempt_at from public.notification_deliveries d), pg_temp.at('13:21'), 'then sixty');
delete from claimed; insert into claimed select * from public.push_claim(pg_temp.at('13:21'), 50);
select is((select c.attempts from claimed c), 5, 'the fifth attempt');
select public.push_record((select c.delivery_ids from claimed c), 'retry', 'HTTP 500', pg_temp.at('13:21'));
select is((select (d.state, d.last_error)::text from public.notification_deliveries d), ('failed', 'HTTP 500')::text, 'and then failed');
select is((select count(*) from public.push_claim(pg_temp.at('15:00'), 50)), 0::bigint, 'a failed row is never claimed again');
drop table claimed;
-- The lease: a crashed run's rows come back after five minutes.
select pg_temp.clear();
select app.notify(array[pg_temp.fx('staff1')], 'task_changed', 'Crash', null, '/tasks', null, null, '{}', null);
select pg_temp.backdate();
select is((select count(*) from public.push_claim(pg_temp.at('12:00'), 50)), 1::bigint, 'claimed');
select is((select count(*) from public.push_claim(pg_temp.at('12:04'), 50)), 0::bigint, 'nothing inside the lease');
select is((select count(*) from public.push_claim(pg_temp.at('12:05'), 50)), 1::bigint, 'claimed again once the lease is over (attempt 2)');
-- Subscription results.
select is(public.push_subscription_result(pg_temp.fx('s2'), 'sent', pg_temp.at('12:00')), 'active', 'sent: active');
select is((select (last_success_at, failure_count)::text from public.push_subscriptions where id = pg_temp.fx('s2')), (pg_temp.at('12:00'), 0)::text,
  'with last_success_at');
select is(public.push_subscription_result(pg_temp.fx('s2'), 'error', pg_temp.at('12:01')), 'active', 'one error: still active');
select is((select (last_failure_at, failure_count)::text from public.push_subscriptions where id = pg_temp.fx('s2')), (pg_temp.at('12:01'), 1)::text,
  'counted');
select public.push_subscription_result(pg_temp.fx('s2'), 'error'); select public.push_subscription_result(pg_temp.fx('s2'), 'error');
select public.push_subscription_result(pg_temp.fx('s2'), 'error');
select is(public.push_subscription_result(pg_temp.fx('s2'), 'error', pg_temp.at('12:05')), 'expired', 'the fifth error in a row disables it (expired)');
select is(public.push_subscription_result(pg_temp.fx('s3'), 'gone', pg_temp.at('12:05')), 'gone', '404/410 disables it (gone)');
select is((select count(*) from public.push_targets(pg_temp.fx('staff1'))), 0::bigint, 'neither is a target any more');
select is(public.push_subscription_result(pg_temp.fx('s3'), 'sent', pg_temp.at('12:06')), 'gone', 'a disabled row stays disabled whatever comes later');
select is(public.push_subscription_result(pg_temp.fx('s2'), 'sent', pg_temp.at('12:06')), 'expired', 'both');
select throws_ok($$ select public.push_record('{}', 'lost') $$, 'P0001', 'VALIDATION', 'an unknown outcome is refused');

-- 6. Quiet hours: held, then one summary per person at the window's end ------------------------------------
select pg_temp.clear();
select pg_temp.as_member('staff1');
select public.push_subscription_upsert('https://push.example/s1-new', 'k', 'a', 'android', true);
select pg_temp.as_system();
select app.notify(array[pg_temp.fx('staff1'), pg_temp.fx('staff2')], 'task_changed', 'Night one', null, '/tasks', null, null, '{}', null);
select pg_temp.backdate();
select app.notify(array[pg_temp.fx('staff1')], 'task_changed', 'Night two', null, '/tasks', null, null, '{}', null);
select pg_temp.backdate();
select app.notify(array[pg_temp.fx('staff1')], 'task_changed', 'Night three', null, '/tasks', null, null, '{}', null);
select pg_temp.backdate();
select is((select count(*) from public.push_claim(pg_temp.at('23:00'), 50)), 0::bigint, 'a run at 23:00 sends nothing');
select is(pg_temp.states('staff1'), array['held', 'held', 'held'], 'the rows are held');
select is((select count(*) from public.push_claim(pg_temp.at('30:59:59'), 50)), 0::bigint, 'nor a run at 06:59:59');
-- A retry that falls into the window is held too.
select app.notify(array[pg_temp.fx('admin1')], 'task_changed', 'Late retry', null, '/tasks', null, null, '{}', null);
select pg_temp.backdate();
update public.notification_deliveries d set next_attempt_at = pg_temp.at('22:30') from public.notifications n
where n.id = d.notification_id and n.recipient_id = pg_temp.fx('admin1');
select is((select count(*) from public.push_claim(pg_temp.at('22:30'), 50)), 0::bigint, 'a retry due inside the window is not sent');
select is(pg_temp.states('admin1'), array['held'], 'it is held');
-- 07:00: the first run sends one summary to staff1 (three rows), the single rows as themselves.
create temporary table claimed as select * from public.push_claim(pg_temp.at('31:00'), 50);
select is((select count(*) from claimed), 3::bigint, '07:00: three items (staff1''s summary, staff2''s one, admin1''s one)');
select is((select (c.title, c.body, c.link, c.is_summary, c.held_count, c.kind, c.notification_id, cardinality(c.delivery_ids))::text from claimed c where c.recipient_id = pg_temp.fx('staff1')),
  ('3 updates while you were away', 'Open MaxOff to see what happened.', '/notifications', true, 3, 'summary', null, 3)::text,
  'the summary: "3 updates while you were away", opening the history, all three rows');
select is((select (c.title, c.is_summary, c.held_count)::text from claimed c where c.recipient_id = pg_temp.fx('staff2')), ('Night one', false, 1)::text,
  'a single held row goes as itself');
select is(public.push_record((select c.delivery_ids from claimed c where c.recipient_id = pg_temp.fx('staff1')), 'sent', null, pg_temp.at('31:00')), 3,
  'the summary marks its three rows sent');
select is(pg_temp.states('staff1'), array['sent', 'sent', 'sent'], 'all sent');
select is((select count(*) from public.push_claim(pg_temp.at('31:01'), 50)), 0::bigint, 'the next run has nothing');
drop table claimed;

select * from finish();
rollback;
