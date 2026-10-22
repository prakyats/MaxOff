-- v1.9 W0 (ROADMAP v1.9 W0; 6b.1; owner and Anna 2026-10-07, kickoff 6b decision 1, the owner's answers
-- 2026-10-22: attendance is Owner-only, OPEN 1-3 as recommended; migration working_hours; WORKFLOWS §1
-- "Working hours, late starts and leaving early", §8, §9; PERMISSIONS "As built (v1.9 W0)").
-- A. Date-driven, on fixed dates: the settings per role; early_leave_requests' RLS per role and no API
--    write; app.attendance_hours (the switch, a day off, a holiday, full leave, the halves, a shoot only
--    later, Stay until); the half on the four request paths; the reminders tick at explicit times (start
--    of day, not on leave, an afternoon half day reminded, once, the end-time reminder after Stay); the
--    Owner's decisions (approve a waiting request ends the day at the ask, stay, approve or correct a
--    "Left early, not answered" beside the original, refusals); Stay until refusals per role; the reads
--    per role; the month summary and the end-of-day report.
-- B. Clock-driven (the real now(): the working hours are set around it; skipped within ~2 h of
--    midnight IST): Start day marks Late (never blocked, nobody told), a morning half day is never
--    Late, the reason, "Shoot at ‹time›", End day refused before the end time, Ask to leave early (the
--    Owner only is told), the wait, "Left early, not answered", Stay until, Stay, Approve, lapsed, and
--    the switch off. Neutral names only.
begin;
create extension if not exists pgtap with schema extensions;
select plan(123);

delete from public.approval_reminder_sends;
delete from public.early_leave_requests;
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
  ('owner',  '00000000-0000-4000-8000-000000012101'),
  ('admin1', '00000000-0000-4000-8000-000000012102'),
  ('staff1', '00000000-0000-4000-8000-000000012103'),
  ('staff2', '00000000-0000-4000-8000-000000012104'),
  ('staff3', '00000000-0000-4000-8000-000000012105'),
  ('staff4', '00000000-0000-4000-8000-000000012106'),
  ('staff5', '00000000-0000-4000-8000-000000012107'),
  ('staff6', '00000000-0000-4000-8000-000000012108'),
  ('gone',   '00000000-0000-4000-8000-000000012109');
insert into fx select 'org', id from public.organizations limit 1;
grant select, insert on fx to authenticated, anon;

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
create function pg_temp.ist(t text) returns timestamptz language sql immutable as $$
  select (t::timestamp at time zone 'Asia/Kolkata');
$$;
create function pg_temp.h(k text, d date) returns record language sql stable as $$
  select row(h.rules_on, h.late_applies, h.early_applies, h.half, h.end_source) from app.attendance_hours(pg_temp.fx(k), d) h;
$$;
create function pg_temp.src(k text, d date) returns text language sql stable as $$
  select h.end_source from app.attendance_hours(pg_temp.fx(k), d) h;
