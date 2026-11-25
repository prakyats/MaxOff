-- v3.5 "Month close", U2 (migration v35_month_close; WORKFLOWS §7.1 and §7.4; DATA-MODEL §9a): the builder
-- app.month_snapshot_build, app.first_priced_month and month_close(month).
--   0. the functions: definer and search_path, who may execute (the builder and the helper never authenticated);
--   1. who closes: the Owner only (Admin, Crew, a freelancer, a deactivated member, no sign-in, anon refused);
--   2. which month: not the current or a later one, not before the first priced month, not with nothing priced,
--      not twice; any date of a month closes that month; ₹0 counts as priced;
--   3. what is stored: version 1, schema 1, the keys, the fixture's figures, the same document as a fresh build;
--   4. the history: exactly one entry, month and version only, no amount; an Admin reads none; nobody notified;
--   5. another organization's data never enters the snapshot;
--   6. the IST month boundary at explicit instants: a month that ended yesterday IST is closable.
-- Every name here is neutral.
begin;
create extension if not exists pgtap with schema extensions;
select plan(68);

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
  ('owner',    '00000000-0000-4000-8000-000000161901'),
  ('admin',    '00000000-0000-4000-8000-000000161902'),
  ('staff',    '00000000-0000-4000-8000-000000161903'),
  ('free',     '00000000-0000-4000-8000-000000161904'),
  ('gone',     '00000000-0000-4000-8000-000000161905'),
  ('org_b',    '00000000-0000-4000-8000-000000161910'),
  ('b_owner',  '00000000-0000-4000-8000-000000161911'),
  ('b_admin',  '00000000-0000-4000-8000-000000161912'),
  ('client',   '00000000-0000-4000-8000-0000001619c1'),
  ('b_client', '00000000-0000-4000-8000-0000001619c2');
insert into fx select 'org', id from public.organizations limit 1;
grant select, insert on fx to authenticated, anon, service_role;

-- The months, from the real IST date: this month, last month, the month before.
create temporary table mo (key text primary key, d date not null);
insert into mo values ('m0', app.month_start(app.today_ist()));
insert into mo values ('m1', app.month_start((select d from mo where key = 'm0') - 1));
insert into mo values ('m2', app.month_start((select d from mo where key = 'm1') - 1));
grant select on mo to authenticated, anon, service_role;

create function pg_temp.fx(k text) returns uuid language sql stable as $$
  select id from fx where key = k;
$$;
create function pg_temp.mo(k text) returns date language sql stable as $$
  select d from mo where key = k;
$$;
create function pg_temp.name(k text) returns text language sql stable as $$
  select to_char(pg_temp.mo(k), 'FMMonth YYYY');
