# Phone vs live (v1.7.1): the screens the design gate touched

The owner's correction of 23 Oct, item 4. Every phone difference between **v1.7.1** (`origin/main`
84f6562, built locally against the same database) and **this branch** (`r3-v5b-cal`), at **375 and
430 px**, for the screens the gate fixes touched. The pictures sit beside this file in
`phone-vs-live/` (`<screen>-<width>-live.png` and `-built.png`, the Owner, light, the same demo
data). Nothing outside the calendar was changed for this audit; the rest is only listed.

- **approved (cite)**: the owner approved it, directly or as part of a set he approved.
- **unapproved**: no owner approval yet (mostly the design gate's fixes, which the owner's
  correction did not keep in its list: tokens, today, the bell). Each needs the owner's yes or a
  revert.

375 and 430 show the same differences unless a row says otherwise.

## Every screen (the shell)

| Difference | Status |
| --- | --- |
| One title bar (the MaxOff mark, the page's title, ⋯, the bell) instead of the MaxOff bar (with the account circle) over the page's title bar | approved (v1.8 L4, DESIGN "One header bar on a phone"; SCOPE PP-phone-1, owner "do all") |
| The bell's count sits off the bell's top-right and grows outward | approved (owner's correction 23 Oct, item 2: "the bell") |
| Light theme: a cream page, white raised cards, the v1.8 colour tokens | approved (owner's correction 23 Oct, item 2: "the colour tokens"; 2f1b369) |
| Status chips lead with their tone's dot ("• To do", "• In progress") | approved (owner 23 Oct, #89 comment 6367337528: keep all six gate differences); gate 10, 3aef7e1 / 78d943c |

## Calendar (`cal-*`)

| Difference | Status |
| --- | --- |
| Structure: week strip → "Show more of the month" → full month, the day under it | same as live (owner's correction 23 Oct, item 1) |
| Header: ‹ Oct 2026 › · Today · `All ▾` · Filters as a 44 px icon (a dot and "Filters · N on" while a filter is on) instead of a "Filters" text button | approved (option A, owner 23 Oct, `docs/design/v18-phone-calendar-filter-sample.html`) |
| With "Client work" chosen the button reads "Client ▾" at 375 and "Client work ▾" at 430, the month "Oct 2026" at both; first the gaps go (snug), and only where that still wraps (320, and "Client ▾" at 360) the month reads "Oct" (its name keeps "October 2026"). `cal-client-work-375-built.png` was shot before the snug step and still shows "Oct" | approved (option A: shorten to "Client ▾"); the year dropping below 375: approved (owner 23 Oct, #89 comment 6367337528) |
| Today: the solid red circle with a white digit and a neutral tint, never outlined (live: an outlined box) | approved (owner's correction 23 Oct, item 2; 3f546b5) |
| The chosen day is the outlined box (live: a black filled circle on its date; in the week strip a black filled day) | approved (SCOPE PP-calendar-1, PP-phone-3, owner "do all") |
| Today is dimmed while the shown week or month holds today | approved (owner tweak 22 Oct) |
| Weekly off: a grey tinted box with a muted number (live: a blue number) | approved (SCOPE PP-calendar-4) |
| The day under the calendar: "Tasks · n" and "Client work · n" sections; the timeline draws only the hours around its events, in a card, and the page scrolls (live: 08:00 to 20:00 in its own scroll, the screen never scrolls) | approved (SCOPE §6 calendar sample, owner 22 Oct; PP-light-4) |
| Hour labels "11 am", "12 pm" (live: "11:00") | approved (owner tweak 22 Oct, `formatHour`) |
| An event block: a leading type dot instead of the coloured left edge | approved (SCOPE §6 calendar sample) |
| Full month: what is due is a count again, as live: the events by title (done struck through), then one line for the tasks and the open deliverables, "3 due" in amber, a past day's a red pill with the alert icon and the count; "+N more" only past three lines | same as live (v1.7.1's day cells, restored in the v1.8 fix round, r3-fix-a). **Correction:** this row used to record one chip per due task and deliverable, cut at 375 to one or two letters ("P…", "Tes…", "Fi…"), as "approved … v1.7.1 behaviour". That was wrong: v1.7.1 counted (`v1.7.1:src/modules/calendar/domain/strips.ts`, `dueBadge`), and the owner never approved per-item chips on the phone (advisor audit, #89 comment 6370400281, item 1). The laptop month keeps its named chips. The count is drawn with tight letters so "12 due" reads whole at 375 |
| Full month: a leave bar never truncates (live: "Asha", the first name only, cut at 375): "Name · On leave", else "Name · Leave", else the photo and "Leave", and where even that has no room, as in a seventh of a 375 or 430 phone, the photo alone on the striped leave bar; never an ellipsis, and the box's name always says the full name ("Jayalakshmi, on leave") | approved (owner, #89 comment 6370526089: the laptop's rungs on the phone too; the photo alone as the last rung, owner 23 Oct, asked directly in the fix round) |
| The day sheet (a full-month day): the same sheet with its timeline, now under "Tasks · n", "12 pm" labels | approved (SCOPE §6; owner's correction item 1 keeps the timeline sheet) |
| "Everyone is available" and the solid "+ New task on 26 Oct" pill under the day | approved (V4 "who is away", SCOPE §6 order) |

## Day popup (laptop dialog, phone sheet)

On the phone the popup is the day sheet above: the gate's list popup with "Open day" and its footer
(1436758, 8a58a2d) is gone, and so are its due chips ("Due today", "Overdue") and the "Late" chip in
the day's rows; the rows are v1.7.1's (the time, the title, the owner, ›). No other phone change.

## New project, step 2 (`new-project-2*`)

| Difference | Status |
| --- | --- |
| Three steps "1 Basics — 2 Deliverables — 3 Preview" (live: one form, then a Preview step before Create) | approved (major change, 60b0081; `v18-major-changes-sample.html` #project, owner's nine approved samples) |
| The stepper on one line with short names ("2 Deliverables", "3 Preview") | approved (owner 23 Oct, #89 comment 6367337528: keep all six gate differences); gate 7, 28d4184 |
| The title names the client: "New project · Sample Client" | approved (owner 23 Oct, #89 comment 6367337528: keep all six gate differences); gate 7 |
| Back beside Next at the foot | approved (owner 23 Oct, #89 comment 6367337528: keep all six gate differences); gate 7 |
| The deliverables as rows with drag handles, "Uses the default stages", ⌄ and ⋯; "Add deliverables" with a name × count and the preset ticks | approved (60b0081, the same sample) |

## Project page and its deliverable cards (`project-card*`)

| Difference | Status |
| --- | --- |
| The cycle is a plain "October 2026" label (live: a one-tab switcher box) | approved (810aac4, `v18-project-page-sample.html`) |
| Pace is a red chip "• 1 behind plan" (live: red text) | approved (owner 23 Oct, #89 comment 6367337528: keep all six gate differences); gate 4, 59ce4de |
| "Needs you" under the ring: "• Reel 4 is 2 days late", "+1 more" | approved (project page sample) |
| A late deliverable: "Planned 21 Oct" with a red "• 2 days late" chip (live: the whole line in red text) | approved (owner 23 Oct, #89 comment 6367337528: keep all six gate differences); gate 4, 59ce4de |
| The stage bar is neutral grey until a stage is done (live: the first segment a light green) | approved (owner 23 Oct, #89 comment 6367337528: keep all six gate differences); gate 4, 195fe8f |
| A group's line has no ›, and its bar is a continuous track | approved (V4 project page, bb6081e; P4 one bar) |
| "Details" (contact, Repeats, Template, Notes) as cells under the list | approved (810aac4) |
| At 375 the list heading read "Deliverables ·" beside Select and Add deliverable | checked (owner 23 Oct asked for the fix): the heading has no count and is not cut, here or live (the same markup); the "·" is the picture scaled down, `project-card-375-built.png` at full size reads "Deliverables". A heading of one word cannot shrink below itself, and where the row is too tight its buttons wrap under it. `deliverables-list.spec.ts` "the list's heading reads whole" now checks it at 375, 430 and 320 (not cut, nothing over it, nothing past the row) |

## Templates (`templates*`)

| Difference | Status |
| --- | --- |
| One page with search first and a Presets · Deliverables · Projects · Tasks segmented control (live: the sections one under another, Task templates first, a floating "Add template") | approved (6b.6 "the one Templates page", 3ee18df; DESIGN "Templates") |
| The segments read whole at 375 ("Deliverables", not "Deliverabl…") and the loading screen's segments are sized by their names | approved (owner 23 Oct, #89 comment 6367337528: keep all six gate differences); gate 9, 9b5b422 / f3d9fa2 |
| A row: name, "Script → Shoot → Edit → Posted · built in", Preview and ⋯ (live: Preview, edit and archive icons) | approved (SCOPE PP-admin-12, the row anatomy 6c89a4e) |
| "Archived (n)" under the list | approved (SCOPE "archived lists") |

## Task page title bar (`task-title*`)

| Difference | Status |
| --- | --- |
| A long title is one line with "…" in the bar, and in full as the page's heading (live: two lines in the bar, cut) | approved (owner 23 Oct, #89 comment 6367337528: keep all six gate differences); gate 6, a4bb499. The compact sticky line showing the task's title is correct (owner 23 Oct, item 5) |
| The bar holds History (the clock icon), ⋯ and the bell | approved (6c89a4e detail header slots; task page 6b61f53) |
| The state as a chip, "Medium priority", the due date on its own line, the "Nothing needed…" callout | approved (task page rework 6b61f53, major-changes sample) |
| Tabs Work · Chat · Details (live: Work · Chat · Activity · Details) | approved (task page rework; Activity is History) |
| "No stages yet. + Add stage" on one line (live: a sentence and an outlined button) | approved (task page rework) |

## Task chat (`task-chat*`)

| Difference | Status |
| --- | --- |
| Chat is its own screen "Reel 2 edit · Chat" with back (live: a "Chat" sheet with ×) | approved (V5b E, the owner-approved chat spec, #89 comment 6343361250, `v18-task-chat-sample.html`) |
| Bubbles with photos or initials, the name above, the time below; my own in black on the right; a "Today" divider, system lines as pills, a red "New" divider | approved (the same chat sample) |
| The composer: "Message <first name>…" on one line, in the sample's raised bar, a round send button (live: "Write a comment" and a red "Send") | the round send and the bar: approved (chat sample); the one-line placeholder wording: approved (owner 23 Oct, #89 comment 6367337528: keep all six gate differences); gate 5, 1442434 |
| The chat's height | approved (`v18-task-chat-height-sample.html`, 54735a1) |

## Summary

- **Owner's decisions, 23 Oct (#89 comment 6367337528):** all six phone differences from the gate
  fixes are kept and approved: gate 4 (the pace and lateness chips, the neutral stage bar), gate 5
  (the placeholder wording), gate 6 (the one-line task title), gate 7 (the one-line stepper,
  "· Client" in the title, Back beside Next), gate 9 (Templates' whole segment names) and gate 10
  (the chip dots). The year dropping from the calendar header below 375 px is approved. The full
  month's chips cut to one or two letters at 375 are v1.7.1 behaviour, unchanged.
- **The project page's "Deliverables ·" heading:** not cut (see its row); now guarded by a
  Playwright check at 375, 430 and 320.
- **Nothing on this page is left unapproved.**
