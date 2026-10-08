-- 20260930180227_notifications_phase4_combined: the five task transitions keep BOTH phase 4's
-- review behaviour (Kickoff 4 decisions 33-36, the L2 bounds) AND 5.1's notifications; the Owner is
-- told when app.task_skip_admin_step moves a waiting task to them; app.task_visible_to follows the
-- phase 4 review's visibility (a demoted creator, a deactivated freelancer's coordinator).
begin;
create extension if not exists pgtap with schema extensions;
select plan(50);

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
update public.org_settings set weekly_off_days = '{}';

create temporary table fx (key text primary key, id uuid not null);
insert into fx values
  ('owner',       '00000000-0000-4000-8000-000000000e01'),
  ('admin1',      '00000000-0000-4000-8000-000000000e02'),
  ('admin2',      '00000000-0000-4000-8000-000000000e03'),
  ('staff1',      '00000000-0000-4000-8000-000000000e04'),
  ('staff2',      '00000000-0000-4000-8000-000000000e05'),
  ('coord',       '00000000-0000-4000-8000-000000000e06'),
  ('old',         '00000000-0000-4000-8000-000000000e07'),
  ('gone',        '00000000-0000-4000-8000-000000000e08'),
  ('admin3',      '00000000-0000-4000-8000-000000000e09'),
  ('client_a',    '00000000-0000-4000-8000-000000000e11'),
  ('client_b',    '00000000-0000-4000-8000-000000000e12'),
  ('client_c',    '00000000-0000-4000-8000-000000000e13');
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

create function pg_temp.as_nobody() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000e99', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', '00000000-0000-4000-8000-000000000e99', 'role', 'authenticated')::text, true);
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

create function pg_temp.today() returns date language sql stable as $$ select app.today_ist() $$;

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

-- The rows a person holds of a kind (read as the system: RLS is tested on its own below).
-- $2, not the parameter's name: in a SQL function a column wins over a same-named parameter,
-- so "x.kind = kind" compared the column with itself and counted every row (5.1 review).
create function pg_temp.n(k text, kind text default null) returns bigint language sql stable as $$
  select count(*) from public.notifications x
  where x.recipient_id = pg_temp.fx(k) and ($2 is null or x.kind = $2);
$$;
create function pg_temp.last(k text, kind text) returns public.notifications language sql stable as $$
  select x.* from public.notifications x
  where x.recipient_id = pg_temp.fx(k) and x.kind = kind order by x.created_at desc, x.id desc limit 1;
$$;
create function pg_temp.total() returns bigint language sql stable as $$ select count(*) from public.notifications $$;
-- Clears the rows as the system (whatever role the test was in), so a scenario starts clean.
create function pg_temp.clear() returns void language plpgsql as $$
begin
  perform pg_temp.as_system();
  delete from public.notifications;
end;
$$;

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

insert into auth.users (id, email)
select id, key || '@example.com' from fx where key not in ('org', 'client_a', 'client_b', 'client_c');

insert into public.members (id, org_id, full_name, email, role, status, joined_at)
select pg_temp.fx(k), pg_temp.fx('org'), initcap(k), k || '@example.com', r::public.member_role, 'active', now() - interval '30 days'
from (values ('owner', 'owner'), ('admin1', 'admin'), ('admin2', 'admin'), ('admin3', 'admin'), ('staff1', 'staff'),
             ('staff2', 'staff'), ('coord', 'staff'), ('old', 'staff')) as v(k, r);
insert into public.members (id, org_id, full_name, email, role, status, joined_at, deactivated_at) values
  (pg_temp.fx('gone'), pg_temp.fx('org'), 'Gone Staff', 'gone@example.com', 'staff', 'deactivated', now() - interval '30 days', now());

insert into public.clients (id, org_id, name, state, admin_id, activated_at) values
  (pg_temp.fx('client_a'), pg_temp.fx('org'), 'Sharma Weddings', 'active', pg_temp.fx('admin1'), now()),
  (pg_temp.fx('client_b'), pg_temp.fx('org'), 'Blue Bakery', 'active', pg_temp.fx('admin2'), now()),
  (pg_temp.fx('client_c'), pg_temp.fx('org'), 'No Admin Cafe', 'active', null, now());

