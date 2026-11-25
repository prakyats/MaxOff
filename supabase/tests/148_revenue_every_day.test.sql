-- v2.5 (migration revenue_every_day): the Owner's notification for an unpriced added deliverable (Q3), the
-- Billing history (Q7), the Today totals (R5) and the reads' new keys; Owner allowed, everyone else refused.
-- Seed members.
begin;
create extension if not exists pgtap with schema extensions;
select plan(56);

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

-- v2.5's two reads as they were (migration revenue_every_day), to compare the re-created ones with.
create function pg_temp.old_billing_read(project_id uuid, cycle_id uuid default null)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_project public.projects;
  v_cycle_id uuid;
  v_out jsonb;
begin
  if not (select app.has_permission('finance.view')) then
    perform app.fail('FORBIDDEN', 'Only the Owner sees billing.');
  end if;
  select p.* into v_project from public.projects p where p.id = old_billing_read.project_id;
  if v_project.id is null then
    perform app.fail('NOT_FOUND', 'This project is not one of yours.');
  end if;

  v_out := jsonb_build_object(
    'project_id', v_project.id,
    'recurrence', v_project.recurrence,
    'billing', (
      select jsonb_build_object(
        'category', coalesce(b.billing_category::text,
          case when v_project.recurrence = 'one_time' then 'project' else 'retainer' end),
        'category_is_default', b.billing_category is null,
        'cycle_amount', b.cycle_amount,
        'fixed_amount', b.fixed_amount,
        'priced_from', b.priced_from)
      from (select 1) one
      left join public.project_billing b on b.project_id = v_project.id));

  if v_project.recurrence = 'one_time' then
    return v_out || jsonb_build_object(
      'line', (
        select jsonb_build_object(
          'month', l.month, 'amount', l.amount, 'potential', l.potential, 'achieved', l.achieved,
          'closed_not_achieved', l.closed_not_achieved, 'was_due', l.was_due,
          'ready_to_complete', l.ready_to_complete, 'state', l.state, 'delivery_date', l.delivery_date,
          'advances_kept', l.advances_kept, 'advances_returned', l.advances_returned,
          'cycle_id', l.cycle_id, 'achieved_calculated', l.achieved_calculated,
          'billing_status', l.billing_status, 'billed_on', l.billed_on, 'billing_note', l.billing_note,
          'override', (select jsonb_build_object('adjusted_value', o.adjusted_value, 'calculated_value', o.calculated_value,
                                                  'note', o.note, 'at', o.at)
                       from public.revenue_overrides o where o.id = l.override_id))
        from public.revenue_project_lines_v l where l.project_id = v_project.id),
      'advances', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'id', a.id, 'amount', a.amount, 'received_on', a.received_on, 'note', a.note,
          'returned_on', a.returned_on, 'return_note', a.return_note)
          order by a.received_on, a.recorded_at), '[]'::jsonb)
        from public.project_advances a where a.project_id = v_project.id));
  end if;

  -- A retainer: the cycle asked for (when it is this project's), else nothing cycle-shaped.
  select c.id into v_cycle_id from public.project_cycles c
  where c.id = old_billing_read.cycle_id and c.project_id = v_project.id;
  return v_out || jsonb_build_object(
    'cycle', (
      select jsonb_build_object(
        'cycle_id', c.cycle_id, 'label', c.label, 'month', c.month, 'amount', c.amount,
        'potential', c.potential, 'achieved', c.achieved, 'remaining', c.remaining,
        'closed_not_achieved', c.closed_not_achieved, 'added_value', c.added_value,
        'added_count', c.added_count, 'not_priced_count', c.not_priced_count, 'plan_count', c.plan_count,
        'achieved_calculated', c.achieved_calculated,
        'billing_status', c.billing_status, 'billed_on', c.billed_on, 'billing_note', c.billing_note,
        'override', (select jsonb_build_object('adjusted_value', o.adjusted_value, 'calculated_value', o.calculated_value,
                                                'note', o.note, 'at', o.at)
                     from public.revenue_overrides o where o.id = c.override_id))
      from app.revenue_cycles(array[v_cycle_id]) c where v_cycle_id is not null),
    -- v2.5: the cycle's plan deliverables with their values (the Owner's own value, or the even share).
    'items', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'item_id', v.item_id, 'title', v.title, 'method', v.method, 'value', v.value,
        'achieved', v.achieved, 'closed', v.closed_not_achieved)
        order by v."position" collate "C", v.item_id), '[]'::jsonb)
      from app.item_values(array[v_cycle_id]) v
      where v_cycle_id is not null and v.kind = 'plan'),
    'added', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'item_id', v.item_id, 'title', v.title, 'method', v.method, 'value', v.value,
        'achieved', v.achieved, 'closed', v.closed_not_achieved)
        order by v.position collate "C", v.item_id), '[]'::jsonb)
      from app.item_values(array[v_cycle_id]) v
      where v_cycle_id is not null and v.kind = 'added' and v.in_potential));
