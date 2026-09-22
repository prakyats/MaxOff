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
| `pnpm build` · `pnpm start` | Production build, then serve it with Node |
| `pnpm build:worker` · `pnpm preview` · `pnpm deploy:*` | Cloudflare Worker build, local preview and manual deploys (see "Deploying") |
| `pnpm typecheck` | `next typegen` + `tsc --noEmit` |
| `pnpm lint` · `pnpm lint:fix` | ESLint |
| `pnpm format` · `pnpm format:check` | Prettier |
| `pnpm test` · `pnpm test:watch` | Vitest unit tests |
| `pnpm db:start` · `pnpm db:stop` · `pnpm db:status` | Local Supabase stack in Docker. `db:status` prints the URL and keys for `.env.local` |
| `pnpm db:reset` | Recreate the local database from `supabase/migrations` + `supabase/seed.sql` |
| `pnpm db:new <name>` | New append-only migration file |
| `pnpm db:types` | Regenerate `src/core/db/database.types.ts` from the local database |
| `pnpm db:test` | pgTAP tests in `supabase/tests` (needs the stack running) |
| `pnpm test:e2e` · `pnpm test:e2e:ui` | Playwright in `e2e/`: flow specs against `next dev` (started or reused) plus the `production` project, which builds and runs `next start` on port 3100 to prove the build is locked down. Run it whenever a user flow changed |
| `pnpm check` | typecheck + lint + format + unit tests + pgTAP + build. **Must pass before any commit.** Needs Docker Desktop running and `pnpm db:start` done first |

Studio for the local stack: http://127.0.0.1:54323 once `pnpm db:start` is up.

## Continuous integration

`.github/workflows/ci.yml` runs three jobs on every push and pull request: **check**
(typecheck, lint, format, unit tests, the OpenNext Worker build), **pgTAP** (Postgres-only local
Supabase stack) and **playwright** (Chromium). A failed Playwright run uploads its HTML report as
an artifact.

### Branch protection (enable once CI is green on `main`)

GitHub → repository **Settings** → **Branches** → **Add branch ruleset** (or *Add classic
branch protection rule*):

1. Name it `main`, target branch `main`.
2. Tick **Require a pull request before merging**.
3. Tick **Require status checks to pass** → **Require branches to be up to date** → add the
   three checks: `typecheck · lint · format · unit · build`, `pgTAP`, `playwright`.
4. Tick **Block force pushes**. Save.

Red never merges after that.

## Deploying

Hosting is Cloudflare Workers through OpenNext (ADR-0003, ARCHITECTURE §18). Staging deploys
from `main` once CI is green; production deploys from a `v*` tag, and only when the tagged commit
is on `main` with all three CI checks green (a tag on any other commit stops before touching a secret). Both jobs live in
`.github/workflows/deploy.yml` and read every value from the GitHub **environment** of the same
name (repository **Settings → Environments → New environment**: `staging`, later `production`).
Nothing secret is ever committed or typed into a terminal; it all goes in through that page.

**Branches and tags.** Work happens on `phase-N` branches. The end of a phase is tagged
`phase-N-done` on the merge commit (`/review-phase`). Never name a tag after a branch (the
old `phase-0` tag is both, which makes plain `git push` and `git push --delete` ambiguous), and
never tag `v*` for a phase: that name means "deploy to production".

| Command | Does |
|---|---|
| `pnpm build:worker` | `next build` + OpenNext bundling into `.open-next/` (what CI and the deploy jobs run) |
| `pnpm preview` | Build, then serve the Worker locally through wrangler (needs `.dev.vars`, see `.dev.vars.example`) |
| `pnpm deploy:staging` · `pnpm deploy:production` | Manual deploys with the local wrangler login. The workflow is the normal path |

**Windows:** `next build` works, but the OpenNext bundling step cannot read pnpm's junction
folders, so `build:worker` and `preview` need WSL locally. CI and the deploy jobs run on Ubuntu.

### One-time setup

1. **Cloudflare.** Sign in at dash.cloudflare.com. **Workers & Pages → Overview** shows your
   account ID and `workers.dev` subdomain (the staging URL will be
   `https://maxoff-staging.<subdomain>.workers.dev`). Create an API token at **My Profile → API
   Tokens → Create Token → "Edit Cloudflare Workers"** template.
2. **Supabase staging project** (`maxoff-staging`, region Mumbai, free plan). Note the database
   password you set at creation. **Project Settings → General** shows the Reference ID;
   **Project Settings → API Keys** shows the project URL, the publishable key and the secret key.
   A personal access token for the CLI comes from **Account → Access Tokens**.
   Set **Authentication → URL Configuration → Site URL** to the staging URL (task 1.2 completes
   the auth settings). A free project pauses after 7 idle days; open it or ping it daily.
3. **Sentry** (free plan, platform Next.js). **Settings → Projects → maxoff → Client Keys** shows
   the DSN. Org and project slugs are in **Settings → General Settings**. For source maps, create
   an auth token at **Settings → Auth Tokens** with scopes `project:releases` and `org:read`.
   Privacy (ARCHITECTURE §18.2): in **Settings → Security & Privacy** turn on **Prevent Storing
   of IP Addresses** and keep the default server-side data scrubbers on. The app strips PII and
   money before sending; this stops Sentry inferring the client IP on its side.
