import { readFileSync } from "node:fs";
import { join } from "node:path";

import { type BrowserContext, type Locator, type Page, type TestInfo } from "@playwright/test";

import { addISTDays, istInstant, todayIST } from "../src/core/time";
import { mobileNavFor, PROFILE_NAV_ITEM } from "../src/core/ui/shell/nav";

import { expect, test } from "./fixtures";
import {
  hydrated,
  memberIdOf,
  ownSession,
  removeClientFixture,
  removeTasksTitled,
  rpcAs,
  runInstalled,
  serviceInsert,
  serviceSelect,
  type SessionRole,
  storageStateFor,
  taskTypeId,
  USERS,
} from "./helpers";

/**
 * The instant skeleton (P2, ADR-0014; ARCHITECTURE §14 and §19). A tap shows its destination's
 * traced loading skeleton at once even while the Worker is cold, because the service worker
 * answers the router's prefetch of that skeleton from its cache (`public/sw.js`, `SHELL_PATHS`
 * and `SHELL_DRILL_DOWN`); the data on screen still comes from the network.
 *
 * - **The cached prefetches carry no member data**, for every role: every address the worker may
 *   keep that the role's shell prefetches (its bar, its More sheet, the bell) is read as the
 *   server sends it, and none holds a record id but its own, a date, the viewer's name or email,
 *   or a server promise handed to the page; between them the roles prefetch every kept address.
 *   `/leave`, which the worker must never keep (its layout hands the comp leave balance and
 *   today's date to the page), fails the same checks on the payload the worker would keep of it
 *   (its loading-boundary prefetch): they bite.
 * - **Installed, on a cold Worker** (every server answer held `COLD_MS`, the service worker's own
 *   requests included), at 375 and 430px: after a day's warm visit the app is opened again, and a
 *   bottom-bar tab, a task row and a More-sheet destination each show their traced skeleton
 *   within `INSTANT_MS` of the finger going down; the content that follows is the network's (a
 *   task made after the skeletons were kept shows up), and back and the tab history behave as
 *   before (§14.2; `back-gesture.spec.ts` keeps the full rules).
 *
 * A tap is a finger's (`fingerTap`): the browser's own touch input, down, held `TAP_HOLD_MS`, then
 * up, and the browser makes the click, so the router's touch-intent prefetch runs as it does on a
 * phone. The time runs from the finger going down on a target that is already tappable (a sheet
 * still sliding in is not tapped, by a finger or here), so it counts the app's work and the
 * finger's rest, never the test runner's own checks.
 */

/** A cold Worker's first byte (unit P measured 1.5–4.5 s on the platform). */
const COLD_MS = 3_000;
/** The promise: the traced skeleton within this of the tap. */
const INSTANT_MS = 300;
/** How long a finger rests on the glass in a tap. */
const TAP_HOLD_MS = 80;
const SHELL_CACHE = "maxoff-shell-v9";

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;
const ISO_DATE = /\b20\d\d-[01]\d-[0-3]\d\b/;

