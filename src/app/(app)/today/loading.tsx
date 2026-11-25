import { getCurrentMember } from "@/core/auth/server";
import { can } from "@/core/permissions";
import { todayIST } from "@/core/time";
import { dateLine, dayContext } from "@/modules/dashboards";

import { SERVER_PARTS } from "../skeleton-parts";
import { TodaySkeleton } from "./today-skeleton";

/**
 * Today while it loads, per role (`TodaySkeleton`, also what a tap draws before the router
 * answers, v7.0). The `(app)` layout already read the member for this request (`cache()`), so
 * asking costs no query.
 */
export default async function Loading() {
  const member = await getCurrentMember();
  const today = todayIST();
  return (
    <TodaySkeleton
      parts={SERVER_PARTS}
      owner={member !== null && can(member.role, "attendance.view_all")}
      strip={member !== null && can(member.role, "attendance.self")}
      context={dayContext(today, member?.name)}
      line={dateLine(today)}
    />
  );
}
