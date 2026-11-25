-- v3.5 "Month close", U3 (migration v35_month_correct; WORKFLOWS §7.1, §7.2 and §7.4): month_close_read(month),
-- the close screen's and a closed month's one read, and "Changed since close".
--   0. the function: security definer (the live rebuild uses the internal builder), search_path, grants;
--   1. who reads: the Owner only; Admin, Crew, a freelancer, a deactivated member and no sign-in get one
--      refusal whether the month is closed or not; anon has no privilege; another org's Owner reads its own;
--   2. a month not closed: before the first priced month ("Nothing to close.", no figures), the current month
--      ("hasn't ended yet." with its waiting list), an ended month (can be closed, the waiting list's kinds,
--      counts only, the expense-claims date);
--   3. a closed month: the latest version, who closed it, the stored document, the versions, nothing changed;
--   4. names are ignored: a rename changes nothing;
--   5. a deliverable reopened after the close: the cycle and the deliverable with before/after and who did it,
--      the totals that moved; an advance recorded after the close: an added line;
--   6. after a correction: version 2 is the latest, both versions listed, nothing changed against it;
--   7. the IST month boundary and the claims date at explicit instants.
-- Every name here is neutral.
begin;
create extension if not exists pgtap with schema extensions;
select plan(47);

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
  ('owner',    '00000000-0000-4000-8000-000000163901'),
  ('admin',    '00000000-0000-4000-8000-000000163902'),
  ('staff',    '00000000-0000-4000-8000-000000163903'),
  ('free',     '00000000-0000-4000-8000-000000163904'),
  ('gone',     '00000000-0000-4000-8000-000000163905'),
  ('org_b',    '00000000-0000-4000-8000-000000163910'),
  ('b_owner',  '00000000-0000-4000-8000-000000163911'),
  ('b_admin',  '00000000-0000-4000-8000-000000163912'),
  ('client',   '00000000-0000-4000-8000-0000001639c1'),
  ('b_client', '00000000-0000-4000-8000-0000001639c2');
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


create function pg_temp.rd(k text) returns jsonb language sql volatile as $$
  select public.month_close_read(pg_temp.mo(k));
$$;

