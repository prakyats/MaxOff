# Final test-quality review: MaxOff v2.0 RC (phase-v2 @ bafd6f45)

Static review only (nothing run, nothing edited). Diff: `git diff origin/main...HEAD`, 84 test/CI/migration files. All paths are relative to the checkout `…/scratchpad/rc`.

## Verdict

- **Must-fix before release: none found in the test code.** No retry, skip-to-pass, `waitForTimeout`, `expect.soft`, `.only`, `fixme` or raised timeout was added. `retries: 0` is unchanged (playwright.config.ts:136).
- **Should-fix: 9** (three tests that can pass vacuously, one gate/doc mismatch, the CI font claim, three coverage gaps, one run-length check).
- **v2.1: 7.**
- Not verified here: that a full four-shard run is green at bafd6f45. The last three commits (7810aa6c, 91b36117, bafd6f45) only cite partial runs in their messages.

---

## 1. review-tests.md items at HEAD

| Item | Status | Where |
|---|---|---|
| C1 second Admin's no-client request | DONE | supabase/tests/135_v2_own_week_tasks_counts.test.sql:78 (fixture), :109-112 (RLS hides it, count unchanged); fix in migration 20261111030554 |
| H2 link tap supersedes a held button tap | DONE | src/core/ui/navigation/pre-hydration.test.ts:511-518 |
| M3 hold-tap regex and NEVER_HELD | DONE | tests/hold-tap.test.ts:21-25 (variants, `destructive`, spread constant), :72-86 (the guard's own check); pre-hydration.test.ts:463-473 (three footers) |
| Gates: first-wave ≤ 6, no duplicates | DONE | e2e/first-wave.spec.ts:162 (two quiet windows agree), :183 (none twice), :185 (≤ 6); one test per route and role; no `console.log`, no `setTimeout(180_000)` |
| Gates: phone-inp ≤ 200 ms | DONE, with a vacuity hole (S1) | e2e/phone-inp.spec.ts:112; one test per tab and role |
| C2 cross-org on the 141 guard | DONE | supabase/tests/141_v2_rls_helpers_plpgsql.test.sql:318-345 (org B), :443-455 |
| H1 141 empty-branch fixtures | DONE | 141:273-311 (fixtures), :405-440 (true/false non-vacuity for the five helpers) |
| H4 pgTAP 131 refusals | DONE | supabase/tests/131_v2_session_early_own_hours.test.sql:78-99 (Owner, freelancer, deactivated, same code) |
| Role gaps (§3) | DONE | supabase/tests/143_x5_role_gaps.test.sql:103-106, :110-116, :121-132, :142-155; `attendance_hours_on` anon/proacl in 142:213-217 |
| 142 (org B row, mismatches re-run, `not early_applies`) | DONE | supabase/tests/142_v2_attendance_hours_once.test.sql:189, :209, :172-175 |
| Unit H4 early-read picks | DONE | src/modules/attendance/tests/early-reads.test.ts:83, :100, :106, :114 |
| Unit H5 `listTasksAtBothSteps` | DONE | src/modules/tasks/tests/both-steps.test.ts:81, :89, :101 |
| Unit M5 fold mappers | PARTLY | project-page.test.ts:22, clients/tests/overview.test.ts:22 and :33, templates/tests/library.test.ts:23, attendance/tests/board.test.ts:25 and :33, tasks/tests/task-page.test.ts:64 and :72. `readClientOverview` has no hidden-client case (only the empty shape) |
| Unit M6 `projectSummaries().held` | DONE | src/modules/client-work/tests/items.test.ts:370 |
| e2e H3 chips and row controls | DONE | e2e/task-lists.spec.ts:669-689 (chips, non-vacuous, real tap); e2e/client-work.spec.ts:295-300 (item row controls). Task rows' own controls are covered only by the flows that click them |
| e2e H6 Appearance → Dark, back stack, System | DONE | e2e/back-gesture.spec.ts:962-983, :985-1005 (both phone widths) |
| e2e M2 stored dark, System flip, phone path | DONE | e2e/theme-flash.spec.ts:143, :164, :179. theme-flash is not in mobile-lg's `testMatch`, so the phone path runs at 375 only |
| e2e M4 week-strip day (`strip:<date>`) | **MISSING** | The mark exists (src/modules/calendar/components/calendar-screen.tsx:552); no unit or e2e test names it. pre-hydration.spec.ts:365 and :427 cover the handle and the month's day box only |
| e2e M7 loading screens | DONE for Owner and Crew | e2e/loading-screens.spec.ts:661, :679, :697; e2e/deliverables-list.spec.ts:405 retargeted. No Admin row for `/clients/:id` (S6) |
| The two sleeps | DONE | e2e/pre-hydration.spec.ts:368-424 (click and timer counts); e2e/back-gesture.spec.ts:925-954 (close counter) |
| L1 offline band at a form's end | DONE | e2e/sticky-actions.spec.ts:162 |
| L3 `WARM_ZONE_SCRIPT` in head | DONE | e2e/theme-flash.spec.ts:39 |
| L5 item-row and project menus | DONE | e2e/on-hold.spec.ts:358-384 |

---

## 2. Weakening audit

Searched the whole test diff for `timeout`, `retries`, `.skip`, `fixme`, `.only`, `waitForTimeout`, `toPass`, `expect.soft`, `setTimeout`, `networkidle`.

**None added:** `retries`, `waitForTimeout`, `toPass`, `expect.soft`, `fixme`, `test.only`, `networkidle`, `test.slow`.

| Change | Where | Judgement |
|---|---|---|
| `test.skip(!isMobile …)` and project-name skips (9) | back-gesture:909, first-wave:150, instant-skeleton:454, notifications:820, phone-inp:79, pre-hydration:342, theme-flash:108 and :183 | Legitimate viewport guards. Side effect: the held calendar tap is never proved on desktop (S7) |
| `test.setTimeout(120_000)` | instant-skeleton.spec.ts:488 | Moved, not added (was on the single Owner test). Now three roles, serial |
| `{ timeout: COLD_MS * 4 }` (4) | instant-skeleton.spec.ts | Moved with the test body, same values |
| `waitForURL(..., { timeout: 30_000 })` | phone-inp.spec.ts:92, :103 | Not a raise: equals the test's own budget; the INP is asserted separately |
| `setTimeout(resolve, 3_000)` | dashboards.spec.ts:647 | Simulated late chunk inside a route handler, not a wait for a result. Non-vacuous (`late > 0`, :660) |
| `setTimeout(resolve, 100)` loop | helpers.ts:1176-1182 | The first wave's quiet-window poll. Time-based by design, guarded by the two-window equality (first-wave:162) |
| `not.toContainText` on a section → `toHaveCount(0)` on its rows | dashboards.spec.ts:848-855 | Legitimate: the old form failed when the section was not drawn. Slightly looser (no longer requires the section) |
| Removed `expect(startedAgo).toBeGreaterThan(15)` | working-hours.spec.ts (old :193) | Replaced by the same check against a computed grace (:91) plus two margin checks (:92-93). The fixture now adapts the grace near midnight; the edges moved to pgTAP 121 (+8 assertions, 121:546-579) and tests/working-hours-day.test.ts. Legitimate, owner-attributed |
| Form sign-in → `ownSession` | client-work.spec.ts:251 | Speeds the test instead of raising its timeout. Legitimate; the test sits close to its 30 s budget |
| `routeWebSocket` blocks Realtime | loading-screens.spec.ts:1048 | Removes cross-worker interference. The behaviour it hides is specced separately (notifications.spec.ts:816) |
| `prefetches.only()` aborts other prefetches | prefetch-likely.spec.ts:101, :138 | Narrows the counting window to the two tabs. Legitimate; rows' reads are judged in their own test |
| `calendarReady` before every handle tap | calendar.spec.ts:118-127, mobile.spec.ts:357 | Deterministic hydration wait. It would mask a hold-tap regression in calendar.spec, so pre-hydration.spec is the only proof |
| Loading-screen holds retargeted to the fold RPCs | loading-screens.spec.ts (11 rows) | Legitimate: the old tables are no longer read by those pages |
| Reload after the digest-day save | settings.spec.ts:220 | Honest (see §3) |
| perf-gate: TTFB slower than staging is WARN, not FAIL | tests/perf-gate.test.ts:113-121; scripts/lib/perf-gate.mjs:201 | **A loosened gate** (S4) |

---

## 3. Flake risk

**settings.spec.ts:164 fix (commit 91b36117): honest.** The thresholds form is keyed on the saved settings (src/app/(app)/settings/thresholds/page.tsx:30), so a save remounts it after the toast. The test now reloads after that save as it does after the others (:185, :208, :220, :238). No assertion was removed. Two notes:
- The app-side race is real: an edit typed in that instant is silently put back. The commit says it is in PROGRESS Ideas; no test holds it.
- The Monday restore at :216-220 is not re-asserted after the reload.

**Siblings checked, clean:** the only other keyed form is Weekly off (src/app/(app)/settings/days-off/page.tsx:52); settings.spec.ts:98-107 reloads after each save. push-quiet.spec.ts:204, :267, :281 and working-hours.spec.ts:556 reload or end after their saves.

| Risk | Where | Detail |
|---|---|---|
| Timing gate on a shared runner | phone-inp.spec.ts:112 | INP ≤ 200 ms at CPU ×4, 15 tests, no retries. A noisy runner can redden it |
| Midnight window may be too short | scripts/lib/ist-midnight.mjs:15 | `E2E_RUN_MIN = 30` ("runs take 11-15"). v2.0 adds 132 first-wave tests at ≥ 3 s of quiet windows each, 15 INP tests, and the cold-Worker test for three roles. Shard durations at HEAD were not checked against 30 minutes |
| Wall-clock fixture | working-hours-day.ts:14-18, :39 | Throws outside 00:01-23:56 IST (loud, by design). Near 23:5x the day's end is 2-4 minutes away, so a slow test could cross it. CI is protected by the midnight wait; a late local run is not |
| Parallel fixture race | first-wave.spec.ts:66-110 | `fixtures()` is find-or-create with no lock; `clients_name_unique` (migration 20260927021642:53) makes the losing worker's insert fail. Local 3-worker first run only; CI uses 1 worker |
| Quiet-window count | helpers.ts:1176 | A straggler after both 1.5 s windows is missed (false pass, never a red flake); one arriving between them reddens `:162` |
| React internals | helpers.ts:642 | `streamedHeights` parses `$RS`/`$RC` from inline scripts (S2) |
| Minified literal | dashboards.spec.ts:645 | Finds the chunk by `"approval-row"` in its text; guarded by `late > 0` |
| Fake clock with live sockets | notifications.spec.ts:850 | `page.clock.install()` before sign-in, with a forwarded Realtime socket. The logic is event-driven, not timed |

---

## 4. Gaps: would a test fail if it broke?

| v2.0 change | Covered by | Gap |
|---|---|---|
| Chip tap opens the task | task-lists.spec.ts:669-689 (375 and 430) | None |
| Held calendar tap replay | pre-hydration.spec.ts:365, :427 (phone); unit pre-hydration.test.ts:411-560 | Strip day (M4) and desktop (S7) |
| Today no-flash | dashboards.spec.ts:535 (Owner), client-work.spec.ts:583 (Admin) | Can pass vacuously (S2) |
| Client / project loading screens | loading-screens.spec.ts:655-690 (Owner), deliverables-list.spec.ts:405 (Admin project) | Admin's client Overview (S6) |
| Appearance sheet + back stack | back-gesture.spec.ts:912-1005, mobile.spec.ts:502-524 | None |
| On hold on My Day, rows, sheet | on-hold.spec.ts:284-292, :458-521, :257 | My Day with nothing held shows no line: not asserted (v2.1) |
| Signed-out theme fade | Nothing | S8 |
| End day claim setup timing (7810aa6c) | expenses.spec.ts:126 (the flow), first-wave `/today` and `/my-day` (the wave stays ≤ 6, none twice) | Nothing fails if the setup moves back into the render; only the perf-probe's last byte shows it (v2.1) |

**New SQL functions:** every one has pgTAP with allowed and denied callers.
`session_early` 130/131; `own_week` 132/134/135; `attendance_board_today` 133; `requests_to_decide_count` 135/143; `templates_library` 136; `task_page` 137; `own_comp_leave` and `working_day_rule` 138; `client_overview` 139; `project_page` 140; the fifteen PL/pgSQL helpers 141; `attendance_hours_on`, `attendance_hours`, `attendance_hours_today` 142 (roles in 121:394-406 and 143:114). Plans match assertion counts in 130-142.

---

## 5. The CI Chromium step (.github/workflows/ci.yml:176-187)

**Launch check: sound.** It launches the default headless `chromium` with no channel, which is what every project uses (`devices["Desktop Chrome"]`, `devices["Pixel 5"]`; no `channel`, `headless` or `launchOptions` in playwright.config.ts). So it exercises the same binary and opens a page. `set -euo pipefail` plus the second `launch` make a still-broken browser fail the step.

**What it does not prove: fonts.** `install-deps` also installs font packages; a browser launches fine without them.
- The comment at ci.yml:174 ("no spec measures a system font") is not accurate. Geist is loaded with `subsets: ["latin"]` (src/app/layout.tsx:20-21). `₹` (10 source files), `→` (58 .tsx files) and `⋯` (60 .tsx files) are outside Google's latin range as I know it, so they render in a system fallback font.
- 36 spec files assert geometry (`boundingBox`, `scrollWidth`, `expectNoHorizontalScroll`, 1 px skeleton traces at loading-screens.spec.ts:61). No pixel-snapshot assertions exist (`toHaveScreenshot` / `toMatchSnapshot`: none; the two `.screenshot()` calls at calendar.spec.ts:2340 and deliverables-list.spec.ts:379 are attachments).
- Result: a missing or different fallback font changes the width of those glyphs, and a fit or wrap assertion can flip. Which fonts the runner image already carries was not verified here.
- The two paths (no apt / apt fallback) can give different fonts on different days, so a layout assertion could differ between runs without any code change.

---

## Findings by class

### Should-fix (before release if cheap, otherwise first thing in v2.1)

- **S1. phone-inp can pass with no measurement.** `inp` is `Math.max(0, …)` (phone-inp.spec.ts:63); if no Event Timing entry has arrived when `read()` runs, the tap scores 0 and passes. Assert at least one interaction entry per tap (e2e).
- **S2. `streamedHeights` can pass vacuously.** With no `$RC`/`$RS` match (helpers.ts:642), both heights are measured on the same DOM and are equal. Assert that at least one reveal inside the slot was replayed, or that the slot holds a real row after the second replay (e2e helper).
- **S3. Admin notes leak test lacks positive controls.** clients.spec.ts:481-483 asserts the RSC answer is 200 and lacks the secret, but not that it is the client's payload (add `toContain(name)`), and nothing shows the Owner's page does carry the note.
- **S4. Speed gate differs from CLAUDE.md.** CLAUDE.md is unchanged on the branch and still says no route slower than the live release by 10 % or 100 ms. The gate now fails only on the last byte and warns on TTFB (perf-gate.mjs:18-26, :201; tests/perf-gate.test.ts:113-121), attributed to "Option A, owner 2026-11-11". Either CLAUDE.md records Option A or the owner confirms it before READY.
- **S5. `twoRunVerdicts` is tested but never called.** No caller in `scripts/` or `.github/` (perf-gate.mjs:249). The two-run rule is applied by hand. If wired as written it would also turn a single-run cap (> 600 ms) or status failure into RECHECK; CLAUDE.md's two-run rule covers "slower than live" only. No test separates those cases.
- **S6. Admin's client Overview skeleton is untraced.** The skeleton branches on role (src/app/(app)/clients/[id]/(tabs)/loading.tsx:17-18, :121); loading-screens.spec.ts:659 runs as Owner only. Add an Admin row.
- **S7. Held calendar tap: strip day and desktop.** Add an e2e for `calendar-strip-day` tapped before hydration (M4), and run the day-box case on desktop; the CI failure that motivated the fix was on desktop too (calendar.spec.ts:113-116).
- **S8. Signed-out theme change is unspecified.** `quietThemeChanges` starts only in the signed-in shell (src/core/ui/pwa/pwa-after-page.tsx:21). On `/login` a System dark flip now runs with transitions. Either accept it in the release notes or add a theme-flash case on `/login`.
- **S9. Fonts on CI.** Correct the comment at ci.yml:174 and add a cheap font check to the launch step (for example, measure `₹→⋯` in the page and fail on zero-width or tofu), or cache the font packages.
- **Also check once:** the slowest shard's duration at HEAD against `E2E_RUN_MIN = 30`.

### v2.1

- The thresholds form drops an edit typed just after a save (app-side race behind settings.spec.ts:220); fix and spec it.
- `first-wave` fixtures: create once in global setup instead of find-or-create per test.
- My Day: no On hold line when nothing is held (e2e or unit on `onHoldLine(0)`).
- 7810aa6c: a regression guard for the claim setup's start point (the last byte), other than the perf-probe.
- theme-flash phone path at 430 (add to mobile-lg) if the Appearance sheet's layout matters there.
- `readClientOverview` hidden-client unit case (M5 remainder).
- settings.spec.ts:220: assert Monday after the reload.
