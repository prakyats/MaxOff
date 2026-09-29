import { BellIcon } from "lucide-react";
import type { Metadata } from "next";

import { requireMember } from "@/core/auth/server";
import { can } from "@/core/permissions";

import { PlaceholderPage } from "../_placeholder/placeholder-page";
import { STAND_INS } from "../_placeholder/stand-ins";

export const metadata: Metadata = { title: "Alerts" };

/**
 * The notification inbox (task 5.1). Until then a stand-in that points to where things stand
 * today: a member's own requests on Attendance & leave, the Owner's waiting work on Approvals.
 */
export default async function NotificationsPage() {
  const viewer = await requireMember();
  return (
    <PlaceholderPage
      title="Alerts"
      copy={can(viewer.role, "attendance.self") ? STAND_INS.alertsMember : STAND_INS.alertsOwner}
      icon={BellIcon}
    />
  );
}
