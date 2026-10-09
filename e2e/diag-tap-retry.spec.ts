/* eslint-disable no-restricted-syntax, no-console -- DIAG ONLY: a throwaway probe, never merged. */
import { type Page, type Request, type Route } from "@playwright/test";

import { expect, test } from "./fixtures";

import { hydrated, pageHeader, runInstalled, storageStateFor } from "./helpers";

/**
 * DIAG ONLY (throwaway branch): `tap-feedback.spec.ts` "after 25 s Retry loads the destination in
 * full" on a busy phone (CPU 12x), with a probe that records, in epoch ms, when `<html>` got
 * `data-chrome` (the shell hydrated: the tabs take taps) and `data-nav-ready` (NavProgress
 * listening), every assignment to `window.fetch` (NavProgress's patch among them), when
 * `data-nav-pending` was set and removed, and (from the test side) when the tap's /tasks screen
 * fetch reached the network. The probe is printed on every repeat, pass or fail.
 */

test.use({ serviceWorkers: "block", storageState: storageStateFor("owner") });

const isScreenFetch = (request: Request, path: string) =>
  request.headers()["rsc"] === "1" &&
  !request.headers()["next-router-prefetch"] &&
  new URL(request.url()).pathname === path;
const isPrefetchOf = (request: Request, path: string) =>
  Boolean(request.headers()["next-router-prefetch"]) && new URL(request.url()).pathname === path;

async function holdScreen(page: Page, path: string) {
  await page.route("**/*", (route) =>
    isPrefetchOf(route.request(), path) ? route.abort() : route.fallback(),
  );
  const held: Route[] = [];
  const seenAt: number[] = [];
  let open = false;
  await page.route("**/*", async (route) => {
    if (!isScreenFetch(route.request(), path)) return route.fallback();
    seenAt.push(Date.now());
    if (open) return route.fallback();
    held.push(route);
  });
  return {
    seenAt: () => seenAt,
    release: async () => {
      open = true;
      for (const route of held.splice(0)) await route.fallback();
    },
  };
}

type Probe = {
  chromeAt: number | null;
  readyAt: number | null;
  fetchSets: { at: number; stack: string }[];
  pendingSetAt: number[];
  pendingRemovedAt: number[];
};

async function installProbe(page: Page) {
  await page.addInitScript(() => {
    const probe: Probe = {
      chromeAt: null,
      readyAt: null,
      fetchSets: [],
      pendingSetAt: [],
      pendingRemovedAt: [],
    };
    (window as unknown as { __probe: Probe }).__probe = probe;
    const epoch = () => performance.timeOrigin + performance.now();
    let current = window.fetch;
    Object.defineProperty(window, "fetch", {
      configurable: true,
      enumerable: true,
      get() {
        return current;
      },
      set(value: typeof window.fetch) {
        probe.fetchSets.push({
          at: epoch(),
          stack: (new Error().stack ?? "").split("\n").slice(2, 4).join(" | "),
        });
        current = value;
      },
    });
    new MutationObserver((changes) => {
      for (const change of changes) {
        const target = change.target as Element;
        if (target !== document.documentElement) continue;
        const name = change.attributeName ?? "";
        const has = target.hasAttribute(name);
        if (name === "data-chrome" && has && change.oldValue === null) probe.chromeAt = epoch();
        if (name === "data-nav-ready" && has && change.oldValue === null) probe.readyAt = epoch();
        if (name === "data-nav-pending") {
          if (has && change.oldValue === null) probe.pendingSetAt.push(epoch());
          if (!has) probe.pendingRemovedAt.push(epoch());
        }
      }
    }).observe(document, {
      attributes: true,
      attributeOldValue: true,
      subtree: true,
      attributeFilter: ["data-chrome", "data-nav-ready", "data-nav-pending"],
    });
  });
}

test.describe("DIAG: after 25 s Retry, on a busy phone", () => {
  test("after 25 s Retry loads the destination in full (CPU 12x, probed)", async ({
    page,
    isMobile,
    reloadGuard,
  }) => {
    test.skip(!isMobile, "measured on the installed phone");
    test.setTimeout(120_000);
    reloadGuard.allow(/.*/);
    await runInstalled(page);
    await installProbe(page);
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 12 });
    await page.clock.install();
    const slow = await holdScreen(page, "/tasks");
    const t0 = Date.now();
    await page.goto("/today");
    await hydrated(page);
    const hydratedAt = Date.now();
    await page.evaluate(() => {
      (window as unknown as { __sameDocument: boolean }).__sameDocument = true;
    });
    const tab = page.locator('[data-slot="bottom-nav"] a[href="/tasks"]');
    const clickFrom = Date.now();
    await tab.click();
    const clickTo = Date.now();
    await page.clock.fastForward(26_000);
    const status = page.locator('[data-slot="nav-progress-status"]');
    const retry = status.getByRole("button", { name: "Retry" });
    let retryShown = true;
    try {
      await expect(retry).toBeVisible({ timeout: 10_000 });
    } catch {
      retryShown = false;
    }
    const probe = await page.evaluate(() => (window as unknown as { __probe: Probe }).__probe);
    const pendingNow = await page.evaluate(() =>
      document.documentElement.getAttribute("data-nav-pending"),
    );
    const rel = (at: number | null) => (at === null ? null : Math.round(at - t0));
    console.log(
      `DIAG-PROBE ${JSON.stringify({
        project: test.info().project.name,
        repeat: test.info().repeatEachIndex,
        retryShown,
        pendingNow,
        hydratedAt: rel(hydratedAt),
        click: [rel(clickFrom), rel(clickTo)],
        tasksFetchSeenAt: slow.seenAt().map(rel),
        chromeAt: rel(probe.chromeAt),
        readyAt: rel(probe.readyAt),
        fetchSets: probe.fetchSets.map((set) => ({ at: rel(set.at), stack: set.stack })),
        pendingSetAt: probe.pendingSetAt.map(rel),
        pendingRemovedAt: probe.pendingRemovedAt.map(rel),
      })}`,
    );
    expect(retryShown, "Retry after 25 s").toBe(true);
    await retry.click();
    await expect(page).toHaveURL(/\/tasks$/);
    await expect(pageHeader(page).getByRole("heading", { name: "Tasks" })).toBeVisible();
    expect(
      await page.evaluate(
        () => (window as unknown as { __sameDocument?: boolean }).__sameDocument === true,
      ),
      "a full load: a new document",
    ).toBe(false);
  });
});
