# 6b.20 (b): reliability and safety gap audit

Date: 23 Oct 2026. Base: `main` at `1b21ef6`. Findings only: nothing was changed or run against any database.

## Scope and method

ROADMAP 6b.20 (b) asks for a gap report before v1.9, with the real fixes shipped as a small release.

The owner's 111-item system-design list is **not in the repo**. The only mention is ROADMAP 6b.20 itself. So this audit follows the 6b.20 (b) points, plus the standard reliability areas.

Every claim below was checked against the code: `.github/workflows/`, `supabase/migrations/`, `src/core/`, `docs/decisions/` and `docs/runbooks/`.

Risk is rated for MaxOff's real size: one org, about 15–20 people, a Free-plan database, production live since 1 Oct.

Effort: **S** is under half a day, **M** is one to two days, **L** is more.

## Summary

MaxOff is in good shape on the basics. It has:
- encrypted nightly backups with a tested restore;
- Sentry with a PII scrubber;
- an uptime check;
- audit triggers on every business table;
- retried push and email deliveries with backoff;
- a guarded deploy path.

The gaps are mostly about **noticing when something goes wrong** and **guard rails that are written as rules but not enforced by a tool**:
- no alert when a backup or a delivery fails;
- no dependency or vulnerability checks;
- no CI check on applied migrations;
- no register of when secrets expire;
- no incident runbook.

Most of these fixes are small.

---

## 1. Backups and restore

**What MaxOff does**
- **Nightly backup.** `.github/workflows/backup.yml` runs at 02:00 IST.
- **What it backs up.** `scripts/backup/dump.sh` dumps `public`, `app`, `auth` and `supabase_migrations`. It writes a manifest of row counts, migration versions and pg_cron jobs.
- **Encryption and storage.** It encrypts with `age` to the Owner's offline key and uploads to the private R2 bucket `maxoff-backups-production`.
- **Retention.** 31 days, through the R2 lifecycle rule plus the script's own pruning. The script refuses to prune below 7 days.
- **Restore.** `scripts/backup/fetch.sh` + `restore.sh` restore and then check row counts, migrations and RLS. `scripts/backup/drill.sh` runs a local drill.
- **Runbook.** `docs/runbooks/backup-restore.md`. Its "Drills done" table records a production-bucket restore on 30 Sep 2026: 50 tables equal and RLS refuses.
- **Monthly check.** backup.yml opens a "Monthly Supabase usage check" issue on the 1st.

**Gaps**
- **Restore drill overdue.** 6b.20 (a), the timed drill on a *recent* backup with a "known recent record is there" check, was skipped (ROADMAP v1.8 note). `docs/runbooks/restore.md` does not exist. The last real restore is from the first nightly backup, before any real team data.
- **No failure alert.** backup.yml has no `if: failure()` step. A failed night is noticed only through GitHub's default email (unverified) or the monthly issue.
- **No backup right before migrations.** The production job in `deploy.yml` does: guard → build → migrations → deploy. So the newest restore point before a migration can be up to 24 h old.
- **No backup of uploaded files.** The R2 files bucket has none. ARCHITECTURE §18 mentions "R2 object versioning or retention (6.x)", but nothing implements it. The Drive archive (ADR-0010) is deferred to ROADMAP 8.3/8.4b. So uploaded originals exist in one place only.

**Risk:** high for the files bucket; medium for the database (the backup is good, but the alerting and the drill are missing).

**Recommended action**
- (S) Run the 6b.20 (a) timed drill on the latest backup. Record it in `docs/runbooks/restore.md`, or as a row in backup-restore.md.
- (S) Add a failure step to backup.yml that opens a GitHub issue.
- (S) Optional: run a backup before the production migration step.
- (M) Decide how to protect uploaded files: a nightly R2-to-R2 copy, or bring the Drive archive forward. Owner decision.

## 2. Monitoring, alerting and the health target

**What MaxOff does**
- **Health check.** `src/app/api/health/route.ts` makes one database round trip, with a 5 s timeout (`src/core/db/health.ts`).
- **Uptime.** UptimeRobot polls it every 5 minutes and emails the Owner (`docs/runbooks/go-live.md` §3).
- **After each deploy.** `scripts/smoke-deploy.sh` checks health and headers.
- **Logs.** Workers Logs are on (`observability` in `wrangler.jsonc`).
- **Speed.** `scripts/perf-probe.mjs` measures speed per release.

