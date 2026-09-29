-- 3b.3 Expense claims (PRODUCT §4.18, WORKFLOWS §2a, DATA-MODEL §7a, ADR-0007 amendment):
-- the table's RLS per role (the claimant, another Staff member, an Admin, the Owner, anon),
-- no API writes, the Owner-only permission, the receipt amount and the category list (seeded,
-- guarded against lists.manage alone), expense_claim_submit on every path (window, future,
-- amount, category, note, receipt required, receipt checks), withdraw, decide (approve, reject,
-- reason required, not twice, not a withdrawn claim), mark paid (dates, states), the audit
-- actions and who reads them, and a receipt's visibility (app.file_visible).
begin;
create extension if not exists pgtap with schema extensions;
select plan(100);

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
update public.org_settings set expense_receipt_above = 500;

create temporary table fx (key text primary key, id uuid not null);
insert into fx values
  ('owner',  '00000000-0000-4000-8000-000000000401'),
  ('admin',  '00000000-0000-4000-8000-000000000402'),
  ('staff',  '00000000-0000-4000-8000-000000000403'),
  ('staff2', '00000000-0000-4000-8000-000000000404'),
  -- files
  ('receipt',  '00000000-0000-4000-8000-000000000411'),
  ('preview',  '00000000-0000-4000-8000-000000000412'),
  ('pending',  '00000000-0000-4000-8000-000000000413'),
  ('svg',      '00000000-0000-4000-8000-000000000414'),
  ('others',   '00000000-0000-4000-8000-000000000415'),
  ('old',      '00000000-0000-4000-8000-000000000416'),
  ('receipt2', '00000000-0000-4000-8000-000000000417');
insert into fx select 'org', id from public.organizations limit 1;
insert into fx select 'travel', id from public.list_items
  where list_key = 'expense_category' and name = 'Travel' and org_id = (select id from fx where key = 'org');
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

create function pg_temp.claim(k text, n integer default 1) returns public.expense_claims language sql stable as $$
  select e.* from public.expense_claims e where e.member_id = pg_temp.fx(k) order by e.created_at, e.note offset n - 1 limit 1;
$$;

create function pg_temp.audit_actions(row_id uuid) returns text[] language sql stable as $$
  select coalesce(array_agg(a.action order by a.id), '{}')
  from public.activity_log a where a.entity = 'expense_claims' and a.entity_id = row_id;
$$;

insert into auth.users (id, email)
select id, key || '@example.com' from fx where key in ('owner', 'admin', 'staff', 'staff2');

insert into public.members (id, org_id, full_name, email, role, status, joined_at)
select pg_temp.fx(k), pg_temp.fx('org'), k, k || '@example.com', r::public.member_role, 'active', now() - interval '60 days'
from (values ('owner', 'owner'), ('admin', 'admin'), ('staff', 'staff'), ('staff2', 'staff')) as v(k, r);

-- Receipt files: staff's ready photo, its preview, an unfinished upload, an SVG, staff2's photo,
-- a photo uploaded a week ago, and a second ready photo.
insert into public.files (id, org_id, storage_key, name, mime, size_bytes, uploaded_by, status, preview_of, created_at)
select pg_temp.fx(k), pg_temp.fx('org'), 'org/2026/09/' || k || '/r', k, mime, 10, pg_temp.fx(who), status,
       case when k = 'preview' then pg_temp.fx('receipt') end, now() - age
from (values ('receipt', 'image/jpeg', 'staff', 'ready', interval '0'),
             ('preview', 'image/jpeg', 'staff', 'ready', interval '0'),
             ('pending', 'image/png', 'staff', 'pending', interval '0'),
             ('svg', 'image/svg+xml', 'staff', 'ready', interval '0'),
             ('others', 'image/png', 'staff2', 'ready', interval '0'),
             ('old', 'image/png', 'staff', 'ready', interval '7 days'),
             ('receipt2', 'image/webp', 'staff', 'ready', interval '0')) as v(k, mime, who, status, age);
delete from public.activity_log;

