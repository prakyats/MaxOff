# MaxOff Roadmap

> **One task = one Claude Code session.** Tick a task (`[x]`) only when its Definition of Done (in CLAUDE.md) is met and it's committed.
> Every phase ends with `/review-phase`, which reviews the phase, merges its branch into `main` and adds a git tag (`phase-N`).
> The suggested model for each task is in brackets: **[F]** Fable 5.1 · **[O]** Opus 5 · **[S]** Sonnet 5.

---

## Phase 0: Foundation
Exit: an empty app deployed to staging, CI green, and all quality gates working.
- [ ] **0.1** [O] Repo and tooling: git, Next.js scaffold (keeping the existing docs), pnpm, strict TS, ESLint + Prettier, path aliases, the folder skeleton from ARCHITECTURE §3, `pnpm check` script, `.env.example`, README
- [ ] **0.2** [F] Local Supabase: CLI + Docker, base migration (extensions, `updated_at` trigger, `archived_at` conventions), type generation, Supabase client factories in `core/db`, `core/errors` (AppError, Result, `action()` wrapper)
- [ ] **0.3** [O] UI shell: shadcn/ui, theme tokens, app layout (sidebar, top bar, breadcrumbs), error boundaries, 404/403 pages, toasts, shared EmptyState / PageHeader / DataTable / ConfirmDialog
- [ ] **0.4** [O] Quality gates: Vitest, Playwright, pgTAP with one sample test each, eslint-plugin-boundaries rules, GitHub Actions CI
- [ ] **0.5** [F] Deployment: Cloudflare Workers (OpenNext) + a staging Supabase project, environment variables, Sentry, a deploy workflow from `main`

## Phase 1: Auth, Team and Permissions
Exit: the owner can invite a teammate, and each role sees and does only what it's allowed to.
- [ ] **1.1** [F] Schema: members, roles, role_permissions, job_titles, activity_log. SQL `is_active_member()` / `has_permission()`. Permission registry in code. pgTAP tests for each role
- [ ] **1.2** [F] Auth: login (password + magic link), sign-ups turned off, session middleware, route guards, seed script for the first owner, Resend as SMTP, rate limits
- [ ] **1.3** [O] Invites: invite dialog, server-side `inviteUserByEmail`, accept → set password → complete profile, resend / cancel
- [ ] **1.4** [O] Team UI: member list, member page, change role, deactivate / reactivate, profile settings, job titles list
- [ ] **1.5** [O] `core/permissions` UI helpers (`can()`, `<Can>`), `core/activity` feed component, e2e tests: invite + role limits

## Phase 2: Platform core (the customization engine)
Exit: admins can create custom fields and list items in Settings, and file upload/download works securely.
- [ ] **2.1** [F] `core/storage`: StorageAdapter + R2, `files` table, presigned upload/download, type and size checks, SVG sanitizing, uploads in parts for large files. Avatar upload as the first use
- [ ] **2.2** [F] `core/custom-fields` back end: field_definitions, zod schema builder, validation and merging, RLS, unit + pgTAP tests
- [ ] **2.3** [O] Custom fields UI: `<CustomFieldsForm>`, `<CustomFieldsView>`, Settings → Custom fields (create, reorder, archive; for each entity and optionally one client)
- [ ] **2.4** [O] `core/lists` (list_items + registry + Settings → Lists), `core/flags`, Settings layout, company profile (name, logo)

## Phase 3: Clients
Exit: a real client can be fully recorded with services, contacts, requirements and custom fields.
- [ ] **3.1** [F] Schema and repository: clients, client_contacts, client_services, indexes, RLS, pgTAP tests
- [ ] **3.2** [O] Client list: cards and table, search, filters (including custom fields), sorting, pagination, filters in the URL
- [ ] **3.3** [O] Create and edit client: sectioned form, services with scope and dates, requirements, custom fields, validation
- [ ] **3.4** [O] Client page: header, Overview, Contacts (add/edit, primary), Activity, archive / restore, **tab extension slot**, e2e test

