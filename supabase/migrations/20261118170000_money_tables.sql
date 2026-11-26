-- 9.1 (v2.1 "Money in"): the Owner-only money tables, their transition functions and the revenue views
-- (ADR-0007 and its amendments; WORKFLOWS §6; DATA-MODEL §7; kickoff 9 decisions 1-11, 23, 24 as refreshed
-- on 14 Nov 2026, docs/kickoff/phase-9-kickoff-refresh-2026-11-14.md, and the owner's answers of 18 Nov 2026).
--
-- Money is the Owner's alone (CLAUDE.md invariant 2):
--   * five tables, each with ONE policy (select for finance.view in the caller's org) and no insert, update
--     or delete grant to anyone: every write is a finance.edit function below (ADR-0006);
--   * no amount on projects, project_cycles or project_items, and none in their audit rows: the money tables
--     are audited under their own entity names, which no Admin-readable activity_log policy matches;
--   * never in the Realtime publication (pgTAP 46), never in a notification, never in a refusal's text;
--   * the views are security invoker AND gated on finance.view, so anyone else reads zero rows.
--
-- The rules (WORKFLOWS §6):
--   * a retainer cycle keeps its own amount (decision 3). The FIRST amount entered for a project goes to
--     every cycle starting on or after the 1st of the current IST month (Q1, "this month on"); a later change
--     goes to the cycle current today and later ones; one cycle can be changed alone;
--   * the cycle's amount is split evenly over its PLAN deliverables, explicit values off the top (decision 4);
--   * a deliverable ADDED after the cycle's list was made is worth nothing until the Owner prices it, and
--     that price counts ON TOP of the cycle's amount (R4, owner 14 and 18 Nov 2026);
--   * a carried-in deliverable is valued in its origin cycle; a "Not needed" close leaves Potential (24);
--   * a one-time project is one lump sum (decision 2): Potential in its delivery month, the current month
--     while overdue, the completion month once completed, the cancellation month once cancelled; Achieved is
--     all or nothing on completion; a cancelled one counts nothing (Q4); advances are never Achieved (23).
--
-- EXPAND-ONLY: new enums, tables, functions, views and two AFTER INSERT triggers (project_cycles,
-- project_items) that write only the new tables. No existing column, function or policy changes.
-- Append-only: never edit once applied.

-- 1. Enums (DATA-MODEL §0) -----------------------------------------------------------------------------------
create type public.billing_category as enum ('retainer', 'project', 'additional_work');
create type public.billing_status as enum ('not_billed', 'billed');

-- 2. Tables -------------------------------------------------------------------------------------------------
create table public.project_billing (
  project_id uuid primary key references public.projects (id),
  org_id uuid not null references public.organizations (id),
  billing_category public.billing_category null,
  cycle_amount numeric(12, 2) null,
  fixed_amount numeric(12, 2) null,
  priced_from date null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint project_billing_cycle_amount_whole check (cycle_amount is null or (cycle_amount >= 0 and cycle_amount = trunc(cycle_amount))),
  constraint project_billing_fixed_amount_whole check (fixed_amount is null or (fixed_amount >= 0 and fixed_amount = trunc(fixed_amount))),
  constraint project_billing_one_amount check (cycle_amount is null or fixed_amount is null),
  constraint project_billing_priced_from_month check (priced_from is null or extract(day from priced_from) = 1)
);
comment on table public.project_billing is
  '9.1 (Owner only, ADR-0007): a project''s billing category (null = the default from recurrence), a retainer''s default cycle amount or a one-time project''s lump sum (null = No amount set, 0 = Not billable), and priced_from: the 1st of the IST month the first amount was entered (Q1).';

create table public.cycle_billing (
  cycle_id uuid primary key references public.project_cycles (id),
  org_id uuid not null references public.organizations (id),
  project_id uuid not null references public.projects (id),
  cycle_amount numeric(12, 2) null,
  billing_status public.billing_status not null default 'not_billed',
  billed_on date null,
  note text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint cycle_billing_amount_whole check (cycle_amount is null or (cycle_amount >= 0 and cycle_amount = trunc(cycle_amount))),
  constraint cycle_billing_billed_on check ((billing_status = 'billed') = (billed_on is not null)),
  constraint cycle_billing_note_length check (note is null or length(btrim(note)) between 1 and 500)
);
create index cycle_billing_project_idx on public.cycle_billing (project_id);
comment on table public.cycle_billing is
  '9.1 (Owner only): a retainer cycle''s own amount (decision 3; null = No amount set) and the billing status of a cycle, or of a one-time project through its single cycle (decision 7).';

create table public.item_billing (
  item_id uuid primary key references public.project_items (id),
  org_id uuid not null references public.organizations (id),
  added boolean not null default false,
  value numeric(12, 2) null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint item_billing_value_whole check (value is null or (value >= 0 and value = trunc(value)))
);
comment on table public.item_billing is
  '9.1 (Owner only): a retainer deliverable''s own value. added = it was created after its cycle''s item list (R4): its value counts on top of the cycle''s amount, null = not priced. On a plan deliverable the value comes off the top of the cycle''s amount (decision 4), null = back to the even split.';

create table public.revenue_overrides (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id),
  scope text not null,
  ref_id uuid not null,
  calculated_value numeric(12, 2) not null,
  adjusted_value numeric(12, 2) not null,
  note text not null,
  by_id uuid not null references public.members (id),
  at timestamptz not null default now(),
  superseded_at timestamptz null,
  superseded_note text null,
  constraint revenue_overrides_scope check (scope in ('cycle', 'project')),
  constraint revenue_overrides_adjusted_whole check (adjusted_value >= 0 and adjusted_value = trunc(adjusted_value)),
  constraint revenue_overrides_note_length check (length(btrim(note)) between 1 and 500),
  constraint revenue_overrides_superseded_note check (superseded_note is null or (superseded_at is not null and length(btrim(superseded_note)) between 1 and 500))
);
create unique index revenue_overrides_live_idx on public.revenue_overrides (scope, ref_id) where superseded_at is null;
create index revenue_overrides_ref_idx on public.revenue_overrides (ref_id, at desc);
comment on table public.revenue_overrides is
  '9.1 (Owner only, decision 6): the Owner-adjusted Achieved of a retainer cycle or a one-time project, beside the calculated value frozen when it was made. One live row per (scope, ref_id); a new override or "Back to calculated" supersedes, never deletes.';

create table public.project_advances (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id),
  project_id uuid not null references public.projects (id),
  amount numeric(12, 2) not null,
  received_on date not null,
  note text null,
  recorded_by uuid not null references public.members (id),
  recorded_at timestamptz not null default now(),
  returned_on date null,
  return_note text null,
  returned_by uuid null references public.members (id),
  constraint project_advances_amount_whole check (amount > 0 and amount = trunc(amount)),
  constraint project_advances_note_length check (note is null or length(btrim(note)) between 1 and 500),
  constraint project_advances_return_note_length check (return_note is null or length(btrim(return_note)) between 1 and 500),
  constraint project_advances_return_pair check ((returned_on is null) = (returned_by is null) and (returned_on is not null or return_note is null)),
  constraint project_advances_return_after check (returned_on is null or returned_on >= received_on)
);
create index project_advances_project_idx on public.project_advances (project_id, received_on);
comment on table public.project_advances is
  '9.1 (Owner only, decision 23): an advance received on a one-time project. Never Achieved; reported in the IST month of received_on, a return in the month of returned_on. Never deleted.';

