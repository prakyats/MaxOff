import { expect, type Page, type Request, test, type TestInfo } from "@playwright/test";

import { hydrated, pageHeader, patchAs, storageStateFor } from "./helpers";

/**
 * Refresh on return (ARCHITECTURE §14.2 i, task 2.7b). Pull-to-refresh is off on purpose, so the
 * app re-fetches its server data in place when it comes back into view: what someone else
 * changed meanwhile is there, with no reload, and whatever was open stays open. At most once
 * every 30 seconds; the throttle and the Undo guard are unit-tested (`refresh-on-return.test.ts`,
 * `delayed-sends.test.ts`), and the clock is fast-forwarded here past the throttle.
 *
 * Each project owns one seeded person (`refresh-<project>@…`) who renames themselves while the
 * Owner has their page open. The spec puts the name back first, so it re-runs without db:reset.
 */

const PASSWORD = "refresh-local-password";
const IDS: Record<string, string> = {
  desktop: "20000000-0000-4000-8000-000000000032",
  mobile: "20000000-0000-4000-8000-000000000033",
  "mobile-lg": "20000000-0000-4000-8000-000000000034",
};
const person = (info: TestInfo) => ({
  id: IDS[info.project.name] ?? "",
  email: `refresh-${info.project.name}@maxoff.local`,
  name: `Test Refresh (${info.project.name})`,
});

async function renameAs(info: TestInfo, fullName: string) {
  const { id, email } = person(info);
  await patchAs(email, PASSWORD, `members?id=eq.${id}`, { full_name: fullName });
}

/** The app going to the background and coming back: `visibilitychange`, as a phone fires it. */
async function hideAndShow(page: Page) {
  for (const state of ["hidden", "visible"] as const) {
    await page.evaluate((visibility) => {
      Object.defineProperty(document, "visibilityState", {
        value: visibility,
        configurable: true,
      });
      document.dispatchEvent(new Event("visibilitychange"));
    }, state);
  }
}

/** The page's own data fetched again: an RSC request for it that is not a link prefetch. */
function isRefreshOf(request: Request, path: string): boolean {
  const headers = request.headers();
  return (
    headers["rsc"] === "1" &&
    !headers["next-router-prefetch"] &&
    new URL(request.url()).pathname === path
  );
}

test.use({ storageState: storageStateFor("owner") });

test("a change made by someone else shows up after the app comes back", async ({ page }, info) => {
  const { id, name } = person(info);
  await renameAs(info, name);
  await page.clock.install();
  await page.goto(`/people/${id}`);
  await hydrated(page);
  await expect(pageHeader(page).getByRole("heading", { name })).toBeVisible();

  const renamed = `${name} renamed`;
  await renameAs(info, renamed);
  const refreshes: string[] = [];
  page.on("request", (request) => {
    if (isRefreshOf(request, `/people/${id}`)) refreshes.push(request.url());
  });

  // Back within 30 seconds of the page being rendered: throttled, nothing is fetched.
  await hideAndShow(page);

  // Later: the page refreshes in place. A reload would lose this marker.
  await page.evaluate(() => {
    (window as unknown as { __sameDocument: boolean }).__sameDocument = true;
  });
  await page.clock.fastForward(31_000);
  await hideAndShow(page);
  await expect(pageHeader(page).getByRole("heading", { name: renamed })).toBeVisible();
  expect(
    await page.evaluate(() => (window as unknown as { __sameDocument?: boolean }).__sameDocument),
    "refreshed in place, never reloaded",
  ).toBe(true);
  expect(refreshes, "one refresh: the first return was inside the 30 seconds").toHaveLength(1);

  await renameAs(info, name);
});

test("what is open stays open through the refresh", async ({ page, isMobile }) => {
  test.skip(!isMobile, "the detail sheet is the phone's layout of the team list");
  await page.clock.install();
  await page.goto("/people");
  await hydrated(page);
  await page.getByRole("button", { name: "More for Local Staff" }).click();
  const sheet = page.locator('[data-slot="detail-sheet"]');
  await expect(sheet).toBeVisible();

  await page.clock.fastForward(31_000);
  const refreshed = page.waitForRequest((request) => isRefreshOf(request, "/people"));
  await hideAndShow(page);
  await refreshed;
  await expect(sheet).toBeVisible();
  await expect(page).toHaveURL(/\/people$/);
});
