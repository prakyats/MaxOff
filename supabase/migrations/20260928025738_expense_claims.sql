-- 3b.3 Expense claims (PRODUCT §4.18, kickoff 3b decisions 21-27, ADR-0007 amendment 2026-09-27;
--   DATA-MODEL §7a, WORKFLOWS §2a, PERMISSIONS §1 expenses.decide).
--
-- 1. role_permissions: expenses.decide for the Owner (the amendment's key).
-- 2. org_settings.expense_receipt_above (default 500): a claim above it needs a receipt photo.
-- 3. list_items 'expense_category' (Travel, Food, Materials, Other), the Owner's list: seeded for
--    every organization now and later, and guarded so lists.manage alone (Admins) cannot edit it.
-- 4. expense_claims: a member's own claims. RLS: own rows, all for expenses.decide; an Admin reads
--    no one else's. No API writes; every change is a function below.
-- 5. app.file_visible re-created with one more branch: a receipt for expenses.decide.
--
-- EXPAND-ONLY (ARCHITECTURE §18): a defaulted column, a new list key, a new table and functions,
-- one more trigger on list_items that only ever looks at the new key, and file_visible with the
-- same signature and one extra true-branch. Nothing main's app reads changes meaning.
-- No notification rows yet: the WORKFLOWS §9 recipient is named in each comment (decision 32).
-- Append-only: never edit once applied.

-- 1. The permission ------------------------------------------------------------------------------
insert into public.role_permissions (role, permission) values ('owner', 'expenses.decide');

-- 2. The receipt amount ---------------------------------------------------------------------------
alter table public.org_settings
  add column expense_receipt_above numeric(12,2) not null default 500
    check (expense_receipt_above >= 0);

comment on column public.org_settings.expense_receipt_above is
  'An expense claim above this amount (INR) needs a receipt photo (PRODUCT §4.18, 3b.3; strictly '
  'above). settings.manage edits it from Settings -> Expenses.';

grant update (expense_receipt_above) on public.org_settings to authenticated;

-- 3. The category list ---------------------------------------------------------------------------
create or replace function app.seed_org_lists()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.list_items (org_id, list_key, name, position)
  values (new.id, 'job_title', 'Video Editor', 'a0'),
         (new.id, 'job_title', 'Graphic Designer', 'a1'),
         (new.id, 'expense_category', 'Travel', 'a0'),
         (new.id, 'expense_category', 'Food', 'a1'),
         (new.id, 'expense_category', 'Materials', 'a2'),
         (new.id, 'expense_category', 'Other', 'a3');
  return null;
end;
$$;

comment on function app.seed_org_lists() is
  'AFTER INSERT on organizations: the launch job titles (PRODUCT §7) and, since 3b.3, the expense '
  'categories (PRODUCT §4.18). Rows, not code: the Owner changes them in Settings.';

insert into public.list_items (org_id, list_key, name, position)
select o.id, 'expense_category', t.name, t.position
from public.organizations o
cross join (values ('Travel', 'a0'), ('Food', 'a1'), ('Materials', 'a2'), ('Other', 'a3')) t(name, position)
where not exists (
  select 1 from public.list_items li where li.org_id = o.id and li.list_key = 'expense_category'
);

-- lists.manage (Admins too) edits lists; the expense categories are the Owner's (PRODUCT §4.18).
-- Not security definer, so a function or a migration (the owner) passes through app.in_transition().
create function app.list_items_owner_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if app.in_transition() then
    return new;
  end if;
  if (new.list_key = 'expense_category' or (tg_op = 'UPDATE' and old.list_key = 'expense_category'))
     and not app.has_permission('expenses.decide') then
    perform app.fail('FORBIDDEN', 'The expense categories are the Owner''s to change.');
  end if;
  return new;
end;
$$;

revoke all on function app.list_items_owner_guard() from public;
grant execute on function app.list_items_owner_guard() to authenticated, service_role;

comment on function app.list_items_owner_guard() is
  'BEFORE INSERT OR UPDATE on list_items (3b.3): an API write to the expense_category list needs '
  'expenses.decide (the Owner), although lists.manage opens every other list to Admins.';

create trigger list_items_owner_guard before insert or update on public.list_items
  for each row execute function app.list_items_owner_guard();

-- 4. expense_claims -------------------------------------------------------------------------------
create table public.expense_claims (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.members (id),
  expense_date date not null,
  amount numeric(12,2) not null check (amount > 0),
  category_id uuid not null references public.list_items (id),
  note text not null check (length(btrim(note)) between 1 and 500),
  receipt_file_id uuid null references public.files (id),
  state text not null default 'submitted'
    check (state in ('submitted', 'approved', 'rejected', 'withdrawn', 'paid')),
  decided_by uuid null references public.members (id),
  decided_at timestamptz null,
  decision_reason text null,
  paid_on date null,
  paid_by uuid null references public.members (id),
  paid_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint expense_claims_receipt_key unique (receipt_file_id),
  constraint expense_claims_decided check (
    (state in ('approved', 'rejected', 'paid')) = (decided_by is not null and decided_at is not null)
    and (decided_by is null) = (decided_at is null)),
  constraint expense_claims_reason check ((state = 'rejected') = (decision_reason is not null)),
  constraint expense_claims_paid check (
    (state = 'paid') = (paid_on is not null)
    and (paid_on is null) = (paid_by is null)
    and (paid_on is null) = (paid_at is null))
);

comment on table public.expense_claims is
  'A member''s own expense claim (PRODUCT §4.18, 3b.3; ADR-0007 amendment 2026-09-27): submitted -> '
  'approved -> paid, submitted -> rejected (reason shown) or withdrawn. RLS: own rows, all for '
  'expenses.decide; an Admin never reads anyone else''s. Read only through modules/expenses. Every '
  'write is a transition function.';

create index expense_claims_member_date_idx on public.expense_claims (member_id, expense_date);
create index expense_claims_pending_idx on public.expense_claims (created_at) where state = 'submitted';
create index expense_claims_state_date_idx on public.expense_claims (state, expense_date);
create index expense_claims_category_idx on public.expense_claims (category_id);
create index expense_claims_decided_by_idx on public.expense_claims (decided_by);
create index expense_claims_paid_by_idx on public.expense_claims (paid_by);

create trigger set_updated_at before update on public.expense_claims
  for each row execute function app.set_updated_at();
create trigger protect_columns before update on public.expense_claims
  for each row execute function app.protect_columns(
    'member_id', 'expense_date', 'amount', 'category_id', 'note', 'receipt_file_id', 'state',
    'decided_by', 'decided_at', 'decision_reason', 'paid_on', 'paid_by', 'paid_at');
create trigger audit_row_change after insert or update or delete on public.expense_claims
  for each row execute function app.audit_row_change();

alter table public.expense_claims enable row level security;
create policy expense_claims_select on public.expense_claims for select to authenticated
  using (member_id = (select c.id from app.current_member() c)
         or (select app.has_permission('expenses.decide')));

comment on policy expense_claims_select on public.expense_claims is
  'The claimant''s own rows; every row for expenses.decide (the Owner). Nothing for anyone else: '
  'an Admin reads no one else''s claims, not even their team''s (ADR-0007 amendment).';

revoke all on public.expense_claims from anon;
revoke insert, update, delete, truncate, references, trigger on public.expense_claims from authenticated;

-- activity_log: the claimant reads the entries about their own claims (the Owner: activity.view_all).
create policy activity_log_select_expenses_self on public.activity_log for select to authenticated
  using (org_id = (select c.org_id from app.current_member() c)
         and entity = 'expense_claims'
         and entity_id in (select e.id from public.expense_claims e
                           where e.member_id = (select c.id from app.current_member() c)));

comment on policy activity_log_select_expenses_self on public.activity_log is
  'Entries about the caller''s own expense claims (3b.3). The Owner reads everything through '
  'activity.view_all; nobody else reads an expense entry.';

-- 5. A receipt is the claimant's and the Owner's --------------------------------------------------
create or replace function app.file_visible(p_file_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_file public.files;
  v_caller uuid;
  v_org uuid;
begin
  select m.id, m.org_id into v_caller, v_org from app.current_member() m;
  if v_caller is null then
    return false;
  end if;
  select f.* into v_file from public.files f where f.id = p_file_id and f.org_id = v_org;
  if v_file.id is null then
    return false;
  end if;
  if v_file.uploaded_by = v_caller then
    return true;
  end if;
  if v_file.preview_of is not null then
    return app.file_visible(v_file.preview_of);
  end if;
  if exists (select 1 from public.organizations o where o.logo_file_id = v_file.id and o.id = v_org) then
    return true;
  end if;
  if exists (
    select 1 from public.members m
    where m.avatar_file_id = v_file.id and m.org_id = v_org
      and (m.id = v_caller or app.has_permission('team.view'))
  ) then
    return true;
  end if;
  if exists (
    select 1 from public.client_brand b
    where b.logo_file_id = v_file.id
      and (app.client_visible(b.client_id) or b.client_id in (select app.labelled_client_ids()))
  ) then
    return true;
  end if;
  if app.has_permission('expenses.decide')
     and exists (select 1 from public.expense_claims e where e.receipt_file_id = v_file.id) then
    return true;
  end if;
  return false;
end;
$$;

comment on function app.file_visible(uuid) is
  'May the caller read this file? The uploader; anyone for the company logo; team.view or the '
  'person for an avatar; app.client_visible() or a label row for a client logo; expenses.decide '
  'for an expense receipt (3b.3); a preview follows its original (PERMISSIONS §3, kickoff 3).';

-- Helpers ------------------------------------------------------------------------------------------
create function app.expense_window_start(today date)
returns date
language sql
immutable
strict
parallel safe
set search_path = ''
as $$
  select case
    when extract(day from today) <= 5 then (date_trunc('month', today::timestamp) - interval '1 month')::date
    else date_trunc('month', today::timestamp)::date
  end;
$$;

revoke all on function app.expense_window_start(date) from public;
grant execute on function app.expense_window_start(date) to authenticated, service_role;

comment on function app.expense_window_start(date) is
  'The first date a claim may carry on that IST day (kickoff 3b decision 24): the 1st of the month, '
  'or the 1st of the previous month while the day is the 1st-5th. The TS mirror is '
  'modules/expenses claimWindow().';

create function app.expenses_require_decider(out caller_id uuid, out org_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
begin
  select m.id, m.org_id into caller_id, org_id from app.current_member() m;
  if caller_id is null then
    perform app.fail('UNAUTHENTICATED', 'Your account is not active.');
  end if;
  if not app.has_permission('expenses.decide') then
    perform app.fail('FORBIDDEN', 'Only the Owner decides expense claims.');
  end if;
end;
$$;

revoke all on function app.expenses_require_decider() from public;
grant execute on function app.expenses_require_decider() to authenticated, service_role;

comment on function app.expenses_require_decider() is
  'The caller''s id and organization, or UNAUTHENTICATED / FORBIDDEN without expenses.decide.';

-- A claim's row, locked, in the caller's organization.
create function app.expense_claim_lock(p_claim_id uuid, p_org uuid)
returns public.expense_claims
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_claim public.expense_claims;
begin
  select e.* into v_claim
  from public.expense_claims e
  join public.members m on m.id = e.member_id and m.org_id = p_org
  where e.id = p_claim_id
  for update of e;
  if v_claim.id is null then
    perform app.fail('NOT_FOUND', 'This claim does not exist.');
  end if;
  return v_claim;
end;
$$;

revoke all on function app.expense_claim_lock(uuid, uuid) from public, authenticated;
grant execute on function app.expense_claim_lock(uuid, uuid) to service_role;

comment on function app.expense_claim_lock(uuid, uuid) is
  'Internal (3b.3): the claim row locked for update, NOT_FOUND outside the organization. Called by '
  'the security definer functions below (as the owner).';

-- expense_claim_submit -----------------------------------------------------------------------------
create function public.expense_claim_submit(
  expense_date date, amount numeric, category_id uuid, note text, receipt_file_id uuid default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid;
  v_org uuid;
  v_today date := app.today_ist();
  v_note text := nullif(btrim(coalesce(note, '')), '');
  v_above numeric;
  v_file public.files;
  v_id uuid;
begin
  select r.caller_id, r.org_id into v_caller, v_org from app.attendance_require_self() r;

  if amount is null or amount <= 0 then
    perform app.fail('VALIDATION', 'Enter an amount above ₹0.');
  end if;
  if amount <> round(amount, 2) then
    perform app.fail('VALIDATION', 'Use rupees and paise: two decimals at most.');
  end if;
  if amount >= 10000000000 then
    perform app.fail('VALIDATION', 'That amount is too large.');
  end if;
  if expense_date is null then
    perform app.fail('VALIDATION', 'Pick the day of the expense.');
  end if;
  if expense_date > v_today then
    perform app.fail('VALIDATION', 'An expense can''t be in the future.');
  end if;
  if expense_date < app.expense_window_start(v_today) then
    perform app.fail('VALIDATION', 'Claims are for this month (and last month until the 5th).');
  end if;
  if not exists (
    select 1 from public.list_items li
    where li.id = expense_claim_submit.category_id and li.org_id = v_org
      and li.list_key = 'expense_category' and li.archived_at is null) then
    perform app.fail('VALIDATION', 'Choose a category from the list.');
  end if;
  if v_note is null then
    perform app.fail('VALIDATION', 'Say what it was for.');
  end if;
  if length(v_note) > 500 then
    perform app.fail('VALIDATION', 'Keep the note under 500 characters.');
  end if;

  select s.expense_receipt_above into v_above from public.org_settings s where s.org_id = v_org;
  if receipt_file_id is null and amount > coalesce(v_above, 500) then
    v_above := coalesce(v_above, 500);
    perform app.fail('VALIDATION', 'Add a receipt photo: it''s needed above ₹'
      || case when v_above = trunc(v_above) then trunc(v_above)::text else v_above::text end || '.');
  end if;

  if receipt_file_id is not null then
    -- The checks app.files_reference_guard makes on a plain column update, here because a
    -- security definer function passes that guard (app.in_transition()).
    select f.* into v_file from public.files f where f.id = expense_claim_submit.receipt_file_id for update;
    if v_file.id is null or v_file.org_id <> v_org then
      perform app.fail('NOT_FOUND', 'This file does not exist.');
    end if;
    if v_file.uploaded_by is distinct from v_caller then
      perform app.fail('FORBIDDEN', 'Only the person who uploaded a file can attach it.');
    end if;
    if v_file.status <> 'ready' then
      perform app.fail('INVALID_STATE', 'The upload has not finished.');
    end if;
    if v_file.archived_at is not null then
      perform app.fail('INVALID_STATE', 'This file was replaced. Upload it again.');
    end if;
    if v_file.created_at <= now() - interval '6 days' then
      perform app.fail('INVALID_STATE', 'This upload has expired. Upload the file again.');
    end if;
    if v_file.preview_of is not null then
      perform app.fail('VALIDATION', 'Attach the original, not its preview.');
    end if;
    if v_file.mime not in ('image/png', 'image/jpeg', 'image/webp') then
      perform app.fail('VALIDATION', 'A receipt is a PNG, JPEG or WebP photo.');
    end if;
    if app.file_reference_count(v_file.id) > 0 then
      perform app.fail('CONFLICT', 'This file is already used elsewhere. Upload it again.');
    end if;
  end if;

  perform set_config('app.audit_override', jsonb_build_object('action', 'submitted')::text, true);
  insert into public.expense_claims (member_id, expense_date, amount, category_id, note, receipt_file_id)
  values (v_caller, expense_date, amount, category_id, v_note, receipt_file_id)
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.expense_claim_submit(date, numeric, uuid, text, uuid) from public, anon;
grant execute on function public.expense_claim_submit(date, numeric, uuid, text, uuid) to authenticated, service_role;

comment on function public.expense_claim_submit(date, numeric, uuid, text, uuid) is
  'attendance.self (Admins and Staff; the Owner has no claims). The claim window: this IST month, or '
  'last month through the 5th, never a future date; an active expense_category; amount > 0 with at '
  'most two decimals; the note required (≤ 500); a receipt required above '
  'org_settings.expense_receipt_above: a ready, unarchived PNG / JPEG / WebP original the caller '
  'uploaded less than 6 days ago and attached nowhere else. Audit action: submitted. Notifies the '
  'Owner, with no amount in the text (WORKFLOWS §9; the notification row is 5.1''s).';

-- expense_claim_withdraw ---------------------------------------------------------------------------
create function public.expense_claim_withdraw(claim_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid;
  v_org uuid;
  v_claim public.expense_claims;
begin
  select r.caller_id, r.org_id into v_caller, v_org from app.attendance_require_self() r;
  v_claim := app.expense_claim_lock(claim_id, v_org);
  if v_claim.member_id <> v_caller then
    -- Someone else's claim does not exist for the caller (RLS hides it too).
    perform app.fail('NOT_FOUND', 'This claim does not exist.');
  end if;
  if v_claim.state <> 'submitted' then
    perform app.fail('INVALID_STATE', 'This claim has already been decided.');
  end if;
  perform set_config('app.audit_override', jsonb_build_object('action', 'withdrawn')::text, true);
  update public.expense_claims set state = 'withdrawn' where id = v_claim.id;
  return v_claim.id;
end;
$$;

revoke all on function public.expense_claim_withdraw(uuid) from public, anon;
grant execute on function public.expense_claim_withdraw(uuid) to authenticated, service_role;

comment on function public.expense_claim_withdraw(uuid) is
  'The claimant, while the claim is submitted -> withdrawn. NOT_FOUND for anyone else''s claim. '
  'Audit action: withdrawn. Notifies nobody (the Owner''s Approvals list simply loses it).';

-- expense_claim_decide -----------------------------------------------------------------------------
create function public.expense_claim_decide(claim_id uuid, decision text, reason text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid;
  v_org uuid;
  v_reason text := app.clean_reason(reason);
  v_claim public.expense_claims;
begin
  select r.caller_id, r.org_id into v_caller, v_org from app.expenses_require_decider() r;
  if decision is null or decision not in ('approve', 'reject') then
    perform app.fail('VALIDATION', 'The decision is approve or reject.');
  end if;
  if decision = 'reject' and v_reason is null then
    perform app.fail('REASON_REQUIRED', 'A rejection needs a reason.');
  end if;
  v_claim := app.expense_claim_lock(claim_id, v_org);
  if v_claim.state <> 'submitted' then
    perform app.fail('INVALID_STATE', case v_claim.state
      when 'withdrawn' then 'This claim was withdrawn.'
      else 'This claim has already been decided.' end);
  end if;

  if decision = 'approve' then
    perform set_config('app.audit_override', jsonb_build_object('action', 'approved')::text, true);
    update public.expense_claims
    set state = 'approved', decided_by = v_caller, decided_at = now()
    where id = v_claim.id;
  else
    perform set_config('app.audit_override', jsonb_build_object('action', 'rejected')::text, true);
    update public.expense_claims
    set state = 'rejected', decided_by = v_caller, decided_at = now(), decision_reason = v_reason
    where id = v_claim.id;
  end if;
  return v_claim.id;
end;
$$;

revoke all on function public.expense_claim_decide(uuid, text, text) from public, anon;
grant execute on function public.expense_claim_decide(uuid, text, text) to authenticated, service_role;

comment on function public.expense_claim_decide(uuid, text, text) is
  'expenses.decide (the Owner), a submitted claim only. approve -> approved; reject -> rejected with '
  'the reason (REASON_REQUIRED without one), which the member reads. Audit: approved | rejected. '
  'Notifies the member, with no amount in the text (WORKFLOWS §9; 5.1).';

-- expense_claim_mark_paid --------------------------------------------------------------------------
create function public.expense_claim_mark_paid(claim_id uuid, paid_on date default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid;
  v_org uuid;
  v_today date := app.today_ist();
  v_paid_on date := coalesce(paid_on, app.today_ist());
  v_claim public.expense_claims;
begin
  select r.caller_id, r.org_id into v_caller, v_org from app.expenses_require_decider() r;
  if v_paid_on > v_today then
    perform app.fail('VALIDATION', 'The payment date can''t be in the future.');
  end if;
  v_claim := app.expense_claim_lock(claim_id, v_org);
  if v_claim.state <> 'approved' then
    perform app.fail('INVALID_STATE', case v_claim.state
      when 'paid' then 'This claim is already marked paid.'
      else 'Only an approved claim can be marked paid.' end);
  end if;
  if v_paid_on < v_claim.expense_date then
    perform app.fail('VALIDATION', 'The payment date can''t be before the expense.');
  end if;
  perform set_config('app.audit_override', jsonb_build_object('action', 'paid')::text, true);
  update public.expense_claims
  set state = 'paid', paid_on = v_paid_on, paid_by = v_caller, paid_at = now()
  where id = v_claim.id;
  return v_claim.id;
end;
$$;

revoke all on function public.expense_claim_mark_paid(uuid, date) from public, anon;
grant execute on function public.expense_claim_mark_paid(uuid, date) to authenticated, service_role;

comment on function public.expense_claim_mark_paid(uuid, date) is
  'expenses.decide, an approved claim only -> paid on paid_on (default today, IST; not in the future, '
  'not before the expense). Audit action: paid. Notifies the member, with no amount in the text '
  '(WORKFLOWS §9; 5.1).';
