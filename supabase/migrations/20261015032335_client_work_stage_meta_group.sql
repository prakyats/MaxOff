-- Phase 6b Release 1, the second review's S1 (2026-10-15): the history of ONE stage's tick, untick,
-- rename, move or removal names its group too, so a stage that shares its name with another group's
-- reads "Group · Stage" (DATA-MODEL §5b). The audit trigger writes only the changed keys into the diff,
-- so the group goes into meta next to stage_id and name, as migration client_work_item_stage_meta put
-- the name there. EXPAND-ONLY: five functions re-created with the same signatures and bodies, one key
-- added to their meta; nothing else. Append-only.

create or replace function public.item_stage_tick(stage_id uuid, done boolean default true)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller public.members;
  v_stage public.project_item_stage_list;
  v_item public.project_items;
begin
  v_caller := app.client_work_caller('items.tick', 'You cannot tick stages.');
  v_stage := app.item_stage_find(item_stage_tick.stage_id);
  -- Decision 7: open items only (a done item is approved, so its ticks are locked).
  v_item := app.item_stage_item(v_stage.item_id);
  select s.* into v_stage from public.project_item_stage_list s where s.id = v_stage.id for update;
  if v_stage.archived_at is not null then
    perform app.fail('INVALID_STATE', 'This stage was removed.');
  end if;
  if item_stage_tick.done is null then
    perform app.fail('VALIDATION', 'Tick or untick the stage.');
  end if;
  if item_stage_tick.done then
    if v_stage.done_at is not null then
      return false;
    end if;
    perform set_config('app.audit_override', jsonb_build_object(
      'action', 'ticked', 'meta', jsonb_build_object('stage_id', v_stage.id, 'name', v_stage.name, 'group', v_stage.group_label))::text, true);
    update public.project_item_stage_list set done_at = now(), done_by = v_caller.id where id = v_stage.id;
    perform app.project_mark_started(v_item.project_id);
  else
    if v_stage.done_at is null then
      return false;
    end if;
    perform set_config('app.audit_override', jsonb_build_object(
      'action', 'unticked', 'meta', jsonb_build_object('stage_id', v_stage.id, 'name', v_stage.name, 'group', v_stage.group_label))::text, true);
    update public.project_item_stage_list set done_at = null, done_by = null where id = v_stage.id;
  end if;
  return true;
end;
$$;

