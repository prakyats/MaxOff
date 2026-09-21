import { unstable_rethrow } from "next/navigation";
import { ZodError } from "zod";

import { AppError, type FieldErrors } from "./app-error";
import { isPostgresError, mapPostgresError } from "./postgres";
import { type Result, failFrom } from "./result";

function zodFieldErrors(error: ZodError): FieldErrors {
  const fieldErrors: FieldErrors = {};
  for (const issue of error.issues) {
    // Root-level issues (e.g. a refine on the whole object) go under `_form`.
    const field = issue.path.length > 0 ? issue.path.map(String).join(".") : "_form";
    (fieldErrors[field] ??= []).push(issue.message);
  }
  return fieldErrors;
}

/**
 * Turns anything thrown into an `AppError`.
 * - `AppError` passes through.
 * - `ZodError` → `VALIDATION` with per-field messages.
 * - Postgres / PostgREST errors → mapped codes (see `postgres.ts`).
 * - Everything else → `INTERNAL`, keeping the original as `cause` for logs.
 */
export function toAppError(error: unknown): AppError {
  if (AppError.is(error)) return error;
  if (error instanceof ZodError) {
    return new AppError("VALIDATION", undefined, {
      fieldErrors: zodFieldErrors(error),
      cause: error,
    });
  }
  if (isPostgresError(error)) return mapPostgresError(error);
  return new AppError("INTERNAL", undefined, { cause: error });
}

export type ActionFn<Args extends unknown[], T> = (...args: Args) => Promise<Result<T>>;

/**
 * Wraps a server action (ARCHITECTURE §4.2) so it always resolves to a
 * `Result` and never throws a raw error to the UI. Next.js's own control-flow
 * throws (`redirect()`, `notFound()`) are re-thrown untouched.
 * Unexpected errors are logged server-side with their cause.
 */
export function action<Args extends unknown[], T>(fn: ActionFn<Args, T>): ActionFn<Args, T> {
  return async (...args: Args): Promise<Result<T>> => {
    try {
      return await fn(...args);
    } catch (error) {
      unstable_rethrow(error);
      const appError = toAppError(error);
      if (appError.code === "INTERNAL") {
        console.error("[action] unexpected error", appError.cause ?? appError);
      }
      return failFrom(appError);
    }
  };
}
