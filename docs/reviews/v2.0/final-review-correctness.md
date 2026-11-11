# MaxOff v2.0 final release review: correctness

Release candidate: `phase-v2` at `bafd6f45`. Earlier review: `7a9b26b7`. Read-only; nothing was run (no tests, no build, no database). Every finding below was checked by reading the code at HEAD.

## Review Summary

**Verdict: APPROVE** for correctness (no Critical, no must-fix in code). Two should-fix items and one docs item for the owner before READY.

**Overview:** Every must-fix from the five batches is fixed at HEAD, with tests that would have caught the original defect. The 45 commits since the earlier review contain no new correctness bug that I could find; no test was weakened, and there is no `console.log`, TODO, `any`, `@ts-ignore` or raw business date in the added code.

---

## Job 1: the earlier findings, verified at HEAD

### Must-fix

| # | Item | Status | Evidence |
|---|---|---|---|
| 1 | `requests_to_decide_count()` counted another Admin's no-client request (sec 1, arch, correct, tests C1) | **FIXED** (0e249912) | `supabase/migrations/20261111030554_requests_to_decide_admin_rule.sql:36-45`: the decider branch is now character-for-character `app.task_request_visible`'s (`20261106030000_rls_helpers_plpgsql.sql:279-285`). Expand-only (`create or replace`, grants restated, no data change). pgTAP `135…test.sql:76-78` adds a second Admin's pending no-client request; `:109-112` assert RLS hides it and the count stays +2; Owner goes +4 → +5 (`:102`). The header-comment correction and the `attendance_hours_on` comment (arch nit 5) are in the same migration (`:12-13`, `:61-66`). It stays `language sql`, with the reason written down (`:15-18`): the advisor asked for PL/pgSQL, so treat that as a reasoned deviation, not a miss. |
| 2 | Diagnostics routes open to every member (sec 2, diag.md) | **FIXED** (01b48a2c gated, caa7b78e removed) | `src/app/diagnostics/` now holds only `approvals-timing`, `digest`, `sentry`, `timing`, all of which are on `main` already. `firstReadsStats`, `FirstReads.stats`, `shellStartedAt` are gone; no reference left in `src`, `scripts`, `e2e`, `tests`, `.github`. |
| 3 | A held calendar tap swallows a link tap (correct must-fix, tests H2) | **FIXED** (ac0101eb) | `src/core/ui/navigation/pre-hydration.ts:134-137`: the button hold has its own `tapTimer`; `:145` a link tap calls `dropTap()` and goes on to its own hold. Unit test `pre-hydration.test.ts` "a link tap supersedes a held button tap" asserts the link's move after `PRE_HYDRATION_WAIT_MS + 100`. |
| 4 | Guide: chip tap wording, 3 stale pictures, Crew "On hold · n", Appearance wording | **FIXED** (3724647e, 6c1d023b, 3704f74d) | `owner.ts:123`, `owner.ts:367`, `admin.ts:321`, `crew.ts:505` carry the chip wording; Crew My Day has the "On hold · n" step; Owner and Admin Appearance text now says the sheet closes and More shows the choice; the three `.webp` files and `shots.generated.ts` changed in 3704f74d. I did not open the pictures. Both optional items (calendar tap while loading, greyed stages) are in too. |

### Should-fix

