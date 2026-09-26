import { expect, test } from "./fixtures";

import { storageStateFor } from "./helpers";

/**
 * The 0.3 shell, seen through the real sessions `auth.setup.ts` saved for each seeded role
 * (task 1.2 replaced the development-only preview cookie).
 */

test.describe("Owner on desktop", () => {
  test.skip(({ isMobile }) => Boolean(isMobile), "sidebar is desktop-only");
  test.use({ storageState: storageStateFor("owner") });

  test("an unknown route shows the 404 page", async ({ page }) => {
    const response = await page.goto("/this-route-does-not-exist");
    expect(response?.status()).toBe(404);
    // Next's route announcer is a second role=alert, so target the composite itself.
    await expect(page.locator('[data-slot="error-state"]')).toContainText("Page not found");
    await expect(page.getByRole("link", { name: "Go home" })).toBeVisible();
  });

  test("lands on Today and navigates through the sidebar", async ({ page }) => {
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

  test("the theme toggle switches to dark and back", async ({ page }) => {
    await page.goto("/today");
    const html = page.locator("html");

    await page.getByRole("button", { name: "Change theme" }).click();
    await page.getByRole("menuitemradio", { name: "Dark" }).click();
    await expect(html).toHaveClass(/\bdark\b/);

    await page.getByRole("button", { name: "Change theme" }).click();
    await page.getByRole("menuitemradio", { name: "Light" }).click();
    await expect(html).not.toHaveClass(/\bdark\b/);
  });

  test("the account menu names the member and offers Log out", async ({ page }) => {
    await page.goto("/today");
    await page.getByRole("button", { name: "Account menu" }).click();
    await expect(page.getByRole("menu")).toContainText("Prishit Shetty");
    await expect(page.getByRole("menuitem", { name: "Log out" })).toBeVisible();
    await page.keyboard.press("Escape");
  });
});

test.describe("permission guards", () => {
  test.skip(({ isMobile }) => Boolean(isMobile), "the same on every viewport");

  test.describe("as Staff", () => {
    test.use({ storageState: storageStateFor("staff") });

    test("Staff are sent to No access from management routes", async ({ page }) => {
      for (const path of ["/clients", "/people", "/approvals", "/reports", "/settings"]) {
        await page.goto(path);
        await expect(page, `${path} for Staff`).toHaveURL(/\/forbidden$/);
        await expect(page.locator('[data-slot="error-state"]')).toContainText(
          "You can't open this",
        );
      }
      await page.goto("/tasks");
      await expect(page.getByRole("heading", { name: "Tasks", exact: true })).toBeVisible();
    });
  });

  test.describe("as an Admin", () => {
    test.use({ storageState: storageStateFor("admin") });

    test("an Admin opens the routes their keys allow", async ({ page }) => {
      for (const [path, heading] of [
        ["/people", "People"],
        ["/clients", "Clients"],
        ["/approvals", "Approvals"],
        ["/reports", "Reports"],
        ["/settings", "Settings"],
      ] as const) {
        await page.goto(path);
        await expect(page, `${path} for an Admin`).toHaveURL(new RegExp(`${path}$`));
        await expect(page.getByRole("heading", { name: heading, exact: true })).toBeVisible();
      }
    });
  });
});

test.describe("Staff on a phone", () => {
  test.skip(({ isMobile }) => !isMobile, "bottom nav is phone-only");
  test.use({ storageState: storageStateFor("staff") });

  test("lands on My Day and uses the bottom nav", async ({ page }) => {
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
    await expect(page.getByText("staff@maxoff.local")).toBeVisible();
  });
});
