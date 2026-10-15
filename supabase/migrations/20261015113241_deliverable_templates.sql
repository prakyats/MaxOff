-- Phase 6b Release 2 (v1.7.1), ROADMAP 6b.16 (templates part) and 6b.13 (2)(b): deliverable templates,
-- "Save as template" from a project or a deliverable, and a deliverable added from a template's groups
-- (DATA-MODEL §5b "Deliverable templates and Save as template"). EXPAND-ONLY, ON THE TEAM'S EXISTING
-- DATA: one new table, three new functions, one describer re-created with every earlier answer kept; no
-- existing row, column or constraint is touched. NOTHING IS PRE-DEFINED: no template is seeded and
-- nothing below depends on a name. Append-only: never edit once applied.
--
-- 1. deliverable_templates: a reusable deliverable (a name and its stage groups, the §5b shape).
--    Shared like project templates (templates.manage reads every one; an Admin writes their own, the
--    Owner any; Crew nothing). Archived with a reason (invariant 9), never deleted. Audited.
-- 2. project_save_as_template(project_id, name): a new project template copied from a project (its
--    default stage groups, its deliverables list lines with each line's groups, or for a one-time
--    project its deliverables' own stages; the repeat, description and the active fields' values).
--    Copied, never linked: the project changes in nothing but one history row "saved as template".
-- 3. item_save_as_template(item_id, name): a deliverable template from a deliverable's active stages
--    in their groups (names only: ticks, dates and notes stay on the deliverable). One history row.
-- 4. item_add_grouped(cycle_id, title, planned_date, notes, stage_groups, custom_fields): item_add with
--    the new deliverable's own stage groups (a deliverable template's, edited before adding); null
--    groups = the project's defaults, exactly as item_add.
-- 5. app.client_work_activity_shown also shows 'saved_as_template' on a project and a deliverable.

