-- 2.3 Leave for employees: what the member may do with their own requests, for every state and
-- every source. `src/modules/leave/domain/requests.ts` leaveRequestActions() mirrors this matrix
-- and its unit test writes the same rules out; this file holds the database side of that
-- contract, so the screen never offers what the functions refuse (and the other way round).
-- leave_withdraw is 2.1's; leave_request_change was re-created in 2.3
-- (20260924124326_leave_change_ended.sql) to refuse approved leave that has ended.
begin;
create extension if not exists pgtap with schema extensions;
select plan(58);

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
  ('owner', '00000000-0000-4000-8000-000000000001'),
  ('staff', '00000000-0000-4000-8000-000000000003'),
  ('other', '00000000-0000-4000-8000-000000000004');
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

-- The error code a statement raises (its effects are rolled back), or 'ok'.
create function pg_temp.code(q text) returns text language plpgsql as $$
declare m text;
begin
  execute q;
  return 'ok';
exception when others then
  get stacked diagnostics m = message_text;
  return m;
end;
$$;

-- "CODE: detail", as the app shows it.
create function pg_temp.code_and_detail(q text) returns text language plpgsql as $$
declare m text; d text;
begin
  execute q;
  return 'ok';
exception when others then
  get stacked diagnostics m = message_text, d = pg_exception_detail;
  return m || ': ' || coalesce(d, '');
end;
$$;

create function pg_temp.mk(
  k text, st public.leave_state, src text, from_offset integer, to_offset integer,
  supersedes uuid default null, cancellation boolean default false)
returns uuid language plpgsql as $$
declare v uuid;
begin
  insert into public.leave_requests (
    member_id, type, start_date, end_date, state, source, supersedes_id, requests_cancellation,
    decided_by, decided_at)
  values (
    pg_temp.fx(k), 'leave', app.today_ist() + from_offset, app.today_ist() + to_offset, st, src,
    supersedes, cancellation,
    case when st in ('approved', 'rejected', 'cancelled') then pg_temp.fx('owner') end,
    case when st in ('approved', 'rejected', 'cancelled') then now() end)
  returning id into v;
  return v;
end;
$$;

insert into auth.users (id, email)
select id, key || '@example.com' from fx where key <> 'org';

insert into public.members (id, org_id, full_name, email, role, status, joined_at) values
  (pg_temp.fx('owner'), pg_temp.fx('org'), 'Test Owner', 'owner@example.com', 'owner', 'active', now() - interval '30 days'),
  (pg_temp.fx('staff'), pg_temp.fx('org'), 'Test Staff', 'staff@example.com', 'staff', 'active', now() - interval '30 days'),
  (pg_temp.fx('other'), pg_temp.fx('org'), 'Other Staff', 'other@example.com', 'staff', 'active', now() - interval '30 days');

-- One request per state × source, per action (a successful call changes its row, so withdraw
-- and change never share one). Dates far apart so no overlap rule is in play.
create temporary table matrix (
  st public.leave_state, src text, act text, id uuid, expected text,
  timing text not null default 'future',
  primary key (st, src, act, timing));
grant select on matrix to authenticated;

insert into matrix (st, src, act, id, expected)
select s.st, src.src, a.act,
       pg_temp.mk('staff', s.st, src.src, 10 + s.n * 10 + src.n * 3, 10 + s.n * 10 + src.n * 3),
       case
         when a.act = 'withdraw' and src.src = 'attendance' then 'INVALID_STATE'
         when a.act = 'withdraw' and s.st <> 'submitted' then 'INVALID_STATE'
         when a.act = 'cancel' and s.st <> 'approved' then 'INVALID_STATE'
         else 'ok'
       end
from (values ('submitted'::public.leave_state, 0), ('approved', 1), ('rejected', 2),
             ('withdrawn', 3), ('superseded', 4), ('cancelled', 5)) as s (st, n)
cross join (values ('form', 0), ('attendance', 1), ('owner', 2)) as src (src, n)
cross join (values ('withdraw'), ('cancel')) as a (act);

-- 2.3: approved leave by timing. Ongoing leave (started, not ended) and leave ending today stay
-- the member's to change; leave that has ended is the Owner's, through the attendance day.
insert into matrix (st, src, act, timing, id, expected)
select 'approved', src.src, 'cancel', t.timing,
       pg_temp.mk('staff', 'approved', src.src, t.from_offset, t.to_offset),
       t.expected