4. **GitHub environment `staging`.** Add the secrets and variables below. Repeat for
   `production` when it exists (with a required reviewer).

### Secrets and variables the workflow expects

Secrets (**Environment secrets**):

| Name | From |
|---|---|
| `CLOUDFLARE_API_TOKEN` | Cloudflare → My Profile → API Tokens (Edit Cloudflare Workers) |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare → Workers & Pages → Overview (right-hand panel) |
| `SUPABASE_ACCESS_TOKEN` | Supabase → Account → Access Tokens (personal token for the CLI) |
| `SUPABASE_DB_PASSWORD` | Supabase → the database password chosen when the project was created (Project Settings → Database to reset) |
| `SUPABASE_SECRET_KEY` | Supabase → Project Settings → API Keys → Secret key (bypasses RLS; uploaded as a Worker secret) |
| `SENTRY_AUTH_TOKEN` | Sentry → Settings → Auth Tokens. Optional: without it no source maps are uploaded |

Variables (**Environment variables**):

| Name | From |
|---|---|
| `NEXT_PUBLIC_APP_URL` | The Worker URL, e.g. `https://maxoff-staging.<subdomain>.workers.dev` |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase → Project Settings → API Keys → Project URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Supabase → Project Settings → API Keys → Publishable key |
| `SUPABASE_PROJECT_REF` | Supabase → Project Settings → General → Reference ID |
| `NEXT_PUBLIC_SENTRY_DSN` | Sentry → Settings → Projects → maxoff → Client Keys (DSN). Optional: empty keeps Sentry off |
| `SENTRY_ORG` | Sentry organisation slug (Settings → General Settings). Optional |
| `SENTRY_PROJECT` | Sentry project slug, e.g. `maxoff`. Optional |

`NEXT_PUBLIC_APP_ENV` is set by the workflow itself (`staging` or `production`).

### What a deploy does

1. Checks out the commit CI verified (production: first proves the tagged commit is on `main`
   and that its three CI checks are `success`), installs dependencies.
2. `pnpm build:worker`, with the `NEXT_PUBLIC_*` variables inlined (a malformed value fails
   the build) and source maps uploaded to Sentry when the token is present. The build comes
   first so a failed build never leaves the database ahead of the Worker.
3. `supabase link` + `supabase db push`: applies any new append-only migrations.
4. Uploads `SUPABASE_SECRET_KEY` as a Worker secret, then `wrangler deploy --env <name>`.

### Confirming the Sentry pipeline

After a deploy, open `https://maxoff-staging.<subdomain>.workers.dev/diagnostics/sentry`. The
Worker answers **500** on purpose: the route throws an error carrying a fake rupee amount, email
address and phone number (`src/core/observability/diagnostic.ts`). Within a minute the event
appears in Sentry (project `maxoff`, environment `staging`, tag `runtime: server`). Check that

1. every fake value reads `[scrubbed]`: in the issue title, in the `diagnostic` context
   (including the `billing` key), in the `diagnostic_note` extra and the `diagnostic_contact` tag;
2. the Request section shows the method only: no URL query string, headers, cookies or body; the
   `nextjs` context's `request_path` has no query string; the User section shows no id and no IP
   (Sentry still infers a country from the Worker's egress IP, which is Cloudflare's, not a
   person's);
3. the event carries `environment: staging`, `runtime: server`, `runtime.name: cloudflare` and
   the release (the commit SHA).

Known gap: the stack trace shows `worker.js:<line>` frames, not `diagnostic.ts`. The uploaded
source maps cover Next's own chunks, but OpenNext re-bundles them into `.open-next/worker.js`
without a map, so Sentry cannot resolve the frames yet (tracked in PROGRESS.md).

The route exists only in builds with `NEXT_PUBLIC_APP_ENV=staging`; production and local
builds answer 404 (`diagnostic.test.ts`, `e2e/production.spec.ts`).

Staging is also **never indexed**: every response carries `X-Robots-Tag: noindex, nofollow` and
`/robots.txt` disallows everything (`curl -sI <staging>/ | grep -i robots`). Production and local
builds send neither (`core/http/response-headers.ts`).

If a run fails because a name above is missing, the log names it; add it and re-run the job.
The `Deploy` workflow only triggers once its file is on `main`, so the first staging deploy
happens when `phase-0` merges. A `v*` tag pushed before the `production` environment is filled
fails at the build or migration step and deploys nothing. After it, open the staging URL, install the app from the
browser menu (desktop and phone), and trigger a test error to see it in Sentry.

## Architecture rules that lint enforces

`eslint.config.mjs` encodes ARCHITECTURE §3.1: `app → modules (index.ts only) → core`, core
never imports modules, `modules/*/domain` is platform-free (no React, Next, `server-only`
or DOM globals), only `data/` layers and the listed core areas hold a database client, and
money table names appear only inside `modules/revenue`. `tests/lint-rules.test.ts` proves each
rule against the fixtures in `tests/lint-fixtures/`, so a rule can't silently stop working.

## Repository layout

```
src/app/        routes only: thin pages composing module components
src/core/       shared foundation (auth, db, permissions, time, ui, …), no business features
src/modules/    isolated features, each exposing a single index.ts
supabase/       append-only migrations, pgTAP tests, seed data
e2e/            Playwright
tests/          repo-level tests (lint rules) and their fixtures
docs/           the project's memory (see below)
```

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