/** The addresses the worker may keep, read from the worker itself. */
function shellPaths(): Set<string> {
  const sw = readFileSync(join(process.cwd(), "public", "sw.js"), "utf8");
  const list = /const SHELL_PATHS = new Set\(\[([\s\S]*?)\]\)/.exec(sw)?.[1] ?? "";
  return new Set([...list.matchAll(/"([^"]+)"/g)].map((match) => match[1]!));
}
const SHELL_DRILL_DOWN = /^\/tasks\/[0-9a-f-]{36}$/;
const isPrefetch = (headers: Record<string, string>) =>
  headers["rsc"] === "1" && headers["next-router-prefetch"] === "1";

type Viewer = { id: string; full_name: string; email: string | null };

/** What in a prefetch's payload would be a member's data. */
function memberDataIn(body: string, address: string, viewer: Viewer): string[] {
  const own = new Set(address.match(UUID) ?? []);
  const found: string[] = [];
  for (const id of body.match(UUID) ?? []) if (!own.has(id)) found.push(`an id (${id})`);
  const date = ISO_DATE.exec(body);
  if (date) found.push(`a date (${date[0]})`);
  if (body.includes(viewer.full_name)) found.push("the viewer's name");
  if (viewer.email && body.includes(viewer.email)) found.push("the viewer's email");
  if (body.includes('"$@')) found.push("a server promise");
  return found;
}

/**
 * Every prefetch answer the page receives, in full, as the server sent it. Read here, at the
 * route, because the page itself never reads a loading-boundary prefetch to its end: the router
 * stops at the boundary and cancels the rest (`createNonTaskyPrefetchResponseStream`), while the
 * worker keeps the whole answer. Only an answer the server gave in full (200) is read. A handler
 * still waiting on the server when the test ends is let go (`releasePrefetches`): reading its
 * answer then is what failed with "Response has been disposed".
 */
async function capturePrefetches(context: BrowserContext, baseURL: string) {
  const answers = new Map<string, string>();
  await context.route(
    (url) => url.origin === new URL(baseURL).origin && url.searchParams.has("_rsc"),
    async (route) => {
      const request = route.request();
      const headers = request.headers();
      if (!isPrefetch(headers)) return route.fallback();
      const response = await route.fetch();
      if (response.status() !== 200) return route.fulfill({ response });
      const body = await response.text();
      const url = new URL(request.url());
      const key = `${url.pathname}${url.search.replace(/[?&]_rsc=[^&]*/, "")}`;
      answers.set(`${key} ${headers["next-router-segment-prefetch"] ?? "loading"}`, body);
      await route.fulfill({ response, body });
    },
  );
  return answers;
}

/** Lets go of the capture: an answer still on its way when the test ends is not read. */
function releasePrefetches(context: BrowserContext) {
  return context.unrouteAll({ behavior: "ignoreErrors" });
}

/** What a role's phone shell prefetches (`usePrefetchTabs`: the bar, More, Me), and the bell. */
function prefetchedBy(role: SessionRole): string[] {
  const { primary, more } = mobileNavFor(role);
  return [
    ...[...primary, ...more].map((item) => item.href),
    ...(more.length > 0 ? [PROFILE_NAV_ITEM.href] : []),
    "/notifications",
  ];
}

test.describe("what the worker keeps carries no member data", () => {
  test.skip(({ isMobile }) => !isMobile, "the bar and the More sheet are the phone's");
  test.afterEach(({ context }) => releasePrefetches(context));

  test("between them the roles' shells prefetch every address the worker may keep", () => {
    const prefetched = new Set((["owner", "admin", "staff"] as const).flatMap(prefetchedBy));
    expect([...shellPaths()].filter((path) => !prefetched.has(path))).toEqual([]);
  });

  for (const role of ["owner", "admin", "staff"] as const satisfies readonly SessionRole[]) {
    test.describe(role, () => {
      test.use({ storageState: storageStateFor(role), serviceWorkers: "block" });
      const title = (info: TestInfo) => `Instant Skeleton Proof ${info.project.name} ${role}`;
      test.beforeEach(async ({}, info) => {
        await removeTasksTitled(title(info));
        await createTask(title(info));
      });
      test.afterEach(async ({}, info) => {
        await removeTasksTitled(title(info));
      });

      test("every destination's prefetch is the skeleton alone", async ({
        page,
        context,
        baseURL,
      }, info) => {
        const [viewer] = await serviceSelect<Viewer>(
          `members?select=id,full_name,email&email=eq.${encodeURIComponent(USERS[role].email)}`,
        );
        expect(viewer).toBeTruthy();
        const answers = await capturePrefetches(context, baseURL!);
        const home = USERS[role].home;
        await page.goto(home);
        await hydrated(page);
        // The shell prefetches every top-level destination (`usePrefetchTabs`), the More sheet's
        // too, and the bell its own: each one the worker may keep is awaited, then read.
        const kept = shellPaths();
        const awaited = prefetchedBy(role).filter((path) => kept.has(path) && path !== home);
        expect(awaited.length).toBeGreaterThan(1);
        await expect
          .poll(() =>
            awaited.filter(
              (path) => answers.has(`${path} /_tree`) && answers.has(`${path} loading`),
            ),
          )
          .toEqual(awaited);
        // A task's page, from its row (the Owner and the Crew member see the fixture's).
        if (role !== "admin") {
          await page.locator('[data-slot="bottom-nav"] a[href="/tasks"]').click();
          await expect(page.getByRole("link", { name: new RegExp(title(info)) })).toBeVisible();
          await expect
            .poll(() =>
              [...answers.keys()].some((key) => /^\/tasks\/[0-9a-f-]{36} loading$/.test(key)),
            )
            .toBe(true);
        }

        let checked = 0;
        for (const [key, body] of answers) {
          const address = key.split(" ")[0]!;
          const path = address.split("?")[0]!;
          if (address.includes("?") || (!kept.has(path) && !SHELL_DRILL_DOWN.test(path))) continue;
          expect(memberDataIn(body, address, viewer!), `${role}: ${key}`).toEqual([]);
          checked += 1;
        }
        info.annotations.push({ type: "checked", description: `${checked} prefetches` });
      });
    });
  }

  test.describe("the checks bite", () => {
    test.use({ storageState: storageStateFor("staff"), serviceWorkers: "block" });

    /**
     * The Leave tab's two views (`/leave`, `/leave/attendance`) share the layout that hands the
     * comp leave balance and today's date to the page. A route prefetch carries only the layouts
     * the router does not hold yet (its `Next-Router-State-Tree`), so that layout travels in
     * whichever of the two is answered first: both are read, as one.
     */
    test("/leave's prefetch carries the member's data, so the worker never keeps it", async ({
      page,
      context,
      baseURL,
    }) => {
      const views = ["/leave", "/leave/attendance"];
      for (const view of views) expect(shellPaths().has(view), view).toBe(false);
      const [viewer] = await serviceSelect<Viewer>(
        `members?select=id,full_name,email&email=eq.${encodeURIComponent(USERS.staff.email)}`,
      );
      const answers = await capturePrefetches(context, baseURL!);
      await page.goto("/my-day");
      await hydrated(page);
      await expect.poll(() => views.every((view) => answers.has(`${view} loading`))).toBe(true);
      const payload = views.map((view) => answers.get(`${view} loading`)!).join("\n");
      expect(memberDataIn(payload, "/leave", viewer!)).not.toEqual([]);
    });
  });
});

/** The tap test's fixtures, one set per project (the two phone widths run side by side). */
const fixtureNames = (project: string) => ({
  prefix: `Instant Tap ${project}:`,
  client: `Instant Tap ${project}: Client`,
  task: `Instant Tap ${project}: Task`,
  fresh: `Instant Tap ${project}: Fresh Task`,
});

async function createTask(title: string): Promise<string> {
  const staff = await memberIdOf(USERS.staff.email);
  return rpcAs<string>(USERS.owner.email, USERS.owner.password, "task_create", {
    title,
    description: null,
    task_type_id: await taskTypeId("Normal"),
    client_id: null,
    priority: "medium",
    due_at: istInstant(addISTDays(todayIST(), 3), "18:00"),
    assignee_ids: [staff],
    primary_owner_id: staff,
    approving_admin_id: null,
    stages: [],
  });
}

/** Every request to the server waits `COLD_MS` first, the service worker's own included. */
async function coldWorker(context: BrowserContext, baseURL: string) {
  const origin = new URL(baseURL).origin;
  await context.route(
    (url) =>
      url.origin === origin &&
      !url.pathname.startsWith("/_next/static/") &&
      !url.pathname.startsWith("/icons/"),
    async (route) => {
      await new Promise((resolve) => setTimeout(resolve, COLD_MS));
      await route.continue().catch(() => undefined);
    },
  );
}

/** The skeletons the worker keeps, by address. */
function keptAddresses(page: Page): Promise<string[]> {
  return page.evaluate(async (name) => {
    const cache = await caches.open(name);
    return (await cache.keys()).map((request) => new URL(request.url).pathname);
  }, SHELL_CACHE);
}

/**
 * A finger on `target`'s centre: the browser's own touch input (trusted touchstart and touchend,
 * held `TAP_HOLD_MS`; the browser makes the click from them), as a phone's touchscreen sends it.
 */
async function fingerTap(target: Locator): Promise<void> {
  const page = target.page();
  const box = await target.boundingBox();
  expect(box, "the target is on screen").not.toBeNull();
  const point = { x: box!.x + box!.width / 2, y: box!.y + box!.height / 2 };
  const input = await page.context().newCDPSession(page);
  await input.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [point] });
  await page.waitForTimeout(TAP_HOLD_MS);
  await input.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await input.detach();
}

