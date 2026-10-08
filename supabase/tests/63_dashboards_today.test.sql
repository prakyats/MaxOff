-- 6A (migration dashboards_today; Kickoff 6 decisions 6, 8, 10 and 23): the reads behind the Owner's
-- Overdue and risks and the Admin's Issues. (1) dashboard_not_noted(): the Owner only, on 5.3's
-- escalation clock (greatest(assigned_at, armed_at) + ack_escalate_owner_hours, armed tasks only).
-- (2) dashboard_unreachable(): 5.4's 48-hour status, the Owner every open task (with since), an
-- Admin the open tasks they created or approve (since null), a freelancer through their current
-- coordinator, the reachability clock's floor; Staff refused. (3) emails_held_today(): today's
-- skipped_cap emails by limit, settings.manage only. Each allowed and refused per role.
begin;
create extension if not exists pgtap with schema extensions;
select plan(29);

-- 7A: client work rows reference clients and members, and the presets the organization (a
-- Playwright run leaves some behind).
delete from public.item_reviews;
delete from public.project_item_stages;
delete from public.project_items;
delete from public.project_cycles;
delete from public.project_item_blueprints;
delete from public.project_stages;
delete from public.projects;
delete from public.project_templates;
delete from public.stage_presets;
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
delete from public.member_reachability;
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
delete from public.holidays;
update public.org_settings set weekly_off_days = '{}', reachability_clock_from = null;

create temporary table fx (key text primary key, id uuid not null);
insert into fx values
  ('owner',  '00000000-0000-4000-8000-000000006301'),
  ('admin1', '00000000-0000-4000-8000-000000006302'),
  ('admin2', '00000000-0000-4000-8000-000000006303'),
  ('staff1', '00000000-0000-4000-8000-000000006304'),
  ('staff2', '00000000-0000-4000-8000-000000006305'),
  ('staff3', '00000000-0000-4000-8000-000000006306');
insert into fx select 'org', id from public.organizations limit 1;
grant all on fx to authenticated, anon, service_role;
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
-- A task created by `by` (the Owner or an Admin), due in three days.
create function pg_temp.mk(k text, by text, assignees text[], approver text default null) returns uuid language plpgsql as $$
declare
  v_id uuid;
begin
  perform pg_temp.as_member(by);
  v_id := public.task_create(k, null, (select id from public.task_types where org_id = pg_temp.fx('org') and name = 'Normal'),
    null, 'medium', now() + interval '3 days', array(select pg_temp.fx(a) from unnest(assignees) a), pg_temp.fx(assignees[1]),
    case when approver is null then null else pg_temp.fx(approver) end);
  perform pg_temp.as_system();
  insert into fx values (k, v_id);
  return v_id;
end;
$$;
-- Assigned `assigned` ago, armed `armed` ago (null: not armed, as a task from before 5.3).
create function pg_temp.clock(k text, assigned interval, armed interval) returns void language sql as $$
  update public.task_assignees set assigned_at = now() - assigned where task_id = pg_temp.fx(k);
  delete from public.task_reminder_arms where task_id = pg_temp.fx(k) and armed is null;
  update public.task_reminder_arms set armed_at = now() - armed where task_id = pg_temp.fx(k) and armed is not null;
$$;
create function pg_temp.not_noted() returns text language sql stable as $$
  select coalesce(string_agg(t.title || ':' || m.full_name, ' ' order by t.title, m.full_name), '')
  from public.dashboard_not_noted() d
  join public.tasks t on t.id = d.task_id
  join public.members m on m.id = d.member_id;
$$;
create function pg_temp.unreachable() returns text language sql stable as $$
  select coalesce(string_agg(d.full_name || ':' || d.state || ':' || d.open_tasks || ':' || (d.since is not null)::text,
                             ' ' order by d.full_name), '')
  from public.dashboard_unreachable() d;
$$;
create function pg_temp.reach(k text, state text, since interval) returns void language sql as $$
  insert into public.member_reachability (member_id, org_id, state, since)
  values (pg_temp.fx(k), pg_temp.fx('org'), state, now() - since)
  on conflict (member_id) do update set state = excluded.state, since = excluded.since;
