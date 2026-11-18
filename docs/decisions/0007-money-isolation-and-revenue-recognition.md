# ADR-0007: Money is isolated and recognised only on Owner approval

- **Status:** accepted, amended 2026-09-21 (Potential keeps closed items; template categories are Owner-only; column guard); amended 2026-09-27 (a member's own expense claims, see the amendment at the end); amended 2026-10-01 (owner decision, kickoff 6 decision 16: `eod_reports` holds no money); amended 2026-10-08 (owner decision, kickoff 7 amendment C: an approval or completion by the client's Admin counts like the Owner's; the billing category is money); amended 2026-10-09 (owner decision, kickoff 7 amendment D3: Mark done is the approval; `items.approve` is Send back / Reopen)
- **Date:** 2026-09-20

## Context
Financial data is Owner-only. Revenue must be reconstructable (planned value, allocation, approval, override), and must count only after the Owner approves the work item. v2's allocation rules (explicit values, or an even split) are kept and applied to project cycles and one-time projects.

## Decision
- Amounts live only in `project_billing`, `item_billing`, `cycle_billing` and `revenue_overrides`, all with a single policy `has_permission('finance.view')`.
- Billing category is a column on `projects` (not an amount), but only the Owner can change it (transition function, plus a guard trigger on `billing_category`, `client_id` and `recurrence`). An Admin-created project takes the category from its recurrence; a template's default category applies only when the Owner creates the project.
- Calculation is done by SQL views (security invoker): an item's value is its explicit value or an even split. Achieved = approved items, attributed to their origin cycle's period. An item closed at the carry decision **keeps its value in Potential** and is reported as *closed, not achieved*; only items cancelled before their cycle started are excluded. Overrides are stored beside the calculated value, never replacing it.
- `eod_reports` and `month_snapshots` are Owner-only tables. `eod_reports` is the operational end-of-day summary and **holds no money** (amended 2026-10-01, kickoff 6 decision 16); `month_snapshots` may hold revenue from phase 9. Admin scoped reports are computed live without money.
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

## Amendment 2026-10-01: the end-of-day report holds no money (owner decision, kickoff 6 decision 16)
`eod_reports` is the Owner's **operational** end-of-day summary (attendance, decisions, tasks, approvals, tomorrow's events; WORKFLOWS §8a) and **never carries an amount**, not even after phase 9: expense claims appear only as a count. It **stays an Owner-only table** (`reports.all`). `month_snapshots` may hold revenue from phase 9 and stays Owner-only. Nothing else in this ADR changes.

## Amendment 2026-10-02: one-time projects, advances and the retainer split (owner decision, kickoff 9 decisions 2, 4 and 23)
*Written on the `kickoff-9` branch (PR #42) and brought onto `main` in v2.1's pre-work. The phase 9 refresh of 14 Nov 2026 (`docs/kickoff/phase-9-kickoff-refresh-2026-11-14.md`, OWNER ANSWERS) confirms it, read with the amendments below and with R1, R4, Q1 and Q4 as noted in place.*

**Retainers (weekly and monthly projects) keep the rule above**: an item's value is its explicit value or its share of an even split, Achieved = approved items attributed to their origin cycle's period (the IST month the cycle's period starts), and a closed item stays in Potential. One refinement (decision 4): explicit values come off the top and **the rest** of the cycle's amount is split evenly across the other planned items, so a cycle's planned items add up to its amount; each cycle keeps its own amount (`cycle_billing`), copied when the cycle is made, the project's being the default (decision 3).
- **Additions are priced on top (refresh R4, owner 2026-11-14 and 2026-11-18).** A deliverable **not in the month's plan** (created in a cycle after the cycle's item list was generated: `item_add`, "Also add to ‹month›?", bulk adds) is worth **₹0 until the Owner prices it**, and its value is then **added on top** of the cycle's amount. It never joins the split, so adding one never lowers the value of the others. Work carried in from an earlier cycle is not an addition (it keeps its origin cycle's value).
- **First amount, "this month on" (refresh Q1, owner 2026-11-14 and 2026-11-18).** A project's first amount covers every cycle that **starts on or after the 1st of the current IST month**; earlier cycles keep "No amount set".

**One-time projects no longer follow the item rule.** A one-time project is **one lump sum, earned on delivery**:
- Its items carry no value (no `item_billing` rows); an override and the billing status apply to the project as a whole.
- **Potential** sits in the IST month of the project's **delivery date** (`projects.delivery_date`, required on one-time projects); while it is overdue and unfinished, in the current month ("Was due 15 Nov").
- **Achieved is all or nothing**: nothing until the project is **completed, by the Owner or the client's Admin** (`project_complete`; refresh R1 and the 2026-10-08 amendment below), then the full amount in the IST month of the completion, early or late, with its Potential in that month too. Reopening takes it back to not achieved. Marking a one-time project's last open deliverable done offers **"Mark done and complete project"** or **"Mark done only"**; the Admin sees the same prompt with no amount.
- **Cancelled counts ₹0** (refresh Q4, "always ₹0"): reported as "Closed, not achieved" in the month it was cancelled, its Potential with it; there is no adjusted figure for a cancelled project. Advances kept show separately (below).
- A closed month's snapshot is never rewritten by these moves; corrections stay explicit.

