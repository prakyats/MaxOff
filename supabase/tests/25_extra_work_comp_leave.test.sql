-- 3b.2 Extra work and comp leave credits (PRODUCT §4.3a, WORKFLOWS §2 "Settled in 3b.2",
-- DATA-MODEL §3 "3b.2"): the three tables' RLS per role (allowed and denied), extra_work_note_submit
-- and extra_work_note_decide on every path (kinds, the 7-day window, day off vs working day, the
-- grant, no comp leave, mark the day as worked with no day / a 2.x row / an approved Present),
-- comp_leave_grant, comp_leave_balance, leave_submit_comp (half and full, the expiry rule, not
-- enough, oldest first over two credits, overlap), the settle on withdraw / reject / approve /
-- cancel / Owner cancel / Owner edit, the refused change, comp_leave_revoke on every path, the
-- expired credit, attendance_end_day with an overtime note, and main's leave_submit unchanged.
begin;
create extension if not exists pgtap with schema extensions;
select plan(149);

-- Fixtures as 24: keep the organization, replace the people. Rolled back at the end.
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
delete from public.project_item_stage_list;
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
update public.org_settings set weekly_off_days = '{}';

create temporary table fx (key text primary key, id uuid not null);
insert into fx values
  ('owner',  '00000000-0000-4000-8000-000000000301'),
  ('admin',  '00000000-0000-4000-8000-000000000302'),
  ('staff',  '00000000-0000-4000-8000-000000000303'),
  ('staff2', '00000000-0000-4000-8000-000000000304'),
  ('other',  '00000000-0000-4000-8000-000000000305'),
  ('offday', '00000000-0000-4000-8000-000000000306');
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

create function pg_temp.today() returns date language sql stable as $$ select app.today_ist() $$;

create function pg_temp.credit(k text, n integer default 1) returns public.comp_leave_credits language sql stable as $$
  select c.* from public.comp_leave_credits c where c.member_id = pg_temp.fx(k) order by c.granted_at, c.id offset n - 1 limit 1;
$$;

-- Requests are found by their date: one transaction shares one now(), so created_at cannot order them.
create function pg_temp.request_on(k text, d date) returns public.leave_requests language sql stable as $$
  select r.* from public.leave_requests r
  where r.member_id = pg_temp.fx(k) and r.start_date = d and r.supersedes_id is null;
$$;
create function pg_temp.change_of(req uuid) returns public.leave_requests language sql stable as $$
  select r.* from public.leave_requests r where r.supersedes_id = req;
$$;

create function pg_temp.balance(k text) returns numeric language plpgsql as $$
declare v numeric;
begin
  perform pg_temp.as_member(k);
  select available_days into v from public.comp_leave_balance();
  return v;
end;
$$;

create function pg_temp.audit_actions(tbl text, row_id uuid) returns text[] language sql stable as $$
  select coalesce(array_agg(a.action order by a.id), '{}')
  from public.activity_log a where a.entity = tbl and a.entity_id = row_id;
$$;

insert into auth.users (id, email)
select id, key || '@example.com' from fx where key <> 'org';

insert into public.members (id, org_id, full_name, email, role, status, joined_at)
select pg_temp.fx(k), pg_temp.fx('org'), k, k || '@example.com', r::public.member_role, 'active', now() - interval '30 days'
from (values ('owner', 'owner'), ('admin', 'admin'), ('staff', 'staff'), ('staff2', 'staff'),
             ('other', 'staff'), ('offday', 'staff')) as v(k, r);
-- Two days ago is a weekly day off for this file; every other day is a working day.
update public.org_settings set weekly_off_days = array[extract(dow from pg_temp.today() - 2)::smallint];
delete from public.activity_log;

-- Structure and grants ---------------------------------------------------------------------------
select has_table('public', 'extra_work_notes', 'extra_work_notes exists');
select has_table('public', 'comp_leave_credits', 'comp_leave_credits exists');
select has_table('public', 'comp_leave_credit_uses', 'comp_leave_credit_uses exists');
select has_column('public', 'leave_requests', 'credit_days', 'leave_requests.credit_days exists (nullable, expand-only)');
select ok(
  (select relrowsecurity from pg_class where oid = 'public.extra_work_notes'::regclass)
  and (select relrowsecurity from pg_class where oid = 'public.comp_leave_credits'::regclass)
  and (select relrowsecurity from pg_class where oid = 'public.comp_leave_credit_uses'::regclass),
  'RLS is on for all three tables');
select ok(
  not has_table_privilege('authenticated', 'public.extra_work_notes', 'insert')
  and not has_table_privilege('authenticated', 'public.comp_leave_credits', 'update')
  and not has_table_privilege('authenticated', 'public.comp_leave_credit_uses', 'delete')
  and not has_table_privilege('anon', 'public.extra_work_notes', 'select'),
  'the API role reads only; anon reads nothing (every write is a transition function)');
