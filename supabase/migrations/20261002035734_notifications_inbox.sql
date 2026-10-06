-- 5B decision 10: the Alerts list. Grouped by IST day on the screen, an "All | Unread" filter, and
-- consecutive notifications about the same record collapsed into one entry with a count
-- ("3 comments on Edit"), opening the record. Expand-only: one new read function, nothing else.
--
-- Entries are made here, not on the page, so a page of 20 is 20 entries and a run of rows about one
-- record never splits across two pages. A run is consecutive rows, newest first, that share the
-- record (entity + entity_id) and the IST day, each with a link to open: a row with nothing to open,
-- a different record or a new IST day starts a new entry (so a run never spans two of the screen's
-- day groups). An entry carries its newest row's fields, how many rows it holds, their kinds and
-- the ids of those still unread. Under "Unread" only unread rows are read, so runs form among them.
--
-- The caller's own rows only: security invoker (the notifications RLS) and recipient_id = auth.uid().

create or replace function public.notifications_inbox(
  p_unread_only boolean,
  p_offset integer,
  p_limit integer
)
returns table (
  id uuid,
  kind text,
  title text,
  body text,
  link text,
  created_at timestamptz,
  run_size integer,
  run_kinds text[],
  run_unread uuid[],
  total bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  with mine as (
    select n.id, n.kind, n.title, n.body, n.link, n.entity, n.entity_id, n.created_at, n.read_at,
           app.to_ist_date(n.created_at) as day
    from public.notifications n
    where n.recipient_id = auth.uid()
      and (not coalesce(p_unread_only, false) or n.read_at is null)
  ),
  marked as (
    select m.*,
      case
        when m.entity is not null and m.link is not null
         and lag(m.link) over w is not null
         and lag(m.entity) over w = m.entity
         and lag(m.entity_id) over w = m.entity_id
         and lag(m.day) over w = m.day
        then 0 else 1
      end as starts
    from mine m
    window w as (order by m.created_at desc, m.id desc)
  ),
  runs as (
    select k.*,
      sum(k.starts) over (order by k.created_at desc, k.id desc rows unbounded preceding) as run
    from marked k
  ),
  entries as (
    select
      r.run,
      (array_agg(r.id order by r.created_at desc, r.id desc))[1] as id,
      (array_agg(r.kind order by r.created_at desc, r.id desc))[1] as kind,
      (array_agg(r.title order by r.created_at desc, r.id desc))[1] as title,
      (array_agg(r.body order by r.created_at desc, r.id desc))[1] as body,
      (array_agg(r.link order by r.created_at desc, r.id desc))[1] as link,
      max(r.created_at) as created_at,
      count(*)::integer as run_size,
      array_agg(distinct r.kind order by r.kind) as run_kinds,
      coalesce(array_agg(r.id order by r.created_at desc, r.id desc) filter (where r.read_at is null),
               '{}'::uuid[]) as run_unread
    from runs r
    group by r.run
  )
  select e.id, e.kind, e.title, e.body, e.link, e.created_at, e.run_size, e.run_kinds, e.run_unread,
         count(*) over () as total
  from entries e
  order by e.run
  offset greatest(coalesce(p_offset, 0), 0)
  limit least(greatest(coalesce(p_limit, 20), 1), 50);
$$;

comment on function public.notifications_inbox(boolean, integer, integer) is
  '5B decision 10: the caller''s Alerts list, newest first; consecutive rows about the same record '
  'on the same IST day are one entry (newest row''s fields, run_size, run_kinds, run_unread ids); '
  'total = entries, for the pager. Own rows only (security invoker + recipient_id = auth.uid()).';

revoke all on function public.notifications_inbox(boolean, integer, integer) from public, anon;
grant execute on function public.notifications_inbox(boolean, integer, integer) to authenticated, service_role;