-- People: org A (the seed's organization) and org B.
insert into public.organizations (id, name) values (pg_temp.fx('org_b'), 'Other org 163');
insert into auth.users (id, email)
select id, key || '-163@example.com' from fx where key in ('owner', 'admin', 'staff', 'free', 'gone', 'b_owner', 'b_admin');
insert into public.members (id, org_id, full_name, email, role, status, engagement, joined_at, deactivated_at) values
  (pg_temp.fx('owner'),   pg_temp.fx('org'),   'Test Owner',  'owner-163@example.com',   'owner', 'active',      'permanent', now() - interval '120 days', null),
  (pg_temp.fx('admin'),   pg_temp.fx('org'),   'Test Admin',  'admin-163@example.com',   'admin', 'active',      'permanent', now(), null),
  (pg_temp.fx('staff'),   pg_temp.fx('org'),   'Test Crew',   'staff-163@example.com',   'staff', 'active',      'permanent', now() - interval '120 days', null),
  (pg_temp.fx('free'),    pg_temp.fx('org'),   'Test Free',   null,                      'staff', 'active',      'freelance', now(), null),
  (pg_temp.fx('gone'),    pg_temp.fx('org'),   'Test Gone',   'gone-163@example.com',    'admin', 'deactivated', 'permanent', now() - interval '9 days', now()),
  (pg_temp.fx('b_owner'), pg_temp.fx('org_b'), 'Other Owner', 'b_owner-163@example.com', 'owner', 'active',      'permanent', now(), null),
  (pg_temp.fx('b_admin'), pg_temp.fx('org_b'), 'Other Admin', 'b_admin-163@example.com', 'admin', 'active',      'permanent', now(), null);
select pg_temp.as_owner_inside('owner');
insert into public.clients (id, org_id, name, state, admin_id, activated_at) values
  (pg_temp.fx('client'),   pg_temp.fx('org'),   'Client 163',       'active', pg_temp.fx('admin'),   now());
select pg_temp.as_owner_inside('b_owner');
insert into public.clients (id, org_id, name, state, admin_id, activated_at) values
  (pg_temp.fx('b_client'), pg_temp.fx('org_b'), 'Other client 163', 'active', pg_temp.fx('b_admin'), now());

-- Org A's work and money:
--   "Monthly 163": last month's cycle priced alone at 6,000 (A done, B open and undecided); this month's at 9,000.
--   "Unpriced 163": a retainer never priced (last month's and this month's cycles read "No amount set").
--   "Film 163": a one-time project at 20,000 delivered in a later month.
--   "Short 163": a one-time project delivered today, its one deliverable done, no amount (Ready to complete).
-- The month before last has a cycle with no amount: it is before the first priced month.
select pg_temp.as_member('admin');
insert into fx values ('p', public.project_create(pg_temp.fx('client'), 'Monthly 163', 'monthly', null, null,
  array['Stage 1'], array['A', 'B']));
insert into fx values ('u', public.project_create(pg_temp.fx('client'), 'Unpriced 163', 'monthly', null, null,
  array['Stage 1'], array['U']));
insert into fx values ('ot', public.project_create(pg_temp.fx('client'), 'Film 163', 'one_time', null,
  app.month_start(pg_temp.mo('m0') + 40) + 4, array['Stage 1'], array['Cut']));
insert into fx values ('short', public.project_create(pg_temp.fx('client'), 'Short 163', 'one_time', null,
  app.today_ist(), array['Stage 1'], array['Edit']));
select pg_temp.as_member('owner');
select public.billing_set_project(pg_temp.fx('p'), 9000, true, null);
select public.billing_set_project(pg_temp.fx('ot'), 20000, true, null);
select pg_temp.as_system();
insert into fx select 'past', (app.cycle_create((select p from public.projects p where p.id = pg_temp.fx('p')),
  pg_temp.mo('m1'), 'schedule', null, true)).id;
insert into fx select 'older', (app.cycle_create((select p from public.projects p where p.id = pg_temp.fx('p')),
  pg_temp.mo('m2'), 'schedule', null, true)).id;
insert into fx select 'u_past', (app.cycle_create((select p from public.projects p where p.id = pg_temp.fx('u')),
  pg_temp.mo('m1'), 'schedule', null, true)).id;
insert into fx select 'item_a', i.id from public.project_items i where i.cycle_id = pg_temp.fx('past') and i.title = 'A';
insert into fx select 'edit', i.id from public.project_items i where i.project_id = pg_temp.fx('short');
select pg_temp.as_member('owner');
select public.billing_set_cycle_amount(pg_temp.fx('past'), 6000);
select pg_temp.as_member('admin');
select public.item_mark_done(pg_temp.fx('item_a'));
select public.item_mark_done(pg_temp.fx('edit'));

-- Last month's people side, each waiting for the Owner: a day to review, a leave request, a day left early and
-- never answered, an overtime note, an expense claim. One of each already decided does not count.
select pg_temp.as_owner_inside('owner');
insert into public.attendance_days (member_id, work_date, state, submitted_choice, submitted_at) values
  (pg_temp.fx('staff'), pg_temp.mo('m1') + 2, 'pending_review', 'present', now()),
  (pg_temp.fx('staff'), pg_temp.mo('m1') + 3, 'awaiting_choice', null, null);
insert into public.attendance_days (member_id, work_date, state, submitted_choice, submitted_at, final_status, decided_by, decided_at) values
  (pg_temp.fx('staff'), pg_temp.mo('m1') + 4, 'approved', 'present', now(), 'present', pg_temp.fx('owner'), now());
insert into public.early_leave_requests (org_id, member_id, day_id, requested_at, reason, end_at, state, left_at) values
  (pg_temp.fx('org'), pg_temp.fx('staff'),
   (select id from public.attendance_days where member_id = pg_temp.fx('staff') and work_date = pg_temp.mo('m1') + 3),
   now(), 'A doctor''s visit', now(), 'left_unanswered', now());
insert into public.leave_requests (member_id, type, start_date, end_date, reason, state, source) values
  (pg_temp.fx('staff'), 'leave', pg_temp.mo('m1') - 1, pg_temp.mo('m1') + 1, 'Family', 'submitted', 'form');
insert into public.extra_work_notes (member_id, work_date, kind, duration_minutes, note, state) values
  (pg_temp.fx('staff'), pg_temp.mo('m1') + 5, 'overtime', 60, 'Late edit', 'submitted');
insert into public.expense_claims (member_id, expense_date, amount, category_id, note, state, decided_by, decided_at) values
  (pg_temp.fx('staff'), pg_temp.mo('m1') + 6, 450, (select id from public.list_items where list_key = 'expense_category' limit 1), 'Taxi', 'submitted', null, null),
  (pg_temp.fx('staff'), pg_temp.mo('m1') + 6, 700, (select id from public.list_items where list_key = 'expense_category' limit 1), 'Lunch', 'approved', pg_temp.fx('owner'), now());

-- Org B: a retainer, nothing priced.
select pg_temp.as_member('b_admin');
insert into fx values ('bp', public.project_create(pg_temp.fx('b_client'), 'Other monthly 163', 'monthly', null, null,
  array['Stage 1'], array['X']));

-- ===========================================================================================================
-- 0. The function
-- ===========================================================================================================
select has_function('public', 'month_close_read', array['date'], 'month_close_read(month date) exists');
select ok((select p.prosecdef and p.proconfig @> array['search_path=""'] and p.prorettype = 'jsonb'::regtype
           from pg_proc p where p.oid = 'public.month_close_read(date)'::regprocedure),
  'month_close_read: security definer (its live rebuild uses the internal builder), empty search_path, returns jsonb');
select ok(has_function_privilege('authenticated', 'public.month_close_read(date)', 'execute')
          and not has_function_privilege('anon', 'public.month_close_read(date)', 'execute')
          and not has_function_privilege('authenticated', 'app.month_snapshot_build(uuid, date)', 'execute'),
  'authenticated may call it, anon may not, and the builder stays out of authenticated''s reach');

-- ===========================================================================================================
-- 1. Who reads (a month not closed)
-- ===========================================================================================================
select pg_temp.as_member('admin');
select is(pg_temp.err(format('select public.month_close_read(%L)', pg_temp.mo('m1'))),
  'FORBIDDEN: Only the Owner sees a month''s close.', 'the client''s Admin is refused');
select pg_temp.as_member('staff');
select is(pg_temp.err(format('select public.month_close_read(%L)', pg_temp.mo('m1'))),
  'FORBIDDEN: Only the Owner sees a month''s close.', 'Crew are refused');
select pg_temp.as_member('free');
select is(pg_temp.err(format('select public.month_close_read(%L)', pg_temp.mo('m1'))),
  'FORBIDDEN: Only the Owner sees a month''s close.', 'a freelancer is refused');
select pg_temp.as_member('gone');
select is(pg_temp.err(format('select public.month_close_read(%L)', pg_temp.mo('m1'))),
  'FORBIDDEN: Only the Owner sees a month''s close.', 'a deactivated member is refused');
select pg_temp.as_nobody();
select is(pg_temp.err(format('select public.month_close_read(%L)', pg_temp.mo('m1'))),
  'FORBIDDEN: Only the Owner sees a month''s close.', 'no sign-in is refused');
select pg_temp.as_anon();
select is(pg_temp.err(format('select public.month_close_read(%L)', pg_temp.mo('m1'))), 'NO_PRIVILEGE', 'anon has no privilege');

-- ===========================================================================================================
-- 2. A month not closed
-- ===========================================================================================================
select pg_temp.as_member('owner');
select is(pg_temp.err('select public.month_close_read(null)'), 'VALIDATION: Pick a month.', 'no month is refused');
select is(pg_temp.keys(pg_temp.rd('m1')),
  array['can_close', 'cannot_close', 'changed_since_close', 'closed', 'latest', 'month', 'month_name', 'versions', 'waiting'],
  'the read''s keys');
select is(pg_temp.rd('m2'),
  jsonb_build_object('month', pg_temp.mo('m2'), 'month_name', pg_temp.name('m2'), 'closed', false, 'can_close', false,
    'cannot_close', jsonb_build_object('reason', 'nothing_to_close', 'message', 'Nothing to close.'),
    'waiting', null, 'latest', null, 'versions', '[]'::jsonb, 'changed_since_close', null),
  'before the first priced month: "Nothing to close." and no figures');
select is(pg_temp.rd('m0') -> 'cannot_close',
  jsonb_build_object('reason', 'not_ended', 'message', pg_temp.name('m0') || ' hasn''t ended yet.'),
  'the current month: it hasn''t ended yet');
select ok((select (w ->> 'ready_to_complete')::int = 1 and (w ->> 'open_work')::int = 3 and (w ->> 'carry_decisions')::int = 0
           from (select pg_temp.rd('m0') -> 'waiting' as w) x),
  'its waiting list: Short is ready to complete, this month''s three retainer deliverables are open work, nothing to carry yet');
select is((pg_temp.rd('m0') #>> '{waiting,no_amount}')::int, 2,
  'No amount: this month''s unpriced retainer cycle and the unpriced one-time project');
select ok((pg_temp.rd('m1') ->> 'can_close')::boolean and pg_temp.rd('m1') -> 'cannot_close' = 'null'::jsonb
          and not (pg_temp.rd('m1') ->> 'closed')::boolean,
  'last month can be closed, and is not closed');
select is(pg_temp.rd('m1') -> 'waiting',
  jsonb_build_object('attendance', 1, 'leave', 1, 'leaving_early', 1, 'extra_work', 1, 'expense_claims', 1,
    'open_work', 0, 'carry_decisions', 2, 'no_amount', 1, 'ready_to_complete', 0, 'total', 8,
    'claims_until', pg_temp.mo('m0') + 4, 'claims_open', app.today_ist() <= pg_temp.mo('m0') + 4),
  'last month''s waiting list: one of each people kind, B and U to carry or close, Unpriced''s cycle has no amount');
select ok(pg_temp.rd('m1')::text not like '%450%' and pg_temp.rd('m1')::text not like '%6000%',
  'no amount anywhere in a month not closed');

-- ===========================================================================================================
-- 3. A closed month
-- ===========================================================================================================
select is(public.month_close(pg_temp.mo('m1')), 1, 'the Owner closes last month');
select pg_temp.as_system();
create temporary table kept (key text primary key, data jsonb not null, id uuid not null, closed_at timestamptz not null);
insert into kept select 'v1', s.data, s.id, s.closed_at from public.month_snapshots s where s.org_id = pg_temp.fx('org') and s.version = 1;
grant select on kept to authenticated, anon, service_role;
select pg_temp.as_member('owner');
select ok((pg_temp.rd('m1') ->> 'closed')::boolean and not (pg_temp.rd('m1') ->> 'can_close')::boolean
          and pg_temp.rd('m1') -> 'cannot_close' = jsonb_build_object('reason', 'closed', 'message', pg_temp.name('m1') || ' is already closed.')
          and pg_temp.rd('m1') -> 'waiting' = 'null'::jsonb,
  'closed: it cannot be closed again, and no waiting list');
select is(pg_temp.rd('m1') -> 'latest',
  jsonb_build_object('id', (select id from kept), 'version', 1, 'closed_at', (select closed_at from kept),
    'closed_by_id', pg_temp.fx('owner'), 'closed_by_name', 'Test Owner', 'data', (select data from kept)),
  'the latest version: v1, when, who, and the stored document');
select is(pg_temp.rd('m1') -> 'versions',
  jsonb_build_array(jsonb_build_object('id', (select id from kept), 'version', 1, 'closed_at', (select closed_at from kept),
    'closed_by_id', pg_temp.fx('owner'), 'closed_by_name', 'Test Owner', 'corrects_id', null, 'note', null)),
  'the versions: v1 only, no note');
select is(pg_temp.rd('m1') -> 'changed_since_close', '{"lines": [], "totals": []}'::jsonb, 'nothing changed since the close');
select pg_temp.as_member('admin');
select is(pg_temp.err(format('select public.month_close_read(%L)', pg_temp.mo('m1'))),
  'FORBIDDEN: Only the Owner sees a month''s close.', 'the Admin''s refusal is the same once it is closed');
select pg_temp.as_member('staff');
select is(pg_temp.err(format('select public.month_close_read(%L)', pg_temp.mo('m1'))),
  'FORBIDDEN: Only the Owner sees a month''s close.', 'and Crew''s');
select pg_temp.as_member('b_owner');
select is(pg_temp.rd('m1') -> 'cannot_close', jsonb_build_object('reason', 'nothing_to_close', 'message', 'Nothing to close.'),
  'another organization''s Owner reads its own month: not closed, nothing priced');
select ok(not (pg_temp.rd('m1') ->> 'closed')::boolean and pg_temp.rd('m1') -> 'latest' = 'null'::jsonb,
  'and never org A''s snapshot');

-- ===========================================================================================================
-- 4. Names are ignored
-- ===========================================================================================================
select pg_temp.as_owner_inside('owner');
update public.clients set name = 'Client 163 renamed' where id = pg_temp.fx('client');
update public.projects set name = 'Monthly 163 renamed' where id = pg_temp.fx('p');
update public.project_items set title = 'A renamed' where id = pg_temp.fx('item_a');
select pg_temp.as_member('owner');
select is(pg_temp.rd('m1') -> 'changed_since_close', '{"lines": [], "totals": []}'::jsonb,
  'a renamed client, project and deliverable change nothing');

-- ===========================================================================================================
-- 5. Changes after the close
-- ===========================================================================================================
select pg_temp.as_member('admin');
select public.item_reopen(pg_temp.fx('item_a'), 'Needs another cut');
select pg_temp.as_member('owner');
select is(jsonb_array_length(pg_temp.rd('m1') #> '{changed_since_close,lines}'), 2, 'two lines moved: the cycle and its deliverable');
select is(pg_temp.rd('m1') #> '{changed_since_close,lines,0}',
  jsonb_build_object('kind', 'changed', 'line', 'cycle', 'id', pg_temp.fx('past'), 'cycle_id', null,
    'what', 'Monthly 163 renamed · Client 163 renamed · ' || pg_temp.name('m1'),
    'before', jsonb_build_object('amount', 6000, 'potential', 6000, 'achieved', 3000, 'remaining', 3000, 'closed_not_achieved', 0),
    'after',  jsonb_build_object('amount', 6000, 'potential', 6000, 'achieved', 0, 'remaining', 6000, 'closed_not_achieved', 0),
    'cause', null),
  'the cycle: Achieved 3,000 → 0, Remaining 3,000 → 6,000, in today''s names');
select ok((select l ->> 'kind' = 'changed' and l ->> 'line' = 'item' and l ->> 'id' = pg_temp.fx('item_a')::text
                  and l ->> 'cycle_id' = pg_temp.fx('past')::text and l ->> 'what' = 'A renamed · Monthly 163 renamed'
                  and l -> 'before' = jsonb_build_object('value', 3000, 'achieved', true, 'in_potential', true, 'closed_not_achieved', false)
                  and l -> 'after' = jsonb_build_object('value', 3000, 'achieved', false, 'in_potential', true, 'closed_not_achieved', false)
           from (select pg_temp.rd('m1') #> '{changed_since_close,lines,1}' as l) x),
  'the deliverable: 3,000, achieved before, not now');
select ok((select c ->> 'action' = 'reopened' and c ->> 'by_id' = pg_temp.fx('admin')::text and c ->> 'by_name' = 'Test Admin'
                  and c ->> 'at' is not null
           from (select pg_temp.rd('m1') #> '{changed_since_close,lines,1,cause}' as c) x),
  'and why: reopened by the Admin (the history entry)');
select is(pg_temp.rd('m1') #> '{changed_since_close,totals}',
  jsonb_build_array(jsonb_build_object('key', 'achieved', 'before', 3000, 'after', 0),
                    jsonb_build_object('key', 'remaining', 'before', 3000, 'after', 6000)),
  'the totals that moved: Achieved and Remaining');
select ok((pg_temp.rd('m1') #>> '{latest,data,revenue,totals,achieved}')::numeric = 3000,
  'the snapshot itself still says 3,000');
select public.advance_record(pg_temp.fx('ot'), 5000, pg_temp.mo('m1') + 10, 'Late entry');
select is(jsonb_array_length(pg_temp.rd('m1') #> '{changed_since_close,lines}'), 3, 'an advance recorded in last month after the close');
select ok((select l ->> 'kind' = 'added' and l ->> 'line' = 'advance_received' and l -> 'before' = 'null'::jsonb
                  and l -> 'after' = jsonb_build_object('amount', 5000) and l ->> 'what' = 'Advance received · Film 163'
           from (select pg_temp.rd('m1') #> '{changed_since_close,lines,2}' as l) x),
  'is an added line, with its amount');
select is(pg_temp.rd('m1') #> '{changed_since_close,totals,2}',
  jsonb_build_object('key', 'advances_received', 'before', 0, 'after', 5000), 'and Advances received moved');

-- ===========================================================================================================
-- 6. After a correction
-- ===========================================================================================================
select is(public.month_correct(pg_temp.mo('m1'), 'A reopened, late advance'), 2, 'the Owner corrects: version 2');
select is((pg_temp.rd('m1') #>> '{latest,version}')::int, 2, 'the latest is version 2');
select ok((select jsonb_array_length(v) = 2 and v #>> '{1,note}' = 'A reopened, late advance'
                  and v #>> '{1,corrects_id}' = (select id::text from kept) and v #>> '{0,note}' is null
                  and v #>> '{1,closed_by_name}' = 'Test Owner'
           from (select pg_temp.rd('m1') -> 'versions' as v) x),
  'both versions listed, oldest first; v2 with its note, correcting v1');
select is(pg_temp.rd('m1') -> 'changed_since_close', '{"lines": [], "totals": []}'::jsonb,
  'compared with the latest version, nothing has changed');
select is((pg_temp.rd('m1') #>> '{latest,data,revenue,totals,achieved}')::numeric, 0::numeric, 'and it reads today''s figures');
select pg_temp.as_member('admin');
select public.item_mark_done(pg_temp.fx('item_a'));
select pg_temp.as_member('owner');
select ok((select c ->> 'action' = 'done' and c ->> 'by_name' = 'Test Admin'
           from (select pg_temp.rd('m1') #> '{changed_since_close,lines,1,cause}' as c) x),
  'done again after v2: the cause is the latest change, done by the Admin');

-- ===========================================================================================================
-- 7. The IST boundary and the claims date at explicit instants (app.test_now; this month = m0)
-- ===========================================================================================================
select set_config('app.test_now', (((app.month_start(pg_temp.mo('m0') + 40)::text || ' 00:00:00+05:30')::timestamptz) - interval '1 second')::text, true);
select is(pg_temp.rd('m0') #>> '{cannot_close,reason}', 'not_ended', 'at 23:59:59 IST on its last day, this month has not ended');
select set_config('app.test_now', ((app.month_start(pg_temp.mo('m0') + 40)::text || ' 00:00:30+05:30')::timestamptz)::text, true);
select ok((pg_temp.rd('m0') ->> 'can_close')::boolean and pg_temp.rd('m0') -> 'cannot_close' = 'null'::jsonb,
  'half a minute into the 1st IST, it can be closed');
select is((pg_temp.rd('m0') #>> '{waiting,claims_open}')::boolean, true, 'and claims for it can still be added (until the 5th)');
select set_config('app.test_now', (((app.month_start(pg_temp.mo('m0') + 40) + 5)::text || ' 00:00:30+05:30')::timestamptz)::text, true);
select ok((pg_temp.rd('m0') #>> '{waiting,claims_until}') = (app.month_start(pg_temp.mo('m0') + 40) + 4)::text
          and not (pg_temp.rd('m0') #>> '{waiting,claims_open}')::boolean,
  'on the 6th, the claims date (the 5th) has passed');
select set_config('app.test_now', '', true);

select * from finish();
rollback;
