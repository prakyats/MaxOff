# MaxOff: advisor handoff (as of 7 October 2026)

> **To the new session:** you are taking over as Prishit's **architect and advisor** for MaxOff. Read this whole file first, then `CLAUDE.md`, `docs/PROGRESS.md` and `docs/ROADMAP.md` in the repo (`prakyats/MaxOff`). Don't start building anything. Your job is described in section 1.

---

## 1. Your role and how to work

**Who you advise.** Prishit Shetty is the Owner of Pixora Clips, a video studio. MaxOff is his internal operations app, and he is not a full-time developer.
- GitHub user: `prakyats`.
- Business email: pixoraclips@gmail.com.
- Live-app Owner login: shettyprishit@gmail.com.
- Staging Crew test login: prakyatshetty15@gmail.com.

**What you do.**
- **He runs separate Claude Code "builder" sessions,** in the cloud and on his laptop, for kickoffs, phase builds and fixes. He pastes their reports to you.
- **You review those reports** against the rules, the decisions and GitHub's actual state. Check the branch, the commits and the CI logs yourself; don't trust a report blindly.
- **You recommend, and you write the exact message** he should paste back to the builder, in a fenced code block headed **"Send this"**.
- **You answer his business questions** with one clear recommendation and the trade-off. Don't survey every option.
- **When a builder asks him business questions,** give "yes to all" or the changes, with your reasoning, plus a paste-ready reply.

**Style he likes.**
- Plain words, short sections, tables where they help.
- Give a verdict first ("Pick option 1", "Merge it now", "Don't ship yet").
- Explain what the change means for the crew in practice.
- He often sends screenshots of builder questions; answer the one on screen.

**What you must never do** (also in section 5):
- **Merge to `main`, push `v*` tags or approve production deploys.** The safety layer blocks this, and they are his clicks. Don't try to work around it.
- **Use branch-protection bypass** (`--admin`, "Bypass rules").
- **Handle secrets:** never ask for them, paste them or put them in code. He sets them in web UIs, and you only give names and where to find them.
- **Use connected third-party connector services or their credits** (the AI audio/video/image connector, Canva and so on). Use only Claude and local tools.
- **Accept a fix that makes a test pass** by retrying, raising a timeout, skipping it or loosening an assertion.

---

## 2. The business and the product

- **What MaxOff is:** an internal, invite-only operations app for Pixora Clips. **Clients never log in.** The business timezone is **IST**.
- **Roles:** exactly **Owner (one) / Admin / Staff**.
  - The Staff role is **shown in the app as "Crew"**. That is a label only, read from `ROLE_LABELS` in `src/core/lib/role-labels.ts`. The database value, permission keys and docs stay `staff`.
  - When he writes for the team he sometimes asks for "Staff"; follow his request.
- **Modules:**
  - attendance (Start day / End day), leave, comp leave, extra work, expense claims;
  - Staff tasks, with acknowledgement ("Task Noted") and approvals;
  - clients, and later client projects;
  - notifications;
  - later: dashboards and calendar, work submissions, Owner-only revenue and reports.
- **Live:** https://app.maxoff.in has been in **daily use by the whole team since 1 October 2026**. The crew were onboarded in person.
- **Public website:** https://maxoff.in, in a separate repo, `prakyats/MaxOff-Website` (Astro + Tailwind, a Cloudflare Worker named `maxoff-website`).
  - MaxOff is the brand; the site credits "developed by Pixora Agencies" and must not name "Pixora Clips".
  - Contact is `hello@maxoff.in`, routed to pixoraclips@gmail.com by Cloudflare Email Routing.
  - The Sign in button goes to app.maxoff.in. `www` redirects to the apex domain.
- **"Anna"** (a senior person at the business, whom Prishit relays) asks for features directly. One request is open (section 9).

### Business invariants (from CLAUDE.md; never break them)
1. Roles are exactly Owner/Admin/Staff. Job titles are data, not permissions.
2. **Money is Owner-only**, in Owner-only tables, reached only through `modules/revenue`. It never appears in Admin or Staff payloads, Realtime, search or exports. The one exception is a member's own expense claims.
3. Revenue counts only for Owner-approved project items. Staff tasks carry no revenue.
4. Client work and Staff tasks are separate. The only link is a task's optional client label. Staff never see client records.
5. Approval route: Done, then the approving Admin (if any and not an assignee), then the **Owner**. Final completion is always the Owner's.
6. Every assignee acknowledges ("Task Noted"); only the primary owner marks Done.
7. Attendance and leave are decided **only by the Owner**. History is never overwritten.
8. IST everywhere, through `app.today_ist()` / `core/time`.
9. Never destroy history: archive, cancel with a reason, add history rows. Permanent delete is Owner-only.
10. Don't invent business rules. Ask.