from (values ('form'), ('attendance'), ('owner')) as src (src)
cross join (values ('ended', -5, -1, 'INVALID_STATE'), ('ongoing', -2, 2, 'ok'),
                   ('ends_today', -1, 0, 'ok')) as t (timing, from_offset, to_offset, expected);

select is((select count(*)::integer from matrix), 45,
  'six states × three sources × two actions, and approved leave that ended, is ongoing or ends today');

select pg_temp.as_member('staff');

-- 18: leave_withdraw, submitted form/owner only; never a gate request.
select is(
  split_part(pg_temp.code(format('select public.leave_withdraw(%L)', id)), ':', 1),
  expected,
  format('withdraw %s from %s: %s', st, src, expected))
from matrix where act = 'withdraw' order by st, src;

-- 27: leave_request_change(cancel), approved of any source that has not ended.
select is(
  split_part(pg_temp.code(format('select public.leave_request_change(%L, cancel => true)', id)), ':', 1),
  expected,
  format('ask to cancel %s %s leave from %s: %s', timing, st, src, expected))
from matrix where act = 'cancel' order by st, src, timing;

-- A change of dates to ended leave is refused the same way, and says why.
select is(
  pg_temp.code_and_detail(format(
    $q$ select public.leave_request_change(%L, 'leave', app.today_ist(), app.today_ist() + 1) $q$,
    (select id from matrix where act = 'cancel' and timing = 'ended' and src = 'form'))),
  'INVALID_STATE: This leave has ended. Ask the Owner to correct it.',
  'moving ended leave to new dates is refused too, with the reason');

-- One open change per request, whatever its source: the cancellations just asked for block a
-- second change or cancellation of the same leave.
select is(
  split_part(pg_temp.code(format('select public.leave_request_change(%L, cancel => true)', id)), ':', 1),
  'CONFLICT',
  format('a second request against approved %s leave is CONFLICT', src))
from matrix where act = 'cancel' and st = 'approved' and timing = 'future' order by src;

-- A waiting change or cancellation can itself be withdrawn; then the leave can be changed again.
select is(
  public.leave_withdraw((select r.id from public.leave_requests r
                         where r.supersedes_id = (select id from matrix where act = 'cancel' and st = 'approved' and src = 'attendance' and timing = 'future'))),
  'withdrawn'::public.leave_state,
  'the member withdraws the waiting cancellation of an approved gate leave');
select is(
  (select state from public.leave_requests where id = (select id from matrix where act = 'cancel' and st = 'approved' and src = 'attendance' and timing = 'future')),
  'approved'::public.leave_state,
  'the gate leave itself is still approved');
select isnt(
  public.leave_request_change(
    (select id from matrix where act = 'cancel' and st = 'approved' and src = 'attendance' and timing = 'future'),
    'half_day', app.today_ist() + 200, app.today_ist() + 200, 'Only the morning'),
  null,
  'and a change of dates to it is accepted');
select is(
  (select original.state from public.leave_requests r
   join public.leave_requests original on original.id = r.supersedes_id
   where r.reason = 'Only the morning'),
  'approved'::public.leave_state,
  'the original stays approved until the Owner decides');

-- Someone else's request is not found, whatever its state: RLS and the functions agree.
select pg_temp.as_system();
create temporary table theirs as
  select pg_temp.mk('other', 'submitted', 'form', 400, 400) as submitted,
         pg_temp.mk('other', 'approved', 'form', 410, 410) as approved;
grant select on theirs to authenticated;
select pg_temp.as_member('staff');
select is(split_part(pg_temp.code(format('select public.leave_withdraw(%L)', (select submitted from theirs))), ':', 1),
  'NOT_FOUND', 'another member''s waiting request cannot be withdrawn');
select is(split_part(pg_temp.code(format('select public.leave_request_change(%L, cancel => true)', (select approved from theirs))), ':', 1),
  'NOT_FOUND', 'another member''s approved leave cannot be cancelled');
select is((select count(*)::integer from public.leave_requests where member_id = pg_temp.fx('other')), 0,
  'and the member cannot even read them');

-- The Owner has no leave of their own to withdraw or change (no attendance.self).
select pg_temp.as_member('owner');
select is(split_part(pg_temp.code(format('select public.leave_withdraw(%L)', (select submitted from theirs))), ':', 1),
  'FORBIDDEN', 'the Owner does not withdraw a member''s request');

select * from finish();
rollback;
