-- v1.9 W7 On hold, the database (owner 2026-10-23, 29 Oct, 2 Nov; migration on_hold; ADR-0016; WORKFLOWS
-- §3.1a, §5.5, §8, §9): task_hold / task_resume and project_hold / project_resume_list / project_resume /
-- client_work_on_hold for each role (the Owner, the creator Admin, another Admin, the client's Admin, a Crew
-- assignee, Crew not on it, a freelancer's coordinator, a deactivated member, anon), every path (hold, a
-- second hold refused, resume before and after the deadline, a resume without the required new date
-- refused, a held project's resume with its dates and carry choices), the freeze (no Start, Done, tick,
-- Remind, Mark done, carry or new cycle while held), the jobs at explicit instants (reminders_tick,
-- cycle_generate, client_work_alerts, cycle_close_prompt) and the reads that count overdue, and who is
-- notified for each actor. Every name here is neutral.
begin;
create extension if not exists pgtap with schema extensions;
select plan(196);

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
  ('owner',    '00000000-0000-4000-8000-000000127001'),
  ('admin',    '00000000-0000-4000-8000-000000127002'),
  ('admin2',   '00000000-0000-4000-8000-000000127003'),
  ('staff',    '00000000-0000-4000-8000-000000127004'),
  ('staff2',   '00000000-0000-4000-8000-000000127005'),
  ('staff3',   '00000000-0000-4000-8000-000000127006'),
  ('free1',    '00000000-0000-4000-8000-000000127007'),
  ('gone',     '00000000-0000-4000-8000-000000127008'),
  ('client_a', '00000000-0000-4000-8000-0000001270a1'),
  ('client_b', '00000000-0000-4000-8000-0000001270b1');
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
-- A task made by `by`, its first assignee primary, due in three days.
create function pg_temp.mk(k text, by text, assignees text[], approver text default null) returns uuid
language plpgsql as $$
declare
  v_id uuid;
begin
  perform pg_temp.as_member(by);
  v_id := public.task_create(
    title => initcap(k), description => null, task_type_id => pg_temp.fx('type'), client_id => null,
    priority => 'medium', due_at => now() + interval '3 days',
    assignee_ids => array(select pg_temp.fx(a) from unnest(assignees) a),
    primary_owner_id => pg_temp.fx(assignees[1]),
    approving_admin_id => case when approver is null then null else pg_temp.fx(approver) end,
    stages => array['Cut']);
  insert into fx values (k, v_id);
  perform pg_temp.as_system();
  return v_id;
end;
$$;
create function pg_temp.task(k text) returns public.tasks language sql stable security definer as $$
  select t from public.tasks t where t.id = pg_temp.fx(k);
$$;
create function pg_temp.project(k text) returns public.projects language sql stable security definer as $$
  select p from public.projects p where p.id = pg_temp.fx(k);
$$;
create function pg_temp.item(k text) returns public.project_items language sql stable security definer as $$
  select i from public.project_items i where i.id = pg_temp.fx(k);
$$;
-- Notifications of a kind to a member about an entity (any entity when null).
create function pg_temp.n(who text, kind text, about text default null) returns integer language sql stable security definer as $$
  select count(*)::integer from public.notifications x
  where x.recipient_id = pg_temp.fx(who) and x.kind = $2 and (about is null or x.entity_id = pg_temp.fx(about));
$$;
create function pg_temp.armed(k text, kind text) returns integer language sql stable security definer as $$
  select count(*)::integer from public.task_reminders r
  where r.task_id = pg_temp.fx(k) and r.kind = $2 and r.sent_at is null and r.cancelled_at is null;
$$;
create function pg_temp.entries(p_entity text, p_action text, k text) returns integer language sql stable security definer as $$
  select count(*)::integer from public.activity_log a where a.entity = p_entity and a.action = p_action and a.entity_id = pg_temp.fx(k);
$$;
create function pg_temp.last_entry(p_entity text, p_action text, k text) returns public.activity_log language sql stable security definer as $$
  select a from public.activity_log a where a.entity = p_entity and a.action = p_action and a.entity_id = pg_temp.fx(k)
  order by a.id desc limit 1;
$$;
create function pg_temp.citem(c uuid, t text) returns uuid language sql stable security definer as $$
  select i.id from public.project_items i where i.cycle_id = c and i.title = t order by i.position collate "C" limit 1;
$$;
-- 08:05 IST tomorrow: the morning window of the client-work jobs.
create function pg_temp.tomorrow_morning() returns timestamptz language sql stable as $$
  select ((app.today_ist() + 1)::timestamp + time '08:05') at time zone 'Asia/Kolkata';
$$;
-- 00:05 IST on the first of next month: the nightly cycle_generate making next month.
create function pg_temp.next_month_night() returns timestamptz language sql stable as $$
  select ((app.period_start('monthly', app.today_ist()) + interval '1 month')::date::timestamp + time '00:05')
         at time zone 'Asia/Kolkata';
$$;
create function pg_temp.next_month() returns date language sql stable as $$
  select (app.period_start('monthly', app.today_ist()) + interval '1 month')::date;
$$;

insert into auth.users (id, email) select id, key || '@example.com' from fx where key not in ('org', 'free1') and key not like 'client_%';
insert into public.members (id, org_id, full_name, email, role, status, joined_at)
select pg_temp.fx(k), pg_temp.fx('org'), initcap(k), k || '@example.com', r::public.member_role, 'active', now() - interval '60 days'
from (values ('owner', 'owner'), ('admin', 'admin'), ('admin2', 'admin'), ('staff', 'staff'),
             ('staff2', 'staff'), ('staff3', 'staff')) as v(k, r);
insert into public.members (id, org_id, full_name, email, role, status, joined_at, engagement)
values (pg_temp.fx('free1'), pg_temp.fx('org'), 'Free1', null, 'staff', 'active', now() - interval '60 days', 'freelance');
insert into public.member_coordinators (member_id, coordinator_id) values (pg_temp.fx('free1'), pg_temp.fx('staff3'));
insert into public.members (id, org_id, full_name, email, role, status, joined_at, deactivated_at)
values (pg_temp.fx('gone'), pg_temp.fx('org'), 'Gone', 'gone@example.com', 'admin', 'deactivated',
        now() - interval '60 days', now() - interval '1 day');
