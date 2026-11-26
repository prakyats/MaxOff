# Runbook: a secret may have leaked (rotate it the same day)

**Owner decision (26 Nov 2026, v7.5 Q5):** MaxOff's secrets are rotated **only on suspicion**. There is no
scheduled rotation. This runbook is what makes that safe: when a leak is suspected, the secret is replaced the
**same day**, in this order, without guessing.

`secrets.md` is the register: every secret's name, where it lives, and the exact steps to make a new one. This
runbook says **when** to use it and **in what order**, and how to get the new value to production at once.
**Never write a value here, in chat, in an issue or in a commit**, not even part of one (CLAUDE.md,
engineering rule 10).

Marked _(unverified)_: a dashboard step the repository cannot show. Follow the dashboard if it differs, and
correct this file.

## When to use it

Rotate a secret when there is a **reason to think someone else has it**, for example:

- its value was pasted somewhere it should not be: a chat, an email, an issue, a pull request, a log or a
  screenshot;
- it was committed to git, even on a branch that was deleted (deleting does not remove it from history);
- a laptop, phone or password manager that held it was lost or broken into;
- a provider (GitHub, Cloudflare, Supabase, Resend, Sentry, Google) says it was exposed, or shows activity
  nobody here did;
- the Owner decides a person who had access should no longer have it.

If you are not sure, treat it as leaked: a rotation costs about 15 minutes, and a leaked key can cost the
business's data.

## The order: what to rotate first

Start with the secrets that give the most access. If you do not know which one leaked, rotate everything
in the rows that place could have held, top to bottom.

| Order | Secret (`secrets.md` row) | Why first | What stops while it changes |
|---|---|---|---|
| 1 | `SUPABASE_SECRET_KEY` | Reads and writes **every** table past RLS, money included | Nothing, if the new key is in place before the old one is deleted |
| 2 | `SUPABASE_DB_PASSWORD` | The database itself | Migrations and that night's backup, until both `production` and `backup` have the new value |
| 3 | `SUPABASE_ACCESS_TOKEN` | Supabase CLI on the project | Deploys' migration step |
| 4 | `CLOUDFLARE_API_TOKEN` | Deploys a Worker, so it could replace the app | Deploys and previews |
| 5 | `R2_ACCESS_KEY_ID` + `R2_SECRET_ACCESS_KEY` | Every uploaded file and receipt | Uploads and downloads, for the minutes between the two steps |
| 6 | `BACKUP_R2_*` and the age private key | The backups (the age key decrypts them) | That night's backup, until the new token is in `backup` |
| 7 | `RESEND_API_KEY` and the Auth SMTP password | Sending email as `mail.maxoff.in` | Invites, notification email and password links |
| 8 | `CRON_SECRET` | Starts the scheduled jobs | Nothing: the trigger and the route read the same Worker secret |
| 9 | `VAPID_PRIVATE_KEY` | Sending push messages to the team's phones | **Every phone must turn notifications on again**: tell the team first |
| 10 | `SENTRY_AUTH_TOKEN`, `SESSION_IP_HASH_SALT` | Low: source-map uploads; old IP hashes stop matching | Nothing the team notices |

The Owner's own sign-ins (GitHub, Cloudflare, Supabase, Google, Resend, Sentry) come **before all of these**
if the leak was a device or a password manager: change those passwords and turn on two-factor sign-in
where it is off, then rotate the keys those accounts can see.

## The steps, for each secret

1. **Make the new value** exactly as the secret's row in `secrets.md` says (a new key in the provider's
   dashboard, or a new random string with `openssl rand -hex 32` on the Owner's laptop). Do not delete the
   old one yet.
2. **Put it where it is used, in every environment named in the row** (`staging`, `production`, `backup`):
   GitHub → Settings → Environments → the environment → the secret → Update.
3. **Production at once, for a Worker secret** (`SUPABASE_SECRET_KEY`, `SESSION_IP_HASH_SALT`, the `S3_*`
   set, `CRON_SECRET`, `RESEND_API_KEY`, `VAPID_PRIVATE_KEY`). Normally a new value reaches the Worker only
   with the next production deploy, a `v*` tag. For a leak, do not wait for one:
   - Cloudflare dashboard → Workers & Pages → `maxoff` → Settings → Variables and Secrets → the secret →
     **Edit**, paste the new value, **Deploy** _(unverified: check the menu names)_. This changes the
     **running** app's secret, not its code, so it is not a release.
   - Step 2 is what keeps it: the next deploy writes the Worker's secrets from GitHub again, so a value set
     only in Cloudflare would be put back to the old one.
   - Staging the same way (`maxoff-staging`), or on the next green `main`.
4. **Check it works** (next section).
5. **Only then revoke the old value** in the provider's dashboard (delete the old key or token). Until this
   step the leaked value still works.
6. **Write it down:** a row in `secrets.md` → "Rotation log" (date, name, environments, why; **never the
   value**), the new expiry date in the register, and one line in `docs/PROGRESS.md`.

## Check it works

| Rotated | Check |
|---|---|
| `SUPABASE_SECRET_KEY` | `https://app.maxoff.in/api/health` says `ok`; sign in as yourself; open Today |
| `SUPABASE_DB_PASSWORD` | Actions → **Backup** → Run workflow: it goes green |
| `SUPABASE_ACCESS_TOKEN`, `CLOUDFLARE_API_TOKEN` | The next Preview or staging deploy goes green |
| `R2_*` | Open a task with an attachment and download it; upload a receipt on staging |
| `BACKUP_R2_*` | Actions → **Backup** → Run workflow: it goes green |
| `RESEND_API_KEY`, SMTP password | "Forgot your password?" on `/login` for your own account: the email arrives |
| `CRON_SECRET` | The next morning's digest and reminders arrive (or Actions → the staging cron check, if run) |
| `VAPID_PRIVATE_KEY` | Me → Notifications → "Send test" arrives on your phone after turning notifications on again |

If a check fails, put the **new** value in again (step 2 and step 3); do not go back to the leaked one.

## If the leaked value was in git

Rotating is the fix: once the old value is revoked, the copy in git is harmless. Do **not** rewrite the
repository's history to remove it (that breaks every branch and does not undo the leak). Write the commit
in the rotation log's "Why".

## Who to tell

- **The Owner, always**, before step 1 if a session or Admin found the leak.
- **The team**, only when they will notice: a `VAPID_PRIVATE_KEY` rotation ("turn notifications on again
  in Me"), or email or uploads stopping for a few minutes.
- If someone may have **used** the leaked secret, it is an incident: `incident.md` → "A lost phone or a
  stolen account", the activity log, and a postmortem (`postmortem-template.md`).

## Related

- `secrets.md`: the register, the steps for each secret, the expiry reminder, the rotation log.
- `incident.md`: when something broke, not only leaked.
- `docs/handoff/v7.5-plan.md` §2.7: the secret scan of the git history.
