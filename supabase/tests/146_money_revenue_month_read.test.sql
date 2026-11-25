-- 9.2 (migration money_revenue_month_read): revenue_month_read, the Revenue page's one read. The Owner gets
-- the month's lines; the client's Admin, Crew and anon are refused. Seed members.
begin;
create extension if not exists pgtap with schema extensions;
select plan(18);

create temporary table fx (key text primary key, id uuid not null);
insert into fx values
  ('owner', '10000000-0000-4000-8000-000000000001'),
  ('admin', '10000000-0000-4000-8000-000000000002'),
  ('staff', '10000000-0000-4000-8000-000000000003'),
  ('client', '00000000-0000-4000-8000-0000001469a1');
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
create function pg_temp.as_anon() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  perform set_config('role', 'anon', true);
end;
$$;
create function pg_temp.code(sql text) returns text language plpgsql as $$
begin
  execute sql;
  return 'ok';
exception
  when sqlstate 'P0001' then return sqlerrm;
  when insufficient_privilege then return 'NO_PRIVILEGE';
end;
$$;
-- This fixture's lines in a read (other rows may exist in the seed).
create function pg_temp.mine(r jsonb, k text) returns jsonb language sql stable as $$
  select coalesce(jsonb_agg(e), '[]'::jsonb) from jsonb_array_elements(r -> k) e
  where e ->> 'client_id' = pg_temp.fx('client')::text;
$$;

insert into public.clients (id, org_id, name, state, admin_id, activated_at)
select pg_temp.fx('client'), m.org_id, 'Revenue read 146', 'active', pg_temp.fx('admin'), now()
from public.members m where m.id = pg_temp.fx('owner');

select pg_temp.as_member('admin');
insert into fx values ('p', public.project_create(pg_temp.fx('client'), 'Monthly 146', 'monthly', null, null,
  array['Stage 1'], array['A', 'B']));
insert into fx values ('ot', public.project_create(pg_temp.fx('client'), 'Film 146', 'one_time', null,
  app.month_start(app.month_start(app.today_ist()) + 40) + 4, array['Stage 1'], array['Cut']));
select pg_temp.as_system();
insert into fx select 'cur', c.id from public.project_cycles c where c.project_id = pg_temp.fx('p');
select pg_temp.as_member('admin');
select public.item_add(pg_temp.fx('cur'), 'Extra');
select pg_temp.as_member('owner');
select public.billing_set_project(pg_temp.fx('p'), 9000, true, null);
select public.billing_set_project(pg_temp.fx('ot'), 20000, true, null);
select public.advance_record(pg_temp.fx('ot'), 5000, null, 'Advance');

select is(public.revenue_month_read() ->> 'month', app.month_start(app.today_ist())::text, 'no month given: this IST month');
select is(public.revenue_month_read(app.today_ist()) ->> 'month', app.month_start(app.today_ist())::text, 'any day of a month reads that month');
select is(jsonb_array_length(pg_temp.mine(public.revenue_month_read(), 'cycles')), 1, 'this month: the retainer''s cycle');
select is((pg_temp.mine(public.revenue_month_read(), 'cycles') -> 0 ->> 'potential')::numeric, 9000::numeric, 'with its Potential');
select is((pg_temp.mine(public.revenue_month_read(), 'cycles') -> 0 ->> 'not_priced_count')::integer, 1, 'and its not-priced count');
select is(pg_temp.mine(public.revenue_month_read(), 'cycles') -> 0 ->> 'client_name', 'Revenue read 146', 'named by client');
select is(jsonb_array_length(pg_temp.mine(public.revenue_month_read(), 'projects')), 0, 'the one-time project is not in this month');
select is((pg_temp.mine(public.revenue_month_read(app.month_start(app.today_ist()) + 40), 'projects') -> 0 ->> 'potential')::numeric,
  20000::numeric, 'it sits in its delivery month');
