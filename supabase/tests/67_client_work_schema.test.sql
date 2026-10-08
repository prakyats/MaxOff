-- 7A (7.1) Client work schema: the enums, the grants (clients.create; amendment C's Admin keys),
-- stage_presets and project_templates for every role (allowed and denied), the seven function-only
-- tables' RLS for every role (the Owner, the client's Admin, another Admin, Crew, a deactivated
-- member, anon), the activity policy, the fixed and protected columns, the custom field checks and
-- the definitions' type lock, and client_create (kickoff 7 amendment B) on every path.
begin;
create extension if not exists pgtap with schema extensions;
select plan(125);

-- The local seed holds an organization and sign-ins. Keep the organization; replace the people
-- with fixtures. Rolled back at the end. Order follows the foreign keys.
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

create temporary table fx (key text primary key, id uuid not null);
insert into fx values
  ('owner',       '00000000-0000-4000-8000-000000000001'),
  ('admin',       '00000000-0000-4000-8000-000000000002'),
  ('admin2',      '00000000-0000-4000-8000-000000000003'),
  ('staff',       '00000000-0000-4000-8000-000000000004'),
  ('gone_admin',  '00000000-0000-4000-8000-000000000005'),
  ('client_a',    '00000000-0000-4000-8000-0000000000a1'),
  ('client_b',    '00000000-0000-4000-8000-0000000000b1');
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

create function pg_temp.update_count(sql text) returns bigint language plpgsql as $$
declare n bigint;
begin
  execute sql;
  get diagnostics n = row_count;
  return n;
end;
$$;

-- Structure ----------------------------------------------------------------------------------------
select has_type('public', 'recurrence', 'recurrence exists');
select has_type('public', 'project_state', 'project_state exists');
select has_type('public', 'cycle_state', 'cycle_state exists');
select has_type('public', 'item_state', 'item_state exists');
select has_type('public', 'carry_decision', 'carry_decision exists');
select hasnt_type('public', 'billing_category', 'no billing category in phase 7 (amendment C: money, phase 9)');
select enum_has_labels('public', 'recurrence', array['one_time', 'weekly', 'monthly'], 'recurrence values (DATA-MODEL §0)');
select enum_has_labels('public', 'item_state', array['open', 'done', 'approved', 'cancelled', 'carried'], 'item_state values');
select enum_has_labels('public', 'carry_decision', array['carry_forward', 'close', 'leave_pending'], 'carry_decision values');
select has_table('public', 'stage_presets', 'stage_presets exists');
select has_table('public', 'project_templates', 'project_templates exists');
select has_table('public', 'projects', 'projects exists');
select has_table('public', 'project_stages', 'project_stages exists');
select has_table('public', 'project_item_blueprints', 'project_item_blueprints exists');
select has_table('public', 'project_cycles', 'project_cycles exists');
select has_table('public', 'project_items', 'project_items exists');
select has_table('public', 'project_item_stages', 'project_item_stages exists');
select has_table('public', 'item_reviews', 'item_reviews exists');
select has_column('public', 'projects', 'delivery_date', 'projects.delivery_date (amendment A)');
select hasnt_column('public', 'projects', 'billing_category', 'projects has no billing category (amendment C3)');
select hasnt_column('public', 'project_templates', 'default_billing_category', 'project templates have no billing category (amendment C3)');
select has_column('public', 'project_stages', 'archived_at', 'project_stages.archived_at (decision 8)');
select has_column('public', 'stage_presets', 'created_by', 'stage_presets.created_by (decision 22)');
select is((select count(*)::integer from information_schema.columns
           where table_schema = 'public'
             and table_name in ('stage_presets', 'project_templates', 'projects', 'project_stages',
                                'project_item_blueprints', 'project_cycles', 'project_items',
                                'project_item_stages', 'item_reviews')
             and (column_name ~ '(amount|value|price|fee|billing|revenue)' or data_type in ('numeric', 'money'))),
  0, 'no amount, value or billing column on any client-work table (ADR-0007)');
