# Runbook: the secrets register

Every secret MaxOff runs on: **its name only**, where it lives, what it is for, how to rotate it, and when
it expires. Gap audit 6 (`docs/reviews/6b20b-gap-audit.md`): an expired token silently breaks deploys and
backups, which is what happened on 22 Oct 2026.

**Never write a value here**, not even part of one. Values live only in the place named in the "Set in"
column, and are entered there by the Owner through the web page (CLAUDE.md, engineering rule 10).

The names come from the workflows (`secrets.X` in `.github/workflows/`), `.env.example`, `wrangler.jsonc`
and the README's "Secrets and variables the workflow expects" and "Backups". Not-secret settings
(`NEXT_PUBLIC_*`, `SUPABASE_PROJECT_REF`, `R2_ACCOUNT_ID`, `R2_BUCKET`, `EMAIL_FROM`, `VAPID_PUBLIC_KEY`,
`VAPID_SUBJECT`, `BACKUP_AGE_RECIPIENT`, …) are GitHub environment **variables** and are not listed.

## How the expiry reminder works

`.github/workflows/ops-check.yml` reads the table below on the 1st of each month (IST). Every row whose
**Expiry** cell holds a date (`YYYY-MM-DD`) within 60 days, or already past, is listed in a comment on that
month's "Monthly Supabase usage check" issue. `none` means it never expires; any other cell without a date is
counted as unknown.

**Owner:** replace each "unknown – Owner to fill" with the date the dashboard shows when you next open it
(or `none` when the key never expires), and change a date whenever you rotate. Keep the table's shape: the
name is the first cell and the expiry the last, between the two `register` markers.

## Where secrets live

- **GitHub environments** (repository Settings → Environments): `staging`, `production` (required reviewer:
  the Owner) and `backup` (no reviewer: the nightly job cannot wait). Most names exist in both `staging`
  and `production` with **different values**; the table has one row per name, so rotating means doing it in
  each environment named.
- **Cloudflare Worker secrets** (`maxoff-staging`, `maxoff`): never set by hand. `deploy.yml` writes them at
  each deploy from the GitHub environment (`--secrets-file`; `SUPABASE_SECRET_KEY`, `SESSION_IP_HASH_SALT`,
  the `S3_*` set from `R2_*`, `CRON_SECRET`, `RESEND_API_KEY`, `VAPID_PRIVATE_KEY`). So **a rotated value
  reaches production only with the next production deploy**, which is a `v*` tag the Owner makes and
  approves. Staging gets it on the next green `main`.
- **Supabase dashboard:** the Auth SMTP password (a Resend key).
- **Offline, with the Owner:** the backup's age private key.

## The register

<!-- register:start -->

