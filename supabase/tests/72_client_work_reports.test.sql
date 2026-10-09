-- 7B (7.4; kickoff 7 decision 25, amendment C E4; migration client_work_screens): the end-of-day
-- report's Client work section per client Admin (items done, approved, sent back, closed, carried
-- forward and projects completed that IST day: counts and titles, never an amount), its zero check
-- and one-line text, and the weekly digest's client work per Admin (done and completed from the
-- saved reports, overdue now live). Dates are computed from app.today_ist(), so the file holds on
-- any day. Realtime's publication is 46's.
begin;
create extension if not exists pgtap with schema extensions;
select plan(28);

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
delete from public.activity_log;

create temporary table fx (key text primary key, id uuid not null);
insert into fx values
  ('owner',    '00000000-0000-4000-8000-000000007201'),
  ('admin',    '00000000-0000-4000-8000-000000007202'),
  ('admin2',   '00000000-0000-4000-8000-000000007203'),
  ('client_a', '00000000-0000-4000-8000-0000000072a1'),
  ('client_b', '00000000-0000-4000-8000-0000000072b1'),
  ('client_d', '00000000-0000-4000-8000-0000000072d1');
insert into fx select 'org', id from public.organizations limit 1;
grant select, insert on fx to authenticated, anon, service_role;

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
create function pg_temp.item(t text) returns uuid language sql stable security definer as $$
  select i.id from public.project_items i where i.title = $1 order by i.created_at desc, i.id limit 1;
$$;
-- The report for today, and one Admin's entry in its Client work section (null: no Admin).
create function pg_temp.cw() returns jsonb language sql stable security definer as $$
  select app.eod_report_payload(pg_temp.fx('org'), app.today_ist(), now()) -> 'client_work';
$$;
create function pg_temp.admin_of(k text) returns jsonb language sql stable security definer as $$
  select a from jsonb_array_elements(pg_temp.cw() -> 'admins') a
  where (a ->> 'admin_id') is not distinct from (case when $1 is null then null else pg_temp.fx($1)::text end);
$$;
-- A moment between the IST day's start and now, and one between that and now.
create function pg_temp.t(n int) returns timestamptz language sql stable as $$
  select app.ist_day_start(app.today_ist()) + (now() - app.ist_day_start(app.today_ist())) * n / 4;
$$;

insert into auth.users (id, email)
select id, key || '@example.com' from fx where key not in ('org') and key not like 'client_%';
insert into public.members (id, org_id, full_name, email, role, status, joined_at) values
  (pg_temp.fx('owner'),  pg_temp.fx('org'), 'Prishit Owner', 'owner@example.com',  'owner', 'active', now()),
  (pg_temp.fx('admin'),  pg_temp.fx('org'), 'Ravi Admin',    'admin@example.com',  'admin', 'active', now()),
  (pg_temp.fx('admin2'), pg_temp.fx('org'), 'Asha Admin',    'admin2@example.com', 'admin', 'active', now());
insert into public.clients (id, org_id, name, state, admin_id, activated_at) values
  (pg_temp.fx('client_a'), pg_temp.fx('org'), 'Sharma Weddings', 'active', pg_temp.fx('admin'),  now()),
  (pg_temp.fx('client_b'), pg_temp.fx('org'), 'Blue Bakery',     'active', pg_temp.fx('admin2'), now()),
  (pg_temp.fx('client_d'), pg_temp.fx('org'), 'Draft Diner',     'draft',  null,                 null);
-- Every assignment began at the start of today, so the day's events fall inside them.
update public.client_admin_assignments set from_at = app.ist_day_start(app.today_ist());

select pg_temp.as_member('admin');
select public.project_create(pg_temp.fx('client_a'), 'Brand film', 'one_time', null, app.today_ist() + 10,
  '{}'::text[], array['A done', 'A approved', 'A sent back', 'A closed', 'A twice', 'A overdue']);
select pg_temp.as_member('admin2');
select public.project_create(pg_temp.fx('client_b'), 'Menu reel', 'one_time', null, app.today_ist() + 10,
  '{}'::text[], array['B done']);
select pg_temp.as_member('owner');
select public.project_create(pg_temp.fx('client_d'), 'Own film', 'one_time', null, app.today_ist() + 10,
  '{}'::text[], array['D done']);