| # | Item | Status | Evidence |
|---|---|---|---|
| 5 | Replay hygiene (a): double toggle when a real click lands on the live button | **FIXED** (ac0101eb) | `pre-hydration.ts:143`: a click on a live marked button drops the hold. Unit test "drops the hold once a click reaches the button live". |
| 6 | Replay hygiene (b): replay on a new screen | **FIXED** (ac0101eb) | `:136` `pagehide`, `:137` `location.href!==at`. Unit test "drops the hold when the address changes". |
| 7 | Replay hygiene (c): `sameButton` returned a hidden copy | **FIXED** (ac0101eb) | `:132` returns `null` when nothing visible matches. Unit test "finds nothing when no swapped button…". |
| 8 | Replay guards the target, not only the tap; inner control never swallowed (sec 3) | **FIXED** (dc8b674b) | `:137` `if(!neverHeld(el))el.click()`; `:142` `e.target.closest(INTERACTIVE)!==b`. Two unit tests. All three real marks are `type="button"` (`calendar-screen.tsx:549,610`, `month-grid.tsx:276`), so `neverHeld`'s `type==="submit"` check does not disable them. |
| 9 | `rls-helpers-sql-restore.sql` runnable by hand (sec 4) | **FIXED** (dc8b674b) | `docs/handoff/rls-helpers-sql-restore.sql:1-2` raises at once. |
| 10 | `DropdownMenuItem` `data-slot` leftovers (arch 4, correct 3) | **FIXED** (0ef2073b) | `item-row-menu.tsx:62` and the five in `item-sheet.tsx` are `data-action`. No spec selects the old slots. `on-hold.spec.ts` now asserts every item of the row menu and the project menu looks alike (L5). |
| 11 | `first-wave.spec` only annotated (correct 4, tests gates) | **FIXED** (e76ce796) | `e2e/first-wave.spec.ts:173-185`: one `session_early`, no member-row read, no read twice, `≤ 6`; one test per route and role; two quiet windows must agree (`:160-164`); `console.log` gone. A wave that sees no reads fails on the `session_early` count, so it cannot pass empty. |
| 12 | `phone-inp.spec` only annotated | **FIXED, with one gap** (ea970e00) | `e2e/phone-inp.spec.ts:111-113` asserts each tap ≤ 200 ms, per tab; `setTimeout(240_000)` and `console.log` gone. See new finding S1: a tap can read as 0 ms. |
| 13 | Two `waitForTimeout` negative assertions (correct 5) | **FIXED** (c7738648 and the x5 merge) | `e2e/pre-hydration.spec.ts:366-424` counts the handle's clicks and the hold's timers and asserts sizes `["3"]`; `e2e/back-gesture.spec.ts:924-953` counts closes with a MutationObserver and waits on `animationsSettled`. No `waitForTimeout` added anywhere in the release diff. |
| 14 | Route handlers and actions did the whole `session_early()` for one part (arch 2) | **FIXED** (ca4b706f) | `src/core/auth/server.ts:178-181,237`: outside a render `readBeforeCheck` reads the one part. Unit test in `server.test.ts`. The advisor's "confirm it with a count" on the Worker is not something I can see in the code. |
| 15 | Hold-tap guard regex and NEVER_HELD loop (tests M3) | **FIXED** | `tests/hold-tap.test.ts` (`COMMIT`, `MARK`, spread form); `pre-hydration.test.ts` loop has the three extra footers. |
| 16 | X5+ integrator list (C2, H1, H3, H4, H5, H6, M2, M5, M6, M7, L1, L3, L5, §3 role gaps, 142) | **FIXED**, one withdrawn | pgTAP 141 (org B), 143 (new, 25 checks), 131 (+6), 142 (+3); unit `early-reads.test.ts`, `both-steps.test.ts`, `project-page.test.ts`, `overview.test.ts`, `library.test.ts`, `items.test.ts`; e2e as listed above. **M4 WITHDRAWN** by the builder with a sound reason (PROGRESS): the week strip is drawn only at size 1, which only a hydrated control reaches, so no strip day exists before hydration. |

### Nits

