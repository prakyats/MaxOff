-- 7A review fixes (the architecture review of unit 7A, 2026-10-08; WORKFLOWS §5.4 "As built", §8, §9):
--
-- S1  cycle_close_prompt: prompted_at decides only WHETHER an Admin is prompted (a newly ended cycle
--     with undecided items, not yet announced); the prompt's count and list then cover every
--     undecided open item of every ended cycle of their open and in-progress projects, plus the
--     items left pending. Still one row per Admin per run, the client's Admin only (issue #56 Q2).
-- L1  cycle_close_prompt: each Admin's notification and the marking of their cycles in a savepoint of
--     its own: one that fails is logged as a WARNING and prompted the next night, never costing the
--     others theirs (as cycle_generate).
-- S2  cycle_generate: "never a silently skipped period" (kickoff 7 decision 2, the 7-day catch-up):
--     every missing period overlapping the last 7 IST dates is made, oldest first, never one that
--     ended before the project existed, before its client last became Active (a paused period is
--     skipped on purpose, decisions 1 and 2) or before the project was last reopened (decision 14).
--     A past cycle so made is an ended cycle like any other (the prompt and the carry decision); the
--     cycle_generated row names only the cycles whose period has not ended.
-- S3  RLS: the client-work child tables and the activity policy lean on projects' and
--     project_items' own RLS (project_id in (select id from projects)) instead of calling
--     app.project_visible() once per row. Same visibility (pgTAP 67 unchanged).
-- L4  cycle_carry_decide: ids are filtered by visibility before they are grouped by cycle, so
--     another Admin's id is NOT_FOUND (per id), never a VALIDATION for the whole batch.
-- L5  app.project_lock: the client's visibility is checked again once the row is locked (the
--     client's Admin may have changed while the caller waited).
-- L6  client_create: the audit entry reads "created_active" (meta admin_id), as client_activate's
--     reads "activated"; app.clients_after_insert keeps a transition's override for the client's
--     own entry instead of handing it to the notes row.
-- L7  cycle_carry_decide: a carry-created target cycle is made with the first id that carries, in
--     that id's savepoint, so a batch where nothing carries leaves no cycle behind.
--
-- EXPAND-ONLY: create or replace of functions, alter policy. Append-only: never edit once applied.

-- S3. RLS without the per-row helper -------------------------------------------------------------------
alter policy project_stages_select on public.project_stages
  using (project_id in (select p.id from public.projects p));
alter policy project_item_blueprints_select on public.project_item_blueprints
  using (project_id in (select p.id from public.projects p));
alter policy project_cycles_select on public.project_cycles
  using (project_id in (select p.id from public.projects p));
alter policy project_items_select on public.project_items
  using (project_id in (select p.id from public.projects p));
alter policy project_item_stages_select on public.project_item_stages
  using (item_id in (select i.id from public.project_items i));
alter policy item_reviews_select on public.item_reviews
  using (item_id in (select i.id from public.project_items i));
alter policy activity_log_select_client_work on public.activity_log
  using (org_id = (select m.org_id from app.current_member() m)
         and ((entity in ('projects', 'project_stages', 'project_item_blueprints', 'project_cycles')
               and entity_id in (select p.id from public.projects p))
              or (entity in ('project_items', 'project_item_stages', 'item_reviews')
                  and entity_id in (select i.id from public.project_items i))));

comment on function app.project_visible(uuid) is
  'May the caller see this project and everything in it (PERMISSIONS §2)? projects.manage on a '
  'client the caller may see (app.client_visible: the Owner every client, the current Admin their '
  'own, live). Crew hold no projects.manage. The same rule as projects'' RLS, for the functions '
  '(cycle_carry_decide); the child tables'' policies read projects under its own RLS instead '
  '(7A review S3).';

-- L5. The lock re-checks the scope -----------------------------------------------------------------------
create or replace function app.project_lock(p_project_id uuid)
returns public.projects
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_project public.projects;
begin
  -- Visible first, then locked: a project of someone else's client is never locked by this caller.
  select p.* into v_project from public.projects p
  where p.id = p_project_id and p.org_id = (select m.org_id from app.current_member() m);
  if v_project.id is null or not app.client_visible(v_project.client_id) then
    perform app.fail('NOT_FOUND', 'This project is not one of yours.');
  end if;
  select p.* into v_project from public.projects p where p.id = v_project.id for update;
  -- Checked again under the lock: the client's Admin may have changed while this caller waited.
  if not app.client_visible(v_project.client_id) then
    perform app.fail('NOT_FOUND', 'This project is not one of yours.');
  end if;
  return v_project;
