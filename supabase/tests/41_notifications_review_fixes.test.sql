begin;
create extension if not exists pgtap with schema extensions;
select plan(67);

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
from (values ('owner', 'owner'), ('admin1', 'admin'), ('admin2', 'admin'), ('staff1', 'staff'), ('staff2', 'staff'),
             ('coord', 'staff'), ('old', 'staff')) as v(k, r);
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
select pg_temp.as_system();
select pg_temp.clear();

-- 1. app.task_visible_to: app.task_visible's rules for a named member (M1) --------------------------
select pg_temp.as_member('owner');
insert into fx values ('t1', pg_temp.mk('Wedding reel', array['staff1', 'asha'], 'staff1', 'admin2', 'client_a'));
select pg_temp.as_member('admin1');
insert into fx values ('t0', pg_temp.mk('Admin1''s own', array['staff2'], 'staff2'));
select pg_temp.as_system();
select ok(not has_function_privilege('authenticated', 'app.task_visible_to(uuid, uuid)', 'execute')
          and has_function_privilege('service_role', 'app.task_visible_to(uuid, uuid)', 'execute'),
  'task_visible_to: service_role only');
select ok(app.task_visible_to(pg_temp.fx('t1'), pg_temp.fx('owner')), 'the Owner sees every task');
select ok(app.task_visible_to(pg_temp.fx('t0'), pg_temp.fx('admin1')), 'the creator sees their task');
select ok(not app.task_visible_to(pg_temp.fx('t0'), pg_temp.fx('admin2')), 'another Admin does not');
select ok(app.task_visible_to(pg_temp.fx('t1'), pg_temp.fx('admin2')), 'the approving Admin sees it');
select ok(app.task_visible_to(pg_temp.fx('t1'), pg_temp.fx('staff1')), 'an assignee sees it');
select ok(app.task_visible_to(pg_temp.fx('t1'), pg_temp.fx('asha')), 'a freelancer assignee counts as seeing it (their row is routed)');
select ok(app.task_visible_to(pg_temp.fx('t1'), pg_temp.fx('coord')), 'the coordinator of a freelancer assignee sees it (ADR-0013 §6)');
select ok(not app.task_visible_to(pg_temp.fx('t1'), pg_temp.fx('staff2')), 'Staff not on it do not');
select ok(not app.task_visible_to(pg_temp.fx('t1'), pg_temp.fx('gone')), 'nor a deactivated person');
select ok(not app.task_visible_to(pg_temp.fx('t1'), '00000000-0000-4000-8000-000000000e99'), 'nor an unknown id');
-- The label: admin1 has no role on t1 and sees it only while it is labelled with their client.
select ok(app.task_visible_to(pg_temp.fx('t1'), pg_temp.fx('admin1')), 'an Admin sees a task labelled with their client');
update public.tasks set client_id = pg_temp.fx('client_b') where id = pg_temp.fx('t1');
select ok(not app.task_visible_to(pg_temp.fx('t1'), pg_temp.fx('admin1')), 'and no longer once the label is another Admin''s client');
update public.tasks set client_id = pg_temp.fx('client_a') where id = pg_temp.fx('t1');
select pg_temp.as_member('owner');
select public.task_update_assignment(pg_temp.fx('t1'), jsonb_build_object(
  'assignee_ids', jsonb_build_array(pg_temp.fx('staff2'), pg_temp.fx('asha')), 'primary_owner_id', pg_temp.fx('staff2')));
select pg_temp.as_system();
select ok(not app.task_visible_to(pg_temp.fx('t1'), pg_temp.fx('staff1')), 'a removed assignee sees nothing');
select pg_temp.as_member('owner');
select public.member_set_coordinator(pg_temp.fx('asha'), pg_temp.fx('old'), 'Handover');
select pg_temp.as_system();
select ok(not app.task_visible_to(pg_temp.fx('t1'), pg_temp.fx('coord')), 'nor a former coordinator');
select ok(app.task_visible_to(pg_temp.fx('t1'), pg_temp.fx('old')), 'the new coordinator does');
select pg_temp.as_member('owner');
select public.member_set_coordinator(pg_temp.fx('asha'), pg_temp.fx('coord'), 'Back');
select public.task_update_assignment(pg_temp.fx('t1'), jsonb_build_object(
  'assignee_ids', jsonb_build_array(pg_temp.fx('staff1'), pg_temp.fx('staff2'), pg_temp.fx('asha')), 'primary_owner_id', pg_temp.fx('staff1')));
select pg_temp.as_system();

