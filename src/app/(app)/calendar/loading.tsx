import { getCurrentMember } from "@/core/auth/server";
import { can } from "@/core/permissions";
import { todayIST } from "@/core/time";
import { monthGrid } from "@/modules/calendar";

import { SERVER_PARTS } from "../skeleton-parts";
import { CalendarLoading } from "./calendar-loading";

/**
 * The calendar while it loads (`CalendarLoading`, also what a tap draws before the router answers,
 * v7.0), on today's month's rows.
 */
export default async function Loading() {
  const opening = monthGrid(todayIST());
  // The `(app)` layout already read the member (`cache()`), so asking costs no query. The switch
  // is the Owner's and Admins' (`scopeFor`: whoever sees others' availability).
  const member = await getCurrentMember();
  const switcher =
    member !== null &&
    (can(member.role, "attendance.view_all") || can(member.role, "availability.view"));
  return (
    <CalendarLoading
      parts={SERVER_PARTS}
      weeks={opening.weeks.length}
      month={opening.month}
      switcher={switcher}
    />
  );
}
