-- 4A independent review fixes (migration phase4a_review_fixes): M1 task_warnings and their activity
-- entries need availability.view (a co-assignee and a Staff coordinator read none; the Owner and the
-- approving Admin do); M2 the whole deactivate / set coordinator / deactivate the coordinator /
-- reactivate sequence (member_deactivate closes a deactivated freelancer's row pointing at the
-- leaver; member_reactivate needs a coordinator who is still active); S1 the approving Admin edits a
-- task labelled with another Admin's client, but still cannot move the label to one; S2 the API
-- on-behalf paths carry on_behalf_of_id in activity_log (a comment, a tick; never a rename, an untick
-- or one's own tick); S3 malformed assignee_ids / warning member_id are VALIDATION; S4 the
-- coordinator-change reason is team.view's (a Staff coordinator, current or former, reads their rows
-- through coordinated_freelancers without it and no coordination entry; an Admin and the Owner read
-- it); L6 the thin spots (a non-Owner reads reviews and warnings, the coordinator unticks, cancel
-- from submitted / admin_approved, the Owner comments).
begin;
create extension if not exists pgtap with schema extensions;
select plan(69);

-- Fixtures as 33. Rolled back at the end.
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

create temporary table fx (key text primary key, id uuid not null);
insert into fx values
  ('owner',    '00000000-0000-4000-8000-000000000701'),
  ('admin1',   '00000000-0000-4000-8000-000000000702'),
  ('admin2',   '00000000-0000-4000-8000-000000000703'),
  ('staff1',   '00000000-0000-4000-8000-000000000704'),
  ('staff2',   '00000000-0000-4000-8000-000000000705'),
  ('coord',    '00000000-0000-4000-8000-000000000706'),
  ('ravi',     '00000000-0000-4000-8000-000000000707'),
  ('client_a', '00000000-0000-4000-8000-000000000711'),
  ('client_b', '00000000-0000-4000-8000-000000000712');
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

-- The last activity entry an actor wrote about a table (the API paths of S2).
create function pg_temp.last_by(tbl text, actor text) returns public.activity_log language sql stable as $$
  select a.* from public.activity_log a
  where a.entity = tbl and a.actor_id = pg_temp.fx(actor) order by a.id desc limit 1;
$$;

insert into auth.users (id, email)
select id, key || '@example.com' from fx where key not in ('org', 'client_a', 'client_b');

insert into public.members (id, org_id, full_name, email, role, status, joined_at)
select pg_temp.fx(k), pg_temp.fx('org'), k, k || '@example.com', r::public.member_role, 'active', now() - interval '30 days'
from (values ('owner', 'owner'), ('admin1', 'admin'), ('admin2', 'admin'), ('staff1', 'staff'), ('staff2', 'staff'),
             ('coord', 'staff'), ('ravi', 'staff')) as v(k, r);

insert into public.clients (id, org_id, name, state, admin_id, activated_at) values
  (pg_temp.fx('client_a'), pg_temp.fx('org'), 'Sharma Weddings', 'active', pg_temp.fx('admin1'), now()),
  (pg_temp.fx('client_b'), pg_temp.fx('org'), 'Blue Bakery', 'active', pg_temp.fx('admin2'), now());

select pg_temp.as_member('owner');
insert into fx values ('asha', public.member_add_freelancer('Asha', null, null, pg_temp.fx('coord')));

-- M1: warnings are availability.view's ------------------------------------------------------------
-- An Owner task through admin1, labelled with admin2's client, one warning about staff2's leave.
insert into fx values ('t1', public.task_create('Reel edit', null, pg_temp.type_id('Normal'), pg_temp.fx('client_b'), 'medium',
  pg_temp.due(), array[pg_temp.fx('staff1'), pg_temp.fx('staff2'), pg_temp.fx('asha')], pg_temp.fx('staff1'), pg_temp.fx('admin1'),
  warnings => jsonb_build_array(jsonb_build_object('kind', 'on_leave', 'member_id', pg_temp.fx('staff2'),
                                                   'details', '{"leave": "requested"}'::jsonb))));
select is((select count(*) from public.task_warnings w where w.task_id = pg_temp.fx('t1')), 1::bigint, 'the Owner reads the warning');
select is((select count(*) from public.activity_log a where a.entity_id = pg_temp.fx('t1') and a.action = 'warning_overridden'), 1::bigint,
  'and its warning_overridden entry');
select pg_temp.as_member('admin1');
select is((select count(*) from public.task_warnings), 1::bigint, 'the approving Admin (availability.view) reads it (L6: a non-Owner allowed read)');
select is((select count(*) from public.activity_log a where a.entity = 'task_warnings'), 1::bigint, 'and its entry');
select pg_temp.as_member('staff1');
select is((select count(*) from public.tasks), 1::bigint, 'the co-assignee sees the task');
select is((select count(*) from public.task_warnings), 0::bigint, 'but not the warning about a co-worker''s leave (M1)');
select is((select count(*) from public.activity_log a where a.entity = 'task_warnings' or a.action = 'warning_overridden'), 0::bigint,
  'nor its warning_overridden entry');
