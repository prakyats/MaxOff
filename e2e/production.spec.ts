import { expect, test } from "@playwright/test";

/**
 * Runs against `next start` (the `production` project in playwright.config.ts), so it checks
 * the real build artifact, not `next dev`.
 *
 * Until task 1.2 the signed-in area exists only through the development-only preview-role
 * shim and the `/dev/ui` gallery. Both are allow-listed to `development` / `test`, so a
 * production build must answer 404 for every shell route and never show a preview member.
 * 1.2 replaces the 404 expectation with a redirect to /login; keep the "no preview" checks.
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

/** Mirrors SECURITY_HEADERS in next.config.ts; a change there must be made here on purpose. */
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
    test(`${route} is unreachable (404, no preview member)`, async ({ request }) => {
      const response = await request.get(route, { maxRedirects: 0 });
      expect(response.status(), route).toBe(404);
      const body = await response.text();
      expect(body, route).not.toContain("Preview CEO");
      expect(body, route).not.toContain("Preview Admin");
      expect(body, route).not.toContain("Preview Staff");
      expect(body, route).not.toContain("UI gallery");
    });
  }

  test("/ shows the landing page and does not redirect into the shell", async ({ request }) => {
    const response = await request.get("/", { maxRedirects: 0 });
    expect(response.status()).toBe(200);
    expect(await response.text()).not.toContain("Preview CEO");
  });

  test("a preview-role cookie is ignored", async ({ request }) => {
    const response = await request.get("/today", {
      maxRedirects: 0,
      headers: { cookie: "maxoff-preview-role=ceo" },
    });
    expect(response.status()).toBe(404);
  });

  test("serves the offline page when the network is gone", async ({ page, context }) => {
    await page.goto("/offline");
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.reload();
    await context.setOffline(true);
    await page.goto("/today");
    await expect(page).toHaveTitle(/Offline/);
    // Next's route announcer is a second role=alert, so target the composite itself.
    await expect(page.locator('[data-slot="error-state"]')).toContainText("offline");
  });
});
