## Security Audit Report: MaxOff v2.0 release candidate

Checkout: `phase-v2` at `bafd6f45`, diff `origin/main...HEAD` (201 files). Read-only; nothing was edited, run against a database, committed or pushed. Paths below are relative to
`C:/Users/ASUS/AppData/Local/Temp/claude/508d9f1f5ad435b4/ea770483-9990-482d-8bc8-b4cbf9e4045e/scratchpad/rc`.

Method: every new migration read in full (14 files); the 15 re-created helpers compared by script against their last prior definition; every policy the invoker folds depend on located and read; every TypeScript consumer of an RPC payload read; the auth/db core diff, the inline scripts, the diagnostics routes and both workflow diffs read. Not done: nothing was executed (no pgTAP, no Playwright, no live probing), so every statement is from reading code.

### Summary
- Critical: 0
- High: 0
- Medium: 0
- Low: 3
- Info: 4

No fold was found that gives a role, another organisation, or a deactivated/invited member data the reads it replaced did not give.

### Findings

#### [LOW] L1. `/diagnostics/approvals-timing` starts its whole read fan-out before it knows the caller is a member
- **Location:** `src/app/diagnostics/approvals-timing/route.ts:53-87` (reads start at 60-85, `notFound()` only at 87); `src/core/auth/paths.ts:19` (`/diagnostics/` is a public prefix, so the proxy does not gate it).
- **Description:** The handler starts `getSessionState`, `getOwnToday`, `readOwnPushStatus`, `getSessionBundle`, `listTasksAtBothSteps`, `listDirectory`, `listPendingDays` and, because `whenWaiting` "asks the usual way" when the counts fail (`src/core/lib/when-waiting.ts:13-16`), the four gated lists too, and only then checks `state.value.kind !== "member"`. For a signed-out request the counts fail, so every list is asked.
- **Who gains what:** Nobody gains data. The body is milliseconds only, `cache-control: private, no-store`. RLS and the function grants refuse every read for anon. An unauthenticated caller gains a request amplifier: one GET costs roughly ten PostgREST subrequests from the Worker. Any active member, Crew included, can do the same with reads that succeed.
- **Scenario:** A script loops `GET https://app.maxoff.in/diagnostics/approvals-timing` signed out; each request fans out to Supabase and eats Worker subrequests and PostgREST capacity the team's real pages share.
- **Pre-existing:** yes, the route and the ordering are on `main`; v2.0 kept it and changed which reads it starts. `/diagnostics/timing` already does this correctly (`getSessionUserId()` then `notFound()` before any read, `src/app/diagnostics/timing/route.ts:27-30`).
- **Recommendation:** Same first three lines as the timing route (`const userId = await getSessionUserId(); if (!userId) notFound();`) before the wave, or remove the route in the cleanup unit PROGRESS already promises. Consider restricting both diagnostics to the Owner.

#### [LOW] L2. Folds rely on RLS alone for "own row" where one explicit predicate would make them safe against a later policy change
- **Location:** `supabase/migrations/20261105230000_task_page.sql:71` (`last_read`: `from public.task_reads tr where tr.task_id = p_task_id limit 1`, no `member_id` filter); `supabase/migrations/20261105210000_own_week_tasks_counts.sql:77` and `supabase/migrations/20261106000000_leave_folds.sql:77` (`from public.org_settings s limit 1`, no org filter, no `order by`).
- **Description:** Correct today and equal to the reads they replace: `task_reads_select_own` (`20260930042642_task_reads.sql:37-38`) shows only the caller's rows, `org_settings_select` (`20260922103634_team_identity.sql:454-455`) only the caller's org, and the old API reads (`getTaskRead`, `getWorkingDayRule`) had the same shape. But `limit 1` with no order now hides the failure: if a later migration lets the Owner read everyone's `task_reads`, `task_page` silently returns an arbitrary member's `last_read_at` instead of failing (the old `.maybeSingle()` would have errored on two rows).
- **Who gains what:** nobody today.
- **Recommendation:** in a later expand-only migration add `and tr.member_id = (select auth.uid())` and `where s.org_id = (select c.org_id from app.current_member() c)`. `own_week`'s leave key already does this (`l.member_id = auth.uid()`).

