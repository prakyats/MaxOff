# Runbook: incidents

What to do when something goes wrong on production (`https://app.maxoff.in`). Each section is **symptom →
first check → fix → who to tell**. Gap audit 14 (`docs/reviews/6b20b-gap-audit.md`).

Ground rules (CLAUDE.md, "Production is live"):

- **Nothing is run against the production database** by a session: no seed, reset, `migration repair` or
  hand-written SQL. Reading in the Supabase dashboard is the Owner's.
- **Only the Owner tags `v*` and approves a production deploy.** A session can prepare a fix on a branch
  and a PR; it never releases.
- **A bad release is fixed the same day**: roll back the Worker or fix forward with a new tag, and say so
  in `docs/PROGRESS.md`.
- Afterwards, anything that hurt the team gets a short write-up from `postmortem-template.md`.

**Marked _(unverified)_:** a step in a dashboard that the repository cannot show. The menu names are
believed right but have not been checked from here; follow the dashboard if it differs, and correct this
file.

Who is who: the **Owner** gets every alert (UptimeRobot, GitHub issues, Sentry email) and makes every
production decision. The **team** (Admins and Crew) is told on the usual team chat when they will notice.

---

## The site is down

**Symptom:** UptimeRobot emails the Owner that `https://app.maxoff.in/api/health` is down (it polls every
5 minutes; README "Production runbook", `go-live.md` §3). Or people say the app does not open.

**First check**

1. Open `https://app.maxoff.in/api/health` in a browser.
   - `ok`: the Worker and the database answer. It was a blip, or the problem is one person's phone or
     network. Ask them to reload; if the installed app is stuck, close and reopen it.
   - `unavailable` (HTTP 503): the Worker runs, but **could not reach the database** within 5 s
     (`src/core/db/health.ts`).
   - No answer, or a Cloudflare error page: the **Worker** is the problem.
2. For `unavailable`: Supabase dashboard → the production project. Is it **paused** (free plan: 7 idle
   days)? Is there an incident at status.supabase.com? Is the project over a free-plan limit (Usage
   page)? _(unverified: check in the dashboard)_
3. For a Worker problem: Cloudflare dashboard → Workers & Pages → `maxoff` → Deployments: did a deploy
   just happen? Then Logs (Workers Logs are on, `wrangler.jsonc` `observability`). Cloudflare's status page
   for an outage. _(unverified: check in the dashboard)_
4. Did the last GitHub Actions **Deploy** run fail at its smoke step? Then the new Worker is live and
   broken: see "A bad release".

**Fix**

- Supabase paused: restore (unpause) the project in the dashboard. _(unverified)_
- The Worker cannot reach the database right after a deploy: the deploy's `SUPABASE_SECRET_KEY` (README
  `go-live.md` §3). See "A bad release".
- A provider outage (Supabase or Cloudflare): nothing to fix on our side; wait and watch the status page.
- Database gone or damaged: restore from the nightly backup (`backup-restore.md`). This is the Owner's,
  on the Owner's machine.

**Who to tell:** the team, if it lasts more than about 15 minutes: "MaxOff is down, we are on it. Note
your start time and anything urgent on paper; nothing you did before is lost." Then "it's back".

---

## Errors spiking (Sentry)

**Symptom:** Sentry emails a new issue, an issue seen more than 10 times in an hour, or a regression
(rules in `sentry-alerts.md`). Or several people report "Something went wrong".

**First check**

1. Sentry → Issues, environment `production`: which issue, how many events, how many users, since when.
2. Its **release** tag: is it the release that just went out? Then it is probably "A bad release".
3. The stack trace (source maps are uploaded at deploy, README "Confirming the Sentry pipeline"). Sentry
   events carry no PII or money (`src/core/observability/scrub.ts`), so the trace and the route are what
   you have; ask the person who hit it what they tapped.
