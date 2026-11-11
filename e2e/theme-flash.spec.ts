import { type Page } from "@playwright/test";

import { expect, test } from "./fixtures";

import { hydrated, runInstalled, storageStateFor } from "./helpers";

/**
 * The theme is decided before first paint (task 1.5).
 *
 * The installed app painted light on every reload, then switched to dark. Two causes: our
 * pre-paint script returned early for the default `system`, and next-themes' own script renders
 * inside `<body>` where the provider is — measured at byte 3382 of the login document, after the
 * first `<div>` at 3247, so the browser already had paintable content to show.
 *
 * **What is asserted here, and what is not.** A frame-by-frame trace of the first 500 ms was
 * tried and abandoned: on desktop Chromium the document parses before first paint so the bug is
 * invisible, and under CPU throttling heavy enough to expose it the sampler became unreliable
 * (see PROGRESS). Rather than gate the build on a test that flakes, the decision the script makes
 * is unit-tested directly in `src/core/ui/theme/theme-color.test.ts`, and what is checked here is
 * the other half: that the script is in `<head>`, ahead of anything paintable. That assertion was
 * verified to fail against the pre-fix script.
 */
test("the pre-paint theme script is in <head>, ahead of any content", async ({ page }) => {
  const html = await (await page.request.get("/login")).text();
  const headEnd = html.indexOf("</head>");
  const ourScript = html.indexOf("classList.toggle");
  expect(ourScript, "the pre-paint script is missing from the document").toBeGreaterThan(-1);
  expect(ourScript, "the pre-paint script is not in <head>").toBeLessThan(headEnd);

  // next-themes' own script is in <body>, which is the reason ours has to exist at all.
  const nextThemes = html.indexOf('["light", "dark"]');
  if (nextThemes > -1) expect(nextThemes).toBeGreaterThan(headEnd);
});

/**
 * The time-zone warm-up (`WARM_ZONE_SCRIPT`, X3 (d)) is in `<head>` too, so the first IST
 * formatter is made when the browser is idle, never inside hydration (X5+ L3).
 */
test("the time-zone warm-up script is in <head>", async ({ page }) => {
  const html = await (await page.request.get("/login")).text();
  const headEnd = html.indexOf("</head>");
  const warm = html.indexOf('new Intl.DateTimeFormat("en-GB",{hour:"numeric",timeZone:');
  expect(warm, "the warm-up script is missing from the document").toBeGreaterThan(-1);
  expect(warm, "the warm-up script is not in <head>").toBeLessThan(headEnd);
});

/**
 * Logs, by animation frame, every class change of `<html>` (light or dark) and every transition
 * hold inserted or removed (`quiet-theme-change.ts`), from before the page's own scripts.
 */
async function traceTheme(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as { __frame: number; __log: string[] };
    w.__frame = 0;
    w.__log = [];
    const tick = () => {
      w.__frame += 1;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    // The hold's own rule (sonner's stylesheet also has a `transition:none`).
    const hold = (node: Node) =>
      node.nodeName === "STYLE" && (node.textContent ?? "").startsWith("*,*::before,*::after{");
    new MutationObserver((records) => {
      for (const record of records) {
        if (record.type === "attributes") {
          const now = document.documentElement.classList.contains("dark") ? "dark" : "light";
          w.__log.push(`class ${now} @${w.__frame}`);
        }
        for (const node of record.addedNodes) if (hold(node)) w.__log.push(`hold @${w.__frame}`);
        for (const node of record.removedNodes) if (hold(node)) w.__log.push("release");
      }
    }).observe(document, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["class"],
    });
  });
}

function themeLog(page: Page): Promise<string[]> {
  return page.evaluate(() => (window as unknown as { __log: string[] }).__log);
}

/** A change's hold sits in the same frame as its class change, and is released after it. */
async function expectHeldInItsFrame(page: Page, to: "dark" | "light"): Promise<void> {
  await expect.poll(() => themeLog(page)).toContain("release");
  const entries = (await themeLog(page)).filter(
    (entry) => !entry.startsWith(`class ${to === "dark" ? "light" : "dark"}`),
  );
  const change = entries.find((entry) => entry.startsWith(`class ${to}`));
  const hold = entries.find((entry) => entry.startsWith("hold"));
  expect(change, "the class changed").toBeTruthy();
  expect(hold, "the transitions were held").toBeTruthy();
  expect(hold!.split("@")[1], "in the same frame as the change").toBe(change!.split("@")[1]);
  expect(entries.indexOf(hold!)).toBeLessThan(entries.indexOf("release"));
}

