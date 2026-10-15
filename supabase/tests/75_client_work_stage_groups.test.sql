-- Phase 6b Release 1 (owner 2026-10-12/13; migration client_work_stage_groups; DATA-MODEL §5b): stage
-- groups on a project's default stages and on a deliverable's own stages, item-list lines and
-- templates holding groups and deliverables, the 100-stage limit, and every new function on every
-- role: the Owner (any client), the client's Admin (their own), another Admin (NOT_FOUND), Crew
-- (FORBIDDEN), a deactivated Admin (UNAUTHENTICATED), anon (no privilege). Everything is proved on
-- TODAY-shape data too (a template and a project made the old way, with ticks, a date, a note and
-- history), with nothing existing changed. Every name here is neutral: nothing is pre-defined.
begin;
create extension if not exists pgtap with schema extensions;
select plan(174);

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

create temporary table fx (key text primary key, id uuid not null);
insert into fx values
  ('owner',      '00000000-0000-4000-8000-000000007501'),
  ('admin',      '00000000-0000-4000-8000-000000007502'),
  ('admin2',     '00000000-0000-4000-8000-000000007503'),
  ('staff',      '00000000-0000-4000-8000-000000007504'),
  ('gone_admin', '00000000-0000-4000-8000-000000007505'),
  ('client_a',   '00000000-0000-4000-8000-0000000075a1'),
  ('client_b',   '00000000-0000-4000-8000-0000000075b1');
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
exception when sqlstate 'P0001' then
  return sqlerrm;
end;
$$;
-- The latest item of a title.
create function pg_temp.item(t text) returns uuid language sql stable security definer as $$
  select i.id from public.project_items i where i.title = $1 order by i.created_at desc, i.id limit 1;
$$;
-- An item's active stages as the screens order them: "Group·Name" (no group: "Name"), "✓" when ticked.
create function pg_temp.gstages(p_item uuid) returns text language sql stable security definer as $$
  select coalesce(string_agg(
    coalesce(s.group_label || '·', '') || s.name || case when s.done_at is null then '' else '✓' end,
    ',' order by s.group_position collate "C" nulls first, s.position collate "C"), '')
  from public.project_item_stage_list s where s.item_id = p_item and s.archived_at is null;
$$;
create function pg_temp.istages(t text) returns text language sql stable security definer as $$
  select pg_temp.gstages(pg_temp.item($1));
$$;
-- A project's active default stages the same way.
create function pg_temp.pstages(p uuid) returns text language sql stable security definer as $$
  select coalesce(string_agg(coalesce(s.group_label || '·', '') || s.name,
    ',' order by s.group_position collate "C" nulls first, s.position collate "C"), '')
  from public.project_stages s where s.project_id = p and s.archived_at is null;
$$;
create function pg_temp.pstage(p uuid, n text, g text) returns uuid language sql stable security definer as $$
  select s.id from public.project_stages s
  where s.project_id = p and s.name = n and s.group_label is not distinct from g and s.archived_at is null;
$$;
create function pg_temp.istage(p_item uuid, n text, g text) returns uuid language sql stable security definer as $$
  select s.id from public.project_item_stage_list s
  where s.item_id = p_item and s.name = n and s.group_label is not distinct from g and s.archived_at is null;
$$;
-- A stage list of N neutral names.
create function pg_temp.names(n integer) returns text[] language sql immutable as $$
  select array_agg('Stage ' || g) from generate_series(1, n) g;
$$;

insert into auth.users (id, email)
select id, key || '@example.com' from fx where key not in ('org') and key not like 'client_%';
insert into public.members (id, org_id, full_name, email, role, status, joined_at, deactivated_at) values
  (pg_temp.fx('owner'),      pg_temp.fx('org'), 'Test Owner',  'owner@example.com',      'owner', 'active',      now(), null),
  (pg_temp.fx('admin'),      pg_temp.fx('org'), 'Test Admin',  'admin@example.com',      'admin', 'active',      now(), null),
  (pg_temp.fx('admin2'),     pg_temp.fx('org'), 'Other Admin', 'admin2@example.com',     'admin', 'active',      now(), null),
  (pg_temp.fx('staff'),      pg_temp.fx('org'), 'Test Crew',   'staff@example.com',      'staff', 'active',      now(), null),
  (pg_temp.fx('gone_admin'), pg_temp.fx('org'), 'Gone Admin',  'gone_admin@example.com', 'admin', 'deactivated', now(), now());
insert into public.clients (id, org_id, name, state, admin_id, activated_at) values
  (pg_temp.fx('client_a'), pg_temp.fx('org'), 'Client A', 'active', pg_temp.fx('admin'),  now()),
  (pg_temp.fx('client_b'), pg_temp.fx('org'), 'Client B', 'active', pg_temp.fx('admin2'), now());

-- ===========================================================================================================
-- 0. TODAY-shape data, made the old way before anything new is used: a template with shared stages and
--    an item list, and a monthly project with an item list, items with stages, a tick, a date, a note
--    and history. The blueprint lines lose their groups column as rows from before would have it.
-- ===========================================================================================================
select pg_temp.as_member('admin');
insert into public.project_templates (name, recurrence, stages, items)
values ('Old template', 'monthly', array['Phase A1', 'Phase A2'], array['Item 1', 'Item 2']);
insert into fx select 'old_t', id from public.project_templates where name = 'Old template';
insert into fx values ('old_p', public.project_create(pg_temp.fx('client_a'), 'Old project', 'monthly', null, null,
  array['Phase A1', 'Phase A2'], array['Item 1', 'Item 2']));
select pg_temp.as_system();
alter table public.project_item_blueprints disable trigger audit_row_change;
update public.project_item_blueprints set stage_groups = null where project_id = pg_temp.fx('old_p');
alter table public.project_item_blueprints enable trigger audit_row_change;
select pg_temp.as_member('admin');
insert into fx values ('old_i1', pg_temp.item('Item 1'));
insert into fx values ('old_i2', pg_temp.item('Item 2'));
select public.item_stage_tick(pg_temp.istage(pg_temp.fx('old_i1'), 'Phase A1', null));
select public.item_update(pg_temp.fx('old_i1'), '{"planned_date": "2026-10-20", "notes": "Keep this note"}');
select pg_temp.as_system();
create temporary table before_ticks as
  select s.id, s.name, s.position, s.done_at, s.done_by from public.project_item_stage_list s
  where s.item_id in (pg_temp.fx('old_i1'), pg_temp.fx('old_i2'));
