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
const LEAVE_SPECS = /leave\.spec\.ts$/;
const BACK_GESTURE_SPECS = /back-gesture\.spec\.ts$/;
const OWNER_REVIEW_SPECS = /owner-review\.spec\.ts$/;
const OWNER_BULK_SPECS = /owner-bulk\.spec\.ts$/;
const LAUNCH_SPECS = /launch\.spec\.ts$/;
const MOTION_SPECS = /motion\.spec\.ts$/;
const REFRESH_SPECS = /refresh\.spec\.ts$/;
const PRE_HYDRATION_SPECS = /pre-hydration\.spec\.ts$/;
const EDIT_PATTERN_SPECS = /edit-pattern\.spec\.ts$/;

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
  // Before the build and every project: the stack is ready and the IST date is noted (2.6).
  globalSetup: "./e2e/global-setup.ts",
  globalTeardown: "./e2e/global-teardown.ts",
  fullyParallel: true,
  forbidOnly: isCI,
  // No retries anywhere (2.6, owner decision 2026-09-24): a red run has to mean something, and a
  // retry is how a flake becomes folklore. Proved: five full runs in a row after one db:reset.
  retries: 0,
  // One worker in CI (a 2-core runner). Four locally (owner decision 2026-09-25): Playwright's
  // default of half the cores put eight Chromiums beside a 7.5 GB Docker VM on a 16 GB laptop,
  // and the resulting memory pressure stalled the whole machine for seconds at a time (a
  // sign-in whose GoTrue grant took 3.4 s against a 0.2 s mean). A resource setting, not an
  // allowance. Three since 2026-09-26 (owner decision): at four, local full runs showed
  // server actions stalled 6 s, a bcrypt hash at 2 s, host memory down to 965 MB and Windows
  // twice failing to start a process (PROGRESS). CI's clean runner is the authoritative proof.
  workers: isCI ? 1 : 3,
  reporter: isCI
    ? [["github"], ["html", { open: "never" }]]
    : [["list"], ["html", { open: "never" }]],
  use: {
    baseURL,
    // A red run is diagnosable without re-running it (2.6, owner decision 2026-09-24).
    trace: "retain-on-failure",
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
      testIgnore: [PRODUCTION_SPECS, SETUP_SPECS, MOBILE_SPECS, OWNER_BULK_SPECS],
      use: { ...devices["Desktop Chrome"] },
    },
    {
      // Every screen is laid out for the phone first (ARCHITECTURE §14.1). 375px is the small
      // phone of the two widths the standard is checked at.
      name: "mobile",
      dependencies: ["setup"],
      testIgnore: [PRODUCTION_SPECS, SETUP_SPECS, OWNER_BULK_SPECS],
      use: { ...devices["Pixel 5"], viewport: { width: 375, height: 812 } },
    },
    {
      // The large phone. Only `mobile.spec.ts` and the day gate run here: the flow specs prove
      // behaviour, which does not change with 55px of width, while the mobile standard is
      // checked at **both** 375px and 430px because that is where a layout stops fitting
      // (§14.1). The gate is the first screen every Admin and Staff member sees each morning,
      // on a phone more often than not (2.2). Own leave (2.3) runs here as an Admin, so the
      // Admin's way in (the card on /today) is covered at a phone width too. The back-gesture
      // spec runs here as well: the installed-app rules are checked at both phone widths, and so
      // does the Owner's review (2.4), whose sheets and dialogs each have a back order. The
      // launch (2.7) too: the intro is drawn for the phone that launched it. And the drill-down
      // slide, per-tab scroll and refresh on return (2.7b), checked at both widths, and taps before
      // hydration (2.8), and the edit pattern's back order (2.9).
      name: "mobile-lg",
      dependencies: ["setup"],
      testMatch: [
        MOBILE_SPECS,
        DAY_GATE_SPECS,
        LEAVE_SPECS,
        BACK_GESTURE_SPECS,
        OWNER_REVIEW_SPECS,
        LAUNCH_SPECS,
        MOTION_SPECS,
        REFRESH_SPECS,
        PRE_HYDRATION_SPECS,
        EDIT_PATTERN_SPECS,
      ],
      use: { ...devices["Pixel 5"], viewport: { width: 430, height: 932 } },
    },
    {
      // "Approve all" (2.4) acts on every waiting row, other specs' included, so it runs alone,
      // after every project that creates rows has finished.
      name: "owner-bulk",
      dependencies: ["desktop", "mobile", "mobile-lg"],
      testMatch: OWNER_BULK_SPECS,
      use: { ...devices["Desktop Chrome"] },
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
