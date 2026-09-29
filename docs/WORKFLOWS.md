# MaxOff: Workflows and State Machines

> Every workflow state change goes through a **Postgres transition function** (e.g. `task_submit_done()`). The function checks the actor, the current state and the inputs, updates the record, writes `activity_log`, and queues notifications, **all in one transaction**. Direct `UPDATE`s of state columns are blocked by RLS and triggers.
> Times are `timestamptz`. "Today" means the **IST date**: `(now() at time zone 'Asia/Kolkata')::date`.

---

## 1. Daily attendance (Admins and Staff)

> **Reworked in 3b.1 (owner decisions 2026-09-27, PRODUCT §4.2, ADR-0012 amendment):** the working day is **Start day** and **End day**, two explicit taps, separate from signing in and out. The blocking first-request day gate (2.2) gave way to an in-app prompt, and "Sign out of this device" records only `session_events`. The 2.x diagram and bullets below still describe what `main`'s app does on the shared staging database until the contract migration (expand-only, ARCHITECTURE §18); the 3b rules are in **"Settled in 3b.1"** at the end of this section, and the day's states, the Owner's review, the leave rules and the jobs are otherwise unchanged.

```
3b.1, a working day (the app opens freely; the Start-day prompt asks until one of these):
   ├─ Start day ──────────► attendance_day (pending_review, submitted_choice = present, started_at = the tap)
   │                              └─ End day ─► ended_at (final for the day, no resume; after midnight: yesterday's day, until 05:00 IST and before today's Start day)
   └─ Choose leave (Leave / Half day) ─► attendance_day (pending_review) + leave_request(source = attendance)
   a day off: no prompt, no Start day ("I worked today" is a note, 3b.2)
   approved leave: no prompt; full leave offers "I'm working today" (= Start day, Present for review),
   a half day keeps Start day / End day (the half day stands)

2.x (main, until the contract migration):
first authenticated request of the IST day
   └─► attendance_day created (state: awaiting_choice) ── app is gated until a choice is made
          │ member chooses
          ├─ Present ────────────────┐
          ├─ Leave / Half-Day / Comp ─┴─► also creates leave_request(source = attendance, date = today)
          ▼
      pending_review ──Owner approve──► approved (final_status = submitted status)
          │
          └──Owner correct(status, reason)──► corrected (final_status = Owner's status)

23:59 IST job, working day, no submission ─► pending_review, submitted = none, final_status = absent (proposed)
      └─ Owner approve ─► approved(absent) · Owner correct ─► corrected(any status)

approved full-day leave covering today ─► approved (final_status = leave type, proposed_by_system, no gate)
      └─ "I'm working today" ─► pending_review (submitted_choice = present)
            ├─ Owner approve ─► approved(present), worked_on_leave = true ("1 day worked"); the leave request is untouched
            └─ Owner correct ─► corrected(any status)

leave approved AFTER the member submitted Present for that date, submitted and not yet decided (pending_review)
      ─► corrected (final_status = leave type, actor = system, action = corrected, reason = "leave approved")
      · the member is notified. The leave wins. A day the Owner already decided stays (2.2, kept_dates).

form (or Owner-edited) leave approved AFTER a gate leave was approved for that date ─► the gate request:
      superseded · the day: corrected to the new leave (actor = system, reason = "leave approved"). The later decision wins.
```
- **The Owner is exempt** from the prompt and from the absent, end-day-reminder and end-not-recorded jobs. The Owner's sign-out writes only `session_events`.
- **Approved leave comes first.** For each member with **approved leave covering the date**, the day is created as `approved`, `final_status` = the leave type, `leave_request_id` set, `proposed_by_system = true`, with an `attendance_events` row `derived_from_leave`. This happens when the day is opened (the Start day tap or the prompt's leave choice, `app.attendance_open_day`; until 3c.1 the first sign-in), or in the **23:59 job** for anyone who never started. They're never proposed absent.
- **"No submission"** means *either* no `attendance_days` row *or* a row still in `awaiting_choice` (opened, never chosen).
- **The attendance day is the source of truth for a date.** Leave requests feed it; they never replace it.
- **On a day with approved full-day leave there's no gate.** If the person logs in anyway, a banner says "You're on approved leave today" with an optional **"I'm working today"** button: `attendance_submit(present)` is allowed from `approved` **only** when `proposed_by_system = true`, and moves the day to `pending_review` keeping `leave_request_id`. If the Owner approves it, `worked_on_leave = true` ("1 day worked") and the **leave request is not altered**.
- **An Owner correction on a day covered by approved leave** (owner decision 2026-09-26, phase 2 review): correcting it to **Present** sets `worked_on_leave = true` ("1 day worked"), exactly like an approved "I'm working today"; the leave request **stays approved and untouched** for every correction, Absent included (the Owner cancels it from the person's Leave tab if it should go), and the correct dialog says so for every status other than the leave's own type.
- **Approved half-day leave** sets the day to `half_day` with no prompt; Start day and End day are still recorded (3b.1).
- **A leave approved later wins** over a day **not yet decided**. When `leave_decide(approve)` covers a date whose day is `pending_review` (a Present, or a proposed absence, still waiting for the Owner), the same transaction corrects the day to the leave type (`corrected`, `actor_id = null`, `attendance_events.action = corrected`, reason "leave approved"), and notifies the member.
- **An Owner correction to a leave type** (`leave`, `half_day`, `comp_leave`) with no leave request behind it creates `leave_requests(source = 'owner', state = approved)` for that date and links it, so calendar and availability stay right. **Comp leave uses the member's oldest credit valid on that date, or is refused** (3c review, kickoff 3b decision 16: "Comp leave needs an earned credit valid on that date. Grant one first from their Leave tab."; a day off is refused too), exactly as a member's own request would; §2 "Using a credit".
- A **working day** is not a weekly off day and not in `holidays`. On a day off: no absent check, but the gate **still asks** if someone logs in, and `is_day_off = true` shows as "Worked on a day off". (Pixora's current setting: Sunday off, and people do sometimes work Sundays.)
- `attendance_day` is **unique per member per IST date**. Later logins only add `session_events`.
- **Sign-in:** the login action (and a recovery link opening a session at `/auth/confirm`) calls `session_login()`, which writes `session_events(kind = login)` for the active member and refuses anyone else. A deactivated or invited person cannot sign in: the session is ended again and the form says so.
- **Sign out of this device (3b.1):** `session_sign_out()` writes `session_events(kind = logout)` (this device only; other signed-in devices stay in) and touches no attendance day, then the auth session is ended on that device. (2.x's `session_logout()` also stamped the day's `last_logout_at`; the 3c.1 contract migration dropped it and backfilled those stamps onto `ended_at`.)
- **20:30 IST job** (configurable): anyone with a Start day today and no End day gets the "You haven't ended your day" reminder (`app.end_day_reminder_due()`, 3b.1; the notification rows are 5.1's).
- **Nightly (00:00 IST, after the absent check):** days with a Start day and no End day get `end_not_recorded = true` (`app.end_not_recorded()`, 3b.1). No time is made up. **A late End day clears it** (the 2.5 rule carried over, owner decision 2026-09-25): the flag means "no end was recorded", and `attendance_end_day()` landing on yesterday's day (before the cutoff, §1 "Settled in 3b.1") records one, so that write carries `ended_at` and the cleared flag; nothing else moves.
- **Overtime:** the member can flag overtime with a reason on any day, which sets `overtime_flag` and `overtime_reason`. Notice only, no approval. **Where (2.3 polish, owner decision 2026-09-24):** an optional "Worked late today? Add an overtime note" in the Log out confirmation, and "Flag overtime" on today's entry in `/leave/attendance`; same function, reason still required. The home screen shows today's attendance as **one line** ("● Present · waiting for approval ›", opening the day's history, or the gate while no choice is made); on an approved-leave day that line is the banner and keeps the "I'm working today" / "I'm working the full day" button, worded "On leave today" / "Half day today" to fit one line at 375px. Log out stays on My Day and the Admin's /today as a quiet full-width row at the bottom.
- **Corrections** after a decision: the Owner can correct again at any time. Each correction is another `attendance_events` row, and nothing is overwritten without history.
- **Bulk approve** = the same function called for each row, so each row gets its own audit entry.
- **Settled in 2.1 (owner decisions, 2026-09-23):** a reason is **optional** for every member submission (the gate and the leave form) and **required** only when the Owner rejects or corrects. The Owner may correct a day in **any** state, `awaiting_choice` included (the gate then stops asking; the history keeps it). `attendance_decide()` on a day whose linked request is still `submitted` decides that request too (approved when the outcome equals its type, otherwise rejected with the same reason), and `leave_withdraw()` / `leave_decide()` refuse a `source = attendance` request: the attendance day is the single door. **Logout after midnight:** with no day for today, the logout goes onto yesterday's day when it has a login and no logout, and it writes `last_logout_at` and the `logout` event **only**: state, `final_status` and the Owner's decision are never touched, so a late logout is information, not a re-opening. **The leave wins over the gate's own request too:** a leave choice at the gate while a form request covering today is still waiting creates a second `submitted` request; when the form request is approved, the gate's request is marked `superseded` in the same transaction (otherwise it would sit in the Owner's list with no door). Two approved requests covering one date (rare, see §2): the most recently decided one derives the day. `attendance_touch()` also writes `session_events(login)` when the member has none on today's IST date (a session kept across midnight), so "logged in today" is true for the 20:30 and 23:59 jobs.
- **Settled in 2.2 (owner decisions, 2026-09-23):**
  - **Attendance starts the IST day after `joined_at`.** On the joining day `attendance_touch()` records the login, opens **no** day and answers "not required", so accepting an invite goes from `/set-password` straight to `/me?welcome=1`. The jobs (2.5) never propose a day before a member's first attendance day.
  - **The later decision wins, in both orders.** When `leave_decide(approve)` or `leave_owner_edit()` covers a date that has an **approved gate leave** (`source = attendance`), that request becomes `superseded` in the same transaction (audit meta `{by, system: true}`, one helper, `app.leave_supersede_gate()`), and its day, whether `approved` or `corrected`, **while it still carries that gate leave's status**, is corrected to the new leave (actor none, reason "leave approved", event `corrected`). This happens **even when the type is the same**, so the history shows that the later decision won. Example: a half day chosen at the gate and approved, then a full-day form request approved → the day becomes full leave. The other order needs no new rule: approving the form request first supersedes the gate's still-`submitted` request (2.1 above), and the day is no longer `pending_review`, so the gate request can never be approved afterwards.
  - **A day the Owner decided stays**, whether **approved or corrected** (`decided_by` set), unless it is still the superseded gate leave's own day (same status). A gate-leave day the Owner has since corrected to something else (e.g. Present) is the Owner's decision and stays. `leave_owner_edit()` on a gate leave supersedes it once, with the Owner's label. An approved Present, an approved absence or a correction that a later leave approval covers is left exactly as the Owner decided it, and `leave_decide()` returns those dates (`kept_dates`) so the screen can say "these days keep your earlier decision". "The leave wins" applies only to a day still waiting (`pending_review`), a day with no answer yet (`awaiting_choice`) and a day derived from leave.
  - **Two devices at once.** The day's opener is serialised per member (the `leave:` advisory lock taken before anything else; 2.2's `attendance_touch()`, since 3c.1 `attendance_start_day()`), so a phone and a laptop tapping Start day at the same instant produce exactly one day and one start; the second tap is told the day has already started (pgTAP 09, two real connections).
  - **Overtime needs a reason in the database too:** `attendance_flag_overtime()` refuses an empty one (`VALIDATION`), as the form does.
  - **The day changed.** The gate screen submits the IST date it was shown for; `attendance_submit()` refuses a different date (`INVALID_STATE`, "The day changed. Choose again for today.") and the screen reloads the gate for the new day.
  - **The gate in the app** (ARCHITECTURE §8): after a choice the browser *replaces* the gate in history with where the person was going, so a back gesture from My Day never returns to the gate. On a half-day leave day the banner offers **"I'm working the full day"**; on full leave and comp leave it offers **"I'm working today"**. Both are `attendance_submit(present)`.
- **Settled in 2.5 (owner decisions, 2026-09-25), the nightly jobs (§8):**
  - **The absent check writes nothing on a day off**, leave-derived days included: nothing is expected that day, and whoever came in already has a row from their login. A row already marked `is_day_off` is never proposed absent either.
  - **The Owner is out by data, not by name:** the jobs consider active members whose role holds `attendance.self`, whose attendance has started (the date is after the IST date of `joined_at`), in id order, each under the member's `leave:` lock.
  - **A proposed absence keeps what the day already had:** an `awaiting_choice` row (logged in, never chose) becomes `pending_review` with `final_status = absent`, `proposed_by_system = true` and its `first_login_at` intact, so the review sheet still shows when they signed in; a member with no row gets one with no login. Either way one `proposed_absent` event and one audit row.
  - **The Owner's summary notification is 5.1's** (with the `notifications` table): `app.absent_check()` returns the people it proposed, per date, and names the recipient in its comment.
  - **The 20:30 logout reminder is a notification, so it is also 5.1's.**
- **Settled in 3b.1 (owner decisions 2026-09-27 and 2026-09-28, kickoff 3b decisions 1–9 and 28; migration `start_end_day`, DATA-MODEL §3 "3b.1"):**
  - **People stay signed in.** Nothing signs a member out on its own. **"Sign out of this device"** lives under Me only (a lost or shared device), warns that notifications stop on that device, and calls `session_sign_out()`, which writes `session_events(logout)` and **never touches the attendance day**. Deactivation still ends every session at once (1.3). The account menu and the More sheet carry no sign-out.
  - **Signing in and out is no longer attendance.** `session_events` stay the security record. Opening the app opens no day: `attendance_own_today()` only reads. The day exists once the person **starts it or chooses leave**.
  - **The Start-day prompt replaces the gate.** On a working day whose attendance has begun, until the day is started or leave chosen, the `(app)` layout mounts the prompt ("Started working? Start your day to record it." · **Start day** · "On leave today? Choose leave" (Leave / Half day; **comp leave is not offered here**, decision 16) · **Just looking**). It opens when the app opens or returns to the foreground, **at most once every 30 minutes** (`domain/prompt.ts`, the timestamp per member and IST date in the device's `localStorage`); back, the backdrop and Just looking all count as "not now". No prompt on a day off, on a day derived from approved leave (full or half), on the joining day, or once a day is recorded (a 2.x gate choice on the shared staging database counts, decision 28). The strip on My Day / Today reads **"Not started · Start day"** meanwhile.
  - **Start day is the tap.** `attendance_start_day()` (attendance.self) opens today's row when there is none (`app.attendance_open_day(member, today)`: a start is the tap, never a sign-in) and: `awaiting_choice` → `pending_review` as Present with `started_at = submitted_at = now()`, event `started`; an untouched day derived from **full** leave or comp leave → the same ("I'm working today", the leave stays linked and untouched); a **half-day** leave day, or a day already Present (one the Owner decided, say) → `started_at` only, the standing unchanged. Refused (`INVALID_STATE`) on the joining day, on a day off (no row, or a row marked `is_day_off`: "add an I worked today note"), when already started, and when today is a leave or a decided absence. The home hint's daily refresh (2.7) rides on it. Notifies nobody.
  - **Choose leave at the prompt** = `attendance_choose_leave_today(leave | half_day, reason)`: opens the row when there is none, then the 2.1 `attendance_submit()` (the `source = attendance` request, the same rules and audit). Present and comp leave are `VALIDATION`. A half day chosen this way still starts and ends (half a working day).
  - **End day is final.** `attendance_end_day()` ends the caller's started day: today's, else **yesterday's** with a start and no end (the 2.1 late-logout rule carried over: a real time, never made up). One write: `ended_at = now()` and `end_not_recorded = false` (a late End day clears the 00:00 flag, as 2.5 did for logout); event `ended`; state, `final_status` and the Owner's decision never move. `INVALID_STATE` with no started day ("Start your day first") or once today has ended (no resume). The confirmation says so; the app stays fully usable after it. The optional overtime note in that confirmation is 3b.2's.
  - **The late End day has a cutoff** (owner decision 2026-09-28, `/review-phase 3b`): yesterday's open day can be ended after midnight **only until `org_settings.end_day_cutoff_time`** (default **05:00 IST**, Settings → Thresholds) and **never once today's Start day exists**. Past the cutoff `attendance_end_day()` is `INVALID_STATE` ("Yesterday's day can be ended only until 05:00. It stays "End of day not recorded"; add an overtime note for the late work."), `attendance_own_today()` stops reporting yesterday's open day, so the strip no longer offers it, and the day keeps the 00:00 flag. Late work goes in an overtime note (7 days back, 3b.2).
  - **The Owner's review is unchanged** (§1 "Settled in 2.4"): a started day waits as Present; the review sheet shows **"Started 9:12 am"**, the people board "Started 9:12 am · Ended 6:30 pm", "Not started", "End not recorded" (`attendance_today_detail()`). A correction keeps the recorded start and end (`protect_columns`).
  - **The jobs.** `absent_check` is unchanged: a started day is `pending_review`, so it is never proposed absent, and a 2.x gate choice never is either (decision 28). **`app.end_not_recorded()`** (00:00 IST, `cron.job` `end_not_recorded`, the same 7-date catch-up as 2.5) flags days with a start and no end: **"End of day not recorded"**; no time is made up. **The 20:30 reminder** ("You haven't ended your day. If you're done, end it; if you're working late, carry on.") goes to `app.end_day_reminder_due()`'s rows, that member; the notification row and its schedule are 5.1's (decision 32). The 2.x `logout_reminder` / `logout_not_recorded` went with the 3c.1 contract migration.
  - **History in the member's words:** "You started your day" (or "… on a day of approved leave"), "You ended your day"; the Start · end column shows the taps (a day recorded before 3b.1 carries its sign-in and sign-out there since the 3c.1 backfill, decision 31).
  - **The Owner is exempt** from the prompt, Start day, End day and their reminders, as before.
- **Settled in 3c.1 (the contract migration, kickoff 3c decisions 6-7 and `/review-phase 3b`):** the 2.x day gate is gone from the database: `attendance_touch()`, `session_logout()`, `app.attendance_logout()`, `attendance_today()`, `app.logout_not_recorded()` with its cron row, and the columns `first_login_at` / `last_logout_at` / `logout_not_recorded` (backfilled onto `started_at` / `ended_at` / `end_not_recorded` first, audit `backfilled`). The `logout` attendance event is closed for new rows (a NOT VALID check: old rows stay). **Comp leave without a credit is refused on every route:** `leave_submit('comp_leave')`, `attendance_submit('comp_leave')` and `leave_request_change(…, type = comp_leave)` are `VALIDATION`; a comp leave request exists only through `leave_submit_comp()`, which reserves a credit. From here on migrations stay expand-only across a release.
- **Settled in 2.4 (owner decisions, 2026-09-24):**
  - **Lock order.** Every function that writes a member's days or leave takes the per-member `leave:` advisory lock **before any row lock**: `attendance_decide`, `attendance_submit`, `leave_submit`, `leave_withdraw`, `leave_request_change`, `leave_decide` (both branches), `leave_owner_edit`, `leave_owner_cancel`. Two actions on one person serialise instead of deadlocking (pgTAP `12` proves each waits on the advisory lock first). The bulk action still retries a row once on a deadlock (`40P01`).
  - **Undo is a delayed send; nothing is recorded unless kept.** A single Approve (attendance or leave) fades the row at once and shows a 6-second Undo toast; the approval is sent when the toast ends, **or at once when the page is hidden (`visibilitychange`) or left (`pagehide`, navigation)**, so backgrounding or killing the app never loses it. The send is a `keepalive` POST to `/api/approvals/approve` (the same server action behind a route handler, same-origin only), because an ordinary request is cancelled with the page. Undo before the send means the function was never called: no history row, no audit. Each pending approval has its own timer and several can be in flight. **If the send fails** (network, `CONFLICT`, `INVALID_STATE`), the row comes back into its group with the error message; it never disappears silently. A leave approval's "these days keep your earlier decision" note appears when the send completes.
  - **Bulk** ("Approve all N", Attendance and Leave groups): a confirmation with the count, **no undo**. It approves only the ids that were on screen, one function call per row (each its own audit entry), and reports clashes row by row; those rows stay in the group with their message.
  - **Correct and reject ask for a reason**, and the field says "<name> will see this reason" (members read it on `/leave`). Approve never asks.
  - **Today's attendance (Owner's /today)**, for the IST day, over active members other than the Owner whose attendance has started (not on their joining day): **waiting for a decision** (`pending_review`), **not chosen yet** (expected at work today with no choice, including not signed in yet; not people on approved leave), **present**, **on leave** (approved leave, half day and comp leave included). On a day off the card says "Day off" and counts only those who came in. The **people board** under it lists the same people in that order (waiting, not chosen yet, present, on leave), then an **Absent** group (a decided absence: nothing for the Owner to do, but the board never drops anyone; it is not a card count), by name within each group; **every active non-Owner member expected today (attendance started, and a working day or they came in) is on the board exactly once** (unit-tested). A row opens `/people/[id]`, whose header carries the on-screen back control (ARCHITECTURE §14.2 k).

## 1a. Team membership (task 1.3)

```
Owner invites (email, name, role, job title)
   └─► auth user created without a password (generateLink type = invite) + members row: invited
          │ the person opens the link → /auth/confirm (Continue) → /set-password → password stored
          ▼
        active (joined_at) ── profile step on /me ── signs in with email + password from now on
          │
          └──Owner deactivate(reason?)──► deactivated (deactivated_at; every auth session and refresh token deleted)
                                              └──Owner reactivate──► active (joined_at kept)

invited ──Owner "Revoke invite"──► deactivated (the link opens nothing) ──Owner reactivate──► invited
```
- **Invite** = `member_invite()` after the auth user exists; the email goes out through the app's `sendEmail()` (Resend, or the log sender when no key is set) and bypasses the daily cap (§9). Only the **Owner** (`team.manage`) invites, and only as **Admin or Staff**. An email that already belongs to a member is refused (`CONFLICT`), whatever their status: reactivate instead.
- **Invite link** = `/auth/confirm?token_hash=…&type=invite`, valid for `otp_expiry` (24 h, decided 2026-09-22) and **one use**. "Copy invite link" (Owner only) calls `member_invite_refresh()` then issues a fresh link; **the previous link stops working**. The email is the same link, so this is also the "I never got the email" path. The link opens a **Continue to MaxOff** page whose GET verifies nothing (3cB review: a chat preview or a mail scanner cannot spend it); tapping Continue **confirms the sign-in at GoTrue even when no password is set**, after which only recovery tokens can be issued: later links are `type=recovery`, same route, same accept step, and "Forgot password" works as the self-serve way back for someone who abandoned `/set-password`.
- **Accept** = the link opens a session for the invited member (`verifyAuthLink()` admits `invited` for either link type), `/set-password` stores the password, then `member_accept_invite()` moves `invited → active` and `session_login()` records the first login. Anything else with an invited session (a shell route) is ended as inactive.
- **Deactivate** (`active`) and **Revoke invite** (`invited`) are the same transition, `member_deactivate(member_id, reason)`, worded by state. The reason is optional and kept in the activity log, where only `activity.view_all` reads it: the person never sees their own deactivation entry, even after reactivation (a management note stays the Owner's; phase 1 review). Never the caller, never the Owner. Deactivation takes effect **immediately**: RLS (no `current_member()` row), `requireMember()` on the next page load, and the deleted refresh tokens, so an open tab cannot renew its session when the JWT expires (≤ 1 h). 5.4 also deletes the person's push subscriptions.
- **Reactivate** returns a person who had joined to `active`, and someone who never accepted to `invited` (a new link is needed). `deactivated_at` is cleared; the log rows stay.
- **Edits**: the Owner changes name, role (Admin ↔ Staff; the Owner row's role never changes here) and job title as plain edits (audited by trigger). A member edits their own name and phone on /me.
- **An Admin who runs clients (owner decision 2026-09-27, phase 3 review): no client is ever left without an Admin.** Making them Staff or deactivating them is refused (`CONFLICT`, "Move Ravi's 2 clients to another Admin first.", the `members` trigger `client_admin_guard`, any client state) while any client's `admin_id` is theirs. The Owner's confirmation (the Profile's Save confirmation, the Deactivate dialog) offers the move inline: "Move Ravi's N clients to: [Admin ▾]", one pick for all or **Choose per client**, among the other active Admins (none: the commit stays off with "Make someone an Admin first"). Confirming runs `client_hand_over(from_admin, moves)` (one transaction; each move is a `client_assign_admin`, so history, audit and the §9 notifications follow), **then** the role change or `member_deactivate`. The two steps are two calls: if the second fails, the clients have already moved, which the rule allows, and the Owner retries the change.
- **Email change** (1.4, `member_change_email()`): the email is the login identity, so only the Owner (`team.manage`) changes it, never the member. It is allowed on an **active** row, an **invited** row (the usual case: the invite went to a typo) and on the **Owner's own** row. The address must be free: one that already belongs to any member, whatever their status, is `CONFLICT`. The action moves the sign-in at GoTrue first (`auth.admin.updateUserById`, `email_confirm: true`, so no confirmation mail is needed), then calls the transition function, and puts the old address back at GoTrue if the function refuses. **Sessions stay alive** — nothing reads the email from the JWT — and the person signs in with the new address and their existing password from then on. An **invited** person's pending link **stops working** (GoTrue drops the confirmation token when the address moves, proved by probe: `otp_expired`), so the Owner sends a fresh one with "Copy invite link"; the dialog says so. The invite email itself went to the old address, so that second link is how the new address ever hears about the invite.
- **Notifications**: the invite email, and on an email change **both addresses** get one (the new one: "you'll sign in with this address"; the old one: "your MaxOff login was changed", which is the message that matters when the old mailbox is still live). Both bypass the daily cap, like the invite. Nobody is notified of a deactivation or reactivation (nothing in §9 says so).

### 1b. Freelancers (ADR-0013, owner decision 2026-09-27; built in phase 4)

```
Owner "Add person → Freelancer" (name, job title, phone?, coordinator)
   └─► members row: engagement = freelance, role = staff, status = active, email null, NO auth user, NO invite
         + member_coordinators row (coordinator, from_at = now, set_by = Owner)
         │
         ├──Owner "Change coordinator"(new coordinator, reason?)──► current row closed (to_at), new row opened
         ├──Owner deactivate(reason?)──► deactivated (nothing to sign out; open tasks stay assigned, flagged)
         └──Owner reactivate──► active (a current coordinator is required again)
```
- **Coordinator** = an **active permanent** Admin or Staff. Deactivating a coordinator asks the Owner where each of their freelancers goes first (`member_deactivate()` refuses while a freelancer still points at them).
- **Acting on behalf:** on the freelancer's tasks the coordinator may do everything an assignee may (`tasks.work`): acknowledge ("Noted by Ravi for Asha"), comment, tick stages, upload and paste links, mark Done with the late reason, resubmit after changes. Each transition takes the freelancer's id as `on_behalf_of`, checks `app.coordinator_of(freelancer) = caller` at that moment, and writes actor = caller, `on_behalf_of` = freelancer in the task rows and `activity_log`. Nothing else changes: the approval route, locking from `submitted`, reopen and cancel are the task's own rules (§3).
- **Never for a freelancer:** attendance, leave, the day gate (there is no session), the 23:59 / 00:00 jobs (§8, permanent members only), reachability (§9a), being a creator, approving Admin or reviewer.
- **Notifications** addressed to a freelancer go to their current coordinator (§9).
- **A later login** (a phase-4 kickoff question) would be an invite that attaches an auth user to the same `members.id`; the coordinator relation and every history row stay.

## 2. Leave requests

```
submitted ──Owner approve──► approved ──employee requests change/cancel──► (new request, supersedes_id = old)
    │                        │                                                 │ Owner approves new
    │                        │                                                 └─► old: superseded, new: approved
    │                        └──Owner edit/cancel directly──► superseded by Owner-created request / cancelled
    ├──Owner reject(reason)──► rejected
    └──employee withdraw (before decision)──► withdrawn
```
- Types: `leave`, `half_day`, `comp_leave`. Dates: `start_date` to `end_date` (half day: a single date), **at most 365 days** for every writer, member or Owner (owner decision 2026-09-26, phase 2 review: long enough for a 26-week maternity leave, short enough that a mistyped year cannot block a person's requests or derive leave for years).
- A leave request created at login is linked to that day's `attendance_day`. The Owner's attendance decision and the leave decision are made **together in one action**.
- Approved leave feeds calendar blocks, availability and assignment warnings.
- **Overlaps (2.1):** a new request that overlaps the member's own **`submitted` or `approved`** request is refused (`CONFLICT`, "request a change instead"). Rejected, withdrawn, superseded and cancelled rows **never** block a new request. A change request overlaps its own original by design.
- **Cancelling approved leave (2.1):** the employee's cancellation is a new `submitted` row with `supersedes_id` and `requests_cancellation = true`. Approving it moves the original **and** the cancellation row to `cancelled`, so "approved leave covering a date" is always `state = approved`. Refusing it rejects the cancellation row and the original stays approved. **A cancelled or superseded leave that covers today** returns the untouched derived day (`approved`, `proposed_by_system`, no submission) to `awaiting_choice`, audited as a system correction with reason "leave cancelled", so the gate asks again; a day the person already submitted or the Owner already decided is history and stays. Only one change or cancellation may be open per request.
- **Owner edits** (`leave_owner_edit`, `leave_owner_cancel`): the Owner changes an approved request directly (superseded by a `source = owner` approved row) or cancels it with a reason. **An edit is refused (`CONFLICT`) while the person has a change or cancellation waiting against it: decide that first.** A cancellation does not wait: a change request left open against a cancelled leave is decided later on its own, as a fresh request. **At approval time, approved leave that already covers the dates is `CONFLICT`** (a race at submit time, or an Owner correction made since): the Owner cancels or edits that one first. **Since 2.2 this is only for a form or Owner-created request (`source` `form` or `owner`)**, and the message names the clashing leave's type and dates so the Owner knows which one to cancel or edit. An approved **gate** leave on those dates is superseded instead (§1, "the later decision wins"); `leave_owner_edit()` does the same before its overlap check. A member's leave writes are serialised per member (an advisory lock), so two tabs cannot both pass the overlap check.
- **Dates:** a form request starts today or later; a change may keep the original's start date and must end today or later; the Owner's edit takes any dates. `end_date >= start_date`; a half day is one date.
- **Settled in 2.3 (owner decisions, 2026-09-24):** the member's own screen is **`/leave` ("Attendance & leave")**, reached from the attendance strip (My Day, /today) and a row on Me, **with no nav entry** (own leave is personal, not operations). **What a row offers mirrors the functions exactly** (`leaveRequestActions()`, unit-tested for every state × source, and pgTAP `10` for the same matrix): withdraw = `submitted` and not `source = attendance`; change / ask to cancel = `approved` of **any** source (a gate leave and an Owner-set leave included) **that has not ended** (`end_date >= today`, IST; ongoing leave stays changeable) with no change already waiting. **Leave that has fully passed is closed to the member** (`leave_request_change` answers INVALID_STATE, "This leave has ended. Ask the Owner to correct it.", migration `20260924124326_leave_change_ended.sql`): the Owner corrects a past day through the attendance day, which already carries a reason and history. **The member sees the Owner's reason** on their own rejected requests, cancelled or replaced leave and corrected days. History wording is the member's, not the database's: a system correction reads "Changed to leave: your leave request was approved". The history pages one IST month at a time, from the month of the first attendance day to the current one; the requests page 20 at a time.
- **Settled in 2.4 (owner decisions, 2026-09-24):** the Owner decides leave from **Approvals** (Leave group: `submitted` requests other than `source = attendance`, which are decided through their day in the Attendance group; oldest first) and edits or cancels approved leave from the person's history (`/people/[id]`). Undo, bulk and reasons follow §1 "Settled in 2.4". `leave_owner_edit()` returns `kept_dates` like `leave_decide()`, and both screens show them. Approving a change whose original is no longer approved says so ("the original was cancelled; this is approved as a new leave"). A `CONFLICT` on approval names the clashing leave and links to the person's leave list, where the Owner cancels or edits it.

- **Settled in 3b.2 (owner decisions 2026-09-27, kickoff 3b decisions 10–17; migration `extra_work_comp_leave`, DATA-MODEL §3 "3b.2", PRODUCT §4.3a):**
  - **Extra work notes.** A member adds an **overtime note** (a working day: the day, a rough duration, what they worked on) or an **"I worked today" note** (a day off: the note), for today or up to **7 days back**, one per day and kind, from the Extra work tab of Attendance & leave, from the last 7 days' rows of their attendance history, from the strip on a day off, or in the **End day** confirmation (the note lands with the end, in one transaction). `extra_work_note_submit()`; the kind follows the calendar (`app.is_working_day`), and the other kind is refused with a message naming the right one. Notifies the Owner (5.1).
  - **The Owner decides in Approvals → Extra work** (after Leave, kickoff 3b decision 29), a **review-only** group (every decision needs thought): **Grant 1 day**, **Grant ½ day** or **No comp leave**, and for a day-off note whether the day **counts as worked** (the attendance day is created or corrected to Present on a day off, reason "worked on a day off", the Owner as actor; any leave request behind it stays). `extra_work_note_decide()`. **Nothing is automatic.** The member sees the outcome on the note: "1 comp leave granted · use by 31 Oct", or the neutral "Reviewed by the Owner" (decision 13). Notifies the member (5.1).
  - **Comp leave credits.** `comp_leave_credits`: ½ or 1 day, granted from a note or **standalone by the Owner at any time** (`comp_leave_grant()`, on the person's Leave tab, with an optional note the member sees), **expiring at the end of the IST calendar month it was granted in** (`app.ist_month_end`), however close; the status is **derived** (available · waiting on a request · used · expired · revoked), so no job expires anything and expired credits stay in the history. The Owner **revokes an unused, unreserved, unexpired credit** with a reason the member reads (`comp_leave_revoke()`). Notifies the member (5.1).
  - **Using a credit.** Only through the leave form (Request leave → "Comp leave (1 day)" / "Comp leave, half day (½)", offered **only with a credit**, showing the balance and the use-by date; `comp_leave_balance()`): **one date**, today or later and **on or before the credit's use-by date** (the date counts, not the decision), a full day (`type = comp_leave`, `credit_days = 1.0`) or a half day (`type = half_day`, `credit_days = 0.5`, the day derives as any half day). `leave_submit_comp()` draws the free credits valid on that date **oldest first** and **reserves** them (`comp_leave_credit_uses`); it is still an ordinary request the Owner approves or rejects. **Approval uses the credit; reject, withdraw, the Owner's cancellation, an approved cancellation and an Owner edit release it** (`app.comp_credit_settle`; a credit past its month shows the returned days as expired). **An Owner's correction to comp leave or edit into comp leave uses one too** (3c review): `attendance_decide(correct, comp_leave)` and `leave_owner_edit(…, comp_leave)` draw the member's free credits valid on that date oldest first (`app.comp_credit_draw`) and use them at once, or refuse the whole call. **A comp leave request is never changed, only cancelled and requested again** (`leave_request_change` refuses a change of a request with `credit_days`; asking to cancel stays allowed). The 2.x `leave_submit()` is untouched: a comp leave it creates carries no credit (main's app on the shared staging database; the contract migration decides its fate).
  - **Settled at `/review-phase 3b` (owner decisions 2026-09-28):**
    - **Comp leave is never on a day off.** `leave_submit_comp()` refuses a weekly day off or a holiday (`VALIDATION`: "That date is a day off. Comp leave is for a working day."), and the leave form offers comp leave as a **list of working days** from today to the latest use-by date (`comp_leave_dates()`, with the free days valid on each), so a day off is never shown.
    - **A holiday added (or moved) onto a comp leave date gives the credit back.** The `holidays` trigger `app.holiday_release_comp()` cancels every waiting or approved comp leave request covering the date, with the reason the member reads ("2 Oct became a holiday (Gandhi Jayanti): this comp leave was cancelled and the credit went back."), the Owner as decider, today's untouched derived day back to `awaiting_choice`, and releases the credit (`app.comp_credit_settle`). Audited (`cancelled` with `holiday: true`, `released` on the credit). Ordinary leave is untouched. Notifies the member (5.1).
    - **A standalone grant is idempotent.** The dialog sends a request key (one per opening) and guards its button while pending; `comp_leave_grant(…, request_key)` returns the first grant's credit for the same key (`CONFLICT` if the amount differs), so a double tap makes one credit.
    - **Closed by the 3c follow-up migration (contract step):** comp leave without a credit through `leave_submit('comp_leave')`, `attendance_submit('comp_leave')` and `leave_request_change(…, type = comp_leave)` (main's gate still offers it on the shared staging database until then), each with a pgTAP refusal. **The two Owner routes joined the list at `/review-phase 3c`** (`attendance_decide(correct, comp_leave)`, `leave_owner_edit(…, comp_leave)`; migration `owner_comp_leave_credit`, pgTAP `30`), so a comp leave request exists only with a credit behind it.
  - **The Owner's comp leave uses a credit too** (`/review-phase 3c`, 2026-09-29; this line said the opposite while 3b.2 deferred the question): `attendance_decide(…, 'correct', …, 'comp_leave')` and `leave_owner_edit(…, type = 'comp_leave')` create the approved `source = owner` comp leave request with `credit_days = 1.0`, draw the member's free credits valid on that date **oldest first** (`app.comp_credit_draw`, `expires_on >= the date`: the date counts, as for a member's request) and use them at once; with none the whole call is refused (`VALIDATION`: "Comp leave needs an earned credit valid on that date. Grant one first from their Leave tab."). **Two limits:** these routes take a **full day** only (the half comp day stays `leave_submit_comp()`'s), and an Owner edit into comp leave is **one date** ("Comp leave is one day at a time. Edit it to a single date."); a day off is refused on both ("That date is a day off. Comp leave is for a working day."). Nothing new is needed to release it: the row carries `credit_days` and its uses, so the Owner's cancellation, a later edit (the superseded row's release runs before the new draw, so a moved comp day re-uses its own credit), a holiday on the date and an approved cancellation give the credit back as they do a member's. Re-correcting a day whose approved request already is comp leave creates nothing and needs no credit; a correction to Present leaves the credit used until the Owner cancels the leave (owner decision 2026-09-26). The Correct dialog greys "Comp leave (no credit)" out on the person's page and the edit dialog does the same; Approvals, which lists many people, shows the refusal instead. The month summary (3b.4) counts the day from the attendance days and the credit as used, so the two figures agree.

## 2a. Expense claims (3b.3; PRODUCT §4.18, kickoff 3b decisions 21–27, ADR-0007 amendment 2026-09-27)

```
submitted ──Owner approve──► approved ──Owner mark paid (date, default today)──► paid
    ├──Owner reject(reason)──► rejected
    └──member withdraw (before a decision)──► withdrawn
```
- **Who:** Admins and Staff claim their own (`attendance.self`; the Owner has no claims, freelancers none in the pilot). Only the Owner (`expenses.decide`) reads everyone's and decides. **An Admin never reads anyone else's claim**, not even their team's (RLS, pgTAP per role).
- **Adding a claim:** amount (₹, above 0, paise allowed), a category from the Owner's list (Settings → Expenses; seeded Travel, Food, Materials, Other; archived categories leave the form and stay on old claims), a note (what it was for; required) and the date, **several per day**. From **End day** ("Any expenses to claim today?" **No** ends the day as before; **Yes** ends it and then opens the claim form for that day, which offers **Add another**) or later from **Attendance & leave → Expenses**. `expense_claim_submit()`.
- **The claim window (decision 24):** the expense date is in the current IST month, or in the previous month while today is the **1st–5th**; never in the future (an expense not yet spent is not a claim). Outside it: VALIDATION, "Claims are for this month (and last month until the 5th)."
- **Receipts (decision 23):** a photo (PNG, JPEG or WebP, ≤ 10 MB) through `core/storage`, kept as taken (a small JPEG preview is made beside it, ADR-0010). Optional, **required when the amount is above `org_settings.expense_receipt_above`** (default ₹500; strictly above: ₹500 exactly needs none). The Owner sets the amount in Settings → Expenses; the form reads it and the database checks it. A receipt is visible to the claimant and the Owner only (`app.file_visible`).
- **Deciding:** Approvals → **Expenses**, after Extra work (decision 29), a **review-only** group: Review opens the claim (who, the date, category, amount, note, the receipt) with **Approve** and **Reject…** (a reason the member reads). `expense_claim_decide()`. **Mark paid** (optional date, default today) is on the person's month (`/people/[id]/month`, the Expenses part: one claim, or all approved claims of that month at once), when the claim is paid with the salary. `expense_claim_mark_paid()`. Nothing is reversed: a mistake is a note to the person, never an edit (invariant 9).
- **The member sees** each claim with its state: Waiting · Approved · Paid on <date> · Rejected: <reason> · Withdrawn; **Withdraw** while it waits.
- **Money rules:** amounts appear only on the claimant's own screens and the Owner's; never in a notification's text (decision 9), in search, in an Admin payload or in a Realtime publication.

## 2b. Month summary (3b.4; PRODUCT §4.18, kickoff 3b decisions 18–20, 30, 31)
- **The Owner only** (`attendance.view_all`; the expense line also needs `expenses.decide`): per person on **`/people/[id]/month`** (a fourth tab, "Month", `?month=YYYY-MM`, a month pager that never adds history) and for the team at **More → Reports → Month** (`/reports/month`, one row per person, a tap opens that person's month). Live at any time; IST months; the current month by default.
- **What counts (`month_summary()`, DATA-MODEL §7b):** only days the Owner has decided (approved or corrected); days still waiting show as **"Waiting for your review"**, never as worked. Days recorded by the 2.x gate count like any other (decision 31). Comp leave is its own line and never counts as additional leave, a half day that used a comp credit included. **Additional leave = leave days + ½ × half days + absent days.** Days off worked are their own line. No salary anywhere; the Owner works out pay.
- **Expenses line:** approved and not yet paid, total and count, for claims dated in that month; the person's month lists that month's claims with **Mark paid**.
- Admins and Staff never see it; freelancers are not in it (phase 4 filters `engagement = permanent`).

## 3. Staff tasks

### 3.1 Task state
```
                    ┌──────────────── reopen (Owner/Admin) ────────────────┐
                    ▼                                                     │
 created ─► todo ─► in_progress ─► submitted ─► admin_approved ─► completed
              ▲          ▲            │  │            │
              │          │            │  └─(no admin step)────► awaiting Owner (= admin_approved state, admin_step = none|skipped)
              │          └─ changes_requested ◄── Admin reject(reason) / Owner reject(reason)
              │
 any non-final state ──cancel(reason)──► cancelled
```
| State | Meaning | Who moves it forward |
|---|---|---|
| `todo` | Assigned, not started | Any assignee → `in_progress` (optional) |
| `in_progress` | Being worked on | **Primary owner** → `submitted` (Done) |
| `submitted` | Done, waiting for the Admin | Approving Admin → `admin_approved` or `changes_requested` |
| `admin_approved` | Waiting for the Owner (Admin approved, or no Admin step) | Owner → `completed` or `changes_requested` |
| `changes_requested` | Sent back with a reason | Primary owner → `submitted` again |
| `completed` | **Final.** Owner approved | Creator / approving Admin / Owner can `reopen` → `in_progress` (reason required) |
| `cancelled` | Stopped with a reason, still reportable | Creator / approving Admin / Owner can `reopen` → `todo` (reason required) |

- **Done can be submitted from `todo` or `in_progress`.** `in_progress` is optional.
- **On behalf of a freelancer (ADR-0013, §1b):** `task_acknowledge`, `task_start`, `task_submit_done`, stage ticks, comments and submissions accept `on_behalf_of` = a freelancer assignee; allowed only to that freelancer's **current** coordinator, recorded as actor = coordinator + `on_behalf_of`. A freelancer's primary ownership means their coordinator marks Done. Reviews never carry `on_behalf_of`.
- **Done doesn't wait for acknowledgements.** If the primary owner hasn't acknowledged yet, submitting Done records their acknowledgement automatically (audited). Other assignees' acknowledgements stay tracked and still get reminders.
- **Who may edit, reassign, cancel or reopen a task:** its **creator**, its **approving Admin**, or the **Owner**. Other Admins who can see it can't change it.
- **Reopen** goes through the **same approval route again** (the Admin step is re-evaluated at the next Done). Acknowledgements are retained. The reopen reason is stored **only in `activity_log`** (`meta.reason`); there's no column for it.
- **Locking:** assignees lose edit rights from **`submitted`** onwards, in every route (with or without an Admin step). They can still comment. Editing resumes only through `changes_requested`.

- **Done skips the Admin step** (goes straight to `admin_approved`, with `admin_step` = `none`) when `approving_admin_id` is null (the Owner assigned directly). It also skips it (`admin_step` = `skipped`) when the approving Admin is an assignee. The skip reason is stored **only in `activity_log`** (`meta.reason = 'approver_is_assignee'`).
- **Locking** is described in the table above (from `submitted`).
- **Overdue** is **derived**: `now() > due_at AND state NOT IN (completed, cancelled)`. It's a badge and a filter, not a state. Moving the deadline recalculates it.
- **Overdue escalation:** `overdue_escalate_hours` (default 24) after `due_at`, if the task is still in `todo`, `in_progress` or `changes_requested` (nothing submitted), a `task_reminders(kind = overdue_escalation)` fires once to the approving Admin (or creator) **and** the Owner.
- **Late reason:** when submitting after `due_at`, `late_reason` is required from the primary owner.
- **Approving Admin** is set when the task is created (PRODUCT §4.6 table) and can be changed or removed by the Owner. Changing it while the task is `submitted` sends the review to the new approver.

### 3.2 Acknowledgement (per assignee)
```
assigned (acknowledged_at null) ──"Task Noted"──► acknowledged (timestamp)
   │ every ack_repeat_hours (default 2 h): reminder to the assignee
   ├ after ack_escalate_hours (default 4 h): escalation to the approving Admin (or creator)
   └ after ack_escalate_owner_hours (default 8 h): escalation to the Owner
```
- Each escalation fires once (`task_reminders(kind = ack_escalation)` with `escalation_level` 1 then 2). Repeats to the assignee continue until acknowledged.
- Adding an assignee later starts their own acknowledgement. Removing one keeps their row with `removed_at` set.
- Changing the deadline, scope or primary owner **after acknowledgement** notifies the affected people. Acknowledgement is kept (it recorded that they received the task), and the change shows in the task history.

### 3.3 Reviews and submissions
- Every approve or reject is a `task_reviews` row (step, decision, reason, reviewer, the submission version it refers to).
- File submissions are versioned per task (`task_submissions.version` 1, 2, …). Files are never replaced.

### 3.4 Task requests
`pending ─convert─► converted (task_id set) | ─decline(reason)─► declined | ─withdraw─► withdrawn`

## 4. Clients
```
draft ──Owner activate (needs name + admin)──► active ⇄ paused ──► inactive ──Owner reactivate──► active
```
- **Paused:** readable. No new cycles.
- **Inactive:** readable and searchable. No new projects, items or client-labelled tasks.
- Changing the Admin closes the current `client_admin_assignments` row and opens a new one. Access moves immediately, and the new Admin (and the previous one, if still active) is notified (§9; owner decision 2026-09-27, kickoff 3).
- **Inactive is the end state** (no archive action). **Paused and Inactive stay fully editable**; only the "no new work" rules apply (owner decision 2026-09-27, kickoff 3).
- **Name unique** among clients not Inactive (case-insensitive); **one primary contact** required once any contact exists, archiving the primary asks for the next; GSTIN format checked when given; website and Drive link are `https://` URLs only (owner decision 2026-09-27, kickoff 3).
- **As built (3.1):** `client_activate` (draft | paused → active, needs an active Admin), `client_pause` (active → paused), `client_close(reason)` (active | paused → inactive; the optional reason is the Owner's, kept in `client_close_reasons` keyed by the activity entry, never in its meta: phase 3 review), `client_reactivate` (inactive → active; refused with CONFLICT while another not-inactive client has the name), `client_assign_admin` (any state; closes the open `client_admin_assignments` row and opens the next; the notification is named in the function for 5.1). A client is created as a draft by a plain insert under `clients.manage`, with its Owner-only notes and brand rows created by trigger and, when an Admin is given, the first assignment row. Contacts: the first live contact becomes primary by trigger; `client_contact_set_primary`, `client_contact_archive(next_primary_id)` and `client_contact_restore` move `is_primary` / `archived_at` (`clients.edit_assigned` on a visible client). Audit actions: activated, paused, closed, reactivated, admin_assigned, primary_set, primary_removed, archived, restored.
- **Screens (3.4):** the Owner's ⋯ (list sheet and client header) offers the state's moves (`clientMenuMoves`: Activate only once an Admin is assigned, "Assign Admin" until then), each behind a confirmation whose red button names it ("Pause Sharma Weddings"; Close takes an optional reason); "Change Admin" names the person ("Make Ravi the Admin"). A Draft, Paused or Inactive client shows a banner with its state note and who can change it; every client stays editable. Contacts: "Add contact" (the first is primary), and a contact's ⋯ holds Make primary, Archive (the primary asks for the next) and Restore.

### 4a. Custom field definitions (owner decision 2026-09-27, kickoff 3; built in 3.2)
```
active ──archive──► archived (values kept in every record, hidden from forms, read-only under "Archived fields")
```
- **Who:** global `client` / `contact` definitions are Owner-only; an Admin adds or archives definitions scoped to one of **their assigned** clients; `project` / `item` are Owner-only; `task` and per-task-type arrive with 4.1.
- **Type is immutable once a value exists** (refused: archive and add a new field). Label, help text, section, position and select options stay editable; a select stores the option key, so a renamed option rewrites nothing.
- **Required** is checked only when the form that shows the field is saved: an older record shows "—" and saves once filled; no client, project, item or task transition is ever blocked by a custom field.
- **As built (3.2):** `core/custom-fields` — `validateCustomFields({definitions, values, previous})` (the zod builder per type; required refused only here; archived keys keep their previous value; unknown keys dropped; errors keyed `customFields.<key>`), `validateCustomFieldsFor(entity, values, {clientId, previous})` in the server barrel (called by the client and contact actions before every write), `<CustomFieldsForm>` (typed inputs, a select stores the option key) and `<CustomFieldsView>` ("—" for empty, "Archived fields" read-only). Settings → Custom fields (`/settings/custom-fields?entity=client|contact|project|item`): entity tabs are view controls; Add / Edit in a bottom sheet (label, key derived from the label and fixed once saved, type, options one per line, required, help, section, scope "Every client" or one client); Archive / Restore. Who may write is decided by `app.field_definition_writable()`; the type lock by `app.field_definitions_guard()` (pgTAP 17).
- **Files** (owner decision 2026-09-27, kickoff 3, 3.3): `files.status` pending → ready (upload completed) | failed; **replacing** a logo or avatar archives the old row (`archived_at`); the daily `storage_cleanup` job deletes the R2 object of a row archived **30 days** ago, of a `pending` or `failed` row older than **24 hours**, and (owner decision 2026-09-27, 3B review) of a **`ready` original that nothing references, older than 7 days** (an upload whose save failed, or whose answer was lost), marking it `deleted` (the row stays, invariant 9). "References" are the foreign keys that point at `files` (logo, avatar, client logo today; every later consumer declares one); a preview follows its original unless something references the preview itself (ADR-0010 keeps submission previews). An upload can be attached only within 6 days of its upload, a day inside that window. Work submissions follow §5A instead.

## 5. Client work

### 5.1 Project status
`open ─► in_progress ─► completed` · `any ─► cancelled` · Owner can `reopen` a completed or cancelled project.
- **open → in_progress happens automatically** inside the transition function the first time any of the project's items has a stage ticked or is marked done.
- **completed and cancelled are Owner-only and never automatic.** A project with every item approved still stays open until the Owner closes it.

### 5.2 Cycles
- Every project has cycles. A **one-time** project gets exactly one cycle (no period) when it's created, enforced by a partial unique index on `project_cycles(project_id) where period_start is null`. **Recurring** projects get one cycle per period, and `project_create` immediately creates the **current** period's cycle (a monthly project started on the 15th gets that month at once, then the next on the 1st).
- **00:00 IST job:** on the **1st** (monthly projects) and **Monday** (weekly projects), for projects whose client is **active** and whose status is open or in_progress, `cycle_generate(project, period)` copies `project_item_blueprints` into new items. It's **idempotent**: unique `(project_id, period_start)`.
- A cycle is `open` until the next cycle exists **and** every unfinished item in it has been carried forward, closed or approved. Then it's `settled`. **`leave_pending` keeps the cycle open**, because those items are still workable, and the Owner is reminded about them until they're decided.

### 5.3 Items
```
open ──Admin tick done──► done ──Owner approve──► approved (final, revenue achieved)
  ▲                         │
  └────Owner reject(reason)───┘
open/done ──cancel(reason, Admin or Owner)──► cancelled
```
- **Stage ticks** (`project_item_stages`) are independent of item state. Ticking all stages doesn't mark the item done.
- **Carry decision** (Owner, for items not `approved` when their cycle's period has ended):
  - `carry_forward` → a **new item** in the next cycle with `carried_from_item_id` and `origin_cycle_id` = the original. The original item becomes `carried` (a final state). The new item keeps the original's value and category. **If the next cycle doesn't exist yet** (before the 1st or Monday, or because the client is **paused**), `cycle_carry_decide` creates it with `generated_by = 'carry'`, and the scheduled `cycle_generate` later finds it already there (idempotent).
  - `close` → `cancelled` with a reason (`cancelled_by`, `cancelled_at`). Its value **stays in Potential** and reports show it as *closed, not achieved* (§6).
  - `leave_pending` → stays in its original cycle, still workable. Can be decided again later.
- **Bulk approve** = the same function called for each item, so each gets its own approval record.

## 5A. Work submissions and the Google Drive archive

```
Staff submits a version
   ├─ upload (image ≤ 25 MB, video ≤ 100 MB)
   │     browser → R2 (direct, resumable) → submission_items(kind=upload, archive_state=queued)
   │     photos: a JPEG preview is generated for display; the ORIGINAL is never modified
   │     └─ drive_jobs(upload_file) ─► Drive: Clients/<Client>/<YYYY-MM>/Photos|Videos/
   │                                   └─ archived ✓ (drive_file_id, web link stored)
   └─ Drive link (anything larger)
         check access now ──ok──► drive_jobs(copy_link) ─► Google server-side copy into our Drive ─► archived ✓
                           └──private/missing──► link_state=private, archive_state=blocked
                                                  ├─ notify the submitter: "make it 'anyone with the link'"
                                                  └─ recheck_link job (backoff, up to 7 days) ─► archives itself once access is granted
```

- **Approval is never blocked** by a failed archive. The task shows the warning, and the Owner decides.
- **Only submissions are archived.** `task_submit_version` queues the `drive_jobs`. Logos, avatars and previews are ordinary `files` and are never sent to Drive.
- **Retention (`delete_local` jobs, daily):** photo originals leave R2 after **90 days**, video originals after **30 days**, and **only when `archive_state = archived`**. `local_deleted_at` is set and the original's `files.status` becomes `deleted`; the row, the JPEG **preview** (kept forever), the Drive link and the history stay. Nothing is deleted while the archive queue is blocked or the Google account needs reconnecting.
- **Folders** are created on demand and cached in `drive_folders`. Names: `YYYY-MM-DD_<task-title-slug>_v<version>_<FirstName>_<nn>.<ext>`. Each Drive file's description carries the MaxOff task URL.
- **Token expiry:** any Google call returning `invalid_grant` sets `drive_account.state = needs_reconnect`, notifies the Owner, and parks the queue. Reconnecting drains it.
- **Quota:** the account's free space is checked daily, and the Owner is warned below 10%.

## 6. Revenue calculation (Owner only)
For each item, `item_value`:
1. an explicit `item_billing.value` if set, otherwise
2. for a recurring project, `cycle_amount ÷ number of planned items in the cycle`; carry-ins are valued from their **origin** cycle; otherwise
3. for a one-time project, `fixed_amount ÷ number of planned items`.

- **Planned items** of a cycle = its items that are **not carried in** (`carried_from_item_id is null`) and **not cancelled before the cycle started** (`state <> 'cancelled' OR cancelled_at >= coalesce(period_start, cycle created_at)`). An item closed at the carry decision was cancelled after the cycle started, so it **stays planned**.
- **Potential** (cycle / project / client / category / month) = Σ item_value of planned items.
- **Achieved** = Σ item_value of items with `state = approved`, attributed to the **origin** cycle's period.
- **Closed, not achieved** = Σ item_value of planned items with `state = cancelled`, reported as its own line so lost revenue stays visible.
- **Remaining** = Potential − Achieved.
- **Overrides:** `revenue_overrides` for a cycle or one-time project store `calculated_value` (frozen when overriding), `adjusted_value`, note, Owner and time. Reports show *System calculated* and *Owner adjusted* side by side.
- This is implemented as security-invoker SQL views over Owner-only tables. Non-Owner roles can't select from them.

## 7. Month close and snapshots
```
month M (IST) open ──Owner close──► closed (snapshot v1, immutable)
                                     └──Owner correct(note)──► snapshot v2 (links v1; v1 kept)
```
- A snapshot is a JSON document holding every figure in the monthly report plus the raw rows the AI export needs (attendance, tasks, items, revenue lines, metrics).
- Closing doesn't lock operational data. It freezes the **report**. Reports for closed months read the latest snapshot version.

## 8. Scheduled jobs (all idempotent, times in IST)
**Runs in:** `pg_cron` = a SQL function inside Postgres (database-only work). `worker` = a Cloudflare Cron Trigger calling `/api/cron/<job>` with `CRON_SECRET` and the service role (anything that needs the network: Web Push signing, Google Drive, R2, Resend). `gha` = GitHub Actions.

| Job | Runs in | When | What it does |
|---|---|---|---|
| `reminders_tick` | pg_cron | every 5 min | Creates due notifications (before due, due, overdue, acknowledgement repeats, ack and overdue escalations). Records `sent_at` so nothing is sent twice |
| `end_day_reminder` | pg_cron (5.1) | 20:30 (`logout_reminder_time`) | "You haven't ended your day": everyone with a Start day and no End day today (`app.end_day_reminder_due()`, 3b.1; the notification rows and the schedule arrive with 5.1) |
| `absent_check` | pg_cron | 23:59 (18:29 UTC) | Creates leave-derived days for anyone who never logged in, then proposed-absent days for working days, and notifies the Owner (5.1). Built in 2.5 |
| `end_not_recorded` | pg_cron | 00:00 (18:30 UTC, the minute after absent_check) | Flags days with a Start day and no End day ("End of day not recorded"). Built in 3b.1 |
| `eod_report` | pg_cron | 00:01 (after the above) | Builds the Owner end-of-day report and notifies the Owner |
| `cycle_generate` | pg_cron | 00:00 on the 1st and every Monday | Creates recurring cycles (skips any already created by a carry decision) |
| `cycle_close_prompt` | pg_cron | 00:05 on the same days | Notifies the Owner about unfinished items in the cycles that just ended |
| `push_dispatch` | worker | every minute | Sends queued push and email deliveries, retrying with backoff; applies the email cap |
| `drive_archive_tick` | worker | every 2 min | Runs queued `drive_jobs` (copy link, upload file, recheck link) with backoff |
| `storage_cleanup` | worker | 03:00 | `delete_local` jobs: photo originals > 90 days, video originals > 30 days, archived only. Also clears from R2: rows archived 30 days ago, `pending`/`failed` uploads after 24 h, and `ready` originals nothing references after 7 days (previews follow their original) |
| `drive_quota_check` | worker | 03:30 | Refreshes Google quota and warns the Owner below 10% free |
| `nightly_backup` | gha | 02:00 | pg_dump to R2 |

**The job date is derived inside the job, never taken from the clock at face value (ADR-0008, 2.5).** `app.job_day(at, cutoff)` answers the most recent IST date whose cutoff (23:59 for the attendance jobs) has passed at `at`: at 23:59 IST it is that day, at 00:00 IST the next day it is still the day that just ended, and at 23:58 it is yesterday. So a run that pg_cron starts late still processes the right day, and a run started early repeats yesterday, which writes nothing. **Catch-up (owner decision 2026-09-25):** each nightly run processes the **last 7 IST dates** up to the job day, oldest first. The jobs are idempotent, so already-processed days write nothing, and a missed night (an outage, or the free-plan project paused) is filled on the next run; a date before a member's first attendance day is still skipped. `app.absent_check(for_date)` and `app.logout_not_recorded(for_date)` stay callable for a single date (a manual re-run as `postgres`), and refuse a date whose cutoff has not passed. Each run is recorded in `cron.job_run_details`.

## 9. Who gets notified
| Event | Recipients |
|---|---|
| Task assigned / assignee added | Each new assignee (**a freelancer's notifications go to their current coordinator**, worded for them: "Asha's task …"; this applies to every row below that names an assignee, ADR-0013) |
| Acknowledgement missing (repeat) | That assignee |
| Acknowledgement escalation | Level 1 (`ack_escalate_hours`): approving Admin (or creator). Level 2 (`ack_escalate_owner_hours`): Owner |
| Overdue escalation (`overdue_escalate_hours` past due, nothing submitted) | Approving Admin (or creator) + Owner |
| Task changed (deadline, scope, priority, assignee, reminders) | Affected assignees |
| Reminder: before due / due / overdue | Assignees. Overdue also goes to the approving Admin (or creator) |
| Task submitted (Done) | The approving Admin, or the Owner if there's no Admin step |
| Admin approved | Owner |
| Changes requested | Assignees |
| Task completed / cancelled / reopened | Assignees (+ creator) |
| Comment added | Other participants on the task (assignees, approving Admin, creator) |
| Task request created | Owner + the client's Admin (or all Admins if there's no client) |
| Coordinator changed | The new coordinator (and the previous one, if still active) |
| Client's Admin assigned or changed (kickoff 3) | The new Admin (and the previous one, if still active) |
| Attendance submitted | **Nobody.** The Owner's Today counts are the live digest, so no notification per person |
| Absent proposed (23:59 job) | Owner: **one** notification listing everyone proposed absent |
| Attendance decided / corrected (by the Owner or automatically when a later leave approval wins) | That member |
| Leave requested / changed | Owner |
| Leave decided | That member |
| Extra work note added (overtime, or a day off worked) | Owner (3b.2) |
| Extra work note decided (comp leave granted, or reviewed), comp leave granted standalone, comp leave revoked | That member (3b.2) |
| Forgot to end the day (20:30, started and not ended) | That member (3b.1; replaces "forgot to log out") |
| Expense claim submitted | Owner (3b.3; **no amount in the text**: "Ravi added an expense claim") |
| Expense claim approved, rejected (with the reason) or marked paid | That member (3b.3; no amount in the text) |
| Item done (Admin tick) | **Nobody.** It shows in the Owner's pending-approval count |
| Item rejected | The client's Admin |
| Cycle generated / unfinished items to decide | Client's Admin / Owner |
| Submitted link is private or unreachable | The submitter (with instructions), and the approving Admin on the task card |
| Google Drive needs reconnecting, or is low on space | Owner only |
| Anything financial | Owner only |
| Upcoming event (shoot, meeting…) on task reminders | Assignees + approving Admin |

Every notification is stored in `notifications` (in-app history + deep link) and then delivered by push. **Email** is sent for **invites, an email change (to both addresses, §1a), escalations, task assigned, an event tomorrow, the Owner digest**, and to anyone with no working push subscription, within the per-person daily cap (invites, email changes and escalations bypass it).

## 9a. Delivery, sessions and reachability

```
notification created
   ├─ in-app (Realtime)                       always
   ├─ push → every active subscription of the recipient
   │     ├─ member has a live session → full payload (title + body + deep link)
   │     └─ member logged out         → TITLE ONLY ("MaxOff: new task assigned"), link opens login → target
   └─ email  when the kind is in the email set, or no subscription is healthy
```

**Subscription lifecycle**
| Event | What happens to the subscription |
|---|---|
| Permission granted / re-granted | Created or re-activated, with `platform`, `is_standalone`, `label` |
| Logout (normal) | **Kept.** Push continues, title-only |
| "Sign out of this device" | Deleted (`disabled_reason = 'signed_out'`) |
| Member deactivated | All of theirs deleted (`'deactivated'`) |
| Push returns 404/410 | Disabled (`'gone'`), and the member sees the banner on next visit |
| Repeated failures (≥ 5) | Disabled (`'expired'`), counted as unreachable |

**Reachability** (`member_reachability` view, refreshed on delivery results and on login):
`ok` · `no_subscription` (never allowed) · `permission_revoked` · `ios_not_installed` (iOS with no standalone subscription) · `failing`.
Shown in Settings → Notifications to the Owner for everyone, and to an Admin for people on their tasks. Anyone `no_subscription`, `permission_revoked`, `ios_not_installed` or `failing` for **48 h** raises one notification to the Owner, at most weekly per person.

**Test notification:** `notification_send_test()` sends a push to the caller's own subscriptions, records `last_test_at`, and the UI reports whether it was accepted by the push service. It's part of onboarding and is available in Settings → Notifications for everyone. Emails per person per day are capped by `org_settings.email_daily_cap_per_member` (default 20); **invites and escalations bypass the cap**.
