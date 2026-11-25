-- v2.5 (migration revenue_every_day): the Owner's notification for an unpriced added deliverable (Q3), the
-- Billing history (Q7), the Today totals (R5) and the reads' new keys; Owner allowed, everyone else refused.
-- Seed members.
begin;
create extension if not exists pgtap with schema extensions;
select plan(39);

create temporary table fx (key text primary key, id uuid not null);
insert into fx values
  ('owner', '10000000-0000-4000-8000-000000000001'),
  ('admin', '10000000-0000-4000-8000-000000000002'),
  ('staff', '10000000-0000-4000-8000-000000000003'),
  ('client', '00000000-0000-4000-8000-0000001489a1');
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
select pg_temp.fx('client'), m.org_id, 'Every day 148', 'active', pg_temp.fx('admin'), now()
from public.members m where m.id = pg_temp.fx('owner');
create function pg_temp.notes(k text, p_kind text) returns integer language sql stable security definer as $$
  select count(*)::integer from public.notifications n where n.recipient_id = pg_temp.fx(k) and n.kind = p_kind;
$$;
create function pg_temp.note_text() returns text language sql stable security definer as $$
  select coalesce(string_agg(coalesce(n.title, '') || ' ' || coalesce(n.body, '') || ' ' || n.payload::text || ' ' || coalesce(n.link, ''), ' | '), '')
  from public.notifications n where n.kind = 'deliverable_not_priced';
$$;

select ok(exists (select 1 from public.notification_kinds k where k.kind = 'deliverable_not_priced'
                    and not k.actionable and not k.always_email and k.in_app), 'the new kind: in-app, not actionable, never email');

select pg_temp.as_member('admin');
insert into fx values ('p', public.project_create(pg_temp.fx('client'), 'Monthly 148', 'monthly', null, null,
  array['Stage 1'], array['A', 'B']));
insert into fx values ('ot', public.project_create(pg_temp.fx('client'), 'Film 148', 'one_time', null, app.today_ist() + 20,
  array['Stage 1'], array['Cut']));
select pg_temp.as_system();
insert into fx select 'cur', c.id from public.project_cycles c where c.project_id = pg_temp.fx('p');
insert into fx select 'ot_cycle', c.id from public.project_cycles c where c.project_id = pg_temp.fx('ot');

-- Q3: an unpriced cycle tells nobody.
select pg_temp.as_member('admin');
select public.item_add(pg_temp.fx('cur'), 'Extra one');
select is(pg_temp.notes('owner', 'deliverable_not_priced'), 0, 'an added deliverable in a cycle with no amount tells nobody');
select pg_temp.as_member('owner');
select public.billing_set_project(pg_temp.fx('p'), 12345, true, null);
select pg_temp.as_member('admin');
select public.item_add(pg_temp.fx('cur'), 'Extra two');
select is(pg_temp.notes('owner', 'deliverable_not_priced'), 1, 'in a priced cycle the Owner is told');
select is(pg_temp.notes('admin', 'deliverable_not_priced'), 0, 'the Admin who added it is not');
select is(pg_temp.notes('staff', 'deliverable_not_priced'), 0, 'Crew are not');
select ok(pg_temp.note_text() like '%Extra two%' and pg_temp.note_text() like '%Monthly 148%', 'it names the deliverable and the project');
select ok(pg_temp.note_text() !~ '(12345|12,345|₹)', 'and carries no amount in its title, body, payload or link');
select ok(pg_temp.note_text() like '%#project-billing%', 'it opens the project''s Billing section');
select public.project_blueprint_add_to_cycle(pg_temp.fx('p'), 'Extra three', pg_temp.fx('cur'));
select is(pg_temp.notes('owner', 'deliverable_not_priced'), 2, '"Also add to this month" tells the Owner too');
select pg_temp.as_member('owner');
select public.item_add(pg_temp.fx('cur'), 'Extra four');
select is(pg_temp.notes('owner', 'deliverable_not_priced'), 2, 'the Owner adding one himself is not told');
select pg_temp.as_system();
insert into fx select 'next', (app.cycle_create((select p from public.projects p where p.id = pg_temp.fx('p')),
  app.month_start(app.month_start(app.today_ist()) + 40), 'schedule', null, true)).id;
select is(pg_temp.notes('owner', 'deliverable_not_priced'), 2, 'a new cycle''s own list (the plan) tells nobody');
select pg_temp.as_member('admin');
select public.item_add(pg_temp.fx('ot_cycle'), 'Cut two');
select is(pg_temp.notes('owner', 'deliverable_not_priced'), 2, 'nor a deliverable added to a one-time project (no extras)');
select pg_temp.as_member('owner');
select public.billing_set_project(pg_temp.fx('ot'), 50000, true, null);
select public.billing_set_cycle_amount(pg_temp.fx('cur'), 0);
select pg_temp.as_member('admin');
select public.item_add(pg_temp.fx('cur'), 'Extra five');
select is(pg_temp.notes('owner', 'deliverable_not_priced'), 2, 'a cycle that is "Not billable" (0) tells nobody');
select pg_temp.as_member('owner');
select public.billing_set_cycle_amount(pg_temp.fx('cur'), 12345);

-- The reads' new keys.
select public.billing_mark(array[pg_temp.fx('cur')], true, app.today_ist(), 'Sent');
select public.item_mark_done((select i.id from public.project_items i where i.cycle_id = pg_temp.fx('cur') and i.title = 'A'));
select public.revenue_override_set('cycle', pg_temp.fx('cur'), 5000, 'Agreed');
select is(public.project_billing_read(pg_temp.fx('p'), pg_temp.fx('cur')) -> 'cycle' ->> 'billing_status', 'billed', 'the Billing read: the cycle''s billing status');
select is((public.project_billing_read(pg_temp.fx('p'), pg_temp.fx('cur')) -> 'cycle' -> 'override' ->> 'adjusted_value')::numeric, 5000::numeric,
  'the Owner''s adjustment');
