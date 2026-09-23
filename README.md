# MaxOff

The internal operations and control system for **Pixora Clips**: attendance, leave, staff
tasks with acknowledgement and approvals, clients, client work (projects → cycles → items),
notifications, dashboards, and Owner-only revenue and reports.

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
pnpm db:start                # local Supabase in Docker; `pnpm db:status` prints the keys for .env.local
pnpm db:reset                # migrations + seed (the local sign-ins below)
pnpm dev                     # http://localhost:3000 → /login
```

### Local sign-ins

`supabase/seed.sql` creates five accounts for development and Playwright. They exist only on
the local stack (the deploy workflow never seeds), and the passwords are fixtures, not secrets:

| Email | Password | Role |
|---|---|---|
| `owner@maxoff.local` | `owner-local-password` | Owner |
| `admin@maxoff.local` | `admin-local-password` | Admin |
| `staff@maxoff.local` | `staff-local-password` | Staff |
| `gone@maxoff.local` | `gone-local-password` | deactivated Staff (refused at sign-in) |
| `reset@maxoff.local` | `reset-local-password` | Staff, used only by the Playwright recovery-link test (which changes its password) |
| `leaver@maxoff.local` | `leaver-local-password` | Staff, used only by the Playwright team test (which deactivates and reactivates them) |

Password-reset emails from the local stack land in Mailpit: http://127.0.0.1:54324.

### The first Owner on a hosted project

Sign-ups are off everywhere (invite-only). The first account is created by a script that
never handles a password: it creates the auth user, inserts the active Owner through
`bootstrap_owner()` (service role only, refuses once anyone exists) and prints a **one-time
link** where the Owner chooses their password. Nothing is emailed, so it works before any
sending domain exists.

```bash
# locally (values from .env.local)
pnpm bootstrap:owner -- --email owner@example.com --name "Full Name" --org "Pixora Clips"

# staging / production: the same script with that project's URL, secret key and app URL
NEXT_PUBLIC_SUPABASE_URL=https://<ref>.supabase.co SUPABASE_SECRET_KEY=<secret> \
NEXT_PUBLIC_APP_URL=https://maxoff-staging.<subdomain>.workers.dev \
  node scripts/bootstrap-owner.mjs --email owner@example.com --name "Full Name" --org "Pixora Clips"
