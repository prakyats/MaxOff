# Phase 8 kickoff questions: work submissions and files

> Prepared by the advisor, 2026-10-22, for the Owner. Docs only: **nothing here is decided yet.** The answers are recorded by `/kickoff-phase 8` in PRODUCT §4.9, WORKFLOWS §3.3 / §5A / §9, PERMISSIONS, DATA-MODEL and ADR-0010, then as a "Kickoff 8 decisions" block in PROGRESS.

## What this phase builds
- Crew hand in real work on a task: photos, short videos, documents and links, not only a note.
- Each Done seals a version (v1, v2 …). Originals stay untouched and previews are separate (invariant 9, ADR-0010).
- The Owner and Admins review a version: preview, play, download the original, comment, approve or request changes.
- Units: **8A** = 8.1 (storage, `submission_items`, the uploader, previews) + 8.2 (the review screens); **8B** = 8.4a (link items).
- Not in phase 8: the company Drive archive and its cleanup (8.3, 8.4b, deferred past the launch).

## Where the draft stands
- **PR #36** (branch `kickoff-8`, 2026-10-01) holds the Owner's answers to 14 questions: 1–12 as recommended, 13 and 14 changed by him. It was **never merged**, and `main` has moved a lot since (v1.6–v1.8).
- Part A lists what later decisions already answer. Part B holds the questions to ask now: Q1 re-confirms the draft in one go; Q2–Q11 are new or changed.

## A. Already answered since the draft (no need to ask)
| Draft point | Now settled by |
|---|---|
| "Phase 8 starts after phases 5 and 6 merge" | Release order (owner 2026-10-16, PROGRESS "Release order after v1.7.1"): v1.8 → 6b.20 (b) → v1.9 → then 8 → 9 → 10. |
| The third role's label | "Crew", from `ROLE_LABELS` (PR #31, on `main`). |
| Notification text goes through `app.notify()` | 5A shipped in v1.3.0. |
| "Add files" and "Add a link" are neutral buttons | v1.8's `docs/DESIGN.md` and colour ADR (option A, 6b.8): neutral commit style, red only for final or destructive. The "Not archived" badge follows the same plan. |
| The HEIC decoder and video helper load only when needed | Still required, and now also by the **speed gate** (CLAUDE.md Definition of Done, owner 2026-10-22): no first-load JS growth, no new read in a shared layout. |
| Who can open a submission file | The draft's own rule (whoever sees the task). 6b.3 (v1.9) widens `app.file_visible()` for **avatars only**, so there is no clash. |
| A freelancer's coordinator hands in for them | ADR-0013 and WORKFLOWS §1b, unchanged. |
| Request changes reopens the next hand-in for v N+1 | Draft decision 1, unchanged by later work. |

## B. Questions

