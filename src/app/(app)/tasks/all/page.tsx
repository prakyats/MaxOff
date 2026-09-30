import type { Metadata } from "next";

import { checkThenRead } from "@/core/lib/start-early";
import { can } from "@/core/permissions";
import { requirePermission } from "@/core/permissions/server";
import { systemClock } from "@/core/time";
import { PageHeader } from "@/core/ui/composites/page-header";
import {
  activeAssignees,
  deadlineLabel,
  isOverdue,
  listFinishedTaskRows,
  listUnreadCounts,
  stateLabel,
  type TaskListRow,
} from "@/modules/tasks";
import { type TaskListItem, TaskListTable } from "@/modules/tasks/components/task-list-table";

import { readClientLabels, readDirectory, readOpenTasks, readTaskTypes } from "../reads";

export const metadata: Metadata = { title: "All tasks" };

/** The finished tasks the list carries, the latest first (open ones are all there). */
const FINISHED_LIMIT = 300;
const DESCRIPTION = `Every open task, and the latest ${FINISHED_LIMIT} finished ones.`;

/**
 * The full task list (4.5; Kickoff 4 decisions 17, 18), one tap deeper than the Tasks tab (a
 * drill-down: back returns to Tasks, §14.2 b, k). Every open task the viewer may see and the
 * latest finished ones, filtered by state (Open first), overdue, and for the Owner and Admins by
 * person, client, type and engagement. Staff see their own (RLS), a coordinator their freelancers'
 * too.
 */
export default async function AllTasksPage() {
  const openRows = readOpenTasks();
  const finishedRows = listFinishedTaskRows(FINISHED_LIMIT);
  const [viewer, [open, finished, directory, labels, types, unread]] = await checkThenRead(
    requirePermission("tasks.work"),
    Promise.all([
      openRows,
      finishedRows,
      readDirectory(),
      readClientLabels(),
      readTaskTypes(),
      // The rows' unread comments, for these rows only (A-S4).
      Promise.all([openRows, finishedRows]).then((lists) =>
        listUnreadCounts(lists.flat().map((row) => row.id)),
      ),
    ]),
  );
  const team = can(viewer.role, "tasks.create");
  const people = new Map(directory.map((member) => [member.id, member]));
  const clients = new Map(labels.map((label) => [label.id, label.name]));
  const typeNames = new Map(types.map((type) => [type.id, type.name]));
  const now = systemClock();

  const item = (row: TaskListRow): TaskListItem => {
    const active = activeAssignees(row.assignees).map((a) => a.memberId);
    const owner = people.get(row.primaryOwnerId);
    return {
      id: row.id,
      title: row.title,
      state: row.state,
      stateLabel: stateLabel(row),
      dueAt: row.dueAt,
      dueLabel: deadlineLabel(row.dueAt),
      overdue: isOverdue(row, now),
      owner:
        row.primaryOwnerId === viewer.id
          ? "You"
          : owner
            ? owner.engagement === "freelance"
              ? `${owner.fullName} (freelancer)`
              : owner.fullName
            : "Someone",
      clientId: row.clientId,
      clientName: row.clientId ? (clients.get(row.clientId) ?? null) : null,
      taskTypeId: row.taskTypeId,
      typeName: typeNames.get(row.taskTypeId) ?? "",
      activeIds: active,
      engagements: active.flatMap((id) => {
        const engagement = people.get(id)?.engagement;
        return engagement ? [engagement] : [];
      }),
      unread: unread[row.id] ?? 0,
    };
  };
  const tasks = [...open, ...finished].map(item);

  // Filter options: only what the list holds, by name.
  const onTasks = new Set(tasks.flatMap((task) => task.activeIds));
  const byLabel = (a: { label: string }, b: { label: string }) => a.label.localeCompare(b.label);
  const options = {
    team,
    people: [...onTasks]
      .flatMap((id) => {
        const member = people.get(id);
        return member ? [{ value: id, label: member.fullName }] : [];
      })
      .sort(byLabel),
    clients: [...new Set(tasks.flatMap((task) => (task.clientId ? [task.clientId] : [])))]
      .map((id) => ({ value: id, label: clients.get(id) ?? "A client" }))
      .sort(byLabel),
    types: types
      .filter((type) => !type.archived || tasks.some((task) => task.taskTypeId === type.id))
      .map((type) => ({ value: type.id, label: type.name })),
  };

  return (
    <>
      <PageHeader
        back={{ href: "/tasks", label: "Tasks" }}
        title={team ? "All tasks" : "All my tasks"}
        description={DESCRIPTION}
      />
      <TaskListTable tasks={tasks} options={options} />
    </>
  );
}
