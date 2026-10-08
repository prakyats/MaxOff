import { CheckCheckIcon } from "lucide-react";
import type { Metadata } from "next";

import { withSessionUserId } from "@/core/auth/server";
import { ROLE_LABELS } from "@/core/lib/role-labels";
import { startEarly } from "@/core/lib/start-early";
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
import { listItemRows } from "@/modules/client-work";
import { ItemApprovalGroup } from "@/modules/client-work/components/item-approval-group";
import { listTasksToDecide, listUnreadCounts } from "@/modules/tasks";
import { TaskApprovalGroup } from "@/modules/tasks/components/task-approval-group";
import { TasksFreshOnReturn } from "@/modules/tasks/components/tasks-fresh-on-return";
import { listDirectory } from "@/modules/team";

import { clientItem, taskItem } from "./items";

export const metadata: Metadata = { title: "Approvals" };

const DESCRIPTION = "Everything waiting for your decision, oldest first.";

/**
 * One Approvals screen, grouped, no tabs (PRODUCT "Approvals"). Each group shows only to whoever
 * decides it (PERMISSIONS "Screens (2.4)"): Attendance, Leave and Extra work (3b.2) for
 * `attendance.decide`, Expenses (3b.3) for `expenses.decide` (both the Owner's), then **Staff
 * tasks** (4.5) at the step the viewer decides: the Owner's final approvals, an Admin's checks
 * (kickoff 3b decision 29's order). **Client items** (7.4) come last, for the client's Admin
 * (`items.approve` without `attendance.decide`): the done items of the clients they run (issue #56
 * Q1: never in the Owner's Approvals; he approves from a project's page).
 */
export default async function ApprovalsPage() {
  // The lists start with the session read (§19); RLS decides what each returns, and the ones an
  // Admin does not decide are dropped. Both task steps start too (the Owner's final approvals,
  // the viewer's own checks, keyed by the session's id), and the role picks one (4C review S6).
  const lists = Promise.all([
    listPendingDays(),
    listPendingRequests(),
    listPendingNotes(),
    listPendingClaims(),
    listDirectory(),
  ]);
  const finalTasks = listTasksToDecide({ final: true });
  const checkTasks = withSessionUserId((id) => listTasksToDecide({ final: false, id }));
  const doneItems = listItemRows({ states: ["done"] });
  startEarly(lists, finalTasks, checkTasks, doneItems);
  const viewer = await requirePermission([
    "attendance.decide",
    "tasks.approve_final",
    "tasks.approve_admin",
    "items.approve",
  ]);
  const [[days, requests, notes, pendingClaims, directory], [toDecide, unread]] = await Promise.all(
    [
      lists,
      // The task rows' unread comments (Kickoff 4 decision 28), for these rows only (A-S4).
      (can(viewer.role, "tasks.approve_final") ? finalTasks : checkTasks).then(
        async (items) => [items, await listUnreadCounts(items.map((item) => item.row.id))] as const,
      ),
    ],
  );
  const decidesAttendance = can(viewer.role, "attendance.decide");
  // Q1: the client's Admin approves their clients' items here; the Owner never (his project pages).
  const decidesItems = viewer.role !== "owner" && can(viewer.role, "items.approve");
  const decidesExpenses = can(viewer.role, "expenses.decide");
  const names = Object.fromEntries(directory.map((member) => [member.id, member.fullName]));
  const items = decidesItems
    ? (await doneItems)
        .sort((a, b) => (a.doneAt ?? "").localeCompare(b.doneAt ?? "") || a.id.localeCompare(b.id))
        .map((row) => clientItem(row, names))
    : [];
  const tasks = toDecide.map((item) => ({
    ...taskItem(item, names, viewer.role === "owner"),
    unread: unread[item.row.id] ?? 0,
  }));
  const claims = decidesExpenses ? pendingClaims : [];
  const own = {
    days: decidesAttendance ? days : [],
    requests: decidesAttendance ? requests : [],
    notes: decidesAttendance ? notes : [],
  };
  const nothing =
    own.days.length === 0 &&
    own.requests.length === 0 &&
    own.notes.length === 0 &&
    claims.length === 0 &&
    tasks.length === 0 &&
    items.length === 0;

  return (
    <>
      <TasksFreshOnReturn renderId={crypto.randomUUID()} />
      <PageHeader title="Approvals" description={DESCRIPTION} help={DESCRIPTION} />
      {nothing ? (
        <EmptyState
          icon={CheckCheckIcon}
          title="Nothing waiting. You're clear."
          description={
            decidesAttendance
              ? "Attendance, leave, extra work, expense claims and tasks that need you appear here."
              : "The tasks you check and your clients' finished items appear here. Attendance, leave and expenses are the Owner's to decide."
          }
        />
      ) : (
        <div className="flex flex-col gap-6">
          {decidesAttendance ? (
            <>
              <PendingDaysGroup days={own.days} today={todayIST()} />
              <PendingLeaveGroup requests={own.requests} />
              <PendingNotesGroup notes={own.notes} />
            </>
          ) : null}
          {decidesExpenses ? <PendingClaimsGroup claims={claims} /> : null}
          <TaskApprovalGroup
            tasks={tasks}
            heading={viewer.role === "owner" ? `${ROLE_LABELS.staff} tasks` : "Tasks to check"}
          />
          {items.length > 0 ? <ItemApprovalGroup items={items} /> : null}
        </div>
      )}
    </>
  );
}
