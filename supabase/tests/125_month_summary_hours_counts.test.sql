-- v1.9 month counts per person (owner 2026-10-22 via the advisor, #89; migration month_summary_hours_counts):
-- month_summary_hours(month, member_id) per person on fixed dates (November 2026): late days and their
-- minutes (a late day outside the month is not counted), early leaves (approved, left unanswered or
-- corrected; a Stay, a lapsed and a waiting request are not), left early not answered (also when the Owner
-- approved or corrected it later), approved early leaves, and settled half days by half (a half day with no
-- half, and one still waiting, count in neither). One row per attendance-keeping member (never the Owner),
-- or the one asked for; zeros for someone with nothing. The Owner only: Admin and Crew FORBIDDEN, a
-- deactivated member UNAUTHENTICATED, anon no privilege, no month VALIDATION. Neutral names only.
begin;
create extension if not exists pgtap with schema extensions;
select plan(22);

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
  ('owner',  '00000000-0000-4000-8000-000000012501'),
  ('admin1', '00000000-0000-4000-8000-000000012502'),
  ('staff1', '00000000-0000-4000-8000-000000012503'),
  ('staff2', '00000000-0000-4000-8000-000000012504'),
  ('gone',   '00000000-0000-4000-8000-000000012505');
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
create function pg_temp.ist(t text) returns timestamptz language sql immutable as $$
  select (t::timestamp at time zone 'Asia/Kolkata');
$$;
-- A started day for staff1, late by `late` minutes (or not).
create function pg_temp.day(d date, late integer default null) returns uuid language sql as $$
  insert into public.attendance_days (member_id, work_date, state, submitted_choice, submitted_at, started_at, late_minutes)
  values (pg_temp.fx('staff1'), d, 'pending_review', 'present', pg_temp.ist(d || ' 10:00'), pg_temp.ist(d || ' 10:00'), late)
  returning id;
$$;
-- An early-leave request on staff1's day `d`.
create function pg_temp.req(d date, st text, left_it boolean default false) returns void language sql as $$
  insert into public.early_leave_requests (org_id, member_id, day_id, requested_at, reason, end_at, state, left_at,
                                          decided_by, decided_at)
  values (pg_temp.fx('org'), pg_temp.fx('staff1'), pg_temp.day(d), pg_temp.ist(d || ' 15:00'), 'A reason',
          pg_temp.ist(d || ' 18:00'), st, case when left_it then pg_temp.ist(d || ' 15:31') end,
          case when st in ('approved', 'stay', 'corrected') then pg_temp.fx('owner') end,
          case when st in ('approved', 'stay', 'corrected') then now() end);
$$;
-- A half day for staff1 on `d`: its leave (with the half) and the day in `state`.
create function pg_temp.half(d date, h text, st public.attendance_state) returns void language plpgsql as $$
declare
  v_leave uuid;
begin
  insert into public.leave_requests (member_id, type, start_date, end_date, state, source, decided_by, decided_at, half)
  values (pg_temp.fx('staff1'), 'half_day', d, d, case when st = 'pending_review' then 'submitted' else 'approved' end::public.leave_state,
          'form', case when st = 'pending_review' then null else pg_temp.fx('owner') end,
          case when st = 'pending_review' then null else now() end, h)
  returning id into v_leave;
  insert into public.attendance_days (member_id, work_date, state, submitted_choice, submitted_at, final_status,
                                      decided_by, decided_at, leave_request_id)
  values (pg_temp.fx('staff1'), d, st, 'half_day', now(),
          case when st = 'pending_review' then null else 'half_day'::public.day_status end,
          case when st = 'pending_review' then null else pg_temp.fx('owner') end,
          case when st = 'pending_review' then null else now() end, v_leave);
end;
$$;
create function pg_temp.row_of(k text) returns text language sql stable as $$
  select row(r.late_days, r.late_minutes, r.early_leaves, r.left_unanswered, r.early_leaves_approved,
             r.half_days_morning, r.half_days_afternoon)::text
  from public.month_summary_hours('2026-11-01') r where r.id = pg_temp.fx(k);
$$;

insert into auth.users (id, email) select id, key || '-125@example.com' from fx where key <> 'org';
insert into public.members (id, org_id, full_name, email, role, status, joined_at, deactivated_at)
select pg_temp.fx(k), pg_temp.fx('org'), initcap(k), k || '-125@example.com', r::public.member_role, s::public.member_status,
       pg_temp.ist('2026-09-01 09:00'), case when s = 'deactivated' then pg_temp.ist('2026-11-20 18:00') end
from (values ('owner', 'owner', 'active'), ('admin1', 'admin', 'active'), ('staff1', 'staff', 'active'),
             ('staff2', 'staff', 'active'), ('gone', 'staff', 'deactivated')) as v(k, r, s);

-- staff1's November 2026 (and one late day in October, outside it).
select pg_temp.day('2026-10-30', 50);
select pg_temp.day('2026-11-02', 25);
select pg_temp.day('2026-11-03', 40);
select pg_temp.day('2026-11-04');
select pg_temp.req('2026-11-05', 'approved');
select pg_temp.req('2026-11-06', 'left_unanswered', true);
select pg_temp.req('2026-11-07', 'approved', true);
select pg_temp.req('2026-11-09', 'corrected', true);
select pg_temp.req('2026-11-10', 'stay');
select pg_temp.req('2026-11-11', 'lapsed');
select pg_temp.req('2026-11-12', 'waiting');
select pg_temp.half('2026-11-13', 'morning', 'approved');
select pg_temp.half('2026-11-16', 'afternoon', 'corrected');
select pg_temp.half('2026-11-17', null, 'approved');
select pg_temp.half('2026-11-18', 'morning', 'pending_review');

-- The Owner reads every count.
select pg_temp.as_member('owner');
select is((select r.late_days from public.month_summary_hours('2026-11-01') r where r.id = pg_temp.fx('staff1')), 2,
  'late days: the two late days of the month (not October''s, not an on-time day)');
select is((select r.late_minutes from public.month_summary_hours('2026-11-01') r where r.id = pg_temp.fx('staff1')), 65,
  'late minutes: their total (25 + 40)');
select is((select r.early_leaves from public.month_summary_hours('2026-11-01') r where r.id = pg_temp.fx('staff1')), 4,
  'early leaves: approved, left unanswered and corrected (not Stay, lapsed or waiting)');
select is((select r.left_unanswered from public.month_summary_hours('2026-11-01') r where r.id = pg_temp.fx('staff1')), 3,
  'left early, not answered: every request they ended unanswered, whatever the Owner decided later');
select is((select r.early_leaves_approved from public.month_summary_hours('2026-11-01') r where r.id = pg_temp.fx('staff1')), 2,
  'approved early leaves: the approved ones (at the ask, or after they left)');
select is((select r.half_days_morning from public.month_summary_hours('2026-11-01') r where r.id = pg_temp.fx('staff1')), 1,
  'morning half days: settled ones only (a waiting one is not counted)');
select is((select r.half_days_afternoon from public.month_summary_hours('2026-11-01') r where r.id = pg_temp.fx('staff1')), 1,
  'afternoon half days: an Owner-corrected one counts');
select is(pg_temp.row_of('staff2'), row(0, 0, 0, 0, 0, 0, 0)::text, 'someone with nothing reads zeros');
select is((select r.late_days from public.month_summary_hours('2026-10-01') r where r.id = pg_temp.fx('staff1')), 1,
  'October has its own late day');
select is((select count(*) from public.month_summary_hours('2026-11-01')), 4::bigint,
  'one row per member who keeps attendance (the deactivated one in the month included), never the Owner');
select ok(not exists (select 1 from public.month_summary_hours('2026-11-01') r where r.id = pg_temp.fx('owner')), 'the Owner has no row');
select is((select count(*) from public.month_summary_hours('2026-11-01', pg_temp.fx('staff1'))), 1::bigint,
  'a member_id reads that one person');
select is((select r.half_days_morning from public.month_summary_hours('2026-11-15') r where r.id = pg_temp.fx('staff1')), 1,
  'any day of the month reads the whole month');
select throws_ok($$ select * from public.month_summary_hours(null) $$, 'P0001', 'VALIDATION', 'a month is needed');

-- Nobody else.
select pg_temp.as_member('admin1');
select throws_ok($$ select * from public.month_summary_hours('2026-11-01') $$, 'P0001', 'FORBIDDEN', 'an Admin cannot read the counts');
select throws_ok(format($$ select * from public.month_summary_hours('2026-11-01', %L) $$, pg_temp.fx('admin1')), 'P0001', 'FORBIDDEN',
  'not even their own');
select pg_temp.as_member('staff1');
select throws_ok($$ select * from public.month_summary_hours('2026-11-01') $$, 'P0001', 'FORBIDDEN', 'a Crew member cannot');
select throws_ok(format($$ select * from public.month_summary_hours('2026-11-01', %L) $$, pg_temp.fx('staff1')), 'P0001', 'FORBIDDEN',
  'not even their own');
select pg_temp.as_member('gone');
select throws_ok($$ select * from public.month_summary_hours('2026-11-01') $$, 'P0001', 'UNAUTHENTICATED', 'a deactivated member cannot');
select pg_temp.as_anon();
select throws_ok($$ select * from public.month_summary_hours('2026-11-01') $$, '42501', null, 'anon has no privilege');
select pg_temp.as_system();
select ok(has_function_privilege('authenticated', 'public.month_summary_hours(date, uuid)', 'execute')
          and not has_function_privilege('anon', 'public.month_summary_hours(date, uuid)', 'execute'),
  'execute: authenticated (the function checks the key), never anon');
select is((select count(*) from pg_proc where proname = 'month_summary_hours' and pronamespace = 'public'::regnamespace), 1::bigint,
  'one signature');

select * from finish();
rollback;
