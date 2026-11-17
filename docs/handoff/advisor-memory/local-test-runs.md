---
name: local-test-runs
description: "How to run pnpm check and Playwright locally on the owner's 16 GB Windows machine (Studio off, never chained, 2 workers, memory stops)"
metadata:
  node_type: memory
  type: feedback
  originSessionId: 3954a8a2-e475-4123-bf8b-acf7dad894e7
  modified: 2026-10-07T08:14:50.763Z
---

Local verification runs, as the owner set them (repeated across 2026-09-28..30):
- `docker stop supabase_studio_maxoff` before test runs; `docker start` it again at the very end.
- `pnpm db:reset` before Playwright.
- `pnpm check` on its own, then e2e on its own: never chained, never anything else in parallel with an e2e run.
- Playwright with `--workers=2`.
- If memory stops a run: tell the owner before retrying. A rerun may use `--workers=1`, but only after telling them.
- Never make a test pass by a retry, a longer timeout, a skip or a weaker assertion; find the gate, prove it (a deterministic repro beats a CPU throttle), fix the real cause in the app when it is an app bug.
- One CI check when it is likely done (no polling loops); report per job. Merges follow [[merge-own-docs-prs]] (Claude merges once a PR's bar is met).

**Why:** the machine has 15.6 GB; Docker's WSL VM, Next and two Chromium workers already take most of it, and a run killed by memory once produced 466 bogus failures.
**How to apply:** every time a task ends in `pnpm check` / e2e / a PR. Related: [[shell-path-gh-docker]].
