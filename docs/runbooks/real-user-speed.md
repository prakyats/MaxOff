# Runbook: real-user speed (the weekly look)

v7.0 unit 1, "Reliable anywhere" (ROADMAP v2.1 unit 1; owner 11 Nov 2026, #89 6802825415). The team's own phones and laptops
send four measures to Sentry for every page load: **LCP** (the screen's main content drawn), **INP**
(how long a tap waits for an answer), **CLS** (how much the screen jumps) and **TTFB** (the server's
first byte). This is what people really get on Jio and Airtel at 10:00, beside the speed gate's CI and
India probes.

## What is sent (and what never is)

- One Sentry **metric** per measure: `web_vital.lcp`, `web_vital.inp`, `web_vital.cls` (no unit) and
  `web_vital.ttfb`, in milliseconds.
- Its attributes: **`route`**, the screen as a template (`/tasks/:id`, `/clients/:id/projects/:id`,
  `/reports/end-of-day/:date`; never an id); **`role`** (`owner`, `admin`, `staff`, or `signed-out` on
  /login); **`rating`** (web-vitals' good / needs-improvement / poor); **`navigation`** (navigate,
  reload, back-forward, restore…).
- **Nothing personal:** `scrubMetric` (`src/core/observability/web-vitals.ts`) drops every other
  attribute before sending, including the member id that the error reports carry. No name, no
  email, no record id, and no amount.
- Every page load reports (`VITALS_SAMPLE_RATE = 1`; the team is about 20 people). LCP and TTFB belong
  to the screen the page was opened on. INP and CLS are sent when the page is hidden, under the screen
  on view then. A screen reached by a tap inside the app (a soft navigation) adds to INP and CLS, but
  has no LCP or TTFB of its own: those are the speed gate's job.
- Local runs, CI and previews send nothing (no DSN). Only staging and production report.

## The weekly look (Monday, about 10 minutes)

1. sentry.io → project **maxoff** → **Explore → Metrics** (the menu may be named "Metrics" under
   Explore; _unverified against this account, so correct this file if it differs_).
2. Environment **production**, period **last 7 days**.
3. For each of `web_vital.lcp`, `web_vital.inp` and `web_vital.ttfb`: aggregate **p75**, **group by
   `route`**, then add **`role`**. Sort by p75, slowest first.
4. Compare against these lines (Google's "good" thresholds, the ones web-vitals rates by):

   | Measure | Good (p75) | Look closer |
   |---|---|---|
   | LCP | ≤ 2.5 s | > 4 s |
   | INP | ≤ 200 ms | > 500 ms |
   | CLS | ≤ 0.1 | > 0.25 |
   | TTFB | ≤ 800 ms | > 1.8 s |

5. Note the five slowest route × role pairs and their p75 in PROGRESS → "Ideas / tech debt" if any is
   past "Look closer", with the week. Once a route is past "Look closer" two weeks running, it gets a
   roadmap item and is fixed at the cause, as the speed gate's slowdowns are.
6. A route with very few samples (under about 20 in the week) is noise: skip it.

## When something looks wrong

- **No data at all:** check that a page load on production sends a `envelope` request to Sentry's
  ingest host once the page is idle (DevTools → Network, about 3 s after load). Nothing goes before the
  SDK loads; that is on purpose (ARCHITECTURE §18.2).
- **A `user.id` attribute appears:** that is a bug in `scrubMetric`. Fix it before anything else
  (invariant: nothing personal).
