-- v3.5 "Month close", after the v2.5 merge (migration v35_revenue_read_after_v25; WORKFLOWS §7.4; the
-- advisor's should-fix 2, 26 Nov 2026): public.month_snapshots_read(month), the Revenue page's light read of an
-- ended month, with the organization's first priced month so the page hides "Close month" before it.
--   0. the function: security definer, empty search_path, jsonb; authenticated may call it, anon and PUBLIC not;
--   1. the answer's keys; the first priced month before it, at it and after it; any date of the month; no month;
--   2. a closed month: its versions (number, closed_at) oldest first, and only the latest version's schema and
--      revenue section (never its expense totals, month summary or note), after a correction too;
--   3. who reads it: the Owner only (Admin, Crew, a freelancer, a deactivated member, no sign-in refused with one
--      wording; anon has no privilege); another organization's Owner sees their own (nothing priced, no version);
--   4. revenue_month_read is v2.5's again (billed_on, adjusted, a one-time line's cycle_id), with v3.5's
--      billing_status.
-- Every name here is neutral.
begin;
create extension if not exists pgtap with schema extensions;
select plan(32);

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
create function pg_temp.keys(j jsonb) returns text[] language sql immutable as $$
  select array_agg(k order by k) from jsonb_object_keys(j) k;
$$;
delete from public.holidays;

create temporary table fx (key text primary key, id uuid not null);
insert into fx values
  ('owner',    '00000000-0000-4000-8000-000000169901'),
  ('admin',    '00000000-0000-4000-8000-000000169902'),
  ('staff',    '00000000-0000-4000-8000-000000169903'),
  ('free',     '00000000-0000-4000-8000-000000169904'),
  ('gone',     '00000000-0000-4000-8000-000000169905'),
  ('org_b',    '00000000-0000-4000-8000-000000169910'),
  ('b_owner',  '00000000-0000-4000-8000-000000169911'),
  ('client',   '00000000-0000-4000-8000-0000001699c1');
insert into fx select 'org', id from public.organizations limit 1;
grant select, insert on fx to authenticated, anon, service_role;

-- The months, from the real IST date: this month (m0) and four before it.
create temporary table mo (key text primary key, d date not null);
insert into mo values ('m0', app.month_start(app.today_ist()));
insert into mo values ('m1', app.month_start((select d from mo where key = 'm0') - 1));
insert into mo values ('m2', app.month_start((select d from mo where key = 'm1') - 1));
insert into mo values ('m3', app.month_start((select d from mo where key = 'm2') - 1));
insert into mo values ('m4', app.month_start((select d from mo where key = 'm3') - 1));
grant select on mo to authenticated, anon, service_role;

create function pg_temp.fx(k text) returns uuid language sql stable as $$
  select id from fx where key = k;
$$;
create function pg_temp.mo(k text) returns date language sql stable as $$
  select d from mo where key = k;
$$;
-- An instant: day `n` (1-based) of this month at an IST time.
create function pg_temp.at(n int, t text) returns timestamptz language sql stable as $$
  select ((pg_temp.mo('m0') + (n - 1))::text || ' ' || t || '+05:30')::timestamptz;
$$;
create function pg_temp.now_at(n int, t text) returns void language sql as $$
  select set_config('app.test_now', pg_temp.at(n, t)::text, true);
$$;
-- The month's word as the reminder says it on day 6 of this month (the year only when it is not today's).
create function pg_temp.word(k text) returns text language sql stable as $$
  select to_char(pg_temp.mo(k), 'FMMonth')
    || case when extract(year from pg_temp.mo(k)) <> extract(year from pg_temp.mo('m0') + 5)
            then to_char(pg_temp.mo(k), ' YYYY') else '' end;
