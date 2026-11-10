import { expect, test } from "./fixtures";

import { hydrated, storageStateFor } from "./helpers";

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
    const log = () => page.evaluate(() => (window as unknown as { __log: string[] }).__log);
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
