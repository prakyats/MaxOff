# ADR-0002: Business customization is data, not code

- **Status:** accepted (written 2026-09-19 for v1, rewritten 2026-09-21 for the v2 product)
- **Date:** 2026-09-19

## Context
Pixora's way of working changes over time, and each client is different. Anything hard-coded (job titles, task types, stage lists, thresholds, holidays, extra fields) would mean a code change and a deploy for an ordinary business decision. The CEO must be able to control every configurable element without a developer.

## Decision
- **Editable lists** live in `list_items` (job titles today, more keys later) and in their own tables where they carry behaviour: `task_types` (event or normal, calendar, default reminders), `stage_presets` (the stage lists for client projects), `holidays`.
- **Extra fields** on clients, contacts, projects, items and tasks come from `field_definitions` and are stored in a `custom_fields jsonb` column, validated by a zod schema built from the active definitions. A field can apply everywhere, to one client, or to one task type. There is **no currency field type**, and field definitions on **projects and items are CEO-only** (amended 2026-09-21), so money can't leak in through a "number" field either.
- **Thresholds and company rules** live in `org_settings`: weekly off days, holiday list, acknowledgement and escalation hours, logout reminder time, default reminder schedule, workload warning threshold.
- **Templates** (project and task) are data too, and everything they generate stays editable.
- **Code depends only on the fixed categories** in DATA-MODEL §0 (roles, workflow states, field types, recurrence, billing category). Names users can edit are never used in logic.
- **The CEO owns all of it** through Settings. Nothing configurable is a developer task.

## Consequences
- New task types, stages, job titles, fields and templates need no deploy.
- The engines (lists, custom fields, settings) are built early (phases 1–3) and must be well tested, because everything else leans on them.
- Reporting on custom fields uses jsonb queries, with indexes added as needed.
