-- v1.8 V5b-D (the approved pull-in sample, item 4): Alerts as one continuous list. The list is read
-- in keyset pages ("Show older" loads the entries older than the last one shown, so a new alert
-- never shifts or repeats a row), and each entry carries its actor's name and photo from the same
-- read (the photo leads the row; no per-row lookup).
--
-- public.notifications_inbox_page(p_unread_only, p_before_at, p_before_id, p_limit): the caller's
-- own entries, newest first, made exactly as notifications_inbox (20261002035734) makes them
-- (consecutive rows about the same record on the same IST day are one entry: the newest row's
-- fields, run_size, run_kinds, run_unread), plus:
--   - the cursor: with p_before_at / p_before_id (the newest row of the last entry shown) only that
--     row and older ones are read (notifications_recipient_created_idx), the entry that holds the
--     cursor row is left out, and the rest follow. The cursor row is read even when the Unread
--     filter would drop it (read since), so its run is still recognised and never shown twice.
--   - actor_id: the newest row's actor (null for a job's notification); actor_name and
--     actor_avatar_file_id from public.member_directory, so the caller reads only what their
--     directory already shows them (PERMISSIONS §2; the photo itself is app.file_visible's, and
--     every active member reads every member's current photo since w2_avatar_visibility).
--   - no total: the list has no pager. At most 51 entries a call (a page of 50 and one to say
--     there are more).
-- Security invoker + recipient_id = auth.uid(), as notifications_inbox: the notifications RLS
-- (own rows, in-app kinds only) applies. notifications_inbox stays as it is (expand-only).
--
-- EXPAND-ONLY (ARCHITECTURE §18): a new function, no table or data touched. Append-only.

create or replace function public.notifications_inbox_page(
  p_unread_only boolean,
  p_before_at timestamptz,
  p_before_id uuid,
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
  actor_id uuid,
  actor_name text,
  actor_avatar_file_id uuid
)
language sql
stable
security invoker
set search_path = ''
as $$
  with mine as (
    select n.id, n.kind, n.title, n.body, n.link, n.entity, n.entity_id, n.created_at, n.read_at,
           n.actor_id, app.to_ist_date(n.created_at) as day
    from public.notifications n
    where n.recipient_id = auth.uid()
      and (p_before_at is null or (n.created_at, n.id) <= (p_before_at, p_before_id))
      and (not coalesce(p_unread_only, false) or n.read_at is null
           or (p_before_id is not null and n.id = p_before_id))
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
      (array_agg(r.actor_id order by r.created_at desc, r.id desc))[1] as actor_id,
      max(r.created_at) as created_at,
      count(*)::integer as run_size,
      array_agg(distinct r.kind order by r.kind) as run_kinds,
      coalesce(array_agg(r.id order by r.created_at desc, r.id desc) filter (where r.read_at is null),
               '{}'::uuid[]) as run_unread
    from runs r
    group by r.run
  )
  select e.id, e.kind, e.title, e.body, e.link, e.created_at, e.run_size, e.run_kinds, e.run_unread,
         e.actor_id, d.full_name, d.avatar_file_id
  from entries e
  left join public.member_directory d on d.id = e.actor_id
  where p_before_id is null or e.id <> p_before_id
  order by e.run
  limit least(greatest(coalesce(p_limit, 20), 1), 51);
$$;

comment on function public.notifications_inbox_page(boolean, timestamptz, uuid, integer) is
  'v1.8 V5b-D: the caller''s Alerts in keyset pages, newest first, entries made as '
  'notifications_inbox (same-record runs on one IST day); before (created_at, id) = the newest row '
  'of the last entry shown; actor_id with the actor''s name and photo from member_directory. Own '
  'rows only (security invoker + recipient_id = auth.uid()); at most 51 a call.';

revoke all on function public.notifications_inbox_page(boolean, timestamptz, uuid, integer) from public, anon;
grant execute on function public.notifications_inbox_page(boolean, timestamptz, uuid, integer) to authenticated, service_role;