end;
$$;

comment on function app.project_lock(uuid) is
  'Internal (7.2): the project row FOR UPDATE; NOT_FOUND outside the caller''s organization or a '
  'client they may not see (app.client_visible), checked before the lock and again under it (7A '
  'review L5). The first lock of every client-work function.';

-- L4, L7. cycle_carry_decide --------------------------------------------------------------------------------
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
    -- (generated_by carry; the nightly job then finds it), never by a batch where none does (L7).
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
          v_try := app.cycle_create(v_project, v_target_start, 'carry', v_caller.id);
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
  '7.2 (WORKFLOWS §5.3, §5.4 items 11-13, 16; amendment C): cycles.carry_decide on the caller''s '
  'clients; the open items of ONE recurring cycle whose period has ended (done items wait for '
  'approval); the cycle is the one of the ids the caller may see (another Admin''s id is NOT_FOUND '
  'on its own line). carry_forward (bulk; refused on an Inactive client): a new item in the next '
  'cycle (or the current period''s when the next has ended), made with generated_by carry by the '
  'first id that carries when missing (none carries: no cycle), taking title, notes, custom fields '
  'and stage ticks, never the planned date; the original becomes carried. close (one item, '
  'REASON_REQUIRED): cancelled. leave_pending (bulk): stays open, decided again later. Per-id '
  'results like item_approve. Audited (carried_in, carried, closed, left_pending). The Owner''s '
  'decisions tell the client''s Admin, one carry_decided row per call.';

-- S2. cycle_generate: the missed periods of the last 7 days ---------------------------------------------
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
      -- Nothing to lock when every period from the first day to today has its cycle.
      continue when not exists (
        select 1
        from generate_series(app.period_start(v_row.recurrence, v_row.first_day)::timestamp,
                             app.period_start(v_row.recurrence, v_today)::timestamp,
                             case when v_row.recurrence = 'weekly' then interval '7 days' else interval '1 month' end) g
        where not exists (select 1 from public.project_cycles c
                          where c.project_id = v_row.id and c.period_start = g::date));
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
  '7.2 (WORKFLOWS §8, kickoff 7 decision 2; 7A review S2): pg_cron at 00:00 IST (18:30 UTC) every '
  'night. Per organisation under an advisory lock: for every recurring project, open or in progress, '
  'of an Active client, every missing period overlapping the last 7 IST dates (to_ist_date(p_now) - 6 '
  'to today), oldest first, but none that ended before the project was created, before its client '
  'last became Active (activated / reactivated) or before the project was last reopened: the new '
  'cycles on the 1st and on Mondays, a catch-up on any other night (a missed run, a resumed '
  'client); one already made by project_create, cycle_start_next or a carry decision is skipped. '
  'generated_by schedule, the item list copied in; a past period''s cycle is an ended cycle like any '
  'other (cycle_close_prompt, the carry decision). Each project in a savepoint of its own. Then one '
  'cycle_generated row per Admin (combined, actionable) naming the cycles whose period has not '
  'ended. Returns the cycles created. Idempotent (unique project_id, period_start).';

-- S1, L1. cycle_close_prompt ---------------------------------------------------------------------------------
create or replace function app.cycle_close_prompt(p_now timestamptz default now())
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_today date := app.to_ist_date(p_now);
  v_rows jsonb;
  v_cycle record;
  v_admin record;
  v_cycle_id uuid;
  v_count integer := 0;
