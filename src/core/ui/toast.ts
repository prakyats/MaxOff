import { toast } from "sonner";

import { ERROR_MESSAGES, type Result, type ResultError } from "@/core/errors";

/**
 * Turns an action's error into toast copy. Shows the raiser's own message when it has one
 * (transition functions send the human reason as the detail, ARCHITECTURE §4.3) and the
 * code's default otherwise. Field errors are for the form, not the toast, so they are
 * summarised only when there is no other message.
 */
export function describeError(error: ResultError): { title: string; description?: string } {
  const fallback = ERROR_MESSAGES[error.code];
  const message = error.message.trim();
  const fieldCount = Object.keys(error.fieldErrors ?? {}).length;

  if (message && message !== fallback) {
    return { title: fallback, description: message };
  }
  if (fieldCount > 0) {
    return {
      title: fallback,
      description:
        fieldCount === 1 ? "1 field needs attention." : `${fieldCount} fields need attention.`,
    };
  }
  return { title: fallback };
}

/**
 * Shows a toast for a server action's `Result` and returns `result.ok`, so a handler can
 * write `if (!toastResult(result)) return;`. `success` is the message for the happy path;
 * leave it out when the UI shows the outcome itself.
 */
export function toastResult<T>(result: Result<T>, options: { success?: string } = {}): boolean {
  if (result.ok) {
    if (options.success) toast.success(options.success);
    return true;
  }
  const { title, description } = describeError(result.error);
  toast.error(title, description ? { description } : undefined);
  return false;
}
