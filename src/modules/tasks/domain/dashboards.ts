import type { ISODate } from "@/core/time";

import type { ReviewDecision, TaskState } from "./types";

/**
 * The shapes of the task reads behind the dashboards (6A). Pure types: the rules that use them
 * live with the screens' modules (`modules/dashboards`, `modules/reports`).
 */

/** An event task (kickoff 4: an event date, optional start time and location) on a day. */
export type EventTask = {
  id: string;
  title: string;
  state: TaskState;
  eventDate: ISODate;
  /** The event's start, an instant; null when the event has no time. */
  eventStartAt: string | null;
  /** The event's end; null when it has none (an hour, for a busy block) or no time at all. */
  eventEndAt: string | null;
  location: string | null;
  /** The task's optional client label (ADR-0005) and its type (6.4: the calendar's filters). */
  clientId: string | null;
  taskTypeId: string;
  primaryOwnerId: string;
  /** The active assignees (removed ones left out). */
  assigneeIds: string[];
};

/** What the Admin's work report counts (6.3, PRODUCT §4.13), over a range of IST days. */
export type KpiFacts = {
  /** Every hand-in (Done, or a resubmission after changes were requested). */
  submissions: { taskId: string; at: string; primaryOwnerId: string }[];
  /** Every review: an approval, or changes requested (`rejected`). */
  reviews: {
    taskId: string;
    step: "admin" | "owner";
    decision: ReviewDecision;
    reviewerId: string;
    at: string;
    /** When the reviewed hand-in was made; null for a review without one (decided on the spot). */
    handedInAt: string | null;
    primaryOwnerId: string;
  }[];
  /** Every "Task Noted" tapped in the range. */
  notes: { taskId: string; memberId: string; assignedAt: string; acknowledgedAt: string }[];
};
