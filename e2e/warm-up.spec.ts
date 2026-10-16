import type { Page } from "@playwright/test";

import { expect, test } from "./fixtures";
import { hydrated, storageStateFor } from "./helpers";

/**
 * Warm the Worker early (P2, ARCHITECTURE §19; `core/ui/pwa/warm-up.ts`, mounted in the shell
 * after the page). When the app comes back into view it sends one `GET /api/warm`, at most once
 * per 30 s, and nothing while it is hidden. The clock is Playwright's, so 30 s pass at once; the
 * page's visibility is set the way a phone switching apps changes it.
 */

test.use({ storageState: storageStateFor("owner") });

const WARM_PATH = "/api/warm";

async function setVisibility(page: Page, state: "visible" | "hidden"): Promise<void> {
  await page.evaluate((next) => {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => next });
    Object.defineProperty(document, "hidden", {
      configurable: true,
      get: () => next === "hidden",
    });
    document.dispatchEvent(new Event("visibilitychange"));
  }, state);
}

test("one warm-up when the app comes back into view, at most every 30 s, none while hidden", async ({
  page,
}) => {
  const warms: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === WARM_PATH) warms.push(request.method());
  });
  await page.clock.install();
  await page.goto("/today");
  await hydrated(page);

  // The helper loads after the page (idle): each try is a return after more than 30 s, so the
  // first one it hears sends the warm-up.
  await expect
    .poll(async () => {
      await page.clock.fastForward(31_000);
      await setVisibility(page, "visible");
      return warms.length;
    })
    .toBe(1);
  const response = await page.request.get(WARM_PATH);
  expect(response.status()).toBe(204);
  expect(await response.body()).toHaveLength(0);
  expect(response.headers()["cache-control"]).toBe("no-store");
  expect(response.headers()["set-cookie"]).toBeUndefined();
  warms.length = 0;

  // Back again within 30 s: nothing (focus and a back-forward-cache return count the same).
  await page.clock.fastForward(10_000);
  await setVisibility(page, "visible");
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  // Hidden for well over 30 s: nothing, whatever it hears meanwhile.
  await setVisibility(page, "hidden");
  await page.clock.fastForward(120_000);
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await page.evaluate(() => window.dispatchEvent(new Event("pageshow")));
  // A request sent by any of these would be on its way by now; the next one must be the only one.
  await page.evaluate(() => fetch("/offline", { cache: "no-store" }).then(() => undefined));
  expect(warms).toEqual([]);

  // Visible again: exactly one.
  await setVisibility(page, "visible");
  await expect.poll(() => warms.length).toBe(1);
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await page.evaluate(() => fetch("/offline", { cache: "no-store" }).then(() => undefined));
  expect(warms).toHaveLength(1);
});