---

## 3. Stack and infrastructure

**Stack**
- Next.js 16 (App Router), React 19, TypeScript strict, Tailwind v4.
- Supabase: Postgres, RLS on every table, pgTAP tests, pg_cron, Realtime. Free plan (ADR-0003).
- Cloudflare Workers through OpenNext, plus R2 storage.
- Resend for email, Sentry, Web Push with VAPID.
- GitHub Actions; Playwright in 2 shards; Vitest; pnpm.

**Environments**
- **Production:** Worker `maxoff`, at https://app.maxoff.in. The old address `maxoff.pixoraclips.workers.dev` redirects to it with a 308. Deployed **only** from a `v*` tag on a green `main` commit, approved by the required reviewer `prakyats` in the `production` environment.
- **Staging:** Worker `maxoff-staging`, at `https://maxoff-staging.pixoraclips.workers.dev`. It deploys from `main` after green CI. Its Supabase project ref is `jcejebyjaqwcumyzrhge`.
- **Branch previews:** `https://<branch>-maxoff-staging.pixoraclips.workers.dev`. These are versions of the staging Worker and share the **staging database**.
  - **Cron triggers run only on real deploys, not previews.** The Worker crons are `push_dispatch` every minute (it also sends email) and `storage_cleanup`.
  - So on a preview, scheduled pushes and emails are still sent by staging's deployed code. Test those on staging after merging.
- **Shared staging database:** `scripts/staging-migrations.sh` applies missing migrations even when staging holds another branch's versions.
- **Production migrations:** `scripts/production-migrations.sh` applies only the missing migrations in date order and fails if production is ahead. It never repairs or reverts.
- **Smoke test:** `bash scripts/smoke-deploy.sh https://app.maxoff.in https://maxoff.pixoraclips.workers.dev`. Run it after every release.
- **Health:** `/api/health`. UptimeRobot watches it.
- **Backups:** a nightly Backup workflow writes to R2 `maxoff-backups-production`. The restore drill is in `docs/runbooks/backup-restore.md`, due quarterly.
- **pg_cron runs in UTC.**
  - `reminders_tick` every 5 minutes; it also sends the end-day reminder at 20:30 IST.
  - `digest_daily` at 02:30 UTC (08:00 IST).
  - `reachability_check` at minute 17 UTC, which is **:47 IST**.
  - `notifications_remove_read` at 22:00 UTC (03:30 IST).
  - The absence check and "end not recorded" run around midnight IST.

**CI**
- Required checks: "typecheck · lint · format · unit · build", "pgTAP" and "playwright".
- Docs-only pushes skip the heavy jobs.
- **The e2e job pauses across midnight IST** (about 18:05–18:40 UTC), so evening runs take longer.
- First-load JS budget: `/today` and `/my-day` are capped at **792 KB** (raised from 790 on 2026-10-03 for bundler regrouping only).
  - **Phase 6 starts with task 6.0, a "first-load diet"**, to cut that and lower the budget.
  - Any new code on those routes' first load must be lazy-loaded.
- Tests and helpers worth knowing:
  - the hold proxy (`e2e/hold-proxy.ts`) for proving loading skeletons;
  - a reload guard that fails on unexpected page reloads;
  - a role-label sweep test that fails on user-visible "Staff";
  - `actionId()` in `e2e/helpers.ts`, which picks out a server action by its id from the build manifest.

**Releases so far**
| Tag | Commit | What |
|---|---|---|
| v1.0.0 | dbf8242 | Phase 3c, the first production deploy |
| v1.1.0 | 57f4346 | Tap feedback, pull-to-refresh, speed |
| v1.2.0 | dd087cc | Phase 4 (tasks) and the "Crew" label |
| v1.2.1 | 4e5a25e | Branded invite email hotfix; **crew onboarded 1 Oct, 12:30 IST** |
| v1.3.0 | e1792be | 5A: push, email, the bell (1 Oct evening) |
| **v1.4.0** | **2138c88** | **All of phase 5**, live 7 Oct about 00:15 IST (also tagged `phase-5-done`) |

**Release procedure** (he does the clicks; you check and guide):
1. Everything merged to `main`.
2. `main` CI green, and staging deployed. You check both.
3. He tests on staging.
4. He tags from his terminal, one line at a time: `git fetch origin`, `git tag -a v1.x.y <sha> -m "..."`, `git push origin v1.x.y`.
5. He approves the Deploy run: Actions → Review deployments → production.
6. You confirm the deploy log (migrations applied in order) and run the smoke test.

