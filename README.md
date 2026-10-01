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

`supabase/seed.sql` creates these accounts for development and Playwright. Every seeded member "joined" 30 days before `db:reset`, so their attendance has started (the Start-day prompt, 3b.1, applies to them today). They exist only on
the local stack (the deploy workflow never seeds), and the passwords are fixtures, not secrets:

| Email | Password | Role |
|---|---|---|
| `owner@maxoff.local` | `owner-local-password` | Owner |
| `admin@maxoff.local` | `admin-local-password` | Admin |
| `staff@maxoff.local` | `staff-local-password` | Staff |
| `gone@maxoff.local` | `gone-local-password` | deactivated Staff (refused at sign-in) |
| `reset@maxoff.local` | `reset-local-password` | Staff, used only by the Playwright recovery-link test (which changes its password) |
| `leaver@maxoff.local` | `leaver-local-password` | Staff, used only by the Playwright team test (which deactivates and reactivates them) |
| `gate-<kind>-<project>@maxoff.local` | `gate-local-password` | 12 Admin/Staff accounts used only by `e2e/working-day.spec.ts` (the Start/End day flow, 3b.1; the name dates from the 2.2 day gate) (kind: staff, admin, leave, half; project: desktop, mobile, mobile-lg), because a person has one attendance day per date |

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

# staging: the same script with that project's URL, secret key and app URL
NEXT_PUBLIC_SUPABASE_URL=https://<ref>.supabase.co SUPABASE_SECRET_KEY=<secret> \
NEXT_PUBLIC_APP_URL=https://maxoff-staging.<subdomain>.workers.dev \
  node scripts/bootstrap-owner.mjs --email owner@example.com --name "Full Name" --org "Pixora Clips"
```

**Production (the Owner's own PowerShell, 3c.1).** The secret key is read from a masked prompt,
lives only in that shell and is removed at the end; it never goes in a file, a chat or a session.
Run from the repository root (`pnpm install` done, Node 20+), after the first production deploy
has applied the migrations:

```powershell
$secure = Read-Host -AsSecureString "Production Supabase secret key (Project Settings → API Keys → Secret key)"
$env:NEXT_PUBLIC_SUPABASE_URL = "https://peshoflxypujbzecgwqq.supabase.co"
$env:NEXT_PUBLIC_APP_URL = "https://app.maxoff.in"
$env:SUPABASE_SECRET_KEY = [Runtime.InteropServices.Marshal]::PtrToStringBSTR([Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure))
node scripts/bootstrap-owner.mjs --email "<the Owner's email>" --name "<Full Name>" --org "Pixora Clips"
Remove-Item Env:SUPABASE_SECRET_KEY, Env:NEXT_PUBLIC_SUPABASE_URL, Env:NEXT_PUBLIC_APP_URL
Remove-Variable secure
```

It prints the one-time link (`https://app.maxoff.in/auth/confirm?…`) to open within 24 hours: a
**Continue to MaxOff** page, and the Owner chooses the password after tapping it (the tap is what spends
the link, so a chat preview or a mail scanner cannot). A re-run is safe (it reuses the auth user and refuses once a
member exists: `CONFLICT`).

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
| `R2_ACCESS_KEY_ID` · `R2_SECRET_ACCESS_KEY` | The R2 API token scoped to that environment's files bucket (task 3.3, README → "Storage"); uploaded as `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` |
| `CRON_SECRET` | Any long random string; the Worker's cron trigger presents it to `/api/cron/*` |
| `SENTRY_AUTH_TOKEN` | Sentry → Settings → Auth Tokens. Optional: without it no source maps are uploaded |

Variables (**Environment variables**):

