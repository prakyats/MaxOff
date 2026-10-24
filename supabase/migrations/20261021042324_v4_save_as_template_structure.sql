-- v1.8 unit V4 (owner 2026-10-16): "Save as template copies the structure only: the deliverables, the
-- stage groups and the repeat; never the project's description or its custom fields' values."
-- EXPAND-ONLY: project_save_as_template is re-created with the same signature, grants and every other
-- behaviour (permissions, refusals, the history row); only what it copies changes. Templates already
-- saved keep their description and field defaults (no row is touched). item_save_as_template already
-- copies names only (no notes, dates, ticks or fields) and is left as it is. Append-only.

create or replace function public.project_save_as_template(project_id uuid, name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller public.members;
  v_project public.projects;
  v_name text;
  v_groups jsonb;
  v_deliverables jsonb;
  v_id uuid;
begin
  v_caller := app.client_work_caller('projects.manage', 'You cannot save projects as templates.');
  if not app.has_permission('templates.manage') then
    perform app.fail('FORBIDDEN', 'You cannot make templates.');
  end if;
  -- Any state: a finished month is a good starting point too. Visible first (NOT_FOUND otherwise).
  v_project := app.project_lock(project_save_as_template.project_id);
  v_name := app.client_work_text(project_save_as_template.name, 120, 'Name the template in up to 120 characters.');
  if exists (select 1 from public.project_templates t
             where t.org_id = v_project.org_id and t.archived_at is null and lower(btrim(t.name)) = lower(v_name)) then
    perform app.fail('CONFLICT', 'Another template already uses this name.');
  end if;
  v_groups := app.project_default_stage_groups(v_project.id);
  if v_project.recurrence = 'one_time' then
    -- A one-time project has no deliverables list: its deliverables are the list, each with its own
    -- active stages in their groups (names only). A closed deliverable is left out, unless the whole
    -- project was cancelled (the cancel closed them all).
    select coalesce(jsonb_agg(jsonb_build_object('title', i.title, 'stage_groups', (
             select coalesce(jsonb_agg(jsonb_build_object('label', g.group_label, 'stages', g.stages)
                                       order by g.group_position collate "C" nulls first), '[]'::jsonb)
             from (
               select s.group_label, s.group_position,
                      to_jsonb(array_agg(s.name order by s.position collate "C")) as stages
               from public.project_item_stage_list s
               where s.item_id = i.id and s.archived_at is null
               group by s.group_label, s.group_position
             ) g))
           order by i.position collate "C"), '[]'::jsonb)
      into v_deliverables
    from public.project_items i
    where i.project_id = v_project.id and (i.state <> 'cancelled' or v_project.state = 'cancelled');
  else
    -- The deliverables list: each line with its groups (a line from before groups: its stages as one
    -- untitled group).
    select coalesce(jsonb_agg(jsonb_build_object('title', b.title,
                                                 'stage_groups', app.stage_groups_of(b.stages, b.stage_groups))
                              order by b.position collate "C"), '[]'::jsonb)
      into v_deliverables
    from public.project_item_blueprints b
    where b.project_id = v_project.id and b.archived_at is null;
  end if;
  insert into public.project_templates (org_id, name, description, recurrence, stage_groups, deliverables,
                                        field_defaults, created_by)
    -- The structure only (owner 2026-10-16): never the project's description or its fields' values.
  values (v_project.org_id, v_name, null, v_project.recurrence, v_groups, v_deliverables,
          '{}'::jsonb, v_caller.id)
  returning id into v_id;
  -- The project's own history says so; nothing on the project changes.
  insert into public.activity_log (org_id, actor_id, entity, entity_id, action, meta)
  values (v_project.org_id, v_caller.id, 'projects', v_project.id, 'saved_as_template',
          jsonb_build_object('template_id', v_id, 'name', v_name));
  return v_id;
exception when unique_violation then
  perform app.fail('CONFLICT', 'Another template already uses this name.');
  return null;
end;
$$;
revoke all on function public.project_save_as_template(uuid, text) from public, anon;
grant execute on function public.project_save_as_template(uuid, text) to authenticated, service_role;
comment on function public.project_save_as_template(uuid, text) is
  'v1.8 V4 (owner 2026-10-16: Save as template copies the structure only): projects.manage on the caller''s '
  'clients and templates.manage; any project state. A new project template copied from the project''s '
  'structure: its default stage groups, its deliverables list (each line''s groups) or, one-time, its '
  'deliverables with their active stages in groups, and the repeat. Never the description or any custom '
  'field''s value (the template''s description is empty and its field defaults {}). Copied, never linked: '
  'the project changes in nothing; one history row on it (saved_as_template, meta {template_id, name}). '
  'CONFLICT when an active template has the name. Returns the template''s id.';