select is((pg_temp.mine(public.revenue_month_read(), 'advances') -> 0 ->> 'amount')::numeric, 5000::numeric,
  'its advance is in the month it was received');
select ok((public.revenue_month_read() -> 'months') @> to_jsonb(array[app.month_start(app.today_ist()), app.month_start(app.month_start(app.today_ist()) + 40)]),
  'the months with lines are listed');

-- The scoped path (the month's cycles only) gives exactly what the whole view gives for that month, a
-- deliverable carried in from last month included (valued in its origin month, done in this one).
select pg_temp.as_system();
insert into fx select 'past', (app.cycle_create((select p from public.projects p where p.id = pg_temp.fx('p')),
  app.month_start(app.month_start(app.today_ist()) - 1), 'schedule', null, true)).id;
select pg_temp.as_member('owner');
select public.billing_set_cycle_amount(pg_temp.fx('past'), 6000);
select pg_temp.as_member('admin');
select public.cycle_carry_decide(array[(select i.id from public.project_items i where i.cycle_id = pg_temp.fx('past') and i.title = 'B')], 'carry_forward');
select public.item_mark_done((select i.id from public.project_items i where i.carried_from_item_id is not null and i.cycle_id = pg_temp.fx('cur')));
select public.item_mark_done((select i.id from public.project_items i where i.cycle_id = pg_temp.fx('cur') and i.title = 'A'));
select pg_temp.as_member('owner');
create function pg_temp.same_as_view(m date) returns boolean language sql stable as $$
  select (
    select coalesce(jsonb_agg(jsonb_build_array(e ->> 'cycle_id', (e ->> 'amount')::numeric, (e ->> 'potential')::numeric,
             (e ->> 'achieved')::numeric, (e ->> 'closed_not_achieved')::numeric, (e ->> 'remaining')::numeric,
             (e ->> 'added_value')::numeric, (e ->> 'not_priced_count')::integer, (e ->> 'plan_count')::integer,
             (e ->> 'done_count')::integer) order by e ->> 'cycle_id'), '[]'::jsonb)
    from jsonb_array_elements(public.revenue_month_read(m) -> 'cycles') e
  ) = (
    select coalesce(jsonb_agg(jsonb_build_array(c.cycle_id::text, c.amount, c.potential, c.achieved, c.closed_not_achieved,
             c.remaining, c.added_value, c.not_priced_count, c.plan_count, c.done_count) order by c.cycle_id::text), '[]'::jsonb)
    from public.revenue_by_cycle_v c where c.month = m
  );
$$;
select ok(pg_temp.same_as_view(app.month_start(app.today_ist())), 'this month: the scoped read equals the whole view');
select ok(pg_temp.same_as_view(app.month_start(app.month_start(app.today_ist()) - 1)), 'last month: the same, with its carried deliverable');
select is((select (e ->> 'achieved')::numeric from jsonb_array_elements(
             public.revenue_month_read(app.month_start(app.today_ist()) - 1) -> 'cycles') e where e ->> 'cycle_id' = pg_temp.fx('past')::text),
  3000::numeric, 'the carried deliverable, done this month, is Achieved in last month''s cycle (its share of 6,000 over two)');
select is((pg_temp.mine(public.revenue_month_read(), 'cycles') -> 0 ->> 'achieved')::numeric, 4500::numeric,
  'and this month counts only its own done deliverable (half of 9,000)');

select pg_temp.as_member('admin');
select is(pg_temp.code($$select public.revenue_month_read()$$), 'FORBIDDEN', 'the client''s Admin is refused');
select is(pg_temp.code($$select public.revenue_month_read(app.today_ist() + 40)$$), 'FORBIDDEN', 'for any month');
select pg_temp.as_member('staff');
select is(pg_temp.code($$select public.revenue_month_read()$$), 'FORBIDDEN', 'Crew are refused');
select pg_temp.as_anon();
select is(pg_temp.code($$select public.revenue_month_read()$$), 'NO_PRIVILEGE', 'anon has no privilege');

select * from finish();
rollback;
