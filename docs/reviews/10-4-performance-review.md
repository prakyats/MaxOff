# 10.4: performance review (findings only)

Date: 23 Oct 2026. Base: `main` at `1b21ef6`. **Findings only. No fixes are made here, and nothing was run against any database.**

## Context

- **Where the time goes.**
  - The team is in India. The Worker talks to Supabase in Mumbai, about 40 ms per round trip (ARCHITECTURE §19).
  - Production runs on a Free-plan nano database that swaps.
  - The **Worker cold start** (about 1.5–2.5 s from India) is the biggest cost measured so far. It is Next's server start in a fresh isolate (unit P, ROADMAP 6b.19).
- **Database queries are fast today.** The §19 EXPLAIN pass on `scripts/measure-seed.sql` found every main query at 0.3–7 ms. The rule stays: **no index without an EXPLAIN that shows it used.**
- **What this review is mostly about:** cost that **grows with history**, the speed gate's coverage, and one unexplained production gap. It is not about slow screens today.
- **Not built yet:** revenue and search (`src/modules/revenue`, `src/modules/search` hold only `.gitkeep`), so they are not reviewed.

Impact means how much the team would feel it. Effort: **S** is under half a day, **M** is one to two days, **L** is more.

---

## Ranked findings

### 1. Production's database path is about 2× slower than staging's

**Impact:** high. **Effort:** S to look, fix unknown.

- **What was measured.** `/api/health` warm took 877 ms on production against 422 ms on staging, from the same Cloudflare colo (PROGRESS, P2 leftovers (d)).
- **Where it may come from.** The production project's compute, its pooler, or the swapping nano.
- **Status.** It was never followed up, and no probe has been recorded since v1.7.1.
- Every screen pays this on every database round trip, so it is the largest known gap.

**Recommended fix:**
1. Run `perf-probe` signed out against production and staging in the same hour.
2. Compare the pooler mode and the region in the two Supabase dashboards, and the compute size and swap.
3. Then decide with the Owner. One option is a compute add-on, which costs money and needs the Owner.

### 2. The speed gate does not cover "every route", and it does not check itself

**Impact:** high (it is what stops slow releases). **Effort:** S–M.

- **What exists.**
  - `scripts/perf-probe.mjs` (Preview workflow `perf-probe` job, `.github/workflows/preview.yml`) measures TTFB, server time and cold starts, on fresh and kept-alive connections.
  - It probes `/login`, `/today`, `/tasks`, `/clients`, one client, one project, `/settings/templates`, health and warm.
  - The gate itself is in CLAUDE.md's Definition of Done:
    - warm TTFB p50 ≤ 600 ms;
    - no route slower than live by more than 10% or 100 ms;
    - tap to skeleton ≤ 300 ms;
    - budgets never raised;
    - no new shared-layout read.
- **Gaps.**
  - It does not probe `/my-day`, `/approvals`, `/people`, `/reports`, `/calendar`, `/me`, `/leave`, `/attendance` or `/expenses`. That includes the Crew's home screen.
  - The script has **no thresholds**. A person compares the before/after table by hand.
  - Its header comment points to `.github/workflows/perf.yml`, which does not exist. The job lives in `preview.yml`.

**Recommended fix:**
- (S) Add the missing routes.
- (M) Add a `--compare` mode that reads the staging (live) run and the branch run and exits non-zero on a breach of the DoD numbers.
- (S) Fix the header comment.

### 3. Every Realtime event re-renders the whole screen and its shell

**Impact:** medium-high on busy days. **Effort:** M.

- **What happens.**
  - `src/core/notifications/components/live-updates.tsx` subscribes to `notifications` on every screen.
  - On `/today`, `/my-day` and `/approvals` it also subscribes to `tasks`, `task_assignees`, `attendance_days`, `leave_requests` and `project_items` (`live-rules.ts`).
  - Every event, debounced by 400 ms, calls `router.refresh()`. That re-runs the shared layout's reads and the whole page's reads.
- **Why it costs.** Supabase Realtime also checks each change against each listener's RLS. For tasks that is the per-row `app.task_visible` (finding 4).
- **When it is felt.** On a busy morning, with many acknowledgements, starts and approvals, each open Today screen re-reads everything after every change.

