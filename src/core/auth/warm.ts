import { combineChunks, createServerClient, stringFromBase64URL } from "@supabase/ssr";

import type { Database } from "@/core/db";
import { publicSupabaseEnv, sessionCookieOptions } from "@/core/db";
import { systemClock } from "@/core/time/clock";

/**
 * The warm-up's session half (P2, 2026-10-15; ARCHITECTURE §19 "Warm the Worker early").
 * `GET /api/warm` exists so the first real tap after the app comes back into view lands on a
 * warm isolate. A cold signed-in request also pays for the first JWKS fetch of each bundle that
 * verifies the session (the proxy's and the server's: `claims` 170–370 ms cold, 0 warm, unit P),
 * so the warm-up verifies the session's access token too, which fetches and caches that key in
 * the isolate. It must never cost what it saves, so it is a strict subset of a real request:
 *
 * - **No refresh, ever, and no cookie written.** The token is read from the cookie as it is and
 *   handed to `getClaims(token)`, which with an explicit token never looks at the stored session
 *   and so never refreshes it (a refresh here would rotate the refresh token without handing the
 *   new one back: `core/db/expired-jwt.ts`). The client's `setAll` is a no-op as a second net.
 * - **No database.** Only an asymmetrically signed token (a `kid`, not `HS*`) that is not about to
 *   expire is verified: that is a JWKS fetch at most. A symmetric or expiring token would send
 *   `getClaims` to GoTrue's `/user` (an auth database read), so it is skipped: the real request
 *   that follows pays for it as before.
 * - **Nothing read or returned.** The claims are dropped; the route answers 204 with no body.
 */

/** The address the client warm-up asks (`core/ui/pwa/warm-up.ts`); answered 204 with no body. */
export const WARM_PATH = "/api/warm";

/** A token closer than this to its expiry is left alone (a real request refreshes it). */
const EXPIRY_MARGIN_S = 60;

const SESSION_COOKIE = /^(sb-.+-auth-token)(?:\.\d+)?$/;
const BASE64_PREFIX = "base64-";

type CookieLike = { name: string; value: string };

/** The session's access token as `@supabase/ssr` stored it (chunked, base64url), or null. */
export async function accessTokenFrom(cookies: readonly CookieLike[]): Promise<string | null> {
  const key = cookies.map((cookie) => SESSION_COOKIE.exec(cookie.name)?.[1]).find(Boolean);
  if (!key) return null;
  const byName = new Map(cookies.map((cookie) => [cookie.name, cookie.value]));
  const raw = await combineChunks(key, (name) => byName.get(name) ?? null);
  if (!raw) return null;
  try {
    const json = raw.startsWith(BASE64_PREFIX)
      ? stringFromBase64URL(raw.slice(BASE64_PREFIX.length))
      : raw;
    const session = JSON.parse(json) as { access_token?: unknown };
    return typeof session.access_token === "string" ? session.access_token : null;
  } catch {
    return null;
  }
}

function decodePart(part: string | undefined): Record<string, unknown> | null {
  if (!part) return null;
  try {
    const value = JSON.parse(stringFromBase64URL(part)) as unknown;
    return value !== null && typeof value === "object" ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * Whether verifying `token` is a JWKS fetch at most: signed with a published key (`kid`, not a
 * shared secret) and valid for at least another minute at `nowSeconds`.
 */
export function isWarmableToken(token: string, nowSeconds: number): boolean {
  const [header, payload] = token.split(".");
  const head = decodePart(header);
  const body = decodePart(payload);
  if (!head || !body) return false;
  if (typeof head.alg !== "string" || head.alg.startsWith("HS")) return false;
  if (typeof head.kid !== "string" || head.kid.length === 0) return false;
  return typeof body.exp === "number" && body.exp - nowSeconds > EXPIRY_MARGIN_S;
}

/**
 * Verifies the session's access token once in this bundle, so its JWKS is fetched and cached
 * before a real request needs it. Never throws, never refreshes, never writes a cookie; returns
 * whether it verified (for the caller's timing only).
 */
export async function warmSessionVerification(cookies: readonly CookieLike[]): Promise<boolean> {
  try {
    const token = await accessTokenFrom(cookies);
    const now = Math.floor(systemClock().getTime() / 1000);
    if (!token || !isWarmableToken(token, now)) return false;
    const env = publicSupabaseEnv();
    const supabase = createServerClient<Database>(env.url, env.publishableKey, {
      cookieOptions: sessionCookieOptions(),
      cookies: {
        getAll: () => cookies.map(({ name, value }) => ({ name, value })),
        setAll: () => undefined,
      },
    });
    const { error } = await supabase.auth.getClaims(token);
    return !error;
  } catch {
    return false;
  }
}
