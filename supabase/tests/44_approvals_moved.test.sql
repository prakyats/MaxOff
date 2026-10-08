-- 5A build decision 27 (migration approvals_moved): an approving Admin deactivated or made Staff
-- (Kickoff 4 decision 33) gives the Owner ONE approvals_moved row for the submitted tasks that
-- moved to them, with the count and the name (singular for one), linking to /approvals, written
-- with no actor; an Admin with only open tasks gives no row; nobody else gets one.
begin;
create extension if not exists pgtap with schema extensions;
select plan(20);

-- Fixtures as 41. Rolled back at the end.
-- Fixtures as 40. Rolled back at the end.
delete from public.task_reads;
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

insert into auth.users (id, email)
select id, key || '@example.com' from fx where key not like 'client%' and key <> 'org';

insert into public.members (id, org_id, full_name, email, role, status, joined_at)
select pg_temp.fx(k), pg_temp.fx('org'), k, k || '@example.com', r::public.member_role, 'active', now() - interval '30 days'
from (values ('owner', 'owner'), ('admin1', 'admin'), ('admin2', 'admin'), ('admin3', 'admin'),
             ('admin4', 'admin'), ('admin5', 'admin'), ('staff1', 'staff'), ('staff2', 'staff'),
             ('coord', 'staff')) as v(k, r);

create function pg_temp.mk(title text, approver text, assignees text[], primary_owner text)
returns uuid language sql as $$
  select public.task_create(title, null, pg_temp.type_id('Normal'), null, 'medium', pg_temp.due(),
    array(select pg_temp.fx(a) from unnest(assignees) a), pg_temp.fx(primary_owner), pg_temp.fx(approver));
$$;

-- Every approvals_moved row, past RLS.
create function pg_temp.moved() returns setof public.notifications language sql stable security definer as $$
  select n.* from public.notifications n where n.kind = 'approvals_moved' order by n.created_at, n.id;
$$;

-- The row about one Admin (payload.admin_id): rows of one transaction share created_at.
create function pg_temp.moved_for(k text) returns setof public.notifications language sql stable security definer as $$
  select n.* from public.notifications n where n.kind = 'approvals_moved' and n.payload ->> 'admin_id' = pg_temp.fx(k)::text;
$$;

select ok(exists (select 1 from public.notification_kinds k
                  where k.kind = 'approvals_moved' and not k.actionable and not k.always_email),
  'approvals_moved is an info kind: not actionable, never email');

-- admin1: three submitted tasks and one open one -------------------------------------------------------
select pg_temp.as_member('owner');
insert into fx values ('a_s1', pg_temp.mk('S1', 'admin1', array['staff1'], 'staff1'));
insert into fx values ('a_s2', pg_temp.mk('S2', 'admin1', array['staff1'], 'staff1'));
insert into fx values ('a_s3', pg_temp.mk('S3', 'admin1', array['staff2'], 'staff2'));
insert into fx values ('a_open', pg_temp.mk('Open', 'admin1', array['staff2'], 'staff2'));
-- admin2: one submitted task (made Staff); admin3: open tasks only.
insert into fx values ('b_s1', pg_temp.mk('B1', 'admin2', array['staff1'], 'staff1'));
insert into fx values ('c_o1', pg_temp.mk('C1', 'admin3', array['staff1'], 'staff1'));
insert into fx values ('c_o2', pg_temp.mk('C2', 'admin3', array['staff2'], 'staff2'));
select pg_temp.as_member('staff1');
select public.task_submit_done(pg_temp.fx('a_s1'));
select public.task_submit_done(pg_temp.fx('a_s2'));
select public.task_submit_done(pg_temp.fx('b_s1'));
select pg_temp.as_member('staff2');
select public.task_submit_done(pg_temp.fx('a_s3'));
select pg_temp.as_system();
select is((select count(*) from pg_temp.moved()), 0::bigint, 'before: no approvals_moved row');

-- Deactivated, three submitted ------------------------------------------------------------------------
select pg_temp.as_member('owner');
select is(public.member_deactivate(pg_temp.fx('admin1'), 'left'), 'deactivated', 'the Owner deactivates admin1');
select pg_temp.as_system();
select is((select count(*) from pg_temp.moved()), 1::bigint, 'exactly one row for the three submitted tasks');
select is((select recipient_id from pg_temp.moved()), pg_temp.fx('owner'), 'for the Owner');
select is((select title from pg_temp.moved()), '3 submitted tasks moved to you: admin1 was deactivated',
  'with the count and the name');
select is((select body from pg_temp.moved()), 'They wait for your approval.', '(the plural body)');
select is((select link from pg_temp.moved()), '/approvals', 'linking to Approvals');
select is((select actor_id from pg_temp.moved()), null::uuid, 'written with no actor, so the Owner gets it');
select is((select (payload ->> 'count')::int from pg_temp.moved()), 3, 'payload.count 3');
select is((select entity from pg_temp.moved()), null::text, 'no entity: it is the Approvals list');
select is((select count(*) from public.notifications n where n.kind = 'approvals_moved' and n.recipient_id <> pg_temp.fx('owner')),
  0::bigint, 'nobody else gets one');
select ok(not exists (select 1 from public.notification_deliveries d join pg_temp.moved() m on m.id = d.notification_id
                      where d.channel = 'email'), 'and no email');

-- Made Staff, one submitted ----------------------------------------------------------------------------
select pg_temp.as_member('owner');
update public.members set role = 'staff' where id = pg_temp.fx('admin2');
select pg_temp.as_system();
select is((select count(*) from pg_temp.moved()), 2::bigint, 'the role change writes one more row');
select is((select title from pg_temp.moved_for('admin2')), '1 submitted task moved to you: admin2 is no longer an Admin',
  'singular, with the made-Staff wording');
select is((select body from pg_temp.moved_for('admin2')), 'It waits for your approval.', '(the singular body)');
select is((select payload ->> 'reason' from pg_temp.moved_for('admin2')), 'approver_role_changed', 'payload.reason approver_role_changed');

-- Open tasks only: no row -------------------------------------------------------------------------------
select pg_temp.as_member('owner');
select is(public.member_deactivate(pg_temp.fx('admin3'), 'left'), 'deactivated', 'the Owner deactivates admin3');
select pg_temp.as_system();
select is(pg_temp.route('c_o1'), 'todo,none,-', '(their open task lost the approver)');
select is((select count(*) from pg_temp.moved()), 2::bigint, 'an Admin with only open tasks gives no row');

select * from finish();
rollback;
