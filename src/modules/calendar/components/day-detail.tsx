"use client";

import { ChevronRightIcon, ClockIcon, MapPinIcon, PalmtreeIcon, UsersIcon } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/core/lib/utils";
import { OverlayLink } from "@/core/ui/composites/overlay-link";
import { PersonAvatar } from "@/core/ui/composites/person-avatar";
import { formatTime, type ISODate } from "@/core/time";

import {
  type CalendarDay,
  dayHeading,
  dueCount,
  EMPTY_DAY,
  type EventItem,
  isEmptyDay,
  timeWords,
} from "../domain/calendar";
import { HOLIDAY_COLOR } from "../domain/strips";
import { allDayEvents, placeBlocks } from "../domain/timeline";
import { DoneTick, HeldWord, LEAVE_TONE, LeaveIcon, TypeDot, typeTint } from "./calendar-chip";
import { LEAVE_FIT_LABEL } from "./leave-fit";
import { Timeline, type TimelineEventLink } from "./timeline";

/**
 * **Crew's** day in detail (6.4b; Kickoff 6 decision 25 D; since v6.0 the Owner's and Admins' day
 * is `CrewDayBody`, with the Crew's Busy / On leave / Free and no hour timeline): the phone's
 * panel under the week strip or the compact month, the phone's day sheet (the full month), and the
 * laptop Day's side column. In order: the day's heading; the all-day line (the holiday, the weekly
 * off, their leave, all-day events); the timed events on an hour timeline (the phone and the
 * sheet), each with its time, place and people and opening its task; "Due · N" and its tasks; then
 * the day's action, the route's ("Suggest a task on ‹day›"). An empty day says "Nothing on this
 * day." and nothing else (a day with only a due task is not empty, 08 Oct bug (c)).
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

/**
 * A leave chip's word (PP-phone-2, PP-crew-5, V5b): "On leave", as the month's bar says it ("You ·
 * On leave"), "Half day" and "Comp leave" as they are.
 */
