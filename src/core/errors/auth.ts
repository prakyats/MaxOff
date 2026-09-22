import { AppError } from "./app-error";
import { ERROR_MESSAGES, type ErrorCode } from "./codes";

/**
 * The shape of supabase-js's `AuthError` (`@supabase/auth-js`). Structural on purpose: this
 * area holds no database client (CLAUDE.md rule 3), and the SDK marks every instance with
 * `__isAuthError`, so no import is needed to recognise one. Note that an `AuthError` also has
 * `code` + `message`, so it would otherwise fall into the Postgres branch and map to INTERNAL.
 */
export interface AuthLikeError {
  __isAuthError: true;
  code?: string | undefined;
  message: string;
  status?: number | undefined;
}

export function isAuthError(value: unknown): value is AuthLikeError {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return candidate.__isAuthError === true && typeof candidate.message === "string";
}

/** GoTrue error codes → our codes. Anything unlisted is `INTERNAL`. */
const CODE_MAP: Readonly<Record<string, ErrorCode>> = {
  over_request_rate_limit: "RATE_LIMITED",
  over_email_send_rate_limit: "RATE_LIMITED",
  over_sms_send_rate_limit: "RATE_LIMITED",
  invalid_credentials: "UNAUTHENTICATED",
  user_not_found: "UNAUTHENTICATED",
  email_not_confirmed: "UNAUTHENTICATED",
  session_not_found: "UNAUTHENTICATED",
  session_expired: "UNAUTHENTICATED",
  refresh_token_not_found: "UNAUTHENTICATED",
  refresh_token_already_used: "UNAUTHENTICATED",
  bad_jwt: "UNAUTHENTICATED",
  no_authorization: "UNAUTHENTICATED",
  reauthentication_needed: "UNAUTHENTICATED",
  user_banned: "FORBIDDEN",
  signup_disabled: "FORBIDDEN",
  otp_expired: "VALIDATION",
  otp_disabled: "VALIDATION",
  flow_state_expired: "VALIDATION",
  flow_state_not_found: "VALIDATION",
  bad_code_verifier: "VALIDATION",
  weak_password: "VALIDATION",
  same_password: "VALIDATION",
  validation_failed: "VALIDATION",
  email_address_invalid: "VALIDATION",
};

const CODE_MESSAGES: Readonly<Partial<Record<string, string>>> = {
  invalid_credentials: "Email or password is incorrect.",
  user_not_found: "Email or password is incorrect.",
  email_not_confirmed: "Email or password is incorrect.",
  user_banned: "This account is not active. Ask the CEO.",
  signup_disabled: "MaxOff is invite-only.",
  otp_expired: "This link has expired or was already used. Ask for a new one.",
  otp_disabled: "This link has expired or was already used. Ask for a new one.",
  flow_state_expired: "This link has expired or was already used. Ask for a new one.",
  flow_state_not_found: "This link has expired or was already used. Ask for a new one.",
  bad_code_verifier: "This link has expired or was already used. Ask for a new one.",
  weak_password: "This password is too weak. Choose a longer or less common one.",
  same_password: "Choose a password you haven't used before.",
  email_address_invalid: "That doesn't look like an email address.",
};

/** Codes whose message belongs to the password field of a form. */
const PASSWORD_FIELD_CODES = new Set(["weak_password", "same_password"]);

/**
 * Maps a supabase-js `AuthError` to an `AppError`. Only our own text reaches the UI: GoTrue's
 * messages are never forwarded, and a credentials failure never says which half was wrong.
 */
export function mapAuthError(error: AuthLikeError): AppError {
  const gotrueCode = error.code ?? "";
  const code = CODE_MAP[gotrueCode] ?? "INTERNAL";
  const message = CODE_MESSAGES[gotrueCode] ?? ERROR_MESSAGES[code];
  const fieldErrors = PASSWORD_FIELD_CODES.has(gotrueCode) ? { password: [message] } : undefined;
  return new AppError(code, message, { cause: error, ...(fieldErrors ? { fieldErrors } : {}) });
}
