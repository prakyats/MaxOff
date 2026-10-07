import {
  CalendarOffIcon,
  ChevronRightIcon,
  ClockIcon,
  MapPinIcon,
  PalmtreeIcon,
  UserXIcon,
} from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/core/lib/utils";
import { DrillLink } from "@/core/ui/composites/drill-link";
import { CARD_ROW_TITLE } from "@/core/ui/composites/row-metrics";
import { ViewLink } from "@/core/ui/composites/view-link";
import { Skeleton } from "@/core/ui/primitives/skeleton";
import { formatIST, istDayStart, type ISODate } from "@/core/time";

import {
  type BusyItem,
  type CalendarDay,
  type CalendarQuery,
  type CalendarScope,
  calendarHref,
  dayHeading,
  dayWord,
  dueWords,
  EMPTY_DAY,
  eventWords,
  type EventItem,
  isEmptyDay,
  type LeaveItem,
  leaveWords,
  type MonthGrid,
  timeWords,
} from "../domain/calendar";

/**
 * The calendar's views (6.4; Kickoff 6 decisions 13–15, 22): a day's rows (the holiday or weekly
 * off, leave, events at their time, an Admin's Busy blocks, then the Due list), the week as seven
 * such days, and the month as a grid whose day opens that day. Server components (nothing here
 * hydrates); an event row is a drill-down into its task (`DrillLink`), a month day a view change
 * (`ViewLink`). Each view has a skeleton of the same rows and heights (ARCHITECTURE §14.1).
 */

const ROW =
  "focus-visible:ring-ring flex min-h-14 items-start gap-3 px-4 py-2.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-inset";
const LINE = "flex min-h-11 items-center gap-3 px-4 py-2 text-sm";

function DayList({ label, slot, children }: { label: string; slot: string; children: ReactNode }) {
  return (
    <ul
      aria-label={label}
      data-slot={slot}
      className="border-border divide-border bg-card divide-y overflow-hidden rounded-lg border"
    >
      {children}
    </ul>
  );
}

/** One event task: the time, the title, where and with whom; muted once completed. */
function EventRow({ event }: { event: EventItem }) {
  const under = [event.location, event.clientName, event.people.join(", ")].filter(Boolean);
  return (
    <li
      data-slot="calendar-event"
      data-task={event.id}
      data-completed={event.completed ? "" : undefined}
    >
      <DrillLink
        href={`/tasks/${event.id}`}
        className={cn(ROW, event.completed && "text-muted-foreground")}
      >
        <span className="text-muted-foreground w-24 shrink-0 pt-px text-xs tabular-nums">
          {timeWords(event.startAt, event.endAt)}
        </span>
        <span className={cn("flex flex-col gap-0.5", CARD_ROW_TITLE)}>
          <span className={cn("font-medium break-words", event.completed && "line-through")}>
            {event.title}
          </span>
          {under.length > 0 ? (
            <span className="text-muted-foreground flex flex-wrap items-center gap-x-2 text-xs break-words">
              {event.location ? (
                <span className="inline-flex items-center gap-1">
                  <MapPinIcon className="size-3 shrink-0" aria-hidden />
                  {event.location}
                </span>
              ) : null}
              {event.clientName ? <span>{event.clientName}</span> : null}
              {event.people.length > 0 ? <span>{event.people.join(", ")}</span> : null}
            </span>
          ) : null}
        </span>
        <ChevronRightIcon className="text-muted-foreground mt-0.5 size-4 shrink-0" aria-hidden />
      </DrillLink>
    </li>
  );
}

/** An Admin's view of someone else's event: the name and the time, nothing else. */
function BusyRow({ block }: { block: BusyItem }) {
  return (
    <li data-slot="calendar-busy" data-member={block.memberId} className={LINE}>
      <span className="text-muted-foreground w-24 shrink-0 text-xs tabular-nums">
        {timeWords(block.startAt, block.endAt)}
      </span>
      <span className={cn("flex flex-wrap items-center gap-x-2", CARD_ROW_TITLE)}>
        <span className="font-medium">Busy</span>
        <span className="text-muted-foreground">{block.name}</span>
      </span>
    </li>
  );
}

function LeaveRow({ item }: { item: LeaveItem }) {
  return (
    <li
      data-slot="calendar-leave"
      data-member={item.memberId}
      data-pending={item.pending ? "" : undefined}
      className={LINE}
    >
      <PalmtreeIcon className="text-muted-foreground size-4 shrink-0" aria-hidden />
      <span className={cn("flex flex-wrap items-center gap-x-2", CARD_ROW_TITLE)}>
        <span className="font-medium">{item.own ? "You" : item.name}</span>
        <span className="text-muted-foreground">
          {item.label}
          {item.pending ? " · requested" : ""}
        </span>
      </span>
    </li>
  );
}

