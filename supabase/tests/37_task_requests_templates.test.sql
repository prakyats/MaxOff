-- 4C (tasks 4.5, 4.6; migration phase4c_requests_templates): task templates (RLS per role: shared
-- company-wide, an Admin edits their own, the Owner any; the guard's author, type and stage rules;
-- no delete), tasks.template_id (a foreign key, an active template of the organization), task
-- requests (RLS per role, PERMISSIONS §2; every path of task_request_create / _withdraw / _decline
-- / _convert, WORKFLOWS §3.4), task_type_move (the Owner's order) and task_counts (the badges,
-- Kickoff 4 decision 16).
begin;
create extension if not exists pgtap with schema extensions;
select plan(81);

-- Fixtures as 36. Rolled back at the end.
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
delete from public.members;
delete from auth.identities;
delete from auth.users;
delete from public.activity_log;
delete from public.holidays;
update public.org_settings set weekly_off_days = '{}';

create temporary table fx (key text primary key, id uuid not null);
insert into fx values
  ('owner',    '00000000-0000-4000-8000-000000000a01'),
  ('admin1',   '00000000-0000-4000-8000-000000000a02'),
  ('admin2',   '00000000-0000-4000-8000-000000000a03'),
  ('staff1',   '00000000-0000-4000-8000-000000000a04'),
  ('staff2',   '00000000-0000-4000-8000-000000000a05'),
  ('coord',    '00000000-0000-4000-8000-000000000a06'),
  ('client_a', '00000000-0000-4000-8000-000000000a11'),
  ('client_b', '00000000-0000-4000-8000-000000000a12'),
  ('client_d', '00000000-0000-4000-8000-000000000a13');
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

create function pg_temp.request(k text) returns public.task_requests language sql stable as $$
  select r.* from public.task_requests r where r.id = pg_temp.fx(k);
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

create function pg_temp.counts() returns text language sql stable as $$
  select c.not_noted || '/' || c.changes_requested || '/' || c.badge || '/' || c.to_decide
  from public.task_counts() c;
$$;

insert into auth.users (id, email)
select id, key || '@example.com' from fx where key not like 'client%' and key <> 'org';

insert into public.members (id, org_id, full_name, email, role, status, joined_at)
select pg_temp.fx(k), pg_temp.fx('org'), k, k || '@example.com', r::public.member_role, 'active', now() - interval '30 days'
from (values ('owner', 'owner'), ('admin1', 'admin'), ('admin2', 'admin'), ('staff1', 'staff'),
             ('staff2', 'staff'), ('coord', 'staff')) as v(k, r);

insert into public.clients (id, org_id, name, state, admin_id, activated_at) values
  (pg_temp.fx('client_a'), pg_temp.fx('org'), 'Sharma Weddings', 'active', pg_temp.fx('admin1'), now()),
  (pg_temp.fx('client_b'), pg_temp.fx('org'), 'Blue Bakery', 'active', pg_temp.fx('admin2'), now()),
  (pg_temp.fx('client_d'), pg_temp.fx('org'), 'Draft Studio', 'draft', pg_temp.fx('admin1'), null);

select pg_temp.as_member('owner');
insert into fx values ('asha', public.member_add_freelancer('Asha', null, null, pg_temp.fx('coord')));

-- 1. Templates ----------------------------------------------------------------------------------------
select pg_temp.as_member('owner');
select lives_ok($$ with t as (
    insert into public.task_templates (name, task_type_id, description, default_priority, stages, field_defaults)
    values ('Reel edit', pg_temp.type_id('Normal'), 'Cut, grade, export', 'high', array[' Cut ', 'Grade'], '{"format": "9:16"}')
    returning id) insert into fx select 'tpl_owner', id from t $$,
  'the Owner creates a template (templates.manage)');
select is((select t.created_by from public.task_templates t where t.id = pg_temp.fx('tpl_owner')), pg_temp.fx('owner'),
  'written by the caller');
