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
| Hosting | **Cloudflare Workers** through the OpenNext adapter | Workers Paid |
| Push | **Web Push (VAPID) + service worker**, behind `core/notifications` | FCM/APNs adapter for a future mobile app |
| Email | **Resend** (Supabase Auth SMTP + notification fallback) | Any SMTP |
| PDF export | `@react-pdf/renderer` (server) | — |
| Monitoring | Sentry, UptimeRobot | Paid plans |
| CI, backups | GitHub Actions | — |
| Tests | Vitest, Playwright, **pgTAP** | — |
| Libraries | zod, react-hook-form, date-fns + date-fns-tz, dnd-kit, fractional-indexing, eslint-plugin-boundaries, DOMPurify, web-push | — |

**Environments:** Local (Supabase in Docker) · Staging (free Supabase project + Worker, deployed from `main`) · Production (separate project + Worker, deployed from a tag). Real data never goes on local or staging.

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
    time/                    # IST helpers: todayIST(), toIST(), isWorkingDay()
    realtime/                # useRealtimeInvalidate(table, filter) → TanStack Query invalidation
    errors/                  # AppError, Result<T>, action() wrapper, Postgres error mapping
    ui/                      # design system + composites (DataTable, EmptyState, PageHeader,
                             #   ConfirmDialog, ReasonDialog, BulkBar, FileDrop, StatusBadge)
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
public/            # manifest.webmanifest, icons, service worker (sw.js)
```

### 3.1 Import rules (eslint-plugin-boundaries)
- `app → modules (index only) → core`. `core` never imports modules. No cycles.
- Nothing outside a module imports its `data/`, `actions/` or internal `components/`.
- **Only `modules/revenue` may import money types or query money tables and views.** Other modules show money only by rendering `revenue`'s exported components, which render nothing for non-CEO users.

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

State columns can't be updated directly: RLS gives no update permission on them, plus a trigger guard. Bulk actions call the function for each id inside one request and return per-id results.

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
`action()` catches `AppError`, zod errors and Postgres errors. Transition functions raise `P0001` with codes such as `INVALID_STATE`, `FORBIDDEN` and `REASON_REQUIRED`, which are mapped to friendly messages. Actions return `{ ok: false, error: { code, message, fieldErrors } }` and never throw raw database errors to the UI.

---

## 5. Authorization in the database
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
- If a choice is required, redirect to `/(gate)/attendance`. The CEO is exempt. On a day off the gate still asks, marking `is_day_off`.
- `attendance_touch()` is idempotent and runs once per session per day (cached in a signed cookie holding the IST date).

## 9. Notifications (ADR-0009)
```
transition fn / job ─► notifications row ─► notification_deliveries (queued)
                                   │                       │
                        Realtime ─► in-app bell     push_dispatch (Worker cron / pg_net)
                                                           ├─ Web Push (VAPID) to each subscription
                                                           └─ Email (Resend) if no working push, or escalation
```
- `NotificationService` (TS) has channel adapters `PushChannel` and `EmailChannel`. A future `FcmChannel` or `WhatsAppChannel` plugs in without touching business code.
- Users can't mute anything. The app asks for push permission after login and keeps nudging (not blocking) until it's granted. In-app notifications always work.
- Delivery is idempotent (unique per notification + channel), retried with backoff, and a subscription is disabled after repeated `410 Gone` responses.

## 10. Real time
`core/realtime` subscribes to Supabase Realtime `postgres_changes` (RLS-filtered) for: `tasks`, `task_assignees`, `task_comments`, `attendance_days`, `leave_requests`, `project_items`, `notifications`. On a change it **invalidates** TanStack Query keys and never trusts the payload for display, so RLS stays the source of truth.

## 11. Files (ADR-0003)
- **Upload:** action `files_begin_upload(meta)` checks permission, type and size (≤ 2 GB), creates a `files` row (`pending`) and returns presigned **multipart** URLs. The browser uploads parts straight to R2 (resumable, retried per part), then calls `files_complete_upload`, which marks it `ready`.
- **Download or preview:** permission check → presigned GET, valid 5 minutes. Buckets are private.
- SVGs are sanitized on completion, and SVG and HTML are never served inline.
- Orphaned `pending` files are cleaned up by a daily job.

## 12. Revenue (ADR-0007)
All calculation is in SQL views (WORKFLOWS §6) over CEO-only tables, so reports and exports share one definition. Overrides never replace the calculated value, they sit next to it.

## 13. Reports and exports
- **EOD report:** built by a job into `eod_reports.data`. The page can also render a live version.
- **Month close:** `month_close(month)` builds the snapshot JSON in SQL and stores version 1. `month_correct(month, note)` stores version N+1.
- **Exports:** Markdown (AI-oriented: summary + dense tables with stable IDs and ISO timestamps), CSV (one file per dataset, zipped), PDF (summary). Generated on demand from the snapshot (closed months) or live views (open months). CEO only.

## 14. PWA and responsive design
`manifest.webmanifest`, icons and a service worker (push + a minimal offline shell). Staff screens are designed mobile-first. CEO and Admin screens are desktop-first and still usable from 375px.

## 15. Testing
| Layer | Tool | Required for |
|---|---|---|
| Domain logic | Vitest | every function in `domain/` (e.g. approval-route resolution, revenue allocation mirror, reminder schedule expansion) |
| Database | pgTAP | every table's RLS for each role; **every transition function**: allowed path, wrong state, wrong actor, missing reason, audit row written |
| Jobs | pgTAP | idempotency (running twice creates nothing new), IST boundaries, working-day logic |
| Flows | Playwright | login + day gate, assign → acknowledge → done → admin → CEO, rejection loop, leave request → decision, cycle generation → tick → approve, CEO bulk approve |
| CI | GitHub Actions | `pnpm check` + pgTAP + e2e on every push. Red never merges |

## 16. Recipe for adding a feature
1. `/add-feature` → `docs/features/<name>.md` (+ an ADR if a pattern changes).
2. Update DATA-MODEL, WORKFLOWS and PERMISSIONS first.
3. New module folder, migration (tables + RLS + transition functions + seeded permissions), feature flag off by default.
4. Build and test. Existing tables are only **added to**.
5. Other modules' screens are extended only through the **extension slots** their `index.ts` exposes (tabs, panels, dashboard cards).

## 17. Backups
Nightly `pg_dump` GitHub Action → encrypted → private R2 bucket (30-day retention). R2 object versioning or retention on the files bucket. A restore drill before launch, then every quarter. CEO CSV exports as a secondary copy.
