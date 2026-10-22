-- v1.9 W3 (ROADMAP v1.9 W3; 6b.5 and 6b.9; kickoff 6b decisions 2 and 6, owner 2026-10-16; migration
-- approval_reminders; WORKFLOWS §8 approval_reminders, §9 "Decision emails"; PERMISSIONS "As built
-- (v1.9 W3)"). The settings: defaults, checks, the Owner only (an Admin's and a Crew member's update
-- match no row, anon has no privilege). The record table and the job: no API access for any role. The
-- reminders: nothing before the working day, urgent one per task per slot once it waited a slot, high
-- grouped at 11:00 / 14:00 / 17:00, medium and low at 11:00 with the leave and attendance waiting as one
-- line each, a re-run in the same slot sends nothing, a slot in the quiet hours sends no urgent push, a
-- holiday and a weekly off send nothing, leave and attendance alone still remind, nothing waiting sends
-- nothing (and uses the slot), never an email. The email policy: an approved attendance day, leave or
-- expense claim is no_email and never queued for email even without push; a corrected or rejected one
-- keeps the fallback; other kinds are untouched. Neutral names only.
begin;
create extension if not exists pgtap with schema extensions;
select plan(77);

delete from public.approval_reminder_sends;
delete from public.item_reviews;
delete from public.project_item_stage_list;
delete from public.project_item_stages;
delete from public.project_items;
delete from public.project_cycles;
delete from public.project_item_blueprints;
delete from public.project_stages;
delete from public.projects;
delete from public.project_templates;
delete from public.stage_presets;
delete from public.client_work_alerts;
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
delete from public.eod_reports;
delete from public.notification_deliveries;
delete from public.notifications;
delete from public.push_subscriptions;
delete from public.member_reachability;
delete from public.members;
delete from auth.identities;
delete from auth.users;
delete from public.holidays;

create temporary table fx (key text primary key, id uuid not null);
insert into fx values
  ('owner',  '00000000-0000-4000-8000-000000012001'),
  ('admin1', '00000000-0000-4000-8000-000000012002'),
  ('staff1', '00000000-0000-4000-8000-000000012003'),
  ('staff2', '00000000-0000-4000-8000-000000012004');
insert into fx select 'org', id from public.organizations limit 1;
grant select on fx to authenticated, anon;

create function pg_temp.fx(k text) returns uuid language sql stable as $$ select id from fx where key = k; $$;
grant execute on function pg_temp.fx(text) to authenticated, anon;
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
-- An IST wall time as an instant.
create function pg_temp.ist(t text) returns timestamptz language sql immutable as $$
  select (t::timestamp at time zone 'Asia/Kolkata');
$$;
-- The approval reminders the Owner has: all, or about one task.
create function pg_temp.rem(task text default null) returns bigint language sql stable as $$
  select count(*) from public.notifications n
  where n.recipient_id = pg_temp.fx('owner') and n.kind = 'approval_reminder'
    and (task is null or n.entity_id = pg_temp.fx(task));
$$;
create function pg_temp.grouped_latest() returns public.notifications language sql stable as $$
  select n.* from public.notifications n
  where n.recipient_id = pg_temp.fx('owner') and n.kind = 'approval_reminder' and n.entity_id is null
  order by (n.payload ->> 'slot_at')::timestamptz desc limit 1;
$$;
create function pg_temp.grouped_count() returns bigint language sql stable as $$
  select count(*) from public.notifications n
  where n.recipient_id = pg_temp.fx('owner') and n.kind = 'approval_reminder' and n.entity_id is null;
$$;
-- A task waiting in `state` since `since` (IST), at `priority`.
create function pg_temp.mk(k text, priority public.priority, since text,
                           state public.task_state default 'admin_approved') returns void
language plpgsql as $$
declare
  v_id uuid;
begin
  insert into public.tasks (org_id, title, task_type_id, priority, due_at, state, created_by,
                            primary_owner_id, submitted_at, submitted_by, admin_approved_at)
  values (pg_temp.fx('org'), 'Task ' || k, pg_temp.fx('type'), priority, pg_temp.ist('2026-11-20 18:00'),
          state, pg_temp.fx('admin1'), pg_temp.fx('staff1'), pg_temp.ist(since), pg_temp.fx('staff1'),
          case when state = 'admin_approved' then pg_temp.ist(since) end)
  returning id into v_id;
  insert into fx values (k, v_id);
