import { describe, expect, it } from "vitest";

import { SESSION_UNAVAILABLE_DIGEST } from "@/core/errors/boundary";

import { classifySessionError, SessionUnavailableError } from "./session-errors";

/** Errors shaped like `@supabase/auth-js` builds them (name + status), no import needed. */
const authError = (name: string, status?: number, code?: string) =>
  Object.assign(new Error(name), { name, status, code });

describe("classifySessionError", () => {
  it("calls a network failure, timeout, 5xx or rate limit at GoTrue transient", () => {
    // auth-js wraps every fetch failure and 5xx it meets in AuthRetryableFetchError.
    expect(classifySessionError(authError("AuthRetryableFetchError", 0))).toBe("transient");
    expect(classifySessionError(authError("AuthRetryableFetchError", 503))).toBe("transient");
    expect(classifySessionError(authError("AuthApiError", 502))).toBe("transient");
    expect(classifySessionError(authError("AuthApiError", 429, "over_request_rate_limit"))).toBe(
      "transient",
    );
    expect(classifySessionError(authError("AuthUnknownError", 500))).toBe("transient");
  });

  it("calls an unexpected exception transient too: it proves nothing about the session", () => {
    expect(classifySessionError(new TypeError("fetch failed"))).toBe("transient");
    expect(classifySessionError(new Error("crypto.subtle is unavailable"))).toBe("transient");
  });

  it("calls a missing, expired or refused session invalid, so it goes to /login", () => {
    expect(classifySessionError(null)).toBe("invalid");
    expect(classifySessionError(undefined)).toBe("invalid");
    expect(classifySessionError(authError("AuthSessionMissingError", 400))).toBe("invalid");
    // An expired access token whose refresh GoTrue refused: the classic "expired session".
    expect(classifySessionError(authError("AuthApiError", 400, "refresh_token_not_found"))).toBe(
      "invalid",
    );
    expect(classifySessionError(authError("AuthApiError", 400, "invalid_grant"))).toBe("invalid");
    expect(classifySessionError(authError("AuthApiError", 401, "bad_jwt"))).toBe("invalid");
    expect(classifySessionError(authError("AuthApiError", 403, "session_not_found"))).toBe(
      "invalid",
    );
    // An expired JWT passed to getClaims, or a bad signature.
    expect(classifySessionError(authError("AuthInvalidJwtError"))).toBe("invalid");
    expect(classifySessionError(authError("AuthInvalidTokenResponseError"))).toBe("invalid");
    // Any other auth-js verdict is a verdict, not an outage.
    expect(classifySessionError(authError("AuthWeakPasswordError", 422))).toBe("invalid");
  });

  it("never lets an expired session reach the error page", () => {
    for (const status of [400, 401, 403, 404, 422]) {
      expect(classifySessionError(authError("AuthApiError", status))).toBe("invalid");
    }
  });
});

describe("SessionUnavailableError", () => {
  it("carries the digest the boundary reads, and the cause", () => {
    const cause = authError("AuthRetryableFetchError", 0);
    const error = new SessionUnavailableError(cause);
    expect(error.digest).toBe(SESSION_UNAVAILABLE_DIGEST);
    expect(error.cause).toBe(cause);
    expect(error.name).toBe("SessionUnavailableError");
  });
});
