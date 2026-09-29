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

/**
 * `/api/files/<id>` (task 3.3, ARCHITECTURE §11): a served file is only ever an `<img>` source,
 * and an SVG is a document, so on top of the sanitising done at upload the response forbids
 * every load and script and is sandboxed. Set here, not in the route: a `headers()` rule from
 * `next.config.ts` replaces a header of the same name that a route handler sets, and the last
 * matching rule wins, so this rule follows the global one and keeps `frame-ancestors 'none'`.
 */
export const FILE_ROUTE_SOURCE = "/api/files/:path*";
export const FILE_ROUTE_CSP: ResponseHeader = {
  key: "Content-Security-Policy",
  value: "default-src 'none'; style-src 'unsafe-inline'; sandbox; frame-ancestors 'none'",
};

/**
 * `/auth/confirm` (3cB review), where a one-time invite or recovery link lands: the page shows
 * the link's token in its form, so no cache may keep it, no index may list it, and no referrer
 * may carry the URL to wherever a person goes next. Like the file route, a rule after the
 * global one, so its `Referrer-Policy` replaces the build's.
 */
export const AUTH_LINK_ROUTE_SOURCE = "/auth/confirm";
export const AUTH_LINK_ROUTE_HEADERS: readonly ResponseHeader[] = [
  { key: "Cache-Control", value: "no-store" },
  { key: "X-Robots-Tag", value: "noindex, nofollow" },
  { key: "Referrer-Policy", value: "no-referrer" },
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

/**
 * Puts the same list on a response the proxy builds itself (3c.1). `next.config.ts`'s `headers()`
 * covers what Next renders, but on the Worker a redirect answered by `updateSession()` (no
 * session → `/login`, `/` → the role's home) leaves the proxy before that rule applies, so the
 * proxy sets them here. Existing values are replaced, never appended: the list is the policy.
 */
export function applyResponseHeaders(
  headers: Headers,
  appEnv: AppEnv | string | undefined = process.env.NEXT_PUBLIC_APP_ENV,
): Headers {
  for (const { key, value } of responseHeaders(appEnv)) headers.set(key, value);
  return headers;
}