end;
$$;

insert into auth.users (id, email) select id, key || '@example.com' from fx where key <> 'org';
insert into public.members (id, org_id, full_name, email, role, status, joined_at)
select pg_temp.fx(k), pg_temp.fx('org'), initcap(k), k || '@example.com', r::public.member_role, 'active', now() - interval '60 days'
from (values ('owner', 'owner'), ('admin1', 'admin'), ('staff1', 'staff'), ('staff2', 'staff')) as v(k, r);
insert into public.task_types (org_id, name, kind, shows_on_calendar, has_location, position)
values (pg_temp.fx('org'), 'Type 120', 'normal', false, false, 'z120');
insert into fx select 'type', id from public.task_types where org_id = pg_temp.fx('org') and name = 'Type 120';
update public.org_settings set weekly_off_days = '{0}', quiet_hours_start = '22:00', quiet_hours_end = '07:00'
where org_id = pg_temp.fx('org');

-- 1. The settings ---------------------------------------------------------------------------------
select is((select s.work_start_time from public.org_settings s where s.org_id = pg_temp.fx('org')), '10:00'::time,
  'the working day starts at 10:00 by default');
select is((select s.work_end_time from public.org_settings s where s.org_id = pg_temp.fx('org')), '18:00'::time,
  'the working day ends at 18:00 by default');
select is((select s.approval_reminder_urgent_minutes from public.org_settings s where s.org_id = pg_temp.fx('org')), 60,
  'urgent tasks are reminded every 60 minutes by default');
select is((select s.approval_reminder_high_times from public.org_settings s where s.org_id = pg_temp.fx('org')),
  '{11:00,14:00,17:00}'::time[], 'high tasks are reminded at 11:00, 14:00 and 17:00 by default');
select is((select s.approval_reminder_daily_time from public.org_settings s where s.org_id = pg_temp.fx('org')), '11:00'::time,
  'medium and low tasks are reminded at 11:00 by default');
select throws_ok($$ update public.org_settings set work_end_time = '09:00' where org_id = pg_temp.fx('org') $$,
  '23514', null, 'the end of the working day must come after its start');
select throws_ok($$ update public.org_settings set approval_reminder_urgent_minutes = 10 where org_id = pg_temp.fx('org') $$,
  '23514', null, 'an urgent cadence under 15 minutes is refused');
select throws_ok($$ update public.org_settings set approval_reminder_high_times = '{}' where org_id = pg_temp.fx('org') $$,
  '23514', null, 'the high reminders need at least one time');
select throws_ok($$ update public.org_settings set approval_reminder_high_times = '{11:00,null}' where org_id = pg_temp.fx('org') $$,
  '23514', null, 'a high reminder time cannot be empty');

select pg_temp.as_member('owner');
update public.org_settings set work_start_time = '09:30', approval_reminder_daily_time = '10:30',
  approval_reminder_urgent_minutes = 30, approval_reminder_high_times = '{12:00}', work_end_time = '19:00'
where org_id = pg_temp.fx('org');
select pg_temp.as_system();
select is((select row(s.work_start_time, s.work_end_time, s.approval_reminder_urgent_minutes,
                      s.approval_reminder_high_times, s.approval_reminder_daily_time)::text
           from public.org_settings s where s.org_id = pg_temp.fx('org')),
  row('09:30'::time, '19:00'::time, 30, '{12:00}'::time[], '10:30'::time)::text,
  'the Owner edits the working hours and the reminder cadence');
update public.org_settings set work_start_time = '10:00', work_end_time = '18:00', approval_reminder_urgent_minutes = 60,
  approval_reminder_high_times = '{11:00,14:00,17:00}', approval_reminder_daily_time = '11:00'
where org_id = pg_temp.fx('org');