select ok(
  not has_function_privilege('authenticated', 'app.comp_credit_settle(uuid, text)', 'execute')
  and has_function_privilege('service_role', 'app.comp_credit_settle(uuid, text)', 'execute'),
  'the settle is internal');
select is(app.ist_month_end('2026-09-05'), date '2026-09-30', 'the month end of a September date');
select is(app.ist_month_end('2026-02-01'), date '2026-02-28', 'February 2026');
select throws_ok(
  $$ insert into public.leave_requests (member_id, type, start_date, end_date, state, source, credit_days)
     values (pg_temp.fx('staff'), 'leave', pg_temp.today(), pg_temp.today(), 'submitted', 'form', 1.0) $$,
  '23514', null, 'credit_days on a plain leave is refused by the check');

-- extra_work_note_submit -------------------------------------------------------------------------
select pg_temp.as_member('owner');
select throws_ok($$ select public.extra_work_note_submit('overtime', pg_temp.today(), 'x') $$, 'P0001', 'FORBIDDEN', 'the Owner writes no notes');
select pg_temp.as_member('staff');
select throws_ok($$ select public.extra_work_note_submit('lunch', pg_temp.today(), 'Edit') $$, 'P0001', 'VALIDATION', 'an unknown kind');
select throws_ok($$ select public.extra_work_note_submit('overtime', pg_temp.today() + 1, 'Edit') $$, 'P0001', 'VALIDATION', 'tomorrow is refused');
select throws_ok($$ select public.extra_work_note_submit('overtime', pg_temp.today() - 8, 'Edit') $$, 'P0001', 'VALIDATION', '8 days back is refused (7 is the window)');
select throws_ok($$ select public.extra_work_note_submit('overtime', pg_temp.today(), '   ') $$, 'P0001', 'VALIDATION', 'the note is required');
select throws_ok($$ select public.extra_work_note_submit('overtime', pg_temp.today(), 'Edit', 0) $$, 'P0001', 'VALIDATION', 'a zero duration');
select throws_ok($$ select public.extra_work_note_submit('day_off', pg_temp.today(), 'Shot a reel') $$, 'P0001', 'VALIDATION',
  'an "I worked today" note on a working day is refused');
select throws_ok($$ select public.extra_work_note_submit('overtime', pg_temp.today() - 2, 'Edit') $$, 'P0001', 'VALIDATION',
  'an overtime note on a day off is refused');
select lives_ok($$ select public.extra_work_note_submit('overtime', pg_temp.today() - 7, 'Colour grade for Sharma', 120) $$,
  'an overtime note 7 days back');
select throws_ok($$ select public.extra_work_note_submit('overtime', pg_temp.today() - 7, 'Again') $$, 'P0001', 'CONFLICT',
  'one note per day and kind');
select lives_ok($$ select public.extra_work_note_submit('day_off', pg_temp.today() - 2, 'Shot a reel', 300) $$,
  'an "I worked today" note on the day off');
select results_eq(
  $$ select n.kind, n.duration_minutes, n.note, n.state, n.decision from public.extra_work_notes n
     where n.member_id = pg_temp.fx('staff') order by n.work_date $$,
  $$ values ('overtime', 120, 'Colour grade for Sharma', 'submitted', null::text),
            ('day_off', null::integer, 'Shot a reel', 'submitted', null) $$,
  'both notes wait for the Owner; a day-off note keeps no duration');
select is(pg_temp.audit_actions('extra_work_notes', (select id from public.extra_work_notes where kind = 'overtime' and member_id = pg_temp.fx('staff'))),
  array['submitted'], 'audited as submitted');

-- RLS on the notes --------------------------------------------------------------------------------
select pg_temp.as_member('other');
select lives_ok($$ select public.extra_work_note_submit('overtime', pg_temp.today(), 'Late render') $$, 'other adds a note');
select is((select count(*) from public.extra_work_notes), 1::bigint, 'a Staff member reads only their own notes');
select pg_temp.as_member('staff');
select is((select count(*) from public.extra_work_notes), 2::bigint, 'staff reads their two, not other''s');
select pg_temp.as_member('admin');
select is((select count(*) from public.extra_work_notes), 0::bigint, 'an Admin reads no one else''s notes (attendance is own only)');
select pg_temp.as_member('owner');
select is((select count(*) from public.extra_work_notes), 3::bigint, 'the Owner reads everyone''s');
select pg_temp.as_anon();
select throws_ok('select count(*) from public.extra_work_notes', '42501', null, 'anon reads nothing');
select pg_temp.as_member('staff');
select throws_ok($$ update public.extra_work_notes set note = 'x' $$, '42501', null, 'no direct writes for the API role');

