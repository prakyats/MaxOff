/**
 * The upload link's token (v4.5, security plan A1–A3; DATA-MODEL §8a `upload_links`). The token
 * is never stored: it is `base64url(HMAC-SHA256(UPLOAD_LINK_KEY, link id ‖ salt))`, 43
 * characters, so the server can show it again for Copy link, and the database keeps only
 * `sha256(token)` to find the link by. Platform-free (Web Crypto, available in the Worker and in
 * Node), so the same code runs in the server action and in the tests.
 */

const TOKEN_LENGTH = 43;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function fromBase64(text: string): Uint8Array {
  const binary = atob(text.replaceAll("-", "+").replaceAll("_", "/"));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

/** The 32-byte key from `UPLOAD_LINK_KEY` (base64); anything else is refused, never padded. */
export function linkKeyBytes(base64Key: string): Uint8Array {
  let bytes: Uint8Array;
  try {
    bytes = fromBase64(base64Key.trim());
  } catch {
    throw new Error("UPLOAD_LINK_KEY is not base64");
  }
  if (bytes.length !== 32) throw new Error("UPLOAD_LINK_KEY must be 32 bytes");
  return bytes;
}

/** A link's 16 random salt bytes, made once when the link is made. */
export function newLinkSalt(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(16));
}

/** The link's token: the same link id, salt and key always give the same token. */
export async function deriveLinkToken(input: {
  key: Uint8Array;
  linkId: string;
  salt: Uint8Array;
}): Promise<string> {
  const hmacKey = await crypto.subtle.importKey(
    "raw",
    input.key as BufferSource,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const id = new TextEncoder().encode(input.linkId);
  const message = new Uint8Array(id.length + input.salt.length);
  message.set(id, 0);
  message.set(input.salt, id.length);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", hmacKey, message));
  return base64url(mac);
}

/** Does this text look like a token at all? Anything else is refused before any lookup. */
export function isTokenShaped(text: string): boolean {
  return text.length === TOKEN_LENGTH && TOKEN_PATTERN.test(text);
}

/** `sha256(token)`, the only form the database holds and looks a link up by. */
export async function tokenHash(token: string): Promise<Uint8Array> {
  return new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token) as BufferSource),
  );
}
