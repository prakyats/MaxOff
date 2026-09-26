import { CheckCheckIcon, ClipboardListIcon } from "lucide-react";
import type { Metadata } from "next";

import { can } from "@/core/permissions";
import { requirePermission } from "@/core/permissions/server";
import { todayIST } from "@/core/time";
import { EmptyState } from "@/core/ui/composites/empty-state";
import { PageHeader } from "@/core/ui/composites/page-header";
import { listPendingDays } from "@/modules/attendance";
import { PendingDaysGroup } from "@/modules/attendance/components/pending-days-group";
import { listPendingRequests } from "@/modules/leave";
import { PendingLeaveGroup } from "@/modules/leave/components/pending-leave-group";

import { PlaceholderPage } from "../_placeholder/placeholder-page";

export const metadata: Metadata = { title: "Approvals" };

const DESCRIPTION = "Everything waiting for your decision, oldest first.";

/**
 * One Approvals screen, grouped, no tabs (PRODUCT "Approvals"). Each group shows only to whoever
 * decides it (PERMISSIONS "Screens (2.4)"): Attendance and Leave for `attendance.decide` (the
 * Owner). Tasks and client items join in 4.5 and 7.4; until then an Admin, who decides neither
 * attendance nor leave, still sees the placeholder.
 */
export default async function ApprovalsPage() {
  const viewer = await requirePermission([
    "attendance.decide",
    "tasks.approve_final",
    "tasks.approve_admin",
  ]);
  if (!can(viewer.role, "attendance.decide")) {
    return (
      <PlaceholderPage
        title="Approvals"
        description="Tasks and client items waiting for your decision, with bulk approve and reject."
        task="4.5 (tasks) and 7.4 (items)"
        icon={ClipboardListIcon}
      />
    );
  }

  const [days, requests] = await Promise.all([listPendingDays(), listPendingRequests()]);
  const nothing = days.length === 0 && requests.length === 0;

  return (
    <>
      <PageHeader title="Approvals" description={DESCRIPTION} help={DESCRIPTION} />
      {nothing ? (
        <EmptyState
          icon={CheckCheckIcon}
          title="Nothing waiting. You're clear."
          description="Attendance and leave that need you appear here."
        />
      ) : (
        <div className="flex flex-col gap-6">
          <PendingDaysGroup days={days} today={todayIST()} />
          <PendingLeaveGroup requests={requests} />
        </div>
      )}
    </>
  );
}