-- Structure, grants and the permission ------------------------------------------------------------
select has_table('public', 'expense_claims', 'expense_claims exists');
select ok((select relrowsecurity from pg_class where oid = 'public.expense_claims'::regclass), 'RLS is on');
select ok(not has_table_privilege('authenticated', 'public.expense_claims', 'insert'), 'no API insert');
select ok(not has_table_privilege('authenticated', 'public.expense_claims', 'update'), 'no API update');
select ok(not has_table_privilege('authenticated', 'public.expense_claims', 'delete'), 'no API delete');
select ok(not has_table_privilege('anon', 'public.expense_claims', 'select'), 'anon reads nothing');
select is((select array_agg(role::text order by role) from public.role_permissions where permission = 'expenses.decide'),
  array['owner'], 'expenses.decide is the Owner''s alone');
select ok(not exists (
    select 1 from pg_publication_tables where tablename = 'expense_claims'),
  'expense_claims is in no Realtime publication');
select is((select expense_receipt_above from public.org_settings where org_id = pg_temp.fx('org')), 500.00::numeric,
  'the receipt amount defaults to 500');
select is((select array_agg(name order by position) from public.list_items
           where list_key = 'expense_category' and org_id = pg_temp.fx('org') and archived_at is null
             and name in ('Travel', 'Food', 'Materials', 'Other')),
  array['Travel', 'Food', 'Materials', 'Other'], 'the categories are seeded');

-- The claim window helper
select is(app.expense_window_start('2026-10-05'), '2026-09-01'::date, 'the 5th still opens last month');
select is(app.expense_window_start('2026-10-06'), '2026-10-01'::date, 'the 6th opens this month only');
select is(app.expense_window_start('2026-01-03'), '2025-12-01'::date, 'early January opens last December');
select is(app.expense_window_start('2026-09-30'), '2026-09-01'::date, 'the month end opens this month');

-- The category list is the Owner's ----------------------------------------------------------------
select pg_temp.as_member('admin');
select throws_ok($$ insert into public.list_items (list_key, name, position) values ('expense_category', 'Parking', 'b0') $$,
  'P0001', 'FORBIDDEN', 'an Admin (lists.manage) cannot add an expense category');
select throws_ok(format($$ update public.list_items set name = 'Trips' where id = %L $$, pg_temp.fx('travel')),
  'P0001', 'FORBIDDEN', 'an Admin cannot rename one');
select lives_ok($$ insert into public.list_items (list_key, name, position) values ('job_title', 'Colour Tester', 'z9') $$,
  'an Admin still edits the other lists');
select throws_ok(format($$ select public.list_item_move('expense_category', %L, 'down') $$, pg_temp.fx('travel')),
  'P0001', 'FORBIDDEN', 'an Admin cannot reorder the categories through list_item_move (3bB review)');
select lives_ok($$ select public.list_item_move('job_title', (select id from public.list_items where list_key = 'job_title' and name = 'Colour Tester'), 'up') $$,
  'an Admin still reorders the other lists');
select pg_temp.as_member('owner');
select lives_ok($$ insert into public.list_items (list_key, name, position) values ('expense_category', 'Parking', 'b0') $$,
  'the Owner adds a category');
select lives_ok(format($$ select public.list_item_move('expense_category', %L, 'down') $$, pg_temp.fx('travel')),
  'the Owner reorders the categories');
select lives_ok($$ update public.list_items set archived_at = now() where list_key = 'expense_category' and name = 'Parking' $$,
  'the Owner archives it');
select pg_temp.as_member('staff');
select throws_ok($$ insert into public.list_items (list_key, name, position) values ('expense_category', 'Tea', 'b1') $$,
  'P0001', 'FORBIDDEN', 'Staff cannot add one');

-- The receipt amount: settings.manage only
select pg_temp.as_member('admin');
update public.org_settings set expense_receipt_above = 10;
select pg_temp.as_system();
select is((select expense_receipt_above from public.org_settings where org_id = pg_temp.fx('org')), 500.00::numeric,
  'an Admin cannot change the receipt amount');
select pg_temp.as_member('owner');
update public.org_settings set expense_receipt_above = 800;
select pg_temp.as_system();
select is((select expense_receipt_above from public.org_settings where org_id = pg_temp.fx('org')), 800.00::numeric,
  'the Owner changes it');
update public.org_settings set expense_receipt_above = 500;

