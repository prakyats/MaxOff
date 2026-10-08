"use client";

import { ChevronRightIcon, ClockIcon, MapPinIcon, PalmtreeIcon, UsersIcon } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/core/lib/utils";
import { OverlayLink } from "@/core/ui/composites/overlay-link";
import { formatIST, type ISODate } from "@/core/time";

import {
  type CalendarDay,
  type CalendarScope,
  dayHeading,
  EMPTY_DAY,
  type EventItem,
  isEmptyDay,
  timeWords,
} from "../domain/calendar";
import { HOLIDAY_COLOR } from "../domain/strips";
import { allDayEvents, placeBlocks } from "../domain/timeline";
import { Timeline, type TimelineEventLink } from "./timeline";

/**
 * A day's detail (6.4b; Kickoff 6 decision 25 D): the phone's panel under the week strip or the
 * compact month, the day sheet (the full month, and the laptop's day dialog), and the laptop Day's
 * side column. In order: the day's heading; the all-day line (the holiday, the weekly off, leave,
 * all-day events, "Due · N"); the timed events on an hour timeline (the phone and the sheet), each
 * with its time, place and people and opening its task; "Due · N" and its tasks; "Who's free" for
 * the Owner and Admins; then the day's action, the route's ("+ New task on 8 Oct" for whoever may
 * create a task, "Suggest a task" for Crew). An empty day says "Nothing on this day." and nothing
 * else (a day with only a due task is not empty, 08 Oct bug (c)).
 */

/** An event or a due task as a link to its task, backing out of a sheet first (`OverlayLink`). */
export const eventLink: TimelineEventLink = (event, children, className, style) => (
  <OverlayLink
    href={`/tasks/${event.id}`}
    data-slot="calendar-event"
    data-task={event.id}
    data-completed={event.completed ? "" : undefined}
    className={className}
    style={style}
  >
    {children}
  </OverlayLink>
);

/** "Asha" for "Asha Rao (freelancer)": a chip is one short line. */
function firstName(name: string): string {
  return name.split(/\s+/)[0] ?? name;
}

function Chip({
  slot,
  children,
  className,
  style,
}: {
  slot: string;
  children: ReactNode;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <span
      data-slot={slot}
      className={cn(
        // One line, ellipsised when it does not fit (the owner's review, 2026-10-08).
        "inline-flex max-w-full min-w-0 items-center gap-1 overflow-hidden rounded-md px-1.5 py-0.5 text-xs leading-4 whitespace-nowrap",
        className,
      )}
      style={style}
    >
      {children}
    </span>
  );
}

/** The all-day line's chips: the holiday, the weekly off, leave, all-day events, "Due · N". */
export function AllDayChips({
  day,
  today,
  dueAsChip,
  onDue,
  events = true,
}: {
  day: CalendarDay;
  /** A past day's open tasks are overdue: their "Due · N" reads red (decision 25 C). */
  today: ISODate;
  /** "Due · N" in the line (the timelines); the detail lists the tasks under it instead. */
  dueAsChip: boolean;
  /** The laptop's "Due · N" opens the day's popup. */
  onDue?: () => void;
  /** The all-day events in the line; the laptop's agenda lists them with the others instead. */
  events?: boolean;
}) {
  const overdue = day.date < today;
  return (
    <>
      {day.holiday ? (
        <Chip
          slot="calendar-holiday"
          className="border-l-2"
          style={{ backgroundColor: `${HOLIDAY_COLOR}26`, borderLeftColor: HOLIDAY_COLOR }}
        >
          <span className="min-w-0 truncate">{day.holiday}</span>
        </Chip>
      ) : null}
      {day.weeklyOff ? (
        <Chip slot="calendar-weekly-off" className="text-off-day">
          Weekly off
        </Chip>
      ) : null}
      {day.leave.map((item) => (
        <Chip
          key={`${item.memberId}-${item.label}-${item.pending}`}
          slot="calendar-leave"
          className={cn(
            "bg-muted text-muted-foreground",
            item.pending && "border-muted-foreground/70 border border-dashed",
          )}
        >
          <PalmtreeIcon className="size-3 shrink-0" aria-hidden />
          <span data-member={item.memberId} className="min-w-0 truncate">
            {item.own ? "You" : firstName(item.name)} · {item.label}
            {item.pending ? " · requested" : ""}
          </span>
        </Chip>
      ))}
      {(events ? allDayEvents(day) : []).map((event) =>
        eventLink(
          event,
          <>
            <span className="font-medium">{event.title}</span>
            {event.location ? (
              <span className="text-muted-foreground"> · {event.location}</span>
            ) : null}
          </>,
          cn(
            "block max-w-full truncate rounded-md border-l-4 px-1.5 py-0.5 text-xs leading-4",
            event.completed && "opacity-60",
          ),
          { backgroundColor: `${event.color}26`, borderLeftColor: event.color },
        ),
      )}
      {dueAsChip && day.due.length > 0 ? (
        onDue ? (
          <button
            type="button"
            onClick={onDue}
            data-slot="calendar-due-chip"
            className={cn(
              "pressable focus-visible:ring-ring inline-flex min-h-6 items-center gap-1 rounded-md px-1.5 text-xs font-medium outline-none focus-visible:ring-2 focus-visible:ring-inset",
              overdue ? "text-danger" : "text-attention",
            )}
          >
            <ClockIcon className="size-3" aria-hidden />
            Due · {day.due.length}
          </button>
        ) : (
          <Chip
            slot="calendar-due-chip"
            className={cn("font-medium", overdue ? "text-danger" : "text-attention")}
          >
            <ClockIcon className="size-3" aria-hidden />
            Due · {day.due.length}
          </Chip>
        )
      ) : null}
    </>
  );
}

