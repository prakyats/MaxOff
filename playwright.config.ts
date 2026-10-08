import { generateKeyPairSync } from "node:crypto";

import { defineConfig, devices } from "@playwright/test";

import { HOLD_PROXY_PORT, HOLD_PROXY_URL } from "./e2e/hold-proxy-config";

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
const WORKING_DAY_SPECS = /working-day\.spec\.ts$/;
const LEAVE_SPECS = /leave\.spec\.ts$/;
const BACK_GESTURE_SPECS = /back-gesture\.spec\.ts$/;
const OWNER_REVIEW_SPECS = /owner-review\.spec\.ts$/;
const OWNER_BULK_SPECS = /owner-bulk\.spec\.ts$/;
// The push and email dispatch through the cron route (owner decision 29): the dispatcher is
// organisation-wide and push-quiet moves the organisation's quiet hours, so these run serially,
// one worker, after everything else, owning the queue (push-shared.ts `ownTheDispatchQueue`).
const PUSH_CRON_SPECS = /push-(cron|quiet)\.spec\.ts$/;
const LAUNCH_SPECS = /launch\.spec\.ts$/;
const MOTION_SPECS = /motion\.spec\.ts$/;
const REFRESH_SPECS = /refresh\.spec\.ts$/;
const PRE_HYDRATION_SPECS = /pre-hydration\.spec\.ts$/;
const EDIT_PATTERN_SPECS = /edit-pattern\.spec\.ts$/;
const CUSTOM_FIELDS_SPECS = /custom-fields\.spec\.ts$/;
const STORAGE_SPECS = /storage\.spec\.ts$/;
const CLIENTS_SPECS = /clients\.spec\.ts$/;
const SELECT_SPECS = /select\.spec\.ts$/;
const EXTRA_WORK_SPECS = /extra-work\.spec\.ts$/;
const EXPENSES_SPECS = /expenses\.spec\.ts$/;
const MONTH_SUMMARY_SPECS = /month-summary\.spec\.ts$/;
const TAP_FEEDBACK_SPECS = /tap-feedback\.spec\.ts$/;
const PULL_TO_REFRESH_SPECS = /pull-to-refresh\.spec\.ts$/;
const AUTH_LINK_SPECS = /auth-link\.spec\.ts$/;
const TASKS_SPECS = /tasks\.spec\.ts$/;
const TASK_LISTS_SPECS = /task-lists\.spec\.ts$/;
const FREELANCERS_SPECS = /freelancers\.spec\.ts$/;
const TASK_SETTINGS_SPECS = /task-settings\.spec\.ts$/;
const TASK_REQUESTS_SPECS = /task-requests\.spec\.ts$/;
const LOADING_SCREENS_SPECS = /loading-screens\.spec\.ts$/;
const TASK_PAGE_SPECS = /task-page\.spec\.ts$/;
const PUSH_SPECS = /push\.spec\.ts$/;
const NOTIFICATIONS_SPECS = /notifications\.spec\.ts$/;
const STICKY_ACTIONS_SPECS = /sticky-actions\.spec\.ts$/;
const VIEW_ADDRESS_SPECS = /view-address\.spec\.ts$/;
const REACHABILITY_SPECS = /reachability\.spec\.ts$/;
const ONBOARDING_SPECS = /onboarding\.spec\.ts$/;
const DASHBOARDS_SPECS = /dashboards\.spec\.ts$/;
const CALENDAR_SPECS = /calendar\.spec\.ts$/;
const EOD_REPORT_SPECS = /eod-report\.spec\.ts$/;
const CLIENT_WORK_SPECS = /client-work\.spec\.ts$/;

/**
 * Web Push (5.2): the e2e server sends real, encrypted pushes to a fake push service the spec
 * runs on the loopback host, so it needs a VAPID key pair. A throwaway pair is made here, in
 * memory, for this run alone: never printed, never written, never the owner's (kickoff 5
 * decision 10). The spec reads the public half from `process.env` to verify the signatures.
 */