| Name | From |
|---|---|
| `NEXT_PUBLIC_APP_URL` | The app's address: `https://maxoff-staging.<subdomain>.workers.dev` on staging, **`https://app.maxoff.in`** on production |
| `R2_ACCOUNT_ID` · `R2_BUCKET` | The Cloudflare account id and the files bucket (`maxoff-files-staging` / `maxoff-files-production`) |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase → Project Settings → API Keys → Project URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Supabase → Project Settings → API Keys → Publishable key |
| `SUPABASE_PROJECT_REF` | Supabase → Project Settings → General → Reference ID |
| `NEXT_PUBLIC_SENTRY_DSN` | Sentry → Settings → Projects → maxoff → Client Keys (DSN). Optional: empty keeps Sentry off |
| `SENTRY_ORG` | Sentry organisation slug (Settings → General Settings). Optional |
| `SENTRY_PROJECT` | Sentry project slug, e.g. `maxoff`. Optional |

`NEXT_PUBLIC_APP_ENV` is set by the workflow itself (`staging` or `production`). `DAY_GATE_COOKIE_SECRET`
(2.2) is no longer read anywhere since the 3c.1 contract migration; delete it from both environments.

`RESEND_API_KEY` and `EMAIL_FROM` (app email: invites from 1.3, notification email from 5.2)
are **not** wired yet: they need a verified sending domain (`mail.maxoff.app`, see PROGRESS.md).
Until then the app logs a start-up warning and sends nothing. They stay out of CI on purpose.

### Inviting people (task 1.3)

People → **Invite** (Owner only): email, name, role (Admin or Crew) and job title. The app
creates the sign-in without a password (`auth.admin.generateLink`, type `invite`), writes the
member row as `invited` and shows the **invite link** once. The same link goes out by email when
`RESEND_API_KEY` is set; until a sending domain exists, copy it from the dialog and send it
yourself (WhatsApp is fine: the link opens a **Continue to MaxOff** page and is spent only when the
person taps Continue, so a chat preview or a mail scanner cannot use it up; it expires after 24 h).
**Copy invite link** on a pending row issues a fresh link and the previous one stops working. The
person opens the link, taps Continue, chooses a password and lands on their profile as an active
member.

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
4. `wrangler deploy --env <name> --secrets-file …`: the code and the Worker secrets (`SUPABASE_SECRET_KEY`,
   plus `SESSION_IP_HASH_SALT`, the `S3_*` set and `CRON_SECRET` when set) land in **one** deployment. They used
   to be uploaded first with `wrangler secret`, which Cloudflare refuses (error 10215) while the Worker's
   newest version is an undeployed branch preview — every push since task 2.0 leaves one.
5. `scripts/smoke-deploy.sh` against the deployed address (3c.1): `/api/health` answers `200 ok` (the database
   was reached), the signed-out `/today` redirect carries every security header, the Continue page a one-time
   link lands on (`/auth/confirm`, 3cB review) answers 200 with `no-store`, `noindex` and `no-referrer`, and on
   production `https://maxoff.pixoraclips.workers.dev` answers a 308 to `https://app.maxoff.in`. A failed smoke
   fails the run after the deploy: the Worker is live, so fix forward or roll back in the dashboard.

### Production runbook (3c.1)

