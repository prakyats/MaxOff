-- v3.5 "Month close", U3 (migration v35_month_correct; WORKFLOWS §7.1 and §7.4; DATA-MODEL §9): month_correct.
--   0. the function and its helpers: definer and search_path, who may execute; the chain's constraints;
--   1. who corrects: the Owner only (Admin, Crew, a freelancer, a deactivated member, no sign-in, anon refused),
--      the same refusal before and after the month is closed;
--   2. the checks: no month, the note's bounds (trimmed), a month not closed;
--   3. "Nothing changed.": an unchanged rebuild, and a rename alone (client, project, deliverable, person);
--   4. a correction: version 2 corrects version 1, the trimmed note, a fresh build; v1 kept byte for byte;
--      a further correction corrects version 2; nothing changed again is refused;
--   5. the history: one entry per correction, month and version only, no amount, no note; an Admin and Crew
--      read none; nobody notified;
--   6. the chain at the table level: "v3 corrects v1 while v2 exists", a cross-organization corrects_id and
--      another month's are refused by the table; no direct insert for the Owner; the stored chain is linear;
--   7. another organization never sees org A's close.
-- Every name here is neutral.
begin;
create extension if not exists pgtap with schema extensions;
select plan(57);

delete from public.month_snapshots;

delete from public.deliverable_templates;
delete from public.item_reviews;
delete from public.project_item_stage_list;
delete from public.project_item_stages;
delete from public.revenue_overrides;
delete from public.project_advances;
delete from public.item_billing;
delete from public.cycle_billing;
delete from public.project_billing;
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

create temporary table fx (key text primary key, id uuid not null);
insert into fx values
  ('owner',    '00000000-0000-4000-8000-000000162901'),
  ('admin',    '00000000-0000-4000-8000-000000162902'),
  ('staff',    '00000000-0000-4000-8000-000000162903'),
  ('free',     '00000000-0000-4000-8000-000000162904'),
  ('gone',     '00000000-0000-4000-8000-000000162905'),
  ('org_b',    '00000000-0000-4000-8000-000000162910'),
  ('b_owner',  '00000000-0000-4000-8000-000000162911'),
  ('b_admin',  '00000000-0000-4000-8000-000000162912'),
  ('client',   '00000000-0000-4000-8000-0000001629c1'),
  ('b_client', '00000000-0000-4000-8000-0000001629c2');
insert into fx select 'org', id from public.organizations limit 1;
grant select, insert on fx to authenticated, anon, service_role;

-- The months, from the real IST date: this month, last month, the month before.
create temporary table mo (key text primary key, d date not null);
insert into mo values ('m0', app.month_start(app.today_ist()));
insert into mo values ('m1', app.month_start((select d from mo where key = 'm0') - 1));
insert into mo values ('m2', app.month_start((select d from mo where key = 'm1') - 1));
grant select on mo to authenticated, anon, service_role;

create function pg_temp.fx(k text) returns uuid language sql stable as $$
  select id from fx where key = k;
$$;
create function pg_temp.mo(k text) returns date language sql stable as $$
  select d from mo where key = k;
$$;
create function pg_temp.name(k text) returns text language sql stable as $$
  select to_char(pg_temp.mo(k), 'FMMonth YYYY');
$$;
create function pg_temp.as_member(k text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', pg_temp.fx(k)::text, true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', pg_temp.fx(k), 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end;
$$;
-- The Owner's sign-in on the database's own role: what month_close itself runs as (security definer), so
-- the internal builder and helper can be asked directly and compared.
create function pg_temp.as_owner_inside(k text) returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claim.sub', pg_temp.fx(k)::text, true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', pg_temp.fx(k), 'role', 'authenticated')::text, true);
end;
$$;
create function pg_temp.as_system() returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', '', true);
end;
$$;
create function pg_temp.as_nobody() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', json_build_object('role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end;
$$;
create function pg_temp.as_anon() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  perform set_config('role', 'anon', true);
end;
$$;
-- How a call ends: 'ok', NO_PRIVILEGE, or "CODE: the reason".
create function pg_temp.err(sql text) returns text language plpgsql as $$
declare
  v_detail text;
begin
  execute sql;
  return 'ok';
