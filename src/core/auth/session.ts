import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import type { Database } from "@/core/db";
import { publicSupabaseEnv, sessionCookieOptions } from "@/core/db";
import { applyResponseHeaders } from "@/core/http/response-headers";
import { isolateTick, serverTiming } from "@/core/observability/isolate";

import { HOME_HINT_COOKIE, rootRedirect } from "./home-hint";
import { LOGIN_PATH, isPublicPath, isSignedOutOnlyPath } from "./paths";
import { classifySessionError } from "./session-errors";
import { WARM_PATH, warmSessionVerification } from "./warm";

/**
 * What `src/proxy.ts` runs on every page request (ADR-0012):
 * 1. refreshes the Supabase session cookies, which Server Components can't write themselves;
 * 2. an optimistic redirect from the JWT alone: no session on a members-only path → `/login`
 *    with `next=`; a session on `/login` or `/forgot-password` → `/`; `/` itself (the installed
 *    app's `start_url`, `/?source=pwa`: the query is dropped) → `/login`, or the role's home
 *    when the home hint names it (2.7, `home-hint.ts`), else it renders and `src/app/page.tsx`
 *    reads the member;
 * 3. every redirect it answers carries the security headers itself (3c.1, ARCHITECTURE §18.3):
 *    on the Worker a proxy redirect never reaches `next.config.ts`'s `headers()` rule.
 * (3b.1 dropped the `x-maxoff-path` header the 2.2 day gate read: nothing reads it now.)
 * 4. every response it lets through or answers carries `Server-Timing` (unit P, 2026-10-15):
 *    `claims` (the verification above, in ms: 0 when the JWT was checked locally, a round trip
 *    to GoTrue otherwise) and the isolate's state (`core/observability/isolate`), so a probe can
 *    tell a cold start from a slow Worker. Numbers only, no data.
 * 5. the warm-up (`/api/warm`, P2) passes straight through: its token is verified without a
 *    refresh, so this bundle's JWKS is cached, and nothing is redirected or written (`warm.ts`).
 *
 * It reads no table on purpose (Next's own guidance for proxies). The decision that counts,
 * "is this an active member", is `requireMember()` in `server.ts`, run by the app layout.
 */
export async function updateSession(request: NextRequest): Promise<NextResponse> {
  if (request.nextUrl.pathname === WARM_PATH) return warmPassThrough(request);
  const forward = () => {
    // Rebuilt after every cookie refresh: `request.cookies.set` rewrites the Cookie header.
    return NextResponse.next({ request: { headers: new Headers(request.headers) } });
  };
  let response = forward();
  const env = publicSupabaseEnv();

  const supabase = createServerClient<Database>(env.url, env.publishableKey, {
    cookieOptions: sessionCookieOptions(),
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        response = forward();
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  // Verifies the JWT (and refreshes it through the cookie adapter when it is about to expire).
  // A transient failure (GoTrue unreachable, a 5xx, a timeout) is not "signed out": the
  // request passes through untouched and `requireMember()` in the layout shows a retryable
  // error instead of sending a signed-in person to /login (2.6, owner decision 2026-09-24).
  const started = performance.now();
  const timed = (res: NextResponse) => {
    res.headers.set(
      "Server-Timing",
      serverTiming({ claims: performance.now() - started }, isolateTick()),
    );
    return res;
  };
  let userId: string | null;
  try {
    const { data, error } = await supabase.auth.getClaims();
    if (error && classifySessionError(error) === "transient") return timed(response);
    userId = data?.claims.sub ?? null;
  } catch {
    return timed(response);
  }
  const signedIn = userId !== null;
  const { pathname, search } = request.nextUrl;

  if (pathname === "/") {
    const target = rootRedirect(userId, request.cookies.get(HOME_HINT_COOKIE)?.value);
    if (!target) return timed(response);
    const url = request.nextUrl.clone();
    url.pathname = target;
    url.search = "";
    return timed(withCookies(NextResponse.redirect(url), response));
  }

  if (!signedIn && !isPublicPath(pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = LOGIN_PATH;
    url.search = "";
    url.searchParams.set("next", `${pathname}${search}`);
    return timed(withCookies(NextResponse.redirect(url), response));
  }

  if (signedIn && isSignedOutOnlyPath(pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    url.search = "";
    return timed(withCookies(NextResponse.redirect(url), response));
  }

  return timed(response);
}

/**
 * The warm-up's way through (P2): the token checked once without a refresh (`warm.ts`), then on
 * to the route with the request untouched and no cookie set, timed like every other response.
 */
async function warmPassThrough(request: NextRequest): Promise<NextResponse> {
  const started = performance.now();
  await warmSessionVerification(request.cookies.getAll());
  const response = NextResponse.next();
  response.headers.set(
    "Server-Timing",
    serverTiming({ claims: performance.now() - started }, isolateTick()),
  );
  return response;
}

/**
 * A redirect must still carry the refreshed cookies, or the next request repeats the refresh,
 * and the security headers, which nothing else puts on a response the proxy answers itself.
 */
function withCookies(target: NextResponse, source: NextResponse): NextResponse {
  for (const cookie of source.cookies.getAll()) target.cookies.set(cookie);
  applyResponseHeaders(target.headers);
  return target;
}
