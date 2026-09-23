/**
 * Supabase environment variables, validated once per call site.
 * `process.env.NEXT_PUBLIC_*` must be referenced literally so Next.js can inline
 * them into browser bundles; never read them through a dynamic key.
 *
 * Validated by hand rather than with zod **on purpose** (task 1.5). `core/db/browser.ts` imports
 * this, so zod here meant zod in the client bundle of every page — together with
 * `observability/env.ts` it was the largest chunk on `/login`. These are two build-inlined
 * constants with two rules; a schema library earns nothing and costs a round trip.
 */

export interface PublicSupabaseEnv {
  url: string;
  publishableKey: string;
}

/** Shared message shape, so a missing value reads the same wherever it is found. */
export function supabaseEnvError(problems: readonly string[]): Error {
  return new Error(
    `Supabase environment is not configured: ${problems.join("; ")}. See .env.example.`,
  );
}

function isUrl(value: string | undefined): value is string {
  if (!value) return false;
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

/** URL and publishable key. Safe in the browser: the publishable key only grants what RLS allows. */
export function publicSupabaseEnv(): PublicSupabaseEnv {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  const problems: string[] = [];
  if (!isUrl(url)) problems.push("NEXT_PUBLIC_SUPABASE_URL must be a URL");
  if (!publishableKey) problems.push("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY is missing");
  if (problems.length > 0) throw supabaseEnvError(problems);

  return { url: url as string, publishableKey: publishableKey as string };
}
