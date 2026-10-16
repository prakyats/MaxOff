import { type BrowserContext, type Locator, type Page, type Route } from "@playwright/test";

import { PREFETCH_FIRST_ROWS } from "../src/core/ui/navigation/prefetch-choice";
import { mobileNavFor } from "../src/core/ui/shell/nav";

import { expect, test } from "./fixtures";
import {
  hydrated,
  memberIdOf,
  ownSession,
  removeClientFixture,
  rpcAs,
  runInstalled,
  serviceInsert,
  serviceSelect,
  storageStateFor,
  USERS,
  watchReads,
} from "./helpers";

/**
 * Prefetch the likely next screen (P2 item 6; ARCHITECTURE §19 "Prefetch the likely next
 * screen", `core/ui/navigation/prefetch-choice.ts`).
 *
 * - **A prefetch is the loading boundary, never the page's data.** The tabs Today's next tap
 *   goes to (Approvals, Tasks) are prefetched by the shell and by Today's own links; counted at
 *   the e2e server's Supabase proxy (`watchReads`), their prefetches read only the viewer's
 *   member row (the loading screen is shaped by the role), never the page's data.
 *   A client row's makes only its layout's (the header: the client, the people, the unread
 *   count, the member), never the overview's own reads (contacts, notes, fields, open tasks).
 * - **Only the first rows prefetch in view** on a list whose rows' pages read their record (the
 *   Clients and People lists): the first `PREFETCH_FIRST_ROWS`; a later row is prefetched when a
 *   finger goes down on it, which adds no history entry and does not navigate.
 * - **A likely-next tap shows its skeleton at once**: with every server answer held `SLOW_MS` (a
 *   warm Worker far away), a first row's tap shows the client's traced skeleton within
 *   `INSTANT_MS`; a later row's tap is measured and reported.
 * - **Data saver asks for nothing extra**: no row prefetch, no ahead-of-time prefetch of the More
 *   sheet's destinations; without it, the same destinations are prefetched (the check bites).
 *
 * The service worker is blocked in this file: what is measured is the server's work and the
 * router's, and the worker never keeps a client's page (ADR-0014); `instant-skeleton.spec.ts`
 * covers what it keeps.
 */

/** A warm Worker answering from far away: the tap's own request takes this long. */
const SLOW_MS = 600;
/** The promise for a prefetched row: its traced skeleton within this of the finger going down. */
const INSTANT_MS = 300;
/** How long a finger rests on the glass in a tap. */
const TAP_HOLD_MS = 80;
/** Cards the list shows before "Show more" (DataTable `mobilePageSize`). */
const CARDS_SHOWN = 10;

/** The viewer's member row: what a role-shaped loading screen reads (`requireMember`). */
const MEMBER_ROW = "/rest/v1/members";
/** The reads a client page's layout makes (its header and read receipt), and no other. */
const CLIENT_LAYOUT_READS = new Set([
  "/rest/v1/clients",
  "/rest/v1/member_directory",
  "/rest/v1/notifications",
  "/rest/v1/members",
]);
/** The overview page's own reads: never made by a prefetch. */
const CLIENT_PAGE_READS = [
  "/rest/v1/client_contacts",
  "/rest/v1/client_private",
  "/rest/v1/field_definitions",
  "/rest/v1/tasks",
];

const CLIENT_ROW = /^\/clients\/[0-9a-f-]{36}$/;

const isPrefetch = (headers: Record<string, string>) =>
  headers["rsc"] === "1" && headers["next-router-prefetch"] === "1";

const fixtureClients = (project: string) =>
  Array.from({ length: 7 }, (_, i) => `Prefetch Likely ${project}: Client ${i + 1}`);

/**
 * Every router prefetch the page makes, by pathname (the route tree's and the loading
 * boundary's). **Every one is held** (it never reaches the server) until `release(match)` lets
 * those whose pathname matches go, so the server's work in a window is theirs alone; each is
 * read to its end from the server before the page gets it, so its database requests are over
 * once it is `answered`.
 */
