"use server";

import { revalidatePath } from "next/cache";

import { action, AppError, ok, type Result } from "@/core/errors";
import { assertPermission } from "@/core/permissions/server";

import * as repo from "../data/task-types";
import {
  type AddTaskTypeInput,
  addTaskTypeSchema,
  type ArchiveTaskTypeInput,
  archiveTaskTypeSchema,
  type EditTaskTypeInput,
  editTaskTypeSchema,
  type MoveTaskTypeInput,
  moveTaskTypeSchema,
} from "../domain/schemas";
import { isLastActiveType } from "../domain/task-types";

/**
 * Settings → Task types (4C; PRODUCT §4.6, Kickoff 4 decisions 14, 15): the Owner's list,
 * `settings.manage`. zod → permission → repository → revalidate. No reminder editor (5.3's).
 */

function revalidateTypes(): void {
  revalidatePath("/settings", "layout");
  // The create dialog, the task pages and the lists name the types.
  revalidatePath("/tasks", "layout");
}

export const addTaskType = action(
  async (input: AddTaskTypeInput): Promise<Result<{ taskTypeId: string }>> => {
    const data = addTaskTypeSchema.parse(input);
    await assertPermission("settings.manage");
    const taskTypeId = await repo.insertTaskType(data);
    revalidateTypes();
    return ok({ taskTypeId });
  },
);

export const editTaskType = action(async (input: EditTaskTypeInput): Promise<Result<null>> => {
  const { taskTypeId, ...values } = editTaskTypeSchema.parse(input);
  await assertPermission("settings.manage");
  await repo.updateTaskType(taskTypeId, values);
  revalidateTypes();
  return ok(null);
});

/** Archive or restore. The last active type stays: a new task always needs one. */
export const setTaskTypeArchived = action(
  async (input: ArchiveTaskTypeInput): Promise<Result<null>> => {
    const data = archiveTaskTypeSchema.parse(input);
    await assertPermission("settings.manage");
    if (data.archived && isLastActiveType(await repo.listTaskTypeSettings(), data.taskTypeId)) {
      throw new AppError("INVALID_STATE", "Keep at least one task type: add another first.");
    }
    await repo.setTaskTypeArchived(data.taskTypeId, data.archived);
    revalidateTypes();
    return ok(null);
  },
);

export const moveTaskType = action(async (input: MoveTaskTypeInput): Promise<Result<null>> => {
  const data = moveTaskTypeSchema.parse(input);
  await assertPermission("settings.manage");
  await repo.rpcMoveTaskType(data.taskTypeId, data.direction);
  revalidateTypes();
  return ok(null);
});
