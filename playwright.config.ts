import { defineConfig, devices } from "@playwright/test";

const DEV_PORT = 3000;
const PROD_PORT = 3100;
const devURL = `http://localhost:${DEV_PORT}`;
const prodURL = `http://localhost:${PROD_PORT}`;
const isCI = Boolean(process.env.CI);
const PRODUCTION_SPECS = /production\.spec\.ts$/;

/**
 * Flow tests (ARCHITECTURE §15). `pnpm test:e2e` runs them; CI runs them as their own job.
 *
 * Two servers:
 * - `desktop` and `mobile` run the flow specs against `next dev`: the shell is previewed
 *   through the development-only role cookie (`src/core/ui/shell/preview-role.ts`), which a
 *   production build cannot honour. Task 1.2 switches these to `pnpm start` with seeded users.
 * - `production` runs `e2e/production.spec.ts` against `next start` on its own port: it proves
 *   the development-only shims are unreachable in a real build and that the service worker
 *   registers. Locally it builds first (a stale build must never make this pass); CI builds in
 *   its own step. It never reuses a running server, so a lingering `next dev` can't stand in.
 */
export default defineConfig({
  testDir: "e2e",
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  // One worker in CI (a single dev server on a 2-core runner); Playwright's default locally.
  ...(isCI ? { workers: 1 } : {}),
  reporter: isCI
    ? [["github"], ["html", { open: "never" }]]
    : [["list"], ["html", { open: "never" }]],
  use: {
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "desktop",
      testIgnore: PRODUCTION_SPECS,
      use: { ...devices["Desktop Chrome"], baseURL: devURL },
    },
    {
      // Staff screens are laid out for 375px first (ARCHITECTURE §3.3).
      name: "mobile",
      testIgnore: PRODUCTION_SPECS,
      use: { ...devices["Pixel 5"], viewport: { width: 375, height: 812 }, baseURL: devURL },
    },
    {
      name: "production",
      testMatch: PRODUCTION_SPECS,
      use: { ...devices["Desktop Chrome"], baseURL: prodURL },
    },
  ],
  webServer: [
    {
      command: `pnpm dev --port ${DEV_PORT}`,
      url: devURL,
      // Next 16 runs one dev server per project, so a developer's own `pnpm dev` is reused.
      reuseExistingServer: !isCI,
      timeout: 120_000,
    },
    {
      command: isCI
        ? `pnpm start --port ${PROD_PORT}`
        : `pnpm build && pnpm start --port ${PROD_PORT}`,
      url: `${prodURL}/offline`,
      reuseExistingServer: false,
      timeout: 300_000,
    },
  ],
});
