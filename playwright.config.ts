import { defineConfig, devices } from "@playwright/test";

const PORT = 3100;
const baseURL = `http://localhost:${PORT}`;
const isCI = Boolean(process.env.CI);
const PRODUCTION_SPECS = /production\.spec\.ts$/;
const SETUP_SPECS = /\.setup\.ts$/;

/**
 * Flow tests (ARCHITECTURE §15). `pnpm test:e2e` runs them; CI runs them as their own job.
 *
 * One server: `next start` of a fresh production build on its own port (task 1.2; before it,
 * the flow specs ran against `next dev` with a preview-role cookie). Locally the build runs
 * first, so a stale build can never make this pass; CI builds in its own step. The server is
 * never reused, so a lingering `next dev` can't stand in.
 *
 * The local Supabase stack must be up and reset (`pnpm db:start`, `pnpm db:reset`): `setup`
 * signs in as the seeded users through the real form and saves one storage state per role
 * (`e2e/.auth/`, git-ignored) for the `desktop` and `mobile` projects. `production` proves the
 * build is locked down (every shell route redirects to /login, no development shim, the
 * service worker registers).
 */
export default defineConfig({
  testDir: "e2e",
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  // One worker in CI (a 2-core runner); Playwright's default locally.
  ...(isCI ? { workers: 1 } : {}),
  reporter: isCI
    ? [["github"], ["html", { open: "never" }]]
    : [["list"], ["html", { open: "never" }]],
  use: {
    baseURL,
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "setup",
      testMatch: SETUP_SPECS,
      // One sign-in at a time: the three first requests after boot raced once (2026-09-22).
      fullyParallel: false,
      workers: 1,
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "desktop",
      dependencies: ["setup"],
      testIgnore: [PRODUCTION_SPECS, SETUP_SPECS],
      use: { ...devices["Desktop Chrome"] },
    },
    {
      // Staff screens are laid out for 375px first (ARCHITECTURE §3.3).
      name: "mobile",
      dependencies: ["setup"],
      testIgnore: [PRODUCTION_SPECS, SETUP_SPECS],
      use: { ...devices["Pixel 5"], viewport: { width: 375, height: 812 } },
    },
    {
      name: "production",
      testMatch: PRODUCTION_SPECS,
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: isCI ? `pnpm start --port ${PORT}` : `pnpm build && pnpm start --port ${PORT}`,
    url: `${baseURL}/offline`,
    reuseExistingServer: false,
    timeout: 300_000,
  },
});
