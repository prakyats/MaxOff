-- B7 (UX review 2026-10-21, v1.8 unit V0; owner decision 2026-10-21, option (a)): "+ Another revision
-- round" puts the new stage where a revision belongs, never at the end after "Posted":
--   * right after the deliverable's last revision stage (a stage with "revision" in its name, the last
--     one as the list shows it), in that stage's group;
--   * with no revision stage, right after its "Edit" stage (the name "Edit", ignoring case and spaces;
--     the last one as the list shows it when there are several), in that stage's group;
--   * with neither, UNCHANGED from v1.7.1 (after the last stage, in its group): the owner has not
--     decided that case yet (PROGRESS, V0), so nothing new is guessed here.
-- The name is chosen as before ("Revision 2" -> "Revision 3"; "Revision" -> "Revision 2"; none:
-- "Revision round 1"). EXPAND-ONLY: one new helper and `create or replace` of item_add_revision_round
-- (same signature, grants and permission: projects.manage on the caller's clients). No row is
-- rewritten, except, only when two neighbouring keys leave no room between them, the positions (never
-- the names, groups or ticks) of that one group's stages. Append-only: never edit once applied.

-- A fractional key strictly between two keys (null = open end), the TS mirror is client-work's
-- positionBetween; null when there is no room (equal keys, or keys that are not fractional keys).
create function app.position_between(p_before text, p_after text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  digits constant text := '0123456789abcdefghijklmnopqrstuvwxyz';
  v_low text;
  v_high text;
  v_key text := '';
  v_low_digit integer;
  v_high_digit integer;
begin
  if (p_before is not null and p_before !~ '^[0-9a-z]{1,64}$')
     or (p_after is not null and p_after !~ '^[0-9a-z]{1,64}$')
     or (p_before is not null and p_after is not null and p_before collate "C" >= p_after collate "C") then
    return null;
  end if;
  v_low := coalesce(p_before, '');
  v_high := p_after;
  for i in 1..64 loop
    v_low_digit := case when i <= length(v_low) then strpos(digits, substr(v_low, i, 1)) - 1 else 0 end;
    v_high_digit := case when v_high is not null and i <= length(v_high)
                         then strpos(digits, substr(v_high, i, 1)) - 1 else 36 end;
    if v_high_digit - v_low_digit > 1 then
      v_key := v_key || substr(digits, (v_low_digit + v_high_digit) / 2 + 1, 1);
      exit;
    end if;
    v_key := v_key || substr(digits, v_low_digit + 1, 1);
    if v_high_digit - v_low_digit = 1 then
      v_high := null;
    end if;
  end loop;
  if length(v_key) > 64
     or (p_before is not null and v_key collate "C" <= p_before collate "C")
     or (p_after is not null and v_key collate "C" >= p_after collate "C") then
    return null;
  end if;
  return v_key;
end;
$$;

revoke all on function app.position_between(text, text) from public, authenticated;
grant execute on function app.position_between(text, text) to service_role;

comment on function app.position_between(text, text) is
  'Internal (B7): a fractional position key strictly between two keys (null = open end), null when '
  'there is no room. The same algorithm as task_stage_move and client-work''s positionBetween().';

create or replace function public.item_add_revision_round(item_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller public.members;
  v_item public.project_items;
  v_project public.projects;
  v_base text;
  v_number integer;
  v_label text;
  v_group_position text;
  v_found boolean;
  v_name text;
  v_guard integer := 0;
  v_anchor public.project_item_stage_list;
  v_after text;
  v_key text;
  v_position text;
  v_row record;
begin
  v_caller := app.client_work_caller('projects.manage', 'You cannot edit deliverables.');
  v_item := app.item_lock(item_add_revision_round.item_id);
  select p.* into v_project from public.projects p where p.id = v_item.project_id;
  perform app.project_check_writable(v_project);
  if v_item.state <> 'open' then
    perform app.fail('INVALID_STATE', format('%s is %s: reopen it to add another revision round.', v_item.title,
      case v_item.state when 'cancelled' then 'closed' when 'carried' then 'carried forward' else 'done' end));
  end if;
  if (select count(*) from public.project_item_stage_list s
      where s.item_id = v_item.id and s.archived_at is null) >= 100 then
    perform app.fail('VALIDATION', 'A deliverable has at most 100 stages.');
  end if;

  -- The name, as in v1.7.1: after its highest numbered revision stage the next number; after an
  -- unnumbered one ("Revision") the second round; with none "Revision round 1".
  select btrim(regexp_replace(s.name, '\s*[0-9]{1,6}\s*$', '')), substring(s.name from '([0-9]{1,6})\s*$')::integer,
         true
    into v_base, v_number, v_found
  from public.project_item_stage_list s
  where s.item_id = v_item.id and s.archived_at is null
    and s.name ~ '[0-9]{1,6}\s*$'
    and btrim(regexp_replace(s.name, '\s*[0-9]{1,6}\s*$', '')) ~* '\mrevision'
  order by substring(s.name from '([0-9]{1,6})\s*$')::integer desc,
           s.group_position collate "C" desc nulls last, s.position collate "C" desc
  limit 1;
  if v_found then
    v_number := v_number + 1;
  else
    select s.name, true into v_base, v_found
    from public.project_item_stage_list s
    where s.item_id = v_item.id and s.archived_at is null and s.name ~* '\mrevision'
    order by s.group_position collate "C" desc nulls last, s.position collate "C" desc
    limit 1;
    if v_found then
      v_number := 2;
    else
      v_base := 'Revision round';
      v_number := 1;
    end if;
  end if;

  -- B7: where it goes. The last revision stage as the list shows it (the untitled group first, then
  -- the groups, each by position); else the last "Edit" stage; else the last stage (v1.7.1).
  select s.* into v_anchor
  from public.project_item_stage_list s
  where s.item_id = v_item.id and s.archived_at is null and s.name ~* '\mrevision'
  order by s.group_position collate "C" desc nulls last, s.position collate "C" desc
  limit 1;
  if v_anchor.id is null then
    select s.* into v_anchor
    from public.project_item_stage_list s
    where s.item_id = v_item.id and s.archived_at is null and lower(btrim(s.name)) = 'edit'
    order by s.group_position collate "C" desc nulls last, s.position collate "C" desc
    limit 1;
  end if;
  if v_anchor.id is null then
    select s.* into v_anchor
    from public.project_item_stage_list s
    where s.item_id = v_item.id and s.archived_at is null
    order by s.group_position collate "C" desc nulls last, s.position collate "C" desc
    limit 1;
  end if;
  v_label := v_anchor.group_label;
  v_group_position := v_anchor.group_position;

  loop
    v_name := v_base || ' ' || v_number;
    exit when not exists (select 1 from public.project_item_stage_list s
                          where s.item_id = v_item.id and s.archived_at is null
                            and s.group_label is not distinct from v_label and lower(s.name) = lower(v_name));
    v_number := v_number + 1;
    v_guard := v_guard + 1;
    if v_guard > 100 then
      perform app.fail('CONFLICT', 'Name the next revision stage yourself in Edit stages.');
    end if;
  end loop;
  if length(v_name) > 120 then
    perform app.fail('VALIDATION', 'Name the next revision stage yourself in Edit stages.');
  end if;
  perform app.item_stage_name_free(v_item.id, v_name, null, v_label);

  if v_anchor.id is null then
    -- No stage at all: the first one in the untitled group (as item_stage_add would).
    select max(s.position collate "C") into v_after
    from public.project_item_stage_list s
    where s.item_id = v_item.id and s.group_label is null;
    v_key := app.client_work_next_position(v_after);
  else
    -- Right after the anchor: a key between it and the next stage of its group (archived rows
    -- included, so no two keys are equal).
    select min(s.position collate "C") into v_after
    from public.project_item_stage_list s
    where s.item_id = v_item.id and s.group_label is not distinct from v_label
      and s.position collate "C" > v_anchor.position collate "C";
    v_key := app.position_between(v_anchor.position, v_after);
    if v_key is null then
      -- Keys with no room between them (old data): the group's stages take fresh keys in their
      -- order, positions only (names, groups and ticks untouched), leaving a gap after the anchor.
      v_position := null;
      for v_row in
        select s.id from public.project_item_stage_list s
        where s.item_id = v_item.id and s.group_label is not distinct from v_label
        order by s.position collate "C", s.created_at, s.id
      loop
        v_position := app.client_work_next_position(v_position);
        update public.project_item_stage_list s set position = v_position
        where s.id = v_row.id and s.position is distinct from v_position;
        if v_row.id = v_anchor.id then
          v_key := v_position;
          v_position := app.client_work_next_position(v_position);
          v_key := app.position_between(v_key, v_position);
        end if;
      end loop;
    end if;
  end if;

  perform set_config('app.audit_override', jsonb_build_object(
    'action', 'insert', 'meta', jsonb_build_object('group', v_label, 'revision_round', true))::text, true);
  insert into public.project_item_stage_list (org_id, project_id, item_id, name, position, group_label, group_position)
  values (v_item.org_id, v_item.project_id, v_item.id, v_name, v_key, v_label, v_group_position);
  return v_name;
end;
$$;

comment on function public.item_add_revision_round(uuid) is
  '6b Release 2 (ROADMAP 6b.16 (c)) and B7 (owner 2026-10-21, option a): projects.manage on the caller''s '
  'clients, the project open or in progress, the deliverable open (INVALID_STATE otherwise). Adds one '
  'stage named after the deliverable''s highest numbered revision stage ("Revision 2" -> "Revision 3"), '
  'after an unnumbered one "Revision 2", with none "Revision round 1"; a taken name moves to the next '
  'number. It goes right after the last revision stage, else right after the last "Edit" stage, else '
  '(not yet decided by the owner) after the last stage, in that stage''s group. Ticks kept. Audited '
  '(insert, meta {group, revision_round: true}). Returns the new stage''s name.';