end;
$$;

create function pg_temp.old_billing_history(project_id uuid, limit_count integer default 50)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_project public.projects;
begin
  if not (select app.has_permission('finance.view')) then
    perform app.fail('FORBIDDEN', 'Only the Owner sees billing.');
  end if;
  select p.* into v_project from public.projects p where p.id = old_billing_history.project_id;
  if v_project.id is null then
    perform app.fail('NOT_FOUND', 'This project is not one of yours.');
  end if;
  return (
    select coalesce(jsonb_agg(to_jsonb(h) order by h.at desc, h.id desc), '[]'::jsonb)
    from (
      select a.id, a.at, a.entity, a.action, m.full_name as actor_name,
             a.diff -> 'old' as old, a.diff -> 'new' as new,
             case a.entity
               when 'cycle_billing' then (select c.label from public.project_cycles c where c.id = a.entity_id)
               when 'item_billing' then (select i.title from public.project_items i where i.id = a.entity_id)
               when 'revenue_overrides' then (
                 select c.label from public.revenue_overrides o
                 join public.project_cycles c on c.id = o.ref_id where o.id = a.entity_id and o.scope = 'cycle')
             end as subject
      from public.activity_log a
      left join public.members m on m.id = a.actor_id
      where a.org_id = v_project.org_id
        and (
          (a.entity = 'project_billing' and a.entity_id = v_project.id)
          or (a.entity = 'cycle_billing' and a.entity_id in (
                select c.id from public.project_cycles c where c.project_id = v_project.id))
          -- A deliverable's price or value; the bare "added" mark is not a billing change.
          or (a.entity = 'item_billing' and a.action in ('value_set', 'value_cleared') and a.entity_id in (
                select i.id from public.project_items i where i.project_id = v_project.id))
          or (a.entity = 'project_advances' and a.entity_id in (
                select x.id from public.project_advances x where x.project_id = v_project.id))
          or (a.entity = 'revenue_overrides' and a.entity_id in (
                select o.id from public.revenue_overrides o
                where (o.scope = 'project' and o.ref_id = v_project.id)
                   or (o.scope = 'cycle' and o.ref_id in (
                         select c.id from public.project_cycles c where c.project_id = v_project.id))))
        )
      order by a.at desc, a.id desc
      limit least(greatest(coalesce(limit_count, 50), 1), 200)
    ) h);
end;
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

-- v2.5 review (migration revenue_every_day_review): the two re-created reads answer exactly what v2.5's did.
select pg_temp.as_member('owner');
select is(public.project_billing_read(pg_temp.fx('p'), pg_temp.fx('cur')), pg_temp.old_billing_read(pg_temp.fx('p'), pg_temp.fx('cur')),
  'the Billing read (a retainer''s cycle, its deliverables valued once) is v2.5''s, key for key');
select is(public.project_billing_read(pg_temp.fx('p')), pg_temp.old_billing_read(pg_temp.fx('p')), 'and with no cycle asked for');
select is(public.project_billing_read(pg_temp.fx('ot')), pg_temp.old_billing_read(pg_temp.fx('ot')), 'and for a one-time project');
select is(public.project_billing_history(pg_temp.fx('p')), pg_temp.old_billing_history(pg_temp.fx('p')),
  'the history (each table by its own ids) is v2.5''s, row for row');
select is(public.project_billing_history(pg_temp.fx('p'), 3), pg_temp.old_billing_history(pg_temp.fx('p'), 3), 'and with a limit');
select is(jsonb_array_length(public.project_billing_history(pg_temp.fx('p'), 0)), 1, 'a limit below 1 is 1');