-- extra_work_note_decide -------------------------------------------------------------------------
create temporary table ids (key text primary key, id uuid not null);
insert into ids select 'ot', id from public.extra_work_notes where kind = 'overtime' and member_id = pg_temp.fx('staff');
insert into ids select 'dayoff', id from public.extra_work_notes where kind = 'day_off' and member_id = pg_temp.fx('staff');
insert into ids select 'other_ot', id from public.extra_work_notes where member_id = pg_temp.fx('other');
grant select on ids to authenticated, anon, service_role;
create function pg_temp.nid(k text) returns uuid language sql stable as $$ select id from ids where key = k; $$;

select pg_temp.as_member('staff');
select throws_ok(format($$ select public.extra_work_note_decide(%L, 'grant', 1.0) $$, pg_temp.nid('ot')), 'P0001', 'FORBIDDEN', 'a member cannot decide');
select pg_temp.as_member('owner');
select throws_ok(format($$ select public.extra_work_note_decide(%L, 'maybe') $$, pg_temp.nid('ot')), 'P0001', 'VALIDATION', 'the decision is grant or no_comp_leave');
select throws_ok(format($$ select public.extra_work_note_decide(%L, 'grant') $$, pg_temp.nid('ot')), 'P0001', 'VALIDATION', 'a grant needs ½ or 1 day');
select throws_ok(format($$ select public.extra_work_note_decide(%L, 'grant', 2.0) $$, pg_temp.nid('ot')), 'P0001', 'VALIDATION', 'two days is not a grant');
select throws_ok(format($$ select public.extra_work_note_decide(%L, 'grant', 1.0, true) $$, pg_temp.nid('ot')), 'P0001', 'VALIDATION',
  'only a day off can be marked as worked');
select throws_ok($$ select public.extra_work_note_decide('00000000-0000-4000-8000-0000000000ff', 'grant', 1.0) $$, 'P0001', 'NOT_FOUND', 'an unknown note');
select isnt((select public.extra_work_note_decide(pg_temp.nid('ot'), 'grant', 1.0, false, 'Thanks for the late night')), null,
  'the Owner grants a day for the overtime');
select results_eq(
  $$ select c.days, c.used_days, c.reserved_days, c.granted_on, c.expires_on, c.note, c.note_id = pg_temp.nid('ot'), c.granted_by = pg_temp.fx('owner')
     from public.comp_leave_credits c where c.member_id = pg_temp.fx('staff') $$,
  $$ select 1.0::numeric(2,1), 0.0::numeric(2,1), 0.0::numeric(2,1), pg_temp.today(), app.ist_month_end(pg_temp.today()), 'Thanks for the late night', true, true $$,
  'the credit: one day, free, expiring at the end of this month, linked to the note, the Owner''s note kept');
select results_eq(
  format($$ select n.state, n.decision, n.day_marked_worked, n.decided_by = pg_temp.fx('owner') from public.extra_work_notes n where n.id = %L $$, pg_temp.nid('ot')),
  $$ values ('reviewed', 'granted', false, true) $$,
  'the note is reviewed as granted');
select is(pg_temp.audit_actions('extra_work_notes', pg_temp.nid('ot')), array['submitted', 'reviewed'], 'the note is audited as reviewed');
select is(pg_temp.audit_actions('comp_leave_credits', (pg_temp.credit('staff')).id), array['granted'], 'the credit is audited as granted');
select throws_ok(format($$ select public.extra_work_note_decide(%L, 'no_comp_leave') $$, pg_temp.nid('ot')), 'P0001', 'INVALID_STATE', 'a reviewed note is done');

-- No comp leave, and the day off marked as worked: no day row existed.
select is((select public.extra_work_note_decide(pg_temp.nid('dayoff'), 'no_comp_leave', null, true)), null, 'no comp leave gives no credit');
select results_eq(
  format($$ select n.state, n.decision, n.day_marked_worked from public.extra_work_notes n where n.id = %L $$, pg_temp.nid('dayoff')),
  $$ values ('reviewed', 'no_comp_leave', true) $$,
  '"Reviewed by the Owner", the day marked as worked');
select results_eq(
  $$ select d.is_day_off, d.state::text, d.final_status::text, d.decided_by = pg_temp.fx('owner'), d.decision_reason, d.proposed_by_system
     from public.attendance_days d where d.member_id = pg_temp.fx('staff') and d.work_date = pg_temp.today() - 2 $$,
  $$ values (true, 'corrected', 'present', true, 'worked on a day off', false) $$,
  'the day is created as Present on a day off, decided by the Owner');
select is((select array_agg(e.action || ':' || coalesce(e.to_status::text, '') order by e.id)
           from public.attendance_events e join public.attendance_days d on d.id = e.attendance_day_id
           where d.member_id = pg_temp.fx('staff') and d.work_date = pg_temp.today() - 2),
  array['corrected:present'], 'one corrected event to present');

