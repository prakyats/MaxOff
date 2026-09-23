import { createBrowserClient } from "@supabase/ssr";

import type { Database } from "./database.types";
import { publicSupabaseEnv } from "./env";

/**
 * The Supabase client for Client Components (Realtime subscriptions, TanStack
 * Query fetches). `createBrowserClient` keeps one instance per page, so calling
 * this repeatedly is cheap. RLS applies to every query.
 *
 * Unused so far, and it carries **no session on its own**: the `sb-*` cookies are
 * `httpOnly` (`cookies.ts`), so it cannot read them. When 5.1 needs Realtime, pass
 * the access token from a server prop into `realtime.setAuth()` here rather than
 * loosening the cookies.
 */
export function createBrowserSupabase() {
  const env = publicSupabaseEnv();
  return createBrowserClient<Database>(env.url, env.publishableKey);
}

export type BrowserSupabase = ReturnType<typeof createBrowserSupabase>;
