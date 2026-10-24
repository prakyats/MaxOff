# Phase 9 kickoff questions: revenue, reports and month close (Owner only)

> Prepared by the advisor, 2026-10-22, for the Owner. Docs only: **nothing here is decided yet.** The answers are recorded by `/kickoff-phase 9` in PRODUCT §4.12 / §4.13, WORKFLOWS §6 / §7 / §9, DATA-MODEL, PERMISSIONS, ARCHITECTURE and ADR-0007, then as a "Kickoff 9 decisions" block in PROGRESS.

## What this phase builds
- The Owner's money: amounts per project and cycle, deliverable values, billing status, overrides and advances.
- Potential, Achieved and Remaining by client, category and month, for the Owner only.
- The Owner's reports (people, delays, stage durations, trends) and the month close with snapshots and corrections.
- Units: **9A** = 9.1 (money tables, views) + 9.2 (revenue screens); **9B** = 9.3 (metrics, reports) + 9.4 (month close).
- **Money rules hold:** money is Owner only, in Owner-only tables, read only through `modules/revenue`; never in an Admin or Crew payload, Realtime, search, notifications or exports (invariant 2, ADR-0007).

## Where the draft stands
- **PR #42** (branch `kickoff-9`, 2026-10-02) holds the Owner's answers to 20 questions: all as recommended except decision 2 (his own lump-sum rule for one-time projects, follow-ups 2a–2c), plus his added decision 23 (advances) and decision 24 (two kinds of Close, 2026-10-09). It was **never merged**.
- Since then the Owner changed how client work counts (kickoff 7 amendments C and D). Part A lists what is already answered; part B holds the questions to ask now.