| Name | Environment | What it is for | Set in | How to rotate | Expiry |
|---|---|---|---|---|---|
| `SUPABASE_ACCESS_TOKEN` | GitHub `production` | Supabase CLI in `deploy.yml`: lists and applies production migrations | GitHub → Settings → Environments → production → secrets | Supabase → Account → Access Tokens → generate a new token scoped to the production project. It must allow the database pooler config (`/config/database/pooler`), or migrations fail with "IPv6 is not supported". Paste it, then revoke the old one | 2027-10-22 (approx.: a 1-year token made 22 Oct 2026; Owner to confirm the exact date) |
| `SUPABASE_ACCESS_TOKEN` | GitHub `staging` | Supabase CLI in `deploy.yml` and `preview.yml` (staging migrations, dry runs) | GitHub → Settings → Environments → staging → secrets | As above, scoped to the staging project only. Gap audit 6: the old staging token was account-wide; check the new one is not | 2027-10-22 (approx.: a 1-year token made 22 Oct 2026; Owner to confirm the exact date) |
| `SUPABASE_DB_PASSWORD` | GitHub `production` and `backup` (same value), `staging` (its own) | The `postgres` role's password: migrations (`deploy.yml`), the nightly dump (`backup.yml`) | GitHub → Settings → Environments → each one named | Supabase → project → Project Settings → Database → reset the password, then update **both** `production` and `backup` the same hour (otherwise that night's backup fails), and run Actions → Backup → Run workflow to prove it | unknown – Owner to fill |
| `SUPABASE_SECRET_KEY` | GitHub `staging`, `production`; Worker secret | The server's key that bypasses RLS: jobs, cron routes, notifications, invites; the staging perf probe | GitHub → Settings → Environments; reaches the Worker at deploy | Supabase → Project Settings → API Keys → create a new secret key, update GitHub, deploy (production: the Owner's next tag), then delete the old key in Supabase | unknown – Owner to fill |
| `CLOUDFLARE_API_TOKEN` | GitHub `staging`, `production` | `wrangler deploy` and the preview uploads; production also attaches the `app.maxoff.in` custom domain | GitHub → Settings → Environments | Cloudflare → My Profile → API Tokens → roll or create one ("Edit Cloudflare Workers" template, plus Zone → Workers Routes, DNS and SSL and Certificates: Edit on `maxoff.in` for production; README "Production runbook"), update GitHub, then delete the old token | unknown – Owner to fill |
| `CLOUDFLARE_ACCOUNT_ID` | GitHub `staging`, `production` | The account `wrangler` deploys to (an identifier, kept as a secret) | GitHub → Settings → Environments | Does not rotate | none |
| `SENTRY_AUTH_TOKEN` | GitHub `staging`, `production` | Source-map upload at deploy (`scripts/worker-sourcemaps.mjs`); optional | GitHub → Settings → Environments | Sentry → Settings → Auth Tokens → new token (scopes `project:releases`, `org:read`), update GitHub, revoke the old one. A missing or bad token only skips the upload | unknown – Owner to fill |
| `SESSION_IP_HASH_SALT` | GitHub `staging`, `production`; Worker secret | Salts the IP hash stored in `session_events` | GitHub → Settings → Environments | A new random string (`openssl rand -hex 32`, on the Owner's laptop), then deploy. Older hashes simply stop matching new ones | none |
| `R2_ACCESS_KEY_ID` | GitHub `staging`, `production`; Worker secret `S3_ACCESS_KEY_ID` | The files bucket (`maxoff-files-staging` / `maxoff-files-production`): uploads, downloads, cleanup | GitHub → Settings → Environments | Cloudflare → R2 → Manage R2 API Tokens → create a token, Object Read & Write, scoped to that files bucket only; update both R2 names, deploy, then delete the old token | unknown – Owner to fill |
| `R2_SECRET_ACCESS_KEY` | GitHub `staging`, `production`; Worker secret `S3_SECRET_ACCESS_KEY` | The other half of the files bucket token | GitHub → Settings → Environments | Rotates with `R2_ACCESS_KEY_ID` | unknown – Owner to fill |
| `CRON_SECRET` | GitHub `staging`, `production`; Worker secret | The Worker's cron trigger presents it to `/api/cron/*` | GitHub → Settings → Environments | A new random string, then deploy. Trigger and route read the same Worker secret, so they change together | none |
| `RESEND_API_KEY` | GitHub `staging`, `production`; Worker secret | App email: invites and notification email from `mail.maxoff.in` | GitHub → Settings → Environments | Resend → API Keys → create a key allowed to send from `mail.maxoff.in`, update GitHub, deploy, then delete the old key | unknown – Owner to fill |
| `VAPID_PRIVATE_KEY` | GitHub `staging`, `production`; Worker secret | Signs Web Push messages | GitHub → Settings → Environments | Only if it leaked: a new pair on the Owner's laptop, update `VAPID_PRIVATE_KEY` and the variable `VAPID_PUBLIC_KEY` together, deploy. **Every phone must then turn notifications on again** (old subscriptions stop): tell the team first | none |
| `BACKUP_R2_ACCESS_KEY_ID` | GitHub `backup` | The backup bucket `maxoff-backups-production` (the nightly upload and pruning) | GitHub → Settings → Environments → backup | Cloudflare → R2 → Manage R2 API Tokens → create a token, Object Read & Write, scoped to the backup bucket only; update both backup R2 names, run Actions → Backup → Run workflow, then delete the old token | unknown – Owner to fill |
| `BACKUP_R2_SECRET_ACCESS_KEY` | GitHub `backup` | The other half of the backup bucket token | GitHub → Settings → Environments → backup | Rotates with `BACKUP_R2_ACCESS_KEY_ID` | unknown – Owner to fill |
| Auth SMTP password | Supabase (each project) | Supabase Auth's own emails (password links) through Resend SMTP | Supabase → Authentication → Emails → SMTP settings | Resend → API Keys → a new key, paste it as the SMTP password, send yourself a "Forgot password" email, then delete the old key | unknown – Owner to fill |
| age private key (`maxoff-backup.key`) | Offline, with the Owner | Decrypts the backups for a restore | The Owner's password manager and a printed copy | Only if it leaked: `age-keygen` a new pair, update the variable `BACKUP_AGE_RECIPIENT` in `backup`, keep the old key until the last old backup has aged out (31 days) | none |

<!-- register:end -->

`GITHUB_TOKEN` is not in the table: GitHub makes a fresh one for every run, with only the permissions the
workflow asks for.

## Rotation log

Record every rotation here (date, name, environment, why). Never the value.

| Date | Name | Environment | Why |
|---|---|---|---|
| 2026-10-22 | `SUPABASE_ACCESS_TOKEN` | `staging`, `production` | The old tokens expired and broke deploys; replaced with 1-year scoped tokens (gap audit 6) |
