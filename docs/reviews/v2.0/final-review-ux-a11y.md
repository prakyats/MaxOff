# MaxOff v2.0 release review: UX copy, accessibility, design-system consistency

Release candidate: `phase-v2` at `bafd6f45`, diffed against `origin/main` (`git diff origin/main...HEAD -- src`).
Static review from source only (nothing run, nothing edited). Paths are relative to the checkout
`C:/Users/ASUS/AppData/Local/Temp/claude/508d9f1f5ad435b4/ea770483-9990-482d-8bc8-b4cbf9e4045e/scratchpad/rc`.

Scope actually read: `core/ui/theme/*` (Appearance sheet, trigger, quiet theme change, options, menu, provider),
`core/ui/shell/more-sheet.tsx`, `core/ui/primitives/{dropdown-menu,sheet,skeleton}.tsx`,
`core/ui/composites/{approval-group-skeleton,list-row,status-badge}.tsx`, `core/ui/navigation/{attributes,pre-hydration}.ts`,
`core/ui/connection/offline-banner.tsx`, `core/notifications/components/push-banner.tsx`, calendar `calendar-screen.tsx` / `month-grid.tsx`,
client-work `item-sheet.tsx` / `item-row-menu.tsx` / `project-menu-dropdown.tsx` / `domain/hold.ts`, tasks `task-menu.tsx`,
`app/(app)/clients/[id]/**` (layout, loading, project-list, project loading), `app/(app)/today/**`, `my-day/page.tsx`,
`tasks/(list)/page.tsx`, `tasks/[id]/page.tsx`, the guide content diff, and `app/globals.css` tokens (unchanged in this release).

Verdict: **no wrong or misleading copy, no colour-rule breach, no new hard-coded colour, no new truncation.**
One real accessibility gap (focus return from the new Appearance sheet); the rest is polish or an owner choice.

---

## Must-fix before release

### M1. Appearance sheet does not return focus to the "Appearance" row when it closes
- `src/core/ui/theme/appearance-trigger.tsx:27-44`, `src/core/ui/theme/appearance-sheet.tsx:34-39`
- The sheet is opened by state from a plain `<button>`, not through `SheetTrigger`. Radix's modal dialog content
  (`@radix-ui/react-dialog` 1.1.x, `dist/index.mjs:154-157`) always does `event.preventDefault(); context.triggerRef.current?.focus()`
  on close; with no `Dialog.Trigger` the ref is null, so the default "return to the previously focused element" is cancelled and
  nothing is focused. After choosing Light/Dark/System, or closing with X / Escape / back, a keyboard or screen-reader user is
  dropped at the top of the More sheet (its focus scope catches the orphaned focus) instead of on the row they opened.
  `SheetContent` exposes `onCloseAutoFocus` through `...props` (`src/core/ui/primitives/sheet.tsx:95`), but the Appearance sheet passes none.
- Impact is limited (phone-only control, Owner and Admin, keyboard or switch/screen-reader users), but it is the one outright
  focus-management failure in the diff and the fix is invisible.
- Fix: keep a ref on the trigger button in `AppearanceTrigger`, pass it to `AppearanceSheet`, and on `SheetContent` add
  `onCloseAutoFocus={(event) => { event.preventDefault(); triggerRef.current?.focus(); }}`. Add one assertion to the existing
  Appearance spec (`e2e/back-gesture.spec.ts:928+`): after choosing, `document.activeElement` is `[data-slot="appearance-trigger"]`.
- If the release cannot take it, record it in PROGRESS "Ideas / tech debt" (the same gap exists for every sheet opened by state, pre-existing).

---

## Polish (safe, invisible or near-invisible)

### P1. Appearance options are `role="radio"` without radio keyboard behaviour
- `src/core/ui/theme/appearance-sheet.tsx:50-61`
- Three `<button role="radio">` inside `role="radiogroup"`, each in the tab order, no arrow-key handling. Operable (Tab + Enter/Space),
  names and `aria-checked` are correct, but a screen reader announces "radio button, 1 of 3" and then arrow keys do nothing, and the
  sheet opens on the first row rather than the ticked one.
- Fix (either): add roving tabindex (`tabIndex={chosen ? 0 : -1}`) with Up/Down moving focus only (selection stays on Enter/Space, since
  selecting closes the sheet); or drop the radio roles and use plain buttons with `aria-current="true"` on the chosen row.

### P2. The new sheet has no reduced-motion handling, where the menu it replaced had one
- `src/core/ui/primitives/sheet.tsx:93` (`slide-in-from-bottom-10` / `slide-out-to-bottom-10`, 200 ms), `src/app/globals.css:970-975`
- On a phone the old Light/Dark/System dropdown kept "fade only" under `prefers-reduced-motion` (globals.css:970). `Sheet` has no such
  rule, so the Appearance sheet slides 2.5 rem for reduced-motion users. Pre-existing for all sheets; new for this control.
- Fix: in globals.css add `@media (prefers-reduced-motion: reduce) { [data-side="bottom"][role="dialog"] { --tw-enter-translate-y: 0 !important; --tw-exit-translate-y: 0 !important; } }`
  (key on `data-side`, not `data-slot`: see P3).