-- A day-off row opened without a choice (awaiting_choice) is corrected; an approved Present is left alone.
select pg_temp.as_system();
update public.org_settings set weekly_off_days = array[extract(dow from pg_temp.today() - 2)::smallint, extract(dow from pg_temp.today() - 3)::smallint];
insert into public.attendance_days (member_id, work_date, started_at, is_day_off)
values (pg_temp.fx('other'), pg_temp.today() - 2, now() - interval '2 days', true);
insert into public.attendance_days (member_id, work_date, started_at, is_day_off, state, submitted_choice, submitted_at, final_status, decided_by, decided_at)
values (pg_temp.fx('other'), pg_temp.today() - 3, now() - interval '3 days', true, 'approved', 'present', now() - interval '3 days', 'present', pg_temp.fx('owner'), now());
select pg_temp.as_member('other');
select lives_ok($$ select public.extra_work_note_submit('day_off', pg_temp.today() - 2, 'Sunday shoot') $$, 'other: a day-off note on an opened, unchosen day');
select lives_ok($$ select public.extra_work_note_submit('day_off', pg_temp.today() - 3, 'Saturday shoot') $$, 'other: a day-off note on an approved Present');
select pg_temp.as_member('owner');
select lives_ok(
  format($$ select public.extra_work_note_decide(%L, 'grant', 0.5, true) $$,
         (select id from public.extra_work_notes where member_id = pg_temp.fx('other') and work_date = pg_temp.today() - 2)),
  'granted half a day and marked as worked');
select results_eq(
  $$ select d.state::text, d.final_status::text, d.started_at is not null, d.decision_reason
     from public.attendance_days d where d.member_id = pg_temp.fx('other') and d.work_date = pg_temp.today() - 2 $$,
  $$ values ('corrected', 'present', true, 'worked on a day off') $$,
  'the row is corrected to Present; its start stays');
select lives_ok(
  format($$ select public.extra_work_note_decide(%L, 'no_comp_leave', null, true) $$,
         (select id from public.extra_work_notes where member_id = pg_temp.fx('other') and work_date = pg_temp.today() - 3)),
  'marked as worked on a day that already counts');
select is((select count(*) from public.attendance_events e join public.attendance_days d on d.id = e.attendance_day_id
           where d.member_id = pg_temp.fx('other') and d.work_date = pg_temp.today() - 3), 0::bigint,
  'an approved Present is left exactly as it was');

-- comp_leave_grant and comp_leave_balance ----------------------------------------------------------
select pg_temp.as_member('staff');
select throws_ok(format($$ select public.comp_leave_grant(%L, 1.0) $$, pg_temp.fx('staff2')), 'P0001', 'FORBIDDEN', 'a member cannot grant');
select pg_temp.as_member('owner');
select throws_ok(format($$ select public.comp_leave_grant(%L, 1.0) $$, pg_temp.fx('owner')), 'P0001', 'NOT_FOUND', 'the Owner has no comp leave');
select throws_ok(format($$ select public.comp_leave_grant(%L, 1.5) $$, pg_temp.fx('staff2')), 'P0001', 'VALIDATION', '1.5 days is not a grant');
select lives_ok(format($$ select public.comp_leave_grant(%L, 0.5, 'For the Sunday edit') $$, pg_temp.fx('staff2')), 'a standalone half day');
select results_eq(
  $$ select c.days, c.expires_on, c.note, c.note_id from public.comp_leave_credits c where c.member_id = pg_temp.fx('staff2') $$,
  $$ select 0.5::numeric(2,1), app.ist_month_end(pg_temp.today()), 'For the Sunday edit', null::uuid $$,
  'the standalone grant, with the Owner''s note and no note behind it');
select is(pg_temp.balance('staff'), 1.0, 'staff has one day');
select is(pg_temp.balance('staff2'), 0.5, 'staff2 has half a day');
select is(pg_temp.balance('other'), 0.5, 'other has the half day from their note');
select pg_temp.as_member('staff');
select throws_ok(format($$ select * from public.comp_leave_balance(%L) $$, pg_temp.fx('staff2')), 'P0001', 'FORBIDDEN', 'a member cannot read another''s balance');
select pg_temp.as_member('owner');
select results_eq(
  format($$ select available_days, use_by from public.comp_leave_balance(%L) $$, pg_temp.fx('staff2')),
  $$ select 0.5::numeric, app.ist_month_end(pg_temp.today()) $$,
  'the Owner reads anyone''s balance and use-by date');
select is((select available_days from public.comp_leave_balance(pg_temp.fx('admin'))), 0::numeric, 'no credits: zero');

