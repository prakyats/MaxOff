import type { AppError, FieldErrors } from "./app-error";
import { ERROR_MESSAGES, type ErrorCode } from "./codes";

export interface ResultError {
  code: ErrorCode;
  message: string;
  fieldErrors?: FieldErrors;
}

/**
 * What every server action returns (ARCHITECTURE §4.2). Serializable, so it
 * crosses the server/client boundary untouched and the UI never sees a throw.
 */
export type Result<T> = { ok: true; data: T } | { ok: false; error: ResultError };

export function ok<T>(data: T): Result<T> {
  return { ok: true, data };
}

export function fail(code: ErrorCode, message?: string, fieldErrors?: FieldErrors): Result<never> {
  const error: ResultError = { code, message: message ?? ERROR_MESSAGES[code] };
  if (fieldErrors) error.fieldErrors = fieldErrors;
  return { ok: false, error };
}

export function failFrom(error: AppError): Result<never> {
  return fail(error.code, error.message, error.fieldErrors);
}
