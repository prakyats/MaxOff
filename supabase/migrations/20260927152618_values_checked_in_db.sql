-- Phase 3 review (security + architecture should-fix, owner: fix now, 2026-09-27): custom-field
-- values and brand colours and fonts were checked only by the app's zod, and both columns are
-- granted to the API, so an Admin could store any shape and any size through PostgREST (keys with
-- no definition, which also slip past the "type is locked once a value exists" rule; wrong types;
-- megabytes of text). The database now checks what the app checks:
--   * clients.custom_fields and client_contacts.custom_fields: at most 32 KB, and every key the
--     write adds or changes has an active definition in scope (global or this client's) and a
--     value of its type (the same rules as core/custom-fields' valueSchema; a url is https only).
--     Keys the write leaves as they were pass, so an archived field keeps its value (WORKFLOWS §4a).
--   * client_brand.colors and fonts: at most 12 and 6 entries of the shape the app writes.
-- Transition functions and the seed (app.in_transition()) are trusted, as everywhere else.
-- Expand-only (ARCHITECTURE §18): the client tables are phase-3 only.

-- One value against its definition: true when it is a value of that type ("" and null never
-- reach here: the app leaves an empty field out of the object).
create or replace function app.custom_field_value_ok(p_type public.field_type, p_options jsonb, p_value jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_text text := case when jsonb_typeof(p_value) = 'string' then p_value #>> '{}' end;
  v_keys text[] := array(select o ->> 'key' from jsonb_array_elements(p_options) o);
begin
  if jsonb_typeof(p_value) = 'null' then
    return true;
  end if;
  case p_type
    when 'text' then return v_text is not null and length(v_text) <= 500;
    when 'long_text' then return v_text is not null and length(v_text) <= 5000;
    when 'number' then return jsonb_typeof(p_value) = 'number';
    when 'date' then return v_text ~ '^\d{4}-\d{2}-\d{2}$';
    when 'datetime' then return v_text is not null and length(v_text) between 10 and 40;
    when 'checkbox' then return jsonb_typeof(p_value) = 'boolean';
    when 'select' then return v_text = any (v_keys);
    when 'multi_select' then
      return jsonb_typeof(p_value) = 'array'
        and jsonb_array_length(p_value) <= coalesce(array_length(v_keys, 1), 0)
        and not exists (
          select 1 from jsonb_array_elements(p_value) e
          where jsonb_typeof(e) <> 'string' or not ((e #>> '{}') = any (v_keys))
        );
    when 'url' then return v_text ~ '^https://\S+$' and length(v_text) <= 500;
    when 'email' then return v_text ~ '^[^@\s]+@[^@\s]+$' and length(v_text) <= 254;
    when 'phone' then return v_text is not null and length(btrim(v_text)) between 3 and 32;
    when 'color' then return v_text ~ '^#[0-9A-Fa-f]{6}$';
    when 'member' then
      return v_text ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
    when 'rating' then
      return jsonb_typeof(p_value) = 'number'
        and (p_value #>> '{}')::numeric in (1, 2, 3, 4, 5);
    else return false;
  end case;
end;
$$;

revoke all on function app.custom_field_value_ok(public.field_type, jsonb, jsonb) from public;
grant execute on function app.custom_field_value_ok(public.field_type, jsonb, jsonb) to authenticated, service_role;

comment on function app.custom_field_value_ok(public.field_type, jsonb, jsonb) is
  'One custom-field value against its type and options, as core/custom-fields valueSchema checks '
  'it (text 500, long text 5000, url https only, colour #RRGGBB, rating 1-5; null is no value).';

-- BEFORE INSERT OR UPDATE OF custom_fields on clients. Not security definer, for the same reason
-- as files_reference_guard: inside a definer app.in_transition() is always true. It reads the
-- definitions under RLS, so a field the caller cannot see is not one they can write.
create or replace function app.client_custom_fields_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_old jsonb := case when tg_op = 'UPDATE' then old.custom_fields else '{}'::jsonb end;
  v_key text;
  v_value jsonb;
  v_def public.field_definitions;
begin
  if octet_length(new.custom_fields::text) > 32768 then
    perform app.fail('VALIDATION', 'These custom fields are too long.');
  end if;
  if app.in_transition() then
    return new;
  end if;
  for v_key, v_value in select e.key, e.value from jsonb_each(new.custom_fields) e loop
    continue when v_old -> v_key is not distinct from v_value;
    select d.* into v_def from public.field_definitions d
    where d.entity = 'client' and d.key = v_key and d.archived_at is null
      and d.org_id = new.org_id
      and (d.client_id is null or d.client_id = new.id)
    order by d.client_id nulls last
    limit 1;
    if v_def.id is null then
      perform app.fail('VALIDATION', format('There is no field "%s" here.', v_key));
    end if;
    if not app.custom_field_value_ok(v_def.type, v_def.options, v_value) then
      perform app.fail('VALIDATION', format('%s: this is not a valid value.', v_def.label));
    end if;
  end loop;
  return new;
end;
$$;

revoke all on function app.client_custom_fields_guard() from public;
grant execute on function app.client_custom_fields_guard() to authenticated, service_role;

comment on function app.client_custom_fields_guard() is
  'BEFORE INSERT OR UPDATE OF custom_fields on clients (phase 3 review): at most 32 KB; every key the write adds or changes needs an '
  'active definition in scope (global or this client''s) and a value of its type. Unchanged keys '
  'pass (an archived field keeps its value). Transition functions and the seed are trusted.';

-- The same for client_contacts, whose organization and client scope are its client's.
create or replace function app.contact_custom_fields_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_old jsonb := case when tg_op = 'UPDATE' then old.custom_fields else '{}'::jsonb end;
  v_org uuid;
  v_key text;
  v_value jsonb;
  v_def public.field_definitions;
begin
  if octet_length(new.custom_fields::text) > 32768 then
    perform app.fail('VALIDATION', 'These custom fields are too long.');
  end if;
  if app.in_transition() then
    return new;
  end if;
  select c.org_id into v_org from public.clients c where c.id = new.client_id;
  for v_key, v_value in select e.key, e.value from jsonb_each(new.custom_fields) e loop
    continue when v_old -> v_key is not distinct from v_value;
    select d.* into v_def from public.field_definitions d
    where d.entity = 'contact' and d.key = v_key and d.archived_at is null
      and d.org_id = v_org
      and (d.client_id is null or d.client_id = new.client_id)
    order by d.client_id nulls last
    limit 1;
    if v_def.id is null then
      perform app.fail('VALIDATION', format('There is no field "%s" here.', v_key));
    end if;
    if not app.custom_field_value_ok(v_def.type, v_def.options, v_value) then
      perform app.fail('VALIDATION', format('%s: this is not a valid value.', v_def.label));
    end if;
  end loop;
  return new;
end;
$$;

revoke all on function app.contact_custom_fields_guard() from public;
grant execute on function app.contact_custom_fields_guard() to authenticated, service_role;

comment on function app.contact_custom_fields_guard() is
  'app.client_custom_fields_guard() for client_contacts, whose organization is the client''s.';

create trigger custom_fields_guard before insert or update of custom_fields on public.clients
  for each row execute function app.client_custom_fields_guard();
create trigger custom_fields_guard before insert or update of custom_fields on public.client_contacts
  for each row execute function app.contact_custom_fields_guard();

-- Brand colours and fonts: the shape BrandColor / BrandFont write, and the app's counts.
create or replace function app.brand_colors_ok(p_colors jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select jsonb_typeof(p_colors) = 'array'
    and jsonb_array_length(p_colors) <= 12
    and not exists (
      select 1 from jsonb_array_elements(p_colors) e
      where jsonb_typeof(e) <> 'object'
         or jsonb_typeof(e -> 'name') is distinct from 'string'
         or length(btrim(e ->> 'name')) not between 1 and 60
         or coalesce(e ->> 'hex', '') !~ '^#[0-9A-Fa-f]{6}$'
    );
$$;

create or replace function app.brand_fonts_ok(p_fonts jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select jsonb_typeof(p_fonts) = 'array'
    and jsonb_array_length(p_fonts) <= 6
    and not exists (
      select 1 from jsonb_array_elements(p_fonts) e
      where jsonb_typeof(e) <> 'object'
         or jsonb_typeof(e -> 'family') is distinct from 'string'
         or length(btrim(e ->> 'family')) not between 1 and 80
         or coalesce(jsonb_typeof(e -> 'usage'), 'null') not in ('null', 'string')
         or length(coalesce(e ->> 'usage', '')) > 80
    );
$$;

revoke all on function app.brand_colors_ok(jsonb) from public;
revoke all on function app.brand_fonts_ok(jsonb) from public;
grant execute on function app.brand_colors_ok(jsonb) to authenticated, service_role;
grant execute on function app.brand_fonts_ok(jsonb) to authenticated, service_role;

alter table public.client_brand
  add constraint client_brand_colors_shape check (app.brand_colors_ok(colors)),
  add constraint client_brand_fonts_shape check (app.brand_fonts_ok(fonts));