insert into public.task_types (org_id, name, kind, shows_on_calendar, has_location, position)
values (pg_temp.fx('org'), 'Type 127', 'normal', false, false, 'z127');
insert into fx select 'type', id from public.task_types where org_id = pg_temp.fx('org') and name = 'Type 127';
update public.org_settings set default_task_reminders = '[{"before": 1, "unit": "days"}]', ack_repeat_hours = 2,
  ack_escalate_hours = 4, ack_escalate_owner_hours = 8, overdue_escalate_hours = 24
where org_id = pg_temp.fx('org');
insert into public.clients (id, org_id, name, state, admin_id, activated_at) values
  (pg_temp.fx('client_a'), pg_temp.fx('org'), 'Client A', 'active', pg_temp.fx('admin'),  now() - interval '90 days'),
  (pg_temp.fx('client_b'), pg_temp.fx('org'), 'Client B', 'active', pg_temp.fx('admin2'), now() - interval '90 days');

-- ===========================================================================================================
-- 0. The columns, the kinds, the functions
-- ===========================================================================================================
select has_column('public', 'tasks', 'held_at', 'tasks.held_at');
select has_column('public', 'tasks', 'hold_reason', 'tasks.hold_reason');
select has_column('public', 'tasks', 'resumed_at', 'tasks.resumed_at');
select has_column('public', 'projects', 'held_at', 'projects.held_at');
select has_column('public', 'projects', 'hold_reason', 'projects.hold_reason');
select ok(not exists (select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid
                      where t.typname in ('task_state', 'project_state', 'item_state') and e.enumlabel like '%hold%'),
  'On hold is no state value (ADR-0016): every enum stays as it was');
select is((select array_agg(kind order by kind) from public.notification_kinds
           where kind in ('task_held', 'task_resumed', 'project_held', 'project_resumed')
             and not actionable and not always_email and in_app),
  array['project_held', 'project_resumed', 'task_held', 'task_resumed'],
  'the four kinds: in-app and push, never email');
select ok((select bool_and(has_function_privilege('authenticated', p.oid, 'execute')
                           and not has_function_privilege('anon', p.oid, 'execute')
                           and p.prosecdef and p.proconfig @> array['search_path=""'])
           from pg_proc p where p.pronamespace = 'public'::regnamespace
             and p.proname in ('task_hold', 'task_resume', 'project_hold', 'project_resume', 'project_resume_list')),
  'the five: authenticated, never anon; SECURITY DEFINER with an empty search_path');
select ok(has_function_privilege('authenticated', 'public.client_work_on_hold(date, date)', 'execute')
          and not has_function_privilege('anon', 'public.client_work_on_hold(date, date)', 'execute')
          and not (select prosecdef from pg_proc where oid = 'public.client_work_on_hold(date, date)'::regprocedure),
  'client_work_on_hold: security invoker (RLS), authenticated only');
select ok(not has_function_privilege('authenticated', 'app.on_hold_guard()', 'execute')
          and not has_function_privilege('authenticated', 'app.project_resume_items(uuid, date)', 'execute'),
  'the guard and the resume rule are internal');
select ok(not has_table_privilege('authenticated', 'public.tasks', 'update')
          and not has_table_privilege('authenticated', 'public.projects', 'update'),
  'the API role still writes neither table');

-- ===========================================================================================================
-- 1. Tasks: who holds, with a reason
-- ===========================================================================================================
select pg_temp.mk('ta', 'admin', array['staff', 'free1']);
select pg_temp.mk('tb', 'admin', array['staff', 'free1']);
select pg_temp.mk('to', 'owner', array['staff'], 'admin2');
select pg_temp.mk('tx', 'admin', array['staff']);
select pg_temp.mk('ts', 'admin', array['staff']);
select pg_temp.mk('tp', 'admin', array['staff']);
select pg_temp.mk('tz', 'admin', array['staff']);
delete from public.notifications;

select pg_temp.as_anon();
select throws_ok($$ select public.task_hold(pg_temp.fx('ta'), 'x') $$, '42501', null, 'anon: no privilege');
select pg_temp.as_member('gone');
select is(pg_temp.code($$ select public.task_hold(pg_temp.fx('ta'), 'x') $$), 'UNAUTHENTICATED', 'a deactivated member: UNAUTHENTICATED');
select pg_temp.as_member('staff2');
select is(pg_temp.code($$ select public.task_hold(pg_temp.fx('ta'), 'x') $$), 'NOT_FOUND', 'Crew not on it: NOT_FOUND');
select pg_temp.as_member('staff');
select is(pg_temp.code($$ select public.task_hold(pg_temp.fx('ta'), 'x') $$), 'FORBIDDEN', 'a Crew assignee: FORBIDDEN');
select pg_temp.as_member('staff3');
select is(pg_temp.code($$ select public.task_hold(pg_temp.fx('ta'), 'x') $$), 'FORBIDDEN', 'a freelancer''s coordinator: FORBIDDEN');
select pg_temp.as_member('admin2');
select is(pg_temp.code($$ select public.task_hold(pg_temp.fx('ta'), 'x') $$), 'NOT_FOUND', 'another Admin: NOT_FOUND');
select is(pg_temp.code($$ select public.task_hold(pg_temp.fx('to'), 'x') $$), 'FORBIDDEN',
  'the approving Admin who did not create it: FORBIDDEN');
select pg_temp.as_member('admin');
select is(pg_temp.code($$ select public.task_hold(pg_temp.fx('ta'), '   ') $$), 'REASON_REQUIRED', 'a reason is required');
select is(pg_temp.code(format($$ select public.task_hold(pg_temp.fx('ta'), %L) $$, repeat('x', 1001))), 'VALIDATION',
  'a reason over 1000 characters: VALIDATION');
select pg_temp.as_system();
select is((pg_temp.task('ta')).held_at, null, 'the refusals held nothing');
select is(pg_temp.n('staff', 'task_held'), 0, 'and told nobody');

select pg_temp.as_member('admin');
select ok(public.task_hold(pg_temp.fx('ta'), '  Client hasn''t sent the footage ') is not null, 'the creator Admin holds the task');
select pg_temp.as_system();
select is((pg_temp.task('ta')).hold_reason, 'Client hasn''t sent the footage', 'the reason is kept, trimmed');
select is((pg_temp.task('ta')).held_by, pg_temp.fx('admin'), 'by whom');
select is((pg_temp.task('ta')).state, 'todo'::public.task_state, 'the state stays (it resumes to it)');
select is((pg_temp.last_entry('tasks', 'held', 'ta')).meta ->> 'reason', 'Client hasn''t sent the footage',
  'History: one ''held'' entry with the reason');
