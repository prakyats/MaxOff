# MaxOff: instructions for Claude Code

MaxOff is the internal operating system for **Pixora Clips**, a growth and marketing agency. It covers Team, Clients (CRM + Brand Kit + Deliverables), Projects and Templates. It's internal and invite-only. **Clients never log in.**

## Read before any work
1. `docs/PROGRESS.md`: the current state and next task. **Always read this first.**
2. `docs/ROADMAP.md`: phases and tasks. Work on one task at a time.
3. `docs/PRODUCT.md`: what to build. Read only the section your task needs.
4. `docs/ARCHITECTURE.md`: how to build it. The rules below are a summary of it.
5. `docs/decisions/`: architecture decisions (ADRs). Don't contradict one without writing a new ADR.

## Non-negotiable rules
1. **Customization is data, not code.** Never hard-code business lists: services, phases, task statuses, deliverable types, asset categories, job titles or extra fields. They live in tables and can be edited in Settings. Pixora's six-step framework is **seed data**, and no client is required to follow it.
2. **Keep modules isolated.** Feature code lives in `src/modules/<module>/`. Other code imports a module only through `@/modules/<module>` (its `index.ts`). `src/core` never imports from modules. Lint rules enforce this.
3. **Only data layers touch the database.** Supabase is queried only in `src/modules/*/data/` and `src/core/db/`. Components never query directly.
4. **Every mutation follows the same pattern.** A server action does: zod parse → `requirePermission(key)` → repository call → `recordActivity()` → revalidate → return a `Result`.
5. **Security lives in the database.** Every table has RLS turned on in the same migration that creates it, and policies use `has_permission()`. UI permission checks only hide buttons.
6. **Migrations are append-only.** Create each one with `pnpm db:new <name>`. Never edit a migration that has already been applied. Destructive changes use expand → migrate → contract across separate tasks.
7. **Archive, don't delete.** Business records use `archived_at`. Hard deletes are owner-only and explicit.
8. **Custom fields go through `src/core/custom-fields`.** Never add ad-hoc jsonb columns.
9. **TypeScript is strict.** No `any` and no `@ts-ignore` without a written reason. Database types are generated with `pnpm db:types`.
10. **No secrets in code.** New environment variables go into `.env.example` with a comment.

## Commands
`pnpm dev` · `pnpm typecheck` · `pnpm lint` · `pnpm test` · `pnpm test:e2e` · `pnpm db:test` (pgTAP) · `pnpm build`
`pnpm check` runs typecheck + lint + unit tests + db tests + build. **It must pass before any commit.**
`pnpm db:reset` · `pnpm db:new <name>` · `pnpm db:types`

## Definition of Done (every task)
- [ ] `pnpm check` passes. New logic has unit tests, every new table has pgTAP RLS tests, and every new user flow has a Playwright test.
- [ ] The UI has loading, empty, error and permission-denied states, and forms show validation messages.
- [ ] Mutations write to the activity log, and the page works at a 375px width.
- [ ] `docs/PROGRESS.md` is updated, the task is ticked in `docs/ROADMAP.md`, and an ADR is added or `ARCHITECTURE.md` updated if a pattern changed.
- [ ] No `console.log`, no commented-out code, and no TODO that isn't also listed in PROGRESS.md.

## How to work
- **One roadmap task per session.** Plan first and **wait for approval** before editing files.
- Stay inside the task. Write ideas and discovered issues in PROGRESS.md under "Ideas / tech debt" instead of building them.
- If a business rule is unclear, **ask**. Don't invent one.
- Use subagents for broad searches and reviews so the main context stays small.
- If context gets heavy in the middle of a task, run `/save-progress` before anything else.
