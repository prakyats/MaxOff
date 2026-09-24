-- Phase 1 review hardening: the deactivation reason is hidden from the person it is about, and
-- the API role can update only the columns each screen edits.
begin;
create extension if not exists pgtap with schema extensions;
select plan(25);

-- Attendance and leave rows (2.1) reference members: a Playwright run leaves some behind (2.2).
delete from public.attendance_events;
delete from public.attendance_days;
delete from public.leave_requests;
delete from public.session_events;
delete from public.activity_log;
delete from public.members;
delete from public.holidays;
delete from public.list_items
  where list_key <> 'job_title' or name not in ('Video Editor', 'Graphic Designer');
update public.list_items set archived_at = null where archived_at is not null;
delete from auth.identities;
delete from auth.users;
delete from public.activity_log;

create temporary table fx (key text primary key, id uuid not null);
insert into fx values
  ('owner', '00000000-0000-4000-8000-000000000001'),
  ('admin', '00000000-0000-4000-8000-000000000002'),
  ('staff', '00000000-0000-4000-8000-000000000003');
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

insert into auth.users (id, email)
select id, key || '@example.com' from fx where key <> 'org';
insert into public.members (id, org_id, full_name, email, role, status, joined_at) values
  (pg_temp.fx('owner'), pg_temp.fx('org'), 'Test Owner', 'owner@example.com', 'owner', 'active', now()),
  (pg_temp.fx('admin'), pg_temp.fx('org'), 'Test Admin', 'admin@example.com', 'admin', 'active', now()),
  (pg_temp.fx('staff'), pg_temp.fx('org'), 'Test Staff', 'staff@example.com', 'staff', 'active', now());
insert into public.holidays (org_id, date, name) values (pg_temp.fx('org'), '2026-10-02', 'Gandhi Jayanti');
delete from public.activity_log;

-- 1. The deactivation reason stays the Owner's --------------------------------------------------
select pg_temp.as_member('owner');
update public.members set full_name = 'Test Staff (edited)' where id = pg_temp.fx('staff');
select is(public.member_deactivate(pg_temp.fx('staff'), 'Kept missing deadlines'), 'deactivated',
  'the Owner deactivates Staff with a reason');
select is(public.member_reactivate(pg_temp.fx('staff')), 'active', 'and reactivates them');
select is(
  (select count(*) from public.activity_log
     where entity = 'members' and entity_id = pg_temp.fx('staff') and action = 'deactivated'),
  1::bigint, 'activity.view_all reads the deactivation row');

select pg_temp.as_member('staff');
select is((select count(*) from app.current_member()), 1::bigint, 'the reactivated person is back');
select is(
  (select count(*) from public.activity_log where entity_id = pg_temp.fx('staff') and action = 'deactivated'),
  0::bigint, 'they never see their deactivation row, so the reason stays the Owner''s');
select is(
  (select count(*) from public.activity_log where meta ->> 'reason' is not null),
  0::bigint, 'and no reason text reaches them by any path');
select results_eq(
  $$ select action from public.activity_log where entity_id = pg_temp.fx('staff') order by id $$,
  $$ values ('update'), ('reactivated') $$,
  'the edit and the reactivation of their own row are still theirs to read');

select pg_temp.as_member('admin');
select is((select count(*) from public.activity_log where entity_id <> pg_temp.fx('admin')), 0::bigint,
  'an Admin still sees nothing about other members');

-- 2. Column-level UPDATE grants -----------------------------------------------------------------
-- organizations: settings.manage edits the name, nothing else (timezone is IST by invariant 8).
select pg_temp.as_member('owner');
update public.organizations set name = 'Pixora Clips Pvt Ltd' where id = pg_temp.fx('org');
select is((select name from public.organizations where id = pg_temp.fx('org')), 'Pixora Clips Pvt Ltd',
  'the Owner renames the organization');
select throws_ok($$ update public.organizations set timezone = 'UTC' where id = pg_temp.fx('org') $$,
  '42501', null, 'organizations.timezone has no UPDATE privilege for the API role');
