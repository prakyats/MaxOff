-- 3b.4 Month summary (PRODUCT §4.18, WORKFLOWS §2b, DATA-MODEL §7b): month_summary() per role
-- (the Owner allowed; an Admin, Staff and anon refused), who is in it (Admins and Staff who had
-- joined, not the Owner, not an invitee, not someone deactivated before the month), every line
-- on a month of arranged days (decided vs waiting, a day off worked, a comp half day that is
-- never additional leave, a 2.x gate day read like any other), overtime notes and grants, comp
-- credits granted / used / expired, one person alone, and the working days of the month.
begin;
create extension if not exists pgtap with schema extensions;
select plan(33);

-- Fixtures as 25: keep the organization, replace the people. Rolled back at the end.
delete from public.expense_claims;
delete from public.comp_leave_credit_uses;
delete from public.comp_leave_credits;
delete from public.extra_work_notes;
delete from public.attendance_events;
delete from public.attendance_days;
delete from public.leave_requests;
delete from public.session_events;
delete from public.activity_log;
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
-- 4A: task rows and coordinator rows reference members (a Playwright run leaves some behind).
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
delete from public.field_definitions;
delete from public.client_contacts;
delete from public.client_admin_assignments;
delete from public.client_brand;
delete from public.client_private;
delete from public.clients;
update public.organizations set logo_file_id = null;
delete from public.files;
delete from public.members;
delete from auth.identities;
delete from auth.users;
delete from public.activity_log;
delete from public.holidays;
-- February 2026 has four Sundays (1, 8, 15, 22): 24 working days with Sunday off.
update public.org_settings set weekly_off_days = '{0}';

create temporary table fx (key text primary key, id uuid not null);
insert into fx values
  ('owner',   '00000000-0000-4000-8000-000000000501'),
  ('admin',   '00000000-0000-4000-8000-000000000502'),
  ('staff',   '00000000-0000-4000-8000-000000000503'),
  ('staff2',  '00000000-0000-4000-8000-000000000504'),
  ('invited', '00000000-0000-4000-8000-000000000505'),
  ('gone',    '00000000-0000-4000-8000-000000000506'),
  ('late',    '00000000-0000-4000-8000-000000000507'),
  ('compreq', '00000000-0000-4000-8000-000000000511'),
  ('halfreq', '00000000-0000-4000-8000-000000000512');
insert into fx select 'org', id from public.organizations limit 1;
grant select on fx to authenticated, anon, service_role;

create function pg_temp.fx(k text) returns uuid language sql stable as $$
  select id from fx where key = k;
$$;

create function pg_temp.as_member(k text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', pg_temp.fx(k)::text, true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', pg_temp.fx(k), 'role', 'authenticated')::text, true);
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

insert into auth.users (id, email)
select id, key || '@example.com' from fx where key in ('owner', 'admin', 'staff', 'staff2', 'invited', 'gone', 'late');

insert into public.members (id, org_id, full_name, email, role, status, joined_at, deactivated_at)
select pg_temp.fx(k), pg_temp.fx('org'), name, k || '@example.com', r::public.member_role, st::public.member_status,
       joined::timestamptz, gone::timestamptz
from (values ('owner',   'Owner',   'owner', 'active',      '2025-12-01', null),
             ('admin',   'Admin',   'admin', 'active',      '2025-12-01', null),
             ('staff',   'Asha',    'staff', 'active',      '2025-12-01', null),
             ('staff2',  'Bina',    'staff', 'active',      '2025-12-01', null),
             ('invited', 'Invitee', 'staff', 'invited',     null,         null),
             ('gone',    'Gone',    'staff', 'deactivated', '2025-12-01', '2026-01-20'),
             ('late',    'Late',    'staff', 'active',      '2026-03-10', null)) as v(k, name, r, st, joined, gone);

-- Asha's February: every kind of day.
insert into public.leave_requests (id, member_id, type, start_date, end_date, state, source, decided_by, decided_at, credit_days)
values (pg_temp.fx('halfreq'), pg_temp.fx('staff'), 'half_day', '2026-02-06', '2026-02-06', 'approved', 'form', pg_temp.fx('owner'), now(), null),
       (pg_temp.fx('compreq'), pg_temp.fx('staff'), 'half_day', '2026-02-10', '2026-02-10', 'approved', 'form', pg_temp.fx('owner'), now(), 0.5);