$$;
create function pg_temp.as_member(k text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', pg_temp.fx(k)::text, true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', pg_temp.fx(k), 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end;
$$;
create function pg_temp.as_owner_inside(k text) returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claim.sub', pg_temp.fx(k)::text, true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', pg_temp.fx(k), 'role', 'authenticated')::text, true);
end;
$$;
create function pg_temp.as_system() returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', '', true);
end;
$$;
create function pg_temp.as_nobody() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', json_build_object('role', 'authenticated')::text, true);
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
create function pg_temp.err(sql text) returns text language plpgsql as $$
declare
  v_detail text;
begin
  execute sql;
  return 'ok';
exception
  when sqlstate 'P0001' then
    get stacked diagnostics v_detail = pg_exception_detail;
    return sqlerrm || coalesce(': ' || nullif(v_detail, ''), '');
  when insufficient_privilege then return 'NO_PRIVILEGE';
end;
$$;
-- The Owner's reminder now (as the Owner; the caller's role is restored by the next as_*).
create function pg_temp.reminder() returns jsonb language sql as $$
  select public.month_close_reminder();
$$;

-- People: org A (the seed's organization) and org B.
insert into public.organizations (id, name) values (pg_temp.fx('org_b'), 'Other org 169');
insert into auth.users (id, email)
select id, key || '-169@example.com' from fx where key in ('owner', 'admin', 'staff', 'free', 'gone', 'b_owner');
insert into public.members (id, org_id, full_name, email, role, status, engagement, joined_at, deactivated_at) values
  (pg_temp.fx('owner'),   pg_temp.fx('org'),   'Test Owner',  'owner-169@example.com',   'owner', 'active',      'permanent', now() - interval '200 days', null),
  (pg_temp.fx('admin'),   pg_temp.fx('org'),   'Test Admin',  'admin-169@example.com',   'admin', 'active',      'permanent', now(), null),
  (pg_temp.fx('staff'),   pg_temp.fx('org'),   'Test Crew',   'staff-169@example.com',   'staff', 'active',      'permanent', now() - interval '200 days', null),
  (pg_temp.fx('free'),    pg_temp.fx('org'),   'Test Free',   null,                      'staff', 'active',      'freelance', now(), null),
  (pg_temp.fx('gone'),    pg_temp.fx('org'),   'Test Gone',   'gone-169@example.com',    'admin', 'deactivated', 'permanent', now() - interval '9 days', now()),
  (pg_temp.fx('b_owner'), pg_temp.fx('org_b'), 'Other Owner', 'b_owner-169@example.com', 'owner', 'active',      'permanent', now(), null);
select pg_temp.as_owner_inside('owner');
insert into public.clients (id, org_id, name, state, admin_id, activated_at) values
  (pg_temp.fx('client'), pg_temp.fx('org'), 'Client 169', 'active', pg_temp.fx('admin'), now());

-- Org A's money: a monthly retainer with no deliverables (so the digest has no client work to count), its
-- cycles of m1..m4; m3 priced at 7,777 and m1 at 8,888, m2 and m4 with no amount. So the first priced month
-- is m3: m4 is before it, m2 is after it (in the reminder though unpriced).
select pg_temp.as_member('admin');
insert into fx values ('p', public.project_create(pg_temp.fx('client'), 'Monthly 169', 'monthly', null, null,
  array['Stage 1'], array[]::text[]));
select pg_temp.as_member('owner');
select public.billing_set_project(pg_temp.fx('p'), 9000, true, null);
select pg_temp.as_system();
insert into fx select 'c' || k, (app.cycle_create((select p from public.projects p where p.id = pg_temp.fx('p')),
  pg_temp.mo('m' || k), 'schedule', null, true)).id
from generate_series(1, 4) k;
select pg_temp.as_member('owner');
select public.billing_set_cycle_amount(pg_temp.fx('c3'), 7777);
select public.billing_set_cycle_amount(pg_temp.fx('c1'), 8888);
select pg_temp.as_system();


-- A one-time project of org A, priced and due this month (m0), so the revenue read has a one-time line there
-- (it does not move the first priced month, m3).
select pg_temp.as_member('admin');
insert into fx values ('one', public.project_create(pg_temp.fx('client'), 'Film 169', 'one_time', null,
  pg_temp.mo('m0') + 1, array['Stage 1'], array['Cut']));
select pg_temp.as_member('owner');
select public.billing_set_project(pg_temp.fx('one'), 5000, true, null);

-- ===========================================================================================================
-- 0. The function
-- ===========================================================================================================
select pg_temp.as_system();
select has_function('public', 'month_snapshots_read', array['date'], 'month_snapshots_read(date) exists');
select ok((select p.prosecdef and p.proconfig @> array['search_path=""'] and p.prorettype = 'jsonb'::regtype
           from pg_proc p where p.oid = 'public.month_snapshots_read(date)'::regprocedure),
  'month_snapshots_read: security definer, empty search_path, returns jsonb');
select ok(has_function_privilege('authenticated', 'public.month_snapshots_read(date)', 'execute')
          and not has_function_privilege('anon', 'public.month_snapshots_read(date)', 'execute'),
  'month_snapshots_read: authenticated may call it, anon may not');
select is_empty(
  $$ select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
     where p.oid = 'public.month_snapshots_read(date)'::regprocedure and a.grantee = 0 $$,
  'month_snapshots_read: PUBLIC holds no execute');

-- ===========================================================================================================
-- 1. The first priced month (m3: m4 is before it, m2 after it)
-- ===========================================================================================================
select pg_temp.as_member('owner');
select is(pg_temp.keys(public.month_snapshots_read(pg_temp.mo('m4'))),
  array['first_priced_month', 'latest', 'month', 'versions'],
  'the answer holds the month, the first priced month, the versions and the latest version, nothing else');
select is((public.month_snapshots_read(pg_temp.mo('m4')) ->> 'first_priced_month')::date, pg_temp.mo('m3'),
  'a month before the first priced month: the first priced month is m3');
select is(public.month_snapshots_read(pg_temp.mo('m4')) -> 'versions', '[]'::jsonb,
  'a month not closed has no version');
select ok(public.month_snapshots_read(pg_temp.mo('m4')) -> 'latest' = 'null'::jsonb,
  'a month not closed has no latest version');
select is((public.month_snapshots_read(pg_temp.mo('m2')) ->> 'first_priced_month')::date, pg_temp.mo('m3'),
  'an unpriced month after the first priced month: the same first priced month');
select is((public.month_snapshots_read(pg_temp.mo('m3')) ->> 'first_priced_month')::date, pg_temp.mo('m3'),
  'the first priced month itself');
select is((public.month_snapshots_read(pg_temp.mo('m3') + 17) ->> 'month')::date, pg_temp.mo('m3'),
  'any date of the month reads that month');
select is(pg_temp.err('select public.month_snapshots_read(null)'), 'VALIDATION: Pick a month.',
  'no month: "Pick a month."');

-- ===========================================================================================================
-- 2. A closed month
-- ===========================================================================================================
select is(public.month_close(pg_temp.mo('m3')), 1, 'the Owner closes m3');
select is(jsonb_array_length(public.month_snapshots_read(pg_temp.mo('m3')) -> 'versions'), 1, 'm3 has one version');
select is(public.month_snapshots_read(pg_temp.mo('m3')) -> 'versions' -> 0,
  (select jsonb_build_object('version', s.version, 'closed_at', s.closed_at)
   from public.month_snapshots s where s.month = pg_temp.mo('m3') and s.version = 1),
  'the version is its number and closed_at');
select is(pg_temp.keys(public.month_snapshots_read(pg_temp.mo('m3')) -> 'latest'), array['revenue', 'schema'],
  'the latest version: its schema and revenue section only (no expense totals, month summary or note)');
select is(public.month_snapshots_read(pg_temp.mo('m3')) -> 'latest',
  (select jsonb_build_object('schema', s.data -> 'schema', 'revenue', s.data -> 'revenue')
   from public.month_snapshots s where s.month = pg_temp.mo('m3') and s.version = 1),
  'the latest version''s schema and revenue section, as stored');
select is(public.month_snapshots_read(pg_temp.mo('m4')) -> 'versions', '[]'::jsonb,
  'another month is not touched by the close');

-- A correction: v2 is the latest; both versions are listed, oldest first.
select public.billing_set_cycle_amount(pg_temp.fx('c3'), 7000);
select is(public.month_correct(pg_temp.mo('m3'), 'The amount was agreed lower.'), 2, 'the Owner corrects m3');
select is(array(select (v ->> 'version')::int
                from jsonb_array_elements(public.month_snapshots_read(pg_temp.mo('m3')) -> 'versions') v),
  array[1, 2], 'both versions, oldest first');
select is(public.month_snapshots_read(pg_temp.mo('m3')) -> 'latest',
  (select jsonb_build_object('schema', s.data -> 'schema', 'revenue', s.data -> 'revenue')
   from public.month_snapshots s where s.month = pg_temp.mo('m3') and s.version = 2),
  'the latest is version 2''s revenue section');

-- ===========================================================================================================
-- 3. Who reads it
-- ===========================================================================================================
select pg_temp.as_member('admin');
select is(pg_temp.err(format('select public.month_snapshots_read(%L)', pg_temp.mo('m3'))),
  'FORBIDDEN: Only the Owner sees which months are closed.', 'the client''s Admin is refused');
select pg_temp.as_member('staff');
select is(pg_temp.err(format('select public.month_snapshots_read(%L)', pg_temp.mo('m3'))),
  'FORBIDDEN: Only the Owner sees which months are closed.', 'Crew are refused');
select pg_temp.as_member('free');
select is(pg_temp.err(format('select public.month_snapshots_read(%L)', pg_temp.mo('m3'))),
  'FORBIDDEN: Only the Owner sees which months are closed.', 'a freelancer is refused');
select pg_temp.as_member('gone');
select is(pg_temp.err(format('select public.month_snapshots_read(%L)', pg_temp.mo('m3'))),
  'FORBIDDEN: Only the Owner sees which months are closed.', 'a deactivated member is refused');
select pg_temp.as_nobody();
select is(pg_temp.err(format('select public.month_snapshots_read(%L)', pg_temp.mo('m3'))),
  'FORBIDDEN: Only the Owner sees which months are closed.', 'no sign-in is refused');
select pg_temp.as_anon();
select is(pg_temp.err(format('select public.month_snapshots_read(%L)', pg_temp.mo('m3'))), 'NO_PRIVILEGE',
  'anon cannot call it');
select pg_temp.as_member('b_owner');
select is(public.month_snapshots_read(pg_temp.mo('m3')) -> 'versions', '[]'::jsonb,
  'another organization''s Owner sees none of org A''s versions');
select ok(public.month_snapshots_read(pg_temp.mo('m3')) -> 'first_priced_month' = 'null'::jsonb,
  'another organization with nothing priced has no first priced month');

-- ===========================================================================================================
-- 4. revenue_month_read: v2.5's keys with v3.5's billing_status
-- ===========================================================================================================
select pg_temp.as_member('owner');
select is(pg_temp.keys((select c from jsonb_array_elements(public.revenue_month_read(pg_temp.mo('m3')) -> 'cycles') c limit 1))
          @> array['adjusted', 'billed_on', 'billing_status'], true,
  'a cycle line has billing_status, billed_on and adjusted');
select is(pg_temp.keys((select l from jsonb_array_elements(public.revenue_month_read(pg_temp.mo('m0')) -> 'projects') l limit 1))
          @> array['adjusted', 'billed_on', 'billing_status', 'cycle_id'], true,
  'a one-time line has cycle_id, billing_status, billed_on and adjusted');
select is((select c ->> 'billing_status' from jsonb_array_elements(public.revenue_month_read(pg_temp.mo('m3')) -> 'cycles') c
           where (c ->> 'cycle_id')::uuid = pg_temp.fx('c3')),
  (select c.billing_status::text from app.revenue_cycles(array[pg_temp.fx('c3')]) c),
  'billing_status is app.revenue_cycles'' value, as v3.5 read it');

select * from finish();
rollback;
