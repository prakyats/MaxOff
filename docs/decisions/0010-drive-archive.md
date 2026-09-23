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
