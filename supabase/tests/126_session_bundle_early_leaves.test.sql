-- v1.9 W4 Q2 (2026-11-02, migration session_bundle_early_leaves; DATA-MODEL "v1.9 W4 Q2", PERMISSIONS
-- "Screens (2.4)"): session_bundle() also counts the early-leave requests waiting for the Owner
-- (pending_early_leaves: state waiting or left_unanswered), for attendance.decide only (0 for anyone
-- else). Each role (allowed and denied), anon refused, and each state: waiting and left_unanswered
-- count; approved, stay, corrected and lapsed do not; deciding one takes it out. Fixed dates far in
-- the past, so the file never ages. Neutral names only.
begin;
create extension if not exists pgtap with schema extensions;
select plan(19);

create temporary table fx (key text primary key, id uuid not null);
insert into fx values
  ('owner', '10000000-0000-4000-8000-000000000001'),
  ('admin', '10000000-0000-4000-8000-000000000002'),
  ('staff', '10000000-0000-4000-8000-000000000003'),
  ('gone',  '00000000-0000-4000-8000-000000012601');
insert into fx select 'org', id from public.organizations limit 1;
grant select on fx to authenticated, anon;

create function pg_temp.fx(k text) returns uuid language sql stable as $$ select id from fx where key = k; $$;
create function pg_temp.as_member(k text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', pg_temp.fx(k)::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', pg_temp.fx(k), 'role', 'authenticated')::text, true);
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
create function pg_temp.early() returns integer language sql as $$
  select pending_early_leaves from public.session_bundle();
$$;
grant execute on function pg_temp.early() to authenticated;

