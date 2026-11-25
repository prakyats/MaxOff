# v5.0 "Hand in work": the plan

> **Status: PROPOSED (builder, 25 Nov 2026), awaiting the advisor and the Owner.** Nothing here is migrated or shipped until the sample (`docs/design/v50-hand-in-sample.html`) is approved and the open questions (§9) are answered. The parts the owner's decisions already settle (§1) are built on `phase-v50` meanwhile, as migrations and code that stay unreleased until then.
>
> Sources: the owner's decisions of 25 Nov 2026 (#89 7161998756), the v4.5 upload-link spec and decisions (#89 6879421505, 6995973086, 6996718403), the ADR-0010 amendment approved on 25 Nov (#89 7161949171), `docs/handoff/v45-security-review-plan.md`, DATA-MODEL §8a, WORKFLOWS §3 and §5B, PERMISSIONS §1.

## 1. What the owner decided (25 Nov 2026)

1. Crew hand in photos and videos **on a task, inside MaxOff**. The files go **straight into the task's folder in the studio Drive**, browser → Google, with the same resumable mechanism as the v4.5 upload link.
2. **One subfolder per hand-in version** (`v1`, `v2`, …). Originals are never touched, moved or re-encoded.
3. **Reviewers see the file list in MaxOff and open the files in Drive.** No previews or copies in MaxOff.
4. **No copy in MaxOff's storage** (no R2). ADR-0010 is amended the same way as for v4.5.
5. **The approval route is unchanged** (invariants 5 and 6): Mark done → the approving Admin (if any, and not on the task) → the Owner. Only the primary owner (or a freelancer primary's coordinator) marks Done.

## 2. The idea in one paragraph

A task's **hand-in** is the files that go with a Mark done. While the task is open (`todo`, `in_progress`, `changes_requested`) the people on it **add files**; each file goes from their browser straight into `‹task folder›/v‹n›/` in the studio Drive, where `n` is the version the next Mark done will write. **Mark done** hands that version in: `task_submit_done` (unchanged route) writes `task_submissions` version `n` as today and ties the files added for `n` to it. Reviewers see "v2 · 14 files · 5.4 GB" on the task and in Approvals, open each file (or the version's folder) in Drive, and **Approve** or **Request changes** exactly as today. Request changes sends the task back to `changes_requested`; files added from then on go into `v3`, and `v1`/`v2` stay as they were.

## 3. How a hand-in version ties to `task_submit_done`'s version

