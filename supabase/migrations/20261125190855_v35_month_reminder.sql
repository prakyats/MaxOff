-- v3.5 "Month close", U6: the reminder (kickoff 9 decision 19: "from the 6th until closed, a line on Reports
-- and one line in the digest; no push, no new job; a close or correction notifies nobody"; v3.5 Q8 and Q9,
-- advisor autopilot 2026-11-25, owner to confirm; WORKFLOWS §7.3).
--   app.month_close_reminder(org, today)        the oldest month M from the first priced month on that has no
--                                               snapshot and whose reminder is due (today is on or after the 6th
--                                               of the month after M, IST), and how many more such months:
--                                               {"month": "2026-09-01", "more": 0}; null when none. Months
--                                               only: it reads month_snapshots' month column and
--                                               app.first_priced_month, never a snapshot's data.
--   app.month_close_reminder_line(month, more, today)
--                                               the words: "September isn't closed yet", "September and 1 more
--                                               month aren't closed yet"; the year only when it is not today's
--                                               ("December 2026 isn't closed yet" in January). No amount.
--   public.month_close_reminder()               the Reports line's read: the Owner's (finance.view) answer of
--                                               the first helper for today (app.now(), so pgTAP can steer it).
--   app.digest_weekly_payload / _text           re-created with one key (month_close) and one line, last under
--                                               "Now". Every existing key and line is unchanged.
--
-- The weekly digest's "nothing to say" rule (app.digest_weekly_zero) is NOT changed: it does not count the
-- new key, so a week whose only content is this line sends no digest (new Q1, owner to confirm on the walk).
-- No new job, no new notification kind, no push: the digest stays the email-only owner_digest_weekly row
-- that the existing digest_weekly writes for the Owner.
--
-- EXPAND-ONLY: three new functions; two replaced in place (same signatures; create or replace keeps their
-- grants: service_role only). The earlier v3.5 migrations are untouched. Append-only.

-- 1. The reminder's months -----------------------------------------------------------------------------------
create function app.month_close_reminder(p_org uuid, p_today date)
returns jsonb
language sql
stable
set search_path = ''
as $$
  with due as (
    select m::date as month
    from generate_series(
      app.first_priced_month(p_org)::timestamp,
      (app.month_start(p_today) - interval '1 month')::timestamp,
      interval '1 month') m
    -- From the 6th of the month after M (IST).
    where (m + interval '1 month')::date + 5 <= p_today
      and not exists (
        select 1 from public.month_snapshots s where s.org_id = p_org and s.month = m::date)
  )
  select case when count(*) = 0 then null
              else jsonb_build_object('month', min(d.month), 'more', count(*) - 1) end
  from due d;
$$;
revoke all on function app.month_close_reminder(uuid, date) from public, anon, authenticated;
grant execute on function app.month_close_reminder(uuid, date) to service_role;
comment on function app.month_close_reminder(uuid, date) is
  'v3.5 U6 (decision 19, Q9; WORKFLOWS §7.3): the oldest month from the first priced month on with no snapshot whose reminder is due (on or after the 6th of the next month, IST, at p_today), and how many more: {month, more}; null when none. Months only, never a snapshot''s data or an amount. Internal (service_role): called by month_close_reminder() and app.digest_weekly_payload.';

-- 2. The reminder's words ------------------------------------------------------------------------------------
create function app.month_close_reminder_line(p_month date, p_more integer, p_today date)
returns text
language sql
immutable
set search_path = ''
as $$
  select to_char(p_month, 'FMMonth')
    || case when extract(year from p_month) <> extract(year from p_today) then to_char(p_month, ' YYYY') else '' end
    || case when p_more <= 0 then ' isn''t closed yet'
            else ' and ' || p_more || ' more month' || case when p_more = 1 then '' else 's' end
                 || ' aren''t closed yet' end;
