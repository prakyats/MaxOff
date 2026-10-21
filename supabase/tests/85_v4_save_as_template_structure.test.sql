-- V4 (v1.8; owner 2026-10-16; migration v4_save_as_template_structure): "Save as template copies the
-- structure only": the stage groups, the deliverables (each with its groups) and the repeat; never the
-- project's description or its custom fields' values. Every path: a repeating project and a one-time
-- project (structure copied, description and fields not), the deliverable's Save as template (names
-- only), the history row, every refusal kept, and per role (the client's Admin, the Owner, another
-- Admin NOT_FOUND, Crew FORBIDDEN, anon no privilege). Every name here is neutral.
begin;
create extension if not exists pgtap with schema extensions;
select plan(16);

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
  ('owner',    '00000000-0000-4000-8000-000000008501'),
  ('admin',    '00000000-0000-4000-8000-000000008502'),
  ('admin2',   '00000000-0000-4000-8000-000000008503'),
  ('staff',    '00000000-0000-4000-8000-000000008504'),
  ('client_a', '00000000-0000-4000-8000-0000000085a1'),
  ('client_b', '00000000-0000-4000-8000-0000000085b1');
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
-- The item of a project with a title.
create function pg_temp.item(p uuid, t text) returns uuid language sql stable security definer as $$
  select i.id from public.project_items i where i.project_id = p and i.title = t order by i.created_at desc, i.id limit 1;
$$;
create function pg_temp.row(p uuid) returns public.project_items language sql stable security definer as $$
  select i from public.project_items i where i.id = p;
$$;
-- An item's active stages as the screens order them: "Group·Name" (no group: "Name"), "✓" when ticked.
create function pg_temp.gstages(p_item uuid) returns text language sql stable security definer as $$
  select coalesce(string_agg(
    coalesce(s.group_label || '·', '') || s.name || case when s.done_at is null then '' else '✓' end,
    ',' order by s.group_position collate "C" nulls first, s.position collate "C"), '')
  from public.project_item_stage_list s where s.item_id = p_item and s.archived_at is null;
$$;
create function pg_temp.istage(p_item uuid, n text) returns uuid language sql stable security definer as $$
  select s.id from public.project_item_stage_list s
  where s.item_id = p_item and s.name = n and s.archived_at is null limit 1;
$$;
create function pg_temp.lines(p uuid) returns text language sql stable security definer as $$
  select coalesce(string_agg(b.title, ',' order by b.position collate "C"), '')
  from public.project_item_blueprints b where b.project_id = p and b.archived_at is null;
$$;
create function pg_temp.cycle(p uuid) returns public.project_cycles language sql stable security definer as $$
  select c from public.project_cycles c where c.project_id = p order by c.period_start nulls first limit 1;
$$;
create function pg_temp.entries(p_entity text, p_action text, p_id uuid) returns integer language sql stable security definer as $$
  select count(*)::integer from public.activity_log a where a.entity = p_entity and a.action = p_action and a.entity_id = p_id;
$$;

insert into auth.users (id, email)
select id, key || '@example.com' from fx where key not in ('org') and key not like 'client_%';
insert into public.members (id, org_id, full_name, email, role, status, joined_at) values
  (pg_temp.fx('owner'),  pg_temp.fx('org'), 'Test Owner',  'owner@example.com',  'owner', 'active', now()),
  (pg_temp.fx('admin'),  pg_temp.fx('org'), 'Test Admin',  'admin@example.com',  'admin', 'active', now()),
  (pg_temp.fx('admin2'), pg_temp.fx('org'), 'Other Admin', 'admin2@example.com', 'admin', 'active', now()),
  (pg_temp.fx('staff'),  pg_temp.fx('org'), 'Test Crew',   'staff@example.com',  'staff', 'active', now());
insert into public.clients (id, org_id, name, state, admin_id, activated_at) values
  (pg_temp.fx('client_a'), pg_temp.fx('org'), 'Client A', 'active', pg_temp.fx('admin'),  now()),
  (pg_temp.fx('client_b'), pg_temp.fx('org'), 'Client B', 'active', pg_temp.fx('admin2'), now());

create function pg_temp.ptemplate(p uuid) returns public.project_templates language sql stable security definer as $$
  select t from public.project_templates t where t.id = p;
$$;
create function pg_temp.dtemplate(p uuid) returns public.deliverable_templates language sql stable security definer as $$
  select t from public.deliverable_templates t where t.id = p;
$$;

-- A project field, filled on the project.
select pg_temp.as_system();
insert into public.field_definitions (org_id, entity, key, label, type, position)
values (pg_temp.fx('org'), 'project', 'brief_link', 'Brief link', 'text', 'a0');

