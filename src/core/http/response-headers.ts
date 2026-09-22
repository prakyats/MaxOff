import type { AppEnv } from "@/core/observability/env";

/**
 * Headers on every response the Worker renders (ARCHITECTURE §18.3). Used by `headers()` in
 * `next.config.ts` and asserted against a real production build in `e2e/production.spec.ts`.
 * Static assets get their cache headers from `public/_headers`; these apply to HTML, RSC and
 * action responses.
 */
export interface ResponseHeader {
  key: string;
  value: string;
}

export const SECURITY_HEADERS: readonly ResponseHeader[] = [
  // Never framed, by anyone: the app has no embed use case, and a session cookie arrives in 1.2.
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  // Two years, subdomains included. Browsers ignore it over plain http (local `next start`).
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
];

/** Staging must never be indexed. Production stays indexable-by-choice (decided later). */
export const NOINDEX_HEADER: ResponseHeader = { key: "X-Robots-Tag", value: "noindex, nofollow" };

/** Body of `/robots.txt` on staging (`src/app/robots.txt/route.ts`); 404 everywhere else. */
export const ROBOTS_DISALLOW_ALL = "User-agent: *\nDisallow: /\n";

export function isNoindexEnvironment(appEnv: AppEnv | string | undefined): boolean {
  return appEnv === "staging";
}

/** The full list for a build: the security headers, plus noindex on staging. */
export function responseHeaders(appEnv: AppEnv | string | undefined): ResponseHeader[] {
  return isNoindexEnvironment(appEnv)
    ? [...SECURITY_HEADERS, NOINDEX_HEADER]
    : [...SECURITY_HEADERS];
}
