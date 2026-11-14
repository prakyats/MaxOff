-- v2.0 X3 step 3, /leave and its tabs (2026-11-06, migration leave_folds; DATA-MODEL §1 "v2.0 X3"):
-- own_comp_leave() is the caller's comp leave in one read and working_day_rule(from, to) the note
-- dialog's working-day rule. Who may call them (authenticated only), security invoker, and for the
-- Owner, an Admin, Crew and a deactivated member each part equal to the read it replaces, RLS and
-- the functions' own checks deciding: a refusal carried as the code the function raises, never
-- raised; own data only. The window refused outside 1..62 days. Neutral names only.
begin;
create extension if not exists pgtap with schema extensions;
select plan(28);

create temporary table fx (key text primary key, id uuid not null);
insert into fx values
  ('owner', '10000000-0000-4000-8000-000000000001'),
  ('admin', '10000000-0000-4000-8000-000000000002'),
  ('staff', '10000000-0000-4000-8000-000000000003'),
  ('gone',  '00000000-0000-4000-8000-000000013801');
insert into fx select 'org', id from public.organizations limit 1;
grant select on fx to authenticated, anon;

create function pg_temp.fx(k text) returns uuid language sql stable as $$ select id from fx where key = k; $$;
create function pg_temp.as_member(k text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', pg_temp.fx(k)::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', pg_temp.fx(k), 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end;
$$;
-- The reads they replace, as the caller.
create function pg_temp.api_balance() returns jsonb language plpgsql as $$
declare v jsonb;
begin
  select to_jsonb(b) into v from public.comp_leave_balance(auth.uid()) b limit 1;
  return coalesce(v, 'null'::jsonb);
exception when sqlstate 'P0001' then
  return to_jsonb(sqlerrm);
end;
$$;
create function pg_temp.fold_balance() returns jsonb language sql stable as $$
  select coalesce(nullif(o->'balance', 'null'::jsonb), o->'balance_refused', 'null'::jsonb) from public.own_comp_leave() o;
$$;
create function pg_temp.api_dates() returns jsonb language plpgsql as $$
declare v jsonb;
begin
  select coalesce(jsonb_agg(to_jsonb(d) - 'ordinality' order by d.ordinality), '[]'::jsonb) into v
  from public.comp_leave_dates() with ordinality as d;
  return v;
exception when sqlstate 'P0001' then
  return to_jsonb(sqlerrm);
end;
$$;
create function pg_temp.fold_dates() returns jsonb language sql stable as $$
  select coalesce(nullif(o->'dates', 'null'::jsonb), o->'dates_refused', 'null'::jsonb) from public.own_comp_leave() o;
$$;
create function pg_temp.api_rule(from_date date, to_date date) returns jsonb language sql stable as $$
  select jsonb_build_object(
    'weekly_off_days', (select to_jsonb(s.weekly_off_days) from public.org_settings s limit 1),
    'holidays', coalesce((select jsonb_agg(h.date order by h.date) from public.holidays h
                          where h.date between from_date and to_date), '[]'::jsonb));
$$;

-- Fixtures: a deactivated member; Crew earns a comp-leave day; a holiday in the window, one out.
insert into auth.users (id, email) values (pg_temp.fx('gone'), 'gone-13801@example.com');
insert into public.members (id, org_id, full_name, email, role, status, engagement, joined_at, deactivated_at) values
  (pg_temp.fx('gone'), pg_temp.fx('org'), 'Gone Person', 'gone-13801@example.com', 'staff', 'deactivated', 'permanent',
   now() - interval '30 days', now());
insert into public.comp_leave_credits (member_id, days, granted_by, granted_on, expires_on, note)
values (pg_temp.fx('staff'), 1, pg_temp.fx('owner'), app.today_ist() - 2, app.today_ist() + 40, 'Worked a holiday 138');
insert into public.holidays (org_id, date, name) values
  (pg_temp.fx('org'), app.today_ist() - 3, 'Rule holiday 138'),
  (pg_temp.fx('org'), app.today_ist() - 30, 'Rule far holiday 138');

-- 1. Who may call them ----------------------------------------------------------------------------
select is((select prosecdef from pg_proc where oid = 'public.own_comp_leave()'::regprocedure), false, 'own_comp_leave: security invoker');
select ok(has_function_privilege('authenticated', 'public.own_comp_leave()', 'execute'), 'own_comp_leave: authenticated may call it');
select ok(not has_function_privilege('anon', 'public.own_comp_leave()', 'execute'), 'own_comp_leave: anon may not');
select is((select prosecdef from pg_proc where oid = 'public.working_day_rule(date, date)'::regprocedure), false, 'working_day_rule: security invoker');
select ok(has_function_privilege('authenticated', 'public.working_day_rule(date, date)', 'execute'), 'working_day_rule: authenticated may call it');
select ok(not has_function_privilege('anon', 'public.working_day_rule(date, date)', 'execute'), 'working_day_rule: anon may not');

-- 2. own_comp_leave, each role ---------------------------------------------------------------------
select pg_temp.as_member('staff');
select is(pg_temp.fold_balance(), pg_temp.api_balance(), 'Crew: the balance equals comp_leave_balance(own id)');
select is((public.own_comp_leave()->'balance'->>'available_days')::numeric, 1::numeric, 'Crew: their one free day');
select is(pg_temp.fold_dates(), pg_temp.api_dates(), 'Crew: the dates equal comp_leave_dates(), in its order');
select ok(jsonb_array_length(public.own_comp_leave()->'dates') > 0, 'Crew: dates to take it on');
select is(public.own_comp_leave()->'balance_refused', 'null'::jsonb, 'Crew: nothing refused');
select pg_temp.as_member('admin');
select is(pg_temp.fold_balance(), pg_temp.api_balance(), 'Admin: the balance equals comp_leave_balance(own id)');
select is(pg_temp.fold_dates(), pg_temp.api_dates(), 'Admin: the dates equal comp_leave_dates()');
select is((public.own_comp_leave()->'balance'->>'available_days')::numeric, 0::numeric, 'Admin: none of Crew''s (own data only)');
select pg_temp.as_member('owner');
select is(pg_temp.fold_balance(), pg_temp.api_balance(), 'Owner: the balance (or the refusal) equals the read');
select is(pg_temp.fold_dates(), pg_temp.api_dates(), 'Owner: the dates equal comp_leave_dates()');
select pg_temp.as_member('gone');
select is(public.own_comp_leave()->>'balance_refused', 'UNAUTHENTICATED', 'deactivated: refused UNAUTHENTICATED, never raised');
select is(pg_temp.fold_balance(), pg_temp.api_balance(), '... the code comp_leave_balance itself raises');
select is(pg_temp.fold_dates(), pg_temp.api_dates(), 'deactivated: the dates refused as comp_leave_dates refuses them');
select pg_temp.as_member('owner');
select is(public.own_comp_leave()->'dates', 'null'::jsonb, 'Owner: no dates (refused, carried, never raised)');

-- 3. working_day_rule, each role --------------------------------------------------------------------
select pg_temp.as_member('staff');
select is(public.working_day_rule(app.today_ist() - 7, app.today_ist()), pg_temp.api_rule(app.today_ist() - 7, app.today_ist()),
  'Crew: equals the two reads');
select ok(public.working_day_rule(app.today_ist() - 7, app.today_ist())->'holidays' @> to_jsonb(array[app.today_ist() - 3])
          and not (public.working_day_rule(app.today_ist() - 7, app.today_ist())->'holidays' @> to_jsonb(array[app.today_ist() - 30])),
  'Crew: the holiday in the window only');
select pg_temp.as_member('admin');
select is(public.working_day_rule(app.today_ist() - 7, app.today_ist()), pg_temp.api_rule(app.today_ist() - 7, app.today_ist()),
  'Admin: equals the two reads');
select pg_temp.as_member('owner');
select is(public.working_day_rule(app.today_ist() - 7, app.today_ist()), pg_temp.api_rule(app.today_ist() - 7, app.today_ist()),
  'Owner: equals the two reads');
select ok(public.working_day_rule(app.today_ist() - 7, app.today_ist())->'holidays' @> to_jsonb(array[app.today_ist() - 3]),
  'Owner: the holiday in the window');
select pg_temp.as_member('gone');
select is(public.working_day_rule(app.today_ist() - 7, app.today_ist()), pg_temp.api_rule(app.today_ist() - 7, app.today_ist()),
  'deactivated: equals the two reads (RLS shows them what it shows)');

-- 4. The window -------------------------------------------------------------------------------------
select pg_temp.as_member('staff');
select throws_ok($$ select public.working_day_rule(app.today_ist(), app.today_ist() + 62) $$, 'P0001', null, '63 days: refused');
select throws_ok($$ select public.working_day_rule(app.today_ist(), app.today_ist() - 1) $$, 'P0001', null, 'to before from: refused');

select * from finish();
rollback;
