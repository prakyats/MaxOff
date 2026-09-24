import { LayoutDashboardIcon } from "lucide-react";
import type { Metadata } from "next";

import { LogoutRow } from "@/core/auth/components";
import { requireMember } from "@/core/auth/server";
import { can } from "@/core/permissions";
import { TodayAttendanceStrip } from "@/modules/attendance";

import { PlaceholderPage } from "../_placeholder/placeholder-page";

export const metadata: Metadata = { title: "Today" };

/**
 * Owner Today (task 6.2) and the Admin dashboard (task 6.3) share this route. Admins mark
 * attendance too (`attendance.self`), so they get the one-line attendance strip on top and the
 * quiet Log out row at the bottom (2.3 polish); the Owner has no day, so neither.
 */
export default async function TodayPage() {
  const viewer = await requireMember();
  const marksAttendance = can(viewer.role, "attendance.self");
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
    </PlaceholderPage>
  );
}
