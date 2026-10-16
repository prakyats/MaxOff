import "server-only";

import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

import { sessionCookieOptions } from "./cookies";
import type { Database } from "./database.types";
import { publicSupabaseEnv } from "./env";
import { withExpiredJwtAsSessionUnavailable } from "./expired-jwt";

/**
 * The Supabase client for Server Components, server actions and route handlers.
 * It carries the caller's session from cookies, so RLS applies to every query.
 * Create one per request; never cache it across requests.
 *
 * A read whose access token PostgREST refuses as expired (PGRST303) ends on the retryable
 * "still signed in" screen, not an unhandled error (`expired-jwt.ts`, 6.6).
 */
export async function createServerSupabase() {
  const cookieStore = await cookies();
  const env = publicSupabaseEnv();

  return createServerClient<Database>(env.url, env.publishableKey, {
    global: { fetch: withExpiredJwtAsSessionUnavailable() },
    cookieOptions: sessionCookieOptions(),
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Server Components can't write cookies. That's fine: the request
          // proxy (task 1.2) refreshes the session and writes them instead.
        }
      },
    },
  });
}

export type ServerSupabase = Awaited<ReturnType<typeof createServerSupabase>>;

/**
 * A server client for one read that must leave **first** (6b.19, ARCHITECTURE §19 "Six
 * connections"): it carries the caller's access token as given (`accessToken`), so a query goes
 * out without the auth client's session load from the cookies, which is what every other
 * client's first query waits for. RLS applies exactly as for `createServerSupabase` (the same
 * token reaches PostgREST, which verifies it). It has no session of its own: no refresh, no
 * cookie written, `auth.*` unavailable. `getSessionState` uses it for the member row only, and
 * keeps the answer only once the session has verified.
 */
export function createTokenSupabase(accessToken: string) {
  const env = publicSupabaseEnv();
  return createClient<Database>(env.url, env.publishableKey, {
    accessToken: async () => accessToken,
    global: { fetch: withExpiredJwtAsSessionUnavailable() },
  });
}
