import type { ErrorCode } from "./codes";
import { toAppError } from "./action";

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

/**
 * Runs `run` for each id **one after another** (each is its own transaction and its own audit
 * entry; running them in parallel would only make them queue on the same person's lock), and
 * turns every throw into that row's error. Never throws.
 */
export async function eachId(
  ids: readonly string[],
  run: (id: string) => Promise<unknown>,
): Promise<BulkOutcome> {
  const outcome: BulkOutcome = { done: [], failed: [] };
  for (const id of ids) {
    try {
      await run(id);
      outcome.done.push(id);
    } catch (error) {
      const appError = toAppError(error);
      outcome.failed.push({ id, code: appError.code, message: appError.message });
    }
  }
  return outcome;
}

/** "5 approved · 2 need review", for the toast after a bulk action. */
export function bulkSummary(outcome: BulkOutcome, verb: string): string {
  const parts: string[] = [];
  if (outcome.done.length > 0) parts.push(`${outcome.done.length} ${verb}`);
  if (outcome.failed.length > 0) {
    parts.push(`${outcome.failed.length} ${outcome.failed.length === 1 ? "needs" : "need"} review`);
  }
  return parts.join(" · ") || "Nothing changed";
}
