-- 5A review fixes (migration 20261001053934_review_5a_fixes):
-- 1. push_subscriptions: a direct INSERT or UPDATE is refused for Staff, Admin and the Owner; the
--    RPC is the only write (M2); app.local_flags is unreachable from the API;
-- 2. the upsert's strict keys (M1) and endpoints: https on a public DNS name, http on the loopback
--    host only with the local switch (M2);
-- 3. the cap: 10 active rows a person, the least recently seen others disabled 'expired' (M2);
-- 4. push_test_claim: a 30 s cooldown, checked and stamped before the send (S2);
-- 5. the guard messages say "Crew" (M4).
begin;
create extension if not exists pgtap with schema extensions;
select plan(49);

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

-- Web Push keys in the shape the browser hands over (5A review M1: the upsert checks them strictly):
-- p256dh 65 bytes starting 0x04, auth 16 bytes, base64url without padding; one per tag.
create function pg_temp.p256(tag text) returns text language sql immutable as $k$
  select rtrim(translate(replace(encode('\x04'::bytea || sha256(convert_to(tag, 'utf8'))
    || sha256(convert_to(tag || '.', 'utf8')), 'base64'), E'\n', ''), '+/', '-_'), '=') $k$;
create function pg_temp.auth16(tag text) returns text language sql immutable as $k$
  select rtrim(translate(encode(substring(sha256(convert_to(tag, 'utf8')) from 1 for 16), 'base64'), '+/', '-_'), '=') $k$;
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


-- The DETAIL app.fail() raised (the friendly text the screen shows), or null when it ran.
create function pg_temp.detail(q text) returns text language plpgsql as $$
declare
  v text;
begin
  execute q;
  return null;
exception when others then
  get stacked diagnostics v = pg_exception_detail;
  return v;
end;
$$;

-- 1. Direct writes refused per role; the RPC allowed ------------------------------------------------
select pg_temp.as_member('staff1');
select throws_ok($$ insert into public.push_subscriptions (endpoint, p256dh, auth) values ('https://push.example/d-s', 'k', 'a') $$,
  '42501', null, 'Staff: a direct INSERT is refused');
select lives_ok($$ select public.push_subscription_upsert('https://push.example/s1', pg_temp.p256('s1'), pg_temp.auth16('s1'), 'android') $$,
  'Staff: the RPC subscribes');
select throws_ok($$ update public.push_subscriptions set label = 'x' $$, '42501', null, 'Staff: a direct UPDATE is refused');
select throws_ok($$ update public.push_subscriptions set endpoint = 'http://169.254.169.254/latest' $$, '42501', null,
  'Staff: an endpoint cannot be rewritten to an internal address');
select pg_temp.as_member('admin1');
select throws_ok($$ insert into public.push_subscriptions (endpoint, p256dh, auth) values ('https://push.example/d-a', 'k', 'a') $$,
  '42501', null, 'Admin: a direct INSERT is refused');
select lives_ok($$ select public.push_subscription_upsert('https://push.example/a1', pg_temp.p256('a1'), pg_temp.auth16('a1'), 'desktop') $$,
  'Admin: the RPC subscribes');
select throws_ok($$ update public.push_subscriptions set label = 'x' $$, '42501', null, 'Admin: a direct UPDATE is refused');
select pg_temp.as_member('owner');
select throws_ok($$ insert into public.push_subscriptions (endpoint, p256dh, auth) values ('https://push.example/d-o', 'k', 'a') $$,
  '42501', null, 'Owner: a direct INSERT is refused');
select lives_ok($$ select public.push_subscription_upsert('https://push.example/o1', pg_temp.p256('o1'), pg_temp.auth16('o1'), 'ios') $$,
  'Owner: the RPC subscribes');
select throws_ok($$ update public.push_subscriptions set label = 'x' $$, '42501', null, 'Owner: a direct UPDATE is refused');
select is(pg_temp.rows($$ delete from public.push_subscriptions where endpoint = 'https://push.example/o1' $$), 1::bigint,
  'Owner: deleting their own row stays allowed (RLS own rows)');
select pg_temp.as_system();
select is((select count(*) from public.push_subscriptions), 2::bigint, 'only the two RPC rows exist');
select pg_temp.as_member('staff1');
select throws_ok($$ select * from app.local_flags $$, '42501', null, 'Staff cannot read the local switches');
select pg_temp.as_member('admin1');
select throws_ok($$ insert into app.local_flags (flag) values ('push_loopback_endpoints') $$, '42501', null,
  'Admin cannot write them');