function DueRow({ item }: { item: CalendarDay["due"][number] }) {
  return (
    <li data-slot="calendar-due" data-task={item.id}>
      <DrillLink href={`/tasks/${item.id}`} className={ROW}>
        <span className="text-muted-foreground w-24 shrink-0 pt-px text-xs tabular-nums">
          {formatIST(item.dueAt, "h:mm aaa")}
        </span>
        <span className={cn("flex flex-col gap-0.5", CARD_ROW_TITLE)}>
          <span className="font-medium break-words">{item.title}</span>
          <span className="text-muted-foreground text-xs break-words">{item.owner}</span>
        </span>
        <ChevronRightIcon className="text-muted-foreground mt-0.5 size-4 shrink-0" aria-hidden />
      </DrillLink>
    </li>
  );
}

/**
 * A day's rows: the holiday or weekly off line, leave, events and Busy blocks in time order, then
 * the Due list under its own heading. An empty day says so (decision 22).
 */
export function DayRows({ day, scope }: { day: CalendarDay; scope: CalendarScope }) {
  if (isEmptyDay(day)) {
    return (
      <p data-slot="calendar-empty-day" className="text-muted-foreground px-1 text-sm">
        {EMPTY_DAY}
      </p>
    );
  }
  const timed = [...day.events, ...day.busy].sort(
    (a, b) =>
      (a.startAt ? new Date(a.startAt).getTime() : -1) -
      (b.startAt ? new Date(b.startAt).getTime() : -1),
  );
  return (
    <div className="flex flex-col gap-3">
      {day.holiday || day.weeklyOff || day.leave.length > 0 ? (
        <DayList label="Days off and leave" slot="calendar-day-off">
          {day.holiday ? (
            <li data-slot="calendar-holiday" className={LINE}>
              <CalendarOffIcon className="text-muted-foreground size-4 shrink-0" aria-hidden />
              <span className={cn("flex flex-wrap items-center gap-x-2", CARD_ROW_TITLE)}>
                <span className="font-medium">Holiday</span>
                <span className="text-muted-foreground">{day.holiday}</span>
              </span>
            </li>
          ) : null}
          {day.weeklyOff ? (
            <li data-slot="calendar-weekly-off" className={LINE}>
              <UserXIcon className="text-muted-foreground size-4 shrink-0" aria-hidden />
              <span className="font-medium">Weekly off</span>
            </li>
          ) : null}
          {day.leave.map((item) => (
            <LeaveRow key={`${item.memberId}-${item.label}-${item.pending}`} item={item} />
          ))}
        </DayList>
      ) : null}
      {timed.length > 0 ? (
        <DayList
          label={scope === "admin" ? "Events and busy times" : "Events"}
          slot="calendar-events"
        >
          {timed.map((item) =>
            item.kind === "event" ? (
              <EventRow key={item.id} event={item} />
            ) : (
              <BusyRow key={`${item.memberId}-${item.startAt}`} block={item} />
            ),
          )}
        </DayList>
      ) : null}
      {day.due.length > 0 ? (
        <section
          aria-labelledby={`due-${day.date}`}
          data-slot="calendar-due-list"
          className="flex flex-col gap-2"
        >
          <h3 id={`due-${day.date}`} className="flex items-center gap-1.5 text-sm font-semibold">
            <ClockIcon className="text-muted-foreground size-4" aria-hidden />
            Due
            <span className="text-muted-foreground font-normal"> · {day.due.length}</span>
          </h3>
          <DayList label="Due this day" slot="calendar-due-rows">
            {day.due.map((item) => (
              <DueRow key={item.id} item={item} />
            ))}
          </DayList>
        </section>
      ) : null}
    </div>
  );
}

/** The Day view: the chosen day's heading and rows. */
export function DayView({
  day,
  today,
  scope,
}: {
  day: CalendarDay;
  today: ISODate;
  scope: CalendarScope;
}) {
  return (
    <section
      aria-labelledby="calendar-day-title"
      data-slot="calendar-day"
      className="flex flex-col gap-2"
    >
      <h2 id="calendar-day-title" className="flex h-5 items-center text-sm font-semibold">
        {dayHeading(day.date, today)}
      </h2>
      <DayRows day={day} scope={scope} />
    </section>
  );
}

