import { SunriseIcon } from "lucide-react";
import type { Metadata } from "next";

import { LogoutRow } from "@/core/auth/components";
import { requireMember } from "@/core/auth/server";
import { can } from "@/core/permissions";
import { TodayAttendanceStrip } from "@/modules/attendance";

import { PlaceholderPage } from "../_placeholder/placeholder-page";

export const metadata: Metadata = { title: "My Day" };

/**
 * Staff home. Today's attendance is one line on top (the strip, 2.3 polish; 6.1 builds the
 * tasks around it) and Log out a quiet row at the bottom, for whoever marks attendance; the
 * Owner can open this route too (no permission) but has no day, so neither. The rest arrives
 * in 6.1.
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
      footer={marksAttendance ? <LogoutRow /> : undefined}
      icon={SunriseIcon}
    >
      {marksAttendance ? <TodayAttendanceStrip memberId={viewer.id} home="/my-day" /> : null}
    </PlaceholderPage>
  );
}