$$;
create function pg_temp.as_member(k text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', pg_temp.fx(k)::text, true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', pg_temp.fx(k), 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end;
$$;
-- The Owner's sign-in on the database's own role: what month_close itself runs as (security definer), so
-- the internal builder and helper can be asked directly and compared.
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
-- How a call ends: 'ok', NO_PRIVILEGE, or "CODE: the reason".
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
-- The snapshot of a month (the latest version), read as the database.
create function pg_temp.snap(p_org uuid, k text) returns public.month_snapshots language sql stable as $$
  select s from public.month_snapshots s where s.org_id = p_org and s.month = pg_temp.mo(k) order by s.version desc limit 1;
$$;
create function pg_temp.keys(j jsonb) returns text[] language sql immutable as $$
  select array_agg(k order by k) from jsonb_object_keys(j) k;
$$;

-- People: org A (the seed's organization) and org B.
insert into public.organizations (id, name) values (pg_temp.fx('org_b'), 'Other org 161');
insert into auth.users (id, email)
select id, key || '-161@example.com' from fx where key in ('owner', 'admin', 'staff', 'free', 'gone', 'b_owner', 'b_admin');
insert into public.members (id, org_id, full_name, email, role, status, engagement, joined_at, deactivated_at) values
  (pg_temp.fx('owner'),   pg_temp.fx('org'),   'Test Owner',  'owner-161@example.com',   'owner', 'active',      'permanent', now() - interval '120 days', null),
  (pg_temp.fx('admin'),   pg_temp.fx('org'),   'Test Admin',  'admin-161@example.com',   'admin', 'active',      'permanent', now(), null),
  (pg_temp.fx('staff'),   pg_temp.fx('org'),   'Test Crew',   'staff-161@example.com',   'staff', 'active',      'permanent', now() - interval '120 days', null),
  (pg_temp.fx('free'),    pg_temp.fx('org'),   'Test Free',   null,                      'staff', 'active',      'freelance', now(), null),
  (pg_temp.fx('gone'),    pg_temp.fx('org'),   'Test Gone',   'gone-161@example.com',    'admin', 'deactivated', 'permanent', now() - interval '9 days', now()),
  (pg_temp.fx('b_owner'), pg_temp.fx('org_b'), 'Other Owner', 'b_owner-161@example.com', 'owner', 'active',      'permanent', now(), null),
  (pg_temp.fx('b_admin'), pg_temp.fx('org_b'), 'Other Admin', 'b_admin-161@example.com', 'admin', 'active',      'permanent', now(), null);
-- Each client written under its own Owner's sign-in (the audit trigger takes the writer's organization).
select pg_temp.as_owner_inside('owner');
insert into public.clients (id, org_id, name, state, admin_id, activated_at) values
  (pg_temp.fx('client'),   pg_temp.fx('org'),   'Client 161',       'active', pg_temp.fx('admin'),   now());
select pg_temp.as_owner_inside('b_owner');
insert into public.clients (id, org_id, name, state, admin_id, activated_at) values
  (pg_temp.fx('b_client'), pg_temp.fx('org_b'), 'Other client 161', 'active', pg_temp.fx('b_admin'), now());

-- Org A's money. A monthly retainer: this month's cycle at 9,000 (priced_from = this month); last month's
-- cycle priced alone at 6,000, A done (3,000 calculated), adjusted to 3,500, billed; the month before has a
-- cycle with no amount. A one-time project at 20,000 sitting in a later month, with a 5,000 advance received
-- last month.
select pg_temp.as_member('admin');
insert into fx values ('p', public.project_create(pg_temp.fx('client'), 'Monthly 161', 'monthly', null, null,
  array['Stage 1'], array['A', 'B']));
insert into fx values ('ot', public.project_create(pg_temp.fx('client'), 'Film 161', 'one_time', null,
  app.month_start(pg_temp.mo('m0') + 40) + 4, array['Stage 1'], array['Cut']));
select pg_temp.as_member('owner');
select public.billing_set_project(pg_temp.fx('p'), 9000, true, null);
select public.billing_set_project(pg_temp.fx('ot'), 20000, true, null);
select pg_temp.as_system();
insert into fx select 'past', (app.cycle_create((select p from public.projects p where p.id = pg_temp.fx('p')),
  pg_temp.mo('m1'), 'schedule', null, true)).id;
insert into fx select 'older', (app.cycle_create((select p from public.projects p where p.id = pg_temp.fx('p')),
  pg_temp.mo('m2'), 'schedule', null, true)).id;
insert into fx select 'item_a', i.id from public.project_items i where i.cycle_id = pg_temp.fx('past') and i.title = 'A';
insert into fx select 'item_b', i.id from public.project_items i where i.cycle_id = pg_temp.fx('past') and i.title = 'B';
select pg_temp.as_member('owner');
select public.billing_set_cycle_amount(pg_temp.fx('past'), 6000);
select public.advance_record(pg_temp.fx('ot'), 5000, pg_temp.mo('m1') + 2, 'Advance');
select pg_temp.as_member('admin');
select public.item_mark_done(pg_temp.fx('item_a'));
select pg_temp.as_member('owner');
select public.revenue_override_set('cycle', pg_temp.fx('past'), 3500, 'Agreed with the client.');
select public.billing_mark(array[pg_temp.fx('past')], true, pg_temp.mo('m1') + 20, 'Invoice 161');

-- Expense claims of last month: 700 approved (not paid), 300 paid; a submitted one and one of this month
-- do not count. Written under the Owner's sign-in (the audit trigger takes the writer's organization).
select pg_temp.as_owner_inside('owner');
insert into public.expense_claims (member_id, expense_date, amount, category_id, note, state, decided_by, decided_at, paid_on, paid_by, paid_at) values
  (pg_temp.fx('staff'), pg_temp.mo('m1') + 1, 700, (select id from public.list_items where list_key = 'expense_category' limit 1), 'Taxi', 'approved', pg_temp.fx('owner'), now(), null, null, null),
  (pg_temp.fx('staff'), pg_temp.mo('m1') + 2, 300, (select id from public.list_items where list_key = 'expense_category' limit 1), 'Lunch', 'paid', pg_temp.fx('owner'), now(), pg_temp.mo('m1') + 3, pg_temp.fx('owner'), now()),
  (pg_temp.fx('staff'), pg_temp.mo('m1') + 2, 50, (select id from public.list_items where list_key = 'expense_category' limit 1), 'Tea', 'submitted', null, null, null, null, null),
  (pg_temp.fx('staff'), pg_temp.mo('m0'), 999, (select id from public.list_items where list_key = 'expense_category' limit 1), 'Cab', 'approved', pg_temp.fx('owner'), now(), null, null, null);

