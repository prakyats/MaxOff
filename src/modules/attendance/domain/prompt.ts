/**
 * The Start-day prompt's snooze (PRODUCT §4.2, kickoff 3b decision 3): the prompt comes back
 * when the app is opened or returned to, **at most once every 30 minutes**, until the day is
 * started or leave chosen. "Just looking", closing the sheet and the back gesture all count as
 * "asked, not now". Pure, so the rule is unit-tested; the component keeps the timestamp in
 * `localStorage` (a per-device convenience, never state the server needs).
 */

export const PROMPT_SNOOZE_MS = 30 * 60 * 1000;

/** One key per member per IST date, so a new day (or another person on the device) asks again. */
export function promptSnoozeKey(memberId: string, workDate: string): string {
  return `maxoff:start-day-prompt:${memberId}:${workDate}`;
}

/**
 * Whether to show the prompt now. `lastShownAt` is when it was last dismissed (ms since the
 * epoch) or null when it never was; anything unreadable counts as "never".
 */
export function promptDueNow(lastShownAt: number | null, now: number): boolean {
  if (lastShownAt === null || !Number.isFinite(lastShownAt)) return true;
  return now - lastShownAt >= PROMPT_SNOOZE_MS;
}

/** Parses a stored timestamp; a missing or corrupt value is "never shown". */
export function parseShownAt(value: string | null): number | null {
  if (value === null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
