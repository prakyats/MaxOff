-- v6.0 "Admin calendar": the availability data change (owner 13 and 14 Nov 2026; #89 6847654724,
-- 6874042506; PERMISSIONS §2 "Availability of others", WORKFLOWS §3.1 "Assignment warnings",
-- DATA-MODEL "member_availability()").
--
-- Expand-only. member_availability() is re-created with the same signature, the same columns and
-- the same grants; only the event_blocks JSON grows:
--   1. each block names its task type (type_id, type_name) and who booked it (booked_by,
--      booked_by_name: the task's creator), so an Admin reads "Asha · Shoot · 2–4 pm · booked by
--      Nikhil";
--   2. a date-only event (an event date with no start) is a block too: all_day true, start_at and
--      end_at null. It makes the person busy all day and clashes with any timed event that day;
--   3. every block carries all_day (false for a timed one).
-- Still never a title, a client, a location or a task id (ADR-0004). Every booking of every person
-- is answered, the caller's own and the Owner's too. Crew stay FORBIDDEN. No table, column, policy
-- or permission key changes. The code of the release before reads start_at and end_at only and
-- drops a block with no start, so it runs unchanged against this function.

create or replace function public.member_availability(from_date date, to_date date, member_ids uuid[] default null)
returns table (
  member_id uuid, engagement public.engagement, day date,
  open_tasks_due integer, event_blocks jsonb, leave text, present boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_caller uuid;
  v_org uuid;
  v_today date := app.today_ist();
begin
  select m.id, m.org_id into v_caller, v_org from app.current_member() m;
  if v_caller is null then
    perform app.fail('UNAUTHENTICATED', 'Your account is not active.');
  end if;
  if not app.has_permission('availability.view') then
    perform app.fail('FORBIDDEN', 'Only the Owner and Admins see other people''s availability.');
  end if;
  if from_date is null or to_date is null or to_date < from_date then
    perform app.fail('VALIDATION', 'Pick a date range.');
  end if;
  if to_date - from_date > 61 then
    perform app.fail('VALIDATION', 'Ask for two months at most.');
  end if;

  return query
  with people as (
    -- 6b.2: the Owner too (the Owner may be on tasks now): busy blocks and open tasks, never leave.
    select m.id, m.engagement, m.role = 'owner' as is_owner
    from public.members m
    where m.org_id = v_org and m.status = 'active'
      and (member_availability.member_ids is null or m.id = any (member_availability.member_ids))
  ),
  days as (
    select s::date as day from generate_series(from_date, to_date, interval '1 day') s
  ),
  open_tasks as (
    select a.member_id, app.to_ist_date(t.due_at) as day, count(*)::integer as n
    from public.tasks t
    join public.task_assignees a on a.task_id = t.id and a.removed_at is null
    where t.org_id = v_org
      and t.state not in ('completed', 'cancelled')
      and app.to_ist_date(t.due_at) between from_date and to_date
    group by a.member_id, app.to_ist_date(t.due_at)
  ),
  events as (
    -- v6.0: the type and who booked it; a date-only event is busy all day. The all-day blocks
    -- first, then by start. Never the title, the client, the location or the task's id.
    select a.member_id, t.event_date as day,
           jsonb_agg(jsonb_build_object(
             'start_at', t.event_start_at,
             'end_at', case when t.event_start_at is null then null
                            else coalesce(t.event_end_at, t.event_start_at + interval '1 hour') end,
             'all_day', t.event_start_at is null,
             'type_id', t.task_type_id,
             'type_name', tt.name,
             'booked_by', t.created_by,
             'booked_by_name', cm.full_name)
             order by t.event_start_at nulls first, tt.name, t.created_at) as blocks
    from public.tasks t
    join public.task_assignees a on a.task_id = t.id and a.removed_at is null
    left join public.task_types tt on tt.id = t.task_type_id
    left join public.members cm on cm.id = t.created_by
    where t.org_id = v_org
      and t.state not in ('completed', 'cancelled')
      and t.event_date is not null
      and t.event_date between from_date and to_date
    group by a.member_id, t.event_date
  )
  select p.id, p.engagement, d.day,
         coalesce(o.n, 0),
         coalesce(e.blocks, '[]'::jsonb),
         case when p.engagement = 'freelance' or p.is_owner then null
              else coalesce(
                (select r.type::text from public.leave_requests r
                 where r.member_id = p.id and r.state = 'approved'
                   and r.start_date <= d.day and r.end_date >= d.day
                 order by r.decided_at desc, r.created_at desc limit 1),
                (select 'requested' from public.leave_requests r
                 where r.member_id = p.id and r.state = 'submitted' and not r.requests_cancellation
                   and r.start_date <= d.day and r.end_date >= d.day limit 1)) end,
         case when d.day = v_today and p.engagement = 'permanent' and not p.is_owner
              then exists (select 1 from public.attendance_days ad
                           where ad.member_id = p.id and ad.work_date = d.day and ad.started_at is not null)
              end
  from people p
  cross join days d
  left join open_tasks o on o.member_id = p.id and o.day = d.day
  left join events e on e.member_id = p.id and e.day = d.day
  order by p.id, d.day;
end;
$$;

revoke all on function public.member_availability(date, date, uuid[]) from public, anon;
grant execute on function public.member_availability(date, date, uuid[]) to authenticated, service_role;

comment on function public.member_availability(date, date, uuid[]) is
  'availability.view (the Owner and Admins; FORBIDDEN otherwise). Read only. One row per active '
  'member, the Owner too since 6b.2 with leave and present null (or the ids given) per IST day of '
  'the range (62 days at most): open_tasks_due (tasks not completed / cancelled due that day), '
  'event_blocks (their event tasks that day, the caller''s own included: [{start_at, end_at, '
  'all_day, type_id, type_name, booked_by, booked_by_name}]; no end = one hour; since v6.0 the '
  'task type and the task''s creator, and a date-only event as all_day true with no start or end; '
  'never a title, a client, a location or a task id), leave (the approved leave type covering the '
  'day, else requested for a pending request; null for a freelancer), present (today only, for an '
  'employee: a Start day recorded). Counts and busy blocks, never the tasks themselves (ADR-0004). '
  'What the 4.3 assignment warnings and the calendar''s Busy / On leave / Free are computed from.';
