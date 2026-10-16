import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SECURITY_HEADERS } from "@/core/http/response-headers";

const claims = vi.fn();

vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({ auth: { getClaims: claims } }),
}));
vi.mock("@/core/db", () => ({
  publicSupabaseEnv: () => ({ url: "http://127.0.0.1:54321", publishableKey: "pk" }),
  sessionCookieOptions: () => ({ httpOnly: true, sameSite: "lax", secure: false }),
}));

import { updateSession } from "./session";

const MEMBER = "10000000-0000-4000-8000-000000000003";

function request(path: string, cookie?: string): NextRequest {
  return new NextRequest(`https://app.example${path}`, cookie ? { headers: { cookie } } : {});
}

function expectSecurityHeaders(response: Response, label: string) {
  for (const { key, value } of SECURITY_HEADERS) {
    expect(response.headers.get(key), `${label} ${key}`).toBe(value);
  }
}

describe("updateSession's redirects carry the security headers (3c.1)", () => {
  beforeEach(() => {
    claims.mockReset();
  });

  it("no session on a members-only path → /login?next=, with the headers", async () => {
    claims.mockResolvedValue({ data: null, error: null });
    const response = await updateSession(request("/today?tab=people"));
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://app.example/login?next=%2Ftoday%3Ftab%3Dpeople",
    );
    expectSecurityHeaders(response, "/today");
  });

  it("no session on / → /login, with the headers", async () => {
    claims.mockResolvedValue({ data: null, error: null });
    const response = await updateSession(request("/"));
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://app.example/login");
    expectSecurityHeaders(response, "/");
  });

  it("a session on /login → /, and / with a home hint → the role's home, with the headers", async () => {
    claims.mockResolvedValue({ data: { claims: { sub: MEMBER } }, error: null });
    const login = await updateSession(request("/login"));
    expect(login.status).toBe(307);
    expect(login.headers.get("location")).toBe("https://app.example/");
    expectSecurityHeaders(login, "/login");

    const home = await updateSession(request("/", `maxoff_home=${MEMBER}%7C%2Fmy-day`));
    expect(home.status).toBe(307);
    expect(home.headers.get("location")).toBe("https://app.example/my-day");
    expectSecurityHeaders(home, "/ with a hint");
  });

  it("a request that passes through is left to Next (its headers() rule applies there)", async () => {
    claims.mockResolvedValue({ data: null, error: null });
    const response = await updateSession(request("/api/health"));
    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
  });
});

describe("the warm-up passes straight through (P2)", () => {
  beforeEach(() => {
    claims.mockReset();
  });

  it("/api/warm: never refreshed or redirected, no cookie set, timed", async () => {
    // A session cookie whose token is symmetric (the local stack's): nothing is verified.
    const session = `base64-${Buffer.from(JSON.stringify({ access_token: "a.b.c" })).toString("base64url")}`;
    const response = await updateSession(request("/api/warm", `sb-127-auth-token=${session}`));
    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(response.headers.get("server-timing")).toMatch(/^claims;dur=\d+, isolate;desc="n=\d+/);
    // The session-refreshing `getClaims()` (no token argument) never ran.
    expect(claims).not.toHaveBeenCalled();
  });
});
