import { AppError } from "./app-error";
import { ERROR_MESSAGES, type ErrorCode, isErrorCode } from "./codes";

/**
 * The shape of `PostgrestError` (supabase-js) and of errors surfaced by RPC
 * calls. Structural on purpose: every Supabase client returns plain objects.
 */
export interface PostgresLikeError {
  code: string;
  message: string;
  details?: string | null;
  hint?: string | null;
}

export function isPostgresError(value: unknown): value is PostgresLikeError {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.code === "string" && typeof candidate.message === "string";
}

/** SQLSTATE and PostgREST codes → our codes. Anything unlisted is `INTERNAL`. */
const CODE_MAP: Readonly<Record<string, ErrorCode>> = {
  // PostgREST
  PGRST116: "NOT_FOUND", // `.single()` matched no rows (or more than one)
  PGRST301: "UNAUTHENTICATED", // JWT expired / invalid
  PGRST302: "UNAUTHENTICATED",
  PGRST303: "UNAUTHENTICATED",
  // Postgres SQLSTATE
  "42501": "FORBIDDEN", // insufficient_privilege (RLS or grant)
  "23505": "CONFLICT", // unique_violation
  "23503": "CONFLICT", // foreign_key_violation
  "40001": "CONFLICT", // serialization_failure
  "40P01": "CONFLICT", // deadlock_detected
  "23502": "VALIDATION", // not_null_violation
  "23514": "VALIDATION", // check_violation
  "22P02": "VALIDATION", // invalid_text_representation (e.g. bad uuid)
  "22001": "VALIDATION", // string_data_right_truncation
  "22003": "VALIDATION", // numeric_value_out_of_range
  "22007": "VALIDATION", // invalid_datetime_format
  "22008": "VALIDATION", // datetime_field_overflow
};

const CODE_MESSAGES: Readonly<Partial<Record<string, string>>> = {
  "23505": "This already exists.",
  "23503": "This is linked to another record, so the change isn't possible.",
  "22P02": "One of the values has the wrong format.",
};

/**
 * Maps a Postgres or PostgREST error to an `AppError`.
 *
 * `P0001` is what `app.fail(code, detail)` raises: the message IS the code and
 * the detail (written by us, in SQL) is the friendly text. A `P0001` whose
 * message isn't one of our codes is a bug, so it maps to `INTERNAL`.
 * Raw database text is never forwarded to the UI.
 */
export function mapPostgresError(error: PostgresLikeError): AppError {
  if (error.code === "P0001") {
    if (isErrorCode(error.message)) {
      const detail = error.details?.trim();
      return new AppError(error.message, detail ? detail : undefined, { cause: error });
    }
    return new AppError("INTERNAL", undefined, { cause: error });
  }

  const code = CODE_MAP[error.code] ?? "INTERNAL";
  return new AppError(code, CODE_MESSAGES[error.code] ?? ERROR_MESSAGES[code], { cause: error });
}
