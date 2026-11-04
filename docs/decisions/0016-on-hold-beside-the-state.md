# ADR-0016: On hold is a pair of columns beside the state, not a new state value

- **Status:** accepted
- **Date:** 2026-11-02 (v1.9 W7; the owner settled On hold on 2026-10-23, 29 Oct and 2 Nov; the choice of shape was left to the build and is recorded here)

## Context

The owner asked for an **On hold** state for staff tasks and client projects (ROADMAP v1.9 W7, the
approved sample `docs/design/v19-screens-sample.html` §1–2): a hold has a required reason, stops
every clock (overdue, reminders, escalations, new cycles, end-of-cycle prompts), and a resume
returns the work to where it was, asking for new dates where they passed. Production is live, so
the change must be expand-only (CLAUDE.md), and every transition goes through a Postgres function
(ADR-0006).

Two shapes were possible:

1. **A new enum value** (`task_state = 'on_hold'`, `project_state = 'on_hold'`). Adding a value is
   expand-only, but:
   - a held task must remember the state it resumes to (to do, in progress or changes requested),
     so a second column (`resume_state`) is needed anyway;
   - every function, check, RLS rule and read that switches on the state would change meaning at
     once: about forty places read `state not in ('completed', 'cancelled')` as "open", and every
     one would silently start treating `on_hold` as open (counted as overdue, reminded, escalated)
     or, if excluded, as closed (dropped from History-backed counts and reports); each transition's
     state check (`task_submit_done` from `todo`/`in_progress`, `item_*` on `open`, `project_*` on
     `open`/`in_progress`) would refuse or accept held work by accident;
   - `ALTER TYPE … ADD VALUE` cannot be used in the transaction that adds it, so the migration
     would have to split, and the generated TypeScript unions would change for every screen.
2. **Columns beside the state**: `held_at`, `held_by`, `hold_reason` (all null when not held; a
   check keeps them together) and `resumed_at` (the last resume), on `tasks` and on `projects`.

## Decision

**On hold is the second shape.** The state column keeps the state the work resumes to; a hold is
`held_at is not null`.

- **Who may hold** is checked by the new transition functions (`task_hold`, `task_resume`,
  `project_hold`, `project_resume`), with `activity_log` entries `held` / `resumed` (the reason, the
  hold's start and author, the old and new dates) and their notifications (WORKFLOWS §9).
- **What a hold freezes** is enforced for every caller by one guard trigger, `app.on_hold_guard()`:
  a held task's state does not move except to `cancelled` (which ends the hold) and its stages are
  not ticked; a held project's state moves only to `completed` or `cancelled` (ending the hold), its
  deliverables are not marked done, sent back, reopened or carry-decided, their stages are not
  ticked, and no cycle is inserted. A trigger rather than a check in each function, so no existing
  or future path (the bulk functions, the old 7A functions kept for expand-only, a carry's new
  cycle) can miss it.
- **What a hold stops** is a filter `held_at is null` added to the jobs and reads that count or send
  (reminders, acknowledgement repeats and escalations, the Owner's not-noted risks, the Tasks badge,
  the end-of-day report, the digest, E1–E3, the "cycle ready" notice, the end-of-cycle prompt, the
  Clients list's late count, the nightly cycle job). Re-created with the same signatures.
- **Only work still in progress is held:** a task with its people (to do, in progress, changes
  requested; never one handed in), a project open or in progress (checks on both tables).
- **The clocks start again at the resume** (`resumed_at`): the acknowledgement repeats and
  escalations count from it, and the nightly cycle job makes no period that ended before it.

## Consequences

- Every existing state check, enum, union type and report keeps its meaning; nothing that reads the
  state needed to change unless it counts or sends something time-based.
- **Anything new that counts overdue work, sends a reminder or escalation, or makes a cycle must
  read `held_at`** (WORKFLOWS §3.1a, §5.5). The pgTAP file 127 holds the jobs to it at explicit
  instants; the domain helpers (`isOverdue`, `needsYou`, `badgeCount`, the Today risks) take
  `heldAt` so the screens agree.
- A list that shows held work beside other work filters on `held_at` (W8's "On hold · n" line), not
  on the state.
- If a deliverable-level hold is ever wanted, it follows the same shape on `project_items`.
