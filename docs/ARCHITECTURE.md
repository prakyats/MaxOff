# MaxOff Architecture

> This is the single source of truth for **how** MaxOff is built. `PRODUCT.md` covers **what** it does.
> A change to any pattern here needs an ADR in `docs/decisions/`.

---

## 1. Principles

| Principle | What it means in MaxOff |
|---|---|
| **Customization is data** | Business vocabulary (services, phases, statuses, deliverable types, fields, templates) lives in tables and is edited in Settings, not in code. Code only relies on a small set of fixed **categories** (e.g. a status's category is `todo`, `active` or `done`). |
| **Modular monolith** | One app, one database, and strictly separated modules. It's as simple to run as a monolith, and each module can grow or be replaced on its own. |
| **Dependencies point one way** | `app → modules → core`. Modules use each other only through their public `index.ts`. |
| **Security in depth** | Row-Level Security in Postgres is the real gate. Server actions check permissions again, and the UI only hides what a person can't use. |
| **Open for extension** | New features are new modules, tables and permission keys. Existing modules shouldn't need editing to add one. |
| **Additive change** | Migrations and APIs are only ever added to. Anything destructive goes through expand → migrate → contract. |
| **Every layer is testable** | Pure domain logic gets unit tests, RLS gets pgTAP tests, and user flows get Playwright tests. |
| **Free today, paid later without rewrites** | Every outside service sits behind an adapter or a standard protocol (S3, SMTP, Postgres), so it can be swapped. |

---

## 2. Tech stack (all on free tiers)

| Need | Choice | Free tier | Upgrade path |
|---|---|---|---|
| Framework | **Next.js (App Router) + TypeScript (strict)** | — | — |
| UI | **Tailwind CSS + shadcn/ui**, lucide icons | — | — |
| Database + Auth | **Supabase** (Postgres, Auth, Realtime, pg_cron) | 500 MB database, 50k users. Pauses after 7 days with no activity | Pro ($25/mo) adds daily backups, no pausing and more space |
| File storage | **Cloudflare R2**, behind `core/storage` | 10 GB storage, **no download (egress) fees** | Pay per GB. S3-compatible, so it can be swapped for S3 or Supabase Storage |
| Hosting | **Cloudflare Workers** (Next.js via the OpenNext adapter) | 100k requests/day, **commercial use allowed** | Workers Paid ($5/mo). *Vercel's free Hobby plan is for non-commercial use only, which is why it isn't used here.* |
| Email (invites, notifications) | **Resend**, set up as Supabase's SMTP | 3,000 emails/mo | Paid plan. Any SMTP provider works |
| Error monitoring | **Sentry** | 5k errors/mo | Paid plan |
| Uptime check | **UptimeRobot** | 50 monitors | — |
| Code + CI | **GitHub** private repo + **GitHub Actions** | 2,000 CI minutes/mo | — |
| Local development | **Supabase CLI + Docker Desktop** | Free | — |
| Tests | **Vitest** (unit), **Playwright** (end-to-end), **pgTAP** (database/RLS) | Free | — |
| Other libraries | zod, react-hook-form, TanStack Query, dnd-kit, date-fns, JSZip, fractional-indexing, eslint-plugin-boundaries | Free | — |

**Environments:**
- **Local:** Supabase running in Docker, used for all development.
- **Staging:** a free Supabase project + a Cloudflare Worker, deployed from `main`.
- **Production:** a second free Supabase project + a Worker, deployed from a git tag.

Real Pixora data never goes on local or staging.

---

## 3. Code structure

```
src/
  app/                          # Routes only: thin pages that put module components together
    (auth)/login, invite/...
    (app)/dashboard, clients/, projects/, templates/, team/, settings/
    api/                        # Only for webhooks and file endpoints. Mutations use server actions
  core/                         # Shared foundation. Contains NO business features
    auth/                       # session, getCurrentMember(), route guards
    db/                         # Supabase clients (server, browser, service role) + generated types
    permissions/                # permission key registry, can(), requirePermission(), <Can>
    activity/                   # recordActivity(), activity feed components
    custom-fields/              # field definitions, zod builder, <CustomFieldsForm>, <CustomFieldsView>
    lists/                      # generic editable-list engine (services, deliverable types, categories...)
    storage/                    # StorageAdapter interface + R2 adapter, upload/download helpers
    flags/                      # isEnabled(flag)
    notifications/              # (phase 8) createNotification(), bell UI
    errors/                     # AppError, Result<T>, error-to-message mapping
    ui/                         # design system: shadcn components + shared composites
                                #   (DataTable, EmptyState, PageHeader, ConfirmDialog, FileDrop...)
    lib/                        # small pure helpers (dates, formatting, ids)
  modules/
    team/  clients/  brand-kit/  deliverables/  projects/  templates/  dashboard/
      index.ts                  # PUBLIC API: the only file other code may import from
      domain/                   # types, zod schemas, pure business logic (unit-tested)
      data/                     # repository: ALL database access for this module
      actions/                  # server actions (the mutation pattern, see §5)
      components/               # this module's UI
      permissions.ts            # the permission keys this module owns
      tests/
supabase/
  migrations/                   # append-only SQL migrations
  tests/                        # pgTAP tests (RLS and database functions)
  seed.sql                      # local/dev seed data (Pixora defaults + fake data)
e2e/                            # Playwright tests
docs/                           # PRODUCT, ARCHITECTURE, ROADMAP, PROGRESS, decisions/, features/
```

### Import rules (enforced by eslint-plugin-boundaries)
| From → To | Allowed? |
|---|---|
| `app` → `modules/*` (index only), `core/*` | ✅ |
| `modules/A` → `modules/B` (only through `@/modules/B`) | ✅ Read-only use: queries and display components. Never another module's `data/` |
| `modules/*` → `core/*` | ✅ |
| `core/*` → `modules/*` | ❌ |
| anything → `modules/X/data`, `/actions`, `/components/*` directly (from outside X) | ❌ |
| a cycle between modules | ❌ |

**Module ownership and allowed dependencies:**

| Module | Owns tables | May depend on |
|---|---|---|
| team | members, roles, role_permissions, job_titles | core |
| clients | clients, client_contacts, client_services | team |
| brand-kit | client_brand, brand_colors, brand_fonts, brand_assets | clients |
| deliverables | client_deliverables (and uses the lists engine for deliverable types) | clients |
| projects | projects, project_members, project_phases, project_statuses, tasks, task_comments, task_attachments | clients, brand-kit (panel), deliverables, team |
| templates | project_templates, template_phases, template_statuses, template_tasks | projects, deliverables, clients, team |
| dashboard | — (read-only views) | any module's index |

Core owns: app_settings, feature_flags, activity_log, field_definitions, list_items, files, notifications.

---

## 4. Customization engine

This is how "every client is different" is handled without changing code.

### 4.1 Editable lists (`core/lists`)
There's one generic table for simple vocabularies that admins edit in **Settings → Lists**:

```
list_items   id, list_key, name, description, color, icon, position,
             meta jsonb, is_system bool, archived_at
             -- list_key: 'service' | 'deliverable_type' | 'asset_category' |
             --           'client_tag' | 'industry' | 'platform' | ...
```
- To add a new list, add a key to the registry in `core/lists/registry.ts`. No migration is needed.
- If a list later needs real columns of its own, it gets promoted to its own table. That requires an ADR.
- Items are archived, never deleted, so old records keep their meaning.

### 4.2 Custom fields (`core/custom-fields`)
```
field_definitions  id, entity ('client'|'contact'|'brand'|'project'|'task'|'client_deliverable'),
                   client_id (nullable: a field that exists for ONE client only),
                   key, label, help_text, type, options jsonb, required,
                   section, position, archived_at
field types:       text | long_text | number | currency | date | checkbox | select |
                   multi_select | url | email | phone | color | member | file | rating
```
- Every entity that supports custom fields has a `custom_fields jsonb not null default '{}'` column.
- On the server, `buildCustomFieldsSchema(entity, clientId)` builds a zod schema from the active definitions and validates values on every write.
- On the client, `<CustomFieldsForm>` and `<CustomFieldsView>` render any definition, so modules never write per-field UI.
- If a definition is archived, its value stays stored and hidden, and it can be restored.
- Filtering and sorting on custom fields use jsonb operators, and a GIN index is added when needed.

### 4.3 Configurable workflows (projects)
Nothing about how work flows is fixed:
- **Statuses** (the board columns) belong to each project in `project_statuses`: `name, color, position, category (todo|active|done)`. Code only looks at `category`, e.g. to calculate progress or decide what counts as done.
- **Phases** (optional groups such as Understand → Optimize, "Week 1–4" or "Pre-production / Production") are in `project_phases`: `name, position, is_gate`. A project can have **no phases** at all.
- **Gates:** if a project has `enforce_gates = true`, starting a task in a later phase while an earlier **gate** phase is unfinished shows a warning. It's turned off by default, and Pixora's framework template turns it on.
- **Templates** hold statuses, phases and tasks, and can be **global** or **for one client** (`client_id`). Creating a project from a template **copies** that structure, so editing the project never changes the template, and editing the template never changes existing projects.

### 4.4 Client-specific configuration
Each client can have its own:
- services, with a scope note and dates for each
- requirements (free text) and custom fields, including fields that exist only for that client
- a Brand Kit, with custom brand fields
- **recurring deliverables** (type, quantity, frequency, platform and specs), which templates can turn into tasks automatically
- client-specific templates, which describe that client's own monthly workflow

### 4.5 Permissions as data
```
roles             key, name, is_system       -- owner, admin, member (seeded)
role_permissions  role_key, permission       -- e.g. 'clients.edit', 'templates.manage'
```
- Permission keys are defined in code, in each module's `permissions.ts`, and collected in a registry. A migration seeds the defaults for each role.
- In SQL, `has_permission(key)` checks the calling user's active membership and role. In TypeScript, `can(member, key)` does the same.
- **Custom roles later** (e.g. "Editor", "Ads Specialist") only need new data plus a settings screen. No code in other modules changes.
- Project-level access is decided by `project_members` combined with a permission such as `projects.view_all`.

### 4.6 Feature flags
`feature_flags (key, enabled, description)` and `isEnabled('leads')`. A new module is released behind a flag, so half-finished features never disturb daily use.

---

## 5. Request and mutation pattern

```ts
// modules/clients/actions/update-client.ts
export const updateClient = action(async (input: unknown) => {
  const data = updateClientSchema.parse(input);             // 1. validate (zod)
  const me = await requirePermission('clients.edit');       // 2. authorize (throws AppError)
  const fields = await validateCustomFields('client', data.customFields, data.id); // 3. custom fields
  const client = await clientsRepo.update(data.id, { ...data, customFields: fields }); // 4. persist
  await recordActivity({ actor: me.id, entity: 'client', entityId: client.id, action: 'updated', diff }); // 5. audit
  revalidatePath(`/clients/${client.id}`);                  // 6. refresh
  return ok(client);                                        // 7. Result<T>
});
```
- `action()` catches `AppError` and zod errors and returns `{ ok: false, error: { code, message, fieldErrors } }`. It never throws raw database errors to the UI.
- Reads happen in Server Components through repositories. Pages that need live updates (the board) use TanStack Query with Supabase Realtime.
- Operations across several tables that must all succeed together (e.g. creating a project from a template) are **Postgres functions** called through RPC, so they run in one transaction.

---

## 6. Database conventions
- `id uuid primary key default gen_random_uuid()`, `created_at`, `updated_at` (kept current by a trigger) and `created_by` on every business table.
- Business records use `archived_at timestamptz` instead of being deleted. Queries filter out archived rows by default.
- Enums are used **only** for categories code depends on (role system keys, status categories, field types). Everything else is a list item or a table.
- **RLS on every table**, with a policy per operation that uses `is_active_member()` / `has_permission()`, and pgTAP tests for each.
- Foreign keys always have indexes, and every column that's filtered or sorted on has one too.
- Ordering (the board, lists) uses **fractional indexing** strings, so moving one item never renumbers the others.
- `activity_log (actor_id, entity, entity_id, action, diff jsonb, created_at)` is the audit trail, and later features can also use it as an event feed.
- Migration names: `YYYYMMDDHHMMSS_<module>_<change>.sql`, e.g. `..._clients_add_contacts.sql`.

## 7. Files (`core/storage`)
- `files (id, storage_key, name, mime, size, uploaded_by, entity, entity_id, created_at)` is the single table of file metadata.
- **Upload:** the server action checks permission, type and size, then returns a presigned PUT URL. The browser uploads straight to R2 and then confirms, which saves the `files` row.
- **Download:** the server checks permission and returns a presigned GET URL that expires after 5 minutes. Buckets are never public.
- SVGs are sanitized on upload (DOMPurify) and shown only with `<img>`.
- Size limits come from config: images and documents 25 MB, video and audio 500 MB (uploaded in parts). Storage use is shown in Settings.

## 8. Errors, logging and monitoring
- `AppError` codes: `UNAUTHENTICATED`, `FORBIDDEN`, `NOT_FOUND`, `VALIDATION`, `CONFLICT`, `RATE_LIMITED`, `INTERNAL`. Each maps to a message users can understand.
- Sentry is set up on the server and in the browser, and user identity sent to it is limited to the member id.
- Every route group has an error boundary, and there are proper 404 and 403 pages.

## 9. Testing strategy
| Layer | Tool | Required for |
|---|---|---|
| Domain logic | Vitest | every function in `domain/` |
| Database | pgTAP (`pnpm db:test`) | every table (RLS allowed and denied, per role) and every database function |
| User flows | Playwright | each main flow: log in, invite, create client, upload logo, create project from template, move task |
| CI | GitHub Actions | `pnpm check` + database tests on every push. Nothing is merged when it's red |

## 10. Recipe for adding a new feature (so nothing existing breaks)
1. Write `docs/features/<feature>.md` (what it does and why) and, if a new pattern is needed, an ADR.
2. Add tasks to `docs/ROADMAP.md`.
3. Create `src/modules/<feature>/` with the standard folders and `index.ts`.
4. Add a migration with the new tables, RLS, indexes and seeded permissions for each role. **Existing tables are only added to**, e.g. a nullable foreign key.
5. Register permission keys and a feature flag, turned off by default.
6. Build it and test it (pgTAP + unit + e2e).
7. Add navigation behind `isEnabled(flag)` and turn it on in staging, then production.
8. Adding to another module's screen goes through an **extension slot**: that module's `index.ts` accepts `tabs` / `panels` registrations. The feature never edits that module's internals.

Future modules this is designed for: Leads & pipeline, Content calendar, Approvals, Time tracking, Quotes & Invoices (GST), Client KPIs, Social publishing, Integrations (webhook outbox).

## 11. Backups and data safety
- A nightly GitHub Action runs `pg_dump` on production and stores the result encrypted in a private R2 bucket, kept for 30 days.
- A restore drill is done once before launch, then quarterly.
- Owners can export data to CSV for each module.
