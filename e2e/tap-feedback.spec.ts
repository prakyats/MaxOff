import { type Locator, type Page, type Request, type Route, type TestInfo } from "@playwright/test";

import { expect, test } from "./fixtures";

import {
  hydrated,
  pageHeader,
  runInstalled,
  serviceUpdate,
  signIn,
  storageStateFor,
} from "./helpers";

/**
 * Every tap is acknowledged (ARCHITECTURE §14.1 and §14.2 i, owner 2026-09-28), proved on a
 * connection made slow or broken on purpose: requests are **held** until the test releases them
 * or **aborted** as a dead network would, never timed, so nothing here depends on how fast the
 * machine is. Installed at 375 and 430 px (the phone projects), and in the desktop browser where
 * the behaviour is the same.
 *
 * - the pressed state is on the control the moment the pointer goes down;
 * - a navigation's progress bar and the tapped tab's highlight show at once, before the server
 *   has answered, and before hydration too; after 8 s the bar area says the connection is slow,
 *   after 10 s it offers Retry (the same move again: no extra history entry), after 25 s Reload;
 * - a commit button switches to its spinner and working label at once, a double tap sends one
 *   request, 8 s says the connection is slow, a failed request says so with Retry and keeps
 *   what was typed, and offline shows the banner and disables commit buttons.
 */

// These tests count and hold the page's own requests. A production build's service worker, once
// it controls the page, can take requests out of Playwright's sight (`page.route` and the request
// events), which made a refresh look like it never happened under load. The worker has its own
// spec (`pwa.spec.ts`); here it is kept out of the way.
test.use({ serviceWorkers: "block" });

const PASSWORD = "tap-local-password";
const IDS: Record<string, string> = {
  desktop: "20000000-0000-4000-8000-000000000056",
  mobile: "20000000-0000-4000-8000-000000000057",
  "mobile-lg": "20000000-0000-4000-8000-000000000058",
};
const tapPerson = (info: TestInfo) => ({
  id: IDS[info.project.name] ?? "",
  email: `tap-${info.project.name}@maxoff.local`,
});

/** A router fetch for a screen (not a prefetch), the thing a slow connection makes wait. */
const isScreenFetch = (request: Request, path: string) =>
  request.headers()["rsc"] === "1" &&
  !request.headers()["next-router-prefetch"] &&
  new URL(request.url()).pathname === path;
const isAction = (request: Request) =>
  request.method() === "POST" && Boolean(request.headers()["next-action"]);

/** The screen's prefetches: refused where a test needs the tap itself to wait on the server. */
const isPrefetchOf = (request: Request, path: string) =>
  Boolean(request.headers()["next-router-prefetch"]) && new URL(request.url()).pathname === path;

/**
 * Holds a screen's fetch until `release()`, and refuses its prefetches first, so the router has
 * nothing cached and the tap waits on the server as it would on a slow connection.
 */
async function holdScreen(page: Page, path: string) {
  await page.route("**/*", (route) =>
    isPrefetchOf(route.request(), path) ? route.abort() : route.fallback(),
  );
  return hold(page, (request) => isScreenFetch(request, path));
}

/** Holds matching requests until `release()`; counts them. */
async function hold(page: Page, match: (request: Request) => boolean) {
  const held: Route[] = [];
  let count = 0;
  let open = false;
  await page.route("**/*", async (route) => {
    if (!match(route.request())) return route.fallback();
    count++;
    if (open) return route.fallback();
    held.push(route);
  });
  return {
    count: () => count,
    release: async () => {
      open = true;
      for (const route of held.splice(0)) await route.fallback();
    },
  };
}

const bar = (page: Page) => page.locator('[data-slot="nav-progress-bar"]');
const html = (page: Page) => page.locator("html");
const bottomTab = (page: Page, href: string) =>
  page.locator(`[data-slot="bottom-nav"] a[href="${href}"]`);