-- 3. RLS: one policy each, the Owner's read. No write grant: the functions below are the only writers. ----------
do $$
declare
  t text;
begin
  foreach t in array array['project_billing', 'cycle_billing', 'item_billing', 'revenue_overrides', 'project_advances'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format(
      'create policy %I on public.%I for select to authenticated using (org_id = (select c.org_id from app.current_member() c) and (select app.has_permission(''finance.view'')))',
      t || '_select', t);
  end loop;
end;
$$;

create trigger set_updated_at before update on public.project_billing
  for each row execute function app.set_updated_at();
create trigger set_updated_at before update on public.cycle_billing
  for each row execute function app.set_updated_at();
create trigger set_updated_at before update on public.item_billing
  for each row execute function app.set_updated_at();

-- 4. Plan or added (R4) --------------------------------------------------------------------------------------
-- A deliverable is in its cycle's PLAN when the cycle's item list made it: app.cycle_create (a new cycle
-- with its list) or app.cycle_copy_item_list (the nightly copy for a client that became Active again).
-- Every other deliverable that was not carried in (item_add, item_add_grouped,
-- project_blueprint_add_to_cycle) was ADDED: it gets an item_billing row with added = true and no value.
-- The fact is taken when the row is written, from the functions on the call stack, so it never drifts and
-- the existing functions stay as they are. A path this trigger does not know is treated as added: it then
-- shows to the Owner as "not priced" rather than silently joining the split. pgTAP 144 pins every path.
create function app.item_billing_mark_added()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_stack text;
begin
  if new.carried_from_item_id is not null then
    return null;
  end if;
  if (select p.recurrence from public.projects p where p.id = new.project_id) = 'one_time' then
    return null;
  end if;
  get diagnostics v_stack = pg_context;
  if v_stack like '%function app.cycle_create(%' or v_stack like '%function app.cycle_copy_item_list(%' then
    return null;
  end if;
  insert into public.item_billing (item_id, org_id, added) values (new.id, new.org_id, true)
  on conflict (item_id) do nothing;
  return null;
end;
$$;
revoke all on function app.item_billing_mark_added() from public, anon, authenticated;
grant execute on function app.item_billing_mark_added() to service_role;
comment on function app.item_billing_mark_added() is
  '9.1 (R4): marks a retainer deliverable created outside its cycle''s item list as added (item_billing.added), with no value.';

-- Existing deliverables: made in a later transaction than their cycle, by a person. (The nightly list copy
-- has no creator; a cycle''s own list shares the cycle''s transaction time.)
insert into public.item_billing (item_id, org_id, added)
select i.id, i.org_id, true
from public.project_items i
join public.project_cycles c on c.id = i.cycle_id
join public.projects p on p.id = i.project_id
where p.recurrence <> 'one_time'
  and i.carried_from_item_id is null
  and i.created_by is not null
  and i.created_at > c.created_at;

create trigger item_billing_mark_added after insert on public.project_items
  for each row execute function app.item_billing_mark_added();

-- 5. A new cycle takes the project's amount (decision 3) --------------------------------------------------------
create function app.cycle_billing_copy_amount()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_amount numeric(12, 2);
begin
  select b.cycle_amount into v_amount from public.project_billing b where b.project_id = new.project_id;
  if v_amount is null then
    return null;
  end if;
  insert into public.cycle_billing (cycle_id, org_id, project_id, cycle_amount)
  values (new.id, new.org_id, new.project_id, v_amount)
  on conflict (cycle_id) do nothing;
  return null;
end;
$$;
revoke all on function app.cycle_billing_copy_amount() from public, anon, authenticated;
grant execute on function app.cycle_billing_copy_amount() to service_role;
comment on function app.cycle_billing_copy_amount() is
  '9.1 (decision 3): a new retainer cycle copies the project''s cycle amount into its own cycle_billing row.';

create trigger cycle_billing_copy_amount after insert on public.project_cycles
  for each row execute function app.cycle_billing_copy_amount();

-- The audit triggers come after the backfill above, so it writes no activity rows.
create trigger audit_row_change after insert or update or delete on public.project_billing
  for each row execute function app.audit_row_change('project_id');
create trigger audit_row_change after insert or update or delete on public.cycle_billing
  for each row execute function app.audit_row_change('cycle_id');
create trigger audit_row_change after insert or update or delete on public.item_billing
  for each row execute function app.audit_row_change('item_id');
create trigger audit_row_change after insert or update or delete on public.revenue_overrides
  for each row execute function app.audit_row_change();
create trigger audit_row_change after insert or update or delete on public.project_advances
  for each row execute function app.audit_row_change();

-- 6. Helpers ---------------------------------------------------------------------------------------------------
create function app.month_start(p_day date)
returns date
language sql
immutable
set search_path = ''
as $$ select date_trunc('month', p_day)::date; $$;
revoke all on function app.month_start(date) from public, anon;
grant execute on function app.month_start(date) to authenticated, service_role;
comment on function app.month_start(date) is '9.1: the 1st of a date''s month.';

-- An amount the Owner types: null, or whole rupees from 0 up.
create function app.money_check(p_amount numeric, p_what text)
returns void
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_amount is null then
    return;
  end if;
  if p_amount < 0 or p_amount <> trunc(p_amount) or p_amount > 9999999999 then
    perform app.fail('VALIDATION', format('%s must be whole rupees, 0 or more.', p_what));
  end if;
end;
$$;
revoke all on function app.money_check(numeric, text) from public, anon, authenticated;
grant execute on function app.money_check(numeric, text) to service_role;

-- The explicit values of a cycle's plan deliverables that still count (decision 4), leaving one item out.
create function app.cycle_explicit_total(p_cycle_id uuid, p_except_item uuid default null)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(b.value), 0)
  from public.project_items i
  join public.item_billing b on b.item_id = i.id and not b.added and b.value is not null
  where i.cycle_id = p_cycle_id and i.carried_from_item_id is null
    and (p_except_item is null or i.id <> p_except_item);
