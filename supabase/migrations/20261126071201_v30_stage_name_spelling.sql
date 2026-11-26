-- v3.0, the Owner's walk (step 7): Stage durations showed a stage named both "Ideation" and
-- "ideation" as "ideation", because the shown name was min(name), and lower case sorts first. The
-- shown name is now the period's most common spelling, a tie going to one that is neither all
-- lower case nor all capitals. Only the shown name changes: the grouping (lower(btrim(name))), the
-- figures, the guard and the grants are as before. A new function body only (expand-only; the
-- applied 20261125121000_v30_reports.sql is never edited).

create or replace function public.report_stage_durations(p_from date, p_to date)
returns table (
  project_id uuid,
  project_name text,
  client_name text,
  stage_key text,
  stage_name text,
  ticks integer,
  median_days numeric,
  longest_days numeric
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_window tstzrange := app.report_window(p_from, p_to);
  v_org uuid := (select m.org_id from app.current_member() m);
begin
  return query
  with touched as (
    select distinct s.item_id
    from public.project_item_stage_list s
    where s.org_id = v_org and s.archived_at is null
      and s.done_at >= lower(v_window) and s.done_at < upper(v_window)
  ),
  ordered as (
    select s.item_id, s.project_id, s.name, s.done_at,
      max(s.done_at) over (
        partition by s.item_id
        order by (s.group_label is not null),
          coalesce(s.group_position, '') collate "C",
          coalesce(s.group_label, '') collate "C",
          s.position collate "C",
          s.id
        rows between unbounded preceding and 1 preceding
      ) as previous_tick
    from public.project_item_stage_list s
    join touched x on x.item_id = s.item_id
    where s.archived_at is null
  ),
  spans as (
    select o.project_id, lower(btrim(o.name)) as stage_key, o.name,
      greatest(0, extract(epoch from o.done_at - coalesce(
        case when o.previous_tick <= o.done_at then o.previous_tick end,
        app.ist_day_start(cy.period_start),
        i.created_at
      )) / 86400) as days
    from ordered o
    join public.project_items i on i.id = o.item_id
    left join public.project_cycles cy on cy.id = i.cycle_id
    where o.done_at <@ v_window
  ),
  -- The name each stage key shows: its most common spelling in the period; on a tie, one that is
  -- neither all lower case nor all capitals ("Ideation" over "ideation" and "IDEATION").
  spellings as (
    select distinct on (w.stage_key) w.stage_key, w.name
    from (
      select g.stage_key, btrim(g.name) as name, count(*) as uses
      from spans g
      group by g.stage_key, btrim(g.name)
    ) w
    order by w.stage_key, w.uses desc,
      (w.name = lower(w.name)), (w.name = upper(w.name)), w.name collate "C"
  ),
  grouped as (
    select g.project_id, g.stage_key, count(*)::integer as ticks,
      percentile_cont(0.5) within group (order by g.days) as median_days,
      max(g.days) as longest_days
    from spans g
    group by grouping sets ((g.stage_key), (g.project_id, g.stage_key))
  )
  select g.project_id, p.name, c.name, g.stage_key, n.name, g.ticks,
    round(g.median_days::numeric, 1), round(g.longest_days::numeric, 1)
  from grouped g
  join spellings n on n.stage_key = g.stage_key
  left join public.projects p on p.id = g.project_id
  left join public.clients c on c.id = p.client_id
  order by g.project_id nulls first, g.median_days desc, g.ticks desc, g.stage_key;
end;
$$;

comment on function public.report_stage_durations(date, date) is
  'v3.0 (9.3, R7): deliverable stages ticked in an IST period, grouped by stage name ignoring case, '
  'overall (project_id null) and per project: ticks, median_days and longest_days since the '
  'previous tick on the deliverable in stage order (else its cycle''s start, else its creation). '
  'Groups and revision rounds are just stages. stage_name is the most common spelling in the '
  'period (a tie goes to one neither all lower case nor all capitals). reports.all only; security '
  'invoker.';

revoke all on function public.report_stage_durations(date, date) from public, anon, service_role;
grant execute on function public.report_stage_durations(date, date) to authenticated;