-- Org B: a retainer with nothing priced yet.
select pg_temp.as_member('b_admin');
insert into fx values ('bp', public.project_create(pg_temp.fx('b_client'), 'Other monthly 161', 'monthly', null, null,
  array['Stage 1'], array['X']));
select pg_temp.as_system();
insert into fx select 'b_past', (app.cycle_create((select p from public.projects p where p.id = pg_temp.fx('bp')),
  pg_temp.mo('m1'), 'schedule', null, true)).id;
insert into fx select 'b_older', (app.cycle_create((select p from public.projects p where p.id = pg_temp.fx('bp')),
  pg_temp.mo('m2'), 'schedule', null, true)).id;

-- ===========================================================================================================
-- 0. The functions
-- ===========================================================================================================
select has_function('public', 'month_close', array['date'], 'month_close(month date) exists');
select ok((select p.prosecdef and p.proconfig @> array['search_path=""'] and p.prorettype = 'integer'::regtype
           from pg_proc p where p.oid = 'public.month_close(date)'::regprocedure),
  'month_close: security definer, empty search_path, returns an integer');
select ok(has_function_privilege('authenticated', 'public.month_close(date)', 'execute')
          and not has_function_privilege('anon', 'public.month_close(date)', 'execute'),
  'month_close: authenticated may call it, anon may not');
select ok(not has_function_privilege('authenticated', 'app.month_snapshot_build(uuid, date)', 'execute')
          and not has_function_privilege('anon', 'app.month_snapshot_build(uuid, date)', 'execute'),
  'the builder: never authenticated or anon');
select ok(not has_function_privilege('authenticated', 'app.first_priced_month(uuid)', 'execute')
          and not has_function_privilege('anon', 'app.first_priced_month(uuid)', 'execute'),
  'the first priced month: never authenticated or anon');
select ok((select p.proconfig @> array['search_path=""'] from pg_proc p where p.oid = 'app.month_snapshot_build(uuid, date)'::regprocedure)
          and (select p.proconfig @> array['search_path=""'] from pg_proc p where p.oid = 'app.first_priced_month(uuid)'::regprocedure),
  'both with an empty search_path');

