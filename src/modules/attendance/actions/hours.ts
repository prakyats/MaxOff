"use server";

import { revalidateScreens } from "@/core/lib/revalidate-screens";
import { action, ok, type Result } from "@/core/errors";
import { dispatchPushSoon } from "@/core/notifications/push/dispatch";
import { assertPermission } from "@/core/permissions/server";
import { istInstant, todayIST } from "@/core/time";

import * as repo from "../data/hours";
import * as plans from "../data/stay-plans";
import {
  type AskLeaveEarlyInput,
  askLeaveEarlySchema,
  type ClearLateInput,
  clearLateSchema,
  type ClearStayPlanInput,
  clearStayPlanSchema,
  type DecideEarlyLeaveInput,
  decideEarlyLeaveSchema,
  type LateReasonInput,
  lateReasonSchema,
  type OfflineTryInput,
  offlineTrySchema,
  type StayPlanInput,
  stayPlanSchema,
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

/**
 * v7.0: the Owner's "Stay until" for a person on a date, today or later (a person's page). The
 * database refuses a day of approved leave and a time not after the end time; the person is told.
 */
export const setStayPlan = action(async (input: StayPlanInput): Promise<Result<null>> => {
  const data = stayPlanSchema.parse(input);
  await assertPermission("attendance.decide");
  await plans.rpcStayPlanSet(data.memberId, data.workDate, istInstant(data.workDate, data.until));
  revalidateHours();
  dispatchPushSoon();
  return ok(null);
});

/** v7.0: "Back to 6:00 pm" for a Stay until set ahead: cleared, kept; the person is told. */
export const clearStayPlan = action(async (input: ClearStayPlanInput): Promise<Result<null>> => {
  const data = clearStayPlanSchema.parse(input);
  await assertPermission("attendance.decide");
  await plans.rpcStayPlanClear(data.planId);
  revalidateHours();
  dispatchPushSoon();
  return ok(null);
});

/** v7.0 (owner Q2): the Owner's one-tap Clear Late, or its Undo. Nobody is notified. */
export const clearLate = action(async (input: ClearLateInput): Promise<Result<null>> => {
  const data = clearLateSchema.parse(input);
  await assertPermission("attendance.decide");
  await plans.rpcClearLate(data.dayId, data.undo);
  revalidateHours();
  return ok(null);
});

/**
 * v7.0 (owner Q2): after a Start that landed, the phone's first try with no network goes to the
 * day as a note (phone time). The database keeps it only for a Late start, and only once.
 */
export const noteOfflineTry = action(async (input: OfflineTryInput): Promise<Result<null>> => {
  const data = offlineTrySchema.parse(input);
  await assertPermission("attendance.self");
  await plans.rpcNoteOfflineTry(data.triedAt);
  return ok(null);
});