-- 2. M1: a comment reaches only people who can still see the task ----------------------------------
-- staff2 comments, then is removed; the coordinator comments for Asha, then Asha is removed.
select pg_temp.clear();
select pg_temp.as_member('staff2');
insert into public.task_comments (task_id, body) values (pg_temp.fx('t1'), 'On it');
select pg_temp.as_member('coord');
insert into public.task_comments (task_id, body, on_behalf_of) values (pg_temp.fx('t1'), 'Asha is free Monday', pg_temp.fx('asha'));
select pg_temp.as_system();
select is(pg_temp.n('staff2', 'task_comment'), 1::bigint, 'while on the task, staff2 is told of the coordinator''s comment');
select pg_temp.as_member('owner');
select public.task_update_assignment(pg_temp.fx('t1'), jsonb_build_object('assignee_ids', jsonb_build_array(pg_temp.fx('staff1'))));
select pg_temp.clear();
select pg_temp.as_member('staff1');
insert into public.task_comments (task_id, body) values (pg_temp.fx('t1'), 'Final cut is up');
select pg_temp.as_system();
select is(pg_temp.n('staff2'), 0::bigint, 'a removed assignee who had commented gets nothing for a later comment (M1)');
select is(pg_temp.n('coord'), 0::bigint, 'nor the coordinator who commented for a freelancer since removed');
select is(pg_temp.n('owner', 'task_comment') + pg_temp.n('admin2', 'task_comment'), 2::bigint,
  'the creator and the approving Admin are told');
select is(pg_temp.n('admin1'), 0::bigint, 'the client''s Admin can see the task but is not in the comment set (decision 15 names no label Admin)');
select is(pg_temp.total(), 2::bigint, 'two rows: nobody who cannot open the task');
select pg_temp.clear();
select pg_temp.as_member('owner');
select public.task_update_assignment(pg_temp.fx('t1'), jsonb_build_object('assignee_ids', jsonb_build_array(pg_temp.fx('staff1'), pg_temp.fx('staff2'))));
select pg_temp.clear();
select pg_temp.as_member('staff1');
insert into public.task_comments (task_id, body) values (pg_temp.fx('t1'), 'Back on');
select pg_temp.as_system();
select is(pg_temp.n('staff2', 'task_comment'), 1::bigint, 'back on the task, staff2 is told again');

-- 3. S1: the reminder within [logout_reminder_time, + 5 min) only ---------------------------------------
select pg_temp.clear();
delete from public.attendance_events;
delete from public.attendance_days;
insert into public.attendance_days (member_id, work_date, started_at, is_day_off)
values (pg_temp.fx('staff1'), pg_temp.today(), app.ist_day_start(pg_temp.today()) + interval '9 hours 30 minutes', false);
select is(app.end_day_reminder(app.ist_day_start(pg_temp.today()) + interval '19 hours'), 0, '19:00: before the time, nothing');
select is(app.end_day_reminder(app.ist_day_start(pg_temp.today()) + interval '20 hours 29 minutes 59 seconds'), 0, '20:29:59: still nothing');
select is(app.end_day_reminder(app.ist_day_start(pg_temp.today()) + interval '20 hours 30 minutes'), 1, '20:30: the reminder');
select is(app.end_day_reminder(app.ist_day_start(pg_temp.today()) + interval '20 hours 34 minutes'), 0, '20:34: not twice');
insert into public.attendance_days (member_id, work_date, started_at, is_day_off)
values (pg_temp.fx('staff2'), pg_temp.today(), app.ist_day_start(pg_temp.today()) + interval '10 hours', false);
select is(app.end_day_reminder(app.ist_day_start(pg_temp.today()) + interval '20 hours 34 minutes 59 seconds'), 1, '20:34:59: a second person still inside the window');
insert into public.attendance_days (member_id, work_date, started_at, is_day_off)
values (pg_temp.fx('old'), pg_temp.today(), app.ist_day_start(pg_temp.today()) + interval '10 hours', false);
select is(app.end_day_reminder(app.ist_day_start(pg_temp.today()) + interval '20 hours 35 minutes'), 0, '20:35: the window is closed, a later run sends nothing (S1)');
select is(app.end_day_reminder(app.ist_day_start(pg_temp.today()) + interval '23 hours 55 minutes'), 0, '23:55: nor at the end of the evening');
select is(pg_temp.total(), 2::bigint, 'two rows in all');
-- An org time outside the old 17:30-00:25 IST cron window is honoured now.
update public.org_settings set logout_reminder_time = '15:00';
select pg_temp.clear();
select is(app.end_day_reminder(app.ist_day_start(pg_temp.today()) + interval '14 hours 59 minutes'), 0, '14:59 for a 15:00 time: nothing');
select is(app.end_day_reminder(app.ist_day_start(pg_temp.today()) + interval '15 hours 2 minutes'), 3, '15:02: everyone with an open day, at the org''s own time');
select is(app.end_day_reminder(app.ist_day_start(pg_temp.today()) + interval '17 hours 30 minutes'), 0, '17:30 (the old window''s first run): nothing');
update public.org_settings set logout_reminder_time = '20:30';

