import { beforeEach, describe, expect, it, vi } from "vitest";

import type * as Ssr from "@supabase/ssr";

const getClaims = vi.fn();
const setAll = vi.fn();
let adapter: { setAll: (cookies: unknown[]) => void } | null = null;

vi.mock("@supabase/ssr", async (importOriginal) => {
  const real = await importOriginal<typeof Ssr>();
  return {
    ...real,
    createServerClient: (
      _url: string,
      _key: string,
      options: { cookies: { setAll: (cookies: unknown[]) => void } },
    ) => {
      adapter = options.cookies;
      return { auth: { getClaims } };
    },
  };
});
vi.mock("@/core/db", () => ({
  publicSupabaseEnv: () => ({ url: "http://127.0.0.1:54321", publishableKey: "pk" }),
  sessionCookieOptions: () => ({ httpOnly: true, sameSite: "lax", secure: false }),
}));

import { accessTokenFrom, isWarmableToken, warmSessionVerification } from "./warm";

const NOW = 1_800_000_000;
const b64 = (value: unknown) => Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
const jwt = (header: Record<string, unknown>, payload: Record<string, unknown>) =>
  `${b64(header)}.${b64(payload)}.signature`;
const ES256 = { alg: "ES256", kid: "key-1", typ: "JWT" };

/** The session cookie the way `@supabase/ssr` writes it: "base64-" + base64url(JSON), chunked. */
function sessionCookies(accessToken: string, chunkSize = 3180) {
  const value = `base64-${b64({ access_token: accessToken, refresh_token: "r" })}`;
  const name = "sb-127-auth-token";
  if (value.length <= chunkSize) return [{ name, value }];
  return Array.from({ length: Math.ceil(value.length / chunkSize) }, (_, index) => ({
    name: `${name}.${index}`,
    value: value.slice(index * chunkSize, (index + 1) * chunkSize),
  }));
}

describe("accessTokenFrom (P2 warm-up)", () => {
  it("reads the token from a whole cookie and from chunks", async () => {
    const token = jwt(ES256, { exp: NOW + 3600, sub: "x".repeat(4000) });
    expect(await accessTokenFrom(sessionCookies(token))).toBe(token);
    const chunks = sessionCookies(token, 1000);
    expect(chunks.length).toBeGreaterThan(1);
    expect(await accessTokenFrom([{ name: "other", value: "1" }, ...chunks])).toBe(token);
  });

  it("no session cookie, or a broken one, is no token", async () => {
    expect(await accessTokenFrom([{ name: "maxoff_home", value: "x" }])).toBeNull();
    expect(await accessTokenFrom([{ name: "sb-127-auth-token", value: "base64-%%%" }])).toBeNull();
  });
});

describe("isWarmableToken (P2 warm-up)", () => {
  it("an asymmetric token valid for over a minute: a JWKS fetch at most", () => {
    expect(isWarmableToken(jwt(ES256, { exp: NOW + 3600 }), NOW)).toBe(true);
    expect(isWarmableToken(jwt({ alg: "RS256", kid: "k" }, { exp: NOW + 120 }), NOW)).toBe(true);
  });

  it("never a shared-secret token or one without a key id: getClaims would ask GoTrue", () => {
    expect(isWarmableToken(jwt({ alg: "HS256", kid: "k" }, { exp: NOW + 3600 }), NOW)).toBe(false);
    expect(isWarmableToken(jwt({ alg: "ES256" }, { exp: NOW + 3600 }), NOW)).toBe(false);
  });

  it("never an expired or expiring token: the real request refreshes it, not the warm-up", () => {
    expect(isWarmableToken(jwt(ES256, { exp: NOW - 1 }), NOW)).toBe(false);
    expect(isWarmableToken(jwt(ES256, { exp: NOW + 60 }), NOW)).toBe(false);
    expect(isWarmableToken(jwt(ES256, {}), NOW)).toBe(false);
    expect(isWarmableToken("not-a-jwt", NOW)).toBe(false);
  });
});

describe("warmSessionVerification (P2 warm-up)", () => {
  beforeEach(() => {
    getClaims.mockReset();
    setAll.mockReset();
    adapter = null;
    vi.useFakeTimers();
    vi.setSystemTime(NOW * 1000);
  });

  it("verifies the token it was handed, explicitly, and writes no cookie", async () => {
    getClaims.mockResolvedValue({ data: { claims: {} }, error: null });
    const token = jwt(ES256, { exp: NOW + 3600 });
    expect(await warmSessionVerification(sessionCookies(token))).toBe(true);
    expect(getClaims).toHaveBeenCalledExactlyOnceWith(token);
    // The adapter's setAll is a no-op: a refresh could not reach the browser even if one ran.
    expect(() => adapter?.setAll([{ name: "sb", value: "v", options: {} }])).not.toThrow();
    vi.useRealTimers();
  });

  it("no session, a symmetric or an expiring token: nothing is asked at all", async () => {
    expect(await warmSessionVerification([])).toBe(false);
    expect(
      await warmSessionVerification(sessionCookies(jwt({ alg: "HS256" }, { exp: NOW + 3600 }))),
    ).toBe(false);
    expect(await warmSessionVerification(sessionCookies(jwt(ES256, { exp: NOW + 30 })))).toBe(
      false,
    );
    expect(getClaims).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("never throws: a failed verification is just not warm", async () => {
    getClaims.mockRejectedValue(new Error("network"));
    const token = jwt(ES256, { exp: NOW + 3600 });
    expect(await warmSessionVerification(sessionCookies(token))).toBe(false);
    vi.useRealTimers();
  });
});