-- Freelancers: Asha (coordinator coord), Bina (coordinator admin1).
select pg_temp.as_member('owner');
insert into fx values ('asha', public.member_add_freelancer('Asha', null, null, pg_temp.fx('coord')));
insert into fx values ('bina', public.member_add_freelancer('Bina', null, null, pg_temp.fx('admin1')));
select pg_temp.clear();

-- 0. Signatures, grants and search_path kept ----------------------------------------------------------
select ok(has_function_privilege('authenticated', 'public.task_create(text, text, uuid, uuid, public.priority, timestamptz, uuid[], uuid, uuid, date, timestamptz, timestamptz, text, text, text[], jsonb, jsonb, uuid, jsonb)', 'execute')
          and has_function_privilege('authenticated', 'public.task_update_assignment(uuid, jsonb, jsonb)', 'execute')
          and has_function_privilege('authenticated', 'public.task_submit_done(uuid, text, text, uuid)', 'execute')
          and has_function_privilege('authenticated', 'public.task_review(uuid, public.review_decision, text)', 'execute')
          and has_function_privilege('authenticated', 'public.task_set_approver(uuid, uuid)', 'execute'),
  'the five transitions stay callable by authenticated');
select ok(not has_function_privilege('anon', 'public.task_create(text, text, uuid, uuid, public.priority, timestamptz, uuid[], uuid, uuid, date, timestamptz, timestamptz, text, text, text[], jsonb, jsonb, uuid, jsonb)', 'execute')
          and not has_function_privilege('anon', 'public.task_update_assignment(uuid, jsonb, jsonb)', 'execute')
          and not has_function_privilege('anon', 'public.task_submit_done(uuid, text, text, uuid)', 'execute')
          and not has_function_privilege('anon', 'public.task_review(uuid, public.review_decision, text)', 'execute')
          and not has_function_privilege('anon', 'public.task_set_approver(uuid, uuid)', 'execute'),
  'and never by anon');
select ok(not has_function_privilege('authenticated', 'app.task_skip_admin_step(uuid)', 'execute')
          and not has_function_privilege('authenticated', 'app.task_visible_to(uuid, uuid)', 'execute')
          and has_function_privilege('service_role', 'app.task_skip_admin_step(uuid)', 'execute')
          and has_function_privilege('service_role', 'app.task_visible_to(uuid, uuid)', 'execute'),
  'the two helpers stay service_role only');
select is((select count(*)::integer from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
           where (ns.nspname, p.proname) in (('public', 'task_create'), ('public', 'task_update_assignment'),
                  ('public', 'task_submit_done'), ('public', 'task_review'), ('public', 'task_set_approver'),
                  ('app', 'task_skip_admin_step'), ('app', 'task_visible_to'))
             and p.prosecdef and p.proconfig @> array['search_path=""']), 7,
  'all seven: SECURITY DEFINER with an empty search_path');

-- 1. task_create: the L2 bounds (phase 4) and task_assigned (5.1) -------------------------------------
select pg_temp.as_member('owner');
select throws_ok($$ select public.task_create('Too many stages', null, pg_temp.type_id('Normal'), null, 'medium', pg_temp.due(),
    array[pg_temp.fx('staff1')], pg_temp.fx('staff1'), null, null, null, null, null, null,
    array(select 'Stage ' || g from generate_series(1, 31) g)) $$,
  'P0001', 'VALIDATION', 'task_create: more than 30 stages is refused (phase 4 L2)');
select throws_ok($$ select public.task_create('Bad reminders', null, pg_temp.type_id('Normal'), null, 'medium', pg_temp.due(),
    array[pg_temp.fx('staff1')], pg_temp.fx('staff1'), null, null, null, null, null, null, '{}', '{}',
    (select jsonb_agg(jsonb_build_object('n', g)) from generate_series(1, 11) g)) $$,
  'P0001', 'VALIDATION', 'task_create: more than 5 reminder rules (or a malformed one) is refused (phase 4 L2, 5.3)');
