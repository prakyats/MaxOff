"use server";

import { revalidatePath } from "next/cache";

import { action, ok, type Result } from "@/core/errors";
import { assertPermission } from "@/core/permissions/server";
import { todayIST } from "@/core/time";

import * as repo from "../data/leave";
import {
  type CancelLeaveInput,
  cancelLeaveSchema,
  type ChangeLeaveInput,
  changeLeaveSchema,
  type RequestLeaveInput,
  requestIdSchema,
  requestLeaveSchema,
  type WithdrawLeaveInput,
  withdrawLeaveSchema,
} from "../domain/schemas";

/**
 * The member's own leave (WORKFLOWS §2, PRODUCT §4.3). Thin by rule (ADR-0011): parse,
 * permission, the transition function, revalidate. The functions decide; they also serialise
 * one member's leave writes, so two tabs cannot both pass the overlap check.
 */

function revalidateLeave() {
  revalidatePath("/leave");
  // Today's card follows a request for today.
  revalidatePath("/my-day");
  revalidatePath("/today");
}

export const requestLeave = action(async (input: RequestLeaveInput): Promise<Result<null>> => {
  const data = requestLeaveSchema(todayIST()).parse(input);
  await assertPermission("attendance.self");
  await repo.rpcSubmit(data);
  revalidateLeave();
  return ok(null);
});

export const requestLeaveChange = action(async (input: ChangeLeaveInput): Promise<Result<null>> => {
  const { requestId, originalStart } = requestIdSchema.parse(input);
  const data = changeLeaveSchema(todayIST(), originalStart ?? "").parse(input);
  await assertPermission("attendance.self");
  await repo.rpcRequestChange(requestId, { cancel: false, ...data });
  revalidateLeave();
  return ok(null);
});

export const requestLeaveCancellation = action(
  async (input: CancelLeaveInput): Promise<Result<null>> => {
    const data = cancelLeaveSchema.parse(input);
    await assertPermission("attendance.self");
    await repo.rpcRequestChange(data.requestId, { cancel: true, reason: data.reason });
    revalidateLeave();
    return ok(null);
  },
);

export const withdrawLeave = action(async (input: WithdrawLeaveInput): Promise<Result<null>> => {
  const data = withdrawLeaveSchema.parse(input);
  await assertPermission("attendance.self");
  await repo.rpcWithdraw(data.requestId);
  revalidateLeave();
  return ok(null);
});
