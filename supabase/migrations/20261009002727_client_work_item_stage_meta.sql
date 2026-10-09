-- Amendment D2, the history's words (follow-up to client_work_item_stages, before any release): an item
-- stage's entry is audited with entity_id = the item, and a tick, a move or a removal changes no
-- column that names the stage. These three functions now put the stage's id and name in the entry's
-- meta, so the history says which stage ("ticked Shoot on Reel 1"). Same paths, same checks.
-- EXPAND-ONLY: create or replace of three functions. Append-only: never edit once applied.

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
  v_changed text[] := '{}';
begin
  v_caller := app.client_work_caller('projects.manage', 'You cannot edit items.');
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
    if v_key not in ('name', 'position') then
      perform app.fail('VALIDATION', format('"%s" is not a stage detail that can change.', v_key));
    end if;
  end loop;
  v_name := case when changes ? 'name'
    then app.client_work_text(changes ->> 'name', 120, 'Give the stage a name of up to 120 characters.')
    else v_stage.name end;
  v_position := case when changes ? 'position' then app.client_work_position(changes ->> 'position') else v_stage.position end;
  if v_name is distinct from v_stage.name then
    perform app.item_stage_name_free(v_stage.item_id, v_name, v_stage.id);
    v_changed := array_append(v_changed, 'name');
  end if;
  if v_position is distinct from v_stage.position then v_changed := array_append(v_changed, 'position'); end if;
  if cardinality(v_changed) > 0 then
    perform set_config('app.audit_override', jsonb_build_object(
      'action', 'update', 'meta', jsonb_build_object('stage_id', v_stage.id, 'name', v_stage.name))::text, true);
    update public.project_item_stage_list set name = v_name, position = v_position where id = v_stage.id;
  end if;
  return v_changed;
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
    'action', 'archived', 'meta', jsonb_build_object('stage_id', v_stage.id, 'name', v_stage.name))::text, true);
  update public.project_item_stage_list set archived_at = now() where id = v_stage.id;
end;
$$;

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
      'action', 'ticked', 'meta', jsonb_build_object('stage_id', v_stage.id, 'name', v_stage.name))::text, true);
    update public.project_item_stage_list set done_at = now(), done_by = v_caller.id where id = v_stage.id;
    perform app.project_mark_started(v_item.project_id);
  else
    if v_stage.done_at is null then
      return false;
    end if;
    perform set_config('app.audit_override', jsonb_build_object(
      'action', 'unticked', 'meta', jsonb_build_object('stage_id', v_stage.id, 'name', v_stage.name))::text, true);
    update public.project_item_stage_list set done_at = null, done_by = null where id = v_stage.id;
  end if;
  return true;
end;
$$;
