-- Amendment C timing answers Q12-Q14 (advisor 2026-10-08, applying the owner's 08:00 rule; the owner
--   confirms and can override). PROGRESS "Kickoff 7 decisions", WORKFLOWS §5.2 item 2, §5.4 items 2 and
--   21, §8, §9; PRODUCT §4.5; DATA-MODEL §5.
--
-- Q12 (b) Cycles are made at 00:00 IST again; only their notices wait for 08:00. cycle_generate runs at
--         00:00 IST (30 18 * * * UTC, the same job name, cron.schedule upserts it) and writes no
--         notification: between 00:00 and 08:00 on the 1st and on Mondays the current cycle exists, so
--         item_add, the carry target and cycle_start_next behave as kickoff 7 decision 2 intended, and
--         the 7-day catch-up runs at 00:00 as before. "Cycle ready" (cycle_generated) goes from the
--         08:00 IST run of client_work_alerts: one combined notice per Admin per morning, naming the
--         running cycles armed since they were last told.
--         project_cycles.ready_armed_at (by trigger) arms a cycle's notice: a cycle the schedule makes,
--         a cycle a carry makes when the carrier is not the client's Admin (the Owner's carry still
--         tells the Admin "cycle ready", once), and a carry-made cycle whose item list joins it once
--         its client is Active again (Q4 (a)). Never armed: a project's first cycle (project_create),
--         a manual start (cycle_start_next tells the Admin at once when the Owner starts it, Q14) and
--         an Admin's own carry (the actor). Sent once per arming (client_work_alerts kind
--         cycle_generated, answers_at = ready_armed_at), at the first 08:00 IST after it, while the
--         cycle's period is running, its project open or in progress and its client Active.
--         cycle_close_prompt (items_to_decide) stays at 08:05 IST.
-- Q13 (a) A late send after an outage waits for the next 08:00 IST and goes only if its reason still
--         holds. A client-work notice or escalation is sent only in the morning window, 08:00 to before
--         08:30 IST (app.client_work_send_window): client_work_alerts (E1 notice and escalation, E2
--         notice and escalation, E3, cycle_generated) and cycle_close_prompt (items_to_decide) do
--         nothing outside it, so a first run after an outage at 15:00 IST sends nothing and the next
--         morning's run sends what still holds (every condition is read again at that run; nothing is
--         marked sent until it is). Half an hour covers a late pg_cron start (six 5-minute runs, the
--         08:05 prompt with 25 minutes to spare) and never reaches midnight; a whole window missed
--         sends the next morning (no lost send).
-- Q14 (a) Actor-driven client-work notifications (item_rejected, carry decisions, the project
--         lifecycle, a manual start's cycle_generated) go at once, exactly like tasks; quiet hours hold
--         the push as usual. As built: no change here.
--
-- EXPAND-ONLY: one nullable column (null on every existing cycle: they were announced by the old job),
-- one trigger, the client_work_alerts kind CHECK widened (phase 7's table, never narrowed), functions
-- replaced with the same signatures and grants, one new internal function, one pg_cron schedule moved
-- back. Append-only: never edit once applied.

-- Q12. When a cycle's "cycle ready" notice was armed --------------------------------------------------------
alter table public.project_cycles add column ready_armed_at timestamptz null;
comment on column public.project_cycles.ready_armed_at is
  'Amendment C timing answer Q12 (b) (advisor 2026-10-08, owner to confirm): when the cycle''s "cycle '
  'ready" notice (cycle_generated) to its client''s Admin was armed: on insert for a cycle the schedule '
  'made (generated_by schedule) or a carry made by someone other than the client''s Admin, and when a '
  'carry-made cycle''s item list joins it (item_list_copied false -> true, Q4 (a)). Null: nothing to '
  'announce (a project''s first cycle, a manual start, an Admin''s own carry, a one-time project, every '
  'cycle made before this column). Set by the ready_armed_at trigger; app.client_work_alerts() tells '
  'the Admin at the first 08:00 IST run after it, once.';

create function app.project_cycles_ready_armed_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.period_start is not null and new.item_list_copied
       and (new.generated_by = 'schedule'
            or (new.generated_by = 'carry'
                and new.created_by is distinct from (
                  select cl.admin_id from public.projects p join public.clients cl on cl.id = p.client_id
                  where p.id = new.project_id))) then
      new.ready_armed_at := now();
    end if;
  elsif not old.item_list_copied and new.item_list_copied and new.period_start is not null then
    new.ready_armed_at := now();
  end if;
  return new;
end;
$$;

revoke all on function app.project_cycles_ready_armed_at() from public, anon, authenticated;
grant execute on function app.project_cycles_ready_armed_at() to service_role;

comment on function app.project_cycles_ready_armed_at() is
  'BEFORE INSERT OR UPDATE OF item_list_copied on project_cycles (Q12 (b)): arms a cycle''s "cycle '
  'ready" notice (ready_armed_at) when the schedule makes it, when a carry by someone other than the '
  'client''s Admin makes it with its item list, or when its item list joins it.';

create trigger ready_armed_at before insert or update of item_list_copied on public.project_cycles
  for each row execute function app.project_cycles_ready_armed_at();

-- Q12. The record of what was sent takes "cycle ready" ------------------------------------------------------
alter table public.client_work_alerts drop constraint client_work_alerts_kind_check;
alter table public.client_work_alerts add constraint client_work_alerts_kind_check
  check (kind in ('item_overdue', 'item_overdue_escalation', 'cycle_undecided_escalation', 'delivery_escalation',
                  'cycle_undecided_notice', 'cycle_generated'));

comment on table public.client_work_alerts is
  'Kickoff 7 amendment C E1-E3, the Q8-Q11 answers, the 7A review of d9caeab and the timing answers '
  'Q12-Q13: one row per client-work notice or escalation sent. item_overdue / item_overdue_escalation: '
  'once per item and planned date; a notice counts while it was sent to the client''s current recipient '
  'at or after the item''s basis (its overdue moment, last return to open and the recipient''s '
  'assignment), and an escalation once per such notice. Moving to a new date re-arms; moving back to a '
  'date already noticed does not (the item''s last arming only delays the next notice to 08:00 IST). '
  'cycle_undecided_notice (E2''s fresh notice, by the job or the prompt) and cycle_undecided_escalation: '
  'per cycle and period end. delivery_escalation: per project and delivery date, once. cycle_generated '
  '(Q12): per cycle and period start, once per arming (answers_at = project_cycles.ready_armed_at). '
  'answers_at (unique with kind, entity, date and recipient): what the send answers, so a replayed run '
  'never sends twice. Written by app.client_work_alerts() and app.cycle_close_prompt() only; the '
  'notifications are the visible record, so no API access at all (RLS on, no policy). Never deleted.';

-- Q13. The morning window --------------------------------------------------------------------------------
create function app.client_work_send_window(p_now timestamptz)
returns boolean
language sql
stable
set search_path = ''
as $$
  select (p_now at time zone 'Asia/Kolkata')::time >= time '08:00'
     and (p_now at time zone 'Asia/Kolkata')::time < time '08:30';
$$;

revoke all on function app.client_work_send_window(timestamptz) from public, anon, authenticated;
grant execute on function app.client_work_send_window(timestamptz) to service_role;

comment on function app.client_work_send_window(timestamptz) is
  'Internal (amendment C timing answer Q13 (a), advisor 2026-10-08): true from 08:00 to before 08:30 IST, '
  'the only time a scheduled client-work notice or escalation is sent (app.client_work_alerts, '
  'app.cycle_close_prompt). A run outside it (a late run after an outage) sends nothing; the next '
  'morning''s run sends what still holds.';

-- Q12. cycle_generate at 00:00 IST, writing no notification ------------------------------------------------
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
  v_project_count integer;
  v_count integer := 0;
begin
  for v_org in select o.id from public.organizations o order by o.id loop
    -- One run at a time per organisation (a late run and the next cannot both create a cycle).
    perform pg_advisory_xact_lock(hashtext('cycle_generate:' || v_org::text));
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
      -- never costing the others their cycles (as reminders_tick, phase 5 review).
      begin
        -- The project first (the lock order of every client-work function), then re-checked under it.
        select p.* into v_project from public.projects p where p.id = v_row.id for update;
        continue when v_project.state not in ('open', 'in_progress');
        select c.* into v_client from public.clients c where c.id = v_project.client_id;
        continue when v_client.state <> 'active';
        v_project_count := 0;
        -- Oldest first: an earlier missed period is made before the current one. Each new cycle arms
        -- its "cycle ready" notice (ready_armed_at, by trigger), which client_work_alerts sends at
        -- 08:00 IST while its period is running (Q12 (b)); an ended one goes to the prompt.
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
        end loop;
        -- Q4 (a): a running cycle made by a carry while the client was not Active gets the item list
        -- now, once (a past one never takes new items, decision 9); the list joining arms its notice.
        for v_cycle in
          select c.* from public.project_cycles c
          where c.project_id = v_project.id and not c.item_list_copied and c.period_end >= v_today
          order by c.period_start
        loop
          perform app.cycle_copy_item_list(v_project, v_cycle.id, null);
        end loop;
        v_count := v_count + v_project_count;
      exception when others then
        raise warning 'cycle_generate: project % skipped: %', v_row.id, sqlerrm;
      end;
    end loop;
  end loop;
  return v_count;
end;
$$;

comment on function app.cycle_generate(timestamptz) is
  '7.2 (WORKFLOWS §8, kickoff 7 decision 2; 7A review S2; Q4 (a); amendment C timing answer Q12 (b), '
  'advisor 2026-10-08): pg_cron at 00:00 IST (18:30 UTC) every night, writing no notification. Per '
  'organisation under an advisory lock: for every recurring project, open or in progress, of an Active '
  'client, every missing period overlapping the last 7 IST dates (to_ist_date(p_now) - 6 to today), '
  'oldest first, but none that ended before the project was created, before its client last became '
  'Active (activated / reactivated) or before the project was last reopened; then the item list into any '
  'running cycle a carry made while the client was not Active (item_list_copied false), once. '
  'generated_by schedule, the item list copied in; a past period''s cycle is an ended cycle like any '
  'other (cycle_close_prompt, the carry decision). Each project in a savepoint of its own. Each new '
  'cycle (and each list that joins one) arms project_cycles.ready_armed_at: the client''s Admin is told '
  '"cycle ready" by app.client_work_alerts() at 08:00 IST, one combined notice per Admin. Returns the '
  'cycles created. Idempotent (unique project_id, period_start; item_list_copied).';

-- Q12, Q13. The job: only in the morning window; "cycle ready" first ----------------------------------------
create or replace function app.client_work_alerts(p_now timestamptz default now())
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org record;
  v_today date := app.to_ist_date(p_now);
  v_group record;
  v_owner uuid;
  v_sent integer;
  v_count integer := 0;
begin
  -- S2: the "already sent?" checks below read what the run before committed once the advisory lock is
  -- held, which only read committed gives (a repeatable-read snapshot predates the lock).
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'client_work_alerts runs only at read committed, not %',
      current_setting('transaction_isolation');
  end if;
  -- Q13 (a): sends only in the morning window (08:00 to before 08:30 IST). A run outside it, such as the
  -- first run after an outage, sends nothing; the next morning's run sends what still holds.
  if not app.client_work_send_window(p_now) then
    return 0;
  end if;

  for v_org in
    select s.org_id, s.item_overdue_escalate_hours as hours, s.cycle_decide_escalate_days as days
    from public.org_settings s order by s.org_id
  loop
    -- One run at a time per organisation: a late run and the next cannot both send.
    perform pg_advisory_xact_lock(hashtext('client_work_alerts:' || v_org.org_id::text));
    v_owner := app.org_owner_id(v_org.org_id);

    -- Q12 (b), cycle ready: running cycles (the period has begun and not ended) of open or in-progress
    -- projects of Active clients whose notice was armed (made by the 00:00 schedule, by a carry not the
    -- Admin's own, or given their item list) and not yet sent since, from the first 08:00 IST after the
    -- arming: the client's Admin, one combined cycle_generated per Admin per run (actionable), no actor.
    for v_group in
      select cl.admin_id,
             count(*) as n,
             min(c.label) as first_label, max(c.label) as last_label,
             string_agg(p.name || ' (' || cl.name || ')', ', ' order by cl.name, p.name, c.id) as projects,
             min(app.project_link(p)) as link, min(p.id::text)::uuid as project_id,
             array_agg(c.id order by c.id) as ids,
             array_agg(c.period_start order by c.id) as dates,
             array_agg(c.ready_armed_at order by c.id) as answers
      from public.project_cycles c
      join public.projects p on p.id = c.project_id
      join public.clients cl on cl.id = p.client_id
      where c.org_id = v_org.org_id and c.ready_armed_at is not null
        and c.period_start <= v_today and c.period_end >= v_today
        and p.state in ('open', 'in_progress') and cl.state = 'active' and cl.admin_id is not null
        and p_now >= app.client_work_morning(c.ready_armed_at)
        and not exists (select 1 from public.client_work_alerts a
                        where a.kind = 'cycle_generated' and a.entity_id = c.id and a.sent_at >= c.ready_armed_at)
      group by cl.admin_id
      order by cl.admin_id
    loop
      begin
        v_sent := app.notify(array[v_group.admin_id], 'cycle_generated',
          case
            when v_group.n = 1 then format('%s is ready: %s', v_group.first_label, v_group.projects)
            when v_group.first_label = v_group.last_label then format('%s is ready for %s projects', v_group.first_label, v_group.n)
            else format('New cycles are ready for %s projects', v_group.n)
          end,
          case when v_group.n = 1 then 'Rename this period''s items where needed.'
               else v_group.projects || '. Rename this period''s items where needed.' end,
          case when v_group.n = 1 then v_group.link else '/today' end,
          case when v_group.n = 1 then 'projects' end,
          case when v_group.n = 1 then v_group.project_id end,
          jsonb_build_object('cycles', v_group.n), null);
        if v_sent > 0 then
          insert into public.client_work_alerts (org_id, kind, entity_id, armed_for, sent_at, recipient_id, answers_at)
          select v_org.org_id, 'cycle_generated', x.id, x.d, p_now, v_group.admin_id, x.b
          from unnest(v_group.ids, v_group.dates, v_group.answers) as x(id, d, b);
          v_count := v_count + v_sent;
        end if;
      exception when others then
        raise warning 'client_work_alerts: cycle ready for Admin % skipped: %', v_group.admin_id, sqlerrm;
      end;
    end loop;

    -- E1, the notice: overdue items whose recipient (the client's Admin; the Owner for a client with no
    -- Admin, Q9) has no notice for this planned date counting for them (sent at or after the basis), from
    -- the first 08:00 IST after due_from (Q10; the later of the basis and the item's last arming, M1: the
    -- arming decides only when, so a date moved back to one already noticed is not told again); one row
    -- per recipient, each answering its item's basis.
    for v_group in
      select o.recipient,
             count(*) as n,
             count(distinct o.project_id) as projects,
             min(o.project_id::text)::uuid as project_id,
             min(o.link) as link,
             array_agg(o.id order by o.planned_date, o.project, o.title, o.id) as ids,
             array_agg(o.planned_date order by o.planned_date, o.project, o.title, o.id) as dates,
             array_agg(o.basis order by o.planned_date, o.project, o.title, o.id) as answers,
             array_agg(format('%s (%s · %s, %s)', o.title, o.project, o.client, app.notify_date(o.planned_date))
                       order by o.planned_date, o.project, o.title, o.id) as lines,
             min(o.title) as title, min(o.project) as project, min(o.client) as client, min(o.planned_date) as planned
      from (select x.*, coalesce(x.admin_id, v_owner) as recipient
            from app.client_items_overdue_due(v_org.org_id, v_today) x) o
      where o.recipient is not null
        and p_now >= app.client_work_morning(o.due_from)
        and not exists (select 1 from public.client_work_alerts a
                        where a.kind = 'item_overdue' and a.entity_id = o.id and a.armed_for = o.planned_date
                          and a.sent_at >= o.basis and coalesce(a.recipient_id, o.recipient) = o.recipient)
      group by o.recipient
      order by o.recipient
    loop
      begin
        v_sent := app.notify(array[v_group.recipient], 'reminder_item_overdue',
          case when v_group.n = 1 then format('Overdue: %s', v_group.title)
               else format('%s client items overdue', v_group.n) end,
          case when v_group.n = 1
               then format('%s · %s. Planned for %s.', v_group.project, v_group.client, app.notify_date(v_group.planned))
               else app.client_work_alert_lines(v_group.lines) || '.' end,
          case when v_group.projects = 1 then v_group.link else app.client_items_overdue_link() end,
          case when v_group.projects = 1 then 'projects' end,
          case when v_group.projects = 1 then v_group.project_id end,
          jsonb_build_object('items', v_group.n), null);
        if v_sent > 0 then
          insert into public.client_work_alerts (org_id, kind, entity_id, armed_for, sent_at, recipient_id, answers_at)
          select v_org.org_id, 'item_overdue', x.id, x.d, p_now, v_group.recipient, x.b
          from unnest(v_group.ids, v_group.dates, v_group.answers) as x(id, d, b);
          v_count := v_count + v_sent;
        end if;
      exception when others then
        raise warning 'client_work_alerts: overdue notice for % skipped: %', v_group.recipient, sqlerrm;
      end;
    end loop;

    -- E1, then the Owner: items of a client with an Admin, still open and overdue, whose notice to that
    -- Admin counts and has had no escalation yet, from the first 08:00 IST at least
    -- item_overdue_escalate_hours after it (an hour's grace for the run after 08:00); one escalation per
    -- Admin, naming the Admin who was told (Q11). Never for a client with no Admin (Q9); none without
    -- an active Owner (L2). A date moved back to one already noticed finds that notice and its
    -- escalation still counting: nothing again.
    for v_group in
      select o.admin_id, m.full_name as admin_name,
             count(*) as n,
             array_agg(o.id order by o.planned_date, o.project, o.title, o.id) as ids,
             array_agg(o.planned_date order by o.planned_date, o.project, o.title, o.id) as dates,
             array_agg(n.told order by o.planned_date, o.project, o.title, o.id) as answers,
             array_agg(format('%s (%s · %s, %s)', o.title, o.project, o.client, app.notify_date(o.planned_date))
                       order by o.planned_date, o.project, o.title, o.id) as lines
      from app.client_items_overdue_due(v_org.org_id, v_today) o
      join public.members m on m.id = o.admin_id
      cross join lateral (
        select max(a.sent_at) as told from public.client_work_alerts a
        where a.kind = 'item_overdue' and a.entity_id = o.id and a.armed_for = o.planned_date
          and a.sent_at >= o.basis and coalesce(a.recipient_id, o.admin_id) = o.admin_id) n
      where v_owner is not null and n.told is not null
        and p_now >= app.client_work_morning(n.told + make_interval(hours => v_org.hours) - interval '1 hour')
        and not exists (select 1 from public.client_work_alerts a
                        where a.kind = 'item_overdue_escalation' and a.entity_id = o.id
                          and a.armed_for = o.planned_date and a.sent_at >= n.told)
      group by o.admin_id, m.full_name
      order by o.admin_id
    loop
      begin
        v_sent := app.notify(array[v_owner], 'escalation_item_overdue',
          case when v_group.n = 1 then format('%s has a client item overdue', v_group.admin_name)
               else format('%s has %s client items overdue', v_group.admin_name, v_group.n) end,
          app.client_work_alert_lines(v_group.lines)
            || format('. Still not done %s h after %s was told.', v_org.hours, v_group.admin_name),
          app.client_items_overdue_link(), null, null,
          jsonb_build_object('items', v_group.n, 'admin_id', v_group.admin_id), null, 1);
        if v_sent > 0 then
          insert into public.client_work_alerts (org_id, kind, entity_id, armed_for, sent_at, recipient_id, answers_at)
          select v_org.org_id, 'item_overdue_escalation', x.id, x.d, p_now, v_group.admin_id, x.b
          from unnest(v_group.ids, v_group.dates, v_group.answers) as x(id, d, b);
          v_count := v_count + v_sent;
        end if;
      exception when others then
        raise warning 'client_work_alerts: overdue escalation for Admin % skipped: %', v_group.admin_id, sqlerrm;
      end;
    end loop;

    -- E2, a fresh notice (Q8, Q11): a prompted, ended cycle whose undecided items include one back to
    -- open since the Admin was last told, or whose client's Admin changed since: the client's Admin,
    -- from the first 08:00 IST after the earliest such moment; one items_to_decide per Admin per run.
    -- L1: not for an Admin whom the 08:05 prompt reaches this morning (a newly ended cycle of theirs not
    -- yet prompted, the prompt's own condition): the prompt lists these cycles too and records the
    -- fresh notices, so the Admin gets one items_to_decide that morning.
    for v_group in
      select d.admin_id,
             count(*) as cycles,
             sum(d.undecided)::integer as items,
             count(distinct d.project_id) as projects,
             min(d.project_id::text)::uuid as project_id,
             min(d.link) as link,
             array_agg(d.cycle_id order by d.period_end, d.project, d.cycle_id) as ids,
             array_agg(d.period_end order by d.period_end, d.project, d.cycle_id) as dates,
             array_agg(d.due_at order by d.period_end, d.project, d.cycle_id) as answers,
             array_agg(format('%s (%s) · %s: %s', d.project, d.client, d.label, d.undecided)
                       order by d.period_end, d.project, d.cycle_id) as lines
      from app.cycle_undecided_due(v_org.org_id) d
      where d.due_at is not null and d.period_end < v_today
        and p_now >= app.client_work_morning(d.due_at)
        and not exists (
          select 1 from public.project_cycles c
          join public.projects p on p.id = c.project_id
          join public.clients cl on cl.id = p.client_id
          where c.org_id = v_org.org_id and c.state = 'open' and c.prompted_at is null
            and c.period_end is not null and c.period_end < v_today
            and p.state in ('open', 'in_progress') and app.cycle_close_prompt_recipient(cl) = d.admin_id
            and exists (select 1 from public.project_items i
                        where i.cycle_id = c.id and i.state = 'open' and i.carry_decision is null))
      group by d.admin_id
      order by d.admin_id
    loop
      begin
        v_sent := app.notify(array[v_group.admin_id], 'items_to_decide',
          format('%s unfinished %s to decide', v_group.items, case when v_group.items = 1 then 'item' else 'items' end),
          app.client_work_alert_lines(v_group.lines) || '.',
          case when v_group.projects = 1 then v_group.link else '/today' end,
          case when v_group.projects = 1 then 'projects' end,
          case when v_group.projects = 1 then v_group.project_id end,
          jsonb_build_object('items', v_group.items, 'cycles', v_group.cycles), null);
        if v_sent > 0 then
          insert into public.client_work_alerts (org_id, kind, entity_id, armed_for, sent_at, recipient_id, answers_at)
          select v_org.org_id, 'cycle_undecided_notice', x.id, x.d, p_now, v_group.admin_id, x.b
          from unnest(v_group.ids, v_group.dates, v_group.answers) as x(id, d, b);
          v_count := v_count + v_sent;
        end if;
      exception when others then
        raise warning 'client_work_alerts: cycle notice for Admin % skipped: %', v_group.admin_id, sqlerrm;
      end;
    end loop;

    -- E2, the escalation: those cycles, with no item back to open and no Admin change since the Admin
    -- was last told, at the first 08:00 IST at least cycle_decide_escalate_days after both the period's
    -- end and that notice (an hour's grace for the run after 08:00), not yet escalated since it; one
    -- escalation per Admin; none without an active Owner (L2).
    for v_group in
      select d.admin_id, m.full_name as admin_name,
             count(*) as n,
             count(distinct d.project_id) as projects,
             min(d.project_id::text)::uuid as project_id,
             min(d.link) as link,
             array_agg(d.cycle_id order by d.period_end, d.project, d.cycle_id) as ids,
             array_agg(d.period_end order by d.period_end, d.project, d.cycle_id) as dates,
             array_agg(d.told order by d.period_end, d.project, d.cycle_id) as answers,
             array_agg(format('%s (%s) · %s: %s undecided', d.project, d.client, d.label, d.undecided)
                       order by d.period_end, d.project, d.cycle_id) as lines,
             min(d.label) as label, min(d.project) as project
      from app.cycle_undecided_due(v_org.org_id) d
      join public.members m on m.id = d.admin_id
      where v_owner is not null and d.due_at is null
        and p_now >= app.client_work_morning(
                       greatest(((d.period_end + 1)::timestamp at time zone 'Asia/Kolkata'), d.told)
                       + make_interval(days => v_org.days) - interval '1 hour')
        and not exists (select 1 from public.client_work_alerts a
                        where a.kind = 'cycle_undecided_escalation' and a.entity_id = d.cycle_id
                          and a.armed_for = d.period_end and a.sent_at >= d.told)
      group by d.admin_id, m.full_name
      order by d.admin_id
    loop
      begin
        v_sent := app.notify(array[v_owner], 'escalation_cycle_undecided',
          case when v_group.n = 1 then format('%s has not decided %s · %s', v_group.admin_name, v_group.label, v_group.project)
               else format('%s has not decided %s ended cycles', v_group.admin_name, v_group.n) end,
          app.client_work_alert_lines(v_group.lines)
            || format('. Unfinished items still undecided %s %s after the period ended.',
                      v_org.days, case when v_org.days = 1 then 'day' else 'days' end),
          case when v_group.projects = 1 then v_group.link else '/clients' end,
          case when v_group.projects = 1 then 'projects' end,
          case when v_group.projects = 1 then v_group.project_id end,
          jsonb_build_object('cycles', v_group.n, 'admin_id', v_group.admin_id), null, 1);
        if v_sent > 0 then
          insert into public.client_work_alerts (org_id, kind, entity_id, armed_for, sent_at, recipient_id, answers_at)
          select v_org.org_id, 'cycle_undecided_escalation', x.id, x.d, p_now, v_group.admin_id, x.b
          from unnest(v_group.ids, v_group.dates, v_group.answers) as x(id, d, b);
          v_count := v_count + v_sent;
        end if;
      exception when others then
        raise warning 'client_work_alerts: cycle escalation for Admin % skipped: %', v_group.admin_id, sqlerrm;
      end;
    end loop;

    -- E3: one-time projects still open or in progress at the later of 08:00 IST the morning after their
    -- delivery date and the first 08:00 IST after the project was created, its date moved or it was
    -- reopened (M1); once per delivery date (a moved date re-arms). One escalation per Admin naming
    -- them; a client with no Admin: one reminder to the Owner, no Admin named (Q9). Nothing without an
    -- active Owner (L2).
    for v_group in
      select cl.admin_id, m.full_name as admin_name,
             count(*) as n,
             min(p.id::text)::uuid as project_id,
             min(app.project_link(p)) as link,
             array_agg(p.id order by p.delivery_date, p.name, p.id) as ids,
             array_agg(p.delivery_date order by p.delivery_date, p.name, p.id) as dates,
             array_agg(((p.delivery_date + 1)::timestamp + time '08:00') at time zone 'Asia/Kolkata'
                       order by p.delivery_date, p.name, p.id) as answers,
             array_agg(format('%s (%s, due %s)', p.name, cl.name, app.notify_date(p.delivery_date))
                       order by p.delivery_date, p.name, p.id) as lines,
             min(p.name) as project, min(cl.name) as client, min(p.delivery_date) as due
      from public.projects p
      join public.clients cl on cl.id = p.client_id
      left join public.members m on m.id = cl.admin_id
      where v_owner is not null
        and p.org_id = v_org.org_id and p.recurrence = 'one_time' and p.state in ('open', 'in_progress')
        and p.delivery_date is not null
        and p_now >= greatest(((p.delivery_date + 1)::timestamp + time '08:00') at time zone 'Asia/Kolkata',
                              app.client_work_morning(p.delivery_armed_at))
        and not exists (select 1 from public.client_work_alerts a
                        where a.kind = 'delivery_escalation' and a.entity_id = p.id and a.armed_for = p.delivery_date)
      group by cl.admin_id, m.full_name
      order by cl.admin_id nulls first
    loop
      begin
        if v_group.admin_id is null then
          v_sent := app.notify(array[v_owner], 'reminder_delivery_missed',
            case when v_group.n = 1 then format('Past delivery: %s', v_group.project)
                 else format('%s one-time projects past delivery', v_group.n) end,
            case when v_group.n = 1
                 then format('%s. Due %s, not completed.', v_group.client, app.notify_date(v_group.due))
                 else app.client_work_alert_lines(v_group.lines) || '. Not completed.' end,
            case when v_group.n = 1 then v_group.link else '/clients' end,
            case when v_group.n = 1 then 'projects' end,
            case when v_group.n = 1 then v_group.project_id end,
            jsonb_build_object('projects', v_group.n), null);
        else
          v_sent := app.notify(array[v_owner], 'escalation_delivery_missed',
            case when v_group.n = 1 then format('Past delivery: %s · %s', v_group.project, v_group.admin_name)
                 else format('%s one-time projects past delivery · %s', v_group.n, v_group.admin_name) end,
            case when v_group.n = 1
                 then format('%s. Due %s, not completed. %s runs it.', v_group.client, app.notify_date(v_group.due), v_group.admin_name)
                 else app.client_work_alert_lines(v_group.lines) || format('. Not completed. %s runs them.', v_group.admin_name) end,
            case when v_group.n = 1 then v_group.link else '/clients' end,
            case when v_group.n = 1 then 'projects' end,
            case when v_group.n = 1 then v_group.project_id end,
            jsonb_build_object('projects', v_group.n, 'admin_id', v_group.admin_id), null, 1);
        end if;
        if v_sent > 0 then
          insert into public.client_work_alerts (org_id, kind, entity_id, armed_for, sent_at, recipient_id, answers_at)
          select v_org.org_id, 'delivery_escalation', x.id, x.d, p_now, coalesce(v_group.admin_id, v_owner), x.b
          from unnest(v_group.ids, v_group.dates, v_group.answers) as x(id, d, b);
          v_count := v_count + v_sent;
        end if;
      exception when others then
        raise warning 'client_work_alerts: delivery escalation for Admin % skipped: %', v_group.admin_id, sqlerrm;
      end;
    end loop;
  end loop;
  return v_count;
end;
$$;

comment on function app.client_work_alerts(timestamptz) is
  'Kickoff 7 amendment C E1-E3 with the Q8-Q11 answers, the 7A review of d9caeab, the owner''s E1 rule '
  'and the timing answers Q12-Q13 (WORKFLOWS §5.4 item 21, §8, §9): pg_cron every 5 minutes, read '
  'committed only, sending only in the morning window, 08:00 to before 08:30 IST '
  '(app.client_work_send_window, Q13): a run outside it sends nothing, and the next morning''s run sends '
  'what still holds. Per organisation under an advisory lock, each (kind, recipient) in a savepoint of '
  'its own (a failure or a duplicate answer is a WARNING). (Q12) running cycles whose "cycle ready" '
  'notice was armed (project_cycles.ready_armed_at: made by the 00:00 schedule, by a carry not the '
  'Admin''s own, or given their item list) -> their client''s Admin, one combined cycle_generated per '
  'Admin per run (actionable), once per arming. (E1) overdue items (app.client_items_overdue_due) -> '
  'their client''s Admin, or the Owner for a client with no Admin (Q9), one reminder_item_overdue per '
  'recipient per run (always emailed), once per item and planned date: a notice counts while sent to the '
  'current recipient at or after the basis, the latest of the overdue moment, the item''s last return to '
  'open (Q8) and its client''s last Admin change (Q11); a new one goes at the first 08:00 IST after '
  'due_from, the later of the basis and the item''s last arming (an insert, a date change, M1), so moving '
  'to a new date re-arms and moving back to a date already noticed does not; then, still open, the '
  'Owner, one escalation_item_overdue per Admin naming the Admin who was told, from the first 08:00 IST '
  'at least item_overdue_escalate_hours after that notice, once per notice (never for a client with no '
  'Admin). (E2) prompted ended cycles with an undecided item back to open (Q8) or a new Admin (Q11) since '
  'the Admin was last told -> the Admin, one items_to_decide per Admin per run, from the next 08:00 IST, '
  'unless the 08:05 prompt reaches them that morning (it records these notices, L1); otherwise, at the '
  'first 08:00 IST at least cycle_decide_escalate_days after both the period end and the last notice -> '
  'the Owner, one escalation_cycle_undecided per Admin, once per notice. (E3) one-time projects still '
  'open or in progress at the later of 08:00 IST after their delivery date and the first 08:00 IST after '
  'the project''s last arming (creation, a date change, a reopen; M1) -> the Owner, one '
  'escalation_delivery_missed per Admin, or one reminder_delivery_missed for clients with no Admin (Q9); '
  'once per delivery date. Escalations are always emailed with escalation_level 1; no actor; never an '
  'amount; none without an active Owner. A send is recorded (client_work_alerts, one row per item, cycle '
  'or project with recipient_id and answers_at) only when app.notify() wrote it (L2). Returns the '
  'notifications written.';

-- Q13. The prompt, only in the morning window ------------------------------------------------------------------
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
  v_sent integer;
  v_count integer := 0;
begin
  -- Q13 (a): prompts only in the morning window (08:00 to before 08:30 IST; the job runs at 08:05). A
  -- run outside it marks nothing prompted, so the next morning's run prompts what is still undecided.
  if not app.client_work_send_window(p_now) then
    return 0;
  end if;

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
      -- fails is logged and prompted the next morning (prompted_at stays null), never costing the
      -- others theirs.
      begin
        v_sent := app.notify(array[v_admin.recipient], 'items_to_decide',
          format('%s unfinished %s to decide', v_admin.items, case when v_admin.items = 1 then 'item' else 'items' end),
          v_admin.lines || case when v_admin.pending > 0
            then format('. %s left pending, listed again.', v_admin.pending) else '.' end,
          case when v_admin.projects = 1 then v_admin.link else '/today' end,
          case when v_admin.projects = 1 then 'projects' end,
          case when v_admin.projects = 1 then v_admin.project_id::uuid end,
          jsonb_build_object('items', v_admin.items, 'pending', v_admin.pending), null);
        -- The 7A review's L1: the prompt lists every undecided item, so it is the Admin's fresh E2
        -- notice for each earlier cycle that had one due (an item back to open or a new Admin since
        -- they were last told): recorded, so client_work_alerts sends no second items_to_decide. An
        -- answer the job already recorded is kept as it is (never costs the Admin the prompt).
        if v_sent > 0 then
          insert into public.client_work_alerts (org_id, kind, entity_id, armed_for, sent_at, recipient_id, answers_at)
          select v_org, 'cycle_undecided_notice', d.cycle_id, d.period_end, p_now, v_admin.recipient, d.due_at
          from app.cycle_undecided_due(v_org) d
          where d.admin_id = v_admin.recipient and d.due_at is not null and d.due_at <= p_now
            and d.period_end < v_today
          on conflict do nothing;
        end if;
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
  '7.2 (WORKFLOWS §8 / §9; issue #56 Q2, owner 2026-10-08; 7A review S1, L1; the review of d9caeab L1; '
  'amendment C timing answer Q13 (a), advisor 2026-10-08): pg_cron at 08:05 IST (02:35 UTC) every day; '
  'it prompts only in the morning window, 08:00 to before 08:30 IST (app.client_work_send_window): a run '
  'outside it marks nothing and the next morning''s run prompts what is still undecided. Per organisation '
  'under an advisory lock: an Admin is prompted when a cycle of their clients'' open or in-progress '
  'projects has ended before the run''s IST date, holds open items with no carry decision and was not '
  'prompted yet (prompted_at). The prompt, one items_to_decide row per Admin per run (the client''s Admin '
  'only, app.cycle_close_prompt_recipient; actionable, no actor), then counts and lists every undecided '
  'open item of every ended cycle of those projects and the items they left pending, each project and '
  'cycle with its count; it is also the Admin''s fresh E2 notice for every earlier cycle that had one due '
  '(recorded as cycle_undecided_notice in client_work_alerts, so that morning brings one '
  'items_to_decide); the new cycles are marked prompted_at (audited ''prompted''), each Admin in a '
  'savepoint of their own (one that fails is a WARNING, prompted the next morning). Done items are not '
  'counted (they wait for approval). Returns the rows written. Idempotent: a re-run with nothing newly '
  'ended is quiet.';

-- Q12 (b). Cycles are made at 00:00 IST again (cron.schedule replaces the job of the same name) ---------------
select cron.schedule('cycle_generate', '30 18 * * *', $$select app.cycle_generate()$$);
