// @ts-check
import { createHmac } from "node:crypto";

/**
 * A time-based one-time code (RFC 6238: HMAC-SHA1, 30-second steps, 6 digits), what an
 * authenticator app shows for a TOTP factor (v7.5 Q2, two-step sign-in). For the tools that sign in
 * as an Owner who must pass the second step: the e2e setup and specs (`e2e/totp.ts`) and the speed
 * probe on staging (`STAGING_OWNER_TOTP_SECRET`). No dependency: node:crypto only.
 */

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/**
 * The key GoTrue hands out (base32, as the authenticator app is given it) as bytes.
 * @param {string} text
 * @returns {Buffer}
 */
export function base32Decode(text) {
  let bits = "";
  for (const char of text.replace(/[\s=]/g, "").toUpperCase()) {
    const value = ALPHABET.indexOf(char);
    if (value < 0) throw new Error("not a base32 key");
    bits += value.toString(2).padStart(5, "0");
  }
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}

/**
 * The 6-digit code for `secret` at `nowMs` (the epoch milliseconds the caller's clock reads).
 * @param {string} secret
 * @param {number} nowMs
 * @param {{ step?: number; digits?: number }} [options]
 * @returns {string}
 */
export function totpCode(secret, nowMs, { step = 30, digits = 6 } = {}) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(nowMs / 1000 / step)));
  const hash = createHmac("sha1", base32Decode(secret)).update(counter).digest();
  const offset = (hash[hash.length - 1] ?? 0) & 0xf;
  const value = (hash.readUInt32BE(offset) & 0x7fffffff) % 10 ** digits;
  return String(value).padStart(digits, "0");
}

/**
 * Takes a password session through the second step with supabase-js: the member's verified TOTP
 * factor, a challenge and the code, so the session becomes `aal2`. Returns the new session.
 * @param {any} client a supabase-js client holding the password session
 * @param {string} secret the factor's key
 * @param {number} nowMs
 */
export async function passSecondStep(client, secret, nowMs) {
  const factors = await client.auth.mfa.listFactors();
  if (factors.error) throw new Error(`listFactors failed: ${factors.error.message}`);
  const factor = factors.data.all.find(
    (/** @type {{ factor_type: string; status: string }} */ f) =>
      f.factor_type === "totp" && f.status === "verified",
  );
  if (!factor) throw new Error("this member has no verified authenticator");
  const verified = await client.auth.mfa.challengeAndVerify({
    factorId: factor.id,
    code: totpCode(secret, nowMs),
  });
  if (verified.error) throw new Error(`the second step failed: ${verified.error.message}`);
  const { data } = await client.auth.getSession();
  return data.session;
}
