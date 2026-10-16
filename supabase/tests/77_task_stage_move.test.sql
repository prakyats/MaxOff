-- 6b.18 (v1.7.1; owner decision 2026-10-15, replacing 13 Oct's option A): task_stage_move().
-- Only whoever may edit a staff task reorders its stages: the Owner, the task's creator and its
-- approving Admin (app.task_manager holding tasks.create), as themselves; Crew NEVER (an assignee,
-- the primary owner or a freelancer's coordinator for them are all refused); an Admin outside the
-- task's edit scope is refused too. Reorder only: an assignee still cannot add, rename, remove or
-- write a position directly. Ticks are kept, one history entry per move, nobody is notified; the
-- editors' lock is the existing one (until completed or cancelled); old rows with equal keys are
-- renumbered; a task nobody moved keeps every row. Neutral names only.
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
  ('owner',  '00000000-0000-4000-8000-000000007701'),
  ('admin1', '00000000-0000-4000-8000-000000007702'),
  ('admin2', '00000000-0000-4000-8000-000000007703'),
  ('staff1', '00000000-0000-4000-8000-000000007704'),
  ('staff2', '00000000-0000-4000-8000-000000007705'),
  ('staff3', '00000000-0000-4000-8000-000000007706'),
  ('coord',  '00000000-0000-4000-8000-000000007707');
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
-- A task made by `by` for `assignees` (the first primary) with `stages`, as task_create makes them.
create function pg_temp.mk(k text, by text, assignees text[], stages text[]) returns uuid
language plpgsql as $$
declare
  v_id uuid;
begin
  perform pg_temp.as_member(by);
  v_id := public.task_create(
    title => initcap(k), description => null, task_type_id => pg_temp.fx('normal'), client_id => null,
    priority => 'medium', due_at => now() + interval '3 days',
    assignee_ids => array(select pg_temp.fx(a) from unnest(assignees) a),
    primary_owner_id => pg_temp.fx(assignees[1]), stages => stages);
  insert into fx values (k, v_id);
  perform pg_temp.as_system();
  return v_id;
end;
$$;
create function pg_temp.stage(k text, n text) returns uuid language sql stable as $$
  select s.id from public.task_stages s where s.task_id = pg_temp.fx(k) and s.name = n;
$$;
-- The checklist in the order the task page reads it.
create function pg_temp.order_of(k text) returns text language sql stable as $$
  select string_agg(s.name, ',' order by s.position, s.created_at, s.id) from public.task_stages s
  where s.task_id = pg_temp.fx(k);
$$;
-- Every stage's tick and name (everything but the position).
create function pg_temp.ticks_of(k text) returns text language sql stable as $$
  select md5(string_agg(row(s.id, s.name, s.done_at, s.done_by, s.on_behalf_of, s.created_at)::text, '|' order by s.id))
  from public.task_stages s where s.task_id = pg_temp.fx(k);
$$;
-- Every row of a task: the task, its people, its stages (what "unchanged" is measured on).
create function pg_temp.rows_of(k text) returns text language sql stable as $$
  select md5(coalesce((select row_to_json(t)::text from public.tasks t where t.id = pg_temp.fx(k)), '')
    || coalesce((select string_agg(row_to_json(a)::text, '|' order by a.member_id) from public.task_assignees a where a.task_id = pg_temp.fx(k)), '')
    || coalesce((select string_agg(row_to_json(s)::text, '|' order by s.id) from public.task_stages s where s.task_id = pg_temp.fx(k)), ''));
$$;
create function pg_temp.moves(k text) returns bigint language sql stable as $$
  select count(*) from public.activity_log l
  where l.entity = 'task_stages' and l.entity_id = pg_temp.fx(k) and l.action = 'stage_moved';
$$;
create function pg_temp.move(k text, n text, after_name text, for_whom text default null) returns void
language sql as $$
  select public.task_stage_move(pg_temp.fx(k), pg_temp.stage(k, n),
    case when after_name is null then null else pg_temp.stage(k, after_name) end,
    case when for_whom is null then null else pg_temp.fx(for_whom) end);
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
grant execute on function pg_temp.fx(text) to authenticated, anon;
grant execute on function pg_temp.stage(text, text) to authenticated;
grant execute on function pg_temp.move(text, text, text, text) to authenticated;

insert into auth.users (id, email) select id, key || '@example.com' from fx where key <> 'org';
insert into public.members (id, org_id, full_name, email, role, status, joined_at)
select pg_temp.fx(k), pg_temp.fx('org'), initcap(k), k || '@example.com', r::public.member_role, 'active', now() - interval '60 days'
from (values ('owner', 'owner'), ('admin1', 'admin'), ('admin2', 'admin'), ('staff1', 'staff'),
             ('staff2', 'staff'), ('staff3', 'staff'), ('coord', 'staff')) as v(k, r);
insert into public.task_types (org_id, name, kind, shows_on_calendar, has_location, position)
values (pg_temp.fx('org'), 'Type 77', 'normal', false, false, 'z77a');
insert into fx select 'normal', id from public.task_types where org_id = pg_temp.fx('org') and name = 'Type 77';
update public.org_settings set default_task_reminders = '[]' where org_id = pg_temp.fx('org');
select pg_temp.as_member('owner');
insert into fx values ('free', public.member_add_freelancer('Free', null, '9811111177', pg_temp.fx('coord')));
select pg_temp.as_system();

-- Tasks made the way they are today. T: admin1's (the creator), staff1 primary, staff2 and the
-- freelancer on it. APP: the Owner's, admin2 its approving Admin, staff1 on it. Other: a task
-- nobody moves anything on (its rows are compared at the end).
select pg_temp.mk('t', 'admin1', array['staff1', 'staff2', 'free'],
                  array['Stage 1', 'Stage 2', 'Stage 3', 'Stage 4', 'Stage 5']);
select pg_temp.mk('other', 'admin1', array['staff2'], array['Stage 1', 'Stage 2']);
select pg_temp.as_member('owner');
insert into fx values ('app', public.task_create(
  title => 'App', description => null, task_type_id => pg_temp.fx('normal'), client_id => null,
  priority => 'medium', due_at => now() + interval '3 days', assignee_ids => array[pg_temp.fx('staff1')],
  primary_owner_id => pg_temp.fx('staff1'), approving_admin_id => pg_temp.fx('admin2'),
  stages => array['Stage A', 'Stage B', 'Stage C']));
select pg_temp.as_system();
create temporary table snap (k text primary key, v text);
insert into snap values ('other', pg_temp.rows_of('other'));
grant select on snap to authenticated;

select has_function('public', 'task_stage_move', array['uuid', 'uuid', 'uuid', 'uuid'], 'task_stage_move exists');
select ok(not has_function_privilege('anon', 'public.task_stage_move(uuid, uuid, uuid, uuid)', 'execute')
          and has_function_privilege('authenticated', 'public.task_stage_move(uuid, uuid, uuid, uuid)', 'execute'),
  'callable by a signed-in member only');

-- A tick first, so the moves below can show it is kept.
select pg_temp.as_member('staff2');
select lives_ok(format($$ update public.task_stages set done_at = now() where id = %L $$, pg_temp.stage('t', 'Stage 2')),
  'staff2 ticks Stage 2');
select pg_temp.as_system();
insert into snap values ('ticks', pg_temp.ticks_of('t'));
insert into snap select 'pos:' || s.name, s.position from public.task_stages s where s.task_id = pg_temp.fx('t');
insert into snap values ('notes', (select count(*)::text from public.notifications));
insert into snap values ('t-rows', pg_temp.rows_of('t'));

-- 1. Crew never (owner 2026-10-15) ----------------------------------------------------------------------------
select pg_temp.as_member('staff2');
select throws_ok($$ select pg_temp.move('t', 'Stage 5', null) $$, 'P0001', 'FORBIDDEN',
  'an assignee (Crew) is refused');
select pg_temp.as_member('staff1');
select throws_ok($$ select pg_temp.move('t', 'Stage 5', null) $$, 'P0001', 'FORBIDDEN',
  'the primary owner (Crew) is refused');
select pg_temp.as_member('coord');
select throws_ok($$ select pg_temp.move('t', 'Stage 5', null, 'free') $$, 'P0001', 'FORBIDDEN',
  'a freelancer''s coordinator is refused, for them');
select throws_ok($$ select pg_temp.move('t', 'Stage 5', null) $$, 'P0001', 'FORBIDDEN',
  'and as themselves (they see the task as the coordinator, and are Crew)');
select pg_temp.as_member('staff3');
select throws_ok(format($$ select public.task_stage_move(%L, %L) $$, pg_temp.fx('t'), pg_temp.stage('t', 'Stage 4')),
  'P0001', 'NOT_FOUND', 'a Crew member not on the task: it does not exist for them');
select pg_temp.as_member('admin2');
select throws_ok(format($$ select public.task_stage_move(%L, %L) $$, pg_temp.fx('t'), pg_temp.stage('t', 'Stage 4')),
  'P0001', 'NOT_FOUND', 'an Admin not on it, who did not make it, is refused the same way');
select pg_temp.as_system();
select is(pg_temp.rows_of('t'), (select v from snap where k = 't-rows'), 'nothing moved: every row of the task as it was');
select is(pg_temp.moves('t'), 0::bigint, 'and no history entry');

-- 2. The creator -----------------------------------------------------------------------------------------
select pg_temp.as_member('admin1');
select lives_ok($$ select pg_temp.move('t', 'Stage 5', null) $$, 'the creator moves Stage 5 to the top');
select pg_temp.as_system();
select is(pg_temp.order_of('t'), 'Stage 5,Stage 1,Stage 2,Stage 3,Stage 4', 'the new order');
select is((select count(*) from public.task_stages s join snap on snap.k = 'pos:' || s.name
           where s.task_id = pg_temp.fx('t') and s.position <> snap.v), 1::bigint,
  'only the moved stage takes a new key: no other stage is rewritten');
select is(pg_temp.ticks_of('t'), (select v from snap where k = 'ticks'), 'every tick, name and author is kept');
select is((select row(l.actor_id, l.on_behalf_of_id, l.meta ->> 'name', l.meta ->> 'from', l.meta ->> 'to', l.meta ->> 'of')::text
           from public.activity_log l where l.entity = 'task_stages' and l.entity_id = pg_temp.fx('t') and l.action = 'stage_moved'),
  row(pg_temp.fx('admin1'), null::uuid, 'Stage 5', '5', '1', '5')::text,
  'one history entry: stage_moved by the creator, Stage 5 from 5 to 1 of 5');
select is((select count(*) from public.activity_log l where l.entity = 'task_stages' and l.entity_id = pg_temp.fx('t')
             and l.action = 'update' and l.diff -> 'new' ? 'position'), 0::bigint, 'and no second, plain update entry');
select is((select count(*)::text from public.notifications), (select v from snap where k = 'notes'), 'nobody is notified');

-- 3. The Owner moves the ticked stage ---------------------------------------------------------------------------
select pg_temp.as_member('owner');
select lives_ok($$ select pg_temp.move('t', 'Stage 2', 'Stage 4') $$, 'the Owner moves Stage 2 (ticked) to the end');
select throws_ok($$ select pg_temp.move('t', 'Stage 3', 'Stage 5', 'free') $$, 'P0001', 'FORBIDDEN',
  'but never for someone else: on_behalf_of is refused, the Owner''s too');
select pg_temp.as_system();
select is(pg_temp.order_of('t'), 'Stage 5,Stage 1,Stage 3,Stage 4,Stage 2', 'after Stage 4');
select is(pg_temp.ticks_of('t'), (select v from snap where k = 'ticks'), 'the moved stage keeps its tick (time and author)');
select isnt((select done_at from public.task_stages where id = pg_temp.stage('t', 'Stage 2')), null, 'still ticked');
select is((select row(l.actor_id, l.on_behalf_of_id)::text from public.activity_log l
           where l.entity = 'task_stages' and l.entity_id = pg_temp.fx('t') and l.action = 'stage_moved' and l.meta ->> 'name' = 'Stage 2'),
  row(pg_temp.fx('owner'), null::uuid)::text, 'recorded as the Owner, for nobody');

-- 4. The approving Admin (within the task's edit scope) ------------------------------------------------------------
select pg_temp.as_member('admin2');
select lives_ok($$ select pg_temp.move('app', 'Stage C', null) $$, 'the approving Admin moves a stage on the task they approve');
select pg_temp.as_member('admin1');
select throws_ok(format($$ select public.task_stage_move(%L, %L) $$, pg_temp.fx('app'), pg_temp.stage('app', 'Stage A')),
  'P0001', 'NOT_FOUND', 'an Admin outside that task''s edit scope is refused');
select pg_temp.as_member('staff1');
select throws_ok($$ select pg_temp.move('app', 'Stage A', null) $$, 'P0001', 'FORBIDDEN',
  'its primary owner (Crew) is refused there too');
select pg_temp.as_system();
select is(pg_temp.order_of('app'), 'Stage C,Stage A,Stage B', 'the approving Admin''s move landed');
select is(pg_temp.moves('app'), 1::bigint, 'one history entry on that task');

-- 5. Validation ----------------------------------------------------------------------------------------------
select pg_temp.as_member('admin1');
select throws_ok(format($$ select public.task_stage_move(%L, %L, %L) $$, pg_temp.fx('t'), pg_temp.stage('t', 'Stage 4'), pg_temp.stage('t', 'Stage 4')),
  'P0001', 'VALIDATION', 'a stage never moves after itself');
select throws_ok(format($$ select public.task_stage_move(%L, %L) $$, pg_temp.fx('t'), pg_temp.stage('other', 'Stage 1')),
  'P0001', 'NOT_FOUND', 'a stage of another task is not on this one');
select throws_ok(format($$ select public.task_stage_move(%L, %L, %L) $$, pg_temp.fx('t'), pg_temp.stage('t', 'Stage 4'), pg_temp.stage('other', 'Stage 1')),
  'P0001', 'NOT_FOUND', 'nor is a neighbour from another task');
select pg_temp.as_system();
insert into snap values ('moves', pg_temp.moves('t')::text);
select pg_temp.as_member('admin1');
select lives_ok($$ select pg_temp.move('t', 'Stage 3', 'Stage 1') $$, 'a move to where it already is');
select pg_temp.as_system();
select is(pg_temp.moves('t')::text, (select v from snap where k = 'moves'), 'changes nothing and records nothing');

-- 6. Reorder only: an assignee's edit rights are unchanged -------------------------------------------------------
select pg_temp.as_member('staff2');
select throws_ok(format($$ insert into public.task_stages (task_id, name, position) values (%L, 'Mine', 'z0') $$, pg_temp.fx('t')),
  'P0001', 'FORBIDDEN', 'an assignee still does not add a stage');
select throws_ok(format($$ update public.task_stages set name = 'Renamed' where id = %L $$, pg_temp.stage('t', 'Stage 4')),
  'P0001', 'FORBIDDEN', 'nor rename one');
select throws_ok(format($$ update public.task_stages set position = 'a' where id = %L $$, pg_temp.stage('t', 'Stage 4')),
  'P0001', 'FORBIDDEN', 'nor write a position directly');
select throws_ok(format($$ delete from public.task_stages where id = %L $$, pg_temp.stage('t', 'Stage 4')),
  'P0001', 'FORBIDDEN', 'nor remove one');
select pg_temp.as_member('admin1');
select lives_ok(format($$ update public.task_stages set name = 'Stage 4b' where id = %L $$, pg_temp.stage('t', 'Stage 4')),
  'the creator still renames');
select lives_ok(format($$ update public.task_stages set name = 'Stage 4' where id = %L $$, pg_temp.stage('t', 'Stage 4b')),
  'and back');
select pg_temp.as_member('staff3');
select is(pg_temp.rows(format($$ update public.task_stages set position = 'a' where task_id = %L $$, pg_temp.fx('t'))), 0::bigint,
  'a Crew member not on the task touches no stage directly either');
select pg_temp.as_system();
select is(pg_temp.order_of('t'), 'Stage 5,Stage 1,Stage 3,Stage 4,Stage 2', 'the order is as the moves left it');

-- 7. The lock is the editors' existing one -----------------------------------------------------------------------
select pg_temp.as_member('staff1');
select lives_ok(format($$ select public.task_submit_done(%L, 'Done') $$, pg_temp.fx('t')), 'the primary owner marks Done');
select pg_temp.as_system();
select is((select state from public.tasks where id = pg_temp.fx('t')), 'submitted'::public.task_state, 'with the approving Admin');
select pg_temp.as_member('admin1');
select lives_ok($$ select pg_temp.move('t', 'Stage 2', null) $$, 'the creator still moves a stage while it is with the reviewers');
select lives_ok(format($$ select public.task_review(%L, 'rejected', 'Again') $$, pg_temp.fx('t')),
  'the Admin asks for changes');
select pg_temp.as_member('staff2');
select throws_ok($$ select pg_temp.move('t', 'Stage 2', 'Stage 4') $$, 'P0001', 'FORBIDDEN',
  'with changes requested the assignee (Crew) is still refused');
select pg_temp.as_member('owner');
select lives_ok($$ select pg_temp.move('t', 'Stage 2', 'Stage 4') $$, 'the Owner moves it instead');
select pg_temp.as_member('admin1');
select lives_ok(format($$ select public.task_cancel(%L, 'Not needed') $$, pg_temp.fx('t')), 'the creator cancels the task');
select throws_ok($$ select pg_temp.move('t', 'Stage 2', null) $$, 'P0001', 'INVALID_STATE',
  'a cancelled task''s stages stay where they are, for the creator');
select pg_temp.as_member('owner');
select throws_ok($$ select pg_temp.move('t', 'Stage 2', null) $$, 'P0001', 'INVALID_STATE', 'and for the Owner');
select pg_temp.as_system();
select is(pg_temp.ticks_of('t'), (select v from snap where k = 'ticks'), 'after every move, every tick is as it was');

-- 8. Old rows with equal keys: renumbered in the new order, ticks kept ------------------------------------------
select pg_temp.mk('dup', 'admin1', array['staff2'], array['Stage A', 'Stage B', 'Stage C']);
update public.task_stages set position = 'a0' where task_id = pg_temp.fx('dup');
update public.task_stages set done_at = now() - interval '1 day', done_by = pg_temp.fx('staff2')
where id = pg_temp.stage('dup', 'Stage A');
insert into snap values ('dup', pg_temp.ticks_of('dup'));
insert into snap values ('dup-order', pg_temp.order_of('dup'));
select pg_temp.as_member('admin1');
select lives_ok(format($$ select public.task_stage_move(%L, %L, %L) $$, pg_temp.fx('dup'),
    pg_temp.stage('dup', split_part((select v from snap where k = 'dup-order'), ',', 1)),
    pg_temp.stage('dup', split_part((select v from snap where k = 'dup-order'), ',', 2))),
  'a move between two stages that share a key');
select pg_temp.as_system();
select is((select count(distinct s.position) from public.task_stages s where s.task_id = pg_temp.fx('dup')), 3::bigint,
  'the task''s stages took fresh, distinct keys');
select is(pg_temp.order_of('dup'),
  split_part((select v from snap where k = 'dup-order'), ',', 2) || ',' || split_part((select v from snap where k = 'dup-order'), ',', 1)
    || ',' || split_part((select v from snap where k = 'dup-order'), ',', 3),
  'in the new order: the first one after the second');
select is(pg_temp.ticks_of('dup'), (select v from snap where k = 'dup'), 'ticks untouched');
select is(pg_temp.moves('dup'), 1::bigint, 'one history entry');

-- 9. A task nobody moved keeps every row ------------------------------------------------------------------------
select is(pg_temp.rows_of('other'), (select v from snap where k = 'other'), 'the other task: every row unchanged');

select * from finish();
rollback;
