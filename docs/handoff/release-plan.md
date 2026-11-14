# MaxOff release plan, from v2.0 to full launch

> Owner, 14 Nov 2026: break the remaining phases into **small releases**, shipped one by one.
> Version numbers leave **gaps** (2.1 → 2.5 → 3.0 …) so fixes or extras can ship as 2.2, 2.3, 2.4 in between.
> **The old "v2.1" (Admin productivity + reliability) is renamed v6.0 / v6.5 / v7.0**, because it now comes after Revenue and Drive.
> Every release keeps the full bar: CI ×2, review, speed gate, guide, the owner's phone walk, and the owner's tag.
> Each release starts only on the owner's "proceed vX".

| Version | Name | What's in it | Who notices | About |
|---|---|---|---|---|
| **v2.1** | **Money in** (phase 9) | The Owner-only money tables (RLS + pgTAP for each role; the money-lint fixes). A project's **Billing** section: amount, category (defaulting from recurrence), extras priced on top, advances. **Revenue page:** Potential / Achieved / Remaining by month and client. A one-time project's "Mark done and complete project" prompt. | Owner (Admins see only the new complete-project prompt) | 1–1.5 wk |
| **v2.5** | **Revenue every day** (phase 9) | "On hold ₹X" line. **Notification for unpriced added deliverables.** The masked revenue line at the end of the Owner's Today (loaded after the screen). Billing history (Owner-only). | Owner | 1 wk |
| **v3.0** | **Reports** (phase 9) | Owner reports: people (completed, overdue, delays, revision loops, working-hours counts in Month), stage durations by stage name, client work. The Admin's scoped work report updated. Week / month / custom range. | Owner, Admins | 1–1.5 wk |
| **v3.5** | **Month close** (phase 9) | Close a month from the first priced month: frozen snapshots, corrections, "Changed since close". | Owner | 1 wk |
| **v4.0** | **Drive connected** (phase 8) | Connect the studio Gmail Drive (Owner-only, `drive.file`). Automatic folders (Clients / client / month / task). **Storage watch** (used and free; alerts at 80 % and 90 %). | Owner | 0.5–1 wk |
| **v4.5** | **Upload link** (phase 8) | The per-task **private upload link**: straight to Drive, Drive-like progress, auto-resume, folders kept. The Admin's **live view**, the 15-min stuck alert, "uploads look finished", **"All files received"** (Done via the coordinator). Unassigned uploaders flagged. **A sample and a security review come first.** | Admins, Owner, freelancers | 1.5–2 wk |
| **v5.0** | **Hand in work** (phase 8) | Crew hand in photos and videos on a task inside MaxOff (versions v1, v2…, originals untouched, previews separate); review screens (preview, versions, request changes). | Crew, Admins, Owner | 1.5–2 wk |
| **v5.5** | **Drive links** (phase 8) | Paste a Drive link → MaxOff copies it into the studio Drive and verifies it (8.4, 8.5). The weekly one-tap reconnect, or Google verification (owner decision). | Admins, Owner | 1 wk |
| **v6.0** | **Admin calendar** (was v2.1 units 9 + 12) | The availability change (type + who booked; every booking counts; a date-only event is busy all day). Calendar: the Month day sheet's Busy / On leave / Free, the new Day and Week. **New task, type first**, with the Free / Busy picker. | Admins, Owner | 1.5 wk |
| **v6.5** | **Team view** (was v2.1 units 10, 11, 13) | **Team today** card (Admins and Owner). Tasks: **Upcoming shoots and visits**. **People for Admins** (Today and Next booked). | Admins, Owner, Crew (own shoots) | 1 wk |
| **v7.0** | **Reliable anywhere** (was v2.1 units 1–4 and 6 + carry-overs) | Weak network: no duplicates, "No network, tap again", the no-network note plus the Owner's **Clear Late**. iPhone and accessibility tests in CI; the calendar contrast fix. The 10:00 rush test (staging). Real-user speed. Every screen's skeleton on the tap; calendar speed; Thresholds bug; Appearance wording; Stay until ahead; test gaps; security hardening. | Everyone (small) | 1.5–2 wk |
| **v7.5** | **Polish and security** (phase 10) | UX polish (keyboard shortcuts, empty and loading states, phone pass); **full security review** + India DPDP privacy notice for staff; database and performance tuning. | Everyone (small) | 1.5 wk |
| **v8.0** | **Full launch** (phase 10) | Import existing clients and projects; finish the user guide; the second restore drill. | Everyone | 1 wk |

**Total: about 14–17 weeks** (more small releases means more walks; each walk is about 30 min for the owner).

## Alongside (not releases)
- **December:** the database restore practice on the owner's laptop (Q10).
- **The owner's own tasks:** a sealed spare backup key (Q11); 2-step verification on the studio Gmail.

## After launch (optional, each its own small release when wanted: v8.5, v9.0 …)
Uploaded-files backup (6 months) · exports (PDF, CSV, AI-friendly) · activity search · global search (Ctrl+K) · freelancer payments · Drive archive clean-up rules · app rename for 3not8studios · the intro video.

## Notes
- **"UI changes in one release" (owner, 16 Oct):** small releases are now the owner's choice (14 Nov). Each release still keeps its own changes together, and the team gets one short message per release.
- **The integrator's started work on `phase-v21`** (iPhone, accessibility) belongs to **v7.0**; that branch keeps its name until then.
- **Decisions already taken** for each release: `docs/kickoff/phase-9-kickoff-refresh-2026-11-14.md` (v2.1–v3.5), #89 6879421505 and follow-ups (v4.0–v5.5), `docs/handoff/v2.1-plan.md` (now v6.0–v7.0).