select is((select count(*)::integer from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity
             and c.relname in ('stage_presets', 'project_templates', 'projects', 'project_stages',
                               'project_item_blueprints', 'project_cycles', 'project_items',
                               'project_item_stages', 'item_reviews')), 9,
  'RLS is on for all nine tables');
select ok(not exists (
  select 1 from unnest(array['stage_presets', 'project_templates', 'projects', 'project_stages',
    'project_item_blueprints', 'project_cycles', 'project_items', 'project_item_stages', 'item_reviews']) t
  where has_table_privilege('anon', 'public.' || t, 'select, insert, update, delete')),
  'anon has no privilege on any client-work table');
select ok(not exists (
  select 1 from unnest(array['projects', 'project_stages', 'project_item_blueprints', 'project_cycles',
    'project_items', 'project_item_stages', 'item_reviews']) t
  where has_table_privilege('authenticated', 'public.' || t, 'insert, update, delete, truncate, references, trigger')
     or not has_table_privilege('authenticated', 'public.' || t, 'select')),
  'the seven client-work tables: SELECT only for the API role (every write is a transition function)');
select ok(not has_table_privilege('authenticated', 'public.stage_presets', 'delete')
          and not has_table_privilege('authenticated', 'public.project_templates', 'delete')
          and has_column_privilege('authenticated', 'public.stage_presets', 'name', 'update')
          and not has_column_privilege('authenticated', 'public.stage_presets', 'created_by', 'update')
          and not has_column_privilege('authenticated', 'public.stage_presets', 'org_id', 'insert')
          and has_column_privilege('authenticated', 'public.project_templates', 'items', 'update')
          and not has_column_privilege('authenticated', 'public.project_templates', 'created_by', 'update'),
  'presets and templates: no DELETE; column grants keep the author and organization out of reach');
select has_function('public', 'client_create', array['jsonb'], 'client_create(jsonb) exists');
select ok(has_function_privilege('authenticated', 'public.client_create(jsonb)', 'execute')
          and not has_function_privilege('anon', 'public.client_create(jsonb)', 'execute'),
  'client_create: authenticated, never anon');
select ok(not has_function_privilege('authenticated', 'app.custom_fields_check(text, uuid, jsonb, jsonb)', 'execute'),
  'the custom-field check is internal');

-- Grants (PERMISSIONS §1) ----------------------------------------------------------------------------
select is((select array_agg(role::text order by role) from public.role_permissions where permission = 'clients.create'),
  array['owner', 'admin'], 'clients.create: the Owner and Admins (amendment B)');
select is((select array_agg(permission order by permission) from public.role_permissions
           where role = 'admin' and permission in ('items.approve', 'cycles.carry_decide', 'projects.complete')),
  array['cycles.carry_decide', 'items.approve', 'projects.complete'],
  'Admins hold items.approve, cycles.carry_decide and projects.complete (amendment C)');
select is((select count(*)::integer from public.role_permissions
           where role = 'staff' and (permission like 'projects.%' or permission like 'items.%'
                                     or permission like 'cycles.%' or permission like 'clients.%')), 0,
  'Crew hold no client or client-work key');

insert into auth.users (id, email)
select id, key || '@example.com' from fx where key not in ('org') and key not like 'client_%';
insert into public.members (id, org_id, full_name, email, role, status, joined_at, deactivated_at) values
  (pg_temp.fx('owner'),      pg_temp.fx('org'), 'Test Owner',  'owner@example.com',      'owner', 'active',      now(), null),
  (pg_temp.fx('admin'),      pg_temp.fx('org'), 'Ravi Admin',  'admin@example.com',      'admin', 'active',      now(), null),
  (pg_temp.fx('admin2'),     pg_temp.fx('org'), 'Other Admin', 'admin2@example.com',     'admin', 'active',      now(), null),
  (pg_temp.fx('staff'),      pg_temp.fx('org'), 'Test Crew',   'staff@example.com',      'staff', 'active',      now(), null),
  (pg_temp.fx('gone_admin'), pg_temp.fx('org'), 'Gone Admin',  'gone_admin@example.com', 'admin', 'deactivated', now(), now());