## Phase 4: Brand Kit
Exit: any member can open a client and download a logo or copy a colour in 2 clicks.
- [ ] **4.1** [O] Schema: client_brand, brand_colors, brand_fonts, brand_assets (→ files), RLS, tests
- [ ] **4.2** [O] Assets: uploading several at once, category and variant, light and dark previews, reorder, archive, download
- [ ] **4.3** [O] Colours and fonts: palette editor with copy, Google Fonts preview, uploaded font files
- [ ] **4.4** [O] Identity text, socials, custom brand fields, video/audio player, **ZIP download**, the exported `<BrandPanel>`, e2e test

## Phase 5: Deliverables
Exit: every active client's recurring deliverables are recorded.
- [ ] **5.1** [O] Schema: client_deliverables (type from lists, quantity, frequency, platform, specs, active, custom fields), RLS, tests. Seed the deliverable types
- [ ] **5.2** [O] Deliverables tab on the client page: add, edit, pause, reorder, and a monthly summary ("This month: 12 Reels, 8 Statics...")

## Phase 6: Projects and tasks
Exit: the team can run a real project on the board from start to finish.
- [ ] **6.1** [F] Schema: projects, project_members, project_statuses, project_phases, tasks (subtasks, fractional position, deliverable link), task_comments, task_attachments, RLS (project membership + `projects.view_all`), tests
- [ ] **6.2** [O] Projects list and create a blank project (default statuses), project settings (edit statuses and phases, gates, members, custom fields)
- [ ] **6.3** [F] Board view: status columns, dnd-kit, fractional ordering, group by phase, filters, optimistic updates + Realtime
- [ ] **6.4** [O] List and Phases views, task drawer (all fields, subtasks, custom fields, comments with @mentions, attachments)
- [ ] **6.5** [O] Brand panel on the project, client → Projects tab, progress and at-risk calculations, gate warnings, e2e test

## Phase 7: Templates and recurring work
Exit: a monthly retainer project for a real client is created from a template, with its deliverable tasks, in under 1 minute.
- [ ] **7.1** [F] Schema: project_templates (global or for one client, recurrence, gates, deliverables setting), template_phases / statuses / tasks, RLS, tests. **Seed the templates in PRODUCT §7**
- [ ] **7.2** [O] Template list and editor (phases, statuses, tasks with D+n offsets and default assignee by person or job title, drag to reorder)
- [ ] **7.3** [F] `create_project_from_template()` Postgres function (in one transaction): copy the structure, work out dates, pick assignees, generate deliverable tasks. A preview-and-adjust dialog. pgTAP + e2e tests
- [ ] **7.4** [O] Save project as template, "Create next period" (carry unfinished tasks over), reminders for recurring work that's due

## Phase 8: Daily use
Exit: team members start their day in MaxOff.
- [ ] **8.1** [O] Dashboard: my tasks, my projects, needs attention
- [ ] **8.2** [O] Notifications: table, triggers (assigned, @mentioned), pg_cron for due soon and overdue, bell + read/unread
- [ ] **8.3** [O] Global search (Ctrl+K) using Postgres full-text search
- [ ] **8.4** [S] UX polish: keyboard shortcuts, empty states, mobile pass, accessibility audit fixes

## Phase 9: Hardening and launch
Exit: running in production with real Pixora data, backed up and monitored.
- [ ] **9.1** [F] Security review: RLS audit, storage access, invite flow, rate limits, security headers/CSP, dependency audit
- [ ] **9.2** [O] Performance: indexes, slow query review, bundle size, image handling
- [ ] **9.3** [O] Backups: nightly pg_dump → R2 GitHub Action, a restore drill, CSV exports for each module
- [ ] **9.4** [O] Production: production Supabase + Worker, tagged release deploy, UptimeRobot, CSV import of existing clients, `docs/USER-GUIDE.md`, onboarding of the owner and team

---

## Later (after launch, each one a new module behind a feature flag)
Leads & pipeline → client conversion · Content calendar · Creative approval (image/video comments) · Business Audit™ form + Health Score · Client KPIs · Time tracking · Quotes & invoices (GST) · Email/WhatsApp notifications · Custom roles UI · Social publishing · Webhook integrations
