import { unstable_rethrow } from "next/navigation";
import { ZodError } from "zod";

import { captureException } from "@/core/observability/capture";

import { AppError, type FieldErrors } from "./app-error";
import { isAuthError, mapAuthError } from "./auth";
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
 * - Supabase Auth errors → mapped codes (see `auth.ts`), checked before the Postgres shape
 *   because an `AuthError` also carries `code` + `message`.
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
  if (isAuthError(error)) return mapAuthError(error);
  if (isPostgresError(error)) return mapPostgresError(error);
  return new AppError("INTERNAL", undefined, { cause: error });
}

export type ActionFn<Args extends unknown[], T> = (...args: Args) => Promise<Result<T>>;

/**
 * Wraps a server action (ARCHITECTURE §4.2) so it always resolves to a
 * `Result` and never throws a raw error to the UI. Next.js's own control-flow
 * throws (`redirect()`, `notFound()`) are re-thrown untouched.
 *
 * An unexpected error (INTERNAL) is reported to Sentry through the scrubber and the log line
 * carries only the code and the Sentry event id. The raw cause never reaches Workers Logs:
 * a PostgREST error can quote the failing row (ARCHITECTURE §18.2). In `next dev`, where the
 * SDK is off and the console is the developer's own terminal, the cause is printed as well.
 */
export function action<Args extends unknown[], T>(fn: ActionFn<Args, T>): ActionFn<Args, T> {
  return async (...args: Args): Promise<Result<T>> => {
    try {
      return await fn(...args);
    } catch (error) {
      unstable_rethrow(error);
      const appError = toAppError(error);
      if (appError.code === "INTERNAL") {
        const eventId = captureException(appError.cause ?? appError);
        console.error(`[action] INTERNAL (sentry event ${eventId})`);
        if (process.env.NODE_ENV === "development") console.error(appError.cause ?? appError);
      }
      return failFrom(appError);
    }
  };
}
