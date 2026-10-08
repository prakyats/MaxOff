"use client";

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";

import { cn } from "@/core/lib/utils";
import { formatIST, istDayStart, systemClock, type ISODate } from "@/core/time";

import { timeWords, type CalendarDay, type EventItem } from "../domain/calendar";
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
 */

const HOURS = Array.from({ length: 24 }, (_, hour) => hour);

/** The visible window's height and a minute's offset, in `--hour` units. */
const WINDOW_HOURS = VISIBLE_TO_HOUR - VISIBLE_FROM_HOUR;
function at(minutes: number): string {
  return `calc(var(--hour) * ${minutes / 60})`;
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
  className,
}: {
  days: readonly CalendarDay[];
  today: ISODate;
  /** Each day's all-day row content (holiday, leave, all-day events, "Due · N"). */
  allDay: (day: CalendarDay) => ReactNode;
  /** The Week's day headings, one per column; none for a single day. */
  header?: (day: CalendarDay) => ReactNode;
  /** How an event block opens its task (a drill-down, or out of a sheet first). */
  eventLink: TimelineEventLink;
  className?: string;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const now = useNowMinute(today);
  const first = days[0]?.date ?? today;
  const showsToday = days.some((day) => day.date === today);
  const scrolledFor = useRef<string | null>(null);

  // Scrolled to now on today, else to 08:00, once per set of days (never under the person).
  const key = days.map((day) => day.date).join(",");
  useEffect(() => {
    const element = scroller.current;
    if (!element || scrolledFor.current === key) return;
    if (showsToday && now === null) return;
    scrolledFor.current = key;
    const minute = openingMinute(showsToday ? today : first, today, now ?? 0);
    element.scrollTop = (element.scrollHeight / DAY_MINUTES) * minute;
  }, [key, showsToday, now, today, first]);

  const columns = days.length;
  const grid = { gridTemplateColumns: `3rem repeat(${columns}, minmax(0, 1fr))` };
  return (
    <div
      data-slot="calendar-timeline"
      data-days={columns}
      className={cn("flex min-w-0 flex-col [--hour:2.75rem] md:[--hour:3rem]", className)}
    >
      {header ? (
        <div className="border-border grid border-b" style={grid}>
          <span />
          {days.map((day) => (
            <div key={day.date} className="min-w-0">
              {header(day)}
            </div>
          ))}
        </div>
      ) : null}
      <div data-slot="calendar-all-day-row" className="border-border grid border-b" style={grid}>
        <span className="text-muted-foreground py-1 pr-1 text-right text-[0.6875rem] leading-4">
          All day
        </span>
        {days.map((day) => (
          <div
            key={day.date}
            className="border-border flex min-w-0 flex-col gap-0.5 border-l p-0.5"
          >
            {allDay(day)}
          </div>
        ))}
      </div>
      <div
        ref={scroller}
        data-slot="calendar-hours"
        className="relative overflow-y-auto overscroll-contain"
        style={{ height: `calc(var(--hour) * ${WINDOW_HOURS})` }}
      >
        <div className="relative grid" style={{ ...grid, height: at(DAY_MINUTES) }}>
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
                return (
                  <div key={event.id} className="absolute p-px" style={style}>
                    {eventLink(
                      event,
                      <>
                        <span
                          className={cn("block font-medium", event.completed && "line-through")}
                        >
                          {event.title}
                        </span>
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
