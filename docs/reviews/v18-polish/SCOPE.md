# v1.8 V5b: the polish scope

This file collects every polish item the advisor posted on issue #89 between 21 and 22 October, with each item's source comment named. The owner's word: "do all and finish the polish fully."

**Precedence:**
- The FINAL UI DECISIONS (section 1) win over any earlier PP item that conflicts.
- The owner's later rulings (truncation, Me restructure, the 9 approved samples, change 6) win over both.

The approved sample page for the 9 major changes is `docs/design/v18-major-changes.html`. Open it in a browser and use its Dark/Light toggle. Each change shows the real screen before, and the target after.

**Builder areas.** Each builder works in its own worktree.
- **A (`V5b-0` first, then its area):**
  - first: `DESIGN.md` §Decisions, shared components, light-theme tokens, the row anatomy, the header pattern, the date/time labelling, sheets and dismiss buttons;
  - then: the shell and top bar, Today/My Day, Tasks, the task page, Approvals, and forms/dialogs.
- **B:** client work (Clients, the client page, the project page, the deliverable sheet), Templates, Settings, People, the person page, Reports.
- **C:** light-theme verification on every route, phone-specific items, Me, Alerts, and the no-access and empty states.

Each builder takes before and after screenshots of every screen it changes (local seed). They go in `docs/reviews/v18-polish/<area>/`, named `<screen>-<role>-<width>-<theme>-{before,after}.png`.

---

## 1. FINAL UI DECISIONS (comment 6322652532). Write these into `docs/DESIGN.md` §Decisions first.

**1. Hierarchy, on every screen**
- There is one clear first thing: the title plus a one-line context (the date on Today/My Day; client · repeat on projects).
- The role's question is answered in the first viewport.
- Exceptions get rows. The normal case collapses to a count or a muted line.
- **Empty sections never take a heading.** Show one muted line, or nothing.
- One solid button per layer (the colour plan); everything else is outline or quiet.

**2. Surfaces and depth, in both themes**
- The page is surface-0. Cards and rows are surface-1 with a hairline border. Overlays are surface-2/3, with one shadow per step.
- The sidebar is a second neutral, one step off the page (cooler in dark, warmer in light), so it reads as chrome.
- **Light theme gets the same depth as dark.** Today it is flat. Card borders are visible at about 1.15:1, cards have the raised shadow, and the page tint is distinct from the cards.
- No card inside a card. Sections separate by spacing and headings, not by boxing everything.

**3. Type**
- Geist only, on the scale 12/14/16/18/20/24.
- Page title 24/semibold. Section heading 14/semibold, with a muted "· n" count. Body 14. Meta 12, muted.
- Numbers that are the point (attendance tiles, ring %, report figures) are one step up and tabular.

**4. Colour and state**
- The colour plan as approved:
  - red: final or urgent actions;
  - Forest: approve;
  - neutral: commit;
  - outline: secondary actions;
  - status chips: red, amber, blue, green, grey.
- Text colour alone never carries status: always a chip, or a dot plus a word.
- **Remove the thick left-edge accent stripes** on calendar chips and agenda rows (`border-l-4` / `border-l-2` in day-agenda, day-detail, month-grid, timeline). Use a small leading type dot plus the soft tinted fill instead.
- Red only where the plan says. Today is a red circle on the date plus a neutral tint on the cell.

**5. Rows and lists**
- One row anatomy app-wide:
  - title (one line, with an ellipsis only where a tap opens the full text);
  - a muted meta line;
  - on the right: chips, then › (with ⋯ before › when the row has actions).
- The chat count is a small muted badge **next to the title**, not among the chips.
- Overdue and due text becomes a chip. Risk reasons become a chip plus plain text.