begin
  for v_org in select o.id from public.organizations o order by o.id loop
    perform pg_advisory_xact_lock(hashtext('cycle_close_prompt:' || v_org::text));
    v_rows := '[]'::jsonb;
    -- Every ended cycle of an open or in-progress project holding open items: its undecided items
    -- and the items left pending. 'new' marks a cycle not yet announced with undecided items.
    for v_cycle in
      select c.id, c.label, c.prompted_at, p.id as project_id, p.client_id, p.name as project,
             cl.name as client, app.cycle_close_prompt_recipient(cl) as recipient,
             count(*) filter (where i.carry_decision is null) as undecided,
             count(*) filter (where i.carry_decision = 'leave_pending') as pending
      from public.project_cycles c
      join public.projects p on p.id = c.project_id
      join public.clients cl on cl.id = p.client_id
      join public.project_items i on i.cycle_id = c.id and i.state = 'open'
      where c.org_id = v_org and c.period_end is not null and c.period_end < v_today
        and p.state in ('open', 'in_progress')
      group by c.id, c.label, c.prompted_at, p.id, p.client_id, p.name, cl.id, cl.name
      order by c.id
    loop
      continue when v_cycle.recipient is null;
      v_rows := v_rows || jsonb_build_object(
        'recipient', v_cycle.recipient, 'cycle_id', v_cycle.id,
        'new', v_cycle.prompted_at is null and v_cycle.undecided > 0,
        'items', v_cycle.undecided + v_cycle.pending,
        'pending', v_cycle.pending,
        'line', format('%s (%s) · %s', v_cycle.project, v_cycle.client, v_cycle.label),
        'link', '/clients/' || v_cycle.client_id || '/projects/' || v_cycle.project_id,
        'project_id', v_cycle.project_id);
    end loop;

    -- S1: prompted_at decides only whether an Admin is prompted (a newly ended cycle with undecided
    -- items); the prompt then counts and lists everything they still have to decide, the cycles
    -- announced before and the items left pending included.
    for v_admin in
      select (x ->> 'recipient')::uuid as recipient,
             sum((x ->> 'items')::integer) as items,
             sum((x ->> 'pending')::integer) as pending,
             count(distinct x ->> 'project_id') as projects,
             string_agg((x ->> 'line') || ': ' || (x ->> 'items'), '; ' order by x ->> 'line') as lines,
             min(x ->> 'link') as link, min(x ->> 'project_id') as project_id,
             array_agg((x ->> 'cycle_id')::uuid order by x ->> 'cycle_id')
               filter (where (x ->> 'new')::boolean) as new_cycles
      from jsonb_array_elements(v_rows) x
      group by 1
      having bool_or((x ->> 'new')::boolean)
      order by 1
    loop
      -- L1: each Admin's prompt and the marking of their cycles in a savepoint of their own: one that
      -- fails is logged and prompted the next night (prompted_at stays null), never costing the
      -- others theirs.
      begin
        perform app.notify(array[v_admin.recipient], 'items_to_decide',
          format('%s unfinished %s to decide', v_admin.items, case when v_admin.items = 1 then 'item' else 'items' end),
          v_admin.lines || case when v_admin.pending > 0
            then format('. %s left pending, listed again.', v_admin.pending) else '.' end,
          case when v_admin.projects = 1 then v_admin.link else '/today' end,
          case when v_admin.projects = 1 then 'projects' end,
          case when v_admin.projects = 1 then v_admin.project_id::uuid end,
          jsonb_build_object('items', v_admin.items, 'pending', v_admin.pending), null);
        -- Each newly announced cycle is marked, so it alone never prompts again.
        foreach v_cycle_id in array v_admin.new_cycles loop
          perform set_config('app.audit_override', jsonb_build_object('action', 'prompted')::text, true);
          update public.project_cycles set prompted_at = p_now where id = v_cycle_id;
        end loop;
        v_count := v_count + 1;
      exception when others then
        raise warning 'cycle_close_prompt: Admin % skipped: %', v_admin.recipient, sqlerrm;
      end;
    end loop;
  end loop;
  return v_count;
end;
$$;

comment on function app.cycle_close_prompt(timestamptz) is
  '7.2 (WORKFLOWS §8 / §9; issue #56 Q2, owner 2026-10-08; 7A review S1, L1): pg_cron at 00:05 IST '
  '(18:35 UTC) every night. Per organisation under an advisory lock: an Admin is prompted when a '
  'cycle of their clients'' open or in-progress projects has ended before the run''s IST date, holds '
  'open items with no carry decision and was not prompted yet (prompted_at). The prompt, one '
  'items_to_decide row per Admin per run (the client''s Admin only, app.cycle_close_prompt_recipient; '
  'actionable, no actor), then counts and lists every undecided open item of every ended cycle of '
  'those projects and the items they left pending, each project and cycle with its count; the new '
  'cycles are marked prompted_at (audited ''prompted''), each Admin in a savepoint of their own (one '
  'that fails is a WARNING, prompted the next night). Done items are not counted (they wait for '
  'approval). Returns the rows written. Idempotent: a re-run with nothing newly ended is quiet.';

-- L6. client_create's history entry --------------------------------------------------------------------
-- The client's own audit entry is the one a transition's override names: the notes, brand and
-- assignment rows this trigger adds are written with the override set aside, then it is put back.
create or replace function app.clients_after_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_override text := coalesce(current_setting('app.audit_override', true), '');
begin
  if v_override <> '' then
    perform set_config('app.audit_override', '', true);
  end if;
  insert into public.client_private (client_id) values (new.id);
  insert into public.client_brand (client_id) values (new.id);
  if new.admin_id is not null then
    insert into public.client_admin_assignments (client_id, admin_id, assigned_by)
    values (new.id, new.admin_id, coalesce(auth.uid(), new.created_by));
  end if;
  if v_override <> '' then
    perform set_config('app.audit_override', v_override, true);
  end if;
  return null;