-- 4. S2: a reason is never concatenated as null ----------------------------------------------------------
select pg_temp.clear();
select pg_temp.as_member('staff1');
insert into fx values ('l1', public.leave_submit('leave', pg_temp.today() + 10, pg_temp.today() + 11));
insert into fx values ('l2', public.leave_submit('leave', pg_temp.today() + 20, pg_temp.today() + 20));
select pg_temp.as_member('owner');
select throws_ok(format($$ select public.leave_decide(%L, 'reject') $$, pg_temp.fx('l2')), 'P0001', 'REASON_REQUIRED',
  'a rejection without a reason is refused before any row is written');
select throws_ok(format($$ select public.leave_decide(%L, 'reject', '   ') $$, pg_temp.fx('l2')), 'P0001', 'REASON_REQUIRED', 'blank too');
select public.leave_decide(pg_temp.fx('l2'), 'reject', 'Shoot that day');
select public.leave_decide(pg_temp.fx('l1'), 'approve');
select throws_ok(format($$ select public.leave_owner_cancel(%L) $$, pg_temp.fx('l1')), 'P0001', 'REASON_REQUIRED',
  'an Owner cancellation without a reason is refused');
select public.leave_owner_cancel(pg_temp.fx('l1'), 'Needed on set');
select pg_temp.as_system();
select is((select x.body from public.notifications x where x.recipient_id = pg_temp.fx('staff1') and x.title = 'Leave cancelled by the Owner'),
  app.notify_span(pg_temp.today() + 10, pg_temp.today() + 11) || ' · Needed on set',
  'the cancellation body carries the dates and the reason');
select is((select count(*) from public.notifications where kind = 'leave_decided' and body is null), 0::bigint,
  'no leave_decided row has a null body');
select is((select count(*) from public.notifications where kind = 'leave_decided' and body like '%Shoot that day'), 1::bigint,
  'the rejection body carries its reason');

-- 5. S4: the kickoff-5 settings are the Owner's; RLS with rows of others present; the guard ----------------
select pg_temp.as_member('owner');
select is(pg_temp.rows($$ update public.org_settings set quiet_hours_start = '21:00', quiet_hours_end = '06:30', email_daily_cap_org = 80 $$), 1::bigint,
  'the Owner sets the quiet hours and the org email ceiling');
select pg_temp.as_member('admin1');
select is(pg_temp.rows($$ update public.org_settings set quiet_hours_start = '20:00' $$), 0::bigint, 'an Admin cannot (RLS: settings.manage)');
select is(pg_temp.rows($$ update public.org_settings set email_daily_cap_org = 10 $$), 0::bigint, 'nor the ceiling');
select pg_temp.as_member('staff1');
select is(pg_temp.rows($$ update public.org_settings set quiet_hours_end = '08:00' $$), 0::bigint, 'nor Staff');
select pg_temp.as_system();
select is((select (quiet_hours_start, quiet_hours_end, email_daily_cap_org)::text from public.org_settings limit 1), '(21:00:00,06:30:00,80)',
  'the Owner''s values stand');
