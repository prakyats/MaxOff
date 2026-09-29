import { formatIST } from "@/core/time";

import type {
  MemberRole,
  PeopleIndex,
  Task,
  TaskAssignee,
  TaskReview,
  TaskState,
  TaskTypeKind,
} from "./types";

/**
 * What a task page shows and offers (4.4; PRODUCT §4.6, WORKFLOWS §3, PERMISSIONS §3, ADR-0013).
 * Pure, so the rules are unit-tested; the transition functions decide again on every tap.
 */

export const FINAL_STATES: readonly TaskState[] = ["completed", "cancelled"];
/** Where assignees work: from `submitted` on the task is locked for them (WORKFLOWS §3.1). */
export const WORK_STATES: readonly TaskState[] = ["todo", "in_progress", "changes_requested"];

export function isFinal(state: TaskState): boolean {
  return FINAL_STATES.includes(state);
}

export function isLocked(state: TaskState): boolean {
  return !WORK_STATES.includes(state);
}

/** Overdue is derived, never a state: past the deadline and not completed or cancelled. */
export function isOverdue(task: Pick<Task, "dueAt" | "state">, now: Date): boolean {
  return !isFinal(task.state) && now.getTime() > Date.parse(task.dueAt);
}

/** The state as a short word for the badge. `admin_approved` reads by its Admin step. */
export function stateLabel(task: Pick<Task, "state" | "adminStep">): string {
  switch (task.state) {
    case "todo":
      return "To do";
    case "in_progress":
      return "In progress";
    case "submitted":
      return "Waiting for check";
    case "admin_approved":
      return task.adminStep === "required" ? "Checked" : "Waiting for approval";
    case "changes_requested":
      return "Changes requested";
    case "completed":
      return "Completed";
    case "cancelled":
      return "Cancelled";
  }
}

/** "Due Thu 1 Oct, 6:00 pm". */
export function deadlineLabel(dueAt: string): string {
  return `Due ${formatIST(dueAt, "EEE d MMM, h:mm a")}`;
}

/** An event's day and time: "Shoot on Sat 3 Oct, 10:00 am – 12:00 pm". */
export function eventLabel(
  task: Pick<Task, "eventDate" | "eventStartAt" | "eventEndAt">,
): string | null {
  if (!task.eventDate) return null;
  const day = formatIST(`${task.eventDate}T12:00:00+05:30`, "EEE d MMM");
  if (!task.eventStartAt) return day;
  const start = formatIST(task.eventStartAt, "h:mm a");
  return task.eventEndAt
    ? `${day}, ${start} – ${formatIST(task.eventEndAt, "h:mm a")}`
    : `${day}, ${start}`;
}

export function activeAssignees(assignees: readonly TaskAssignee[]): TaskAssignee[] {
  return assignees.filter((assignee) => assignee.removedAt === null);
}

/** Who the Admin step belongs to, and whether it will be skipped (the approver is on the task). */
export function routeLine(
  task: Pick<Task, "approvingAdminId" | "adminStep">,
  assignees: readonly TaskAssignee[],
  nameOf: (id: string) => string,
): string {
  if (!task.approvingAdminId) return "The Owner approves it";
  const onTask = activeAssignees(assignees).some((a) => a.memberId === task.approvingAdminId);
  if (task.adminStep === "skipped" || onTask) {
    return `The Owner approves it (${nameOf(task.approvingAdminId)} is on the task, so no Admin check)`;
  }
  return `${nameOf(task.approvingAdminId)} checks it, then the Owner approves it`;
}

/** "Asha", "Asha and Ravi", "Asha, Ravi and 2 more". */
export function joinNames(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  if (names.length === 3) return `${names[0]}, ${names[1]} and ${names[2]}`;
  return `${names[0]}, ${names[1]} and ${names.length - 2} more`;
}

/**
 * Where the task stands and who holds it, one sentence (the first glance, PRODUCT §2): "Waiting
 * for Asha to note it", "With Local Admin for a check", "Changes requested: back with Asha".
 * `nameOf` answers "you" for the viewer.
 */
export function statusLine(
  task: Pick<Task, "state" | "adminStep" | "approvingAdminId" | "primaryOwnerId" | "completedAt">,
  assignees: readonly TaskAssignee[],
  nameOf: (id: string) => string,
): string {
  const active = activeAssignees(assignees);
  const notNoted = active.filter((a) => a.acknowledgedAt === null).map((a) => nameOf(a.memberId));
  const primary = nameOf(task.primaryOwnerId);
  switch (task.state) {
    case "todo":
    case "in_progress": {
      if (notNoted.length > 0) return `Waiting for ${joinNames(notNoted)} to note it.`;
      return task.state === "todo"
        ? `Everyone has noted it. ${capitalise(primary)} marks it done.`
        : `In progress. ${capitalise(primary)} marks it done.`;
    }
    case "submitted":
      return task.approvingAdminId
        ? `Done. Waiting for ${nameOf(task.approvingAdminId)} to check it.`
        : "Done. Waiting for the Owner's approval.";
    case "admin_approved":
      return task.adminStep === "required"
        ? "Checked. Waiting for the Owner's approval."
        : "Done. Waiting for the Owner's approval.";
    case "changes_requested":
      return `Changes requested. Back with ${primary}.`;
    case "completed":
      return task.completedAt
        ? `Completed on ${formatIST(task.completedAt, "d MMM yyyy")}.`
        : "Completed.";
    case "cancelled":
      return "Cancelled.";
  }
}

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * Who asked for changes, by name: a reviewer is always in the viewer's directory (Kickoff 4
 * decision 21). "Someone" only covers a read that raced.
 */
