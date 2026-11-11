# Runbook: the Cloudflare rate-limit rule on sign-in (Owner, in the dashboard)

Gap audit 4 (`docs/reviews/6b20b-gap-audit.md`): `wrangler.jsonc` has no rate limit, and the sign-in and
password-reset forms run as server actions on the Worker, so Supabase Auth may see Cloudflare's IPs
instead of the person's. A Cloudflare WAF rule counts the **real visitor IP** at the edge, before the
Worker runs. A session cannot change the zone's rules, so the **Owner** adds this one, once.

## The rule

| Field | Value |
|---|---|
| Rule name | `MaxOff sign-in and reset: per-IP limit` |
| Zone | `maxoff.in` |
| Matches | `POST` requests to `/login` or `/forgot-password` on `app.maxoff.in` |
| Expression | `(http.host eq "app.maxoff.in" and http.request.method eq "POST" and http.request.uri.path in {"/login" "/forgot-password"})` |
| Counted by | IP |
| Rate | **10 requests per 1 minute** |
| Action | **Block** |
| Duration | **10 minutes** |

Why these paths: the sign-in form (`src/app/(auth)/login`) and the reset form
(`src/app/(auth)/forgot-password`) submit as Next server actions, which are `POST`s to the page's own
path. Opening the pages (`GET`) is not counted, so someone who mistypes and reloads is never blocked. A
person signs in a handful of times a day; 10 attempts in a minute from one IP is a script.

**The office shares one IP.** If the whole team signs in from the same office network at once, they share
the count. Ten POSTs a minute is still far above what a team of 15–20 does at 09:00, but if people are
ever blocked together, raise the rate (for example to 20) rather than removing the rule.

## Check the plan first _(unverified)_

On Cloudflare's **Free** plan, rate-limiting rules have been limited to **one rule**, a **10-second**
counting period and a **10-second** block, with fewer fields in the expression. If the dashboard does not
offer "1 minute" and "10 minutes":

- **Free-plan version:** counting period **10 seconds**, **3 requests**, action **Block**, duration
  **10 seconds**. That is about the same rate (18 a minute at most), with a shorter block.
- If **Request method** cannot be used in the expression, match the path only:
  `(http.host eq "app.maxoff.in" and http.request.uri.path in {"/login" "/forgot-password"})`, and raise
  the count to **5 per 10 seconds**, because opening the page counts too.

Write which version was saved in the table at the end.

## Click-steps _(unverified: check in the dashboard)_

1. dash.cloudflare.com → the account → the zone **`maxoff.in`**.
2. **Security → WAF → Rate limiting rules** (on some dashboards: **Security → Security rules → Create
   rule → Rate limiting rule**).
3. **Create rule**.
4. **Rule name:** `MaxOff sign-in and reset: per-IP limit`.
5. **If incoming requests match:** choose **Edit expression** and paste the expression above (or build it:
   Hostname equals `app.maxoff.in` AND Request Method equals `POST` AND URI Path is in `/login`,
   `/forgot-password`).
6. **With the same characteristics:** **IP**.
7. **When rate exceeds:** **10** requests per **1 minute** (Free plan: see above).
8. **Then take action:** **Block**. **For duration:** **10 minutes**.
9. **Deploy**.

## Prove it (without touching anyone's account)

1. Open `https://app.maxoff.in/login` in a private window. It loads: the rule does not count `GET`s.
2. Sign in once as yourself: it works.
3. Do **not** test by hammering the real sign-in. Use Security → Events in the dashboard over the next
   days instead: blocked requests show the rule's name _(unverified)_.

## If someone is blocked by mistake

The block ends by itself after the duration. To lift it at once, disable the rule in the same page, then
enable it again. Tell the Owner, and consider raising the rate.

## Related

- Supabase Auth's own limit stays on (README "Hosted auth settings": 30 sign-ins per 5 minutes per IP).
- Gap audit 4 also asks to test which IP Supabase Auth sees; that is separate and not part of this rule.

## Rule saved

| Date | Version (full / Free plan / path only) | By |
|---|---|---|
| | | |