async function trackPrefetches(context: BrowserContext, origin: string) {
  const asked = new Set<string>();
  const askedCount = new Map<string, number>();
  const answered = new Map<string, number>();
  const passes: Array<(path: string) => boolean> = [];
  const waiting: Array<{ path: string; go: () => void }> = [];
  const passing = (path: string) => passes.some((match) => match(path));
  await context.route(
    (url) => url.origin === origin && url.searchParams.has("_rsc"),
    async (route: Route) => {
      const request = route.request();
      if (!isPrefetch(request.headers())) return route.fallback();
      const path = new URL(request.url()).pathname;
      asked.add(path);
      askedCount.set(path, (askedCount.get(path) ?? 0) + 1);
      if (!passing(path)) await new Promise<void>((go) => waiting.push({ path, go }));
      const response = await route.fetch().catch(() => null);
      if (!response) return route.abort().catch(() => undefined);
      const body = await response.text().catch(() => "");
      answered.set(path, (answered.get(path) ?? 0) + 1);
      await route.fulfill({ response, body }).catch(() => undefined);
    },
  );
  return {
    asked,
    answered,
    /** How many prefetch requests have been answered so far, every path together. */
    answeredTotal: () => [...answered.values()].reduce((sum, count) => sum + count, 0),
    /** Every prefetch let go so far has been answered (the held ones aside). */
    settled: () =>
      [...askedCount].every(
        ([path, count]) => !passing(path) || (answered.get(path) ?? 0) === count,
      ),
    release(match: (path: string) => boolean) {
      passes.push(match);
      for (const entry of waiting.splice(0)) {
        if (passing(entry.path)) entry.go();
        else waiting.push(entry);
      }
    },
  };
}

/**
 * The app's background calls (`/api/*`: the open report, the bell's count, the warm-up) are
 * refused in a counting test: they run on their own clock, so one landing in the window would be
 * counted as the prefetch's. The page ignores their failure (ARCHITECTURE §4.4).
 */
async function quietBackground(context: BrowserContext, origin: string): Promise<void> {
  await context.route(
    (url) => url.origin === origin && url.pathname.startsWith("/api/"),
    (route) => route.abort(),
  );
}

/** The page's requests still on their way, router prefetches aside (those are held above). */
function inFlight(page: Page) {
  const open = new Set<unknown>();
  page.on("request", (request) => {
    if (!isPrefetch(request.headers())) open.add(request);
  });
  const done = (request: unknown) => open.delete(request);
  page.on("requestfinished", done);
  page.on("requestfailed", done);
  return () => open.size;
}

/** A finger down on `target`, held, then up (the browser makes the click) or slid off (none). */
async function finger(target: Locator, end: "tap" | "cancel"): Promise<void> {
  const page = target.page();
  const box = await target.boundingBox();
  expect(box, "the target is on screen").not.toBeNull();
  const point = { x: box!.x + box!.width / 2, y: box!.y + box!.height / 2 };
  const input = await page.context().newCDPSession(page);
  await input.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [point] });
  await page.waitForTimeout(TAP_HOLD_MS);
  await input.send("Input.dispatchTouchEvent", {
    type: end === "tap" ? "touchEnd" : "touchCancel",
    touchPoints: [],
  });
  await input.detach();
}

/** Taps `target` like a finger; ms from the finger going down until `selector` is on screen. */
async function tapUntil(target: Locator, selector: string): Promise<number | null> {
  const page = target.page();
  await target.click({ trial: true });
  await page.evaluate((wanted) => {
    const w = window as unknown as { __shownAt?: number | null; __tapAt?: number };
    w.__shownAt = null;
    const poll = () => {
      if (document.querySelector<HTMLElement>(wanted)?.checkVisibility()) {
        w.__shownAt = performance.now() - w.__tapAt!;
        return;
      }
      if (performance.now() - w.__tapAt! < 10_000) requestAnimationFrame(poll);
    };
    window.addEventListener(
      "touchstart",
      () => {
        w.__tapAt = performance.now();
        requestAnimationFrame(poll);
      },
      { capture: true, once: true },
    );
  }, selector);
  await finger(target, "tap");
  await page
    .waitForFunction(() => (window as { __shownAt?: number | null }).__shownAt != null, null, {
      timeout: 10_000,
    })
    .catch(() => undefined);
  return page.evaluate(() => {
    const at = (window as { __shownAt?: number | null }).__shownAt;
    return at == null ? null : Math.round(at);
  });
}