- The theme change itself is fine: `quietThemeChanges` (`src/core/ui/theme/quiet-theme-change.ts:25-33`) switches transitions off for the
  change, so there is no fade in either motion setting.

### P3. `[data-slot="sheet-content"]` CSS never matches a named sheet (same bug class as the dropdown fix in this release)
- `src/core/ui/primitives/sheet.tsx:91-96` sets `data-slot="sheet-content"` before `{...props}`; `appearance-sheet.tsx:37` (and
  `more-sheet.tsx:111`, `review-sheet.tsx:56`, `push-banner.tsx:202`, eight more) pass their own `data-slot`, which replaces it.
  The one rule keyed on it, `globals.css:408` (`overscroll-behavior: contain`, "sheets never chain their scroll"), therefore applies to
  none of them. No effect on the three-row Appearance sheet; a real gap on long sheets.
- v2.0 fixed exactly this for `DropdownMenuItem` (`dropdown-menu.tsx:113-116`, `data-action` for callers). Fix the same way later:
  set the slot last in `SheetContent` and give callers a second attribute, or key the CSS on `[role="dialog"][data-side]`.
  Not for this release (touches every sheet's selectors and specs): PROGRESS tech debt.

### P4. My Day's "On hold · n" line is a hand copy of Tasks' `MoreLink`
- `src/app/(app)/my-day/page.tsx:166-175` duplicates `MoreLink` (`src/app/(app)/tasks/(list)/page.tsx:522-533`) class for class, and
  hard-codes `"/tasks/all?state=on_hold"` where Tasks has `ON_HOLD_HREF` (`tasks/(list)/page.tsx:54`).
- Fix: move `MoreLink` and `ON_HOLD_HREF` to a shared place (`core/ui/composites` for the link; the href beside `onHoldLine` in
  `modules/tasks/domain/hold.ts`) and use both from My Day. No visual change.

### P5. The amber hold callout now exists as three hand-written copies
- `src/modules/client-work/components/item-sheet.tsx:394-401` (new), `project-hold-banner.tsx:49-54`, `src/modules/tasks/components/task-hold.tsx:86`:
  the same `border-border bg-attention-soft ... rounded-lg border px-3 py-2.5 text-sm` box with `PauseIcon text-attention mt-0.5 size-4`.
- Fix: one `HoldCallout` composite in `core/ui/composites` (icon + children + optional action). No visual change.

### P6. Client header fallback hand-rolls a skeleton
- `src/app/(app)/clients/[id]/(tabs)/layout.tsx:51-53`: `bg-muted inline-block h-5 w-16 rounded-full ... motion-safe:animate-pulse` typed out
  because `Skeleton` is a `<div>` and the description is a `<p>`. Same classes as the primitive, so it is consistent today, but it will
  drift. Fix: let `Skeleton` take `as="span"` (or export its class string) and use it here and in the text-shaped bars
  (`clients/[id]/(tabs)/loading.tsx:55`, `me/guide/loading.tsx:17`, `reports/loading.tsx:48`, `settings/loading.tsx:23,53,99`).

### P7. Stale comment
- `src/core/ui/theme/appearance-trigger.tsx:16-17` says the trigger is also "Me's icon button". Me still uses `ThemeToggle`
  (`src/app/(app)/me/page.tsx:271`). Correct the comment (or see N2).

---

## Needs owner (changes what people see)

### N1. Held deliverable stages are dimmed twice: 3.1:1 in light, 3.9:1 in dark
- `src/modules/client-work/components/item-sheet.tsx:668-674` adds `text-muted-foreground` to the stage list when the project is on hold;
  each stage button is also `disabled` then (`rules.ticks` is false when held, `domain/views.ts:221`) and carries `disabled:opacity-70` (line 695).
- Computed from the tokens (`globals.css:148,170` light; `267,280` dark), stage names on the sheet surface:
  muted alone 6.04:1 (light) / 6.45:1 (dark); muted at 70 % opacity **3.13:1 (light) / 3.85:1 (dark)**.
- Disabled controls are exempt from WCAG 1.4.3, so this is not a formal failure, but the stage names and which are ticked are what a
  person opens a held deliverable to read, and the guide tells them to ("its stages are greyed out").
- Fix (pick one, owner's eye): keep the muted colour and cancel the opacity for the held case
  (`current.onHold && "text-muted-foreground [&_button:disabled]:opacity-100"`), giving 6:1 in both themes and still clearly "waiting".
  Check the held task's stages the same way so the two stay alike.

### N2. Two different Appearance choosers on a phone
- Owner/Admin: More → Appearance row → the new bottom sheet (16 px rows, tick on the right, "Follows this device's setting" under System;
  `appearance-sheet.tsx:62-83`). Everyone, Crew included: Me → Appearance → the sun/moon icon button → the dropdown drawn as a phone
  menu sheet (`me/page.tsx:258-273`, `theme-menu.tsx`), whose helper line reads "Light, dark or follow the system."
- Not a bug (the dropdown only misbehaved inside the More sheet), and the guide describes both correctly. For one look and one wording,
  Me's card could become an `AppearanceTrigger` row. That changes Me's phone layout, so it needs the owner's OK; otherwise leave it and
  only align the helper wording ("Light, dark or follow this device's setting.").

### N3. Guide wording: "you are told when he does"
- `src/modules/guide/domain/content/admin.ts` (pre-existing sentence in the hold topic: "The Owner can hold your clients' projects too; you
  are told when he does."). Not changed in this diff; the new paragraph beside it says "yours or one the Owner held". If the guide should
  stay role-worded: "you are told when that happens." Owner's call, copy only.

---

## Verified, no action

**UX copy**
- "On hold" is spelled one way everywhere touched: chip `ON_HOLD_CHIP` via `OnHoldBadge` (`status-badge.tsx:131-141`), "On hold · n"
  (`modules/tasks/domain/hold.ts:84-86`), "Put on hold…" / "Resume" / "Resume…" (`task-menu.tsx:120-127`), and the two notes
  "The project is on hold: ticks and Mark done wait until it is resumed." (`client-work/domain/hold.ts:56-57`) and
  "Start, Done and the stage ticks wait until the task is resumed." (`tasks/domain/hold.ts:117`). No "paused"/"held" label on a screen.
- `tasks/[id]/page.tsx:363` now shows the hold note to every viewer; the guide text for Owner, Admin and Crew was updated to match.
- No literal "Staff" typed into any changed screen or guide line (the only hit is the screenshot key `staff/my-day-on-hold`, not shown).
- Appearance sheet: title "Appearance", options "Light / Dark / System", "Follows this device's setting"; the More row reads
  "Appearance · Dark" or "Appearance · System (Dark)" (`theme-label.tsx:36-39`), and that is also the trigger's accessible name.
- No `truncate`, `line-clamp` or ellipsis added anywhere in the diff; the new lines use `break-words`.
- Guide additions ("Tap anywhere on a row, its chips included", "If you tap a day while the calendar is still loading, it opens as soon
  as it's ready", More → Appearance) describe what the code does.

**Accessibility**
- Appearance trigger: real `<button>`, `aria-haspopup="dialog"`, `aria-expanded` (`appearance-trigger.tsx:29-31`), 48 px row
  (`more-sheet.tsx:26` `min-h-12`), focus ring. Sheet: Radix dialog with `SheetTitle` + sr-only `SheetDescription`, a labelled Close
  button (`sheet.tsx:104-110`), decorative handle `aria-hidden`, option icons and tick `aria-hidden`, rows `min-h-11` at 16 px.
- Contrast (computed from `globals.css`, no token changed in this release): hold note text on `--attention-soft` 16.1:1 light /
  12.8:1 dark; its amber icon 5.6:1 / 8.3:1; muted helper text on the sheet 6.0:1 / 6.5:1. The amber is never alone: icon plus words.
- Skeletons: `ApprovalRowSkeletons` rows are `<li aria-hidden>` inside the real `<ul>` (`approval-group-skeleton.tsx:44-48`,
  `owner-today.tsx:306-318`); `ClientWorkRowsSkeleton` is `aria-hidden` (`client-work-skeleton.tsx:12`); the client Overview loading
  screen is `role="status" aria-busy="true"` with every block `aria-hidden`, including the transparent placeholder words
  (`clients/[id]/(tabs)/loading.tsx:20-29,55`). All pulses are `motion-safe:`.
- Held taps (`pre-hydration.ts:132-144`): works from the `click` event, so keyboard (Enter/Space) and screen-reader activation take the
  same path as a touch; the tap is replayed once with `el.click()` when the button is `data-live`, dropped after 2 s, never replayed on a
  submit button or inside a form/commit footer (`NEVER_HELD`), and never swallows a nested control. The calendar buttons keep their
  labels and `aria-pressed`. There is no announcement while a tap waits (up to 2 s); acceptable, and the guide now says so.
- `list-row.tsx:110`: the opener's `::after` lifted over chips; focus ring unchanged; actions stay above (z-10).

**Colour rule (ADR-0015)**
- No new solid action anywhere in the diff. Appearance rows are neutral; "On hold" is amber `attention` with a word (and icon in the
  note), never red; no `destructive`/red class added. The item sheet still has one commit per layer (unchanged).

**Design system**
- No hex/rgb/arbitrary px colour or spacing added. Both new "On hold" placements use the single `OnHoldBadge`
  (`project-list.tsx:75-77`, `item-sheet.tsx:381-382`); held wins over "Ready to complete" on the project row.
- Skeletons trace their screens: project row (`min-h-16`, `flex-[1_1_6rem]` title column, 20/16/16 px lines, chip `h-5 w-16 rounded-full`
  + chevron in the trailing group, as `project-list.tsx:36-83`); Today client-work rows (44 px column, 20/16 px lines, optional meter,
  `h-11 md:h-8` button, as `today-client-work.tsx:80-115`); Needs-you rows reuse the existing row skeleton per group with the real count.
- `THEME_OPTIONS` is shared by the laptop menu and the phone sheet (`theme-options.ts`), so order and labels cannot drift.
