# P2 resume pack (handoff 16 Oct ~02:30 IST)

Saved by the P2 orchestrator when the owner paused P2 (ADVISOR on #89, 16 Oct 00:00 IST). The container is ephemeral and only `phase-6b-r2` may be pushed, so unfinished builder work lives here as files. Delete this folder when P2 is done.

- `p2-instant-skeleton-wip.patch`: item 1's wip (commit ee1d3a9 of the local branch `p2-skeleton-warm`, diffed against its parent 50af9bc, which is merged). Apply with `git apply docs/handoff/p2-instant-skeleton-wip.patch` on `phase-6b-r2`; it includes ADR-0014, ARCHITECTURE §14, sw.js v9, deploymentId, the shell viewer, the warm-up mount, `e2e/instant-skeleton.spec.ts` (red).
- `p2-tap-measure.spec.ts.txt`: the builder's tap → skeleton measuring spec (rename to `.spec.ts` under `e2e/` to run it; never commit it there); `measure-before.txt` / `measure.txt`: its raw numbers.

## P2 builder: common rules (read fully before starting)

You build ONE part of MaxOff v1.7.1 unit **P2 "make the app fast for free"** (owner 15 Oct: "I don't want to spend money, isn't there any other way of making the app faster?"). Pre-authorised by the owner; work autonomously; do not ask questions — decide, and record any decision in your final report. Nothing may cost money (no paid plan, no paid Cloudflare/Supabase feature).

## Context you must read first
- `/home/user/MaxOff/CLAUDE.md` (invariants, engineering rules, Definition of Done). Production is live; nothing you do touches production.
- `docs/ARCHITECTURE.md` §14 (PWA, §14.1 mobile standard, §14.2 native navigation model) and §19 "Performance rules", especially the bullet "Measuring the Worker (unit P)". Unit P's findings: the slowness is the **Worker cold start** (1.5–4.5 s TTFB on a fresh isolate; Next's own server start, not Sentry) plus **~3 sequential Supabase round trips** per signed-in screen (member row → wave of counts/unread/push/page reads → a page's second wave). The production DB is a Free-plan t4g.nano in Mumbai that swaps.
- Only the sections of PRODUCT / WORKFLOWS / DATA-MODEL / PERMISSIONS your part needs.

## Where you work
- Your worktree is on a branch cut from `phase-6b-r2`. Commit there (small, well-described commits; end each message with
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` and `Claude-Session: https://claude.ai/code/session_01KMHBMU6Q9NVwtMRQRq5XE3`). **Do NOT push anything, ever**; the orchestrator merges your branch into `phase-6b-r2`.
- Never touch `src/modules/guide` (a parallel session owns it). Never touch `deploy.yml`, `v*` tags, production secrets.
- Setup in the worktree: `pnpm install --frozen-lockfile`; create `.env.local` from the local stack WITHOUT printing keys to your output (e.g. `pnpm supabase status -o env` piped into a small node/sed script that writes the variables named in `.env.example`: NEXT_PUBLIC_SUPABASE_URL=API_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=PUBLISHABLE_KEY (or ANON_KEY), SUPABASE_SECRET_KEY=SECRET_KEY (or SERVICE_ROLE_KEY), NEXT_PUBLIC_APP_URL=http://localhost:3000, NEXT_PUBLIC_APP_ENV=development, plus the other keys CI's e2e job sets — read `.github/workflows/ci.yml` for exactly how CI builds its env and copy that). If `/home/user/MaxOff/.env.local` exists, just copy it.
- The local Supabase stack is ALREADY RUNNING (Docker, shared by two builders; project id `maxoff`, CI's service set). **Every command that touches the database or runs Playwright goes through `flock /tmp/maxoff-db.lock <cmd>`** (db:reset, db:test, test:e2e, scripts that hit the DB). Never `supabase stop`. If Docker died: `setsid nohup dockerd >/tmp/dockerd.log 2>&1 &` then `pnpm supabase start -x storage-api,imgproxy,postgres-meta,studio,edge-runtime,logflare,vector,supavisor` (and `pnpm storage:start` if the e2e needs it; check ci.yml).
- Note the other builder may have applied its own migration to the shared local DB; run `flock /tmp/maxoff-db.lock pnpm db:reset` before your pgTAP / e2e runs so the DB matches YOUR branch.
- Playwright: Chromium is preinstalled (PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers); never `playwright install`. Use a distinct port if the config allows (check `playwright.config.ts`), since the other builder may run e2e too — the flock serialises it anyway.
- Model rule: if you start any subagent, it must use model `opus`.

## Quality bar
- `pnpm check` must pass on your branch before your last commit (typecheck, lint, format, unit, pgTAP, build, budget). Run the Playwright specs your change affects (navigation, back gestures / installed mode at 375 and 430, offline, loading screens, plus any you add).
- Fix red at the root. NEVER a retry, raised timeout, skip, `test.fixme`, or weaker assertion. If a test is red after two real fix attempts, stop and report it precisely.
- Migrations: new file via `pnpm db:new <name>`, expand-only, never edit an applied migration (every migration already in `supabase/migrations` is applied on staging). Update DATA-MODEL.md for any schema/function change. RLS + pgTAP for each role (allowed and denied) for anything new.
- No `console.log`, no commented-out code, no TODO not listed in PROGRESS "Ideas / tech debt".
- Docs: update ARCHITECTURE (the §19 / §14 bullets your part changes) and add a short dated line to ROADMAP 6b.19 for your part. Do NOT edit PROGRESS.md or RELEASE-NOTES.md (the orchestrator does those, to avoid merge conflicts); instead put in your final report: (a) what the team will notice, in plain words, (b) anything the in-app guide must mention.

## Final report (your last message, <= 40 lines)
Branch name and final commit; what was built (files); decisions made and why; measurements before/after (numbers); `pnpm check` result; which Playwright specs ran and their result; anything not done and why; the "team will notice" line; guide notes.

## Remaining briefs (one builder each, at most two at a time, model opus, own worktree)

### Item 1 finish: instant skeleton (apply the wip patch first)
State: the service worker (v9) keeps the router's prefetch of a destination's loading skeleton (only proven data-free ones: `/approvals`, `/tasks`, `/calendar`, `/clients`, `/people`, `/settings`, `/me`, `/notifications`, task pages newest 60), tied to the build (Next `deploymentId`) and the viewer's role; `usePrefetchTabs` runs on shell mount and again when Next drops prefetches. Measured (installed 375 px, server held 3 s): bottom-bar tab ~3.2 s → 245 ms; More → Clients ~3.2 s → 288–344 ms; reload unchanged by design. Navigation preload and a document skeleton page were dropped (reasons in ADR-0014). Today, My Day, Reports, client/person pages and `/leave` are not cached (their skeleton or layout carries a name, a date or a record).
To do: (1) make `e2e/instant-skeleton.spec.ts` green at the root: the data-free sweep must cover only the cached routes; decide what the `/leave` control should inspect; the More-sheet tap must meet 300 ms (show the skeleton before the sheet's back-step close finishes, don't relax the limit); fix "Response has been disposed" in `capturePrefetches` (read bodies only of fulfilled responses). (2) Run the launch, back-gesture, offline/pwa, loading-screens, production and navigation specs at 375 and 430. (3) ARCHITECTURE §19 ("Prefetch the tabs" + a new "Warm the Worker early" bullet), ROADMAP 6b.19 line. (4) Optionally the warm request in `scripts/perf-probe.mjs`. (5) Re-measure on a freshly reset DB with one tap timing.

### Item 5: ease the DB's memory (migration only)
A daily pg_cron job keeping `cron.job_run_details` to 7 days (pg_cron's own system log, not business data; batched deletes; pgTAP). Review every `cron.schedule` (latest definition per job; 5-minute jobs: `client_work_alerts`, `eod_report`, `digest_weekly`, `reminders_tick`, `end_day_reminder`) against WORKFLOWS timing; lower frequency or add an early exit only where the documented timing provably allows (never delay push, reminders, attendance rules); table of before → after → why. Realtime publication tables not subscribed by any client (`grep channel( / postgres_changes`) removed reversibly by migration; `pg_graphql` and any other dashboard-only toggle go to an "ADVISOR NEEDED: exact free toggle" list, never a guess. Report-only for other memory findings; `activity_log` is never trimmed.

### Items 4 + 6: lighter server start, prefetch likely next screens
4: route-level code splitting so a cold isolate loads less: lazy-load heavy client-work/editor/drag/preview code and keep it off other routes; inspect `pnpm build:worker` + `wrangler deploy --dry-run --outdir` (`handler.mjs.meta.json`: zod ×5, two Next runtimes, a 6 MB middleware bundle) and remove duplication where a config/alias change is safe; budgets in `bundle-budget.json` never raised. Measure with the probe's Cold column on the preview.
6: prefetch likely next screens (Today → Tasks/Approvals, a client → its current project) with Next's prefetch, never showing data older than the freshness rule (6b.17a, staleTimes dynamic 30 s; a full-data prefetch is cached for `static`, so prefer loading-boundary prefetch or intent prefetch on pointerdown).