create or replace function public.item_stage_archive(stage_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller public.members;
  v_stage public.project_item_stage_list;
begin
  v_caller := app.client_work_caller('projects.manage', 'You cannot edit items.');
  v_stage := app.item_stage_find(item_stage_archive.stage_id);
  perform app.item_stage_item(v_stage.item_id);
  select s.* into v_stage from public.project_item_stage_list s where s.id = v_stage.id for update;
  if v_stage.archived_at is not null then
    perform app.fail('INVALID_STATE', 'This stage was already removed.');
  end if;
  -- Archived, never deleted: it leaves the item, its tick kept on the row and in the history.
  perform set_config('app.audit_override', jsonb_build_object(
    'action', 'archived', 'meta', jsonb_build_object('stage_id', v_stage.id, 'name', v_stage.name, 'group', v_stage.group_label))::text, true);
  update public.project_item_stage_list set archived_at = now() where id = v_stage.id;
end;
$$;

create or replace function public.item_stage_update(stage_id uuid, changes jsonb)
returns text[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller public.members;
  v_stage public.project_item_stage_list;
  v_key text;
  v_name text;
  v_position text;
  v_label text;
  v_group_position text;
  v_last text;
  v_changed text[] := '{}';
begin
  v_caller := app.client_work_caller('projects.manage', 'You cannot edit deliverables.');
  v_stage := app.item_stage_find(item_stage_update.stage_id);
  perform app.item_stage_item(v_stage.item_id);
  select s.* into v_stage from public.project_item_stage_list s where s.id = v_stage.id for update;
  if v_stage.archived_at is not null then
    perform app.fail('INVALID_STATE', 'This stage was removed.');
  end if;
  if changes is null or jsonb_typeof(changes) <> 'object' then
    perform app.fail('VALIDATION', 'Nothing to change.');
  end if;
  for v_key in select jsonb_object_keys(changes) loop
    if v_key not in ('name', 'position', 'group_label') then
      perform app.fail('VALIDATION', format('"%s" is not a stage detail that can change.', v_key));
    end if;
  end loop;
  v_name := case when changes ? 'name'
    then app.client_work_text(changes ->> 'name', 120, 'Give the stage a name of up to 120 characters.')
    else v_stage.name end;
  v_label := v_stage.group_label;
  v_group_position := v_stage.group_position;
  if changes ? 'group_label' then
    v_label := app.stage_group_label(changes ->> 'group_label');
    if v_label is not null then
      v_label := app.item_stage_group_find(v_stage.item_id, v_label);
      if v_label is null then
        perform app.fail('VALIDATION', format('There is no group called %s: add it first.', changes ->> 'group_label'));
      end if;
      select s.group_position into v_group_position from public.project_item_stage_list s
      where s.item_id = v_stage.item_id and s.archived_at is null and s.group_label = v_label limit 1;
    else
      v_group_position := null;
    end if;
  end if;
  if changes ? 'position' then
    v_position := app.client_work_position(changes ->> 'position');
  elsif v_label is distinct from v_stage.group_label then
    select max(s.position collate "C") into v_last from public.project_item_stage_list s
    where s.item_id = v_stage.item_id and s.group_label is not distinct from v_label;
    v_position := app.client_work_next_position(v_last);
  else
    v_position := v_stage.position;
  end if;
  if v_name is distinct from v_stage.name or v_label is distinct from v_stage.group_label then
    perform app.item_stage_name_free(v_stage.item_id, v_name, v_stage.id, v_label);
  end if;
  if v_name is distinct from v_stage.name then v_changed := array_append(v_changed, 'name'); end if;
  if v_position is distinct from v_stage.position then v_changed := array_append(v_changed, 'position'); end if;
  if v_label is distinct from v_stage.group_label then v_changed := array_append(v_changed, 'group_label'); end if;
  if cardinality(v_changed) > 0 then
    -- The tick (done_at / done_by) is untouched by any of this; the entry names the stage
    -- (migration client_work_item_stage_meta).
    perform set_config('app.audit_override', jsonb_build_object(
      'action', 'update', 'meta', jsonb_build_object('stage_id', v_stage.id, 'name', v_stage.name, 'group', v_stage.group_label))::text, true);
    update public.project_item_stage_list
    set name = v_name, position = v_position, group_label = v_label, group_position = v_group_position
    where id = v_stage.id;
  end if;
  return v_changed;
end;
$$;

create or replace function public.project_stage_update(stage_id uuid, changes jsonb)
returns text[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller public.members;
  v_stage public.project_stages;
  v_project public.projects;
  v_key text;
  v_name text;
  v_position text;
  v_label text;
  v_group_position text;
  v_last text;
  v_changed text[] := '{}';
begin
  v_caller := app.client_work_caller('projects.manage', 'You cannot edit projects.');
  select s.* into v_stage from public.project_stages s
  where s.id = project_stage_update.stage_id and s.org_id = v_caller.org_id;
  if v_stage.id is null then
    perform app.fail('NOT_FOUND', 'This stage is gone.');
  end if;
  v_project := app.project_lock(v_stage.project_id);
  perform app.project_check_writable(v_project);
  select s.* into v_stage from public.project_stages s where s.id = v_stage.id for update;
  if v_stage.archived_at is not null then
    perform app.fail('INVALID_STATE', 'This stage was removed.');
  end if;
  if changes is null or jsonb_typeof(changes) <> 'object' then
    perform app.fail('VALIDATION', 'Nothing to change.');
  end if;
  for v_key in select jsonb_object_keys(changes) loop
    if v_key not in ('name', 'position', 'group_label') then
      perform app.fail('VALIDATION', format('"%s" is not a stage detail that can change.', v_key));
    end if;
  end loop;
  v_name := case when changes ? 'name'
    then app.client_work_text(changes ->> 'name', 120, 'Give the stage a name of up to 120 characters.')
    else v_stage.name end;
  v_label := v_stage.group_label;
  v_group_position := v_stage.group_position;
  if changes ? 'group_label' then
    v_label := app.stage_group_label(changes ->> 'group_label');
    if v_label is not null then
      v_label := app.project_stage_group_find(v_project.id, v_label);
      if v_label is null then
        perform app.fail('VALIDATION', format('There is no group called %s: add it first.', changes ->> 'group_label'));
      end if;
      select s.group_position into v_group_position from public.project_stages s
      where s.project_id = v_project.id and s.archived_at is null and s.group_label = v_label limit 1;
    else
      v_group_position := null;
    end if;
  end if;
  if changes ? 'position' then
    v_position := app.client_work_position(changes ->> 'position');
  elsif v_label is distinct from v_stage.group_label then
    select max(s.position collate "C") into v_last from public.project_stages s
    where s.project_id = v_project.id and s.group_label is not distinct from v_label;
    v_position := app.client_work_next_position(v_last);
  else
    v_position := v_stage.position;
  end if;
  if v_name is distinct from v_stage.name or v_label is distinct from v_stage.group_label then
    perform app.project_stage_name_free(v_project.id, v_name, v_stage.id, v_label);
  end if;
  if v_name is distinct from v_stage.name then v_changed := array_append(v_changed, 'name'); end if;
  if v_position is distinct from v_stage.position then v_changed := array_append(v_changed, 'position'); end if;
  if v_label is distinct from v_stage.group_label then v_changed := array_append(v_changed, 'group_label'); end if;
  if cardinality(v_changed) > 0 then
    -- The entry names the stage (the project is the audited entity).
    perform set_config('app.audit_override', jsonb_build_object(
      'action', 'update', 'meta', jsonb_build_object('stage_id', v_stage.id, 'name', v_stage.name, 'group', v_stage.group_label))::text, true);
    update public.project_stages
    set name = v_name, position = v_position, group_label = v_label, group_position = v_group_position
    where id = v_stage.id;
  end if;
  return v_changed;
end;
$$;

create or replace function public.project_stage_archive(stage_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller public.members;
  v_stage public.project_stages;
  v_project public.projects;
begin
  v_caller := app.client_work_caller('projects.manage', 'You cannot edit projects.');
  select s.* into v_stage from public.project_stages s
  where s.id = project_stage_archive.stage_id and s.org_id = v_caller.org_id;
  if v_stage.id is null then
    perform app.fail('NOT_FOUND', 'This stage is gone.');
  end if;
  v_project := app.project_lock(v_stage.project_id);
  perform app.project_check_writable(v_project);
  select s.* into v_stage from public.project_stages s where s.id = v_stage.id for update;
  if v_stage.archived_at is not null then
    perform app.fail('INVALID_STATE', 'This stage was already removed.');
  end if;
  -- Decision 8: archived, never deleted: hidden from every item, its ticks kept in the history.
  perform set_config('app.audit_override', jsonb_build_object(
    'action', 'archived', 'meta', jsonb_build_object('stage_id', v_stage.id, 'name', v_stage.name, 'group', v_stage.group_label))::text, true);
  update public.project_stages set archived_at = now() where id = v_stage.id;
end;
$$;
