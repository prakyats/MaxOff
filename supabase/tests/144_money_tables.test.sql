-- 9.1 (v2.1 "Money in"; migration money_tables; DATA-MODEL §7; WORKFLOWS §6; ADR-0007): the Owner-only money
-- tables, their functions and the revenue views.
--   0. the seal: RLS, one policy, no write grant, definer functions, invoker views, no publication;
--   1. plan or added (R4): every path that makes a deliverable, pinned to its class;
--   2. every function, every path, for the Owner; refused for the client's Admin, another Admin, Crew, a
--      freelancer and anon;
--   3. the rules: the split to the paisa, explicit values off the top, added work on top, "Not needed",
--      closed-not-achieved, carried work in its origin month, Q1 "this month on", a new cycle's copy,
--      one-time projects by month, advances, overrides, billed;
--   4. no path: tables, views, functions, activity_log, notifications for everyone but the Owner.
-- Every name here is neutral.
begin;
create extension if not exists pgtap with schema extensions;
select plan(192);


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
  ('owner',    '00000000-0000-4000-8000-000000144901'),
  ('admin',    '00000000-0000-4000-8000-000000144902'),
  ('admin2',   '00000000-0000-4000-8000-000000144903'),
  ('staff',    '00000000-0000-4000-8000-000000144904'),
  ('free',     '00000000-0000-4000-8000-000000144905'),
  ('client_a', '00000000-0000-4000-8000-0000001449a1'),
  ('client_b', '00000000-0000-4000-8000-0000001449b1');
insert into fx select 'org', id from public.organizations limit 1;
grant select, insert on fx to authenticated, anon, service_role;


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
create function pg_temp.code(sql text) returns text language plpgsql as $$
begin
  execute sql;
  return 'ok';
exception
  when sqlstate 'P0001' then return sqlerrm;
  when insufficient_privilege then return 'NO_PRIVILEGE';
end;
$$;
-- How many rows a statement returns for the caller.
create function pg_temp.n(sql text) returns integer language plpgsql as $$
declare v integer;
begin
  execute 'select count(*)::integer from (' || sql || ') q' into v;
  return v;
exception when insufficient_privilege then return -1;
end;
$$;
create function pg_temp.citem(c uuid, t text) returns uuid language sql stable security definer as $$
  select i.id from public.project_items i where i.cycle_id = c and i.title = t order by i.position collate "C" limit 1;
$$;
create function pg_temp.cyc(p uuid, d date) returns uuid language sql stable security definer as $$
  select c.id from public.project_cycles c where c.project_id = p and c.period_start = d;
$$;
create function pg_temp.added(i uuid) returns boolean language sql stable security definer as $$
  select coalesce((select b.added from public.item_billing b where b.item_id = i), false);
$$;
create function pg_temp.camount(c uuid) returns numeric language sql stable security definer as $$
  select b.cycle_amount from public.cycle_billing b where b.cycle_id = c;
$$;
create function pg_temp.val(i uuid) returns numeric language sql stable as $$
  select v.value from public.item_values_v v where v.item_id = i;
$$;
create function pg_temp.method(i uuid) returns text language sql stable as $$
  select v.method from public.item_values_v v where v.item_id = i;
$$;
create function pg_temp.entries(p_entity text, p_action text, p_id uuid) returns integer language sql stable security definer as $$
  select count(*)::integer from public.activity_log a where a.entity = p_entity and a.action = p_action and a.entity_id = p_id;
$$;

insert into auth.users (id, email)
select id, key || '-144@example.com' from fx where key not in ('org') and key not like 'client_%';
insert into public.members (id, org_id, full_name, email, role, status, engagement, joined_at) values
  (pg_temp.fx('owner'),  pg_temp.fx('org'), 'Test Owner',  'owner-144@example.com',  'owner', 'active', 'permanent',  now()),
  (pg_temp.fx('admin'),  pg_temp.fx('org'), 'Test Admin',  'admin-144@example.com',  'admin', 'active', 'permanent',  now()),
  (pg_temp.fx('admin2'), pg_temp.fx('org'), 'Other Admin', 'admin2-144@example.com', 'admin', 'active', 'permanent',  now()),
  (pg_temp.fx('staff'),  pg_temp.fx('org'), 'Test Crew',   'staff-144@example.com',  'staff', 'active', 'permanent',  now()),
  (pg_temp.fx('free'),   pg_temp.fx('org'), 'Test Free',   null,                     'staff', 'active', 'freelance',  now());
insert into public.clients (id, org_id, name, state, admin_id, activated_at) values
  (pg_temp.fx('client_a'), pg_temp.fx('org'), 'Client A', 'active', pg_temp.fx('admin'),  now()),
  (pg_temp.fx('client_b'), pg_temp.fx('org'), 'Client B', 'active', pg_temp.fx('admin2'), now());

create temporary table d (key text primary key, day date not null);
insert into d values
  ('today', app.today_ist()),
  ('m0', app.month_start(app.today_ist())),
  ('m_prev', app.month_start(app.month_start(app.today_ist()) - 1)),
  ('m_next', app.month_start(app.month_start(app.today_ist()) + 40)),
  ('w0', app.period_start('weekly', app.today_ist()));
grant select on d to authenticated, anon, service_role;
create function pg_temp.d(k text) returns date language sql stable as $$ select day from d where key = k; $$;

-- ===========================================================================================================
-- 0. The seal
-- ===========================================================================================================
select ok((select bool_and(c.relrowsecurity) and count(*) = 5 from pg_class c
           where c.relnamespace = 'public'::regnamespace
             and c.relname in ('project_billing', 'cycle_billing', 'item_billing', 'revenue_overrides', 'project_advances')),
  'the five money tables have RLS on');
select is((select array_agg(p.tablename || ':' || p.policyname || ':' || p.cmd order by p.tablename)::text[] from pg_policies p
           where p.schemaname = 'public'
             and p.tablename in ('project_billing', 'cycle_billing', 'item_billing', 'revenue_overrides', 'project_advances')),
  array['cycle_billing:cycle_billing_select:SELECT', 'item_billing:item_billing_select:SELECT',
        'project_advances:project_advances_select:SELECT', 'project_billing:project_billing_select:SELECT',
        'revenue_overrides:revenue_overrides_select:SELECT'],
  'each has exactly one policy, a select');
select ok((select bool_and(p.qual like '%finance.view%' and p.qual like '%org_id%' and p.roles = '{authenticated}') from pg_policies p
           where p.schemaname = 'public'
             and p.tablename in ('project_billing', 'cycle_billing', 'item_billing', 'revenue_overrides', 'project_advances')),
  'and it is finance.view in the caller''s organization, for signed-in members only');
select ok((select bool_and(not has_table_privilege(r, 'public.' || t, 'insert')
                           and not has_table_privilege(r, 'public.' || t, 'update')
                           and not has_table_privilege(r, 'public.' || t, 'delete')
                           and not has_table_privilege(r, 'public.' || t, 'truncate'))
           from unnest(array['authenticated', 'anon']) r,
                unnest(array['project_billing', 'cycle_billing', 'item_billing', 'revenue_overrides', 'project_advances']) t),
  'no API role can insert, update, delete or truncate any of them');
select ok((select bool_and(not has_table_privilege('anon', 'public.' || t, 'select'))
           from unnest(array['project_billing', 'cycle_billing', 'item_billing', 'revenue_overrides', 'project_advances',
                             'item_values_v', 'revenue_by_cycle_v', 'revenue_project_lines_v', 'revenue_advances_v',
                             'revenue_by_client_month_v']) t),
  'anon can select none of the tables or views');