create temporary table before_items as
  select i.id, i.title, i.planned_date, i.notes, i.state from public.project_items i
  where i.project_id = pg_temp.fx('old_p');
create temporary table before_log as
  select a.id, a.entity, a.entity_id, a.action, a.diff, a.meta from public.activity_log a
  where a.entity_id in (pg_temp.fx('old_p'), pg_temp.fx('old_i1'), pg_temp.fx('old_i2'));

-- ===========================================================================================================
-- 1. The schema
-- ===========================================================================================================
select has_column('public', 'project_stages', 'group_label', 'project_stages.group_label');
select has_column('public', 'project_stages', 'group_position', 'project_stages.group_position');
select has_column('public', 'project_item_stage_list', 'group_label', 'project_item_stage_list.group_label');
select has_column('public', 'project_item_blueprints', 'stage_groups', 'project_item_blueprints.stage_groups');
select has_column('public', 'project_templates', 'stage_groups', 'project_templates.stage_groups');
select has_column('public', 'project_templates', 'deliverables', 'project_templates.deliverables');
select is((select count(*)::integer from public.project_stages where group_label is not null or group_position is not null), 0,
  'rows from before groups have no group: the one untitled group');
select is((select count(*)::integer from public.project_item_stage_list where group_label is not null), 0,
  'a deliverable''s rows from before too');
select throws_ok($$ update public.project_stages set group_label = 'X' where project_id = pg_temp.fx('old_p') $$, '23514', null,
  'a label needs its order key and the other way round (the pair check)');
select is((select count(*)::integer from information_schema.columns
           where table_schema = 'public' and table_name in ('project_stages', 'project_item_stage_list', 'project_item_blueprints', 'project_templates')
             and (column_name ~ '(amount|value|price|fee|billing|revenue)' or data_type in ('numeric', 'money'))),
  0, 'no amount on any of them (ADR-0007)');
select pg_temp.as_member('admin');
select lives_ok($$ insert into public.stage_presets (name, stages) values ('Preset 100', pg_temp.names(100)) $$,
  'a preset takes 100 stages');
select throws_ok($$ insert into public.stage_presets (name, stages) values ('Preset 101', pg_temp.names(101)) $$, '23514', null,
  'never 101');

-- ===========================================================================================================
-- 2. The group shape, checked (app.stage_groups_check / app.deliverables_check)
-- ===========================================================================================================
select pg_temp.as_system();
select is(app.stage_groups_check('[{"label": " Phase B ", "stages": [" B1 "]}, {"label": null, "stages": ["U1"]}]'),
  '[{"label": null, "stages": ["U1"]}, {"label": "Phase B", "stages": ["B1"]}]'::jsonb,
  'groups come back trimmed, the untitled group first');
select is(app.stage_groups_check(null), '[]'::jsonb, 'null is no groups');
select is(app.stage_groups_flat('[{"label": null, "stages": ["U1"]}, {"label": "Phase B", "stages": ["B1", "B2"]}]'),
  array['U1', 'B1', 'B2'], 'flattened in order');
select is(app.stage_groups_of(array['A', 'B'], null), '[{"label": null, "stages": ["A", "B"]}]'::jsonb,
  'a plain list from before is one untitled group');
select is(app.stage_groups_of('{}', null), '[]'::jsonb, 'an empty list is no group');
select lives_ok($$ select app.stage_groups_check('[{"label": "Phase A", "stages": ["Edit"]}, {"label": "Phase B", "stages": ["Edit"]}]') $$,
  'the same stage name in two groups is fine');
select throws_ok($$ select app.stage_groups_check('[{"label": "Phase A", "stages": ["Edit", "edit"]}]') $$, 'P0001', 'VALIDATION',
  'but not twice in one group');
select throws_ok($$ select app.stage_groups_check('[{"label": null, "stages": ["A"]}, {"label": null, "stages": ["B"]}]') $$,
  'P0001', 'VALIDATION', 'only one untitled group');
select throws_ok($$ select app.stage_groups_check('[{"label": "Phase A", "stages": ["A"]}, {"label": "phase a", "stages": ["B"]}]') $$,
  'P0001', 'VALIDATION', 'a label once, ignoring case');
select throws_ok($$ select app.stage_groups_check('[{"label": "Phase A", "stages": []}]') $$, 'P0001', 'VALIDATION',
  'a group needs a stage');
select throws_ok($$ select app.stage_groups_check(jsonb_build_array(jsonb_build_object('label', null, 'stages', to_jsonb(pg_temp.names(101))))) $$,
  'P0001', 'VALIDATION', 'at most 100 stages in all');
select throws_ok($$ select app.stage_groups_check('{"label": "x"}') $$, 'P0001', 'VALIDATION', 'a list, not an object');
select is(app.deliverables_check('[{"title": " Item ", "stage_groups": null}]'),
  '[{"title": "Item", "stage_groups": null}]'::jsonb, 'a deliverable with null groups takes the defaults');
select throws_ok($$ select app.deliverables_check('[{"title": "  "}]') $$, 'P0001', 'VALIDATION', 'a title each');
select throws_ok($$ select app.deliverables_check((select jsonb_agg(jsonb_build_object('title', 'D' || g)) from generate_series(1, 101) g)) $$,
  'P0001', 'VALIDATION', 'at most 100 deliverables');
select pg_temp.as_system();
select is(app.stage_group_key_before('a0'), '5', 'a key before the first named group (internal; the midpoint)');
select is(app.stage_group_key_before('5'), '2', 'and before that one');
select is(app.stage_group_key_before(null), 'a0', 'the first key when there is none');
select ok(app.stage_group_key_before('0a') < '0a' and app.stage_group_key_before('1') < '1'
          and app.stage_group_key_before('01') < '01', 'always smaller, never running out');

