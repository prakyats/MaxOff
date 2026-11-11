-- v2.0 X3 step 3 (2026-11-05, migration session_early_own_hours; DATA-MODEL §1 "v2.0 X3";
-- advisor-approved on #89): session_early() gains own_hours, attendance_own_hours()'s row, only
-- where own_day is answered. The Owner gets null; an Admin and Crew get their own row only
-- (equal to attendance_own_hours() as the caller); a refused day (a freelancer, a deactivated
-- member) gets null; no session gets null. Every earlier key is unchanged (130). Neutral names.
begin;
create extension if not exists pgtap with schema extensions;
select plan(19);

create temporary table fx (key text primary key, id uuid not null);
insert into fx values
  ('owner',      '10000000-0000-4000-8000-000000000001'),
  ('admin',      '10000000-0000-4000-8000-000000000002'),
  ('staff',      '10000000-0000-4000-8000-000000000003'),
  ('freelancer', '00000000-0000-4000-8000-000000013101'),
  ('gone',       '00000000-0000-4000-8000-000000013102');
insert into fx select 'org', id from public.organizations limit 1;
grant select on fx to authenticated, anon;
create temporary table seen (who text primary key, hours jsonb);
grant select, insert on seen to authenticated;

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

insert into auth.users (id, email) values (pg_temp.fx('gone'), 'gone-13102@example.com');
insert into public.members (id, org_id, full_name, email, role, status, engagement, joined_at, deactivated_at) values
  (pg_temp.fx('freelancer'), pg_temp.fx('org'), 'Free Person', null,                     'staff', 'active',      'freelance', now() - interval '30 days', null),
  (pg_temp.fx('gone'),       pg_temp.fx('org'), 'Gone Person', 'gone-13102@example.com', 'staff', 'deactivated', 'permanent', now() - interval '30 days', now());

-- The Admin's day today carries a late reason, so the rows differ and "own" is visible.
insert into public.attendance_days (member_id, work_date, started_at, state)
values (pg_temp.fx('admin'), app.today_ist(), now(), 'awaiting_choice')
on conflict (member_id, work_date) do nothing;
update public.attendance_days set late_minutes = 12, late_reason = 'Traffic 13102'
where member_id = pg_temp.fx('admin') and work_date = app.today_ist();

-- The Owner: no own day, so no own hours.
select pg_temp.as_member('owner');
select ok(public.session_early() ? 'own_hours', 'the key is there for everyone');
select is(public.session_early()->'own_hours', 'null'::jsonb, 'Owner: no own hours (his own day is refused)');

-- An Admin and Crew: their own row, equal to attendance_own_hours() as the caller.
select pg_temp.as_member('admin');
select is(public.session_early()->'own_hours', (select to_jsonb(h) from public.attendance_own_hours() h),
  'Admin: own_hours equals attendance_own_hours()');
select is((public.session_early()->'own_hours'->>'work_date')::date, app.today_ist(),
  'Admin: today (IST)');
select isnt(public.session_early()->'own_hours', 'null'::jsonb, 'Admin: answered');
insert into seen select 'admin', public.session_early()->'own_hours';
select pg_temp.as_member('staff');
select is(public.session_early()->'own_hours', (select to_jsonb(h) from public.attendance_own_hours() h),
  'Crew: own_hours equals attendance_own_hours()');
select isnt(public.session_early()->'own_hours', 'null'::jsonb, 'Crew: answered');
select is((select hours->>'late_reason' from seen where who = 'admin'), 'Traffic 13102',
  'the Admin''s own hours carry the Admin''s day');
select isnt(public.session_early()->'own_hours'->>'late_reason', 'Traffic 13102',
  'own data only: Crew''s own hours never carry the Admin''s day');

-- A refused own day: no own hours.
select pg_temp.as_member('freelancer');
select is(public.session_early()->'own_hours', 'null'::jsonb, 'freelancer: no own hours (refused)');
select pg_temp.as_member('gone');
select is(public.session_early()->'own_hours', 'null'::jsonb, 'deactivated: no own hours (refused)');

-- X5+ H4: attendance_own_hours() itself refuses the same callers, with the very code
-- session_early() names for their own day (the app throws that code for both reads).
create function pg_temp.raised(sql text) returns text language plpgsql as $$
begin
  execute sql;
  return null;
exception when others then
  return sqlerrm;
end;
$$;
select pg_temp.as_member('owner');
select isnt(public.session_early()->>'own_day_refused', null, 'Owner: own day refused, with a code');
select is(pg_temp.raised('select * from public.attendance_own_hours()'),
  public.session_early()->>'own_day_refused', 'Owner: attendance_own_hours() refuses with that code');
select pg_temp.as_member('freelancer');
select isnt(public.session_early()->>'own_day_refused', null, 'freelancer: own day refused, with a code');
select is(pg_temp.raised('select * from public.attendance_own_hours()'),
  public.session_early()->>'own_day_refused', 'freelancer: attendance_own_hours() refuses with that code');
select pg_temp.as_member('gone');
select isnt(public.session_early()->>'own_day_refused', null, 'deactivated: own day refused, with a code');
select is(pg_temp.raised('select * from public.attendance_own_hours()'),
  public.session_early()->>'own_day_refused', 'deactivated: attendance_own_hours() refuses with that code');

-- No session: nothing.
select pg_temp.as_system();
select is(public.session_early()->'own_hours', 'null'::jsonb, 'no session: no own hours');
select is(public.session_early()->'own_day', 'null'::jsonb, 'no session: no own day either (unchanged)');

select * from finish();
rollback;
