# ADR-0007: Money is isolated and recognised only on Owner approval

- **Status:** accepted, amended 2026-09-21 (Potential keeps closed items; template categories are Owner-only; column guard); amended 2026-09-27 (a member's own expense claims, see the amendment at the end)
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
