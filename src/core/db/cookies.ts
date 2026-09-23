import type { CookieOptionsWithName } from "@supabase/ssr";

/**
 * Options for the `sb-*` session cookies (ADR-0012, ARCHITECTURE §7a). `@supabase/ssr` defaults
 * to `httpOnly: false` so that its browser client can read the session from `document.cookie`.
 * MaxOff never uses that client (every query and every auth call runs on the server), so the
 * cookies are hidden from scripts: a script injected into a page cannot lift the refresh token.
 * `secure` is on for every deployed build and off for local runs (`next dev`, Playwright on
 * plain http), where a Secure cookie would never be stored.
 */
export function sessionCookieOptions(
  appEnv: string | undefined = process.env.NEXT_PUBLIC_APP_ENV,
): CookieOptionsWithName {
  return {
    httpOnly: true,
    sameSite: "lax",
    secure: appEnv === "staging" || appEnv === "production",
  };
}