select pg_temp.as_member('admin');
insert into fx values ('p', public.project_create(pg_temp.fx('client_a'), 'Monthly work', 'monthly',
  'A description that stays on the project', null, array['Shoot', 'Edit'], array['Reel 1', 'Reel 2'],
  null, '{"brief_link": "Neutral value"}'::jsonb));
select is((select p.custom_fields ->> 'brief_link' from public.projects p where p.id = pg_temp.fx('p')), 'Neutral value',
  'the project has a field value');
select public.item_update(pg_temp.item(pg_temp.fx('p'), 'Reel 1'), jsonb_build_object('notes', 'A note on the deliverable'));

-- 1. A repeating project: the structure, never the description or the fields ---------------------
insert into fx values ('t', public.project_save_as_template(pg_temp.fx('p'), 'Saved structure'));
select is((pg_temp.ptemplate(pg_temp.fx('t'))).description, null, 'the description is not copied');
select is((pg_temp.ptemplate(pg_temp.fx('t'))).field_defaults, '{}'::jsonb, 'no custom field value is copied');
select is((pg_temp.ptemplate(pg_temp.fx('t'))).recurrence, 'monthly'::public.recurrence, 'the repeat is copied');
select is((pg_temp.ptemplate(pg_temp.fx('t'))).stage_groups,
  '[{"label": null, "stages": ["Shoot", "Edit"]}]'::jsonb, 'the stage groups are copied');
select is((pg_temp.ptemplate(pg_temp.fx('t'))).deliverables,
  '[{"title": "Reel 1", "stage_groups": [{"label": null, "stages": ["Shoot", "Edit"]}]},
    {"title": "Reel 2", "stage_groups": [{"label": null, "stages": ["Shoot", "Edit"]}]}]'::jsonb,
  'the deliverables, each with its groups, are copied');
select is((select p.description from public.projects p where p.id = pg_temp.fx('p')), 'A description that stays on the project',
  'the project keeps its description');
select is(pg_temp.entries('projects', 'saved_as_template', pg_temp.fx('p')), 1, 'one history row on the project');

-- 2. A one-time project: its deliverables and stages, never the description ----------------------
insert into fx values ('p1', public.project_create(pg_temp.fx('client_a'), 'One-time work', 'one_time',
  'One-time description', app.today_ist() + 7, array['Brief'], array['Single'], null, '{"brief_link": "Other value"}'::jsonb));
insert into fx values ('t1', public.project_save_as_template(pg_temp.fx('p1'), 'One-time structure'));
select ok((pg_temp.ptemplate(pg_temp.fx('t1'))).description is null
          and (pg_temp.ptemplate(pg_temp.fx('t1'))).field_defaults = '{}'::jsonb,
  'one-time: neither the description nor the fields');
select is((pg_temp.ptemplate(pg_temp.fx('t1'))).deliverables,
  '[{"title": "Single", "stage_groups": [{"label": null, "stages": ["Brief"]}]}]'::jsonb,
  'one-time: its deliverables with their stages');

-- 3. A deliverable: names only (no note) ------------------------------------------------------------
insert into fx values ('d', public.item_save_as_template(pg_temp.item(pg_temp.fx('p'), 'Reel 1'), 'Saved deliverable'));
select is((pg_temp.dtemplate(pg_temp.fx('d'))).stage_groups,
  '[{"label": null, "stages": ["Shoot", "Edit"]}]'::jsonb, 'a deliverable template holds its stage names only');

-- 4. Roles --------------------------------------------------------------------------------------------
select pg_temp.as_member('owner');
insert into fx values ('to', public.project_save_as_template(pg_temp.fx('p'), 'Owner structure'));
select ok((pg_temp.ptemplate(pg_temp.fx('to'))).description is null
          and (pg_temp.ptemplate(pg_temp.fx('to'))).field_defaults = '{}'::jsonb
          and (pg_temp.ptemplate(pg_temp.fx('to'))).created_by = pg_temp.fx('owner'),
  'the Owner saves the structure only, as his own');
select pg_temp.as_member('admin');
select is(pg_temp.code($$ select public.project_save_as_template(pg_temp.fx('p'), 'saved STRUCTURE') $$), 'CONFLICT',
  'an active template''s name once, ignoring case');
select pg_temp.as_member('admin2');
select is(pg_temp.code($$ select public.project_save_as_template(pg_temp.fx('p'), 'Not mine') $$), 'NOT_FOUND',
  'another Admin''s client: NOT_FOUND');
select pg_temp.as_member('staff');
select is(pg_temp.code($$ select public.project_save_as_template(pg_temp.fx('p'), 'Crew') $$), 'FORBIDDEN', 'Crew: FORBIDDEN');
select pg_temp.as_anon();
select throws_ok($$ select public.project_save_as_template(pg_temp.fx('p'), 'Anon') $$, '42501', null, 'anon cannot call it');

select * from finish();
rollback;
