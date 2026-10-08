-- Kickoff 7 amendment C escalation answers, Q8-Q11 (owner 2026-10-08, issue #56 and directly: "yes to
--   all four recommendations"), the owner's 08:00 rule for E2 and the nightly prompts (2026-10-08,
--   directly: "no client-work notice or escalation is ever sent around midnight"), and the 7A
--   re-review's E2 cost item. PROGRESS "Amendment C escalation answers, Q8-Q11", WORKFLOWS §5.2 item 2,
--   §5.4 item 21, §8, §9, PRODUCT §4.5.
--
-- Q8 (a)  An item back to open (sent back by the Owner or the Admin, or "Not done") after its overdue
--         notice: its client's Admin is told again and gets the full item_overdue_escalate_hours from
--         that notice before the Owner's escalation. E2 alike: an item of an ended cycle back to open
--         gives the Admin a fresh "unfinished items to decide" notice (items_to_decide) and the full
--         cycle_decide_escalate_days from it before the escalation. project_items.reopened_at records
--         the moment (set by a trigger on every return to open, so no transition can miss it).
-- Q9 (a)  A client with no Admin (a Draft the Owner runs): the Owner gets E1 (reminder_item_overdue) and
--         E3 (reminder_delivery_missed, new) as reminders about his own client, no Admin named, E1 at
--         the moment an Admin would have had the notice (no threshold); never an escalation. E2 cannot
--         arise there (a Draft has no recurring cycles) and stays skipped.
-- Q10 (a) E1 goes at 08:00 IST, like E3: the notice at 08:00 IST the day after the planned date (or the
--         first 08:00 after the item went back to open or the client's Admin changed), the Owner's
--         escalation at the first 08:00 IST at least item_overdue_escalate_hours after the notice (a
--         notice sent in the hour after 08:00 counts from 08:00: the job runs every 5 minutes).
--         Q9's reminders and Q8 / Q11's notices too.
-- 08:00   No client-work notice or escalation is ever sent around midnight (owner 2026-10-08): E2's
--         escalation goes at the first 08:00 IST at least cycle_decide_escalate_days after both the
--         period's end and the Admin's last notice (same hour's grace), its fresh notices (Q8, Q11) at
--         the first 08:00 IST after the reopening or the Admin change; the nightly jobs that notify move
--         to the morning: cycle_generate (and its cycle_generated row) 00:00 -> 08:00 IST, 02:30 UTC;
--         cycle_close_prompt (items_to_decide) 00:05 -> 08:05 IST, 02:35 UTC, still after it. Both stay
--         idempotent and read the IST date of their run, which is the same date at 08:00.
-- Q11 (a) The client's Admin changes after a notice: the new Admin is told first (at the next 08:00
--         IST) and gets their own full threshold; the escalation names the Admin who was
--         told. client_work_alerts.recipient_id records who was told; a notice counts only for the
--         client's current Admin and only when sent after their assignment (client_admin_assignments).
-- E2 cost (re-review): the per-cycle count of undecided items reads a partial index
--         (project_items_cycle_undecided_idx), covering reopened_at for Q8.
--
-- client_work_alerts now holds one row per send: a notice or an escalation may go again for the same
-- item and planned date (Q8, Q11), so the once-per-date unique key becomes once per run (kind, entity,
-- date, sent_at), and a fifth kind records E2's fresh notices. Moving a planned date away and back to
-- the original does not re-arm (the earlier notice for that date still counts), accepted 2026-10-08.
--
-- EXPAND-ONLY: two nullable columns, one trigger, two indexes, one notification kind (and the overdue
-- notice's description), two pg_cron schedules moved, the table's CHECK widened and its unique key
-- relaxed to include sent_at
-- (client_work_alerts is phase 7's, unused by main: ARCHITECTURE §18.1 "never narrow"), functions.
-- Append-only: never edit once applied.

-- Q8. When an item went back to open -------------------------------------------------------------------------
alter table public.project_items add column reopened_at timestamptz null;
comment on column public.project_items.reopened_at is
  'Kickoff 7 amendment C Q8 (owner 2026-10-08): when the item last went back to open (item_reject, '
  'item_unmark_done); null if never. Set by the project_items_reopened_at trigger; read by '
  'app.client_work_alerts() (the Admin is told again and gets the full threshold).';

create function app.project_items_reopened_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.state <> 'open' and new.state = 'open' then
    new.reopened_at := now();
  end if;
  return new;
end;
$$;

revoke all on function app.project_items_reopened_at() from public, anon, authenticated;
grant execute on function app.project_items_reopened_at() to service_role;

comment on function app.project_items_reopened_at() is
  'BEFORE UPDATE OF state on project_items (amendment C Q8): stamps reopened_at when an item goes back '
  'to open, whichever transition does it.';

create trigger reopened_at before update of state on public.project_items
  for each row execute function app.project_items_reopened_at();

-- E2 cost: the undecided items of a cycle (open, no carry decision), with Q8's moment ------------------------
create index project_items_cycle_undecided_idx on public.project_items (cycle_id) include (reopened_at)
  where state = 'open' and carry_decision is null;

-- The record of what was sent: who was told, one row per send ------------------------------------------------
alter table public.client_work_alerts add column recipient_id uuid null references public.members (id);
comment on column public.client_work_alerts.recipient_id is
  'Amendment C Q9 / Q11 (owner 2026-10-08): who was told: a notice''s recipient (the client''s Admin, or '
  'the Owner for a client with no Admin); for an escalation, the Admin it names (the Owner on E3''s '
  'reminder for a client with no Admin). Null on rows sent before 2026-10-08''s answers (read as the '
  'current recipient).';
create index client_work_alerts_recipient_idx on public.client_work_alerts (recipient_id);

alter table public.client_work_alerts drop constraint client_work_alerts_kind_check;
alter table public.client_work_alerts add constraint client_work_alerts_kind_check
  check (kind in ('item_overdue', 'item_overdue_escalation', 'cycle_undecided_escalation', 'delivery_escalation',
                  'cycle_undecided_notice'));
alter table public.client_work_alerts drop constraint client_work_alerts_once;
alter table public.client_work_alerts add constraint client_work_alerts_once_per_run
  unique (kind, entity_id, armed_for, sent_at);

comment on table public.client_work_alerts is
  'Kickoff 7 amendment C E1-E3 and the Q8-Q11 answers: one row per client-work notice or escalation '
  'sent (unique per run). item_overdue / item_overdue_escalation: per item and planned date; a notice '
  'counts while it was sent to the client''s current recipient after the item last went back to open '
  'and after that recipient''s assignment (Q8, Q11), and an escalation once per such notice. '
  'cycle_undecided_notice (Q8 / Q11''s fresh E2 notice) and cycle_undecided_escalation: per cycle and '
  'period end. delivery_escalation: per project and delivery date, once. A moved date re-arms; a date '
  'moved back to one already noticed does not. entity_id: the item, the cycle or the project. Written '
  'by app.client_work_alerts() only; the notifications are the visible record, so no API access at all '
  '(RLS on, no policy). Never deleted.';

-- Q9. The Owner's reminder of his own client's missed delivery; the overdue notice is his too -------------------
insert into public.notification_kinds (kind, actionable, always_email, in_app, description) values
  ('reminder_delivery_missed', false, true, true, 'A one-time project of a client you run is past its delivery date and not completed (the Owner, for a client with no Admin; always emailed)');
update public.notification_kinds
set description = 'Client items you run are past their planned date (the client''s Admin, or the Owner for a client with no Admin; always emailed, as a task''s overdue reminder)'
where kind = 'reminder_item_overdue';

-- Q10. The first 08:00 IST at or after a moment ----------------------------------------------------------------
create function app.client_work_morning(p_at timestamptz)
returns timestamptz
language sql
stable
set search_path = ''
as $$
  select case when x.m >= p_at then x.m else x.m + interval '1 day' end
  from (select (app.to_ist_date(p_at)::timestamp + time '08:00') at time zone 'Asia/Kolkata' as m) x;
$$;

revoke all on function app.client_work_morning(timestamptz) from public, anon, authenticated;
grant execute on function app.client_work_morning(timestamptz) to service_role;

comment on function app.client_work_morning(timestamptz) is
  'Internal (amendment C Q10): the first 08:00 IST at or after the moment, when E1''s notices, '
  'reminders and escalations go.';

-- E1's items: open, of open or in-progress projects, planned before the IST date; each with the moment its
-- current notice counts from (Q8, Q10, Q11): the latest of 00:00 IST after the planned date, its return
-- to open and the last change of its client's Admin.
create function app.client_items_overdue(p_org uuid, p_today date)
returns table (id uuid, title text, planned_date date, project_id uuid, project text, link text, client text,
               admin_id uuid, basis timestamptz)
language sql
stable
set search_path = ''
as $$
  select i.id, i.title, i.planned_date, p.id, p.name, app.project_link(p), cl.name, cl.admin_id,
         greatest(((i.planned_date + 1)::timestamp at time zone 'Asia/Kolkata'), i.reopened_at, s.since)
  from public.project_items i
  join public.projects p on p.id = i.project_id
  join public.clients cl on cl.id = p.client_id
  left join lateral (
    select max(coalesce(a.to_at, a.from_at)) as since
    from public.client_admin_assignments a where a.client_id = cl.id) s on true
  where i.org_id = p_org and i.state = 'open' and i.planned_date < p_today
    and p.state in ('open', 'in_progress');
$$;

revoke all on function app.client_items_overdue(uuid, date) from public, anon, authenticated;
grant execute on function app.client_items_overdue(uuid, date) to service_role;

comment on function app.client_items_overdue(uuid, date) is
  'Internal (amendment C E1, Q8-Q11): the overdue client items of an organisation on an IST date, each '
  'with basis = the latest of the overdue moment (00:00 IST after the planned date), reopened_at and '
  'the client''s last Admin change: a notice counts only when sent at or after it.';

-- The job --------------------------------------------------------------------------------------------------------
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
  v_count integer := 0;
begin
  for v_org in
    select s.org_id, s.item_overdue_escalate_hours as hours, s.cycle_decide_escalate_days as days
    from public.org_settings s order by s.org_id
  loop
    -- One run at a time per organisation: a late run and the next cannot both send.
    perform pg_advisory_xact_lock(hashtext('client_work_alerts:' || v_org.org_id::text));
    v_owner := app.org_owner_id(v_org.org_id);

    -- E1, the notice: overdue items whose recipient (the client's Admin; the Owner for a client with no
    -- Admin, Q9) has no notice counting for them, from the first 08:00 IST after the basis (Q10); one
    -- row per recipient.
    for v_group in
      select o.recipient,
             count(*) as n,
             count(distinct o.project_id) as projects,
             min(o.project_id::text)::uuid as project_id,
             min(o.link) as link,
             array_agg(o.id order by o.planned_date, o.project, o.title, o.id) as ids,
             array_agg(o.planned_date order by o.planned_date, o.project, o.title, o.id) as dates,
             array_agg(format('%s (%s · %s, %s)', o.title, o.project, o.client, app.notify_date(o.planned_date))
                       order by o.planned_date, o.project, o.title, o.id) as lines,
             min(o.title) as title, min(o.project) as project, min(o.client) as client, min(o.planned_date) as planned
      from (select x.*, coalesce(x.admin_id, v_owner) as recipient
            from app.client_items_overdue(v_org.org_id, v_today) x) o
      where o.recipient is not null
        and p_now >= app.client_work_morning(o.basis)
        and not exists (select 1 from public.client_work_alerts a
                        where a.kind = 'item_overdue' and a.entity_id = o.id and a.armed_for = o.planned_date
                          and a.sent_at >= o.basis and coalesce(a.recipient_id, o.recipient) = o.recipient)
      group by o.recipient
      order by o.recipient
    loop
      begin
        perform app.notify(array[v_group.recipient], 'reminder_item_overdue',
          case when v_group.n = 1 then format('Overdue: %s', v_group.title)
               else format('%s client items overdue', v_group.n) end,
          case when v_group.n = 1
               then format('%s · %s. Planned for %s.', v_group.project, v_group.client, app.notify_date(v_group.planned))
               else app.client_work_alert_lines(v_group.lines) || '.' end,
          case when v_group.projects = 1 then v_group.link else app.client_items_overdue_link() end,
          case when v_group.projects = 1 then 'projects' end,
          case when v_group.projects = 1 then v_group.project_id end,
          jsonb_build_object('items', v_group.n), null);
        insert into public.client_work_alerts (org_id, kind, entity_id, armed_for, sent_at, recipient_id)
        select v_org.org_id, 'item_overdue', x.id, x.d, p_now, v_group.recipient
        from unnest(v_group.ids, v_group.dates) as x(id, d);
        v_count := v_count + 1;
      exception when others then
        raise warning 'client_work_alerts: overdue notice for % skipped: %', v_group.recipient, sqlerrm;
      end;
    end loop;

    -- E1, then the Owner: items of a client with an Admin, still open and overdue, whose notice to that
    -- Admin counts and has had no escalation yet, from the first 08:00 IST at least
    -- item_overdue_escalate_hours after it (an hour's grace for the run after 08:00); one escalation per
    -- Admin, naming the Admin who was told (Q11). Never for a client with no Admin (Q9).
    for v_group in
      select o.admin_id, m.full_name as admin_name,
             count(*) as n,
             array_agg(o.id order by o.planned_date, o.project, o.title, o.id) as ids,
             array_agg(o.planned_date order by o.planned_date, o.project, o.title, o.id) as dates,
             array_agg(format('%s (%s · %s, %s)', o.title, o.project, o.client, app.notify_date(o.planned_date))
                       order by o.planned_date, o.project, o.title, o.id) as lines
      from app.client_items_overdue(v_org.org_id, v_today) o
      join public.members m on m.id = o.admin_id
      cross join lateral (
        select max(a.sent_at) as told from public.client_work_alerts a
        where a.kind = 'item_overdue' and a.entity_id = o.id and a.armed_for = o.planned_date
          and a.sent_at >= o.basis and coalesce(a.recipient_id, o.admin_id) = o.admin_id) n
      where n.told is not null
        and p_now >= app.client_work_morning(n.told + make_interval(hours => v_org.hours) - interval '1 hour')
        and not exists (select 1 from public.client_work_alerts a
                        where a.kind = 'item_overdue_escalation' and a.entity_id = o.id
                          and a.armed_for = o.planned_date and a.sent_at >= n.told)
      group by o.admin_id, m.full_name
      order by o.admin_id
    loop
      begin
        perform app.notify(array[v_owner], 'escalation_item_overdue',
          case when v_group.n = 1 then format('%s has a client item overdue', v_group.admin_name)
               else format('%s has %s client items overdue', v_group.admin_name, v_group.n) end,
          app.client_work_alert_lines(v_group.lines)
            || format('. Still not done %s h after %s was told.', v_org.hours, v_group.admin_name),
          app.client_items_overdue_link(), null, null,
          jsonb_build_object('items', v_group.n, 'admin_id', v_group.admin_id), null, 1);
        insert into public.client_work_alerts (org_id, kind, entity_id, armed_for, sent_at, recipient_id)
        select v_org.org_id, 'item_overdue_escalation', x.id, x.d, p_now, v_group.admin_id
        from unnest(v_group.ids, v_group.dates) as x(id, d);
        v_count := v_count + 1;
      exception when others then
        raise warning 'client_work_alerts: overdue escalation for Admin % skipped: %', v_group.admin_id, sqlerrm;
      end;
    end loop;

    -- E2, a fresh notice (Q8, Q11): a prompted, ended cycle of an open or in-progress project whose
    -- undecided items (open, no carry decision) include one back to open since the Admin was last told
    -- (the prompt or a fresh notice), or whose client's Admin changed since: the client's Admin, from
    -- the first 08:00 IST after the earliest such moment; one items_to_decide per Admin per run.
    for v_group in
      select cl.admin_id,
             count(*) as cycles,
             sum(u.n)::integer as items,
             count(distinct p.id) as projects,
             min(p.id::text)::uuid as project_id,
             min(app.project_link(p)) as link,
             array_agg(c.id order by c.period_end, p.name, c.id) as ids,
             array_agg(c.period_end order by c.period_end, p.name, c.id) as dates,
             array_agg(format('%s (%s) · %s: %s', p.name, cl.name, c.label, u.n)
                       order by c.period_end, p.name, c.id) as lines
      from public.project_cycles c
      join public.projects p on p.id = c.project_id
      join public.clients cl on cl.id = p.client_id
      cross join lateral (
        select greatest(c.prompted_at, max(a.sent_at)) as told from public.client_work_alerts a
        where a.kind = 'cycle_undecided_notice' and a.entity_id = c.id and a.armed_for = c.period_end) t
      cross join lateral (
        select count(*) as n, min(i.reopened_at) filter (where i.reopened_at > t.told) as reopened
        from public.project_items i
        where i.cycle_id = c.id and i.state = 'open' and i.carry_decision is null) u
      cross join lateral (
        select max(coalesce(s.to_at, s.from_at)) as since from public.client_admin_assignments s
        where s.client_id = cl.id) s
      where c.org_id = v_org.org_id and c.period_end is not null and c.period_end < v_today
        and c.prompted_at is not null and p.state in ('open', 'in_progress') and cl.admin_id is not null
        and u.n > 0
        and p_now >= app.client_work_morning(least(u.reopened, case when s.since > t.told then s.since end))
      group by cl.admin_id
      order by cl.admin_id
    loop
      begin
        perform app.notify(array[v_group.admin_id], 'items_to_decide',
          format('%s unfinished %s to decide', v_group.items, case when v_group.items = 1 then 'item' else 'items' end),
          app.client_work_alert_lines(v_group.lines) || '.',
          case when v_group.projects = 1 then v_group.link else '/today' end,
          case when v_group.projects = 1 then 'projects' end,
          case when v_group.projects = 1 then v_group.project_id end,
          jsonb_build_object('items', v_group.items, 'cycles', v_group.cycles), null);
        insert into public.client_work_alerts (org_id, kind, entity_id, armed_for, sent_at, recipient_id)
        select v_org.org_id, 'cycle_undecided_notice', x.id, x.d, p_now, v_group.admin_id
        from unnest(v_group.ids, v_group.dates) as x(id, d);
        v_count := v_count + 1;
      exception when others then
        raise warning 'client_work_alerts: cycle notice for Admin % skipped: %', v_group.admin_id, sqlerrm;
      end;
    end loop;

    -- E2, the escalation: those cycles, with no item back to open and no Admin change since the Admin
    -- was last told, at the first 08:00 IST at least cycle_decide_escalate_days after both the period's
    -- end and that notice (an hour's grace for the run after 08:00), not yet escalated since it; one
    -- escalation per Admin.
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
        select count(*) as n, max(i.reopened_at) as reopened from public.project_items i
        where i.cycle_id = c.id and i.state = 'open' and i.carry_decision is null) u
      cross join lateral (
        select greatest(c.prompted_at, max(a.sent_at)) as told from public.client_work_alerts a
        where a.kind = 'cycle_undecided_notice' and a.entity_id = c.id and a.armed_for = c.period_end) t
      cross join lateral (
        select max(coalesce(s.to_at, s.from_at)) as since from public.client_admin_assignments s
        where s.client_id = cl.id) s
      where c.org_id = v_org.org_id and c.period_end is not null and c.prompted_at is not null
        and p.state in ('open', 'in_progress') and u.n > 0
        and (u.reopened is null or u.reopened <= t.told) and (s.since is null or s.since <= t.told)
        and p_now >= app.client_work_morning(
                       greatest(((c.period_end + 1)::timestamp at time zone 'Asia/Kolkata'), t.told)
                       + make_interval(days => v_org.days) - interval '1 hour')
        and not exists (select 1 from public.client_work_alerts a
                        where a.kind = 'cycle_undecided_escalation' and a.entity_id = c.id
                          and a.armed_for = c.period_end and a.sent_at >= t.told)
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
        insert into public.client_work_alerts (org_id, kind, entity_id, armed_for, sent_at, recipient_id)
        select v_org.org_id, 'cycle_undecided_escalation', x.id, x.d, p_now, v_group.admin_id
        from unnest(v_group.ids, v_group.dates) as x(id, d);
        v_count := v_count + 1;
      exception when others then
        raise warning 'client_work_alerts: cycle escalation for Admin % skipped: %', v_group.admin_id, sqlerrm;
      end;
    end loop;

    -- E3: one-time projects still open or in progress at 08:00 IST the morning after their delivery
    -- date; once per delivery date (a moved date re-arms). One escalation per Admin naming them; a
    -- client with no Admin: one reminder to the Owner, no Admin named (Q9).
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
      left join public.members m on m.id = cl.admin_id
      where p.org_id = v_org.org_id and p.recurrence = 'one_time' and p.state in ('open', 'in_progress')
        and p.delivery_date is not null
        and p_now >= ((p.delivery_date + 1)::timestamp + time '08:00') at time zone 'Asia/Kolkata'
        and not exists (select 1 from public.client_work_alerts a
                        where a.kind = 'delivery_escalation' and a.entity_id = p.id and a.armed_for = p.delivery_date)
        and (cl.admin_id is not null or v_owner is not null)
      group by cl.admin_id, m.full_name
      order by cl.admin_id nulls first
    loop
      begin
        if v_group.admin_id is null then
          perform app.notify(array[v_owner], 'reminder_delivery_missed',
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
        end if;
        insert into public.client_work_alerts (org_id, kind, entity_id, armed_for, sent_at, recipient_id)
        select v_org.org_id, 'delivery_escalation', x.id, x.d, p_now, coalesce(v_group.admin_id, v_owner)
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

comment on function app.client_work_alerts(timestamptz) is
  'Kickoff 7 amendment C E1-E3 with the Q8-Q11 answers (owner 2026-10-08; WORKFLOWS §5.4 item 21, §8, '
  '§9): pg_cron every 5 minutes. Per organisation under an advisory lock, each (kind, recipient) in a '
  'savepoint of its own. (E1) overdue items (app.client_items_overdue) -> their client''s Admin, or the '
  'Owner for a client with no Admin (Q9), one reminder_item_overdue per recipient per run (always '
  'emailed) from the first 08:00 IST after the item became overdue, went back to open (Q8) or its '
  'client''s Admin changed (Q11) (Q10); then, still open, the Owner, one escalation_item_overdue per '
  'Admin naming the Admin who was told, from the first 08:00 IST at least item_overdue_escalate_hours '
  'after that notice (never for a client with no Admin). (E2) prompted ended cycles with an undecided '
  'item back to open (Q8) or a new Admin (Q11) since the Admin was last told -> the Admin, one '
  'items_to_decide per Admin per run, from the next 08:00 IST; otherwise, at the first 08:00 IST at '
  'least cycle_decide_escalate_days after both the period end and the last notice (the prompt or a '
  'fresh one) -> the Owner, one escalation_cycle_undecided per Admin, once per notice. Nothing at '
  'midnight (owner 2026-10-08). (E3) one-time projects still open or in progress at 08:00 IST after their '
  'delivery date -> the Owner, one escalation_delivery_missed per Admin, or one '
  'reminder_delivery_missed for clients with no Admin (Q9); once per delivery date. Escalations are '
  'always emailed with escalation_level 1; no actor; never an amount. Each send is a client_work_alerts '
  'row (recipient_id = who was told). Returns the notifications written.';

-- 08:00. The nightly client-work jobs that notify move to the morning (owner 2026-10-08: "no client-work
-- notice or escalation is ever sent around midnight"); cron.schedule replaces a job of the same name.
select cron.schedule('cycle_generate', '30 2 * * *', $$select app.cycle_generate()$$);
select cron.schedule('cycle_close_prompt', '35 2 * * *', $$select app.cycle_close_prompt()$$);

comment on function app.cycle_close_prompt(timestamptz) is
  '7.2 (WORKFLOWS §8 / §9; issue #56 Q2, owner 2026-10-08; 7A review S1, L1): pg_cron at 08:05 IST '
  '(02:35 UTC) every day, after cycle_generate (owner 2026-10-08: no client-work notice at midnight; '
  'until then 00:05 IST). Per organisation under an advisory lock: an Admin is prompted when a cycle '
  'of their clients'' open or in-progress projects has ended before the run''s IST date, holds open '
  'items with no carry decision and was not prompted yet (prompted_at). The prompt, one '
  'items_to_decide row per Admin per run (the client''s Admin only, app.cycle_close_prompt_recipient; '
  'actionable, no actor), then counts and lists every undecided open item of every ended cycle of '
  'those projects and the items they left pending, each project and cycle with its count; the new '
  'cycles are marked prompted_at (audited ''prompted''), each Admin in a savepoint of their own (one '
  'that fails is a WARNING, prompted the next morning). Done items are not counted (they wait for '
  'approval). Returns the rows written. Idempotent: a re-run with nothing newly ended is quiet.';

comment on function app.cycle_generate(timestamptz) is
  '7.2 (WORKFLOWS §8, kickoff 7 decision 2; 7A review S2; Q4 (a)): pg_cron at 08:00 IST (02:30 UTC) '
  'every day (owner 2026-10-08: no client-work notice at midnight, so its cycle_generated row goes in '
  'the morning; until then 00:00 IST). Per organisation under an advisory lock: for every recurring '
  'project, open or in progress, of an Active client, every missing period overlapping the last 7 IST '
  'dates (to_ist_date(p_now) - 6 to today), oldest first, but none that ended before the project was '
  'created, before its client last became Active (activated / reactivated) or before the project was '
  'last reopened; then the item list into any running cycle a carry made while the client was not '
  'Active (item_list_copied false), once. generated_by schedule, the item list copied in; a past '
  'period''s cycle is an ended cycle like any other (cycle_close_prompt, the carry decision). Each '
  'project in a savepoint of its own. Then one cycle_generated row per Admin (combined, actionable) '
  'naming the cycles whose period has not ended. Returns the cycles created. Idempotent (unique '
  'project_id, period_start; item_list_copied).';