select is(pg_temp.n('staff', 'task_held', 'ta'), 1, 'the Crew assignee is told quietly');
select is(pg_temp.n('staff3', 'task_held', 'ta'), 1, 'the freelancer''s notice goes to their coordinator');
select ok((select title like '% · for Free1' from public.notifications where recipient_id = pg_temp.fx('staff3') and kind = 'task_held'),
  'worded for them');
select is(pg_temp.n('owner', 'task_held'), 0, 'an Admin holding their own task tells the Owner nothing');
select is(pg_temp.n('admin', 'task_held'), 0, 'and never the actor');
select is((select count(*)::integer from public.notification_deliveries d join public.notifications x on x.id = d.notification_id
           where x.kind = 'task_held' and d.channel <> 'push'), 0, 'push only: no email delivery');
select pg_temp.as_member('admin');
select is(pg_temp.code($$ select public.task_hold(pg_temp.fx('ta'), 'again') $$), 'INVALID_STATE', 'a second hold: INVALID_STATE');

select pg_temp.as_member('owner');
select ok(public.task_hold(pg_temp.fx('tx'), 'Waiting for the client') is not null, 'the Owner holds an Admin''s task');
select is(pg_temp.n('admin', 'task_held', 'tx'), 1, 'its creator Admin is told');
select is(pg_temp.n('staff', 'task_held', 'tx'), 1, 'and its assignee');
select ok(public.task_hold(pg_temp.fx('to'), 'Owner pause') is not null, 'the Owner holds their own task');
select is(pg_temp.n('admin2', 'task_held', 'to'), 0, 'its approving Admin (not the creator) is not told');
select is(pg_temp.n('staff', 'task_held', 'to'), 1, 'its assignee is');

-- Only a task with its people is held.
select pg_temp.as_member('staff');
select public.task_submit_done(pg_temp.fx('ts'), 'Here it is');
select pg_temp.as_member('admin');
select is(pg_temp.code($$ select public.task_hold(pg_temp.fx('ts'), 'x') $$), 'INVALID_STATE', 'a handed-in task: INVALID_STATE');
select public.task_cancel(pg_temp.fx('tz'), 'Not needed');
select is(pg_temp.code($$ select public.task_hold(pg_temp.fx('tz'), 'x') $$), 'INVALID_STATE', 'a cancelled task: INVALID_STATE');
select pg_temp.as_system();
select throws_ok($$ update public.tasks set held_at = now(), held_by = pg_temp.fx('admin'), hold_reason = 'x' where id = pg_temp.fx('ts') $$,
  '23514', null, 'the check: only a task with its people is held');
select throws_ok($$ update public.tasks set held_at = now() where id = pg_temp.fx('tb') $$,
  '23514', null, 'the check: held_at, held_by and the reason go together');

-- ===========================================================================================================
-- 2. A held task is frozen and its clocks stop
-- ===========================================================================================================
select pg_temp.as_member('staff');
select is(pg_temp.code($$ select public.task_start(pg_temp.fx('ta')) $$), 'INVALID_STATE', 'no Start while held');
select is(pg_temp.code($$ select public.task_submit_done(pg_temp.fx('ta'), 'done') $$), 'INVALID_STATE', 'no Done while held');
select is(pg_temp.code($$ update public.task_stages set done_at = now(), done_by = pg_temp.fx('staff') where task_id = pg_temp.fx('ta') $$),
  'INVALID_STATE', 'no stage tick while held');
select lives_ok($$ select public.task_acknowledge(pg_temp.fx('ta')) $$, 'Task Noted still records receipt');
select pg_temp.as_member('admin');
select is(pg_temp.code($$ select public.task_remind(pg_temp.fx('ta')) $$), 'INVALID_STATE', 'no Remind about a held task');
select pg_temp.as_system();
select is(pg_temp.armed('ta', 'before_due') + pg_temp.armed('ta', 'overdue') + pg_temp.armed('ta', 'overdue_escalation'), 0,
  'the hold cancelled every unsent deadline reminder');
select is(pg_temp.armed('tb', 'before_due') + pg_temp.armed('tb', 'overdue') + pg_temp.armed('tb', 'overdue_escalation'), 3,
  'the task beside it keeps its three');

-- reminders_tick a day past the deadline (+ 5 minutes): the escalations and the not-noted ones go for the
-- open task, nothing for the held one.
select ok(app.reminders_tick((pg_temp.task('tb')).due_at + interval '24 hours 5 minutes') >= 0, 'reminders_tick at an explicit instant');
select is(pg_temp.n('admin', 'escalation_overdue', 'tb'), 1, 'the open task: the overdue escalation to its Admin');
select is(pg_temp.n('owner', 'escalation_overdue', 'tb'), 1, 'and to the Owner');
select is(pg_temp.n('admin', 'escalation_not_noted', 'tb'), 1, 'and the not-noted escalation');
select is((select count(*)::integer from public.notifications x where x.entity_id = pg_temp.fx('ta')
           and x.kind not in ('task_held', 'task_assigned')), 0, 'the held task: no reminder, repeat or escalation at all');
select is((select count(*)::integer from public.notifications x where x.entity_id in (pg_temp.fx('tx'), pg_temp.fx('to'))
           and x.kind not in ('task_held', 'task_assigned')), 0, 'nor the other two held tasks');