function EventRows({ events }: { events: readonly EventItem[] }) {
  return (
    <ul
      aria-label="Events"
      data-slot="calendar-events"
      className="border-border divide-border bg-card divide-y overflow-hidden rounded-lg border"
    >
      {events.map((event) => (
        <li key={event.id}>
          {eventLink(
            event,
            <>
              <span
                aria-hidden
                className="mt-1 size-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: event.color }}
              />
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className={cn("font-medium break-words", event.completed && "line-through")}>
                  {event.title}
                </span>
                <span className="text-muted-foreground flex flex-wrap items-center gap-x-2 text-xs break-words">
                  <span className="tabular-nums">{timeWords(event.startAt, event.endAt)}</span>
                  {event.location ? (
                    <span className="inline-flex items-center gap-1">
                      <MapPinIcon className="size-3 shrink-0" aria-hidden />
                      {event.location}
                    </span>
                  ) : null}
                  {event.clientName ? <span>{event.clientName}</span> : null}
                  {event.people.length > 0 ? (
                    <span className="inline-flex items-center gap-1">
                      <UsersIcon className="size-3 shrink-0" aria-hidden />
                      {event.people.join(", ")}
                    </span>
                  ) : null}
                </span>
              </span>
              <ChevronRightIcon
                className="text-muted-foreground mt-0.5 size-4 shrink-0"
                aria-hidden
              />
            </>,
            cn(
              "focus-visible:ring-ring flex min-h-14 items-start gap-3 px-4 py-2.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-inset",
              event.completed && "text-muted-foreground",
            ),
            {},
          )}
        </li>
      ))}
    </ul>
  );
}

