-- 5.3 (migration task_reminders): the reminder schedule and reminders_tick. RLS per role (no API
-- access to either table), the rule lists and their resolution, arming (a past time skipped, an
-- event's 18:00 the day before, re-arming on a moved deadline, nothing re-sent on a reopen with
-- the same deadline, a task that existed before the migration never armed), the tick (each kind,
-- its recipients, never twice, stale or no-longer-active rows skipped), the pause (full-day
-- leave held to the next working day and brought back as one message or dropped; half days and
-- weekly days off pause nothing), the acknowledgement repeats and the not-noted escalations.
begin;
create extension if not exists pgtap with schema extensions;
select plan(56);

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
  ('owner',  '00000000-0000-4000-8000-000000005101'),
  ('admin1', '00000000-0000-4000-8000-000000005102'),
  ('staff1', '00000000-0000-4000-8000-000000005103'),
  ('staff2', '00000000-0000-4000-8000-000000005104'),
  ('staff3', '00000000-0000-4000-8000-000000005105');
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
create function pg_temp.type_id(n text) returns uuid language sql stable as $$
  select tt.id from public.task_types tt where tt.org_id = pg_temp.fx('org') and tt.name = n;
$$;
-- A task the Owner assigns: due at `due`, its own rules (null: the next level), an approving Admin.
create function pg_temp.mk(k text, due timestamptz, assignees text[], approver text default null,
  rules jsonb default null) returns uuid language plpgsql as $$
declare
  v_id uuid;
begin
  perform pg_temp.as_member('owner');
  v_id := public.task_create(k, null, pg_temp.type_id('Normal'), null, 'medium', due,
    array(select pg_temp.fx(a) from unnest(assignees) a), pg_temp.fx(assignees[1]),
    case when approver is null then null else pg_temp.fx(approver) end, reminder_rules => rules);
  perform pg_temp.as_system();
  insert into fx values (k, v_id);
  return v_id;
end;
$$;
-- The armed schedule of a task, in firing order: kind, minutes before, last before-due.
create function pg_temp.armed(k text) returns text language sql stable as $$
  select string_agg(r.kind || ':' || coalesce(r.offset_minutes::text, '-') || case when r.last_before_due then '*' else '' end,
                    ' ' order by r.fire_at, r.kind)
  from public.task_reminders r where r.task_id = pg_temp.fx(k) and r.member_id is null and r.sent_at is null and r.cancelled_at is null;
$$;
-- A person's notifications of a kind about a task.
create function pg_temp.n(who text, kind text, task text) returns bigint language sql stable as $$
  select count(*) from public.notifications x
  where x.recipient_id = pg_temp.fx(who) and x.kind = $2 and x.entity_id = pg_temp.fx(task);
$$;
create function pg_temp.tick(at timestamptz) returns integer language sql as $$ select app.reminders_tick(at) $$;

insert into auth.users (id, email) select id, key || '@example.com' from fx where key <> 'org';
insert into public.members (id, org_id, full_name, email, role, status, joined_at)
select pg_temp.fx(k), pg_temp.fx('org'), initcap(k), k || '@example.com', r::public.member_role, 'active', now() - interval '60 days'
from (values ('owner', 'owner'), ('admin1', 'admin'), ('staff1', 'staff'), ('staff2', 'staff'), ('staff3', 'staff')) as v(k, r);
update public.task_types set default_reminders = '[]' where org_id = pg_temp.fx('org');
update public.org_settings set default_task_reminders = '[]', quiet_hours_start = '22:00', quiet_hours_end = '07:00',
  ack_repeat_hours = 2, ack_escalate_hours = 4, ack_escalate_owner_hours = 8, overdue_escalate_hours = 24
where org_id = pg_temp.fx('org');

-- 1. No API access, for any role ------------------------------------------------------------------------
select pg_temp.mk('t1', now() + interval '3 days', array['staff1', 'staff2'], 'admin1');
select pg_temp.as_member('owner');
select throws_ok('select count(*) from public.task_reminders', '42501', null, 'the Owner cannot read the schedule (the job''s)');
select throws_ok('select count(*) from public.task_reminder_arms', '42501', null, 'nor the armed tasks');
select pg_temp.as_member('admin1');
select throws_ok('select count(*) from public.task_reminders', '42501', null, 'an Admin cannot read the schedule');
select pg_temp.as_member('staff1');
select throws_ok('select count(*) from public.task_reminders', '42501', null, 'a Crew member (staff) cannot read it');
select throws_ok(format($$ insert into public.task_reminders (org_id, task_id, kind, fire_at) values (%L, %L, 'due', now()) $$,
  pg_temp.fx('org'), pg_temp.fx('t1')), '42501', null, 'nor write it');
