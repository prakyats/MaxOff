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
  mobile: "20000000-0000-4000-8000-000000000074",
  "mobile-lg": "20000000-0000-4000-8000-000000000075",
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

/** Where the finger comes down: near the top of the screen, over the first rows. */
const FINGER = { x: 180, y: 220 };

/**
 * A finger pulling down from `FINGER` and letting go, once the pull is listening (it loads after
 * the page and marks `html[data-pull-ready]`). `between` runs with the finger down, before it
 * moves.
 */
async function pull(page: Page, { distance = 220, between = async () => {} } = {}) {
  await expect(page.locator("html")).toHaveAttribute("data-pull-ready", "");
  const cdp = await page.context().newCDPSession(page);
  const { x, y } = FINGER;
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
  await between();
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

test("a pull goes on when what the finger came down on leaves the page", async ({ page }) => {
  // Found on CI (2026-09-29): on a cold open the finger came down on the People skeleton and the
  // list replaced it while the finger moved. A touch's later events go to the element it started
  // on even after that element has left the page, and from there they never reach `window`, so
  // the pull never saw them. React's own swap cannot be timed from a test (it waits on the reveal
  // and the prefetch cache), so a plain layer stands in for the skeleton: the finger comes down
  // on it, and it leaves the page before the finger moves.
  await page.goto("/people");
  await hydrated(page);
  await page.evaluate(() => {
    const layer = document.createElement("div");
    layer.id = "leaves-mid-pull";
    layer.style.cssText = "position: fixed; inset: 0; z-index: 100";
    document.body.append(layer);
  });
  await markDocument(page);
  const refreshed = page.waitForRequest((request) => isRefreshOf(request, "/people"));
  await pull(page, {
    between: async () => {
      expect(
        await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.id, FINGER),
        "the finger is down on the layer",
      ).toBe("leaves-mid-pull");
      await page.evaluate(() => document.getElementById("leaves-mid-pull")?.remove());
    },
  });
  await refreshed;
  await expect(page.locator('[data-slot="pull-refresh"]')).toHaveCount(0);
  expect(await sameDocument(page), "refreshed in place, never reloaded").toBe(true);
});

test("a pull begun on the skeleton survives React revealing the screen mid-pull", async ({
  page,
}, info) => {
  // Found on CI (2026-09-29, after the first fix): on a cold open, React reveals a streamed screen
  // up to 300 ms after its HTML arrived ($RV batches reveals), and meanwhile the app is hydrated
  // and the pull listening. A touch on the skeleton then was stopped by React (the part it
  // targets is not hydrated yet), and the reveal took the skeleton away mid-pull. Here the reveal
  // that replaces the People skeleton is held until the finger is down on it: React's own reveal
  // ($RV, the page's inline runtime), so this is the path a phone takes, every time.
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>;
    let real: ((batch: unknown) => void) | undefined;
    const queue: unknown[] = [];
    w.__releaseReveal = () => {
      w.__held = false;
      for (const batch of queue.splice(0)) real?.(batch);
    };
    w.__held = true;
    Object.defineProperty(window, "$RV", {
      configurable: true,
      get: () => (batch: unknown) => {
        // The reveal that brings the People skeleton goes through; the ones after it wait.
        const items = batch as { outerHTML?: string }[];
        const now: unknown[] = [];
        for (let i = 0; i < items.length; i += 2) {
          const pair = [items[i], items[i + 1]];
          const bringsSkeleton = items[i + 1]?.outerHTML?.includes("Loading People");
          if (w.__held && !bringsSkeleton) queue.push(pair);
          else now.push(...pair);
        }
        if (now.length) real?.(now);
        (batch as unknown[]).length = 0;
      },
      set: (fn: (batch: unknown) => void) => {
        real = fn;
      },
    });
  });
  await page.goto("/people", { waitUntil: "commit" });
  const skeleton = page.locator('[aria-label="Loading People"]');
  await expect(skeleton).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-pull-ready", "");
  await markDocument(page);
  const refreshed = page.waitForRequest((request) => isRefreshOf(request, "/people"));
  await pull(page, {
    between: async () => {
      expect(
        await page.evaluate(
          ({ x, y }) =>
            document.elementFromPoint(x, y)?.closest('[aria-label="Loading People"]') != null,
          FINGER,
        ),
        "the finger is down on the skeleton",
      ).toBe(true);
      await page.evaluate(() =>
        (window as unknown as { __releaseReveal: () => void }).__releaseReveal(),
      );
      await expect(card(page, person(info).name)).toBeVisible();
      await expect(skeleton).toHaveCount(0);
    },
  });
  await refreshed;
  expect(await sameDocument(page), "refreshed in place, never reloaded").toBe(true);
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
