const LOCAL_ORIGIN = "http://localhost:3000";

/**
 * The origin links in emails and dialogs are built on. `NEXT_PUBLIC_APP_URL` wins. Without it,
 * a local run (`NEXT_PUBLIC_APP_ENV` unset or `local`: `next dev`, Playwright) falls back to
 * the request's own host so any port gets working links, then to the local default. Staging
 * and production never fall back: a Host header is client-supplied, so a build that lost the
 * variable must fail loud rather than mail links to whatever host arrived. Pure, unit-tested.
 */
export function resolveAppOrigin(
  configured: string | undefined,
  host: string | null,
  proto: string | null,
  appEnv: string | undefined = undefined,
): string {
  if (configured) {
    try {
      return new URL(configured).origin;
    } catch {
      // A malformed value is treated like a missing one below.
    }
  }
  if (appEnv && appEnv !== "local") {
    throw new Error(`NEXT_PUBLIC_APP_URL must be set on ${appEnv}; links cannot be built.`);
  }
  if (host) {
    const scheme = proto === "https" ? "https" : "http";
    try {
      return new URL(`${scheme}://${host}`).origin;
    } catch {
      // An unusable Host header falls through to the default.
    }
  }
  return LOCAL_ORIGIN;
}