$$;
revoke all on function app.cycle_explicit_total(uuid, uuid) from public, anon, authenticated;
grant execute on function app.cycle_explicit_total(uuid, uuid) to service_role;

-- 7. The Owner's functions (finance.edit) ----------------------------------------------------------------------
-- The amount and / or the category of a project.
create function public.billing_set_project(
  project_id uuid,
  amount numeric,
  set_amount boolean,
  category public.billing_category
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller public.members;
  v_project public.projects;
  v_row public.project_billing;
  v_today date := app.today_ist();
  v_first boolean;
  v_from date;
  v_cycle record;
  v_advances numeric;
begin
  v_caller := app.client_work_caller('finance.edit', 'Only the Owner sets billing.');
  v_project := app.project_lock(billing_set_project.project_id);
  if not coalesce(set_amount, false) and category is null then
    perform app.fail('VALIDATION', 'Nothing to change.');
  end if;

  select b.* into v_row from public.project_billing b where b.project_id = v_project.id for update;
  if v_row.project_id is null then
    perform set_config('app.audit_override', jsonb_build_object('action', 'billing_started')::text, true);
    insert into public.project_billing (project_id, org_id) values (v_project.id, v_project.org_id)
    returning * into v_row;
  end if;

  if category is not null and category is distinct from v_row.billing_category then
    perform set_config('app.audit_override', jsonb_build_object('action', 'category_set')::text, true);
    update public.project_billing b set billing_category = category where b.project_id = v_project.id;
  end if;

  if not coalesce(set_amount, false) then
    return true;
  end if;
  perform app.money_check(amount, 'The amount');
  v_first := v_row.priced_from is null;
  v_from := coalesce(v_row.priced_from, case when amount is not null then app.month_start(v_today) end);

  if v_project.recurrence = 'one_time' then
    select coalesce(sum(a.amount), 0) into v_advances from public.project_advances a
    where a.project_id = v_project.id and a.returned_on is null;
    if v_advances > 0 and (amount is null or amount < v_advances) then
      perform app.fail('VALIDATION', 'The amount can''t be less than the advances received.');
    end if;
    perform set_config('app.audit_override', jsonb_build_object('action', 'amount_set')::text, true);
    update public.project_billing b set fixed_amount = amount, priced_from = v_from where b.project_id = v_project.id;
    return true;
  end if;

  -- A retainer: the first amount covers every cycle starting this IST month or later (Q1); a later change
  -- covers the cycle current today and later ones (decision 3). Earlier cycles are never rewritten.
  for v_cycle in
    select c.id, c.label from public.project_cycles c
    where c.project_id = v_project.id
      and case when v_first then c.period_start >= app.month_start(v_today) else c.period_end >= v_today end
    order by c.period_start
  loop
    if amount is not null and app.cycle_explicit_total(v_cycle.id) > amount then
      perform app.fail('VALIDATION', format('Deliverable values in %s add up to more than this amount.', v_cycle.label));
    end if;
    perform set_config('app.audit_override', jsonb_build_object('action', 'amount_set', 'meta', jsonb_build_object('from', 'project'))::text, true);
    insert into public.cycle_billing (cycle_id, org_id, project_id, cycle_amount)
    values (v_cycle.id, v_project.org_id, v_project.id, amount)
    on conflict on constraint cycle_billing_pkey do update set cycle_amount = excluded.cycle_amount;
  end loop;
  perform set_config('app.audit_override', jsonb_build_object('action', 'amount_set')::text, true);
  update public.project_billing b set cycle_amount = amount, priced_from = v_from where b.project_id = v_project.id;
  perform set_config('app.audit_override', '', true);
  return true;
end;
$$;

-- One retainer cycle's amount alone (null = back to "No amount set").
create function public.billing_set_cycle_amount(cycle_id uuid, amount numeric)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller public.members;
  v_cycle public.project_cycles;
  v_project public.projects;
begin
  v_caller := app.client_work_caller('finance.edit', 'Only the Owner sets billing.');
  select c.* into v_cycle from public.project_cycles c
  where c.id = billing_set_cycle_amount.cycle_id and c.org_id = v_caller.org_id;
  if v_cycle.id is null then
    perform app.fail('NOT_FOUND', 'This cycle is not one of yours.');
  end if;
  v_project := app.project_lock(v_cycle.project_id);
  if v_project.recurrence = 'one_time' then
    perform app.fail('VALIDATION', 'A one-time project has one amount, set on the project.');
  end if;
  perform app.money_check(amount, 'The amount');
  if amount is not null and app.cycle_explicit_total(v_cycle.id) > amount then
    perform app.fail('VALIDATION', 'Deliverable values add up to more than this amount.');
  end if;
  perform set_config('app.audit_override', jsonb_build_object('action', 'amount_set', 'meta', jsonb_build_object('from', 'cycle'))::text, true);
  insert into public.cycle_billing (cycle_id, org_id, project_id, cycle_amount)
  values (v_cycle.id, v_cycle.org_id, v_cycle.project_id, amount)
  on conflict on constraint cycle_billing_pkey do update set cycle_amount = excluded.cycle_amount;
  perform set_config('app.audit_override', '', true);
  return true;
end;
$$;

-- A retainer deliverable's own value: off the top for a plan deliverable, on top for an added one (R4).
create function public.item_value_set(item_id uuid, value numeric)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller public.members;
  v_item public.project_items;
  v_project public.projects;
  v_added boolean;
  v_amount numeric;
begin
  v_caller := app.client_work_caller('finance.edit', 'Only the Owner sets billing.');
  v_item := app.item_lock(item_value_set.item_id);
  select p.* into v_project from public.projects p where p.id = v_item.project_id;
  if v_project.recurrence = 'one_time' then
    perform app.fail('VALIDATION', 'A one-time project has one amount. Its deliverables carry no value.');
  end if;
  if v_item.carried_from_item_id is not null then
    perform app.fail('VALIDATION', 'This deliverable was carried in. Set its value in the month it came from.');
  end if;
  perform app.money_check(value, 'The value');
  select coalesce(b.added, false) into v_added from public.item_billing b where b.item_id = v_item.id;
  v_added := coalesce(v_added, false);
  if not v_added and value is not null then
    select cb.cycle_amount into v_amount from public.cycle_billing cb where cb.cycle_id = v_item.cycle_id;
    if v_amount is null then
      perform app.fail('VALIDATION', 'Set this cycle''s amount first.');
    end if;
    if app.cycle_explicit_total(v_item.cycle_id, v_item.id) + value > v_amount then
      perform app.fail('VALIDATION', 'Deliverable values add up to more than this cycle''s amount.');
    end if;
  end if;
  perform set_config('app.audit_override', jsonb_build_object(
    'action', case when value is null then 'value_cleared' else 'value_set' end)::text, true);
  insert into public.item_billing (item_id, org_id, added, value)
  values (v_item.id, v_item.org_id, false, value)
  on conflict on constraint item_billing_pkey do update set value = excluded.value;
  perform set_config('app.audit_override', '', true);
  return true;
end;
$$;

-- An advance received on a one-time project (decision 23).
create function public.advance_record(project_id uuid, amount numeric, received_on date, note text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller public.members;
  v_project public.projects;
  v_fixed numeric;
  v_open numeric;
  v_on date := coalesce(received_on, app.today_ist());
  v_id uuid;
begin
  v_caller := app.client_work_caller('finance.edit', 'Only the Owner records advances.');
  v_project := app.project_lock(advance_record.project_id);
  if v_project.recurrence <> 'one_time' then
    perform app.fail('VALIDATION', 'Advances are for one-time projects. Mark a retainer''s cycle Billed instead.');
  end if;
  if amount is null or amount <= 0 then
    perform app.fail('VALIDATION', 'The advance must be whole rupees, more than 0.');
  end if;
  perform app.money_check(amount, 'The advance');
  if v_on > app.today_ist() then
    perform app.fail('VALIDATION', 'The date received can''t be in the future.');
  end if;
  select b.fixed_amount into v_fixed from public.project_billing b where b.project_id = v_project.id;
  if v_fixed is null then
    perform app.fail('VALIDATION', 'Set the project''s amount first.');
  end if;
  select coalesce(sum(a.amount), 0) into v_open from public.project_advances a
  where a.project_id = v_project.id and a.returned_on is null;
  if v_open + amount > v_fixed then
    perform app.fail('VALIDATION', 'Advances can''t add up to more than the project''s amount.');
  end if;
  perform set_config('app.audit_override', jsonb_build_object('action', 'advance_recorded')::text, true);
  insert into public.project_advances (org_id, project_id, amount, received_on, note, recorded_by)
  values (v_project.org_id, v_project.id, advance_record.amount, v_on, nullif(btrim(advance_record.note), ''), v_caller.id)
  returning id into v_id;
  return v_id;
end;
$$;

create function public.advance_return(advance_id uuid, returned_on date, note text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller public.members;
  v_advance public.project_advances;
  v_on date := coalesce(returned_on, app.today_ist());
begin
  v_caller := app.client_work_caller('finance.edit', 'Only the Owner records advances.');
  select a.* into v_advance from public.project_advances a
  where a.id = advance_return.advance_id and a.org_id = v_caller.org_id;
  if v_advance.id is null then
    perform app.fail('NOT_FOUND', 'This advance is not one of yours.');
  end if;
  perform app.project_lock(v_advance.project_id);
  select a.* into v_advance from public.project_advances a where a.id = v_advance.id for update;
  if v_advance.returned_on is not null then
    perform app.fail('INVALID_STATE', 'This advance was already returned.');
  end if;
  if v_on < v_advance.received_on then
    perform app.fail('VALIDATION', 'The return can''t be before the advance was received.');
  end if;
  if v_on > app.today_ist() then
    perform app.fail('VALIDATION', 'The return date can''t be in the future.');
  end if;
  perform set_config('app.audit_override', jsonb_build_object('action', 'advance_returned')::text, true);
  update public.project_advances a
  set returned_on = v_on, return_note = nullif(btrim(advance_return.note), ''), returned_by = v_caller.id
  where a.id = v_advance.id;
  return true;
end;
$$;

-- Billed / Not billed for one cycle or many (decision 7); a one-time project is marked through its cycle.
create function public.billing_mark(cycle_ids uuid[], billed boolean, billed_on date, note text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller public.members;
  v_ids uuid[];
  v_on date := coalesce(billed_on, app.today_ist());
  v_cycle public.project_cycles;
  v_count integer := 0;
begin
  v_caller := app.client_work_caller('finance.edit', 'Only the Owner sets billing.');
  select array_agg(distinct x order by x) into v_ids from unnest(cycle_ids) x where x is not null;
  if v_ids is null or billed is null then
    perform app.fail('VALIDATION', 'Nothing to mark.');
  end if;
  if cardinality(v_ids) > 200 then
    perform app.fail('VALIDATION', 'Mark at most 200 at a time.');
  end if;
  if billed and v_on > app.today_ist() then
    perform app.fail('VALIDATION', 'The billed date can''t be in the future.');
  end if;
  for v_cycle in
    select c.* from public.project_cycles c where c.id = any (v_ids) and c.org_id = v_caller.org_id order by c.id
  loop
    perform set_config('app.audit_override', jsonb_build_object(
      'action', case when billed then 'billed' else 'not_billed' end)::text, true);
    insert into public.cycle_billing (cycle_id, org_id, project_id, billing_status, billed_on, note)
    values (v_cycle.id, v_cycle.org_id, v_cycle.project_id,
            case when billed then 'billed' else 'not_billed' end::public.billing_status,
            case when billed then v_on end, case when billed then nullif(btrim(billing_mark.note), '') end)
    on conflict on constraint cycle_billing_pkey do update
    set billing_status = excluded.billing_status, billed_on = excluded.billed_on, note = excluded.note;
    v_count := v_count + 1;
  end loop;
  perform set_config('app.audit_override', '', true);
  if v_count <> cardinality(v_ids) then
    perform app.fail('NOT_FOUND', 'One of these cycles is not yours.');
  end if;
  return v_count;
end;
$$;

revoke all on function public.billing_set_project(uuid, numeric, boolean, public.billing_category),
  public.billing_set_cycle_amount(uuid, numeric), public.item_value_set(uuid, numeric),
  public.advance_record(uuid, numeric, date, text), public.advance_return(uuid, date, text),
  public.billing_mark(uuid[], boolean, date, text) from public, anon;
grant execute on function public.billing_set_project(uuid, numeric, boolean, public.billing_category),
  public.billing_set_cycle_amount(uuid, numeric), public.item_value_set(uuid, numeric),
  public.advance_record(uuid, numeric, date, text), public.advance_return(uuid, date, text),
  public.billing_mark(uuid[], boolean, date, text) to authenticated, service_role;

comment on function public.billing_set_project(uuid, numeric, boolean, public.billing_category) is
  '9.1 (finance.edit): a project''s amount (set_amount; null = No amount set) and / or billing category. A retainer''s first amount covers cycles starting this IST month or later (Q1), a later change the current cycle on (decision 3).';
comment on function public.billing_set_cycle_amount(uuid, numeric) is
  '9.1 (finance.edit): one retainer cycle''s amount alone (decision 3).';
comment on function public.item_value_set(uuid, numeric) is
  '9.1 (finance.edit): a retainer deliverable''s own value: off the top of the cycle''s amount for a plan deliverable (decision 4), on top for an added one (R4). null clears it.';
comment on function public.advance_record(uuid, numeric, date, text) is
  '9.1 (finance.edit, decision 23): an advance received on a one-time project; the advances not returned never exceed its amount.';
comment on function public.advance_return(uuid, date, text) is
  '9.1 (finance.edit, decision 23): marks an advance returned; the row is kept.';
comment on function public.billing_mark(uuid[], boolean, date, text) is
  '9.1 (finance.edit, decision 7): Billed (with a date, default today IST, and a note) or back to Not billed, for one cycle or many.';

-- 8. Views (security invoker, and gated: nobody without finance.view reads a row) ---------------------------------
-- One row per retainer deliverable, valued in its origin cycle. A carried deliverable is followed to where
-- it is now (its leaf): done there = Achieved in the origin month.
create view public.item_values_v
with (security_invoker = true)
as
with recursive chain as (
  select i.id as root_id, i.id as item_id, 0 as depth
  from public.project_items i
  join public.projects p on p.id = i.project_id and p.recurrence <> 'one_time'
  where i.carried_from_item_id is null
    and (select app.has_permission('finance.view'))
  union all
  select ch.root_id, n.id, ch.depth + 1
  from chain ch
  join public.project_items n on n.carried_from_item_id = ch.item_id
),
leaf as (
  select distinct on (ch.root_id) ch.root_id, ch.item_id as leaf_id
  from chain ch
  order by ch.root_id, ch.depth desc
),
base as (
  select
    r.org_id, p.client_id, r.project_id, r.cycle_id, r.id as item_id, r.title, r.position,
    c.period_start, app.month_start(c.period_start) as month,
    cb.cycle_amount,
    coalesce(ib.added, false) as added,
    ib.value as explicit_value,
    l.id as leaf_item_id, l.state as leaf_state, l.approved_at as leaf_approved_at,
    not (l.state = 'cancelled' and l.close_kind is not distinct from 'not_needed')
      and not (r.state = 'cancelled' and app.to_ist_date(r.cancelled_at) < c.period_start) as in_potential
  from leaf lf
  join public.project_items r on r.id = lf.root_id
  join public.project_items l on l.id = lf.leaf_id
  join public.project_cycles c on c.id = r.cycle_id
  join public.projects p on p.id = r.project_id
  left join public.cycle_billing cb on cb.cycle_id = r.cycle_id
  left join public.item_billing ib on ib.item_id = r.id
),
split as (
  select b.*,
    coalesce(sum(b.explicit_value) filter (where not b.added and b.in_potential) over w, 0) as explicit_total,
    count(*) filter (where not b.added and b.in_potential and b.explicit_value is null) over w as split_count,
    row_number() over (
      partition by b.cycle_id, (not b.added and b.in_potential and b.explicit_value is null)
      order by b.position collate "C", b.item_id) as split_rank
  from base b
  window w as (partition by b.cycle_id)
),
valued as (
  select s.*,
    case
      when not s.in_potential then 'excluded'
      when s.added and s.explicit_value is null then 'not_priced'
      when s.added then 'added'
      when s.explicit_value is not null then 'explicit'
      when s.cycle_amount is null then 'no_amount'
      else 'split'
    end as method,
    case
      when not s.in_potential then 0
      when s.explicit_value is not null then s.explicit_value
      when s.added or s.cycle_amount is null then 0
      when s.split_rank = 1 then
        greatest(s.cycle_amount - s.explicit_total, 0)
          - trunc(greatest(s.cycle_amount - s.explicit_total, 0) / s.split_count, 2) * (s.split_count - 1)
      else trunc(greatest(s.cycle_amount - s.explicit_total, 0) / s.split_count, 2)
    end::numeric(12, 2) as value
  from split s
)
select
  v.org_id, v.client_id, v.project_id, v.cycle_id, v.item_id, v.title, v.position, v.month,
  case when v.added then 'added' else 'plan' end as kind,
  v.method, v.value, v.in_potential,
  (v.in_potential and v.leaf_state = 'approved') as achieved,
  (v.in_potential and v.leaf_state = 'cancelled') as closed_not_achieved,
  v.leaf_item_id, v.leaf_state, v.leaf_approved_at
from valued v;

create view public.revenue_by_cycle_v
with (security_invoker = true)
as
select
  c.org_id, p.client_id, c.project_id, c.id as cycle_id, c.label, c.period_start, c.period_end,
  app.month_start(c.period_start) as month,
  coalesce(pb.billing_category, 'retainer'::public.billing_category) as billing_category,
  cb.cycle_amount as amount,
  coalesce(t.potential, 0)::numeric(12, 2) as potential,
  coalesce(t.achieved, 0)::numeric(12, 2) as achieved_calculated,
  coalesce(o.adjusted_value, t.achieved, 0)::numeric(12, 2) as achieved,
  o.id as override_id,
  coalesce(t.closed_not_achieved, 0)::numeric(12, 2) as closed_not_achieved,
  greatest(coalesce(t.potential, 0) - coalesce(o.adjusted_value, t.achieved, 0), 0)::numeric(12, 2) as remaining,
  coalesce(t.added_value, 0)::numeric(12, 2) as added_value,
  coalesce(t.added_count, 0)::integer as added_count,
  coalesce(t.not_priced_count, 0)::integer as not_priced_count,
  coalesce(t.plan_count, 0)::integer as plan_count,
  coalesce(t.done_count, 0)::integer as done_count,
  coalesce(cb.billing_status, 'not_billed'::public.billing_status) as billing_status,
  cb.billed_on, cb.note as billing_note,
  (p.held_at is not null) as held
from public.project_cycles c
join public.projects p on p.id = c.project_id and p.recurrence <> 'one_time'
left join public.project_billing pb on pb.project_id = c.project_id
left join public.cycle_billing cb on cb.cycle_id = c.id
left join public.revenue_overrides o on o.scope = 'cycle' and o.ref_id = c.id and o.superseded_at is null
left join lateral (
  select
    sum(v.value) filter (where v.in_potential) as potential,
    sum(v.value) filter (where v.achieved) as achieved,
    sum(v.value) filter (where v.closed_not_achieved) as closed_not_achieved,
    sum(v.value) filter (where v.in_potential and v.kind = 'added') as added_value,
    count(*) filter (where v.in_potential and v.kind = 'added') as added_count,
    count(*) filter (where v.method = 'not_priced') as not_priced_count,
    count(*) filter (where v.in_potential and v.kind = 'plan') as plan_count,
    count(*) filter (where v.achieved) as done_count
  from public.item_values_v v
  where v.cycle_id = c.id
) t on true
where (select app.has_permission('finance.view'));

-- One row per one-time project: the lump sum and the month it sits in (decision 2, 2a, 2c; Q1; Q4).
create view public.revenue_project_lines_v
with (security_invoker = true)
as
with line as (
  select
    p.org_id, p.client_id, p.id as project_id, p.name, p.state, p.delivery_date,
    coalesce(pb.billing_category, 'project'::public.billing_category) as billing_category,
    pb.fixed_amount, pb.priced_from,
    case
      when p.state = 'completed' then app.month_start(app.to_ist_date(p.completed_at))
      when p.state = 'cancelled' then app.month_start(app.to_ist_date(p.cancelled_at))
      when app.month_start(p.delivery_date) < app.month_start(app.today_ist()) then app.month_start(app.today_ist())
      else app.month_start(p.delivery_date)
    end as month,
    (p.state in ('open', 'in_progress') and p.delivery_date < app.today_ist()) as was_due,
    (p.state in ('open', 'in_progress')
      and exists (select 1 from public.project_items i where i.project_id = p.id)
      and not exists (select 1 from public.project_items i where i.project_id = p.id and i.state in ('open', 'done'))
    ) as ready_to_complete,
    (p.held_at is not null) as held,
    (select c.id from public.project_cycles c where c.project_id = p.id order by c.created_at limit 1) as cycle_id
  from public.projects p
  left join public.project_billing pb on pb.project_id = p.id
  where p.recurrence = 'one_time'
    and (select app.has_permission('finance.view'))
)
select
  l.org_id, l.client_id, l.project_id, l.name, l.state, l.delivery_date, l.billing_category, l.month,
  -- Q1: a month before the first amount was entered reads "No amount set".
  case when l.priced_from is not null and l.month >= l.priced_from then l.fixed_amount end as amount,
  coalesce(case when l.priced_from is not null and l.month >= l.priced_from then l.fixed_amount end, 0)::numeric(12, 2) as potential,
  (case when l.state = 'completed'
        then coalesce(case when l.priced_from is not null and l.month >= l.priced_from then l.fixed_amount end, 0)
        else 0 end)::numeric(12, 2) as achieved_calculated,
  (case when l.state = 'completed'
        then coalesce(o.adjusted_value, case when l.priced_from is not null and l.month >= l.priced_from then l.fixed_amount end, 0)
        else 0 end)::numeric(12, 2) as achieved,
  case when l.state = 'completed' then o.id end as override_id,
  (case when l.state = 'cancelled'
        then coalesce(case when l.priced_from is not null and l.month >= l.priced_from then l.fixed_amount end, 0)
        else 0 end)::numeric(12, 2) as closed_not_achieved,
  l.was_due, l.ready_to_complete, l.held,
  coalesce(a.kept, 0)::numeric(12, 2) as advances_kept,
  coalesce(a.returned, 0)::numeric(12, 2) as advances_returned,
  l.cycle_id,
  coalesce(cb.billing_status, 'not_billed'::public.billing_status) as billing_status,
  cb.billed_on, cb.note as billing_note
from line l
left join public.revenue_overrides o on o.scope = 'project' and o.ref_id = l.project_id and o.superseded_at is null
left join public.cycle_billing cb on cb.cycle_id = l.cycle_id
left join lateral (
  select sum(x.amount) filter (where x.returned_on is null) as kept,
         sum(x.amount) filter (where x.returned_on is not null) as returned
  from public.project_advances x where x.project_id = l.project_id
) a on true;

-- Advances, each event in its own IST month: received in the month of received_on, a return in its own.
create view public.revenue_advances_v
with (security_invoker = true)
as
select a.org_id, p.client_id, a.project_id, a.id as advance_id, 'received'::text as event,
       app.month_start(a.received_on) as month, a.received_on as on_date, a.amount, a.note,
       (a.returned_on is not null) as returned
from public.project_advances a
join public.projects p on p.id = a.project_id
where (select app.has_permission('finance.view'))
union all
select a.org_id, p.client_id, a.project_id, a.id, 'returned',
       app.month_start(a.returned_on), a.returned_on, a.amount, a.return_note, true
from public.project_advances a
join public.projects p on p.id = a.project_id
where a.returned_on is not null
  and (select app.has_permission('finance.view'));

create view public.revenue_by_client_month_v
with (security_invoker = true)
as
select
  x.org_id, x.client_id, x.month, x.billing_category,
  sum(x.potential)::numeric(12, 2) as potential,
  sum(x.achieved_calculated)::numeric(12, 2) as achieved_calculated,
  sum(x.achieved)::numeric(12, 2) as achieved,
  sum(x.closed_not_achieved)::numeric(12, 2) as closed_not_achieved,
  sum(greatest(x.potential - x.achieved, 0))::numeric(12, 2) as remaining,
  count(*) filter (where x.amount is null)::integer as no_amount_count,
  sum(x.not_priced_count)::integer as not_priced_count,
  count(*)::integer as line_count
from (
  select c.org_id, c.client_id, c.month, c.billing_category, c.amount, c.potential, c.achieved_calculated,
         c.achieved, c.closed_not_achieved, c.not_priced_count
  from public.revenue_by_cycle_v c
  union all
  select l.org_id, l.client_id, l.month, l.billing_category, l.amount, l.potential, l.achieved_calculated,
         l.achieved, l.closed_not_achieved, 0
  from public.revenue_project_lines_v l
) x
group by x.org_id, x.client_id, x.month, x.billing_category;

revoke all on public.item_values_v, public.revenue_by_cycle_v, public.revenue_project_lines_v,
  public.revenue_advances_v, public.revenue_by_client_month_v from public, anon, authenticated;
grant select on public.item_values_v, public.revenue_by_cycle_v, public.revenue_project_lines_v,
  public.revenue_advances_v, public.revenue_by_client_month_v to authenticated;

comment on view public.item_values_v is
  '9.1 (Owner only, WORKFLOWS §6.1): each retainer deliverable valued in its origin cycle: plan (explicit or the even split) or added (priced on top, or not priced).';
comment on view public.revenue_by_cycle_v is
  '9.1 (Owner only): a retainer cycle''s month, amount, Potential, calculated and headline Achieved, closed-not-achieved, added work and billing status.';
comment on view public.revenue_project_lines_v is
  '9.1 (Owner only, WORKFLOWS §6.2): a one-time project''s lump sum in the month it sits in, with its advances and billing status.';
comment on view public.revenue_advances_v is
  '9.1 (Owner only, decision 23): advances received and returned, each in its own IST month.';
comment on view public.revenue_by_client_month_v is
  '9.1 (Owner only): Potential / Achieved / Remaining by client, IST month and billing category, retainers and one-time projects together.';

-- 9. Overrides (decision 6): after the views, whose calculated figure they freeze ---------------------------------
create function public.revenue_override_set(scope text, ref_id uuid, adjusted_value numeric, note text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller public.members;
  v_project_id uuid;
  v_project public.projects;
  v_calculated numeric;
  v_id uuid;
begin
  v_caller := app.client_work_caller('finance.edit', 'Only the Owner adjusts revenue.');
  if scope is null or scope not in ('cycle', 'project') then
    perform app.fail('VALIDATION', 'Choose a cycle or a project.');
  end if;
  if adjusted_value is null then
    perform app.fail('VALIDATION', 'Enter the adjusted amount.');
  end if;
  perform app.money_check(adjusted_value, 'The adjusted amount');
  if note is null or length(btrim(note)) not between 1 and 500 then
    perform app.fail('REASON_REQUIRED', 'Add a note saying why (up to 500 characters).');
  end if;
  if scope = 'cycle' then
    select c.project_id into v_project_id from public.project_cycles c
    where c.id = revenue_override_set.ref_id and c.org_id = v_caller.org_id;
  else
    v_project_id := revenue_override_set.ref_id;
  end if;
  if v_project_id is null then
    perform app.fail('NOT_FOUND', 'This is not one of yours.');
  end if;
  v_project := app.project_lock(v_project_id);
  if (scope = 'cycle') <> (v_project.recurrence <> 'one_time') then
    perform app.fail('VALIDATION', 'Adjust a retainer by cycle and a one-time project as a whole.');
  end if;
  if scope = 'project' then
    if v_project.state <> 'completed' then
      perform app.fail('INVALID_STATE', 'Only a completed project''s revenue can be adjusted.');
    end if;
    select l.achieved_calculated into v_calculated from public.revenue_project_lines_v l where l.project_id = v_project.id;
  else
    select c.achieved_calculated into v_calculated from public.revenue_by_cycle_v c where c.cycle_id = revenue_override_set.ref_id;
  end if;

  perform set_config('app.audit_override', jsonb_build_object('action', 'override_superseded')::text, true);
  update public.revenue_overrides o
  set superseded_at = now(), superseded_note = 'Replaced by a new adjustment.'
  where o.scope = revenue_override_set.scope and o.ref_id = revenue_override_set.ref_id and o.superseded_at is null;
  perform set_config('app.audit_override', jsonb_build_object('action', 'override_set')::text, true);
  insert into public.revenue_overrides (org_id, scope, ref_id, calculated_value, adjusted_value, note, by_id)
  values (v_project.org_id, scope, ref_id, coalesce(v_calculated, 0), adjusted_value, btrim(note), v_caller.id)
  returning id into v_id;
  return v_id;
end;
$$;

create function public.revenue_override_clear(scope text, ref_id uuid, note text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller public.members;
  v_row public.revenue_overrides;
begin
  v_caller := app.client_work_caller('finance.edit', 'Only the Owner adjusts revenue.');
  if note is null or length(btrim(note)) not between 1 and 500 then
    perform app.fail('REASON_REQUIRED', 'Add a note saying why (up to 500 characters).');
  end if;
  select o.* into v_row from public.revenue_overrides o
  where o.scope = revenue_override_clear.scope and o.ref_id = revenue_override_clear.ref_id
    and o.org_id = v_caller.org_id and o.superseded_at is null
  for update;
  if v_row.id is null then
    perform app.fail('NOT_FOUND', 'There is no adjustment to remove.');
  end if;
  perform set_config('app.audit_override', jsonb_build_object('action', 'override_cleared')::text, true);
  update public.revenue_overrides o set superseded_at = now(), superseded_note = btrim(revenue_override_clear.note) where o.id = v_row.id;
  return true;
end;
$$;

revoke all on function public.revenue_override_set(text, uuid, numeric, text),
  public.revenue_override_clear(text, uuid, text) from public, anon;
grant execute on function public.revenue_override_set(text, uuid, numeric, text),
  public.revenue_override_clear(text, uuid, text) to authenticated, service_role;
comment on function public.revenue_override_set(text, uuid, numeric, text) is
  '9.1 (finance.edit, decision 6): the Owner-adjusted Achieved of a retainer cycle or a completed one-time project, with a note; the calculated value is frozen beside it and an earlier adjustment is superseded.';
comment on function public.revenue_override_clear(text, uuid, text) is
  '9.1 (finance.edit, decision 6): "Back to calculated" with a note; the row is kept, superseded.';
