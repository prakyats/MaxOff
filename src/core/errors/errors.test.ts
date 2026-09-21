import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { action, toAppError } from "./action";
import { AppError } from "./app-error";
import { ERROR_MESSAGES, isErrorCode } from "./codes";
import { mapPostgresError } from "./postgres";
import { fail, ok } from "./result";

vi.mock("next/navigation", () => ({
  // Mirrors Next: rethrows only its own control-flow errors.
  unstable_rethrow: (error: unknown) => {
    if (error instanceof Error && error.message === "NEXT_REDIRECT") throw error;
  },
}));

afterEach(() => {
  vi.restoreAllMocks();
});

describe("codes", () => {
  it("recognises only the fixed codes", () => {
    expect(isErrorCode("INVALID_STATE")).toBe(true);
    expect(isErrorCode("invalid_state")).toBe(false);
    expect(isErrorCode(42)).toBe(false);
  });
});

describe("AppError", () => {
  it("defaults the message from the code", () => {
    const error = new AppError("FORBIDDEN");
    expect(error.message).toBe(ERROR_MESSAGES.FORBIDDEN);
    expect(error.name).toBe("AppError");
    expect(error.fieldErrors).toBeUndefined();
  });

  it("keeps a custom message, field errors and cause", () => {
    const cause = new Error("db down");
    const error = new AppError("VALIDATION", "Bad input", {
      fieldErrors: { name: ["Required"] },
      cause,
    });
    expect(error.message).toBe("Bad input");
    expect(error.fieldErrors).toEqual({ name: ["Required"] });
    expect(error.cause).toBe(cause);
  });
});

describe("Result", () => {
  it("builds ok and fail values", () => {
    expect(ok(1)).toEqual({ ok: true, data: 1 });
    expect(fail("NOT_FOUND")).toEqual({
      ok: false,
      error: { code: "NOT_FOUND", message: ERROR_MESSAGES.NOT_FOUND },
    });
    expect(fail("VALIDATION", "Nope", { a: ["x"] })).toEqual({
      ok: false,
      error: { code: "VALIDATION", message: "Nope", fieldErrors: { a: ["x"] } },
    });
  });
});

describe("mapPostgresError", () => {
  it("maps app.fail() output: message is the code, detail is the text", () => {
    const error = mapPostgresError({
      code: "P0001",
      message: "INVALID_STATE",
      details: "This task is already completed",
    });
    expect(error.code).toBe("INVALID_STATE");
    expect(error.message).toBe("This task is already completed");
  });

  it("falls back to the default message when app.fail() had no detail", () => {
    const error = mapPostgresError({ code: "P0001", message: "REASON_REQUIRED", details: null });
    expect(error.code).toBe("REASON_REQUIRED");
    expect(error.message).toBe(ERROR_MESSAGES.REASON_REQUIRED);
  });

  it("treats a P0001 with an unknown message as an internal bug", () => {
    const error = mapPostgresError({ code: "P0001", message: "something broke: secret table" });
    expect(error.code).toBe("INTERNAL");
    expect(error.message).toBe(ERROR_MESSAGES.INTERNAL);
  });

  it("maps SQLSTATE and PostgREST codes without leaking database text", () => {
    expect(mapPostgresError({ code: "42501", message: "permission denied for table x" }).code).toBe(
      "FORBIDDEN",
    );
    expect(mapPostgresError({ code: "PGRST116", message: "0 rows" }).code).toBe("NOT_FOUND");
    expect(mapPostgresError({ code: "PGRST301", message: "JWT expired" }).code).toBe(
      "UNAUTHENTICATED",
    );
    expect(mapPostgresError({ code: "23514", message: "violates check" }).code).toBe("VALIDATION");
    expect(mapPostgresError({ code: "40001", message: "could not serialize" }).code).toBe(
      "CONFLICT",
    );

    const unique = mapPostgresError({
      code: "23505",
      message: 'duplicate key "members_email_key"',
    });
    expect(unique.code).toBe("CONFLICT");
    expect(unique.message).not.toContain("members_email_key");
  });

  it("maps unknown codes to INTERNAL", () => {
    expect(mapPostgresError({ code: "XX000", message: "internal" }).code).toBe("INTERNAL");
  });
});

describe("toAppError", () => {
  it("passes AppError through", () => {
    const error = new AppError("CONFLICT");
    expect(toAppError(error)).toBe(error);
  });

  it("turns a ZodError into VALIDATION with field errors", () => {
    const schema = z.object({ name: z.string().min(1), age: z.number().int() });
    const parsed = schema.safeParse({ name: "", age: 1.5 });
    if (parsed.success) throw new Error("expected a failure");
    const error = toAppError(parsed.error);
    expect(error.code).toBe("VALIDATION");
    expect(Object.keys(error.fieldErrors ?? {}).sort()).toEqual(["age", "name"]);
  });

  it("wraps anything else as INTERNAL with the cause kept", () => {
    const cause = new TypeError("boom");
    const error = toAppError(cause);
    expect(error.code).toBe("INTERNAL");
    expect(error.cause).toBe(cause);
  });
});

describe("action", () => {
  it("returns the wrapped function's Result", async () => {
    const add = action(async (a: number, b: number) => ok(a + b));
    await expect(add(2, 3)).resolves.toEqual({ ok: true, data: 5 });
  });

  it("converts thrown AppError and Postgres errors into failures", async () => {
    const forbidden = action(async () => {
      throw new AppError("FORBIDDEN");
    });
    await expect(forbidden()).resolves.toEqual({
      ok: false,
      error: { code: "FORBIDDEN", message: ERROR_MESSAGES.FORBIDDEN },
    });

    const stale = action(async () => {
      throw { code: "P0001", message: "INVALID_STATE", details: "Already approved" };
    });
    await expect(stale()).resolves.toEqual({
      ok: false,
      error: { code: "INVALID_STATE", message: "Already approved" },
    });
  });

  it("logs unexpected errors and returns INTERNAL", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const broken = action(async () => {
      throw new Error("db exploded");
    });
    const result = await broken();
    expect(result).toEqual({
      ok: false,
      error: { code: "INTERNAL", message: ERROR_MESSAGES.INTERNAL },
    });
    expect(log).toHaveBeenCalledOnce();
  });

  it("re-throws Next.js control-flow errors", async () => {
    const redirecting = action(async () => {
      throw new Error("NEXT_REDIRECT");
    });
    await expect(redirecting()).rejects.toThrow("NEXT_REDIRECT");
  });
});
