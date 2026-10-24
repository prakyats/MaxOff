# ADR-0015: Colour code: red is urgent or destructive only

- **Status:** accepted
- **Date:** 2026-10-20 (the owner chose option A of ROADMAP 6b.8 on 2026-10-09; recorded in v1.8 unit V1, pre-approved by the advisor for the "Settings and colours" release)

## Context

Since the action colour rule of 2026-09-26 (PRODUCT §2 principle 12 as it then read, ARCHITECTURE
§14.1), **solid brand red was the commit action**: every Save, Create, Send, Approve and Mark done
on every screen was red. Red was also the colour of urgency: overdue tasks, approvals waiting three
days, absences, escalations. On a busy screen the two meanings competed: the Owner's eye went to
the Save button as readily as to the overdue task.

The owner asked for one colour code that guides the eye (ROADMAP **6b.8**, owner 2026-10-09: "any
entity that needs attention asap needs to be highlighted in red… guide the owner's eyes by visual
UI design") and **chose option A**: red means urgent or destructive only. The v1.8 direction
(owner 2026-10-16, "Vercel's clarity with Linear's calm" in MaxOff red, both themes equal) asks for
the same restraint. The decision changes ARCHITECTURE §14.1's rule, so it needs this ADR.

## Decision

1. **Red means act now or destructive, nothing else.** The scale, the same on every screen:
   red = act now, a limit passed (overdue tasks and items, approvals waiting ≥ 3 days, escalations,
   not started after the start time and grace, Task Noted missing past its reminder); amber = soon
   or at risk; blue = in progress, new, unread; green = done, approved, present; grey = nothing to
   do (zero, closed, archived, past). Shown as a dot, coloured text or a thin row edge, never a
   filled red block, and **never colour alone** (always a word or an icon). WCAG AA in light and
   dark.
2. **The commit action is neutral solid** (the look of today's Approve trigger), still **one per
   layer**: the `primary` button variant becomes neutral solid.
3. **Destructive confirms keep a named red button**: a new `danger` variant (solid red) is the
   commit of a destructive action, inside its confirmation only ("Discard changes", "Remove
   Diwali", "Reject claim"). `ConfirmDialog` and `ReasonDialog` choose it when told the act is
   `destructive`. Before the confirmation, a destructive action stays the red-outline
   `destructive` variant. Archiving is not destructive (it can be restored; owner 2026-10-16:
   "archive never red").
4. **One status → colour map** (`STATUS_TONES` and `attendanceStatus`, `core/lib/status-tones.ts`):
   a screen gets a tone from a status or a domain function, never a colour typed per screen.
   Where a threshold is a business rule (1 and 3 days…) it is an `org_settings` value (6b.6).
5. The full rule, the tokens and the lint guard rails are in `docs/DESIGN.md` §4 and §8.

## Consequences

- **Rolled out in steps, one release (v1.8):** V1 changes the **Button primitive** (the `primary`
  look, the `danger` variant), `ConfirmDialog` / `ReasonDialog` and the one hand-built destructive
  confirmation (Deactivate a member), the tokens, the lint rules and the e2e one-solid-per-layer
  fixture (which now counts `danger` as a commit). **V2** moves the components (chips, progress,
  toasts, the Add pattern, the neutral Cancelled), **V3–V4** the screens (Today, Tasks, the project
  page, Clients, Approvals, Calendar, Settings, People, Reports, Me, Alerts) onto the one status
  primitive and the scale above, each list opening with its red group.
- Between V1 and V4 (never released: v1.8 ships as one), some screens still paint status colours
  their own way; they are on the lint allow-list (`DESIGN_TOKEN_EXCEPTIONS`) and leave it as they
  move.
- A red solid button now always means "this destroys something or is final": a destructive or
  final confirmation must pass `destructive`, and a review checks that no other commit uses
  `danger`. **Owner correction 2026-10-21 (V4):** final actions are red: Close deliverable, Cancel
  project / task, Reject, Revoke, Cancel approved leave, Deactivate, Withdraw, Remove, Discard,
  Delete (the Settings lists' Delete included); Archive stays neutral. `final-actions.test.ts`
  sweeps every confirmation's commit label to keep it so. **Cancelled** is red in the one status
  map again (this reverses V2's C5, which had made it neutral).
- Specs that asserted a commit's red look (`bg-primary` as red) assert the variant instead.
- The in-app guide's wording follows: no topic may call a commit "the red button".
- CLAUDE.md's Definition of Done line on the colour rule ("one solid red commit action per layer")
  reads as "one solid commit action per layer; a destructive one is red and named" from now on;
  the owner updates CLAUDE.md's wording.

## Amendment 2026-10-21: the approved colour plan (owner-approved)

**Status:** accepted. The owner approved the colour plan on 2026-10-21 ("colour plan approved with
forest", the sample on issue #89), building on the V4 correction (final actions red, Cancelled
red). It is built in v1.8 unit V5a.

**Decision.**
1. **A fourth solid look, Forest green `approve`** (`--approve` `#15803D`, white text, the same in
   both themes, 5.0:1): the commit of a **positive final decision**: Approve, Approve all, Mark
   done, Grant comp leave. `ConfirmDialog` and `ReasonDialog` take `approve`; a Forest trigger
   that only opens the layer where the commit happens (Approve all, a task's Mark done and
   Approve, the bulk bar's "Mark N done", Grant comp leave) passes `opens`.
2. **`primary` stays the neutral solid** for everyday commits (Save, Create, Send, Start day);
   **`danger` stays the red solid** for final or irreversible acts (the V4 list); **`secondary`**
   (outline) is every second choice: Review, Edit, Correct, Request changes, Send back, a
   dialog's dismiss. A dialog's dismiss says what it keeps ("Keep it", "Keep project"), never a
   bare "Cancel" beside a red "Cancel …".
3. **One solid button per layer** is unchanged: at most one `primary`, `approve` or `danger`
   commit per layer, never beside a solid trigger. On Approvals each group's "Approve all" is the
   green trigger and its rows' Approve are outlines.
4. **The status chips follow one table:** red = Overdue / Late, Cancelled, Rejected, Absent;
   amber = Proposed, Waiting for you, Due soon, Nearly done; blue = In progress, **Open**,
   Planned, Noted; green = Done, Approved, Present, Active; grey = Draft, Archived, Withdrawn,
   Replaced, Not started. The only map change is `open` from grey to blue.

**Consequences.** Green on a button now always means "this approves or finishes something";
the holiday green (`--holiday`) is the same hue but only ever a calendar date, never a button.
`status-badge.test.ts` checks the chip table and the `approve` contrast in both themes;
`final-actions.test.ts` checks every confirmation commit by its label; the e2e one-solid fixture
counts `approve` as a commit and an `approve` with `data-opens` as a trigger. Specs that asserted
`strong` on Approve or Mark done, or the red outline on Request changes, assert the plan's
variant instead. DESIGN.md §4 holds the tables.
