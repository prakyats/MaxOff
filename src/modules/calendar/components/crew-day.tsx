"use client";

import { ChevronRightIcon } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/core/lib/utils";
import { OverlayLink } from "@/core/ui/composites/overlay-link";
import { formatTime, type ISODate } from "@/core/time";

import {
  type CalendarDay,
  type CalendarScope,
  dayHeading,
  type DueItem,
  EMPTY_DAY,
  type EventItem,
} from "../domain/calendar";
import { besideCrew, type CrewDay, nothingBesideCrew } from "../domain/crew";
import { agendaEvents, agendaTime } from "../domain/laptop";
import { DoneTick, HeldWord, TypeDot } from "./calendar-chip";
import { ClientItemsList } from "./client-items-list";
import { CrewSections } from "./crew-sections";
import { AllDayChips, eventLink } from "./day-detail";

/**
 * The Owner's and Admins' day (v6.0 "Admin calendar"; the approved samples `PhoneDay` and
 * `LaptopDay`): no hour timeline. The day's heading; the holiday, the weekly off and any leave
 * still **requested** as chips (approved leave is said once, in the Crew's "On leave"); the events
 * and what is due as rows, each opening its task; "Client work · n"; then, on the phone and in its
 * day sheet, the Crew (`CrewSections`). The laptop's Day draws the Crew in its own card beside
 * this (`DayView`), so `crew` is null there.
 *
 * - **phone** (`layout="phone"`): one list, "Your tasks · n" for an Admin and "Tasks · n" for the
 *   Owner, the events first and then what is due.
 * - **laptop** (`layout="laptop"`): "Your events" / "Events", then "Due · n".
 * A row is the time, the type's dot, the title with its place, then the people (an event) or its
 * owner (a due task); on a phone the time and the people go under the title.
 */

const LIST =
  "border-border divide-border bg-card shadow-raised divide-y overflow-hidden rounded-lg border";
const ROW =
  "focus-visible:ring-ring flex min-h-14 items-start gap-3 px-4 py-2.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-inset md:min-h-11 md:items-baseline";
/** The time: under the title on a phone, the row's first column from `md` up. */
const TIME = "tabular-nums md:order-1 md:w-36 md:shrink-0 md:text-sm";
const DOT = "mt-1.5 size-2 md:order-2 md:mt-0";
const WORDS = "flex min-w-0 flex-1 flex-col gap-0.5 md:contents";
const TITLE = "min-w-0 font-medium break-words md:order-3 md:flex-1";
const UNDER =
  "text-muted-foreground flex min-w-0 flex-wrap gap-x-2 text-xs break-words md:contents md:text-sm";
const WHO = "min-w-0 md:order-4 md:max-w-[40%] md:text-right";
const CHEVRON = "text-muted-foreground mt-0.5 size-4 shrink-0 self-center md:order-6 md:mt-0";

function EventRow({ event }: { event: EventItem }) {
  // The people, and the client where the event has one (the viewer reads both already).
  const who = [event.clientName, event.people.join(", ")].filter(Boolean).join(" · ");
  return (
    <li>
      {eventLink(
        event,
        <>
          {event.completed ? (
            <DoneTick className="mt-1 md:order-2 md:mt-0" />
          ) : (
            <TypeDot color={event.color} className={DOT} />
          )}
          <span className={WORDS}>
            <span className={TITLE}>
              {event.title}
              {event.location ? (
                <span className="text-foreground/80 font-normal"> · {event.location}</span>
              ) : null}
            </span>
            <span className={UNDER}>
              <span className={cn(TIME, "md:text-foreground")}>
                {agendaTime(event.startAt, event.endAt)}
              </span>
              {who ? <span className={WHO}>{who}</span> : null}
            </span>
          </span>
          <ChevronRightIcon className={CHEVRON} aria-hidden />
        </>,
        cn(ROW, event.completed && "text-muted-foreground"),
        {},
      )}
    </li>
  );
}

