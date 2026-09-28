-- 3b.2 Extra work and comp leave credits (PRODUCT §4.3a, kickoff 3b decisions 10-17; DATA-MODEL §3
--   "3b.2"; WORKFLOWS §2 "Settled in 3b.2", §9).
--
-- 1. extra_work_notes: an overtime note or an "I worked today" note on a day off (7 days back),
--    reviewed by the Owner in Approvals -> Extra work: grant comp leave (½ or 1 day), no comp
--    leave, and for a day off whether the day counts as worked. Nothing is automatic.
-- 2. comp_leave_credits: Owner grants, from a note or standalone, expiring at the end of the IST
--    calendar month they were granted in. The status is derived from the row, so nothing expires
--    a credit by job: it is simply past its month. Revoke while unused.
-- 3. comp_leave_credit_uses: a comp leave request reserves credits (oldest first) when submitted,
--    uses them when approved, and gives them back on reject / withdraw / cancel / supersede.
-- 4. leave_submit_comp(): comp leave only through the leave form, only with a credit, one date,
--    on or before the credit's expiry. The 2.x leave functions are re-created with the same
--    signatures and one extra call each (app.comp_credit_settle), a no-op for a request with no
--    credit uses, so main's app keeps its behaviour on the shared staging database.
--
-- EXPAND-ONLY (ARCHITECTURE §18): one nullable column on leave_requests (with a check main's
-- writers satisfy: they leave it null), three new tables with RLS, new functions, same-signature
-- re-creations. attendance_end_day() is 3b.1's (never main's) and is dropped and re-created with
-- the optional overtime note.
-- Every write is labelled through app.audit_override; the leave: lock comes before any row lock.
-- No notification rows yet: the WORKFLOWS §9 recipient is named in each comment (decision 32).
-- Append-only: never edit once applied.

-- leave_requests.credit_days -------------------------------------------------------------------
alter table public.leave_requests
  add column credit_days numeric(2,1) null,
  add constraint leave_requests_credit_days check (
    credit_days is null
    or (type = 'comp_leave' and credit_days = 1.0)
    or (type = 'half_day' and credit_days = 0.5));

comment on column public.leave_requests.credit_days is
  'The comp leave credit this request uses (3b.2): 1.0 for a full comp day (type comp_leave), 0.5 '
  'for a half comp day (type half_day). Set only by leave_submit_comp(); null for every other '
  'request, a 2.x gate or Owner-set comp leave included.';

drop trigger protect_columns on public.leave_requests;
create trigger protect_columns before update on public.leave_requests
  for each row execute function app.protect_columns(
    'member_id', 'type', 'start_date', 'end_date', 'reason', 'state', 'source', 'supersedes_id',
    'requests_cancellation', 'decided_by', 'decided_at', 'decision_reason', 'credit_days');

-- extra_work_notes -------------------------------------------------------------------------------
create table public.extra_work_notes (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.members (id),
  work_date date not null,
  kind text not null check (kind in ('overtime', 'day_off')),
  duration_minutes integer null check (duration_minutes is null or (duration_minutes > 0 and duration_minutes <= 1440)),
  note text not null,
  state text not null default 'submitted' check (state in ('submitted', 'reviewed')),
  decision text null check (decision is null or decision in ('granted', 'no_comp_leave')),
  day_marked_worked boolean not null default false,
  decided_by uuid null references public.members (id),
  decided_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint extra_work_notes_member_date_kind_key unique (member_id, work_date, kind),
  constraint extra_work_notes_decided check (
    (state = 'submitted' and decision is null and decided_at is null and decided_by is null)
    or (state = 'reviewed' and decision is not null and decided_at is not null and decided_by is not null)),
  constraint extra_work_notes_duration_kind check (kind = 'overtime' or duration_minutes is null),
  constraint extra_work_notes_marked_kind check (kind = 'day_off' or not day_marked_worked)
);

comment on table public.extra_work_notes is
  'An overtime note, or an "I worked today" note on a day off, up to 7 days back (PRODUCT §4.3a, '
  '3b.2). The Owner reviews it in Approvals -> Extra work: a grant is the comp_leave_credits row '
  'whose note_id points here; decision = no_comp_leave reads "Reviewed by the Owner". Every write '
  'is a transition function.';

create index extra_work_notes_pending_idx on public.extra_work_notes (created_at) where state = 'submitted';
create index extra_work_notes_member_date_idx on public.extra_work_notes (member_id, work_date);
create index extra_work_notes_decided_by_idx on public.extra_work_notes (decided_by);

create trigger set_updated_at before update on public.extra_work_notes
  for each row execute function app.set_updated_at();
create trigger protect_columns before update on public.extra_work_notes
  for each row execute function app.protect_columns(
    'member_id', 'work_date', 'kind', 'duration_minutes', 'note', 'state', 'decision',
    'day_marked_worked', 'decided_by', 'decided_at');
create trigger audit_row_change after insert or update or delete on public.extra_work_notes
  for each row execute function app.audit_row_change();

alter table public.extra_work_notes enable row level security;
create policy extra_work_notes_select on public.extra_work_notes for select to authenticated
  using (member_id = (select c.id from app.current_member() c)
         or (select app.has_permission('attendance.view_all')));

revoke all on public.extra_work_notes from anon;
revoke insert, update, delete, truncate, references, trigger on public.extra_work_notes from authenticated;

-- comp_leave_credits -----------------------------------------------------------------------------
create table public.comp_leave_credits (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.members (id),
  days numeric(2,1) not null check (days in (0.5, 1.0)),
  used_days numeric(2,1) not null default 0 check (used_days >= 0),
  reserved_days numeric(2,1) not null default 0 check (reserved_days >= 0),
  granted_by uuid not null references public.members (id),
  granted_at timestamptz not null default now(),
  granted_on date not null,
  expires_on date not null,
  note text null,
  note_id uuid null references public.extra_work_notes (id),
  revoked_at timestamptz null,
  revoked_by uuid null references public.members (id),
  revoke_reason text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint comp_leave_credits_balance check (used_days + reserved_days <= days),
  constraint comp_leave_credits_expiry check (expires_on >= granted_on),
  constraint comp_leave_credits_revoked check (
    (revoked_at is null and revoked_by is null and revoke_reason is null)
    or (revoked_at is not null and revoked_by is not null and revoke_reason is not null
        and used_days = 0 and reserved_days = 0))
);

