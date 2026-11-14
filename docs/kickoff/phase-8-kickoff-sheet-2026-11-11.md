# Phase 8 kickoff decision sheet: Work submissions, files and the Drive archive

Read-only run; nothing was written, committed or pushed. Branch stayed on `main`.

## Read this first (for the advisor, not the owner)

Phase 8 already has three sets of open questions, none recorded on `main`. This sheet does not repeat them; it points at them and adds only what they miss.

| Set | Where | Status |
|---|---|---|
| **Draft-14**: 14 answers the owner gave on 2026-10-01 | branch `origin/kickoff-8` (PR #36), never merged | Answered, not on `main`; predates v1.6 to v1.9 |
| **Oct-11**: Q1 to Q11, advisor 2026-10-22 | `C:/Users/ASUS/Desktop/MaxOff/docs/kickoff/phase-8-questions.md` (on `main`) | Unanswered |
| **Drive-20**: 20 kickoff questions + 5 business questions, 2026-11-11 | `git show origin/docs/v2-release-drafts:docs/handoff/next-release-drive-upload-plan.md` | Unanswered |

`main`'s PROGRESS.md "Current state" stops at 3 Nov (v1.9 paused); v1.9.0 live and the v2.0 plan are only in ROADMAP. No "Kickoff 8 decisions" block exists on `main`.

---

# PART 1. The owner's sheet

**How to answer:** tick one option per question. The first option is the one we recommend. "Crew" means the third role.

## A. Already decided (nothing to answer)

| Rule | Where it is written |
|---|---|
| Handing in files is optional. A task can be marked Done with no file. | PRODUCT §4.9 |
| Every Done makes a new version (v1, v2, ...). Nothing is replaced. No limit on rounds. | PRODUCT §4.9, WORKFLOWS §3.3 |
| Photos and documents up to 25 MB, videos up to 100 MB. Bigger work comes as a link. | PRODUCT §4.9, ADR-0003, ADR-0010 |
| Originals are never changed or compressed. Small preview pictures are made separately. A phone photo keeps everything in it, including where it was taken. | CLAUDE.md invariant 9, ADR-0010 |
| Only the task's main person marks Done. A coordinator hands in for a freelancer. | Invariant 6, ADR-0013, WORKFLOWS §1b |
| Whoever can see a task can see its files. Crew see only their own tasks. | PERMISSIONS §2 "Task comments / files / submissions" |
| Files live on tasks only. They never touch client projects, deliverables or revenue. Crew never see client records. | Invariants 3 and 4, ADR-0005 |
| Approval stays the same: Done, then the Admin (if any), then you. A failed Drive copy never blocks approval. | Invariant 5, WORKFLOWS §5A |
| Crew never get into the company Drive. Only you connect or reconnect it. | ADR-0010, PERMISSIONS `drive.manage` |
| MaxOff makes the Drive folders and file names. Tasks with no client go under "Internal". | PRODUCT §4.10 |
| MaxOff deletes its own copy only after the Drive copy is confirmed (photos after 90 days, videos after 30). Previews stay. | ADR-0010, WORKFLOWS §5A |
| If Google signs MaxOff out, you see "Reconnect Google Drive". Everything waits. Nothing is lost or deleted. | PRODUCT §4.10, WORKFLOWS §5A |
| You are warned when Drive has less than 10 % free. | WORKFLOWS §5A, §8 |
| While a task is on hold: no Start, no Done, no stage ticks. Comments still work. | WORKFLOWS §3.1a |
| A privacy notice for the team and written keep-rules are part of phase 10.3. | ROADMAP 10.3 |

## B. Asked before, still waiting for your tick

**B1. The 14 answers you gave on 1 Oct (PR #36).** They were never saved into the main documents. One tick re-confirms them (this is Oct-11 Q1; recommended: yes, all stand). Two of them are touched by later decisions:
- Answer 1/PERMISSIONS said "the Owner never hands in". Since v1.7.1 you can be on a task. Oct-11 Q2 fixes this (recommended: you hand in like anyone, only on tasks you are on).
- Answer 11 (one notice at 8 GB) is widened by question 2 below.

**B2. The 11 questions of 22 Oct** (`docs/kickoff/phase-8-questions.md`). Recommended answers stand as written there. The three that matter most: Q2 (you hand in), Q5 (only you can remove a wrongly handed-in file, with a reason), Q6 (no files on client deliverables for now). Q7 and Q10 are replaced by question 1 below.

**B3. The 20 Drive-upload questions of 11 Nov**, plus its 5 business questions. Recommended answers stand as written there. Three notes:
- Its Q3 ("completes itself"): the second choice, "straight to completed", would break the rule that final completion is always yours (invariant 5). Only the recommended choice (automatic Done, then normal approval) fits today's rules.
- Its Q9 (where raw footage goes) is still yours to decide.
- Its business question "does the Drive work move ahead?" is question 1 below, now with options.

## C. New questions

### Topic 1. What we build, and in what order

**1. Which part comes first?**
The Drive-upload task needs the company Drive connection. Today that connection is planned for after the full launch. On 5 Nov you said only revenue and "the Drive link" remain.
- **(a) (Recommended) Two releases. First "Company Drive + Drive upload". Then "Hand in files".** You get your newest request first. When file hand-in arrives, every file is copied to Drive from day one, so MaxOff storage never fills.
- (b) "Hand in files" first, Drive later (the old plan). Crew get uploads sooner. Files pile up in MaxOff storage with no cleanup until Drive arrives (see question 2).
- (c) Everything in one release. One thing for the team to learn. The biggest and slowest release so far.
- (d) Drive upload only. Drop file uploads; Crew keep pasting links in the Done note. Smallest. No previews, no versions of files.

**2. MaxOff's own storage: what when the free 10 GB is used?**
100 videos of 100 MB fill it. After that it costs about ₹1.30 per GB a month (100 GB is about ₹130 a month). Backups use the same account.
- **(a) (Recommended) Keep accepting uploads and pay the small fee. Tell me at 8 GB, then at every 10 GB more.** Nothing ever stops for the Crew.
- (b) Stop video uploads at 10 GB and ask for links instead. Costs nothing. Crew hit a wall with no warning.
- (c) Lower the video limit to 50 MB. Slower to fill. More work arrives as links you do not own until Drive copies them.

### Topic 2. Who can add what

**3. A task on hold: can files still be added to the next hand-in?**
- **(a) (Recommended) Yes.** Like comments. Nothing is handed in until Done, and Done waits for the hold to end.
- (b) No. "On hold" means nothing moves. Crew must wait to add a file they already have.

**4. Files from the other side: on the brief, or on feedback?**
Today the person giving the task, and the reviewer asking for changes, can only type text and links.
- **(a) (Recommended) Not now. Text and links only.** Keeps this phase small. Matches your earlier answer "reviewers never add work".
- (b) The reviewer can attach pictures to "Request changes". Clearer feedback. One more thing to build and store.
- (c) Both: files on the brief and on feedback. Most useful. Roughly one extra builder session and more storage.

### Topic 3. Uploading from a phone

**5. A big video on mobile data**
- **(a) (Recommended) Show the size and a gentle line for files over 25 MB: "About 90 MB. Wi-Fi is better." Never block.** The person decides.
- (b) Say nothing. Simplest. Someone may burn their data pack.
- (c) Refuse big files on mobile data. Protects data packs. iPhones do not tell us the connection type, so it would not work for everyone.

(Already in your 1 Oct answers: the upload runs only while MaxOff is open. Locking the phone or switching apps can stop it, and the person picks the file again.)

### Topic 4. Removing and keeping

**6. When you remove a wrongly handed-in file (Oct-11 Q5), what about its Drive copy?**
- **(a) (Recommended) MaxOff deletes its copy and moves the Drive copy to Drive's bin (Google keeps it 30 days).** A private photo is really gone. A mistake can be undone for 30 days.
- (b) MaxOff deletes only its own copy. You delete in Drive yourself. Simple. Easy to forget, so the private file stays.
- (c) Both deleted at once, for good. Cleanest. No way back.

**7. A private link that is never fixed**
One document says MaxOff re-checks for 7 days. Another says it keeps trying.
- **(a) (Recommended) Check for 7 days. Then stop, mark it "Not archived", tell the approving Admin once, and show a "Check again" button.** Clear end. Nothing loops forever.
- (b) Keep checking once a day forever. Catches a late fix. Old dead links are checked for years.

### Topic 5. Drive folders and names

**8. Which month does a file go under?**
- **(a) (Recommended) The day it was handed in.** Matches the date in the file name. Late work sits in the month it arrived.
- (b) The month of the task's deadline. Work sits with its plan. Late work looks on time in Drive.

**9. A client is renamed, or a task's client is changed, after files are in Drive**
- **(a) (Recommended) Rename: MaxOff renames the client's Drive folder. Client changed on a task: files already copied stay where they are; new ones go to the new client.** One folder per client. No files move by surprise.
- (b) Never touch Drive. A renamed client ends up with two folders.
- (c) Always move files to match. Drive always mirrors MaxOff. Many moves, more to go wrong.

**10. Someone hands in a link to a Drive folder (on a normal task, not a "Drive upload" task)**
Google can copy a file in one step, not a folder.
- **(a) (Recommended) Copy everything inside it, the same way the Drive-upload task does.** You own all of it. Needs the Drive-upload work to exist first.
- (b) Only file links are copied. A folder link shows "Not archived". Simple. The work can vanish if the person deletes it.
- (c) Refuse folder links on normal tasks: "Use a Drive upload task". Clear rule. One more wall for the Crew.

### Topic 6. The "Drive upload" task (adds to the 20 questions)

**11. The copy finishes after the deadline. Is it late, and who gives the reason?**
- **(a) (Recommended) Lateness is judged at the moment the Crew member pastes the link and says the upload is finished. If that is past the deadline, they type the reason then.** Fair: the copy time is not their fault.
- (b) Judged when the copy is verified. No reason is asked. Simple. A slow Google copy can make someone look late.
- (c) These tasks are never late. Easiest. You lose sight of real delays.

**12. Which Admins see the company folder, and how?**
The draft says "the task's Admin" and "share with the Admin's Google email". MaxOff does not hold a Google email for Admins today.
- **(a) (Recommended) The approving Admin and the client's Admin. Each types their Google address once in "Me". MaxOff shares that one folder as view-only, and takes the share away when they leave or lose the client.** Tight and tidy.
- (b) Every Admin who can see the task. Fewer "I can't open it" moments. Wider access to raw footage.
- (c) No sharing. Only you open Drive. Safest. Admins cannot check the copy, so you check every one.

**13. How must the cameraman share the folder?**
- **(a) (Recommended) "Anyone with the link can view" only.** MaxOff never shows the company Google address to anyone.
- (b) Also allow sharing straight to the company address, shown on the task. Works for cameramen who refuse open links. The company address becomes known to Crew and outsiders.

## D. Small rules: one tick accepts all (or change any line)

| # | Rule we suggest | Other choice |
|---|---|---|
| S1 | If a person is taken off a task or leaves, files they added but not yet handed in stay. The main person can remove them. | Remove them automatically |
| S2 | If a task is cancelled, files not yet handed in are kept and shown. Reopening brings them back. | Clean them up after 30 days |
| S3 | A file removed before Done is kept 30 days, then deleted. (It was never handed in.) | 7 days |
| S4 | PDFs and design files go in a "Documents" folder beside "Photos" and "Videos". | Put them in "Photos" |
| S5 | When a coordinator hands in for a freelancer, the Drive file name carries the freelancer's name. | The coordinator's name |
| S6 | When you remove a handed-in file, the person who added it and the task's main person are told, with your reason. | Tell nobody |
| S7 | If one file cannot be copied to Drive after all retries, only you are told, at most once a day. MaxOff keeps its copy. | Tell the Admin too |
| S8 | If Drive is full, copies wait, you are told, nothing is deleted, and Crew can still hand in. | Stop hand-ins until fixed |
| S9 | The same Drive link on two tasks is copied twice. You and the Admin see "copied before on ‹date›". Crew see nothing extra. | Refuse the second copy |
| S10 | Before each part is built you see a sample screen. One release = one theme, with a guide update and a team message. | (your standing rules) |

**Decide first:** question 1 (order), question 2 (storage money), and B1 to B3.

---

# PART 2. Builder appendix

## Facts from the code that shape the plan
- `submission_items` does **not** exist in any migration (only in comments); `task_submissions` does (`supabase/migrations/20260929053634_tasks_schema.sql`). So 8.1 creates the table fresh, in the Draft-14 shape (belongs to a task first, sealed into a version later).
- `task_submit_version` (ROADMAP 8.1, WORKFLOWS §5A, ADR-0010) does not exist; `task_submit_done` writes versions. Draft-14 folds sealing into `task_submit_done`.
- Uploads already go browser to R2 by presigned URL (`C:/Users/ASUS/Desktop/MaxOff/src/core/storage/actions.ts`, `client/upload.ts`), so the Cloudflare request-body limit is **not** on the upload path.
- `files` has **no purpose column** (`FILE_PURPOSES` is only a server check). Settings → Storage "split by submissions / receipts / logos" needs either a new nullable `files.purpose` (expand-only, backfilled by reference) or a join through referencing tables.
- `/api/files/[id]` serves raster and SVG only; video and PDF are refused there by design.
- `StorageAdapter.presignGet` is documented "always as an attachment"; Draft-14 wants inline video/PDF.
- Cron triggers today: `30 21 * * *` (storage_cleanup) and `* * * * *` (push_dispatch) in `C:/Users/ASUS/Desktop/MaxOff/wrangler.jsonc`.

## Units (each one builder session). Order shown for recommended option 1(a); for 1(b) run H-units first and D-units after.

**K. Kickoff record and samples [Q, docs only].** Close PR #36; record "Kickoff 8 decisions" in PROGRESS; update PRODUCT §4.9/§4.10, WORKFLOWS §3.3/§5A/§8/§9, PERMISSIONS, DATA-MODEL §6/§8/§9, ARCHITECTURE §11; ADR-0010 amendments (non-Drive links; Owner removal incl. Drive bin; folder links; 7-day recheck; Documents folder); a **new ADR** for the Google app posture (OAuth, scope, publishing status); fix the contradictions in Part 3; sample screens for the owner. Depends on: the answers.

**D1. `core/drive` connect [H] (8.3a).**
- Tables: `drive_account` (DATA-MODEL §8; RLS: no API-role select at all, service role only; a safe `drive_status()` reader for `drive.manage`), `drive_folders` (key by client id + path, not by client name, for Q9). pgTAP per role (Owner sees status only; Admin and Crew nothing).
- Functions: `drive_connect_complete`, `drive_mark_needs_reconnect`, `drive_set_root` (transition functions, audited, notify Owner per §9).
- Screens: `/settings/google-drive` (Owner; own `loading.tsx`; Connect / Reconnect / root folder / queue and failures list as cards), the Reconnect banner (must not add a read to a shared layout: carry the flag in `session_bundle` only if already Owner-scoped, else show on Today and Settings only), `/api/drive/callback` route. Back-gesture specs at 375/430 for the settings screen and its sheets.
- Risks: **service account vs OAuth**: a service account cannot use a personal Google One account's quota and there is no Workspace for delegation, so OAuth with an offline refresh token is the only fit (ADR-0010 already says OAuth). Copying other people's files needs the full `drive` scope (restricted); `drive.file` cannot read a cameraman's folder. An OAuth app left in "Testing" issues refresh tokens that expire in about 7 days; "In production, unverified" shows a warning screen and has a user cap. **Verify current Google rules (Context7 / Google docs) before building**; this is Drive-20's "unverified app" business question. Tokens: AES-GCM via Web Crypto with a Worker secret (`.env.example` entry), never returned to the browser. OAuth `state` bound to the Owner's session.

**D2. `drive_jobs` queue and worker [H] (8.3b).**
- Table: `drive_jobs` generic (`subject_kind`, `subject_id`, `payload`, state, attempts, `next_attempt_at`, `last_error`) as the Drive-20 plan proposes; index `(state, next_attempt_at)`. RLS: service role only. pgTAP: claim is exclusive (`for update skip locked`), backoff, park on `needs_reconnect`, idempotent re-run.
- Worker route `/api/cron/drive-tick` on the existing every-minute trigger (docs say every 2 minutes: pick one, Part 3). `drive_quota_check` daily.
- Risks: Workers limits per invocation (subrequest count, CPU, wall time for sub-hourly crons): small batches, one large file per tick; Drive per-user rate limits and the roughly 750 GB/day copy/upload cap; `files.copy` can time out yet succeed, so stamp each target with `appProperties` (job id) and look it up before retrying (no duplicates). Tests against a fake Drive server; never real Google in CI.

**D3. Drive upload schema and functions [H] (8.5a).** `task_types.auto_action`, `org_settings.drive_copy_folder_pattern`, `drive_folder_copies`, `drive_copy_entries` (per the draft plan). Functions: `drive_copy_start` (assignee/coordinator; captures late reason per Q11), `drive_copy_progress`/`_verify`/`_fail` (service), auto-Done by calling the `task_submit_done` path as system-for-primary-owner (invariants 5 and 6 intact), hold pauses, cancel stops and keeps. RLS: Crew read state and counts through a reader that never returns the target link; link visible to Owner + Admins per Q12. pgTAP per role and per path. If Q12(a): `members.google_email` (own-edit, Owner-readable) and share/unshare jobs triggered by deactivation and client reassignment.

**D4. Copy worker [H] (8.5b).** Walk (pagination), mirror folders, copy, verify (count, size, md5; Google Docs by count), re-list source, complete. Failure states from the draft plan, each a worded state + §9 notification with a pgTAP recipient test. Risk: `copyRequiresWriterPermission`, shortcuts, files changing mid-copy.

**D5. Drive upload screens [C] (8.5c).** Task page panel (paste link, folder name, progress, states), Settings → Task types flag, Admin's folder link. After-page loading on `/tasks/[id]` (budget 855,040 bytes, about 20 KB spare); no new first-wave read (v2.0 X3: at most 6). `loading.tsx` unchanged shape or updated to trace; back-gesture specs; guide + screenshots; speed gate.

**H1. Hand-in schema and functions [H] (8.1 database half).**
- Migration: create `submission_items` (task_id not null, submission_id null until sealed, kind, file_id, preview_file_id, source_url, site label, added_by, on_behalf_of, removed_at/by, owner-removal columns + reason, link_state, archive_state, drive ids, timestamps); `task_comments.submission_id` null; optional `files.purpose`. RLS in the same migration: select via `app.task_visible(task_id)`; no API writes. `app.file_visible` re-created with the submission case.
- Functions: `submission_item_add_upload`, `submission_item_add_link`, `submission_item_remove` (before sealing), `submission_item_owner_remove(item, reason)` (Oct-11 Q5b; Owner only), `task_submit_done` re-created to seal items + counts in the "Task submitted" text. **Stale-review check:** do not add a defaulted 4th argument to `task_review` (it creates an ambiguous overload for PostgREST and the old 3-arg call must keep working during rollout); add `task_review_version(task_id, decision, reason, submission_id)` and leave `task_review` as is. Hold behaviour per Q3.
- pgTAP: every role allowed/denied (Owner, approving Admin, client's Admin, assignee Crew, non-assignee Crew, coordinator, removed assignee), every path (limits 20/10, sealed immutability, STALE, held task, cancelled task).
- Risk: **cleanup interaction.** `file_cleanup_candidates` spares any file a foreign key still references, so a removed item's file would never be cleaned while the row keeps `file_id`. Decide the mechanism (archive the `files` row and extend the candidates rule for removed items; keep the item row and its history). Also the uploader clause of `app.file_visible` lets a removed assignee still fetch a file they uploaded by id: decide whether the submission case overrides it ("same as the task").

**H2. Uploader on the Work view [C] (8.1 client half).** New `core/storage` purposes (image/video/document submission), "Add files" sheet, progress rows, "Upload stopped", previews, HEIC decoder and video poster as dynamic imports.
- Risks: (1) **Presigned part URLs are all signed up front with a 15-minute life** (`PRESIGN_UPLOAD_SECONDS`); a 100 MB video on a slow uplink takes longer, so later parts will be refused. Sign each part on demand or lengthen and re-sign on 403. (2) Parts go one at a time with 3 immediate retries and no backoff or offline wait: add backoff and resume-on-`online`. (3) iOS suspends a backgrounded PWA; consider Screen Wake Lock during upload (check support). (4) HEIC and RAW often arrive with an empty or odd MIME on Android/Windows; `beginUpload`'s MIME regex and allow-list will reject them: classify by extension and confirm by magic bytes on completion (ranged GET). (5) R2 CORS must expose `ETag` (already required). (6) e2e on MinIO with throttled network.

**H3. Review UI [C] (8.2).** Versions on the task page (latest open, earlier collapsed as view state), full-screen viewer layer (Previous/Next, pinch-zoom, no swipe), "Comment on v2", review sheet in Approvals with the version, "A newer hand-in arrived", "Download original". Inline video/PDF needs `presignGet` to allow `inline` for an allow-list of types only, CSP `media-src` for the bucket host, and URL refresh when a 5-minute link expires mid-playback. `loading.tsx` for `/tasks/[id]` and `/approvals` re-traced; back-gesture specs for viewer, sheets and collapsed versions at 375/430; guide for all three roles.

**H4. Links + Settings → Storage [C] (8.4a + Draft-14 #11).** "Add a link" sheet, site labels, "Not archived" badge and hint; `/settings/storage` (Owner, own `loading.tsx`), storage notices per Q2 computed in the daily `storage_cleanup` route. Note nightly `pg_dump` backups share the R2 account's free allowance.

**H5. Archive of hand-ins [H] (8.4b + R2 → Drive half of 8.3).** Jobs queued at sealing; Drive-link access check and 7-day recheck (Q7); folder links (Q10) reuse D4's walker; R2 → Drive resumable upload **streamed** (Worker memory is far below 100 MB of headroom: never buffer; hash with a digest stream while piping; Drive chunk sizes are multiples of 256 KiB); archive badges; retention `delete_local` 90/30 only when archived; Owner removal to Drive bin (Q6); rename on client rename (Q9).

**R. `/review-phase`** per release: both Playwright shards, security review of storage and Drive paths, speed gate paired against `main`, guide check, the owner's phone walk.

## Dependencies
K → everything. D1 → D2 → D3 → D4 → D5. H1 → H2 → H3; H1 → H4. H5 needs D1, D2 and H1 (and D4 for folder links). H1 to H4 have no Drive dependency, so option 1(b) is buildable as today's 8A/8B. All migrations expand-only; old cached clients must keep working against the new schema (the Done sheet's 4-argument `task_submit_done` call is unchanged).

---

# PART 3. Where the current docs contradict themselves about Phase 8

1. **Scope.** ROADMAP's v2.0 note (owner, 5 Nov) says only revenue and "the Drive link (8.5)" remain; the launch order and Phase 8 still list 8.1, 8.2, 8.4a as the phase. 8.5 sits inside Phase 8 with no unit and "needs 8.3", while 8.3 is deferred to after 10.5.
2. **Phase title and exit vs content.** The title says "and the Drive archive"; the exit line says the archive is deferred past the launch.
3. **Function name.** ROADMAP 8.1, WORKFLOWS §5A and ADR-0010 say `task_submit_version`; DATA-MODEL and the code have only `task_submit_done`; the unmerged draft folds one into the other.
4. **Link recheck.** WORKFLOWS §5A: "up to 7 days". PRODUCT §4.10: "keeps retrying and archives as soon as access is granted".
5. **Who hears about a private link.** WORKFLOWS §9: the submitter and the approving Admin. PRODUCT §4.10: the employee is notified and "the Owner sees the warning".
6. **Drive folder shape.** PRODUCT §4.10: `MaxOff Archive/Clients/...` and `Internal/...`. ADR-0010: `Clients/<Client>/<YYYY-MM>/Photos|Videos/` only. Neither has a place for documents, though PRODUCT §4.9 accepts documents. The 8.5 draft adds `Raw footage/<folder>` and a settings pattern.
7. **Limits wording.** PRODUCT §4.9: "Photos and documents 25 MB". ROADMAP 8.1, ADR-0010, ARCHITECTURE §11: "images ≤ 25 MB" (documents unnamed).
8. **Links.** PRODUCT §4.9, ADR-0010 and ROADMAP 8.4a on `main` say Google Drive links only; the owner's 1 Oct answer 13 (any https link) and its ADR amendment exist only on `origin/kickoff-8`.
9. **Owner hands in.** The unmerged PERMISSIONS row says the Owner never hands in; WORKFLOWS §3 (v1.7.1, 6b.2) lets the Owner be primary owner and complete on his own Done.
10. **Storage cost claim.** ADR-0010: "storage stays inside R2's free 10 GB". ROADMAP "Until 8.3 lands": originals stay in R2 with no cleanup. Both cannot hold once videos are uploaded.
11. **"Resumable".** ARCHITECTURE §11 and ROADMAP 8.1 say resumable uploads; the 1 Oct answer 5 and the code are per-part retry within one open session only.
12. **Job timing.** WORKFLOWS §8: `drive_archive_tick` every 2 minutes. The 8.5 draft: the existing every-minute cron.
13. **Deletion rules.** ADR-0010 / invariant 9: nothing deleted before a Drive copy exists. Oct-11 Q5(b) (Owner removes a sealed file) and the draft's "removed before Done goes to normal cleanup" both delete without a Drive copy; each needs the ADR amendment named in unit K.
14. **Archive badges.** ROADMAP 8.2 on `main` still lists "archive status badges" and PERMISSIONS has `drive.view_status` for Crew; the 1 Oct answer 10 moves badges out of phase 8.
15. **Stale comments.** `C:/Users/ASUS/Desktop/MaxOff/src/core/storage/limits.ts` says submissions "join in phase 5"; ARCHITECTURE §11 names the action `files_begin_upload` (code: `beginUpload`).
16. **PROGRESS is behind ROADMAP** on `main` (stops at v1.9 paused, 3 Nov), and `docs/kickoff/phase-8-questions.md` states a release order (v1.9 → 8 → 9 → 10) that v2.0 and the 8.5 note have since changed.

### Critical Files for Implementation
- C:/Users/ASUS/Desktop/MaxOff/docs/kickoff/phase-8-questions.md
- C:/Users/ASUS/Desktop/MaxOff/docs/decisions/0010-drive-archive.md
- C:/Users/ASUS/Desktop/MaxOff/docs/ROADMAP.md
- C:/Users/ASUS/Desktop/MaxOff/src/core/storage/actions.ts
- C:/Users/ASUS/Desktop/MaxOff/supabase/migrations/20260929053636_task_transitions.sql