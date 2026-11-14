# OWNER ANSWERS (14 Nov 2026, via the advisor; these win over the recommendations below)

The 22 "still valid" decisions from kickoff 9 (PR #42, 9 Oct) stand.

**Re-confirmed:**
- **R1:** a one-time project counts as earned when **the Owner or the client's Admin** completes it. Marking the last deliverable offers "Mark done and complete project" or "Mark done only".
- **R2:** reopening work from a closed month is **allowed**. The snapshot never changes; the Owner's report shows "Changed since close".
- **R3:** held work gets its own **"On hold ₹X"** line in Remaining. A held retainer has no cycles. A held one-time project past its date shows "Was due … · On hold".
- **R4: CHANGED from the recommendation, "extra on top".** A deliverable added during a month is worth ₹0 until the Owner gives it a value, which is **added on top** of the month's amount. This changes decision 4 ("a cycle adds up to its amount") for added deliverables.
- **R5:** keep the masked Today revenue line, loaded after the first screen. If it fails the speed gate, it moves to Reports only.
- **R6:** the billing category defaults from recurrence (weekly/monthly → Retainer, one-time → Project); no template default.
- **R7:** stage durations are grouped by stage name.

**New questions:**
- **Q1: CHANGED, "this month on only".** A first amount covers the current month onward; earlier months show "No amount set".
- **Q2:** months can be closed from the **first priced month**.
- **Q3: CHANGED, "notify me".** The Owner gets a **notification** when an unpriced deliverable is added to a priced month. Owner-only; a new notification type for WORKFLOWS §9.
- **Q4: CHANGED, "always ₹0".** A cancelled one-time project counts ₹0; kept advances show separately; there is no adjusted figure.
- **Q5:** working-hours counts per person in the Month view (never ranked).
- **Q6:** freelancer payments are not in phase 9.
- **Q7:** billing history is Owner-only, in its own section.

---

# Phase 9 refresh: Revenue, reports and month close (14 Nov 2026)

Sources: PR #42 (`origin/kickoff-9`, draft, **CONFLICTING**, last touched 9 Oct; decisions in `git show origin/kickoff-9:docs/PROGRESS.md` line 130 on), `main` @ 8e248952 docs and migrations.
State of the code: **no money exists yet.** `src/modules/revenue/*` is `.gitkeep` only; no `project_billing`, `item_billing`, `cycle_billing`, `revenue_overrides`, `project_advances`, `month_snapshots`, no `billing_category` / `billing_status` enum in any migration (DATA-MODEL §0 lists the enums, the DB does not have them). `projects.delivery_date` exists (required on one-time). `project_items.close_kind` exists (v1.9 W1). Keys `finance.view`, `finance.edit`, `reports.all`, `months.close` (Owner), `reports.scoped` (Admin) are seeded (`supabase/migrations/20260922103634_team_identity.sql:544-548`). The Admin report already has the period switch with the last period beside it (`src/app/(app)/reports/admin-report.tsx:68`).

---

## 1. Still valid (as is)

- **(1)** A retainer cycle belongs to the IST month its period starts in; never split.
- **(3)** Each retainer cycle keeps its own amount, copied when the cycle is made; a change applies from the current cycle on; one cycle can be changed alone.
- **(4)** Explicit item values come off the top, the rest split evenly; over-amount refused; whole rupees in, paise to the first item, Indian grouping.
- **(5)** "No amount set" (null) flagged; ₹0 = "Not billable", never flagged. The `project_created` text already reads "Set the amount and billing category." (`20261015022035_client_work_stage_groups.sql:764`): no change needed.
- **(6)** Totals use the Owner-adjusted Achieved, "System calculated ₹X" beside it; "Back to calculated" with a note, rows kept.
- **(7)** Billed / Not billed independent of being done; date defaults to today IST; back to Not billed allowed; "Mark all N billed".
- **(8)** Reports → Revenue by month, client → project → cycle → deliverables, category filter, exception rows first; Owner-only line on the client Overview; Owner-only Billing section on the project page (absent from an Admin's payload, not hidden).
- **(10)** After close, amounts, values, advances and overrides stay editable with "September is closed…"; billing status live beside the snapshot.
- **(11)** Money in custom fields stays the Owner's responsibility, with a warning line (not built; still 9.2).
- **(12)** Periods: Mon–Sun IST week, IST month, custom ≤ 366 days, previous period beside; revenue by month only.
- **(13)** The people report (per person, freelancers apart, raw facts, nothing ranked or coloured). Its "completed" = Owner-approved **tasks** (tasks are unchanged by amendment C).
- **(15)** No new Admin numbers: **already done** (6.3 / 7.4 built the period switch), so 9.3 adds nothing for Admins.
- **(16)** Close any ended month, any order, never the current one; nothing blocks; the waiting list; "Close September with 4 things still waiting"; no reopen.
- **(17)** The snapshot holds everything the Owner's month reports show, with stable ids (incl. expense totals; no ADR change).
- **(18)** "Closed 3 Oct · v1", "Changed since close", Correct = full rebuild + required note, v1 kept.
- **(19)** From the 6th, a Reports line + one line in the 08:00 digest; no push, no new job; close notifies nobody.
- **(20)** Copy list (apart from the "Approve…" words, see R1).
- **(23)** Advances on one-time projects (`project_advances`, never Achieved, returns in their own month) — with "completed" read as in R1.
- **(24)** "Not needed" close = left out of Potential whenever closed; "Not delivered" and no kind = closed, not achieved. Built data matches (`close_kind`, the Owner's `item_set_close_kind`).
- **(2), (2a), (2c)** One-time = one lump sum: Potential in the delivery-date month, all-or-nothing, both in the completion month once achieved, overdue shows in the current month "Was due …", cancelled = closed not achieved in the cancel month. (Who completes: R1.)
- Unchanged by later work: revision rounds and stage groups are **stages**, and stages never affect revenue (PRODUCT §4.12); expenses stay in `modules/expenses` (ADR-0007 amendment 2026-09-27).

---

## 2. Needs re-confirming (affected by v1.6 → v2.0)

**R1. Who makes a one-time project's money count, and the "last deliverable" prompt.** Kickoff 9 (2b) said "Achieved only when the **Owner** completes", with "Approve and complete project / Approve only". Since amendment C an Admin completes projects and that counts (CLAUDE.md invariant 3; ADR-0007 amendment 2026-10-08 already says "when the project is completed, by the Owner or its Admin"), and since D3 there is no approve step: Mark done is the approval.
- **Recommended:** a one-time project counts when **the Owner or the client's Admin completes it**; marking its last open deliverable done offers **"Mark done and complete project"** (main) / **"Mark done only"** to whoever marks it; "Ready to complete" = every deliverable done or closed, project not completed (shown to the Owner on Revenue; the Admin sees the same prompt with no money).
- Alternative: completion counts only when the Owner completes (would reverse amendment C for one-time projects).

**R2. Reopening or sending back work in a month that is already closed** (open item 7B rework (d), `docs/PROGRESS.md:876`). `item_reopen` (Owner or the client's Admin) and `project_reopen` (both, amendment C) take money out of Achieved at once. Admins cannot see that a month is closed (money).
- **Recommended:** allowed as today; the closed month's snapshot never changes; the Owner's report shows "Changed since close" (−₹X: "Reel 3 reopened by Ravi"), fixed by Correct if he wants.
- Alternative: refuse reopening work of a closed month (an Admin would get a refusal with no reason they can see).

**R3. On hold and money** (ADR-0016, v1.9; ROADMAP Phase 9 note line 365 already asks for "₹ value of held deliverables", Owner only).
- (a) A held retainer gets **no cycles** while held, so those months simply have no Potential. **Recommended:** accept (no Potential for months with no cycle).
- (b) A held one-time project past its delivery date. **Recommended:** it follows the overdue rule (current month, "Was due 15 Nov · On hold"), like any unfinished project.
- (c) **Recommended:** Revenue shows "**On hold ₹X**" as its own line inside Remaining (neither earned nor lost), per month and per client.

**R4. Deliverables added during a month** (now common: `item_add`, the Deliverables list's "Also add "‹title›" to October?" (v1.9 W1), bulk edits). With decision 4 they join the split, so adding a 13th deliverable lowers the value of the other 12, including ones already done and counted.
- **Recommended (a):** they share the month's fixed fee (the split); the month's Potential stays the agreed amount.
- (b) An added deliverable is worth ₹0 unless the Owner gives it a value, and that value is **added on top** of the month's amount (an extra charge). (Changes decision 4's "a cycle adds up to its amount".)
- (c) Extras go in a separate one-time "Additional Work" project when they are billed (no rule change; team habit).

**R5. The Owner's Today revenue line under the v2.0 speed rules** (decision 9: masked "₹ •••" line at the end of Today). v2.0 enforces ≤ 6 first-wave reads on /today (`e2e/first-wave.spec.ts`) and budgets at measured + 5 %.
- **Recommended:** keep it, loaded **after** the first screen (never in the first wave, no new JS on first load); if the speed gate fails, it moves to Reports only.
- Alternative: no money on Today at all; Revenue lives only in Reports.

**R6. Billing category** (moved into phase 9 by amendment C3: Retainer / Project / Additional Work, Owner-only, plus a template default).
- **Recommended:** each project's category defaults from its recurrence (weekly/monthly → Retainer, one-time → Project) and the Owner changes it on the project's Billing section; **no template default** for now (one less Owner-only table; add later if wanted).
- Alternative: also a default category on each project template (Owner sets it; applies only when he creates the project), as amendment C3 described.

**R7. Stage durations now that stages are per deliverable and grouped** (decision 14 assumed one stage list per project; D2 made stages per item with free names, v1.7 added groups and "Revision N" rounds).
- **Recommended:** group durations by **stage name** (ignoring case) within a project, top slowest first, plus "overall" across projects by name; groups and revision rounds are just stages.
- Alternative: only per project, no cross-project "overall" (names differ between projects).

---

## 3. New questions (owner-facing, recommended first)

**Q1. Projects already running since October have no amounts. When you first enter a project's amount, which months does it cover?**
- (a) **Recommended:** it asks once: "Use ₹X for October and November too?" (only months that have no amount yet). Reports start from October 2026.
- (b) From this month on only; earlier months show "No amount set" until you fill each one.

**Q2. Which months can be closed?**
- (a) **Recommended:** from October 2026 (the first month with client work in MaxOff) onward; nothing before.
- (b) Only from the first month you have priced.

**Q3. When the deliverables list grows (the month-end "Keep extras" card adds lines), the same monthly fee is split over more deliverables. Should you be told?**
- (a) **Recommended:** a quiet line on Revenue only: "‹Project›: 14 deliverables now, 12 when the amount was set. Check the amount." No notification, nothing for the Admin.
- (b) No flag.

**Q4. A one-time project is cancelled after part of the work was delivered and the client paid something. How is that recorded?**
- (a) **Recommended:** you can enter an adjusted figure on a cancelled project ("Owner adjusted ₹20,000", with a note), counted as achieved in the cancel month.
- (b) Cancelled always counts ₹0; advances kept show separately (as decided), nothing else.

**Q5. The people report and working hours (late starts, leaving early, staying late were added in v1.8–v1.9). Include them?**
- (a) **Recommended:** yes, as counts per person in the **Month** view only (late starts, early leaves, extra hours), next to the attendance lines; never ranked.
- (b) No, attendance lines only as decided.

**Q6. Freelancer payments (noted as "phase 9 or later" in phase 4).**
- (a) **Recommended:** not in phase 9; later, as its own unit.
- (b) In phase 9.

**Q7. Who sees the Billing section's activity (amount changes, values, billed, advances)?**
- (a) **Recommended:** the Owner only, in its own "Billing history" inside the Billing section; never mixed into the project's Activity panel the Admin sees.
- (b) Also inside the project's Activity panel, visible to the Owner only.

(Total questions for the owner: R1–R7 + Q1–Q7 = 14 points, but R6, R7 and Q6 are low-stakes and can be "as recommended" by default; the must-ask ones are **R1, R2, R4, Q1, Q4, R3, R5** in that order.)

---

## 4. Build plan

Prerequisite (≈ ½–1 day, advisor): close #42 and write a **fresh** kickoff-9 docs PR from `main` with the answers above (the #42 text is pre-amendment-C/D throughout, see §5.1). Phase 9 starts after v2.1's ship or alongside it on a separate branch (v2.1 says "no money change", `docs/handoff/v2.1-plan.md:145`, so they don't overlap in code, but both touch Reports and Today's speed budget).

Suggested: keep ROADMAP's 9A / 9B, but build each as **two builder steps** (db then screens), one review and one phone walk at the end.

### 9A = 9.1 + 9.2 (money)
**9.1 Money tables and views [L, SQL-heavy]**
- Enums `billing_category`, `billing_status`. Tables (Owner-only, single policy `finance.view`/`finance.edit`, audited, no delete, never in Realtime): `project_billing` (+ `billing_category`, `cycle_amount`, `fixed_amount`), `cycle_billing` (+ own `cycle_amount`), `item_billing` (retainer items only), `revenue_overrides` (+ `superseded_note`), `project_advances`. (Template default category only if R6 (b).)
- **Cycle amount copy:** an `AFTER INSERT` trigger on `project_cycles` (security definer) writing `cycle_billing.cycle_amount`, rather than re-creating `project_create`, `project_create_grouped`, `cycle_generate`, `cycle_start_next`, the carry, `project_resume` (six big functions, all on the hot path of v2.0's PL/pgSQL work). Backfill per Q1.
- Owner functions: `billing_set_project` (amount / category; refuse below explicit values or advances), `billing_set_cycle_amount`, `item_value_set`, `revenue_override_set` / `_clear`, `billing_mark` (one / month), `advance_record` / `advance_return`. pgTAP per path.
- Views (security invoker): `item_values_v` (split, paise rule, planned items incl. "Not needed" exclusion), `revenue_by_cycle_v`, one-time project lines (delivery-date month, overdue → current month, completion month, cancel month, held), `revenue_by_client_month_v`, advances by month, held value.
- R1's prompt needs no change to `project_complete`: a small new `item_mark_done_and_complete` (one transaction, notifies as both do today), or the screen calls the two in turn.
- Lint `MONEY_RELATIONS` + pgTAP 46 publication list + a per-role pgTAP "no path" file (API, views, functions, `activity_log`, `project_activity`, Realtime) for Admin, Crew, freelancer, anon.
- Risk: the split and month-placement rules are the bug-prone part; write the TypeScript twin in `modules/revenue/domain` with unit tests over the same fixtures as pgTAP.

**9.2 Revenue screens [L, UI]**
- Project page **Billing** section (Owner only, streamed after the page; Admin payload without it), item values, override sheet, billed sheet, advances; client Overview line; `/reports/revenue` (month switcher, exceptions first, drill-down, category filter); Owner Today line (R5); "Mark done and complete project" prompt (R1) for Owner and Admin (Admin with no money); the custom-field warning (decision 11).
- `core/lib` money formatter (the expenses one can't be imported by revenue).
- Each screen: `loading.tsx` tracing it, 375/430 phone layouts, back-gesture specs, guide topics (Owner + Admin for the prompt), guide screenshots, design passes, speed gate (Owner-only reads must not join the first wave on /today, a client, a project).
- Risk: speed gate on /today and the project page; the "phone layouts stay live" rule (new section only, nothing restructured).

### 9B = 9.3 + 9.4 (reports and close)
**9.3 Metrics and reports [M–L]:** metrics functions (security invoker, Owner `reports.all`): people report (tasks; working-hours counts if Q5 (a)), stage durations by name (R7), delays, 6-period trends; `/reports/work`. Admin side: nothing new. Risk: query cost on `activity_log` / task tables at real volume (EXPLAIN on the measure seed); first-wave rule on /reports.
**9.4 Month close [M]:** `month_snapshots` (append-only, UPDATE/DELETE revoked), `month_close(month)` / `month_correct(month, note)` (`months.close`), the snapshot builder (JSON with stable ids), "Changed since close" diff, the waiting list, the 6th-of-month Reports line and digest line (re-create `digest_daily`'s content function). Risk: the diff is a second implementation of every report; build it as "rebuild live → compare JSON by id".

### Sizes and duration (one cloud builder)
| Step | Size | Working days |
|---|---|---|
| Fresh kickoff docs PR + owner answers | S | 0.5–1 |
| 9.1 | L | 3 |
| 9.2 | L | 3–4 |
| 9.3 | M–L | 2.5–3 |
| 9.4 | M | 2–2.5 |
| Review, fixes, design passes, guide, speed gate (paired, two-run), phone walk | | 2–3 |
| **Total** | | **≈ 13–16 working days (about 3 weeks)** |

Calibration: v2.0 (≈ 6 small speed units) took ~9 days incl. review and walk; phase 7 (two [H] units of the same shape) took ~8 days plus the C/D rework. Phase 9 is new tables + four new screens + a snapshot engine, so roughly 1.5× phase 7. The first slip risk is the speed gate on /today and the project page.

---

## 5. Contradictions and blockers found

1. **PR #42 cannot be merged as is.** It is a draft, `CONFLICTING`, and written before amendments C and D: "the Owner approves that item", "A partly done or Admin-ticked item counts for nothing", "Approve and complete project / Approve only", "Achieved … when the Owner completes" (its PRODUCT §4.12 and WORKFLOWS §6.2 diffs; PROGRESS line 130 on). PROGRESS (C4) already says it needs editing (`docs/PROGRESS.md:572`). Rewrite from `main`.
2. **`main`'s docs still carry the pre-kickoff rule:** PRODUCT §4.12 "One-time project: a fixed amount, split evenly across items" (`docs/PRODUCT.md:365-366`) and WORKFLOWS §6 item 3 `fixed_amount ÷ planned items` (`docs/WORKFLOWS.md:528`) contradict decision 2. DATA-MODEL §7 (`docs/DATA-MODEL.md:1677-1682`) lacks `cycle_billing.cycle_amount`, `project_advances`, the category and supersede columns.
3. **ADR-0007's Decision still says** the billing category is "a column on `projects`" (superseded by its own 2026-10-08 amendment, fine) and lists four money tables; the kickoff-9 amendment adding `project_advances` (dated 2026-10-02) is only on the `kickoff-9` branch. The refreshed kickoff must re-add it.
4. **Lint seal gap:** `eslint.config.mjs:29-30` `MONEY_RELATIONS` lacks `item_values_v` and `project_advances` (and any template-category table). **pgTAP 46** (`supabase/tests/46_notifications_realtime.test.sql:25-27`) lacks `project_advances` (its old `revenue_entries` problem is already fixed).
5. **Realtime:** `project_items` is published (`20261008192424_client_work_screens.sql:31`). Never put a value column on it, or on `projects` / `project_cycles` (all Admin-readable, and their audit rows are Admin-readable through `activity_log_select_client_work`, `20261009001320_client_work_item_stages.sql:99-104`). Money audit rows need their own entity names; `activity.view_all` is Owner-only (`team_identity.sql:549`), so that is safe.
6. **Custom fields can carry money today** (Ideas S-L3, `docs/PROGRESS.md:909`; phase 7 review (c), `:870`): project/item/task fields are visible to Admins (and Crew for tasks). Decision 11's warning is unbuilt; not a blocker, but 9.2 must ship it.
7. **`formatRupees` lives in `modules/expenses`** (`src/modules/expenses/index.ts`; used by `src/app/(app)/reports/page.tsx:16`); revenue may not import it (seal). Move it to `core/lib`.
8. **Legacy `done` items** (7B rework (g), `docs/PROGRESS.md:876`): items left `done` from before D3 count as "done" but not for revenue. Probably only on staging; the builder checks staging read-only (never production).
9. **7A leftovers** `item_approve` / `item_reject` / `item_unmark_done` still granted (`docs/PROGRESS.md:870` (a)): `item_approve` can still move a legacy `done` item to `approved`, which is allowed. Not a money leak, but phase 9's pgTAP should cover it.
10. **Nothing else blocks:** `delivery_date` and `close_kind` exist with the shapes kickoff 9 expected; held projects already stop cycles; the period helpers (`previousPeriod`, custom range) exist.