-- RLS on the credits ----------------------------------------------------------------------------
select pg_temp.as_member('staff');
select is((select count(*) from public.comp_leave_credits), 1::bigint, 'staff reads their own credit only');
select pg_temp.as_member('admin');
select is((select count(*) from public.comp_leave_credits), 0::bigint, 'an Admin reads no one else''s credits');
select pg_temp.as_member('owner');
select is((select count(*) from public.comp_leave_credits), 3::bigint, 'the Owner reads all credits');
select pg_temp.as_member('staff');
select throws_ok($$ update public.comp_leave_credits set used_days = 1.0 $$, '42501', null, 'no direct writes on credits');

-- leave_submit_comp ------------------------------------------------------------------------------
-- The flows below need several distinct dates on or before the credits' use-by date, which a
-- month's last days cannot give: push these fixtures' expiry out (as the owner; the month-end rule
-- itself is asserted above through the grants and below through the "after the use-by date" case).
select pg_temp.as_system();
update public.comp_leave_credits set expires_on = pg_temp.today() + 60
where member_id in (pg_temp.fx('staff'), pg_temp.fx('staff2'));
select pg_temp.as_member('staff2');
select throws_ok($$ select public.leave_submit_comp(pg_temp.today() + 1, false) $$, 'P0001', 'VALIDATION', 'half a day cannot cover a full comp day');
select throws_ok($$ select public.leave_submit_comp(pg_temp.today() - 1, true) $$, 'P0001', 'VALIDATION', 'comp leave cannot start in the past');
select lives_ok($$ select public.leave_submit_comp(pg_temp.today() + 1, true, 'Half a day off') $$, 'a half comp day tomorrow');
select results_eq(
  $$ select r.type::text, r.start_date = r.end_date, r.credit_days, r.state::text, r.source, r.reason
     from public.leave_requests r where r.member_id = pg_temp.fx('staff2') $$,
  $$ values ('half_day', true, 0.5::numeric(2,1), 'submitted', 'form', 'Half a day off') $$,
  'a half day request carrying half a credit');
select results_eq(
  $$ select u.days, u.state, c.reserved_days, c.used_days
     from public.comp_leave_credit_uses u join public.comp_leave_credits c on c.id = u.credit_id
     where c.member_id = pg_temp.fx('staff2') $$,
  $$ select 0.5::numeric(2,1), 'reserved', 0.5::numeric(2,1), 0.0::numeric(2,1) $$,
  'the credit is reserved for the request');
select is(pg_temp.balance('staff2'), 0::numeric, 'a reserved credit is no longer free');
select pg_temp.as_member('staff2');
select throws_ok($$ select public.leave_submit_comp(pg_temp.today() + 2, true) $$, 'P0001', 'VALIDATION', 'nothing left to draw on');
select is((select count(*) from public.comp_leave_credit_uses), 1::bigint, 'staff2 reads the use through their own credit');

-- The date counts, not the decision (decision 16): a date after the credit's month is refused
-- (today + 62: a working day in this file, so the refusal is the credit's, not the day off's).
select pg_temp.as_member('staff');
select throws_ok(
  $$ select public.leave_submit_comp(pg_temp.today() + 62, false) $$, 'P0001', 'VALIDATION',
  'a date after the use-by date has no credit to cover it');
select lives_ok($$ select public.leave_submit_comp(pg_temp.today(), false, 'Rest day') $$, 'a full comp day today, the last day allowed or earlier');
select results_eq(
  $$ select r.type::text, r.credit_days, r.state::text from public.leave_requests r where r.member_id = pg_temp.fx('staff') $$,
  $$ values ('comp_leave', 1.0::numeric(2,1), 'submitted') $$,
  'a full comp day request');
select throws_ok($$ select public.leave_submit_comp(pg_temp.today(), true) $$, 'P0001', 'CONFLICT', 'a second request on the same date overlaps');
select is(pg_temp.balance('staff'), 0::numeric, 'the day is reserved');
select pg_temp.as_member('staff');
-- Withdraw releases it.
select lives_ok(format($$ select public.leave_withdraw(%L) $$, (pg_temp.request_on('staff', pg_temp.today())).id), 'staff withdraws');
select results_eq(
  $$ select u.state, c.reserved_days, c.used_days from public.comp_leave_credit_uses u join public.comp_leave_credits c on c.id = u.credit_id
     where c.member_id = pg_temp.fx('staff') $$,
  $$ select 'released', 0.0::numeric(2,1), 0.0::numeric(2,1) $$,
  'the withdrawn request gives the day back');
select is(pg_temp.balance('staff'), 1.0, 'staff has the day again');
select is(array_remove(pg_temp.audit_actions('comp_leave_credits', (pg_temp.credit('staff')).id), 'update'), array['granted', 'reserved', 'released'],
  'the credit''s history: granted, reserved, released (the fixture''s expiry push aside)');

