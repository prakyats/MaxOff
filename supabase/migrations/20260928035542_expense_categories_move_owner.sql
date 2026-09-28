-- 3bB review fix (architecture review 2026-09-28): the expense categories are the Owner's
--   (PRODUCT §4.18, PERMISSIONS §1 expenses.decide), but list_item_move() is security definer
--   and checked only lists.manage, so an Admin could reorder them over the API (the list guard
--   lets a transition function through). Re-created with the same signature and body, plus one
--   check: moving an expense_category entry needs expenses.decide.
--
-- EXPAND-ONLY (ARCHITECTURE §18): same signature, same grants; nothing main's app does changes
-- (main has no expense categories). Append-only: never edit once applied.

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
  if list_item_move.list_key = 'expense_category' and not app.has_permission('expenses.decide') then
    perform app.fail('FORBIDDEN', 'The expense categories are the Owner''s to change.');
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
  'lists.manage, and expenses.decide for the expense_category list (3b.3, the Owner''s). Swaps an '
  'entry''s position with the neighbour above or below it (archived entries skipped), in one UPDATE '
  'that touches no other column. Returns the neighbour''s id, or null when the entry is already at '
  'that end. NOT_FOUND for an unknown or archived entry.';
