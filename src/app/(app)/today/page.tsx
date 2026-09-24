import { LayoutDashboardIcon } from "lucide-react";
import type { Metadata } from "next";

import { requireMember } from "@/core/auth/server";
import { can } from "@/core/permissions";
import { TodayAttendanceCard } from "@/modules/attendance";

import { PlaceholderPage } from "../_placeholder/placeholder-page";

export const metadata: Metadata = { title: "Today" };

/**
 * Owner Today (task 6.2) and the Admin dashboard (task 6.3) share this route. Admins mark
 * attendance too (`attendance.self`), so they get today's attendance card, Log out included;
 * the Owner has no day and no card.
 */
export default async function TodayPage() {
  const viewer = await requireMember();
  return (
    <PlaceholderPage
      greet={viewer.name}
      title="Today"
      description="What needs to happen next: approvals, people, today's tasks and risks."
      task="6.2 (Owner) and 6.3 (Admin)"
      icon={LayoutDashboardIcon}
    >
      {can(viewer.role, "attendance.self") ? (
        <TodayAttendanceCard memberId={viewer.id} home="/today" />
      ) : null}
    </PlaceholderPage>
  );
}
