-- v1.8 unit V3 (the long-stage-list fixes, owner 2026-10-17, (D)): "Group stages" on a deliverable
-- whose stages sit in one list without groups. The Admin (or the Owner) chooses where each group
-- starts and names it; nothing is ever grouped automatically, and a deliverable that already has
-- named groups is left as it is (its groups are changed in Edit stages, as before).
-- Expand-only: one new transition function; no table, column or existing function changes.
--
-- public.item_stages_group(item_id, labels, starts): `labels[i]` names the group that begins at the
-- stage `starts[i]`; the first start is the deliverable's first stage, the starts follow the stages'
-- order. Every stage keeps its id, name, order and tick; only its group (label and group key)
-- changes, one audited update per stage (the activity reads "moved the stage … into …").

create function public.item_stages_group(item_id uuid, labels text[], starts uuid[])
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller public.members;
  v_item public.project_items;
  v_count integer;
  v_first uuid;
  v_label text;
  v_clean text[] := '{}';
  v_index integer;
  v_last_position text;
  v_position text;
  v_group_key text;
  v_current text;
  v_row public.project_item_stage_list;
  v_moved integer := 0;
begin
  v_caller := app.client_work_caller('projects.manage', 'You cannot edit deliverables.');
  v_item := app.item_stage_item(item_stages_group.item_id);
  if labels is null or starts is null or cardinality(labels) <> cardinality(starts) then
    perform app.fail('VALIDATION', 'Name each group and choose the stage it starts at.');
  end if;
  if cardinality(labels) < 2 or cardinality(labels) > 20 then
    perform app.fail('VALIDATION', 'Split the stages into 2 to 20 groups.');
  end if;
  select count(*)::integer into v_count from public.project_item_stage_list s
  where s.item_id = v_item.id and s.archived_at is null;
  if v_count < cardinality(labels) then
    perform app.fail('VALIDATION', 'Each group needs at least one stage.');
  end if;
  if exists (select 1 from public.project_item_stage_list s
             where s.item_id = v_item.id and s.archived_at is null and s.group_label is not null) then
    perform app.fail('CONFLICT', 'These stages are already in groups: change them in Edit stages.');
  end if;
  -- The names: each given, at most one of each (ignoring case).
  foreach v_label in array labels loop
    v_label := app.stage_group_label(v_label);
    if v_label is null then
      perform app.fail('VALIDATION', 'Give every group a name.');
    end if;
    if exists (select 1 from unnest(v_clean) c where lower(c) = lower(v_label)) then
      perform app.fail('CONFLICT', format('Two groups are called %s: give each its own name.', v_label));
    end if;
    v_clean := array_append(v_clean, v_label);
  end loop;
  -- The starts: this deliverable's active stages, the first one first, then in the stages' order.
  select s.id into v_first from public.project_item_stage_list s
  where s.item_id = v_item.id and s.archived_at is null order by s.position collate "C" limit 1;
  if starts[1] is distinct from v_first then
    perform app.fail('VALIDATION', 'The first group starts at the first stage.');
  end if;
  v_last_position := null;
  for v_index in 1 .. cardinality(starts) loop
    v_position := null;
    select s.position into v_position from public.project_item_stage_list s
    where s.id = starts[v_index] and s.item_id = v_item.id and s.archived_at is null;
    if v_position is null then
      perform app.fail('VALIDATION', 'A group starts at a stage this deliverable does not have.');
    end if;
    if v_last_position is not null and (v_position collate "C") <= (v_last_position collate "C") then
      perform app.fail('VALIDATION', 'Choose the group starts in the stages'' order, one stage each.');
    end if;
    v_last_position := v_position;
  end loop;

  v_index := 0;
  v_group_key := null;
  for v_row in
    select s.* from public.project_item_stage_list s
    where s.item_id = v_item.id and s.archived_at is null
    order by s.position collate "C"
    for update
  loop
    if v_index < cardinality(starts) and v_row.id = starts[v_index + 1] then
      v_index := v_index + 1;
      v_current := v_clean[v_index];
      v_group_key := app.client_work_next_position(v_group_key);
    end if;
    perform set_config('app.audit_override', jsonb_build_object(
      'action', 'update', 'meta', jsonb_build_object('stage_id', v_row.id, 'name', v_row.name, 'group', null))::text, true);
    update public.project_item_stage_list
    set group_label = v_current, group_position = v_group_key
    where id = v_row.id;
    v_moved := v_moved + 1;
  end loop;
  return v_moved;
end;
$$;

revoke all on function public.item_stages_group(uuid, text[], uuid[]) from public, anon;
grant execute on function public.item_stages_group(uuid, text[], uuid[]) to authenticated, service_role;

comment on function public.item_stages_group(uuid, text[], uuid[]) is
  'V3 (long-stage-list fix D): split a deliverable''s ungrouped stages into named groups at the starts the caller chose (projects.manage, the client in scope, the project writable, the item open or done). Ids, names, order and ticks kept; one audited update per stage. Returns the number of stages placed.';
