import { buffer, concat, fromBase64Url, toBase64Url, utf8 } from "./base64url";

/**
 * Message encryption for Web Push (RFC 8291, `aes128gcm` of RFC 8188), Web Crypto only:
 *
 *   ecdh_secret = ECDH(as_private, ua_public)
 *   IKM  = HKDF-SHA-256(salt = auth_secret, IKM = ecdh_secret,
 *                       info = "WebPush: info" || 0x00 || ua_public || as_public, 32)
 *   PRK  = HKDF-Extract(salt, IKM)
 *   CEK  = HKDF-Expand(PRK, "Content-Encoding: aes128gcm" || 0x00, 16)
 *   NONCE = HKDF-Expand(PRK, "Content-Encoding: nonce" || 0x00, 12)
 *   body = salt(16) || rs(4) || idlen(1) || as_public(65) || AES-128-GCM(CEK, NONCE, plaintext || 0x02)
 *
 * One record (rs = 4096, a push payload is at most 4 KB), the last-record delimiter 0x02. The
 * sender's key pair is ephemeral (one per message) and the salt random; both can be handed in,
 * which is how the RFC's Appendix A vector is checked in the tests. `decrypt` exists for the
 * tests and the fake push endpoint only: the app never receives a push.
 */
export interface SubscriptionKeys {
  /** base64url, the receiver's public key (65 bytes). */
  p256dh: string;
  /** base64url, the 16-byte authentication secret. */
  auth: string;
}

export interface EncryptOptions {
  /** Test only: the sender's key pair as base64url (private scalar, public point). */
  senderKeys?: { privateKey: string; publicKey: string };
  /** Test only: the 16-byte salt. */
  salt?: Uint8Array;
}

const RECORD_SIZE = 4096;
/** The whole message must fit one record: rs - 16 (tag) - 1 (delimiter). */
export const MAX_PLAINTEXT_BYTES = RECORD_SIZE - 17;

async function hkdf(
  salt: Uint8Array,
  ikm: Uint8Array,
  info: Uint8Array,
  length: number,
): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", buffer(ikm), "HKDF", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt: buffer(salt), info: buffer(info) },
    key,
    length * 8,
  );
  return new Uint8Array(bits);
}

async function importPublic(point: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    buffer(point),
    { name: "ECDH", namedCurve: "P-256" },
    false,
    [],
  );
}

async function senderKeyPair(
  given: EncryptOptions["senderKeys"],
): Promise<{ privateKey: CryptoKey; publicPoint: Uint8Array }> {
  if (given) {
    const point = fromBase64Url(given.publicKey);
    const privateKey = await crypto.subtle.importKey(
      "jwk",
      {
        kty: "EC",
        crv: "P-256",
        x: toBase64Url(point.slice(1, 33)),
        y: toBase64Url(point.slice(33, 65)),
        d: given.privateKey,
      },
      { name: "ECDH", namedCurve: "P-256" },
      false,
      ["deriveBits"],
    );
    return { privateKey, publicPoint: point };
  }
  const pair = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, [
    "deriveBits",
  ]);
  const publicPoint = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
  return { privateKey: pair.privateKey, publicPoint };
}

async function deriveKeys(
  ecdhSecret: Uint8Array,
  authSecret: Uint8Array,
  uaPublic: Uint8Array,
  asPublic: Uint8Array,
  salt: Uint8Array,
): Promise<{ cek: Uint8Array; nonce: Uint8Array }> {
  const keyInfo = concat(utf8("WebPush: info"), new Uint8Array([0]), uaPublic, asPublic);
  const ikm = await hkdf(authSecret, ecdhSecret, keyInfo, 32);
  const cek = await hkdf(
    salt,
    ikm,
    concat(utf8("Content-Encoding: aes128gcm"), new Uint8Array([0])),
    16,
  );
  const nonce = await hkdf(
    salt,
    ikm,
    concat(utf8("Content-Encoding: nonce"), new Uint8Array([0])),
    12,
  );
  return { cek, nonce };
}

