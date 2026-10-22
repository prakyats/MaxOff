-- v1.9 W1-db (ROADMAP 6b.4 (3), (4); OPEN 4 answered as recommended): two kinds of Close and
-- "Also add ‹title› to ‹period›?". DATA-MODEL §5b "Close kinds", WORKFLOWS §5.3 "As built (v1.9
-- W1-db)", PERMISSIONS §3. EXPAND-ONLY: one nullable column with two checks every existing row meets
-- (null), two functions re-created with one more optional argument (the old signature dropped first
-- so a call without it resolves to the new one; grants and comments re-made exactly as before), two
-- new functions. No row is rewritten. No money anywhere: the kind is a word about a close.

-- 1. The column ---------------------------------------------------------------------------------------------
alter table public.project_items
  add column close_kind text null,
  add constraint project_items_close_kind_values
    check (close_kind is null or close_kind in ('not_needed', 'not_delivered')),
  add constraint project_items_close_kind_cancelled
    check (close_kind is null or state = 'cancelled');

comment on column public.project_items.close_kind is
  'v1.9 W1-db (6b.4 D5): why a closed deliverable was closed: not_needed ("Not needed this month/week", the '
  'scope changed) or not_delivered ("Not delivered", we missed it). Only on a cancelled item; null = a close '
  'before W1, a project_cancel or a close without a kind. Written by item_cancel, cycle_carry_decide (close) '
  'and item_set_close_kind only. Not money.';

-- Only the functions write it (the API role has no UPDATE on project_items; this keeps it so).
create trigger protect_close_kind before update on public.project_items
  for each row execute function app.protect_columns('close_kind');

-- 2. item_cancel takes the kind ------------------------------------------------------------------------------
drop function public.item_cancel(uuid, text);

create function public.item_cancel(item_id uuid, reason text, close_kind text default null)
returns public.item_state
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller public.members;
  v_item public.project_items;
  v_project public.projects;
  v_client public.clients;
  v_reason text;
  v_kind_words text;
begin
  v_caller := app.client_work_caller('projects.manage', 'You cannot cancel items.');
  v_item := app.item_lock(item_cancel.item_id);
  select p.* into v_project from public.projects p where p.id = v_item.project_id;
  perform app.project_check_writable(v_project);
  if v_item.state not in ('open', 'done') then
    perform app.fail('INVALID_STATE', format('This item is %s, so it cannot be cancelled.', v_item.state));
  end if;
  v_reason := nullif(btrim(coalesce(item_cancel.reason, '')), '');
  if v_reason is null then
    perform app.fail('REASON_REQUIRED', 'Cancelling an item needs a reason.');
  end if;
  if length(v_reason) > 1000 then
    perform app.fail('VALIDATION', 'Keep the reason under 1000 characters.');
  end if;
  if item_cancel.close_kind is not null and item_cancel.close_kind not in ('not_needed', 'not_delivered') then
    perform app.fail('VALIDATION', 'Choose "Not needed" or "Not delivered".');
  end if;
  perform set_config('app.audit_override', jsonb_build_object(
    'action', 'cancelled', 'meta', jsonb_build_object('from_state', v_item.state, 'close_kind', item_cancel.close_kind))::text, true);
  update public.project_items
  set state = 'cancelled', cancelled_reason = v_reason, cancelled_by = v_caller.id, cancelled_at = now(),
      close_kind = item_cancel.close_kind
  where id = v_item.id;
  perform app.cycle_refresh(v_item.cycle_id);

  -- WORKFLOWS §9 "Item cancelled by an Admin": the Owner (info, never email); the Owner's own
  -- cancel tells nobody (the actor is dropped). W1: the body names the kind when there is one.
  v_client := app.project_client(v_project);
  v_kind_words := case item_cancel.close_kind
    when 'not_delivered' then 'Not delivered. '
    when 'not_needed' then case v_project.recurrence
      when 'monthly' then 'Not needed this month. '
      when 'weekly' then 'Not needed this week. '
      else 'Not needed. ' end
    else '' end;
  perform app.notify(array[app.org_owner_id(v_project.org_id)], 'item_cancelled',
    format('%s cancelled %s', v_caller.full_name, v_item.title),
    format('%s · %s. %sReason: %s', v_project.name, v_client.name, v_kind_words, v_reason),
    app.project_link(v_project), 'project_items', v_item.id,
    jsonb_build_object('project_id', v_project.id, 'item_id', v_item.id), v_caller.id);
  return 'cancelled';
