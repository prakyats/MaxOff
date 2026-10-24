-- Phase 6b Release 2 (v1.7.1; ROADMAP 6b.13 (2)(b), 6b.16; migration deliverable_templates; DATA-MODEL §5b
-- "Deliverable templates and Save as template"): the deliverable_templates table and its RLS on every role
-- (the Owner any, an Admin reads all and writes their own, Crew nothing, anon nothing), and the three new
-- functions on every path: project_save_as_template, item_save_as_template and item_add_grouped, for the
-- Owner, the client's Admin, another Admin (NOT_FOUND), Crew (FORBIDDEN), a deactivated Admin
-- (UNAUTHENTICATED) and anon (no privilege). Proved on TODAY-shape data: a project made the old way, with
-- an item list, a tick, a date, a note and history, saved as a template with nothing on it changed.
-- Every name here is neutral: nothing is pre-defined.
begin;
create extension if not exists pgtap with schema extensions;
select plan(77);

delete from public.deliverable_templates;

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

create temporary table fx (key text primary key, id uuid not null);
insert into fx values
  ('owner',      '00000000-0000-4000-8000-000000007801'),
  ('admin',      '00000000-0000-4000-8000-000000007802'),
  ('admin2',     '00000000-0000-4000-8000-000000007803'),
  ('staff',      '00000000-0000-4000-8000-000000007804'),
  ('gone_admin', '00000000-0000-4000-8000-000000007805'),
  ('client_a',   '00000000-0000-4000-8000-0000000078a1'),
  ('client_b',   '00000000-0000-4000-8000-0000000078b1');
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
create function pg_temp.istage(p_item uuid, n text, g text) returns uuid language sql stable security definer as $$
  select s.id from public.project_item_stage_list s
  where s.item_id = p_item and s.name = n and s.group_label is not distinct from g and s.archived_at is null;
$$;
-- A template as the system sees it, whoever is asking.
create function pg_temp.ptemplate(p uuid) returns public.project_templates language sql stable security definer as $$
  select t from public.project_templates t where t.id = p;
$$;
create function pg_temp.dtemplate(p uuid) returns public.deliverable_templates language sql stable security definer as $$
  select t from public.deliverable_templates t where t.id = p;
$$;
-- Everything a project holds, as one value (its row, defaults, lines, cycles, items and their stages).
create function pg_temp.snapshot(p uuid) returns jsonb language sql stable security definer as $$
  select jsonb_build_object(
    'project', (select to_jsonb(x) from public.projects x where x.id = p),
    'stages', (select jsonb_agg(to_jsonb(s) order by s.id) from public.project_stages s where s.project_id = p),
    'lines', (select jsonb_agg(to_jsonb(b) order by b.id) from public.project_item_blueprints b where b.project_id = p),
    'cycles', (select jsonb_agg(to_jsonb(c) order by c.id) from public.project_cycles c where c.project_id = p),
    'items', (select jsonb_agg(to_jsonb(i) order by i.id) from public.project_items i where i.project_id = p),
    'ticks', (select jsonb_agg(to_jsonb(s) order by s.id) from public.project_item_stage_list s where s.project_id = p));
$$;
-- The project's history (its own rows and its items' and stages'), as one value.
create function pg_temp.history(p uuid) returns jsonb language sql stable security definer as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'entity', a.entity, 'entity_id', a.entity_id,
           'action', a.action, 'diff', a.diff, 'meta', a.meta, 'at', a.at) order by a.id), '[]'::jsonb)
  from public.activity_log a
  where a.entity_id = p
     or a.entity_id in (select i.id from public.project_items i where i.project_id = p)
     or a.entity_id in (select s.id from public.project_item_stage_list s where s.project_id = p)
     or a.entity_id in (select s.id from public.project_stages s where s.project_id = p)
     or a.entity_id in (select b.id from public.project_item_blueprints b where b.project_id = p);
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
-- 0. TODAY-shape data, made the old way: a monthly project with plain stages and an item list, its items
--    with stages, a tick, a date, a note and history. The lines lose their groups column, as rows from
--    before groups have it.
-- ===========================================================================================================
select pg_temp.as_member('admin');
insert into fx values ('old_p', public.project_create(pg_temp.fx('client_a'), 'Old project', 'monthly', 'Kept description', null,
  array['Stage 1', 'Stage 2'], array['Item 1', 'Item 2']));