end;
$$;

comment on function app.clients_after_insert() is
  'AFTER INSERT on clients: the Owner-only notes row, the brand row and, when an Admin was given, '
  'the first assignment row are created with the client. A transition''s app.audit_override is '
  'kept for the client''s own entry (it fires after this trigger; 7A review L6).';

create or replace function public.client_create(details jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller public.members;
  v_row public.clients;
  v_key text;
  v_id uuid;
  v_name text;
begin
  select m.* into v_caller from app.current_member() m;
  if v_caller.id is null then
    perform app.fail('UNAUTHENTICATED', 'Your account is not active.');
  end if;
  if not app.has_permission('clients.create') then
    perform app.fail('FORBIDDEN', 'You cannot add clients.');
  end if;
  -- The Owner's new client is a draft, added as before (the plain insert under clients.manage).
  if app.has_permission('clients.manage') then
    perform app.fail('FORBIDDEN', 'The Owner adds a client as a draft.');
  end if;
  if details is null or jsonb_typeof(details) <> 'object' then
    perform app.fail('VALIDATION', 'Give the client a name.');
  end if;
  for v_key in select jsonb_object_keys(details) loop
    if v_key not in ('name', 'legal_name', 'gstin', 'address', 'city', 'phone', 'email', 'website',
                     'drive_url', 'requirements', 'notes', 'custom_fields') then
      perform app.fail('VALIDATION', format('"%s" is not a client detail.', v_key));
    end if;
  end loop;
  v_row := jsonb_populate_record(null::public.clients, details);
  v_name := btrim(coalesce(v_row.name, ''));
  if v_name = '' then
    perform app.fail('VALIDATION', 'Give the client a name.');
  end if;
  perform app.custom_fields_check('client', v_caller.org_id, coalesce(v_row.custom_fields, '{}'::jsonb));

  -- Amendment B: created Active, the Admin always the caller (the insert guard checks they are an
  -- active Admin; the after-insert trigger opens the assignment row), the Owner told. The audit
  -- entry reads "created_active" (7A review L6), as client_activate's reads "activated"; its diff
  -- still carries the whole new row.
  begin
    perform set_config('app.audit_override', jsonb_build_object(
      'action', 'created_active', 'meta', jsonb_build_object('admin_id', v_caller.id))::text, true);
    insert into public.clients (
      org_id, name, legal_name, gstin, address, city, phone, email, website, drive_url, requirements,
      notes, custom_fields, state, admin_id, activated_at, created_by)
    values (
      v_caller.org_id, v_name, v_row.legal_name, v_row.gstin, v_row.address, v_row.city, v_row.phone,
      v_row.email, v_row.website, v_row.drive_url, v_row.requirements, v_row.notes,
      coalesce(v_row.custom_fields, '{}'::jsonb), 'active', v_caller.id, now(), v_caller.id)
    returning id into v_id;
  exception
    when unique_violation then
      perform app.fail('CONFLICT', 'Another client already has this name.');
    when check_violation then
      perform app.fail('VALIDATION', 'Check the client''s details: a GSTIN, an email, a phone or a link is not in its format.');
  end;

  -- WORKFLOWS §9 (amendment B): the Owner, "‹Admin› added the client ‹name›" (info, never email),
  -- opening the client. The creating Admin is the actor and gets nothing.
  perform app.notify(array[app.org_owner_id(v_caller.org_id)], 'client_created',
    format('%s added the client %s', v_caller.full_name, v_name), null,
    '/clients/' || v_id, 'clients', v_id, jsonb_build_object('client_id', v_id), v_caller.id);
  return v_id;
end;
$$;

comment on function public.client_create(jsonb) is
  'Kickoff 7 amendment B (WORKFLOWS §4, PERMISSIONS §3 "Creating a client"): clients.create without '
  'clients.manage, i.e. an Admin. Creates the client Active with admin_id = the caller (no other '
  'Admin can be named), activated_at, the first client_admin_assignments row (trigger), the audit '
  'entry (action created_active, meta admin_id; 7A review L6) and the Owner''s client_created '
  'notification, in one transaction. details: name (required), legal_name, gstin, address, city, '
  'phone, email, website, drive_url, requirements, notes, custom_fields (company-wide client '
  'fields). CONFLICT when the name is taken among clients not Inactive. The Owner adds a draft by '
  'the plain insert instead.';
