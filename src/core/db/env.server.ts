import "server-only";

import { z } from "zod";

import { parseSupabaseEnv } from "./env";

/** Kept apart from `env.ts` so the secret-key reader can never reach a browser bundle. */
const serverSchema = z.object({
  secretKey: z.string().min(1, { error: "SUPABASE_SECRET_KEY is missing" }),
});

export type ServerSupabaseEnv = z.infer<typeof serverSchema>;

/** The secret key. Server only: it bypasses RLS. */
export function serverSupabaseEnv(): ServerSupabaseEnv {
  return parseSupabaseEnv(serverSchema, { secretKey: process.env.SUPABASE_SECRET_KEY });
}