const record = (page: Page) => page.locator('[data-slot="editable-record"]');
const confirmation = (page: Page) => page.getByRole("alertdialog", { name: "Save these changes?" });

/**
 * The control's look in the first frame after the pointer goes down, and how long after the
 * `pointerdown` that frame came: measured in the page, so the test's own round trips don't count.
 */
async function pressedLook(page: Page, target: Locator) {
  await target.evaluate((element) => {
    element.addEventListener(
      "pointerdown",
      (event) => {
        // From the event to the start of the first frame drawn after it: when the finger sees it.
        requestAnimationFrame((frame) => {
          const style = getComputedStyle(element);
          (window as unknown as { __press: object }).__press = {
            transform: style.transform,
            tint: style.backgroundImage,
            elapsed: frame - event.timeStamp,
          };
        });
      },
      { once: true },
    );
  });
  const box = await target.boundingBox();
  if (!box) throw new Error("the control is not on screen");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForFunction(() => "__press" in window);
  const look = await page.evaluate(() => {
    const press = (
      window as unknown as { __press: { transform: string; tint: string; elapsed: number } }
    ).__press;
    delete (window as unknown as { __press?: object }).__press;
    return press;
  });
  // Off the control before letting go: a press that is not a click, so nothing opens.
  await page.mouse.move(0, 0);
  await page.mouse.up();
  return look;
}

test.describe("the pressed state", () => {
  test.use({ storageState: storageStateFor("owner") });

  test("a button and a list row show it on pointer down, within 100 ms", async ({ page }) => {
    await page.goto("/people");
    await hydrated(page);
    const button = page
      .getByRole("button", { name: "Invite", exact: true })
      .filter({ visible: true });
    const pressedButton = await pressedLook(page, button);
    expect(pressedButton.tint, "the neutral tint").toContain("gradient");
    expect(pressedButton.transform, "the 0.97 press").not.toBe("none");
    expect(pressedButton.elapsed).toBeLessThan(100);

    const row = page.locator("main a[href^='/people/']").filter({ visible: true }).first();
    const pressedRow = await pressedLook(page, row);
    expect(pressedRow.tint, "a row is tinted").toContain("gradient");
    expect(pressedRow.transform, "a row does not shrink").toBe("none");
  });
});