-- (a) The history is the project's own, by id. A price on one of p's deliverables and p's adjustment are not ot's.
select public.advance_record(pg_temp.fx('ot'), 1000, app.today_ist(), 'Advance 148');
select public.billing_mark(array[pg_temp.fx('ot_cycle')], true, app.today_ist(), null);
select public.item_value_set((select i.id from public.project_items i where i.cycle_id = pg_temp.fx('cur') and i.title = 'Extra two'), 700);
create function pg_temp.ot_owns(e jsonb) returns boolean language sql stable security definer as $$
  select exists (
    select 1 from public.activity_log a where a.id = (e ->> 'id')::bigint and (
      (a.entity = 'project_billing' and a.entity_id = pg_temp.fx('ot'))
      or (a.entity = 'cycle_billing' and a.entity_id = pg_temp.fx('ot_cycle'))
      or (a.entity = 'project_advances' and a.entity_id in (select x.id from public.project_advances x where x.project_id = pg_temp.fx('ot')))
      or (a.entity = 'item_billing' and a.entity_id in (select i.id from public.project_items i where i.project_id = pg_temp.fx('ot')))
      or (a.entity = 'revenue_overrides' and a.entity_id in (select o.id from public.revenue_overrides o
                                                            where o.ref_id in (pg_temp.fx('ot'), pg_temp.fx('ot_cycle'))))));
$$;
-- p's price and p's adjustment, by their audit rows' ids.
create function pg_temp.p_money_rows() returns bigint[] language sql stable security definer as $$
  select array_agg(a.id) from public.activity_log a
  where (a.entity = 'item_billing' and a.action = 'value_set'
         and a.entity_id = (select i.id from public.project_items i where i.cycle_id = pg_temp.fx('cur') and i.title = 'Extra two'))
     or (a.entity = 'revenue_overrides' and a.entity_id in (select o.id from public.revenue_overrides o where o.ref_id = pg_temp.fx('cur')));
$$;
select ok(jsonb_array_length(public.project_billing_history(pg_temp.fx('ot'))) >= 3
          and (select bool_and(pg_temp.ot_owns(e)) from jsonb_array_elements(public.project_billing_history(pg_temp.fx('ot'))) e),
  'every row of the one-time project''s history is its own billing, its cycle''s, its advances'' or its adjustments''');
select ok(cardinality(pg_temp.p_money_rows()) >= 2
          and (select count(*) = cardinality(pg_temp.p_money_rows()) from jsonb_array_elements(public.project_billing_history(pg_temp.fx('p'), 200)) e
               where (e ->> 'id')::bigint = any (pg_temp.p_money_rows())),
  'the retainer''s price and adjustment are in its own history');
select ok(not exists (select 1 from jsonb_array_elements(public.project_billing_history(pg_temp.fx('ot'), 200)) e
                      where (e ->> 'id')::bigint = any (pg_temp.p_money_rows())),
  'and neither is in the one-time project''s');

-- (b) A deliverable carried into a priced cycle is not "added": nobody is told.
select pg_temp.as_system();
insert into fx select 'past', (app.cycle_create((select p from public.projects p where p.id = pg_temp.fx('p')),
  app.month_start(app.month_start(app.today_ist()) - 1), 'schedule', null, true)).id;
select pg_temp.as_member('admin');
select public.cycle_carry_decide(array[(select i.id from public.project_items i where i.cycle_id = pg_temp.fx('past') and i.title = 'B')], 'carry_forward');
select pg_temp.as_system();
select ok(exists (select 1 from public.project_items i where i.cycle_id = pg_temp.fx('cur') and i.carried_from_item_id is not null)
          and pg_temp.notes('owner', 'deliverable_not_priced') = 2,
  'a deliverable carried into a priced cycle tells nobody');

-- (c) The nightly copy of a cycle's list (app.cycle_copy_item_list) is the plan: nobody is told.
select pg_temp.as_member('admin');
select public.project_blueprint_add(pg_temp.fx('p'), 'D148');
select pg_temp.as_system();
insert into fx select 'late', (app.cycle_create((select p from public.projects p where p.id = pg_temp.fx('p')),
  app.month_start(app.month_start(app.month_start(app.today_ist()) + 40) + 40), 'carry', pg_temp.fx('owner'), false)).id;