-- ===========================================================================================================
-- 1. Who closes
-- ===========================================================================================================
select pg_temp.as_member('admin');
select is(pg_temp.err(format('select public.month_close(%L)', pg_temp.mo('m1'))), 'FORBIDDEN: Only the Owner closes a month.', 'the client''s Admin is refused');
select pg_temp.as_member('staff');
select is(pg_temp.err(format('select public.month_close(%L)', pg_temp.mo('m1'))), 'FORBIDDEN: Only the Owner closes a month.', 'Crew are refused');
select pg_temp.as_member('free');
select is(pg_temp.err(format('select public.month_close(%L)', pg_temp.mo('m1'))), 'FORBIDDEN: Only the Owner closes a month.', 'a freelancer is refused');
select pg_temp.as_member('gone');
select is(pg_temp.err(format('select public.month_close(%L)', pg_temp.mo('m1'))), 'FORBIDDEN: Only the Owner closes a month.', 'a deactivated member is refused');
select pg_temp.as_nobody();
select is(pg_temp.err(format('select public.month_close(%L)', pg_temp.mo('m1'))), 'FORBIDDEN: Only the Owner closes a month.', 'no sign-in is refused');
select pg_temp.as_anon();
select is(pg_temp.err(format('select public.month_close(%L)', pg_temp.mo('m1'))), 'NO_PRIVILEGE', 'anon has no privilege');
select pg_temp.as_member('owner');
select is(pg_temp.err(format('select app.month_snapshot_build(%L, %L)', pg_temp.fx('org'), pg_temp.mo('m1'))), 'NO_PRIVILEGE',
  'the Owner cannot call the builder through the API');
select is(pg_temp.err(format('select app.first_priced_month(%L)', pg_temp.fx('org'))), 'NO_PRIVILEGE',
  'nor the first priced month');
select pg_temp.as_system();
select is((select count(*)::integer from public.month_snapshots), 0, 'nothing was stored by a refusal');

-- The builder builds only for an Owner of the organization asked for.
select pg_temp.as_owner_inside('b_owner');
select is(pg_temp.err(format('select app.month_snapshot_build(%L, %L)', pg_temp.fx('org'), pg_temp.mo('m1'))),
  'FORBIDDEN: Only the Owner closes a month.', 'the builder refuses another organization''s Owner');
select pg_temp.as_owner_inside('admin');
select is(pg_temp.err(format('select app.month_snapshot_build(%L, %L)', pg_temp.fx('org'), pg_temp.mo('m1'))),
  'FORBIDDEN: Only the Owner closes a month.', 'and an Admin of the organization');

-- ===========================================================================================================
-- 2. Which month
-- ===========================================================================================================
select pg_temp.as_owner_inside('owner');
select is(app.first_priced_month(pg_temp.fx('org')), pg_temp.mo('m1'), 'org A''s first priced month is last month (a cycle priced alone)');
select is(app.first_priced_month(pg_temp.fx('org')),
  (select min(x.month) from (
     select c.month from public.revenue_by_cycle_v c where c.org_id = pg_temp.fx('org') and c.amount is not null
     union all
     select l.month from public.revenue_project_lines_v l where l.org_id = pg_temp.fx('org') and l.amount is not null) x),
  'the same month the Owner''s revenue views give');
select is(app.first_priced_month(pg_temp.fx('org_b')), null, 'org B has no priced month');

select pg_temp.as_member('owner');
select is(pg_temp.err(format('select public.month_close(%L)', pg_temp.mo('m0'))),
  'VALIDATION: ' || pg_temp.name('m0') || ' hasn''t ended yet.', 'the current IST month is refused');
select is(pg_temp.err(format('select public.month_close(%L)', app.today_ist())),
  'VALIDATION: ' || pg_temp.name('m0') || ' hasn''t ended yet.', 'by any of its dates, today included');
select is(pg_temp.err(format('select public.month_close(%L)', app.month_start(pg_temp.mo('m0') + 40))),
  'VALIDATION: ' || to_char(app.month_start(pg_temp.mo('m0') + 40), 'FMMonth YYYY') || ' hasn''t ended yet.',
  'a later month is refused, even one with a priced line');
select is(pg_temp.err(format('select public.month_close(%L)', pg_temp.mo('m2'))), 'VALIDATION: Nothing to close.',
  'a month before the first priced month is refused (it has a cycle, with no amount)');
select is(pg_temp.err(format('select public.month_close(%L)', pg_temp.mo('m2') - 400)), 'VALIDATION: Nothing to close.',
  'and a month long before');