select pg_temp.as_member('admin1');
update public.org_settings set work_start_time = '09:00', approval_reminder_urgent_minutes = 15 where org_id = pg_temp.fx('org');
select pg_temp.as_member('staff1');
update public.org_settings set work_end_time = '20:00', approval_reminder_daily_time = '09:00' where org_id = pg_temp.fx('org');
select pg_temp.as_system();
select is((select row(s.work_start_time, s.work_end_time, s.approval_reminder_urgent_minutes, s.approval_reminder_daily_time)::text
           from public.org_settings s where s.org_id = pg_temp.fx('org')),
  row('10:00'::time, '18:00'::time, 60, '11:00'::time)::text,
  'an Admin''s and a Crew member''s updates match no row (settings.manage is the Owner''s)');
select pg_temp.as_anon();
select throws_ok($$ update public.org_settings set work_start_time = '09:00' $$, '42501', null,
  'anon has no privilege on the working hours');
select pg_temp.as_system();

-- 2. No API access to the record table or the job -------------------------------------------------
select pg_temp.as_member('owner');
select throws_ok($$ select count(*) from public.approval_reminder_sends $$, '42501', null, 'the Owner cannot read the reminder record');
select throws_ok($$ insert into public.approval_reminder_sends (org_id, recipient_id, slot_at, slot, notified)
                    values (pg_temp.fx('org'), pg_temp.fx('owner'), now(), 'grouped', false) $$,
  '42501', null, 'the Owner cannot write the reminder record');
select throws_ok($$ select app.approval_reminders(now()) $$, '42501', null, 'the Owner cannot run the job');
select pg_temp.as_member('admin1');
select throws_ok($$ select count(*) from public.approval_reminder_sends $$, '42501', null, 'an Admin cannot read the reminder record');
select throws_ok($$ select app.approval_reminders(now()) $$, '42501', null, 'an Admin cannot run the job');
select pg_temp.as_member('staff1');
select throws_ok($$ select count(*) from public.approval_reminder_sends $$, '42501', null, 'a Crew member cannot read the reminder record');
select throws_ok($$ select app.approval_reminders(now()) $$, '42501', null, 'a Crew member cannot run the job');
select pg_temp.as_anon();
select throws_ok($$ select count(*) from public.approval_reminder_sends $$, '42501', null, 'anon cannot read the reminder record');
select pg_temp.as_system();
select ok((select c.relrowsecurity from pg_class c where c.oid = 'public.approval_reminder_sends'::regclass),
  'the reminder record has RLS');
select is((select row(k.actionable, k.always_email, k.in_app)::text from public.notification_kinds k where k.kind = 'approval_reminder'),
  row(false, false, true)::text, 'approval_reminder is in-app and push only, never email');
select is((select j.schedule from cron.job j where j.jobname = 'approval_reminders'), '*/5 * * * *',
  'the job runs every 5 minutes');

-- 3. The reminders, on Wed 4 Nov 2026 (a working day) ----------------------------------------------
select pg_temp.mk('u1', 'urgent', '2026-11-04 08:00');
select pg_temp.mk('u2', 'urgent', '2026-11-04 10:30');
select pg_temp.mk('h1', 'high', '2026-11-02 16:00');
select pg_temp.mk('h2', 'high', '2026-11-04 09:00');
select pg_temp.mk('m1', 'medium', '2026-11-03 12:00');
select pg_temp.mk('l1', 'low', '2026-11-04 08:30');
select pg_temp.mk('s1', 'urgent', '2026-11-03 09:00', 'submitted');
select pg_temp.mk('x1', 'high', '2026-11-01 09:00');
update public.tasks set archived_at = now() where id = pg_temp.fx('x1');
insert into public.leave_requests (member_id, type, start_date, end_date, state, source)
values (pg_temp.fx('staff1'), 'leave', '2026-11-25', '2026-11-25', 'submitted', 'form'),
       (pg_temp.fx('staff2'), 'leave', '2026-11-26', '2026-11-27', 'submitted', 'form');
insert into public.attendance_days (member_id, work_date, state, submitted_choice, submitted_at, started_at)
values (pg_temp.fx('staff1'), '2026-11-03', 'pending_review', 'present', pg_temp.ist('2026-11-03 10:00'), pg_temp.ist('2026-11-03 10:00'));
insert into fx select 'day1', id from public.attendance_days where member_id = pg_temp.fx('staff1') and work_date = '2026-11-03';

