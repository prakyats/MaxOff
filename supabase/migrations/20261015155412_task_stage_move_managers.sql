-- 6b.18 (v1.7.1), owner decision 2026-10-15: reordering a staff task's stages is allowed only to
-- the Owner, to Admins within the task's existing edit scope (app.task_manager: the creator, the
-- approving Admin) and to the task's creator; Crew NEVER (assignee, primary owner or not), and no
-- coordinator path. Replaces 13 Oct's "everyone on the task may reorder" (migration
-- 20261015092234_task_stage_move, applied and therefore untouched). WORKFLOWS §3.1 "Moving a
-- task's stages", PERMISSIONS §3, DATA-MODEL §6 task_stages.
-- EXPAND-ONLY (ARCHITECTURE §18): the function is redefined in place with the same signature (the
-- `on_behalf_of` parameter stays for callers; a non-null value is now refused). No column, grant or
-- policy changes; app.task_stages_guard() and the 30-stage bound stay as they are.

create or replace function public.task_stage_move(
  task_id uuid,
  stage_id uuid,
  after_stage_id uuid default null,
  on_behalf_of uuid default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  digits constant text := '0123456789abcdefghijklmnopqrstuvwxyz';
  v_caller uuid;
  v_org uuid;
  v_task public.tasks;
  v_stage public.task_stages;
  v_ids uuid[];
  v_rest uuid[];
  v_order uuid[];
  v_from integer;
  v_to integer;
  v_before text;
  v_after text;
  v_low text;
  v_high text;
  v_key text;
  v_low_digit integer;
  v_high_digit integer;
  v_position text;
  v_id uuid;
  v_meta jsonb;
begin
  select m.id, m.org_id into v_caller, v_org from app.current_member() m;
  if v_caller is null then
    perform app.fail('UNAUTHENTICATED', 'Your account is not active.');
  end if;
  v_task := app.task_lock(task_stage_move.task_id, v_org);
  -- Scope, then permission: a task the caller cannot see does not exist for them.
  if not app.task_visible(v_task.id) then
    perform app.fail('NOT_FOUND', 'This task does not exist.');
  end if;

  -- Permission (owner 2026-10-15): only whoever may edit the task reorders its stages, as
  -- themselves: the Owner, its creator and its approving Admin (app.task_manager, holding
  -- tasks.create as the stages guard). Crew never, whether an assignee, the primary owner or not;
  -- a coordinator never moves a stage for a freelancer.
  if task_stage_move.on_behalf_of is not null then
    perform app.fail('FORBIDDEN', 'Stages are never moved for someone else.');
  end if;
  if not (app.task_manager(v_task.id) and app.has_permission('tasks.create')) then
    perform app.fail('FORBIDDEN', 'Only the Owner, the task''s creator and its approving Admin reorder its stages.');
  end if;

  -- State: the editors' existing lock (WORKFLOWS §3.1): until the task is completed or cancelled.
  if v_task.state in ('completed', 'cancelled') then
    perform app.fail('INVALID_STATE', 'Reopen the task to change its checklist.');
  end if;

  select s.* into v_stage from public.task_stages s
  where s.id = task_stage_move.stage_id and s.task_id = v_task.id;
  if v_stage.id is null then
    perform app.fail('NOT_FOUND', 'This stage is gone. Refresh the task.');
  end if;
  if task_stage_move.after_stage_id = v_stage.id then
    perform app.fail('VALIDATION', 'A stage cannot move after itself.');
  end if;

  -- The checklist as the task page shows it (tasks data listStages: position, then created_at),
  -- every row locked so two moves never interleave.
  perform 1 from public.task_stages s where s.task_id = v_task.id for update;
  v_ids := array(select s.id from public.task_stages s where s.task_id = v_task.id
                 order by s.position, s.created_at, s.id);
  if task_stage_move.after_stage_id is not null
     and array_position(v_ids, task_stage_move.after_stage_id) is null then
    perform app.fail('NOT_FOUND', 'The list changed. Refresh the task.');
  end if;
  v_from := array_position(v_ids, v_stage.id);
  v_rest := array_remove(v_ids, v_stage.id);
  -- v_to: the stage's place in the new order (1-based).
  v_to := case when task_stage_move.after_stage_id is null then 1
               else array_position(v_rest, task_stage_move.after_stage_id) + 1 end;
  if v_to = v_from then
    return; -- already there: nothing changes, nothing is recorded
  end if;
  v_order := v_rest[1:v_to - 1] || v_stage.id || v_rest[v_to:cardinality(v_rest)];
  v_meta := jsonb_build_object('stage_id', v_stage.id, 'name', v_stage.name,
                               'from', v_from, 'to', v_to, 'of', cardinality(v_ids));

  -- A fractional key strictly between the new neighbours (the TS mirror is client-work's
  -- positionBetween), so no other stage is rewritten.
  if v_to > 1 then
    select s.position into v_before from public.task_stages s where s.id = v_rest[v_to - 1];
  end if;
  if v_to <= cardinality(v_rest) then
    select s.position into v_after from public.task_stages s where s.id = v_rest[v_to];
  end if;
  if (v_before is null or v_before ~ '^[0-9a-z]{1,64}$')
     and (v_after is null or v_after ~ '^[0-9a-z]{1,64}$')
     and (v_before is null or v_after is null or v_before collate "C" < v_after collate "C") then
    v_low := coalesce(v_before, '');
    v_high := v_after;
    v_key := '';
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
    -- Checked, not trusted: a key that is too long or does not sort strictly between them (or is
    -- the stage's own) falls to the renumber below.
    if length(v_key) > 64
       or (v_before is not null and v_key collate "C" <= v_before collate "C")
       or (v_after is not null and v_key collate "C" >= v_after collate "C")
       or v_key = v_stage.position then
      v_key := null;
    end if;
  end if;

  if v_key is null then
    -- Old keys with no room between them (equal, or not fractional keys): the task's stages take
    -- fresh keys in the new order, positions only (ticks untouched).
    v_position := null;
    foreach v_id in array v_order loop
      v_position := app.next_position(v_position);
      if v_id = v_stage.id then
        v_key := v_position;
      else
        update public.task_stages s set position = v_position
        where s.id = v_id and s.position is distinct from v_position;
      end if;
    end loop;
  end if;

  -- The one history entry ("moved the stage “Audio” to position 5 of 6"); ticks never change.
  if v_key is distinct from v_stage.position then
    perform set_config('app.audit_override', jsonb_build_object(
      'action', 'stage_moved', 'on_behalf_of', task_stage_move.on_behalf_of, 'meta', v_meta)::text, true);
    update public.task_stages s set position = v_key where s.id = v_stage.id;
  else
    -- Renumbered onto its own old key: the others moved around it, so the entry is written here.
    insert into public.activity_log (org_id, actor_id, on_behalf_of_id, entity, entity_id, action, meta)
    values (v_org, v_caller, task_stage_move.on_behalf_of, 'task_stages', v_task.id, 'stage_moved', v_meta);
  end if;
  -- WORKFLOWS §9: nobody is notified of a reorder.
end;
$$;

revoke all on function public.task_stage_move(uuid, uuid, uuid, uuid) from public, anon;
grant execute on function public.task_stage_move(uuid, uuid, uuid, uuid) to authenticated, service_role;

comment on function public.task_stage_move(uuid, uuid, uuid, uuid) is
  '6b.18 (owner 2026-10-15; staff tasks only): moves one of a task''s stages to just after '
  'after_stage_id (null: to the top). Allowed only to whoever may edit the task, as themselves '
  '(app.task_manager with tasks.create: the Owner, the creator, the approving Admin) until it is '
  'completed or cancelled; Crew never (an assignee or the primary owner included), and a non-null '
  'on_behalf_of is refused: NOT_FOUND when the caller cannot see the task, FORBIDDEN otherwise. '
  'Only `position` changes: a fractional key between the new neighbours, or fresh keys for the '
  'task''s stages in the new order when old keys leave no room; done_at, done_by and on_behalf_of '
  'never change. Writes one activity_log entry (task_stages, entity_id = the task, stage_moved, '
  'meta {stage_id, name, from, to, of}); no notification. Adding, renaming and removing stay with '
  'app.task_stages_guard().';
