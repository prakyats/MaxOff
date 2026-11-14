# v2.0 "Fast and settled": visible changes and guide audit

Release candidate: `phase-v2` @ bafd6f45, compared with `origin/main` (v1.9.0). Read from `git diff origin/main...HEAD`.
Guide paths are under `src/modules/guide/domain/content/`. "Crew" is the Staff role.

## Part 1. Every user-visible change

| # | Change | Who | Where | Phone / laptop | Code |
|---|---|---|---|---|---|
| 1 | **Pages finish loading sooner.** Each screen asks the database for its data in fewer, earlier trips (at most six at once). Biggest on a task, Tasks, a project, a client, Templates, Approvals, Leave, a person's page. The likely next screens are fetched ahead for every role. | All | Every screen | Both | `session_early`, `own_week`, `task_page`, `project_page`, `client_overview`, `templates_library`, leave folds (14 migrations); `src/app/(app)/**/page.tsx` |
| 2 | **A tap on a chip in a task row opens the task.** In v1.9 a tap exactly on the chip ("Note it", "2 days late", "To do", "On hold"…) did nothing. Now the whole row is one target. The row's own buttons still work. | All | Every list built from task rows: Tasks, All tasks, My Day, Today (Owner "My tasks", "Overdue and risks"; Admin "Needs you", "My tasks") | Both | `src/core/ui/composites/list-row.tsx` (`after:z-[1]`) |
| 3 | **An early tap on the calendar is kept.** A tap on a day box (month), a day in the week strip, or the size handle before the calendar is ready is held and replayed when it is ready (up to 2 seconds; after that it is let go, as before). Never a Save or commit button. | All | Calendar | Both; felt mostly on a phone (handle and strip are phone-only) | `pre-hydration.ts` (`data-hold-tap`), `calendar-screen.tsx`, `month-grid.tsx` |
| 4 | **Today no longer flashes its list.** Owner: the "Needs you" approval rows show grey placeholder rows of the right count and height, then the real rows in the same place; the attendance card under it no longer jumps down. Admin: the same for "Client work" rows. | Owner, Admin | Today | Both | `today/owner-today.tsx`, `today/admin-today.tsx`, `client-work-skeleton.tsx`, `approval-group-skeleton.tsx` |
| 5 | **A client's page and a project's page load without a jump.** Their grey loading screens now match the real page: the header has the state chip's line, project rows have their real line heights, Key people no longer shifts. With large system text nothing reaches past the screen edge. | Owner, Admin | Clients → a client; a project | Both; the large-text fix is phone | `clients/[id]/(tabs)/loading.tsx`, `layout.tsx`, `projects/[projectId]/loading.tsx` |
| 6 | **More → Appearance is its own sheet.** The whole "Appearance · Dark" row is now one button (sun/moon icon at the left, › at the right; the small menu button is gone). It opens a bottom sheet titled "Appearance" with three rows: Light, Dark, System ("Follows this device's setting"); the current one is ticked. A tap applies it and closes the sheet. In v1.9 the little menu inside More flashed and closed. | Owner, Admin (Crew have no More) | Phone bottom bar → More | Phone only. Laptop top bar menu and Me → Appearance are unchanged. | `more-sheet.tsx`, `theme/appearance-sheet.tsx`, `appearance-trigger.tsx` |
| 7 | **Back works first time after choosing an appearance.** After a choice, the first back closes More, the next leaves the screen. (During v2 building, one back press did nothing.) | Owner, Admin | More → Appearance | Phone | `appearance-sheet.tsx` (`closeOverlaysThen`) |
| 8 | **Phone menu items are all the same size.** Eight items were smaller and less indented than their neighbours: task ⋯ "Put on hold…" and "Resume" / "Resume…"; deliverable row ⋯ "Open" and "Mark done"; deliverable sheet ⋯ "Mark done early", "Add revision round", "Move up", "Move down", "Set close kind"; project ⋯ "Copy schedule as text". | Owner, Admin | A task, a project, a deliverable | Phone only | `dropdown-menu.tsx` (keeps its own `data-slot`), callers use `data-action` |
| 9 | **My Day: "On hold · n".** A held task still leaves the day's groups, but a line "On hold · 1" under the groups (above "Suggest a task") opens All tasks filtered to On hold. In v1.9 the task just vanished from My Day. | Crew | My Day | Both | `my-day/page.tsx` (`my-day-on-hold`) |
| 10 | **The held-task note shows to everyone.** "Start, Done and the stage ticks wait until the task is resumed." now shows in the amber line for anyone who opens the task (the Owner, the approving Admin), not only people on it. | Owner, Admin (Crew on the task already saw it) | A held task | Both | `tasks/[id]/page.tsx` (`note={HELD_WORK_NOTE}`) |
| 11 | **A held project reads "On hold" on the client's lists.** Amber "On hold" chip in place of "Open" / "In progress" / "Ready to complete" on the client's Overview ("Active projects") and the Projects tab. | Owner, Admin | Clients → a client | Both | `clients/[id]/project-list.tsx`, `ProjectSummary.held` |
| 12 | **A held project's deliverable says so when it opens.** The sheet header reads "On hold" (not "Open"); an amber note at the top: "The project is on hold: ticks and Mark done wait until it is resumed."; the stages are greyed. This is how an Admin now sees a project the Owner held. | Owner, Admin | A held project → a deliverable | Both | `client-work/components/item-sheet.tsx`, `domain/hold.ts` |
| 13 | **Signed-out pages: colours fade.** If the phone switches between light and dark while a signed-out page (sign-in) is open, colours now fade instead of snapping. Signed in, a theme change still switches at once. | Anyone signed out | Sign-in pages | Both | `theme-provider.tsx`, `quiet-theme-change.ts` (only started by the signed-in shell) |
| 14 | **End day is ready sooner.** The expense form's setup behind "Any expenses to claim today?" now starts earlier, so My Day (Crew) and Today (Admin) finish loading one database trip sooner, and the form after "Yes" is ready sooner. Nothing looks different. | Crew, Admin | My Day, Today → End day | Both | `my-day/page.tsx`, `today/admin-today.tsx` (`claimSetup`) |
| 15 | **Today and My Day are lighter to open on a phone.** Four small pieces of start-up work were removed (theme re-apply, two band measurements, clock set-up). Felt as speed only. | All | Today, My Day | Phone mostly | `quiet-theme-change.ts`, `push-banner.tsx`, `offline-banner.tsx`, `clock-words.ts`, `warm-zone.ts` |