insert into public.clients (id, org_id, name, state, admin_id, activated_at) values
  (pg_temp.fx('client_a'), pg_temp.fx('org'), 'Sharma Weddings', 'active', pg_temp.fx('admin'), now()),
  (pg_temp.fx('client_b'), pg_temp.fx('org'), 'Blue Bakery', 'active', pg_temp.fx('admin2'), now());
-- One project field (Owner-only definitions, PERMISSIONS ¹) for the value checks.
insert into public.field_definitions (org_id, entity, key, label, type, position)
values (pg_temp.fx('org'), 'project', 'platform', 'Platform', 'text', 'a0'),
       (pg_temp.fx('org'), 'item', 'views', 'Views', 'number', 'a0');
delete from public.activity_log;

-- stage_presets for every role (decision 22, PERMISSIONS ⁴) -------------------------------------------
select pg_temp.as_member('owner');
select lives_ok($$ insert into public.stage_presets (name, stages) values ('  Owner preset ', array[' A ', 'B']) $$,
  'the Owner adds a preset');
select is((select name || ':' || array_to_string(stages, ',') from public.stage_presets where created_by = pg_temp.fx('owner')),
  'Owner preset:A,B', 'the name and stages are trimmed; the author is the Owner');
select pg_temp.as_member('admin');
select lives_ok($$ insert into public.stage_presets (name, stages) values ('Admin preset', array['Shoot', 'Edit']) $$,
  'an Admin adds a preset');
select is((select count(*)::integer from public.stage_presets), 2, 'an Admin reads every preset (shared)');
select is(pg_temp.update_count($$ update public.stage_presets set name = 'Renamed' where created_by = pg_temp.fx('admin') $$), 1::bigint,
  'an Admin edits their own preset');
select is(pg_temp.update_count($$ update public.stage_presets set name = 'Taken over' where created_by = pg_temp.fx('owner') $$), 0::bigint,
  'an Admin never edits the Owner''s preset');
select throws_ok($$ insert into public.stage_presets (name, stages, created_by) values ('Forged', array['A'], '00000000-0000-4000-8000-000000000001') $$,
  '42501', null, 'an Admin cannot name another author (no column grant)');
select throws_ok($$ insert into public.stage_presets (name, stages) values ('Too long', array['1','2','3','4','5','6','7','8','9','10','11','12','13']) $$,
  '23514', null, 'a preset has at most 12 stages');
select throws_ok($$ insert into public.stage_presets (name, stages) values ('Empty stage', array['A', '  ']) $$,
  'P0001', 'VALIDATION', 'each stage needs a name');
select throws_ok($$ delete from public.stage_presets $$, '42501', null, 'nobody deletes a preset (archive)');
select pg_temp.as_member('admin2');
select is(pg_temp.update_count($$ update public.stage_presets set archived_at = now() where created_by = pg_temp.fx('admin') $$), 0::bigint,
  'another Admin never archives an Admin''s preset');
select pg_temp.as_member('owner');
select is(pg_temp.update_count($$ update public.stage_presets set archived_at = now() where created_by = pg_temp.fx('admin') $$), 1::bigint,
  'the Owner archives any preset');
select pg_temp.as_member('staff');
select is((select count(*)::integer from public.stage_presets), 0, 'Crew read no preset');
select throws_ok($$ insert into public.stage_presets (name, stages) values ('Crew preset', array['A']) $$,
  '42501', null, 'Crew add no preset');
select pg_temp.as_member('gone_admin');
select is((select count(*)::integer from public.stage_presets), 0, 'a deactivated Admin reads nothing');
select pg_temp.as_anon();
select throws_ok($$ select count(*) from public.stage_presets $$, '42501', null, 'anon reads nothing');

