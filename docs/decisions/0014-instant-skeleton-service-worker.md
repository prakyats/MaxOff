# ADR-0014: The service worker answers skeletons at once, never data

- **Status:** accepted
- **Date:** 2026-10-15 (pre-authorised by the owner for unit P2, "make the app fast for free")

## Context

Unit P (ARCHITECTURE §19, "Measuring the Worker") found that the slowness the team feels is the
**Worker cold start**: a request that lands on a fresh isolate waits 1.5–4.5 s before its first
byte, and a fresh connection lands on one most of the time. A warm tap shows the destination's
traced loading skeleton at once (§19 "Prefetch the tabs": a dynamic route prefetches up to its
`loading.tsx`), but that prefetch is itself a request to the Worker, kept in the router's memory
only. Measured with every server answer held 3 s (`e2e/instant-skeleton.spec.ts`), a tap shows
nothing until the server answers whenever that prefetch is missing at tap time:

- **it has not finished**: right after the app opens (the prefetch waits for the cold Worker too);
- **it was dropped**: refresh on return (§14.2 i) invalidates the router's prefetches every time
  the app comes back after 30 s, and the More sheet's destinations and home are prefetched again
  only on the next navigation; the bar's links ask again, from a Worker that is cold by then;
- **it expired** (`staleTimes.static`, 180 s) or **was never made** (a list row not yet seen);
- **a document navigation** (a reload, a deep link, the installed app's start) gets nothing until
  the HTML arrives.

ARCHITECTURE §14 kept the service worker "a minimal offline shell": it cached only hashed static
assets, the icons and `/offline`, and never touched a request carrying a member's data. Nothing in
it could answer a tap faster than the Worker.

## Decision

**The service worker may answer one kind of request from its cache: the router's prefetch of a
proven data-free skeleton. Everything a member's data travels in stays network-only.**

1. **What may be cached** (`public/sw.js`, `SHELL_PATHS` and `SHELL_DRILL_DOWN`): the router's
   *prefetch* requests (`RSC: 1` with `Next-Router-Prefetch: 1`: the route tree and the
   loading-boundary payload) of the top-level destinations (Approvals, Tasks, Calendar, Clients,
   People, Settings, Me, Alerts; not Today, My Day or Reports, whose skeletons show the
   viewer's name or a date) and of a task's page, with no query
   but the router's own `_rsc`. Each is admitted only once a test proves its payload carries no
   member data for every role (`e2e/instant-skeleton.spec.ts`: no record id but the address's
   own, no date, no name or email, no server promise handed to the client). The skeletons are
   shaped by the viewer's role, so they are kept **for one role at a time**: the signed-in shell
   posts its role (the role only) to the worker, and a different role drops them all.
   A copy is keyed by what its answer varies by (the address, the segment asked for and the
   router state tree), never by `_rsc` itself, which also hashes `Next-Url`, the page the
   prefetch was made from; an answer whose `Vary` names `Next-Url` (an interception route) is
   never kept (clarified 2026-10-16: keyed by `_rsc`, a copy kept on Today never answered the
   same prefetch made on Tasks).
2. **Keyed to the build.** Next's `deploymentId` (`core/lib/deployment-id.ts`, one per build) is
   sent by every router request as `x-deployment-id`; a copy is kept under the deployment that
   asked for it and is never answered to a page of another, and a new deployment's first copy
   drops the old. A deploy can never mix builds (a stale build's payload would make Next load the
   whole page again).
3. **Answered at once, refreshed hourly.** Within one deployment and one role a skeleton never
   changes (it is the build's own loading screen and route tree), so a kept copy younger than an
   hour answers alone and the cold Worker is not asked; an older one answers and the network's
   answer replaces it behind it. No request is added.
4. **Dropped on a change of person.** Any signed-out page (`/login`, `/forgot-password`,
   `/set-password`, `/auth/*`), and a prefetch redirected to sign in, drops every copy before the
   next person signs in.
5. **What is never cached:** any response carrying a member's data (a page's own render, a
   navigation's or a refresh's RSC request, a client's or a person's page or `/leave`, whose
   layouts read a record or a balance), documents, server actions and every non-GET, `/api/*`,
   other origins. The data on screen always comes from the network: only the skeleton comes
   from the cache, exactly as it does today from the router's memory.
6. **Navigation preload stays off.** It was tried (a document's request leaving with the tap
   instead of after the worker has started) and dropped: Playwright cannot route a preload
   request, so the launch, offline and production specs could no longer hold or fail a document,
   and its gain (the worker's own start-up) is small against a cold Worker.
7. **Documents get no new screen.** A data-free skeleton page for a reload or deep link (the
   launch screen's hold-and-hand-off) was rejected: it needs a second address (`?launch=`) on
   every route, which shows in the address bar and in Next's search params, and a held response
   per navigation; the installed start already has the launch screen.
8. **§14.2 is unchanged.** Nothing here touches history: a cached prefetch is what the router
   would have had in memory, every move is the same push, replace or back, and no entry is added.

## Consequences

- A tap shows its destination's skeleton at once whenever the router asks for its prefetch first,
  even while the Worker is cold, and the data streams in from the network behind it.
- Adding a route to `SHELL_PATHS` needs the e2e proof for it first; a layout or a loading screen
  that starts reading a member's data takes its route out (the spec fails until it is removed).
- `deploymentId` changes how Next spots a new deployment (the id instead of the build id) and adds
  `?dpl=` to asset URLs; skew protection stays off (`open-next.config.ts`).
- A local production build reuses the id "local": a rebuild with the same browser profile may
  answer one stale skeleton, which Next replaces with a full page load.
- The warm-up (`/api/warm`, ARCHITECTURE §19 "Warm the Worker early") is a separate,
  network-only request and is never cached.
- **Proved (2026-10-16):** installed at 375 and 430 px with every server answer held 3 s, a bar
  tab, a task row and a More-sheet destination show their traced skeleton 154–212 ms after the
  finger goes down (an 80 ms rest included), where they took ~3.2 s; a reload, a client's page and
  the first open of a new install (nothing kept yet) still wait for the Worker, by design.
