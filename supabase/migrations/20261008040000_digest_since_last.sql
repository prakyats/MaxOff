-- Kickoff 6 decision 23, amended by the owner (2026-10-08, unit 6B2): the weekly digest's "one per
-- week" is "since the last digest sent, capped at seven days", so changing the digest day never
-- skips a week. Before this, a digest went only when none had gone in the six days before the
-- digest day, so moving `org_settings.weekly_digest_day` (earlier or later in the week) landed
-- inside that window: the first occurrence of the new day was skipped and the days between were
-- never summarised (6B review, later item (a)).
--
-- Now:
-- * app.digest_weekly_payload(p_org, p_now) covers the IST days from the day the last weekly
--   digest was sent (one sent before p_now's day) up to yesterday, at most the seven days before
--   p_now (the first digest, or one after a gap longer than a week, covers seven). A digest covers
--   the days up to the day before it was sent, so the next one starts on that day: no day falls
--   between two.
-- * public.digest_weekly(p_now) still sends on the digest day at or after 08:00 IST once
--   yesterday's report is saved, now unless one already went that day (a re-fired tick never sends
--   two); its title names the days it covers.
-- Both re-created with the same signatures (expand-only: nothing dropped; grants, the kind and the
-- cron row unchanged). The email's renderer already takes one to seven days
-- (src/core/notifications/weekly-digest-content.ts).

create or replace function app.digest_weekly_payload(p_org uuid, p_now timestamptz)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
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

  return jsonb_build_object(
    'date', v_today,
    'week', jsonb_build_object('from', v_from, 'to', v_to),
    'days', v_days,
    'totals', v_totals,
    'now', v_now,
    'ahead', v_ahead);
end;
$$;
comment on function app.digest_weekly_payload(uuid, timestamptz) is
  '6.5, service_role only (kickoff 6 decision 23, amended 2026-10-08): the weekly Owner digest at '
  'p_now: the IST days since the last weekly digest was sent (one sent before p_now''s day) up to '
  'yesterday, at most the seven days before p_now, from their saved end-of-day reports only (a day '
  'with no report reads as zero, saved false), and their totals; now (waiting for the Owner, '
  'overdue, can''t be reached, from the daily digest''s own builder); the week ahead (leave approved '
  'and pending, event tasks, holidays, today to six days on). Never an amount.';

create or replace function public.digest_weekly(p_now timestamptz default now())
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org record;
  v_owner uuid;
  v_today date := app.to_ist_date(p_now);
  v_payload jsonb;
  v_count integer := 0;
begin
  for v_org in
    select o.id, s.weekly_digest_day
    from public.organizations o
    join public.org_settings s on s.org_id = o.id
    order by o.id
  loop
    perform pg_advisory_xact_lock(hashtext('digest_weekly:' || v_org.id::text));
    -- The digest day, at or after 08:00 IST (decision 23).
    if extract(dow from v_today)::int <> v_org.weekly_digest_day
       or (p_now at time zone 'Asia/Kolkata')::time < time '08:00' then
      continue;
    end if;
    v_owner := app.org_owner_id(v_org.id);
    if v_owner is null then
      continue;
    end if;
    -- Straight after the End-day cutoff saved the last day's report, whichever is later: not
    -- before yesterday's row exists (so every report the window needs is there).
    if not exists (select 1 from public.eod_reports r where r.org_id = v_org.id and r.report_date = v_today - 1) then
      continue;
    end if;
    -- One a day at most (a re-fired tick never sends two). The window starts where the last one
    -- ended (amended decision 23), so a moved digest day sends on its first occurrence.
    if exists (
      select 1 from public.notifications n
      where n.org_id = v_org.id and n.kind = 'owner_digest_weekly'
        and n.created_at >= app.ist_day_start(v_today)
    ) then
      continue;
    end if;
    v_payload := app.digest_weekly_payload(v_org.id, p_now);
    if app.digest_weekly_zero(v_payload) then
      continue;
    end if;
    -- Written directly (not app.notify), as the daily digest was: no push delivery; read at once.
    insert into public.notifications (org_id, recipient_id, kind, title, body, link, payload, created_at, read_at)
    values (v_org.id, v_owner, 'owner_digest_weekly',
            'Your week · ' || app.notify_span((v_payload #>> '{week,from}')::date, (v_payload #>> '{week,to}')::date),
            left(app.digest_weekly_text(v_payload), 2000), '/reports/end-of-day', v_payload, p_now, p_now);
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;
comment on function public.digest_weekly(timestamptz) is
  '6.5, service_role only (pg_cron digest_weekly, every 5 minutes; kickoff 6 decision 23, amended '
  '2026-10-08): on org_settings.weekly_digest_day at or after 08:00 IST, once yesterday''s '
  'end-of-day report is saved (so after a late End-day cutoff), one owner_digest_weekly row for the '
  'active Owner covering the days since the last digest (at most seven), none when one already went '
  'that day, none when every count is zero. Read at insert, no push; the dispatcher emails it '
  '(email_claim). Returns how many rows it wrote.';
