import { z } from "zod";

/**
 * Supabase environment variables, validated once per call site.
 * `process.env.NEXT_PUBLIC_*` must be referenced literally so Next.js can inline
 * them into browser bundles; never read them through a dynamic key.
 */

const publicSchema = z.object({
  url: z.url({ error: "NEXT_PUBLIC_SUPABASE_URL must be a URL" }),
  publishableKey: z.string().min(1, { error: "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY is missing" }),
});

export type PublicSupabaseEnv = z.infer<typeof publicSchema>;

export function parseSupabaseEnv<T>(schema: z.ZodType<T>, raw: unknown): T {
  const result = schema.safeParse(raw);
  if (result.success) return result.data;
  const problems = result.error.issues.map((issue) => issue.message).join("; ");
  throw new Error(`Supabase environment is not configured: ${problems}. See .env.example.`);
}

/** URL and publishable key. Safe in the browser: the publishable key only grants what RLS allows. */
export function publicSupabaseEnv(): PublicSupabaseEnv {
  return parseSupabaseEnv(publicSchema, {
    url: process.env.NEXT_PUBLIC_SUPABASE_URL,
    publishableKey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  });
}
