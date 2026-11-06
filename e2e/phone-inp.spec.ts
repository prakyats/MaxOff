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
 * Measuring first: the numbers go into the test's annotations and the report; the budgets
 * (INP ≤ 200 ms, the web's "good") are switched on once a baseline is known, as the first wave was.
 */

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

    test(`each tab, then a tap into the next (${role})`, async ({ page }, info) => {
      test.skip(info.project.name !== "mobile", "a phone profile, 375 px");
      test.setTimeout(240_000);
      await observe(page);
      const cdp = await page.context().newCDPSession(page);
      await cdp.send("Emulation.setCPUThrottlingRate", { rate: CPU_SLOWDOWN });
      const tabs = TABS[role];
      const lines: string[] = [];
      for (const [index, path] of tabs.entries()) {
        await page.goto(path);
        await hydrated(page);
        await expect(page.locator('[data-slot="loading-state"]')).toHaveCount(0);
        const load = await read(page);
        // A tap into the next tab (the first tab's after the last): on the bottom bar, or through More.
        const next = tabs[(index + 1) % tabs.length]!;
        const bar = page.locator(`[data-slot="bottom-nav"] a[href="${next}"]`);
        let inp: string;
        if ((await bar.count()) > 0) {
          await forget(page);
          await bar.first().tap();
          await page.waitForURL((url) => url.pathname === next, { timeout: 30_000 });
          await hydrated(page);
          inp = `${(await read(page)).inp} ms`;
        } else {
          await forget(page);
          await page.locator('[data-slot="bottom-nav"] button').first().tap();
          const row = page.locator(`[data-slot="more-sheet"] a[href="${next}"]`);
          await expect(row).toBeVisible();
          const open = (await read(page)).inp;
          await forget(page);
          await row.tap();
          await page.waitForURL((url) => url.pathname === next, { timeout: 30_000 });
          await hydrated(page);
          inp = `More ${open} ms, then the row ${(await read(page)).inp} ms`;
        }
        lines.push(
          `${path}: long tasks ${load.longTasks} (longest ${load.longestTask} ms, blocking ${load.blocking} ms); tap → ${next}: INP ${inp}`,
        );
      }
      info.annotations.push({ type: "phone-inp", description: lines.join("\n") });
      // eslint-disable-next-line no-console -- the measuring run's table (X3 (c)), until the budget is on
      console.log(`phone INP (CPU ×${CPU_SLOWDOWN}), ${role}:\n${lines.join("\n")}`);
    });
  });
}
