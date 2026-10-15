-- Phase 6b, Release 1 (v1.7.0; owner 2026-10-12/13, pre-authorised; ROADMAP 6b.12 (3), 6b.13, 6b.16,
-- 6b.18; DATA-MODEL §5b, the contract). EXPAND-ONLY, ON THE TEAM'S EXISTING DATA: nullable columns
-- added, CHECK limits loosened (12 -> 100 stages), functions added or re-created; no row is rewritten,
-- moved or re-created, nothing dropped or renamed (a loosened CHECK is re-created under its own
-- name), the old columns (`project_item_blueprints.stages`, `project_templates.stages` / `items`) keep
-- being written and read. NOTHING IS PRE-DEFINED: no preset, group, deliverable or template is
-- seeded and nothing below depends on a name. Append-only: never edit once applied.
--
-- 1. Stage groups: a stage of a project's defaults (`project_stages`) and of a deliverable
--    (`project_item_stage_list`) carries a nullable `group_label` and `group_position`. Rows from
--    before have both null: the ONE untitled group (no heading) until someone adds or names a
--    group. Order: group_position nulls first, then position. A stage name is unique per group,
--    ignoring case (the same name in two groups is fine: "Group · Stage").
-- 2. An item-list line (`project_item_blueprints`) and a project template keep their stages in
--    groups too (`stage_groups` jsonb, null = the old `stages` as one untitled group; `stages`
--    stays the flattened copy). A template also holds `deliverables` jsonb (title + groups each;
--    null = the old `items`, each with the template's stages).
-- 3. Functions: project_create_grouped; project_stage_add / item_stage_add with a group;
--    project_stage_update / item_stage_update move a stage between groups; the *_stage_group_add /
--    _update / _archive pairs; project_blueprint_update's `stage_groups`; cycle_create,
--    cycle_copy_item_list and a carry copy groups along; the template guard keeps the old columns
--    in step with the new ones.
-- 4. The limit: 100 stages per list (presets, templates, defaults, lines, deliverables).

-- 1. Columns and limits ------------------------------------------------------------------------------------
alter table public.project_stages
  add column group_label text null,
  add column group_position text null,
  add constraint project_stages_group_label_check
    check (group_label is null or length(btrim(group_label)) between 1 and 120),
  add constraint project_stages_group_position_check
    check (group_position is null or group_position ~ '^[0-9a-z]{1,64}$'),
  add constraint project_stages_group_pair check ((group_label is null) = (group_position is null));
comment on column public.project_stages.group_label is
  '6b Release 1: the stage''s group (null: the one untitled group, shown without a heading, first). '
  'A name is unique per group ignoring case. Rows from before groups have null.';
comment on column public.project_stages.group_position is
  '6b Release 1: the group''s order key (the same alphabet as position; null with a null label).';

alter table public.project_item_stage_list
  add column group_label text null,
  add column group_position text null,
  add constraint project_item_stage_list_group_label_check
    check (group_label is null or length(btrim(group_label)) between 1 and 120),
  add constraint project_item_stage_list_group_position_check
    check (group_position is null or group_position ~ '^[0-9a-z]{1,64}$'),
  add constraint project_item_stage_list_group_pair check ((group_label is null) = (group_position is null));
comment on column public.project_item_stage_list.group_label is
  '6b Release 1: the stage''s group on this deliverable (null: the untitled group, first). Ticks, '
  'dates and notes are untouched by any group change.';
comment on column public.project_item_stage_list.group_position is
  '6b Release 1: the group''s order key (null with a null label).';

alter table public.project_item_blueprints
  add column stage_groups jsonb null
    check (stage_groups is null or jsonb_typeof(stage_groups) = 'array');
alter table public.project_item_blueprints drop constraint project_item_blueprints_stages_max;
alter table public.project_item_blueprints add constraint project_item_blueprints_stages_max
  check (cardinality(stages) <= 100);
comment on column public.project_item_blueprints.stage_groups is
  '6b Release 1: the line''s stages in groups ([{label, stages}], label null = the untitled group). '
  'Null on a line from before groups: `stages` is then one untitled group. When set, `stages` is '
  'its flattened copy (project_blueprint_update keeps them in step).';

alter table public.project_templates
  add column stage_groups jsonb null
    check (stage_groups is null or jsonb_typeof(stage_groups) = 'array'),
  add column deliverables jsonb null
    check (deliverables is null or jsonb_typeof(deliverables) = 'array');
alter table public.project_templates drop constraint project_templates_stages_check;
alter table public.project_templates add constraint project_templates_stages_check
  check (cardinality(stages) <= 100);
comment on column public.project_templates.stage_groups is
  '6b Release 1: the template''s default stage groups (what a deliverable added later starts with). '
  'Null on a template from before: `stages` as one untitled group. When set, the guard writes '
  '`stages` as its flattened copy.';
comment on column public.project_templates.deliverables is
  '6b Release 1: the template''s deliverables ([{title, stage_groups}], stage_groups null = the '
  'template''s default groups). Null on a template from before: `items`, each with the template''s '
  'stages. When set, the guard writes `items` as the titles.';

alter table public.stage_presets drop constraint stage_presets_stages_check;
alter table public.stage_presets add constraint stage_presets_stages_check
  check (cardinality(stages) between 1 and 100);

-- 2. Helpers -------------------------------------------------------------------------------------------------
-- A group label as stored: trimmed, 1..120 characters; null stays null (the untitled group).
create function app.stage_group_label(p_label text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_label text := btrim(p_label);
begin
  if p_label is null then
    return null;
  end if;
  if v_label = '' or length(v_label) > 120 then
    perform app.fail('VALIDATION', 'Give the group a name of up to 120 characters.');
  end if;
  return v_label;
end;
$$;

-- A list of stage names, checked: at most 100, each 1..120 characters trimmed, no name twice
-- ignoring case (one list = one group).
create or replace function app.client_work_stage_names(p_names text[])
returns text[]
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_name text;
  v_out text[] := '{}';
begin
  if cardinality(coalesce(p_names, '{}')) > 100 then
    perform app.fail('VALIDATION', 'A deliverable has at most 100 stages.');
  end if;
  foreach v_name in array coalesce(p_names, '{}') loop
    v_name := app.client_work_text(v_name, 120, 'Each stage needs a name of up to 120 characters.');
    if exists (select 1 from unnest(v_out) as o(name) where lower(o.name) = lower(v_name)) then
      perform app.fail('VALIDATION', format('The stage %s is listed twice: each stage needs its own name.', v_name));
    end if;
    v_out := v_out || v_name;
  end loop;
  return v_out;
end;
$$;

comment on function app.client_work_stage_names(text[]) is
  'Internal (amendment D2; 6b Release 1): stage names checked (at most 100, each 1..120 characters '
  'trimmed, no name twice ignoring case), VALIDATION otherwise.';

-- Stage groups as stored and taken: [{"label": text | null, "stages": [text, ...]}, ...]. Returns the
-- list normalized (labels and names trimmed, the untitled group first), VALIDATION otherwise: at
-- most one untitled group; labels each once ignoring case; every group at least one stage; names
-- 1..120, each once in its group ignoring case; at most 100 stages in all.
create function app.stage_groups_check(p_groups jsonb)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_group jsonb;
  v_label text;
  v_names text[];
  v_name text;
  v_seen text[] := '{}';
  v_untitled jsonb := null;
  v_named jsonb := '[]'::jsonb;
  v_total integer := 0;
begin
  if p_groups is null or jsonb_typeof(p_groups) = 'null' then
    return '[]'::jsonb;
  end if;
  if jsonb_typeof(p_groups) <> 'array' then
    perform app.fail('VALIDATION', 'Stage groups are a list.');
  end if;
  for v_group in select e from jsonb_array_elements(p_groups) e loop
    if jsonb_typeof(v_group) <> 'object' or jsonb_typeof(v_group -> 'stages') <> 'array'
       or exists (select 1 from jsonb_array_elements(v_group -> 'stages') s where jsonb_typeof(s) <> 'string') then
      perform app.fail('VALIDATION', 'Each stage group needs a label and a list of stage names.');
    end if;
    if v_group -> 'label' is null or jsonb_typeof(v_group -> 'label') = 'null' then
      v_label := null;
    elsif jsonb_typeof(v_group -> 'label') <> 'string' then
      perform app.fail('VALIDATION', 'Give the group a name of up to 120 characters.');
    else
      v_label := app.stage_group_label(v_group ->> 'label');
    end if;
    if v_label is null then
      if v_untitled is not null then
        perform app.fail('VALIDATION', 'Only one group can be without a name.');
      end if;
    elsif lower(v_label) = any (v_seen) then
      perform app.fail('VALIDATION', format('The group %s is listed twice: each group needs its own name.', v_label));
    else
      v_seen := v_seen || lower(v_label);
    end if;
    v_names := '{}';
    for v_name in select s from jsonb_array_elements_text(v_group -> 'stages') s loop
      v_name := app.client_work_text(v_name, 120, 'Each stage needs a name of up to 120 characters.');
      if exists (select 1 from unnest(v_names) as o(name) where lower(o.name) = lower(v_name)) then
        perform app.fail('VALIDATION',
          format('The stage %s is listed twice in its group: each stage needs its own name.', v_name));
      end if;
      v_names := v_names || v_name;
    end loop;
    if cardinality(v_names) = 0 then
      perform app.fail('VALIDATION', 'A group needs at least one stage.');
    end if;
    v_total := v_total + cardinality(v_names);
    if v_total > 100 then
      perform app.fail('VALIDATION', 'A deliverable has at most 100 stages.');
    end if;
    if v_label is null then
      v_untitled := jsonb_build_object('label', null, 'stages', to_jsonb(v_names));
    else
      v_named := v_named || jsonb_build_array(jsonb_build_object('label', v_label, 'stages', to_jsonb(v_names)));
    end if;
  end loop;
  return case when v_untitled is null then v_named else jsonb_build_array(v_untitled) || v_named end;
end;
$$;

-- Every stage of every group, in order (what the old text[] columns keep holding).
create function app.stage_groups_flat(p_groups jsonb)
returns text[]
language sql
immutable
set search_path = ''
as $$
  select coalesce(array_agg(s.name order by g.ordinality, s.ordinality), '{}')
  from jsonb_array_elements(coalesce(p_groups, '[]'::jsonb)) with ordinality as g(e, ordinality)
  cross join jsonb_array_elements_text(g.e -> 'stages') with ordinality as s(name, ordinality);
$$;

-- A row's groups: its stage_groups, or (from before groups) its stages as one untitled group.
create function app.stage_groups_of(p_stages text[], p_groups jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select case
    when p_groups is not null and jsonb_typeof(p_groups) = 'array' then p_groups
    when cardinality(coalesce(p_stages, '{}')) = 0 then '[]'::jsonb
    else jsonb_build_array(jsonb_build_object('label', null, 'stages', to_jsonb(p_stages)))
  end;
$$;

-- Deliverables as taken: [{"title": text, "stage_groups": groups | null}, ...], at most 100, each
-- title 1..200 trimmed, each group list checked (null = the project's default groups). Normalized.
create function app.deliverables_check(p_deliverables jsonb)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_entry jsonb;
  v_title text;
  v_groups jsonb;
  v_out jsonb := '[]'::jsonb;
begin
  if p_deliverables is null or jsonb_typeof(p_deliverables) = 'null' then
    return '[]'::jsonb;
  end if;
  if jsonb_typeof(p_deliverables) <> 'array' then
    perform app.fail('VALIDATION', 'Deliverables are a list.');
  end if;
  if jsonb_array_length(p_deliverables) > 100 then
    perform app.fail('VALIDATION', 'A cycle holds at most 100 deliverables.');
  end if;
  for v_entry in select e from jsonb_array_elements(p_deliverables) e loop
    if jsonb_typeof(v_entry) <> 'object' or jsonb_typeof(v_entry -> 'title') <> 'string' then
      perform app.fail('VALIDATION', 'Give each deliverable a title of up to 200 characters.');
    end if;
    v_title := app.client_work_text(v_entry ->> 'title', 200, 'Give each deliverable a title of up to 200 characters.');
    if v_entry -> 'stage_groups' is null or jsonb_typeof(v_entry -> 'stage_groups') = 'null' then
      v_groups := null;
    else
      v_groups := app.stage_groups_check(v_entry -> 'stage_groups');
    end if;
    v_out := v_out || jsonb_build_array(jsonb_build_object('title', v_title, 'stage_groups', v_groups));
  end loop;
  return v_out;
end;
$$;

-- A group key that sorts before p_min (the untitled group named: it stays first). Null p_min (no
-- named group yet) gives the first key.
create function app.stage_group_key_before(p_min text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  digits constant text := '0123456789abcdefghijklmnopqrstuvwxyz';
  v_i integer;
  v_index integer;
begin
  if p_min is null then
    return app.next_position(null);
  end if;
  for v_i in 1..length(p_min) loop
    v_index := position(substr(p_min, v_i, 1) in digits) - 1;
    if v_index > 0 then
      -- One digit down at this place, dropping the rest: shorter and smaller.
      return left(p_min, v_i - 1) || substr(digits, v_index, 1);
    end if;
  end loop;
  -- Only zeros: nothing sorts before it.
  perform app.fail('VALIDATION', 'Move another group first: there is no place before this one.');
  return null;
end;
$$;

revoke all on function app.stage_group_label(text), app.stage_groups_check(jsonb), app.stage_groups_flat(jsonb),
  app.stage_groups_of(text[], jsonb), app.deliverables_check(jsonb), app.stage_group_key_before(text)
  from public, anon;
-- The template guard (security invoker, run by the caller's own role) reads the check helpers.
grant execute on function app.stage_group_label(text), app.stage_groups_check(jsonb), app.stage_groups_flat(jsonb),
  app.stage_groups_of(text[], jsonb), app.deliverables_check(jsonb) to authenticated, service_role;
grant execute on function app.stage_group_key_before(text) to service_role;

comment on function app.stage_group_label(text) is
  'Internal (6b Release 1): a group label trimmed, 1..120 characters (VALIDATION); null stays null (the untitled group).';
comment on function app.stage_groups_check(jsonb) is
  'Internal (6b Release 1): stage groups [{label, stages}] checked and normalized (the untitled group first; '
  'labels once ignoring case; every group at least one stage; names once per group ignoring case; at most 100 '
  'stages in all), VALIDATION otherwise. The same words as stageGroupsIssue in core/lib/stage-groups.ts.';
comment on function app.stage_groups_flat(jsonb) is
  'Internal (6b Release 1): every stage of every group in order, the old text[] shape.';
comment on function app.stage_groups_of(text[], jsonb) is
  'Internal (6b Release 1): a row''s groups: stage_groups when set, else its stages as one untitled group.';
comment on function app.deliverables_check(jsonb) is
  'Internal (6b Release 1): deliverables [{title, stage_groups}] checked and normalized (at most 100; titles '
  '1..200; groups checked; null groups = the project''s defaults), VALIDATION otherwise.';
comment on function app.stage_group_key_before(text) is
  'Internal (6b Release 1): a group order key before the given one (the first key when null).';

-- The project's default stages, flat, in group order (what the old-shape callers still read).
create or replace function app.project_default_stages(p_project_id uuid)
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(s.name order by s.group_position collate "C" nulls first, s.position collate "C"), '{}')
  from public.project_stages s
  where s.project_id = p_project_id and s.archived_at is null;
$$;

-- The project's default stages as groups (what a new deliverable or item-list line starts with).
create function app.project_default_stage_groups(p_project_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('label', g.group_label, 'stages', g.stages)
                            order by g.group_position collate "C" nulls first), '[]'::jsonb)
  from (
    select s.group_label, s.group_position,
           to_jsonb(array_agg(s.name order by s.position collate "C")) as stages
    from public.project_stages s
    where s.project_id = p_project_id and s.archived_at is null
    group by s.group_label, s.group_position
  ) g;
$$;

-- A new item's stages from groups: the untitled group first (no key), then each named group with
-- its own key, the stage keys restarting in every group. Each row is audited 'initial'.
create function app.item_stage_list_init_groups(p_item_id uuid, p_groups jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item public.project_items;
  v_group jsonb;
  v_label text;
  v_group_position text := null;
  v_name text;
  v_position text;
begin
  select i.* into v_item from public.project_items i where i.id = p_item_id;
  for v_group in select e from jsonb_array_elements(app.stage_groups_check(p_groups)) e loop
    v_label := v_group ->> 'label';
    if v_label is not null then
      v_group_position := app.client_work_next_position(v_group_position);
    end if;
    v_position := null;
    for v_name in select s from jsonb_array_elements_text(v_group -> 'stages') s loop
      v_position := app.client_work_next_position(v_position);
      perform set_config('app.audit_override', jsonb_build_object('action', 'initial')::text, true);
      insert into public.project_item_stage_list (org_id, project_id, item_id, name, position, group_label, group_position)
      values (v_item.org_id, v_item.project_id, v_item.id, v_name, v_position,
              v_label, case when v_label is null then null else v_group_position end);
    end loop;
  end loop;
end;
$$;

-- The old entry point stays: a flat list is one untitled group.
create or replace function app.item_stage_list_init(p_item_id uuid, p_names text[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.item_stage_list_init_groups(p_item_id, app.stage_groups_of(app.client_work_stage_names(p_names), null));
end;
$$;

-- A carried item's stages: the original's active ones with their groups and ticks.
create or replace function app.item_stage_list_copy(p_from_item_id uuid, p_to_item_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_to public.project_items;
  v_stage public.project_item_stage_list;
begin
  select i.* into v_to from public.project_items i where i.id = p_to_item_id;
  for v_stage in
    select s.* from public.project_item_stage_list s
    where s.item_id = p_from_item_id and s.archived_at is null
    order by s.group_position collate "C" nulls first, s.position collate "C"
  loop
    perform set_config('app.audit_override', jsonb_build_object(
      'action', 'initial', 'meta', jsonb_build_object('carried_from_item_id', p_from_item_id))::text, true);
    insert into public.project_item_stage_list (org_id, project_id, item_id, name, position, group_label, group_position,
                                                done_at, done_by)
    values (v_to.org_id, v_to.project_id, v_to.id, v_stage.name, v_stage.position, v_stage.group_label,
            v_stage.group_position, v_stage.done_at, v_stage.done_by);
  end loop;
end;
$$;

-- No two active stages of one group share a name (case-insensitive). The 3-argument forms from
-- before stay (unused now: they checked the whole list).
create function app.project_stage_name_free(p_project_id uuid, p_name text, p_except uuid, p_group text)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.project_stages s
             where s.project_id = p_project_id and s.archived_at is null and s.id is distinct from p_except
               and s.group_label is not distinct from p_group and lower(s.name) = lower(p_name)) then
    perform app.fail('CONFLICT', format('This group already has a stage called %s.', p_name));
  end if;
end;
$$;

create function app.item_stage_name_free(p_item_id uuid, p_name text, p_except uuid, p_group text)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.project_item_stage_list s
             where s.item_id = p_item_id and s.archived_at is null and s.id is distinct from p_except
               and s.group_label is not distinct from p_group and lower(s.name) = lower(p_name)) then
    perform app.fail('CONFLICT', format('This group already has a stage called %s.', p_name));
  end if;
end;
$$;

-- The stored spelling of an active group of a project's defaults (null when there is none; the
-- untitled group is always "found" as null).
create function app.project_stage_group_find(p_project_id uuid, p_label text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select s.group_label from public.project_stages s
  where s.project_id = p_project_id and s.archived_at is null and s.group_label is not null
    and lower(s.group_label) = lower(p_label)
  limit 1;
$$;

create function app.item_stage_group_find(p_item_id uuid, p_label text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select s.group_label from public.project_item_stage_list s
  where s.item_id = p_item_id and s.archived_at is null and s.group_label is not null
    and lower(s.group_label) = lower(p_label)
  limit 1;
$$;

revoke all on function app.project_default_stage_groups(uuid), app.item_stage_list_init_groups(uuid, jsonb),
  app.project_stage_name_free(uuid, text, uuid, text), app.item_stage_name_free(uuid, text, uuid, text),
  app.project_stage_group_find(uuid, text), app.item_stage_group_find(uuid, text) from public, anon, authenticated;
grant execute on function app.project_default_stage_groups(uuid), app.item_stage_list_init_groups(uuid, jsonb),
  app.project_stage_name_free(uuid, text, uuid, text), app.item_stage_name_free(uuid, text, uuid, text),
  app.project_stage_group_find(uuid, text), app.item_stage_group_find(uuid, text) to service_role;

comment on function app.project_default_stage_groups(uuid) is
  'Internal (6b Release 1): the project''s active default stages as groups, in order.';
comment on function app.item_stage_list_init_groups(uuid, jsonb) is
  'Internal (6b Release 1): a new item''s own stages from groups (the untitled first, then each named group with '
  'its key), each row audited ''initial''.';
comment on function app.project_stage_name_free(uuid, text, uuid, text) is
  'Internal (6b Release 1): CONFLICT when another active default stage of the same group has the name, ignoring case.';
comment on function app.item_stage_name_free(uuid, text, uuid, text) is
  'Internal (6b Release 1): CONFLICT when another active stage of the item in the same group has the name, ignoring case.';
comment on function app.project_stage_group_find(uuid, text) is
  'Internal (6b Release 1): the stored label of the project''s active default-stage group named so (ignoring case), else null.';
comment on function app.item_stage_group_find(uuid, text) is
  'Internal (6b Release 1): the stored label of the item''s active stage group named so (ignoring case), else null.';

-- 3. New cycles and lines copy groups along -----------------------------------------------------------------
create or replace function app.cycle_create(p_project public.projects, p_start date, p_generated_by text, p_actor uuid,
                                            p_copy_list boolean)
returns public.project_cycles
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cycle public.project_cycles;
  v_earlier uuid;
  v_line public.project_item_blueprints;
  v_item_id uuid;
begin
  perform set_config('app.audit_override', jsonb_build_object(
    'action', 'generated', 'meta', jsonb_build_object('generated_by', p_generated_by, 'item_list', p_copy_list))::text, true);
  insert into public.project_cycles (org_id, project_id, period_start, period_end, label, generated_by, created_by,
                                     item_list_copied)
  values (
    p_project.org_id, p_project.id, p_start,
    case when p_start is null then null else app.period_end(p_project.recurrence, p_start) end,
    case when p_start is null then null else app.cycle_label(p_project.recurrence, p_start) end,
    p_generated_by, p_actor, coalesce(p_copy_list, true))
  returning * into v_cycle;

  if coalesce(p_copy_list, true) then
    -- Amendment D2, 6b Release 1: each line's own stages, in their groups, go with its item.
    for v_line in
      select b.* from public.project_item_blueprints b
      where b.project_id = p_project.id and b.archived_at is null
      order by b.position collate "C"
    loop
      insert into public.project_items (org_id, project_id, cycle_id, title, position, origin_cycle_id, created_by)
      values (p_project.org_id, p_project.id, v_cycle.id, v_line.title, v_line.position, v_cycle.id, p_actor)
      returning id into v_item_id;
      perform app.item_stage_list_init_groups(v_item_id, app.stage_groups_of(v_line.stages, v_line.stage_groups));
    end loop;
  end if;

  if p_start is not null then
    for v_earlier in
      select c.id from public.project_cycles c
      where c.project_id = p_project.id and c.period_start < p_start and c.state = 'open'
    loop
      perform app.cycle_refresh(v_earlier);
    end loop;
  end if;
  return v_cycle;
end;
$$;

create or replace function app.cycle_copy_item_list(p_project public.projects, p_cycle_id uuid, p_actor uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_line public.project_item_blueprints;
  v_last text;
  v_room integer := 100 - app.cycle_live_items(p_cycle_id);
  v_count integer := 0;
  v_item_id uuid;
begin
  select max(i.position collate "C") into v_last from public.project_items i where i.cycle_id = p_cycle_id;
  for v_line in
    select b.* from public.project_item_blueprints b
    where b.project_id = p_project.id and b.archived_at is null
    order by b.position collate "C"
  loop
    exit when v_count >= v_room;
    v_last := app.client_work_next_position(v_last);
    insert into public.project_items (org_id, project_id, cycle_id, title, position, origin_cycle_id, created_by)
    values (p_project.org_id, p_project.id, p_cycle_id, v_line.title, v_last, p_cycle_id, p_actor)
    returning id into v_item_id;
    perform app.item_stage_list_init_groups(v_item_id, app.stage_groups_of(v_line.stages, v_line.stage_groups));
    v_count := v_count + 1;
  end loop;
  perform set_config('app.audit_override', jsonb_build_object(
    'action', 'item_list_added', 'meta', jsonb_build_object('items', v_count))::text, true);
  update public.project_cycles set item_list_copied = true where id = p_cycle_id;
  perform app.cycle_refresh(p_cycle_id);
  return v_count;
end;
$$;

-- 4. project_create (the old shape, the limit raised) and project_create_grouped -----------------------------
create or replace function public.project_create(
  client_id uuid,
  name text,
  recurrence public.recurrence,
  description text default null,
  delivery_date date default null,
  stages text[] default '{}',
  items text[] default '{}',
  template_id uuid default null,
  custom_fields jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Since 6b Release 1 the one path: a flat stage list is one untitled group, items are
  -- deliverables with the project's defaults.
  return public.project_create_grouped(
    project_create.client_id, project_create.name, project_create.recurrence, project_create.description,
    project_create.delivery_date,
    app.stage_groups_of(app.client_work_stage_names(coalesce(project_create.stages, '{}')), null),
    (select coalesce(jsonb_agg(jsonb_build_object('title', t, 'stage_groups', null)), '[]'::jsonb)
     from unnest(coalesce(project_create.items, '{}')) t),
    project_create.template_id, project_create.custom_fields);
end;
$$;

create function public.project_create_grouped(
  client_id uuid,
  name text,
  recurrence public.recurrence,
  description text default null,
  delivery_date date default null,
  stage_groups jsonb default '[]'::jsonb,
  deliverables jsonb default '[]'::jsonb,
  template_id uuid default null,
  custom_fields jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller public.members;
  v_client public.clients;
  v_name text;
  v_description text;
  v_project public.projects;
  v_cycle public.project_cycles;
  v_groups jsonb;
  v_deliverables jsonb;
  v_group jsonb;
  v_entry jsonb;
  v_text text;
  v_label text;
  v_group_position text;
  v_position text;
  v_item_id uuid;
begin
  v_caller := app.client_work_caller('projects.manage', 'You cannot create projects.');
  select c.* into v_client from public.clients c
  where c.id = project_create_grouped.client_id and c.org_id = v_caller.org_id
  for share;
  if v_client.id is null or not app.client_visible(v_client.id) then
    perform app.fail('NOT_FOUND', 'This client is not one of yours.');
  end if;
  -- Decision 1: a Draft, Active or Paused client; an Inactive one takes no new projects (§4).
  if v_client.state = 'inactive' then
    perform app.fail('INVALID_STATE', format('%s is closed, so it takes no new projects.', v_client.name));
  end if;
  if project_create_grouped.recurrence is null then
    perform app.fail('VALIDATION', 'Choose how often this project repeats.');
  end if;
  v_name := app.client_work_text(project_create_grouped.name, 120, 'Give the project a name of up to 120 characters.');
  v_description := app.client_work_text(project_create_grouped.description, 5000, 'Keep the description under 5000 characters.', false);
  -- Amendment A: a one-time project needs its delivery date; a weekly or monthly one has none.
  if project_create_grouped.recurrence = 'one_time' and project_create_grouped.delivery_date is null then
    perform app.fail('VALIDATION', 'A one-time project needs a delivery date.');
  end if;
  if project_create_grouped.recurrence <> 'one_time' and project_create_grouped.delivery_date is not null then
    perform app.fail('VALIDATION', 'A weekly or monthly project has no delivery date.');
  end if;
  v_groups := app.stage_groups_check(project_create_grouped.stage_groups);
  v_deliverables := app.deliverables_check(project_create_grouped.deliverables);
  if project_create_grouped.template_id is not null and not exists (
    select 1 from public.project_templates t
    where t.id = project_create_grouped.template_id and t.org_id = v_caller.org_id and t.archived_at is null
  ) then
    perform app.fail('VALIDATION', 'Choose a template from the list.');
  end if;

  begin
    insert into public.projects (
      org_id, client_id, name, description, recurrence, delivery_date, template_id, custom_fields, created_by)
    values (
      v_caller.org_id, v_client.id, v_name, v_description, project_create_grouped.recurrence,
      project_create_grouped.delivery_date, project_create_grouped.template_id,
      coalesce(project_create_grouped.custom_fields, '{}'::jsonb), v_caller.id)
    returning * into v_project;
  exception when unique_violation then
    perform app.fail('CONFLICT', format('%s already has an open project called %s.', v_client.name, v_name));
  end;

  -- The default stages, in their groups (the untitled group first, without a key).
  v_group_position := null;
  for v_group in select e from jsonb_array_elements(v_groups) e loop
    v_label := v_group ->> 'label';
    if v_label is not null then
      v_group_position := app.client_work_next_position(v_group_position);
    end if;
    v_position := null;
    for v_text in select s from jsonb_array_elements_text(v_group -> 'stages') s loop
      v_position := app.client_work_next_position(v_position);
      insert into public.project_stages (org_id, project_id, name, position, group_label, group_position)
      values (v_caller.org_id, v_project.id, v_text, v_position,
              v_label, case when v_label is null then null else v_group_position end);
    end loop;
  end loop;

  v_position := null;
  if v_project.recurrence = 'one_time' then
    -- A one-time project's single cycle, whatever the client's state (decision 1); its deliverables
    -- go straight into it, each with its own groups or the defaults.
    v_cycle := app.cycle_create(v_project, null, 'create', v_caller.id);
    for v_entry in select e from jsonb_array_elements(v_deliverables) e loop
      v_position := app.client_work_next_position(v_position);
      insert into public.project_items (org_id, project_id, cycle_id, title, position, origin_cycle_id, created_by)
      values (v_caller.org_id, v_project.id, v_cycle.id, v_entry ->> 'title', v_position, v_cycle.id, v_caller.id)
      returning id into v_item_id;
      -- A JSON null (no groups of its own) means the defaults.
      perform app.item_stage_list_init_groups(v_item_id,
        case when jsonb_typeof(v_entry -> 'stage_groups') = 'array' then v_entry -> 'stage_groups' else v_groups end);
    end loop;
  else
    for v_entry in select e from jsonb_array_elements(v_deliverables) e loop
      v_position := app.client_work_next_position(v_position);
      -- Each line of the item list carries its own groups (the defaults when none were given).
      v_group := case when jsonb_typeof(v_entry -> 'stage_groups') = 'array' then v_entry -> 'stage_groups' else v_groups end;
      insert into public.project_item_blueprints (org_id, project_id, title, position, stages, stage_groups)
      values (v_caller.org_id, v_project.id, v_entry ->> 'title', v_position, app.stage_groups_flat(v_group), v_group);
    end loop;
    -- WORKFLOWS §5.2: the current period's cycle at once, while the client is Active (decision 1);
    -- otherwise from the first night it is (cycle_generate).
    if v_client.state = 'active' then
      perform app.cycle_create(v_project, app.period_start(v_project.recurrence, app.today_ist()), 'create', v_caller.id);
    end if;
  end if;

  -- WORKFLOWS §9 "Project created by an Admin": the Owner (info), never an amount. The Owner's own
  -- project tells nobody (the actor is dropped).
  perform app.notify(array[app.org_owner_id(v_caller.org_id)], 'project_created',
    format('%s added the project %s for %s', v_caller.full_name, v_name, v_client.name),
    'Set the amount and billing category.',
    app.project_link(v_project), 'projects', v_project.id,
    jsonb_build_object('project_id', v_project.id, 'client_id', v_client.id), v_caller.id);
  return v_project.id;
end;
$$;

revoke all on function public.project_create_grouped(uuid, text, public.recurrence, text, date, jsonb, jsonb, uuid, jsonb)
  from public, anon;
grant execute on function public.project_create_grouped(uuid, text, public.recurrence, text, date, jsonb, jsonb, uuid, jsonb)
  to authenticated, service_role;

comment on function public.project_create(uuid, text, public.recurrence, text, date, text[], text[], uuid, jsonb) is
  '7.2 (WORKFLOWS §5.4 items 1-3; 6b Release 1): the old shape, kept: a flat stage list (at most 100) as one '
  'untitled group and item titles as deliverables with the defaults, through project_create_grouped.';
comment on function public.project_create_grouped(uuid, text, public.recurrence, text, date, jsonb, jsonb, uuid, jsonb) is
  '6b Release 1 (DATA-MODEL §5b): projects.manage on the caller''s clients (a Draft, Active or Paused client); '
  'the project with its default stages in groups (stage_groups) and its deliverables (at most 100, each with '
  'its own groups or null = the defaults): a one-time project''s cycle takes them as items, a weekly or '
  'monthly project''s item list takes them as lines (copied into the current cycle at once when the client is '
  'Active). A template is recorded, never linked. Notifies the Owner (project_created). Returns the project id.';

-- 5. A project's default stages: a stage in a group, and the group functions -----------------------------------
create function public.project_stage_add(project_id uuid, name text, group_label text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller public.members;
  v_project public.projects;
  v_label text;
  v_found text;
  v_group_position text;
  v_last text;
  v_name text;
  v_id uuid;
begin
  v_caller := app.client_work_caller('projects.manage', 'You cannot edit projects.');
  v_project := app.project_lock(project_stage_add.project_id);
  perform app.project_check_writable(v_project);
  if (select count(*) from public.project_stages s where s.project_id = v_project.id and s.archived_at is null) >= 100 then
    perform app.fail('VALIDATION', 'A project has at most 100 default stages.');
  end if;
  v_name := app.client_work_text(project_stage_add.name, 120, 'Give the stage a name of up to 120 characters.');
  v_label := app.stage_group_label(project_stage_add.group_label);
  if v_label is not null then
    -- Into the group of that name, else a new group after the last.
    v_found := app.project_stage_group_find(v_project.id, v_label);
    if v_found is not null then
      v_label := v_found;
      select s.group_position into v_group_position from public.project_stages s
      where s.project_id = v_project.id and s.archived_at is null and s.group_label = v_found limit 1;
    else
      select max(s.group_position collate "C") into v_group_position from public.project_stages s
      where s.project_id = v_project.id;
      v_group_position := app.client_work_next_position(v_group_position);
    end if;
  end if;
  perform app.project_stage_name_free(v_project.id, v_name, null, v_label);
  select max(s.position collate "C") into v_last from public.project_stages s
  where s.project_id = v_project.id and s.group_label is not distinct from v_label;
  insert into public.project_stages (org_id, project_id, name, position, group_label, group_position)
  values (v_project.org_id, v_project.id, v_name, app.client_work_next_position(v_last), v_label, v_group_position)
  returning id into v_id;
  return v_id;
end;
$$;

-- The 2-argument form stays: into the untitled group.
create or replace function public.project_stage_add(project_id uuid, name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
begin
  return public.project_stage_add(project_stage_add.project_id, project_stage_add.name, null);
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
      -- Only into a group the project has (a new group comes from project_stage_group_add).
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
    -- Moved to another group with no place given: at its end.
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
    update public.project_stages
    set name = v_name, position = v_position, group_label = v_label, group_position = v_group_position
    where id = v_stage.id;
  end if;
  return v_changed;
end;
$$;

create function public.project_stage_group_add(project_id uuid, label text, stages text[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller public.members;
  v_project public.projects;
  v_label text;
  v_names text[];
  v_name text;
  v_group_position text;
  v_position text := null;
begin
  v_caller := app.client_work_caller('projects.manage', 'You cannot edit projects.');
  v_project := app.project_lock(project_stage_group_add.project_id);
  perform app.project_check_writable(v_project);
  v_label := app.stage_group_label(project_stage_group_add.label);
  if v_label is null then
    perform app.fail('VALIDATION', 'Give the group a name of up to 120 characters.');
  end if;
  if app.project_stage_group_find(v_project.id, v_label) is not null then
    perform app.fail('CONFLICT', format('This project already has a group called %s.', v_label));
  end if;
  v_names := app.client_work_stage_names(project_stage_group_add.stages);
  if cardinality(v_names) = 0 then
    perform app.fail('VALIDATION', 'A group needs at least one stage.');
  end if;
  if (select count(*) from public.project_stages s where s.project_id = v_project.id and s.archived_at is null)
     + cardinality(v_names) > 100 then
    perform app.fail('VALIDATION', 'A project has at most 100 default stages.');
  end if;
  select max(s.group_position collate "C") into v_group_position from public.project_stages s
  where s.project_id = v_project.id;
  v_group_position := app.client_work_next_position(v_group_position);
  foreach v_name in array v_names loop
    v_position := app.client_work_next_position(v_position);
    perform set_config('app.audit_override', jsonb_build_object(
      'action', 'insert', 'meta', jsonb_build_object('group', v_label))::text, true);
    insert into public.project_stages (org_id, project_id, name, position, group_label, group_position)
    values (v_project.org_id, v_project.id, v_name, v_position, v_label, v_group_position);
  end loop;
end;
$$;

create function public.project_stage_group_update(project_id uuid, label text, changes jsonb)
returns text[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller public.members;
  v_project public.projects;
  v_label text;
  v_new_label text;
  v_old_position text;
  v_new_position text;
  v_key text;
  v_row public.project_stages;
  v_changed text[] := '{}';
begin
  v_caller := app.client_work_caller('projects.manage', 'You cannot edit projects.');
  v_project := app.project_lock(project_stage_group_update.project_id);
  perform app.project_check_writable(v_project);
  v_label := app.stage_group_label(project_stage_group_update.label);
  if v_label is not null then
    v_label := app.project_stage_group_find(v_project.id, v_label);
    if v_label is null then
      perform app.fail('NOT_FOUND', format('There is no group called %s.', project_stage_group_update.label));
    end if;
  elsif not exists (select 1 from public.project_stages s
                    where s.project_id = v_project.id and s.archived_at is null and s.group_label is null) then
    perform app.fail('NOT_FOUND', 'This project has no stages outside a group.');
  end if;
  if changes is null or jsonb_typeof(changes) <> 'object' then
    perform app.fail('VALIDATION', 'Nothing to change.');
  end if;
  for v_key in select jsonb_object_keys(changes) loop
    if v_key not in ('label', 'position') then
      perform app.fail('VALIDATION', format('"%s" is not a group detail that can change.', v_key));
    end if;
  end loop;
  select s.group_position into v_old_position from public.project_stages s
  where s.project_id = v_project.id and s.archived_at is null and s.group_label is not distinct from v_label limit 1;
  v_new_label := v_label;
  v_new_position := v_old_position;
  if changes ? 'label' then
    v_new_label := app.stage_group_label(changes ->> 'label');
    if v_new_label is null then
      if v_label is not null and exists (select 1 from public.project_stages s
          where s.project_id = v_project.id and s.archived_at is null and s.group_label is null) then
        perform app.fail('CONFLICT', 'Name the stages outside a group first: only one group can be without a name.');
      end if;
      v_new_position := null;
    else
      if (v_label is null or lower(v_new_label) <> lower(v_label))
         and app.project_stage_group_find(v_project.id, v_new_label) is not null then
        perform app.fail('CONFLICT', format('This project already has a group called %s.', v_new_label));
      end if;
      if v_label is null then
        -- The untitled group named: it keeps its place, before the first named group.
        v_new_position := app.stage_group_key_before((
          select min(s.group_position collate "C") from public.project_stages s
          where s.project_id = v_project.id and s.archived_at is null and s.group_position is not null));
      end if;
    end if;
  end if;
  if changes ? 'position' then
    if v_new_label is null then
      perform app.fail('VALIDATION', 'Name the group before moving it: the stages outside a group stay first.');
    end if;
    v_new_position := app.client_work_position(changes ->> 'position');
    if exists (select 1 from public.project_stages s
               where s.project_id = v_project.id and s.archived_at is null and s.group_position = v_new_position
                 and s.group_label is distinct from v_label) then
      perform app.fail('VALIDATION', 'Another group already has that place.');
    end if;
  end if;
  if v_new_label is distinct from v_label then v_changed := array_append(v_changed, 'label'); end if;
  if v_new_position is distinct from v_old_position then v_changed := array_append(v_changed, 'position'); end if;
  if cardinality(v_changed) = 0 then
    return v_changed;
  end if;
  for v_row in
    select s.* from public.project_stages s
    where s.project_id = v_project.id and s.archived_at is null and s.group_label is not distinct from v_label
    order by s.position collate "C"
  loop
    -- One override per row: the audit trigger consumes it.
    perform set_config('app.audit_override', jsonb_build_object(
      'action', case when 'label' = any (v_changed) then 'group_renamed' else 'group_moved' end,
      'meta', jsonb_build_object('group', v_label, 'to', v_new_label))::text, true);
    update public.project_stages set group_label = v_new_label, group_position = v_new_position where id = v_row.id;
  end loop;
  return v_changed;
end;
$$;

create function public.project_stage_group_archive(project_id uuid, label text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller public.members;
  v_project public.projects;
  v_label text;
  v_row public.project_stages;
  v_count integer := 0;
begin
  v_caller := app.client_work_caller('projects.manage', 'You cannot edit projects.');
  v_project := app.project_lock(project_stage_group_archive.project_id);
  perform app.project_check_writable(v_project);
  v_label := app.stage_group_label(project_stage_group_archive.label);
  if v_label is not null then
    v_label := app.project_stage_group_find(v_project.id, v_label);
    if v_label is null then
      perform app.fail('NOT_FOUND', format('There is no group called %s.', project_stage_group_archive.label));
    end if;
  end if;
  for v_row in
    select s.* from public.project_stages s
    where s.project_id = v_project.id and s.archived_at is null and s.group_label is not distinct from v_label
    order by s.position collate "C"
  loop
    perform set_config('app.audit_override', jsonb_build_object(
      'action', 'archived', 'meta', jsonb_build_object('group', v_label))::text, true);
    update public.project_stages set archived_at = now() where id = v_row.id;
    v_count := v_count + 1;
  end loop;
  if v_count = 0 then
    perform app.fail('NOT_FOUND', 'This project has no stages outside a group.');
  end if;
end;
$$;

revoke all on function public.project_stage_add(uuid, text, text), public.project_stage_group_add(uuid, text, text[]),
  public.project_stage_group_update(uuid, text, jsonb), public.project_stage_group_archive(uuid, text) from public, anon;
grant execute on function public.project_stage_add(uuid, text, text), public.project_stage_group_add(uuid, text, text[]),
  public.project_stage_group_update(uuid, text, jsonb), public.project_stage_group_archive(uuid, text)
  to authenticated, service_role;

comment on function public.project_stage_add(uuid, text, text) is
  '6b Release 1: projects.manage on the caller''s clients, the project open or in progress; a default stage at '
  'the end of the group (null: the untitled group; a label no active group has starts a new group after the '
  'last); at most 100 active; a name the group does not have yet, ignoring case (CONFLICT). Returns its id.';
comment on function public.project_stage_update(uuid, jsonb) is
  '7.2 (decision 8; 6b Release 1): rename, reorder or move a default stage (changes: name, position, '
  'group_label = an existing group or null for the untitled one; without a position the stage goes to the '
  'end of its new group; never to a name the group has, CONFLICT). Returns the changed keys.';
comment on function public.project_stage_group_add(uuid, text, text[]) is
  '6b Release 1: projects.manage; a new named group of default stages after the last ("Fill from a preset" '
  'adds the preset this way): CONFLICT when an active group has the label (ignoring case); at least one '
  'stage, names once in the group; at most 100 active in all. Each stage audited ''insert'' with meta group.';
comment on function public.project_stage_group_update(uuid, text, jsonb) is
  '6b Release 1: projects.manage; rename a group (changes.label; label null names the untitled group, which '
  'then keeps its place before the named ones; a named group made untitled needs no untitled stages left, '
  'CONFLICT) or move a named group (changes.position, a key no other group has). Every stage of the group '
  'is audited ''group_renamed'' / ''group_moved'' with meta group and to. Returns the changed keys.';
comment on function public.project_stage_group_archive(uuid, text) is
  '6b Release 1: projects.manage; every active default stage of the group (null: outside any group) is '
  'archived, audited ''archived'' with meta group. NOT_FOUND when there is no such group.';

-- 6. A deliverable's own stages: a stage in a group, and the group functions ----------------------------------
create function public.item_stage_add(item_id uuid, name text, group_label text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller public.members;
  v_item public.project_items;
  v_label text;
  v_found text;
  v_group_position text;
  v_name text;
  v_last text;
  v_id uuid;
begin
  v_caller := app.client_work_caller('projects.manage', 'You cannot edit deliverables.');
  v_item := app.item_stage_item(item_stage_add.item_id);
  if (select count(*) from public.project_item_stage_list s
      where s.item_id = v_item.id and s.archived_at is null) >= 100 then
    perform app.fail('VALIDATION', 'A deliverable has at most 100 stages.');
  end if;
  v_name := app.client_work_text(item_stage_add.name, 120, 'Give the stage a name of up to 120 characters.');
  v_label := app.stage_group_label(item_stage_add.group_label);
  if v_label is not null then
    v_found := app.item_stage_group_find(v_item.id, v_label);
    if v_found is not null then
      v_label := v_found;
      select s.group_position into v_group_position from public.project_item_stage_list s
      where s.item_id = v_item.id and s.archived_at is null and s.group_label = v_found limit 1;
    else
      select max(s.group_position collate "C") into v_group_position from public.project_item_stage_list s
      where s.item_id = v_item.id;
      v_group_position := app.client_work_next_position(v_group_position);
    end if;
  end if;
  perform app.item_stage_name_free(v_item.id, v_name, null, v_label);
  select max(s.position collate "C") into v_last from public.project_item_stage_list s
  where s.item_id = v_item.id and s.group_label is not distinct from v_label;
  insert into public.project_item_stage_list (org_id, project_id, item_id, name, position, group_label, group_position)
  values (v_item.org_id, v_item.project_id, v_item.id, v_name, app.client_work_next_position(v_last), v_label, v_group_position)
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.item_stage_add(item_id uuid, name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
begin
  return public.item_stage_add(item_stage_add.item_id, item_stage_add.name, null);
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
      'action', 'update', 'meta', jsonb_build_object('stage_id', v_stage.id, 'name', v_stage.name))::text, true);
    update public.project_item_stage_list
    set name = v_name, position = v_position, group_label = v_label, group_position = v_group_position
    where id = v_stage.id;
  end if;
  return v_changed;
end;
$$;

create function public.item_stage_group_add(item_id uuid, label text, stages text[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller public.members;
  v_item public.project_items;
  v_label text;
  v_names text[];
  v_name text;
  v_group_position text;
  v_position text := null;
begin
  v_caller := app.client_work_caller('projects.manage', 'You cannot edit deliverables.');
  v_item := app.item_stage_item(item_stage_group_add.item_id);
  v_label := app.stage_group_label(item_stage_group_add.label);
  if v_label is null then
    perform app.fail('VALIDATION', 'Give the group a name of up to 120 characters.');
  end if;
  if app.item_stage_group_find(v_item.id, v_label) is not null then
    perform app.fail('CONFLICT', format('This deliverable already has a group called %s.', v_label));
  end if;
  v_names := app.client_work_stage_names(item_stage_group_add.stages);
  if cardinality(v_names) = 0 then
    perform app.fail('VALIDATION', 'A group needs at least one stage.');
  end if;
  if (select count(*) from public.project_item_stage_list s where s.item_id = v_item.id and s.archived_at is null)
     + cardinality(v_names) > 100 then
    perform app.fail('VALIDATION', 'A deliverable has at most 100 stages.');
  end if;
  select max(s.group_position collate "C") into v_group_position from public.project_item_stage_list s
  where s.item_id = v_item.id;
  v_group_position := app.client_work_next_position(v_group_position);
  foreach v_name in array v_names loop
    v_position := app.client_work_next_position(v_position);
    perform set_config('app.audit_override', jsonb_build_object(
      'action', 'insert', 'meta', jsonb_build_object('group', v_label))::text, true);
    insert into public.project_item_stage_list (org_id, project_id, item_id, name, position, group_label, group_position)
    values (v_item.org_id, v_item.project_id, v_item.id, v_name, v_position, v_label, v_group_position);
  end loop;
end;
$$;

create function public.item_stage_group_update(item_id uuid, label text, changes jsonb)
returns text[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller public.members;
  v_item public.project_items;
  v_label text;
  v_new_label text;
  v_old_position text;
  v_new_position text;
  v_key text;
  v_row public.project_item_stage_list;
  v_changed text[] := '{}';
begin
  v_caller := app.client_work_caller('projects.manage', 'You cannot edit deliverables.');
  v_item := app.item_stage_item(item_stage_group_update.item_id);
  v_label := app.stage_group_label(item_stage_group_update.label);
  if v_label is not null then
    v_label := app.item_stage_group_find(v_item.id, v_label);
    if v_label is null then
      perform app.fail('NOT_FOUND', format('There is no group called %s.', item_stage_group_update.label));
    end if;
  elsif not exists (select 1 from public.project_item_stage_list s
                    where s.item_id = v_item.id and s.archived_at is null and s.group_label is null) then
    perform app.fail('NOT_FOUND', 'This deliverable has no stages outside a group.');
  end if;
  if changes is null or jsonb_typeof(changes) <> 'object' then
    perform app.fail('VALIDATION', 'Nothing to change.');
  end if;
  for v_key in select jsonb_object_keys(changes) loop
    if v_key not in ('label', 'position') then
      perform app.fail('VALIDATION', format('"%s" is not a group detail that can change.', v_key));
    end if;
  end loop;
  select s.group_position into v_old_position from public.project_item_stage_list s
  where s.item_id = v_item.id and s.archived_at is null and s.group_label is not distinct from v_label limit 1;
  v_new_label := v_label;
  v_new_position := v_old_position;
  if changes ? 'label' then
    v_new_label := app.stage_group_label(changes ->> 'label');
    if v_new_label is null then
      if v_label is not null and exists (select 1 from public.project_item_stage_list s
          where s.item_id = v_item.id and s.archived_at is null and s.group_label is null) then
        perform app.fail('CONFLICT', 'Name the stages outside a group first: only one group can be without a name.');
      end if;
      v_new_position := null;
    else
      if (v_label is null or lower(v_new_label) <> lower(v_label))
         and app.item_stage_group_find(v_item.id, v_new_label) is not null then
        perform app.fail('CONFLICT', format('This deliverable already has a group called %s.', v_new_label));
      end if;
      if v_label is null then
        v_new_position := app.stage_group_key_before((
          select min(s.group_position collate "C") from public.project_item_stage_list s
          where s.item_id = v_item.id and s.archived_at is null and s.group_position is not null));
      end if;
    end if;
  end if;
  if changes ? 'position' then
    if v_new_label is null then
      perform app.fail('VALIDATION', 'Name the group before moving it: the stages outside a group stay first.');
    end if;
    v_new_position := app.client_work_position(changes ->> 'position');
    if exists (select 1 from public.project_item_stage_list s
               where s.item_id = v_item.id and s.archived_at is null and s.group_position = v_new_position
                 and s.group_label is distinct from v_label) then
      perform app.fail('VALIDATION', 'Another group already has that place.');
    end if;
  end if;
  if v_new_label is distinct from v_label then v_changed := array_append(v_changed, 'label'); end if;
  if v_new_position is distinct from v_old_position then v_changed := array_append(v_changed, 'position'); end if;
  if cardinality(v_changed) = 0 then
    return v_changed;
  end if;
  for v_row in
    select s.* from public.project_item_stage_list s
    where s.item_id = v_item.id and s.archived_at is null and s.group_label is not distinct from v_label
    order by s.position collate "C"
  loop
    perform set_config('app.audit_override', jsonb_build_object(
      'action', case when 'label' = any (v_changed) then 'group_renamed' else 'group_moved' end,
      'meta', jsonb_build_object('group', v_label, 'to', v_new_label, 'stage_id', v_row.id, 'name', v_row.name))::text, true);
    update public.project_item_stage_list set group_label = v_new_label, group_position = v_new_position
    where id = v_row.id;
  end loop;
  return v_changed;
end;
$$;

create function public.item_stage_group_archive(item_id uuid, label text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller public.members;
  v_item public.project_items;
  v_label text;
  v_row public.project_item_stage_list;
  v_count integer := 0;
begin
  v_caller := app.client_work_caller('projects.manage', 'You cannot edit deliverables.');
  v_item := app.item_stage_item(item_stage_group_archive.item_id);
  v_label := app.stage_group_label(item_stage_group_archive.label);
  if v_label is not null then
    v_label := app.item_stage_group_find(v_item.id, v_label);
    if v_label is null then
      perform app.fail('NOT_FOUND', format('There is no group called %s.', item_stage_group_archive.label));
    end if;
  end if;
  for v_row in
    select s.* from public.project_item_stage_list s
    where s.item_id = v_item.id and s.archived_at is null and s.group_label is not distinct from v_label
    order by s.position collate "C"
  loop
    -- Archived, never deleted: each stage leaves the deliverable, its tick kept on the row.
    perform set_config('app.audit_override', jsonb_build_object(
      'action', 'archived', 'meta', jsonb_build_object('group', v_label, 'stage_id', v_row.id, 'name', v_row.name))::text, true);
    update public.project_item_stage_list set archived_at = now() where id = v_row.id;
    v_count := v_count + 1;
  end loop;
  if v_count = 0 then
    perform app.fail('NOT_FOUND', 'This deliverable has no stages outside a group.');
  end if;
end;
$$;

revoke all on function public.item_stage_add(uuid, text, text), public.item_stage_group_add(uuid, text, text[]),
  public.item_stage_group_update(uuid, text, jsonb), public.item_stage_group_archive(uuid, text) from public, anon;
grant execute on function public.item_stage_add(uuid, text, text), public.item_stage_group_add(uuid, text, text[]),
  public.item_stage_group_update(uuid, text, jsonb), public.item_stage_group_archive(uuid, text)
  to authenticated, service_role;

comment on function public.item_stage_add(uuid, text, text) is
  '6b Release 1: projects.manage on the caller''s clients, the project open or in progress, the deliverable '
  'open; a stage at the end of the group (null: the untitled group; a label no active group has starts a new '
  'group after the last); at most 100 active; a name the group does not have yet, ignoring case (CONFLICT). '
  'Returns its id.';
comment on function public.item_stage_update(uuid, jsonb) is
  'Amendment D2; 6b Release 1: projects.manage; rename, reorder or move one of an open deliverable''s stages '
  '(changes: name, position, group_label = an existing group or null; without a position the stage goes to the '
  'end of its new group). The tick stays. Returns the changed keys.';
comment on function public.item_stage_group_add(uuid, text, text[]) is
  '6b Release 1: projects.manage; a new named group of stages after the deliverable''s last ("Fill from a '
  'preset" adds the preset this way): CONFLICT when an active group has the label; at least one stage; at '
  'most 100 active in all. Each stage audited ''insert'' with meta group.';
comment on function public.item_stage_group_update(uuid, text, jsonb) is
  '6b Release 1: projects.manage; rename a group of an open deliverable''s stages (changes.label; label null '
  'names the untitled group, which keeps its place before the named ones) or move a named group '
  '(changes.position). Ticks untouched; each stage audited ''group_renamed'' / ''group_moved''. Returns the '
  'changed keys.';
comment on function public.item_stage_group_archive(uuid, text) is
  '6b Release 1: projects.manage; every active stage of the group (null: outside any group) is archived, its '
  'tick kept, audited ''archived'' with meta group. NOT_FOUND when there is no such group.';

-- 7. The item list: lines carry their groups -------------------------------------------------------------------
create or replace function public.project_blueprint_add(project_id uuid, title text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller public.members;
  v_project public.projects;
  v_last text;
  v_groups jsonb;
  v_id uuid;
begin
  v_caller := app.client_work_caller('projects.manage', 'You cannot edit projects.');
  v_project := app.project_lock(project_blueprint_add.project_id);
  perform app.project_check_writable(v_project);
  if v_project.recurrence = 'one_time' then
    perform app.fail('VALIDATION', 'A one-time project has no item list: add the deliverable to its cycle.');
  end if;
  if (select count(*) from public.project_item_blueprints b
      where b.project_id = v_project.id and b.archived_at is null) >= 100 then
    perform app.fail('VALIDATION', 'The item list holds at most 100 deliverables.');
  end if;
  select max(b.position collate "C") into v_last from public.project_item_blueprints b where b.project_id = v_project.id;
  -- 6b Release 1: the line starts with the project's default stages, in their groups.
  v_groups := app.project_default_stage_groups(v_project.id);
  insert into public.project_item_blueprints (org_id, project_id, title, position, stages, stage_groups)
  values (v_project.org_id, v_project.id,
          app.client_work_text(project_blueprint_add.title, 200, 'Give the deliverable a title of up to 200 characters.'),
          app.client_work_next_position(v_last), app.stage_groups_flat(v_groups), v_groups)
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.project_blueprint_update(blueprint_id uuid, changes jsonb)
returns text[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller public.members;
  v_row public.project_item_blueprints;
  v_project public.projects;
  v_key text;
  v_title text;
  v_position text;
  v_stages text[];
  v_groups jsonb;
  v_changed text[] := '{}';
begin
  v_caller := app.client_work_caller('projects.manage', 'You cannot edit projects.');
  select b.* into v_row from public.project_item_blueprints b
  where b.id = project_blueprint_update.blueprint_id and b.org_id = v_caller.org_id;
  if v_row.id is null then
    perform app.fail('NOT_FOUND', 'This deliverable is gone from the list.');
  end if;
  v_project := app.project_lock(v_row.project_id);
  perform app.project_check_writable(v_project);
  select b.* into v_row from public.project_item_blueprints b where b.id = v_row.id for update;
  if v_row.archived_at is not null then
    perform app.fail('INVALID_STATE', 'This deliverable was removed from the list.');
  end if;
  if changes is null or jsonb_typeof(changes) <> 'object' then
    perform app.fail('VALIDATION', 'Nothing to change.');
  end if;
  for v_key in select jsonb_object_keys(changes) loop
    if v_key not in ('title', 'position', 'stages', 'stage_groups') then
      perform app.fail('VALIDATION', format('"%s" is not a list detail that can change.', v_key));
    end if;
  end loop;
  v_title := case when changes ? 'title'
    then app.client_work_text(changes ->> 'title', 200, 'Give the deliverable a title of up to 200 characters.')
    else v_row.title end;
  v_position := case when changes ? 'position' then app.client_work_position(changes ->> 'position') else v_row.position end;
  v_stages := v_row.stages;
  v_groups := v_row.stage_groups;
  if changes ? 'stage_groups' then
    -- 6b Release 1: the groups set both columns (stages stays the flattened copy).
    v_groups := app.stage_groups_check(changes -> 'stage_groups');
    v_stages := app.stage_groups_flat(v_groups);
  elsif changes ? 'stages' then
    if jsonb_typeof(changes -> 'stages') <> 'array'
       or exists (select 1 from jsonb_array_elements(changes -> 'stages') e where jsonb_typeof(e) <> 'string') then
      perform app.fail('VALIDATION', 'Stages are a list of names.');
    end if;
    v_stages := app.client_work_stage_names(array(select jsonb_array_elements_text(changes -> 'stages')));
    v_groups := app.stage_groups_of(v_stages, null);
  end if;
  if v_title is distinct from v_row.title then v_changed := array_append(v_changed, 'title'); end if;
  if v_position is distinct from v_row.position then v_changed := array_append(v_changed, 'position'); end if;
  if v_stages is distinct from v_row.stages then v_changed := array_append(v_changed, 'stages'); end if;
  -- The groups count as changed only when the caller sent them (stages always follows them).
  if changes ? 'stage_groups' and v_groups is distinct from v_row.stage_groups then
    v_changed := array_append(v_changed, 'stage_groups');
  end if;
  if cardinality(v_changed) > 0 or v_groups is distinct from v_row.stage_groups then
    update public.project_item_blueprints
    set title = v_title, position = v_position, stages = v_stages, stage_groups = v_groups
    where id = v_row.id;
  end if;
  return v_changed;
end;
$$;

comment on function public.project_blueprint_add(uuid, text) is
  '7.2 (WORKFLOWS §5.4 item 9; amendment D2; 6b Release 1): projects.manage; a recurring project''s item list '
  'gains a line at the end (at most 100 active), carrying the project''s default stages in their groups. Feeds '
  'later cycles only: no existing cycle changes.';
comment on function public.project_blueprint_update(uuid, jsonb) is
  '7.2 (decision 9; amendment D2; 6b Release 1): rename or reorder a line of the item list, or set its stages '
  '(changes: title, position, stage_groups = [{label, stages}] which also writes the flattened stages, or the '
  'old stages = a list of names, one untitled group; at most 100). Later cycles only. Returns the changed keys.';

-- 8. The template guard keeps the old columns in step with the new ---------------------------------------------
create or replace function app.project_templates_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_text text;
  v_old jsonb := case when tg_op = 'UPDATE' then old.field_defaults else '{}'::jsonb end;
  v_key text;
  v_value jsonb;
  v_def public.field_definitions;
begin
  new.name := btrim(new.name);
  new.description := nullif(btrim(coalesce(new.description, '')), '');
  if tg_op = 'UPDATE' then
    if new.created_by is distinct from old.created_by or new.org_id is distinct from old.org_id then
      perform app.fail('FORBIDDEN', 'A template keeps its author.');
    end if;
  elsif not app.in_transition() and new.created_by is distinct from auth.uid() then
    perform app.fail('FORBIDDEN', 'A template is written by the person creating it.');
  end if;
  -- 6b Release 1: the new shape, when given, is checked and the old columns written from it, so
  -- both always say the same thing. A template from before (both null) keeps its old columns.
  if new.stage_groups is not null then
    new.stage_groups := app.stage_groups_check(new.stage_groups);
    new.stages := app.stage_groups_flat(new.stage_groups);
  end if;
  if new.deliverables is not null then
    new.deliverables := app.deliverables_check(new.deliverables);
    new.items := coalesce(array(select e ->> 'title' from jsonb_array_elements(new.deliverables) e), '{}');
  end if;
  new.stages := array(select btrim(s) from unnest(new.stages) s);
  foreach v_text in array new.stages loop
    if v_text is null or length(v_text) not between 1 and 120 then
      perform app.fail('VALIDATION', 'Each stage needs a name of up to 120 characters.');
    end if;
  end loop;
  new.items := array(select btrim(s) from unnest(new.items) s);
  foreach v_text in array new.items loop
    if v_text is null or length(v_text) not between 1 and 200 then
      perform app.fail('VALIDATION', 'Each deliverable needs a title of up to 200 characters.');
    end if;
  end loop;
  -- The field defaults: a project's custom field values, checked as a project's are; keys the
  -- write leaves as they were pass (an archived field keeps its default). A required field may
  -- stay empty (the create dialog asks for it).
  if octet_length(new.field_defaults::text) > 32768 then
    perform app.fail('VALIDATION', 'These field defaults are too long.');
  end if;
  for v_key, v_value in select e.key, e.value from jsonb_each(new.field_defaults) e loop
    continue when v_old -> v_key is not distinct from v_value;
    select d.* into v_def from public.field_definitions d
    where d.entity = 'project' and d.key = v_key and d.archived_at is null and d.org_id = new.org_id
    limit 1;
    if v_def.id is null then
      perform app.fail('VALIDATION', format('There is no field "%s" here.', v_key));
    end if;
    if not app.custom_field_value_ok(v_def.type, v_def.options, v_value) then
      perform app.fail('VALIDATION', format('%s: this is not a valid value.', v_def.label));
    end if;
  end loop;
  return new;
end;
$$;

comment on function app.project_templates_guard() is
  'BEFORE INSERT OR UPDATE on project_templates (kickoff 7 decision 23; 6b Release 1): the author is the '
  'caller and never changes; stage_groups and deliverables, when given, are checked and written into stages '
  '/ items (flattened titles) so the old columns always match; stages 1..120 characters each (at most 100), '
  'items 1..200; field_defaults at most 32 KB, every key the write adds or changes an active project field '
  'holding a value of its type.';

grant insert (name, description, recurrence, stages, items, field_defaults, stage_groups, deliverables)
  on public.project_templates to authenticated;
grant update (name, description, recurrence, stages, items, field_defaults, archived_at, stage_groups, deliverables)
  on public.project_templates to authenticated;

-- 9. The history describes the group changes --------------------------------------------------------------------
create or replace function app.client_work_activity_shown(p_entity text, p_action text, p_diff jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(case p_entity
    when 'projects' then
      p_action in ('insert', 'started', 'completed', 'cancelled', 'reopened')
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
                   'closed', 'carried', 'carried_in', 'left_pending')
      or (p_action = 'update'
          and coalesce(p_diff -> 'new', '{}'::jsonb) ?| array['title', 'notes', 'planned_date', 'custom_fields', 'position'])
    when 'project_item_stages' then
      p_action in ('ticked', 'unticked')
  end, false);
$$;

comment on function app.client_work_activity_shown(text, text, jsonb) is
  'Internal (review fix 2026-10-09; 6b Release 1): whether the project''s history describes an audit entry: '
  'the same list as describeProjectActivity in modules/client-work/domain/activity.ts (group renames and '
  'moves, a stage moved between groups and a line''s stage_groups included). Read by project_activity and '
  'item_last_changes; change both together.';
