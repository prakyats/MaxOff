-- 6.5 (migration eod_report_weekly_digest; Kickoff 6 decisions 16-18 and 23): the end-of-day report
-- and the weekly Owner digest. (1) org_settings.weekly_digest_day: default Monday, 0..6, the Owner
-- only (each role allowed and denied). (2) The two kinds. (3) eod_reports: the Owner reads, nobody
-- else, no API writes. (4) The report's content for a day: attendance, decisions, tasks with
-- freelancers apart, approvals, tomorrow's events, the day off; no amount anywhere; the one line.
-- (5) app.eod_report(): date D saved once D+1's End-day cutoff has passed, the 7-day catch-up, one
-- row per date never rewritten, "Yesterday's report is ready" through app.notify() for yesterday
-- only, the zero skip, an Owner-set cutoff. (6) eod_report_preview per role. (7) digest_weekly: the
-- digest day at 08:00 IST, not before yesterday's report is saved, the seven-day window from the
-- saved reports only, one per week, the zero skip, the preview per role, email_claim takes it first.
-- (8) The schedule: digest_daily unscheduled, eod_report and digest_weekly every 5 minutes.
begin;
create extension if not exists pgtap with schema extensions;
select plan(107);

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
delete from public.activity_log;
delete from public.holidays;
update public.org_settings
set weekly_off_days = '{}', end_day_cutoff_time = '05:00', weekly_digest_day = 1,
    email_daily_cap_org = 90, email_daily_cap_per_member = 20;

create temporary table fx (key text primary key, id uuid not null);
insert into fx values
  ('owner',  '00000000-0000-4000-8000-000000006401'),
  ('admin1', '00000000-0000-4000-8000-000000006402'),
  ('kiran',  '00000000-0000-4000-8000-000000006403'),
  ('lata',   '00000000-0000-4000-8000-000000006404'),
  ('mohan',  '00000000-0000-4000-8000-000000006405'),
  ('asha',   '00000000-0000-4000-8000-000000006406'),
  ('filler', '00000000-0000-4000-8000-000000006407');
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
-- The day the report is about: yesterday (D). Its IST day is [d_start, t_start); "today" is D + 1.
create function pg_temp.d() returns date language sql stable as $$ select app.today_ist() - 1; $$;
create function pg_temp.d_start() returns timestamptz language sql stable as $$ select app.ist_day_start(app.today_ist() - 1); $$;
create function pg_temp.t_start() returns timestamptz language sql stable as $$ select app.ist_day_start(app.today_ist()); $$;
-- An instant of day D + 1 (today) at an IST time, as a job's p_now.
create function pg_temp.today_at(t time) returns timestamptz language sql stable as $$ select pg_temp.t_start() + t; $$;
-- An UPDATE as the current role, answering how many rows RLS let it touch (a data-modifying CTE
-- cannot sit inside a subquery).
create function pg_temp.set_digest_day(d integer) returns bigint language plpgsql as $$
declare n bigint;
begin
  update public.org_settings set weekly_digest_day = d where org_id = pg_temp.fx('org');
  get diagnostics n = row_count;
  return n;
end;
$$;
create function pg_temp.payload() returns jsonb language sql stable as $$
  select app.eod_report_payload(pg_temp.fx('org'), pg_temp.d(), pg_temp.today_at('05:00'));
$$;

-- Asha is a freelancer: no login and no email (ADR-0013; members_email_matches_engagement).
insert into auth.users (id, email) select id, key || '@example.com' from fx where key not in ('org', 'asha');
insert into public.members (id, org_id, full_name, email, role, status, joined_at, engagement)
select pg_temp.fx(k), pg_temp.fx('org'), initcap(k), case when e = 'freelance' then null else k || '@example.com' end,
       r::public.member_role, 'active', now() - interval '60 days', e::public.engagement
from (values ('owner', 'owner', 'permanent'), ('admin1', 'admin', 'permanent'), ('kiran', 'staff', 'permanent'),
             ('lata', 'staff', 'permanent'), ('mohan', 'staff', 'permanent'), ('asha', 'staff', 'freelance'),
             ('filler', 'staff', 'permanent')) as v(k, r, e);
insert into public.member_coordinators (member_id, coordinator_id) values (pg_temp.fx('asha'), pg_temp.fx('admin1'));

-- 1. The setting ----------------------------------------------------------------------------------------------
select is((select weekly_digest_day from public.org_settings where org_id = pg_temp.fx('org')), 1::smallint,
  'weekly_digest_day defaults to Monday (1)');
select throws_ok($$update public.org_settings set weekly_digest_day = 7$$, '23514', null, 'a weekday is 0..6');
select pg_temp.as_member('owner');
select is(pg_temp.set_digest_day(3), 1::bigint,
  'the Owner (settings.manage) sets the digest day');
select is((select weekly_digest_day from public.org_settings), 3::smallint, 'and reads it back');
select pg_temp.as_member('admin1');
select is(pg_temp.set_digest_day(5), 0::bigint,
  'an Admin''s update matches no row (RLS)');