- `task_submissions.version` already exists (kickoff 4, built 4A): every Done writes `max(version) + 1`. v5.0 **keeps that numbering**; it does not add a second counter.
- **The open version** of a task is `coalesce(max(task_submissions.version), 0) + 1`, worked out inside each function under the task's row lock (`app.task_lock`). Files added while the task is open carry `version = the open version` and `submission_id = null`.
- **Mark done** (`task_submit_done`, re-created with the same signature and grants, every path: to `submitted`, to `admin_approved`, and the Owner primary's straight `completed`):
  1. refuses while a file of the open version is still uploading: `INVALID_STATE` with `meta.code = 'handin_uploading'` ("2 files are still uploading. Wait for them, or leave them out."). Failed files never block (they are not in Drive);
  2. writes the `task_submissions` row as today (version `n`, note, late reason);
  3. sets `submission_id` on every `done` file of version `n` (left-out files keep `submission_id` null and stay recorded);
  4. its `submitted` / `completed` history row gains `meta.files` and `meta.bytes`.
- After Mark done the task is locked (`submitted` onwards, WORKFLOWS §3.1), so **no file can be added** until it comes back (`changes_requested`, or a reopen to `in_progress`), and the open version is then `n + 1`. So a version's folder never changes after it is handed in.
- The note stays: a Mark done with **no files** still works (Q2), with the note (links included) as today. The v4.5 upload link (`upload_files`) is a separate path and is not part of a hand-in version.
- `task_reviews.submission_id` already points at the latest submission, so a review is tied to a version with no change.
- **Cancel** with files added and not handed in: the files stay in Drive and in MaxOff as "added, never handed in" (shown under the task's hand-in, never deleted). **Reopen** after completion opens version `n + 1`.

## 4. DATA-MODEL delta (expand-only; new tables, two re-created functions, no rename or drop)

```
handin_files         v5.0. id, org_id, task_id → tasks, version int (≥ 1: the open version when the
                     file was added), submission_id null → task_submissions (set by task_submit_done
                     when version is handed in), added_by → members (the actor), on_behalf_of null →
                     members (a freelancer assignee, ADR-0013), name (cleaned, ≤ 255, no / or \),
                     relative_path ('' on a phone; a laptop's folders under v‹n›, '/'-joined, depth
                     ≤ 8 (the shared rule), each part ≤ 120), size_bytes bigint ≥ 0, mime_hint null (≤ 100),
                     state ('uploading' | 'done' | 'failed' | 'left_out' | 'missing_in_drive'),
                     failed_reason null ('damaged' | 'size_mismatch' | 'wrong_folder' | 'gave_up' |
                     'unreadable'), account_sub, drive_parent_id null, drive_file_id null (unique),
                     session_uri_encrypted null (AES-GCM, like the Drive tokens), session_opened_at
                     null, bytes_at_google bigint (0), bytes_reported bigint (0), last_moved_at null,
                     md5_page null, md5_drive null, check_kind null ('md5' | 'size_only'), done_at
                     null, left_out_at null, left_out_by null → members, drive_checked_at null,
                     missing_seen_at null, created_at, updated_at
                     -- checks as upload_files (§8a): done ⇒ drive_file_id, done_at, check_kind;
                     -- left_out ⇒ left_out_at/by and (drive_file_id or a failed/never-finished file);
                     -- submission_id set ⇒ state in (done, missing_in_drive)
                     -- missing_in_drive is the service role's only (the Drive check, §8a), never a member's
                     -- "already added": a done row of the same task, version, relative_path, name and
                     -- size (any adder), so two people adding the same clip get one copy
handin_folders       v5.0. id, org_id, task_id → tasks, version int, account_sub, relative_path
                     ('' = the v‹n› folder itself), drive_folder_id, created_at
                     -- unique (task_id, account_sub, version, relative_path); ≤ 2,000 per version
```

- **RLS on both, no policy, every API privilege revoked from `anon` and `authenticated`** (the v4.0/v4.5 pattern: session addresses sit in these rows). Members read through security-definer functions; the Worker writes as `service_role`.
- **No audit trigger** (it would copy session addresses into `activity_log`). The functions write safe history rows, entity `handin_files`, `meta.task_id`: `added` (name, path, size, version, check_kind, Drive id; the History tab groups them: "Ravi added 14 files to v2"), `left_out` (who, name, version), `missing_in_drive`, `back_in_drive` (as §8a).
- **The folder:** `drive_folders`' task folder (v4.0, `Clients/‹client›/‹YYYY-MM›/‹task›`, `Internal/…` without a client), then `v‹n›`, then the laptop's own folders. v4.5's uploader folders sit beside it, so **v4.5's folder-name picker treats a name like `v3` as taken** ("v3 (2)"): a one-line change to `upload_register` when v4.5 is built (told to the v4.5 builder).
- **Limits (safety, not product caps; Q4):** any type, any size; ≤ 6 files uploading at once per person per task; ≤ 2,000 files per version; the v4.5 space guard (a file larger than free space − 10 GB − bytes in flight is refused with "The studio's Drive is nearly full", and the Owner is told once a day); Google's daily upload limit pauses and carries on by itself (as §5B.6).
- **Member functions** (security definer, `search_path` '', `authenticated` + `service_role`; NOT_FOUND when the caller can't see the task, FORBIDDEN when they see it but may not act, UNAUTHENTICATED for a non-member):
  - `handin_versions(task_id)` → per version (handed in or open): number, state (`open` | `handed_in`), submitted at/by, file count and bytes, and its files (name, path, size, state, added by / for, done_at, left_out at/by, check_kind, the risky-type flag worked out from the name). **`drive_file_id` and the version folder's id only for the Owner and the task's Admins** (Q6); null for everyone else. Readable by anyone who sees the task (`app.task_visible`).
  - `handin_file_start(task_id, name, relative_path, size_bytes, mime_hint, on_behalf_of)` → `('already_added', file_id) | ('start', file_id, version, folder steps) | ('wait', seconds) | ('space_full')`. The actor rule is `app.task_actor` (an active permanent assignee with `tasks.work`, or a freelancer assignee's current coordinator acting for them; Q1); the task open and not archived; Drive `connected`. Then the Worker (service role) makes the folders (`handin_folder_put`), opens the Google session with the fixed name, parent, size and a description linking to the task, and records it (`handin_session_set`); the browser gets only the session address.
  - `handin_progress(file_id, bytes)` (the adder's own uploading file; at most one per file per 5 s; sent through a route handler, ARCHITECTURE §4.4) and `handin_file_failed(file_id, reason)`.
  - `handin_file_left_out(file_id)` (Q3): the open version only; the adder or the primary owner (or a freelancer primary's coordinator); the file stays in Drive and in the list as "Left out". A failed or still-uploading file can be left out too (an uploading one's session is abandoned).
- **Service-role functions:** `handin_folder_put`, `handin_session_set`, `handin_file_done(file_id, drive_file_id, size, md5_drive, parent_id, md5_page)` (called by the Worker after it asked Google itself, the v4.5 F1 rule: size or parent wrong → failed; MD5 mismatch → failed `damaged`; otherwise done; idempotent), `handin_watch_due`, `handin_record_offset`, and the "Removed in Drive" check sharing §8a's claim / daily pass / seen functions' shape (`handin_drive_check_claim`, `handin_drive_seen`; the daily pass in the existing `drive_space_check` run covers hand-in files of tasks touched in the last 30 days).
- **Re-created with the same signature and grants:** `task_submit_done` (§3). Nothing else changes in the task functions; `task_review` is untouched.
- **New notification kind:** `handin_space_held` (the Owner; actionable, email only as the fallback, like `drive_*`). Changed wording only: `task_submitted` / `task_admin_approved` / `task_completed` bodies gain "· 14 files" when the version has files (WORKFLOWS §9).
- **Money is untouched** (no amount anywhere); **Realtime is unchanged** (no hand-in table joins the publication; the card re-reads while a file is uploading, the v4.5 §10a exception).
- **Supersedes the unbuilt `submission_items`** design (DATA-MODEL §6, R2 uploads ≤ 25/100 MB, previews, retention, `drive_link` items): never migrated, now replaced by `handin_files` (ADR-0010 amendment, §7). Link submissions (8.4a/b) moved after launch with v5.5 (owner 25 Nov); a link in the note still works.

## 5. WORKFLOWS delta

New **§5C Hand in work (v5.0)**, and a line in §3.1 / §3.3:

- **Who adds files (Q1):** every person on the task: an active assignee (Crew, an Admin, the Owner on the Owner's own task), or a freelancer assignee's current coordinator for them. **Only the primary owner marks Done** (invariant 6), which hands the version in.
- **When:** while the task is `todo`, `in_progress` or `changes_requested`, and the studio Drive is connected. When it isn't, Add files is replaced by "Handing in files is off until the Owner reconnects Google Drive", and Mark done with a note still works.
- **How:** on a phone, photos and videos from the gallery or files; on a laptop, files or whole folders (drag and drop), the folder structure kept under `v‹n›`. A few files at a time, chunked and resumable; a lost network resumes by itself; leaving the page warns; coming back offers "Choose the files again: the ones already added are skipped" (name + size + path). Uploads keep going while the person moves around MaxOff in the same tab (a small progress pill), and stop only when the tab is closed.
- **Mark done** waits for files still uploading (§3), shows "v2 · 14 files · 5.4 GB" above the note, and keeps the late reason rule.
- **Reviewers** (the approving Admin at the Admin step, the Owner at the final step) see on the task page and in the Approvals sheet: the version, who handed it in and when, the note, and the file list; **Open in Drive** per file and **Open the v2 folder** (Q6). Earlier versions are listed below, collapsed, with the reason each was sent back.
- **Request changes** (unchanged function, a reason required): the reason shows above the next version for the primary owner; new files go into the next version's folder. Nothing in an earlier version moves (Q5: the reason names the files).
- **Removed in Drive:** a handed-in file deleted in the studio's Drive shows "Removed in Drive" (grey chip), found the v4.5 way (a metadata read when a reviewer opens the version, at most every 10 minutes per file, never on the page's first render; the daily pass). MaxOff never deletes, moves or trashes a hand-in file.
- **Notifications (§9):** the existing ones, with the file count; `handin_space_held` to the Owner. Nobody is notified per file.

## 6. PERMISSIONS delta

No new permission key: adding files is `tasks.work` with the task's actor rule; reviewing is the existing `tasks.approve_admin` / `tasks.approve_final`.

| Who | See the hand-in list (names, sizes, states) | Open in Drive (file and folder links) | Add files | Leave out | Mark done (hand in) |
|---|---|---|---|---|---|
| Owner | every task | every task | on a task they're on | own files; any as the primary | as the primary owner |
| The task's Admin (its creator with `tasks.create`, its approving Admin with `tasks.approve_admin`, the Admin who coordinates a freelancer primary: v4.5's three, `app.upload_manager`) | ✅ | ✅ (Q6) | if on the task (or coordinating a freelancer assignee) | own files; any as the primary / their freelancer primary's coordinator | as today |
| Another Admin who sees the task (an assignee, the client's Admin through its label) | ✅ | ❌ (names only) | if on the task | own files | as today |
| Crew on the task (assignee, primary, a Crew coordinator) | ✅ | ❌ never (Crew never get studio Drive access, ADR-0010) | ✅ | own files; any as the primary | the primary only |
| Crew not on the task / an Admin who can't see it | `NOT_FOUND` | `NOT_FOUND` | `NOT_FOUND` | `NOT_FOUND` | — |
| A freelancer | no login (ADR-0013); their coordinator adds and hands in for them | — | — | — | — |
| `anon` | no EXECUTE | no EXECUTE | no EXECUTE | no EXECUTE | — |

- pgTAP for each row: allowed and denied, per function, plus the tables' direct-access denial for every role, and `drive_file_id` null in `handin_versions` for every non-reviewer row.
- Invariant 4 holds: the list shows file names only; nothing about the client beyond what the task already shows.

## 7. ADR-0010 amendment (to write, proposed, for the Owner's approval)

"Amendment 2026-11-25: task hand-ins (v5.0)": the R2 submission path (≤ 25/100 MB uploads, previews, 90/30-day retention, `archive_state`) is **replaced** for task hand-ins by the v4.5 mechanism: browser → studio Drive resumable session opened by the Worker on `drive.file`, no R2 copy, no previews, the Drive file is the original and the archive. Folder `‹task folder›/v‹n›/…`, the person's own file names kept. MaxOff never deletes, moves or trashes a hand-in file; "Removed in Drive" as v4.5. The pasted-link path moves after launch (v5.5, owner 25 Nov). The same E0 gate (a browser can resume a handed session across origins) covers v5.0.

**Code placement (part of the amendment, not a new ADR):** the Google half (open a resumable session with a fixed name/parent/size, ask Google for a finished file's size, parent and MD5, the folder steps) goes in `core/drive` beside v4.0, and the browser half (chunked PUT to a session address, resume after `308`, a few files in parallel, per-file MD5, wake lock, the "keep this page open" guard) in a new `core/upload` with no database access. **v4.5's page and v5.0's hand-in both use them**: whichever is built first writes them (builder recommends v5.0 writes them now, since v4.5 is paused at its E0 step 2, and the v4.5 builder reuses them). The hand-in's own rules, data, actions and screens are a new module, `modules/handin`, which the task page imports (client components one file at a time, ADR-0011 amendment).

## 8. Screens (the sample shows each)

1. **Crew, phone, task page (Work view):** a **Hand-in** card: "v2 · not handed in yet", files with progress, **Add photos and videos** (outline), and the existing sticky **Mark done** (neutral solid). After a send-back: the reason above v2.
2. **Crew, adding:** the system picker, then the list: per file Waiting / Uploading (blue) / In Drive (green) / Failed (red, Retry) / Already added (grey); the overall "8 of 12 · 3.1 of 5.4 GB · about 6 min left"; the keep-open band; a network-lost state; Leave out in each row's ⋯.
3. **Crew, laptop:** the same card wider, with a drop zone for files and folders, folders kept.
4. **Mark done with files:** the dialog shows "v2 · 14 files · 5.4 GB"; while files upload, "2 files still uploading" and Mark done waits.
5. **Reviewer, laptop and phone:** the task page's Hand-in card at `submitted` / `admin_approved`: v2 (open), Open the v2 folder in Drive ↗, each file with Open in Drive ↗, risky-type chip, Removed in Drive chip; v1 collapsed with its send-back reason; the existing Approve (green) and Request changes.
6. **Request changes and v3:** the existing sheet with a hint ("Name the files that need changes"); the Crew's view after: the reason, v3 open.
7. **Approvals:** the row says "v2 · 14 files".
8. **Notifications:** the changed bodies and the Owner's space note.

## 9. Open questions (recommendation first)

1. **Who adds files to a version?** **Rec: everyone on the task** (a second shooter adds their clips), and only the primary owner marks Done, which hands the version in. *Alt:* only the primary owner adds files.
2. **Does Mark done need files?** **Rec: no.** Files are optional; a task with nothing to hand in (a meeting, a call) marks Done with a note as today. *Alt:* a task-type setting "needs a hand-in" that blocks Mark done without files.
3. **A wrong file added before handing in.** **Rec: Leave out**: the person who added it (or the primary owner) taps Leave out before Mark done; it stays in the Drive folder (MaxOff never deletes), shows as "Left out" under the version (collapsed), and isn't counted. Someone with the studio Drive can delete it there. *Alt:* no Leave out; reviewers see every file added.
4. **File types.** **Rec: any file, any size** (a PDF, a project file, a RAW photo), like the upload link, with the grey "Check before opening" chip on risky types. *Alt:* photos and videos only.
5. **Request changes on particular files.** **Rec: the reason only, as today** (the reviewer names the files in it). *Alt:* tick the files that need changes (more screens, later).
6. **Who opens hand-in files in Drive.** **Rec: the Owner and the task's Admins** (the same three people as v4.5's Q1; they use the studio Drive account). Other Admins and Crew see names and sizes only; Crew never get a Drive link. *Alt:* any Admin who sees the task.

## 10. Build order on `phase-v50` (based on `phase-v45`, rebased as it moves)

1. Docs: this plan; DATA-MODEL §8b, WORKFLOWS §5C, PERMISSIONS rows, ADR-0010 amendment (proposed).
2. Domain (`modules/handin/domain`): open version, name and path cleaning (shared with v4.5's rules), risky types, folder naming, "already added", Mark done's wait rule, summary text; unit tests.
3. Migration `handin_files` (tables, RLS, functions, `task_submit_done` re-created), pgTAP per role and per path.
4. `core/drive` resumable session + verify; `core/upload` browser engine; unit tests against a fake Google.
5. Actions and route handlers; the Hand-in card, add sheet, Mark done change, reviewer view, Approvals line; loading skeletons; Playwright (flows + installed-mode back at 375/430); guide topics and screenshots.
6. Review, speed probe on the task page and Approvals for each role, READY.

Steps 1–4 go ahead now; step 5's screens wait for the sample's approval; nothing is released before v4.5.
