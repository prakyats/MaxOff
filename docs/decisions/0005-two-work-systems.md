# ADR-0005: Client work and staff tasks are separate systems

- **Status:** accepted
- **Date:** 2026-09-20

## Context
The product owner decided (clarification #8) that client work is organised as Client → Projects → items (one-time / weekly / monthly, maintained by the client's Admin), while staff work is daily tasks allotted to people. Staff completion must never update client progress automatically, and Staff must never see client progress. This replaces v2's separate Monthly Scope / Monthly Deliverables / Additional Work concepts and the v1 idea of generating tasks from deliverables.

## Decision
- Module `client-work`: `projects` (recurrence, optional stages, CEO-set billing category), `project_cycles` (one per period; one-time projects have a single cycle), `project_items` (Admin ticks done → CEO approves), carry-forward decided by the CEO.
- Module `tasks`: staff tasks with acknowledgement, the approval chain, reminders and submissions.
- The only link is `tasks.client_id`, an optional **label** for context and visibility. There's no FK from tasks to projects or items, and no triggers between the modules.
- Revenue attaches only to project items (ADR-0007).

## Consequences
- The two systems can change independently. A future optional "related item" reference could be added without coupling their states.
- Admins keep both up to date manually. That's intended, since it reflects how Pixora actually manages work.
- Reports need to show both views side by side (client progress vs team output).
