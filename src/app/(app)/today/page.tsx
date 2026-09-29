import { LayoutDashboardIcon } from "lucide-react";
import type { Metadata } from "next";

import { requireMember } from "@/core/auth/server";
import { startEarly } from "@/core/lib/start-early";
import { can } from "@/core/permissions";
import { todayIST } from "@/core/time";
import {
  getOwnToday,
  getTodayPeople,
  PeopleBoard,
  summariseToday,
  TodayAttendanceCard,
  TodayAttendanceStrip,
} from "@/modules/attendance";

import { getClaimSetup } from "@/modules/expenses";
import { EndDayClaims } from "@/modules/expenses/components/end-day-claims";

import { PlaceholderPage } from "../_placeholder/placeholder-page";

export const metadata: Metadata = { title: "Today" };

/**
 * Owner Today (task 6.2) and the Admin dashboard (task 6.3) share this route. Admins mark
 * attendance too (`attendance.self`), so they get the one-line attendance strip on top (2.3
 * polish; Start day / End day since 3b.1). The Owner has no day of their own; since 2.4 they
 * get **Today's attendance** (the four counts, tapping through to Approvals) and the **people
 * board** under it (`attendance.view_all`). Both stay when 6.2 builds the rest of the screen.
 */
export default async function TodayPage() {
  // The Owner's board, an Admin's own day and End day's claim setup start with the session read, not after it (§19):
  // the role is not known yet, and the one this viewer doesn't need is dropped.
  startEarly(getTodayPeople(), getOwnToday(), getClaimSetup());
  const viewer = await requireMember();
  const marksAttendance = can(viewer.role, "attendance.self");
  const seesEveryone = can(viewer.role, "attendance.view_all");
  const today = seesEveryone ? await getTodayPeople() : null;
  const summary = today ? summariseToday(today.people, today.isDayOff) : null;
  return (
    <PlaceholderPage
      greet={viewer.name}
      title="Today"
      description="What needs to happen next: approvals, people, today's tasks and risks."
      task="6.2 (Owner) and 6.3 (Admin)"
      icon={LayoutDashboardIcon}
    >
      {marksAttendance ? (
        <TodayAttendanceStrip
          endDayFollowUp={
            // End day's "Any expenses to claim today?" (3b.3): the claim form's setup is a
            // promise, read only if the person answers Yes.
            <EndDayClaims today={todayIST()} setup={getClaimSetup().catch(() => null)} />
          }
        />
      ) : null}
      {summary ? (
        <>
          <TodayAttendanceCard summary={summary} />
          <PeopleBoard summary={summary} />
        </>
      ) : null}
    </PlaceholderPage>
  );
}