-- project_templates for every role (decision 23) ---------------------------------------------------
select pg_temp.as_member('admin');
select lives_ok($$ insert into public.project_templates (name, recurrence, stages, items, field_defaults)
                   values ('Monthly reels', 'monthly', array['Script', 'Edit'], array[' Reel 1 ', 'Reel 2'], '{"platform": "Instagram"}') $$,
  'an Admin adds a project template with stages, items and a field default');
select is((select array_to_string(items, ',') from public.project_templates where name = 'Monthly reels'), 'Reel 1,Reel 2',
  'the items are trimmed');
select throws_ok($$ insert into public.project_templates (name, recurrence, field_defaults) values ('Bad', 'weekly', '{"nope": 1}') $$,
  'P0001', 'VALIDATION', 'a default for a field that does not exist is refused');
select throws_ok($$ insert into public.project_templates (name, recurrence, items) values ('Bad items', 'weekly', array['']) $$,
  'P0001', 'VALIDATION', 'an empty item title is refused');
select pg_temp.as_member('admin2');
select is((select count(*)::integer from public.project_templates), 1, 'another Admin reads the shared template');
select is(pg_temp.update_count($$ update public.project_templates set name = 'Mine now' $$), 0::bigint,
  'another Admin never edits it');
select pg_temp.as_member('owner');
select is(pg_temp.update_count($$ update public.project_templates set description = 'Owner edit' $$), 1::bigint,
  'the Owner edits any template');
select pg_temp.as_member('staff');
select is((select count(*)::integer from public.project_templates), 0, 'Crew read no template');
select throws_ok($$ insert into public.project_templates (name, recurrence) values ('Crew', 'weekly') $$,
  '42501', null, 'Crew add no template');

-- Projects: built through the functions, read under RLS ---------------------------------------------
select pg_temp.as_member('owner');
insert into fx values ('p_a', public.project_create(pg_temp.fx('client_a'), 'Monthly reels', 'monthly',
  'Four reels a month', null, array['Script', 'Edit'], array['Reel 1', 'Reel 2'], null, '{"platform": "Instagram"}'));
insert into fx values ('p_b', public.project_create(pg_temp.fx('client_b'), 'Launch film', 'one_time',
  null, app.today_ist() + 30, array['Shoot'], array['Film'], null, '{}'));
select pg_temp.as_system();
grant select on fx to authenticated;

select pg_temp.as_member('owner');
select is((select count(*)::integer from public.projects), 2, 'the Owner reads every project');
select is((select count(*)::integer from public.project_items), 3, 'and every item');
select pg_temp.as_member('admin');
select is((select array_agg(name) from public.projects), array['Monthly reels'], 'an Admin reads the projects of their clients only');
select is((select count(*)::integer from public.project_stages), 2, 'their stages');
select is((select count(*)::integer from public.project_item_blueprints), 2, 'their item list');
select is((select count(*)::integer from public.project_cycles), 1, 'their cycles');
select is((select count(*)::integer from public.project_items), 2, 'their items');
select is((select count(*)::integer from public.projects where id = pg_temp.fx('p_b')), 0,
  'never another Admin''s client''s project');
select throws_ok($$ insert into public.projects (org_id, client_id, name, recurrence, created_by)
                   values (pg_temp.fx('org'), pg_temp.fx('client_a'), 'Direct', 'weekly', pg_temp.fx('admin')) $$,
  '42501', null, 'an Admin inserts no project through the API');
select throws_ok($$ update public.projects set name = 'Direct edit' $$, '42501', null, 'nor updates one');
select throws_ok($$ update public.project_items set state = 'approved' $$, '42501', null, 'nor moves an item''s state');
select throws_ok($$ delete from public.project_items $$, '42501', null, 'nor deletes an item');
select pg_temp.as_member('owner');
select throws_ok($$ update public.projects set state = 'completed' $$, '42501', null,
  'the Owner moves no state through the API either');
select throws_ok($$ insert into public.item_reviews (org_id, item_id, decision, reviewer_id)
                   select org_id, id, 'approved', pg_temp.fx('owner') from public.project_items limit 1 $$,
  '42501', null, 'nor writes a review');
