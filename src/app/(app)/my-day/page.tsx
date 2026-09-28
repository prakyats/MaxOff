import { SunriseIcon } from "lucide-react";
import type { Metadata } from "next";

import { requireMember } from "@/core/auth/server";
import { can } from "@/core/permissions";
import { TodayAttendanceStrip } from "@/modules/attendance";

import { PlaceholderPage } from "../_placeholder/placeholder-page";

export const metadata: Metadata = { title: "My Day" };

/**
 * Staff home. Today's attendance is one line on top (the strip, 2.3 polish, reworked in 3b.1:
 * "Not started · Start day", "Started 9:12 am · End day"; 6.1 builds the tasks around it), for
 * whoever marks attendance; the Owner can open this route too (no permission) but has no day.
 * Signing out lives under Me (kickoff 3b decision 1). The rest arrives in 6.1.
 */
export default async function MyDayPage() {
  const viewer = await requireMember();
  const marksAttendance = can(viewer.role, "attendance.self");
  return (
    <PlaceholderPage
      greet={viewer.name}
      title="My Day"
      description="Attendance, tasks to acknowledge, today, upcoming, overdue and changes requested."
      task="6.1"
      icon={SunriseIcon}
    >
      {marksAttendance ? <TodayAttendanceStrip /> : null}
    </PlaceholderPage>
  );
}