$$;

insert into auth.users (id, email) select id, key || '@example.com' from fx where key <> 'org';
insert into public.members (id, org_id, full_name, email, role, status, joined_at)
select pg_temp.fx(k), pg_temp.fx('org'), initcap(k), k || '@example.com', r::public.member_role, 'active', now() - interval '60 days'
from (values ('owner', 'owner'), ('admin1', 'admin'), ('admin2', 'admin'), ('staff1', 'staff'), ('staff2', 'staff'),
             ('staff3', 'staff')) as v(k, r);
update public.org_settings set ack_escalate_hours = 4, ack_escalate_owner_hours = 8 where org_id = pg_temp.fx('org');
select pg_temp.as_member('owner');
insert into fx values ('free1', public.member_add_freelancer('Zoya Freelance', null, null, pg_temp.fx('staff2')));
select pg_temp.as_system();

-- 1. Not noted past the Owner escalation -----------------------------------------------------------
select pg_temp.mk('a_late', 'owner', array['staff1'], 'admin1');
select pg_temp.clock('a_late', interval '10 hours', interval '10 hours');
select pg_temp.mk('b_armed_late', 'owner', array['staff2']);
select pg_temp.clock('b_armed_late', interval '10 hours', interval '2 hours');
select pg_temp.mk('c_noted', 'owner', array['staff1']);
select pg_temp.clock('c_noted', interval '10 hours', interval '10 hours');
update public.task_assignees set acknowledged_at = now(), acknowledged_by = member_id where task_id = pg_temp.fx('c_noted');
select pg_temp.mk('d_unarmed', 'owner', array['staff1']);
select pg_temp.clock('d_unarmed', interval '10 hours', null);
select pg_temp.mk('e_done', 'owner', array['staff1']);
select pg_temp.clock('e_done', interval '10 hours', interval '10 hours');
update public.tasks set state = 'completed', completed_at = now() where id = pg_temp.fx('e_done');
select pg_temp.mk('f_recent', 'owner', array['staff3']);
select pg_temp.clock('f_recent', interval '7 hours', interval '7 hours');
select pg_temp.mk('g_removed', 'owner', array['staff1', 'staff3']);
select pg_temp.clock('g_removed', interval '10 hours', interval '10 hours');
update public.task_assignees set removed_at = now() where task_id = pg_temp.fx('g_removed') and member_id = pg_temp.fx('staff3');

select pg_temp.as_member('owner');
select is(pg_temp.not_noted(), 'a_late:Staff1 g_removed:Staff1',
  'the Owner: past 8 h on 5.3''s clock; never armed late, noted, unarmed, completed, recent or removed');
select is((select waiting_since from public.dashboard_not_noted() where task_id = pg_temp.fx('a_late')),
  now() - interval '10 hours',
  'waiting_since is the escalation clock''s start (assigned and armed 10 h ago)');
select pg_temp.as_system();
update public.org_settings set ack_escalate_owner_hours = 12 where org_id = pg_temp.fx('org');
select pg_temp.as_member('owner');
select is(pg_temp.not_noted(), '', 'it follows ack_escalate_owner_hours (12 h: nobody yet)');
select pg_temp.as_system();
update public.org_settings set ack_escalate_owner_hours = 8 where org_id = pg_temp.fx('org');

select pg_temp.as_member('admin1');
select throws_ok($$ select * from public.dashboard_not_noted() $$, 'P0001', null, 'an Admin is refused the Owner''s risks');
select pg_temp.as_member('staff1');
select throws_ok($$ select * from public.dashboard_not_noted() $$, 'P0001', null, 'Staff are refused');
select pg_temp.as_system();
select ok(not has_function_privilege('anon', 'public.dashboard_not_noted()', 'execute'), 'anon cannot call it');
select ok(has_function_privilege('authenticated', 'public.dashboard_not_noted()', 'execute'), 'the API role can call it');

