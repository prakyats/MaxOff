/**
 * The fixed set of error codes an action can return (ARCHITECTURE §4.3).
 * Transition functions raise the same codes through `app.fail(code, detail)`.
 * Add a code here, in the SQL comment on `app.fail` and in DATA-MODEL §0a together.
 */
export const ERROR_CODES = [
  "UNAUTHENTICATED",
  "FORBIDDEN",
  "NOT_FOUND",
  "VALIDATION",
  "CONFLICT",
  "INVALID_STATE",
  "REASON_REQUIRED",
  "RATE_LIMITED",
  "INTERNAL",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

/** Friendly defaults, shown when the raiser gave no detail of its own. */
export const ERROR_MESSAGES: Record<ErrorCode, string> = {
  UNAUTHENTICATED: "Please sign in to continue.",
  FORBIDDEN: "You don't have permission to do this.",
  NOT_FOUND: "That record doesn't exist or you can't see it.",
  VALIDATION: "Please check the highlighted fields.",
  CONFLICT: "Someone else changed this just now. Refresh and try again.",
  INVALID_STATE: "This action isn't possible in the current state.",
  REASON_REQUIRED: "A reason is required for this action.",
  RATE_LIMITED: "Too many attempts. Please wait a moment and try again.",
  INTERNAL: "Something went wrong on our side. Please try again.",
};

export function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === "string" && (ERROR_CODES as readonly string[]).includes(value);
}