4. Errors that all say the database timed out or refused: check `/api/health` and the Supabase project,
   as in "The site is down".

**Fix**

- Caused by the new release: "A bad release".
- Older and narrow (one screen, one person): a normal PR with the fix and a test; ship it with the next
  release, or a patch tag if it blocks work.
- A token that expired (deploys, uploads or email fail at once): `secrets.md`, rotate it.
- Noise, not harm (a bot, a browser extension): mark it resolved or ignored in Sentry, and say why in the
  issue.

**Who to tell:** the Owner always. The team only if they are blocked, with what to do meanwhile.

---

## A bad release

**Symptom:** right after a production deploy, the app is broken or wrong for people: the Deploy run's
smoke step failed, Sentry errors spike with the new release tag, UptimeRobot alerts, or the team reports it.

**First check**

1. Is it the release? Compare the time with the Deploy run (Actions → Deploy) and Sentry's release tag.
2. How bad: does it block work (Start day, leave, tasks), or is it cosmetic?

**Fix: choose one, the same day**

- **Roll back the Worker** (fastest, minutes). Cloudflare dashboard → Workers & Pages → `maxoff` →
  Deployments → the previous deployment → roll back to it _(unverified: the exact button name; README and
  `go-live.md` name this page)_. This is **safe because migrations are expand-only**: the previous Worker
  never needed a column the new migration removed, because nothing is removed (CLAUDE.md). The database
  is **not** rolled back and must not be: no `migration repair`, no hand-written SQL.
  - The rolled-back Worker keeps the secrets of the deployment it goes back to _(unverified: check in
    the dashboard)_. If a secret was rotated in the bad release, check the app still answers.
  - The next `v*` tag deploys forward again, so the rollback holds only until the fix is tagged.
- **Fix forward:** a PR with the fix, its tests and full CI green on `main`, then the **Owner** tags the
  next `v*` patch (for example `v2.0.1`) and approves the `production` environment. No session tags or
  approves.

**Afterwards:** write in `docs/PROGRESS.md` what happened and which way it was fixed (CLAUDE.md). A
postmortem if the team was hit.

**Who to tell:** the team: what they may have seen, that it is fixed, and whether anything they entered
during the window needs a second look.

---

## Push or email not arriving

**Symptom:** someone says "I never got the notification" or "the email never came".

**First check**

1. **The bell.** Every notification is always in the app (the bell), whatever happens to push and email.
   If it is in the bell, the app worked; only the delivery is missing.
2. **Quiet hours.** Push is held from 22:00 to 07:00 IST and summed up at 07:00 (PRODUCT, kickoff 5).
3. **Push, on that person's phone:** Me → "Your devices": is this phone listed, and does it say why one
   stopped? Me → Help & troubleshooting → **Send a test notification** (once per 30 s). On iPhone, push
   works only in the installed app (README "Installing on a phone").
4. **Email:** only actionable kinds are emailed, at most 20 per person and 90 for the organisation a day
   (`skipped_cap` above that). Resend dashboard → Emails: was it sent, delivered, bounced?
   _(unverified: check in the dashboard)_
5. **The delivery record** (Owner, read-only): Supabase dashboard → Table editor →
   `notification_deliveries` for that notification: `state`, `attempts`, `last_error`
   (`not_configured` = the key is missing; `resend_<status>` = Resend refused). Failed deliveries retry at
   1, 5, 15 and 60 minutes, then stay `failed`. Look only; never edit rows. _(unverified: check in the
   dashboard)_
6. **Password-link emails** ("Forgot password") are Supabase Auth's, sent through Resend SMTP: Supabase →
   Authentication → Emails → SMTP settings. _(unverified)_

**Fix**

- One phone: turn notifications on again from the band or Me ("Turn on"), then send a test.
- Everyone's push stopped at once: `VAPID_*` missing or changed in the last deploy (`secrets.md`).
- Every email fails: `RESEND_API_KEY` expired or revoked, or the `mail.maxoff.in` domain lost its
  verification in Resend. Rotate the key (`secrets.md`); it reaches production with the next tag.
