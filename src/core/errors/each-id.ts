import { toAppError } from "./action";
import type { BulkOutcome } from "./bulk";

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
