-- v2.0 X3 step 3, a project's page (2026-11-06, migration project_page; DATA-MODEL §1 "v2.0 X3"):
-- public.project_page(project_id) is the page's own first-wave reads in one. Who may call it
-- (authenticated only), security invoker, and for the Owner, the client's Admin, another Admin and
-- Crew every key equal to the read it replaces (the same columns, filter and order, RLS deciding):
-- a project the caller may not see is null with every child empty. Neutral names only.
begin;
create extension if not exists pgtap with schema extensions;
select plan(23);

create temporary table fx (key text primary key, id uuid not null);
insert into fx values
  ('owner',  '10000000-0000-4000-8000-000000000001'),
  ('admin',  '10000000-0000-4000-8000-000000000002'),
  ('staff',  '10000000-0000-4000-8000-000000000003'),
  ('client', '00000000-0000-4000-8000-000000014001');
insert into fx select 'org', id from public.organizations limit 1;
insert into fx select 'admin2', m.id from public.members m
  where m.role = 'admin' and m.status = 'active' and m.id <> '10000000-0000-4000-8000-000000000002' order by m.id limit 1;
grant select, insert on fx to authenticated;

create function pg_temp.fx(k text) returns uuid language sql stable as $$ select id from fx where key = k; $$;
create function pg_temp.as_member(k text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', pg_temp.fx(k)::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', pg_temp.fx(k), 'role', 'authenticated')::text, true);
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
-- The reads, as the caller (the same columns, filter and order; the same tie-breaks).
create function pg_temp.api(key text, p uuid) returns jsonb language plpgsql stable as $$
declare v jsonb;
begin
  case key
    when 'project' then
      select to_jsonb(r) into v from (
        select x.id, x.client_id, x.name, x.description, x.recurrence, x.state, x.delivery_date, x.custom_fields,
               x.template_id, x.created_by, x.created_at, x.cancelled_at, x.cancelled_reason, x.held_at, x.held_by,
               x.hold_reason,
               (select jsonb_build_object('name', t.name, 'deleted_at', t.deleted_at) from public.project_templates t
                where t.id = x.template_id) as template,
               (select cc.name from public.clients c join public.client_contacts cc on cc.client_id = c.id
                where c.id = x.client_id and cc.archived_at is null order by cc.is_primary desc, cc.created_at limit 1)
                 as contact_name
        from public.projects x where x.id = p) r;
    when 'cycles' then
      select coalesce(jsonb_agg(to_jsonb(r) order by r.period_start nulls first, r.id), '[]') into v from (
        select id, project_id, period_start, period_end, label, state, item_list_copied, extras_decided_at
        from public.project_cycles where project_id = p) r;
    when 'stages' then
      select coalesce(jsonb_agg(to_jsonb(r) order by r.group_position nulls first, r.position, r.id), '[]') into v from (
        select id, project_id, name, position, group_label, group_position, archived_at
        from public.project_stages where project_id = p) r;
    when 'blueprints' then
      select coalesce(jsonb_agg(to_jsonb(r) order by r.position, r.id), '[]') into v from (
        select id, project_id, title, position, archived_at, stages, stage_groups
        from public.project_item_blueprints where project_id = p) r;
    when 'unfinished' then
      select coalesce(jsonb_agg(i.id order by i.planned_date nulls last, i.id), '[]') into v
      from public.project_items i
      join public.projects x on x.id = i.project_id
      join public.clients c on c.id = x.client_id
      join public.project_cycles y on y.id = i.cycle_id
      where i.project_id = p and i.state in ('open', 'done');
    when 'fields' then
      select coalesce(jsonb_agg(to_jsonb(f) order by f.position, f.id), '[]') into v
      from public.field_definitions f where f.entity = 'project' and f.client_id is null;
    when 'presets' then
      select coalesce(jsonb_agg(to_jsonb(r) order by r.name, r.id), '[]') into v from (
        select id, name, stages, archived_at, created_by from public.stage_presets where deleted_at is null) r;
  end case;
  return coalesce(v, 'null'::jsonb);
end;
$$;
create function pg_temp.got(key text, p uuid) returns jsonb language sql stable as $$
  select case when key = 'unfinished'
    then coalesce((select jsonb_agg(e->'id') from jsonb_array_elements(public.project_page(p)->'unfinished') e), '[]'::jsonb)
    else coalesce(public.project_page(p)->key, 'null'::jsonb) end;
$$;
create function pg_temp.differing(p uuid) returns text language sql stable as $$
  select coalesce(string_agg(k, ', '), 'none')
  from unnest(array['project', 'cycles', 'stages', 'blueprints', 'unfinished', 'fields', 'presets']) k
  where pg_temp.got(k, p) <> pg_temp.api(k, p);
$$;