-- 2. Can't be reached on open work -----------------------------------------------------------------
-- a_late: by the Owner, approved by admin1, on staff1. h_free: by admin2 (who approves it), on the
-- freelancer (staff2 coordinates). i_staff3: by the Owner, approved by admin2, on staff3 (not
-- reachable for 10 h only).
select pg_temp.mk('h_free', 'admin2', array['free1'], 'admin2');
select pg_temp.mk('i_staff3', 'owner', array['staff3'], 'admin2');
select pg_temp.reach('staff1', 'no_subscription', interval '72 hours');
select pg_temp.reach('staff2', 'permission_revoked', interval '50 hours');
select pg_temp.reach('staff3', 'failing', interval '10 hours');
select pg_temp.reach('admin1', 'ok', interval '72 hours');
select pg_temp.reach('owner', 'no_subscription', interval '72 hours');

select pg_temp.as_member('owner');
select is(pg_temp.unreachable(), 'Staff1:no_subscription:4:true Staff2:permission_revoked:2:true',
  'the Owner: 48 h or more on open work, a freelancer through the coordinator, with since and the task count');
select pg_temp.as_member('admin1');
select is(pg_temp.unreachable(), 'Staff1:no_subscription:1:false',
  'admin1: only the open tasks they approve, and no since');
select pg_temp.as_member('admin2');
select is(pg_temp.unreachable(), 'Staff2:permission_revoked:1:false',
  'admin2: the freelancer on a task they created, through the coordinator (staff3 under 48 h)');
select pg_temp.as_member('staff1');
select throws_ok($$ select * from public.dashboard_unreachable() $$, 'P0001', null, 'Staff are refused');

select pg_temp.as_system();
select pg_temp.reach('staff3', 'failing', interval '49 hours');
select pg_temp.as_member('admin2');
select is(pg_temp.unreachable(), 'Staff2:permission_revoked:1:false Staff3:failing:1:false',
  'once staff3 passes 48 h, they join admin2''s rows');
select pg_temp.as_system();
update public.org_settings set reachability_clock_from = now() - interval '47 hours' where org_id = pg_temp.fx('org');
select pg_temp.as_member('owner');
select is(pg_temp.unreachable(), '',
  'the reachability clock''s floor: nobody counts from before it');
select pg_temp.as_system();
update public.org_settings set reachability_clock_from = null where org_id = pg_temp.fx('org');
update public.tasks set state = 'cancelled', cancelled_at = now(), cancelled_reason = 'test' where id = pg_temp.fx('h_free');
select pg_temp.as_member('admin2');
select is(pg_temp.unreachable(), 'Staff3:failing:1:false', 'a cancelled task is no longer open work');
select pg_temp.as_system();
update public.members set status = 'deactivated', deactivated_at = now() where id = pg_temp.fx('staff3');
select pg_temp.as_member('owner');
select is(pg_temp.unreachable(), 'Staff1:no_subscription:4:true Staff2:permission_revoked:1:true',
  'a deactivated person is not tracked, and a cancelled task no longer counts');
select pg_temp.as_system();
update public.members set status = 'active', deactivated_at = null where id = pg_temp.fx('staff3');
select ok(not has_function_privilege('anon', 'public.dashboard_unreachable()', 'execute'), 'anon cannot call it');

-- 3. Emails held back today -------------------------------------------------------------------------
insert into public.notifications (id, org_id, recipient_id, kind, title, created_at) values
  ('00000000-0000-4000-8000-000000006391', pg_temp.fx('org'), pg_temp.fx('staff1'), 'end_day_reminder', 'held 1', now()),
  ('00000000-0000-4000-8000-000000006392', pg_temp.fx('org'), pg_temp.fx('staff1'), 'end_day_reminder', 'held 2', now()),
  ('00000000-0000-4000-8000-000000006393', pg_temp.fx('org'), pg_temp.fx('staff2'), 'end_day_reminder', 'held 3', now()),
  ('00000000-0000-4000-8000-000000006394', pg_temp.fx('org'), pg_temp.fx('staff2'), 'end_day_reminder', 'yesterday', now() - interval '2 days'),
  ('00000000-0000-4000-8000-000000006395', pg_temp.fx('org'), pg_temp.fx('staff2'), 'end_day_reminder', 'sent', now());
