-- 5B decision 6: the quiet-hours editor (Settings → Thresholds). The two org_settings values
-- quiet_hours_start / quiet_hours_end (IST, kickoff 5 decision 5) are written by the Owner only
-- (`settings.manage`, the org_settings update policy, the 5A column grant); Admin, Staff (shown as
-- Crew) and a signed-out caller change nothing. The change is audited, and push_quiet() follows
-- the new window at once (it reads the row when it runs).
begin;
create extension if not exists pgtap with schema extensions;
select plan(14);

delete from public.task_requests;
delete from public.task_warnings;
delete from public.task_reviews;
delete from public.task_submissions;
delete from public.task_comments;
delete from public.task_stages;
delete from public.task_assignees;
delete from public.tasks;
delete from public.task_templates;
delete from public.member_coordinators;
delete from public.attendance_events;
delete from public.attendance_days;
delete from public.expense_claims;
delete from public.comp_leave_credit_uses;
delete from public.comp_leave_credits;
delete from public.extra_work_notes;
delete from public.leave_requests;
delete from public.session_events;
delete from public.activity_log;
delete from public.field_definitions;
delete from public.client_contacts;
delete from public.client_admin_assignments;
delete from public.client_brand;
delete from public.client_private;
delete from public.client_close_reasons;
delete from public.clients;
update public.organizations set logo_file_id = null;
delete from public.files;
delete from public.notifications;
delete from public.push_subscriptions;
delete from public.members;
delete from auth.identities;
delete from auth.users;
delete from public.activity_log;

create temporary table fx (key text primary key, id uuid not null);
insert into fx values
  ('owner', '00000000-0000-4000-8000-000000000f01'),
  ('admin', '00000000-0000-4000-8000-000000000f02'),
  ('staff', '00000000-0000-4000-8000-000000000f03');
insert into fx select 'org', id from public.organizations limit 1;
grant all on fx to authenticated, anon, service_role;

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

create function pg_temp.as_anon() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  perform set_config('role', 'anon', true);
end;
$$;

create function pg_temp.as_system() returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', '', true);
end;
$$;

-- How many rows a statement touched, as the caller (RLS decides).
create function pg_temp.rows(q text) returns bigint language plpgsql as $$
declare
  n bigint;
begin
  execute q;
  get diagnostics n = row_count;
  return n;
end;
$$;

-- The window as it stands (read as the system).
create function pg_temp.window() returns text language sql stable as $$
  select s.quiet_hours_start::text || '-' || s.quiet_hours_end::text
  from public.org_settings s where s.org_id = pg_temp.fx('org');
$$;

-- An instant at an IST clock time today.
create function pg_temp.ist(t time) returns timestamptz language sql stable as $$
  select (app.today_ist() + t) at time zone 'Asia/Kolkata';
$$;

insert into auth.users (id, email)
select id, key || '@example.com' from fx where key <> 'org';
insert into public.members (id, org_id, full_name, email, role, status, joined_at)
select pg_temp.fx(k), pg_temp.fx('org'), initcap(k), k || '@example.com', r::public.member_role, 'active', now() - interval '30 days'
from (values ('owner', 'owner'), ('admin', 'admin'), ('staff', 'staff')) as v(k, r);

update public.org_settings set quiet_hours_start = '22:00', quiet_hours_end = '07:00'
where org_id = pg_temp.fx('org');
delete from public.activity_log;

-- 1. The Owner writes the window -------------------------------------------------------------------
select pg_temp.as_member('owner');
select is(
  pg_temp.rows($q$update public.org_settings set quiet_hours_start = '23:00', quiet_hours_end = '06:30'
                where org_id = pg_temp.fx('org')$q$),
  1::bigint, 'the Owner updates the quiet hours');
select pg_temp.as_system();
select is(pg_temp.window(), '23:00:00-06:30:00', 'the new window is stored');
select is(
  (select count(*) from public.activity_log
   where entity = 'org_settings' and action = 'update' and actor_id = pg_temp.fx('owner')
     and diff -> 'new' ->> 'quiet_hours_start' = '23:00:00'
     and diff -> 'new' ->> 'quiet_hours_end' = '06:30:00'),
  1::bigint, 'the change is audited, naming the Owner and both times');

-- 2. Admin, Staff (Crew) and a signed-out caller change nothing -------------------------------------
select pg_temp.as_member('admin');
select is(
  pg_temp.rows($q$update public.org_settings set quiet_hours_start = '20:00' where org_id = pg_temp.fx('org')$q$),
  0::bigint, 'an Admin updates no row (RLS: settings.manage)');
select pg_temp.as_member('staff');
select is(
  pg_temp.rows($q$update public.org_settings set quiet_hours_end = '09:00' where org_id = pg_temp.fx('org')$q$),
  0::bigint, 'a Crew member (staff) updates no row');
select pg_temp.as_anon();
select throws_ok(
  $q$update public.org_settings set quiet_hours_start = '20:00'$q$,
  '42501', null, 'a signed-out caller is refused outright');
select pg_temp.as_system();
select is(pg_temp.window(), '23:00:00-06:30:00', 'the window is still the Owner''s');

-- 3. Every role may still read it (the summary under Settings is the Owner's, the value is not secret)
select pg_temp.as_member('staff');
select is(
  (select quiet_hours_start::text from public.org_settings where org_id = pg_temp.fx('org')),
  '23:00:00', 'a Crew member reads the window (org_settings select is every member''s)');
select pg_temp.as_system();

-- 4. push_quiet() follows the new window at once ----------------------------------------------------
select is(public.push_quiet(pg_temp.ist('23:30'), pg_temp.fx('org')), true, '23:30 IST is quiet in 23:00-06:30');
select is(public.push_quiet(pg_temp.ist('06:00'), pg_temp.fx('org')), true, '06:00 IST is quiet (past midnight)');
select is(public.push_quiet(pg_temp.ist('22:30'), pg_temp.fx('org')), false, '22:30 IST is no longer quiet');
select is(public.push_quiet(pg_temp.ist('06:30'), pg_temp.fx('org')), false, 'the window ends at 06:30');

-- A window within one day works the same way.
update public.org_settings set quiet_hours_start = '13:00', quiet_hours_end = '14:00'
where org_id = pg_temp.fx('org');
select is(public.push_quiet(pg_temp.ist('13:15'), pg_temp.fx('org')), true, '13:15 IST is quiet in 13:00-14:00');
select is(public.push_quiet(pg_temp.ist('23:30'), pg_temp.fx('org')), false, 'and 23:30 is not');

select * from finish();
rollback;
