import type { ReactNode } from "react";

/**
 * Where a day's action is drawn: a pill in the phone's day (under the week or compact month) and
 * in the laptop's day dialog's footer; `row`, the pinned row at the foot of the laptop's Day and a
 * phone's day sheet (v1.9 W5).
 */
export type DayActionLook = "pill" | "row";

/**
 * The pinned row at the foot of a day (v1.9 W5, the approved v1.9 sample §4): "+ New task on Fri
 * 30 Oct" for the Owner and Admins, "Suggest a task on Fri 30 Oct" for Crew, under the day's one
 * scroll and never scrolled to; a dashed line above it, the row itself the button. No action (a
 * past day, today from 11:59 pm IST): no row at all.
 */
export function pinnedAction(action: ReactNode): ReactNode {
  if (action === null || action === undefined || action === false) return null;
  return (
    <div
      data-slot="calendar-day-action"
      className="border-border flex min-w-0 shrink-0 items-center border-t border-dashed"
    >
      {action}
    </div>
  );
}