/** The Week view: the seven days, each its heading, its rows, and its Due as a count. */
export function WeekView({
  days,
  today,
  query,
  scope,
}: {
  days: readonly CalendarDay[];
  today: ISODate;
  query: CalendarQuery;
  scope: CalendarScope;
}) {
  return (
    <div data-slot="calendar-week" className="flex flex-col gap-6">
      {days.map((day) => {
        const counted = { ...day, due: [] };
        return (
          <section
            key={day.date}
            aria-labelledby={`week-${day.date}`}
            data-slot="calendar-week-day"
            data-date={day.date}
            className="flex flex-col gap-2"
          >
            <div className="flex min-h-5 flex-wrap items-center justify-between gap-x-3">
              <h2 id={`week-${day.date}`} className="text-sm font-semibold">
                {dayWord(day.date, today)}
                {day.date === today ? (
                  <span className="text-muted-foreground font-normal">
                    {" "}
                    · {formatIST(istDayStart(day.date), "EEE d MMM")}
                  </span>
                ) : null}
              </h2>
              {day.due.length > 0 ? (
                <ViewLink
                  href={calendarHref({ ...query, view: "day", date: day.date }, today)}
                  scroll={false}
                  data-slot="calendar-due-count"
                  className="text-muted-foreground hover:text-foreground flex min-h-11 items-center gap-1 text-xs"
                >
                  <ClockIcon className="size-3.5" aria-hidden />
                  {dueWords(day.due.length)}
                </ViewLink>
              ) : null}
            </div>
            <DayRows day={counted} scope={scope} />
          </section>
        );
      })}
    </div>
  );
}

/**
 * The Month view: a Monday-to-Sunday grid; each day shows what it holds as counts (events, on
 * leave, due) and a holiday's name, and opens that day. Days of the neighbouring months are dimmed.
 */
export function MonthView({
  grid,
  days,
  today,
  query,
}: {
  grid: MonthGrid;
  days: readonly CalendarDay[];
  today: ISODate;
  query: CalendarQuery;
}) {
  const byDate = new Map(days.map((day) => [day.date, day]));
  return (
    <div data-slot="calendar-month" className="flex flex-col gap-1">
      <ol aria-hidden className="grid grid-cols-7 gap-1">
        {grid.weeks[0]?.map((date) => (
          <li
            key={date}
            className="text-muted-foreground px-1 text-center text-[11px] leading-4 uppercase"
          >
            {formatIST(istDayStart(date), "EEEEE")}
          </li>
        ))}
      </ol>
      {grid.weeks.map((week, index) => (
        <ol key={index} className="grid grid-cols-7 gap-1" aria-label={`Week ${index + 1}`}>
          {week.map((date) => {
            const day = byDate.get(date);
            const inMonth = date.slice(0, 7) === grid.month.slice(0, 7);
            const counts: string[] = [];
            if (day) {
              if (day.events.length + day.busy.length > 0)
                counts.push(eventWords(day.events.length + day.busy.length));
              if (day.leave.length > 0) counts.push(leaveWords(day.leave.length));
              if (day.due.length > 0) counts.push(dueWords(day.due.length));
            }
            return (
              <li key={date} className="min-w-0">
                <ViewLink
                  href={calendarHref({ ...query, view: "day", date }, today)}
                  scroll={false}
                  aria-label={formatIST(istDayStart(date), "EEEE d MMMM")}
                  data-slot="calendar-month-day"
                  data-date={date}
                  className={cn(
                    "focus-visible:ring-ring flex min-h-16 flex-col gap-0.5 rounded-lg border px-1 py-1 outline-none select-none focus-visible:ring-2 md:min-h-20",
                    inMonth ? "border-border bg-card" : "border-transparent opacity-60",
                    day?.holiday || day?.weeklyOff ? "bg-muted/60" : "active:bg-muted/60",
                  )}
                >
                  <span
                    className={cn(
                      "flex size-6 items-center justify-center self-start rounded-full text-sm font-semibold tabular-nums",
                      date === today && "bg-foreground text-background",
                    )}
                  >
                    {formatIST(istDayStart(date), "d")}
                  </span>
                  {day?.holiday ? (
                    <span className="text-muted-foreground truncate text-[11px] leading-4">
                      {day.holiday}
                    </span>
                  ) : null}
                  {counts.map((text) => (
                    <span
                      key={text}
                      className="text-muted-foreground truncate text-[11px] leading-4 tabular-nums"
                    >
                      {text}
                    </span>
                  ))}
                </ViewLink>
              </li>
            );
          })}
        </ol>
      ))}
    </div>
  );
}

/** The Day and Week views' skeleton: a heading line and two event rows. */
export function CalendarRowsSkeleton() {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex h-5 items-center">
        <Skeleton className="h-4 w-40" />
      </div>
      <ul
        aria-hidden
        data-slot="calendar-events"
        className="border-border divide-border bg-card divide-y overflow-hidden rounded-lg border"
      >
        {[0, 1].map((row) => (
          <li key={row} className={cn(ROW, "min-w-0")}>
            <span className="flex h-4 w-24 shrink-0 items-center pt-px">
              <Skeleton className="h-3 w-16" />
            </span>
            <span className={cn("flex flex-col gap-0.5", CARD_ROW_TITLE)}>
              <span className="flex h-5 min-w-0 items-center">
                <Skeleton className="h-4 w-40 max-w-full" />
              </span>
              <span className="flex h-4 min-w-0 items-center">
                <Skeleton className="h-3 w-28 max-w-full" />
              </span>
            </span>
            <Skeleton className="mt-0.5 size-4 shrink-0 rounded-sm" />
          </li>
        ))}
      </ul>
    </div>
  );
}