select ok((select bool_and(c.reloptions @> array['security_invoker=true']) and count(*) = 5 from pg_class c
           where c.relnamespace = 'public'::regnamespace and c.relkind = 'v'
             and c.relname in ('item_values_v', 'revenue_by_cycle_v', 'revenue_project_lines_v', 'revenue_advances_v',
                               'revenue_by_client_month_v')),
  'the five views are security invoker');
select ok((select bool_and(pg_get_viewdef(c.oid) like '%finance.view%') and count(*) = 2 from pg_class c
           where c.relnamespace = 'public'::regnamespace and c.relkind = 'v'
             and c.relname in ('revenue_project_lines_v', 'revenue_advances_v'))
          -- The two retainer views are app.item_values / app.revenue_cycles asked for every cycle (migration
          -- money_reads_scoped): the gate is in those functions, which are invoker like the views.
          and (select pg_get_viewdef('public.item_values_v'::regclass) like '%app.item_values(%'
                  and pg_get_viewdef('public.revenue_by_cycle_v'::regclass) like '%app.revenue_cycles(%')
          and (select bool_and(p.prosrc like '%finance.view%' and not p.prosecdef) and count(*) = 2 from pg_proc p
               where p.pronamespace = 'app'::regnamespace and p.proname in ('item_values', 'revenue_cycles')),
  'and each base view is gated on finance.view itself (the retainer views through their invoker functions)');
select ok((select bool_and(has_function_privilege('authenticated', p.oid, 'execute')
                           and not has_function_privilege('anon', p.oid, 'execute')
                           and p.prosecdef and p.proconfig @> array['search_path=""']) and count(*) = 8
           from pg_proc p where p.pronamespace = 'public'::regnamespace
             and p.proname in ('billing_set_project', 'billing_set_cycle_amount', 'item_value_set', 'advance_record',
                               'advance_return', 'billing_mark', 'revenue_override_set', 'revenue_override_clear')),
  'the eight functions: authenticated, never anon; SECURITY DEFINER with an empty search_path');
select ok(not exists (select 1 from pg_publication_tables
                      where tablename in ('project_billing', 'cycle_billing', 'item_billing', 'revenue_overrides', 'project_advances')),
  'no money table is in any publication');
select ok(not exists (select 1 from information_schema.columns c
                      where c.table_schema = 'public' and c.table_name in ('projects', 'project_cycles', 'project_items')
                        and c.column_name ~ '(amount|value|price|billing|billed|advance|revenue|fee)'),
  'projects, cycles and deliverables carry no money column');
select ok((select bool_and(exists (select 1 from pg_trigger g where g.tgrelid = ('public.' || t)::regclass
                                     and g.tgname = 'audit_row_change' and not g.tgisinternal))
           from unnest(array['project_billing', 'cycle_billing', 'item_billing', 'revenue_overrides', 'project_advances']) t),
  'every money table is audited');

-- ===========================================================================================================
-- 1. Plan or added (R4): every path that makes a deliverable
-- ===========================================================================================================
select pg_temp.as_member('admin');
insert into fx values ('p', public.project_create(pg_temp.fx('client_a'), 'Work', 'monthly', null, null,
  array['Stage 1'], array['Item 1', 'Item 2', 'Item 3']));
select pg_temp.as_system();
insert into fx values ('cur', pg_temp.cyc(pg_temp.fx('p'), pg_temp.d('m0')));
insert into fx values ('i1', pg_temp.citem(pg_temp.fx('cur'), 'Item 1')), ('i2', pg_temp.citem(pg_temp.fx('cur'), 'Item 2')),
                      ('i3', pg_temp.citem(pg_temp.fx('cur'), 'Item 3'));
select ok(not pg_temp.added(pg_temp.fx('i1')) and not pg_temp.added(pg_temp.fx('i3')),
  'project_create: the first cycle''s list is the plan');
select is((select count(*)::integer from public.item_billing), 0, 'and the plan writes no item_billing row');

-- A past month made by the schedule, with its list.
insert into fx select 'past', (app.cycle_create((select p from public.projects p where p.id = pg_temp.fx('p')),
  pg_temp.d('m_prev'), 'schedule', null, true)).id;
insert into fx values ('pi1', pg_temp.citem(pg_temp.fx('past'), 'Item 1')), ('pi2', pg_temp.citem(pg_temp.fx('past'), 'Item 2')),
                      ('pi3', pg_temp.citem(pg_temp.fx('past'), 'Item 3'));
select ok(not pg_temp.added(pg_temp.fx('pi1')), 'the schedule''s cycle (app.cycle_create): plan');

-- A cycle made without its list, the list copied later (a client Active again).
select pg_temp.as_member('admin');
insert into fx values ('p_late', (select public.project_create(pg_temp.fx('client_a'), 'Late list', 'monthly', null, null,
  array['Stage 1'], array['L1', 'L2'])));
select pg_temp.as_system();
insert into fx select 'late_cycle', (app.cycle_create((select p from public.projects p where p.id = pg_temp.fx('p_late')),
  pg_temp.d('m_prev'), 'carry', pg_temp.fx('owner'), false)).id;
select is((select count(*)::integer from public.project_items i where i.cycle_id = pg_temp.fx('late_cycle')), 0,
  'a cycle made without its list has no deliverables yet');
select app.cycle_copy_item_list((select p from public.projects p where p.id = pg_temp.fx('p_late')), pg_temp.fx('late_cycle'), null);
select ok(not pg_temp.added(pg_temp.citem(pg_temp.fx('late_cycle'), 'L1'))
          and (select count(*) = 2 from public.project_items i where i.cycle_id = pg_temp.fx('late_cycle')),
  'app.cycle_copy_item_list: the list copied later is still the plan');

-- The three ways to add.
select pg_temp.as_member('admin');
select public.item_add(pg_temp.fx('cur'), 'Extra A');
select public.item_add_grouped(pg_temp.fx('cur'), 'Extra B');
select public.project_blueprint_add_to_cycle(pg_temp.fx('p'), 'Extra C', pg_temp.fx('cur'));
select pg_temp.as_system();
insert into fx values ('xa', pg_temp.citem(pg_temp.fx('cur'), 'Extra A')), ('xb', pg_temp.citem(pg_temp.fx('cur'), 'Extra B')),
                      ('xc', pg_temp.citem(pg_temp.fx('cur'), 'Extra C'));
select ok(pg_temp.added(pg_temp.fx('xa')), 'item_add: added');
select ok(pg_temp.added(pg_temp.fx('xb')), 'item_add_grouped: added');
select ok(pg_temp.added(pg_temp.fx('xc')), 'project_blueprint_add_to_cycle ("Also add to this month"): added');
select ok((select bool_and(b.value is null) and count(*) = 3 from public.item_billing b), 'an added deliverable starts with no value');

-- The next month's cycle takes "Extra C" from the list: there it is plan.
-- (cycle_start_next is this same app.cycle_create with 'manual'; it only opens 7 days before the month.)
insert into fx select 'next', (app.cycle_create((select p from public.projects p where p.id = pg_temp.fx('p')),
  pg_temp.d('m_next'), 'manual', pg_temp.fx('admin'), true)).id;