test.describe("navigation shows it is on its way", () => {
  test.use({ storageState: storageStateFor("owner") });

  test("the bar and the tapped tab answer before the server does", async ({ page, isMobile }) => {
    test.skip(!isMobile, "the bottom bar is the phone's");
    await runInstalled(page);
    const slow = await holdScreen(page, "/tasks");
    await page.goto("/today");
    await hydrated(page);

    const tap = bottomTab(page, "/tasks");
    await tap.click();
    await expect(html(page)).toHaveAttribute("data-nav-pending", /\d+/, { timeout: 150 });
    await expect(bar(page)).toHaveCSS("opacity", "1", { timeout: 150 });
    await expect(tap).toHaveAttribute("data-nav-target", /\/tasks$/, { timeout: 150 });
    await expect(tap.locator('[data-slot="nav-label"]')).toHaveCSS("font-weight", "600");
    // Neutral, never red (§14.1): the bar is the foreground colour.
    const colours = await page.evaluate(() => ({
      bar: getComputedStyle(document.querySelector('[data-slot="nav-progress-bar"]')!)
        .backgroundColor,
      foreground: getComputedStyle(document.body).color,
    }));
    expect(colours.bar).toBe(colours.foreground);

    await slow.release();
    await expect(pageHeader(page).getByRole("heading", { name: "Tasks" })).toBeVisible();
    await expect(html(page)).not.toHaveAttribute("data-nav-pending");
    await expect(tap).not.toHaveAttribute("data-nav-target");
  });

  test("a sidebar link starts it too", async ({ page, isMobile }) => {
    test.skip(isMobile, "the sidebar is the desktop's");
    const slow = await holdScreen(page, "/people");
    await page.goto("/today");
    await hydrated(page);
    await page.locator('[data-slot="sidebar"] a[href="/people"]').click();
    await expect(html(page)).toHaveAttribute("data-nav-pending", /\d+/, { timeout: 150 });
    await slow.release();
    await expect(pageHeader(page).getByRole("heading", { name: "People" })).toBeVisible();
    await expect(html(page)).not.toHaveAttribute("data-nav-pending");
  });

  test("before hydration, a tap still starts the bar", async ({ page, isMobile }) => {
    test.skip(!isMobile, "measured where hydration takes longest: the installed phone");
    await runInstalled(page);
    // The page's scripts never arrive, so only the head script can answer the tap.
    await page.route(/\/_next\/static\/chunks\/.+\.js/, () => undefined);
    // When the tap arrived (window, capture: before the head script's own listener), on the
    // same epoch clock as the bar's own start stamp (the value of `data-nav-pending`).
    await page.addInitScript(() => {
      window.addEventListener(
        "click",
        () => {
          (window as unknown as { __tapAt: number }).__tapAt =
            performance.timeOrigin + performance.now();
        },
        true,
      );
    });
    await page.goto("/today", { waitUntil: "commit" });
    await expect(pageHeader(page)).toBeVisible();
    // No Content: the browser stays on this document, so what the tap did can be read.
    await page.route(/\/people\/[^/]+\/leave(\?|$)/, (route) =>
      route.request().resourceType() === "document"
        ? route.fulfill({ status: 204 })
        : route.fallback(),
    );
    await page.locator('[data-slot="board-row"]').first().click();
    const { tapAt, barAt } = await page.evaluate(() => ({
      tapAt: (window as unknown as { __tapAt: number }).__tapAt,
      barAt: Number(document.documentElement.getAttribute("data-nav-pending")),
    }));
    expect(barAt, "the bar started").toBeGreaterThan(0);
    expect(barAt - tapAt).toBeLessThan(150);
    await expect(bar(page)).toHaveCSS("opacity", "1");
  });

  test("a stuck navigation says so, offers Retry, then Reload; Retry adds no entry", async ({
    page,
    isMobile,
  }) => {
    test.skip(!isMobile, "installed tabs: the back stack is the point");
    await runInstalled(page);
    await page.clock.install();
    const slow = await holdScreen(page, "/tasks");
    await page.goto("/today");
    await hydrated(page);
    const before = await page.evaluate(() => history.length);

    await bottomTab(page, "/tasks").click();
    const status = page.locator('[data-slot="nav-progress-status"]');
    await page.clock.fastForward(8_500);
    await expect(status).toContainText("Still working… slow connection");
    await page.clock.fastForward(2_000);
    await expect(status).toContainText("Taking longer than usual");
    await expect(status.getByRole("button", { name: "Retry" })).toBeVisible();
    await page.clock.fastForward(15_000);
    await expect(status.getByRole("button", { name: "Reload" })).toBeVisible();

    await status.getByRole("button", { name: "Retry" }).click();
    await slow.release();
    await page.clock.runFor(1_000);
    await expect(pageHeader(page).getByRole("heading", { name: "Tasks" })).toBeVisible();
    await page.clock.runFor(1_000);
    await expect(html(page)).not.toHaveAttribute("data-nav-pending");
    await expect(status).toBeHidden();
    // One tab move from home pushes one entry, however many times it was asked for (§14.2 c).
    expect(await page.evaluate(() => history.length)).toBe(before + 1);
    await page.goBack();
    await expect(page).toHaveURL(/\/today$/);
  });
});

