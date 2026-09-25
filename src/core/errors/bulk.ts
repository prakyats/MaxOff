import type { ErrorCode } from "./codes";

// Server-free on purpose: the approval screens import `bulkSummary` in the browser. `eachId`,
// which maps throws through `action.ts` (zod, error reporting), lives in `each-id.ts` (2.8).

/**
 * What a bulk action returns (ARCHITECTURE §4.1: "call the function for each id inside one
 * request and return per-id results"). A row that failed keeps its own message, so the screen
 * leaves it in place with that message instead of one error for the whole batch.
 */
export type BulkOutcome = {
  done: string[];
  failed: { id: string; code: ErrorCode; message: string }[];
  /** One line about the batch as a whole, e.g. the days that kept an earlier decision. */
  note?: string;
};

/** "5 approved · 2 need review", for the toast after a bulk action. */
export function bulkSummary(outcome: BulkOutcome, verb: string): string {
  const parts: string[] = [];
  if (outcome.done.length > 0) parts.push(`${outcome.done.length} ${verb}`);
  if (outcome.failed.length > 0) {
    parts.push(`${outcome.failed.length} ${outcome.failed.length === 1 ? "needs" : "need"} review`);
  }
  return parts.join(" · ") || "Nothing changed";
}
