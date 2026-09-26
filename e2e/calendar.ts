/**
 * The suite runs on a working day, whatever the calendar says (2026-09-27, the first IST
 * Sunday since phase 2's specs exist: 1 e2e and 1 pgTAP assertion went red on `main` because
 * the seed's weekly day off is Sunday). The global setup pins it: when today's IST weekday is
 * a weekly day off, that day moves to tomorrow's weekday, and a holiday on today is removed.
 * `settings.spec` asserts the pinned value, not the seed's, so it holds on a Sunday too. The
 * pure parts live here so a unit test can pin the rule (tests/e2e-calendar.test.ts).
 */

export const WEEKDAY_LONG = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

/** Monday first, as Settings → Days off lists and sentences the week. */
const WEEK_START_MONDAY = [1, 2, 3, 4, 5, 6, 0] as const;

/** The weekday index (0 = Sunday) of an instant in Asia/Kolkata. */
export function istWeekday(at: Date): number {
  const short = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Kolkata", weekday: "short" })
    .format(at)
    .slice(0, 3);
  const index = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(short);
  if (index < 0) throw new Error(`unexpected weekday ${short}`);
  return index;
}

/**
 * The weekly off days the suite runs with: the configured ones, except that a day off falling
 * on today moves to tomorrow's weekday (so today is a working day and there is still one day
 * off to assert). Deduplicated and sorted.
 */
export function pinnedOffDays(configured: readonly number[], today: number): number[] {
  const moved = configured.map((day) => (day === today ? (today + 1) % 7 : day));
  return [...new Set(moved)].sort((a, b) => a - b);
}

/** "Sunday", "Saturday and Sunday", "None": the sentence Settings → Days off shows. */
export function describeOffDays(days: readonly number[]): string {
  const names = WEEK_START_MONDAY.filter((day) => days.includes(day)).map(
    (day) => WEEKDAY_LONG[day],
  );
  if (names.length === 0) return "None";
  if (names.length === 1) return names[0] ?? "None";
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

type OrgSettingsRow = { org_id: string; weekly_off_days: number[] };

/**
 * Pins today as a working day on the local stack through PostgREST with the service key:
 * moves a weekly day off that falls on today, deletes a holiday dated today. Returns what it
 * found and what the suite now runs with, for the setup's log line.
 */
export async function pinWorkingDay(
  url: string,
  serviceKey: string,
  now: Date,
  todayISO: string,
): Promise<{ configured: number[]; pinned: number[] }> {
  const headers = {
    apikey: serviceKey,
    // A legacy service_role JWT also needs the bearer header; an sb_secret key does not.
    ...(serviceKey.startsWith("eyJ") ? { authorization: `Bearer ${serviceKey}` } : {}),
    "content-type": "application/json",
  };
  const rest = (path: string, init: RequestInit = {}) =>
    fetch(`${url}/rest/v1/${path}`, { ...init, headers: { ...headers, ...init.headers } });

  const rows = (await (await rest("org_settings?select=org_id,weekly_off_days")).json()) as
    OrgSettingsRow[] | { message?: string };
  if (!Array.isArray(rows) || rows.length !== 1 || rows[0] === undefined) {
    throw new Error(`org_settings: expected one row, got ${JSON.stringify(rows)}`);
  }
  const { org_id, weekly_off_days: configured } = rows[0];
  const pinned = pinnedOffDays(configured, istWeekday(now));
  if (pinned.join() !== [...configured].sort((a, b) => a - b).join()) {
    const response = await rest(`org_settings?org_id=eq.${org_id}`, {
      method: "PATCH",
      body: JSON.stringify({ weekly_off_days: pinned }),
    });
    if (!response.ok)
      throw new Error(`org_settings patch: ${response.status} ${await response.text()}`);
  }
  const holidays = await rest(`holidays?date=eq.${todayISO}`, { method: "DELETE" });
  if (!holidays.ok) throw new Error(`holidays delete: ${holidays.status} ${await holidays.text()}`);
  return { configured, pinned };
}
