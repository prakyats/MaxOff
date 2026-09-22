# MaxOff Architecture (v2)

> **How** MaxOff is built. What it does: `PRODUCT.md`. Tables: `DATA-MODEL.md`. States: `WORKFLOWS.md`. Access: `PERMISSIONS.md`.
> Changing any pattern here needs an ADR in `docs/decisions/`.

---

## 1. Principles

| Principle | What it means in MaxOff |
|---|---|
| **Modular monolith** (ADR-0001) | One Next.js app and one Postgres database, split into strictly separated modules on a shared core. |
| **The database is the gatekeeper** | RLS decides visibility. **Transition functions** decide workflow changes. Server actions validate and call them. The UI only hides controls. |
| **Atomic audit** (ADR-0006) | A change and its audit record commit together, or neither does. |
| **Customization is data** (ADR-0002) | Task types, stage presets, job titles, holidays, custom fields and templates live in tables. Code relies only on fixed *categories* (enums in DATA-MODEL §0). |
| **Two work systems** (ADR-0005) | Client work (projects → cycles → items) and staff tasks are separate modules with no automatic coupling. The only link is a task's optional client **label**. |
| **Money is sealed off** (ADR-0007) | Amounts live only in CEO-only tables and views. Nothing outside the `revenue` module can read them. |
| **IST everywhere** (ADR-0008) | Stored as UTC `timestamptz`. Business dates are computed in `Asia/Kolkata` in SQL (one helper) and in TS (one helper). |
| **Cheap SaaS seams, nothing more** | An `org_id` boundary, clean modules, an authorization layer, and storage and notification adapters. No multi-tenant features. |
| **Additive change** | Migrations and module APIs are only added to. Anything destructive goes through expand → migrate → contract. |

---

## 2. Tech stack (free tiers, ADR-0003)

| Need | Choice | Upgrade path |
|---|---|---|
| App | **Next.js (App Router) + TypeScript strict**, React Server Components, server actions | — |
| UI | Tailwind CSS + shadcn/ui, lucide icons, TanStack Query (client caches for live screens) | — |
| Database, Auth, Realtime, cron | **Supabase** (Postgres 15+, RLS, Realtime, `pg_cron`, `pg_net`) | Supabase Pro (daily backups, no pausing) |
| Files | **Cloudflare R2**, S3 multipart presigned uploads, behind `core/storage` | S3 / Supabase Storage (swap the adapter) |
| Hosting | **Cloudflare Workers** through the OpenNext adapter. Free while building; **Workers Paid ($5/mo) from the pilot**, because the free plan allows only 10 ms CPU per request, which server-rendered pages exceed | Higher tiers, or any Node host |
| Archive | **Google Drive API** on one company account, behind `core/drive` | Workspace shared drives later |
| Push | **Web Push (VAPID) + service worker**, behind `core/notifications` | FCM/APNs adapter for a future mobile app |
| Email | **Resend** (Supabase Auth SMTP + notification fallback) | Any SMTP |
| PDF export | `@react-pdf/renderer` (server) | — |
| Monitoring | Sentry, UptimeRobot | Paid plans |
| CI, backups | GitHub Actions | — |
| Tests | Vitest, Playwright, **pgTAP** | — |
| Libraries | zod, react-hook-form, date-fns + date-fns-tz, dnd-kit, fractional-indexing, eslint-plugin-boundaries, DOMPurify, web-push | — |

**Environments:** Local (Supabase in Docker) · Staging (free Supabase project + Worker, deployed from `main`) · Production (separate project + Worker, deployed from a tag). Real data never goes on local or staging. Details, env handling and the Sentry privacy rule: §18.

---

## 3. Code structure