select pg_temp.as_system();
alter table public.project_item_blueprints disable trigger audit_row_change;
update public.project_item_blueprints set stage_groups = null where project_id = pg_temp.fx('old_p');
alter table public.project_item_blueprints enable trigger audit_row_change;
select pg_temp.as_member('admin');
insert into fx values ('old_i1', pg_temp.item('Item 1'));
insert into fx values ('old_i2', pg_temp.item('Item 2'));
insert into fx select 'old_c', c.id from public.project_cycles c where c.project_id = pg_temp.fx('old_p');
select public.item_stage_tick(pg_temp.istage(pg_temp.fx('old_i1'), 'Stage 1', null));
select public.item_update(pg_temp.fx('old_i1'), jsonb_build_object('planned_date', app.today_ist() + 3, 'notes', 'Keep this note'));
-- One line has its own groups now (the Release 1 shape next to today's).
select public.project_blueprint_update(
  (select b.id from public.project_item_blueprints b where b.project_id = pg_temp.fx('old_p') and b.title = 'Item 2'),
  '{"stage_groups": [{"label": null, "stages": ["Stage 1"]}, {"label": "Phase A", "stages": ["One", "Two"]}]}');
select pg_temp.as_system();
create temporary table before_state as select pg_temp.snapshot(pg_temp.fx('old_p')) as v;
create temporary table before_log as select pg_temp.history(pg_temp.fx('old_p')) as v;

-- ===========================================================================================================
-- 1. The table and its RLS
-- ===========================================================================================================
select has_table('public', 'deliverable_templates', 'deliverable_templates exists');
select ok((select c.relrowsecurity from pg_class c where c.oid = 'public.deliverable_templates'::regclass),
  'RLS is on, in the migration that made it');
select is((select count(*)::integer from information_schema.columns
           where table_schema = 'public' and table_name = 'deliverable_templates'
             and (column_name ~ '(amount|value|price|fee|billing|revenue)' or data_type in ('numeric', 'money'))),
  0, 'no amount on it (ADR-0007)');
select is((select count(*)::integer from public.deliverable_templates), 0, 'nothing is pre-defined: no template seeded');

select pg_temp.as_member('owner');
select lives_ok($$ insert into public.deliverable_templates (name, stage_groups)
  values ('Owner item', '[{"label": "Phase A", "stages": ["One", "Two"]}]') $$, 'the Owner adds a deliverable template');
insert into fx select 'dt_owner', id from public.deliverable_templates where name = 'Owner item';
select is((select count(*)::integer from public.deliverable_templates), 1, 'the Owner reads it');

select pg_temp.as_member('admin');
select lives_ok($$ insert into public.deliverable_templates (name, stage_groups)
  values ('  Admin item  ', '[{"label": " Phase B ", "stages": [" One "]}, {"label": null, "stages": ["Brief"]}]') $$,
  'an Admin adds their own');
insert into fx select 'dt_admin', id from public.deliverable_templates where name = 'Admin item';
select is((pg_temp.dtemplate(pg_temp.fx('dt_admin'))).stage_groups,
  '[{"label": null, "stages": ["Brief"]}, {"label": "Phase B", "stages": ["One"]}]'::jsonb,
  'the name and groups come back trimmed, the untitled group first');
select is((pg_temp.dtemplate(pg_temp.fx('dt_admin'))).created_by, pg_temp.fx('admin'), 'the author is the caller');
select is((select count(*)::integer from public.deliverable_templates), 2, 'an Admin reads every template, the Owner''s too');
update public.deliverable_templates set name = 'Admin item renamed' where id = pg_temp.fx('dt_admin');
select is((pg_temp.dtemplate(pg_temp.fx('dt_admin'))).name, 'Admin item renamed', 'an Admin edits their own');
update public.deliverable_templates set name = 'Taken over' where id = pg_temp.fx('dt_owner');
select is((pg_temp.dtemplate(pg_temp.fx('dt_owner'))).name, 'Owner item', 'but never the Owner''s (RLS: no row)');
select throws_ok($$ update public.deliverable_templates set archived_at = now() where id = pg_temp.fx('dt_admin') $$,
  'P0001', 'REASON_REQUIRED', 'archiving needs a reason');
select lives_ok($$ update public.deliverable_templates set archived_at = now(), archived_reason = ' Not used ' where id = pg_temp.fx('dt_admin') $$,
  'an Admin archives their own with a reason');
select is((pg_temp.dtemplate(pg_temp.fx('dt_admin'))).archived_reason, 'Not used', 'the reason is kept, trimmed');
select lives_ok($$ update public.deliverable_templates set archived_at = null where id = pg_temp.fx('dt_admin') $$,
  'and restores it');
select is((pg_temp.dtemplate(pg_temp.fx('dt_admin'))).archived_reason, null, 'the reason goes with the archive (its history keeps it)');
select throws_ok($$ insert into public.deliverable_templates (name, stage_groups, created_by)
  values ('Someone else''s', '[]', pg_temp.fx('owner')) $$, '42501', null, 'an Admin never writes for someone else');
select throws_ok($$ update public.deliverable_templates set created_by = pg_temp.fx('admin2') where id = pg_temp.fx('dt_admin') $$,
  '42501', null, 'nor changes the author (no column grant)');
select throws_ok($$ insert into public.deliverable_templates (name, stage_groups)
  values ('Bad groups', '[{"label": "Phase A", "stages": ["Edit", "EDIT"]}]') $$, 'P0001', 'VALIDATION',
  'a stage twice in a group is refused, as everywhere');
select throws_ok($$ insert into public.deliverable_templates (name, stage_groups) values ('owner ITEM', '[]') $$,
  '23505', null, 'an active name once, ignoring case');
select throws_ok($$ delete from public.deliverable_templates where id = pg_temp.fx('dt_admin') $$, '42501', null,
  'nobody deletes a template (archive instead)');

select pg_temp.as_member('owner');
update public.deliverable_templates set name = 'Owner renamed it' where id = pg_temp.fx('dt_admin');
select is((pg_temp.dtemplate(pg_temp.fx('dt_admin'))).name, 'Owner renamed it', 'the Owner edits any template');
select throws_ok($$ delete from public.deliverable_templates where id = pg_temp.fx('dt_owner') $$, '42501', null,
  'the Owner deletes none either');

select pg_temp.as_member('staff');
select is((select count(*)::integer from public.deliverable_templates), 0, 'Crew read no template');
select throws_ok($$ insert into public.deliverable_templates (name, stage_groups) values ('Crew item', '[]') $$, '42501', null,
  'Crew write none');
select pg_temp.as_anon();
select throws_ok($$ select count(*) from public.deliverable_templates $$, '42501', null, 'anon reads nothing');

select pg_temp.as_system();
select is((select array_agg(a.action order by a.id) from public.activity_log a
           where a.entity = 'deliverable_templates' and a.entity_id = pg_temp.fx('dt_admin')),
  array['insert', 'update', 'update', 'update', 'update'], 'every write is audited (the trigger)');

-- ===========================================================================================================
-- 2. project_save_as_template on today's shape
-- ===========================================================================================================
select pg_temp.as_member('admin');
insert into fx values ('pt_old', public.project_save_as_template(pg_temp.fx('old_p'), '  Saved month  '));
select isnt(pg_temp.fx('pt_old'), null, 'the client''s Admin saves a today-shape project as a template');
select is((pg_temp.ptemplate(pg_temp.fx('pt_old'))).name, 'Saved month', 'named as typed, trimmed');
select is((pg_temp.ptemplate(pg_temp.fx('pt_old'))).recurrence, 'monthly'::public.recurrence, 'with the project''s repeat');
select is((pg_temp.ptemplate(pg_temp.fx('pt_old'))).description, null, 'never its description (V4: the structure only)');
select is((pg_temp.ptemplate(pg_temp.fx('pt_old'))).stage_groups,
  '[{"label": null, "stages": ["Stage 1", "Stage 2"]}]'::jsonb, 'its default stages, one untitled group');
select is((pg_temp.ptemplate(pg_temp.fx('pt_old'))).deliverables,
  '[{"title": "Item 1", "stage_groups": [{"label": null, "stages": ["Stage 1", "Stage 2"]}]},
    {"title": "Item 2", "stage_groups": [{"label": null, "stages": ["Stage 1"]}, {"label": "Phase A", "stages": ["One", "Two"]}]}]'::jsonb,
  'its deliverables list, each line with its own groups (a line from before: its stages as one group)');
