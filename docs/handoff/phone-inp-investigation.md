# phone-inp.spec at 375 px, CPU ×4: the investigation (26 Nov 2026, WIP)

`e2e/phone-inp.spec.ts` turns red about 20 % of the time on `main`'s own code: a More-sheet row tap (`/tasks → /clients` for the Owner, `/leave → /me` for the Crew) scores 96–232 ms against the 200 ms gate. Branch `fix-phone-inp` from `main` 51d5d9f. The gate, the CPU factor and the limit are unchanged.

## How it was measured
`docs/handoff/phone-inp-trace.spec.ts.txt` is the throwaway spec. Copy it to `e2e/zz-inp-trace.spec.ts`, run it at `--project=mobile`, and never commit it to `e2e/`. It does the Owner's `/tasks` → More → `/clients` at 375 px, CPU ×4, and records:
- each Event Timing entry split into input delay, processing and presentation;
- the long tasks;
- a Chrome trace around the row tap (`devtools.timeline` + `disabled-by-default-v8.cpu_profiler`).

## Cause 1 (found, fixed here): the sheet closed inside the click
- Off the installed app, the row's `follow()` called `close()` (`setOpen(false)`) in the click handler. React renders a discrete event's update synchronously, so the sheet's exit render ran inside the click. Radix `Presence` then read `getComputedStyle(node).animationName` (its `getAnimationName`, `c` in the build), a **forced style recalc of the whole page underneath**.
- Trace: click handler 42–61 ms; `getAnimationName` about 16 ms self time; two `UpdateLayoutTree` passes of 8–19 ms before the next paint.
- Fix: `startTransition(close)` (`src/core/ui/shell/more-sheet.tsx`). The sheet now closes in the same transition as the Link's navigation, after the tap has painted.
- Measured, 4 runs each:
  - processing 42–46 → 24–37 ms;
  - INP 104–112 → 96–104 ms locally.

## Cause 2 (open, the bigger one): long tasks still running on /tasks when the tap lands
- After hydration, `/tasks` still runs long tasks of **90–146 ms at ×4**, between about 1.4 s and 2.5 s after load. Examples: (1482 ms, 89), (1501, 125), (1675, 146), (2541, 145).
- `phone-inp.spec` taps More and then the row as soon as each is visible. A tap that lands in one of these waits for it, adding up to about 146 ms of input delay, which fits CI's 232 ms peaks and the ~20 % rate.
- **Next step:** record the trace over the page load, not just the tap, and name each of those long tasks. Candidates:
  - `TaskTapSkeleton`'s once-per-page render of the task skeleton into a detached node;
  - `MoreSheetLazy`'s code load and first render on the More tap;
  - the likely-next prefetch;
  - a lazy chunk's evaluation.
  
  Then split or defer the culprit at its cause (yield between parts, render on idle, or smaller chunks).
- **Then:** 20 runs of `phone-inp.spec` before and after (`--repeat-each 20 --project=mobile`), with the INP per tap from the annotations.
