import "server-only";

import { createClient } from "@supabase/supabase-js";

import type { Database } from "./database.types";
import { publicSupabaseEnv } from "./env";
import { serverSupabaseEnv } from "./env.server";

/**
 * The service-role client. It BYPASSES RLS, so it's only for code that has no
 * user: cron entry points, webhooks, the CEO bootstrap script and jobs.
 * Never use it to serve a user's request, and never pass its results to a
 * client without re-checking permissions.
 */
export function createServiceSupabase() {
  const { url } = publicSupabaseEnv();
  const { secretKey } = serverSupabaseEnv();

  return createClient<Database>(url, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

export type ServiceSupabase = ReturnType<typeof createServiceSupabase>;
