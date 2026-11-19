"use client";

import type { ReactNode } from "react";

import { ROLE_LABELS } from "@/core/lib/role-labels";
import { cn } from "@/core/lib/utils";
import type { ISODate } from "@/core/time";
import { markLive } from "@/core/ui/navigation/attributes";

import type { CalendarDay, CalendarScope } from "../domain/calendar";
import { type CrewDay, shortDayName } from "../domain/crew";
import { dayLabel } from "../domain/strips";
import { CrewDayBody } from "./crew-day";
import { CrewSections } from "./crew-sections";

/**
 * The laptop's **Day** for the Owner and Admins (v6.0 "Admin calendar"; the approved sample
 * `LaptopDay`), in place of the hour timeline: the week's seven days as pills ("Mon 9", the day on
 * screen solid; a click shows that day, view state, never history: ARCHITECTURE §14.2 d), then two
 * columns. **Left**, the day (`CrewDayBody`): its heading, the holiday or weekly off, "Your events"
 * / "Events", "Due · n", "Client work · n". **Right**, the Crew's card ("Crew · Sat 14": Busy, On
 * leave, Free) with the day's action under it ("+ New task on Sat 14 Nov", outlined: the card's
 * one action, a trigger that opens a form). The page scrolls; nothing here has a scroll of its own.
 */
export function DayView({
  days,
  selected,
  today,
  scope,
  crew,
  action,
  onDay,
}: {
  /** The week of the day on screen, Monday first. */
  days: readonly CalendarDay[];
  selected: ISODate;
  today: ISODate;
  scope: CalendarScope;
  crew: CrewDay;
  /** "+ New task on ‹day›", or none (a past day). */
  action: ReactNode;
  onDay: (date: ISODate) => void;
}) {
  const day = days.find((entry) => entry.date === selected) ?? days[0];
  if (!day) return null;
  return (
    <div data-slot="calendar-day-view" className="flex min-w-0 flex-col gap-4">
      <ol
        aria-label="This week"
        data-slot="calendar-day-pills"
        className="grid grid-cols-7 gap-1.5"
      >
        {days.map((entry) => {
          const chosen = entry.date === selected;
          return (
            <li key={entry.date} className="min-w-0">
              <button
                type="button"
                onClick={() => onDay(entry.date)}
                ref={markLive}
                data-hold-tap={`pill:${entry.date}`}
                data-slot="calendar-day-pill"
                data-date={entry.date}
                aria-pressed={chosen}
                aria-current={entry.date === today ? "date" : undefined}
                aria-label={dayLabel(entry, today)}
                className={cn(
                  "pressable focus-visible:ring-ring flex min-h-8 w-full items-center justify-center rounded-lg px-1 text-xs whitespace-nowrap outline-none focus-visible:ring-2 focus-visible:ring-offset-2",
                  chosen
                    ? "bg-foreground text-background font-semibold"
                    : "bg-muted text-muted-foreground hover:text-foreground",
                  !chosen && entry.date === today && "text-foreground font-semibold",
                )}
              >
                {shortDayName(entry.date)}
              </button>
            </li>
          );
        })}
      </ol>
      <div className="flex min-w-0 items-start gap-6">
        <div className="min-w-0 flex-1">
          <CrewDayBody
            day={day}
            today={today}
            scope={scope}
            crew={null}
            layout="laptop"
            headingId="calendar-laptop-day"
          />
        </div>
        <aside
          aria-labelledby="calendar-people-title"
          data-slot="calendar-people-card"
          className="border-border bg-card shadow-raised flex w-80 shrink-0 flex-col gap-3 rounded-xl border p-4 lg:w-96"
        >
          <h2 id="calendar-people-title" className="text-base font-semibold">
            {ROLE_LABELS.staff} · {shortDayName(day.date)}
          </h2>
          <CrewSections crew={crew} look="card" headingId="calendar-booking" />
          {action}
        </aside>
      </div>
    </div>
  );
}
