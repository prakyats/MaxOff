import type { ReactNode } from "react";

import { getCurrentMember } from "@/core/auth/server";
import { can } from "@/core/permissions";
import { todayIST } from "@/core/time";
import { PageHeader } from "@/core/ui/composites/page-header";
import { type CompBalance, getCompBalance } from "@/modules/leave";
import { RequestLeaveButton } from "@/modules/leave/components/request-leave-button";

import { LeaveTabs } from "./leave-tabs";

const NO_COMP_BALANCE: CompBalance = { availableDays: 0, useBy: null };

const DESCRIPTION =
  "Request leave, change or cancel it, note extra work, and see how each day was recorded.";

/**
 * The member's own attendance and leave (task 2.3, WORKFLOWS §1/§2): three views, `/leave`
 * (requests), `/leave/attendance` (the month's days) and `/leave/extra-work` (notes and comp
 * leave, 3b.2), under one header and tab bar. Personal,
 * not operations, so it has no tab or sidebar entry (owner decision 2026-09-24): the attendance
 * strip on My Day and /today, and a row on Me, lead here.
 *
 * Two routes rather than one with `?tab=`, so each view has its own `loading.tsx` that traces
 * it (ARCHITECTURE §14.1); the tabs still switch with `replace` (§14.2 d). This layout awaits
 * nothing but the viewer (already read for the shell), so the header and tabs paint at once and
 * stay put while a view loads: the comp leave balance the leave form needs (3b.2) is handed to
 * the button **as a promise**, read only when the dialog opens. Each page checks
 * `attendance.self` itself.
 */
export default async function LeaveLayout({ children }: { children: ReactNode }) {
  const viewer = await getCurrentMember();
  // The Owner (no `attendance.self`) never opens these routes, so the promise is only made for
  // someone who marks attendance; a failed read is caught here, so it is never an unobserved
  // rejection, and the form then offers no comp leave (the database is the rule either way).
  const balance =
    viewer && can(viewer.role, "attendance.self")
      ? getCompBalance(viewer.id).catch(() => NO_COMP_BALANCE)
      : Promise.resolve(NO_COMP_BALANCE);
  return (
    <>
      <PageHeader
        title="Attendance & leave"
        description={DESCRIPTION}
        help={DESCRIPTION}
        actions={<RequestLeaveButton today={todayIST()} balance={balance} />}
      />
      <LeaveTabs />
      {children}
    </>
  );
}
