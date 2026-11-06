import type { Page } from "@playwright/test";

import { expect, test } from "./fixtures";

import { hydrated, storageStateFor } from "./helpers";

/**
 * INP and long tasks on a phone profile (v2.0 X3 (c), the advisor on #89): each role's tabs at
 * 375 px with the CPU slowed 4× (a mid-range phone), measured in the page by the browser's own
 * Event Timing and Long Tasks entries: the long tasks while a tab loads, then the slowest
 * interaction of a tap on the bottom bar into the next tab (its INP: input delay, handling and
 * the next paint).
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
        // A tap on the bottom bar into the next tab (the first tab's after the last).
        const next = tabs[(index + 1) % tabs.length]!;
        const link = page.locator(`[data-slot="bottom-nav"] a[href="${next}"]`);
        let inp = "no bottom-bar link";
        if ((await link.count()) > 0) {
          await link.first().tap();
          await page.waitForURL((url) => url.pathname === next, { timeout: 30_000 });
          await hydrated(page);
          inp = `${(await read(page)).inp} ms`;
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
