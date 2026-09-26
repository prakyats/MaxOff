import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";
import { withSentryConfig } from "@sentry/nextjs/config";
import type { NextConfig } from "next";

import { responseHeaders } from "./src/core/http/response-headers";
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
  headers: async () => [{ source: "/:path*", headers: RESPONSE_HEADERS }],
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
