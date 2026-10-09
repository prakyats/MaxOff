-- Unit 6B2, the owner's two answers (2026-10-08).
-- (1) Kickoff 6 decision 24 amended (migration end_not_recorded_yesterday): the Owner's "End of day
--     not recorded" counts yesterday's days with a Start day and no End day, from the End-day cutoff
--     through the rest of today, until the Owner decides the day (approved or corrected).
--     app.attendance_unended_yesterday() is the rule; attendance_end_not_recorded_yesterday() the
--     Owner's read (Owner allowed; Admin, Crew and a signed-out caller refused).
-- (2) Kickoff 6 decision 23 amended (migration digest_since_last): the weekly digest covers the days
--     since the last digest sent, capped at seven, so moving the digest day later or earlier in the
--     week sends on the first occurrence of the new day, never skipping a week.
begin;
create extension if not exists pgtap with schema extensions;
select plan(37);

-- 7A: client work rows reference clients and members, and the presets the organization (a
-- Playwright run leaves some behind).
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
set weekly_off_days = '{}', end_day_cutoff_time = '05:00', weekly_digest_day = 1;

create temporary table fx (key text primary key, id uuid not null);
insert into fx values
  ('owner',  '00000000-0000-4000-8000-000000006501'),
  ('admin1', '00000000-0000-4000-8000-000000006502'),
  ('staff1', '00000000-0000-4000-8000-000000006503'),
  ('staff2', '00000000-0000-4000-8000-000000006504'),
  ('staff3', '00000000-0000-4000-8000-000000006505'),
  ('staff4', '00000000-0000-4000-8000-000000006506'),
  ('free1',  '00000000-0000-4000-8000-000000006507'),
  ('gone1',  '00000000-0000-4000-8000-000000006508');
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
-- Today (IST) and an instant of an IST day at an IST time, spelled without app.* (anon has no
-- usage on schema app).
create function pg_temp.today() returns date language sql stable as $$ select (now() at time zone 'Asia/Kolkata')::date; $$;
create function pg_temp.at(d date, t time) returns timestamptz language sql stable as $$ select (d + t)::timestamp at time zone 'Asia/Kolkata'; $$;
create function pg_temp.y() returns date language sql stable as $$ select pg_temp.today() - 1; $$;
-- Who the rule counts at a moment: names in order.
create function pg_temp.unended(p_now timestamptz) returns text language sql stable as $$
  select coalesce(string_agg(u.full_name, ' ' order by u.full_name), '')
  from app.attendance_unended_yesterday(pg_temp.fx('org'), p_now) u;
$$;
create function pg_temp.day_of(k text, d date) returns uuid language sql stable as $$
  select id from public.attendance_days where member_id = pg_temp.fx(k) and work_date = d;
$$;

-- Free1 is a freelancer: no login and no email (ADR-0013; members_email_matches_engagement).
insert into auth.users (id, email) select id, key || '@example.com' from fx where key not in ('org', 'free1');
insert into public.members (id, org_id, full_name, email, role, status, joined_at)
select pg_temp.fx(k), pg_temp.fx('org'), initcap(k), k || '@example.com', r::public.member_role, 'active', now() - interval '90 days'
from (values ('owner', 'owner'), ('admin1', 'admin'), ('staff1', 'staff'), ('staff2', 'staff'), ('staff3', 'staff'),
             ('staff4', 'staff')) as v(k, r);
insert into public.members (id, org_id, full_name, email, role, status, joined_at, engagement)
values (pg_temp.fx('free1'), pg_temp.fx('org'), 'Free1', null, 'staff', 'active', now() - interval '90 days', 'freelance');
insert into public.member_coordinators (member_id, coordinator_id) values (pg_temp.fx('free1'), pg_temp.fx('staff2'));
-- Gone1 was deactivated this morning, after yesterday's day.
insert into public.members (id, org_id, full_name, email, role, status, joined_at, deactivated_at)
values (pg_temp.fx('gone1'), pg_temp.fx('org'), 'Gone1', 'gone1@example.com', 'staff', 'deactivated',
        now() - interval '90 days', now() - interval '1 hour');