/** Data saver on, as Chromium reports it (`navigator.connection.saveData`). */
async function saveData(page: Page): Promise<void> {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "connection", {
      configurable: true,
      value: { saveData: true, addEventListener() {}, removeEventListener() {} },
    });
  });
}

function report(name: string, value: string) {
  test.info().annotations.push({ type: "prefetch", description: `${name}: ${value}` });
}

test.use({ storageState: storageStateFor("owner"), serviceWorkers: "block" });

test.describe("a prefetch is the loading boundary, never the page's data", () => {
  test("Today's likely next tabs, Approvals and Tasks, read no page data", async ({
    page,
    context,
    baseURL,
  }) => {
    const session = await ownSession(page, USERS.owner.email, USERS.owner.password);
    const NEXT = ["/approvals", "/tasks"];
    const prefetches = await trackPrefetches(context, new URL(baseURL!).origin);
    // Every other prefetch goes as it comes; these two wait for the window.
    prefetches.release((path) => !NEXT.includes(path));
    await quietBackground(context, new URL(baseURL!).origin);
    const open = inFlight(page);
    const watch = await watchReads(session);
    try {
      await page.goto("/today");
      await hydrated(page);
      await expect(page.locator('[data-slot="loading-state"]')).toHaveCount(0);
      // Everything else the page asked for is over: what the server reads next is the held ones'.
      await expect.poll(() => NEXT.every((path) => prefetches.asked.has(path))).toBe(true);
      await expect.poll(() => open() === 0 && prefetches.settled()).toBe(true);
      const before = watch.server().length;
      const answeredBefore = prefetches.answeredTotal();

      prefetches.release((path) => NEXT.includes(path));
      // The route tree and the loading boundary of each, read to their end.
      await expect
        .poll(() => NEXT.every((path) => (prefetches.answered.get(path) ?? 0) >= 2))
        .toBe(true);
      await expect.poll(() => open() === 0 && prefetches.settled()).toBe(true);
      const reads = watch.server().slice(before);
      report(
        "Today → Approvals + Tasks prefetches: database requests / prefetch requests",
        `${reads.length} / ${prefetches.answeredTotal() - answeredBefore}`,
      );
      // The viewer's member row alone (the loading screen is shaped by the role), at most once each.
      expect(
        reads.filter((path) => path !== MEMBER_ROW),
        "the tabs' prefetches read no page data",
      ).toEqual([]);
      // One per request at most: the router may ask a route again (a link and the shell).
      expect(reads.length).toBeLessThanOrEqual(prefetches.answeredTotal() - answeredBefore);
    } finally {
      watch.stop();
    }
  });
});