export function reviewerName(
  review: Pick<TaskReview, "reviewerId">,
  names: Readonly<Record<string, string>>,
): string {
  return names[review.reviewerId] ?? "Someone";
}

/** The reason of the latest rejection, shown while the task is back with its assignees. */
export function latestChangeRequest(reviews: readonly TaskReview[]): TaskReview | null {
  const rejections = reviews
    .filter((review) => review.decision === "rejected")
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  return rejections[0] ?? null;
}

/** The person acting, and who for: `null` = themselves; an id = the freelancer they act for. */
export type ActingFor = { onBehalfOf: string | null };

export type TaskViewer = {
  id: string;
  role: MemberRole;
  /** The freelancers this member coordinates now (ADR-0013; `coordinated_freelancers`). */
  coordinates: readonly string[];
};

/** What the viewer may do with the task now. Every entry is decided again by the database. */
export type TaskActions = {
  /** "Task Noted": the viewer's own, and each freelancer's they coordinate, still missing. */
  note: ActingFor[];
  /** todo → in_progress (optional; implies no acknowledgement). */
  start: ActingFor | null;
  /** The primary owner's Done (or their coordinator's). `again` after changes were requested. */
  done: (ActingFor & { again: boolean }) | null;
  /** Stage ticks, while the task is with its assignees. */
  tick: ActingFor | null;
  /** The review step the viewer decides, if any. */
  review: "admin" | "owner" | null;
  /** The Owner past a waiting Admin step: remove the approver, then decide (4A mechanics 5). */
  takeOver: boolean;
  /** The task's creator, approving Admin or the Owner (PERMISSIONS §3). */
  manage: { edit: boolean; cancel: boolean; reopen: boolean; stages: boolean };
  /** The Owner's approver change (`task_set_approver`). */
  changeApprover: boolean;
  /** Comments: always as oneself; also for each freelancer on the task the viewer coordinates. */
  commentFor: string[];
};

/**
 * The actions a viewer has on a task (4.4). `people` says who is a freelancer; `assignees`
 * includes removed rows (ignored here).
 */
export function taskActions(
  task: Pick<Task, "state" | "primaryOwnerId" | "approvingAdminId" | "createdBy">,
  assignees: readonly TaskAssignee[],
  people: PeopleIndex,
  viewer: TaskViewer,
): TaskActions {
  const active = activeAssignees(assignees);
  const final = isFinal(task.state);
  const locked = isLocked(task.state);
  const own = active.find((a) => a.memberId === viewer.id) ?? null;
  // The freelancers on this task the viewer coordinates now, the primary owner first.
  const coordinated = active
    .filter(
      (a) =>
        people[a.memberId]?.engagement === "freelance" && viewer.coordinates.includes(a.memberId),
    )
    .sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary));
  const worker: ActingFor | null = own
    ? { onBehalfOf: null }
    : coordinated[0]
      ? { onBehalfOf: coordinated[0].memberId }
      : null;

  const note: ActingFor[] = [];
  if (!final) {
    if (own && own.acknowledgedAt === null) note.push({ onBehalfOf: null });
    for (const freelancer of coordinated) {
      if (freelancer.acknowledgedAt === null) note.push({ onBehalfOf: freelancer.memberId });
    }
  }

  let done: TaskActions["done"] = null;
  if (!locked) {
    const again = task.state === "changes_requested";
    if (task.primaryOwnerId === viewer.id && own) done = { onBehalfOf: null, again };
    else if (coordinated.some((a) => a.memberId === task.primaryOwnerId)) {
      done = { onBehalfOf: task.primaryOwnerId, again };
    }
  }

  let review: TaskActions["review"] = null;
  if (
    task.state === "submitted" &&
    viewer.role === "admin" &&
    task.approvingAdminId === viewer.id &&
    !own
  ) {
    review = "admin";
  } else if (task.state === "admin_approved" && viewer.role === "owner") {
    review = "owner";
  }

  const isManager =
    viewer.role === "owner" ||
    (viewer.role === "admin" &&
      (task.createdBy === viewer.id || task.approvingAdminId === viewer.id));

  return {
    note,
    start: task.state === "todo" ? worker : null,
    done,
    tick: locked ? null : worker,
    review,
    takeOver:
      viewer.role === "owner" && task.state === "submitted" && task.approvingAdminId !== null,
    manage: {
      edit: isManager && !final,
      cancel: isManager && !final,
      reopen: isManager && final,
      stages: isManager && !final,
    },
    changeApprover: viewer.role === "owner" && !final,
    commentFor: coordinated.map((a) => a.memberId),
  };
}

/** "Ravi for Asha" when someone acted for a freelancer; else the actor's name. */
export function actorPair(actorName: string, onBehalfOfName: string | null): string {
  return onBehalfOfName ? `${actorName} for ${onBehalfOfName}` : actorName;
}

/**
 * The pair from ids: "Ravi for Asha". Whoever acted on a task and the freelancer they acted for
 * are both in every viewer's directory (Kickoff 4 decision 21), so both are named; "Someone" and
 * "a freelancer" only cover a read that raced, and "MaxOff" an entry with no actor.
 */
export function pairName(
  names: Readonly<Record<string, string>>,
  actorId: string | null,
  onBehalfOf: string | null,
): string {
  const forName = onBehalfOf ? (names[onBehalfOf] ?? "a freelancer") : null;
  const actor = actorId ? (names[actorId] ?? "Someone") : "MaxOff";
  return actorPair(actor, forName);
}

/** An event type carries an event date, optional times and a purpose (4A mechanics 6). */
export function isEventKind(kind: TaskTypeKind | undefined): boolean {
  return kind === "event";
}
