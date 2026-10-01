# v1.3.1 handoff (paused 2026-10-01 ~16:10 UTC on the owner's order)

This file lives only on `wip/5a-reload-backup` (a [skip ci] backup branch). It is not for `main`.

## Where things are
- v1.3.0 = PR #34 merged into `main` (contains 4d55679). Production is live; nothing here touches it.
- The v1.3.1 work is the commit below this one on this branch (216bba3, on top of phase-5 4d55679, 18 files).
  A local copy also sits in the container as `git stash` "v1.3.1 WIP" (may be lost on restart; this branch is the record).
- Target branch: `fix/no-surprise-reloads`, created from `origin/main`. **Never push to `phase-5`.**

## What the work contains (done in code)
- Root causes (motion.spec "opened directly"): (a) a tap before the streamed BackLink is `data-live` hits the
  pre-hydration head script's `location.replace` (full load); (b) a tap the instant the link goes live loses its
  transition type to the next Suspense-hydration commit (React `claimQueuedTransitionTypes`), so no slide.
- `src/core/ui/navigation/pre-hydration.ts`: a tap on a not-yet-live back/view/tab link is held, replayed via
  click() once `data-live` appears; full-load move only after `PRE_HYDRATION_WAIT_MS` = 2 s. Unit tests rewritten.
- `slide.ts` `nameSlide()`/`slideCommitted()` + CSS `html[data-nav-slide=forward]`: the slide is named on <html>
  at the tap; dropped at the view transition's `ready`, at a commit without one, or after 3 s. `slide.test.ts`.
- Reload guard: `e2e/document-loads.ts` + fixtures option `documentLoads` (suite-wide), `reloadGuard.allow()`;
  pre-hydration.spec opts out; tap-feedback :230/:302 allow their by-design loads; `/forbidden` bounce expected.
- Docs edited: ARCHITECTURE §14.2 (j)/(l), PROGRESS Ideas (h) + a session-log row (re-word them for the v1.3.1 branch).

## Owner decisions to apply (2026-10-01, binding)
1. The 2 s hold is the new §14.2 (l) rule **on condition** the held tap is acknowledged at once (pressed state
   within 100 ms + the navigation progress bar, per §14.1). Add a Playwright test for exactly that, and word §14.2 (l) so.
2. `/today` and `/my-day` budget 785 → **790 KB** in `bundle-budget.json` (the fix adds ~1 KB; measured 786.0),
   reason written there and in PROGRESS, plus: "the spare ~4 KB is not feature headroom; phase 6's Today / My Day
   sections load in their own lazy or streamed chunks and may not raise this budget without an owner decision."
3. Also on this branch: `e2e/sticky-actions.spec.ts:87` (main CI run 36879970598): at 200% text on a person's Profile
   the Save bar covered the last field by 20 px, intermittent. Suspect: the push band reserves one line
   (`--app-push-h: 2.75rem`, globals.css) and measures two at 200% after load, so `--app-bands-h` grows after the
   page was scrolled. Find the cause with a late-band repro, fix it, prove with `--repeat-each=20`.
   Orchestrator's view (owner asked): not a v1.3.0 blocker — the field stays reachable by scrolling / focusing.

## Not yet proven
- `pnpm check` (budget failed at 786 > 785 before the raise), the role-label sweep.
- motion.spec:138 (an extra forward slide was a regression of an earlier version; fixed in source, not re-run).
- Whole-project reload-guard sweeps (mobile-lg at 3 workers, then desktop and mobile); explain every guard hit.
- task-page.spec:525 desktop (Activity's third tick "Mix" missing once) — rerun `--repeat-each=10`, root-cause if red.
- The new held-tap test; sticky-actions repro and fix.
- Earlier "push:137" / "extra-work:58" red runs were harness artifacts (hand-started server) — re-run on the real config.

## Resume steps
1. `git fetch origin && git switch -c fix/no-surprise-reloads origin/main`
2. Bring the work over: `git checkout origin/wip/5a-reload-backup~1 -- .` is NOT right (it would revert main);
   instead `git diff 4d55679 216bba3 | git apply --3way` (216bba3 = the work commit), resolve, then review the diff.
3. Docker: `nohup dockerd >/tmp/dockerd.log 2>&1 &`; `pnpm db:start`, `pnpm db:reset`, `pnpm storage:start`.
4. Apply the owner decisions above, then `pnpm check` + role-label sweep; e2e one run at a time (shared
   test-results); no full run across 18:05–18:40 UTC; no retries, longer timeouts or weakened assertions.
5. Commit (Conventional + the two attribution lines), `git push -u origin fix/no-surprise-reloads`, full CI
   (workflow_dispatch, full=true), then open the v1.3.1 PR (owner merges and tags).
6. Pending for the **5B branch's first commit** (not v1.3.1): 5B decision (12) addendum — an event task's
   "tomorrow" reminder at 18:00 IST is always emailed (one per event); clear the open flag under (12); plus the
   other pending 5B notes.
