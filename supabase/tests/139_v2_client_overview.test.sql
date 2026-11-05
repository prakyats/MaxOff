-- v2.0 X3 step 3, a client's page (2026-11-06, migration client_overview; DATA-MODEL §1 "v2.0 X3"):
-- public.client_overview(client_id) is the Overview's five reads in one. Who may call it
-- (authenticated only), security invoker, and for the Owner, the client's Admin, another Admin and
-- Crew every key equal to the read it replaces (RLS deciding): the Owner's notes reach the Owner
-- alone, never an Admin; a client the caller may not see gives nothing. Neutral names only.
begin;
create extension if not exists pgtap with schema extensions;
select plan(22);

create temporary table fx (key text primary key, id uuid not null);
insert into fx values
  ('owner',  '10000000-0000-4000-8000-000000000001'),
  ('admin',  '10000000-0000-4000-8000-000000000002'),
  ('staff',  '10000000-0000-4000-8000-000000000003'),
  ('client', '00000000-0000-4000-8000-000000013901');
insert into fx select 'org', id from public.organizations limit 1;
insert into fx select 'type', id from public.task_types where org_id = (select id from fx where key = 'org') and kind = 'normal' order by position limit 1;
insert into fx select 'admin2', m.id from public.members m
  where m.role = 'admin' and m.status = 'active' and m.id <> '10000000-0000-4000-8000-000000000002' order by m.id limit 1;
grant select on fx to authenticated, anon;

