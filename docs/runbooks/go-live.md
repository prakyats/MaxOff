# Runbook: go-live, stage 1 (3c.3)

Stage 1 puts attendance, leave, comp leave, expense claims, the month summary, clients and people into
production at **`https://app.maxoff.in`** (kickoff 3c decisions and their amendment in PROGRESS). This
page is the whole go-live, in order: the release, the Owner account, the uptime monitor, the smoke test,
the first backup and restore drill, what data production starts with, and the staff invites. Every step
is the Owner's, done after the phase 3c pull request has merged. **Nothing here is run from a Claude
session**, and no secret ever goes into a chat, a file or a session.

Each step says what to do, what you should see, and where to look when you don't. Write the date and
the result of each step into "Go-live record" at the end.

| Step | What | When |
|---|---|---|
| 1 | The first `v*` tag and the production deploy | After the 3c merge, with CI green on `main` |
| 2 | The Owner account (bootstrap) | Right after the deploy |
| 3 | UptimeRobot on the health route | Right after the deploy |
| 4 | The smoke test with a test member | Day A (join) and day B (the next working day) |
| 5 | The first backup and the production restore drill | After day A, any time before the staff invites |
| 6 | Go-live data: the Owner only, seeded defaults kept | Read before the invites |
| 7 | The staff invites | **Only after steps 1–5 passed** |
| 8 | Push onboarding: every person, every phone | At each invite, and whenever someone gets a new phone |

## Before you start

- The phase 3c pull request is merged into `main`, and **CI on `main` is green** for that commit:
  Actions → CI → the run for it shows the three checks `typecheck · lint · format · unit · build`,
  `pgTAP` and `playwright` as success. The staging deploy after it is green too (Actions → Deploy).
