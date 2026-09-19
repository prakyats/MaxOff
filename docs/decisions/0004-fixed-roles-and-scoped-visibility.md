# ADR-0004: Three fixed roles with scoped visibility

- **Status:** accepted
- **Date:** 2026-09-20

## Context
v2 defines exactly three roles: one CEO, many Admins, many Staff. The clarifications add that Admins see only their assigned clients and related tasks, and see others only as availability. Staff see only tasks allotted to them. Money is CEO-only.

## Decision
- `member_role` enum `ceo | admin | staff`. A unique partial index enforces a single CEO. Job titles are a separate list.
- Capabilities are permission keys stored in `role_permissions` (seeded), checked by `has_permission()` in SQL and `can()` in TS.
- Scope (which rows) is decided by RLS helpers: `admin_client_ids()`, task visibility (created / approving / assigned / labelled with an assigned client), assignee-only for Staff.
- Staff see client information only through the `client_labels` view (name + brand basics).
- Admins see other people only through `member_availability()`, which returns counts and busy blocks.
- No custom-role UI in the prototype, though the data model allows it later.

## Consequences
- Access changes (client reassignment, deactivation) take effect immediately because they're evaluated on every query.
- Every table needs per-role pgTAP tests. That's more test code, but it's the main safety net.
- Admin metrics are limited to what Admins can see (PRODUCT §7 open question).
