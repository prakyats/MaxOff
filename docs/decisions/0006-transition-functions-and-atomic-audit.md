# ADR-0006: Workflow changes through Postgres transition functions with atomic audit

- **Status:** accepted
- **Date:** 2026-09-20

## Context
Approvals, attendance, leave, money and month closing must be trustworthy. v2 requires that a business change can never succeed without its audit record. v1's pattern (repository write, then a separate `recordActivity()` call) could leave a change without an audit entry if the second call failed.

## Decision
- Every workflow state change is a `security definer` Postgres function that checks actor, permission, scope, current state and inputs, then writes the change, history rows, `activity_log` and notifications **in one transaction**.
- State columns aren't directly updatable by `authenticated` (no RLS update grant on them + a guard trigger).
- Plain edits are audited by a generic `audit_row_change()` trigger (same transaction).
- Append-only tables have UPDATE/DELETE revoked.

## Consequences
- The core business rules live in SQL and are tested with pgTAP, so they can't be bypassed from any client.
- More logic lives in SQL than is usual for a TypeScript app. Functions must follow the conventions (explicit `search_path`, error codes, tests for every path).
- Server actions stay thin.