**Timing:** don't approve at **:42–:52 IST** (the reachability job), or between about 23:55 and 00:15 IST (the midnight jobs).

---

## 4. How building works

- **Commands in the repo** (`.claude/commands`):
  - `/kickoff-phase N` settles every business question, docs only, into a "Kickoff N decisions" block in PROGRESS, a draft PR and ADR amendments;
  - `/run-phase N` builds unit by unit with subagents and stops only on a real decision;
  - `/review-phase N` runs the architecture and security reviews, fixes, then the PR;
  - also `/start-task`, `/add-feature`, `/save-progress`, `/finish-task`.
- **One writer per branch.** Kickoffs are docs-only and can run in parallel. **Don't run two code branches with migrations at once**: they share the staging database.
- **Model and effort:** builders use **Opus 5.5 at High**. Extra effort burns his 5-hour and weekly Claude limits.
  - Keep **one build session at a time**, and suggest `/clear` or new sessions between units.
  - His weekly usage resets on Thursdays around 07:30 IST.
- **Engineering rules worth enforcing** (CLAUDE.md has the full list):
  - modules are isolated (`app → modules (index.ts) → core`);
  - only `data/` layers touch the database;
  - workflow changes go through Postgres transition functions (ADR-0006);
  - RLS plus pgTAP for every role on every table;
  - **append-only, expand-only migrations**;
  - every data-loading route has a `loading.tsx` that traces the screen;
  - mobile is a first-class layout at 375px and 430px;
  - the phone behaves like a native app (back closes the top layer, view controls never add history);
  - one solid red commit action per layer.
- **Definition of Done:** `pnpm check` passes; tests cover the change; docs (PROGRESS, ROADMAP, DATA-MODEL, WORKFLOWS, PERMISSIONS, ADRs) are updated.
- **A builder stops and asks on:**
  - a business question its kickoff didn't settle;
  - tests red after two fix attempts;
  - a new or contradicted ADR;
  - money, permissions or RLS beyond its plan;
  - anything touching production;
  - an unexplained failure.
- **Phone walk:** once per phase, in the review, by Prishit on his phone.
- **The app guide** is one living file: `docs/guide/MaxOff-App-Guide.html` and `first-day.html`, built to PDF with `docs/guide/build-pdf.ps1` (Edge headless). Update it and never make a new one. It still needs **updating for v1.4.0**.

---

## 5. Hard rules (production is live)

- **Expand-only migrations.** Never a seed, reset, repair or hand-written SQL on production. Nothing is deleted.
- Backfills run only through a reviewed migration in an approved release, with the Owner's explicit OK.
- **Nothing reaches production except an Owner-approved `v*` tag on green `main`.** Fix a bad release the same day.
- **Secrets:** never in code or chat; he sets them. The age backup key must stay offline. Never read it.
- **No connector services or credits** (his explicit instruction).
- **No dates in the plan docs.** Talk about the next step in the order.
- **Tests:** never pass a test by retrying, raising a timeout, skipping or weakening it. A failure is explained before anything ships, by reproducing it or reading the CI trace.
  - You can download CI artifacts yourself with `gh run download <id> -n blob-report-1` and read traces. Cloud builders often can't, because a network policy blocks the artifact host.
- **Cloud builder limits:** they usually can't delete branches or use `gh` (they use the GitHub connector instead). Local Docker dies often in their container.

---

## 6. What's built (phases 0–5, all live in v1.4.0)

- **Foundation, auth, invites, people, Settings.**
- **Attendance:** Start day and End day are two explicit taps. End day is final, with a real time recorded.
  - The 20:30 IST "you haven't ended your day" reminder.
  - "End of day not recorded" flagged at midnight.
  - A late End day is allowed until 05:00 IST.
  - The Owner reviews and corrects days, with history.