**Gaps**
- **No agreed health target (SLO).** The 600 ms TTFB figure is a release gate, not something production is watched against.
- **No error-spike alert.** None is written down. A Sentry alert rule may exist in the dashboard; this is unverified.
- **pg_cron failures go unseen.** `cron.job_run_details` is trimmed (`20261016032240_p2_db_memory.sql`) but never checked for failed runs.
- **One person gets alerts.** Only the Owner's email receives them.

**Risk:** medium.

**Recommended action**
- (S) Write the SLO in ARCHITECTURE §18: for example "99.5% of health checks green per month; warm pages under 1 s".
- (S) Set a Sentry alert rule for a new issue and for more than N events in an hour, then record it in the README.
- (S) Add a daily check that counts failed pg_cron runs and failed deliveries (see 12) and tells the Owner.

## 3. Error tracking

**What MaxOff does**
- **Sentry.** `@sentry/nextjs`, set up through `src/instrumentation.ts` (`onRequestError`) and `src/instrumentation-client.ts`.
- **Scrubbing.** `src/core/observability/scrub.ts` removes PII and money.
- **Error boundaries.** `global-error.tsx`, `error.tsx` and `(app)/error.tsx` report to Sentry.
- **Server actions.** `src/core/errors/action.ts` reports INTERNAL errors.
- **Source maps.** Uploaded at deploy (`scripts/worker-sourcemaps.mjs`).
- **Cron routes.** They capture their own failures.

**Gap:** alert routing only (see 2).

**Risk:** low.

**Recommended action:** none beyond the alert rule.

## 4. Rate limits

**What MaxOff does**
- **Supabase Auth.** `supabase/config.toml` `[auth.rate_limit]` sets sign-in 30 per 5 min per IP and token checks 30. Hosted projects keep Supabase's defaults (README).
- **Sign-up off.** `enable_signup = false`.
- **Password reset.** It gives the same answer whether or not the address exists (`src/core/auth/actions.ts`). Its rate-limit errors become `RATE_LIMITED`.
- **Test pushes.** Limited to one per 30 s in the database (`push_test_claim`).
- **Email.** Daily caps per person and per org (`email_claim`, `skipped_cap`).

**Gaps**
- **No Cloudflare limit.** `wrangler.jsonc` has no rate-limit rule or binding. Dashboard WAF rules are unverified.
- **The per-IP limit may apply to the wrong IP (needs a test).**
  - Sign-in and reset run as server actions on the Worker.
  - `src/core/db/server.ts` does not forward the user's IP (`cf-connecting-ip`) to Supabase.
  - So GoTrue may see Cloudflare's egress IPs. That means one person could lock out the whole team, while an attacker spread over many IPs is barely limited.
- **Leaked-password protection is off.** It needs Supabase Pro (README).
- **No captcha** on sign-in or reset.

**Risk:** medium. The realistic attacks are sign-in guessing and reset-email spam, even on an invite-only app with 12-character passwords.

**Recommended action**
- (S) Add a free Cloudflare WAF rate-limiting rule on POSTs to `/login` and `/forgot-password`, for example 10 per minute per IP. Record it in the README.
- (S) Test which IP GoTrue sees. If it is Cloudflare's, decide whether to forward the user's IP or rely on the Cloudflare rule.
- (M, optional) Add Turnstile to the forgot-password form.

## 5. Auth and session safety

**What MaxOff does** (ADR-0012)
- **Links.** One-time, verified on the server, expire after 24 h.
- **Session checks.** `src/proxy.ts` refreshes the session. `requireMember()` signs out deactivated people. Deactivation deletes their refresh tokens and sessions.
- **Tokens and passwords.** Refresh-token rotation; 1 h JWT; `secure_password_change`.
- **Cookies.** `httpOnly`, `sameSite: lax`, and `secure` on staging and production (`src/core/db/cookies.ts`).
- **Request origin.** Server actions use Next's Origin check. Background routes check Origin themselves (`src/core/http/background-route.ts`). Cron routes need `CRON_SECRET`.

**Gaps**
- **No session time limit, by owner decision** (ADR-0012 amendment). A lost phone stays signed in until the Owner deactivates the person or signs that device out.
- **`/set-password` gating.** It is not yet limited to a session opened from a link; this is planned for 10.3.

**Risk:** low.

**Recommended action:** none new. Keep 10.3. Add "sign out a lost phone" to the incident runbook (14).