-- What already waits on this database (the seed, or an earlier file's rows), read as the Owner.
select pg_temp.as_member('owner');
create temporary table fx_base as select pg_temp.early() as n;
select pg_temp.as_system();
grant select on fx_base to authenticated;

-- Fixtures, written as the migration owner ------------------------------------------------------------
insert into auth.users (id, email) values (pg_temp.fx('gone'), 'gone-12601@example.com');
insert into public.members (id, org_id, full_name, email, role, status, joined_at, deactivated_at) values
  (pg_temp.fx('gone'), pg_temp.fx('org'), 'Gone Person', 'gone-12601@example.com', 'staff', 'deactivated',
   now() - interval '400 days', now());

-- Six started days for Crew (2025-03-03..08) and one early-leave request on each, one per state.
create temporary table fx_req (state text primary key, id uuid not null);
grant select on fx_req to authenticated;
with days as (
  insert into public.attendance_days (member_id, work_date, state, submitted_choice, submitted_at, started_at)
  select pg_temp.fx('staff'), date '2025-03-03' + n, 'pending_review', 'present',
         (date '2025-03-03' + n)::timestamp + interval '4 hours', (date '2025-03-03' + n)::timestamp + interval '4 hours'
  from generate_series(0, 5) as n
  returning id, work_date
), states as (
  select * from (values (0, 'waiting'), (1, 'left_unanswered'), (2, 'approved'), (3, 'stay'),
                        (4, 'corrected'), (5, 'lapsed')) as s(n, state)
), made as (
  insert into public.early_leave_requests (org_id, member_id, day_id, requested_at, reason, end_at, state, left_at,
                                           decided_by, decided_at)
  select pg_temp.fx('org'), pg_temp.fx('staff'), d.id, d.work_date::timestamp + interval '10 hours', 'A reason',
         d.work_date::timestamp + interval '12 hours 30 minutes', s.state,
         case when s.state = 'left_unanswered' then d.work_date::timestamp + interval '11 hours' end,
         case when s.state in ('approved', 'stay', 'corrected') then pg_temp.fx('owner') end,
         case when s.state in ('approved', 'stay', 'corrected') then now() end
  from days d join states s on d.work_date = date '2025-03-03' + s.n
  returning id, state
)
insert into fx_req select state, id from made;

-- Who may call it (unchanged) ---------------------------------------------------------------------------
select is((select prosecdef from pg_proc where oid = 'public.session_bundle()'::regprocedure), false,
  'session_bundle() is still security invoker');
select ok(has_function_privilege('authenticated', 'public.session_bundle()', 'execute'),
  'authenticated may execute session_bundle()');
select ok(not has_function_privilege('anon', 'public.session_bundle()', 'execute'),
  'anon may not execute session_bundle()');
select ok(not has_function_privilege('service_role', 'public.session_bundle()', 'execute'),
  'service_role may not execute session_bundle()');
select is((select count(*)::integer from fx_req), 6, 'six fixtures, one per state');

set local role anon;
select set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
select throws_ok($$ select * from public.session_bundle() $$, '42501', null, 'anon is refused');
select pg_temp.as_system();

-- The Owner: waiting and left_unanswered count, the four others do not ---------------------------------
select pg_temp.as_member('owner');
select is(pg_temp.early(), (select n from fx_base) + 2,
  'Owner: the waiting and the left-unanswered requests count; approved, stay, corrected and lapsed do not');
select is(pg_temp.early(),
  (select count(*)::integer from public.early_leave_requests where state in ('waiting', 'left_unanswered')),
  'Owner: the count is the API''s count of the two waiting states');
select is((select pending_days from public.session_bundle()),
  (select count(*)::integer from public.attendance_days where state = 'pending_review'),
  'Owner: the other counts are unchanged (pending days)');
select pg_temp.as_system();

-- An Admin, Crew and a deactivated member: 0 --------------------------------------------------------------
select pg_temp.as_member('admin');
select is(pg_temp.early(), 0, 'Admin: 0 (attendance.decide is the Owner''s)');
select ok((select pending_days is null from public.session_bundle()), 'Admin: the other Owner counts stay null');
select pg_temp.as_system();
select pg_temp.as_member('staff');
select is(pg_temp.early(), 0, 'Crew: 0, even with their own requests waiting');
select is((select count(*)::integer from public.early_leave_requests where state in ('waiting', 'left_unanswered')), 2,
  'Crew: RLS shows them their own two, which the badge never counts');
select pg_temp.as_system();
select pg_temp.as_member('gone');
select is(pg_temp.early(), 0, 'a deactivated member: 0');
select pg_temp.as_system();

-- Each state as the Owner decides: the waiting one approved, the left-unanswered one corrected -----------
update public.early_leave_requests set state = 'approved', decided_by = pg_temp.fx('owner'), decided_at = now()
where id = (select id from fx_req where state = 'waiting');
select pg_temp.as_member('owner');
select is(pg_temp.early(), (select n from fx_base) + 1, 'Owner: an approved request leaves the count');
select pg_temp.as_system();
update public.early_leave_requests set state = 'corrected', decided_by = pg_temp.fx('owner'), decided_at = now()
where id = (select id from fx_req where state = 'left_unanswered');
select pg_temp.as_member('owner');
select is(pg_temp.early(), (select n from fx_base), 'Owner: a corrected (decided) one leaves it too');
select pg_temp.as_system();
update public.early_leave_requests set state = 'waiting', decided_by = null, decided_at = null
where id = (select id from fx_req where state = 'stay');
select pg_temp.as_member('owner');
select is(pg_temp.early(), (select n from fx_base) + 1, 'Owner: a waiting request counts');
select pg_temp.as_system();
update public.early_leave_requests set state = 'lapsed' where id = (select id from fx_req where state = 'stay');
select pg_temp.as_member('owner');
select is(pg_temp.early(), (select n from fx_base), 'Owner: a lapsed one does not');
select pg_temp.as_system();
select pg_temp.as_member('admin');
select is(pg_temp.early(), 0, 'Admin: still 0 after every change');
select pg_temp.as_system();

select * from finish();
rollback;