- **Leave, comp leave, extra-work notes, expense claims, month summary.**
- **Clients:** Owner creates them; Admins edit their assigned ones; lifecycle Draft, Active, Paused, Inactive.
- **Phase 4 tasks:** create and assign, Task Noted, stages, Done, then Admin and Owner approvals; lists; requests; templates; freelancers with coordinators.
- **Phase 5 notifications:**
  - **5A:** `app.notify()`, the bell, push (VAPID), email through Resend.
    - Caps: 20 per person and 90 per organisation per day, with **the last 10 reserved for escalations**.
    - Quiet hours 22:00–07:00 IST, with a 07:00 summary.
  - **5B:**
    - **Crew bottom bar:** My Day · Tasks · Calendar · Leave · Me, with Alerts as the bell.
    - **Leave page:** two tabs, Leave requests | Attendance.
    - **Me → Extra work & expenses:** two tabs.
    - **Me → Help & troubleshooting:** a test push, reload, the app version.
    - **The quiet-hours editor**, in Settings → Thresholds.
    - **Push pictures per kind:** tasks, approvals, leave, reminders, other.
    - **Email policy:** "task assigned" is emailed only to people with no working push.
    - **Always emailed:** invites, the last before-due reminder, overdue, escalations, the 08:00 digest, the unreachable alert, the event "tomorrow" reminder.
    - **Alerts list:** grouped by day, with an Unread filter and combined rows.
  - **5.3 reminders:**
    - Default 2 days before, 1 day before and when due; overdue at +1 h.
    - "Not noted" repeats every 2 h; escalations to the approving Admin (or creator) at 4 h, the Owner at 8 h, and both at 24 h overdue.
    - A four-level editor: task, template, task type, organisation.
    - Leave, comp leave and holidays **hold** reminders until the next working day. Weekly offs pause nothing. Escalations never pause.
    - **Escalations go late if their condition still holds; stale reminders are skipped.**
    - One combined email per person per run.
  - **The Owner digest:** email only, at 08:00 IST. It has no money and never appears in the bell.
  - **5.4 reachability:** five states, the 48 h alert to the Owner (at most weekly per person), Settings → Notifications, and the app reporting whether it's installed when it opens.
  - **5.5 onboarding:**
    - The band stays until a push actually arrived.
    - New joiners get a walkthrough; existing members never see it.
    - Me → Your devices, with a sticky Remove.
  - **Switched on at release:** the reminders backfill for open tasks, and the daily 90-day removal of read alerts. Unread alerts are never removed.
- **Notable fixes:**
  - **View switch during a refresh** reloaded the page. Fixed with `replaceViewAddress()` in `src/core/ui/navigation/view-address.ts`, which reads Next's private `__NA` marker; a test turns red if Next changes it.
  - **One rare case remains:** switching view, then closing a sheet with back during a refresh, can still reload. It is logged and accepted.
  - **A hung background server action blocked navigation.** Background calls now use plain fetch to route handlers.

---

## 7. Current state (7 October 2026)

- Production is on **v1.4.0** and healthy. The crew were sent the "What's new in v1.4" guide (a PDF using Owner/Admin/Staff) and a short message.
- **`main` = 2138c88** (green). No feature branch is being built.
- **Open draft PRs (kickoffs):**
  - #32 (phase 6);
  - #36 (phase 8);
  - #38 (phase 7, with amendments);
  - #42 (phase 9).

  They merge **one at a time, just before their phase starts**, and each needs its conflicts with `main` and earlier kickoffs resolved then.
- **Launch order:** 3b → 3c → 4 → 5 (done) → **6 (next)** → 8 → 7 → 9 → 10. No dates.

---

## 8. Decisions on record (beyond what the repo docs say)

