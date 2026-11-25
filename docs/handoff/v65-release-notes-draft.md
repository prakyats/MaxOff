# MaxOff v6.5: see the team at a glance (release notes, draft)

**Not released yet.** Release candidate: `phase-v65` @ ‹sha at READY›. Released after v6.0 (it builds on v6.0's bookings: the type and who booked it). The Owner tags after his phone walk.
This is the plain-words draft for `docs/RELEASE-NOTES.md`.

## What the team will notice

### Owner
- **Team today on Today.** A card with three counts, **Free now**, **Booked today** and **On leave**, then one line per person: what they're booked for, when and who booked it ("Shoot / Site Visit 2:00 pm – 4:00 pm · booked by Asha"), "Free all day", "On leave" or "Half day". Booked people come first. You appear only when you're booked. It counts bookings and approved leave only, never attendance times.
  - On a phone it sits after Needs you; on a laptop, on the right above This week.
  - **"Show all N"** opens the whole team in place.
  - **"+ Book someone free"** and **Calendar** open today on the Calendar, where the Crew card lists who is free and "+ New task" books them.
- **Upcoming shoots and visits on Tasks.** Between Needs you and Open tasks: every open shoot, visit or meeting from today to six days ahead, soonest first, with its day, time and place, and who is on it. They aren't repeated under Open tasks.
- Your People page doesn't change.

### Admins
- **Team today and Upcoming shoots and visits**, as above.
- **People shows Today and Next booked.**
  - Today: what each person is on, with the type's colour ("Shoot / Site Visit 2:00 pm – 4:00 pm · you"), "Free all day", "Half day", or **"On leave · back Tue 17"**.
  - Next booked: their first booking after today within 30 days ("Thu 19 · Meeting 10:00 am · Sana"), or "Nothing booked".
  - On a phone, each card has the two as lines. This replaces the Available / Busy chip.

### Crew
- **Your shoots and visits come first on Tasks**, under "Upcoming shoots and visits": your own only, with the day, time and place. They aren't repeated under Due today or Upcoming.
- **My Day shows a shoot's time and place** where other tasks show "Due …".
- Crew see nothing new about anyone else.

## Speed

> **PLACEHOLDER: SPEED TABLE GOES HERE.**
> From the release-candidate probes, this release's preview beside a preview of `main`, plus the India run (Today and My Day changed):
> - Today for the Owner and an Admin;
> - Tasks for every role;
> - People for an Admin;
> - My Day for a Crew member.
>
> The gate: no screen slower than today in two runs in a row. First-load JS never raised (Today 659.9 KB, Tasks 658.1 KB, both unchanged; People 895.5 KB, +1 KB, budget 932 KB). Do not mark READY until this table is in.

## Under the hood
1. Today's card is one read of everyone's availability for today. Tasks and My Day take their shoots from the week read they already make, so no read was added to either.
2. People reads one new function for Next booked and the day someone on leave is back (weekly offs, holidays and further leave considered). It returns the fact of leave only, never its type or reason.
3. Three database changes, all additions; one of them closes an internal helper to every API role (found in review). Rolling back to v6.0 needs no extra step.

## The team message (WhatsApp, after the release)
> MaxOff is updated (v6.5). On Tasks, your shoots and visits for the week come first, with the time and place, and My Day shows them too. Everything is in Me → How MaxOff works.
