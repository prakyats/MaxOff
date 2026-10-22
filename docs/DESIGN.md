# MaxOff design

> The one design brief for MaxOff (v1.8 "Settings and colours" onwards). It replaces the colour,
> type, radius and shadow text that used to live in ARCHITECTURE §3.3 and §14.1; those sections
> now point here and keep the rest (layout, the mobile standard, navigation, tap feedback).
> The direction was settled by the owner on 2026-10-16 ("all as recommended"; PROGRESS "Release
> order after v1.7.1"), the colour code by ADR-0015 (ROADMAP 6b.8, option A).
> Tokens live in `src/app/globals.css` (`:root` light, `.dark` dark) and reach Tailwind through
> `@theme`. Lint holds screens to them (`maxoff/design-tokens`, below).

## 1. Direction
- **The feel: "Vercel's clarity with Linear's calm", in MaxOff red.** Traits only, never a copy
  of either brand: clear hierarchy, quiet surfaces, hairlines over boxes, one strong thing per
  screen, nothing that moves without a reason.
- **Premium through restraint.** Graphite and bone surfaces, generous space, and red only where
  it means something (§4). Pixora Clips' brand is red `#C42126`, white and black.
- **Compact on a laptop, comfortable on a phone.** A laptop shows more rows at 14 px with 32 px
  controls; a phone shows fewer, larger rows at 16 px with 44 px targets (ARCHITECTURE §14.1).
  Density follows the device, never the role.
- **Calm, functional motion only** (§7): motion explains a change (a sheet arriving, a page
  sliding in, a tick landing); it never decorates.
- **Both themes are equal.** Every token has a light and a dark value designed together, every
  contrast check runs in both, and the owner's checks look at both.
- **Geist** (UI) and **Geist Mono** (data) through `next/font`. Nexa and Robot Heroes are logo
  and marketing faces only.
- **First glance, then depth** (PRODUCT §2): a screen's first view answers the role's question;
  detail is one tap deeper.

## Decisions (v1.8 V5b, the premium polish; issue #89, owner 2026-10-21/22)
These win over anything below that disagrees (the earlier sections are brought into line as V5b
lands). Precedence: the owner's later rulings (the truncation rule, the Me restructure, the nine
approved major changes, change 6) win over the FINAL UI DECISIONS, which win over any earlier
polish item (`docs/reviews/v18-polish/SCOPE.md`). The approved sample for the nine changes is
`docs/design/v18-major-changes-sample.html` (each change's real screen before and the target after, with
a Dark/Light toggle).

### FINAL UI DECISIONS (issue #89, comment 6322652532)
1. **Hierarchy, on every screen.** One clear first thing: the title plus a one-line context (the
   date on Today / My Day; "client · repeat" on a project). The role's question is answered in the
   first viewport. Exceptions get rows; the normal case collapses to a count or a muted line.
   **Empty sections never take a heading**: one muted line, or nothing (`EmptyRow`). One solid
   button per layer (the colour plan); everything else is outline or quiet.
2. **Surfaces and depth, in both themes.** The page is surface-0; cards and rows are surface-1
   with a hairline border; overlays are surface-2/3, one shadow per step. The sidebar is a second
   neutral one step off the page (cooler in dark, warmer in light), so it reads as chrome. **Light
   gets the same depth as dark**: card borders visible at about 1.15:1, cards carry the raised
   shadow, the page tint distinct from the cards. No card inside a card: sections separate by
   spacing and headings, not by boxing everything.
3. **Type.** Geist only, on the scale 12/14/16/18/20/24. Page title 24/semibold; section heading
   14/semibold with a muted "· n" count; body 14; meta 12, muted. Numbers that are the point
   (attendance tiles, ring %, report figures) are one step up and tabular.
4. **Colour and state.** The approved colour plan: red final or urgent actions, Forest approve,
   neutral commit, outline secondary; status chips red, amber, blue, green, grey. Text colour
   alone never carries status: always a chip, or a dot plus a word. **No thick left-edge accent
   stripes** on calendar chips and agenda rows (`border-l-4` / `border-l-2` in day-agenda,
   day-detail, month-grid, timeline): a small leading type dot plus the soft tinted fill. Red only
   where the plan says; today is a red circle on the date plus a neutral tint on the cell.
5. **Rows and lists: one row anatomy app-wide** (`ListRow`, `core/ui/composites/list-row.tsx`): the
   title (one line, an ellipsis only where a tap opens the full text), a muted meta line, then on
   the right the chips, then › (with ⋯ before › when the row has actions). The chat count is a
   small muted badge **next to the title**, never among the chips. Overdue and due text becomes a
   chip; a risk reason becomes a chip plus plain text.
6. **Headers and navigation.** Detail header (`DetailHeader`): back · title · status chip, then on
   the right the History clock, then ⋯ (the person page too). Laptop: the page's one primary action
   sits in the header's action area (e.g. Crew's Mark done); phone: a sticky bottom bar. The laptop
   top bar is slimmer (about 56 px): the bell, theme and avatar, no empty band. Help is reachable
   in two taps or fewer for every role: the laptop sidebar foot plus the profile menu; the phone's
   More / Me.
7. **Empty, loading, no-access.** Empty states teach and offer the one action ("Add expense"
   inside it). The no-access page keeps the header, names what was blocked, and its button goes to
   the role's home. Skeletons trace the new layouts (a Definition of Done rule).
8. **Wide screens.** When a list has three rows or fewer on a laptop, the right column holds "This
   week" (due dates plus own leave) on My Day, My tasks and Today instead of blank space (within
   major change 1's conditions below).
9. **Motion.** State transitions of 150–250 ms only (a sheet in or out, a row expanding, a toast).
   No page-load choreography.

