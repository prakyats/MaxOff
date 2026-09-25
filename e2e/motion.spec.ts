import { expect, type Page, test } from "@playwright/test";

import { hydrated, pageHeader, runInstalled, storageStateFor } from "./helpers";

/**
 * The drill-down slide (ARCHITECTURE §14.2 j, task 2.7b): in the installed app at phone width a
 * drill-down slides in and the on-screen back slides it out; tabs, view controls and the system
 * back gesture change the page with no motion; a browser tab, the desktop and reduced motion
 * never slide.
 *
 * `document.startViewTransition` is wrapped before the page loads, so each transition the page
 * starts is recorded with its types (React passes `{ update, types }`; `slideBack` passes a
 * callback and names its slide on `<html>`) and the names of the animations that actually ran.
 * Motion itself is judged on a real phone; what can be wrong here is which navigation slides.
 */
type Recorded = { types: string[]; animations: string[] };

async function spyViewTransitions(page: Page) {
  await page.addInitScript(() => {
    const recorded: { types: string[]; animations: string[] }[] = [];
    (window as unknown as { __vt: typeof recorded }).__vt = recorded;
    const real = document.startViewTransition?.bind(document);
    if (!real) return;
    document.startViewTransition = ((arg: unknown) => {
      const manual = document.documentElement.getAttribute("data-nav-slide");
      const types =
        typeof arg === "function"
          ? manual
            ? [`nav-${manual}`]
            : []
          : ((arg as { types?: string[] } | undefined)?.types ?? []);
      const entry = { types: [...types], animations: [] as string[] };
      recorded.push(entry);
      const transition = real(arg as never);
      transition.ready
        .then(() => {
          entry.animations = document
            .getAnimations()
            .filter((a) =>
              (a.effect as KeyframeEffect | null)?.pseudoElement?.includes("view-transition"),
            )
            .map((a) => (a as CSSAnimation).animationName ?? "");
        })
        .catch(() => {});
      return transition;
    }) as typeof document.startViewTransition;
  });
}

const recorded = (page: Page) =>
  page.evaluate(() => (window as unknown as { __vt: Recorded[] }).__vt);

/** Every slide that ran, as `type:animation` pairs, e.g. `nav-forward:nav-slide-from-end`. */
async function slides(page: Page): Promise<string[]> {
  return (await recorded(page)).flatMap((entry) =>
    entry.animations
      .filter((name) => name.startsWith("nav-slide"))
      .map((name) => `${entry.types.join(",")}:${name}`)
      // The old and new animations of one transition start together, in no set order.
      .sort(),
  );
}

const FORWARD = ["nav-forward:nav-slide-from-end", "nav-forward:nav-slide-to-start"];
const BACK = ["nav-back:nav-slide-from-start", "nav-back:nav-slide-to-end"];

/** From /today, one person on the board: a drill-down to `/people/<id>`. */
async function openPersonFromToday(page: Page) {
  await page.goto("/today");
  await hydrated(page);
  await page.locator('[data-slot="board-row"]').first().click();
  await expect(page).toHaveURL(/\/people\/[^/]+$/);
}

const backControl = (page: Page) => page.getByRole("link", { name: "Back to People" });

