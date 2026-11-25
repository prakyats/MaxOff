-- v3.5 "Month close", U3 (the U2 review's should-fix 2; migrations v35_month_close and v35_month_correct):
-- app.first_priced_month's one-time branch and the snapshot's one-time lines, which pgTAP 161 (every priced
-- fixture a retainer cycle) does not reach.
--   1. the priced_from rule: a one-time line whose month is before its priced_from is not priced;
--   2. a cancelled line sits in its cancellation month; a completed one in its completion month; ₹0 counts;
--   3. each time: the first priced month equals the earliest priced month of revenue_project_lines_v;
--   4. the closed months' revenue.projects lines equal the view's (amount, potential, achieved, closed not
--      achieved, state) and remaining = greatest(potential - achieved, 0): an adjustment above the amount
--      leaves 0, a cancelled line leaves its whole potential.
-- Every name here is neutral.
begin;
create extension if not exists pgtap with schema extensions;
select plan(19);

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
  ('owner',    '00000000-0000-4000-8000-000000164901'),
  ('admin',    '00000000-0000-4000-8000-000000164902'),
  ('client',   '00000000-0000-4000-8000-0000001649c1');
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


insert into mo values ('m3', app.month_start(pg_temp.mo('m2') - 1));
insert into mo values ('m4', app.month_start(pg_temp.mo('m3') - 1));
-- Noon IST on day n of month k.
create function pg_temp.at(k text, n integer) returns timestamptz language sql stable as $$
  select ((pg_temp.mo(k) + n - 1)::text || ' 12:00:00+05:30')::timestamptz;
$$;
-- The view's earliest priced month for org A, read as the Owner inside (the view gates on finance.view).
create function pg_temp.view_first() returns date language sql stable as $$
  select min(l.month) from public.revenue_project_lines_v l where l.org_id = pg_temp.fx('org') and l.amount is not null;
$$;
-- A one-time project of org A with one deliverable done, then finished in the past as the database.
create function pg_temp.film(k text, title text) returns void language plpgsql as $$
begin
  perform pg_temp.as_member('admin');
  insert into fx values (k, public.project_create(pg_temp.fx('client'), title, 'one_time', null, app.today_ist() + 1,
    array['Stage 1'], array['Edit']));
  perform pg_temp.as_system();
  update public.project_items set state = 'approved', done_at = now(), done_by = pg_temp.fx('admin'),
    approved_at = now(), approved_by = pg_temp.fx('admin') where project_id = pg_temp.fx(k);
end;
$$;
create function pg_temp.complete_in(k text, m text) returns void language plpgsql as $$
begin
  perform pg_temp.as_system();
  update public.projects set state = 'completed', completed_at = pg_temp.at(m, 15), completed_by = pg_temp.fx('admin')
  where id = pg_temp.fx(k);
end;
$$;
create function pg_temp.price(k text, amount numeric, from_month text) returns void language plpgsql as $$
begin
  perform pg_temp.as_member('owner');
  perform public.billing_set_project(pg_temp.fx(k), amount, true, null);
  if from_month is not null then
    perform pg_temp.as_system();
    update public.project_billing set priced_from = pg_temp.mo(from_month) where project_id = pg_temp.fx(k);
  end if;
end;
$$;
-- A stored line against the view's, figure by figure.
create function pg_temp.line_matches(k text, m text) returns boolean language sql stable as $$
  select (e ->> 'amount')::numeric is not distinct from l.amount and (e ->> 'potential')::numeric = l.potential
     and (e ->> 'achieved')::numeric = l.achieved and (e ->> 'closed_not_achieved')::numeric = l.closed_not_achieved
     and e ->> 'state' = l.state::text
     and (e ->> 'remaining')::numeric = greatest(l.potential - l.achieved, 0)
  from public.month_snapshots s
  cross join jsonb_array_elements(s.data #> '{revenue,projects}') e
  join public.revenue_project_lines_v l on l.project_id = pg_temp.fx(k)
  where s.org_id = pg_temp.fx('org') and s.month = pg_temp.mo(m) and e ->> 'project_id' = pg_temp.fx(k)::text
  order by s.version desc limit 1;
$$;

insert into auth.users (id, email) select id, key || '-164@example.com' from fx where key in ('owner', 'admin');
insert into public.members (id, org_id, full_name, email, role, status, engagement, joined_at) values
  (pg_temp.fx('owner'), pg_temp.fx('org'), 'Test Owner', 'owner-164@example.com', 'owner', 'active', 'permanent', now() - interval '200 days'),
  (pg_temp.fx('admin'), pg_temp.fx('org'), 'Test Admin', 'admin-164@example.com', 'admin', 'active', 'permanent', now() - interval '200 days');
select pg_temp.as_owner_inside('owner');
insert into public.clients (id, org_id, name, state, admin_id, activated_at) values
  (pg_temp.fx('client'), pg_temp.fx('org'), 'Client 164', 'active', pg_temp.fx('admin'), now());

-- ===========================================================================================================
-- 1. The priced_from rule
-- ===========================================================================================================
-- Finished four months ago, priced only now (priced_from = this month): its month stays "No amount set" (Q1).
select pg_temp.film('late', 'Late film 164');
select pg_temp.complete_in('late', 'm4');
select pg_temp.price('late', 5000, null);
select pg_temp.as_owner_inside('owner');
select is((select l.month from public.revenue_project_lines_v l where l.project_id = pg_temp.fx('late')), pg_temp.mo('m4'),
  'a completed line sits in its completion month');
select is(app.first_priced_month(pg_temp.fx('org')), null::date,
  'its month is before its priced_from: nothing is priced');
select is(pg_temp.view_first(), null::date, 'the view agrees: no priced line');

-- ===========================================================================================================
-- 2. A cancelled line, a completed one, ₹0
-- ===========================================================================================================
-- Cancelled three months ago at 8,000, priced from that month.
select pg_temp.film('cancel', 'Cancelled film 164');
select pg_temp.price('cancel', 8000, 'm3');
select pg_temp.as_system();
update public.projects set state = 'cancelled', cancelled_at = pg_temp.at('m3', 20), cancelled_by = pg_temp.fx('owner'),
  cancelled_reason = 'The client stopped' where id = pg_temp.fx('cancel');
select pg_temp.as_owner_inside('owner');
select is((select l.month from public.revenue_project_lines_v l where l.project_id = pg_temp.fx('cancel')), pg_temp.mo('m3'),
  'a cancelled line sits in its cancellation month');
select is(app.first_priced_month(pg_temp.fx('org')), pg_temp.mo('m3'), 'the cancelled line makes that month the first priced');
select is(app.first_priced_month(pg_temp.fx('org')), pg_temp.view_first(), 'the same month as the view');

-- ₹0 ("Not billable"), completed four months ago, priced from then.
select pg_temp.film('zero', 'Zero film 164');
select pg_temp.complete_in('zero', 'm4');
select pg_temp.price('zero', 0, 'm4');
select pg_temp.as_owner_inside('owner');
select is(app.first_priced_month(pg_temp.fx('org')), pg_temp.mo('m4'), '₹0 counts: four months ago is now the first priced');
select is(app.first_priced_month(pg_temp.fx('org')), pg_temp.view_first(), 'the same month as the view');

-- Completed two months ago at 10,000, adjusted up to 12,000.
select pg_temp.film('over', 'Over film 164');
select pg_temp.complete_in('over', 'm2');
select pg_temp.price('over', 10000, 'm2');
select pg_temp.as_member('owner');
select public.revenue_override_set('project', pg_temp.fx('over'), 12000, 'Agreed extra with the client');
select pg_temp.as_owner_inside('owner');
select is(app.first_priced_month(pg_temp.fx('org')), pg_temp.mo('m4'), 'a later priced line leaves the first priced month alone');

-- ===========================================================================================================
-- 3-4. The closed months' one-time lines
-- ===========================================================================================================
select pg_temp.as_member('owner');
select is(public.month_close(pg_temp.mo('m4')), 1, 'four months ago closes (the first priced month)');
select is(public.month_close(pg_temp.mo('m3')), 1, 'three months ago closes');
select is(public.month_close(pg_temp.mo('m2')), 1, 'two months ago closes');
select pg_temp.as_owner_inside('owner');
select is((select array_agg(e ->> 'project_id' order by e ->> 'project_id')
           from public.month_snapshots s cross join jsonb_array_elements(s.data #> '{revenue,projects}') e
           where s.org_id = pg_temp.fx('org') and s.month = pg_temp.mo('m4')),
  (select array_agg(l.project_id::text order by l.project_id::text) from public.revenue_project_lines_v l
   where l.org_id = pg_temp.fx('org') and l.month = pg_temp.mo('m4')),
  'four months ago holds the view''s one-time lines of that month (the unpriced one and the ₹0 one)');
select ok(pg_temp.line_matches('late', 'm4'), 'the unpriced line: as the view (no amount, 0 potential), remaining 0');
select ok(pg_temp.line_matches('zero', 'm4'), 'the ₹0 line: as the view, everything 0');
select ok(pg_temp.line_matches('cancel', 'm3'), 'the cancelled line: as the view');
select is((select (e ->> 'remaining')::numeric from public.month_snapshots s
           cross join jsonb_array_elements(s.data #> '{revenue,projects}') e
           where s.org_id = pg_temp.fx('org') and s.month = pg_temp.mo('m3') and e ->> 'project_id' = pg_temp.fx('cancel')::text),
  8000::numeric, 'a cancelled line''s remaining is its whole potential (8,000 − 0)');
select ok(pg_temp.line_matches('over', 'm2'), 'the adjusted line: as the view');
select ok((select (e ->> 'achieved')::numeric = 12000 and (e ->> 'potential')::numeric = 10000 and (e ->> 'remaining')::numeric = 0
           from public.month_snapshots s cross join jsonb_array_elements(s.data #> '{revenue,projects}') e
           where s.org_id = pg_temp.fx('org') and s.month = pg_temp.mo('m2') and e ->> 'project_id' = pg_temp.fx('over')::text),
  'an adjustment above the amount: Achieved 12,000 of 10,000, remaining 0, never below');

select * from finish();
rollback;