select pg_temp.as_anon();
select throws_ok('select count(*) from public.task_reminders', '42501', null, 'a signed-out caller is refused');
select pg_temp.as_system();
select ok(not has_function_privilege('authenticated', 'app.reminders_tick(timestamptz)', 'execute')
          and has_function_privilege('service_role', 'app.reminders_tick(timestamptz)', 'execute'),
  'the tick is the job''s (service_role only)');
select is((select schedule from cron.job where jobname = 'reminders_tick'), '*/5 * * * *', 'reminders_tick runs every 5 minutes');
select is((select count(*) from cron.job where jobname = 'end_day_reminder'), 0::bigint, 'end_day_reminder''s own job is folded into it');

-- 2. Arming ---------------------------------------------------------------------------------------------
select is(pg_temp.armed('t1'), 'before_due:2880 before_due:1440* due:0 overdue:- overdue_escalation:-',
  'a new task follows the launch schedule: 2 days, 1 day (the last before-due), Due now, overdue, the escalation');
select ok(exists (select 1 from public.task_reminder_arms where task_id = pg_temp.fx('t1')), 'a new task is armed');
select pg_temp.mk('t2', now() + interval '30 hours', array['staff1']);
select is(pg_temp.armed('t2'), 'before_due:1440* due:0 overdue:- overdue_escalation:-',
  'a time already past is skipped, never sent late (2 days before a deadline 30 h away)');
select pg_temp.as_member('owner');
insert into fx values ('e1', public.task_create('Shoot', null, pg_temp.type_id('Meeting'), null, 'high', now() + interval '3 days',
  array[pg_temp.fx('staff1')], pg_temp.fx('staff1'), pg_temp.fx('admin1'), event_date => app.today_ist() + 2,
  location => 'Studio', purpose => 'Reel'));
select pg_temp.as_system();
select is((select r.fire_at from public.task_reminders r where r.task_id = pg_temp.fx('e1') and r.kind = 'event'),
  app.ist_day_start(app.today_ist() + 1) + interval '18 hours', 'an event task: 18:00 IST the day before');

-- 3. The lists: own, type, organisation, launch; their shape ---------------------------------------------
select pg_temp.mk('own', now() + interval '3 days', array['staff1'], null, '[{"before": 3, "unit": "hours"}]');
select is(pg_temp.armed('own'), 'before_due:180* overdue:- overdue_escalation:-', 'the task''s own list replaces the rest');
update public.task_types set default_reminders = '[{"before": 1, "unit": "hours"}]' where name = 'Normal' and org_id = pg_temp.fx('org');
select pg_temp.mk('typed', now() + interval '3 days', array['staff1'], null, '[]');
select is(pg_temp.armed('typed'), 'before_due:60* overdue:- overdue_escalation:-', 'an empty list follows the type''s');
update public.task_types set default_reminders = '[]' where name = 'Normal' and org_id = pg_temp.fx('org');
update public.org_settings set default_task_reminders = '[{"before": 5, "unit": "hours"}, {"before": 0, "unit": "minutes"}]'
where org_id = pg_temp.fx('org');
select pg_temp.mk('orged', now() + interval '3 days', array['staff1'], null, '[]');
select is(pg_temp.armed('orged'), 'before_due:300* due:0 overdue:- overdue_escalation:-', 'then the organisation''s');
update public.org_settings set default_task_reminders = '[]' where org_id = pg_temp.fx('org');
select throws_ok($$ update public.task_types set default_reminders = (select jsonb_agg(jsonb_build_object('before', g, 'unit', 'hours'))
                      from generate_series(1, 6) g) where name = 'Normal' $$, '23514', null, 'a list holds at most 5');
select throws_ok($$ update public.org_settings set default_task_reminders = '[{"before": 1, "unit": "weeks"}]' $$,
  '23514', null, 'minutes, hours or days only');
select ok(not app.reminder_rules_valid('[{"before": 1, "unit": "days"}, {"before": 24, "unit": "hours"}]')
          and not app.reminder_rules_valid('[{"before": 61, "unit": "days"}]')
          and not app.reminder_rules_valid('[{"before": -1, "unit": "days"}]')
          and app.reminder_rules_valid('[]'), 'no two the same, up to 60 days, never negative; empty is "the next level"');