/**
 * Taps `target` like a finger and returns how long after the finger went down `skeleton` was
 * first on screen (null: never, before `content` arrived).
 */
async function tapUntilSkeleton(target: Locator, skeleton: string): Promise<number | null> {
  const page = target.page();
  // Where a finger would land: visible, still, enabled and not covered (nothing is clicked).
  await target.click({ trial: true });
  await page.evaluate((selector) => {
    const w = window as unknown as { __skeletonAt?: number | null; __tapAt?: number };
    w.__skeletonAt = null;
    const poll = () => {
      const element = document.querySelector<HTMLElement>(selector);
      if (element?.checkVisibility()) {
        w.__skeletonAt = performance.now() - w.__tapAt!;
        return;
      }
      if (performance.now() - w.__tapAt! < 10_000) requestAnimationFrame(poll);
    };
    // The finger goes down: the time runs from here.
    window.addEventListener(
      "touchstart",
      () => {
        w.__tapAt = performance.now();
        requestAnimationFrame(poll);
      },
      { capture: true, once: true },
    );
  }, skeleton);
  await fingerTap(target);
  await page
    .waitForFunction(
      () => (window as { __skeletonAt?: number | null }).__skeletonAt != null,
      null,
      {
        timeout: 10_000,
      },
    )
    .catch(() => undefined);
  return page.evaluate(() => {
    const at = (window as { __skeletonAt?: number | null }).__skeletonAt;
    return at == null ? null : Math.round(at);
  });
}

