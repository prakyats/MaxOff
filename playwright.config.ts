import { defineConfig, devices } from "@playwright/test";

const PORT = 3000;
const baseURL = `http://localhost:${PORT}`;
const isCI = Boolean(process.env.CI);

/**
 * Flow tests (ARCHITECTURE §15). `pnpm test:e2e` runs them; CI runs them as their own job.
 *
 * The server is `next dev` for now: the shell is previewed through the development-only role
 * cookie (`src/core/ui/shell/preview-role.ts`), which `next start` cannot honour because a
 * production build pins NODE_ENV to `production`. Task 1.2 switches this to `pnpm start`
 * with seeded users once real sign-in exists (PROGRESS.md).
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
    baseURL,
    trace: "on-first-retry",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    {
      // Staff screens are laid out for 375px first (ARCHITECTURE §3.3).
      name: "mobile",
      use: { ...devices["Pixel 5"], viewport: { width: 375, height: 812 } },
    },
  ],
  webServer: {
    command: `pnpm dev --port ${PORT}`,
    url: baseURL,
    // Next 16 runs one dev server per project, so a developer's own `pnpm dev` is reused.
    reuseExistingServer: !isCI,
    timeout: 120_000,
  },
});
