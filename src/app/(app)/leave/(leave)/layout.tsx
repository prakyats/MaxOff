import type { ReactNode } from "react";

import { getCurrentMember, withSessionUserId } from "@/core/auth/server";
import { can } from "@/core/permissions";
import { todayIST } from "@/core/time";
import { PageHeader } from "@/core/ui/composites/page-header";
import { type CompBalance, getCompBalance, listCompDates } from "@/modules/leave";
import { RequestLeaveButton } from "@/modules/leave/components/request-leave-button";

import { LEAVE_TABS, LeaveTabs } from "../leave-tabs";

const NO_COMP_BALANCE: CompBalance = { availableDays: 0, useBy: null };

const DESCRIPTION = "Request leave, change or cancel it, and see how each day was recorded.";

/**
 * The member's own attendance and leave (task 2.3, WORKFLOWS §1/§2): two views since 5B
 * (decision 2), `/leave` (requests) and `/leave/attendance` (the month's days), under one header
 * and tab bar; extra work and expenses are their own page (`(work)`, decision 3). The Crew's
 * "Leave" tab and sidebar entry (decisions 1 and 5); for an Admin, a row on Me and the attendance
 * strip lead here (decision 7: their navigation is unchanged).
 *
 * Two routes rather than one with `?tab=`, so each view has its own `loading.tsx` that traces
 * it (ARCHITECTURE §14.1); the tabs still switch with `replace` (§14.2 d). This layout awaits
 * nothing but the viewer (already read for the shell), so the header and tabs paint at once and
 * stay put while a view loads: the comp leave balance the leave form needs (3b.2) is handed to
 * the button **as a promise**, read only when the dialog opens. Each page checks
 * `attendance.self` itself.
 */
export default async function LeaveLayout({ children }: { children: ReactNode }) {
  // Started with the session read (ARCHITECTURE §19), used only for someone who marks attendance.
  const ownBalance = withSessionUserId((id) =>
    Promise.all([getCompBalance(id), listCompDates().catch(() => undefined)]),
  );
  ownBalance.catch(() => undefined);
  const viewer = await getCurrentMember();
  // The Owner (no `attendance.self`) never opens these routes, so the promise is only made for
  // someone who marks attendance; a failed read is caught here, so it is never an unobserved
  // rejection, and the form then offers no comp leave (the database is the rule either way).
  // The working days the form may offer for comp leave come with it (3b review); without them
  // the form falls back to a plain date field.
  const balance =
    viewer && can(viewer.role, "attendance.self")
      ? ownBalance
          .then(([own, dates]): CompBalance => (dates ? { ...own, dates } : own))
          .catch(() => NO_COMP_BALANCE)
      : Promise.resolve(NO_COMP_BALANCE);
  return (
    <>
      <PageHeader
        title="Attendance & leave"
        description={DESCRIPTION}
        help={DESCRIPTION}
        actions={<RequestLeaveButton today={todayIST()} balance={balance} />}
      />
      <LeaveTabs tabs={LEAVE_TABS} label="Attendance and leave" />
      {children}
    </>
  );
}
