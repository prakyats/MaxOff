import { formatIST } from "@/core/time";

import type { MemberRole } from "./types";

/**
 * Task requests (4.6; PRODUCT §4.6, WORKFLOWS §3.4, PERMISSIONS §1/§2): Staff and Admins
 * suggest a task, the Owner or an Admin who sees it converts it into a task or declines it with a
 * reason, the requester may withdraw it while it waits. Pure: which controls a row offers and what
 * it says. The functions decide again on every tap.
 */

export type RequestState = "pending" | "converted" | "declined" | "withdrawn";

export type TaskRequest = {
  id: string;
  requestedBy: string;
  title: string;
  details: string | null;
  clientId: string | null;
  state: RequestState;
  decidedBy: string | null;
  decidedAt: string | null;
  decisionReason: string | null;
  taskId: string | null;
  /** The viewer may open `taskId` (RLS on the task): the decider, the Owner, anyone on it. */
  taskVisible: boolean;
  createdAt: string;
};

export const REQUEST_STATE_LABELS: Record<RequestState, string> = {
  pending: "Waiting",
  converted: "Became a task",
  declined: "Declined",
  withdrawn: "Withdrawn",
};

export type RequestViewer = {
  id: string;
  role: MemberRole;
  /** `task_requests.decide` (the Owner and Admins). */
  decides: boolean;
};

export type RequestActions = { convert: boolean; decline: boolean; withdraw: boolean };

/**
 * A pending request the viewer sees is theirs to decide when they hold the key (RLS already
 * scoped it: an Admin sees those with no client and their clients') and did not suggest it
 * themselves, and theirs to withdraw when they did: an Admin's own suggestion goes to the Owner
 * (Kickoff 4 decision 23; `task_request_convert` / `_decline` refuse it too).
 */
export function requestActions(request: TaskRequest, viewer: RequestViewer): RequestActions {
  const pending = request.state === "pending";
  const own = request.requestedBy === viewer.id;
  return {
    convert: pending && viewer.decides && !own,
    decline: pending && viewer.decides && !own,
    withdraw: pending && own,
  };
}

/** "Open the task" on a decided request: only when the viewer may see the task it became. */
export function opensTask(request: Pick<TaskRequest, "taskId" | "taskVisible">): boolean {
  return request.taskId !== null && request.taskVisible;
}

/** "Suggested by Meera, 2 Oct" (or "by you"). */
export function requestByline(
  request: Pick<TaskRequest, "requestedBy" | "createdAt">,
  viewerId: string,
  nameOf: (memberId: string) => string,
): string {
  const who = request.requestedBy === viewerId ? "you" : nameOf(request.requestedBy);
  return `Suggested by ${who}, ${formatIST(request.createdAt, "d MMM")}`;
}

/**
 * What happened to a decided request, one line: "Declined by Local Admin, 3 Oct". The decider is
 * named when the viewer's directory holds them (a Staff suggester's may not: "Declined, 3 Oct").
 */
export function requestOutcome(
  request: Pick<TaskRequest, "state" | "decidedBy" | "decidedAt">,
  viewerId: string,
  nameOf: (memberId: string) => string | null,
): string | null {
  if (request.state === "pending") return null;
  const when = request.decidedAt ? `, ${formatIST(request.decidedAt, "d MMM")}` : "";
  if (request.state === "withdrawn") return `Withdrawn${when}`;
  const who = request.decidedBy
    ? request.decidedBy === viewerId
      ? "you"
      : nameOf(request.decidedBy)
    : null;
  const by = who ? ` by ${who}` : "";
  return request.state === "converted" ? `Made a task${by}${when}` : `Declined${by}${when}`;
}

/** The waiting ones first (oldest first), then the decided (as read: the latest first). */
export function splitRequests(requests: readonly TaskRequest[]): {
  waiting: TaskRequest[];
  decided: TaskRequest[];
} {
  return {
    waiting: requests.filter((request) => request.state === "pending"),
    decided: requests.filter((request) => request.state !== "pending"),
  };
}