-- expense_claim_submit ------------------------------------------------------------------------------
select pg_temp.as_member('owner');
select throws_ok(format($$ select public.expense_claim_submit(%L, 100, %L, 'Taxi') $$, pg_temp.today(), pg_temp.fx('travel')),
  'P0001', 'FORBIDDEN', 'the Owner has no claims');
select pg_temp.as_anon();
select throws_ok($$ select public.expense_claim_submit('2026-01-01', 100, '00000000-0000-4000-8000-000000000498', 'Taxi') $$,
  '42501', null, 'anon cannot call it');

select pg_temp.as_member('staff');
select throws_ok(format($$ select public.expense_claim_submit(%L, 0, %L, 'Taxi') $$, pg_temp.today(), pg_temp.fx('travel')),
  'P0001', 'VALIDATION', 'a zero amount is refused');
select throws_ok(format($$ select public.expense_claim_submit(%L, -5, %L, 'Taxi') $$, pg_temp.today(), pg_temp.fx('travel')),
  'P0001', 'VALIDATION', 'a negative amount is refused');
select throws_ok(format($$ select public.expense_claim_submit(%L, 10.005, %L, 'Taxi') $$, pg_temp.today(), pg_temp.fx('travel')),
  'P0001', 'VALIDATION', 'three decimals are refused');
select throws_ok(format($$ select public.expense_claim_submit(%L, 10, %L, 'Taxi') $$, pg_temp.today() + 1, pg_temp.fx('travel')),
  'P0001', 'VALIDATION', 'tomorrow is refused');
select throws_ok(format($$ select public.expense_claim_submit(%L, 10, %L, 'Taxi') $$,
    app.expense_window_start(pg_temp.today()) - 1, pg_temp.fx('travel')),
  'P0001', 'VALIDATION', 'the day before the window is refused');
select throws_ok(format($$ select public.expense_claim_submit(null, 10, %L, 'Taxi') $$, pg_temp.fx('travel')),
  'P0001', 'VALIDATION', 'a missing date is refused');
select throws_ok(format($$ select public.expense_claim_submit(%L, 10, %L, 'Taxi') $$, pg_temp.today(),
    (select id from public.list_items where list_key = 'expense_category' and name = 'Parking')),
  'P0001', 'VALIDATION', 'an archived category is refused');
select throws_ok(format($$ select public.expense_claim_submit(%L, 10, %L, 'Taxi') $$, pg_temp.today(),
    (select id from public.list_items where list_key = 'job_title' limit 1)),
  'P0001', 'VALIDATION', 'another list''s entry is not a category');
select throws_ok(format($$ select public.expense_claim_submit(%L, 10, %L, '   ') $$, pg_temp.today(), pg_temp.fx('travel')),
  'P0001', 'VALIDATION', 'the note is required');
select throws_ok(format($$ select public.expense_claim_submit(%L, 10, %L, %L) $$, pg_temp.today(), pg_temp.fx('travel'), repeat('x', 501)),
  'P0001', 'VALIDATION', 'a note over 500 characters is refused');
select throws_ok(format($$ select public.expense_claim_submit(%L, 500.01, %L, 'Train') $$, pg_temp.today(), pg_temp.fx('travel')),
  'P0001', 'VALIDATION', 'above the receipt amount, a receipt is required');
select lives_ok(format($$ select public.expense_claim_submit(%L, 500, %L, 'a Taxi') $$, pg_temp.today(), pg_temp.fx('travel')),
  'exactly the receipt amount needs none');
select lives_ok(format($$ select public.expense_claim_submit(%L, 42.5, %L, 'b Lunch') $$,
    app.expense_window_start(pg_temp.today()), pg_temp.fx('travel')),
  'the first day of the window is accepted, with paise');

-- Receipts
select throws_ok(format($$ select public.expense_claim_submit(%L, 900, %L, 'Train', %L) $$, pg_temp.today(), pg_temp.fx('travel'), pg_temp.fx('others')),
  'P0001', 'FORBIDDEN', 'someone else''s upload cannot be attached');
select throws_ok(format($$ select public.expense_claim_submit(%L, 900, %L, 'Train', %L) $$, pg_temp.today(), pg_temp.fx('travel'), pg_temp.fx('pending')),
  'P0001', 'INVALID_STATE', 'an unfinished upload cannot be attached');