select is((pg_temp.ptemplate(pg_temp.fx('pt_old'))).stages, array['Stage 1', 'Stage 2'], 'the old stages column in step');
select is((pg_temp.ptemplate(pg_temp.fx('pt_old'))).items, array['Item 1', 'Item 2'], 'the old items column in step');
select is((pg_temp.ptemplate(pg_temp.fx('pt_old'))).created_by, pg_temp.fx('admin'), 'the Admin''s own template');
select pg_temp.as_system();
select is(pg_temp.snapshot(pg_temp.fx('old_p')), (select v from before_state),
  'nothing on the project changed: its row, defaults, lines, cycle, items, ticks, dates and notes');
select is((select jsonb_agg(e) from jsonb_array_elements(pg_temp.history(pg_temp.fx('old_p'))) e
           where (e ->> 'id')::bigint <= (select max((x ->> 'id')::bigint) from jsonb_array_elements((select v from before_log)) x)),
  (select v from before_log), 'every history row from before is as it was');
select is((select jsonb_agg(jsonb_build_object('action', a.action, 'actor', a.actor_id, 'meta', a.meta))
           from public.activity_log a where a.entity = 'projects' and a.entity_id = pg_temp.fx('old_p') and a.action = 'saved_as_template'),
  jsonb_build_array(jsonb_build_object('action', 'saved_as_template', 'actor', pg_temp.fx('admin'),
    'meta', jsonb_build_object('template_id', pg_temp.fx('pt_old'), 'name', 'Saved month'))),
  'one history row on the project: saved as the template, by whom');
