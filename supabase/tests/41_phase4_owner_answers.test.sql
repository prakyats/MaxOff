-- The owner's answers to the phase 4 review's questions (Kickoff 4 decisions 33 to 36; migration
-- phase4_review_fixes):
-- (33) an approving Admin deactivated or made Staff: their submitted tasks go to the Owner, their
--      open tasks lose that approver, audited with the reason; a finished task keeps its record.
-- (34) a coordinator is treated like an assignee for the route: Done skips the Admin step, the
--      review refuses them, naming them approver skips it, and a submitted task moves to the Owner
--      when the link appears later (a freelancer added, a coordinator set, a freelancer reactivated).
-- (35) an Admin's suggestion without a client label is decided by the Owner only.
-- (36) unread markers count only on the tasks the viewer is on or decides.
begin;
create extension if not exists pgtap with schema extensions;
select plan(60);

-- Fixtures as 40. Rolled back at the end.
delete from public.task_reads;
-- 7A: client work rows reference clients and members, and the presets the organization (a
-- Playwright run leaves some behind).
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
  ('owner',    '00000000-0000-4000-8000-000000000e01'),
  ('admin1',   '00000000-0000-4000-8000-000000000e02'),
  ('admin2',   '00000000-0000-4000-8000-000000000e03'),
  ('admin3',   '00000000-0000-4000-8000-000000000e04'),
  ('admin4',   '00000000-0000-4000-8000-000000000e05'),
  ('admin5',   '00000000-0000-4000-8000-000000000e06'),
  ('staff1',   '00000000-0000-4000-8000-000000000e07'),
  ('staff2',   '00000000-0000-4000-8000-000000000e08'),
  ('coord',    '00000000-0000-4000-8000-000000000e09'),
  ('client_c', '00000000-0000-4000-8000-000000000e21');
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

-- The task's route as the database holds it (past RLS): state, admin_step, approver key.
create function pg_temp.route(k text) returns text language sql stable security definer as $$
  select t.state || ',' || t.admin_step || ',' || coalesce((select f.key from fx f where f.id = t.approving_admin_id), '-')
  from public.tasks t where t.id = pg_temp.fx(k);
$$;

-- The newest entry of an action on a task, past RLS.
create function pg_temp.entry(k text, act text) returns public.activity_log language sql stable security definer as $$
  select l.* from public.activity_log l
  where l.entity = 'tasks' and l.entity_id = pg_temp.fx(k) and l.action = act
  order by l.at desc, l.id desc limit 1;
$$;

-- The caller's unread count on one task (0 when the function gives no row).
create function pg_temp.unread(k text) returns integer language sql stable as $$
  select coalesce((select u.unread from public.task_unread_counts(array[pg_temp.fx(k)]) u), 0);
$$;

-- A comment by someone, a minute ago (as the system: the comment guard's own rules are 39's).
create function pg_temp.comment(k text, author text) returns void language sql security definer as $$
  insert into public.task_comments (task_id, author_id, body, created_at)
  values (pg_temp.fx(k), pg_temp.fx(author), 'From ' || author, now() - interval '1 minute');
$$;

insert into auth.users (id, email)
select id, key || '@example.com' from fx where key not like 'client%' and key <> 'org';

insert into public.members (id, org_id, full_name, email, role, status, joined_at)
select pg_temp.fx(k), pg_temp.fx('org'), k, k || '@example.com', r::public.member_role, 'active', now() - interval '30 days'
from (values ('owner', 'owner'), ('admin1', 'admin'), ('admin2', 'admin'), ('admin3', 'admin'),
             ('admin4', 'admin'), ('admin5', 'admin'), ('staff1', 'staff'), ('staff2', 'staff'),
             ('coord', 'staff')) as v(k, r);

-- C is admin5's.
insert into public.clients (id, org_id, name, state, admin_id, activated_at) values
  (pg_temp.fx('client_c'), pg_temp.fx('org'), 'Candid Cafe', 'active', pg_temp.fx('admin5'), now());

create function pg_temp.mk(title text, approver text, assignees text[], primary_owner text, client text default null)
returns uuid language sql as $$
  select public.task_create(title, null, pg_temp.type_id('Normal'), pg_temp.fx(client), 'medium', pg_temp.due(),
    array(select pg_temp.fx(a) from unnest(assignees) a), pg_temp.fx(primary_owner), pg_temp.fx(approver));
$$;

