/** Which deployment a build is. Tags Sentry events; nothing in the app branches on it. */
export const APP_ENVS = ["local", "staging", "production"] as const;
export type AppEnv = (typeof APP_ENVS)[number];

export interface ObservabilityEnv {
  appEnv: AppEnv;
  /** Unset or empty means "Sentry off", which is the local and CI default. */
  dsn?: string;
}

export interface RawObservabilityEnv {
  appEnv: string | undefined;
  dsn: string | undefined;
}

const OFF: ObservabilityEnv = { appEnv: "local" };

/**
 * Validated by hand rather than with zod **on purpose** (task 1.5).
 *
 * This module is reached from the browser through `observability/options.ts`, and importing zod
 * here pulled the whole library into the client bundle of every page — the largest chunk on
 * `/login`, 356 KB of the 1.34 MB it was downloading. Two values with two rules do not need a
 * schema library, and these are `NEXT_PUBLIC_*` constants that `next build` has already inlined.
 */
const APP_ENV_MESSAGE = "NEXT_PUBLIC_APP_ENV must be local, staging or production";
const DSN_MESSAGE = "NEXT_PUBLIC_SENTRY_DSN must be a URL";

function isAppEnv(value: string): value is AppEnv {
  return (APP_ENVS as readonly string[]).includes(value);
}

function isUrl(value: string): boolean {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

/**
 * Validates the observability variables and throws on a bad value. An unset or empty DSN
 * means "Sentry off", which is the local and CI default; an unset environment means `local`.
 * Values are trimmed because they are typed into a dashboard by hand.
 */
export function parseObservabilityEnv(raw: RawObservabilityEnv): ObservabilityEnv {
  const appEnv = raw.appEnv?.trim() || "local";
  const dsn = raw.dsn?.trim() || undefined;

  const problems: string[] = [];
  if (!isAppEnv(appEnv)) problems.push(APP_ENV_MESSAGE);
  if (dsn !== undefined && !isUrl(dsn)) problems.push(DSN_MESSAGE);

  if (problems.length > 0) {
    throw new Error(
      `Observability environment is not configured: ${problems.join("; ")}. See .env.example.`,
    );
  }

  const checked = appEnv as AppEnv;
  return dsn === undefined ? { appEnv: checked } : { appEnv: checked, dsn };
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
