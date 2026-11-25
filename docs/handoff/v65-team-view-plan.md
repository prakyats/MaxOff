# v6.5 "Team view": the plan

> **Status: PROPOSED (builder, 25 Nov 2026).** Units 10, 11 and 13 of `docs/handoff/v2.1-plan.md`. The samples were approved by the owner on 14 Nov 2026 (the board https://claude.ai/artifact/WMdFpTnpveWEm4JCVzfxRF: "2 · APPROVED · Admin Today: Team today card", "3 · APPROVED · Tasks: Upcoming shoots and visits", "4 · SUGGESTED v2 · People (Admin)"). Decisions: #89 6874350719, 6874389662, 6874423650 (and 6874042506 and 6878616642 for the shared availability rules).
>
> Branch `phase-v65`, from `origin/phase-v60`, merged from `phase-v60` as it moves. **v6.5 builds on v6.0's unit A:** `member_availability()` says each busy block's type and who booked it, counts every booking (the viewer's own and the Owner's), and treats a date-only event as busy all day. It is released after v6.0.

## 1. What the owner decided (14 Nov 2026)

- **Team today card** on Today, for **Admins and the Owner**:
  - counts: **free now**, **booked today**, **on leave**;
  - one line per person: type, time and who booked it ("Shoot 2 – 4 pm · you"), "Free all day", or "On leave";
  - **"+ Book someone free"**;
  - it uses `availability.view` data only, never attendance times;
  - it "replaces the This week section where that would be empty" (6874350719; the sample keeps This week under it).
- **Tasks: Upcoming shoots and visits**: one row per event task with its date and time, title, place, people and status. Keep it uncluttered, with the important details standing out. Crew see their own.
- **People, Admin view only**: photos, role and status stay; **Today** and **Next booked** are added, and no open-tasks count. The Owner's and the Crew's People pages don't change (the Crew don't open People).

## 2. The data

**No new table, column, permission key or policy.** Everything comes from reads the viewer already has:

| Screen | Read | Who |
|---|---|---|
| Team today | `member_availability([today])` (unit A), for everyone the viewer sees | Owner, Admins (`availability.view`) |
| Upcoming shoots and visits | the viewer's event tasks (`task_types.shows_on_calendar`) from today on, under the existing task RLS (`listEventTasks`, as the calendar) | everyone with `tasks.work`; Crew see only tasks they're on (RLS) |
| People · Today | `member_availability([today])`, already read by the Admin's People page (PP-admin-10) | Admins |
| People · Next booked | **new:** `member_next_booking(after_date, days)` | Admins (`availability.view`) |