select ok((select count(*) from public.activity_log a where a.entity_id = pg_temp.fx('t1')) > 0,
  'while the task''s other entries stay readable');
select pg_temp.as_member('coord');
select is((select count(*) from public.task_warnings), 0::bigint, 'a Staff coordinator reads no warning either');
select is((select count(*) from public.activity_log a where a.entity = 'task_warnings'), 0::bigint, 'nor its entry');

-- M2: deactivate / set a coordinator / deactivate the coordinator / reactivate ------------------------
select pg_temp.as_member('owner');
select is(public.member_deactivate(pg_temp.fx('asha'), 'contract ended'), 'deactivated', 'Asha is deactivated');
select lives_ok($$ select public.member_set_coordinator(pg_temp.fx('asha'), pg_temp.fx('ravi'), 'back in spring') $$,
  'Ravi is set as her coordinator (preparing a reactivation)');
select is(public.member_deactivate(pg_temp.fx('ravi'), null), 'deactivated',
  'Ravi leaves: allowed, no ACTIVE freelancer points at him');
select is(app.coordinator_of(pg_temp.fx('asha')), null, 'Asha''s row pointing at him was closed with him (M2)');
select is((select a.meta ->> 'reason' from public.activity_log a
           where a.entity = 'member_coordinators' and a.action = 'coordinator_closed' order by a.id desc limit 1),
  'coordinator_deactivated', 'audit: coordinator_closed, reason coordinator_deactivated');
select throws_ok($$ select public.member_reactivate(pg_temp.fx('asha')) $$, 'P0001', 'INVALID_STATE',
  'she cannot come back behind a coordinator who has left');
select lives_ok($$ select public.member_set_coordinator(pg_temp.fx('asha'), pg_temp.fx('coord'), null) $$,
  'an active coordinator is set');
-- The coordinator deactivated behind the functions' back (a system write), to prove the
-- reactivation's own check rather than the deactivation's close.
select pg_temp.as_system();
update public.members set status = 'deactivated', deactivated_at = now() where id = pg_temp.fx('coord');
select pg_temp.as_member('owner');
select throws_ok($$ select public.member_reactivate(pg_temp.fx('asha')) $$, 'P0001', 'INVALID_STATE',
  'a current row naming a deactivated coordinator is not enough (M2)');
select pg_temp.as_system();
update public.members set status = 'active', deactivated_at = null where id = pg_temp.fx('coord');
select pg_temp.as_member('owner');
select is(public.member_reactivate(pg_temp.fx('asha')), 'active', 'behind an active coordinator she is reactivated');
select results_eq(
  $$ select mc.coordinator_id, mc.to_at is null from public.member_coordinators mc
     where mc.member_id = pg_temp.fx('asha') order by mc.to_at is null, mc.coordinator_id $$,
  $$ values (pg_temp.fx('coord'), false), (pg_temp.fx('ravi'), false), (pg_temp.fx('coord'), true) $$,
  'the history keeps every row: two closed, one current');
select is(public.member_reactivate(pg_temp.fx('ravi')), 'active', '(Ravi is put back too)');

-- S1: the approving Admin edits a task labelled with another Admin's client ---------------------------
select pg_temp.as_member('admin1');
select is(public.task_update_assignment(pg_temp.fx('t1'), jsonb_build_object('due_at', (pg_temp.due() + interval '1 day')::text)),
  array['due_at'], 'the approving Admin moves the deadline of an Owner task labelled with client B (S1)');
select is(public.task_update_assignment(pg_temp.fx('t1'), '{"title": "Reel edit, v2"}'), array['title'], 'and edits the title');
select throws_ok(format($$ select public.task_update_assignment(%L, jsonb_build_object('client_id', %L)) $$, pg_temp.fx('t1'), pg_temp.fx('client_b')),
  'P0001', 'VALIDATION', 'the same label sent again is nothing changed, not a refusal');
select is(public.task_update_assignment(pg_temp.fx('t1'), jsonb_build_object('client_id', pg_temp.fx('client_a'))), array['client_id'],
  'moving the label to their own client is allowed');
select throws_ok(format($$ select public.task_update_assignment(%L, jsonb_build_object('client_id', %L)) $$, pg_temp.fx('t1'), pg_temp.fx('client_b')),
  'P0001', 'FORBIDDEN', 'moving it to another Admin''s client is still refused');
