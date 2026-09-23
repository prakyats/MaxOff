import { describe, expect, it } from "vitest";

import { toAppError } from "./action";
import { isAuthError, mapAuthError } from "./auth";
import { ERROR_MESSAGES } from "./codes";

function authError(code: string | undefined, message = "GoTrue text that must not leak") {
  return { __isAuthError: true as const, code, message, status: 400, name: "AuthApiError" };
}

describe("isAuthError", () => {
  it("recognises the supabase-js marker only", () => {
    expect(isAuthError(authError("invalid_credentials"))).toBe(true);
    expect(isAuthError({ code: "42501", message: "postgres" })).toBe(false);
    expect(isAuthError(new Error("plain"))).toBe(false);
    expect(isAuthError(null)).toBe(false);
  });
});

describe("mapAuthError", () => {
  it("maps rate limits to RATE_LIMITED", () => {
    for (const code of ["over_request_rate_limit", "over_email_send_rate_limit"]) {
      const error = mapAuthError(authError(code));
      expect(error.code).toBe("RATE_LIMITED");
      expect(error.message).toBe(ERROR_MESSAGES.RATE_LIMITED);
    }
  });

  it("never says which half of the credentials was wrong", () => {
    for (const code of ["invalid_credentials", "user_not_found", "email_not_confirmed"]) {
      const error = mapAuthError(authError(code));
      expect(error.code).toBe("UNAUTHENTICATED");
      expect(error.message).toBe("Email or password is incorrect.");
    }
  });

  it("maps session problems to UNAUTHENTICATED with the default text", () => {
    for (const code of [
      "session_not_found",
      "refresh_token_not_found",
      "bad_jwt",
      "session_expired",
    ]) {
      const error = mapAuthError(authError(code));
      expect(error.code).toBe("UNAUTHENTICATED");
      expect(error.message).toBe(ERROR_MESSAGES.UNAUTHENTICATED);
    }
  });

  it("puts password problems on the password field", () => {
    const weak = mapAuthError(authError("weak_password"));
    expect(weak.code).toBe("VALIDATION");
    expect(weak.fieldErrors).toEqual({ password: [weak.message] });
    const same = mapAuthError(authError("same_password"));
    expect(same.fieldErrors?.password?.[0]).toMatch(/haven't used before/);
  });

  it("treats a used or expired link as a validation problem", () => {
    for (const code of ["otp_expired", "flow_state_expired", "bad_code_verifier"]) {
      const error = mapAuthError(authError(code));
      expect(error.code).toBe("VALIDATION");
      expect(error.message).toMatch(/expired or was already used/);
      expect(error.fieldErrors).toBeUndefined();
    }
  });

  it("maps sign-up and banned accounts to FORBIDDEN", () => {
    expect(mapAuthError(authError("signup_disabled")).code).toBe("FORBIDDEN");
    expect(mapAuthError(authError("user_banned")).code).toBe("FORBIDDEN");
  });

  it("falls back to INTERNAL for unknown or missing codes, keeping the cause", () => {
    const unknown = mapAuthError(authError("something_new"));
    expect(unknown.code).toBe("INTERNAL");
    expect(unknown.message).toBe(ERROR_MESSAGES.INTERNAL);
    expect(unknown.cause).toMatchObject({ code: "something_new" });
    expect(mapAuthError(authError(undefined)).code).toBe("INTERNAL");
  });

  it("never forwards GoTrue's own message", () => {
    for (const code of ["invalid_credentials", "weak_password", "something_new", undefined]) {
      expect(mapAuthError(authError(code)).message).not.toContain("GoTrue");
    }
  });
});

describe("toAppError with an AuthError", () => {
  it("takes the auth branch before the Postgres shape", () => {
    const error = toAppError(authError("invalid_credentials"));
    expect(error.code).toBe("UNAUTHENTICATED");
  });
});
