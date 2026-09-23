-- 2.1 Attendance and leave (PRODUCT §4.2/§4.3, DATA-MODEL §0/§3, WORKFLOWS §1/§2, PERMISSIONS §1-§3,
--   ARCHITECTURE §4.1/§5/§8): attendance_days, attendance_events, leave_requests and every
--   transition function of the two workflows. The gate itself (2.2), the screens (2.3, 2.4) and the
--   23:59 / 20:30 jobs (2.5) build on this file. No notification rows yet: 5.1 adds them to every
--   function here (the WORKFLOWS §9 recipient is named in each function's comment).
-- Rules this file settles (owner decisions, 2026-09-23, WORKFLOWS §1/§2): reasons are optional for
--   members and required for the Owner's reject / correct; the attendance day is the single door
--   for a source = attendance request; an employee's cancellation is a request too; overlapping
--   open requests are refused while closed ones never block; a logout after midnight lands on
--   yesterday's day and writes nothing but the logout; a cancelled leave hands today's untouched
--   derived day back to the gate.
-- Append-only: never edit once applied.

-- Enums (DATA-MODEL §0) --------------------------------------------------------------------------
create type public.attendance_choice as enum ('present', 'leave', 'half_day', 'comp_leave');
create type public.day_status as enum ('present', 'leave', 'half_day', 'comp_leave', 'absent');
create type public.attendance_state as enum ('awaiting_choice', 'pending_review', 'approved', 'corrected');
create type public.leave_type as enum ('leave', 'half_day', 'comp_leave');
create type public.leave_state as enum ('submitted', 'approved', 'rejected', 'withdrawn', 'superseded', 'cancelled');

comment on type public.attendance_choice is 'What a member submits at the gate (PRODUCT §4.2).';
comment on type public.day_status is 'What a day finally counts as: a choice, or absent (the 23:59 job).';
comment on type public.attendance_state is 'awaiting_choice → pending_review → approved | corrected (WORKFLOWS §1).';
comment on type public.leave_type is 'Leave, half-day leave or compensatory leave (PRODUCT §4.3).';
comment on type public.leave_state is 'submitted → approved | rejected | withdrawn; approved → superseded | cancelled (WORKFLOWS §2).';

-- Time helper ------------------------------------------------------------------------------------
create or replace function app.ist_day_start(d date)
returns timestamptz
language sql
stable
strict
parallel safe
set search_path = ''
as $$
  select (d::timestamp at time zone 'Asia/Kolkata');
$$;

revoke all on function app.ist_day_start(date) from public;
grant execute on function app.ist_day_start(date) to authenticated, service_role;

comment on function app.ist_day_start(date) is
  'Midnight IST of that date as an instant (core/time istDayStart()). "Events on this IST date" is '
  'at >= app.ist_day_start(d) and at < app.ist_day_start(d + 1), which an index on at can serve; '
  'app.to_ist_date(at) = d cannot.';

-- leave_requests ---------------------------------------------------------------------------------
-- Created first: attendance_days links to it. No org_id: the member carries it (like session_events).
create table public.leave_requests (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.members (id),
  type public.leave_type not null,
  start_date date not null,
  end_date date not null,
  reason text null,
  state public.leave_state not null default 'submitted',
  source text not null check (source in ('form', 'attendance', 'owner')),
  supersedes_id uuid null references public.leave_requests (id),
  requests_cancellation boolean not null default false,
  decided_by uuid null references public.members (id),
  decided_at timestamptz null,
  decision_reason text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint leave_requests_dates check (end_date >= start_date),
  constraint leave_requests_half_day check (type <> 'half_day' or start_date = end_date),
  constraint leave_requests_cancellation check (not requests_cancellation or supersedes_id is not null),
  constraint leave_requests_decided check (
    (state in ('submitted', 'withdrawn') and decided_at is null)
    or (state in ('approved', 'rejected', 'cancelled') and decided_at is not null)
    or state = 'superseded'
  )
);

comment on table public.leave_requests is
  'A request for leave (WORKFLOWS §2). source = form (the leave screen), attendance (created by a '
  'leave choice at the gate; decided through the attendance day only) or owner (created by an '
  'Owner correction or edit, born approved). A change or cancellation is a new submitted row with '
  'supersedes_id; the original stays approved until the decision. "Approved leave covering a date" '
  'is always state = approved and nothing else. Every write is a transition function.';
comment on column public.leave_requests.requests_cancellation is
  'This row asks to cancel the approved request it supersedes: on approval both end cancelled.';

create index leave_requests_state_idx on public.leave_requests (state);
create index leave_requests_member_dates_idx on public.leave_requests (member_id, start_date, end_date);
create index leave_requests_supersedes_idx on public.leave_requests (supersedes_id);
create index leave_requests_decided_by_idx on public.leave_requests (decided_by);

create trigger set_updated_at before update on public.leave_requests
  for each row execute function app.set_updated_at();
-- Guards run before the audit so a refused change leaves no trace.
create trigger protect_columns before update on public.leave_requests
  for each row execute function app.protect_columns(
    'member_id', 'type', 'start_date', 'end_date', 'reason', 'state', 'source', 'supersedes_id',
    'requests_cancellation', 'decided_by', 'decided_at', 'decision_reason');
create trigger audit_row_change after insert or update or delete on public.leave_requests
  for each row execute function app.audit_row_change();

alter table public.leave_requests enable row level security;
create policy leave_requests_select on public.leave_requests for select to authenticated
  using (member_id = (select c.id from app.current_member() c)
         or (select app.has_permission('attendance.view_all')));
-- No insert / update / delete policy: every write is a transition function (ADR-0006).

revoke all on public.leave_requests from anon;
revoke insert, update, delete, truncate, references, trigger on public.leave_requests from authenticated;

-- attendance_days --------------------------------------------------------------------------------
create table public.attendance_days (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.members (id),
  work_date date not null,
  first_login_at timestamptz null,
  -- Decided when the row is created (WORKFLOWS §1). Never re-derived: a holiday deleted later must
  -- not rewrite a past day (DATA-MODEL §1).
  is_day_off boolean not null default false,
  state public.attendance_state not null default 'awaiting_choice',
  submitted_choice public.attendance_choice null,
  submitted_at timestamptz null,
  proposed_by_system boolean not null default false,
  final_status public.day_status null,
  decided_by uuid null references public.members (id),
  decided_at timestamptz null,
  decision_reason text null,
  last_logout_at timestamptz null,
  logout_not_recorded boolean not null default false,
  overtime_flag boolean not null default false,
  overtime_reason text null,
  worked_on_leave boolean not null default false,
  leave_request_id uuid null references public.leave_requests (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint attendance_days_member_date_key unique (member_id, work_date),
  constraint attendance_days_awaiting check (
    state <> 'awaiting_choice'
    or (submitted_choice is null and final_status is null and decided_at is null and decided_by is null)),
  constraint attendance_days_decided check (
    state not in ('approved', 'corrected') or (final_status is not null and decided_at is not null))
);

comment on table public.attendance_days is
  'One row per member per IST date: the source of truth for what a date counts as (WORKFLOWS §1). '
  'Created by attendance_touch() at first login or by the 23:59 job (2.5). Every time on it is the '
  'server clock; nothing caller-supplied is evidence. Every write is a transition function.';
comment on column public.attendance_days.proposed_by_system is
  'The status was set by the system, not by a person: a day derived from approved leave, the '
  '23:59 absent proposal, or a "leave wins" correction. "I''m working today" is allowed only on an '
  'approved day with this flag.';
comment on column public.attendance_days.worked_on_leave is
  '"1 day worked": Present was approved on a day that approved leave covers. The leave is untouched.';

create index attendance_days_date_state_idx on public.attendance_days (work_date, state);
create index attendance_days_leave_request_idx on public.attendance_days (leave_request_id);
create index attendance_days_decided_by_idx on public.attendance_days (decided_by);

create trigger set_updated_at before update on public.attendance_days
  for each row execute function app.set_updated_at();
create trigger protect_columns before update on public.attendance_days
  for each row execute function app.protect_columns(
    'member_id', 'work_date', 'first_login_at', 'is_day_off', 'state', 'submitted_choice',
    'submitted_at', 'proposed_by_system', 'final_status', 'decided_by', 'decided_at',
    'decision_reason', 'last_logout_at', 'logout_not_recorded', 'overtime_flag', 'overtime_reason',
    'worked_on_leave', 'leave_request_id');
create trigger audit_row_change after insert or update or delete on public.attendance_days
  for each row execute function app.audit_row_change();

alter table public.attendance_days enable row level security;
create policy attendance_days_select on public.attendance_days for select to authenticated
  using (member_id = (select c.id from app.current_member() c)
         or (select app.has_permission('attendance.view_all')));

revoke all on public.attendance_days from anon;
revoke insert, update, delete, truncate, references, trigger on public.attendance_days from authenticated;

-- attendance_events ------------------------------------------------------------------------------
create table public.attendance_events (
  -- bigint identity, like activity_log: one transaction shares one now(), so the id is the order.
  id bigint generated always as identity primary key,
  attendance_day_id uuid not null references public.attendance_days (id),
  action text not null check (action in (
    'submitted', 'proposed_absent', 'derived_from_leave', 'approved', 'corrected', 'logout', 'overtime_flagged')),
  from_status public.day_status null,
  to_status public.day_status null,
  reason text null,
  actor_id uuid null references public.members (id),
  at timestamptz not null default now()
);

comment on table public.attendance_events is
  'The history of a day, one row per transition (append-only, ARCHITECTURE §6). actor_id null = '
  'the system. Not audited: it is the audit. Readable with the parent day.';

create index attendance_events_day_at_idx on public.attendance_events (attendance_day_id, at);
create index attendance_events_actor_idx on public.attendance_events (actor_id);

alter table public.attendance_events enable row level security;
-- The parent day's own RLS decides (the subquery runs as the caller).
create policy attendance_events_select on public.attendance_events for select to authenticated
  using (exists (select 1 from public.attendance_days d where d.id = attendance_day_id));

revoke all on public.attendance_events from anon;
revoke insert, update, delete, truncate, references, trigger on public.attendance_events from authenticated;

-- activity_log: a member reads the entries about their own days and requests (PERMISSIONS §2).
create policy activity_log_select_attendance_self on public.activity_log for select to authenticated
  using (org_id = (select c.org_id from app.current_member() c)
         and ((entity = 'attendance_days'
               and entity_id in (select d.id from public.attendance_days d
                                 where d.member_id = (select c.id from app.current_member() c)))
              or (entity = 'leave_requests'
                  and entity_id in (select r.id from public.leave_requests r
                                    where r.member_id = (select c.id from app.current_member() c)))));

comment on policy activity_log_select_attendance_self on public.activity_log is
  'Entries about the caller''s own attendance days and leave requests (2.1). The Owner reads '
  'everything through activity.view_all.';

-- Helpers (app schema) ---------------------------------------------------------------------------
create or replace function app.attendance_require_self(out caller_id uuid, out org_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
begin
  select m.id, m.org_id into caller_id, org_id from app.current_member() m;
  if caller_id is null then
    perform app.fail('UNAUTHENTICATED', 'Your account is not active.');
  end if;
  if not app.has_permission('attendance.self') then
    perform app.fail('FORBIDDEN', 'The Owner does not mark attendance.');
  end if;
end;
$$;

revoke all on function app.attendance_require_self() from public;
grant execute on function app.attendance_require_self() to authenticated, service_role;

create or replace function app.attendance_require_decider(out caller_id uuid, out org_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
begin
  select m.id, m.org_id into caller_id, org_id from app.current_member() m;
  if caller_id is null then
    perform app.fail('UNAUTHENTICATED', 'Your account is not active.');
  end if;
  if not app.has_permission('attendance.decide') then
    perform app.fail('FORBIDDEN', 'Only the Owner decides attendance and leave.');
  end if;
end;
$$;

revoke all on function app.attendance_require_decider() from public;
grant execute on function app.attendance_require_decider() to authenticated, service_role;

create or replace function app.clean_reason(reason text)
returns text
language plpgsql
set search_path = ''
as $$
declare
  v text := nullif(btrim(coalesce(reason, '')), '');
begin
  if length(v) > 1000 then
    perform app.fail('VALIDATION', 'Keep the reason under 1000 characters.');
  end if;
  return v;
end;
$$;

revoke all on function app.clean_reason(text) from public;
grant execute on function app.clean_reason(text) to authenticated, service_role;

comment on function app.clean_reason(text) is
  'Trims a free-text reason, turns blank into null, refuses more than 1000 characters.';

create or replace function app.attendance_event(
  day_id uuid, action text, from_status public.day_status, to_status public.day_status,
  reason text, actor_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.attendance_events (attendance_day_id, action, from_status, to_status, reason, actor_id)
  values (day_id, action, from_status, to_status, reason, actor_id);
$$;

-- Internal writers and cross-member readers (this one and the five below): called only from the
-- security definer functions in this file, which run as the owner and need no grant. The API role
-- gets none (00_core_base lists them as the exception to "authenticated may execute app.*").
revoke all on function app.attendance_event(uuid, text, public.day_status, public.day_status, text, uuid) from public, authenticated;
grant execute on function app.attendance_event(uuid, text, public.day_status, public.day_status, text, uuid) to service_role;

create or replace function app.leave_covering(p_member_id uuid, d date)
returns public.leave_requests
language sql
stable
security definer
set search_path = ''
as $$
  select r.*
  from public.leave_requests r
  where r.member_id = p_member_id and r.state = 'approved' and r.start_date <= d and r.end_date >= d
  order by r.decided_at desc, r.created_at desc
  limit 1;
$$;

revoke all on function app.leave_covering(uuid, date) from public, authenticated;
grant execute on function app.leave_covering(uuid, date) to service_role;

comment on function app.leave_covering(uuid, date) is
  'The approved request covering that date for that member; with two, the most recently decided.';

create or replace function app.leave_overlaps(p_member_id uuid, p_start date, p_end date, p_exclude uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  -- Only open requests block (WORKFLOWS §2): a rejected, withdrawn, superseded or cancelled row
  -- must never stop someone applying again.
  select exists (
    select 1
    from public.leave_requests r
    where r.member_id = p_member_id
      and r.state in ('submitted', 'approved')
      and r.id is distinct from p_exclude
      and r.start_date <= p_end and r.end_date >= p_start
  );
$$;

revoke all on function app.leave_overlaps(uuid, date, date, uuid) from public, authenticated;
grant execute on function app.leave_overlaps(uuid, date, date, uuid) to service_role;

-- "A later leave wins" (WORKFLOWS §1): applied when a request becomes approved.
create or replace function app.attendance_apply_leave(req public.leave_requests)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_day public.attendance_days;
  v_gate public.leave_requests;
  v_status public.day_status := req.type::text::public.day_status;
begin
  for v_day in
    select d.*
    from public.attendance_days d
    where d.member_id = req.member_id
      and d.work_date between req.start_date and req.end_date
    order by d.work_date
    for update
  loop
    if v_day.state = 'awaiting_choice' then
      -- Logged in, never chose: the day is derived now and the gate stops asking.
      perform set_config('app.audit_override', jsonb_build_object(
        'action', 'derived_from_leave',
        'meta', jsonb_build_object('leave_request_id', req.id))::text, true);
      update public.attendance_days
      set state = 'approved', final_status = v_status, proposed_by_system = true,
          decided_by = null, decided_at = now(), decision_reason = null, leave_request_id = req.id
      where id = v_day.id;
      perform app.attendance_event(v_day.id, 'derived_from_leave', null, v_status, null, null);
    elsif v_day.state = 'pending_review'
       or (v_day.state = 'approved' and v_day.submitted_choice = 'present') then
      -- The leave wins over a submitted Present (or a proposed absent): a system correction.
      -- A leave choice made at the gate is still a submitted request of its own; the approved
      -- leave wins over it too, or it would sit in the Owner's list with no door (WORKFLOWS §1).
      if v_day.leave_request_id is not null and v_day.leave_request_id <> req.id then
        select r.* into v_gate from public.leave_requests r
        where r.id = v_day.leave_request_id and r.state = 'submitted' for update;
        if v_gate.id is not null then
          perform set_config('app.audit_override', jsonb_build_object(
            'action', 'superseded', 'meta', jsonb_build_object('by', req.id, 'system', true))::text, true);
          update public.leave_requests set state = 'superseded' where id = v_gate.id;
        end if;
      end if;
      perform set_config('app.audit_override', jsonb_build_object(
        'action', 'corrected',
        'meta', jsonb_build_object('reason', 'leave approved', 'leave_request_id', req.id,
                                   'from_status', v_day.final_status, 'system', true))::text, true);
      update public.attendance_days
      set state = 'corrected', final_status = v_status, proposed_by_system = true,
          decided_by = null, decided_at = now(), decision_reason = 'leave approved',
          leave_request_id = req.id, worked_on_leave = false
      where id = v_day.id;
      perform app.attendance_event(v_day.id, 'corrected', v_day.final_status, v_status, 'leave approved', null);
    elsif v_day.state = 'approved' and v_day.proposed_by_system and v_day.submitted_choice is null
       and (v_day.leave_request_id is distinct from req.id or v_day.final_status <> v_status) then
      -- An untouched derived day follows the request that now covers it.
      perform set_config('app.audit_override', jsonb_build_object(
        'action', 'derived_from_leave',
        'meta', jsonb_build_object('leave_request_id', req.id, 'from_status', v_day.final_status, 'system', true))::text, true);
      update public.attendance_days
      set final_status = v_status, decided_at = now(), leave_request_id = req.id
      where id = v_day.id;
      perform app.attendance_event(v_day.id, 'derived_from_leave', v_day.final_status, v_status, null, null);
    end if;
    -- corrected days, and approved days with a leave-type choice, are the Owner's decision: kept.
  end loop;
end;
$$;

revoke all on function app.attendance_apply_leave(public.leave_requests) from public, authenticated;
grant execute on function app.attendance_apply_leave(public.leave_requests) to service_role;

-- A leave that stops covering today hands the untouched derived day back to the gate.
create or replace function app.attendance_release_leave(req public.leave_requests, keep_from date, keep_to date)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_day public.attendance_days;
begin
  for v_day in
    select d.*
    from public.attendance_days d
    where d.leave_request_id = req.id
      and d.work_date >= app.today_ist()
      and d.state = 'approved' and d.proposed_by_system and d.submitted_choice is null
      and (keep_from is null or d.work_date < keep_from or d.work_date > keep_to)
    order by d.work_date
    for update
  loop
    perform set_config('app.audit_override', jsonb_build_object(
      'action', 'corrected',
      'meta', jsonb_build_object('reason', 'leave cancelled', 'leave_request_id', req.id,
                                 'from_status', v_day.final_status, 'system', true))::text, true);
    update public.attendance_days
    set state = 'awaiting_choice', final_status = null, proposed_by_system = false,
        decided_by = null, decided_at = null, decision_reason = null, leave_request_id = null
    where id = v_day.id;
    perform app.attendance_event(v_day.id, 'corrected', v_day.final_status, null, 'leave cancelled', null);
  end loop;
end;
$$;

revoke all on function app.attendance_release_leave(public.leave_requests, date, date) from public, authenticated;
grant execute on function app.attendance_release_leave(public.leave_requests, date, date) to service_role;

comment on function app.attendance_release_leave(public.leave_requests, date, date) is
  'Today''s (or a later) day that was derived from this request and never touched by anyone goes '
  'back to awaiting_choice, unless it falls inside keep_from..keep_to (the range a replacement '
  'covers; apply_leave re-derives those). Past days are history and stay.';

-- attendance_touch -------------------------------------------------------------------------------
create or replace function public.attendance_touch(user_agent text default null, ip_hash text default null)
returns table (
  day_id uuid, work_date date, state public.attendance_state, gate_required boolean,
  is_day_off boolean, final_status public.day_status, proposed_by_system boolean, leave_request_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_member public.members;
  v_today date := app.today_ist();
  v_day public.attendance_days;
  v_leave public.leave_requests;
  v_day_off boolean;
begin
  select m.* into v_member from app.current_member() m;
  if v_member.id is null then
    perform app.fail('UNAUTHENTICATED', 'Your account is not active.');
  end if;

  -- A session kept across midnight has no login today: record one so "logged in today" holds
  -- for the 20:30 reminder and the 23:59 jobs (WORKFLOWS §1).
  if not exists (
    select 1 from public.session_events e
    where e.member_id = v_member.id and e.kind = 'login'
      and e.at >= app.ist_day_start(v_today) and e.at < app.ist_day_start(v_today + 1)
  ) then
    insert into public.session_events (member_id, kind, user_agent, ip_hash)
    values (v_member.id, 'login', nullif(left(user_agent, 512), ''), nullif(left(ip_hash, 128), ''));
  end if;

  -- Whoever lacks attendance.self (the Owner, PERMISSIONS §1) is exempt from the gate: no day row.
  if not app.has_permission('attendance.self') then
    return query select null::uuid, v_today, null::public.attendance_state, false, false,
                        null::public.day_status, false, null::uuid;
    return;
  end if;

  select d.* into v_day
  from public.attendance_days d
  where d.member_id = v_member.id and d.work_date = v_today
  for update;

  if v_day.id is null then
    -- null from is_working_day() means "unknown", which is not a day off.
    v_day_off := app.is_working_day(v_today) is false;
    v_leave := app.leave_covering(v_member.id, v_today);

    if v_leave.id is not null then
      perform set_config('app.audit_override', jsonb_build_object(
        'action', 'derived_from_leave',
        'meta', jsonb_build_object('leave_request_id', v_leave.id))::text, true);
      insert into public.attendance_days (
        member_id, work_date, first_login_at, is_day_off, state, proposed_by_system, final_status,
        decided_at, leave_request_id)
      values (
        v_member.id, v_today, now(), v_day_off, 'approved', true, v_leave.type::text::public.day_status,
        now(), v_leave.id)
      on conflict on constraint attendance_days_member_date_key do nothing
      returning * into v_day;
    else
      perform set_config('app.audit_override', jsonb_build_object('action', 'opened')::text, true);
      insert into public.attendance_days (member_id, work_date, first_login_at, is_day_off)
      values (v_member.id, v_today, now(), v_day_off)
      on conflict on constraint attendance_days_member_date_key do nothing
      returning * into v_day;
    end if;

    if v_day.id is null then
      -- Another device won the race: nothing was written, so the label must not linger.
      perform set_config('app.audit_override', '', true);
      select d.* into v_day
      from public.attendance_days d
      where d.member_id = v_member.id and d.work_date = v_today;
    elsif v_day.state = 'approved' then
      perform app.attendance_event(v_day.id, 'derived_from_leave', null, v_day.final_status, null, null);
    end if;
  elsif v_day.first_login_at is null then
    -- The 23:59 job (2.5) opened the day before this person ever logged in.
    perform set_config('app.audit_override', jsonb_build_object('action', 'first_login')::text, true);
    update public.attendance_days set first_login_at = now() where id = v_day.id returning * into v_day;
  end if;

  return query select v_day.id, v_day.work_date, v_day.state, v_day.state = 'awaiting_choice',
                      v_day.is_day_off, v_day.final_status, v_day.proposed_by_system, v_day.leave_request_id;
end;
$$;

revoke all on function public.attendance_touch(text, text) from public, anon;
grant execute on function public.attendance_touch(text, text) to authenticated, service_role;

comment on function public.attendance_touch(text, text) is
  'Every active member, on the first request of the day (ARCHITECTURE §8). Records a login event '
  'when there is none today, opens today''s attendance day for an Admin or Staff member (derived '
  'from approved leave when there is one, otherwise awaiting_choice) and answers whether the gate '
  'must ask. Idempotent. The Owner gets gate_required = false and no day. Audit action: opened | '
  'derived_from_leave | first_login. Notifies nobody.';

-- attendance_submit ------------------------------------------------------------------------------
create or replace function public.attendance_submit(choice public.attendance_choice, reason text default null)
returns public.attendance_state
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid;
  v_org uuid;
  v_reason text := app.clean_reason(reason);
  v_day public.attendance_days;
  v_leave_id uuid;
  v_to public.day_status := choice::text::public.day_status;
begin
  select r.caller_id, r.org_id into v_caller, v_org from app.attendance_require_self() r;

  select d.* into v_day
  from public.attendance_days d
  where d.member_id = v_caller and d.work_date = app.today_ist()
  for update;
  if v_day.id is null then
    perform app.fail('NOT_FOUND', 'Today''s attendance is not open yet. Reload and try again.');
  end if;

  if v_day.state = 'awaiting_choice' then
    v_leave_id := null;
  elsif v_day.state = 'approved' and v_day.proposed_by_system and choice = 'present' then
    -- "I'm working today" on an approved-leave day: the leave request stays as it is.
    v_leave_id := v_day.leave_request_id;
  elsif v_day.state = 'approved' and v_day.proposed_by_system then
    perform app.fail('INVALID_STATE', 'You are on approved leave today. Only "I''m working today" can be sent.');
  else
    perform app.fail('INVALID_STATE', 'Today''s attendance has already been submitted.');
  end if;

  if choice <> 'present' then
    perform pg_advisory_xact_lock(hashtext('leave:' || v_caller::text));
    perform set_config('app.audit_override', jsonb_build_object(
      'action', 'submitted', 'meta', jsonb_build_object('source', 'attendance'))::text, true);
    insert into public.leave_requests (member_id, type, start_date, end_date, reason, state, source)
    values (v_caller, choice::text::public.leave_type, v_day.work_date, v_day.work_date, v_reason, 'submitted', 'attendance')
    returning id into v_leave_id;
  end if;

  perform set_config('app.audit_override', jsonb_build_object(
    'action', 'submitted',
    'meta', jsonb_build_object('choice', choice, 'reason', v_reason))::text, true);
  update public.attendance_days
  set state = 'pending_review', submitted_choice = choice, submitted_at = now(),
      final_status = null, proposed_by_system = false, decided_by = null, decided_at = null,
      decision_reason = null, leave_request_id = v_leave_id, worked_on_leave = false
  where id = v_day.id;
  perform app.attendance_event(v_day.id, 'submitted', v_day.final_status, v_to, v_reason, v_caller);

  return 'pending_review';
end;
$$;

revoke all on function public.attendance_submit(public.attendance_choice, text) from public, anon;
grant execute on function public.attendance_submit(public.attendance_choice, text) to authenticated, service_role;

comment on function public.attendance_submit(public.attendance_choice, text) is
  'attendance.self. Today''s own day: awaiting_choice → pending_review, or approved + '
  'proposed_by_system → pending_review for present only ("I''m working today"). A leave choice '
  'creates leave_requests(source = attendance) for today and links it. Reason optional. Audit '
  'action: submitted. Notifies nobody (WORKFLOWS §9: the Owner''s Today counts are the digest).';

-- attendance_decide ------------------------------------------------------------------------------
create or replace function public.attendance_decide(
  day_id uuid, decision text, status public.day_status default null, reason text default null)
returns public.attendance_state
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid;
  v_org uuid;
  v_reason text := app.clean_reason(reason);
  v_day public.attendance_days;
  v_req public.leave_requests;
  v_to public.day_status;
  v_link uuid;
  v_worked boolean := false;
  v_state public.attendance_state;
begin
  select r.caller_id, r.org_id into v_caller, v_org from app.attendance_require_decider() r;

  if decision is null or decision not in ('approve', 'correct') then
    perform app.fail('VALIDATION', 'The decision is approve or correct.');
  end if;

  select d.* into v_day
  from public.attendance_days d
  join public.members m on m.id = d.member_id and m.org_id = v_org
  where d.id = day_id
  for update of d;
  if v_day.id is null then
    perform app.fail('NOT_FOUND', 'This attendance day does not exist.');
  end if;

  if v_day.leave_request_id is not null then
    select r.* into v_req from public.leave_requests r where r.id = v_day.leave_request_id for update;
  end if;

  if decision = 'approve' then
    if v_day.state <> 'pending_review' then
      perform app.fail('INVALID_STATE', 'Only a day awaiting review can be approved.');
    end if;
    v_to := coalesce(v_day.submitted_choice::text::public.day_status, v_day.final_status);
    if v_to is null then
      perform app.fail('INVALID_STATE', 'This day has nothing to approve.');
    end if;
    v_link := v_day.leave_request_id;
    v_worked := coalesce(
      v_day.submitted_choice = 'present' and v_req.id is not null and v_req.state = 'approved'
      and v_day.work_date between v_req.start_date and v_req.end_date, false);
    if v_req.id is not null and v_req.state = 'submitted' then
      -- The gate's leave request is decided with the day (WORKFLOWS §2).
      perform set_config('app.audit_override', jsonb_build_object(
        'action', 'approved', 'meta', jsonb_build_object('via', 'attendance', 'reason', v_reason))::text, true);
      update public.leave_requests
      set state = 'approved', decided_by = v_caller, decided_at = now(), decision_reason = v_reason
      where id = v_req.id;
    end if;
    v_state := 'approved';
    perform set_config('app.audit_override', jsonb_build_object(
      'action', 'approved',
      'meta', jsonb_build_object('status', v_to, 'reason', v_reason, 'worked_on_leave', v_worked))::text, true);
    update public.attendance_days
    set state = 'approved', final_status = v_to, decided_by = v_caller, decided_at = now(),
        decision_reason = v_reason, worked_on_leave = v_worked, leave_request_id = v_link
    where id = v_day.id;
    perform app.attendance_event(v_day.id, 'approved', v_day.final_status, v_to, v_reason, v_caller);
  else
    if status is null then
      perform app.fail('VALIDATION', 'Choose the status the day should have.');
    end if;
    if v_reason is null then
      perform app.fail('REASON_REQUIRED', 'A correction needs a reason.');
    end if;
    v_to := status;
    v_link := v_day.leave_request_id;

    if v_req.id is not null and v_req.state = 'submitted' then
      if v_req.type::text = v_to::text then
        perform set_config('app.audit_override', jsonb_build_object(
          'action', 'approved', 'meta', jsonb_build_object('via', 'attendance', 'reason', v_reason))::text, true);
        update public.leave_requests
        set state = 'approved', decided_by = v_caller, decided_at = now(), decision_reason = v_reason
        where id = v_req.id;
        v_req.state := 'approved';
      else
        perform set_config('app.audit_override', jsonb_build_object(
          'action', 'rejected', 'meta', jsonb_build_object('via', 'attendance', 'reason', v_reason))::text, true);
        update public.leave_requests
        set state = 'rejected', decided_by = v_caller, decided_at = now(), decision_reason = v_reason
        where id = v_req.id;
        v_req.state := 'rejected';
        v_link := null;
      end if;
    end if;

    if v_to in ('leave', 'half_day', 'comp_leave')
       and not (v_req.id is not null and v_req.state = 'approved' and v_req.type::text = v_to::text
                and v_day.work_date between v_req.start_date and v_req.end_date) then
      -- A leave status with no approved request of that type behind it gets one, born approved,
      -- so the calendar and availability stay right (WORKFLOWS §1).
      perform set_config('app.audit_override', jsonb_build_object(
        'action', 'approved', 'meta', jsonb_build_object('via', 'correction', 'reason', v_reason))::text, true);
      insert into public.leave_requests (
        member_id, type, start_date, end_date, reason, state, source, decided_by, decided_at, decision_reason)
      values (
        v_day.member_id, v_to::text::public.leave_type, v_day.work_date, v_day.work_date, v_reason,
        'approved', 'owner', v_caller, now(), v_reason)
      returning id into v_link;
    end if;

    v_state := 'corrected';
    perform set_config('app.audit_override', jsonb_build_object(
      'action', 'corrected',
      'meta', jsonb_build_object('status', v_to, 'reason', v_reason, 'from_status', v_day.final_status))::text, true);
    update public.attendance_days
    set state = 'corrected', final_status = v_to, decided_by = v_caller, decided_at = now(),
        decision_reason = v_reason, proposed_by_system = false,
        worked_on_leave = (v_to = 'present' and v_day.worked_on_leave),
        leave_request_id = v_link
    where id = v_day.id;
    perform app.attendance_event(v_day.id, 'corrected', v_day.final_status, v_to, v_reason, v_caller);
  end if;

  return v_state;
end;
$$;

revoke all on function public.attendance_decide(uuid, text, public.day_status, text) from public, anon;
grant execute on function public.attendance_decide(uuid, text, public.day_status, text) to authenticated, service_role;

comment on function public.attendance_decide(uuid, text, public.day_status, text) is
  'attendance.decide. approve: pending_review → approved with the submitted choice (or the '
  'proposed absent); worked_on_leave when Present was submitted on an approved-leave day. correct: '
  'any state → corrected with the given status, reason required. A linked submitted request is '
  'decided in the same call; a leave status with no approved request behind it creates one '
  '(source = owner). Bulk = one call per row. Audit action: approved | corrected. Notifies the '
  'member (5.1).';

-- Logout -----------------------------------------------------------------------------------------
create or replace function app.attendance_logout(p_member_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_today date := app.today_ist();
  v_day public.attendance_days;
begin
  select d.* into v_day
  from public.attendance_days d
  where d.member_id = p_member_id and d.work_date = v_today
  for update;
  if v_day.id is null then
    -- Worked past midnight: the logout belongs to yesterday's day, a real time, never made up.
    select d.* into v_day
    from public.attendance_days d
    where d.member_id = p_member_id and d.work_date = v_today - 1
      and d.first_login_at is not null and d.last_logout_at is null
    for update;
  end if;
  if v_day.id is null then
    return null;
  end if;

  -- Only the logout columns move: a late logout is information, never a re-opening.
  perform set_config('app.audit_override', jsonb_build_object('action', 'logout')::text, true);
  update public.attendance_days set last_logout_at = now() where id = v_day.id;
  perform app.attendance_event(v_day.id, 'logout', null, null, null, p_member_id);
  return v_day.id;
end;
$$;

revoke all on function app.attendance_logout(uuid) from public, authenticated;
grant execute on function app.attendance_logout(uuid) to service_role;

comment on function app.attendance_logout(uuid) is
  'Called by session_logout(). Sets last_logout_at on today''s day, or on yesterday''s when there is '
  'none today and yesterday has a login and no logout. Writes nothing else. Returns the day id or '
  'null (the Owner, or no day). Audit action: logout.';

create or replace function public.session_logout(user_agent text default null, ip_hash text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_member_id uuid;
  v_id uuid;
begin
  select m.id into v_member_id from app.current_member() m;
  if v_member_id is null then
    perform app.fail('UNAUTHENTICATED', 'Your account is not active.');
  end if;

  insert into public.session_events (member_id, kind, user_agent, ip_hash)
  values (v_member_id, 'logout', nullif(left(user_agent, 512), ''), nullif(left(ip_hash, 128), ''))
  returning id into v_id;

  perform app.attendance_logout(v_member_id);

  return v_id;
end;
$$;

comment on function public.session_logout(text, text) is
  'Records session_events(logout) for the calling active member, before the auth session is '
  'ended, then app.attendance_logout() stamps last_logout_at on the attendance day (2.1). The '
  'Owner has no day: session_events only.';

-- attendance_flag_overtime -----------------------------------------------------------------------
create or replace function public.attendance_flag_overtime(day_id uuid, reason text default null)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid;
  v_org uuid;
  v_reason text := app.clean_reason(reason);
  v_day public.attendance_days;
begin
  select r.caller_id, r.org_id into v_caller, v_org from app.attendance_require_self() r;

  select d.* into v_day
  from public.attendance_days d
  where d.id = day_id and d.member_id = v_caller
  for update;
  if v_day.id is null then
    perform app.fail('NOT_FOUND', 'This attendance day is not yours.');
  end if;

  perform set_config('app.audit_override', jsonb_build_object(
    'action', 'overtime_flagged', 'meta', jsonb_build_object('reason', v_reason))::text, true);
  update public.attendance_days set overtime_flag = true, overtime_reason = v_reason where id = v_day.id;
  perform app.attendance_event(v_day.id, 'overtime_flagged', null, null, v_reason, v_caller);
  return true;
end;
$$;

revoke all on function public.attendance_flag_overtime(uuid, text) from public, anon;
grant execute on function public.attendance_flag_overtime(uuid, text) to authenticated, service_role;

comment on function public.attendance_flag_overtime(uuid, text) is
  'attendance.self, own day, any state: overtime_flag with an optional reason (a second call '
  'replaces the reason). Notice only: no approval, no notification. Audit action: overtime_flagged.';

-- leave_submit -----------------------------------------------------------------------------------
create or replace function app.leave_validate(p_type public.leave_type, p_start date, p_end date, p_min_start date)
returns void
language plpgsql
set search_path = ''
as $$
begin
  if p_type is null or p_start is null or p_end is null then
    perform app.fail('VALIDATION', 'Choose the leave type and its dates.');
  end if;
  if p_end < p_start then
    perform app.fail('VALIDATION', 'The end date is before the start date.');
  end if;
  if p_type = 'half_day' and p_start <> p_end then
    perform app.fail('VALIDATION', 'A half day is a single date.');
  end if;
  if p_min_start is not null and p_start < p_min_start then
    perform app.fail('VALIDATION', 'Leave cannot start in the past.');
  end if;
end;
$$;

revoke all on function app.leave_validate(public.leave_type, date, date, date) from public;
grant execute on function app.leave_validate(public.leave_type, date, date, date) to authenticated, service_role;

create or replace function public.leave_submit(
  type public.leave_type, start_date date, end_date date, reason text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid;
  v_org uuid;
  v_reason text := app.clean_reason(reason);
  v_id uuid;
begin
  select r.caller_id, r.org_id into v_caller, v_org from app.attendance_require_self() r;
  perform app.leave_validate(type, start_date, end_date, app.today_ist());
  -- One member's leave writes run one at a time, so two tabs cannot both pass the overlap check.
  perform pg_advisory_xact_lock(hashtext('leave:' || v_caller::text));
  if app.leave_overlaps(v_caller, start_date, end_date, null) then
    perform app.fail('CONFLICT', 'You already have a request for these dates. Request a change to it instead.');
  end if;

  perform set_config('app.audit_override', jsonb_build_object(
    'action', 'submitted', 'meta', jsonb_build_object('source', 'form'))::text, true);
  insert into public.leave_requests (member_id, type, start_date, end_date, reason, state, source)
  values (v_caller, type, start_date, end_date, v_reason, 'submitted', 'form')
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.leave_submit(public.leave_type, date, date, text) from public, anon;
grant execute on function public.leave_submit(public.leave_type, date, date, text) to authenticated, service_role;

comment on function public.leave_submit(public.leave_type, date, date, text) is
  'attendance.self. A leave request from today on (half day: one date), reason optional. CONFLICT '
  'when it overlaps the caller''s own submitted or approved request; closed requests never block. '
  'Audit action: submitted. Notifies the Owner (5.1).';

-- leave_withdraw ---------------------------------------------------------------------------------
create or replace function public.leave_withdraw(request_id uuid)
returns public.leave_state
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid;
  v_org uuid;
  v_req public.leave_requests;
begin
  select r.caller_id, r.org_id into v_caller, v_org from app.attendance_require_self() r;

  select r.* into v_req from public.leave_requests r where r.id = request_id and r.member_id = v_caller for update;
  if v_req.id is null then
    perform app.fail('NOT_FOUND', 'This leave request is not yours.');
  end if;
  if v_req.source = 'attendance' then
    perform app.fail('INVALID_STATE', 'Today''s attendance is under review; the Owner decides it with the day.');
  end if;
  if v_req.state <> 'submitted' then
    perform app.fail('INVALID_STATE', 'Only a request that is still waiting can be withdrawn.');
  end if;

  perform set_config('app.audit_override', jsonb_build_object('action', 'withdrawn')::text, true);
  update public.leave_requests set state = 'withdrawn' where id = v_req.id;
  return 'withdrawn';
end;
$$;

revoke all on function public.leave_withdraw(uuid) from public, anon;
grant execute on function public.leave_withdraw(uuid) to authenticated, service_role;

comment on function public.leave_withdraw(uuid) is
  'attendance.self, own request, submitted → withdrawn. Never a source = attendance request: the '
  'attendance day is its single door. Audit action: withdrawn. Notifies nobody.';

-- leave_request_change ---------------------------------------------------------------------------
create or replace function public.leave_request_change(
  request_id uuid, type public.leave_type default null, start_date date default null,
  end_date date default null, reason text default null, cancel boolean default false)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid;
  v_org uuid;
  v_reason text := app.clean_reason(reason);
  v_req public.leave_requests;
  v_type public.leave_type;
  v_start date;
  v_end date;
  v_id uuid;
begin
  select r.caller_id, r.org_id into v_caller, v_org from app.attendance_require_self() r;

  perform pg_advisory_xact_lock(hashtext('leave:' || v_caller::text));
  select r.* into v_req from public.leave_requests r where r.id = request_id and r.member_id = v_caller for update;
  if v_req.id is null then
    perform app.fail('NOT_FOUND', 'This leave request is not yours.');
  end if;
  if v_req.state <> 'approved' then
    perform app.fail('INVALID_STATE', 'Only approved leave can be changed or cancelled.');
  end if;
  if exists (select 1 from public.leave_requests r where r.supersedes_id = v_req.id and r.state = 'submitted') then
    perform app.fail('CONFLICT', 'A change to this leave is already waiting for the Owner.');
  end if;

  if coalesce(cancel, false) then
    v_type := v_req.type; v_start := v_req.start_date; v_end := v_req.end_date;
  else
    v_type := type; v_start := start_date; v_end := end_date;
    perform app.leave_validate(v_type, v_start, v_end, null);
    if v_start < app.today_ist() and v_start <> v_req.start_date then
      perform app.fail('VALIDATION', 'Leave cannot start in the past.');
    end if;
    if v_end < app.today_ist() then
      perform app.fail('VALIDATION', 'The changed leave must end today or later.');
    end if;
    if app.leave_overlaps(v_caller, v_start, v_end, v_req.id) then
      perform app.fail('CONFLICT', 'You already have another request for these dates.');
    end if;
  end if;

  perform set_config('app.audit_override', jsonb_build_object(
    'action', case when coalesce(cancel, false) then 'cancellation_requested' else 'change_requested' end,
    'meta', jsonb_build_object('supersedes_id', v_req.id))::text, true);
  insert into public.leave_requests (
    member_id, type, start_date, end_date, reason, state, source, supersedes_id, requests_cancellation)
  values (v_caller, v_type, v_start, v_end, v_reason, 'submitted', 'form', v_req.id, coalesce(cancel, false))
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.leave_request_change(uuid, public.leave_type, date, date, text, boolean) from public, anon;
grant execute on function public.leave_request_change(uuid, public.leave_type, date, date, text, boolean)
  to authenticated, service_role;

comment on function public.leave_request_change(uuid, public.leave_type, date, date, text, boolean) is
  'attendance.self, own approved request → a new submitted row with supersedes_id (cancel = true '
  'copies the dates and sets requests_cancellation). One open change per request. The original '
  'stays approved until the Owner decides. Audit action: change_requested | cancellation_requested. '
  'Notifies the Owner (5.1).';

-- leave_decide -----------------------------------------------------------------------------------
create or replace function public.leave_decide(request_id uuid, decision text, reason text default null)
returns public.leave_state
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid;
  v_org uuid;
  v_reason text := app.clean_reason(reason);
  v_req public.leave_requests;
  v_orig public.leave_requests;
begin
  select r.caller_id, r.org_id into v_caller, v_org from app.attendance_require_decider() r;

  if decision is null or decision not in ('approve', 'reject') then
    perform app.fail('VALIDATION', 'The decision is approve or reject.');
  end if;

  select r.* into v_req
  from public.leave_requests r
  join public.members m on m.id = r.member_id and m.org_id = v_org
  where r.id = request_id
  for update of r;
  if v_req.id is null then
    perform app.fail('NOT_FOUND', 'This leave request does not exist.');
  end if;
  if v_req.source = 'attendance' then
    perform app.fail('INVALID_STATE', 'Decide this one from the attendance day: it was made at the gate.');
  end if;
  if v_req.state <> 'submitted' then
    perform app.fail('INVALID_STATE', 'This request has already been decided.');
  end if;

  if decision = 'reject' then
    if v_reason is null then
      perform app.fail('REASON_REQUIRED', 'A rejection needs a reason.');
    end if;
    perform set_config('app.audit_override', jsonb_build_object(
      'action', 'rejected', 'meta', jsonb_build_object('reason', v_reason))::text, true);
    update public.leave_requests
    set state = 'rejected', decided_by = v_caller, decided_at = now(), decision_reason = v_reason
    where id = v_req.id;
    return 'rejected';
  end if;

  if v_req.supersedes_id is not null then
    select r.* into v_orig from public.leave_requests r where r.id = v_req.supersedes_id for update;
  end if;

  if v_req.requests_cancellation then
    if v_orig.state <> 'approved' then
      perform app.fail('INVALID_STATE', 'The leave this cancellation refers to is no longer approved.');
    end if;
    perform set_config('app.audit_override', jsonb_build_object(
      'action', 'cancelled', 'meta', jsonb_build_object('by_request', v_req.id, 'reason', v_reason))::text, true);
    update public.leave_requests
    set state = 'cancelled', decided_by = v_caller, decided_at = now(),
        decision_reason = coalesce(v_reason, 'cancellation approved')
    where id = v_orig.id;
    perform app.attendance_release_leave(v_orig, null, null);

    perform set_config('app.audit_override', jsonb_build_object(
      'action', 'cancelled', 'meta', jsonb_build_object('reason', v_reason))::text, true);
    update public.leave_requests
    set state = 'cancelled', decided_by = v_caller, decided_at = now(), decision_reason = v_reason
    where id = v_req.id;
    return 'cancelled';
  end if;

  perform pg_advisory_xact_lock(hashtext('leave:' || v_req.member_id::text));
  if v_orig.id is not null and v_orig.state = 'approved' then
    perform set_config('app.audit_override', jsonb_build_object(
      'action', 'superseded', 'meta', jsonb_build_object('by', v_req.id))::text, true);
    update public.leave_requests set state = 'superseded' where id = v_orig.id;
    perform app.attendance_release_leave(v_orig, v_req.start_date, v_req.end_date);
  end if;
  -- Approved leave that already covers these dates (a race at submit time, or an Owner
  -- correction since): the Owner cancels or edits that one first. Submitted overlaps are not
  -- checked here; "the leave wins" supersedes a gate request, and the Owner rejects the rest.
  if exists (
    select 1 from public.leave_requests r
    where r.member_id = v_req.member_id and r.state = 'approved' and r.id <> v_req.id
      and r.start_date <= v_req.end_date and r.end_date >= v_req.start_date
  ) then
    perform app.fail('CONFLICT', 'Approved leave already covers these dates. Cancel or edit it first.');
  end if;

  perform set_config('app.audit_override', jsonb_build_object(
    'action', 'approved', 'meta', jsonb_build_object('reason', v_reason))::text, true);
  update public.leave_requests
  set state = 'approved', decided_by = v_caller, decided_at = now(), decision_reason = v_reason
  where id = v_req.id
  returning * into v_req;
  perform app.attendance_apply_leave(v_req);
  return 'approved';
end;
$$;

revoke all on function public.leave_decide(uuid, text, text) from public, anon;
grant execute on function public.leave_decide(uuid, text, text) to authenticated, service_role;

comment on function public.leave_decide(uuid, text, text) is
  'attendance.decide, submitted only, never source = attendance. reject needs a reason. approve '
  'supersedes (or, for a cancellation, cancels) the original, then "a later leave wins" over the '
  'member''s days in range and a cancelled leave hands today''s untouched derived day back to the '
  'gate. Audit action: approved | rejected | cancelled (+ superseded | cancelled on the original). '
  'Notifies the member (5.1).';

-- leave_owner_edit / leave_owner_cancel ----------------------------------------------------------
create or replace function public.leave_owner_edit(
  request_id uuid, type public.leave_type, start_date date, end_date date, reason text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid;
  v_org uuid;
  v_reason text := app.clean_reason(reason);
  v_orig public.leave_requests;
  v_new public.leave_requests;
begin
  select r.caller_id, r.org_id into v_caller, v_org from app.attendance_require_decider() r;

  select r.* into v_orig
  from public.leave_requests r
  join public.members m on m.id = r.member_id and m.org_id = v_org
  where r.id = request_id
  for update of r;
  if v_orig.id is null then
    perform app.fail('NOT_FOUND', 'This leave request does not exist.');
  end if;
  if v_orig.state <> 'approved' then
    perform app.fail('INVALID_STATE', 'Only approved leave can be edited.');
  end if;
  perform app.leave_validate(type, start_date, end_date, null);
  perform pg_advisory_xact_lock(hashtext('leave:' || v_orig.member_id::text));
  -- A pending change or cancellation the person opened against it counts too: decide it first.
  if app.leave_overlaps(v_orig.member_id, start_date, end_date, v_orig.id) then
    perform app.fail('CONFLICT', 'This person has another open request on these dates. Decide it first.');
  end if;

  perform set_config('app.audit_override', jsonb_build_object(
    'action', 'superseded', 'meta', jsonb_build_object('by_owner', true, 'reason', v_reason))::text, true);
  update public.leave_requests set state = 'superseded' where id = v_orig.id;

  perform set_config('app.audit_override', jsonb_build_object(
    'action', 'approved', 'meta', jsonb_build_object('via', 'owner_edit', 'reason', v_reason))::text, true);
  insert into public.leave_requests (
    member_id, type, start_date, end_date, reason, state, source, supersedes_id, decided_by, decided_at, decision_reason)
  values (
    v_orig.member_id, type, start_date, end_date, v_reason, 'approved', 'owner', v_orig.id, v_caller, now(), v_reason)
  returning * into v_new;

  perform app.attendance_release_leave(v_orig, v_new.start_date, v_new.end_date);
  perform app.attendance_apply_leave(v_new);
  return v_new.id;
end;
$$;

revoke all on function public.leave_owner_edit(uuid, public.leave_type, date, date, text) from public, anon;
grant execute on function public.leave_owner_edit(uuid, public.leave_type, date, date, text) to authenticated, service_role;

comment on function public.leave_owner_edit(uuid, public.leave_type, date, date, text) is
  'attendance.decide, approved only: the original becomes superseded by a new source = owner, '
  'approved row with the given dates, then the same day corrections as leave_decide. CONFLICT '
  'while the person has another open request on those dates (a pending change included: decide '
  'it first). Returns the new id. Audit action: superseded + approved. Notifies the member (5.1).';

create or replace function public.leave_owner_cancel(request_id uuid, reason text default null)
returns public.leave_state
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid;
  v_org uuid;
  v_reason text := app.clean_reason(reason);
  v_orig public.leave_requests;
begin
  select r.caller_id, r.org_id into v_caller, v_org from app.attendance_require_decider() r;

  select r.* into v_orig
  from public.leave_requests r
  join public.members m on m.id = r.member_id and m.org_id = v_org
  where r.id = request_id
  for update of r;
  if v_orig.id is null then
    perform app.fail('NOT_FOUND', 'This leave request does not exist.');
  end if;
  if v_orig.state <> 'approved' then
    perform app.fail('INVALID_STATE', 'Only approved leave can be cancelled.');
  end if;
  if v_reason is null then
    perform app.fail('REASON_REQUIRED', 'Cancelling approved leave needs a reason.');
  end if;

  perform set_config('app.audit_override', jsonb_build_object(
    'action', 'cancelled', 'meta', jsonb_build_object('by_owner', true, 'reason', v_reason))::text, true);
  update public.leave_requests
  set state = 'cancelled', decided_by = v_caller, decided_at = now(), decision_reason = v_reason
  where id = v_orig.id;
  perform app.attendance_release_leave(v_orig, null, null);
  return 'cancelled';
end;
$$;

revoke all on function public.leave_owner_cancel(uuid, text) from public, anon;
grant execute on function public.leave_owner_cancel(uuid, text) to authenticated, service_role;

comment on function public.leave_owner_cancel(uuid, text) is
  'attendance.decide, approved only, reason required: → cancelled, and today''s untouched derived '
  'day goes back to awaiting_choice. Audit action: cancelled. Notifies the member (5.1).';