exception
  when sqlstate 'P0001' then
    get stacked diagnostics v_detail = pg_exception_detail;
    return sqlerrm || coalesce(': ' || nullif(v_detail, ''), '');
  when insufficient_privilege then return 'NO_PRIVILEGE';
end;
$$;
-- The snapshot of a month (the latest version), read as the database.
create function pg_temp.snap(p_org uuid, k text) returns public.month_snapshots language sql stable as $$
  select s from public.month_snapshots s where s.org_id = p_org and s.month = pg_temp.mo(k) order by s.version desc limit 1;
$$;
create function pg_temp.keys(j jsonb) returns text[] language sql immutable as $$
  select array_agg(k order by k) from jsonb_object_keys(j) k;
$$;


-- People: org A (the seed's organization) and org B.
insert into public.organizations (id, name) values (pg_temp.fx('org_b'), 'Other org 162');
insert into auth.users (id, email)
select id, key || '-162@example.com' from fx where key in ('owner', 'admin', 'staff', 'free', 'gone', 'b_owner', 'b_admin');
insert into public.members (id, org_id, full_name, email, role, status, engagement, joined_at, deactivated_at) values
  (pg_temp.fx('owner'),   pg_temp.fx('org'),   'Test Owner',  'owner-162@example.com',   'owner', 'active',      'permanent', now() - interval '120 days', null),
  (pg_temp.fx('admin'),   pg_temp.fx('org'),   'Test Admin',  'admin-162@example.com',   'admin', 'active',      'permanent', now(), null),
  (pg_temp.fx('staff'),   pg_temp.fx('org'),   'Test Crew',   'staff-162@example.com',   'staff', 'active',      'permanent', now() - interval '120 days', null),
  (pg_temp.fx('free'),    pg_temp.fx('org'),   'Test Free',   null,                      'staff', 'active',      'freelance', now(), null),
  (pg_temp.fx('gone'),    pg_temp.fx('org'),   'Test Gone',   'gone-162@example.com',    'admin', 'deactivated', 'permanent', now() - interval '9 days', now()),
  (pg_temp.fx('b_owner'), pg_temp.fx('org_b'), 'Other Owner', 'b_owner-162@example.com', 'owner', 'active',      'permanent', now(), null),
  (pg_temp.fx('b_admin'), pg_temp.fx('org_b'), 'Other Admin', 'b_admin-162@example.com', 'admin', 'active',      'permanent', now(), null);
select pg_temp.as_owner_inside('owner');
insert into public.clients (id, org_id, name, state, admin_id, activated_at) values
  (pg_temp.fx('client'),   pg_temp.fx('org'),   'Client 162',       'active', pg_temp.fx('admin'),   now());
select pg_temp.as_owner_inside('b_owner');
insert into public.clients (id, org_id, name, state, admin_id, activated_at) values
  (pg_temp.fx('b_client'), pg_temp.fx('org_b'), 'Other client 162', 'active', pg_temp.fx('b_admin'), now());

-- Org A: a monthly retainer; last month's cycle priced alone at 6,000 with A done (3,000) and B open.
select pg_temp.as_member('admin');
insert into fx values ('p', public.project_create(pg_temp.fx('client'), 'Monthly 162', 'monthly', null, null,
  array['Stage 1'], array['A', 'B']));
select pg_temp.as_member('owner');
select public.billing_set_project(pg_temp.fx('p'), 9000, true, null);
select pg_temp.as_system();
insert into fx select 'past', (app.cycle_create((select p from public.projects p where p.id = pg_temp.fx('p')),
  pg_temp.mo('m1'), 'schedule', null, true)).id;
insert into fx select 'item_a', i.id from public.project_items i where i.cycle_id = pg_temp.fx('past') and i.title = 'A';
select pg_temp.as_member('owner');
select public.billing_set_cycle_amount(pg_temp.fx('past'), 6000);
select pg_temp.as_member('admin');
select public.item_mark_done(pg_temp.fx('item_a'));

-- Org B: a retainer priced last month, closed by its own Owner.
select pg_temp.as_member('b_admin');
insert into fx values ('bp', public.project_create(pg_temp.fx('b_client'), 'Other monthly 162', 'monthly', null, null,
  array['Stage 1'], array['X']));
select pg_temp.as_system();
insert into fx select 'b_past', (app.cycle_create((select p from public.projects p where p.id = pg_temp.fx('bp')),
  pg_temp.mo('m1'), 'schedule', null, true)).id;
select pg_temp.as_member('b_owner');
select public.billing_set_cycle_amount(pg_temp.fx('b_past'), 7777);

-- ===========================================================================================================
-- 0. The function, its helpers and the chain's constraints
-- ===========================================================================================================
select has_function('public', 'month_correct', array['date', 'text'], 'month_correct(month date, note text) exists');
select ok((select p.prosecdef and p.proconfig @> array['search_path=""'] and p.prorettype = 'integer'::regtype
           from pg_proc p where p.oid = 'public.month_correct(date, text)'::regprocedure),
  'month_correct: security definer, empty search_path, returns an integer');
select ok(has_function_privilege('authenticated', 'public.month_correct(date, text)', 'execute')
          and not has_function_privilege('anon', 'public.month_correct(date, text)', 'execute'),
  'month_correct: authenticated may call it, anon may not');
select ok(not has_function_privilege('authenticated', 'app.month_snapshot_figures(jsonb)', 'execute')
          and not has_function_privilege('anon', 'app.month_snapshot_figures(jsonb)', 'execute')
          and not has_function_privilege('authenticated', 'app.month_revenue_changes(uuid, jsonb, jsonb, timestamptz)', 'execute')
          and not has_function_privilege('anon', 'app.month_revenue_changes(uuid, jsonb, jsonb, timestamptz)', 'execute')
          and not has_function_privilege('authenticated', 'app.month_waiting(uuid, date, date)', 'execute')
          and not has_function_privilege('anon', 'app.month_waiting(uuid, date, date)', 'execute'),
  'the three helpers: never authenticated or anon');
select ok((select bool_and(p.proconfig @> array['search_path=""']) from pg_proc p
           where p.oid in ('app.month_snapshot_figures(jsonb)'::regprocedure,
                           'app.month_revenue_changes(uuid, jsonb, jsonb, timestamptz)'::regprocedure,
                           'app.month_waiting(uuid, date, date)'::regprocedure)),
  'the helpers: an empty search_path');
select col_is_unique('public', 'month_snapshots', array['org_id', 'month', 'id'], 'unique (org_id, month, id): the chain''s key');
select col_is_unique('public', 'month_snapshots', array['corrects_id'], 'a version is corrected at most once');
select fk_ok('public', 'month_snapshots', array['org_id', 'month', 'corrects_id'],
             'public', 'month_snapshots', array['org_id', 'month', 'id'],
  'a correction corrects a version of the same organization and month');

-- ===========================================================================================================
-- 1. Who corrects (before the close: the refusal says nothing about the month)
-- ===========================================================================================================
select pg_temp.as_member('admin');
select is(pg_temp.err(format('select public.month_correct(%L, %L)', pg_temp.mo('m1'), 'A long enough note')),
  'FORBIDDEN: Only the Owner corrects a month.', 'the client''s Admin is refused');
select pg_temp.as_member('staff');
select is(pg_temp.err(format('select public.month_correct(%L, %L)', pg_temp.mo('m1'), 'A long enough note')),
  'FORBIDDEN: Only the Owner corrects a month.', 'Crew are refused');
select pg_temp.as_member('free');
select is(pg_temp.err(format('select public.month_correct(%L, %L)', pg_temp.mo('m1'), 'A long enough note')),
  'FORBIDDEN: Only the Owner corrects a month.', 'a freelancer is refused');
select pg_temp.as_member('gone');
select is(pg_temp.err(format('select public.month_correct(%L, %L)', pg_temp.mo('m1'), 'A long enough note')),
  'FORBIDDEN: Only the Owner corrects a month.', 'a deactivated member is refused');
select pg_temp.as_nobody();
select is(pg_temp.err(format('select public.month_correct(%L, %L)', pg_temp.mo('m1'), 'A long enough note')),
  'FORBIDDEN: Only the Owner corrects a month.', 'no sign-in is refused');
select pg_temp.as_anon();
select is(pg_temp.err(format('select public.month_correct(%L, %L)', pg_temp.mo('m1'), 'A long enough note')),
  'NO_PRIVILEGE', 'anon has no privilege');

-- ===========================================================================================================
-- 2. The checks
-- ===========================================================================================================
select pg_temp.as_member('owner');
select is(pg_temp.err(format('select public.month_correct(null, %L)', 'A long enough note')), 'VALIDATION: Pick a month.',
  'no month is refused');
select is(pg_temp.err(format('select public.month_correct(%L, %L)', pg_temp.mo('m1'), '   123456789   ')),
  'VALIDATION: Write a note of 10 to 500 characters.', 'a note of 9 characters once trimmed is refused');
select is(pg_temp.err(format('select public.month_correct(%L, null)', pg_temp.mo('m1'))),
  'VALIDATION: Write a note of 10 to 500 characters.', 'no note is refused');
select is(pg_temp.err(format('select public.month_correct(%L, %L)', pg_temp.mo('m1'), repeat('n', 501))),
  'VALIDATION: Write a note of 10 to 500 characters.', 'a note of 501 characters is refused');
select is(pg_temp.err(format('select public.month_correct(%L, %L)', pg_temp.mo('m1'), 'A long enough note')),
  'INVALID_STATE: ' || pg_temp.name('m1') || ' isn''t closed.', 'a month not closed is refused');
select is(pg_temp.err(format('select public.month_correct(%L, %L)', pg_temp.mo('m0'), 'A long enough note')),
  'INVALID_STATE: ' || pg_temp.name('m0') || ' isn''t closed.', 'the current month is not closed either');
select pg_temp.as_system();
select is((select count(*)::integer from public.month_snapshots), 0, 'nothing was stored by a refusal');

-- The close (U2), then the same refusals once it is closed.
select pg_temp.as_member('owner');
select is(public.month_close(pg_temp.mo('m1')), 1, 'the Owner closes last month');
select pg_temp.as_member('b_owner');
select is(public.month_close(pg_temp.mo('m1')), 1, 'org B''s Owner closes its own last month');
select pg_temp.as_system();
create temporary table kept (key text primary key, data jsonb not null, id uuid not null);
insert into kept select 'v1', s.data, s.id from public.month_snapshots s where s.org_id = pg_temp.fx('org') and s.version = 1;
grant select on kept to authenticated, anon, service_role;
select pg_temp.as_member('admin');
select is(pg_temp.err(format('select public.month_correct(%L, %L)', pg_temp.mo('m1'), 'A long enough note')),
  'FORBIDDEN: Only the Owner corrects a month.', 'after the close, the Admin gets the very same refusal');
select pg_temp.as_member('staff');
select is(pg_temp.err(format('select public.month_correct(%L, %L)', pg_temp.mo('m1'), 'A long enough note')),
  'FORBIDDEN: Only the Owner corrects a month.', 'and so does Crew');

-- ===========================================================================================================
-- 3. "Nothing changed."
-- ===========================================================================================================
select pg_temp.as_member('owner');
select is(pg_temp.err(format('select public.month_correct(%L, %L)', pg_temp.mo('m1'), 'Checking the month again')),
  'INVALID_STATE: Nothing changed.', 'a rebuild equal to the latest version is refused');
-- Renames only: the client, the project, a deliverable, a person.
select pg_temp.as_owner_inside('owner');
update public.clients set name = 'Client 162 renamed' where id = pg_temp.fx('client');
update public.projects set name = 'Monthly 162 renamed' where id = pg_temp.fx('p');
update public.project_items set title = 'A renamed' where id = pg_temp.fx('item_a');
update public.members set full_name = 'Test Crew renamed' where id = pg_temp.fx('staff');
select ok(app.month_snapshot_build(pg_temp.fx('org'), pg_temp.mo('m1')) <> (select data from kept where key = 'v1'),
  'the renames make the documents differ as text');
select is(app.month_snapshot_figures(app.month_snapshot_build(pg_temp.fx('org'), pg_temp.mo('m1'))),
  app.month_snapshot_figures((select data from kept where key = 'v1')), 'but not their figures');
select pg_temp.as_member('owner');
select is(pg_temp.err(format('select public.month_correct(%L, %L)', pg_temp.mo('m1'), 'The client was renamed')),
  'INVALID_STATE: Nothing changed.', 'a rename alone is "Nothing changed." (WORKFLOWS §7.1)');
select pg_temp.as_system();
select is((select count(*)::integer from public.month_snapshots where org_id = pg_temp.fx('org')), 1, 'still version 1 only');

-- ===========================================================================================================
-- 4. A correction
-- ===========================================================================================================
create temporary table counts (key text primary key, n integer not null);
select pg_temp.as_member('admin');
select public.item_reopen(pg_temp.fx('item_a'), 'Needs another cut');
select pg_temp.as_system();
insert into counts select 'notifications', count(*) from public.notifications;
select pg_temp.as_member('owner');
select is(public.month_correct(pg_temp.mo('m1') + 9, '   A reopened after the close   '), 2,
  'the Owner corrects last month (by its 10th): version 2');
select pg_temp.as_system();
select is((select count(*)::integer from public.notifications), (select n from counts where key = 'notifications'),
  'the correction notified nobody');
select ok((select s.month = pg_temp.mo('m1') and s.corrects_id = (select id from kept where key = 'v1')
                  and s.correction_note = 'A reopened after the close' and s.closed_by = pg_temp.fx('owner')
           from public.month_snapshots s where s.org_id = pg_temp.fx('org') and s.version = 2),
  'version 2: the month''s 1st, corrects version 1, the trimmed note, by the Owner');
select is((select s.data #>> '{revenue,totals,achieved}' from public.month_snapshots s
           where s.org_id = pg_temp.fx('org') and s.version = 2)::numeric, 0::numeric, 'its Achieved is today''s (0)');
select is((select s.data from public.month_snapshots s where s.org_id = pg_temp.fx('org') and s.version = 1),
  (select data from kept where key = 'v1'), 'version 1 is kept byte for byte');
select is(((select data from kept where key = 'v1') #>> '{revenue,totals,achieved}')::numeric, 3000::numeric,
  'and still says 3,000');
select pg_temp.as_owner_inside('owner');
select is((select s.data from public.month_snapshots s where s.org_id = pg_temp.fx('org') and s.version = 2),
  app.month_snapshot_build(pg_temp.fx('org'), pg_temp.mo('m1')), 'version 2 is a fresh build');
select pg_temp.as_member('owner');
select is(pg_temp.err(format('select public.month_correct(%L, %L)', pg_temp.mo('m1'), 'Checking the month again')),
  'INVALID_STATE: Nothing changed.', 'with nothing changed since version 2, refused again');
select pg_temp.as_member('admin');
select public.item_mark_done(pg_temp.fx('item_a'));
select pg_temp.as_member('owner');
select is(public.month_correct(pg_temp.mo('m1'), 'A done again, back to 3,000'), 3, 'a further correction: version 3');
select pg_temp.as_system();
select is((select s.corrects_id from public.month_snapshots s where s.org_id = pg_temp.fx('org') and s.version = 3),
  (select s.id from public.month_snapshots s where s.org_id = pg_temp.fx('org') and s.version = 2),
  'version 3 corrects version 2, the latest');
select is((select count(*)::integer from public.month_snapshots where org_id = pg_temp.fx('org')), 3, 'three versions, all kept');

-- ===========================================================================================================
-- 5. The history and notifications
-- ===========================================================================================================
select is((select count(*)::integer from public.activity_log where entity = 'month_snapshots' and action = 'corrected'
           and org_id = pg_temp.fx('org')), 2, 'one history entry per correction');
select ok((select bool_and(l.actor_id = pg_temp.fx('owner') and l.entity_id = s.id and l.diff = '{}'::jsonb
                           and l.meta = jsonb_build_object('month', pg_temp.mo('m1'), 'version', s.version))
           from public.activity_log l join public.month_snapshots s on s.id = l.entity_id
           where l.entity = 'month_snapshots' and l.action = 'corrected'),
  'each: by the Owner, on its snapshot row, meta = the month and the version, no diff');
select ok((select bool_and(to_jsonb(l)::text not like '%reopened after%' and to_jsonb(l)::text not like '%done again%'
                           and to_jsonb(l)::text not like '%3000%' and to_jsonb(l)::text not like '%6000%'
                           and to_jsonb(l)::text not like '%3,000%')
           from public.activity_log l where l.entity = 'month_snapshots'),
  'no note and no amount anywhere in the entries');
select is((select count(*)::integer from public.notifications where entity = 'month_snapshots'), 0,
  'no notification names a snapshot');
select pg_temp.as_member('admin');
select is((select count(*)::integer from public.activity_log where entity = 'month_snapshots'), 0, 'an Admin reads no correction entry');
select is((select count(*)::integer from public.month_snapshots), 0, 'nor any snapshot');
select pg_temp.as_member('staff');
select is((select count(*)::integer from public.activity_log where entity = 'month_snapshots'), 0, 'nor does Crew');
select pg_temp.as_member('owner');
select is((select count(*)::integer from public.activity_log where entity = 'month_snapshots'), 3, 'the Owner reads the close and both corrections');

-- ===========================================================================================================
-- 6. The chain at the table level (written as the database: nobody else may insert at all)
-- ===========================================================================================================
select pg_temp.as_system();
select throws_ok(format($q$insert into public.month_snapshots (org_id, month, version, data, closed_by, corrects_id, correction_note)
  values (%L, %L, 4, '{"schema": 1}', %L, %L, 'Corrects version 1 again')$q$,
  pg_temp.fx('org'), pg_temp.mo('m1'), pg_temp.fx('owner'), (select id from kept where key = 'v1')),
  '23505', null, 'a version correcting version 1 while version 2 exists is refused by the table');
select throws_ok(format($q$insert into public.month_snapshots (org_id, month, version, data, closed_by, corrects_id, correction_note)
  values (%L, %L, 2, '{"schema": 1}', %L, %L, 'Corrects another org')$q$,
  pg_temp.fx('org_b'), pg_temp.mo('m1'), pg_temp.fx('b_owner'),
  (select s.id from public.month_snapshots s where s.org_id = pg_temp.fx('org') and s.version = 3)),
  '23503', null, 'a correction pointing at another organization''s version is refused by the table');
select throws_ok(format($q$insert into public.month_snapshots (org_id, month, version, data, closed_by, corrects_id, correction_note)
  values (%L, %L, 2, '{"schema": 1}', %L, %L, 'Corrects another month')$q$,
  pg_temp.fx('org'), pg_temp.mo('m2'), pg_temp.fx('owner'),
  (select s.id from public.month_snapshots s where s.org_id = pg_temp.fx('org') and s.version = 3)),
  '23503', null, 'and one pointing at another month''s');
select pg_temp.as_member('owner');
select is(pg_temp.err(format($q$insert into public.month_snapshots (org_id, month, version, data, closed_by, corrects_id, correction_note)
  values (%L, %L, 4, '{"schema": 1}', %L, %L, 'A hand-made version')$q$,
  pg_temp.fx('org'), pg_temp.mo('m1'), pg_temp.fx('owner'),
  (select s.id from public.month_snapshots s where s.org_id = pg_temp.fx('org') and s.version = 3))),
  'NO_PRIVILEGE', 'the Owner cannot insert a version by hand');
select pg_temp.as_system();
select ok((select bool_and(s.corrects_id = (select p.id from public.month_snapshots p
                                            where p.org_id = s.org_id and p.month = s.month and p.version = s.version - 1))
           from public.month_snapshots s where s.version > 1),
  'every stored correction corrects the version just before it');

-- ===========================================================================================================
-- 7. Another organization
-- ===========================================================================================================
select pg_temp.as_member('b_owner');
select is(pg_temp.err(format('select public.month_correct(%L, %L)', pg_temp.mo('m1'), 'Checking the month again')),
  'INVALID_STATE: Nothing changed.', 'org B''s own month: its own latest version, unchanged by org A''s corrections');
select pg_temp.as_system();
select is((select count(*)::integer from public.month_snapshots where org_id = pg_temp.fx('org_b')), 1, 'org B keeps its one version');
select ok((select s.data::text not like '%' || pg_temp.fx('client') || '%' from public.month_snapshots s
           where s.org_id = pg_temp.fx('org_b')), 'and org A''s client never enters it');

select * from finish();
rollback;
