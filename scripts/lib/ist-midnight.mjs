/**
 * When a CI e2e run may start (ARCHITECTURE §15, 2026-09-30). The suite runs on the real clock,
 * in both the server (`core/time`) and Postgres (`app.today_ist()`, and the attendance jobs at
 * 23:59 and 00:00 IST), and its specs read "today" at different moments; a run that crossed
 * midnight IST (18:30 UTC) went red in specs that have nothing to do with dates (PR #25's first
 * run: the new day's Start day prompt over every Staff and Admin screen). A run that could still
 * be going at the 23:59 IST job waits until just after midnight instead.
 */

/** 23:59 IST, the first job of the night (`absent_check`), in minutes after 00:00 UTC. */
export const FIRST_NIGHT_JOB_UTC_MIN = 18 * 60 + 29;
/** Safely into the new IST day, after the 00:00 IST jobs, in minutes after 00:00 UTC. */
export const RESUME_UTC_MIN = 18 * 60 + 31;
/** The longest an e2e shard takes from this step to its end, with room (runs take 11-15). */
export const E2E_RUN_MIN = 30;

/**
 * How long to wait before the run starts, in milliseconds: 0 outside the window.
 * @param {Date} now
 * @returns {number}
 */
export function waitBeforeE2e(now) {
  const day = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const minutes = (now.getTime() - day) / 60_000;
  const opens = FIRST_NIGHT_JOB_UTC_MIN - E2E_RUN_MIN;
  if (minutes < opens || minutes >= RESUME_UTC_MIN) return 0;
  return day + RESUME_UTC_MIN * 60_000 - now.getTime();
}
