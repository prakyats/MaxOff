-- v3.5 "Month close", U1: the month_snapshots table (DATA-MODEL §9 and §9a; WORKFLOWS §7; PERMISSIONS
-- "Month close"; ADR-0007 amendment 2026-11-25; kickoff 9 decisions 10 and 16-19).
--
-- The snapshot holds a closed month's revenue lines and totals, so it is a MONEY table (CLAUDE.md
-- invariant 2) and is sealed exactly like the five of migration money_tables:
--   * ONE policy: select for finance.view in the caller's org (the Owner);
--   * no insert, update or delete grant to anyone: the only writers will be the security-definer
--     functions month_close() and month_correct() (U2 and U3, months.close);
--   * append-only (ARCHITECTURE §6): UPDATE and DELETE are revoked from authenticated, not just left
--     without a policy. One row per version, never changed: version 1 is the close, version N+1 a
--     correction beside it ("v1 kept; never a hand edit", decision 18);
--   * never in the Realtime publication (pgTAP 46 names it), never in search or a notification.
--
-- NO audit_row_change() trigger, on purpose. That trigger copies the whole row into activity_log.diff,
-- and `data` is the month's amounts. WORKFLOWS §7: "The audit rows carry no amounts and not the note".
-- So the table is audited by the two functions themselves (U2 and U3), under the entity name
-- month_snapshots, with meta = the month and the version only. This migration writes no row.
--
-- EXPAND-ONLY: one new table, its indexes and its policy. Nothing existing changes.
-- Append-only: never edit once applied.

create table public.month_snapshots (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id),
  month date not null,
  version integer not null,
  data jsonb not null,
  closed_by uuid not null references public.members (id),
  closed_at timestamptz not null default now(),
  corrects_id uuid null references public.month_snapshots (id),
  correction_note text null,
  constraint month_snapshots_org_month_version_key unique (org_id, month, version),
  constraint month_snapshots_month_first_day check (extract(day from month) = 1),
  constraint month_snapshots_version_positive check (version >= 1),
  constraint month_snapshots_data_object check (jsonb_typeof(data) = 'object'),
  constraint month_snapshots_correction_pair check (
    (version = 1 and corrects_id is null and correction_note is null)
    or (version > 1 and corrects_id is not null and correction_note is not null)
  ),
  constraint month_snapshots_correction_note_length check (
    correction_note is null or length(btrim(correction_note)) between 10 and 500
  ),
  constraint month_snapshots_corrects_other check (corrects_id is null or corrects_id <> id)
);
create index month_snapshots_corrects_idx on public.month_snapshots (corrects_id) where corrects_id is not null;
comment on table public.month_snapshots is
  'v3.5 Month close (Owner only, money: ADR-0007 amendment 2026-11-25). One row per version of a closed IST month: version 1 is the close, version N+1 a correction (corrects_id = the version it replaces, correction_note 10-500 characters). Never updated or deleted; the latest version is the month''s report. Written only by month_close() / month_correct(); audited by them, with no amount.';
comment on column public.month_snapshots.month is 'The 1st of the IST month.';
comment on column public.month_snapshots.data is 'The frozen report (DATA-MODEL §9a; schema 1). Holds amounts: never copied into activity_log.';

-- RLS: one policy, the Owner's read. No write grant: the functions of U2 and U3 are the only writers.
alter table public.month_snapshots enable row level security;
revoke all on public.month_snapshots from public, anon, authenticated;
grant select on public.month_snapshots to authenticated;
-- Said again by name (ARCHITECTURE §6): an append-only table has UPDATE and DELETE revoked.
revoke update, delete on public.month_snapshots from authenticated;
create policy month_snapshots_select on public.month_snapshots for select to authenticated
  using (org_id = (select c.org_id from app.current_member() c) and (select app.has_permission('finance.view')));
