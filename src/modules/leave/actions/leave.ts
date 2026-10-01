"use server";

import { revalidatePath } from "next/cache";

import { action, ok, type Result } from "@/core/errors";
import { dispatchPushSoon } from "@/core/notifications/push/dispatch";
import { assertPermission } from "@/core/permissions/server";
import { todayIST } from "@/core/time";

import { getCompBalance } from "../data/credits";
import * as repo from "../data/leave";
import {
  type CancelLeaveInput,
  cancelLeaveSchema,
  type ChangeLeaveInput,
  changeLeaveSchema,
  type RequestCompLeaveInput,
  requestCompLeaveSchema,
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
  revalidatePath("/leave/extra-work");
  // Today's card follows a request for today.
  revalidatePath("/my-day");
  revalidatePath("/today");
}

export const requestLeave = action(async (input: RequestLeaveInput): Promise<Result<null>> => {
  const data = requestLeaveSchema(todayIST()).parse(input);
  await assertPermission("attendance.self");
  await repo.rpcSubmit(data);
  revalidateLeave();
  dispatchPushSoon();
  return ok(null);
});

/**
 * Comp leave, only with a credit (PRODUCT §4.3a, decision 16): one date on or before the use-by
 * date, a full or a half day. The form's own check reads the balance; `leave_submit_comp()` is
 * the rule and reserves the credits oldest first.
 */
export const requestCompLeave = action(
  async (input: RequestCompLeaveInput): Promise<Result<null>> => {
    requestCompLeaveSchema(todayIST(), null).parse(input);
    const member = await assertPermission("attendance.self");
    // The use-by date is the member's own, so the full check needs the balance read after it.
    const balance = await getCompBalance(member.id);
    const data = requestCompLeaveSchema(todayIST(), balance.useBy).parse(input);
    await repo.rpcSubmitComp(data);
    revalidateLeave();
    dispatchPushSoon();
    return ok(null);
  },
);

export const requestLeaveChange = action(async (input: ChangeLeaveInput): Promise<Result<null>> => {
  const { requestId, originalStart } = requestIdSchema.parse(input);
  const data = changeLeaveSchema(todayIST(), originalStart ?? "").parse(input);
  await assertPermission("attendance.self");
  await repo.rpcRequestChange(requestId, { cancel: false, ...data });
  revalidateLeave();
  dispatchPushSoon();
  return ok(null);
});

export const requestLeaveCancellation = action(
  async (input: CancelLeaveInput): Promise<Result<null>> => {
    const data = cancelLeaveSchema.parse(input);
    await assertPermission("attendance.self");
    await repo.rpcRequestChange(data.requestId, { cancel: true, reason: data.reason });
    revalidateLeave();
    dispatchPushSoon();
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
