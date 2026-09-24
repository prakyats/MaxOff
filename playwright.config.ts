import { defineConfig, devices } from "@playwright/test";

const PORT = 3100;
const baseURL = `http://localhost:${PORT}`;
const isCI = Boolean(process.env.CI);

// The team spec talks to the local GoTrue directly (a deactivated person's refresh token must
// be refused), so it needs the Supabase URL and publishable key. `next start` reads them from
// `.env.local` itself; the Playwright process gets them here. CI exports them instead.
try {
  process.loadEnvFile(".env.local");
} catch {
  // No .env.local (CI): the variables are already in the environment.
}
const PRODUCTION_SPECS = /production\.spec\.ts$/;
const SETUP_SPECS = /\.setup\.ts$/;
const MOBILE_SPECS = /mobile\.spec\.ts$/;
const DAY_GATE_SPECS = /day-gate\.spec\.ts$/;

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
      // The mobile standard is about phone widths; running it at 1280px proves nothing.
      testIgnore: [PRODUCTION_SPECS, SETUP_SPECS, MOBILE_SPECS],
      use: { ...devices["Desktop Chrome"] },
    },
    {
      // Every screen is laid out for the phone first (ARCHITECTURE §14.1). 375px is the small
      // phone of the two widths the standard is checked at.
      name: "mobile",
      dependencies: ["setup"],
      testIgnore: [PRODUCTION_SPECS, SETUP_SPECS],
      use: { ...devices["Pixel 5"], viewport: { width: 375, height: 812 } },
    },
    {
      // The large phone. Only `mobile.spec.ts` and the day gate run here: the flow specs prove
      // behaviour, which does not change with 55px of width, while the mobile standard is
      // checked at **both** 375px and 430px because that is where a layout stops fitting
      // (§14.1). The gate is the first screen every Admin and Staff member sees each morning,
      // on a phone more often than not (2.2).
      name: "mobile-lg",
      dependencies: ["setup"],
      testMatch: [MOBILE_SPECS, DAY_GATE_SPECS],
      use: { ...devices["Pixel 5"], viewport: { width: 430, height: 932 } },
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
    // The day gate's pass cookie (2.2) is exercised end to end with a fixed test secret; the
    // no-secret path (touch on every page load) is the same database call without the cookie.
    env: {
      DAY_GATE_COOKIE_SECRET:
        process.env.DAY_GATE_COOKIE_SECRET ?? "e2e-only-day-gate-secret-not-used-anywhere-else",
    },
  },
});
