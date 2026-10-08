-- Kickoff 7 amendment C, escalations E1-E5 (owner 2026-10-08): app.client_work_alerts() every 5
-- minutes. E1 an overdue client item tells its client's Admin first (one row per Admin per run), then,
-- item_overdue_escalate_hours after that, the Owner (one escalation per Admin, naming them); once per
-- item and planned date, re-armed when the date moves; done items and clients with no Admin never.
-- E2 an ended cycle still undecided cycle_decide_escalate_days after its end and its prompt -> the
-- Owner, once per cycle. E3 a one-time project open after its delivery date -> the Owner at 08:00 IST
-- the morning after, once per date, re-armed when it moves. E5 the two thresholds: defaults, checks,
-- the Owner only. The schedule; the record table has no API access; one Admin's failure costs the
-- others nothing. Times are computed from now() and app.today_ist().
begin;
create extension if not exists pgtap with schema extensions;
select plan(59);

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
  ('owner',      '00000000-0000-4000-8000-000000007101'),
  ('admin',      '00000000-0000-4000-8000-000000007102'),
  ('admin2',     '00000000-0000-4000-8000-000000007103'),
  ('staff',      '00000000-0000-4000-8000-000000007104'),
  ('gone_admin', '00000000-0000-4000-8000-000000007105'),
  ('client_a',   '00000000-0000-4000-8000-0000000071a1'),
  ('client_b',   '00000000-0000-4000-8000-0000000071b1'),
  ('client_p',   '00000000-0000-4000-8000-0000000071c1'),
  ('client_x',   '00000000-0000-4000-8000-0000000071d1'),
  ('client_d',   '00000000-0000-4000-8000-0000000071e1');
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

create function pg_temp.as_anon() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  perform set_config('role', 'anon', true);
end;
$$;

create function pg_temp.as_system() returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', '', true);
end;
$$;

