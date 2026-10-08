"use client";

import { ClockIcon } from "lucide-react";

import { cn } from "@/core/lib/utils";
import { OverlayLink } from "@/core/ui/composites/overlay-link";
import { formatIST, type ISODate } from "@/core/time";

import { type CalendarDay, type CalendarScope, EMPTY_DAY, isEmptyDay } from "../domain/calendar";
import { agendaEvents, agendaTime } from "../domain/laptop";
import { AllDayChips, eventLink } from "./day-detail";

/**
 * The laptop's day popup body (a Month day, a Week heading or a "Due · N"; the owner's
 * 2026-10-08 laptop changes to decision 25 D): no timeline, a compact agenda. The holiday, the
 * weekly off and leave on one line; the events in time order, one line each ("11:49–3:49 ·
 * Brand reel · Asha, Ravi · Acme", the client last so it is the first thing cut), each opening its
 * task; "Due · N" and its tasks; "Who's free" for the Owner and Admins. The dialog pins the day's
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
        <ul aria-label="Events" data-slot="calendar-agenda-events" className="flex flex-col">
          {events.map((event) => (
            <li key={event.id} className="min-w-0">
              {eventLink(
                event,
                <>
                  <span
                    aria-hidden
                    className="size-2 shrink-0 rounded-full"
                    style={{ backgroundColor: event.color }}
                  />
                  <span className="min-w-0 truncate">
                    <span className="text-muted-foreground tabular-nums">
                      {agendaTime(event.startAt, event.endAt)}
                    </span>
                    {" · "}
                    <span className={cn("font-medium", event.completed && "line-through")}>
                      {event.title}
                    </span>
                    {event.people.length > 0 ? (
                      <span className="text-muted-foreground"> · {event.people.join(", ")}</span>
                    ) : null}
                    {event.clientName ? (
                      <span className="text-muted-foreground"> · {event.clientName}</span>
                    ) : null}
                  </span>
                </>,
                cn(
                  "hover:bg-muted focus-visible:ring-ring -mx-2 flex min-h-9 items-center gap-2 rounded-md px-2 text-sm outline-none focus-visible:ring-2",
                  event.completed && "opacity-60",
                ),
                {},
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
          <ul className="flex flex-col">
            {day.due.map((item) => (
              <li key={item.id} className="min-w-0">
                <OverlayLink
                  href={`/tasks/${item.id}`}
                  data-slot="calendar-due"
                  data-task={item.id}
                  className="hover:bg-muted focus-visible:ring-ring -mx-2 flex min-h-9 items-center gap-2 rounded-md px-2 text-sm outline-none focus-visible:ring-2"
                >
                  <span className="min-w-0 truncate">
                    <span
                      className={cn(
                        "tabular-nums",
                        day.date < today ? "text-danger" : "text-muted-foreground",
                      )}
                    >
                      {formatIST(item.dueAt, "h:mm aaa")}
                    </span>
                    {" · "}
                    <span className="font-medium">{item.title}</span>
                    <span className="text-muted-foreground"> · {item.owner}</span>
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
