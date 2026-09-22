import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import type { Database } from "@/core/db";
import { publicSupabaseEnv } from "@/core/db";

import { LOGIN_PATH, isPublicPath, isSignedOutOnlyPath } from "./paths";

/**
 * What `src/proxy.ts` runs on every page request (ADR-0012):
 * 1. refreshes the Supabase session cookies, which Server Components can't write themselves;
 * 2. an optimistic redirect from the JWT alone: no session on a members-only path → `/login`
 *    with `next=`; a session on `/login` or `/forgot-password` → `/`.
 *
 * It reads no table on purpose (Next's own guidance for proxies). The decision that counts,
 * "is this an active member", is `requireMember()` in `server.ts`, run by the app layout.
 */
export async function updateSession(request: NextRequest): Promise<NextResponse> {
  let response = NextResponse.next({ request });
  const env = publicSupabaseEnv();

  const supabase = createServerClient<Database>(env.url, env.publishableKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  // Verifies the JWT (and refreshes it through the cookie adapter when it is about to expire).
  const { data } = await supabase.auth.getClaims();
  const signedIn = Boolean(data?.claims.sub);
  const { pathname, search } = request.nextUrl;

  if (!signedIn && pathname !== "/" && !isPublicPath(pathname)) {
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
