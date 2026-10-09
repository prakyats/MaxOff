-- The 7A review of d9caeab (2026-10-08): the owner's 08:00 rule for dates set in the past, a real
--   database-level guarantee against double sends, one "unfinished items to decide" per Admin per
--   morning, no escalation used up without an Owner, and the E2 / E1 costs. PROGRESS "Kickoff 7
--   decisions" (the 08:00 rule: "no client-work notice or escalation is ever sent around midnight"),
--   WORKFLOWS §5.4 item 21, §8, §9; DATA-MODEL §5.
--
-- M1  A past date waits for the morning. Until now a planned date (E1) or a delivery date (E3) set in
--     the past, an item added with a past date, a project created with a past delivery date or
--     reopened after it was sent at the next 5-minute run, at any hour. Two "armed at" moments fix
--     that, each stamped by a trigger:
--       project_items.overdue_armed_at  when the item is inserted, its planned date changes or it
--                                       goes back to open;
--       projects.delivery_armed_at      when the project is created, its delivery date changes or it
--                                       is reopened (completed / cancelled -> open / in progress).
--     E1's basis (app.client_items_overdue) takes overdue_armed_at into its greatest(...), so the
--     notice waits for the first 08:00 IST after that moment; E3 waits for the later of 08:00 IST the
--     morning after the delivery date and the first 08:00 IST after delivery_armed_at. Several edits
--     in one evening give one notice the next morning: only the item's date at the run counts, and
--     nothing goes before 08:00. A date moved away and back now re-arms too (every change of the date
--     is a new moment; this supersedes "a date moved back to one already noticed does not re-arm").
--     E3 stays once per delivery date (owner E3): a reopen only makes the first escalation for that
--     date wait for the morning.
-- S2  client_work_alerts.answers_at: what the row answers (E1's notice: the item's basis; an
--     escalation: the notice it follows, "told"; E2's fresh notice: the reopening or Admin change it
--     reports; E3: 08:00 IST the morning after the delivery date, so once per date). A unique index on
--     (kind, entity_id, armed_for, recipient_id, answers_at) nulls not distinct makes a second send of
--     the same answer impossible whatever p_now a replayed or overlapping run passes (the old key
--     included sent_at = p_now, so it never caught one). Rows written before this migration keep a
--     null answers_at (expand-only) and are outside the index (a constraint over them could refuse to
--     build on a database holding Q8 re-sends); a NOT VALID check makes every new row carry one. A
--     conflict stays a WARNING in the group's savepoint. The job refuses to run at any isolation but
--     read committed: its "already sent?" checks must see what the run before it committed after the
--     advisory lock.
-- L1  One items_to_decide per Admin per morning: E2's fresh notice (08:00) skips an Admin whom the
--     08:05 prompt reaches that morning (a newly ended cycle not yet prompted), and the prompt records
--     the fresh notices it stands for (it lists every undecided item anyway), so the 08:10 run sends
--     nothing more.
-- L2  No active Owner: an escalation group is skipped, and a send is recorded only when app.notify()
--     wrote a row, so nothing is used up silently.
-- L3  E2 reads open cycles only (a cycle holding open items is never settled) through a partial index;
--     E1's last Admin change is read once per client, not once per item.
--
-- EXPAND-ONLY: three nullable columns, two triggers, two indexes, one NOT VALID check (new rows only),
-- functions. Append-only: never edit once applied.

-- M1. When an item's overdue notice was armed ---------------------------------------------------------------
alter table public.project_items add column overdue_armed_at timestamptz null;
comment on column public.project_items.overdue_armed_at is
  '7A review M1 (the owner''s 08:00 rule, 2026-10-08): when the item was inserted, its planned date last '
  'changed or it last went back to open; null on items untouched since. Set by the overdue_armed_at '
  'trigger; app.client_items_overdue() folds it into the basis, so a date set in the past is told at '
  'the next 08:00 IST, never within minutes.';

create function app.project_items_overdue_armed_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.overdue_armed_at := now();
  elsif new.planned_date is distinct from old.planned_date then
    new.overdue_armed_at := now();
  elsif old.state <> 'open' and new.state = 'open' then
    new.overdue_armed_at := now();
  end if;
  return new;