-- (33) An approving Admin deactivated -------------------------------------------------------------------
select pg_temp.as_member('owner');
insert into fx values ('d_sub',  pg_temp.mk('Submitted', 'admin1', array['staff1'], 'staff1'));
insert into fx values ('d_todo', pg_temp.mk('To do', 'admin1', array['staff2'], 'staff2'));
insert into fx values ('d_chk',  pg_temp.mk('Checked', 'admin1', array['staff1'], 'staff1'));
insert into fx values ('d_done', pg_temp.mk('Done', 'admin1', array['staff1'], 'staff1'));
select pg_temp.as_member('staff1');
select public.task_submit_done(pg_temp.fx('d_sub'));
select public.task_submit_done(pg_temp.fx('d_chk'));
select public.task_submit_done(pg_temp.fx('d_done'));
select pg_temp.as_member('admin1');
select public.task_review(pg_temp.fx('d_chk'), 'approved');
select public.task_review(pg_temp.fx('d_done'), 'approved');
select pg_temp.as_member('owner');
select public.task_review(pg_temp.fx('d_done'), 'approved');
select is(pg_temp.route('d_sub'), 'submitted,required,admin1', 'before: D_SUB waits for admin1');

select is(public.member_deactivate(pg_temp.fx('admin1'), 'left'), 'deactivated', 'the Owner deactivates admin1 (33)');
select is(pg_temp.route('d_sub'), 'admin_approved,none,-', 'their submitted task goes straight to the Owner');
select is(pg_temp.route('d_todo'), 'todo,none,-', 'their open task loses the approver (the route is the Owner''s)');
select is(pg_temp.route('d_chk'), 'admin_approved,none,-', 'so does the one they already checked');
select is(pg_temp.route('d_done'), 'completed,required,admin1', 'a finished task keeps its record');
select is((pg_temp.entry('d_sub', 'approver_changed')).meta ->> 'reason', 'approver_deactivated',
  'audited: approver_changed, meta.reason approver_deactivated');
select is((pg_temp.entry('d_sub', 'approver_changed')).meta ->> 'to_state', 'admin_approved', '(meta.to_state)');
select is((pg_temp.entry('d_sub', 'approver_changed')).actor_id, pg_temp.fx('owner'), '(by the Owner who made the change)');
select is(public.task_review(pg_temp.fx('d_sub'), 'approved'), 'completed'::public.task_state, 'the Owner decides it');

-- (33) An approving Admin made Staff --------------------------------------------------------------------
insert into fx values ('r_sub',  pg_temp.mk('Submitted', 'admin2', array['staff1'], 'staff1'));
insert into fx values ('r_todo', pg_temp.mk('To do', 'admin2', array['staff2'], 'staff2'));
insert into fx values ('r_other', pg_temp.mk('Someone else''s', 'admin4', array['staff2'], 'staff2'));
select pg_temp.as_member('staff1');
select public.task_submit_done(pg_temp.fx('r_sub'));
select pg_temp.as_member('owner');
select is((select count(*) from public.members m where m.id = pg_temp.fx('admin2')), 1::bigint, '(the Owner reads admin2''s row)');
update public.members set role = 'staff' where id = pg_temp.fx('admin2');
select is((select m.role::text from public.members m where m.id = pg_temp.fx('admin2')), 'staff', 'the Owner makes admin2 Staff (33)');
select is(pg_temp.route('r_sub'), 'admin_approved,none,-', 'their submitted task goes to the Owner');
select is(pg_temp.route('r_todo'), 'todo,none,-', 'their open task loses the approver');
select is(pg_temp.route('r_other'), 'todo,required,admin4', 'another Admin''s task is untouched');
select is((pg_temp.entry('r_sub', 'approver_changed')).meta ->> 'reason', 'approver_role_changed',
  'audited: meta.reason approver_role_changed');
update public.members set job_title_id = null where id = pg_temp.fx('admin4');
select is(pg_temp.route('r_other'), 'todo,required,admin4', 'an edit that keeps the role moves nothing');

-- (34) A coordinator is treated like an assignee --------------------------------------------------------
insert into fx values ('asha', public.member_add_freelancer('Asha', null, null, pg_temp.fx('admin3')));
insert into fx values ('bina', public.member_add_freelancer('Bina', null, null, pg_temp.fx('coord')));
insert into fx values ('cara', public.member_add_freelancer('Cara', null, null, pg_temp.fx('admin3')));
insert into fx values ('f1', pg_temp.mk('Asha on it', 'admin3', array['asha', 'staff1'], 'staff1'));
insert into fx values ('f2', pg_temp.mk('Asha added later', 'admin3', array['staff1'], 'staff1'));
insert into fx values ('f3', pg_temp.mk('Bina''s coordinator changes', 'admin3', array['bina', 'staff2'], 'staff2'));
insert into fx values ('f5', pg_temp.mk('Approver named later', 'admin4', array['asha', 'staff1'], 'staff1'));
insert into fx values ('f6', pg_temp.mk('Cara comes back', 'admin3', array['cara', 'staff2'], 'staff2'));
insert into fx values ('f7', pg_temp.mk('Nobody''s coordinator', 'admin4', array['bina', 'staff2'], 'staff2'));
select pg_temp.as_member('staff1');
select is(public.task_submit_done(pg_temp.fx('f1')), 'admin_approved'::public.task_state,
  'Done skips the Admin step when the approver coordinates a freelancer on the task (34)');
