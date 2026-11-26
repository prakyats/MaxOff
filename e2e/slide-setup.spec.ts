import { type Page } from "@playwright/test";

import { expect, test } from "./fixtures";

import { hydrated, runInstalled, storageStateFor } from "./helpers";

/**
 * The drill-down slide is set up on WebKit (v7.0, the advisor 26 Nov 2026). The iPhone CI project
 * runs with reduced motion: a headless runner renders view transitions with no GPU, and a slide
 * blocked WebKit's main thread 0.35–4.5 s there (`playwright.config.ts`). This spec turns motion
 * back on for its own page and checks, at each view transition's start, that the slide is named:
 * the direction on `<html>` (`data-nav-slide`), and the route the browser photographs carrying a
 * view-transition name and the slide's class (`globals.css`, `slide.ts`). The name is React's own
 * when its `<ViewTransition>` starts the slide (`_t_0_`, CI 45817905697) and `route` when the
 * attribute does (`slideBack`), so any name counts; `none` or none at all is the route not moving. **It never times the
 * slide**: how fast it runs on CI's WebKit says nothing about a phone. The slides themselves are
 * checked on Chromium (`motion.spec`), their feel on a real iPhone in the owner's walk.
 */
type SlideStart = { slide: string | null; name: string; className: string | null };

async function recordSlideStarts(page: Page) {
  await page.addInitScript(() => {
    const starts: { slide: string | null; name: string; className: string | null }[] = [];
    (window as unknown as { __slideStarts: typeof starts }).__slideStarts = starts;
    const real = document.startViewTransition?.bind(document);
    if (!real) return;
    const classes = CSS.supports("view-transition-class", "a");
    document.startViewTransition = ((arg: unknown) => {
      const route = document.querySelector('#main > [data-slot="route"]');
      const style = route ? getComputedStyle(route) : null;
      starts.push({
        slide: document.documentElement.getAttribute("data-nav-slide"),
        name: style?.getPropertyValue("view-transition-name").trim() ?? "",
        className: classes ? (style?.getPropertyValue("view-transition-class").trim() ?? "") : null,
      });
      return real(arg as never);
    }) as typeof document.startViewTransition;
  });
}

const slideStarts = (page: Page) =>
  page.evaluate(() => (window as unknown as { __slideStarts?: SlideStart[] }).__slideStarts ?? []);

/** The first start that slid `slide` with the route named, or undefined. */
async function namedStart(page: Page, slide: string): Promise<SlideStart | undefined> {
  return (await slideStarts(page)).find(
    (start) => start.slide === slide && start.name !== "" && start.name !== "none",
  );
}

test.describe("the drill-down slide is set up on WebKit", () => {
  test.skip(({ browserName }) => browserName !== "webkit", "WebKit's own check");
  test.use({ storageState: storageStateFor("owner") });

  test("a drill-down names the forward slide, and the on-screen back the back slide", async ({
    page,
  }) => {
    // Motion on for this page only: the project runs with reduced motion.
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await runInstalled(page);
    await recordSlideStarts(page);
    await page.goto("/today/people");
    await hydrated(page);

    await page.locator('[data-slot="board-row"]').first().click();
    // The move is waited for, never timed: CI's WebKit has no GPU for the transition.
    await expect(page).toHaveURL(/\/people\/[^/]+\/leave$/, { timeout: 20_000 });
    await expect
      .poll(() => namedStart(page, "forward"), { message: "the forward slide named the route" })
      .toBeDefined();
    const forward = await namedStart(page, "forward");
    if (forward?.className !== null) expect(forward?.className).toContain("nav-forward");

    await page.locator('[data-slot="page-back"]:visible').click();
    await expect(page).toHaveURL(/\/today\/people$/, { timeout: 20_000 });
    await expect
      .poll(() => namedStart(page, "back"), { message: "the back slide named the route" })
      .toBeDefined();
    const back = await namedStart(page, "back");
    if (back?.className !== null) expect(back?.className).toContain("nav-back");
  });
});