select ok(app.client_work_activity_shown('projects', 'saved_as_template', '{}'), 'the project''s history shows it');
select ok(app.client_work_activity_shown('project_items', 'insert', '{}') and app.client_work_activity_shown('projects', 'reopened', '{}'),
  'and still everything it showed before');
select pg_temp.as_member('admin');
select is((select count(*)::integer from public.project_activity(pg_temp.fx('old_p'), 'project') a where a.action = 'saved_as_template'), 1,
  'the Admin reads it in the project''s history');
select is(pg_temp.code($$ select public.project_save_as_template(pg_temp.fx('old_p'), 'saved MONTH') $$), 'CONFLICT',
  'an active template''s name once, ignoring case');
select is(pg_temp.code($$ select public.project_save_as_template(pg_temp.fx('old_p'), '   ') $$), 'VALIDATION', 'a name is needed');
-- A template edit never reaches the project: it is a copy.
update public.project_templates set stage_groups = '[{"label": "Phase Z", "stages": ["Z1"]}]' where id = pg_temp.fx('pt_old');
select pg_temp.as_system();
select is(pg_temp.snapshot(pg_temp.fx('old_p')), (select v from before_state), 'an edit of the template leaves the project as it was');

select pg_temp.as_member('admin2');
select is(pg_temp.code($$ select public.project_save_as_template(pg_temp.fx('old_p'), 'Not mine') $$), 'NOT_FOUND',
  'another Admin''s client: NOT_FOUND');
select pg_temp.as_member('staff');
select is(pg_temp.code($$ select public.project_save_as_template(pg_temp.fx('old_p'), 'Crew') $$), 'FORBIDDEN', 'Crew: FORBIDDEN');
select pg_temp.as_member('gone_admin');
select is(pg_temp.code($$ select public.project_save_as_template(pg_temp.fx('old_p'), 'Gone') $$), 'UNAUTHENTICATED',
  'a deactivated Admin: UNAUTHENTICATED');
select pg_temp.as_anon();
select throws_ok($$ select public.project_save_as_template(pg_temp.fx('old_p'), 'Anon') $$, '42501', null, 'anon cannot call it');
select pg_temp.as_member('owner');
insert into fx values ('pt_owner', public.project_save_as_template(pg_temp.fx('old_p'), 'Owner saved'));
select is((pg_temp.ptemplate(pg_temp.fx('pt_owner'))).created_by, pg_temp.fx('owner'), 'the Owner saves any client''s project, as his own');