"Revenue counts only for approved project items" (CLAUDE.md invariant 3) still holds: a one-time project can be completed only once every item is done, carried or cancelled.

**Advances (decision 23):** one-time projects only. An advance received (and its return) is an amount, so it lives in a new Owner-only table, **`project_advances`**, beside the four above, with the same single policy (`finance.view` to read, `finance.edit` to write through `modules/revenue`), audited, never in Realtime, notifications, search or exports for anyone but the Owner. **An advance is never Achieved**: it is reported as its own figure, "Advances received", in the month received (a return in its own month); the lump sum is still Achieved only on completion. The money-relation lint list (`MONEY_RELATIONS` in `eslint.config.mjs`, ARCHITECTURE §3.1) names `project_advances` and `item_values_v`, and the "no money table in any publication" pgTAP (`46_notifications_realtime`) names `project_advances` (both since v2.1's pre-work).

Nothing else in this ADR changes: money stays in Owner-only tables read only through `modules/revenue`, and Admins and Crew never see an amount.

## Amendment 2026-10-08: approval by the client's Admin counts (owner decision, kickoff 7 amendment C)
The owner's words: "Admin can tick the projects as done and closed, and that will add to the revenue without owner's intervention".
- **Who makes work revenue-eligible.** An item counts as **Achieved** once it is **approved, by the Owner or by the client's Admin** (`items.approve`, which Admins now hold on **their** clients; the Owner keeps it on every client; *since amendment D3, 2026-10-09, below: the approval is Mark done under `items.tick`, and `items.approve` is the Send back / Reopen*). A one-time project's lump sum (the kickoff 9 rule, decision 2, on the `kickoff-9` branch) is Achieved **when the project is completed, by the Owner or its Admin** (`projects.complete`, the same split), and a reopen by either takes it back. Wherever this ADR or the kickoff 9 decisions say "Owner-approved" or "when the Owner completes", read "approved" and "when the project is completed, by the Owner or its Admin". CLAUDE.md invariant 3 is reworded to match. The Context's "only after the Owner approves the work item" is history.
- **Money stays the Owner's alone**, entered by the Owner when he chooses (phase 9): amounts, item values, **the billing category**, advances, overrides, billing status, revenue and month close. An Admin never sees or sets any of it (invariant 2 unchanged), and approving or completing never shows an amount.
- **The billing category is now money.** It no longer lives on `projects` (the Decision's second bullet is superseded): it moves to the Owner-only billing tables built in phase 9 (`project_billing`, and a project template's default in an Owner-only table beside it), read only through `modules/revenue`. Phase 7 builds no billing category and no `project_set_billing_category`; PERMISSIONS §2's "Admins see the category" is withdrawn. `projects.client_id` and `projects.recurrence` stay fixed after creation (kickoff 7 decision 4).
- Nothing else changes: Potential, the even split, closed items in Potential, overrides beside the calculated value, and money read only through `modules/revenue`.

## Amendment 2026-10-09: Mark done is the approval (owner decision, kickoff 7 amendment D3)
- **Mark done is the approval.** An item marked done by the Owner or by the client's Admin (`items.tick`) is approved in the same step (open → approved), so it counts as **Achieved** at once. There is no separate approval step for client items any more.
- **`items.approve` is now the way back, with a reason:** the Owner's **Send back…** on any done item (the client's Admin is notified) and the client's Admin's **Reopen…** on their clients' done items (audited; the Owner gets an info notification).
- **A reopened or sent-back item stops counting as Achieved** until it is marked done again.
- **Money stays the Owner's alone** (invariant 2 unchanged): marking done, sending back or reopening never shows an amount. The rest of this ADR, the 2026-10-08 amendment included, holds.

## Amendment 2026-10-09: two kinds of Close (owner decision, kickoff 9 decision 24)
*Written on the `kickoff-9` branch; brought onto `main` in v2.1's pre-work and confirmed by the 14 Nov 2026 refresh (decision 24, "built data matches").*
- Phase 7 stores a close kind on an item closed from the item sheet or the carry screen: **"Not needed"** (scope the client didn't want that period) or **"Not delivered"** (`project_items.close_kind`). The kind is not money and Admins set it.
- **A "Not needed" close is excluded from Potential exactly like an item cancelled before its cycle started**, whenever it was closed. "Not delivered", and any close without a kind (older rows, a cancelled project's items), keeps the rule above: in Potential, reported as *closed, not achieved*.
