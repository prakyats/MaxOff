# ADR-0010: Google Drive is the permanent archive; MaxOff keeps a short-lived working copy

- **Status:** accepted, amended 2026-09-21 (submissions only; previews kept after retention)
- **Date:** 2026-09-21

## Context
Pixora already keeps final files in Google Drive and has a 2 TB Google One plan on a personal account (no Workspace). Staff must **not** get access to that Drive, but their submitted work must survive them deleting their own copies or leaving. Videos are large, photos are small and must stay at full quality, and the team is on a mix of iPhone, Android, Mac and Windows.

## Decision
- **Two submission paths.** Files up to **25 MB (images)** and **100 MB (video)** are uploaded into MaxOff (R2). Anything larger is submitted as a **Google Drive link** from the person's own Drive.
- **Everything is archived to one company Google account.** Uploads are pushed to Drive from the server. Pasted links are duplicated with Google's server-side `files.copy`, so the bytes never pass through MaxOff and the company owns the copy.
- **MaxOff creates the folder structure and file names** (`Clients/<Client>/<YYYY-MM>/Photos|Videos/`, `YYYY-MM-DD_<task>_v<n>_<Name>_<nn>.<ext>`), and each Drive file's description links back to its task. The submitter fills in nothing.
- **Originals are never re-encoded.** Photos get a separate small JPEG preview (also solving HEIC display on Windows and Android).
- **Only submissions are archived.** Drive jobs are queued by `task_submit_version`, never by the generic upload completion, so logos, avatars and previews stay out of Drive.
- **Retention:** local **originals** are deleted after 90 days (photos) or 30 days (video), and only once the Drive copy is confirmed. Previews are kept. The Drive archive and all metadata are permanent.
- **A private or unreachable link** is flagged and the submitter is asked to fix sharing. It never blocks approval, and MaxOff re-checks and archives by itself once access is granted.
- Connecting or reconnecting the Google account is Owner-only. Tokens are encrypted at rest and never reach the browser.

## Consequences
- Storage stays inside R2's free 10 GB, and the long-term archive costs nothing extra because the Google One plan already exists.
- It depends on a personal Google account, so the connection will occasionally expire. The queue and the "Reconnect" banner make that a visible, recoverable event rather than silent data loss.
- Copying requires the file to be readable, so link hygiene is part of the workflow.
- Moving to Google Workspace later means switching to a shared drive, which changes `core/drive` only.

## Amendment 2026-11-19: the upload link (v4.5), PROPOSED, awaiting the Owner's approval

The Owner approved the v4.5 upload-link screens on 19 Nov 2026 (`docs/design/v45-upload-link-sample.html` at 86a5e04; decisions on #89: 6879421505, 6879494745, 6879555186 and the sample's Q1–Q13). Three of them differ from the decision above, so this amendment records them. The two submission paths above are unchanged; the upload link is a **third path**, for files people outside the studio (or the Crew in the field) send for one task.

- **The bytes go straight from the uploader's browser to the studio's Google Drive.** The Worker opens a Google resumable upload session on the connected account (`drive.file`), into the task's folder, and hands the browser only that session's address. There is **no R2 copy**, so the 25 MB / 100 MB limits, the 90/30-day retention and "archived only once the Drive copy is confirmed" don't apply to this path: the Drive file *is* the archive copy. No size or type cap, beyond the safety limits in `docs/handoff/v45-security-review-plan.md` (C, D).
- **The uploader's own file and folder names are kept** under `<task folder>/<uploader name>/…`, instead of MaxOff naming each file. The task folder still comes from MaxOff (`Clients/<client>/<YYYY-MM>/<task>`, v4.0, folders made on first use). Each file's history in MaxOff records who sent it, when, its size and its Drive id.
- **Nothing is re-encoded and no preview is made** for this path in v4.5. The Admin opens the files in Drive (Q6: the Admins already use the studio's Drive account).
- Unchanged: the account and its connection are the Owner's (v4.0); tokens never reach the browser; Crew never get Drive access through MaxOff; a removed file goes to the Drive bin with a reason, and its row stays in the history (Q7, invariant 9).

**Gate before the upload unit is built:** a browser on the preview origin must be able to resume a session it was handed (Google's 308 answers must expose `Range` across origins). The preflight half passed on 19 Nov (plan, "Pass 1 log"); the session half needs the staging Google connection. If it fails, the advisor is told before any other design is considered.

**Consequences:** the archive grows with every upload link, not only with approved submissions, so the v4.0 space alerts (80 %, 90 %) matter more. A link is a bearer credential; how it is made, scoped, limited and stopped is in the security review plan.