select is(pg_temp.route('f1'), 'admin_approved,skipped,admin3', '(admin_step skipped)');
select is((pg_temp.entry('f1', 'submitted')).meta ->> 'reason', 'approver_is_coordinator', 'meta.reason approver_is_coordinator');
select is(public.task_submit_done(pg_temp.fx('f2')), 'submitted'::public.task_state, 'without a freelancer of theirs it waits for admin3');
select is(public.task_submit_done(pg_temp.fx('f5')), 'submitted'::public.task_state, 'F5 waits for admin4');
select pg_temp.as_member('staff2');
select is(public.task_submit_done(pg_temp.fx('f3')), 'submitted'::public.task_state, 'F3 waits for admin3 (Bina is coord''s)');
select is(public.task_submit_done(pg_temp.fx('f7')), 'submitted'::public.task_state, 'F7 waits for admin4');

select pg_temp.as_member('owner');
select is(public.task_update_assignment(pg_temp.fx('f2'), jsonb_build_object('assignee_ids',
  jsonb_build_array(pg_temp.fx('staff1'), pg_temp.fx('asha')))), array['assignee_ids', 'state'],
  'adding admin3''s freelancer to submitted F2 moves it');
select is(pg_temp.route('f2'), 'admin_approved,skipped,admin3', 'to the Owner, the Admin step skipped');
select is((pg_temp.entry('f2', 'admin_step_skipped')).meta ->> 'reason', 'approver_is_coordinator', 'audited with the reason');

select lives_ok($$ select public.member_set_coordinator(pg_temp.fx('bina'), pg_temp.fx('admin3'), 'coord is away') $$,
  'admin3 becomes Bina''s coordinator');
select is(pg_temp.route('f3'), 'admin_approved,skipped,admin3', 'so F3, waiting for admin3, goes to the Owner');
select is((pg_temp.entry('f3', 'admin_step_skipped')).meta ->> 'reason', 'approver_is_coordinator', '(audited)');
select is(pg_temp.route('f7'), 'submitted,required,admin4', 'F7 waits for admin4 still');

select is(public.task_set_approver(pg_temp.fx('f5'), pg_temp.fx('admin3')), 'admin_approved'::public.task_state,
  'naming Asha''s coordinator the approver of submitted F5 sends it to the Owner');
select is(pg_temp.route('f5'), 'admin_approved,skipped,admin3', '(skipped)');

select is(public.member_deactivate(pg_temp.fx('cara'), 'break'), 'deactivated', 'Cara is deactivated');
select lives_ok($$ select public.member_set_coordinator(pg_temp.fx('cara'), pg_temp.fx('admin3'), 'for her return') $$,
  'admin3 is set as her coordinator again');
select pg_temp.as_member('staff2');
select is(public.task_submit_done(pg_temp.fx('f6')), 'submitted'::public.task_state,
  'with Cara deactivated, F6 waits for admin3');
select pg_temp.as_member('owner');
select is(public.member_reactivate(pg_temp.fx('cara')), 'active', 'Cara comes back');
select is(pg_temp.route('f6'), 'admin_approved,skipped,admin3', 'and F6 goes to the Owner');

select pg_temp.as_system();
update public.tasks set state = 'submitted', admin_step = 'required' where id = pg_temp.fx('f1');
select pg_temp.as_member('admin3');
select throws_ok(format($$ select public.task_review(%L, 'approved') $$, pg_temp.fx('f1')),
  'P0001', 'FORBIDDEN', 'the review refuses a coordinator of a freelancer on the task at the Admin step');
select pg_temp.as_member('admin4');
select is(public.task_review(pg_temp.fx('f7'), 'approved'), 'admin_approved'::public.task_state,
  '(an approver with no freelancer on it checks it)');

-- (35) An Admin's suggestion without a client -----------------------------------------------------------
select pg_temp.as_member('admin4');
insert into fx values ('q_admin', public.task_request_create('A studio clean-up', null, null));
select pg_temp.as_member('staff1');
insert into fx values ('q_staff', public.task_request_create('New lights', null, null));
select pg_temp.as_member('admin5');
select is((select count(*) from public.task_requests r where r.id = pg_temp.fx('q_admin')), 0::bigint,
  'another Admin does not list an Admin''s no-client suggestion (35)');
