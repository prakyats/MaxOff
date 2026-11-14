# MaxOff v2.0 "Fast and settled": static performance review

Checkout: `phase-v2` at `bafd6f45`, compared with `origin/main` (v1.9). Read-only; nothing was run against any environment, nothing was built.

## Web Performance Audit

### Scorecard

| Metric | Value | Source | Target | Status |
|---|---|---|---|---|
| LCP | not measured | — | ≤ 2.5 s | — |
| INP | not measured | — | ≤ 200 ms | — |
| CLS | not measured | — | ≤ 0.1 | — |
| Lighthouse Performance | not measured | — | ≥ 90 | — |

> Artifacts used: **none, source analysis only.** The only numbers quoted are the project's own, from `docs/decisions/0017-worker-placement-rejected.md` (CI probe from the US, ~220 ms per database trip) and `bundle-budget.json`; they are cited as the project's measurements, not mine.
> Stack: Next.js 16.3.5 App Router (React 19.2, Turbopack), `@opennextjs/cloudflare` 1.20.6 on Cloudflare Workers, Supabase (PostgREST + Postgres, Mumbai), `@supabase/ssr`, Sentry (lazy on the client), service worker for skeleton prefetches.
> Every finding below is **potential impact** from reading code. Millisecond figures are estimates in "database trips" (one Worker→Supabase round trip; the ADR measured ~30 ms beside the database, ~220 ms from the US).

### Summary

- Blocks v2.0 (real regression vs main): **0 found**
- v2.1 candidate, invisible: 13
- v2.1 candidate, needs owner: 3
- Pre-release checks worth doing (cheap, not blockers): 2

Overall: the release does what it says. Every traced route's first wave is at most six reads at HEAD, the shell is one early read plus the counts, and the folds are security invoker with the old reads' semantics. What is left is almost all **after** the first wave: second and third waves the first-wave gate does not count, reads that only hold the last byte, and helpers whose cost grows with history, which staging (no real data) cannot show.

---

## 1. Server reads per route (HEAD)