end;
$$;

revoke all on function app.project_items_overdue_armed_at() from public, anon, authenticated;
grant execute on function app.project_items_overdue_armed_at() to service_role;

comment on function app.project_items_overdue_armed_at() is
  'BEFORE INSERT OR UPDATE OF planned_date, state on project_items (7A review M1): stamps '
  'overdue_armed_at on an insert, a changed planned date or a return to open.';

create trigger overdue_armed_at before insert or update of planned_date, state on public.project_items
  for each row execute function app.project_items_overdue_armed_at();

-- M1. When a project's missed-delivery escalation was armed ---------------------------------------------------
alter table public.projects add column delivery_armed_at timestamptz null;
comment on column public.projects.delivery_armed_at is
  '7A review M1 (the owner''s 08:00 rule, 2026-10-08): when the project was created, its delivery date '
  'last changed or it was last reopened; null on projects untouched since. Set by the '
  'delivery_armed_at trigger; E3 (app.client_work_alerts) waits for the first 08:00 IST after it.';

create function app.projects_delivery_armed_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.delivery_armed_at := now();
  elsif new.delivery_date is distinct from old.delivery_date then
    new.delivery_armed_at := now();
  elsif old.state in ('completed', 'cancelled') and new.state in ('open', 'in_progress') then
    new.delivery_armed_at := now();
  end if;
  return new;
end;
$$;

revoke all on function app.projects_delivery_armed_at() from public, anon, authenticated;
grant execute on function app.projects_delivery_armed_at() to service_role;

comment on function app.projects_delivery_armed_at() is
  'BEFORE INSERT OR UPDATE OF delivery_date, state on projects (7A review M1): stamps delivery_armed_at '
  'on creation, a changed delivery date or a reopen.';

create trigger delivery_armed_at before insert or update of delivery_date, state on public.projects
  for each row execute function app.projects_delivery_armed_at();

-- S2. What each row answers, unique ------------------------------------------------------------------------
alter table public.client_work_alerts add column answers_at timestamptz null;
comment on column public.client_work_alerts.answers_at is
  '7A review S2 (2026-10-08): the moment the send answers: item_overdue the item''s basis '
  '(app.client_items_overdue); item_overdue_escalation and cycle_undecided_escalation the notice it '
  'follows (told); cycle_undecided_notice the reopening or Admin change it reports; '
  'delivery_escalation 08:00 IST the morning after the delivery date. Unique with kind, entity, '
  'date and recipient (client_work_alerts_once_per_answer), so no replayed run sends twice. Null on '
  'rows sent before 2026-10-08''s review fixes.';

create unique index client_work_alerts_once_per_answer on public.client_work_alerts
  (kind, entity_id, armed_for, recipient_id, answers_at) nulls not distinct
  where answers_at is not null;
alter table public.client_work_alerts add constraint client_work_alerts_answers_at_set
  check (answers_at is not null and recipient_id is not null) not valid;

comment on table public.client_work_alerts is
  'Kickoff 7 amendment C E1-E3, the Q8-Q11 answers and the 7A review of d9caeab: one row per '
  'client-work notice or escalation sent. item_overdue / item_overdue_escalation: per item and planned '
  'date; a notice counts while it was sent to the client''s current recipient at or after the item''s '
  'basis (its overdue moment, last return to open, last arming and the recipient''s assignment), and '
  'an escalation once per such notice. cycle_undecided_notice (E2''s fresh notice, by the job or the '
  'prompt) and cycle_undecided_escalation: per cycle and period end. delivery_escalation: per project '
  'and delivery date, once. answers_at (unique with kind, entity, date and recipient): what the send '
  'answers, so a replayed run never sends twice. Every date change re-arms. Written by '
  'app.client_work_alerts() and app.cycle_close_prompt() only; the notifications are the visible '
  'record, so no API access at all (RLS on, no policy). Never deleted.';

-- L3. E2 scans the open cycles that were prompted ----------------------------------------------------------
create index project_cycles_prompted_open_idx on public.project_cycles (org_id)
  where prompted_at is not null and state = 'open';