-- Reject releases; approve uses.
select pg_temp.as_member('staff');
select lives_ok($$ select public.leave_submit_comp(pg_temp.today() + 1, false) $$, 'requested again for tomorrow');
select pg_temp.as_member('owner');
select lives_ok(format($$ select * from public.leave_decide(%L, 'reject', 'Shoot that day') $$, (pg_temp.request_on('staff', pg_temp.today() + 1)).id), 'the Owner rejects');
select is(pg_temp.balance('staff'), 1.0, 'a rejected request gives the day back');
select pg_temp.as_member('staff');
select lives_ok($$ select public.leave_submit_comp(pg_temp.today() + 2, false) $$, 'requested once more');
select pg_temp.as_member('owner');
select lives_ok(format($$ select * from public.leave_decide(%L, 'approve') $$, (pg_temp.request_on('staff', pg_temp.today() + 2)).id), 'the Owner approves');
select results_eq(
  $$ select c.used_days, c.reserved_days from public.comp_leave_credits c where c.member_id = pg_temp.fx('staff') $$,
  $$ select 1.0::numeric(2,1), 0.0::numeric(2,1) $$,
  'an approved comp leave uses the credit');
select is((select state from public.comp_leave_credit_uses u where u.leave_request_id = (pg_temp.request_on('staff', pg_temp.today() + 2)).id), 'used', 'the use is used');
select is(pg_temp.balance('staff'), 0::numeric, 'nothing free');
select pg_temp.as_system();
select is((app.leave_covering(pg_temp.fx('staff'), pg_temp.today() + 2)).type, 'comp_leave'::public.leave_type,
  'the approved comp leave covers the day, so the day is derived from it when it opens (as any approved leave)');

-- A change of comp leave is refused; a cancellation releases the used credit.
select pg_temp.as_member('staff');
select throws_ok(
  format($$ select public.leave_request_change(%L, 'comp_leave', pg_temp.today() + 3, pg_temp.today() + 3) $$, (pg_temp.request_on('staff', pg_temp.today() + 2)).id),
  'P0001', 'INVALID_STATE', 'comp leave cannot be moved: cancel and request again');
select lives_ok(format($$ select public.leave_request_change(%L, cancel := true) $$, (pg_temp.request_on('staff', pg_temp.today() + 2)).id), 'staff asks to cancel it');
select pg_temp.as_member('owner');
select lives_ok(format($$ select * from public.leave_decide(%L, 'approve') $$, (pg_temp.change_of((pg_temp.request_on('staff', pg_temp.today() + 2)).id)).id), 'the Owner approves the cancellation');
select results_eq(
  $$ select c.used_days, c.reserved_days from public.comp_leave_credits c where c.member_id = pg_temp.fx('staff') $$,
  $$ select 0.0::numeric(2,1), 0.0::numeric(2,1) $$,
  'the cancelled comp leave gives its day back');
select is(pg_temp.balance('staff'), 1.0, 'staff has the day once more');

-- Owner cancel and Owner edit release too.
select pg_temp.as_member('staff');
select lives_ok($$ select public.leave_submit_comp(pg_temp.today() + 3, false) $$, 'requested for +3');
select pg_temp.as_member('owner');
select lives_ok(format($$ select * from public.leave_decide(%L, 'approve') $$, (pg_temp.request_on('staff', pg_temp.today() + 3)).id), 'approved');
select is(pg_temp.balance('staff'), 0::numeric, 'used');
select pg_temp.as_member('owner');
select lives_ok(format($$ select public.leave_owner_cancel(%L, 'Needed on set') $$, (pg_temp.request_on('staff', pg_temp.today() + 3)).id), 'the Owner cancels it');
select is(pg_temp.balance('staff'), 1.0, 'an Owner cancellation gives the day back');
select pg_temp.as_member('staff');
-- +6: +4 and +5 are this file's weekly days off by now, and comp leave is never on a day off.
select lives_ok($$ select public.leave_submit_comp(pg_temp.today() + 6, false) $$, 'requested for +6');
select pg_temp.as_member('owner');
select lives_ok(format($$ select * from public.leave_decide(%L, 'approve') $$, (pg_temp.request_on('staff', pg_temp.today() + 6)).id), 'approved');
select lives_ok(format($$ select * from public.leave_owner_edit(%L, 'leave', pg_temp.today() + 5, pg_temp.today() + 5, 'Moved it') $$, (pg_temp.request_on('staff', pg_temp.today() + 6)).id),
  'the Owner edits it into plain leave on another day');
select is(pg_temp.balance('staff'), 1.0, 'the superseded comp leave gives its day back; the Owner''s leave carries no credit');
select is((select credit_days from public.leave_requests r where r.member_id = pg_temp.fx('staff') and r.source = 'owner'), null, 'the Owner''s replacement has no credit_days');

-- Oldest first over two credits (decision 16).
select pg_temp.as_system();
insert into public.comp_leave_credits (member_id, days, granted_by, granted_at, granted_on, expires_on)
values (pg_temp.fx('admin'), 0.5, pg_temp.fx('owner'), now() - interval '2 days', pg_temp.today(), pg_temp.today() + 60),
       (pg_temp.fx('admin'), 1.0, pg_temp.fx('owner'), now() - interval '1 day', pg_temp.today(), pg_temp.today() + 60);