Checked and **not** visible: Approvals' reads were regrouped (same rows); a person's page reads the directory once; `requests_to_decide_count` is new in v2.0 and its last migration only corrects v2.0's own count (an Admin's "suggestions to decide" number is the same as v1.9); the notification bell fix is test-only; no wording changed anywhere except items 6, 9 and 12.

## Part 2. Guide audit (text at HEAD)

### Correct
| Change | Role | Guide line |
|---|---|---|
| 2 chip opens task | Owner | `owner.ts:367` "Tap anywhere on a row, its chips included, to open the task." and `owner.ts:123` "Tap a row, or its chip, to open the task." |
| 2 | Admin | `admin.ts:321` "Tap anywhere on a row, its chips included, to open the task." |
| 2 | Crew | `crew.ts:505` "Tap anywhere on a row, its chips included, to open the task." |
| 3 calendar | Owner | `owner.ts:763` "If you tap a day while the calendar is still loading, it opens as soon as it's ready." |
| 3 | Admin | `admin.ts:722` same sentence |
| 3 | Crew | `crew.ts:838` same sentence |
| 6 Appearance sheet | Owner | `owner.ts:86` "More also has Appearance: tap it, then tap Light, Dark or System; the sheet closes and the More row shows your choice, such as Appearance · Dark." |
| 6 | Admin | `admin.ts:58` "On a phone, More → Appearance opens a small sheet: tap Light, Dark or System; the sheet closes and the More row shows your choice, such as Appearance · Dark." |
| 6 | Crew | Not affected. `crew.ts:1047` "Open Me and find "Appearance"." is still right (Me is unchanged). |
| 9 My Day On hold | Crew | `crew.ts:87` "If a task of yours is on hold, an "On hold · n" line under the groups opens them." and `crew.ts:554` "A held task leaves your lists. My Day shows "On hold · n" (highlighted) instead: tap it to see your held tasks." (picture `staff/my-day-on-hold`, correct) |
| 10 hold note for everyone | Owner | `owner.ts:617` "Everyone who opens the task sees the amber "On hold" chip, the reason and that Start, Done and the stage ticks wait until it is resumed." |
| 10 | Admin | `admin.ts:533` same sentence |
| 11, 12 held project | Owner | `owner.ts:1455–1464` "Everyone who opens a held project sees it at once, the client's Admin included:" + two steps with pictures |
| 11, 12 | Admin | `admin.ts:1504–1517` "A project on hold, yours or one the Owner held, shows it as soon as you open it:" + two steps with pictures |
| 1, 4, 5, 8, 13, 14, 15 | All | No guide text needed (speed, loading screens, sizes). Nothing in the guide contradicts them. |

