-- v2.0 X3 step 3, a client's page (2026-11-06; DATA-MODEL §1 "v2.0 X3"; the advisor's standing rule
-- on #89: a read-only, security-invoker fold equal to the reads it replaces): the Overview's own
-- reads in one, so its first wave is six (ARCHITECTURE §19). The layout's reads (the client row,
-- the directory, the read receipt) stay as they are: a client row's prefetch runs the layout and
-- must read none of the page's data (P2; prefetch-likely.spec).
--
-- public.client_overview(p_client_id) → one jsonb object, each key exactly the rows one read gave:
--   contacts        listContacts: the client's contacts (every column), by created_at (then id);
--   owner_notes     getOwnerNotes: client_private.owner_notes. The key is present ONLY when the
--                   caller's RLS shows the client_private row (its policy: the Owner's alone), so
--                   an Admin or Crew gets no owner_notes key at all, never a null standing in.
--   open_tasks      countOpenTasksForClient: the tasks labelled with the client, not archived,
--                   not completed or cancelled, as the caller sees them (ADR-0005: the label is
--                   the only link);
--   client_fields   listDefinitions('client', {clientId}): field_definitions (every column) of
--   contact_fields  the entity, company-wide or this client's, by position (then id); the same
--                   for 'contact'.
-- Security invoker: every table's policy decides, as for the reads (a client the caller may not
-- see gives no contacts, no notes, 0 tasks). No money (client_private holds the Owner's notes
-- only; invariant 2's tables are untouched). Stable, empty search_path, authenticated only. A new
-- function: nothing existing changes (expand-only).
--
-- Used only by a client's Overview page (readClientOverview). No search, export, Realtime or
-- notification path reads it or carries its answer (advisor, #89).

create function public.client_overview(p_client_id uuid)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_overview jsonb;
  v_private public.client_private%rowtype;
begin
  if p_client_id is null then
    perform app.fail('VALIDATION', 'Choose a client.');
  end if;
  v_overview := jsonb_build_object(
    'contacts', coalesce((
      select jsonb_agg(to_jsonb(c) order by c.created_at, c.id)
      from public.client_contacts c where c.client_id = p_client_id), '[]'::jsonb),
    'open_tasks', (select count(*) from public.tasks t
                   where t.client_id = p_client_id and t.archived_at is null
                     and t.state not in ('completed', 'cancelled')),
    'client_fields', coalesce((
      select jsonb_agg(to_jsonb(f) order by f.position, f.id)
      from public.field_definitions f
      where f.entity = 'client' and (f.client_id is null or f.client_id = p_client_id)), '[]'::jsonb),
    'contact_fields', coalesce((
      select jsonb_agg(to_jsonb(f) order by f.position, f.id)
      from public.field_definitions f
      where f.entity = 'contact' and (f.client_id is null or f.client_id = p_client_id)), '[]'::jsonb)
  );
  -- The Owner's notes only where RLS shows the row: no key at all for anyone else.
  select * into v_private from public.client_private p where p.client_id = p_client_id limit 1;
  if found then
    v_overview := v_overview || jsonb_build_object('owner_notes', v_private.owner_notes);
  end if;
  return v_overview;
end;
$$;

comment on function public.client_overview(uuid) is
  'v2.0 X3: a client''s Overview reads in one: contacts (listContacts), owner_notes (getOwnerNotes; '
  'the key only where RLS shows the client_private row, the Owner''s alone), open_tasks (countOpenTasksForClient) and the client and '
  'contact field definitions (listDefinitions), each exactly as its read. Security invoker: every '
  'policy decides. Not the layout''s reads (a prefetch reads no page data). Used only by the client '
  'Overview page: no search, export, Realtime or notification path.';

revoke all on function public.client_overview(uuid) from public, anon, service_role;
grant execute on function public.client_overview(uuid) to authenticated;
