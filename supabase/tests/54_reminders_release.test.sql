-- 5.3 follow-ups (migration reminders_followups; owner 2026-10-02). (1) The end-day reminder inside
-- reminders_tick keeps its time and recipients and its bookkeeping across the release: the old
-- cron job is gone (unscheduled in the same migration that scheduled the tick, so one job, never
-- two, never none), the tick sends it once in [logout_reminder_time, +5 min) to whoever started
-- and has not ended their day, and a reminder the old job already sent that day is never sent
-- again by the tick (release day). (2) The release backfill: only open, unarmed tasks; only
-- reminders still ahead; an already overdue task's escalation and every acknowledgement clock count
-- from the backfill; a dry run writes nothing; a second run arms nothing. (3) The staging dry run's
-- acknowledgement preview (owner 2026-10-03) counts what the tick then really sends.
begin;
create extension if not exists pgtap with schema extensions;
select plan(29);

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
  ('owner',  '00000000-0000-4000-8000-000000005401'),
  ('admin1', '00000000-0000-4000-8000-000000005402'),
  ('staff1', '00000000-0000-4000-8000-000000005403'),
  ('staff2', '00000000-0000-4000-8000-000000005404');
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
create function pg_temp.at(t interval) returns timestamptz language sql stable as $$
  select app.ist_day_start(app.today_ist()) + t;
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

-- 1. The end-day reminder inside the tick ----------------------------------------------------------------
select is((select count(*) from cron.job where command like '%end_day_reminder%'), 0::bigint,
  'no cron job calls end_day_reminder on its own any more (unscheduled with the tick''s scheduling)');
select is((select count(*) from cron.job where jobname = 'reminders_tick' and schedule = '*/5 * * * *'), 1::bigint,
  'one job runs it: reminders_tick, every 5 minutes, the old job''s own schedule');
insert into public.attendance_days (member_id, work_date, started_at, is_day_off) values
  (pg_temp.fx('staff1'), app.today_ist(), pg_temp.at('9 hours 30 minutes'), false),
  (pg_temp.fx('admin1'), app.today_ist(), pg_temp.at('10 hours'), false);
select app.reminders_tick(pg_temp.at('20 hours 25 minutes'));
select is(pg_temp.n('staff1', 'end_day_reminder'), 0::bigint, '20:25: before the time, nothing');
select app.reminders_tick(pg_temp.at('20 hours 30 minutes'));
select is(pg_temp.n('staff1', 'end_day_reminder') + pg_temp.n('admin1', 'end_day_reminder'), 2::bigint,
  '20:30: everyone who started and has not ended, as before');
select is((select title || ' | ' || link from public.notifications where recipient_id = pg_temp.fx('staff1') and kind = 'end_day_reminder'),
  'You haven''t ended your day | /my-day', 'the same words and link as the job of its own');
select is((select link from public.notifications where recipient_id = pg_temp.fx('admin1') and kind = 'end_day_reminder'),
  '/today', 'an Admin''s opens Today, as before');
select app.reminders_tick(pg_temp.at('20 hours 34 minutes'));
select is(pg_temp.n('staff1', 'end_day_reminder'), 1::bigint, 'a second tick in the window sends nothing twice');
select app.reminders_tick(pg_temp.at('20 hours 35 minutes'));
select is(pg_temp.n('staff2', 'end_day_reminder'), 0::bigint, 'nobody without a Start day');
-- Release day: the old job already sent staff2's at 20:30; the tick at 20:30 or after sends no second.
delete from public.notifications;
insert into public.attendance_days (member_id, work_date, started_at, is_day_off) values
  (pg_temp.fx('staff2'), app.today_ist(), pg_temp.at('11 hours'), false);
select app.end_day_reminder(pg_temp.at('20 hours 30 minutes'));
select is(pg_temp.n('staff2', 'end_day_reminder'), 1::bigint, '(the old job''s run, as on release day)');
select app.reminders_tick(pg_temp.at('20 hours 30 minutes'));
select app.reminders_tick(pg_temp.at('20 hours 34 minutes 59 seconds'));
select is(pg_temp.n('staff2', 'end_day_reminder'), 1::bigint,
  'the tick after the old job: no second reminder (the notification row is the record)');
select is(pg_temp.n('staff1', 'end_day_reminder') + pg_temp.n('admin1', 'end_day_reminder'), 2::bigint,
  'and the ones the old job had not reached yet are sent by the tick (none missed)');

-- 2. The release backfill ------------------------------------------------------------------------------
delete from public.attendance_days;
delete from public.notifications;
select pg_temp.mk('open_todo', now() + interval '3 days', array['staff1'], 'admin1');
select pg_temp.mk('soon', now() + interval '30 hours', array['staff2']);
select pg_temp.mk('overdue', now() + interval '1 day', array['staff1']);
select pg_temp.mk('submitted', now() + interval '3 days', array['staff2']);
select pg_temp.mk('cancelled', now() + interval '3 days', array['staff2']);
select pg_temp.as_member('staff2');
select public.task_submit_done(pg_temp.fx('submitted'), 'https://example.com/x');
select pg_temp.as_member('owner');
select public.task_cancel(pg_temp.fx('cancelled'), 'No longer needed');
select pg_temp.as_system();
select pg_temp.legacy(k, interval '10 hours') from unnest(array['open_todo', 'soon', 'overdue', 'submitted', 'cancelled']) k;
-- Already overdue by 2 hours when the release ships.
update public.tasks set due_at = now() - interval '2 hours' where id = pg_temp.fx('overdue');
delete from public.task_reminders where task_id = pg_temp.fx('overdue');
-- A task created after the migration (already armed) is left alone.
select pg_temp.mk('new', now() + interval '3 days', array['staff1']);

