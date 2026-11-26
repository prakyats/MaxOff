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
5. From now on, every sign-in asks for the newest code after your password. A device you are already
   signed in on stays signed in.

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

## 4. A lost or replaced phone

**An Admin's:**
1. The Owner opens Supabase → the project → **Authentication → Users** → the Admin → **MFA factors** →
   delete the authenticator _(unverified: the menu names)_.
2. At their next sign-in the Admin sets up the new phone, because two-step sign-in is still on for them.

**The Owner's own:**
- With the key in your password manager: add it to the new phone's authenticator, and sign in as usual.
- Without it: Supabase → **Authentication → Users** → yourself → delete the authenticator, then sign in.
  The app sets up the new phone.
- Then follow `incident.md` → "A lost phone or a stolen account": change the password, and end the other
  sessions.

## Related

- `docs/handoff/v7.5-plan.md` §2.6 and §6 Q2.
- The database does not yet check the second step itself: the app does, before every screen and action. A
  database check is a follow-up (`docs/decisions/0018-draft-database-second-step.md`).
