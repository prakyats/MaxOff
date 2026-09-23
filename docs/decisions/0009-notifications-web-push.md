# ADR-0009: Mandatory notifications through in-app + Web Push, with email fallback

- **Status:** accepted
- **Date:** 2026-09-20

## Context
Notifications are core to accountability (acknowledgement, reminders, escalations, approvals). Users can't mute them. There's no native app yet, and it must be free.

## Decision
- Every notification is a row in `notifications` (history + deep link) plus queued `notification_deliveries`.
- In-app delivery through Supabase Realtime. Push through standard Web Push (VAPID) and a service worker (PWA). Email through Resend when no working push subscription exists, and always for escalations.
- `NotificationService` with channel adapters, so FCM/APNs or WhatsApp can be added later without changing business code.
- **Dispatch runs in the app, not in Postgres:** Web Push needs VAPID JWT signing, which `pg_net` can't do. A Cloudflare **Cron Trigger** calls `/api/cron/push-dispatch` (protected by `CRON_SECRET`, service role), which drains the delivery queue. The same mechanism runs `/api/cron/drive-archive`. Database-only jobs stay in `pg_cron`.
- **Email is fallback only** (invites, escalations, the Owner digest, and recipients with no working push), with a per-person daily cap (`org_settings.email_daily_cap_per_member`, default 20; invites and escalations bypass it, amended 2026-09-21), because the free email allowance is 3,000/month and 100/day.
- **Escalation levels:** acknowledgement escalates to the approving Admin (or creator) after `ack_escalate_hours` and to the Owner after `ack_escalate_owner_hours`; a task with nothing submitted `overdue_escalate_hours` past its deadline escalates to both at once.
- Reminders are materialized as `task_reminders` rows and sent by an idempotent cron job.

- **Delivery is never assumed** (amended 2026-09-21). Push subscriptions **survive logout** and carry **title-only** payloads while logged out (removed on "sign out of this device" or deactivation); a `member_reachability` view tells management who can't be reached and why; anyone can send themselves a **test notification**; and email is a genuine second channel for a small set of kinds (assigned, escalation, invite, event tomorrow, Owner digest), not only a fallback.

## Consequences
- iOS needs the PWA installed to the home screen for push. Onboarding must guide Staff through that, and `ios_not_installed` is reported as unreachable until it's done.
- Browsers can revoke permission, so the app shows a persistent banner until push works again.
- The product's real guarantee is **accountability, not delivery**: explicit acknowledgement, automatic escalation and visible reachability, since no platform can promise a phone will buzz.