end;
$$;

revoke all on function public.item_cancel(uuid, text, text) from public, anon;
grant execute on function public.item_cancel(uuid, text, text) to authenticated, service_role;

comment on function public.item_cancel(uuid, text, text) is
  '7.2 (WORKFLOWS §5.3): projects.manage on the caller''s clients (the Owner, the client''s Admin); '
  'open or done -> cancelled with a reason (REASON_REQUIRED). Audited ''cancelled''. An Admin''s '
  'cancel tells the Owner (item_cancelled, info). v1.9 W1-db: close_kind (optional: not_needed | '
  'not_delivered, VALIDATION otherwise) is stored on the item, in the audit meta and in the notice body.';

-- 3. cycle_carry_decide's close takes the kind ----------------------------------------------------------------
-- The latest definition (migration client_work_item_stages, amendment D2) with the kind added.
drop function public.cycle_carry_decide(uuid[], public.carry_decision, text);

create function public.cycle_carry_decide(item_ids uuid[], decision public.carry_decision, reason text default null,
                                          close_kind text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller public.members;
  v_cycle_ids uuid[];
  v_cycle public.project_cycles;
  v_project public.projects;
  v_client public.clients;
  v_today date := app.today_ist();
  v_reason text;
  v_target public.project_cycles;
  v_try public.project_cycles;
  v_target_start date;
  v_id uuid;
  v_item public.project_items;
  v_new uuid;
  v_last text;
  v_results jsonb := '[]'::jsonb;
  v_done integer := 0;
  v_code text;
  v_detail text;
  v_title text;
  v_kind_words text;
begin
  v_caller := app.client_work_caller('cycles.carry_decide', 'You cannot decide unfinished items.');
  if item_ids is null or cardinality(item_ids) = 0 then
    perform app.fail('VALIDATION', 'Choose the items to decide.');
  end if;
  if cardinality(item_ids) > 100 then
    perform app.fail('VALIDATION', 'A cycle holds at most 100 items.');
  end if;
  if cycle_carry_decide.decision is null then
    perform app.fail('VALIDATION', 'Choose carry forward, close or leave pending.');
  end if;
  -- W1: the kind goes with a close only.
  if cycle_carry_decide.close_kind is not null then
    if cycle_carry_decide.decision <> 'close' then
      perform app.fail('VALIDATION', 'Only a close says why: Not needed or Not delivered.');
    end if;
    if cycle_carry_decide.close_kind not in ('not_needed', 'not_delivered') then
      perform app.fail('VALIDATION', 'Choose "Not needed" or "Not delivered".');
    end if;
  end if;
  -- Decision 16: carry forward and leave pending in bulk per cycle; close one item at a time with a
  -- reason.
  if cycle_carry_decide.decision = 'close' then
    if cardinality(item_ids) <> 1 then
      perform app.fail('VALIDATION', 'Close one item at a time, with a reason.');
    end if;
    v_reason := nullif(btrim(coalesce(cycle_carry_decide.reason, '')), '');
    if v_reason is null then
      perform app.fail('REASON_REQUIRED', 'Closing an item needs a reason.');
    end if;
    if length(v_reason) > 1000 then
      perform app.fail('VALIDATION', 'Keep the reason under 1000 characters.');
    end if;
  end if;

  -- Only the items the caller may see decide the cycle (7A review L4): another Admin's id is
  -- NOT_FOUND on its own line below, never a reason to refuse the batch.
  select array_agg(distinct i.cycle_id) into v_cycle_ids from public.project_items i
  where i.id = any (item_ids) and i.org_id = v_caller.org_id and app.project_visible(i.project_id);
  if v_cycle_ids is null then
    perform app.fail('NOT_FOUND', 'These items are not yours.');
  end if;
  if cardinality(v_cycle_ids) > 1 then
    perform app.fail('VALIDATION', 'Decide the items of one cycle at a time.');
  end if;
  select c.* into v_cycle from public.project_cycles c where c.id = v_cycle_ids[1];
  v_project := app.project_lock(v_cycle.project_id);
  perform app.project_check_writable(v_project);
  select c.* into v_cycle from public.project_cycles c where c.id = v_cycle.id for update;
  -- Items of an ended period only (a one-time project's cycle has none).
  if v_cycle.period_end is null or v_cycle.period_end >= v_today then
    perform app.fail('INVALID_STATE', 'This cycle''s period has not ended, so its items are not decided yet.');
  end if;
  v_client := app.project_client(v_project);
  if cycle_carry_decide.decision = 'carry_forward' then
    -- Decision 13: refused on an Inactive client (Close or Leave pending only); allowed on Paused.
    if v_client.state = 'inactive' then
      perform app.fail('INVALID_STATE', format('%s is closed: close the items or leave them pending.', v_client.name));
    end if;
    -- The next cycle, or the current period's when the next one has already ended (new items never
    -- go into a past cycle, decision 9). When missing it is made by the first item that carries
    -- (generated_by carry; the nightly job then finds it), never by a batch where none does (L7);
    -- with the item list on an Active client, without it on a Paused one (Q4 (a)).
    v_target_start := greatest(app.period_next(v_project.recurrence, v_cycle.period_start),
                               app.period_start(v_project.recurrence, v_today));
    select c.* into v_target from public.project_cycles c
    where c.project_id = v_project.id and c.period_start = v_target_start;
  end if;

  for v_id in select distinct x.id from unnest(item_ids) as x(id) order by 1 loop
    begin
      select i.* into v_item from public.project_items i
      where i.id = v_id and i.cycle_id = v_cycle.id
      for update;
      if v_item.id is null then
        perform app.fail('NOT_FOUND', 'This item is not in this cycle.');
      end if;
      -- Decision 11: open items only (done items wait for approval in their own cycle).
      if v_item.state <> 'open' then
        perform app.fail('INVALID_STATE', format('This item is %s, not open.', v_item.state));
      end if;
      if cycle_carry_decide.decision = 'carry_forward' then
        -- The target, made here in this item's savepoint when missing: if the item then fails, the
        -- cycle goes with it and v_target stays empty (it is set only once the item has carried).
        v_try := v_target;
        if v_try.id is null then
          -- Q4 (a): on a client that is not Active the new cycle takes only the carried items; the
          -- item list joins it once the client is Active again (cycle_generate).
          v_try := app.cycle_create(v_project, v_target_start, 'carry', v_caller.id, v_client.state = 'active');
        end if;
        if app.cycle_live_items(v_try.id) >= 100 then
          perform app.fail('VALIDATION', format('%s already holds 100 items.', v_try.label));
        end if;
        -- Decision 12: title, notes, custom fields and the stage ticks (their original times and
        -- people) go along; the planned date does not. origin_cycle_id stays the first cycle.
        select max(i.position collate "C") into v_last from public.project_items i where i.cycle_id = v_try.id;
        perform set_config('app.audit_override', jsonb_build_object(
          'action', 'carried_in', 'meta', jsonb_build_object('carried_from_item_id', v_item.id))::text, true);
        insert into public.project_items (
          org_id, project_id, cycle_id, title, position, notes, custom_fields, carried_from_item_id,
          origin_cycle_id, created_by)
        values (
          v_item.org_id, v_item.project_id, v_try.id, v_item.title, app.client_work_next_position(v_last),
          v_item.notes, v_item.custom_fields, v_item.id, v_item.origin_cycle_id, v_caller.id)
        returning id into v_new;
        -- Amendment D2: the item's own stage list goes along, each with its tick (original time and
        -- person); a removed (archived) stage stays with the original.
        perform app.item_stage_list_copy(v_item.id, v_new);
        perform set_config('app.audit_override', jsonb_build_object(
          'action', 'carried', 'meta', jsonb_build_object('carried_to_item_id', v_new, 'to_cycle_id', v_try.id))::text, true);
        update public.project_items
        set state = 'carried', carry_decision = 'carry_forward', carry_decided_by = v_caller.id, carry_decided_at = now()
        where id = v_item.id;
        v_target := v_try;
      elsif cycle_carry_decide.decision = 'close' then
        perform set_config('app.audit_override', jsonb_build_object(
          'action', 'closed', 'meta', jsonb_build_object('close_kind', cycle_carry_decide.close_kind))::text, true);
        update public.project_items
        set state = 'cancelled', cancelled_reason = v_reason, cancelled_by = v_caller.id, cancelled_at = now(),
            carry_decision = 'close', carry_decided_by = v_caller.id, carry_decided_at = now(),
            close_kind = cycle_carry_decide.close_kind
        where id = v_item.id;
      else
        perform set_config('app.audit_override', jsonb_build_object('action', 'left_pending')::text, true);
        update public.project_items
        set carry_decision = 'leave_pending', carry_decided_by = v_caller.id, carry_decided_at = now()
        where id = v_item.id;
      end if;
      v_done := v_done + 1;
      v_results := v_results || case when cycle_carry_decide.decision = 'carry_forward'
        then jsonb_build_object('id', v_id, 'ok', true, 'state', 'carried', 'new_item_id', v_new, 'cycle_id', v_target.id)
        else jsonb_build_object('id', v_id, 'ok', true, 'state',
               case when cycle_carry_decide.decision = 'close' then 'cancelled' else 'open' end) end;
    exception when sqlstate 'P0001' then
      get stacked diagnostics v_code = message_text, v_detail = pg_exception_detail;
      v_results := v_results || jsonb_build_object('id', v_id, 'ok', false, 'code', v_code, 'message', v_detail);
    end;
  end loop;
  perform app.cycle_refresh(v_cycle.id);
  if v_target.id is not null then
    perform app.cycle_refresh(v_target.id);
  end if;

  -- WORKFLOWS §9 "Carry decisions made by the Owner": the client's Admin, one combined row per batch
  -- (info); the Admin's own decisions tell nobody (the actor; amendment C6). W1: a close's body names
  -- the kind when there is one.
  if v_done > 0 then
    v_title := case cycle_carry_decide.decision
      when 'carry_forward' then format('%s carried into %s', case when v_done = 1 then '1 item' else v_done || ' items' end, v_target.label)
      when 'close' then format('1 item closed in %s', v_cycle.label)
      else format('%s left pending in %s', case when v_done = 1 then '1 item' else v_done || ' items' end, v_cycle.label)
    end;
    v_kind_words := case cycle_carry_decide.close_kind
      when 'not_delivered' then 'Not delivered. '
      when 'not_needed' then case v_project.recurrence
        when 'monthly' then 'Not needed this month. '
        when 'weekly' then 'Not needed this week. '
        else 'Not needed. ' end
      else '' end;
    perform app.notify(array[v_client.admin_id], 'carry_decided', v_title,
      case when cycle_carry_decide.decision = 'close'
        then format('%s · %s. %sReason: %s', v_project.name, v_client.name, v_kind_words, v_reason)
        else format('%s · %s.', v_project.name, v_client.name) end,
      app.project_link(v_project), 'projects', v_project.id,
      jsonb_build_object('project_id', v_project.id, 'cycle_id', v_cycle.id, 'decision', cycle_carry_decide.decision),
      v_caller.id);
  end if;
  return v_results;
