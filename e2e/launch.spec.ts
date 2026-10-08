import { type BrowserContext, type Page } from "@playwright/test";

import { systemClock } from "../src/core/time";

import { expect, test } from "./fixtures";

import { expectNoHorizontalScroll, runInstalled, signIn, storageStateFor, USERS } from "./helpers";

/**
 * The launch, splash to first paint (task 2.7).
 *
 * - `/` (the installed app's `start_url` is `/?source=pwa`, the same to the proxy) is answered
 *   by the proxy from the home hint: one redirect to the role's home, no render first. A missing or stale hint falls through to
 *   `src/app/page.tsx`, which still lands home; the decision itself is unit-tested
 *   (`core/auth/home-hint.test.ts`).
 * - Sign-in goes straight home, never through `/`.
 * - The intro plays on an installed cold start only, is gone within a second, never shows on a
 *   client-side navigation, a reload or in a browser tab, and reduced motion drops the settle.
 * - The cold start adds nothing to the back stack.
 * - The launch screen (the owner's walk note 3, 2026-10-08): an installed launch
 *   (`start_url` `/?source=pwa`) whose document is slow is answered by the service worker with
 *   the brand screen, painted before the document's first byte, which hands over to home with no
 *   history entry; a document in time never shows it; signed out it lands on /login, offline on
 *   the offline page. The worker's decisions are unit-tested (`core/ui/pwa/sw-launch.test.ts`).
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

  // Start day refreshes the hint (3b.1): proved in `working-day.spec.ts`, where a person's day
  // is reset first; the saved Staff session here has already started theirs.
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

/** The installed app's `start_url` (manifest.webmanifest). */
const LAUNCH = "/?source=pwa";
/** The launch's own document request, made by the service worker. */
const isLaunchDocument = (url: URL) =>
  url.pathname === "/" && url.searchParams.get("source") === "pwa";
/** A cold Worker: the measured 1.5–2 s before the first byte (2026-10-08, staging). */
const COLD_DOCUMENT_MS = 2_000;
const launchScreen = (page: Page) => page.locator('[data-slot="launch-screen"]');
const PAINTS_KEY = "__e2eLaunchPaints";
type Paint = { address: string; launchScreen: boolean; fcp: number; at: number };

/** The service worker is active, so it answers this context's next navigations. */
async function workerActive(context: BrowserContext) {
  const prep = await context.newPage();
  await prep.goto("/offline");
  await prep.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
  await prep.close();
}

/** `history.length` in a fresh page after a plain load of `path`: what a launch must equal. */
async function freshHistoryLength(context: BrowserContext, path: string): Promise<number> {
  const fresh = await context.newPage();
  await fresh.goto(path);
  const length = await fresh.evaluate(() => history.length);
  await fresh.close();
  return length;
}

/**
 * Every document of the page notes its first contentful paint (wall-clock time too) in
 * `sessionStorage`, which survives the launch screen's hand-off. Playwright cannot read a page
 * while its next document is pending, which is exactly when the launch screen is on show.
 */
async function recordPaints(page: Page) {
  await page.addInitScript((key) => {
    try {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (entry.name !== "first-contentful-paint") continue;
          const paints = JSON.parse(sessionStorage.getItem(key) ?? "[]") as unknown[];
          paints.push({
            address: location.pathname + location.search,
            launchScreen: document.querySelector('[data-slot="launch-screen"]') !== null,
            fcp: entry.startTime,
            at: performance.timeOrigin + entry.startTime,
          });
          sessionStorage.setItem(key, JSON.stringify(paints));
        }
      }).observe({ type: "paint", buffered: true });
    } catch {
      // No storage: the assertions below find no paint and say so.
    }
  }, PAINTS_KEY);
}

const paints = (page: Page) =>
  page.evaluate((key) => JSON.parse(sessionStorage.getItem(key) ?? "[]") as Paint[], PAINTS_KEY);

/** Holds the launch's document like a cold Worker; returns when it was let through. */
async function coldDocument(context: BrowserContext): Promise<() => number> {
  let releasedAt = Number.POSITIVE_INFINITY;
  await context.route(isLaunchDocument, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, COLD_DOCUMENT_MS));
    releasedAt = systemClock().getTime();
    await route.continue();
  });
  return () => releasedAt;
}

/** The launch screen was painted, at the launch address, before the document was let through. */
async function expectLaunchScreenFirst(page: Page, releasedAt: number) {
  const screen = (await paints(page)).find((paint) => paint.launchScreen);
  expect(screen, "the launch screen was painted").toBeTruthy();
  expect(screen!.address).toBe(LAUNCH);
  expect(screen!.at, "painted before the document's first byte").toBeLessThan(releasedAt);
  // ~100 ms by design (the worker's race) plus the worker's start; the document is held 2 s.
  expect(screen!.fcp).toBeLessThan(COLD_DOCUMENT_MS / 2);
  test.info().annotations.push({
    type: "launch screen first paint",
    description: `${Math.round(screen!.fcp)} ms after the launch started`,
  });
}

