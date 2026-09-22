import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";
import { withSentryConfig } from "@sentry/nextjs/config";
import type { NextConfig } from "next";

import { assertObservabilityEnv } from "./src/core/observability/env";

// Lets `next dev` reach Cloudflare bindings through `getCloudflareContext()` (none are used
// before task 3.3). A no-op outside `next dev`.
initOpenNextCloudflareForDev();

// A malformed NEXT_PUBLIC_APP_ENV or NEXT_PUBLIC_SENTRY_DSN fails the build here, so a typo in
// a GitHub environment variable can never reach the Worker (the runtime reader degrades to
// "Sentry off" as a second net).
assertObservabilityEnv();

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // `next dev` otherwise appends its own block to CLAUDE.md on every run.
  // CLAUDE.md is hand-written project memory, so we keep Next out of it.
  // Next 16's own guidance lives in `node_modules/next/dist/docs/`.
  agentRules: false,
  // The dev-tools button otherwise sits on the sidebar footer (bottom-left) and hides the
  // development-only role switcher.
  devIndicators: { position: "bottom-right" },
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
