-- 0.2 core base: extensions, the `app` schema and the helpers every later migration uses.
-- Documented in DATA-MODEL §0a and ARCHITECTURE §4.3 / §7. Append-only: never edit once applied.

-- Extensions -------------------------------------------------------------------------------

-- Scheduled jobs (WORKFLOWS §8). Jobs themselves are registered from task 2.5 on.
create extension if not exists pg_cron with schema pg_catalog;
grant usage on schema cron to postgres;

-- HTTP from the database (used by cron routes and push dispatch later).
create extension if not exists pg_net with schema extensions;

-- The `app` schema ---------------------------------------------------------------------------

create schema if not exists app;
comment on schema app is
  'MaxOff helpers shared by every module (time, triggers, errors). Not exposed through the API.';

revoke all on schema app from public;
grant usage on schema app to authenticated, service_role;

-- Every function in `app` is callable by authenticated and service_role only. Postgres grants
-- EXECUTE to PUBLIC on new functions, and a per-schema default privilege can't take that back,
-- so each function below revokes from public and grants explicitly. Later migrations do the same.

-- updated_at ---------------------------------------------------------------------------------

create or replace function app.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

revoke all on function app.set_updated_at() from public;
grant execute on function app.set_updated_at() to authenticated, service_role;

comment on function app.set_updated_at() is
  'BEFORE UPDATE row trigger that stamps updated_at. Attach with: '
  'create trigger set_updated_at before update on <table> for each row execute function app.set_updated_at();';

-- IST (ADR-0008) -----------------------------------------------------------------------------

create or replace function app.to_ist_date(ts timestamptz)
returns date
language sql
stable
strict
parallel safe
set search_path = ''
as $$
  select (ts at time zone 'Asia/Kolkata')::date;
$$;

revoke all on function app.to_ist_date(timestamptz) from public;
grant execute on function app.to_ist_date(timestamptz) to authenticated, service_role;

comment on function app.to_ist_date(timestamptz) is
  'The business date (Asia/Kolkata) of an instant. Stable, not immutable: named-zone conversion '
  'depends on the timezone database, so it cannot back an index or a generated column.';

create or replace function app.today_ist()
returns date
language sql
stable
parallel safe
set search_path = ''
as $$
  select app.to_ist_date(now());
$$;

revoke all on function app.today_ist() from public;
grant execute on function app.today_ist() to authenticated, service_role;

comment on function app.today_ist() is
  'Today''s business date in IST. The only way SQL gets "today"; never use now()::date.';

-- Errors (ARCHITECTURE §4.3) -----------------------------------------------------------------

create or replace function app.fail(code text, detail text default null)
returns void
language plpgsql
set search_path = ''
as $$
begin
  if detail is null then
    raise exception using errcode = 'P0001', message = code;
  end if;
  raise exception using errcode = 'P0001', message = code, detail = detail;
end;
$$;

revoke all on function app.fail(text, text) from public;
grant execute on function app.fail(text, text) to authenticated, service_role;

comment on function app.fail(text, text) is
  'Raises SQLSTATE P0001 with message = an error code from core/errors (INVALID_STATE, FORBIDDEN, '
  'REASON_REQUIRED, ...) and detail = the human reason. Transition functions call '
  'perform app.fail(''INVALID_STATE'', ''...'') so every error reaches the UI the same way.';
