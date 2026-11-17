---
name: secrets-never-through-session
description: The user enters every secret and env value through the GitHub / dashboard web UI themselves; never use gh to set secrets or ask for values in the terminal
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 97461b53-db4e-4fa5-8c51-8bfcd4be734d
  modified: 2026-09-22T07:05:25.669Z
---

For deploy and environment setup, the user adds every GitHub environment secret and variable
through the GitHub web UI. Don't set them with `gh`, and don't ask the user to paste any value
into the session. Instead: print the exact list of secret and variable names with a one-line
"where it comes from" (dashboard page) and put the same list in the README runbook; build
assuming the values exist, and if a deploy fails on a missing name, say which name.

**Why:** nothing secret should pass through a Claude session (CLAUDE.md rule 10, stated again
explicitly during task 0.5 on 2026-09-22).

**How to apply:** any task touching env vars, Supabase / Cloudflare / Sentry / Resend keys, or
CI environments: names and sources only, never values. See [[maxoff-project]].