select pg_temp.as_member('owner');
select throws_ok($$ delete from app.local_flags $$, '42501', null, 'nor the Owner');
select ok((select c.relrowsecurity from pg_class c where c.oid = 'app.local_flags'::regclass)
          and not has_function_privilege('authenticated', 'app.local_flag(text)', 'execute'),
  'app.local_flags has RLS on and its reader is not the API''s');
select ok(has_function_privilege('authenticated', 'public.push_test_claim()', 'execute')
          and not has_function_privilege('anon', 'public.push_test_claim()', 'execute'),
  'push_test_claim is the API''s, never anon''s');

-- 2. Keys and endpoints ------------------------------------------------------------------------------
select pg_temp.as_member('staff1');
select is(pg_temp.detail($$ select public.push_subscription_upsert('https://push.example/k1', 'k', pg_temp.auth16('x')) $$),
  'The subscription keys are not valid.', 'a p256dh that is not 65 bytes is refused');
select is(pg_temp.detail($$ select public.push_subscription_upsert('https://push.example/k2', 'A' || repeat('A', 86), pg_temp.auth16('x')) $$),
  'The subscription keys are not valid.', 'nor 65 bytes that are not an uncompressed point (0x04)');
select is(pg_temp.detail($$ select public.push_subscription_upsert('https://push.example/k3', 'B' || repeat('+', 86), pg_temp.auth16('x')) $$),
  'The subscription keys are not valid.', 'nor plain base64 (base64url only)');
select is(pg_temp.detail($$ select public.push_subscription_upsert('https://push.example/k4', pg_temp.p256('x'), repeat('A', 23)) $$),
  'The subscription keys are not valid.', 'an auth that is not 16 bytes is refused');
select is(pg_temp.detail($$ select public.push_subscription_upsert('https://push.example/k5', pg_temp.p256('x'), pg_temp.auth16('x') || '==') $$),
  'The subscription keys are not valid.', 'padding is refused (the browser never pads)');
select is(pg_temp.detail($$ select public.push_subscription_upsert('https://169.254.169.254/latest/meta-data', pg_temp.p256('x'), pg_temp.auth16('x')) $$),
  'The push endpoint must be an https URL.', 'https on an IP literal is refused (SSRF)');
select is(pg_temp.detail($$ select public.push_subscription_upsert('https://[::1]/x', pg_temp.p256('x'), pg_temp.auth16('x')) $$),
  'The push endpoint must be an https URL.', 'nor an IPv6 literal');
select is(pg_temp.detail($$ select public.push_subscription_upsert('https://localhost/x', pg_temp.p256('x'), pg_temp.auth16('x')) $$),
  'The push endpoint must be an https URL.', 'nor https localhost');
select is(pg_temp.detail($$ select public.push_subscription_upsert('https://metadata.internal/x', pg_temp.p256('x'), pg_temp.auth16('x')) $$),
  'The push endpoint must be an https URL.', 'nor a private suffix');
select is(pg_temp.detail($$ select public.push_subscription_upsert('https://user@push.example/x', pg_temp.p256('x'), pg_temp.auth16('x')) $$),
  'The push endpoint must be an https URL.', 'nor credentials in the URL');
select is(pg_temp.detail($$ select public.push_subscription_upsert('https://fcm.googleapis.com/fcm/send/abc', pg_temp.p256('x'), pg_temp.auth16('x')) $$),
  null, 'a real push service''s endpoint is taken');
-- The local switch: the seed sets it (this database is local); without it, http is refused.
select pg_temp.as_system();
select ok(app.local_flag('push_loopback_endpoints'), 'the local seed turned the loopback switch on');
delete from app.local_flags;
select pg_temp.as_member('staff1');
select is(pg_temp.detail($$ select public.push_subscription_upsert('http://127.0.0.1:3111/push/e2e', pg_temp.p256('x'), pg_temp.auth16('x')) $$),
  'The push endpoint must be an https URL.', 'without the switch (staging, production) http on the loopback host is refused');
select is(pg_temp.detail($$ select public.push_subscription_upsert('http://push.example/plain', pg_temp.p256('x'), pg_temp.auth16('x')) $$),
  'The push endpoint must be an https URL.', 'and http anywhere else');
select pg_temp.as_system();
insert into app.local_flags (flag) values ('push_loopback_endpoints');
select pg_temp.as_member('staff1');
select is(pg_temp.detail($$ select public.push_subscription_upsert('http://127.0.0.1:3111/push/e2e', pg_temp.p256('x'), pg_temp.auth16('x')) $$),
  null, 'with it (local, CI) the e2e fake push service is taken');