test.describe("installed at phone width: drill-down slides", () => {
  test.use({ storageState: storageStateFor("owner") });
  test.skip(({ isMobile }) => !isMobile, "the slide is for the installed app at phone width");

  test.beforeEach(async ({ page }) => {
    await runInstalled(page);
    await spyViewTransitions(page);
  });

  test("a drill-down slides in, the on-screen back slides it out", async ({ page }) => {
    await openPersonFromToday(page);
    await expect.poll(() => slides(page)).toEqual(FORWARD);

    await backControl(page).click();
    await expect(page).toHaveURL(/\/today$/);
    await expect.poll(() => slides(page)).toEqual([...FORWARD, ...BACK]);
  });

  test("opened directly, the on-screen back replaces with the same slide", async ({ page }) => {
    await openPersonFromToday(page);
    const detail = page.url();
    // A fresh window on the detail: nothing of ours beneath, so back goes to the parent.
    const fresh = await page.context().newPage();
    await runInstalled(fresh);
    await spyViewTransitions(fresh);
    await fresh.goto(detail);
    await hydrated(fresh);
    await backControl(fresh).click();
    await expect(fresh).toHaveURL(/\/people$/);
    await expect.poll(() => slides(fresh)).toEqual(BACK);
  });

  test("a drill-down from inside a sheet slides in", async ({ page }) => {
    await page.goto("/people");
    await hydrated(page);
    await page.locator('[data-slot="data-card"]', { hasText: "Local Staff" }).click();
    const sheet = page.locator('[data-slot="detail-sheet"]');
    await sheet.getByRole("link", { name: "Attendance & leave" }).click();
    await expect(page).toHaveURL(/\/people\/[^/]+$/);
    await expect(sheet).toBeHidden();
    await expect.poll(() => slides(page)).toEqual(FORWARD);
  });

  test("the system back, a view control and a tab switch do not slide", async ({ page }) => {
    await openPersonFromToday(page);
    await expect.poll(() => slides(page)).toEqual(FORWARD);

    // A view control: the person's other view, a new path through `ViewLink`.
    await page
      .locator('[data-slot="person-tabs"]')
      .getByRole("link", { name: "Attendance" })
      .click();
    await expect(page).toHaveURL(/\/attendance$/);
    // The system back gesture (Android's own predictive back covers it). The view control
    // replaced the detail's entry, so one back leaves the person.
    await page.goBack();
    await expect(page).toHaveURL(/\/today$/);
    // A tab.
    await page.locator('[data-slot="bottom-nav"] a[href="/approvals"]').click();
    await expect(page).toHaveURL(/\/approvals$/);

    // Settled: still only the first drill-down's slide.
    await page.waitForLoadState("networkidle");
    expect(await slides(page)).toEqual(FORWARD);
  });

  test("reduced motion: nothing slides", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await openPersonFromToday(page);
    await backControl(page).click();
    await expect(page).toHaveURL(/\/today$/);
    await page.waitForLoadState("networkidle");
    expect(await slides(page)).toEqual([]);
  });
});

test.describe("a browser tab and the desktop behave like a website", () => {
  test.use({ storageState: storageStateFor("owner") });

  test("no slide on a drill-down or the on-screen back", async ({ page, isMobile }) => {
    // At phone width this is a browser tab; the desktop project is installed-or-not alike.
    if (!isMobile) await runInstalled(page);
    await spyViewTransitions(page);
    await openPersonFromToday(page);
    await page.locator('[data-slot="page-back"]:visible').click();
    await expect(page).toHaveURL(/\/(today|people)$/);
    await page.waitForLoadState("networkidle");
    expect(await slides(page)).toEqual([]);
  });
});

/**
 * Each tab root keeps its own scroll (§14.2 g), installed only; drill-down keeps the browser's
 * and Next's restoration. The seeded data does not fill a phone screen, so the shell's `<main>`
 * (which persists across navigations) is padded to give every page room to scroll.
 */
test.describe("installed: scroll is kept", () => {
  test.use({ storageState: storageStateFor("owner") });
  test.skip(({ isMobile }) => !isMobile, "the installed app is a phone");

  const scrollY = (page: Page) => page.evaluate(() => Math.round(window.scrollY));
  const near = (page: Page, y: number) =>
    expect.poll(async () => Math.abs((await scrollY(page)) - y)).toBeLessThanOrEqual(2);
  const tab = (page: Page, href: string) =>
    page.locator(`[data-slot="bottom-nav"] a[href="${href}"]`);

  async function padShell(page: Page, side: "top" | "bottom") {
    await page.evaluate((s) => {
      const main = document.getElementById("main");
      if (main) main.style[s === "top" ? "paddingTop" : "paddingBottom"] = "2000px";
    }, side);
  }

  test("each tab root comes back where it was left", async ({ page }) => {
    await runInstalled(page);
    await page.goto("/today");
    await hydrated(page);
    await expect(tab(page, "/approvals")).toBeVisible();
    await padShell(page, "bottom");

    await page.evaluate(() => window.scrollTo(0, 600));
    await tab(page, "/approvals").click();
    await expect(page).toHaveURL(/\/approvals$/);
    await near(page, 0);
    await page.evaluate(() => window.scrollTo(0, 300));

    await tab(page, "/today").click();
    await expect(page).toHaveURL(/\/today$/);
    await near(page, 600);

    await tab(page, "/approvals").click();
    await expect(page).toHaveURL(/\/approvals$/);
    await near(page, 300);
  });

  test("back from a drill-down returns to the list's place", async ({ page }) => {
    await runInstalled(page);
    await page.goto("/today");
    await hydrated(page);
    await padShell(page, "top");
    const row = page.locator('[data-slot="board-row"]').first();
    await row.scrollIntoViewIfNeeded();
    const y = await scrollY(page);
    expect(y).toBeGreaterThan(1000);

    await row.click();
    await expect(page).toHaveURL(/\/people\/[^/]+$/);
    await page.getByRole("link", { name: "Back to People" }).click();
    await expect(page).toHaveURL(/\/today$/);
    await near(page, y);
  });
});