select results_eq($$ select tasks, reminders from app.reminders_backfill(now(), true) $$,
  $$ values (3, 10) $$, 'a dry run counts: 3 open tasks, 10 reminders (5 + 4 + 1)');
select is((select count(*) from public.task_reminder_arms where task_id in
           (pg_temp.fx('open_todo'), pg_temp.fx('soon'), pg_temp.fx('overdue'))), 0::bigint, 'and writes nothing');
select results_eq($$ select tasks, reminders from app.reminders_backfill(now(), false) $$,
  $$ values (3, 10) $$, 'the run arms the same');
select is(pg_temp.open('open_todo'), 'before_due before_due due overdue overdue_escalation',
  'an open task: its whole schedule, all of it ahead');
select is(pg_temp.open('soon'), 'before_due due overdue overdue_escalation', 'only reminders still ahead (2 days before is past)');
select is(pg_temp.open('overdue'), 'overdue_escalation', 'already overdue: nothing past, only the escalation');
select is((select fire_at from public.task_reminders where task_id = pg_temp.fx('overdue') and kind = 'overdue_escalation' and cancelled_at is null),
  now() + interval '24 hours', 'which counts 24 h from the backfill, not from the deadline');
select is((select count(*) from public.task_reminder_arms where task_id in (pg_temp.fx('submitted'), pg_temp.fx('cancelled'))),
  0::bigint, 'submitted and cancelled tasks are not armed');
select results_eq($$ select tasks, reminders from app.reminders_backfill(now(), false) $$,
  $$ values (0, 0) $$, 'idempotent: a second run arms nothing');
-- Acknowledgement clocks count from the backfill: assigned 10 h ago, nobody noted.
select app.reminders_tick(now() + interval '1 minute');
select is(pg_temp.n('staff1', 'reminder_not_noted', 'open_todo') + pg_temp.n('admin1', 'escalation_not_noted', 'open_todo')
          + pg_temp.n('owner', 'escalation_not_noted', 'open_todo'), 0::bigint,
  'release day: no repeat and no escalation for an old task');
select app.reminders_tick(now() + interval '2 hours 1 minute');
select is(pg_temp.n('staff1', 'reminder_not_noted', 'open_todo'), 1::bigint, 'the first repeat 2 h after the backfill');
select app.reminders_tick(now() + interval '4 hours 1 minute');
select is(pg_temp.n('admin1', 'escalation_not_noted', 'open_todo'), 1::bigint, 'the 4 h escalation 4 h after it');
select is(pg_temp.n('owner', 'escalation_not_noted', 'open_todo'), 0::bigint, 'the Owner''s not before 8 h after it');

-- 3. The acknowledgement preview (owner, 2026-10-03) -------------------------------------------------------
select results_eq($$ select * from app.reminders_backfill_ack_preview() $$, $$ values (0, 0, 0, 0, 0) $$,
  'after the backfill: no task left to arm, nothing to start');
-- Four old tasks nobody armed: an Admin approves one; the Owner leads one alone; one has two people,
-- one of whom has noted; one an Admin created for themselves and has not noted (no escalation to
-- themselves; the Owner's still goes).
select pg_temp.mk('p_admin', now() + interval '3 days', array['staff1'], 'admin1');
select pg_temp.mk('p_owner', now() + interval '3 days', array['staff2']);
select pg_temp.mk('p_mixed', now() + interval '3 days', array['staff1', 'staff2'], 'admin1');
select pg_temp.mk('p_self', now() + interval '3 days', array['admin1']);
update public.tasks set created_by = pg_temp.fx('admin1') where id = pg_temp.fx('p_self');
select pg_temp.as_member('staff2');
select public.task_acknowledge(pg_temp.fx('p_mixed'));
select pg_temp.as_system();
select pg_temp.legacy(k, interval '10 hours') from unnest(array['p_admin', 'p_owner', 'p_mixed', 'p_self']) k;
select results_eq($$ select * from app.reminders_backfill_ack_preview() $$, $$ values (4, 3, 3, 3, 3) $$,
  'the preview: 4 not noted, 3 lead escalations naming 3, 3 Owner escalations naming 3');
-- The same tasks through the real backfill and tick: what the preview said is what is sent.
select app.reminders_backfill(now(), false);
create function pg_temp.sent(kind text, level integer) returns bigint language sql stable as $$
  select count(*) from public.notifications x
  where x.kind = $1 and x.escalation_level = $2
    and x.entity_id in (pg_temp.fx('p_admin'), pg_temp.fx('p_owner'), pg_temp.fx('p_mixed'), pg_temp.fx('p_self'));
$$;
select app.reminders_tick(now() + interval '2 hours 1 minute');
select is(pg_temp.sent('reminder_not_noted', 0), 4::bigint, 'the tick: 4 repeats at 2 h');
select app.reminders_tick(now() + interval '4 hours 1 minute');
select is(pg_temp.sent('escalation_not_noted', 1), 3::bigint, '3 lead escalations at 4 h');
select app.reminders_tick(now() + interval '8 hours 1 minute');
select is(pg_temp.sent('escalation_not_noted', 2), 3::bigint, '3 Owner escalations at 8 h');

select * from finish();
rollback;
