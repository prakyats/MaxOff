"use server";

import { revalidatePath } from "next/cache";
import { redirect, RedirectType } from "next/navigation";

import { gateNext } from "@/core/auth/day-gate";
import { setDayPass } from "@/core/auth/gate";
import { setHomeHint } from "@/core/auth/server";
import { action, ok, type Result } from "@/core/errors";
import { assertPermission } from "@/core/permissions/server";

import {
  type FlagOvertimeInput,
  flagOvertimeSchema,
  type FlagOvertimeTodayInput,
  flagOvertimeTodaySchema,
  type SubmitChoiceInput,
  submitChoiceSchema,
  type WorkingTodayInput,
  workingTodaySchema,
} from "../domain/schemas";
import * as repo from "../data/attendance";

/**
 * Attendance actions (ARCHITECTURE §4.2): zod → `assertPermission()` → transition function →
 * revalidate → `Result`. The rules (states, dates, the day changing) live in the functions.
 */

const HOME_PATHS = ["/my-day", "/today", "/leave/attendance"] as const;

function revalidateHomes(): void {
  for (const path of HOME_PATHS) revalidatePath(path);
}

/**
 * The gate's answer. On success today's pass is set and the browser goes where it was going,
 * **replacing** the gate in the history (so a back gesture never returns to it). A screen
 * shown for another date comes back as `INVALID_STATE` "The day changed", and the form
 * reloads the gate for today.
 */
export const submitDayChoice = action(async (input: SubmitChoiceInput): Promise<Result<null>> => {
  const data = submitChoiceSchema.parse(input);
  const member = await assertPermission("attendance.self");
  await repo.rpcSubmit(data.choice, data.reason, data.forDate);
  await setDayPass(member.id, data.forDate);
  // The home hint's daily refresh (2.7, `core/auth/home-hint.ts`), with the day's pass.
  await setHomeHint(member.id, member.role);
  revalidateHomes();
  redirect(gateNext(data.next), RedirectType.replace);
});

/** "I'm working today" / "I'm working the full day" on an approved-leave day. */
export const declareWorkingToday = action(
  async (input: WorkingTodayInput): Promise<Result<null>> => {
    const data = workingTodaySchema.parse(input);
    await assertPermission("attendance.self");
    await repo.rpcSubmit("present", null, data.forDate);
    revalidateHomes();
    return ok(null);
  },
);

/** Overtime on the member's own day: a notice with a reason, no approval (WORKFLOWS §1). */
export const flagOvertime = action(async (input: FlagOvertimeInput): Promise<Result<null>> => {
  const data = flagOvertimeSchema.parse(input);
  await assertPermission("attendance.self");
  await repo.rpcFlagOvertime(data.dayId, data.reason);
  revalidateHomes();
  return ok(null);
});

/**
 * Overtime from the Log out confirmation ("Worked late today? Add an overtime note"): the
 * database picks the day the logout will land on (today's, or yesterday's still-open day after
 * midnight). A second note replaces the first, as `attendance_flag_overtime` does.
 */
export const flagOvertimeToday = action(
  async (input: FlagOvertimeTodayInput): Promise<Result<null>> => {
    const data = flagOvertimeTodaySchema.parse(input);
    await assertPermission("attendance.self");
    await repo.rpcFlagOvertimeToday(data.reason);
    revalidateHomes();
    return ok(null);
  },
);