-- ===========================================================================================================
-- 3. project_create_grouped: defaults in groups, deliverables with their own groups, × N expanded by
--    the screen (the function takes the final list)
-- ===========================================================================================================
select pg_temp.as_member('admin');
insert into fx values ('p_g', public.project_create_grouped(pg_temp.fx('client_a'), 'Grouped project', 'monthly', null, null,
  '[{"label": "Phase A", "stages": ["Edit", "Review"]}, {"label": "Phase B", "stages": ["Edit"]}]',
  '[{"title": "Item A 1", "stage_groups": null},
    {"title": "Item A 2", "stage_groups": [{"label": null, "stages": ["Brief"]}, {"label": "Phase C", "stages": ["Cut"]}]}]'));
select is(pg_temp.pstages(pg_temp.fx('p_g')), 'Phase A·Edit,Phase A·Review,Phase B·Edit',
  'the defaults sit in their groups, the same name in two groups allowed');
select is((select array_agg(distinct s.group_position order by s.group_position) from public.project_stages s where s.project_id = pg_temp.fx('p_g')),
  array['a0', 'a1'], 'each named group has its own key');
select is((select b.stages from public.project_item_blueprints b where b.project_id = pg_temp.fx('p_g') and b.title = 'Item A 1'),
  array['Edit', 'Review', 'Edit'], 'a line with no groups of its own takes the defaults, flattened');
select is((select b.stage_groups from public.project_item_blueprints b where b.project_id = pg_temp.fx('p_g') and b.title = 'Item A 2'),
  '[{"label": null, "stages": ["Brief"]}, {"label": "Phase C", "stages": ["Cut"]}]'::jsonb, 'a line keeps its own groups');
select is((select b.stages from public.project_item_blueprints b where b.project_id = pg_temp.fx('p_g') and b.title = 'Item A 2'),
  array['Brief', 'Cut'], 'and their flattened copy');
select is(pg_temp.istages('Item A 1'), 'Phase A·Edit,Phase A·Review,Phase B·Edit', 'the first cycle''s items start with them');
select is(pg_temp.istages('Item A 2'), 'Brief,Phase C·Cut', 'the untitled group first, then the named one');
select is((select count(*)::integer from public.activity_log where entity = 'project_item_stage_list'
           and entity_id = pg_temp.item('Item A 2') and action = 'initial'), 2, 'a new item''s stages are audited ''initial''');
insert into fx values ('p_one', public.project_create_grouped(pg_temp.fx('client_a'), 'One-time grouped', 'one_time', null, app.today_ist() + 7,
  '[{"label": "Phase A", "stages": ["Edit"]}]', '[{"title": "Single", "stage_groups": null}]'));
select is(pg_temp.istages('Single'), 'Phase A·Edit', 'a one-time project''s deliverable goes into its cycle with the groups');
select throws_ok($$ select public.project_create_grouped(pg_temp.fx('client_a'), 'Too many', 'monthly', null, null,
  jsonb_build_array(jsonb_build_object('label', null, 'stages', to_jsonb(pg_temp.names(101)))), '[]') $$, 'P0001', 'VALIDATION',
  'at most 100 default stages');
select throws_ok($$ select public.project_create_grouped(pg_temp.fx('client_a'), 'Bad group', 'monthly', null, null,
  '[{"label": "Phase A", "stages": ["Edit", "EDIT"]}]', '[]') $$, 'P0001', 'VALIDATION', 'a name twice in a group is refused');
select is(pg_temp.code($$ select public.project_create_grouped(pg_temp.fx('client_b'), 'Not mine', 'monthly') $$), 'NOT_FOUND',
  'another Admin''s client: NOT_FOUND');
select pg_temp.as_member('staff');
select is(pg_temp.code($$ select public.project_create_grouped(pg_temp.fx('client_a'), 'Crew', 'monthly') $$), 'FORBIDDEN', 'Crew: FORBIDDEN');
select pg_temp.as_member('gone_admin');
select is(pg_temp.code($$ select public.project_create_grouped(pg_temp.fx('client_a'), 'Gone', 'monthly') $$), 'UNAUTHENTICATED',
  'a deactivated Admin: UNAUTHENTICATED');
select pg_temp.as_anon();
select throws_ok($$ select public.project_create_grouped(pg_temp.fx('client_a'), 'Anon', 'monthly') $$, '42501', null, 'anon cannot call it');
select pg_temp.as_member('owner');
insert into fx values ('p_owner', public.project_create_grouped(pg_temp.fx('client_b'), 'Owner project', 'weekly', null, null,
  '[{"label": "Phase A", "stages": ["Edit"]}]', '[{"title": "Owner item", "stage_groups": null}]'));
select is(pg_temp.istages('Owner item'), 'Phase A·Edit', 'the Owner creates one on any client');

-- ===========================================================================================================
-- 4. A project's default stages: stages in groups, the group functions
-- ===========================================================================================================
select pg_temp.as_member('admin');
select ok(public.project_stage_add(pg_temp.fx('p_g'), 'Grade', 'Phase B') is not null, 'a stage into an existing group');
select ok(public.project_stage_add(pg_temp.fx('p_g'), 'Plan', 'phase d') is not null, 'a label no group has starts a new group');
select ok(public.project_stage_add(pg_temp.fx('p_g'), 'Loose') is not null, 'the 2-argument form: outside any group');
select is(pg_temp.pstages(pg_temp.fx('p_g')), 'Loose,Phase A·Edit,Phase A·Review,Phase B·Edit,Phase B·Grade,phase d·Plan',
  'the untitled group first, the new group last');
select throws_ok($$ select public.project_stage_add(pg_temp.fx('p_g'), 'edit', 'Phase A') $$, 'P0001', 'CONFLICT',
  'a name once per group, ignoring case');
select lives_ok($$ select public.project_stage_add(pg_temp.fx('p_g'), 'Edit', 'phase d') $$, 'but fine in another group');
select is(public.project_stage_update(pg_temp.pstage(pg_temp.fx('p_g'), 'Loose', null), '{"group_label": "Phase B"}'),
  array['position', 'group_label'], 'a stage moved into a group: at its end');
select is(pg_temp.pstages(pg_temp.fx('p_g')), 'Phase A·Edit,Phase A·Review,Phase B·Edit,Phase B·Grade,Phase B·Loose,phase d·Plan,phase d·Edit',
  'the order follows');
select throws_ok($$ select public.project_stage_update(pg_temp.pstage(pg_temp.fx('p_g'), 'Loose', 'Phase B'), '{"group_label": "Nowhere"}') $$,
  'P0001', 'VALIDATION', 'never into a group the project does not have');
select throws_ok($$ select public.project_stage_update(pg_temp.pstage(pg_temp.fx('p_g'), 'Loose', 'Phase B'), '{"name": "grade"}') $$,
  'P0001', 'CONFLICT', 'a rename never clashes within the group');
select lives_ok($$ select public.project_stage_group_add(pg_temp.fx('p_g'), 'Phase E', array['E1', 'E2']) $$,
  '"Fill from a preset" adds a group after the last');
select is(pg_temp.pstages(pg_temp.fx('p_g')), 'Phase A·Edit,Phase A·Review,Phase B·Edit,Phase B·Grade,Phase B·Loose,phase d·Plan,phase d·Edit,Phase E·E1,Phase E·E2',
  'with its stages in order');
select is((select meta ->> 'group' from public.activity_log where entity = 'project_stages'
           and entity_id = pg_temp.fx('p_g') and action = 'insert' order by id desc limit 1), 'Phase E',
  'each stage audited with its group');
select throws_ok($$ select public.project_stage_group_add(pg_temp.fx('p_g'), 'phase e', array['X']) $$, 'P0001', 'CONFLICT',
  'a group label once, ignoring case');
select throws_ok($$ select public.project_stage_group_add(pg_temp.fx('p_g'), 'Phase F', '{}') $$, 'P0001', 'VALIDATION',
  'a group needs a stage');
select throws_ok($$ select public.project_stage_group_add(pg_temp.fx('p_g'), 'Phase F', pg_temp.names(92)) $$, 'P0001', 'VALIDATION',
  'at most 100 active default stages in all');
select is(public.project_stage_group_update(pg_temp.fx('p_g'), 'phase d', '{"label": "Phase D"}'), array['label'],
  'a group renamed (found ignoring case)');
select is((select count(*)::integer from public.activity_log where entity = 'project_stages' and entity_id = pg_temp.fx('p_g')
           and action = 'group_renamed' and meta ->> 'group' = 'phase d' and meta ->> 'to' = 'Phase D'), 2,
  'every stage of it audited ''group_renamed'' with the old and new label');
select throws_ok($$ select public.project_stage_group_update(pg_temp.fx('p_g'), 'Phase D', '{"label": "Phase A"}') $$, 'P0001', 'CONFLICT',
  'never to a label another group has');
select is(public.project_stage_group_update(pg_temp.fx('p_g'), 'Phase E', '{"position": "0"}'), array['position'],
  'a named group moved by its key');
select is(pg_temp.pstages(pg_temp.fx('p_g')), 'Phase E·E1,Phase E·E2,Phase A·Edit,Phase A·Review,Phase B·Edit,Phase B·Grade,Phase B·Loose,Phase D·Plan,Phase D·Edit',
  'it now comes first');
select throws_ok($$ select public.project_stage_group_update(pg_temp.fx('p_g'), 'Phase A', '{"position": "0"}') $$, 'P0001', 'VALIDATION',
  'a key another group holds is refused');
select throws_ok($$ select public.project_stage_group_update(pg_temp.fx('p_g'), 'Nowhere', '{"label": "X"}') $$, 'P0001', 'NOT_FOUND',
  'an unknown group');
select lives_ok($$ select public.project_stage_group_archive(pg_temp.fx('p_g'), 'Phase D') $$, 'a whole group removed');
select is(pg_temp.pstages(pg_temp.fx('p_g')), 'Phase E·E1,Phase E·E2,Phase A·Edit,Phase A·Review,Phase B·Edit,Phase B·Grade,Phase B·Loose',
  'its stages are archived');
select is((select count(*)::integer from public.project_stages where project_id = pg_temp.fx('p_g') and group_label = 'Phase D' and archived_at is not null), 2,
  'never deleted');
select throws_ok($$ select public.project_stage_group_archive(pg_temp.fx('p_g'), 'Phase D') $$, 'P0001', 'NOT_FOUND', 'and gone for good');
select ok(public.project_blueprint_add(pg_temp.fx('p_g'), 'Item A 3') is not null, 'a new line of the item list');
select is((select b.stage_groups from public.project_item_blueprints b where b.project_id = pg_temp.fx('p_g') and b.title = 'Item A 3'),
  '[{"label": "Phase E", "stages": ["E1", "E2"]}, {"label": "Phase A", "stages": ["Edit", "Review"]}, {"label": "Phase B", "stages": ["Edit", "Grade", "Loose"]}]'::jsonb,
  'starts with the defaults as they stand, in their groups');
select ok(public.item_add((select cycle_id from public.project_items where id = pg_temp.item('Item A 1')), 'Item A added') is not null,
  'a deliverable added to the current cycle (review M1)');
select is(pg_temp.istages('Item A added'), 'Phase E·E1,Phase E·E2,Phase A·Edit,Phase A·Review,Phase B·Edit,Phase B·Grade,Phase B·Loose',
  'starts with the defaults in their groups, the same name in two groups included');
select is((select meta ->> 'name' from public.activity_log where entity = 'project_stages' and entity_id = pg_temp.fx('p_g')
           and action = 'group_renamed' order by id desc limit 1), 'Edit',
  'a default-stage group entry names its stage (review S3)');
select is(public.project_stage_update(pg_temp.pstage(pg_temp.fx('p_g'), 'Loose', 'Phase B'), '{"group_label": null}'),
  array['position', 'group_label'], 'a stage moved out of every group');
select is((select meta ->> 'name' from public.activity_log where entity = 'project_stages' and entity_id = pg_temp.fx('p_g')
           and action = 'update' order by id desc limit 1), 'Loose', 'named in the history');
select throws_ok($$ select public.project_stage_group_update(pg_temp.fx('p_g'), null, '{"position": "z"}') $$, 'P0001', 'VALIDATION',
  'the untitled group is not moved: it stays first');
select is(public.project_stage_group_update(pg_temp.fx('p_g'), null, '{"label": "Phase L"}'), array['label'],
  'the untitled default stages named');
select is(public.project_stage_group_update(pg_temp.fx('p_g'), 'Phase L', '{"label": null}'), array['label'],
  'and a named group made untitled again when none is');
select lives_ok($$ select public.project_stage_group_archive(pg_temp.fx('p_g'), null) $$, 'the stages outside a group removed');
select throws_ok($$ select public.project_stage_group_archive(pg_temp.fx('p_g'), null) $$, 'P0001', 'NOT_FOUND', 'none left');
select pg_temp.as_member('owner');
select lives_ok($$ select public.project_stage_group_add(pg_temp.fx('p_g'), 'Owner group', array['O1']) $$,
  'the Owner adds a group on any client''s project');
select is(public.project_stage_group_update(pg_temp.fx('p_g'), 'Owner group', '{"label": "Owner group 2"}'), array['label'], 'renames it');
select lives_ok($$ select public.project_stage_group_archive(pg_temp.fx('p_g'), 'Owner group 2') $$, 'and removes it');
select pg_temp.as_member('admin');

-- A completed project (and its approved deliverable) takes no group change.
select public.item_mark_done(pg_temp.item('Single'));
select public.project_complete(pg_temp.fx('p_one'));
select is(pg_temp.code($$ select public.project_stage_group_add(pg_temp.fx('p_one'), 'Late', array['X']) $$), 'INVALID_STATE',
  'a completed project: INVALID_STATE (group add)');
select is(pg_temp.code($$ select public.project_stage_add(pg_temp.fx('p_one'), 'X', 'Phase A') $$), 'INVALID_STATE', '(stage add)');
select is(pg_temp.code($$ select public.item_stage_group_add(pg_temp.item('Single'), 'Late', array['X']) $$), 'INVALID_STATE',
  'its approved deliverable too');

-- ===========================================================================================================
-- 5. A deliverable's own stages: the same, with every tick kept
-- ===========================================================================================================
insert into fx values ('i_a1', pg_temp.item('Item A 1'));
select public.item_stage_tick(pg_temp.istage(pg_temp.fx('i_a1'), 'Edit', 'Phase A'));
select is((select meta ->> 'group' from public.activity_log where entity = 'project_item_stage_list' and entity_id = pg_temp.fx('i_a1')
           and action = 'ticked' order by id desc limit 1), 'Phase A',
  'a tick names the stage''s group in the history (migration client_work_stage_meta_group)');
select ok(public.item_stage_add(pg_temp.fx('i_a1'), 'Grade', 'Phase B') is not null, 'a stage into one of the deliverable''s groups');
select ok(public.item_stage_add(pg_temp.fx('i_a1'), 'Note') is not null, 'the 2-argument form: outside any group');
select is(pg_temp.istages('Item A 1'), 'Note,Phase A·Edit✓,Phase A·Review,Phase B·Edit,Phase B·Grade', 'in order, the tick kept');
select is(pg_temp.istages('Item A 2'), 'Brief,Phase C·Cut', 'the project''s other deliverables are untouched');
select throws_ok($$ select public.item_stage_add(pg_temp.fx('i_a1'), 'EDIT', 'Phase B') $$, 'P0001', 'CONFLICT', 'a name once per group');
select lives_ok($$ select public.item_stage_group_add(pg_temp.fx('i_a1'), 'Phase C', array['Cut', 'Edit']) $$,
  'a preset added as a group, its names free of the other groups'' names');
select is(public.item_stage_group_update(pg_temp.fx('i_a1'), null, '{"label": "Phase 0"}'), array['label'],
  'the untitled group named');
select is(pg_temp.istages('Item A 1'), 'Phase 0·Note,Phase A·Edit✓,Phase A·Review,Phase B·Edit,Phase B·Grade,Phase C·Cut,Phase C·Edit',
  'it keeps its place, first');
select is(public.item_stage_update(pg_temp.istage(pg_temp.fx('i_a1'), 'Edit', 'Phase A'), '{"group_label": "Phase 0", "position": "0"}'),
  array['position', 'group_label'], 'a ticked stage moved to another group at a given place');
select is(pg_temp.istages('Item A 1'), 'Phase 0·Edit✓,Phase 0·Note,Phase A·Review,Phase B·Edit,Phase B·Grade,Phase C·Cut,Phase C·Edit',
  'the tick travels with it');
select is((select meta ->> 'name' from public.activity_log where entity = 'project_item_stage_list' and entity_id = pg_temp.fx('i_a1')
           and action = 'update' order by id desc limit 1), 'Edit', 'the entry names the stage (client_work_item_stage_meta)');
select is(public.item_stage_group_update(pg_temp.fx('i_a1'), 'Phase C', '{"position": "0"}'), array['position'], 'a group moved');
select is(pg_temp.istages('Item A 1'), 'Phase C·Cut,Phase C·Edit,Phase 0·Edit✓,Phase 0·Note,Phase A·Review,Phase B·Edit,Phase B·Grade',
  'the groups reordered, every stage with its group');
select is((select count(*)::integer from public.activity_log where entity = 'project_item_stage_list' and entity_id = pg_temp.fx('i_a1')
           and action = 'group_moved' and meta ? 'name'), 2, 'audited ''group_moved'' per stage, each named');
select throws_ok($$ select public.item_stage_group_update(pg_temp.item('Item A 2'), 'Phase C', '{"label": null}') $$, 'P0001', 'CONFLICT',
  'a group cannot lose its name while the deliverable has stages outside any group');
select lives_ok($$ select public.item_stage_group_archive(pg_temp.fx('i_a1'), 'Phase 0') $$, 'a group removed, its tick kept on the row');
select is((select count(*)::integer from public.project_item_stage_list where item_id = pg_temp.fx('i_a1') and group_label = 'Phase 0'
           and archived_at is not null and done_at is not null), 1, 'the archived ticked stage keeps its tick');
select is(pg_temp.istages('Item A 1'), 'Phase C·Cut,Phase C·Edit,Phase A·Review,Phase B·Edit,Phase B·Grade', 'the rest stays');
select throws_ok($$ select public.item_stage_group_add(pg_temp.fx('i_a1'), 'Phase Z', pg_temp.names(96)) $$, 'P0001', 'VALIDATION',
  'at most 100 active stages on a deliverable');
select lives_ok($$ select public.item_stage_group_add(pg_temp.fx('i_a1'), 'Phase Z', pg_temp.names(95)) $$, 'exactly 100 is fine');
select is((select count(*)::integer from public.project_item_stage_list where item_id = pg_temp.fx('i_a1') and archived_at is null), 100,
  'one hundred active stages');
-- Roles on the deliverable's group functions.
select pg_temp.as_member('admin2');
select is(pg_temp.code($$ select public.item_stage_group_add(pg_temp.fx('i_a1'), 'Mine', array['X']) $$), 'NOT_FOUND', 'another Admin: NOT_FOUND (group add)');
select is(pg_temp.code($$ select public.item_stage_group_update(pg_temp.fx('i_a1'), 'Phase A', '{"label": "X"}') $$), 'NOT_FOUND', '(group update)');
select is(pg_temp.code($$ select public.item_stage_group_archive(pg_temp.fx('i_a1'), 'Phase A') $$), 'NOT_FOUND', '(group archive)');
select is(pg_temp.code($$ select public.item_stage_add(pg_temp.fx('i_a1'), 'X', 'Phase A') $$), 'NOT_FOUND', '(stage add)');
select is(pg_temp.code($$ select public.project_stage_group_add(pg_temp.fx('p_g'), 'Mine', array['X']) $$), 'NOT_FOUND', '(default group add)');
select is(pg_temp.code($$ select public.project_stage_group_update(pg_temp.fx('p_g'), 'Phase A', '{"label": "X"}') $$), 'NOT_FOUND', '(default group update)');
select is(pg_temp.code($$ select public.project_stage_group_archive(pg_temp.fx('p_g'), 'Phase A') $$), 'NOT_FOUND', '(default group archive)');
select is(pg_temp.code($$ select public.project_stage_add(pg_temp.fx('p_g'), 'X', 'Phase A') $$), 'NOT_FOUND', '(default stage add)');
select pg_temp.as_member('staff');
select is(pg_temp.code($$ select public.item_stage_group_add(pg_temp.fx('i_a1'), 'Crew', array['X']) $$), 'FORBIDDEN', 'Crew: FORBIDDEN (group add)');
select is(pg_temp.code($$ select public.item_stage_group_update(pg_temp.fx('i_a1'), 'Phase A', '{"label": "X"}') $$), 'FORBIDDEN', '(group update)');
select is(pg_temp.code($$ select public.item_stage_group_archive(pg_temp.fx('i_a1'), 'Phase A') $$), 'FORBIDDEN', '(group archive)');
select is(pg_temp.code($$ select public.project_stage_group_add(pg_temp.fx('p_g'), 'Crew', array['X']) $$), 'FORBIDDEN', '(default group add)');
select is(pg_temp.code($$ select public.project_stage_group_update(pg_temp.fx('p_g'), 'Phase A', '{"label": "X"}') $$), 'FORBIDDEN', '(default group update)');
select is(pg_temp.code($$ select public.project_stage_group_archive(pg_temp.fx('p_g'), 'Phase A') $$), 'FORBIDDEN', '(default group archive)');
select pg_temp.as_member('gone_admin');
select is(pg_temp.code($$ select public.item_stage_group_add(pg_temp.fx('i_a1'), 'Gone', array['X']) $$), 'UNAUTHENTICATED', 'a deactivated Admin');
select pg_temp.as_anon();
select throws_ok($$ select public.item_stage_group_add(pg_temp.fx('i_a1'), 'Anon', array['X']) $$, '42501', null, 'anon cannot call it');
select throws_ok($$ select public.project_stage_group_add(pg_temp.fx('p_g'), 'Anon', array['X']) $$, '42501', null, 'nor the defaults''');
select pg_temp.as_member('owner');
select lives_ok($$ select public.item_stage_group_update(pg_temp.fx('i_a1'), 'Phase A', '{"label": "Phase A+"}') $$,
  'the Owner edits a group on any client''s deliverable');
select pg_temp.as_member('admin');

-- ===========================================================================================================
-- 6. The item list: a line's groups, and the next cycle copies them
-- ===========================================================================================================
insert into fx select 'bp_a1', b.id from public.project_item_blueprints b where b.project_id = pg_temp.fx('p_g') and b.title = 'Item A 1';
select is(public.project_blueprint_update(pg_temp.fx('bp_a1'),
  '{"stage_groups": [{"label": "Phase A", "stages": ["Edit"]}, {"label": "Phase B", "stages": ["Edit", "Post"]}]}'),
  array['stages', 'stage_groups'], 'a line''s groups set: both columns change');
select is((select b.stages from public.project_item_blueprints b where b.id = pg_temp.fx('bp_a1')), array['Edit', 'Edit', 'Post'],
  'the flattened copy follows');
select is(public.project_blueprint_update(pg_temp.fx('bp_a1'), '{"stages": ["Only"]}'), array['stages'],
  'the old stages key still works');
select is((select b.stage_groups from public.project_item_blueprints b where b.id = pg_temp.fx('bp_a1')),
  '[{"label": null, "stages": ["Only"]}]'::jsonb, 'as one untitled group');
select throws_ok($$ select public.project_blueprint_update(pg_temp.fx('bp_a1'), '{"stage_groups": [{"label": "Phase A", "stages": ["X", "x"]}]}') $$,
  'P0001', 'VALIDATION', 'a bad group list is refused');
select lives_ok($$ select public.project_blueprint_update(pg_temp.fx('bp_a1'),
  '{"stage_groups": [{"label": "Phase A", "stages": ["Edit"]}, {"label": "Phase B", "stages": ["Edit", "Post"]}]}') $$, 'set again');
select pg_temp.as_system();
select app.cycle_create((select p from public.projects p where p.id = pg_temp.fx('p_g')),
  (app.period_start('monthly', app.today_ist()) - interval '1 month')::date, 'schedule', null);
insert into fx select 'prev_a1', i.id from public.project_items i join public.project_cycles c on c.id = i.cycle_id
where i.project_id = pg_temp.fx('p_g') and i.title = 'Item A 1'
  and c.period_start = (app.period_start('monthly', app.today_ist()) - interval '1 month')::date;
select is(pg_temp.gstages(pg_temp.fx('prev_a1')), 'Phase A·Edit,Phase B·Edit,Phase B·Post', 'a new cycle copies each line''s groups');
select app.cycle_create((select p from public.projects p where p.id = pg_temp.fx('p_g')),
  (app.period_start('monthly', app.today_ist()) - interval '2 month')::date, 'carry', null, false) is not null;
select is(app.cycle_copy_item_list((select p from public.projects p where p.id = pg_temp.fx('p_g')),
  (select c.id from public.project_cycles c where c.project_id = pg_temp.fx('p_g')
     and c.period_start = (app.period_start('monthly', app.today_ist()) - interval '2 month')::date), null), 3,
  'an item list copied into a cycle later (Q4 (a))');
select is((select pg_temp.gstages(i.id) from public.project_items i join public.project_cycles c on c.id = i.cycle_id
           where i.project_id = pg_temp.fx('p_g') and i.title = 'Item A 1'
             and c.period_start = (app.period_start('monthly', app.today_ist()) - interval '2 month')::date),
  'Phase A·Edit,Phase B·Edit,Phase B·Post', 'carries the groups too');
select is(pg_temp.gstages(pg_temp.fx('i_a1')), 'Phase C·Cut,Phase C·Edit,Phase A+·Review,Phase B·Edit,Phase B·Grade,Phase Z·Stage 1,Phase Z·Stage 2,Phase Z·Stage 3,Phase Z·Stage 4,Phase Z·Stage 5,Phase Z·Stage 6,Phase Z·Stage 7,Phase Z·Stage 8,Phase Z·Stage 9,Phase Z·Stage 10,Phase Z·Stage 11,Phase Z·Stage 12,Phase Z·Stage 13,Phase Z·Stage 14,Phase Z·Stage 15,Phase Z·Stage 16,Phase Z·Stage 17,Phase Z·Stage 18,Phase Z·Stage 19,Phase Z·Stage 20,Phase Z·Stage 21,Phase Z·Stage 22,Phase Z·Stage 23,Phase Z·Stage 24,Phase Z·Stage 25,Phase Z·Stage 26,Phase Z·Stage 27,Phase Z·Stage 28,Phase Z·Stage 29,Phase Z·Stage 30,Phase Z·Stage 31,Phase Z·Stage 32,Phase Z·Stage 33,Phase Z·Stage 34,Phase Z·Stage 35,Phase Z·Stage 36,Phase Z·Stage 37,Phase Z·Stage 38,Phase Z·Stage 39,Phase Z·Stage 40,Phase Z·Stage 41,Phase Z·Stage 42,Phase Z·Stage 43,Phase Z·Stage 44,Phase Z·Stage 45,Phase Z·Stage 46,Phase Z·Stage 47,Phase Z·Stage 48,Phase Z·Stage 49,Phase Z·Stage 50,Phase Z·Stage 51,Phase Z·Stage 52,Phase Z·Stage 53,Phase Z·Stage 54,Phase Z·Stage 55,Phase Z·Stage 56,Phase Z·Stage 57,Phase Z·Stage 58,Phase Z·Stage 59,Phase Z·Stage 60,Phase Z·Stage 61,Phase Z·Stage 62,Phase Z·Stage 63,Phase Z·Stage 64,Phase Z·Stage 65,Phase Z·Stage 66,Phase Z·Stage 67,Phase Z·Stage 68,Phase Z·Stage 69,Phase Z·Stage 70,Phase Z·Stage 71,Phase Z·Stage 72,Phase Z·Stage 73,Phase Z·Stage 74,Phase Z·Stage 75,Phase Z·Stage 76,Phase Z·Stage 77,Phase Z·Stage 78,Phase Z·Stage 79,Phase Z·Stage 80,Phase Z·Stage 81,Phase Z·Stage 82,Phase Z·Stage 83,Phase Z·Stage 84,Phase Z·Stage 85,Phase Z·Stage 86,Phase Z·Stage 87,Phase Z·Stage 88,Phase Z·Stage 89,Phase Z·Stage 90,Phase Z·Stage 91,Phase Z·Stage 92,Phase Z·Stage 93,Phase Z·Stage 94,Phase Z·Stage 95',
  'the current cycle''s deliverable keeps its own stages (a line feeds later cycles only)');
-- A carry forward takes the groups with the ticks (decision 12, amendment D2).
select pg_temp.as_member('admin');
select public.item_stage_tick(pg_temp.istage(pg_temp.fx('prev_a1'), 'Post', 'Phase B'));
insert into fx select 'carried', ((public.cycle_carry_decide(array[pg_temp.fx('prev_a1')], 'carry_forward')) -> 0 ->> 'new_item_id')::uuid;
select is(pg_temp.gstages(pg_temp.fx('carried')), 'Phase A·Edit,Phase B·Edit,Phase B·Post✓', 'a carried deliverable keeps its groups and ticks');

-- ===========================================================================================================
-- 7. Templates: the new shape alongside the old columns, the guard keeping them in step
-- ===========================================================================================================
insert into public.project_templates (name, recurrence, stage_groups, deliverables) values ('Grouped template', 'monthly',
  '[{"label": "Phase A", "stages": ["Edit"]}]',
  '[{"title": "Item 1", "stage_groups": null}, {"title": "Item 2", "stage_groups": [{"label": "Phase B", "stages": ["Cut", "Post"]}]}]');
select is((select t.stages from public.project_templates t where t.name = 'Grouped template'), array['Edit'],
  'the guard writes the flattened default stages');
select is((select t.items from public.project_templates t where t.name = 'Grouped template'), array['Item 1', 'Item 2'],
  'and the deliverable titles into items');
select throws_ok($$ insert into public.project_templates (name, recurrence, stage_groups) values ('Bad', 'monthly',
  '[{"label": "Phase A", "stages": ["Edit", "edit"]}]') $$, 'P0001', 'VALIDATION', 'a bad group list is refused on a template');
select throws_ok($$ insert into public.project_templates (name, recurrence, deliverables)
  values ('Bad', 'monthly', (select jsonb_agg(jsonb_build_object('title', 'D' || g)) from generate_series(1, 101) g)) $$,
  'P0001', 'VALIDATION', 'at most 100 deliverables');
select lives_ok($$ insert into public.project_templates (name, recurrence, stages, items) values ('Plain template', 'monthly', pg_temp.names(100), array['Item']) $$,
  'the old shape still inserts, with 100 stages');
select throws_ok($$ insert into public.project_templates (name, recurrence, stages) values ('Too long', 'monthly', pg_temp.names(101)) $$,
  '23514', null, 'never 101');
select is((select t.stage_groups from public.project_templates t where t.id = pg_temp.fx('old_t')), null,
  'the old template has no groups column until it is saved in the new shape');
update public.project_templates set deliverables = '[{"title": "Item 1", "stage_groups": [{"label": "Phase A", "stages": ["Phase A1", "Phase A2"]}]}]',
  stage_groups = '[{"label": null, "stages": ["Phase A1", "Phase A2"]}]' where id = pg_temp.fx('old_t');
select is((select t.items || t.stages from public.project_templates t where t.id = pg_temp.fx('old_t')),
  array['Item 1', 'Phase A1', 'Phase A2'], 'saved in the new shape, the old columns follow it');
update public.project_templates set stages = array['Phase A1', 'Phase A2', 'Phase A3'] where id = pg_temp.fx('old_t');
select is((select t.stage_groups from public.project_templates t where t.id = pg_temp.fx('old_t')), null,
  'an old-shape write of stages alone wins: the stored groups are cleared (review S2, a rollback)');
update public.project_templates set items = array['Item 1', 'Item 9'] where id = pg_temp.fx('old_t');
select is((select t.deliverables from public.project_templates t where t.id = pg_temp.fx('old_t')), null::jsonb,
  'as are the deliverables when items alone change');

-- ===========================================================================================================
-- 8. The today-shape project gains groups: nothing existing changes
-- ===========================================================================================================
select is(pg_temp.gstages(pg_temp.fx('old_i1')), 'Phase A1✓,Phase A2', 'the old deliverable reads as one untitled group, its tick there');
select lives_ok($$ select public.item_stage_group_add(pg_temp.fx('old_i1'), 'Phase B', array['Cut', 'Post']) $$,
  'a group added to an existing deliverable');
select is(public.item_stage_update(pg_temp.istage(pg_temp.fx('old_i1'), 'Phase A2', null), '{"position": "0"}'), array['position'],
  'a stage dragged within the untitled group');
select is(pg_temp.gstages(pg_temp.fx('old_i1')), 'Phase A2,Phase A1✓,Phase B·Cut,Phase B·Post', 'the old stages first, still untitled');
select is(public.project_stage_group_update(pg_temp.fx('old_p'), null, '{"label": "Phase A"}'), array['label'],
  'the project''s untitled default stages named');
select is(pg_temp.pstages(pg_temp.fx('old_p')), 'Phase A·Phase A1,Phase A·Phase A2', 'they now show under the heading');
select lives_ok($$ select public.project_stage_group_add(pg_temp.fx('old_p'), 'Phase B', array['Cut']) $$,
  'and a group added to the defaults');
select is((select count(*)::integer from public.project_stages where project_id = pg_temp.fx('old_p') and archived_at is null), 3,
  'three default stages');
select is(pg_temp.gstages(pg_temp.fx('old_i2')), 'Phase A1,Phase A2', 'the other old deliverable is untouched');
select is((select b.stage_groups from public.project_item_blueprints b where b.project_id = pg_temp.fx('old_p') and b.title = 'Item 2'), null,
  'and the old item-list line keeps its old shape');
select pg_temp.as_system();
select is((select count(*)::integer from before_ticks b join public.project_item_stage_list s on s.id = b.id
           where s.name = b.name and s.done_at is not distinct from b.done_at and s.done_by is not distinct from b.done_by), 4,
  'every earlier stage keeps its name and its tick');
select is((select count(*)::integer from before_items b join public.project_items i on i.id = b.id
           where i.title = b.title and i.planned_date is not distinct from b.planned_date and i.notes is not distinct from b.notes
             and i.state = b.state), 2, 'the planned date, the note and the state are as they were');
select is((select count(*)::integer from before_log b join public.activity_log a on a.id = b.id
           where a.action = b.action and a.diff = b.diff and a.meta = b.meta and a.entity = b.entity and a.entity_id = b.entity_id),
  (select count(*)::integer from before_log), 'every earlier history row is as it was');
select ok((select count(*) from public.activity_log where entity_id = pg_temp.fx('old_i1')) > (select count(*) from before_log where entity_id = pg_temp.fx('old_i1')),
  'and the new changes were added to the history, never in place');
select pg_temp.as_system();
select app.cycle_create((select p from public.projects p where p.id = pg_temp.fx('old_p')),
  (app.period_start('monthly', app.today_ist()) + interval '1 month')::date, 'schedule', null) is not null;
select is((select pg_temp.gstages(i.id) from public.project_items i join public.project_cycles c on c.id = i.cycle_id
           where i.project_id = pg_temp.fx('old_p') and i.title = 'Item 2'
             and c.period_start = (app.period_start('monthly', app.today_ist()) + interval '1 month')::date),
  'Phase A1,Phase A2', 'the next month still repeats the old line as one untitled group');

-- ===========================================================================================================
-- 9. The history describes the group changes
-- ===========================================================================================================
select ok(app.client_work_activity_shown('project_item_stage_list', 'group_renamed', '{}'), 'a group rename is described');
select ok(app.client_work_activity_shown('project_stages', 'group_moved', '{}'), 'a group move too');
select ok(app.client_work_activity_shown('project_item_stage_list', 'update', '{"new": {"group_label": "X"}}'), 'a stage moved between groups');
select ok(app.client_work_activity_shown('project_item_blueprints', 'update', '{"new": {"stage_groups": []}}'), 'a line''s groups');
select ok(not app.client_work_activity_shown('project_stages', 'update', '{"new": {"updated_at": "x"}}'), 'internal keys alone are not');
select ok(exists (select 1 from public.project_activity(pg_temp.fx('p_g')) a where a.action = 'group_renamed'),
  'the project''s activity lists a group rename');

select * from finish();
rollback;
