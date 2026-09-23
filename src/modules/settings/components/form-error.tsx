import type { ResultError } from "@/core/errors";

/**
 * The message above a settings form when the failure belongs to no single field (a refusal by
 * RLS, a conflict). Field messages are rendered by `FormField` next to their control.
 */
export function FormError({ error }: { error: ResultError | null }) {
  if (!error || error.fieldErrors) return null;
  return (
    <p role="alert" data-slot="form-alert" className="text-destructive text-sm">
      {error.message}
    </p>
  );
}
