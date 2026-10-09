# ADR-0007: Money is isolated and recognised only on Owner approval

- **Status:** accepted, amended 2026-09-21 (Potential keeps closed items; template categories are Owner-only; column guard); amended 2026-09-27 (a member's own expense claims, see the amendment at the end); amended 2026-10-02 (owner decision, kickoff 9: one-time projects are a lump sum earned on completion; advances; the retainer split takes the rest); amended 2026-10-09 (owner decision, kickoff 9 decision 24: a "Not needed" close is left out of Potential)
- **Date:** 2026-09-20

## Context
Financial data is Owner-only. Revenue must be reconstructable (planned value, allocation, approval, override), and must count only after the Owner approves the work item. v2's allocation rules (explicit values, or an even split) are kept and applied to project cycles and one-time projects.

## Decision
- Amounts live only in `project_billing`, `item_billing`, `cycle_billing` and `revenue_overrides`, all with a single policy `has_permission('finance.view')`.
- Billing category is a column on `projects` (not an amount), but only the Owner can change it (transition function, plus a guard trigger on `billing_category`, `client_id` and `recurrence`). An Admin-created project takes the category from its recurrence; a template's default category applies only when the Owner creates the project.
- Calculation is done by SQL views (security invoker): an item's value is its explicit value or an even split. Achieved = approved items, attributed to their origin cycle's period. An item closed at the carry decision **keeps its value in Potential** and is reported as *closed, not achieved*; only items cancelled before their cycle started are excluded. Overrides are stored beside the calculated value, never replacing it.
- `eod_reports` and `month_snapshots` contain revenue, so they're Owner-only tables. Admin scoped reports are computed live without money.
- Only `modules/revenue` may query money. Others render its exported components.

## Consequences
- Admins and Staff can't see money through any path (API, Realtime, exports, search), and pgTAP proves it.
- Changing an allocation rule later means changing a view definition, while closed months stay frozen in snapshots.

## Amendment 2026-09-27: expense claims (owner decision, phase 3b)
Staff and Admins now enter money themselves: **expense claims** (reimbursements, PRODUCT §4.18). The rule is narrowed, not dropped:
- **Business money stays Owner-only**, exactly as above: revenue, billing, item values, overrides, month snapshots and anything derived from them, readable only through `modules/revenue`.
- **A member's own expense claims are the one exception.** They live in their own module (`modules/expenses`, not `modules/revenue`) and their own tables. RLS: the claimant reads their own rows; `expenses.decide` (Owner only) reads and decides all; **Admins are denied every row, including their team's**, and pgTAP proves it per role. Claim amounts never appear in notifications' text, search, Realtime payloads other than the claimant's own, or any Admin payload.
- The 0.4 money-import lint rule keeps `modules/revenue` sealed; `modules/expenses` gets the same treatment (only its own `index.ts`, no import from revenue and vice versa).
- **No salary is stored.** The month summary (PRODUCT §4.18) gives the Owner days and claim totals; pay is calculated outside MaxOff.
- Freelancers have no claims in the pilot.

## Amendment 2026-10-02: one-time projects, advances and the retainer split (owner decision, kickoff 9 decisions 2, 4 and 23)
**Retainers (weekly and monthly projects) keep the rule above**: an item's value is its explicit value or its share of an even split, Achieved = approved items attributed to their origin cycle's period (the IST month the cycle's period starts), and a closed item stays in Potential. One refinement (decision 4): explicit values come off the top and **the rest** of the cycle's amount is split evenly across the other planned items, so a cycle always adds up to its amount; each cycle keeps its own amount (`cycle_billing`), the project's being the default (decision 3).

**One-time projects no longer follow the item rule.** A one-time project is **one lump sum, earned on delivery**:
- Its items carry no value (no `item_billing` rows); an override and the billing status apply to the project as a whole.
- **Potential** sits in the IST month of the project's **delivery date** (`projects.delivery_date`, required on one-time projects; added in phase 7 by the kickoff 7 amendment of 2026-10-02); while it is overdue and unfinished, in the current month ("Was due 15 Nov").
- **Achieved is all or nothing**: nothing until the **Owner completes the project** (`project_complete`), then the full amount in the IST month of the completion, early or late, with its Potential in that month too. Reopening takes it back to not achieved.
- **Cancelled**: "Closed, not achieved" in the month it was cancelled, its Potential with it.
- A closed month's snapshot is never rewritten by these moves; corrections stay explicit.

"Revenue counts only for Owner-approved project items" (CLAUDE.md invariant 3) still holds: a one-time project can be completed only once every item is approved, carried or cancelled, and completion is the Owner's.

**Advances (decision 23):** one-time projects only. An advance received (and its return) is an amount, so it lives in a new Owner-only table, **`project_advances`**, beside the four above, with the same single policy (`finance.view` to read, `finance.edit` to write through `modules/revenue`), audited, never in Realtime, notifications, search or exports for anyone but the Owner. **An advance is never Achieved**: it is reported as its own figure, "Advances received", in the month received; the lump sum is still Achieved only on completion. The money-relation lint list (ARCHITECTURE §3.1) and the "no money table in the publication" pgTAP include `project_advances`.

Nothing else in this ADR changes: money stays in Owner-only tables read only through `modules/revenue`, and Admins and Crew never see an amount.

## Amendment 2026-10-09: two kinds of Close (owner decision, kickoff 9 decision 24)
- Phase 7 stores a close kind on an item closed from the item sheet or the carry screen: **"Not needed"** (scope the client didn't want that period) or **"Not delivered"**. The kind is not money and Admins set it.
- **A "Not needed" close is excluded from Potential exactly like an item cancelled before its cycle started**, whenever it was closed. "Not delivered", and any close without a kind (older rows, a cancelled project's items), keeps the rule above: in Potential, reported as *closed, not achieved*.
