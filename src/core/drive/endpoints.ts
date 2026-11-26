/**
 * Where MaxOff's Google calls go. Google's own addresses, except in a **local** run (the dev
 * server, CI's Playwright) that names `GOOGLE_API_ORIGIN_FOR_TESTS`: the e2e's fake Google
 * (`e2e/fake-google.ts`) then answers the token, Drive and resumable-upload calls, so the upload
 * flows run end to end without Google (v4.5, security plan §7.3). Staging and production never
 * honour it, whatever is set (a unit test holds that).
 */
const GOOGLE = { oauth: "https://oauth2.googleapis.com", api: "https://www.googleapis.com" };

export type GoogleOrigins = { oauth: string; api: string };

export function googleOrigins(
  env: Readonly<Record<string, string | undefined>> = process.env,
  // Written out as `process.env.NEXT_PUBLIC_APP_ENV` so the build inlines it: on the Worker the
  // variable exists only at build time, and a read through `env` would find it unset ("local").
  appEnvValue: string | undefined = env === process.env
    ? process.env.NEXT_PUBLIC_APP_ENV
    : env.NEXT_PUBLIC_APP_ENV,
): GoogleOrigins {
  const appEnv = appEnvValue?.trim() || "local";
  const fake = env.GOOGLE_API_ORIGIN_FOR_TESTS?.trim();
  if (appEnv !== "local" || !fake) return GOOGLE;
  try {
    const url = new URL(fake);
    const local = url.hostname === "127.0.0.1" || url.hostname === "localhost";
    return local ? { oauth: url.origin, api: url.origin } : GOOGLE;
  } catch {
    return GOOGLE;
  }
}

/** True when the fake Google is in use (the upload page's CSP then allows its origin). */
export function fakeGoogleOrigin(
  env: Readonly<Record<string, string | undefined>> = process.env,
): string | null {
  const origins = googleOrigins(env);
  return origins.api === GOOGLE.api ? null : origins.api;
}
