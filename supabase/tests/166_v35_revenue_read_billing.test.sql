-- v3.5 U5 (migration v35_revenue_read_billing): revenue_month_read answers each line's billing status, the
-- value the month's snapshot stores, so a closed month's Revenue page can show "at close" and "now" when they
-- differ (WORKFLOWS §7.1, v3.5 Q13). The lines and figures are as before; Admin, Crew and anon are still
-- refused. Seed members.
begin;
create extension if not exists pgtap with schema extensions;
select plan(12);

create temporary table fx (key text primary key, id uuid not null);
insert into fx values
  ('owner', '10000000-0000-4000-8000-000000000001'),
  ('admin', '10000000-0000-4000-8000-000000000002'),
  ('staff', '10000000-0000-4000-8000-000000000003'),
  ('client', '00000000-0000-4000-8000-0000001669a1');
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
-- This fixture's one line of a kind in a month's read.
create function pg_temp.line(m date, k text) returns jsonb language sql stable as $$
  select e from jsonb_array_elements(public.revenue_month_read(m) -> k) e
  where e ->> 'client_id' = pg_temp.fx('client')::text limit 1;
$$;

insert into public.clients (id, org_id, name, state, admin_id, activated_at)
select pg_temp.fx('client'), m.org_id, 'Revenue billing 166', 'active', pg_temp.fx('admin'), now()
from public.members m where m.id = pg_temp.fx('owner');

select pg_temp.as_member('admin');
insert into fx values ('p', public.project_create(pg_temp.fx('client'), 'Monthly 166', 'monthly', null, null,
  array['Stage 1'], array['A']));
insert into fx values ('ot', public.project_create(pg_temp.fx('client'), 'Film 166', 'one_time', null,
  app.today_ist(), array['Stage 1'], array['Cut']));
select pg_temp.as_system();
insert into fx select 'cur', c.id from public.project_cycles c where c.project_id = pg_temp.fx('p');
insert into fx select 'otc', c.id from public.project_cycles c where c.project_id = pg_temp.fx('ot');
select pg_temp.as_member('owner');
select public.billing_set_project(pg_temp.fx('p'), 9000, true, null);
select public.billing_set_project(pg_temp.fx('ot'), 20000, true, null);

select ok(pg_temp.line(app.today_ist(), 'cycles') ? 'billing_status', 'a cycle line carries its billing status');
select is(pg_temp.line(app.today_ist(), 'cycles') ->> 'billing_status', 'not_billed', 'Not billed until marked');
select ok(pg_temp.line(app.today_ist(), 'projects') ? 'billing_status', 'a one-time line carries its billing status');
select is(pg_temp.line(app.today_ist(), 'projects') ->> 'billing_status', 'not_billed', 'Not billed until marked');

select public.billing_mark(array[pg_temp.fx('cur'), pg_temp.fx('otc')], true, null, null);
select is(pg_temp.line(app.today_ist(), 'cycles') ->> 'billing_status', 'billed', 'a marked cycle reads Billed');
select is(pg_temp.line(app.today_ist(), 'projects') ->> 'billing_status', 'billed', 'a marked one-time project reads Billed');
select is(pg_temp.line(app.today_ist(), 'cycles') ->> 'billing_status',
  (select c.billing_status::text from app.revenue_cycles(array[pg_temp.fx('cur')]) c),
  'the same value the snapshot builder stores for a cycle');
select is((pg_temp.line(app.today_ist(), 'cycles') ->> 'potential')::numeric, 9000::numeric, 'the figures are unchanged');

select public.billing_mark(array[pg_temp.fx('cur')], false, null, null);
select is(pg_temp.line(app.today_ist(), 'cycles') ->> 'billing_status', 'not_billed', 'marked Not billed again, it reads so');

select pg_temp.as_member('admin');
select is(pg_temp.code($$select public.revenue_month_read()$$), 'FORBIDDEN', 'the client''s Admin is still refused');
select pg_temp.as_member('staff');
select is(pg_temp.code($$select public.revenue_month_read()$$), 'FORBIDDEN', 'Crew are still refused');
select pg_temp.as_anon();
select is(pg_temp.code($$select public.revenue_month_read()$$), 'NO_PRIVILEGE', 'anon has no privilege');

select * from finish();
rollback;