**Recommended fix:** narrow the refresh. Options:
- refresh only the affected section;
- skip events the screen does not show;
- raise the debounce while events keep coming.

Measure the event rate on a busy day first.

### 4. Task and client-work RLS checks visibility once per row

**Impact:** medium, and it grows with history. **Effort:** M–L.

**Tasks.** `tasks_select` and every task child table call `app.task_visible(id)` (`20260929053634_tasks_schema.sql`; latest helper in `20260930070616_phase4_review_fixes.sql`).
- It is a `security definer` function, so Postgres cannot inline it.
- Each call runs `current_member()`, up to three `has_permission` calls, an assignee check, and a freelancer check that calls `app.coordinator_of` for each assignee.
- The callers:
  - `listOpenTaskRows` (`src/modules/tasks/data/tasks.ts`) embeds `task_assignees`, so the check runs again for each assignee row.
  - `listFinishedTaskRows` and `listKpiFacts` run it over completed history, which grows forever.

**Client work.** `app.project_visible(project_id)` → `app.client_visible` is checked per row on every client-work table (`20261008143202_client_work_schema.sql`).
- `project_item_stages` re-runs the `project_items` check for every stage row.
- The heavy callers are `listItemRows`, `listItemStages` and `listReviews`: Today, Calendar, Items, the project page and Reports.

**Recommended fix:**
1. Use the set-based form already used by `project_item_stage_list_select` (`20261009001320_client_work_item_stages.sql`): `id in (select app.visible_task_ids())`, and the same for projects.
2. Prove it with EXPLAIN on `measure-seed` volume before and after.

The change is expand-only: new helper functions, with policies re-created beside the old ones. It needs pgTAP for each role.

### 5. Lists that load everything and keep growing

**Impact:** medium over time. **Effort:** M.

**Load-all reads.** `allPages()` (`src/modules/client-work/data/projects.ts`) fetches 1000-row pages until the end. That is load-all, not paging.

The reads that grow without limit:
- **`listSentBack`** (`src/modules/client-work/data/items.ts`) reads every rejected review ever.
- **`listItemRows({ states: ['open','done'] })`**: done items pile up. Used by Today, Calendar, Items, decide, the project page and Reports.
- **`listKpiFacts`** (`src/modules/tasks/data/dashboards.ts`) reads a period's submissions, reviews and acknowledgements, then adds them up in JavaScript. A long custom range in Reports reads a lot.

**Reads with no limit at all, bounded today by team size:**

| Read | File |
|---|---|
| `listOpenTaskRows` | `tasks.ts` |
| `listClients`, `listClientSummaries` | `clients.ts` |
| `listMembers`, `listDirectory` | `members.ts` |
| `listClientProjects` | `projects.ts` |
| leave between dates | `leave.ts` |
| month claims | `claims.ts` |
| month attendance | `attendance.ts` |

**Already well bounded:**
- leave requests (`.range`);
- `notifications_inbox`;
- `listActivity`;
- `project_activity` (keyset, at most 100);
- `listOwnClaims` (100);
- pending lists (`PENDING_LIMIT`);
- `listFinishedTaskRows(limit)`.

**Recommended fix:**
- (S) Give `listSentBack` a time window or a limit.
- (M) Have `listItemRows` read done items only for the dates a screen shows.
- (M) Move `listKpiFacts` into one SQL aggregate.

The rest can wait until the client and team counts grow.

### 6. `activity_log` is read through 11 OR'ed RLS policies

**Impact:** medium as history grows. **Effort:** M.

- **The policies.** `activity_log` has 11 SELECT policies (`_tasks`, `_client_work`, `_clients`, `_files`, `_expenses_self` and others). Postgres ORs them for every row. Several call per-row helpers: `task_visible`, `project_visible`, `client_visible`, `file_visible`.
- **Growth.** It is the fastest-growing table and is never trimmed (invariant 9).
- **Readers.** `project_activity` and `item_last_changes` (`20261009014443_client_work_rework_fixes.sql`) also call `app.client_work_activity_shown()` per row.
- **Indexes are fine.** `activity_log_entity_idx (entity, entity_id, at desc)` and the partial client-work index.

**Recommended fix:** after finding 4, re-check these with EXPLAIN. If still slow, read history through one security-definer function per screen that checks visibility once for the entity, not once per row.

