import { tmpdir } from "node:os";
import path from "node:path";

/** Where the global setup leaves what the teardown checks (one run at a time per machine). */
export const RUN_STATE_FILE = path.join(tmpdir(), "maxoff-e2e-run-state.json");

/**
 * The real clock, for the test infrastructure's own timestamps and deadlines (a Mailpit lower
 * bound, a readiness deadline, which IST day a run started on). Never a business date: those
 * come from the app under test (ADR-0008), which is why the wall-clock rule stays on for specs.
 */
export function wallClock(): Date {
  // eslint-disable-next-line no-restricted-syntax -- the one wall-clock read the e2e suite makes; see above
  return new Date();
}

/** The calendar date in Asia/Kolkata, `YYYY-MM-DD` (the business day, CLAUDE.md rule 8). */
export function istDate(at: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);
}
