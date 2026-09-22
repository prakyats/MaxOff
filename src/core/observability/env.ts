import { z } from "zod";

/** Which deployment a build is. Tags Sentry events; nothing in the app branches on it. */
export const APP_ENVS = ["local", "staging", "production"] as const;
export type AppEnv = (typeof APP_ENVS)[number];

const schema = z.object({
  appEnv: z.enum(APP_ENVS, { error: "NEXT_PUBLIC_APP_ENV must be local, staging or production" }),
  dsn: z.url({ error: "NEXT_PUBLIC_SENTRY_DSN must be a URL" }).optional(),
});

export type ObservabilityEnv = z.infer<typeof schema>;

export interface RawObservabilityEnv {
  appEnv: string | undefined;
  dsn: string | undefined;
}

const OFF: ObservabilityEnv = { appEnv: "local" };

/**
 * Validates the observability variables and throws on a bad value. An unset or empty DSN
 * means "Sentry off", which is the local and CI default; an unset environment means `local`.
 * Values are trimmed because they are typed into a dashboard by hand.
 */
export function parseObservabilityEnv(raw: RawObservabilityEnv): ObservabilityEnv {
  const result = schema.safeParse({
    appEnv: raw.appEnv?.trim() || "local",
    dsn: raw.dsn?.trim() || undefined,
  });
  if (result.success) return result.data;
  const problems = result.error.issues.map((issue) => issue.message).join("; ");
  throw new Error(`Observability environment is not configured: ${problems}. See .env.example.`);
}

/**
 * `process.env.NEXT_PUBLIC_*` must be referenced literally so Next.js can inline the values
 * into browser bundles; never read them through a dynamic key.
 */
function rawObservabilityEnv(): RawObservabilityEnv {
  return {
    appEnv: process.env.NEXT_PUBLIC_APP_ENV,
    dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  };
}

/** Build-time check (`next.config.ts`): a bad value fails the build, never the site. */
export function assertObservabilityEnv(): ObservabilityEnv {
  return parseObservabilityEnv(rawObservabilityEnv());
}

/**
 * Runtime reader used by every `Sentry.init`. Sentry is optional, so a value that slipped past
 * the build check degrades to "Sentry off" with a logged error instead of throwing inside
 * `instrumentation.ts` (which would take every request down) or before hydration.
 */
export function observabilityEnv(): ObservabilityEnv {
  try {
    return parseObservabilityEnv(rawObservabilityEnv());
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return OFF;
  }
}
