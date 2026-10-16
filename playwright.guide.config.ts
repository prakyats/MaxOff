import { defineConfig, devices } from "@playwright/test";

import base from "./playwright.config";

/**
 * `pnpm guide:screenshots` (ROADMAP 6b.14, Release 2): the in-app guide's pictures, made from the
 * local seeded database by `e2e/guide-screenshots.ts`. A config of its own, so `pnpm test:e2e`
 * and CI (which shard `playwright.config.ts`'s projects, tests/ci-shards.test.ts) never run it.
 *
 * The same two servers as the flow tests (the hold proxy, then a fresh `next build` + `next start`
 * against the local stack), so the pictures show what this commit builds. `GUIDE_REUSE_SERVER=1`
 * reuses servers already running on those ports (re-running after a fix, the build unchanged).
 */
const LOCAL = /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?(\/|$)/;
if (!LOCAL.test(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "")) {
  throw new Error(
    "guide:screenshots runs on the local stack only: NEXT_PUBLIC_SUPABASE_URL must be 127.0.0.1 or localhost (.env.local).",
  );
}

const reuse = process.env.GUIDE_REUSE_SERVER === "1";
const servers = Array.isArray(base.webServer) ? base.webServer : [];

export default defineConfig({
  testDir: "e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  // Five dozen screens, each opened, settled and encoded: one long test per role.
  timeout: 20 * 60_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL: base.use?.baseURL,
    trace: "retain-on-failure",
    // A picture whose element is missing fails alone, quickly, and the run goes on.
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },
  projects: [
    {
      name: "guide-screenshots",
      testMatch: /guide-screenshots\.ts$/,
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 900 },
        deviceScaleFactor: 2,
        colorScheme: "light",
      },
    },
  ],
  webServer: servers.map((server) => ({ ...server, reuseExistingServer: reuse })),
});
