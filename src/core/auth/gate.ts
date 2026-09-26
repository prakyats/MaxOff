import "server-only";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";

import { createServerSupabase } from "@/core/db/server";
import type { Enums } from "@/core/db";
import { captureMessage } from "@/core/observability/capture";
import { todayIST } from "@/core/time";

import {
  DAY_GATE_COOKIE,
  attendanceHref,
  gateNext,
  isGated,
  REQUEST_PATH_HEADER,
  signDayPass,
  verifyDayPass,
} from "./day-gate";
import { dayGateCookieSecret } from "./env";
import { sessionMetaArgs } from "./session-meta";
import type { CurrentMember } from "./types";

/**
 * The first-login day gate (ARCHITECTURE §8, WORKFLOWS §1). `requireDayGate()` runs in the
 * `(app)` layout; the `/attendance` screen, its action and `issueDayPass` use the rest.
 */

/** What `attendance_touch()` answers, in the app's words. */
export type TodayGate = {
  dayId: string | null;
  /** The IST date the database opened (or found) the day for. */
  workDate: string;
  state: Enums<"attendance_state"> | null;
  gateRequired: boolean;
  isDayOff: boolean;
};

/**
 * Opens (or finds) today's attendance day and records a login when there is none today.
 * Idempotent and serialised per member in the database (two devices at once give one day and
 * one login row, WORKFLOWS §1). Once per request (`cache()`): Next renders a layout and its
 * page in parallel, so a page that needs today's day (the attendance card) awaits this same
 * call instead of reading before the layout's touch has opened the day.
 */
export const touchToday = cache(async (): Promise<TodayGate> => {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.rpc("attendance_touch", await sessionMetaArgs());
  if (error) throw error;
  // `returns table`: PostgREST hands back a one-row array.
  const row = data[0];
  if (!row) throw new Error("attendance_touch returned no row");
  return {
    dayId: row.day_id,
    workDate: row.work_date,
    state: row.state,
    gateRequired: row.gate_required,
    isDayOff: row.is_day_off,
  };
});

let missingSecretReported = false;

/** Once per server instance: a deployed build without the secret is correct but slower. */
function reportMissingSecretOnce(): void {
  if (missingSecretReported) return;
  missingSecretReported = true;
  if ((process.env.NEXT_PUBLIC_APP_ENV ?? "local") === "local") return;
  captureMessage(
    "DAY_GATE_COOKIE_SECRET is not set: every page load calls attendance_touch()",
    "warning",
  );
}

/** Sets today's pass for this member (a route handler or a server action only). */
export async function setDayPass(memberId: string, date: string): Promise<void> {
  const secret = dayGateCookieSecret();
  if (!secret) {
    reportMissingSecretOnce();
    return;
  }
  const appEnv = process.env.NEXT_PUBLIC_APP_ENV;
  (await cookies()).set(DAY_GATE_COOKIE, await signDayPass(secret, memberId, date), {
    httpOnly: true,
    sameSite: "lax",
    secure: appEnv === "staging" || appEnv === "production",
    path: "/",
    // The pass names its date, so it is useless tomorrow anyway; this only tidies the jar.
    maxAge: 60 * 60 * 36,
  });
}

/**
 * For the `(app)` layout, after `requireMember()`. The Owner is skipped first, from the role's
 * permissions, before any cookie or query. Anyone else with today's pass renders at once.
 * Without one the database is asked (`attendance_touch()`): a day that still needs a choice
 * redirects to the choice screen; a settled day renders, and the answer `"issue-pass"` tells
 * the layout to mount `<IssueDayPass />`, which sets today's pass through a server action
 * (a layout cannot set cookies). No redirect hop: a route handler in the middle of a
 * client-side navigation rendered a blank page when it redirected back to the same route.
 * Without the secret there is no pass, so the database is asked on every page load.
 */
export async function requireDayGate(member: CurrentMember): Promise<"settled" | "issue-pass"> {
  if (!isGated(member.role)) return "settled";

  const secret = dayGateCookieSecret();
  if (secret) {
    const pass = (await cookies()).get(DAY_GATE_COOKIE)?.value;
    if (await verifyDayPass(secret, pass, member.id, todayIST())) return "settled";
  } else {
    reportMissingSecretOnce();
  }

  const today = await touchToday();
  if (today.gateRequired) {
    redirect(attendanceHref(gateNext((await headers()).get(REQUEST_PATH_HEADER))));
  }
  return secret ? "issue-pass" : "settled";
}

/**
 * The `issueDayPass` action's body: today's pass for a gated member whose day needs no choice.
 * It asks the database again rather than trusting the caller, so the action cannot be used to
 * skip the gate.
 */
export async function issueDayPassFor(member: CurrentMember): Promise<void> {
  if (!isGated(member.role)) return;
  const today = await touchToday();
  if (!today.gateRequired) await setDayPass(member.id, today.workDate);
}