end;
$$;

revoke all on function public.cycle_carry_decide(uuid[], public.carry_decision, text, text) from public, anon;
grant execute on function public.cycle_carry_decide(uuid[], public.carry_decision, text, text) to authenticated, service_role;

comment on function public.cycle_carry_decide(uuid[], public.carry_decision, text, text) is
  '7.2 (WORKFLOWS §5.3, §5.4 items 11-13, 16; amendment C; Q4 (a); amendment D2): cycles.carry_decide '
  'on the caller''s clients; the open items of ONE recurring cycle whose period has ended; the cycle '
  'is the one of the ids the caller may see (another Admin''s id is NOT_FOUND on its own line). '
  'carry_forward (bulk; refused on an Inactive client): a new item in the next cycle (or the current '
  'period''s when the next has ended), made with generated_by carry by the first id that carries when '
  'missing, with the item list on an Active client and only the carried items on a Paused one, '
  'taking title, notes, custom fields and the item''s own active stages with their ticks, never the '
  'planned date; the original becomes carried. close (one item, REASON_REQUIRED): cancelled. '
  'leave_pending (bulk): stays open, decided again later. Per-id results. Audited (carried_in, '
  'carried, closed, left_pending). The Owner''s decisions tell the client''s Admin, one carry_decided '
  'row per call. v1.9 W1-db: close_kind (optional, with close only: not_needed | not_delivered; '
  'VALIDATION otherwise) is stored on the closed item, in the audit meta and in the notice body.';