select pg_temp.as_member('kiran');
select is(pg_temp.set_digest_day(5), 0::bigint,
  'a Crew member''s update matches no row (RLS)');
select pg_temp.as_anon();
select throws_ok($$update public.org_settings set weekly_digest_day = 5$$, '42501', null, 'a signed-out caller is refused');
select pg_temp.as_system();
select is((select weekly_digest_day from public.org_settings), 3::smallint, 'nobody but the Owner changed it');
update public.org_settings set weekly_digest_day = 1;

-- 2. The kinds ------------------------------------------------------------------------------------------------
select is((select (actionable, always_email, in_app)::text from public.notification_kinds where kind = 'eod_report_ready'),
  '(f,f,t)', 'eod_report_ready: in-app, not actionable (no email fallback), no email of its own');
select is((select (actionable, always_email, in_app)::text from public.notification_kinds where kind = 'owner_digest_weekly'),
  '(f,t,f)', 'owner_digest_weekly: email only, always emailed, never in-app');

-- 3. eod_reports: the Owner reads, nobody else, no API writes ----------------------------------------------------
insert into public.eod_reports (org_id, report_date, data, generated_at)
values (pg_temp.fx('org'), pg_temp.d() - 30, '{"date": "x", "attendance": {"counts": {}}}'::jsonb, now());
select pg_temp.as_member('owner');
select is((select count(*) from public.eod_reports), 1::bigint, 'the Owner (reports.all) reads a saved report');
select throws_ok($$insert into public.eod_reports (org_id, report_date, data) values (pg_temp.fx('org'), pg_temp.d() - 31, '{}'::jsonb)$$,
  '42501', null, 'even the Owner cannot insert a report (the job alone writes)');
select throws_ok($$update public.eod_reports set data = '{}'::jsonb$$, '42501', null, 'nor update one');
select throws_ok($$delete from public.eod_reports$$, '42501', null, 'nor delete one');
select pg_temp.as_member('admin1');
select is((select count(*) from public.eod_reports), 0::bigint, 'an Admin reads none');
select pg_temp.as_member('kiran');
select is((select count(*) from public.eod_reports), 0::bigint, 'a Crew member reads none');
select pg_temp.as_anon();
select throws_ok($$select count(*) from public.eod_reports$$, '42501', null, 'a signed-out caller is refused');
select pg_temp.as_system();
delete from public.eod_reports;

-- 4. The report's content for day D ------------------------------------------------------------------------------
insert into public.holidays (org_id, date, name) values (pg_temp.fx('org'), pg_temp.d() - 3, 'Dussehra');
-- Attendance on D: kiran present, started and ended, overtime flagged; lata absent, a proposal still
-- waiting; mohan on leave (derived); filler present but the end of day not recorded; asha (a
-- freelancer) has no day; the Owner never has one. A day on another date is not counted.
insert into public.attendance_days (member_id, work_date, state, submitted_choice, submitted_at, final_status,
                                    proposed_by_system, decided_at, started_at, ended_at, end_not_recorded, overtime_flag, overtime_reason)
values
  (pg_temp.fx('kiran'),  pg_temp.d(), 'approved', 'present', pg_temp.d_start() + interval '10 hours', 'present', false,
   pg_temp.d_start() + interval '11 hours', pg_temp.d_start() + interval '9 hours 30 minutes', pg_temp.d_start() + interval '20 hours', false, true, 'Late shoot'),
  (pg_temp.fx('lata'),   pg_temp.d(), 'pending_review', null, null, 'absent', true, null, null, null, false, false, null),
  (pg_temp.fx('mohan'),  pg_temp.d(), 'approved', null, null, 'leave', true, pg_temp.d_start() + interval '9 hours', null, null, false, false, null),
  (pg_temp.fx('filler'), pg_temp.d(), 'approved', 'present', pg_temp.d_start() + interval '10 hours', 'present', false,
   pg_temp.d_start() + interval '11 hours', pg_temp.d_start() + interval '10 hours', null, true, false, null),
  (pg_temp.fx('kiran'),  pg_temp.d() - 1, 'approved', 'present', now(), 'present', false, now(), null, null, false, false, null);

select is(pg_temp.payload() #> '{attendance,counts}',
  '{"present": 2, "on_leave": 1, "absent": 1, "proposed_absent": 1, "waiting": 1, "end_not_recorded": 1, "overtime": 1}'::jsonb,
  'attendance counts: present, on leave, absent (the proposal counts and is marked), waiting, end not recorded, overtime');
