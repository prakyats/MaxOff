import type { Page } from "@playwright/test";

import { expect, test } from "./fixtures";

import { hydrated, storageStateFor } from "./helpers";

/**
 * INP and long tasks on a phone profile (v2.0 X3 (c), the advisor on #89): each role's tabs at
 * 375 px with the CPU slowed 4× (a mid-range phone), measured in the page by the browser's own
 * Event Timing and Long Tasks entries: the long tasks while a tab loads, then the slowest
 * interaction of a tap into the next tab (its INP: input delay, handling and the next paint): on
 * the bottom bar, or for a route behind More, the tap that opens the sheet and the tap on its row,
 * each measured alone.
 *
 * **The gate is on (v2.0 X6, the advisor's batch 5):** each tap's INP is at most 200 ms (the web's
 * "good"), one test per tab and role; the load's long tasks are reported in the annotations.
 */
const MAX_INP_MS = 200;

type Role = "owner" | "admin" | "staff";
const TABS: Record<Role, string[]> = {
  owner: ["/today", "/approvals", "/tasks", "/clients", "/people"],
  admin: ["/today", "/approvals", "/tasks", "/clients", "/leave"],
  staff: ["/my-day", "/tasks", "/calendar", "/leave", "/me"],
};
const CPU_SLOWDOWN = 4;

/** Starts collecting long tasks and interactions in the page (before any script runs). */
async function observe(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as { __long: number[]; __events: { id: number; ms: number }[] };
    w.__long = [];
    w.__events = [];
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) w.__long.push(entry.duration);
    }).observe({ type: "longtask", buffered: true });
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries() as PerformanceEventTiming[]) {
        if (entry.interactionId) w.__events.push({ id: entry.interactionId, ms: entry.duration });
      }
    }).observe({ type: "event", durationThreshold: 16, buffered: true } as PerformanceObserverInit);
  });
}

/** Forgets the interactions so far, so the next reading is the next tap's alone. */
async function forget(page: Page): Promise<void> {
  await page.evaluate(() => {
    (window as unknown as { __events: unknown[] }).__events = [];
  });
}

async function read(page: Page) {
  return page.evaluate(() => {
    const w = window as unknown as { __long: number[]; __events: { id: number; ms: number }[] };
    const byInteraction = new Map<number, number>();
    for (const event of w.__events) {
      byInteraction.set(event.id, Math.max(byInteraction.get(event.id) ?? 0, event.ms));
    }
    return {
      longTasks: w.__long.length,
      longestTask: Math.round(Math.max(0, ...w.__long)),
      blocking: Math.round(w.__long.reduce((sum, ms) => sum + Math.max(0, ms - 50), 0)),
      inp: Math.round(Math.max(0, ...byInteraction.values())),
    };
  });
}

for (const role of ["owner", "admin", "staff"] as const) {
  test.describe(`a phone's INP and long tasks, as ${role}`, () => {
    test.use({ storageState: storageStateFor(role) });
    const tabs = TABS[role];

    for (const [index, path] of tabs.entries()) {
      // A tap into the next tab (the first tab's after the last): on the bottom bar, or through More.
      const next = tabs[(index + 1) % tabs.length]!;
      test(`${path}, then a tap into ${next}: INP at most ${MAX_INP_MS} ms (${role})`, async ({
        page,
      }, info) => {
        test.skip(info.project.name !== "mobile", "a phone profile, 375 px");
        await observe(page);
        const cdp = await page.context().newCDPSession(page);
        await cdp.send("Emulation.setCPUThrottlingRate", { rate: CPU_SLOWDOWN });
        await page.goto(path);
        await hydrated(page);
        await expect(page.locator('[data-slot="loading-state"]')).toHaveCount(0);
        const load = await read(page);
        const bar = page.locator(`[data-slot="bottom-nav"] a[href="${next}"]`);
        const taps: { name: string; inp: number }[] = [];
        if ((await bar.count()) > 0) {
          await forget(page);
          await bar.first().tap();
          await page.waitForURL((url) => url.pathname === next, { timeout: 30_000 });
          await hydrated(page);
          taps.push({ name: "the tab", inp: (await read(page)).inp });
        } else {
          await forget(page);
          await page.locator('[data-slot="bottom-nav"] button').first().tap();
          const row = page.locator(`[data-slot="more-sheet"] a[href="${next}"]`);
          await expect(row).toBeVisible();
          taps.push({ name: "More", inp: (await read(page)).inp });
          await forget(page);
          await row.tap();
          await page.waitForURL((url) => url.pathname === next, { timeout: 30_000 });
          await hydrated(page);
          taps.push({ name: "the row", inp: (await read(page)).inp });
        }
        info.annotations.push({
          type: "phone-inp",
          description: `${path}: long tasks ${load.longTasks} (longest ${load.longestTask} ms, blocking ${load.blocking} ms); tap → ${next}: ${taps.map((tap) => `${tap.name} ${tap.inp} ms`).join(", ")} (CPU ×${CPU_SLOWDOWN})`,
        });
        for (const tap of taps) {
          expect(tap.inp, `${path} → ${next}: ${tap.name}'s INP`).toBeLessThanOrEqual(MAX_INP_MS);
        }
      });
    }
  });
}
