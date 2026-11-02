"use server";

import { revalidateScreens } from "@/core/lib/revalidate-screens";
import { action, ok, type Result } from "@/core/errors";
import { dispatchPushSoon } from "@/core/notifications/push/dispatch";
import { assertPermission } from "@/core/permissions/server";
import { istInstant, todayIST } from "@/core/time";

import * as repo from "../data/hours";
import {
  type AskLeaveEarlyInput,
  askLeaveEarlySchema,
  type DecideEarlyLeaveInput,
  decideEarlyLeaveSchema,
  type LateReasonInput,
  lateReasonSchema,
  type StayUntilInput,
  stayUntilSchema,
} from "../domain/schemas";

/**
 * Working hours (v1.9 W4; WORKFLOWS §1 "Working hours, late starts and leaving early"; ARCHITECTURE
 * §4.2): zod → `assertPermission()` → the transition function (ADR-0006: the rules, the person's
 * lock, the audit and the notification are the database's) → revalidate → `Result`. Thin.
 */

/** The strip, the prompt, Approvals and Today all read the day: the whole signed-in tree. */
function revalidateHours(): void {
  revalidateScreens();
}

/** The one-line reason for today's late start. */
export const addLateReason = action(async (input: LateReasonInput): Promise<Result<null>> => {
  const data = lateReasonSchema.parse(input);
  await assertPermission("attendance.self");
  await repo.rpcLateReason(data.reason);
  revalidateHours();
  return ok(null);
});

/** "Ask to leave early": the person stays checked in; the Owner gets a push. */
export const askLeaveEarly = action(async (input: AskLeaveEarlyInput): Promise<Result<null>> => {
  const data = askLeaveEarlySchema.parse(input);
  await assertPermission("attendance.self");
  await repo.rpcAskLeaveEarly(data.reason);
  revalidateHours();
  dispatchPushSoon();
  return ok(null);
});

/** The Owner's answer: Approve (the day ends at the ask) or Stay; later Approve or Correct. */
export const decideEarlyLeave = action(
  async (input: DecideEarlyLeaveInput): Promise<Result<{ state: string }>> => {
    const data = decideEarlyLeaveSchema.parse(input);
    await assertPermission("attendance.decide");
    const state = await repo.rpcDecideEarlyLeave({
      requestId: data.requestId,
      decision: data.decision,
      status: data.status ?? null,
      reason: data.reason,
    });
    revalidateHours();
    dispatchPushSoon();
    return ok({ state });
  },
);

/** The Owner's "Stay until" a time today (IST), or null to clear it; the person is told at once. */
export const setStayUntil = action(async (input: StayUntilInput): Promise<Result<null>> => {
  const data = stayUntilSchema.parse(input);
  await assertPermission("attendance.decide");
  await repo.rpcStayUntil(data.memberId, data.until ? istInstant(todayIST(), data.until) : null);
  revalidateHours();
  dispatchPushSoon();
  return ok(null);
});