select ok(not pg_temp.added(pg_temp.citem(pg_temp.fx('next'), 'Extra C')) and not pg_temp.added(pg_temp.citem(pg_temp.fx('next'), 'Item 1')),
  'a manual next cycle (cycle_start_next''s app.cycle_create): the new list, the kept line included, is plan');

-- Carried in: never marked, valued where it came from.
select pg_temp.as_member('admin');
select public.cycle_carry_decide(array[pg_temp.fx('pi3')], 'carry_forward');
select pg_temp.as_system();
insert into fx select 'pi3_copy', i.id from public.project_items i where i.carried_from_item_id = pg_temp.fx('pi3');
select ok(not pg_temp.added(pg_temp.fx('pi3_copy')) and not exists (select 1 from public.item_billing b where b.item_id = pg_temp.fx('pi3_copy')),
  'cycle_carry_decide: a carried-in deliverable is not added');

-- One-time projects have no added deliverables (one lump sum).
select pg_temp.as_member('admin');
insert into fx values ('ot', public.project_create(pg_temp.fx('client_a'), 'Film', 'one_time', null, pg_temp.d('m_next') + 9,
  array['Stage 1'], array['Cut 1', 'Cut 2']));
select pg_temp.as_system();
insert into fx select 'ot_cycle', c.id from public.project_cycles c where c.project_id = pg_temp.fx('ot');
select pg_temp.as_member('admin');
select public.item_add(pg_temp.fx('ot_cycle'), 'Cut 3');
select pg_temp.as_system();
insert into fx values ('ot1', pg_temp.citem(pg_temp.fx('ot_cycle'), 'Cut 1')), ('ot2', pg_temp.citem(pg_temp.fx('ot_cycle'), 'Cut 2')),
                      ('ot3', pg_temp.citem(pg_temp.fx('ot_cycle'), 'Cut 3'));
select ok(not exists (select 1 from public.item_billing b join public.project_items i on i.id = b.item_id where i.project_id = pg_temp.fx('ot')),
  'a one-time project''s deliverables are never marked, added or not');
select is((select count(*)::integer from public.activity_log a where a.entity = 'item_billing'), 3,
  'the three marks are audited under item_billing');
select ok(not exists (select 1 from public.activity_log a where a.entity in ('projects', 'project_cycles', 'project_items')
                        and (a.diff::text ~ 'added' and a.diff::text ~ 'item_billing')),
  'and nothing about them is written on the deliverable''s own history');

-- ===========================================================================================================
-- 2. Retainers: the amount (Q1, decision 3), the split (decision 4), added work on top (R4)
-- ===========================================================================================================
-- Q1: the first amount covers cycles starting this IST month or later, never an earlier one.
select pg_temp.as_member('owner');
select is(pg_temp.code($$select public.billing_set_project(pg_temp.fx('p'), null, false, null)$$), 'VALIDATION', 'nothing to change is refused');
select is(pg_temp.code($$select public.billing_set_project(pg_temp.fx('p'), 100.50, true, null)$$), 'VALIDATION', 'paise are refused: whole rupees');
select is(pg_temp.code($$select public.billing_set_project(pg_temp.fx('p'), -1, true, null)$$), 'VALIDATION', 'a negative amount is refused');
select is(pg_temp.code($$select public.billing_set_project(gen_random_uuid(), 100, true, null)$$), 'NOT_FOUND', 'an unknown project is NOT_FOUND');
select ok(public.billing_set_project(pg_temp.fx('p'), 12000, true, null), 'the Owner sets the first amount');
select pg_temp.as_member('owner');
select is(pg_temp.camount(pg_temp.fx('cur')), 12000::numeric, 'Q1: this month''s cycle takes it');
select is(pg_temp.camount(pg_temp.fx('next')), 12000::numeric, 'Q1: so does a later cycle already made');
select is(pg_temp.camount(pg_temp.fx('past')), null, 'Q1: last month''s cycle stays "No amount set"');
select is((select b.priced_from from public.project_billing b where b.project_id = pg_temp.fx('p')), pg_temp.d('m0'),
  'priced_from is the 1st of this IST month');
select is((select b.cycle_amount from public.project_billing b where b.project_id = pg_temp.fx('p')), 12000::numeric,
  'the project keeps it as the default for new cycles');
select ok(pg_temp.entries('project_billing', 'amount_set', pg_temp.fx('p')) = 1
          and pg_temp.entries('cycle_billing', 'amount_set', pg_temp.fx('cur')) = 1,
  'audited on the project''s and the cycle''s billing rows');

-- A new cycle copies the project's amount (decision 3).
select pg_temp.as_system();
insert into fx select 'later', (app.cycle_create((select p from public.projects p where p.id = pg_temp.fx('p')),
  app.period_next('monthly', pg_temp.d('m_next')), 'schedule', null, true)).id;
select pg_temp.as_member('owner');
select is(pg_temp.camount(pg_temp.fx('later')), 12000::numeric, 'a new cycle copies the project''s amount');
select pg_temp.as_member('admin');
insert into fx values ('p_free', public.project_create(pg_temp.fx('client_a'), 'Unpriced', 'monthly', null, null,
  array['Stage 1'], array['U1']));
select pg_temp.as_member('owner');
select ok(not exists (select 1 from public.cycle_billing b where b.project_id = pg_temp.fx('p_free')),
  'a project with no amount writes no cycle_billing row');

-- One cycle alone; a later change goes from the current cycle on and never to an earlier one.
select pg_temp.as_member('owner');
select ok(public.billing_set_cycle_amount(pg_temp.fx('past'), 6000), 'one earlier cycle can be priced alone');
select ok(public.billing_set_project(pg_temp.fx('p'), 10000, true, null), 'a later change of the project''s amount');
select pg_temp.as_member('owner');
select is(pg_temp.camount(pg_temp.fx('cur')), 10000::numeric, 'goes to the current cycle');
select is(pg_temp.camount(pg_temp.fx('later')), 10000::numeric, 'and to later ones');
select is(pg_temp.camount(pg_temp.fx('past')), 6000::numeric, 'never to an earlier cycle');
select is((select b.priced_from from public.project_billing b where b.project_id = pg_temp.fx('p')), pg_temp.d('m0'),
  'priced_from does not move');

-- Weekly: a cycle that started before this month stays unpriced; one inside this month is covered.
select pg_temp.as_member('admin');
insert into fx values ('wk', public.project_create(pg_temp.fx('client_a'), 'Weekly', 'weekly', null, null,
  array['Stage 1'], array['W1', 'W2']));
select pg_temp.as_member('owner');
insert into fx values ('wk_cur', pg_temp.cyc(pg_temp.fx('wk'), pg_temp.d('w0')));
select pg_temp.as_system();
insert into fx select 'wk_old', (app.cycle_create((select p from public.projects p where p.id = pg_temp.fx('wk')),
  pg_temp.d('w0') - 35, 'schedule', null, true)).id;
select pg_temp.as_system();
insert into fx select 'wk_1', (app.cycle_create((select p from public.projects p where p.id = pg_temp.fx('wk')),
  pg_temp.d('w0') - 7, 'schedule', null, true)).id;
select pg_temp.as_member('owner');
select pg_temp.as_member('owner');
select public.billing_set_project(pg_temp.fx('wk'), 700, true, null);
select pg_temp.as_member('owner');
select is(pg_temp.camount(pg_temp.fx('wk_old')), null, 'weekly: a cycle five weeks back is before this month: no amount');
select is(pg_temp.camount(pg_temp.fx('wk_1')), case when pg_temp.d('w0') - 7 >= pg_temp.d('m0') then 700::numeric end,
  'weekly: last week''s cycle is covered only if it started on or after the 1st');