select throws_ok(format($$ select public.expense_claim_submit(%L, 900, %L, 'Train', %L) $$, pg_temp.today(), pg_temp.fx('travel'), pg_temp.fx('svg')),
  'P0001', 'VALIDATION', 'an SVG is not a receipt');
select throws_ok(format($$ select public.expense_claim_submit(%L, 900, %L, 'Train', %L) $$, pg_temp.today(), pg_temp.fx('travel'), pg_temp.fx('preview')),
  'P0001', 'VALIDATION', 'a preview is not attached, its original is');
select throws_ok(format($$ select public.expense_claim_submit(%L, 900, %L, 'Train', %L) $$, pg_temp.today(), pg_temp.fx('travel'), pg_temp.fx('old')),
  'P0001', 'INVALID_STATE', 'an upload a week old has expired');
select throws_ok(format($$ select public.expense_claim_submit(%L, 900, %L, 'Train', %L) $$, pg_temp.today(), pg_temp.fx('travel'), '00000000-0000-4000-8000-000000000499'),
  'P0001', 'NOT_FOUND', 'a missing file');
select lives_ok(format($$ select public.expense_claim_submit(%L, 900, %L, 'c Train', %L) $$, pg_temp.today(), pg_temp.fx('travel'), pg_temp.fx('receipt')),
  'a claim above the amount with its receipt');
select throws_ok(format($$ select public.expense_claim_submit(%L, 900, %L, 'Train again', %L) $$, pg_temp.today(), pg_temp.fx('travel'), pg_temp.fx('receipt')),
  'P0001', 'CONFLICT', 'one upload, one claim');
select lives_ok(format($$ select public.expense_claim_submit(%L, 20, %L, 'd Bus', %L) $$, pg_temp.today(), pg_temp.fx('travel'), pg_temp.fx('receipt2')),
  'a receipt below the amount is welcome too');

select pg_temp.as_system();
select is((select count(*)::integer from public.expense_claims where member_id = pg_temp.fx('staff')), 4, 'four claims for staff');
select is((pg_temp.claim('staff', 1)).state, 'submitted', 'a new claim is submitted');
select is((pg_temp.claim('staff', 3)).receipt_file_id, pg_temp.fx('receipt'), 'the receipt is on the claim');
select is(pg_temp.audit_actions((pg_temp.claim('staff', 1)).id), array['submitted'], 'audited as submitted');

select pg_temp.as_member('admin');
select lives_ok(format($$ select public.expense_claim_submit(%L, 150, %L, 'Admin cab') $$, pg_temp.today(), pg_temp.fx('travel')),
  'an Admin claims their own');
select pg_temp.as_member('staff2');
select lives_ok(format($$ select public.expense_claim_submit(%L, 60, %L, 'Staff2 lunch') $$, pg_temp.today(), pg_temp.fx('travel')),
  'another Staff member claims');