test.describe("a list row prefetches in view only near the top", () => {
  test.describe.configure({ mode: "serial" });
  test.skip(({ isMobile }) => !isMobile, "the cards are the phone's list");

  test.beforeAll(async ({}, info) => {
    const names = fixtureClients(info.project.name);
    for (const name of names) await removeClientFixture(name);
    const [org] = await serviceSelect<{ id: string }>("organizations?select=id&limit=1");
    const admin = await memberIdOf(USERS.admin.email);
    for (const name of names) {
      const client = await serviceInsert<{ id: string }>("clients", {
        org_id: org?.id,
        name,
        admin_id: admin,
      });
      await rpcAs(USERS.owner.email, USERS.owner.password, "client_activate", {
        client_id: client.id,
      });
    }
  });
  test.afterAll(async ({}, info) => {
    for (const name of fixtureClients(info.project.name)) await removeClientFixture(name);
  });

  test("the first rows only, their layout's reads alone; a finger on a later row prefetches it", async ({
    page,
    context,
    baseURL,
  }) => {
    const session = await ownSession(page, USERS.owner.email, USERS.owner.password);
    const prefetches = await trackPrefetches(context, new URL(baseURL!).origin);
    const isRow = (path: string) => CLIENT_ROW.test(path);
    prefetches.release((path) => !isRow(path));
    await quietBackground(context, new URL(baseURL!).origin);
    const open = inFlight(page);
    await runInstalled(page);
    const watch = await watchReads(session);
    try {
      await page.goto("/clients");
      await hydrated(page);
      const cards = page.locator('[data-slot="data-card-link"]');
      await expect(cards.nth(PREFETCH_FIRST_ROWS + 2)).toBeVisible();
      const hrefs = (await cards.evaluateAll((links) =>
        links.map((link) => link.getAttribute("href") ?? ""),
      )) as string[];
      expect(hrefs.length).toBeGreaterThanOrEqual(PREFETCH_FIRST_ROWS + 3);
      const first = hrefs.slice(0, PREFETCH_FIRST_ROWS);
      const later = hrefs.slice(PREFETCH_FIRST_ROWS, CARDS_SHOWN);

      await expect.poll(() => first.every((href) => prefetches.asked.has(href))).toBe(true);
      await expect.poll(() => open() === 0 && prefetches.settled()).toBe(true);
      const before = watch.server().length;
      prefetches.release(isRow);
      await expect
        .poll(() => first.every((href) => (prefetches.answered.get(href) ?? 0) >= 2))
        .toBe(true);
      await expect.poll(() => open() === 0 && prefetches.settled()).toBe(true);
      const reads = watch.server().slice(before);
      report(
        `the first ${PREFETCH_FIRST_ROWS} client rows' prefetches, database requests`,
        String(reads.length),
      );
      expect(
        reads.filter((path) => !CLIENT_LAYOUT_READS.has(path)),
        "a row's prefetch reads only what its layout reads",
      ).toEqual([]);
      for (const path of CLIENT_PAGE_READS) expect(reads).not.toContain(path);
      expect(reads.length, "the layout's reads and the member row, per row").toBeLessThanOrEqual(
        PREFETCH_FIRST_ROWS * (CLIENT_LAYOUT_READS.size + 2),
      );
      // The rows below the first few are seen, and not prefetched.
      for (const href of later) expect(prefetches.asked.has(href), href).toBe(false);

      // A finger on a later row, slid off: its prefetch, no navigation, no history entry.
      const historyBefore = await page.evaluate(() => history.length);
      const target = cards.nth(PREFETCH_FIRST_ROWS + 1);
      const targetHref = later[1]!;
      await target.click({ trial: true });
      await finger(target, "cancel");
      await expect.poll(() => prefetches.answered.get(targetHref) ?? 0).toBeGreaterThan(0);
      await expect(page).toHaveURL(/\/clients$/);
      expect(await page.evaluate(() => history.length)).toBe(historyBefore);
      // And the other later rows are still not asked for.
      for (const href of later)
        if (href !== targetHref) expect(prefetches.asked.has(href)).toBe(false);
    } finally {
      watch.stop();
    }
  });

  test("with data saver on, no row is prefetched, the first ones included", async ({ page }) => {
    await saveData(page);
    const asked = new Set<string>();
    page.on("request", (request) => {
      if (isPrefetch(request.headers())) asked.add(new URL(request.url()).pathname);
    });
    await page.goto("/clients");
    await hydrated(page);
    await expect(
      page.locator('[data-slot="data-card-link"]').nth(PREFETCH_FIRST_ROWS),
    ).toBeVisible();
    await page.waitForLoadState("networkidle");
    expect([...asked].filter((path) => CLIENT_ROW.test(path))).toEqual([]);
  });

  test("a first row's tap shows its skeleton at once; a later row's is measured", async ({
    page,
    context,
    baseURL,
  }) => {
    const origin = new URL(baseURL!).origin;
    await runInstalled(page);
    const prefetches = await trackPrefetches(context, origin);
    prefetches.release(() => true);
    await page.goto("/clients");
    await hydrated(page);
    const cards = page.locator('[data-slot="data-card-link"]');
    await expect(cards.nth(PREFETCH_FIRST_ROWS + 2)).toBeVisible();
    const firstHref = (await cards.nth(0).getAttribute("href"))!;
    // Its route tree and its loading boundary both in, and nothing else still on its way.
    await expect
      .poll(() => (prefetches.answered.get(firstHref) ?? 0) >= 2 && prefetches.settled())
      .toBe(true);
    // From here every server answer takes SLOW_MS.
    await context.route(
      (url) => url.origin === origin && !url.pathname.startsWith("/_next/static/"),
      async (route) => {
        await new Promise((resolve) => setTimeout(resolve, SLOW_MS));
        await route.continue().catch(() => undefined);
      },
    );
    const historyAtList = await page.evaluate(() => history.length);

    const skeleton = '[data-slot="loading-client-overview"]';
    const firstMs = await tapUntil(cards.nth(0), skeleton);
    report("client row 1 (prefetched in view): tap → traced skeleton", `${firstMs} ms`);
    expect(firstMs, "the first row's traced skeleton").not.toBeNull();
    expect(firstMs!).toBeLessThanOrEqual(INSTANT_MS);
    await expect(page.locator('[data-slot="client-overview"]')).toBeVisible({
      timeout: SLOW_MS * 8,
    });
    // The tap pushed its one entry, as before (§14.2 b); back returns to the list.
    expect(await page.evaluate(() => history.length)).toBe(historyAtList + 1);
    await page.goBack();
    await expect(page).toHaveURL(/\/clients$/);

    // A later row: prefetched as the finger goes down; skeleton or content, whichever is first.
    const later = cards.nth(PREFETCH_FIRST_ROWS + 1);
    const laterMs = await tapUntil(later, `${skeleton}, [data-slot="client-overview"]`);
    report("client row 6 (prefetched on the finger): tap → skeleton or content", `${laterMs} ms`);
    expect(laterMs, "the later row opens").not.toBeNull();
    await expect(page.locator('[data-slot="client-overview"]')).toBeVisible({
      timeout: SLOW_MS * 8,
    });
    // Its push took the place of the first row's spent entry: nothing else was added.
    expect(await page.evaluate(() => history.length)).toBe(historyAtList + 1);
    await page.goBack();
    await expect(page).toHaveURL(/\/clients$/);
  });
});