## 6. Secrets rotation

**What MaxOff does**
- **Where secrets live.** GitHub Environments `staging`, `production` and `backup`. Production has a required reviewer.
- **Worker secrets.** Written from the environment at each deploy (`deploy.yml`).
- **Documentation.** `.env.example` and the README list every value and where it comes from.

**Gaps**
- **The token change is not recorded.** The Supabase access tokens expired on 22 Oct 2026 and were replaced with 1-year scoped tokens. The repo does not record this anywhere: PROGRESS, ROADMAP, README and the handoffs were searched.
- **No expiry list.** There is no list of expiry dates and no reminder for any of these: `SUPABASE_ACCESS_TOKEN`, `CLOUDFLARE_API_TOKEN`, `SENTRY_AUTH_TOKEN`, the R2 keys, the Resend key. An expired token silently breaks deploys and backups, which is what happened on 22 Oct.
- **Staging token scope.** The staging `SUPABASE_ACCESS_TOKEN` used to be account-wide (`docs/handoff/advisor-handoff-2026-10-07.md`, a guard in `preview.yml`). Check whether the new scoped tokens close this.
- **Backup password.** The `backup` environment holds a full read/write `SUPABASE_DB_PASSWORD`. This is accepted in the backup.yml header.

**Risk:** medium.

**Recommended action**
- (S) Add a "Secrets and expiry" table to the README or a runbook. For each secret: name, environment, scope, created date, expiry date, how to rotate. Values never go in it. Record the 22 Oct change, with the new expiry around 22 Oct 2027.
- (S) Add "tokens expiring in the next 60 days" to the monthly usage-check issue in backup.yml.
- (S, later) A read-only database role for the backup, if Supabase allows it on Free.

## 7. Migration safety

**What MaxOff does**
- **The rule.** Expand-only, written in CLAUDE.md and ARCHITECTURE §18.
- **The production script.** `scripts/production-migrations.sh` fails if the listing cannot be read or if production is ahead of the tag. It applies only pending files, re-checks afterwards and never runs `repair`. `scripts/staging-migrations.sh` does the same for staging.
- **Order and guard.** `deploy.yml` runs migrations before the Worker deploy, behind the "tag on green `main`" guard and the Owner's approval.

**Gaps**
- **No tool enforces the rule.** `ci.yml` has no migration step. Nothing stops a PR from editing an applied migration or adding a `drop`/`rename`. The production script compares version numbers only, not file contents, so an edited applied file goes through unnoticed.
- **Past destructive steps.** Contract steps happened before (for example `20260928131234_contract_phase3b.sql`). They were approved, but only by review.
- **No fresh backup before migrating** (see 1).

**Risk:** medium.

**Recommended action:** (S) add a CI job that:
1. fails if a PR modifies, renames or deletes a file under `supabase/migrations/` that already exists on `main`;
2. flags `drop table`, `drop column`, `rename`, `truncate` and `alter column … type` in new migrations, unless the file carries an explicit `-- contract: approved <date>` line.

## 8. Data retention

**What MaxOff does**
- **Notifications.** Read notifications older than 90 days are removed daily (`20261003084936_notifications_read_removal.sql`, scheduled in `20261006170404`).
- **Cron log.** pg_cron history is kept 7 days.
- **Storage cleanup.** `src/core/storage/cleanup.ts` removes R2 objects of archived rows after 30 days and abandoned uploads after 24 h. It always keeps the row (invariant 9).
- **Activity log.** Kept forever by design.
- **Push subscriptions.** Disabled with a reason.

**Gaps**
- **No written policy.** There is no retention table.
- **Unbounded tables.** `session_events` and disabled `push_subscriptions` rows grow without a limit. Both are small.
- **Privacy notice.** The DPDP privacy notice for staff is planned for phase 10.

**Risk:** low.

**Recommended action:** (S) add a short retention table to DATA-MODEL. No code is needed now.

## 9. Audit logging

**What MaxOff does**
- **Audit trigger.** `app.audit_row_change()` (latest in `20260929053632_freelancers.sql`) writes `activity_log` for every business table: members, tasks, clients, projects, items, leave, attendance, expenses and so on.
- **Transitions.** Transition functions write their own history (ADR-0006).
- **Tables without the trigger.** These are only logs, system state, or tables that users cannot write.

**Gap:** none material.