$$;
revoke all on function app.month_close_reminder_line(date, integer, date) from public, anon, authenticated;
grant execute on function app.month_close_reminder_line(date, integer, date) to service_role;
comment on function app.month_close_reminder_line(date, integer, date) is
  'v3.5 U6 (Q8): the reminder''s words, the month only: "September isn''t closed yet", "September and 2 more months aren''t closed yet"; the year only when it is not p_today''s. Never an amount. Internal (service_role).';

-- 3. The weekly digest's payload: one key more ---------------------------------------------------------------
create or replace function app.digest_weekly_payload(p_org uuid, p_now timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_today date := app.to_ist_date(p_now);
  -- The window (amended decision 23): since the last digest sent before today, capped at seven days.
  v_last date := (
    select max(app.to_ist_date(n.created_at))
    from public.notifications n
    where n.org_id = p_org and n.kind = 'owner_digest_weekly'
      and n.created_at < app.ist_day_start(app.to_ist_date(p_now)));
  v_from date := greatest(app.to_ist_date(p_now) - 7, coalesce(v_last, app.to_ist_date(p_now) - 7));
  v_to date := app.to_ist_date(p_now) - 1;
  v_days jsonb;
  v_totals jsonb;
  v_daily jsonb;
  v_now jsonb;
  v_ahead jsonb;
  v_client_work jsonb;
begin
  -- The window's numbers, from its saved reports only (so the email and the reports agree).
  with dates as (
    select s::date as day from generate_series(v_from, v_to, interval '1 day') s
  ),
  days as (
    select d.day, r.id as report_id, r.data
    from dates d
    left join public.eod_reports r on r.org_id = p_org and r.report_date = d.day
  )
  select jsonb_agg(jsonb_build_object(
           'date', day, 'report_id', report_id, 'saved', data is not null,
           'present', coalesce((data #>> '{attendance,counts,present}')::int, 0),
           'on_leave', coalesce((data #>> '{attendance,counts,on_leave}')::int, 0),
           'absent', coalesce((data #>> '{attendance,counts,absent}')::int, 0),
           'end_not_recorded', coalesce((data #>> '{attendance,counts,end_not_recorded}')::int, 0),
           'overtime', coalesce((data #>> '{attendance,counts,overtime}')::int, 0),
           'completed', coalesce((data #>> '{tasks,completed,count}')::int, 0),
           'cancelled', coalesce((data #>> '{tasks,cancelled,count}')::int, 0),
           'created', coalesce((data #>> '{tasks,created,count}')::int, 0),
           'decisions', coalesce((data #>> '{decisions,attendance}')::int, 0)
             + coalesce((data #>> '{decisions,leave,approved}')::int, 0)
             + coalesce((data #>> '{decisions,leave,rejected}')::int, 0)
             + coalesce((data #>> '{decisions,comp_leave,granted}')::int, 0)
             + coalesce((data #>> '{decisions,comp_leave,revoked}')::int, 0)
             + coalesce((data #>> '{decisions,comp_leave,reviewed}')::int, 0)
             + coalesce((data #>> '{decisions,expense_claims}')::int, 0),
           'holiday', data #>> '{day_off,holiday}',
           'weekly_off', coalesce((data #>> '{day_off,weekly_off}')::boolean, false))
         order by day)
  into v_days
  from days;

  select jsonb_build_object(
    'present', sum((d ->> 'present')::int),
    'on_leave', sum((d ->> 'on_leave')::int),
    'absent', sum((d ->> 'absent')::int),
    'end_not_recorded', sum((d ->> 'end_not_recorded')::int),
    'overtime', sum((d ->> 'overtime')::int),
    'completed', sum((d ->> 'completed')::int),
    'cancelled', sum((d ->> 'cancelled')::int),
    'created', sum((d ->> 'created')::int),
    'decisions', sum((d ->> 'decisions')::int),
    'missing', count(*) filter (where not (d ->> 'saved')::boolean))
  into v_totals
  from jsonb_array_elements(v_days) d;

  -- Now: what waits for the Owner, what is overdue, who can't be reached (the daily digest's own
  -- counts, so the two agree), plus the attendance days and extra-work notes waiting.
  v_daily := app.owner_digest_payload(p_org, p_now);
  select jsonb_build_object(
    'waiting', jsonb_build_object(
      'tasks', coalesce((v_daily #>> '{tasks,waiting_for_owner}')::int, 0),
      'leave', coalesce((v_daily #>> '{requests,leave}')::int, 0),
      'expense_claims', coalesce((v_daily #>> '{requests,expense_claims}')::int, 0),
      'attendance', (
        select count(*) from public.attendance_days d join public.members m on m.id = d.member_id
        where m.org_id = p_org and m.status = 'active' and d.state = 'pending_review'),
      'extra_work', (
        select count(*) from public.extra_work_notes n join public.members m on m.id = n.member_id
        where m.org_id = p_org and m.status = 'active' and n.state = 'submitted')),
    'overdue', coalesce((v_daily #>> '{tasks,overdue}')::int, 0),
    'unreachable', coalesce(v_daily -> 'unreachable', '{"count": 0, "names": [], "more": 0}'::jsonb))
  into v_now;

  -- The week ahead (today and the next six days): approved and pending leave, event tasks, holidays.
  select jsonb_build_object(
    'from', v_today, 'to', v_today + 6,
    'leave', coalesce((
      select jsonb_agg(jsonb_build_object(
        'member_id', r.member_id, 'name', m.full_name, 'type', r.type,
        'from', greatest(r.start_date, v_today), 'to', least(r.end_date, v_today + 6),
        'pending', r.state = 'submitted')
        order by greatest(r.start_date, v_today), m.full_name, r.id)
      from public.leave_requests r
      join public.members m on m.id = r.member_id
      where m.org_id = p_org and m.status = 'active'
        and r.state in ('approved', 'submitted') and not (r.state = 'submitted' and r.requests_cancellation)
        and r.start_date <= v_today + 6 and r.end_date >= v_today), '[]'::jsonb),
    'events', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', t.id, 'title', t.title, 'date', t.event_date, 'start_at', t.event_start_at, 'location', t.location)
        order by t.event_date, t.event_start_at nulls first, t.title, t.id)
      from public.tasks t
      where t.org_id = p_org and t.archived_at is null and t.state <> 'cancelled'
        and t.event_date between v_today and v_today + 6), '[]'::jsonb),
    'holidays', coalesce((
      select jsonb_agg(jsonb_build_object('date', h.date, 'name', h.name) order by h.date)
      from public.holidays h where h.org_id = p_org and h.date between v_today and v_today + 6), '[]'::jsonb))
  into v_ahead;


  -- Client work per Admin (amendment C E4, owner 2026-10-08; replaces issue #56 Q3's line): the items
  -- done and the projects completed in the window from its saved reports (each event under the Admin
  -- who ran the client then), and the items overdue now (open, planned before today IST), under the
  -- client's current Admin. A client with no Admin is the Owner's own (admin_id null). Counts only.
  with saved as (
    select coalesce(e ->> 'admin_id', '') as admin_key,
           sum(coalesce((e #>> '{done,count}')::int, 0)) as done,
           sum(coalesce((e #>> '{projects_completed,count}')::int, 0)) as completed
    from public.eod_reports r
    cross join lateral jsonb_array_elements(coalesce(r.data #> '{client_work,admins}', '[]'::jsonb)) e
    where r.org_id = p_org and r.report_date between v_from and v_to
    group by 1
  ),
  overdue as (
    select coalesce(c.admin_id::text, '') as admin_key, count(*) as overdue
    from public.project_items i
    join public.projects p on p.id = i.project_id
    join public.clients c on c.id = p.client_id
    where i.org_id = p_org and i.state = 'open' and i.planned_date < v_today and p.held_at is null
    group by 1
  ),
  merged as (
    select coalesce(s.admin_key, o.admin_key) as admin_key, coalesce(s.done, 0) as done,
           coalesce(s.completed, 0) as completed, coalesce(o.overdue, 0) as overdue
    from saved s
    full join overdue o on o.admin_key = s.admin_key
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'admin_id', nullif(x.admin_key, ''), 'name', m.full_name,
           'done', x.done, 'overdue', x.overdue, 'projects_completed', x.completed)
           order by m.full_name nulls last, x.admin_key), '[]'::jsonb)
  into v_client_work
  from merged x
  left join public.members m on m.id = nullif(x.admin_key, '')::uuid
  where x.done + x.overdue + x.completed > 0;

  return jsonb_build_object(
    'date', v_today,
    'week', jsonb_build_object('from', v_from, 'to', v_to),
    'days', v_days,
    'totals', v_totals,
    'now', v_now,
    'ahead', v_ahead,
    'client_work', v_client_work,
    -- v3.5 U6 (decision 19, Q8, Q9): the oldest month from the first priced month on that is still not
    -- closed, from the 6th of the month after it (IST), and how many more; null when none. The month
    -- only, never an amount. Not counted by app.digest_weekly_zero: a week with only this line is not sent.
    'month_close', app.month_close_reminder(p_org, v_today));
end;
$function$;

-- 4. The weekly digest's text: one line more, last in Now -----------------------------------------------------
create or replace function app.digest_weekly_text(p jsonb)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
declare
  v_lines text[] := '{}';
  v_section text[];
  v_item jsonb;
  v_n integer;
begin
  v_section := '{}';
  if (p #>> '{totals,present}')::int > 0 then v_section := v_section || ('Present: ' || (p #>> '{totals,present}') || ' person-days'); end if;
  if (p #>> '{totals,on_leave}')::int > 0 then v_section := v_section || ('On leave: ' || (p #>> '{totals,on_leave}') || ' person-days'); end if;
  if (p #>> '{totals,absent}')::int > 0 then v_section := v_section || ('Absent: ' || (p #>> '{totals,absent}') || ' person-days'); end if;
  if (p #>> '{totals,end_not_recorded}')::int > 0 then v_section := v_section || ('End of day not recorded: ' || (p #>> '{totals,end_not_recorded}')); end if;
  if (p #>> '{totals,overtime}')::int > 0 then v_section := v_section || ('Overtime flagged: ' || (p #>> '{totals,overtime}')); end if;
  if (p #>> '{totals,completed}')::int > 0 then v_section := v_section || ('Tasks completed: ' || (p #>> '{totals,completed}')); end if;
  if (p #>> '{totals,created}')::int > 0 then v_section := v_section || ('Tasks created: ' || (p #>> '{totals,created}')); end if;
  if (p #>> '{totals,cancelled}')::int > 0 then v_section := v_section || ('Tasks cancelled: ' || (p #>> '{totals,cancelled}')); end if;
  if (p #>> '{totals,decisions}')::int > 0 then v_section := v_section || ('Decisions you made: ' || (p #>> '{totals,decisions}')); end if;
  if (p #>> '{totals,missing}')::int > 0 then v_section := v_section || ('Days without a saved report: ' || (p #>> '{totals,missing}')); end if;
  if cardinality(v_section) > 0 then
    v_lines := v_lines || array['', 'The week: ' || app.notify_span((p #>> '{week,from}')::date, (p #>> '{week,to}')::date)] || v_section;
  end if;

  v_section := '{}';
  if (p #>> '{now,waiting,tasks}')::int > 0 then v_section := v_section || ('Tasks waiting for your approval: ' || (p #>> '{now,waiting,tasks}')); end if;
  if (p #>> '{now,waiting,attendance}')::int > 0 then v_section := v_section || ('Attendance waiting for a decision: ' || (p #>> '{now,waiting,attendance}')); end if;
  if (p #>> '{now,waiting,leave}')::int > 0 then v_section := v_section || ('Leave requests: ' || (p #>> '{now,waiting,leave}')); end if;
  if (p #>> '{now,waiting,extra_work}')::int > 0 then v_section := v_section || ('Extra work notes: ' || (p #>> '{now,waiting,extra_work}')); end if;
  if (p #>> '{now,waiting,expense_claims}')::int > 0 then v_section := v_section || ('Expense claims: ' || (p #>> '{now,waiting,expense_claims}')); end if;
  if (p #>> '{now,overdue}')::int > 0 then v_section := v_section || ('Overdue now: ' || (p #>> '{now,overdue}')); end if;
  if (p #>> '{now,unreachable,count}')::int > 0 then v_section := v_section || ('Can''t be reached: ' || (p #>> '{now,unreachable,count}')); end if;
  -- v3.5 U6: "September isn't closed yet" (the month only, never an amount), last in Now.
  if jsonb_typeof(p -> 'month_close') = 'object' then
    v_section := v_section || app.month_close_reminder_line((p #>> '{month_close,month}')::date,
      (p #>> '{month_close,more}')::int, (p ->> 'date')::date);
  end if;
  if cardinality(v_section) > 0 then
    v_lines := v_lines || array['', 'Now'] || v_section;
  end if;

  v_section := '{}';
  v_n := coalesce(jsonb_array_length(p #> '{ahead,leave}'), 0);
  if v_n > 0 then v_section := v_section || ('On leave or asking for it: ' || v_n); end if;
  v_n := coalesce(jsonb_array_length(p #> '{ahead,events}'), 0);
  if v_n > 0 then v_section := v_section || ('Events: ' || v_n); end if;
  for v_item in select * from jsonb_array_elements(coalesce(p #> '{ahead,holidays}', '[]'::jsonb)) loop
    v_section := v_section || ('Holiday ' || app.notify_date((v_item ->> 'date')::date) || ': ' || (v_item ->> 'name'));
  end loop;
  if cardinality(v_section) > 0 then
    v_lines := v_lines || array['', 'The week ahead'] || v_section;
  end if;

  if cardinality(v_lines) = 0 then
    return 'Nothing needs you this week.';
  end if;
  return btrim(array_to_string(v_lines, E'\n'), E'\n');
end;
$function$;

comment on function app.digest_weekly_payload(uuid, timestamptz) is
  '6.5, service_role only (kickoff 6 decision 23, amended 2026-10-08): the weekly Owner digest at p_now: the IST days since the last weekly digest was sent (one sent before p_now''s day) up to yesterday, at most the seven days before p_now, from their saved end-of-day reports only (a day with no report reads as zero, saved false), and their totals; now (waiting for the Owner, overdue, can''t be reached, from the daily digest''s own builder); the week ahead (leave approved and pending, event tasks, holidays, today to six days on); since 7.4 the client work per Admin (amendment C E4: items done and projects completed in the window from the saved reports, items overdue now); since v3.5 U6 month_close, the oldest month not closed yet and how many more (app.month_close_reminder; the month only, not counted by digest_weekly_zero). Never an amount.';
comment on function app.digest_weekly_text(jsonb) is
  '6.5, service_role only: the weekly digest payload''s lines as plain text (zero lines and empty sections left out; "Nothing needs you this week." when all are), the row''s body. Since v3.5 U6 the last line under Now is the month close reminder ("September isn''t closed yet"), the month only.';

-- 5. The Reports line's read ---------------------------------------------------------------------------------
create function public.month_close_reminder()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid;
begin
  if not app.has_permission('finance.view') then
    perform app.fail('FORBIDDEN', 'Only the Owner sees which months are closed.');
  end if;
  select c.org_id into v_org from app.current_member() c;
  return app.month_close_reminder(v_org, app.to_ist_date(app.now()));
end;
$$;
revoke all on function public.month_close_reminder() from public, anon;
grant execute on function public.month_close_reminder() to authenticated, service_role;
comment on function public.month_close_reminder() is
  'v3.5 U6 (decision 19, Q9; WORKFLOWS §7.3): the Owner''s Reports line: the oldest month from the first priced month on that is still not closed, from the 6th of the next month (IST), and how many more: {month, more}, or null. finance.view only (one refusal for everyone else); months only, never an amount. Security definer: the first priced month reads the money tables.';
