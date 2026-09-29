import { type Page, type Request, type TestInfo } from "@playwright/test";

import { expect, test } from "./fixtures";

import {
  hydrated,
  pageHeader,
  removeClientFixture,
  runInstalled,
  serviceInsert,
  serviceSelect,
  serviceUpdate,
  storageStateFor,
} from "./helpers";

/**
 * Pull-to-refresh, built into MaxOff (ARCHITECTURE §14.2 i, owner 2026-09-28): on a tab's first
 * screen a pull re-fetches the screen's data in place (`router.refresh()`): what someone else
 * changed is there, with no reload, and whatever was open or typed stays. Not on a drill-down,
 * not while a sheet is open, and not twice within 5 s. Installed at 375 and 430 px, with real
 * touch events (the gesture is touch only).
 *
 * Each phone project owns one seeded person (`pull-<project>@…`) renamed behind the Owner's
 * back; the spec puts the name back first, so it re-runs without db:reset.
 */

const IDS: Record<string, string> = {
  mobile: "20000000-0000-4000-8000-000000000059",
  "mobile-lg": "20000000-0000-4000-8000-000000000060",
};
const person = (info: TestInfo) => ({
  id: IDS[info.project.name] ?? "",
  // Sorted first, so the phone's first cards include them (the list shows the first few).
  name: `Aa Pull (${info.project.name})`,
});
const rename = (info: TestInfo, fullName: string) =>
  serviceUpdate(`members?id=eq.${person(info).id}`, { full_name: fullName });

/** The page's own data fetched again: an RSC request for it that is not a link prefetch. */
const isRefreshOf = (request: Request, path: string) =>
  request.headers()["rsc"] === "1" &&
  !request.headers()["next-router-prefetch"] &&
  new URL(request.url()).pathname === path;

/**
 * A finger pulling down from near the top of the screen and letting go, once the pull is
 * listening (it loads after the page and marks `html[data-pull-ready]`).
 */
async function pull(page: Page, distance = 220) {
  await expect(page.locator("html")).toHaveAttribute("data-pull-ready", "");
  const cdp = await page.context().newCDPSession(page);
  const x = 180;
  const y = 220;
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
  for (let step = 1; step <= 8; step++) {
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x, y: y + (distance * step) / 8 }],
    });
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await cdp.detach();
}

async function markDocument(page: Page) {
  await page.evaluate(() => {
    (window as unknown as { __sameDocument: boolean }).__sameDocument = true;
  });
}
const sameDocument = (page: Page) =>
  page.evaluate(() => (window as unknown as { __sameDocument?: boolean }).__sameDocument === true);

test.use({ storageState: storageStateFor("owner") });
// These tests count and hold the page's own requests. A production build's service worker, once
// it controls the page, can take requests out of Playwright's sight (`page.route` and the request
// events), which made a refresh look like it never happened under load. The worker has its own
// spec (`pwa.spec.ts`); here it is kept out of the way.
test.use({ serviceWorkers: "block" });

test.skip(({ isMobile }) => !isMobile, "the pull is a touch gesture on a phone");

test.beforeEach(async ({ page }, info) => {
  if (!IDS[info.project.name]) return;
  await rename(info, person(info).name);
  await runInstalled(page);
});
test.afterEach(async ({}, info) => {
  if (IDS[info.project.name]) await rename(info, person(info).name);
});

/** The person's name on their card (the phone's list; the desktop table is hidden). */
const card = (page: Page, name: string) =>
  page.getByText(name, { exact: true }).filter({ visible: true });

test("a pull shows what someone else changed, in place", async ({ page }, info) => {
  const { name } = person(info);
  await page.goto("/people");
  await hydrated(page);
  await expect(card(page, name)).toBeVisible();
  await markDocument(page);

  const renamed = `${name} renamed`;
  await rename(info, renamed);
  const refreshed = page.waitForRequest((request) => isRefreshOf(request, "/people"));
  await pull(page);
  await refreshed;
  await expect(card(page, renamed)).toBeVisible();
  expect(await sameDocument(page), "refreshed in place, never reloaded").toBe(true);
  await expect(page).toHaveURL(/\/people$/);
});

test("what was typed on the screen stays through a pull", async ({ page }, info) => {
  // A client list to search (an empty list has no search): one fixture, removed first and after.
  const name = `Pull Client (${info.project.name})`;
  await removeClientFixture(name);
  const [org] = await serviceSelect<{ id: string }>("organizations?select=id&limit=1");
  await serviceInsert("clients", { org_id: org?.id, name });
  try {
    await page.goto("/clients");
    await hydrated(page);
    const search = page.getByRole("searchbox").filter({ visible: true });
    await search.fill("Pull Client");
    await markDocument(page);
    const refreshed = page.waitForRequest((request) => isRefreshOf(request, "/clients"));
    await pull(page);
    await refreshed;
    await expect(page.locator('[data-slot="pull-refresh"]')).toHaveCount(0);
    await expect(search).toHaveValue("Pull Client");
    expect(await sameDocument(page), "refreshed in place, never reloaded").toBe(true);
  } finally {
    await removeClientFixture(name);
  }
});

test("the spinner turns while the data comes back, and a second pull waits 5 s", async ({
  page,
}) => {
  await page.goto("/people");
  await hydrated(page);
  let refreshes = 0;
  // The refresh is held until the spinner has been seen: a local refresh can land within a frame.
  let release: () => void = () => undefined;
  const released = new Promise<void>((resolve) => (release = resolve));
  await page.route("**/*", async (route) => {
    if (!isRefreshOf(route.request(), "/people")) return route.fallback();
    refreshes++;
    await released;
    return route.fallback();
  });
  await pull(page);
  await expect(page.locator('[data-slot="pull-refresh"][data-state="refreshing"]')).toBeVisible();
  release();
  await expect(page.locator('[data-slot="pull-refresh"]')).toHaveCount(0);
  await pull(page);
  await page.waitForTimeout(500);
  expect(refreshes, "the second pull was inside the throttle").toBe(1);
});

test("never under an open sheet, and never on a drill-down", async ({ page }, info) => {
  await page.goto("/people");
  await hydrated(page);
  let refreshes = 0;
  page.on("request", (request) => {
    if (isRefreshOf(request, "/people") || isRefreshOf(request, `/people/${person(info).id}`)) {
      refreshes++;
    }
  });
  await page.getByRole("button", { name: `More for ${person(info).name}` }).click();
  const sheet = page.locator('[data-slot="detail-sheet"]');
  await expect(sheet).toBeVisible();
  await pull(page);
  await page.waitForTimeout(500);
  await expect(sheet).toBeVisible();
  expect(refreshes, "the sheet owns the gesture").toBe(0);

  await page.goto(`/people/${person(info).id}`);
  await hydrated(page);
  await expect(pageHeader(page)).toBeVisible();
  await pull(page);
  await page.waitForTimeout(500);
  await expect(page.locator('[data-slot="pull-refresh"]')).toHaveCount(0);
  expect(refreshes, "a drill-down is not a tab's first screen").toBe(0);
});
