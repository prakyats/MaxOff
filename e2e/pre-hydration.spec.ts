import { type Locator, type Page, type Route } from "@playwright/test";

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
    // The full board under Today (6.2), where every person is a row.
    await open(page, "/today/people");
    await page.locator('[data-slot="board-row"]').first().click();
    await expect(page).toHaveURL(/\/people\/[^/]+\/leave$/);
    await expect(pageHeader(page)).toBeVisible();
    const length = await historyLength(page);

    await backControl(page).click();
    await expect(page).toHaveURL(/\/today\/people$/);
    expect(await historyLength(page)).toBe(length);
    // Back went back: the detail is ahead, not beneath.
    await page.goForward({ waitUntil: "commit" });
    await expect(page).toHaveURL(/\/people\/[^/]+\/leave$/);
  });

  test("opened directly, the back control replaces itself with the parent", async ({ page }) => {
    await open(page, "/today/people");
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
    await open(page, "/today/people");
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
    await expect(page).toHaveURL(/\/today\/people$/);
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
    await page.goto("/today/people");
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

  /**
   * One held tap (the owner's condition for the hold, ARCHITECTURE §14.2 l): a fresh installed
   * window on `path`, its scripts held until the tap has landed, so the tap is guaranteed to come
   * before hydration and hydration is guaranteed to come after it, well inside
   * `PRE_HYDRATION_WAIT_MS`. Measured in the page, so the test's own round trips never count:
   * the pressed look in the first frame after the pointer goes down, the bar in the first frame
   * after the click. Then the app makes the move itself: the destination, the history length the
   * hydrated app would leave, the bar finished, and the same document (the reload guard,
   * `fixtures.ts`, fails the test on any document load it did not ask for).
   */
  async function heldTap(
    page: Page,
    path: string,
    control: (page: Page) => Locator,
    arrives: { url: RegExp; screen: (page: Page) => Locator; historyGrowth: number },
  ) {
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
    await fresh.addInitScript(() => {
      type Press = { transform: string; tint: string; elapsed: number };
      type Tap = { elapsed: number; pending: boolean; barOpacity: string };
      const w = window as unknown as { __press?: Press; __tap?: Tap; __sameDocument?: true };
      w.__sameDocument = true;
      window.addEventListener(
        "pointerdown",
        (event) => {
          const link = (event.target as Element | null)?.closest("a[href]");
          if (!link || w.__press) return;
          requestAnimationFrame((frame) => {
            const style = getComputedStyle(link);
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
    await open(fresh, path);
    const link = control(fresh);
    await expect(link).toBeVisible();
    await expect(link, "the tap lands before hydration").not.toHaveAttribute("data-live");
    const length = await historyLength(fresh);

    const box = await link.boundingBox();
    if (!box) throw new Error("the control is not on screen");
    await fresh.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await fresh.mouse.down();
    await fresh.waitForFunction(() => "__press" in window);
    // The click: the head script holds it; the scripts are let through right after.
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

    // Replayed once the link is live: the app's own move, in this document.
    await expect(fresh).toHaveURL(arrives.url);
    await hydrated(fresh);
    await expect(arrives.screen(fresh), "the destination screen").toBeVisible();
    await expect(fresh.locator("html")).not.toHaveAttribute("data-nav-pending");
    expect(await historyLength(fresh), "the hydrated app's history").toBe(
      length + arrives.historyGrowth,
    );
    expect(
      await fresh.evaluate(
        () => (window as unknown as { __sameDocument?: true }).__sameDocument === true,
      ),
      "the same document: the app made the move",
    ).toBe(true);
    await fresh.close();
  }

  /** A person's leave page, found through the hydrated app (a detail with a back control). */
  async function detailUrl(page: Page) {
    await runInstalled(page);
    await page.goto("/today/people");
    await hydrated(page);
    await page.locator('[data-slot="board-row"]').first().click();
    await expect(page).toHaveURL(/\/people\/[^/]+\/leave$/);
    return page.url();
  }

  test("the back control: pressed and the bar within 100 ms, then the app's replace, no reload", async ({
    page,
  }) => {
    await heldTap(page, await detailUrl(page), backControl, {
      url: /\/people$/,
      screen: (fresh) => pageHeader(fresh).getByRole("heading", { name: "People", exact: true }),
      historyGrowth: 0,
    });
  });

  test("a view control: pressed and the bar within 100 ms, then the app's replace, no reload", async ({
    page,
  }) => {
    await heldTap(
      page,
      await detailUrl(page),
      (fresh) =>
        fresh.locator('[data-slot="person-tabs"]').getByRole("link", { name: "Attendance" }),
      {
        url: /\/people\/[^/]+\/attendance$/,
        // The person's views mark the one on screen.
        screen: (fresh) =>
          fresh
            .locator('[data-slot="person-tabs"]')
            .locator('a[aria-current="page"]', { hasText: "Attendance" }),
        historyGrowth: 0,
      },
    );
  });

  test("a tab: pressed and the bar within 100 ms, then the app's push from home, no reload", async ({
    page,
  }) => {
    await heldTap(page, "/today", (fresh) => tab(fresh, "/approvals"), {
      url: /\/approvals$/,
      screen: (fresh) => pageHeader(fresh).getByRole("heading", { name: "Approvals", exact: true }),
      historyGrowth: 1,
    });
  });
});
