-- Phase 3 review: custom-field values and brand colours and fonts are checked by the database, so
-- the API cannot store what the app's forms would refuse (every path, allowed and denied).
begin;
create extension if not exists pgtap with schema extensions;
select plan(24);

-- The local seed holds an organization and sign-ins. Keep the organization; replace the people
-- with fixtures. Rolled back at the end. Order follows the foreign keys.
delete from public.attendance_events;
delete from public.attendance_days;
delete from public.leave_requests;
delete from public.session_events;
delete from public.activity_log;
delete from public.field_definitions;
delete from public.client_contacts;
delete from public.client_admin_assignments;
delete from public.client_brand;
delete from public.client_private;
delete from public.clients;
update public.organizations set logo_file_id = null;
delete from public.files;
delete from public.members;
delete from auth.identities;
delete from auth.users;
delete from public.activity_log; -- again: the deletes above were audited

create temporary table fx (key text primary key, id uuid not null);
insert into fx values
  ('owner',    '00000000-0000-4000-8000-000000000001'),
  ('admin',    '00000000-0000-4000-8000-000000000002'),
  ('client_a', '00000000-0000-4000-8000-0000000000a1'),
  ('client_b', '00000000-0000-4000-8000-0000000000b1'),
  ('contact',  '00000000-0000-4000-8000-0000000000d1'),
  ('site',     '00000000-0000-4000-8000-0000000000c1'),
  ('tier',     '00000000-0000-4000-8000-0000000000c2'),
  ('old',      '00000000-0000-4000-8000-0000000000c3'),
  ('only_b',   '00000000-0000-4000-8000-0000000000c4'),
  ('anniv',    '00000000-0000-4000-8000-0000000000c5');
insert into fx select 'org', id from public.organizations limit 1;
grant select on fx to authenticated, anon, service_role;

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

create function pg_temp.as_system() returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', '', true);
end;
$$;

insert into auth.users (id, email)
select id, key || '@example.com' from fx where key in ('owner', 'admin');
insert into public.members (id, org_id, full_name, email, role, status, joined_at) values
  (pg_temp.fx('owner'), pg_temp.fx('org'), 'Test Owner', 'owner@example.com', 'owner', 'active', now()),
  (pg_temp.fx('admin'), pg_temp.fx('org'), 'Test Admin', 'admin@example.com', 'admin', 'active', now());
insert into public.clients (id, org_id, name, admin_id) values
  (pg_temp.fx('client_a'), pg_temp.fx('org'), 'Client A', pg_temp.fx('admin')),
  (pg_temp.fx('client_b'), pg_temp.fx('org'), 'Client B', pg_temp.fx('admin'));
insert into public.client_contacts (id, client_id, name) values
  (pg_temp.fx('contact'), pg_temp.fx('client_a'), 'Mr A');
insert into public.field_definitions (id, org_id, entity, client_id, key, label, type, options, position) values
  (pg_temp.fx('site'),   pg_temp.fx('org'), 'client',  null, 'site', 'Website', 'url', '[]', 'a'),
  (pg_temp.fx('tier'),   pg_temp.fx('org'), 'client',  null, 'tier', 'Tier', 'select',
   '[{"key": "gold", "label": "Gold"}, {"key": "silver", "label": "Silver"}]', 'b'),
  (pg_temp.fx('old'),    pg_temp.fx('org'), 'client',  null, 'old', 'Old note', 'text', '[]', 'c'),
  (pg_temp.fx('only_b'), pg_temp.fx('org'), 'contact', pg_temp.fx('client_b'), 'birthday', 'Birthday', 'date', '[]', 'd'),
  (pg_temp.fx('anniv'),  pg_temp.fx('org'), 'contact', null, 'anniversary', 'Anniversary', 'date', '[]', 'e');
delete from public.activity_log;

-- Custom fields: the Admin through the API -----------------------------------------------------
select pg_temp.as_member('admin');
select lives_ok(
  $$ update public.clients set custom_fields = '{"site": "https://sharma.example", "tier": "gold", "old": "kept"}'
     where id = pg_temp.fx('client_a') $$,
  'Admin allowed: defined keys with values of their types');
select throws_ok(
  $$ update public.clients set custom_fields = custom_fields || '{"junk": "x"}' where id = pg_temp.fx('client_a') $$,
  'P0001', 'VALIDATION', 'a key with no definition is refused');
select throws_ok(
  $$ update public.clients set custom_fields = custom_fields || '{"site": "javascript:alert(1)"}' where id = pg_temp.fx('client_a') $$,
  'P0001', 'VALIDATION', 'a url field refuses javascript:');
select throws_ok(
  $$ update public.clients set custom_fields = custom_fields || '{"site": "http://sharma.example"}' where id = pg_temp.fx('client_a') $$,
  'P0001', 'VALIDATION', 'and http:// (https only, kickoff 3)');
