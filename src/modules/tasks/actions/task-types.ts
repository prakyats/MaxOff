"use server";

import { z } from "zod";

import { revalidateScreens } from "@/core/lib/revalidate-screens";
import { action, AppError, ok, type Result } from "@/core/errors";
import type { UnusedUsage } from "@/core/lib/owner-delete";
import { assertOwner, assertPermission } from "@/core/permissions/server";

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
 * `settings.manage`. zod → permission → repository → revalidate. A type's default reminders
 * (5.3) are saved with it; the CHECK constraint `task_types_default_reminders_valid` agrees.
 */

function revalidateTypes(): void {
  // Settings, the create dialog, the task pages, the lists and the calendar name the types.
  revalidateScreens();
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

const typeIdSchema = z.object({ typeId: z.uuid() });
export type TaskTypeIdInput = z.input<typeof typeIdSchema>;

/**
 * The Owner-only Delete of a task type nothing has ever used (v1.8 V5a 6c): no task, template or
 * field, live, archived or deleted, and no history beyond its creation. The confirm reads the usage
 * first; the database checks again and keeps the last active type.
 */
export const taskTypeUsage = action(
  async (input: TaskTypeIdInput): Promise<Result<UnusedUsage>> => {
    const { typeId } = typeIdSchema.parse(input);
    await assertOwner();
    return ok(await repo.taskTypeUsage(typeId));
  },
);

export const deleteTaskType = action(async (input: TaskTypeIdInput): Promise<Result<null>> => {
  const { typeId } = typeIdSchema.parse(input);
  await assertOwner();
  await repo.deleteTaskType(typeId);
  revalidateScreens();
  return ok(null);
});