/** The encrypted body to POST to the push service, as one `aes128gcm` record. */
export async function encryptPayload(
  plaintext: Uint8Array,
  keys: SubscriptionKeys,
  options: EncryptOptions = {},
): Promise<Uint8Array> {
  if (plaintext.length > MAX_PLAINTEXT_BYTES) {
    throw new Error(`A push payload is at most ${MAX_PLAINTEXT_BYTES} bytes`);
  }
  const uaPublic = fromBase64Url(keys.p256dh);
  const authSecret = fromBase64Url(keys.auth);
  if (uaPublic.length !== 65 || uaPublic[0] !== 0x04)
    throw new Error("p256dh is not a P-256 point");
  if (authSecret.length !== 16) throw new Error("auth is not 16 bytes");
  const salt = options.salt ?? crypto.getRandomValues(new Uint8Array(16));
  if (salt.length !== 16) throw new Error("the salt is 16 bytes");

  const sender = await senderKeyPair(options.senderKeys);
  const ecdhSecret = new Uint8Array(
    await crypto.subtle.deriveBits(
      { name: "ECDH", public: await importPublic(uaPublic) },
      sender.privateKey,
      256,
    ),
  );
  const { cek, nonce } = await deriveKeys(
    ecdhSecret,
    authSecret,
    uaPublic,
    sender.publicPoint,
    salt,
  );
  const aes = await crypto.subtle.importKey("raw", buffer(cek), "AES-GCM", false, ["encrypt"]);
  const record = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: buffer(nonce) },
      aes,
      buffer(concat(plaintext, new Uint8Array([2]))),
    ),
  );
  const header = new Uint8Array(21);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, RECORD_SIZE);
  header[20] = 65;
  return concat(header, sender.publicPoint, record);
}

/**
 * The receiver's side, for tests and the e2e fake push endpoint: the subscription's private
 * key (base64url scalar) and auth secret open a message made by `encryptPayload`.
 */
export async function decryptPayload(
  body: Uint8Array,
  receiver: { privateKey: string; publicKey: string; auth: string },
): Promise<Uint8Array> {
  if (body.length < 86) throw new Error("not an aes128gcm message");
  const salt = body.slice(0, 16);
  const idLength = body[20];
  if (idLength !== 65) throw new Error("the key id is not a P-256 point");
  const asPublic = body.slice(21, 86);
  const record = body.slice(86);
  const uaPublic = fromBase64Url(receiver.publicKey);
  const privateKey = await crypto.subtle.importKey(
    "jwk",
    {
      kty: "EC",
      crv: "P-256",
      x: toBase64Url(uaPublic.slice(1, 33)),
      y: toBase64Url(uaPublic.slice(33, 65)),
      d: receiver.privateKey,
    },
    { name: "ECDH", namedCurve: "P-256" },
    false,
    ["deriveBits"],
  );
  const ecdhSecret = new Uint8Array(
    await crypto.subtle.deriveBits(
      { name: "ECDH", public: await importPublic(asPublic) },
      privateKey,
      256,
    ),
  );
  const { cek, nonce } = await deriveKeys(
    ecdhSecret,
    fromBase64Url(receiver.auth),
    uaPublic,
    asPublic,
    salt,
  );
  const aes = await crypto.subtle.importKey("raw", buffer(cek), "AES-GCM", false, ["decrypt"]);
  const padded = new Uint8Array(
    await crypto.subtle.decrypt({ name: "AES-GCM", iv: buffer(nonce) }, aes, buffer(record)),
  );
  // Strip the delimiter and any zero padding after it (RFC 8188 §2).
  let end = padded.length - 1;
  while (end >= 0 && padded[end] === 0) end -= 1;
  if (end < 0 || padded[end] !== 2) throw new Error("the last record delimiter is missing");
  return padded.slice(0, end);
}

/** A throwaway receiver key pair for tests: never used for a real subscription. */
export async function generateReceiverKeys(): Promise<{
  privateKey: string;
  publicKey: string;
  auth: string;
}> {
  const pair = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, [
    "deriveBits",
  ]);
  const publicKey = toBase64Url(
    new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey)),
  );
  const jwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
  if (!jwk.d) throw new Error("no private scalar");
  return {
    privateKey: jwk.d,
    publicKey,
    auth: toBase64Url(crypto.getRandomValues(new Uint8Array(16))),
  };
}

/** A throwaway VAPID key pair for tests, in the shape the environment holds. */
export async function generateVapidKeysForTests(): Promise<{
  publicKey: string;
  privateKey: string;
}> {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
    "sign",
    "verify",
  ]);
  const publicKey = toBase64Url(
    new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey)),
  );
  const jwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
  if (!jwk.d) throw new Error("no private scalar");
  return { publicKey, privateKey: jwk.d };
}