select is(pg_temp.camount(pg_temp.fx('wk_cur')), case when pg_temp.d('w0') >= pg_temp.d('m0') then 700::numeric end,
  'weekly: the current week is covered only if it started on or after the 1st (a week that began last month is last month''s)');
select pg_temp.as_member('owner');
select public.billing_set_project(pg_temp.fx('wk'), 800, true, null);
select pg_temp.as_member('owner');
select is(pg_temp.camount(pg_temp.fx('wk_cur')), case when pg_temp.d('w0') >= pg_temp.d('m0') then 800::numeric end,
  'weekly: a later change reaches the current week, unless it began before the first priced month (Q1)');
select is(pg_temp.camount(pg_temp.fx('wk_1')), case when pg_temp.d('w0') - 7 >= pg_temp.d('m0') then 700::numeric end,
  'weekly: and leaves last week as it was');

-- Q1's boundary on every date: the first priced month moved to next month, so the current week began before it.
select pg_temp.as_system();
update public.project_billing set priced_from = pg_temp.d('m_next') where project_id = pg_temp.fx('wk');
select pg_temp.as_member('owner');
select public.billing_set_project(pg_temp.fx('wk'), 900, true, null);
select is(pg_temp.camount(pg_temp.fx('wk_cur')), case when pg_temp.d('w0') >= pg_temp.d('m0') then 800::numeric end,
  'weekly: a later change never reaches a week that began before the first priced month');
select pg_temp.as_system();
insert into fx select 'wk_back', (app.cycle_create((select p from public.projects p where p.id = pg_temp.fx('wk')),
  pg_temp.d('w0') - 14, 'schedule', null, true)).id;
insert into fx select 'wk_ahead', (app.cycle_create((select p from public.projects p where p.id = pg_temp.fx('wk')),
  app.period_start('weekly', pg_temp.d('m_next') + 7), 'schedule', null, true)).id;
select pg_temp.as_member('owner');
select is(pg_temp.camount(pg_temp.fx('wk_back')), null, 'weekly: a back-filled earlier week copies no amount');
select is(pg_temp.camount(pg_temp.fx('wk_ahead')), 900::numeric, 'weekly: a new week on or after the first priced month copies it');
select ok(public.billing_set_cycle_amount(pg_temp.fx('wk_back'), 650), 'an earlier week can still be priced alone, on purpose');

-- The split to the paisa: 10,000 over three plan deliverables; the added three are worth nothing yet.
select is(pg_temp.val(pg_temp.fx('i1')), 3333.34::numeric, 'the first plan deliverable takes the leftover paise');
select is(pg_temp.val(pg_temp.fx('i2')), 3333.33::numeric, 'the second: an even share');
select is(pg_temp.val(pg_temp.fx('i3')), 3333.33::numeric, 'the third: an even share');
select is(pg_temp.method(pg_temp.fx('i1')), 'split', 'method: split');
select is(pg_temp.method(pg_temp.fx('xa')), 'not_priced', 'an added deliverable: not priced');
select is(pg_temp.val(pg_temp.fx('xa')), 0::numeric, 'and worth nothing until priced');
select is((select v.kind from public.item_values_v v where v.item_id = pg_temp.fx('xa')), 'added', 'kind: added');
select ok(not exists (select 1 from public.item_values_v v where v.item_id = pg_temp.fx('pi3_copy')),
  'a carried-in deliverable has no row of its own in this cycle');
select results_eq(
  $$select potential, achieved, remaining, added_count, not_priced_count, plan_count, month, billing_category::text, billing_status::text
    from public.revenue_by_cycle_v where cycle_id = pg_temp.fx('cur')$$,
  $$select 10000::numeric(12,2), 0::numeric(12,2), 10000::numeric(12,2), 3, 3, 3, pg_temp.d('m0'), 'retainer', 'not_billed'$$,
  'the cycle: Potential = its amount, three added and not priced, a retainer by default');

-- Added work is priced on top (R4).
select pg_temp.as_member('owner');
select ok(public.item_value_set(pg_temp.fx('xa'), 2718), 'the Owner prices an added deliverable');
select ok(public.item_value_set(pg_temp.fx('xb'), 0), 'and marks another as not billable (0)');
select is(pg_temp.code($$select public.item_value_set(pg_temp.fx('xc'), 10.5)$$), 'VALIDATION', 'paise are refused on a value');
select pg_temp.as_member('owner');
select is(pg_temp.val(pg_temp.fx('i1')), 3333.34::numeric, 'the plan''s shares do not move');
select is(pg_temp.method(pg_temp.fx('xa')), 'added', 'method: added');
select is(pg_temp.method(pg_temp.fx('xb')), 'added', '0 is a price ("Not billable"), not "not priced"');
select results_eq(
  $$select potential, added_value, not_priced_count from public.revenue_by_cycle_v where cycle_id = pg_temp.fx('cur')$$,
  $$select 12718::numeric(12,2), 2718::numeric(12,2), 1$$,
  'Potential = the amount + the priced extra; one still not priced');
select ok(pg_temp.entries('item_billing', 'value_set', pg_temp.fx('xa')) = 1, 'value_set is audited');

-- Explicit values of plan deliverables come off the top (decision 4).
select pg_temp.as_member('owner');
select ok(public.item_value_set(pg_temp.fx('i2'), 4000), 'a plan deliverable gets its own value');
select is(pg_temp.code($$select public.item_value_set(pg_temp.fx('i1'), 7000)$$), 'VALIDATION', 'values over the cycle''s amount are refused');
select is(pg_temp.code($$select public.billing_set_cycle_amount(pg_temp.fx('cur'), 3000)$$), 'VALIDATION', 'the cycle''s amount can''t go below them');
select is(pg_temp.code($$select public.billing_set_project(pg_temp.fx('p'), 3000, true, null)$$), 'VALIDATION', 'nor the project''s, for a cycle it reaches');
select ok((select pg_temp.code($$select public.billing_set_project(pg_temp.fx('p'), 3000, true, null)$$)) !~ '[0-9]{4}',
  'the refusal names no amount');
select is(pg_temp.code($$select public.item_value_set(pg_temp.fx('pi1'), 100)$$), 'ok', 'a plan value in a priced earlier cycle is fine');
select is(pg_temp.code($$select public.item_value_set(pg_temp.citem(pg_temp.fx('wk_old'), 'W1'), 100)$$), 'VALIDATION',
  'a plan value needs the cycle''s amount first');
select is(pg_temp.code($$select public.item_value_set(pg_temp.fx('pi3_copy'), 100)$$), 'VALIDATION', 'a carried-in deliverable is valued where it came from');
select is(pg_temp.code($$select public.item_value_set(gen_random_uuid(), 100)$$), 'NOT_FOUND', 'an unknown deliverable is NOT_FOUND');
select pg_temp.as_member('owner');
select is(pg_temp.val(pg_temp.fx('i2')), 4000::numeric, 'explicit: its own value');
select is(pg_temp.method(pg_temp.fx('i2')), 'explicit', 'method: explicit');
select is(pg_temp.val(pg_temp.fx('i1')), 3000::numeric, 'the rest is split evenly');
select is((select potential from public.revenue_by_cycle_v where cycle_id = pg_temp.fx('cur')), 12718::numeric,
  'the plan still adds up to the amount');
