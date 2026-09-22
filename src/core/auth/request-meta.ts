/**
 * What `session_events` stores about the request: the user agent, and a salted hash of the
 * client IP (never the IP itself). Without `SESSION_IP_HASH_SALT` the hash is null: an
 * unsalted IPv4 hash is reversible in seconds, which would defeat the column's purpose
 * (decided 2026-09-22).
 */

export type SessionMeta = { userAgent: string | null; ipHash: string | null };

const USER_AGENT_MAX = 512;

/** The client IP behind Cloudflare, then the usual proxy headers, else null. */
export function clientIpFrom(headers: Headers): string | null {
  const cf = headers.get("cf-connecting-ip")?.trim();
  if (cf) return cf;
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  if (forwarded) return forwarded;
  const real = headers.get("x-real-ip")?.trim();
  return real || null;
}

/** SHA-256 of `salt:ip`, hex. Null when either part is missing. Web Crypto, so it runs anywhere. */
export async function hashIp(ip: string | null, salt: string | undefined): Promise<string | null> {
  if (!ip || !salt) return null;
  const bytes = new TextEncoder().encode(`${salt}:${ip}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function sessionMetaFrom(
  headers: Headers,
  salt: string | undefined,
): Promise<SessionMeta> {
  const userAgent = headers.get("user-agent")?.slice(0, USER_AGENT_MAX).trim() || null;
  const ipHash = await hashIp(clientIpFrom(headers), salt);
  return { userAgent, ipHash };
}
