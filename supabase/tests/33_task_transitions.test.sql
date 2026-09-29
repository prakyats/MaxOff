-- 4A (4.2) Staff tasks, the transition functions (WORKFLOWS §3, PRODUCT §4.6, PERMISSIONS §3;
-- ADR-0006, ADR-0013; kickoff 4 decisions 1-5, 10, 14): task_create on every path (the route for
-- the Owner direct, through an Admin, an Admin's own client, another Admin's client, the Owner as
-- assignee, the deadline, the type's fields, stages, reminders, warnings), task_acknowledge,
-- task_start and task_submit_done with their on-behalf paths (the current coordinator allowed; a
-- former coordinator, another member, the freelancer as actor, a non-freelancer subject refused),
-- the Admin-step skip and the late reason, task_review at both steps (the Owner never at the
-- Admin's; reason on reject; the review rows), task_reopen, task_cancel, task_update_assignment
-- (fields, assignees, primary, the audit) and task_set_approver in every state.
begin;
create extension if not exists pgtap with schema extensions;
select plan(196);

-- Fixtures as 32. Rolled back at the end.
delete from public.task_warnings;
delete from public.task_reviews;
delete from public.task_submissions;
delete from public.task_comments;
delete from public.task_stages;
delete from public.task_assignees;
delete from public.tasks;
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
delete from public.clients;
update public.organizations set logo_file_id = null;
delete from public.files;
delete from public.members;
delete from auth.identities;
delete from auth.users;
delete from public.activity_log;
delete from public.holidays;
update public.org_settings set weekly_off_days = '{}';
update public.task_types set default_reminders = '[{"kind": "before_due", "hours": 24}]'::jsonb where name = 'Normal';

create temporary table fx (key text primary key, id uuid not null);
insert into fx values
  ('owner',       '00000000-0000-4000-8000-000000000601'),
  ('admin1',      '00000000-0000-4000-8000-000000000602'),
  ('admin2',      '00000000-0000-4000-8000-000000000603'),
  ('staff1',      '00000000-0000-4000-8000-000000000604'),
  ('staff2',      '00000000-0000-4000-8000-000000000605'),
  ('coord',       '00000000-0000-4000-8000-000000000606'),
  ('old',         '00000000-0000-4000-8000-000000000607'),
  ('deactivated', '00000000-0000-4000-8000-000000000608'),
  ('oldadmin',    '00000000-0000-4000-8000-000000000609'),
  ('client_a',    '00000000-0000-4000-8000-000000000611'),
  ('client_b',    '00000000-0000-4000-8000-000000000612');
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

create function pg_temp.as_system() returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', '', true);
end;
$$;

create function pg_temp.type_id(n text) returns uuid language sql stable as $$
  select tt.id from public.task_types tt where tt.org_id = pg_temp.fx('org') and tt.name = n;
$$;

create function pg_temp.due() returns timestamptz language sql stable as $$
  select app.ist_day_start(app.today_ist() + 1) + interval '18 hours';
$$;

-- A plain Normal task by the caller: assignees + primary, optional approver and client.
create function pg_temp.mk(title text, assignees text[], primary_key text, approver text default null, client text default null)
returns uuid language plpgsql as $$
declare
  v_ids uuid[] := array(select pg_temp.fx(k) from unnest(assignees) k);
begin
  return public.task_create(title, null, pg_temp.type_id('Normal'),
    case when client is null then null else pg_temp.fx(client) end, 'medium', pg_temp.due(),
    v_ids, pg_temp.fx(primary_key), case when approver is null then null else pg_temp.fx(approver) end);
end;
$$;

create function pg_temp.task(k text) returns public.tasks language sql stable as $$
  select t.* from public.tasks t where t.id = pg_temp.fx(k);
$$;

create function pg_temp.assignee(k text, who text) returns public.task_assignees language sql stable as $$
  select a.* from public.task_assignees a where a.task_id = pg_temp.fx(k) and a.member_id = pg_temp.fx(who);
$$;

create function pg_temp.actions(k text) returns text[] language sql stable as $$
  select coalesce(array_agg(a.action order by a.id), '{}') from public.activity_log a where a.entity_id = pg_temp.fx(k);
$$;

create function pg_temp.last_audit(k text) returns public.activity_log language sql stable as $$
  select a.* from public.activity_log a where a.entity_id = pg_temp.fx(k) order by a.id desc limit 1;
$$;

insert into auth.users (id, email)
select id, key || '@example.com' from fx where key not in ('org', 'client_a', 'client_b');

insert into public.members (id, org_id, full_name, email, role, status, joined_at)
select pg_temp.fx(k), pg_temp.fx('org'), k, k || '@example.com', r::public.member_role, 'active', now() - interval '30 days'
from (values ('owner', 'owner'), ('admin1', 'admin'), ('admin2', 'admin'), ('staff1', 'staff'), ('staff2', 'staff'),
             ('coord', 'staff'), ('old', 'staff')) as v(k, r);
insert into public.members (id, org_id, full_name, email, role, status, joined_at, deactivated_at) values
  (pg_temp.fx('deactivated'), pg_temp.fx('org'), 'Gone Staff', 'deactivated@example.com', 'staff', 'deactivated', now() - interval '30 days', now()),
  (pg_temp.fx('oldadmin'), pg_temp.fx('org'), 'Gone Admin', 'oldadmin@example.com', 'admin', 'deactivated', now() - interval '30 days', now());

insert into public.clients (id, org_id, name, state, admin_id, activated_at) values
  (pg_temp.fx('client_a'), pg_temp.fx('org'), 'Sharma Weddings', 'active', pg_temp.fx('admin1'), now()),
  (pg_temp.fx('client_b'), pg_temp.fx('org'), 'Blue Bakery', 'active', pg_temp.fx('admin2'), now());

select pg_temp.as_member('owner');
insert into fx values ('asha', public.member_add_freelancer('Asha', null, null, pg_temp.fx('old')));
select public.member_set_coordinator(pg_temp.fx('asha'), pg_temp.fx('coord'), 'handover');
update public.task_types set archived_at = now() where name = 'Other';

-- task_create -----------------------------------------------------------------------------------
select pg_temp.as_member('staff1');
select throws_ok($$ select pg_temp.mk('Mine', array['staff1'], 'staff1') $$, 'P0001', 'FORBIDDEN', 'Staff cannot create a task');
select pg_temp.as_member('coord');
select throws_ok($$ select pg_temp.mk('For Asha', array['asha'], 'asha') $$, 'P0001', 'FORBIDDEN', 'nor a coordinator (Staff)');

select pg_temp.as_member('owner');
insert into fx values ('direct', pg_temp.mk('Owner direct', array['staff1', 'asha'], 'staff1'));
select results_eq(
  $$ select t.state::text, t.admin_step::text, t.approving_admin_id, t.created_by, t.primary_owner_id, t.priority::text, t.reminder_rules
     from public.tasks t where t.id = pg_temp.fx('direct') $$,
  $$ values ('todo', 'none', null::uuid, pg_temp.fx('owner'), pg_temp.fx('staff1'), 'medium', '[{"kind": "before_due", "hours": 24}]'::jsonb) $$,
  'the Owner assigned directly: todo, no Admin step, the type''s default reminders (kickoff 4 decision 14)');
select is((select (pg_temp.last_audit('direct')).action), 'assigned', 'audit: the assignee rows follow the task row');
select is((select a.meta ->> 'route' from public.activity_log a where a.entity_id = pg_temp.fx('direct') and a.action = 'created'),
  'owner_direct', 'audit: created with the route');
select is((select count(*) from public.task_assignees a where a.task_id = pg_temp.fx('direct')), 2::bigint, 'two assignee rows');
select is((pg_temp.assignee('direct', 'staff1')).is_primary, true, 'staff1 is the primary');
select is((pg_temp.assignee('direct', 'asha')).acknowledged_at, null, 'nobody has acknowledged yet');

insert into fx values ('via', pg_temp.mk('Owner via Admin', array['staff1'], 'staff1', 'admin1'));
select results_eq(
  $$ select t.admin_step::text, t.approving_admin_id from public.tasks t where t.id = pg_temp.fx('via') $$,
  $$ values ('required', pg_temp.fx('admin1')) $$, 'the Owner through an Admin: the Admin step is required');
select throws_ok($$ select pg_temp.mk('Via Staff', array['staff1'], 'staff1', 'staff1') $$,
  'P0001', 'VALIDATION', 'the approver must be an Admin');
select throws_ok($$ select pg_temp.mk('Via gone Admin', array['staff1'], 'staff1', 'oldadmin') $$,
  'P0001', 'VALIDATION', 'an active one');
select throws_ok($$ select pg_temp.mk('Owner assigned', array['owner'], 'owner') $$,
  'P0001', 'VALIDATION', 'the Owner is never an assignee (kickoff 4 decision 1)');
select throws_ok($$ select pg_temp.mk('Owner among', array['staff1', 'owner'], 'staff1') $$,
  'P0001', 'VALIDATION', 'not even among others');
select throws_ok($$ select pg_temp.mk('Wrong primary', array['staff1'], 'staff2') $$,
  'P0001', 'VALIDATION', 'the primary owner must be one of the assignees');
select throws_ok($$ select pg_temp.mk('Nobody', array[]::text[], 'staff1') $$,
  'P0001', 'VALIDATION', 'at least one assignee');
select throws_ok($$ select pg_temp.mk('Gone', array['deactivated'], 'deactivated') $$,
  'P0001', 'VALIDATION', 'a deactivated person cannot be assigned');
select throws_ok(format($$ select public.task_create('Ghost', null, %L::uuid, null, 'medium', pg_temp.due(), array[gen_random_uuid()], %L::uuid) $$,
  pg_temp.type_id('Normal'), pg_temp.fx('staff1')), 'P0001', 'VALIDATION', 'an unknown assignee (the primary must be among them first)');
select throws_ok(format($$ select public.task_create('Past', null, %L::uuid, null, 'medium', now() - interval '1 hour', array[%L::uuid], %L::uuid) $$,
  pg_temp.type_id('Normal'), pg_temp.fx('staff1'), pg_temp.fx('staff1')), 'P0001', 'VALIDATION', 'a deadline in the past is refused at creation (kickoff 4 decision 4)');
select throws_ok(format($$ select public.task_create('No deadline', null, %L::uuid, null, 'medium', null, array[%L::uuid], %L::uuid) $$,
  pg_temp.type_id('Normal'), pg_temp.fx('staff1'), pg_temp.fx('staff1')), 'P0001', 'VALIDATION', 'the deadline is required');
select throws_ok(format($$ select public.task_create('  ', null, %L::uuid, null, 'medium', pg_temp.due(), array[%L::uuid], %L::uuid) $$,
  pg_temp.type_id('Normal'), pg_temp.fx('staff1'), pg_temp.fx('staff1')), 'P0001', 'VALIDATION', 'a title is required');
select throws_ok(format($$ select public.task_create('No priority', null, %L::uuid, null, null, pg_temp.due(), array[%L::uuid], %L::uuid) $$,
  pg_temp.type_id('Normal'), pg_temp.fx('staff1'), pg_temp.fx('staff1')), 'P0001', 'VALIDATION', 'a priority is required');
select throws_ok(format($$ select public.task_create('Archived type', null, %L::uuid, null, 'medium', pg_temp.due(), array[%L::uuid], %L::uuid) $$,
  pg_temp.type_id('Other'), pg_temp.fx('staff1'), pg_temp.fx('staff1')), 'P0001', 'VALIDATION', 'an archived type is refused');
select throws_ok(format($$ select public.task_create('No type', null, gen_random_uuid(), null, 'medium', pg_temp.due(), array[%L::uuid], %L::uuid) $$,
  pg_temp.fx('staff1'), pg_temp.fx('staff1')), 'P0001', 'NOT_FOUND', 'an unknown type');
select throws_ok(format($$ select public.task_create('Ghost client', null, %L::uuid, gen_random_uuid(), 'medium', pg_temp.due(), array[%L::uuid], %L::uuid) $$,
  pg_temp.type_id('Normal'), pg_temp.fx('staff1'), pg_temp.fx('staff1')), 'P0001', 'NOT_FOUND', 'an unknown client');

-- The type's fields (PRODUCT §4.6 event tasks).
select throws_ok(format($$ select public.task_create('Meet', null, %L::uuid, null, 'medium', pg_temp.due(), array[%L::uuid], %L::uuid) $$,
  pg_temp.type_id('Meeting'), pg_temp.fx('staff1'), pg_temp.fx('staff1')), 'P0001', 'VALIDATION', 'an event needs its event date');
select throws_ok(format($$ select public.task_create('Meet', null, %L::uuid, null, 'medium', pg_temp.due(), array[%L::uuid], %L::uuid,
    event_date => app.today_ist() + 1, event_start_at => app.ist_day_start(app.today_ist() + 2) + interval '10 hours') $$,
  pg_temp.type_id('Meeting'), pg_temp.fx('staff1'), pg_temp.fx('staff1')), 'P0001', 'VALIDATION', 'the time must be on the event date');
select throws_ok(format($$ select public.task_create('Meet', null, %L::uuid, null, 'medium', pg_temp.due(), array[%L::uuid], %L::uuid,
    event_date => app.today_ist() + 1, event_start_at => app.ist_day_start(app.today_ist() + 1) + interval '10 hours',
    event_end_at => app.ist_day_start(app.today_ist() + 1) + interval '9 hours') $$,
  pg_temp.type_id('Meeting'), pg_temp.fx('staff1'), pg_temp.fx('staff1')), 'P0001', 'VALIDATION', 'the end is after the start');
select throws_ok(format($$ select public.task_create('Meet', null, %L::uuid, null, 'medium', pg_temp.due(), array[%L::uuid], %L::uuid,
    event_date => app.today_ist() + 1, event_end_at => app.ist_day_start(app.today_ist() + 1) + interval '9 hours') $$,
  pg_temp.type_id('Meeting'), pg_temp.fx('staff1'), pg_temp.fx('staff1')), 'P0001', 'VALIDATION', 'an end needs a start');
select throws_ok(format($$ select public.task_create('Normal with date', null, %L::uuid, null, 'medium', pg_temp.due(), array[%L::uuid], %L::uuid, event_date => app.today_ist()) $$,
  pg_temp.type_id('Normal'), pg_temp.fx('staff1'), pg_temp.fx('staff1')), 'P0001', 'VALIDATION', 'a Normal task has no event date');
select throws_ok(format($$ select public.task_create('Normal with purpose', null, %L::uuid, null, 'medium', pg_temp.due(), array[%L::uuid], %L::uuid, purpose => 'why') $$,
  pg_temp.type_id('Normal'), pg_temp.fx('staff1'), pg_temp.fx('staff1')), 'P0001', 'VALIDATION', 'only an event has a purpose');
select throws_ok(format($$ select public.task_create('Post', null, %L::uuid, null, 'medium', pg_temp.due(), array[%L::uuid], %L::uuid, event_date => app.today_ist() + 1, location => 'Studio') $$,
  pg_temp.type_id('Posting'), pg_temp.fx('staff1'), pg_temp.fx('staff1')), 'P0001', 'VALIDATION', 'a Posting has no location');
insert into fx values ('meet', public.task_create('Client meeting', null, pg_temp.type_id('Meeting'), pg_temp.fx('client_a'), 'high', pg_temp.due(),
  array[pg_temp.fx('staff2')], pg_temp.fx('staff2'), event_date => app.today_ist() + 1,
  event_start_at => app.ist_day_start(app.today_ist() + 1) + interval '10 hours', location => ' Client office ', purpose => 'Kick-off',
  stages => array[' Agenda ', 'Minutes'], reminder_rules => '[{"kind": "event", "hours": 2}]', warnings => jsonb_build_array(
    jsonb_build_object('kind', 'workload', 'member_id', pg_temp.fx('staff2'), 'details', jsonb_build_object('open', 5)))));
select results_eq(
  $$ select t.event_date, t.location, t.purpose, t.reminder_rules from public.tasks t where t.id = pg_temp.fx('meet') $$,
  $$ values (app.today_ist() + 1, 'Client office', 'Kick-off', '[{"kind": "event", "hours": 2}]'::jsonb) $$,
  'an event task: date, time, trimmed location, purpose; explicit reminders kept');
select results_eq(
  $$ select s.name, s.position, s.done_at from public.task_stages s where s.task_id = pg_temp.fx('meet') order by s.position $$,
  $$ values ('Agenda', 'a0', null::timestamptz), ('Minutes', 'a1', null) $$, 'the stages typed on the task, in order, unticked');
select results_eq(
  $$ select w.kind, w.member_id, w.details, w.overridden_by from public.task_warnings w where w.task_id = pg_temp.fx('meet') $$,
  $$ values ('workload', pg_temp.fx('staff2'), '{"open": 5}'::jsonb, pg_temp.fx('owner')) $$,
  'the warning the Owner proceeded past is recorded');
select is((select count(*) from public.activity_log a where a.entity_id = pg_temp.fx('meet') and a.action = 'warning_overridden'), 1::bigint,
  'audit: warning_overridden');
select throws_ok(format($$ select public.task_create('Blank stage', null, %L::uuid, null, 'medium', pg_temp.due(), array[%L::uuid], %L::uuid, stages => array['ok', '  ']) $$,
  pg_temp.type_id('Normal'), pg_temp.fx('staff1'), pg_temp.fx('staff1')), 'P0001', 'VALIDATION', 'a stage needs a name');
select throws_ok(format($$ select public.task_create('Bad warning', null, %L::uuid, null, 'medium', pg_temp.due(), array[%L::uuid], %L::uuid,
    warnings => jsonb_build_array(jsonb_build_object('kind', 'weather', 'member_id', %L))) $$,
  pg_temp.type_id('Normal'), pg_temp.fx('staff1'), pg_temp.fx('staff1'), pg_temp.fx('staff1')), 'P0001', 'VALIDATION', 'a warning kind is one of three');
select throws_ok(format($$ select public.task_create('Bad warning', null, %L::uuid, null, 'medium', pg_temp.due(), array[%L::uuid], %L::uuid,
    warnings => jsonb_build_array(jsonb_build_object('kind', 'on_leave', 'member_id', %L))) $$,
  pg_temp.type_id('Normal'), pg_temp.fx('staff1'), pg_temp.fx('staff1'), pg_temp.fx('staff2')), 'P0001', 'VALIDATION', 'a warning is about an assignee');

-- An Admin's route (kickoff 4 decisions 2 and 3).
select pg_temp.as_member('admin1');
insert into fx values ('adm', pg_temp.mk('Admin task', array['staff2'], 'staff2', null, 'client_a'));
select results_eq(
  $$ select t.approving_admin_id, t.admin_step::text, t.created_by from public.tasks t where t.id = pg_temp.fx('adm') $$,
  $$ values (pg_temp.fx('admin1'), 'required', pg_temp.fx('admin1')) $$, 'an Admin''s task routes to that Admin');
select is((select a.meta ->> 'route' from public.activity_log a where a.entity_id = pg_temp.fx('adm') and a.action = 'created'), 'admin', 'audit route: admin');
select lives_ok($$ select pg_temp.mk('Admin task 2', array['staff2'], 'staff2', 'admin1') $$, 'naming themselves as approver is fine');
select throws_ok($$ select pg_temp.mk('Via another', array['staff2'], 'staff2', 'admin2') $$,
  'P0001', 'VALIDATION', 'but not another Admin');
select throws_ok($$ select pg_temp.mk('Other client', array['staff2'], 'staff2', null, 'client_b') $$,
  'P0001', 'FORBIDDEN', 'an Admin labels only their own clients');
insert into fx values ('self', pg_temp.mk('Admin on it', array['admin1', 'staff2'], 'staff2'));
select is((pg_temp.task('self')).admin_step::text, 'required', 'an Admin assigned to their own task: the skip is decided at Done');

-- task_acknowledge (WORKFLOWS §3.2; the on-behalf paths, ADR-0013) ---------------------------------
select pg_temp.as_member('staff2');
select throws_ok(format($$ select public.task_acknowledge(%L) $$, pg_temp.fx('direct')), 'P0001', 'FORBIDDEN', 'not an assignee: refused');
select pg_temp.as_member('owner');
select throws_ok(format($$ select public.task_acknowledge(%L) $$, pg_temp.fx('direct')), 'P0001', 'FORBIDDEN', 'the Owner is no assignee either');
select pg_temp.as_member('staff1');
select ok(public.task_acknowledge(pg_temp.fx('direct')) is not null, 'the assignee taps Task Noted');
select is((pg_temp.assignee('direct', 'staff1')).acknowledged_by, pg_temp.fx('staff1'), 'acknowledged_by = themselves');
select throws_ok(format($$ select public.task_acknowledge(%L) $$, pg_temp.fx('direct')), 'P0001', 'INVALID_STATE', 'once');
select throws_ok(format($$ select public.task_acknowledge(%L, %L) $$, pg_temp.fx('direct'), pg_temp.fx('asha')),
  'P0001', 'FORBIDDEN', 'a co-assignee cannot acknowledge for the freelancer');
select pg_temp.as_member('asha');
select throws_ok(format($$ select public.task_acknowledge(%L) $$, pg_temp.fx('direct')),
  'P0001', 'FORBIDDEN', 'the freelancer''s own id is never an actor');
select pg_temp.as_member('old');
select throws_ok(format($$ select public.task_acknowledge(%L, %L) $$, pg_temp.fx('direct'), pg_temp.fx('asha')),
  'P0001', 'FORBIDDEN', 'a former coordinator is refused');
select pg_temp.as_member('coord');
select throws_ok(format($$ select public.task_acknowledge(%L, %L) $$, pg_temp.fx('direct'), pg_temp.fx('staff1')),
  'P0001', 'FORBIDDEN', 'on behalf of an employee is refused');
select throws_ok(format($$ select public.task_acknowledge(%L, %L) $$, pg_temp.fx('direct'), pg_temp.fx('coord')),
  'P0001', 'VALIDATION', 'on behalf of oneself is refused');
select throws_ok(format($$ select public.task_acknowledge(%L, %L) $$, pg_temp.fx('via'), pg_temp.fx('asha')),
  'P0001', 'FORBIDDEN', 'on a task the freelancer is not assigned to');
select throws_ok(format($$ select public.task_acknowledge(%L) $$, pg_temp.fx('direct')),
  'P0001', 'FORBIDDEN', 'the coordinator is not an assignee themselves');
select ok(public.task_acknowledge(pg_temp.fx('direct'), pg_temp.fx('asha')) is not null, 'the current coordinator acknowledges for the freelancer');
select is((pg_temp.assignee('direct', 'asha')).acknowledged_by, pg_temp.fx('coord'), 'acknowledged_by = the coordinator');
select results_eq(
  format($$ select a.actor_id, a.on_behalf_of_id, a.meta ->> 'member_id' from public.activity_log a
     where a.entity_id = %L and a.action = 'acknowledged' and a.actor_id = %L $$, pg_temp.fx('direct'), pg_temp.fx('coord')),
  $$ values (pg_temp.fx('coord'), pg_temp.fx('asha'), pg_temp.fx('asha')::text) $$,
  'audit: actor = the coordinator, on_behalf_of_id = the freelancer');

-- task_start ----------------------------------------------------------------------------------------
select pg_temp.as_member('staff2');
select throws_ok(format($$ select public.task_start(%L) $$, pg_temp.fx('direct')), 'P0001', 'FORBIDDEN', 'not an assignee: cannot start');
select pg_temp.as_member('asha');
select throws_ok(format($$ select public.task_start(%L) $$, pg_temp.fx('direct')), 'P0001', 'FORBIDDEN', 'the freelancer never acts');
select pg_temp.as_member('old');
select throws_ok(format($$ select public.task_start(%L, %L) $$, pg_temp.fx('direct'), pg_temp.fx('asha')), 'P0001', 'FORBIDDEN', 'nor a former coordinator for them');
select pg_temp.as_member('coord');
select is(public.task_start(pg_temp.fx('direct'), pg_temp.fx('asha')), 'in_progress', 'the coordinator starts it for the freelancer');
select is((select (pg_temp.last_audit('direct')).on_behalf_of_id), pg_temp.fx('asha'), 'audit: started, on behalf');
select throws_ok(format($$ select public.task_start(%L, %L) $$, pg_temp.fx('direct'), pg_temp.fx('asha')), 'P0001', 'INVALID_STATE', 'started once');
select pg_temp.as_member('staff1');
select is(public.task_start(pg_temp.fx('via')), 'in_progress', 'an assignee starts their own');
select is((pg_temp.assignee('via', 'staff1')).acknowledged_at, null, 'starting implies no acknowledgement');

-- task_submit_done (WORKFLOWS §3.1/§3.3; the route) -----------------------------------------------
select pg_temp.as_member('coord');
select throws_ok(format($$ select public.task_submit_done(%L, null, null, %L) $$, pg_temp.fx('direct'), pg_temp.fx('asha')),
  'P0001', 'FORBIDDEN', 'only the primary owner marks Done (the freelancer is not)');
select pg_temp.as_member('staff2');
select throws_ok(format($$ select public.task_submit_done(%L) $$, pg_temp.fx('direct')), 'P0001', 'FORBIDDEN', 'a stranger neither');
select pg_temp.as_member('staff1');
select throws_ok(format($$ select public.task_submit_done(%L, %L) $$, pg_temp.fx('direct'), repeat('x', 5001)),
  'P0001', 'VALIDATION', 'the note is 5000 characters at most');
select is(public.task_submit_done(pg_temp.fx('direct'), 'Here: https://drive.google.com/d/abc', null, null), 'admin_approved',
  'the Owner''s direct task goes straight to the Owner (admin_step none)');
select results_eq(
  $$ select t.admin_step::text, t.submitted_by, t.submitted_on_behalf_of, t.submitted_at is not null, t.late_reason from public.tasks t where t.id = pg_temp.fx('direct') $$,
  $$ values ('none', pg_temp.fx('staff1'), null::uuid, true, null::text) $$, 'submitted by staff1, not late');
select results_eq(
  $$ select s.version, s.note, s.submitted_by, s.on_behalf_of from public.task_submissions s where s.task_id = pg_temp.fx('direct') $$,
  $$ values (1, 'Here: https://drive.google.com/d/abc', pg_temp.fx('staff1'), null::uuid) $$, 'version 1 with the note (links allowed)');
select throws_ok(format($$ select public.task_submit_done(%L) $$, pg_temp.fx('direct')), 'P0001', 'INVALID_STATE', 'twice: waiting for review');
select is(public.task_submit_done(pg_temp.fx('via')), 'submitted', 'through an Admin: submitted, the Admin step required');
select is((pg_temp.task('via')).admin_step::text, 'required', '(admin_step required)');
select is((select a.meta ->> 'admin_step' from public.activity_log a where a.entity_id = pg_temp.fx('via') and a.action = 'submitted'), 'required',
  'audit: submitted with the step');

-- Done does not wait for acknowledgements: the primary owner's is implied.
select pg_temp.as_member('owner');
insert into fx values ('unacked', pg_temp.mk('Unacked', array['staff1'], 'staff1', 'admin1'));
select pg_temp.as_member('staff1');
select is(public.task_submit_done(pg_temp.fx('unacked')), 'submitted', 'Done from todo, without a Task Noted');
select is((pg_temp.assignee('unacked', 'staff1')).acknowledged_by, pg_temp.fx('staff1'), 'the acknowledgement is recorded');
select is((select a.meta ->> 'implied' from public.activity_log a where a.entity_id = pg_temp.fx('unacked') and a.action = 'acknowledged'), 'true',
  'audit: acknowledged, meta.implied');

-- The approving Admin is an assignee: the step is skipped, the reason only in the log.
select pg_temp.as_member('staff2');
select is(public.task_submit_done(pg_temp.fx('self')), 'admin_approved', 'the approver is an assignee: straight to the Owner');
select is((pg_temp.task('self')).admin_step::text, 'skipped', '(admin_step skipped)');
select is((select a.meta ->> 'reason' from public.activity_log a where a.entity_id = pg_temp.fx('self') and a.action = 'submitted'),
  'approver_is_assignee', 'audit: the skip reason');
select is((pg_temp.task('self')).admin_approved_at, null, 'no Admin approval time: none happened');

-- Late: the reason is required (the deadline is moved into the past by an edit, which may).
select pg_temp.as_member('owner');
insert into fx values ('late', pg_temp.mk('Late one', array['staff1'], 'staff1', 'admin1'));
select lives_ok(format($$ select public.task_update_assignment(%L, jsonb_build_object('due_at', (now() - interval '1 hour')::text)) $$, pg_temp.fx('late')),
  'an edit moves the deadline into the past');
select pg_temp.as_member('staff1');
select throws_ok(format($$ select public.task_submit_done(%L, 'done') $$, pg_temp.fx('late')), 'P0001', 'REASON_REQUIRED', 'late without a reason');
select is(public.task_submit_done(pg_temp.fx('late'), 'done', 'The client sent the files late'), 'submitted', 'late with a reason');
select is((pg_temp.task('late')).late_reason, 'The client sent the files late', 'late_reason stored');
select is((select (a.meta ->> 'late')::boolean from public.activity_log a where a.entity_id = pg_temp.fx('late') and a.action = 'submitted'), true,
  'audit: late');

-- On behalf: the freelancer is the primary owner, so the coordinator marks Done.
select pg_temp.as_member('owner');
insert into fx values ('fl', pg_temp.mk('Asha edits', array['asha'], 'asha', 'admin1'));
select pg_temp.as_member('asha');
select throws_ok(format($$ select public.task_submit_done(%L) $$, pg_temp.fx('fl')), 'P0001', 'FORBIDDEN', 'the freelancer never acts');
select pg_temp.as_member('old');
select throws_ok(format($$ select public.task_submit_done(%L, null, null, %L) $$, pg_temp.fx('fl'), pg_temp.fx('asha')), 'P0001', 'FORBIDDEN', 'a former coordinator neither');
select pg_temp.as_member('staff1');
select throws_ok(format($$ select public.task_submit_done(%L, null, null, %L) $$, pg_temp.fx('fl'), pg_temp.fx('asha')), 'P0001', 'FORBIDDEN', 'nor another member');
select pg_temp.as_member('coord');
select throws_ok(format($$ select public.task_submit_done(%L) $$, pg_temp.fx('fl')), 'P0001', 'FORBIDDEN', 'the coordinator is not an assignee themselves');
select is(public.task_submit_done(pg_temp.fx('fl'), 'v1 at https://example.com/x', null, pg_temp.fx('asha')), 'submitted', 'the coordinator marks Done for her');
select results_eq(
  $$ select t.submitted_by, t.submitted_on_behalf_of from public.tasks t where t.id = pg_temp.fx('fl') $$,
  $$ values (pg_temp.fx('coord'), pg_temp.fx('asha')) $$, 'submitted_by = the coordinator, on behalf of the freelancer');
select results_eq(
  $$ select s.submitted_by, s.on_behalf_of from public.task_submissions s where s.task_id = pg_temp.fx('fl') $$,
  $$ values (pg_temp.fx('coord'), pg_temp.fx('asha')) $$, 'the submission carries the pair');
select is((pg_temp.assignee('fl', 'asha')).acknowledged_by, pg_temp.fx('coord'), 'her implied acknowledgement names the coordinator');
select is((select count(*) from public.activity_log a where a.entity_id = pg_temp.fx('fl') and a.on_behalf_of_id = pg_temp.fx('asha')), 3::bigint,
  'audit: acknowledged, submission_added and submitted all carry on_behalf_of_id');

-- task_review (WORKFLOWS §3.3; the Owner never at the Admin step) -----------------------------------
select pg_temp.as_member('staff1');
select throws_ok(format($$ select public.task_review(%L, 'approved') $$, pg_temp.fx('via')), 'P0001', 'FORBIDDEN', 'an assignee does not review');
select pg_temp.as_member('admin2');
select throws_ok(format($$ select public.task_review(%L, 'approved') $$, pg_temp.fx('via')), 'P0001', 'FORBIDDEN', 'nor another Admin');
select pg_temp.as_member('owner');
select throws_ok(format($$ select public.task_review(%L, 'approved') $$, pg_temp.fx('via')), 'P0001', 'INVALID_STATE',
  'the Owner waits for the approving Admin (change the approver instead)');
select pg_temp.as_member('admin1');
select throws_ok(format($$ select public.task_review(%L, 'rejected') $$, pg_temp.fx('via')), 'P0001', 'REASON_REQUIRED', 'a rejection needs a reason');
select throws_ok(format($$ select public.task_review(%L, null) $$, pg_temp.fx('via')), 'P0001', 'VALIDATION', 'a decision is required');
select throws_ok(format($$ select public.task_review(%L, 'approved') $$, pg_temp.fx('direct')), 'P0001', 'FORBIDDEN',
  'the Admin does not give the final approval (direct: waiting for the Owner)');
select is(public.task_review(pg_temp.fx('via'), 'approved'), 'admin_approved', 'the approving Admin approves');
select ok((pg_temp.task('via')).admin_approved_at is not null, 'admin_approved_at stamped');
select results_eq(
  $$ select r.step, r.decision::text, r.reason, r.reviewer_id, r.submission_id = (select s.id from public.task_submissions s where s.task_id = pg_temp.fx('via'))
     from public.task_reviews r where r.task_id = pg_temp.fx('via') $$,
  $$ values ('admin', 'approved', null::text, pg_temp.fx('admin1'), true) $$, 'one review row at the Admin step, pointing at the submission');
select throws_ok(format($$ select public.task_review(%L, 'approved') $$, pg_temp.fx('via')), 'P0001', 'FORBIDDEN', 'the Admin is done with it');
select pg_temp.as_member('owner');
select throws_ok(format($$ select public.task_review(%L, 'rejected') $$, pg_temp.fx('via')), 'P0001', 'REASON_REQUIRED', 'the Owner''s rejection needs a reason too');
select is(public.task_review(pg_temp.fx('via'), 'rejected', 'Fix the colour grade'), 'changes_requested', 'the Owner sends it back');
select is((select r.reason from public.task_reviews r where r.task_id = pg_temp.fx('via') and r.step = 'owner'), 'Fix the colour grade', 'the reason is on the review row');
select is((select a.meta ->> 'reason' from public.activity_log a where a.entity_id = pg_temp.fx('via') and a.action = 'changes_requested'), 'Fix the colour grade',
  'audit: changes_requested with the reason');
select throws_ok(format($$ select public.task_review(%L, 'approved') $$, pg_temp.fx('via')), 'P0001', 'INVALID_STATE', 'nothing to review while changes are requested');
select pg_temp.as_member('staff1');
select is(public.task_submit_done(pg_temp.fx('via'), 'v2'), 'submitted', 'the primary owner resubmits from changes_requested');
select is((select max(s.version) from public.task_submissions s where s.task_id = pg_temp.fx('via')), 2, 'version 2');
select pg_temp.as_member('admin1');
select is(public.task_review(pg_temp.fx('via'), 'rejected', 'Still off'), 'changes_requested', 'the Admin can send it back too');
select pg_temp.as_member('staff1');
select is(public.task_submit_done(pg_temp.fx('via'), 'v3'), 'submitted', 'and again');
select pg_temp.as_member('admin1');
select is(public.task_review(pg_temp.fx('via'), 'approved'), 'admin_approved', 'approved by the Admin');
select pg_temp.as_member('owner');
select is(public.task_review(pg_temp.fx('via'), 'approved'), 'completed', 'and finally by the Owner');
select ok((pg_temp.task('via')).completed_at is not null, 'completed_at stamped');
select is((select count(*) from public.task_reviews r where r.task_id = pg_temp.fx('via')), 5::bigint, 'five review rows, one per decision');
select throws_ok(format($$ select public.task_review(%L, 'approved') $$, pg_temp.fx('via')), 'P0001', 'INVALID_STATE', 'a complete task is not reviewed again');
select throws_ok(format($$ select public.task_review(%L, 'approved') $$, pg_temp.fx('meet')), 'P0001', 'INVALID_STATE', 'a todo task has nothing to review');
select is(public.task_review(pg_temp.fx('direct'), 'approved'), 'completed', 'the Owner completes a direct task (no Admin step)');
select is((select r.step from public.task_reviews r where r.task_id = pg_temp.fx('direct')), 'owner', 'one owner-step review');

-- task_reopen ---------------------------------------------------------------------------------------
select pg_temp.as_member('staff1');
select throws_ok(format($$ select public.task_reopen(%L, 'again') $$, pg_temp.fx('via')), 'P0001', 'FORBIDDEN', 'an assignee does not reopen');
select pg_temp.as_member('admin2');
select throws_ok(format($$ select public.task_reopen(%L, 'again') $$, pg_temp.fx('via')), 'P0001', 'FORBIDDEN', 'nor an Admin who is not creator or approver');
select pg_temp.as_member('owner');
select throws_ok(format($$ select public.task_reopen(%L, '  ') $$, pg_temp.fx('via')), 'P0001', 'REASON_REQUIRED', 'a reason is required');
select throws_ok(format($$ select public.task_reopen(%L, 'why') $$, pg_temp.fx('meet')), 'P0001', 'INVALID_STATE', 'only completed or cancelled');
select pg_temp.as_member('admin1');
select is(public.task_reopen(pg_temp.fx('via'), 'One more pass on the audio'), 'in_progress', 'the approving Admin reopens a completed task');
select results_eq(
  $$ select t.admin_step::text, t.completed_at, t.submitted_at, t.admin_approved_at from public.tasks t where t.id = pg_temp.fx('via') $$,
  $$ values ('required', null::timestamptz, null::timestamptz, null::timestamptz) $$, 'the route is walked again: the stamps cleared, the step required');
select is((pg_temp.assignee('via', 'staff1')).acknowledged_at is not null, true, 'acknowledgements are kept');
select is((select a.meta ->> 'reason' from public.activity_log a where a.entity_id = pg_temp.fx('via') and a.action = 'reopened'), 'One more pass on the audio',
  'audit: reopened with the reason (the only place it lives)');
select is((select count(*) from public.task_reviews r where r.task_id = pg_temp.fx('via')), 5::bigint, 'the review history stays');

-- task_cancel ---------------------------------------------------------------------------------------
select pg_temp.as_member('staff2');
select throws_ok(format($$ select public.task_cancel(%L, 'no') $$, pg_temp.fx('meet')), 'P0001', 'FORBIDDEN', 'an assignee does not cancel');
select pg_temp.as_member('owner');
select throws_ok(format($$ select public.task_cancel(%L, null) $$, pg_temp.fx('meet')), 'P0001', 'REASON_REQUIRED', 'a reason is required');
select throws_ok(format($$ select public.task_cancel(%L, 'done anyway') $$, pg_temp.fx('direct')), 'P0001', 'INVALID_STATE', 'a completed task is reopened, not cancelled');
select is(public.task_cancel(pg_temp.fx('meet'), 'The client postponed'), 'cancelled', 'the Owner cancels');
select results_eq(
  $$ select t.cancelled_reason, t.cancelled_at is not null from public.tasks t where t.id = pg_temp.fx('meet') $$,
  $$ values ('The client postponed', true) $$, 'the reason and the time are on the row');
select throws_ok(format($$ select public.task_cancel(%L, 'again') $$, pg_temp.fx('meet')), 'P0001', 'INVALID_STATE', 'cancelled once');
select pg_temp.as_member('staff2');
select throws_ok(format($$ select public.task_acknowledge(%L) $$, pg_temp.fx('meet')), 'P0001', 'INVALID_STATE', 'a cancelled task is closed to Task Noted');
select throws_ok(format($$ select public.task_start(%L) $$, pg_temp.fx('meet')), 'P0001', 'INVALID_STATE', 'and to starting');
select throws_ok(format($$ select public.task_submit_done(%L) $$, pg_temp.fx('meet')), 'P0001', 'INVALID_STATE', 'and to Done');
select pg_temp.as_member('owner');
select is(public.task_reopen(pg_temp.fx('meet'), 'Back on'), 'todo', 'a cancelled task reopens to todo');
select is((pg_temp.task('meet')).cancelled_reason, null, 'the cancellation cleared (the audit diff keeps it)');

-- task_update_assignment ----------------------------------------------------------------------------
select pg_temp.as_member('staff1');
select throws_ok(format($$ select public.task_update_assignment(%L, '{"title": "Mine"}') $$, pg_temp.fx('via')), 'P0001', 'FORBIDDEN', 'an assignee does not edit');
select pg_temp.as_member('admin2');
select throws_ok(format($$ select public.task_update_assignment(%L, '{"title": "Mine"}') $$, pg_temp.fx('via')), 'P0001', 'FORBIDDEN', 'nor an Admin who sees it without being creator or approver');
select pg_temp.as_member('admin1');
select is(public.task_update_assignment(pg_temp.fx('via'), '{"title": " Owner via Admin, v2 ", "priority": "urgent"}'), array['priority', 'title'],
  'the approving Admin changes title and priority: the changed fields come back');
select results_eq(
  $$ select t.title, t.priority::text from public.tasks t where t.id = pg_temp.fx('via') $$,
  $$ values ('Owner via Admin, v2', 'urgent') $$, 'trimmed and stored');
select results_eq(
  $$ select a.meta -> 'fields', a.diff -> 'old' ->> 'priority', a.diff -> 'new' ->> 'priority' from public.activity_log a
     where a.entity_id = pg_temp.fx('via') and a.action = 'updated' $$,
  $$ values ('["priority", "title"]'::jsonb, 'medium', 'urgent') $$, 'audit: updated, the fields and the old / new values');
select throws_ok(format($$ select public.task_update_assignment(%L, '{"colour": "red"}') $$, pg_temp.fx('via')), 'P0001', 'VALIDATION', 'an unknown field');
select throws_ok(format($$ select public.task_update_assignment(%L, '{}') $$, pg_temp.fx('via')), 'P0001', 'VALIDATION', 'nothing to change');
select throws_ok(format($$ select public.task_update_assignment(%L, '{"priority": "urgent"}') $$, pg_temp.fx('via')), 'P0001', 'VALIDATION', 'nothing changed');
select throws_ok(format($$ select public.task_update_assignment(%L, '{"title": ""}') $$, pg_temp.fx('via')), 'P0001', 'VALIDATION', 'a title is required');
select throws_ok(format($$ select public.task_update_assignment(%L, '{"due_at": null}') $$, pg_temp.fx('via')), 'P0001', 'VALIDATION', 'the deadline stays required');
select throws_ok(format($$ select public.task_update_assignment(%L, jsonb_build_object('client_id', %L)) $$, pg_temp.fx('via'), pg_temp.fx('client_b')),
  'P0001', 'FORBIDDEN', 'an Admin labels only their own clients');
select throws_ok(format($$ select public.task_update_assignment(%L, jsonb_build_object('assignee_ids', jsonb_build_array(%L, %L), 'primary_owner_id', %L)) $$,
  pg_temp.fx('via'), pg_temp.fx('staff1'), pg_temp.fx('owner'), pg_temp.fx('staff1')), 'P0001', 'VALIDATION', 'the Owner is never an assignee');
select throws_ok(format($$ select public.task_update_assignment(%L, jsonb_build_object('primary_owner_id', %L)) $$, pg_temp.fx('via'), pg_temp.fx('staff2')),
  'P0001', 'VALIDATION', 'the primary owner must be an assignee');
select throws_ok(format($$ select public.task_update_assignment(%L, '{"event_date": "2026-10-01"}') $$, pg_temp.fx('via')), 'P0001', 'VALIDATION',
  'the type''s field rules apply to edits');
select pg_temp.as_member('owner');
select is(public.task_update_assignment(pg_temp.fx('via'), jsonb_build_object('client_id', pg_temp.fx('client_b'))), array['client_id'], 'the Owner sets any label');
select is(public.task_update_assignment(pg_temp.fx('via'), jsonb_build_object('assignee_ids', jsonb_build_array(pg_temp.fx('staff1'), pg_temp.fx('staff2'), pg_temp.fx('asha')))),
  array['assignee_ids'], 'two people added');
select bag_eq(
  $$ select a.member_id, a.is_primary, a.acknowledged_at is null, a.assigned_by from public.task_assignees a where a.task_id = pg_temp.fx('via') $$,
  $$ values (pg_temp.fx('staff1'), true, false, pg_temp.fx('owner')), (pg_temp.fx('asha'), false, true, pg_temp.fx('owner')), (pg_temp.fx('staff2'), false, true, pg_temp.fx('owner')) $$,
  'the added people start their own acknowledgement; staff1 keeps theirs');
select is(public.task_update_assignment(pg_temp.fx('via'), jsonb_build_object('assignee_ids', jsonb_build_array(pg_temp.fx('staff1'), pg_temp.fx('staff2')), 'primary_owner_id', pg_temp.fx('staff2'))),
  array['assignee_ids', 'primary_owner_id'], 'the freelancer removed, staff2 made primary');
select bag_eq(
  $$ select a.member_id, a.is_primary, a.removed_at is not null from public.task_assignees a where a.task_id = pg_temp.fx('via') $$,
  $$ values (pg_temp.fx('staff1'), false, false), (pg_temp.fx('staff2'), true, false), (pg_temp.fx('asha'), false, true) $$,
  'the removed row stays with removed_at; one primary among the active rows');
select is((pg_temp.task('via')).primary_owner_id, pg_temp.fx('staff2'), 'tasks.primary_owner_id follows');
select ok((select count(*) from public.activity_log a where a.entity_id = pg_temp.fx('via') and a.action in ('unassigned', 'primary_changed')) >= 2,
  'audit: unassigned and primary_changed');
select pg_temp.as_member('coord');
select is((select count(*) from public.tasks t where t.id = pg_temp.fx('via')), 0::bigint, 'the coordinator lost the task with the freelancer');
select pg_temp.as_member('staff1');
select throws_ok(format($$ select public.task_acknowledge(%L, %L) $$, pg_temp.fx('via'), pg_temp.fx('asha')), 'P0001', 'FORBIDDEN', 'a removed freelancer is no assignee');
select pg_temp.as_member('owner');
select is(public.task_update_assignment(pg_temp.fx('via'), jsonb_build_object('assignee_ids', jsonb_build_array(pg_temp.fx('staff1'), pg_temp.fx('staff2'), pg_temp.fx('asha')))),
  array['assignee_ids'], 'the freelancer re-added');
select results_eq(
  $$ select a.removed_at is null, a.acknowledged_at is null from public.task_assignees a where a.task_id = pg_temp.fx('via') and a.member_id = pg_temp.fx('asha') $$,
  $$ values (true, true) $$, 'her row is open again with a fresh acknowledgement to give');
select is((select a.meta ->> 'again' from public.activity_log a where a.entity_id = pg_temp.fx('via') and a.action = 'assigned' order by a.id desc limit 1), 'true',
  'audit: assigned again');
select is(public.task_update_assignment(pg_temp.fx('via'), jsonb_build_object('task_type_id', pg_temp.type_id('Meeting'), 'event_date', (app.today_ist() + 2)::text, 'location', 'Studio')),
  array['event_date', 'location', 'task_type_id'], 'the type can change with the fields it needs');
select is(public.task_update_assignment(pg_temp.fx('via'), '{"description": "Bring the deck"}', jsonb_build_array(jsonb_build_object('kind', 'on_leave', 'member_id', pg_temp.fx('staff2')))),
  array['description'], 'warnings are recorded on an edit too');
select is((select count(*) from public.task_warnings w where w.task_id = pg_temp.fx('via')), 1::bigint, '(one row)');
select throws_ok(format($$ select public.task_update_assignment(%L, '{"title": "x"}') $$, pg_temp.fx('direct')), 'P0001', 'INVALID_STATE', 'a completed task is reopened first');

-- task_set_approver (WORKFLOWS §3.1) ----------------------------------------------------------------
select pg_temp.as_member('admin1');
select throws_ok(format($$ select public.task_set_approver(%L, %L) $$, pg_temp.fx('via'), pg_temp.fx('admin2')), 'P0001', 'FORBIDDEN', 'only the Owner changes the approver');
select pg_temp.as_member('owner');
select throws_ok(format($$ select public.task_set_approver(%L, %L) $$, pg_temp.fx('via'), pg_temp.fx('staff1')), 'P0001', 'VALIDATION', 'an Admin, not Staff');
select throws_ok(format($$ select public.task_set_approver(%L, %L) $$, pg_temp.fx('via'), pg_temp.fx('oldadmin')), 'P0001', 'VALIDATION', 'an active Admin');
select throws_ok(format($$ select public.task_set_approver(%L, %L) $$, pg_temp.fx('via'), pg_temp.fx('admin1')), 'P0001', 'VALIDATION', 'already the approver');
select throws_ok(format($$ select public.task_set_approver(%L, null) $$, pg_temp.fx('direct')), 'P0001', 'INVALID_STATE', 'not on a completed task');
select is(public.task_set_approver(pg_temp.fx('via'), pg_temp.fx('admin2')), 'in_progress', 'the Owner names another Admin on an open task');
select results_eq(
  $$ select t.approving_admin_id, t.admin_step::text from public.tasks t where t.id = pg_temp.fx('via') $$,
  $$ values (pg_temp.fx('admin2'), 'required') $$, 'the approver and the step');
select is(public.task_set_approver(pg_temp.fx('via'), null), 'in_progress', 'and removes it');
select is((pg_temp.task('via')).admin_step::text, 'none', 'no Admin step now');
select results_eq(
  $$ select a.meta ->> 'from', a.meta ->> 'to' from public.activity_log a where a.entity_id = pg_temp.fx('via') and a.action = 'approver_changed' order by a.id desc limit 1 $$,
  $$ values (pg_temp.fx('admin2')::text, null::text) $$, 'audit: approver_changed from / to');
-- While submitted: the review moves, or the task goes to the Owner at once.
select is(public.task_set_approver(pg_temp.fx('unacked'), pg_temp.fx('admin2')), 'submitted', 'a submitted task keeps waiting, for the new approver');
select pg_temp.as_member('admin1');
select throws_ok(format($$ select public.task_review(%L, 'approved') $$, pg_temp.fx('unacked')), 'P0001', 'FORBIDDEN', 'the former approver is refused');
select pg_temp.as_member('admin2');
select is(public.task_review(pg_temp.fx('unacked'), 'approved'), 'admin_approved', 'the new approver reviews');
select pg_temp.as_member('owner');
select is(public.task_set_approver(pg_temp.fx('unacked'), null), 'admin_approved', 'removing the approver while the Owner''s turn: the state stays');
select is((pg_temp.task('unacked')).admin_step::text, 'none', '(the step reads none)');
select is(public.task_set_approver(pg_temp.fx('late'), null), 'admin_approved', 'removing the approver of a submitted task sends it to the Owner');
select is((pg_temp.task('late')).admin_step::text, 'none', '(admin_step none)');
select is(public.task_set_approver(pg_temp.fx('fl'), pg_temp.fx('admin2')), 'submitted', 'a new approver on Asha''s submitted task: still submitted');
insert into fx values ('adm_on', pg_temp.mk('Admin assigned', array['admin2', 'staff1'], 'staff1', 'admin1'));
select pg_temp.as_member('staff1');
select is(public.task_submit_done(pg_temp.fx('adm_on')), 'submitted', 'submitted to admin1');
select pg_temp.as_member('owner');
select is(public.task_set_approver(pg_temp.fx('adm_on'), pg_temp.fx('admin2')), 'admin_approved', 'naming an assignee as approver while submitted skips the step');
select is((pg_temp.task('adm_on')).admin_step::text, 'skipped', '(admin_step skipped)');

select * from finish();
rollback;
