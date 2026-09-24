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
| **Money is sealed off** (ADR-0007) | Amounts live only in Owner-only tables and views. Nothing outside the `revenue` module can read them. |
| **IST everywhere** (ADR-0008) | Stored as UTC `timestamptz`. Business dates are computed in `Asia/Kolkata` in SQL (one helper) and in TS (one helper). |
| **Cheap SaaS seams, nothing more** | An `org_id` boundary, clean modules, an authorization layer, and storage and notification adapters. No multi-tenant features. |
| **Additive change** | Migrations and module APIs are only added to. Anything destructive goes through expand → migrate → contract. |

---

## 2. Tech stack (free tiers, ADR-0003)

| Need | Choice | Upgrade path |
|---|---|---|
| App | **Next.js (App Router) + TypeScript strict**, React Server Components, server actions | — |
| UI | Tailwind CSS + shadcn/ui, lucide icons, TanStack Query (client caches for live screens) | — |
| Database, Auth, Realtime, cron | **Supabase**, **free plan** (Postgres 15+, RLS, Realtime, `pg_cron`, `pg_net`). Free means: no Supabase backups, no leaked-password check, ~1 day of log retention, 500 MB database, 5 GB transfer/month (ADR-0003, amended 2026-09-23) | Pro ($25/mo) when transfer passes ~4 GB/month or the database ~400 MB |
| Files | **Cloudflare R2**, S3 multipart presigned uploads, behind `core/storage` | S3 / Supabase Storage (swap the adapter) |
| Hosting | **Cloudflare Workers** through the OpenNext adapter. **Workers Paid ($5/mo) since 2026-09-23**: the free plan's 10 ms CPU per request is not enough for a signed-in server-rendered page (staging measured ~25 ms and returned Error 1102). One subscription covers staging and production | Higher tiers, or any Node host |
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
  proxy.ts                   # Next 16 proxy: refreshes the session cookies, optimistic redirect only (ADR-0012)
  app/                       # routes only: thin pages composing module components
    (auth)/login, forgot-password, set-password   # signed-out screens (1.2); invite accept in 1.3
    auth/confirm, auth/signout                    # route handlers: token-hash links, ending an inactive session
    (gate)/attendance/       # the first-login-of-the-day choice screen
    (app)/today, my-day, approvals, clients/, tasks/, calendar, people/, reports/, settings/
    api/                     # webhooks, cron entry points (secret-protected), push subscribe
  core/                      # shared foundation, NO business features
    auth/                    # session (server.ts: getSessionState/getCurrentMember/requireMember),
                             #   actions (login/logout/setPassword/requestPasswordReset), paths,
                             #   schemas, links (verifyAuthLink), session (updateSession for the
                             #   proxy), components/ (the sign-in forms, Log out, IssueDayPass);
                             #   the day gate (2.2): day-gate.ts (pass), gate.ts (touch, requireDayGate)
    db/                      # Supabase clients (server, browser, service) + generated types
    permissions/             # key registry, can(), requirePermission() (pages), assertPermission() (actions), <Can>
    activity/                # activity feed UI + helper for non-workflow audit
    custom-fields/           # definitions, zod builder, <CustomFieldsForm>/<View>
    lists/                   # list_items engine (1.3): registry + schemas (index.ts), server.ts
                             #   (repository); reorder + archive callers arrive with Settings (1.4)
    storage/                 # StorageAdapter (R2), multipart presign, file metadata
    notifications/           # NotificationService, channels (push, email), <Bell>; email.ts + env.ts
                             #   (1.2): sendEmail() with a Resend sender and a log fallback
    time/                    # IST helpers: todayIST(), toISTDate(), istDayRange(), formatIST(),
                             #   isWorkingDay() (1.4, the mirror of app.is_working_day())
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
  seed.sql         # dev seed: org, Owner, sample admins/staff/clients, Pixora lists