-- 4. The Owner sets the kind on an older close (OPEN 4) ---------------------------------------------------------
create function public.item_set_close_kind(item_id uuid, close_kind text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller public.members;
  v_item public.project_items;
  v_project public.projects;
begin
  v_caller := app.client_work_caller('projects.manage', 'You cannot change closed deliverables.');
  if not app.is_owner() then
    perform app.fail('FORBIDDEN', 'Only the Owner sets why a deliverable was closed.');
  end if;
  v_item := app.item_lock(item_set_close_kind.item_id);
  select p.* into v_project from public.projects p where p.id = v_item.project_id;
  perform app.project_check_writable(v_project);
  if v_item.state <> 'cancelled' then
    perform app.fail('INVALID_STATE', format('This deliverable is %s, not closed.', v_item.state));
  end if;
  if item_set_close_kind.close_kind is null
     or item_set_close_kind.close_kind not in ('not_needed', 'not_delivered') then
    perform app.fail('VALIDATION', 'Choose "Not needed" or "Not delivered".');
  end if;
  if v_item.close_kind is not distinct from item_set_close_kind.close_kind then
    return false;
  end if;
  perform set_config('app.audit_override', jsonb_build_object(
    'action', 'close_kind_set', 'meta', jsonb_build_object('from', v_item.close_kind))::text, true);
  update public.project_items set close_kind = item_set_close_kind.close_kind where id = v_item.id;
  return true;
end;
$$;

revoke all on function public.item_set_close_kind(uuid, text) from public, anon;
grant execute on function public.item_set_close_kind(uuid, text) to authenticated, service_role;

comment on function public.item_set_close_kind(uuid, text) is
  'v1.9 W1-db (6b.4 D5, OPEN 4): the Owner only (projects.manage, then app.is_owner(): an Admin is '
  'FORBIDDEN on any client); a cancelled deliverable of a project open or in progress (INVALID_STATE '
  'otherwise; NOT_FOUND outside the organization); close_kind not_needed | not_delivered (VALIDATION, '
  'null refused). Sets or changes the kind; false when it already held it. Audited ''close_kind_set'' '
  '(meta from). No notification.';

-- 5. "Also add ‹title› to ‹period›?": the line and the deliverable in one transaction ---------------------------
create function public.project_blueprint_add_to_cycle(project_id uuid, title text, cycle_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller public.members;
  v_project public.projects;
  v_client public.clients;
  v_cycle public.project_cycles;
  v_today date := app.today_ist();
  v_line public.project_item_blueprints;
  v_line_id uuid;
  v_last text;
  v_item_id uuid;
begin
  v_caller := app.client_work_caller('projects.manage', 'You cannot edit projects.');
  v_project := app.project_lock(project_blueprint_add_to_cycle.project_id);
  perform app.project_check_writable(v_project);
  if v_project.recurrence = 'one_time' then
    perform app.fail('VALIDATION', 'A one-time project has no item list: add the deliverable to its cycle.');
  end if;
  select c.* into v_cycle from public.project_cycles c
  where c.id = project_blueprint_add_to_cycle.cycle_id and c.project_id = v_project.id
  for update;
  if v_cycle.id is null then
    perform app.fail('NOT_FOUND', 'This cycle is not one of this project''s.');
  end if;
  -- The running cycle only (amendment D4's ‹October 2026›): the period holding today IST, its list
  -- already in (else the line joins it with the list), the client not Inactive (as item_add).
  if v_cycle.period_start > v_today or v_cycle.period_end < v_today then
    perform app.fail('INVALID_STATE', format('%s is not the current period: add the line for later cycles only.', v_cycle.label));
  end if;
  if not v_cycle.item_list_copied then
    perform app.fail('INVALID_STATE', format('%s takes the deliverables list later, with this line in it.', v_cycle.label));
  end if;
  v_client := app.project_client(v_project);
  if v_client.state = 'inactive' then
    perform app.fail('INVALID_STATE', format('%s is closed, so it takes no new deliverables.', v_client.name));
  end if;
  if app.cycle_live_items(v_cycle.id) >= 100 then
    perform app.fail('VALIDATION', 'A cycle holds at most 100 deliverables.');
  end if;

  -- The line, exactly as project_blueprint_add (its own checks run again: the list's 100).
  v_line_id := public.project_blueprint_add(v_project.id, project_blueprint_add_to_cycle.title);
  select b.* into v_line from public.project_item_blueprints b where b.id = v_line_id;

  -- The deliverable at the end of the cycle, with the line's stages in their groups (as cycle_create).
  select max(i.position collate "C") into v_last from public.project_items i where i.cycle_id = v_cycle.id;
  insert into public.project_items (org_id, project_id, cycle_id, title, position, origin_cycle_id, created_by)
  values (v_project.org_id, v_project.id, v_cycle.id, v_line.title, app.client_work_next_position(v_last),
          v_cycle.id, v_caller.id)
  returning id into v_item_id;
  perform app.item_stage_list_init_groups(v_item_id, app.stage_groups_of(v_line.stages, v_line.stage_groups));
  perform app.cycle_refresh(v_cycle.id);
  return jsonb_build_object('blueprint_id', v_line_id, 'item_id', v_item_id);
end;
$$;

revoke all on function public.project_blueprint_add_to_cycle(uuid, text, uuid) from public, anon;
grant execute on function public.project_blueprint_add_to_cycle(uuid, text, uuid) to authenticated, service_role;

comment on function public.project_blueprint_add_to_cycle(uuid, text, uuid) is
  'v1.9 W1-db (6b.4 D4, "Also add ‹title› to ‹period›?" answered Add too): projects.manage on the caller''s '
  'clients; ONE transaction: a deliverables-list line (project_blueprint_add: a recurring project open or '
  'in progress, at most 100 lines, the default stages in groups) and an open deliverable at the end of the '
  'running cycle with the line''s stages in their groups. The cycle: this project''s (NOT_FOUND), its period '
  'holding today IST and its list in (INVALID_STATE), the client not Inactive (INVALID_STATE), at most 100 '
  'live (VALIDATION). Returns {blueprint_id, item_id}. Audited by the row triggers; no notification.';

-- 6. The history describes the new action (the same list as describeProjectActivity) ----------------------------
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
      p_action in ('generated', 'insert', 'item_list_added', 'extras_kept', 'extras_not_kept')
    when 'project_items' then
      p_action in ('insert', 'done', 'not_done', 'approved', 'rejected', 'sent_back', 'reopened', 'cancelled',
                   'closed', 'carried', 'carried_in', 'left_pending', 'saved_as_template', 'close_kind_set')
      or (p_action = 'update'
          and coalesce(p_diff -> 'new', '{}'::jsonb) ?| array['title', 'notes', 'planned_date', 'custom_fields', 'position'])
    when 'project_item_stages' then
      p_action in ('ticked', 'unticked')
  end, false);
$$;
comment on function app.client_work_activity_shown(text, text, jsonb) is
  'Internal (review fix 2026-10-09; 6b Release 1; 6b Release 2: + saved_as_template on a project and a '
  'deliverable, + extras_kept / extras_not_kept on a cycle; v1.9 W1-db: + close_kind_set on a deliverable): '
  'whether the project''s history describes an audit entry: the same list as describeProjectActivity in '
  'modules/client-work/domain/activity.ts. Read by project_activity and item_last_changes; change both together.';