### Q1. Do the 14 draft answers still stand?
The draft answers, in one line each:
1. Any assignee (or a freelancer's coordinator) adds files and links to the **next hand-in** while the task is open; **Mark done** (primary owner) seals them into version N.
2. Items not handed in yet are visible to whoever sees the task; the person who added one, or the primary owner, can remove it before Done; a sealed item is never removed.
3. Types and limits: images ≤ 25 MB (incl. HEIC and RAW), video ≤ 100 MB (MP4, MOV, WebM), PDF / PSD / AI / SVG ≤ 25 MB, no ZIP; 20 files and 10 links per version.
4. Previews made in the browser; "No preview" never blocks; video plays in the browser; PDF opens in a new tab.
5. Uploads continue while the app is open; closing it shows "Upload stopped · Choose the file again".
6. A full-screen viewer with Previous / Next, pinch-zoom, no swipe, and "Download original".
7. The latest version open on the task page, earlier ones collapsed; the review sheet shows only the version under review.
8. "Comment on v2" in the one Chat thread; no per-file comments.
9. A review applies to the latest version only ("A newer hand-in arrived. Check it first.").
10. No archive badges in phase 8, except "Not archived" on a non-Drive link.
11. Settings → Storage for the Owner, and one notification the first time storage passes 8 GB.
12. No new notification kinds; "Task submitted" adds counts ("v2 · 3 files, 1 link").
13. (Owner's change) Any `https` link is a link item, labelled by its site, never fetched; non-Drive links are never archived and always show "Not archived", with a neutral hint. Needs the ADR-0010 amendment drafted in PR #36.
14. (Owner's change) The copy: "Add files", "Add a link", the too-big and wrong-type messages, "Not handed in yet …", "Anything to add for the reviewer?".
- **Options:** (a) yes, all 14 stand, except where Q2–Q11 change them; (b) go through each again; (c) yes, with named changes.
- **Recommended: (a).** These are the Owner's own answers, and nothing built since touches uploads.
- **Affects:** all of 8A and 8B; ADR-0010 (decision 13).

### Q2. The Owner on a task: can he hand in work?
Since v1.7.1 the Owner can be an assignee or the primary owner (6b.2), and a task whose primary owner is the Owner completes on his Done. The draft says the Owner "never hands in".
- **Options:** (a) yes, like any assignee, but only on a task he is on; (b) no, the Owner never adds items; (c) only on tasks where he is the primary owner.
- **Recommended: (a).** A shoot he did himself needs its files on the task, and the rule stays "assignees hand in".
- **Affects:** the PERMISSIONS "Next hand-in items" row, the add check in 8.1, `task_submit_done`'s Owner-done path.

### Q3. Staff task stages: link files to a stage?
Tasks have an optional checklist of stages (v1.7.0, reorder in 6b.18).
- **Options:** (a) no: files belong to the next hand-in only, and stages stay a checklist; (b) an optional "for ‹stage›" tag on a file; (c) each stage tick carries its own files.
- **Recommended: (a).** One hand-in per Done keeps the review simple; a tag can come later if the team asks.
- **Affects:** DATA-MODEL (no stage link), the Work view's layout.

### Q4. A completed task that is reopened: what happens to its files?
v1.8 labels the earlier hand-in on a reopened task (B5: "Earlier hand-in · reopened 16 Oct").
- **Options:** (a) sealed versions stay as they are, and the reopen opens the next hand-in for v N+1, exactly like a change request; (b) the last version reopens for edits.
- **Recommended: (a).** History is never rewritten (invariant 9), and it matches B5.
- **Affects:** WORKFLOWS §3.1 / §3.3, the reopen path in 8.1, the task page.

### Q5. A sealed file uploaded by mistake (for example a private photo)
Today nothing sealed can ever be removed, and ADR-0010 says nothing is deleted before a Drive copy exists.
- **Options:** (a) never removed: the person hands in a new version; (b) **the Owner only** can "Remove file" with a reason: the file and its preview are deleted, the row and its history stay ("Removed by the Owner: ‹reason›"); (c) the uploader can remove it within 10 minutes of sealing.
- **Recommended: (b).** Invariant 9 keeps permanent delete for the Owner, and the DPDP Act check in phase 10.3 will need a way to remove personal data. It needs an **ADR-0010 amendment**.
- **Affects:** ADR-0010, PERMISSIONS, a new transition function with pgTAP per role, the storage cleanup.

### Q6. Client deliverables: hand in files there too?
Projects and deliverables are for the Owner and Admins only; Crew never use them (ADR-0005).
- **Options:** (a) no: files live on staff tasks only, and a deliverable never holds files; (b) yes: the Owner or the client's Admin attaches final files to a deliverable; (c) not in phase 8, revisit after the launch.
- **Recommended: (c).** It keeps phase 8 small and the two work systems apart; (b) would need its own design and an ADR-0005 note.
- **Affects:** phase 8's scope.

### Q7. The Drive archive and storage
R2 is free up to 10 GB, then about $0.015 per GB a month. Nothing is deleted before a Drive copy exists.
- **Options:** (a) keep 8.3 and 8.4b deferred past the launch; Settings → Storage and the 8 GB notification watch the space (draft decision 11); (b) bring 8.3 (the company Drive) into phase 8; (c) no storage screen, only the 8 GB notification.
- **Recommended: (a).** It is the fastest path, and the Owner sees the space before it costs anything. Settings → Storage sits in v1.8's Settings groups, Owner only.
- **Affects:** ROADMAP phase 8 and "Deferred past the launch", Settings.

### Q8. Taking a photo or video on the phone
- **Options:** (a) one "Add files" button that opens the phone's own picker (it already offers the camera on iPhone and Android); (b) a separate "Take photo" button beside it.
- **Recommended: (a).** The system picker already offers the camera, so one button is enough.
- **Affects:** the Work view on phones.

### Q9. The wording in today's style
v1.8 set one date and time format ("Thu 22 Oct", "6:00 pm") and a words pass (W1–W6).
- **Options:** (a) keep the draft copy (decision 14 and the "Not archived" hint), changing only dates and times to v1.8's format; (b) review all copy again at the phase walk.
- **Recommended: (a).** The words are the Owner's, and design:ux-copy still runs before the unit is done.
- **Affects:** PRODUCT §4.9 copy.

### Q10. One release or two?
- **Options:** (a) 8A and 8B together, as one release "Hand in work"; (b) 8A first, links in a later release.
- **Recommended: (a).** The Owner's rule is one theme per release (2026-10-16), so the team learns the hand-in once.
- **Affects:** the release plan, the guide, the team message.

### Q11. How to record the answers
- **Options:** (a) close PR #36 and record the answers fresh on `main` in one kickoff PR, citing #36; (b) rebase PR #36 and add the changes to it.
- **Recommended: (a).** The branch is three weeks behind and conflicts in PROGRESS, ROADMAP and PERMISSIONS; a fresh record is cleaner and #36 stays as the reference.
- **Affects:** the kickoff session only.

## Decide first
Q1 (the draft as a whole), Q2 (the Owner hands in) and Q5 (removing a sealed file, which needs an ADR). The rest are small or follow from these.
