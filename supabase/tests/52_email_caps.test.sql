-- 5.3 (migration email_batches): the email ceilings with the escalation reserve and one email per
-- person per run. Ordinary emails stop at the organisation's ceiling less 10 (80 of 90); an
-- escalation is taken first and skipped only past the full ceiling (90), never by the per-person
-- cap; a person's always-emailed rows of one run are one batch, counted once; a fallback email is
-- on its own. Run as the dispatcher (service_role); no API role may claim.
begin;
create extension if not exists pgtap with schema extensions;
select plan(17);

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
delete from public.notification_deliveries;

create temporary table fx (key text primary key, id uuid not null);
insert into fx values
  ('owner',  '00000000-0000-4000-8000-000000005201'),
  ('admin1', '00000000-0000-4000-8000-000000005202'),
  ('staff1', '00000000-0000-4000-8000-000000005203'),
  ('staff2', '00000000-0000-4000-8000-000000005204'),
  ('filler', '00000000-0000-4000-8000-000000005205');
insert into fx select 'org', id from public.organizations limit 1;

create function pg_temp.fx(k text) returns uuid language sql stable as $$ select id from fx where key = k; $$;
insert into auth.users (id, email) select id, key || '@example.com' from fx where key <> 'org';
insert into public.members (id, org_id, full_name, email, role, status, joined_at)
select pg_temp.fx(k), pg_temp.fx('org'), initcap(k), k || '@example.com', r::public.member_role, 'active', now() - interval '30 days'
from (values ('owner', 'owner'), ('admin1', 'admin'), ('staff1', 'staff'), ('staff2', 'staff'), ('filler', 'staff')) as v(k, r);
update public.org_settings set email_daily_cap_org = 90, email_daily_cap_per_member = 20 where org_id = pg_temp.fx('org');

-- A notification (no push row: the email path only), at `at`.
create function pg_temp.note(who text, kind text, title text, level integer default 0, at timestamptz default now())
returns uuid language sql as $$
  insert into public.notifications (org_id, recipient_id, kind, title, escalation_level, created_at)
  values (pg_temp.fx('org'), pg_temp.fx(who), kind, title, level, at) returning id;