function DueRow({ item, overdue }: { item: DueItem; overdue: boolean }) {
  return (
    <li>
      <OverlayLink
        href={`/tasks/${item.id}`}
        data-slot="calendar-due"
        data-task={item.id}
        data-tone={overdue && !item.held ? "overdue" : "due"}
        className={ROW}
      >
        <TypeDot color={item.color} className={DOT} />
        <span className={WORDS}>
          <span className={TITLE}>{item.title}</span>
          <span className={UNDER}>
            <span
              className={cn(TIME, overdue && !item.held ? "text-danger" : "md:text-foreground")}
            >
              {formatTime(item.dueAt)}
            </span>
            <span className={WHO}>{item.owner}</span>
          </span>
        </span>
        {item.held ? <HeldWord className="md:order-5" /> : null}
        <ChevronRightIcon className={CHEVRON} aria-hidden />
      </OverlayLink>
    </li>
  );
}

function Title({ id, slot, children }: { id: string; slot: string; children: ReactNode }) {
  return (
    <h3 id={id} data-slot={slot} className="text-sm font-semibold">
      {children}
    </h3>
  );
}

const count = (n: number) => <span className="text-muted-foreground font-medium">· {n}</span>;

export function CrewDayBody({
  day,
  today,
  scope,
  crew,
  layout,
  heading = true,
  headingId,
}: {
  day: CalendarDay;
  today: ISODate;
  scope: CalendarScope;
  /** The Crew under the day (the phone and its sheet); null where a card beside it draws them. */
  crew: CrewDay | null;
  layout: "phone" | "laptop";
  /** The day's heading; a sheet's title says it instead. */
  heading?: boolean;
  headingId: string;
}) {
  const events = agendaEvents(day);
  const overdue = day.date < today;
  // Approved leave is the Crew's "On leave"; a request still waiting keeps its chip.
  const shown = besideCrew(day);
  const chips = day.holiday !== null || day.weeklyOff || shown.leave.length > 0;
  const tasks = events.length + day.due.length;
  const own = scope === "admin" ? "Your " : "";
  const eventRows = events.map((event) => <EventRow key={event.id} event={event} />);
  const dueRows = day.due.map((item) => <DueRow key={item.id} item={item} overdue={overdue} />);
  return (
    <section
      aria-labelledby={heading ? headingId : undefined}
      aria-label={heading ? undefined : dayHeading(day.date, today)}
      data-slot="calendar-detail"
      data-date={day.date}
      className="flex min-w-0 flex-col gap-3"
    >
      {heading ? (
        <h2
          id={headingId}
          data-slot="calendar-day-title"
          className={cn("font-semibold", layout === "laptop" ? "text-base" : "text-sm")}
        >
          {dayHeading(day.date, today)}
        </h2>
      ) : null}
      {nothingBesideCrew(day) ? (
        <p data-slot="calendar-empty-day" className="text-muted-foreground text-sm">
          {EMPTY_DAY}
        </p>
      ) : null}
      {chips ? (
        <div data-slot="calendar-all-day" className="flex flex-wrap items-center gap-1.5">
          <AllDayChips day={shown} today={today} dueAsChip={false} events={false} avatars />
        </div>
      ) : null}
      {layout === "phone" ? (
        tasks > 0 ? (
          <section
            aria-labelledby={`${headingId}-tasks`}
            data-slot="calendar-tasks"
            className="flex flex-col gap-2"
          >
            <Title id={`${headingId}-tasks`} slot="calendar-tasks-title">
              {own ? "Your tasks" : "Tasks"} {count(tasks)}
            </Title>
            <ul className={LIST}>
              {eventRows}
              {dueRows}
            </ul>
          </section>
        ) : null
      ) : (
        <>
          {events.length > 0 ? (
            <section
              aria-labelledby={`${headingId}-events`}
              data-slot="calendar-events"
              className="flex flex-col gap-2"
            >
              <Title id={`${headingId}-events`} slot="calendar-events-title">
                {own ? "Your events" : "Events"}
              </Title>
              <ul className={LIST}>{eventRows}</ul>
            </section>
          ) : null}
          {day.due.length > 0 ? (
            <section
              aria-labelledby={`${headingId}-due`}
              data-slot="calendar-due-list"
              className="flex flex-col gap-2"
            >
              <Title id={`${headingId}-due`} slot="calendar-due-title">
                Due {count(day.due.length)}
              </Title>
              <ul className={LIST}>{dueRows}</ul>
            </section>
          ) : null}
        </>
      )}
      {day.items.length > 0 ? (
        <ClientItemsList items={day.items} headingId={`${headingId}-items`} late={overdue} />
      ) : null}
      {crew ? <CrewSections crew={crew} look="phone" headingId={`${headingId}-people`} /> : null}
    </section>
  );
}