select is(app.approval_reminders(pg_temp.ist('2026-11-04 09:55')), 0, 'before the working day nothing is sent');
select is(app.approval_reminders(pg_temp.ist('2026-11-04 10:01')), 1, 'at 10:00 the one urgent task that waited an hour is reminded');
select is(pg_temp.rem('u1'), 1::bigint, 'the urgent task has its own reminder');
select is((select n.link from public.notifications n where n.kind = 'approval_reminder' and n.entity_id = pg_temp.fx('u1')),
  '/tasks/' || pg_temp.fx('u1'), 'the urgent reminder opens the task');
select is((select n.title from public.notifications n where n.kind = 'approval_reminder' and n.entity_id = pg_temp.fx('u1')),
  'Task u1 is waiting for your approval', 'the urgent reminder names the task');
select is(app.approval_reminders(pg_temp.ist('2026-11-04 10:06')), 0, 'the next run in the same slot sends nothing');
select is(pg_temp.rem('s1'), 0::bigint, 'a task still with its approving Admin is never an Owner reminder');

select is(app.approval_reminders(pg_temp.ist('2026-11-04 11:02')), 2,
  'at 11:00: the urgent task again, and one grouped reminder');
select is(pg_temp.rem('u1'), 2::bigint, 'the urgent task is reminded every hour');
select is(pg_temp.rem('u2'), 0::bigint, 'an urgent task waiting under an hour is not reminded yet');
select is((pg_temp.grouped_latest()).title, '4 tasks waiting for your approval · oldest 2 days',
  'the 11:00 reminder groups the high, medium and low tasks with the oldest''s wait');
select is((pg_temp.grouped_latest()).body, E'2 leave requests waiting\n1 attendance day waiting',
  'the leave and attendance waiting are one line each at the daily time');
select is((pg_temp.grouped_latest()).link, '/approvals#tasks', 'the grouped reminder opens Approvals at Tasks');
select is((pg_temp.grouped_latest()).actor_id, null, 'a reminder has no actor');
select is(app.approval_reminders(pg_temp.ist('2026-11-04 11:07')), 0, 'a re-run in the 11:00 slot sends nothing');
select is(app.approval_reminders(pg_temp.ist('2026-11-04 11:07')), 0, 'and again');
select is(pg_temp.grouped_count(), 1::bigint, 'one grouped reminder for the slot');

select is(app.approval_reminders(pg_temp.ist('2026-11-04 12:01')), 2, 'at 12:00 both urgent tasks, nothing grouped');
select is(pg_temp.rem('u2'), 1::bigint, 'the second urgent task, waiting an hour by 12:00, is reminded');

update public.org_settings set quiet_hours_start = '12:30', quiet_hours_end = '13:30' where org_id = pg_temp.fx('org');
select is(app.approval_reminders(pg_temp.ist('2026-11-04 13:05')), 0, 'an urgent slot inside the quiet hours sends nothing');
update public.org_settings set quiet_hours_start = '22:00', quiet_hours_end = '07:00' where org_id = pg_temp.fx('org');

select is(app.approval_reminders(pg_temp.ist('2026-11-04 14:03')), 3, 'at 14:00 both urgent tasks and the high group');
select is((pg_temp.grouped_latest()).title, '2 tasks waiting for your approval · oldest 2 days',
  'the 14:00 reminder counts the high tasks only');
select is((pg_temp.grouped_latest()).body, null, 'no leave or attendance lines outside the daily time');

update public.tasks set priority = 'medium' where id = pg_temp.fx('h1');
select is(app.approval_reminders(pg_temp.ist('2026-11-04 17:01')), 3, 'at 17:00 both urgent tasks and the high group');
select is((pg_temp.grouped_latest()).title, '1 task waiting for your approval · since today',
  'one task reads in the singular with its own wait');
select is(app.approval_reminders(pg_temp.ist('2026-11-04 18:01')), 0,
  'after the working day no urgent reminder, and the 17:00 slot was sent');
