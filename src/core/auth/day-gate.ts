import { can, type MemberRole } from "@/core/permissions";

import { safeNextPath } from "./paths";

/**
 * The day gate's paths and its once-a-day pass (ARCHITECTURE §8, task 2.2). Pure and
 * runtime-neutral (Web Crypto), so it is unit-tested and usable from a layout or an action
 * alike. The server side (touch, cookie, redirects) is `gate.ts`.
 *
 * The pass says "this member's IST day is settled, stop asking the database": an HMAC-SHA256
 * over `memberId:date` with `DAY_GATE_COOKIE_SECRET`. The cookie holds only the date and the
 * MAC; the member id is taken from the verified session when checking, so a pass can never be
 * replayed by another member, on another day, or forged without the secret.
 */

export const DAY_GATE_COOKIE = "maxoff_day";
/** The choice screen, outside the shell (`src/app/(gate)`). */
export const ATTENDANCE_PATH = "/attendance";
/** The path + search of the page being rendered, forwarded by the proxy for `next=`. */
export const REQUEST_PATH_HEADER = "x-maxoff-path";

/** Whoever marks attendance is gated; the Owner (no `attendance.self`) never is. */
export function isGated(role: MemberRole): boolean {
  return can(role, "attendance.self");
}

/**
 * Where to go once the day is settled: a safe path (`safeNextPath()`), never the gate itself
 * (that would loop), else `/` (which routes to the role's home).
 */
export function gateNext(value: string | null | undefined): string {
  const next = safeNextPath(value);
  if (!next) return "/";
  const path = next.split(/[?#]/)[0] ?? "";
  return path === ATTENDANCE_PATH ? "/" : next;
}

/** The choice screen, carrying where the member was going. */
export function attendanceHref(next: string): string {
  return `${ATTENDANCE_PATH}?next=${encodeURIComponent(next)}`;
}

const encoder = new TextEncoder();

async function mac(secret: string, memberId: string, date: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(`${memberId}:${date}`));
  return Buffer.from(signature).toString("base64url");
}

/** The cookie value for that member and IST date: `<date>.<mac>`. */
export async function signDayPass(secret: string, memberId: string, date: string): Promise<string> {
  return `${date}.${await mac(secret, memberId, date)}`;
}

/** True only for a pass made with this secret, for this member, for this IST date. */
export async function verifyDayPass(
  secret: string,
  value: string | undefined,
  memberId: string,
  date: string,
): Promise<boolean> {
  if (!value) return false;
  const [passDate, passMac, ...rest] = value.split(".");
  if (rest.length > 0 || passDate !== date || !passMac) return false;
  return constantTimeEqual(passMac, await mac(secret, memberId, date));
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let i = 0; i < a.length; i += 1) difference |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return difference === 0;
}
