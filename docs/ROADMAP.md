# MaxOff Roadmap (v2)

> **One task = one Claude Code session.** Tick a task (`[x]`) only when the Definition of Done (CLAUDE.md) is met and it's committed.
> Each phase ends with `/review-phase N` (review → fixes → merge to `main` → tag `phase-N`).
> **Model tier** per task (mapped to actual models in BUILD-GUIDE.md):
> **[H]** highest-capability model: schema, security, transition functions, jobs, reviews · **[C]** strong coding model: features and UI · **[Q]** fast model: polish and docs.
>
> ★ **Pilot at the end of phase 6:** the team starts using MaxOff for attendance, leave and staff tasks, with notifications, dashboards and backups in place. Client work, files, revenue and reports follow.

---

## Phase 0: Foundation
Exit: an empty app on staging, CI green, all quality gates working, installable as a PWA.
- [x] **0.1** [C] Repo tooling: Next.js scaffold (keeping `docs/`, `.claude/`, `CLAUDE.md`), pnpm, strict TS, ESLint + Prettier, aliases, folder skeleton (ARCHITECTURE §3), `pnpm check`, `.env.example`, README, `.gitattributes`
- [x] **0.2** [H] Local Supabase (CLI + Docker), base migration (extensions incl. `pg_cron`/`pg_net`, `app` schema, `updated_at` trigger, `app.today_ist()` / `to_ist_date()`), type generation, `core/db`, `core/errors` (AppError, Result, `action()`, Postgres error mapping), `core/time`
- [x] **0.3** [C] UI shell: shadcn/ui, theme tokens (light/dark), layouts for each role (sidebar for CEO/Admin, bottom nav for Staff on mobile), error boundaries, 404/403, toasts, shared composites (EmptyState, PageHeader, DataTable, ConfirmDialog, ReasonDialog, StatusBadge, BulkBar)
- [x] **0.4** [C] Quality gates: Vitest and Playwright are in place (0.2/0.3), so this task is the wiring — pgTAP joining `pnpm check` (Playwright stays out: `pnpm test:e2e` + its own CI job), eslint-plugin-boundaries (module isolation + the money-import rule + **`modules/*/domain` may not import `react`, `react-dom`, `next/*`, `server-only` or DOM globals**, ADR-0011), and GitHub Actions CI
- [x] **0.5** [H] Deploy: OpenNext on Cloudflare Workers + a staging Supabase project, env handling, Sentry, deploy workflow from `main`, PWA manifest + service worker shell

