import { type ISODate, toISTDate } from "@/core/time";

import { activeAssignees, deadlineLabel, isFinal, isOverdue, joinNames } from "./task";
import type { AdminStep, Engagement, MemberRole, Priority, TaskAssignee, TaskState } from "./types";

/**
 * The Tasks tab's lists (4.5; PRODUCT §4.6 "Tasks tab, first glance", Kickoff 4 decision 17,
 * ADR-0013): Staff "My tasks" in five groups, a coordinator's freelancers mixed in "for Asha"; the
 * Owner's and an Admin's "Needs you" first, then the open tasks by deadline; the full list's
 * filters. Pure, so the rules are unit-tested; RLS decides which tasks a viewer gets at all.
 */

/** A task as the lists read it: the row and every assignee row (removed ones included). */
export type TaskListRow = {
  id: string;
  title: string;
  state: TaskState;
  adminStep: AdminStep;
  priority: Priority;
  dueAt: string;
  clientId: string | null;
  taskTypeId: string;
  primaryOwnerId: string;
  approvingAdminId: string | null;
  createdBy: string;
  submittedAt: string | null;
  createdAt: string;
  assignees: Pick<
    TaskAssignee,
    "memberId" | "isPrimary" | "assignedAt" | "acknowledgedAt" | "removedAt"
  >[];
};

export type ListViewer = {
  id: string;
  role: MemberRole;
  /** The freelancers this member coordinates now (ADR-0013). */
  coordinates: readonly string[];
};

const REVIEW_STATES: readonly TaskState[] = ["submitted", "admin_approved"];

/** The viewer's own place on a task: themselves and the freelancers they act for. */
export type OwnPart = {
  /** The viewer is an active assignee. */
  self: boolean;
  /** Freelancers on the task the viewer coordinates now: "for Asha". */
  forIds: string[];
  /** Whose "Task Noted" is still missing among them (the viewer's id, freelancers' ids). */
  notNoted: string[];
};

export function ownPart(row: TaskListRow, viewer: ListViewer): OwnPart {
  const active = activeAssignees(row.assignees);
  const self = active.find((a) => a.memberId === viewer.id) ?? null;
  const freelancers = active.filter((a) => viewer.coordinates.includes(a.memberId));
  return {
    self: self !== null,
    forIds: freelancers.map((a) => a.memberId),
    notNoted: [self, ...freelancers]
      .filter((a): a is NonNullable<typeof a> => a !== null && a.acknowledgedAt === null)
      .map((a) => a.memberId),
  };
}

/** Whether the task is the viewer's work: theirs, or a freelancer's they coordinate. */
export function isOwnWork(part: OwnPart): boolean {
  return part.self || part.forIds.length > 0;
}

/**
 * Staff "My tasks" (decision 17, the order since Kickoff 4 decision 25): Not noted · Changes
 * requested · Overdue · Due today · Upcoming, and the tasks with the reviewers (done, waiting for
 * a check or the approval) as a count at the end. Each open task is in exactly one group, the
 * first that applies: not noted, changes requested, with the reviewers, overdue, due today,
 * upcoming.
 */
export const MY_GROUPS = [
  "not_noted",
  "changes_requested",
  "overdue",
  "due_today",
  "upcoming",
  "with_reviewers",
] as const;
export type MyGroup = (typeof MY_GROUPS)[number];

/** The groups "My tasks" lists as sections, in screen order (with the reviewers is a count). */
export const MY_LIST_GROUPS = MY_GROUPS.filter(
  (group): group is Exclude<MyGroup, "with_reviewers"> => group !== "with_reviewers",
);

export const MY_GROUP_TITLES: Record<MyGroup, string> = {
  not_noted: "Not noted",
  changes_requested: "Changes requested",
  due_today: "Due today",
  upcoming: "Upcoming",
  overdue: "Overdue",
  with_reviewers: "With the reviewers",
};

export type MyTaskItem = { row: TaskListRow; part: OwnPart };

export function myGroupOf(
  row: TaskListRow,
  part: OwnPart,
  now: Date,
  today: ISODate,
): MyGroup | null {
  if (isFinal(row.state) || !isOwnWork(part)) return null;
  if (part.notNoted.length > 0) return "not_noted";
  if (row.state === "changes_requested") return "changes_requested";
  if (REVIEW_STATES.includes(row.state)) return "with_reviewers";
  if (isOverdue(row, now)) return "overdue";
  return toISTDate(row.dueAt) === today ? "due_today" : "upcoming";
}

export function myTaskGroups(
  rows: readonly TaskListRow[],
  viewer: ListViewer,
  now: Date,
  today: ISODate,
): Record<MyGroup, MyTaskItem[]> {
  const groups = Object.fromEntries(MY_GROUPS.map((group) => [group, []])) as unknown as Record<
    MyGroup,
    MyTaskItem[]
  >;
  for (const row of byDeadline(rows)) {
    const part = ownPart(row, viewer);
    const group = myGroupOf(row, part, now, today);
    if (group) groups[group].push({ row, part });
  }
  return groups;
}

/** The Tasks badge's own arithmetic (decision 16), for the tests to hold it against the SQL. */
export function badgeCount(rows: readonly TaskListRow[], viewer: ListViewer): number {
  return rows.filter((row) => {
    if (isFinal(row.state)) return false;
    const part = ownPart(row, viewer);
    return part.notNoted.length > 0 || (isOwnWork(part) && row.state === "changes_requested");
  }).length;
}