### 7. Reads that cost each time a page opens

**Impact:** medium. **Effort:** S–M.

**The shared `(app)` layout** (`src/app/(app)/layout.tsx`) makes one parallel wave on each full render:
- `requireMember()`;
- the `session_bundle` RPC (streamed);
- `attendance_own_today`;
- `push_status_own` (awaited).

That is four database reads, down from ten. This is already good. Keep the DoD rule "no new read in a shared layout".

**Second waves still open** (PROGRESS P2 leftovers (b)):
- Today's `task_unread_counts` (`20260930070616_phase4_review_fixes.sql`) runs after the first wave and calls `task_visible` and `coordinator_of` per task.
- The project page makes 3–4 sequential waves, 18 reads.

**Prefetch cost.** Prefetching costs nested layouts' reads. Opening Clients makes 57 database requests and People 63 (§19), because each row's prefetch runs `clients/[id]/(tabs)/layout.tsx`'s `loadClient` + `loadPeople`.

**JWKS fetch.** It runs on every cold isolate: 170–370 ms (P2 leftover (c)).

**Recommended fix:**
- (M) Fold `task_unread_counts` into the first wave as an id-free RPC.
- (M) Flatten the project page into two waves.
- (S) Prefetch client rows on hover or visibility only, not all at once.
- (S–M) Cache the JWKS across isolates (KV or a bundled key with a refresh).

### 8. Bundle budgets: `/calendar` is tight, and many routes have no budget

**Impact:** medium (more first-load JS means a slower first paint on phones). **Effort:** S.

`bundle-budget.json` is checked by `scripts/bundle-budget.mjs` (`pnpm budget`, part of `pnpm check`). These are the latest recorded sizes. **Most predate v1.8, so re-run `pnpm budget --all`.**

| Route | Budget KB | Last measured KB | Headroom |
|---|---|---|---|
| `/calendar` | 712 | 699.5 | **12.5 (1.8%)** |
| `/clients/[id]/projects` | 804 | 765.1 | 38.9 (4.8%) |
| `/clients/items` | 763 | 725.7 | 37.3 (4.9%) |
| `/clients/items/decide` | 706 | 671.8 | 34.2 (4.8%) |
| `/settings/stage-presets` | 708 | 673.6 | 34.4 (4.9%) |
| `/set-password` | 560 | 533.0 | 27.0 (4.8%) |
| `/people` | 932 | 887.4 | 44.6 (4.8%) |
| `/today` | 670 | 636.3 | 33.7 (5.0%) |
| `/my-day` | 670 | 634.6 | 35.4 (5.3%) |
| `/me/guide` | 681 | 642.9 | 38.1 (5.6%) |
| `/approvals` | 884 | 810.9 | 73.1 (8.3%) |
| `/tasks/[id]` | 835 | 763.5 | 71.5 (8.6%) |
| `/login` | 590 | 535.1 | 54.9 (9.3%) |
| `/clients/[id]/projects/[projectId]` | 771 | 687.3 | 83.7 (10.9%) |
| `/tasks/all` | 937 | 788.7 | 148 (15.8%) |
| `/tasks` | 815 | 610.5 | 204 (25%) |

- **Closest to the limit:** `/calendar`.
- **Earlier breach.** The project page once went over (772.1 of 771) before it was cut.
- **Unbudgeted routes.** `/clients`, `/reports`, `/me`, `/leave`, `/attendance`, `/expenses`, `/today/people` and most of `/settings/*` have no budget, so a regression there goes unseen.
- **Stale budgets.** `/tasks` and `/tasks/all` have large unused headroom.

**Recommended fix:**
- (S) Add the unbudgeted routes at measured size + 5%.
- (S) Lower `/tasks`, `/tasks/all` and the settings budgets to measured + 5%. Lowering is allowed; raising is a decision.
- Watch `/calendar` in v1.9.

### 9. Constant background load on a swapping nano database

**Impact:** low-medium. **Effort:** S.

**The Worker cron.** `* * * * *` → `/api/cron/push-dispatch` (`wrangler.jsonc`, `worker/index.js`). Every minute it runs `dispatchPush()` then `dispatchEmail()`. That is at least two claim RPCs a minute, about 2,900 a day, even when nothing is queued.

