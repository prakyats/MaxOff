-- 5B slice 7: the Owner's daily digest email (owner decisions 2026-10-03, PROGRESS "Slice 7").
-- Expand-only: one column with a default, one kind, the notifications SELECT policy re-created,
-- email_claim re-created with one more result column (the old dispatcher ignores it during a
-- rollout), four new functions and one pg_cron job. No data is rewritten.
--
-- * **Email only.** notification_kinds.in_app (default true: every existing kind unchanged); the
--   digest's kind `owner_digest` has in_app = false. The notifications SELECT policy hides a row
--   of such a kind from the API role, so the bell, its unread count, the Alerts list
--   (notifications_inbox is security invoker) and Realtime (which checks this policy) never see
--   it. The row is written read (read_at = its own time), so it is never unread anywhere, and the
--   90-day removal of read rows will clear it. It is written here directly, not through
--   app.notify(), so no push delivery is ever queued for it (app.notify always queues one).
-- * **Once a day, never skipped.** public.digest_daily(p_now), pg_cron at 02:30 UTC = 08:00 IST:
--   for each organisation's active Owner, one row per IST day (an advisory lock per organisation,
--   and nothing when that day's row exists: a re-fired job never sends two). Counts only, never an
--   amount: app.owner_digest_payload(org, now). The every-minute dispatcher sends it.
-- * **Capped as an ordinary email, before the others.** email_claim keeps every rule of
--   email_batches; the digest is always an email of its own (never in a person's batch), it is
--   taken into a run before other ordinary rows and ordered after escalations and before every
--   other ordinary group; the ordinary ceilings apply (org cap - 10, the per-person cap).
-- * **The sample on the preview.** owner_digest_preview(): the same payload for now, for the
--   organisation's Owner only, writing nothing (`/diagnostics/digest`, never on production).

-- 1. The kind ------------------------------------------------------------------------------------------
alter table public.notification_kinds add column in_app boolean not null default true;
comment on column public.notification_kinds.in_app is
  '5B (owner_digest): false = email only. Never visible to the API role (the notifications SELECT '
  'policy), so never in the bell, its count, the Alerts list or Realtime; never pushed.';

insert into public.notification_kinds (kind, actionable, always_email, in_app, description) values
  ('owner_digest', false, true, false, 'The Owner''s 08:00 morning summary (email only, counts, never an amount)');

-- 2. Hidden in-app --------------------------------------------------------------------------------------
drop policy notifications_select on public.notifications;
create policy notifications_select on public.notifications for select to authenticated
  using (
    recipient_id = auth.uid()
    and kind not in (select k.kind from public.notification_kinds k where not k.in_app)
  );

-- 3. What the digest says ---------------------------------------------------------------------------------
create function app.owner_digest_payload(p_org uuid, p_now timestamptz)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_today date := app.to_ist_date(p_now);
  v_yesterday date := app.to_ist_date(p_now) - 1;
  v_from timestamptz := app.ist_day_start(app.to_ist_date(p_now) - 1);
  v_to timestamptz := app.ist_day_start(app.to_ist_date(p_now));
  v_owner uuid := app.org_owner_id(p_org);
  v_attendance jsonb;
  v_tasks jsonb;
  v_requests jsonb;
  v_held jsonb;
begin
  -- Attendance yesterday: the days of the organisation's active members. A day still waiting for
  -- the Owner counts by what it stands at (the choice made, else the system's proposal: the
  -- `coalesce(submitted_choice, final_status)` that attendance_decide approves and Start day reads).
  with days as (
    select m.id, m.full_name, d.end_not_recorded,
           case when d.state = 'pending_review'
                then coalesce(d.submitted_choice::text::public.day_status, d.final_status)
                else d.final_status end as status
    from public.attendance_days d
    join public.members m on m.id = d.member_id
    where m.org_id = p_org and m.status = 'active' and d.work_date = v_yesterday
  ),
  absent as (
    select d.full_name, row_number() over (order by d.full_name, d.id) as n
    from days d where d.status = 'absent'
  ),
  not_ended as (
    select d.full_name, row_number() over (order by d.full_name, d.id) as n
    from days d where d.end_not_recorded
  )
  select jsonb_build_object(
    'present', (select count(*) from days where status = 'present'),
    'on_leave', (select count(*) from days where status in ('leave', 'half_day', 'comp_leave')),
    'absent', (select count(*) from absent),
    'absent_names', coalesce((select jsonb_agg(a.full_name order by a.n) from absent a where a.n <= 5), '[]'::jsonb),
    'absent_more', greatest((select count(*) from absent) - 5, 0),
    'day_not_ended', (select count(*) from not_ended),
    'day_not_ended_names', coalesce((select jsonb_agg(e.full_name order by e.n) from not_ended e where e.n <= 5), '[]'::jsonb),
    'day_not_ended_more', greatest((select count(*) from not_ended) - 5, 0))
  into v_attendance;

  -- Tasks: approved (completed) yesterday; overdue now (tasks/domain isOverdue: not completed or
  -- cancelled, past due_at); waiting for the Owner (task_counts().to_decide for the Owner).
  select jsonb_build_object(
    'approved_yesterday', (
      select count(*) from public.tasks t
      where t.org_id = p_org and t.archived_at is null and t.completed_at >= v_from and t.completed_at < v_to),
    'overdue', (
      select count(*) from public.tasks t
      where t.org_id = p_org and t.archived_at is null
        and t.state not in ('completed', 'cancelled') and t.due_at < p_now),
    'waiting_for_owner', (
      select count(*) from public.tasks t
      where t.org_id = p_org and v_owner is not null
        and ((exists (select 1 from public.role_permissions rp
                      where rp.role = 'owner' and rp.permission = 'tasks.approve_final')
              and t.state = 'admin_approved')
          or (exists (select 1 from public.role_permissions rp
                      where rp.role = 'owner' and rp.permission = 'tasks.approve_admin')
              and t.state = 'submitted' and t.approving_admin_id = v_owner
              and not exists (select 1 from public.task_assignees a
                              where a.task_id = t.id and a.member_id = v_owner and a.removed_at is null)))))
  into v_tasks;

  -- Requests waiting for the Owner: leave (countPendingRequests: submitted, not the attendance
  -- prompt's) and expense claims (countPendingClaims: submitted). A count only: no amount is read.
  select jsonb_build_object(
    'leave', (
      select count(*) from public.leave_requests r
      join public.members m on m.id = r.member_id
      where m.org_id = p_org and r.state = 'submitted' and r.source <> 'attendance'),
    'expense_claims', (
      select count(*) from public.expense_claims c
      join public.members m on m.id = c.member_id
      where m.org_id = p_org and c.state = 'submitted'))
  into v_requests;

  -- Emails the daily limit held back yesterday, by kind (the dispatcher's skipped_cap rows).
  select coalesce(jsonb_agg(jsonb_build_object('kind', h.kind, 'description', h.description, 'count', h.n)
                            order by h.n desc, h.kind), '[]'::jsonb)
  into v_held
  from (
    select n.kind, k.description, count(*) as n
    from public.notification_deliveries d
    join public.notifications n on n.id = d.notification_id
    join public.notification_kinds k on k.kind = n.kind
    where n.org_id = p_org and d.channel = 'email' and d.state = 'skipped_cap'
      and d.created_at >= v_from and d.created_at < v_to
    group by n.kind, k.description
  ) h;

  return jsonb_build_object(
    'date', v_today,
    'yesterday', v_yesterday,
    'attendance', v_attendance,
    'tasks', v_tasks,
    'requests', v_requests,
    'held_back', v_held);
end;
$$;
comment on function app.owner_digest_payload(uuid, timestamptz) is
  '5B slice 7, service_role only: the Owner digest''s counts for an organisation at p_now (IST): '
  'attendance yesterday (present, on leave, absent and day not ended, with up to 5 names each by '
  'name then id and the remainder), tasks (approved yesterday, overdue now, waiting for the Owner), '
  'requests waiting (leave, expense claims: counts only) and yesterday''s emails held back by the '
  'daily limit by kind. Never an amount.';
revoke all on function app.owner_digest_payload(uuid, timestamptz) from public, anon, authenticated;
grant execute on function app.owner_digest_payload(uuid, timestamptz) to service_role;

-- The digest's lines as plain text, for the row's body (the email is rendered from the payload).
create function app.owner_digest_text(p jsonb)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_lines text[] := '{}';
  v_section text[];
  v_item jsonb;
  v_names text;
begin
  v_section := '{}';
  if (p #>> '{attendance,present}')::integer > 0 then
    v_section := v_section || ('Present: ' || (p #>> '{attendance,present}'));
  end if;
  if (p #>> '{attendance,on_leave}')::integer > 0 then
    v_section := v_section || ('On leave: ' || (p #>> '{attendance,on_leave}'));
  end if;
  if (p #>> '{attendance,absent}')::integer > 0 then
    select string_agg(x, ', ') into v_names from jsonb_array_elements_text(p #> '{attendance,absent_names}') x;
    v_section := v_section || ('Absent: ' || (p #>> '{attendance,absent}') || ' (' || coalesce(v_names, '')
      || case when (p #>> '{attendance,absent_more}')::integer > 0 then ' +' || (p #>> '{attendance,absent_more}') || ' more' else '' end || ')');
  end if;
  if (p #>> '{attendance,day_not_ended}')::integer > 0 then
    select string_agg(x, ', ') into v_names from jsonb_array_elements_text(p #> '{attendance,day_not_ended_names}') x;
    v_section := v_section || ('Day not ended: ' || (p #>> '{attendance,day_not_ended}') || ' (' || coalesce(v_names, '')
      || case when (p #>> '{attendance,day_not_ended_more}')::integer > 0 then ' +' || (p #>> '{attendance,day_not_ended_more}') || ' more' else '' end || ')');
  end if;
  if cardinality(v_section) > 0 then
    v_lines := v_lines || array['', 'Attendance yesterday'] || v_section;
  end if;

  v_section := '{}';
  if (p #>> '{tasks,approved_yesterday}')::integer > 0 then
    v_section := v_section || ('Approved yesterday: ' || (p #>> '{tasks,approved_yesterday}'));
  end if;
  if (p #>> '{tasks,overdue}')::integer > 0 then
    v_section := v_section || ('Overdue now: ' || (p #>> '{tasks,overdue}'));
  end if;
  if (p #>> '{tasks,waiting_for_owner}')::integer > 0 then
    v_section := v_section || ('Waiting for your approval: ' || (p #>> '{tasks,waiting_for_owner}'));
  end if;
  if cardinality(v_section) > 0 then
    v_lines := v_lines || array['', 'Tasks'] || v_section;
  end if;

  v_section := '{}';
  if (p #>> '{requests,leave}')::integer > 0 then
    v_section := v_section || ('Leave requests: ' || (p #>> '{requests,leave}'));
  end if;
  if (p #>> '{requests,expense_claims}')::integer > 0 then
    v_section := v_section || ('Expense claims: ' || (p #>> '{requests,expense_claims}'));
  end if;
  if cardinality(v_section) > 0 then
    v_lines := v_lines || array['', 'Requests waiting for you'] || v_section;
  end if;

  v_section := '{}';
  for v_item in select * from jsonb_array_elements(coalesce(p -> 'held_back', '[]'::jsonb)) loop
    if (v_item ->> 'count')::integer > 0 then
      v_section := v_section || (coalesce(v_item ->> 'description', v_item ->> 'kind') || ': ' || (v_item ->> 'count'));
    end if;
  end loop;
  if cardinality(v_section) > 0 then
    v_lines := v_lines || array['', 'Emails held back yesterday by the daily limit'] || v_section;
  end if;

  if cardinality(v_lines) = 0 then
    return 'Nothing needs you today.';
  end if;
  return btrim(array_to_string(v_lines, E'\n'), E'\n');
end;
$$;
comment on function app.owner_digest_text(jsonb) is
  '5B slice 7, service_role only: the digest payload''s lines as plain text (zero lines and empty '
  'sections left out; "Nothing needs you today." when all are zero), the row''s body.';
revoke all on function app.owner_digest_text(jsonb) from public, anon, authenticated;
grant execute on function app.owner_digest_text(jsonb) to service_role;

-- 4. The daily job -----------------------------------------------------------------------------------------
create function public.digest_daily(p_now timestamptz default now())
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org record;
  v_owner uuid;
  v_day date := app.to_ist_date(p_now);
  v_payload jsonb;
  v_count integer := 0;
begin
  for v_org in select o.id from public.organizations o order by o.id loop
    -- One run at a time per organisation: two overlapping runs cannot both write the day's row.
    perform pg_advisory_xact_lock(hashtext('digest_daily:' || v_org.id::text));
    v_owner := app.org_owner_id(v_org.id);
    if v_owner is null then
      continue;
    end if;
    if exists (
      select 1 from public.notifications n
      where n.recipient_id = v_owner and n.kind = 'owner_digest'
        and n.created_at >= app.ist_day_start(v_day) and n.created_at < app.ist_day_start(v_day + 1)
    ) then
      continue;
    end if;
    v_payload := app.owner_digest_payload(v_org.id, p_now);
    -- Written directly (not app.notify): no push delivery; read at once, so never unread.
    insert into public.notifications (org_id, recipient_id, kind, title, body, link, payload, created_at, read_at)
    values (v_org.id, v_owner, 'owner_digest',
            'Your morning summary · ' || to_char(v_day, 'Dy FMDD Mon'),
            left(app.owner_digest_text(v_payload), 2000), '/today', v_payload, p_now, p_now);
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;
comment on function public.digest_daily(timestamptz) is
  '5B slice 7, service_role only (pg_cron digest_daily, 02:30 UTC = 08:00 IST): one owner_digest '
  'row for each organisation''s active Owner per IST day of p_now (none when it exists, none '
  'without an Owner), never skipped when every count is zero. Read at insert, no push delivery; '
  'the dispatcher emails it (email_claim). Returns how many rows it wrote.';
revoke all on function public.digest_daily(timestamptz) from public, anon, authenticated;
grant execute on function public.digest_daily(timestamptz) to service_role;

select cron.schedule('digest_daily', '30 2 * * *', $$select public.digest_daily(now())$$);

-- 5. The sample on the preview --------------------------------------------------------------------------
create function public.owner_digest_preview()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_me public.members;
begin
  select m.* into v_me from app.current_member() m;
  if v_me.id is null or v_me.role <> 'owner' or app.org_owner_id(v_me.org_id) is distinct from v_me.id then
    perform app.fail('FORBIDDEN', 'Only the Owner can see the morning summary.');
  end if;
  return app.owner_digest_payload(v_me.org_id, now());
end;
$$;
comment on function public.owner_digest_preview() is
  '5B slice 7: the digest''s payload for now, for the organisation''s Owner only (FORBIDDEN for '
  'anyone else). Reads only: writes no notification and no delivery. For /diagnostics/digest, '
  'which answers on local and staging builds only.';
revoke all on function public.owner_digest_preview() from public, anon;
grant execute on function public.owner_digest_preview() to authenticated, service_role;

-- 6. The email path ------------------------------------------------------------------------------------
drop function public.email_claim(timestamptz, integer);
create function public.email_claim(p_now timestamptz default now(), p_limit integer default 20)
returns table (
  delivery_id uuid, recipient_id uuid, email text, notification_id uuid, kind text,
  title text, body text, link text, attempts integer, batch_id uuid, escalation_level integer,
  payload jsonb)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lease interval := interval '5 minutes';
  v_group record;
  v_day_start timestamptz;
  v_org_count integer;
  v_member_count integer;
  v_batch uuid;
  v_new uuid[] := '{}';
begin
  -- Every run counts under one lock: two overlapping runs cannot both take the last email.
  perform pg_advisory_xact_lock(hashtext('public.email_claim'));

  -- a. Queue the email rows that are needed and not there yet (unchanged from email_dispatch).
  insert into public.notification_deliveries (notification_id, channel, state, next_attempt_at, created_at)
  select n.id, 'email', 'queued', p_now, p_now
  from public.notifications n
  join public.notification_kinds k on k.kind = n.kind
  join public.members m on m.id = n.recipient_id
  where n.created_at > p_now - interval '24 hours' and n.created_at <= p_now
    and m.status = 'active' and m.email is not null
    and (k.always_email
         or (k.actionable
             and not exists (select 1 from public.push_subscriptions s
                             where s.member_id = n.recipient_id and s.disabled_at is null)
             and not exists (select 1 from public.notification_deliveries p
                             where p.notification_id = n.id and p.channel = 'push' and p.state = 'sent')))
    and not exists (select 1 from public.notification_deliveries e
                    where e.notification_id = n.id and e.channel = 'email')
  order by n.created_at
  on conflict on constraint notification_deliveries_notification_id_channel_key do nothing;

  -- b. New rows, as groups: a person's always-emailed rows together, a fallback row alone, the
  --    Owner's digest alone (5B: never batched). The digest is taken into the run before other
  --    rows; groups holding an escalation first, then the digest, then the oldest; each passes the
  --    ceilings once or is skipped (the digest as an ordinary email).
  for v_group in
    with fresh as (
      select d.id, d.created_at, n.recipient_id, n.org_id, n.escalation_level, k.always_email,
             n.kind = 'owner_digest' as digest,
             s.email_daily_cap_org, s.email_daily_cap_per_member
      from public.notification_deliveries d
      join public.notifications n on n.id = d.notification_id
      join public.notification_kinds k on k.kind = n.kind
      join public.org_settings s on s.org_id = n.org_id
      where d.channel = 'email' and d.state = 'queued' and d.attempts = 0 and d.next_attempt_at <= p_now
      order by (n.kind = 'owner_digest') desc, d.created_at, n.created_at, d.id
      limit p_limit
      for update of d skip locked
    )
    select array_agg(f.id order by f.created_at, f.id) as ids,
           min(f.created_at) as created_at, f.recipient_id, f.org_id,
           bool_or(f.escalation_level > 0) as escalation,
           bool_and(f.always_email and not f.digest) as batched,
           max(f.email_daily_cap_org) as cap_org, max(f.email_daily_cap_per_member) as cap_member
    from fresh f
    group by f.recipient_id, f.org_id, case when f.always_email and not f.digest then null else f.id end
    order by bool_or(f.escalation_level > 0) desc, bool_or(f.digest) desc, min(f.created_at)
  loop
    v_day_start := app.ist_day_start((v_group.created_at at time zone 'Asia/Kolkata')::date);
    select count(distinct coalesce(e.batch_id, e.id)),
           count(distinct coalesce(e.batch_id, e.id)) filter (where x.recipient_id = v_group.recipient_id)
      into v_org_count, v_member_count
    from public.notification_deliveries e
    join public.notifications x on x.id = e.notification_id
    where e.channel = 'email' and x.org_id = v_group.org_id
      and e.created_at >= v_day_start and e.created_at < v_day_start + interval '1 day'
      and e.attempts > 0 and e.last_error is distinct from 'not_configured';

    if v_group.escalation and v_org_count >= v_group.cap_org then
      update public.notification_deliveries set state = 'skipped_cap', last_error = 'org_cap' where id = any (v_group.ids);
    elsif not v_group.escalation and v_org_count >= greatest(v_group.cap_org - 10, 0) then
      update public.notification_deliveries set state = 'skipped_cap', last_error = 'org_cap' where id = any (v_group.ids);
    elsif not v_group.escalation and v_member_count >= v_group.cap_member then
      update public.notification_deliveries set state = 'skipped_cap', last_error = 'member_cap' where id = any (v_group.ids);
    else
      v_batch := case when v_group.batched then gen_random_uuid() else null end;
      update public.notification_deliveries
      set attempts = 1, next_attempt_at = p_now + v_lease, batch_id = v_batch
      where id = any (v_group.ids);
      v_new := v_new || v_group.ids;
    end if;
  end loop;

  -- c. What goes out now: the rows just leased, and the retries that are due (a lease that
  --    expired after a crashed run is claimed again the same way; a batch's rows retry together).
  return query
  with retry as (
    select d.id
    from public.notification_deliveries d
    where d.channel = 'email' and d.state = 'queued' and d.attempts > 0 and d.next_attempt_at <= p_now
      and not (d.id = any (v_new))
    order by d.next_attempt_at, d.created_at
    limit p_limit
    for update of d skip locked
  ), leased as (
    update public.notification_deliveries d
    set attempts = d.attempts + 1, next_attempt_at = p_now + v_lease
    from retry where d.id = retry.id
    returning d.id, d.attempts, d.notification_id, d.batch_id
  ), outgoing as (
    select l.id, l.attempts, l.notification_id, l.batch_id from leased l
    union all
    select d.id, d.attempts, d.notification_id, d.batch_id from public.notification_deliveries d where d.id = any (v_new)
  )
  select o.id, n.recipient_id, m.email, n.id, n.kind, n.title, n.body, n.link, o.attempts, o.batch_id,
         n.escalation_level, n.payload
  from outgoing o
  join public.notifications n on n.id = o.notification_id
  join public.members m on m.id = n.recipient_id;
end;
$$;
comment on function public.email_claim(timestamptz, integer) is
  '5.2, 5.3, 5B; service_role only (the dispatcher, ARCHITECTURE §9): queues the email rows a '
  'notification needs (always_email kinds; actionable kinds when the person has no active push '
  'subscription and the push was not sent; rows of the last 24 hours, active members with an '
  'address), then leases them in groups under an advisory lock: a person''s always-emailed rows as '
  'one batch (one email, counted once), a fallback row alone, the Owner''s digest (owner_digest) '
  'alone and taken into the run first; escalations first, then the digest, then the oldest. '
  'Ceilings: ordinary groups (the digest included) stop at email_daily_cap_org - 10 and at '
  'email_daily_cap_per_member; an escalation only at email_daily_cap_org (skipped_cap, last_error '
  'org_cap | member_cap). Returns what goes out now with batch_id, escalation_level and the '
  'notification''s payload; the caller sends a batch as one email and records each row through '
  'email_record().';
revoke all on function public.email_claim(timestamptz, integer) from public, anon, authenticated;
grant execute on function public.email_claim(timestamptz, integer) to service_role;