select is((public.project_billing_read(pg_temp.fx('p'), pg_temp.fx('cur')) -> 'cycle' -> 'override' ->> 'calculated_value')::numeric,
  (public.project_billing_read(pg_temp.fx('p'), pg_temp.fx('cur')) -> 'cycle' ->> 'achieved_calculated')::numeric, 'beside the calculated figure');
select is(jsonb_array_length(public.project_billing_read(pg_temp.fx('p'), pg_temp.fx('cur')) -> 'items'), 2, 'the cycle''s plan deliverables');
select is((select sum((e ->> 'value')::numeric) from jsonb_array_elements(public.project_billing_read(pg_temp.fx('p'), pg_temp.fx('cur')) -> 'items') e),
  12345::numeric, 'whose values add up to the cycle''s amount');
select is(public.project_billing_read(pg_temp.fx('ot')) -> 'line' ->> 'billing_status', 'not_billed', 'a one-time line has its status');
select ok((public.project_billing_read(pg_temp.fx('ot')) -> 'line' ->> 'cycle_id') is not null, 'and the cycle to mark it Billed through');
select is((select e ->> 'billing_status' from jsonb_array_elements(public.revenue_month_read() -> 'cycles') e
           where e ->> 'cycle_id' = pg_temp.fx('cur')::text), 'billed', 'the Revenue read: the status too');
select is((select (e ->> 'adjusted')::boolean from jsonb_array_elements(public.revenue_month_read() -> 'cycles') e
           where e ->> 'cycle_id' = pg_temp.fx('cur')::text), true, 'and whether the figure is adjusted');

-- Q7: the Billing history.
select ok(jsonb_array_length(public.project_billing_history(pg_temp.fx('p'))) >= 6, 'the history lists the project''s billing changes');
select is(public.project_billing_history(pg_temp.fx('p')) -> 0 ->> 'entity', 'revenue_overrides', 'newest first (the adjustment)');
select ok((select bool_and(e ->> 'actor_name' is not null) from jsonb_array_elements(public.project_billing_history(pg_temp.fx('p'))) e
           where e ->> 'action' not in ('insert')), 'each named change says who made it');
select ok(not exists (select 1 from jsonb_array_elements(public.project_billing_history(pg_temp.fx('p'))) e
                      where e ->> 'entity' = 'item_billing' and e ->> 'action' = 'insert'), 'the bare "added" marks are not listed');
select ok(exists (select 1 from jsonb_array_elements(public.project_billing_history(pg_temp.fx('p'))) e
                  where e ->> 'entity' = 'cycle_billing' and e ->> 'action' = 'billed' and e ->> 'subject' is not null),
  'Billed is listed, with the cycle it was for');
select is(jsonb_array_length(public.project_billing_history(pg_temp.fx('p'), 2)), 2, 'the limit is kept');
select ok(not exists (select 1 from jsonb_array_elements(public.project_billing_history(pg_temp.fx('ot'))) e
                      where e ->> 'subject' like '%Monthly 148%' or e::text like '%12345%'), 'another project''s changes are not in it');
select is(pg_temp.code($$select public.project_billing_history(gen_random_uuid())$$), 'NOT_FOUND', 'an unknown project is NOT_FOUND');

-- R5: the Today totals equal the Revenue page's month.
select is((public.revenue_month_totals() ->> 'potential')::numeric,
  (select coalesce(sum((e ->> 'potential')::numeric), 0) from jsonb_array_elements(public.revenue_month_read() -> 'cycles') e)
  + (select coalesce(sum((e ->> 'potential')::numeric), 0) from jsonb_array_elements(public.revenue_month_read() -> 'projects') e),
  'Today''s Potential is the Revenue page''s');
select is((public.revenue_month_totals() ->> 'achieved')::numeric,
  (select coalesce(sum((e ->> 'achieved')::numeric), 0) from jsonb_array_elements(public.revenue_month_read() -> 'cycles') e)
  + (select coalesce(sum((e ->> 'achieved')::numeric), 0) from jsonb_array_elements(public.revenue_month_read() -> 'projects') e),
  'and its Achieved (the adjusted figure)');
select ok((public.revenue_month_totals() ->> 'not_priced')::integer >= 3, 'the not-priced count includes this cycle''s extras');

-- Refused.
select pg_temp.as_member('admin');
select is(pg_temp.code($$select public.project_billing_history(pg_temp.fx('p'))$$), 'FORBIDDEN', 'the client''s Admin: no history');
select is(pg_temp.code($$select public.revenue_month_totals()$$), 'FORBIDDEN', 'and no totals');
select pg_temp.as_member('staff');
select is(pg_temp.code($$select public.project_billing_history(pg_temp.fx('p'))$$), 'FORBIDDEN', 'Crew: no history');
select is(pg_temp.code($$select public.revenue_month_totals()$$), 'FORBIDDEN', 'and no totals');
select pg_temp.as_anon();
select is(pg_temp.code($$select public.project_billing_history(pg_temp.fx('p'))$$), 'NO_PRIVILEGE', 'anon: no privilege');
select is(pg_temp.code($$select public.revenue_month_totals()$$), 'NO_PRIVILEGE', 'anon: no privilege on the totals');

select * from finish();
rollback;
