---
name: note-only-until-proceed
description: "From 2026-10-10 the owner wants requests noted (roadmap) but not built or merged until he says \"proceed\""
metadata:
  node_type: memory
  type: feedback
  originSessionId: 8b868806-9783-4b1b-99ee-1c631b0ca40c
  modified: 2026-10-15T17:29:51.942Z
---

On 2026-10-10 the owner said: "dont make a lot of changes now, just note down them. as i'll let you know when to proceed."

**Why:** v1.6.0 just shipped and he wants to choose when the next batch of work starts, not have fixes trickle in.
**How to apply:** record each new request or improvement (ROADMAP 6b entries via a docs PR, or held in the chat and saved in one docs PR) and stop there. Don't open code PRs, start builders, merge code or prepare releases until he says to proceed. PR #72 (the doubled "Open Open" status fix) is parked as a draft for the next release. Docs-only notes are fine. Related: [[merge-own-docs-prs]].

**Exception set by the owner (2026-10-12):** the cloud routine `trig_01RG32bkSy8HuSdMoy7FfEkD` ("MaxOff 6b projects build", one run on Thu 2026-10-15 07:35 IST, Fable 5.1) is pre-authorised to build ROADMAP 6b.0 (4 shards, first), 6b.2 (Owner tasks) and 6b.11–6b.16 on `phase-6b-projects`, using the advisor's recommendations for the open questions, and to merge to main once it's green. It never tags v* or approves production. It reports on the GitHub issue "Phase 6b build log" (#89).

**Owner 2026-10-15 (permissions):** reordering a staff task's stages = Owner, Admins and the task's creator only; Crew never (replaces "everyone on the task"). Crew never see or touch client work; deliverable stages = Owner + client's Admin. 6b.15 (Admin client control) dropped for good. Live updates (Realtime) moved to a later phase; v1.7.1 fixes data showing on navigation/reload.

**Owner 2026-10-15 23:10 IST (models):** "use only Opus 5.5 to save credits": every routine/session and every subagent on Opus 5.5 (`claude-opus-5-5`); no Fable, no Sonnet, unless the owner says otherwise.

**Owner 2026-10-15 (efficiency):** Release 1 builder ends with an "R1 HANDOFF" comment; Release 2 (v1.7.1) runs in a FRESH session from routine `trig_01H65rgxuLwDBaLXgvYUtuyF` (created disabled; the advisor enables it with run_once_at now+3min after v1.7.0 READY + R1 HANDOFF), max 2 Opus builders at a time. Advisor checks hourly, small. The advisor can't message routine cloud sessions directly: talk via "ADVISOR:" comments on #89, or ask the owner to paste a line into the session.