function expectInstant(name: string, ms: number | null) {
  test.info().annotations.push({ type: "tap to skeleton", description: `${name}: ${ms} ms` });
  expect(ms, `${name}: the traced skeleton after the tap`).not.toBeNull();
  expect(ms!, `${name}: within ${INSTANT_MS} ms of the tap`).toBeLessThanOrEqual(INSTANT_MS);
}

test.describe("a tap on a cold Worker shows its skeleton at once", () => {
  test.use({ storageState: storageStateFor("owner") });
  test.skip(({ isMobile }) => !isMobile, "the bar and the More sheet are the phone's");
  test.describe.configure({ mode: "serial" });

  let taskId = "";
  test.beforeAll(async ({}, info) => {
    const { prefix, client: CLIENT, task: TASK } = fixtureNames(info.project.name);
    await removeClientFixture(CLIENT);
    await removeTasksTitled(prefix);
    const [org] = await serviceSelect<{ id: string }>("organizations?select=id&limit=1");
    const client = await serviceInsert<{ id: string }>("clients", {
      org_id: org?.id,
      name: CLIENT,
      admin_id: await memberIdOf(USERS.admin.email),
    });
    await rpcAs(USERS.owner.email, USERS.owner.password, "client_activate", {
      client_id: client.id,
    });
    taskId = await createTask(TASK);
  });
  test.afterAll(async ({}, info) => {
    const { prefix, client } = fixtureNames(info.project.name);
    await removeClientFixture(client);
    await removeTasksTitled(prefix);
  });

  test("bar tab, task row, back and a More-sheet destination, installed", async ({
    page,
    context,
    baseURL,
  }) => {
    test.setTimeout(120_000);
    const {
      client: CLIENT,
      task: TASK,
      fresh: FRESH_TASK,
    } = fixtureNames(test.info().project.name);
    // The worker is in charge before the first page, as on any day after the first.
    const prep = await context.newPage();
    await prep.goto("/offline");
    await prep.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
    await prep.close();
    await runInstalled(page);

    // A warm visit: home, then Tasks, where the task's row is seen.
    await page.goto("/today");
    await hydrated(page);
    await page.locator('[data-slot="bottom-nav"] a[href="/tasks"]').click();
    await expect(page.getByRole("link", { name: new RegExp(TASK) }).first()).toBeVisible();
    await expect
      .poll(async () => {
        const kept = await keptAddresses(page);
        const count = (path: string) => kept.filter((address) => address === path).length;
        // The route tree and the loading skeleton of each.
        return [count("/tasks"), count("/clients"), count(`/tasks/${taskId}`)].every((n) => n >= 2);
      })
      .toBe(true);
    await page.locator('[data-slot="bottom-nav"] a[href="/today"]').click();
    await expect(page).toHaveURL(/\/today$/);

    // Later: the data changed, the Worker went cold, and the app is opened again.
    await createTask(FRESH_TASK);
    await coldWorker(context, baseURL!);
    await page.reload();
    await hydrated(page);
    const historyAtHome = await page.evaluate(() => history.length);

    // A bottom-bar tab.
    expectInstant(
      "bar tab → Tasks",
      await tapUntilSkeleton(
        page.locator('[data-slot="bottom-nav"] a[href="/tasks"]'),
        '[data-slot="loading-tasks"]',
      ),
    );
    // What follows is the network's: the task made after the skeletons were kept is there.
    await expect(page.getByText(FRESH_TASK).first()).toBeVisible({ timeout: COLD_MS * 4 });
    await expect(page.locator('[data-slot="loading-tasks"]')).toHaveCount(0);

    // A drill-down: the task's row.
    expectInstant(
      "task row",
      await tapUntilSkeleton(
        page.getByRole("link", { name: new RegExp(TASK) }).first(),
        '[data-slot="loading-task"]',
      ),
    );
    await expect(page).toHaveURL(new RegExp(`/tasks/${taskId}$`));
    await expect(page.locator('[data-slot="task-summary"]')).toBeVisible({
      timeout: COLD_MS * 4,
    });

    // Back: the list, from the router's memory, and one entry gone.
    await page.goBack();
    await expect(page).toHaveURL(/\/tasks$/);
    await expect(page.getByText(FRESH_TASK).first()).toBeVisible({ timeout: INSTANT_MS });
    const historyAtTasks = await page.evaluate(() => history.length);

    // A More-sheet destination.
    await page.locator('[data-slot="bottom-nav"] [data-nav="more"]').click();
    const sheet = page.locator('[data-slot="more-sheet"]');
    await expect(sheet).toBeVisible();
    expectInstant(
      "More sheet → Clients",
      await tapUntilSkeleton(
        sheet.getByRole("link", { name: "Clients", exact: true }),
        '[data-slot="loading-toolbar"]',
      ),
    );
    await expect(page.getByText(CLIENT).first()).toBeVisible({ timeout: COLD_MS * 4 });

    // The tab history is the installed app's, as before (§14.2): Tasks took the place the warm
    // visit left above home and the task added one; the sheet's entry was backed out and Clients
    // replaced Tasks above home, so nothing was added on the way and one back lands home.
    expect(historyAtTasks).toBe(historyAtHome + 1);
    expect(await page.evaluate(() => history.length)).toBe(historyAtTasks);
    await page.goBack();
    await expect(page).toHaveURL(/\/today$/);
  });
});