-- Claim ids by note, readable whoever the test acts as (RLS hides others' rows by design).
select pg_temp.as_system();
create temporary table ids as select note, id from public.expense_claims;
grant select on ids to authenticated, anon;

-- RLS per role ---------------------------------------------------------------------------------------
select pg_temp.as_member('staff');
select is((select count(*)::integer from public.expense_claims), 4, 'Staff read their own four claims');
select is((select count(*)::integer from public.expense_claims where member_id <> pg_temp.fx('staff')), 0, 'Staff read nobody else''s');
select pg_temp.as_member('admin');
select is((select count(*)::integer from public.expense_claims), 1, 'an Admin reads their own claim');
select is((select count(*)::integer from public.expense_claims where member_id = pg_temp.fx('staff')), 0,
  'an Admin reads no Staff member''s claim (ADR-0007 amendment)');
select pg_temp.as_member('owner');
select is((select count(*)::integer from public.expense_claims), 6, 'the Owner reads every claim');
select pg_temp.as_anon();
select throws_ok($$ select count(*) from public.expense_claims $$, '42501', null, 'anon is denied');

select pg_temp.as_member('staff');
select throws_ok($$ update public.expense_claims set amount = 1 $$, '42501', null, 'a claim is never updated through the API');
select throws_ok($$ delete from public.expense_claims $$, '42501', null, 'nor deleted');

-- Who reads the audit entries
select is((select count(*)::integer from public.activity_log where entity = 'expense_claims'), 4,
  'the claimant reads the entries about their own claims');
select pg_temp.as_member('admin');
select is((select count(*)::integer from public.activity_log where entity = 'expense_claims'), 1,
  'an Admin reads only the entry about their own claim');

-- A receipt's visibility
select pg_temp.as_member('staff');
select ok(app.file_visible(pg_temp.fx('receipt')), 'the claimant sees their receipt');
select pg_temp.as_member('owner');
select ok(app.file_visible(pg_temp.fx('receipt')), 'the Owner sees a receipt');
select ok(app.file_visible(pg_temp.fx('preview')), 'and its preview');
select pg_temp.as_member('admin');
select ok(not app.file_visible(pg_temp.fx('receipt')), 'an Admin never sees a receipt');
select pg_temp.as_member('staff2');
select ok(not app.file_visible(pg_temp.fx('receipt')), 'nor does another Staff member');

-- expense_claim_withdraw -----------------------------------------------------------------------------
select pg_temp.as_member('staff2');
select throws_ok(format($$ select public.expense_claim_withdraw(%L) $$, (select id from ids where note = 'a Taxi')),
  'P0001', 'NOT_FOUND', 'someone else''s claim cannot be withdrawn');
select pg_temp.as_member('owner');
select throws_ok(format($$ select public.expense_claim_withdraw(%L) $$, (select e.id from public.expense_claims e where e.note = 'a Taxi')),
  'P0001', 'FORBIDDEN', 'the Owner does not withdraw');
select pg_temp.as_member('staff');
select lives_ok(format($$ select public.expense_claim_withdraw(%L) $$, (select e.id from public.expense_claims e where e.note = 'd Bus')),
  'the claimant withdraws a waiting claim');
select throws_ok(format($$ select public.expense_claim_withdraw(%L) $$, (select e.id from public.expense_claims e where e.note = 'd Bus')),
  'P0001', 'INVALID_STATE', 'not twice');
select is((select state from public.expense_claims where note = 'd Bus'), 'withdrawn', 'it is withdrawn');

-- expense_claim_decide -------------------------------------------------------------------------------
select pg_temp.as_member('staff');
select throws_ok(format($$ select public.expense_claim_decide(%L, 'approve') $$, (select e.id from public.expense_claims e where e.note = 'a Taxi')),
  'P0001', 'FORBIDDEN', 'Staff cannot decide');
select pg_temp.as_member('admin');
select throws_ok(format($$ select public.expense_claim_decide(%L, 'approve') $$, (select e.id from public.expense_claims e where e.note = 'Admin cab')),
  'P0001', 'FORBIDDEN', 'an Admin cannot decide, not even their own');
select pg_temp.as_member('owner');
select throws_ok(format($$ select public.expense_claim_decide(%L, 'maybe') $$, (select e.id from public.expense_claims e where e.note = 'a Taxi')),
  'P0001', 'VALIDATION', 'an unknown decision');
select throws_ok(format($$ select public.expense_claim_decide(%L, 'reject', '  ') $$, (select e.id from public.expense_claims e where e.note = 'b Lunch')),
  'P0001', 'REASON_REQUIRED', 'a rejection needs a reason');
select throws_ok(format($$ select public.expense_claim_decide(%L, 'approve') $$, (select e.id from public.expense_claims e where e.note = 'd Bus')),
  'P0001', 'INVALID_STATE', 'a withdrawn claim is not decided');
select throws_ok($$ select public.expense_claim_decide('00000000-0000-4000-8000-000000000498', 'approve') $$,
  'P0001', 'NOT_FOUND', 'a missing claim');
select lives_ok(format($$ select public.expense_claim_decide(%L, 'approve') $$, (select e.id from public.expense_claims e where e.note = 'a Taxi')),
  'the Owner approves');
select lives_ok(format($$ select public.expense_claim_decide(%L, 'reject', 'Not a work trip') $$, (select e.id from public.expense_claims e where e.note = 'b Lunch')),
  'the Owner rejects with a reason');
select throws_ok(format($$ select public.expense_claim_decide(%L, 'reject', 'Changed my mind') $$, (select e.id from public.expense_claims e where e.note = 'a Taxi')),
  'P0001', 'INVALID_STATE', 'a decided claim is not decided again');
select pg_temp.as_system();
select is((select row(state, decided_by, decision_reason is null)::text from public.expense_claims where note = 'a Taxi'),
  row('approved', pg_temp.fx('owner'), true)::text, 'approved by the Owner, no reason');
select is((select row(state, decision_reason)::text from public.expense_claims where note = 'b Lunch'),
  row('rejected', 'Not a work trip')::text, 'rejected with the reason the member reads');
select pg_temp.as_member('staff');
select throws_ok(format($$ select public.expense_claim_withdraw(%L) $$, (select e.id from public.expense_claims e where e.note = 'a Taxi')),
  'P0001', 'INVALID_STATE', 'a decided claim cannot be withdrawn');

-- expense_claim_mark_paid ----------------------------------------------------------------------------
select pg_temp.as_member('admin');
select throws_ok(format($$ select public.expense_claim_mark_paid(%L) $$, (select id from fx where key = 'owner')),
  'P0001', 'FORBIDDEN', 'an Admin cannot mark paid');
select pg_temp.as_member('owner');
select throws_ok(format($$ select public.expense_claim_mark_paid(%L) $$, (select e.id from public.expense_claims e where e.note = 'c Train')),
  'P0001', 'INVALID_STATE', 'a waiting claim is not paid');
select throws_ok(format($$ select public.expense_claim_mark_paid(%L) $$, (select e.id from public.expense_claims e where e.note = 'b Lunch')),
  'P0001', 'INVALID_STATE', 'a rejected claim is not paid');
select throws_ok(format($$ select public.expense_claim_mark_paid(%L, %L) $$, (select e.id from public.expense_claims e where e.note = 'a Taxi'), pg_temp.today() + 1),
  'P0001', 'VALIDATION', 'not paid in the future');
select throws_ok(format($$ select public.expense_claim_mark_paid(%L, %L) $$, (select e.id from public.expense_claims e where e.note = 'a Taxi'), pg_temp.today() - 1),
  'P0001', 'VALIDATION', 'not paid before the expense');
select lives_ok(format($$ select public.expense_claim_mark_paid(%L) $$, (select e.id from public.expense_claims e where e.note = 'a Taxi')),
  'the Owner marks an approved claim paid');
select throws_ok(format($$ select public.expense_claim_mark_paid(%L) $$, (select e.id from public.expense_claims e where e.note = 'a Taxi')),
  'P0001', 'INVALID_STATE', 'not twice');
select pg_temp.as_system();
select is((select row(state, paid_on, paid_by)::text from public.expense_claims where note = 'a Taxi'),
  row('paid', pg_temp.today(), pg_temp.fx('owner'))::text, 'paid today by the Owner by default');
select is(pg_temp.audit_actions((select id from public.expense_claims where note = 'a Taxi')),
  array['submitted', 'approved', 'paid'], 'the audit trail: submitted, approved, paid');
select is(pg_temp.audit_actions((select id from public.expense_claims where note = 'd Bus')),
  array['submitted', 'withdrawn'], 'the audit trail: submitted, withdrawn');

-- A paid claim on an earlier day of the month with an explicit date
select pg_temp.as_member('owner');
select lives_ok(format($$ select public.expense_claim_decide(%L, 'approve') $$, (select e.id from public.expense_claims e where e.note = 'Staff2 lunch')),
  'approve another');
select lives_ok(format($$ select public.expense_claim_mark_paid(%L, %L) $$, (select e.id from public.expense_claims e where e.note = 'Staff2 lunch'), pg_temp.today()),
  'mark it paid with a date');

-- The Owner can read, the claimant can read, an Admin still cannot: after every change
select pg_temp.as_member('admin');
select is((select count(*)::integer from public.expense_claims where member_id <> pg_temp.fx('admin')), 0,
  'after the decisions an Admin still reads nobody else''s claim');

select * from finish();
rollback;