select throws_ok(format($$ select public.task_create('Other client', null, %L::uuid, %L::uuid, 'medium', pg_temp.due(), array[%L::uuid], %L::uuid) $$,
  pg_temp.type_id('Normal'), pg_temp.fx('client_b'), pg_temp.fx('staff1'), pg_temp.fx('staff1')),
  'P0001', 'FORBIDDEN', 'and so is creating a task with one');

-- S3: values of the wrong shape -------------------------------------------------------------------
select pg_temp.as_member('owner');
select throws_ok(format($$ select public.task_update_assignment(%L, '{"assignee_ids": ["not-a-uuid"]}') $$, pg_temp.fx('t1')),
  'P0001', 'VALIDATION', 'a malformed assignee id is VALIDATION, not a raw cast error (S3)');
select throws_ok(format($$ select public.task_create('Bad warning', null, %L::uuid, null, 'medium', pg_temp.due(), array[%L::uuid], %L::uuid,
    warnings => '[{"kind": "workload", "member_id": "nope"}]') $$, pg_temp.type_id('Normal'), pg_temp.fx('staff1'), pg_temp.fx('staff1')),
  'P0001', 'VALIDATION', 'a malformed warning member id is VALIDATION (S3, task_create)');
select throws_ok(format($$ select public.task_update_assignment(%L, '{"title": "Reel edit, v3"}', '[{"kind": "overlap", "member_id": 42}]') $$, pg_temp.fx('t1')),
  'P0001', 'VALIDATION', 'and through task_update_assignment');

-- S2: the API on-behalf paths carry on_behalf_of_id -----------------------------------------------
select pg_temp.as_member('coord');
select lives_ok(format($$ insert into public.task_comments (task_id, body, on_behalf_of) values (%L, 'Asha: first cut sent', %L) $$,
  pg_temp.fx('t1'), pg_temp.fx('asha')), 'the coordinator comments for Asha');
select is((pg_temp.last_by('task_comments', 'coord')).on_behalf_of_id, pg_temp.fx('asha'),
  'the comment''s entry carries on_behalf_of_id (S2)');
select pg_temp.as_member('owner');
select lives_ok(format($$ insert into public.task_stages (task_id, name, position) values (%L, 'Cut', 'a0') $$, pg_temp.fx('t1')),
  'the Owner (a manager) adds a stage');
select lives_ok(format($$ insert into public.task_comments (task_id, body) values (%L, 'Looks good') $$, pg_temp.fx('t1')),
  'the Owner comments (L6)');
select is((pg_temp.last_by('task_comments', 'owner')).on_behalf_of_id, null, 'their own comment names nobody');
select pg_temp.as_member('coord');
select lives_ok(format($$ update public.task_stages set done_at = now(), on_behalf_of = %L where task_id = %L and name = 'Cut' $$,
  pg_temp.fx('asha'), pg_temp.fx('t1')), 'the coordinator ticks for Asha');
select is((pg_temp.last_by('task_stages', 'coord')).on_behalf_of_id, pg_temp.fx('asha'), 'the tick''s entry carries on_behalf_of_id (S2)');
select pg_temp.as_member('owner');
select lives_ok(format($$ update public.task_stages set name = 'First cut' where task_id = %L and name = 'Cut' $$, pg_temp.fx('t1')),
  'the Owner renames the stage Asha''s tick is on');
select is((pg_temp.last_by('task_stages', 'owner')).on_behalf_of_id, null, 'the rename names nobody (the row''s pair is not the rename''s)');
select pg_temp.as_member('coord');
select lives_ok(format($$ update public.task_stages set done_at = null where task_id = %L and name = 'First cut' $$, pg_temp.fx('t1')),
  'the coordinator unticks it (L6: the coordinator untick path)');
select is((select s.on_behalf_of from public.task_stages s where s.task_id = pg_temp.fx('t1') and s.name = 'First cut'), null,
  'on_behalf_of is cleared with the untick');
select is((pg_temp.last_by('task_stages', 'coord')).on_behalf_of_id, null, 'an untick names nobody');
select pg_temp.as_member('staff1');
select lives_ok(format($$ update public.task_stages set done_at = now() where task_id = %L and name = 'First cut' $$, pg_temp.fx('t1')),
  'an assignee ticks it');
select is((pg_temp.last_by('task_stages', 'staff1')).on_behalf_of_id, null, 'their own tick names nobody');

-- L6: reviews read by a non-Owner; cancel from submitted and admin_approved --------------------------
select is(public.task_submit_done(pg_temp.fx('t1'), 'done'), 'submitted', 'the primary owner submits: waiting for admin1');
select pg_temp.as_member('admin1');
select is(public.task_review(pg_temp.fx('t1'), 'approved'), 'admin_approved', 'admin1 approves at the Admin step');
select is((select count(*) from public.task_reviews r where r.task_id = pg_temp.fx('t1')), 1::bigint,
  'the approving Admin reads the review row (L6)');
