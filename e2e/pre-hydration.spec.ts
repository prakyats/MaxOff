import { type Page } from "@playwright/test";

import { expect, test } from "./fixtures";

import { pageHeader, runInstalled, storageStateFor } from "./helpers";

/**
 * Taps before hydration (ARCHITECTURE §14.2 l, task 2.8). Until React hydrates, the back
 * control, view controls and installed tabs are plain links; the inline pre-hydration script
 * gives them the app's own moves so a fast tap on a slow phone never stacks history (the 2.7b
 * finding: the ‹ back went forward to the parent).
 *
 * Hydration is held off for good by never answering the page's script chunks, so every tap here
 * is guaranteed to land before hydration, on every document the test opens. `history.length`
 * tells a push (it grows) from a replace or a back (it does not). History moves wait for the
 * commit only: with the scripts held, `load` never fires.
 */
async function holdHydration(page: Page) {
  await page.route(/\/_next\/static\/chunks\/.+\.js/, () => {
    // Never answered: the app cannot hydrate.
  });
}

async function open(page: Page, path: string) {
  await page.goto(path, { waitUntil: "commit" });
  await expect(pageHeader(page)).toBeVisible();
  await expect(page.locator("html")).not.toHaveAttribute("data-chrome");
}

const historyLength = (page: Page) => page.evaluate(() => history.length);
const backControl = (page: Page) => page.locator('[data-slot="page-back"]:visible');
const tab = (page: Page, href: string) =>
  page.locator(`[data-slot="bottom-nav"] a[href="${href}"]`);

test.describe("before hydration, installed at phone width", () => {
  test.use({ storageState: storageStateFor("owner") });
  test.skip(({ isMobile }) => !isMobile, "the installed app is a phone");

  test.beforeEach(async ({ page }) => {
    await runInstalled(page);
    await holdHydration(page);
  });

  test("the back control goes back instead of forward to the parent", async ({ page }) => {
    await open(page, "/today");
    await page.locator('[data-slot="board-row"]').first().click();
    await expect(page).toHaveURL(/\/people\/[^/]+$/);
    await expect(pageHeader(page)).toBeVisible();
    const length = await historyLength(page);

    await backControl(page).click();
    await expect(page).toHaveURL(/\/today$/);
    expect(await historyLength(page)).toBe(length);
    // Back from home leaves the app's entries: the detail is ahead, not beneath.
    await page.goForward({ waitUntil: "commit" });
    await expect(page).toHaveURL(/\/people\/[^/]+$/);
  });

  test("opened directly, the back control replaces itself with the parent", async ({ page }) => {
    await open(page, "/today");
    await page.locator('[data-slot="board-row"]').first().click();
    await expect(page).toHaveURL(/\/people\/[^/]+$/);
    const detail = page.url();

    const fresh = await page.context().newPage();
    await runInstalled(fresh);
    await holdHydration(fresh);
    await open(fresh, detail);
    // A new window starts on about:blank, which is not an entry of ours.
    const length = await historyLength(fresh);

    await backControl(fresh).click();
    await expect(fresh).toHaveURL(/\/people$/);
    expect(await historyLength(fresh)).toBe(length);
  });

  test("a view control replaces its entry", async ({ page }) => {
    await open(page, "/today");
    await page.locator('[data-slot="board-row"]').first().click();
    await expect(page).toHaveURL(/\/people\/[^/]+$/);
    await expect(pageHeader(page)).toBeVisible();
    const length = await historyLength(page);

    await page
      .locator('[data-slot="person-tabs"]')
      .getByRole("link", { name: "Attendance" })
      .click();
    await expect(page).toHaveURL(/\/attendance$/);
    expect(await historyLength(page)).toBe(length);
    // One back leaves the person, as after hydration.
    await page.goBack({ waitUntil: "commit" });
    await expect(page).toHaveURL(/\/today$/);
  });

  test("tabs keep the stack at [home, tab]", async ({ page }) => {
    await open(page, "/today");
    const home = await historyLength(page);

    await tab(page, "/approvals").click();
    await expect(page).toHaveURL(/\/approvals$/);
    await expect(pageHeader(page)).toBeVisible();
    expect(await historyLength(page)).toBe(home + 1);

    await tab(page, "/tasks").click();
    await expect(page).toHaveURL(/\/tasks$/);
    await expect(pageHeader(page)).toBeVisible();
    expect(await historyLength(page)).toBe(home + 1);

    // Home is beneath: tapping it goes back rather than stacking a third entry.
    await tab(page, "/today").click();
    await expect(page).toHaveURL(/\/today$/);
    await page.goForward({ waitUntil: "commit" });
    await expect(page).toHaveURL(/\/tasks$/);
  });
});

test.describe("after hydration, installed at phone width", () => {
  test.use({ storageState: storageStateFor("owner") });
  test.skip(({ isMobile }) => !isMobile, "the installed app is a phone");

  test("each enhanced link marks itself live, so the script leaves it to the app", async ({
    page,
  }) => {
    await runInstalled(page);
    await page.goto("/today");
    await page.locator('[data-slot="board-row"]').first().click();
    await expect(page).toHaveURL(/\/people\/[^/]+$/);
    await expect(backControl(page)).toHaveAttribute("data-live", "");
    await expect(
      page.locator('[data-slot="person-tabs"]').getByRole("link", { name: "Attendance" }),
    ).toHaveAttribute("data-live", "");
    await expect(tab(page, "/approvals")).toHaveAttribute("data-live", "");
  });
});