-- M1, L3. E1's items with their basis: the client's last Admin change read once per client --------------------
create or replace function app.client_items_overdue(p_org uuid, p_today date)
returns table (id uuid, title text, planned_date date, project_id uuid, project text, link text, client text,
               admin_id uuid, basis timestamptz)
language sql
stable
set search_path = ''
as $$
  with c as materialized (
    select cl.id, cl.name, cl.admin_id,
           (select max(coalesce(a.to_at, a.from_at)) from public.client_admin_assignments a
            where a.client_id = cl.id) as since
    from public.clients cl
    where cl.org_id = p_org
  )
  select i.id, i.title, i.planned_date, p.id, p.name, app.project_link(p), c.name, c.admin_id,
         greatest(((i.planned_date + 1)::timestamp at time zone 'Asia/Kolkata'), i.reopened_at,
                  i.overdue_armed_at, c.since)
  from public.project_items i
  join public.projects p on p.id = i.project_id
  join c on c.id = p.client_id
  where i.org_id = p_org and i.state = 'open' and i.planned_date < p_today
    and p.state in ('open', 'in_progress');
$$;

comment on function app.client_items_overdue(uuid, date) is
  'Internal (amendment C E1, Q8-Q11, 7A review M1): the overdue client items of an organisation on an IST '
  'date, each with basis = the latest of the overdue moment (00:00 IST after the planned date), '
  'reopened_at, overdue_armed_at and the client''s last Admin change (read once per client): a notice '
  'counts only when sent at or after it, and goes at the first 08:00 IST after it.';

-- E2's ended, prompted cycles still holding undecided items, with what the Admin was last told and
-- whether a fresh notice is due (the job and the prompt share it) ----------------------------------------------
create function app.cycle_undecided_due(p_org uuid)
returns table (cycle_id uuid, period_end date, label text, project_id uuid, project text, link text,
               client text, admin_id uuid, undecided integer, told timestamptz, due_at timestamptz)
language sql
stable
set search_path = ''
as $$
  select c.id, c.period_end, c.label, p.id, p.name, app.project_link(p), cl.name, cl.admin_id,
         u.n::integer, t.told,
         least(u.reopened, case when s.since > t.told then s.since end)
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
    select max(coalesce(a.to_at, a.from_at)) as since from public.client_admin_assignments a
    where a.client_id = cl.id) s
  where c.org_id = p_org and c.state = 'open' and c.prompted_at is not null and c.period_end is not null
    and p.state in ('open', 'in_progress') and cl.admin_id is not null and u.n > 0;
$$;

revoke all on function app.cycle_undecided_due(uuid) from public, anon, authenticated;
grant execute on function app.cycle_undecided_due(uuid) to service_role;

comment on function app.cycle_undecided_due(uuid) is
  'Internal (amendment C E2, Q8 / Q11, 7A review L1 / L3): the open, prompted, ended cycles of an '
  'organisation''s open or in-progress projects of a client with an Admin that still hold undecided '
  'items (open, no carry decision), each with told = the Admin''s last notice (prompted_at or a fresh '
  'cycle_undecided_notice) and due_at = the earliest return to open or Admin change since (null: '
  'nothing new, the escalation''s case). Read by app.client_work_alerts() and app.cycle_close_prompt().';

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
  v_sent integer;
  v_count integer := 0;
