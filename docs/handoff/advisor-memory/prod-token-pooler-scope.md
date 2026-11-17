---
name: prod-token-pooler-scope
description: Production deploy's Supabase access token must include the pooler-config capability, else migrations fail with "IPv6 is not supported"
metadata:
  type: reference
---

The deploy.yml production job runs `supabase link` then `migration list/up --linked`. With a scoped Supabase access token that lacks the pooler-config endpoint (`/v1/projects/{ref}/config/database/pooler`), link "finishes" but the CLI falls back to the IPv6 direct host and fails on GitHub runners: "IPv6 is not supported on your current network" (24 Oct 2026, v1.8.0; nothing was applied). Fixed by the owner creating a production token with the same capabilities as the working staging token, then re-running failed jobs.

**How to apply:** if a staging/production migration step fails with that message, check the token's capabilities first (owner updates `SUPABASE_ACCESS_TOKEN` in the GitHub environment; never through chat). See [[secrets-never-through-session]], [[production-is-live]].
