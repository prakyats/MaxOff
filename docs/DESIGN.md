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

- **Weights:** 400 for text, 500 for labels and buttons, 600 for titles and the one figure. No
  700+ in the app (the logo is the brand, not type).
- **Numbers** are tabular everywhere (`tabular-nums` on `body`): counts, dates, times, amounts.
- **Long names** follow one rule: left-aligned, at most two lines, then an ellipsis (full text
  on hover or tap); never centred inside a chip.

## 3. Surfaces and elevation: four steps, one shadow each
Depth comes from the surface step first and a hairline second; the shadow only confirms it. In
dark, a higher step is a lighter graphite, because shadows barely read on black.

| Step | Surface token | Light | Dark | Shadow token | Used for |
|---|---|---|---|---|---|
| 0 Page | `surface-0` (= `background`) | `#FAFAF9` | `#0B0B0C` | none | the page |
| 1 Raised | `surface-1` (= `card`) | `#FFFFFF` | `#141416` | `shadow-raised` (= `shadow-sm`, `shadow`) | cards, the sidebar, grouped lists |
| 2 Floating | `surface-2` | `#FFFFFF` | `#18181B` | `shadow-floating` (= `shadow-md`) | menus, popovers, tooltips, toasts, a floating sticky bar |
| 3 Modal | `surface-3` | `#FFFFFF` | `#1C1C1F` | `shadow-modal` (= `shadow-lg`, `shadow-xl`) | dialogs and sheets |

- `popover` keeps its v1.7 values (`#FFFFFF` / `#141416`) until V2 moves menus and sheets onto
  steps 2 and 3 (and re-checks `muted` fills on them in dark).
- `muted` / `secondary` / `accent` (`#F2F1EF` / `#1F1F23`) are quiet fills (hover rows, active
  nav), not elevation. `border` / `input` (`#E7E5E4` / `#26262A`) are hairlines.
- Text: `foreground` (`#18181B` / `#FAFAF9`) and `muted-foreground` (`#71717A` / `#A1A1AA`,
  ≥ 4.5:1 on the page and on every surface).
- No other shadows: no `shadow-xs`, `shadow-2xl`, `shadow-inner`, no `shadow-[…]` (lint).

## 4. Colour: red is urgent or destructive only (ADR-0015)
**One meaning per colour, the same on every screen.**

| Tone | Token | Light | Dark | Means |
|---|---|---|---|---|
| Red | `danger` (= `brand`, `destructive`) | `#C42126` | `#F2686D` | act now, a limit passed (overdue, rejected, absent, escalated, not noted past its reminder), **cancelled** (final; owner correction 2026-10-21, reversing C5), and destructive or final actions |
| Amber | `attention` | `#AD5009` | `#FBBF24` | soon or at risk: due today, waiting 1–3 days, a late start, something waiting for the Owner |
| Blue | `info` | `#1D4ED8` | `#7DA2FF` | in progress, new, unread: work in motion only |
| Green | `success` | `#047857` | `#34D399` | done, approved, present, active |
| Grey | `neutral` | `#52525B` | `#A1A1AA` | nothing to do: zero, closed, archived, past, plain labels |
| Holiday green | `holiday` | `#15803D` | `#4ADE80` | a holiday on the calendar (decision 25), never a status |
| Weekly off | `off-day` | `#0369A1` | `#7DD3FC` | the calendar's weekly-off date number, never red |
| Logo | `logo` | `#C42126` | `#C42126` | the logo tile only (a fixed brand asset) |

- Each tone has a `*-soft` background (12% over the light surface, 18% over the dark) whose text
  reads at ≥ 4.5:1; `status-badge.test.ts` reads `globals.css` and fails below that.
- **Status → colour is one map:** `STATUS_TONES` and `attendanceStatus` in
  `src/core/lib/status-tones.ts` (B13). A screen asks for a tone from a status (`statusTone`), a
  domain function or `StatusBadge` / `StatusDot`; it never types a colour of its own.
- **How colour shows:** a dot, coloured text or a thin row edge, never a filled red block.
  **Colour is never alone**: always a word or an icon ("Overdue · 2 days"). Counts take the colour
  of their worst item; zero is always grey. The most urgent rows sort first.
- **Raw colours are not allowed** in screens: no hex, `rgb()`, `hsl()`, `oklch()`, no Tailwind
  palette colours (`bg-red-500`, `text-white`), no `bg-[#…]` (lint). A new colour is a token here
  first.

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
  sheet with the same actions as full-width rows (Move up / Move down keep it open).
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
| `radius-sheet` | `rounded-sheet` (= `rounded-xl`) | 12 px | dialogs, sheets, large panels |
| full | `rounded-full` | round | chips, pills, dots, avatars |

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
- **Long names (F) everywhere:** left-aligned, two lines at most, then an ellipsis; never centred in a
  chip.

- **Toasts (P3):** bottom-centre on laptop and phone (a surface-2 card), never over the page
  header. On a phone they sit above the bottom nav, the home indicator and the offline/push bands,
  and above whatever is docked there: the FAB, a floating save bar (its measured height) and the
  Select bar (`--app-bulk-bar-h`); one variable, `--app-toast-bottom` in `globals.css`, places them.

- **Settings (V4).** **N3:** the Settings page is four groups (Company and working days, Lists and
  fields, Templates, Integrations), each a quiet heading over one bordered list; every row is the
  section's name over one line saying what it holds, on a phone and a laptop alike (two groups to a
  row from `lg`). **D6, one list pattern:** "Add ‹thing›" on the list's heading (C4); each row's
  actions are Edit · Delete (`ListRowActions`: grey icons from `md`, one ⋯ sheet on a phone), plus a
  labelled **Preview** at every width where there is something to look at (templates). **Delete is
  the existing archive** (no Archived list; the toast "‹name› deleted" offers Undo for 6 s where
  unarchive exists; records that carry it keep it); the row's icon stays grey, and the
  confirmation's named commit ("Delete ‹name›") is red like every final action (owner correction
  2026-10-21); a deliverable template still asks its reason (invariant 9). The word "Archive" leaves these pages
  (it stays in code, DB and docs). **The one Templates page (6b.6 owner note):** Stage presets →
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