select is(pg_temp.err('select public.month_close(null)'), 'VALIDATION: Pick a month.', 'no month is refused');
select pg_temp.as_member('b_owner');
select is(pg_temp.err(format('select public.month_close(%L)', pg_temp.mo('m1'))), 'VALIDATION: Nothing to close.',
  'with no priced month at all, nothing can be closed');
select pg_temp.as_system();
select is((select count(*)::integer from public.month_snapshots), 0, 'still nothing stored');

-- The close. Any date of the month closes the month (WORKFLOWS §7.4: "work on its 1st").
create temporary table counts (key text primary key, n integer not null);
insert into counts select 'notifications', count(*) from public.notifications;
select pg_temp.as_member('owner');
select is(public.month_close(pg_temp.mo('m1') + 14), 1, 'the Owner closes last month (by its 15th): version 1');
select is(pg_temp.err(format('select public.month_close(%L)', pg_temp.mo('m1'))),
  'INVALID_STATE: ' || pg_temp.name('m1') || ' is already closed.', 'a second close is refused');
select is(pg_temp.err(format('select public.month_close(%L)', pg_temp.mo('m1') + 27)),
  'INVALID_STATE: ' || pg_temp.name('m1') || ' is already closed.', 'by any of its dates');

-- ===========================================================================================================
-- 3. What is stored
-- ===========================================================================================================
select pg_temp.as_system();
select is((select count(*)::integer from public.month_snapshots where org_id = pg_temp.fx('org')), 1, 'one row for org A');
select ok((select s.version = 1 and s.month = pg_temp.mo('m1') and s.closed_by = pg_temp.fx('owner')
                  and s.corrects_id is null and s.correction_note is null and s.closed_at = now()
           from public.month_snapshots s where s.org_id = pg_temp.fx('org')),
  'version 1 of the month''s 1st, closed by the Owner now, correcting nothing');
select is((pg_temp.snap(pg_temp.fx('org'), 'm1')).data -> 'schema', '1'::jsonb, 'data.schema is 1');
select is(pg_temp.keys((pg_temp.snap(pg_temp.fx('org'), 'm1')).data),
  array['expenses', 'month', 'month_summary', 'revenue', 'schema'], 'the document''s keys (no people or client work yet)');
select is((pg_temp.snap(pg_temp.fx('org'), 'm1')).data ->> 'month', pg_temp.mo('m1')::text, 'data.month is the 1st');
select is(pg_temp.keys((pg_temp.snap(pg_temp.fx('org'), 'm1')).data -> 'revenue'),
  array['advances', 'cycles', 'projects', 'totals'], 'revenue: cycles, projects, advances, totals');
