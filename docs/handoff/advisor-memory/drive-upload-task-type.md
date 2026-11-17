---
name: drive-upload-task-type
description: "Owner's \"Drive upload\" task type request (4 Nov 2026): Crew pastes a cameraman's Drive link + folder name, MaxOff copies it into the company Drive; decisions so far"
metadata:
  node_type: memory
  type: project
  originSessionId: ea770483-9990-482d-8bc8-b4cbf9e4045e
  modified: 2026-11-04T17:24:52.132Z
---

Owner request, 4 Nov 2026: a task type **"Drive upload"**. The assigned Crew member pastes the cameraman's Drive link and names a folder. MaxOff copies the contents (server-side `files.copy`, walking subfolders) into the company Drive. It builds on ROADMAP 8.3 (company Google account connect + `drive_jobs` queue) and ADR-0010.

Owner decisions so far:
- **The task completes itself** once MaxOff verifies that every file and folder was copied: file count, size and checksums.
- **After the transfer, the Admin sees the company-Drive folder link**, so they can open it and check. Crew never get company Drive access.
- **Folder placement in the company Drive:** the owner tells us later.
- **Every other question** (multiple links per task, suggested folder names, quota warnings, cameraman upload page) waits for the kickoff, where the owner answers in detail.

**Why:** collecting footage links from cameramen and re-uploading them by hand is a recurring Crew chore.

**How to apply:** add it to ROADMAP after the v1.9 merge (note only, see [[note-only-until-proceed]]). Before building: kickoff, then a sample ([[samples-before-major-ui]]). Keep task types as data, plus a capability flag ([[every-client-is-different]]).

**UPDATED 14 Nov 2026, superseding the copy-first idea:**
- The main path is a **per-task private upload link**: freelancer → studio Drive directly, one transfer, files owned by the studio Gmail via a `drive.file` resumable session. The studio Drive is a personal Gmail with 2 TB, not Workspace.
- **"Paste a Drive link → copy"** stays as the fallback; it needs Google verification or a weekly reconnect.
- **Requirements:** a Drive-like progress page for uploaders; the Admin's live view with a 15-min stuck alert.
- **Scenario answers:** the link lives until the task is done; one link per task, uploaders type their name; "I'm done" then the Admin is notified; auto-resume; anything, any size; folders kept on a laptop.
- Full spec: #89 comment 6879421505. A sample comes before the build. Order: phase 9 → phase 8 → v2.1.
- Unassigned uploaders on a task link: allowed + flagged, Admin notified once (#89 follow-up to 6879421505).
- 'I'm done' optional; 'uploads look finished' signal; Admin 'All files received' closes the link and marks Done when the Admin is the freelancer's coordinator; Crew are nudged (invariant 6 kept).