-- 1. Yesterday's End day not recorded ---------------------------------------------------------------
-- Yesterday: Staff1 and Admin1 started and never ended (waiting for the Owner); Staff2 started and
-- ended; Staff3 started, never ended, and the Owner approved the day; Staff4 started, never ended,
-- and the Owner corrected it. The day before: Staff2 started and never ended (not yesterday).
-- Left out whatever their day: the Owner, a freelancer and a deactivated member, each of whom has a
-- started day yesterday with no End day that nobody decided.
insert into public.attendance_days (member_id, work_date, state, submitted_choice, submitted_at, final_status,
                                    decided_at, decision_reason, started_at, ended_at, end_not_recorded)
values
  (pg_temp.fx('staff1'), pg_temp.y(), 'pending_review', 'present', pg_temp.at(pg_temp.y(), '09:00'), null,
   null, null, pg_temp.at(pg_temp.y(), '09:00'), null, true),
  (pg_temp.fx('admin1'), pg_temp.y(), 'pending_review', 'present', pg_temp.at(pg_temp.y(), '09:30'), null,
   null, null, pg_temp.at(pg_temp.y(), '09:30'), null, true),
  (pg_temp.fx('staff2'), pg_temp.y(), 'pending_review', 'present', pg_temp.at(pg_temp.y(), '09:00'), null,
   null, null, pg_temp.at(pg_temp.y(), '09:00'), pg_temp.at(pg_temp.y(), '18:00'), false),
  (pg_temp.fx('staff3'), pg_temp.y(), 'approved', 'present', pg_temp.at(pg_temp.y(), '09:00'), 'present',
   pg_temp.at(pg_temp.y(), '12:00'), null, pg_temp.at(pg_temp.y(), '09:00'), null, true),
  (pg_temp.fx('staff4'), pg_temp.y(), 'corrected', 'present', pg_temp.at(pg_temp.y(), '09:00'), 'half_day',
   pg_temp.at(pg_temp.y(), '12:00'), 'Left at noon', pg_temp.at(pg_temp.y(), '09:00'), null, true),
  (pg_temp.fx('staff2'), pg_temp.y() - 1, 'pending_review', 'present', pg_temp.at(pg_temp.y() - 1, '09:00'), null,
   null, null, pg_temp.at(pg_temp.y() - 1, '09:00'), null, true),
  (pg_temp.fx('owner'), pg_temp.y(), 'pending_review', 'present', pg_temp.at(pg_temp.y(), '09:00'), null,
   null, null, pg_temp.at(pg_temp.y(), '09:00'), null, true),
  (pg_temp.fx('free1'), pg_temp.y(), 'pending_review', 'present', pg_temp.at(pg_temp.y(), '09:00'), null,
   null, null, pg_temp.at(pg_temp.y(), '09:00'), null, true),
  (pg_temp.fx('gone1'), pg_temp.y(), 'pending_review', 'present', pg_temp.at(pg_temp.y(), '09:00'), null,
   null, null, pg_temp.at(pg_temp.y(), '09:00'), null, true);

select is(pg_temp.unended(pg_temp.at(pg_temp.today(), '04:59')), '',
  'before the 05:00 cutoff nobody is counted: yesterday can still be ended');
select is(pg_temp.unended(pg_temp.at(pg_temp.today(), '05:00')), 'Admin1 Staff1',
  'from the cutoff: yesterday''s started days with no End day the Owner has not decided');
select is(pg_temp.unended(pg_temp.at(pg_temp.today(), '23:59')), 'Admin1 Staff1',
  'through the rest of today');
select is(pg_temp.unended(pg_temp.at(pg_temp.today() + 1, '05:00')), '',
  'not the day after: then it was the day before yesterday');
select is((select (u.state, u.submitted_choice, u.started, u.end_not_recorded, u.started_at = pg_temp.at(pg_temp.y(), '09:00'),
                   u.ended_at is null, u.day_id = pg_temp.day_of('staff1', pg_temp.y()))::text
           from app.attendance_unended_yesterday(pg_temp.fx('org'), pg_temp.at(pg_temp.today(), '05:00')) u
           where u.member_id = pg_temp.fx('staff1')),
  ('pending_review', 'present', true, true, true, true, true)::text,
  'each row carries yesterday''s day as it stands (its state, start, no end)');