select is((select t.stages from public.task_templates t where t.id = pg_temp.fx('tpl_owner')), array['Cut', 'Grade'],
  'the stages trimmed');
select pg_temp.as_member('admin1');
select lives_ok($$ with t as (
    insert into public.task_templates (name, task_type_id, stages)
    values ('Shoot day', pg_temp.type_id('Shoot / Site Visit'), array['Brief', 'Shoot'])
    returning id) insert into fx select 'tpl_admin1', id from t $$,
  'an Admin creates a template');
select throws_ok($$ insert into public.task_templates (name, task_type_id, created_by)
    values ('Not mine', pg_temp.type_id('Normal'), pg_temp.fx('admin2')) $$,
  '42501', null, 'the author is never chosen through the API');
select throws_ok($$ insert into public.task_templates (name, task_type_id) values ('Reel edit', pg_temp.type_id('Normal')) $$,
  '23505', null, 'two active templates never share a name');
select throws_ok($$ insert into public.task_templates (name, task_type_id, stages) values ('Long', pg_temp.type_id('Normal'), array[repeat('x', 121)]) $$,
  'P0001', 'VALIDATION', 'a stage is at most 120 characters');
select throws_ok($$ insert into public.task_templates (name, task_type_id, stages) values ('Blank', pg_temp.type_id('Normal'), array['  ']) $$,
  'P0001', 'VALIDATION', 'and never blank');
select pg_temp.as_member('staff1');
select throws_ok($$ insert into public.task_templates (name, task_type_id) values ('Staff', pg_temp.type_id('Normal')) $$,
  '42501', null, 'Staff create no template');
select is((select count(*) from public.task_templates), 0::bigint, 'and read none');
select pg_temp.as_member('admin2');
select is((select count(*) from public.task_templates), 2::bigint, 'another Admin reads every template (shared company-wide)');
select is(pg_temp.rows(format('update public.task_templates set name = ''Hijacked'' where id = %L', pg_temp.fx('tpl_admin1'))), 0::bigint,
  'but edits no one else''s (decision 19)');
select is(pg_temp.rows(format('update public.task_templates set archived_at = now() where id = %L', pg_temp.fx('tpl_owner'))), 0::bigint,
  'nor archives the Owner''s');
select pg_temp.as_member('admin1');
select is(pg_temp.rows(format('update public.task_templates set name = ''Shoot day (full)'' where id = %L', pg_temp.fx('tpl_admin1'))), 1::bigint,
  'the Admin edits their own');
select throws_ok(format($$ update public.task_templates set created_by = %L where id = %L $$, pg_temp.fx('admin2'), pg_temp.fx('tpl_admin1')),
  '42501', null, 'the author never changes');
select throws_ok(format($$ delete from public.task_templates where id = %L $$, pg_temp.fx('tpl_admin1')),
  '42501', null, 'a template is archived, never deleted');
