-- Kickoff 7 amendment C, escalations E1-E5 (owner 2026-10-08), with the escalation answers Q8-Q11
-- (owner 2026-10-08): app.client_work_alerts() every 5 minutes. E1 an overdue client item tells its
-- client's Admin first at 08:00 IST the day after its planned date (one row per Admin per run), then the
-- Owner (one escalation per Admin, naming them) at the first 08:00 IST at least item_overdue_escalate_hours
-- after that notice (Q10); an item back to open (sent back by the Owner, or reopened by the Admin; amendment D3) tells the Admin again with the
-- full threshold (Q8); a client with no Admin gives the Owner a reminder at the Admin's time and no
-- escalation (Q9); a new Admin is told first and gets their own threshold, and the escalation names
-- them (Q11); once per item and planned date: a new date re-arms, a date moved back to one already
-- noticed does not (the owner's E1 rule). E2 an ended cycle still undecided cycle_decide_escalate_days
-- after its end and its prompt -> the Owner, once per notice; an item back to open or a new Admin gives
-- the Admin a fresh notice first (Q8, Q11). E3 a one-time project open after its delivery date -> the
-- Owner at 08:00 IST the morning after, once per date, re-armed when it moves; the Owner's reminder for a
-- client with no Admin (Q9). E5 the two thresholds: defaults, checks, the Owner only. The schedule; the
-- record table has no API access for any role; E2's partial index; one Admin's failure costs the others
-- nothing. Simulated runs before the real-time steps (a send-back, an Admin's reopen, a new Admin, all at now())
-- use the 08:00 IST of past days; the steps after them use the first 08:00 IST after now().
-- The 7A review of d9caeab: (M1) an item added with a past date, its planned date moved into the past
-- (several times), a project created with a past delivery date, its date moved or the project reopened
-- after it: nothing within minutes, one notice or escalation at the next 08:00 IST, naming only the
-- date held at the run; (S2) a replayed run sends nothing twice, the unique answer stops a send the
-- check misses (a WARNING), every new row says what it answers, and the job refuses repeatable read;
-- (L1) one items_to_decide per Admin per morning; (L2) no escalation is used up without an active
-- Owner; (L3) E2's partial index; (L4) a tick, an edit and leave pending stamp nothing.
-- Amendment C timing answers (advisor 2026-10-08, owner to confirm): (Q12 (b)) cycle_generate at 00:00
-- IST, the prompt at 08:05 (pgTAP 69 has "cycle ready"); (Q13 (a)) a send only in the morning window,
-- 08:00 to before 08:30 IST: a first run after an outage at 15:00 IST sends nothing, the next 08:00 sends
-- what still holds. Simulated runs are at 08:00 IST or inside the window.
begin;
create extension if not exists pgtap with schema extensions;
select plan(182);

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
-- The Admins have run their clients for months (Q11 counts a notice only after the Admin's assignment).
update public.client_admin_assignments set from_at = now() - interval '90 days';
delete from public.activity_log;

create temporary table t as
select now() as t1,
       (((app.today_ist() + 1)::timestamp + time '08:00') at time zone 'Asia/Kolkata') as morning,
       app.client_work_morning(now()) as r,
       (app.period_start('monthly', app.today_ist()) - interval '1 month')::date as last_month,
       (app.period_start('monthly', app.today_ist()) - interval '3 month')::date as old_month;
grant select on t to authenticated;
-- 08:00 IST on today + k.
create function pg_temp.s(k integer) returns timestamptz language sql stable as $$
  select ((app.today_ist() + k)::timestamp + time '08:00') at time zone 'Asia/Kolkata';
$$;
-- An overdue line as the notices write it.
create function pg_temp.line(i text, p text, c text, d date) returns text language sql immutable as $$
  select format('%s (%s · %s, %s)', i, p, c, app.notify_date(d));
$$;
-- The item of that title in a project's cycle starting on that date.
create function pg_temp.item_in(p text, d date, i text) returns uuid language sql stable security definer as $$
  select x.id from public.project_items x
  where x.cycle_id = (pg_temp.cycle_of(p, d)).id and x.title = i;
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
  ('late1', public.item_add((pg_temp.cycle_of('pm', app.period_start('monthly', app.today_ist()))).id, 'Late 1', app.today_ist() - 11)),
  ('late1b', public.item_add((pg_temp.cycle_of('pm', app.period_start('monthly', app.today_ist()))).id, 'Late 1b', app.today_ist() - 11)),
  ('late2', public.item_add((pg_temp.cycle_of('pm', app.period_start('monthly', app.today_ist()))).id, 'Late 2', app.today_ist() - 13)),
  ('future', public.item_add((pg_temp.cycle_of('pm', app.period_start('monthly', app.today_ist()))).id, 'Future', app.today_ist() + 3)),
  ('donelate', public.item_add((pg_temp.cycle_of('pm', app.period_start('monthly', app.today_ist()))).id, 'Done late', app.today_ist() - 12));
select public.item_mark_done(pg_temp.fx('donelate'));
select pg_temp.as_member('admin2');
insert into fx values
  ('blate', public.item_add((pg_temp.cycle_of('pb', app.period_start('monthly', app.today_ist()))).id, 'B late', app.today_ist() - 11));
select pg_temp.as_member('owner');
insert into fx values
  ('dlate', public.item_add((pg_temp.cycle_of('pd', null)).id, 'D late', app.today_ist() - 11));
select pg_temp.as_system();
select pg_temp.clear();
-- The fixture was made long ago: the 7A review's M1 arms an item's notice when it is added and a
-- project's missed delivery when it is created (at now()), and the simulated runs below are on past
-- mornings. The real-time cases (M1) are at the end.
update public.project_items set overdue_armed_at = now() - interval '90 days';
update public.projects set delivery_armed_at = now() - interval '90 days';

-- The schedule, the kinds, the helpers and E2's index ------------------------------------------------------
select is((select schedule || ' ' || command from cron.job where jobname = 'client_work_alerts'),
  '*/5 * * * * select app.client_work_alerts()', 'client_work_alerts runs every 5 minutes (as reminders_tick)');
select is((select string_agg(jobname || ' ' || schedule, ', ' order by jobname) from cron.job
           where jobname in ('cycle_generate', 'cycle_close_prompt')),
  'cycle_close_prompt 35 2 * * *, cycle_generate 30 18 * * *',
  'Q12 (b): cycles are made at 00:00 IST (18:30 UTC) and the prompt goes at 08:05 IST; no client-work notice at midnight');
select ok(not has_function_privilege('authenticated', 'app.client_work_alerts(timestamptz)', 'execute')
          and has_function_privilege('service_role', 'app.client_work_alerts(timestamptz)', 'execute'),
  'the job is service_role only');
select ok(not has_function_privilege('authenticated', 'app.client_work_morning(timestamptz)', 'execute')
          and not has_function_privilege('authenticated', 'app.client_items_overdue(uuid, date)', 'execute')
          and not has_function_privilege('anon', 'app.client_items_overdue(uuid, date)', 'execute'),
  'and so are its helpers');
select ok(not has_function_privilege('authenticated', 'app.client_items_overdue_due(uuid, date)', 'execute')
          and not has_function_privilege('anon', 'app.client_items_overdue_due(uuid, date)', 'execute')
          and has_function_privilege('service_role', 'app.client_items_overdue_due(uuid, date)', 'execute'),
  'E1''s items with their basis and due_from: service_role only');
select ok(not has_function_privilege('authenticated', 'app.client_work_send_window(timestamptz)', 'execute')
          and not has_function_privilege('anon', 'app.client_work_send_window(timestamptz)', 'execute')
          and has_function_privilege('service_role', 'app.client_work_send_window(timestamptz)', 'execute'),
  'Q13''s morning window: service_role only');
select is((select string_agg(kind || '=' || actionable || '/' || always_email || '/' || in_app, ', ' order by kind)
           from public.notification_kinds
           where kind in ('reminder_item_overdue', 'escalation_item_overdue', 'escalation_cycle_undecided',
                          'escalation_delivery_missed', 'reminder_delivery_missed')),
  'escalation_cycle_undecided=false/true/true, escalation_delivery_missed=false/true/true, '
  || 'escalation_item_overdue=false/true/true, reminder_delivery_missed=false/true/true, reminder_item_overdue=false/true/true',
  'the overdue notice, the three escalations and the Owner''s missed-delivery reminder (Q9) are always emailed');
select is((select indexdef from pg_indexes where indexname = 'project_items_cycle_undecided_idx'),
  'CREATE INDEX project_items_cycle_undecided_idx ON public.project_items USING btree (cycle_id) INCLUDE (reopened_at) '
  || 'WHERE ((state = ''open''::item_state) AND (carry_decision IS NULL))',
  'E2''s count of a cycle''s undecided items has its partial index (the re-review''s cost item)');

-- Q10. 08:00 IST --------------------------------------------------------------------------------------------
select is(app.client_work_morning(pg_temp.s(0) - interval '1 minute'), pg_temp.s(0), '07:59 IST: 08:00 the same day');
select is(app.client_work_morning(pg_temp.s(0)), pg_temp.s(0), '08:00 IST: that moment');
select is(app.client_work_morning(pg_temp.s(0) + interval '1 minute'), pg_temp.s(1), '08:01 IST: 08:00 the next day');

-- Q13 (a). The morning window: 08:00 to before 08:30 IST ----------------------------------------------------
select is(app.client_work_send_window(pg_temp.s(0) - interval '1 second'), false, '07:59:59 IST: closed');
select is(app.client_work_send_window(pg_temp.s(0)), true, '08:00 IST: open');
select is(app.client_work_send_window(pg_temp.s(0) + interval '29 minutes 59 seconds'), true, '08:29:59 IST: open');
select is(app.client_work_send_window(pg_temp.s(0) + interval '30 minutes'), false, '08:30 IST: closed');
select is(app.client_work_send_window(pg_temp.s(0) + interval '7 hours'), false, '15:00 IST: closed');
select is(app.client_work_send_window(pg_temp.s(0) - interval '8 hours'), false, 'midnight IST: closed');

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

-- The record table: no API access for any role ------------------------------------------------------------------
insert into public.client_work_alerts (org_id, kind, entity_id, armed_for, sent_at, recipient_id, answers_at)
values (pg_temp.fx('org'), 'item_overdue', pg_temp.fx('future'), app.today_ist() - 40, now() - interval '40 days', pg_temp.fx('admin'),
        now() - interval '41 days');
select pg_temp.as_member('owner');
select throws_ok($$ select count(*) from public.client_work_alerts $$, '42501', null, 'the Owner: no select');
select throws_ok($$ insert into public.client_work_alerts (org_id, kind, entity_id, armed_for, sent_at)
                    values (pg_temp.fx('org'), 'item_overdue', pg_temp.fx('late1'), app.today_ist(), now()) $$, '42501', null,
  'the Owner: no insert');
select throws_ok($$ update public.client_work_alerts set sent_at = now() $$, '42501', null, 'the Owner: no update');
select throws_ok($$ delete from public.client_work_alerts $$, '42501', null, 'the Owner: no delete');
select pg_temp.as_member('admin');
select throws_ok($$ select count(*) from public.client_work_alerts $$, '42501', null, 'an Admin: no select');
select throws_ok($$ insert into public.client_work_alerts (org_id, kind, entity_id, armed_for, sent_at)
                    values (pg_temp.fx('org'), 'item_overdue', pg_temp.fx('late1'), app.today_ist(), now()) $$, '42501', null,
  'an Admin: no insert');
select throws_ok($$ update public.client_work_alerts set sent_at = now() $$, '42501', null, 'an Admin: no update');
select throws_ok($$ delete from public.client_work_alerts $$, '42501', null, 'an Admin: no delete');
select pg_temp.as_member('staff');
select throws_ok($$ select count(*) from public.client_work_alerts $$, '42501', null, 'Crew: no select');
select throws_ok($$ insert into public.client_work_alerts (org_id, kind, entity_id, armed_for, sent_at)
                    values (pg_temp.fx('org'), 'item_overdue', pg_temp.fx('late1'), app.today_ist(), now()) $$, '42501', null,
  'Crew: no insert');
select throws_ok($$ update public.client_work_alerts set sent_at = now() $$, '42501', null, 'Crew: no update');
select throws_ok($$ delete from public.client_work_alerts $$, '42501', null, 'Crew: no delete');
select pg_temp.as_anon();
select throws_ok($$ select count(*) from public.client_work_alerts $$, '42501', null, 'anon: no select');
select throws_ok($$ insert into public.client_work_alerts (org_id, kind, entity_id, armed_for, sent_at)
                    values (pg_temp.fx('org'), 'item_overdue', pg_temp.fx('late1'), app.today_ist(), now()) $$, '42501', null,
  'anon: no insert');
select throws_ok($$ update public.client_work_alerts set sent_at = now() $$, '42501', null, 'anon: no update');
select throws_ok($$ delete from public.client_work_alerts $$, '42501', null, 'anon: no delete');
select pg_temp.as_system();
select is((select count(*)::integer from public.client_work_alerts), 1, 'the row is untouched by every refused write');
select ok((select relrowsecurity from pg_class where oid = 'public.client_work_alerts'::regclass), 'RLS is on');
delete from public.client_work_alerts;

-- E1. The Admin first, at 08:00 IST (Q10) ----------------------------------------------------------------------
select is(app.client_work_alerts(pg_temp.s(-12) - interval '1 minute'), 0,
  'Late 2 is overdue from 00:00 IST the day after its planned date, but at 07:59 IST nobody is told yet');
select is(app.client_work_alerts(pg_temp.s(-12)), 1, 'at 08:00 IST: its Admin');
select is((pg_temp.last('admin', 'reminder_item_overdue')).title, 'Overdue: Late 2', 'one item: its title');
select is((pg_temp.last('admin', 'reminder_item_overdue')).body,
  'Monthly reels · Sharma Weddings. Planned for ' || app.notify_date(app.today_ist() - 13) || '.', 'its project, client and date');
select is((pg_temp.last('admin', 'reminder_item_overdue')).link,
  '/clients/' || pg_temp.fx('client_a') || '/projects/' || pg_temp.fx('pm'), 'one project: its page');
select is(pg_temp.n('owner'), 0::bigint, 'the Owner is not told yet: the Admin first');

-- E1. Then the Owner, at the first 08:00 IST 24 h after the notice ---------------------------------------------------
select is(app.client_work_alerts(pg_temp.s(-11) - interval '1 minute'), 0, 'nothing at 07:59 IST the next day');
select is(app.client_work_alerts(pg_temp.s(-11)), 1, 'at 08:00 IST, 24 h after the notice: the Owner');
select is((pg_temp.last('owner', 'escalation_item_overdue')).title, 'Ravi Admin has a client item overdue', 'naming the Admin');
select is((pg_temp.last('owner', 'escalation_item_overdue')).body,
  pg_temp.line('Late 2', 'Monthly reels', 'Sharma Weddings', app.today_ist() - 13) || '. Still not done 24 h after Ravi Admin was told.',
  'listing the item');
select ok((select bool_and(escalation_level = 1 and actor_id is null and link = '/clients/items?filter=overdue')
           from public.notifications where kind = 'escalation_item_overdue'),
  'an escalation (level 1: the per-person email cap is bypassed), no actor, linking the cross-client overdue list');

-- E1. One row per recipient; Q9: the Owner's own client, at the Admin's time ------------------------------------------
select pg_temp.clear();
select is(app.client_work_alerts(pg_temp.s(-10)), 3, 'at 08:00 IST: one overdue notice per recipient');
select is(pg_temp.n('admin', 'reminder_item_overdue'), 1::bigint, 'one row for two overdue items (never one per item)');
select is((pg_temp.last('admin', 'reminder_item_overdue')).title, '2 client items overdue', 'naming the count');
select is((pg_temp.last('admin', 'reminder_item_overdue')).body,
  pg_temp.line('Late 1', 'Monthly reels', 'Sharma Weddings', app.today_ist() - 11) || '; '
  || pg_temp.line('Late 1b', 'Monthly reels', 'Sharma Weddings', app.today_ist() - 11) || '.',
  'listing the newly overdue open items: never Late 2 again, a done item or a future one');
select is((pg_temp.last('admin2', 'reminder_item_overdue')).title, 'Overdue: B late', 'the other Admin, their own');
select is((pg_temp.last('owner', 'reminder_item_overdue')).title, 'Overdue: D late',
  'Q9: a client with no Admin (a draft the Owner runs): the Owner gets the reminder, at the Admin''s time');
select is((pg_temp.last('owner', 'reminder_item_overdue')).body,
  'Diner film · Draft Diner. Planned for ' || app.notify_date(app.today_ist() - 11) || '.', 'no Admin named');
select ok((select bool_and(actor_id is null and escalation_level = 0) from public.notifications where kind = 'reminder_item_overdue'),
  'no actor (the job), not an escalation');
select is((select recipient_id from public.client_work_alerts where entity_id = pg_temp.fx('dlate')), pg_temp.fx('owner'),
  'the record names who was told');
select is(app.client_work_alerts(pg_temp.s(-10) + interval '5 minutes'), 0, 'the next run sends nothing again (once per item)');

select pg_temp.as_member('admin');
select public.item_mark_done(pg_temp.fx('late1'));
select pg_temp.as_system();
select pg_temp.clear();
select is(app.client_work_alerts(pg_temp.s(-9) - interval '1 minute'), 0, 'no escalation before 08:00 IST');
select is(app.client_work_alerts(pg_temp.s(-9)), 2, 'then one escalation per Admin');
select is((select string_agg(title, ' | ' order by title) from public.notifications where kind = 'escalation_item_overdue'),
  'Other Admin has a client item overdue | Ravi Admin has a client item overdue',
  'each naming the Admin, never one per item; Late 1, done in time, is left out');
select is((select body from public.notifications where kind = 'escalation_item_overdue' and title like 'Ravi%'),
  pg_temp.line('Late 1b', 'Monthly reels', 'Sharma Weddings', app.today_ist() - 11) || '. Still not done 24 h after Ravi Admin was told.',
  'listing the items still open');
select is(pg_temp.n('admin') + pg_temp.n('admin2'), 0::bigint, 'the Admins get nothing more');
select is(app.client_work_alerts(pg_temp.s(-8)), 0, 'each notice escalates once');
select is((select count(*)::integer from public.client_work_alerts where entity_id = pg_temp.fx('dlate')), 1,
  'Q9: the Owner''s own client never escalates (his reminder is the only row)');

-- E1. A moved planned date re-arms; the threshold is the setting, the escalation still at 08:00 IST --------------------
select pg_temp.clear();
update public.org_settings set item_overdue_escalate_hours = 2;
select pg_temp.as_member('admin');
select public.item_update(pg_temp.fx('late2'), jsonb_build_object('planned_date', app.today_ist() - 8));
select pg_temp.as_system();
select is((select overdue_armed_at from public.project_items where id = pg_temp.fx('late2')), now(),
  'M1: a moved planned date arms the item at that moment');
-- The move as made at 08:30 IST seven days ago (the trigger stamps now(); these runs are on past mornings).
update public.project_items set overdue_armed_at = pg_temp.s(-7) + interval '30 minutes' where id = pg_temp.fx('late2');
select is(app.client_work_alerts(pg_temp.s(-7) + interval '1 hour'), 0,
  'M1: a new planned date, already past, set at 08:30 IST: nothing at 09:00 (never within minutes)');
select is(app.client_work_alerts(pg_temp.s(-6)), 1, 'at the next 08:00 IST the Admin is told again (re-armed)');
select is((pg_temp.last('admin', 'reminder_item_overdue')).title, 'Overdue: Late 2', 'about that item');
select is(app.client_work_alerts(pg_temp.s(-6) + interval '3 hours'), 0,
  'the setting''s 2 hours have passed, but the escalation waits for 08:00 IST (Q10)');
select is(app.client_work_alerts(pg_temp.s(-5) - interval '1 minute'), 0, 'not at 07:59');
select is(app.client_work_alerts(pg_temp.s(-5)), 1, 'at 08:00 IST');
select is((pg_temp.last('owner', 'escalation_item_overdue')).body,
  pg_temp.line('Late 2', 'Monthly reels', 'Sharma Weddings', app.today_ist() - 8) || '. Still not done 2 h after Ravi Admin was told.',
  'once more for the new date');
update public.org_settings set item_overdue_escalate_hours = 24;

-- E1. Once per item and planned date (the owner's rule): a date moved away and back is not told again ------------
select pg_temp.clear();
select pg_temp.as_member('admin');
insert into fx values
  ('moved', public.item_add((pg_temp.cycle_of('pm', app.period_start('monthly', app.today_ist()))).id, 'Moved', app.today_ist() - 16));
select pg_temp.as_system();
-- Added a month ago (M1 arms it at now(); these runs are on past mornings).
update public.project_items set overdue_armed_at = now() - interval '30 days' where id = pg_temp.fx('moved');
select is(app.client_work_alerts(pg_temp.s(-15)), 1, 'Moved, planned for a date: its Admin is told at 08:00 IST the day after');
select is((pg_temp.last('admin', 'reminder_item_overdue')).title, 'Overdue: Moved', 'about Moved');
select is(app.client_work_alerts(pg_temp.s(-14)), 1, 'and the Owner the next morning');
select is((pg_temp.last('owner', 'escalation_item_overdue')).body,
  pg_temp.line('Moved', 'Monthly reels', 'Sharma Weddings', app.today_ist() - 16) || '. Still not done 24 h after Ravi Admin was told.',
  'escalated for that date');
select pg_temp.as_member('admin');
select public.item_update(pg_temp.fx('moved'), jsonb_build_object('planned_date', app.today_ist() - 15));
select public.item_update(pg_temp.fx('moved'), jsonb_build_object('planned_date', app.today_ist() - 16));
select pg_temp.as_system();
select is((select overdue_armed_at from public.project_items where id = pg_temp.fx('moved')), now(),
  'moved to the next day and back: each change arms the item');
-- The moves as made at 08:30 IST that morning (the trigger stamps now(); these runs are on past mornings).
update public.project_items set overdue_armed_at = pg_temp.s(-14) + interval '30 minutes' where id = pg_temp.fx('moved');
select pg_temp.clear();
select is(app.client_work_alerts(pg_temp.s(-13)), 0,
  'back on the date already noticed: the Admin is not told about it again the next morning');
select is(app.client_work_alerts(pg_temp.s(-12)), 0, 'nor is the Owner escalated about it again a day later');
select is(pg_temp.n('admin') + pg_temp.n('owner'), 0::bigint, 'nothing at all for that date');
select is((select string_agg(kind::text || '/' || armed_for::text, ',' order by sent_at) from public.client_work_alerts
           where entity_id = pg_temp.fx('moved')),
  'item_overdue/' || (app.today_ist() - 16)::text || ',item_overdue_escalation/' || (app.today_ist() - 16)::text,
  'its record: one notice and one escalation, for that date');
select pg_temp.as_member('admin');
select public.item_update(pg_temp.fx('moved'), jsonb_build_object('planned_date', app.today_ist() - 14));
select pg_temp.as_system();
-- Moved at 08:30 IST that morning.
update public.project_items set overdue_armed_at = pg_temp.s(-12) + interval '30 minutes' where id = pg_temp.fx('moved');
select is(app.client_work_alerts(pg_temp.s(-12) + interval '1 hour'), 0,
  'moved to a new date, already past, at 08:30 IST: nothing at 09:00 (M1)');
select is(app.client_work_alerts(pg_temp.s(-11)), 1, 'at the next 08:00 IST its Admin is told about the new date (re-armed)');
select is((pg_temp.last('admin', 'reminder_item_overdue')).body,
  'Monthly reels · Sharma Weddings. Planned for ' || app.notify_date(app.today_ist() - 14) || '.', 'naming the new date');
select pg_temp.as_member('admin');
select public.item_mark_done(pg_temp.fx('moved'));
select pg_temp.as_system();

-- Before the real-time steps: items noticed and escalated, ended cycles prompted and escalated ------------------------
select pg_temp.as_member('admin');
insert into fx values
  ('backr', public.item_add((pg_temp.cycle_of('pm', app.period_start('monthly', app.today_ist()))).id, 'Back R', app.today_ist() - 6)),
  ('backn', public.item_add((pg_temp.cycle_of('pm', app.period_start('monthly', app.today_ist()))).id, 'Back N', app.today_ist() - 6));
select pg_temp.as_member('admin2');
insert into fx values
  ('swap', public.item_add((pg_temp.cycle_of('pb', app.period_start('monthly', app.today_ist()))).id, 'Swap', app.today_ist() - 4));
select pg_temp.as_system();
-- Added a month ago (M1 arms them at now(); these runs are on past mornings).
update public.project_items set overdue_armed_at = now() - interval '30 days'
where id in (pg_temp.fx('backr'), pg_temp.fx('backn'), pg_temp.fx('swap'));
select pg_temp.clear();
select is(app.client_work_alerts(pg_temp.s(-5)), 1, 'Back R and Back N: their Admin is told');
select is(app.client_work_alerts(pg_temp.s(-4)), 1, 'and the Owner a day later');
select is(app.client_work_alerts(pg_temp.s(-3)), 1, 'Swap: its Admin (Other Admin) is told, not escalated yet');
select is((pg_temp.last('admin2', 'reminder_item_overdue')).title, 'Overdue: Swap', 'about Swap');
select app.cycle_create(pg_temp.project('pm'), (select old_month from t), 'schedule', null);
select app.cycle_create(pg_temp.project('pb'), (select old_month from t), 'schedule', null);
select app.cycle_close_prompt(pg_temp.s(-20));
select pg_temp.clear();
select is(app.client_work_alerts(pg_temp.s(-18)), 2,
  'E2: two ended cycles left undecided 2 days after the prompt: one escalation per Admin');

-- The real-time steps (now()): sent back, reopened, a new Admin -------------------------------------------------------
select pg_temp.as_member('admin');
select public.item_mark_done(pg_temp.fx('backr'));
select public.item_mark_done(pg_temp.fx('backn'));
select public.item_mark_done(pg_temp.item_in('pm', (select old_month from t), 'Reel 1'));
select pg_temp.as_member('owner');
select public.item_reopen(pg_temp.fx('backr'), 'Wrong cut');
select public.item_reopen(pg_temp.item_in('pm', (select old_month from t), 'Reel 1'), 'Redo the colour');
select pg_temp.as_member('admin');
select public.item_reopen(pg_temp.fx('backn'), 'Not finished');
select pg_temp.as_member('owner');
select public.client_assign_admin(pg_temp.fx('client_b'), pg_temp.fx('admin'));
select pg_temp.as_system();
select is((select reopened_at from public.project_items where id = pg_temp.fx('backr')), now(), 'Q8: the Owner''s send-back stamps reopened_at (amendment D3)');
select is((select reopened_at from public.project_items where id = pg_temp.fx('backn')), now(), 'and so does the Admin''s reopen');
select is((select reopened_at from public.project_items where id = pg_temp.fx('late1b')), null::timestamptz,
  'an item never back to open has none');

-- Q8 and Q11. The Admin is told again, at 08:00 IST ----------------------------------------------------------------
select pg_temp.clear();
select is(app.client_work_alerts((select r from t) - interval '1 minute'), 0,
  'before 08:00 IST nobody is told: the notices after the send-back, the reopen and the new Admin wait for the morning');
select is(app.client_work_alerts((select r from t)), 2, 'at 08:00 IST: the Admin''s overdue notice and their fresh E2 notice');
select is(pg_temp.n('owner') + pg_temp.n('admin2'), 0::bigint,
  'no escalation: the Owner''s earlier one does not stand for the new round, and the old Admin''s notice does not count');
select is((pg_temp.last('admin', 'items_to_decide')).title, '2 unfinished items to decide',
  'Q8 / Q11: the Admin is told again about the ended cycles: one sent back to open, one of the client they now run');
select is((pg_temp.last('admin', 'items_to_decide')).body,
  'Bakery menu (Blue Bakery) · ' || app.cycle_label('monthly', (select old_month from t)) || ': 1; '
  || 'Monthly reels (Sharma Weddings) · ' || app.cycle_label('monthly', (select old_month from t)) || ': 1.',
  'each cycle with its undecided count');
select is((pg_temp.last('admin', 'items_to_decide')).link, '/today', 'two projects: Today');
select is((pg_temp.last('admin', 'reminder_item_overdue')).title, '4 client items overdue', 'and one overdue notice');
select is((pg_temp.last('admin', 'reminder_item_overdue')).body,
  pg_temp.line('B late', 'Bakery menu', 'Blue Bakery', app.today_ist() - 11) || '; '
  || pg_temp.line('Back N', 'Monthly reels', 'Sharma Weddings', app.today_ist() - 6) || '; '
  || pg_temp.line('Back R', 'Monthly reels', 'Sharma Weddings', app.today_ist() - 6) || '; '
  || pg_temp.line('Swap', 'Bakery menu', 'Blue Bakery', app.today_ist() - 4) || '.',
  'Q8: Back R (sent back) and Back N (reopened) again; Q11: B late and Swap, told to their old Admin, now to the new one');
select is((pg_temp.last('admin', 'reminder_item_overdue')).link, '/clients/items?filter=overdue', 'two projects: the overdue list');
select is(app.client_work_alerts((select r from t) + interval '1 day' - interval '1 minute'), 0,
  'the Admin gets the full 24 h from this notice');
select is(app.client_work_alerts((select r from t) + interval '1 day'), 1, 'then the Owner, at 08:00 IST');
select is((pg_temp.last('owner', 'escalation_item_overdue')).title, 'Ravi Admin has 4 client items overdue',
  'naming the Admin who was told (Q11)');
select is((pg_temp.last('owner', 'escalation_item_overdue')).body,
  pg_temp.line('B late', 'Bakery menu', 'Blue Bakery', app.today_ist() - 11) || '; '
  || pg_temp.line('Back N', 'Monthly reels', 'Sharma Weddings', app.today_ist() - 6) || '; '
  || pg_temp.line('Back R', 'Monthly reels', 'Sharma Weddings', app.today_ist() - 6) || '; '
  || pg_temp.line('Swap', 'Bakery menu', 'Blue Bakery', app.today_ist() - 4) || '. Still not done 24 h after Ravi Admin was told.',
  'the four items');
select is((select array_agg(recipient_id order by sent_at) from public.client_work_alerts
           where kind = 'item_overdue' and entity_id = pg_temp.fx('swap')),
  array[pg_temp.fx('admin2'), pg_temp.fx('admin')], 'Swap''s record: told to Other Admin, then to Ravi Admin');
select pg_temp.clear();
select app.client_work_alerts((select r from t) + interval '2 days' - interval '1 minute');
select is(pg_temp.n('owner', 'escalation_cycle_undecided'), 0::bigint, 'E2: the Admin gets the full 2 days from the fresh notice');
select app.client_work_alerts((select r from t) + interval '2 days');
select is(pg_temp.n('owner', 'escalation_cycle_undecided'), 1::bigint, 'then the Owner at 08:00 IST, once for both');
select is((pg_temp.last('owner', 'escalation_cycle_undecided')).title, 'Ravi Admin has not decided 2 ended cycles',
  'naming the Admin who was told');
select is((pg_temp.last('owner', 'escalation_cycle_undecided')).body,
  'Bakery menu (Blue Bakery) · ' || app.cycle_label('monthly', (select old_month from t)) || ': 1 undecided; '
  || 'Monthly reels (Sharma Weddings) · ' || app.cycle_label('monthly', (select old_month from t))
  || ': 1 undecided. Unfinished items still undecided 2 days after the period ended.', 'each cycle with its count');
select pg_temp.as_member('owner');
select public.client_assign_admin(pg_temp.fx('client_b'), pg_temp.fx('admin2'));
select pg_temp.as_system();

-- E2. An ended cycle left undecided ------------------------------------------------------------------------------
select pg_temp.clear();
select app.cycle_create(pg_temp.project('pm'), (select last_month from t), 'schedule', null);
select app.cycle_create(pg_temp.project('pb'), (select last_month from t), 'schedule', null);
select app.cycle_close_prompt(pg_temp.s(1) + interval '5 minutes');
select pg_temp.as_member('admin2');
select public.cycle_carry_decide(array(select id from public.project_items
  where cycle_id = (pg_temp.cycle_of('pb', (select last_month from t))).id), 'leave_pending');
select pg_temp.as_system();
select pg_temp.clear();
select app.client_work_alerts(pg_temp.s(3) - interval '1 minute');
select is(pg_temp.n('owner', 'escalation_cycle_undecided'), 0::bigint,
  'nothing before cycle_decide_escalate_days (2) after the Admin''s 08:05 prompt: not at 07:59 IST');
select app.client_work_alerts(pg_temp.s(3));
select is(pg_temp.n('owner', 'escalation_cycle_undecided'), 1::bigint, 'at 08:00 IST two days later: the Owner, once (never at midnight)');
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
select app.client_work_alerts(pg_temp.s(6));
select is(pg_temp.n('owner', 'escalation_cycle_undecided'), 1::bigint, 'once per cycle');
select app.cycle_create(pg_temp.project('pm'), (app.period_start('monthly', app.today_ist()) - interval '2 month')::date, 'schedule', null);
select app.client_work_alerts(pg_temp.s(40));
select is(pg_temp.n('owner', 'escalation_cycle_undecided'), 1::bigint, 'a cycle its Admin was never prompted about waits for the prompt');

-- E3. A one-time project past its delivery date -----------------------------------------------------------------
select pg_temp.clear();
select pg_temp.as_member('admin');
select public.project_update(pg_temp.fx('po'), jsonb_build_object('delivery_date', app.today_ist()));
select pg_temp.as_member('owner');
select public.project_update(pg_temp.fx('pd'), jsonb_build_object('delivery_date', app.today_ist()));
select pg_temp.as_system();
select app.client_work_alerts((select morning from t) - interval '1 minute');
select is(pg_temp.n('owner', 'escalation_delivery_missed') + pg_temp.n('owner', 'reminder_delivery_missed'), 0::bigint,
  'nothing before 08:00 IST the morning after the delivery date');
select app.client_work_alerts((select morning from t));
select is(pg_temp.n('owner', 'escalation_delivery_missed'), 1::bigint, 'at 08:00 the morning after: the Owner, once');
select is((pg_temp.last('owner', 'escalation_delivery_missed')).title, 'Past delivery: Launch film · Ravi Admin', 'naming the Admin');
select is((pg_temp.last('owner', 'escalation_delivery_missed')).body,
  'Sharma Weddings. Due ' || app.notify_date(app.today_ist()) || ', not completed. Ravi Admin runs it.', 'and the date');
select ok((pg_temp.last('owner', 'escalation_delivery_missed')).escalation_level = 1
          and (pg_temp.last('owner', 'escalation_delivery_missed')).link = '/clients/' || pg_temp.fx('client_a') || '/projects/' || pg_temp.fx('po'),
  'an escalation, linking the project (a completed one with the same date gives none)');
select is(pg_temp.n('owner', 'reminder_delivery_missed'), 1::bigint, 'Q9: the Owner''s own client: a reminder, at the same time');
select is((pg_temp.last('owner', 'reminder_delivery_missed')).title, 'Past delivery: Diner film', 'no Admin named');
select is((pg_temp.last('owner', 'reminder_delivery_missed')).body,
  'Draft Diner. Due ' || app.notify_date(app.today_ist()) || ', not completed.', 'the client and the date');
select ok((pg_temp.last('owner', 'reminder_delivery_missed')).escalation_level = 0
          and (pg_temp.last('owner', 'reminder_delivery_missed')).actor_id is null
          and (pg_temp.last('owner', 'reminder_delivery_missed')).link = '/clients/' || pg_temp.fx('client_d') || '/projects/' || pg_temp.fx('pd'),
  'a reminder, not an escalation, no actor, linking the project');
select app.client_work_alerts((select morning from t) + interval '1 day');
select is(pg_temp.n('owner', 'escalation_delivery_missed') + pg_temp.n('owner', 'reminder_delivery_missed'), 2::bigint,
  'once per delivery date');
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
select is(app.client_work_alerts(pg_temp.s(50)), 1,
  'one Admin''s notice failing does not stop the run');
select is((pg_temp.last('admin', 'reminder_item_overdue')).title, 'Overdue: Late 3', 'the other Admin is told');
select is((select count(*)::integer from public.client_work_alerts a join public.project_items i on i.id = a.entity_id
           where i.title = 'B late 2'), 0, 'the failing Admin''s items stay unrecorded, so the next run tells them');
drop trigger test_fail_notify on public.notifications;
drop function public.test_fail_notify();
select is(app.client_work_alerts(pg_temp.s(50)), 1, 'as it does');

-- The 7A review of d9caeab: the real-time cases (now(), then the first 08:00 IST after it, r) ----------------------
select is((select indexdef from pg_indexes where indexname = 'client_work_alerts_once_per_answer'),
  'CREATE UNIQUE INDEX client_work_alerts_once_per_answer ON public.client_work_alerts USING btree '
  || '(kind, entity_id, armed_for, recipient_id, answers_at) NULLS NOT DISTINCT WHERE (answers_at IS NOT NULL)',
  'S2: one row per answer (kind, entity, date, recipient, answers_at), whatever the run''s p_now');
select is((select indexdef from pg_indexes where indexname = 'project_cycles_prompted_open_idx'),
  'CREATE INDEX project_cycles_prompted_open_idx ON public.project_cycles USING btree (org_id) '
  || 'WHERE ((prompted_at IS NOT NULL) AND (state = ''open''::cycle_state))',
  'L3: E2 scans the open, prompted cycles through a partial index');

-- M1. An item added with a past date, and several date edits at once: one notice, the next morning ------------------
select pg_temp.clear();
select pg_temp.as_member('admin');
insert into fx values
  ('pastnew', public.item_add((pg_temp.cycle_of('pm', app.period_start('monthly', app.today_ist()))).id, 'Past new', app.today_ist() - 2));
select pg_temp.as_system();
select is((select overdue_armed_at from public.project_items where id = pg_temp.fx('pastnew')), now(),
  'M1: an item added with a past planned date is armed when it is added');
select app.client_work_alerts(now());
select pg_temp.as_member('admin');
select public.item_update(pg_temp.fx('future'), jsonb_build_object('planned_date', app.today_ist() - 4));
select pg_temp.as_system();
select app.client_work_alerts(now());
select pg_temp.as_member('admin');
select public.item_update(pg_temp.fx('future'), jsonb_build_object('planned_date', app.today_ist() - 3));
select pg_temp.as_system();
select app.client_work_alerts(now());
select pg_temp.as_member('admin');
select public.item_update(pg_temp.fx('future'), jsonb_build_object('planned_date', app.today_ist() - 2));
select pg_temp.as_system();
select app.client_work_alerts((select r from t) - interval '1 minute');
select is(pg_temp.n('admin', 'reminder_item_overdue'), 0::bigint,
  'M1: nothing within minutes of the past dates, between the edits or before 08:00 IST (the 08:00 rule)');

-- S2. A row the "already sent?" check does not count (sent before the basis) still stops the same answer
-- (the item's basis, its overdue moment): the group is a WARNING.
insert into public.client_work_alerts (org_id, kind, entity_id, armed_for, sent_at, recipient_id, answers_at)
values (pg_temp.fx('org'), 'item_overdue', pg_temp.fx('pastnew'), app.today_ist() - 2,
        ((app.today_ist() - 1)::timestamp at time zone 'Asia/Kolkata') - interval '1 hour',
        pg_temp.fx('admin'), (app.today_ist() - 1)::timestamp at time zone 'Asia/Kolkata');
select app.client_work_alerts((select r from t));
select is(pg_temp.n('admin', 'reminder_item_overdue'), 0::bigint,
  'S2: the unique answer refuses a second send even when the check misses the first (the group is skipped, a WARNING)');
select is((select count(*)::integer from public.client_work_alerts
           where entity_id = pg_temp.fx('future') and kind = 'item_overdue' and armed_for < app.today_ist()), 0,
  'and nothing of that group is recorded (the 50-day runs above noticed its first date, now in the past)');
delete from public.client_work_alerts where entity_id = pg_temp.fx('pastnew')
  and sent_at = ((app.today_ist() - 1)::timestamp at time zone 'Asia/Kolkata') - interval '1 hour';

select is(app.client_work_alerts((select r from t)) >= 1, true, 'at 08:00 IST the notices go');
select is(pg_temp.n('admin', 'reminder_item_overdue'), 1::bigint, 'M1: one notice for the three edits and the new item');
select is((pg_temp.last('admin', 'reminder_item_overdue')).body,
  pg_temp.line('Future', 'Monthly reels', 'Sharma Weddings', app.today_ist() - 2) || '; '
  || pg_temp.line('Past new', 'Monthly reels', 'Sharma Weddings', app.today_ist() - 2) || '.',
  'naming the date the item holds at the run, never the dates it passed through');
select is((select array_agg(armed_for::text || '/' || (answers_at = ((app.today_ist() - 1)::timestamp at time zone 'Asia/Kolkata'))::text)
           from public.client_work_alerts
           where entity_id = pg_temp.fx('future') and kind = 'item_overdue' and armed_for < app.today_ist()),
  array[(app.today_ist() - 2)::text || '/true'],
  'one row, for that date, answering its basis (the overdue moment: the edits decide only when it goes)');
select is(app.client_work_alerts((select r from t) + interval '10 minutes'), 0, 'S2: a replayed run with a later p_now sends nothing');
select is(app.client_work_alerts((select r from t)), 0, 'nor one with the same p_now');
select is(pg_temp.n('admin', 'reminder_item_overdue'), 1::bigint, 'still one notice');
select throws_ok($$ insert into public.client_work_alerts (org_id, kind, entity_id, armed_for, sent_at, recipient_id, answers_at)
                    select org_id, kind, entity_id, armed_for, sent_at + interval '1 hour', recipient_id, answers_at
                    from public.client_work_alerts
                    where entity_id = pg_temp.fx('future') and kind = 'item_overdue' and armed_for < app.today_ist() $$,
  '23505', null, 'S2: the same answer sent at another moment is refused by the database');
select throws_ok($$ insert into public.client_work_alerts (org_id, kind, entity_id, armed_for, sent_at, recipient_id)
                    values (pg_temp.fx('org'), 'item_overdue', pg_temp.fx('future'), app.today_ist(), now(), pg_temp.fx('admin')) $$,
  '23514', null, 'S2: every new row says what it answers and who was told');

-- M1. E3: a delivery date moved into the past, several times, and a project created with one ------------------------
select pg_temp.clear();
select pg_temp.as_member('admin');
select public.project_update(pg_temp.fx('po'), jsonb_build_object('delivery_date', app.today_ist() - 4));
select public.project_update(pg_temp.fx('po'), jsonb_build_object('delivery_date', app.today_ist() - 5));
select public.project_update(pg_temp.fx('po'), jsonb_build_object('delivery_date', app.today_ist() - 3));
insert into fx values
  ('plate', public.project_create(pg_temp.fx('client_a'), 'Late launch', 'one_time', null, app.today_ist() - 1));
select pg_temp.as_system();
select is((select count(*)::integer from public.projects
           where id in (pg_temp.fx('po'), pg_temp.fx('plate')) and delivery_armed_at = now()), 2,
  'M1: a moved delivery date and a new project arm the missed-delivery escalation');
select app.client_work_alerts(now());
select app.client_work_alerts((select r from t) - interval '1 minute');
select is(pg_temp.n('owner', 'escalation_delivery_missed'), 0::bigint,
  'M1: E3 for a past delivery date waits for 08:00 IST, not the next run');
select app.client_work_alerts((select r from t));
select is(pg_temp.n('owner', 'escalation_delivery_missed'), 1::bigint, 'at 08:00 IST: one escalation');
select is((pg_temp.last('owner', 'escalation_delivery_missed')).body,
  'Launch film (Sharma Weddings, due ' || app.notify_date(app.today_ist() - 3) || '); '
  || 'Late launch (Sharma Weddings, due ' || app.notify_date(app.today_ist() - 1) || '). Not completed. Ravi Admin runs them.',
  'the new project and the date the moved one holds at the run (never the dates it passed through)');
select is((select string_agg(armed_for::text, ',') from public.client_work_alerts
           where entity_id = pg_temp.fx('po') and armed_for < app.today_ist()),
  (app.today_ist() - 3)::text, 'one row for that date');
select app.client_work_alerts((select r from t) + interval '5 minutes');
select is(pg_temp.n('owner', 'escalation_delivery_missed'), 1::bigint, 'once per delivery date');

-- M1. E3: a project reopened after its delivery date waits for the morning ----------------------------------------
select pg_temp.as_member('owner');
insert into fx values
  ('preopen', public.project_create(pg_temp.fx('client_a'), 'Reopened film', 'one_time', null, app.today_ist() - 6));
select public.project_complete(pg_temp.fx('preopen'));
select pg_temp.as_system();
update public.projects set delivery_armed_at = now() - interval '30 days' where id = pg_temp.fx('preopen');
select pg_temp.as_member('owner');
select public.project_reopen(pg_temp.fx('preopen'), 'The client wants a new cut');
select pg_temp.as_system();
select is((select delivery_armed_at from public.projects where id = pg_temp.fx('preopen')), now(), 'M1: a reopen arms it');
select pg_temp.clear();
select app.client_work_alerts(now());
select is(pg_temp.n('owner', 'escalation_delivery_missed'), 0::bigint,
  'M1: reopened past its delivery date, it is not escalated within minutes');
select app.client_work_alerts((select r from t) + interval '5 minutes');
select is((pg_temp.last('owner', 'escalation_delivery_missed')).title, 'Past delivery: Reopened film · Ravi Admin',
  'but at the next 08:00 IST run');

-- L2. No active Owner: an escalation is not used up -----------------------------------------------------------
select pg_temp.clear();
select pg_temp.as_member('admin');
insert into fx values
  ('porphan', public.project_create(pg_temp.fx('client_a'), 'Orphan film', 'one_time', null, app.today_ist() - 1));
select pg_temp.as_system();
update public.members set status = 'deactivated', deactivated_at = now() where id = pg_temp.fx('owner');
select app.client_work_alerts((select r from t) + interval '10 minutes');
select is((select count(*)::integer from public.client_work_alerts where entity_id = pg_temp.fx('porphan')), 0,
  'L2: with no active Owner the escalation is not recorded as sent');
update public.members set status = 'active', deactivated_at = null where id = pg_temp.fx('owner');
select app.client_work_alerts((select r from t) + interval '15 minutes');
select is((pg_temp.last('owner', 'escalation_delivery_missed')).title, 'Past delivery: Orphan film · Ravi Admin',
  'so it goes once there is one');

-- L1. One "unfinished items to decide" per Admin per morning ------------------------------------------------------
select app.cycle_create(pg_temp.project('pb'), (app.period_start('monthly', app.today_ist()) - interval '4 month')::date, 'schedule', null);
select app.cycle_close_prompt(pg_temp.s(-40));
select pg_temp.as_member('admin2');
select public.item_mark_done(pg_temp.item_in('pb', (app.period_start('monthly', app.today_ist()) - interval '4 month')::date, 'Menu'));
select pg_temp.as_member('owner');
select public.item_reopen(pg_temp.item_in('pb', (app.period_start('monthly', app.today_ist()) - interval '4 month')::date, 'Menu'), 'Wrong font');
select pg_temp.as_system();
select app.cycle_create(pg_temp.project('pb'), (app.period_start('monthly', app.today_ist()) - interval '5 month')::date, 'schedule', null);
select pg_temp.clear();
select app.client_work_alerts((select r from t));
select is(pg_temp.n('admin2', 'items_to_decide'), 0::bigint,
  'L1: an item back to open in a prompted cycle, but a newly ended cycle is due its 08:05 prompt: no fresh notice at 08:00');
select app.cycle_close_prompt((select r from t) + interval '5 minutes');
select is(pg_temp.n('admin2', 'items_to_decide'), 1::bigint, 'the prompt at 08:05 lists everything');
select is((select recipient_id || '/' || (sent_at = (select r from t) + interval '5 minutes') || '/' || (answers_at = now())
           from public.client_work_alerts where kind = 'cycle_undecided_notice'
             and entity_id = (pg_temp.cycle_of('pb', (app.period_start('monthly', app.today_ist()) - interval '4 month')::date)).id),
  pg_temp.fx('admin2') || '/true/true', 'and is recorded as the fresh notice it stands for');
select app.client_work_alerts((select r from t) + interval '10 minutes');
select is(pg_temp.n('admin2', 'items_to_decide'), 1::bigint, 'so the 08:10 run sends no second one');

-- L4. Only a return to open stamps reopened_at; only a date change or a return to open arms the notice ----------------
select pg_temp.as_member('admin');
insert into fx values ('stage', public.project_stage_add(pg_temp.fx('pm'), 'Edit'));
select pg_temp.as_system();
update public.project_items set overdue_armed_at = now() - interval '7 days' where id = pg_temp.fx('late1b');
select pg_temp.as_member('admin');
select public.item_tick_stage(pg_temp.fx('late1b'), pg_temp.fx('stage'), true);
select public.item_update(pg_temp.fx('late1b'), jsonb_build_object('notes', 'Waiting for the music'));
select public.item_update(pg_temp.fx('late1b'), jsonb_build_object('planned_date', app.today_ist() - 11));
select pg_temp.as_system();
select is((select reopened_at is null and overdue_armed_at = now() - interval '7 days'
           from public.project_items where id = pg_temp.fx('late1b')), true,
  'L4: a stage tick and an edit of an open item (its planned date kept) stamp neither');
select is((select bool_and(reopened_at is null) from public.project_items
           where cycle_id = (pg_temp.cycle_of('pb', (select last_month from t))).id and carry_decision = 'leave_pending'), true,
  'L4: leave pending keeps reopened_at null');
select pg_temp.as_member('admin');
select public.project_update(pg_temp.fx('plate'), jsonb_build_object('name', 'Late launch film'));
select pg_temp.as_system();
update public.projects set delivery_armed_at = now() - interval '7 days' where id = pg_temp.fx('plate');
select pg_temp.as_member('admin');
select public.project_update(pg_temp.fx('plate'), jsonb_build_object('name', 'Late launch cut'));
select pg_temp.as_system();
select is((select delivery_armed_at from public.projects where id = pg_temp.fx('plate')), now() - interval '7 days',
  'a project edit that keeps the delivery date does not re-arm it');

-- Q13 (a). An outage: a late send waits for the next 08:00 IST and goes only if its reason still holds -----------
-- Two items whose notice was due at 08:00 IST yesterday, while the database was down until 15:00.
select pg_temp.clear();
select pg_temp.as_member('admin');
insert into fx values
  ('out_open', public.item_add((pg_temp.cycle_of('pm', app.period_start('monthly', app.today_ist()))).id, 'Outage open', app.today_ist() - 2)),
  ('out_done', public.item_add((pg_temp.cycle_of('pm', app.period_start('monthly', app.today_ist()))).id, 'Outage done', app.today_ist() - 2));
select pg_temp.as_system();
-- Added long ago (M1 arms them at now(); these runs are on yesterday's and today's mornings).
update public.project_items set overdue_armed_at = now() - interval '30 days'
where id in (pg_temp.fx('out_open'), pg_temp.fx('out_done'));
select is(app.client_work_alerts(pg_temp.s(-1) + interval '7 hours'), 0,
  'Q13: the first run after the outage, at 15:00 IST, sends nothing');
select is(app.client_work_alerts(pg_temp.s(-1) + interval '16 hours'), 0, 'nor one at midnight');
select is((select count(*)::integer from public.client_work_alerts
           where entity_id in (pg_temp.fx('out_open'), pg_temp.fx('out_done'))), 0, 'and nothing is marked sent');
select pg_temp.as_member('admin');
select public.item_mark_done(pg_temp.fx('out_done'));
select pg_temp.as_system();
select app.client_work_alerts(pg_temp.s(0));
select is((select count(*)::integer from public.notifications
           where recipient_id = pg_temp.fx('admin') and kind = 'reminder_item_overdue'
             and (title || ' ' || body) like '%Outage open%' and (title || ' ' || body) not like '%Outage done%'), 1,
  'the next 08:00 IST run tells the Admin about the item still overdue, not the one done since (its reason no longer holds)');
select is((select string_agg(kind || '/' || (sent_at = pg_temp.s(0))::text, ',') from public.client_work_alerts
           where entity_id in (pg_temp.fx('out_open'), pg_temp.fx('out_done'))),
  'item_overdue/true', 'one record, at that run');
select pg_temp.clear();
select is(app.client_work_alerts(pg_temp.s(1) + interval '7 hours'), 0,
  'the escalation due at 08:00 IST the next day, missed by an outage: nothing at 15:00');
select app.client_work_alerts(pg_temp.s(2));
select is((select count(*)::integer from public.notifications
           where recipient_id = pg_temp.fx('owner') and kind = 'escalation_item_overdue' and body like '%Outage open%'), 1,
  'it goes at the next 08:00 IST, the item still open');

-- S2. The job refuses any isolation but read committed (its checks must see the last run's rows) ---------------------
create extension if not exists dblink with schema extensions;
select extensions.dblink_connect('iso', format('hostaddr=%s port=%s dbname=%s user=postgres password=postgres',
  host(inet_server_addr()), inet_server_port(), current_database()));
select extensions.dblink_exec('iso', 'begin isolation level repeatable read');
select throws_like($$ select * from extensions.dblink('iso', 'select app.client_work_alerts()') as x(n integer) $$,
  '%runs only at read committed%', 'S2: at repeatable read the job fails fast');
select extensions.dblink_exec('iso', 'rollback');
select extensions.dblink_disconnect('iso');

select * from finish();
rollback;
