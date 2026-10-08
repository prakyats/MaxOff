-- 5B 5.4 follow-up (migration reachability_clock_from_release; owner 2026-10-03): each person's
-- 48 h "can't be reached" clock starts at the release, not at their first login. On release day
-- the first hourly run alerts nobody who was already unreachable (whether or not the job had
-- recorded them before the release, as on staging), and the digest counts nobody; 48 h after the
-- release, one alert each for whoever is still unreachable. A state change after the release
-- restarts that person's clock as before.
begin;
create extension if not exists pgtap with schema extensions;
select plan(11);

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
delete from public.member_reachability;

create temporary table fx (key text primary key, id uuid not null);
insert into fx values
  ('owner', '00000000-0000-4000-8000-000000005801'),
  ('asha',  '00000000-0000-4000-8000-000000005802'),
  ('bala',  '00000000-0000-4000-8000-000000005803'),
  ('chitra','00000000-0000-4000-8000-000000005804');
insert into fx select 'org', id from public.organizations limit 1;
create function pg_temp.fx(k text) returns uuid language sql stable as $$ select id from fx where key = k; $$;
create function pg_temp.alerts(k text) returns bigint language sql stable as $$
  select count(*) from public.notifications n
  where n.kind = 'member_unreachable' and n.payload ->> 'member_id' = pg_temp.fx(k)::text;
$$;

insert into auth.users (id, email) select id, key || '-58@example.com' from fx where key <> 'org';
insert into public.members (id, org_id, full_name, email, role, status, joined_at)
select pg_temp.fx(k), pg_temp.fx('org'), initcap(k) || ' Fifty-eight', k || '-58@example.com', r::public.member_role,
       'active', now() - interval '40 days'
from (values ('owner', 'owner'), ('asha', 'staff'), ('bala', 'staff'), ('chitra', 'admin')) as v(k, r);

-- The release: the follow-up migration sets the floor to its own moment; here, now.
update public.org_settings set reachability_clock_from = now() where org_id = pg_temp.fx('org');
-- Bala was recorded by the hourly job before the release (as on staging): since = their first login.
insert into public.member_reachability (member_id, org_id, state, since)
values (pg_temp.fx('bala'), pg_temp.fx('org'), 'no_subscription', now() - interval '40 days');

select is((select reachability_clock_from from public.org_settings where org_id = pg_temp.fx('org')), now(),
  'the release moment is recorded once per organisation');

-- Release day: the first hourly run.
select public.reachability_check(now() + interval '17 minutes');
select is(pg_temp.alerts('asha'), 0::bigint, 'release day: no alert for someone unreachable since long before');
select is(pg_temp.alerts('bala'), 0::bigint, 'nor for someone the job had recorded before the release');
select is((select since from public.member_reachability where member_id = pg_temp.fx('asha')), now(),
  'a first record starts at the release, not at the first login');
select is((app.owner_digest_payload(pg_temp.fx('org'), now() + interval '8 hours') #>> '{unreachable,count}')::integer, 0,
  'the next morning''s digest counts nobody yet');

-- 47 h after: still nothing.
select public.reachability_check(now() + interval '47 hours');
select is(pg_temp.alerts('asha') + pg_temp.alerts('bala'), 0::bigint, '47 h after the release: still no alert');

-- Chitra's state changes after the release (a device that worked, then is gone): their clock restarts then.
insert into public.push_subscriptions (member_id, endpoint, p256dh, auth, platform, is_standalone, label)
values (pg_temp.fx('chitra'), 'https://push.example/58-chitra', 'p', 'a', 'android', true, 'Android phone');
select public.reachability_check(now() + interval '20 hours');
update public.push_subscriptions set disabled_at = now() + interval '30 hours', disabled_reason = 'gone'
where member_id = pg_temp.fx('chitra');

-- 48 h after the release, the hourly run.
select public.reachability_check(now() + interval '48 hours 17 minutes');
select is(pg_temp.alerts('asha'), 1::bigint, '48 h after the release: one alert for someone still unreachable');
select is(pg_temp.alerts('bala'), 1::bigint, 'and one for the person recorded before the release');
select is(pg_temp.alerts('chitra'), 0::bigint, 'not for someone whose state changed after the release: their own 48 h');
select is(pg_temp.alerts('owner'), 0::bigint, 'never about the Owner');
select is((app.owner_digest_payload(pg_temp.fx('org'), now() + interval '49 hours') #>> '{unreachable,count}')::integer, 2,
  'and the digest counts the two (the Owner left out)');

select * from finish();
rollback;
