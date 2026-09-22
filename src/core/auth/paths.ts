/**
 * Which paths a signed-out visitor may open, and where a sign-in may send someone. Pure, so
 * the proxy, the actions and the tests share one answer.
 */

export const LOGIN_PATH = "/login";
export const FORGOT_PASSWORD_PATH = "/forgot-password";
export const SET_PASSWORD_PATH = "/set-password";

/** Pages that exist for people without a session. */
const PUBLIC_PAGES = new Set([LOGIN_PATH, FORGOT_PASSWORD_PATH, "/offline", "/robots.txt"]);

/**
 * Prefixes that never need a session: the auth link and sign-out handlers, the staging Sentry
 * diagnostic, and `/api/*`, whose handlers authenticate themselves (cron secret, webhooks).
 */
const PUBLIC_PREFIXES = ["/auth/", "/diagnostics/", "/api/"];

export function isPublicPath(pathname: string): boolean {
  if (PUBLIC_PAGES.has(pathname)) return true;
  return PUBLIC_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

/** Pages a signed-in member has no use for: they are sent home instead. */
export function isSignedOutOnlyPath(pathname: string): boolean {
  return pathname === LOGIN_PATH || pathname === FORGOT_PASSWORD_PATH;
}

const PROBE_ORIGIN = "http://maxoff.invalid";

/**
 * A `next` value is honoured only when it is a same-origin path. It is parsed the way the
 * browser will parse it (the WHATWG URL parser strips tabs and newlines before looking at
 * `//`, so a character check alone is not enough: `/\t//evil.example` resolves to
 * `https://evil.example/`). Printable ASCII only, a single leading `/`, the probe origin must
 * survive, and the sign-in pages are never a target. Anything else returns null and the caller
 * falls back to `/`. Returns the normalised path + search + hash, never the raw input.
 */
export function safeNextPath(value: string | null | undefined): string | null {
  if (!value) return null;
  if (!value.startsWith("/") || value.startsWith("//")) return null;
  if (/[^\x21-\x7e]/.test(value) || value.includes("\\") || value.includes(":")) return null;

  let url: URL;
  try {
    url = new URL(value, PROBE_ORIGIN);
  } catch {
    return null;
  }
  if (url.origin !== PROBE_ORIGIN || url.pathname.startsWith("//")) return null;
  if (isSignedOutOnlyPath(url.pathname) || url.pathname.startsWith("/auth/")) return null;
  return `${url.pathname}${url.search}${url.hash}`;
}
