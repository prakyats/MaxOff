import { systemClock } from "@/core/time";

import { buffer, concat, fromBase64Url, toBase64Url, utf8 } from "./base64url";

/**
 * VAPID (RFC 8292): the application server identifies itself to a push service with an ES256
 * JWT signed by its private key, sent as `Authorization: vapid t=<jwt>, k=<public key>`. Web
 * Crypto only (ARCHITECTURE §9: the dispatcher runs on Cloudflare Workers), no key ever leaves
 * the environment: the private key is imported for signing and never exported or logged.
 *
 * The public key is the raw uncompressed P-256 point (65 bytes, base64url), which is also what
 * the browser is given as `applicationServerKey`; the private key is the 32-byte scalar. Both
 * are what the owner generates on their laptop (kickoff 5 decision 10).
 */
export interface VapidKeys {
  /** base64url, 65 bytes (0x04 || x || y). */
  publicKey: string;
  /** base64url, 32 bytes. */
  privateKey: string;
  /** `mailto:` or `https:` contact for the push services. */
  subject: string;
}

/** A JWT lives 12 hours at most (RFC 8292 §2); one per push is cheap and never stale. */
const JWT_LIFETIME_SECONDS = 12 * 60 * 60;

function jwk(keys: VapidKeys): JsonWebKey {
  const point = fromBase64Url(keys.publicKey);
  if (point.length !== 65 || point[0] !== 0x04) {
    throw new Error("VAPID_PUBLIC_KEY is not an uncompressed P-256 point");
  }
  return {
    kty: "EC",
    crv: "P-256",
    x: toBase64Url(point.slice(1, 33)),
    y: toBase64Url(point.slice(33, 65)),
    d: keys.privateKey,
  };
}

async function importPrivateKey(keys: VapidKeys): Promise<CryptoKey> {
  return crypto.subtle.importKey("jwk", jwk(keys), { name: "ECDSA", namedCurve: "P-256" }, false, [
    "sign",
  ]);
}

/** The JWT for one push endpoint: `aud` is the endpoint's origin, `sub` the contact. */
export async function vapidToken(
  keys: VapidKeys,
  endpoint: string,
  nowSeconds: number = Math.floor(systemClock().getTime() / 1000),
): Promise<string> {
  const header = toBase64Url(utf8(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = toBase64Url(
    utf8(
      JSON.stringify({
        aud: new URL(endpoint).origin,
        exp: nowSeconds + JWT_LIFETIME_SECONDS,
        sub: keys.subject,
      }),
    ),
  );
  const signingInput = `${header}.${claims}`;
  const key = await importPrivateKey(keys);
  // Web Crypto's ECDSA signature is already the raw r || s (64 bytes) JWS wants.
  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    buffer(utf8(signingInput)),
  );
  return `${signingInput}.${toBase64Url(new Uint8Array(signature))}`;
}

/** The `Authorization` header value (RFC 8292 §3). */
export async function vapidAuthorization(
  keys: VapidKeys,
  endpoint: string,
  nowSeconds?: number,
): Promise<string> {
  const token = await vapidToken(keys, endpoint, nowSeconds);
  return `vapid t=${token}, k=${keys.publicKey}`;
}

/** Test helper and self-check: does this public key verify this token? Never used to send. */
export async function verifyVapidToken(publicKey: string, token: string): Promise<boolean> {
  const [header, claims, signature] = token.split(".");
  if (!header || !claims || !signature) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    buffer(fromBase64Url(publicKey)),
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["verify"],
  );
  return crypto.subtle.verify(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    buffer(fromBase64Url(signature)),
    buffer(concat(utf8(header), utf8("."), utf8(claims))),
  );
}