select pg_temp.as_member('owner');
select public.item_value_set(pg_temp.fx('pi1'), null);
select ok(public.item_value_set(pg_temp.fx('i2'), null), 'back to the split');
select pg_temp.as_member('owner');
select is(pg_temp.val(pg_temp.fx('i2')), 3333.33::numeric, 'the share is back');
select ok(exists (select 1 from public.item_billing b where b.item_id = pg_temp.fx('i2') and b.value is null and not b.added),
  'the row is kept with no value (nothing is deleted)');
select is(pg_temp.entries('item_billing', 'value_cleared', pg_temp.fx('i2')), 1, 'value_cleared is audited');

-- Done = Achieved; "Not needed" leaves Potential; "Not delivered" is closed, not achieved.
select pg_temp.as_member('admin');
select public.item_mark_done(pg_temp.fx('i1'));
select public.item_mark_done(pg_temp.fx('xa'));
select pg_temp.as_member('owner');
select is((select achieved from public.revenue_by_cycle_v where cycle_id = pg_temp.fx('cur')), 6051.34::numeric,
  'a done plan deliverable and a done priced extra are Achieved');
select pg_temp.as_member('admin');
select public.item_cancel(pg_temp.fx('i3'), 'Client dropped it', 'not_needed');
select pg_temp.as_member('owner');
select is(pg_temp.method(pg_temp.fx('i3')), 'excluded', '"Not needed" leaves Potential');
select is(pg_temp.val(pg_temp.fx('i1')), 5000::numeric, 'and the amount is split over the plan that is left');
select pg_temp.as_member('admin');
select public.item_cancel(pg_temp.fx('i2'), 'We missed it', 'not_delivered');
select public.item_cancel(pg_temp.fx('xc'), 'Not needed after all', 'not_needed');
select pg_temp.as_member('owner');
select results_eq(
  $$select potential, achieved, closed_not_achieved, remaining, not_priced_count, done_count
    from public.revenue_by_cycle_v where cycle_id = pg_temp.fx('cur')$$,
  $$select 12718::numeric(12,2), 7718::numeric(12,2), 5000::numeric(12,2), 5000::numeric(12,2), 0, 2$$,
  '"Not delivered" stays in Potential as closed, not achieved; a "Not needed" extra is no longer "not priced"');
select pg_temp.as_member('admin');
select public.item_reopen(pg_temp.fx('i1'), 'Needs a fix');
select pg_temp.as_member('owner');
select is((select achieved from public.revenue_by_cycle_v where cycle_id = pg_temp.fx('cur')), 2718::numeric,
  'a reopened deliverable stops counting');

-- Carried work counts in the month it came from.
select is(pg_temp.val(pg_temp.fx('pi3')), 2000::numeric, 'a carried deliverable keeps its share of its origin cycle');
select is((select achieved from public.revenue_by_cycle_v where cycle_id = pg_temp.fx('past')), 0::numeric, 'not achieved while open');
select pg_temp.as_member('admin');
select public.item_mark_done(pg_temp.fx('pi3_copy'));
select pg_temp.as_member('owner');
select results_eq(
  $$select achieved, month from public.revenue_by_cycle_v where cycle_id = pg_temp.fx('past')$$,
  $$select 2000::numeric(12,2), pg_temp.d('m_prev')$$,
  'done after the carry: Achieved in the origin cycle''s month');
select is((select achieved from public.revenue_by_cycle_v where cycle_id = pg_temp.fx('cur')), 2718::numeric,
  'and nothing in the month it moved into');

-- Category, an override, Billed.
select pg_temp.as_member('owner');
select ok(public.billing_set_project(pg_temp.fx('p'), null, false, 'additional_work'), 'the Owner changes the category alone');
select is((select billing_category::text from public.revenue_by_cycle_v where cycle_id = pg_temp.fx('cur')), 'additional_work', 'the views follow');
select is((select cycle_amount from public.project_billing where project_id = pg_temp.fx('p')), 10000::numeric, 'and the amount is untouched');
select is(pg_temp.code($$select public.revenue_override_set('cycle', pg_temp.fx('cur'), 2500, ' ')$$), 'REASON_REQUIRED', 'an override needs a note');
select is(pg_temp.code($$select public.revenue_override_set('project', pg_temp.fx('p'), 2500, 'x')$$), 'VALIDATION', 'a retainer is adjusted by cycle');
select is(pg_temp.code($$select public.revenue_override_set('month', pg_temp.fx('cur'), 2500, 'x')$$), 'VALIDATION', 'an unknown scope is refused');
select is(pg_temp.code($$select public.revenue_override_set('cycle', gen_random_uuid(), 2500, 'x')$$), 'NOT_FOUND', 'an unknown cycle is NOT_FOUND');
select isnt(public.revenue_override_set('cycle', pg_temp.fx('cur'), 2500, 'Agreed a discount'), null, 'the Owner adjusts a cycle''s Achieved');
select results_eq(
  $$select achieved, achieved_calculated, remaining from public.revenue_by_cycle_v where cycle_id = pg_temp.fx('cur')$$,
  $$select 2500::numeric(12,2), 2718::numeric(12,2), 10218::numeric(12,2)$$,
  'the headline is the adjusted figure, the calculated one beside it');
select isnt(public.revenue_override_set('cycle', pg_temp.fx('cur'), 2600, 'Second thought'), null, 'a new adjustment');
select is((select count(*)::integer from public.revenue_overrides where ref_id = pg_temp.fx('cur') and superseded_at is null), 1, 'leaves one live row');
select is((select count(*)::integer from public.revenue_overrides where ref_id = pg_temp.fx('cur')), 2, 'and keeps the old one, superseded');
select is((select calculated_value from public.revenue_overrides where ref_id = pg_temp.fx('cur') and superseded_at is null), 2718::numeric,
  'the calculated value is frozen beside it');
select is(pg_temp.code($$select public.revenue_override_clear('cycle', pg_temp.fx('cur'), null)$$), 'REASON_REQUIRED', '"Back to calculated" needs a note');
select ok(public.revenue_override_clear('cycle', pg_temp.fx('cur'), 'Entered by mistake'), '"Back to calculated"');
select is((select achieved from public.revenue_by_cycle_v where cycle_id = pg_temp.fx('cur')), 2718::numeric, 'the calculated figure is the headline again');
select is(pg_temp.code($$select public.revenue_override_clear('cycle', pg_temp.fx('cur'), 'again')$$), 'NOT_FOUND', 'with nothing left to remove');
select is((select count(*)::integer from public.revenue_overrides where ref_id = pg_temp.fx('cur')), 2, 'no override row is ever deleted');

select is(pg_temp.code($$select public.billing_mark(array[]::uuid[], true, null, null)$$), 'VALIDATION', 'nothing to mark is refused');
select is(pg_temp.code($$select public.billing_mark(array[pg_temp.fx('cur')], true, pg_temp.d('today') + 1, null)$$), 'VALIDATION', 'a future billed date is refused');
select is(pg_temp.code($$select public.billing_mark(array[pg_temp.fx('cur'), gen_random_uuid()], true, null, null)$$), 'NOT_FOUND', 'an unknown cycle refuses the whole call');
select is(public.billing_mark(array[pg_temp.fx('cur'), pg_temp.fx('past')], true, null, 'Invoice sent'), 2, 'the Owner marks two cycles Billed');
select results_eq(
  $$select billing_status::text, billed_on, billing_note, amount from public.revenue_by_cycle_v where cycle_id = pg_temp.fx('cur')$$,
  $$select 'billed', pg_temp.d('today'), 'Invoice sent', 10000::numeric(12,2)$$,
  'Billed today (IST) with the note; the amount is untouched');