**The one new database function: `member_next_booking(after_date date, days int default 30)`.**
- What it returns: per active member the caller may see, their **first** booking after `after_date` and within `days` (≤ 62): `(member_id, on_date, start_at, end_at, all_day, type_name, booked_by, booked_by_name)`.
- The rules are exactly `member_availability()`'s (unit A): the caller's own bookings and the Owner's included; a date-only event is all day; **never a title, client, location or task id**; freelancers through the same visibility.
- Security definer, stable, `availability.view` (FORBIDDEN for Crew and freelancers; UNAUTHENTICATED for a non-member; no EXECUTE for anon).
- **Why a new function, not 30 days of `member_availability()`:** that read returns one row per person per day (15 people × 30 days = 450 rows on every People visit). This one returns one row per person.
- An expand-only migration, with pgTAP for each role (the Owner and an Admin allowed; Crew, a freelancer, a deactivated member and anon refused) and for each rule (own booking, the Owner's, date-only, a cancelled or completed event not counted, the window, no title in the row).

## 3. Screens

### Unit 10 · Today: the Team today card (Admins and the Owner)
- **Where:** the right column on a laptop, under the existing Needs you / Client work / My tasks; on a phone, after Needs you.
- **Counts** (three tiles):
  - **Free now:** not on leave, and not inside a booking at the current IST time (an all-day booking counts as busy).
  - **Booked today:** at least one booking today.
  - **On leave:** approved leave or comp leave; a half day counts too, its line says "Half day".
  - The Owner is never counted as free or on leave (6b.2); the Owner appears only when booked.
- **One line per person**, booked first (by start time), then free, then on leave. The wording is from `modules/calendar/domain/crew.ts` (unit A's rules):
  - "Shoot 2 – 4 pm · you", or "· booked by Nikhil";
  - "Free all day", or "Free from 4 pm" once their last booking ended;
  - "On leave".
  - Several bookings: the next one, then "+1".
  - Five lines, then "Show all N" (opens in place, no history).
- **"+ Book someone free"** opens New task for today with v6.0's Free / Busy picker (unit 12). It's a link, not a layer.
- **"Calendar ›"** goes to Calendar → Day for today.
- **This week:** see Q1.
- **Speed:** a server component in its own Suspense boundary, with a skeleton that traces the tiles and five lines. It adds no first-load JavaScript (`/today` 670 KB is never raised) and no read to the shared layout. Today changes, so the release runs the India check.

### Unit 11 · Tasks: Upcoming shoots and visits
- **Where:** on the Tasks tab, between Needs you and Open tasks (the sample). For everyone with `tasks.work`: the Owner and Admins see the event tasks they see, the Crew only their own.
- **Row:**
  - date · time ("Mon 16 · 11–1", or "Tue 17 · all day");
  - the title;
  - the place;
  - the people (first names; "+2");
  - the status chip.
  - On a phone, a card: date · time on the first line, the title, then place · people.
- **Which:** open event tasks (not completed or cancelled) whose event date is from today to six days ahead (Q2), soonest first. A held task shows "On hold".
- **Open tasks** leaves them out ("· N others"; Q3).
- **Crew, My Day:** their own event tasks show their time and place in place of "Due 6:00 pm" (the plan's "Tasks / My Day"; Q6).

### Unit 13 · People, Admin view: Today and Next booked
- The Admin's People list keeps photo, name, role and status, and gains two columns. On a phone, each card gets one more line each.
- **Today:**
  - "Shoot 2 – 4 pm · you", "Free all day", "On leave · back Tue 17", "Half day";
  - the coloured dot is the task type's colour;
  - the Owner: only when booked.
  - This replaces today's Available / Busy chip for Admins.
- **Next booked:**
  - "Thu 19 · Meeting 10 am · Sana" (the date, type, start and who booked it), from `member_next_booking(today, 30)`;
  - "Nothing booked" when there's nothing within 30 days (Q4).
- The Owner's People page and the Crew are unchanged.

## 4. Permissions and docs
- PERMISSIONS: `member_next_booking` under `availability.view`; the three screens' rows (who sees what); Crew see only their own event tasks (unchanged RLS).
- WORKFLOWS §4: "free now" and "booked today" are read from bookings and leave only, never attendance.
- DATA-MODEL: the function.
- The guide, for every role:
  - Admin and Owner: "See who's free today", "Upcoming shoots and visits";
  - Admin: "People: Today and Next booked";
  - Crew: "Your shoots and visits".
  - `guide:screenshots` for those topics.

## 5. Tests
- **Unit:** the card's counts and lines (free now at instants around a booking, all-day, half day, the Owner, several bookings), the Upcoming rows' words and window, and Next booked's words.
- **pgTAP:** `member_next_booking` for each role and rule.
- **Playwright** at 1280, 375 and 430, with the installed-mode back spec:
  - the card (counts, lines, "Show all" adds no history, "+ Book someone free" opens New task for today);
  - Upcoming rows for the Owner, an Admin and a Crew member (their own only);
  - People's columns for an Admin, and the Owner's page unchanged.
- **Skeletons:** each route's `loading.tsx` traces the new parts.
- **Speed:** `/today` (Owner, Admin), `/tasks` (all roles), `/people` (Owner, Admin), paired against `main`, plus the India check (Today changes).

## 6. Questions (recommendation first)

1. **This week on Today.** The decision says the card "replaces the This week section where that would be empty"; the sample shows This week under the card. **Rec: the card goes on top of the right column; This week stays under it when it has anything and disappears when empty** (as drawn). *Alt:* the card always replaces This week.
2. **How far ahead "Upcoming shoots and visits" looks.** **Rec: today plus the next six days** (the sample's "2 this week"), soonest first; today's ones stay until they're marked done. *Alt:* 14 days, or the rest of this calendar week.
3. **Do upcoming shoots also stay in "Open tasks"?** **Rec: no**, they're listed once, under Upcoming ("Open tasks · N others", as drawn). *Alt:* in both.
4. **How far Next booked looks.** **Rec: 30 days**, then "Nothing booked". *Alt:* no limit.
5. **"+ Book someone free".** **Rec: opens New task for today** with the Free / Busy picker (free people first). *Alt:* opens Calendar → Day.
6. **Crew's My Day.** The plan says "Tasks / My Day: their own shoots and visits show with the time and place". **Rec: yes, on both**: My Day's own event rows say the time and place in place of "Due 6:00 pm". *Alt:* Tasks only.

## 7. Build order (`phase-v65`)
1. Docs (this plan, PERMISSIONS, WORKFLOWS, DATA-MODEL), then the migration `member_next_booking` with pgTAP.
2. The pure rules: the card's counts and lines, Upcoming rows, Next booked words (on unit A's `crew.ts`), with unit tests.
3. Unit 11 (Tasks, My Day), unit 10 (Today), unit 13 (People), each with its skeleton, Playwright and guide.
4. Review; the speed gate (as §5); READY after v6.0.