#### [LOW] L3. `app.requests_to_decide_count()` is a security-definer copy of an RLS rule, and its first version in this release was wrong
- **Location:** `supabase/migrations/20261105210000_own_week_tasks_counts.sql:29-50` (line 47: `q.client_id is null or ...`), corrected by `supabase/migrations/20261111030554_requests_to_decide_admin_rule.sql:22-46`.
- **Description:** The function bypasses RLS and re-implements `app.task_request_visible`'s three branches. As first written, an Admin's count included other Admins' pending no-client requests, which the policy gives to the Owner alone (a count only, never rows). The later migration in the same release restores the exact decider branch; I compared it term by term with `task_request_visible` (`20261106030000_rls_helpers_plpgsql.sql:271-287`) and the `task_requests_select` policy (org check plus that helper) and it now matches, including "never the caller's own" from `countRequestsToDecide`.
- **Who gains what:** nothing, provided both migrations ship in the same deploy (they do: both are in this diff). If only the first were applied, Admin A would learn how many no-client suggestions other Admins have pending.
- **Residual risk:** drift. Any future change to `task_request_visible` must change this function; only pgTAP 135 holds them equal.
- **Recommendation:** keep the pgTAP equality test mandatory; put a comment on `app.task_request_visible` pointing at this function (the pointer currently exists only in the other direction).

#### [INFO] I1. Pre-hydration script builds a selector from an attribute value
- `src/core/ui/navigation/pre-hydration.ts:132`: `querySelectorAll('[data-hold-tap="'+key+'"]')`. `key` comes from the DOM attribute; the only writers are `calendar-screen.tsx:552,614` and `month-grid.tsx:279` with server-made ISO dates and a constant. A malformed value would throw inside the `try` and drop the tap; `querySelectorAll` is not a script sink. Not exploitable. `CSS.escape(key)` would close it for future callers.

#### [INFO] I2. No `script-src` CSP (pre-existing)
- `src/core/http/response-headers.ts:17` sets `frame-ancestors 'none'` only. The release adds one more inline head script (`src/app/layout.tsx:87-88`, `WARM_ZONE_SCRIPT`). All three inline scripts are module-level constants; the only interpolations are compile-time constants (`IST_TIMEZONE`, attribute names, two numeric limits). No request, user or database value reaches an inline script.

#### [INFO] I3. The token-read guard is development-only
- `src/core/db/token-read-scope.ts:12-13`: in production nothing is tracked. This guards ordering (a self-wait bounded by `FIRST_READS_WAIT_MS = 50`), not authorisation, so it is not a security control; noted so nobody later reads it as one.

#### [INFO] I4. `listTasksAtBothSteps` reads both approval steps before the role is known
- `src/modules/tasks/data/tasks.ts:612-628`. The id interpolated into `.or(...)` at line 615 is the verified JWT `sub` (`withSessionUserId` → `getClaims()`), not user input. An Admin's request also fetches `admin_approved` rows, but only those RLS already shows that Admin, and `approvals/page.tsx` picks one list server-side (`can(viewer.role, "tasks.approve_final") ? both.final : both.check`); the other is never rendered or serialised. The diagnostics route returns only its timing.

### Verified as correct

**SQL functions (definer/invoker, search_path, grants, re-checks)**
- `session_early`, `own_week`, `attendance_board_today`, `templates_library`, `task_page`, `own_comp_leave`, `working_day_rule`, `client_overview`, `project_page`: all `security invoker`, `stable`, `set search_path = ''`, `revoke all ... from public, anon, service_role`, `grant execute ... to authenticated`. Every table reference is schema-qualified.
- Security definer in this diff: `app.requests_to_decide_count` (see L3), `app.attendance_hours_on` (service_role only; revoked from authenticated), `app.attendance_hours` and `public.attendance_hours_today` (re-created; grants kept). `attendance_hours_today` keeps both guards (`current_member` → UNAUTHENTICATED, `attendance.view_all` → FORBIDDEN) and the same member filter; `attendance_hours_on` is the old `attendance_hours` body with settings and the working-day flag passed in, compared line by line with `20261022090443_working_hours.sql:123-181`.
- The 15 helpers in `20261106030000_rls_helpers_plpgsql.sql`: for each, the previous SQL body (whitespace and comments stripped) is contained verbatim in the new PL/pgSQL body, and arguments, return type, volatility, strictness, `security definer`, `rows`, `parallel safe` and `search_path` are unchanged (script comparison against the last prior definition in `20260921151323` … `20260930070616`). `ist_day_start` and `to_ist_date` remain non-definer.
- The `app` schema is not exposed through PostgREST (`supabase/config.toml:13`, local config; confirm the production API setting matches).