select is(pg_temp.detail($$ select public.push_subscription_upsert('http://10.0.0.1/push', pg_temp.p256('x'), pg_temp.auth16('x')) $$),
  'The push endpoint must be an https URL.', 'but never http to another host, switch or not');

-- 3. The cap: 10 active rows a person ------------------------------------------------------------------
select pg_temp.as_system();
delete from public.push_subscriptions where member_id = pg_temp.fx('staff2');
select pg_temp.as_member('staff2');
select public.push_subscription_upsert('https://push.example/cap' || i, pg_temp.p256('cap' || i), pg_temp.auth16('cap' || i))
from generate_series(1, 10) i;
select pg_temp.as_system();
-- Seen at different times: cap3 is the least recently seen.
update public.push_subscriptions set last_seen_at = now() - (interval '1 day' * (20 - substring(endpoint from 'cap([0-9]+)$')::int))
where member_id = pg_temp.fx('staff2');
update public.push_subscriptions set last_seen_at = now() - interval '30 days' where endpoint = 'https://push.example/cap3';
select is((select count(*) from public.push_subscriptions where member_id = pg_temp.fx('staff2') and disabled_at is null), 10::bigint,
  'ten devices are all active');
select pg_temp.as_member('staff2');
select lives_ok($$ select public.push_subscription_upsert('https://push.example/cap11', pg_temp.p256('cap11'), pg_temp.auth16('cap11')) $$,
  'the eleventh is never refused');
select pg_temp.as_system();
select is((select count(*) from public.push_subscriptions where member_id = pg_temp.fx('staff2') and disabled_at is null), 10::bigint,
  'still ten active');
select is((select disabled_reason from public.push_subscriptions where endpoint = 'https://push.example/cap3'), 'expired',
  'the least recently seen one is disabled as expired');
select is((select disabled_at from public.push_subscriptions where endpoint = 'https://push.example/cap11'), null,
  'the new one is active');
select pg_temp.as_member('staff2');
select lives_ok($$ select public.push_subscription_upsert('https://push.example/cap5', pg_temp.p256('cap5'), pg_temp.auth16('cap5')) $$,
  'a re-subscribe of an active device does not count twice');
select pg_temp.as_system();
select is((select count(*) from public.push_subscriptions where member_id = pg_temp.fx('staff2') and disabled_at is not null), 1::bigint,
  'and disables nobody else');

-- 4. push_test_claim -------------------------------------------------------------------------------
select pg_temp.as_member('staff1');
select is(public.push_test_claim(), 3, 'the first test claims staff1''s three active devices');
select is(pg_temp.detail($$ select public.push_test_claim() $$),
  'A test was sent a moment ago. Try again in half a minute.', 'a second tap within 30 seconds is refused');
select throws_ok($$ select public.push_test_claim() $$, 'P0001', 'RATE_LIMITED', 'as RATE_LIMITED');
select pg_temp.as_system();
update public.push_subscriptions set last_test_at = now() - interval '31 seconds' where member_id = pg_temp.fx('staff1');
select pg_temp.as_member('staff1');
select is(public.push_test_claim(), 3, 'after 30 seconds it may go again');
select pg_temp.as_nobody();
select throws_ok($$ select public.push_test_claim() $$, 'P0001', 'UNAUTHENTICATED', 'nobody cannot');

-- 5. "Crew" in the guard messages --------------------------------------------------------------------
select pg_temp.as_member('owner');
select is(pg_temp.detail(format($$ select public.member_invite(%L, 'new@example.com', 'New', 'owner') $$, gen_random_uuid())),
  'Invite people as Admin or Crew.', 'member_invite: Admin or Crew');
select is(pg_temp.detail(format($$ select public.member_add_freelancer('Cara', null, null, %L) $$, pg_temp.fx('owner'))),
  'The Owner approves the work, so the Owner cannot coordinate. Choose an Admin or Crew member.',
  'coordinator_eligible: the Owner cannot coordinate');
select is(pg_temp.detail(format($$ select public.member_add_freelancer('Cara', null, null, %L) $$, pg_temp.fx('gone'))),
  'A coordinator is an active employee (Admin or Crew).', 'coordinator_eligible: an active employee');
select is(pg_temp.detail(format($$ select public.comp_leave_grant(%L, 1.0) $$, pg_temp.fx('gone'))),
  'Comp leave is granted to an active Admin or Crew employee.', 'comp_leave_grant: an active employee');

select * from finish();
rollback;
