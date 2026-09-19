# ADR-0003: Free-tier hosting and storage that can be upgraded

- **Status:** accepted
- **Date:** 2026-09-19

## Context
The MVP should cost ₹0 per month, but it's used commercially and stores large brand files (videos). Vercel's free Hobby plan is for non-commercial use only. Supabase's free storage is 1 GB and it charges for downloads beyond the free allowance.

## Decision
- **Hosting:** Cloudflare Workers through the OpenNext adapter (the free plan allows commercial use).
- **Files:** Cloudflare R2 (10 GB free, no download fees) behind a `StorageAdapter` interface in `core/storage`. It's S3-compatible.
- **Database / Auth:** Supabase free tier. Nightly pg_dump backups to R2 through GitHub Actions, because the free tier has no dependable backups.
- **Email:** Resend as Supabase Auth's SMTP. **Monitoring:** Sentry + UptimeRobot free tiers.

## Consequences
- Moving to paid tiers (Supabase Pro, Workers Paid, S3) only changes configuration or one adapter.
- OpenNext on Workers has some differences from Vercel. If a Next.js feature doesn't work there, this ADR is revisited.
- A Supabase free project pauses after 7 days with no activity. Daily use prevents this.
