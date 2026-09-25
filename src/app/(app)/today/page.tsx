import { LayoutDashboardIcon } from "lucide-react";
import type { Metadata } from "next";

import { LogoutRow } from "@/core/auth/components/logout-button";
import { requireMember } from "@/core/auth/server";
import { can } from "@/core/permissions";
import {
  getTodayPeople,
  PeopleBoard,
  summariseToday,
  TodayAttendanceCard,
  TodayAttendanceStrip,
} from "@/modules/attendance";

import { PlaceholderPage } from "../_placeholder/placeholder-page";

export const metadata: Metadata = { title: "Today" };

/**
 * Owner Today (task 6.2) and the Admin dashboard (task 6.3) share this route. Admins mark
 * attendance too (`attendance.self`), so they get the one-line attendance strip on top and the
 * quiet Log out row at the bottom (2.3 polish). The Owner has no day of their own; since 2.4 they
 * get **Today's attendance** (the four counts, tapping through to Approvals) and the **people
 * board** under it (`attendance.view_all`). Both stay when 6.2 builds the rest of the screen.
 */
export default async function TodayPage() {
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
      footer={marksAttendance ? <LogoutRow /> : undefined}
      icon={LayoutDashboardIcon}
    >
      {marksAttendance ? <TodayAttendanceStrip memberId={viewer.id} home="/today" /> : null}
      {summary ? (
        <>
          <TodayAttendanceCard summary={summary} />
          <PeopleBoard summary={summary} />
        </>
      ) : null}
    </PlaceholderPage>
  );
}