function leaveWord(label: string): string {
  return label === "Leave" ? "On leave" : label;
}

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
  avatars = false,
  fitLeave = false,
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
  /** Each person's photo beside their leave (the day popup only, V5b-D; never a month box). */
  avatars?: boolean;
  /**
   * The laptop's Week and Day: a leave chip never truncates; "Name · Leave" where "Name · On
   * leave" has no room, else "[photo] Leave" (v1.8, owner 23 Oct; the screen's `useLeaveFit`
   * measures).
   */
  fitLeave?: boolean;
}) {
  const overdue = day.date < today;
  return (
    <>
      {day.holiday ? (
        <Chip slot="calendar-holiday" style={typeTint(HOLIDAY_COLOR)}>
          <TypeDot color={HOLIDAY_COLOR} />
          <span className="min-w-0 truncate">{day.holiday}</span>
        </Chip>
      ) : null}
      {day.weeklyOff ? (
        <Chip slot="calendar-weekly-off" className="bg-muted text-muted-foreground">
          Weekly off
        </Chip>
      ) : null}
      {day.leave.map((item) => {
        const chip = (
          <Chip
            key={`${item.memberId}-${item.label}-${item.pending}`}
            slot="calendar-leave"
            className={cn(
              // Leave's neutral striped tone (PP-calendar-3, 10), the same as the month's bar.
              LEAVE_TONE,
              item.pending && "border-leave/60 border border-dashed",
            )}
          >
            {fitLeave && item.label === "Leave" ? (
              <span
                data-member={item.memberId}
                data-leave-fit="long"
                className={cn("min-w-0", LEAVE_FIT_LABEL)}
              >
                <span data-leave-word="long">
                  <LeaveIcon className="mr-1" />
                  {item.own ? "You" : firstName(item.name)} · On leave
                </span>
                <span data-leave-word="short">
                  <LeaveIcon className="mr-1" />
                  {item.own ? "You" : firstName(item.name)} · Leave
                </span>
                {/* Where even "Name · Leave" has no room: their photo, "Leave" (owner 23 Oct). */}
                <span data-leave-word="photo">
                  <PersonAvatar
                    person={{
                      id: item.memberId,
                      name: item.name,
                      avatarFileId: item.avatarFileId ?? null,
                    }}
                    size={20}
                  />
                  Leave
                </span>
                {item.pending ? " · requested" : ""}
              </span>
            ) : (
              <>
                <PalmtreeIcon className="size-3 shrink-0" aria-hidden />
                <span data-member={item.memberId} className="min-w-0 truncate">
                  {item.own ? "You" : firstName(item.name)} · {leaveWord(item.label)}
                  {item.pending ? " · requested" : ""}
                </span>
              </>
            )}
          </Chip>
        );
        return avatars ? (
          <span
            key={`${item.memberId}-${item.label}-${item.pending}`}
            className="inline-flex max-w-full min-w-0 items-center gap-1.5"
          >
            <PersonAvatar
              person={{
                id: item.memberId,
                name: item.name,
                avatarFileId: item.avatarFileId ?? null,
              }}
              size={20}
            />
            {chip}
          </span>
        ) : (
          chip
        );
      })}
      {(events ? allDayEvents(day) : []).map((event) =>
        eventLink(
          event,
          <>
            {event.completed ? (
              <DoneTick className="mr-1" />
            ) : (
              <TypeDot color={event.color} className="mr-1" />
            )}
            <span className="font-medium">{event.title}</span>
            {event.location ? (
              <span className="text-foreground/80"> · {event.location}</span>
            ) : null}
          </>,
          cn(
            "block max-w-full truncate rounded-md px-1.5 py-0.5 text-xs leading-4",
            event.completed && "opacity-60",
          ),
          typeTint(event.color),
        ),
      )}
      {dueAsChip && dueCount(day) > 0 ? (
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
            Due · {dueCount(day)}
          </button>
        ) : (
          <Chip
            slot="calendar-due-chip"
            className={cn("font-medium", overdue ? "text-danger" : "text-attention")}
          >
            <ClockIcon className="size-3" aria-hidden />
            Due · {dueCount(day)}
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
      className="border-border divide-border bg-card shadow-raised divide-y overflow-hidden rounded-lg border"
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
                <span className="font-medium break-words">
                  {event.completed ? <DoneTick className="mr-1" /> : null}
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
  action,
  timeline,
  inPage = false,
  heading = true,
  headingId,
}: {
  day: CalendarDay;
  today: ISODate;
  /** The day's action (the route's: Suggest a task); null for none. */
  action: ReactNode;
  /**
   * The timed events on an hour timeline (the phone, the sheet); the laptop Day's side column has
   * the timeline beside it and lists them instead.
   */
  timeline: boolean;
  /**
   * The phone's week and compact month (PP-light-4, V5b, replacing the owner's 2026-10-08 fill):
   * the day is part of the page, which scrolls; the hour timeline draws only the hours around the
   * day's timed events, with no scroll of its own, and the day's other rows follow it.
   */
  inPage?: boolean;
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
  return (
    <section
      aria-labelledby={heading ? headingId : undefined}
      aria-label={heading ? undefined : dayHeading(day.date, today)}
      data-slot="calendar-detail"
      data-date={day.date}
      className="flex min-w-0 flex-col gap-3"
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
          <AllDayChips day={day} today={today} dueAsChip={false} avatars />
        </div>
      ) : null}
      {timed.length > 0 ? (
        timeline ? (
          <Timeline
            days={[day]}
            today={today}
            eventLink={eventLink}
            span={inPage}
            className="border-border overflow-hidden rounded-lg border"
          />
        ) : (
          <EventRows events={day.events.filter((event) => event.startAt !== null)} />
        )
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
          <ul className="border-border divide-border bg-card shadow-raised divide-y overflow-hidden rounded-lg border">
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
                      day.date < today && !item.held ? "text-danger" : "text-muted-foreground",
                    )}
                  >
                    {formatTime(item.dueAt)}
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="font-medium break-words">{item.title}</span>
                    <span className="text-muted-foreground text-xs break-words">{item.owner}</span>
                  </span>
                  {item.held ? <HeldWord /> : null}
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
      {action ? <div className="flex flex-wrap items-center gap-2">{action}</div> : null}
    </section>
  );
}
