-- The owner's E1 rule, literally (7A, 2026-10-08): "each item once per planned date, a moved date
--   re-arms". client_work_alerts_armed (939a108) folded project_items.overdue_armed_at into E1's basis,
--   so every date change re-armed, a date moved back to one already noticed included: the Admin was told
--   again about that date and the Owner escalated it again. That is not the owner's rule. WORKFLOWS §5.4
--   item 21, §9 (E1); PROGRESS "Kickoff 7 decisions".
--
-- overdue_armed_at now decides only WHEN a notice may go, never what counts as already sent:
--   basis    = greatest(overdue moment, reopened_at, the client's last Admin change), as before M1: the
--              "already sent?" checks (a notice for this item and planned date, to this recipient, sent at
--              or after it) and the row's answers_at;
--   due_from = greatest(basis, overdue_armed_at): only the gate p_now >= app.client_work_morning(due_from).
-- So a new past date still waits for the first 08:00 IST after it was set (M1 holds); a date moved back to
-- one already noticed finds that notice still counting and sends nothing again, neither the Admin's notice
-- nor the Owner's escalation (which follows the notice it counts, once); Q8 (reopened_at) and Q11 (the
-- Admin change) stay in the basis, unchanged.
--
-- app.client_items_overdue's return type cannot change in place: app.client_items_overdue_due() returns the
-- items with basis and due_from, app.client_work_alerts() reads it, and app.client_items_overdue() stays
-- (expand-only) as a thin view of it with its old columns and its old grants (nothing reads it now; drop it
-- in a contract migration). E2, E3 and the prompt are unchanged.
--
-- EXPAND-ONLY: one new function; three functions replaced with the same signature and grants; comments.
-- Append-only: never edit once applied.

-- E1's items with their basis (what counts as sent) and due_from (when a notice may go) -----------------------
create function app.client_items_overdue_due(p_org uuid, p_today date)
returns table (id uuid, title text, planned_date date, project_id uuid, project text, link text, client text,
               admin_id uuid, basis timestamptz, due_from timestamptz)
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
  ), o as (
    select i.id, i.title, i.planned_date, p.id as project_id, p.name as project, app.project_link(p) as link,
           c.name as client, c.admin_id, i.overdue_armed_at,
           greatest(((i.planned_date + 1)::timestamp at time zone 'Asia/Kolkata'), i.reopened_at, c.since) as basis
    from public.project_items i
    join public.projects p on p.id = i.project_id
    join c on c.id = p.client_id
    where i.org_id = p_org and i.state = 'open' and i.planned_date < p_today
      and p.state in ('open', 'in_progress')
  )
  select o.id, o.title, o.planned_date, o.project_id, o.project, o.link, o.client, o.admin_id, o.basis,
         greatest(o.basis, o.overdue_armed_at)
  from o;
$$;

revoke all on function app.client_items_overdue_due(uuid, date) from public, anon, authenticated;
grant execute on function app.client_items_overdue_due(uuid, date) to service_role;

comment on function app.client_items_overdue_due(uuid, date) is
  'Internal (amendment C E1, Q8-Q11, the 7A review M1 and the owner''s E1 rule, 2026-10-08): the overdue '
  'client items of an organisation on an IST date, each with basis = the latest of the overdue moment '
  '(00:00 IST after the planned date), reopened_at (Q8) and the client''s last Admin change (Q11, read '
  'once per client): a notice for the item and planned date counts only when sent at or after it, and it '
  'is the answer a notice records; and due_from = the later of basis and overdue_armed_at: the notice goes '
  'at the first 08:00 IST after it. Arming decides when, never what was sent: a date moved back to one '
  'already noticed is not told again. Read by app.client_work_alerts().';

-- The old name, kept (expand-only) with its columns: the same items and basis --------------------------------
create or replace function app.client_items_overdue(p_org uuid, p_today date)
returns table (id uuid, title text, planned_date date, project_id uuid, project text, link text, client text,
               admin_id uuid, basis timestamptz)
language sql
stable
set search_path = ''
as $$
  select o.id, o.title, o.planned_date, o.project_id, o.project, o.link, o.client, o.admin_id, o.basis
  from app.client_items_overdue_due(p_org, p_today) o;
$$;