select pg_temp.as_system();
select is(pg_temp.total(), 0::bigint, 'a refused create writes no notification');
select pg_temp.as_member('owner');
insert into fx values ('c1', pg_temp.mk('Wedding reel', array['staff1', 'asha'], 'staff1', 'admin2'));
select pg_temp.as_system();
select is(pg_temp.n('staff1', 'task_assigned'), 1::bigint, 'task_create: the assignee is told (task_assigned)');
select is((pg_temp.last('coord', 'task_assigned')).title, 'New task: Wedding reel · for Asha',
  'a freelancer''s row goes to their coordinator, worded for them');
select is(pg_temp.n('owner') + pg_temp.n('admin2'), 0::bigint, 'the actor and the approving Admin are not told of the assignment');

-- 2. task_update_assignment: the L2 bound (phase 4) and assigned / unassigned / changed (5.1) ----------
select pg_temp.clear();
select pg_temp.as_member('owner');
select throws_ok($$ select public.task_update_assignment(pg_temp.fx('c1'), jsonb_build_object('reminder_rules',
    (select jsonb_agg(jsonb_build_object('n', g)) from generate_series(1, 11) g))) $$,
  'P0001', 'VALIDATION', 'task_update_assignment: more than 5 reminder rules (or a malformed one) is refused (phase 4 L2, 5.3)');
select public.task_update_assignment(pg_temp.fx('c1'), jsonb_build_object(
  'assignee_ids', jsonb_build_array(pg_temp.fx('staff2'), pg_temp.fx('asha')), 'primary_owner_id', pg_temp.fx('staff2'),
  'priority', 'high'));
select pg_temp.as_system();
select is(pg_temp.n('staff2', 'task_assigned'), 1::bigint, 'an added person is assigned');
select is(pg_temp.n('staff1', 'task_unassigned'), 1::bigint, 'a removed person is told');
select ok((pg_temp.last('staff1', 'task_unassigned')).link is null and (pg_temp.last('staff1', 'task_unassigned')).entity_id is null
          and position('Wedding' in (pg_temp.last('staff1', 'task_unassigned')).title || coalesce((pg_temp.last('staff1', 'task_unassigned')).body, '')) = 0,
  'without the task named or linked (5A decision 25)');
select is(pg_temp.n('coord', 'task_changed'), 1::bigint, 'the people who stay are told what changed (a freelancer''s coordinator)');
select is(pg_temp.n('staff2', 'task_changed'), 0::bigint, 'an added person gets the assignment only');

-- 3. task_submit_done: decision 34 routes Done to the Owner, and the Owner is the one told ------------
select pg_temp.clear();
select pg_temp.as_member('owner');
insert into fx values ('d34', pg_temp.mk('Bina''s edit', array['staff1', 'bina'], 'staff1', 'admin1'));
select pg_temp.clear();
select pg_temp.as_member('staff1');
select is(public.task_submit_done(pg_temp.fx('d34')), 'admin_approved'::public.task_state,
  'Done skips the Admin step when the approver coordinates a freelancer on the task (decision 34)');
select pg_temp.as_system();
select is((select a.meta ->> 'reason' from public.activity_log a
           where a.entity_id = pg_temp.fx('d34') and a.action = 'submitted' order by a.id desc limit 1),
  'approver_is_coordinator', 'audited with meta.reason approver_is_coordinator');
select is(pg_temp.n('owner', 'task_submitted'), 1::bigint, 'the Owner is told the task is Done (no Admin step)');
select is(pg_temp.n('admin1', 'task_submitted'), 0::bigint, 'the skipped approving Admin is not');
select is((pg_temp.last('owner', 'task_submitted')).link, '/tasks/' || pg_temp.fx('d34'), 'the row links the task');

