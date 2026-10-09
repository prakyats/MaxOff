-- Kickoff 7 amendment C, escalations E1-E5 (owner decisions 2026-10-08, given directly by the owner;
--   PROGRESS "Amendment C, escalations (E1-E5)", WORKFLOWS §8 / §9, PRODUCT §4.7 / §4.16, PERMISSIONS
--   settings.manage). The owner's framing: Admins run client work end to end; the Owner creates
--   clients and handles revenue; Admins stay accountable to the Owner through escalations.
--
-- E1  An open client item past its planned date (decision 10: planned date before today IST, still
--     open): its client's Admin is told first (reminder_item_overdue, always emailed as a task's
--     overdue reminder; one row per Admin per run listing their newly overdue items). Once it has
--     been overdue org_settings.item_overdue_escalate_hours (default 24) after that notice, and is
--     still open, the Owner gets ONE escalation per Admin per run naming the Admin
--     (escalation_item_overdue). Each item once per planned date: moving the date re-arms it.
-- E2  An ended cycle whose undecided items (open, no carry decision) are still undecided
--     org_settings.cycle_decide_escalate_days (default 2) days after its period ended (and after the
--     Admin's 00:05 prompt): the Owner, naming the Admin (escalation_cycle_undecided), once per cycle;
--     one row per Admin per run.
-- E3  A one-time project still open or in progress after its delivery date: the Owner, naming the
--     client's Admin, at 08:00 IST the morning after (escalation_delivery_missed); once per delivery
--     date, re-armed when the date moves; one row per Admin per run.
-- E4  (7.4 builds the digest per Admin.) What the end-of-day report needs is in place: done_at /
--     done_by, approved_at / approved_by, projects.completed_at / completed_by, the history's done,
--     approved and completed entries, and client_admin_assignments for who ran a client on a day;
--     three partial indexes for the per-day reads.
-- E5  org_settings.item_overdue_escalate_hours (1..168, default 24) and
--     org_settings.cycle_decide_escalate_days (1..30, default 2): Owner-only (settings.manage, the
--     existing UPDATE policy) in the API UPDATE grant; Settings -> Thresholds is 7B's.
--
-- Escalations follow 5B's email policy: always emailed, escalation_level 1 (the per-person cap is
-- bypassed); quiet hours hold their push only. No actor (a job). Never an amount. Run by
-- app.client_work_alerts(), pg_cron every 5 minutes (as reminders_tick): per organisation under an
-- advisory lock, each (kind, Admin) in a savepoint of its own; idempotent through
-- client_work_alerts' unique (kind, entity_id, armed_for); a missed run sends late on the next one
-- while the condition still holds (escalations go late, owner 2026-10-06).
--
-- EXPAND-ONLY: two columns with defaults, one table, notification kinds, functions, indexes and one
-- pg_cron job. Append-only: never edit once applied.

-- E5. The thresholds -------------------------------------------------------------------------------------
alter table public.org_settings
  add column item_overdue_escalate_hours integer not null default 24
    check (item_overdue_escalate_hours between 1 and 168),
  add column cycle_decide_escalate_days integer not null default 2
    check (cycle_decide_escalate_days between 1 and 30);
comment on column public.org_settings.item_overdue_escalate_hours is
  'Kickoff 7 amendment C E1/E5 (owner 2026-10-08): hours an open client item may stay overdue after '
  'its Admin was told before the Owner gets an escalation naming the Admin. 1..168, default 24. '
  'settings.manage (Settings -> Thresholds, 7B).';
comment on column public.org_settings.cycle_decide_escalate_days is
  'Kickoff 7 amendment C E2/E5 (owner 2026-10-08): days after a cycle''s period ended (and its '
  'Admin''s prompt) before undecided items escalate to the Owner, naming the Admin. 1..30, default 2. '
  'settings.manage (Settings -> Thresholds, 7B).';
grant update (item_overdue_escalate_hours, cycle_decide_escalate_days) on public.org_settings to authenticated;

