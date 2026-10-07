import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";

import { cn } from "@/core/lib/utils";
import { ViewLink } from "@/core/ui/composites/view-link";
import { Skeleton } from "@/core/ui/primitives/skeleton";
import { formatIST, istDayStart, type ISODate } from "@/core/time";

import {
  CALENDAR_VIEWS,
  type CalendarDay,
  type CalendarQuery,
  type CalendarView,
  calendarHref,
  monthLabel,
  monthOf,
  shifted,
  weekLabel,
  weekOf,
} from "../domain/calendar";

/**
 * The calendar's controls (6.4, Kickoff 6 decision 15): Day · Week · Month, the pager with what is
 * shown, and the week strip (seven day chips, the chosen day marked). View controls: every link
 * is a `ViewLink`, so switching the view, the day or the week never adds history and one back
 * leaves the calendar (ARCHITECTURE §14.2 d). Server components: nothing here hydrates beyond
 * the links' pending state.
 */

const VIEW_LABELS: Record<CalendarView, string> = { day: "Day", week: "Week", month: "Month" };

const SEGMENT =
  "focus-visible:ring-ring flex min-h-11 items-center justify-center rounded-md px-2 text-center text-sm font-medium outline-none select-none focus-visible:ring-2";
const SEGMENT_ON = "bg-background text-foreground shadow-sm";
const SEGMENT_OFF = "text-muted-foreground hover:text-foreground active:bg-background/60";

/**
 * Day · Week · Month. With no view in the address the width decides (a phone opens on Day, a
 * desktop on Week), so the switcher is drawn twice, one per width, each marking its default.
 */
export function ViewSwitcher({ query, today }: { query: CalendarQuery; today: ISODate }) {
  const links = CALENDAR_VIEWS.map((view) => ({
    view,
    href: calendarHref({ ...query, view }, today),
  }));
  const nav = (current: CalendarView, className: string) => (
    <nav
      aria-label="Calendar view"
      data-slot="calendar-view"
      data-current={current}
      className={cn("bg-muted grid grid-cols-3 gap-1 rounded-lg p-1 md:w-80", className)}
    >
      {links.map(({ view, href }) => (
        <ViewLink
          key={view}
          href={href}
          scroll={false}
          aria-current={current === view ? "page" : undefined}
          className={cn(SEGMENT, current === view ? SEGMENT_ON : SEGMENT_OFF)}
        >
          {VIEW_LABELS[view]}
        </ViewLink>
      ))}
    </nav>
  );
  if (query.view) return nav(query.view, "");
  return (
    <>
      {nav("day", "md:hidden")}
      {nav("week", "hidden md:grid")}
    </>
  );
}

/** The pager: a step back, what is shown, a step on. The step follows the view. */
export function CalendarPager({ query, today }: { query: CalendarQuery; today: ISODate }) {
  const label =
    query.view === "month"
      ? monthLabel(monthOf(query.date))
      : query.view === "day"
        ? dayPagerLabel(query.date)
        : weekLabel(weekOf(query.date));
  const unit = query.view === "month" ? "month" : query.view === "day" ? "day" : "week";
  const link = (direction: -1 | 1) => (
    <ViewLink
      href={calendarHref(shifted(query, direction), today)}
      scroll={false}
      icon
      aria-label={direction < 0 ? `Previous ${unit}` : `Next ${unit}`}
      className="text-muted-foreground hover:text-foreground flex size-11 shrink-0 items-center justify-center rounded-md"
    >
      {direction < 0 ? (
        <ChevronLeftIcon className="size-4" aria-hidden />
      ) : (
        <ChevronRightIcon className="size-4" aria-hidden />
      )}
    </ViewLink>
  );
  const todayHref = calendarHref({ ...query, date: today }, today);
  return (
    <div
      data-slot="calendar-pager"
      className="flex min-h-11 items-center justify-between gap-2 md:justify-start md:gap-4"
    >
      {link(-1)}
      <p
        className="min-w-0 flex-1 truncate text-center text-sm font-medium tabular-nums md:flex-none md:text-left"
        data-slot="calendar-pager-label"
        aria-live="polite"
      >
        {label}
      </p>
      {link(1)}
      {query.date !== today ? (
        <ViewLink
          href={todayHref}
          scroll={false}
          className="text-muted-foreground hover:text-foreground flex min-h-11 items-center rounded-md px-2 text-sm font-medium"
          data-slot="calendar-today"
        >
          Today
        </ViewLink>
      ) : null}
    </div>
  );
}

