import { describe, expect, it } from "vitest";

import { isPublicPath, isSignedOutOnlyPath, safeNextPath } from "./paths";
import { clientIpFrom, hashIp, sessionMetaFrom } from "./request-meta";
import {
  loginSchema,
  PASSWORD_MIN_LENGTH,
  passwordResetSchema,
  setPasswordSchema,
} from "./schemas";

describe("isPublicPath", () => {
  it("lets a signed-out visitor open the sign-in pages, the offline page and the auth handlers", () => {
    for (const path of [
      "/login",
      "/forgot-password",
      "/offline",
      "/robots.txt",
      "/auth/confirm",
      "/auth/signout",
      "/diagnostics/sentry",
      "/api/cron/anything",
    ]) {
      expect(isPublicPath(path), path).toBe(true);
    }
  });

  it("keeps every shell route, the set-password page and unknown paths behind a session", () => {
    for (const path of ["/today", "/my-day", "/settings", "/me", "/set-password", "/nope"]) {
      expect(isPublicPath(path), path).toBe(false);
    }
  });

  it("names the pages a signed-in member is sent home from", () => {
    expect(isSignedOutOnlyPath("/login")).toBe(true);
    expect(isSignedOutOnlyPath("/forgot-password")).toBe(true);
    expect(isSignedOutOnlyPath("/set-password")).toBe(false);
    expect(isSignedOutOnlyPath("/today")).toBe(false);
  });
});

describe("safeNextPath", () => {
  it("accepts a same-origin path with its query", () => {
    expect(safeNextPath("/tasks/42?tab=files")).toBe("/tasks/42?tab=files");
    expect(safeNextPath("/")).toBe("/");
    // A percent-encoded tab stays a path segment; it is the raw tab the browser strips.
    expect(safeNextPath("/%09//x")).toBe("/%09//x");
  });

  it("rejects anything that could leave the origin", () => {
    for (const value of [
      "//evil.example",
      "https://evil.example/x",
      "/\\evil.example",
      "javascript:alert(1)",
      "/x\r\nSet-Cookie: a=b",
      "/\t//evil.example",
      "/\t/\t/evil.example",
      "/ //evil.example",
      "today",
      "",
      null,
      undefined,
    ]) {
      expect(safeNextPath(value), String(value)).toBeNull();
    }
  });

  it("never loops back into the sign-in pages", () => {
    expect(safeNextPath("/login")).toBeNull();
    expect(safeNextPath("/login?next=/today")).toBeNull();
    expect(safeNextPath("/forgot-password")).toBeNull();
    expect(safeNextPath("/auth/confirm?token_hash=x")).toBeNull();
  });
});

describe("schemas", () => {
  it("normalises the email and requires a password on login", () => {
    const parsed = loginSchema.parse({ email: "  CEO@Example.com ", password: "whatever-it-is" });
    expect(parsed.email).toBe("ceo@example.com");
    expect(loginSchema.safeParse({ email: "not-an-email", password: "x" }).success).toBe(false);
    expect(loginSchema.safeParse({ email: "a@b.co", password: "" }).success).toBe(false);
  });

  it(`requires ${PASSWORD_MIN_LENGTH} characters and a matching confirmation for a new password`, () => {
    const short = setPasswordSchema.safeParse({ password: "short-one", confirm: "short-one" });
    expect(short.success).toBe(false);
    const mismatch = setPasswordSchema.safeParse({
      password: "long-enough-password",
      confirm: "long-enough-passwor",
    });
    expect(mismatch.success).toBe(false);
    if (!mismatch.success) expect(mismatch.error.issues[0]?.path).toEqual(["confirm"]);
    expect(
      setPasswordSchema.safeParse({
        password: "long-enough-password",
        confirm: "long-enough-password",
      }).success,
    ).toBe(true);
  });

  it("validates the reset email the same way", () => {
    expect(passwordResetSchema.parse({ email: " X@Y.io " }).email).toBe("x@y.io");
  });
});

describe("request meta", () => {
  it("prefers Cloudflare's connecting IP, then the first forwarded hop", () => {
    expect(
      clientIpFrom(
        new Headers({ "cf-connecting-ip": "203.0.113.9", "x-forwarded-for": "10.0.0.1" }),
      ),
    ).toBe("203.0.113.9");
    expect(clientIpFrom(new Headers({ "x-forwarded-for": "198.51.100.7, 10.0.0.1" }))).toBe(
      "198.51.100.7",
    );
    expect(clientIpFrom(new Headers({ "x-real-ip": "192.0.2.4" }))).toBe("192.0.2.4");
    expect(clientIpFrom(new Headers())).toBeNull();
  });

  it("hashes the IP with the salt, and stores nothing without one", async () => {
    const hash = await hashIp("203.0.113.9", "pepper");
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(await hashIp("203.0.113.9", "pepper")).toBe(hash);
    expect(await hashIp("203.0.113.9", "other")).not.toBe(hash);
    expect(await hashIp("203.0.113.9", undefined)).toBeNull();
    expect(await hashIp(null, "pepper")).toBeNull();
    // The IP never appears in what is stored.
    expect(hash).not.toContain("203");
  });

  it("caps the user agent at what the function keeps", async () => {
    const meta = await sessionMetaFrom(
      new Headers({ "user-agent": "x".repeat(600), "cf-connecting-ip": "203.0.113.9" }),
      "pepper",
    );
    expect(meta.userAgent).toHaveLength(512);
    expect(meta.ipHash).toMatch(/^[0-9a-f]{64}$/);
    const empty = await sessionMetaFrom(new Headers(), undefined);
    expect(empty).toEqual({ userAgent: null, ipHash: null });
  });
});