-- The record of what was sent ------------------------------------------------------------------------------
create table public.client_work_alerts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id),
  kind text not null check (kind in ('item_overdue', 'item_overdue_escalation', 'cycle_undecided_escalation',
                                     'delivery_escalation')),
  entity_id uuid not null,
  armed_for date not null,
  sent_at timestamptz not null,
  constraint client_work_alerts_once unique (kind, entity_id, armed_for)
);
comment on table public.client_work_alerts is
  'Kickoff 7 amendment C E1-E3: one row per client-work notice or escalation sent, so each goes once '
  'per item and planned date (item_overdue, item_overdue_escalation), per cycle and period end '
  '(cycle_undecided_escalation) or per project and delivery date (delivery_escalation): a moved date '
  're-arms it. entity_id: the item, the cycle or the project. Written by app.client_work_alerts() '
  'only; the notifications are the visible record, so no API access at all (RLS on, no policy). '
  'Never deleted.';
create index client_work_alerts_org_idx on public.client_work_alerts (org_id, sent_at);

alter table public.client_work_alerts enable row level security;
revoke all on public.client_work_alerts from anon, authenticated;

-- Notification kinds (WORKFLOWS §9) ------------------------------------------------------------------------
insert into public.notification_kinds (kind, actionable, always_email, in_app, description) values
  ('reminder_item_overdue',      false, true, true, 'Client items you run are past their planned date (the client''s Admin; always emailed, as a task''s overdue reminder)'),
  ('escalation_item_overdue',    false, true, true, 'An Admin''s client items are still overdue past the threshold (the Owner; escalation)'),
  ('escalation_cycle_undecided', false, true, true, 'An Admin has not decided an ended cycle''s unfinished items (the Owner; escalation)'),
  ('escalation_delivery_missed', false, true, true, 'A one-time project is past its delivery date and not completed (the Owner; escalation)');

