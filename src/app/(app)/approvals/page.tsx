import { CheckCheckIcon, ClipboardListIcon } from "lucide-react";
import type { Metadata } from "next";

import { can } from "@/core/permissions";
import { requirePermission } from "@/core/permissions/server";
import { todayIST } from "@/core/time";
import { EmptyState } from "@/core/ui/composites/empty-state";
import { PageHeader } from "@/core/ui/composites/page-header";
import { listPendingDays, listPendingNotes } from "@/modules/attendance";
import { PendingDaysGroup } from "@/modules/attendance/components/pending-days-group";
import { PendingNotesGroup } from "@/modules/attendance/components/pending-notes-group";
import { listPendingRequests } from "@/modules/leave";
import { PendingLeaveGroup } from "@/modules/leave/components/pending-leave-group";
import { listPendingClaims } from "@/modules/expenses";
import { PendingClaimsGroup } from "@/modules/expenses/components/pending-claims-group";

import { PlaceholderPage } from "../_placeholder/placeholder-page";

export const metadata: Metadata = { title: "Approvals" };

const DESCRIPTION = "Everything waiting for your decision, oldest first.";

/**
 * One Approvals screen, grouped, no tabs (PRODUCT "Approvals"). Each group shows only to whoever
 * decides it (PERMISSIONS "Screens (2.4)"): Attendance, Leave and Extra work (3b.2) for
 * `attendance.decide`, Expenses (3b.3) for `expenses.decide` (both the Owner's), in the order of
 * kickoff 3b decision 29. Tasks and client items
 * join in 4.5 and 7.4; until then an Admin, who decides none of these, still sees the placeholder.
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

  const decidesExpenses = can(viewer.role, "expenses.decide");
  const [days, requests, notes, claims] = await Promise.all([
    listPendingDays(),
    listPendingRequests(),
    listPendingNotes(),
    decidesExpenses ? listPendingClaims() : Promise.resolve([]),
  ]);
  const nothing =
    days.length === 0 && requests.length === 0 && notes.length === 0 && claims.length === 0;

  return (
    <>
      <PageHeader title="Approvals" description={DESCRIPTION} help={DESCRIPTION} />
      {nothing ? (
        <EmptyState
          icon={CheckCheckIcon}
          title="Nothing waiting. You're clear."
          description="Attendance, leave, extra work and expense claims that need you appear here."
        />
      ) : (
        <div className="flex flex-col gap-6">
          <PendingDaysGroup days={days} today={todayIST()} />
          <PendingLeaveGroup requests={requests} />
          <PendingNotesGroup notes={notes} />
          {decidesExpenses ? <PendingClaimsGroup claims={claims} /> : null}
        </div>
      )}
    </>
  );
}