-- 4. No backfill: a task that existed before the migration is never armed --------------------------------
select pg_temp.mk('legacy', now() + interval '3 days', array['staff2']);
delete from public.task_reminders where task_id = pg_temp.fx('legacy');
delete from public.task_reminder_arms where task_id = pg_temp.fx('legacy');
update public.tasks set due_at = now() + interval '4 days' where id = pg_temp.fx('legacy');
select is((select count(*) from public.task_reminders where task_id = pg_temp.fx('legacy')), 0::bigint,
  'a moved deadline on an unarmed (pre-5.3) task arms nothing');

-- 5. Re-arming -------------------------------------------------------------------------------------------
select pg_temp.as_member('owner');
select public.task_update_assignment(pg_temp.fx('t1'), jsonb_build_object('due_at', now() + interval '5 days'));
select pg_temp.as_system();
select is((select count(*) from public.task_reminders where task_id = pg_temp.fx('t1') and cancelled_at is not null), 5::bigint,
  'a moved deadline cancels what was not sent');
select is((select count(*) from public.task_reminders where task_id = pg_temp.fx('t1') and cancelled_at is null
           and deadline = (select due_at from public.tasks where id = pg_temp.fx('t1'))), 5::bigint, 'and arms the new deadline');

-- 6. The pause: full-day leave holds; half days and weekly days off do not -------------------------------
insert into public.leave_requests (member_id, type, start_date, end_date, state, source, decided_by, decided_at)
values (pg_temp.fx('staff3'), 'leave', app.today_ist(), app.today_ist() + 1, 'approved', 'owner', pg_temp.fx('owner'), now()),
       (pg_temp.fx('staff2'), 'half_day', app.today_ist(), app.today_ist(), 'approved', 'owner', pg_temp.fx('owner'), now());
select ok(app.reminder_paused(pg_temp.fx('staff3'), pg_temp.fx('org'), app.today_ist())
          and not app.reminder_paused(pg_temp.fx('staff2'), pg_temp.fx('org'), app.today_ist()),
  'full-day leave pauses; a half day does not');
update public.org_settings set weekly_off_days = array[extract(dow from app.today_ist())::smallint] where org_id = pg_temp.fx('org');
select ok(not app.reminder_paused(pg_temp.fx('staff1'), pg_temp.fx('org'), app.today_ist()), 'a weekly day off pauses nothing');
update public.org_settings set weekly_off_days = '{}' where org_id = pg_temp.fx('org');
insert into public.holidays (org_id, date, name) values (pg_temp.fx('org'), app.today_ist() + 30, 'Festival');
select ok(app.reminder_paused(pg_temp.fx('staff1'), pg_temp.fx('org'), app.today_ist() + 30), 'a holiday pauses everyone');
select is(app.reminder_resume_at(pg_temp.fx('staff3'), pg_temp.fx('org'), app.today_ist()),
  app.ist_day_start(app.today_ist() + 2) + interval '7 hours', 'the next working day (leave ends tomorrow), when the quiet hours end');

select pg_temp.mk('h1', now() + interval '4 days 2 minutes', array['staff3', 'staff1'], null, '[{"before": 4, "unit": "days"}]');
select pg_temp.mk('h2', now() + interval '4 days 3 minutes', array['staff3'], null, '[{"before": 4, "unit": "days"}]');
select pg_temp.mk('h3', now() + interval '4 days 2 minutes', array['staff2'], null, '[{"before": 4, "unit": "days"}]');
select pg_temp.tick(now() + interval '4 minutes');
select is(pg_temp.n('staff1', 'reminder_before_due_last', 'h1'), 1::bigint, 'the reminder goes to the assignee at work');
select is(pg_temp.n('staff3', 'reminder_before_due_last', 'h1') + pg_temp.n('staff3', 'reminder_before_due_last', 'h2'), 0::bigint,
  'the one on leave gets nothing today');
select is((select count(*) from public.task_reminders where member_id = pg_temp.fx('staff3') and held and sent_at is null
           and fire_at = app.ist_day_start(app.today_ist() + 2) + interval '7 hours'), 2::bigint,
  'both are held to their next working day at 07:00 IST');