test.describe("a commit button shows it is working", () => {
  // One seeded person per project edits their own phone in each test, and each test puts it back:
  // in parallel, one test's clean-up landed in the middle of another's save.
  test.describe.configure({ mode: "serial" });

  async function openProfileEdit(page: Page, info: TestInfo, isMobile: boolean) {
    if (isMobile) await runInstalled(page);
    const person = tapPerson(info);
    await serviceUpdate(`members?id=eq.${person.id}`, { phone: null });
    await signIn(page, person.email, PASSWORD);
    await page.goto("/me");
    await hydrated(page);
    await page.getByRole("button", { name: "Edit profile" }).click();
  }

  test.afterEach(async ({}, info) => {
    await serviceUpdate(`members?id=eq.${tapPerson(info).id}`, { phone: null });
  });

  test("at once: spinner, working label, disabled; a double tap sends one request; slow is said", async ({
    page,
    isMobile,
  }, info) => {
    await page.clock.install();
    await openProfileEdit(page, info, isMobile);
    await page.getByLabel("Phone").fill("+91 90000 00056");
    await record(page).locator('[data-slot="save-record"]').click();
    await expect(confirmation(page)).toBeVisible();

    const slow = await hold(page, isAction);
    const commit = confirmation(page).locator('[data-slot="button"][data-variant="primary"]');
    await commit.dblclick();
    await expect(commit).toHaveAttribute("data-pending", "", { timeout: 100 });
    await expect(commit).toBeDisabled({ timeout: 100 });
    await expect(commit).toHaveAttribute("aria-busy", "true");
    await expect(commit.locator('[data-slot="button-pending"]')).toHaveText("Saving…");

    await page.clock.fastForward(8_500);
    await expect(confirmation(page).locator('[data-slot="action-slow"]')).toHaveText(
      "Still working… slow connection",
    );
    expect(slow.count(), "a double tap is one request").toBe(1);

    await slow.release();
    await page.clock.runFor(1_000);
    await expect(page.getByText("Profile saved")).toBeVisible();
    expect(slow.count()).toBe(1);
  });

  test("a failed request says so, keeps what was typed, and Retry sends it", async ({
    page,
    isMobile,
  }, info) => {
    await openProfileEdit(page, info, isMobile);
    await page.getByLabel("Phone").fill("+91 90000 00057");
    await record(page).locator('[data-slot="save-record"]').click();

    let attempts = 0;
    await page.route("**/*", async (route) => {
      if (!isAction(route.request())) return route.fallback();
      attempts++;
      // The first try dies on the network, as a dropped phone connection does.
      if (attempts === 1) return route.abort("internetdisconnected");
      return route.fallback();
    });
    await confirmation(page).getByRole("button", { name: "Save" }).click();
    const failed = confirmation(page).locator('[data-slot="action-failed"]');
    await expect(failed).toContainText(
      "Couldn't reach MaxOff. Check your connection and try again.",
    );
    // Nothing is lost: the confirmation is still open over the form as it was typed.
    await expect(confirmation(page)).toContainText("+91 90000 00057");
    await expect(page.getByLabel("Phone")).toHaveValue("+91 90000 00057");

    await failed.getByRole("button", { name: "Retry" }).click();
    await expect(page.getByText("Profile saved")).toBeVisible();
    await expect(record(page)).toContainText("+91 90000 00057");
    expect(attempts).toBe(2);
  });

  test("offline: the banner, and commit buttons wait for the connection", async ({
    page,
    isMobile,
  }, info) => {
    await openProfileEdit(page, info, isMobile);
    await page.getByLabel("Phone").fill("+91 90000 00058");
    await record(page).locator('[data-slot="save-record"]').click();
    const commit = confirmation(page).getByRole("button", { name: "Save" });
    await expect(commit).toBeEnabled();

    await page.context().setOffline(true);
    const banner = page.locator('[data-slot="offline-banner"]');
    await expect(banner).toHaveText(
      "You're offline. Changes won't be saved until you're back online.",
    );
    await expect(commit).toBeDisabled();
    await expect(commit).toHaveAttribute("aria-describedby", "offline-banner");

    await page.context().setOffline(false);
    await expect(banner).toBeHidden();
    await expect(commit).toBeEnabled();
  });
});
