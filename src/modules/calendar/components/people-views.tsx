"use client";

import type { ReactNode } from "react";

import type { ISODate } from "@/core/time";
import { StickyActions } from "@/core/ui/composites/sticky-actions";
import { markLive } from "@/core/ui/navigation/attributes";

import { type CalendarDay, type CalendarScope, weekLabel } from "../domain/calendar";
import { type CrewSource, crewOn } from "../domain/crew";
import { CrewDayBody } from "./crew-day";
import { DayView } from "./day-view";
import { WeekTable } from "./week-table";

/**
 * The Owner's and Admins' calendar parts that came with v6.0 "Admin calendar" (the Crew's Busy /
 * On leave / Free), as **one chunk outside the calendar's first-load JS** (ARCHITECTURE §19: the
 * route's budget is never raised): the screen loads it with `next/dynamic`, so it is in the
 * server's HTML (nothing moves when it hydrates) and Crew, who get none of it, never load it.
 * - `phone`: the day under the week strip or the compact month, with "+ New task on ‹day›" pinned
 *   in a bar above the bottom bar (`StickyActions`: the page reserves its height, so the day's
 *   last row is never under it);
 * - `day`: the laptop's Day (`DayView`);
 * - `week`: the laptop's Week (`WeekTable`).
 * Each part's root is marked live once React owns it (`markLive`), so a test knows its buttons
 * answer.
 */
export function CrewViews({
  part,
  days,
  selected,
  today,
  scope,
  crew,
  action,
  onDay,
}: {
  part: "phone" | "day" | "week";
  /** The week of the selected day, Monday first. */
  days: readonly CalendarDay[];
  selected: ISODate;
  today: ISODate;
  scope: CalendarScope;
  crew: CrewSource;
  /** The day's action in this part's look: the phone's bar, the Day's card; none on the Week. */
  action: ReactNode;
  /** The phone never calls it; a pill shows its day, a Week row opens the Day view on it. */
  onDay: (date: ISODate) => void;
}) {
  const first = days[0];
  const last = days[days.length - 1];
  const day = days.find((entry) => entry.date === selected) ?? first;
  if (!first || !last || !day) return null;
  return (
    <div ref={markLive} data-people-part={part} className="min-w-0">
      {part === "week" ? (
        <WeekTable
          days={days}
          today={today}
          label={weekLabel({ from: first.date, to: last.date })}
          crewOf={(date) => crewOn(crew, date)}
          onDay={onDay}
        />
      ) : part === "day" ? (
        <DayView
          days={days}
          selected={selected}
          today={today}
          scope={scope}
          crew={crewOn(crew, selected)}
          action={action}
          onDay={onDay}
        />
      ) : (
        <>
          <CrewDayBody
            day={day}
            today={today}
            scope={scope}
            crew={crewOn(crew, selected)}
            layout="phone"
            headingId="calendar-phone-day"
          />
          {action ? <StickyActions className="md:hidden">{action}</StickyActions> : null}
        </>
      )}
    </div>
  );
}