select is(pg_temp.n('staff2', 'reminder_before_due_last', 'h3'), 1::bigint, 'a half day holds nothing');
select pg_temp.tick(app.ist_day_start(app.today_ist() + 2) + interval '7 hours 1 minute');
select is((select count(*) from public.notifications where recipient_id = pg_temp.fx('staff3')
           and title = 'While you were away: 2 tasks are due soon' and kind = 'reminder_before_due_last'), 1::bigint,
  'back at work: one message for the two, as the always-emailed kind it held');
select is((select count(*) from public.task_reminders where member_id = pg_temp.fx('staff3') and held and sent_at is null and cancelled_at is null),
  0::bigint, 'and nothing is held any more');
-- Held past its deadline: dropped (the overdue reminder covers it).
select pg_temp.mk('h4', now() + interval '1 day 2 minutes', array['staff3'], null, '[{"before": 1, "unit": "days"}]');
select pg_temp.tick(now() + interval '5 minutes');
update public.task_reminders set fire_at = (select due_at from public.tasks where id = pg_temp.fx('h4')) + interval '10 minutes'
where task_id = pg_temp.fx('h4') and held;
select pg_temp.tick((select due_at from public.tasks where id = pg_temp.fx('h4')) + interval '20 minutes');
select is((select count(*) from public.notifications where recipient_id = pg_temp.fx('staff3') and title like 'While you were away: h4%'),
  0::bigint, 'a held reminder whose deadline has passed is dropped');

-- 7. Acknowledgement repeats ---------------------------------------------------------------------------
select pg_temp.mk('a1', now() + interval '6 days', array['staff1']);
select pg_temp.tick(now() + interval '2 hours 1 minute');
select is(pg_temp.n('staff1', 'reminder_not_noted', 'a1'), 1::bigint, 'two hours after assignment: please note this task');
select pg_temp.tick(now() + interval '3 hours');
select is(pg_temp.n('staff1', 'reminder_not_noted', 'a1'), 1::bigint, 'not again within two hours');
select pg_temp.tick(now() + interval '4 hours 2 minutes');
select is(pg_temp.n('staff1', 'reminder_not_noted', 'a1'), 2::bigint, 'and again two hours later');
select pg_temp.as_member('staff1');
select public.task_acknowledge(pg_temp.fx('a1'));
select pg_temp.as_system();
select pg_temp.tick(now() + interval '6 hours 3 minutes');
select is(pg_temp.n('staff1', 'reminder_not_noted', 'a1'), 2::bigint, 'noted: no more repeats');
select pg_temp.mk('a2', now() + interval '6 days', array['staff3']);
select pg_temp.tick(now() + interval '2 hours 1 minute');
select is(pg_temp.n('staff3', 'reminder_not_noted', 'a2'), 0::bigint, 'on leave: the repeat is skipped');
select is((select title from public.notifications where recipient_id = pg_temp.fx('staff1') and kind = 'reminder_not_noted'
           and entity_id = pg_temp.fx('a1') limit 1),
  'Please note this task: a1', 'worded for the assignee');

-- 8. Not-noted escalations -----------------------------------------------------------------------------
select pg_temp.mk('x1', now() + interval '6 days', array['staff1', 'staff2'], 'admin1');
select pg_temp.tick(now() + interval '4 hours 1 minute');
select is((select count(*) from public.notifications where recipient_id = pg_temp.fx('admin1') and kind = 'escalation_not_noted'
           and entity_id = pg_temp.fx('x1') and escalation_level = 1), 1::bigint, '4 h: one escalation to the approving Admin (level 1)');
select ok((select body like 'Staff1, Staff2 have not tapped Task Noted since %'
           from public.notifications where recipient_id = pg_temp.fx('admin1') and kind = 'escalation_not_noted'
             and entity_id = pg_temp.fx('x1')), 'naming everyone not noted, by name (a fixed order, never the run''s)');
select is(pg_temp.n('owner', 'escalation_not_noted', 'x1'), 0::bigint, 'the Owner not yet');
select pg_temp.tick(now() + interval '8 hours 1 minute');
select is((select count(*) from public.notifications where recipient_id = pg_temp.fx('owner') and kind = 'escalation_not_noted'
           and entity_id = pg_temp.fx('x1') and escalation_level = 2), 1::bigint, '8 h: the Owner (level 2)');
select pg_temp.tick(now() + interval '10 hours 1 minute');
select is(pg_temp.n('admin1', 'escalation_not_noted', 'x1') + pg_temp.n('owner', 'escalation_not_noted', 'x1'), 2::bigint,
  'each escalation fires once');
