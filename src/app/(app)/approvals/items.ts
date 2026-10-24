import { formatDateTime } from "@/core/time";
import type { AvatarPerson } from "@/core/ui/composites/person-avatar";
import { deadlineLabel, pairName, stateLabel, type TaskToDecide } from "@/modules/tasks";
import type { TaskApprovalItem } from "@/modules/tasks/components/task-approval-group";

/**
 * A task as the Approvals group shows it (4.5): who handed it in and when, and the words for its
 * step. Shared by /approvals and the Owner's Today preview (6.2). `faces` (the directory the page
 * already read) gives the row the photo of whoever handed it in, else the primary owner's (#89).
 */
export function taskItem(
  item: TaskToDecide,
  names: Readonly<Record<string, string>>,
  owner: boolean,
  faces?: Readonly<Record<string, AvatarPerson>>,
): Omit<TaskApprovalItem, "unread"> {
  const { row, submission, lateReason } = item;
  const by = submission ? pairName(names, submission.submittedBy, submission.onBehalfOf) : null;
  const at = submission?.at ?? row.submittedAt;
  const handedIn = [
    by ? `Done by ${by}` : "Done",
    at ? formatDateTime(at) : null,
    submission && submission.version > 1 ? `version ${submission.version}` : null,
  ]
    .filter(Boolean)
    .join(", ");
  const avatar = faces?.[submission?.submittedBy ?? row.primaryOwnerId];
  return {
    id: row.id,
    title: row.title,
    ...(avatar ? { avatar } : {}),
    subtitle: lateReason ? `${handedIn} · late` : handedIn,
    status: row.state,
    statusLabel: owner ? stateLabel(row, { finalApprover: true }) : "Waiting for your check",
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
