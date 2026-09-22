import { createBrowserClient } from "@supabase/ssr";

import type { Database } from "./database.types";
import { publicSupabaseEnv } from "./env";

/**
 * The Supabase client for Client Components (Realtime subscriptions, TanStack
 * Query fetches). `createBrowserClient` keeps one instance per page, so calling
 * this repeatedly is cheap. RLS applies to every query.
 */
export function createBrowserSupabase() {
  const env = publicSupabaseEnv();
  return createBrowserClient<Database>(env.url, env.publishableKey);
}

export type BrowserSupabase = ReturnType<typeof createBrowserSupabase>;
