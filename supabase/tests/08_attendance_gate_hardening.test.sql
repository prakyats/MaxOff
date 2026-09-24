-- 2.2 Day gate hardening (migration 20260923171029): the per-member touch lock, the joining day,
-- "the day changed" at the gate, and "the later decision wins" over an approved gate leave in
-- both orders, through leave_decide and leave_owner_edit, with the dates the Owner's corrections
-- keep and the CONFLICT that still names a form or owner request. The two-connection proof that
-- the touch lock holds is 09 (dblink).
begin;
create extension if not exists pgtap with schema extensions;
select plan(108);

-- Keep the seeded organization; replace the people with fixtures. Rolled back at the end.
delete from public.attendance_events;
delete from public.attendance_days;
delete from public.leave_requests;
delete from public.session_events;
delete from public.activity_log;
delete from public.members;
delete from auth.identities;
delete from auth.users;
delete from public.activity_log; -- again: the member deletes were audited

create temporary table fx (key text primary key, id uuid not null);
insert into fx values
  ('owner',     '00000000-0000-4000-8000-000000000001'),
  ('admin',     '00000000-0000-4000-8000-000000000002'),
  ('staff',     '00000000-0000-4000-8000-000000000003'),
  ('staff2',    '00000000-0000-4000-8000-000000000004'),
  ('worker',    '00000000-0000-4000-8000-000000000005'),
  ('newbie',    '00000000-0000-4000-8000-000000000006'),
  ('midnight',  '00000000-0000-4000-8000-000000000007'),
  ('lastnight', '00000000-0000-4000-8000-000000000008');
insert into fx select 'org', id from public.organizations limit 1;
grant select on fx to authenticated, anon, service_role;

create function pg_temp.fx(k text) returns uuid language sql stable as $$
  select id from fx where key = k;
$$;