export function DayDetail({
  day,
  today,
  scope,
  free,
  action,
  timeline,
  fill = false,
  footer,
  heading = true,
  headingId,
}: {
  day: CalendarDay;
  today: ISODate;
  scope: CalendarScope;
  /** "Free: … · Busy 10–1: … · On leave: …" (the Owner and Admins); null for Crew. */
  free: string | null;
  /** The day's action (the route's: New task, or Suggest a task); null for none. */
  action: ReactNode;
  /**
   * The timed events on an hour timeline (the phone, the sheet); the laptop Day's side column has
   * the timeline beside it and lists them instead.
   */
  timeline: boolean;
  /**
   * The phone's week and compact month (the owner's phone walk, 2026-10-08): the detail fills the
   * height left above the bottom bar. Its heading and all-day line stay put; under them one scroll
   * takes the rest: the hour timeline with the day's other rows ("Due · N", "Who's free", the
   * day's action) after its hours, or those rows alone on a day with no timed event.
   */
  fill?: boolean;
  /** "Open day" in the laptop's dialog. */
  footer?: ReactNode;
  /** The day's heading; a sheet's title says it instead. */
  heading?: boolean;
  headingId: string;
}) {
  const empty = isEmptyDay(day);
  const timed = placeBlocks(day);
  const hasAllDay =
    day.holiday !== null ||
    day.weeklyOff ||
    day.leave.length > 0 ||
    day.events.some((event) => event.startAt === null);
  // What follows the events: an Admin's others' busy times (beside the laptop Day's timeline),
  // "Due · N" and its tasks, "Who's free" and the day's buttons.
  const rest = (
    <>
      {!timeline && day.busy.length > 0 ? (
        <ul aria-label="Busy" className="text-muted-foreground flex flex-col gap-1 text-xs">
          {day.busy.map((block) => (
            <li
              key={`${block.memberId}-${block.startAt}`}
              data-slot="calendar-busy"
              data-member={block.memberId}
            >
              <span className="text-foreground font-medium">{block.name}</span> busy ·{" "}
              {timeWords(block.startAt, block.endAt)}
            </li>
          ))}
        </ul>
      ) : null}
      {day.due.length > 0 ? (
        <section
          aria-labelledby={`${headingId}-due`}
          data-slot="calendar-due-list"
          className="flex flex-col gap-2"
        >
          <h3 id={`${headingId}-due`} className="flex items-center gap-1.5 text-sm font-semibold">
            <ClockIcon className="text-muted-foreground size-4" aria-hidden />
            Due · {day.due.length}
          </h3>
          <ul className="border-border divide-border bg-card divide-y overflow-hidden rounded-lg border">
            {day.due.map((item) => (
              <li key={item.id}>
                <OverlayLink
                  href={`/tasks/${item.id}`}
                  data-slot="calendar-due"
                  data-task={item.id}
                  className="focus-visible:ring-ring flex min-h-14 items-start gap-3 px-4 py-2.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-inset"
                >
                  <span
                    className={cn(
                      "w-16 shrink-0 pt-px text-xs tabular-nums",
                      day.date < today ? "text-danger" : "text-muted-foreground",
                    )}
                  >
                    {formatIST(item.dueAt, "h:mm aaa")}
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="font-medium break-words">{item.title}</span>
                    <span className="text-muted-foreground text-xs break-words">{item.owner}</span>
                  </span>
                  <ChevronRightIcon
                    className="text-muted-foreground mt-0.5 size-4 shrink-0"
                    aria-hidden
                  />
                </OverlayLink>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {free !== null && scope !== "staff" ? (
        <p data-slot="calendar-who-free" className="text-muted-foreground text-sm break-words">
          {free}
        </p>
      ) : null}
      {action || footer ? (
        <div className="flex flex-wrap items-center gap-2">
          {action}
          {footer}
        </div>
      ) : null}
    </>
  );
  return (
    <section
      aria-labelledby={heading ? headingId : undefined}
      aria-label={heading ? undefined : dayHeading(day.date, today)}
      data-slot="calendar-detail"
      data-date={day.date}
      className={cn("flex min-w-0 flex-col gap-3", fill && "grow basis-0")}
    >
      {heading ? (
        <h2 id={headingId} data-slot="calendar-day-title" className="text-sm font-semibold">
          {dayHeading(day.date, today)}
        </h2>
      ) : null}
      {empty ? (
        <p data-slot="calendar-empty-day" className="text-muted-foreground text-sm">
          {EMPTY_DAY}
        </p>
      ) : null}
      {hasAllDay ? (
        <div data-slot="calendar-all-day" className="flex flex-wrap items-center gap-1.5">
          <AllDayChips day={day} today={today} dueAsChip={false} />
        </div>
      ) : null}
      {timed.length > 0 ? (
        timeline ? (
          fill ? (
            <Timeline days={[day]} today={today} eventLink={eventLink} fill after={rest} />
          ) : (
            <Timeline
              days={[day]}
              today={today}
              eventLink={eventLink}
              className="border-border overflow-hidden rounded-lg border"
            />
          )
        ) : (
          <EventRows events={day.events.filter((event) => event.startAt !== null)} />
        )
      ) : fill ? (
        <div
          data-slot="calendar-day-scroll"
          // The one scroll on a day with no timed event; two of the phone's hours at least, as the
          // timeline keeps.
          className="flex min-h-[5.5rem] min-w-0 grow basis-0 flex-col gap-3 overflow-y-auto overscroll-contain"
        >
          {rest}
        </div>
      ) : null}
      {fill ? null : rest}
    </section>
  );
}