- The owner-side setup from the kickoff is done: the GitHub environments `production` and `backup`, the
  Cloudflare token's zone permissions on `maxoff.in`, the age key pair (private key offline), Resend SMTP
  and the "Reset password" template on the production Supabase project (README → "Hosted auth
  settings", "Production runbook (3c.1)", "Backups (3c.2)").
- On the laptop: the repository up to date (`git checkout main && git pull`), Node and `pnpm install`
  done, PowerShell.
- **The two PDFs, rebuilt on the laptop.** The committed app guide PDF is behind its HTML after the 3c merge,
  and the staff page's PDF does not exist yet (PDFs are printed with Edge only, for the Windows fonts). Run
  `powershell -NoProfile -ExecutionPolicy Bypass -File docs/guide/build-pdf.ps1`: it prints
  `docs/guide/MaxOff-App-Guide.pdf` and `docs/guide/first-day.pdf` ("Your first day with MaxOff", one tall
  page). Open both; check the first-day PDF is **one** page. Commit them on a small branch with a pull
  request to `main` (docs only, so CI skips). Step 7 hands `first-day.pdf` to every new person.
- Two phones: yours, and one that plays the **test member** (a family member's, or a spare). The test
  member needs an email address that **no real person will ever use** in MaxOff, because the address stays
  taken after the test member is deactivated: a `+` alias of your own mailbox works (for example
  `yourname+maxofftest@gmail.com`).

## 1. The release: the first `v*` tag

Tag pushes are refused from cloud sessions, so this is done **from the laptop**.

1. Find the commit to tag: the head of `main` if its CI run is green with all three checks. If the head is
   a docs-only commit (docs-only pushes run no CI, so it has no checks), tag the newest commit on `main`
   that has a green run, normally the 3c merge commit.
2. Tag and push:
   ```powershell
   git tag v1.0.0 <commit>
   git push origin v1.0.0
   ```
3. GitHub → Actions → **Deploy** → the run for `v1.0.0` → the `production` job waits for you → **Review
   deployments** → tick `production` → **Approve and deploy**.

**Expected:** the job's steps are all green. "Require the tagged commit to be on main with green CI"
prints `success` for the three checks; "Apply migrations to the production database" applies every file
in `supabase/migrations`; "Smoke-check the deployed Worker" passes:
`/api/health` answers `200 ok` with `no-store`, the signed-out `/today` redirect carries every security
header, and `https://maxoff.pixoraclips.workers.dev` answers a **308** to `https://app.maxoff.in`.

**If not:** a red guard step names the commit and the check that is not green (tag a green commit, delete
the wrong tag with `git push origin :refs/tags/v1.0.0`). A red domain step is the Cloudflare token (README
→ "Production runbook (3c.1)": add the zone permissions, or attach `app.maxoff.in` by hand and re-run). A
Supabase permission error names the permission `SUPABASE_ACCESS_TOKEN` lacks. A red smoke step means the
Worker is already live: read which check failed, then fix forward, or roll back in Cloudflare → Workers &
Pages → maxoff → Deployments. Any time later, by hand (Git Bash or WSL):
`bash scripts/smoke-deploy.sh https://app.maxoff.in https://maxoff.pixoraclips.workers.dev`.

## 2. The Owner account (bootstrap)

Run the PowerShell block in README → "The first Owner on a hosted project" → **"Production (the Owner's
own PowerShell, 3c.1)"**, exactly as written there, with your email and full name and `--org "Pixora
Clips"`. It asks for the production secret key in a masked prompt and clears it at the end.

**Expected:** it prints a one-time link starting `https://app.maxoff.in/auth/confirm?`. Keep it for step
4.1; it works once, within 24 hours. A second run is safe: it answers `CONFLICT` once the Owner exists.

**This is the only data entered into production at go-live** (step 6).

## 3. UptimeRobot

Add an **HTTP(s)** monitor on **`https://app.maxoff.in/api/health`**, every **5 minutes**, alerting your
email (keyword `ok` is optional). The route makes one small database read, so the free Supabase project
never pauses and the monitor watches the database, not only the Worker.

**Expected:** the monitor shows **Up** within a few minutes. **If Down:** open the address in a browser;
`unavailable` means the Worker could not reach the database (Supabase dashboard → the project is not
paused; the deploy's `SUPABASE_SECRET_KEY` is set).

## 4. The smoke test on `https://app.maxoff.in`

The test runs over **two IST working days**, because attendance starts the day **after** someone joins
(the joining day is never counted: the test member's strip says "Attendance starts tomorrow"). Day A is the
join, leave and a claim; day B is a real working day. **No staff invite goes out until every check below
has passed.**

### Day A

**4.1 The Owner signs in.** Open the one-time link from step 2 → "Continue to MaxOff" → tap **Continue to
MaxOff** (the tap is what spends the link; opening the page does not) → "Set your password" → choose a
password of at least 12 characters → **Save password and sign in**.
*Expected:* Today opens with the attendance card (nobody expected yet) and, below it, "More of your day is
coming soon". *If "This link has expired or was already used":* use "Forgot your password?" (4.2). Step 2
cannot issue another link: once the Owner exists the bootstrap refuses (`CONFLICT`) before it gets to the
link.

**4.2 "Forgot password" works.** In a private browser window: `https://app.maxoff.in/login` → **Forgot
your password?** → your email → *expected:* "If that email belongs to a member, a link is on its way."
*Expected email, within a minute or two:* from **MaxOff `<noreply@mail.maxoff.in>`**, subject **"Set your
MaxOff password"**, the branded template (the MaxOff mark, a red button). The button opens "Continue to
MaxOff" on `app.maxoff.in` → **Continue to MaxOff** → "Set your password"; set a new password → you are
signed in. Sign in with the new password
elsewhere to be sure.
*If no email:* the spam folder; Resend dashboard → Emails (was it sent, delivered or bounced?); Supabase →
Authentication → Logs; Authentication → Emails → SMTP settings (host `smtp.resend.com`, sender
`noreply@mail.maxoff.in`). *If the link lands on the wrong address:* Supabase → Authentication → URL
Configuration (Site URL `https://app.maxoff.in`, Redirect URL `https://app.maxoff.in/**`).

**4.3 The app on your phone.** Open `https://app.maxoff.in` and sign in. **Android (Chrome):** ⋮ →
**Install app** (or Add to home screen). **iPhone (Safari):** Share → **Add to Home Screen**, then open it
and sign in once more inside the app (an iPhone keeps the installed app's sign-in separate from Safari's).
*Expected:* MaxOff opens from its icon, full screen, on Today; the back gesture on Today closes the app.

**4.4 The old address redirects.** Open `https://maxoff.pixoraclips.workers.dev/today` in a browser.
*Expected:* you land on `https://app.maxoff.in` (the sign-in page, or Today when signed in). The deploy's
smoke step already proved the **308**; this is the same check by eye.

**4.5 Invite the test member.** More → People → **Invite** (at the bottom on a phone) → the test email
(see "Before you start"), full name (for example "Test Member"), role **Crew**, any job title → **Send
invite**. *Expected:* "Test Member is invited", "Email is not set up yet, so share this link yourself.",
and the invite link with **Copy**. Tap **Copy**, then send the link on **WhatsApp** to the test phone,
exactly the way the staff invites will go (read "WhatsApp and one-time links" in step 7 first). On People
the person shows as **Invited**.

**4.6 The test member joins.** On the test phone, open the link. *Expected:* "Continue to MaxOff" → tap
**Continue to MaxOff** → "Set your password" → save → "Welcome, Test" on Me ("Your password is set and you
are signed in as …"). Install the app as in 4.3 and open it. *Expected on the test phone:* My Day shows
"Attendance starts tomorrow" and "More of your day is coming soon"; Tasks, Calendar and Alerts each say
what is coming, in plain words, with no numbers. On your People list the person is **Active**, "Joined"
today.
*If the test phone sees "This link has expired or was already used":* Continue was tapped on it before
(only the tap spends a link, see "WhatsApp and one-time links"), or 24 hours passed: People → the person →
⋯ → **Copy invite link** issues a fresh one (the old one stops working); send it again the way step 7
says. Note in the record that it happened.

**4.7 A leave request.** Test phone: Me → **Attendance & leave** → **Request leave** → Leave, one date
**after day B** (day B is for the working day) → optional reason → **Request leave**. *Expected:* the
request shows as "Waiting". Your phone: the Approvals badge shows 1 → **Approvals** → Leave → **Approve**
(a 6-second Undo, then it is saved). *Expected on the test phone:* the request reads Approved.

**4.8 An expense claim with a receipt photo.** Test phone: Attendance & leave → **Expenses** → **Add
expense** → the amount **₹501** (above ₹500, so the photo is required; a token amount, because the claim
stays in the go-live month for good, see step 6), category Travel, the note **"Go-live test"**, today's
date, take or choose a photo → submit. *Expected:* the claim shows as waiting, with the photo. The
upload proves the production file bucket and its CORS for `app.maxoff.in`. Your phone: Approvals →
**Expenses** → **Review** (the receipt shows in the sheet) → **Approve**.
*If the upload fails:* R2 → `maxoff-files-production` → Settings → CORS allows `PUT` from
`https://app.maxoff.in` with `ETag` exposed (README → "Storage").

### Day B (the next working day)

**4.9 Start day → approve.** Test phone: open MaxOff. *Expected:* "Started working?" with **Start day**
→ tap it → the strip reads "Started <time> · waiting for approval". Your phone: Today shows the test
member as waiting; **Approvals** → Attendance → **Approve**. *Expected on the test phone:* the strip reads
"Started <time> · approved".

**4.10 End day, with a claim.** Test phone: **End day** → "Any expenses to claim today?" → **Yes** → **End
day, add expenses** → a token claim (**₹1**, Food, the note "Go-live test", no photo needed) → Done.
*Expected:* the strip reads "Present · ended <time> · approved". Your phone: Approvals → Expenses → approve
it.

**4.11 The month summary.** Your phone: More → People → the test member → **Month**. *Expected:* 1 day
worked, the approved expenses "to pay". **Mark all paid** with today's date → nothing left to pay. More →
Reports → **Month** shows the test member's row.

**4.12 Deactivate the test member.** People → the test member → ⋯ → **Deactivate** → **Deactivate Test
Member**. *Expected on the test phone:* the next screen it loads is the sign-in page, and signing in is
refused. Then uninstall the app from the test phone.
**What stays visible of them (nothing is ever deleted, CLAUDE.md invariant 9):** People lists them as
**Deactivated**, at the end of the list, with Reactivate; their page keeps their days, leave and claims;
this month's team report (Reports → Month) still has their row, because they were a member during the
month, and from next month they are no longer in it; the activity history keeps every step. Their email
stays taken.

**The smoke test passes** when every *Expected* above held. If one did not: stop, send no staff invites,
write down the step, what you saw and the time, and fix it (a session) before going on.

## 5. The first backup and the production restore drill

1. GitHub → Actions → **Backup** → **Run workflow** (branch `main`, retention left blank). *Expected:* green;
   the run's summary names the object (`postgres/peshoflxypujbzecgwqq/<UTC stamp>.tar.age`). From now on it
   runs every night at 02:00 IST.
2. The **production restore drill**, once now and then every quarter: `docs/runbooks/backup-restore.md` →
   "The drill" → "Production", into a throwaway target. *Expected:* its three "verified" lines (row counts,
   every file in `supabase/migrations`, RLS refuses), then the pg_cron **WARNING** naming the two
   `cron.schedule` calls (a throwaway target has no jobs) and the closing line **"restore verified, with 1
   warning(s)"**: that warning is the expected ending, not a failure. Write the date and the numbers into
   that runbook's "Drills done" table.

## 6. Go-live data: the Owner only, seeded defaults kept

The only data entered into production at go-live is **the Owner**, by the bootstrap in step 2 (owner
decision, kickoff 3c amendment (3f)). No staff list, holidays, expense categories or receipt limit are
typed in with a session. **The smoke test's records stay, though** (nothing is ever deleted): the
deactivated test member, their approved leave, their two claims (₹501 and ₹1, marked paid) and the one
receipt photo remain in the go-live month, on their page and in Reports → Month. That is why the test
uses token amounts with the note "Go-live test"; list them in the go-live record. The bootstrap creates
the organization, and the database gives it these defaults at that moment; **you change any of them yourself in Settings, whenever the team needs it**:

| Setting | Starts as | Where you change it |
|---|---|---|
| Company name | Pixora Clips (the bootstrap's `--org`) | More → Settings → **Company** (also the logo) |
| Timezone | IST (Asia/Kolkata), fixed | (not a setting) |
| Weekly off days | **Sunday** | More → Settings → **Days off & holidays** |
| Holidays | **None** | More → Settings → **Days off & holidays** → Add holiday |
| End-of-day reminder | 8:30 PM IST (sent once notifications arrive) | More → Settings → **Thresholds** |
| Late End day until | 5:00 AM IST | More → Settings → **Thresholds** |
| Task reminders and escalations | Reminder every 2 h, the Admin after 4 h, you after 8 h, overdue after 24 h, 20 emails per person per day (used once tasks and notifications arrive) | More → Settings → **Thresholds** |
| Expense categories | **Travel, Food, Materials, Other** | More → Settings → **Expenses** |
| Receipt photo required above | **₹500** | More → Settings → **Expenses** |
| Job titles | **Video Editor, Graphic Designer** | More → Settings → **Job titles** |
| Custom fields | None | More → Settings → **Custom fields** |

Worth doing before the invites: add the job titles your people have (an invite picks one), and any holiday
that falls before the team starts (a holiday is a day off: no Start-day prompt and no absent check; if a
holiday is added later on a date someone already has comp leave, that comp leave is cancelled and the credit
returned).

**Local only, never in production:** `supabase/seed.sql` (the local sign-ins such as
`owner@maxoff.local`, the Playwright people and the local organization) is loaded by `pnpm db:reset` on the
local stack only; the deploy runs `supabase db push`, which never seeds. The migrations' own "for every
existing organization" inserts found none on production (they ran before the bootstrap), so production's
lists come only from the defaults above.

## 7. The staff invites

**Only after the smoke test (step 4) and the first backup (step 5) passed.**

The **invite list is yours**: each person's name, email, role (Crew; Admin for someone who runs clients)
and job title. It stays with you, never in the repository or a chat.

For each person:
1. More → People → **Invite** → email, full name, role, job title → **Send invite**.
2. **Copy** the link, paste it into the message below, send it on WhatsApp, with the first-day page
   (`docs/guide/first-day.pdf`, "Your first day with MaxOff", from "Before you start").
3. **Done.** People shows them as Invited until they open the link, then Active.

The link works **once**, within **24 hours**. If it expires, is used up or gets lost: People → the person →
⋯ (or the card's sheet) → **Copy invite link** issues a fresh one and the old one stops working.
Attendance starts the day after someone joins.

A message you can paste (replace the two `< >`):

```
Hi <first name>, welcome to MaxOff, Pixora Clips' app for attendance, leave and expenses.

1. Open this link on your phone and tap Continue to MaxOff. It works once, within 24 hours:
<the invite link>
2. Choose your password.
3. Put MaxOff on your home screen: in Chrome, ⋮ → Install app (Android), or in Safari, Share → Add to Home Screen (iPhone).

Your attendance starts tomorrow. Open MaxOff when you start work and tap Start day, and End day when you finish. The one-page guide is attached.
```

**WhatsApp and one-time links.** An invite link works once, and **tapping Continue to MaxOff** on the page
it opens is what uses it (3cB review fixes): WhatsApp drawing a preview of the link while you write the
message, or a mail scanner fetching it, opens the page and spends nothing. Turning link previews off in
WhatsApp (in recent versions: Settings → Privacy → Advanced → **Disable link previews**) is belt and
braces, not a must. If someone sees "This link has expired or was already used. Ask for a new one."
(Continue was tapped twice, or the 24 hours passed), issue a fresh link with Copy invite link and send it
again.

## 8. Push onboarding: every person, every phone (6.6, kickoff 6 decision 19)

Notifications are how a new task, a decision on leave or a change request reaches someone, so a
person is not onboarded until **one test notification has arrived on their phone**. The app walks
each person through it (5.5: the Welcome card's "Get notifications" steps, the band above the bottom
bar, Me → Your devices, "Did it arrive?"); this checklist is for the Owner, sitting with the person
(or on a call) at their invite, and again whenever someone gets a new phone. There is no screen for
it: the checks below use what the app already shows.

**Before you start:** the person has joined (step 7) and has their phone in hand. iPhones need iOS
16.4 or later (Settings → General → About → iOS Version); older iPhones cannot receive web app
notifications at all.

**iPhone (Safari):**
1. Open **https://app.maxoff.in** in **Safari** and sign in.
2. Tap **Share** (the square with an arrow, at the bottom) → scroll → **Add to Home Screen** → **Add**.
   The Welcome card shows the same steps with pictures.
3. Close Safari. Open **MaxOff from its new Home Screen icon** and sign in once more. **An iPhone
   notifies only the installed app**: notifications turned on in a Safari tab never arrive.
4. On the Welcome card (or the band above the bottom bar, "Notifications are off · Turn on"): **Turn
   on notifications** → **Allow** when the iPhone asks.
5. **Send a test.** When MaxOff asks **"Did it arrive?"**, the person taps Yes or No. On No the app
   lists what to check: the Home Screen icon, Settings → Notifications → MaxOff → **Allow
   Notifications**, and a **Focus** or Do Not Disturb that silences it. Fix, then **Send another
   test** until one arrives.
6. **Text size:** the installed app now follows the iPhone's own text size (Settings → Display &
   Brightness → Text Size, or Accessibility → Display & Text Size → Larger Text), up to twice the
   normal size, and no longer pinch-zooms. Nothing to set up; mention it to someone who reads with
   larger text.

**Android (Chrome):**
1. Open **https://app.maxoff.in** in **Chrome** and sign in.
2. **⋮ → Install app** (or "Add to Home screen" → Install). Open MaxOff from its icon from now on.
3. **Turn on notifications** on the Welcome card or the band → **Allow**.
4. **Send a test** → "Did it arrive?". On No: allow notifications for MaxOff (hold the icon → App
   info → Notifications), Settings → Apps → Chrome → Notifications on, **Settings → Battery: no
   restrictions for Chrome**, Do Not Disturb off. Then send another test.

**What you (the Owner) check afterwards:**
- **Me → Your devices** on their phone lists the phone with "This device" and when it last got a
  notification. A phone they no longer use: **Remove** beside it.
- **Settings → Notifications** lists everyone MaxOff can't reach by push and why (off, blocked, not
  installed, not reaching them). The person should not be on it the next time you look.
- Anyone who has open tasks and can't be reached also shows on your **Today → Overdue and risks**
  ("<name> can't be reached"). That row is the reminder to sit with them again.
- Later, anyone can re-check at **Me → Help & troubleshooting → Send a test notification**.

**The staff guide:** "Your first day with MaxOff" (`docs/guide/first-day.html`, section 2 "Turn on
notifications") carries the same steps for the person; send its PDF with the invite (step 7).

## Go-live record

| Step | Date | Result | Notes |
|---|---|---|---|
| Both PDFs rebuilt on the laptop and committed | 2026-10-01 | Done | Built with Edge from the v1.2 guide (tasks, the "Crew" label, notifications): `MaxOff-App-Guide.pdf` (24 pages) and `first-day.pdf` (1 page) |
| 1. Tag `v1.0.0` and the production deploy | 2026-09-29 | Passed | `v1.0.0` on `dbf8242`. Every step green except the smoke step: `app.maxoff.in` did not resolve yet on the runner seconds after the custom domain was attached. The same `scripts/smoke-deploy.sh` passed from the laptop minutes later (health, headers, the workers.dev 308, the Continue page). `v1.1.0` (tap feedback, pull-to-refresh, offline recovery) deployed 2026-09-30 with every step green |
| 2. Owner bootstrap | 2026-09-29 | Passed | Run in the Owner's own PowerShell from a clean `main` worktree; the one-time link opened "Continue to MaxOff" and the password was set |
| 3. UptimeRobot | 2026-09-29 | Passed | HTTP(s) monitor on `https://app.maxoff.in/api/health`, every 5 minutes, Up |
| 4. Smoke test, day A (4.1–4.8) | 2026-09-29 | Passed | Forgot password email (branded, inbox), install, the workers.dev redirect, invite by WhatsApp through the Continue page, join, leave approved, the ₹501 claim with a receipt photo approved |
| 4. Smoke test, day B (4.9–4.12) | 2026-09-30 | Passed | Start day approved, End day with the ₹1 claim approved, month summary and Mark all paid, the test member deactivated |
| 5. First backup; production restore drill | 2026-09-29 / 2026-09-30 | Passed | First backup by hand on 2026-09-29, the first scheduled nightly green; the production drill restored `20260929T234838Z` on 2026-09-30 (backup-restore.md → Drills done) |
| 6. Smoke-test records kept in the go-live month: the test member (deactivated), their approved leave, the ₹501 and ₹1 claims (paid), one receipt | 2026-09-30 | Kept | Test member `shettyprishit+maxofftest@gmail.com`, deactivated; only the Owner sees its attendance, leave and claims |
| 7. Staff invites sent | 2026-10-01 | Done | The Owner onboarded the team in person at 12:30 IST on `v1.2.1` (tasks, the "Crew" label, the branded invite email): invites by email and copied link, the app installed, a demo task noted by everyone. `v1.3.0` (push, email and the bell) followed the same evening |