select pg_temp.as_system();
insert into fx select 'p_a', id from public.projects where name = 'Brand film';
insert into fx select 'p_d', id from public.projects where name = 'Own film';

select pg_temp.as_member('admin');
select public.item_mark_done(pg_temp.item('A done'));
-- 'A approved' and 'A twice' go through the legacy done state (before amendment D3, when an approval
-- or a Not done was a step of its own), which the report still reads.
select public.item_mark_done(pg_temp.item('A approved'));
select pg_temp.as_system();
update public.project_items set state = 'done', approved_at = null, approved_by = null where id = pg_temp.item('A approved');
select pg_temp.as_member('admin');
select public.item_approve(array[pg_temp.item('A approved')]);
-- Amendment D3: done is approved at once; a reopen with a reason is the send-back.
select public.item_mark_done(pg_temp.item('A sent back'));
select public.item_reopen(pg_temp.item('A sent back'), 'The logo is wrong');
select public.item_cancel(pg_temp.item('A closed'), 'The client dropped it');
select public.item_mark_done(pg_temp.item('A twice'));
select pg_temp.as_system();
update public.project_items set state = 'done', approved_at = null, approved_by = null where id = pg_temp.item('A twice');
select pg_temp.as_member('admin');
select public.item_unmark_done(pg_temp.item('A twice'));
select public.item_mark_done(pg_temp.item('A twice'));
select public.item_update(pg_temp.item('A overdue'), jsonb_build_object('planned_date', app.today_ist() - 2));
select pg_temp.as_member('admin2');
select public.item_mark_done(pg_temp.item('B done'));
select pg_temp.as_member('owner');
select public.item_mark_done(pg_temp.item('D done'));
select public.project_complete(pg_temp.fx('p_d'));
select pg_temp.as_system();