**Risk:** low.

**Recommended action:** none.

## 10. Idempotency (jobs and create actions)

**What MaxOff does**
- **Jobs.** The pg_cron jobs and the Worker crons are idempotent through unique keys and advisory locks. Examples:
  - `eod_reports unique (org_id, report_date)`;
  - `client_work_alerts unique (…)`;
  - `notification_deliveries unique (notification_id, channel)`.
- **One bad row.** `reminders_tick` runs each row in a savepoint, so one bad row does not undo the run.
- **Double taps.** `useAction` (`src/core/ui/action/use-action.ts`) allows one request per tap, proved by `e2e/tap-feedback.spec.ts`.
- **Duplicates.** Some creates refuse duplicates (for example leave for the same dates).

**Gap:** **no server-side idempotency key.** Say a create reaches the server, the phone loses the answer, and the person taps again. Then `task_create`, `project_create*`, `client_create`, expense claims and comments run twice.

**Risk:** medium-low. This is likely on patchy mobile data, and the result is a visible duplicate that someone must cancel by hand.

**Recommended action:** (M) add an optional `client_request_id` to the riskiest create functions (task, project, expense claim, comment):
- the form generates it once, when it opens;
- a unique index covers `(created_by, client_request_id)`;
- a repeat returns the existing row.

The change is expand-only.

## 11. Concurrent edits (optimistic locking)

**What MaxOff does**
- **Workflow changes.** Transition functions check the current state, so a second approval of the same thing is refused.
- **Advisory locks.** Leave and attendance take advisory locks.
- **Ready message.** The `CONFLICT` code already has the right message: "Someone else changed this just now. Refresh and try again." (`src/core/errors/codes.ts`).

**Gap:** **plain edits are last-write-wins.**
- Edits filter on `id` only, never on `updated_at`. For example:
  - `src/modules/clients/data/clients.ts`;
  - `src/modules/tasks/data/tasks.ts`;
  - `src/modules/team/data/members.ts`;
  - `src/modules/settings/data/settings.ts`.
- `project_update` and `task_update_assignment` take no expected version.
- Two people editing the same project or task overwrite each other silently.

**Risk:** medium-low. This is rare, but Owner and Admin edits to projects and tasks do overlap.

**Recommended action:** (M) pass the `updated_at` the form loaded with into `project_update`, `task_update_assignment` and the client and contact edits. On a mismatch, return `CONFLICT`, which shows the existing message.

## 12. Timeouts and retries on outside calls

**What MaxOff does**
- **Email.** Resend calls time out after 10 s (`src/core/notifications/email.ts`).
- **Push.** Push sends time out after 10 s (`src/core/notifications/push/send.ts`).
- **Health.** The health check times out after 5 s.
- **Delivery records.** Every delivery is a `notification_deliveries` row with `state`, `attempts`, `last_error` and `next_attempt_at` (`20260930050132_notifications_core.sql`).
- **Backoff.** 1, 5, 15, 60 minutes, then `failed` (`app.push_backoff`, `20261001003353_email_dispatch.sql`). Email retries 429, 5xx and network errors only.
- **Nothing lost.** The in-app notification always stays. This is the dead-letter record 6b.20 asks for, already in place.

**Gaps**
- **No timeout on database calls.** `src/core/db/server.ts` wraps `fetch` only for expired tokens, and no migration sets `statement_timeout`. A stuck call holds the request until the platform kills it.
- **Failed deliveries are invisible.** They are recorded but have no screen, no Sentry message and no alert.

**Risk:** medium-low.

**Recommended action**
- (S) Add a ~10 s `AbortSignal.timeout` to the Supabase client's `fetch` wrapper.
- (S) Report the count of `failed` deliveries in the last 24 h once a day: to Sentry (`captureMessage`) or in the Owner's digest.

## 13. Dependency and vulnerability checks

**What MaxOff does**
- **Locked installs.** CI installs with `--frozen-lockfile`.
- **Pinned versions.** The pnpm version is pinned, and OpenNext is pinned through a patch.

**Gaps**
- **No checks at all.** There is no `.github/dependabot.yml`, no Renovate, no `pnpm audit` in CI and no CodeQL. `.github/` holds only `workflows/`.
- **The repo is public** (ci.yml header), and the deploy jobs hold production secrets.
- **GitHub Actions are pinned to major tags** (`actions/checkout@v4`, `cloudflare/wrangler-action@v3`), not to commit SHAs.