test.describe("data saver asks for nothing extra", () => {
  test.skip(({ isMobile }) => !isMobile, "the More sheet's destinations are the phone's");

  /** The More sheet's destinations (not on screen at /today: only the shell prefetches them). */
  const MORE = mobileNavFor("owner").more.map((item) => item.href);

  async function prefetchedOnToday(page: Page) {
    const asked = new Set<string>();
    page.on("request", (request) => {
      if (isPrefetch(request.headers())) asked.add(new URL(request.url()).pathname);
    });
    await page.goto("/today");
    await hydrated(page);
    await expect(page.locator('[data-slot="loading-state"]')).toHaveCount(0);
    // The bar's own links are prefetched either way: wait for them, then the rest has had its turn.
    await expect.poll(() => asked.has("/approvals") && asked.has("/tasks")).toBe(true);
    await page.waitForLoadState("networkidle");
    // A destination Today itself links to on screen is prefetched by that link either way.
    const linked = await page.evaluate((hrefs) => {
      return hrefs.filter((href) =>
        [...document.querySelectorAll<HTMLAnchorElement>("a[href]")].some(
          (link) => new URL(link.href).pathname === href && link.checkVisibility(),
        ),
      );
    }, MORE);
    return { asked, onlyShell: MORE.filter((href) => !linked.includes(href)) };
  }

  test("without it, the shell prefetches the More sheet's destinations", async ({ page }) => {
    const { asked, onlyShell } = await prefetchedOnToday(page);
    expect(onlyShell.length, "some destination only the shell prefetches").toBeGreaterThan(0);
    for (const href of onlyShell) expect(asked.has(href), href).toBe(true);
  });

  test("with it, the shell prefetches none of them", async ({ page }) => {
    await saveData(page);
    const { asked, onlyShell } = await prefetchedOnToday(page);
    expect(onlyShell.length).toBeGreaterThan(0);
    for (const href of onlyShell) expect(asked.has(href), href).toBe(false);
  });
});