Shared by every full page load:
- `src/proxy.ts` → `updateSession` (`src/core/auth/session.ts`): `getClaims()` (local once the JWKS is cached; a token refresh at GoTrue when the access token has expired).
- `src/app/(app)/layout.tsx:119-151`: `session_early()` (member, own day, own hours, push status) and `session_bundle()` (counts, streamed, never awaited). `getRealtimeAuth()` is `getSession()` from cookies, no trip. The first byte waits for the proxy plus `session_early()` only.
- A soft navigation (the installed app's normal path) does not re-render the layout: it reads the member row alone, or `session_early()` when the page asks for the own day.

"W1" = started before any answer; "W2/W3" = started only after an earlier answer. Counts include the two shell reads.

| Route | W1 (first wave) | Later waves | Waterfall / note |
|---|---|---|---|
| `/today` Owner | 6: early, bundle, `attendance_board_today`, open tasks, directory, `own_week` (`today/page.tsx:32-41`) | **W2: 13 reads** (`owner-today.tsx:140-161`: 6 approval lists, not-noted, unreachable, held emails, yesterday unended, task types, overdue items, leave days after directory). **W3:** `task_unread_counts` (`:220`) | 13 reads at six-at-a-time is three batches. Roughly 5 trips to the last byte; ADR-0017's own US number (1078 ms at ~220 ms a trip) fits that shape. Unchanged vs main. |
| `/today` Admin | same 6 (the board read is refused and dropped) | **W2: ~9** (`admin-today.tsx:126-145`: labels, clients, unreachable, item rows, sent-back reviews then their items, items to decide, current cycles, approved leave). **W3: ~7** (`:198-205`: unread, leave days, item stages, reviews, last changes, plus claim setup ×2) | 5 to 6 trips. One wasted read in W1 (the board, refused for an Admin). |
| `/my-day` | 6: early, bundle, open tasks, directory, labels, `own_week` | W2: `task_unread_counts` (after open tasks), claim setup ×2 | 2 trips. Unread counts are asked for every open row. |
| `/tasks` | 6: early, bundle, open tasks, directory, labels, `own_week` | W2: unread counts. **W3 (Owner/Admin): 6 reads** for the New task dialog (`(list)/page.tsx:162` → `task-form-setup.ts:29-37`: types, coordinators, label clients, settings, definitions, templates) | The dialog's setup starts in the render, after W2, and holds the last byte. 4 trips for leads, 2 for Crew. |
| `/tasks/[id]` | 6: early, bundle, `getTaskTitle` (metadata), `task_page`, task types, definitions | W2: directory (leads: `readDirectory`, started only after the member row, `page.tsx:110-112`; Crew: `listDirectoryOf` after the task). W3 (managers): form setup (coordinators, label clients, settings, templates) | Title is read twice (alone and inside `task_page`). Coordinators are read twice for a manager (`task_page.coordinators` and `readCoordinators()` in the form setup). |
| `/calendar` | **2 only**: early, bundle. Page reads wait for `requireMember()` (`calendar/page.tsx:54`) | **W2: 8 to 10** (`:67-86`: events, due tasks, holidays, settings, directory, types, labels, leave, availability (Admin), items (leads)). **W3 (leads): 7** (`:203`, form setup) | Slowest route by shape: ~6 trips. Three duplicates for leads: `listDirectory()`, `listTaskTypes()`, `getSettings()` are called uncached by the page and again by the form setup (`readDirectory`, `readTaskTypes`, `getSettings`). Unchanged vs main. |
| `/clients` | 6: early, bundle, client summaries, directory, client definitions, `client_work_summary` | none | 1 wave. |
| client page | 5: early, bundle, client, directory, `client_overview` | W2: projects + current cycle meters (`(tabs)/page.tsx:83-87`, `:318-321`) | Both W2 reads are keyed by the URL id and could ride in `client_overview`. |
| project page | 6: early, bundle, client, directory, `project_page`, title | **W2:** the current cycle's items (`page.tsx:152-158`). **W3:** item stages, reviews, origin cycles, last changes, resume list (`:173-183`) | 3 waves. Only `?cycle=` taps get their items in W1. `project_page.unfinished` ships full item rows; the page uses `unfinished.length` only (`:316`). |
| `/people` | 6: early, bundle, members, directory, job titles, coordinators | W2 (Admin): availability | Both list shapes start; the role drops one. |
| person page | 6: early, bundle, person, directory, titles, coordinator history | W2 (Owner): board, month summary, comp balance (`people/[id]/page.tsx:66-70`, `layout.tsx:57`) | 2 trips for the Owner. |
| `/approvals` | 5: early, bundle, both task steps, directory, pending days | W2: unread counts; requests, notes, claims, early leaves only when the counts say one waits (`approvals/page.tsx:66-74`) | Deliberate and commented. Fine. |
| `/reports` Owner | 2: early, bundle | W2: month summary, approved claims, on hold (`reports/page.tsx:58-65`), streamed in Suspense | Header paints after trip 1; deliberate (no money read on an Admin's request). |
| `/reports` Admin | 2 | W2: 7 reads (`admin-report.tsx:70-79`). W3: item stages (`:105`) | 4 trips. Open tasks and directory are role-independent and could start early. |
| `/settings` | 2 | none | Shell only. |
| `/settings/templates` | 6: early, bundle, `templates_library`, definitions, directory, settings | none | 1 wave. |
| `/me` | 5: early, bundle, own member, own freelancers, push subscriptions | conditional: directory of freelancers, onboarding (`me/page.tsx:92-96`, sequential) | Rare branches. |
| `/notifications` | ≤ 4: early, bundle, inbox page, unread | none | 1 wave. |
| `/leave` | 5: early, bundle, `own_comp_leave` (layout), requests, approved leave | none | 1 wave. |
| `/leave/attendance` | 5: early, bundle, comp leave, own member, `working_day_rule` | W2: `listDays` (`attendance/page.tsx:39`) | Waits for `joinedAt`, which `session_early().member` does not carry. |
| `/leave/extra-work` | 6: early, bundle, comp balance, credits, own notes, `working_day_rule` | none | 1 wave. |
| `/leave/expenses` | 3: early, bundle, own claims | W2: claim setup ×2, started in the render (`expenses/page.tsx:32`) | Same "holds the last byte" pattern that `7810aa6c` fixed on Today and My Day, not fixed here. |

Positive: the six-read first wave holds everywhere I traced; `cache()` wrappers cover the shared reads; `checkThenRead` is used consistently; no route awaits one independent read after another inside the first wave.

---

## 2. Findings

### v2.1 candidates: invisible (no behaviour change)

#### [HIGH] V1. Owner and Admin Today: the second wave is 9 to 13 reads
- **Area:** Network
- **Location:** `src/app/(app)/today/owner-today.tsx:140-161`, `today/reads.ts:76-87`, `today/admin-today.tsx:126-145` and `:198-205`
- **Description:** The first-wave gate counts only what starts before any answer. The Owner's screen then starts 13 reads at once, which a Worker sends six at a time: three batches, then a fourth trip for unread counts. `readApprovals` asks all six approval lists unconditionally, although `session_bundle()` (already in flight) says which are empty; `/approvals` already uses that (`whenWaiting`).
- **Impact (potential):** 2 to 3 trips off the Owner's and the Admin's home screen last byte. About 60 to 100 ms from India, 400 to 600 ms from a far visitor.
- **Recommendation:** (a) gate the five rarer lists on the bundle's counts with the existing `whenWaiting`, as `/approvals` does; (b) fold the Owner's remaining signals (not noted, unreachable, held emails, unended yesterday, overdue items, task types) into one security-invoker `today_owner()` read; (c) for the Admin fold client work (item rows, sent back, to decide, current cycles) into one read. Risk: low for (a), medium for (b) and (c) (new RPCs need pgTAP per role).

#### [HIGH] V2. Calendar: every page read waits for the member row, then a third wave of duplicates
- **Area:** Network
- **Location:** `src/app/(app)/calendar/page.tsx:54`, `:67-86`, `:203`; `src/app/(app)/tasks/task-form-setup.ts:29-37`
- **Description:** Nothing but the shell starts in W1. Holidays, settings, directory, task types, labels, events and due tasks depend only on the URL, yet start after `requireMember()`. For the Owner and Admins the task dialog's setup then re-reads the directory, the task types and the settings (the page calls the uncached `listDirectory`, `listTaskTypes`, `getSettings`; the setup calls `readDirectory`, `readTaskTypes`, `getSettings`).
- **Impact (potential):** about 6 trips today; 2 to 3 are avoidable. 60 to 100 ms from India.
- **Recommendation:** parse the query before the session check and `startEarly` the seven role-independent reads through the `cache()`d wrappers in `tasks/reads.ts` (wrap `getSettings` too), leaving leave, availability and items for after the role. Better: one `calendar_window(from, to)` fold shaped like `own_week`. Risk: low for the early start and dedupe.

#### [MEDIUM] V3. The task dialog's setup holds the last byte on Tasks, a task and Calendar
- **Area:** Network
- **Location:** `src/app/(app)/tasks/(list)/page.tsx:162`, `tasks/[id]/page.tsx:279`, `calendar/page.tsx:203`
- **Description:** `loadTaskFormSetup(viewer)` is created in the JSX, after every earlier wave, and its promise goes to a client component, so the response stays open for one more wave of 4 to 6 reads that nothing on screen needs. This is exactly what `7810aa6c` moved for End day's claim setup.
- **Impact (potential):** one trip of last byte on three lead routes (30 to 40 ms India), plus six reads per Tasks load that are used only when New task is tapped.
- **Recommendation:** short term, start it when the permission check resolves (as `my-day/page.tsx` does for `claimSetup`). Better: read it on first open through a background GET (the pattern of `/api/client-work/deliverable-templates`), prefetched on idle. Risk: low; the dialog already handles a null setup.

#### [MEDIUM] V4. Expenses: claim setup still starts in the render
- **Location:** `src/app/(app)/leave/(work)/expenses/page.tsx:32`
- **Impact (potential):** one extra trip to the last byte. **Recommendation:** start `getClaimSetup()` before the `checkThenRead`. Risk: none.

#### [MEDIUM] V5. Project page: three waves
- **Location:** `src/app/(app)/clients/[id]/projects/[projectId]/page.tsx:108-183`; `supabase/migrations/20261106020000_project_page.sql`
- **Description:** The current cycle's items wait for the cycles, and the items' stages, reviews and last changes wait for the items.
- **Impact (potential):** 2 trips (60 to 80 ms India).
- **Recommendation:** let `project_page()` take an optional cycle id and today's date, pick the cycle as `currentCycle` does, and return that cycle's items with their stages, reviews and last changes; return `unfinished` as a count. Risk: medium (the choice of cycle moves into SQL; needs a drift test against `currentCycle`).

#### [MEDIUM] V6. Client page: projects and cycle meters in a second wave
- **Location:** `src/app/(app)/clients/[id]/(tabs)/page.tsx:83-87`, `:318-321`
- **Recommendation:** add both to `client_overview()` (RLS already hides them from a viewer without `projects.manage`). One trip saved. Risk: low.

#### [MEDIUM] V7. `task_page()` runs the directory walk twice in a row for Crew
- **Area:** Database
- **Location:** `supabase/migrations/20261105230000_task_page.sql` (`coordinators`, `labels`); view `freelancer_coordinators` (`20260929212258_phase4c_names_and_labels.sql:162-172`); `app.directory_visible_ids()` (`20261106030000_rls_helpers_plpgsql.sql:149-244`)
- **Description:** For a viewer without `team.view` the view tests `member_id in (select app.directory_visible_ids())` and `coordinator_id in (select app.directory_visible_ids())`: two calls. Each walks every task the member can see, ever, with its assignees, reviews, comments, stages, submissions and `activity_log` rows. `client_labels` then walks the visible tasks again, and `listDirectoryOf` calls the walk a third time in the next request. In v1.9 these were separate requests; now two of them run one after the other inside the read the whole task page waits for.
- **Impact (potential):** nothing on staging. For a Crew member with a year of tasks, tens of milliseconds per task open, growing with history. This is the main "real data volume" risk in the release, and Crew on phones are the ones who pay.
- **Recommendation:** rewrite the view to call the helper once (`with ids as materialized (select app.directory_visible_ids() as id)`), same rows; expand-only `create or replace view`. Run `EXPLAIN (ANALYZE, BUFFERS)` of `task_page()` as a Crew member on `scripts/measure-seed.sql` scaled to a year first. Risk: low (pgTAP 137 and the RLS suite cover the result).

#### [MEDIUM] V8. Avatars: four trips in a row per image
- **Location:** `src/app/api/files/[id]/route.ts` (member, then `getFile`, then `getPreviewOf`, then storage)
- **Description:** Each `await` waits for the one before; a list of 25 faces is 25 Worker requests of four sequential trips, once a day per device (`max-age=86400`). The route sets an `etag` but never answers `If-None-Match` with 304.
- **Impact (potential):** faces land about 2 trips later than they need to on a first visit of the day.
- **Recommendation:** read the file and its preview in one query, started with the session check; answer 304 on a matching etag. Risk: low.

#### [LOW] V9. One Supabase client per read
- **Location:** `src/core/db/server.ts:47-72` (`createServerSupabase` is not `cache()`d; every data function calls it)
- **Description:** A screen with 15 to 20 reads builds 15 to 20 `@supabase/ssr` clients, each loading the session from the cookies before its first query.
- **Impact (potential):** a few ms of Worker CPU per request; unmeasured.
- **Recommendation:** measure with `/diagnostics/timing` first; if it shows, keep one client per request behind `cache()` while still awaiting `firstReads().wait()` per call. Risk: medium (it sits under the first-reads hold).

#### [LOW] V10. Geist Mono is preloaded on every document
- **Location:** `src/app/layout.tsx:21`; used in five rare places only (`brand-record.tsx`, `field-definition-dialog.tsx`, `field-definitions-manager.tsx`, `invite-link-panel.tsx`)
- **Impact (potential):** one high-priority font download on a cold first visit that no first screen uses.
- **Recommendation:** `Geist_Mono({ subsets: ["latin"], variable: "--font-mono", preload: false })`. Risk: none.

#### [LOW] V11. Small duplicates and over-fetches
- `getTaskTitle` beside `task_page` on a full task load (`tasks/[id]/page.tsx:84`).
- `readCoordinators()` in the form setup beside `task_page.coordinators` on a manager's task page.
- `/tasks` and `/my-day` ask unread counts for every open row, not only the rows drawn (`(list)/page.tsx:93`, `my-day/page.tsx`); folding the count into the open-tasks read would also remove the second trip on the two most-opened screens.
- An Admin's `/today` sends the Owner's board read, which is refused (`today/page.tsx:32-36`); harmless but one of the six slots.
- `/leave/attendance`: adding `joined_at` to `session_early().member` would let `listDays` start in the first wave.

#### [LOW] V12. Sign-in makes four database trips in a row after the password check
- **Location:** `src/core/auth/actions.ts:58-94` (`member_self_status`, `session_login`, own role, onboarding)
- **Recommendation:** let `session_login` return status, role and onboarding. Rare path (30-day sessions). Risk: low.

#### [INFO] V13. Indexes I would add (expand-only), each only after an EXPLAIN shows it used
- `create index early_leave_requests_day_idx on public.early_leave_requests (day_id, requested_at desc);` The lateral in `attendance_hours_today()` (`20261106040000_attendance_hours_once.sql`) picks the newest request per day row; the only index on `day_id` is the partial unique one for `state = 'waiting'`, so every member's lookup scans the table.
- Nothing else is missing for the new folds: `tasks_event_date_idx`, `task_comments_task_idx`, `activity_log_entity_idx (entity, entity_id, at desc)`, `task_reads` and `task_assignees` primary keys, `task_submissions (task_id, version)`, `project_items_project_state_idx`, `project_cycles_project_period_key`, `leave_requests_member_dates_idx` and `task_requests_org_state_idx` cover every filter and join I read. `own_week`'s event filter has no `org_id`, so it walks the whole partial `tasks_event_date_idx`; that index holds event tasks only and one organisation, so it is fine.
- Unbounded aggregation: `task_page` caps comments and activity (201, 200); `own_week` is capped at 62 days; `templates_library` and `project_page.presets` aggregate whole small tables. `project_page.unfinished` grows with open items only.

### v2.1 candidates: need the owner (RLS or a visible rule)

#### [MEDIUM] O1. `tasks_select` calls `app.task_visible(id)` once per row
- **Location:** policy at `20260929…` (`create policy tasks_select … using (app.task_visible(id))`, and the same on `task_assignees`, `task_stages`, `task_comments`, `task_reviews`, `task_submissions`); body at `20261106030000_rls_helpers_plpgsql.sql:71-97`
- **Description:** v2.0 made each call cheap (PL/pgSQL keeps its plan), but the open-tasks read still calls it for every task row and every embedded assignee row, and each call runs its own lookup plus `current_member()` and `is_owner()`. Whether Postgres can apply the `state not in (…)` filter before the policy depends on that operator being leakproof; I could not check that without a database.
- **Impact (potential):** grows with the number of rows the policy sees: a 300-open-task organisation is roughly 900 calls per open-tasks read, on Today, My Day and Tasks.
- **Recommendation:** a set-based policy (`id in (select app.visible_task_ids())`, as `directory_visible_ids` already does for names), or an Owner short-circuit as an InitPlan. This changes RLS text, so it needs the owner's approval and the full pgTAP suite. Check first with `EXPLAIN ANALYZE` of `listOpenTaskRows` as Owner on a volume seed with a year of completed tasks.

#### [MEDIUM] O2. `directory_visible_ids()` grows with history, for ever
- **Description:** see V7; the invisible fix halves the calls, but the walk itself covers every task a Crew member has ever been on. Bounding it (open tasks plus the last N months) changes whose names a Crew member can read on old tasks: a business rule (Kickoff 4 decision 21).
- **Recommendation:** bring the owner a choice only if the EXPLAIN in V7 shows it matters at a year of data.

#### [LOW] O3. Flush the document head before the session read
- **Location:** `src/app/layout.tsx:70-113`, `src/app/(app)/layout.tsx:122`
- **Description:** No Suspense boundary sits above the `(app)` layout, so not one byte (the CSS, script and font links included) leaves until `session_early()` answers.
- **Impact (potential):** the browser starts fetching assets one database trip late on every full load; more on a cold database connection.
- **Recommendation:** a boundary around `{children}` in the root layout would flush `<head>` at once. It changes what a redirect and a 404 look like on the wire (a streamed redirect, a 200 status) and the launch intro's timing, and ARCHITECTURE §19 keeps the progress bar out of any boundary, so it needs a decision and the e2e suite, not a quiet change.

### Pre-release checks (cheap, not blockers)

1. **One EXPLAIN on volume data as a Crew member:** `select public.task_page(…)` and the `member_directory` read, on `scripts/measure-seed.sql` grown to a year (V7). It is the one place where a fold put two formerly parallel heavy reads in a row.
2. **Database memory after the deploy:** fifteen helpers now keep their plans per PostgREST connection (`20261106030000_rls_helpers_plpgsql.sql`). ARCHITECTURE §19 describes production as a memory-starved instance; `directory_visible_ids`' plan is large. Watch memory for a day; nothing to change beforehand.

---

## 3. Client

- **Inline head scripts** (`src/app/layout.tsx:79-87`): five small ES5 scripts (the largest, pre-hydration, is built from an 11.9 KB source file that is mostly comments). They attach listeners and set attributes; no layout read. Blocking cost is negligible. The warm-zone script correctly waits for idle.
- **Listeners:** every `touchstart`/`touchmove`/`scroll` listener I found is passive (`pull-to-refresh.tsx:133-149`, `task-chat.tsx:469`, `task-view.tsx:334`, `pre-hydration.ts:124`). Good.
- **Bundles:** Sentry loads at idle through a dynamic import (`core/observability/client.ts`), zod is kept out of most client parts, menus and sheets load after the page. First-load JS is still 635 to 895 KB decompressed per route by the project's own budget file; `/people` (894 KB), `/approvals` (849 KB) and `/tasks/[id]` (821 KB) are the heavy ones. Seven client-work sheets and `thresholds-form.tsx` still import zod schemas into client code (`add-item-dialog`, `bulk-edit-sheet`, `item-sheet`, `line-stages-sheet`, `new-project-dialog`, `project-menu-layers`, `project-resume-sheet`); they load after the page, so they cost the first tap, not the first load.
- **Lists:** `/tasks` cuts the open list (`OPEN_ON_FIRST_SCREEN`), so a 300-task organisation does not render 300 rows there. No list uses `content-visibility` or windowing; `/tasks/all`, People and Clients at volume are where a low-end Android phone would feel it. `e2e/phone-inp.spec.ts` runs at CPU ×4 on seed data, not on volume.
- **Prefetch:** task rows are answered by the service worker from one kept skeleton (good). Client and person rows are not: each row in view costs a Worker request and its layout's reads (ARCHITECTURE §19 records 29 to 33 requests for 7 client rows). Scrolling a 40-client list on a phone sends a few hundred database reads. Candidate: extend the kept-skeleton trick to `/clients/:id` and `/people/:id`, whose prefetch is also a loading boundary.
- **Fonts:** self-hosted, `swap`; see V10. **Images:** avatars carry width, height, `loading` and `decoding`; see V8 for the route.

## 4. Edge and runtime

- **Cache headers:** hashed assets are `immutable` for a year (`public/_headers`); documents are `no-store` (`core/http/response-headers.ts:46`), which also keeps them out of the back-forward cache. That is the right trade for private data, and the router's own history cache covers back and forward.
- **Dynamic rendering:** nothing is forced that should be static. `/login` is dynamic only because it reads `searchParams`.
- **Streaming:** see O3. Inside the shell, loading boundaries and streamed counts are set up well.
- **Cold start:** not measurable without a build. `serverExternalPackages: ["zod"]` is in place; Sentry stays bundled by a recorded decision.
- **Token expiry:** once the access token has expired, the proxy's `getClaims()` refreshes it at GoTrue before anything renders (`core/auth/session.ts`). That request is one or two trips slower and no probe hits it, because probes mint a fresh session. Worth one line in v2.1's RUM plan.

## 5. What the probes cannot see

1. **Soft navigation.** `scripts/perf-probe.mjs` requests documents only (no RSC request in it), and `first-wave.spec` counts a document's first wave. The installed app mostly navigates by RSC requests, where the layout does not run. The reads are the same or fewer, so this is a gap in evidence, not a known problem.
2. **Waves after the first.** The six-read gate is real and holds, but the last byte on Today, Calendar, a project and Tasks is decided by waves two and three (V1, V2, V3, V5).
3. **Volume.** Staging has no real data. The costs that grow are the per-row policy (O1), the directory walk (V7, O2) and unwindowed lists.
4. **The first load after a token expires**, and the first load of the day for avatars (V8).

## Positive observations

- The first wave is six or fewer on every route traced, with the shell's read built to leave first rather than raced.
- The folds are security invoker, validate their inputs, cap their windows and lists, and keep each part's old shape, so a fallback to the old read still works.
- The PL/pgSQL helper migration keeps every attribute and is guarded by a drift test; it removes re-planning on every policy call.
- The Approvals gating was measured, found slower for pending days, and partly reverted with the reason written down.
- Passive listeners, lazy Sentry, after-page menus, traced Suspense fallbacks and the idle time-zone warm-up are all the right calls for a low-end phone.