**6. Headers and navigation**
- Detail header: back · title · status chip, then on the right the History clock, then ⋯ (on the person page too).
- Laptop: the page's one primary action sits in the header action area (e.g. Crew's Mark done). Phone: a sticky bottom bar.
- Laptop top bar: slimmer (about 56 px), holding the bell, theme and avatar, with no empty band.
- Help is reachable in 2 taps or fewer for every role: laptop sidebar foot plus the profile menu; phone More/Me.

**7. Empty, loading, no-access**
- Empty states teach and offer the one action (e.g. "Add expense" inside it).
- The no-access page keeps the header, names what was blocked, and its button goes to the role's home.
- Skeletons trace the new layouts (a DoD rule).

**8. Wide screens**
- When a list has 3 rows or fewer on a laptop, use the right column for "This week" (due dates plus own leave) on My Day, My tasks and Today instead of blank space.

**9. Motion**
- State transitions of 150–250 ms only (sheet in/out, row expand, toast). No page-load choreography.

### Truncation rule (owner, comment 6322342277). Add it to the text section of `DESIGN.md`.
- **Where a tap opens more** (an expandable row, a chip that opens a sheet, a calendar item that opens the day, a tab or row that drills down): the first view stays **one line with an ellipsis**. The opened view **always shows the full text**.
- **Where nothing opens further** (the final detail view, a dialog body, a details field, a sheet's content): **never truncate**. Wrap as needed.
- Withdrawn: PP-phone-5, and the min-width part of PP-project-3. Check instead that expanded rows, checklists and the deliverable sheet show every group and stage name in full.
- Audit: every ellipsis in the app must sit on something that opens to the full text. Any ellipsis on a non-expanding element is a bug.

---

## 2. The 9 major changes: ALL APPROVED (comments 6331638458, 6331819942, 6331870421)

1. **Today and My Day:**
   - the date line;
   - empty sections collapsed to one quiet line;
   - larger attendance figures, with the tiles keeping their current width (bigger numbers only, not a wider bar);
   - risk chips;
   - a laptop "This week" column. It takes **at most 25–30% of the content width** (e.g. `minmax(260px, 28%)`). There are two columns **only at a content width of 1200 px or more**. Below that, "This week" moves **under** "Overdue and risks" as a full-width section. It is never a squeezed third column and never hidden.
   - Covers PP-today-*, PP-admin-3/4, PP-crew-2/7 and FINAL §1/§8.
2. **New project in 3 steps** (PP-forms-7), approved as shown.
3. **Me restructure** (section 3 below), approved as shown.
4. **Light-theme depth, consistent on every screen.** Many team members use light mode, and it must not feel too bright.
   - A warm cream page (about `#F6F5F2`).
   - White cards with a hairline border and a soft shadow.
   - The sidebar one tone darker.
   - **No pure `#FFFFFF` page backgrounds anywhere.**
   - Check every route, sheet, dialog, table and empty state in light.
5. **Calendar chips:** a dot plus a tint, no side stripe.
6. **Date/time field, option C, labelling only.**
   - Keep the native device/browser date and time pickers and the current form layouts.
   - Change only how a chosen value reads in the field:
     - dates read `Thu 22 Oct`, with the year added only when it isn't the current year;
     - times read `6:00 pm` (the B1 formatter);
     - when empty, the placeholder is `Choose a date` / `Choose a time`.
   - **No** quick-pick buttons, no custom calendar popover, no layout change. **PP-forms-2 is dropped** and PP-forms-1 is replaced by this.
   - Keyboard entry and the native picker keep working. Screen readers get the full date (`Thursday 22 October 2026`).
   - Applies to every date and time input.
7. **Reports summary strip** (PP-reports-1, PP-admin-5).
8. **Person page summary-first** (PP-person-2/3). Use the same header/summary pattern wherever a record has a summary.
9. **Slimmer top bar plus one row layout** (FINAL §5/§6).
   - **The bell:** use the app's outline bell icon (20 px). The count is a small pill **offset to the top-right, outside the glyph**, with a 2 px ring in the bar's background colour. Cap it at "99+".

---

## 3. Me restructure (owner, comment 6322378452; supersedes PP-me-1). Every role, laptop and phone, in this order:
1. **Identity header:**
   - photo, with a ring and an initials fallback;
   - name, role and sign-in email (the Owner sees no "(the Owner changes this)");
   - **Edit profile**.
   - One block; drop the duplicate "Profile · Full name" section.
2. **My work** (Admin, Crew): Attendance & leave; Extra work & expenses.
3. **Your freelancers** (Admins who coordinate one).
4. **Notifications:**
   - "Turn on here";
   - **Your devices**, each with Remove (red only in its confirm);
   - **Send a test notification** (moved here from Help).
5. **Appearance:** Light / Dark / System.
6. **Help:** How MaxOff works; Reload app.
7. **Sign out of this device**, last: a **red outline / red text** button, not solid (nothing is destroyed), with a confirm.
8. **Version**, in small muted text at the very bottom.

Update the Me specs, the back-gesture specs and the guide's "Use Me" topics for all roles.

---

## 4. PP items by area

### A: shell, Today/My Day, Tasks, task page, Approvals, forms and dialogs
- **PP-today-1:** today's date under the title ("Wednesday, 21 October").
- **PP-today-2:** an empty "Needs you" collapses into one quiet line under the greeting ("Nothing needs you right now").
- **PP-today-3:** larger attendance numbers, tile targets of 44 px or more, labels under the numbers.
- **PP-today-4:**
  - "This week": drop the second "Today" from "Prakyat on leave · Today" inside the Today group;
  - "Tomorrow · Due · 1 task due" must name the task ("Test 4 · 6:00 pm").
- **PP-today-5:** a risk reason becomes a chip plus plain text, not amber text.
- **PP-phone-6:** the date on Today on a phone too.
- **PP-tasks-1:** hide an empty section entirely; don't explain why it's empty.
- **PP-tasks-2:** one status chip plus the due text (red when late), not two dot-and-label pairs.
- **PP-task-1:**
  - status is a chip;
  - priority is a quiet label;
  - the due date has its own line, red when overdue.
- **PP-task-2:** the "next step" sentence becomes a calm callout box above the actions.
- **PP-task-3:** the right column ("People", "About the task") sits on a subtle surface card, with label/value pairs aligned.
- **PP-task-4:** empty Stages uses the shared empty-row style: muted, one line, with an inline "+ Add stage".
- **PP-admin-2:**
  - Approvals' count badge shows only when something waits;
  - its empty state points to what the Admin can do instead (a link to Tasks "To check").
- **PP-admin-3:** the "On leave today · I'm working today" bar becomes a calm callout:
  - a leave icon;
  - one sentence, "You're on leave today";
  - the button as outline.
- **PP-admin-4:** an empty "Client work" collapses into one muted line under My clients.
- **PP-admin-6 / PP-crew-6:** the task row's chat count moves next to the title as a small muted badge.
- **PP-admin-13:** "Yours to note" becomes the same chip style as other row states (amber "Note it").
- **PP-crew-2:**
  - My Day before the day starts: a clear call to action, "Start your day", with the time it will record;
  - "Suggest a task" becomes a quiet link at the bottom.
- **PP-crew-7:** a laptop two-column layout with "This week" (major change 1; follow its responsive conditions).
- **PP-crew-8:** on a laptop, the task page's Mark done sits in the header action area, right of the title, beside History. The phone keeps the sticky bottom button.
- **PP-approvals-1:**
  - with one item, its Approve is the solid Forest button;
  - with 2 or more, "Approve all n" is the solid one.
- **PP-approvals-2:** the review panel's context ("Comp leave", "This week") loads with the page or is prefetched, so the panel opens complete.
  - The owner's speed rule: no new reads in shared layouts.
- **PP-forms-1/2:** replaced by major change 6 (labelling only).
- **PP-forms-3, dismiss buttons:**
  - on a phone, the sheet's ✕ and drag handle are the dismiss;
  - drop the big Cancel, or make it a quiet text button;
  - a destructive confirm's dismiss says what it keeps ("Keep it").
- **PP-forms-4, placeholders that look like values:**
  - "₹" becomes a fixed prefix inside the field, with an empty value;
  - the placeholder is lighter and clearly an example ("e.g. 250"), or there is none.
- **PP-forms-5, Request leave:**
  - show the balance ("Leave left: 2 days · comp leave 1") above the dates;
  - show the computed length ("3 days") under the range.
- **PP-forms-6:** the helper under "Assign to" becomes one short line ("They mark it done."). The freelancer rule goes in the guide.
- **PP-forms-7:** New project in 3 steps (major change 2):
  - **1 Basics:** start from a template, name, repeats;
  - **2 Deliverables & stages;**
  - **3 Preview & create.**
  - One primary per step; back goes to the previous step (§14.2).
  - One "Start from a template" button opens the browser and shows the chosen template as a chip.
- **PP-forms-8:** custom-field labels use the built-in label style. Don't change the text.
- **PP-forms-9:** keep Add someone's radio cards as the pattern for either/or choices.
- **PP-sheet-4:** the row ⋯ bottom sheet on a phone uses 44 px rows, the same list-item style as More, and a title line.
- **FINAL §6:**
  - the slimmer top bar and the bell (major change 9);
  - Help reachable in 2 taps or fewer.
- **FINAL §5:** the one row anatomy, a shared component that B and C reuse.

### B: client work, Templates, Settings, People, person page, Reports
- **PP-project-1 / PP-phone-7:** a single cycle shows as a plain month label. The ‹ › switcher appears only with 2 or more cycles.
- **PP-project-2:** custom fields flow into the same Details grid cells.
- **PP-project-3:** group names keep the ellipsis in the collapsed row, with the full text when expanded (the truncation rule).
- **PP-project-4:** slightly less gap between the ring's segments, so it reads as one ring.
- **PP-phone-4:** empty values read "Not added" everywhere (not "None").
- **PP-client-1:** the bar's measure and the text's measure must agree. Label the bar ("94% of stages") or base both on one measure. A cancelled or closed-only cycle doesn't show a near-full bar.
- **PP-client-2:** 100% done but still "In progress" shows "Ready to complete" (amber).
- **PP-client-3:** Admin and Primary contact become a compact two-column "Key people" strip.
- **PP-clients-1:** the Owner's Clients list adds open deliverables and progress (as the Admin's got in V3).
- **PP-admin-10:** tables use the width:
  - size columns to content;
  - add the column the role lacks: Clients gets next due / late count; People for an Admin gets "Today" status (available / on leave / busy);
  - or cap the table width and use the space for a side summary.
