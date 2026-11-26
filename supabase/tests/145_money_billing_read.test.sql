-- 9.2 (migration money_billing_read): project_billing_read, the Billing section's one read. The Owner gets
-- the figures; the client's Admin, Crew and anon get FORBIDDEN / no privilege, never a row. Seed members.
begin;
create extension if not exists pgtap with schema extensions;
select plan(13);

create temporary table fx (key text primary key, id uuid not null);
insert into fx values
  ('owner', '10000000-0000-4000-8000-000000000001'),
  ('admin', '10000000-0000-4000-8000-000000000002'),
  ('staff', '10000000-0000-4000-8000-000000000003'),
  ('client', '00000000-0000-4000-8000-0000001459a1');
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

insert into public.clients (id, org_id, name, state, admin_id, activated_at)
select pg_temp.fx('client'), m.org_id, 'Billing read 145', 'active', pg_temp.fx('admin'), now()
from public.members m where m.id = pg_temp.fx('owner');

select pg_temp.as_member('admin');
insert into fx values ('p', public.project_create(pg_temp.fx('client'), 'Read 145', 'monthly', null, null,
  array['Stage 1'], array['A', 'B']));
insert into fx values ('ot', public.project_create(pg_temp.fx('client'), 'Film 145', 'one_time', null, app.today_ist() + 20,
  array['Stage 1'], array['Cut']));
select pg_temp.as_system();
insert into fx select 'cur', c.id from public.project_cycles c where c.project_id = pg_temp.fx('p');
select pg_temp.as_member('admin');
select public.item_add(pg_temp.fx('cur'), 'Extra');
select pg_temp.as_member('owner');

select is(public.project_billing_read(pg_temp.fx('p'), pg_temp.fx('cur')) -> 'billing' ->> 'category', 'retainer',
  'unpriced retainer: the category defaults from recurrence');
select ok((public.project_billing_read(pg_temp.fx('p'), pg_temp.fx('cur')) -> 'billing' -> 'cycle_amount') = 'null'::jsonb
          and (public.project_billing_read(pg_temp.fx('p'), pg_temp.fx('cur')) -> 'cycle' -> 'amount') = 'null'::jsonb,
  'and no amount is set');
select public.billing_set_project(pg_temp.fx('p'), 9000, true, null);
select public.item_value_set((select i.id from public.project_items i where i.cycle_id = pg_temp.fx('cur') and i.title = 'Extra'), 500);
select is((public.project_billing_read(pg_temp.fx('p'), pg_temp.fx('cur')) -> 'cycle' ->> 'potential')::numeric, 9500::numeric,
  'the cycle: the amount with the priced extra on top');
select is(jsonb_array_length(public.project_billing_read(pg_temp.fx('p'), pg_temp.fx('cur')) -> 'added'), 1, 'its added deliverables are listed');
select is(public.project_billing_read(pg_temp.fx('p'), pg_temp.fx('cur')) -> 'added' -> 0 ->> 'method', 'added', 'with their method');
select ok((public.project_billing_read(pg_temp.fx('p'), pg_temp.fx('ot')) -> 'cycle') = 'null'::jsonb,
  'a cycle of another project is ignored');
select public.billing_set_project(pg_temp.fx('ot'), 20000, true, null);
select public.advance_record(pg_temp.fx('ot'), 5000, null, 'Advance');
select is((public.project_billing_read(pg_temp.fx('ot')) -> 'line' ->> 'advances_kept')::numeric, 5000::numeric, 'one-time: the line with its advances');
select is(jsonb_array_length(public.project_billing_read(pg_temp.fx('ot')) -> 'advances'), 1, 'and each advance');
select is(pg_temp.code($$select public.project_billing_read(gen_random_uuid())$$), 'NOT_FOUND', 'an unknown project is NOT_FOUND');

select pg_temp.as_member('admin');
select is(pg_temp.code($$select public.project_billing_read(pg_temp.fx('p'), pg_temp.fx('cur'))$$), 'FORBIDDEN', 'the client''s Admin is refused');
select is(pg_temp.code($$select public.project_billing_read(pg_temp.fx('ot'))$$), 'FORBIDDEN', 'for a one-time project too');
select pg_temp.as_member('staff');
select is(pg_temp.code($$select public.project_billing_read(pg_temp.fx('p'), pg_temp.fx('cur'))$$), 'FORBIDDEN', 'Crew are refused');
select pg_temp.as_anon();
select is(pg_temp.code($$select public.project_billing_read(pg_temp.fx('p'), pg_temp.fx('cur'))$$), 'NO_PRIVILEGE', 'anon has no privilege');

select * from finish();
rollback;
