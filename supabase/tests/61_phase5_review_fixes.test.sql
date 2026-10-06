-- Phase 5 review fixes (migration phase5_review_fixes, 2026-10-06). (1) reminders_tick runs each row in a
-- savepoint of its own: one failing task row is logged and retried, never costing the end-day reminder or
-- anyone else's reminder. (2) A quiet-hours window starting at 00:00 holds a reminder until its end.
-- (3) app_open_report: an active permanent member (a freelancer has no login; the refusal is in the
-- function). (4) No public security-definer function is executable by anon or PUBLIC.
begin;
create extension if not exists pgtap with schema extensions;
select plan(10);

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
  ('owner',  '00000000-0000-4000-8000-000000006101'),
  ('admin1', '00000000-0000-4000-8000-000000006102'),
  ('staff1', '00000000-0000-4000-8000-000000006103'),
  ('staff2', '00000000-0000-4000-8000-000000006104');
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
create function pg_temp.as_system() returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', '', true);
end;
$$;
-- Section 1's day is tomorrow (IST): its tasks are due at 20:30 that day, which task_create refuses once
-- it has passed, so a run after 20:30 IST today failed (PR #45's CI at 20:47 IST). Tomorrow is always ahead.
create function pg_temp.day() returns date language sql stable as $$ select app.today_ist() + 1; $$;
create function pg_temp.at(t interval) returns timestamptz language sql stable as $$
  select app.ist_day_start(pg_temp.day()) + t;
$$;
create function pg_temp.mk(k text, due timestamptz, assignees text[], approver text default null) returns uuid language plpgsql as $$
declare
  v_id uuid;
begin
  perform pg_temp.as_member('owner');
  v_id := public.task_create(k, null, (select id from public.task_types where org_id = pg_temp.fx('org') and name = 'Normal'),
    null, 'medium', due, array(select pg_temp.fx(a) from unnest(assignees) a), pg_temp.fx(assignees[1]),
    case when approver is null then null else pg_temp.fx(approver) end);
  perform pg_temp.as_system();
  insert into fx values (k, v_id);
  return v_id;
end;
$$;
-- A task as it was before 5.3: not armed, no reminders, assigned `ago`.
create function pg_temp.legacy(k text, ago interval) returns void language sql as $$
  delete from public.task_reminders where task_id = pg_temp.fx(k);
  delete from public.task_reminder_arms where task_id = pg_temp.fx(k);
  update public.task_assignees set assigned_at = now() - ago where task_id = pg_temp.fx(k);
$$;
create function pg_temp.n(who text, kind text, task text default null) returns bigint language sql stable as $$
  select count(*) from public.notifications x
  where x.recipient_id = pg_temp.fx(who) and x.kind = $2 and ($3 is null or x.entity_id = pg_temp.fx($3));
$$;
create function pg_temp.open(k text) returns text language sql stable as $$
  select coalesce(string_agg(r.kind, ' ' order by r.fire_at, r.kind), '')
  from public.task_reminders r where r.task_id = pg_temp.fx(k) and r.member_id is null and r.sent_at is null and r.cancelled_at is null;
$$;

insert into auth.users (id, email) select id, key || '@example.com' from fx where key <> 'org';
insert into public.members (id, org_id, full_name, email, role, status, joined_at)
select pg_temp.fx(k), pg_temp.fx('org'), initcap(k), k || '@example.com', r::public.member_role, 'active', now() - interval '60 days'
from (values ('owner', 'owner'), ('admin1', 'admin'), ('staff1', 'staff'), ('staff2', 'staff')) as v(k, r);
update public.task_types set default_reminders = '[]' where org_id = pg_temp.fx('org');
update public.org_settings set default_task_reminders = '[]', logout_reminder_time = '20:30', quiet_hours_start = '22:00',
  quiet_hours_end = '07:00', ack_repeat_hours = 2, ack_escalate_hours = 4, ack_escalate_owner_hours = 8, overdue_escalate_hours = 24
where org_id = pg_temp.fx('org');

-- 1. One failing task row never costs the end-day reminder or anyone else's reminder ---------------------
-- A reminder titled with BOOM fails (as a bad task row would), only inside this test.
create function pg_temp.boom() returns trigger language plpgsql as $$
begin
  if new.kind like 'reminder%' and new.title like '%BOOM%' then
    raise exception 'a bad row';
  end if;
  return new;
end;
$$;
create trigger boom before insert on public.notifications for each row execute function pg_temp.boom();
update public.org_settings set default_task_reminders = '[{"before": 0, "unit": "minutes"}]' where org_id = pg_temp.fx('org');
insert into public.attendance_days (member_id, work_date, started_at, is_day_off) values
  (pg_temp.fx('staff1'), pg_temp.day(), pg_temp.at('9 hours 30 minutes'), false);
select pg_temp.mk('BOOM task', pg_temp.at('20 hours 30 minutes'), array['staff2']);
select pg_temp.mk('fine task', pg_temp.at('20 hours 30 minutes'), array['staff2']);
select lives_ok($$ select app.reminders_tick(pg_temp.at('20 hours 31 minutes')) $$,
  'the tick runs to the end although one row fails');
select is(pg_temp.n('staff1', 'end_day_reminder'), 1::bigint, 'the end-day reminder still goes out');
select is(pg_temp.n('staff2', 'reminder_due_now', 'fine task'), 1::bigint, 'and the other task''s reminder');
select is((select count(*) from public.task_reminders where task_id = pg_temp.fx('BOOM task') and kind = 'due'
             and sent_at is null and cancelled_at is null), 1::bigint,
  'the failing row is left unsent for the next run (logged, not lost)');
drop trigger boom on public.notifications;
select app.reminders_tick(pg_temp.at('20 hours 36 minutes'));
select is(pg_temp.n('staff2', 'reminder_due_now', 'BOOM task'), 1::bigint, 'once it can be sent, the next run sends it');

-- 2. A quiet-hours window that starts at 00:00 holds until its end ------------------------------------------
update public.org_settings set quiet_hours_start = '00:00', quiet_hours_end = '07:00' where org_id = pg_temp.fx('org');
select is(app.reminder_resume_at(pg_temp.fx('staff1'), pg_temp.fx('org'), app.today_ist()),
  app.ist_day_start(app.today_ist() + 1) + interval '7 hours',
  'a 00:00-07:00 window: a held reminder comes back at 07:00, not at midnight');
update public.org_settings set quiet_hours_start = '22:00', quiet_hours_end = '07:00' where org_id = pg_temp.fx('org');
select is(app.reminder_resume_at(pg_temp.fx('staff1'), pg_temp.fx('org'), app.today_ist()),
  app.ist_day_start(app.today_ist() + 1) + interval '7 hours', 'a window across midnight: as before');
update public.org_settings set quiet_hours_start = '13:00', quiet_hours_end = '14:00' where org_id = pg_temp.fx('org');
select is(app.reminder_resume_at(pg_temp.fx('staff1'), pg_temp.fx('org'), app.today_ist()),
  app.ist_day_start(app.today_ist() + 1), 'a window that misses midnight: the start of the day, as before');

-- 3. The app's report: an active permanent member only ---------------------------------------------------------
select pg_temp.as_member('staff1');
select lives_ok($$ select public.app_open_report('android', false) $$, 'a team member reports their device');
select pg_temp.as_system();

-- 4. No public security-definer function is open to anon (a catalogue-wide check, phase 5 review) ------------
select is((select count(*) from pg_proc p
           where p.pronamespace = 'public'::regnamespace and p.prosecdef
             and has_function_privilege('anon', p.oid, 'execute')), 0::bigint,
  'no public security-definer function can be executed by anon (or PUBLIC)');

select * from finish();
rollback;