## A. Already answered since the draft (no need to ask)
| Draft point | Now settled by |
|---|---|
| Achieved only when **the Owner** approves or completes | Kickoff 7 amendment C (owner 2026-10-08): the client's Admin counts too. CLAUDE.md invariant 3 and ADR-0007 amendment 2026-10-08 say to read the draft's "when the Owner completes" as "when the project is completed, by the Owner or its Admin". |
| A separate approve step for items | Amendment D3 (owner 2026-10-09, ADR-0007 amendment 2026-10-09): **Mark done is the approval.** The Owner's safety net is Send back; the client's Admin can Reopen. Q2 rewords the draft's "Approve and complete project". |
| The billing category | Amendment C3: it is money, in Owner-only tables (a template's default too); an Admin-created project takes the recurrence default (PRODUCT §4.12). |
| A one-time project's delivery date | Built in 7.1 / 7.2 (kickoff 7 amendment A; WORKFLOWS §5.4 item 19). Phase 9 only reads it. |
| "Project created by an Admin" notice | Wording kept until phase 9 (owner 2026-10-09, answer b2; WORKFLOWS §9). |
| Two kinds of Close (decision 24) | The close kind itself is built in **v1.9** (6b.4 D5, kickoff 6b decision 8). Phase 9 starts after v1.9. |
| The Admin's report (decision 15) | Built: the task KPIs in 6.3, the item KPIs in 7.4 (PRODUCT §4.13). No new Admin numbers. |
| Stages (decision 14) | Stages are optional and per deliverable (amendment D1, D2). Stage durations read each deliverable's own ticks; a deliverable without stages is left out, as in 7.4. |
| Exports (9.5) and activity search (9.6) | Still deferred past the launch (owner 2026-09-27). |
| The Today revenue line as its own streamed chunk (decision 9) | Still required, and now also by the **speed gate** (CLAUDE.md, owner 2026-10-22). |

## B. Questions

### Q1. Do the other draft answers still stand?
The draft answers, in one line each (2b's "Owner" reads "Owner or its Admin", as in part A):
- 1 A retainer cycle belongs to the IST month its period starts in.
- 2, 2a–2c A one-time project is one lump sum: Potential in the delivery-date month (the current month while overdue, "Was due ‹date›"); Achieved all at once when the project is completed; cancelled = "Closed, not achieved" in the cancel month.
- 3 Each retainer cycle keeps its own amount; the project's amount is the default; a change applies from the current cycle on.
- 4 Explicit values come off the top, the rest is split evenly; whole rupees; leftover paise on the first deliverable.
- 5 No amount = "No amount set" (flagged); ₹0 = "Not billable".
- 6 The headline Achieved is the Owner-adjusted figure, "System calculated ₹X" beside it; "Back to calculated" keeps the old override.
- 7 Billing status is independent of approval; it can go back to Not billed; "Mark all N billed".
- 8 Reports → Revenue by month; an Owner-only line on a client's Overview; an Owner-only Billing section on the project page.
- 9 One line on the Owner's Today, masked "₹ •••" until tapped.
- 10 Amounts stay editable after a month is closed, with a warning.
- 11 Task custom fields show "Admins and Crew can see this field. Amounts belong in project billing (Owner only)."
- 12 Periods: Monday–Sunday weeks, IST months, custom ranges up to 366 days; revenue by month only.
- 13 The people report: seven raw columns, freelancers in their own block, nothing ranked or coloured.
- 14 Stage durations, delay patterns, 6-period trends.
- 16–19 Close any ended month in any order, nothing blocks; the snapshot holds every Owner month figure; "Changed since close" and Correct with a note; a reminder from the 6th.
- 20 The copy ("Potential", "Achieved", "Remaining", …).
- 23 Advances on one-time projects: Owner-only `project_advances`, never Achieved, its own figure, can be marked returned, never deleted.
- 24 A "Not needed" close is left out of Potential; "Not delivered" stays in it.
- **Options:** (a) yes, all stand, except where Q2–Q13 change them; (b) go through each again; (c) yes, with named changes.
- **Recommended: (a).** These are the Owner's own answers; part A already applies the later changes.
- **Affects:** all of 9A and 9B; ADR-0007 (decisions 2, 4, 23, 24).

### Q2. A one-time project's last deliverable is marked done
Since D3, marking done is the approval, so the draft's "Approve and complete project" has no step to sit on.
- **Options:** (a) when the Owner or the client's Admin marks the **last open** deliverable done, offer "Mark done and complete project" (main) and "Mark done only"; (b) no offer: completing stays its own action, and the Revenue screen lists the project as "Ready to complete"; (c) the project completes by itself when the last deliverable is done.
- **Recommended: (a), with "Ready to complete" kept for (b)'s case.** One tap finishes the project, and a stray tick never books the lump sum by itself. The offer shows no amount, so it is safe for Admins.
- **Affects:** the deliverable's Mark done, `project_complete`, the Revenue screen.

### Q3. Show who made a figure count
Since amendment C an Admin's Mark done or completion books revenue without the Owner.
- **Options:** (a) each Achieved line on the Revenue screen names who made it count ("Done by Prakyat, 3 Oct"); (b) no names, only the figures.
- **Recommended: (a).** Every figure must be traceable (PRODUCT §4.12), and it lets the Owner spot an Admin's mistake and Send back.
- **Affects:** the revenue views and the Revenue screen (Owner only).

### Q4. Deliverables added to a running cycle
Deliverables can be added mid-cycle (+ Add deliverable, v1.9's "Also add to this period?", extras kept at month end).
- **Options:** (a) they are planned like the others: the cycle's amount is split over more deliverables and the cycle still adds up to its amount (today's WORKFLOWS §6 rule); (b) an added one is worth ₹0 unless the Owner sets a value, and only then adds to Potential; (c) the Owner is asked each time.
- **Recommended: (a).** A retainer's fee does not change when work is added; paid extra work belongs in an "Additional Work" project.
- **Affects:** the definition of planned deliverables and the value view in 9.1.

### Q5. Deliverables from "× N" templates
"Reel × 8" plus "Shoot day × 1" get equal shares under the even split.
- **Options:** (a) keep the even split, and the Owner types explicit values where it matters (draft decision 4); (b) a default value per deliverable template, in an Owner-only table; (c) weights per deliverable.
- **Recommended: (a).** It is already settled and simple; (b) can come later if the Owner keeps typing the same values.
- **Affects:** 9.1's scope.

### Q6. GST
- **Options:** (a) amounts are entered **before GST** (the fee); MaxOff does no tax, and the Billing section says "Amounts before GST"; (b) amounts include GST; (c) no rule, the Owner's choice.
- **Recommended: (a).** Revenue is the fee, and GST invoicing is in "Later" on the ROADMAP.
- **Affects:** the Billing section's copy and the report labels.

### Q7. Costs beside revenue
- **Options:** (a) no: phase 9 shows revenue only; expense totals sit in the month snapshot (draft decision 17); (b) an "Expenses paid" line beside revenue on Reports → Revenue; (c) profit per project.
- **Recommended: (a).** There is no accounting in the prototype, and (b) or (c) would need cost rules nobody has decided.
- **Affects:** Reports → Revenue.

### Q8. The Owner in the people report
Since v1.7.1 the Owner can have tasks (6b.2).
- **Options:** (a) leave the Owner out of the people report; (b) show the Owner as a row.
- **Recommended: (a).** The report is about the team, and nobody reviews the Owner's own tasks.
- **Affects:** 9.3's metrics views.

### Q9. Late starts and leaving early (v1.9) in the reports
- **Options:** (a) add raw counts (late days, left early, left early not answered) to the Month view's attendance lines and the snapshot, nothing ranked; (b) leave them out; (c) show them on every period.
- **Recommended: (a).** It follows draft decision 13 (attendance in the Month view only) and the late-days count already in the month summary from 6b.1.
- **Affects:** 9.3, the snapshot (9.4).

### Q10. The month close "still waiting" list
The draft listed "items done but not approved", which no longer exists after D3.
- **Options:** (a) drop that line; add "early-leave requests not answered" and "Left early, not answered" (v1.9); keep the rest; (b) keep the draft list as it is.
- **Recommended: (a).** The list should match what can actually be waiting.
- **Affects:** WORKFLOWS §7, 9.4.

### Q11. Delete and money
v1.8 adds an Owner Delete for unused records and an "Archived (n)" section.
- **Options:** (a) any money row (amount, value, advance, override, billing status) makes a record "used", so it can be archived but never really deleted; (b) the Owner may delete it together with its money rows.
- **Recommended: (a).** History is never destroyed (invariant 9), and snapshots rely on stable ids (draft decision 17).
- **Affects:** v1.8's "used" checks, 9.1.

### Q12. The revenue line on the new Today
v1.8 reworks the Owner's Today ("Needs you" pills, a narrow "This week" column).
- **Options:** (a) the last line of Today's main column, masked until tapped (draft decision 9); (b) inside the "This week" column; (c) not on Today, only in Reports.
- **Recommended: (a).** It is the Owner's own choice, and the main column has the width for the figures.
- **Affects:** 9.2, the Today layout, the speed gate.

### Q13. Releases and recording
- **Options:** (a) two releases: 9A (revenue) first, then 9B (reports and close), with the answers recorded fresh on `main` (PR #42 closed and cited); (b) one release, and PR #42 rebased.
- **Recommended: (a).** The Owner can enter amounts for a whole month before the first close. These screens are Owner only, so two releases do not confuse the team. The branch is three weeks behind `main`.
- **Affects:** the release plan, the kickoff session.

## Decide first
Q1 (the draft as a whole), Q2 (completing a one-time project now that Mark done is the approval) and Q4 (deliverables added to a running cycle). Both Q2 and Q4 change how Achieved and Potential are worked out.