select pg_temp.mk('x2', now() + interval '6 days', array['staff1']);
select pg_temp.tick(now() + interval '4 hours 1 minute');
select pg_temp.tick(now() + interval '8 hours 1 minute');
select is(pg_temp.n('owner', 'escalation_not_noted', 'x2'), 1::bigint,
  'no approving Admin: the creator (the Owner) at 4 h, and not again at 8 h');

-- 9. Deadline reminders: each kind, its people, once; never once the task is with the reviewers --------
select pg_temp.tick((select due_at from public.tasks where id = pg_temp.fx('t1')) - interval '2 days' + interval '1 minute');
select is(pg_temp.n('staff1', 'reminder_before_due', 't1') + pg_temp.n('staff2', 'reminder_before_due', 't1'), 2::bigint,
  '2 days before: every assignee (push only)');
select is((select title from public.notifications where recipient_id = pg_temp.fx('staff1') and entity_id = pg_temp.fx('t1')
           and kind = 'reminder_before_due'), 'Due in 2 days: t1', 'worded with the time left');
select pg_temp.tick((select due_at from public.tasks where id = pg_temp.fx('t1')) - interval '2 days' + interval '2 minutes');
select is(pg_temp.n('staff1', 'reminder_before_due', 't1'), 1::bigint, 'never twice');
select pg_temp.tick((select due_at from public.tasks where id = pg_temp.fx('t1')) - interval '1 day' + interval '1 minute');
select is(pg_temp.n('staff1', 'reminder_before_due_last', 't1'), 1::bigint, '1 day before: the last before-due (always emailed)');
select pg_temp.tick((select due_at from public.tasks where id = pg_temp.fx('t1')) + interval '1 minute');
select is(pg_temp.n('staff2', 'reminder_due_now', 't1'), 1::bigint, 'at the deadline: Due now');
select pg_temp.tick((select due_at from public.tasks where id = pg_temp.fx('t1')) + interval '61 minutes');
select is(pg_temp.n('staff1', 'reminder_overdue', 't1') + pg_temp.n('staff2', 'reminder_overdue', 't1')
          + pg_temp.n('admin1', 'reminder_overdue', 't1'), 3::bigint, '1 h after: overdue, to the assignees and the approving Admin');
select pg_temp.tick((select due_at from public.tasks where id = pg_temp.fx('t1')) + interval '24 hours 1 minute');
select is((select array_agg(escalation_level order by escalation_level) from public.notifications
           where kind = 'escalation_overdue' and entity_id = pg_temp.fx('t1')), array[1, 2],
  '24 h after with nothing handed in: the approving Admin (level 1) and the Owner (level 2)');
-- Handed in: the rest is skipped.
select pg_temp.mk('s1', now() + interval '2 days', array['staff1'], null, '[{"before": 1, "unit": "days"}]');
select pg_temp.as_member('staff1');
select public.task_submit_done(pg_temp.fx('s1'), 'https://example.com/reel');
select pg_temp.as_system();
select pg_temp.tick(now() + interval '1 day 1 minute');
select is(pg_temp.n('staff1', 'reminder_before_due_last', 's1'), 0::bigint, 'nothing fires once the task is submitted');
-- Stale (the job was down for over an hour): skipped, not sent late.
select pg_temp.mk('st', now() + interval '1 day 2 minutes', array['staff1'], null, '[{"before": 1, "unit": "days"}]');
select pg_temp.tick(now() + interval '2 hours');
select is(pg_temp.n('staff1', 'reminder_before_due_last', 'st'), 0::bigint, 'a reminder over an hour late is skipped');

-- 10. A reopen with the same deadline sends nothing twice ------------------------------------------------
select pg_temp.mk('r1', now() + interval '2 days', array['staff1'], null, '[{"before": 1, "unit": "days"}]');
select pg_temp.tick(now() + interval '1 day 1 minute');
select pg_temp.as_member('owner');
select public.task_cancel(pg_temp.fx('r1'), 'Client paused');
select public.task_reopen(pg_temp.fx('r1'), 'Client is back');
select pg_temp.as_system();
select is(pg_temp.armed('r1'), 'overdue:- overdue_escalation:-',
  'the reopen re-arms, but not the before-due reminder already sent for this deadline');
select is(pg_temp.n('staff1', 'reminder_before_due_last', 'r1'), 1::bigint, 'and it was sent once');

select * from finish();
rollback;
