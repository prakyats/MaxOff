-- v3.5 "Month close", U1 (migration v35_month_snapshots; DATA-MODEL §9; WORKFLOWS §7; PERMISSIONS "Month
-- close"; ADR-0007 amendment 2026-11-25): the month_snapshots table. It holds a closed month's revenue, so it
-- is sealed like the money tables of pgTAP 144.
--   0. the structure: columns, keys, the checks (first of the month, version, the correction pair, the note);
--   1. the seal: RLS, one policy (finance.view in the caller's org), no write grant, UPDATE and DELETE
--      revoked, no publication, no row-copying audit trigger (the amounts never reach activity_log);
--   2. who reads: the Owner their own organization's rows and no other's; an Admin, Crew, a freelancer, a
--      deactivated member and anon nothing;
--   3. who writes: nobody through the API, the Owner included.
-- Every name here is neutral.
begin;
create extension if not exists pgtap with schema extensions;
select plan(65);

delete from public.month_snapshots;

delete from public.deliverable_templates;
delete from public.item_reviews;
delete from public.project_item_stage_list;
delete from public.project_item_stages;
delete from public.revenue_overrides;
delete from public.project_advances;
delete from public.item_billing;
delete from public.cycle_billing;
delete from public.project_billing;
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


create temporary table fx (key text primary key, id uuid not null);
insert into fx values
  ('owner',   '00000000-0000-4000-8000-000000160901'),
  ('admin',   '00000000-0000-4000-8000-000000160902'),
  ('staff',   '00000000-0000-4000-8000-000000160903'),
  ('free',    '00000000-0000-4000-8000-000000160904'),
  ('gone',    '00000000-0000-4000-8000-000000160905'),
  ('org_b',   '00000000-0000-4000-8000-000000160910'),
  ('b_owner', '00000000-0000-4000-8000-000000160911'),
  ('v1',      '00000000-0000-4000-8000-0000001609a1'),
  ('v2',      '00000000-0000-4000-8000-0000001609a2'),
  ('b_v1',    '00000000-0000-4000-8000-0000001609b1');
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
create function pg_temp.as_system() returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', '', true);
end;
$$;
create function pg_temp.as_anon() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  perform set_config('role', 'anon', true);
end;
$$;
-- How a statement ends for the caller: 'ok', NO_PRIVILEGE, or the SQLSTATE.
create function pg_temp.code(sql text) returns text language plpgsql as $$
begin
  execute sql;
  return 'ok';
exception
  when insufficient_privilege then return 'NO_PRIVILEGE';
  when others then return sqlstate;
end;
$$;
-- How many rows a statement returns for the caller (-1 = no privilege at all).
create function pg_temp.n(sql text) returns integer language plpgsql as $$
declare v integer;
begin
  execute 'select count(*)::integer from (' || sql || ') q' into v;
  return v;
exception when insufficient_privilege then return -1;
end;
$$;

insert into public.organizations (id, name) values (pg_temp.fx('org_b'), 'Other org 160');
insert into auth.users (id, email)
select id, key || '-160@example.com' from fx where key in ('owner', 'admin', 'staff', 'free', 'gone', 'b_owner');
insert into public.members (id, org_id, full_name, email, role, status, engagement, joined_at, deactivated_at) values
  (pg_temp.fx('owner'),   pg_temp.fx('org'),   'Test Owner',  'owner-160@example.com',   'owner', 'active',      'permanent', now(), null),
  (pg_temp.fx('admin'),   pg_temp.fx('org'),   'Test Admin',  'admin-160@example.com',   'admin', 'active',      'permanent', now(), null),
  (pg_temp.fx('staff'),   pg_temp.fx('org'),   'Test Crew',   'staff-160@example.com',   'staff', 'active',      'permanent', now(), null),
  (pg_temp.fx('free'),    pg_temp.fx('org'),   'Test Free',   null,                      'staff', 'active',      'freelance', now(), null),
  (pg_temp.fx('gone'),    pg_temp.fx('org'),   'Test Gone',   'gone-160@example.com',    'admin', 'deactivated', 'permanent', now() - interval '9 days', now()),
  (pg_temp.fx('b_owner'), pg_temp.fx('org_b'), 'Other Owner', 'b_owner-160@example.com', 'owner', 'active',      'permanent', now(), null);

-- The rows the functions of U2 and U3 will write, written here by the system: a close, its correction, and
-- another organization's close of the same month. 61234 is the amount no one but the Owner may meet.
insert into public.month_snapshots (id, org_id, month, version, data, closed_by, corrects_id, correction_note) values
  (pg_temp.fx('v1'), pg_temp.fx('org'), date '2026-09-01', 1, '{"schema": 1, "total": 61234}', pg_temp.fx('owner'), null, null);
insert into public.month_snapshots (id, org_id, month, version, data, closed_by, corrects_id, correction_note) values
  (pg_temp.fx('v2'), pg_temp.fx('org'), date '2026-09-01', 2, '{"schema": 1, "total": 61235}', pg_temp.fx('owner'),
   pg_temp.fx('v1'), 'One late approval counted.'),
  (pg_temp.fx('b_v1'), pg_temp.fx('org_b'), date '2026-09-01', 1, '{"schema": 1, "total": 5}', pg_temp.fx('b_owner'), null, null);

-- ===========================================================================================================
-- 0. The structure
-- ===========================================================================================================
select has_table('public', 'month_snapshots', 'month_snapshots exists');
select columns_are('public', 'month_snapshots',
  array['id', 'org_id', 'month', 'version', 'data', 'closed_by', 'closed_at', 'corrects_id', 'correction_note'],
  'with exactly the columns of DATA-MODEL §9');
select col_is_pk('public', 'month_snapshots', 'id', 'id is the key');
select col_type_is('public', 'month_snapshots', 'month', 'date', 'month is a date');
select col_type_is('public', 'month_snapshots', 'version', 'integer', 'version is an integer');
select col_type_is('public', 'month_snapshots', 'data', 'jsonb', 'data is jsonb');
select col_type_is('public', 'month_snapshots', 'closed_at', 'timestamp with time zone', 'closed_at is an instant');
select ok((select bool_and(a.attnotnull) and count(*) = 7 from pg_attribute a
           where a.attrelid = 'public.month_snapshots'::regclass
             and a.attname in ('id', 'org_id', 'month', 'version', 'data', 'closed_by', 'closed_at')),
  'everything but the correction pair is required');
select ok((select not bool_or(a.attnotnull) and count(*) = 2 from pg_attribute a
           where a.attrelid = 'public.month_snapshots'::regclass and a.attname in ('corrects_id', 'correction_note')),
  'corrects_id and correction_note may be empty (version 1)');
select col_is_unique('public', 'month_snapshots', array['org_id', 'month', 'version'], 'one row per organization, month and version');
select fk_ok('public', 'month_snapshots', 'org_id', 'public', 'organizations', 'id', 'org_id → organizations');
select fk_ok('public', 'month_snapshots', 'closed_by', 'public', 'members', 'id', 'closed_by → members');
select fk_ok('public', 'month_snapshots', 'corrects_id', 'public', 'month_snapshots', 'id', 'corrects_id → month_snapshots');

-- The checks. Each statement is one valid row with one thing wrong.
select is(pg_temp.code($$insert into public.month_snapshots (org_id, month, version, data, closed_by)
  values (pg_temp.fx('org'), date '2026-10-02', 1, '{}', pg_temp.fx('owner'))$$), '23514',
  'a month that is not the 1st is refused');
select is(pg_temp.code($$insert into public.month_snapshots (org_id, month, version, data, closed_by)
  values (pg_temp.fx('org'), date '2026-10-31', 1, '{}', pg_temp.fx('owner'))$$), '23514',
  'so is the last day of a month');
select is(pg_temp.code($$insert into public.month_snapshots (org_id, month, version, data, closed_by)
  values (pg_temp.fx('org'), date '2026-10-01', 0, '{}', pg_temp.fx('owner'))$$), '23514',
  'version 0 is refused');
select is(pg_temp.code($$insert into public.month_snapshots (org_id, month, version, data, closed_by)
  values (pg_temp.fx('org'), date '2026-10-01', -1, '{}', pg_temp.fx('owner'))$$), '23514',
  'and a negative version');
select is(pg_temp.code($$insert into public.month_snapshots (org_id, month, version, data, closed_by, corrects_id)
  values (pg_temp.fx('org'), date '2026-10-01', 1, '{}', pg_temp.fx('owner'), pg_temp.fx('v1'))$$), '23514',
  'version 1 corrects nothing');
select is(pg_temp.code($$insert into public.month_snapshots (org_id, month, version, data, closed_by, correction_note)
  values (pg_temp.fx('org'), date '2026-10-01', 1, '{}', pg_temp.fx('owner'), 'A note on the first version.')$$), '23514',
  'and carries no note');
select is(pg_temp.code($$insert into public.month_snapshots (org_id, month, version, data, closed_by, correction_note)
  values (pg_temp.fx('org'), date '2026-09-01', 3, '{}', pg_temp.fx('owner'), 'A correction of nothing.')$$), '23514',
  'a later version without corrects_id is refused');
select is(pg_temp.code($$insert into public.month_snapshots (org_id, month, version, data, closed_by, corrects_id)
  values (pg_temp.fx('org'), date '2026-09-01', 3, '{}', pg_temp.fx('owner'), pg_temp.fx('v2'))$$), '23514',
  'a later version without a note is refused');
select is(pg_temp.code($$insert into public.month_snapshots (org_id, month, version, data, closed_by, corrects_id, correction_note)
  values (pg_temp.fx('org'), date '2026-09-01', 3, '{}', pg_temp.fx('owner'), pg_temp.fx('v2'), '123456789')$$), '23514',
  'a note of 9 characters is refused');
select is(pg_temp.code($$insert into public.month_snapshots (org_id, month, version, data, closed_by, corrects_id, correction_note)
  values (pg_temp.fx('org'), date '2026-09-01', 3, '{}', pg_temp.fx('owner'), pg_temp.fx('v2'), '   123456789      ')$$), '23514',
  'spaces around it do not count');
select is(pg_temp.code($$insert into public.month_snapshots (org_id, month, version, data, closed_by, corrects_id, correction_note)
  values (pg_temp.fx('org'), date '2026-09-01', 3, '{}', pg_temp.fx('owner'), pg_temp.fx('v2'), repeat('x', 501))$$), '23514',
  'a note of 501 characters is refused');
select is(pg_temp.code($$insert into public.month_snapshots (org_id, month, version, data, closed_by)
  values (pg_temp.fx('org'), date '2026-10-01', 1, '[1, 2]', pg_temp.fx('owner'))$$), '23514',
  'data that is not an object is refused');
select is(pg_temp.code($$insert into public.month_snapshots (org_id, month, version, data, closed_by)
  values (pg_temp.fx('org'), date '2026-09-01', 1, '{}', pg_temp.fx('owner'))$$), '23505',
  'a second version 1 of a closed month is refused');
select is(pg_temp.code($$insert into public.month_snapshots (org_id, month, version, data, closed_by, corrects_id, correction_note)
  values (pg_temp.fx('org'), date '2026-09-01', 2, '{}', pg_temp.fx('owner'), pg_temp.fx('v1'), 'The same version twice.')$$), '23505',
  'and a second version 2');
select is(pg_temp.code($$insert into public.month_snapshots (org_id, month, version, data)
  values (pg_temp.fx('org'), date '2026-10-01', 1, '{}')$$), '23502',
  'closed_by is required');
-- The bounds themselves are allowed (rolled back by the savepoint, so the three fixture rows stay alone).
savepoint bounds;
select is(pg_temp.code($$insert into public.month_snapshots (org_id, month, version, data, closed_by, corrects_id, correction_note)
  values (pg_temp.fx('org'), date '2026-09-01', 3, '{}', pg_temp.fx('owner'), pg_temp.fx('v2'), '1234567890')$$), 'ok',
  'a note of 10 characters is allowed');
select is(pg_temp.code($$insert into public.month_snapshots (org_id, month, version, data, closed_by, corrects_id, correction_note)
  values (pg_temp.fx('org'), date '2026-09-01', 4, '{}', pg_temp.fx('owner'), pg_temp.fx('v2'), repeat('x', 500))$$), 'ok',
  'and one of 500');
rollback to savepoint bounds;

-- ===========================================================================================================
-- 1. The seal
-- ===========================================================================================================
select ok((select c.relrowsecurity from pg_class c where c.oid = 'public.month_snapshots'::regclass), 'RLS is on');
select is((select array_agg(p.policyname || ':' || p.cmd || ':' || p.roles::text)::text[] from pg_policies p
           where p.schemaname = 'public' and p.tablename = 'month_snapshots'),
  array['month_snapshots_select:SELECT:{authenticated}'],
  'exactly one policy, a select for signed-in members');
select ok((select p.qual like '%finance.view%' and p.qual like '%org_id%' and p.qual not like '%reports.all%' from pg_policies p
           where p.schemaname = 'public' and p.tablename = 'month_snapshots'),
  'and it is finance.view (not reports.all) in the caller''s organization');
select ok(has_table_privilege('authenticated', 'public.month_snapshots', 'select')
          and not has_table_privilege('anon', 'public.month_snapshots', 'select'),
  'authenticated may select (through the policy); anon may not');
select ok((select bool_and(not has_table_privilege(r, 'public.month_snapshots', p))
           from unnest(array['authenticated', 'anon']) r,
                unnest(array['insert', 'update', 'delete', 'truncate', 'references', 'trigger']) p),
  'no API role can insert, update, delete or truncate: UPDATE and DELETE are revoked, not just without a policy');
select ok(not exists (select 1 from pg_publication_tables where tablename = 'month_snapshots'),
  'month_snapshots is in no publication');
select ok(not exists (select 1 from pg_trigger g where g.tgrelid = 'public.month_snapshots'::regclass and not g.tgisinternal),
  'no trigger copies the row: the amounts in data never reach activity_log (the functions of U2 and U3 audit by hand)');
select is((select count(*)::integer from public.activity_log a
           where a.entity = 'month_snapshots' or a.diff::text ~ '6123[45]' or a.meta::text ~ '6123[45]'), 0,
  'writing the three rows left no audit row and no amount in activity_log');
select is((select count(*)::integer from public.notifications n where n.entity = 'month_snapshots'), 0,
  'and no notification');

-- ===========================================================================================================
-- 2. Who reads
-- ===========================================================================================================
select pg_temp.as_member('owner');
select is(pg_temp.n('select 1 from public.month_snapshots'), 2, 'the Owner reads their organization''s two versions');
select results_eq(
  $$select id, version, (data ->> 'total')::integer, corrects_id, correction_note from public.month_snapshots order by version$$,
  $$values (pg_temp.fx('v1'), 1, 61234, null::uuid, null::text),
           (pg_temp.fx('v2'), 2, 61235, pg_temp.fx('v1'), 'One late approval counted.')$$,
  'version 1 as it was closed, and the correction beside it');
select is(pg_temp.n($$select 1 from public.month_snapshots where org_id = pg_temp.fx('org_b')$$), 0,
  'the Owner reads no other organization''s row');
select is(pg_temp.n($$select 1 from public.month_snapshots where id = pg_temp.fx('b_v1')$$), 0, 'not even by its id');

select pg_temp.as_member('b_owner');
select is(pg_temp.n('select 1 from public.month_snapshots'), 1, 'another organization''s Owner reads their own row');
select is(pg_temp.n($$select 1 from public.month_snapshots where org_id = pg_temp.fx('org')$$), 0, 'and none of this one''s');

select pg_temp.as_member('admin');
select is(pg_temp.n('select 1 from public.month_snapshots'), 0, 'an Admin reads no row');
select is(pg_temp.n($$select 1 from public.month_snapshots where id = pg_temp.fx('v1')$$), 0, 'not even by its id');
select pg_temp.as_member('staff');
select is(pg_temp.n('select 1 from public.month_snapshots'), 0, 'Crew read no row');
select pg_temp.as_member('free');
select is(pg_temp.n('select 1 from public.month_snapshots'), 0, 'a freelancer reads no row');
select pg_temp.as_member('gone');
select is(pg_temp.n('select 1 from public.month_snapshots'), 0, 'a deactivated member reads no row');
select pg_temp.as_anon();
select is(pg_temp.n('select 1 from public.month_snapshots'), -1, 'anon has no privilege on the table');

-- A deactivated Owner's sign-in reads nothing either (the role alone is not enough).
select pg_temp.as_system();
update public.members set status = 'deactivated', deactivated_at = now() where id = pg_temp.fx('b_owner');
select pg_temp.as_member('b_owner');
select is(pg_temp.n('select 1 from public.month_snapshots'), 0, 'a deactivated Owner reads no row');

-- ===========================================================================================================
-- 3. Who writes: nobody through the API
-- ===========================================================================================================
create temporary table who (k text primary key);
insert into who values ('owner'), ('admin'), ('staff'), ('free'), ('gone');
grant select on who to authenticated, anon;
create temporary table writes (w text primary key);
insert into writes values
  ($$insert into public.month_snapshots (org_id, month, version, data, closed_by)
     values (pg_temp.fx('org'), date '2026-10-01', 1, '{}', pg_temp.fx('owner'))$$),
  ($$update public.month_snapshots set data = '{}'$$),
  ($$update public.month_snapshots set correction_note = 'A hand edit of the note.' where id = pg_temp.fx('v2')$$),
  ($$delete from public.month_snapshots$$),
  ($$truncate public.month_snapshots$$);
grant select on writes to authenticated, anon;
create function pg_temp.writes_as(k text) returns text language plpgsql as $$
declare v text;
begin
  perform pg_temp.as_member(k);
  select string_agg(distinct pg_temp.code(w), ',') into v from writes;
  return v;
end;
$$;

select pg_temp.as_system();
select is(pg_temp.writes_as('owner'), 'NO_PRIVILEGE', 'the Owner cannot insert, update, delete or truncate directly');
select is(pg_temp.writes_as('admin'), 'NO_PRIVILEGE', 'nor an Admin');
select is(pg_temp.writes_as('staff'), 'NO_PRIVILEGE', 'nor Crew');
select is(pg_temp.writes_as('free'), 'NO_PRIVILEGE', 'nor a freelancer');
select is(pg_temp.writes_as('gone'), 'NO_PRIVILEGE', 'nor a deactivated member');
select pg_temp.as_anon();
select is((select string_agg(distinct pg_temp.code(w), ',') from writes), 'NO_PRIVILEGE', 'nor anon');
select pg_temp.as_member('owner');
select throws_ok($$update public.month_snapshots set data = '{}' where id = pg_temp.fx('v1')$$, '42501', null,
  'the Owner''s update of version 1 is a permission error, not a silent zero rows');
select throws_ok($$delete from public.month_snapshots where id = pg_temp.fx('v1')$$, '42501', null,
  'and so is the delete');
select throws_ok($$insert into public.month_snapshots (org_id, month, version, data, closed_by)
  values (pg_temp.fx('org'), date '2026-10-01', 1, '{}', pg_temp.fx('owner'))$$, '42501', null,
  'and the insert');

select pg_temp.as_system();
select is((select count(*)::integer from public.month_snapshots), 3, 'after all of that the three rows are still there');
select is((select data::text from public.month_snapshots where id = pg_temp.fx('v1')), '{"total": 61234, "schema": 1}',
  'and version 1 is as it was written');

-- Nobody but the Owner meets the amount anywhere they can read.
create function pg_temp.amount_seen(k text) returns integer language plpgsql as $$
declare v integer;
begin
  perform pg_temp.as_member(k);
  select (select count(*) from public.activity_log a where a.entity = 'month_snapshots' or a.diff::text ~ '6123[45]' or a.meta::text ~ '6123[45]')
       + (select count(*) from public.notifications n where n.payload::text ~ '6123[45]')
    into v;
  return v;
end;
$$;
select is(pg_temp.amount_seen('admin'), 0, 'an Admin meets the snapshot in no history or notification row');
select is(pg_temp.amount_seen('staff'), 0, 'nor Crew');

select * from finish();
rollback;