select pg_temp.as_member('staff2');
select is((select count(*) from public.task_reviews r where r.task_id = pg_temp.fx('t1')), 1::bigint, 'and so does a co-assignee');
select pg_temp.as_member('owner');
select is(public.task_cancel(pg_temp.fx('t1'), 'shelved'), 'cancelled', 'the Owner cancels an admin_approved task (L6)');
select is((select a.meta ->> 'from_state' from public.activity_log a where a.entity_id = pg_temp.fx('t1') and a.action = 'cancelled'),
  'admin_approved', 'audit: cancelled, from admin_approved');
insert into fx values ('t2', public.task_create('Second', null, pg_temp.type_id('Normal'), null, 'medium', pg_temp.due(),
  array[pg_temp.fx('staff1')], pg_temp.fx('staff1'), pg_temp.fx('admin1')));
select pg_temp.as_member('staff1');
select is(public.task_submit_done(pg_temp.fx('t2')), 'submitted', 't2 is submitted');
select pg_temp.as_member('admin1');
select is(public.task_cancel(pg_temp.fx('t2'), 'not needed'), 'cancelled', 'the approving Admin cancels a submitted task (L6)');
select is((select a.meta ->> 'from_state' from public.activity_log a where a.entity_id = pg_temp.fx('t2') and a.action = 'cancelled'),
  'submitted', 'audit: cancelled, from submitted');

-- S4: the coordinator-change reason is team.view's --------------------------------------------------
select pg_temp.as_member('owner');
select lives_ok($$ select public.member_set_coordinator(pg_temp.fx('asha'), pg_temp.fx('staff2'), 'Coord is on the Goa shoot all month') $$,
  'the Owner moves Asha from coord to staff2, with a reason');
select pg_temp.as_member('staff2');
select is((select count(*) from public.member_coordinators), 0::bigint, 'the current Staff coordinator reads no member_coordinators row');
select results_eq(
  $$ select f.member_id, f.to_at is null from public.coordinated_freelancers f $$,
  $$ values (pg_temp.fx('asha'), true) $$,
  'but sees Asha as their current freelancer through coordinated_freelancers');
select is((select count(*) from public.activity_log a where a.entity = 'member_coordinators'), 0::bigint,
  'and reads no coordination entry (the reason is in meta and diff)');
select is((select count(*) from public.member_directory d where d.id = pg_temp.fx('asha')), 1::bigint,
  'her name still comes from the directory');
select pg_temp.as_member('coord');
select is((select count(*) from public.member_coordinators), 0::bigint, 'the former Staff coordinator reads no member_coordinators row');
select results_eq(
  $$ select count(*), count(*) filter (where f.to_at is null) from public.coordinated_freelancers f $$,
  $$ values (2::bigint, 0::bigint) $$,
  'their own two closed rows stay visible as history, without the reason');
select is((select count(*) from public.activity_log a where a.entity = 'member_coordinators'), 0::bigint,
  'and no coordination entry, so not the closing entry''s meta.reason or next_coordinator_id');
select pg_temp.as_member('staff1');
select is((select count(*) from public.coordinated_freelancers), 0::bigint, 'someone who coordinates nobody reads nothing there');
select pg_temp.as_member('admin1');
select is((select mc.reason from public.member_coordinators mc where mc.member_id = pg_temp.fx('asha') and mc.to_at is null),
  'Coord is on the Goa shoot all month', 'an Admin (team.view) reads the reason on the row');
select results_eq(
  $$ select a.action, a.meta ->> 'reason' from public.activity_log a
     where a.entity = 'member_coordinators' and a.meta ->> 'reason' = 'Coord is on the Goa shoot all month' order by a.id $$,
  $$ values ('coordinator_closed', 'Coord is on the Goa shoot all month'), ('coordinator_changed', 'Coord is on the Goa shoot all month') $$,
  'and in the closing and the changing entries');
select pg_temp.as_member('owner');
select is((select mc.reason from public.member_coordinators mc where mc.member_id = pg_temp.fx('asha') and mc.to_at is null),
  'Coord is on the Goa shoot all month', 'the Owner reads it');
select is((select count(*) from public.coordinated_freelancers), 0::bigint, 'the Owner coordinates nobody');
select pg_temp.as_system();
select hasnt_column('public', 'coordinated_freelancers', 'reason', 'coordinated_freelancers has no reason column');
select ok(not has_table_privilege('anon', 'public.coordinated_freelancers', 'select, insert, update, delete'),
  'anon has nothing on coordinated_freelancers');
select ok(has_table_privilege('authenticated', 'public.coordinated_freelancers', 'select')
  and not has_table_privilege('authenticated', 'public.coordinated_freelancers', 'insert, update, delete, truncate'),
  'authenticated only reads it');

select * from finish();
rollback;
