-- Kickoff 7 amendment C answers, Q4-Q7 (owner 2026-10-08, issue #56 and directly; PROGRESS "Kickoff 7
--   decisions", WORKFLOWS §5.3 / §5.4, PERMISSIONS §3, PRODUCT §4.5):
--
-- Q4 (a)  A cycle a carry forward creates (generated_by carry) on a client that is NOT Active takes
--         only the carried items, never the item list (project_cycles.item_list_copied = false). The
--         list joins it when the client is Active again: the nightly cycle_generate copies it into a
--         running cycle that holds none of it yet, once. On an Active client a carry-created cycle
--         copies the list as built.
-- Q5 (b)  An approved, cancelled or carried item: the Owner or the client's Admin may still correct
--         its title and notes (item_update, audited); its state, planned date, stage ticks and every
--         other detail stay locked (INVALID_STATE).
-- Q6 (a)  project_reopen is refused on an Inactive client's project (INVALID_STATE, "Reactivate the
--         client first.").
-- Q7 (a)  At most 12 active stages per project, as built: owner-confirmed (no change here).
--
-- EXPAND-ONLY: one column with a default (true for every existing cycle), create or replace of
-- functions and one new internal function. Append-only: never edit once applied.

-- Q4 (a). Whether a cycle holds its item list ------------------------------------------------------------
alter table public.project_cycles add column item_list_copied boolean not null default true;
comment on column public.project_cycles.item_list_copied is
  'Q4 (a) (owner 2026-10-08): false for a cycle a carry forward made while its client was not Active '
  '(it holds only the carried items); the nightly cycle_generate copies the item list into it once the '
  'client is Active and the period is still running, then sets it true. True for every other cycle.';

-- A new cycle, with or without the item list (the 4-argument form keeps copying it).
create function app.cycle_create(p_project public.projects, p_start date, p_generated_by text, p_actor uuid,
                                 p_copy_list boolean)
returns public.project_cycles
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cycle public.project_cycles;
  v_earlier uuid;
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
    insert into public.project_items (org_id, project_id, cycle_id, title, position, origin_cycle_id, created_by)
    select p_project.org_id, p_project.id, v_cycle.id, b.title, b.position, v_cycle.id, p_actor
    from public.project_item_blueprints b
    where b.project_id = p_project.id and b.archived_at is null
    order by b.position collate "C";
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

create or replace function app.cycle_create(p_project public.projects, p_start date, p_generated_by text, p_actor uuid)
returns public.project_cycles
language sql
security definer
set search_path = ''
as $$
  select app.cycle_create(p_project, p_start, p_generated_by, p_actor, true);
$$;

-- The item list into a cycle that holds none of it yet (the project locked by the caller): after the
-- items already there, in the list's order, up to the cycle's 100 live items.
create function app.cycle_copy_item_list(p_project public.projects, p_cycle_id uuid, p_actor uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_title text;
  v_last text;
  v_room integer := 100 - app.cycle_live_items(p_cycle_id);
  v_count integer := 0;
begin
  select max(i.position collate "C") into v_last from public.project_items i where i.cycle_id = p_cycle_id;
  for v_title in
    select b.title from public.project_item_blueprints b
    where b.project_id = p_project.id and b.archived_at is null
    order by b.position collate "C"
  loop
    exit when v_count >= v_room;
    v_last := app.client_work_next_position(v_last);
    insert into public.project_items (org_id, project_id, cycle_id, title, position, origin_cycle_id, created_by)
    values (p_project.org_id, p_project.id, p_cycle_id, v_title, v_last, p_cycle_id, p_actor);
    v_count := v_count + 1;
  end loop;
  perform set_config('app.audit_override', jsonb_build_object(
    'action', 'item_list_added', 'meta', jsonb_build_object('items', v_count))::text, true);
  update public.project_cycles set item_list_copied = true where id = p_cycle_id;
  perform app.cycle_refresh(p_cycle_id);
  return v_count;
end;
$$;

revoke all on function app.cycle_create(public.projects, date, text, uuid, boolean),
  app.cycle_copy_item_list(public.projects, uuid, uuid) from public, authenticated;
grant execute on function app.cycle_create(public.projects, date, text, uuid, boolean),
  app.cycle_copy_item_list(public.projects, uuid, uuid) to service_role;

comment on function app.cycle_create(public.projects, date, text, uuid, boolean) is
  'Internal (7.2; Q4 (a)): a new cycle for a locked project (p_start null for one-time), its label, '
  'the active item list copied in as open items when p_copy_list (item_list_copied records it), and '
  'the earlier open cycles re-checked. Audited ''generated'' with meta generated_by and item_list.';
comment on function app.cycle_create(public.projects, date, text, uuid) is
  'Internal (7.2): app.cycle_create(..., true): a new cycle with the item list copied in.';
comment on function app.cycle_copy_item_list(public.projects, uuid, uuid) is
  'Internal (Q4 (a)): the active item list into a cycle that holds none of it yet, after its items, '
  'in the list''s order, up to 100 live items; item_list_copied set (audited ''item_list_added''), the '
  'cycle re-checked. Returns the items added.';

-- Q4 (a). cycle_carry_decide ------------------------------------------------------------------------------
create or replace function public.cycle_carry_decide(item_ids uuid[], decision public.carry_decision, reason text default null)
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
        insert into public.project_item_stages (item_id, stage_id, org_id, done_at, done_by)
        select v_new, s.stage_id, s.org_id, s.done_at, s.done_by
        from public.project_item_stages s
        where s.item_id = v_item.id and s.done_at is not null;
        perform set_config('app.audit_override', jsonb_build_object(
          'action', 'carried', 'meta', jsonb_build_object('carried_to_item_id', v_new, 'to_cycle_id', v_try.id))::text, true);
        update public.project_items
        set state = 'carried', carry_decision = 'carry_forward', carry_decided_by = v_caller.id, carry_decided_at = now()
        where id = v_item.id;
        v_target := v_try;
      elsif cycle_carry_decide.decision = 'close' then
        perform set_config('app.audit_override', jsonb_build_object('action', 'closed')::text, true);
        update public.project_items
        set state = 'cancelled', cancelled_reason = v_reason, cancelled_by = v_caller.id, cancelled_at = now(),
            carry_decision = 'close', carry_decided_by = v_caller.id, carry_decided_at = now()
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
  -- (info); the Admin's own decisions tell nobody (the actor; amendment C6).
  if v_done > 0 then
    v_title := case cycle_carry_decide.decision
      when 'carry_forward' then format('%s carried into %s', case when v_done = 1 then '1 item' else v_done || ' items' end, v_target.label)
      when 'close' then format('1 item closed in %s', v_cycle.label)
      else format('%s left pending in %s', case when v_done = 1 then '1 item' else v_done || ' items' end, v_cycle.label)
    end;
    perform app.notify(array[v_client.admin_id], 'carry_decided', v_title,
      case when cycle_carry_decide.decision = 'close'
        then format('%s · %s. Reason: %s', v_project.name, v_client.name, v_reason)
        else format('%s · %s.', v_project.name, v_client.name) end,
      app.project_link(v_project), 'projects', v_project.id,
      jsonb_build_object('project_id', v_project.id, 'cycle_id', v_cycle.id, 'decision', cycle_carry_decide.decision),
      v_caller.id);
  end if;
  return v_results;
end;
$$;

comment on function public.cycle_carry_decide(uuid[], public.carry_decision, text) is
  '7.2 (WORKFLOWS §5.3, §5.4 items 11-13, 16; amendment C; Q4 (a)): cycles.carry_decide on the '
  'caller''s clients; the open items of ONE recurring cycle whose period has ended (done items wait '
  'for approval); the cycle is the one of the ids the caller may see (another Admin''s id is '
  'NOT_FOUND on its own line). carry_forward (bulk; refused on an Inactive client): a new item in the '
  'next cycle (or the current period''s when the next has ended), made with generated_by carry by the '
  'first id that carries when missing (none carries: no cycle), with the item list on an Active '
  'client and only the carried items on a Paused one (the list joins it when the client is Active, '
  'cycle_generate), taking title, notes, custom fields and stage ticks, never the planned date; the '
  'original becomes carried. close (one item, REASON_REQUIRED): cancelled. leave_pending (bulk): '
  'stays open, decided again later. Per-id results like item_approve. Audited (carried_in, carried, '
  'closed, left_pending). The Owner''s decisions tell the client''s Admin, one carry_decided row per call.';

-- Q4 (a). cycle_generate copies the list into a carry-made cycle -------------------------------------------
create or replace function app.cycle_generate(p_now timestamptz default now())
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_today date := app.to_ist_date(p_now);
  v_row record;
  v_project public.projects;
  v_client public.clients;
  v_start date;
  v_cycle public.project_cycles;
  v_made jsonb;
  v_project_made jsonb;
  v_project_count integer;
  v_admin record;
  v_count integer := 0;
begin
  for v_org in select o.id from public.organizations o order by o.id loop
    -- One run at a time per organisation (a late run and the next cannot both create a cycle).
    perform pg_advisory_xact_lock(hashtext('cycle_generate:' || v_org::text));
    v_made := '[]'::jsonb;
    -- Each project's first date still to cover (decision 2's 7-day catch-up): the last 7 IST dates,
    -- never before the project existed, before its client last became Active (a period spent
    -- paused is skipped on purpose, decisions 1 and 2) or before the project was last reopened
    -- (cycles resume from then, decision 14).
    for v_row in
      select p.id, p.recurrence,
             greatest(
               v_today - 6,
               app.to_ist_date(p.created_at),
               app.to_ist_date(c.activated_at),
               (select app.to_ist_date(max(a.at)) from public.activity_log a
                where a.entity = 'clients' and a.entity_id = c.id and a.action in ('activated', 'reactivated')),
               (select app.to_ist_date(max(a.at)) from public.activity_log a
                where a.entity = 'projects' and a.entity_id = p.id and a.action = 'reopened')
             ) as first_day
      from public.projects p
      join public.clients c on c.id = p.client_id
      where p.org_id = v_org and p.recurrence <> 'one_time' and p.state in ('open', 'in_progress')
        and c.state = 'active'
      order by p.id
    loop
      -- Nothing to lock when every period from the first day to today has its cycle and no running
      -- cycle still waits for the item list (Q4 (a): carried in while the client was not Active).
      continue when not exists (
        select 1
        from generate_series(app.period_start(v_row.recurrence, v_row.first_day)::timestamp,
                             app.period_start(v_row.recurrence, v_today)::timestamp,
                             case when v_row.recurrence = 'weekly' then interval '7 days' else interval '1 month' end) g
        where not exists (select 1 from public.project_cycles c
                          where c.project_id = v_row.id and c.period_start = g::date))
        and not exists (
        select 1 from public.project_cycles c
        where c.project_id = v_row.id and not c.item_list_copied and c.period_end >= v_today);
      -- Each project in a savepoint of its own: one that fails is logged and retried the next night,
      -- never costing the others their cycles (as reminders_tick, phase 5 review). Its totals join
      -- the run's only once all its periods are made.
      begin
        -- The project first (the lock order of every client-work function), then re-checked under it.
        select p.* into v_project from public.projects p where p.id = v_row.id for update;
        continue when v_project.state not in ('open', 'in_progress');
        select c.* into v_client from public.clients c where c.id = v_project.client_id;
        continue when v_client.state <> 'active';
        v_project_count := 0;
        v_project_made := '[]'::jsonb;
        -- Oldest first: an earlier missed period is made before the current one.
        for v_start in
          select g::date
          from generate_series(app.period_start(v_project.recurrence, v_row.first_day)::timestamp,
                               app.period_start(v_project.recurrence, v_today)::timestamp,
                               case when v_project.recurrence = 'weekly' then interval '7 days' else interval '1 month' end) g
          order by 1
        loop
          continue when exists (
            select 1 from public.project_cycles c where c.project_id = v_project.id and c.period_start = v_start);
          v_cycle := app.cycle_create(v_project, v_start, 'schedule', null);
          -- A past period may already have a later cycle (a manual start, a carry): settle it then.
          perform app.cycle_refresh(v_cycle.id);
          v_project_count := v_project_count + 1;
          -- Only a period still running is "ready to rename"; an ended one goes to the prompt.
          if v_cycle.period_end >= v_today then
            v_project_made := v_project_made || jsonb_build_object(
              'admin_id', v_client.admin_id, 'label', v_cycle.label, 'project', v_project.name,
              'client', v_client.name, 'link', app.project_link(v_project), 'project_id', v_project.id);
          end if;
        end loop;
        -- Q4 (a): a running cycle made by a carry while the client was not Active gets the item list
        -- now, once (a past one never takes new items, decision 9).
        for v_cycle in
          select c.* from public.project_cycles c
          where c.project_id = v_project.id and not c.item_list_copied and c.period_end >= v_today
          order by c.period_start
        loop
          perform app.cycle_copy_item_list(v_project, v_cycle.id, null);
          v_project_made := v_project_made || jsonb_build_object(
            'admin_id', v_client.admin_id, 'label', v_cycle.label, 'project', v_project.name,
            'client', v_client.name, 'link', app.project_link(v_project), 'project_id', v_project.id);
        end loop;
        v_count := v_count + v_project_count;
        v_made := v_made || v_project_made;
      exception when others then
        raise warning 'cycle_generate: project % skipped: %', v_row.id, sqlerrm;
      end;
    end loop;

    -- WORKFLOWS §9 "Cycle generated": one combined row per Admin per run (actionable), no actor.
    for v_admin in
      select (x ->> 'admin_id')::uuid as admin_id, count(*) as n,
             min(x ->> 'label') as first_label, max(x ->> 'label') as last_label,
             string_agg((x ->> 'project') || ' (' || (x ->> 'client') || ')', ', '
                        order by x ->> 'client', x ->> 'project') as projects,
             min(x ->> 'link') as link, min(x ->> 'project_id') as project_id
      from jsonb_array_elements(v_made) x
      where x ->> 'admin_id' is not null
      group by 1
    loop
      perform app.notify(array[v_admin.admin_id], 'cycle_generated',
        case
          when v_admin.n = 1 then format('%s is ready: %s', v_admin.first_label, v_admin.projects)
          when v_admin.first_label = v_admin.last_label then format('%s is ready for %s projects', v_admin.first_label, v_admin.n)
          else format('New cycles are ready for %s projects', v_admin.n)
        end,
        case when v_admin.n = 1 then 'Rename this period''s items where needed.'
             else v_admin.projects || '. Rename this period''s items where needed.' end,
        case when v_admin.n = 1 then v_admin.link else '/today' end,
        case when v_admin.n = 1 then 'projects' end,
        case when v_admin.n = 1 then v_admin.project_id::uuid end,
        jsonb_build_object('cycles', v_admin.n), null);
    end loop;
  end loop;
  return v_count;
end;
$$;

comment on function app.cycle_generate(timestamptz) is
  '7.2 (WORKFLOWS §8, kickoff 7 decision 2; 7A review S2; Q4 (a)): pg_cron at 00:00 IST (18:30 UTC) '
  'every night. Per organisation under an advisory lock: for every recurring project, open or in '
  'progress, of an Active client, every missing period overlapping the last 7 IST dates '
  '(to_ist_date(p_now) - 6 to today), oldest first, but none that ended before the project was '
  'created, before its client last became Active (activated / reactivated) or before the project was '
  'last reopened; then the item list into any running cycle a carry made while the client was not '
  'Active (item_list_copied false), once. generated_by schedule, the item list copied in; a past '
  'period''s cycle is an ended cycle like any other (cycle_close_prompt, the carry decision). Each '
  'project in a savepoint of its own. Then one cycle_generated row per Admin (combined, actionable) '
  'naming the cycles whose period has not ended. Returns the cycles created. Idempotent (unique '
  'project_id, period_start; item_list_copied).';

-- Q5 (b). item_update on a locked item: title and notes only ----------------------------------------------
create or replace function public.item_update(item_id uuid, changes jsonb)
returns text[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller public.members;
  v_item public.project_items;
  v_project public.projects;
  v_key text;
  v_title text;
  v_notes text;
  v_planned date;
  v_fields jsonb;
  v_position text;
  v_changed text[] := '{}';
begin
  v_caller := app.client_work_caller('projects.manage', 'You cannot edit items.');
  v_item := app.item_lock(item_update.item_id);
  select p.* into v_project from public.projects p where p.id = v_item.project_id;
  perform app.project_check_writable(v_project);
  if changes is null or jsonb_typeof(changes) <> 'object' then
    perform app.fail('VALIDATION', 'Nothing to change.');
  end if;
  for v_key in select jsonb_object_keys(changes) loop
    if v_key not in ('title', 'notes', 'planned_date', 'custom_fields', 'position') then
      perform app.fail('VALIDATION', format('"%s" is not an item detail that can change.', v_key));
    end if;
    -- Q4-Q7 answers, Q5 (b): an approved, cancelled or carried item keeps its state, planned date,
    -- ticks and everything else; only its title and notes may still be corrected (audited).
    if v_item.state not in ('open', 'done') and v_key not in ('title', 'notes') then
      perform app.fail('INVALID_STATE', format('This item is %s: only its title and notes can be corrected.', v_item.state));
    end if;
  end loop;
  v_title := case when changes ? 'title'
    then app.client_work_text(changes ->> 'title', 200, 'Give the item a title of up to 200 characters.')
    else v_item.title end;
  v_notes := case when changes ? 'notes'
    then app.client_work_text(changes ->> 'notes', 5000, 'Keep the notes under 5000 characters.', false)
    else v_item.notes end;
  v_planned := v_item.planned_date;
  if changes ? 'planned_date' then
    begin
      v_planned := nullif(changes ->> 'planned_date', '')::date;
    exception when others then
      perform app.fail('VALIDATION', 'This is not a date.');
    end;
  end if;
  v_fields := case when changes ? 'custom_fields' then changes -> 'custom_fields' else v_item.custom_fields end;
  if jsonb_typeof(v_fields) is distinct from 'object' then
    perform app.fail('VALIDATION', 'Custom fields are a set of named values.');
  end if;
  v_position := case when changes ? 'position' then app.client_work_position(changes ->> 'position') else v_item.position end;

  if v_title is distinct from v_item.title then v_changed := array_append(v_changed, 'title'); end if;
  if v_notes is distinct from v_item.notes then v_changed := array_append(v_changed, 'notes'); end if;
  if v_planned is distinct from v_item.planned_date then v_changed := array_append(v_changed, 'planned_date'); end if;
  if v_fields is distinct from v_item.custom_fields then v_changed := array_append(v_changed, 'custom_fields'); end if;
  if v_position is distinct from v_item.position then v_changed := array_append(v_changed, 'position'); end if;
  if cardinality(v_changed) > 0 then
    update public.project_items
    set title = v_title, notes = v_notes, planned_date = v_planned, custom_fields = v_fields, position = v_position
    where id = v_item.id;
  end if;
  return v_changed;
end;
$$;

comment on function public.item_update(uuid, jsonb) is
  '7.2 (WORKFLOWS §5.4 items 9, 10; Q5 (b)): projects.manage on the caller''s clients, the project '
  'open or in progress. changes: title, notes, planned_date (any date, null clears), custom_fields, '
  'position on an open or done item; on an approved, cancelled or carried item only title and notes '
  '(anything else INVALID_STATE). Returns the keys that changed. Audited by the trigger.';

-- Q6 (a). project_reopen refused on an Inactive client -------------------------------------------------------
create or replace function public.project_reopen(project_id uuid, reason text)
returns public.project_state
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller public.members;
  v_project public.projects;
  v_reason text;
  v_state public.project_state;
  v_client public.clients;
begin
  v_caller := app.client_work_caller('projects.complete', 'You cannot reopen projects.');
  v_project := app.project_lock(project_reopen.project_id);
  if v_project.state not in ('completed', 'cancelled') then
    perform app.fail('INVALID_STATE', 'Only a completed or cancelled project can be reopened.');
  end if;
  -- Q6 (a): an Inactive client's project stays closed (§4: no new work there).
  v_client := app.project_client(v_project);
  if v_client.state = 'inactive' then
    perform app.fail('INVALID_STATE', format('%s is closed. Reactivate the client first.', v_client.name));
  end if;
  v_reason := nullif(btrim(coalesce(project_reopen.reason, '')), '');
  if v_reason is null then
    perform app.fail('REASON_REQUIRED', 'Reopening a project needs a reason.');
  end if;
  if length(v_reason) > 1000 then
    perform app.fail('VALIDATION', 'Keep the reason under 1000 characters.');
  end if;
  -- Decision 14: in progress when anything was ever ticked or done (a tick row, an item done or
  -- reviewed, a 'done' entry in its history), otherwise open. Items cancelled by a cancel stay so.
  v_state := case when exists (
      select 1 from public.project_items i
      where i.project_id = v_project.id
        and (i.done_at is not null
             or exists (select 1 from public.project_item_stages s where s.item_id = i.id)
             or exists (select 1 from public.item_reviews r where r.item_id = i.id)
             or exists (select 1 from public.activity_log a
                        where a.entity = 'project_items' and a.entity_id = i.id and a.action = 'done')))
    then 'in_progress'::public.project_state else 'open'::public.project_state end;

  perform set_config('app.audit_override', jsonb_build_object(
    'action', 'reopened', 'meta', jsonb_build_object('from_state', v_project.state, 'reason', v_reason))::text, true);
  begin
    update public.projects
    set state = v_state, completed_at = null, completed_by = null,
        cancelled_at = null, cancelled_by = null, cancelled_reason = null
    where id = v_project.id;
  exception when unique_violation then
    perform app.fail('CONFLICT', 'This client already has an open project with this name: rename one first.');
  end;

  v_client := app.project_client(v_project);
  perform app.project_lifecycle_notify(v_project, 'project_reopened',
    format('%s reopened %s', v_caller.full_name, v_project.name),
    format('%s. Reason: %s', v_client.name, v_reason), v_caller.id);
  return v_state;
end;
$$;

comment on function public.project_reopen(uuid, text) is
  '7.2 (WORKFLOWS §5.4 item 14, amendment C; Q6 (a)): projects.complete on the caller''s clients; '
  'completed or cancelled -> in_progress when any item was ever ticked or done, else open (the '
  'reason, required, in the audit meta); refused on an Inactive client''s project (INVALID_STATE: '
  'reactivate the client first). Items it cancelled stay cancelled; recurring cycles resume from the '
  'current period (the nightly cycle_generate). CONFLICT when an open project of the client has its '
  'name. Notifies the Owner or the client''s Admin, whoever did not act (project_reopened).';