function throwawayVapid(): { publicKey: string; privateKey: string } {
  const { privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const jwk = privateKey.export({ format: "jwk" }) as { d: string; x: string; y: string };
  const point = Buffer.concat([
    Buffer.from([4]),
    Buffer.from(jwk.x, "base64url"),
    Buffer.from(jwk.y, "base64url"),
  ]);
  return { publicKey: point.toString("base64url"), privateKey: jwk.d };
}
// The config is loaded again in every worker process: the runner's pair is handed to the workers
// through the environment they inherit, so the spec verifies with the key the server signs with.
const VAPID =
  process.env.E2E_VAPID_PUBLIC_KEY && process.env.E2E_VAPID_PRIVATE_KEY
    ? { publicKey: process.env.E2E_VAPID_PUBLIC_KEY, privateKey: process.env.E2E_VAPID_PRIVATE_KEY }
    : throwawayVapid();
process.env.E2E_VAPID_PUBLIC_KEY = VAPID.publicKey;
process.env.E2E_VAPID_PRIVATE_KEY = VAPID.privateKey;

/**
 * Flow tests (ARCHITECTURE §15). `pnpm test:e2e` runs them; CI runs them as their own job.
 *
 * One server: `next start` of a fresh production build on its own port (task 1.2; before it,
 * the flow specs ran against `next dev` with a preview-role cookie). Locally the build runs
 * first, so a stale build can never make this pass; CI builds in its own step. The server is
 * never reused, so a lingering `next dev` can't stand in. It reaches Supabase through the hold
 * proxy (`e2e/hold-proxy.ts`, 4C review M1), started first, so a loading-screen check can hold
 * its own page's reads.
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
      testIgnore: [PRODUCTION_SPECS, SETUP_SPECS, MOBILE_SPECS, OWNER_BULK_SPECS, PUSH_CRON_SPECS],
      use: { ...devices["Desktop Chrome"] },
    },
    {
      // Every screen is laid out for the phone first (ARCHITECTURE §14.1). 375px is the small
      // phone of the two widths the standard is checked at.
      name: "mobile",
      dependencies: ["setup"],
      testIgnore: [PRODUCTION_SPECS, SETUP_SPECS, OWNER_BULK_SPECS, PUSH_CRON_SPECS],
      use: { ...devices["Pixel 5"], viewport: { width: 375, height: 812 } },
    },
    {
      // The large phone. Only `mobile.spec.ts` and the working day run here: the flow specs prove
      // behaviour, which does not change with 55px of width, while the mobile standard is
      // checked at **both** 375px and 430px because that is where a layout stops fitting
      // (§14.1). The Start-day prompt is the first thing every Admin and Staff member meets each
      // morning, on a phone more often than not (2.2, reworked in 3b.1). Own leave (2.3) runs here as an Admin, so the
      // Admin's way in (the card on /today) is covered at a phone width too. The back-gesture
      // spec runs here as well: the installed-app rules are checked at both phone widths, and so
      // does the Owner's review (2.4), whose sheets and dialogs each have a back order. The
      // launch (2.7) too: the intro is drawn for the phone that launched it. And the drill-down
      // slide, per-tab scroll and refresh on return (2.7b), checked at both widths, and taps before
      // hydration (2.8), and the edit pattern's back order (2.9), and the custom fields
      // screen's add sheet and entity tabs (3.2), and the logo and photo upload sheets (3.3), and
      // the client screens' views, menus and sheets (3.4), the select's phone sheet (3B review), and
      // the extra work notes, the Owner's Extra work group and comp leave (3b.2), and the expense
      // claims' and the month summary's layers (3b.3, 3b.4; added at `/review-phase 3b`, which
      // found them checked at 375px only), and the Continue page a one-time link lands on
      // (3cB review), a public page laid out for the phone the link was sent to. And tap feedback
      // and pull-to-refresh (2026-09-28): the pressed, pending, slow and offline states and the
      // pull, at both phone widths; and the task screens' layers and large text (4B; the task
      // flows themselves skip 430px), the task lists' and Approvals' too, and the freelancers'
      // dialogs and screens around People, Settings → Task types, and the task requests and
      // templates (4C). And the held loading screens (4C review M1): they fit at large text and
      // trace their screen at every width. And the reworked task page (Kickoff 4 decisions
      // 26–32): its views, the Chat sheet and every layer on back, and large text, at both widths.
      // And Web Push (5.2): the banner, Me's rows and the deep-link entry's back at both widths.
      // And the bell and Alerts (5.1): the history, its back order and large text at both widths.
      // And the sticky save bar against the last field (v1.3.1): a band that grows under a person
      // at the page's end wraps differently at 430px, so both widths. And a view's address held
      // through a refresh (2026-10-02): the task page's views and a list's filter, at both widths.
      // And onboarding for reachability (5.5): the iPhone's install steps, Me's device list and
      // their layers on back, at both widths. And the day screens (6A): My Day, Today's full board
      // and its filter, and the work report's period, each installed back order at both widths.
      name: "mobile-lg",
      dependencies: ["setup"],
      testMatch: [
        MOBILE_SPECS,
        WORKING_DAY_SPECS,
        LEAVE_SPECS,
        BACK_GESTURE_SPECS,
        OWNER_REVIEW_SPECS,
        LAUNCH_SPECS,
        MOTION_SPECS,
        REFRESH_SPECS,
        PRE_HYDRATION_SPECS,
        EDIT_PATTERN_SPECS,
        CUSTOM_FIELDS_SPECS,
        STORAGE_SPECS,
        CLIENTS_SPECS,
        SELECT_SPECS,
        EXTRA_WORK_SPECS,
        EXPENSES_SPECS,
        MONTH_SUMMARY_SPECS,
        TAP_FEEDBACK_SPECS,
        PULL_TO_REFRESH_SPECS,
        AUTH_LINK_SPECS,
        TASKS_SPECS,
        TASK_LISTS_SPECS,
        FREELANCERS_SPECS,
        TASK_SETTINGS_SPECS,
        TASK_REQUESTS_SPECS,
        LOADING_SCREENS_SPECS,
        TASK_PAGE_SPECS,
        PUSH_SPECS,
        NOTIFICATIONS_SPECS,
        STICKY_ACTIONS_SPECS,
        VIEW_ADDRESS_SPECS,
        REACHABILITY_SPECS,
        ONBOARDING_SPECS,
        DASHBOARDS_SPECS,
        CALENDAR_SPECS,
        EOD_REPORT_SPECS,
        CLIENT_WORK_SPECS,
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
      // The cron dispatch (owner decision 29): after owner-bulk, so after every project that
      // creates rows; one worker, one file at a time, each test one dispatch on a queue it owns.
      // CI runs it alone after owner-bulk with `--no-deps` (ci.yml), like owner-bulk.
      name: "push-cron",
      dependencies: ["owner-bulk"],
      testMatch: PUSH_CRON_SPECS,
      fullyParallel: false,
      workers: 1,
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "production",
      testMatch: PRODUCTION_SPECS,
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: [
    {
      // The e2e server reaches Supabase through a pass-through proxy (4C review M1,
      // `e2e/hold-proxy.ts`): a loading-screen check holds its own session's page reads there, so
      // the page cannot answer before its loading screen streams. Started first; the build and
      // the server below point `NEXT_PUBLIC_SUPABASE_URL` at it (CI's build step too, ci.yml).
      // The Playwright process keeps talking to Supabase directly.
      // Node strips the types; the file is an ES module in a package without "type".
      command: "node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON e2e/hold-proxy.ts",
      url: `${HOLD_PROXY_URL}/__hold/health`,
      reuseExistingServer: false,
      env: {
        HOLD_PROXY_PORT: String(HOLD_PROXY_PORT),
        HOLD_PROXY_UPSTREAM: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
      },
    },
    {
      command: isCI ? `pnpm start --port ${PORT}` : `pnpm build && pnpm start --port ${PORT}`,
      url: `${baseURL}/offline`,
      reuseExistingServer: false,
      timeout: 300_000,
      env: {
        NEXT_PUBLIC_SUPABASE_URL: HOLD_PROXY_URL,
        // File storage (3.3): every e2e run uploads to the local MinIO (`pnpm storage:start`,
        // docker-compose.storage.yml); these are its throwaway values, the same as .env.example.
        S3_ENDPOINT: process.env.S3_ENDPOINT ?? "http://127.0.0.1:9000",
        S3_BUCKET: process.env.S3_BUCKET ?? "maxoff",
        S3_ACCESS_KEY_ID: process.env.S3_ACCESS_KEY_ID ?? "maxoff",
        S3_SECRET_ACCESS_KEY: process.env.S3_SECRET_ACCESS_KEY ?? "maxoff-local-secret",
        S3_REGION: process.env.S3_REGION ?? "auto",
        // The cron routes are exercised with a fixed test secret (storage.spec.ts, push.spec.ts).
        CRON_SECRET: process.env.CRON_SECRET ?? "e2e-only-cron-secret-not-used-anywhere-else",
        // Web Push (5.2): this run's throwaway key pair (above).
        VAPID_PUBLIC_KEY: VAPID.publicKey,
        VAPID_PRIVATE_KEY: VAPID.privateKey,
        VAPID_SUBJECT: "mailto:e2e@maxoff.local",
        // The fake push services the specs run are plain http on the loopback host: the sender
        // refuses those everywhere but here (5A review M2; never honoured in staging/production).
        PUSH_ALLOW_LOOPBACK_ENDPOINTS: "1",
      },
    },
  ],
});
