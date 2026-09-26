import "server-only";

import { supabaseEnvError } from "./env";

/** Kept apart from `env.ts` so the secret-key reader can never reach a browser bundle. */
export interface ServerSupabaseEnv {
  secretKey: string;
}

/**
 * The secret key. Server only: it bypasses RLS.
 *
 * Plain check rather than zod, to match `env.ts` — see the note there. Nothing is lost: the rule
 * is "present and non-empty", and the message is the one the rest of the app uses.
 */
export function serverSupabaseEnv(): ServerSupabaseEnv {
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  if (!secretKey) throw supabaseEnvError(["SUPABASE_SECRET_KEY is missing"]);
  return { secretKey };
}
