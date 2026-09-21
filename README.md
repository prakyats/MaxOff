# MaxOff

The internal operations and control system for **Pixora Clips**: attendance, leave, staff
tasks with acknowledgement and approvals, clients, client work (projects → cycles → items),
notifications, dashboards, and CEO-only revenue and reports.

Internal and invite-only. **Clients never log in.** The business timezone is **IST**.

## Stack

Next.js (App Router) + TypeScript strict · Tailwind CSS v4 · Supabase (Postgres, RLS,
Realtime, `pg_cron`) · Cloudflare Workers (OpenNext) + R2 · Vitest, Playwright, pgTAP.
See `docs/ARCHITECTURE.md` and `docs/decisions/` for the reasoning.

## Prerequisites

| Tool | Version |
|---|---|
| Node.js | ≥ 20.9 (built on 24.x) |
| pnpm | 12.x (`npm i -g pnpm`, or `corepack enable`) |
| Docker Desktop | for local Supabase, from task 0.2 |
| Supabase CLI | from task 0.2 |

## Getting started

```bash
pnpm install
cp .env.example .env.local   # then fill in the values
pnpm dev                     # http://localhost:3000
```

## Commands

| Command | Does |
|---|---|
| `pnpm dev` | Run the app locally |
| `pnpm build` · `pnpm start` | Production build, then serve it |
| `pnpm typecheck` | `next typegen` + `tsc --noEmit` |
| `pnpm lint` · `pnpm lint:fix` | ESLint |
| `pnpm format` · `pnpm format:check` | Prettier |
| `pnpm check` | typecheck + lint + format + build. **Must pass before any commit** |

Unit tests (`pnpm test`), database tests (`pnpm db:test`) and the Supabase commands
(`pnpm db:reset`, `pnpm db:new`, `pnpm db:types`) join this table in tasks 0.2 and 0.4,
and `pnpm check` grows to include them.

## Repository layout

```
src/app/        routes only: thin pages composing module components
src/core/       shared foundation (auth, db, permissions, time, ui, …), no business features
src/modules/    isolated features, each exposing a single index.ts
supabase/       append-only migrations, pgTAP tests, seed data
e2e/            Playwright
docs/           the project's memory (see below)
```

Import rule: `app → modules (index.ts only) → core`. Core never imports modules.

## Documentation

| File | Holds |
|---|---|
| `CLAUDE.md` | Rules and business invariants for Claude Code |
| `BUILD-GUIDE.md` · `OPERATING-MANUAL.md` | How the build is run, and how to check each task |
| `docs/PRODUCT.md` | What is being built, and why |
| `docs/PERMISSIONS.md` | Who can see and do what |
| `docs/WORKFLOWS.md` | States, transitions, jobs, notification recipients |
| `docs/DATA-MODEL.md` | The authoritative tables |
| `docs/ARCHITECTURE.md` · `docs/decisions/` | How it is built, and why |
| `docs/ROADMAP.md` · `docs/PROGRESS.md` | The task list, and where the build currently stands |

Private and unlicensed. © Pixora Clips.