insert into public.notification_deliveries (notification_id, channel, state, last_error, created_at) values
  ('00000000-0000-4000-8000-000000006391', 'email', 'skipped_cap', 'member_cap', app.ist_day_start(app.today_ist()) + interval '1 minute'),
  ('00000000-0000-4000-8000-000000006392', 'email', 'skipped_cap', 'org_cap', app.ist_day_start(app.today_ist()) + interval '2 minutes'),
  ('00000000-0000-4000-8000-000000006393', 'email', 'skipped_cap', 'org_cap', app.ist_day_start(app.today_ist()) + interval '3 minutes'),
  ('00000000-0000-4000-8000-000000006394', 'email', 'skipped_cap', 'org_cap', app.ist_day_start(app.today_ist()) - interval '1 minute'),
  ('00000000-0000-4000-8000-000000006395', 'email', 'sent', null, app.ist_day_start(app.today_ist()) + interval '4 minutes'),
  ('00000000-0000-4000-8000-000000006395', 'push', 'skipped_cap', 'org_cap', app.ist_day_start(app.today_ist()) + interval '4 minutes');

select pg_temp.as_member('owner');
select is((select string_agg(cap || '=' || held, ' ' order by cap) from public.emails_held_today()),
  'member_cap=1 org_cap=2',
  'the Owner: today''s (IST) held emails by the limit that held them; never yesterday''s, a sent one or a push');
select pg_temp.as_member('admin1');
select throws_ok($$ select * from public.emails_held_today() $$, 'P0001', null, 'an Admin is refused');
select pg_temp.as_member('staff1');
select throws_ok($$ select * from public.emails_held_today() $$, 'P0001', null, 'Staff are refused');
select pg_temp.as_system();
select ok(not has_function_privilege('anon', 'public.emails_held_today()', 'execute'), 'anon cannot call it');

-- 4. Signed out, and an inactive member ------------------------------------------------------------
select pg_temp.as_system();
update public.members set status = 'deactivated', deactivated_at = now() where id = pg_temp.fx('admin2');
select pg_temp.as_member('admin2');
select throws_ok($$ select * from public.dashboard_unreachable() $$, 'P0001', null, 'a deactivated Admin is refused');
select throws_ok($$ select * from public.dashboard_not_noted() $$, 'P0001', null, 'and refused the Owner''s rows');
select throws_ok($$ select * from public.emails_held_today() $$, 'P0001', null, 'and the held emails');
select pg_temp.as_system();

-- 5. No table changed hands ------------------------------------------------------------------------
select ok(not has_table_privilege('authenticated', 'public.task_reminder_arms', 'select'),
  'task_reminder_arms is still unreadable by the API');
select ok(not has_table_privilege('authenticated', 'public.member_reachability', 'select'),
  'member_reachability is still unreadable by the API');
select ok(not has_table_privilege('authenticated', 'public.notification_deliveries', 'select'),
  'notification_deliveries is still unreadable by the API');
select is((select prosecdef from pg_proc where oid = 'public.dashboard_not_noted()'::regprocedure), true,
  'dashboard_not_noted is security definer');
select is((select prosecdef from pg_proc where oid = 'public.dashboard_unreachable()'::regprocedure)
          and (select prosecdef from pg_proc where oid = 'public.emails_held_today()'::regprocedure), true,
  'and so are the other two');
select ok((select provolatile from pg_proc where oid = 'public.dashboard_unreachable()'::regprocedure) = 's'
          and (select provolatile from pg_proc where oid = 'public.dashboard_not_noted()'::regprocedure) = 's'
          and (select provolatile from pg_proc where oid = 'public.emails_held_today()'::regprocedure) = 's',
  'all three are stable reads');

select * from finish();
rollback;
