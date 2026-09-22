# ADR-0003: Free-tier hosting and storage that can be upgraded

- **Status:** accepted, amended 2026-09-20 (push notifications use Web Push, ADR-0009) and 2026-09-21: uploads are capped at 25 MB for images and 100 MB for video, with larger files submitted as Drive links and everything archived to Google Drive (ADR-0010). Production runs on **Workers Paid ($5/mo) from the pilot (task 6.6)**, because the free plan's 10 ms CPU per request is too low for server-rendered pages; the free plan is fine for building and staging. Verified free-tier limits (Sep 2026): Workers free 100k requests/day and 10 ms CPU; R2 10 GB, 1M writes, 10M reads, no egress charge; Supabase free 500 MB database, 5 GB transfer, no backups, paused after 7 idle days; Resend 3,000 emails/month and 100/day. Amended 2026-09-22 (task 0.5): Cloudflare's guide now defaults new projects to **vinext** (Next.js re-implemented on Vite); it was considered and rejected because it would invalidate the 0.1–0.4 toolchain decisions (Turbopack, `next/font`, the lint and test setup). **OpenNext stays**; it supports every Next 16 minor, Turbopack builds included. The OpenNext bundling step does not run on Windows with pnpm (junction folders are unreadable), so Worker builds happen in CI and in the deploy workflow on Ubuntu, and `pnpm preview` needs WSL locally.
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