select pg_temp.as_member('admin2');
select is((select array_agg(name) from public.projects), array['Launch film'], 'the other Admin reads only their client''s project');
select is((select count(*)::integer from public.project_items where project_id = pg_temp.fx('p_a')), 0,
  'and none of the first Admin''s items');
select pg_temp.as_member('staff');
select is((select count(*)::integer from public.projects), 0, 'Crew read no project');
select is((select count(*)::integer from public.project_stages) + (select count(*)::integer from public.project_item_blueprints)
          + (select count(*)::integer from public.project_cycles) + (select count(*)::integer from public.project_items)
          + (select count(*)::integer from public.project_item_stages) + (select count(*)::integer from public.item_reviews), 0,
  'nor any stage, list entry, cycle, item, tick or review');
select is((select count(*)::integer from public.activity_log where entity like 'project%' or entity = 'item_reviews'), 0,
  'nor any client-work history');
select pg_temp.as_member('gone_admin');
select is((select count(*)::integer from public.projects), 0, 'a deactivated Admin reads nothing');
select pg_temp.as_anon();
select throws_ok($$ select count(*) from public.project_items $$, '42501', null, 'anon reads nothing');

-- A tick and a review, then their visibility.
select pg_temp.as_member('admin');
select public.item_tick_stage((select id from public.project_items where project_id = pg_temp.fx('p_a') order by position limit 1),
  (select id from public.project_stages where project_id = pg_temp.fx('p_a') order by position limit 1));
select public.item_mark_done((select id from public.project_items where project_id = pg_temp.fx('p_a') order by position limit 1));
select public.item_approve(array(select id from public.project_items where project_id = pg_temp.fx('p_a') and state = 'done'));
select is((select count(*)::integer from public.project_item_stages), 1, 'the client''s Admin reads the tick');
select is((select count(*)::integer from public.item_reviews), 1, 'and the review');
select pg_temp.as_member('admin2');
select is((select count(*)::integer from public.project_item_stages) + (select count(*)::integer from public.item_reviews), 0,
  'another Admin reads neither');

-- The history (activity_log_select_client_work).
select pg_temp.as_member('admin');
select ok((select count(*) from public.activity_log where entity = 'projects' and entity_id = pg_temp.fx('p_a')) > 0
          and (select count(*) from public.activity_log where entity = 'project_items') > 0,
  'the client''s Admin reads their project''s and items'' history');
select is((select count(*)::integer from public.activity_log
           where (entity = 'projects' and entity_id = pg_temp.fx('p_b'))
              or (entity = 'project_items' and entity_id in (select id from public.project_items where project_id = pg_temp.fx('p_b')))), 0,
  'and never another Admin''s');
select pg_temp.as_member('admin2');
select ok((select count(*) from public.activity_log where entity = 'projects' and entity_id = pg_temp.fx('p_b')) > 0,
  'the other Admin reads their own project''s history');

-- Scope is live: reassigning the client moves access at once.
select pg_temp.as_member('owner');
select public.client_assign_admin(pg_temp.fx('client_a'), pg_temp.fx('admin2'));
select pg_temp.as_member('admin');
select is((select count(*)::integer from public.projects), 0, 'the previous Admin loses the projects at once');
select pg_temp.as_member('admin2');
select is((select count(*)::integer from public.projects), 2, 'the new Admin reads them');
select pg_temp.as_member('owner');
select public.client_assign_admin(pg_temp.fx('client_a'), pg_temp.fx('admin'));

-- Fixed and protected columns, values ----------------------------------------------------------------
select pg_temp.as_system();
select throws_ok($$ update public.projects set recurrence = 'weekly' where id = pg_temp.fx('p_a') $$,
  'P0001', 'FORBIDDEN', 'a project''s recurrence never changes, not even inside a function (decision 4)');