**Hard invariants**
- Money: no fold reads a money table. `client_private` holds only `owner_notes`; `client_overview` adds the `owner_notes` key only when RLS returns the row (`clients.private_notes`, Owner only), so Admin/Crew payloads have no key at all, and the page gates it again (`clients/[id]/(tabs)/page.tsx`). `project_page` builds explicit column lists identical to `PROJECT_COLUMNS`, `CYCLE_COLUMNS`, `ITEM_COLUMNS`. No fee/rate/amount column exists on any table a fold serialises with `to_jsonb(row)` (`tasks`, `client_contacts`, `field_definitions`, `client_labels`); those were already `select("*")` reads.
- Crew never see client records or progress: `client_contacts`, `client_private`, `projects`, `project_*` are behind `app.client_visible` / `app.project_visible`; a Crew caller gets `[]`/`null`. `own_week` events carry `client_id` exactly as `listEventTasks` already did (the label link, ADR-0005).
- Attendance/leave Owner-only: the board fold computes nothing unless `attendance.view_all`; `own_week.leave` is filtered by `auth.uid()` and `approved`; `own_comp_leave` calls the two existing functions unchanged and only converts their P0001 refusal code (message only, no detail) to a field.
- Cross-org and deactivated/invited: every policy the folds lean on keys on `app.current_member()` (active + permanent, own org); `requests_to_decide_count` returns 0 without it. pgTAP 143 claims per-role, second-org and deactivated/invited coverage (read, not run).

**TypeScript consumers**
- `getSessionState` uses `session_early().member` only after `getClaims()` verifies and only when the verified id equals the token's `sub`, with no error and a non-null answer; otherwise the normal read. `readBeforeCheck` has the same guards plus the 401 check and reads alone outside a render. The per-request state (`shellRead`, `firstReads`, `renderMark`) is React `cache()`, not module state; no new module-level mutable holds user data.
- Mappers (`readTaskPage`, `readProjectPage`, `readClientOverview`, `readTemplatesLibrary`, `listOwnWeek`, `readBoardToday`, `readOwnCompLeave`) carry the same fields their per-read predecessors did; none adds a field for a role.

**Caching and headers**
- No `unstable_cache`, `"use cache"`, `revalidate`, `force-cache` or new `Cache-Control` in the diff. All new `cache()` wrappers are React per-request memoisation. Both diagnostics answer `private, no-store`. No proxy/middleware or `next.config` change. No new server action or data-returning route.
- localStorage: no new application use (next-themes' existing `theme` key only).

**CI**
- `ci.yml`: a `sysctl` port reservation and a Chromium install fallback; no secrets, no untrusted input.
- `preview.yml`: two new `workflow_dispatch` inputs passed through `env:` (not interpolated into the script) and validated by anchored regexes before use.

**Expand-only**
- 14 migrations added, none modified or deleted against `origin/main`. No `drop`, `rename`, `alter table`, `truncate`, `update`, `delete`, policy or view change in them; only `create function`, `create or replace function` (same signatures), `comment`, `revoke`/`grant`. `seed.sql` adds four local test accounts (local only by project rule).

### Recommendations
1. L1 before or soon after release: move the session check to the top of `approvals-timing`, or delete the route.
2. L2 and the L3 comment as a small expand-only follow-up migration.
3. Confirm production's exposed API schemas are `public, graphql_public` only.
4. Run pgTAP 130-143 and both Playwright shards on this exact commit; this review did not run them.