select is(public.billing_mark(array[pg_temp.fx('cur')], false, null, null), 1, 'back to Not billed');
select results_eq(
  $$select billing_status::text, billed_on from public.revenue_by_cycle_v where cycle_id = pg_temp.fx('cur')$$,
  $$select 'not_billed', null::date$$, 'the date goes with it');
select ok(pg_temp.entries('cycle_billing', 'billed', pg_temp.fx('cur')) = 1 and pg_temp.entries('cycle_billing', 'not_billed', pg_temp.fx('cur')) = 1,
  'both are audited');
-- The over-amount check counts what the split counts: a "Not needed" deliverable holds no room.
select ok(public.item_value_set(pg_temp.citem(pg_temp.fx('later'), 'Item 1'), 8000), 'a plan value in a later cycle');
select is(pg_temp.code($$select public.item_value_set(pg_temp.citem(pg_temp.fx('later'), 'Item 2'), 3000)$$), 'VALIDATION',
  'a second one over the amount is refused');
select pg_temp.as_member('admin');
select public.item_cancel(pg_temp.citem(pg_temp.fx('later'), 'Item 1'), 'Dropped', 'not_needed');
select pg_temp.as_member('owner');
select is(pg_temp.code($$select public.item_value_set(pg_temp.citem(pg_temp.fx('later'), 'Item 2'), 9000)$$), 'ok',
  'once the first is "Not needed" its value holds no room in the amount');
select ok(public.billing_set_cycle_amount(pg_temp.fx('later'), null), 'one cycle back to "No amount set"');
select is((select amount from public.revenue_by_cycle_v where cycle_id = pg_temp.fx('later')), null, 'reads as no amount');
select is(pg_temp.method(pg_temp.citem(pg_temp.fx('later'), 'Item 3')), 'no_amount', 'its deliverables: no_amount');

-- ===========================================================================================================
-- 3. One-time projects: the lump sum by month, advances, completion, cancellation (decisions 2, 23; Q1; Q4)
-- ===========================================================================================================
select is(pg_temp.code($$select public.item_value_set(pg_temp.fx('ot1'), 500)$$), 'VALIDATION', 'a one-time project''s deliverables carry no value');
select is(pg_temp.code($$select public.billing_set_cycle_amount(pg_temp.fx('ot_cycle'), 500)$$), 'VALIDATION', 'nor does its cycle');
select is(pg_temp.code($$select public.advance_record(pg_temp.fx('ot'), 1000, null, null)$$), 'VALIDATION', 'an advance needs the project''s amount first');
select is(pg_temp.code($$select public.advance_record(pg_temp.fx('p'), 1000, null, null)$$), 'VALIDATION', 'a retainer takes no advance');
select results_eq(
  $$select amount, potential, month, billing_category::text from public.revenue_project_lines_v where project_id = pg_temp.fx('ot')$$,
  $$select null::numeric(12,2), 0::numeric(12,2), pg_temp.d('m_next'), 'project'$$,
  'unpriced: "No amount set", in its delivery month, a Project by default');
select ok(public.billing_set_project(pg_temp.fx('ot'), 61234, true, null), 'the Owner sets the lump sum');
select results_eq(
  $$select amount, potential, achieved, was_due, ready_to_complete from public.revenue_project_lines_v where project_id = pg_temp.fx('ot')$$,
  $$select 61234::numeric(12,2), 61234::numeric(12,2), 0::numeric(12,2), false, false$$,
  'Potential = the lump sum in the delivery month; nothing achieved');
select is(pg_temp.code($$select public.advance_record(pg_temp.fx('ot'), 0, null, null)$$), 'VALIDATION', 'an advance of 0 is refused');
select is(pg_temp.code($$select public.advance_record(pg_temp.fx('ot'), 100.5, null, null)$$), 'VALIDATION', 'paise are refused');
select is(pg_temp.code($$select public.advance_record(pg_temp.fx('ot'), 100, pg_temp.d('today') + 1, null)$$), 'VALIDATION', 'a future date is refused');
select is(pg_temp.code($$select public.advance_record(gen_random_uuid(), 100, null, null)$$), 'NOT_FOUND', 'an unknown project is NOT_FOUND');
insert into fx values ('adv1', public.advance_record(pg_temp.fx('ot'), 31234, null, 'Booking advance'));
select ok(pg_temp.fx('adv1') is not null, 'the Owner records an advance');
select is(pg_temp.code($$select public.advance_record(pg_temp.fx('ot'), 30001, null, null)$$), 'VALIDATION', 'advances can''t pass the project''s amount');
select is(pg_temp.code($$select public.billing_set_project(pg_temp.fx('ot'), 20000, true, null)$$), 'VALIDATION', 'the amount can''t go below the advances');
select is(pg_temp.code($$select public.billing_set_project(pg_temp.fx('ot'), null, true, null)$$), 'VALIDATION', 'nor be cleared while an advance is held');
insert into fx values ('adv2', public.advance_record(pg_temp.fx('ot'), 1000, pg_temp.d('today') - 3, null));
select results_eq(
  $$select advances_kept, advances_returned, achieved from public.revenue_project_lines_v where project_id = pg_temp.fx('ot')$$,
  $$select 32234::numeric(12,2), 0::numeric(12,2), 0::numeric(12,2)$$, 'advances are kept apart and are never Achieved');
select is(pg_temp.code($$select public.advance_return(pg_temp.fx('adv2'), pg_temp.d('today') - 5, null)$$), 'VALIDATION', 'a return before the receipt is refused');
select is(pg_temp.code($$select public.advance_return(pg_temp.fx('adv2'), pg_temp.d('today') + 1, null)$$), 'VALIDATION', 'a future return is refused');
select is(pg_temp.code($$select public.advance_return(gen_random_uuid(), null, null)$$), 'NOT_FOUND', 'an unknown advance is NOT_FOUND');
select ok(public.advance_return(pg_temp.fx('adv2'), null, 'Sent back'), 'the Owner marks an advance returned');
select is(pg_temp.code($$select public.advance_return(pg_temp.fx('adv2'), null, null)$$), 'INVALID_STATE', 'only once');
select results_eq(
  $$select event, month, amount from public.revenue_advances_v where project_id = pg_temp.fx('ot') order by event, amount$$,
  $$values ('received', app.month_start(pg_temp.d('today') - 3), 1000::numeric(12,2)),
           ('received', pg_temp.d('m0'), 31234::numeric(12,2)),
           ('returned', pg_temp.d('m0'), 1000::numeric(12,2))$$,
  'each receipt and each return sits in its own IST month; the row is kept');
select ok(pg_temp.entries('project_advances', 'advance_recorded', pg_temp.fx('adv1')) = 1
          and pg_temp.entries('project_advances', 'advance_returned', pg_temp.fx('adv2')) = 1, 'both are audited');

-- Ready to complete, then completed early: everything moves to the completion month.
select is(pg_temp.code($$select public.revenue_override_set('project', pg_temp.fx('ot'), 50000, 'x')$$), 'INVALID_STATE',
  'only a completed project''s revenue can be adjusted');
