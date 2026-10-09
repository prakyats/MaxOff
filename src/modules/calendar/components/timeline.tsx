"use client";

import {
  type CSSProperties,
  type FocusEvent,
  type PointerEvent,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from "react";

import { cn } from "@/core/lib/utils";
import { formatIST, istDayStart, systemClock, type ISODate } from "@/core/time";

import { timeWords, type CalendarDay, type EventItem } from "../domain/calendar";
import { blockShowsClient } from "../domain/laptop";
import {
  DAY_MINUTES,
  hourLabel,
  minutesInDay,
  openingMinute,
  placeBlocks,
  VISIBLE_FROM_HOUR,
  VISIBLE_TO_HOUR,
} from "../domain/timeline";

/**
 * The hour timeline (6.4b; Kickoff 6 decision 25 E): one column (the phone's day detail, the
 * laptop's Day) or seven (the laptop's Week). The all-day row on top holds what has no time (the
 * holiday, leave, all-day events, "Due · N"); under it the hours, 08:00–22:00 in view and the rest
 * a scroll away, scrolled to now on today, where a "now" line crosses the day. An event is a block
 * at its time (an hour when it has no end) in its type's colour, opening its task; an Admin's
 * others are grey dotted "Busy" blocks. An hour is `--hour` tall: 2.75rem on a phone (a block of
 * an hour is a 44px target), 3rem from `md` up.
 *
 * **On the laptop** (Week and Day, the owner's 2026-10-08 changes) the timeline fills the height
 * it is given (the viewport below the page's header) with one scroll, its hours; the day headings
 * and the all-day row reserve the same scrollbar gutter, so their columns line up with the hours'
 * exactly. A block shows the client under its title when it has room, and hovering (or focusing)
 * it shows its details beside it; a click opens the task.
 *
 * **On the phone's week and compact month** (`fill`, the owner's phone walk of 2026-10-08) the
 * timeline fills what the day's detail leaves above the bottom bar, never less than two hours, as
 * the screen's one scroll (`overscroll-behavior: contain`, so it never chains to the page): the
 * hours, then the day's other rows (`after`).
 *
 * Every timeline opens 8 px above its opening hour (a whole hour), so that hour's label shows
 * whole at the top.
 */

const HOURS = Array.from({ length: 24 }, (_, hour) => hour);

/** The visible window's height and a minute's offset, in `--hour` units. */
const WINDOW_HOURS = VISIBLE_TO_HOUR - VISIBLE_FROM_HOUR;
function at(minutes: number): string {
  return `calc(var(--hour) * ${minutes / 60})`;
}

/** The details shown beside a hovered (or focused) block on the laptop. */
type Hovered = { event: EventItem; rect: DOMRect };

/** A block's details beside it, inside the viewport: a mouse's look before the click. */
function BlockDetails({ hovered }: { hovered: Hovered }) {
  const { event, rect } = hovered;
  const width = 256;
  const gap = 8;
  const left =
    rect.right + gap + width <= window.innerWidth ? rect.right + gap : rect.left - gap - width;
  const top = Math.max(gap, Math.min(rect.top, window.innerHeight - 160));
  return (
    <div
      data-slot="calendar-event-details"
      data-task={event.id}
      // The block's own text says the same to assistive tech; this is the mouse's look.
      aria-hidden
      className="bg-popover text-popover-foreground ring-foreground/10 pointer-events-none fixed z-50 flex flex-col gap-1 rounded-lg p-3 text-xs shadow-md ring-1"
      style={{ left: Math.max(gap, left), top, width }}
    >
      <span className="flex items-start gap-2 text-sm font-medium">
        <span
          className="mt-1 size-2.5 shrink-0 rounded-full"
          style={{ backgroundColor: event.color }}
        />
        <span className={cn("min-w-0 break-words", event.completed && "line-through")}>
          {event.title}
        </span>
      </span>
      <span className="text-muted-foreground tabular-nums">
        {timeWords(event.startAt, event.endAt)}
      </span>
      {event.typeName ? <span className="text-muted-foreground">{event.typeName}</span> : null}
      {event.clientName ? <span>{event.clientName}</span> : null}
      {event.location ? <span className="text-muted-foreground">{event.location}</span> : null}
      {event.people.length > 0 ? (
        <span className="text-muted-foreground break-words">{event.people.join(", ")}</span>
      ) : null}
    </div>
  );
}

/** The IST minute of now, read after hydration (the server's now is not the phone's). */
function useNowMinute(today: ISODate): number | null {
  const [minute, setMinute] = useState<number | null>(null);
  useEffect(() => {
    const read = () => setMinute(minutesInDay(systemClock().toISOString(), today));
    read();
    const timer = window.setInterval(read, 60_000);
    return () => window.clearInterval(timer);
  }, [today]);
  return minute;
}

export type TimelineEventLink = (
  event: EventItem,
  children: ReactNode,
  className: string,
  style: CSSProperties,
) => ReactNode;

export function Timeline({
  days,
  today,
  allDay,
  header,
  eventLink,
  laptop = false,
  fill = false,
  after,
  className,
}: {
  days: readonly CalendarDay[];
  today: ISODate;
  /**
   * Each day's all-day row content (holiday, leave, all-day events, "Due · N"); none where the
   * day's detail shows them above the timeline (the phone, the sheet).
   */
  allDay?: (day: CalendarDay) => ReactNode;
  /** The Week's day headings, one per column; none for a single day. */
  header?: (day: CalendarDay) => ReactNode;
  /** How an event block opens its task (a drill-down, or out of a sheet first). */
  eventLink: TimelineEventLink;
  /**
   * The laptop's Week and Day: fills the height it is given with one scroll, aligned gutters,
   * the client line and the hover details.
   */
  laptop?: boolean;
  /** The phone's week and compact month: fills the height it is given, its one scroll. */
  fill?: boolean;
  /** What scrolls in after the hours (`fill`): the day's Due list, "Who's free" and buttons. */
  after?: ReactNode;
  className?: string;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const hoursGrid = useRef<HTMLDivElement>(null);
  const now = useNowMinute(today);
  const first = days[0]?.date ?? today;
  const showsToday = days.some((day) => day.date === today);
  const scrolledFor = useRef<string | null>(null);

  const [hovered, setHovered] = useState<Hovered | null>(null);

  // Scrolled to now on today, else to 08:00, once per set of days (never under the person). Only
  // once the hours are laid out and taller than their window: a copy drawn hidden (the other
  // layout's) or not yet sized would take the scroll at 00:00 and keep it there, so the scroll
  // waits for the first size that can hold it.
  const key = days.map((day) => day.date).join(",");
  useEffect(() => {
    const element = scroller.current;
    const grid = hoursGrid.current;
    if (!element || !grid || scrolledFor.current === key) return;
    if (showsToday && now === null) return;
    const minute = openingMinute(showsToday ? today : first, today, now ?? 0);
    const apply = (): boolean => {
      if (element.clientHeight === 0 || element.scrollHeight <= element.clientHeight) return false;
      scrolledFor.current = key;
      // 8 px (half a label's height) above the hour, so the opening hour's own label shows whole.
      // The hours' own box, not the scroll's: rows may follow them (`after`).
      const hour = grid.offsetTop + (grid.offsetHeight / DAY_MINUTES) * minute;
      element.scrollTop = Math.max(0, hour - 8);
      return true;
    };
    if (apply()) return;
    const observer = new ResizeObserver(() => {
      if (apply()) observer.disconnect();
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [key, showsToday, now, today, first]);

  // The laptop's look before the click: a mouse over a block (a touch never hovers), or the
  // keyboard's focus on it.
  // A move counts as well as an entry: a view switched under a resting mouse puts a block under
  // it without any entry, and the first move then shows the details.
  const show = (pointer: PointerEvent<HTMLDivElement>, event: EventItem) => {
    if (pointer.pointerType !== "mouse" || hovered?.event.id === event.id) return;
    setHovered({ event, rect: pointer.currentTarget.getBoundingClientRect() });
  };
  const look = (event: EventItem) => ({
    onPointerEnter: (pointer: PointerEvent<HTMLDivElement>) => show(pointer, event),
    onPointerMove: (pointer: PointerEvent<HTMLDivElement>) => show(pointer, event),
    onPointerLeave: () => setHovered(null),
    onFocus: (focus: FocusEvent<HTMLDivElement>) => {
      if (!focus.currentTarget.querySelector(":focus-visible")) return;
      setHovered({ event, rect: focus.currentTarget.getBoundingClientRect() });
    },
    onBlur: () => setHovered(null),
  });
  // A wheel scrolls the blocks away: the details close rather than float off theirs. Only the
  // wheel: a scroll the page makes itself (a block brought into view) must not close them.
  const closeLook = hovered ? () => setHovered(null) : undefined;

  const columns = days.length;
  const grid = { gridTemplateColumns: `3rem repeat(${columns}, minmax(0, 1fr))` };
  // The same gutter as the hours' scrollbar on the rows above them, so every column lines up.
  const gutter = laptop ? "overflow-hidden [scrollbar-gutter:stable]" : undefined;
  return (
    <div
      data-slot="calendar-timeline"
      data-days={columns}
      data-fill={laptop ? "" : undefined}
      className={cn(
        "flex min-w-0 flex-col [--hour:2.75rem] md:[--hour:3rem]",
        laptop && "min-h-0 flex-1",
        fill && "grow basis-0",
        className,
      )}
    >
      {header ? (
        <div
          data-slot="calendar-timeline-header"
          className={cn("border-border grid border-b", gutter)}
          style={grid}
        >
          <span />
          {days.map((day) => (
            <div key={day.date} className="min-w-0">
              {header(day)}
            </div>
          ))}
        </div>
      ) : null}
      {allDay ? (
        <div
          data-slot="calendar-all-day-row"
          className={cn("border-border grid border-b", gutter)}
          style={grid}
        >
          <span className="text-muted-foreground py-1 pr-1 text-right text-[0.6875rem] leading-4">
            All day
          </span>
          {days.map((day) => (
            <div
              key={day.date}
              data-date={day.date}
              className="border-border flex min-w-0 flex-col gap-0.5 border-l p-0.5"
            >
              {allDay(day)}
            </div>
          ))}
        </div>
      ) : null}
      <div
        ref={scroller}
        data-slot="calendar-hours"
        onWheel={closeLook}
        className={cn(
          "relative overflow-y-auto overscroll-contain",
          laptop && "min-h-0 flex-1 [scrollbar-gutter:stable]",
          // Two hours at least: at a very large text size the page scrolls before this shrinks.
          fill && "min-h-[calc(var(--hour)*2)] grow basis-0",
        )}
        style={laptop || fill ? undefined : { height: `calc(var(--hour) * ${WINDOW_HOURS})` }}
      >
        <div className={cn(fill && "border-border overflow-hidden rounded-lg border")}>
          <div
            ref={hoursGrid}
            className="relative grid"
            style={{ ...grid, height: at(DAY_MINUTES) }}
          >
            <div className="relative">
              {HOURS.map((hour) => (
                <span
                  key={hour}
                  className="text-muted-foreground absolute right-1 -translate-y-1/2 text-[0.6875rem] leading-4 tabular-nums"
                  style={{ top: at(hour * 60) }}
                >
                  {hour === 0 ? "" : hourLabel(hour)}
                </span>
              ))}
            </div>
            {days.map((day) => (
              <div
                key={day.date}
                data-slot="calendar-hours-day"
                data-date={day.date}
                className="border-border relative min-w-0 border-l"
              >
                {HOURS.map((hour) => (
                  <span
                    key={hour}
                    aria-hidden
                    className="border-border/60 absolute inset-x-0 border-t"
                    style={{ top: at(hour * 60) }}
                  />
                ))}
                {placeBlocks(day).map((block) => {
                  const style: CSSProperties = {
                    top: at(block.start),
                    height: at(block.end - block.start),
                    left: `${(block.column / block.columns) * 100}%`,
                    width: `${100 / block.columns}%`,
                  };
                  if (block.item.kind === "busy") {
                    return (
                      <div
                        key={`busy-${block.item.memberId}-${block.item.startAt}`}
                        data-slot="calendar-busy"
                        data-member={block.item.memberId}
                        className="text-muted-foreground border-muted-foreground/70 bg-background absolute min-h-6 overflow-hidden rounded-md border border-dotted px-1.5 py-0.5 text-xs leading-4"
                        style={style}
                      >
                        <span className="font-medium">{block.item.name}</span> busy ·{" "}
                        {timeWords(block.item.startAt, block.item.endAt)}
                      </div>
                    );
                  }
                  const event = block.item;
                  const client =
                    laptop && blockShowsClient(block.end - block.start, event.clientName);
                  return (
                    <div
                      key={event.id}
                      className="absolute p-px"
                      style={style}
                      {...(laptop ? look(event) : {})}
                    >
                      {eventLink(
                        event,
                        <>
                          <span
                            className={cn(
                              "block font-medium",
                              laptop && "truncate",
                              event.completed && "line-through",
                            )}
                          >
                            {event.title}
                          </span>
                          {client ? (
                            <span data-slot="calendar-event-client" className="block truncate">
                              {event.clientName}
                            </span>
                          ) : null}
                          <span className="text-muted-foreground block">
                            {[
                              timeWords(event.startAt, event.endAt),
                              event.location,
                              event.people.join(", "),
                            ]
                              .filter(Boolean)
                              .join(" · ")}
                          </span>
                        </>,
                        cn(
                          "focus-visible:ring-ring block h-full min-h-11 overflow-hidden rounded-md border-l-4 px-1.5 py-0.5 text-xs leading-4 outline-none focus-visible:ring-2 md:min-h-6",
                          event.completed && "opacity-60",
                        ),
                        { backgroundColor: `${event.color}26`, borderLeftColor: event.color },
                      )}
                    </div>
                  );
                })}
                {day.date === today && now !== null ? (
                  <span
                    data-slot="calendar-now"
                    aria-label={`Now, ${formatIST(systemClock(), "h:mm aaa")}`}
                    className="bg-foreground pointer-events-none absolute inset-x-0 z-10 h-0.5"
                    style={{ top: at(now) }}
                  >
                    <span className="bg-foreground absolute -top-1 -left-1 size-2.5 rounded-full" />
                  </span>
                ) : null}
              </div>
            ))}
          </div>
        </div>
        {fill && after ? (
          <div data-slot="calendar-day-rest" className="flex flex-col gap-3 py-3">
            {after}
          </div>
        ) : null}
      </div>
      {hovered ? <BlockDetails hovered={hovered} /> : null}
    </div>
  );
}

/** "Thu 8", the Week's column heading. */
export function weekdayHeading(date: ISODate): { weekday: string; day: string } {
  return {
    weekday: formatIST(istDayStart(date), "EEE"),
    day: formatIST(istDayStart(date), "d"),
  };
}