select is(pg_temp.keys((pg_temp.snap(pg_temp.fx('org'), 'm1')).data #> '{revenue,totals}'),
  array['achieved', 'advances_received', 'advances_returned', 'by_category', 'by_client', 'closed_not_achieved', 'potential', 'remaining'],
  'the totals'' keys');
select is(((pg_temp.snap(pg_temp.fx('org'), 'm1')).data #>> '{revenue,totals,potential}')::numeric, 6000::numeric, 'Potential 6,000');
select is(((pg_temp.snap(pg_temp.fx('org'), 'm1')).data #>> '{revenue,totals,achieved}')::numeric, 3500::numeric, 'Achieved 3,500 (the adjustment)');
select is(((pg_temp.snap(pg_temp.fx('org'), 'm1')).data #>> '{revenue,totals,remaining}')::numeric, 2500::numeric, 'Remaining 2,500');
select is(((pg_temp.snap(pg_temp.fx('org'), 'm1')).data #>> '{revenue,totals,advances_received}')::numeric, 5000::numeric,
  'Advances received 5,000 (never Achieved)');
select is(((pg_temp.snap(pg_temp.fx('org'), 'm1')).data #>> '{revenue,totals,by_client,0,achieved}')::numeric, 3500::numeric,
  'by client: 3,500');
select is(jsonb_array_length((pg_temp.snap(pg_temp.fx('org'), 'm1')).data #> '{revenue,cycles}'), 1, 'one retainer cycle: last month''s');
select ok((select e ->> 'cycle_id' = pg_temp.fx('past')::text and (e ->> 'amount')::numeric = 6000
                  and (e ->> 'achieved_calculated')::numeric = 3000 and e #>> '{override,adjusted_value}' = '3500.00'
                  and (e #>> '{override,calculated_value}')::numeric = 3000 and e ->> 'billing_status' = 'billed'
                  and e ->> 'billed_on' = (pg_temp.mo('m1') + 20)::text and e ->> 'client_name' = 'Client 161'
           from jsonb_array_elements((pg_temp.snap(pg_temp.fx('org'), 'm1')).data #> '{revenue,cycles}') e),
  'the cycle by its id: amount, calculated and adjusted Achieved, the override, billing status at close');
select is((select array_agg(i ->> 'item_id' order by i ->> 'item_id')
           from jsonb_array_elements((pg_temp.snap(pg_temp.fx('org'), 'm1')).data #> '{revenue,cycles,0,items}') i),
  (select array_agg(id::text order by id::text) from fx where key in ('item_a', 'item_b')),
  'its two deliverables, by their ids');
select ok((select i ->> 'method' = 'split' and (i ->> 'value')::numeric = 3000 and (i ->> 'achieved')::boolean
                  and i ->> 'approved_by' = pg_temp.fx('admin')::text and i ->> 'approved_at' is not null
           from jsonb_array_elements((pg_temp.snap(pg_temp.fx('org'), 'm1')).data #> '{revenue,cycles,0,items}') i
           where i ->> 'item_id' = pg_temp.fx('item_a')::text),
  'a deliverable: value, method, approval');
select is(jsonb_array_length((pg_temp.snap(pg_temp.fx('org'), 'm1')).data #> '{revenue,projects}'), 0,
  'no one-time line in last month (the film sits in its delivery month)');
select ok((select a ->> 'project_id' = pg_temp.fx('ot')::text and a ->> 'event' = 'received' and (a ->> 'amount')::numeric = 5000
           from jsonb_array_elements((pg_temp.snap(pg_temp.fx('org'), 'm1')).data #> '{revenue,advances}') a),
  'the advance, received last month');
select is((pg_temp.snap(pg_temp.fx('org'), 'm1')).data -> 'expenses',
  jsonb_build_array(jsonb_build_object('member_id', pg_temp.fx('staff'), 'full_name', 'Test Crew', 'approved', 700.00,
    'approved_count', 1, 'paid', 300.00, 'paid_count', 1)),
  'expense totals per person: approved (not paid) and paid, of last month only');
select ok((select bool_or(s ->> 'id' = pg_temp.fx('staff')::text) and not bool_or(s ->> 'id' = pg_temp.fx('free')::text)
           from jsonb_array_elements((pg_temp.snap(pg_temp.fx('org'), 'm1')).data -> 'month_summary') s),
  'month_summary() per person (Crew in, a freelancer out, as month_summary)');
select pg_temp.as_owner_inside('owner');
select is((pg_temp.snap(pg_temp.fx('org'), 'm1')).data, app.month_snapshot_build(pg_temp.fx('org'), pg_temp.mo('m1')),
  'the stored document is exactly a fresh build of the same data (deterministic)');

-- ===========================================================================================================
-- 4. The history and notifications
-- ===========================================================================================================
select pg_temp.as_system();
select is((select count(*)::integer from public.activity_log where entity = 'month_snapshots'), 1, 'exactly one history entry');
select ok((select l.action = 'closed' and l.actor_id = pg_temp.fx('owner') and l.org_id = pg_temp.fx('org')
                  and l.entity_id = (pg_temp.snap(pg_temp.fx('org'), 'm1')).id
           from public.activity_log l where l.entity = 'month_snapshots'),
  'closed, by the Owner, on the snapshot row');
select is((select l.meta from public.activity_log l where l.entity = 'month_snapshots'),
  jsonb_build_object('month', pg_temp.mo('m1'), 'version', 1), 'meta = the month and the version, nothing else');
select is((select l.diff from public.activity_log l where l.entity = 'month_snapshots'), '{}'::jsonb, 'no diff');
select ok((select to_jsonb(l)::text not like '%6000%' and to_jsonb(l)::text not like '%3500%'
                  and to_jsonb(l)::text not like '%5000%' and to_jsonb(l)::text not like '%700%'
                  and to_jsonb(l)::text not like '%Agreed%' and to_jsonb(l)::text not like '%Invoice%'
           from public.activity_log l where l.entity = 'month_snapshots'),
  'no amount and no note anywhere in the entry');
select is((select count(*)::integer from public.notifications), (select n from counts where key = 'notifications'),
  'the close notified nobody');
select pg_temp.as_member('admin');
select is((select count(*)::integer from public.activity_log where entity = 'month_snapshots'), 0, 'an Admin reads no close entry');
select pg_temp.as_member('staff');
select is((select count(*)::integer from public.activity_log where entity = 'month_snapshots'), 0, 'nor does Crew');
select pg_temp.as_member('owner');
select is((select count(*)::integer from public.activity_log where entity = 'month_snapshots'), 1, 'the Owner reads it');

-- ===========================================================================================================
-- 5. Another organization
-- ===========================================================================================================
select pg_temp.as_member('b_owner');
select public.billing_set_cycle_amount(pg_temp.fx('b_past'), 7777);
select public.billing_set_cycle_amount(pg_temp.fx('b_older'), 0);
select pg_temp.as_system();
select is(app.first_priced_month(pg_temp.fx('org_b')), pg_temp.mo('m2'), '₹0 ("Not billable") makes a month priced');
select pg_temp.as_member('b_owner');
select is(public.month_close(pg_temp.mo('m1')), 1, 'org B closes the same month (closed is per organization)');
select is(public.month_close(pg_temp.mo('m2')), 1, 'and its ₹0 month');
select pg_temp.as_system();
select ok((pg_temp.snap(pg_temp.fx('org'), 'm1')).data::text not like '%7777%'
          and (pg_temp.snap(pg_temp.fx('org'), 'm1')).data::text not like '%' || pg_temp.fx('b_client') || '%'
          and (pg_temp.snap(pg_temp.fx('org'), 'm1')).data::text not like '%' || pg_temp.fx('b_owner') || '%',
  'org B''s figures, client and people never enter org A''s snapshot');
select ok((pg_temp.snap(pg_temp.fx('org_b'), 'm1')).data::text not like '%' || pg_temp.fx('client') || '%'
          and (pg_temp.snap(pg_temp.fx('org_b'), 'm1')).data::text not like '%' || pg_temp.fx('staff') || '%'
          and ((pg_temp.snap(pg_temp.fx('org_b'), 'm1')).data #>> '{revenue,totals,potential}')::numeric = 7777,
  'and org B''s holds its own 7,777 only');

-- ===========================================================================================================
-- 6. The IST month boundary at explicit instants (app.test_now; this month = m0)
-- ===========================================================================================================
-- 23:59:59 IST on the last day of this month: it has not ended.
select set_config('app.test_now', (((app.month_start(pg_temp.mo('m0') + 40)::text || ' 00:00:00+05:30')::timestamptz) - interval '1 second')::text, true);
select pg_temp.as_member('owner');
select is(pg_temp.err(format('select public.month_close(%L)', pg_temp.mo('m0'))),
  'VALIDATION: ' || pg_temp.name('m0') || ' hasn''t ended yet.', 'at 23:59:59 IST on its last day, this month has not ended');
-- 00:00:30 IST on the 1st of next month (still the last day in UTC): it ended yesterday, IST.
select set_config('app.test_now', ((app.month_start(pg_temp.mo('m0') + 40)::text || ' 00:00:30+05:30')::timestamptz)::text, true);
select is(public.month_close(pg_temp.mo('m0')), 1, 'half a minute into the 1st IST (still the last day in UTC), it ended yesterday: closable');
select set_config('app.test_now', '', true);

select * from finish();
rollback;