- Daily cap reached: nothing is lost (the bell has it); the cap resets the next day.

**Who to tell:** the person who asked. If push or email is down for everyone, the team: "check the bell
in MaxOff until we say it's fixed".

---

## A backup failed

**Symptom:** a GitHub issue titled **"Backup failed"**, opened or commented on by `backup.yml` (the night
it failed) or `ops-check.yml` (09:00 IST, when no green nightly run exists in the last 36 hours, which
also catches a night it never ran).

**First check**

1. Open the run linked in the issue (Actions → Backup). Which step is red?
   - **Dump, encrypt and upload**, with a connection or authentication error: the database password or the
     pooler host changed, or Supabase was down that night.
   - The same step with an R2 / S3 error: the backup bucket token (`BACKUP_R2_*`) expired or was revoked.
   - **Install age** or **Pull the Postgres 17 client**: a temporary runner problem.
2. No run at all ("No scheduled backup ran"): Actions → Backup. Is the workflow **disabled**? (GitHub turns
   off schedules in a repository with no activity for 60 days.) Was there a GitHub Actions outage?

**Fix**

- Actions → Backup → **Run workflow** (blank or `30` for retention). A green run proves the fix and gives
  today's restore point.
- A password or token problem: rotate it as `secrets.md` says (the database password lives in **both**
  `production` and `backup`), then Run workflow.
- Disabled schedule: enable the workflow, then Run workflow.
- Close the "Backup failed" issue once a run is green.

One missed night is not an emergency (31 days of backups stay in the bucket). Two nights running is: fix it
that day.

**Who to tell:** nobody else; it is invisible to the team. Note it in the month's usage-check issue.

---

## A lost phone or a compromised account

**Symptom:** someone lost a phone that is signed in to MaxOff, or thinks someone else knows their password
or used their account. MaxOff keeps people signed in with no time limit (ADR-0012), so a lost phone stays
signed in until something ends its session.

**First check:** whose account? Their role (Owner, Admin, Crew)? When was the phone lost, and was it
locked?

**Fix: a member (Admin or Crew)**

1. **End every session now.** People → the person → **Deactivate**. It deletes their sessions and refresh
   tokens inside the transition, so the lost phone's next request ends at sign-in (README "Inviting
   people", ADR-0012). Nothing they recorded is lost.
2. **Reactivate** them when they have a safe device. They sign in again with their password.
3. If the **password** may be known: before they sign in again, they use "Forgot your password?" on
   `/login` and choose a new one (the link lasts 24 h, once).
4. **Notifications to the lost phone:** on their new device, Me → "Your devices" → **Remove** the lost
   phone, so push stops going to it.

**Fix: the Owner's own account**

The Owner cannot deactivate themselves. From a safe device:

1. Change the password: "Forgot your password?" on `/login` (sign out of the safe device first if needed).
   A new password alone may not end the lost phone's session.
2. End the other sessions: Supabase dashboard → Authentication → Users → the Owner → sign the user out /
   revoke sessions _(unverified: check in the dashboard whether this exists on the free plan)_.
3. Me → "Your devices" → **Remove** the lost phone.
4. If the Owner's GitHub, Cloudflare, Supabase, Resend or Sentry sign-ins were on that phone, change those
   passwords too, and rotate any token you think was exposed (`secrets.md`).

**Who to tell:** the person; the Owner always. If an account was used by someone else, the Owner reviews
what changed (each record's history and the activity log) and writes a postmortem.

---

## After any incident

- `docs/PROGRESS.md`: one line with the date, what happened and the fix (production changes always).
- A postmortem (`postmortem-template.md`) when the team was hit, data was wrong, or it could happen again.
- New ideas go in PROGRESS.md under "Ideas / tech debt".