select is((select count(*) from public.notification_deliveries d join public.notifications n on n.id = d.notification_id
           where n.kind = 'approval_reminder' and d.channel = 'push'), pg_temp.rem(),
  'every reminder is queued as a push');

-- Never emailed: the Owner has no push subscription, and still no email is queued.
select lives_ok($$ select count(*) from public.email_claim(now(), 100) $$, 'the email run claims what it needs');
select is((select count(*) from public.notification_deliveries d join public.notifications n on n.id = d.notification_id
           where n.kind = 'approval_reminder' and d.channel = 'email'), 0::bigint,
  'an approval reminder is never emailed, even with no working push');

-- 4. Days off and nothing waiting -----------------------------------------------------------------
insert into public.holidays (org_id, date, name) values (pg_temp.fx('org'), '2026-11-05', 'Holiday 120');
select is(app.approval_reminders(pg_temp.ist('2026-11-05 11:02')), 0, 'a holiday sends nothing');
select is(app.approval_reminders(pg_temp.ist('2026-11-08 11:02')), 0, 'a weekly off sends nothing');
select is((select count(*) from public.approval_reminder_sends s where s.slot_at >= pg_temp.ist('2026-11-05 00:00')
            and s.slot_at < pg_temp.ist('2026-11-09 00:00')), 0::bigint, 'a day off uses no slot');

update public.tasks set state = 'completed', completed_at = now() where org_id = pg_temp.fx('org') and state = 'admin_approved';
select is(app.approval_reminders(pg_temp.ist('2026-11-06 11:02')), 1, 'with only leave and attendance waiting, the 11:00 reminder still goes');
select is((pg_temp.grouped_latest()).title, 'Waiting for your approval', 'it reads "Waiting for your approval"');
select is((pg_temp.grouped_latest()).link, '/approvals', 'and opens Approvals');

update public.leave_requests set state = 'withdrawn' where member_id in (pg_temp.fx('staff1'), pg_temp.fx('staff2'));
update public.attendance_days set state = 'approved', final_status = 'present', decided_by = pg_temp.fx('owner'), decided_at = now()
where id = pg_temp.fx('day1');
select is(app.approval_reminders(pg_temp.ist('2026-11-09 11:02')), 0, 'nothing waiting sends nothing');
select is((select s.notified from public.approval_reminder_sends s where s.slot_at = pg_temp.ist('2026-11-09 11:00') and s.slot = 'grouped'),
  false, 'the slot is used up, with nothing sent');
select is(app.approval_reminders(pg_temp.ist('2026-11-09 11:04')), 0, 'and a later run in it sends nothing either');

-- 5. Decision emails (6b.9) -----------------------------------------------------------------------
delete from public.notification_deliveries;
delete from public.notifications;
insert into public.attendance_days (member_id, work_date, state, submitted_choice, submitted_at, started_at)
values (pg_temp.fx('staff1'), '2026-10-20', 'pending_review', 'present', pg_temp.ist('2026-10-20 10:00'), pg_temp.ist('2026-10-20 10:00')),
       (pg_temp.fx('staff2'), '2026-10-20', 'pending_review', 'present', pg_temp.ist('2026-10-20 10:00'), pg_temp.ist('2026-10-20 10:00'));
insert into public.leave_requests (member_id, type, start_date, end_date, state, source)
values (pg_temp.fx('staff1'), 'leave', '2026-12-01', '2026-12-01', 'submitted', 'form'),
       (pg_temp.fx('staff2'), 'leave', '2026-12-02', '2026-12-02', 'submitted', 'form');
select pg_temp.as_member('owner');
select lives_ok($$ select public.attendance_decide((select id from public.attendance_days where member_id = pg_temp.fx('staff1') and work_date = '2026-10-20'), 'approve') $$,
  'the Owner approves a day');
select lives_ok($$ select public.attendance_decide((select id from public.attendance_days where member_id = pg_temp.fx('staff2') and work_date = '2026-10-20'), 'correct', 'absent', 'Not in that day') $$,
  'the Owner corrects a day');
select lives_ok($$ select public.leave_decide((select id from public.leave_requests where member_id = pg_temp.fx('staff1') and start_date = '2026-12-01'), 'approve') $$,
  'the Owner approves a leave request');
