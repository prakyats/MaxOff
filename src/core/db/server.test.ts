import { getProperError } from "next/dist/lib/is-error";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { describeBoundaryError, SESSION_UNAVAILABLE_DIGEST } from "@/core/errors/boundary";
import { toAppError } from "@/core/errors";
import { systemClock } from "@/core/time";

vi.mock("server-only", () => ({}));
vi.mock("@/core/observability/capture", () => ({ captureException: () => "event-1" }));

/** The request's cookies, as a Server Component sees them: readable, not writable. */
const jar = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: async () => ({
    getAll: () => [...jar].map(([name, value]) => ({ name, value })),
    set: () => {
      throw new Error("Cookies can only be modified in a Server Action or Route Handler.");
    },
  }),
}));

const { createServerSupabase } = await import("./server");

const NOW = Math.floor(systemClock().getTime() / 1000);

function jwt(payload: Record<string, unknown>): string {
  const part = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${part({ alg: "ES256", kid: "test", typ: "JWT" })}.${part(payload)}.signature`;
}

/**
 * The session cookie as `@supabase/ssr` writes it, holding an access token that PostgREST has
 * already expired while the session's own `expires_at` still reads as valid to the server (the
 * case behind Sentry MAXOFF-3/-6: the read went out with the token and PostgREST said PGRST303).
 */
const EXPIRED_TOKEN = jwt({ sub: "member-1", session_id: "session-1", exp: NOW - 60 });
function signInWithExpiredToken(): void {
  const session = {
    access_token: EXPIRED_TOKEN,
    refresh_token: "refresh-1",
    token_type: "bearer",
    expires_in: 3600,
    expires_at: NOW + 3600,
    user: { id: "member-1" },
  };
  jar.set(
    "sb-127-auth-token",
    `base64-${Buffer.from(JSON.stringify(session)).toString("base64url")}`,
  );
}

/** PostgREST's own answer to an expired JWT. */
const JWT_EXPIRED_BODY = { code: "PGRST303", details: null, hint: null, message: "JWT expired" };
function jwtExpired(): Response {
  return new Response(JSON.stringify(JWT_EXPIRED_BODY), {
    status: 401,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "www-authenticate": 'Bearer error="invalid_token", error_description="JWT expired"',
    },
  });
}

type Seen = { url: string; authorization: string | null };
let seen: Seen[] = [];
let answer: (url: string) => Response = () => jwtExpired();

beforeEach(() => {
  jar.clear();
  seen = [];
  answer = () => jwtExpired();
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:54321");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test");
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    seen.push({ url, authorization: new Headers(init?.headers).get("authorization") });
    return answer(url);
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

/** A data layer's read: `if (error) throw error` (every `modules/*\/data` file does this). */
async function readMembersAsDataLayer(): Promise<unknown> {
  const supabase = await createServerSupabase();
  const { error } = await supabase.from("members").select("id").eq("id", "member-1").maybeSingle();
  return error;
}

describe("a server read that PostgREST refuses as JWT expired (PGRST303, Sentry MAXOFF-3/-6)", () => {
  it("reaches PostgREST with the expired token (the reproduction)", async () => {
    signInWithExpiredToken();
    const thrown = await readMembersAsDataLayer();
    const rest = seen.filter((request) => request.url.includes("/rest/v1/"));
    expect(rest).toHaveLength(1);
    expect(rest[0]?.authorization).toBe(`Bearer ${EXPIRED_TOKEN}`);
    expect(thrown).toMatchObject({ code: "PGRST303", message: "JWT expired" });
  });

  it("ends on the retryable 'still signed in' screen, never the generic error", async () => {
    signInWithExpiredToken();
    const thrown = await readMembersAsDataLayer();
    // What Next does with a thrown value in a Server Component: its digest is all that reaches
    // the client's error boundary in production.
    const asNextSeesIt = getProperError(thrown) as Error & { digest?: string };
    expect(asNextSeesIt.digest).toBe(SESSION_UNAVAILABLE_DIGEST);
    expect(describeBoundaryError(asNextSeesIt)).toMatchObject({
      kind: "session-unavailable",
      title: "Can't reach the server.",
    });
  });

  it("is the same 'still signed in, try again' words when a server action meets it", async () => {
    signInWithExpiredToken();
    const thrown = await readMembersAsDataLayer();
    const appError = toAppError(thrown);
    expect(appError.code).toBe("UNAUTHENTICATED");
    expect(appError.message).toBe(
      "Can't reach the server. You're still signed in. Try again in a moment.",
    );
  });

  it("adds no refresh-and-retry of its own: the proxy is the one place meant to renew a session", async () => {
    signInWithExpiredToken();
    await readMembersAsDataLayer();
    expect(seen.filter((request) => request.url.includes("/auth/v1/token"))).toHaveLength(0);
  });

  it("does the same for an RPC (a POST)", async () => {
    signInWithExpiredToken();
    const supabase = await createServerSupabase();
    const { error } = await supabase.rpc("attendance_own_today");
    expect((getProperError(error) as Error & { digest?: string }).digest).toBe(
      SESSION_UNAVAILABLE_DIGEST,
    );
  });

  it("leaves every other answer exactly as PostgREST sent it", async () => {
    signInWithExpiredToken();
    answer = () =>
      new Response(JSON.stringify({ code: "PGRST301", details: null, hint: null, message: "x" }), {
        status: 401,
        headers: { "content-type": "application/json" },
      });
    expect(await readMembersAsDataLayer()).toEqual({
      code: "PGRST301",
      details: null,
      hint: null,
      message: "x",
    });

    // PGRST303 is any refused claim; only "expired" is the retryable screen.
    const notInAudience = {
      code: "PGRST303",
      details: null,
      hint: null,
      message: "JWT not in audience",
    };
    answer = () =>
      new Response(JSON.stringify(notInAudience), {
        status: 401,
        headers: { "content-type": "application/json" },
      });
    const refused = await readMembersAsDataLayer();
    expect(refused).toEqual(notInAudience);
    expect((getProperError(refused) as Error & { digest?: string }).digest).not.toBe(
      SESSION_UNAVAILABLE_DIGEST,
    );

    answer = () =>
      new Response(JSON.stringify({ id: "member-1" }), {
        status: 200,
        headers: { "content-type": "application/vnd.pgrst.object+json" },
      });
    const supabase = await createServerSupabase();
    const { data, error } = await supabase.from("members").select("id").maybeSingle();
    expect(error).toBeNull();
    expect(data).toEqual({ id: "member-1" });
  });
});