create function pg_temp.as_member(k text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', pg_temp.fx(k)::text, true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', pg_temp.fx(k), 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end;
$$;

create function pg_temp.as_system() returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', '', true);
end;
$$;

create function pg_temp.day(k text, offset_days integer default 0) returns uuid language sql stable as $$
  select d.id from public.attendance_days d
  where d.member_id = pg_temp.fx(k) and d.work_date = app.today_ist() + offset_days;
$$;

create function pg_temp.gate(k text) returns uuid language sql stable as $$
  select r.id from public.leave_requests r where r.member_id = pg_temp.fx(k) and r.source = 'attendance'
  order by r.created_at desc limit 1;
$$;

create function pg_temp.form(k text) returns uuid language sql stable as $$
  select r.id from public.leave_requests r where r.member_id = pg_temp.fx(k) and r.source = 'form'
    and r.state = 'submitted' order by r.created_at desc limit 1;
$$;

-- "CODE: detail" of the error a statement raises (its effects are rolled back), or 'no error'.
create function pg_temp.err(q text) returns text language plpgsql as $$
declare m text; d text;
begin
  execute q;
  return 'no error';
exception when others then
  get stacked diagnostics m = message_text, d = pg_exception_detail;
  return m || ': ' || coalesce(d, '');
end;
$$;

create function pg_temp.mk_leave(
  k text, t public.leave_type, from_offset integer, to_offset integer, st public.leave_state,
  src text default 'form')
returns uuid language plpgsql as $$
declare v uuid;
begin
  insert into public.leave_requests (member_id, type, start_date, end_date, state, source, decided_by, decided_at)
  values (
    pg_temp.fx(k), t, app.today_ist() + from_offset, app.today_ist() + to_offset, st, src,
    case when st in ('approved', 'rejected', 'cancelled') then pg_temp.fx('owner') end,
    case when st in ('approved', 'rejected', 'cancelled') then now() end)
  returning id into v;
  return v;
end;
$$;

create function pg_temp.reset_attendance() returns void language sql as $$
  delete from public.attendance_events;
  delete from public.attendance_days;
  delete from public.leave_requests;
  delete from public.session_events;
  delete from public.activity_log where entity in ('attendance_days', 'leave_requests');
$$;

-- A gate choice made by the member and approved by the Owner, as the real functions do it.
create function pg_temp.gate_approved(k text, ch public.attendance_choice) returns void language plpgsql as $$
begin
  perform pg_temp.as_member(k);
  perform public.attendance_touch();
  perform public.attendance_submit(ch, 'At the gate');
  perform pg_temp.as_member('owner');
  perform public.attendance_decide(pg_temp.day(k), 'approve');
  perform pg_temp.as_system();
end;
$$;

create function pg_temp.label(t text, from_offset integer default 0) returns text language sql stable as $$
  select t || ', ' || to_char(app.today_ist() + from_offset, 'FMDD Mon YYYY');
$$;

insert into auth.users (id, email)
select id, key || '@example.com' from fx where key <> 'org';

insert into public.members (id, org_id, full_name, email, role, status, joined_at) values
  (pg_temp.fx('owner'),     pg_temp.fx('org'), 'Test Owner',  'owner@example.com',     'owner', 'active', now() - interval '30 days'),
  (pg_temp.fx('admin'),     pg_temp.fx('org'), 'Test Admin',  'admin@example.com',     'admin', 'active', now() - interval '30 days'),
  (pg_temp.fx('staff'),     pg_temp.fx('org'), 'Test Staff',  'staff@example.com',     'staff', 'active', now() - interval '30 days'),
  (pg_temp.fx('staff2'),    pg_temp.fx('org'), 'Other Staff', 'staff2@example.com',    'staff', 'active', now() - interval '30 days'),
  (pg_temp.fx('worker'),    pg_temp.fx('org'), 'Third Staff', 'worker@example.com',    'staff', 'active', now() - interval '30 days'),
  -- Joined this instant, at the first minute of today (IST), and at the last minute of yesterday.
  (pg_temp.fx('newbie'),    pg_temp.fx('org'), 'New Staff',   'newbie@example.com',    'staff', 'active', now()),
  (pg_temp.fx('midnight'),  pg_temp.fx('org'), 'Midnight',    'midnight@example.com',  'staff', 'active', app.ist_day_start(app.today_ist())),
  (pg_temp.fx('lastnight'), pg_temp.fx('org'), 'Last Night',  'lastnight@example.com', 'admin', 'active', app.ist_day_start(app.today_ist()) - interval '1 minute');
delete from public.activity_log; -- the fixture writes are not under test

-- Structure and grants ---------------------------------------------------------------------------
select has_function('public', 'attendance_submit', array['attendance_choice', 'text', 'date'], 'attendance_submit takes for_date');
select hasnt_function('public', 'attendance_submit', array['attendance_choice', 'text'], 'the two-argument attendance_submit is gone');
select is(pg_get_function_result('public.leave_decide(uuid, text, text)'::regprocedure),
  'TABLE(state leave_state, kept_dates date[])', 'leave_decide returns the state and the kept dates');
select is(pg_get_function_result('app.attendance_apply_leave(public.leave_requests)'::regprocedure),
  'date[]', 'apply_leave returns the dates it kept');
select ok(
  has_function_privilege('authenticated', 'public.attendance_submit(public.attendance_choice, text, date)', 'execute')
  and has_function_privilege('authenticated', 'public.leave_decide(uuid, text, text)', 'execute')
  and has_function_privilege('authenticated', 'public.attendance_touch(text, text)', 'execute')
  and has_function_privilege('authenticated', 'public.leave_owner_edit(uuid, public.leave_type, date, date, text)', 'execute'),
  'authenticated may execute the re-created functions');
select ok(
  not has_function_privilege('anon', 'public.attendance_submit(public.attendance_choice, text, date)', 'execute')
  and not has_function_privilege('anon', 'public.leave_decide(uuid, text, text)', 'execute')
  and not has_function_privilege('anon', 'public.attendance_touch(text, text)', 'execute')
  and not has_function_privilege('anon', 'public.leave_owner_edit(uuid, public.leave_type, date, date, text)', 'execute'),
  'anon may execute none of them');
select ok(
  not has_function_privilege('authenticated', 'app.leave_supersede_gate(uuid, date, date, uuid, uuid)', 'execute')
  and not has_function_privilege('authenticated', 'app.leave_clash(uuid, date, date, uuid, boolean)', 'execute')
  and not has_function_privilege('authenticated', 'app.leave_clash_label(public.leave_requests)', 'execute')
  and not has_function_privilege('authenticated', 'app.attendance_apply_leave(public.leave_requests)', 'execute'),
  'the new helpers are closed to the API role');

-- attendance_touch: the per-member lock ----------------------------------------------------------
select pg_temp.as_member('staff');
select is((select gate_required from public.attendance_touch()), true, 'a staff member is asked');
select ok(exists (
    select 1 from pg_locks l
    where l.locktype = 'advisory' and l.pid = pg_backend_pid() and l.granted
      and l.objid::bigint = (hashtext('touch:' || pg_temp.fx('staff')::text)::bigint & 4294967295)),
  'the touch holds the member''s touch lock until the transaction ends');
select is((select gate_required from public.attendance_touch()), true, 'a second touch in the same transaction still works (the lock is re-entrant)');
select pg_temp.as_system();
select is((select count(*) from public.session_events where member_id = pg_temp.fx('staff') and kind = 'login'), 1::bigint,
  'two touches: one login row');
select is((select count(*) from public.attendance_days where member_id = pg_temp.fx('staff')), 1::bigint, 'and one day');

-- The joining day ---------------------------------------------------------------------------------
select pg_temp.as_member('newbie');
select results_eq(
  $$ select day_id is null, gate_required, state is null from public.attendance_touch() $$,
  $$ values (true, false, true) $$,
  'on the joining day the gate does not ask and no day opens');
select results_eq(
  $$ select split_part(pg_temp.err($q$ select public.attendance_submit('present') $q$), ':', 1) $$,
  $$ values ('NOT_FOUND') $$,
  'and there is nothing to submit');
select pg_temp.as_member('midnight');
select is((select gate_required from public.attendance_touch()), false, 'joined at 00:00 IST today: still the joining day');
select pg_temp.as_member('lastnight');
select is((select gate_required from public.attendance_touch()), true, 'joined at 23:59 IST yesterday: asked today');
select pg_temp.as_system();
select is((select count(*) from public.attendance_days where member_id in (pg_temp.fx('newbie'), pg_temp.fx('midnight'))), 0::bigint,
  'no day for anyone on their joining day');
select is((select count(*) from public.session_events where member_id in (pg_temp.fx('newbie'), pg_temp.fx('midnight')) and kind = 'login'), 2::bigint,
  'but their logins are recorded');

-- The day changed ---------------------------------------------------------------------------------
select pg_temp.as_member('staff');
select is(pg_temp.err($$ select public.attendance_submit('present', null, app.today_ist() - 1) $$),
  'INVALID_STATE: The day changed. Choose again for today.', 'a gate shown yesterday is refused, with the message');
select is(pg_temp.err($$ select public.attendance_submit('leave', 'x', app.today_ist() + 1) $$),
  'INVALID_STATE: The day changed. Choose again for today.', 'any other date is refused too');
select pg_temp.as_system();
select results_eq(
  $$ select state::text, submitted_choice is null from public.attendance_days where id = pg_temp.day('staff') $$,
  $$ values ('awaiting_choice', true) $$, 'the day is untouched');
select is((select count(*) from public.attendance_events where attendance_day_id = pg_temp.day('staff')), 0::bigint, 'and has no history');
select is((select count(*) from public.leave_requests where member_id = pg_temp.fx('staff')), 0::bigint, 'and no leave request was made');
select pg_temp.as_member('staff');
select is(public.attendance_submit('present', null, app.today_ist()), 'pending_review', 'today''s date is accepted');
select pg_temp.as_member('lastnight');
select is(public.attendance_submit('present'), 'pending_review', 'no date at all is accepted (older callers)');
select pg_temp.as_system();

-- Gate approved first: half day at the gate, full-day form approved later ----------------------------
select pg_temp.reset_attendance();
select pg_temp.as_member('staff');
select isnt(public.leave_submit('leave', app.today_ist(), app.today_ist(), 'Form first'), null, 'a full-day form request is waiting');
select pg_temp.gate_approved('staff', 'half_day');
select results_eq(
  $$ select r.state::text, d.state::text, d.final_status::text
     from public.leave_requests r join public.attendance_days d on d.leave_request_id = r.id
     where r.id = pg_temp.gate('staff') $$,
  $$ values ('approved', 'approved', 'half_day') $$,
  'the gate''s half day is approved with the day');
select pg_temp.as_member('owner');
select results_eq(
  $$ select state::text, kept_dates from public.leave_decide(pg_temp.form('staff'), 'approve') $$,
  $$ values ('approved', '{}'::date[]) $$,
  'the Owner approves the form request later: no CONFLICT, nothing kept');
select pg_temp.as_system();
select is((select state::text from public.leave_requests where id = pg_temp.gate('staff')), 'superseded', 'the approved gate leave is superseded');
select is(
  (select meta from public.activity_log where entity = 'leave_requests' and entity_id = pg_temp.gate('staff') order by id desc limit 1),
  jsonb_build_object('by', (select id from public.leave_requests where member_id = pg_temp.fx('staff') and source = 'form'), 'system', true),
  'audited as superseded by the system, naming the later request');
select results_eq(
  $$ select d.state::text, d.final_status::text, d.decided_by is null, d.proposed_by_system, d.decision_reason,
            d.leave_request_id = (select id from public.leave_requests where member_id = pg_temp.fx('staff') and source = 'form')
     from public.attendance_days d where d.id = pg_temp.day('staff') $$,
  $$ values ('corrected', 'leave', true, true, 'leave approved', true) $$,
  'the day becomes full leave, a system correction linked to the form request: the later decision wins');
select results_eq(
  $$ select action, from_status::text, to_status::text, reason, actor_id is null from public.attendance_events
     where attendance_day_id = pg_temp.day('staff') order by id desc limit 1 $$,
  $$ values ('corrected', 'half_day', 'leave', 'leave approved', true) $$,
  'the history says half day → leave, by the system');
select results_eq(
  $$ select action, meta ->> 'system', meta ->> 'superseded_request_id' = pg_temp.gate('staff')::text
     from public.activity_log where entity = 'attendance_days' and entity_id = pg_temp.day('staff') order by id desc limit 1 $$,
  $$ values ('corrected', 'true', true) $$,
  'the day''s audit row names the superseded gate request');

-- Gate approved first: the same type still corrects -------------------------------------------------
select pg_temp.reset_attendance();
select pg_temp.as_member('staff');
select isnt(public.leave_submit('leave', app.today_ist(), app.today_ist() + 1, 'Two days'), null, 'a two-day form request is waiting');
select pg_temp.gate_approved('staff', 'leave');
select pg_temp.as_member('owner');
select is((select state::text from public.leave_decide(pg_temp.form('staff'), 'approve')), 'approved', 'approved over a full-day gate leave');
select pg_temp.as_system();
select results_eq(
  $$ select state::text, final_status::text,
            leave_request_id = (select id from public.leave_requests where member_id = pg_temp.fx('staff') and source = 'form')
     from public.attendance_days where id = pg_temp.day('staff') $$,
  $$ values ('corrected', 'leave', true) $$,
  'same type: the day is still corrected and relinked, so the history shows the later decision won');
select results_eq(
  $$ select from_status::text, to_status::text from public.attendance_events
     where attendance_day_id = pg_temp.day('staff') order by id desc limit 1 $$,
  $$ values ('leave', 'leave') $$, 'with its own history row');
select is((select count(*) from public.attendance_days where member_id = pg_temp.fx('staff')), 1::bigint,
  'tomorrow gets no day ahead of time: it is derived when it comes');

-- Gate approved first: full day at the gate, half-day form later --------------------------------------
select pg_temp.reset_attendance();
select pg_temp.as_member('staff2');
select isnt(public.leave_submit('half_day', app.today_ist(), app.today_ist()), null, 'a half-day form request is waiting');
select pg_temp.gate_approved('staff2', 'leave');
select pg_temp.as_member('owner');
select is((select state::text from public.leave_decide(pg_temp.form('staff2'), 'approve')), 'approved', 'the half day is approved later');
select pg_temp.as_system();
select results_eq(
  $$ select state::text, final_status::text from public.attendance_days where id = pg_temp.day('staff2') $$,
  $$ values ('corrected', 'half_day') $$, 'the later decision wins: the day becomes a half day');

-- A gate day the Owner corrected to the gate's own type still follows the later leave -----------------
select pg_temp.reset_attendance();
select pg_temp.as_member('staff');
select isnt(public.leave_submit('leave', app.today_ist(), app.today_ist()), null, 'a form request is waiting');
select public.attendance_touch();
select is(public.attendance_submit('half_day'), 'pending_review', 'a half day is chosen at the gate');
select pg_temp.as_member('owner');
select is(public.attendance_decide(pg_temp.day('staff'), 'correct', 'half_day', 'Confirmed by phone'), 'corrected',
  'the Owner corrects the day to half day (the gate request is approved with it)');
select is((select state::text from public.leave_requests where id = pg_temp.gate('staff')), 'approved', 'the gate request is approved');
select results_eq(
  $$ select state::text, kept_dates from public.leave_decide(pg_temp.form('staff'), 'approve') $$,
  $$ values ('approved', '{}'::date[]) $$,
  'the form request is approved: a gate day is never "kept"');
select pg_temp.as_system();
select results_eq(
  $$ select r.state::text, d.state::text, d.final_status::text, d.decided_by is null
     from public.attendance_days d, public.leave_requests r
     where d.id = pg_temp.day('staff') and r.id = pg_temp.gate('staff') $$,
  $$ values ('superseded', 'corrected', 'leave', true) $$,
  'the gate request is superseded and the day follows the form leave');

-- A change request approved over a gate leave -----------------------------------------------------------
select pg_temp.reset_attendance();
select pg_temp.mk_leave('staff', 'leave', 1, 1, 'approved');
select pg_temp.as_member('staff');
select isnt(public.leave_request_change(
    (select id from public.leave_requests where member_id = pg_temp.fx('staff') and state = 'approved'),
    'leave', app.today_ist(), app.today_ist() + 1, 'Start a day earlier'), null,
  'a change to start today is waiting');
select pg_temp.gate_approved('staff', 'half_day');
select pg_temp.as_member('owner');
select is((select state::text from public.leave_decide(
    (select id from public.leave_requests where member_id = pg_temp.fx('staff') and supersedes_id is not null), 'approve')),
  'approved', 'the change is approved');
select pg_temp.as_system();
select results_eq(
  $$ select source, state::text, supersedes_id is not null from public.leave_requests
     where member_id = pg_temp.fx('staff') order by source, supersedes_id nulls first $$,
  $$ values ('attendance', 'superseded', false), ('form', 'superseded', false), ('form', 'approved', true) $$,
  'the original and the gate leave are both superseded');
select results_eq(
  $$ select state::text, final_status::text,
            leave_request_id = (select id from public.leave_requests where member_id = pg_temp.fx('staff') and supersedes_id is not null)
     from public.attendance_days where id = pg_temp.day('staff') $$,
  $$ values ('corrected', 'leave', true) $$, 'and the day follows the change');

-- Only that member's gate leave -----------------------------------------------------------------------
select pg_temp.reset_attendance();
select pg_temp.gate_approved('worker', 'leave');
select pg_temp.as_member('staff2');
select isnt(public.leave_submit('leave', app.today_ist(), app.today_ist()), null, 'someone else asks for today');
select pg_temp.as_member('owner');
select is((select state::text from public.leave_decide(pg_temp.form('staff2'), 'approve')), 'approved', 'approved');
select pg_temp.as_system();
select results_eq(
  $$ select r.state::text, d.state::text, d.final_status::text from public.leave_requests r
     join public.attendance_days d on d.leave_request_id = r.id where r.id = pg_temp.gate('worker') $$,
  $$ values ('approved', 'approved', 'leave') $$,
  'another member''s gate leave and day are untouched');

-- Form approved first: the gate request can never be approved afterwards ---------------------------------
select pg_temp.reset_attendance();
select pg_temp.as_member('staff');
select isnt(public.leave_submit('half_day', app.today_ist(), app.today_ist()), null, 'a half-day form request is waiting');
select public.attendance_touch();
select is(public.attendance_submit('leave', 'Whole day'), 'pending_review', 'a full day is chosen at the gate');
select pg_temp.as_member('owner');
select results_eq(
  $$ select state::text, kept_dates from public.leave_decide(pg_temp.form('staff'), 'approve') $$,
  $$ values ('approved', '{}'::date[]) $$, 'the Owner approves the form request first');
select pg_temp.as_system();
select results_eq(
  $$ select r.state::text, d.state::text, d.final_status::text from public.attendance_days d, public.leave_requests r
     where d.id = pg_temp.day('staff') and r.id = pg_temp.gate('staff') $$,
  $$ values ('superseded', 'corrected', 'half_day') $$,
  'the still-submitted gate request is superseded and the day is a half day');
select pg_temp.as_member('owner');
select is(pg_temp.err($$ select public.attendance_decide(pg_temp.day('staff'), 'approve') $$),
  'INVALID_STATE: Only a day awaiting review can be approved.', 'approving the gate day afterwards is refused');
select pg_temp.as_system();
select is((select state::text from public.leave_requests where id = pg_temp.gate('staff')), 'superseded', 'the gate request stays superseded');

-- A day the Owner decided stays, and its date comes back --------------------------------------------------
select pg_temp.reset_attendance();
select pg_temp.as_member('staff');
select isnt(public.leave_submit('leave', app.today_ist(), app.today_ist() + 1, 'Two days'), null, 'a two-day request is waiting');
select public.attendance_touch();
select is(public.attendance_submit('half_day'), 'pending_review', 'a half day is chosen at the gate');
select pg_temp.as_member('owner');
select is(public.attendance_decide(pg_temp.day('staff'), 'correct', 'present', 'Was in the studio all day'), 'corrected',
  'the Owner corrects the day to present (the gate request is rejected)');
select results_eq(
  $$ select state::text, kept_dates from public.leave_decide(pg_temp.form('staff'), 'approve') $$,
  $$ values ('approved', array[app.today_ist()]) $$,
  'the leave is approved and today comes back as kept');
select pg_temp.as_system();
select results_eq(
  $$ select state::text, final_status::text, decided_by = pg_temp.fx('owner'), decision_reason, leave_request_id is null
     from public.attendance_days where id = pg_temp.day('staff') $$,
  $$ values ('corrected', 'present', true, 'Was in the studio all day', true) $$,
  'the day stays exactly as the Owner decided it');
select results_eq(
  $$ select action from public.attendance_events where attendance_day_id = pg_temp.day('staff') order by id desc limit 1 $$,
  $$ values ('corrected') $$, 'and gets no new history row (the last one is still the Owner''s)');
select is((select state::text from public.leave_requests where id = pg_temp.gate('staff')), 'rejected',
  'a rejected gate request is never touched');

-- The Owner's half day made a source = owner request: that one is still a CONFLICT, named ---------------
select pg_temp.reset_attendance();
select pg_temp.as_member('staff2');
select isnt(public.leave_submit('leave', app.today_ist(), app.today_ist()), null, 'a form request is waiting');
select public.attendance_touch();
select is(public.attendance_submit('present'), 'pending_review', 'Present is chosen at the gate');
select pg_temp.as_member('owner');
select is(public.attendance_decide(pg_temp.day('staff2'), 'correct', 'half_day', 'Left at noon'), 'corrected',
  'the Owner corrects the day to half day (an approved owner request is born)');
select is(pg_temp.err(format($$ select public.leave_decide(%L, 'approve') $$, pg_temp.form('staff2'))),
  'CONFLICT: Approved leave (' || pg_temp.label('Half day') || ') already covers these dates. Cancel or edit it first.',
  'approving over an owner request is CONFLICT, naming its type and date');

-- Form vs form is still a CONFLICT, named ----------------------------------------------------------------
select pg_temp.as_system();
select pg_temp.reset_attendance();
select pg_temp.mk_leave('worker', 'leave', 0, 2, 'approved');
select pg_temp.mk_leave('worker', 'comp_leave', 1, 1, 'submitted');
select pg_temp.as_member('owner');
select is(pg_temp.err(format($$ select public.leave_decide(%L, 'approve') $$, pg_temp.form('worker'))),
  'CONFLICT: Approved leave (' || pg_temp.label('Leave') || ' to ' || to_char(app.today_ist() + 2, 'FMDD Mon YYYY')
    || ') already covers these dates. Cancel or edit it first.',
  'form vs form: CONFLICT naming the range');
select pg_temp.as_system();
select is((select count(*) from public.leave_requests where member_id = pg_temp.fx('worker') and state = 'approved'), 1::bigint,
  'and nothing changed');

-- Roles: only the Owner decides -------------------------------------------------------------------------
select pg_temp.as_member('admin');
select throws_ok(format($$ select public.leave_decide(%L, 'approve') $$, pg_temp.form('worker')), 'P0001', 'FORBIDDEN', 'an Admin cannot decide leave');
select pg_temp.as_member('worker');
select throws_ok(format($$ select public.leave_decide(%L, 'approve') $$, pg_temp.form('worker')), 'P0001', 'FORBIDDEN', 'Staff cannot decide their own leave');
select throws_ok($$ select public.leave_owner_edit(pg_temp.fx('owner'), 'leave', app.today_ist(), app.today_ist()) $$,
  'P0001', 'FORBIDDEN', 'Staff cannot edit leave');
select pg_temp.as_system();
set local role anon;
select throws_ok($$ select public.attendance_submit('present', null, app.today_ist()) $$, '42501', null, 'anon cannot submit');
select pg_temp.as_system();

-- leave_owner_edit supersedes an approved gate leave too -----------------------------------------------
select pg_temp.reset_attendance();
select pg_temp.mk_leave('staff', 'leave', 1, 1, 'approved');
select pg_temp.gate_approved('staff', 'half_day');
select pg_temp.as_member('owner');
select isnt(public.leave_owner_edit(
    (select id from public.leave_requests where member_id = pg_temp.fx('staff') and source = 'form'),
    'leave', app.today_ist(), app.today_ist() + 1, 'Two full days'), null,
  'the Owner extends tomorrow''s leave over today''s approved gate half day: no CONFLICT');
select pg_temp.as_system();
select results_eq(
  $$ select source, state::text from public.leave_requests where member_id = pg_temp.fx('staff') order by source $$,
  $$ values ('attendance', 'superseded'), ('form', 'superseded'), ('owner', 'approved') $$,
  'the gate leave and the original are superseded; the Owner''s request is approved');
select is(
  (select meta from public.activity_log where entity = 'leave_requests' and entity_id = pg_temp.gate('staff') order by id desc limit 1),
  jsonb_build_object('by', (select id from public.leave_requests where member_id = pg_temp.fx('staff') and source = 'owner'), 'system', true),
  'the supersede names the Owner''s new request (same helper as leave_decide)');
select results_eq(
  $$ select state::text, final_status::text, decided_by is null,
            leave_request_id = (select id from public.leave_requests where member_id = pg_temp.fx('staff') and source = 'owner')
     from public.attendance_days where id = pg_temp.day('staff') $$,
  $$ values ('corrected', 'leave', true, true) $$, 'and the day follows the edit');

-- leave_owner_edit: a gate request still waiting is a named CONFLICT --------------------------------------
select pg_temp.reset_attendance();
select pg_temp.mk_leave('staff2', 'leave', 1, 1, 'approved');
select pg_temp.as_member('staff2');
select public.attendance_touch();
select is(public.attendance_submit('half_day'), 'pending_review', 'a half day waits at the gate');
select pg_temp.as_member('owner');
select is(pg_temp.err(format($$ select public.leave_owner_edit(%L, 'leave', app.today_ist(), app.today_ist() + 1) $$,
    (select id from public.leave_requests where member_id = pg_temp.fx('staff2') and source = 'form'))),
  'CONFLICT: This person has another open request on these dates (' || pg_temp.label('Half day') || ', waiting). Decide it first.',
  'an Owner edit over a waiting gate request is CONFLICT, naming it');
select pg_temp.as_system();
select is((select state::text from public.leave_requests where id = pg_temp.gate('staff2')), 'submitted', 'the waiting gate request is untouched');

-- leave_owner_edit: an approved form request on the new dates is a named CONFLICT -------------------------
select pg_temp.reset_attendance();
select pg_temp.mk_leave('worker', 'leave', 1, 1, 'approved');
select pg_temp.mk_leave('worker', 'comp_leave', 3, 3, 'approved');
select pg_temp.as_member('owner');
select is(pg_temp.err(format($$ select public.leave_owner_edit(%L, 'leave', app.today_ist() + 1, app.today_ist() + 3) $$,
    (select id from public.leave_requests where member_id = pg_temp.fx('worker') and type = 'leave'))),
  'CONFLICT: This person has another open request on these dates (' || pg_temp.label('Comp leave', 3) || ', approved). Decide it first.',
  'an Owner edit over another approved form request is CONFLICT, naming it');
select pg_temp.as_system();

-- A day the Owner DECIDED stays: an approved Present is kept and reported ------------------------
select pg_temp.reset_attendance();
select pg_temp.as_member('staff');
select public.attendance_touch();
select is(public.attendance_submit('present'), 'pending_review', 'Present is chosen at the gate');
select isnt(public.leave_submit('leave', app.today_ist(), app.today_ist() + 1, 'Two days off'), null,
  'a two-day request starting today is waiting');
select pg_temp.as_member('owner');
select is(public.attendance_decide(pg_temp.day('staff'), 'approve'), 'approved', 'the Owner approves the Present');
select results_eq(
  $$ select state::text, kept_dates from public.leave_decide(pg_temp.form('staff'), 'approve') $$,
  $$ values ('approved', array[app.today_ist()]) $$,
  'the leave is approved later and today comes back as kept');
select pg_temp.as_system();
select results_eq(
  $$ select state::text, final_status::text, decided_by = pg_temp.fx('owner'), leave_request_id is null
     from public.attendance_days where id = pg_temp.day('staff') $$,
  $$ values ('approved', 'present', true, true) $$,
  'the approved Present stays exactly as the Owner decided it');
select results_eq(
  $$ select action from public.attendance_events where attendance_day_id = pg_temp.day('staff') order by id desc limit 1 $$,
  $$ values ('approved') $$, 'and gets no new history row');

-- ...while a Present still waiting becomes the leave -------------------------------------------------
select pg_temp.reset_attendance();
select pg_temp.as_member('staff2');
select public.attendance_touch();
select is(public.attendance_submit('present'), 'pending_review', 'Present is chosen at the gate and waits');
select isnt(public.leave_submit('leave', app.today_ist(), app.today_ist()), null, 'a leave request for today is waiting');
select pg_temp.as_member('owner');
select results_eq(
  $$ select state::text, kept_dates from public.leave_decide(pg_temp.form('staff2'), 'approve') $$,
  $$ values ('approved', '{}'::date[]) $$,
  'the leave is approved: nothing kept');
select pg_temp.as_system();
select results_eq(
  $$ select state::text, final_status::text, decided_by is null, decision_reason from public.attendance_days where id = pg_temp.day('staff2') $$,
  $$ values ('corrected', 'leave', true, 'leave approved') $$,
  'the waiting Present is corrected to leave by the system: the leave wins');

-- Overtime needs a reason, in the database too ---------------------------------------------------------
select pg_temp.as_member('worker');
select public.attendance_touch();
select is(pg_temp.err($$ select public.attendance_flag_overtime(pg_temp.day('worker')) $$),
  'VALIDATION: Say what kept you: overtime needs a reason.', 'no reason is refused');
select is(pg_temp.err($$ select public.attendance_flag_overtime(pg_temp.day('worker'), '') $$),
  'VALIDATION: Say what kept you: overtime needs a reason.', 'an empty reason is refused');
select is(pg_temp.err($$ select public.attendance_flag_overtime(pg_temp.day('worker'), '   ') $$),
  'VALIDATION: Say what kept you: overtime needs a reason.', 'a blank reason is refused');
select pg_temp.as_system();
select results_eq(
  $$ select overtime_flag, overtime_reason is null from public.attendance_days where id = pg_temp.day('worker') $$,
  $$ values (false, true) $$, 'and nothing was flagged');
select is((select count(*) from public.attendance_events where attendance_day_id = pg_temp.day('worker') and action = 'overtime_flagged'),
  0::bigint, 'nor written to the history');
select pg_temp.as_member('worker');
select is(public.attendance_flag_overtime(pg_temp.day('worker'), 'The shoot ran late'), true, 'with a reason it is flagged');
select pg_temp.as_system();

-- The Owner edits the gate leave itself: superseded once, labelled as the Owner's edit ----------------
select pg_temp.reset_attendance();
select pg_temp.gate_approved('staff', 'half_day');
select pg_temp.as_member('owner');
select isnt(public.leave_owner_edit(pg_temp.gate('staff'), 'leave', app.today_ist(), app.today_ist(), 'Whole day after all'), null,
  'the Owner edits the approved gate half day to a full day');
select pg_temp.as_system();
select results_eq(
  $$ select action, meta ->> 'by_owner', meta ->> 'system' from public.activity_log
     where entity = 'leave_requests' and entity_id = pg_temp.gate('staff') and action = 'superseded' $$,
  $$ values ('superseded', 'true', null::text) $$,
  'one superseded audit row, the Owner''s, not a second one by the system');
select results_eq(
  $$ select state::text, final_status::text from public.attendance_days where id = pg_temp.day('staff') $$,
  $$ values ('corrected', 'leave') $$, 'and the day follows the edit');

-- A gate-leave day the Owner corrected to Present stays Present ----------------------------------------
select pg_temp.reset_attendance();
select pg_temp.as_member('staff2');
select isnt(public.leave_submit('leave', app.today_ist(), app.today_ist()), null, 'a form request is waiting');
select pg_temp.gate_approved('staff2', 'leave');
select pg_temp.as_member('owner');
select is(public.attendance_decide(pg_temp.day('staff2'), 'correct', 'present', 'Came in after all'), 'corrected',
  'the Owner corrects the approved gate-leave day to Present');
select results_eq(
  $$ select state::text, kept_dates from public.leave_decide(pg_temp.form('staff2'), 'approve') $$,
  $$ values ('approved', array[app.today_ist()]) $$,
  'the form leave is approved later: today comes back as kept');
select pg_temp.as_system();
select results_eq(
  $$ select d.state::text, d.final_status::text, d.decision_reason, r.state::text
     from public.attendance_days d, public.leave_requests r
     where d.id = pg_temp.day('staff2') and r.id = pg_temp.gate('staff2') $$,
  $$ values ('corrected', 'present', 'Came in after all', 'superseded') $$,
  'the gate leave is superseded, but the Owner''s Present stays');

select * from finish();
rollback;