select is((select jsonb_agg(p ->> 'name') from jsonb_array_elements(pg_temp.payload() #> '{attendance,people}') p),
  '["Filler", "Kiran", "Lata", "Mohan"]'::jsonb, 'each employee with a day on D, by name; never the Owner or a freelancer');
select is((select p - 'member_id' from jsonb_array_elements(pg_temp.payload() #> '{attendance,people}') p where p ->> 'name' = 'Kiran'),
  jsonb_build_object('name', 'Kiran', 'status', 'present', 'waiting', false, 'proposed', false,
    'started_at', pg_temp.d_start() + interval '9 hours 30 minutes', 'ended_at', pg_temp.d_start() + interval '20 hours',
    'end_not_recorded', false, 'overtime', true, 'overtime_reason', 'Late shoot'),
  'a person''s row: the status, the Start day and End day instants, the flags and the overtime reason');
select is((select (p ->> 'waiting', p ->> 'proposed', p ->> 'status') from jsonb_array_elements(pg_temp.payload() #> '{attendance,people}') p where p ->> 'name' = 'Lata'),
  ('true', 'true', 'absent'), 'a proposed absence still waiting is marked waiting and proposed');
select is(pg_temp.payload() -> 'day_off', '{"holiday": null, "weekly_off": false}'::jsonb, 'D is a working day');
update public.org_settings set weekly_off_days = array[extract(dow from pg_temp.d() - 3)::smallint];
select is(app.eod_report_payload(pg_temp.fx('org'), pg_temp.d() - 3, now()) -> 'day_off',
  '{"holiday": "Dussehra", "weekly_off": true}'::jsonb, 'a holiday is named and a weekly off flagged');
select is(app.eod_report_payload(pg_temp.fx('org'), pg_temp.d() - 3, now()) ->> 'date', (pg_temp.d() - 3)::text, 'the report names its date');
update public.org_settings set weekly_off_days = '{}';

-- Decisions on D: two attendance decisions by the Owner (an automatic one does not count), a leave
-- approved and one rejected, a comp credit granted and one revoked, an extra-work note reviewed,
-- two expense claims (decided or paid; never an amount).
insert into public.attendance_events (attendance_day_id, action, from_status, to_status, actor_id, at)
select d.id, 'approved', null, 'present', pg_temp.fx('owner'), pg_temp.d_start() + interval '11 hours'
from public.attendance_days d where d.member_id = pg_temp.fx('kiran') and d.work_date = pg_temp.d();
insert into public.attendance_events (attendance_day_id, action, from_status, to_status, actor_id, at)
select d.id, 'corrected', 'present', 'present', pg_temp.fx('owner'), pg_temp.d_start() + interval '12 hours'
from public.attendance_days d where d.member_id = pg_temp.fx('filler') and d.work_date = pg_temp.d();
insert into public.attendance_events (attendance_day_id, action, from_status, to_status, actor_id, at)
select d.id, 'derived_from_leave', null, 'leave', null, pg_temp.d_start() + interval '9 hours'
from public.attendance_days d where d.member_id = pg_temp.fx('mohan') and d.work_date = pg_temp.d();
insert into public.leave_requests (member_id, type, start_date, end_date, state, source, decided_by, decided_at)
values (pg_temp.fx('kiran'), 'leave', app.today_ist() + 3, app.today_ist() + 4, 'approved', 'form', pg_temp.fx('owner'), pg_temp.d_start() + interval '15 hours'),
       (pg_temp.fx('lata'),  'half_day', app.today_ist() + 2, app.today_ist() + 2, 'rejected', 'form', pg_temp.fx('owner'), pg_temp.d_start() + interval '16 hours'),
       (pg_temp.fx('mohan'), 'leave', app.today_ist() + 9, app.today_ist() + 9, 'approved', 'form', pg_temp.fx('owner'), pg_temp.t_start() + interval '1 hour');
insert into public.leave_requests (member_id, type, start_date, end_date, state, source)
values (pg_temp.fx('filler'), 'leave', app.today_ist() + 1, app.today_ist() + 1, 'submitted', 'form');
insert into public.comp_leave_credits (member_id, days, granted_by, granted_at, granted_on, expires_on)
values (pg_temp.fx('kiran'), 1.0, pg_temp.fx('owner'), pg_temp.d_start() + interval '14 hours', pg_temp.d(), pg_temp.d() + 30);
insert into public.comp_leave_credits (member_id, days, granted_by, granted_at, granted_on, expires_on, revoked_at, revoked_by, revoke_reason)
values (pg_temp.fx('lata'), 1.0, pg_temp.fx('owner'), pg_temp.d_start() - interval '2 days', pg_temp.d() - 2, pg_temp.d() + 30,
        pg_temp.d_start() + interval '14 hours', pg_temp.fx('owner'), 'Not worked after all');
insert into public.extra_work_notes (member_id, work_date, kind, duration_minutes, note, state, decision, decided_by, decided_at)
values (pg_temp.fx('filler'), pg_temp.d() - 1, 'overtime', 90, 'Late edit', 'reviewed', 'no_comp_leave', pg_temp.fx('owner'), pg_temp.d_start() + interval '13 hours');
insert into public.extra_work_notes (member_id, work_date, kind, duration_minutes, note, state)
values (pg_temp.fx('kiran'), pg_temp.d(), 'overtime', 60, 'Late shoot', 'submitted');
insert into public.expense_claims (member_id, expense_date, amount, category_id, note, state, decided_by, decided_at)
values (pg_temp.fx('kiran'), pg_temp.d() - 1, 1234.56, (select id from public.list_items where list_key = 'expense_category' limit 1), 'Taxi', 'approved', pg_temp.fx('owner'), pg_temp.d_start() + interval '12 hours'),
       (pg_temp.fx('lata'),  pg_temp.d() - 1, 777.77,  (select id from public.list_items where list_key = 'expense_category' limit 1), 'Lunch', 'rejected', pg_temp.fx('owner'), pg_temp.d_start() + interval '12 hours');
insert into public.expense_claims (member_id, expense_date, amount, category_id, note, state)
values (pg_temp.fx('mohan'), pg_temp.d() - 1, 999.99, (select id from public.list_items where list_key = 'expense_category' limit 1), 'Cab', 'submitted');

select is(pg_temp.payload() -> 'decisions',
  '{"attendance": 2, "leave": {"approved": 1, "rejected": 1}, "comp_leave": {"granted": 1, "revoked": 1, "reviewed": 1}, "expense_claims": 2}'::jsonb,
  'the decisions made on D: attendance by the Owner (not the automatic one), leave, comp leave, expense claims as a count');

-- Tasks: completed on D, handed in (waiting now), overdue now with the late reason, cancelled on D,
-- created on D; Asha's (a freelancer) counted apart; an archived task never counts.
create function pg_temp.task(k text, who text default 'kiran', due timestamptz default now() + interval '3 days') returns uuid language plpgsql as $$
declare
  v_id uuid;
begin
  perform pg_temp.as_member('owner');
  v_id := public.task_create(k, null, (select id from public.task_types where org_id = pg_temp.fx('org') and name = 'Normal'),
    null, 'medium', now() + interval '3 days', array[pg_temp.fx(who)], pg_temp.fx(who), null);
  perform pg_temp.as_system();
  -- Created well before the digest's week, so only created_on_d counts as created in it.
  update public.tasks set due_at = due, created_at = pg_temp.d_start() - interval '10 days' where id = v_id;
  insert into fx values (k, v_id);
  return v_id;
end;
$$;
select pg_temp.task('done_on_d');
select pg_temp.task('done_on_d_asha', 'asha');
select pg_temp.task('done_before');
select pg_temp.task('done_archived');
select pg_temp.task('waiting_now');
select pg_temp.task('late', 'kiran', pg_temp.d_start() + interval '18 hours');
select pg_temp.task('late_asha', 'asha', pg_temp.d_start() - interval '30 hours');
select pg_temp.task('late_cancelled', 'kiran', pg_temp.d_start() + interval '18 hours');
select pg_temp.task('cancelled_on_d');
select pg_temp.task('created_on_d');
select pg_temp.task('event_tomorrow');
select pg_temp.task('event_later');
update public.tasks set state = 'completed', completed_at = pg_temp.t_start() - interval '1 minute' where id in (pg_temp.fx('done_on_d'), pg_temp.fx('done_on_d_asha'));
update public.tasks set state = 'completed', completed_at = pg_temp.d_start() - interval '1 minute' where id = pg_temp.fx('done_before');
update public.tasks set state = 'completed', completed_at = pg_temp.d_start() + interval '2 hours', archived_at = now() where id = pg_temp.fx('done_archived');
update public.tasks set state = 'submitted', submitted_at = pg_temp.d_start() + interval '17 hours', submitted_by = pg_temp.fx('kiran') where id = pg_temp.fx('waiting_now');
update public.tasks set late_reason = 'Client moved the shoot' where id = pg_temp.fx('late');
update public.tasks set state = 'cancelled', cancelled_at = pg_temp.d_start() + interval '19 hours', cancelled_reason = 'Not needed' where id in (pg_temp.fx('late_cancelled'), pg_temp.fx('cancelled_on_d'));
update public.tasks set created_at = pg_temp.d_start() + interval '10 hours' where id = pg_temp.fx('created_on_d');
update public.tasks set event_date = app.today_ist(), event_start_at = pg_temp.t_start() + interval '10 hours', event_end_at = pg_temp.t_start() + interval '12 hours', location = 'Studio B' where id = pg_temp.fx('event_tomorrow');
update public.tasks set event_date = app.today_ist() + 4, event_start_at = pg_temp.t_start() + interval '4 days 10 hours' where id = pg_temp.fx('event_later');

select is((select (value ->> 'count', value ->> 'freelance') from jsonb_each(pg_temp.payload() -> 'tasks') where key = 'completed'),
  ('2', '1'), 'completed on D: Owner-approved that IST day (23:59 counts, the day before and an archived one do not), freelancers apart');
select is((select jsonb_agg(i ->> 'title' order by i ->> 'title') from jsonb_array_elements(pg_temp.payload() #> '{tasks,completed,items}') i),
  '["done_on_d", "done_on_d_asha"]'::jsonb, 'with their titles');
select is((select i -> 'freelance' from jsonb_array_elements(pg_temp.payload() #> '{tasks,completed,items}') i where i ->> 'title' = 'done_on_d_asha'),
  'true'::jsonb, 'a freelancer''s task is flagged on its item');
select is((select (value ->> 'count', value ->> 'freelance') from jsonb_each(pg_temp.payload() -> 'tasks') where key = 'handed_in'),
  ('1', '0'), 'handed in and waiting now: submitted');
select is((select i ->> 'since' from jsonb_array_elements(pg_temp.payload() #> '{tasks,handed_in,items}') i),
  to_jsonb(pg_temp.d_start() + interval '17 hours') #>> '{}', 'with when it was handed in');
select is((select (value ->> 'count', value ->> 'freelance') from jsonb_each(pg_temp.payload() -> 'tasks') where key = 'overdue'),
  ('2', '1'), 'overdue now: open past the deadline (a cancelled one is not), freelancers apart');
select is((select i ->> 'late_reason' from jsonb_array_elements(pg_temp.payload() #> '{tasks,overdue,items}') i where i ->> 'title' = 'late'),
  'Client moved the shoot', 'with the primary owner''s late reason');
select is((select (value ->> 'count') from jsonb_each(pg_temp.payload() -> 'tasks') where key = 'cancelled'),
  '2', 'cancelled on D');
select is((select i ->> 'reason' from jsonb_array_elements(pg_temp.payload() #> '{tasks,cancelled,items}') i where i ->> 'title' = 'cancelled_on_d'),
  'Not needed', 'with the reason');
select is((select (value ->> 'count') from jsonb_each(pg_temp.payload() -> 'tasks') where key = 'created'),
  '1', 'created on D');

-- Approvals on D: a count per approver at each step.
insert into public.task_reviews (task_id, step, decision, reason, reviewer_id, at)
values (pg_temp.fx('done_on_d'), 'owner', 'approved', null, pg_temp.fx('owner'), pg_temp.d_start() + interval '18 hours'),
       (pg_temp.fx('done_on_d_asha'), 'owner', 'approved', null, pg_temp.fx('owner'), pg_temp.d_start() + interval '18 hours'),
       (pg_temp.fx('waiting_now'), 'admin', 'rejected', 'Fix the colour', pg_temp.fx('admin1'), pg_temp.d_start() + interval '12 hours'),
       (pg_temp.fx('waiting_now'), 'admin', 'approved', null, pg_temp.fx('admin1'), pg_temp.d_start() + interval '16 hours'),
       (pg_temp.fx('done_before'), 'owner', 'approved', null, pg_temp.fx('owner'), pg_temp.d_start() - interval '1 hour');
select is((select jsonb_agg(a - 'reviewer_id') from jsonb_array_elements(pg_temp.payload() -> 'approvals') a),
  '[{"name": "Owner", "step": "owner", "approved": 2, "changes_requested": 0}, {"name": "Admin1", "step": "admin", "approved": 1, "changes_requested": 1}]'::jsonb,
  'approvals: per approver and step, approvals and changes requested, on D only');

-- Tomorrow's events (D + 1), with their people; one four days on is not tomorrow.
select is(pg_temp.payload() #>> '{tomorrow,date}', app.today_ist()::text, 'tomorrow is D + 1');
select is((select jsonb_agg(e - 'id') from jsonb_array_elements(pg_temp.payload() #> '{tomorrow,events}') e),
  jsonb_build_array(jsonb_build_object('title', 'event_tomorrow', 'start_at', pg_temp.t_start() + interval '10 hours',
    'end_at', pg_temp.t_start() + interval '12 hours', 'location', 'Studio B', 'people', '["Kiran"]'::jsonb)),
  'tomorrow''s events: the title, the times, the location and the people');

-- No money anywhere: no amount-like key at any depth, and no claim's amount in the text.
select is((select count(*) from jsonb_path_query(pg_temp.payload(), 'strict $.** ? (@.type() == "object").keyvalue()') kv
           where kv ->> 'key' ~* '(amount|total|sum|price|cost|paid|rupee|inr|money|salary|revenue)'), 0::bigint,
  'no amount-like key anywhere in the report');
select ok(position('1234' in pg_temp.payload()::text) = 0 and position('777' in pg_temp.payload()::text) = 0
          and position('999' in pg_temp.payload()::text) = 0, 'no claim amount appears in the report');
select is(app.eod_report_text(pg_temp.payload()),
  '2 present · 1 on leave · 1 absent · 1 end not recorded · Tasks: 2 completed, 2 overdue, 1 waiting · 1 event tomorrow',
  'the notification''s one line: the headline counts');
select is(app.eod_report_zero(pg_temp.payload()), false, 'a day with anything on it is not zero');
select is(app.eod_report_zero('{"attendance": {"counts": {}, "people": []}, "decisions": {}, "tasks": {}, "approvals": [], "tomorrow": {"events": []}}'::jsonb),
  true, 'a report with nothing in it is zero');
select is(app.eod_report_text('{"attendance": {"counts": {}}, "tasks": {}, "tomorrow": {"events": []}}'::jsonb), 'A quiet day.',
  'and its line says so');

-- 5. The job: date D once D + 1's cutoff has passed, the 7-day catch-up, never rewritten ------------------------
select is(app.eod_report(pg_temp.today_at('04:59')), 7, 'before the 05:00 cutoff on D + 1: the seven dates up to D - 1 are saved (the catch-up)');
select is((select count(*) from public.eod_reports where report_date = pg_temp.d()), 0::bigint, 'but not D: a late End day for D is still allowed');
select is((select count(*) from public.notifications where kind = 'eod_report_ready'), 0::bigint,
  'a catch-up date is saved quietly: no notification for an older day');
select is(public.digest_weekly(pg_temp.today_at('08:00')), 0,
  'the weekly digest waits until the last day''s report is saved (even past 08:00 on its day)')
  where extract(dow from app.today_ist())::int = (select weekly_digest_day from public.org_settings);
select is(public.digest_weekly(pg_temp.today_at('08:00')), 0, 'the weekly digest goes only on its day')
  where extract(dow from app.today_ist())::int <> (select weekly_digest_day from public.org_settings);

select is(app.eod_report(pg_temp.today_at('05:00')), 1, 'at the cutoff on D + 1: D is saved');
select is((select data from public.eod_reports where report_date = pg_temp.d()), pg_temp.payload(),
  'the saved row is the report built at that moment');
select is((select generated_at from public.eod_reports where report_date = pg_temp.d()), pg_temp.today_at('05:00'), 'and says when');
select is((select (title, body, link, entity, entity_id = (select id from public.eod_reports where report_date = pg_temp.d()), actor_id is null, read_at is null)::text
           from public.notifications where kind = 'eod_report_ready'),
  ('Yesterday''s report is ready', app.eod_report_text(pg_temp.payload()), '/reports/end-of-day/' || pg_temp.d()::text, 'eod_reports', true, true, true)::text,
  'one "Yesterday''s report is ready" to the Owner, opening the saved report, no actor, unread');
select is((select recipient_id from public.notifications where kind = 'eod_report_ready'), pg_temp.fx('owner'), 'to the Owner');
select is((select count(*) from public.notification_deliveries d join public.notifications n on n.id = d.notification_id
           where n.kind = 'eod_report_ready' and d.channel = 'push'), 1::bigint,
  'with a push delivery queued (app.notify), which quiet hours may hold');
select is((select activity_log.action from public.activity_log where entity = 'eod_reports' order by at desc limit 1), 'generated',
  'the save is audited (action generated, no actor)');

select is(app.eod_report(pg_temp.today_at('05:05')), 0, 'the next tick writes nothing');
update public.attendance_days set overtime_flag = false where member_id = pg_temp.fx('kiran') and work_date = pg_temp.d();
select is(app.eod_report(pg_temp.today_at('09:00')), 0, 'a later correction never rewrites a saved day');
select is((select data #>> '{attendance,counts,overtime}' from public.eod_reports where report_date = pg_temp.d()), '1',
  'the saved report still says what it said');
select is((select count(*) from public.notifications where kind = 'eod_report_ready'), 1::bigint, 'and the Owner is told once');
select is((select count(*) from public.eod_reports), 8::bigint, 'one row per IST date, days off included');

-- 6. The live preview ----------------------------------------------------------------------------------------------
create temporary table before_preview as
  select (select count(*) from public.notifications) as n, (select count(*) from public.eod_reports) as r;
select pg_temp.as_member('owner');
select is(public.eod_report_preview(pg_temp.d()) - 'tasks', pg_temp.payload() - 'tasks',
  'the Owner reads a day''s report computed now (reports.all)');
select is((public.eod_report_preview(app.today_ist()) ->> 'date'), app.today_ist()::text, 'today so far, live');
select throws_ok(format($$select public.eod_report_preview(%L::date)$$, app.today_ist() + 1), 'P0001', 'VALIDATION', 'a future day is refused');
select pg_temp.as_system();
select is((select (count(*), (select count(*) from public.eod_reports))::text from public.notifications),
  (select (n, r)::text from before_preview), 'the preview writes nothing');
select pg_temp.as_member('admin1');
select throws_ok(format($$select public.eod_report_preview(%L::date)$$, pg_temp.d()), 'P0001', 'FORBIDDEN', 'an Admin is refused');
select pg_temp.as_member('kiran');
select throws_ok(format($$select public.eod_report_preview(%L::date)$$, pg_temp.d()), 'P0001', 'FORBIDDEN', 'a Crew member is refused');
select pg_temp.as_anon();
select throws_ok(format($$select public.eod_report_preview(%L::date)$$, pg_temp.d()), '42501', null, 'a signed-out caller is refused');
select pg_temp.as_system();

-- 7. The weekly digest ---------------------------------------------------------------------------------------------
-- Its day is today (D + 1), so the seven days before it are D - 6 .. D, all saved above.
update public.org_settings set weekly_digest_day = extract(dow from app.today_ist())::int;
create function pg_temp.weekly() returns jsonb language sql stable as $$
  select app.digest_weekly_payload(pg_temp.fx('org'), pg_temp.today_at('08:00'));
$$;
select is(pg_temp.weekly() -> 'week', jsonb_build_object('from', pg_temp.d() - 6, 'to', pg_temp.d()), 'the seven IST days before the digest day');
select is((select count(*) from jsonb_array_elements(pg_temp.weekly() -> 'days')), 7::bigint, 'one entry per day');
select is((select bool_and((d ->> 'saved')::boolean) from jsonb_array_elements(pg_temp.weekly() -> 'days') d), true, 'each from its saved report');
select is((select d ->> 'report_id' from jsonb_array_elements(pg_temp.weekly() -> 'days') d where d ->> 'date' = pg_temp.d()::text),
  (select id::text from public.eod_reports where report_date = pg_temp.d()), 'each day links to its report');
select is((select d - 'report_id' - 'date' from jsonb_array_elements(pg_temp.weekly() -> 'days') d where d ->> 'date' = pg_temp.d()::text),
  '{"saved": true, "present": 2, "on_leave": 1, "absent": 1, "end_not_recorded": 1, "overtime": 1, "completed": 2, "cancelled": 2, "created": 1, "decisions": 9, "holiday": null, "weekly_off": false}'::jsonb,
  'a day''s numbers are its saved report''s, not a fresh read (the overtime flag was cleared after the save)');
select is(pg_temp.weekly() -> 'totals',
  '{"present": 3, "on_leave": 1, "absent": 1, "end_not_recorded": 1, "overtime": 1, "completed": 3, "cancelled": 2, "created": 1, "decisions": 9, "missing": 0}'::jsonb,
  'the week''s totals (D - 1 had one present day and one task completed; the rest were empty when saved)');
select is((select d ->> 'holiday' from jsonb_array_elements(pg_temp.weekly() -> 'days') d where d ->> 'date' = (pg_temp.d() - 3)::text),
  'Dussehra', 'a day''s holiday comes from its saved report');
select is(pg_temp.weekly() -> 'now',
  jsonb_build_object('waiting', jsonb_build_object('tasks', 0, 'leave', 1, 'expense_claims', 1, 'attendance', 1, 'extra_work', 1),
                     'overdue', 2, 'unreachable', jsonb_build_object('count', 0, 'names', '[]'::jsonb, 'more', 0)),
  'now: what waits for the Owner, overdue now, can''t be reached');
select is((select jsonb_agg(l - 'member_id') from jsonb_array_elements(pg_temp.weekly() #> '{ahead,leave}') l),
  jsonb_build_array(
    jsonb_build_object('name', 'Filler', 'type', 'leave', 'from', app.today_ist() + 1, 'to', app.today_ist() + 1, 'pending', true),
    jsonb_build_object('name', 'Kiran', 'type', 'leave', 'from', app.today_ist() + 3, 'to', app.today_ist() + 4, 'pending', false)),
  'the week ahead: approved and pending leave in the next seven days (a rejected one, and one nine days on, are not)');
select is((select jsonb_agg(e ->> 'title' order by e ->> 'date') from jsonb_array_elements(pg_temp.weekly() #> '{ahead,events}') e),
  '["event_tomorrow", "event_later"]'::jsonb, 'the week ahead: event tasks (today to six days on)');
select is(pg_temp.weekly() #> '{ahead,holidays}', '[]'::jsonb, 'and holidays (none ahead)');
select is((select count(*) from jsonb_path_query(pg_temp.weekly(), 'strict $.** ? (@.type() == "object").keyvalue()') kv
           where kv ->> 'key' ~* '(amount|total_paid|price|cost|rupee|inr|money|salary|revenue)'), 0::bigint,
  'no amount-like key anywhere in the digest');
select is(app.digest_weekly_zero(pg_temp.weekly()), false, 'a week with anything in it is not zero');
select is(app.digest_weekly_zero('{"totals": {}, "now": {"waiting": {}, "unreachable": {}}, "ahead": {"leave": [], "events": [], "holidays": []}}'::jsonb),
  true, 'a week with nothing in it is zero');
select is(app.digest_weekly_text('{"totals": {}, "now": {"waiting": {}, "unreachable": {}}, "ahead": {"leave": [], "events": [], "holidays": []}}'::jsonb),
  'Nothing needs you this week.', 'and its text says so');
select ok(app.digest_weekly_text(pg_temp.weekly()) like 'The week: %' and app.digest_weekly_text(pg_temp.weekly()) like '%Now%Overdue now: 2%The week ahead%Events: 2%',
  'the body: the week, now, the week ahead');

select is(public.digest_weekly(pg_temp.today_at('07:59')), 0, 'not before 08:00 IST');
select is(public.digest_weekly(pg_temp.today_at('08:00')), 1, 'at 08:00 on the digest day, with yesterday''s report saved: one digest');
select is((select (title, link, read_at is not null, recipient_id = pg_temp.fx('owner'))::text from public.notifications where kind = 'owner_digest_weekly'),
  ('Your week · ' || app.notify_span(pg_temp.d() - 6, pg_temp.d()), '/reports/end-of-day', true, true)::text,
  'the subject line as its title, read at once, to the Owner, opening the reports');
select is((select payload from public.notifications where kind = 'owner_digest_weekly'), pg_temp.weekly(), 'its payload is the week');
select is((select count(*) from public.notification_deliveries d join public.notifications n on n.id = d.notification_id
           where n.kind = 'owner_digest_weekly'), 0::bigint, 'no push delivery');
select is(public.digest_weekly(pg_temp.today_at('08:05')), 0, 'the next tick writes nothing');
update public.org_settings set weekly_digest_day = extract(dow from app.today_ist() + 1)::int;
select is(public.digest_weekly(pg_temp.today_at('08:00') + interval '1 day'), 0, 'one per Owner per week, even when the day moves');
update public.org_settings set weekly_digest_day = extract(dow from app.today_ist())::int;
select pg_temp.as_member('owner');
select is((select count(*) from public.notifications where kind = 'owner_digest_weekly'), 0::bigint, 'the Owner never reads it in-app (email only)');
select is(public.owner_digest_weekly_preview() -> 'week', pg_temp.weekly() -> 'week', 'the Owner reads the preview');
select pg_temp.as_member('admin1');
select throws_ok($$select public.owner_digest_weekly_preview()$$, 'P0001', 'FORBIDDEN', 'an Admin is refused the preview');
select pg_temp.as_anon();
select throws_ok($$select public.owner_digest_weekly_preview()$$, '42501', null, 'a signed-out caller is refused the preview');
select pg_temp.as_system();

-- email_claim: the weekly digest is its own email, taken before older ordinary rows.
insert into public.notifications (org_id, recipient_id, kind, title, created_at)
values (pg_temp.fx('org'), pg_temp.fx('kiran'), 'reminder_overdue', 'Older ordinary', now() - interval '30 minutes');
-- Claimed at 08:01 on the digest day (the row's own moment; now() may be earlier than it).
select is((select array_agg(kind) from public.email_claim(pg_temp.today_at('08:01'), 1)), array['owner_digest_weekly'],
  'a run of one takes the weekly digest before older ordinary rows');
select is((select count(*) from public.email_claim(pg_temp.today_at('08:01'), 20) where kind = 'owner_digest_weekly'), 0::bigint,
  'and it was claimed once (a second run does not return it again)');

-- 8. The zero skip and an Owner-set cutoff ---------------------------------------------------------------------------
delete from public.task_reviews;
delete from public.task_assignees;
delete from public.tasks;
delete from public.attendance_events;
delete from public.attendance_days;
delete from public.leave_requests;
delete from public.extra_work_notes;
update public.org_settings set end_day_cutoff_time = '09:30';
select is(app.eod_report(pg_temp.today_at('09:29') + interval '1 day'), 0, 'with the cutoff at 09:30, 09:29 on D + 2 saves nothing new');
select is(app.eod_report(pg_temp.today_at('09:30') + interval '1 day'), 1, 'and 09:30 saves D + 1 (today)');
select is((select count(*) from public.notifications where kind = 'eod_report_ready'), 1::bigint,
  'a day with nothing on it is saved but the Owner is not told (the zero skip)');
select is(app.eod_report_zero((select data from public.eod_reports where report_date = app.today_ist())), true, 'that report is zero');

-- 9. Grants and the schedule -----------------------------------------------------------------------------------------
select ok(has_function_privilege('service_role', 'app.eod_report(timestamptz)', 'execute')
          and not has_function_privilege('authenticated', 'app.eod_report(timestamptz)', 'execute')
          and not has_function_privilege('anon', 'app.eod_report(timestamptz)', 'execute'),
  'eod_report is service_role only');
select ok(has_function_privilege('service_role', 'public.digest_weekly(timestamptz)', 'execute')
          and not has_function_privilege('authenticated', 'public.digest_weekly(timestamptz)', 'execute')
          and not has_function_privilege('anon', 'public.digest_weekly(timestamptz)', 'execute'),
  'digest_weekly is service_role only');
select ok(has_function_privilege('authenticated', 'public.eod_report_preview(date)', 'execute')
          and not has_function_privilege('anon', 'public.eod_report_preview(date)', 'execute'),
  'the report preview is callable by a signed-in member (and refuses all but the Owner)');
select ok(has_function_privilege('authenticated', 'public.owner_digest_weekly_preview()', 'execute')
          and not has_function_privilege('anon', 'public.owner_digest_weekly_preview()', 'execute'),
  'the digest preview is callable by a signed-in member (and refuses all but the Owner)');
select results_eq(
  $$ select jobname::text, schedule, command, active from cron.job where jobname in ('eod_report', 'digest_weekly') order by jobname $$,
  $$ values ('digest_weekly', '*/5 * * * *', 'select public.digest_weekly(now())', true),
            ('eod_report', '*/5 * * * *', 'select app.eod_report()', true) $$,
  'pg_cron runs eod_report and digest_weekly every 5 minutes (each acts once its setting''s time has passed)');
select is((select count(*) from cron.job where jobname = 'digest_daily'), 0::bigint, 'digest_daily is unscheduled (the function stays as history)');
select ok(has_function_privilege('service_role', 'public.digest_daily(timestamptz)', 'execute'), 'and still callable by hand as history');

select * from finish();
rollback;
