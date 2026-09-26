"use server";

import { revalidatePath } from "next/cache";

import { action, type BulkOutcome, eachId, ok, type Result } from "@/core/errors";
import { assertPermission } from "@/core/permissions/server";

import * as repo from "../data/review";
import {
  type ApproveDayInput,
  approveDaySchema,
  type ApproveDaysInput,
  approveDaysSchema,
  type CorrectDayInput,
  correctDaySchema,
} from "../domain/schemas";

/**
 * The Owner's attendance decisions (task 2.4, ARCHITECTURE §4.2): zod → `assertPermission()` →
 * `attendance_decide()` → revalidate → `Result`. The rules live in the function.
 */

function revalidateReview(): void {
  // The layout carries the Approvals badge, so the whole signed-in tree refreshes.
  revalidatePath("/", "layout");
}

export const approveDay = action(async (input: ApproveDayInput): Promise<Result<null>> => {
  const data = approveDaySchema.parse(input);
  await assertPermission("attendance.decide");
  await repo.rpcApproveDay(data.dayId);
  revalidateReview();
  return ok(null);
});

/** "Approve all N": one call per day on screen, each its own audit entry; per-day results. */
export const approveDays = action(async (input: ApproveDaysInput): Promise<Result<BulkOutcome>> => {
  const data = approveDaysSchema.parse(input);
  await assertPermission("attendance.decide");
  const outcome = await eachId(data.dayIds, repo.rpcApproveDay);
  revalidateReview();
  return ok(outcome);
});

export const correctDay = action(async (input: CorrectDayInput): Promise<Result<null>> => {
  const data = correctDaySchema.parse(input);
  await assertPermission("attendance.decide");
  await repo.rpcCorrectDay(data.dayId, data.status, data.reason);
  revalidateReview();
  return ok(null);
});