comment on table public.comp_leave_credits is
  'A comp leave credit the Owner granted (PRODUCT §4.3a, 3b.2): ½ or 1 day, from an extra-work '
  'note (note_id) or standalone, expiring at the end of the IST month it was granted in. Status is '
  'derived: revoked_at -> revoked; used_days = days -> used; expires_on < today -> expired; '
  'reserved_days > 0 with nothing free -> reserved; else available (days - used - reserved free). '
  'Every write is a transition function.';

create index comp_leave_credits_member_expiry_idx on public.comp_leave_credits (member_id, expires_on);
create index comp_leave_credits_note_idx on public.comp_leave_credits (note_id);
create index comp_leave_credits_granted_by_idx on public.comp_leave_credits (granted_by);
create index comp_leave_credits_revoked_by_idx on public.comp_leave_credits (revoked_by);

create trigger set_updated_at before update on public.comp_leave_credits
  for each row execute function app.set_updated_at();
create trigger protect_columns before update on public.comp_leave_credits
  for each row execute function app.protect_columns(
    'member_id', 'days', 'used_days', 'reserved_days', 'granted_by', 'granted_at', 'granted_on',
    'expires_on', 'note', 'note_id', 'revoked_at', 'revoked_by', 'revoke_reason');
create trigger audit_row_change after insert or update or delete on public.comp_leave_credits
  for each row execute function app.audit_row_change();

alter table public.comp_leave_credits enable row level security;
create policy comp_leave_credits_select on public.comp_leave_credits for select to authenticated
  using (member_id = (select c.id from app.current_member() c)
         or (select app.has_permission('attendance.view_all')));

revoke all on public.comp_leave_credits from anon;
revoke insert, update, delete, truncate, references, trigger on public.comp_leave_credits from authenticated;

