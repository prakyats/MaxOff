# Runbook: Cloudflare security settings (Owner, in the dashboard)

**Owner decision (26 Nov 2026, v7.5 Q4):**
- the **managed WAF rules on**;
- **rate limits on sign-in and on the upload starts**;
- **Bot Fight mode off**.

A session cannot change the zone's settings, so the **Owner** does these steps once, in the Cloudflare
dashboard, on the zone **`maxoff.in`**. Nothing here changes the app's code or needs a release.

Marked _(unverified)_: a dashboard step the repository cannot show. Cloudflare renames its menus often; follow
the dashboard if it differs, and correct this file. Write what you saved in the table at the end.

## Before you start: check the plan

Open dash.cloudflare.com → the account → **`maxoff.in`** → **Overview**: the plan's name is on the right
_(unverified)_. The **Free** plan limits two things here:

| | Free plan | Pro plan and above |
|---|---|---|
| Managed WAF rules | The **Cloudflare Free Managed Ruleset** only, on by default | The full **Cloudflare Managed Ruleset** and the OWASP set |
| Rate-limiting rules | **One** rule, counted over **10 seconds**, blocking for **10 seconds** | Several rules, longer periods and blocks |

The steps below say what to do on each.

## 1. Managed WAF rules: on

1. **Security → WAF → Managed rules** _(unverified; on newer dashboards: **Security → Security rules →
   Managed rules**)_.
2. **Free plan:** check that **Cloudflare Free Managed Ruleset** shows **Enabled**. If it is off, turn it on.
   That is all a Free plan offers.
3. **Pro plan or above:** **Deploy** the **Cloudflare Managed Ruleset** with its default action. Leave the
   OWASP Core Ruleset **off** for now: it scores every request and can block the app's own form posts. If it
   is ever turned on, use **Log** first, for a week.
4. **For the first week, watch Security → Events** (below). If a managed rule blocks a real person, note
   the rule's ID and the path, and add an **exception** for that one rule on that one path; do not turn
   the whole set off.

## 2. Rate limits: sign-in and the upload starts

**What is counted.** The paths are all `POST`s; opening a page (`GET`) is never counted.
- **Sign-in:** the sign-in and password-reset forms, `/login` and `/forgot-password`. They are server
  actions, which post to the page's own path. `cloudflare-rate-limit.md` already has this rule; if it is
  saved, edit that rule as below instead of adding a second one.
- **Upload starts:** the requests that begin an upload.
  - `/api/upload/start`: an upload from a client link (v4.5).
  - `/api/handin/start`: a hand-in (v5.0).
  - Adding a path before its release is live does no harm: nothing posts to it yet.
  - The task and receipt attachments that `main` uploads today start as a server action. A server action
    posts to whichever page it is on, so the edge cannot tell it apart; it is not in this rule.

**The office shares one IP.** Everyone in the office counts as one visitor. The rates below are far above what
a team of 15–20 does, even all at once at 09:00. If people are ever blocked together, raise the rate rather
than removing the rule.

### Free plan: one rule for both

| Field | Value |
|---|---|
| Rule name | `MaxOff sign-in and upload starts: per-IP limit` |
| Expression | `(http.host eq "app.maxoff.in" and http.request.method eq "POST" and http.request.uri.path in {"/login" "/forgot-password" "/api/upload/start" "/api/handin/start"})` |
| Counted by | IP |
| Rate | **10 requests per 10 seconds** |
| Action | **Block** |
| Duration | **10 seconds** |

Ten in ten seconds lets a person hand in a whole batch at once (a start is one request per file), and still
stops a script trying passwords: about one attempt a second at most.

If **Request method** cannot be used in the expression on your plan, drop that part:
`(http.host eq "app.maxoff.in" and http.request.uri.path in {"/login" "/forgot-password" "/api/upload/start" "/api/handin/start"})`,
and raise the rate to **15 per 10 seconds**, because opening the sign-in page then counts too.

### Pro plan or above: two rules

1. **Sign-in:** exactly as `cloudflare-rate-limit.md` (10 per minute, block 10 minutes).
2. **Upload starts:**

| Field | Value |
|---|---|
| Rule name | `MaxOff upload starts: per-IP limit` |
| Expression | `(http.host eq "app.maxoff.in" and http.request.method eq "POST" and http.request.uri.path in {"/api/upload/start" "/api/handin/start"})` |
| Counted by | IP |
| Rate | **60 requests per 1 minute** |
| Action | **Block** |
| Duration | **1 minute** |

### Click-steps _(unverified)_

1. **Security → WAF → Rate limiting rules** (newer dashboards: **Security → Security rules → Create rule →
   Rate limiting rule**).
2. **Create rule** (or open the existing sign-in rule to edit it on the Free plan).
3. Fill the fields from the table: **Edit expression** and paste the expression; **With the same
   characteristics: IP**; the rate; **Block**; the duration.
4. **Deploy**.

## 3. Bot Fight mode: off

**Security → Bots** _(unverified)_ → **Bot Fight Mode: Off**. It challenges requests it guesses are bots,
and the app's own background calls (the installed app's refresh, push subscription, the service worker) can
look like bots to it.

While you are there: leave **Block AI bots** as it is; it does not affect the app.

## 4. Watch it for a week: Security → Events

**Security → Events** _(unverified)_ lists every request a rule blocked or challenged, with the rule's
name, the path and the country. For the first week after these changes:
- **Expected:** blocks on `/login` from places the team never is, and scanners trying paths MaxOff does not
  have (`/wp-admin`, `/.env`).
- **Not expected:** a block on a path the team uses, from India, during working hours. Note the rule and the
  path, add an exception for that rule on that path (step 1.4), and tell the advisor session so the
  cause is written down.

## If something stops working

Turn off the one rule that blocked it (its switch is on the same page), not the whole WAF. A blocked person
is let through again as soon as their block's duration ends.

## Related

- `cloudflare-rate-limit.md`: the sign-in rule alone (gap audit 4). On the Free plan this file's single rule
  replaces it.
- Supabase Auth's own sign-in limit stays on (README "Hosted auth settings").
- `docs/handoff/v7.5-plan.md` §2.5, §2.6 and §6 Q4.

## Saved

| Date | Plan (Free / Pro) | What was saved | By |
|---|---|---|---|
| | | | |