insert into public.attendance_days (member_id, work_date, is_day_off, state, final_status, submitted_choice, decided_by, decided_at, leave_request_id, started_at)
select pg_temp.fx('staff'), d::date, off, st::public.attendance_state, fs::public.day_status,
       case when st = 'pending_review' then 'present'::public.attendance_choice end,
       case when st in ('approved', 'corrected') then pg_temp.fx('owner') end,
       case when st in ('approved', 'corrected') then now() end,
       case when k = 'half' then pg_temp.fx('halfreq') when k = 'comphalf' then pg_temp.fx('compreq') end,
       case when k = 'gate' then '2026-02-11 04:00:00+00'::timestamptz end
from (values ('2026-02-02', false, 'approved',        'present',    'p1'),
             ('2026-02-03', false, 'corrected',       'present',    'p2'),
             ('2026-02-04', false, 'pending_review',  null,         'wait'),
             ('2026-02-05', false, 'approved',        'leave',      'leave'),
             ('2026-02-06', false, 'approved',        'half_day',   'half'),
             ('2026-02-07', false, 'approved',        'absent',     'absent'),
             ('2026-02-08', true,  'corrected',       'present',    'offworked'),
             ('2026-02-09', false, 'approved',        'comp_leave', 'comp'),
             ('2026-02-10', false, 'approved',        'half_day',   'comphalf'),
             -- A day with a start (a backfilled 2.x sign-in), decided by the Owner: worked.
             ('2026-02-11', false, 'approved',        'present',    'gate'),
             ('2026-02-12', false, 'awaiting_choice', null,         'none'),
             -- March is not February.
             ('2026-03-02', false, 'approved',        'absent',     'march')) as v(d, off, st, fs, k);

-- Bina: one waiting day only.
insert into public.attendance_days (member_id, work_date, is_day_off, state, submitted_choice)
values (pg_temp.fx('staff2'), '2026-02-02', false, 'pending_review', 'present');

-- Overtime notes: two in February (one granted), one in March; a day-off note is not overtime.
insert into public.extra_work_notes (member_id, work_date, kind, note, state, decision, decided_by, decided_at)
values (pg_temp.fx('staff'), '2026-02-02', 'overtime', 'Late render', 'reviewed', 'granted', pg_temp.fx('owner'), now()),
       (pg_temp.fx('staff'), '2026-02-03', 'overtime', 'Late edit', 'reviewed', 'no_comp_leave', pg_temp.fx('owner'), now()),
       (pg_temp.fx('staff'), '2026-02-08', 'day_off', 'Shoot', 'submitted', null, null, null),
       (pg_temp.fx('staff'), '2026-03-03', 'overtime', 'March', 'submitted', null, null, null);

-- Comp credits granted in February (expired: February is over), one revoked, one in March.
insert into public.comp_leave_credits (member_id, days, used_days, granted_by, granted_on, expires_on)
values (pg_temp.fx('staff'), 1.0, 1.0, pg_temp.fx('owner'), '2026-02-02', '2026-02-28'),
       (pg_temp.fx('staff'), 1.0, 0.5, pg_temp.fx('owner'), '2026-02-03', '2026-02-28'),
       (pg_temp.fx('staff'), 0.5, 0,   pg_temp.fx('owner'), '2026-02-04', '2026-02-28'),
       (pg_temp.fx('staff'), 1.0, 0,   pg_temp.fx('owner'), '2026-03-02', '2026-03-31');
insert into public.comp_leave_credits (member_id, days, granted_by, granted_on, expires_on, revoked_at, revoked_by, revoke_reason)
values (pg_temp.fx('staff'), 1.0, pg_temp.fx('owner'), '2026-02-05', '2026-02-28', now(), pg_temp.fx('owner'), 'Given twice');


-- Who may read it --------------------------------------------------------------------------------
select pg_temp.as_member('admin');
select throws_ok($$ select * from public.month_summary('2026-02-01') $$, 'P0001', 'FORBIDDEN', 'an Admin never sees the month summary');
select pg_temp.as_member('staff');
select throws_ok($$ select * from public.month_summary('2026-02-01') $$, 'P0001', 'FORBIDDEN', 'nor does Staff, not even their own');
select pg_temp.as_anon();
select throws_ok($$ select * from public.month_summary('2026-02-01') $$, '42501', null, 'anon cannot call it');
select pg_temp.as_member('owner');
select throws_ok($$ select * from public.month_summary(null) $$, 'P0001', 'VALIDATION', 'a month is needed');
select lives_ok($$ select * from public.month_summary('2026-02-01') $$, 'the Owner reads it');

-- Who is in it -----------------------------------------------------------------------------------
select is((select array_agg(full_name order by full_name) from public.month_summary('2026-02-01')),
  array['Admin', 'Asha', 'Bina'], 'Admins and Staff who had joined; not the Owner, an invitee, the deactivated or the late joiner');
