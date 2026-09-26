import { expect, test } from "./fixtures";

/**
 * Runs against `next start` (the `production` project in playwright.config.ts), so it checks
 * the real build artifact, not `next dev`.
 *
 * Signed out, every shell route must redirect to /login (task 1.2) and nothing may show the
 * development-only preview member or UI gallery that tasks 0.3 to 1.1 had: those were deleted
 * in 1.2 and these checks make sure they stay gone.
 */
const SHELL_ROUTES = [
  "/today",
  "/my-day",
  "/settings",
  "/dev/ui",
  "/me",
  "/approvals",
  "/clients",
  "/people",
  "/reports",
  "/tasks",
  "/calendar",
  "/notifications",
  "/forbidden",
];

/** Mirrors SECURITY_HEADERS in core/http/response-headers.ts; change both on purpose. */
const SECURITY_HEADERS: Record<string, string> = {
  "x-frame-options": "DENY",
  "content-security-policy": "frame-ancestors 'none'",
  "x-content-type-options": "nosniff",
  "referrer-policy": "strict-origin-when-cross-origin",
  "permissions-policy": "camera=(), microphone=(), geolocation=()",
  "strict-transport-security": "max-age=63072000; includeSubDomains",
};

test.describe("production build", () => {
  for (const route of ["/", "/offline", "/today"]) {
    test(`${route} carries the security headers`, async ({ request }) => {
      const response = await request.get(route, { maxRedirects: 0 });
      const headers = response.headers();
      for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
        expect(headers[name], `${route} ${name}`).toBe(value);
      }
    });
  }

  test("is a production build: the service worker registers", async ({ page }) => {
    await page.goto("/offline");
    // Registration happens only when NODE_ENV is `production` (should-register.ts), so this
    // doubles as proof that the server under test is not a lingering `next dev`.
    const registration = await page.evaluate(async () => {
      const ready = await navigator.serviceWorker.ready;
      return { scope: ready.scope, active: Boolean(ready.active) };
    });
    expect(registration.active).toBe(true);
    expect(registration.scope).toMatch(/\/$/);
  });

  for (const route of SHELL_ROUTES) {
    test(`${route} redirects to sign in (no preview member, no gallery)`, async ({ request }) => {
      const response = await request.get(route, { maxRedirects: 0 });
      expect(response.status(), route).toBe(307);
      const location = response.headers().location ?? "";
      expect(location, route).toMatch(/\/login\?next=/);
      const body = await response.text();
      expect(body, route).not.toContain("Preview Owner");
      expect(body, route).not.toContain("Preview Admin");
      expect(body, route).not.toContain("Preview Staff");
      expect(body, route).not.toContain("UI gallery");
    });
  }

  test("/ sends a signed-out visitor to sign in", async ({ request }) => {
    const response = await request.get("/", { maxRedirects: 0 });
    expect(response.status()).toBe(307);
    expect(response.headers().location).toMatch(/\/login$/);
  });

  test("/login renders without a session and carries no preview member", async ({ request }) => {
    const response = await request.get("/login", { maxRedirects: 0 });
    expect(response.status()).toBe(200);
    const body = await response.text();
    expect(body).toContain("Sign in");
    expect(body).not.toContain("Preview Owner");
    expect(body).not.toContain("UI gallery");
  });

  test("is indexable-by-choice outside staging: no X-Robots-Tag, no robots.txt", async ({
    request,
  }) => {
    // This build has NEXT_PUBLIC_APP_ENV unset (local); staging adds both (core/http).
    for (const route of ["/", "/offline", "/today"]) {
      const response = await request.get(route, { maxRedirects: 0 });
      expect(response.headers()["x-robots-tag"], route).toBeUndefined();
    }
    const robots = await request.get("/robots.txt", { maxRedirects: 0 });
    expect(robots.status()).toBe(404);
    expect(await robots.text()).not.toContain("Disallow");
  });

  test("the Sentry diagnostic route exists only on staging builds", async ({ request }) => {
    // This build has NEXT_PUBLIC_APP_ENV unset (local), so the route must be a plain 404.
    const response = await request.get("/diagnostics/sentry", { maxRedirects: 0 });
    expect(response.status()).toBe(404);
    expect(await response.text()).not.toContain("Sentry diagnostic");
  });

  test("the old preview-role cookie opens nothing", async ({ request }) => {
    const response = await request.get("/today", {
      maxRedirects: 0,
      headers: { cookie: "maxoff-preview-role=owner" },
    });
    expect(response.status()).toBe(307);
    expect(response.headers().location).toMatch(/\/login\?next=/);
  });

  test("serves the offline page when the network is gone", async ({ page, context }) => {
    await page.goto("/offline");
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.reload();
    // `ready` says the worker is active, not that it controls *this* page: a page loaded before
    // activation is claimed asynchronously (`clients.claim()`), and a navigation made before
    // that goes to the network. The failure seen in 2.3/2.6 was exactly that: the offline
    // navigation answered by the server ("Sign in · MaxOff"). Wait for the state itself.
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
    await context.setOffline(true);
    await page.goto("/login");
    await expect(page).toHaveTitle(/Offline/);
    // Next's route announcer is a second role=alert, so target the composite itself.
    await expect(page.locator('[data-slot="error-state"]')).toContainText("offline");
  });
});