test.describe("sign-out drops what the worker keeps", () => {
  test.use({ storageState: storageStateFor("staff") });
  test.skip(({ isMobile }) => !isMobile, "the installed app is a phone");

  test("signing out through the dialog empties the skeleton cache and forgets its viewer, installed", async ({
    page,
    context,
  }) => {
    // The worker is in charge before the first page, as on any day after the first.
    const prep = await context.newPage();
    await prep.goto("/offline");
    await prep.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
    await prep.close();
    // A session of this test's own: signing it out ends no other test's.
    await ownSession(page, USERS.staff.email, USERS.staff.password);
    await runInstalled(page);

    await page.goto("/my-day");
    await hydrated(page);
    // The shell named its viewer and the worker kept the bar's skeletons.
    await expect
      .poll(async () => {
        const kept = await keptAddresses(page);
        return kept.includes("/__maxoff/shell-viewer") && kept.includes("/tasks");
      })
      .toBe(true);

    await page.locator('[data-slot="bottom-nav"] a[href="/me"]').click();
    await expect(page).toHaveURL(/\/me$/);
    await page.getByRole("button", { name: "Sign out" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/login\?reason=signed_out$/);
    // The router's redirect is no navigation the worker sees: it was told, and dropped it all.
    await expect.poll(() => keptAddresses(page)).toEqual([]);
  });
});
