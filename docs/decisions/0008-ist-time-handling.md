# ADR-0008: IST as the single business timezone

- **Status:** accepted
- **Date:** 2026-09-20

## Context
Attendance days, deadlines, overdue, cycles and month close are all defined in IST. Servers (Workers, Postgres, pg_cron) run in UTC.

## Decision
- Store every instant as `timestamptz`. Business dates are always computed with `Asia/Kolkata` through `app.today_ist()` / `app.to_ist_date()` in SQL and `core/time` in TS.
- The timezone is stored in `organizations.timezone` (for SaaS-readiness), but the prototype assumes IST.
- Cron jobs are scheduled in UTC and re-derive the IST date inside the job. All jobs are idempotent.

## Consequences
- There's one place to get dates right, and the tests cover the boundaries (23:59/00:00 IST, month ends).
- Code must never use `new Date()` or `now()::date` for business dates. Review catches this.