select is((select count(*) from app.attendance_unended_yesterday(pg_temp.fx('org'), pg_temp.at(pg_temp.today(), '05:00'))
           where member_id = pg_temp.fx('owner')), 0::bigint,
  'never the Owner (no attendance of their own), though the fixture gives them a started day yesterday');
select is((select count(*) from app.attendance_unended_yesterday(pg_temp.fx('org'), pg_temp.at(pg_temp.today(), '05:00'))
           where member_id = pg_temp.fx('free1')), 0::bigint, 'never a freelancer (no attendance)');
select is((select count(*) from app.attendance_unended_yesterday(pg_temp.fx('org'), pg_temp.at(pg_temp.today(), '05:00'))
           where member_id = pg_temp.fx('gone1')), 0::bigint, 'never a deactivated member');

update public.org_settings set end_day_cutoff_time = '03:00' where org_id = pg_temp.fx('org');
select is(pg_temp.unended(pg_temp.at(pg_temp.today(), '02:59')), '', 'an Owner-set cutoff: not before 03:00');
select is(pg_temp.unended(pg_temp.at(pg_temp.today(), '03:00')), 'Admin1 Staff1', 'and from 03:00');
update public.org_settings set end_day_cutoff_time = '05:00' where org_id = pg_temp.fx('org');

-- The Owner reviews Staff1's day (approves it) and corrects Admin1's: both drop off.
select pg_temp.as_member('owner');
select lives_ok(format($$ select public.attendance_decide(%L::uuid, 'approve') $$, pg_temp.day_of('staff1', pg_temp.y())),
  'the Owner approves Staff1''s day');
select pg_temp.as_system();
select is(pg_temp.unended(pg_temp.at(pg_temp.today(), '05:00')), 'Admin1', 'a reviewed day drops off');
select pg_temp.as_member('owner');
select lives_ok(format($$ select public.attendance_decide(%L::uuid, 'correct', 'present', 'Worked late at the shoot') $$,
                       pg_temp.day_of('admin1', pg_temp.y())),
  'the Owner corrects Admin1''s day');
select pg_temp.as_system();
select is(pg_temp.unended(pg_temp.at(pg_temp.today(), '05:00')), '', 'a corrected day drops off');

-- The Owner's read, at now(): the same rows as the rule at now(); everyone else refused.
update public.attendance_days set state = 'pending_review', final_status = null, decided_at = null, decided_by = null,
  decision_reason = null
where member_id in (pg_temp.fx('staff1'), pg_temp.fx('admin1')) and work_date = pg_temp.y();
create temporary table expected_unended as
  select coalesce(string_agg(u.full_name, ' ' order by u.full_name), '') as names
  from app.attendance_unended_yesterday(pg_temp.fx('org'), now()) u;
grant all on expected_unended to authenticated;
select pg_temp.as_member('owner');
select is((select coalesce(string_agg(full_name, ' ' order by full_name), '') from public.attendance_end_not_recorded_yesterday()),
  (select names from expected_unended), 'the Owner (attendance.view_all) reads them');
select pg_temp.as_member('admin1');
select throws_ok($$ select * from public.attendance_end_not_recorded_yesterday() $$, 'P0001', 'FORBIDDEN', 'an Admin is refused');
select pg_temp.as_member('staff2');
select throws_ok($$ select * from public.attendance_end_not_recorded_yesterday() $$, 'P0001', 'FORBIDDEN', 'a Crew member is refused');
select pg_temp.as_anon();
select throws_ok($$ select * from public.attendance_end_not_recorded_yesterday() $$, '42501', null, 'a signed-out caller is refused');
select pg_temp.as_system();
select ok(has_function_privilege('authenticated', 'public.attendance_end_not_recorded_yesterday()', 'execute')
          and not has_function_privilege('anon', 'public.attendance_end_not_recorded_yesterday()', 'execute'),
  'the read is granted to signed-in members only (it checks attendance.view_all itself)');
select ok(not has_function_privilege('authenticated', 'app.attendance_unended_yesterday(uuid, timestamptz)', 'execute')
          and not has_function_privilege('anon', 'app.attendance_unended_yesterday(uuid, timestamptz)', 'execute'),
  'the rule itself is internal');

