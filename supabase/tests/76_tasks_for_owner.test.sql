-- 6b.2 Tasks for the Owner (owner 2026-10-07; migration tasks_for_owner; WORKFLOWS §3.1 "Tasks for the
-- Owner", §9; PERMISSIONS §3). The Owner on a task, assigned by the Owner and by an Admin, never by Crew;
-- Task Noted; Done by the Owner as primary owner completes at once, Done by a Crew primary routes as
-- before; Crew off the task read nothing of it; Remind for the Owner, the creator and the approving
-- Admin, refused to everyone else, refused within the hour and allowed after; no escalation about the
-- Owner (armed, sent, the Today risk rows); member_availability() answers for the Owner (Busy); and a
-- task made the way they are today keeps every row unchanged. Neutral names only.
begin;
create extension if not exists pgtap with schema extensions;
select plan(58);

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
delete from auth.users;
delete from public.holidays;

create temporary table fx (key text primary key, id uuid not null);
insert into fx values
  ('owner',  '00000000-0000-4000-8000-000000007601'),
  ('admin1', '00000000-0000-4000-8000-000000007602'),
  ('admin2', '00000000-0000-4000-8000-000000007603'),
  ('staff1', '00000000-0000-4000-8000-000000007604'),
  ('staff2', '00000000-0000-4000-8000-000000007605'),
  ('staff3', '00000000-0000-4000-8000-000000007606');
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
-- A task made by `by`: assignees by key, the first one primary unless `primary_key` says otherwise.
create function pg_temp.mk(k text, by text, assignees text[], primary_key text default null,
                           approver text default null, type_key text default 'normal',
                           event_day date default null, event_start timestamptz default null) returns uuid
language plpgsql as $$
declare
  v_id uuid;
begin
  perform pg_temp.as_member(by);
  v_id := public.task_create(
    title => initcap(k), description => null, task_type_id => pg_temp.fx(type_key), client_id => null,
    priority => 'medium', due_at => now() + interval '3 days',
    assignee_ids => array(select pg_temp.fx(a) from unnest(assignees) a),
    primary_owner_id => pg_temp.fx(coalesce(primary_key, assignees[1])),
    approving_admin_id => case when approver is null then null else pg_temp.fx(approver) end,
    event_date => event_day, event_start_at => event_start);
  insert into fx values (k, v_id);
  perform pg_temp.as_system();
  return v_id;
end;
$$;
create function pg_temp.n(who text, kind text, task text) returns bigint language sql stable as $$
  select count(*) from public.notifications x
  where x.recipient_id = pg_temp.fx(who) and x.kind = $2 and x.entity_id = pg_temp.fx($3);
$$;
create function pg_temp.armed(k text, kind text) returns bigint language sql stable as $$
  select count(*) from public.task_reminders r
  where r.task_id = pg_temp.fx(k) and r.kind = $2 and r.sent_at is null and r.cancelled_at is null;
$$;
-- Every row of a task as text: the task, its people, its schedule (what "unchanged" is measured on).
create function pg_temp.rows_of(k text) returns text language sql stable as $$
  select md5(coalesce((select row_to_json(t)::text from public.tasks t where t.id = pg_temp.fx(k)), '')
    || coalesce((select string_agg(row_to_json(a)::text, '|' order by a.member_id) from public.task_assignees a where a.task_id = pg_temp.fx(k)), '')
    || coalesce((select string_agg(row_to_json(r)::text, '|' order by r.id) from public.task_reminders r where r.task_id = pg_temp.fx(k)), ''));
$$;
grant execute on function pg_temp.fx(text) to authenticated, anon;

insert into auth.users (id, email) select id, key || '@example.com' from fx where key <> 'org';
insert into public.members (id, org_id, full_name, email, role, status, joined_at)
select pg_temp.fx(k), pg_temp.fx('org'), initcap(k), k || '@example.com', r::public.member_role, 'active', now() - interval '60 days'
from (values ('owner', 'owner'), ('admin1', 'admin'), ('admin2', 'admin'), ('staff1', 'staff'),
             ('staff2', 'staff'), ('staff3', 'staff')) as v(k, r);
insert into public.task_types (org_id, name, kind, shows_on_calendar, has_location, position)
values (pg_temp.fx('org'), 'Type 76 A', 'normal', false, false, 'z76a'),
       (pg_temp.fx('org'), 'Type 76 B', 'event', true, false, 'z76b');
insert into fx select 'normal', id from public.task_types where org_id = pg_temp.fx('org') and name = 'Type 76 A';
insert into fx select 'event', id from public.task_types where org_id = pg_temp.fx('org') and name = 'Type 76 B';
update public.org_settings set default_task_reminders = '[]', ack_repeat_hours = 2, ack_escalate_hours = 4,
  ack_escalate_owner_hours = 8, overdue_escalate_hours = 24
where org_id = pg_temp.fx('org');

-- 0. A task made the way they are today (no Owner on it), before anything below ----------------------------------
select pg_temp.mk('legacy', 'admin1', array['staff1', 'staff2']);
create temporary table snap as select pg_temp.rows_of('legacy') as before;

select ok(exists (select 1 from public.notification_kinds where kind = 'task_asked_about' and not actionable
                  and not always_email and in_app), 'the new kind: task_asked_about, in-app and push, never email');

-- 1. Assigning the Owner -------------------------------------------------------------------------------------
select lives_ok($$ select pg_temp.mk('own', 'owner', array['owner']) $$, 'the Owner assigns the Owner, alone');
select lives_ok($$ select pg_temp.mk('own2', 'owner', array['owner', 'staff1']) $$, 'the Owner as primary with Crew');
select lives_ok($$ select pg_temp.mk('by_admin', 'admin1', array['owner']) $$, 'an Admin assigns the Owner');
select is((select approving_admin_id from public.tasks where id = pg_temp.fx('by_admin')), pg_temp.fx('admin1'),
  'an Admin''s task for the Owner routes to that Admin, as any Admin task');
select is(pg_temp.n('owner', 'task_assigned', 'by_admin'), 1::bigint, 'the Owner is told, as any assignee');
select lives_ok($$ select pg_temp.mk('mixed', 'admin1', array['staff1', 'owner']) $$,
  'the Owner as one assignee of several (a Crew member primary)');
select pg_temp.as_member('staff1');
select throws_ok(format($$ select public.task_create('Crew made', null, %L, null, 'medium', now() + interval '1 day',
    array[%L, %L]::uuid[], %L) $$, pg_temp.fx('normal'), pg_temp.fx('staff1'), pg_temp.fx('owner'), pg_temp.fx('staff1')),
  'P0001', 'FORBIDDEN', 'a Crew member cannot assign the Owner (Crew create no task)');
select throws_ok(format($$ select public.task_update_assignment(%L, jsonb_build_object('assignee_ids', jsonb_build_array(%L, %L))) $$,
    pg_temp.fx('legacy'), pg_temp.fx('staff1'), pg_temp.fx('owner')),
  'P0001', 'FORBIDDEN', 'nor add the Owner to a task they are on');
select pg_temp.as_system();
select pg_temp.mk('later', 'admin1', array['staff1']);
select pg_temp.as_member('admin1');
select lives_ok(format($$ select public.task_update_assignment(%L, jsonb_build_object('assignee_ids', jsonb_build_array(%L, %L))) $$,
    pg_temp.fx('later'), pg_temp.fx('staff1'), pg_temp.fx('owner')), 'an Admin adds the Owner to their task later');
select pg_temp.as_system();
select is((select count(*) from public.task_assignees where task_id = pg_temp.fx('later') and member_id = pg_temp.fx('owner')
             and removed_at is null and acknowledged_at is null), 1::bigint, 'the Owner''s row, not noted yet');

-- 2. Task Noted ----------------------------------------------------------------------------------------------
select pg_temp.as_member('owner');
select lives_ok(format($$ select public.task_acknowledge(%L) $$, pg_temp.fx('by_admin')), 'the Owner taps Task Noted');
select pg_temp.as_system();
select isnt((select acknowledged_at from public.task_assignees where task_id = pg_temp.fx('by_admin') and member_id = pg_temp.fx('owner')),
  null, 'recorded like anyone''s');

-- 3. Done ----------------------------------------------------------------------------------------------------
select pg_temp.as_member('owner');
select is(public.task_submit_done(pg_temp.fx('by_admin'), 'The work'), 'completed'::public.task_state,
  'Done by the Owner as primary owner completes the task at once');
select pg_temp.as_system();
select is((select row(state, admin_step, completed_at is not null, submitted_by)::text from public.tasks where id = pg_temp.fx('by_admin')),
  row('completed'::public.task_state, 'skipped'::public.admin_step, true, pg_temp.fx('owner'))::text,
  'completed, the Admin step skipped, the hand-in stamped');
select is((select count(*) from public.task_reviews where task_id = pg_temp.fx('by_admin')), 0::bigint, 'nobody reviewed it: no review row');
select is((select count(*) from public.task_submissions where task_id = pg_temp.fx('by_admin') and version = 1), 1::bigint,
  'the hand-in version is written as always');
select is((select meta ->> 'step' from public.activity_log where entity = 'tasks' and entity_id = pg_temp.fx('by_admin') and action = 'completed'),
  'owner_done', 'audited "completed", meta.step owner_done');
select is(pg_temp.n('admin1', 'task_completed', 'by_admin'), 1::bigint, 'the creator is told it is complete');
select is(pg_temp.n('owner', 'task_completed', 'by_admin') + pg_temp.n('admin1', 'task_submitted', 'by_admin'), 0::bigint,
  'never the Owner (the actor), and no check is asked of the Admin');
select pg_temp.as_member('owner');
select is(public.task_submit_done(pg_temp.fx('own')), 'completed'::public.task_state, 'an Owner task with no approver completes too');
select pg_temp.as_system();
select is((select admin_step from public.tasks where id = pg_temp.fx('own')), 'none'::public.admin_step, 'admin_step none');
select pg_temp.as_member('staff1');
select is(public.task_submit_done(pg_temp.fx('mixed')), 'submitted'::public.task_state,
  'Done by a Crew primary on a task the Owner is also on routes as before: to the Admin');
select pg_temp.as_system();
select is(pg_temp.n('admin1', 'task_submitted', 'mixed'), 1::bigint, 'the approving Admin is asked to check it');
select pg_temp.as_member('staff1');
select throws_ok(format($$ select public.task_submit_done(%L) $$, pg_temp.fx('own2')), 'P0001', 'FORBIDDEN',
  'a Crew co-assignee cannot mark the Owner''s task Done');
select pg_temp.as_system();

-- 4. Crew see it only when on it --------------------------------------------------------------------------------
select pg_temp.as_member('staff2');
select is((select count(*) from public.tasks where id = pg_temp.fx('own2')), 0::bigint, 'a Crew member off the task cannot read it');
select is((select count(*) from public.task_assignees where task_id = pg_temp.fx('own2')), 0::bigint, 'nor its people');
select pg_temp.as_member('staff1');
select is((select count(*) from public.tasks where id = pg_temp.fx('own2')), 1::bigint, 'a Crew member on it reads it');
select pg_temp.as_member('admin2');
select is((select count(*) from public.tasks where id = pg_temp.fx('own2')), 0::bigint, 'an Admin with nothing to do with it does not');
select pg_temp.as_system();

-- 5. Remind ----------------------------------------------------------------------------------------------------
select pg_temp.mk('rem', 'admin1', array['staff1', 'staff2']);
select pg_temp.mk('rem2', 'owner', array['staff1'], null, 'admin2');
select pg_temp.mk('solo', 'owner', array['owner']);
select pg_temp.as_member('staff1');
select throws_ok(format($$ select public.task_remind(%L) $$, pg_temp.fx('rem')), 'P0001', 'FORBIDDEN', 'an assignee cannot Remind');
select pg_temp.as_member('admin2');
select throws_ok(format($$ select public.task_remind(%L) $$, pg_temp.fx('rem')), 'P0001', 'NOT_FOUND', 'another Admin does not see the task');
select pg_temp.as_member('admin1');
select lives_ok(format($$ select public.task_remind(%L) $$, pg_temp.fx('rem')), 'the creator reminds');
select pg_temp.as_system();
select is(pg_temp.n('staff1', 'task_asked_about', 'rem') + pg_temp.n('staff2', 'task_asked_about', 'rem'), 2::bigint,
  'every assignee is asked');
select is((select title from public.notifications where recipient_id = pg_temp.fx('staff1') and kind = 'task_asked_about'),
  'Admin1 is asking about Rem', '"<name> is asking about <task>"');
select is(pg_temp.n('admin1', 'task_asked_about', 'rem'), 0::bigint, 'never the sender');
select is((select count(*) from public.activity_log where entity = 'tasks' and entity_id = pg_temp.fx('rem')
             and action = 'reminder_sent' and actor_id = pg_temp.fx('admin1')
             and meta -> 'recipients' = jsonb_build_array(pg_temp.fx('staff1'), pg_temp.fx('staff2'))), 1::bigint,
  'recorded in the activity log with whom it reached');
select pg_temp.as_member('owner');
select throws_ok(format($$ select public.task_remind(%L) $$, pg_temp.fx('rem')), 'P0001', 'RATE_LIMITED',
  'within the hour it is refused, whoever sends it');
select pg_temp.as_system();
update public.activity_log set at = now() - interval '61 minutes'
where entity = 'tasks' and entity_id = pg_temp.fx('rem') and action = 'reminder_sent';
select pg_temp.as_member('owner');
select lives_ok(format($$ select public.task_remind(%L) $$, pg_temp.fx('rem')), 'after the hour the Owner may send one');
select pg_temp.as_member('admin2');
select lives_ok(format($$ select public.task_remind(%L) $$, pg_temp.fx('rem2')), 'the approving Admin reminds');
select pg_temp.as_member('owner');
select throws_ok(format($$ select public.task_remind(%L) $$, pg_temp.fx('by_admin')), 'P0001', 'INVALID_STATE',
  'not on a completed task');
select throws_ok(format($$ select public.task_remind(%L) $$, pg_temp.fx('solo')), 'P0001', 'VALIDATION',
  'not when nobody else is on it');
select pg_temp.as_system();
select ok(not has_function_privilege('anon', 'public.task_remind(uuid)', 'execute')
          and has_function_privilege('authenticated', 'public.task_remind(uuid)', 'execute'),
  'task_remind: the API role, never anon');
select ok((select p.prosecdef and p.proconfig @> array['search_path=""'] from pg_proc p where p.oid = 'public.task_remind(uuid)'::regprocedure),
  'SECURITY DEFINER with an empty search_path');

-- 6. No escalation about the Owner ----------------------------------------------------------------------------
select is(pg_temp.armed('own2', 'overdue_escalation'), 0::bigint, 'an Owner-primary task arms no overdue escalation');
select is(pg_temp.armed('own2', 'overdue'), 1::bigint, 'its overdue reminder is armed as usual');
select is(pg_temp.armed('rem', 'overdue_escalation'), 1::bigint, 'a Crew-primary task still arms one');
select pg_temp.mk('swap', 'owner', array['staff1', 'owner']);
select is(pg_temp.armed('swap', 'overdue_escalation'), 1::bigint, '(a Crew primary: armed)');
select pg_temp.as_member('owner');
select public.task_update_assignment(pg_temp.fx('swap'), jsonb_build_object('primary_owner_id', pg_temp.fx('owner')));
select pg_temp.as_system();
select is(pg_temp.armed('swap', 'overdue_escalation'), 0::bigint, 'the Owner made primary: the escalation is dropped');
-- An escalation armed before the Owner became the primary owner, its moment come: dropped, never sent.
select pg_temp.mk('late_own', 'admin1', array['owner']);
update public.tasks set due_at = now() - interval '30 hours' where id = pg_temp.fx('late_own');
insert into public.task_reminders (org_id, task_id, kind, deadline, fire_at)
select pg_temp.fx('org'), pg_temp.fx('late_own'), 'overdue_escalation', due_at, now() - interval '6 hours'
from public.tasks where id = pg_temp.fx('late_own');
-- The Owner not noted 10 h on a task where the Crew member noted it.
select pg_temp.mk('nn', 'admin1', array['staff1', 'owner']);
select pg_temp.as_member('staff1');
select public.task_acknowledge(pg_temp.fx('nn'));
select pg_temp.as_system();
update public.task_assignees set assigned_at = now() - interval '10 hours' where task_id = pg_temp.fx('nn');
update public.task_reminder_arms set armed_at = now() - interval '10 hours' where task_id = pg_temp.fx('nn');
delete from public.notifications;
select lives_ok($$ select app.reminders_tick(now()) $$, 'the 5-minute job runs');
select is(pg_temp.n('admin1', 'escalation_overdue', 'late_own') + pg_temp.n('owner', 'escalation_overdue', 'late_own'), 0::bigint,
  'no overdue escalation for an Owner-primary task');
select is((select count(*) from public.task_reminders where task_id = pg_temp.fx('late_own') and kind = 'overdue_escalation'
             and cancelled_at is not null), 1::bigint, '(recorded as dropped)');
select is((select count(*) from public.notifications where kind = 'escalation_not_noted' and entity_id = pg_temp.fx('nn')), 0::bigint,
  'no not-noted escalation about the Owner, to anyone');
select is(pg_temp.n('owner', 'reminder_not_noted', 'nn'), 1::bigint, 'the Owner still gets the Task Noted reminder');
select pg_temp.as_member('owner');
select is((select count(*) from public.dashboard_not_noted() d where d.member_id = pg_temp.fx('owner')), 0::bigint,
  'the Owner''s Today never lists the Owner as not noted');
select pg_temp.as_system();

-- 7. Admins see the Owner's shoots as Busy ---------------------------------------------------------------------
select pg_temp.mk('shoot', 'owner', array['owner'], null, null, 'event', app.today_ist() + 2,
  app.ist_day_start(app.today_ist() + 2) + interval '10 hours');
select pg_temp.as_member('admin1');
select is((select count(*) from public.member_availability(app.today_ist(), app.today_ist() + 3) a where a.member_id = pg_temp.fx('owner')),
  4::bigint, 'member_availability answers for the Owner (one row a day)');
select is((select jsonb_array_length(a.event_blocks) from public.member_availability(app.today_ist() + 2, app.today_ist() + 2) a
           where a.member_id = pg_temp.fx('owner')), 1, 'the Owner''s shoot is a busy block, with no title or id');
select is((select a.leave is null and a.present is null from public.member_availability(app.today_ist(), app.today_ist()) a
           where a.member_id = pg_temp.fx('owner')), true, 'never leave or attendance for the Owner');
select pg_temp.as_system();

-- 8. A task made the way they are today: every row unchanged ------------------------------------------------------
select is(pg_temp.rows_of('legacy'), (select before from snap), 'the existing task''s rows are unchanged');

select * from finish();
rollback;
