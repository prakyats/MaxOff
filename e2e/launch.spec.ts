import { type BrowserContext, expect, type Page, test } from "@playwright/test";

import { runInstalled, signIn, storageStateFor, USERS } from "./helpers";

/**
 * The launch, splash to first paint (task 2.7).
 *
 * - `/` (the installed app's `start_url`) is answered by the proxy from the home hint: one
 *   redirect to the role's home, no render first. A missing or stale hint falls through to
 *   `src/app/page.tsx`, which still lands home; the decision itself is unit-tested
 *   (`core/auth/home-hint.test.ts`).
 * - Sign-in goes straight home, never through `/`.
 * - The intro plays on an installed cold start only, is gone within a second, never shows on a
 *   client-side navigation, a reload or in a browser tab, and reduced motion drops the settle.
 * - The cold start adds nothing to the back stack.
 */

const HOME_HINT = "maxoff_home";
const intro = (page: Page) => page.locator('[data-slot="launch-intro"]');
const ROOT = /:\d+\/$/;

/** The hint as the server reads it (Next URL-encodes a cookie value it sets). */
async function hint(context: BrowserContext): Promise<string | undefined> {
  const value = (await context.cookies()).find((cookie) => cookie.name === HOME_HINT)?.value;
  return value === undefined ? undefined : decodeURIComponent(value);
}

test.describe("/ goes home in one redirect", () => {
  for (const role of ["owner", "staff"] as const) {
    test.describe(role, () => {
      test.use({ storageState: storageStateFor(role) });

      test("a matching hint: one redirect, straight to the home", async ({ page }) => {
        const response = await page.goto("/");
        expect(new URL(page.url()).pathname).toBe(USERS[role].home);
        const chain = [];
        for (let r = response?.request().redirectedFrom(); r; r = r.redirectedFrom()) {
          chain.push(new URL(r.url()).pathname);
        }
        expect(chain).toEqual(["/"]);
      });

      test("a stale or missing hint still lands home, through the page", async ({
        page,
        context,
        baseURL,
      }) => {
        await context.addCookies([
          {
            name: HOME_HINT,
            value: "10000000-0000-4000-8000-00000000dead|/my-day",
            url: baseURL!,
          },
        ]);
        await page.goto("/");
        await expect(page).toHaveURL(new RegExp(`${USERS[role].home}$`));

        await context.clearCookies({ name: HOME_HINT });
        await page.goto("/");
        await expect(page).toHaveURL(new RegExp(`${USERS[role].home}$`));
      });
    });
  }

  test.describe("signed out", () => {
    test.use({ storageState: { cookies: [], origins: [] } });

    test("goes to sign-in", async ({ page }) => {
      await page.goto("/");
      await expect(page).toHaveURL(/\/login$/);
    });

    test("sign-in lands on the home directly and sets the hint", async ({ page, context }) => {
      const documents: string[] = [];
      page.on("request", (request) => {
        if (request.isNavigationRequest()) documents.push(new URL(request.url()).pathname);
      });
      await signIn(page, USERS.owner.email, USERS.owner.password);
      await expect(page).toHaveURL(/\/today$/);
      expect(documents).not.toContain("/");
      expect(await hint(context)).toMatch(/\|\/today$/);
    });
  });

  test.describe("the day gate refreshes the hint", () => {
    test.use({ storageState: storageStateFor("staff") });

    test("a day with no pass sets the pass and the hint again", async ({ page, context }) => {
      await context.clearCookies({ name: HOME_HINT });
      await context.clearCookies({ name: "maxoff_day" });
      await page.goto("/my-day");
      await expect.poll(() => hint(context)).toMatch(/\|\/my-day$/);
    });
  });
});

