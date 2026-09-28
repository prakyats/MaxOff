-- 3b.4 Month summary (PRODUCT §4.18, kickoff 3b decisions 18-20, 30, 31; DATA-MODEL §7b,
--   WORKFLOWS §2b).
--
-- month_summary(month, member_id): per person per IST month, live, for the Owner
-- (attendance.view_all): working days, days worked, leave, half days, absent, comp leave used,
-- additional leave, days off worked, days waiting for review, overtime notes and grants, comp
-- credits granted / used / expired. Only days the Owner decided count (invariant 7); a day still
-- waiting is its own line. Days recorded by the 2.x gate count like any other: their
-- final_status is the same (decision 31). No money here: the approved-unpaid expense line comes
-- from modules/expenses beside it.
--
-- EXPAND-ONLY (ARCHITECTURE §18): one new read function, nothing else.
-- Append-only: never edit once applied.

create function public.month_summary(month date, member_id uuid default null)
returns table (
  id uuid,
  full_name text,
  role public.member_role,
  status public.member_status,
  working_days integer,
  days_worked numeric,
  present_days integer,
  leave_days integer,
  half_days integer,
  absent_days integer,
  comp_leave_days numeric,
  additional_leave numeric,
  days_off_worked integer,
  pending_days integer,
  overtime_notes integer,
  overtime_granted integer,
  credits_granted numeric,
  credits_used numeric,
  credits_expired numeric
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_caller uuid;
  v_org uuid;
  v_first date;
  v_last date;
  v_today date := app.today_ist();
  v_working integer;
begin
  select m.id, m.org_id into v_caller, v_org from app.current_member() m;
  if v_caller is null then
    perform app.fail('UNAUTHENTICATED', 'Your account is not active.');
  end if;
  if not app.has_permission('attendance.view_all') then
    perform app.fail('FORBIDDEN', 'The month summary is the Owner''s.');
  end if;
  if month_summary.month is null then
    perform app.fail('VALIDATION', 'Pick a month.');
  end if;

  v_first := date_trunc('month', month_summary.month::timestamp)::date;
  v_last := app.ist_month_end(v_first);
  select count(*)::integer into v_working
  from generate_series(v_first, v_last, interval '1 day') g(d)
  where app.is_working_day(g.d::date) is not false;

  return query
  with people as (
    select m.id, m.full_name, m.role, m.status
    from public.members m
    where m.org_id = v_org
      and (month_summary.member_id is null or m.id = month_summary.member_id)
      and m.status <> 'invited'
      and m.joined_at is not null
      and app.to_ist_date(m.joined_at) <= v_last
      and (m.deactivated_at is null or app.to_ist_date(m.deactivated_at) >= v_first)
      -- Whoever marks attendance (Admins and Staff): the Owner has no day. Phase 4 adds
      -- engagement = 'permanent' here (freelancers are not in the summary, decision 20).
      and exists (select 1 from public.role_permissions rp
                  where rp.role = m.role and rp.permission = 'attendance.self')
  ),
  days as (
    select d.member_id,
           count(*) filter (where d.decided and d.final_status = 'present' and not d.is_day_off) as present,
           count(*) filter (where d.decided and d.final_status = 'present' and d.is_day_off) as off_worked,
           count(*) filter (where d.decided and d.final_status = 'leave' and not d.is_day_off) as leave,
           count(*) filter (where d.decided and d.final_status = 'half_day' and not d.is_day_off and not d.comp_half) as half,
           count(*) filter (where d.decided and d.final_status = 'half_day' and not d.is_day_off and d.comp_half) as comp_half,
           count(*) filter (where d.decided and d.final_status = 'comp_leave' and not d.is_day_off) as comp_full,
           count(*) filter (where d.decided and d.final_status = 'absent' and not d.is_day_off) as absent,
           count(*) filter (where d.state = 'pending_review') as pending
    from (
      select a.member_id, a.final_status, a.is_day_off, a.state,
             a.state in ('approved', 'corrected') as decided,
             -- A half day that used a comp credit (3b.2) is comp leave, never additional leave.
             coalesce(r.credit_days is not null, false) as comp_half
      from public.attendance_days a
      left join public.leave_requests r on r.id = a.leave_request_id
      where a.member_id in (select p.id from people p)
        and a.work_date between v_first and v_last
    ) d
    group by d.member_id
  ),
  notes as (
    select n.member_id,
           count(*) as total,
           count(*) filter (where n.decision = 'granted') as granted
    from public.extra_work_notes n
    where n.member_id in (select p.id from people p)
      and n.kind = 'overtime'
      and n.work_date between v_first and v_last
    group by n.member_id
  ),
  credits as (
    select c.member_id,
           sum(c.days) as granted,
           sum(c.used_days) as used,
           sum(case when c.expires_on < v_today then c.days - c.used_days - c.reserved_days else 0 end) as expired
    from public.comp_leave_credits c
    where c.member_id in (select p.id from people p)
      and c.revoked_at is null
      and c.granted_on between v_first and v_last
    group by c.member_id
  )
  select p.id,
         p.full_name,
         p.role,
         p.status,
         v_working,
         coalesce(d.present, 0) + 0.5 * (coalesce(d.half, 0) + coalesce(d.comp_half, 0)),
         coalesce(d.present, 0)::integer,
         coalesce(d.leave, 0)::integer,
         coalesce(d.half, 0)::integer,
         coalesce(d.absent, 0)::integer,
         coalesce(d.comp_full, 0) + 0.5 * coalesce(d.comp_half, 0),
         coalesce(d.leave, 0) + 0.5 * coalesce(d.half, 0) + coalesce(d.absent, 0),
         coalesce(d.off_worked, 0)::integer,
         coalesce(d.pending, 0)::integer,
         coalesce(n.total, 0)::integer,
         coalesce(n.granted, 0)::integer,
         coalesce(c.granted, 0),
         coalesce(c.used, 0),
         coalesce(c.expired, 0)
  from people p
  left join days d on d.member_id = p.id
  left join notes n on n.member_id = p.id
  left join credits c on c.member_id = p.id
  order by p.full_name, p.id;
end;
$$;

revoke all on function public.month_summary(date, uuid) from public, anon;
grant execute on function public.month_summary(date, uuid) to authenticated, service_role;

comment on function public.month_summary(date, uuid) is
  'attendance.view_all (the Owner). One row per person who marks attendance (id = the member), over '
  'the IST month of `month` (one person with member_id): working_days, days_worked (decided Present on a working day + ½ per '
  'decided half day), present / leave / half / absent days, comp_leave_days (comp_leave days + ½ '
  'per half day that used a comp credit), additional_leave (leave + ½ × half + absent; comp leave '
  'never counts), days_off_worked, pending_days (waiting for the Owner), overtime notes and grants, '
  'the month''s unrevoked comp credits granted / used / expired. Decided = approved | corrected. '
  'Live: no snapshot. No money. Notifies nobody.';
