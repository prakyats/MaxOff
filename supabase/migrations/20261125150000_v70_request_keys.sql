-- v7.0 "Reliable anywhere", unit 2 (owner Q3, 14 Nov 2026: repeat-safe creates on everything
-- created often; decision sheet Part 2; DATA-MODEL §1 "v7.0 request keys"). Expand-only: one new
-- table, two internal helpers, eight new `_once` functions beside the functions they call (each
-- untouched), and a nullable `request_key` column with a partial unique index on the three plain
-- inserts. Nothing is dropped, renamed or rewritten; a rolled-back Worker still calls the old
-- functions, and a call with no key behaves exactly as before.
--
-- A phone that lost its signal after tapping Create cannot know whether the create landed. The
-- form sends one key per opening (`useRequestKey`); a second call with the same key returns what
-- the first made instead of making it again, so Retry is safe.

create table public.request_keys (
  member_id uuid not null references public.members (id),
  request_key uuid not null,
  kind text not null check (kind ~ '^[a-z_]{1,40}$'),
  entity_id uuid null,
  payload_hash text not null,
  created_at timestamptz not null default now(),
  primary key (member_id, request_key)
);

comment on table public.request_keys is
  'v7.0 unit 2: the repeat-safe creates'' ledger. One row per (member, key): what kind of create it '
  'was, a hash of its arguments and the id it made. Written only by app.request_claim() and '
  'app.request_done() inside a _once function''s transaction; no API access at all. Never deleted '
  '(rows are tiny; retention note in PROGRESS).';

alter table public.request_keys enable row level security;
-- No policy: nobody reads or writes it through the API, whatever their role.
revoke all on public.request_keys from public, anon, authenticated;