create function pg_temp.fx(k text) returns uuid language sql stable as $$ select id from fx where key = k; $$;
create function pg_temp.as_member(k text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', pg_temp.fx(k)::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', pg_temp.fx(k), 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end;
$$;
-- The five reads, as the caller (the same columns, filter and order; an id breaks a tie).
create function pg_temp.api(key text, p uuid) returns jsonb language plpgsql stable as $$
declare v jsonb;
begin
  case key
    when 'contacts' then
      select coalesce(jsonb_agg(to_jsonb(c) order by c.created_at, c.id), '[]') into v from public.client_contacts c where c.client_id = p;
    when 'owner_notes' then select to_jsonb(x.owner_notes) into v from public.client_private x where x.client_id = p;
      if not found then return null; end if;
    when 'open_tasks' then
      select to_jsonb(count(*)) into v from public.tasks t
      where t.client_id = p and t.archived_at is null and t.state not in ('completed', 'cancelled');
    when 'client_fields' then
      select coalesce(jsonb_agg(to_jsonb(f) order by f.position, f.id), '[]') into v from public.field_definitions f
      where f.entity = 'client' and (f.client_id is null or f.client_id = p);
    when 'contact_fields' then
      select coalesce(jsonb_agg(to_jsonb(f) order by f.position, f.id), '[]') into v from public.field_definitions f
      where f.entity = 'contact' and (f.client_id is null or f.client_id = p);
  end case;
  return coalesce(v, 'null'::jsonb);
end;
$$;
create function pg_temp.differing(p uuid) returns text language sql stable as $$
  select coalesce(string_agg(k, ', '), 'none')
  from unnest(array['contacts', 'owner_notes', 'open_tasks', 'client_fields', 'contact_fields']) k
  where public.client_overview(p)->k is distinct from pg_temp.api(k, p);
$$;

-- Fixtures: the Admin's client, two contacts, the Owner's notes, a client field of its own, two open
-- labelled tasks and a completed one.
insert into public.clients (id, org_id, name, state, admin_id, activated_at) values
  (pg_temp.fx('client'), pg_temp.fx('org'), 'Overview client 139', 'active', pg_temp.fx('admin'), now());
insert into public.client_contacts (client_id, name, created_at) values
  (pg_temp.fx('client'), 'First contact 139', now() - interval '2 minutes'),
  (pg_temp.fx('client'), 'Second contact 139', now() - interval '1 minute');
insert into public.client_private (client_id, owner_notes) values (pg_temp.fx('client'), 'Owner only 139')
  on conflict (client_id) do update set owner_notes = excluded.owner_notes;
insert into public.field_definitions (org_id, entity, client_id, key, label, type, position) values
  (pg_temp.fx('org'), 'client', pg_temp.fx('client'), 'shoot_style_139', 'Shoot style', 'text', 'zz');
insert into public.tasks (org_id, title, task_type_id, priority, due_at, state, created_by, primary_owner_id, client_id) values
  (pg_temp.fx('org'), 'Labelled 139 a', pg_temp.fx('type'), 'medium', now() + interval '3 days', 'todo', pg_temp.fx('owner'), pg_temp.fx('staff'), pg_temp.fx('client')),
  (pg_temp.fx('org'), 'Labelled 139 b', pg_temp.fx('type'), 'medium', now() + interval '3 days', 'todo', pg_temp.fx('owner'), pg_temp.fx('staff'), pg_temp.fx('client'));
insert into public.tasks (org_id, title, task_type_id, priority, due_at, state, created_by, primary_owner_id, client_id, completed_at) values
  (pg_temp.fx('org'), 'Labelled 139 done', pg_temp.fx('type'), 'medium', now() - interval '3 days', 'completed', pg_temp.fx('owner'), pg_temp.fx('staff'), pg_temp.fx('client'), now());
create temporary table d as select pg_temp.fx('client') as client;
grant select on d to authenticated;

-- 1. Who may call it --------------------------------------------------------------------------------
select has_function('public', 'client_overview', array['uuid'], 'client_overview(uuid) exists');
select is((select prosecdef from pg_proc where oid = 'public.client_overview(uuid)'::regprocedure), false,
  'it runs as the caller (security invoker): every policy decides');
select ok(has_function_privilege('authenticated', 'public.client_overview(uuid)', 'execute'), 'authenticated may call it');
select ok(not has_function_privilege('anon', 'public.client_overview(uuid)', 'execute'), 'anon may not');
select ok(not has_function_privilege('service_role', 'public.client_overview(uuid)', 'execute'), 'service_role may not');

-- 2. The Owner ----------------------------------------------------------------------------------------
select pg_temp.as_member('owner');
select is(pg_temp.differing((select client from d)), 'none', 'Owner: every key equals its read');
select is(public.client_overview((select client from d))->>'owner_notes', 'Owner only 139', 'Owner: his notes');
select is(public.client_overview((select client from d))->'owner_notes',
  (select to_jsonb(x.owner_notes) from public.client_private x where x.client_id = (select client from d)), 'Owner: equal to the row');
select is((public.client_overview((select client from d))->>'open_tasks')::int, 2, 'Owner: the two open labelled tasks');
select is(public.client_overview((select client from d))->'contacts'->0->>'name', 'First contact 139', 'Owner: the contacts, oldest first');
select ok(public.client_overview((select client from d))->'client_fields' @> '[{"key": "shoot_style_139"}]'::jsonb,
  'Owner: the client''s own field');
select throws_ok($$ select public.client_overview(null) $$, 'P0001', null, 'no client: refused');

-- 3. The client's Admin: everything but the Owner's notes -----------------------------------------------
select pg_temp.as_member('admin');
select is(pg_temp.differing((select client from d)), 'none', 'the client''s Admin: every key equals its read');
select ok(not (public.client_overview((select client from d)) ? 'owner_notes'), 'the client''s Admin: no owner_notes key at all');
select ok(public.client_overview((select client from d))::text not like '%Owner only 139%', 'the client''s Admin: the note''s words nowhere');
select is(jsonb_array_length(public.client_overview((select client from d))->'contacts'), 2, 'the client''s Admin: the contacts');

-- 4. Another Admin and Crew: as their reads show them -------------------------------------------------
select pg_temp.as_member('admin2');
select is(pg_temp.differing((select client from d)), 'none', 'another Admin: every key equals its read');
select is(jsonb_array_length(public.client_overview((select client from d))->'contacts'), 0, 'another Admin: no contacts');
select ok(not (public.client_overview((select client from d)) ? 'owner_notes'), 'another Admin: no owner_notes key at all');
select pg_temp.as_member('staff');
select is(pg_temp.differing((select client from d)), 'none', 'Crew: every key equals its read');
select ok(not (public.client_overview((select client from d)) ? 'owner_notes'), 'Crew: no owner_notes key at all');
select is(jsonb_array_length(public.client_overview((select client from d))->'contacts'), 0, 'Crew: no contacts');

select * from finish();
rollback;