| Item | Status | Evidence |
|---|---|---|
| `own_comp_leave` error loses the balance | **FIXED** (147f5802) | `src/modules/leave/data/credits.ts:55-63` falls back to the two reads; unit test covers both a working and a failing dates read. |
| `today/reads.ts` re-calls `todayIST()` | **FIXED** (147f5802) | The four readers take `today` (`reads.ts:60-74`); all callers pass it. |
| Crew guide "appearance" (arch 3) | **WITHDRAWN** by the advisor in batch 3 (Crew have no More sheet). |
| Second tap dropped while a button tap is held (arch 7) | **NOT DONE, optional** | `pre-hydration.ts:137` still returns when `tapTimer!==null`; the second tap is prevented and dropped. It was offered as optional. |
| Perf batch (duplicate early read, valve, JWKS, Geist_Mono, `loadPeople`) | Advisory, not verifiable by reading | The duplicate-read risk is now held by `first-wave.spec.ts:173-180`. The rest were "fix only what the data proves". |

---

## Job 2: fresh review of `7a9b26b7..HEAD`

### Critical / must fix before release

None found.

### Should fix

**S1. `e2e/phone-inp.spec.ts:97-100`: the "More" tap can be read before the browser reports it, so it can pass at 0 ms.**
`read()` runs straight after `expect(row).toBeVisible()`. An Event Timing entry is delivered to the observer only after the frame that follows the tap has been presented; Playwright's visibility check passes as soon as the row is in the layout, which React commits inside the click. Failure scenario: the More sheet's tap takes 350 ms on a throttled CPU, `__events` is still empty when `read()` runs, `inp` is `Math.max(0)` = 0, and the gate passes. The same reading is used for the tab and row taps, where a full document load (init script re-runs, `__events` reset) would also read 0. I have not run it, so I cannot say how often this happens; the annotations of a CI run will show it (look for "More 0 ms").
Fix: before each `read()`, wait until the tap has an entry (`expect.poll(() => page.evaluate(() => __events.length)).toBeGreaterThan(0)`), which is safe because the observer's threshold is 16 ms and the CPU is slowed 4×. This tightens the test; it does not loosen it.

