import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import type { Database } from "@/core/db";
import { publicSupabaseEnv, sessionCookieOptions } from "@/core/db";

import { REQUEST_PATH_HEADER } from "./day-gate";
import { HOME_HINT_COOKIE, rootRedirect } from "./home-hint";
import { LOGIN_PATH, isPublicPath, isSignedOutOnlyPath } from "./paths";
import { classifySessionError } from "./session-errors";

/**
 * What `src/proxy.ts` runs on every page request (ADR-0012):
 * 1. refreshes the Supabase session cookies, which Server Components can't write themselves;
 * 2. an optimistic redirect from the JWT alone: no session on a members-only path → `/login`
 *    with `next=`; a session on `/login` or `/forgot-password` → `/`; `/` itself (the installed
 *    app's `start_url`) → `/login`, or the role's home when the home hint names it (2.7,
 *    `home-hint.ts`), else it renders and `src/app/page.tsx` reads the member;
 * 3. forwards the page's path + search as `x-maxoff-path` (overwriting anything the browser
 *    sent), so the day gate in the layout knows where to return to (task 2.2). It is only ever
 *    read through `safeNextPath()`.
 *
 * It reads no table on purpose (Next's own guidance for proxies). The decision that counts,
 * "is this an active member", is `requireMember()` in `server.ts`, run by the app layout.
 */
export async function updateSession(request: NextRequest): Promise<NextResponse> {
  const forward = () => {
    // Rebuilt after every cookie refresh: `request.cookies.set` rewrites the Cookie header.
    const headers = new Headers(request.headers);
    headers.set(REQUEST_PATH_HEADER, `${request.nextUrl.pathname}${request.nextUrl.search}`);
    return NextResponse.next({ request: { headers } });
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
  let userId: string | null;
  try {
    const { data, error } = await supabase.auth.getClaims();
    if (error && classifySessionError(error) === "transient") return response;
    userId = data?.claims.sub ?? null;
  } catch {
    return response;
  }
  const signedIn = userId !== null;
  const { pathname, search } = request.nextUrl;

  if (pathname === "/") {
    const target = rootRedirect(userId, request.cookies.get(HOME_HINT_COOKIE)?.value);
    if (!target) return response;
    const url = request.nextUrl.clone();
    url.pathname = target;
    url.search = "";
    return withCookies(NextResponse.redirect(url), response);
  }

  if (!signedIn && !isPublicPath(pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = LOGIN_PATH;
    url.search = "";
    url.searchParams.set("next", `${pathname}${search}`);
    return withCookies(NextResponse.redirect(url), response);
  }

  if (signedIn && isSignedOutOnlyPath(pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    url.search = "";
    return withCookies(NextResponse.redirect(url), response);
  }

  return response;
}

/** A redirect must still carry the refreshed cookies, or the next request repeats the refresh. */
function withCookies(target: NextResponse, source: NextResponse): NextResponse {
  for (const cookie of source.cookies.getAll()) target.cookies.set(cookie);
  return target;
}
