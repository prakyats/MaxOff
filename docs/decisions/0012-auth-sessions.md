# ADR-0012: Auth sessions: token-hash links, proxy as refresh, functions for session events

- **Status:** accepted
- **Date:** 2026-09-22

## Context
Task 1.2 wires Supabase Auth (email + password, invite-only) into the app. Three things needed a decision that later tasks (1.3 invites, 2.1 attendance, 5.4 devices) will build on:
1. How an emailed or script-generated link (password recovery now, invites next) opens a session on the server, given that `@supabase/ssr` defaults to PKCE, whose verifier lives in the browser that started the flow. A link from the CEO bootstrap script, or opened on another device, has no verifier.
2. Where the "is this person signed in and active" decision lives, given that Next 16's `proxy.ts` runs on every request but Server Components can't write cookies, and ADR-0011 rule 3 puts session decisions in `core/auth`.
3. How login and logout reach `session_events`, which has no INSERT grant for the API role (1.1).

## Decision
1. **Auth links carry a token hash and are verified server-side.** Every auth email template links to `/auth/confirm?token_hash={{ .TokenHash }}&type=<type>`; the route handler calls `core/auth` `verifyAuthLink()`, which runs `verifyOtp({ type, token_hash })` and redirects (recovery and invite → `/set-password`). No PKCE verifier is involved, so the bootstrap script can print a link and a link works on any device. The hosted projects must use the same template text (README → "Hosted auth settings").
2. **`src/proxy.ts` refreshes and redirects from the JWT alone; `core/auth` decides.** The proxy calls `updateSession()`: it refreshes the Supabase cookies (the one place that can write them on a plain page request) and redirects a visitor with no session to `/login?next=` (or a signed-in one away from the sign-in pages). It reads no table. `requireMember()` in `(app)/layout.tsx` is the decision: a session whose member row is missing, invited or deactivated is ended (`/auth/signout`) and sent to `/login?reason=inactive`. Deactivation therefore takes effect on the next request at every layer: RLS (`app.current_member()` returns no row), the layout, and the login action itself (it signs the session out again and refuses).
3. **Session events are written by `security definer` functions:** `public.session_login()` and `public.session_logout()` require an active member and insert the row; there is no `activity_log` entry for them, since the `session_events` row is the record. The first CEO is created by `public.bootstrap_ceo()`, executable by `service_role` only and refusing once any member exists; the script that calls it never handles a password and prints a one-time recovery link instead.

Also decided with it: passwords are at least 12 characters with no composition rule (hosted projects add leaked-password protection); logout ends this device's session only (several devices are allowed); `session_events.ip_hash` is a salted SHA-256 (`SESSION_IP_HASH_SALT`) or null, never an unsalted hash.

## Consequences
- Every auth email template, on every environment, must build the `/auth/confirm` URL; the default `{{ .ConfirmationURL }}` does not work. 1.3 adds the invite template the same way.
- Route guards never live in `proxy.ts`: a new page is protected by being under `(app)` (or by calling `requireMember()` / `requirePermission()`), and the proxy's public-path list (`core/auth/paths.ts`) grows only for pages that must work without a session.
- `getCurrentMember()` stays the single seam; anything that wants the session asks `core/auth`, never the Supabase client directly.
- 2.1's `attendance_touch()` records the first login of an IST day itself and extends `session_logout()` with `attendance_days.last_logout_at`; 1.3's deactivate transition should also revoke the person's refresh tokens so their next request ends at once rather than on the next page load.