-- The reads that count overdue (the end-of-day report, the digest) leave it out.
select ok((select bool_and(e ->> 'id' <> pg_temp.fx('ta')::text)
           from jsonb_array_elements(app.eod_report_payload(pg_temp.fx('org'), app.today_ist(), now() + interval '5 days')
                                       #> '{tasks,overdue,items}') e)
          and exists (select 1 from jsonb_array_elements(app.eod_report_payload(pg_temp.fx('org'), app.today_ist(), now() + interval '5 days')
                                       #> '{tasks,overdue,items}') e where e ->> 'id' = pg_temp.fx('tb')::text),
  'the end-of-day report''s overdue now: the open task, never the held one');
select is((app.owner_digest_payload(pg_temp.fx('org'), now() + interval '5 days') #>> '{tasks,overdue}')::integer,
  (select count(*)::integer from public.tasks t where t.state not in ('completed', 'cancelled') and t.held_at is null
     and t.due_at < now() + interval '5 days'),
  'the digest''s overdue count leaves the held tasks out');
select pg_temp.as_member('staff');
select is((select not_noted from public.task_counts()),
  (select count(distinct t.id)::integer from public.tasks t join public.task_assignees a on a.task_id = t.id
   where a.member_id = pg_temp.fx('staff') and a.removed_at is null and a.acknowledged_at is null
     and t.state not in ('completed', 'cancelled') and t.held_at is null),
  'the Tasks badge counts no held task');
select pg_temp.as_system();

-- The acknowledgement clock starts again at the resume: two tasks noted by nobody for ten days.
select pg_temp.mk('tc', 'admin', array['staff']);
select pg_temp.mk('td', 'admin', array['staff']);
update public.task_assignees set assigned_at = now() - interval '10 days' where task_id in (pg_temp.fx('tc'), pg_temp.fx('td'));
update public.task_reminder_arms set armed_at = now() - interval '10 days' where task_id in (pg_temp.fx('tc'), pg_temp.fx('td'));
select pg_temp.as_member('admin');
select ok(public.task_hold(pg_temp.fx('tc'), 'Paused') is not null, 'hold the first');
select pg_temp.as_member('owner');
select is((select count(*)::integer from public.dashboard_not_noted() d where d.task_id = pg_temp.fx('tc')), 0,
  'the Owner''s not-noted risks leave the held task out');
select is((select count(*)::integer from public.dashboard_not_noted() d where d.task_id = pg_temp.fx('td')), 1,
  'and keep the open one');

-- Cancel ends a hold.
select pg_temp.as_member('owner');
select is(public.task_cancel(pg_temp.fx('to'), 'Dropped'), 'cancelled'::public.task_state, 'a held task can be cancelled');
select pg_temp.as_system();
select is((pg_temp.task('to')).held_at, null, 'the cancel ends the hold');
select ok((pg_temp.last_entry('tasks', 'cancelled', 'to')).diff -> 'old' ? 'held_at', 'its history shows the hold cleared');

-- ===========================================================================================================
-- 3. Tasks: Resume
-- ===========================================================================================================
select pg_temp.as_member('staff');
select is(pg_temp.code($$ select public.task_resume(pg_temp.fx('ta')) $$), 'FORBIDDEN', 'Crew: FORBIDDEN');
select pg_temp.as_member('admin2');
select is(pg_temp.code($$ select public.task_resume(pg_temp.fx('ta')) $$), 'NOT_FOUND', 'another Admin: NOT_FOUND');
select pg_temp.as_member('admin');
select is(pg_temp.code($$ select public.task_resume(pg_temp.fx('tb')) $$), 'INVALID_STATE', 'a task not on hold: INVALID_STATE');
select pg_temp.as_system();
delete from public.notifications;
select pg_temp.as_member('admin');
select is(public.task_resume(pg_temp.fx('ta')), (pg_temp.task('tb')).due_at,
  'before the deadline it simply resumes, keeping its deadline');
select pg_temp.as_system();
select is((pg_temp.task('ta')).held_at, null, 'no longer held');
select ok((pg_temp.task('ta')).resumed_at is not null, 'resumed_at stamped');
select is((pg_temp.task('ta')).state, 'todo'::public.task_state, 'in the state it had');
select is((pg_temp.last_entry('tasks', 'resumed', 'ta')).meta ->> 'reason', 'Client hasn''t sent the footage',
  'History: ''resumed'', with the hold it ended');
select is(pg_temp.armed('ta', 'before_due') + pg_temp.armed('ta', 'overdue') + pg_temp.armed('ta', 'overdue_escalation'), 3,
  'its reminders are armed again');
select is(pg_temp.n('staff', 'task_resumed', 'ta'), 1, 'the assignee is told');
select is(pg_temp.n('staff3', 'task_resumed', 'ta'), 1, 'and the freelancer''s coordinator');
select is(pg_temp.n('owner', 'task_resumed'), 0, 'the Owner is not (an Admin''s own task)');
select pg_temp.as_member('staff');
select is(public.task_start(pg_temp.fx('ta')), 'in_progress'::public.task_state, 'work goes on after the resume');

-- After the deadline: a new one is required.
select pg_temp.as_system();
update public.tasks set due_at = now() - interval '2 hours' where id = pg_temp.fx('tp');
select pg_temp.as_member('admin');
select ok(public.task_hold(pg_temp.fx('tp'), 'Footage late') is not null, 'a task past its deadline is held');
select is(pg_temp.code($$ select public.task_resume(pg_temp.fx('tp')) $$), 'VALIDATION',
  'resumed without a new deadline: VALIDATION');
select is(pg_temp.code($$ select public.task_resume(pg_temp.fx('tp'), now() - interval '1 minute') $$), 'VALIDATION',
  'a new deadline in the past: VALIDATION');
select pg_temp.as_system();
select ok((pg_temp.task('tp')).held_at is not null, 'the refused resumes left it held');
select pg_temp.as_member('admin');
select is(public.task_resume(pg_temp.fx('tp'), now() + interval '2 days'), now() + interval '2 days',
  'with a new deadline it resumes');
select pg_temp.as_system();
select is((pg_temp.task('tp')).due_at, now() + interval '2 days', 'the new deadline is in force');
select is((pg_temp.last_entry('tasks', 'resumed', 'tp')).diff #>> '{old,due_at}' is not null
          and (pg_temp.last_entry('tasks', 'resumed', 'tp')).diff #>> '{new,due_at}' is not null, true,
  'History keeps the old and the new deadline');
select is((pg_temp.last_entry('tasks', 'resumed', 'tp')).meta ->> 'deadline_passed', 'true', 'and that it had passed');
select ok((select body like 'New deadline:%' from public.notifications
           where recipient_id = pg_temp.fx('staff') and kind = 'task_resumed' and entity_id = pg_temp.fx('tp')),
  'the assignee''s notice names the new deadline');

-- The Owner resuming an Admin's task tells its creator.
select pg_temp.as_member('owner');
select ok(public.task_resume(pg_temp.fx('tx')) is not null, 'the Owner resumes an Admin''s task');
select is(pg_temp.n('admin', 'task_resumed', 'tx'), 1, 'its creator Admin is told');

-- The acknowledgement clock: the held-then-resumed task waits a full threshold from the resume.
select pg_temp.as_member('admin');
select ok(public.task_resume(pg_temp.fx('tc')) is not null, 'resume the not-noted task');
select pg_temp.as_system();
select ok(app.reminders_tick(now() + interval '1 hour') >= 0, 'reminders_tick an hour later');
select is(pg_temp.n('admin', 'escalation_not_noted', 'tc'), 0, 'the resumed task: no not-noted escalation yet');
select is(pg_temp.n('admin', 'escalation_not_noted', 'td'), 1, 'the one never held: escalated (ten days)');
select pg_temp.as_member('owner');
select is((select count(*)::integer from public.dashboard_not_noted() d where d.task_id = pg_temp.fx('tc')), 0,
  'and not on the Owner''s risks (the clock started again)');
select pg_temp.as_system();
select ok(app.reminders_tick(now() + interval '4 hours 5 minutes') >= 0, 'reminders_tick past the threshold from the resume');
select is(pg_temp.n('admin', 'escalation_not_noted', 'tc'), 1, 'now it is escalated');

-- ===========================================================================================================
-- 4. Projects: the data
-- ===========================================================================================================
select pg_temp.as_member('admin');
insert into fx values ('pm', public.project_create(pg_temp.fx('client_a'), 'Held Work', 'monthly', null, null,
  array['Shoot', 'Edit'], array['D1', 'D2', 'D3', 'D4', 'D5']));
insert into fx values ('pk', public.project_create(pg_temp.fx('client_a'), 'Kept Work', 'monthly', null, null,
  array['Shoot', 'Edit'], array['K1', 'K2']));
insert into fx values ('po', public.project_create(pg_temp.fx('client_a'), 'Held Once', 'one_time', null, app.today_ist() + 10,
  array['Shoot'], array['O1', 'O2']));
insert into fx values ('pq', public.project_create(pg_temp.fx('client_a'), 'Kept Once', 'one_time', null, app.today_ist() + 10,
  array['Shoot'], array['Q1']));
select pg_temp.as_member('admin2');
insert into fx values ('pb', public.project_create(pg_temp.fx('client_b'), 'Other Work', 'monthly', null, null,
  array['Shoot'], array['B1']));
select pg_temp.as_system();
insert into fx select 'cur', c.id from public.project_cycles c
  where c.project_id = pg_temp.fx('pm') and c.period_start = app.period_start('monthly', app.today_ist());
insert into fx select 'kcur', c.id from public.project_cycles c
  where c.project_id = pg_temp.fx('pk') and c.period_start = app.period_start('monthly', app.today_ist());
insert into fx select 'past', (app.cycle_create(pg_temp.project('pm'),
  app.period_start('monthly', app.period_start('monthly', app.today_ist()) - 1), 'schedule', pg_temp.fx('owner'), true)).id;
insert into fx select 'kpast', (app.cycle_create(pg_temp.project('pk'),
  app.period_start('monthly', app.period_start('monthly', app.today_ist()) - 1), 'schedule', pg_temp.fx('owner'), true)).id;
insert into fx select 'c' || n, pg_temp.citem(pg_temp.fx('cur'), 'D' || n) from generate_series(1, 5) n;
insert into fx select 'q' || n, pg_temp.citem(pg_temp.fx('past'), 'D' || n) from generate_series(1, 5) n;
insert into fx values ('k1', pg_temp.citem(pg_temp.fx('kcur'), 'K1'));
insert into fx select 'o' || n, (select i.id from public.project_items i
  where i.project_id = pg_temp.fx('po') and i.title = 'O' || n) from generate_series(1, 2) n;
select pg_temp.as_member('admin');
select public.item_update(pg_temp.fx('c1'), jsonb_build_object('planned_date', app.today_ist() - 2));
select public.item_update(pg_temp.fx('c2'), jsonb_build_object('planned_date', app.today_ist() + 5));
select public.item_update(pg_temp.fx('k1'), jsonb_build_object('planned_date', app.today_ist() - 2));
select public.item_update(pg_temp.fx('o1'), jsonb_build_object('planned_date', app.today_ist() - 1));
select public.item_update(pg_temp.fx('q4'), jsonb_build_object('planned_date',
  app.period_start('monthly', app.period_start('monthly', app.today_ist()) - 1) + 3));
select public.cycle_carry_decide(array[pg_temp.fx('q4')], 'leave_pending');
select public.item_mark_done(pg_temp.fx('c5'));
select pg_temp.as_system();
-- Both one-time projects past their delivery date (the E3 case).
update public.projects set delivery_date = app.today_ist() - 1 where id in (pg_temp.fx('po'), pg_temp.fx('pq'));
delete from public.notifications;

-- ===========================================================================================================
-- 5. Projects: who holds, with a reason
-- ===========================================================================================================
select pg_temp.as_anon();
select throws_ok($$ select public.project_hold(pg_temp.fx('pm'), 'x') $$, '42501', null, 'anon: no privilege');
select pg_temp.as_member('gone');
select is(pg_temp.code($$ select public.project_hold(pg_temp.fx('pm'), 'x') $$), 'UNAUTHENTICATED', 'a deactivated member: UNAUTHENTICATED');
select pg_temp.as_member('staff');
select is(pg_temp.code($$ select public.project_hold(pg_temp.fx('pm'), 'x') $$), 'FORBIDDEN', 'Crew: FORBIDDEN');
select pg_temp.as_member('staff3');
select is(pg_temp.code($$ select public.project_hold(pg_temp.fx('pm'), 'x') $$), 'FORBIDDEN', 'a freelancer''s coordinator: FORBIDDEN');
select pg_temp.as_member('admin2');
select is(pg_temp.code($$ select public.project_hold(pg_temp.fx('pm'), 'x') $$), 'NOT_FOUND', 'another Admin: NOT_FOUND');
select pg_temp.as_member('admin');
select is(pg_temp.code($$ select public.project_hold(pg_temp.fx('pm'), '') $$), 'REASON_REQUIRED', 'a reason is required');
select ok(public.project_hold(pg_temp.fx('pm'), 'Client paused content for Diwali week') is not null,
  'the client''s Admin holds the project');
select pg_temp.as_system();
select is((pg_temp.project('pm')).hold_reason, 'Client paused content for Diwali week', 'with its reason');
select is((pg_temp.project('pm')).state, 'in_progress'::public.project_state, 'its state stays');
select is((pg_temp.last_entry('projects', 'held', 'pm')).meta ->> 'reason', 'Client paused content for Diwali week',
  'History: ''held'' with the reason');
select is(pg_temp.n('owner', 'project_held'), 0, 'an Admin holding their own project tells nobody');
select pg_temp.as_member('admin');
select is(pg_temp.code($$ select public.project_hold(pg_temp.fx('pm'), 'again') $$), 'INVALID_STATE', 'a second hold: INVALID_STATE');
select pg_temp.as_member('owner');
select ok(public.project_hold(pg_temp.fx('po'), 'Owner pause') is not null, 'the Owner holds a project of an Admin''s client');
select is(pg_temp.n('admin', 'project_held', 'po'), 1, 'the client''s Admin is told');
select pg_temp.as_system();
select ok((select body like '%Reason: Owner pause' and link like '/clients/%/projects/%' from public.notifications
           where kind = 'project_held' and recipient_id = pg_temp.fx('admin')), 'naming the reason, opening the project');

-- ===========================================================================================================
-- 6. A held project is frozen and its jobs skip it
-- ===========================================================================================================
select pg_temp.as_member('admin');
select is(pg_temp.code($$ select public.item_mark_done(pg_temp.fx('c2')) $$), 'INVALID_STATE', 'no Mark done while held');
select is(pg_temp.code(format($$ select public.item_stage_tick(%L) $$,
  (select s.id from public.project_item_stage_list s where s.item_id = pg_temp.fx('c2') order by s.position collate "C" limit 1))),
  'INVALID_STATE', 'no stage tick while held');
select is(pg_temp.code($$ select public.item_reopen(pg_temp.fx('c5'), 'again') $$), 'INVALID_STATE', 'no reopen while held');
select is(public.cycle_carry_decide(array[pg_temp.fx('q5')], 'leave_pending') -> 0 ->> 'code', 'INVALID_STATE',
  'no carry decision while held');
select is(public.cycle_carry_decide(array[pg_temp.fx('q5')], 'carry_forward') -> 0 ->> 'code', 'INVALID_STATE',
  'no carry forward either');
select pg_temp.as_system();
select throws_ok(format($$ select app.cycle_create(pg_temp.project('pm'), %L::date, 'manual', pg_temp.fx('admin'), true) $$, pg_temp.next_month()),
  'P0001', 'INVALID_STATE', 'no new cycle while held, whoever makes it');
select pg_temp.as_member('admin');
select lives_ok($$ select public.item_update(pg_temp.fx('c3'), '{"title": "D3 renamed"}'::jsonb) $$, 'edits stay open');
select is(public.item_cancel(pg_temp.fx('c4'), 'Dropped', 'not_needed'), 'cancelled'::public.item_state, 'and so does Close');
select pg_temp.as_system();

-- The nightly cycle_generate on the 1st of next month: the open project gets its cycle, the held one none.
select ok(app.cycle_generate(pg_temp.next_month_night()) >= 1, 'cycle_generate at an explicit night');
select ok(exists (select 1 from public.project_cycles c where c.project_id = pg_temp.fx('pk') and c.period_start = pg_temp.next_month()),
  'the open project gets next month''s cycle');
select ok(not exists (select 1 from public.project_cycles c where c.project_id = pg_temp.fx('pm') and c.period_start = pg_temp.next_month()),
  'the held project gets none');

-- client_work_alerts tomorrow 08:05 IST: E1 for the open project's late deliverable, E3 for the open
-- one-time project; nothing for the held ones.
select ok(app.client_work_alerts(pg_temp.tomorrow_morning()) >= 1, 'client_work_alerts in the morning window');
select is((select count(*)::integer from public.client_work_alerts a where a.kind = 'item_overdue' and a.entity_id = pg_temp.fx('k1')), 1,
  'E1: the open project''s overdue deliverable');
select is((select count(*)::integer from public.client_work_alerts a where a.kind = 'item_overdue'
           and a.entity_id in (pg_temp.fx('c1'), pg_temp.fx('o1'))), 0, 'E1: never a held project''s');
select is((select count(*)::integer from public.client_work_alerts a where a.kind = 'delivery_escalation' and a.entity_id = pg_temp.fx('pq')), 1,
  'E3: the open one-time project past delivery');
select is((select count(*)::integer from public.client_work_alerts a where a.kind = 'delivery_escalation' and a.entity_id = pg_temp.fx('po')), 0,
  'E3: never the held one');

-- cycle_close_prompt the same morning: the open project's ended cycle is prompted, the held one's not.
select ok(app.cycle_close_prompt(pg_temp.tomorrow_morning()) >= 1, 'cycle_close_prompt in the morning window');
select ok((select prompted_at is not null from public.project_cycles where id = pg_temp.fx('kpast')), 'the open project''s ended cycle is prompted');
select ok((select prompted_at is null from public.project_cycles where id = pg_temp.fx('past')), 'the held project''s is not (no end-of-cycle nag)');
select ok((select body not like '%Held Work%' from public.notifications where kind = 'items_to_decide' and recipient_id = pg_temp.fx('admin')),
  'and the prompt does not list it');
update public.project_cycles set prompted_at = now() - interval '3 days' where id = pg_temp.fx('past');
select is((select count(*)::integer from app.cycle_undecided_due(pg_temp.fx('org')) d where d.project_id = pg_temp.fx('pm')), 0,
  'E2: a held project''s ended cycle is never undecided');
select is((select count(*)::integer from app.cycle_undecided_due(pg_temp.fx('org')) d where d.project_id = pg_temp.fx('pk')), 1,
  'the open one''s is');

-- The reads: the Clients list's late count and the reports' On hold count.
select pg_temp.as_member('admin');
select is((select late from public.client_work_summary() where client_id = pg_temp.fx('client_a')), 1,
  'the Clients list counts only the open project''s late deliverable');
select is((select deliverables from public.client_work_on_hold() where project_id = pg_temp.fx('pm')), 8,
  'On hold · n: the held project''s unfinished deliverables (3 open this month, 5 of last month)');
select is((select deliverables from public.client_work_on_hold(app.period_start('monthly', app.today_ist()), app.today_ist())
           where project_id = pg_temp.fx('pm')), 3, 'this month only');
select is((select count(*)::integer from public.client_work_on_hold()), 2, 'the client''s Admin sees their two held projects');
select pg_temp.as_member('owner');
select is((select count(*)::integer from public.client_work_on_hold()), 2, 'the Owner sees every held project');
select pg_temp.as_member('admin2');
select is((select count(*)::integer from public.client_work_on_hold()), 0, 'another Admin sees none of them');
select pg_temp.as_member('staff');
select is((select count(*)::integer from public.client_work_on_hold()), 0, 'Crew see none');
select ok(not exists (select 1 from information_schema.parameters p
                      where p.specific_schema = 'public' and p.specific_name like 'client_work_on_hold%'
                        and p.parameter_name ~ '(amount|value|revenue|fee)'), 'and no money anywhere in it');

-- ===========================================================================================================
-- 7. Projects: the resume list and Resume
-- ===========================================================================================================
select pg_temp.as_member('staff');
select is(pg_temp.code($$ select * from public.project_resume_list(pg_temp.fx('pm')) $$), 'FORBIDDEN', 'the list: Crew FORBIDDEN');
select pg_temp.as_member('admin2');
select is(pg_temp.code($$ select * from public.project_resume_list(pg_temp.fx('pm')) $$), 'NOT_FOUND', 'another Admin NOT_FOUND');
select pg_temp.as_member('admin');
select is((select array_agg(title order by title) from public.project_resume_list(pg_temp.fx('pm'))),
  array['D1', 'D1', 'D2', 'D3', 'D4', 'D5'], 'the list: this month''s late D1 and last month''s five open deliverables');
select is((select needs_date from public.project_resume_list(pg_temp.fx('pm')) where item_id = pg_temp.fx('c1')), true,
  'this month''s late one needs a date');
select is((select count(*)::integer from public.project_resume_list(pg_temp.fx('pm')) where needs_choice and month_ended), 5,
  'last month''s need a carry forward / close / leave pending choice');
select is((select left_pending from public.project_resume_list(pg_temp.fx('pm')) where item_id = pg_temp.fx('q4')), true,
  'one left pending before is listed again');
select ok((select bool_and(carry_forward_allowed) from public.project_resume_list(pg_temp.fx('pm')) where month_ended),
  'carry forward is open (an Active client)');

create temporary table good (v jsonb);
insert into good select jsonb_build_array(
  jsonb_build_object('item_id', pg_temp.fx('c1'), 'planned_date', app.today_ist() + 3),
  jsonb_build_object('item_id', pg_temp.fx('q1'), 'decision', 'carry_forward', 'planned_date', app.today_ist() + 4),
  jsonb_build_object('item_id', pg_temp.fx('q2'), 'decision', 'close', 'reason', 'Client moved it', 'close_kind', 'not_needed'),
  jsonb_build_object('item_id', pg_temp.fx('q3'), 'decision', 'leave_pending'),
  jsonb_build_object('item_id', pg_temp.fx('q4'), 'decision', 'leave_pending', 'planned_date', app.today_ist() + 6),
  jsonb_build_object('item_id', pg_temp.fx('q5'), 'decision', 'carry_forward'));
grant select on good to authenticated;
-- The good list with one entry replaced (null: removed).
create function pg_temp.but(k text, e jsonb) returns jsonb language sql stable as $$
  select coalesce(jsonb_agg(x), '[]'::jsonb) || case when e is null then '[]'::jsonb else jsonb_build_array(e) end
  from good, jsonb_array_elements(good.v) x where x ->> 'item_id' <> pg_temp.fx(k)::text;
$$;

select pg_temp.as_member('staff');
select is(pg_temp.code($$ select public.project_resume(pg_temp.fx('pm'), (select v from good)) $$), 'FORBIDDEN', 'Resume: Crew FORBIDDEN');
select pg_temp.as_member('admin2');
select is(pg_temp.code($$ select public.project_resume(pg_temp.fx('pm'), (select v from good)) $$), 'NOT_FOUND', 'another Admin NOT_FOUND');
select pg_temp.as_member('admin');
select is(pg_temp.code($$ select public.project_resume(pg_temp.fx('pk')) $$), 'INVALID_STATE', 'a project not on hold: INVALID_STATE');
select is(pg_temp.code($$ select public.project_resume(pg_temp.fx('pm')) $$), 'VALIDATION', 'resumed with nothing settled: VALIDATION');
select is(pg_temp.code($$ select public.project_resume(pg_temp.fx('pm'), pg_temp.but('c1', null)) $$), 'VALIDATION',
  'a passed date left without a new one: VALIDATION');
select is(pg_temp.code($$ select public.project_resume(pg_temp.fx('pm'), pg_temp.but('c1', jsonb_build_object('item_id', pg_temp.fx('c1'), 'planned_date', app.today_ist() - 1))) $$),
  'VALIDATION', 'a new date in the past: VALIDATION');
select is(pg_temp.code($$ select public.project_resume(pg_temp.fx('pm'), pg_temp.but('q3', null)) $$), 'VALIDATION',
  'an ended month''s deliverable left undecided: VALIDATION');
select is(pg_temp.code($$ select public.project_resume(pg_temp.fx('pm'), pg_temp.but('q4', jsonb_build_object('item_id', pg_temp.fx('q4'), 'decision', 'leave_pending'))) $$),
  'VALIDATION', 'left pending with its passed date and no new one: VALIDATION');
select is(pg_temp.code($$ select public.project_resume(pg_temp.fx('pm'), pg_temp.but('q2', jsonb_build_object('item_id', pg_temp.fx('q2'), 'decision', 'close'))) $$),
  'REASON_REQUIRED', 'a close without a reason: REASON_REQUIRED');
select is(pg_temp.code($$ select public.project_resume(pg_temp.fx('pm'), pg_temp.but('c1', jsonb_build_object('item_id', pg_temp.fx('c1'), 'decision', 'close', 'reason', 'x'))) $$),
  'VALIDATION', 'a choice for a running month''s deliverable: VALIDATION');
select is(pg_temp.code($$ select public.project_resume(pg_temp.fx('pm'), (select v from good) || jsonb_build_array(jsonb_build_object('item_id', pg_temp.fx('c2'), 'planned_date', app.today_ist() + 9))) $$),
  'VALIDATION', 'a deliverable that needs nothing: VALIDATION');
select is(pg_temp.code($$ select public.project_resume(pg_temp.fx('pm'), (select v from good) || jsonb_build_array(jsonb_build_object('item_id', pg_temp.fx('c1'), 'planned_date', app.today_ist() + 9))) $$),
  'VALIDATION', 'a deliverable listed twice: VALIDATION');
select is(pg_temp.code($$ select public.project_resume(pg_temp.fx('pm'), '[{"item_id": "nope"}]'::jsonb) $$), 'VALIDATION',
  'an entry that is no id: VALIDATION');
select is(pg_temp.code($$ select public.project_resume(pg_temp.fx('pm'), (select v from good), app.today_ist() + 20) $$), 'VALIDATION',
  'a delivery date on a monthly project: VALIDATION');
select pg_temp.as_system();
select ok((pg_temp.project('pm')).held_at is not null and (pg_temp.item('c1')).planned_date = app.today_ist() - 2
          and (pg_temp.item('q1')).state = 'open', 'every refused resume changed nothing');
delete from public.notifications;

select pg_temp.as_member('owner');
select is(public.project_resume(pg_temp.fx('pm'), (select v from good)) - 'resumed_at',
  '{"dates": 3, "carried": 2, "closed": 1, "left_pending": 2}'::jsonb,
  'the Owner resumes with every date and choice in one go');
select pg_temp.as_system();
select is((pg_temp.project('pm')).held_at, null, 'the project is no longer held');
select ok((pg_temp.project('pm')).resumed_at is not null, 'resumed_at stamped');
select is((pg_temp.last_entry('projects', 'resumed', 'pm')).meta ->> 'reason', 'Client paused content for Diwali week',
  'History: ''resumed'', with the hold it ended');
select is((pg_temp.item('c1')).planned_date, app.today_ist() + 3, 'D1 has its new date');
select is((pg_temp.last_entry('project_items', 'update', 'c1')).diff #>> '{old,planned_date}', (app.today_ist() - 2)::text,
  'History keeps D1''s old date');
select is((pg_temp.item('q1')).state, 'carried'::public.item_state, 'last month''s D1 is carried forward');
select is((select i.planned_date from public.project_items i where i.carried_from_item_id = pg_temp.fx('q1')), app.today_ist() + 4,
  'into this month, with the date given');
select is((select i.cycle_id from public.project_items i where i.carried_from_item_id = pg_temp.fx('q5')), pg_temp.fx('cur'),
  'D5 too, with no date');
select is((pg_temp.item('q2')).state, 'cancelled'::public.item_state, 'D2 is closed');
select is((pg_temp.item('q2')).close_kind, 'not_needed', 'with its kind');
select is((pg_temp.item('q3')).carry_decision, 'leave_pending'::public.carry_decision, 'D3 is left pending');
select is((pg_temp.item('q4')).planned_date, app.today_ist() + 6, 'D4 left pending, with its new date');
select is(pg_temp.n('admin', 'project_resumed', 'pm'), 1, 'the Owner''s resume tells the client''s Admin');
select is(pg_temp.n('owner', 'project_resumed'), 0, 'never the actor');
select pg_temp.as_member('admin');
select is((select count(*)::integer from public.project_resume_list(pg_temp.fx('pm'))
           where needs_date or (needs_choice and not left_pending)), 0, 'nothing is left to settle');
select is(public.item_mark_done(pg_temp.fx('c2')), 'approved'::public.item_state, 'work goes on after the resume');

-- After the resume the nightly job makes next month's cycle again.
select pg_temp.as_system();
select ok(app.cycle_generate(pg_temp.next_month_night()) >= 1, 'cycle_generate after the resume');
select ok(exists (select 1 from public.project_cycles c where c.project_id = pg_temp.fx('pm') and c.period_start = pg_temp.next_month()),
  'the resumed project gets next month''s cycle');

-- The one-time project the Owner held: its Admin resumes it with a new date and delivery date.
select pg_temp.as_member('admin');
select is(pg_temp.code($$ select public.project_resume(pg_temp.fx('po'), '[]'::jsonb) $$), 'VALIDATION',
  'the one-time project''s late deliverable needs a date');
select is(pg_temp.code($$ select public.project_resume(pg_temp.fx('po'), jsonb_build_array(jsonb_build_object('item_id', pg_temp.fx('o1'), 'planned_date', app.today_ist() + 2)), app.today_ist() - 1) $$),
  'VALIDATION', 'a delivery date in the past: VALIDATION');
select is(public.project_resume(pg_temp.fx('po'), jsonb_build_array(jsonb_build_object('item_id', pg_temp.fx('o1'), 'planned_date', app.today_ist() + 2)),
  app.today_ist() + 7) ->> 'dates', '1', 'the client''s Admin resumes the Owner''s hold');
select pg_temp.as_system();
select is((pg_temp.project('po')).delivery_date, app.today_ist() + 7, 'with the new delivery date');
select is((pg_temp.last_entry('projects', 'resumed', 'po')).diff #>> '{old,delivery_date}', (app.today_ist() - 1)::text,
  'History keeps the old delivery date');
select is(pg_temp.n('owner', 'project_resumed'), 0, 'an Admin''s resume tells nobody');

-- Cancel ends a project's hold; a completed or cancelled project is never held.
select pg_temp.as_member('owner');
select ok(public.project_hold(pg_temp.fx('pb'), 'Pause') is not null, 'the Owner holds another Admin''s client''s project');
select is(pg_temp.n('admin2', 'project_held', 'pb'), 1, 'that client''s Admin is told');
select is(public.project_cancel(pg_temp.fx('pb'), 'Ended'), 'cancelled'::public.project_state, 'a held project can be cancelled');
select pg_temp.as_system();
select is((pg_temp.project('pb')).held_at, null, 'the cancel ends the hold');
select pg_temp.as_member('owner');
select is(pg_temp.code($$ select public.project_hold(pg_temp.fx('pb'), 'x') $$), 'INVALID_STATE', 'a cancelled project: INVALID_STATE');
select pg_temp.as_system();
select throws_ok($$ update public.projects set held_at = now(), held_by = pg_temp.fx('owner'), hold_reason = 'x' where id = pg_temp.fx('pb') $$,
  '23514', null, 'the check: only an open or in-progress project is held');

-- The project's history describes both entries (app.client_work_activity_shown).
select ok(app.client_work_activity_shown('projects', 'held', '{}'::jsonb) and app.client_work_activity_shown('projects', 'resumed', '{}'::jsonb),
  'the history shows a hold and a resume');

select * from finish();
rollback;