select throws_ok($$ update public.projects set client_id = pg_temp.fx('client_b') where id = pg_temp.fx('p_a') $$,
  'P0001', 'FORBIDDEN', 'nor its client');
select throws_ok($$ insert into public.projects (org_id, client_id, name, recurrence, created_by)
                   values (pg_temp.fx('org'), pg_temp.fx('client_a'), 'No date', 'one_time', pg_temp.fx('owner')) $$,
  '23514', null, 'a one-time project needs a delivery date (amendment A, the check)');
select throws_ok($$ update public.projects set custom_fields = '{"nope": "x"}' where id = pg_temp.fx('p_a') $$,
  'P0001', 'VALIDATION', 'a project''s field values are checked on every write');
select throws_ok($$ update public.project_items set custom_fields = '{"views": "many"}' where project_id = pg_temp.fx('p_a') $$,
  'P0001', 'VALIDATION', 'an item''s too (a number field takes a number)');
select lives_ok($$ update public.project_items set custom_fields = '{"views": 1200}' where project_id = pg_temp.fx('p_a') $$,
  'a valid item value is kept');
select throws_ok($$ update public.field_definitions set type = 'number' where key = 'platform' $$,
  'P0001', 'INVALID_STATE', 'a project field''s type is locked once a project holds a value');
select throws_ok($$ update public.field_definitions set type = 'text' where key = 'views' $$,
  'P0001', 'INVALID_STATE', 'an item field''s type likewise');
select throws_ok($$ insert into public.project_cycles (org_id, project_id, generated_by)
                   values (pg_temp.fx('org'), pg_temp.fx('p_b'), 'manual') $$,
  '23505', null, 'a one-time project has exactly one cycle');
select throws_ok($$ insert into public.project_cycles (org_id, project_id, period_start, period_end, label, generated_by)
                   select org_id, project_id, period_start, period_end, label, 'manual' from public.project_cycles
                   where project_id = pg_temp.fx('p_a') limit 1 $$,
  '23505', null, 'a recurring project has one cycle per period');

-- client_create (kickoff 7 amendment B) ------------------------------------------------------------------
select pg_temp.as_system();
delete from public.notifications;
select pg_temp.as_member('admin');
select throws_ok($$ insert into public.clients (name) values ('Direct client') $$, '42501', null,
  'an Admin''s API insert of a client is refused');
select lives_ok($$ insert into fx values ('client_n', public.client_create('{"name": " New Cafe ", "city": "Pune"}')) $$,
  'an Admin creates a client through client_create');
select pg_temp.as_system();
select is((select state::text || ':' || (admin_id = pg_temp.fx('admin'))::text || ':' || (activated_at is not null)::text || ':' || name
           from public.clients where id = pg_temp.fx('client_n')),
  'active:true:true:New Cafe', 'created Active, the Admin is the caller, activated, the name trimmed');
select is((select count(*)::integer from public.client_admin_assignments
           where client_id = pg_temp.fx('client_n') and admin_id = pg_temp.fx('admin') and to_at is null
             and assigned_by = pg_temp.fx('admin')), 1, 'the first assignment row is open');
select is((select count(*)::integer from public.client_private where client_id = pg_temp.fx('client_n'))
          + (select count(*)::integer from public.client_brand where client_id = pg_temp.fx('client_n')), 2,
  'the Owner-only notes row and the brand row come with it');
select is((select count(*)::integer from public.activity_log
           where entity = 'clients' and entity_id = pg_temp.fx('client_n') and action = 'created_active'
             and actor_id = pg_temp.fx('admin') and diff -> 'new' ->> 'state' = 'active'
             and meta ->> 'admin_id' = pg_temp.fx('admin')::text), 1,
  'audited: created_active, by the Admin, the new row in its diff (7A review L6)');
select is((select count(*)::integer from public.activity_log
           where entity = 'clients' and entity_id = pg_temp.fx('client_n') and action = 'insert'), 0,
  'one entry for the client, never a plain insert beside it');