### Gaps (none blocks the release; G1–G3 are worth fixing)
- **G1. MISSING, Owner, `owner.ts:51`.** The More sheet's list leaves out Appearance. Now: "The last cell, More, opens a sheet with Reports, Clients, People, Settings, then Me and Help." Replace with: **"The last cell, More, opens a sheet with Reports, Clients, People, Settings, then Me, Help and Appearance."**
- **G2. MISSING, Admin, Today (`admin.ts:159`, topic "Client work, My tasks, This week and Issues").** The chip rule is only on the Tasks topic. Add at the end of the text: **"Tap anywhere on a task row, its chips included, to open the task."**
- **G3. MISSING, Crew, My Day (`crew.ts:86`, topic "Read My Day").** After the groups step add: **"Tap anywhere on a task's row, its chip included, to open it."**
- **G4. Thin, Owner `owner.ts:984` and Admin `admin.ts:893` (client page topics).** They name "Ready to complete" on a project row but not "On hold". It is covered in the hold topics, so optional. Add after "Ready to complete”": **"and a project on hold reads "On hold""**.
- **G5. Thin, all roles, calendar.** The guide covers a day tap; the size handle is held too. Optional, in `crew.ts:838`, `admin.ts:722`, `owner.ts:763`: **"The same goes for the handle that changes the calendar's size."**
- **G6. Not said anywhere: back after choosing an appearance.** Optional, after the Appearance sentence in `owner.ts:86` and `admin.ts:58`: **"Back then closes More."**
- **G7. Admin's Appearance sentence sits in "The bell and Me"**, the Owner's in "Use Me"; neither role has an "Appearance" topic of its own (Crew has "Change light or dark"). Searching "dark" as Owner or Admin may not find it. Check the topics' `keywords` include "appearance", "dark", "theme".

### Pictures
Viewed at HEAD: `owner/task-hold-line`, `owner/project-held-row`, `owner/item-held-sheet`, `staff/my-day-on-hold`, `admin/client-page`, `owner/client-states`, `owner/task-hold-menu`. All match the v2.0 screens (the hold note line, the On hold chips, the amber sheet note, the My Day line).
- **P1. Check, low risk:** `owner/task-hold-line`, `owner/project-held-row` and `owner/item-held-sheet` are byte-for-byte the same files as the Admin's. The content is right for both roles (the sidebar is cropped out), but confirm the Owner's set was really shot signed in as the Owner and not copied.
- **P2. No picture of the new Appearance sheet** (no More-sheet picture exists at all, so nothing is stale). Optional new phone shot for `owner.ts:86` / `admin.ts:58`.
- **P3. Not re-shot, still right:** `staff/task-on-hold` (Crew's view did not change), `owner/today`, `admin/today`, `staff/my-tasks`, the calendar pictures (no visual change).
- No stale picture found.

### Also found (docs, not the guide)
- `docs/RELEASE-NOTES.md` v2.0 draft: three Owner/Admin items sit under "What the Crew will notice" (Today's flash, the client and project loading, back after Appearance; Crew have no More sheet and no client pages). It also names the RC as caa7b78e; the RC is bafd6f45. Fixed in the new draft at `C:/Users/ASUS/Desktop/MaxOff/docs/handoff/v2.0-release-notes-draft.md`.
