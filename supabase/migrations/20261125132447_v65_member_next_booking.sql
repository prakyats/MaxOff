-- v6.5 "Team view", unit 13 (owner 14 Nov 2026; #89 6874350719, 6874389662, 6874423650; plan
-- docs/handoff/v65-team-view-plan.md §2): People for Admins shows each person's **Next booked**
-- ("Thu 19 · Meeting 10 am · Sana").
--
-- Expand-only: one new read function, no table, column, policy or permission key. It answers from
-- the same bookings as member_availability() (v6.0 unit A, migration v60_availability_bookings),
-- under the same rules: every booking of every active person, the caller's own and the Owner's
-- too; a date-only event as all day; a completed or cancelled event is no booking; never a title,
-- a client, a location or a task id (ADR-0004). One row per person instead of one per person per
-- day, so the People page reads 15 rows, not 450.

create function public.member_next_booking(after_date date, days integer default 30)
returns table (
  member_id uuid, on_date date, start_at timestamptz, end_at timestamptz, all_day boolean,
  type_id uuid, type_name text, booked_by uuid, booked_by_name text)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_caller uuid;
  v_org uuid;
begin
  select m.id, m.org_id into v_caller, v_org from app.current_member() m;
  if v_caller is null then
    perform app.fail('UNAUTHENTICATED', 'Your account is not active.');
  end if;
  if not app.has_permission('availability.view') then
    perform app.fail('FORBIDDEN', 'Only the Owner and Admins see other people''s availability.');
  end if;
  if after_date is null or days is null or days < 1 or days > 62 then
    perform app.fail('VALIDATION', 'Look ahead between 1 and 62 days.');
  end if;

  return query
  select distinct on (a.member_id)
         a.member_id, t.event_date,
         t.event_start_at,
         case when t.event_start_at is null then null
              else coalesce(t.event_end_at, t.event_start_at + interval '1 hour') end,
         t.event_start_at is null,
         t.task_type_id, tt.name, t.created_by, cm.full_name
  from public.tasks t
  join public.task_assignees a on a.task_id = t.id and a.removed_at is null
  join public.members m on m.id = a.member_id and m.org_id = v_org and m.status = 'active'
  left join public.task_types tt on tt.id = t.task_type_id
  left join public.members cm on cm.id = t.created_by
  where t.org_id = v_org
    and t.state not in ('completed', 'cancelled')
    and t.event_date is not null
    and t.event_date > member_next_booking.after_date
    and t.event_date <= member_next_booking.after_date + member_next_booking.days
  -- The first booking: the earliest day, an all-day one before a timed one that day, then by start.
  order by a.member_id, t.event_date, t.event_start_at nulls first, tt.name, t.created_at;
end;
$$;

revoke all on function public.member_next_booking(date, integer) from public, anon;
grant execute on function public.member_next_booking(date, integer) to authenticated, service_role;

comment on function public.member_next_booking(date, integer) is
  'v6.5 (unit 13, People for Admins: Next booked). availability.view (the Owner and Admins; '
  'FORBIDDEN otherwise). Read only. Per active member of the caller''s organisation who has one, '
  'their first booking after after_date and within days (1–62): the event date, start and end (no '
  'end = one hour; a date-only event all_day with no start or end), the task type and who booked '
  'it (the task''s creator). The same bookings and rules as member_availability() (the caller''s '
  'own and the Owner''s included; completed and cancelled events are no booking); never a title, '
  'a client, a location or a task id.';
