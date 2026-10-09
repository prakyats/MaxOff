-- 4A (4.1) Freelancers (ADR-0013; WORKFLOWS §1b, PERMISSIONS §3, DATA-MODEL §1; kickoff 4
-- decisions 1, 7, 8; kickoff 3b decisions 20, 27): the engagement enum and column, the email
-- check, the dropped FK, member_coordinators (RLS per role, no API writes, audit),
-- app.coordinator_of, member_add_freelancer on every path, member_set_coordinator on every path,
-- the deactivate / reactivate rules (a coordinator with freelancers, a freelancer's row closed and
-- required again), member_invite and member_change_email refusing a freelancer,
-- member_invite_employee on every path and the acceptance after it, the permanent-only guards
-- (every member-side attendance / leave / extra work / expense function, comp_leave_grant,
-- absent_check, end_day_reminder_due, attendance_today_detail, month_summary), the directory
-- (engagement, a coordinator's freelancers), the audit trigger's on_behalf_of and the
-- workload_warning_threshold default.
begin;
create extension if not exists pgtap with schema extensions;
select plan(121);

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
-- Fixtures as 24: keep the organization, replace the people. Rolled back at the end.
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
delete from public.clients;
update public.organizations set logo_file_id = null;
delete from public.files;
delete from public.members;
delete from auth.identities;
delete from auth.users;
delete from public.activity_log;
delete from public.holidays;
update public.org_settings set weekly_off_days = '{}';

create temporary table fx (key text primary key, id uuid not null);
insert into fx values
  ('owner',       '00000000-0000-4000-8000-000000000401'),
  ('admin',       '00000000-0000-4000-8000-000000000402'),
  ('staff',       '00000000-0000-4000-8000-000000000403'),
  ('staff2',      '00000000-0000-4000-8000-000000000404'),
  ('deactivated', '00000000-0000-4000-8000-000000000405'),
  ('invited',     '00000000-0000-4000-8000-000000000406');
insert into fx select 'org', id from public.organizations limit 1;
grant all on fx to authenticated, anon, service_role;

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

create function pg_temp.as_system() returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', '', true);
end;
$$;

create function pg_temp.audit_actions(tbl text, row_id uuid) returns text[] language sql stable as $$
  select coalesce(array_agg(a.action order by a.id), '{}')
  from public.activity_log a where a.entity = tbl and a.entity_id = row_id;
$$;

create function pg_temp.current_coordinator(k text) returns uuid language sql stable as $$
  select mc.coordinator_id from public.member_coordinators mc
  where mc.member_id = pg_temp.fx(k) and mc.to_at is null;
$$;

insert into auth.users (id, email)
select id, key || '@example.com' from fx where key <> 'org';

insert into public.members (id, org_id, full_name, email, role, status, joined_at)
select pg_temp.fx(k), pg_temp.fx('org'), k, k || '@example.com', r::public.member_role, 'active', now() - interval '30 days'
from (values ('owner', 'owner'), ('admin', 'admin'), ('staff', 'staff'), ('staff2', 'staff')) as v(k, r);
insert into public.members (id, org_id, full_name, email, role, status, joined_at, deactivated_at) values
  (pg_temp.fx('deactivated'), pg_temp.fx('org'), 'Gone Staff', 'deactivated@example.com', 'staff', 'deactivated', now() - interval '30 days', now()),
  (pg_temp.fx('invited'),     pg_temp.fx('org'), 'New Admin',  'invited@example.com',     'admin', 'invited',     null, null);

-- Schema ---------------------------------------------------------------------------------------
select has_type('public', 'engagement', 'the engagement enum exists');
select enum_has_labels('public', 'engagement', array['permanent', 'freelance'], 'permanent | freelance');
select has_column('public', 'members', 'engagement', 'members.engagement exists');
select col_default_is('public', 'members', 'engagement', 'permanent', 'engagement defaults to permanent (expand-only)');
select col_is_null('public', 'members', 'email', 'members.email is nullable (a freelancer has none)');
select is((select count(*) from pg_constraint where conname = 'members_id_fkey'), 0::bigint,
  'the FK members.id -> auth.users is gone (a freelancer has no auth row)');
select throws_ok(
  $$ insert into public.members (id, org_id, full_name, email, role, status, joined_at)
     values (gen_random_uuid(), pg_temp.fx('org'), 'No Email', null, 'staff', 'active', now()) $$,
  '23514', null, 'a permanent member must have an email (check)');
select throws_ok(
  $$ insert into public.members (id, org_id, full_name, email, role, status, engagement, joined_at)
     values (gen_random_uuid(), pg_temp.fx('org'), 'With Email', 'f@example.com', 'staff', 'active', 'freelance', now()) $$,
  '23514', null, 'a freelancer must not have an email (check)');
select has_table('public', 'member_coordinators', 'member_coordinators exists');
select has_function('app', 'coordinator_of', array['uuid'], 'app.coordinator_of(uuid) exists');
select has_function('public', 'member_add_freelancer', array['text', 'uuid', 'text', 'uuid'], 'member_add_freelancer exists');
select has_function('public', 'member_set_coordinator', array['uuid', 'uuid', 'text'], 'member_set_coordinator exists');
select has_function('public', 'member_invite_employee', array['uuid', 'text'], 'member_invite_employee exists');
select has_column('public', 'activity_log', 'on_behalf_of_id', 'activity_log.on_behalf_of_id exists');
select col_default_is('public', 'org_settings', 'workload_warning_threshold', '4', 'workload_warning_threshold defaults to 4 (kickoff 4)');
select is((select workload_warning_threshold from public.org_settings where org_id = pg_temp.fx('org')), 4,
  'the existing organization was set to 4');
select has_column('public', 'member_directory', 'engagement', 'member_directory carries engagement');
select ok(not has_table_privilege('anon', 'public.member_coordinators', 'select'), 'anon reads no coordinator row');
select ok(not has_table_privilege('authenticated', 'public.member_coordinators', 'insert')
  and not has_table_privilege('authenticated', 'public.member_coordinators', 'update')
  and not has_table_privilege('authenticated', 'public.member_coordinators', 'delete'),
  'member_coordinators has no API writes');
select ok(not has_column_privilege('authenticated', 'public.members', 'engagement', 'update'),
  'engagement is not in the members UPDATE grant');

-- member_add_freelancer ---------------------------------------------------------------------------
select pg_temp.as_member('admin');
select throws_ok($$ select public.member_add_freelancer('Asha', null, null, pg_temp.fx('staff')) $$,
  'P0001', 'FORBIDDEN', 'an Admin cannot add a freelancer');
select pg_temp.as_member('staff');
select throws_ok($$ select public.member_add_freelancer('Asha', null, null, pg_temp.fx('staff2')) $$,
  'P0001', 'FORBIDDEN', 'Staff cannot add a freelancer');

select pg_temp.as_member('owner');
select throws_ok($$ select public.member_add_freelancer('   ', null, null, pg_temp.fx('staff')) $$,
  'P0001', 'VALIDATION', 'a name is required');
select throws_ok($$ select public.member_add_freelancer('Asha', null, null, null) $$,
  'P0001', 'VALIDATION', 'a coordinator is required');
select throws_ok($$ select public.member_add_freelancer('Asha', null, null, pg_temp.fx('owner')) $$,
  'P0001', 'VALIDATION', 'the Owner is never a coordinator (kickoff 4 decision 8)');
select throws_ok($$ select public.member_add_freelancer('Asha', null, null, pg_temp.fx('deactivated')) $$,
  'P0001', 'VALIDATION', 'a deactivated member cannot coordinate');
select throws_ok($$ select public.member_add_freelancer('Asha', null, null, pg_temp.fx('invited')) $$,
  'P0001', 'VALIDATION', 'an invited member cannot coordinate');
select throws_ok($$ select public.member_add_freelancer('Asha', null, null, gen_random_uuid()) $$,
  'P0001', 'NOT_FOUND', 'an unknown coordinator');
select throws_ok($$ select public.member_add_freelancer('Asha', gen_random_uuid(), null, pg_temp.fx('staff')) $$,
  'P0001', 'VALIDATION', 'the job title must be from the list');
select throws_ok($$ select public.member_add_freelancer('Asha', null, '12', pg_temp.fx('staff')) $$,
  'P0001', 'VALIDATION', 'a phone is 3 to 32 characters');

insert into fx values ('asha', public.member_add_freelancer(' Asha Freelance ', null, ' 9000000009 ', pg_temp.fx('staff')));
select results_eq(
  $$ select m.full_name, m.email, m.phone, m.role::text, m.status::text, m.engagement::text, m.joined_at is not null
     from public.members m where m.id = pg_temp.fx('asha') $$,
  $$ values ('Asha Freelance', null::text, '9000000009', 'staff', 'active', 'freelance', true) $$,
  'the freelancer row: trimmed name, no email, role staff, active, freelance, joined now');
select pg_temp.as_system();
select is((select count(*) from auth.users u where u.id = pg_temp.fx('asha')), 0::bigint, 'and no auth user');
select pg_temp.as_member('owner');
select is(pg_temp.current_coordinator('asha'), pg_temp.fx('staff'), 'the first coordinator row is current');
select is((select mc.set_by from public.member_coordinators mc where mc.member_id = pg_temp.fx('asha')), pg_temp.fx('owner'),
  'set_by = the Owner');
select is(app.coordinator_of(pg_temp.fx('asha')), pg_temp.fx('staff'), 'app.coordinator_of answers the current coordinator');
select is(app.coordinator_of(pg_temp.fx('staff')), null, 'an employee has none');
select is(pg_temp.audit_actions('members', pg_temp.fx('asha')), array['freelancer_added'], 'audit: freelancer_added');
select is((select array_agg(a.action order by a.id) from public.activity_log a where a.entity = 'member_coordinators'),
  array['coordinator_set'], 'audit: coordinator_set');
select throws_ok($$ select public.member_add_freelancer('Bimal', null, null, pg_temp.fx('asha')) $$,
  'P0001', 'VALIDATION', 'a freelancer cannot coordinate');
select throws_ok(
  $$ insert into public.members (id, org_id, full_name, email, role, status, engagement)
     values (gen_random_uuid(), pg_temp.fx('org'), 'Direct', null, 'staff', 'invited', 'freelance') $$,
  'P0001', 'FORBIDDEN', 'the Owner cannot insert a freelancer through the API (Add person is the door)');
select throws_ok(format($$ update public.members set engagement = 'permanent' where id = %L $$, pg_temp.fx('asha')),
  '42501', null, 'engagement is not editable through the API');

-- member_coordinators RLS -------------------------------------------------------------------------
select is((select count(*) from public.member_coordinators), 1::bigint, 'the Owner reads the coordinator row');
select pg_temp.as_member('admin');
select is((select count(*) from public.member_coordinators), 1::bigint, 'an Admin (team.view) reads it');
select pg_temp.as_member('staff');
select is((select count(*) from public.coordinated_freelancers), 1::bigint,
  'the coordinator reads their own freelancer''s row through coordinated_freelancers (4A review S4)');
select is((select count(*) from public.member_coordinators) + (select count(*) from public.activity_log a where a.entity = 'member_coordinators'),
  0::bigint, 'but not the table nor its activity entry, which carry the reason (team.view only, S4)');
select pg_temp.as_member('staff2');
select is((select count(*) from public.coordinated_freelancers), 0::bigint, 'another Staff member reads none');
select is((select count(*) from public.activity_log a where a.entity = 'member_coordinators'), 0::bigint,
  'nor its activity entry');

-- member_set_coordinator --------------------------------------------------------------------------
select pg_temp.as_member('admin');
select throws_ok($$ select public.member_set_coordinator(pg_temp.fx('asha'), pg_temp.fx('staff2'), null) $$,
  'P0001', 'FORBIDDEN', 'an Admin cannot change a coordinator');
select pg_temp.as_member('owner');
select throws_ok($$ select public.member_set_coordinator(pg_temp.fx('asha'), pg_temp.fx('staff'), null) $$,
  'P0001', 'INVALID_STATE', 'the same coordinator again is INVALID_STATE');
select throws_ok($$ select public.member_set_coordinator(pg_temp.fx('staff2'), pg_temp.fx('staff'), null) $$,
  'P0001', 'VALIDATION', 'a permanent member has no coordinator');
select throws_ok($$ select public.member_set_coordinator(pg_temp.fx('asha'), pg_temp.fx('owner'), null) $$,
  'P0001', 'VALIDATION', 'never the Owner');
select throws_ok($$ select public.member_set_coordinator(pg_temp.fx('asha'), pg_temp.fx('asha'), null) $$,
  'P0001', 'VALIDATION', 'never themselves');
select throws_ok($$ select public.member_set_coordinator(pg_temp.fx('asha'), pg_temp.fx('deactivated'), null) $$,
  'P0001', 'VALIDATION', 'never a deactivated member');
select throws_ok($$ select public.member_set_coordinator(gen_random_uuid(), pg_temp.fx('staff2'), null) $$,
  'P0001', 'NOT_FOUND', 'an unknown member');
select throws_ok(format($$ select public.member_set_coordinator(pg_temp.fx('asha'), pg_temp.fx('staff2'), %L) $$, repeat('x', 1001)),
  'P0001', 'VALIDATION', 'a reason over 1000 characters');
select lives_ok($$ select public.member_set_coordinator(pg_temp.fx('asha'), pg_temp.fx('staff2'), 'Ravi is on the shoot') $$,
  'the Owner changes the coordinator');
select is(pg_temp.current_coordinator('asha'), pg_temp.fx('staff2'), 'staff2 is current now');
select is(app.coordinator_of(pg_temp.fx('asha')), pg_temp.fx('staff2'), 'app.coordinator_of follows');
select results_eq(
  $$ select mc.coordinator_id, mc.to_at is null, mc.reason from public.member_coordinators mc
     where mc.member_id = pg_temp.fx('asha') order by mc.to_at is null, mc.from_at $$,
  $$ values (pg_temp.fx('staff'), false, null::text), (pg_temp.fx('staff2'), true, 'Ravi is on the shoot') $$,
  'the history: the old row closed, the new one open with its reason');
select is((select array_agg(a.action order by a.id) from public.activity_log a where a.entity = 'member_coordinators'),
  array['coordinator_set', 'coordinator_closed', 'coordinator_changed'], 'audit: closed then changed');
select pg_temp.as_member('staff');
select is((select count(*) from public.coordinated_freelancers f where f.to_at is not null), 1::bigint,
  'the former coordinator still reads their closed row (history, without the reason)');
select pg_temp.as_member('staff2');
select is((select count(*) from public.coordinated_freelancers f where f.to_at is null), 1::bigint, 'the new coordinator reads the current one');

-- Deactivate and reactivate (WORKFLOWS §1b) -------------------------------------------------------
select pg_temp.as_member('owner');
select throws_ok($$ select public.member_deactivate(pg_temp.fx('staff2'), 'leaving') $$,
  'P0001', 'CONFLICT', 'a coordinator with an active freelancer cannot be deactivated');
select is(public.member_deactivate(pg_temp.fx('staff'), null), 'deactivated', 'the former coordinator can be');
select is(public.member_reactivate(pg_temp.fx('staff')), 'active', '(and is put back)');
select is(public.member_deactivate(pg_temp.fx('asha'), 'contract ended'), 'deactivated', 'the Owner deactivates the freelancer');
select is(pg_temp.current_coordinator('asha'), null, 'her coordinator row was closed with her');
select is(app.coordinator_of(pg_temp.fx('asha')), null, 'so she has no current coordinator');
select is((select count(*) from public.activity_log a where a.entity = 'member_coordinators' and a.action = 'coordinator_closed'), 2::bigint,
  'audit: coordinator_closed (reason deactivated)');
select throws_ok($$ select public.member_reactivate(pg_temp.fx('asha')) $$,
  'P0001', 'INVALID_STATE', 'reactivating her needs a coordinator first');
select lives_ok($$ select public.member_set_coordinator(pg_temp.fx('asha'), pg_temp.fx('staff'), 'back for the season') $$,
  'a coordinator can be set on a deactivated freelancer');
select is(public.member_reactivate(pg_temp.fx('asha')), 'active', 'then she is reactivated');
select is(pg_temp.current_coordinator('asha'), pg_temp.fx('staff'), 'with staff as her coordinator');
select is(public.member_deactivate(pg_temp.fx('staff2'), null), 'deactivated', 'staff2, with no freelancer left, can be deactivated');
select is(public.member_reactivate(pg_temp.fx('staff2')), 'active', '(and is put back)');

-- member_invite and member_change_email refuse a freelancer ----------------------------------------
select pg_temp.as_system();
insert into auth.users (id, email) values (pg_temp.fx('asha'), 'asha@example.com');
select pg_temp.as_member('owner');
select throws_ok($$ select public.member_invite(pg_temp.fx('asha'), 'asha@example.com', 'Asha', 'staff', null) $$,
  'P0001', 'CONFLICT', 'member_invite refuses a freelancer''s id (Invite as employee is the door)');
select throws_ok($$ select public.member_change_email(pg_temp.fx('asha'), 'asha@example.com') $$,
  'P0001', 'INVALID_STATE', 'member_change_email refuses a freelancer (no sign-in)');

-- member_invite_employee (kickoff 4 decision 7) ---------------------------------------------------
insert into fx values ('bimal', public.member_add_freelancer('Bimal', null, null, pg_temp.fx('staff')));
select is(public.member_deactivate(pg_temp.fx('bimal'), null), 'deactivated', 'a second freelancer, deactivated');
select pg_temp.as_member('admin');
select throws_ok($$ select public.member_invite_employee(pg_temp.fx('asha'), 'asha@example.com') $$,
  'P0001', 'FORBIDDEN', 'an Admin cannot invite a freelancer as an employee');
select pg_temp.as_member('owner');
select throws_ok($$ select public.member_invite_employee(pg_temp.fx('staff'), 'new@example.com') $$,
  'P0001', 'INVALID_STATE', 'a permanent member is already an employee');
select throws_ok($$ select public.member_invite_employee(pg_temp.fx('bimal'), 'bimal@example.com') $$,
  'P0001', 'INVALID_STATE', 'a deactivated freelancer is reactivated first');
select throws_ok($$ select public.member_invite_employee(pg_temp.fx('asha'), 'not-an-email') $$,
  'P0001', 'VALIDATION', 'a valid email is required');
select throws_ok($$ select public.member_invite_employee(pg_temp.fx('asha'), 'staff@example.com') $$,
  'P0001', 'CONFLICT', 'an address another member signs in with');
select throws_ok($$ select public.member_invite_employee(pg_temp.fx('asha'), 'other@example.com') $$,
  'P0001', 'VALIDATION', 'the email must match the sign-in created under her id');
select lives_ok($$ select public.member_set_coordinator(pg_temp.fx('bimal'), pg_temp.fx('staff'), null) $$, 'bimal gets a coordinator');
select is(public.member_reactivate(pg_temp.fx('bimal')), 'active', 'and is reactivated');
select throws_ok($$ select public.member_invite_employee(pg_temp.fx('bimal'), 'bimal@example.com') $$,
  'P0001', 'NOT_FOUND', 'without an auth user under his id there is no sign-in to attach');
select is(public.member_invite_employee(pg_temp.fx('asha'), ' Asha@Example.com '), pg_temp.fx('asha'),
  'the Owner invites Asha as an employee: the same id');
select results_eq(
  $$ select m.engagement::text, m.email, m.status::text, m.joined_at is null, m.invited_at > now() - interval '1 minute'
     from public.members m where m.id = pg_temp.fx('asha') $$,
  $$ values ('permanent', 'asha@example.com', 'invited', true, true) $$,
  'permanent, the email lower-cased, invited, joined_at cleared, invited_at now');
select is(pg_temp.current_coordinator('asha'), null, 'her coordinator row is closed (became_employee)');
select is((select a.meta ->> 'reason' from public.activity_log a
           where a.entity = 'member_coordinators' and a.action = 'coordinator_closed' order by a.id desc limit 1),
  'became_employee', 'audit: coordinator_closed with reason became_employee');
select is(pg_temp.audit_actions('members', pg_temp.fx('asha')),
  array['freelancer_added', 'deactivated', 'reactivated', 'invited_as_employee'], 'audit on her row: invited_as_employee');
select throws_ok($$ select public.member_invite_employee(pg_temp.fx('asha'), 'asha@example.com') $$,
  'P0001', 'INVALID_STATE', 'twice: she is an employee now');
select pg_temp.as_member('asha');
select is(public.member_accept_invite(), pg_temp.fx('asha'), 'she accepts the invite');
select results_eq(
  $$ select m.status::text, app.to_ist_date(m.joined_at) from public.members m where m.id = pg_temp.fx('asha') $$,
  $$ values ('active', app.today_ist()) $$,
  'active with joined_at today: attendance starts tomorrow, as for any joiner');
select is((select attendance_started from public.attendance_own_today()), false,
  'as an employee she reads her own day (not started: the joining day)');

-- The permanent-only guards (ADR-0013 §5, PERMISSIONS §3) -----------------------------------------
select pg_temp.as_member('owner');
insert into fx values ('chitra', public.member_add_freelancer('Chitra', null, null, pg_temp.fx('staff')));
select pg_temp.as_system();
-- Backdated so "attendance has started" would hold if engagement were ignored.
update public.members set joined_at = now() - interval '30 days' where id = pg_temp.fx('chitra');
-- A sign-in on a freelancer's id is nobody since the phase 4 review (S-S3: app.current_member() and
-- app.has_permission() resolve permanent members only), so each of these is refused before its own
-- permanent-only check (app.attendance_require_self's FORBIDDEN) is reached.
select pg_temp.as_member('chitra');
select throws_ok($$ select public.attendance_start_day() $$, 'P0001', 'UNAUTHENTICATED', 'a freelancer cannot start a day');
select throws_ok($$ select * from public.attendance_own_today() $$, 'P0001', 'UNAUTHENTICATED', 'nor read one');
select throws_ok($$ select public.attendance_choose_leave_today('leave', null) $$, 'P0001', 'UNAUTHENTICATED', 'nor choose leave at the prompt');
select throws_ok($$ select * from public.attendance_end_day() $$, 'P0001', 'UNAUTHENTICATED', 'nor end a day');
select throws_ok($$ select public.attendance_submit('present', null, app.today_ist()) $$, 'P0001', 'UNAUTHENTICATED', 'nor submit attendance');
select throws_ok($$ select public.leave_submit('leave', app.today_ist() + 1, app.today_ist() + 1, null) $$, 'P0001', 'UNAUTHENTICATED', 'nor request leave');
select throws_ok($$ select public.leave_submit_comp(app.today_ist() + 1, false, null) $$, 'P0001', 'UNAUTHENTICATED', 'nor comp leave');
select throws_ok($$ select public.extra_work_note_submit('overtime', app.today_ist(), 'late', 60) $$, 'P0001', 'UNAUTHENTICATED', 'nor an extra work note');
select throws_ok($$ select public.expense_claim_submit(app.today_ist(), 100, (select id from public.list_items where list_key = 'expense_category' limit 1), 'taxi') $$,
  'P0001', 'UNAUTHENTICATED', 'nor an expense claim (kickoff 3b decision 27)');
select pg_temp.as_member('owner');
select throws_ok($$ select public.comp_leave_grant(pg_temp.fx('chitra'), 1.0, null, null) $$,
  'P0001', 'NOT_FOUND', 'comp leave is never granted to a freelancer');
select is((select count(*) from public.attendance_today_detail() d where d.member_id = pg_temp.fx('chitra')), 0::bigint,
  'the Owner''s board never lists her');
select is((select count(*) from public.attendance_today_detail() d where d.member_id = pg_temp.fx('staff')), 1::bigint,
  '(while an employee is on it)');
select is((select count(*) from public.month_summary(app.today_ist(), null) s where s.id = pg_temp.fx('chitra')), 0::bigint,
  'the month summary leaves her out (kickoff 3b decision 20)');
select is((select count(*) from public.month_summary(app.today_ist(), null) s where s.id = pg_temp.fx('staff')), 1::bigint,
  '(while an employee is in it)');
select pg_temp.as_system();
select is((select count(*) from app.absent_check(app.today_ist() - 1) r where r.member_id = pg_temp.fx('chitra')), 0::bigint,
  'the absent check writes nothing for her');
select is((select count(*) from public.attendance_days d where d.member_id = pg_temp.fx('chitra')), 0::bigint, '(no day row at all)');
select is((select count(*) from public.attendance_days d where d.member_id = pg_temp.fx('staff') and d.work_date = app.today_ist() - 1), 1::bigint,
  '(while the employee got a proposed absence)');
insert into public.attendance_days (member_id, work_date, state, submitted_choice, submitted_at, started_at)
values (pg_temp.fx('chitra'), app.today_ist(), 'pending_review', 'present', now(), now());
select is((select count(*) from app.end_day_reminder_due(now()) r where r.member_id = pg_temp.fx('chitra')), 0::bigint,
  'the 20:30 reminder skips a freelance row even if one existed');

-- The directory (PERMISSIONS §2) ------------------------------------------------------------------
select pg_temp.as_member('staff');
select is((select d.engagement::text from public.member_directory d where d.id = pg_temp.fx('chitra')), 'freelance',
  'a coordinator sees their freelancer in the directory, marked freelance');
select pg_temp.as_member('staff2');
select is((select count(*) from public.member_directory d where d.id = pg_temp.fx('chitra')), 0::bigint,
  'another Staff member does not see her');
select is((select count(*) from public.member_directory), 1::bigint, '(only their own row)');
select pg_temp.as_member('admin');
select is((select count(*) from public.member_directory d where d.id = pg_temp.fx('chitra')), 1::bigint,
  'an Admin (team.view) sees everyone, her included');

-- The audit trigger's on_behalf_of (ADR-0013 §3) --------------------------------------------------
select pg_temp.as_system();
select ok(set_config('app.audit_override', jsonb_build_object('action', 'probe', 'on_behalf_of', pg_temp.fx('chitra'))::text, true) is not null,
  'the override carries on_behalf_of');
update public.members set phone = '9000000010' where id = pg_temp.fx('staff');
select is((select a.on_behalf_of_id from public.activity_log a where a.entity = 'members' and a.action = 'probe'), pg_temp.fx('chitra'),
  'the audit row carries on_behalf_of_id');
select is((select a.on_behalf_of_id from public.activity_log a where a.entity = 'members' and a.entity_id = pg_temp.fx('asha') and a.action = 'invited_as_employee'),
  null, 'and null when the override has none');

select * from finish();
rollback;