select throws_ok($$ update public.organizations set created_at = now() where id = pg_temp.fx('org') $$,
  '42501', null, 'organizations.created_at has no UPDATE privilege');

-- org_settings: every threshold and day-off column, never the key or the timestamps.
update public.org_settings
  set weekly_off_days = array[0, 6]::smallint[], logout_reminder_time = '21:00', ack_repeat_hours = 3,
      ack_escalate_hours = 5, ack_escalate_owner_hours = 9, overdue_escalate_hours = 30,
      email_daily_cap_per_member = 7, default_task_reminders = default_task_reminders,
      workload_warning_threshold = workload_warning_threshold
  where org_id = pg_temp.fx('org');
select is((select ack_escalate_owner_hours from public.org_settings where org_id = pg_temp.fx('org')), 9,
  'the Owner edits every settings column the screens carry');
select throws_ok($$ update public.org_settings set created_at = now() where org_id = pg_temp.fx('org') $$,
  '42501', null, 'org_settings.created_at has no UPDATE privilege');
select throws_ok($$ update public.org_settings set org_id = gen_random_uuid() where org_id = pg_temp.fx('org') $$,
  '42501', null, 'org_settings.org_id has no UPDATE privilege');

-- list_items: lists.manage (an Admin too) edits name, description, colour, icon and archived_at.
select pg_temp.as_member('admin');
update public.list_items set name = 'Senior Video Editor', description = 'Cuts the long-form work',
  color = '#AD5009', icon = 'film' where list_key = 'job_title' and name = 'Video Editor';
select is((select count(*) from public.list_items where name = 'Senior Video Editor'), 1::bigint,
  'an Admin edits a job title''s name, description, colour and icon');
update public.list_items set archived_at = now() where name = 'Senior Video Editor';
select is((select archived_at is not null from public.list_items where name = 'Senior Video Editor'), true,
  'and archives it');
select throws_ok($$ update public.list_items set list_key = 'task_type' where name = 'Senior Video Editor' $$,
  '42501', null, 'list_items.list_key has no UPDATE privilege (an entry cannot be moved between lists)');
select throws_ok($$ update public.list_items set position = 99 where name = 'Senior Video Editor' $$,
  '42501', null, 'list_items.position has no UPDATE privilege (list_item_move() is the only path)');
select throws_ok($$ update public.list_items set is_system = true where name = 'Senior Video Editor' $$,
  '42501', null, 'list_items.is_system has no UPDATE privilege');
select throws_ok($$ update public.list_items set meta = '{"x": 1}' where name = 'Senior Video Editor' $$,
  '42501', null, 'list_items.meta has no UPDATE privilege');
select throws_ok($$ update public.list_items set org_id = gen_random_uuid() where name = 'Senior Video Editor' $$,
  '42501', null, 'list_items.org_id has no UPDATE privilege');

-- holidays: settings.manage edits the date and the name.
select pg_temp.as_member('owner');
update public.holidays set date = '2026-10-03', name = 'Gandhi Jayanti (observed)' where name = 'Gandhi Jayanti';
select is((select date from public.holidays where name = 'Gandhi Jayanti (observed)'), '2026-10-03'::date,
  'the Owner edits a holiday''s date and name');
select throws_ok($$ update public.holidays set org_id = gen_random_uuid() where date = '2026-10-03' $$,
  '42501', null, 'holidays.org_id has no UPDATE privilege');
select throws_ok($$ update public.holidays set created_at = now() where date = '2026-10-03' $$,
  '42501', null, 'holidays.created_at has no UPDATE privilege');

-- members keeps the 1.1/1.3 grant: the same rule, already tested in 01 and 03.
select is(
  (select array_agg(column_name::text order by column_name)
     from information_schema.column_privileges
     where table_schema = 'public' and table_name = 'members' and grantee = 'authenticated'
       and privilege_type = 'UPDATE'),
  array['full_name', 'job_title_id', 'phone', 'role'],
  'members'' editable columns are unchanged');

select pg_temp.as_system();
select * from finish();
rollback;