select is((select count(*) from public.task_requests r where r.state = 'pending'), 1::bigint,
  'nor count it (only the Staff one)');
select throws_ok(format($$ select public.task_request_decline(%L, 'no') $$, pg_temp.fx('q_admin')),
  'P0001', 'NOT_FOUND', 'nor decline it');
select throws_ok(format($$ select public.task_request_convert(%L, 'Clean-up', null, %L::uuid, null, 'medium', pg_temp.due(),
    array[%L::uuid], %L::uuid) $$, pg_temp.fx('q_admin'), pg_temp.type_id('Normal'), pg_temp.fx('staff1'), pg_temp.fx('staff1')),
  'P0001', 'NOT_FOUND', 'nor convert it');
select is(public.task_request_decline(pg_temp.fx('q_staff'), 'Not now'), 'declined'::public.request_state,
  'a Staff no-client suggestion is still theirs to decide');
select pg_temp.as_member('admin4');
select is((select count(*) from public.task_requests r where r.id = pg_temp.fx('q_admin')), 1::bigint,
  'the Admin who made it still sees it');
select pg_temp.as_member('owner');
select is(public.task_request_decline(pg_temp.fx('q_admin'), 'Next month'), 'declined'::public.request_state,
  'the Owner decides it');

-- (36) Unread markers on the tasks the viewer is on or decides -------------------------------------------
-- U1: the Owner's through admin4 (staff1, label C: admin5 sees it by the label only). U6: admin4's
-- own (staff1). U2: the Owner's through admin4 (staff2). U3: admin4's, handed in and checked (at the Owner's step). U4: the Owner's
-- through admin4, with Bina (admin3 coordinates her). U5: admin4's, its approver removed by the
-- Owner (routed to the Owner, created by someone else).
select pg_temp.as_member('admin4');
insert into fx values ('u6', pg_temp.mk('Admin4''s own', 'admin4', array['staff1'], 'staff1'));
insert into fx values ('u3', pg_temp.mk('Checked', 'admin4', array['staff1'], 'staff1'));
insert into fx values ('u5', pg_temp.mk('No approver', 'admin4', array['staff1'], 'staff1'));
select pg_temp.as_member('owner');
insert into fx values ('u1', pg_temp.mk('Label C', 'admin4', array['staff1'], 'staff1', 'client_c'));
insert into fx values ('u2', pg_temp.mk('Owner via admin4', 'admin4', array['staff2'], 'staff2'));
insert into fx values ('u4', pg_temp.mk('Bina', 'admin4', array['bina', 'staff2'], 'staff2'));
select public.task_set_approver(pg_temp.fx('u5'), null);
select pg_temp.as_member('staff1');
select public.task_submit_done(pg_temp.fx('u3'));
select pg_temp.as_member('admin4');
select public.task_review(pg_temp.fx('u3'), 'approved');
select pg_temp.comment('u1', 'owner');
select pg_temp.comment('u2', 'staff2');
select pg_temp.comment('u3', 'staff1');
select pg_temp.comment('u4', 'staff2');
select pg_temp.comment('u5', 'staff1');
select pg_temp.comment('u6', 'staff1');

select pg_temp.as_member('staff1');
select is(pg_temp.unread('u1'), 1, 'an assignee: marked (36)');
select is(pg_temp.unread('u2'), 0, '(not on U2: nothing)');
select pg_temp.as_member('admin3');
select is(pg_temp.unread('u4'), 1, 'the coordinator of a freelancer on it: marked');
select pg_temp.as_member('admin4');
select is(pg_temp.unread('u6'), 1, 'the creator: marked');
select is(pg_temp.unread('u2'), 1, 'the approving Admin of the Owner''s task: marked');
select is(pg_temp.unread('u1'), 1, '(and of the one labelled with admin5''s client)');
select pg_temp.as_member('admin5');
select ok(app.task_visible(pg_temp.fx('u1')), 'admin5 sees U1 by its label');
select is(pg_temp.unread('u1'), 0, 'but is not on it and decides nothing: not marked');
select pg_temp.as_member('owner');
select is(pg_temp.unread('u2'), 1, 'the Owner: a task they created');
select is(pg_temp.unread('u3'), 1, 'a task at their step (admin_approved)');
select is(pg_temp.unread('u5'), 1, 'a task with no approving Admin (routed to them)');
select is(pg_temp.unread('u6'), 0, 'not an Admin''s task still with its Admin');
select is(pg_temp.unread('u4'), 1, '(U4 is theirs: they created it)');

select * from finish();
rollback;
