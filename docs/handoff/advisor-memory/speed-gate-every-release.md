---
name: speed-gate-every-release
description: Owner 2026-10-22 — every release must be speed-checked against the live one before READY; a slowdown blocks it
metadata:
  type: feedback
---

Owner, 22 Oct 2026: "before the final release of every phase, we need to do a speed check so that the app stays fast… the team said the app is slower [after v1.7.0]. This shouldn't happen at any cost."

**Why:** v1.7.0 regressed speed and the team noticed; trust in the app depends on it feeling fast.
**How to apply:** before READY FOR OWNER, run the Preview workflow's `perf-probe` on the release branch with the staging before/after (Owner/Admin/Crew). Gate: warm TTFB p50 ≤ 600 ms per route, no route slower than live by >10 %/100 ms, tap→skeleton ≤ 300 ms (instant-skeleton in full CI), JS budgets never raised, no new reads in shared layouts. Put the table in the READY post; a slowdown blocks the release. Written into CLAUDE.md DoD (docs PR, 22 Oct). Related: [[premium-every-screen-gate]].

**Amendment, owner 2026-11-11 (option A, "judge finished page too"):** in v2, pages stream their content in the first flush, so TTFB can be 40–100 ms later than v1.9 while the finished page arrives sooner. From now on the gate judges two things:
- **Last byte (content complete):** must not be slower than live, by the >100 ms / >10 % and ≥50 ms rule over two consecutive runs.
- **TTFB:** judged only against the absolute caps, ≤450 ms CI and ≤300 ms India.

My India probe must time both: TTFB (fetch resolve) and last byte (after `x.text()`).

**14 Nov 2026, scoped (owner "don't take longer because of the checks"; PR #148, CLAUDE.md):**
- probe the touched routes for the roles that open them;
- probe every route only for releases touching the shared layout, a shared read or an all-role screen;
- run the India check only when Today, My Day or the layout changes;
- re-probe automatically.

**Also approved:** one full CI run when it is green first time (two for shared-screen releases); a pipeline plus two streams (builder Revenue, integrator Drive).

**Not approved:** lighter walks. A full walk is kept for every release.
