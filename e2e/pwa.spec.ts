import { expect, test } from "@playwright/test";

/**
 * PWA shell (task 0.5). The service worker itself is registered only in production builds
 * (`e2e/production.spec.ts` covers registration and the offline fallback), so these checks
 * cover what `next dev` can serve: the manifest, the icons, the worker file and the offline
 * page. Installability is verified by hand on the staging URL.
 */
test.describe("PWA shell", () => {
  test("serves the manifest and every icon it names", async ({ request }) => {
    const response = await request.get("/manifest.webmanifest");
    expect(response.ok()).toBeTruthy();
    const manifest = (await response.json()) as {
      start_url: string;
      display: string;
      icons: Array<{ src: string }>;
    };
    expect(manifest.start_url).toBe("/");
    expect(manifest.display).toBe("standalone");
    for (const icon of manifest.icons) {
      const iconResponse = await request.get(icon.src);
      expect(iconResponse.ok(), icon.src).toBeTruthy();
    }
  });

  test("serves the service worker as JavaScript", async ({ request }) => {
    const response = await request.get("/sw.js");
    expect(response.ok()).toBeTruthy();
    expect(response.headers()["content-type"]).toMatch(/javascript/);
  });

  test("links the manifest and the apple icon from every page", async ({ page }) => {
    await page.goto("/offline");
    await expect(page.locator('link[rel="manifest"]')).toHaveAttribute(
      "href",
      "/manifest.webmanifest",
    );
    await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute(
      "href",
      "/icons/apple-touch-icon.png",
    );
  });

  test("the offline page renders with a way back", async ({ page }) => {
    await page.goto("/offline");
    // Next's route announcer is a second role=alert, so target the composite itself.
    await expect(page.locator('[data-slot="error-state"]')).toContainText("offline");
    await expect(page.getByRole("link", { name: "Try again" })).toBeVisible();
  });
});