select is(pg_temp.code($$select public.revenue_override_set('cycle', pg_temp.fx('ot_cycle'), 50000, 'x')$$), 'VALIDATION',
  'a one-time project is adjusted as a whole');
select pg_temp.as_member('admin');
select public.item_mark_done(pg_temp.fx('ot1'));
select public.item_mark_done(pg_temp.fx('ot2'));
select public.item_mark_done(pg_temp.fx('ot3'));
select pg_temp.as_member('owner');
select results_eq(
  $$select ready_to_complete, achieved from public.revenue_project_lines_v where project_id = pg_temp.fx('ot')$$,
  $$select true, 0::numeric(12,2)$$, 'every deliverable done: "Ready to complete", still nothing earned');
select pg_temp.as_member('admin');
select public.project_complete(pg_temp.fx('ot'));
select pg_temp.as_member('owner');
select results_eq(
  $$select month, potential, achieved, ready_to_complete from public.revenue_project_lines_v where project_id = pg_temp.fx('ot')$$,
  $$select pg_temp.d('m0'), 61234::numeric(12,2), 61234::numeric(12,2), false$$,
  'completed by the client''s Admin: Potential and Achieved both in the completion month');
select pg_temp.as_member('owner');
select isnt(public.revenue_override_set('project', pg_temp.fx('ot'), 50000, 'Settled lower'), null, 'the Owner adjusts a completed project');
select results_eq(
  $$select achieved, achieved_calculated from public.revenue_project_lines_v where project_id = pg_temp.fx('ot')$$,
  $$select 50000::numeric(12,2), 61234::numeric(12,2)$$, 'adjusted beside calculated');
select is(public.billing_mark(array[pg_temp.fx('ot_cycle')], true, pg_temp.d('today') - 1, null), 1, 'a one-time project is marked Billed through its cycle');
select results_eq(
  $$select billing_status::text, billed_on from public.revenue_project_lines_v where project_id = pg_temp.fx('ot')$$,
  $$select 'billed', pg_temp.d('today') - 1$$, 'Billed on the date given');
select pg_temp.as_member('admin');
select public.project_reopen(pg_temp.fx('ot'), 'One more cut');
select pg_temp.as_member('owner');
select results_eq(
  $$select month, achieved from public.revenue_project_lines_v where project_id = pg_temp.fx('ot')$$,
  $$select pg_temp.d('m_next'), 0::numeric(12,2)$$, 'reopened: back to not achieved, in its delivery month');

-- Cancelled = nothing earned (Q4); the advance kept shows apart.
select pg_temp.as_member('admin');
insert into fx values ('shoot', public.project_create(pg_temp.fx('client_a'), 'Shoot', 'one_time', null, pg_temp.d('m_next') + 3,
  array['Stage 1'], array['Day 1']));
select pg_temp.as_member('owner');
select public.billing_set_project(pg_temp.fx('shoot'), 40000, true, 'additional_work');
select public.advance_record(pg_temp.fx('shoot'), 10000, null, null);
select pg_temp.as_member('admin');
select public.project_cancel(pg_temp.fx('shoot'), 'Client pulled out');
select pg_temp.as_member('owner');
select results_eq(
  $$select month, potential, achieved, closed_not_achieved, advances_kept, billing_category::text
    from public.revenue_project_lines_v where project_id = pg_temp.fx('shoot')$$,
  $$select pg_temp.d('m0'), 40000::numeric(12,2), 0::numeric(12,2), 40000::numeric(12,2), 10000::numeric(12,2), 'additional_work'$$,
  'cancelled: nothing achieved, closed-not-achieved in the cancellation month, the advance kept apart');
select pg_temp.as_member('owner');
select is(pg_temp.code($$select public.revenue_override_set('project', pg_temp.fx('shoot'), 20000, 'Kept part')$$), 'INVALID_STATE',
  'a cancelled project takes no adjusted figure (Q4)');

-- Overdue and unfinished: it sits in the current month, "Was due".
select pg_temp.as_member('admin');
insert into fx values ('latefilm', public.project_create(pg_temp.fx('client_a'), 'Late film', 'one_time', null, pg_temp.d('today') + 1,
  array['Stage 1'], array['Edit']));
select pg_temp.as_member('owner');
select public.billing_set_project(pg_temp.fx('latefilm'), 5000, true, null);
select pg_temp.as_system();
update public.projects set delivery_date = pg_temp.d('m_prev') + 9 where id = pg_temp.fx('latefilm');
select pg_temp.as_member('owner');
select results_eq(
  $$select month, was_due, potential from public.revenue_project_lines_v where project_id = pg_temp.fx('latefilm')$$,
  $$select pg_temp.d('m0'), true, 5000::numeric(12,2)$$, 'overdue: its Potential moves to the current month, marked was_due');

-- Q1 for a one-time project finished in an earlier month and priced now: that month reads "No amount set".
select pg_temp.as_member('admin');
insert into fx values ('oldfilm', public.project_create(pg_temp.fx('client_a'), 'Old film', 'one_time', null, pg_temp.d('today') + 1,
  array['Stage 1'], array['Edit']));
select pg_temp.as_system();
update public.project_items set state = 'approved', done_at = now(), done_by = pg_temp.fx('admin'),
  approved_at = now(), approved_by = pg_temp.fx('admin') where project_id = pg_temp.fx('oldfilm');
select pg_temp.as_system();
update public.projects set state = 'completed', completed_at = (pg_temp.d('m_prev') + 14)::timestamptz + interval '12 hours',
  completed_by = pg_temp.fx('admin') where id = pg_temp.fx('oldfilm');
select pg_temp.as_member('owner');
select pg_temp.as_member('owner');
select public.billing_set_project(pg_temp.fx('oldfilm'), 7000, true, null);
select results_eq(
  $$select month, amount, potential, achieved from public.revenue_project_lines_v where project_id = pg_temp.fx('oldfilm')$$,
  $$select pg_temp.d('m_prev'), null::numeric(12,2), 0::numeric(12,2), 0::numeric(12,2)$$,
  'Q1: finished last month, priced now: last month shows it with "No amount set", nothing back-filled');

-- By client, month and category: the parts add up.
select results_eq(
  $$select billing_category::text, potential, achieved, closed_not_achieved, no_amount_count
    from public.revenue_by_client_month_v where client_id = pg_temp.fx('client_a') and month = pg_temp.d('m0')
    order by 1$$,
  $$select x.cat, sum(x.potential)::numeric(12,2), sum(x.achieved)::numeric(12,2), sum(x.closed)::numeric(12,2),
           count(*) filter (where x.amount is null)::integer
    from (select billing_category::text cat, potential, achieved, closed_not_achieved closed, amount
            from public.revenue_by_cycle_v where client_id = pg_temp.fx('client_a') and month = pg_temp.d('m0')
          union all
          select billing_category::text, potential, achieved, closed_not_achieved, amount
            from public.revenue_project_lines_v where client_id = pg_temp.fx('client_a') and month = pg_temp.d('m0')) x
    group by x.cat order by 1$$,
  'the client-month view is the sum of its cycles and one-time lines, by category');
select ok((select sum(potential) from public.revenue_by_client_month_v where client_id = pg_temp.fx('client_a') and month = pg_temp.d('m0'))
          = 12718 + 40000 + 5000 + coalesce((select sum(potential) from public.revenue_by_cycle_v where project_id = pg_temp.fx('wk') and month = pg_temp.d('m0')), 0),
  'this month for the client: the retainer with its extra, the cancelled shoot, the overdue film (and the weekly cycles of this month)');

