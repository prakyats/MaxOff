# ADR-0011: Web first, native ready

- **Status:** accepted
- **Date:** 2026-09-21

## Context
MaxOff ships as an installable web app (PWA). A native iOS and Android app is a real possibility later, but building one now would double the work for no pilot value. The question is which seams to keep so that a later native app reuses the backend instead of forcing a rewrite.

## Decision
**Build for the web now, and keep every rule outside the web layer.**

Already true and deliberately kept:
- **Business rules live in Postgres** transition functions (ADR-0006), so any client — web, native, a script — gets the same checks, states, audit and notifications.
- **Authorization lives in RLS** (ADR-0004), so a badly written mobile screen still can't read what it shouldn't.
- **Supabase Auth** has native SDKs; accounts and sessions carry over.
- **`core/notifications`** has channel adapters (ADR-0009); FCM and APNs become new adapters, and `push_subscriptions` already stores `platform`, `label` and a token/endpoint.
- **`core/storage`** issues presigned uploads that work the same from a phone.

Added by this ADR:
1. **Server actions stay thin.** They validate (zod), authorize, call a repository or RPC, revalidate and return a `Result`. **No business logic in an action**, so a future mobile API is a thin wrapper over the same repositories.
2. **`modules/*/domain` is platform-free.** It must not import `react`, `react-dom`, `next/*`, `server-only` or any DOM API. Enforced by lint (task 0.4).
3. **Session and role decisions go through `core/auth`** functions, never inline in a layout or page, so another client can ask the same questions.
4. **Device records stay generic** (platform, token/endpoint, label, state) rather than assuming Web Push.

Not done now: no React Native code, no separate API surface, no shared UI abstraction layer.

## The paths this keeps open
| Option | Effort | What it adds |
|---|---|---|
| PWA (current) | done | Home-screen install on both platforms, push (iOS 16.4+ when installed) |
| Native shell (Capacitor) around the same app | ~2–4 weeks | App Store and Play Store presence, native push (more reliable on iOS), camera and file access |
| React Native / Expo app | ~2–3 months | Native feel, real offline mode, background upload. Backend, rules and `domain/` unchanged; the UI is rebuilt |

Decide after the pilot, based on whether staff need offline work at shoots and whether iOS push proves reliable enough.

## Consequences
- The database keeps being the place where behaviour is defined, which is already the house rule.
- The lint rule makes `domain/` portable permanently, instead of relying on memory.
- If a native app is built, roughly the backend, rules, permissions, notifications and domain logic carry over; the UI layer does not.
- A mobile API (route handlers or direct RPC) would be added then, not now.
