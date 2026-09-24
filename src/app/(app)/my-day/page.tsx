import { SunriseIcon } from "lucide-react";
import type { Metadata } from "next";

import { requireMember } from "@/core/auth/server";
import { can } from "@/core/permissions";
import { TodayAttendanceCard } from "@/modules/attendance";

import { PlaceholderPage } from "../_placeholder/placeholder-page";

export const metadata: Metadata = { title: "My Day" };

/**
 * Staff home. Today's attendance card (2.2) sits on top for whoever marks attendance; the
 * Owner can open this route too (no permission) but has no day, so no card. The rest arrives
 * in 6.1.
 */
export default async function MyDayPage() {
  const viewer = await requireMember();
  return (
    <PlaceholderPage
      greet={viewer.name}
      title="My Day"
      description="Attendance, tasks to acknowledge, today, upcoming, overdue and changes requested."
      task="6.1"
      icon={SunriseIcon}
    >
      {can(viewer.role, "attendance.self") ? (
        <TodayAttendanceCard memberId={viewer.id} home="/my-day" />
      ) : null}
    </PlaceholderPage>
  );
}
