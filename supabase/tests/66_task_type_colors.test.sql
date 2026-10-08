-- Task 6.4b (migration task_type_colors; kickoff 6 decision 25): a task type's calendar colour is
-- data. (1) The palette: no red (or green, amber, grey); any palette colour, any case, or none.
-- (2) The launch types' defaults, on the seeded organization and on a new one. (3) Who may change
-- it: the Owner (settings.manage); an Admin's and a Crew member's update matches no row (RLS), a
-- signed-out caller is refused; the change is audited.
begin;
create extension if not exists pgtap with schema extensions;
select plan(16);

-- The seed's own Owner, an active Admin and an active permanent Crew member.
create temporary table fx (key text primary key, id uuid not null);
insert into fx select 'org', id from public.organizations limit 1;
insert into fx select 'owner', m.id from public.members m
  where m.role = 'owner' and m.status = 'active' and m.org_id = (select id from fx where key = 'org') limit 1;
insert into fx select 'admin1', m.id from public.members m
  where m.role = 'admin' and m.status = 'active' and m.org_id = (select id from fx where key = 'org') order by m.id limit 1;
insert into fx select 'staff1', m.id from public.members m
  where m.role = 'staff' and m.status = 'active' and m.engagement = 'permanent'
    and m.org_id = (select id from fx where key = 'org') order by m.id limit 1;
grant all on fx to authenticated, anon, service_role;
create function pg_temp.fx(k text) returns uuid language sql stable as $$ select id from fx where key = k; $$;
create function pg_temp.as_member(k text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', pg_temp.fx(k)::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', pg_temp.fx(k), 'role', 'authenticated')::text, true);
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
-- An UPDATE as the current role, answering how many rows RLS let it touch.
create function pg_temp.recolour(type_name text, c text) returns bigint language plpgsql as $$
declare n bigint;
begin
  update public.task_types set color = c where name = type_name and org_id = pg_temp.fx('org');
  get diagnostics n = row_count;
  return n;
end;
$$;
create function pg_temp.colour_of(type_name text) returns text language sql stable as $$
  select color from public.task_types where name = type_name and org_id = pg_temp.fx('org') and archived_at is null;
$$;

-- 1. The palette -----------------------------------------------------------------------------------
select throws_ok($$ update public.task_types set color = '#dc2626' where name = 'Meeting' $$, '23514', null,
  'red is not a type colour');
select throws_ok($$ update public.task_types set color = '#16a34a' where name = 'Meeting' $$, '23514', null,
  'nor the holiday''s green');
select throws_ok($$ update public.task_types set color = '#d97706' where name = 'Meeting' $$, '23514', null,
  'nor the due count''s amber');
select lives_ok($$ update public.task_types set color = '#C026D3' where name = 'Meeting' $$,
  'a palette colour in any case is accepted');
select lives_ok($$ update public.task_types set color = null where name = 'Meeting' $$,
  'and no colour (the default) is too');

-- 2. The launch types' colours -----------------------------------------------------------------------
select results_eq(
  $$ select t.name, t.color from public.task_types t
     where t.org_id = (select id from fx where key = 'org') and t.name in ('Shoot / Site Visit', 'Posting', 'Normal')
     order by t.name $$,
  $$ values ('Normal', '#0284c7'), ('Posting', '#0d9488'), ('Shoot / Site Visit', '#2563eb') $$,
  'the seeded organization''s launch types carry their colours');
savepoint fresh_org;
insert into public.organizations (id, name) values ('00000000-0000-4000-8000-0000000066ff', 'Colours Org');
select results_eq(
  $$ select t.name, t.color from public.task_types t
     where t.org_id = '00000000-0000-4000-8000-0000000066ff' order by t.position $$,
  $$ values ('Normal', '#0284c7'), ('Shoot / Site Visit', '#2563eb'), ('Meeting', '#7c3aed'), ('Posting', '#0d9488'),
            ('Review / Approval', '#4f46e5'), ('Other', '#0891b2'), ('Custom', '#9333ea') $$,
  'a new organization''s launch types come with their colours');
rollback to savepoint fresh_org;

-- 3. Who may change it -------------------------------------------------------------------------------
select pg_temp.as_member('owner');
select is(pg_temp.recolour('Meeting', '#0891b2'), 1::bigint, 'the Owner (settings.manage) recolours a type');
select is(pg_temp.colour_of('Meeting'), '#0891b2', 'and every member reads it back');
select throws_ok($$ update public.task_types set color = '#ef4444' where name = 'Meeting' $$, '23514', null,
  'the Owner cannot pick red either');
select pg_temp.as_member('admin1');
select is(pg_temp.recolour('Meeting', '#2563eb'), 0::bigint, 'an Admin''s update matches no row (RLS)');
select is(pg_temp.colour_of('Meeting'), '#0891b2', 'an Admin reads the colour');
select pg_temp.as_member('staff1');
select is(pg_temp.recolour('Meeting', '#2563eb'), 0::bigint, 'a Crew member''s update matches no row (RLS)');
select is(pg_temp.colour_of('Meeting'), '#0891b2', 'a Crew member reads the colour (the calendar draws it)');
select pg_temp.as_anon();
select throws_ok($$ update public.task_types set color = '#2563eb' where name = 'Meeting' $$, '42501', null,
  'a signed-out caller is refused');
select pg_temp.as_system();
select is((select count(*) from public.activity_log a
           where a.entity = 'task_types' and a.actor_id = pg_temp.fx('owner')
             and a.entity_id = (select id from public.task_types where name = 'Meeting' and org_id = pg_temp.fx('org') and archived_at is null)),
  1::bigint, 'the Owner''s change is audited (audit_row_change)');

select * from finish();
rollback;
