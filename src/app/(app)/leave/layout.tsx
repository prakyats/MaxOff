import type { ReactNode } from "react";

import { todayIST } from "@/core/time";
import { PageHeader } from "@/core/ui/composites/page-header";
import { RequestLeaveButton } from "@/modules/leave/components/request-leave-button";

import { LeaveTabs } from "./leave-tabs";

const DESCRIPTION = "Request leave, change or cancel it, and see how each day was recorded.";

/**
 * The member's own attendance and leave (task 2.3, WORKFLOWS §1/§2): two views, `/leave`
 * (requests) and `/leave/attendance` (the month's days), under one header and tab bar. Personal,
 * not operations, so it has no tab or sidebar entry (owner decision 2026-09-24): the attendance
 * strip on My Day and /today, and a row on Me, lead here.
 *
 * Two routes rather than one with `?tab=`, so each view has its own `loading.tsx` that traces
 * it (ARCHITECTURE §14.1); the tabs still switch with `replace` (§14.2 d). This layout awaits
 * nothing, so the header and tabs paint at once and stay put while a view loads. Each page
 * checks `attendance.self` itself.
 */
export default function LeaveLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <PageHeader
        title="Attendance & leave"
        description={DESCRIPTION}
        help={DESCRIPTION}
        actions={<RequestLeaveButton today={todayIST()} />}
      />
      <LeaveTabs />
      {children}
    </>
  );
}
