import type { Enums } from "@/core/db";

/**
 * Staff tasks as the screens read them (PRODUCT §4.6, WORKFLOWS §3, DATA-MODEL §6; 4B). The
 * database is the rule (the `task_*` transition functions, 4A); these are the shapes the create
 * dialog and the task page work with, camelCase over the rows.
 */

export type TaskState = Enums<"task_state">;
export type Priority = Enums<"priority">;
export type AdminStep = Enums<"admin_step">;
export type TaskTypeKind = Enums<"task_type_kind">;
export type ReviewDecision = Enums<"review_decision">;
export type MemberRole = Enums<"member_role">;
export type Engagement = Enums<"engagement">;

export const PRIORITIES = [
  "low",
  "medium",
  "high",
  "urgent",
] as const satisfies readonly Priority[];

export const PRIORITY_LABELS: Record<Priority, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  urgent: "Urgent",
};

/** A task type the dialog offers (the Owner's list, `task_types`; kickoff 4 decision 15). */
export type TaskType = {
  id: string;
  name: string;
  kind: TaskTypeKind;
  hasLocation: boolean;
  archived: boolean;
};

/**
 * A person the create dialog may assign: an active Admin, Staff member or freelancer, never the
 * Owner (kickoff 4 decision 1). A freelancer is offered with a Freelancer mark and their
 * coordinator's name (ADR-0013).
 */
export type AssignablePerson = {
  id: string;
  name: string;
  role: MemberRole;
  engagement: Engagement;
  jobTitle: string | null;
  /** The freelancer's current coordinator's name (null for an employee, or when unknown). */
  coordinatorName: string | null;
};

/** A client a task may be labelled with: the Owner's any, an Admin's own (kickoff 4 decision 2). */
export type ClientOption = { id: string; name: string; adminId: string | null };

/** An active Admin the Owner may route a task through (kickoff 4 decision 3). */
export type AdminOption = { id: string; name: string };

export type Task = {
  id: string;
  title: string;
  description: string | null;
  taskTypeId: string;
  clientId: string | null;
  priority: Priority;
  dueAt: string;
  eventDate: string | null;
  eventStartAt: string | null;
  eventEndAt: string | null;
  location: string | null;
  purpose: string | null;
  state: TaskState;
  approvingAdminId: string | null;
  adminStep: AdminStep;
  createdBy: string;
  primaryOwnerId: string;
  lateReason: string | null;
  cancelledReason: string | null;
  customFields: Record<string, unknown>;
  submittedAt: string | null;
  submittedBy: string | null;
  submittedOnBehalfOf: string | null;
  adminApprovedAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  createdAt: string;
};

/** One person on a task (WORKFLOWS §3.2). `acknowledgedBy` is the coordinator when on behalf. */
export type TaskAssignee = {
  memberId: string;
  isPrimary: boolean;
  assignedAt: string;
  acknowledgedAt: string | null;
  acknowledgedBy: string | null;
  removedAt: string | null;
};

export type TaskStage = {
  id: string;
  name: string;
  position: string;
  doneAt: string | null;
  doneBy: string | null;
  onBehalfOf: string | null;
};

export type TaskComment = {
  id: string;
  authorId: string;
  onBehalfOf: string | null;
  body: string;
  createdAt: string;
};

/** A hand-in: one version per Done or resubmit, a note that may carry links (kickoff 4 decision 10). */
export type TaskSubmission = {
  id: string;
  version: number;
  note: string | null;
  submittedBy: string;
  onBehalfOf: string | null;
  at: string;
};

export type TaskReview = {
  id: string;
  step: "admin" | "owner";
  decision: ReviewDecision;
  reason: string | null;
  reviewerId: string;
  at: string;
};

/** A task page's facts about the people on it: names, and who is a freelancer. */
export type PeopleIndex = Record<
  string,
  { name: string; engagement: Engagement; coordinatorId: string | null }
>;
