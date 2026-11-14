/**
 * The working hours `e2e/working-hours.spec.ts` sets around the hour it runs (X5, owner via the
 * advisor, #89, 11 Nov 2026): the e2e owns the screens, pgTAP 121 owns the clock's edges. Pure, so
 * the margins at the day's edges are proved without waiting for them (`tests/working-hours-day.test.ts`).
 */

/** The last minute of the IST day. */
export const LAST_MINUTE = 23 * 60 + 59;

/**
 * The shortest time to the day's end a test is given: whole minutes, so the end is never a few
 * seconds away (the minutes drop the seconds), and never reached while a test runs.
 */
export const END_MARGIN = 2;

/** The minutes of the IST day the spec can run in: 00:01 to 23:56. */
export const FIRST_RUNNABLE = 1;
export const LAST_RUNNABLE = LAST_MINUTE - END_MARGIN - 1;

/** `HH:MM` for minutes since midnight, held inside the day. */
export function hhmm(minutes: number): string {
  const held = Math.min(Math.max(minutes, 0), LAST_MINUTE);
  return `${String(Math.floor(held / 60)).padStart(2, "0")}:${String(held % 60).padStart(2, "0")}`;
}

export type DayHours = { start: number; end: number; startedAgo: number; grace: number };

/**
 * The day around `now` (minutes since IST midnight), inside the IST day: it started `startAgo`
 * minutes ago (never before 00:00) and ends in `endIn` minutes, or sooner where the day has less
 * left: at most half of what is left, so a Stay until after the end always fits, and never closer
 * than `END_MARGIN`. A late start (`startAgo` past the 15-minute grace) keeps the grace inside the
 * minutes the day has had, so one exists from 00:01 IST (CI 41878631715 ran at 00:0x IST, when a
 * fixed 15-minute grace left none). Outside 00:01-23:56 IST it throws, naming the time: never a
 * skip, a wait or a silent pass.
 */
export function dayHours(now: number, startAgo: number, endIn: number): DayHours {
  if (now < FIRST_RUNNABLE || now > LAST_RUNNABLE) {
    throw new Error(`working-hours fixture: outside the runnable window (${hhmm(now)} IST)`);
  }
  const start = Math.max(now - startAgo, 0);
  // `startedAgo` is what was really set, and what a late start measures (CI 41689282991: 20 at
  // 00:20 IST, against a fixed 39).
  const startedAgo = now - start;
  const grace = startAgo > 15 ? Math.min(15, startedAgo - 1) : 15;
  const left = LAST_MINUTE - now;
  const end = now + Math.max(END_MARGIN, Math.min(endIn, Math.floor(left / 2)));
  return { start, end, startedAgo, grace };
}