-- 1. The section's shape and the Admin of each event ----------------------------------------------------
select is(jsonb_array_length(pg_temp.cw() -> 'admins'), 3, 'one entry per client Admin, and one for the Owner''s own client');
select is((pg_temp.admin_of('admin') ->> 'name'), 'Ravi Admin', 'an Admin is named');
select is((pg_temp.admin_of('admin') #>> '{done,count}')::int, 4,
  'done: every item marked done that day (A done, A approved, A sent back, A twice), each once');
select ok((pg_temp.admin_of('admin') #> '{done,items}') @> '[{"title": "A twice", "project": "Brand film", "client": "Sharma Weddings"}]'::jsonb,
  'a done item names its project and client, once though it was marked done twice');
select is((pg_temp.admin_of('admin') #>> '{approved,count}')::int, 1, 'approved that day');
select is((pg_temp.admin_of('admin') #>> '{sent_back,count}')::int, 1, 'sent back that day');
select is((pg_temp.admin_of('admin') #>> '{sent_back,items,0,reason}'), 'The logo is wrong', 'with the reason');
select is((pg_temp.admin_of('admin') #>> '{closed,count}')::int, 1, 'closed that day');
select is((pg_temp.admin_of('admin') #>> '{closed,items,0,reason}'), 'The client dropped it', 'with the reason');
select is((pg_temp.admin_of('admin') #>> '{carried,count}')::int, 0, 'nothing carried yet');
select is((pg_temp.admin_of('admin2') #>> '{done,count}')::int, 1, 'the other Admin: their client''s item only');
select is((pg_temp.admin_of(null) #>> '{projects_completed,count}')::int, 1,
  'a client with no Admin is the Owner''s own (admin_id null): its project completed that day');
select is((pg_temp.admin_of(null) #>> '{projects_completed,items,0,title}'), 'Own film', 'named, with its client');
select is((pg_temp.cw() #>> '{counts,done}')::int, 6, 'the counts add every Admin''s');
select ok(not (pg_temp.cw()::text ~* '(amount|price|value|billing|revenue)'), 'no amount or money key anywhere');

-- An event before the client changed hands stays with the Admin who ran it then.
update public.client_admin_assignments set to_at = pg_temp.t(2) where client_id = pg_temp.fx('client_b');
insert into public.client_admin_assignments (client_id, admin_id, from_at)
values (pg_temp.fx('client_b'), pg_temp.fx('admin'), pg_temp.t(2));
update public.activity_log set at = pg_temp.t(1)
where entity = 'project_items' and action = 'done' and entity_id = pg_temp.item('B done');
select is((pg_temp.admin_of('admin2') #>> '{done,count}')::int, 1, 'an item done before the change stays with the Admin then');
update public.activity_log set at = pg_temp.t(3)
where entity = 'project_items' and action = 'done' and entity_id = pg_temp.item('B done');
select is((pg_temp.admin_of('admin') #>> '{done,count}')::int, 5, 'and one done after it goes to the new Admin');

-- 2. Carried forward ----------------------------------------------------------------------------------
select pg_temp.as_member('admin');
select public.project_create(pg_temp.fx('client_a'), 'Monthly reels', 'monthly', null, null, '{}'::text[], array['Reel 1']);
select pg_temp.as_system();
insert into fx select 'p_m', id from public.projects where name = 'Monthly reels';
select app.cycle_create((select p from public.projects p where p.id = pg_temp.fx('p_m')),
  (app.period_start('monthly', app.today_ist()) - interval '1 month')::date, 'schedule', null);
select pg_temp.as_member('admin');
select public.cycle_carry_decide(array(
  select i.id from public.project_items i join public.project_cycles c on c.id = i.cycle_id
  where i.project_id = pg_temp.fx('p_m') and c.period_end < app.today_ist()), 'carry_forward');
select pg_temp.as_system();
select is((pg_temp.admin_of('admin') #>> '{carried,count}')::int, 1, 'carried forward that day');
select is((pg_temp.admin_of('admin') #>> '{carried,items,0,project}'), 'Monthly reels', 'named with its project');

-- 3. The zero check and the line ------------------------------------------------------------------------
select ok(not app.eod_report_zero(jsonb_build_object('client_work', jsonb_build_object('counts', jsonb_build_object('done', 1)))),
  'a day with only client work is not a quiet day');
select ok(app.eod_report_zero('{}'::jsonb), 'a report saved before 7.4 (no section) still reads as zero');
select is(app.eod_report_text(jsonb_build_object('client_work', jsonb_build_object('counts',
  jsonb_build_object('done', 3, 'approved', 2, 'sent_back', 1)))),
  'Client items: 3 done, 2 approved, 1 sent back', 'the notification line counts the client items');

-- 4. The weekly digest per Admin (amendment C E4) ---------------------------------------------------------
insert into public.eod_reports (org_id, report_date, data, generated_at)
select pg_temp.fx('org'), app.today_ist() - 1,
  jsonb_build_object('client_work', jsonb_build_object('admins', jsonb_build_array(
    jsonb_build_object('admin_id', pg_temp.fx('admin'), 'done', jsonb_build_object('count', 4),
      'projects_completed', jsonb_build_object('count', 1)),
    jsonb_build_object('admin_id', null, 'done', jsonb_build_object('count', 2),
      'projects_completed', jsonb_build_object('count', 0))))), now();
create function pg_temp.dg(k text) returns jsonb language sql stable security definer as $$
  select a from jsonb_array_elements(app.digest_weekly_payload(pg_temp.fx('org'), now()) -> 'client_work') a
  where (a ->> 'admin_id') is not distinct from (case when $1 is null then null else pg_temp.fx($1)::text end);
$$;
select is((pg_temp.dg('admin') ->> 'done')::int, 4, 'items done in the window, from the saved reports');
select is((pg_temp.dg('admin') ->> 'projects_completed')::int, 1, 'projects completed, from the saved reports');
select is((pg_temp.dg('admin') ->> 'overdue')::int, 1, 'items overdue now, live, under the client''s current Admin');
select is((pg_temp.dg(null) ->> 'done')::int, 2, 'the Owner''s own clients are one entry (admin_id null)');
select ok(not app.digest_weekly_zero(jsonb_build_object('client_work', jsonb_build_array(jsonb_build_object('done', 1)))),
  'a week with only client work is not skipped');
select is(pg_temp.dg('admin2'), null, 'an Admin with nothing to count is not listed');

select * from finish();
rollback;