```
src/
  app/                       # routes only: thin pages composing module components
    (auth)/login, invite/
    (gate)/attendance/       # the first-login-of-the-day choice screen
    (app)/today, my-day, approvals, clients/, tasks/, calendar, people/, reports/, settings/
    api/                     # webhooks, cron entry points (secret-protected), push subscribe
  core/                      # shared foundation, NO business features
    auth/                    # session, getCurrentMember(), guards, day-gate check
    db/                      # Supabase clients (server, browser, service) + generated types
    permissions/             # key registry, can(), requirePermission(), <Can>
    activity/                # activity feed UI + helper for non-workflow audit
    custom-fields/           # definitions, zod builder, <CustomFieldsForm>/<View>
    lists/                   # list_items engine + registry
    storage/                 # StorageAdapter (R2), multipart presign, file metadata
    notifications/           # NotificationService, channels (push, email), <Bell>
    time/                    # IST helpers: todayIST(), toISTDate(), istDayRange(), formatIST(); isWorkingDay() in 1.4
    realtime/                # useRealtimeInvalidate(table, filter) → TanStack Query invalidation
    errors/                  # AppError, Result<T>, action() wrapper, Postgres error mapping
    observability/           # Sentry init per runtime + the PII/money scrubber (§18)
    ui/                      # design system (task 0.3): primitives/ (shadcn/ui, added with
                             #   `pnpm dlx shadcn add`, see components.json), composites/ (DataTable,
                             #   EmptyState, PageHeader, ConfirmDialog, ReasonDialog, BulkBar,
                             #   StatusBadge, FileDrop in 8.1), shell/ (AppShell, role nav), theme/,
                             #   pwa/ (service-worker registration)
    lib/
  modules/
    team/          attendance/     leave/        clients/       client-work/
    tasks/         notifications-center/ dashboards/  calendar/  revenue/
    reports/       search/         settings/     templates/
      index.ts     # PUBLIC API: the only import surface
      domain/      # types, zod schemas, pure logic (unit-tested)
      data/        # repository: all DB access for this module (queries + rpc calls)
      actions/     # server actions
      components/
      permissions.ts
      tests/
supabase/
  migrations/      # append-only SQL
  functions/       # (only if needed) Edge Functions, e.g. push dispatch
  tests/           # pgTAP
  seed.sql         # dev seed: org, CEO, sample admins/staff/clients, Pixora lists
e2e/               # Playwright
public/            # manifest.webmanifest, icons/, service worker (sw.js), _headers
scripts/           # one-off maintenance scripts (icon rendering)
wrangler.jsonc     # Workers: dev / staging / production (§18); open-next.config.ts beside it
```