/**
 * No transitions while the theme changes, and nothing for it on a load (v2.0 X3 (d),
 * `src/core/ui/theme/quiet-theme-change.ts`). next-themes' `disableTransitionOnChange` also ran
 * on mount: a "transition: none" style inserted, the whole page restyled, the style removed, twice
 * inside hydration. Now a load inserts none; a real change inserts it in the same frame as the
 * class change (before the restyle that shows the new theme) and removes it afterwards.
 */
test.describe("the theme changes without transitions", () => {
  test.skip(({ isMobile }) => Boolean(isMobile), "the theme menu is the desktop sidebar's");
  test.use({ storageState: storageStateFor("owner") });

  test("a load inserts no transition hold; a theme change holds them in its own frame", async ({
    page,
  }) => {
    await traceTheme(page);
    const log = () => themeLog(page);
    await page.goto("/today");
    await hydrated(page);
    expect((await log()).filter((entry) => entry.startsWith("hold"))).toEqual([]);

    // The watch loads after the page (`ThemeProvider`); a change is a tap away.
    await expect(page.locator("html")).toHaveAttribute("data-theme-quiet", "");
    await page.evaluate(() => {
      (window as unknown as { __log: string[] }).__log = [];
    });
    await page.getByRole("button", { name: "Change theme" }).click();
    await page.getByRole("menuitemradio", { name: "Dark" }).click();
    await expect(page.locator("html")).toHaveClass(/\bdark\b/);
    await expect.poll(log).toContain("release");
    const entries = (await log()).filter((entry) => !entry.startsWith("class light"));
    const change = entries.find((entry) => entry.startsWith("class dark"));
    const hold = entries.find((entry) => entry.startsWith("hold"));
    expect(change, "the class changed").toBeTruthy();
    expect(hold, "the transitions were held").toBeTruthy();
    expect(hold!.split("@")[1], "in the same frame as the change").toBe(change!.split("@")[1]);
    expect(entries.indexOf(hold!)).toBeLessThan(entries.indexOf("release"));
  });
});

/** X5+ M2: a stored dark choice, the device flipping under System, and the phone's own path. */
test.describe("the theme on a load, a System flip and the phone's Appearance", () => {
  test.use({ storageState: storageStateFor("owner") });

  test("a stored Dark paints dark from the first change and holds nothing on the load", async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await page.addInitScript(() => localStorage.setItem("theme", "dark"));
    await traceTheme(page);
    await page.goto("/today");
    await hydrated(page);
    await expect(page.locator("html")).toHaveClass(/\bdark\b/);
    const entries = await themeLog(page);
    expect(
      entries.filter((entry) => entry.startsWith("hold")),
      "no hold on a load",
    ).toEqual([]);
    expect(
      entries.filter((entry) => entry.startsWith("class")).map((entry) => entry.split(" @")[0]),
      "dark from the first class it takes, never light first",
    ).toEqual(expect.arrayContaining(["class dark"]));
    expect(entries.some((entry) => entry.startsWith("class light"))).toBe(false);
  });

  test("under System, the device turning dark is held in its own frame", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await traceTheme(page);
    await page.goto("/today");
    await hydrated(page);
    await expect(page.locator("html")).toHaveAttribute("data-theme-quiet", "");
    await expect(page.locator("html")).not.toHaveClass(/\bdark\b/);
    await page.evaluate(() => {
      (window as unknown as { __log: string[] }).__log = [];
    });
    await page.emulateMedia({ colorScheme: "dark" });
    await expect(page.locator("html")).toHaveClass(/\bdark\b/);
    await expectHeldInItsFrame(page, "dark");
  });

  test("the phone: More → Appearance → Dark is held in its own frame", async ({
    page,
    isMobile,
  }) => {
    test.skip(!isMobile, "the Appearance sheet is the phone's");
    await runInstalled(page);
    await page.emulateMedia({ colorScheme: "light" });
    await traceTheme(page);
    await page.goto("/today");
    await hydrated(page);
    await expect(page.locator("html")).toHaveAttribute("data-theme-quiet", "");
    await page.locator('[data-slot="bottom-nav"] [data-nav="more"]').click();
    await page
      .locator('[data-slot="more-sheet"]')
      .getByRole("button", { name: /^Appearance/ })
      .click();
    await page.evaluate(() => {
      (window as unknown as { __log: string[] }).__log = [];
    });
    await page.locator('[data-slot="appearance-option"][data-value="dark"]').click();
    await expect(page.locator("html")).toHaveClass(/\bdark\b/);
    await expectHeldInItsFrame(page, "dark");
  });
});
