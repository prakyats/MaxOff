/**
 * The Drive tokens at rest (ADR-0010): AES-256-GCM with the environment's `DRIVE_TOKEN_KEY`,
 * through Web Crypto (the Worker's and Node's), a fresh 12-byte IV per value. Stored as
 * `v1.<iv>.<ciphertext>` (base64url), so a later key or format can sit beside this one.
 * The database never sees the key; the browser never sees a token.
 */
const VERSION = "v1";

async function importKey(base64Key: string): Promise<CryptoKey> {
  const raw = Uint8Array.from(atob(base64Key), (char) => char.charCodeAt(0));
  if (raw.length !== 32) throw new Error("The Drive token key must be 32 bytes");
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function encryptToken(plain: string, base64Key: string): Promise<string> {
  const key = await importKey(base64Key);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const sealed = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(plain),
  );
  return `${VERSION}.${toBase64Url(iv)}.${toBase64Url(new Uint8Array(sealed))}`;
}

export async function decryptToken(stored: string, base64Key: string): Promise<string> {
  const [version, iv, body] = stored.split(".");
  if (version !== VERSION || !iv || !body) throw new Error("Not a stored Drive token");
  const key = await importKey(base64Key);
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: fromBase64Url(iv) },
    key,
    fromBase64Url(body),
  );
  return new TextDecoder().decode(plain);
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(text: string): Uint8Array<ArrayBuffer> {
  const base64 = text.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(base64 + "=".repeat((4 - (base64.length % 4)) % 4));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}