-- ===========================================================================================================
-- 4. No path for anyone but the Owner: the client's Admin, another Admin, Crew, a freelancer, anon
-- ===========================================================================================================
create temporary table who (k text primary key);
insert into who values ('admin'), ('admin2'), ('staff'), ('free');
grant select on who to authenticated, anon;
create temporary table rel (r text primary key);
insert into rel values ('project_billing'), ('cycle_billing'), ('item_billing'), ('revenue_overrides'), ('project_advances'),
  ('item_values_v'), ('revenue_by_cycle_v'), ('revenue_project_lines_v'), ('revenue_advances_v'), ('revenue_by_client_month_v');
grant select on rel to authenticated, anon;
create temporary table calls (c text primary key);
insert into calls values
  ($$select public.billing_set_project(pg_temp.fx('p'), 5, true, null)$$),
  ($$select public.billing_set_cycle_amount(pg_temp.fx('cur'), 5)$$),
  ($$select public.item_value_set(pg_temp.fx('xb'), 5)$$),
  ($$select public.advance_record(pg_temp.fx('ot'), 5, null, null)$$),
  ($$select public.advance_return(pg_temp.fx('adv1'), null, null)$$),
  ($$select public.billing_mark(array[pg_temp.fx('cur')], true, null, null)$$),
  ($$select public.revenue_override_set('cycle', pg_temp.fx('cur'), 5, 'x')$$),
  ($$select public.revenue_override_clear('cycle', pg_temp.fx('cur'), 'x')$$);
grant select on calls to authenticated, anon;

select pg_temp.as_member('owner');
select ok((select bool_and(pg_temp.n('select 1 from public.' || r) > 0) from rel), 'the Owner reads rows from every table and view');

create function pg_temp.sees(k text) returns integer language plpgsql as $$
declare v integer;
begin
  perform pg_temp.as_member(k);
  select coalesce(sum(pg_temp.n('select 1 from public.' || r)), 0)::integer into v from rel;
  return v;
end;
$$;
create function pg_temp.refused(k text) returns text language plpgsql as $$
declare v text;
begin
  perform pg_temp.as_member(k);
  select string_agg(distinct pg_temp.code(c), ',') into v from calls;
  return v;
end;
$$;
create function pg_temp.audit_seen(k text) returns integer language plpgsql as $$
declare v integer;
begin
  perform pg_temp.as_member(k);
  select count(*)::integer into v from public.activity_log a
  where a.entity in ('project_billing', 'cycle_billing', 'item_billing', 'revenue_overrides', 'project_advances')
     or a.diff::text ~ '(61234|31234|2718|12000|40000)' or a.meta::text ~ '(61234|31234|2718|12000|40000)';
  return v;
end;
$$;

select is(pg_temp.sees('admin'), 0, 'the client''s Admin reads no row of any money table or view');
select is(pg_temp.sees('admin2'), 0, 'another Admin reads none');
select is(pg_temp.sees('staff'), 0, 'Crew read none');
select is(pg_temp.sees('free'), 0, 'a freelancer reads none');
select is(pg_temp.refused('admin'), 'FORBIDDEN', 'the client''s Admin is refused by all eight functions');
select is(pg_temp.refused('admin2'), 'FORBIDDEN', 'another Admin is refused by all eight');
select is(pg_temp.refused('staff'), 'FORBIDDEN', 'Crew are refused by all eight');
select is(pg_temp.refused('free'), 'UNAUTHENTICATED', 'a freelancer (no sign-in) is refused by all eight');
select is(pg_temp.audit_seen('admin'), 0, 'the client''s Admin reads no money audit row, and no amount in any row they can read');
select is(pg_temp.audit_seen('admin2'), 0, 'nor another Admin');
select is(pg_temp.audit_seen('staff'), 0, 'nor Crew');
select is(pg_temp.audit_seen('free'), 0, 'nor a freelancer');
select pg_temp.as_member('admin');
select ok((select count(*) > 0 from public.activity_log a where a.entity = 'project_items'),
  '(the client''s Admin does read the deliverables'' own history, so the check above is not empty)');
select ok(not exists (select 1 from public.projects p where to_jsonb(p)::text ~ '(61234|31234|2718|40000)')
          and not exists (select 1 from public.project_cycles c where to_jsonb(c)::text ~ '(61234|31234|2718|12000|40000)')
          and not exists (select 1 from public.project_items i where to_jsonb(i)::text ~ '(61234|31234|2718|12000|40000)'),
  'the project, cycle and deliverable rows an Admin reads hold no amount');
select pg_temp.as_anon();
select ok((select bool_and(pg_temp.n('select 1 from public.' || r) = -1) from rel), 'anon has no privilege on any table or view');
select is((select string_agg(distinct pg_temp.code(c), ',') from calls), 'NO_PRIVILEGE', 'nor on any function');
select pg_temp.as_system();
select ok(not exists (select 1 from public.notifications n
                      where n.entity in ('project_billing', 'cycle_billing', 'item_billing', 'revenue_overrides', 'project_advances')
                         or coalesce(n.title, '') || coalesce(n.body, '') || n.payload::text ~ '(61234|31234|2718|12000|40000)'),
  'no notification carries money or points at a money row');
select is((select count(*)::integer from public.notifications n where n.recipient_id = pg_temp.fx('owner') and n.kind like '%billing%'), 0,
  'the money functions notify nobody');
select ok((select bool_and(a.actor_id = pg_temp.fx('owner')) from public.activity_log a
           where a.entity in ('project_billing', 'cycle_billing', 'revenue_overrides', 'project_advances')
             and a.action not in ('insert')),
  'every named money change is the Owner''s');
select is((select count(*)::integer from public.activity_log a where a.entity = 'cycle_billing' and a.action = 'insert'
            and a.entity_id = pg_temp.fx('later')), 1,
  'the copy made when a cycle is created is audited under cycle_billing, where only the Owner reads it');

-- Another organization's Owner reads nothing of this one.
insert into fx values ('org_b', '00000000-0000-4000-8000-000000144910'), ('b_owner', '00000000-0000-4000-8000-000000144911');
insert into public.organizations (id, name) values (pg_temp.fx('org_b'), 'Other org 144');
insert into auth.users (id, email) values (pg_temp.fx('b_owner'), 'b-owner-144@example.com');
insert into public.members (id, org_id, full_name, email, role, status, engagement, joined_at) values
  (pg_temp.fx('b_owner'), pg_temp.fx('org_b'), 'Other Owner', 'b-owner-144@example.com', 'owner', 'active', 'permanent', now());
select is(pg_temp.sees('b_owner'), 0, 'another organization''s Owner reads no row');
select is(pg_temp.code($$select public.billing_set_project(pg_temp.fx('p'), 5, true, null)$$), 'NOT_FOUND', 'and cannot set this one''s billing');
select is(pg_temp.code($$select public.billing_mark(array[pg_temp.fx('cur')], true, null, null)$$), 'NOT_FOUND', 'or mark its cycles');
select is(pg_temp.code($$select public.advance_return(pg_temp.fx('adv1'), null, null)$$), 'NOT_FOUND', 'or touch its advances');
select is(pg_temp.code($$select public.revenue_override_clear('cycle', pg_temp.fx('cur'), 'x')$$), 'NOT_FOUND', 'or its adjustments');

select * from finish();
rollback;