### 3.1 Import rules (eslint-plugin-boundaries, task 0.4)
Enforced by `eslint.config.mjs`; `tests/lint-rules.test.ts` lints the fixture tree in `tests/lint-fixtures/` and fails if any rule stops firing (or fires on an allowed case).
- `app → modules (index only) → core`. `core` never imports modules. No cycles. Files directly under `src/` (`proxy.ts`, `instrumentation.ts`) follow the `app` rules, and every file under `src/` must belong to a known element.
- **`modules/*/domain` is platform-free** (ADR-0011): no `react`, `react-dom`, `next/*`, `server-only`, `client-only` or DOM globals, and from `core` only `time`, `errors` and `lib` (an allow-list in the config; extend it deliberately) plus **type-only** imports of `core/db` (`Tables<>`, `Enums<>` are plain data shapes).
- Nothing outside a module imports its `data/`, `actions/` or internal `components/`.
- **Only `data/` layers touch the database** (CLAUDE.md rule 3): `@supabase/supabase-js`, `@supabase/ssr` and `core/db`'s clients may be imported only from `src/modules/*/data/` and the core areas that own tables: `core/db`, `core/auth`, `core/activity`, `core/lists`, `core/custom-fields`, `core/notifications`, `core/storage`. Type-only imports are fine anywhere.
- **Only `modules/revenue` may import money types or query money tables and views.** Outside `modules/revenue` (and the generated types in `core/db`), any string or template literal containing `project_billing`, `item_billing`, `cycle_billing`, `revenue_overrides`, `revenue_by_client_month_v` or `revenue_by_cycle_v` as a whole word is a lint error, so `.from("…")`, `Tables<"…">` and an embedded select like `"*, project_billing(*)"` all fail. Identifiers aren't checked; RLS (pgTAP-tested) is the wall behind the lint. Other modules show money only by rendering `revenue`'s exported components, which render nothing for non-CEO users. (`projects.billing_category` is not money: it's an operational label Admins may see. Only the CEO can set it.)
- There is **no currency custom-field type**, so money can never leak in through `custom_fields`.

### 3.2 Module ownership
| Module | Owns | Depends on |
|---|---|---|
| team | members, role_permissions, session_events, job titles (list) | core |
| settings | org_settings, holidays, task_types, stage_presets, feature_flags | core |
| attendance | attendance_days, attendance_events | team, settings, leave |
| leave | leave_requests | team |
| clients | clients, client_private, client_admin_assignments, client_contacts, client_brand, client_labels view | team |
| client-work | projects, project_stages, blueprints, cycles, items, item stages, item_reviews | clients |
| templates | project_templates, task_templates | client-work, tasks |
| tasks | tasks, assignees, stages, comments, reviews, submissions, reminders, warnings, requests | team, clients (label), leave (warnings), settings |
| revenue | project_billing, item_billing, cycle_billing, revenue_overrides, revenue views | client-work, clients |
| notifications-center | notifications UI, push subscription UI | core/notifications |
| calendar | — (read models) | tasks, leave, settings, client-work |
| dashboards | — (read models) | all module indexes |
| reports | eod_reports, month_snapshots, exports | all module indexes, revenue |
| search | — (search function) | module indexes |

Core owns organizations, files, notifications, notification_deliveries, push_subscriptions, activity_log, list_items and field_definitions.

### 3.3 Design tokens and rules (`core/ui`, task 0.3)
Pixora Clips' brand is red `#C42126`, white and black. The app is **premium through restraint**: graphite and bone surfaces, generous space, and red used **only for identity and urgency**, never as decoration. Tokens live in `src/app/globals.css` (`:root` light, `.dark` dark) and reach Tailwind through `@theme inline`. Screens use the tokens below and nothing else; a new colour needs a change here first.

| Token | Light | Dark | Used for |
|---|---|---|---|
| `background` | `#FAFAF9` | `#0B0B0C` | the page |
| `card` / `popover` / `sidebar` (surface) | `#FFFFFF` | `#141416` | cards, sidebar, menus, dialogs: one step above the page |
| `muted` / `secondary` / `accent` | `#F2F1EF` | `#1F1F23` | quiet fills, hover rows, active nav |
| `border` / `input` | `#E7E5E4` | `#26262A` | hairlines |
| `foreground` | `#18181B` | `#FAFAF9` | text |
| `muted-foreground` | `#71717A` | `#A1A1AA` | secondary text (≥ 4.5:1 on page and surface) |
| `logo` | `#C42126` | `#C42126` | the logo tile only, with a white M. A fixed brand asset: it never lightens in dark mode; only the wordmark follows the theme |
| `brand` (= `ring`, `destructive`) | `#C42126` | `#F2686D` | the 2px active-nav bar, focus ring, unread dot, destructive buttons |
| `primary` | `#18181B` | `#FAFAF9` | buttons stay neutral; red would shout |
| `success` | `#047857` | `#34D399` | approved, completed, done, settled, billed, present, active |
| `info` | `#1D4ED8` | `#7DA2FF` | **work in motion only**: in progress, submitted, converted |
| `attention` | `#AD5009` ¹ | `#FBBF24` | pending review, awaiting choice, changes requested, admin approved, paused |
| `danger` | `#C42126` | `#F2686D` | overdue, rejected, absent, cancelled, declined, urgent |
| `neutral` | `#52525B` | `#A1A1AA` | draft, to do, inactive, withdrawn, none, skipped, and informational values (invited, leave types, corrected, carry forward) |

¹ The brief's `#B45309` reads at 4.26:1 on a 12% tint; `#AD5009` is the nearest value that clears 4.5:1.

Each tone has a `*-soft` pill background (`success-soft` ...): the tone at **12% over the light surface and 18% over the dark surface**, so every pill has a visible tint and its text reads at **>= 4.5:1**; `status-badge.test.ts` reads `globals.css` and fails if any pair drops below. Danger and brand are deliberately the same red: red should be rare, so when it appears it means "act now".

Rules every screen follows:
- **`StatusBadge` has exactly six tones**: `success`, `info`, `attention`, `danger`, `neutral`, `brand`. Every DATA-MODEL §0 value maps to one of them in `STATUS_TONES` (tested). Stage names, task types and other data get `neutral` unless a workflow state says otherwise.
- **A plain `<Badge>` is a neutral pill** (the primitive's default variant), never a solid block. `StatusBadge` adds the tone.
- **Dashed borders mean "empty" only** (`EmptyState`). Loading, error and content containers use solid hairlines.
- **One accent per screen.** If a page shows a red badge, its buttons stay neutral (`primary`, `outline`, `ghost`). `destructive` buttons are for confirmed destructive actions only.
- **Tabular numbers** everywhere (`font-variant-numeric: tabular-nums` on `body`): counts, dates, times and amounts line up.
- **Radii 10-12px** (`--radius` 10px; `xl` and above collapse to 12px), **hairline borders**, **no heavy shadows** (the `--shadow-*` tokens are soft and offset).
- **Focus is always visible**: components use `ring-ring` (brand) and a global `:focus-visible` outline catches the rest. Text selection, caret and form accents use `brand`.
- **Typography:** Geist (UI) and Geist Mono (data) through `next/font`. Nexa and Robot Heroes are logo and marketing faces only (licensed, not self-hosted in the app).
- **Layout:** shell pages sit in a 1280px container with even gutters (`px-4 sm:px-6 lg:px-8`). Staff screens are laid out for 375px first.

---

## 4. Two kinds of mutation

### 4.1 Workflow transitions (approvals, attendance, leave, task states, items, cycles, money, month close)
These are implemented as **Postgres functions** (`security definer`, `set search_path = ''`) named `<module>_<verb>`, e.g. `task_submit_done(task_id, late_reason)`, `task_review(task_id, decision, reason)`, `attendance_decide(day_id, status, reason)`, `item_approve(item_ids[])`.

Each function, in **one transaction**:
1. identifies the caller (`auth.uid()` → active member) and checks the permission key **and** the scope rule (e.g. "caller is this task's approving Admin");
2. locks the row (`select … for update`) and checks the current state allows the transition;
3. updates the row and child rows;
4. inserts the `activity_log` entry (and domain history rows such as `task_reviews` / `attendance_events`);
5. inserts `notifications` (+ `notification_deliveries` queued) for the recipients in WORKFLOWS §9;
6. returns the new state.

State columns can't be updated directly: RLS gives no update permission on them, plus a trigger guard. The same guard covers `projects.billing_category`, `projects.client_id` and `projects.recurrence`, which change only through CEO-only transition functions. Bulk actions call the function for each id inside one request and return per-id results.

### 4.2 Plain edits (names, descriptions, contacts, brand, custom fields, settings)
```ts
export const updateClient = action(async (input: unknown) => {
  const data = updateClientSchema.parse(input);                 // 1. zod
  await requirePermission('clients.edit_assigned');             // 2. early, friendly check (RLS is the real gate)
  const values = await validateCustomFields('client', data);    // 3. custom fields
  const client = await clientsRepo.update(data.id, values);     // 4. write (RLS applies)
  revalidatePath(`/clients/${client.id}`);                      // 5. refresh
  return ok(client);                                            // 6. Result<T>
});
```
Auditing for plain edits is done by a **generic `audit_row_change()` trigger** on audited tables. It writes `activity_log` with the old/new diff and `auth.uid()` in the **same transaction**, so it can't be skipped or fail silently.

### 4.3 Errors
`action()` catches `AppError`, zod errors and Postgres errors. Transition functions raise through `perform app.fail('INVALID_STATE', 'This task is already completed')`: SQLSTATE `P0001`, **message = the code** (`UNAUTHENTICATED`, `FORBIDDEN`, `NOT_FOUND`, `VALIDATION`, `CONFLICT`, `INVALID_STATE`, `REASON_REQUIRED`, `RATE_LIMITED`), **detail = the human reason**. `core/errors` maps the code and shows the detail when present, or the code's default message. Actions return `{ ok: false, error: { code, message, fieldErrors } }` and never throw raw database errors to the UI.

---

## 5. Authorization in the database
- `current_org_id()` returns the caller's organization id (the single org in the prototype) and is the default for every root table's `org_id`.
- `current_member()` returns the caller's active member row. **Deactivated means no rows**, so access ends immediately.
- `has_permission(key)` checks role → `role_permissions`.
- Scope helpers: `admin_client_ids()` (assigned clients), `visible_task_ids()` as a policy expression, `is_task_assignee(task_id)`, `is_approving_admin(task_id)`.
- `member_availability(from, to)` is a `security definer` function that returns counts and busy blocks only. It's how Admins see other people.
- Money tables have **one policy**: `has_permission('finance.view')`.
- Every table's policies have **pgTAP tests for each role**, both allowed and denied.

## 6. Database conventions
- Conventions as in DATA-MODEL: uuid PKs, `created_at`/`updated_at`/`created_by`, `archived_at`, fractional-index `position` strings.
- Enums only for categories code depends on. Everything else is a table or list.
- Append-only tables (`activity_log`, `*_events`, `*_reviews`, `task_comments`, `month_snapshots`) have `UPDATE`/`DELETE` **revoked** from `authenticated`, not just blocked by policy.
- Migration names: `YYYYMMDDHHMMSS_<module>_<change>.sql`. Every new table has RLS and pgTAP tests in the same task.

## 7. Time (ADR-0008)
- SQL: `app.today_ist()`, `app.to_ist_date(ts)`, `app.is_working_day(date)` (weekly offs + holidays).
- TS: `core/time`, the only place that formats or computes IST dates. Components never call `new Date()` for business logic.
- `pg_cron` runs in UTC, so jobs are scheduled at the UTC equivalent (23:59 IST = 18:29 UTC) and **re-check the IST date inside the job**.

## 8. The first-login day gate
- `(app)` layout → `core/auth` `requireDayGate()` → rpc `attendance_touch()`. This creates today's `attendance_days` row and a `session_events(login)` if needed, and returns whether a choice is still required.
- If a choice is required, redirect to `/(gate)/attendance`. The CEO is exempt. On a day off the gate still asks, marking `is_day_off`. On a day with approved leave (full or half) there's no gate: `attendance_touch()` creates the day from the leave (`derived_from_leave`) and still records `first_login_at` and the login event.
- `attendance_touch()` is idempotent and runs once per session per day (cached in a signed cookie holding the IST date).

## 9. Notifications (ADR-0009)
```
transition fn / job ─► notifications row ─► notification_deliveries (queued)
                                   │                       │
                        Realtime ─► in-app bell     push_dispatch (Worker cron → /api/cron/push-dispatch)
                                                           ├─ Web Push (VAPID) to each subscription
                                                           └─ Email (Resend) if no working push, or escalation
```
- `NotificationService` (TS) has channel adapters `PushChannel` and `EmailChannel`. A future `FcmChannel` or `WhatsAppChannel` plugs in without touching business code.
- Users can't mute anything. The app asks for push permission after login and keeps nudging (not blocking) until it's granted. In-app notifications always work.
- Delivery is idempotent (unique per notification + channel), retried with backoff, and a subscription is disabled after repeated `410 Gone` responses.
- `EmailChannel` enforces `org_settings.email_daily_cap_per_member` (default 20) by counting that member's `notification_deliveries(channel = email, sent_at today IST)`. Invites and escalations (`kind` in the escalation set) bypass the cap.

## 10. Real time
`core/realtime` subscribes to Supabase Realtime `postgres_changes` (RLS-filtered) for: `tasks`, `task_assignees`, `task_comments`, `attendance_days`, `leave_requests`, `project_items`, `notifications`. On a change it **invalidates** TanStack Query keys and never trusts the payload for display, so RLS stays the source of truth.

## 11. Files and the Drive archive (ADR-0003, ADR-0010)
- **Upload:** action `files_begin_upload(meta)` checks permission, type and size (**images ≤ 25 MB, video ≤ 100 MB**), creates a `files` row (`pending`) and returns presigned **multipart** URLs. The browser uploads parts straight to R2 (resumable, retried per part), then calls `files_complete_upload`, which marks it `ready`. **Drive jobs are queued only by `task_submit_version`**, never by `files_complete_upload`, so logos, avatars and previews are never archived.
- **Originals are immutable.** The uploaded bytes are never re-encoded. For images, the browser also produces a **small JPEG preview** (including from HEIC) which is stored as a separate file and used for display. Retention applies to originals only: previews are kept after the original leaves R2, so the task page still shows the work.
- **Download or preview:** permission check → presigned GET, valid 5 minutes. Buckets are private.
- SVGs are sanitized on completion, and SVG and HTML are never served inline.
- **`core/drive`** wraps the Google Drive API: OAuth for one company account (refresh token encrypted at rest with a server key), `files.copy` for pasted links (server-side, no bytes through us), resumable upload from R2 for our own files, folder creation with a cache, and quota checks. Every call goes through the `drive_jobs` queue, which is idempotent and backs off, so a failure never blocks a user action.
- Streaming R2 → Drive happens in the cron route, where waiting on the network doesn't consume Worker CPU time. Files are ≤ 100 MB, so this stays well inside limits.
- **Retention:** the daily `storage_cleanup` job removes local copies only after the Drive copy is confirmed (WORKFLOWS §5A). Orphaned `pending` files are cleaned up in the same job.

## 12. Revenue (ADR-0007)
All calculation is in SQL views (WORKFLOWS §6) over CEO-only tables, so reports and exports share one definition. Overrides never replace the calculated value, they sit next to it. Money never leaves the app through error reporting either: §18 scrubs every financial field before an event reaches Sentry.

## 13. Reports and exports
- **EOD report:** built by a job into `eod_reports.data`. The page can also render a live version.
- **Month close:** `month_close(month)` builds the snapshot JSON in SQL and stores version 1. `month_correct(month, note)` stores version N+1.
- **Exports:** Markdown (AI-oriented: summary + dense tables with stable IDs and ISO timestamps), CSV (one file per dataset, zipped), PDF (summary). Generated on demand from the snapshot (closed months) or live views (open months). CEO only.

## 14. PWA and responsive design
`public/manifest.webmanifest`, icons (`public/icons/`, rendered from `icon.svg` by `scripts/generate-icons.mjs`) and a plain-JS service worker `public/sw.js` (task 0.5). The worker is a **minimal offline shell**: it precaches `/offline`, serves it when a navigation fails without a connection, caches hashed `/_next/static` and `/icons` assets cache-first, and never touches `/api`, non-GET requests or other origins, so Supabase and server actions are always live. It is registered by `<RegisterServiceWorker />` in the root layout **only in production builds** (`next dev` and Playwright never see it). Push handlers join the same file in 5.1 (ADR-0009). `src/core/ui/pwa/pwa-files.test.ts` keeps the manifest, icons, headers and worker consistent with the tokens. Staff screens are designed mobile-first. CEO and Admin screens are desktop-first and still usable from 375px.

## 15. Testing
| Layer | Tool | Required for |
|---|---|---|
| Domain logic | Vitest | every function in `domain/` (e.g. approval-route resolution, revenue allocation mirror, reminder schedule expansion) |
| Database | pgTAP | every table's RLS for each role; **every transition function**: allowed path, wrong state, wrong actor, missing reason, audit row written |
| Jobs | pgTAP | idempotency (running twice creates nothing new), IST boundaries, working-day logic |
| Flows | Playwright | login + day gate, assign → acknowledge → done → admin → CEO, rejection loop, leave request → decision, cycle generation → tick → approve, CEO bulk approve |
| CI | GitHub Actions | three jobs on every push and PR (`.github/workflows/ci.yml`): `typecheck · lint · format · unit · build` (the build is the **OpenNext Worker build**, so a change the Workers runtime can't take fails before merge), `pgTAP` (Postgres-only local stack) and `playwright` (Chromium). Red never merges: branch protection on `main` requires all three (README) |

Locally, `pnpm check` = typecheck + lint + format:check + unit tests + pgTAP + build (needs Docker and `pnpm db:start`). Playwright is deliberately outside `check`: `pnpm test:e2e` runs it on demand and `/finish-task` runs it whenever a flow changed. Until task 1.2 the flow specs run against `next dev` with the preview-role cookie; 1.2 switches them to `pnpm start` with seeded users. A separate **`production` project** (`e2e/production.spec.ts`) always runs against `next start` of a fresh build on its own port and proves that development-only shims are unreachable in a real build and that the service worker registers. It never reuses a running server.

## 16. Recipe for adding a feature
1. `/add-feature` → `docs/features/<name>.md` (+ an ADR if a pattern changes).
2. Update DATA-MODEL, WORKFLOWS and PERMISSIONS first.
3. New module folder, migration (tables + RLS + transition functions + seeded permissions), feature flag off by default.
4. Build and test. Existing tables are only **added to**.
5. Other modules' screens are extended only through the **extension slots** their `index.ts` exposes (tabs, panels, dashboard cards).

## 17. Backups
Nightly `pg_dump` GitHub Action → encrypted → private R2 bucket (30-day retention). R2 object versioning or retention on the files bucket. A restore drill before launch, then every quarter. CEO CSV exports as a secondary copy.

## 18. Deployment and observability (task 0.5, ADR-0003)

### 18.1 Environments
| | Local | Staging | Production |
|---|---|---|---|
| App | `next dev` | Worker `maxoff-staging` (`*.workers.dev`, free plan) | Worker `maxoff` (Workers Paid from the pilot, custom domain at 6.6) |
| Database | Supabase in Docker | free Supabase project `maxoff-staging` (Mumbai) | separate Supabase project |
| Deployed by | — | `.github/workflows/deploy.yml`, when **CI has passed on `main`** (`workflow_run`) | the same workflow, on a `v*` tag that points at a commit **on `main` with all three CI checks green** (the job reads the commit's check runs; CI itself never runs on tags) |
| Values from | `.env.local` | GitHub environment `staging` | GitHub environment `production` |
| Sentry | off (no DSN) | `environment: staging` | `environment: production` |

Real data never goes on local or staging. Each deploy job first applies the append-only migrations (`supabase link` + `supabase db push`), then builds the Worker with OpenNext (`pnpm build:worker`) and deploys it with `wrangler deploy --env <name>`; runtime secrets (`SUPABASE_SECRET_KEY`) are uploaded as Worker secrets, never bundled. The exact secret and variable names, and where each comes from, are in README → "Deploying".

**Env handling.** `NEXT_PUBLIC_*` values are inlined by `next build`, so they must exist at **build** time (GitHub environment *variables*); everything else is read at runtime from Worker secrets or `.env.local`. Readers live next to their area and validate with zod on first use: `core/db/env*.ts` (Supabase), `core/observability/env.ts` (`NEXT_PUBLIC_APP_ENV`, `NEXT_PUBLIC_SENTRY_DSN`). Every variable is documented in `.env.example` by the task that introduces it. `wrangler.jsonc` holds no `vars`: it only names the Workers, their bindings and compatibility flags (`nodejs_compat`, required by both OpenNext and Sentry).

**Windows.** `next build` runs anywhere, but the OpenNext bundling step cannot read pnpm's junction folders on Windows, so `pnpm build:worker` and `pnpm preview` run in CI, in the deploy workflow, or locally under WSL.

### 18.2 Error reporting (Sentry)
`@sentry/nextjs`, initialised once per runtime from `src/core/observability` (`server.ts`, `edge.ts`, `client.ts` through `src/instrumentation.ts` and `src/instrumentation-client.ts`), errors only: `tracesSampleRate: 0`, no replay, no profiling. With no DSN the SDK is disabled, which is the local and CI state. Source maps are uploaded only when the deploy workflow provides `SENTRY_AUTH_TOKEN`, and an upload failure never fails a deploy.

**Rule: error reports never carry money or personal data** (CLAUDE.md invariant 2).
- `sendDefaultPii: false` on every runtime; `includeLocalVariables: false` on the server, so stack frames never carry variables.
- Request bodies, form data, cookies, headers and query strings are never attached (`scrubEvent` drops `request.data`, `cookies`, `headers`, `query_string`) and every URL (request, fetch and navigation breadcrumbs) is reduced to origin + path.
- A user is identified by **member id only**: `Sentry.setUser({ id })` and nothing else (from 1.2). Name, email and IP fields are removed from the event; IP storage is switched off in the Sentry project itself (README → Deploying → Sentry), because Sentry would otherwise infer it from the connection.
- Any field whose key looks financial (`amount`, `value`, `billing`, `revenue`, `price`, `rate`, `fee`, `inr`, `money`) is replaced by `[scrubbed]` however deep it sits in `extra`, `contexts`, `tags` or breadcrumb data. Inside every string (messages, exception values, breadcrumbs) rupee amounts (`₹`, `Rs`, `INR`), email addresses and Indian phone numbers are replaced, keeping the rest of the text. Network breadcrumbs keep only method, status and path.
- The scrubber (`core/observability/scrub.ts`) is unit-tested and wired as `beforeSend` and `beforeBreadcrumb`; a new Sentry integration must go through it, not around it. When screens carry names in clickable labels (3.x), limit DOM breadcrumbs to `data-slot` (`breadcrumbsIntegration({ dom: { serializeAttribute } })`).

**Query strings carry ids, never values.** Workers Logs (`observability.enabled` in `wrangler.jsonc`) record every request URL including its query string, and so would any proxy. Filters, search text and amounts travel in the request body or in server-side state, never in the URL. `console.warn` / `console.error` land in Workers Logs too, so the same scrubbing rule applies to what the app logs.