$$;
-- A working date at least n days ahead (never a Sunday, the fixture's weekly off): request dates that stay
-- in the future whenever the test runs.
create function pg_temp.wd(n integer) returns date language sql stable as $$
  select case when extract(dow from app.today_ist() + n) = 0 then app.today_ist() + n + 1 else app.today_ist() + n end;
$$;
create function pg_temp.end_at(k text, d date) returns timestamptz language sql stable as $$
  select h.end_at from app.attendance_hours(pg_temp.fx(k), d) h;
$$;
create function pg_temp.notes(who text, kind text) returns bigint language sql stable as $$
  select count(*) from public.notifications n where n.recipient_id = pg_temp.fx(who) and n.kind = $2;
$$;
-- An approved leave for `k` on `d`.
create function pg_temp.leave(k text, d date, t public.leave_type, half text default null) returns void language sql as $$
  insert into public.leave_requests (member_id, type, start_date, end_date, state, source, decided_by, decided_at, half)
  values (pg_temp.fx(k), t, d, d, 'approved', 'owner', pg_temp.fx('owner'), now(), half);
$$;
-- A started day for `k` on `d` (IST wall times).
create function pg_temp.day(k text, d date, started text, ended text default null) returns uuid language sql as $$
  insert into public.attendance_days (member_id, work_date, state, submitted_choice, submitted_at, started_at, ended_at)
  values (pg_temp.fx(k), d, 'pending_review', 'present', pg_temp.ist(d || ' ' || started), pg_temp.ist(d || ' ' || started),
          case when ended is null then null else pg_temp.ist(d || ' ' || ended) end)
  returning id;
$$;
create function pg_temp.req(k text, d date, asked text, state text default 'waiting', left_at text default null) returns uuid
language sql as $$
  insert into public.early_leave_requests (org_id, member_id, day_id, requested_at, reason, end_at, state, left_at,
                                          decided_by, decided_at)
  select pg_temp.fx('org'), pg_temp.fx(k), dd.id, pg_temp.ist(d || ' ' || asked), 'A reason', pg_temp.ist(d || ' 18:00'), $4,
         case when $5 is null then null else pg_temp.ist(d || ' ' || $5) end,
         case when $4 in ('approved', 'stay', 'corrected') then pg_temp.fx('owner') end,
         case when $4 in ('approved', 'stay', 'corrected') then now() end
  from public.attendance_days dd where dd.member_id = pg_temp.fx(k) and dd.work_date = d
  returning id;
$$;

insert into auth.users (id, email) select id, key || '-121@example.com' from fx where key <> 'org';
insert into public.members (id, org_id, full_name, email, role, status, joined_at, deactivated_at)
select pg_temp.fx(k), pg_temp.fx('org'), initcap(k), k || '-121@example.com', r::public.member_role, s::public.member_status,
       pg_temp.ist('2026-09-01 09:00'), case when s = 'deactivated' then now() - interval '1 day' end
from (values ('owner', 'owner', 'active'), ('admin1', 'admin', 'active'), ('staff1', 'staff', 'active'),
             ('staff2', 'staff', 'active'), ('staff3', 'staff', 'active'), ('staff4', 'staff', 'active'),
             ('staff5', 'staff', 'active'), ('staff6', 'staff', 'active'), ('gone', 'staff', 'deactivated')) as v(k, r, s);
insert into public.task_types (org_id, name, kind, shows_on_calendar, has_location, position)
values (pg_temp.fx('org'), 'Type 121', 'event', true, false, 'z121');
insert into fx select 'type', id from public.task_types where org_id = pg_temp.fx('org') and name = 'Type 121';
update public.org_settings set weekly_off_days = '{0}', work_start_time = '10:00', work_end_time = '18:00'
where org_id = pg_temp.fx('org');
select pg_temp.as_member('owner');
insert into fx select 'free', public.member_add_freelancer('Free 121', null, null, pg_temp.fx('staff2'));
select pg_temp.as_system();

-- A. 1. Settings ------------------------------------------------------------------------------------
select is((select row(s.working_hours_on, s.late_grace_minutes, s.early_leave_wait_minutes)::text
           from public.org_settings s where s.org_id = pg_temp.fx('org')), row(false, 15, 30)::text,
  'working hours are off by default, with a 15-minute grace and a 30-minute wait');
select throws_ok($$ update public.org_settings set late_grace_minutes = 200 where org_id = pg_temp.fx('org') $$, '23514', null,
  'a grace over two hours is refused');
select throws_ok($$ update public.org_settings set early_leave_wait_minutes = 1 where org_id = pg_temp.fx('org') $$, '23514', null,
  'a wait under five minutes is refused');
select pg_temp.as_member('owner');
update public.org_settings set late_grace_minutes = 10, early_leave_wait_minutes = 20 where org_id = pg_temp.fx('org');
select pg_temp.as_member('admin1');
update public.org_settings set working_hours_on = true, late_grace_minutes = 60 where org_id = pg_temp.fx('org');
select pg_temp.as_member('staff1');
update public.org_settings set working_hours_on = true, early_leave_wait_minutes = 5 where org_id = pg_temp.fx('org');
select pg_temp.as_system();
select is((select row(s.working_hours_on, s.late_grace_minutes, s.early_leave_wait_minutes)::text
           from public.org_settings s where s.org_id = pg_temp.fx('org')), row(false, 10, 20)::text,
  'the Owner edits them; an Admin''s and a Crew member''s updates match no row');
select pg_temp.as_anon();
select throws_ok($$ update public.org_settings set working_hours_on = true $$, '42501', null, 'anon has no privilege on the switch');
select pg_temp.as_system();
update public.org_settings set late_grace_minutes = 15, early_leave_wait_minutes = 30 where org_id = pg_temp.fx('org');

-- A. 2. The hours of a day (Wed 4 Nov 2026 and around it) -------------------------------------------
select is(pg_temp.h('staff1', '2026-11-04'), row(false, false, false, null::text, 'work'::text),
  'with the switch off no rule applies');
update public.org_settings set working_hours_on = true where org_id = pg_temp.fx('org');
select is(pg_temp.h('staff1', '2026-11-04'), row(true, true, true, null::text, 'work'::text),
  'on a working day Late and early leave apply');
select is((select row(h.start_at, h.late_after, h.end_at)::text from app.attendance_hours(pg_temp.fx('staff1'), '2026-11-04') h),
  row(pg_temp.ist('2026-11-04 10:00'), pg_temp.ist('2026-11-04 10:15'), pg_temp.ist('2026-11-04 18:00'))::text,
  'start 10:00, Late after 10:15, end 18:00');
select is(pg_temp.h('staff1', '2026-11-08'), row(true, false, false, null::text, 'work'::text), 'a weekly off has no rule');
insert into public.holidays (org_id, date, name) values (pg_temp.fx('org'), '2026-11-05', 'Holiday 121');
select is(pg_temp.h('staff1', '2026-11-05'), row(true, false, false, null::text, 'work'::text), 'a holiday has no rule');
select pg_temp.leave('staff2', '2026-11-04', 'half_day', 'morning');
select pg_temp.leave('staff3', '2026-11-04', 'half_day', 'afternoon');
select pg_temp.leave('staff4', '2026-11-04', 'half_day');
select pg_temp.leave('staff5', '2026-11-04', 'leave');
select is(pg_temp.h('staff2', '2026-11-04'), row(true, false, true, 'morning'::text, 'work'::text),
  'a morning half day (off in the morning) is never Late');
select is(pg_temp.h('staff3', '2026-11-04'), row(true, true, false, 'afternoon'::text, 'work'::text),
  'an afternoon half day (off in the afternoon) is never an early leave');
select is(pg_temp.h('staff4', '2026-11-04'), row(true, false, false, null::text, 'work'::text),
  'an older half day with no half has neither rule');
select is(pg_temp.h('staff5', '2026-11-04'), row(true, false, false, null::text, 'work'::text),
  'a day of full leave has no rule');

insert into public.tasks (org_id, title, task_type_id, priority, due_at, state, created_by, primary_owner_id,
                          event_date, event_start_at, event_end_at)
values (pg_temp.fx('org'), 'Shoot late', pg_temp.fx('type'), 'medium', pg_temp.ist('2026-11-04 20:00'), 'todo',
        pg_temp.fx('owner'), pg_temp.fx('staff1'), '2026-11-04', pg_temp.ist('2026-11-04 14:00'), pg_temp.ist('2026-11-04 19:30')),
       (pg_temp.fx('org'), 'Shoot early', pg_temp.fx('type'), 'medium', pg_temp.ist('2026-11-04 20:00'), 'todo',
        pg_temp.fx('owner'), pg_temp.fx('staff6'), '2026-11-04', pg_temp.ist('2026-11-04 09:00'), pg_temp.ist('2026-11-04 15:00'));
insert into public.task_assignees (task_id, member_id, is_primary)
select t.id, t.primary_owner_id, true from public.tasks t where t.title in ('Shoot late', 'Shoot early');
select is(pg_temp.end_at('staff1', '2026-11-04'), pg_temp.ist('2026-11-04 19:30'), 'a shoot ending at 19:30 moves the end later');
select is(pg_temp.src('staff1', '2026-11-04'), 'shoot', 'and says so');
select is(pg_temp.end_at('staff6', '2026-11-04'), pg_temp.ist('2026-11-04 18:00'), 'a shoot ending at 15:00 never moves it earlier');
select pg_temp.day('staff6', '2026-11-04', '10:00');
update public.attendance_days set stay_until = pg_temp.ist('2026-11-04 20:00') where member_id = pg_temp.fx('staff6') and work_date = '2026-11-04';
select is(pg_temp.end_at('staff6', '2026-11-04'), pg_temp.ist('2026-11-04 20:00'), 'Stay until moves the end to its time');
select is(pg_temp.src('staff6', '2026-11-04'), 'stay', 'and says so');

-- A. 3. The half on the request paths ----------------------------------------------------------------
select pg_temp.as_member('staff1');
select throws_ok(format($$ select public.leave_submit('leave', %L, %L, null, 'morning') $$, pg_temp.wd(21), pg_temp.wd(21)),
  'P0001', 'VALIDATION', 'a half on full leave is refused');
select throws_ok(format($$ select public.leave_submit('half_day', %L, %L, null, 'evening') $$, pg_temp.wd(21), pg_temp.wd(21)),
  'P0001', 'VALIDATION', 'a half other than morning or afternoon is refused');
select lives_ok(format($$ select public.leave_submit('half_day', %L, %L, 'Clinic', 'afternoon') $$, pg_temp.wd(21), pg_temp.wd(21)),
  'a half day with its half is requested');
select lives_ok(format($$ select public.leave_submit('half_day', %L, %L) $$, pg_temp.wd(28), pg_temp.wd(28)),
  'a half day without a half still works (the released app''s call)');
select pg_temp.as_system();
select is((select half from public.leave_requests where member_id = pg_temp.fx('staff1') and start_date = pg_temp.wd(21)), 'afternoon',
  'the half is stored');
select is((select half from public.leave_requests where member_id = pg_temp.fx('staff1') and start_date = pg_temp.wd(28)), null,
  'no half stays null');
-- A comp credit valid well past the date (comp_leave_grant's expires at its month's end).
insert into public.comp_leave_credits (member_id, days, granted_by, granted_on, expires_on, note)
values (pg_temp.fx('staff1'), 1.0, pg_temp.fx('owner'), app.today_ist(), app.today_ist() + 120, 'Weekend');
select pg_temp.as_member('staff1');
select lives_ok(format($$ select public.leave_submit_comp(%L, true, null, 'morning') $$, pg_temp.wd(35)),
  'comp leave as a half day takes its half');
select pg_temp.as_system();
select is((select half from public.leave_requests where member_id = pg_temp.fx('staff1') and start_date = pg_temp.wd(35)), 'morning',
  'the comp half day keeps its half');
select is((select count(*) from pg_proc where proname in ('leave_submit', 'leave_submit_comp', 'attendance_submit', 'attendance_choose_leave_today')
           and pronamespace = 'public'::regnamespace), 4::bigint, 'each request path has one signature (the old ones dropped)');

-- A. 4. RLS on early_leave_requests ----------------------------------------------------------------
select pg_temp.day('staff1', '2026-10-20', '10:00');
select pg_temp.day('staff2', '2026-10-20', '10:00');
select pg_temp.day('admin1', '2026-10-20', '10:00');
select pg_temp.day('staff3', '2026-10-20', '10:00', '16:20');
select pg_temp.day('staff4', '2026-10-20', '10:00', '16:40');
insert into fx select 'r1', pg_temp.req('staff1', '2026-10-20', '16:00');
insert into fx select 'r2', pg_temp.req('staff2', '2026-10-20', '15:00');
insert into fx select 'ra', pg_temp.req('admin1', '2026-10-20', '17:00');
insert into fx select 'r3', pg_temp.req('staff3', '2026-10-20', '15:30', 'left_unanswered', '16:20');
insert into fx select 'r4', pg_temp.req('staff4', '2026-10-20', '15:50', 'left_unanswered', '16:40');
select pg_temp.as_member('staff1');
select is((select count(*) from public.early_leave_requests), 1::bigint, 'a Crew member reads only their own request');
select throws_ok($$ insert into public.early_leave_requests (org_id, member_id, day_id, reason, end_at)
                    select pg_temp.fx('org'), pg_temp.fx('staff1'), id, 'x', now() from public.attendance_days limit 1 $$,
  '42501', null, 'a Crew member cannot write a request directly');
select throws_ok($$ update public.early_leave_requests set state = 'approved' $$, '42501', null, 'nor change one');
select pg_temp.as_member('admin1');
select is((select count(*) from public.early_leave_requests), 1::bigint, 'an Admin reads only their own request (no attendance controls)');
select pg_temp.as_member('owner');
select is((select count(*) from public.early_leave_requests), 5::bigint, 'the Owner reads everyone''s');
select pg_temp.as_anon();
select throws_ok($$ select count(*) from public.early_leave_requests $$, '42501', null, 'anon reads nothing');
select pg_temp.as_system();

-- A. 5. The Owner's decisions -------------------------------------------------------------------------
select pg_temp.as_member('admin1');
select throws_ok(format($$ select public.early_leave_decide(%L, 'approve') $$, pg_temp.fx('r1')), 'P0001', 'FORBIDDEN',
  'an Admin cannot decide an early leave');
select pg_temp.as_member('staff2');
select throws_ok(format($$ select public.early_leave_decide(%L, 'approve') $$, pg_temp.fx('r1')), 'P0001', 'FORBIDDEN',
  'a Crew member cannot decide an early leave');
select pg_temp.as_member('gone');
select throws_ok(format($$ select public.early_leave_decide(%L, 'approve') $$, pg_temp.fx('r1')), 'P0001', 'UNAUTHENTICATED',
  'a deactivated member cannot');
select pg_temp.as_member('owner');
select throws_ok(format($$ select public.early_leave_decide(%L, 'maybe') $$, pg_temp.fx('r1')), 'P0001', 'VALIDATION',
  'a decision is approve, stay or correct');
select throws_ok($$ select public.early_leave_decide('00000000-0000-4000-8000-0000000121ff', 'approve') $$, 'P0001', 'NOT_FOUND',
  'an unknown request is not found');
select is(public.early_leave_decide(pg_temp.fx('r1'), 'approve'), 'approved', 'the Owner approves a waiting request');
select is(public.early_leave_decide(pg_temp.fx('ra'), 'approve'), 'approved', 'the Owner decides an Admin''s own request too');
select is(public.early_leave_decide(pg_temp.fx('r2'), 'stay', null, 'Busy hour'), 'stay', 'the Owner asks someone to stay');
select throws_ok(format($$ select public.early_leave_decide(%L, 'approve') $$, pg_temp.fx('r1')), 'P0001', 'INVALID_STATE',
  'an answered request cannot be answered again');
select throws_ok(format($$ select public.early_leave_decide(%L, 'stay') $$, pg_temp.fx('r3')), 'P0001', 'INVALID_STATE',
  'Stay is not offered once they have left');
select throws_ok(format($$ select public.early_leave_decide(%L, 'correct', 'half_day') $$, pg_temp.fx('r4')), 'P0001', 'VALIDATION',
  'a correction needs a reason');
select is(public.early_leave_decide(pg_temp.fx('r3'), 'approve'), 'approved', '"Left early, not answered" can be approved later');
select is(public.early_leave_decide(pg_temp.fx('r4'), 'correct', 'half_day', 'Left at four'), 'corrected',
  'or corrected');
select pg_temp.as_system();
select is((select d.ended_at from public.attendance_days d where d.member_id = pg_temp.fx('staff1') and d.work_date = '2026-10-20'),
  pg_temp.ist('2026-10-20 16:00'), 'Approve ends the day at the time they asked');
select is((select count(*) from public.attendance_events e join public.attendance_days d on d.id = e.attendance_day_id
           where d.member_id = pg_temp.fx('staff1') and d.work_date = '2026-10-20' and e.action = 'ended'), 1::bigint,
  'the day''s history records the end');
select is((select d.ended_at from public.attendance_days d where d.member_id = pg_temp.fx('staff2') and d.work_date = '2026-10-20'),
  null, 'Stay leaves the day open');
select is((select row(d.state, d.final_status, d.started_at, d.ended_at)::text from public.attendance_days d
           where d.member_id = pg_temp.fx('staff4') and d.work_date = '2026-10-20'),
  row('corrected'::public.attendance_state, 'half_day'::public.day_status, pg_temp.ist('2026-10-20 10:00'), pg_temp.ist('2026-10-20 16:40'))::text,
  'a correction sits beside the original: the start and the end stay as tapped');
select is((select left_at from public.early_leave_requests where id = pg_temp.fx('r3')), pg_temp.ist('2026-10-20 16:20'),
  'an approved "Left early, not answered" keeps when they left');
select is(pg_temp.notes('staff1', 'early_leave_decided'), 1::bigint, 'the person is told the answer');
select is(pg_temp.notes('staff2', 'early_leave_decided'), 1::bigint, 'and the one asked to stay');
select is(pg_temp.notes('staff4', 'attendance_decided'), 1::bigint, 'a correction is told as an attendance decision');
select is((select count(*) from public.activity_log a where a.entity = 'early_leave_requests' and a.entity_id = pg_temp.fx('r1')
           and a.action = 'approved'), 1::bigint, 'the decision is audited');

-- A. 6. Stay until: the Owner only ---------------------------------------------------------------------
select pg_temp.as_member('admin1');
select throws_ok(format($$ select public.attendance_stay_until(%L, now() + interval '3 hours') $$, pg_temp.fx('staff1')),
  'P0001', 'FORBIDDEN', 'an Admin cannot set Stay until, not even for Crew');
select throws_ok(format($$ select public.attendance_stay_until(%L, now() + interval '3 hours') $$, pg_temp.fx('admin1')),
  'P0001', 'FORBIDDEN', 'nor for an Admin');
select pg_temp.as_member('staff2');
select throws_ok(format($$ select public.attendance_stay_until(%L, now() + interval '3 hours') $$, pg_temp.fx('staff1')),
  'P0001', 'FORBIDDEN', 'a Crew member cannot');
select pg_temp.as_member('owner');
select throws_ok(format($$ select public.attendance_stay_until(%L, now() + interval '3 hours') $$, pg_temp.fx('free')),
  'P0001', 'VALIDATION', 'a freelancer has no attendance');
select throws_ok(format($$ select public.attendance_stay_until(%L, now() + interval '3 hours') $$, pg_temp.fx('owner')),
  'P0001', 'VALIDATION', 'the Owner has no working day');
select throws_ok($$ select public.attendance_stay_until('00000000-0000-4000-8000-0000000121fe', now()) $$,
  'P0001', 'NOT_FOUND', 'someone outside the team is not found');
select pg_temp.as_member('staff2');
select throws_ok($$ select public.attendance_late_reason('x') $$, 'P0001', 'INVALID_STATE', 'no reason without a Late day');
select pg_temp.as_member('owner');
select throws_ok($$ select public.attendance_ask_leave_early('x') $$, 'P0001', 'FORBIDDEN', 'the Owner has no day to leave early');
select pg_temp.as_member('gone');
select throws_ok($$ select public.attendance_ask_leave_early('x') $$, 'P0001', 'UNAUTHENTICATED', 'a deactivated member cannot ask');
select pg_temp.as_system();

-- A. 7. The reminders tick at explicit times (Wed 4 Nov) ------------------------------------------------
-- staff1: nothing yet that day (reminded); staff2 morning half (not); staff3 afternoon half (reminded);
-- staff4 half day with no half (on leave: not); staff5 full leave (not); staff6 started (not); admin1
-- (reminded); the Owner, the freelancer and the deactivated member never.
select is(app.attendance_hours_tick(pg_temp.ist('2026-11-04 09:55')), 0, 'nothing before the start time');
select is(app.attendance_hours_tick(pg_temp.ist('2026-11-04 10:01')), 3, '"Start your day" at the start time');
select is((select array_agg(m.full_name order by m.full_name) from public.notifications n join public.members m on m.id = n.recipient_id
           where n.kind = 'start_day_reminder'), array['Admin1', 'Staff1', 'Staff3'],
  'to whoever has not started and is not on leave (an afternoon half day works the morning)');
select is(app.attendance_hours_tick(pg_temp.ist('2026-11-04 10:06')), 0, 'once a day');
select is((select count(*) from public.notification_kinds k where k.kind in ('start_day_reminder', 'end_time_reminder',
           'early_leave_requested', 'early_leave_decided', 'stay_until_set') and not k.actionable and not k.always_email),
  5::bigint, 'none of the five kinds is ever emailed');
select is(app.attendance_hours_tick(pg_temp.ist('2026-11-05 10:01')), 0, 'a holiday reminds nobody');
insert into fx select 'r6', pg_temp.req('staff6', '2026-11-04', '16:00', 'stay');
select is(app.attendance_hours_tick(pg_temp.ist('2026-11-04 18:05')), 0, 'after Stay, nothing before the end time (Stay until 20:00)');
select is(app.attendance_hours_tick(pg_temp.ist('2026-11-04 20:01')), 1, 'the end-time reminder at the end time');
select is(app.attendance_hours_tick(pg_temp.ist('2026-11-04 20:06')), 0, 'once');
update public.org_settings set working_hours_on = false where org_id = pg_temp.fx('org');
delete from public.notifications where kind = 'start_day_reminder';
select is(app.attendance_hours_tick(pg_temp.ist('2026-11-04 10:11')), 0, 'with the switch off nobody is reminded');
update public.org_settings set working_hours_on = true where org_id = pg_temp.fx('org');

-- A. 8. The reads per role, the month and the end-of-day report -----------------------------------------
update public.attendance_days set late_minutes = 25, late_reason = 'Bus' where member_id = pg_temp.fx('staff6') and work_date = '2026-11-04';
select pg_temp.as_member('owner');
select is((select r.late_days from public.month_summary_hours('2026-11-01') r where r.id = pg_temp.fx('staff6')), 1,
  'the month counts late days');
select is((select row(r.early_leaves, r.left_unanswered)::text from public.month_summary_hours('2026-10-01') r where r.id = pg_temp.fx('staff3')),
  row(1, 1)::text, 'and early leaves, with those not answered');
select is((select r.early_leaves from public.month_summary_hours('2026-10-01') r where r.id = pg_temp.fx('staff2')), 0,
  'a Stay is not an early leave');
select ok((select count(*) from public.attendance_hours_today()) >= 7, 'the Owner reads everyone''s hours today');
select pg_temp.as_member('admin1');
select throws_ok($$ select * from public.attendance_hours_today() $$, 'P0001', 'FORBIDDEN', 'an Admin cannot');
select throws_ok($$ select * from public.month_summary_hours('2026-11-01') $$, 'P0001', 'FORBIDDEN', 'nor read the month');
select pg_temp.as_member('staff1');
select throws_ok($$ select * from public.attendance_hours_today() $$, 'P0001', 'FORBIDDEN', 'nor a Crew member');
select lives_ok($$ select * from public.attendance_own_hours() $$, 'a Crew member reads their own hours');
select pg_temp.as_member('admin1');
select lives_ok($$ select * from public.attendance_own_hours() $$, 'so does an Admin');
select pg_temp.as_member('owner');
select throws_ok($$ select * from public.attendance_own_hours() $$, 'P0001', 'FORBIDDEN', 'the Owner has no working day');
select pg_temp.as_anon();
select throws_ok($$ select * from public.attendance_hours_today() $$, '42501', null, 'anon cannot call the reads');
select pg_temp.as_system();
select is((app.eod_report_payload(pg_temp.fx('org'), '2026-10-20', now()) -> 'attendance' -> 'counts' ->> 'left_early')::int, 4,
  'the end-of-day report counts the early leaves');
select is((select p ->> 'left_early' from jsonb_array_elements(app.eod_report_payload(pg_temp.fx('org'), '2026-10-20', now()) -> 'attendance' -> 'people') p
           where p ->> 'member_id' = pg_temp.fx('staff3')::text), 'approved', 'and names how each one ended');
select is((app.eod_report_payload(pg_temp.fx('org'), '2026-11-04', now()) -> 'attendance' -> 'counts' ->> 'late')::int, 1,
  'and the late starts');
select is((select p ->> 'late_reason' from jsonb_array_elements(app.eod_report_payload(pg_temp.fx('org'), '2026-11-04', now()) -> 'attendance' -> 'people') p
           where p ->> 'member_id' = pg_temp.fx('staff6')::text), 'Bus', 'with the reason');

-- B. Clock-driven ------------------------------------------------------------------------------------
create function pg_temp.clocked() returns setof text language plpgsql as $f$
declare
  v_t time := (now() at time zone 'Asia/Kolkata')::time;
  v_req uuid;
  v_end timestamptz;
  v_shoot text := 'Shoot at ' || app.ist_time(now() + interval '30 minutes');
begin
  if v_t < '01:45' or v_t > '21:15' then
    return next skip('the clock-driven checks need the IST time between 01:45 and 21:15', 34);
    return;
  end if;
  delete from public.holidays where date = app.today_ist();
  update public.org_settings set weekly_off_days = '{}', working_hours_on = true, late_grace_minutes = 15,
    early_leave_wait_minutes = 30, work_start_time = date_trunc('minute', v_t - interval '90 minutes')::time,
    work_end_time = date_trunc('minute', v_t + interval '120 minutes')::time
  where org_id = pg_temp.fx('org');
  delete from public.notifications;
  perform pg_temp.leave('staff2', app.today_ist(), 'half_day', 'morning');
  insert into public.tasks (org_id, title, task_type_id, priority, due_at, state, created_by, primary_owner_id,
                            event_date, event_start_at, event_end_at)
  values (pg_temp.fx('org'), 'Shoot today', pg_temp.fx('type'), 'medium', now() + interval '3 hours', 'todo',
          pg_temp.fx('owner'), pg_temp.fx('staff1'), app.today_ist(), now() + interval '30 minutes', now() + interval '40 minutes');
  insert into public.task_assignees (task_id, member_id, is_primary)
  select t.id, t.primary_owner_id, true from public.tasks t where t.title = 'Shoot today';

  -- Start day: Late, never blocked, nobody told.
  perform pg_temp.as_member('staff1');
  return next lives_ok($$ select public.attendance_start_day() $$, 'a late Start day still works');
  perform pg_temp.as_system();
  return next ok((select d.late_minutes from public.attendance_days d where d.member_id = pg_temp.fx('staff1') and d.work_date = app.today_ist())
                 between 90 and 91, 'it records the minutes after the start time');
  return next is((select count(*) from public.notifications), 0::bigint, 'a late start notifies nobody');
  perform pg_temp.as_member('staff2');
  perform public.attendance_start_day();
  perform pg_temp.as_system();
  return next is((select d.late_minutes from public.attendance_days d where d.member_id = pg_temp.fx('staff2') and d.work_date = app.today_ist()),
    null, 'a morning half day is never Late');

  perform pg_temp.as_member('staff1');
  return next is((select o.late_reason_suggestion from public.attendance_own_hours() o),
    v_shoot, 'a shoot later that day pre-fills the reason');
  return next throws_ok($$ select public.attendance_late_reason('   ') $$, 'P0001', 'VALIDATION', 'the reason cannot be empty');
  return next lives_ok($$ select public.attendance_late_reason('Traffic') $$, 'the person adds the reason');
  return next is((select o.late_reason from public.attendance_own_hours() o), 'Traffic', 'and reads it back');
  return next is((select o.can_end_now from public.attendance_own_hours() o), false, 'End day is not open before the end time');

  -- End day before the end time, and Ask to leave early.
  return next throws_ok($$ select public.attendance_end_day() $$, 'P0001', 'INVALID_STATE', 'End day is refused before the end time');
  return next throws_ok($$ select public.attendance_ask_leave_early('') $$, 'P0001', 'VALIDATION', 'asking needs a reason');
  v_req := public.attendance_ask_leave_early('Doctor at five');
  return next ok(v_req is not null, 'the person asks to leave early');
  return next throws_ok($$ select public.attendance_ask_leave_early('Again') $$, 'P0001', 'CONFLICT', 'one request waits at a time');
  return next throws_ok($$ select public.attendance_end_day() $$, 'P0001', 'INVALID_STATE', 'End day waits for the answer');
  perform pg_temp.as_system();
  return next is(pg_temp.notes('owner', 'early_leave_requested'), 1::bigint, 'the Owner is told');
  return next is(pg_temp.notes('admin1', 'early_leave_requested'), 0::bigint, 'Admins are not');
  return next is((select count(*) from public.notification_deliveries d join public.notifications n on n.id = d.notification_id
                  where n.kind = 'early_leave_requested' and d.channel = 'push'), 1::bigint, 'by push');

  -- Unanswered for the wait: End day records the tap and marks it.
  update public.early_leave_requests set requested_at = now() - interval '31 minutes' where id = v_req;
  perform pg_temp.as_member('staff1');
  return next is((select o.can_end_now from public.attendance_own_hours() o), true, 'after the wait End day opens');
  return next lives_ok($$ select public.attendance_end_day() $$, 'the person ends the day');
  perform pg_temp.as_system();
  return next is((select row(e.state, e.left_at = now())::text from public.early_leave_requests e where e.id = v_req),
    row('left_unanswered', true)::text, 'marked "Left early, not answered" at the real tap');
  return next is((select d.ended_at from public.attendance_days d where d.member_id = pg_temp.fx('staff1') and d.work_date = app.today_ist()),
    now(), 'the recorded end is the real tap');

  -- Stay until (the Owner), then Stay.
  perform pg_temp.as_member('staff3');
  perform public.attendance_start_day();
  perform pg_temp.as_member('owner');
  return next throws_ok(format($$ select public.attendance_stay_until(%L, now() + interval '60 minutes') $$, pg_temp.fx('staff3')),
    'P0001', 'VALIDATION', 'Stay until must be after the working day''s end');
  v_end := public.attendance_stay_until(pg_temp.fx('staff3'), date_trunc('minute', now() + interval '150 minutes'));
  return next is(v_end, date_trunc('minute', now() + interval '150 minutes'), 'the Owner sets Stay until');
  perform pg_temp.as_system();
  return next is(pg_temp.notes('staff3', 'stay_until_set'), 1::bigint, 'the person is told at once');
  perform pg_temp.as_member('staff3');
  return next is((select o.end_source from public.attendance_own_hours() o), 'stay', 'their end time is the Stay until');
  v_req := public.attendance_ask_leave_early('Family');
  perform pg_temp.as_member('owner');
  perform public.early_leave_decide(v_req, 'stay');
  perform pg_temp.as_member('staff3');
  return next throws_ok($$ select public.attendance_end_day() $$, 'P0001', 'INVALID_STATE', 'after Stay, End day waits for the end time');

  -- Approve ends the day at the ask.
  perform pg_temp.as_member('admin1');
  perform public.attendance_start_day();
  v_req := public.attendance_ask_leave_early('Pickup');
  perform pg_temp.as_member('owner');
  return next is(public.early_leave_decide(v_req, 'approve'), 'approved', 'the Owner approves');
  perform pg_temp.as_system();
  return next is((select d.ended_at from public.attendance_days d where d.member_id = pg_temp.fx('admin1') and d.work_date = app.today_ist()),
    (select requested_at from public.early_leave_requests where id = v_req), 'the day ends at the time they asked');

  -- At or after the end time a request still waiting lapses.
  perform pg_temp.as_member('staff5');
  perform public.attendance_start_day();
  v_req := public.attendance_ask_leave_early('Rain');
  perform pg_temp.as_system();
  update public.org_settings set work_end_time = date_trunc('minute', v_t - interval '1 minute')::time where org_id = pg_temp.fx('org');
  perform pg_temp.as_member('staff5');
  return next lives_ok($$ select public.attendance_end_day() $$, 'after the end time End day is one tap');
  perform pg_temp.as_system();
  return next is((select e.state from public.early_leave_requests e where e.id = v_req), 'lapsed', 'the waiting request lapses');

  -- The switch off: no Late, End day any time.
  update public.org_settings set working_hours_on = false, work_end_time = date_trunc('minute', v_t + interval '120 minutes')::time
  where org_id = pg_temp.fx('org');
  perform pg_temp.as_member('staff6');
  perform public.attendance_start_day();
  perform pg_temp.as_system();
  return next is((select d.late_minutes from public.attendance_days d where d.member_id = pg_temp.fx('staff6') and d.work_date = app.today_ist()),
    null, 'with the switch off a late start is not marked');
  perform pg_temp.as_member('staff6');
  return next lives_ok($$ select public.attendance_end_day() $$, 'and End day works any time, as before');
  perform pg_temp.as_member('staff4');
  return next throws_ok($$ select public.attendance_ask_leave_early('x') $$, 'P0001', 'INVALID_STATE', 'Ask to leave early needs a started day');
  perform pg_temp.as_system();
end;
$f$;
select * from pg_temp.clocked();

select * from finish();
rollback;
