import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";
import { withSentryConfig } from "@sentry/nextjs/config";
import type { NextConfig } from "next";

import {
  AUTH_LINK_ROUTE_HEADERS,
  AUTH_LINK_ROUTE_SOURCE,
  FILE_ROUTE_CSP,
  FILE_ROUTE_SOURCE,
  responseHeaders,
} from "./src/core/http/response-headers";
import { appVersionFrom } from "./src/core/lib/app-version";
import { assertObservabilityEnv } from "./src/core/observability/env";

// Lets `next dev` reach Cloudflare bindings through `getCloudflareContext()` (none are used
// before task 3.3). A no-op outside `next dev`.
initOpenNextCloudflareForDev();

// A malformed NEXT_PUBLIC_APP_ENV or NEXT_PUBLIC_SENTRY_DSN fails the build here, so a typo in
// a GitHub environment variable can never reach the Worker (the runtime reader degrades to
// "Sentry off" as a second net).
const { appEnv } = assertObservabilityEnv();

// Security headers on every rendered response, plus `X-Robots-Tag: noindex` on staging
// (ARCHITECTURE §18.3, `core/http/response-headers`). Resolved once at build time, like the
// NEXT_PUBLIC_* values. Asserted against a real production build in `e2e/production.spec.ts`.
const RESPONSE_HEADERS = responseHeaders(appEnv);

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // The version Me's "Help & troubleshooting" shows (5B decision 4): the release tag, or the
  // branch and commit, from the build's own GitHub Actions environment ("local" elsewhere).
  env: { NEXT_PUBLIC_APP_VERSION: appVersionFrom(process.env) },
  // The file route's stricter CSP and the auth link page's headers come after the global rule
  // on purpose: the last rule to set a header wins.
  headers: async () => [
    { source: "/:path*", headers: RESPONSE_HEADERS },
    { source: FILE_ROUTE_SOURCE, headers: [FILE_ROUTE_CSP] },
    { source: AUTH_LINK_ROUTE_SOURCE, headers: [...AUTH_LINK_ROUTE_HEADERS] },
  ],
  // `next dev` otherwise appends its own block to CLAUDE.md on every run.
  // CLAUDE.md is hand-written project memory, so we keep Next out of it.
  // Next 16's own guidance lives in `node_modules/next/dist/docs/`.
  agentRules: false,
  // No dev-tools button. `{ position }` does still work in Next 16 (only `appIsrStatus`,
  // `buildActivity` and `buildActivityPosition` were removed), but since 1.5 gave every role a
  // bottom bar there is no free corner left: bottom-left and bottom-right sit on nav items,
  // top-left on the brand and top-right on the account menu. It covered the More tab, which is
  // exactly what a real-device pass needs to tap. Next still surfaces every compile and runtime
  // error with `false` — only the route-type badge and the devtools panel go.
  devIndicators: false,
  experimental: {
    // The client router cache (ARCHITECTURE §19, owner decision 2026-09-28). A tab seen in the
    // last 30 s comes back at once with no request (Next's default for dynamic pages is 0 s: every
    // revisit went back to the server, 424–466 ms on the phase-3c preview). 30 s is refresh on
    // return's own minimum interval, so a cached view never outlives the rule that refreshes it;
    // every action revalidates what it changed, pull-to-refresh fetches on demand, and Realtime
    // (5.1) pushes the rest. `static` (loading boundaries and fully prefetched routes) stays at
    // 180 s, below Next's 300 s default.
    staleTimes: { dynamic: 30, static: 180 },
  },
};

const uploadsSourceMaps = Boolean(process.env.SENTRY_AUTH_TOKEN);

// Sentry (task 0.5, ARCHITECTURE §18). The SDK itself is configured in `src/core/observability`;
// this wrapper only handles build-time source-map upload, which happens solely when the deploy
// workflow provides SENTRY_AUTH_TOKEN. Local builds and CI upload nothing.
export default withSentryConfig(nextConfig, {
  ...(process.env.SENTRY_ORG ? { org: process.env.SENTRY_ORG } : {}),
  ...(process.env.SENTRY_PROJECT ? { project: process.env.SENTRY_PROJECT } : {}),
  ...(process.env.SENTRY_AUTH_TOKEN ? { authToken: process.env.SENTRY_AUTH_TOKEN } : {}),
  silent: !uploadsSourceMaps,
  telemetry: false,
  sourcemaps: { disable: !uploadsSourceMaps, deleteSourcemapsAfterUpload: true },
  // Upload problems must never fail a deploy: the app still runs, only stack traces get uglier.
  errorHandler: (error) => {
    console.warn(`Sentry source-map upload skipped: ${error.message}`);
  },
});