### The truncation rule (owner, comment 6322342277)
- **Where a tap opens more** (an expandable row, a chip that opens a sheet, a calendar item that
  opens the day, a tab or row that drills down): the first view stays **one line with an
  ellipsis**, and the opened view **always shows the full text**.
- **Where nothing opens further** (the final detail view, a dialog body, a details field, a
  sheet's content): **never truncate**; wrap as needed.
- Withdrawn: PP-phone-5 and the min-width part of PP-project-3. Instead, expanded rows, checklists
  and the deliverable sheet show every group and stage name in full.
- **Audit:** every ellipsis in the app sits on something that opens to the full text. An ellipsis
  on an element that opens nothing is a bug. (This replaces "two lines, then an ellipsis" in §2 and
  §6 where they disagree.)

### The nine major changes, all approved (comments 6331638458, 6331819942, 6331870421)
1. **Today and My Day:** the date line under the title; empty sections collapsed to one quiet line;
   larger attendance figures with the tiles keeping their current width (bigger numbers only, not
   a wider bar); risk chips; a laptop **"This week"** column of **at most 25–30% of the content
   width** (e.g. `minmax(260px, 28%)`), two columns **only at a content width of 1200 px or more**;
   below that "This week" moves **under** "Overdue and risks" as a full-width section, never a
   squeezed third column and never hidden.
2. **New project in 3 steps** (PP-forms-7): 1 Basics (start from a template, name, repeats), 2
   Deliverables & stages, 3 Preview & create; one primary per step; back goes to the previous step
   (§14.2); one "Start from a template" button opens the browser and shows the chosen template as
   a chip.
3. **Me restructure**, every role, laptop and phone, in this order: identity header (photo with a
   ring and an initials fallback, name, role and sign-in email, Edit profile; one block); My work
   (Admin, Crew); Your freelancers (an Admin who coordinates one); Notifications (Turn on here,
   Your devices each with Remove, Send a test notification); Appearance (Light / Dark / System);
   Help (How MaxOff works, Reload app); Sign out of this device last, a red outline button with a
   confirm (nothing is destroyed); the version in small muted text at the very bottom.
4. **Light-theme depth, the same on every screen** (many of the team use light; it must not feel
   too bright): a warm cream page (about `#F6F5F2`), white cards with a hairline border and a soft
   shadow, the sidebar one tone darker, **no pure `#FFFFFF` page background anywhere**; every
   route, sheet, dialog, table and empty state is checked in light.
5. **Calendar chips:** a dot plus a tint, no side stripe.
6. **Date and time fields, option C, labelling only** (`DateInput` / `TimeInput`,
   `core/ui/primitives/date-time-input.tsx`): the native device and browser pickers and the
   current form layouts stay; only how a chosen value reads changes: a date reads `Thu 22 Oct`
   (the year only when it is not the current year), a time `6:00 pm` (the B1 formatter); empty,
   the field says `Choose a date` / `Choose a time`. **No** quick-pick buttons, no custom calendar
   popover, no layout change (PP-forms-2 dropped; PP-forms-1 replaced). Keyboard entry and the
   native picker keep working; a screen reader hears the full date (`Thursday 22 October 2026`).
   Every date and time input in the app.
7. **Reports summary strip** (PP-reports-1, PP-admin-5): this month's days worked against
   expected, decisions waiting, overtime notes and expenses to pay, from the existing month-report
   reads (no new tables); a metric with no data collapses into one muted line.
8. **Person page summary-first** (PP-person-2/3); the same header and summary pattern wherever a
   record has a summary.
9. **Slimmer top bar plus one row layout** (FINAL 5 and 6). **The bell:** the app's outline bell
   icon at 20 px; the count a small pill **offset to the top-right, outside the glyph**, with a
   2 px ring in the bar's background colour; capped at "99+" (`BellCount`).

### Sheets and dismiss buttons (PP-forms-3, PP-sheet-4)
- On a phone a sheet's ✕ and its grab handle are the dismiss: the way out in a dialog footer
  (marked `data-dismiss`: `AlertDialogCancel`, `ReasonDialog`'s, `DialogFooter`'s Close, every
  form's Cancel) is a quiet muted text button under the commit, keeping its 44 px target
  (`MODAL_FOOTER`, `modal-surface.ts`); from `md` it is the dialog's outline button. A new dialog
  marks its way out `data-dismiss=""`.
- A destructive confirmation's dismiss says what it keeps: `ConfirmDialog` and `ReasonDialog`
  default to "Keep it" when `destructive` ("Close" when there is nothing to commit).
- The row ⋯ bottom sheet on a phone uses 44 px rows in More's list-item style (12 px in, a 12 px
  gap to a 20 px icon, the card's rounded tint), under a title line over a hairline: every row ⋯
  passes `title` (the record's name) to `DropdownMenuContent`.

### Sample fidelity (SCOPE §6, owner 22 Oct)
The tokens in `globals.css` are the approved samples' own values: the `.mx` / `.mx.light` blocks of
`docs/design/v18-major-changes-sample.html` (the calendar sample uses the same block), with the
project-page sample's sheet shadow. `status-badge.test.ts` ("sample fidelity") pins them. Where a
sample value fails AA in the app's real compositions, the nearest passing value is kept and
flagged here:

| Flag | Sample | Kept | Why |
|---|---|---|---|
| Light green chip ink (`success`) | `#15803D` | `#157E3C` | `#15803D` on the green tint `#E6F4EA` is 4.42:1; `#157E3C` is 4.53:1. The Forest approve button stays `#15803D` (white on it is 5.0:1). |
| Light count red (`brand`) | `#D92D34` | `#C42126` | white on `#D92D34` passes (4.8:1), but `brand` is also a chip ink and reads 4.20:1 on its tint `#FDECEC`; `#C42126` reads 5.1:1. |
| Dark count red (`brand`) | `#E5484D` with white numerals | `#F2686D` with near-black numerals | white on `#E5484D` is 3.91:1, and as a chip ink it reads 4.13:1 on `#3A1517`. |
| Placeholders | `faint` (`#8B8B93` / `#6B6B73`) | `muted-foreground` | placeholder text is text: `faint` is 3.4–3.5:1. `faint` is used for the row's › only. |
| Chat: others' bubbles on the laptop panel, light (V5b E) | `--s3` (`#FFFFFF`) on the panel's `--s1` (`#FFFFFF`) | `muted` (`#EEEDE8`) from `md` | white on white has no edge; the phone's feed is the page (`background`), where `surface-3` shows, so the phone keeps the sample's value; dark keeps `surface-3` everywhere. |
| Chat: the group's time (V5b E) | `faint` | `muted-foreground` | text, as for placeholders. |
| Chat: Send on a laptop (V5b E) | solid `--primary` | solid only when the screen holds no next-step solid; else the neutral outline | one solid commit per layer (colour rule): the header's next step is already solid. The phone's Chat view is its own layer, so Send is solid there. |
| Chat: the first bubble's top corner (V5b E) | the sample's CSS rounds it (16 px), but its name line defeats `:first-child` for others' groups | rounded on both sides | the sample's evident intent; joined corners are 6 px. |

The mocks' type sizes (13 px body, 12.5 px meta, 11.5 px chips) are the sample drawn at a reduced
scale inside a frame; the app keeps the approved scale of FINAL 3 (12/14/16/18/20/24).

### The V5b shared foundations (where they live)
| Pattern | Use |
|---|---|
| Light depth (major change 4) | tokens in `globals.css`; a grouped list or card is `bg-card shadow-raised` + hairline (`ListRows`, `Card`); a list inside a sheet or dialog stays flat |
| The one row (FINAL 5) | `ListRow` / `ListRows` / `ListRowsSkeleton`, `ChatCount` (`core/ui/composites/list-row.tsx`) |
| The detail header (FINAL 6) | `DetailHeader` / `PageHeader`'s `status`, `history`, `primary` (`page-header.tsx`) |
| The top bar's bell (change 9) | `TopBar` + `NavBadgeMark` place `topbar` |
| Dates and times (change 6) | `DateInput` / `TimeInput` / `DateTimeInput` (`core/ui/primitives/date-time-input.tsx`), labels from `core/time/field.ts` |
| An empty section (FINAL 1, 7) | `EmptyRow` (`empty-state.tsx`); a whole empty list keeps `EmptyState` |
| Today / My Day's columns (change 1) | `DayColumns` + `ThisWeek` (`modules/dashboards`, `day-blocks.tsx`): a container query, two columns only from a 75rem (1200 px) content width, "This week" `minmax(260px, 28%)`; `PhoneDateLine` for the phone's date |
| A page's primary in the header (FINAL 6, PP-crew-8) | `DetailHeader`'s `primary`; with `primaryOwnBar` the same element is the phone's sticky bar (`StickyActions`), so its dialogs mount once |
| A stepped form (change 2) | New project: each later step a `useOverlayHistory` layer over the one before, Back via `closeOverlaysThen`; one primary a step (Next, then the commit) |
| Waiting words (FINAL 4) | from a day a dot plus the word (amber, red from three), never colour alone (`ApprovalGroup`, `ApprovalPersonRow`) |

## 2. Type: six steps, nothing under 12 px
Tailwind's own names, so a class says its step. Nothing else: no `text-[…]` sizes, no `text-3xl`
or above (lint).

| Step | Class | Size / line | Used for |
|---|---|---|---|
| Caption | `text-xs` | 12 / 16 px | meta lines, chips, timestamps, counts, helper text |
| UI | `text-sm` | 14 / 20 px | the laptop's body: rows, buttons, labels, menus |
| Body | `text-base` | 16 / 24 px | the phone's body, every input (iOS zooms below 16 px) |
| Section | `text-lg` | 18 / 28 px | a card's or a section's title |
| Title | `text-xl` | 20 / 28 px | a page title |
| Display | `text-2xl` | 24 / 32 px | one large figure ("68%", a count tile) |

- **One exception under 12 px:** `text-count` (11 / 11 px, semibold) is the bell's count pill and
  nothing else (owner, #89 comment 6338991185: a 16 px pill, so one digit makes a circle). Every
  other count (bottom bar, sidebar, sheet) stays `text-xs`.

- **Weights:** 400 for text, 500 for labels and buttons, 600 for titles and the one figure. No
  700+ in the app (the logo is the brand, not type).
- **Numbers** are tabular everywhere (`tabular-nums` on `body`): counts, dates, times, amounts.
- **Long names** follow the truncation rule (§Decisions): one line with an ellipsis only where a
  tap opens the full text; wrapped in full where nothing opens further; never centred inside a
  chip.

## 3. Surfaces and elevation: four steps, one shadow each
Depth comes from the surface step first and a hairline second; the shadow only confirms it. In
dark, a higher step is a lighter graphite, because shadows barely read on black.

| Step | Surface token | Light | Dark | Shadow token | Used for |
|---|---|---|---|---|---|
| 0 Page | `surface-0` (= `background`) | `#F6F5F2` (warm cream; V5b) | `#0B0B0C` | none | the page |
| 1 Raised | `surface-1` (= `card`) | `#FFFFFF` | `#131315` | `shadow-raised` (= `shadow-sm`, `shadow`) | cards and grouped lists (`bg-card shadow-raised` + hairline) |
| 2 Floating | `surface-2` | `#FFFFFF` | `#1A1A1D` | `shadow-floating` (= `shadow-md`) | menus, popovers, tooltips, toasts, a floating sticky bar |
| 3 Modal | `surface-3` | `#FFFFFF` | `#222226` | `shadow-modal` (= `shadow-lg`, `shadow-xl`) | dialogs and sheets |

- `popover` is step 2 (`#FFFFFF` / `#1A1A1D`), the sample's sheet surface.
- **The sidebar** (`sidebar`, `#EFEEE9` / `#0F0F11`) is chrome, a second neutral one step off the
  page: warmer and darker in light, cooler in dark, under the cards (V5b, FINAL 2); its active item
  `sidebar-accent` is the sample's `s3` (`#FFFFFF` / `#222226`).
- `muted` / `secondary` / `accent` (`#EEEDE8` / `#1F1F23`) are quiet fills (hover rows, active
  nav), not elevation. `border` / `input` (`#E3E2DD` / `#25252A`) are hairlines (about 1.3:1 on a
  card). The raised shadow is the approved sample's: light `0 1px 2px` + `0 4px 14px` at 6%; dark a 3% white top edge + `0 6px 18px` at 35% black. The modal shadow is the project-page sample's sheet shadow.
- **No pure white page** anywhere (V5b major change 4): white is a card or an overlay, never the
  page. `status-badge.test.ts` holds the three layers apart and their text at AA.
- Text: `foreground` (`#18181B` / `#EDEDEE`) and `muted-foreground` (`#62626A` / `#9D9DA5`,
  ≥ 4.5:1 on the page, every surface, the quiet fills and the sidebar). `faint` (`#8B8B93` /
  `#6B6B73`) is for decorative marks only (a row's ›), a 3:1 graphic, never text.
- No other shadows: no `shadow-xs`, `shadow-2xl`, `shadow-inner`, no `shadow-[…]` (lint).

## 4. Colour: red is urgent or destructive only (ADR-0015)
**One meaning per colour, the same on every screen.**

| Tone | Token | Light | Dark | Means |
|---|---|---|---|---|
| Red | `danger` (chips and red text; `brand` `#C42126` / `#F2686D` for counts; `destructive`) | `#B42318` on `#FDECEC` | `#FF8A8F` on `#3A1517` | act now, a limit passed (overdue, rejected, absent, escalated, not noted past its reminder), **cancelled** (final; owner correction 2026-10-21, reversing C5), and destructive or final actions |
| Amber | `attention` | `#8F5400` on `#FDF3E2` | `#F5B55A` on `#33240E` | soon or at risk: due today, waiting 1–3 days, a late start, something waiting for the Owner |
| Blue | `info` | `#2952CC` on `#E9EFFD` | `#8FB0FF` on `#18203A` | in progress, new, unread: work in motion only |
| Green | `success` | `#157E3C` on `#E6F4EA` (flagged, see §Decisions) | `#5FD497` on `#10291C` | done, approved, present, active |
| Grey | `neutral` | `#62626A` on `#EFEFEF` | `#9D9DA5` on `#232327` | nothing to do: zero, closed, archived, past, plain labels |
| Holiday green | `holiday` | `#15803D` | `#4ADE80` | a holiday on the calendar (decision 25), never a status |
| Neutral, striped | `leave` (+ `leave-soft`, `leave-stripe`, utility `leave-stripes`) | `#62626A` on `#F1F1F2`, stripes `#EFEFEF` | `#9D9DA5` on `#27272A`, stripes `#232327` | leave on the calendar: the month's bar ("Asha · On leave", the palm icon) and the day's chips, a soft neutral bar with faint diagonal stripes, apart from every task type's colour (PP-calendar-3, 10), never a status |
| Today lift | `today` (= `surface-3`) | `#FFFFFF` + `shadow-raised` | `#222226` | today's whole box on the calendar, under the red circle on its date: a faint neutral lift one surface step above the other days, never a red wash and never the weekly off's `muted` tint (PP-calendar-15, replacing PP-calendar-12's faint red); normal, grey and holiday text on it keeps 4.5:1, never a status |
| Logo | `logo` | `#C42126` | `#C42126` | the logo tile only (a fixed brand asset) |

- Each tone has a `*-soft` background (the samples' chip tints) whose text reads at ≥ 4.5:1, and
  the ink reads at ≥ 4.5:1 on the page and the card too; `status-badge.test.ts` reads `globals.css` and fails below that.
- **Status → colour is one map:** `STATUS_TONES` and `attendanceStatus` in
  `src/core/lib/status-tones.ts` (B13). A screen asks for a tone from a status (`statusTone`), a
  domain function or `StatusBadge` / `StatusDot`; it never types a colour of its own.
- **How colour shows:** a dot, coloured text or a thin row edge, never a filled red block.
  **Colour is never alone**: always a word or an icon ("Overdue · 2 days"). Counts take the colour
  of their worst item; zero is always grey. The most urgent rows sort first.
- **Raw colours are not allowed** in screens: no hex, `rgb()`, `hsl()`, `oklch()`, no Tailwind
  palette colours (`bg-red-500`, `text-white`), no `bg-[#…]` (lint). A new colour is a token here
  first.

- **The calendar's marks (V5b, PP-calendar-1..8, owner 2026-10-21):** today is a filled `brand`
  red circle on its date number and its whole box one surface step up, `bg-today shadow-raised` (PP-calendar-15), the selected
  day the outlined box; the weekly off's date number is `muted-foreground` and its box tinted
  `bg-muted/50` (blue means in progress); weekdays read "Mon Tue …" on a laptop, single letters on a phone. One chip look for the month and the day's
  dialog (`calendar-chip`): an event in its type's colour (tint and left edge), the title before
  the time; what is due by name in `attention` (amber) or `danger` (red, overdue) with its clock or
  alert icon and the type's colour on its edge; leave in `leave` with the palm icon; done dimmed
  with a small ✓, never struck through.

### The action colour rule (option A, with the approved colour plan of 2026-10-21)
**The colour plan (owner-approved 2026-10-21, "colour plan approved with forest"; ADR-0015
amendment):** four looks for buttons, five tones for status chips, one meaning each.

| Variant | Colour | Use |
|---|---|---|
| `danger` (solid) | red `#C42126`, white text | final / irreversible: Close deliverable, Cancel project / task, Reject (leave, attendance, expense, suggestion), Revoke comp leave, Cancel approved leave, Deactivate, Withdraw invite, Remove device, Discard changes, Delete |
| `approve` (solid) | **Forest green `#15803D`**, white text, the same in both themes (5.0:1) | positive final decisions: Approve, Approve all, Mark done, Grant comp leave |
| `primary` (solid) | neutral (ink on light, light on dark) | everyday commits: Save, Create, Send, Start day |
| `secondary` (outline) | quiet | second choices: Review, Edit, Correct, Request changes, Send back, Keep it / a dialog's dismiss |

| Chip tone | Statuses |
|---|---|
| red | Overdue / Late, Cancelled, Rejected, Absent |
| amber | Proposed, Waiting for you, Due soon, Nearly done |
| blue | In progress, Open, Planned, Noted |
| green | Done, Approved, Present, Active |
| grey | Draft, Archived, Withdrawn, Replaced, Not started |

Chips are a soft background with strong text, per theme (the tokens above). `STATUS_TONES`
holds the map; `status-badge.test.ts` checks the table and the contrast in both themes, and
`final-actions.test.ts` checks every confirmation's commit by its label (final → `danger`,
Approve / Mark done / Grant → `approve`, a red "Cancel …" never dismissed by a bare "Cancel").

| Variant | Look | Used for |
|---|---|---|
| `primary` | **neutral solid** (`primary`: `#18181B` with `#FAFAF9` text; inverted in dark) | **the everyday commit**: Save, Send, Create, Start day. Disabled is muted, never faded |
| `approve` | **Forest green solid** (`approve`: `#15803D` with white text, both themes) | **a positive final decision**: Approve, Approve all, Mark done, Grant comp leave. `ConfirmDialog` / `ReasonDialog` take `approve`; a trigger that only opens the commit's layer (Approve all, a task's Mark done, the bulk bar's Mark N done, Grant comp leave) passes `opens` |
| `danger` | **solid red** (`destructive-solid`: `#C42126` with white text, both themes) | **the commit of a destructive action**, named for it: "Discard changes", "Remove Diwali", "Withdraw request", "Reject claim", "Deactivate Ravi". Only inside its confirmation |
| `destructive` | red outline and red text | a destructive action **before** its confirmation (Deactivate, Cancel leave, Withdraw, Reject…, Close, Cancel task) |
| `secondary` | neutral outline (`control-border`, ≥ 3:1) | second choices: Keep it, Keep editing, Review, Edit, Correct, Request changes, Send back, the pager |
| `ghost` | no fill | icon and utility buttons |
| `strong` | neutral solid | a trigger that opens a form or a confirmation where the commit happens (a FAB, New task, Add person) |

- **One solid button per layer.** A layer is the screen, each dialog, each sheet and each floating
  sticky bar. At most one `primary`, `approve` or `danger` commit per layer, and never beside a
  solid trigger (`strong`, or an `approve` marked `opens`). Approvals: each group's "Approve all"
  is the green trigger, its rows' Approve quiet outlines.
- **Dismiss buttons say what they keep** ("Keep it", "Keep project", "Keep task"), never a bare
  "Cancel" beside a red "Cancel …".
- **The Add pattern for Settings lists (C4, decided in V2).** Every list on a Settings screen
  (Job titles, Expenses' categories, Holidays, Task types, Stage presets, Custom fields' groups,
  the three template groups) adds the same way: **"Add ‹thing›"**, a `secondary` outline button
  with a plus that names the thing ("Add job title", "Add holiday", "Add project template"), at the
  right end of the **list's heading row** (`ListHeading` + `ListAddButton`, `core/ui/composites/
  list-rows.tsx`), one per list or group. It opens the add dialog (a bottom sheet on a phone),
  whose commit is the `primary` "Add ‹thing›". Never a solid Add, never a floating Add on a Settings
  screen, never an inline add form; an empty list's empty state names the same button and adds no
  second one. Outside Settings a screen's main creation stays the page action (`strong`, the FAB
  on a phone: New task, Add person, New project).
- **Settings rows** (`ListRowActions`, C3/P2): from `md` up, grey icon buttons (Move up / Move down
  when the list has an order, Edit or Rename, Archive); on a phone one 44 px ⋯ opening a bottom
  sheet with the same actions as full-width rows (Move up / Move down keep it open). **The Owner's
  Delete** (templates and stage presets, V5a 6b, owner 2026-10-22) is last: permanent, so red before
  its confirmation too (`destructive`: a red outline bin on a laptop, a red outline "Delete" row in
  the sheet); its confirmation (`TemplateDeleteDialog`) says exactly what happens and commits with
  the red `danger` "Delete ‹name›", way out "Keep it". Admins and Crew never see it. **Delete of what was never used** (task types, job titles, expense categories, custom fields; a draft client's and a contact's ⋯, V5a 6c) uses the same red Delete; its confirmation (`UnusedDeleteDialog`) asks first and, for anything in use, shows only the plain reason "In use — archive it instead." and "Close", with no commit (`ConfirmDialog` `confirmHidden`).
- **Confirmations name the action** ("Deactivate Ravi", "Approve 3", "Discard changes"), never
  "OK", "Yes" or "Confirm". `ConfirmDialog` and `ReasonDialog` take `destructive` for a destructive
  act: their commit is then `danger`, otherwise `primary`.
- **Final actions are red** (owner correction 2026-10-21): Close deliverable, Cancel project / task,
  Reject, Revoke, Cancel approved leave, Deactivate, Withdraw (an invite, a claim, a request), Remove
  (a device, a holiday, a stage), Discard and Delete commit with the red `danger`
  (`destructive`). A unit test (`final-actions.test.ts`) sweeps every `ConfirmDialog` /
  `ReasonDialog` call site by its commit label, so none can silently be neutral.
- **Archive is not destructive** (owner, 2026-10-16: "archive never red"): it can be restored, so
  its question commits with `primary` (the same test keeps it so).
- **Archive and Remove are grey everywhere** (C3): a `ghost` icon in a row, a `secondary` button
  in a sheet or a footer ("Remove photo", a device's Remove), a plain menu item ("Remove stage").
  The red appears only in the confirmation step, on the named `danger` commit ("Remove Diwali",
  "Remove Chrome on Android"); a remove with no confirmation (a stage in an unsaved form) is never
  red.
- **Red elsewhere, only where it means "act now":** error text, always with an icon (`ErrorText`);
  the navigation count badges; the Owner's Today problem lines ("2 are absent today ›") and a risk
  row's "overdue by …" line, each with a dot and words; an approval waiting three days or more.
  Red is never decorative, never a selected state, never the focus ring.
- **Neutral, always:** the focus ring (`ring` = `foreground`, 2 px with an offset), caret,
  `accent-color` and `::selection`, selected tabs, the active nav item, a selected radio or
  checkbox (`strong`), a ticked stage.
- **Enforcement:** the lint rule `BUTTON_COLOUR_SELECTORS` (no colour classes on a button outside
  `core/ui/primitives`), the lint rule `maxoff/design-tokens` (§8), and the e2e fixture
  (`e2e/fixtures.ts`, every spec) that fails a test whose layer ever shows two solid commits or a
  commit beside a `strong`.

### Progress (P4)
- **One bar:** `ProgressBar` (`core/ui/progress/segmented-meter.tsx`), a 6 px continuous track:
  done in `success`, the next step in `success` at 35%, the rest `neutral-soft`, whatever the
  number of steps (a row of dots or segments is never drawn for a list). Its numbers and words
  sit beside it ("2/3", "68%"); it is decorative (`label={null}`) where they already say it.
- **The ring** stays the cycle's figure on its project page (segments up to 48 steps).
- Never red: lateness is said by the row's words and its dot (§4), not by the bar.

## 5. Radii: four
| Token | Class | Value | Used for |
|---|---|---|---|
| `radius-control` | `rounded-control` (= `rounded-sm`, `rounded-md`) | 6 px | buttons, inputs, selects, small chips' squares, menu items |
| `radius-card` | `rounded-card` (= `rounded-lg`, `rounded`) | 10 px | cards, list groups, banners |
| `radius-sheet` | `rounded-sheet` (= `rounded-xl`) | 14 px (the sample's sheet) | dialogs, sheets, large panels |
| full | `rounded-full` | round | chips, pills, dots, avatars |

Chat only (V5b E, the approved chat sample): `rounded-bubble` (16 px, a message bubble; a group's joined corners are `rounded-control`) and `rounded-composer` (22 px, the message field).

No `rounded-xs`, `rounded-2xl` and above, no `rounded-[…]` (lint).

## 6. Spacing and layout
- A 4 px grid (Tailwind's spacing scale); hairline borders; **dashed borders mean "empty" only**.
- **One header bar on a phone (L4):** the page's own title bar (`PageHeader`), 44 px, sticky at
  the top edge: the back chevron (on a top-level tab instead the small MaxOff mark, which goes home
  by replace, adding no history; owner 2026-10-21, V4), the title, the record's ⋯ and the
  bell. No brand bar above it (home is the bottom bar's first tab; Me is in the bar or More), and
  nothing slides away. The screen's main creation stays the FAB above the bottom bar. The laptop
  keeps its top bar (bell, theme, account) beside the sidebar.
- **⋯ menus are bottom sheets on a phone (L5):** every `DropdownMenu` below `md` is a full-width
  sheet at the bottom edge (surface step 3, `rounded-sheet` top corners, a grab handle, the scrim,
  the record's name as its title when the menu passes `title`, 44 px rows at 16 px, clear of the
  home indicator). From `md` up it is a floating menu (surface step 2). Pure CSS (`globals.css`), so
  the lazily loaded menus cost nothing more; back closes it first like any layer (§14.2 a).
- **Tables scroll with the page (L2):** no inner scroll box; from `lg` the header row sticks under
  the top bar (`DataTable`). A phone shows cards instead of a table.
- **One page grid (L1, V3).** Every page's content takes the main column's full width (the shell's
  `main`, up to 80rem beside the sidebar): lists, boards, cards, a project's month bar, progress and
  Details all share the deliverables list's width, so no section stops short of another. A page
  never sets its own `max-w-*`. **Running text** (a description, a note, a paragraph of help) takes
  the `reading` utility (`globals.css`, at most 70 characters a line) inside that width. Dialogs and
  sheets keep their own sizes. V4's pages (Settings, People, Reports, Me, Alerts) adopt the same
  grid by dropping their `max-w-*` (done in V4; the guide's reading column stays).
- Laptop: compact rows (32 px controls). Phone: 16 px side gutters, 44 px targets, bottom sheets, a
  sticky primary action, cards instead of tables (ARCHITECTURE §14.1).
- **Bottom-bar labels (V3):** 12 px (`text-xs`, the scale's minimum), one line. Each of the five
  cells is a size container: when a cell is narrower than 3rem (system text at about 160% and above
  on a 375 px phone) its label leaves the picture and stays as the item's accessible name
  (`sr-only`, with its count's words), so the bar shows icons only rather than slivers of words; at
  130% the labels stay. Never two lines (the bar's height is fixed by the safe area and the FAB).

- **The project page (V3, the v1.8 sample and the long-stage-list fixes A–G).** Every section
  shares the full width (G). Beside the ring, **Needs you** (Owner and Admin only; Crew never see
  client work): a dot and a sentence per pill, late in `danger` ("Reel 1 is 1 day late"), nearly
  done in `attention` ("Interview 2: 1 stage left", "Reel 3: ready to mark done"), at most four and
  "+N more"; always drawn ("Nothing late or nearly done."), one line on a phone (the first pill and
  "+N more") so the page never moves. **Deliverable rows are collapsed by default (A):** name ·
  one continuous `ProgressBar` with "n/m" over every stage (C, never dots) · "Next: ‹stage›" on one
  line, cut with an ellipsis, the full name on hover (`title`) · planned date · action. The bar is
  the row's expand toggle, a view control (no history). **Opened (B, F):** each group under its
  heading and "n/m" (no heading for a single untitled group), a left-aligned checklist (tick box and
  name, two lines then an ellipsis) in three columns on a laptop, two on a tablet, one on a phone;
  ticked = filled `strong` box, **the next stage bold and outlined**, later ones muted; never a chip.
  For whoever edits the project, a long ungrouped list (9+ stages) adds "n stages: split them into
  groups?" with **Group stages** (D: the Admin picks each group's first stage and names it; never
  automatic), and two or more stages typed as numbered rounds add the tip to use "+ Another revision
  round" (E). **N5:** a row's action is "Next: ‹stage›" until every stage is ticked, then a neutral
  Mark done (Admin Today's Client work; the project page keeps Mark done in ⋯ until ready).
- **The project page matches the approved sample (owner 2026-10-21, V4; supersedes the rows above
  where they differ; the ring stays as built).** On a laptop the deliverables are a **table**: a
  header row (Deliverable · Progress by group · Next · Planned), then one row each: the name over
  "3 groups · 1 of 9 stages"; **one line per group** (its name, a segmented bar, a segment a stage,
  ticked green, and "n/m"; an untitled short list is one "Stages" line; the single continuous bar
  only for one long ungrouped list, fix C); the next stage as a **chip** in its own column, or, once
  every stage is ticked, **Mark done** there (the first ready row's in **Forest green**, the
  `approve` Button variant, token `--approve` #15803D, still one solid per layer; V5 extends it to
  Approve, Approve all and Grant comp leave); the planned date in its own column ("15 Oct · 1 day
  late" in red, "Not planned" muted); then ⋯ and ›. A phone keeps its cards with the same lines per
  group. **Needs you** beside the ring only when something is late or nearly done: nothing at all
  otherwise. **Details** is a full-width field grid (Repeats, Delivery date, Notes; then the
  project fields), a cell each, its small label over its value.
- **Long names (F) everywhere:** the truncation rule (§Decisions) replaces "two lines, then an
  ellipsis": one line and an ellipsis where a tap opens more, the full text where nothing does.

- **Toasts (P3):** bottom-centre on laptop and phone (a surface-2 card), never over the page
  header. On a phone they sit above the bottom nav, the home indicator and the offline/push bands,
  and above whatever is docked there: the FAB, a floating save bar (its measured height) and the
  Select bar (`--app-bulk-bar-h`); one variable, `--app-toast-bottom` in `globals.css`, places them.

- **Settings (V4).** **N3:** the Settings page is four groups (Company and working days, Lists and
  fields, Templates, Integrations), each a quiet heading over one bordered list; every row is the
  section's name over one line saying what it holds, on a phone and a laptop alike (two groups to a
  row from `lg`). **D6, one list pattern:** "Add ‹thing›" on the list's heading (C4); each row's
  actions are Edit · Archive (`ListRowActions`: grey icons from `md`, one ⋯ sheet on a phone), plus a
  labelled **Preview** at every width where there is something to look at (templates). **Archive**
  (V4 named it "Delete"; named Archive again with the archive box, owner 2026-10-21, PP-templates-2):
  the toast "‹name› archived" offers Undo for 6 s where unarchive exists, and **every list with Archive ends in a collapsed "Archived (n)"** (V5b-0 item 9, owner 2026-10-22; `ArchivedSection` / `ArchivedRow`, `list-rows.tsx`): hidden when nothing is archived, a native `<details>` (a view control, no history), each row the name muted with **Restore** (whoever may archive it) and the Owner's **Delete** (the list's own confirmation, which checks use first); records
  that carry it keep it; the row's icon stays grey, and the confirmation's named commit ("Archive
  ‹name›") is the neutral `primary` (archive is never red); a deliverable template still asks its
  reason (invariant 9). **The one Templates page (6b.6 owner note):** Stage presets →
  Deliverable templates → Project templates, a divider, then Task templates; one search across all
  four; one "Add …" per section. On a phone the four sections are a **segmented control** (a view
  control, no history; a muted track with the chosen segment raised; while a search is typed each
  segment shows its number of matches, so a hit is never hidden); `#presets` (the old Stage presets
  path redirects there by replace), `#deliverables`, `#projects`, `#tasks` pick a segment on
  arrival. **Thresholds (6b.6, P5):** first glance, then depth: each group (Working day, Tasks,
  Client work, Notifications; Approvals joins with 6b.5) is a bordered row with its name over a
  one-line summary of the saved values ("Not noted: remind every 2 h → Admin at 4 h → Owner at
  8 h"); a tap opens it in place (native `<details>`, a view control); a group with a refused field
  opens by itself; one Save stays in reach (the phone's bar, and sticky at the window's bottom on a
  laptop).
- **Short forms first (L9, V4):** New task asks the title, the people and the deadline; the rest sits
  under **More options** (a bordered native `<details>` row naming what it holds), with the same
  defaults; it opens by itself when needed (an event type, a refused field). New project gives each
  section one short line (the shared editors' extra hints off) and a real **Browse templates**
  button (secondary, with an icon), never text that looks like a link.
- **Words (W1–W4, V4):** "deliverables" wherever people read (never "items"); the bell's screen is
  **Alerts** and the profile is **Me** everywhere (the account menu says Me, then Help); a
  destructive question's way out names what is kept ("Keep project" beside "Cancel project"); a
  line is written for the person reading it (no "the Owner changes this" to the Owner).

## 6a. Patterns: one per concept (the consistency sweep, owner 2026-10-21, V5a)
The advisor's rules (the owner may adjust them on the walk). Each concept has **one** pattern;
the table lists every screen using it and what V5a changed (before → after).

| Concept | The one pattern | Screens | V5a: before → after |
|---|---|---|---|
| **History** | the clock icon labelled "History" (`HistoryButton`, `core/ui/composites/history-button.tsx`), 44 px, in the detail header just before ⋯; it opens the record's History in the same sheet (`HistorySheet` / `ReviewSheet`: bottom sheet on a phone, side panel from `md`), a layer back closes | project, deliverable sheet ("History" in its facts), task, client | project: aria-label "Activity" → "History", panel title "Activity" → "History"; task: the **Activity view** (Work · Chat · Activity · Details) → the header's History sheet (Work · Chat · Details), an old `?tab=activity` lands on Work with the sheet open; client: the **Activity tab** (Overview · Projects · Brand · Activity) → the header's History sheet (three tabs), the old `/clients/[id]/activity` redirects to `?history=1` (the sheet drops it by replace). Person: no per-person history is read today (none added; a new read is a later unit's) |
| **Detail header** | back · title · (status) · right side: History, then ⋯, then the bell | project, task, client | task and client gain History before ⋯; the bell wraps under them at 200 % (`flex-wrap`), as the project's did. Status placement (the project's and the task's state sit on the first-glance line under the header, the client's in the header's description) is unchanged: V5b's polish list decides |
| **Icons** | `ICONS` (`core/ui/icons.ts`): History = clock (`HistoryIcon`), Edit = pencil, Archive = box (`ArchiveIcon`), Remind = bell, Approve = check, Add = plus, More = ⋯ (`MoreHorizontalIcon`), Open = › | every screen | the card list's ⋯ (`data-table.tsx`) `EllipsisIcon` → `ICONS.more`; a task's Remind `BellRingIcon` → `ICONS.remind`; the History empty states and panel take `ICONS.history`. Guard: `icons.test.ts` (no synonym for More or Edit; History's clock and Remind's bell only from the map) |
| **Tabs / view controls** | one segmented control: a muted track (`bg-muted`, `p-1`, `gap-1`), 44 px cells, the chosen one raised (`bg-background` + shadow); `ViewLink` / `replace`, never history (§14.2 d) | client, person, leave, task views, calendar views, the Templates phone segments, **the project's months** | the project's cycle pager (two arrows round the name) → **month tabs** (previous · this · next, the sample's 08) |
| **List pages** | title + one-line purpose; the main "+ New …" top-right on a laptop, floating on a phone; filters in one row; headings "Name · n" | Tasks, Clients, People, Approvals | unchanged (already so) |
| **Rows** | the row opens on tap (›), secondary actions in ⋯; one row height per kind (`row-metrics.ts`) | lists, Settings rows | unchanged |
| **States and words** | chips only via `status-tones`, dates and times only via `core/time`, one `EmptyState`, "You", "deliverables", "Alerts", "Me" | every screen | the client History's empty state uses `EmptyState` with the map's clock |

## 7. Motion: calm
| Token | Value | Used for |
|---|---|---|
| `--motion-fast` | 120 ms | press and hover feedback, a tick |
| `--motion-base` | 200 ms | fades, a sheet or dialog arriving, a chip changing |
| `--motion-slow` | 260 ms | the phone's page slide, a progress fill |
| `--motion-ease` | `cubic-bezier(0, 0, 0.2, 1)` | everything (ease out: fast start, soft landing) |

- Nothing bounces, nothing loops except a spinner, nothing moves on its own.
- `prefers-reduced-motion`: movement goes, the state change stays (a press keeps its tint, a
  slide becomes a cut, a fill is static).
- Modal surfaces animate open and close and never transition (ARCHITECTURE §14.1).

## 8. Guard rails (lint)
`maxoff/design-tokens` (`eslint.config.mjs`, proved by `tests/lint-rules.test.ts` with the
`denied-design-*` fixtures in `tests/lint-fixtures/src/modules/tasks/components/`) fails any string in `src/` that carries:
- a raw colour: a hex value, `rgb()`/`rgba()`/`hsl()`/`hsla()`/`oklch()`/`oklab()`/`lab()`/`lch()`,
  a Tailwind palette colour (`bg-red-500`, `text-white`) or an arbitrary colour (`bg-[…]`);
- a one-off font size: `text-[…]` with a length, `text-3xl` and above;
- a one-off radius: `rounded-[…]`, `rounded-xs`, `rounded-2xl` and above;
- a one-off shadow: `shadow-[…]`, `shadow-2xs`, `shadow-xs`, `shadow-2xl`, `shadow-inner`.

The files that held exceptions when the rule landed (2026-10-20) are listed in
`DESIGN_TOKEN_EXCEPTIONS` in `eslint.config.mjs`; they move onto the tokens in V2–V4 and leave the
list as they do (PROGRESS, Ideas / tech debt). V2 took it from 50 files to 21, V3 to 15: the bottom bar's labels are 12 px with the
icon-only rule above, and the calendar's five are on the tokens; the fifteen left are exceptions by
nature. New tokens on the way: `scrim` (the veil behind a dialog, sheet or
phone menu sheet: 10% black light, 30% dark), `logo-foreground` (the logo tile's white M), the
`hairline-b` utility (a sticky table header's rule) and `--app-top-bar-h`. Emails (HTML mail clients have no CSS variables) and
the theme-colour metas are exceptions by nature and stay listed.