begin
  -- S2: the "already sent?" checks below read what the run before committed once the advisory lock is
  -- held, which only read committed gives (a repeatable-read snapshot predates the lock).
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'client_work_alerts runs only at read committed, not %',
      current_setting('transaction_isolation');
  end if;

  for v_org in
    select s.org_id, s.item_overdue_escalate_hours as hours, s.cycle_decide_escalate_days as days
    from public.org_settings s order by s.org_id
  loop
    -- One run at a time per organisation: a late run and the next cannot both send.
    perform pg_advisory_xact_lock(hashtext('client_work_alerts:' || v_org.org_id::text));
    v_owner := app.org_owner_id(v_org.org_id);

    -- E1, the notice: overdue items whose recipient (the client's Admin; the Owner for a client with no
    -- Admin, Q9) has no notice counting for them, from the first 08:00 IST after the basis (Q10; the
    -- basis includes the item's last arming, M1); one row per recipient.
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
    -- an active Owner (L2).
    for v_group in
      select o.admin_id, m.full_name as admin_name,
             count(*) as n,
             array_agg(o.id order by o.planned_date, o.project, o.title, o.id) as ids,
             array_agg(o.planned_date order by o.planned_date, o.project, o.title, o.id) as dates,
             array_agg(n.told order by o.planned_date, o.project, o.title, o.id) as answers,
             array_agg(format('%s (%s · %s, %s)', o.title, o.project, o.client, app.notify_date(o.planned_date))
                       order by o.planned_date, o.project, o.title, o.id) as lines
      from app.client_items_overdue(v_org.org_id, v_today) o
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
  'Kickoff 7 amendment C E1-E3 with the Q8-Q11 answers and the 7A review of d9caeab (owner 2026-10-08; '
  'WORKFLOWS §5.4 item 21, §8, §9): pg_cron every 5 minutes, read committed only. Per organisation '
  'under an advisory lock, each (kind, recipient) in a savepoint of its own (a failure or a duplicate '
  'answer is a WARNING). Nothing goes before 08:00 IST. (E1) overdue items (app.client_items_overdue) '
  '-> their client''s Admin, or the Owner for a client with no Admin (Q9), one reminder_item_overdue per '
  'recipient per run (always emailed) from the first 08:00 IST after the latest of the overdue moment, '
  'the item''s last return to open (Q8), its last arming (an insert or a date change, M1) and its '
  'client''s last Admin change (Q11); then, still open, the Owner, one escalation_item_overdue per '
  'Admin naming the Admin who was told, from the first 08:00 IST at least item_overdue_escalate_hours '
  'after that notice (never for a client with no Admin). (E2) prompted ended cycles with an undecided '
  'item back to open (Q8) or a new Admin (Q11) since the Admin was last told -> the Admin, one '
  'items_to_decide per Admin per run, from the next 08:00 IST, unless the 08:05 prompt reaches them '
  'that morning (it records these notices, L1); otherwise, at the first 08:00 IST at least '
  'cycle_decide_escalate_days after both the period end and the last notice -> the Owner, one '
  'escalation_cycle_undecided per Admin, once per notice. (E3) one-time projects still open or in '
  'progress at the later of 08:00 IST after their delivery date and the first 08:00 IST after the '
  'project''s last arming (creation, a date change, a reopen; M1) -> the Owner, one '
  'escalation_delivery_missed per Admin, or one reminder_delivery_missed for clients with no Admin '
  '(Q9); once per delivery date. Escalations are always emailed with escalation_level 1; no actor; '
  'never an amount; none without an active Owner. A send is recorded (client_work_alerts, one row per '
  'item, cycle or project with recipient_id and answers_at) only when app.notify() wrote it (L2). '
  'Returns the notifications written.';

-- L1. The prompt stands for E2's fresh notices of the Admins it reaches ------------------------------------------
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
  '7.2 (WORKFLOWS §8 / §9; issue #56 Q2, owner 2026-10-08; 7A review S1, L1; the review of d9caeab L1): '
  'pg_cron at 08:05 IST (02:35 UTC) every day, after cycle_generate. Per organisation under an advisory '
  'lock: an Admin is prompted when a cycle of their clients'' open or in-progress projects has ended '
  'before the run''s IST date, holds open items with no carry decision and was not prompted yet '
  '(prompted_at). The prompt, one items_to_decide row per Admin per run (the client''s Admin only, '
  'app.cycle_close_prompt_recipient; actionable, no actor), then counts and lists every undecided open '
  'item of every ended cycle of those projects and the items they left pending, each project and cycle '
  'with its count; it is also the Admin''s fresh E2 notice for every earlier cycle that had one due '
  '(recorded as cycle_undecided_notice in client_work_alerts, so that morning brings one '
  'items_to_decide); the new cycles are marked prompted_at (audited ''prompted''), each Admin in a '
  'savepoint of their own (one that fails is a WARNING, prompted the next morning). Done items are not '
  'counted (they wait for approval). Returns the rows written. Idempotent: a re-run with nothing newly '
  'ended is quiet.';