-- Reads as the system (RLS is 67's), whatever role the test is in.
create function pg_temp.n(k text, kind text default null) returns bigint language sql stable security definer as $$
  select count(*) from public.notifications x
  where x.recipient_id = pg_temp.fx(k) and ($2 is null or x.kind = $2);
$$;
create function pg_temp.last(k text, kind text) returns public.notifications language sql stable security definer as $$
  select x.* from public.notifications x
  where x.recipient_id = pg_temp.fx(k) and x.kind = $2 order by x.created_at desc, x.id desc limit 1;
$$;
create function pg_temp.total() returns bigint language sql stable security definer as $$
  select count(*) from public.notifications
$$;
-- The item of that title in the project's current (or one-time) cycle: the earliest cycle not ended.
create function pg_temp.item(p text, t text) returns public.project_items language sql stable security definer as $$
  select i.* from public.project_items i join public.project_cycles c on c.id = i.cycle_id
  where i.project_id = pg_temp.fx($1) and i.title = $2
    and (c.period_end is null or c.period_end >= app.today_ist())
  order by c.period_start nulls first, i.id limit 1;
$$;
create function pg_temp.project(p text) returns public.projects language sql stable security definer as $$
  select x.* from public.projects x where x.id = pg_temp.fx($1);
$$;
create function pg_temp.stage(p text, s text) returns uuid language sql stable security definer as $$
  select x.id from public.project_stages x where x.project_id = pg_temp.fx($1) and x.name = $2;
$$;
create function pg_temp.cycle_of(p text, d date) returns public.project_cycles language sql stable security definer as $$
  select c.* from public.project_cycles c where c.project_id = pg_temp.fx($1) and c.period_start is not distinct from $2;
$$;
-- The result of one id in a bulk call's answer.
create function pg_temp.res(r jsonb, id uuid) returns jsonb language sql immutable as $$
  select x from jsonb_array_elements(r) x where x ->> 'id' = id::text;
$$;
-- 'ok', or the code a P0001 failure carries.
create function pg_temp.code(sql text) returns text language plpgsql as $$
begin
  execute sql;
  return 'ok';
exception when sqlstate 'P0001' then
  return sqlerrm;
end;
$$;
create function pg_temp.clear() returns void language plpgsql security definer as $$
begin
  delete from public.notification_deliveries;
  delete from public.notifications;
end;
$$;

delete from public.client_work_alerts;
update public.org_settings set item_overdue_escalate_hours = 24, cycle_decide_escalate_days = 2;

insert into auth.users (id, email)
select id, key || '@example.com' from fx where key not in ('org') and key not like 'client_%';
insert into public.members (id, org_id, full_name, email, role, status, joined_at, deactivated_at) values
  (pg_temp.fx('owner'),      pg_temp.fx('org'), 'Prishit Owner', 'owner@example.com',      'owner', 'active',      now(), null),
  (pg_temp.fx('admin'),      pg_temp.fx('org'), 'Ravi Admin',    'admin@example.com',      'admin', 'active',      now(), null),
  (pg_temp.fx('admin2'),     pg_temp.fx('org'), 'Other Admin',   'admin2@example.com',     'admin', 'active',      now(), null),
  (pg_temp.fx('staff'),      pg_temp.fx('org'), 'Test Crew',     'staff@example.com',      'staff', 'active',      now(), null),
  (pg_temp.fx('gone_admin'), pg_temp.fx('org'), 'Gone Admin',    'gone_admin@example.com', 'admin', 'deactivated', now(), now());
insert into public.clients (id, org_id, name, state, admin_id, activated_at) values
  (pg_temp.fx('client_a'), pg_temp.fx('org'), 'Sharma Weddings', 'active', pg_temp.fx('admin'),  now()),
  (pg_temp.fx('client_b'), pg_temp.fx('org'), 'Blue Bakery',     'active', pg_temp.fx('admin2'), now()),
  (pg_temp.fx('client_d'), pg_temp.fx('org'), 'Draft Diner',     'draft',  null,                 null);
delete from public.activity_log;

create temporary table t as
select now() as t1,
       (((app.today_ist() + 1)::timestamp + time '08:00') at time zone 'Asia/Kolkata') as morning,
       (app.period_start('monthly', app.today_ist()) - interval '1 month')::date as last_month;
grant select on t to authenticated;
-- An overdue line as the notices write it.
create function pg_temp.line(i text, p text, c text, d date) returns text language sql immutable as $$
  select format('%s (%s · %s, %s)', i, p, c, app.notify_date(d));
$$;

select pg_temp.as_member('owner');
insert into fx values
  ('pm', public.project_create(pg_temp.fx('client_a'), 'Monthly reels', 'monthly', null, null, '{}', array['Reel 1'])),
  ('pb', public.project_create(pg_temp.fx('client_b'), 'Bakery menu', 'monthly', null, null, '{}', array['Menu'])),
  ('pd', public.project_create(pg_temp.fx('client_d'), 'Diner film', 'one_time', null, app.today_ist() + 30)),
  ('po', public.project_create(pg_temp.fx('client_a'), 'Launch film', 'one_time', null, app.today_ist() + 60)),
  ('pdone', public.project_create(pg_temp.fx('client_a'), 'Finished film', 'one_time', null, app.today_ist()));
select public.project_complete(pg_temp.fx('pdone'));
select pg_temp.as_member('admin');
insert into fx values
  ('late1', public.item_add((pg_temp.cycle_of('pm', app.period_start('monthly', app.today_ist()))).id, 'Late 1', app.today_ist() - 1)),
  ('late2', public.item_add((pg_temp.cycle_of('pm', app.period_start('monthly', app.today_ist()))).id, 'Late 2', app.today_ist() - 3)),
  ('future', public.item_add((pg_temp.cycle_of('pm', app.period_start('monthly', app.today_ist()))).id, 'Future', app.today_ist() + 3)),
  ('donelate', public.item_add((pg_temp.cycle_of('pm', app.period_start('monthly', app.today_ist()))).id, 'Done late', app.today_ist() - 2));
select public.item_mark_done(pg_temp.fx('donelate'));
select pg_temp.as_member('admin2');
insert into fx values
  ('blate', public.item_add((pg_temp.cycle_of('pb', app.period_start('monthly', app.today_ist()))).id, 'B late', app.today_ist() - 1));
select pg_temp.as_member('owner');
insert into fx values
  ('dlate', public.item_add((pg_temp.cycle_of('pd', null)).id, 'D late', app.today_ist() - 1));
select pg_temp.as_system();
select pg_temp.clear();

-- The schedule and the kinds ----------------------------------------------------------------------------
select is((select schedule || ' ' || command from cron.job where jobname = 'client_work_alerts'),
  '*/5 * * * * select app.client_work_alerts()', 'client_work_alerts runs every 5 minutes (as reminders_tick)');
select ok(not has_function_privilege('authenticated', 'app.client_work_alerts(timestamptz)', 'execute')
          and has_function_privilege('service_role', 'app.client_work_alerts(timestamptz)', 'execute'),
  'the job is service_role only');
select is((select string_agg(kind || '=' || actionable || '/' || always_email || '/' || in_app, ', ' order by kind)
           from public.notification_kinds
           where kind in ('reminder_item_overdue', 'escalation_item_overdue', 'escalation_cycle_undecided', 'escalation_delivery_missed')),
  'escalation_cycle_undecided=false/true/true, escalation_delivery_missed=false/true/true, '
  || 'escalation_item_overdue=false/true/true, reminder_item_overdue=false/true/true',
  'the Admin''s overdue notice and the three escalations are always emailed, as a task''s overdue reminder and escalations');

-- E5. The thresholds -------------------------------------------------------------------------------------
select is((select item_overdue_escalate_hours || '/' || cycle_decide_escalate_days from public.org_settings where org_id = pg_temp.fx('org')),
  '24/2', 'the defaults: 24 hours, 2 days');
select pg_temp.as_member('owner');
select throws_ok($$ update public.org_settings set item_overdue_escalate_hours = 0 $$, '23514', null, 'hours are 1..168 (not 0)');
select throws_ok($$ update public.org_settings set item_overdue_escalate_hours = 169 $$, '23514', null, 'nor 169');
select throws_ok($$ update public.org_settings set cycle_decide_escalate_days = 0 $$, '23514', null, 'days are 1..30 (not 0)');
select throws_ok($$ update public.org_settings set cycle_decide_escalate_days = 31 $$, '23514', null, 'nor 31');
select lives_ok($$ update public.org_settings set item_overdue_escalate_hours = 36, cycle_decide_escalate_days = 3 $$,
  'the Owner sets both (settings.manage)');
select pg_temp.as_member('admin');
update public.org_settings set item_overdue_escalate_hours = 1, cycle_decide_escalate_days = 1;
select pg_temp.as_member('staff');
update public.org_settings set item_overdue_escalate_hours = 1, cycle_decide_escalate_days = 1;
select pg_temp.as_member('gone_admin');
update public.org_settings set item_overdue_escalate_hours = 1, cycle_decide_escalate_days = 1;
select pg_temp.as_system();
select is((select item_overdue_escalate_hours || '/' || cycle_decide_escalate_days from public.org_settings where org_id = pg_temp.fx('org')),
  '36/3', 'an Admin, Crew and a deactivated member change nothing (the UPDATE policy is settings.manage)');
select pg_temp.as_anon();
select throws_ok($$ update public.org_settings set item_overdue_escalate_hours = 1 $$, '42501', null, 'anon is refused');
select pg_temp.as_system();
update public.org_settings set item_overdue_escalate_hours = 24, cycle_decide_escalate_days = 2;

-- The record table: no API access -----------------------------------------------------------------------------
select pg_temp.as_member('owner');
select throws_ok($$ select count(*) from public.client_work_alerts $$, '42501', null, 'the Owner has no API read of the record');
select pg_temp.as_member('admin');
select throws_ok($$ select count(*) from public.client_work_alerts $$, '42501', null, 'nor an Admin');
select pg_temp.as_member('staff');
select throws_ok($$ insert into public.client_work_alerts (org_id, kind, entity_id, armed_for, sent_at)
                    values (pg_temp.fx('org'), 'item_overdue', pg_temp.fx('late1'), app.today_ist(), now()) $$, '42501', null,
  'nor Crew (no write either)');
select pg_temp.as_system();
select ok((select relrowsecurity from pg_class where oid = 'public.client_work_alerts'::regclass), 'RLS is on');

-- E1. The Admin first ---------------------------------------------------------------------------------------
select is(app.client_work_alerts((select t1 from t)), 2, 'the first run: one overdue notice per Admin with overdue items');
select is(pg_temp.n('admin', 'reminder_item_overdue'), 1::bigint, 'one row for two overdue items (never one per item)');
select is((pg_temp.last('admin', 'reminder_item_overdue')).title, '2 client items overdue', 'naming the count');
select is((pg_temp.last('admin', 'reminder_item_overdue')).body,
  pg_temp.line('Late 2', 'Monthly reels', 'Sharma Weddings', app.today_ist() - 3) || '; '
  || pg_temp.line('Late 1', 'Monthly reels', 'Sharma Weddings', app.today_ist() - 1) || '.',
  'listing the open items with a planned date before today, oldest first: never a done item or a future one');
select is((pg_temp.last('admin', 'reminder_item_overdue')).link,
  '/clients/' || pg_temp.fx('client_a') || '/projects/' || pg_temp.fx('pm'), 'one project: its page');
select is((pg_temp.last('admin2', 'reminder_item_overdue')).title, 'Overdue: B late', 'one item: its title');
select is((pg_temp.last('admin2', 'reminder_item_overdue')).body,
  'Bakery menu · Blue Bakery. Planned for ' || app.notify_date(app.today_ist() - 1) || '.', 'its project, client and date');
select ok((select bool_and(actor_id is null and escalation_level = 0) from public.notifications where kind = 'reminder_item_overdue'),
  'no actor (the job), not an escalation');
select is(pg_temp.n('owner'), 0::bigint, 'the Owner is not told yet: the Admin first');
select is((select count(*)::integer from public.client_work_alerts where entity_id = pg_temp.fx('dlate')), 0,
  'an item of a client with no Admin (a draft the Owner runs) gives no notice');
select is(app.client_work_alerts((select t1 from t) + interval '5 minutes'), 0, 'the next run sends nothing again (once per item)');

-- E1. Then the Owner ----------------------------------------------------------------------------------------
select pg_temp.clear();
select is(app.client_work_alerts((select t1 from t) + interval '24 hours' - interval '1 minute'), 0,
  'nothing before item_overdue_escalate_hours (24) after the notice');
select pg_temp.as_member('admin');
select public.item_mark_done(pg_temp.fx('late1'));
select pg_temp.as_system();
select is(app.client_work_alerts((select t1 from t) + interval '24 hours'), 2, 'at 24 h: one escalation per Admin');
select is(pg_temp.n('owner', 'escalation_item_overdue'), 2::bigint, 'two rows to the Owner, one per Admin, never one per item');
select is((select string_agg(title, ' | ' order by title) from public.notifications where kind = 'escalation_item_overdue'),
  'Other Admin has a client item overdue | Ravi Admin has a client item overdue',
  'each naming the Admin; Late 1, done in time, is left out');
select is((select body from public.notifications where kind = 'escalation_item_overdue' and title like 'Ravi%'),
  pg_temp.line('Late 2', 'Monthly reels', 'Sharma Weddings', app.today_ist() - 3) || '. Still not done 24 h after Ravi Admin was told.',
  'listing the items still open');
select ok((select bool_and(escalation_level = 1 and actor_id is null and link = '/clients/items?filter=overdue')
           from public.notifications where kind = 'escalation_item_overdue'),
  'an escalation (level 1: the per-person email cap is bypassed), no actor, linking the cross-client overdue list');
select is(pg_temp.n('admin') + pg_temp.n('admin2'), 0::bigint, 'the Admins get nothing more');
select is(app.client_work_alerts((select t1 from t) + interval '30 hours'), 0, 'each item escalates once');
select is((select count(*)::integer from public.client_work_alerts where entity_id = pg_temp.fx('dlate')), 0,
  'and a client with no Admin never escalates');

-- E1. A moved planned date re-arms; the threshold is the setting ------------------------------------------------
select pg_temp.clear();
update public.org_settings set item_overdue_escalate_hours = 2;
select pg_temp.as_member('admin');
select public.item_update(pg_temp.fx('late2'), jsonb_build_object('planned_date', app.today_ist() - 1));
select pg_temp.as_system();
select is(app.client_work_alerts((select t1 from t) + interval '31 hours'), 1, 'a new planned date, still past: the Admin is told again');
select is((pg_temp.last('admin', 'reminder_item_overdue')).title, 'Overdue: Late 2', 'about that item');
select is(app.client_work_alerts((select t1 from t) + interval '32 hours' + interval '59 minutes'), 0,
  'the escalation waits for the setting''s 2 hours');
select is(app.client_work_alerts((select t1 from t) + interval '33 hours'), 1, 'and comes at 2 hours');
select is((pg_temp.last('owner', 'escalation_item_overdue')).body,
  pg_temp.line('Late 2', 'Monthly reels', 'Sharma Weddings', app.today_ist() - 1) || '. Still not done 2 h after Ravi Admin was told.',
  'once more for the new date');
update public.org_settings set item_overdue_escalate_hours = 24;

-- E2. An ended cycle left undecided ------------------------------------------------------------------------------
select pg_temp.clear();
select app.cycle_create(pg_temp.project('pm'), (select last_month from t), 'schedule', null);
select app.cycle_create(pg_temp.project('pb'), (select last_month from t), 'schedule', null);
select app.cycle_close_prompt((select t1 from t));
select pg_temp.as_member('admin2');
select public.cycle_carry_decide(array(select id from public.project_items
  where cycle_id = (pg_temp.cycle_of('pb', (select last_month from t))).id), 'leave_pending');
select pg_temp.as_system();
select pg_temp.clear();
select app.client_work_alerts((select t1 from t) + interval '2 days' - interval '1 minute');
select is(pg_temp.n('owner', 'escalation_cycle_undecided'), 0::bigint,
  'nothing before cycle_decide_escalate_days (2) after the period ended and the Admin was prompted');
select app.client_work_alerts((select t1 from t) + interval '2 days');
select is(pg_temp.n('owner', 'escalation_cycle_undecided'), 1::bigint, 'at 2 days: the Owner, once');
select is((pg_temp.last('owner', 'escalation_cycle_undecided')).title,
  'Ravi Admin has not decided ' || app.cycle_label('monthly', (select last_month from t)) || ' · Monthly reels',
  'naming the Admin, the cycle and the project');
select is((pg_temp.last('owner', 'escalation_cycle_undecided')).body,
  'Monthly reels (Sharma Weddings) · ' || app.cycle_label('monthly', (select last_month from t))
  || ': 1 undecided. Unfinished items still undecided 2 days after the period ended.', 'with its count');
select ok((pg_temp.last('owner', 'escalation_cycle_undecided')).escalation_level = 1
          and (pg_temp.last('owner', 'escalation_cycle_undecided')).link = '/clients/' || pg_temp.fx('client_a') || '/projects/' || pg_temp.fx('pm'),
  'an escalation, linking the project');
select is((select count(*)::integer from public.client_work_alerts
           where entity_id = (pg_temp.cycle_of('pb', (select last_month from t))).id), 0,
  'a cycle whose items were all decided (left pending) never escalates');
select app.client_work_alerts((select t1 from t) + interval '5 days');
select is(pg_temp.n('owner', 'escalation_cycle_undecided'), 1::bigint, 'once per cycle');
select app.cycle_create(pg_temp.project('pm'), (app.period_start('monthly', app.today_ist()) - interval '2 month')::date, 'schedule', null);
select app.client_work_alerts((select t1 from t) + interval '40 days');
select is(pg_temp.n('owner', 'escalation_cycle_undecided'), 1::bigint, 'a cycle its Admin was never prompted about waits for the prompt');

-- E3. A one-time project past its delivery date -----------------------------------------------------------------
select pg_temp.clear();
select pg_temp.as_member('admin');
select public.project_update(pg_temp.fx('po'), jsonb_build_object('delivery_date', app.today_ist()));
select pg_temp.as_system();
select app.client_work_alerts((select morning from t) - interval '1 minute');
select is(pg_temp.n('owner', 'escalation_delivery_missed'), 0::bigint, 'nothing before 08:00 IST the morning after the delivery date');
select app.client_work_alerts((select morning from t));
select is(pg_temp.n('owner', 'escalation_delivery_missed'), 1::bigint, 'at 08:00 the morning after: the Owner, once');
select is((pg_temp.last('owner', 'escalation_delivery_missed')).title, 'Past delivery: Launch film · Ravi Admin', 'naming the Admin');
select is((pg_temp.last('owner', 'escalation_delivery_missed')).body,
  'Sharma Weddings. Due ' || app.notify_date(app.today_ist()) || ', not completed. Ravi Admin runs it.', 'and the date');
select ok((pg_temp.last('owner', 'escalation_delivery_missed')).escalation_level = 1
          and (pg_temp.last('owner', 'escalation_delivery_missed')).link = '/clients/' || pg_temp.fx('client_a') || '/projects/' || pg_temp.fx('po'),
  'an escalation, linking the project (a completed one with the same date gives none)');
select app.client_work_alerts((select morning from t) + interval '1 day');
select is(pg_temp.n('owner', 'escalation_delivery_missed'), 1::bigint, 'once per delivery date');
select pg_temp.as_member('admin');
select public.project_update(pg_temp.fx('po'), jsonb_build_object('delivery_date', app.today_ist() + 2));
select pg_temp.as_system();
select app.client_work_alerts((select morning from t) + interval '2 days' - interval '1 minute');
select is(pg_temp.n('owner', 'escalation_delivery_missed'), 1::bigint, 'a moved date waits for its own morning');
select app.client_work_alerts((select morning from t) + interval '2 days');
select is(pg_temp.n('owner', 'escalation_delivery_missed'), 2::bigint, 'and is escalated again then (re-armed)');

-- One Admin's failure costs the others nothing -------------------------------------------------------------------
select pg_temp.clear();
select pg_temp.as_member('admin');
select public.item_add((pg_temp.cycle_of('pm', app.period_start('monthly', app.today_ist()))).id, 'Late 3', app.today_ist() - 1);
select pg_temp.as_member('admin2');
select public.item_add((pg_temp.cycle_of('pb', app.period_start('monthly', app.today_ist()))).id, 'B late 2', app.today_ist() - 1);
select pg_temp.as_system();
create function public.test_fail_notify() returns trigger language plpgsql as $f$
begin
  if new.recipient_id = (select id from fx where key = 'admin2') then
    raise exception 'test failure';
  end if;
  return new;
end;
$f$;
create trigger test_fail_notify before insert on public.notifications
  for each row execute function public.test_fail_notify();
select is(app.client_work_alerts((select t1 from t) + interval '50 days'), 1, 'one Admin''s notice failing does not stop the run');
select is((select count(*)::integer from public.client_work_alerts a join public.project_items i on i.id = a.entity_id
           where i.title = 'B late 2'), 0, 'their items stay unrecorded, so the next run tells them');
drop trigger test_fail_notify on public.notifications;
drop function public.test_fail_notify();
select is(app.client_work_alerts((select t1 from t) + interval '50 days'), 1, 'as it does');

select * from finish();
rollback;
