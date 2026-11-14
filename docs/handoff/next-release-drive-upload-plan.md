# After v2.0: Drive upload plan (advisor draft, 11 Nov 2026)

Status: **plan only.** Nothing is built until the owner says proceed. The kickoff questions below need the owner's answers first, then a sample screen.

## The On hold follow-ups (owner's v1.9 walk notes) are already in v2.0
ROADMAP X1, built 5 Nov on `phase-v2`, covers all four notes:
- the held task is visible to everyone linked, Crew included;
- the Admin sees an Owner-held project;
- the message shows on open, not after a tap;
- the "Put on hold" size on a phone.

**Check them at the v2.0 phone walk.** Also walk the phone menus at 375 and 430 (task ⋯, project ⋯, item row, calendar): the dropdown size fix touched every menu.

Small test gap for a builder: pgTAP 127 checks who can *put* a task or project on hold, not who can *read* the hold. Add these read checks:
- a Crew assignee reads the reason on their task;
- a Crew member who isn't on the task reads nothing;
- the client's Admin reads an Owner-held project;
- another Admin reads nothing.

## Drive upload task type (ROADMAP 8.5)

### Depends on 8.3 (company Google Drive connect), today deferred to after 10.5
8.5 needs these parts of 8.3:
- the Owner-only Google connect and reconnect;
- encrypted tokens;
- quota checks;
- the `drive_jobs` queue, run by the existing every-minute Worker cron;
- folder creation.

The R2 → Drive upload part of 8.3 can wait. While 8.3 is unbuilt, make `drive_jobs` generic (`subject_kind` + `subject_id` + `payload`). It's cheap now and costs a migration later.

**Google risk:** copying other people's files needs the restricted `drive` scope. Check Google's current rules for an unverified app on one personal account; tokens of apps left in "Testing" expire after about 7 days.

### Shape (all of it data; nothing Pixora-specific)
- **Task type flag:** `task_types.auto_action = 'drive_folder_copy'`. The Owner creates and names the type in Settings; nothing is seeded.
- **Placement:** `org_settings.drive_copy_folder_pattern`, e.g. `Clients/{client}/{yyyy-mm}/{folder}`.
- **Copy table:** `drive_folder_copies` holds one copy per task: state, totals, progress, the target link.
- **Manifest:** `drive_copy_entries` has one row per file: size, md5/sha256, target id, state.
- **Who sees what:** Crew see the state and counts only. The company link is shown only to the Owner and the task's Admin.
- **How it changes:** every change goes through transition functions, with pgTAP for each role.

### How the copy works
1. Check access to the link.
2. List the whole folder tree into the manifest.
3. Create the mirrored folders.
4. Copy each file server-side (`files.copy`, no bytes through MaxOff). A retry never makes a duplicate.
5. Verify: count, size and MD5 per file, Google Docs by count only. Re-list the source in case it grew.
6. Complete the task and notify.

It runs in small batches per cron minute, so a large shoot resumes where it stopped.

### Failure states (each worded, notified and retryable)
- **Link:** private link, link not a folder, copying disabled by the file's owner.
- **Company account:** company account needs reconnecting, quota too low, Google's daily limit (about 750 GB/day; pauses until the next day), rate limits.
- **Verification:** checksum mismatch.
- **Task:** task held (pauses) or cancelled (stops and keeps what was copied).
- **Never deletes a partial copy.**

### Units (rough)
- **Kickoff and sample:** K8.5, then a sample screen.
- **8.3, the company Drive:** 8.3a (connect, tokens, quota, Settings → Google Drive), 8.3b (job queue).
- **8.5, Drive upload:** 8.5a (schema, functions, RLS, pgTAP), 8.5b (copy worker plus tests against a fake Drive), 8.5c (screens, guide, Playwright 375/430 with back gesture, speed gate).

### Kickoff questions for the owner (recommended answer in brackets)
1. How many links per task? (one; a second source is a second task)
2. Who can paste the link? (any assignee, or the Owner or the task's Admin for them)
3. What does "completes itself" mean? (automatic Done, so the Admin checks the folder and approves as usual; the alternative is straight to completed)
4. The folder name? (suggested "client date task", editable)
5. Single files as well as folders? (yes)
6. What if the cameraman is still uploading? (Crew tick "upload finished" first; new files found during the copy are copied too, and it never completes while the source is changing)
7. Google Docs or shortcuts inside the folder? (copy Docs; skip shortcuts and list them)
8. A cameraman upload page with no Drive link? (later, not in 8.5)
9. **Folder placement in the company Drive?** (the owner said he'd decide; proposed default `Clients/<Client>/<YYYY-MM>/Raw footage/<folder>`)
10. **How does the Admin open the company folder?** The account is a personal Google One account. (MaxOff shares that one folder, read-only, with the Admin's Google email)
11. What do Crew see? (state and counts, never the link)
12. Quota? (refuse a copy that would leave less than 10 % free; warn the Owner)
13. Google's daily limit? (pause, tell the Crew member and the Admin, resume the next day by itself)
14. Who gets which notice? (verified → Admin and Crew; access problem → Crew; failed → Crew and Admin; quota or reconnect → Owner)
15. A partial copy? (keep it; resume on retry)
16. A hold or cancel mid-copy? (a hold pauses; a cancel stops and keeps what was copied)
17. Retries? (automatic for 24 h, then "Try again")
18. The verification standard? (count + size + MD5)
19. The type itself? (the Owner creates it in Settings)
20. Stages and Mark done on these tasks? (stages allowed; Mark done hidden until the copy is verified)

### Business questions only the owner can answer
- Does 8.3 move ahead of phase 9, and what happens to the rest of phase 8 (8.1, 8.2, 8.4a)?
- Is the next release "Drive upload" or phase 9 (revenue)?
- Is the 2 TB plan enough for raw footage, or is it time for a bigger plan or Workspace?
- Is an "unverified app" screen acceptable on the Owner's one-time connect?
- Should a held project show on its client's tasks? (nobody asked; only a question)