select pg_temp.as_member('owner');
select public.billing_set_cycle_amount(pg_temp.fx('late'), 9000);
select pg_temp.as_system();
select app.cycle_copy_item_list((select p from public.projects p where p.id = pg_temp.fx('p')), pg_temp.fx('late'), null);
select ok((select count(*) >= 4 from public.project_items i where i.cycle_id = pg_temp.fx('late'))
          and pg_temp.notes('owner', 'deliverable_not_priced') = 2,
  'the list copied into a priced cycle later tells nobody');

-- (e) A cycle's plan deliverables: one with its own value beside the even shares, one "Not needed" not counted.
select pg_temp.as_member('owner');
select public.item_value_set((select i.id from public.project_items i where i.cycle_id = pg_temp.fx('late') and i.title = 'A'), 3000);
select pg_temp.as_member('admin');
select public.item_cancel((select i.id from public.project_items i where i.cycle_id = pg_temp.fx('late') and i.title = 'B'),
  'Dropped this month', 'not_needed');
select pg_temp.as_member('owner');
create function pg_temp.late_item(t text) returns jsonb language sql stable as $$
  select e from jsonb_array_elements(public.project_billing_read(pg_temp.fx('p'), pg_temp.fx('late')) -> 'items') e where e ->> 'title' = t;
$$;
select is(pg_temp.late_item('A') ->> 'method' || ' ' || ((pg_temp.late_item('A') ->> 'value')::numeric)::integer, 'explicit 3000',
  'the deliverable with its own value: explicit, its value');
select is(pg_temp.late_item('B') ->> 'method' || ' ' || ((pg_temp.late_item('B') ->> 'value')::numeric)::integer, 'excluded 0',
  'the "Not needed" one: excluded, nothing');
select ok((select bool_and(e ->> 'method' = 'split') and count(*) >= 2
                  and max((e ->> 'value')::numeric) = min((e ->> 'value')::numeric)
           from jsonb_array_elements(public.project_billing_read(pg_temp.fx('p'), pg_temp.fx('late')) -> 'items') e
           where e ->> 'title' not in ('A', 'B'))
          and (select sum((e ->> 'value')::numeric) from jsonb_array_elements(public.project_billing_read(pg_temp.fx('p'), pg_temp.fx('late')) -> 'items') e) = 9000,
  'the others share what is left evenly, and all add up to the amount');
select is(((public.project_billing_read(pg_temp.fx('p'), pg_temp.fx('late')) -> 'cycle' ->> 'potential')::numeric)::integer
          || ' ' || (public.project_billing_read(pg_temp.fx('p'), pg_temp.fx('late')) -> 'cycle' ->> 'plan_count'),
  '9000 ' || ((select count(*) from public.project_items i where i.cycle_id = pg_temp.fx('late')) - 1)::text,
  'the cycle''s Potential is its amount, the "Not needed" one not counted');

-- (d) The Today totals' Remaining and "No amount set" count are the Revenue page's for the month.
select pg_temp.as_member('admin');
select public.project_create(pg_temp.fx('client'), 'Unpriced 148', 'monthly', null, null, array['Stage 1'], array['X']);
select pg_temp.as_member('owner');
select is((public.revenue_month_totals() ->> 'remaining')::numeric,
  (select coalesce(sum((e ->> 'remaining')::numeric), 0) from jsonb_array_elements(public.revenue_month_read() -> 'cycles') e)
  + (select coalesce(sum(greatest((e ->> 'potential')::numeric - (e ->> 'achieved')::numeric, 0)), 0)
     from jsonb_array_elements(public.revenue_month_read() -> 'projects') e),
  'Today''s Remaining is the Revenue page''s');
select ok((public.revenue_month_totals() ->> 'no_amount')::integer >= 1
          and (public.revenue_month_totals() ->> 'no_amount')::integer =
              (select count(*) from jsonb_array_elements(public.revenue_month_read() -> 'cycles') e where e -> 'amount' = 'null'::jsonb)
              + (select count(*) from jsonb_array_elements(public.revenue_month_read() -> 'projects') e where e -> 'amount' = 'null'::jsonb),
  'and its "No amount set" count is the page''s lines with no amount');

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