**Kickoff 7 amendments (PR #38, owner 2026-10-02)**
- **A. Delivery date:** `projects.delivery_date`, required on one-time projects (7.1/7.2). The Owner or the client's Admin sets or moves it, audited.
- **B. Admins can create clients** (`clients.create`). An Admin-created client is **created Active and assigned to that Admin**, so they can onboard a client end to end while the Owner is away. The Owner is notified. Pause, close, reactivate and reassigning stay the Owner's. The Owner's own route still creates a Draft.
- The "project created by an Admin" notification says "set the amount and billing category". It never carries an amount.
- Admins already create and edit projects for their clients, with no money shown. The Owner adds amounts later.

**Kickoff 9 (money; PR #42, owner 2026-10-02):** 1–20 as recommended, except the following.
- **One-time projects are one lump sum earned on completion:**
  - items carry no value;
  - Potential sits in the delivery-deadline month;
  - an overdue project moves to the current month, marked "Was due 15 Nov";
  - it is **Achieved only when the Owner completes the project** ("Approve and complete project" prompt; a "Ready to complete" list), in the completion month;
  - a cancelled project goes to its cancellation month.
- **Retainers** keep the origin-cycle rule. ADR-0007 was amended.
- **21.** Amounts are entered before GST; there is no tax maths.
- **22.** There is no profit figure.
- **23.** **Advances** on one-time projects are recorded as "Advance received", a separate line beside Achieved, never counted as Achieved.
  - Advance plus balance count as Achieved at completion.
  - An advance can be marked "Returned".
  - The table `project_advances` is Owner-only.
- `formatRupees` moves to core.

**Phase 5 extras:** the 90-day retention (he chose 90 over 30 or 60), and the backfill clocks start at release.

---

## 9. Open items and next steps

**Next: phase 6 (dashboards and the calendar)**
1. **A new cloud session, docs only:**
   > Check out kickoff-6 (PR #32), merge origin/main and resolve conflicts keeping both sides; make sure ROADMAP phase 6 starts with 6.0 (the first-load diet for /today and /my-day); list any kickoff 6 decision that contradicts what phase 5 shipped and stop; push, mark #32 ready, don't merge.
2. **He merges #32.**
3. **`/run-phase 6`** in a fresh session.
4. **The review, the phone walk, then the release v1.5.0.**

**Anna's request: open, waiting on his answers.** She wants to see when Staff leave, and to approve or reject End day.
- **Today:** End day needs no permission. The Owner can see start and end times, but gets no alert.
- **Recommended:** **A + B**.
  - A: a push to the Owner when someone ends the day, with early exits marked.
  - B: "Ask to leave early" before a set closing time, which the Owner approves or rejects. Ending at or after the normal time stays one tap.
  - **Not C** (approval for every End day).
- **The three questions to settle:**
  1. a fixed closing time versus minimum hours (recommended: a fixed time in Settings);
  2. what happens if the Owner doesn't answer (recommended: the person may end after about 15 minutes, marked "Left early, not answered");
  3. when to build it (recommended: a small separate feature, `/add-feature`, after the current phase).
- **Be honest with them:** the app records an early exit; it can't physically stop one.

**Housekeeping (his or yours)**
- **Six stale branches** on GitHub: `wip/5b-digest-backup`, `wip/5a-reload-backup`, `wip/5a-fixes-backup`, `fix/no-surprise-reloads`, `fix/view-switch-reload`, `fix/client-field-shortcut`. Several more old merged branches exist too. Delete only on his word, keeping a backup tag for each.
- **A staging-only Supabase identity.** The staging environment's `SUPABASE_ACCESS_TOKEN` is account-wide, so a workflow change on any branch could reach production. A guard exists in `preview.yml`, but the real fix is a separate Supabase login that is a member of staging only.
- **Issue #39:** the monthly Supabase usage checklist (egress under ~4 GB, database under ~400 MB, backups green, UptimeRobot, PITR). It's routine; close it once ticked.
- **The app guide and first-day page** need updating for v1.4.0, with the PDFs rebuilt.
- **Laptop items:**
  - Cloudflare Web Analytics for maxoff.in;
  - delete the drill's read-only R2 token;
  - move the age key offline (it is currently in Downloads);
  - check the Stream subscription;
  - delete the old Resend key `maxoff-app`.
- **Recorded later items:**
  - the rare back-during-refresh reload; revisit if the crew report it;
  - **the intro video**, at the very end: landscape 1920×1080, about 25–30 s, built with local tools only (headless Chrome + ffmpeg), with his own voice or local text-to-speech, never connector credits;
  - kickoffs for phase 10;
  - deferred tasks 8.3, 8.4b, 9.5, 9.6 and 10.1;
  - speed measurements, which need `MEASURE_PASSWORD` set in his terminal.
- **Repo privacy (decided: stay public for now).**
  - Going private on GitHub Free loses branch protection, the production approval gate (required reviewers need Enterprise for private repos), secret scanning, free CodeRabbit, and unlimited Actions minutes (2,000 a month instead).
  - If he wants it private later: buy GitHub Pro, design a replacement approval gate, then switch.

---

## 10. Lessons and gotchas

- **Verify on GitHub yourself**, with `gh run list`, `gh pr checks` and `gh run view --log-failed`.
  - On his Windows laptop, prefix `export PATH="$PATH:/c/Program Files/GitHub CLI"` in Git Bash.
  - For `git show origin/main:path`, use `MSYS2_ARG_CONV_EXCL="*"`.
- **A "red" CI is often not the app.** Past causes:
  - a cancelled run superseded by a newer push;
  - the midnight IST window;
  - time-of-day test fixtures (a sweep fixed tests 24, 28, 40, 55 and 61);
  - test-cleanup races;
  - generic action traps catching background calls.

  Each was root-caused, never re-run.
- **Previews share staging's database and crons.** Test notification delivery on staging after a merge.
- **When releasing, say exactly what's in it.** He asks for summaries for the team, so write them for Owner, Admin and Staff (he may ask for a PDF).
- **This conversation grew very long.** Suggest a fresh advisor session at phase boundaries; the repo docs hold the state.