-- The ordinary route still reaches the approving Admin.
select pg_temp.as_member('owner');
insert into fx values ('r1', pg_temp.mk('Menu shoot', array['staff1'], 'staff1', 'admin2'));
select pg_temp.clear();
select pg_temp.as_member('staff1');
select is(public.task_submit_done(pg_temp.fx('r1')), 'submitted'::public.task_state, 'without a link it waits for the approving Admin');
select pg_temp.as_system();
select is(pg_temp.n('admin2', 'task_submitted'), 1::bigint, 'who is told');
select is(pg_temp.n('owner', 'task_submitted'), 0::bigint, 'and not the Owner');

-- 4. task_review: Admin approval -> Owner; Owner rejection -> assignees only; completion -> + creator --
select pg_temp.clear();
select pg_temp.as_member('admin2');
select is(public.task_review(pg_temp.fx('r1'), 'approved'), 'admin_approved'::public.task_state, 'the approving Admin approves');
select pg_temp.as_system();
select is(pg_temp.n('owner', 'task_admin_approved'), 1::bigint, 'the Owner is told (task_admin_approved)');
select pg_temp.clear();
select pg_temp.as_member('owner');
select is(public.task_review(pg_temp.fx('r1'), 'rejected', 'Colours are off'), 'changes_requested'::public.task_state, 'the Owner asks for changes');
select pg_temp.as_system();
select is(pg_temp.n('staff1', 'task_changes_requested'), 1::bigint, 'the assignee is told');
select is(pg_temp.n('admin2') + pg_temp.n('owner'), 0::bigint, 'an Owner rejection goes to the assignees only');
select pg_temp.as_member('staff1');
select public.task_submit_done(pg_temp.fx('r1'));
select pg_temp.as_member('admin2');
select public.task_review(pg_temp.fx('r1'), 'approved');
select pg_temp.clear();
select pg_temp.as_member('owner');
select is(public.task_review(pg_temp.fx('r1'), 'approved'), 'completed'::public.task_state, 'the Owner completes it');
select pg_temp.as_system();
select is(pg_temp.n('staff1', 'task_completed'), 1::bigint, 'the assignee is told it is completed');
select is(pg_temp.n('owner', 'task_completed'), 0::bigint, 'the creator is the actor here, so not told');

-- 5. task_set_approver: a new approver while submitted is told; a skipped one (decision 34) is not ----
select pg_temp.as_member('owner');
insert into fx values ('s1', pg_temp.mk('Brochure', array['staff1', 'bina'], 'staff1', 'admin2'));
select pg_temp.as_member('staff1');
select public.task_submit_done(pg_temp.fx('s1'));
select pg_temp.clear();
select pg_temp.as_member('owner');
select is(public.task_set_approver(pg_temp.fx('s1'), pg_temp.fx('admin3')), 'submitted'::public.task_state,
  'a new approver with no link takes the waiting review');
select pg_temp.as_system();
select is(pg_temp.n('admin3', 'task_submitted'), 1::bigint, 'and is told (kickoff 5 decision 2)');
select pg_temp.clear();
select pg_temp.as_member('owner');
select is(public.task_set_approver(pg_temp.fx('s1'), pg_temp.fx('admin1')), 'admin_approved'::public.task_state,
  'an approver who coordinates a freelancer on it is skipped: the task goes to the Owner (decision 34)');
select pg_temp.as_system();
select is(pg_temp.n('admin1', 'task_submitted'), 0::bigint, 'and that Admin is not told of a review they cannot make');
select is(pg_temp.total(), 0::bigint, 'nobody is (the Owner made the move)');

-- 6. app.task_skip_admin_step: the Owner is told when an Admin's edit moves a waiting task (A-M2) ----
select pg_temp.as_member('owner');
insert into fx values ('m1', pg_temp.mk('Poster', array['staff1'], 'staff1', 'admin3'));
select pg_temp.as_member('staff1');
select public.task_submit_done(pg_temp.fx('m1'));
select pg_temp.clear();
select pg_temp.as_member('admin3');
select ok('state' = any (public.task_update_assignment(pg_temp.fx('m1'), jsonb_build_object(
  'assignee_ids', jsonb_build_array(pg_temp.fx('staff1'), pg_temp.fx('admin3'))))),
  'the approving Admin adds themself to a submitted task: the state moves (A-M2)');
