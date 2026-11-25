/**
 * The upload page's side of the public API (v4.5, plan A8, B3, J7): the token from the link's
 * fragment, the device key, and the `/api/upload/*` calls. Browser only, no React.
 *
 * - The token is read from `location.hash` once, kept in this tab's `sessionStorage` (so a reload
 *   keeps working) and removed from the address bar at once: it never reaches a server log, a
 *   `Referer` or a screenshot of the address (A8).
 * - The device key is 32 random bytes kept in `localStorage` for this link only (under a name made
 *   from the token's hash, never the token), so a returning device sees its own files (Q4, B3).
 * - Every call is a `POST` of JSON to the page's own origin, the token in `Authorization`, with no
 *   cookie and no referrer, so the page works the same from a sibling origin (J9) and never carries
 *   a member's MaxOff session.
 */
import type { Result } from "@/core/errors/result";

import type { UploadEndpoint } from "../actions/public-api";
import { isTokenShaped } from "../domain/token";

const TOKEN_SLOT = "maxoff.upload.token";
const DEVICE_SLOT_PREFIX = "maxoff.upload.device.";

function base64url(bytes: Uint8Array): string {
  let text = "";
  for (const byte of bytes) text += String.fromCharCode(byte);
  return btoa(text).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function session(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}
function local(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/**
 * The link's token: from the fragment on arrival (then cleared from the address bar), else from
 * this tab's storage after a reload. Null for anything that is not shaped like a token: the page
 * then shows the one bad-link screen without asking the server.
 */
export function readToken(): string | null {
  const fromHash = window.location.hash.replace(/^#/, "");
  if (fromHash) {
    // Not `replaceViewAddress()`: the token must leave the address bar now, before anything else
    // runs or is captured (plan A8, J4), not when the router is next idle; Next keeps its own state.
    // eslint-disable-next-line no-restricted-syntax -- the token leaves the address at once (A8).
    window.history.replaceState(window.history.state, "", window.location.pathname);
    if (!isTokenShaped(fromHash)) return null;
    try {
      session()?.setItem(TOKEN_SLOT, fromHash);
    } catch {
      // Private mode: a reload then needs the link again.
    }
    return fromHash;
  }
  let kept: string | null = null;
  try {
    kept = session()?.getItem(TOKEN_SLOT) ?? null;
  } catch {
    kept = null;
  }
  return kept && isTokenShaped(kept) ? kept : null;
}

async function slotFor(token: string): Promise<string> {
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`device:${token}`)),
  );
  return DEVICE_SLOT_PREFIX + base64url(digest.slice(0, 12));
}

/** This browser's key for this link, made on first use (B3). `fresh` makes a new one ("Not Sam?"). */
export async function deviceKey(token: string, fresh = false): Promise<string> {
  const slot = await slotFor(token);
  if (!fresh) {
    try {
      const kept = local()?.getItem(slot);
      if (kept && isTokenShaped(kept)) return kept;
    } catch {
      // No storage: a key for this visit only.
    }
  }
  const key = base64url(crypto.getRandomValues(new Uint8Array(32)));
  try {
    local()?.setItem(slot, key);
  } catch {
    // Kept in memory for this visit.
  }
  return key;
}

const UNREACHABLE: Result<never> = {
  ok: false,
  error: { code: "INTERNAL", message: "Couldn't reach the studio. Check the connection." },
};

/** One call to `/api/upload/<endpoint>`. Never rejects: a network failure is `INTERNAL`. */
export async function callUpload<T>(
  endpoint: UploadEndpoint,
  token: string,
  body: Record<string, unknown>,
): Promise<Result<T>> {
  try {
    const response = await fetch(`/api/upload/${endpoint}`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `UploadLink ${token}` },
      body: JSON.stringify(body),
      credentials: "omit",
      cache: "no-store",
      referrerPolicy: "no-referrer",
    });
    const answer = (await response.json()) as Result<T>;
    return typeof answer === "object" && answer !== null && "ok" in answer ? answer : UNREACHABLE;
  } catch {
    return UNREACHABLE;
  }
}
