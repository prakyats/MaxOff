import type { Page } from "@playwright/test";

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

  test("/api/health reaches the database and answers ok, uncached (3c.1)", async ({ request }) => {
    const response = await request.get("/api/health", { maxRedirects: 0 });
    expect(response.status()).toBe(200);
    expect(await response.text()).toBe("ok");
    expect(response.headers()["cache-control"]).toBe("no-store");
  });

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
    await underWorker(page);
    await context.setOffline(true);
    await page.goto("/login");
    await expect(page).toHaveTitle(/Offline/);
    // Next's route announcer is a second role=alert, so target the composite itself.
    await expect(page.locator('[data-slot="error-state"]')).toContainText("offline");
  });

  test("a navigation that fails once is tried again: a network switch never shows the page", async ({
    page,
    context,
  }) => {
    await underWorker(page);
    let failed = 0;
    await context.route(isLoginPage, (route) => {
      if (failed > 0) return route.fallback();
      failed++;
      return route.abort("internetdisconnected");
    });
    await page.goto("/login");
    await expect(page).toHaveTitle(/Sign in/);
    expect(failed, "the first try failed and the worker tried again").toBe(1);
  });

  test("back online, the offline page reloads its address by itself, adding no history", async ({
    page,
    context,
    reloadGuard,
  }) => {
    // The offline page's own reload of the address that failed is what this test proves.
    reloadGuard.allow(/\/login$/);
    await underWorker(page);
    await context.setOffline(true);
    await page.goto("/login");
    await expect(page).toHaveTitle(/Offline/);
    const entries = await page.evaluate(() => history.length);
    await context.setOffline(false);
    await expect(page).toHaveTitle(/Sign in/);
    await expect(page).toHaveURL(/\/login$/);
    expect(await page.evaluate(() => history.length)).toBe(entries);
  });

  test("Try again reloads the address that failed, adding no history", async ({
    page,
    context,
    reloadGuard,
  }) => {
    // Try again reloads the address that failed: the document load this test proves.
    reloadGuard.allow(/\/login$/);
    await underWorker(page);
    // The device still says it is online (a network switch, a dead Wi-Fi): only the server
    // cannot be reached, so no `online` event comes and the button is the way back.
    await context.route(isLoginPage, (route) => route.abort("internetdisconnected"));
    await page.goto("/login");
    await expect(page).toHaveTitle(/Offline/);
    const entries = await page.evaluate(() => history.length);
    await context.unroute(isLoginPage);
    await page.getByRole("button", { name: "Try again" }).click();
    await expect(page).toHaveTitle(/Sign in/);
    await expect(page).toHaveURL(/\/login$/);
    expect(await page.evaluate(() => history.length)).toBe(entries);
  });
});

/** The sign-in page's own document, wherever it is fetched from (the page or the worker). */
const isLoginPage = (url: URL) => url.pathname === "/login" && !url.searchParams.has("_rsc");

/**
 * The page is controlled by the service worker. `ready` says the worker is active, not that it
 * controls *this* page: a page loaded before activation is claimed asynchronously
 * (`clients.claim()`), and a navigation made before that goes to the network. The failure seen
 * in 2.3/2.6 was exactly that: the offline navigation answered by the server ("Sign in ·
 * MaxOff"). So wait for the state itself.
 */
async function underWorker(page: Page) {
  await page.goto("/offline");
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
}
