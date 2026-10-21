"use client";

import { ClockIcon, ListChecksIcon } from "lucide-react";

import { cn } from "@/core/lib/utils";
import { OverlayLink } from "@/core/ui/composites/overlay-link";
import { formatTime, type ISODate } from "@/core/time";

import { type CalendarDay, type CalendarScope, EMPTY_DAY, isEmptyDay } from "../domain/calendar";
import { agendaEvents, agendaTime } from "../domain/laptop";
import { DoneTick, DUE_TONE, DueIcon, typeTint } from "./calendar-chip";
import { AllDayChips, eventLink } from "./day-detail";

/**
 * The laptop's day popup body (a Month day, a Week heading or a "Due · N"; the owner's
 * 2026-10-08 laptop changes to decision 25 D): no timeline, a compact agenda. The holiday, the
 * weekly off and leave on one line; the events in time order, one chip each in the month's look
 * (PP-calendar-8, V5b: `calendar-chip`, title first, "Brand reel · 11:49 am – 3:49 pm · Asha, Ravi ·
 * Acme", the client last so it is the first thing cut), each opening its task; "Due · N" and its
 * tasks as amber chips (red overdue); the day's deliverables as the same chips (done: dimmed, ✓); the availability line for the Owner
 * and Admins ("On leave", "Busy all day" or "Everyone is available"). The dialog pins the day's
 * buttons in its footer and scrolls this body only when the day is very full.
 */
export function DayAgenda({
  day,
  today,
  scope,
  free,
}: {
  day: CalendarDay;
  today: ISODate;
  scope: CalendarScope;
  free: string | null;
}) {
  const events = agendaEvents(day);
  const hasAllDay = day.holiday !== null || day.weeklyOff || day.leave.length > 0;
  const tone = day.date < today ? "overdue" : "due";
  return (
    <section
      aria-label="The day"
      data-slot="calendar-agenda"
      data-date={day.date}
      className="flex min-w-0 flex-col gap-3"
    >
      {isEmptyDay(day) ? (
        <p data-slot="calendar-empty-day" className="text-muted-foreground text-sm">
          {EMPTY_DAY}
        </p>
      ) : null}
      {hasAllDay ? (
        <div data-slot="calendar-all-day" className="flex flex-wrap items-center gap-1.5">
          <AllDayChips day={day} today={today} dueAsChip={false} events={false} />
        </div>
      ) : null}
      {events.length > 0 ? (
        <ul aria-label="Events" data-slot="calendar-agenda-events" className="flex flex-col gap-1">
          {events.map((event) => (
            <li key={event.id} className="min-w-0">
              {eventLink(
                event,
                <>
                  {event.completed ? <DoneTick /> : null}
                  <span className="min-w-0 truncate">
                    <span className="font-medium">{event.title}</span>
                    {" · "}
                    <span className="tabular-nums">{agendaTime(event.startAt, event.endAt)}</span>
                    {event.people.length > 0 ? <span> · {event.people.join(", ")}</span> : null}
                    {event.clientName ? <span> · {event.clientName}</span> : null}
                  </span>
                </>,
                cn(
                  "focus-visible:ring-ring flex min-h-9 items-center gap-1.5 rounded-md border-l-4 px-2 text-sm outline-none hover:brightness-95 focus-visible:ring-2",
                  event.completed && "opacity-60",
                ),
                typeTint(event.color),
              )}
            </li>
          ))}
        </ul>
      ) : null}
      {day.due.length > 0 ? (
        <section
          aria-labelledby={`agenda-${day.date}-due`}
          data-slot="calendar-due-list"
          className="flex flex-col gap-1"
        >
          <h3
            id={`agenda-${day.date}-due`}
            className="flex items-center gap-1.5 text-sm font-semibold"
          >
            <ClockIcon className="text-muted-foreground size-4" aria-hidden />
            Due · {day.due.length}
          </h3>
          <ul className="flex flex-col gap-1">
            {day.due.map((item) => (
              <li key={item.id} className="min-w-0">
                <OverlayLink
                  href={`/tasks/${item.id}`}
                  data-slot="calendar-due"
                  data-task={item.id}
                  data-tone={tone}
                  className={cn(
                    "focus-visible:ring-ring flex min-h-9 items-center gap-1.5 rounded-md border-l-4 px-2 text-sm outline-none hover:brightness-95 focus-visible:ring-2",
                    DUE_TONE[tone],
                  )}
                  style={{ borderLeftColor: item.color }}
                >
                  <DueIcon tone={tone} />
                  <span className="min-w-0 truncate">
                    <span className="font-medium">{item.title}</span>
                    <span className="tabular-nums"> · {formatTime(item.dueAt)}</span>
                    <span> · {item.owner}</span>
                  </span>
                </OverlayLink>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {day.items.length > 0 ? (
        <section
          aria-labelledby={`agenda-${day.date}-items`}
          data-slot="calendar-items-list"
          className="flex flex-col gap-1"
        >
          <h3
            id={`agenda-${day.date}-items`}
            className="flex items-center gap-1.5 text-sm font-semibold"
          >
            <ListChecksIcon className="text-muted-foreground size-4" aria-hidden />
            Deliverables · {day.items.length}
          </h3>
          <ul className="flex flex-col gap-1">
            {day.items.map((item) => (
              <li key={item.id} className="min-w-0">
                <OverlayLink
                  href={item.href}
                  data-slot="calendar-item"
                  data-item={item.id}
                  className={cn(
                    "focus-visible:ring-ring flex min-h-9 items-center gap-1.5 rounded-md border-l-4 px-2 text-sm outline-none hover:brightness-95 focus-visible:ring-2",
                    item.done ? "bg-muted text-muted-foreground border-l-border" : DUE_TONE[tone],
                  )}
                >
                  {item.done ? <DoneTick /> : <DueIcon tone={tone} />}
                  <span className="min-w-0 truncate">
                    <span className="font-medium">{item.title}</span> · {item.project} ·{" "}
                    {item.client}
                  </span>
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
    </section>
  );
}
