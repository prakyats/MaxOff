import { createClient } from "@supabase/supabase-js";

import type { Database } from "./database.types";
import { publicSupabaseEnv } from "./env";

/**
 * The Supabase client for the browser: Realtime only (task 5.1, ARCHITECTURE §10). RLS applies
 * to everything it receives.
 *
 * It carries **no session of its own**: the `sb-*` cookies are `httpOnly` (`cookies.ts`), and
 * they stay that way. The server hands the member's access token to the page (a prop, read from
 * the session by `getRealtimeAuth()`), and this client reads it through `accessToken` each time
 * Realtime connects or `realtime.setAuth()` is called; supabase-js then runs no auth of its own
 * (no storage, no refresh timer, nothing read from `document.cookie`).
 */
export function createRealtimeSupabase(accessToken: () => Promise<string>) {
  const env = publicSupabaseEnv();
  return createClient<Database>(env.url, env.publishableKey, { accessToken });
}

export type RealtimeSupabase = ReturnType<typeof createRealtimeSupabase>;