## Phase 1: Identity and access
Exit: the CEO logs in, invites an Admin and a Staff member, and each sees only their role's shell. Every change is audited.
- [ ] **1.1** [H] Schema: organizations, org_settings, members (single-CEO index), `current_org_id()`, role_permissions seeded from PERMISSIONS.md, session_events, activity_log (append-only) + generic `audit_row_change()` trigger, `current_member()`, `has_permission()`, pgTAP for each role
- [ ] **1.2** [H] Auth: invite-only Supabase Auth (sign-ups off), **CEO bootstrap script** (no plaintext passwords), login and logout (session_events), middleware and route guards, deactivation takes effect immediately, Resend SMTP, rate limits. Also: `Sentry.setUser({ id })` only, and **strip `user.geo`** (Sentry still infers a country from the connecting IP with IP storage off)
- [ ] **1.3** [C] Team: invite (role + job title), accept → set password → profile, member list, edit name, role and job title, deactivate or reactivate. `core/lists` engine (job titles). `core/permissions` UI helpers
- [ ] **1.4** [C] Settings (the CEO's control centre): company profile, weekly off days (**seed: Sunday**), holiday list (empty), thresholds (**2 h / 4 h / 8:30 PM**), job titles (**seed: Video Editor, Graphic Designer**, CEO can add more), `app.is_working_day()` + tests

## Phase 2: Attendance and leave
Exit: Admins and Staff pass the daily gate, request leave, and the CEO approves or corrects everything, with full history.
- [ ] **2.1** [H] Schema + transition functions: attendance_days, attendance_events, leave_requests. `attendance_touch`, `attendance_submit`, `attendance_decide` (approve or correct with reason, bulk), `attendance_logout`, `attendance_flag_overtime`, `leave_submit/withdraw/request_change/decide/ceo_edit`. pgTAP for every path
- [ ] **2.2** [C] Day gate: `requireDayGate()`, attendance choice screen (mobile-first), day-off handling, logout button capturing the time, overtime flag
- [ ] **2.3** [C] Leave for employees: request (single day, range, half day), change or cancel requests, my attendance and leave history
- [ ] **2.4** [C] CEO review: pending attendance and leave lists, bulk approve, correct-with-reason dialog, per-person history, today's people board
- [ ] **2.5** [H] Jobs: pg_cron setup, `absent_check` (working days only; approved leave becomes an approved day; `awaiting_choice` counts as no submission; CEO exempt; one summary notification), `logout_not_recorded`, idempotency and IST-boundary tests

## Phase 3: Clients
Exit: clients exist with their Admin, contacts, brand basics and custom fields. Admins see only theirs.
- [ ] **3.1** [H] Schema: clients, client_private, client_admin_assignments, client_contacts, client_brand, `client_labels` view, `admin_client_ids()`, lifecycle transitions (activate, pause, close, reactivate, assign admin), pgTAP (Admin scope, Staff denial)
- [ ] **3.2** [H] `core/custom-fields`: definitions, zod builder, validation, `<CustomFieldsForm>` / `<CustomFieldsView>`, Settings → Custom fields (per entity, per client, per task type)
- [ ] **3.3** [H] `core/storage`: R2 adapter, `files` table, presigned single and **multipart** upload, download links, SVG sanitizing, orphan cleanup job. Used first for logo and avatar upload
- [ ] **3.4** [C] Clients UI: list (logo, state, Admin), filters, create/edit form, client page (overview, contacts, brand, Drive link, CEO-only notes, activity), lifecycle actions, Admin assignment (CEO)

## Phase 4: Staff tasks
Exit: a task goes assign → everyone acknowledges → updates → Done → Admin → CEO, including rejection loops, with the correct approval route every time.
- [ ] **4.1** [H] Schema: task_types (seeded), tasks, task_assignees, task_stages, task_comments, task_reviews, task_warnings, task visibility RLS, `member_availability()`, pgTAP
- [ ] **4.2** [H] Transition functions: `task_create` (**approval-route resolution**, PRODUCT §4.6), `task_acknowledge`, `task_start`, `task_submit_done` (late reason, Admin-step skip), `task_review` (admin/ceo, reason on reject, bulk), `task_reopen`, `task_cancel`, `task_update_assignment` (field-level audit + notifications), `task_set_approver`. pgTAP for every path
- [ ] **4.3** [C] Create/assign dialog: type-specific fields (event date/time, location, purpose), client label, assignees + primary owner, deadline, priority, stages, custom fields. Conflict, workload and leave **warnings** with recorded override
- [ ] **4.4** [C] Task page: header and state, per-assignee acknowledgement, "Task Noted", stages, comments timeline, Done (late reason), review actions, change history, locking from `submitted`
- [ ] **4.5** [C] Lists: Staff "My tasks", management task list (filters: person, client, type, state, overdue), **Approvals inbox** (Admin and CEO, bulk approve or reject)
- [ ] **4.6** [C] Task requests (suggest → convert or decline) and task templates

## Phase 5: Notifications and reminders
Exit: every event in WORKFLOWS §9 reaches the right people in-app and by push (email for the important few). Reminders and escalations fire on time without duplicates, **and management can see who isn't reachable**.
- [ ] **5.1** [H] notifications, notification_deliveries, push_subscriptions. `NotificationService` + channels, notification rows from all existing transition functions, in-app bell + Realtime, history page with deep links
- [ ] **5.2** [H] Web Push: VAPID keys, service worker push handling, subscribe and re-subscribe flow, persistent "enable notifications" banner, `push_dispatch` with retries, **email only for invites, escalations, digests and people with no working push, with a per-person daily cap**, iOS "add to home screen" guidance
- [ ] **5.3** [H] Reminders: `reminder_rules` → `task_reminders`, `reminders_tick` (before due, due, overdue, acknowledgement repeats, escalations), `logout_reminder` job, updating reminders when tasks change or are cancelled. pgTAP + unit tests
- [ ] **5.4** [H] **Reachability** (WORKFLOWS §9a): subscription lifecycle (kept across logout with **title-only** payloads, removed on "sign out of this device" or deactivation), `member_reachability` view, Settings → Notifications showing who isn't reachable and why, the 48 h alert to the CEO, and "Send a test" (`notification_send_test`). pgTAP + unit tests
- [ ] **5.5** [C] Onboarding for reachability: the iOS "add to home screen" walkthrough, the permission banner that persists until push works, device list with "Sign out of this device", and the test-notification step in a new joiner's first login

## Phase 6: Dashboards, calendar and ★ pilot
Exit: **the team uses MaxOff daily** for attendance, leave and tasks, in production, with backups.
- [ ] **6.1** [C] Staff **My Day** (mobile-first): pending acknowledgement, today, upcoming, overdue, changes requested, events, request a task, logout
- [ ] **6.2** [C] CEO **Today**: at-a-glance counts, approvals inbox, people board, today's tasks, overdue and risks, events strip, with Realtime updates
- [ ] **6.3** [C] Admin dashboard: my clients, staff tasks needing attention, approvals, calendar strip, issues
- [ ] **6.4** [C] Calendar: day, week and month views. Events, leave and holidays. Filters. Busy blocks for Admins
- [ ] **6.5** [H] End-of-day report: `eod_report` job + report page (live and saved), notification to the CEO
- [ ] **6.6** [H] **Pilot release:** production Supabase (Mumbai region) + Worker on **Workers Paid ($5/mo)**, nightly backups + **restore drill**, Sentry + UptimeRobot (hitting a route that touches the database so the project never pauses), onboarding checklist (install the PWA on iPhone, enable push), `docs/USER-GUIDE.md` (attendance and tasks), and **readable Sentry stack traces** (OpenNext re-bundles Next's chunks into `worker.js` without a map: build the Worker with a source map, inject it, and upload it with the commit SHA as the release)

## Phase 7: Client work
Exit: a real client's monthly and weekly projects run in MaxOff. The Admin ticks items, the CEO approves, cycles roll over and carry-forward works.
- [ ] **7.1** [H] Schema: stage_presets, projects, project_stages, project_item_blueprints, project_cycles, project_items, project_item_stages, item_reviews, RLS (Admin scope, Staff denial), pgTAP
- [ ] **7.2** [H] Transition functions + jobs: `project_create` (one-time → first cycle), `item_tick_stage`, `item_mark_done`, `item_approve/reject` (bulk), `item_cancel`, `cycle_generate` (idempotent job on the 1st and Mondays, active clients only), `cycle_carry_decide`, `project_complete/cancel/reopen`, `project_set_billing_category`. pgTAP
- [ ] **7.3** [C] Client → Projects tab, create project dialog (recurrence, stage preset, item list), project page (cycle switcher, items with stage ticks, bulk tick, "9/12 done · 8/12 approved")
- [ ] **7.4** [C] CEO item approvals in the inbox, carry-forward decision screen, stage presets in Settings, project templates

## Phase 8: Work submissions, files and the Drive archive
Exit: Staff submit photos and short videos from any device (iPhone included), large videos come in as Drive links, and **everything is copied into the company Google Drive** with MaxOff cleaning up its own copies.
- [ ] **8.1** [H] Submissions: `submission_items`, resumable uploader (images ≤ 25 MB, video ≤ 100 MB), browser-side JPEG preview generation including **HEIC**, originals stored untouched, `task_submit_version`, reviews tied to a version, RLS + pgTAP
- [ ] **8.2** [C] Review UI: previews (image, video, PDF), versions timeline, download the original, comment and request changes per version, archive status badges
- [ ] **8.3** [H] `core/drive`: Google OAuth (CEO-only connect and reconnect, tokens encrypted), folder creation and cache, `files.copy` for links, R2 → Drive upload, `drive_jobs` queue with backoff, link access checks and re-checks, quota checks, Settings screen. pgTAP + unit tests
- [ ] **8.4** [C] Link submission flow: paste, validate access immediately, "Link is private" flag and notification, automatic re-check, and the `storage_cleanup` retention job (90/30 days, archived only)

## Phase 9: Revenue, reports and month close (CEO)
Exit: the CEO sees Potential / Achieved / Remaining by client, category and month, closes a month, and exports it for AI analysis.
- [ ] **9.1** [H] Money tables + revenue views + overrides + billing status. pgTAP proving Admin and Staff can't read money through any path
- [ ] **9.2** [C] Revenue UI (via `modules/revenue` components): project billing setup, per-item values, overrides with notes, billing status, revenue panels on the client page and dashboard
- [ ] **9.3** [H] Metrics views (raw employee, stage-duration, revision-loop, delay and workload facts) + reports pages (week, month, custom range). Scoped operational reports for Admins
- [ ] **9.4** [H] Month close: snapshot builder, immutable versions, corrections
- [ ] **9.5** [C] Exports: AI-oriented Markdown, CSV (zipped datasets), PDF summary
- [ ] **9.6** [C] Activity history: search by person, client, record, action and date

## Phase 10: Search, polish, hardening and full launch
Exit: everything in PRODUCT §4 is live in production, secured and backed up.
- [ ] **10.1** [C] Global search (Ctrl/Cmd + K), filtered by permissions
- [ ] **10.2** [Q] UX polish: keyboard shortcuts, empty and loading states, mobile pass, accessibility fixes
- [ ] **10.3** [H] Security review: RLS audit, money isolation, storage, auth, headers/CSP, rate limits, dependency audit
- [ ] **10.4** [C] Performance: slow query review, indexes, bundle size, pagination
- [ ] **10.5** [C] Full launch: import existing clients and projects, finish the user guide, second restore drill

---

## Later (each a new module behind a feature flag)
WhatsApp notifications · GST invoicing · leads pipeline · client portal · custom roles UI · AI insights inside MaxOff · social publishing · accounting integration

**Native app (ADR-0011), decided after the pilot:** the PWA already installs on both platforms. If the App Store, Play Store or more reliable iOS push is wanted, a **Capacitor shell** around the same app is ~2–4 weeks. A **React Native / Expo** app (native feel, real offline, background upload) is ~2–3 months and reuses the backend, rules, permissions and `domain/` untouched — only the UI is rebuilt.