-- 2. The weekly digest: since the last one sent, at most seven days ---------------------------------
-- Every day of the last six weeks has a saved report with someone present (so no digest is zero).
insert into public.eod_reports (org_id, report_date, data, generated_at)
select pg_temp.fx('org'), d::date, '{"attendance": {"counts": {"present": 1}}}'::jsonb, pg_temp.at(d::date + 1, '05:00')
from generate_series(pg_temp.today() - 42, pg_temp.today() - 1, interval '1 day') d
on conflict do nothing;
create function pg_temp.base() returns date language sql stable as $$ select pg_temp.today() - 28; $$;
create function pg_temp.digest_on(d date) returns integer language sql as $$ select public.digest_weekly(pg_temp.at(d, '08:00')); $$;
create function pg_temp.last_week() returns jsonb language sql stable as $$
  select payload -> 'week' from public.notifications where kind = 'owner_digest_weekly' order by created_at desc limit 1;
$$;
create function pg_temp.week(f date, t date) returns jsonb language sql immutable as $$ select jsonb_build_object('from', f, 'to', t); $$;

update public.org_settings set weekly_digest_day = extract(dow from pg_temp.base())::int where org_id = pg_temp.fx('org');
select is(pg_temp.digest_on(pg_temp.base()), 1, 'the first digest goes on its day');
select is(pg_temp.last_week(), pg_temp.week(pg_temp.base() - 7, pg_temp.base() - 1), 'covering the seven days before it');

-- Moved two days later in the week: it goes on the first occurrence of the new day, two days on.
update public.org_settings set weekly_digest_day = extract(dow from pg_temp.base() + 2)::int where org_id = pg_temp.fx('org');
select is(pg_temp.digest_on(pg_temp.base() + 1), 0, 'moved later: nothing the day before the new day');
select is(pg_temp.digest_on(pg_temp.base() + 2), 1, 'moved later: it goes on the first occurrence of the new day (no week skipped)');
select is(pg_temp.last_week(), pg_temp.week(pg_temp.base(), pg_temp.base() + 1),
  'covering the days since the last digest (the two days between)');
select is((select title from public.notifications where kind = 'owner_digest_weekly' order by created_at desc limit 1),
  'Your week · ' || app.notify_span(pg_temp.base(), pg_temp.base() + 1), 'its title names those days');
select is(public.digest_weekly(pg_temp.at(pg_temp.base() + 2, '08:05')), 0, 'a re-fired tick that day sends nothing');
select is(pg_temp.digest_on(pg_temp.base() + 9), 1, 'a week later it goes again');
select is(pg_temp.last_week(), pg_temp.week(pg_temp.base() + 2, pg_temp.base() + 8), 'covering the seven days since');

-- Moved two days earlier in the week: the next occurrence is five days on; it goes then.
update public.org_settings set weekly_digest_day = extract(dow from pg_temp.base() + 14)::int where org_id = pg_temp.fx('org');
select is(pg_temp.digest_on(pg_temp.base() + 13), 0, 'moved earlier: nothing the day before the new day');
select is(pg_temp.digest_on(pg_temp.base() + 14), 1, 'moved earlier: it goes on the first occurrence of the new day (no week skipped)');
select is(pg_temp.last_week(), pg_temp.week(pg_temp.base() + 9, pg_temp.base() + 13),
  'covering the five days since the last digest');

-- A week with no digest (nothing sent on base + 21): the next covers seven days, never more.
select is(pg_temp.digest_on(pg_temp.base() + 28), 1, 'after a missed week the digest goes on its day');
select is(pg_temp.last_week(), pg_temp.week(pg_temp.base() + 21, pg_temp.base() + 27), 'capped at the seven days before it');
select is((select count(*) from jsonb_array_elements(
             (select payload -> 'days' from public.notifications where kind = 'owner_digest_weekly' order by created_at desc limit 1))),
  7::bigint, 'one entry per day covered');

-- The window as the builder sees it on a day the digest already went: the one it sent.
select is(app.digest_weekly_payload(pg_temp.fx('org'), pg_temp.at(pg_temp.base() + 28, '09:00')) -> 'week',
  pg_temp.week(pg_temp.base() + 21, pg_temp.base() + 27),
  'later the same day the builder still covers what that day''s digest covered (the preview agrees)');
select is((select count(*) from public.notifications where kind = 'owner_digest_weekly'), 5::bigint,
  'five digests in all: none skipped, none doubled');

select * from finish();
rollback;