select pg_temp.as_system();
select is((select t.state from public.tasks t where t.id = pg_temp.fx('m1')), 'admin_approved'::public.task_state, 'to the Owner');
select is(pg_temp.n('owner', 'task_submitted'), 1::bigint, 'and the Owner is told it waits for them');
select is(pg_temp.n('admin3'), 0::bigint, 'the actor is told nothing');
-- The same move made by the Owner (a coordinator set, decision 34) writes nothing: the actor.
select pg_temp.as_member('owner');
insert into fx values ('m2', pg_temp.mk('Flyer', array['staff1', 'asha'], 'staff1', 'admin3'));
select pg_temp.as_member('staff1');
select public.task_submit_done(pg_temp.fx('m2'));
select pg_temp.clear();
select pg_temp.as_member('owner');
select public.member_set_coordinator(pg_temp.fx('asha'), pg_temp.fx('admin3'), 'Covers Asha now');
select pg_temp.as_system();
select is((select t.state from public.tasks t where t.id = pg_temp.fx('m2')), 'admin_approved'::public.task_state,
  'a coordinator set to the approving Admin moves the waiting task to the Owner (decision 34)');
select is(pg_temp.n('owner', 'task_submitted'), 0::bigint, 'the Owner made that move, so no row');
select pg_temp.as_member('owner');
select public.member_set_coordinator(pg_temp.fx('asha'), pg_temp.fx('coord'), 'Back');

-- 7. Decision 33: an approving Admin made Staff re-routes to the Owner with no row of its own ---------
select pg_temp.as_member('owner');
insert into fx values ('x1', pg_temp.mk('Reel cut', array['staff1'], 'staff1', 'admin3'));
select pg_temp.as_member('staff1');
select public.task_submit_done(pg_temp.fx('x1'));
select pg_temp.clear();
update public.members set role = 'staff' where id = pg_temp.fx('admin3');
select is((select (t.state, t.admin_step, t.approving_admin_id)::text from public.tasks t where t.id = pg_temp.fx('x1')),
  ('admin_approved', 'none', null)::text, 'decision 33: the waiting task goes to the Owner, approver removed');
-- 5A decision 27 (2026-10-01) gave the re-route its one row: the Owner's approvals_moved (44 has its paths).
select ok(pg_temp.total() = 1 and pg_temp.n('owner', 'approvals_moved') = 1,
  'decision 33 writes one row only, the Owner''s approvals_moved (5A decision 27)');

-- 8. app.task_visible_to follows the phase 4 review ---------------------------------------------------
-- admin3 (now Staff) created c9 while an Admin; bina's coordinator admin1 is not otherwise on c9.
update public.members set role = 'admin' where id = pg_temp.fx('admin3');
select pg_temp.as_member('admin3');
insert into fx values ('c9', pg_temp.mk('Admin3''s own', array['staff2', 'bina'], 'staff2'));
select pg_temp.as_system();
select ok(app.task_visible_to(pg_temp.fx('c9'), pg_temp.fx('admin3')), 'the creator sees their task');
select ok(app.task_visible_to(pg_temp.fx('c9'), pg_temp.fx('admin1')), 'the coordinator of an active freelancer on it sees it');
update public.members set role = 'staff' where id = pg_temp.fx('admin3');
select ok(not app.task_visible_to(pg_temp.fx('c9'), pg_temp.fx('admin3')), 'a creator made Staff no longer does (S-M1)');
update public.members set status = 'deactivated', deactivated_at = now() where id = pg_temp.fx('bina');
select ok(not app.task_visible_to(pg_temp.fx('c9'), pg_temp.fx('admin1')), 'nor the coordinator of a deactivated freelancer (S-S2)');
select pg_temp.clear();
select pg_temp.as_member('staff2');
insert into public.task_comments (task_id, body) values (pg_temp.fx('c9'), 'Draft is up');
select pg_temp.as_system();
select is(pg_temp.n('admin3') + pg_temp.n('admin1'), 0::bigint, 'so neither gets a comment row');

select * from finish();
rollback;