-- 1. The table ----------------------------------------------------------------------------------------------
create table public.deliverable_templates (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null default app.current_org_id() references public.organizations (id),
  name text not null check (length(btrim(name)) between 1 and 120),
  stage_groups jsonb not null default '[]'::jsonb check (jsonb_typeof(stage_groups) = 'array'),
  created_by uuid not null default auth.uid() references public.members (id),
  archived_at timestamptz null,
  archived_reason text null check (archived_reason is null or length(btrim(archived_reason)) between 1 and 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint deliverable_templates_archived_reason check ((archived_at is null) = (archived_reason is null))
);
comment on table public.deliverable_templates is
  '6b Release 2 (ROADMAP 6b.13 (2), 6b.16): a reusable deliverable: a name and its stage groups '
  '([{label, stages}], app.stage_groups_check). Shared: templates.manage reads and uses every active one; '
  'an Admin edits and archives their own, the Owner any; Crew nothing. Archived with a reason, never '
  'deleted. Copied into a deliverable, never linked. Audited.';
comment on column public.deliverable_templates.archived_reason is
  'Why it was archived (invariant 9): set with archived_at, cleared with it on a restore.';

create unique index deliverable_templates_active_name_unique
  on public.deliverable_templates (org_id, lower(btrim(name))) where archived_at is null;
create index deliverable_templates_org_idx on public.deliverable_templates (org_id, archived_at);
create index deliverable_templates_created_by_idx on public.deliverable_templates (created_by);

create trigger set_updated_at before update on public.deliverable_templates
  for each row execute function app.set_updated_at();
create trigger audit_row_change after insert or update or delete on public.deliverable_templates
  for each row execute function app.audit_row_change();

-- The author is the caller and never changes; the name trimmed; the groups checked and normalized in
-- stageGroupsIssue's words; archived only with a reason. Security invoker: the caller's role runs it.
create function app.deliverable_templates_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.name := btrim(new.name);
  new.archived_reason := nullif(btrim(coalesce(new.archived_reason, '')), '');
  if tg_op = 'UPDATE' then
    if new.created_by is distinct from old.created_by or new.org_id is distinct from old.org_id then
      perform app.fail('FORBIDDEN', 'A template keeps its author.');
    end if;
  elsif new.created_by is distinct from auth.uid() then
    perform app.fail('FORBIDDEN', 'A template is written by the person creating it.');
  end if;
  if new.archived_at is not null and new.archived_reason is null then
    perform app.fail('REASON_REQUIRED', 'Say why it is archived.');
  end if;
  if new.archived_at is null then
    new.archived_reason := null;
  end if;
  new.stage_groups := app.stage_groups_check(coalesce(new.stage_groups, '[]'::jsonb));
  return new;
end;
$$;
revoke all on function app.deliverable_templates_guard() from public, anon;
grant execute on function app.deliverable_templates_guard() to authenticated, service_role;
comment on function app.deliverable_templates_guard() is
  'BEFORE INSERT OR UPDATE on deliverable_templates (6b Release 2): the author is the caller and never '
  'changes; the name trimmed; stage_groups checked (app.stage_groups_check, VALIDATION); archived only with '
  'a reason (REASON_REQUIRED), the reason cleared on a restore.';

create trigger deliverable_templates_guard before insert or update on public.deliverable_templates
  for each row execute function app.deliverable_templates_guard();

alter table public.deliverable_templates enable row level security;
create policy deliverable_templates_select on public.deliverable_templates for select to authenticated
  using (org_id = (select c.org_id from app.current_member() c)
         and (select app.has_permission('templates.manage')));
create policy deliverable_templates_insert on public.deliverable_templates for insert to authenticated
  with check (org_id = (select c.org_id from app.current_member() c)
              and (select app.has_permission('templates.manage'))
              and created_by = (select c.id from app.current_member() c));
create policy deliverable_templates_update on public.deliverable_templates for update to authenticated
  using (org_id = (select c.org_id from app.current_member() c)
         and (select app.has_permission('templates.manage'))
         and ((select app.is_owner()) or created_by = (select c.id from app.current_member() c)))
  with check (org_id = (select c.org_id from app.current_member() c)
              and (select app.has_permission('templates.manage'))
              and ((select app.is_owner()) or created_by = (select c.id from app.current_member() c)));

revoke all on public.deliverable_templates from anon;
revoke all on public.deliverable_templates from authenticated;
grant select on public.deliverable_templates to authenticated;
grant insert (name, stage_groups) on public.deliverable_templates to authenticated;
grant update (name, stage_groups, archived_at, archived_reason) on public.deliverable_templates to authenticated;

-- 2. Save a project as a project template ---------------------------------------------------------------------
create function public.project_save_as_template(project_id uuid, name text)
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
  v_fields jsonb;
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
  -- The values of the project's active fields (an archived field's value stays on the project only).
  select coalesce(jsonb_object_agg(e.key, e.value), '{}'::jsonb) into v_fields
  from jsonb_each(coalesce(v_project.custom_fields, '{}'::jsonb)) e
  where exists (select 1 from public.field_definitions d
                where d.org_id = v_project.org_id and d.entity = 'project' and d.key = e.key
                  and d.archived_at is null);
  insert into public.project_templates (org_id, name, description, recurrence, stage_groups, deliverables,
                                        field_defaults, created_by)
  values (v_project.org_id, v_name, v_project.description, v_project.recurrence, v_groups, v_deliverables,
          v_fields, v_caller.id)
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
  '6b Release 2 (ROADMAP 6b.13 (b), 6b.16): projects.manage on the caller''s clients and templates.manage; '
  'any project state. A new project template copied from the project: its default stage groups, its '
  'deliverables list (each line''s groups) or, one-time, its deliverables with their active stages in '
  'groups, the repeat, the description and the active project fields'' values. Copied, never linked: the '
  'project changes in nothing; one history row on it (saved_as_template, meta {template_id, name}). '
  'CONFLICT when an active template has the name. Returns the template''s id.';

