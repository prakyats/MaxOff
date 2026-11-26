/**
 * A FORBIDDEN answered to a signed-in member is counted (v7.5 Q6, owner 2026-11-26: a daily Owner
 * note when one account is refused more than 20 times in a day). `action()` calls `noteRefusal()`
 * when an action ends FORBIDDEN (its own check, or a transition function's refusal); the server's
 * recorder (`core/activity/refusals.ts`, which counts it in the database) registers itself here.
 * A hook rather than an import because this folder also reaches the browser (its types and
 * `Result` helpers), and the recorder is server-only. With no recorder registered (a unit test, the
 * browser) nothing happens.
 */
type RefusalRecorder = () => Promise<void>;

let recorder: RefusalRecorder | null = null;

/** The server's recorder (`core/activity/refusals.ts`). The last one registered wins. */
export function onRefusal(record: RefusalRecorder): void {
  recorder = record;
}

/** Counts one refusal for the signed-in member. Never throws: a count is not worth a failed answer. */
export async function noteRefusal(): Promise<void> {
  try {
    await recorder?.();
  } catch {
    // The count is best effort; the refusal itself has already been decided.
  }
}