-- Claims a key for the caller. Null: the key is new, so the create goes ahead (and the row
-- stays only if the transaction commits). An id: the same create already landed with this key,
-- so it is returned instead of made twice. A key reused for another kind or other arguments is
-- refused (CONFLICT), as comp_leave_grant does for a different amount. A concurrent duplicate
-- waits on the key's row until the first commits or rolls back.
create function app.request_claim(p_key uuid, p_kind text, p_hash text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_member uuid := auth.uid();
  v_row public.request_keys;
begin
  if v_member is null then
    perform app.fail('UNAUTHENTICATED', 'Sign in again.');
  end if;
  insert into public.request_keys (member_id, request_key, kind, payload_hash)
  values (v_member, p_key, p_kind, p_hash)
  on conflict (member_id, request_key) do nothing;
  if found then
    return null;
  end if;
  select k.* into v_row from public.request_keys k
  where k.member_id = v_member and k.request_key = p_key;
  if v_row.kind <> p_kind or v_row.payload_hash <> p_hash then
    perform app.fail('CONFLICT', 'This was already sent with different details. Reload and check.');
  end if;
  if v_row.entity_id is null then
    perform app.fail('CONFLICT', 'This is still being saved. Reload and check.');
  end if;
  return v_row.entity_id;
end;
$$;

-- Records what the claimed key made, in the same transaction as the create.
create function app.request_done(p_key uuid, p_entity uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.request_keys k set entity_id = p_entity
  where k.member_id = auth.uid() and k.request_key = p_key;
end;
$$;

revoke all on function app.request_claim(uuid, text, text) from public, anon;
revoke all on function app.request_done(uuid, uuid) from public, anon;
grant execute on function app.request_claim(uuid, text, text) to authenticated, service_role;
grant execute on function app.request_done(uuid, uuid) to authenticated, service_role;

create function public.task_create_once(request_key uuid, title text, description text, task_type_id uuid, client_id uuid, priority public.priority, due_at timestamptz, assignee_ids uuid[], primary_owner_id uuid, approving_admin_id uuid default null, event_date date default null, event_start_at timestamptz default null, event_end_at timestamptz default null, location text default null, purpose text default null, stages text[] default '{}', custom_fields jsonb default '{}', reminder_rules jsonb default null, template_id uuid default null, warnings jsonb default '[]')
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_prior uuid;
  v_id uuid;
begin
  if task_create_once.request_key is not null then
    v_prior := app.request_claim(task_create_once.request_key, 'task_create', md5(jsonb_build_object('title', task_create_once.title, 'description', task_create_once.description, 'task_type_id', task_create_once.task_type_id, 'client_id', task_create_once.client_id, 'priority', task_create_once.priority, 'due_at', task_create_once.due_at, 'assignee_ids', task_create_once.assignee_ids, 'primary_owner_id', task_create_once.primary_owner_id, 'approving_admin_id', task_create_once.approving_admin_id, 'event_date', task_create_once.event_date, 'event_start_at', task_create_once.event_start_at, 'event_end_at', task_create_once.event_end_at, 'location', task_create_once.location, 'purpose', task_create_once.purpose, 'stages', task_create_once.stages, 'custom_fields', task_create_once.custom_fields, 'reminder_rules', task_create_once.reminder_rules, 'template_id', task_create_once.template_id, 'warnings', task_create_once.warnings)::text));
    if v_prior is not null then
      return v_prior;
    end if;
  end if;
  v_id := public.task_create(title => task_create_once.title, description => task_create_once.description, task_type_id => task_create_once.task_type_id, client_id => task_create_once.client_id, priority => task_create_once.priority, due_at => task_create_once.due_at, assignee_ids => task_create_once.assignee_ids, primary_owner_id => task_create_once.primary_owner_id, approving_admin_id => task_create_once.approving_admin_id, event_date => task_create_once.event_date, event_start_at => task_create_once.event_start_at, event_end_at => task_create_once.event_end_at, location => task_create_once.location, purpose => task_create_once.purpose, stages => task_create_once.stages, custom_fields => task_create_once.custom_fields, reminder_rules => task_create_once.reminder_rules, template_id => task_create_once.template_id, warnings => task_create_once.warnings);
  if task_create_once.request_key is not null then
    perform app.request_done(task_create_once.request_key, v_id);
  end if;
  return v_id;
end;
$$;

comment on function public.task_create_once(uuid, text, text, uuid, uuid, public.priority, timestamptz, uuid[], uuid, uuid, date, timestamptz, timestamptz, text, text, text[], jsonb, jsonb, uuid, jsonb) is
  'v7.0 unit 2: public.task_create() made repeat-safe. The same request_key (one per opened form) returns '
  'the id the first call made instead of making it again; the same key with other arguments is '
  'CONFLICT; a null key is exactly task_create(). Every check, history row and notification is task_create''s.';
revoke all on function public.task_create_once(uuid, text, text, uuid, uuid, public.priority, timestamptz, uuid[], uuid, uuid, date, timestamptz, timestamptz, text, text, text[], jsonb, jsonb, uuid, jsonb) from public, anon;
grant execute on function public.task_create_once(uuid, text, text, uuid, uuid, public.priority, timestamptz, uuid[], uuid, uuid, date, timestamptz, timestamptz, text, text, text[], jsonb, jsonb, uuid, jsonb) to authenticated, service_role;

create function public.task_request_create_once(request_key uuid, title text, details text default null, client_id uuid default null)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_prior uuid;
  v_id uuid;
begin
  if task_request_create_once.request_key is not null then
    v_prior := app.request_claim(task_request_create_once.request_key, 'task_request_create', md5(jsonb_build_object('title', task_request_create_once.title, 'details', task_request_create_once.details, 'client_id', task_request_create_once.client_id)::text));
    if v_prior is not null then
      return v_prior;
    end if;
  end if;
  v_id := public.task_request_create(title => task_request_create_once.title, details => task_request_create_once.details, client_id => task_request_create_once.client_id);
  if task_request_create_once.request_key is not null then
    perform app.request_done(task_request_create_once.request_key, v_id);
  end if;
  return v_id;
end;
$$;

comment on function public.task_request_create_once(uuid, text, text, uuid) is
  'v7.0 unit 2: public.task_request_create() made repeat-safe. The same request_key (one per opened form) returns '
  'the id the first call made instead of making it again; the same key with other arguments is '
  'CONFLICT; a null key is exactly task_request_create(). Every check, history row and notification is task_request_create''s.';
revoke all on function public.task_request_create_once(uuid, text, text, uuid) from public, anon;
grant execute on function public.task_request_create_once(uuid, text, text, uuid) to authenticated, service_role;

create function public.project_create_once(request_key uuid, client_id uuid, name text, recurrence public.recurrence, description text default null, delivery_date date default null, stages text[] default '{}', items text[] default '{}', template_id uuid default null, custom_fields jsonb default '{}'::jsonb)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_prior uuid;
  v_id uuid;
begin
  if project_create_once.request_key is not null then
    v_prior := app.request_claim(project_create_once.request_key, 'project_create', md5(jsonb_build_object('client_id', project_create_once.client_id, 'name', project_create_once.name, 'recurrence', project_create_once.recurrence, 'description', project_create_once.description, 'delivery_date', project_create_once.delivery_date, 'stages', project_create_once.stages, 'items', project_create_once.items, 'template_id', project_create_once.template_id, 'custom_fields', project_create_once.custom_fields)::text));
    if v_prior is not null then
      return v_prior;
    end if;
  end if;
  v_id := public.project_create(client_id => project_create_once.client_id, name => project_create_once.name, recurrence => project_create_once.recurrence, description => project_create_once.description, delivery_date => project_create_once.delivery_date, stages => project_create_once.stages, items => project_create_once.items, template_id => project_create_once.template_id, custom_fields => project_create_once.custom_fields);
  if project_create_once.request_key is not null then
    perform app.request_done(project_create_once.request_key, v_id);
  end if;
  return v_id;
end;
$$;

comment on function public.project_create_once(uuid, uuid, text, public.recurrence, text, date, text[], text[], uuid, jsonb) is
  'v7.0 unit 2: public.project_create() made repeat-safe. The same request_key (one per opened form) returns '
  'the id the first call made instead of making it again; the same key with other arguments is '
  'CONFLICT; a null key is exactly project_create(). Every check, history row and notification is project_create''s.';
revoke all on function public.project_create_once(uuid, uuid, text, public.recurrence, text, date, text[], text[], uuid, jsonb) from public, anon;
grant execute on function public.project_create_once(uuid, uuid, text, public.recurrence, text, date, text[], text[], uuid, jsonb) to authenticated, service_role;

create function public.project_create_grouped_once(request_key uuid, client_id uuid, name text, recurrence public.recurrence, description text default null, delivery_date date default null, stage_groups jsonb default '[]'::jsonb, deliverables jsonb default '[]'::jsonb, template_id uuid default null, custom_fields jsonb default '{}'::jsonb)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_prior uuid;
  v_id uuid;
begin
  if project_create_grouped_once.request_key is not null then
    v_prior := app.request_claim(project_create_grouped_once.request_key, 'project_create_grouped', md5(jsonb_build_object('client_id', project_create_grouped_once.client_id, 'name', project_create_grouped_once.name, 'recurrence', project_create_grouped_once.recurrence, 'description', project_create_grouped_once.description, 'delivery_date', project_create_grouped_once.delivery_date, 'stage_groups', project_create_grouped_once.stage_groups, 'deliverables', project_create_grouped_once.deliverables, 'template_id', project_create_grouped_once.template_id, 'custom_fields', project_create_grouped_once.custom_fields)::text));
    if v_prior is not null then
      return v_prior;
    end if;
  end if;
  v_id := public.project_create_grouped(client_id => project_create_grouped_once.client_id, name => project_create_grouped_once.name, recurrence => project_create_grouped_once.recurrence, description => project_create_grouped_once.description, delivery_date => project_create_grouped_once.delivery_date, stage_groups => project_create_grouped_once.stage_groups, deliverables => project_create_grouped_once.deliverables, template_id => project_create_grouped_once.template_id, custom_fields => project_create_grouped_once.custom_fields);
  if project_create_grouped_once.request_key is not null then
    perform app.request_done(project_create_grouped_once.request_key, v_id);
  end if;
  return v_id;
end;
$$;

comment on function public.project_create_grouped_once(uuid, uuid, text, public.recurrence, text, date, jsonb, jsonb, uuid, jsonb) is
  'v7.0 unit 2: public.project_create_grouped() made repeat-safe. The same request_key (one per opened form) returns '
  'the id the first call made instead of making it again; the same key with other arguments is '
  'CONFLICT; a null key is exactly project_create_grouped(). Every check, history row and notification is project_create_grouped''s.';
revoke all on function public.project_create_grouped_once(uuid, uuid, text, public.recurrence, text, date, jsonb, jsonb, uuid, jsonb) from public, anon;
grant execute on function public.project_create_grouped_once(uuid, uuid, text, public.recurrence, text, date, jsonb, jsonb, uuid, jsonb) to authenticated, service_role;

create function public.item_add_once(request_key uuid, cycle_id uuid, title text, planned_date date default null, notes text default null, custom_fields jsonb default '{}'::jsonb)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_prior uuid;
  v_id uuid;
begin
  if item_add_once.request_key is not null then
    v_prior := app.request_claim(item_add_once.request_key, 'item_add', md5(jsonb_build_object('cycle_id', item_add_once.cycle_id, 'title', item_add_once.title, 'planned_date', item_add_once.planned_date, 'notes', item_add_once.notes, 'custom_fields', item_add_once.custom_fields)::text));
    if v_prior is not null then
      return v_prior;
    end if;
  end if;
  v_id := public.item_add(cycle_id => item_add_once.cycle_id, title => item_add_once.title, planned_date => item_add_once.planned_date, notes => item_add_once.notes, custom_fields => item_add_once.custom_fields);
  if item_add_once.request_key is not null then
    perform app.request_done(item_add_once.request_key, v_id);
  end if;
  return v_id;
end;
$$;

comment on function public.item_add_once(uuid, uuid, text, date, text, jsonb) is
  'v7.0 unit 2: public.item_add() made repeat-safe. The same request_key (one per opened form) returns '
  'the id the first call made instead of making it again; the same key with other arguments is '
  'CONFLICT; a null key is exactly item_add(). Every check, history row and notification is item_add''s.';
revoke all on function public.item_add_once(uuid, uuid, text, date, text, jsonb) from public, anon;
grant execute on function public.item_add_once(uuid, uuid, text, date, text, jsonb) to authenticated, service_role;

create function public.item_add_grouped_once(request_key uuid, cycle_id uuid, title text, planned_date date default null, notes text default null, stage_groups jsonb default null, custom_fields jsonb default '{}'::jsonb)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_prior uuid;
  v_id uuid;
begin
  if item_add_grouped_once.request_key is not null then
    v_prior := app.request_claim(item_add_grouped_once.request_key, 'item_add_grouped', md5(jsonb_build_object('cycle_id', item_add_grouped_once.cycle_id, 'title', item_add_grouped_once.title, 'planned_date', item_add_grouped_once.planned_date, 'notes', item_add_grouped_once.notes, 'stage_groups', item_add_grouped_once.stage_groups, 'custom_fields', item_add_grouped_once.custom_fields)::text));
    if v_prior is not null then
      return v_prior;
    end if;
  end if;
  v_id := public.item_add_grouped(cycle_id => item_add_grouped_once.cycle_id, title => item_add_grouped_once.title, planned_date => item_add_grouped_once.planned_date, notes => item_add_grouped_once.notes, stage_groups => item_add_grouped_once.stage_groups, custom_fields => item_add_grouped_once.custom_fields);
  if item_add_grouped_once.request_key is not null then
    perform app.request_done(item_add_grouped_once.request_key, v_id);
  end if;
  return v_id;
end;
$$;

comment on function public.item_add_grouped_once(uuid, uuid, text, date, text, jsonb, jsonb) is
  'v7.0 unit 2: public.item_add_grouped() made repeat-safe. The same request_key (one per opened form) returns '
  'the id the first call made instead of making it again; the same key with other arguments is '
  'CONFLICT; a null key is exactly item_add_grouped(). Every check, history row and notification is item_add_grouped''s.';
revoke all on function public.item_add_grouped_once(uuid, uuid, text, date, text, jsonb, jsonb) from public, anon;
grant execute on function public.item_add_grouped_once(uuid, uuid, text, date, text, jsonb, jsonb) to authenticated, service_role;

create function public.client_create_once(request_key uuid, details jsonb)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_prior uuid;
  v_id uuid;
begin
  if client_create_once.request_key is not null then
    v_prior := app.request_claim(client_create_once.request_key, 'client_create', md5(jsonb_build_object('details', client_create_once.details)::text));
    if v_prior is not null then
      return v_prior;
    end if;
  end if;
  v_id := public.client_create(details => client_create_once.details);
  if client_create_once.request_key is not null then
    perform app.request_done(client_create_once.request_key, v_id);
  end if;
  return v_id;
end;
$$;

comment on function public.client_create_once(uuid, jsonb) is
  'v7.0 unit 2: public.client_create() made repeat-safe. The same request_key (one per opened form) returns '
  'the id the first call made instead of making it again; the same key with other arguments is '
  'CONFLICT; a null key is exactly client_create(). Every check, history row and notification is client_create''s.';
revoke all on function public.client_create_once(uuid, jsonb) from public, anon;
grant execute on function public.client_create_once(uuid, jsonb) to authenticated, service_role;

create function public.expense_claim_submit_once(request_key uuid, expense_date date, amount numeric, category_id uuid, note text, receipt_file_id uuid default null)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_prior uuid;
  v_id uuid;
begin
  if expense_claim_submit_once.request_key is not null then
    v_prior := app.request_claim(expense_claim_submit_once.request_key, 'expense_claim_submit', md5(jsonb_build_object('expense_date', expense_claim_submit_once.expense_date, 'amount', expense_claim_submit_once.amount, 'category_id', expense_claim_submit_once.category_id, 'note', expense_claim_submit_once.note, 'receipt_file_id', expense_claim_submit_once.receipt_file_id)::text));
    if v_prior is not null then
      return v_prior;
    end if;
  end if;
  v_id := public.expense_claim_submit(expense_date => expense_claim_submit_once.expense_date, amount => expense_claim_submit_once.amount, category_id => expense_claim_submit_once.category_id, note => expense_claim_submit_once.note, receipt_file_id => expense_claim_submit_once.receipt_file_id);
  if expense_claim_submit_once.request_key is not null then
    perform app.request_done(expense_claim_submit_once.request_key, v_id);
  end if;
  return v_id;
end;
$$;

comment on function public.expense_claim_submit_once(uuid, date, numeric, uuid, text, uuid) is
  'v7.0 unit 2: public.expense_claim_submit() made repeat-safe. The same request_key (one per opened form) returns '
  'the id the first call made instead of making it again; the same key with other arguments is '
  'CONFLICT; a null key is exactly expense_claim_submit(). Every check, history row and notification is expense_claim_submit''s.';
revoke all on function public.expense_claim_submit_once(uuid, date, numeric, uuid, text, uuid) from public, anon;
grant execute on function public.expense_claim_submit_once(uuid, date, numeric, uuid, text, uuid) to authenticated, service_role;

-- The plain inserts (PostgREST, under their own RLS): a key column and a partial unique index. A
-- second insert with the same key fails 23505 on the index, which the data layer reads as
-- "already saved" and answers with the first row.
alter table public.task_comments add column request_key uuid null;
create unique index task_comments_request_key_idx
  on public.task_comments (author_id, request_key) where request_key is not null;
comment on column public.task_comments.request_key is
  'v7.0 unit 2: the composer''s key (one per message typed): a resend after a lost reply is refused '
  'by task_comments_request_key_idx instead of posting the message twice. Null before v7.0.';

alter table public.client_contacts add column request_key uuid null;
create unique index client_contacts_request_key_idx
  on public.client_contacts (client_id, request_key) where request_key is not null;
comment on column public.client_contacts.request_key is
  'v7.0 unit 2: the Add contact form''s key (one per opening); see task_comments.request_key.';

alter table public.clients add column request_key uuid null;
create unique index clients_request_key_idx
  on public.clients (org_id, request_key) where request_key is not null;
comment on column public.clients.request_key is
  'v7.0 unit 2: the Owner''s New client form''s key (one per opening); see task_comments.request_key.';
