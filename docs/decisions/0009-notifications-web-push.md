# ADR-0009: Mandatory notifications through in-app + Web Push, with email fallback

- **Status:** accepted
- **Date:** 2026-09-20

## Context
Notifications are core to accountability (acknowledgement, reminders, escalations, approvals). Users can't mute them. There's no native app yet, and it must be free.

## Decision
- Every notification is a row in `notifications` (history + deep link) plus queued `notification_deliveries`.
- In-app delivery through Supabase Realtime. Push through standard Web Push (VAPID) and a service worker (PWA). Email through Resend when no working push subscription exists, and always for escalations.
- `NotificationService` with channel adapters, so FCM/APNs or WhatsApp can be added later without changing business code.
- Reminders are materialized as `task_reminders` rows and sent by an idempotent cron job.

## Consequences
- iOS needs the PWA installed to the home screen for push. Onboarding must guide Staff through that.
- Browsers can revoke permission, so the app shows a persistent banner until push works again.
