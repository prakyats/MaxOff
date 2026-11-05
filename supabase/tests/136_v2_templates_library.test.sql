-- v2.0 X3 step 3, Settings → Templates (2026-11-05, migration templates_library; DATA-MODEL §1
-- "v2.0 X3"): public.templates_library() is the page's five template reads in one. Who may call it
-- (authenticated only), security invoker, and for the Owner, an Admin and Crew each key equal to
-- the API read it replaces (the same columns, filter and order, RLS deciding): a deleted template
-- left out, an archived one kept; a caller without the key gets [] as the API read gave them.
-- Neutral names only.
begin;
create extension if not exists pgtap with schema extensions;
select plan(22);

create temporary table fx (key text primary key, id uuid not null);
insert into fx values
  ('owner', '10000000-0000-4000-8000-000000000001'),
  ('admin', '10000000-0000-4000-8000-000000000002'),
  ('staff', '10000000-0000-4000-8000-000000000003'),
  ('tpl_live', '00000000-0000-4000-8000-000000013601'),
  ('tpl_archived', '00000000-0000-4000-8000-000000013602'),
  ('tpl_deleted', '00000000-0000-4000-8000-000000013603');
insert into fx select 'org', id from public.organizations limit 1;
insert into fx select 'type', id from public.task_types where org_id = (select id from fx where key = 'org') order by position limit 1;
grant select on fx to authenticated, anon;

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
-- The five API reads, as the caller (the same columns, filter and order; an id breaks a tie).
create function pg_temp.api(key text) returns jsonb language plpgsql stable as $$
declare v jsonb;
begin
  case key
    when 'task_templates' then
      select coalesce(jsonb_agg(to_jsonb(r) order by r.name, r.id), '[]') into v
      from (select id, name, task_type_id, description, default_priority, stages, field_defaults, archived_at,
                   created_by, reminder_rules from public.task_templates where deleted_at is null) r;
    when 'task_types' then
      select coalesce(jsonb_agg(to_jsonb(r) order by r.position, r.id), '[]') into v
      from (select id, name, kind, has_location, shows_on_calendar, archived_at, position, default_reminders, color
            from public.task_types) r;
    when 'project_templates' then
      select coalesce(jsonb_agg(to_jsonb(r) order by r.name, r.id), '[]') into v
      from (select id, name, description, recurrence, stages, items, stage_groups, deliverables, field_defaults,
                   archived_at, created_by from public.project_templates where deleted_at is null) r;
    when 'deliverable_templates' then
      select coalesce(jsonb_agg(to_jsonb(r) order by r.name, r.id), '[]') into v
      from (select id, name, stage_groups, archived_at, archived_reason, created_by
            from public.deliverable_templates where deleted_at is null) r;
    when 'stage_presets' then
      select coalesce(jsonb_agg(to_jsonb(r) order by r.name, r.id), '[]') into v
      from (select id, name, stages, archived_at, created_by from public.stage_presets where deleted_at is null) r;
  end case;
  return v;
end;
$$;
create function pg_temp.all_equal() returns boolean language sql stable as $$
  select bool_and(public.templates_library()->k = pg_temp.api(k))
  from unnest(array['task_templates', 'task_types', 'project_templates', 'deliverable_templates', 'stage_presets']) k;
$$;
create function pg_temp.ids(key text) returns jsonb language sql stable as $$
  select coalesce(jsonb_agg(e->'id'), '[]') from jsonb_array_elements(public.templates_library()->key) e;
$$;

-- Fixtures: three task templates, one live, one archived, one deleted (the Owner's delete).
insert into public.task_templates (id, org_id, name, task_type_id, created_by) values
  (pg_temp.fx('tpl_live'), pg_temp.fx('org'), 'Lib live 136', pg_temp.fx('type'), pg_temp.fx('owner')),
  (pg_temp.fx('tpl_archived'), pg_temp.fx('org'), 'Lib archived 136', pg_temp.fx('type'), pg_temp.fx('owner')),
  (pg_temp.fx('tpl_deleted'), pg_temp.fx('org'), 'Lib deleted 136', pg_temp.fx('type'), pg_temp.fx('owner'));
update public.task_templates set archived_at = now() where id = pg_temp.fx('tpl_archived');
select pg_temp.as_member('owner');
select public.template_delete('task', pg_temp.fx('tpl_deleted'));
select pg_temp.as_system();

-- 1. Who may call it ------------------------------------------------------------------------------
select has_function('public', 'templates_library', array[]::text[], 'templates_library() exists');
select is((select prosecdef from pg_proc where oid = 'public.templates_library()'::regprocedure), false,
  'it runs as the caller (security invoker): each table''s policy decides');
select ok(has_function_privilege('authenticated', 'public.templates_library()', 'execute'), 'authenticated may call it');
select ok(not has_function_privilege('anon', 'public.templates_library()', 'execute'), 'anon may not');
select ok(not has_function_privilege('service_role', 'public.templates_library()', 'execute'), 'service_role may not');
select is((select proconfig from pg_proc where oid = 'public.templates_library()'::regprocedure), array['search_path=""'],
  'the empty search_path');

-- 2. The Owner: every key equal to its API read ----------------------------------------------------
select pg_temp.as_member('owner');
select is(public.templates_library()->'task_templates', pg_temp.api('task_templates'), 'Owner: task templates equal the API read');
select is(public.templates_library()->'task_types', pg_temp.api('task_types'), 'Owner: task types equal the API read');
select is(public.templates_library()->'project_templates', pg_temp.api('project_templates'), 'Owner: project templates equal the API read');
select is(public.templates_library()->'deliverable_templates', pg_temp.api('deliverable_templates'), 'Owner: deliverable templates equal the API read');
select is(public.templates_library()->'stage_presets', pg_temp.api('stage_presets'), 'Owner: stage presets equal the API read');
select ok(pg_temp.ids('task_templates') @> jsonb_build_array(pg_temp.fx('tpl_live'), pg_temp.fx('tpl_archived')),
  'Owner: the live and the archived template');
select ok(not (pg_temp.ids('task_templates') @> jsonb_build_array(pg_temp.fx('tpl_deleted'))), 'Owner: never the deleted one');
select ok(jsonb_array_length(public.templates_library()->'task_types') > 0, 'Owner: the types are there');

-- 3. An Admin ---------------------------------------------------------------------------------------
select pg_temp.as_member('admin');
select ok(pg_temp.all_equal(), 'Admin: every key equals its API read');
select ok(pg_temp.ids('task_templates') @> jsonb_build_array(pg_temp.fx('tpl_live')), 'Admin: the templates (templates.manage)');
select is(public.templates_library()->'stage_presets', pg_temp.api('stage_presets'),
  'Admin: the presets exactly as lists.manage shows them');

-- 4. Crew: no template key, so [] as the API read gave them; the types as for everyone -------------
select pg_temp.as_member('staff');
select ok(pg_temp.all_equal(), 'Crew: every key equals its API read');
select is(public.templates_library()->'task_templates', '[]'::jsonb, 'Crew: no task templates');
select is(public.templates_library()->'project_templates', '[]'::jsonb, 'Crew: no project templates');
select ok(jsonb_array_length(public.templates_library()->'task_types') > 0, 'Crew: the types, as the API read shows them');
select ok(public.templates_library() ?& array['task_templates', 'task_types', 'project_templates', 'deliverable_templates', 'stage_presets'],
  'the five keys');

select * from finish();
rollback;