select lives_ok($$ select public.leave_decide((select id from public.leave_requests where member_id = pg_temp.fx('staff2') and start_date = '2026-12-02'), 'reject', 'Busy week') $$,
  'the Owner rejects a leave request');
select pg_temp.as_system();

select is((select bool_and(n.no_email) from public.notifications n where n.kind = 'attendance_decided' and n.recipient_id = pg_temp.fx('staff1')),
  true, 'an approved attendance day is never emailed');
select is((select bool_or(n.no_email) from public.notifications n where n.kind = 'attendance_decided' and n.recipient_id = pg_temp.fx('staff2')),
  false, 'a corrected attendance day keeps the email fallback');
select is((select bool_and(n.no_email) from public.notifications n where n.kind = 'leave_decided' and n.recipient_id = pg_temp.fx('staff1')),
  true, 'an approved leave request is never emailed');
select is((select bool_or(n.no_email) from public.notifications n where n.kind = 'leave_decided' and n.recipient_id = pg_temp.fx('staff2')),
  false, 'a rejected leave request keeps the email fallback');

-- An expense decision, and another kind, through app.notify itself (the audit row is what decides).
insert into public.activity_log (org_id, entity, entity_id, action)
values (pg_temp.fx('org'), 'expense_claims', '00000000-0000-4000-8000-000000012101', 'approved'),
       (pg_temp.fx('org'), 'expense_claims', '00000000-0000-4000-8000-000000012102', 'rejected'),
       (pg_temp.fx('org'), 'tasks', '00000000-0000-4000-8000-000000012103', 'approved');
select app.notify(array[pg_temp.fx('staff1')], 'expense_decided', 'Expense claim approved', null, '/leave/expenses',
  'expense_claims', '00000000-0000-4000-8000-000000012101', '{}'::jsonb, pg_temp.fx('owner'));
select app.notify(array[pg_temp.fx('staff2')], 'expense_decided', 'Expense claim rejected', null, '/leave/expenses',
  'expense_claims', '00000000-0000-4000-8000-000000012102', '{}'::jsonb, pg_temp.fx('owner'));
select app.notify(array[pg_temp.fx('staff1')], 'task_changes_requested', 'Changes requested', null, null,
  'tasks', '00000000-0000-4000-8000-000000012103', '{}'::jsonb, pg_temp.fx('owner'));
select is((select n.no_email from public.notifications n where n.kind = 'expense_decided' and n.recipient_id = pg_temp.fx('staff1')),
  true, 'an approved expense claim is never emailed');
select is((select n.no_email from public.notifications n where n.kind = 'expense_decided' and n.recipient_id = pg_temp.fx('staff2')),
  false, 'a rejected expense claim keeps the email fallback');
select is((select n.no_email from public.notifications n where n.kind = 'task_changes_requested'),
  false, 'another kind is untouched by the policy');

-- Nobody here has push: the dispatcher emails the fallbacks and never an approval.
select lives_ok($$ select count(*) from public.email_claim(now(), 100) $$, 'the email run claims the fallbacks');
select is((select count(*) from public.notification_deliveries d join public.notifications n on n.id = d.notification_id
           where d.channel = 'email' and n.no_email), 0::bigint, 'no approved decision is queued for email');
select is((select count(*) from public.notification_deliveries d join public.notifications n on n.id = d.notification_id
           where d.channel = 'email' and n.kind in ('attendance_decided', 'leave_decided', 'expense_decided')
             and n.recipient_id = pg_temp.fx('staff2')), 3::bigint,
  'the corrected day, the rejected leave and the rejected claim are emailed as the fallback');
select is((select count(*) from public.notification_deliveries d join public.notifications n on n.id = d.notification_id
           where d.channel = 'email' and n.kind = 'task_changes_requested'), 1::bigint,
  'another actionable kind is emailed as the fallback as before');

-- The API never writes no_email.
select pg_temp.as_member('staff1');
select throws_ok($$ update public.notifications set no_email = false where recipient_id = pg_temp.fx('staff1') $$,
  '42501', null, 'a member cannot change no_email on their own row');
select pg_temp.as_system();

select * from finish();
rollback;
