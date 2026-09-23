# MaxOff: instructions for Claude Code

MaxOff is the **internal operations and control system for Pixora Clips**. It covers attendance, leave, staff tasks with acknowledgement and approvals, clients, client work (projects → cycles → items), notifications, dashboards, Owner-only revenue and reports. It's internal and invite-only. **Clients never log in.** The business timezone is **IST**.

## Read before any work
1. `docs/PROGRESS.md`: current state and next task. **Always read this first.**
2. `docs/ROADMAP.md`: work on one task at a time.
3. Only the sections your task needs from:
   - `docs/PRODUCT.md`: what and why (it wins over everything in `docs/research/`)
   - `docs/PERMISSIONS.md`: who can see and do what
   - `docs/WORKFLOWS.md`: states, transitions, jobs, notification recipients
   - `docs/DATA-MODEL.md`: the authoritative tables
   - `docs/ARCHITECTURE.md`: how to build it
   - `docs/decisions/`: ADRs. Don't contradict one without writing a new ADR.

## Business invariants (never break these)
1. Roles are exactly **Owner (one) / Admin / Staff**. Job titles are data, not permissions.
2. **Money is Owner-only**, in Owner-only tables, readable only through `modules/revenue`. Never in Admin or Staff payloads, Realtime, search or exports.
3. **Revenue counts only for Owner-approved project items.** Staff tasks carry no revenue.
4. **Client work and staff tasks are separate** (ADR-0005). The only link is a task's optional client *label*. Staff never see client records or progress.
5. **Approval route:** Done → (approving Admin, if any and not an assignee) → **Owner**. Final completion is always the Owner's.
6. **Every assignee acknowledges** ("Task Noted"). Only the **primary owner** marks Done.
7. Attendance and leave are decided **only by the Owner**. History is never overwritten, and corrections sit alongside the original.
8. **IST everywhere** through `app.today_ist()` / `core/time`. Never `new Date()` or `now()::date` for business dates.
9. **Never destroy history:** archive, cancel with a reason, and add history rows. Permanent delete is Owner-only.
   Submitted work is **never re-encoded** (originals stay full quality; previews are separate), and a local copy is deleted only **after** its Google Drive copy is confirmed (ADR-0010).
10. Don't invent business rules. If WORKFLOWS or PRODUCT don't cover a case, **ask**.

## Engineering rules
1. **Customization is data.** Task types, stage presets, job titles, holidays, custom fields and templates live in tables. Code depends only on the enums in DATA-MODEL §0.
2. **Modules are isolated:** `app → modules (index.ts only) → core`. Core never imports modules. Lint enforces this.
3. **Only `data/` layers touch the database:** `src/modules/*/data/` plus the core areas that own tables (`core/db`, `core/auth`, `core/activity`, `core/lists`, `core/custom-fields`, `core/notifications`, `core/storage`). Lint enforces the list; type-only imports are fine anywhere.
4. **Workflow changes go through Postgres transition functions** (ADR-0006): permission + scope + state check + change + `activity_log` + notifications in one transaction. State columns are never updated directly.
5. **Plain edits:** server action = zod → `requirePermission` → repository → revalidate → `Result`. Auditing is done by the `audit_row_change()` trigger. **Actions stay thin** — no business logic in an action, and `modules/*/domain` never imports React, Next or DOM APIs (ADR-0011, lint-enforced).
6. **RLS on every table** in the same migration that creates it, with **pgTAP tests for each role** (allowed and denied). Every transition function gets pgTAP tests for each path.
7. **Migrations are append-only** (`pnpm db:new <name>`). Never edit an applied migration. Update `DATA-MODEL.md` first.
8. **Custom fields only through `src/core/custom-fields`.**
9. **TypeScript strict:** no `any`, no `@ts-ignore` without a written reason. Types come from `pnpm db:types`.
10. **No secrets in code or chat.** New environment variables go into `.env.example` with a comment.

## Commands
`pnpm dev` · `pnpm typecheck` · `pnpm lint` · `pnpm test` · `pnpm test:e2e` · `pnpm db:test` (pgTAP) · `pnpm build`
`pnpm check` = typecheck + lint + format + unit + db tests + build. **It must pass before any commit.**
`pnpm db:reset` · `pnpm db:new <name>` · `pnpm db:types`

> `check` = typecheck + lint + format:check + unit tests + pgTAP (`db:test`, needs Docker and `pnpm db:start`) + build. Playwright stays **outside** `check` on purpose (a gate that takes minutes gets skipped): run `pnpm test:e2e` when a flow changed; CI runs it as its own job. No stub scripts: a command is in `check` only once it really runs.

## Definition of Done (every task)
- [ ] `pnpm check` passes. New logic has unit tests, new tables have RLS tests for each role, new transition functions have tests for each path, and new flows have Playwright tests.
- [ ] The UI has loading, empty, error and permission-denied states, and forms show validation messages. Staff screens meet the **mobile standard** (ARCHITECTURE §14.1: safe areas, 16px inputs, 44px targets, bottom-sheet dialogs, sticky primary action, cards instead of tables) at 375px and 430px.
- [ ] Every mutation is audited (a transition function or the audit trigger). Notifications follow WORKFLOWS §9.
- [ ] Docs are updated: `PROGRESS.md`, the task is ticked in `ROADMAP.md`, and DATA-MODEL / WORKFLOWS / PERMISSIONS / an ADR if something changed.
- [ ] No `console.log`, no commented-out code, and no TODO that isn't also listed in PROGRESS.md.

## How to work
- **One roadmap task per session.** Plan first and **wait for approval** before editing files.
- Stay inside the task. Put ideas and discovered issues in PROGRESS.md under "Ideas / tech debt".
- Use subagents for broad searches and reviews to keep the main context small.
- If context gets heavy in the middle of a task, run `/save-progress` before anything else.
