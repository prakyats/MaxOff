-- v1.9 (owner 2026-11-03, W7 Q5; migration project_resume_passed_delivery; WORKFLOWS §5.5): resuming a
-- one-time project whose delivery date has passed requires a new delivery date from today on. Each path:
-- passed and none given (refused, still held, nothing moved), passed and a past one (refused), passed and a
-- new one (resumes, the date moves, audited with the old and new date), the date today or ahead
-- (optional, as before), a recurring project (unaffected; a delivery date still refused), for the Owner
-- and the client's Admin; another Admin NOT_FOUND, Crew FORBIDDEN, anon no privilege.
begin;
create extension if not exists pgtap with schema extensions;
select plan(24);

delete from public.deliverable_templates;
delete from public.item_reviews;
delete from public.project_item_stage_list;
delete from public.project_item_stages;
delete from public.project_items;
delete from public.project_cycles;
delete from public.project_item_blueprints;
delete from public.project_stages;
delete from public.projects;
delete from public.project_templates;
delete from public.stage_presets;
delete from public.client_work_alerts;
delete from public.task_requests;
delete from public.task_warnings;
delete from public.task_reviews;
delete from public.task_submissions;
delete from public.task_comments;
delete from public.task_stages;
delete from public.task_reminders;
delete from public.task_reminder_arms;
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
delete from public.eod_reports;
delete from public.notification_deliveries;
delete from public.notifications;
delete from public.push_subscriptions;
delete from public.member_reachability;
delete from public.members;
delete from auth.identities;

create temporary table fx (key text primary key, id uuid not null);
insert into fx values
  ('owner',    '00000000-0000-4000-8000-000000129001'),
  ('admin',    '00000000-0000-4000-8000-000000129002'),
  ('admin2',   '00000000-0000-4000-8000-000000129003'),
  ('staff',    '00000000-0000-4000-8000-000000129004'),
  ('client_a', '00000000-0000-4000-8000-0000001290a1');
insert into fx select 'org', id from public.organizations limit 1;
grant select, insert on fx to authenticated, anon, service_role;

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
create function pg_temp.as_anon() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  perform set_config('role', 'anon', true);
end;
$$;
create function pg_temp.code(sql text) returns text language plpgsql as $$
begin
  execute sql;
  return 'ok';
exception when sqlstate 'P0001' then
  return sqlerrm;
end;
$$;
create function pg_temp.message(sql text) returns text language plpgsql as $$
declare
  v_detail text;
begin
  execute sql;
  return null;
exception when sqlstate 'P0001' then
  get stacked diagnostics v_detail = pg_exception_detail;
  return v_detail;
end;
$$;
create function pg_temp.say(d date) returns text language sql stable security definer as $$ select app.notify_date(d); $$;
create function pg_temp.project(k text) returns public.projects language sql stable security definer as $$
  select p from public.projects p where p.id = pg_temp.fx(k);
$$;
create function pg_temp.last_entry(p_entity text, p_action text, k text) returns public.activity_log language sql stable security definer as $$
  select a from public.activity_log a where a.entity = p_entity and a.action = p_action and a.entity_id = pg_temp.fx(k)
  order by a.id desc limit 1;
$$;
-- A project of Client A made by its Admin, held by them, its delivery date then set to `delivery`.
create function pg_temp.held(k text, recurrence text, delivery date) returns uuid language plpgsql as $$
declare
  v_id uuid;
begin
  perform pg_temp.as_member('admin');
  v_id := public.project_create(pg_temp.fx('client_a'), initcap(k), recurrence::public.recurrence, null,
    case when recurrence = 'one_time' then app.today_ist() + 10 end, array['Shoot'], array[initcap(k) || ' film']);
  insert into fx values (k, v_id);
  perform pg_temp.as_system();
  update public.projects set delivery_date = delivery where id = v_id;
  perform pg_temp.as_member('admin');
  perform public.project_hold(v_id, 'Client paused');
  perform pg_temp.as_system();
  return v_id;
end;
$$;

insert into auth.users (id, email) select id, key || '@example.com' from fx where key <> 'org' and key not like 'client_%';
insert into public.members (id, org_id, full_name, email, role, status, joined_at)
select pg_temp.fx(k), pg_temp.fx('org'), initcap(k), k || '@example.com', r::public.member_role, 'active', now() - interval '60 days'
from (values ('owner', 'owner'), ('admin', 'admin'), ('admin2', 'admin'), ('staff', 'staff')) as v(k, r);
insert into public.clients (id, org_id, name, state, admin_id, activated_at) values
  (pg_temp.fx('client_a'), pg_temp.fx('org'), 'Client A', 'active', pg_temp.fx('admin'), now() - interval '90 days');

