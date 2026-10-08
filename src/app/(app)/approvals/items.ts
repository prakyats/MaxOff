import { formatIST } from "@/core/time";
import { type ItemRow, shortDate } from "@/modules/client-work";
import type { ItemApprovalRow } from "@/modules/client-work/components/item-approval-group";
import { deadlineLabel, pairName, stateLabel, type TaskToDecide } from "@/modules/tasks";
import type { TaskApprovalItem } from "@/modules/tasks/components/task-approval-group";

const WHEN = "d MMM, h:mm a";

/**
 * A task as the Approvals group shows it (4.5): who handed it in and when, and the words for its
 * step. Shared by /approvals and the Owner's Today preview (6.2).
 */
export function taskItem(
  item: TaskToDecide,
  names: Readonly<Record<string, string>>,
  owner: boolean,
): Omit<TaskApprovalItem, "unread"> {
  const { row, submission, lateReason } = item;
  const by = submission ? pairName(names, submission.submittedBy, submission.onBehalfOf) : null;
  const at = submission?.at ?? row.submittedAt;
  const handedIn = [
    by ? `Done by ${by}` : "Done",
    at ? formatIST(at, WHEN) : null,
    submission && submission.version > 1 ? `version ${submission.version}` : null,
  ]
    .filter(Boolean)
    .join(", ");
  return {
    id: row.id,
    title: row.title,
    subtitle: lateReason ? `${handedIn} · late` : handedIn,
    status: row.state,
    statusLabel: owner ? stateLabel(row) : "Waiting for your check",
    primaryName: names[row.primaryOwnerId] ?? "The people on it",
    deadline: deadlineLabel(row.dueAt).replace(/^Due /, ""),
    handedIn,
    note: submission?.note ?? null,
    lateReason,
    approvedLabel: owner ? `Approved ${row.title}` : `Checked ${row.title}: on to the Owner`,
  };
}

/**
 * The oldest `limit` waiting items **in the Approvals group order** (Attendance · Leave · Extra
 * work · Expenses · Staff tasks, each oldest first; Kickoff 6 decision 5): the first group's
 * oldest, then the next group's, until `limit` are taken.
 */
export function firstInGroupOrder<G extends Record<string, readonly unknown[]>>(
  groups: G,
  order: readonly (keyof G)[],
  limit: number,
): { [K in keyof G]: G[K] } {
  let left = limit;
  const taken = {} as { [K in keyof G]: G[K] };
  for (const key of order) {
    const list = groups[key] ?? [];
    const slice = list.slice(0, Math.max(0, left));
    left -= slice.length;
    taken[key] = slice as unknown as G[typeof key];
  }
  return taken;
}

/**
 * A done client item as the Approvals' Client items group shows it (7.4; the client's Admin's,
 * issue #56 Q1): its project and client, who marked it done and when. Shared by /approvals and the
 * Admin's Today count.
 */
export function clientItem(row: ItemRow, names: Readonly<Record<string, string>>): ItemApprovalRow {
  const doneBy = row.doneAt
    ? `${row.doneBy ? (names[row.doneBy] ?? "Someone") : "Someone"}, ${formatIST(row.doneAt, WHEN)}`
    : "—";
  return {
    id: row.id,
    title: row.title,
    subtitle: `${row.projectName} · ${row.clientName} · Done by ${doneBy}`,
    project: row.projectName,
    client: row.clientName,
    cycle: row.cycleLabel ?? "The project's items",
    doneBy,
    planned: row.plannedDate ? shortDate(row.plannedDate) : "No date",
    notes: row.notes,
    href: `/clients/${row.clientId}/projects/${row.projectId}?cycle=${row.cycleId}`,
  };
}