$$;
-- The organisation already sent `n` emails today (the filler's, one batch each).
create function pg_temp.used(n integer) returns void language plpgsql as $$
declare
  v_id uuid;
begin
  delete from public.notification_deliveries;
  delete from public.notifications;
  for i in 1..n loop
    v_id := pg_temp.note('filler', 'reminder_overdue', 'Earlier ' || i, 0, now() - interval '1 minute');
    insert into public.notification_deliveries (notification_id, channel, state, attempts, next_attempt_at, sent_at, created_at)
    values (v_id, 'email', 'sent', 1, now(), now(), now());
  end loop;
end;
$$;
create function pg_temp.state(title text) returns text language sql stable as $$
  select d.state || coalesce(':' || d.last_error, '') from public.notification_deliveries d
  join public.notifications n on n.id = d.notification_id where n.title = $1 and d.channel = 'email';
$$;

-- 1. Only the dispatcher claims -------------------------------------------------------------------------
select ok(not has_function_privilege('authenticated', 'public.email_claim(timestamptz, integer)', 'execute')
          and not has_function_privilege('anon', 'public.email_claim(timestamptz, integer)', 'execute')
          and has_function_privilege('service_role', 'public.email_claim(timestamptz, integer)', 'execute'),
  'email_claim is the dispatcher''s (service_role only)');

-- 2. The reserve ----------------------------------------------------------------------------------------
select pg_temp.used(80);
select pg_temp.note('staff1', 'reminder_overdue', 'Ordinary at 80');
select count(*) from public.email_claim(now(), 50);
select is(pg_temp.state('Ordinary at 80'), 'skipped_cap:org_cap', 'an ordinary email stops at 80 of 90');

select pg_temp.used(85);
select pg_temp.note('admin1', 'escalation_not_noted', 'Escalation at 85', 1);
select count(*) from public.email_claim(now(), 50);
select is(pg_temp.state('Escalation at 85'), 'queued', 'an escalation still goes at 85 (the last 10 are kept for it)');

select pg_temp.used(90);
select pg_temp.note('owner', 'escalation_overdue', 'Escalation at 90', 2);
select count(*) from public.email_claim(now(), 50);
select is(pg_temp.state('Escalation at 90'), 'skipped_cap:org_cap', 'an escalation is skipped only past the full ceiling');

-- Escalations first in a run: with one left before the reserve, the escalation takes it.
select pg_temp.used(79);
select pg_temp.note('staff2', 'reminder_overdue', 'Older ordinary', 0, now() - interval '30 seconds');
select pg_temp.note('admin1', 'escalation_not_noted', 'Newer escalation', 1);
select count(*) from public.email_claim(now(), 50);
select is(pg_temp.state('Newer escalation'), 'queued', 'the escalation is taken first');
select is(pg_temp.state('Older ordinary'), 'skipped_cap:org_cap', 'and the older ordinary one is the one the cap drops');

-- 3. The per-person cap: ordinary stops at 20, an escalation ignores it -----------------------------------
select pg_temp.used(0);
do $$
declare
  v_id uuid;
begin
  for i in 1..20 loop
    v_id := pg_temp.note('staff1', 'reminder_overdue', 'Mine ' || i, 0, now() - interval '1 minute');
    insert into public.notification_deliveries (notification_id, channel, state, attempts, next_attempt_at, sent_at, created_at)
    values (v_id, 'email', 'sent', 1, now(), now(), now());
  end loop;
end;
$$;
select pg_temp.note('staff1', 'reminder_event', 'Twenty-first');
select count(*) from public.email_claim(now(), 50);
select is(pg_temp.state('Twenty-first'), 'skipped_cap:member_cap', 'an ordinary email stops at the person''s 20');
select pg_temp.note('admin1', 'escalation_not_noted', 'Admin escalation', 1);
update public.notifications set recipient_id = pg_temp.fx('staff1') where title = 'Admin escalation';
select count(*) from public.email_claim(now(), 50);
select is(pg_temp.state('Admin escalation'), 'queued', 'an escalation ignores the per-person cap');

-- 4. One email per person per run ----------------------------------------------------------------------
select pg_temp.used(10);
select pg_temp.note('staff2', 'reminder_before_due_last', 'Batch A', 0, now() - interval '20 seconds');
select pg_temp.note('staff2', 'reminder_overdue', 'Batch B', 0, now() - interval '10 seconds');
select pg_temp.note('staff2', 'escalation_not_noted', 'Batch C', 1);
-- A fallback email (an actionable kind, no working push) is on its own.
select pg_temp.note('staff2', 'task_changes_requested', 'Fallback D');
create temporary table claimed as select * from public.email_claim(now(), 50);
select is((select count(distinct c.batch_id) from claimed c where c.title like 'Batch %'), 1::bigint,
  'the person''s three always-emailed rows are one batch');
select is((select count(*) from claimed c where c.title like 'Batch %'), 3::bigint, 'all three go out in it');
select ok((select c.batch_id is null from claimed c where c.title = 'Fallback D'), 'a fallback email is not batched');
select is((select max(c.escalation_level) from claimed c where c.title like 'Batch %'), 1,
  'the batch carries its escalation (the dispatcher words the subject from it)');
select is((select count(distinct coalesce(e.batch_id, e.id)) from public.notification_deliveries e
           where e.channel = 'email' and e.attempts > 0), 12::bigint,
  'and counts once: 10 sent + the batch + the fallback');
-- The batch counted once also when the cap is near: 79 used, a batch of two passes as one.
select pg_temp.used(79);
select pg_temp.note('staff1', 'reminder_overdue', 'Near A', 0, now() - interval '5 seconds');
select pg_temp.note('staff1', 'reminder_before_due_last', 'Near B');
select count(*) from public.email_claim(now(), 50);
select is(pg_temp.state('Near A') || ' ' || pg_temp.state('Near B'), 'queued queued',
  'two rows of one person at 79 go together as the 80th email');
select pg_temp.note('staff2', 'reminder_overdue', 'After the batch');
select count(*) from public.email_claim(now(), 50);
select is(pg_temp.state('After the batch'), 'skipped_cap:org_cap', 'and the next ordinary one is past 80');

-- 5. Quiet hours hold the push, never the email of an always-emailed reminder (owed by 5.3) ---------------
select pg_temp.used(0);
update public.org_settings
set quiet_hours_start = ((now() - interval '1 hour') at time zone 'Asia/Kolkata')::time,
    quiet_hours_end = ((now() + interval '1 hour') at time zone 'Asia/Kolkata')::time
where org_id = pg_temp.fx('org');
select pg_temp.note('staff1', 'reminder_overdue', 'Overdue at night');
insert into public.notification_deliveries (notification_id, channel, state, next_attempt_at)
select id, 'push', 'queued', now() from public.notifications where title = 'Overdue at night';
insert into public.push_subscriptions (member_id, endpoint, p256dh, auth, platform)
values (pg_temp.fx('staff1'), 'https://push.example.com/quiet', 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
        'BTBZMqHH6r4Tts7J_aSIgg', 'android');
select count(*) from public.push_claim(now(), 50);
select is((select d.state from public.notification_deliveries d join public.notifications n on n.id = d.notification_id
           where n.title = 'Overdue at night' and d.channel = 'push'), 'held', 'inside quiet hours the push is held');
select count(*) from public.email_claim(now(), 50);
select is(pg_temp.state('Overdue at night'), 'queued', 'and the always-emailed reminder''s email goes now, not held');

select * from finish();
rollback;