select pg_temp.held('p_passed', 'one_time', app.today_ist() - 2);
select pg_temp.held('p_admin', 'one_time', app.today_ist() - 1);
select pg_temp.held('p_today', 'one_time', app.today_ist());
select pg_temp.held('p_ahead', 'one_time', app.today_ist() + 5);
select pg_temp.held('p_monthly', 'monthly', null);

-- ===========================================================================================================
-- 1. Who may resume (unchanged)
-- ===========================================================================================================
select pg_temp.as_anon();
select throws_ok($$ select public.project_resume(pg_temp.fx('p_passed'), '[]'::jsonb, app.today_ist() + 3) $$, '42501', null,
  'anon: no privilege');
select pg_temp.as_member('staff');
select is(pg_temp.code($$ select public.project_resume(pg_temp.fx('p_passed'), '[]'::jsonb, app.today_ist() + 3) $$),
  'FORBIDDEN', 'Crew: FORBIDDEN');
select pg_temp.as_member('admin2');
select is(pg_temp.code($$ select public.project_resume(pg_temp.fx('p_passed'), '[]'::jsonb, app.today_ist() + 3) $$),
  'NOT_FOUND', 'another Admin: NOT_FOUND');

-- ===========================================================================================================
-- 2. A passed delivery date: a new one is required
-- ===========================================================================================================
select pg_temp.as_member('owner');
select is(pg_temp.code($$ select public.project_resume(pg_temp.fx('p_passed'), '[]'::jsonb) $$), 'VALIDATION',
  'passed, no new delivery date: VALIDATION');
select is(pg_temp.message($$ select public.project_resume(pg_temp.fx('p_passed'), '[]'::jsonb) $$),
  format('The delivery date (%s) has passed: choose a new one from today on.', pg_temp.say(app.today_ist() - 2)),
  'in plain words, naming the date');
select is(pg_temp.code($$ select public.project_resume(pg_temp.fx('p_passed'), '[]'::jsonb, app.today_ist() - 1) $$),
  'VALIDATION', 'passed, a new one in the past: VALIDATION');
select pg_temp.as_system();
select ok((pg_temp.project('p_passed')).held_at is not null, 'the refusals left it held');
select is((pg_temp.project('p_passed')).delivery_date, app.today_ist() - 2, 'and its delivery date as it was');
select is((select count(*)::integer from public.activity_log where entity = 'projects' and action = 'resumed'
           and entity_id = pg_temp.fx('p_passed')), 0, 'and wrote no history');

select pg_temp.as_member('owner');
select ok(public.project_resume(pg_temp.fx('p_passed'), '[]'::jsonb, app.today_ist() + 3) is not null,
  'passed, with a new delivery date from today on: the Owner resumes it');
select pg_temp.as_system();
select is((pg_temp.project('p_passed')).held_at, null, 'no longer held');
select is((pg_temp.project('p_passed')).delivery_date, app.today_ist() + 3, 'the delivery date moved');
select is((pg_temp.last_entry('projects', 'resumed', 'p_passed')).diff #>> '{old,delivery_date}',
  (app.today_ist() - 2)::text, 'History keeps the old delivery date');
select is((pg_temp.last_entry('projects', 'resumed', 'p_passed')).diff #>> '{new,delivery_date}',
  (app.today_ist() + 3)::text, 'and the new one');

select pg_temp.as_member('admin');
select is(pg_temp.code($$ select public.project_resume(pg_temp.fx('p_admin'), '[]'::jsonb) $$), 'VALIDATION',
  'the client''s Admin, passed and none given: VALIDATION');
select ok(public.project_resume(pg_temp.fx('p_admin'), '[]'::jsonb, app.today_ist()) is not null,
  'with today as the new delivery date: resumed');
select pg_temp.as_system();
select is((pg_temp.project('p_admin')).delivery_date, app.today_ist(), 'the delivery date is today');

-- ===========================================================================================================
-- 3. Not passed: optional as before; recurring projects unaffected
-- ===========================================================================================================
select pg_temp.as_member('admin');
select ok(public.project_resume(pg_temp.fx('p_today'), '[]'::jsonb) is not null, 'due today (not passed): resumes without one');
select ok(public.project_resume(pg_temp.fx('p_ahead'), '[]'::jsonb) is not null, 'due ahead: resumes without one');
select pg_temp.as_system();
select is((pg_temp.project('p_today')).delivery_date, app.today_ist(), 'the kept dates stay');
select is((pg_temp.project('p_ahead')).delivery_date, app.today_ist() + 5, 'as they were');
select pg_temp.as_member('admin');
select is(pg_temp.code($$ select public.project_resume(pg_temp.fx('p_monthly'), '[]'::jsonb, app.today_ist() + 3) $$),
  'VALIDATION', 'a recurring project still takes no delivery date');
select ok(public.project_resume(pg_temp.fx('p_monthly'), '[]'::jsonb) is not null, 'and resumes without one');
select pg_temp.as_system();
select is((pg_temp.project('p_monthly')).held_at, null, 'resumed');

select * from finish();
rollback;
