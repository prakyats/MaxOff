---
name: advisor-local-builders-cloud
description: Prishit runs the MaxOff advisor session locally on his laptop and the builder sessions in the cloud; a full handoff file exists
metadata:
  node_type: memory
  type: feedback
  originSessionId: 32c30ced-e55d-4ca9-a13b-95a331bea045
  modified: 2026-10-09T11:33:59.088Z
---

Prishit decided (2026-10-07): the **advisor** (architect/reviewer, writes "Send this" prompts for builders) runs as a **local** Claude Code session in `C:\Users\ASUS\Desktop\MaxOff`; **builders** (kickoffs, `/run-phase`, fixes) run as **cloud** sessions on Opus 5.5 High.

**Why:** locally the advisor can use `gh`, download CI blob reports and read Playwright traces (cloud network blocks the artifact host), run the smoke test, delete branches on his word, build PDFs with Edge, and gets these memory files automatically. Cloud builders run for hours without the laptop and spare its memory during e2e.

**How to apply:** at the start of a new advisor session, expect him to paste `MaxOff-Advisor-Handoff.md` (up to v1.4.0) and **`C:\Users\ASUS\MaxOff/docs/handoff\MaxOff-Advisor-Handoff-2026-10-09.md`** (latest: v1.6.0 live, phase 6b next, starting with 6b.0 four shards and /kickoff-phase 6b; the 2026-10-08 one is older). Verify builder reports against GitHub yourself.

**Channel (since 2026-10-07):** advisor → builder by `SendMessage` to the cloud session (one-way); builder → advisor by comments on a GitHub "build log" issue (phase 6: issue #49, REPORT / BLOCKED / REPLY / QUESTION FOR OWNER). Cloud transcripts can't be read from the laptop. A new builder session needs the owner's own instruction that advisor messages count as his for day-to-day work. A CronCreate watch every 30 min drives it while he's away. See [[merge-own-docs-prs]], [[launch-deadline-nov-2026]] and [[production-is-live]].

**Owner, 22 Oct 2026:** every MaxOff handoff and related file lives in the MaxOff folder, `docs/handoff/` (index: its README), committed to the repo. Never write them to Downloads or anywhere else. New handoffs: add the file there + a README row, via a docs PR.