select is((select string_agg(action, ',' order by entity) from public.activity_log
           where entity in ('client_private', 'client_brand', 'client_admin_assignments')
             and (entity_id = pg_temp.fx('client_n')
                  or entity_id in (select a.id from public.client_admin_assignments a where a.client_id = pg_temp.fx('client_n')))),
  'insert,insert,insert', 'the rows created with it keep their plain insert entries');
select is((select title from public.notifications where recipient_id = pg_temp.fx('owner') and kind = 'client_created'),
  'Ravi Admin added the client New Cafe', 'the Owner is told "‹Admin› added the client ‹name›"');
select is((select link from public.notifications where recipient_id = pg_temp.fx('owner') and kind = 'client_created'),
  '/clients/' || pg_temp.fx('client_n'), 'opening the client');
select is((select count(*)::integer from public.notifications where recipient_id <> pg_temp.fx('owner')), 0,
  'the creating Admin (the actor) gets nothing');
select ok(not (select actionable or always_email from public.notification_kinds where kind = 'client_created'),
  'client_created is info: never email');
select pg_temp.as_member('admin');
select is((select count(*)::integer from public.clients where id = pg_temp.fx('client_n')), 1,
  'the Admin reads the client at once');
select is((select count(*)::integer from public.client_private where client_id = pg_temp.fx('client_n')), 0,
  'but never the Owner''s notes on it');
select throws_ok($$ select public.client_create('{"name": "new cafe"}') $$, 'P0001', 'CONFLICT',
  'the name rule holds (unique among clients not Inactive)');
select throws_ok($$ select public.client_create('{"name": "X", "admin_id": "00000000-0000-4000-8000-000000000003"}') $$,
  'P0001', 'VALIDATION', 'an Admin cannot name another Admin (or any other column)');
select throws_ok($$ select public.client_create('{"name": "X", "state": "draft"}') $$,
  'P0001', 'VALIDATION', 'nor choose the state');
select throws_ok($$ select public.client_create('{"city": "Pune"}') $$, 'P0001', 'VALIDATION', 'a name is required');
select throws_ok($$ select public.client_create('{"name": "Bad GST", "gstin": "nope"}') $$, 'P0001', 'VALIDATION',
  'a detail out of its format is VALIDATION');
select throws_ok($$ select public.client_create('{"name": "Fields", "custom_fields": {"nope": 1}}') $$, 'P0001', 'VALIDATION',
  'a client field that does not exist is refused');
select pg_temp.as_member('owner');
select throws_ok($$ select public.client_create('{"name": "Owner client"}') $$, 'P0001', 'FORBIDDEN',
  'the Owner adds a draft by the plain insert instead');
select lives_ok($$ insert into public.clients (name, admin_id) values ('Owner draft', '00000000-0000-4000-8000-000000000003') $$,
  'the Owner''s draft with any Admin is unchanged');
select is((select state::text from public.clients where name = 'Owner draft'), 'draft', 'and stays a draft');
select pg_temp.as_member('staff');
select throws_ok($$ select public.client_create('{"name": "Crew client"}') $$, 'P0001', 'FORBIDDEN', 'Crew cannot create a client');
select pg_temp.as_member('gone_admin');
select throws_ok($$ select public.client_create('{"name": "Gone client"}') $$, 'P0001', 'UNAUTHENTICATED',
  'a deactivated Admin cannot');
select pg_temp.as_anon();
select throws_ok($$ select public.client_create('{"name": "Anon client"}') $$, '42501', null, 'anon cannot call it');

select pg_temp.as_system();
-- The seeded preset (decision 22, data only): a new organisation gets one, by trigger -----------------
insert into public.organizations (id, name) values ('00000000-0000-4000-8000-0000000000ee', 'Second Org');
select is((select count(*)::integer from public.stage_presets sp
           where sp.org_id = '00000000-0000-4000-8000-0000000000ee' and sp.created_by is null
             and sp.archived_at is null), 1,
  'a new organisation is seeded with one active preset by trigger, with no author (data only: owner note 3)');

select * from finish();
rollback;
