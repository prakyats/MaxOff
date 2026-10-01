import { type Page, type Route } from "@playwright/test";

import { expect, test } from "./fixtures";

import { hydrated, pageHeader, runInstalled, storageStateFor } from "./helpers";

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
 *
 * Since 2026-10-01 (owner) the script **holds** such a tap for the app instead of loading the
 * destination: the full loads the first group proves are its fallback after `PRE_HYDRATION_WAIT_MS`
 * (the scripts never came). The last group holds the scripts only until the tap has landed, and
 * proves the held tap is acknowledged at once (§14.1: the pressed state and the progress bar within
 * 100 ms) and then made by the app itself, in the same document: the reload guard (`fixtures.ts`)
 * fails it on any document load.
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
  // With the scripts held, the app never takes a held tap over, so the script makes each move
  // itself as a document load (`PRE_HYDRATION_WAIT_MS`): the loads here are the point.
  test.use({ documentLoads: "allowed" });
  test.skip(({ isMobile }) => !isMobile, "the installed app is a phone");

  test.beforeEach(async ({ page }) => {
    await runInstalled(page);
    await holdHydration(page);
  });

  test("the back control goes back instead of forward to the parent", async ({ page }) => {
    await open(page, "/today");
    await page.locator('[data-slot="board-row"]').first().click();
    await expect(page).toHaveURL(/\/people\/[^/]+\/leave$/);
    await expect(pageHeader(page)).toBeVisible();
    const length = await historyLength(page);

    await backControl(page).click();
    await expect(page).toHaveURL(/\/today$/);
    expect(await historyLength(page)).toBe(length);
    // Back from home leaves the app's entries: the detail is ahead, not beneath.
    await page.goForward({ waitUntil: "commit" });
    await expect(page).toHaveURL(/\/people\/[^/]+\/leave$/);
  });

  test("opened directly, the back control replaces itself with the parent", async ({ page }) => {
    await open(page, "/today");
    await page.locator('[data-slot="board-row"]').first().click();
    await expect(page).toHaveURL(/\/people\/[^/]+\/leave$/);
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
    await expect(page).toHaveURL(/\/people\/[^/]+\/leave$/);
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
    await expect(page).toHaveURL(/\/people\/[^/]+\/leave$/);
    await expect(backControl(page)).toHaveAttribute("data-live", "");
    await expect(
      page.locator('[data-slot="person-tabs"]').getByRole("link", { name: "Attendance" }),
    ).toHaveAttribute("data-live", "");
    await expect(tab(page, "/approvals")).toHaveAttribute("data-live", "");
  });
});

test.describe("a tap before hydration is held for the app, installed at phone width", () => {
  test.use({ storageState: storageStateFor("owner") });
  // The scripts are held by `page.route`; a service worker serving `/_next/static` from its cache
  // would answer them out of Playwright's sight (as in `tap-feedback.spec.ts`).
  test.use({ serviceWorkers: "block" });
  test.skip(({ isMobile }) => !isMobile, "the installed app is a phone");

  test("a held tap is pressed and shows the bar within 100 ms, then the app makes the move with no reload", async ({
    page,
  }) => {
    await runInstalled(page);
    await page.goto("/today");
    await hydrated(page);
    await page.locator('[data-slot="board-row"]').first().click();
    await expect(page).toHaveURL(/\/people\/[^/]+\/leave$/);
    const detail = page.url();

    // A fresh window on the detail, its scripts held until the tap has landed: the tap is
    // guaranteed to come before hydration, and hydration is guaranteed to come after it.
    const fresh = await page.context().newPage();
    await runInstalled(fresh);
    const heldChunks: Route[] = [];
    let chunksFlow = false;
    await fresh.route(/\/_next\/static\/chunks\/.+\.js/, (route) => {
      if (chunksFlow) return route.fallback();
      heldChunks.push(route);
    });
    const releaseChunks = async () => {
      chunksFlow = true;
      for (const route of heldChunks.splice(0)) await route.fallback();
    };
    // Measured in the page, so the test's own round trips never count: the first frame after
    // the pointer goes down (the pressed look), and the first frame after the click (the bar).
    await fresh.addInitScript(() => {
      type Press = { transform: string; tint: string; elapsed: number };
      type Tap = { elapsed: number; pending: boolean; barOpacity: string };
      const w = window as unknown as { __press?: Press; __tap?: Tap; __sameDocument?: true };
      w.__sameDocument = true;
      window.addEventListener(
        "pointerdown",
        (event) => {
          const control = (event.target as Element | null)?.closest('[data-slot="page-back"]');
          if (!control || w.__press) return;
          requestAnimationFrame((frame) => {
            const style = getComputedStyle(control);
            w.__press = {
              transform: style.transform,
              tint: style.backgroundImage,
              elapsed: frame - event.timeStamp,
            };
          });
        },
        true,
      );
      window.addEventListener(
        "click",
        (event) => {
          if (w.__tap) return;
          requestAnimationFrame((frame) => {
            const bar = document.querySelector('[data-slot="nav-progress-bar"]');
            w.__tap = {
              elapsed: frame - event.timeStamp,
              pending: document.documentElement.hasAttribute("data-nav-pending"),
              barOpacity: bar ? getComputedStyle(bar).opacity : "no bar",
            };
          });
        },
        true,
      );
    });
    await open(fresh, detail);
    const control = backControl(fresh);
    await expect(control).not.toHaveAttribute("data-live");
    const length = await historyLength(fresh);

    const box = await control.boundingBox();
    if (!box) throw new Error("the back control is not on screen");
    await fresh.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await fresh.mouse.down();
    await fresh.waitForFunction(() => "__press" in window);
    // The click: the head script holds it and the scripts are let through right after, so the
    // hand-over comes well inside `PRE_HYDRATION_WAIT_MS`.
    await fresh.mouse.up();
    await fresh.waitForFunction(() => "__tap" in window);
    await releaseChunks();

    const seen = await fresh.evaluate(() => {
      const w = window as unknown as {
        __press: { transform: string; tint: string; elapsed: number };
        __tap: { elapsed: number; pending: boolean; barOpacity: string };
      };
      return { press: w.__press, tap: w.__tap };
    });
    // Acknowledged at once (§14.1), although nothing of the app has run yet.
    expect(seen.press.elapsed, "the pressed state, within 100 ms").toBeLessThan(100);
    expect(seen.press.transform, "the 0.97 press").not.toBe("none");
    expect(seen.press.tint, "the neutral tint").toContain("gradient");
    expect(seen.tap.elapsed, "the bar, within 100 ms").toBeLessThan(100);
    expect(seen.tap.pending, "the navigation is pending").toBe(true);
    expect(seen.tap.barOpacity, "the bar is showing").toBe("1");

    // Replayed once the link is live: the app's own replace, in this document (no load: the
    // reload guard would fail the test), no entry added, and the bar finished.
    await expect(fresh).toHaveURL(/\/people$/);
    await hydrated(fresh);
    await expect(pageHeader(fresh).getByRole("heading", { name: "People" })).toBeVisible();
    await expect(fresh.locator("html")).not.toHaveAttribute("data-nav-pending");
    expect(await historyLength(fresh)).toBe(length);
    expect(
      await fresh.evaluate(
        () => (window as unknown as { __sameDocument?: true }).__sameDocument === true,
      ),
      "the same document: the app made the move",
    ).toBe(true);
  });
});
