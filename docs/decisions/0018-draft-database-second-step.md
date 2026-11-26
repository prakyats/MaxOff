# ADR-0018 (DRAFT, not accepted): the database checks the second step

**Status:** draft for the advisor and the owner (v7.5, 26 Nov 2026). The advisor decided that v7.5 checks
two-step sign-in in the app only and that a database check is a follow-up with its own plan and tests.

## Context

v7.5 Q2 (owner 2026-11-26): two-step sign-in is required for the Owner and optional for Admins. As built
(`src/core/auth/second-step.ts`, ARCHITECTURE §6):
- **The app enforces it:** a session that needs the second step and has not passed it (`aal1`) gets nothing
  from `getCurrentMember()`, so every action refuses, and `requireMember()` sends every screen to
  `/second-step`.
- **The database does not.** RLS and the transition functions decide on `auth.uid()` and the member's role
  and permissions, never on the token's `aal`.

So someone with **only** the Owner's password can still sign in to GoTrue directly. They get an `aal1` token,
and with it can read and write through PostgREST and Realtime whatever the Owner's RLS allows: money
included. The app's screens are closed to them; the API is not. The second step then protects the screens,
not the data.

## Proposal

Make `aal2` part of who the database thinks the caller is:

1. `app.current_member()` (and the helpers built on it: `app.has_permission`, `app.is_owner`…) returns no
   member when `app.second_step_required(member)` holds and `auth.jwt() ->> 'aal'` is not `aal2`. Two cases
   require it:
   - the member is the Owner and the environment requires it (a row in `app.local_flags`, or a setting on
     `org_settings`, written by the deploy instead of the Worker's var);
   - `members.second_step` is on.
2. Every policy and function that calls them then refuses an `aal1` session of such a member, because one
   helper decides. The few that read `auth.uid()` directly are found by a catalog query and moved onto
   the helper.
3. **pgTAP:** for every table and every transition function, each role at `aal1` with the second step
   required gets nothing or FORBIDDEN, and at `aal2` gets what PERMISSIONS says. This is the role × table
   matrix of plan §2.2, run twice.
4. **Realtime:** the channel's RLS uses the same helper, so an `aal1` socket hears nothing.

## Consequences

- **The data is protected,** not only the screens.
- **Cost:** every RLS path changes, so it needs a full RLS sweep, two pgTAP passes and a speed check on
  every route. The helper reads one more claim on every call (cheap: `auth.jwt()` is already parsed).
- **Rollout:** the flag moves from the Worker's var (`OWNER_MFA_REQUIRED`) into the database. Staging and
  production must hold the same value as the app, or a session the app admits would be refused by the
  database (and the reverse).
- **Risk:** a mistake locks the Owner out of every table. The recovery is the Supabase dashboard (delete
  the factor; `docs/runbooks/two-step-sign-in.md`), plus a migration to turn the check off.

## Alternatives

- **Keep the check in the app only** (v7.5 as built), and rely on the password, GoTrue's rate limits and
  Cloudflare's sign-in limit. Simpler, but the API is open with a password alone.
- **GoTrue's own enforcement** (an auth hook that refuses `aal1` tokens for chosen users). It refuses every
  `aal1` token for them, including the one `/second-step` needs to show the code step, so it cannot be
  used with the app's flow.