-- The cross-client item list, overdue (7.3's route; the one place to change it) ------------------------------
create function app.client_items_overdue_link()
returns text
language sql
immutable
set search_path = ''
as $$
  select '/clients/items?filter=overdue';
$$;

revoke all on function app.client_items_overdue_link() from public, authenticated;
grant execute on function app.client_items_overdue_link() to service_role;

comment on function app.client_items_overdue_link() is
  'Internal (amendment C E1): the cross-client item list filtered to overdue (7.3 builds it; the '
  'Owner''s view groups it by Admin), the link of the overdue notices that span several projects.';

-- E4. The end-of-day report's per-day reads (7.4) --------------------------------------------------------------
create index project_items_org_done_at_idx on public.project_items (org_id, done_at) where done_at is not null;
create index project_items_org_approved_at_idx on public.project_items (org_id, approved_at) where approved_at is not null;
create index projects_org_completed_at_idx on public.projects (org_id, completed_at) where completed_at is not null;

-- The job ---------------------------------------------------------------------------------------------------------
-- "a; b; c" for at most ten lines, then "+N more".
create function app.client_work_alert_lines(p_lines text[])
returns text
language sql
immutable
set search_path = ''
as $$
  select array_to_string(p_lines[1:10], '; ')
         || case when cardinality(p_lines) > 10 then format('; +%s more', cardinality(p_lines) - 10) else '' end;
$$;

revoke all on function app.client_work_alert_lines(text[]) from public, authenticated;
grant execute on function app.client_work_alert_lines(text[]) to service_role;

comment on function app.client_work_alert_lines(text[]) is
  'Internal (amendment C E1-E3): a notification body''s list, at most ten lines, then "+N more".';

create function app.client_work_alerts(p_now timestamptz default now())
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
  v_count integer := 0;
begin
  for v_org in
    select s.org_id, s.item_overdue_escalate_hours as hours, s.cycle_decide_escalate_days as days
    from public.org_settings s order by s.org_id
  loop
    -- One run at a time per organisation: a late run and the next cannot both send.
    perform pg_advisory_xact_lock(hashtext('client_work_alerts:' || v_org.org_id::text));
    v_owner := app.org_owner_id(v_org.org_id);

    -- E1, the Admin first: their items newly overdue (planned date before today IST, still open, the
    -- project open or in progress), one row per Admin. A client with no Admin (a draft the Owner
    -- runs) gives none, and so never escalates.
    for v_group in
      select cl.admin_id,
             count(*) as n,
             count(distinct p.id) as projects,
             min(p.id::text)::uuid as project_id,
             min(app.project_link(p)) as link,
             array_agg(i.id order by i.planned_date, p.name, i.title, i.id) as ids,
             array_agg(i.planned_date order by i.planned_date, p.name, i.title, i.id) as dates,
             array_agg(format('%s (%s · %s, %s)', i.title, p.name, cl.name, app.notify_date(i.planned_date))
                       order by i.planned_date, p.name, i.title, i.id) as lines,
             min(i.title) as title, min(p.name) as project, min(cl.name) as client, min(i.planned_date) as planned
      from public.project_items i
      join public.projects p on p.id = i.project_id
      join public.clients cl on cl.id = p.client_id
      where i.org_id = v_org.org_id and i.state = 'open' and i.planned_date < v_today
        and p.state in ('open', 'in_progress') and cl.admin_id is not null
        and not exists (select 1 from public.client_work_alerts a
                        where a.kind = 'item_overdue' and a.entity_id = i.id and a.armed_for = i.planned_date)
      group by cl.admin_id
      order by cl.admin_id
    loop
      begin
        perform app.notify(array[v_group.admin_id], 'reminder_item_overdue',
          case when v_group.n = 1 then format('Overdue: %s', v_group.title)
               else format('%s client items overdue', v_group.n) end,
          case when v_group.n = 1
               then format('%s · %s. Planned for %s.', v_group.project, v_group.client, app.notify_date(v_group.planned))
               else app.client_work_alert_lines(v_group.lines) || '.' end,
          case when v_group.projects = 1 then v_group.link else app.client_items_overdue_link() end,
          case when v_group.projects = 1 then 'projects' end,
          case when v_group.projects = 1 then v_group.project_id end,
          jsonb_build_object('items', v_group.n), null);
        insert into public.client_work_alerts (org_id, kind, entity_id, armed_for, sent_at)
        select v_org.org_id, 'item_overdue', x.id, x.d, p_now
        from unnest(v_group.ids, v_group.dates) as x(id, d);
        v_count := v_count + 1;
      exception when others then
        raise warning 'client_work_alerts: overdue notice for Admin % skipped: %', v_group.admin_id, sqlerrm;
      end;
    end loop;

    -- E1, then the Owner: items still open and overdue item_overdue_escalate_hours after both the
    -- moment they became overdue (00:00 IST after the planned date) and their Admin's notice; one
    -- escalation per Admin, naming them.
    for v_group in
      select cl.admin_id, m.full_name as admin_name,
             count(*) as n,
             array_agg(i.id order by i.planned_date, p.name, i.title, i.id) as ids,
             array_agg(i.planned_date order by i.planned_date, p.name, i.title, i.id) as dates,
             array_agg(format('%s (%s · %s, %s)', i.title, p.name, cl.name, app.notify_date(i.planned_date))
                       order by i.planned_date, p.name, i.title, i.id) as lines
      from public.project_items i
      join public.projects p on p.id = i.project_id
      join public.clients cl on cl.id = p.client_id
      join public.members m on m.id = cl.admin_id
      join public.client_work_alerts n
        on n.kind = 'item_overdue' and n.entity_id = i.id and n.armed_for = i.planned_date
      where i.org_id = v_org.org_id and i.state = 'open' and i.planned_date < v_today
        and p.state in ('open', 'in_progress')
        and p_now >= greatest(((i.planned_date + 1)::timestamp at time zone 'Asia/Kolkata'), n.sent_at)
                     + make_interval(hours => v_org.hours)
        and not exists (select 1 from public.client_work_alerts a
                        where a.kind = 'item_overdue_escalation' and a.entity_id = i.id and a.armed_for = i.planned_date)
      group by cl.admin_id, m.full_name
      order by cl.admin_id
    loop
      begin
        perform app.notify(array[v_owner], 'escalation_item_overdue',
          case when v_group.n = 1 then format('%s has a client item overdue', v_group.admin_name)
               else format('%s has %s client items overdue', v_group.admin_name, v_group.n) end,
          app.client_work_alert_lines(v_group.lines)
            || format('. Still not done %s h after %s was told.', v_org.hours, v_group.admin_name),
          app.client_items_overdue_link(), null, null,
          jsonb_build_object('items', v_group.n, 'admin_id', v_group.admin_id), null, 1);
        insert into public.client_work_alerts (org_id, kind, entity_id, armed_for, sent_at)
        select v_org.org_id, 'item_overdue_escalation', x.id, x.d, p_now
        from unnest(v_group.ids, v_group.dates) as x(id, d);
        v_count := v_count + 1;
      exception when others then
        raise warning 'client_work_alerts: overdue escalation for Admin % skipped: %', v_group.admin_id, sqlerrm;
      end;
    end loop;

    -- E2: ended cycles of open or in-progress projects still holding undecided items (open, no carry
    -- decision) cycle_decide_escalate_days after both the period's end and the Admin's prompt; once
    -- per cycle, one escalation per Admin.
    for v_group in
      select cl.admin_id, m.full_name as admin_name,
             count(*) as n,
             count(distinct p.id) as projects,
             min(p.id::text)::uuid as project_id,
             min(app.project_link(p)) as link,
             array_agg(c.id order by c.period_end, p.name, c.id) as ids,
             array_agg(c.period_end order by c.period_end, p.name, c.id) as dates,
             array_agg(format('%s (%s) · %s: %s undecided', p.name, cl.name, c.label, u.n)
                       order by c.period_end, p.name, c.id) as lines,
             min(c.label) as label, min(p.name) as project
      from public.project_cycles c
      join public.projects p on p.id = c.project_id
      join public.clients cl on cl.id = p.client_id
      join public.members m on m.id = cl.admin_id
      cross join lateral (
        select count(*) as n from public.project_items i
        where i.cycle_id = c.id and i.state = 'open' and i.carry_decision is null) u
      where c.org_id = v_org.org_id and c.period_end is not null and c.prompted_at is not null
        and p.state in ('open', 'in_progress') and u.n > 0
        and p_now >= greatest(((c.period_end + 1)::timestamp at time zone 'Asia/Kolkata'), c.prompted_at)
                     + make_interval(days => v_org.days)
        and not exists (select 1 from public.client_work_alerts a
                        where a.kind = 'cycle_undecided_escalation' and a.entity_id = c.id and a.armed_for = c.period_end)
      group by cl.admin_id, m.full_name
      order by cl.admin_id
    loop
      begin
        perform app.notify(array[v_owner], 'escalation_cycle_undecided',
          case when v_group.n = 1 then format('%s has not decided %s · %s', v_group.admin_name, v_group.label, v_group.project)
               else format('%s has not decided %s ended cycles', v_group.admin_name, v_group.n) end,
          app.client_work_alert_lines(v_group.lines)
            || format('. Unfinished items still undecided %s %s after the period ended.',
                      v_org.days, case when v_org.days = 1 then 'day' else 'days' end),
          case when v_group.projects = 1 then v_group.link else '/clients' end,
          case when v_group.projects = 1 then 'projects' end,
          case when v_group.projects = 1 then v_group.project_id end,
          jsonb_build_object('cycles', v_group.n, 'admin_id', v_group.admin_id), null, 1);
        insert into public.client_work_alerts (org_id, kind, entity_id, armed_for, sent_at)
        select v_org.org_id, 'cycle_undecided_escalation', x.id, x.d, p_now
        from unnest(v_group.ids, v_group.dates) as x(id, d);
        v_count := v_count + 1;
      exception when others then
        raise warning 'client_work_alerts: cycle escalation for Admin % skipped: %', v_group.admin_id, sqlerrm;
      end;
    end loop;

    -- E3: one-time projects still open or in progress at 08:00 IST the morning after their delivery
    -- date; once per delivery date (a moved date re-arms), one escalation per Admin.
    for v_group in
      select cl.admin_id, m.full_name as admin_name,
             count(*) as n,
             min(p.id::text)::uuid as project_id,
             min(app.project_link(p)) as link,
             array_agg(p.id order by p.delivery_date, p.name, p.id) as ids,
             array_agg(p.delivery_date order by p.delivery_date, p.name, p.id) as dates,
             array_agg(format('%s (%s, due %s)', p.name, cl.name, app.notify_date(p.delivery_date))
                       order by p.delivery_date, p.name, p.id) as lines,
             min(p.name) as project, min(cl.name) as client, min(p.delivery_date) as due
      from public.projects p
      join public.clients cl on cl.id = p.client_id
      join public.members m on m.id = cl.admin_id
      where p.org_id = v_org.org_id and p.recurrence = 'one_time' and p.state in ('open', 'in_progress')
        and p.delivery_date is not null
        and p_now >= ((p.delivery_date + 1)::timestamp + time '08:00') at time zone 'Asia/Kolkata'
        and not exists (select 1 from public.client_work_alerts a
                        where a.kind = 'delivery_escalation' and a.entity_id = p.id and a.armed_for = p.delivery_date)
      group by cl.admin_id, m.full_name
      order by cl.admin_id
    loop
      begin
        perform app.notify(array[v_owner], 'escalation_delivery_missed',
          case when v_group.n = 1 then format('Past delivery: %s · %s', v_group.project, v_group.admin_name)
               else format('%s one-time projects past delivery · %s', v_group.n, v_group.admin_name) end,
          case when v_group.n = 1
               then format('%s. Due %s, not completed. %s runs it.', v_group.client, app.notify_date(v_group.due), v_group.admin_name)
               else app.client_work_alert_lines(v_group.lines) || format('. Not completed. %s runs them.', v_group.admin_name) end,
          case when v_group.n = 1 then v_group.link else '/clients' end,
          case when v_group.n = 1 then 'projects' end,
          case when v_group.n = 1 then v_group.project_id end,
          jsonb_build_object('projects', v_group.n, 'admin_id', v_group.admin_id), null, 1);
        insert into public.client_work_alerts (org_id, kind, entity_id, armed_for, sent_at)
        select v_org.org_id, 'delivery_escalation', x.id, x.d, p_now
        from unnest(v_group.ids, v_group.dates) as x(id, d);
        v_count := v_count + 1;
      exception when others then
        raise warning 'client_work_alerts: delivery escalation for Admin % skipped: %', v_group.admin_id, sqlerrm;
      end;
    end loop;
  end loop;
  return v_count;
end;
$$;

revoke all on function app.client_work_alerts(timestamptz) from public, anon, authenticated;
grant execute on function app.client_work_alerts(timestamptz) to service_role;

comment on function app.client_work_alerts(timestamptz) is
  'Kickoff 7 amendment C E1-E3 (owner 2026-10-08; WORKFLOWS §8 / §9): pg_cron every 5 minutes. Per '
  'organisation under an advisory lock: (E1) open items of open or in-progress projects whose '
  'planned date is before today IST -> their client''s Admin, one reminder_item_overdue per Admin per '
  'run (always emailed), then, item_overdue_escalate_hours after both the overdue moment (00:00 IST '
  'after the planned date) and that notice, still open -> the Owner, one escalation_item_overdue per '
  'Admin naming them (linking the cross-client overdue list); (E2) ended cycles still holding '
  'undecided open items cycle_decide_escalate_days after both the period''s end and the Admin''s '
  'prompt -> the Owner, one escalation_cycle_undecided per Admin; (E3) one-time projects still open '
  'or in progress at 08:00 IST after their delivery date -> the Owner, one '
  'escalation_delivery_missed per Admin. Escalations are always emailed with escalation_level 1; no '
  'actor; never an amount. Each sent unit is recorded in client_work_alerts (once per item and '
  'planned date, cycle, project and delivery date: a moved date re-arms); each (kind, Admin) in a '
  'savepoint of its own. A client with no Admin gives none. Returns the notifications written.';

select cron.schedule('client_work_alerts', '*/5 * * * *', $$select app.client_work_alerts()$$);
