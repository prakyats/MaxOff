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
- **Email is fallback only** (invites, escalations, the CEO digest, and recipients with no working push), with a per-person daily cap, because the free email allowance is 3,000/month and 100/day.
- Reminders are materialized as `task_reminders` rows and sent by an idempotent cron job.

## Consequences
- iOS needs the PWA installed to the home screen for push. Onboarding must guide Staff through that.
- Browsers can revoke permission, so the app shows a persistent banner until push works again.