**pg_cron jobs:**

| Job | Schedule (UTC) |
|---|---|
| `reminders_tick` (includes the end-day reminder) | every 5 min |
| `eod_report` | every 5 min |
| `digest_weekly` | every 5 min, 02–18 h |
| `client_work_alerts` | narrowed |
| `reachability_check` | hourly |
| daily jobs | once each |

`reminders_tick` (latest in `20261015045552_tasks_for_owner.sql`) loops row by row with a savepoint per row. It scans `task_assignees where acknowledged_at is null` with no index for it.

**Recommended fix:**
- (S) Have the dispatcher skip the claims when a cheap "anything queued?" check says no.
- (S) Narrow `eod_report` and `digest_weekly` to the minutes they can actually send. 6b.19 P2 did this for `client_work_alerts`.

### 10. Index candidates for filters that grow

**Impact:** low today. **Effort:** S each (expand-only migration).

Foreign-key coverage is thorough. These filter and order columns have no index that serves them:

| Table.column | Used by | Existing index |
|---|---|---|
| `task_submissions.at` | `listKpiFacts` range, Reports | `(task_id, version)` only |
| `task_reviews.at` | `listKpiFacts` | `(task_id, at)`, `at` not leading |
| `task_assignees` where `acknowledged_at is null` | `listKpiFacts`, `reminders_tick` | none |
| `tasks.updated_at` (finished states) | `listFinishedTaskRows` order + limit | `(org_id, state, due_at)` |
| `item_reviews (decision, at)` | `listSentBack` | `(item_id, at)` |
| `notification_deliveries (channel, state, created_at)` | `emails_held_today` | partial `next_attempt_at` |

**Recommended fix:** per the §19 rule, add one only when EXPLAIN on `measure-seed` volume shows a sequential scan that hurts. The likely first two are `task_assignees (acknowledged_at) where acknowledged_at is null` and `task_submissions (at)`.

### 11. Small items

**Impact:** low. **Effort:** S.

- **Bare `auth.uid()` in policies.** Several policies use it without `(select auth.uid())`, the Supabase "auth_rls_initplan" pattern: `notifications`, `push_subscriptions` (`20260930050132_notifications_core.sql`) and `20261003095939_onboarding_reachability.sql`. A new migration can re-create them in the `(select …)` form.
- **`notifications_inbox` recomputes everything per page.** It runs its window functions over all of a member's notifications for every page (`20261002035734_notifications_inbox.sql`). It is bounded by the 90-day read-removal job. Keyset paging would fix it later.
- **`member_availability` scales with people × days.** Latest in `20261015045552_tasks_for_owner.sql`, it builds people × days with two correlated leave subqueries per cell. That is fine at 20 people.
- **No server data cache.** There is no `unstable_cache` or `'use cache'`: only per-request `cache()` and the client router's `staleTimes`. That is right for live ops data. Do not add one without a reason.

---

## Summary ranking

| # | Finding | Impact | Effort |
|---|---|---|---|
| 1 | Production database path about 2× slower than staging | high | S to look |
| 2 | Speed gate misses most routes and has no automatic check | high | S–M |
| 3 | Realtime event → full screen + shell refresh | medium-high | M |
| 4 | Per-row RLS visibility checks (tasks, client work) | medium, growing | M–L |
| 5 | Load-all lists that grow (`listSentBack`, `listItemRows` done, `listKpiFacts`) | medium, growing | M |
| 6 | `activity_log` 11 OR'ed policies | medium, growing | M |
| 7 | Second waves (Today unread counts, project page), prefetch cost, JWKS on cold start | medium | S–M |
| 8 | `/calendar` 1.8% headroom; many routes unbudgeted | medium | S |
| 9 | Per-minute dispatch and 5-minute jobs on a swapping nano | low-medium | S |
| 10 | Index candidates for growing filters | low | S each |
| 11 | `auth.uid()` initplan, inbox paging, availability grid | low | S |

**Order for 10B:**
1. Do findings 1 and 2 first. They tell us where time really goes and protect every later release.
2. Then do 4 and 5 together, with EXPLAIN before and after.
3. Every fix follows the speed gate, and the expand-only and pgTAP rules.
