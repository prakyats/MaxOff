-- v1.8 speed fix 3 (speed gate #1, 2026-10-23: the Admin's /clients 429 vs 374 ms on staging;
-- ARCHITECTURE §19): each client's running deliverables, added up in SQL, in one round trip.
--
-- The Clients list's work column (N4: "3 open · 9/12 done") and its Due (PP-admin-10: the late
-- count, else the next planned date) were computed in the app from listCurrentCycles(): every
-- current cycle with each of its items' state and planned date embedded, read page by page under
-- row-level RLS, only to be added up per client. public.client_work_summary() returns those sums,
-- one row per client, grouped here.
--
-- Same rows as before: SECURITY INVOKER, so RLS decides every cycle, project and item exactly as
-- the API read did (projects_select: projects.manage on a visible client, so the Owner reads every
-- client, an Admin only their own, Crew nothing; project_cycles_select / project_items_select:
-- app.project_visible). The same current cycles: a working (open or in_progress) project's cycle
-- whose period covers on_date, or a one-time project's cycle (no period). The same sums as the
-- app's progressOf() and dueByClient(): total leaves out cancelled and carried items, done counts
-- done and approved, closed counts cancelled; late is the open items planned before on_date, and
-- next_planned the earliest open item's planned date from on_date on. A client whose running
-- cycles hold no item has no row (the list showed nothing for it before either). Counts and
-- dates only, never an amount (invariant 2).
--
-- on_date defaults to the IST business day (invariant 8); the page passes its own todayIST() so
-- the column and the dates it shows agree. The joins use project_items_cycle_state_idx
-- (cycle_id, state) and project_cycles_project_period_key (project_id, period_start); no new index.
--
-- Expand-only: a new function; nothing existing changes. No new table, so no new policy.

create function public.client_work_summary(on_date date default app.today_ist())
returns table (
  client_id uuid,
  total integer,
  done integer,
  closed integer,
  late integer,
  next_planned date
)
language sql
stable
security invoker
set search_path = ''
as $$
  select p.client_id,
         (count(*) filter (where i.state not in ('cancelled', 'carried')))::integer,
         (count(*) filter (where i.state in ('done', 'approved')))::integer,
         (count(*) filter (where i.state = 'cancelled'))::integer,
         (count(*) filter (where i.state = 'open' and i.planned_date < on_date))::integer,
         min(i.planned_date) filter (where i.state = 'open' and i.planned_date >= on_date)
  from public.project_cycles c
  join public.projects p on p.id = c.project_id
  join public.project_items i on i.cycle_id = c.id
  where p.state in ('open', 'in_progress')
    and (c.period_start is null or (c.period_start <= on_date and c.period_end >= on_date))
  group by p.client_id;
$$;

comment on function public.client_work_summary(date) is
  'v1.8 speed fix 3 (2026-10-23, ARCHITECTURE §19): each visible client''s running deliverables, '
  'security invoker (RLS decides every row: the Owner every client, an Admin their own, Crew none). '
  'Across the current cycles (a working project''s cycle covering on_date, or a one-time cycle): '
  'total (not cancelled or carried), done (done or approved), closed (cancelled), late (open, '
  'planned before on_date) and next_planned (the earliest open planned date from on_date on). One '
  'row per client with items; never an amount.';

revoke all on function public.client_work_summary(date) from public, anon, service_role;
grant execute on function public.client_work_summary(date) to authenticated;
