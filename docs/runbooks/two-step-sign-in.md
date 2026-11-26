# Runbook: two-step sign-in (Owner)

**Owner decision (26 Nov 2026, v7.5 Q2):**
- **required for the Owner**, with an authenticator app (Google Authenticator, Microsoft Authenticator,
  1Password…);
- **optional for Admins**, who turn it on or off in Me → Sign-in;
- not offered to Crew.

After the password, the app asks for the 6-digit code the authenticator shows (Supabase Auth's TOTP). Who
must pass it is the app's rule (`src/core/auth/second-step.ts`):
- the Owner, wherever `OWNER_MFA_REQUIRED` is `on`;
- anyone who turned it on.

Marked _(unverified)_: a dashboard step the repository cannot show. Follow the dashboard if it differs, and
correct this file.

## 1. Before the release reaches production: turn TOTP on in Supabase (once per project)

For **both** projects (`maxoff-production`, then `maxoff-staging`):

1. supabase.com → the project → **Authentication → Multi-Factor** _(unverified; on some dashboards:
   Authentication → Sign In / Providers → Multi-Factor Authentication)_.
2. **TOTP (App Authenticator):** enabled, for enrolment and for verification.
3. Leave Phone and WebAuthn off.
4. Save.

Without this, setting up the app fails ("MFA enroll is disabled for TOTP").

## 2. Production: your first sign-in after the release

Production has `OWNER_MFA_REQUIRED=on` (`wrangler.jsonc`), so the release asks you at once:

1. Sign in with your email and password as usual.
2. The app shows **Set up two-step sign-in**. Tap **Set up the authenticator app**.
3. In your authenticator app, add an account and scan the QR code (or type the key shown under it).
4. Enter the 6-digit code the app shows, and tap **Continue**.
5. From now on, every sign-in asks for the newest code after your password.
6. **Every device you were already signed in on asks for the code once** after the release: those
   sessions have not passed the second step yet. Enter the code on each; it then stays signed in as
   before.

**Keep the key safe as a fallback.** Copy the key under the QR code into your password manager when you set
it up. A new phone can then be set up from the key, without the old one.

## 3. Staging: so the speed probe and the guide pictures keep working

Staging runs with `OWNER_MFA_REQUIRED=off` until these steps are done, because the speed probe signs in as
staging's Owner and cannot read your phone.

1. On staging (`https://maxoff-staging.pixoraclips.workers.dev`), sign in as **staging's Owner** → Me →
   Sign-in → **Turn on** → **Set up the authenticator app**.
2. **Copy the key** shown under the QR code before you enter the code.
3. GitHub → the repository → Settings → Environments → **staging** → Add secret:
   - name **`STAGING_OWNER_TOTP_SECRET`**;
   - value: the key.
   - Never paste it in chat, an issue or a commit (CLAUDE.md, rule 10).
4. Scan the QR code with your authenticator too (or skip it: staging's Owner is a test account), enter the
   code, and finish.
5. Tell the advisor session. A builder then changes staging's `OWNER_MFA_REQUIRED` to `on` in
   `wrangler.jsonc`, and the next Preview's speed probe signs in through the second step.

Until step 5, staging's Owner is asked for the code only because the switch in step 1 turned it on. The
probe answers it with the key once the secret exists. Before then the probe would fail on that account, so
do step 3 straight after step 1.

## 4. Lost phone, or locked out

Everything here is done by the **Owner in a dashboard**. No builder runs SQL against production
(CLAUDE.md), and nobody needs to.

**An Admin's lost phone:**
1. Supabase → the project → **Authentication → Users** → the Admin → **MFA factors** → delete the
   authenticator _(unverified: the menu names)_.
2. At their next sign-in the Admin sets up the new phone, because two-step sign-in is still on for them.

**The Owner's own lost phone:**
- **With the key** in your password manager: add it to the new phone's authenticator app, and sign in as
  usual. Nothing else is needed.
- **Without the key:**
  1. On a computer, sign in to supabase.com (your Supabase account, not MaxOff) → `maxoff-production` →
     **Authentication → Users** → your email → **MFA factors** → delete the authenticator _(unverified)_.
  2. Sign in to MaxOff with your password. With no authenticator left, the app shows **Set up two-step
     sign-in**: set up the new phone (keep the key this time).
  3. Then follow `incident.md` → "A lost phone or a stolen account": change the password, and end the other
     sessions.

**"Two-step sign-in can't be used right now: authenticator apps are switched off for MaxOff."**
- This shows when production requires your second step (`OWNER_MFA_REQUIRED=on`) but Supabase's TOTP is
  switched off (step 1 not done, or switched off since).
- The app says so, both on set-up and on the code step, instead of letting you retry in a loop.
- **The fix:** Supabase → `maxoff-production` → **Authentication → Multi-Factor** → TOTP enabled for
  enrolment and verification → Save, then sign in again.
- **If Supabase's dashboard cannot be reached, but Cloudflare's can:** Cloudflare → Workers & Pages →
  `maxoff` → Settings → Variables and Secrets → `OWNER_MFA_REQUIRED` → set it to `off` → Deploy
  _(unverified: the menu names)_. The Owner's sign-in then asks for no code, until it is set back to `on`
  (the next deploy puts `wrangler.jsonc`'s `on` back by itself). Tell the advisor session the same day.
- **If neither dashboard helps:** roll the Worker back in Cloudflare (Workers & Pages → `maxoff`
  → Deployments → the release before v7.5 → Rollback). That release has no second step; tell the advisor
  session the same day (CLAUDE.md, "a bad release is fixed the same day").

**Signed out everywhere and the password forgotten too:** "Forgot your password?" on `/login` works as
before. The second step follows the new password.

## Known limits (v7.5 security review)

- **The database does not check the second step** (ADR-0018, draft). A password alone still opens the API
  (PostgREST, Realtime) to that member's RLS; the app's screens and actions are closed to it.
- **A code can be used twice within its 30 seconds.** GoTrue accepted the same TOTP code for two sessions in
  one window (local probe, 26 Nov 2026), and there is no setting that changes this. The risk is low: a code
  needs the password first and lives about 30 s. MaxOff does not build its own check. Each verify upgrades
  only the session that sent it (GoTrue's challenge is bound to that session's token), so one verify never
  counts for another session.
- **Two browsers verifying the same factor at the same moment can fail** inside GoTrue (a deadlock: the
  challenge answers 500). The app shows an error, never "wrong code"; tapping Continue again works.

## Related

- `docs/handoff/v7.5-plan.md` §2.6 and §6 Q2.
- The database does not yet check the second step itself: the app does, before every screen and action. A
  database check is a follow-up (`docs/decisions/0018-draft-database-second-step.md`).