Production is **`https://app.maxoff.in`** (kickoff 3c decision 3a): `wrangler.jsonc`'s production
environment connects `app.maxoff.in` to the Worker `maxoff` as a **Custom Domain** and keeps the
`workers.dev` address on only for the redirect. Nothing is ever added for the bare `maxoff.in`, `www`
(reserved for a landing page) or `mail.maxoff.in` (Resend's records).

- **Cloudflare API token.** A Custom Domain is created through the zone, so the token behind
  `CLOUDFLARE_API_TOKEN` needs, besides the "Edit Cloudflare Workers" template, **Zone → Workers
  Routes: Edit, DNS: Edit and SSL and Certificates: Edit** on `maxoff.in`. If the first tag deploy fails
  on the domain step with a permissions error, either add those to the token or attach the domain once by
  hand (Workers & Pages → maxoff → Settings → Domains & Routes → Add → Custom domain →
  `app.maxoff.in`) and re-run the deploy: wrangler then finds the route already in place.
- **Supabase Auth** (README → "Hosted auth settings"): Site URL `https://app.maxoff.in`, Redirect URL
  `https://app.maxoff.in/**`, custom SMTP through Resend on `mail.maxoff.in`, sender
  `MaxOff <noreply@mail.maxoff.in>`; "Forgot password works" is a step of the go-live smoke test.
- **First deploy:** tag a green commit on `main` (`git tag v1.0.0 && git push origin v1.0.0`), approve the
  `production` environment in GitHub, read the run's smoke step (the production job's checks the health
  route, the headers on a proxy redirect, the Continue page's headers and the workers.dev → `app.maxoff.in`
  308; the staging job's all but the 308). Then the Owner bootstrap (above), then UptimeRobot.
- **UptimeRobot:** an HTTP(S) monitor on **`https://app.maxoff.in/api/health`**, every 5 minutes, keyword
  `ok` optional. The route makes one cheap database round trip, so the free Supabase project never pauses
  (ADR-0003) and the monitor sees the database, not only the Worker.
- **By hand, any time:** `bash scripts/smoke-deploy.sh https://app.maxoff.in https://maxoff.pixoraclips.workers.dev`.
- **Backups** (3c.2): the next section and `docs/runbooks/backup-restore.md`.
- **Go-live (3c.3):** `docs/runbooks/go-live.md` is the whole stage-1 go-live in order, each step with what you
  should see: the first tag and deploy, the bootstrap, UptimeRobot, the two-day smoke test with a test member
  (Forgot password, the installed app, Copy invite link, Start day → approve, leave, a claim with a receipt,
  End day, the month, deactivation), the first backup and the production drill, the seeded defaults production
  starts with (only the Owner is entered), and the staff invites with a message to paste and the staff's
  one-page "Your first day with MaxOff" (`docs/guide/first-day.html`, printed with the guide by
  `docs/guide/build-pdf.ps1` on the laptop).

### Backups (3c.2)

`.github/workflows/backup.yml` runs every night at 02:00 IST (and on demand): `scripts/backup/dump.sh`
takes a `pg_dump` of the production database through the **session pooler**, encrypts it to the Owner's
**age** public key and uploads it to the private R2 bucket `maxoff-backups-production` (30-day retention:
the nightly run prunes objects older than 30 days, never below 7 and never the one it has just uploaded;
"Run workflow" takes another value, or blank to prune nothing and leave it to the bucket's lifecycle rule).
The private key never reaches CI; a restore is done on the Owner's machine with `scripts/backup/fetch.sh`
and `scripts/backup/restore.sh`, which verifies the rows, the migration list, RLS and the two pg_cron jobs
against the backup's manifest (ARCHITECTURE §17, the runbook). One-time setup, all by the Owner:

1. **The key pair.** Install [age](https://github.com/FiloSottile/age) (`winget install FiloSottile.age`,
   or `apt install age`), then `age-keygen -o maxoff-backup.key`. The file holds the private key: keep it
   **offline** (a password manager entry and a printed copy), never in the repository or a chat. The line
   `# public key: age1…` is the recipient, safe to share.
2. **The bucket.** Cloudflare → R2 → Create bucket `maxoff-backups-production` (location hint Asia-Pacific),
   private (no public access, no custom domain). Settings → Object lifecycle rules → add a rule that
   **deletes objects 31 days after upload** (the prefix can stay empty).
3. **The token.** R2 → Manage R2 API Tokens → Create: **Object Read & Write**, scoped to **that bucket only**
   (never the files bucket's token, which is scoped to `maxoff-files-production`). Note the Access Key ID and
   Secret Access Key.
4. **The GitHub environment `backup`** (Settings → Environments → New; **no required reviewer**, the job runs
   at night). Secrets: `SUPABASE_DB_PASSWORD` (the production database password: the `postgres` role, which
   reads **and writes** everything; hosted Supabase has no read-only role a dump could use, so whoever can run
   or edit this workflow holds a full database credential, and the environment has no reviewer by design),
   `BACKUP_R2_ACCESS_KEY_ID`, `BACKUP_R2_SECRET_ACCESS_KEY`. Variables: `SUPABASE_PROJECT_REF` (`peshoflxypujbzecgwqq`),
   `SUPABASE_DB_POOLER_HOST` (Supabase → project → Connect → **Session pooler**: the host, e.g.
   `aws-0-ap-south-1.pooler.supabase.com`; the user is `postgres.<ref>` and the workflow builds it),
   `R2_ACCOUNT_ID`, `BACKUP_R2_BUCKET` (`maxoff-backups-production`), `BACKUP_AGE_RECIPIENT` (the `age1…` line).
5. **Prove it:** Actions → Backup → Run workflow. The run's summary names the object. Then the
   production restore drill (the runbook) once, after the first production deploy, and every quarter.
   Locally, `bash scripts/backup/drill.sh` rehearses both restore modes against the local stack.
   **At that first run, turn certificate verification on** (`backup.yml`'s `BACKUP_DATABASE_URL` ships
   with `sslmode=require`, which encrypts but does not verify the pooler's certificate, because its
   chain is unknown until the first hosted run): if the pooler's certificate is publicly signed, switch
   to `sslmode=verify-full sslrootcert=system` (libpq 16+; the dump runs from the `postgres:17` image);
   otherwise download Supabase's CA (Dashboard → Database → SSL), commit it as
   `scripts/backup/supabase-ca.crt`, mount it into the client container (`-v
   "$PWD/scripts/backup:/certs:ro"` on `PG_DUMP` and `PSQL`) and pass `sslrootcert=/certs/supabase-ca.crt`
   with `sslmode=verify-full`. The runbook's "What runs every night" says the same.
6. On the 1st of each month the same workflow opens a "Monthly Supabase usage check" issue with ADR-0003's
   thresholds (~4 GB transfer, ~400 MB database); tick and close it.

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

**Staging migrations.** A preview build never runs migrations; the `staging migrations` job
does, before the build, on every push to a `phase-*` branch (and by hand: **Actions → Preview → Run
workflow →** the branch **→ `staging-migrations`**; it refuses `main`, whose migrations go out with
the staging deploy). It runs `scripts/staging-migrations.sh`, as `deploy.yml`'s staging job does:
list staging's migrations, apply only the ones staging is missing (also while staging holds another
open branch's versions: those get empty stand-ins in a scratch copy, so the CLI's history check
passes; nothing is ever repaired or reverted), then list again. It shares a concurrency group with
the staging deploy so it can never race one. Staging is shared and migrations are append-only, so
what it applies stays there; when two open branches re-create the same function, staging runs the
one applied last and the job warns naming both files. Branches other than `phase-*` preview against
a staging database that may lack their migrations, and the PR comment says so.

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
`workflow_dispatch` from the default branch only.

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

### Installing on a phone (PWA)

Open the app and use **Add to home screen** / **Install app**. The installed shell is not the
browser: it takes its status-bar band from the **manifest's `theme_color`**, and a manifest has
exactly one, which cannot vary by colour scheme.

That is why `theme_color` and `background_color` deliberately differ (`public/manifest.webmanifest`,
asserted in `pwa-files.test.ts`):

| Field | Token | Why |
|---|---|---|
| `theme_color` | **dark** `--background` | The installed band. MaxOff is dark-first on phones, and a dark band above a light app reads as an intentional header, where a light band above a dark app reads as broken. Chrome picks the glyph colour from this value's luminance, so the clock stays readable in both themes |
| `background_color` | **dark** `--background` | The Android splash while the app starts. Same value as `theme_color` on purpose: a light splash handing over to a dark app is the white flash the band fix was meant to end |

The `<meta name="theme-color">` pair in the root layout — plus `ThemeColorMeta`, which rewrites it
when someone picks Light or Dark explicitly — governs **Chrome's tab toolbar**, not the installed
shell. Confirmed on a Galaxy S23: the toolbar follows the in-app theme, the installed band does not.

**Testing a manifest change: install from a fresh origin.** A branch preview URL
(`https://<branch>-maxoff-staging.<subdomain>.workers.dev`) is a different origin with an empty
HTTP cache and no service worker, so what you install is definitely the current manifest. This is
the reliable test, and it is why previews are worth having for more than screenshots.

Uninstall-and-reinstall on the *same* origin is **not** reliable: the browser can hand the install
a manifest it still holds in its HTTP cache, so the reinstalled app shows the old name, icons or
band and the change looks like it failed. That is exactly what happened in 1.5, four rounds of it,
because `/manifest.webmanifest` was served with `max-age=3600`.

Both caching layers are now fixed and covered by `pwa-files.test.ts`:

| File | Cache-Control | Service worker |
|---|---|---|
| `/manifest.webmanifest` | `no-cache, must-revalidate` | never cached |
| `/icons/*` | `public, max-age=0, must-revalidate` | stale-while-revalidate — the names are stable, not content-hashed, so a changed icon heals on the next load |
| `/_next/static/*` | `immutable`, one year | cache-first, correctly: those names carry a content hash |
| `/sw.js` | `no-cache` | n/a |

A stale manifest or icon fails **silently** — the app just keeps the old value — so these are
asserted rather than left to review.

**iOS is different again** and is not covered by any of this: an installed iPhone app takes its
status bar from `apple-mobile-web-app-status-bar-style`, which is `default` on purpose (see
PROGRESS). That needs its own check on real hardware before the 6.6 pilot.

## Storage (task 3.3)

Uploaded files (the company logo and avatars now; client logos in 3.4, work submissions in
phase 5) live in an S3-compatible bucket behind one adapter (`src/core/storage`,
ARCHITECTURE §11). **Local development and every e2e run use MinIO in Docker**; staging and
production use Cloudflare R2. The app reads the same five variables everywhere
(`S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_REGION`; see
`.env.example`).

```bash
pnpm storage:start           # MinIO on http://127.0.0.1:9000 (console :9001), bucket `maxoff`, CORS for :3000 and :3100
pnpm storage:stop
```

The compose file (`docker-compose.storage.yml`) creates the private bucket itself and allows
browser uploads from `next dev` and the Playwright server; the values in `.env.example` match
it. CI's `e2e` job runs the same compose file. A preview or thumbnail is served by the app
(`/api/files/<id>`, permission-checked, privately cached); a download is a 5-minute presigned
link; an SVG is rewritten from an allow-list on upload.

**R2 (staging and production).** The owner creates the bucket and an API token with object
read and write on it, and sets the bucket's CORS to allow `PUT` from the app's origin (the
Worker URL, later the custom domain) with `ETag` exposed. The GitHub environment then holds
`R2_ACCOUNT_ID` and `R2_BUCKET` (variables) and `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` and
`CRON_SECRET` (secrets); the deploy workflow maps them onto the `S3_*` names as Worker
secrets (all five in the deploy's secrets file, nothing in `vars`), with
`S3_ENDPOINT = https://<R2_ACCOUNT_ID>.r2.cloudflarestorage.com` and `S3_REGION = auto`. A
branch preview (`wrangler versions upload`) keeps the staging Worker's secrets, so previews
upload to the staging bucket. `storage_cleanup` runs daily from the Worker's cron trigger
(`wrangler.jsonc` `triggers.crons` in every environment, `worker/index.js` →
`/api/cron/storage-cleanup` with `CRON_SECRET`); `wrangler.jsonc`'s `main` is
`worker/index.js`, which re-exports OpenNext's handler and adds `scheduled`.

**Staging is set up (owner, 2026-09-27):** bucket `maxoff-files-staging` (APAC, private), an
API token scoped to that bucket, CORS with origins
`https://maxoff-staging.pixoraclips.workers.dev` and the wildcard
`https://*-maxoff-staging.pixoraclips.workers.dev` (R2 accepts it, so every branch preview can
upload directly), methods `GET`, `PUT`, `HEAD`, allowed headers `content-type`, `content-md5`,
`x-amz-*`, `ExposeHeaders: ETag`. The `staging` GitHub environment holds the secrets
`R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `CRON_SECRET` and the variables `R2_ACCOUNT_ID`,
`R2_BUCKET`. The production bucket exists; its token, CORS and GitHub secrets wait for the
production domain. `deploy.yml` still has to map these names into the secrets file (see
PROGRESS → "Things the next session must know").

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
