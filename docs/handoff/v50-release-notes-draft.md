# MaxOff v5.0: hand in your work (release notes, draft)

**Not released yet.** Release candidate: `phase-v50` @ ‹sha at READY›. Released after v4.5 (it uses v4.5's upload to Drive). The Owner tags after his phone walk.
This is the plain-words draft for `docs/RELEASE-NOTES.md`.

## What the team will notice

### Crew
- **Hand in photos and videos inside MaxOff.** An open task has a **Files** section. Tap **Add photos and videos** (on a laptop: choose files or a whole folder, or drop them in). Each file goes straight into the studio's Google Drive, into the task's folder, at full quality. MaxOff keeps no copy and never changes your files.
- **Mark done hands them in.** The sheet says what goes with it, for example "Hand-in v1 · 12 files". If changes are requested, new files go into v2. v1 stays exactly as it was.
- **Keep MaxOff open until every file says "In Drive".** Uploads keep going while you move around MaxOff. A lost connection carries on by itself. Closing MaxOff stops them.
- **Added the wrong file?** Tap **Leave out** on it before Mark done. It isn't counted. It stays in the studio Drive, because MaxOff never deletes files.
- **Files are optional.** A task with nothing to hand in is marked done with a note, as before. Meetings, calls and other types the Owner sets to "no hand-in" show no Files section at all.
- Everyone on the task can add files; only the primary owner marks it done.

### Admins
- **See what was handed in.** On the task page, Files shows each version (v1, v2…): who handed it in, when, and each file's name and size. Approvals says it too ("v2 · 14 files").
- **Open in Drive.** On the tasks you created, approve, or run for a freelancer you coordinate, each file has **Open in Drive**, and there's a link to the whole version's folder. They open in the studio's Google Drive, so use the studio's account in your browser.
- **Request changes asks for the files by name.** The box now says "Name the files that need changes, and say what to fix."
- **Flags, not blocks.** A file deleted in Drive shows "Removed in Drive". Programs and web pages show "Check before opening".

### Owner
- Everything the Admins see, on every task.
- **Settings → Task types → "Has hand-in".** It is on for every type. Untick it for types with nothing to hand in (meetings, calls, site visits): their tasks show no Files section. Files are never required to mark a task done.
- **If the studio Drive is nearly full**, a file that would not fit is refused with "The studio's Drive is nearly full", and you're told once a day.
- **If Google Drive needs reconnecting**, the Files section says so, and Mark done with a note still works.

## Speed

> **PLACEHOLDER: SPEED TABLE GOES HERE.**
> From the release-candidate probes: the task page and Approvals for the Owner, an Admin and a Crew member, and Settings → Task types for the Owner, this release's preview beside a preview of `main`. The gate: no screen slower than today in two runs in a row, and the task page's first-load JS never raised (830.1 KB now). Do not mark READY until this table is in.

## Under the hood
1. Files go from the browser straight to Google Drive through a resumable upload the server opens (the v4.5 mechanism); the server never holds a file. Each finished file is checked against Google's own record (size and checksum).
2. Two new tables for the hand-in list, closed to every API role and read only through checked functions. Mark done waits for files still uploading and ties the version's files to it.
3. A per-task-type setting, "Has hand-in" (on by default).
4. Database changes are additions only. Nothing is removed or rewritten, so rolling back to v4.5 needs no extra step (the new tables simply go unused).

## The team message (WhatsApp, after the release)
> MaxOff is updated (v5.0). You can now hand in your photos and videos inside MaxOff: open the task, tap Add photos and videos, wait until each says "In Drive", then Mark done. The files go straight to the studio's Google Drive at full quality. Keep MaxOff open while they upload. Everything is in Me → How MaxOff works → "Add your photos and videos".