-- A one-time project: its deliverables, each with its own stages in groups (names only, no ticks).
select pg_temp.as_member('admin');
insert into fx values ('p_one', public.project_create_grouped(pg_temp.fx('client_a'), 'One-time work', 'one_time', null, app.today_ist() + 7,
  '[{"label": "Phase A", "stages": ["Edit"]}]',
  '[{"title": "Single", "stage_groups": null}, {"title": "Other", "stage_groups": [{"label": null, "stages": ["Brief"]}, {"label": "Phase B", "stages": ["Cut"]}]}]'));
select public.item_stage_tick(pg_temp.istage(pg_temp.item('Other'), 'Brief', null));
select public.project_cancel(pg_temp.fx('p_one'), 'Neutral reason');
insert into fx values ('pt_one', public.project_save_as_template(pg_temp.fx('p_one'), 'One-time saved'));
select is((pg_temp.ptemplate(pg_temp.fx('pt_one'))).deliverables,
  '[{"title": "Single", "stage_groups": [{"label": "Phase A", "stages": ["Edit"]}]},
    {"title": "Other", "stage_groups": [{"label": null, "stages": ["Brief"]}, {"label": "Phase B", "stages": ["Cut"]}]}]'::jsonb,
  'a one-time project (even cancelled) gives its deliverables with their own stages');
select is((pg_temp.ptemplate(pg_temp.fx('pt_one'))).recurrence, 'one_time'::public.recurrence, 'and its repeat');

-- ===========================================================================================================
-- 3. item_save_as_template
-- ===========================================================================================================
insert into fx values ('dt_i1', public.item_save_as_template(pg_temp.fx('old_i1'), 'Saved item'));
select is((pg_temp.dtemplate(pg_temp.fx('dt_i1'))).stage_groups, '[{"label": null, "stages": ["Stage 1", "Stage 2"]}]'::jsonb,
  'a today-shape deliverable''s stages, one untitled group, without its tick');
select is((pg_temp.dtemplate(pg_temp.fx('dt_i1'))).created_by, pg_temp.fx('admin'), 'the Admin''s own template');
select is(pg_temp.gstages(pg_temp.fx('old_i1')), 'Stage 1✓,Stage 2', 'the deliverable keeps its tick');
select public.item_stage_group_add(pg_temp.fx('old_i2'), 'Phase A', array['One', 'Two']);
insert into fx values ('dt_i2', public.item_save_as_template(pg_temp.fx('old_i2'), 'Grouped item'));
select is((pg_temp.dtemplate(pg_temp.fx('dt_i2'))).stage_groups,
  '[{"label": null, "stages": ["Stage 1", "Stage 2"]}, {"label": "Phase A", "stages": ["One", "Two"]}]'::jsonb,
  'a deliverable''s groups in order, the untitled one first');
select is((select jsonb_agg(jsonb_build_object('actor', a.actor_id, 'meta', a.meta))
           from public.activity_log a where a.entity = 'project_items' and a.entity_id = pg_temp.fx('old_i1') and a.action = 'saved_as_template'),
  jsonb_build_array(jsonb_build_object('actor', pg_temp.fx('admin'), 'meta', jsonb_build_object('template_id', pg_temp.fx('dt_i1'), 'name', 'Saved item'))),
  'one history row on the deliverable');
select ok(app.client_work_activity_shown('project_items', 'saved_as_template', '{}'), 'the deliverable''s history shows it');
select is(pg_temp.code($$ select public.item_save_as_template(pg_temp.fx('old_i1'), 'SAVED item') $$), 'CONFLICT',
  'an active deliverable template''s name once, ignoring case');
select pg_temp.as_member('admin2');
select is(pg_temp.code($$ select public.item_save_as_template(pg_temp.fx('old_i1'), 'Not mine') $$), 'NOT_FOUND',
  'another Admin''s client: NOT_FOUND');