select throws_ok(
  $$ update public.clients set custom_fields = custom_fields || '{"tier": "platinum"}' where id = pg_temp.fx('client_a') $$,
  'P0001', 'VALIDATION', 'a select takes one of its option keys only');
select throws_ok(
  $$ update public.clients set custom_fields = custom_fields || '{"old": 42}' where id = pg_temp.fx('client_a') $$,
  'P0001', 'VALIDATION', 'a text field refuses a number');
select throws_ok(
  $$ update public.clients set custom_fields = jsonb_build_object('old', repeat('x', 501)) where id = pg_temp.fx('client_a') $$,
  'P0001', 'VALIDATION', 'a text value over 500 characters is refused');
select throws_ok(
  $$ update public.clients set custom_fields = jsonb_build_object('pad', repeat('x', 40000)) where id = pg_temp.fx('client_a') $$,
  'P0001', 'VALIDATION', 'an object over 32 KB is refused');
select lives_ok(
  $$ update public.clients set custom_fields = custom_fields - 'tier' where id = pg_temp.fx('client_a') $$,
  'clearing a value is allowed');

-- An archived field keeps its value --------------------------------------------------------------
select pg_temp.as_system();
update public.field_definitions set archived_at = now() where id = pg_temp.fx('old');
select pg_temp.as_member('admin');
select lives_ok(
  $$ update public.clients set custom_fields = custom_fields || '{"tier": "silver"}' where id = pg_temp.fx('client_a') $$,
  'another field changes while an archived one keeps its value');
select is((select custom_fields ->> 'old' from public.clients where id = pg_temp.fx('client_a')), 'kept',
  'the archived value is still there');
select throws_ok(
  $$ update public.clients set custom_fields = custom_fields || '{"old": "changed"}' where id = pg_temp.fx('client_a') $$,
  'P0001', 'VALIDATION', 'an archived field is read-only (WORKFLOWS §4a)');

-- Contacts: scope follows the contact's client -----------------------------------------------------
select throws_ok(
  $$ update public.client_contacts set custom_fields = '{"birthday": "1990-01-01"}' where id = pg_temp.fx('contact') $$,
  'P0001', 'VALIDATION', 'a field scoped to another client is not a field here');
select throws_ok(
  $$ update public.client_contacts set custom_fields = '{"anniversary": "01/01/1990"}' where id = pg_temp.fx('contact') $$,
  'P0001', 'VALIDATION', 'a date is YYYY-MM-DD');
select lives_ok(
  $$ update public.client_contacts set custom_fields = '{"anniversary": "1990-01-01"}' where id = pg_temp.fx('contact') $$,
  'a global contact field with a date is allowed');

-- The value rules for the other types ---------------------------------------------------------------
select ok(app.custom_field_value_ok('number', '[]', '12.5'), 'number: a JSON number');
select ok(not app.custom_field_value_ok('number', '[]', '"12"'), 'number: never a string');
select ok(not app.custom_field_value_ok('rating', '[]', '6'), 'rating: 1 to 5');
select ok(app.custom_field_value_ok('color', '[]', '"#E11D48"') and not app.custom_field_value_ok('color', '[]', '"red"'),
  'color: #RRGGBB');
select ok(
  app.custom_field_value_ok('multi_select', '[{"key": "a"}, {"key": "b"}]', '["a", "b"]')
  and not app.custom_field_value_ok('multi_select', '[{"key": "a"}]', '["a", "z"]'),
  'multi_select: option keys only');

-- Brand colours and fonts -----------------------------------------------------------------------
select lives_ok(
  $$ update public.client_brand set colors = '[{"name": "Rose", "hex": "#E11D48"}]',
       fonts = '[{"family": "Inter", "usage": "Body"}, {"family": "Lora", "usage": null}]'
     where client_id = pg_temp.fx('client_a') $$,
  'Admin allowed: colours and fonts of the app''s shape');
select throws_ok(
  $$ update public.client_brand set colors = '[{"hex": "not-a-hex"}, 42]' where client_id = pg_temp.fx('client_a') $$,
  '23514', null, 'a colour without a name or a hex is refused');
select throws_ok(
  $$ update public.client_brand set colors = (select jsonb_agg(jsonb_build_object('name', 'c' || i, 'hex', '#000000')) from generate_series(1, 13) i)
     where client_id = pg_temp.fx('client_a') $$,
  '23514', null, 'thirteen colours are too many (12)');
select throws_ok(
  $$ update public.client_brand set fonts = '[{"family": "Inter", "usage": 42}]' where client_id = pg_temp.fx('client_a') $$,
  '23514', null, 'a font''s usage is text');

select pg_temp.as_system();
select * from finish();
rollback;
