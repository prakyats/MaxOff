import { CheckCheckIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { withSessionUserId } from "@/core/auth/server";
import { getSessionBundle, type SessionBundle } from "@/core/auth/session-bundle";
import { ROLE_LABELS } from "@/core/lib/role-labels";
import { startEarly } from "@/core/lib/start-early";
import { can } from "@/core/permissions";
import { requirePermission } from "@/core/permissions/server";
import { systemClock, todayIST } from "@/core/time";
import { ApprovalScreen } from "@/core/ui/composites/approval-group";
import { EmptyState } from "@/core/ui/composites/empty-state";
import { PageHeader } from "@/core/ui/composites/page-header";
import { Button } from "@/core/ui/primitives/button";
import { listEarlyLeaveRequests, listPendingDays, listPendingNotes } from "@/modules/attendance";
import { EarlyLeaveGroup } from "@/modules/attendance/components/early-leave-group";
import { reachedAt, waitingFor, type Waiting } from "@/modules/dashboards";
import { PendingDaysGroup } from "@/modules/attendance/components/pending-days-group";
import { PendingNotesGroup } from "@/modules/attendance/components/pending-notes-group";
import { listPendingRequests } from "@/modules/leave";
import { PendingLeaveGroup } from "@/modules/leave/components/pending-leave-group";
import { listPendingClaims } from "@/modules/expenses";
import { PendingClaimsGroup } from "@/modules/expenses/components/pending-claims-group";
import { listTasksAtBothSteps, listUnreadCounts } from "@/modules/tasks";
import { TaskApprovalGroup } from "@/modules/tasks/components/task-approval-group";
import { TasksFreshOnReturn } from "@/modules/tasks/components/tasks-fresh-on-return";
import { listDirectory } from "@/modules/team";

import { taskItem } from "./items";

export const metadata: Metadata = { title: "Approvals" };

const DESCRIPTION = "Everything waiting for your decision, oldest first.";

/**
 * One Approvals screen, grouped, no tabs (PRODUCT "Approvals"). Each group shows only to whoever
 * decides it (PERMISSIONS "Screens (2.4)"): Attendance, Leave and Extra work (3b.2) for
 * `attendance.decide`, Expenses (3b.3) for `expenses.decide` (both the Owner's), then **Staff
 * tasks** (4.5) at the step the viewer decides: the Owner's final approvals, an Admin's checks
 * (kickoff 3b decision 29's order). No client items: since amendment D3 (owner 2026-10-09) an item
 * marked done is approved in the same step, so nothing of client work waits here.
 */
export default async function ApprovalsPage() {
  // The lists start with the session read (§19); RLS decides what each returns, and the ones an
  // Admin does not decide are dropped. Both task steps start too (the Owner's final approvals,
  // the viewer's own checks, keyed by the session's id), and the role picks one (4C review S6).
  // v2.0 X3 (≤ 6 reads in the first wave, ARCHITECTURE §19 "Six connections"): both task steps
  // in one read, started first with the directory (the task rows and their unread counts are
  // the screen's longest chain); each of the Owner's lists only once the shell's counts
  // (`session_bundle()`, the layout's own read, shared through `cache()`) say one is waiting,
  // exactly as the early leaves since v1.9: the same state, under the same RLS, so a count of
  // 0 is an empty list. They then start beside the unread counts, which wait for the task rows
  // anyway. Counts that could not be read ask the usual way, so a failed bundle hides nothing.
  const steps = withSessionUserId(listTasksAtBothSteps);
  const directoryRead = listDirectory();
  const counts = getSessionBundle();
  const whenWaiting = <T,>(
    count: (pending: SessionBundle["pending"]) => number | null,
    read: () => Promise<T[]>,
  ): Promise<T[]> =>
    counts.then(
      (bundle) => ((count(bundle.pending) ?? 0) > 0 ? read() : []),
      () => read(),
    );
  const lists = Promise.all([
    whenWaiting((pending) => pending.days, listPendingDays),
    whenWaiting((pending) => pending.requests, listPendingRequests),
    whenWaiting((pending) => pending.notes, listPendingNotes),
    whenWaiting((pending) => pending.claims, listPendingClaims),
    directoryRead,
    // v1.9 W4: early-leave requests (waiting, and left without an answer); RLS: the Owner's.
    whenWaiting((pending) => pending.earlyLeaves, listEarlyLeaveRequests),
  ]);
  startEarly(lists, steps);
  const viewer = await requirePermission([
    "attendance.decide",
    "tasks.approve_final",
    "tasks.approve_admin",
  ]);
  const [[days, requests, notes, pendingClaims, directory, earlyLeave], [toDecide, unread]] =
    await Promise.all([
      lists,
      // The task rows' unread comments (Kickoff 4 decision 28), for these rows only (A-S4).
      steps
        .then((both) => (can(viewer.role, "tasks.approve_final") ? both.final : both.check))
        .then(
          async (items) =>
            [items, await listUnreadCounts(items.map((item) => item.row.id))] as const,
        ),
    ]);
  const decidesAttendance = can(viewer.role, "attendance.decide");
  const decidesExpenses = can(viewer.role, "expenses.decide");
  const names = Object.fromEntries(directory.map((member) => [member.id, member.fullName]));
  const faces = Object.fromEntries(
    directory.map((member) => [
      member.id,
      { id: member.id, name: member.fullName, avatarFileId: member.avatarFileId },
    ]),
  );
  const tasks = toDecide.map((item) => ({
    ...taskItem(item, names, viewer.role === "owner", faces),
    unread: unread[item.row.id] ?? 0,
  }));
  const claims = decidesExpenses ? pendingClaims : [];
  const own = {
    early: decidesAttendance ? earlyLeave : [],
    days: decidesAttendance ? days : [],
    requests: decidesAttendance ? requests : [],
    notes: decidesAttendance ? notes : [],
  };
  // How long each has waited for its decision (B4 context, V3): the same words as Today's rows.
  const now = systemClock();
  const waited = (since: string | null): Waiting | null => (since ? waitingFor(since, now) : null);
  const waiting = {
    days: waitingMap(own.days, (day) => waited(day.submittedAt ?? day.updatedAt)),
    requests: waitingMap(own.requests, (request) => waited(request.createdAt)),
    notes: waitingMap(own.notes, (note) => waited(note.createdAt)),
    claims: waitingMap(claims, (claim) => waited(claim.createdAt)),
    tasks: waitingMap(
      toDecide.map((item) => ({ ...item, id: item.row.id })),
      (item) =>
        waited(reachedAt(item.submission?.at ?? item.row.submittedAt, item.adminApprovedAt)),
    ),
  };
  // The groups with something waiting: a one-row group's Approve is solid only when it is alone.
  const groupsShown = [
    own.early.filter((request) => request.state === "waiting"),
    own.early.filter((request) => request.state === "left_unanswered"),
    own.days,
    own.requests,
    own.notes,
    decidesExpenses ? claims : [],
    tasks,
  ].filter((rows) => rows.length > 0).length;
  const nothing =
    own.early.length === 0 &&
    own.days.length === 0 &&
    own.requests.length === 0 &&
    own.notes.length === 0 &&
    claims.length === 0 &&
    tasks.length === 0;

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
              : "The tasks you check appear here. Attendance, leave and expenses are the Owner's to decide."
          }
          // PP-admin-2: an Admin with nothing to check is pointed at the tasks with the reviewers
          // (the full list on its "With the reviewers" filter).
          action={
            decidesAttendance ? undefined : (
              // The Button (asChild) carries the variant and size the phone's 44 px rule keys on.
              <Button variant="secondary" asChild /* view-link: navigation (another page) */>
                <Link href="/tasks/all?state=review" data-slot="approvals-open-tasks">
                  Tasks to check
                </Link>
              </Button>
            )
          }
        />
      ) : (
        <ApprovalScreen groups={groupsShown}>
          <div className="flex flex-col gap-6">
            {decidesAttendance ? (
              <>
                {/* v1.9 W4: time-sensitive, so first (the working-hours sample §3). */}
                <EarlyLeaveGroup requests={own.early} today={todayIST()} now={now.toISOString()} />
                <PendingDaysGroup days={own.days} today={todayIST()} waiting={waiting.days} />
                <PendingLeaveGroup requests={own.requests} waiting={waiting.requests} />
                <PendingNotesGroup notes={own.notes} waiting={waiting.notes} />
              </>
            ) : null}
            {decidesExpenses ? (
              <PendingClaimsGroup claims={claims} waiting={waiting.claims} />
            ) : null}
            <TaskApprovalGroup
              tasks={tasks}
              waiting={waiting.tasks}
              heading={viewer.role === "owner" ? `${ROLE_LABELS.staff} tasks` : "Tasks to check"}
            />
          </div>
        </ApprovalScreen>
      )}
    </>
  );
}

/** Each item's waiting words, by its id (the rows read them on the client). */
function waitingMap<T extends { id: string }>(
  items: readonly T[],
  words: (item: T) => Waiting | null,
): Record<string, Waiting> {
  const map: Record<string, Waiting> = {};
  for (const item of items) {
    const value = words(item);
    if (value) map[item.id] = value;
  }
  return map;
}
