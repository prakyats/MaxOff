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
| Red | `danger` (= `brand`, `destructive`) | `#C42126` | `#F2686D` | act now, a limit passed (overdue, rejected, absent, escalated, not noted past its reminder), and destructive actions |
| Amber | `attention` | `#AD5009` | `#FBBF24` | soon or at risk: due today, waiting 1–3 days, a late start, something waiting for the Owner |
| Blue | `info` | `#1D4ED8` | `#7DA2FF` | in progress, new, unread: work in motion only |
| Green | `success` | `#047857` | `#34D399` | done, approved, present, active |
| Grey | `neutral` | `#52525B` | `#A1A1AA` | nothing to do: zero, closed, archived, cancelled (C5), past, plain labels |
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

### The action colour rule (option A)
| Variant | Look | Used for |
|---|---|---|
| `primary` | **neutral solid** (`primary`: `#18181B` with `#FAFAF9` text; inverted in dark) | **the one commit action per layer**: Save, Send, Create, Approve, Mark done. Disabled is muted, never faded |
| `danger` | **solid red** (`destructive-solid`: `#C42126` with white text, both themes) | **the commit of a destructive action**, named for it: "Discard changes", "Remove Diwali", "Withdraw request", "Reject claim", "Deactivate Ravi". Only inside its confirmation |
| `destructive` | red outline and red text | a destructive action **before** its confirmation (Deactivate, Cancel leave, Withdraw, Reject…, Close, Cancel task) |
| `secondary` | neutral outline (`control-border`, ≥ 3:1) | Cancel, Keep editing, Review, Edit, Correct, the pager |
| `ghost` | no fill | icon and utility buttons |
| `strong` | neutral solid | a trigger that opens a form or a confirmation where the commit happens (a FAB, Approvals' Approve and Approve all) |

- **One solid button per layer.** A layer is the screen, each dialog, each sheet and each floating
  sticky bar. At most one `primary` or `danger` per layer, and never beside a `strong`.
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
- **Archive is not destructive** (owner, 2026-10-16: "archive never red"): it can be restored, so
  its question commits with `primary`.
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
  the top edge: the back chevron (none on a tab's first screen), the title, the record's ⋯ and the
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
- Laptop: one page grid at the content's full width (V3); compact rows (32 px controls). Phone:
  16 px side gutters, 44 px targets, bottom sheets, a sticky primary action, cards instead of
  tables (ARCHITECTURE §14.1).

- **Toasts (P3):** bottom-centre on laptop and phone (a surface-2 card), never over the page
  header. On a phone they sit above the bottom nav, the home indicator and the offline/push bands,
  and above whatever is docked there: the FAB, a floating save bar (its measured height) and the
  Select bar (`--app-bulk-bar-h`); one variable, `--app-toast-bottom` in `globals.css`, places them.

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
list as they do (PROGRESS, Ideas / tech debt). V2 took it from 50 files to 21: the calendar's five
(V3), the bottom bar's 11 px labels (they must fit a fifth of a 375 px bar at 200% text; V3–V5
settle them) and the fifteen by nature. New tokens on the way: `scrim` (the veil behind a dialog, sheet or
phone menu sheet: 10% black light, 30% dark), `logo-foreground` (the logo tile's white M), the
`hairline-b` utility (a sticky table header's rule) and `--app-top-bar-h`. Emails (HTML mail clients have no CSS variables) and
the theme-colour metas are exceptions by nature and stay listed.