comment on function app.client_items_overdue(uuid, date) is
  'Internal, superseded by app.client_items_overdue_due() (the owner''s E1 rule, 2026-10-08) and read by '
  'nothing: the same overdue items and basis (overdue moment, reopened_at, the client''s last Admin change; '
  'never overdue_armed_at), without due_from. Kept for expand-only; drop it in a contract migration.';

comment on column public.project_items.overdue_armed_at is
  '7A review M1 (the owner''s 08:00 rule, 2026-10-08): when the item was inserted, its planned date last '
  'changed or it last went back to open; null on items untouched since. Set by the overdue_armed_at '
  'trigger. It decides only when E1''s notice may go (app.client_items_overdue_due() due_from: the first '
  '08:00 IST after it), never what counts as sent: a date set in the past is told at the next 08:00 IST, '
  'a date moved back to one already noticed is not told again (the owner''s E1 rule).';

comment on table public.client_work_alerts is
  'Kickoff 7 amendment C E1-E3, the Q8-Q11 answers and the 7A review of d9caeab: one row per '
  'client-work notice or escalation sent. item_overdue / item_overdue_escalation: once per item and '
  'planned date; a notice counts while it was sent to the client''s current recipient at or after the '
  'item''s basis (its overdue moment, last return to open and the recipient''s assignment), and an '
  'escalation once per such notice. Moving to a new date re-arms; moving back to a date already noticed '
  'does not (the item''s last arming only delays the next notice to 08:00 IST). cycle_undecided_notice '
  '(E2''s fresh notice, by the job or the prompt) and cycle_undecided_escalation: per cycle and period '
  'end. delivery_escalation: per project and delivery date, once. answers_at (unique with kind, entity, '
  'date and recipient): what the send answers, so a replayed run never sends twice. Written by '
  'app.client_work_alerts() and app.cycle_close_prompt() only; the notifications are the visible record, '
  'so no API access at all (RLS on, no policy). Never deleted.';

-- The job: E1 reads basis for what was sent and due_from for when -----------------------------------------------
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
  'Kickoff 7 amendment C E1-E3 with the Q8-Q11 answers, the 7A review of d9caeab and the owner''s E1 rule '
  '(owner 2026-10-08; WORKFLOWS §5.4 item 21, §8, §9): pg_cron every 5 minutes, read committed only. Per '
  'organisation under an advisory lock, each (kind, recipient) in a savepoint of its own (a failure or a '
  'duplicate answer is a WARNING). Nothing goes before 08:00 IST. (E1) overdue items '
  '(app.client_items_overdue_due) -> their client''s Admin, or the Owner for a client with no Admin (Q9), '
  'one reminder_item_overdue per recipient per run (always emailed), once per item and planned date: a '
  'notice counts while sent to the current recipient at or after the basis, the latest of the overdue '
  'moment, the item''s last return to open (Q8) and its client''s last Admin change (Q11); a new one goes '
  'at the first 08:00 IST after due_from, the later of the basis and the item''s last arming (an insert, '
  'a date change, M1), so moving to a new date re-arms and moving back to a date already noticed does '
  'not; then, still open, the Owner, one escalation_item_overdue per Admin naming the Admin who was told, '
  'from the first 08:00 IST at least item_overdue_escalate_hours after that notice, once per notice '
  '(never for a client with no Admin). (E2) prompted ended cycles with an undecided item back to open '
  '(Q8) or a new Admin (Q11) since the Admin was last told -> the Admin, one items_to_decide per Admin per '
  'run, from the next 08:00 IST, unless the 08:05 prompt reaches them that morning (it records these '
  'notices, L1); otherwise, at the first 08:00 IST at least cycle_decide_escalate_days after both the '
  'period end and the last notice -> the Owner, one escalation_cycle_undecided per Admin, once per notice. '
  '(E3) one-time projects still open or in progress at the later of 08:00 IST after their delivery date '
  'and the first 08:00 IST after the project''s last arming (creation, a date change, a reopen; M1) -> the '
  'Owner, one escalation_delivery_missed per Admin, or one reminder_delivery_missed for clients with no '
  'Admin (Q9); once per delivery date. Escalations are always emailed with escalation_level 1; no actor; '
  'never an amount; none without an active Owner. A send is recorded (client_work_alerts, one row per '
  'item, cycle or project with recipient_id and answers_at) only when app.notify() wrote it (L2). '
  'Returns the notifications written.';
