"use server";

import { revalidatePath } from "next/cache";

import { action, type BulkOutcome, eachId, ok, type Result } from "@/core/errors";
import { assertPermission } from "@/core/permissions/server";

import * as repo from "../data/review";
import { keptDatesNote } from "../domain/review";
import {
  type ApproveLeaveInput,
  approveLeaveSchema,
  type ApproveLeavesInput,
  approveLeavesSchema,
  type OwnerCancelLeaveInput,
  ownerCancelLeaveSchema,
  type OwnerEditLeaveInput,
  ownerEditLeaveSchema,
  type RejectLeaveInput,
  rejectLeaveSchema,
} from "../domain/schemas";

/**
 * The Owner's leave decisions (task 2.4, ARCHITECTURE §4.2): zod → `assertPermission()` → the
 * transition function → revalidate → `Result`. The rules live in the functions.
 */

function revalidateReview(): void {
  // The layout carries the Approvals badge, so the whole signed-in tree refreshes.
  revalidatePath("/", "layout");
}

/** Approve one request; the dates whose earlier Owner decision was kept come back. */
export const approveLeave = action(
  async (input: ApproveLeaveInput): Promise<Result<{ keptDates: string[] }>> => {
    const data = approveLeaveSchema.parse(input);
    await assertPermission("attendance.decide");
    const keptDates = await repo.rpcApprove(data.requestId);
    revalidateReview();
    return ok({ keptDates });
  },
);

/** "Approve all N": one call per request on screen, each its own audit entry. */
export const approveLeaves = action(
  async (input: ApproveLeavesInput): Promise<Result<BulkOutcome>> => {
    const data = approveLeavesSchema.parse(input);
    await assertPermission("attendance.decide");
    const kept: string[] = [];
    const outcome = await eachId(data.requestIds, async (id) => {
      kept.push(...(await repo.rpcApprove(id)));
    });
    revalidateReview();
    const note = keptDatesNote(kept);
    return ok(note ? { ...outcome, note } : outcome);
  },
);

export const rejectLeave = action(async (input: RejectLeaveInput): Promise<Result<null>> => {
  const data = rejectLeaveSchema.parse(input);
  await assertPermission("attendance.decide");
  await repo.rpcDecide(data.requestId, "reject", data.reason);
  revalidateReview();
  return ok(null);
});

export const ownerEditLeave = action(
  async (input: OwnerEditLeaveInput): Promise<Result<{ keptDates: string[] }>> => {
    const data = ownerEditLeaveSchema.parse(input);
    await assertPermission("attendance.decide");
    const keptDates = await repo.rpcOwnerEdit(data);
    revalidateReview();
    return ok({ keptDates });
  },
);

export const ownerCancelLeave = action(
  async (input: OwnerCancelLeaveInput): Promise<Result<null>> => {
    const data = ownerCancelLeaveSchema.parse(input);
    await assertPermission("attendance.decide");
    await repo.rpcOwnerCancel(data.requestId, data.reason);
    revalidateReview();
    return ok(null);
  },
);