-- comp_leave_credit_uses -------------------------------------------------------------------------
create table public.comp_leave_credit_uses (
  id uuid primary key default gen_random_uuid(),
  credit_id uuid not null references public.comp_leave_credits (id),
  leave_request_id uuid not null references public.leave_requests (id),
  days numeric(2,1) not null check (days in (0.5, 1.0)),
  state text not null default 'reserved' check (state in ('reserved', 'used', 'released')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint comp_leave_credit_uses_key unique (credit_id, leave_request_id)
);

comment on table public.comp_leave_credit_uses is
  'The ledger between a comp leave request and the credits it draws on, oldest first (3b.2): '
  'reserved on submit, used on approval, released on reject / withdraw / cancel / supersede.';

create index comp_leave_credit_uses_request_idx on public.comp_leave_credit_uses (leave_request_id);

create trigger set_updated_at before update on public.comp_leave_credit_uses
  for each row execute function app.set_updated_at();
create trigger protect_columns before update on public.comp_leave_credit_uses
  for each row execute function app.protect_columns('credit_id', 'leave_request_id', 'days', 'state');
create trigger audit_row_change after insert or update or delete on public.comp_leave_credit_uses
  for each row execute function app.audit_row_change();

alter table public.comp_leave_credit_uses enable row level security;
-- The credit's own RLS decides (the subquery runs as the caller).
create policy comp_leave_credit_uses_select on public.comp_leave_credit_uses for select to authenticated
  using (exists (select 1 from public.comp_leave_credits c where c.id = credit_id));

revoke all on public.comp_leave_credit_uses from anon;
revoke insert, update, delete, truncate, references, trigger on public.comp_leave_credit_uses from authenticated;

-- activity_log: a member reads the entries about their own notes and credits (PERMISSIONS §2).
create policy activity_log_select_extra_work_self on public.activity_log for select to authenticated
  using (org_id = (select c.org_id from app.current_member() c)
         and ((entity = 'extra_work_notes'
               and entity_id in (select n.id from public.extra_work_notes n
                                 where n.member_id = (select c.id from app.current_member() c)))
              or (entity = 'comp_leave_credits'
                  and entity_id in (select k.id from public.comp_leave_credits k
                                    where k.member_id = (select c.id from app.current_member() c)))));

comment on policy activity_log_select_extra_work_self on public.activity_log is
  'Entries about the caller''s own extra-work notes and comp leave credits (3b.2). The Owner reads '
  'everything through activity.view_all.';

-- Helpers ------------------------------------------------------------------------------------------
create function app.ist_month_end(d date)
returns date
language sql
immutable
strict
parallel safe
set search_path = ''
as $$
  select (date_trunc('month', d::timestamp) + interval '1 month - 1 day')::date;
$$;

revoke all on function app.ist_month_end(date) from public;
grant execute on function app.ist_month_end(date) to authenticated, service_role;

comment on function app.ist_month_end(date) is
  'The last day of that date''s month: a comp leave credit expires at the end of the IST calendar '
  'month it was granted in (PRODUCT §4.3a, decision 15).';

-- The settle between a comp leave request and its credits. Internal: only the security definer
-- functions below call it (they run as the owner). A request with no uses is a no-op, which is
-- what keeps the re-created 2.x callers' meaning unchanged for main.
create function app.comp_credit_settle(p_request_id uuid, p_outcome text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_use public.comp_leave_credit_uses;
  v_count integer := 0;
begin
  if p_outcome not in ('used', 'released') then
    perform app.fail('VALIDATION', 'A credit use is settled as used or released.');
  end if;
  for v_use in
    select u.* from public.comp_leave_credit_uses u
    where u.leave_request_id = p_request_id
      and ((p_outcome = 'used' and u.state = 'reserved') or (p_outcome = 'released' and u.state in ('reserved', 'used')))
    order by u.created_at, u.id
    for update
  loop
    perform 1 from public.comp_leave_credits c where c.id = v_use.credit_id for update;
    perform set_config('app.audit_override', jsonb_build_object(
      'action', p_outcome, 'meta', jsonb_build_object('leave_request_id', p_request_id, 'days', v_use.days))::text, true);
    if p_outcome = 'used' then
      update public.comp_leave_credits
      set reserved_days = reserved_days - v_use.days, used_days = used_days + v_use.days
      where id = v_use.credit_id;
    elsif v_use.state = 'reserved' then
      update public.comp_leave_credits set reserved_days = reserved_days - v_use.days where id = v_use.credit_id;
    else
      update public.comp_leave_credits set used_days = used_days - v_use.days where id = v_use.credit_id;
    end if;
    perform set_config('app.audit_override', jsonb_build_object('action', p_outcome)::text, true);
    update public.comp_leave_credit_uses set state = p_outcome where id = v_use.id;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

revoke all on function app.comp_credit_settle(uuid, text) from public, authenticated;
grant execute on function app.comp_credit_settle(uuid, text) to service_role;

comment on function app.comp_credit_settle(uuid, text) is
  'Internal (3b.2). used: every reserved use of the request -> used (reserved_days -> used_days on '
  'the credit). released: every reserved or used use -> released (the days go back to the credit; '
  'a credit past its month simply shows them as expired). A request with no uses is a no-op. Audit '
  'on the credit and the use: used | released.';

-- extra_work_note_submit -------------------------------------------------------------------------
create function public.extra_work_note_submit(
  kind text, work_date date, note text, duration_minutes integer default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid;
  v_org uuid;
  v_note text := app.clean_reason(note);
  v_today date := app.today_ist();
  v_working boolean;
  v_id uuid;
begin
  select r.caller_id, r.org_id into v_caller, v_org from app.attendance_require_self() r;

  if kind is null or kind not in ('overtime', 'day_off') then
    perform app.fail('VALIDATION', 'A note is about overtime or a day off worked.');
  end if;
  if work_date is null or work_date > v_today or work_date < v_today - 7 then
    perform app.fail('VALIDATION', 'Pick a day from the last 7 days.');
  end if;
  if v_note is null then
    perform app.fail('VALIDATION', 'Say what you worked on.');
  end if;
  if kind = 'overtime' and duration_minutes is not null and (duration_minutes <= 0 or duration_minutes > 1440) then
    perform app.fail('VALIDATION', 'The duration must be between a minute and a day.');
  end if;

  -- null from is_working_day() means "unknown", which is not a day off (as attendance_touch).
  v_working := app.is_working_day(work_date) is not false;
  if kind = 'day_off' and v_working then
    perform app.fail('VALIDATION', 'That was a working day: add an overtime note instead.');
  end if;
  if kind = 'overtime' and not v_working then
    perform app.fail('VALIDATION', 'That was a day off: add an "I worked today" note instead.');
  end if;

  if exists (select 1 from public.extra_work_notes n
             where n.member_id = v_caller and n.work_date = extra_work_note_submit.work_date and n.kind = extra_work_note_submit.kind) then
    perform app.fail('CONFLICT', 'You already added a note for that day.');
  end if;
  if app.to_ist_date((select m.joined_at from public.members m where m.id = v_caller)) >= work_date then
    perform app.fail('VALIDATION', 'Your attendance had not started on that day.');
  end if;

  perform set_config('app.audit_override', jsonb_build_object(
    'action', 'submitted', 'meta', jsonb_build_object('kind', kind))::text, true);
  begin
    insert into public.extra_work_notes (member_id, work_date, kind, duration_minutes, note)
    values (v_caller, work_date, kind, case when kind = 'overtime' then duration_minutes end, v_note)
    returning id into v_id;
  exception when unique_violation then
    -- Two submits at once (two devices): the second reads as the rule, not a raw 23505.
    perform app.fail('CONFLICT', 'You already added a note for that day.');
  end;
  return v_id;
end;
$$;

revoke all on function public.extra_work_note_submit(text, date, text, integer) from public, anon;
grant execute on function public.extra_work_note_submit(text, date, text, integer) to authenticated, service_role;

comment on function public.extra_work_note_submit(text, date, text, integer) is
  'attendance.self. An overtime note (a working day, duration optional) or an "I worked today" '
  'note (a day off), for today or up to 7 days back, the note required (PRODUCT §4.3a). One per '
  'member, date and kind (CONFLICT). Audit action: submitted. Notifies the Owner (WORKFLOWS §9; '
  'the notification row is 5.1''s).';

-- extra_work_note_decide -------------------------------------------------------------------------
create function public.extra_work_note_decide(
  note_id uuid, decision text, days numeric default null, mark_day_worked boolean default false, note text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid;
  v_org uuid;
  v_owner_note text := app.clean_reason(note);
  v_note public.extra_work_notes;
  v_member uuid;
  v_credit uuid;
  v_day public.attendance_days;
  v_today date := app.today_ist();
begin
  select r.caller_id, r.org_id into v_caller, v_org from app.attendance_require_decider() r;

  if decision is null or decision not in ('grant', 'no_comp_leave') then
    perform app.fail('VALIDATION', 'The decision is grant or no_comp_leave.');
  end if;
  if decision = 'grant' and (days is null or days not in (0.5, 1.0)) then
    perform app.fail('VALIDATION', 'Grant half a day or one day.');
  end if;

  -- Whose note (no lock), then that person's leave: lock (the day may be written), then the row.
  select n.member_id into v_member
  from public.extra_work_notes n
  join public.members m on m.id = n.member_id and m.org_id = v_org
  where n.id = extra_work_note_decide.note_id;
  if v_member is null then
    perform app.fail('NOT_FOUND', 'This note does not exist.');
  end if;
  perform pg_advisory_xact_lock(hashtext('leave:' || v_member::text));

  select n.* into v_note from public.extra_work_notes n where n.id = extra_work_note_decide.note_id for update;
  if v_note.state <> 'submitted' then
    perform app.fail('INVALID_STATE', 'This note has already been reviewed.');
  end if;
  if coalesce(mark_day_worked, false) and v_note.kind <> 'day_off' then
    perform app.fail('VALIDATION', 'Only a day off can be marked as worked.');
  end if;

  if decision = 'grant' then
    perform set_config('app.audit_override', jsonb_build_object(
      'action', 'granted', 'meta', jsonb_build_object('note_id', v_note.id, 'days', days))::text, true);
    insert into public.comp_leave_credits (member_id, days, granted_by, granted_on, expires_on, note, note_id)
    values (v_member, days, v_caller, v_today, app.ist_month_end(v_today), v_owner_note, v_note.id)
    returning id into v_credit;
  end if;

  if coalesce(mark_day_worked, false) then
    select d.* into v_day
    from public.attendance_days d
    where d.member_id = v_member and d.work_date = v_note.work_date
    for update;
    if v_day.id is null then
      perform set_config('app.audit_override', jsonb_build_object(
        'action', 'corrected', 'meta', jsonb_build_object('via', 'extra_work_note', 'note_id', v_note.id,
                                                          'status', 'present', 'reason', 'worked on a day off'))::text, true);
      insert into public.attendance_days (
        member_id, work_date, is_day_off, state, final_status, decided_by, decided_at, decision_reason)
      values (v_member, v_note.work_date, true, 'corrected', 'present', v_caller, now(), 'worked on a day off')
      returning * into v_day;
      perform app.attendance_event(v_day.id, 'corrected', null, 'present', 'worked on a day off', v_caller);
    elsif not (v_day.state in ('approved', 'corrected') and v_day.final_status = 'present') then
      -- Whatever the day had (a 2.x sign-in with no choice, or a choice still waiting), the Owner
      -- says the day was worked; the leave request behind it, if any, is not touched.
      perform set_config('app.audit_override', jsonb_build_object(
        'action', 'corrected', 'meta', jsonb_build_object('via', 'extra_work_note', 'note_id', v_note.id,
                                                          'status', 'present', 'reason', 'worked on a day off',
                                                          'from_status', v_day.final_status))::text, true);
      update public.attendance_days
      set state = 'corrected', final_status = 'present', decided_by = v_caller, decided_at = now(),
          decision_reason = 'worked on a day off', proposed_by_system = false
      where id = v_day.id;
      perform app.attendance_event(v_day.id, 'corrected', v_day.final_status, 'present', 'worked on a day off', v_caller);
    end if;
  end if;

  perform set_config('app.audit_override', jsonb_build_object(
    'action', 'reviewed',
    'meta', jsonb_build_object('decision', decision, 'days', days, 'credit_id', v_credit,
                               'day_marked_worked', coalesce(mark_day_worked, false)))::text, true);
  update public.extra_work_notes
  set state = 'reviewed',
      decision = case when extra_work_note_decide.decision = 'grant' then 'granted' else 'no_comp_leave' end,
      day_marked_worked = coalesce(mark_day_worked, false), decided_by = v_caller, decided_at = now()
  where id = v_note.id;

  return v_credit;
end;
$$;

revoke all on function public.extra_work_note_decide(uuid, text, numeric, boolean, text) from public, anon;
grant execute on function public.extra_work_note_decide(uuid, text, numeric, boolean, text) to authenticated, service_role;

comment on function public.extra_work_note_decide(uuid, text, numeric, boolean, text) is
  'attendance.decide, a submitted note only. grant (days 0.5 | 1.0) creates a comp leave credit '
  'expiring at the end of this IST month, linked to the note, with the Owner''s optional note; '
  'no_comp_leave reviews it with nothing ("Reviewed by the Owner"). mark_day_worked, for a day-off '
  'note only, records the attendance day as Present on a day off (created, or corrected when it did '
  'not already count as worked; reason "worked on a day off"; any leave request stays). Takes the '
  'member''s leave: lock first. Audit: reviewed (+ granted, corrected). Returns the credit id or '
  'null. Notifies the member (WORKFLOWS §9; 5.1).';

-- comp_leave_grant -------------------------------------------------------------------------------
create function public.comp_leave_grant(member_id uuid, days numeric, note text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid;
  v_org uuid;
  v_note text := app.clean_reason(note);
  v_today date := app.today_ist();
  v_id uuid;
begin
  select r.caller_id, r.org_id into v_caller, v_org from app.attendance_require_decider() r;
  if days is null or days not in (0.5, 1.0) then
    perform app.fail('VALIDATION', 'Grant half a day or one day.');
  end if;
  if not exists (
    select 1 from public.members m
    where m.id = comp_leave_grant.member_id and m.org_id = v_org and m.status = 'active'
      and exists (select 1 from public.role_permissions rp where rp.role = m.role and rp.permission = 'attendance.self')) then
    perform app.fail('NOT_FOUND', 'Comp leave is granted to an active Admin or Staff member.');
  end if;
  perform pg_advisory_xact_lock(hashtext('leave:' || comp_leave_grant.member_id::text));

  perform set_config('app.audit_override', jsonb_build_object(
    'action', 'granted', 'meta', jsonb_build_object('days', days, 'standalone', true))::text, true);
  insert into public.comp_leave_credits (member_id, days, granted_by, granted_on, expires_on, note)
  values (comp_leave_grant.member_id, days, v_caller, v_today, app.ist_month_end(v_today), v_note)
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.comp_leave_grant(uuid, numeric, text) from public, anon;
grant execute on function public.comp_leave_grant(uuid, numeric, text) to authenticated, service_role;

comment on function public.comp_leave_grant(uuid, numeric, text) is
  'attendance.decide. A standalone comp leave grant (PRODUCT §4.3a, decision 14): half a day or one '
  'day to an active member who marks attendance, expiring at the end of this IST month, with an '
  'optional note the member sees. Audit action: granted. Notifies the member (5.1).';

-- comp_leave_revoke ------------------------------------------------------------------------------
create function public.comp_leave_revoke(credit_id uuid, reason text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid;
  v_org uuid;
  v_reason text := app.clean_reason(reason);
  v_credit public.comp_leave_credits;
  v_member uuid;
begin
  select r.caller_id, r.org_id into v_caller, v_org from app.attendance_require_decider() r;
  if v_reason is null then
    perform app.fail('REASON_REQUIRED', 'Revoking comp leave needs a reason the person will read.');
  end if;

  -- Whose credit (no lock), then that person's leave: lock, then the row (DATA-MODEL §3 lock
  -- order), so a revoke and a comp leave request for the same person serialise.
  select c.member_id into v_member
  from public.comp_leave_credits c
  join public.members m on m.id = c.member_id and m.org_id = v_org
  where c.id = comp_leave_revoke.credit_id;
  if v_member is not null then
    perform pg_advisory_xact_lock(hashtext('leave:' || v_member::text));
  end if;
  select c.* into v_credit
  from public.comp_leave_credits c
  join public.members m on m.id = c.member_id and m.org_id = v_org
  where c.id = comp_leave_revoke.credit_id
  for update of c;
  if v_credit.id is null then
    perform app.fail('NOT_FOUND', 'This comp leave credit does not exist.');
  end if;
  if v_credit.revoked_at is not null then
    perform app.fail('INVALID_STATE', 'This credit was already revoked.');
  end if;
  if v_credit.used_days > 0 then
    perform app.fail('INVALID_STATE', 'This credit has been used: correct the leave instead.');
  end if;
  if v_credit.reserved_days > 0 then
    perform app.fail('INVALID_STATE', 'A leave request is waiting on this credit: decide that first.');
  end if;
  if v_credit.expires_on < app.today_ist() then
    perform app.fail('INVALID_STATE', 'This credit has expired; there is nothing to revoke.');
  end if;

  perform set_config('app.audit_override', jsonb_build_object(
    'action', 'revoked', 'meta', jsonb_build_object('reason', v_reason))::text, true);
  update public.comp_leave_credits
  set revoked_at = now(), revoked_by = v_caller, revoke_reason = v_reason
  where id = v_credit.id;
end;
$$;

revoke all on function public.comp_leave_revoke(uuid, text) from public, anon;
grant execute on function public.comp_leave_revoke(uuid, text) to authenticated, service_role;

comment on function public.comp_leave_revoke(uuid, text) is
  'attendance.decide, REASON_REQUIRED. Revokes an unused, unreserved, unexpired credit (decision 17); '
  'the reason is shown to the member. Audit action: revoked. Notifies the member (5.1).';

-- comp_leave_balance -----------------------------------------------------------------------------
create function public.comp_leave_balance(member_id uuid default null)
returns table (available_days numeric, use_by date)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_caller uuid;
  v_target uuid;
  v_today date := app.today_ist();
begin
  select m.id into v_caller from app.current_member() m;
  if v_caller is null then
    perform app.fail('UNAUTHENTICATED', 'Your account is not active.');
  end if;
  v_target := coalesce(comp_leave_balance.member_id, v_caller);
  if v_target <> v_caller and not app.has_permission('attendance.view_all') then
    perform app.fail('FORBIDDEN', 'Only the Owner sees another member''s comp leave.');
  end if;

  return query
  select coalesce(sum(c.days - c.used_days - c.reserved_days), 0)::numeric, max(c.expires_on)
  from public.comp_leave_credits c
  where c.member_id = v_target and c.revoked_at is null and c.expires_on >= v_today
    and c.days - c.used_days - c.reserved_days > 0;
end;
$$;

revoke all on function public.comp_leave_balance(uuid) from public, anon;
grant execute on function public.comp_leave_balance(uuid) to authenticated, service_role;

comment on function public.comp_leave_balance(uuid) is
  'The free comp leave days of the caller (or, with attendance.view_all, of anyone) over unrevoked '
  'credits whose month has not ended, and the latest such expiry (the use-by date). Read only.';

-- leave_submit_comp ------------------------------------------------------------------------------
create function public.leave_submit_comp(start_date date, half_day boolean default false, reason text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid;
  v_org uuid;
  v_reason text := app.clean_reason(reason);
  v_type public.leave_type := case when coalesce(half_day, false) then 'half_day' else 'comp_leave' end;
  v_needed numeric := case when coalesce(half_day, false) then 0.5 else 1.0 end;
  v_left numeric;
  v_credit public.comp_leave_credits;
  v_take numeric;
  v_id uuid;
begin
  select r.caller_id, r.org_id into v_caller, v_org from app.attendance_require_self() r;
  perform app.leave_validate(v_type, start_date, start_date, app.today_ist());
  perform pg_advisory_xact_lock(hashtext('leave:' || v_caller::text));
  if app.leave_overlaps(v_caller, start_date, start_date, null) then
    perform app.fail('CONFLICT', 'You already have a request for this date. Request a change to it instead.');
  end if;

  -- The date counts, not the decision: only credits still valid on that date can cover it.
  select coalesce(sum(c.days - c.used_days - c.reserved_days), 0) into v_left
  from public.comp_leave_credits c
  where c.member_id = v_caller and c.revoked_at is null and c.expires_on >= start_date;
  if v_left < v_needed then
    perform app.fail('VALIDATION', 'You don''t have enough comp leave for that date.');
  end if;

  perform set_config('app.audit_override', jsonb_build_object(
    'action', 'submitted', 'meta', jsonb_build_object('source', 'form', 'comp', true, 'credit_days', v_needed))::text, true);
  insert into public.leave_requests (member_id, type, start_date, end_date, reason, state, source, credit_days)
  values (v_caller, v_type, start_date, start_date, v_reason, 'submitted', 'form', v_needed)
  returning id into v_id;

  -- Oldest first (decision 16).
  v_left := v_needed;
  for v_credit in
    select c.* from public.comp_leave_credits c
    where c.member_id = v_caller and c.revoked_at is null and c.expires_on >= start_date
      and c.days - c.used_days - c.reserved_days > 0
    order by c.granted_at, c.id
    for update
  loop
    exit when v_left <= 0;
    v_take := least(v_credit.days - v_credit.used_days - v_credit.reserved_days, v_left);
    perform set_config('app.audit_override', jsonb_build_object(
      'action', 'reserved', 'meta', jsonb_build_object('leave_request_id', v_id, 'days', v_take))::text, true);
    update public.comp_leave_credits set reserved_days = reserved_days + v_take where id = v_credit.id;
    perform set_config('app.audit_override', jsonb_build_object('action', 'reserved')::text, true);
    insert into public.comp_leave_credit_uses (credit_id, leave_request_id, days, state)
    values (v_credit.id, v_id, v_take, 'reserved');
    v_left := v_left - v_take;
  end loop;
  -- The sum above is read before the credits are locked: a credit revoked in between is skipped
  -- by the loop, and the request must not stand on nothing.
  if v_left > 0 then
    perform app.fail('VALIDATION', 'You don''t have enough comp leave for that date.');
  end if;

  return v_id;
end;
$$;

revoke all on function public.leave_submit_comp(date, boolean, text) from public, anon;
grant execute on function public.leave_submit_comp(date, boolean, text) to authenticated, service_role;

comment on function public.leave_submit_comp(date, boolean, text) is
  'attendance.self. A comp leave request for one date, today or later: a full day (type '
  'comp_leave, credit_days 1.0) or a half day (type half_day, credit_days 0.5), reason optional, '
  'CONFLICT on overlap. Draws the caller''s free credits valid on that date oldest first and '
  'reserves them; VALIDATION when they do not cover it. Still a leave request the Owner approves or '
  'rejects (decision 16). Audit action: submitted (+ reserved on the credits). Notifies the Owner '
  '(5.1).';

-- The 2.x leave functions, re-created with the settle -------------------------------------------
-- Same signatures, same bodies as 2.4 / 2.3 / 2.2, plus one call each; a request with no credit
-- uses settles nothing, so main's behaviour on the shared staging database is unchanged.

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

  -- 2.4: the caller's leave: lock first, like every other leave write.
  perform pg_advisory_xact_lock(hashtext('leave:' || v_caller::text));
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
  -- 3b.2: a comp leave request gives its credit back.
  perform app.comp_credit_settle(v_req.id, 'released');
  return 'withdrawn';
end;
$$;

comment on function public.leave_withdraw(uuid) is
  'attendance.self, own request, submitted → withdrawn. Never a source = attendance request: the '
  'attendance day is its single door. 2.4: takes the leave: advisory lock first. 3b.2: releases '
  'the comp leave credit a comp request reserved. Audit action: withdrawn. Notifies nobody.';

create or replace function public.leave_decide(request_id uuid, decision text, reason text default null)
returns table (state public.leave_state, kept_dates date[])
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_caller uuid;
  v_org uuid;
  v_reason text := app.clean_reason(reason);
  v_member uuid;
  v_req public.leave_requests;
  v_orig public.leave_requests;
  v_clash public.leave_requests;
  v_kept date[];
begin
  select r.caller_id, r.org_id into v_caller, v_org from app.attendance_require_decider() r;

  if decision is null or decision not in ('approve', 'reject') then
    perform app.fail('VALIDATION', 'The decision is approve or reject.');
  end if;

  -- 2.4: whose request it is (no lock), then that person's leave: lock, then the rows.
  select r.member_id into v_member
  from public.leave_requests r
  join public.members m on m.id = r.member_id and m.org_id = v_org
  where r.id = leave_decide.request_id;
  if v_member is null then
    perform app.fail('NOT_FOUND', 'This leave request does not exist.');
  end if;
  perform pg_advisory_xact_lock(hashtext('leave:' || v_member::text));

  select r.* into v_req from public.leave_requests r where r.id = leave_decide.request_id for update;
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
    update public.leave_requests r
    set state = 'rejected', decided_by = v_caller, decided_at = now(), decision_reason = v_reason
    where r.id = v_req.id;
    -- 3b.2: a rejected comp leave request gives its credit back.
    perform app.comp_credit_settle(v_req.id, 'released');
    return query select 'rejected'::public.leave_state, '{}'::date[];
    return;
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
    update public.leave_requests r
    set state = 'cancelled', decided_by = v_caller, decided_at = now(),
        decision_reason = coalesce(v_reason, 'cancellation approved')
    where r.id = v_orig.id;
    perform app.attendance_release_leave(v_orig, null, null);
    -- 3b.2: a cancelled comp leave gives its credit back (expired by now, or not).
    perform app.comp_credit_settle(v_orig.id, 'released');

    perform set_config('app.audit_override', jsonb_build_object(
      'action', 'cancelled', 'meta', jsonb_build_object('reason', v_reason))::text, true);
    update public.leave_requests r
    set state = 'cancelled', decided_by = v_caller, decided_at = now(), decision_reason = v_reason
    where r.id = v_req.id;
    return query select 'cancelled'::public.leave_state, '{}'::date[];
    return;
  end if;

  if v_orig.id is not null and v_orig.state = 'approved' then
    perform set_config('app.audit_override', jsonb_build_object(
      'action', 'superseded', 'meta', jsonb_build_object('by', v_req.id))::text, true);
    update public.leave_requests r set state = 'superseded' where r.id = v_orig.id;
    perform app.attendance_release_leave(v_orig, v_req.start_date, v_req.end_date);
    -- 3b.2: a superseded comp leave gives its credit back.
    perform app.comp_credit_settle(v_orig.id, 'released');
  end if;
  -- The later decision wins over a gate leave (WORKFLOWS §1, 2.2).
  perform app.leave_supersede_gate(v_req.member_id, v_req.start_date, v_req.end_date, v_req.id);
  -- Approved form or owner leave that already covers these dates (a race at submit time, or an
  -- Owner correction since): the Owner cancels or edits that one first. Submitted overlaps are
  -- not checked here; "the leave wins" supersedes a gate request, and the Owner rejects the rest.
  v_clash := app.leave_clash(v_req.member_id, v_req.start_date, v_req.end_date, v_req.id, true);
  if v_clash.id is not null then
    perform app.fail('CONFLICT', format('Approved leave (%s) already covers these dates. Cancel or edit it first.',
                                        app.leave_clash_label(v_clash)));
  end if;

  perform set_config('app.audit_override', jsonb_build_object(
    'action', 'approved', 'meta', jsonb_build_object('reason', v_reason))::text, true);
  update public.leave_requests r
  set state = 'approved', decided_by = v_caller, decided_at = now(), decision_reason = v_reason
  where r.id = v_req.id
  returning r.* into v_req;
  -- 3b.2: an approved comp leave uses its credit (oldest first, reserved at submit).
  perform app.comp_credit_settle(v_req.id, 'used');
  v_kept := app.attendance_apply_leave(v_req);
  return query select 'approved'::public.leave_state, v_kept;
end;
$$;

comment on function public.leave_decide(uuid, text, text) is
  'attendance.decide, submitted only, never source = attendance. reject needs a reason. approve '
  'supersedes (or, for a cancellation, cancels) the original, supersedes an approved gate leave '
  'on those dates (2.2), then "a later leave wins" over the member''s days in range and a '
  'cancelled leave hands today''s untouched derived day back to the gate. CONFLICT names an '
  'approved form or owner request on those dates. Returns (state, kept_dates): the dates of days '
  'the Owner decided (approved or corrected), which keep that decision. 2.4: takes the member''s '
  'leave: advisory lock before any row lock. 3b.2: a comp leave request''s credit is used on '
  'approval and released on reject, cancel or supersede. Audit action: approved | rejected | '
  'cancelled (+ superseded | cancelled on the original). Notifies the member (5.1).';

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
  v_member uuid;
  v_orig public.leave_requests;
begin
  select r.caller_id, r.org_id into v_caller, v_org from app.attendance_require_decider() r;

  -- 2.4: whose request it is (no lock), then that person's leave: lock, then the row.
  select r.member_id into v_member
  from public.leave_requests r
  join public.members m on m.id = r.member_id and m.org_id = v_org
  where r.id = request_id;
  if v_member is null then
    perform app.fail('NOT_FOUND', 'This leave request does not exist.');
  end if;
  perform pg_advisory_xact_lock(hashtext('leave:' || v_member::text));

  select r.* into v_orig from public.leave_requests r where r.id = request_id for update;
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
  -- 3b.2: a cancelled comp leave gives its credit back.
  perform app.comp_credit_settle(v_orig.id, 'released');
  return 'cancelled';
end;
$$;

comment on function public.leave_owner_cancel(uuid, text) is
  'attendance.decide, approved only, reason required: → cancelled, and today''s untouched derived '
  'day goes back to awaiting_choice. 2.4: takes the member''s leave: advisory lock before any row '
  'lock. 3b.2: releases a comp leave credit. Audit action: cancelled. Notifies the member (5.1).';

create or replace function public.leave_owner_edit(
  request_id uuid, type public.leave_type, start_date date, end_date date, reason text default null)
returns table (new_id uuid, kept_dates date[])
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid;
  v_org uuid;
  v_reason text := app.clean_reason(reason);
  v_member uuid;
  v_orig public.leave_requests;
  v_new public.leave_requests;
  v_new_id uuid := gen_random_uuid();
  v_clash public.leave_requests;
  v_kept date[];
begin
  select r.caller_id, r.org_id into v_caller, v_org from app.attendance_require_decider() r;

  -- 2.4: whose request it is (no lock), then that person's leave: lock, then the row.
  select r.member_id into v_member
  from public.leave_requests r
  join public.members m on m.id = r.member_id and m.org_id = v_org
  where r.id = leave_owner_edit.request_id;
  if v_member is null then
    perform app.fail('NOT_FOUND', 'This leave request does not exist.');
  end if;
  perform pg_advisory_xact_lock(hashtext('leave:' || v_member::text));

  select r.* into v_orig from public.leave_requests r where r.id = leave_owner_edit.request_id for update;
  if v_orig.state <> 'approved' then
    perform app.fail('INVALID_STATE', 'Only approved leave can be edited.');
  end if;
  perform app.leave_validate(leave_owner_edit.type, leave_owner_edit.start_date, leave_owner_edit.end_date, null);
  -- The later decision wins over a gate leave (WORKFLOWS §1, 2.2).
  perform app.leave_supersede_gate(v_orig.member_id, leave_owner_edit.start_date, leave_owner_edit.end_date,
                                   v_new_id, v_orig.id);
  -- A pending change or cancellation the person opened against it counts too: decide it first.
  v_clash := app.leave_clash(v_orig.member_id, leave_owner_edit.start_date, leave_owner_edit.end_date,
                             v_orig.id, false);
  if v_clash.id is not null then
    perform app.fail('CONFLICT', format('This person has another open request on these dates (%s, %s). Decide it first.',
                                        app.leave_clash_label(v_clash),
                                        case v_clash.state when 'submitted' then 'waiting' else 'approved' end));
  end if;

  perform set_config('app.audit_override', jsonb_build_object(
    'action', 'superseded', 'meta', jsonb_build_object('by_owner', true, 'reason', v_reason))::text, true);
  update public.leave_requests r set state = 'superseded' where r.id = v_orig.id;
  -- 3b.2: the Owner's replacement is owner-set leave; the comp credit goes back to the member.
  perform app.comp_credit_settle(v_orig.id, 'released');

  perform set_config('app.audit_override', jsonb_build_object(
    'action', 'approved', 'meta', jsonb_build_object('via', 'owner_edit', 'reason', v_reason))::text, true);
  insert into public.leave_requests (
    id, member_id, type, start_date, end_date, reason, state, source, supersedes_id, decided_by, decided_at, decision_reason)
  values (
    v_new_id, v_orig.member_id, leave_owner_edit.type, leave_owner_edit.start_date, leave_owner_edit.end_date,
    v_reason, 'approved', 'owner', v_orig.id, v_caller, now(), v_reason)
  returning * into v_new;

  perform app.attendance_release_leave(v_orig, v_new.start_date, v_new.end_date);
  v_kept := app.attendance_apply_leave(v_new);
  return query select v_new.id, coalesce(v_kept, '{}'::date[]);
end;
$$;

comment on function public.leave_owner_edit(uuid, public.leave_type, date, date, text) is
  'attendance.decide, approved only: the original becomes superseded by a new source = owner, '
  'approved row with the given dates, then the same day corrections as leave_decide. An approved '
  'gate leave on the new dates is superseded first (2.2). CONFLICT, naming the request, while the '
  'member has another open request on those dates (a pending change included: decide it first). '
  '2.4: takes the member''s leave: advisory lock before any row lock, and returns (new_id, '
  'kept_dates) like leave_decide. 3b.2: releases a superseded comp leave''s credit. Audit action: '
  'superseded + approved. Notifies the member (5.1).';

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
  if v_req.end_date < app.today_ist() then
    perform app.fail('INVALID_STATE', 'This leave has ended. Ask the Owner to correct it.');
  end if;
  if exists (select 1 from public.leave_requests r where r.supersedes_id = v_req.id and r.state = 'submitted') then
    perform app.fail('CONFLICT', 'A change to this leave is already waiting for the Owner.');
  end if;
  -- 3b.2: a comp leave request is tied to the credits it drew for that date; it is cancelled
  -- (the credit comes back) and requested again, never moved.
  if not coalesce(cancel, false) and v_req.credit_days is not null then
    perform app.fail('INVALID_STATE', 'Comp leave can''t be changed. Ask to cancel it and request it again for the new date.');
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

comment on function public.leave_request_change(uuid, public.leave_type, date, date, text, boolean) is
  'attendance.self, own approved request that has not ended (end_date >= today IST; INVALID_STATE '
  'otherwise: past leave is the Owner''s, through the attendance day) → a new submitted row with '
  'supersedes_id (cancel = true copies the dates and sets requests_cancellation). One open change '
  'per request. 3b.2: a comp leave request (credit_days set) cannot be changed, only cancelled. '
  'The original stays approved until the Owner decides. Audit action: change_requested | '
  'cancellation_requested. Notifies the Owner (5.1).';

-- attendance_end_day with the optional overtime note (3b.1's function, never main's) --------------
drop function public.attendance_end_day();
create function public.attendance_end_day(overtime_note text default null, overtime_minutes integer default null)
returns table (day_id uuid, work_date date, note_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_caller uuid;
  v_org uuid;
  v_today date := app.today_ist();
  v_day public.attendance_days;
  v_note_id uuid;
begin
  select r.caller_id, r.org_id into v_caller, v_org from app.attendance_require_self() r;

  perform pg_advisory_xact_lock(hashtext('leave:' || v_caller::text));

  select d.* into v_day
  from public.attendance_days d
  where d.member_id = v_caller and d.work_date = v_today and d.started_at is not null and d.ended_at is null
  for update;
  if v_day.id is null then
    -- Today started and ended: final, no resume. Checked before yesterday, or a second tap (another
    -- device, a stale tab) would write a false end onto an open yesterday.
    if exists (select 1 from public.attendance_days d
               where d.member_id = v_caller and d.work_date = v_today and d.started_at is not null) then
      perform app.fail('INVALID_STATE', 'Your day has already ended.');
    end if;
    -- Worked past midnight: the end belongs to yesterday's day, a real time, never made up.
    select d.* into v_day
    from public.attendance_days d
    where d.member_id = v_caller and d.work_date = v_today - 1 and d.started_at is not null and d.ended_at is null
    for update;
  end if;
  if v_day.id is null then
    if exists (select 1 from public.attendance_days d
               where d.member_id = v_caller and d.work_date = v_today and d.ended_at is not null) then
      perform app.fail('INVALID_STATE', 'Your day has already ended.');
    end if;
    perform app.fail('INVALID_STATE', 'Start your day first.');
  end if;

  -- Only the end moves: state, final_status and the Owner's decision are never touched. An end is
  -- recorded now, so the 00:00 job's flag no longer holds (the 2.5 rule for a late logout).
  perform set_config('app.audit_override', jsonb_build_object('action', 'ended')::text, true);
  update public.attendance_days set ended_at = now(), end_not_recorded = false where id = v_day.id;
  perform app.attendance_event(v_day.id, 'ended', null, null, null, v_caller);

  -- The confirmation's optional overtime note (PRODUCT §4.2, 3b.2), on the day that just ended.
  if app.clean_reason(overtime_note) is not null then
    v_note_id := public.extra_work_note_submit('overtime', v_day.work_date, overtime_note, overtime_minutes);
  end if;

  return query select v_day.id, v_day.work_date, v_note_id;
end;
$$;

revoke all on function public.attendance_end_day(text, integer) from public, anon;
grant execute on function public.attendance_end_day(text, integer) to authenticated, service_role;

comment on function public.attendance_end_day(text, integer) is
  'attendance.self. Ends the caller''s started day: today''s, else yesterday''s with a start and no '
  'end (an End day after midnight lands on the previous day, the 2.1 late-logout rule). ended_at = '
  'now() and end_not_recorded = false in one write; final, no resume. INVALID_STATE with no started '
  'day ("Start your day first") or once today has ended. 3b.2: a non-empty overtime_note becomes an '
  'extra_work_note_submit(overtime) for that day in the same transaction. Returns (day_id, '
  'work_date, note_id). Audit action: ended. Notifies nobody.';