select is(pg_temp.balance('admin'), 1.5, 'the Admin has a day and a half');
select pg_temp.as_member('admin');
select lives_ok($$ select public.leave_submit_comp(pg_temp.today() + 1, false) $$, 'a full comp day drawing on both credits');
select results_eq(
  $$ select c.days, u.days, c.reserved_days from public.comp_leave_credit_uses u join public.comp_leave_credits c on c.id = u.credit_id
     where c.member_id = pg_temp.fx('admin') order by c.granted_at $$,
  $$ values (0.5::numeric(2,1), 0.5::numeric(2,1), 0.5::numeric(2,1)), (1.0::numeric(2,1), 0.5::numeric(2,1), 0.5::numeric(2,1)) $$,
  'the older half-day credit is drawn first, then half of the newer one');
select is(pg_temp.balance('admin'), 0.5, 'half a day is left on the newer credit');

-- comp_leave_revoke ------------------------------------------------------------------------------
select pg_temp.as_member('staff');
select throws_ok(format($$ select public.comp_leave_revoke(%L, 'no') $$, (pg_temp.credit('staff')).id), 'P0001', 'FORBIDDEN', 'a member cannot revoke');
select pg_temp.as_member('owner');
select throws_ok(format($$ select public.comp_leave_revoke(%L) $$, (pg_temp.credit('staff')).id), 'P0001', 'REASON_REQUIRED', 'a revoke needs a reason');
select throws_ok(format($$ select public.comp_leave_revoke(%L, 'Granted by mistake') $$, (pg_temp.credit('admin', 1)).id), 'P0001', 'INVALID_STATE',
  'a reserved credit cannot be revoked: decide the request first');
select throws_ok(format($$ select public.comp_leave_revoke(%L, 'Granted by mistake') $$, (pg_temp.credit('staff2')).id), 'P0001', 'INVALID_STATE',
  'staff2''s reserved half day cannot be revoked either');
select lives_ok(format($$ select public.comp_leave_revoke(%L, 'Granted by mistake') $$, (pg_temp.credit('staff')).id), 'the Owner revokes staff''s free day');
select results_eq(
  $$ select c.revoked_at is not null, c.revoked_by = pg_temp.fx('owner'), c.revoke_reason from public.comp_leave_credits c where c.member_id = pg_temp.fx('staff') $$,
  $$ values (true, true, 'Granted by mistake') $$,
  'revoked with the reason the member reads');
select is(pg_temp.balance('staff'), 0::numeric, 'a revoked credit is gone from the balance');
select pg_temp.as_member('owner');
select throws_ok(format($$ select public.comp_leave_revoke(%L, 'Again') $$, (pg_temp.credit('staff')).id), 'P0001', 'INVALID_STATE', 'twice is refused');
select is(pg_temp.audit_actions('comp_leave_credits', (pg_temp.credit('staff')).id) @> array['revoked'], true, 'audited as revoked');
-- A used credit cannot be revoked: approve staff2's half day first.
select lives_ok(format($$ select * from public.leave_decide(%L, 'approve') $$, (pg_temp.request_on('staff2', pg_temp.today() + 1)).id), 'staff2''s half comp day is approved');
select throws_ok(format($$ select public.comp_leave_revoke(%L, 'Too late') $$, (pg_temp.credit('staff2')).id), 'P0001', 'INVALID_STATE', 'a used credit cannot be revoked');
select pg_temp.as_system();
select is((app.leave_covering(pg_temp.fx('staff2'), pg_temp.today() + 1)).type, 'half_day'::public.leave_type,
  'the half comp day covers its date as a half day, so the day derives as any half day');

-- An expired credit: history, no balance, no revoke, no request.
select pg_temp.as_system();
insert into public.comp_leave_credits (member_id, days, granted_by, granted_at, granted_on, expires_on)
values (pg_temp.fx('offday'), 1.0, pg_temp.fx('owner'), now() - interval '40 days', pg_temp.today() - 40, app.ist_month_end(pg_temp.today() - 40));
select is(pg_temp.balance('offday'), 0::numeric, 'an expired credit is not available');
select pg_temp.as_member('offday');
select throws_ok($$ select public.leave_submit_comp(pg_temp.today(), false) $$, 'P0001', 'VALIDATION', 'an expired credit covers nothing');
select is((select count(*) from public.comp_leave_credits), 1::bigint, 'it stays in the member''s history as expired');
select pg_temp.as_member('owner');
select throws_ok(format($$ select public.comp_leave_revoke(%L, 'Gone') $$, (pg_temp.credit('offday')).id), 'P0001', 'INVALID_STATE', 'nothing to revoke on an expired credit');

