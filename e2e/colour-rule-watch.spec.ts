import type { Page } from "@playwright/test";

import { expect, test } from "./fixtures";
import { hydrated, storageStateFor } from "./helpers";

/**
 * The colour rule's watcher bites (`e2e/fixtures.ts`, ADR-0015): two solid commit actions in one
 * layer are recorded, whether they appear while the page is busy or once it is quiet. Since v7.0
 * the watcher checks once per idle moment (at most 250 ms after a change) instead of every frame;
 * this spec is what shows the cheaper watcher still catches a violation. Each test empties the
 * record before it ends, so the fixture's own end-of-test check passes.
 */
test.use({ storageState: storageStateFor("owner") });

const violations = (page: Page) => page.evaluate(() => window.__primaryViolations ?? []);

async function addTwoPrimaries(page: Page): Promise<void> {
  await page.evaluate(() => {
    const layer = document.createElement("div");
    layer.setAttribute("data-slot", "watch-check");
    for (const name of ["Save", "Send"]) {
      const button = document.createElement("button");
      button.setAttribute("data-variant", "primary");
      button.textContent = name;
      layer.append(button);
    }
    document.querySelector("main")?.append(layer);
  });
}

test("two solid commits on one screen are recorded within the watcher's 250 ms", async ({
  page,
}) => {
  await page.goto("/settings");
  await hydrated(page);
  expect(await violations(page)).toEqual([]);
  await addTwoPrimaries(page);
  await expect
    .poll(() => violations(page), { timeout: 1_000 })
    .toEqual(["screen /settings → Save | Send"]);
  await page.evaluate(() => {
    window.__primaryViolations = [];
    document.querySelector('[data-slot="watch-check"]')?.remove();
  });
});

test("the end-of-test check catches what no idle moment has checked yet", async ({ page }) => {
  await page.goto("/settings");
  await hydrated(page);
  await addTwoPrimaries(page);
  // At once, before any idle callback: the check the fixture runs at the end of a test.
  const caught = await page.evaluate(() => {
    window.__primaryCheck?.();
    return window.__primaryViolations ?? [];
  });
  expect(caught).toEqual(["screen /settings → Save | Send"]);
  await page.evaluate(() => {
    window.__primaryViolations = [];
    document.querySelector('[data-slot="watch-check"]')?.remove();
  });
  // The idle check that follows finds the layer gone.
  await page.waitForTimeout(400);
  expect(await violations(page)).toEqual([]);
});