e2e/               # Playwright
public/            # manifest.webmanifest, icons/, service worker (sw.js), _headers
scripts/           # one-off maintenance scripts (icon rendering, the Owner bootstrap)
wrangler.jsonc     # Workers: dev / staging / production (§18); open-next.config.ts beside it
```

### 3.1 Import rules (eslint-plugin-boundaries, task 0.4)
Enforced by `eslint.config.mjs`; `tests/lint-rules.test.ts` lints the fixture tree in `tests/lint-fixtures/` and fails if any rule stops firing (or fires on an allowed case).
- `app → modules (index only) → core`. `core` never imports modules. No cycles. Files directly under `src/` (`proxy.ts`, `instrumentation.ts`) follow the `app` rules, and every file under `src/` must belong to a known element.
- **`modules/*/domain` is platform-free** (ADR-0011): no `react`, `react-dom`, `next/*`, `server-only`, `client-only` or DOM globals, and from `core` only `time`, `errors` and `lib` (an allow-list in the config; extend it deliberately) plus **type-only** imports of `core/db` (`Tables<>`, `Enums<>` are plain data shapes).
- Nothing outside a module imports its `data/`, `actions/` or internal `components/`.
- **Only `data/` layers touch the database** (CLAUDE.md rule 3): `@supabase/supabase-js`, `@supabase/ssr` and `core/db`'s clients may be imported only from `src/modules/*/data/` and the core areas that own tables: `core/db`, `core/auth`, `core/activity`, `core/lists`, `core/custom-fields`, `core/notifications`, `core/storage`. Type-only imports are fine anywhere.
- **Only `modules/revenue` may import money types or query money tables and views.** Outside `modules/revenue` (and the generated types in `core/db`), any string or template literal containing `project_billing`, `item_billing`, `cycle_billing`, `revenue_overrides`, `revenue_by_client_month_v` or `revenue_by_cycle_v` as a whole word is a lint error, so `.from("…")`, `Tables<"…">` and an embedded select like `"*, project_billing(*)"` all fail. Identifiers aren't checked; RLS (pgTAP-tested) is the wall behind the lint. Other modules show money only by rendering `revenue`'s exported components, which render nothing for non-Owner users. (`projects.billing_category` is not money: it's an operational label Admins may see. Only the Owner can set it.)
- There is **no currency custom-field type**, so money can never leak in through `custom_fields`.
- **Route files and pages import client components from their own module file, never from a barrel that re-exports client components.** A barrel (`index.ts`) of client components is **not tree-shaken per route**: every client component it exports joins the bundle of any route that imports it, whether or not that route renders it. Measured in 1.5: `src/app/(auth)/login/page.tsx` imported `FormAlert` and `LoginForm` from `@/core/auth/components`, and the sign-in page therefore shipped `logout-confirm` too — **sonner plus radix-alert-dialog, 528 KB decompressed**, on a page with no toasts and no dialogs. Importing each form from its own file took `/login` from 18 requests and 1344 KB to 13 and 794 KB. A barrel is still the right thing for server-only helpers and types. **The enforcement is the first-load JS budget check in task 2.8** — this rule is invisible without a number, and an invisible rule is broken within a phase.

### 3.2 Module ownership
| Module | Owns | Depends on |
|---|---|---|
| team | members, role_permissions, session_events, job titles (list) | core |
| settings | org_settings, holidays, task_types, stage_presets, feature_flags, and the Settings screens for the editable lists (`core/lists` owns the table) | core |
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
These are implemented as **Postgres functions** (`security definer`, `set search_path = ''`) named `<module>_<verb>`, e.g. `task_submit_done(task_id, late_reason)`, `task_review(task_id, decision, reason)`, `attendance_decide(day_id, decision, status, reason)`, `item_approve(item_ids[])`.

Each function, in **one transaction**:
1. identifies the caller (`auth.uid()` → active member) and checks the permission key **and** the scope rule (e.g. "caller is this task's approving Admin");
2. locks the row (`select … for update`) and checks the current state allows the transition;
3. updates the row and child rows;
4. inserts the `activity_log` entry (and domain history rows such as `task_reviews` / `attendance_events`);
5. inserts `notifications` (+ `notification_deliveries` queued) for the recipients in WORKFLOWS §9;
6. returns the new state.

State columns can't be updated directly: RLS gives no update permission on them, plus a trigger guard. The same guard covers `projects.billing_category`, `projects.client_id` and `projects.recurrence`, which change only through Owner-only transition functions. Bulk actions call the function for each id inside one request and return per-id results.

### 4.2 Plain edits (names, descriptions, contacts, brand, custom fields, settings)
```ts
export const updateClient = action(async (input: unknown) => {
  const data = updateClientSchema.parse(input);                 // 1. zod
  await assertPermission('clients.edit_assigned');              // 2. early, friendly check (RLS is the real gate); pages use requirePermission()
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
- `current_member()` returns the caller's active member row. **Deactivated means no rows**, so access ends immediately. The app repeats the check (`requireMember()`, the login action) so a deactivated person's session is ended and they see why (ADR-0012).
- **Session events and the first Owner** are written by `security definer` functions in `public` (`session_login()`, `session_logout()`, `bootstrap_owner()`; DATA-MODEL §0a), never by a client insert. `bootstrap_owner()` is executable by `service_role` only. Every public function revokes EXECUTE from `anon` explicitly (Supabase grants it by default).
- `has_permission(key)` checks role → `role_permissions`. These helpers live in the `app` schema (`app.current_member()` etc.), so policies and functions call them qualified; TS never calls them directly.
- **Protected columns:** state columns (and the timestamps that move with them) carry `app.protect_columns('status', ...)`, a BEFORE UPDATE trigger that raises `FORBIDDEN` unless `app.in_transition()` is true. `in_transition()` is true whenever the statement runs as the function owner (a security definer function, a migration, a job) and false for the API roles, so a direct update from any client fails even for a role whose RLS allows it, and there is no flag a client could set. The protected columns also carry **no UPDATE privilege** for `authenticated` (column-level grants list the editable columns), so a client hits `42501` before the trigger. **The service client bypasses both** (RLS and `in_transition()` is true for `service_role`): jobs and scripts call transition functions for state columns and never update them directly.
- **Column-level UPDATE grants on every table the API edits** (phase 1 review, 2026-09-23): the migration that gives a table an UPDATE policy also runs `revoke update on <table> from authenticated` and `grant update (<editable columns>)`, so RLS decides *who* may update a row and the grant decides *which columns* (`members`, `organizations`, `org_settings`, `list_items`, `holidays` so far). Keys, `org_id`, `position`, `is_system`, `meta`, timestamps and every column a function owns stay out of PostgREST's reach. pgTAP asserts an allowed and a refused column per table (`06_phase1_review_hardening.test.sql`).
- `member_directory` is a `security definer` view (no email) through which Admins and Staff see other people (PERMISSIONS §2).
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
- SQL: `app.today_ist()`, `app.to_ist_date(ts)`, `app.is_working_day(date)` (weekly offs + holidays, 1.4).
- TS: `core/time`, the only place that formats or computes IST dates. Components never call `new Date()` for business logic.
- `pg_cron` runs in UTC, so jobs are scheduled at the UTC equivalent (23:59 IST = 18:29 UTC) and **re-check the IST date inside the job**.

## 7a. Sessions (task 1.2, ADR-0012)
- **Supabase Auth**, email + password, sign-ups off everywhere; people exist only through the bootstrap script (the Owner) and invites (1.3). Passwords: 12 characters minimum, no composition rule. Leaked-password protection is a Supabase **Pro** feature, so it is off while the project is on the free plan (ADR-0003); enable it at task 6.6 if production ever moves to Pro.
- **`src/proxy.ts`** runs `core/auth` `updateSession()` on every page request: refreshes the cookies and redirects from the JWT alone (no session → `/login?next=`; a session on the sign-in pages → `/`). Static assets, `sw.js` and the manifest are outside its matcher; `/offline`, `/auth/*`, `/api/*` and the sign-in pages pass through it without a session (`core/auth/paths.ts`). OpenNext bundles it as Node middleware.
- **Session cookies are `httpOnly`, `SameSite=Lax` and, on staging and production, `Secure`** (`core/db/cookies.ts`, passed as `cookieOptions` by both `createServerSupabase()` and the proxy). `@supabase/ssr` defaults to `httpOnly: false` for its browser client; MaxOff never uses that client, so a script on the page cannot read the refresh token. If a Client Component ever needs Supabase (Realtime in 5.1), hand it the access token from a server prop (`realtime.setAuth()`) instead of loosening the cookies.
- **`requireMember()`** in the `(app)` layout is the decision: `getSessionState()` (per request, `cache()`) verifies the JWT with `getClaims()`, reads the member row under RLS and answers `none` / `inactive` / `member`. `inactive` (missing, invited or deactivated) is ended through `/auth/signout` and lands on `/login?reason=inactive`. `requirePermission()` builds on it.
- **Auth links** (recovery and invite) land on `/auth/confirm?token_hash=…&type=…` and are verified server-side (`verifyOtp`), so they need no browser state and work from the bootstrap script's printed link or a copied invite link. A verified link opens a session, so `verifyAuthLink()` checks the member there (not active → signed out again, `/login?reason=inactive`) and records `session_login()` before sending the browser to `/set-password`. The one exception is an **invited** member opening an **invite** link (1.3, WORKFLOWS §1a): they reach `/set-password` without a login row, and `setPassword()` accepts the invite (`member_accept_invite()`), records the login and lands them on `/me?welcome=1`. The recovery template in `supabase/templates/` builds the URL and the hosted projects carry the same text (README → "Hosted auth settings"); invite links are built by the app (`modules/team`, ADR-0012 amendment) and mailed through `sendEmail()`, never by GoTrue. Links live 24 h (`otp_expiry`) and are one-time.
- **Deactivation** (`member_deactivate()`, 1.3) deletes the person's `auth.sessions` and `auth.refresh_tokens` in the same transaction as the status change, so an open tab cannot renew its session; RLS and `requireMember()` close everything else at once.
- **Login** = `signInWithPassword` → member must be active (else sign out again, `FORBIDDEN`) → `session_login()` → `Sentry.setUser({ id })` → redirect to a safe `next` or `/` (which routes to the role's home). **Logout** = `session_logout()` → `signOut({ scope: "local" })` (this device only) → `/login?reason=signed_out`.
- **Email from the app** goes through `core/notifications` `sendEmail()`: Resend when `RESEND_API_KEY` is set, otherwise a log sender that never throws; `instrumentation.ts` warns once at start-up (error level in production, still no crash). Supabase Auth's own emails don't use it. A verified sending domain is a prerequisite for 1.3 invites and 5.2 notification email.

## 8. The first-login day gate
- `(app)` layout → `core/auth` `requireDayGate()` → rpc `attendance_touch()`. This creates today's `attendance_days` row and a `session_events(login)` if needed, and returns whether a choice is still required.
- If a choice is required, redirect to `/(gate)/attendance`. The Owner is exempt. On a day off the gate still asks, marking `is_day_off`. On a day with approved leave (full or half) there's no gate: `attendance_touch()` creates the day from the leave (`derived_from_leave`) and still records `first_login_at` and the login event.
- `attendance_touch()` is idempotent and runs once per session per day (cached in a signed cookie holding the IST date).
- **As built (2.2):** `requireDayGate(member)` runs in the `(app)` layout right after `requireMember()`. **The Owner is skipped first**, from the member's loaded permissions (no `attendance.self`), before any cookie check or query. For everyone else a valid pass cookie `maxoff_day` (HMAC-SHA256 over member id + IST date with **`DAY_GATE_COOKIE_SECRET`**; the cookie holds only the date and the MAC; httpOnly, `SameSite=Lax`, `Secure` off local) means the day is settled and nothing is queried. Without one the layout calls `attendance_touch()` itself (same user agent / IP hash as `session_login()`): a day that needs a choice redirects to `/attendance?next=` (the `(gate)` group: no shell, its own Log out; `next` comes from the proxy's `x-maxoff-path` header and never points back at the gate); a settled day renders at once and the layout mounts `<IssueDayPass />`, which sets the pass through a server action that asks the database again (a layout cannot set cookies, and the action can never be used to skip the gate). The choice action sets the pass and redirects to `next` **with `replace`**, so the back gesture never returns to the gate. **Two traps met while building it:** the first design sent the browser through a `/day-gate` route handler to set the pass, which cost a redirect on every first load of the day and showed a blank page after sign-in in one probe (not isolated; dropping the hop removed both); and Next renders a layout and its page **in parallel**, so the attendance card cannot assume the layout's touch has opened the day: `touchToday()` is `cache()`d per request and the card awaits it when it finds no row, re-reading with an abort signal because Next memoizes identical GET fetches for the length of a request. **Missing secret:** no pass is ever set, so every signed-in page load calls `attendance_touch()`. Correct, but slower, and reported to Sentry once per server instance so it cannot go unnoticed (`local` builds stay quiet). **The gate is a screen, not an authorization rule:** it runs when the `(app)` layout renders, and other modules' actions do not check it (RLS and the transition functions are the authorization). A day that returns to `awaiting_choice` during the day (a leave cancelled today) keeps its pass; the attendance card on My Day / Today offers the choice again.

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
All calculation is in SQL views (WORKFLOWS §6) over Owner-only tables, so reports and exports share one definition. Overrides never replace the calculated value, they sit next to it. Money never leaves the app through error reporting either: §18 scrubs every financial field before an event reaches Sentry.

## 13. Reports and exports
- **EOD report:** built by a job into `eod_reports.data`. The page can also render a live version.
- **Month close:** `month_close(month)` builds the snapshot JSON in SQL and stores version 1. `month_correct(month, note)` stores version N+1.
- **Exports:** Markdown (AI-oriented: summary + dense tables with stable IDs and ISO timestamps), CSV (one file per dataset, zipped), PDF (summary). Generated on demand from the snapshot (closed months) or live views (open months). Owner only.

## 14. PWA and responsive design
`public/manifest.webmanifest`, icons (`public/icons/`, rendered from `icon.svg` by `scripts/generate-icons.mjs`) and a plain-JS service worker `public/sw.js` (task 0.5). The worker is a **minimal offline shell**: it precaches `/offline`, serves it when a navigation fails without a connection, caches hashed `/_next/static` and `/icons` assets cache-first, and never touches `/api`, non-GET requests or other origins, so Supabase and server actions are always live. It is registered by `<RegisterServiceWorker />` in the root layout **only in production builds** (`next dev` and Playwright never see it). Push handlers join the same file in 5.1 (ADR-0009). `src/core/ui/pwa/pwa-files.test.ts` keeps the manifest, icons, headers and worker consistent with the tokens. **Every screen is designed for the phone first** (PRODUCT §1, task 1.5): mobile is its own layout for every role, not a narrow desktop one, and the desktop layout is the second one the same data gets. §14.1 is the standard; the shell rules in `globals.css` and the composites are what every screen inherits.

### 14.1 Mobile standard (task 1.5)
Staff work from a phone, often one-handed, often outdoors. These are shell-level rules every screen inherits; a screen that breaks one is not done:
- **Safe areas.** `viewport-fit=cover` plus `env(safe-area-inset-*)` padding on the bottom nav, sticky action bars and any fixed element. Nothing sits under the notch or the home indicator.
- **No zoom on focus.** Every input, select and textarea is at least **16px**, or iOS Safari zooms the page when it's tapped and never zooms back.
- **Touch targets** are at least **44 × 44 px** with 8px between them. This includes icon buttons, table row actions and nav items.
- **Dialogs are bottom sheets below 768px** (top-anchored dialogs put the buttons out of thumb reach), with a drag handle and a visible close.
- **The primary action is reachable**: sticky at the bottom of the viewport on mobile forms, above the safe area, never hidden behind the keyboard.
- **Tables become cards below 768px.** `DataTable` renders a card list on mobile; horizontal scrolling inside a table is not acceptable.
- **Nothing is hover-only.** Row actions, tooltips and menus must be reachable by tap.
- **Scrolling feels native**: momentum scrolling, `overscroll-behavior: contain` on sheets and modals, no scroll chaining to the page behind.
- **One-handed reach**: destructive actions never sit next to the primary action in the thumb zone.
- Checked at **375px and 430px** (small and large phones) in both themes, and at least once a phase on a real device.

**Mobile is its own layout, not a narrow desktop one.** The patterns below are the shell's answer; a screen that renders its desktop structure at 390px is not done.
- **Bottom navigation for every role on mobile**, not only Staff. Four primary destinations by role plus **More** (a sheet with the rest, plus the profile, appearance and Log out). The sidebar takes over from `md` up; on a phone there is **no drawer at all**, because nobody should open one to reach a screen they use ten times a day. The split lives in `MOBILE_PRIMARY` / `MOBILE_MORE` in `core/ui/shell/nav.ts` and nowhere else.
- **Lists are cards, and a row opens a detail sheet.** A card shows what identifies the row (name, status, the one number that matters); everything else — email, dates, secondary fields — lives in the sheet, where the actions are too. No horizontal scrolling, no clipped columns, no hover-only row menus.
- **Compact page headers on mobile:** the title, and a subtitle only when it tells you something you can't see. Explanatory paragraphs move into the empty state or a help sheet. The first real content should be visible without scrolling.
- **The primary action is always reachable:** a sticky bottom bar (or a single FAB above the bottom nav), never a button at the top of a scrolled page.
- **Status reads at a glance**: a coloured dot plus a short word, not a full-width badge column.
- **Skeletons trace their own screen.** A loading state is a tracing of the content it replaces — same row height, same number of text lines, same column positions, same place for the status chip — so nothing moves when the data arrives. A generic avatar list standing in for a task list makes the app feel slower than it is, because the layout visibly swaps. `LoadingState` therefore takes a **shape** (`list`, `cards`, `tiles`, `detail`, `table`) and each route's `loading.tsx` passes the one matching its content; three to five items is enough, never a full screen of them. Respect `prefers-reduced-motion` (no shimmer), and for loads that are usually under ~300 ms prefer nothing at all over a flash of skeleton.
- **Installed behaves like an app, browser behaves like a website.** The back gesture closes an open overlay rather than navigating the page under it (`core/ui/overlay/overlay-history`, every dialog, sheet and alert, on every viewport — the gesture means the same thing everywhere). Top-level tabs additionally stop stacking up history when the app is **installed**: back from any tab returns to the role's home tab and back at home leaves the app (`core/ui/shell/tab-history`). That second rule is gated on `display-mode: standalone`, never on screen width, because a phone browser tab is still a web page and its back/forward must keep retracing steps. Detail routes inside a tab push normally, so back from a record returns to its list.
- **In-page view controls never add history, on any device** (the 2.3 fix, found on an installed phone: switching /leave's tabs three times took three backs to leave it). Tabs, segments, pagers, month and date switchers and filters change the view of the page you are on, not the page: they keep the URL in sync **with `replace`** (so a refresh or a shared link keeps the place), and one back always leaves the page to wherever the member came from. The shared way is **`ViewLink`** (`core/ui/composites/view-link.tsx`: a `Link` with `replace`, whose tapped control shows its pending state at once through `useLinkStatus`: text dims and pulses, an icon becomes a same-size spinner); tabs also pass `scroll={false}`. A router call uses `router.replace`, a client-side `redirect()` passes `RedirectType.replace`. `view-links.test.ts` sweeps the source for a query-building `<Link>`, a tab or pager array feeding `<Link>`, `router.push` with a query, and a client redirect with a query; a query link that really goes to **another** page is marked `view-link: navigation`.
- **Overlays come only from `core/ui/primitives`** (`Sheet`, `Dialog`, `AlertDialog`), whose roots register with the back controller. ESLint refuses `radix-ui` and `@radix-ui/*` anywhere else (`no-restricted-imports`, fixtures in `tests/lint-fixtures`), on top of `overlay-registration.test.ts`.
- **Editing is explicit: read-only by default, explicit edit, explicit save, confirm what changed, guard unsaved work.** A screen that shows someone's own identity — or any record — renders as plain values with a **pencil Edit** affordance (icon plus label, 44px). Edit mode puts **Save and Cancel in a sticky bar**, with Save disabled until something actually changed. The confirmation names the change ("Your name will change from X to Y"), never a generic "Are you sure?". Leaving with unsaved changes warns first, **including the back gesture**, which is history-aware. Saving gives clear "Saved" feedback. Live fields that save silently are wrong here: changes to identity and records should feel deliberate. **Built once as a shared component (task 2.9) and copied, not reinvented per screen** — the client screens in 3.4 are the first consumers.
- **Density follows the device.** Desktop may show a dense table of 50 rows; mobile shows 10 cards with a clear next step. They are allowed to be different screens, built from the same data, rather than one screen bent to fit.

## 15. Testing
| Layer | Tool | Required for |
|---|---|---|
| Domain logic | Vitest | every function in `domain/` (e.g. approval-route resolution, revenue allocation mirror, reminder schedule expansion) |
| Database | pgTAP | every table's RLS for each role; **every transition function**: allowed path, wrong state, wrong actor, missing reason, audit row written |
| Jobs | pgTAP | idempotency (running twice creates nothing new), IST boundaries, working-day logic |
| Flows | Playwright | login + day gate, assign → acknowledge → done → admin → Owner, rejection loop, leave request → decision, cycle generation → tick → approve, Owner bulk approve |
| CI | GitHub Actions | three jobs on every push and PR (`.github/workflows/ci.yml`): `typecheck · lint · format · unit · build` (the build is the **OpenNext Worker build**, so a change the Workers runtime can't take fails before merge), `pgTAP` (Postgres-only local stack) and `playwright` (Chromium). Red never merges: branch protection on `main` requires all three (README) |

Locally, `pnpm check` = typecheck + lint + format:check + unit tests + pgTAP + build (needs Docker and `pnpm db:start`). Playwright is deliberately outside `check`: `pnpm test:e2e` runs it on demand and `/finish-task` runs it whenever a flow changed. Every Playwright project runs against **`next start` of a fresh build** on its own port (never a reused server): a `setup` project signs in as the seeded local users (`supabase/seed.sql`, README → "Local sign-ins") through the real form and saves one storage state per role for the `desktop` and `mobile` projects; the **`production` project** (`e2e/production.spec.ts`) proves the build is locked down (every shell route redirects to `/login`, no trace of the deleted development shims, the service worker registers). The local Supabase stack must be up and reset first; CI starts it in the Playwright job and points the build at its keys.

## 16. Recipe for adding a feature
1. `/add-feature` → `docs/features/<name>.md` (+ an ADR if a pattern changes).
2. Update DATA-MODEL, WORKFLOWS and PERMISSIONS first.
3. New module folder, migration (tables + RLS + transition functions + seeded permissions), feature flag off by default.
4. Build and test. Existing tables are only **added to**.
5. Other modules' screens are extended only through the **extension slots** their `index.ts` exposes (tabs, panels, dashboard cards).

## 17. Backups
**On the free plan Supabase keeps no backups, so this is the only safety net — it is not optional (ADR-0003).**
Nightly `pg_dump` GitHub Action → encrypted → private R2 bucket (30-day retention). R2 object versioning or retention on the files bucket. A restore drill before launch, then every quarter. Owner CSV exports as a secondary copy.

## 18. Deployment and observability (task 0.5, ADR-0003)

### 18.1 Environments
| | Local | Staging | Production |
|---|---|---|---|
| App | `next dev` | Worker `maxoff-staging` (`*.workers.dev`, free plan) | Worker `maxoff` (Workers Paid from the pilot, custom domain at 6.6) |
| Database | Supabase in Docker | free Supabase project `maxoff-staging` (Mumbai) | separate Supabase project |
| Deployed by | — | `.github/workflows/deploy.yml`, when **CI has passed on `main`** (`workflow_run`) | the same workflow, on a `v*` tag that points at a commit **on `main` with all three CI checks green** (the job reads the commit's check runs; CI itself never runs on tags) |
| Values from | `.env.local` | GitHub environment `staging` | GitHub environment `production` |
| Sentry | off (no DSN) | `environment: staging` | `environment: production` |

Real data never goes on local or staging. Each deploy job first builds the Worker with OpenNext (`pnpm build:worker`), then applies the append-only migrations (`supabase link` + `supabase db push`), then deploys with `wrangler deploy --env <name>`, so a failed build never leaves the schema ahead of the Worker still serving; runtime secrets (`SUPABASE_SECRET_KEY`) are uploaded as Worker secrets, never bundled. The exact secret and variable names, and where each comes from, are in README → "Deploying".

**Env handling.** `NEXT_PUBLIC_*` values are inlined by `next build`, so they must exist at **build** time (GitHub environment *variables*); everything else is read at runtime from Worker secrets or `.env.local`. Readers live next to their area and validate with zod on first use: `core/db/env*.ts` (Supabase), `core/observability/env.ts` (`NEXT_PUBLIC_APP_ENV`, `NEXT_PUBLIC_SENTRY_DSN`). Every variable is documented in `.env.example` by the task that introduces it. `wrangler.jsonc` holds no `vars`: it only names the Workers, their bindings and compatibility flags (`nodejs_compat`, required by both OpenNext and Sentry).

**Windows.** `next build` runs anywhere, but the OpenNext bundling step cannot read pnpm's junction folders on Windows, so `pnpm build:worker` and `pnpm preview` run in CI, in the deploy workflow, or locally under WSL.

**Branch previews (task 2.0).** A fourth path that deploys nothing. `.github/workflows/preview.yml` builds every push to a non-`main` branch (docs-only paths excluded) and runs `wrangler versions upload --env staging`, which uploads a Worker **version** without promoting it: the `maxoff-staging` deployment keeps serving `main`, and routes, custom domains and cron triggers are untouched. Each push produces three URLs — `latest-maxoff-staging.<subdomain>.workers.dev` (rolling, any branch), `<branch>-maxoff-staging.…` and `<version-prefix>-maxoff-staging.…` — posted to the job summary and to one PR comment edited in place. An alias is a `workers/alias` annotation written at upload time and a version carries exactly one, so the same bundle is uploaded twice per push, once per alias. Previews build with `NEXT_PUBLIC_APP_ENV=staging`, so they inherit the staging security headers and `robots.txt` (§18.3) by construction; Cloudflare's preview edge additionally replaces `X-Robots-Tag` with its own `noindex` on every preview response, so a preview cannot be indexed even if a build lost the header, and they reuse the `staging` GitHub environment's variables and Worker secrets (wrangler uploads with `keepSecrets: true`; the workflow never runs `wrangler secret put`, which would publish a deployment). **Previews never run migrations** — that stays with `main` and tags, plus a manual `staging-migrations` job sharing the `deploy-staging` concurrency group — so a branch that adds a migration previews against a staging database without it, and the PR comment says so. `preview_urls` is stated in `wrangler.jsonc`: **`true` on staging, `false` on production**, so no production version is ever served at a public unlisted URL.

### 18.2 Error reporting (Sentry)
`@sentry/nextjs`, initialised once per runtime from `src/core/observability` (`server.ts`, `edge.ts`, `client.ts` through `src/instrumentation.ts` and `src/instrumentation-client.ts`), errors only: `tracesSampleRate: 0`, no replay, no profiling. **On the Worker, the server runtime drops the Node SDK's `ContextLines`, `Modules`, `LocalVariablesAsync` and `Context` integrations** (`WORKER_UNSAFE_INTEGRATIONS` in `server.ts`): they read the filesystem or attach the inspector, which never answers under `nodejs_compat`, so event processing stalled to the 2 s flush timeout and every error was lost while client reports still arrived (proved on staging, 2026-09-22; with them gone the flush takes ~400 ms). The server and edge runtimes also send with `core/observability/transport.ts` (platform `fetch`, what `@sentry/cloudflare` uses). Never set `debug: true` in a committed build: the SDK logger prints the raw, unscrubbed event message to Workers Logs. With no DSN the SDK is disabled, which is the local and CI state. Source maps are uploaded only when the deploy workflow provides `SENTRY_AUTH_TOKEN`, and an upload failure never fails a deploy.

**Rule: error reports never carry money or personal data** (CLAUDE.md invariant 2).
- `sendDefaultPii: false` on every runtime; `includeLocalVariables: false` on the server, so stack frames never carry variables.
- Request bodies, form data, cookies, headers and query strings are never attached (`scrubEvent` drops `request.data`, `cookies`, `headers`, `query_string`) and every URL (request, fetch and navigation breadcrumbs, and any `url` / `href` / `from` / `to` / `request_path` key in contexts, extra or tags, including the `request_path` that `@sentry/nextjs` puts in `contexts.nextjs`) is reduced to origin + path.
- A user is identified by **member id only**: `core/observability` `setSentryUser(id)` is called by `core/auth` on every request that resolves a member (server) and by `<SentryUser>` in the app layout (browser), and cleared on sign-out. `scrubEvent` reduces `user` to `{ id }`, which also drops the **country Sentry infers from the connecting IP** (`user.geo`), even with IP storage switched off in the Sentry project (README → Deploying → Sentry).
- Any field whose key looks financial (`amount`, `value`, `billing`, `revenue`, `price`, `rate`, `fee`, `inr`, `money`) is replaced by `[scrubbed]` however deep it sits in `extra`, `contexts`, `tags` or breadcrumb data. Inside every string (messages, exception values, breadcrumbs) rupee amounts (`₹`, `Rs`, `INR`), email addresses and Indian phone numbers are replaced, keeping the rest of the text. Network breadcrumbs keep only method, status and path.
- The scrubber (`core/observability/scrub.ts`) is unit-tested and wired as `beforeSend` and `beforeBreadcrumb`; a new Sentry integration must go through it, not around it. When screens carry names in clickable labels (3.x), limit DOM breadcrumbs to `data-slot` (`breadcrumbsIntegration({ dom: { serializeAttribute } })`).

**What reports.** Uncaught server errors go through `onRequestError` (`instrumentation.ts`); `global-error.tsx`, `app/error.tsx` and `app/(app)/error.tsx` call `captureException` themselves because Next does not forward errors caught by an explicit boundary to the SDK's global handlers; and `core/errors` `action()` reports every unexpected (INTERNAL) throw through `core/observability/capture` and logs **only the code and the Sentry event id**. The raw cause never reaches Workers Logs (a PostgREST error can quote the failing row); in `next dev` it is printed to the developer's terminal as well. **`GET /diagnostics/sentry`** (staging builds only, 404 elsewhere) throws a deliberate error carrying fake money and contact values so the whole pipeline can be confirmed after a deploy (README → "Confirming the Sentry pipeline").

**Query strings carry ids, never values.** Workers Logs (`observability.enabled` in `wrangler.jsonc`) record every request URL including its query string, and so would any proxy. Filters, search text and amounts travel in the request body or in server-side state, never in the URL. `console.warn` / `console.error` land in Workers Logs too, so the same scrubbing rule applies to what the app logs.

### 18.3 Security headers
`next.config.ts` (`headers()`) puts the list from `core/http/response-headers.ts` on every rendered response: `X-Frame-Options: DENY` and `Content-Security-Policy: frame-ancestors 'none'` (the app is never embedded), `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, a `Permissions-Policy` that denies camera, microphone and geolocation, and HSTS for two years with subdomains. **Staging is never indexed:** builds with `NEXT_PUBLIC_APP_ENV=staging` also send `X-Robots-Tag: noindex, nofollow` and serve `/robots.txt` with `Disallow: /` (`src/app/robots.txt/route.ts`); production and local send neither, so production stays indexable-by-choice until that is decided. Static assets get their cache headers from `public/_headers`. `e2e/production.spec.ts` asserts the exact values, and the absence of the robots rules, against a real build. A full CSP with script sources is deferred until the app has its final set of inline scripts (Next, next-themes); when it arrives, add it here and in that spec.