test.describe("the launch screen (walk note 3)", () => {
  test.use({ storageState: storageStateFor("owner") });

  test("a cold document: the launch screen first, then home, adding no history", async ({
    page,
    context,
    reloadGuard,
  }) => {
    // The hand-off and the home it lands on are the loads this test proves.
    reloadGuard.allow(/\/\?launch=/);
    reloadGuard.allow(/\/today$/);
    await workerActive(context);
    const plain = await freshHistoryLength(context, "/today");
    await runInstalled(page);
    await recordPaints(page);
    const releasedAt = await coldDocument(context);

    await page.goto(LAUNCH, { waitUntil: "commit" });
    await expect(page).toHaveURL(/\/today$/);
    await expectLaunchScreenFirst(page, releasedAt());
    await expect(launchScreen(page)).toHaveCount(0);
    // The intro takes over from the screen: the same mark, then the fade (2.7).
    await expect(page.locator("html")).toHaveAttribute("data-launch", "");
    // The hand-off replaced the launch's entry: one back exits, as from any home (§14.2 c).
    expect(await page.evaluate(() => history.length)).toBe(plain);
    await page.goBack().catch(() => {});
    await expect(page).not.toHaveURL(/[?&](source|launch)=/);
  });

  test("a document in time: no launch screen, the launch exactly as before", async ({
    page,
    context,
  }) => {
    await workerActive(context);
    // A warm Worker: the server's own answer to the launch, given at once.
    const answer = await context.request.get(LAUNCH, { maxRedirects: 0 });
    expect(answer.status()).toBe(307);
    await context.route(isLaunchDocument, (route) => route.fulfill({ response: answer }));
    const committed: string[] = [];
    page.on("framenavigated", (frame) => {
      if (frame === page.mainFrame()) committed.push(new URL(frame.url()).pathname);
    });
    const screens: string[] = [];
    page.on("response", (response) => {
      if (response.headers()["x-maxoff-launch-screen"]) screens.push(response.url());
    });
    await recordPaints(page);

    await page.goto(LAUNCH);
    await expect(page).toHaveURL(/\/today$/);
    expect(screens).toEqual([]);
    expect(committed).toEqual(["/today"]);
    expect((await paints(page)).filter((paint) => paint.launchScreen)).toEqual([]);
  });

  test("offline: the launch screen while the worker retries, then the offline page", async ({
    page,
    context,
    reloadGuard,
  }) => {
    // The hand-off is the load this test proves.
    reloadGuard.allow(/\/\?launch=/);
    await workerActive(context);
    await recordPaints(page);
    await context.setOffline(true);

    await page.goto(LAUNCH, { waitUntil: "commit" });
    await expect(page).toHaveTitle(/Offline/);
    // Next's route announcer is a second role=alert, so target the composite itself.
    await expect(page.locator('[data-slot="error-state"]')).toContainText("offline");
    const screen = (await paints(page)).find((paint) => paint.launchScreen);
    expect(screen?.address).toBe(LAUNCH);
  });

  test.describe("signed out", () => {
    test.use({ storageState: { cookies: [], origins: [] } });

    test("a cold document: the launch screen first, then sign-in", async ({
      page,
      context,
      reloadGuard,
    }) => {
      // The hand-off and the sign-in it lands on are the loads this test proves.
      reloadGuard.allow(/\/\?launch=/);
      reloadGuard.allow(/\/login$/);
      await workerActive(context);
      await runInstalled(page);
      await recordPaints(page);
      const releasedAt = await coldDocument(context);

      await page.goto(LAUNCH, { waitUntil: "commit" });
      await expect(page).toHaveURL(/\/login$/);
      await expectLaunchScreenFirst(page, releasedAt());
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

/**
 * No zoom in the installed app where the system text size reaches it (§14.2 i, 2.7b; iOS 6.6):
 * Android, installed; an installed iPhone once it follows iOS's text size (the root font size is
 * the system body size over iOS's default 17px, kept within 100–200%). An iPhone above 200% (its
 * largest accessibility sizes) gets 200% and keeps pinch-zoom, as does one whose text size
 * cannot be read, and a browser tab is a website that always zooms. Playwright
 * cannot pinch, and Chromium has no `-apple-system-body`: what it proves is the setting, with
 * WebKit's answer for the probe stood in (`iosTextSize`); the owner's phone check proves the
 * effect. The layout at every root size up to 200% is the large-text sweep's (`mobile.spec.ts`).
 */
test.describe("zoom (§14.2 i)", () => {
  test.use({ storageState: storageStateFor("owner") });

  const zoom = (page: Page) =>
    page.evaluate(() => {
      const metas = [...document.querySelectorAll<HTMLMetaElement>('meta[name="viewport"]')];
      return {
        viewport: metas.at(-1)?.content ?? "",
        locked: document.documentElement.hasAttribute("data-zoom-lock"),
        touchAction: getComputedStyle(document.body).touchAction,
      };
    });
  const LOCKED = {
    viewport:
      "width=device-width, initial-scale=1, viewport-fit=cover, maximum-scale=1, user-scalable=no",
    locked: true,
    touchAction: "pan-x pan-y",
  };
  const OPEN = {
    viewport: "width=device-width, initial-scale=1, viewport-fit=cover",
    locked: false,
    touchAction: "auto",
  };

  test("installed (Android): locked, on every document, reloads included", async ({ page }) => {
    await runInstalled(page);
    await page.goto("/today");
    expect(await zoom(page)).toEqual(LOCKED);
    await page.reload();
    expect(await zoom(page)).toEqual(LOCKED);
  });

  const installedIphone = async (page: Page) => {
    // An iPhone is a phone: the desktop project runs these at the small phone's width.
    if ((page.viewportSize()?.width ?? 0) >= 768)
      await page.setViewportSize({ width: 375, height: 812 });
    await runInstalled(page);
    await page.addInitScript(() => {
      Object.defineProperty(window.navigator, "standalone", { value: true, configurable: true });
    });
  };
  /** What WebKit computes for `font: -apple-system-body` at the iPhone's text size setting. */
  const iosTextSize = (page: Page, bodyPx: number) =>
    page.addInitScript((px) => {
      const supports = CSS.supports.bind(CSS);
      CSS.supports = ((property: string, value?: string) =>
        property === "font" && value === "-apple-system-body"
          ? true
          : value === undefined
            ? supports(property)
            : supports(property, value)) as typeof CSS.supports;
      const computed = window.getComputedStyle.bind(window);
      window.getComputedStyle = ((element: Element, pseudo?: string | null) => {
        const style = computed(element, pseudo);
        if (!element.hasAttribute("data-system-text-probe")) return style;
        return new Proxy(style, {
          get: (target, key) =>
            key === "fontSize" ? `${px}px` : (Reflect.get(target, key, target) as unknown),
        });
      }) as typeof window.getComputedStyle;
    }, bodyPx);
  const rootSize = (page: Page) =>
    page.evaluate(() => ({
      inline: document.documentElement.style.fontSize,
      computed: getComputedStyle(document.documentElement).fontSize,
      attribute: document.documentElement.getAttribute("data-system-text"),
    }));

  test("installed on an iPhone: follows its text size, then locked", async ({ page }) => {
    await installedIphone(page);
    // iOS's "xxL" text size: 21px body text.
    await iosTextSize(page, 21);
    await page.goto("/today");
    expect(await zoom(page)).toEqual(LOCKED);
    expect(await rootSize(page)).toEqual({
      inline: "123.5%",
      computed: "19.76px",
      attribute: "123.5",
    });
    await expectNoHorizontalScroll(page);
    await page.reload();
    expect(await zoom(page)).toEqual(LOCKED);
    expect((await rootSize(page)).inline).toBe("123.5%");
  });

  test("installed on an iPhone at exactly 200%: the tested maximum, locked", async ({ page }) => {
    await installedIphone(page);
    // 34px body text is twice iOS's default: the large-text sweep's top.
    await iosTextSize(page, 34);
    await page.goto("/today");
    expect(await zoom(page)).toEqual(LOCKED);
    expect(await rootSize(page)).toEqual({ inline: "200%", computed: "32px", attribute: "200" });
    await expectNoHorizontalScroll(page);
  });

  test("installed on an iPhone above 200%: 200% at most, and pinch-zoom stays", async ({
    page,
  }) => {
    await installedIphone(page);
    // iOS's largest accessibility size: 53px body text, over three times the default. The app
    // stops at its tested 200%; the person can still pinch for the rest (decision 20).
    await iosTextSize(page, 53);
    await page.goto("/today");
    expect(await zoom(page)).toEqual(OPEN);
    expect(await rootSize(page)).toEqual({ inline: "200%", computed: "32px", attribute: "200" });
    await expectNoHorizontalScroll(page);
    await page.reload();
    expect(await zoom(page)).toEqual(OPEN);
  });

  test("installed on an iPhone at the default text size: the design's size, locked", async ({
    page,
  }) => {
    await installedIphone(page);
    await iosTextSize(page, 17);
    await page.goto("/today");
    expect(await zoom(page)).toEqual(LOCKED);
    expect(await rootSize(page)).toEqual({ inline: "", computed: "16px", attribute: "100" });
  });

  test("installed on an iPhone whose text size can't be read: still zooms", async ({ page }) => {
    await installedIphone(page);
    await page.goto("/today");
    expect(await zoom(page)).toEqual(OPEN);
    expect(await rootSize(page)).toEqual({ inline: "", computed: "16px", attribute: null });
  });

  test("a browser tab: still zooms", async ({ page }) => {
    await page.goto("/today");
    expect(await zoom(page)).toEqual(OPEN);
  });
});