```

The link expires after 24 hours (`otp_expiry`); "Forgot your password?" on `/login` issues a new one (that one
is emailed by Supabase Auth, see "Hosted auth settings").

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
| `pnpm bootstrap:owner -- --email … --name … [--org …]` | Create the first Owner and print the one-time password link (see "The first Owner on a hosted project") |
| `pnpm test:e2e` · `pnpm test:e2e:ui` | Playwright in `e2e/`: builds and runs `next start` on port 3100, signs in as the seeded local users (the stack must be up and reset) and proves the build is locked down. Run it whenever a user flow changed |
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
   Then apply "Hosted auth settings" below. A free project pauses after 7 idle days; open it
   or ping it daily.
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
| `SESSION_IP_HASH_SALT` | Any long random string (`openssl rand -hex 32`), different per environment. Salts the IP hash in `session_events`; uploaded as a Worker secret. Unset = the hash is stored as null |
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

`RESEND_API_KEY` and `EMAIL_FROM` (app email: invites from 1.3, notification email from 5.2)
are **not** wired yet: they need a verified sending domain (`mail.maxoff.app`, see PROGRESS.md).
Until then the app logs a start-up warning and sends nothing. They stay out of CI on purpose.

### Inviting people (task 1.3)

People → **Invite** (Owner only): email, name, role (Admin or Staff) and job title. The app
creates the sign-in without a password (`auth.admin.generateLink`, type `invite`), writes the
member row as `invited` and shows the **invite link** once. The same link goes out by email when
`RESEND_API_KEY` is set; until a sending domain exists, copy it from the dialog and send it
yourself (WhatsApp is fine: the link is one-time and expires after 24 h). **Copy invite link**
on a pending row issues a fresh link and the previous one stops working. The person opens the
link, chooses a password and lands on their profile as an active member.

**Deactivate** (or **Revoke invite** on a pending row) takes effect at once: the person's auth
sessions and refresh tokens are deleted inside the transition, so an open tab cannot renew its
session, and the next page load ends at sign-in. **Reactivate** brings a member back active, or
back to invited if they never accepted (issue a new link then).

### Hosted auth settings

`supabase/config.toml` only configures the local stack. Apply the same on each hosted project
in the Supabase dashboard (**Authentication**), once per project:

| Where | Setting |
|---|---|
| Sign In / Providers → Email | **Allow new users to sign up: off** (invite-only). Email provider stays **on** (it is the login method). Confirm email: off |
| Sign In / Providers → Email | **Minimum password length: 12**, no character requirements. Leaked password protection is **Pro-only, so it stays off** on the free plan (ADR-0003); invite-only access and the 12-character minimum cover it for now |
| URL Configuration | **Site URL** = the app URL (`NEXT_PUBLIC_APP_URL`). **Redirect URLs**: add `<app URL>/**` |
| Emails → Templates → **Reset password** | Subject "Set your MaxOff password"; body = `supabase/templates/recovery.html`. The link **must** be `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery` (the app verifies the token hash server-side; the default `{{ .ConfirmationURL }}` will not work) |
| Emails → SMTP settings | **Until a sending domain exists, leave Supabase's built-in mailer**: it delivers only to the email addresses of the Supabase project's own team members, a few per hour, which is enough for the Owner on staging. With `mail.maxoff.app` verified in Resend: host `smtp.resend.com`, port `465`, user `resend`, password = a Resend API key, sender `MaxOff <noreply@mail.maxoff.app>` |
| Rate Limits | Keep the defaults (30 sign-in attempts per 5 min per IP, 30 token verifications, 150 refreshes). Raise **emails sent per hour** only after custom SMTP is on |
| Sign In / Providers → Email | **Email OTP expiration: 86400 s (24 h)**, the same as `config.toml` `otp_expiry` (decided 2026-09-22): invite links get shared and opened hours later. It also governs recovery links; every link is still one-time |
| Sign In / Providers → Email | **Secure password change: on** ("Require current password when updating" / reauthentication), the same as `config.toml` `secure_password_change` (phase 1 review, 2026-09-23). GoTrue asks for a nonce only when the session is older than 24 h, so link-opened sessions (invite, recovery) are unaffected; the real fix for a stolen session is 10.3 |

There is **no invite template** to configure: the app builds invite links itself and sends the
email through `core/notifications` (Resend), so GoTrue never mails an invite (task 1.3).

### What a deploy does

1. Checks out the commit CI verified (production: first proves the tagged commit is on `main`
   and that its three CI checks are `success`), installs dependencies.
2. `pnpm build:worker`, with the `NEXT_PUBLIC_*` variables inlined (a malformed value fails
   the build) and source maps uploaded to Sentry when the token is present. The build comes
   first so a failed build never leaves the database ahead of the Worker.
3. `supabase link` + `supabase db push`: applies any new append-only migrations.
4. Uploads `SUPABASE_SECRET_KEY` and `SESSION_IP_HASH_SALT` as Worker secrets, then
   `wrangler deploy --env <name>`.

### Branch previews (task 2.0)

Every push to a branch other than `main` builds the app and uploads it as a new **version** of
the staging Worker, so a phase can be judged on a real phone from the first task instead of
after the merge. `.github/workflows/preview.yml`. Three URLs come back:

| URL | Shape | Moves when |
|---|---|---|
| **Latest** | `https://latest-maxoff-staging.<subdomain>.workers.dev` | *any* branch is pushed. The permanent phone bookmark: add it to the home screen once and it always shows the newest preview |
| **Branch** | `https://<branch>-maxoff-staging.<subdomain>.workers.dev` | that branch is pushed. The precise one |
| **Commit** | `https://<version-prefix>-maxoff-staging.<subdomain>.workers.dev` | never. `<version-prefix>` is the first 8 characters of the Worker version ID, not the git SHA |

On the `pixoraclips` subdomain the first two are
`https://latest-maxoff-staging.pixoraclips.workers.dev` and, for the `phase-2` branch,
`https://phase-2-maxoff-staging.pixoraclips.workers.dev`.

**With two branches in flight, `latest` follows whichever pushed most recently** — it says nothing
about which branch it is showing. When it matters which is which (comparing two approaches, or
handing someone a link to one specific thing), use the branch URL. `latest` is for the common case
of one branch at a time and a phone that should not need a new bookmark every phase.

The branch alias is the branch name with everything outside `a-z0-9-` turned into a dash,
lowercased; it gains a `b-` prefix if the branch starts with a digit, and is truncated with a short
hash if `<alias>-maxoff-staging` would pass the 63-character DNS limit. The workflow log and the PR
comment always print the URLs Cloudflare actually returned.

An alias is written as an annotation on a version at upload time, and there is no command that
adds one to an existing version, so a version carries exactly one alias. The workflow therefore
uploads the same bundle twice per push — once aliased to the branch, once to `latest`. Assets are
content-addressed, so the second upload re-sends almost nothing; it does mean two versions per
push in `wrangler versions list`, both carrying the same commit as their tag.

**A preview is never a deployment.** The workflow runs `wrangler versions upload`, which uploads
code and configuration and stops there: `https://maxoff-staging.<subdomain>.workers.dev` goes on
serving whatever `main` last deployed, and routes, custom domains and cron triggers are untouched
(wrangler prints "To deploy this version to production traffic use the command
`wrangler versions deploy`" at the end of every upload — that command is nowhere in this repo).
Production is out of reach twice over: the workflow only ever passes `--env staging`, and the
production environment sets `preview_urls: false` in `wrangler.jsonc`, so production versions get
no public URL at all. The workflow also never runs `wrangler secret put` and never uses
`wrangler-action`'s `secrets:` block, because both of those publish a deployment; the preview
version inherits the staging Worker's existing secrets instead.

**What a preview runs against.** The staging Supabase project, with the `staging` GitHub
environment's variables, built with `NEXT_PUBLIC_APP_ENV=staging` — which is what gives a preview
the same security headers, `robots.txt: Disallow: /` and the same security headers as staging.
**Measured on the first real run:** Cloudflare's preview edge *replaces* `X-Robots-Tag` with its
own `noindex` on every response from a preview URL — staging serves the app's
`noindex, nofollow`, a preview serves `noindex`, even on static pages. Previews are therefore
noindexed whatever the build does, which is stronger than relying on the app header; only
`nofollow` is lost, and a sign-in-gated app exposes no crawlable links anyway. Signing in works normally (email + password is server-side
and needs no redirect allow-list). Two smaller notes: `NEXT_PUBLIC_APP_URL` is set to the preview's
own origin, so **invite** links generated on a preview point back at that preview, while
**password-recovery** mails come from GoTrue's Site URL and land on staging either way; and
`SENTRY_AUTH_TOKEN` is deliberately left out, so previews upload no source maps and cut no Sentry
release — runtime errors still arrive, tagged `staging`, with minified stacks.

**Previews never run migrations.** Migrations reach staging from `main` (the deploy workflow) or
from a tag, and from nowhere else. A branch that adds migrations therefore previews against a
staging database that lacks them, and the PR comment says so in a warning block listing the files.
When that schema really is wanted on staging: **Actions → Preview → Run workflow →** pick the
branch **→ `staging-migrations`**. It refuses to run on `main`, lists what it will apply, and
shares a concurrency group with the staging deploy so it can never race one. Staging is shared and
migrations are append-only, so what it pushes stays there until the branch merges.

**Where the URLs appear.** All three land in the run's job summary always, and in a single PR
comment that is edited in place on every push (matched by an HTML marker, so pushes never stack
up comments). A
phase branch usually has no PR until `/review-phase`, which is fine — the alias is stable, so the
bookmark works long before a PR exists.

**Not triggered by:** pushes to `main` (that is the staging deploy), tag pushes, or pushes that
only touch `docs/**`, `**/*.md` or `screenshots/**`. A docs-only commit cannot change the UI and
the alias keeps serving the last real build, so it is not worth a seven-minute run.

**Two things that must be true in repository settings**, or previews fail before the first step:
the `staging` environment's **deployment branches** rule has to allow branches other than `main`
("All branches" is the default), and it must not have a required reviewer. Preview runs appear in
the Environments panel under `staging` because they borrow its variables and secrets; the job sets
no environment URL, so the panel still shows the real staging deployment. The **Run workflow**
button for `staging-migrations` only appears once `preview.yml` is on `main` — GitHub lists
`workflow_dispatch` from the default branch only. Until then, push a branch's migrations with
`pnpm supabase db push` locally.

**Cleaning up, and what it costs.** Nothing to delete and nothing to pay for. There is no
`wrangler` command to remove an alias — an alias is only ever created during a version upload, so
pushing again just repoints it, and Cloudflare keeps the 1000 most recently deployed aliases and
drops the least recent beyond that. `latest` is therefore permanent by construction, and a
finished branch's alias goes on serving its last build until it ages out. That is not a leak: it
is a staging build, noindexed and sign-in-only, exactly like staging itself. Stale versions and
aliases are not billed — Workers bills requests and CPU, so a preview nobody opens costs nothing.
The only recurring cost is the GitHub Actions minutes each build spends, which is why docs-only
pushes are skipped. To stop preview URLs for good, set `preview_urls: false` on the staging
environment in `wrangler.jsonc` and let `main` deploy.

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
supabase/       append-only migrations, pgTAP tests, seed data, auth email templates
scripts/        one-off scripts: icon rendering, the Owner bootstrap
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
