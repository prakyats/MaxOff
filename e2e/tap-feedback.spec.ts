import { type Locator, type Page, type Request, type Route, type TestInfo } from "@playwright/test";

import { expect, test } from "./fixtures";

import {
  actionId,
  animationsSettled,
  hydrated,
  pageHeader,
  resetAttendanceAndLeave,
  resetExpenseClaims,
  runInstalled,
  serviceDelete,
  serviceInsert,
  serviceSelect,
  serviceUpdate,
  signIn,
  startPrompt,
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
 *   has answered, and before hydration too; after 8 s one quiet line, "Still loading" with Retry
 *   (the same move again: no extra history entry), which after 25 s loads the destination in full;
 *   the bar never starts for a sheet closing or Start day, and never gets stuck;
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
  desktop: "20000000-0000-4000-8000-000000000076",
  mobile: "20000000-0000-4000-8000-000000000077",
  "mobile-lg": "20000000-0000-4000-8000-000000000078",
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
/** A call to that one server action. */
const callTo = (filename: string, exportedName: string) => {
  const id = actionId(filename, exportedName);
  return (request: Request) =>
    request.method() === "POST" && request.headers()["next-action"] === id;
};
const TEAM = "src/modules/team/actions/members.ts";
const CLAIMS = "src/modules/expenses/actions/claims.ts";
const NOTES = "src/modules/attendance/actions/notes.ts";

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

/** Counts every time the bar starts on this page (`data-nav-pending` set on `<html>`). */
async function recordBar(page: Page) {
  await page.addInitScript(() => {
    const record = { starts: 0 };
    (window as unknown as { __bar: typeof record }).__bar = record;
    new MutationObserver((changes) => {
      for (const change of changes) {
        const target = change.target as Element;
        if (target !== document.documentElement) continue;
        if (target.hasAttribute("data-nav-pending") && change.oldValue === null) record.starts++;
      }
    }).observe(document, {
      attributes: true,
      attributeOldValue: true,
      subtree: true,
      attributeFilter: ["data-nav-pending"],
    });
  });
}
const barStarts = (page: Page) =>
  page.evaluate(() => (window as unknown as { __bar: { starts: number } }).__bar.starts);

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
      .getByRole("button", { name: "Add person", exact: true })
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

  test("the bar's driver is listening before the shell takes taps", async ({ page }) => {
    // `NavProgress` counts the router's fetches once its effect has run (`data-nav-ready`); the
    // shell's tabs and links take taps once hydrated (`data-chrome`, which `hydrated` waits for).
    // The first must come before the second, always: inside a `<Suspense>` it hydrated after the
    // shell, so a tap in between sent a router fetch nobody counted and the bar stood down with
    // the screen still on its way, no "Still loading" and no Retry (CI run 37904970460,
    // intermittent: the gap widened with the page's work). Measured as the order in which
    // `<html>` gets the two marks, which never varies with speed: both are set from effects of
    // the one hydration commit, in tree order, or (the fault) from two different passes.
    await page.addInitScript(() => {
      const marks: string[] = [];
      (window as unknown as { __marks: string[] }).__marks = marks;
      new MutationObserver((changes) => {
        for (const change of changes) {
          const name = change.attributeName ?? "";
          const target = change.target as Element;
          if (target !== document.documentElement || change.oldValue !== null) continue;
          if (target.hasAttribute(name)) marks.push(name);
        }
      }).observe(document, {
        attributes: true,
        attributeOldValue: true,
        subtree: true,
        attributeFilter: ["data-nav-ready", "data-chrome"],
      });
    });
    await page.goto("/today");
    await hydrated(page);
    await expect(html(page)).toHaveAttribute("data-nav-ready", "");
    expect(await page.evaluate(() => (window as unknown as { __marks: string[] }).__marks)).toEqual(
      ["data-nav-ready", "data-chrome"],
    );
  });

  test("before hydration, a tap still starts the bar", async ({ page, isMobile, reloadGuard }) => {
    test.skip(!isMobile, "measured where hydration takes longest: the installed phone");
    // With the scripts held the app never takes the tap over: the head script loads the
    // destination itself after its wait (§14.2 l), a document load this test is about.
    reloadGuard.allow(/.*/);
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
    await page.goto("/today/people", { waitUntil: "commit" });
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

  test("after 8 s one quiet line: Still loading, Retry; Retry adds no entry", async ({
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
    // The bar alone for the first 8 s.
    await page.clock.fastForward(7_000);
    await expect(status).toHaveCount(0);
    await page.clock.fastForward(1_500);
    await expect(status).toHaveText("Still loadingRetry");
    const retry = status.getByRole("button", { name: "Retry" });
    // Quiet: underlined text, not a boxed or red button; still a 44px target.
    await expect(retry).toHaveCSS("text-decoration-line", "underline");
    expect((await retry.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);

    await retry.click();
    await slow.release();
    await page.clock.runFor(1_000);
    await expect(pageHeader(page).getByRole("heading", { name: "Tasks" })).toBeVisible();
    await page.clock.runFor(1_000);
    await expect(html(page)).not.toHaveAttribute("data-nav-pending");
    await expect(status).toHaveCount(0);
    // One tab move from home pushes one entry, however many times it was asked for (§14.2 c).
    expect(await page.evaluate(() => history.length)).toBe(before + 1);
    await page.goBack();
    await expect(page).toHaveURL(/\/today$/);
  });

  test("after 25 s Retry loads the destination in full", async ({
    page,
    isMobile,
    reloadGuard,
  }) => {
    test.skip(!isMobile, "measured on the installed phone");
    // The full load is the point of this test (§14.2 i).
    reloadGuard.allow(/.*/);
    await runInstalled(page);
    await page.clock.install();
    await holdScreen(page, "/tasks");
    await page.goto("/today");
    await hydrated(page);
    await page.evaluate(() => {
      (window as unknown as { __sameDocument: boolean }).__sameDocument = true;
    });
    await bottomTab(page, "/tasks").click();
    await page.clock.fastForward(26_000);
    const status = page.locator('[data-slot="nav-progress-status"]');
    await status.getByRole("button", { name: "Retry" }).click();
    await expect(page).toHaveURL(/\/tasks$/);
    await expect(pageHeader(page).getByRole("heading", { name: "Tasks" })).toBeVisible();
    expect(
      await page.evaluate(
        () => (window as unknown as { __sameDocument?: boolean }).__sameDocument === true,
      ),
      "a full load: a new document",
    ).toBe(false);
  });

  test("closing a sheet never starts the bar, even after a beforeunload that did not unload", async ({
    page,
    isMobile,
  }) => {
    test.skip(!isMobile, "the More sheet is the phone's");
    await runInstalled(page);
    await recordBar(page);
    await page.goto("/today");
    await hydrated(page);
    // What a tel: or mailto: link, or a download, does: beforeunload, and the page stays.
    await page.evaluate(() => window.dispatchEvent(new Event("beforeunload")));
    await page.locator('[data-slot="bottom-nav"] [data-nav="more"]').click();
    const sheet = page.getByRole("dialog");
    await expect(sheet).toBeVisible();
    await page.goBack();
    await expect(sheet).toBeHidden();
    await page.waitForTimeout(1_000);
    await expect(html(page)).not.toHaveAttribute("data-nav-pending");
    expect(await barStarts(page), "the bar never started").toBe(0);
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

  test("Start day: the bar finishes, and no Still loading line appears", async ({
    page,
    isMobile,
  }, info) => {
    if (isMobile) await runInstalled(page);
    await resetAttendanceAndLeave(tapPerson(info).id);
    await recordBar(page);
    await page.clock.install();
    await signIn(page, tapPerson(info).email, PASSWORD, { day: "stop" });
    const prompt = startPrompt(page);
    await expect(prompt).toBeVisible();
    await prompt.getByRole("button", { name: "Start day" }).click();
    await expect(prompt).toBeHidden();
    await expect(page.locator('[data-slot="start-day-prompt-mount"]')).toHaveCount(0);
    await page.clock.fastForward(11_000);
    await expect(page.locator('[data-slot="nav-progress-status"]')).toHaveCount(0);
    await expect(html(page)).not.toHaveAttribute("data-nav-pending");
    // Closing the prompt is a move back to the same address: not a navigation.
    expect(await barStarts(page), "no bar for Start day").toBe(0);
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

    const slow = await hold(page, callTo(TEAM, "updateOwnProfile"));
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
    const save = callTo(TEAM, "updateOwnProfile");
    await page.route("**/*", async (route) => {
      if (!save(route.request())) return route.fallback();
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
    if (isMobile) {
      // The band (two lines on a phone) never covers the sticky bar's Save: the bar sits above it.
      await animationsSettled(page);
      const bar = await page.locator('[data-slot="sticky-actions"]').boundingBox();
      const band = await banner.boundingBox();
      expect(bar && band, "both on screen").toBeTruthy();
      expect(bar!.y + bar!.height).toBeLessThanOrEqual(band!.y + 0.5);
    }

    await page.context().setOffline(false);
    await expect(banner).toBeHidden();
    await expect(commit).toBeEnabled();
  });
});

test.describe("a failed action never retries onto another item", () => {
  // Owner decisions on two claims; the desktop covers it (the sheets are shared components).
  test.use({ storageState: storageStateFor("owner") });
  // Both tests arrange and remove the same two claims: in parallel, one test's clean-up removed
  // the claim the other was about to open.
  test.describe.configure({ mode: "serial" });
  const A = { id: IDS.desktop ?? "", name: "Test Tap (desktop)", note: "Tap A: taxi" };
  const B = { id: IDS.mobile ?? "", name: "Test Tap (mobile)", note: "Tap B: parking" };

  test.beforeEach(async ({ isMobile }) => {
    test.skip(isMobile, "shared components: checked once, on the desktop");
    const [travel] = await serviceSelect<{ id: string }>(
      "list_items?list_key=eq.expense_category&name=eq.Travel&archived_at=is.null&select=id",
    );
    for (const claim of [A, B]) {
      await resetExpenseClaims(claim.id);
      await serviceInsert("expense_claims", {
        member_id: claim.id,
        expense_date: "2026-09-01",
        amount: 150,
        category_id: travel?.id,
        note: claim.note,
      });
    }
  });
  test.afterEach(async ({ isMobile }) => {
    if (isMobile) return;
    for (const claim of [A, B]) await resetExpenseClaims(claim.id);
  });

  const row = (page: Page, name: string) =>
    page.locator('[data-slot="approval-group"][data-group="expenses"] li', { hasText: name });

  test("Approve fails on one claim; the next claim's sheet offers no Retry", async ({ page }) => {
    const trap = callTo(CLAIMS, "approveExpenseClaim");
    let failNext = true;
    await page.route("**/*", (route) => {
      if (!trap(route.request()) || !failNext) return route.fallback();
      failNext = false;
      return route.abort("internetdisconnected");
    });
    await page.goto("/approvals");
    await hydrated(page);
    await row(page, A.name).getByRole("button", { name: "Review" }).click();
    const sheet = page.locator('[data-slot="review-sheet"]');
    await sheet.getByRole("button", { name: "Approve", exact: true }).click();
    await expect(sheet.locator('[data-slot="action-failed"]')).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(sheet).toBeHidden();

    await row(page, B.name).getByRole("button", { name: "Review" }).click();
    await expect(sheet).toContainText(B.note);
    await expect(sheet.locator('[data-slot="action-failed"]')).toHaveCount(0);
    await expect(sheet.getByRole("button", { name: "Retry" })).toHaveCount(0);
  });

  test("Reject fails on one claim; the next claim's reason dialog offers no Retry", async ({
    page,
  }) => {
    const trap = callTo(CLAIMS, "rejectExpenseClaim");
    let failNext = true;
    await page.route("**/*", (route) => {
      if (!trap(route.request()) || !failNext) return route.fallback();
      failNext = false;
      return route.abort("internetdisconnected");
    });
    await page.goto("/approvals");
    await hydrated(page);
    const sheet = page.locator('[data-slot="review-sheet"]');
    await row(page, A.name).getByRole("button", { name: "Review" }).click();
    await sheet.getByRole("button", { name: "Reject…" }).click();
    const dialog = page.getByRole("dialog", { name: /Reject .*'s claim\?/ });
    await dialog.getByLabel("Reason").fill("Not a work trip");
    await dialog.getByRole("button", { name: "Reject claim" }).click();
    await expect(dialog.locator('[data-slot="action-failed"]')).toBeVisible();
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toBeHidden();

    // The review sheet is still A's, beneath: close it, then open B.
    // Its own Close: a dialog closed by its button leaves its entry spent (PROGRESS, 3.4
    // mechanics 5), so a key or a back here would land on that spent entry first.
    await expect(sheet).toBeVisible();
    await sheet.getByRole("button", { name: "Close" }).click();
    await expect(sheet).toBeHidden();
    await row(page, B.name).getByRole("button", { name: "Review" }).click();
    await sheet.getByRole("button", { name: "Reject…" }).click();
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('[data-slot="action-failed"]')).toHaveCount(0);
    await expect(dialog.getByRole("button", { name: "Retry" })).toHaveCount(0);
  });

  test("Decide fails on one extra work note; the next note's dialog offers no Retry", async ({
    page,
  }) => {
    const notes = [
      { member: A, text: "Tap A: late edit" },
      { member: B, text: "Tap B: weekend shoot" },
    ];
    for (const { member } of notes) {
      await serviceDelete(`extra_work_notes?member_id=eq.${member.id}`);
    }
    for (const { member, text } of notes) {
      await serviceInsert("extra_work_notes", {
        member_id: member.id,
        work_date: "2026-09-01",
        kind: "overtime",
        duration_minutes: 60,
        note: text,
      });
    }
    try {
      const trap = callTo(NOTES, "decideExtraWorkNote");
      let failNext = true;
      await page.route("**/*", (route) => {
        if (!trap(route.request()) || !failNext) return route.fallback();
        failNext = false;
        return route.abort("internetdisconnected");
      });
      await page.goto("/approvals");
      await hydrated(page);
      const group = page.locator('[data-slot="approval-group"][data-group="extra-work"]');
      const noteRow = (name: string) =>
        group.locator('[data-slot="approval-row"]').filter({ hasText: name });
      const sheet = page.locator('[data-slot="review-sheet"]');
      const decide = page.locator('[data-slot="decide-note-dialog"]');

      await noteRow(A.name).getByRole("button", { name: "Review" }).click();
      await sheet.getByRole("button", { name: "Decide…" }).click();
      await decide.getByRole("radio", { name: "Grant 1 day of comp leave" }).check();
      await decide.getByRole("button", { name: "Grant comp leave" }).click();
      await expect(decide.locator('[data-slot="action-failed"]')).toBeVisible();
      await decide.getByRole("button", { name: "Cancel" }).click();
      await expect(decide).toBeHidden();
      // A's review sheet is beneath: its own Close (a dialog closed by its button leaves its
      // entry spent, PROGRESS 3.4 mechanics 5).
      await expect(sheet).toBeVisible();
      await sheet.getByRole("button", { name: "Close" }).click();
      await expect(sheet).toBeHidden();

      await noteRow(B.name).getByRole("button", { name: "Review" }).click();
      await expect(sheet).toContainText("Tap B: weekend shoot");
      await sheet.getByRole("button", { name: "Decide…" }).click();
      await expect(decide).toBeVisible();
      await expect(decide.locator('[data-slot="action-failed"]')).toHaveCount(0);
      await expect(decide.getByRole("button", { name: "Retry" })).toHaveCount(0);
    } finally {
      for (const { member } of notes) {
        await serviceDelete(`extra_work_notes?member_id=eq.${member.id}`);
      }
    }
  });
});
