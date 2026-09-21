import "server-only";

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

import type { Database } from "./database.types";
import { publicSupabaseEnv } from "./env";

/**
 * The Supabase client for Server Components, server actions and route handlers.
 * It carries the caller's session from cookies, so RLS applies to every query.
 * Create one per request; never cache it across requests.
 */
export async function createServerSupabase() {
  const cookieStore = await cookies();
  const env = publicSupabaseEnv();

  return createServerClient<Database>(env.url, env.publishableKey, {
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
