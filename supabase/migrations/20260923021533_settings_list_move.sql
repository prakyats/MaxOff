-- 1.4 follow-ups from the architecture review of the Settings diff:
--   1. list_item_move(): reordering swaps two positions in ONE statement, touching no other
--      column. The first cut did it from TS by upserting both whole rows, which quietly put
--      back a rename or an archive another editor had just made (job titles are lists.manage,
--      so every Admin edits them and two editors is the normal case).
--   2. app.is_working_day() answered TRUE for every date when app.current_org_id() is null
--      (no organization, or more than one). A phase-2 job would then call a Sunday a working
--      day and mark the whole team absent. Null is the honest answer, and the safe one: a job
--      that tests `if app.is_working_day(d)` skips the check instead of accusing anyone.
-- Append-only: never edit once applied.

create or replace function app.is_working_day(d date)
returns boolean
language sql
stable
parallel safe
security definer
set search_path = ''
as $$
  select case
    when d is null then null
    -- No organization in scope: "unknown", never "yes" (DATA-MODEL §0a).
    when app.current_org_id() is null then null
    else not (
      exists (
        select 1
        from public.org_settings s
        where s.org_id = app.current_org_id()
          and extract(dow from d)::smallint = any (s.weekly_off_days)
      )
      or exists (
        select 1
        from public.holidays h
        where h.org_id = app.current_org_id() and h.date = d
      )
    )
  end;
$$;

comment on function app.is_working_day(date) is
  'False when the date falls on a weekly off day (org_settings.weekly_off_days, 0 = Sunday) or on '
  'a holiday, true otherwise. Null in, null out, and null when no single organization is in '
  'scope: callers must treat null as "do not act". Scoped by app.current_org_id(). The TS mirror '
  'is core/time isWorkingDay().';

-- list_item_move ---------------------------------------------------------------------------------
-- Moving one step is a swap of two `position` values. Doing it in one UPDATE keeps the order from
-- ever being half-written and, unlike writing whole rows back, cannot revert a concurrent edit.
-- A plain edit, not a workflow transition (ADR-0006), so the audit trigger's two 'update' rows
-- with position in the diff are the record; the permission is checked here because a security
-- definer function is outside RLS.
create or replace function public.list_item_move(list_key text, item_id uuid, direction text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_item public.list_items;
  v_neighbour public.list_items;
begin
  select m.org_id into v_org from app.current_member() m;
  if v_org is null then
    perform app.fail('UNAUTHENTICATED', 'Your account is not active.');
  end if;
  if not app.has_permission('lists.manage') then
    perform app.fail('FORBIDDEN', 'You cannot edit this list.');
  end if;
  if direction not in ('up', 'down') then
    perform app.fail('VALIDATION', 'Move an entry up or down.');
  end if;

  select li.* into v_item
  from public.list_items li
  where li.id = item_id
    and li.org_id = v_org
    and li.list_key = list_item_move.list_key
    and li.archived_at is null
  for update;
  if v_item.id is null then
    perform app.fail('NOT_FOUND', 'This entry is no longer in the list.');
  end if;

  -- The neighbour is the next entry the Owner actually sees, so archived ones are skipped.
  if direction = 'up' then
    select li.* into v_neighbour
    from public.list_items li
    where li.org_id = v_org
      and li.list_key = list_item_move.list_key
      and li.archived_at is null
      and li.position < v_item.position
    order by li.position desc
    limit 1
    for update;
  else
    select li.* into v_neighbour
    from public.list_items li
    where li.org_id = v_org
      and li.list_key = list_item_move.list_key
      and li.archived_at is null
      and li.position > v_item.position
    order by li.position asc
    limit 1
    for update;
  end if;

  -- Already at that end: nothing to do, and the caller is not an error case.
  if v_neighbour.id is null then
    return null;
  end if;

  update public.list_items li
  set position = case li.id when v_item.id then v_neighbour.position else v_item.position end
  where li.id in (v_item.id, v_neighbour.id);

  return v_neighbour.id;
end;
$$;

revoke all on function public.list_item_move(text, uuid, text) from public, anon;
grant execute on function public.list_item_move(text, uuid, text) to authenticated, service_role;

comment on function public.list_item_move(text, uuid, text) is
  'lists.manage. Swaps an entry''s position with the neighbour above or below it (archived '
  'entries skipped), in one UPDATE that touches no other column. Returns the neighbour''s id, or '
  'null when the entry is already at that end. NOT_FOUND for an unknown or archived entry.';