function dayPagerLabel(date: ISODate): string {
  return formatIST(istDayStart(date), "EEE d MMM yyyy");
}

/**
 * The week strip: the seven days of the week as chips (the weekday, the date), the chosen day
 * marked, a dot under a day with something on it; a tap opens that day in the Day view (a view
 * change, no history). The Week view keeps it as its pager of days.
 */
export function WeekStrip({
  query,
  days,
  today,
}: {
  query: CalendarQuery;
  days: readonly CalendarDay[];
  today: ISODate;
}) {
  return (
    <ol aria-label="This week" data-slot="calendar-strip" className="grid grid-cols-7 gap-1">
      {days.map((day) => {
        const chosen = day.date === query.date;
        const busy =
          day.events.length + day.busy.length + day.leave.length + day.due.length > 0 ||
          day.holiday !== null;
        return (
          <li key={day.date} className="min-w-0">
            <ViewLink
              href={calendarHref({ ...query, view: "day", date: day.date }, today)}
              scroll={false}
              aria-current={chosen ? "date" : undefined}
              aria-label={formatIST(istDayStart(day.date), "EEEE d MMMM")}
              data-slot="calendar-strip-day"
              data-date={day.date}
              className={cn(
                "focus-visible:ring-ring flex min-h-14 flex-col items-center justify-center gap-0.5 rounded-lg border px-1 py-1.5 outline-none select-none focus-visible:ring-2",
                chosen
                  ? "border-foreground bg-foreground text-background"
                  : "border-border bg-card text-foreground active:bg-muted/60",
                day.date === today && !chosen && "border-foreground",
              )}
            >
              <span
                className={cn(
                  "text-[11px] leading-4 uppercase",
                  chosen ? "text-background/80" : "text-muted-foreground",
                )}
              >
                {formatIST(istDayStart(day.date), "EEE")}
              </span>
              <span className="text-sm leading-5 font-semibold tabular-nums">
                {formatIST(istDayStart(day.date), "d")}
              </span>
              <span
                aria-hidden
                className={cn(
                  "size-1.5 rounded-full",
                  busy ? (chosen ? "bg-background" : "bg-foreground") : "bg-transparent",
                )}
              />
            </ViewLink>
          </li>
        );
      })}
    </ol>
  );
}

/** The controls' skeleton: the switcher (nothing chosen), the pager row, the strip's chips. */
export function CalendarControlsSkeleton() {
  return (
    <div aria-hidden className="flex flex-col gap-3">
      <div
        data-slot="calendar-view"
        className="bg-muted grid grid-cols-3 gap-1 rounded-lg p-1 md:w-80"
      >
        {CALENDAR_VIEWS.map((view) => (
          <span key={view} className={cn(SEGMENT, "text-muted-foreground")}>
            {VIEW_LABELS[view]}
          </span>
        ))}
      </div>
      <div
        data-slot="calendar-pager"
        className="flex min-h-11 items-center justify-between gap-2 md:justify-start md:gap-4"
      >
        <span className="flex size-11 shrink-0 items-center justify-center">
          <Skeleton className="size-4 rounded-sm" />
        </span>
        <span className="flex h-5 flex-1 items-center justify-center md:flex-none">
          <Skeleton className="h-4 w-36" />
        </span>
        <span className="flex size-11 shrink-0 items-center justify-center">
          <Skeleton className="size-4 rounded-sm" />
        </span>
      </div>
      <ol data-slot="calendar-strip" className="grid grid-cols-7 gap-1">
        {Array.from({ length: 7 }, (_, index) => (
          <li key={index} className="min-w-0">
            <span className="border-border bg-card flex min-h-14 flex-col items-center justify-center gap-0.5 rounded-lg border px-1 py-1.5">
              <span className="flex h-4 items-center">
                <Skeleton className="h-2.5 w-6" />
              </span>
              <span className="flex h-5 items-center">
                <Skeleton className="h-3.5 w-4" />
              </span>
              <span className="size-1.5" />
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}
