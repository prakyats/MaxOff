-- v1.9 (owner 2026-11-03, W7 Q2; migration task_hold_tells_approver; WORKFLOWS §3.1a and §9): a held or
-- resumed task's approving Admin is told (task_held / task_resumed, quietly), but cannot hold or resume it.
-- Each actor (the Owner, the creator Admin), the approver as a plain approver (named by the Owner) and as
-- the creator too (told once), refusals for the approver, another Admin, Crew and anon, and the unchanged recipients (the
-- assignees; the Owner not told of an Admin's own task; never the actor).
begin;
create extension if not exists pgtap with schema extensions;
select plan(27);

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
  ('owner',  '00000000-0000-4000-8000-000000128001'),
  ('admin',  '00000000-0000-4000-8000-000000128002'),
  ('appr',   '00000000-0000-4000-8000-000000128003'),
  ('admin3', '00000000-0000-4000-8000-000000128004'),
  ('staff',  '00000000-0000-4000-8000-000000128005');
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
-- A task made by `by` for the Crew member, due in `due`, with an approving Admin (or none).
create function pg_temp.mk(k text, by text, approver text, due interval default interval '3 days') returns uuid
language plpgsql as $$
declare
  v_id uuid;
begin
  perform pg_temp.as_member(by);
  v_id := public.task_create(
    title => initcap(k), description => null, task_type_id => pg_temp.fx('type'), client_id => null,
    priority => 'medium', due_at => now() + due,
    assignee_ids => array[pg_temp.fx('staff')], primary_owner_id => pg_temp.fx('staff'),
    approving_admin_id => case when approver is null then null else pg_temp.fx(approver) end,
    stages => array['Cut']);
  insert into fx values (k, v_id);
  perform pg_temp.as_system();
  return v_id;
end;
$$;
-- Notifications of a kind to a member about a task.
create function pg_temp.n(who text, kind text, about text) returns integer language sql stable security definer as $$
  select count(*)::integer from public.notifications x
  where x.recipient_id = pg_temp.fx(who) and x.kind = $2 and x.entity_id = pg_temp.fx(about);
$$;

insert into auth.users (id, email) select id, key || '@example.com' from fx where key <> 'org';
insert into public.members (id, org_id, full_name, email, role, status, joined_at)
select pg_temp.fx(k), pg_temp.fx('org'), initcap(k), k || '@example.com', r::public.member_role, 'active', now() - interval '60 days'
from (values ('owner', 'owner'), ('admin', 'admin'), ('appr', 'admin'), ('admin3', 'admin'), ('staff', 'staff')) as v(k, r);
insert into public.task_types (org_id, name, kind, shows_on_calendar, has_location, position)
values (pg_temp.fx('org'), 'Type 128', 'normal', false, false, 'z128');
insert into fx select 'type', id from public.task_types where org_id = pg_temp.fx('org') and name = 'Type 128';

-- An Admin's own task routes to them (they are its approver); the Owner may name another approver.
select pg_temp.mk('t_owner', 'owner', 'appr');
select pg_temp.mk('t_admin', 'admin', null);
select pg_temp.as_member('owner');
select public.task_set_approver(pg_temp.fx('t_admin'), pg_temp.fx('appr'));
select pg_temp.mk('t_self', 'admin', null);
select pg_temp.mk('t_none', 'owner', null);
select pg_temp.as_system();
delete from public.notifications;

-- ===========================================================================================================
-- 1. The approving Admin still cannot hold
-- ===========================================================================================================
select pg_temp.as_anon();
select throws_ok($$ select public.task_hold(pg_temp.fx('t_owner'), 'x') $$, '42501', null, 'anon: no privilege');
select pg_temp.as_member('appr');
select is(pg_temp.code($$ select public.task_hold(pg_temp.fx('t_owner'), 'x') $$), 'FORBIDDEN',
  'the approving Admin (the Owner''s task): FORBIDDEN to hold');
select is(pg_temp.code($$ select public.task_hold(pg_temp.fx('t_admin'), 'x') $$), 'FORBIDDEN',
  'the approving Admin (another Admin''s task): FORBIDDEN to hold');
select pg_temp.as_member('admin3');
select is(pg_temp.code($$ select public.task_hold(pg_temp.fx('t_owner'), 'x') $$), 'NOT_FOUND', 'an Admin not on it: NOT_FOUND');
select pg_temp.as_member('staff');
select is(pg_temp.code($$ select public.task_hold(pg_temp.fx('t_owner'), 'x') $$), 'FORBIDDEN', 'the Crew assignee: FORBIDDEN');
select pg_temp.as_system();
select is((select count(*)::integer from public.tasks where held_at is not null), 0, 'the refusals held nothing');
select is((select count(*)::integer from public.notifications), 0, 'and told nobody');

-- ===========================================================================================================
-- 2. Hold: the approving Admin is told
-- ===========================================================================================================
select pg_temp.as_member('owner');
select ok(public.task_hold(pg_temp.fx('t_owner'), 'Client paused') is not null, 'the Owner holds their own task');
select is(pg_temp.n('appr', 'task_held', 't_owner'), 1, 'its approving Admin is told');
select is(pg_temp.n('staff', 'task_held', 't_owner'), 1, 'its assignee too, as before');
select pg_temp.as_system();
select is((select count(*)::integer from public.notification_deliveries d join public.notifications x on x.id = d.notification_id
           where x.recipient_id = pg_temp.fx('appr') and d.channel <> 'push'), 0, 'quietly: push only, no email');

select pg_temp.as_member('admin');
select ok(public.task_hold(pg_temp.fx('t_admin'), 'Footage late') is not null, 'the creator Admin holds their task');
select is(pg_temp.n('appr', 'task_held', 't_admin'), 1, 'its approving Admin is told');
select is(pg_temp.n('owner', 'task_held', 't_admin'), 0, 'the Owner is not (an Admin''s own task, unchanged)');
select is(pg_temp.n('admin', 'task_held', 't_admin'), 0, 'never the actor');

select pg_temp.as_member('owner');
select ok(public.task_hold(pg_temp.fx('t_self'), 'Waiting') is not null, 'the Owner holds an Admin''s own task (its creator is its approver)');
select is(pg_temp.n('admin', 'task_held', 't_self'), 1, 'that Admin is told once, not twice');
select ok(public.task_hold(pg_temp.fx('t_none'), 'Waiting') is not null, 'the Owner holds a task with no approver');
select pg_temp.as_system();
select is((select count(*)::integer from public.notifications where entity_id = pg_temp.fx('t_none')), 1,
  'only its assignee is told (no approver to tell)');

-- ===========================================================================================================
-- 3. Resume: the approving Admin is told, and still cannot resume
-- ===========================================================================================================
select pg_temp.as_member('appr');
select is(pg_temp.code($$ select public.task_resume(pg_temp.fx('t_owner')) $$), 'FORBIDDEN',
  'the approving Admin: FORBIDDEN to resume');
select pg_temp.as_member('owner');
select ok(public.task_resume(pg_temp.fx('t_owner')) is not null, 'the Owner resumes it');
select is(pg_temp.n('appr', 'task_resumed', 't_owner'), 1, 'its approving Admin is told');
select is(pg_temp.n('staff', 'task_resumed', 't_owner'), 1, 'and its assignee');

select pg_temp.as_system();
update public.tasks set due_at = now() - interval '1 hour' where id = pg_temp.fx('t_admin');
select pg_temp.as_member('admin');
select ok(public.task_resume(pg_temp.fx('t_admin'), now() + interval '1 day') is not null,
  'the creator Admin resumes it with a new deadline');
select is(pg_temp.n('appr', 'task_resumed', 't_admin'), 1, 'its approving Admin is told');

select pg_temp.as_member('owner');
select ok(public.task_resume(pg_temp.fx('t_self')) is not null, 'the Owner resumes the creator-approver''s task');
select is(pg_temp.n('admin', 'task_resumed', 't_self'), 1, 'that Admin is told once');

select * from finish();
rollback;