test.describe("the launch intro", () => {
  test.use({ storageState: storageStateFor("owner") });

  test("installed cold start: plays, and is gone within a second", async ({ page }) => {
    await runInstalled(page);
    await page.goto("/", { waitUntil: "commit" });
    await expect(intro(page)).toBeHidden({ timeout: 1_000 });
    await expect(page).toHaveURL(/\/today$/);
    await expect(page.locator("html")).toHaveAttribute("data-launch", "");
    expect(await intro(page).evaluate((el) => getComputedStyle(el).animationName)).toBe(
      "launch-intro-out",
    );
    expect(
      await intro(page).evaluate((el) => getComputedStyle(el.querySelector("svg")!).animationName),
    ).toBe("launch-intro-settle");
  });

  test("never on a client-side navigation, a reload or a browser tab", async ({ page }) => {
    await runInstalled(page);
    await page.goto("/today");
    await expect(intro(page)).toBeHidden({ timeout: 1_000 });

    // Watch every frame from here on: the cover must not come back for a single one.
    await page.evaluate(() => {
      const w = window as unknown as { introSeen: boolean };
      w.introSeen = false;
      const el = document.querySelector('[data-slot="launch-intro"]')!;
      const sample = () => {
        const style = getComputedStyle(el);
        if (style.display !== "none" && style.visibility !== "hidden") w.introSeen = true;
        requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    });
    await page.locator('a[href="/approvals"]:visible').first().click();
    await expect(page).toHaveURL(/\/approvals$/);
    expect(await page.evaluate(() => (window as unknown as { introSeen: boolean }).introSeen)).toBe(
      false,
    );

    // A reload in the same window is not a cold start.
    await page.reload();
    await expect(page.locator("html")).not.toHaveAttribute("data-launch");
  });

  test("never in a browser tab", async ({ page }) => {
    await page.goto("/today");
    await expect(page.locator("html")).not.toHaveAttribute("data-launch");
    await expect(intro(page)).toBeHidden();
  });

  test("reduced motion: the fade without the settle", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await runInstalled(page);
    await page.goto("/today", { waitUntil: "commit" });
    await expect(intro(page)).toBeHidden({ timeout: 1_000 });
    expect(await intro(page).evaluate((el) => getComputedStyle(el).animationName)).toBe(
      "launch-intro-out",
    );
    expect(
      await intro(page).evaluate((el) => getComputedStyle(el.querySelector("svg")!).animationName),
    ).toBe("none");
  });

  test("adds nothing to the back stack: back from home never returns to /", async ({ page }) => {
    await runInstalled(page);
    await page.goto("/");
    await expect(page).toHaveURL(/\/today$/);
    // Whether Playwright's about:blank sits beneath varies (2.4 note), so assert the claim
    // itself: neither `/` nor the intro left an entry of ours.
    await page.goBack().catch(() => {});
    await expect(page).not.toHaveURL(ROOT);
  });

  test.describe("signed out", () => {
    test.use({ storageState: { cookies: [], origins: [] } });

    test("a cold start on sign-in plays it too", async ({ page }) => {
      await runInstalled(page);
      await page.goto("/", { waitUntil: "commit" });
      await expect(intro(page)).toBeHidden({ timeout: 1_000 });
      await expect(page).toHaveURL(/\/login$/);
      await expect(page.locator("html")).toHaveAttribute("data-launch", "");
    });
  });
});

test.describe("touch feel (§14.2 i)", () => {
  test.use({ storageState: storageStateFor("owner") });

  test("no tap highlight, no overscroll leak, no long-press selection on controls", async ({
    page,
  }) => {
    await page.goto("/today");
    const styles = await page.evaluate(() => {
      const html = getComputedStyle(document.documentElement);
      const body = getComputedStyle(document.body);
      const link = getComputedStyle(document.querySelector("a[href]")!);
      const button = getComputedStyle(document.querySelector("button")!);
      return {
        highlight: html.getPropertyValue("-webkit-tap-highlight-color"),
        htmlOverscroll: html.overscrollBehaviorY,
        bodyOverscroll: body.overscrollBehaviorY,
        linkSelect: link.userSelect,
        buttonSelect: button.userSelect,
      };
    });
    expect(styles).toEqual({
      highlight: "rgba(0, 0, 0, 0)",
      htmlOverscroll: "none",
      bodyOverscroll: "none",
      linkSelect: "none",
      buttonSelect: "none",
    });
  });
});
