import { ERROR_MESSAGES, type ErrorCode } from "./codes";

/** Field name → messages, in the shape react-hook-form and zod both understand. */
export type FieldErrors = Record<string, string[]>;

export interface AppErrorOptions {
  fieldErrors?: FieldErrors;
  cause?: unknown;
}

/**
 * The one error type business code throws. `action()` turns it into a
 * `Result` failure; anything else that escapes becomes `INTERNAL`.
 */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly fieldErrors: FieldErrors | undefined;

  constructor(code: ErrorCode, message?: string, options: AppErrorOptions = {}) {
    super(
      message ?? ERROR_MESSAGES[code],
      options.cause === undefined ? {} : { cause: options.cause },
    );
    this.name = "AppError";
    this.code = code;
    this.fieldErrors = options.fieldErrors;
  }

  static is(value: unknown): value is AppError {
    return value instanceof AppError;
  }
}
