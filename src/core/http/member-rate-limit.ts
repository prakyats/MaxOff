/**
 * A per-member request limit for the two kept diagnostics (`/diagnostics/timing`,
 * `/diagnostics/approvals-timing`; advisor #89 6798443489, v7.0): each answers with about six
 * database reads, open to any member, so one member looping them would eat Worker subrequests and
 * PostgREST capacity the team's real screens share. The speed probe asks at most a few a minute.
 *
 * Counted per Worker isolate (a fixed window in memory): a loop on one connection lands on one
 * isolate, which is the case this stops. Not a security boundary across isolates; the signed-out
 * case never reaches it (each route 404s before any read), and Cloudflare's own rule on the zone
 * (`docs/runbooks/cloudflare-rate-limit.md`) is the outer one.
 */
export const DIAGNOSTICS_LIMIT = { requests: 60, windowMs: 60_000 } as const;

type Window = { start: number; count: number };

export interface RateLimiter {
  /** True when this request is within the limit (and counts it); false once over it. */
  allow(key: string, now?: number): boolean;
}

/** Past this many keys the oldest windows are dropped: memory never grows with the key count. */
const MAX_KEYS = 500;

export function createRateLimiter({
  requests,
  windowMs,
}: {
  requests: number;
  windowMs: number;
}): RateLimiter {
  const windows = new Map<string, Window>();
  return {
    // A monotonic clock (no business date here, ADR-0008): only the window's length matters.
    allow(key, now = performance.now()) {
      const current = windows.get(key);
      if (!current || now - current.start >= windowMs) {
        windows.delete(key);
        if (windows.size >= MAX_KEYS) {
          const oldest = windows.keys().next().value;
          if (oldest !== undefined) windows.delete(oldest);
        }
        windows.set(key, { start: now, count: 1 });
        return true;
      }
      current.count += 1;
      return current.count <= requests;
    },
  };
}

/** The diagnostics' one limiter for this isolate. */
export const diagnosticsLimiter = createRateLimiter(DIAGNOSTICS_LIMIT);

/** The answer once over the limit: no data, no read made. */
export function tooManyRequests(): Response {
  return new Response("Too many requests", {
    status: 429,
    headers: {
      "cache-control": "private, no-store",
      "retry-after": String(Math.ceil(DIAGNOSTICS_LIMIT.windowMs / 1000)),
      "x-robots-tag": "noindex",
    },
  });
}
