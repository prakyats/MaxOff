"use client";

import { ChevronLeftIcon, ChevronRightIcon, SlidersHorizontalIcon } from "lucide-react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import {
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";

import { cn } from "@/core/lib/utils";
import { addISTDays, formatIST, istDayStart, type ISODate } from "@/core/time";
import { ViewLink } from "@/core/ui/composites/view-link";
import { replaceViewAddress } from "@/core/ui/navigation/view-address";
import {
  closeOverlaysThen,
  hasOpenOverlay,
  whenOnPageEntry,
} from "@/core/ui/overlay/overlay-history";
import { useIsDesktop } from "@/core/ui/viewport/use-desktop";

import {
  CALENDAR_VIEWS,
  type CalendarDay,
  type CalendarQuery,
  type CalendarScope,
  type CalendarView,
  calendarHref,
  dayHeading,
  emptyDay,
  filterCount,
  type MonthGrid as Grid,
  monthLabel,
  monthOf,
  weekLabel,
  weekOf,
} from "../domain/calendar";
import { shortcutFor } from "../domain/laptop";
import {
  type CalendarSize,
  directionOf,
  handleLabel,
  handleNext,
  OPENING_SIZE,
  sizeAfter,
  stepDate,
  swipeOf,
} from "../domain/size";
import { dayLabel } from "../domain/strips";
import { AllDayChips, DayDetail, eventLink } from "./day-detail";
import type { FilterChoices } from "./filters-sheet";
import { MonthGrid } from "./month-grid";
import { Timeline, weekdayHeading } from "./timeline";

/** The sheets load after the page, on their first opening (ARCHITECTURE §19). */
const DaySheet = dynamic(() => import("./day-sheet").then((module) => module.DaySheet), {
  ssr: false,
});
const FiltersSheet = dynamic(
  () => import("./filters-sheet").then((module) => module.FiltersSheet),
  { ssr: false },
);

const VIEW_LABELS: Record<CalendarView, string> = { day: "Day", week: "Week", month: "Month" };

const ICON_BUTTON =
  "focus-visible:ring-ring text-muted-foreground hover:text-foreground active:bg-muted flex size-11 shrink-0 items-center justify-center rounded-lg outline-none focus-visible:ring-2";

/**
 * The calendar (6.4b "Calendar rework"; Kickoff 6 decision 25, PRODUCT §4.8; decision 13 decides
 * what each role's days hold, the page reads them).
 *
 * **Phone** (below 768px): one calendar, no Day/Week/Month control. Three snap sizes (the week
 * strip with the day's detail; the compact month with thin bars and the detail, the opening size,
 * today selected; the full month with labelled strips), changed by a vertical swipe on the
 * calendar or on the 44px handle under it, or by tapping the handle. Left and right swipes (and
 * the header's arrows) move a week or a month; a tap selects a day, or in the full month opens the
 * day sheet. The header: the month's name, Today (a calendar icon with today's number) and
 * Filters. Every size fits the screen above the bottom bar and the page never scrolls (the owner's
 * phone walk, 2026-10-08; `data-fit-viewport="phone"`, globals.css): in the week and the compact
 * month the day's timeline fills what is left as the one scroll, a swipe that starts on it scrolls
 * it; the full month fills the screen.
 *
 * **Laptop** (768px and up): Day · Week · Month, opening on Month; Week and Day are hour
 * timelines that fill the viewport below the page's header (no page scroll, one scroll inside:
 * `data-fit-viewport="laptop"`, globals.css), opening at 08:00 or now; a month day, a week's heading or a
 * "Due · N" opens the day's popup (a compact agenda, "Open day"). The keyboard: ← and → move, T
 * goes to today, D, W and M switch the view (never in a field, with a modifier key or while an
 * overlay is open). The owner's laptop changes of 2026-10-08.
 *
 * The size, the selected day and the filters are **view state** (ARCHITECTURE §14.2 d): a day in
 * the month already read changes on the tap and writes the address by replace
 * (`replaceViewAddress`); another month, a view or a filter replaces the address through the
 * router; nothing adds history, so one back leaves the calendar (or closes the sheet on top).
 * Pull to refresh is off here (its swipes are the calendar's); refresh on return and Realtime
 * stay. Reduced motion: the size changes at once.
 */