- **PP-people-1:** the second line under a name shows the job title, or nothing, never the role again.
- **PP-people-2:** Name gets more weight, Email is muted, and status chips are aligned.
- **PP-admin-11:** People for an Admin defaults to Active, with a quiet "Show all" toggle.
- **PP-settings-1:** shorten the "Templates" description so it isn't cut off.
- **PP-settings-2:** "Help and troubleshooting" moves into a "Help" group, or lives in the sidebar only.
- **PP-admin-9:** Settings groups are named by what the reader sees:
  - an Admin sees "Team" → Notifications, "Lists and fields", "Templates";
  - a group with one item folds into its neighbour.
- **PP-templates-1:** presets get Preview too, so every row follows one pattern.
- **PP-templates-2:** the archive-box icon for Archive (done in 6a; verify).
- **PP-admin-12:** the Owner's templates seen by an Admin show "by ‹Owner name› · view only" and keep Preview.
- **PP-reports-1 / PP-admin-5:** the summary strip (major change 7).
  - This month: days worked vs expected, decisions waiting, overtime notes, expenses to pay.
  - Reuse the existing month-report reads; no new tables.
  - Metrics with no data collapse into one muted line.
- **PP-person-1:** the History clock in the person page header.
- **PP-person-2:** one details card in the shared field grid.
- **PP-person-3:** for the Owner, the first tab opens with a summary (today's status, days waiting for review, leave left) before Profile (major change 8).
- **PP-person-4:** the person page's day sheet gets the same actions as Approvals: Approve (Forest) and Correct, plus the same context (week, comp leave, note).
- **PP-sheet-1, deliverable sheet:**
  - History uses the clock;
  - the last-change line is shortened to "Last change · Prishit ticked Shoot Planning · 21 Oct".
- **PP-sheet-2:** until every stage is ticked, the action is "Next: ‹stage›". Mark done becomes solid green only when ready.
  - If an override is allowed, it sits in ⋯ with a confirm ("1 stage isn't ticked").
  - This applies to the row ⋯ menu too.
- **PP-sheet-3:** the "Close deliverable…" trigger is red text. The confirm's dismiss reads "Keep it".

### C: light theme, phone items, Me, Alerts, empty and no-access states
- **PP-light-1 / major change 4:**
  - light depth on every route, sheet, dialog, table and empty state;
  - a cream page and white cards;
  - no `#FFFFFF` page backgrounds.
- **PP-light-2:** calendar leave stripes get more contrast, in light only.
- **PP-light-3:** check AA contrast for every chip tint in light.
- **PP-light-4:**
  - the phone calendar's day area must not scroll inside the page; let the page scroll;
  - the "+ New task on ‹day›" pill gets bottom spacing above the nav.
- **Major change 5:** calendar chips use a dot plus a tint, no `border-l-*` stripes (day-agenda, day-detail, month-grid, timeline).
- **PP-phone-1 / PP-admin-7:** "Help" in the phone More sheet, under Me.
- **PP-phone-2 / PP-admin-1:** the calendar day area keeps only the "‹Name› · Leave" chip. Drop the "On leave: ‹Name›" line, and use "You" for the reader.
- **PP-phone-3:** the outline follows the tapped day only.
- **PP-crew-1:** Attendance & leave leads with a balance strip:
  - leave taken this month;
  - comp leave available, with its expiry.
- **PP-crew-3:** the no-access page on a phone:
  - keeps the standard header, titled "No access";
  - its button reads "Back to ‹role's home›", e.g. "Back to My Day".
- **PP-crew-4 / PP-me:** "How MaxOff works" stays easy to find (Me → Help).
- **PP-crew-5:** a calendar empty day shows the reader's own leave or holiday state ("You · On leave").
- **PP-crew-9:**
  - the leave table's hint "This leave has ended. Ask the Owner to correct it." appears once, under the table;
  - a Cancelled reason gets its own muted line under the dates.
- **PP-crew-10:** with zero claims, Expenses offers "Add expense" inside the empty state as the primary action.
- **PP-me-2:** avatars get a 1 px ring and an initials fallback in the token colours.
- **The Me restructure:** section 3.
- **PP-alerts-1:** the row's time renders from the stored timestamp ("6:00 pm").
- **PP-alerts-2:** unread rows are one surface step lighter.
- **FINAL §7:** empty states teach and offer the one action. The no-access page keeps the header.

---

## 5. Rules for every builder
- **Engineering rules:** CLAUDE.md applies in full (§14.1 mobile standard, §14.2 navigation, colour rule, traced `loading.tsx`, JS budgets never raised, no new reads in shared layouts).
- **Speed gate (owner, comment 6332543899):** no new reads in shared layouts. The JS budgets in `bundle-budget.json` are not raised.
- **Before finishing:** `pnpm check`, plus the touched Playwright specs at desktop, 375 and 430, with 375/430 back-gesture specs for any changed overlay.
- **Guide:** update its text for every changed role. `guide:screenshots` runs once, at the integration step, not per builder.
- **Commits:** commit after every item or small group of items.
