-- v6.5 "Team view", unit 13 (owner 14 Nov 2026; the approved sample "4 · People (Admin)": "On leave ·
-- back Tue 17"; the advisor on #89, 25 Nov: no extra round trip). People for Admins reads one
-- function for Next booked and the day a person on leave is back.
--
-- Expand-only: one helper and one read function, no table, column, policy or permission key.
-- member_next_booking() (20261125132447) stays as it is; the People page calls this instead, so
-- the page still makes one call. Same rules as member_availability() and member_next_booking():
-- availability.view (the Owner and Admins), never a title, a client, a location or a task id, and
-- an Admin reads the fact of leave, never its type or reason.

-- The first day after `after_date` that `member_id` works: a working day for the organisation
-- (app.is_working_day: not a weekly off, not a holiday) on which no approved full-day leave or
-- comp leave covers them. Null when none in the next 62 days. In `app`, which the API does not expose.
create function app.member_back_on(p_member_id uuid, after_date date)
returns date
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_day date := after_date;
  v_leave public.leave_requests;
begin
  for i in 1..62 loop
    v_day := v_day + 1;
    if app.is_working_day(v_day) is not false then
      v_leave := app.leave_covering(p_member_id, v_day);
      if v_leave.id is null or v_leave.type = 'half_day' then
        return v_day;
      end if;
    end if;
  end loop;
  return null;
end;
$$;
revoke all on function app.member_back_on(uuid, date) from public, anon;
grant execute on function app.member_back_on(uuid, date) to authenticated, service_role;
comment on function app.member_back_on(uuid, date) is
  'v6.5 (unit 13): the first working day after after_date (app.is_working_day: weekly offs and '
  'holidays) on which no approved full-day leave or comp leave covers the member; a half day counts '
  'as back. Null beyond 62 days. Read by member_people_glance() only.';

create function public.member_people_glance(after_date date, days integer default 30)
returns table (
  member_id uuid, on_date date, start_at timestamptz, end_at timestamptz, all_day boolean,
  type_id uuid, type_name text, booked_by uuid, booked_by_name text, back_on date)
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
  with next_booking as (
    select * from public.member_next_booking(member_people_glance.after_date, member_people_glance.days)
  ),
  away as (
    -- On approved full-day leave or comp leave on after_date (the Owner is never on leave here,
    -- 6b.2): the day they are back.
    select m.id as member_id, app.member_back_on(m.id, member_people_glance.after_date) as back_on
    from public.members m
    where m.org_id = v_org and m.status = 'active' and m.role <> 'owner'
      and (app.leave_covering(m.id, member_people_glance.after_date)).type in ('leave', 'comp_leave')
  )
  select coalesce(n.member_id, a.member_id), n.on_date, n.start_at, n.end_at, n.all_day,
         n.type_id, n.type_name, n.booked_by, n.booked_by_name, a.back_on
  from next_booking n
  full join away a on a.member_id = n.member_id;
end;
$$;

revoke all on function public.member_people_glance(date, integer) from public, anon;
grant execute on function public.member_people_glance(date, integer) to authenticated, service_role;

comment on function public.member_people_glance(date, integer) is
  'v6.5 (unit 13, People for Admins). availability.view (the Owner and Admins; FORBIDDEN otherwise). '
  'Read only. One row per active member with a next booking or on full-day leave on after_date: '
  'member_next_booking()''s columns (null when none within days, 1–62) and back_on, the first working '
  'day after after_date with no approved full-day leave (app.member_back_on; null when not on leave). '
  'The fact of leave only, never its type or reason; never a title, a client, a location or a task id.';
