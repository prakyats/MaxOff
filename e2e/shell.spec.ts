import { expect, test, type Page } from "@playwright/test";

/**
 * The 0.3 shell, previewed through the development-only role cookie. Task 1.2 replaces
 * `previewAs()` with a real sign-in helper and seeded users; the assertions stay.
 */
const PREVIEW_ROLE_COOKIE = "maxoff-preview-role";

// `next dev` mounts its dev-tools button in a <nextjs-portal>; on a phone it covers the Staff
// "Me" tab and intercepts taps. Hidden here until 1.2 runs the tests against `next start`.
test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => {
    const style = document.createElement("style");
    style.textContent = "nextjs-portal { display: none !important; }";
    document.addEventListener("DOMContentLoaded", () => document.head.append(style));
  });
});

async function previewAs(page: Page, baseURL: string | undefined, role: "ceo" | "admin" | "staff") {
  if (!baseURL) throw new Error("playwright.config.ts must set use.baseURL");
  await page.context().addCookies([{ name: PREVIEW_ROLE_COOKIE, value: role, url: baseURL }]);
}

test("an unknown route shows the 404 page", async ({ page }) => {
  const response = await page.goto("/this-route-does-not-exist");
  expect(response?.status()).toBe(404);
  // Next's route announcer is a second role=alert, so target the composite itself.
  await expect(page.locator('[data-slot="error-state"]')).toContainText("Page not found");
  await expect(page.getByRole("link", { name: "Go home" })).toBeVisible();
});

test.describe("CEO on desktop", () => {
  test.skip(({ isMobile }) => Boolean(isMobile), "sidebar is desktop-only");

  test("lands on Today and navigates through the sidebar", async ({ page, baseURL }) => {
    await previewAs(page, baseURL, "ceo");
    await page.goto("/");
    await expect(page).toHaveURL(/\/today$/);

    const sidebar = page.locator("[data-slot='sidebar']");
    await expect(sidebar).toBeVisible();
    for (const label of [
      "Today",
      "Calendar",
      "People",
      "Tasks",
      "Clients",
      "Approvals",
      "Reports",
      "Settings",
    ]) {
      await expect(sidebar.getByRole("link", { name: label })).toBeVisible();
    }

    await sidebar.getByRole("link", { name: "Clients" }).click();
    await expect(page).toHaveURL(/\/clients$/);
    await expect(page.getByRole("heading", { name: "Clients", exact: true })).toBeVisible();
    await expect(sidebar.getByRole("link", { name: "Clients" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  test("the theme toggle switches to dark and back", async ({ page, baseURL }) => {
    await previewAs(page, baseURL, "ceo");
    await page.goto("/today");
    const html = page.locator("html");

    await page.getByRole("button", { name: "Change theme" }).click();
    await page.getByRole("menuitemradio", { name: "Dark" }).click();
    await expect(html).toHaveClass(/\bdark\b/);

    await page.getByRole("button", { name: "Change theme" }).click();
    await page.getByRole("menuitemradio", { name: "Light" }).click();
    await expect(html).not.toHaveClass(/\bdark\b/);
  });
});

test.describe("Staff on a phone", () => {
  test.skip(({ isMobile }) => !isMobile, "bottom nav is phone-only");

  test("lands on My Day and uses the bottom nav", async ({ page, baseURL }) => {
    await previewAs(page, baseURL, "staff");
    await page.goto("/");
    await expect(page).toHaveURL(/\/my-day$/);

    await expect(page.locator("[data-slot='sidebar']")).toBeHidden();
    const nav = page.locator("[data-slot='bottom-nav']");
    await expect(nav).toBeVisible();
    for (const label of ["My Day", "Tasks", "Calendar", "Alerts", "Me"]) {
      await expect(nav.getByRole("link", { name: label })).toBeVisible();
    }

    await nav.getByRole("link", { name: "Me" }).click();
    await expect(page).toHaveURL(/\/me$/);
    await expect(nav.getByRole("link", { name: "Me" })).toHaveAttribute("aria-current", "page");
  });
});
