-- 5B 5.4 (migration reachability; kickoff 5 decision 14, owner decisions 2026-10-03): reachability.
-- (1) The kind: always emailed, in-app, not actionable. (2) The tables: RLS on, no API access.
-- (3) app_open_report: the caller's own row, only a change written, audited. (4) Classification:
-- each state, one working device is enough, the app report wins over the sign-in device, the
-- sign-in device only without a report. (5) Who is tracked: joined Admins, Staff and the Owner;
-- never invited people, freelancers or deactivated people. (6) The 48 h clock (first login; a
-- state change restarts it), the alert once per 7 days per person, never about the Owner, always
-- emailed, audited. (7) reachability_overview: the Owner everyone with platform and last success,
-- an Admin the people on open tasks they created or approve (a freelancer's coordinator) with
-- state alone, Staff and anon refused, never an endpoint. (8) The hourly pg_cron job. (9) The
-- digest's "Can't be reached" line: 48 h or more, the Owner left out, 5 names then "+N more", and
-- an old payload without the key.
begin;
create extension if not exists pgtap with schema extensions;
select plan(69);

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
delete from public.members;
delete from auth.identities;
delete from auth.users;
delete from public.activity_log;
delete from public.holidays;
-- The base rules, with no release floor (pgTAP 58 tests the floor: migration reachability_clock_from_release).
update public.org_settings set weekly_off_days = '{}', email_daily_cap_org = 90, email_daily_cap_per_member = 20,
  reachability_clock_from = null;

create temporary table fx (key text primary key, id uuid not null);
insert into fx values
  ('owner',   '00000000-0000-4000-8000-000000005601'),
  ('admin1',  '00000000-0000-4000-8000-000000005602'),
  ('admin2',  '00000000-0000-4000-8000-000000005603'),
  ('asha',    '00000000-0000-4000-8000-000000005604'),
  ('bala',    '00000000-0000-4000-8000-000000005605'),
  ('chitra',  '00000000-0000-4000-8000-000000005606'),
  ('dev',     '00000000-0000-4000-8000-000000005607'),
  ('esha',    '00000000-0000-4000-8000-000000005608'),
  ('farah',   '00000000-0000-4000-8000-000000005609'),
  ('gopal',   '00000000-0000-4000-8000-000000005610'),
  ('hari',    '00000000-0000-4000-8000-000000005611'),
  ('indu',    '00000000-0000-4000-8000-000000005612'),
  ('jaya',    '00000000-0000-4000-8000-000000005613'),
  ('kiran',   '00000000-0000-4000-8000-000000005614'),
  ('newbie',  '00000000-0000-4000-8000-000000005615'),
  ('invited', '00000000-0000-4000-8000-000000005616'),
  ('gone',    '00000000-0000-4000-8000-000000005617');
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
create function pg_temp.state(k text) returns text language sql stable as $$ select app.reachability_state(pg_temp.fx(k)); $$;
create function pg_temp.sub(k text, endpoint text, failures integer default 0, reason text default null,
                            disabled timestamptz default null, platform text default 'android',
                            seen timestamptz default now(), success timestamptz default null)
returns void language sql as $$
  insert into public.push_subscriptions (member_id, endpoint, p256dh, auth, platform, failure_count,
                                         disabled_at, disabled_reason, last_seen_at, last_success_at)
  values (pg_temp.fx(k), 'https://push.example/' || endpoint, 'k', 'a', platform, failures,
          case when reason is not null then coalesce(disabled, now()) end, reason, seen, success);
$$;
create function pg_temp.login(k text, ua text, at timestamptz default now()) returns void language sql as $$
  insert into public.session_events (member_id, kind, at, user_agent) values (pg_temp.fx(k), 'login', at, ua);
$$;
create function pg_temp.alerts(k text) returns bigint language sql stable as $$
  select count(*) from public.notifications where kind = 'member_unreachable' and payload ->> 'member_id' = pg_temp.fx(k)::text;
$$;
create function pg_temp.row_of(k text) returns public.member_reachability language sql stable as $$
  select r.* from public.member_reachability r where r.member_id = pg_temp.fx(k);
$$;

-- Everyone joined 60 days ago, but newbie (an hour ago), invited (never joined) and gone.
insert into auth.users (id, email) select id, key || '@example.com' from fx where key <> 'org';
insert into public.members (id, org_id, full_name, email, role, status, joined_at)
select pg_temp.fx(k), pg_temp.fx('org'), initcap(k), k || '@example.com', r::public.member_role, 'active',
       case when k = 'newbie' then now() - interval '1 hour' else now() - interval '60 days' end
from (values ('owner', 'owner'), ('admin1', 'admin'), ('admin2', 'admin'), ('asha', 'staff'), ('bala', 'staff'),
             ('chitra', 'staff'), ('dev', 'staff'), ('esha', 'staff'), ('farah', 'staff'), ('gopal', 'staff'),
             ('hari', 'staff'), ('indu', 'staff'), ('jaya', 'staff'), ('kiran', 'staff'), ('newbie', 'staff'),
             ('gone', 'staff')) as v(k, r);
insert into public.members (id, org_id, full_name, email, role, status, invited_at)
values (pg_temp.fx('invited'), pg_temp.fx('org'), 'Invited', 'invited@example.com', 'staff', 'invited', now());
update public.members set status = 'deactivated', deactivated_at = now() where id = pg_temp.fx('gone');
select pg_temp.as_member('owner');
insert into fx values ('freelancer', public.member_add_freelancer('Zoya Freelance', null, null, pg_temp.fx('hari')));
select pg_temp.as_system();

-- 1. The kind -------------------------------------------------------------------------------------------
select is((select (actionable, always_email, in_app)::text from public.notification_kinds where kind = 'member_unreachable'),
  '(f,t,t)', 'member_unreachable: not actionable, always emailed (5B decision 12), in the bell');

-- 2. The tables: no API access ----------------------------------------------------------------------------
select ok((select relrowsecurity from pg_class where oid = 'public.member_reachability'::regclass)
          and (select relrowsecurity from pg_class where oid = 'public.member_app_reports'::regclass),
  'RLS is on for both tables');
select ok(not has_table_privilege('authenticated', 'public.member_reachability', 'select')
          and not has_table_privilege('anon', 'public.member_reachability', 'select')
          and not has_table_privilege('authenticated', 'public.member_app_reports', 'select')
          and not has_table_privilege('authenticated', 'public.member_app_reports', 'insert')
          and not has_table_privilege('anon', 'public.member_app_reports', 'select'),
  'the API role holds no privilege on either table');
select pg_temp.as_member('owner');
select throws_ok($$ select * from public.member_reachability $$, '42501', null, 'the Owner cannot read the table directly');
select throws_ok($$ select * from public.member_app_reports $$, '42501', null, 'nor the app reports');
select pg_temp.as_system();

-- 3. The app's report -----------------------------------------------------------------------------------------
select pg_temp.as_member('asha');
select is(public.app_open_report('ios', false), true, 'a member''s first report is written');
select is(public.app_open_report('ios', false), false, 'the same report again writes nothing');
select throws_ok($$ select public.app_open_report('symbian', false) $$, 'P0001', null, 'an unknown platform is refused');
select pg_temp.as_member('invited');
select throws_ok($$ select public.app_open_report('android', false) $$, 'P0001', null, 'someone who has not joined cannot report');
select pg_temp.as_anon();
select throws_ok($$ select public.app_open_report('android', false) $$, '42501', null, 'anon cannot report');
select pg_temp.as_system();
select is((select (platform, is_standalone)::text from public.member_app_reports where member_id = pg_temp.fx('asha')),
  '(ios,f)', 'the row is the caller''s own: iOS, not installed');
select is((select count(*) from public.activity_log where entity = 'member_app_reports' and entity_id = pg_temp.fx('asha')),
  1::bigint, 'audited once: only the change is written');

-- 4. Classification ---------------------------------------------------------------------------------------------
select is(pg_temp.state('bala'), 'no_subscription', 'no device at all: never turned on');
select pg_temp.sub('bala', 'bala-ok', 0, null, null, 'android', now(), now() - interval '1 day');
select is(pg_temp.state('bala'), 'ok', 'an active device that worked: ok');
select pg_temp.sub('chitra', 'chitra-new');
select is(pg_temp.state('chitra'), 'ok', 'an active device never tried yet: ok');
select pg_temp.sub('dev', 'dev-once', 1);
select is(pg_temp.state('dev'), 'ok', 'one error is not repeated: ok');
select pg_temp.sub('esha', 'esha-bad', 2);
select pg_temp.sub('esha', 'esha-bad2', 4);
select is(pg_temp.state('esha'), 'failing', 'every active device failing twice or more: failing');
select pg_temp.sub('esha', 'esha-good', 0);
select is(pg_temp.state('esha'), 'ok', 'one working device among failing ones is enough: ok');
select pg_temp.sub('farah', 'farah-gone', 0, 'gone');
select is(pg_temp.state('farah'), 'permission_revoked', 'the last device went gone: permission revoked');
select pg_temp.sub('farah', 'farah-expired', 5, 'expired', now() + interval '1 minute');
select is(pg_temp.state('farah'), 'failing', 'the latest disabled device expired after five errors: failing');
select pg_temp.sub('gopal', 'gopal-signed-out', 0, 'deactivated');
select is(pg_temp.state('gopal'), 'no_subscription', 'a device disabled for any other reason counts as none');
select is(pg_temp.state('asha'), 'ios_not_installed', 'the app reported iOS, not installed: iPhone without the app');
select pg_temp.sub('asha', 'asha-gone', 0, 'gone', null, 'ios');
select is(pg_temp.state('asha'), 'ios_not_installed', 'the report wins over an older revoked device');
select pg_temp.sub('asha', 'asha-installed', 0, null, null, 'ios');
select is(pg_temp.state('asha'), 'ok', 'a working installed subscription: ok');
-- The sign-in device: only without a report.
select pg_temp.login('indu', 'Mozilla/5.0 (Linux; Android 14) Chrome/130', now() - interval '2 days');
select pg_temp.login('indu', 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Safari/604.1', now() - interval '1 day');
select is(pg_temp.state('indu'), 'ios_not_installed', 'no report yet: the latest sign-in from an iPhone decides');
select pg_temp.as_member('indu');
select public.app_open_report('android', false);
select pg_temp.as_system();
select is(pg_temp.state('indu'), 'no_subscription', 'with a report, the report wins over the sign-in device');
select pg_temp.login('jaya', 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Safari/604.1', now() - interval '2 days');
select pg_temp.login('jaya', 'Mozilla/5.0 (Linux; Android 14) Chrome/130', now() - interval '1 day');
select is(pg_temp.state('jaya'), 'no_subscription', 'the latest sign-in decides, not an earlier one');
select pg_temp.login('kiran', 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) Safari/604.1');
select pg_temp.sub('kiran', 'kiran-gone', 0, 'gone');
select is(pg_temp.state('kiran'), 'permission_revoked', 'the sign-in fallback is weaker than a revoked device');
select is((select count(*) from pg_proc where proname = 'reachability_state' and pronamespace = 'app'::regnamespace
           and has_function_privilege('authenticated', oid, 'execute')), 0::bigint,
  'the classification is service_role only');

-- 5. Who is tracked -----------------------------------------------------------------------------------------------
select is((select array_agg(m.full_name order by m.full_name) from app.reachability_live(pg_temp.fx('org'), now()) l
           join public.members m on m.id = l.member_id),
  array['Admin1', 'Admin2', 'Asha', 'Bala', 'Chitra', 'Dev', 'Esha', 'Farah', 'Gopal', 'Hari', 'Indu', 'Jaya',
        'Kiran', 'Newbie', 'Owner'],
  'tracked: joined Admins, Staff and the Owner; never an invited person, a freelancer or a deactivated person');

-- 6. The job: the clock, the alert --------------------------------------------------------------------------------
select is(public.reachability_check(now()), 8, 'the first run alerts about the eight people not ok since joining (60 days)');
select is((select count(*) from public.member_reachability), 15::bigint, 'one row per tracked member');
select is((pg_temp.row_of('gopal')).since, (select joined_at from public.members where id = pg_temp.fx('gopal')),
  'a member never seen starts the clock at their first login (joined_at)');
select is(pg_temp.alerts('owner'), 0::bigint, 'never about the Owner (their banner says it)');
select is(pg_temp.alerts('newbie'), 0::bigint, 'not before 48 h (joined an hour ago)');
select is(pg_temp.alerts('bala'), 0::bigint, 'never about someone reachable');
select is(pg_temp.alerts('freelancer') + pg_temp.alerts('invited') + pg_temp.alerts('gone'), 0::bigint,
  'never about a freelancer, an invited or a deactivated person');
select is((select count(*) from public.notifications where kind = 'member_unreachable' and recipient_id <> pg_temp.fx('owner')),
  0::bigint, 'to the Owner only');
select is((select (title, body, link, actor_id is null, entity is null)::text from public.notifications
           where kind = 'member_unreachable' and payload ->> 'member_id' = pg_temp.fx('gopal')::text),
  ('Gopal can''t be reached', 'Notifications never turned on since ' || app.notify_date(app.to_ist_date(now() - interval '60 days')) || '.',
   '/settings/notifications', true, true)::text,
  'the alert names the person and the reason and opens Settings → Notifications');
select is((select payload from public.notifications where kind = 'member_unreachable' and payload ->> 'member_id' = pg_temp.fx('farah')::text),
  jsonb_build_object('member_id', pg_temp.fx('farah'), 'state', 'failing'), 'its payload: the person and the state, nothing else');
select is(public.reachability_check(now() + interval '1 hour'), 0, 'the next run alerts nobody again');
select is(public.reachability_check(now() + interval '47 hours'), 1, 'the newcomer, once 48 h have passed since their first login');
select is(pg_temp.alerts('newbie'), 1::bigint, 'that one is the newcomer');
select is(public.reachability_check(now() + interval '6 days 23 hours'), 0, 'nobody again within the week');
select is(public.reachability_check(now() + interval '7 days'), 8, 'a week after their alert, the first eight once more');
select is(public.reachability_check(now() + interval '7 days 1 hour'), 0, 'and not again the hour after');
-- A state change restarts the clock.
select is((pg_temp.row_of('bala')).state, 'ok', 'bala is reachable');
update public.push_subscriptions set disabled_at = now(), disabled_reason = 'gone' where member_id = pg_temp.fx('bala');
select public.reachability_check(now() + interval '8 days');
select is(((pg_temp.row_of('bala')).state, (pg_temp.row_of('bala')).since)::text,
  ('permission_revoked', now() + interval '8 days')::text, 'the state changed: since = the run that saw it');
select public.reachability_check(now() + interval '9 days 23 hours');
select is(pg_temp.alerts('bala'), 0::bigint, '47 hours on: no alert yet');
select public.reachability_check(now() + interval '10 days');
select is(pg_temp.alerts('bala'), 1::bigint, '48 hours on: one alert');
select ok((select count(*) from public.activity_log where entity = 'member_reachability') > 0,
  'the rows are audited');
-- Always emailed.
select ok((select count(*) from public.email_claim(now(), 200) c where c.kind = 'member_unreachable') > 0,
  'the dispatcher emails the alert');

-- 7. Settings → Notifications ----------------------------------------------------------------------------------------
create function pg_temp.task(k text, creator text, assignee text, approver text default null) returns uuid language plpgsql as $$
declare
  v_id uuid;
begin
  perform pg_temp.as_member(creator);
  v_id := public.task_create(k, null, (select id from public.task_types where org_id = pg_temp.fx('org') and name = 'Normal'),
    null, 'medium', now() + interval '3 days', array[pg_temp.fx(assignee)], pg_temp.fx(assignee),
    case when approver is null then null else pg_temp.fx(approver) end);
  perform pg_temp.as_system();
  insert into fx values (k, v_id);
  return v_id;
end;
$$;
select pg_temp.task('t_created', 'admin1', 'chitra');
select pg_temp.task('t_approves', 'owner', 'dev', 'admin1');
select pg_temp.task('t_freelancer', 'admin1', 'freelancer');
select pg_temp.task('t_done', 'admin1', 'esha');
select pg_temp.task('t_cancelled', 'admin1', 'farah');
select pg_temp.task('t_archived', 'admin1', 'gopal');
select pg_temp.task('t_other', 'owner', 'jaya', 'admin2');
update public.tasks set state = 'completed', completed_at = now() where id = pg_temp.fx('t_done');
update public.tasks set state = 'cancelled', cancelled_at = now(), cancelled_reason = 'Not needed' where id = pg_temp.fx('t_cancelled');
update public.tasks set archived_at = now() where id = pg_temp.fx('t_archived');

select pg_temp.as_member('owner');
select is((select count(*) from public.reachability_overview()), 15::bigint, 'the Owner sees every tracked member');
select is((select (state, platform, last_success_at is not null)::text from public.reachability_overview()
           where member_id = pg_temp.fx('esha')), '(ok,android,f)'::text,
  'with platform; last success empty when nothing has been delivered');
select is((select (platform, last_success_at is not null)::text from public.reachability_overview() where member_id = pg_temp.fx('bala')),
  '(android,t)', 'and the last delivery that worked');
select is((select platform from public.reachability_overview() where member_id = pg_temp.fx('indu')), 'android',
  'the platform is the app''s own report when there is one');
select is((select (state, since)::text from public.reachability_overview() where member_id = pg_temp.fx('bala')),
  ('permission_revoked', now() + interval '8 days')::text, 'and since when (the stored clock)');
select pg_temp.as_member('admin1');
select is((select array_agg(o.full_name order by o.full_name) from public.reachability_overview() o),
  array['Chitra', 'Dev', 'Hari'],
  'an Admin: the people on open tasks they created or approve, and a freelancer assignee''s coordinator');
select is((select count(*) from public.reachability_overview() where since is not null or platform is not null or last_success_at is not null),
  0::bigint, 'state alone: never since, platform or last success');
select pg_temp.as_member('admin2');
select is((select array_agg(member_id) from public.reachability_overview()), array[pg_temp.fx('jaya')],
  'another Admin sees only the people on their own open tasks');
select pg_temp.as_member('kiran');
select throws_ok($$ select * from public.reachability_overview() $$, 'P0001', null, 'Staff are refused (own devices only, on Me)');
select pg_temp.as_anon();
select throws_ok($$ select * from public.reachability_overview() $$, '42501', null, 'anon is refused');
select pg_temp.as_system();
select ok(pg_get_function_result('public.reachability_overview()'::regprocedure) !~* '(endpoint|p256dh|auth|user_agent)',
  'no endpoint, key or user agent is ever returned');

-- 8. The job ---------------------------------------------------------------------------------------------------------
select results_eq(
  $$ select jobname::text, schedule::text, command::text, active from cron.job where jobname = 'reachability_check' $$,
  $$ values ('reachability_check', '17 * * * *', 'select public.reachability_check(now())', true) $$,
  'pg_cron runs reachability_check every hour');

-- 9. The digest's line ------------------------------------------------------------------------------------------------
create function pg_temp.payload(at timestamptz) returns jsonb language sql stable as $$
  select app.owner_digest_payload(pg_temp.fx('org'), at);
$$;
-- At now + 10 days the store holds: bala not ok since now + 8 days; the Owner, eight others since
-- joining 60 days ago and newbie since an hour ago; asha, chitra, dev and esha ok.
select is(pg_temp.payload(now() + interval '10 days') -> 'unreachable',
  jsonb_build_object('count', 10, 'names', jsonb_build_array('Admin1', 'Admin2', 'Bala', 'Farah', 'Gopal'), 'more', 5),
  'unreachable for 48 h or more, the Owner left out: 5 names by name, then the rest counted');
select is((pg_temp.payload(now() + interval '9 days 23 hours') #>> '{unreachable,count}')::integer, 9,
  'someone not ok for under 48 h is not counted yet');
select ok(app.owner_digest_text(pg_temp.payload(now() + interval '10 days'))
            like E'%People\nCan''t be reached: 10 (Admin1, Admin2, Bala, Farah, Gopal +5 more)%',
  'the body: "Can''t be reached" under "People"');
select is(app.owner_digest_text(jsonb_build_object('unreachable', jsonb_build_object('count', 0, 'names', '[]'::jsonb, 'more', 0))),
  'Nothing needs you today.', 'a line at 0 is left out');
select is(app.owner_digest_text(pg_temp.payload(now() + interval '10 days') - 'unreachable'),
  app.owner_digest_text(pg_temp.payload(now() + interval '10 days') - 'unreachable' || '{"unreachable": {"count": 0, "names": [], "more": 0}}'),
  'a payload written before 5.4 (no key) reads as 0');

select * from finish();
rollback;
