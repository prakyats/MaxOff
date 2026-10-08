-- Task 6.4b, the calendar rework (kickoff 6 decision 25, owner 2026-10-08): task type colours are
-- data. The column exists since 4A (`task_types.color text null`, a #rrggbb check, in the API UPDATE
-- grant) and nothing wrote it, so this extends it rather than adding another:
-- * the curated palette: eight colours, **no red** (red stays for overdue and commit actions,
--   ARCHITECTURE §14.1), no green (the holiday strip's) and no amber or grey (the due count's and the
--   leave strip's). `task_types_color_palette`, NOT VALID: it checks every new write and leaves any
--   value written before it in place (expand-only; the app draws a value outside the palette in the
--   default colour). Stored lower-case.
-- * defaults for the seven launch types (by their seeded name and kind, only where no colour is set),
--   each update audited as 'backfilled'; and app.seed_org_task_types() seeds them for a new
--   organization.
-- Edited in Settings → Task types (settings.manage, the Owner: the existing RLS policy and
-- app.task_types_owner_guard()).

alter table public.task_types
  add constraint task_types_color_palette check (
    color is null
    or lower(color) in ('#2563eb', '#4f46e5', '#7c3aed', '#9333ea', '#c026d3', '#0d9488', '#0891b2', '#0284c7')
  ) not valid;

comment on constraint task_types_color_palette on public.task_types is
  'Kickoff 6 decision 25: a type''s colour is one of the curated palette (blue, indigo, violet, '
  'purple, magenta, teal, cyan, sky; never red, green, amber or grey, which the calendar keeps for '
  'overdue, holidays, due counts and leave). NOT VALID: earlier values stay; the app draws them in '
  'the default colour.';

comment on column public.task_types.color is
  'The type''s colour on the calendar (kickoff 6 decision 25): one of the palette '
  '(task_types_color_palette), lower-case #rrggbb; null = the default (blue).';

do $$
declare
  v_row record;
begin
  for v_row in
    select t.id, d.color
    from public.task_types t
    join (values ('Normal', 'normal', '#0284c7'),
                 ('Shoot / Site Visit', 'event', '#2563eb'),
                 ('Meeting', 'event', '#7c3aed'),
                 ('Posting', 'event', '#0d9488'),
                 ('Review / Approval', 'normal', '#4f46e5'),
                 ('Other', 'normal', '#0891b2'),
                 ('Custom', 'custom', '#9333ea')) as d(name, kind, color)
      on t.name = d.name and t.kind::text = d.kind
    where t.color is null
    order by t.id
  loop
    perform set_config('app.audit_override', jsonb_build_object(
      'action', 'backfilled',
      'meta', jsonb_build_object('system', true, 'from', 'kickoff 6 decision 25: the launch types'' colours'))::text, true);
    update public.task_types set color = v_row.color where id = v_row.id;
  end loop;
  perform set_config('app.audit_override', '', true);
end;
$$;

-- A new organization's launch types come with their colours.
create or replace function app.seed_org_task_types()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.task_types (org_id, name, kind, shows_on_calendar, has_location, position, color)
  values (new.id, 'Normal', 'normal', false, false, 'a0', '#0284c7'),
         (new.id, 'Shoot / Site Visit', 'event', true, true, 'a1', '#2563eb'),
         (new.id, 'Meeting', 'event', true, true, 'a2', '#7c3aed'),
         (new.id, 'Posting', 'event', true, false, 'a3', '#0d9488'),
         (new.id, 'Review / Approval', 'normal', false, false, 'a4', '#4f46e5'),
         (new.id, 'Other', 'normal', false, false, 'a5', '#0891b2'),
         (new.id, 'Custom', 'custom', false, false, 'a6', '#9333ea');
  return null;
end;
$$;

comment on function app.seed_org_task_types() is
  'AFTER INSERT on organizations: the launch task types (PRODUCT §4.6) with their calendar colours '
  '(kickoff 6 decision 25). Rows, not code: the Owner renames, recolours or archives them in Settings.';