select is((select array_agg(full_name order by full_name) from public.month_summary('2026-01-01')),
  array['Admin', 'Asha', 'Bina', 'Gone'], 'someone deactivated in January is in January');
select is((select array_agg(full_name) from public.month_summary('2026-03-15')),
  array['Admin', 'Asha', 'Bina', 'Late'], 'a person who joined in March is in March');
select is((select count(*)::integer from public.month_summary('2026-02-01', pg_temp.fx('staff'))), 1, 'one person alone');
select is((select count(*)::integer from public.month_summary('2026-02-01', pg_temp.fx('owner'))), 0, 'the Owner has no summary');

-- The working days --------------------------------------------------------------------------------
select is((select working_days from public.month_summary('2026-02-10') where id = pg_temp.fx('staff')), 24,
  'February 2026 with Sunday off: 24 working days (any date picks its month)');
select pg_temp.as_system();
insert into public.holidays (org_id, date, name) values (pg_temp.fx('org'), '2026-02-16', 'A holiday');
select pg_temp.as_member('owner');
select is((select working_days from public.month_summary('2026-02-01') where id = pg_temp.fx('staff')), 23,
  'a holiday is not a working day');

-- Asha's lines ------------------------------------------------------------------------------------
create temporary table asha as select * from public.month_summary('2026-02-01', pg_temp.fx('staff'));
select is((select present_days from asha), 3, 'present: approved, corrected and the 2.x gate day; not the waiting day');
select is((select days_worked from asha), 4.0::numeric, 'days worked: 3 present + ½ per half day (the comp half day too)');
select is((select leave_days from asha), 1, 'one leave day');
select is((select half_days from asha), 1, 'one half day that is not comp leave');
select is((select absent_days from asha), 1, 'one absence (March''s is not February''s)');
select is((select comp_leave_days from asha), 1.5::numeric, 'comp leave used: a full day + a half day on a credit');
select is((select additional_leave from asha), 2.5::numeric, 'additional leave = 1 leave + ½ × 1 half day + 1 absent; comp leave never counts');
select is((select days_off_worked from asha), 1, 'the day off worked is its own line');
select is((select pending_days from asha), 1, 'one day waiting for review');
select is((select overtime_notes from asha), 2, 'two overtime notes in February (a day-off note is not overtime)');
select is((select overtime_granted from asha), 1, 'one earned comp leave');
select is((select credits_granted from asha), 2.5::numeric, 'credits granted: 1 + 1 + ½ (the revoked one and March''s left out)');
select is((select credits_used from asha), 1.5::numeric, 'credits used: 1 + ½');
select is((select credits_expired from asha), 1.0::numeric, 'credits expired: what was left when February ended');

-- A credit of this month is not expired yet
select pg_temp.as_system();
insert into public.comp_leave_credits (member_id, days, granted_by, granted_on, expires_on)
values (pg_temp.fx('staff'), 1.0, pg_temp.fx('owner'), app.today_ist(), app.ist_month_end(app.today_ist()));
select pg_temp.as_member('owner');
select is((select credits_granted from public.month_summary(app.today_ist(), pg_temp.fx('staff'))), 1.0::numeric,
  'this month''s credit is granted');
select is((select credits_expired from public.month_summary(app.today_ist(), pg_temp.fx('staff'))), 0::numeric,
  'and not expired while its month runs');

-- Bina and the Admin
create temporary table bina as select * from public.month_summary('2026-02-01', pg_temp.fx('staff2'));
select is((select row(days_worked, pending_days, additional_leave)::text from bina), row(0.0, 1, 0.0)::text,
  'a waiting day is never counted as worked');
select is((select row(days_worked, additional_leave, overtime_notes, credits_granted)::text
           from public.month_summary('2026-02-01', pg_temp.fx('admin'))),
  row(0.0, 0.0, 0, 0)::text, 'nothing recorded reads as zeros');

-- Read-only: nothing written
select pg_temp.as_system();
create temporary table audit_before as select count(*)::integer as n from public.activity_log;
grant select on audit_before to authenticated;
select pg_temp.as_member('owner');
select count(*) from public.month_summary('2026-02-01');
select pg_temp.as_system();
select is((select count(*)::integer from public.activity_log), (select n from audit_before), 'the summary writes nothing');
select ok(not has_function_privilege('anon', 'public.month_summary(date, uuid)', 'execute'), 'anon holds no execute');
select ok(has_function_privilege('authenticated', 'public.month_summary(date, uuid)', 'execute'), 'the API role calls it (the function decides)');

select * from finish();
rollback;