/**
 * Why a task needs the Owner or an Admin (decision 17): their own "Task Noted" or a change
 * request on their own task (an Admin is also an assignee), overdue work on a task they run, or
 * someone who has not noted it past the escalation time (WORKFLOWS §3.2: the approving Admin or
 * creator after `ack_escalate_hours`, the Owner after `ack_escalate_owner_hours`).
 */
export type NeedsYouReason = "your_note" | "changes_requested" | "overdue" | "not_noted";

export type NeedsYouItem = {
  row: TaskListRow;
  reason: NeedsYouReason;
  /** Who has not noted it past the escalation time (for `not_noted`), longest first. */
  waitingOn: { memberId: string; hours: number }[];
  part: OwnPart;
};

export type Escalation = { ackEscalateHours: number; ackEscalateOwnerHours: number };

/**
 * A task the viewer answers for when it runs late or goes unnoted: the Owner every task; an Admin
 * the ones they approve, or created when nobody approves them (WORKFLOWS §3.2 level 1 and §9's
 * overdue escalation: "the approving Admin (or creator)"; 4C review L6).
 */
export function managesTask(row: TaskListRow, viewer: ListViewer): boolean {
  if (viewer.role === "owner") return true;
  return row.approvingAdminId !== null
    ? row.approvingAdminId === viewer.id
    : row.createdBy === viewer.id;
}

const HOUR = 3_600_000;

export function needsYou(
  rows: readonly TaskListRow[],
  viewer: ListViewer,
  now: Date,
  escalation: Escalation,
): NeedsYouItem[] {
  const hours =
    viewer.role === "owner" ? escalation.ackEscalateOwnerHours : escalation.ackEscalateHours;
  const items: NeedsYouItem[] = [];
  for (const row of byDeadline(rows)) {
    if (isFinal(row.state)) continue;
    const part = ownPart(row, viewer);
    if (part.notNoted.length > 0) {
      items.push({ row, reason: "your_note", waitingOn: [], part });
      continue;
    }
    if (isOwnWork(part) && row.state === "changes_requested") {
      items.push({ row, reason: "changes_requested", waitingOn: [], part });
      continue;
    }
    if (!managesTask(row, viewer)) continue;
    // Late work, still with its people; a task handed in waits in Approvals instead.
    if (!REVIEW_STATES.includes(row.state) && isOverdue(row, now)) {
      items.push({ row, reason: "overdue", waitingOn: [], part });
      continue;
    }
    const waitingOn = activeAssignees(row.assignees)
      .filter((a) => a.acknowledgedAt === null)
      .map((a) => ({
        memberId: a.memberId,
        hours: Math.floor((now.getTime() - Date.parse(a.assignedAt)) / HOUR),
      }))
      .filter((a) => a.hours >= hours)
      .sort((a, b) => b.hours - a.hours);
    if (waitingOn.length > 0) items.push({ row, reason: "not_noted", waitingOn, part });
  }
  return items;
}

/** The open tasks by deadline, without the ones "Needs you" already shows. */
export function openByDeadline(
  rows: readonly TaskListRow[],
  shown: ReadonlySet<string>,
): TaskListRow[] {
  return byDeadline(rows).filter((row) => !isFinal(row.state) && !shown.has(row.id));
}

export function byDeadline(rows: readonly TaskListRow[]): TaskListRow[] {
  return [...rows].sort(
    (a, b) => Date.parse(a.dueAt) - Date.parse(b.dueAt) || a.title.localeCompare(b.title),
  );
}

/** "9 h", "2 days": how long someone has not noted a task. */
export function waitedLabel(hours: number): string {
  if (hours < 48) return `${hours} h`;
  return `${Math.floor(hours / 24)} days`;
}

/**
 * A row's second line: the deadline, whose it is and the client label ("Due Thu 1 Oct, 6:00 pm ·
 * Asha · Sharma Weddings"). The viewer's own task leaves their name out; a freelancer reads "Asha
 * (freelancer)" (ADR-0013: the mark wherever a person is named).
 */
export function rowMeta(
  row: Pick<TaskListRow, "dueAt" | "primaryOwnerId" | "clientId">,
  context: {
    viewerId: string;
    nameOf: (memberId: string) => string;
    engagementOf: (memberId: string) => Engagement | undefined;
    clientName: (clientId: string) => string | null;
  },
): string {
  const parts = [deadlineLabel(row.dueAt)];
  if (row.primaryOwnerId !== context.viewerId) {
    const name = context.nameOf(row.primaryOwnerId);
    parts.push(
      context.engagementOf(row.primaryOwnerId) === "freelance" ? `${name} (freelancer)` : name,
    );
  }
  const client = row.clientId ? context.clientName(row.clientId) : null;
  if (client) parts.push(client);
  return parts.join(" · ");
}

/** "for Asha", "for Asha and Kiran": the freelancers a coordinator acts for on a task. */
export function forLabel(forIds: readonly string[], nameOf: (memberId: string) => string): string {
  return forIds.length > 0 ? `for ${joinNames(forIds.map(nameOf))}` : "";
}