**S2. CLAUDE.md's speed-gate line no longer matches the gate.**
`scripts/lib/perf-gate.mjs:198-212` now fails a route on its last byte against staging and only warns on a later TTFB (owner's option A, 2026-11-11). CLAUDE.md still says "no route slower than the live release by more than 10 % or 100 ms" with no mention of the last byte; `git diff origin/main...HEAD -- CLAUDE.md` is empty. PROGRESS says the amendment waits on the owner's confirmation. This is the owner's edit, but the release review should not close with the rule and the code disagreeing.

### Notes for v2.1 (none blocks the release)

- **N1. `twoRunVerdicts` is not wired in.** `scripts/lib/perf-gate.mjs:249` is exported and unit-tested, but nothing in `scripts/` or `.github/` calls it. The two-run rule is still applied by a person reading two runs.
- **N2. The last-byte compare is skipped silently when a total is missing.** `perf-gate.mjs:203-207`: if either side has no `warmTotalP50`, `slower` is `"ok"` and the TTFB compare only warns, so that route has no comparison against staging at all. Today both sides come from the same probe (`perf-probe.mjs:743`), so it does not happen; a baseline JSON from an older probe would pass quietly. Make a missing total a visible reason.
- **N3. `first-wave.spec` cannot see reads that start on the early read's answer.** `src/app/(app)/my-day/page.tsx:67-69` (7810aa6c) starts `getClaimSetup()` (two reads, `claims.ts:153-163`) as soon as `session_early` answers, while up to five first-wave reads may still be open: seven at once on a Worker that allows six. The spec holds `session_early` too, so it never counts them. The advisor's trace showed Admin `/today` improved; the Crew's `/my-day` deserves the same trace.
- **N4. `inRender()` rests on React's `cache()` keeping nothing outside a render** (`server.ts:178-181`). If a later Next or React version memoises in route handlers, it quietly returns to the old, slower path; nothing breaks. A comment there naming that fallback would help the next reader.
- **N5. `e2e/working-hours-day.ts:38-48`:** a run between about 23:30 and 23:56 IST gets a working day that ends 2 to 13 minutes away, so a slow test can cross the end time. CI starts at 00:01 IST, so it does not bite there. Accepted by the advisor (x5-rev1).
- **N6. `/diagnostics/approvals-timing` and `/diagnostics/timing` stay open to every signed-in member** (numbers only, about a dozen reads per hit, no limit). On `main` since v1.7/v1.9, so not a v2 regression; the same concern as sec 2.
- **N7. Account menu "Help" row** (`src/core/ui/shell/account-menu.tsx:56-57`): `DropdownMenuItem asChild` with a `Link` that carries its own `data-slot="account-help"`. With Radix `Slot` the child's attribute wins, so this row would miss the phone menu size rule (`globals.css:949`, under `max-width: 767px`). Unchanged from `main`, and I did not confirm the account menu is shown at phone width. Rename to `data-action` if it is.

### Nits

- `src/core/auth/server.ts:16`: an orphaned doc comment ("This request's first-read hold counters, for the diagnostics") left above an unrelated import after caa7b78e removed the export.
- `src/modules/expenses/data/claims.ts:150-151`: the comment says My Day and Today start the claim setup "with the session read (`startEarly`)"; since 7810aa6c they start it after.
- `src/app/(app)/today/admin-today.tsx:109` and `today/page.tsx` each call `todayIST()`; a request that crosses IST midnight would miss the page's started reads (a second read, never mixed data). Passing `today` down would finish the X6 nit.

### Checked and found correct

- **7810aa6c (End day claim setup):** both promises carry `.catch(() => null)`, so a failed page render leaves no unhandled rejection; on `/my-day` the extra `requirePermission` shares the cached session read, and its redirect is swallowed only on the claim chain, never on the page's own check (`my-day/page.tsx:67-71`). Admin `/today`: 3 + 2 reads in the second wave.
- **13ad12db (Approvals days in the first wave):** the same unconditional read as `main`; an Admin's rows are dropped by `decidesAttendance`, as before.
- **1bd2edb2 (Appearance choice):** `appearance-sheet.tsx:62-72`: with its own history entry, back closes the sheet and then the theme is set; without one, the theme is set and the sheet closes in the same tap. A double tap is ignored by `closeOverlaysThen`.
- **746d9e62 / X5 Suspense move:** each preview group's boundary now sits in the server component with a fallback of `<li>` rows inside the existing `<ul>` (`owner-today.tsx:312-382`, `approval-group-skeleton.tsx:37-67`); valid markup, counts from the server.
- **bafd6f45 (CI):** `ci.yml:176-187` installs Chromium, proves a headless launch, and falls back to `install-deps` then launches again; under `set -euo pipefail` a second failure stops the job. Only `.github/workflows/ci.yml` changed. No other workflow runs `playwright install`.
- **caa7b78e:** only removals; `first-reads.ts` `wait()` keeps its valve and clears its timer.
- **Live refresh during a navigation:** the guard the advisor asked for already exists (`live-updates.tsx:104-107, 212-215`, `liveRefreshWaits`); 61e99836 adds the spec for it and cuts Realtime only in the loading-screen describe.
- **Scans of the added lines:** no `console.log`, TODO/FIXME, `any`, `@ts-ignore`, `eslint-disable`; no `new Date()` in non-test `src` (the one `Date.now()` is the hold timer in the head script, not a business date); no `now()::date` or `current_date` in the new migration; no retries, `test.fixme`, `test.slow`, `waitForTimeout` or raised timeouts in `e2e/`. The two new `setTimeout`s in specs are a simulated slow chunk (`dashboards.spec.ts`) and the wave's poll, not assertions.

### Verification story

- Tests reviewed: yes, by reading. pgTAP 121, 131, 135, 142, 143 and the e2e and unit diffs. Nothing was executed.
- Build verified: no (read-only brief).
- Security checked: the one definer function changed (`requests_to_decide_count`) matches the RLS helper; grants restated; no new route, no new table. A separate security pass is still worth running on the full release diff.