select pg_temp.as_member('staff');
select is(pg_temp.code($$ select public.item_save_as_template(pg_temp.fx('old_i1'), 'Crew') $$), 'FORBIDDEN', 'Crew: FORBIDDEN');
select pg_temp.as_member('gone_admin');
select is(pg_temp.code($$ select public.item_save_as_template(pg_temp.fx('old_i1'), 'Gone') $$), 'UNAUTHENTICATED',
  'a deactivated Admin: UNAUTHENTICATED');
select pg_temp.as_anon();
select throws_ok($$ select public.item_save_as_template(pg_temp.fx('old_i1'), 'Anon') $$, '42501', null, 'anon cannot call it');
select pg_temp.as_member('owner');
insert into fx values ('dt_own_i', public.item_save_as_template(pg_temp.fx('old_i1'), 'Owner saved item'));
select is((pg_temp.dtemplate(pg_temp.fx('dt_own_i'))).created_by, pg_temp.fx('owner'), 'the Owner saves any client''s deliverable');

-- ===========================================================================================================
-- 4. item_add_grouped: a deliverable from a template's groups (edited first), or the defaults
-- ===========================================================================================================
select pg_temp.as_member('admin');
insert into fx values ('new_i', public.item_add_grouped(pg_temp.fx('old_c'), 'From template', app.today_ist() + 2, 'A note',
  '[{"label": "Phase A", "stages": ["One", "Two"]}, {"label": null, "stages": ["Brief"]}]'));
select is(pg_temp.gstages(pg_temp.fx('new_i')), 'Brief,Phase A·One,Phase A·Two', 'the new deliverable takes the given groups');
select is((select jsonb_build_object('title', i.title, 'planned', i.planned_date = app.today_ist() + 2, 'notes', i.notes, 'state', i.state)
           from public.project_items i where i.id = pg_temp.fx('new_i')),
  '{"title": "From template", "planned": true, "notes": "A note", "state": "open"}'::jsonb, 'with its title, date and note, open');
select is((select count(*)::integer from public.activity_log where entity = 'project_item_stage_list' and action = 'initial'
           and entity_id = pg_temp.fx('new_i')), 3,
  'its stages are audited ''initial''');
insert into fx values ('new_d', public.item_add_grouped(pg_temp.fx('old_c'), 'Defaults'));
select is(pg_temp.gstages(pg_temp.fx('new_d')), 'Stage 1,Stage 2', 'no groups given: the project''s defaults, as Add deliverable');
select is(pg_temp.code($$ select public.item_add_grouped(pg_temp.fx('old_c'), 'Bad', null, null,
  '[{"label": "Phase A", "stages": ["Edit", "edit"]}]') $$), 'VALIDATION', 'groups are checked');
select is((select count(*)::integer from public.project_items where title = 'Bad'), 0, 'and nothing is added when refused');
select pg_temp.as_member('admin2');
select is(pg_temp.code($$ select public.item_add_grouped(pg_temp.fx('old_c'), 'Not mine') $$), 'NOT_FOUND',
  'another Admin''s client: NOT_FOUND');
select pg_temp.as_member('staff');
select is(pg_temp.code($$ select public.item_add_grouped(pg_temp.fx('old_c'), 'Crew') $$), 'FORBIDDEN', 'Crew: FORBIDDEN');
select pg_temp.as_member('gone_admin');
select is(pg_temp.code($$ select public.item_add_grouped(pg_temp.fx('old_c'), 'Gone') $$), 'UNAUTHENTICATED',
  'a deactivated Admin: UNAUTHENTICATED');
select pg_temp.as_anon();
select throws_ok($$ select public.item_add_grouped(pg_temp.fx('old_c'), 'Anon') $$, '42501', null, 'anon cannot call it');
select pg_temp.as_member('owner');
select isnt(public.item_add_grouped(pg_temp.fx('old_c'), 'Owner adds', null, null, '[{"label": null, "stages": ["Solo"]}]'), null,
  'the Owner adds to any client''s project');
select pg_temp.as_member('admin');
select is(pg_temp.code($$ select public.item_add_grouped((select c.id from public.project_cycles c where c.project_id = pg_temp.fx('p_one')), 'Late') $$),
  'INVALID_STATE', 'never into a cancelled project');

select * from finish();
rollback;
