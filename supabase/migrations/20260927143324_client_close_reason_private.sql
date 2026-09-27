-- Phase 3 review (owner, 2026-09-27): the client close reason is the Owner's.
-- client_close() kept the reason in the 'closed' activity entry's meta, and the client's Admin
-- reads that entry under activity_log_select_clients, so the reason reached them through the API.
-- The reason moves to an Owner-only table keyed by the entry; the entry keeps only from_state.
-- Expand-only (ARCHITECTURE §18): clients and client_close() are phase-3 only, nothing on main
-- reads them.

create table public.client_close_reasons (
  activity_id bigint primary key references public.activity_log (id) on delete cascade,
  org_id uuid not null references public.organizations (id),
  client_id uuid not null references public.clients (id) on delete cascade,
  reason text not null check (length(reason) between 1 and 1000),
  created_at timestamptz not null default now()
);
comment on table public.client_close_reasons is
  'Owner-only (phase 3 review): the reason given to client_close(), one row per ''closed'' '
  'activity entry that had one. Written only by client_close(); never rewritten.';
-- Cascades: neither parent is ever deleted through the API (activity_log is append-only, a client
-- is closed, not deleted); only a permanent delete by the database owner would take the reason.
create index client_close_reasons_client_idx on public.client_close_reasons (client_id);

alter table public.client_close_reasons enable row level security;
revoke all on public.client_close_reasons from anon;
revoke insert, update, delete, truncate, references, trigger on public.client_close_reasons
  from authenticated;

create policy client_close_reasons_select on public.client_close_reasons for select to authenticated
  using (org_id = (select m.org_id from app.current_member() m)
         and (select app.has_permission('clients.manage')));

-- Reasons already written move out of the activity entries (same content, now Owner-only).
insert into public.client_close_reasons (activity_id, org_id, client_id, reason, created_at)
select l.id, l.org_id, l.entity_id, l.meta ->> 'reason', l.at
from public.activity_log l
where l.entity = 'clients' and l.action = 'closed'
  and nullif(btrim(coalesce(l.meta ->> 'reason', '')), '') is not null;

update public.activity_log
set meta = meta - 'reason'
where entity = 'clients' and action = 'closed' and meta ? 'reason';

create or replace function public.client_close(client_id uuid, reason text default null)
returns public.client_state
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid;
  v_org uuid;
  v_client public.clients;
  v_reason text := nullif(btrim(coalesce(reason, '')), '');
  v_entry bigint;
begin
  select r.caller_id, r.org_id into v_caller, v_org from app.require_client_manager() r;
  if length(v_reason) > 1000 then
    perform app.fail('VALIDATION', 'Keep the reason under 1000 characters.');
  end if;
  select c.* into v_client from public.clients c
  where c.id = client_close.client_id and c.org_id = v_org for update;
  if v_client.id is null then
    perform app.fail('NOT_FOUND', 'This client does not exist.');
  end if;
  if v_client.state not in ('active', 'paused') then
    perform app.fail('INVALID_STATE', 'Only an active or paused client can be closed.');
  end if;

  perform set_config('app.audit_override', jsonb_build_object(
    'action', 'closed',
    'meta', jsonb_build_object('from_state', v_client.state)
  )::text, true);
  update public.clients set state = 'inactive' where id = v_client.id;

  if v_reason is not null then
    -- The entry the audit trigger just wrote (the client row is locked, so it is the latest).
    select l.id into v_entry from public.activity_log l
    where l.entity = 'clients' and l.entity_id = v_client.id and l.action = 'closed'
    order by l.id desc limit 1;
    insert into public.client_close_reasons (activity_id, org_id, client_id, reason)
    values (v_entry, v_org, v_client.id, v_reason);
  end if;
  return 'inactive';
end;
$$;

comment on function public.client_close(uuid, text) is
  'clients.manage. active | paused → inactive, the end state (kickoff 3): readable and searchable, '
  'no new work until reactivated. The optional reason is the Owner''s: kept in client_close_reasons '
  'keyed by the activity entry, never in the entry''s meta. Audit action: closed (meta.from_state).';
