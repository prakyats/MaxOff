"use server";

import { revalidatePath } from "next/cache";

import { action, type BulkOutcome, eachId, ok, type Result } from "@/core/errors";
import { dispatchPushSoon } from "@/core/notifications/push/dispatch";
import { assertPermission } from "@/core/permissions/server";

import * as repo from "../data/tasks";
import {
  type ApproveTaskInput,
  approveTaskSchema,
  type ApproveTasksInput,
  approveTasksSchema,
} from "../domain/schemas";

/**
 * The Approvals screen's task group (4.5; PRODUCT §4.7, Kickoff 4 decision 5): Approve (one task,
 * sent after the 6-second Undo) and "Approve all N" (approve only, one `task_review` per id, 4A
 * decision (g)). A change request is one task with a reason, through `reviewTask`. The database
 * decides the step (the approving Admin's check, the Owner's approval).
 */

function revalidateApprovals(): void {
  // The layout carries the Approvals and Tasks badges, so the whole signed-in tree refreshes.
  revalidatePath("/", "layout");
}

const DECIDERS = ["tasks.approve_admin", "tasks.approve_final"] as const;

/** One approval at the step the viewer decides (the delayed send behind Undo). */
export const approveTask = action(async (input: ApproveTaskInput): Promise<Result<null>> => {
  const data = approveTaskSchema.parse(input);
  await assertPermission([...DECIDERS]);
  await repo.rpcReview(data.taskId, "approved", null);
  revalidateApprovals();
  dispatchPushSoon();
  return ok(null);
});

/** "Approve all N": the ids on screen, one call each, each its own review row and audit entry. */
export const approveTasks = action(
  async (input: ApproveTasksInput): Promise<Result<BulkOutcome>> => {
    const data = approveTasksSchema.parse(input);
    await assertPermission([...DECIDERS]);
    const outcome = await eachId(data.taskIds, (id) => repo.rpcReview(id, "approved", null));
    revalidateApprovals();
    dispatchPushSoon();
    return ok(outcome);
  },
);
