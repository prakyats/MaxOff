# ADR-0002: Business customization is data, not code

- **Status:** accepted, amended 2026-09-20: under the v2 spec the editable vocabularies are task types, stage presets, job titles, holidays, custom fields and templates. Per-project board statuses and phases are replaced by fixed workflow states plus optional stages (see ADR-0005 and `WORKFLOWS.md`). The principle is unchanged.
- **Date:** 2026-09-19

## Context
Every Pixora client is different: different services, requirements, deliverables, workflows and fields. Pixora's six-step framework is common but not universal. Hard-coding any of it would mean code changes for every new kind of client.

## Decision
- Simple vocabularies (services, deliverable types, asset categories, industries, platforms, tags) are `list_items`, edited in Settings.
- Extra fields on clients, contacts, brand, projects, tasks and deliverables come from `field_definitions` and are stored in a `custom_fields jsonb` column. They are validated by a zod schema built from the active definitions, and can apply to all clients or to one client.
- Workflows are set per project (its own statuses with a fixed *category* todo/active/done, and optional phases with optional gates). They're copied from global or client-specific templates.
- Permissions are role → permission-key rows.
- Code may depend only on fixed *categories* (status category, field type, role system key), never on names users can edit.

## Consequences
- New client needs are usually handled in Settings, not by developers.
- Generic engines (custom fields, lists) are built early (phase 2) and have to be well tested.
- Reporting on custom fields uses jsonb queries, and indexes are added as needed.