-- 3. Save a deliverable as a deliverable template ---------------------------------------------------------------
create function public.item_save_as_template(item_id uuid, name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller public.members;
  v_item public.project_items;
  v_name text;
  v_groups jsonb;
  v_id uuid;
begin
  v_caller := app.client_work_caller('projects.manage', 'You cannot save deliverables as templates.');
  if not app.has_permission('templates.manage') then
    perform app.fail('FORBIDDEN', 'You cannot make templates.');
  end if;
  select i.* into v_item from public.project_items i
  where i.id = item_save_as_template.item_id and i.org_id = v_caller.org_id;
  if v_item.id is null or not app.project_visible(v_item.project_id) then
    perform app.fail('NOT_FOUND', 'This deliverable is not one of yours.');
  end if;
  v_name := app.client_work_text(item_save_as_template.name, 120, 'Name the template in up to 120 characters.');
  if exists (select 1 from public.deliverable_templates t
             where t.org_id = v_item.org_id and t.archived_at is null and lower(btrim(t.name)) = lower(v_name)) then
    perform app.fail('CONFLICT', 'Another deliverable template already uses this name.');
  end if;
  -- Its active stages in their groups, in the screens' order; names only (ticks stay on the deliverable).
  select coalesce(jsonb_agg(jsonb_build_object('label', g.group_label, 'stages', g.stages)
                            order by g.group_position collate "C" nulls first), '[]'::jsonb)
    into v_groups
  from (
    select s.group_label, s.group_position, to_jsonb(array_agg(s.name order by s.position collate "C")) as stages
    from public.project_item_stage_list s
    where s.item_id = v_item.id and s.archived_at is null
    group by s.group_label, s.group_position
  ) g;
  insert into public.deliverable_templates (org_id, name, stage_groups, created_by)
  values (v_item.org_id, v_name, v_groups, v_caller.id)
  returning id into v_id;
  insert into public.activity_log (org_id, actor_id, entity, entity_id, action, meta)
  values (v_item.org_id, v_caller.id, 'project_items', v_item.id, 'saved_as_template',
          jsonb_build_object('template_id', v_id, 'name', v_name));
  return v_id;
exception when unique_violation then
  perform app.fail('CONFLICT', 'Another deliverable template already uses this name.');
  return null;
end;
$$;
revoke all on function public.item_save_as_template(uuid, text) from public, anon;
grant execute on function public.item_save_as_template(uuid, text) to authenticated, service_role;
comment on function public.item_save_as_template(uuid, text) is
  '6b Release 2 (ROADMAP 6b.13 (2)(b), 6b.16): projects.manage on the caller''s clients and templates.manage; '
  'any deliverable state. A new deliverable template from the deliverable''s active stages in their groups '
  '(names only; ticks, dates and notes stay). One history row on the deliverable (saved_as_template, meta '
  '{template_id, name}). CONFLICT when an active deliverable template has the name. Returns its id.';

-- 4. A deliverable added with its own groups ---------------------------------------------------------------------
create function public.item_add_grouped(
  cycle_id uuid,
  title text,
  planned_date date default null,
  notes text default null,
  stage_groups jsonb default null,
  custom_fields jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller public.members;
  v_cycle public.project_cycles;
  v_project public.projects;
  v_client public.clients;
  v_groups jsonb;
  v_last text;
  v_id uuid;
begin
  v_caller := app.client_work_caller('projects.manage', 'You cannot add deliverables.');
  select c.* into v_cycle from public.project_cycles c
  where c.id = item_add_grouped.cycle_id and c.org_id = v_caller.org_id;
  if v_cycle.id is null then
    perform app.fail('NOT_FOUND', 'This cycle is not one of yours.');
  end if;
  v_project := app.project_lock(v_cycle.project_id);
  perform app.project_check_writable(v_project);
  v_client := app.project_client(v_project);
  if v_client.state = 'inactive' then
    perform app.fail('INVALID_STATE', format('%s is closed, so it takes no new deliverables.', v_client.name));
  end if;
  if v_cycle.period_end is not null and v_cycle.period_end < app.today_ist() then
    perform app.fail('INVALID_STATE', format('%s has ended: add the deliverable to the current cycle.', v_cycle.label));
  end if;
  if app.cycle_live_items(v_cycle.id) >= 100 then
    perform app.fail('VALIDATION', 'A cycle holds at most 100 deliverables.');
  end if;
  -- Checked before anything is written: null (or JSON null) = the project's default groups.
  v_groups := case when item_add_grouped.stage_groups is null or jsonb_typeof(item_add_grouped.stage_groups) = 'null'
                   then app.project_default_stage_groups(v_project.id)
                   else app.stage_groups_check(item_add_grouped.stage_groups) end;
  select max(i.position collate "C") into v_last from public.project_items i where i.cycle_id = v_cycle.id;
  insert into public.project_items (
    org_id, project_id, cycle_id, title, position, planned_date, notes, custom_fields, origin_cycle_id, created_by)
  values (
    v_project.org_id, v_project.id, v_cycle.id,
    app.client_work_text(item_add_grouped.title, 200, 'Give the deliverable a title of up to 200 characters.'),
    app.client_work_next_position(v_last), item_add_grouped.planned_date,
    app.client_work_text(item_add_grouped.notes, 5000, 'Keep the notes under 5000 characters.', false),
    coalesce(item_add_grouped.custom_fields, '{}'::jsonb), v_cycle.id, v_caller.id)
  returning id into v_id;
  perform app.item_stage_list_init_groups(v_id, v_groups);
  perform app.cycle_refresh(v_cycle.id);
  return v_id;
end;
$$;
revoke all on function public.item_add_grouped(uuid, text, date, text, jsonb, jsonb) from public, anon;
grant execute on function public.item_add_grouped(uuid, text, date, text, jsonb, jsonb) to authenticated, service_role;
comment on function public.item_add_grouped(uuid, text, date, text, jsonb, jsonb) is
  '6b Release 2 (ROADMAP 6b.16, "+ Add deliverable" from a deliverable template): item_add with the new '
  'deliverable''s own stage groups (checked, VALIDATION); null groups = the project''s defaults, as item_add. '
  'The same rules as item_add: projects.manage on the caller''s clients, the project open or in progress, the '
  'client not Inactive, a cycle that has not ended, at most 100 live. Returns its id.';

-- 5. The history shows the new entries ---------------------------------------------------------------------------
create or replace function app.client_work_activity_shown(p_entity text, p_action text, p_diff jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(case p_entity
    when 'projects' then
      p_action in ('insert', 'started', 'completed', 'cancelled', 'reopened', 'saved_as_template')
      or (p_action = 'update'
          and coalesce(p_diff -> 'new', '{}'::jsonb) ?| array['delivery_date', 'name', 'description', 'custom_fields'])
    when 'project_stages' then
      p_action in ('insert', 'archived', 'group_renamed', 'group_moved')
      or (p_action = 'update'
          and coalesce(p_diff -> 'new', '{}'::jsonb) ?| array['name', 'position', 'group_label', 'group_position'])
    when 'project_item_blueprints' then
      p_action in ('insert', 'archived')
      or (p_action = 'update'
          and coalesce(p_diff -> 'new', '{}'::jsonb) ?| array['title', 'position', 'stages', 'stage_groups'])
    when 'project_item_stage_list' then
      p_action in ('insert', 'archived', 'ticked', 'unticked', 'group_renamed', 'group_moved')
      or (p_action = 'update'
          and coalesce(p_diff -> 'new', '{}'::jsonb) ?| array['name', 'position', 'group_label', 'group_position'])
    when 'project_cycles' then
      p_action in ('generated', 'insert', 'item_list_added')
    when 'project_items' then
      p_action in ('insert', 'done', 'not_done', 'approved', 'rejected', 'sent_back', 'reopened', 'cancelled',
                   'closed', 'carried', 'carried_in', 'left_pending', 'saved_as_template')
      or (p_action = 'update'
          and coalesce(p_diff -> 'new', '{}'::jsonb) ?| array['title', 'notes', 'planned_date', 'custom_fields', 'position'])
    when 'project_item_stages' then
      p_action in ('ticked', 'unticked')
  end, false);
$$;
comment on function app.client_work_activity_shown(text, text, jsonb) is
  'Internal (review fix 2026-10-09; 6b Release 1; 6b Release 2: + saved_as_template on a project and a '
  'deliverable): whether the project''s history describes an audit entry: the same list as '
  'describeProjectActivity in modules/client-work/domain/activity.ts. Read by project_activity and '
  'item_last_changes; change both together.';
