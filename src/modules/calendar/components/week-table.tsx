"use client";

import { ROLE_LABELS } from "@/core/lib/role-labels";
import { cn } from "@/core/lib/utils";
import type { ISODate } from "@/core/time";
import { markLive } from "@/core/ui/navigation/attributes";

import { type CalendarDay, dueCount } from "../domain/calendar";
import { type CrewDay, freeSummary, leaveName, shortDayName, weekEvents } from "../domain/crew";
import { dayLabel } from "../domain/strips";

/**
 * The laptop's **Week** for the Owner and Admins (v6.0 "Admin calendar"; the approved sample
 * `LaptopWeek`), in place of the seven-column timeline: a table, one row a day. **Day** ("Sat 14",
 * "Today" under today's, whose row is tinted); **Events · due** (the titles of the events the
 * viewer can see, then how many are due; a weekly off or a holiday says so); **Crew busy** (one
 * line a booking: the person, the type, the time and who booked it; "Nobody busy"); **On leave**;
 * **Free** ("Everyone", up to two names, or how many). A click anywhere on a row, or Enter on its
 * day, opens that day's Day view (view state: replace, never history, ARCHITECTURE §14.2 d).
 */

const HEAD = "px-3 py-2.5 text-left text-xs font-semibold tracking-wide uppercase";
const CELL = "px-3 py-3 align-top break-words";
/** An empty cell, as the sample draws it; a screen reader hears "None". */
const NONE = (
  <>
    <span aria-hidden>·</span>
    <span className="sr-only">None</span>
  </>
);

export function WeekTable({
  days,
  today,
  label,
  crewOf,
  onDay,
}: {
  days: readonly CalendarDay[];
  today: ISODate;
  /** "9 – 15 Nov 2026": the table's name. */
  label: string;
  crewOf: (date: ISODate) => CrewDay;
  onDay: (date: ISODate) => void;
}) {
  return (
    <div data-slot="calendar-week-view" className="flex min-w-0 flex-col gap-3">
      <div className="border-border overflow-hidden rounded-xl border">
        <table
          aria-label={`Week of ${label}`}
          data-slot="calendar-week-table"
          className="w-full table-fixed text-sm"
        >
          <colgroup>
            <col className="w-24" />
            <col className="w-[26%]" />
            <col />
            <col className="w-[16%]" />
            <col className="w-[14%]" />
          </colgroup>
          <thead className="bg-muted/50 text-muted-foreground">
            <tr>
              <th scope="col" className={HEAD}>
                Day
              </th>
              <th scope="col" className={HEAD}>
                Events · due
              </th>
              <th scope="col" className={HEAD}>
                {ROLE_LABELS.staff} busy
              </th>
              <th scope="col" className={HEAD}>
                On leave
              </th>
              <th scope="col" className={HEAD}>
                Free
              </th>
            </tr>
          </thead>
          <tbody className="divide-border divide-y">
            {days.map((day) => {
              const crew = crewOf(day.date);
              const cell = weekEvents({ ...day, due: dueCount(day) });
              // A day off with nobody booked or away: nothing to say about the Crew.
              const quiet =
                cell.off !== null && crew.busy.length === 0 && crew.onLeave.length === 0;
              const what = [cell.off, cell.titles].filter(Boolean).join(" · ");
              return (
                <tr
                  key={day.date}
                  data-slot="calendar-week-row"
                  data-date={day.date}
                  data-today={day.date === today ? "" : undefined}
                  onClick={() => onDay(day.date)}
                  className={cn(
                    "pressable-row hover:bg-muted/60 cursor-pointer",
                    day.date === today && "bg-today",
                    cell.off !== null && "text-muted-foreground",
                  )}
                >
                  <th scope="row" className={cn(CELL, "text-left font-semibold")}>
                    <button
                      type="button"
                      ref={markLive}
                      data-hold-tap={`week:${day.date}`}
                      data-slot="calendar-week-day"
                      data-date={day.date}
                      aria-label={`Open ${dayLabel(day, today)}`}
                      aria-current={day.date === today ? "date" : undefined}
                      className="pressable focus-visible:ring-ring -mx-1 rounded-md px-1 text-left font-semibold outline-none focus-visible:ring-2"
                    >
                      {shortDayName(day.date)}
                      {day.date === today ? (
                        <span className="text-muted-foreground block text-xs font-normal">
                          Today
                        </span>
                      ) : null}
                    </button>
                  </th>
                  <td data-slot="calendar-week-events" className={CELL}>
                    {what}
                    {cell.due ? (
                      <span className="text-muted-foreground">
                        {what ? " · " : ""}
                        {cell.due}
                      </span>
                    ) : null}
                    {!what && !cell.due ? NONE : null}
                  </td>
                  <td data-slot="calendar-week-busy" className={CELL}>
                    {quiet ? (
                      NONE
                    ) : crew.busy.length === 0 ? (
                      <span className="text-muted-foreground">Nobody busy</span>
                    ) : (
                      <ul className="flex flex-col gap-1">
                        {crew.busy.map((row, index) => (
                          <li key={`${row.memberId}-${index}`} data-slot="calendar-booking">
                            <span className="text-foreground font-medium">{row.name}</span>
                            <span className="text-muted-foreground">
                              {" · "}
                              {row.typeName}
                              {" · "}
                              <span className="tabular-nums">{row.when}</span>
                              {row.bookedBy ? ` · ${row.bookedBy}` : ""}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </td>
                  <td data-slot="calendar-week-leave" className={CELL}>
                    {crew.onLeave.length > 0 ? crew.onLeave.map(leaveName).join(", ") : NONE}
                  </td>
                  <td data-slot="calendar-week-free" className={CELL}>
                    {quiet || crew.people === 0 ? NONE : freeSummary(crew)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p data-slot="calendar-week-help" className="text-muted-foreground text-sm">
        Click a day to open it with every detail. Busy shows the type, the time and who booked it,
        nothing else.
      </p>
    </div>
  );
}
