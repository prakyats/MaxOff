import { SESSION_UNAVAILABLE_DIGEST } from "@/core/errors/boundary";

/**
 * Why a session could not be read (2.6, owner decision 2026-09-24):
 * - `transient`: GoTrue could not be reached or did not answer properly (a network failure, a
 *   5xx, a timeout, a rate limit) — or something unknown went wrong. The cookies are untouched
 *   and the person is still signed in, so nothing may sign them out: the proxy passes the
 *   request through and the layout shows a retryable error screen instead.
 * - `invalid`: there is no session, or GoTrue looked at it and refused it (an expired token
 *   that could not be refreshed, a bad or revoked refresh token, an invalid JWT). That is
 *   "signed out" and goes to /login as before. An expired session is never a `transient`.
 */
export type SessionFailure = "transient" | "invalid";

/** The shape of `@supabase/auth-js` errors, read by name and status so no import is needed. */
interface AuthLikeError {
  name?: unknown;
  status?: unknown;
  code?: unknown;
}

/**
 * auth-js wraps every network failure, timeout and 5xx it meets (the JWKS fetch and the token
 * refresh included) in `AuthRetryableFetchError`; everything else it returns is GoTrue's verdict
 * on the session. Anything that is not an auth error at all is treated as transient: an
 * unexpected exception is no proof that the session is bad.
 */
export function classifySessionError(error: unknown): SessionFailure {
  if (typeof error !== "object" || error === null) return "invalid";
  const { name, status } = error as AuthLikeError;
  if (name === "AuthRetryableFetchError") return "transient";
  if (name === "AuthApiError" || name === "AuthUnknownError") {
    if (typeof status === "number" && (status >= 500 || status === 429)) return "transient";
    return "invalid";
  }
  if (
    name === "AuthSessionMissingError" ||
    name === "AuthInvalidJwtError" ||
    name === "AuthInvalidTokenResponseError" ||
    name === "AuthImplicitGrantRedirectError" ||
    name === "AuthPKCEGrantCodeExchangeError"
  ) {
    return "invalid";
  }
  if (typeof name === "string" && name.startsWith("Auth")) return "invalid";
  return "transient";
}

/**
 * Thrown by `getSessionState()` when the session could not be checked for a transient reason.
 * Its `digest` is what survives Next's production error scrubbing, so the error boundary can
 * show "still signed in, try again" (`describeBoundaryError`). Reported to Sentry by the
 * boundary like any other error.
 */
export class SessionUnavailableError extends Error {
  readonly digest = SESSION_UNAVAILABLE_DIGEST;

  constructor(cause: unknown) {
    super("The session could not be checked: the auth server did not answer", { cause });
    this.name = "SessionUnavailableError";
  }
}