export function CalendarScreen({
  today,
  query,
  scope,
  grid,
  days,
  free,
  choices,
  dayAction,
}: {
  today: ISODate;
  query: CalendarQuery;
  scope: CalendarScope;
  grid: Grid;
  days: readonly CalendarDay[];
  /** Each day's "Who's free" line (the Owner and Admins); null for Crew. */
  free: Readonly<Record<ISODate, string>> | null;
  choices: FilterChoices;
  /** The route's action for a day (New task on it, or Suggest a task), or none. */
  dayAction: ((date: ISODate) => ReactNode) | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [size, setSize] = useState<CalendarSize>(OPENING_SIZE);
  const [selected, setSelected] = useState<ISODate>(query.date);
  const [shownDate, setShownDate] = useState<ISODate>(query.date);
  const [sheetDate, setSheetDate] = useState<ISODate | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  // A new address from the server (another month, a view, a filter) brings its own day.
  if (shownDate !== query.date) {
    setShownDate(query.date);
    setSelected(query.date);
  }
  const byDate = useMemo(() => new Map(days.map((day) => [day.date, day])), [days]);
  const dayOf = (date: ISODate) => byDate.get(date) ?? emptyDay(date);
  const view: CalendarView = query.view ?? "month";
  const count = filterCount(query);
  // Week and Day fit the viewport on a laptop (one scroll, inside the timeline). The phone's sizes
  // always fit it (`data-fit-viewport="phone"` below).
  const fit = view !== "month";
  const desktop = useIsDesktop() === true;

  /**
   * Moves the selected day: in the month read, at once; another month through the router. While
   * a move is still under way (`pending`), the month on screen is not the one the calendar is
   * heading to, so every day goes through the router: its move replaces the one under way.
   * Written by hand instead, the address waited for that move, which then landed and took the
   * selected day with it (Next, then Today before the next month had arrived, stayed on the next
   * month: main CI run 37792867778, calendar.spec:240 [mobile]).
   */
  function go(date: ISODate) {
    const href = calendarHref({ ...query, date }, today);
    setSelected(date);
    if (!pending && monthOf(date) === grid.month) {
      replaceViewAddress(href);
    } else {
      startTransition(() => router.replace(href, { scroll: false }));
    }
  }

  /**
   * Replaces the address once every overlay entry is backed out: the sheet's own
   * (`closeOverlaysThen`), then any spent one under it, such as a select's sheet inside the
   * filters (`whenOnPageEntry`). A replace that ran earlier was undone by the last step back
   * (Next restored the page entry's old address); now the page's own entry keeps it and one
   * back still leaves the calendar.
   */
  function replaceOnPageEntry(href: string) {
    closeOverlaysThen(() =>
      whenOnPageEntry(() => {
        // Out of the popstate's own dispatch, so Next's restore of the entry comes first.
        window.setTimeout(() => startTransition(() => router.replace(href, { scroll: false })), 0);
      }),
    );
  }

  /** The filters as the sheet closed with them, applied when they changed. */
  function closeFilters(next: CalendarQuery) {
    setFiltersOpen(false);
    const href = calendarHref({ ...next, date: selected }, today);
    if (href === calendarHref({ ...query, date: selected }, today)) return;
    replaceOnPageEntry(href);
  }

  /** "Open day" (the laptop's day dialog): the dialog backs out, then the Day view replaces. */
  function openDay(date: ISODate) {
    replaceOnPageEntry(calendarHref({ ...query, view: "day", date }, today));
  }

  // The laptop's step follows its view: a day, a week or a month.
  const laptopStep = (direction: -1 | 1) =>
    view === "day"
      ? addISTDays(selected, direction)
      : view === "week"
        ? addISTDays(selected, 7 * direction)
        : stepDate(selected, 2, direction, today);

  /** A view of the laptop's, as view state (replace, never history; §14.2 d). */
  function switchView(next: CalendarView) {
    if (next === view) return;
    const href = calendarHref({ ...query, view: next, date: selected }, today);
    startTransition(() => router.replace(href, { scroll: false }));
  }

  // The laptop's keyboard (the owner's 2026-10-08 changes). Read through a ref, so the listener
  // is added once per layout and always acts on the screen as it is now.
  const keys = useRef<(event: KeyboardEvent) => void>(() => undefined);
  useEffect(() => {
    keys.current = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      const target = event.target instanceof Element ? event.target : null;
      const shortcut = shortcutFor({
        key: event.key,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        altKey: event.altKey,
        shiftKey: event.shiftKey,
        inField:
          target?.closest(
            'input, textarea, select, [contenteditable=""], [contenteditable="true"], [role="combobox"], [role="listbox"], [role="menu"]',
          ) != null,
        overlayOpen: hasOpenOverlay() || sheetDate !== null || filtersOpen,
      });
      if (!shortcut) return;
      event.preventDefault();
      if (shortcut.kind === "move") go(laptopStep(shortcut.direction));
      else if (shortcut.kind === "today") go(today);
      else switchView(shortcut.view);
    };
  });
  useEffect(() => {
    if (!desktop) return;
    const listener = (event: KeyboardEvent) => keys.current(event);
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, [desktop]);

  const action = (date: ISODate) => (dayAction ? dayAction(date) : null);
  const freeOf = (date: ISODate) => (free ? (free[date] ?? null) : null);

  // The phone's swipes, on the calendar (the grid or the strip) and on the handle under it:
  // vertical grows or shrinks, sideways moves a week or a month. A swipe that starts on the day's
  // timeline is the timeline's own scroll and never resizes. A swipe is not a tap: the click it
  // would end in is dropped. Once the finger has travelled a swipe's length the gesture is held
  // (pointer capture), so it ends here even when the finger lifts over the detail below; a shorter
  // wobble stays a tap on the day under it.
  const start = useRef<{ x: number; y: number } | null>(null);
  const swiped = useRef(false);
  function onPointerDown(event: PointerEvent<HTMLElement>) {
    start.current = { x: event.clientX, y: event.clientY };
    swiped.current = false;
  }
  function onPointerMove(event: PointerEvent<HTMLElement>) {
    const from = start.current;
    if (!from || event.currentTarget.hasPointerCapture(event.pointerId)) return;
    if (swipeOf(event.clientX - from.x, event.clientY - from.y) === null) return;
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function onPointerUp(event: PointerEvent<HTMLElement>) {
    const from = start.current;
    start.current = null;
    if (!from) return;
    const swipe = swipeOf(event.clientX - from.x, event.clientY - from.y);
    if (!swipe) return;
    swiped.current = true;
    const direction = directionOf(swipe);
    if (direction === null) setSize((current) => sizeAfter(current, swipe));
    else go(stepDate(selected, size, direction, today));
  }
  const swipes = {
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel: () => {
      start.current = null;
    },
    onClickCapture: (event: MouseEvent<HTMLElement>) => {
      if (!swiped.current) return;
      swiped.current = false;
      event.preventDefault();
      event.stopPropagation();
    },
  };

  function tapDay(date: ISODate) {
    if (size === 3) {
      if (monthOf(date) !== grid.month) {
        go(date);
        return;
      }
      // The sheet's entry goes on top: the address is not rewritten under it (back would bring
      // the old one back); the day is the sheet's, the selection follows it on screen.
      setSelected(date);
      setSheetDate(date);
      return;
    }
    go(date);
  }

  const week = weekOf(selected);
  const weekDays = Array.from({ length: 7 }, (_, offset) => dayOf(addISTDays(week.from, offset)));
  const filtersButton = (
    <button
      type="button"
      onClick={() => setFiltersOpen(true)}
      data-slot="calendar-filters-button"
      data-count={count}
      className={cn(
        "pressable focus-visible:ring-ring border-control-border hover:bg-muted flex min-h-11 shrink-0 items-center gap-1.5 rounded-lg border px-3 text-sm font-medium outline-none focus-visible:ring-2 md:min-h-8",
        count > 0 && "border-foreground",
      )}
    >
      <SlidersHorizontalIcon className="size-4" aria-hidden />
      {count > 0 ? `Filters · ${count}` : "Filters"}
    </button>
  );
  const todayButton = (
    <button
      type="button"
      onClick={() => go(today)}
      data-slot="calendar-today"
      aria-label={`Today, ${formatIST(istDayStart(today), "EEEE d MMMM")}`}
      className={cn("pressable", ICON_BUTTON)}
    >
      <span
        aria-hidden
        className="border-foreground relative flex h-6 w-6 flex-col items-center justify-end rounded-[0.3rem] border-2 pb-px text-[0.625rem] leading-none font-bold tabular-nums"
      >
        <span className="bg-foreground absolute inset-x-0 top-0 h-1" />
        {formatIST(istDayStart(today), "d")}
      </span>
    </button>
  );

  const laptopLabel =
    view === "day"
      ? dayHeading(selected, today)
      : view === "week"
        ? weekLabel(week)
        : monthLabel(grid.month);
  const unit = view === "day" ? "day" : view === "week" ? "week" : "month";

  return (
    <div
      data-slot="calendar"
      data-pending={pending ? "" : undefined}
      aria-busy={pending || undefined}
      className={cn(
        // Phone: grows into the route's column (`data-fit-viewport="phone"`, globals.css).
        "flex min-w-0 flex-col gap-3 transition-opacity max-md:grow max-md:basis-0",
        fit && "md:min-h-0 md:flex-1",
        pending && "opacity-70",
      )}
    >
      {/* Phone ------------------------------------------------------------------------------ */}
      <div
        data-slot="calendar-phone"
        data-size={size}
        // Every size fits the screen above the bottom bar (the owner's phone walk, 2026-10-08):
        // in the week and the compact month the header, the calendar, the handle, the day's title
        // and its all-day line stay put and the day's timeline fills the rest as the one scroll;
        // the full month fills it with no timeline.
        data-fit-viewport="phone"
        className="flex min-w-0 grow basis-0 flex-col gap-1 md:hidden"
      >
        <div data-slot="calendar-header" className="flex min-w-0 flex-wrap items-center gap-1">
          <button
            type="button"
            onClick={() => go(stepDate(selected, size, -1, today))}
            data-slot="calendar-prev"
            aria-label={size === 1 ? "Previous week" : "Previous month"}
            className={cn("pressable", ICON_BUTTON)}
          >
            <ChevronLeftIcon className="size-4" aria-hidden />
          </button>
          <h2
            data-slot="calendar-month-label"
            aria-live="polite"
            aria-label={monthLabel(monthOf(selected))}
            // One line, the short month ("Oct 2026"), so the header stays one compact row.
            className="flex-1 text-base font-semibold whitespace-nowrap"
          >
            {formatIST(istDayStart(monthOf(selected)), "MMM yyyy")}
          </h2>
          <button
            type="button"
            onClick={() => go(stepDate(selected, size, 1, today))}
            data-slot="calendar-next"
            aria-label={size === 1 ? "Next week" : "Next month"}
            className={cn("pressable", ICON_BUTTON)}
          >
            <ChevronRightIcon className="size-4" aria-hidden />
          </button>
          {todayButton}
          {filtersButton}
        </div>
        <div
          data-slot="calendar-area"
          {...swipes}
          className={cn(
            "flex min-w-0 touch-none flex-col select-none",
            size === 3 && "min-h-80 grow basis-0",
          )}
        >
          {size === 1 ? (
            <ol
              aria-label="Week"
              data-slot="calendar-week-strip"
              className="grid grid-cols-7 gap-1"
            >
              {weekDays.map((day) => {
                const chosen = day.date === selected;
                const busy =
                  day.holiday !== null ||
                  day.events.length +
                    day.busy.length +
                    day.leave.length +
                    day.due.length +
                    day.items.length >
                    0;
                return (
                  <li key={day.date} className="min-w-0">
                    <button
                      type="button"
                      onClick={() => tapDay(day.date)}
                      data-slot="calendar-strip-day"
                      data-date={day.date}
                      aria-pressed={chosen}
                      aria-current={day.date === today ? "date" : undefined}
                      aria-label={dayLabel(day, today)}
                      className={cn(
                        "pressable focus-visible:ring-ring flex min-h-14 w-full flex-col items-center justify-center gap-0.5 rounded-lg border px-1 py-1.5 outline-none focus-visible:ring-2",
                        chosen
                          ? "border-foreground bg-foreground text-background"
                          : "border-border/60 bg-card active:bg-muted/60",
                        day.date === today && !chosen && "border-foreground",
                      )}
                    >
                      <span
                        className={cn(
                          "text-[0.6875rem] leading-4 uppercase",
                          chosen ? "text-background/80" : "text-muted-foreground",
                        )}
                      >
                        {formatIST(istDayStart(day.date), "EEE")}
                      </span>
                      <span
                        className={cn(
                          "text-sm leading-5 font-semibold tabular-nums",
                          day.weeklyOff && !chosen && "text-off-day",
                        )}
                      >
                        {formatIST(istDayStart(day.date), "d")}
                      </span>
                      <span
                        aria-hidden
                        className={cn(
                          "size-1.5 rounded-full",
                          busy ? (chosen ? "bg-background" : "bg-foreground") : "bg-transparent",
                        )}
                      />
                    </button>
                  </li>
                );
              })}
            </ol>
          ) : (
            <MonthGrid
              grid={grid}
              days={byDate}
              today={today}
              selected={selected}
              density={size === 2 ? "compact" : "full"}
              onDay={tapDay}
              className={cn(size === 3 && "flex-1", "motion-safe:animate-in motion-safe:fade-in-0")}
            />
          )}
        </div>
        <button
          type="button"
          onClick={() => setSize((current) => handleNext(current))}
          {...swipes}
          data-slot="calendar-handle"
          aria-label={handleLabel(size)}
          className="pressable-row focus-visible:ring-ring text-muted-foreground flex min-h-11 w-full shrink-0 touch-none items-center justify-center gap-2 rounded-lg text-xs outline-none focus-visible:ring-2"
        >
          <span aria-hidden className="bg-muted-foreground/50 h-1 w-10 rounded-full" />
          <span>{handleLabel(size)}</span>
        </button>
        {size !== 3 ? (
          <DayDetail
            day={dayOf(selected)}
            today={today}
            scope={scope}
            free={freeOf(selected)}
            action={action(selected)}
            timeline
            fill
            headingId="calendar-phone-day"
          />
        ) : null}
      </div>

      {/* Laptop ----------------------------------------------------------------------------- */}
      <div
        data-slot="calendar-laptop"
        data-view={view}
        data-fit-viewport={fit ? "laptop" : undefined}
        className={cn("hidden min-w-0 flex-col gap-3 md:flex", fit && "md:min-h-0 md:flex-1")}
      >
        <div
          data-slot="calendar-controls"
          className="flex min-w-0 shrink-0 flex-wrap items-center gap-3"
        >
          <nav
            aria-label="Calendar view"
            data-slot="calendar-view"
            data-current={view}
            className="bg-muted grid w-72 grid-cols-3 gap-1 rounded-lg p-1"
          >
            {CALENDAR_VIEWS.map((option) => (
              <ViewLink
                key={option}
                href={calendarHref({ ...query, view: option, date: selected }, today)}
                scroll={false}
                aria-current={view === option ? "page" : undefined}
                className={cn(
                  "focus-visible:ring-ring flex min-h-8 items-center justify-center rounded-md px-2 text-sm font-medium outline-none select-none focus-visible:ring-2",
                  view === option
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {VIEW_LABELS[option]}
              </ViewLink>
            ))}
          </nav>
          <div data-slot="calendar-pager" className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => go(laptopStep(-1))}
              aria-label={`Previous ${unit}`}
              className={cn("pressable", ICON_BUTTON, "size-8")}
            >
              <ChevronLeftIcon className="size-4" aria-hidden />
            </button>
            <button
              type="button"
              onClick={() => go(laptopStep(1))}
              aria-label={`Next ${unit}`}
              className={cn("pressable", ICON_BUTTON, "size-8")}
            >
              <ChevronRightIcon className="size-4" aria-hidden />
            </button>
            <h2
              data-slot="calendar-pager-label"
              aria-live="polite"
              className="ml-1 text-base font-semibold whitespace-nowrap"
            >
              {laptopLabel}
            </h2>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              onClick={() => go(today)}
              data-slot="calendar-today-laptop"
              className="pressable focus-visible:ring-ring border-control-border hover:bg-muted flex min-h-8 items-center rounded-lg border px-3 text-sm font-medium outline-none focus-visible:ring-2"
            >
              Today
            </button>
            {filtersButton}
          </div>
        </div>
        {view === "month" ? (
          <MonthGrid
            grid={grid}
            days={byDate}
            today={today}
            selected={null}
            density="laptop"
            onDay={(date) => {
              if (monthOf(date) !== grid.month) go(date);
              else setSheetDate(date);
            }}
          />
        ) : view === "week" ? (
          <Timeline
            days={weekDays}
            today={today}
            header={(day) => {
              const heading = weekdayHeading(day.date);
              return (
                <button
                  type="button"
                  onClick={() => setSheetDate(day.date)}
                  data-slot="calendar-week-day"
                  data-date={day.date}
                  aria-label={dayLabel(day, today)}
                  className={cn(
                    "pressable focus-visible:ring-ring hover:bg-muted flex w-full flex-col items-center rounded-md py-1 outline-none focus-visible:ring-2 focus-visible:ring-inset",
                    day.date === today && "font-semibold",
                  )}
                >
                  <span className="text-muted-foreground text-xs uppercase">{heading.weekday}</span>
                  <span
                    className={cn(
                      "flex size-7 items-center justify-center rounded-full text-sm tabular-nums",
                      day.date === today && "border-foreground border",
                      day.weeklyOff && "text-off-day",
                    )}
                  >
                    {heading.day}
                  </span>
                </button>
              );
            }}
            allDay={(day) => (
              <AllDayChips day={day} today={today} dueAsChip onDue={() => setSheetDate(day.date)} />
            )}
            eventLink={eventLink}
            laptop
            className="border-border rounded-lg border"
          />
        ) : (
          <div
            data-slot="calendar-day-view"
            className="grid min-h-0 min-w-0 flex-1 grid-cols-[minmax(0,1fr)_20rem] grid-rows-[minmax(0,1fr)] gap-4"
          >
            <Timeline
              days={[dayOf(selected)]}
              today={today}
              allDay={(day) => (
                <AllDayChips
                  day={day}
                  today={today}
                  dueAsChip
                  onDue={() => setSheetDate(day.date)}
                />
              )}
              eventLink={eventLink}
              laptop
              className="border-border rounded-lg border"
            />
            {/* The day's side panel: the timeline's height, its own scroll when the day is full. */}
            <div data-slot="calendar-day-side" className="min-h-0 min-w-0 overflow-y-auto">
              <DayDetail
                day={dayOf(selected)}
                today={today}
                scope={scope}
                free={freeOf(selected)}
                action={action(selected)}
                timeline={false}
                headingId="calendar-laptop-day"
              />
            </div>
          </div>
        )}
      </div>

      {sheetDate ? (
        <DaySheet
          day={dayOf(sheetDate)}
          today={today}
          scope={scope}
          free={freeOf(sheetDate)}
          action={action(sheetDate)}
          footer={
            <button
              type="button"
              data-slot="calendar-open-day"
              className="pressable focus-visible:ring-ring border-control-border hover:bg-muted hidden min-h-8 items-center rounded-lg border px-3 text-sm font-medium outline-none focus-visible:ring-2 md:inline-flex"
              onClick={() => openDay(sheetDate)}
            >
              Open day
            </button>
          }
          onClose={() => setSheetDate(null)}
        />
      ) : null}
      {filtersOpen ? (
        <FiltersSheet
          query={{ ...query, date: selected }}
          scope={scope}
          choices={choices}
          onClose={closeFilters}
        />
      ) : null}
    </div>
  );
}