select pg_temp.as_member('owner');
select is(pg_temp.rows(format('update public.task_templates set description = ''Owner''''s note'' where id = %L', pg_temp.fx('tpl_admin1'))), 1::bigint,
  'the Owner edits any template');
select pg_temp.as_system();
update public.task_types set archived_at = now() where id = pg_temp.type_id('Other');
select pg_temp.as_member('owner');
select throws_ok(format($$ update public.task_templates set task_type_id = %L where id = %L $$, pg_temp.type_id('Other'), pg_temp.fx('tpl_owner')),
  'P0001', 'VALIDATION', 'an archived type is never chosen for a template');
select ok(exists (select 1 from public.activity_log a where a.entity = 'task_templates' and a.entity_id = pg_temp.fx('tpl_owner')),
  'a template is audited');

-- 2. tasks.template_id --------------------------------------------------------------------------------
select pg_temp.as_member('owner');
select lives_ok(format($$ insert into fx values ('t_tpl', public.task_create('From a template', null, %L::uuid, null, 'high', pg_temp.due(), array[%L::uuid], %L::uuid, template_id => %L::uuid)) $$,
  pg_temp.type_id('Normal'), pg_temp.fx('staff1'), pg_temp.fx('staff1'), pg_temp.fx('tpl_owner')),
  'a task records the template it started from');
select is((select t.template_id from public.tasks t where t.id = pg_temp.fx('t_tpl')), pg_temp.fx('tpl_owner'), 'the task names it');
select throws_ok(format($$ select public.task_create('Unknown template', null, %L::uuid, null, 'high', pg_temp.due(), array[%L::uuid], %L::uuid, template_id => gen_random_uuid()) $$,
  pg_temp.type_id('Normal'), pg_temp.fx('staff1'), pg_temp.fx('staff1')),
  'P0001', 'VALIDATION', 'a template that does not exist is refused (4A later item L3)');
update public.task_templates set archived_at = now() where id = pg_temp.fx('tpl_admin1');
select throws_ok(format($$ select public.task_create('Archived template', null, %L::uuid, null, 'high', pg_temp.due(), array[%L::uuid], %L::uuid, template_id => %L::uuid) $$,
  pg_temp.type_id('Normal'), pg_temp.fx('staff1'), pg_temp.fx('staff1'), pg_temp.fx('tpl_admin1')),
  'P0001', 'VALIDATION', 'and so is an archived one');
select ok(exists (select 1 from pg_constraint c where c.conname = 'tasks_template_id_fkey' and c.contype = 'f'),
  'tasks.template_id is a foreign key to task_templates');

-- 3. Task requests ------------------------------------------------------------------------------------
-- A task labelled with client A gives staff1 its label (client_labels).
select pg_temp.as_member('owner');
insert into fx values ('t_label', public.task_create('Labelled', null, pg_temp.type_id('Normal'), pg_temp.fx('client_a'), 'medium',
  pg_temp.due(), array[pg_temp.fx('staff1')], pg_temp.fx('staff1')));

select pg_temp.as_member('staff1');
select lives_ok($$ insert into fx values ('r1', public.task_request_create('New intro reel', 'Thirty seconds, for the launch')) $$,
  'Staff suggest a task (task_requests.create)');
select is((pg_temp.request('r1')).state, 'pending'::public.request_state, 'pending');
select is((pg_temp.request('r1')).requested_by, pg_temp.fx('staff1'), 'by the caller');
select lives_ok(format($$ insert into fx values ('r2', public.task_request_create('Anniversary post', null, %L::uuid)) $$, pg_temp.fx('client_a')),
  'with a client label they can see (a label on their task)');
select throws_ok(format($$ select public.task_request_create('For another client', null, %L::uuid) $$, pg_temp.fx('client_b')),
  'P0001', 'NOT_FOUND', 'never a client they cannot see (ADR-0005)');
select throws_ok($$ select public.task_request_create('   ') $$, 'P0001', 'VALIDATION', 'a title is required');
select throws_ok($$ insert into public.task_requests (requested_by, title) values (auth.uid(), 'Direct') $$,
  '42501', null, 'no API writes: a request is only made through the function');
select ok(exists (select 1 from public.activity_log a where a.entity = 'task_requests' and a.entity_id = pg_temp.fx('r1') and a.action = 'requested'),
  'audited: requested');

select pg_temp.as_member('staff2');
select lives_ok($$ insert into fx values ('r3', public.task_request_create('Tidy the drive')) $$, 'another Staff member suggests one');
select pg_temp.as_member('admin1');
select throws_ok(format($$ select public.task_request_create('For my draft', null, %L::uuid) $$, pg_temp.fx('client_d')),
  'P0001', 'VALIDATION', 'a Draft client is no label for a suggestion either (decision 22)');
select lives_ok(format($$ insert into fx values ('r4', public.task_request_create('Retainer plan', null, %L::uuid)) $$, pg_temp.fx('client_a')),
  'an Admin suggests one with their own client');
select pg_temp.as_member('owner');
select throws_ok($$ select public.task_request_create('The Owner assigns') $$, 'P0001', 'FORBIDDEN',
  'the Owner creates tasks, never suggests them (task_requests.create is Admin and Staff)');

-- Who sees what (PERMISSIONS §2).
select pg_temp.as_member('owner');
select is((select count(*) from public.task_requests), 4::bigint, 'the Owner sees every request');
select pg_temp.as_member('admin1');
select is((select string_agg(f.key, ',' order by f.key) from public.task_requests r join fx f on f.id = r.id), 'r1,r2,r3,r4',
  'admin1: their own, those with no client and those labelled with their client');
select pg_temp.as_member('admin2');
select is((select string_agg(f.key, ',' order by f.key) from public.task_requests r join fx f on f.id = r.id), 'r1,r3',
  'admin2: only those with no client (never admin1''s client''s)');
select pg_temp.as_member('staff1');
select is((select string_agg(f.key, ',' order by f.key) from public.task_requests r join fx f on f.id = r.id), 'r1,r2',
  'Staff: their own only');
select pg_temp.as_member('staff2');
select is((select string_agg(f.key, ',' order by f.key) from public.task_requests r join fx f on f.id = r.id), 'r3',
  'and another Staff member theirs');

-- Withdraw.
select pg_temp.as_member('staff2');
select throws_ok(format($$ select public.task_request_withdraw(%L) $$, pg_temp.fx('r1')), 'P0001', 'NOT_FOUND',
  'nobody withdraws a request they cannot see');
select pg_temp.as_member('admin1');
select throws_ok(format($$ select public.task_request_withdraw(%L) $$, pg_temp.fx('r1')), 'P0001', 'FORBIDDEN',
  'a decider does not withdraw someone else''s request');
select pg_temp.as_member('staff2');
select is(public.task_request_withdraw(pg_temp.fx('r3')), 'withdrawn'::public.request_state, 'the requester withdraws their own');
select throws_ok(format($$ select public.task_request_withdraw(%L) $$, pg_temp.fx('r3')), 'P0001', 'INVALID_STATE',
  'once');
select ok(exists (select 1 from public.activity_log a where a.entity_id = pg_temp.fx('r3') and a.action = 'withdrawn'),
  'audited: withdrawn');

-- Decline.
select pg_temp.as_member('staff1');
select throws_ok(format($$ select public.task_request_decline(%L, 'no') $$, pg_temp.fx('r1')), 'P0001', 'FORBIDDEN',
  'Staff decide no request');
select pg_temp.as_member('admin2');
select throws_ok(format($$ select public.task_request_decline(%L, 'not ours') $$, pg_temp.fx('r2')), 'P0001', 'NOT_FOUND',
  'an Admin never decides a request labelled with another Admin''s client');
select pg_temp.as_member('admin1');
select throws_ok(format($$ select public.task_request_decline(%L, '  ') $$, pg_temp.fx('r2')), 'P0001', 'REASON_REQUIRED',
  'a decline needs a reason');
select is(public.task_request_decline(pg_temp.fx('r2'), 'The client paused this month'), 'declined'::public.request_state,
  'the client''s Admin declines it');
select results_eq(format($$ select r.state, r.decision_reason, r.decided_by from public.task_requests r where r.id = %L $$, pg_temp.fx('r2')),
  format($$ values ('declined'::public.request_state, 'The client paused this month', %L::uuid) $$, pg_temp.fx('admin1')),
  'with the reason and who decided');
select throws_ok(format($$ select public.task_request_decline(%L, 'again') $$, pg_temp.fx('r2')), 'P0001', 'INVALID_STATE',
  'a decided request is not decided again');
select pg_temp.as_member('staff1');
select is((pg_temp.request('r2')).decision_reason, 'The client paused this month', 'the requester reads the reason');
select ok(exists (select 1 from public.activity_log a where a.entity_id = pg_temp.fx('r2') and a.action = 'declined'),
  'and the history entry (audited: declined)');

-- Convert.
select pg_temp.as_member('admin2');
select throws_ok(format($$ select public.task_request_convert(%L, 'Intro reel', null, %L::uuid, null, 'medium', now() - interval '1 hour', array[%L::uuid], %L::uuid) $$,
  pg_temp.fx('r1'), pg_temp.type_id('Normal'), pg_temp.fx('staff1'), pg_temp.fx('staff1')),
  'P0001', 'VALIDATION', 'the task''s own rules hold (a past deadline)');
select is((pg_temp.request('r1')).state, 'pending'::public.request_state, 'and the request stays pending (one transaction)');
select lives_ok(format($$ insert into fx values ('t_conv', public.task_request_convert(%L, 'Intro reel', 'Thirty seconds', %L::uuid, null, 'medium', pg_temp.due(), array[%L::uuid], %L::uuid, stages => array['Script'])) $$,
  pg_temp.fx('r1'), pg_temp.type_id('Normal'), pg_temp.fx('staff1'), pg_temp.fx('staff1')),
  'an Admin who sees it converts a request into a task');
select results_eq(format($$ select r.state, r.task_id, r.decided_by from public.task_requests r where r.id = %L $$, pg_temp.fx('r1')),
  format($$ values ('converted'::public.request_state, %L::uuid, %L::uuid) $$, pg_temp.fx('t_conv'), pg_temp.fx('admin2')),
  'converted, naming the task and who decided');
select results_eq(format($$ select t.created_by, t.approving_admin_id, t.title from public.tasks t where t.id = %L $$, pg_temp.fx('t_conv')),
  format($$ values (%L::uuid, %L::uuid, 'Intro reel') $$, pg_temp.fx('admin2'), pg_temp.fx('admin2')),
  'the task is the decider''s own, routed to them (PRODUCT §4.6)');
select throws_ok(format($$ select public.task_request_convert(%L, 'Again', null, %L::uuid, null, 'medium', pg_temp.due(), array[%L::uuid], %L::uuid) $$,
  pg_temp.fx('r1'), pg_temp.type_id('Normal'), pg_temp.fx('staff1'), pg_temp.fx('staff1')),
  'P0001', 'INVALID_STATE', 'a converted request is not converted again');
select ok(exists (select 1 from public.activity_log a where a.entity_id = pg_temp.fx('r1') and a.action = 'converted'),
  'audited: converted');
select pg_temp.as_member('staff1');
select is((select count(*) from public.tasks t where t.id = pg_temp.fx('t_conv')), 1::bigint,
  'the requester, assigned, sees the task');
select pg_temp.as_member('staff2');
select throws_ok(format($$ select public.task_request_convert(%L, 'x', null, %L::uuid, null, 'medium', pg_temp.due(), array[%L::uuid], %L::uuid) $$,
  pg_temp.fx('r4'), pg_temp.type_id('Normal'), pg_temp.fx('staff1'), pg_temp.fx('staff1')),
  'P0001', 'FORBIDDEN', 'Staff convert nothing');
select pg_temp.as_member('owner');
select lives_ok(format($$ insert into fx values ('t_conv2', public.task_request_convert(%L, 'Retainer plan', null, %L::uuid, %L::uuid, 'low', pg_temp.due(), array[%L::uuid], %L::uuid, %L::uuid)) $$,
  pg_temp.fx('r4'), pg_temp.type_id('Normal'), pg_temp.fx('client_a'), pg_temp.fx('staff2'), pg_temp.fx('staff2'), pg_temp.fx('admin1')),
  'the Owner converts any request, through an Admin');
select is((pg_temp.request('r4')).task_id, pg_temp.fx('t_conv2'), 'naming the task');

-- 4. task_type_move ----------------------------------------------------------------------------------
select pg_temp.as_member('admin1');
select throws_ok(format($$ select public.task_type_move(%L, 'up') $$, pg_temp.type_id('Meeting')), 'P0001', 'FORBIDDEN',
  'an Admin never reorders the task types (decision 15)');
select pg_temp.as_member('owner');
select is(public.task_type_move(pg_temp.type_id('Meeting'), 'up'), pg_temp.type_id('Shoot / Site Visit'),
  'the Owner moves Meeting up past Shoot / Site Visit');
select ok((select a.position < b.position from public.task_types a, public.task_types b
           where a.id = pg_temp.type_id('Meeting') and b.id = pg_temp.type_id('Shoot / Site Visit')),
  'the two positions swapped');
select is(public.task_type_move(pg_temp.type_id('Normal'), 'up'), null, 'the first one stays first');
select throws_ok(format($$ select public.task_type_move(%L, 'down') $$, pg_temp.type_id('Other')), 'P0001', 'NOT_FOUND',
  'an archived type is not in the list');
select throws_ok(format($$ select public.task_type_move(%L, 'sideways') $$, pg_temp.type_id('Normal')), 'P0001', 'VALIDATION',
  'up or down only');
-- The archived type is skipped: Review / Approval moves down past Other to Custom.
select is(public.task_type_move(pg_temp.type_id('Review / Approval'), 'down'), pg_temp.type_id('Custom'),
  'an archived type is skipped by a move');

-- 5. task_counts -------------------------------------------------------------------------------------
-- staff2: t_conv2 (not noted), t_cr (changes requested, noted), t_done (noted, completed).
select pg_temp.as_member('owner');
insert into fx values ('t_cr', public.task_create('Needs a fix', null, pg_temp.type_id('Normal'), null, 'medium',
  pg_temp.due(), array[pg_temp.fx('staff2')], pg_temp.fx('staff2')));
insert into fx values ('t_done', public.task_create('All done', null, pg_temp.type_id('Normal'), null, 'medium',
  pg_temp.due(), array[pg_temp.fx('staff2')], pg_temp.fx('staff2')));
insert into fx values ('t_fl', public.task_create('For Asha', null, pg_temp.type_id('Normal'), null, 'medium',
  pg_temp.due(), array[pg_temp.fx('asha')], pg_temp.fx('asha'), pg_temp.fx('admin1')));
select pg_temp.as_member('staff2');
select public.task_submit_done(pg_temp.fx('t_cr'));
select public.task_submit_done(pg_temp.fx('t_done'));
select pg_temp.as_member('owner');
select public.task_review(pg_temp.fx('t_cr'), 'rejected', 'Brighter');
select public.task_review(pg_temp.fx('t_done'), 'approved');

select pg_temp.as_member('staff2');
select is(pg_temp.counts(), '1/1/2/0', 'Staff: one not noted, one with changes requested, both on the badge; a completed task never counts');
select public.task_acknowledge(pg_temp.fx('t_conv2'));
select is(pg_temp.counts(), '0/1/1/0', 'noting it takes it off the badge');
select pg_temp.as_member('coord');
select is(pg_temp.counts(), '1/0/1/0', 'a coordinator''s badge counts their freelancer''s task not noted (decision 16)');
select public.task_acknowledge(pg_temp.fx('t_fl'), pg_temp.fx('asha'));
select public.task_submit_done(pg_temp.fx('t_fl'), null, null, pg_temp.fx('asha'));
select is(pg_temp.counts(), '0/0/0/0', 'and not once it is noted and done for them');
select pg_temp.as_member('admin1');
select is(pg_temp.counts(), '0/0/0/1', 'the approving Admin decides the task waiting for their check');
select pg_temp.as_member('admin2');
select is(pg_temp.counts(), '0/0/0/0', 'another Admin decides nothing');
select pg_temp.as_member('owner');
select public.task_set_approver(pg_temp.fx('t_fl'), null);
select is(pg_temp.counts(), '0/0/0/1', 'the Owner decides what waits for the final approval');
select pg_temp.as_member('admin1');
select is(pg_temp.counts(), '0/0/0/0', 'and the Admin no longer, once the Owner took the step');
select pg_temp.as_system();
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000999', true);
select set_config('role', 'authenticated', true);
select is((select count(*) from public.task_counts()), 0::bigint, 'no member row: no counts');
select pg_temp.as_system();

select * from finish();
rollback;