**Risk:** medium.

**Recommended action**
- (S) Add `dependabot.yml` with weekly, grouped `npm` and `github-actions` updates and security updates on.
- (S) Add a weekly `pnpm audit --prod --audit-level high` job that opens an issue.
- (S) Pin actions by SHA, and let Dependabot bump them.

## 14. Incident runbooks and postmortems

**What MaxOff does**
- **Rollback.** One line: "fix forward, or roll back in Cloudflare → Workers & Pages → maxoff → Deployments" (`docs/runbooks/go-live.md`, README).
- **Same-day rule.** CLAUDE.md says a bad release is fixed the same day.

**Gaps**
- **No incident runbook and no postmortem template.** `docs/runbooks/` has only `backup-restore.md` and `go-live.md`.
- **No playbooks** for "Supabase down", "health 503", "Sentry spike", "token expired" or "lost phone".
- **The safe rollback is not explained.** Rolling back the Worker is safe because migrations are expand-only, but that is not written down.

**Risk:** medium-low.

**Recommended action**
- (S) Write `docs/runbooks/incident.md`: symptom → first check → fix → who to tell, the Worker rollback steps, and the lost-phone steps.
- (S) Write `docs/runbooks/postmortem-template.md`: what happened, impact, timeline, cause, fix, follow-ups.

## 15. Feature flags (optional)

**What MaxOff does:** nothing for users. `app.local_flags` is a local test flag only.

**Gap:** there is no way to switch a feature on for the Owner first.

**Risk:** low.

**Recommended action:** (M, optional) a `feature_flags` table read in the session bundle, following the "customization is data" rule. Only if the owner wants Owner-first rollouts.

## Other checks

- **Security headers.**
  - What is in place: HSTS (2 years), `X-Frame-Options: DENY`, nosniff, Referrer-Policy and Permissions-Policy (`src/core/http/response-headers.ts`, checked by `smoke-deploy.sh`).
  - The gap: the CSP covers only `frame-ancestors`, with no `script-src`.
  - Risk: low-medium.
  - Action: (M) a report-only CSP first. Next's inline scripts need nonces.
- **Service-role key.**
  - What is in place: `src/core/db/service.ts` is `server-only`. It is used by notifications, storage, health and `src/modules/team/data/members.ts` (invites, which fits ADR-0012).
  - The gap: no lint rule limits who may import it.
  - Risk: low.
  - Action: (S) a `no-restricted-imports` allow-list.
- **CI permissions.**
  - What is in place: every workflow defaults to `contents: read`.
  - Nothing to do. This is good.

---

## Ranked top-10 to-do list

Ranked by risk removed per hour of work. Items 1–8 are small and fit the "small release" 6b.20 (b) asks for. Items 9–10 are medium.

| # | Action | Area | Risk | Effort |
|---|---|---|---|---|
| 1 | Run the overdue timed restore drill on the latest backup and write `docs/runbooks/restore.md` | 1 | high | S |
| 2 | Decide how to protect uploaded files (R2 copy or Drive archive sooner). Owner decision | 1 | high | M |
| 3 | Secrets and expiry register; record the 22 Oct token change; expiry reminder in the monthly issue | 6 | medium | S |
| 4 | Dependabot (npm + actions), a weekly `pnpm audit`, actions pinned by SHA | 13 | medium | S |
| 5 | CI guard: applied migrations never edited; destructive SQL needs an explicit marker | 7 | medium | S |
| 6 | Alerts: backup failure → issue; Sentry error-spike rule; daily failed-delivery and failed-cron count | 1, 2, 12 | medium | S |
| 7 | Cloudflare rate-limit rule on `/login` and `/forgot-password`; test which IP Supabase Auth sees | 4 | medium | S |
| 8 | Incident runbook + postmortem template + a written SLO | 2, 14 | medium-low | S |
| 9 | "Changed by someone else" check on project, task and client edits (`updated_at`) | 11 | medium-low | M |
| 10 | Idempotency key on task, project, expense and comment creates; ~10 s timeout on database calls | 10, 12 | medium-low | M |

**Not needed** (owner-accepted in 6b.20): Kubernetes, load balancing, sharding, multi-region, message queues, sagas, gRPC, Terraform.

**Owner questions this report raises:**
- protecting the files bucket (item 2);
- whether to add Turnstile;
- whether feature flags are wanted.