update public.org_settings set quiet_hours_start = '22:00', quiet_hours_end = '07:00', email_daily_cap_org = 90;
-- notifications RLS for an Admin, with other people's rows present first.
select pg_temp.clear();
select app.notify(array[pg_temp.fx('staff1'), pg_temp.fx('owner')], 'task_changed', 'Not admin1''s', null, null, null, null, '{}', null);
select pg_temp.as_member('admin1');
select is((select count(*) from public.notifications), 0::bigint, 'an Admin reads none of the two rows other people hold');
select pg_temp.as_system();
select app.notify(array[pg_temp.fx('admin1')], 'task_changed', 'admin1''s own', null, null, null, null, '{}', null);
select pg_temp.as_member('admin1');
select is((select count(*) from public.notifications), 1::bigint, 'and exactly their own once it exists');
select is((select title from public.notifications), 'admin1''s own', 'the right one');
select is(pg_temp.rows($$ update public.notifications set read_at = now() $$), 1::bigint, 'marking read touches their row only');
-- push_subscriptions_guard: a freelancer (no login, engagement freelance) is refused.
-- (The step 1 guard was SECURITY DEFINER, so app.in_transition() was always true inside it and it
-- never fired; the review's S4 test found it. It is SECURITY INVOKER now, like every other guard.)
select ok(not (select p.prosecdef from pg_proc p where p.oid = 'app.push_subscriptions_guard()'::regprocedure),
  'push_subscriptions_guard runs as the caller (security invoker), so in_transition() means what it says');
select pg_temp.as_member('asha');
select throws_ok($$ insert into public.push_subscriptions (endpoint, p256dh, auth) values ('https://push.example/asha', 'k', 'a') $$,
  '42501', null, 'a non-permanent member cannot insert (INSERT is revoked since 5A review M2; the upsert refuses them, pgTAP 42)');
select pg_temp.as_member('staff1');
select throws_ok(format($$ insert into public.push_subscriptions (member_id, endpoint, p256dh, auth) values (%L, 'https://push.example/x', 'k', 'a') $$, pg_temp.fx('staff2')),
  '42501', null, 'nor anyone a row for someone else (INSERT revoked, 5A review M2)');
select pg_temp.as_member('staff1');
select lives_ok($$ select public.push_subscription_upsert('https://push.example/s1',
    'B' || repeat('A', 86), repeat('A', 22)) $$,
  'a permanent member can, through the RPC');
select pg_temp.as_system();
select is((select count(*) from public.push_subscriptions), 1::bigint, 'one row');
select ok((select obj_description('public.push_subscriptions'::regclass) like '%Not audited%'),
  'push_subscriptions says why it is not audited (S5)');
select ok(not exists (select 1 from pg_trigger t where t.tgrelid = 'public.push_subscriptions'::regclass and t.tgname like '%audit%'),
  'and carries no audit trigger');

-- 6. L1: a requester who is on the converted task gets task_assigned only --------------------------------
select pg_temp.clear();
select pg_temp.as_member('staff1');
insert into fx values ('r1', public.task_request_create('Anniversary post', null, pg_temp.fx('client_a')));
insert into fx values ('r2', public.task_request_create('Another post', null, pg_temp.fx('client_a')));
select pg_temp.clear();
select pg_temp.as_member('owner');
insert into fx values ('t2', public.task_request_convert(pg_temp.fx('r1'), 'Anniversary post', null, pg_temp.type_id('Normal'), pg_temp.fx('client_a'), 'medium',
  pg_temp.due(), array[pg_temp.fx('staff1'), pg_temp.fx('staff2')], pg_temp.fx('staff1'), pg_temp.fx('admin1')));
select pg_temp.as_system();
select is(pg_temp.n('staff1', 'task_assigned'), 1::bigint, 'the requester, now an assignee, is assigned');
select is(pg_temp.n('staff1', 'task_request_converted'), 0::bigint, 'and not told twice (L1)');
select is(pg_temp.n('staff1'), 1::bigint, 'one row for them');
select is(pg_temp.n('staff2', 'task_assigned'), 1::bigint, 'the other assignee is assigned');
select pg_temp.clear();
select pg_temp.as_member('owner');
select public.task_request_convert(pg_temp.fx('r2'), 'Another post', null, pg_temp.type_id('Normal'), pg_temp.fx('client_a'), 'medium',
  pg_temp.due(), array[pg_temp.fx('staff2')], pg_temp.fx('staff2'), pg_temp.fx('admin1'));
select pg_temp.as_system();
select is(pg_temp.n('staff1', 'task_request_converted'), 1::bigint, 'a requester not on the task is still told it became one');
select is(pg_temp.n('staff1'), 1::bigint, 'once');

-- 7. L2: coordinator_missing only for an active freelancer ---------------------------------------------------
select pg_temp.clear();
select pg_temp.as_member('owner');
select throws_ok(format($$ select public.member_deactivate(%L, 'Leaving') $$, pg_temp.fx('admin1')), 'P0001', 'CONFLICT',
  'a coordinator with an active freelancer cannot be deactivated (4A)');
select is(pg_temp.total(), 0::bigint, 'nothing written by the refusal');
select public.member_deactivate(pg_temp.fx('bina'), 'Contract ended');
-- A coordinator set on the deactivated freelancer, to prepare her return (4A review M2).
select public.member_set_coordinator(pg_temp.fx('bina'), pg_temp.fx('admin2'), 'For her return');
select pg_temp.clear();
update public.clients set admin_id = pg_temp.fx('admin1') where id = pg_temp.fx('client_b');
select pg_temp.as_member('owner');
select public.member_deactivate(pg_temp.fx('admin2'), 'Left the company');
select pg_temp.as_system();
select is((select count(*) from public.member_coordinators mc where mc.member_id = pg_temp.fx('bina') and mc.to_at is null), 0::bigint,
  'the deactivated freelancer''s coordinator row is closed with the leaver (4A review M2)');
select is(pg_temp.n('owner', 'coordinator_missing'), 0::bigint,
  'but the Owner is not asked to choose a coordinator for a deactivated freelancer (L2)');
select is(pg_temp.total(), 0::bigint, 'no row at all');

select * from finish();
rollback;