/**
 * The tabs of one screen are views, not drill-downs (§14.2 d, j): switching them swaps only the
 * view under the header and tab bar. The header and tabs are the same elements before and after
 * (never rebuilt), and no skeleton is drawn in their band (the view's own `loading.tsx` below
 * them is the design, §14.1). `routeKey` gives both tab routes one key; `/people/[id]` draws its
 * header and tabs in a layout like `/leave`.
 */
async function watchTabSwitch(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as { __band: number[] };
    w.__band = [];
    const header = document.querySelector('[data-slot="page-header"]') as { __kept?: boolean };
    const tabs = document.querySelector('[data-slot="leave-tabs"], [data-slot="person-tabs"]');
    header.__kept = true;
    (tabs as { __kept?: boolean }).__kept = true;
    const band = tabs!.getBoundingClientRect().bottom;
    new MutationObserver(() => {
      const inBand = [...document.querySelectorAll('#main [data-slot="skeleton"]')].filter((el) => {
        const box = el.getBoundingClientRect();
        return box.height > 0 && box.top < band;
      }).length;
      if (inBand) w.__band.push(inBand);
    }).observe(document.getElementById("main")!, { childList: true, subtree: true });
  });
}

async function expectHeaderAndTabsKept(page: Page) {
  const after = await page.evaluate(() => ({
    header:
      (document.querySelector('[data-slot="page-header"]') as { __kept?: boolean } | null)
        ?.__kept ?? false,
    tabs:
      (
        document.querySelector('[data-slot="leave-tabs"], [data-slot="person-tabs"]') as {
          __kept?: boolean;
        } | null
      )?.__kept ?? false,
    skeletonsInBand: (window as unknown as { __band: number[] }).__band,
  }));
  expect(after).toEqual({ header: true, tabs: true, skeletonsInBand: [] });
}

test.describe("switching a screen's tabs keeps its header and tabs", () => {
  test.describe("the member's own /leave", () => {
    test.use({ storageState: storageStateFor("staff") });

    test("requests → attendance → requests", async ({ page }) => {
      await page.goto("/leave");
      await hydrated(page);
      const tabs = page.locator('[data-slot="leave-tabs"]');
      await expect(tabs).toBeVisible();
      await watchTabSwitch(page);
      await tabs.getByRole("link", { name: "Attendance" }).click();
      await expect(page).toHaveURL(/\/leave\/attendance$/);
      await expect(page.locator('[data-slot="leave-pager"]')).toBeVisible();
      await tabs.getByRole("link", { name: "Leave requests" }).click();
      await expect(page).toHaveURL(/\/leave$/);
      await page.waitForLoadState("networkidle");
      await expectHeaderAndTabsKept(page);
    });
  });

  test.describe("a person's history, for the Owner", () => {
    test.use({ storageState: storageStateFor("owner") });

    test("requests → attendance → requests", async ({ page }) => {
      await openPersonFromToday(page);
      const tabs = page.locator('[data-slot="person-tabs"]');
      await expect(pageHeader(page).getByRole("heading")).not.toHaveText("");
      await watchTabSwitch(page);
      await tabs.getByRole("link", { name: "Attendance" }).click();
      await expect(page).toHaveURL(/\/attendance$/);
      await expect(page.locator('[data-slot="leave-pager"]')).toBeVisible();
      await tabs.getByRole("link", { name: "Leave requests" }).click();
      await expect(page).toHaveURL(/\/people\/[^/]+$/);
      await page.waitForLoadState("networkidle");
      await expectHeaderAndTabsKept(page);
    });

    test("a drill-down to a person never shows the People list's skeleton", async ({ page }) => {
      await page.goto("/today");
      await hydrated(page);
      await page.evaluate(() => {
        const w = window as unknown as { __titles: string[] };
        w.__titles = [];
        new MutationObserver(() => {
          const title = document.querySelector("#main h1")?.textContent?.trim();
          if (title) w.__titles.push(title);
        }).observe(document.getElementById("main")!, {
          childList: true,
          subtree: true,
          characterData: true,
        });
      });
      await page.locator('[data-slot="board-row"]').first().click();
      await expect(page).toHaveURL(/\/people\/[^/]+$/);
      await expect(page.locator('[data-slot="person-tabs"]')).toBeVisible();
      await page.waitForLoadState("networkidle");
      const titles = await page.evaluate(
        () => (window as unknown as { __titles: string[] }).__titles,
      );
      expect(titles).not.toContain("People");
    });
  });
});
