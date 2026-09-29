"use server";

import { revalidatePath } from "next/cache";

import { validateCustomFieldsFor } from "@/core/custom-fields/server";
import { action, ok, type Result } from "@/core/errors";
import { assertPermission } from "@/core/permissions/server";

import * as repo from "../data/tasks";
import {
  type ActingInput,
  actingSchema,
  type AddStageInput,
  addStageSchema,
  type AvailabilityInput,
  availabilitySchema,
  type CommentInput,
  commentSchema,
  type CreateTaskInput,
  createTaskSchema,
  type ReasonInput,
  reasonSchema,
  type RemoveStageInput,
  removeStageSchema,
  type ReviewInput,
  reviewSchema,
  type SetApproverInput,
  setApproverSchema,
  type SubmitDoneInput,
  submitDoneSchema,
  type TickStageInput,
  tickStageSchema,
  type UpdateTaskInput,
  updateTaskSchema,
  type WarningsInput,
} from "../domain/schemas";
import type { AvailabilityDay } from "../domain/warnings";

/**
 * Staff tasks (4.3, 4.4; ARCHITECTURE §4): zod → `assertPermission()` → the repository (a
 * `task_*` transition function, or a guarded plain edit for stages and comments) → revalidate →
 * `Result`. Thin on purpose (ADR-0011): who may act, in which state, on whose behalf, is decided
 * by the database (4A). Notifications are rows named in the functions' comments, delivered by
 * 5.1 (WORKFLOWS §9); nothing here sends one.
 */

function taskPath(taskId: string): string {
  return `/tasks/${taskId}`;
}

function refresh(taskId: string): void {
  revalidatePath(taskPath(taskId));
  revalidatePath("/tasks");
}

function warningRows(warnings: WarningsInput) {
  return warnings.map((warning) => ({
    kind: warning.kind,
    member_id: warning.memberId,
    details: warning.details,
  }));
}

/** The warning check (4.3): availability of the people picked on the deadline's and event's days. */
export const loadAvailability = action(
  async (input: AvailabilityInput): Promise<Result<AvailabilityDay[]>> => {
    const data = availabilitySchema.parse(input);
    await assertPermission("tasks.create");
    return ok(await repo.availability(data.days, data.memberIds));
  },
);

/** The create dialog (4.3). Returns the new task's id; the dialog opens its page. */
export const createTask = action(
  async (input: CreateTaskInput): Promise<Result<{ id: string }>> => {
    const data = createTaskSchema.parse(input);
    await assertPermission("tasks.create");
    const customFields = await validateCustomFieldsFor("task", data.customFields, {
      taskTypeId: data.taskTypeId,
    });
    const id = await repo.rpcCreateTask(
      { ...data, customFields },
      {
        approvingAdminId: data.approvingAdminId,
        stages: data.stages,
        warnings: warningRows(data.warnings),
      },
    );
    revalidatePath("/tasks");
    return ok({ id });
  },
);

/** The edit dialog: `task_update_assignment` with only what changed (4A mechanics 4). */
export const updateTask = action(
  async (input: UpdateTaskInput): Promise<Result<{ fields: string[] }>> => {
    const data = updateTaskSchema.parse(input);
    await assertPermission("tasks.create");
    const changes = { ...data.changes };
    if (changes.customFields) {
      // An archived field's value is kept, read-only (WORKFLOWS §4a): the task's own values are
      // the `previous` the validation keeps them from.
      const current = await repo.getTask(data.taskId);
      changes.customFields = await validateCustomFieldsFor("task", changes.customFields, {
        taskTypeId: data.taskTypeId,
        previous: current?.customFields ?? {},
      });
    }
    const fields = await repo.rpcUpdateTask(data.taskId, changes, warningRows(data.warnings));
    refresh(data.taskId);
    return ok({ fields });
  },
);

/** "Task Noted", for oneself or for a freelancer one coordinates (ADR-0013). */
export const acknowledgeTask = action(async (input: ActingInput): Promise<Result<null>> => {
  const data = actingSchema.parse(input);
  await assertPermission("tasks.work");
  await repo.rpcAcknowledge(data.taskId, data.onBehalfOf);
  refresh(data.taskId);
  return ok(null);
});

export const startTask = action(async (input: ActingInput): Promise<Result<null>> => {
  const data = actingSchema.parse(input);
  await assertPermission("tasks.work");
  await repo.rpcStart(data.taskId, data.onBehalfOf);
  refresh(data.taskId);
  return ok(null);
});

/** Done: the note (links allowed) and, past the deadline, the late reason (WORKFLOWS §3.1). */
export const submitDone = action(async (input: SubmitDoneInput): Promise<Result<null>> => {
  const data = submitDoneSchema.parse(input);
  await assertPermission("tasks.work");
  await repo.rpcSubmitDone(data);
  refresh(data.taskId);
  return ok(null);
});

/** The approving Admin's check or the Owner's final approval; a reject carries its reason. */
export const reviewTask = action(async (input: ReviewInput): Promise<Result<null>> => {
  const data = reviewSchema.parse(input);
  await assertPermission(["tasks.approve_admin", "tasks.approve_final"]);
  await repo.rpcReview(
    data.taskId,
    data.decision,
    data.decision === "rejected" ? data.reason : null,
  );
  refresh(data.taskId);
  return ok(null);
});

export const cancelTask = action(async (input: ReasonInput): Promise<Result<null>> => {
  const data = reasonSchema.parse(input);
  await assertPermission("tasks.create");
  await repo.rpcCancel(data.taskId, data.reason);
  refresh(data.taskId);
  return ok(null);
});

export const reopenTask = action(async (input: ReasonInput): Promise<Result<null>> => {
  const data = reasonSchema.parse(input);
  await assertPermission("tasks.create");
  await repo.rpcReopen(data.taskId, data.reason);
  refresh(data.taskId);
  return ok(null);
});

/** The Owner changes or removes the approving Admin (`task_set_approver`). */
export const setTaskApprover = action(async (input: SetApproverInput): Promise<Result<null>> => {
  const data = setApproverSchema.parse(input);
  await assertPermission("tasks.approve_final");
  await repo.rpcSetApprover(data.taskId, data.approvingAdminId);
  refresh(data.taskId);
  return ok(null);
});

export const tickStage = action(async (input: TickStageInput): Promise<Result<null>> => {
  const data = tickStageSchema.parse(input);
  await assertPermission("tasks.work");
  await repo.setStageDone(data);
  revalidatePath(taskPath(data.taskId));
  return ok(null);
});

export const addTaskStage = action(async (input: AddStageInput): Promise<Result<null>> => {
  const data = addStageSchema.parse(input);
  await assertPermission("tasks.create");
  await repo.addStage(data.taskId, data.name);
  revalidatePath(taskPath(data.taskId));
  return ok(null);
});

export const removeTaskStage = action(async (input: RemoveStageInput): Promise<Result<null>> => {
  const data = removeStageSchema.parse(input);
  await assertPermission("tasks.create");
  await repo.removeStage(data.taskId, data.stageId);
  revalidatePath(taskPath(data.taskId));
  return ok(null);
});

export const addTaskComment = action(async (input: CommentInput): Promise<Result<null>> => {
  const data = commentSchema.parse(input);
  await assertPermission("tasks.work");
  await repo.addComment(data);
  revalidatePath(taskPath(data.taskId));
  return ok(null);
});
