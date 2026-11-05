-- v2.0 X3 step 3, /my-day (2026-11-05, migration x3_my_day_folds; DATA-MODEL §1 "v2.0 X3"):
-- session_early() gains freelancers (the members the caller coordinates now: the
-- coordinated_freelancers read, to_at null) and own_week() gains leave (the caller's own approved
-- leave touching the window: listApprovedLeaveBetween). Each equal to the API read it replaces, as
-- each role; own data only; the earlier keys unchanged (130–133). Neutral names only.
begin;
create extension if not exists pgtap with schema extensions;
select plan(11);

create temporary table fx (key text primary key, id uuid not null);
insert into fx values
  ('owner',      '10000000-0000-4000-8000-000000000001'),
  ('admin',      '10000000-0000-4000-8000-000000000002'),
  ('staff',      '10000000-0000-4000-8000-000000000003'),
  ('freelancer', '00000000-0000-4000-8000-000000013401');
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
-- The two API reads they replace, as the caller.
create function pg_temp.api_freelancers() returns jsonb language sql stable as $$
  select coalesce(jsonb_agg(f.member_id order by f.member_id), '[]'::jsonb)
  from public.coordinated_freelancers f where f.to_at is null and f.member_id is not null;
$$;
create function pg_temp.api_leave(from_date date, to_date date) returns jsonb language sql stable as $$
  select coalesce(jsonb_agg(jsonb_build_object('type', l.type, 'start_date', l.start_date, 'end_date', l.end_date)
                            order by l.start_date, l.id), '[]'::jsonb)
  from public.leave_requests l
  where l.member_id = auth.uid() and l.state = 'approved' and l.start_date <= to_date and l.end_date >= from_date;
$$;

-- Fixtures: the Admin coordinates a freelancer; Crew has approved leave inside the window and
-- outside it; the Admin has approved leave inside it.
insert into public.members (id, org_id, full_name, email, role, status, engagement, joined_at) values
  (pg_temp.fx('freelancer'), pg_temp.fx('org'), 'Free Person', null, 'staff', 'active', 'freelance', now() - interval '30 days');
insert into public.member_coordinators (member_id, coordinator_id, from_at)
values (pg_temp.fx('freelancer'), pg_temp.fx('admin'), now() - interval '1 day');
insert into public.leave_requests (member_id, type, start_date, end_date, state, source, decided_at) values
  (pg_temp.fx('staff'), 'leave', app.today_ist() + 2, app.today_ist() + 3, 'approved', 'form', now()),
  (pg_temp.fx('staff'), 'leave', app.today_ist() + 40, app.today_ist() + 40, 'approved', 'form', now()),
  (pg_temp.fx('admin'), 'leave', app.today_ist() + 4, app.today_ist() + 4, 'approved', 'form', now());

-- 1. freelancers in session_early -----------------------------------------------------------------
select pg_temp.as_member('admin');
select is(public.session_early()->'freelancers', pg_temp.api_freelancers(), 'Admin: freelancers equal the API read');
select is(public.session_early()->'freelancers', jsonb_build_array(pg_temp.fx('freelancer')), 'Admin: the one they coordinate');
select pg_temp.as_member('staff');
select is(public.session_early()->'freelancers', '[]'::jsonb, 'Crew: none (they coordinate nobody)');
select pg_temp.as_member('owner');
select is(public.session_early()->'freelancers', pg_temp.api_freelancers(), 'Owner: equal the API read');
select ok(public.session_early() ?& array['member', 'own_day', 'own_day_refused', 'push', 'own_hours'],
  'the earlier keys stay');

-- 2. leave in own_week -----------------------------------------------------------------------------
select pg_temp.as_member('staff');
select is(public.own_week(app.today_ist(), app.today_ist() + 6)->'leave', pg_temp.api_leave(app.today_ist(), app.today_ist() + 6),
  'Crew: leave equals the API read');
select is(jsonb_array_length(public.own_week(app.today_ist(), app.today_ist() + 6)->'leave'), 1,
  'Crew: the leave in the window only');
select pg_temp.as_member('admin');
select is(public.own_week(app.today_ist(), app.today_ist() + 6)->'leave', pg_temp.api_leave(app.today_ist(), app.today_ist() + 6),
  'Admin: leave equals the API read');
select ok(not ((public.own_week(app.today_ist(), app.today_ist() + 6)->'leave') @> jsonb_build_array(
  jsonb_build_object('start_date', app.today_ist() + 2))), 'own data only: never Crew''s leave');
select pg_temp.as_member('owner');
select is(public.own_week(app.today_ist(), app.today_ist() + 6)->'leave', '[]'::jsonb, 'Owner: no leave of his own');
select ok(public.own_week(app.today_ist(), app.today_ist()) ?& array['holidays', 'events'], 'the earlier keys stay');

select * from finish();
rollback;