-- Fixtures: an Active client of the Admin's with a live contact, and the Admin's monthly project of
-- two items and two stages (project_create makes its cycle, items and blueprints).
insert into public.clients (id, org_id, name, state, admin_id, activated_at) values
  (pg_temp.fx('client'), pg_temp.fx('org'), 'Project client 140', 'active', pg_temp.fx('admin'), now());
insert into public.client_contacts (client_id, name, is_primary) values (pg_temp.fx('client'), 'Contact 140', true);
select pg_temp.as_member('admin');
insert into fx values ('project', public.project_create(pg_temp.fx('client'), 'Page project 140', 'monthly',
  stages => array['Shoot', 'Edit'], items => array['Reel 140 a', 'Reel 140 b']));
select pg_temp.as_system();
create temporary table d as select pg_temp.fx('project') as project;
grant select on d to authenticated;

-- 1. Who may call it ---------------------------------------------------------------------------------
select has_function('public', 'project_page', array['uuid'], 'project_page(uuid) exists');
select is((select prosecdef from pg_proc where oid = 'public.project_page(uuid)'::regprocedure), false,
  'it runs as the caller (security invoker): every policy decides');
select ok(has_function_privilege('authenticated', 'public.project_page(uuid)', 'execute'), 'authenticated may call it');
select ok(not has_function_privilege('anon', 'public.project_page(uuid)', 'execute'), 'anon may not');
select ok(not has_function_privilege('service_role', 'public.project_page(uuid)', 'execute'), 'service_role may not');

-- 2. The Owner -----------------------------------------------------------------------------------------
select pg_temp.as_member('owner');
select is(pg_temp.differing((select project from d)), 'none', 'Owner: every key equals its read');
select is(public.project_page((select project from d))->'project'->>'contact_name', 'Contact 140', 'Owner: the primary contact');
select is(jsonb_array_length(public.project_page((select project from d))->'unfinished'), 2, 'Owner: the two open items');
select is(public.project_page((select project from d))->'unfinished'->0->'project'->'client'->>'name', 'Project client 140',
  'Owner: each item with its project and client');
select ok(jsonb_array_length(public.project_page((select project from d))->'cycles') >= 1, 'Owner: its cycle');
select is(jsonb_array_length(public.project_page((select project from d))->'stages'), 2, 'Owner: its two stages');
select throws_ok($$ select public.project_page(null) $$, 'P0001', null, 'no project: refused');

-- The exact key sets: only the columns the reads name, so nothing comes from a money table (invariant 2).
select is((select array_agg(k order by k) from jsonb_object_keys(public.project_page((select project from d))) k),
  array['blueprints', 'cycles', 'fields', 'presets', 'project', 'stages', 'unfinished'], 'the exact top-level keys');
select is((select array_agg(k order by k) from jsonb_object_keys(public.project_page((select project from d))->'project') k),
  array['cancelled_at', 'cancelled_reason', 'client_id', 'contact_name', 'created_at', 'created_by', 'custom_fields',
        'delivery_date', 'description', 'held_at', 'held_by', 'hold_reason', 'id', 'name', 'recurrence', 'state',
        'template', 'template_id'], 'the project''s exact keys: PROJECT_COLUMNS, its template and contact name');
select is((select array_agg(k order by k) from jsonb_object_keys(public.project_page((select project from d))->'unfinished'->0) k),
  array['approved_at', 'approved_by', 'cancelled_at', 'cancelled_by', 'cancelled_reason', 'carried_from_item_id',
        'carry_decision', 'close_kind', 'created_at', 'custom_fields', 'cycle', 'cycle_id', 'done_at', 'done_by', 'id',
        'notes', 'origin_cycle_id', 'planned_date', 'position', 'project', 'project_id', 'state', 'title'],
  'an item''s exact keys: ITEM_COLUMNS, its project and cycle');
select is((select array_agg(k order by k) from jsonb_object_keys(public.project_page((select project from d))->'unfinished'->0->'project') k),
  array['client', 'client_id', 'held_at', 'name', 'recurrence'], 'an item''s project: its exact keys');

-- 3. The client's Admin --------------------------------------------------------------------------------
select pg_temp.as_member('admin');
select is(pg_temp.differing((select project from d)), 'none', 'the client''s Admin: every key equals its read');
select isnt(public.project_page((select project from d))->'project', 'null'::jsonb, 'the client''s Admin: the project');

-- 4. Another Admin and Crew: nothing of it -------------------------------------------------------------
select pg_temp.as_member('admin2');
select is(pg_temp.differing((select project from d)), 'none', 'another Admin: every key equals its read');
select is(public.project_page((select project from d))->'project', 'null'::jsonb, 'another Admin: no project');
select is(jsonb_array_length(public.project_page((select project from d))->'unfinished'), 0, 'another Admin: no items');
select pg_temp.as_member('staff');
select is(pg_temp.differing((select project from d)), 'none', 'Crew: every key equals its read');
select is(public.project_page((select project from d))->'project', 'null'::jsonb, 'Crew: no project');

select * from finish();
rollback;