-- attendance_end_day with the overtime note ------------------------------------------------------
select pg_temp.as_member('offday');
select lives_ok('select public.attendance_start_day()', 'offday starts the day');
select results_eq(
  $$ select work_date, note_id is not null from public.attendance_end_day('Finished the wedding edit', 90) $$,
  $$ select pg_temp.today(), true $$,
  'End day with an overtime note');
select results_eq(
  $$ select n.kind, n.work_date, n.duration_minutes, n.note, n.state from public.extra_work_notes n where n.member_id = pg_temp.fx('offday') $$,
  $$ select 'overtime', pg_temp.today(), 90, 'Finished the wedding edit', 'submitted' $$,
  'the note lands on the day that ended, waiting for the Owner');
select pg_temp.as_member('staff2');
select lives_ok('select public.attendance_start_day()', 'staff2 starts');
select lives_ok($$ select public.extra_work_note_submit('overtime', pg_temp.today(), 'Early note') $$, 'staff2 already noted today');
select throws_ok($$ select * from public.attendance_end_day('A second note') $$, 'P0001', 'CONFLICT', 'a second note for the day is refused with the end');
select is((select ended_at from public.attendance_days d where d.member_id = pg_temp.fx('staff2') and d.work_date = pg_temp.today()), null,
  'and the day was not ended either (one transaction)');
select lives_ok($$ select * from public.attendance_end_day() $$, 'ended without a note');

-- 3c.1 (the contract migration): leave_submit() refuses comp leave, so no request carries no credit.
select pg_temp.as_member('other');
select throws_ok($$ select public.leave_submit('comp_leave', pg_temp.today() + 10, pg_temp.today() + 10) $$, 'P0001', 'VALIDATION',
  'comp leave through leave_submit is refused');
select is((select count(*) from public.leave_requests r where r.member_id = pg_temp.fx('other')), 0::bigint, 'and nothing was written');

-- RLS on the audit entries and the uses, per role (architecture review of 3bA) -------------------
select pg_temp.as_system();
create temporary table staff2_rows as
  select 'comp_leave_credits'::text as entity, c.id from public.comp_leave_credits c where c.member_id = pg_temp.fx('staff2')
  union all
  select 'extra_work_notes', n.id from public.extra_work_notes n where n.member_id = pg_temp.fx('staff2');
grant select on staff2_rows to authenticated;
create function pg_temp.staff2_audit() returns bigint language sql stable as $$
  select count(*) from public.activity_log a join staff2_rows r on r.entity = a.entity and r.id = a.entity_id;
$$;
select ok(pg_temp.staff2_audit() > 0, 'the fixture has audit entries about staff2''s note and credit');
select pg_temp.as_member('staff2');
select ok(pg_temp.staff2_audit() > 0, 'staff2 reads the entries about their own note and credit');
select pg_temp.as_member('other');
select is(pg_temp.staff2_audit(), 0::bigint, 'another staff member reads none of them');
select pg_temp.as_member('admin');
select is(pg_temp.staff2_audit(), 0::bigint, 'an Admin reads none of them');
select pg_temp.as_member('owner');
select ok(pg_temp.staff2_audit() > 0, 'the Owner reads them');

select pg_temp.as_system();
create temporary table all_uses as select count(*) as n from public.comp_leave_credit_uses;
grant select on all_uses to authenticated;
select ok((select n from all_uses) > 0, 'the fixture has credit uses');
select pg_temp.as_member('admin');
select is((select count(*) from public.comp_leave_credit_uses u
           where not exists (select 1 from public.comp_leave_credits c where c.id = u.credit_id and c.member_id = pg_temp.fx('admin'))),
          0::bigint, 'an Admin reads no one else''s credit uses (only those of their own credits)');
select pg_temp.as_member('other');
select is((select count(*) from public.comp_leave_credit_uses u join public.comp_leave_credits c on c.id = u.credit_id
           where c.member_id <> pg_temp.fx('other')), 0::bigint, 'a staff member reads no one else''s credit uses');
select pg_temp.as_member('owner');
select is((select count(*) from public.comp_leave_credit_uses), (select n from all_uses), 'the Owner reads every use');

-- A note for a day before attendance started is refused (it starts the day after joining).
select pg_temp.as_system();
update public.members set joined_at = now() - interval '1 day' where id = pg_temp.fx('other');
select pg_temp.as_member('other');
select throws_ok($$ select public.extra_work_note_submit('overtime', pg_temp.today() - 1, 'Before I joined') $$,
  'P0001', 'VALIDATION', 'no note for the joining day');
select throws_ok($$ select public.extra_work_note_submit('overtime', pg_temp.today() - 3, 'Before I joined') $$,
  'P0001', 'VALIDATION', 'nor for a day before it');

select * from finish();
rollback;
