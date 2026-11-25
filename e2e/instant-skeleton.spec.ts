import { readFileSync } from "node:fs";
import { join } from "node:path";

import { type BrowserContext, type Locator, type Page, type TestInfo } from "@playwright/test";

import { systemClock, todayIST } from "../src/core/time";
import { mobileNavFor, PROFILE_NAV_ITEM } from "../src/core/ui/shell/nav";

import { expect, test } from "./fixtures";
import {
  calendarReady,
  holdReads,
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
  signIn,
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
 *   requests included), at 375 and 430px, **for every role** (X3 (d)): after a day's warm visit
 *   the app is opened again, and a bottom-bar tab, a task row and a More-sheet destination (the
 *   Crew member's: a second tab) each show their traced skeleton
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
const SHELL_CACHE = "maxoff-shell-v13";

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;
const ISO_DATE = /\b20\d\d-[01]\d-[0-3]\d\b/;

/** The addresses the worker may keep, read from the worker itself. */
function shellPaths(): Set<string> {
  const sw = readFileSync(join(process.cwd(), "public", "sw.js"), "utf8");
  const list = /const SHELL_PATHS = new Set\(\[([\s\S]*?)\]\)/.exec(sw)?.[1] ?? "";
  return new Set([...list.matchAll(/"([^"]+)"/g)].map((match) => match[1]!));
}
const SHELL_DRILL_DOWN = /^\/tasks\/[0-9a-f-]{36}$/;
/** Where the worker keeps the one copy of a task's skeleton (sw.js `SHELL_DRILL_DOWN_KEY`). */
const SHELL_TASK_KEY = "/tasks/:id";
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

/** The links at Tasks' foot (every role's Tasks has both): kept since sw.js v13. */
const TASKS_FOOT = ["/tasks/all", "/tasks/requests"];

test.describe("what the worker keeps carries no member data", () => {
  test.skip(({ isMobile }) => !isMobile, "the bar and the More sheet are the phone's");
  test.afterEach(({ context }) => releasePrefetches(context));

  test("between them the roles' shells prefetch every address the worker may keep", () => {
    const prefetched = new Set([
      ...(["owner", "admin", "staff"] as const).flatMap(prefetchedBy),
      ...TASKS_FOOT,
    ]);
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
        // A task's page, from its row on Tasks (the Owner and the Crew member see the fixture's).
        // Tasks' own row: My Day links the task twice by design (its row, and its deadline by name
        // under "This week", FINAL 8 / PP-today-4), so the row is found once Tasks is on screen.
        await page.locator('[data-slot="bottom-nav"] a[href="/tasks"]').click();
        await expect(page).toHaveURL(/\/tasks$/);
        if (role !== "admin") {
          await expect(
            page
              .locator('[data-slot="task-row"]')
              .getByRole("link", { name: new RegExp(title(info)) }),
          ).toBeVisible();
          await expect
            .poll(() =>
              [...answers.keys()].some((key) => /^\/tasks\/[0-9a-f-]{36} loading$/.test(key)),
            )
            .toBe(true);
        }
        // Tasks' foot links, prefetched once they scroll into view: both kept, so both read. Tasks
        // loaded afresh: the Owner's Today links `/tasks/all?person=…`, whose prefetch already gave
        // the router that route's skeleton under a query, so the bare address was never asked.
        await page.goto("/tasks");
        await hydrated(page);
        await page.locator('[data-slot="tasks-more"]').scrollIntoViewIfNeeded();
        await expect
          .poll(() =>
            TASKS_FOOT.filter(
              (path) => answers.has(`${path} /_tree`) && answers.has(`${path} loading`),
            ),
          )
          .toEqual(TASKS_FOOT);

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

/** The tap test's fixtures, one set per project and role (they run side by side). */
const fixtureNames = (project: string, role: SessionRole) => ({
  prefix: `Instant Tap ${project} ${role}:`,
  client: `Instant Tap ${project} ${role}: Client`,
  task: `Instant Tap ${project} ${role}: Task`,
  fresh: `Instant Tap ${project} ${role}: Fresh Task`,
});

/**
 * A fixture task falls due two hours from now: the Owner's Tasks tab lists open tasks by deadline
 * and shows the first 15 (`OPEN_ON_FIRST_SCREEN`), so one due days ahead sat behind whatever else
 * a run had open, off the first screen or not drawn at all.
 */
const FIXTURE_DUE_MS = 2 * 60 * 60 * 1000;

/** Someone who signs in: an email and its password. */
type Person = { email: string; password: string };
const OWNER: Person = USERS.owner;

/**
 * A task for a Crew member (the seeded one unless said), made by the Owner unless said. An Admin's
 * own task (they made it) is on their Tasks while the Crew member is the one notified.
 */
async function createTask(
  title: string,
  { creator = OWNER, assignee = USERS.staff.email }: { creator?: Person; assignee?: string } = {},
): Promise<string> {
  const staff = await memberIdOf(assignee);
  return rpcAs<string>(creator.email, creator.password, "task_create", {
    title,
    description: null,
    task_type_id: await taskTypeId("Normal"),
    client_id: null,
    priority: "medium",
    due_at: new Date(systemClock().getTime() + FIXTURE_DUE_MS).toISOString(),
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

/** A notification for `email` (it re-reads their open screen, `LiveUpdates`). */
async function notify(email: string): Promise<void> {
  const [member] = await serviceSelect<{ id: string; org_id: string }>(
    `members?email=eq.${encodeURIComponent(email)}&select=id,org_id`,
  );
  expect(member, `a member ${email}`).toBeTruthy();
  await serviceInsert("notifications", {
    org_id: member!.org_id,
    recipient_id: member!.id,
    kind: "leave_decided",
    title: "Instant tap: a live update",
  });
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

/** What a tap came to: the skeleton's time, and what happened when it never showed. */
type TapOutcome = { ms: number | null; trace: string };

/**
 * Taps `target` like a finger and returns how long after the finger went down `skeleton` was
 * first on screen (null: never, before `content` arrived). With it, what the page saw (CI
 * 43068303493 read no skeleton once, not seen locally in 5 plain, 4 CPU-throttled or a
 * long-held run): whether the touch became a click and on what, whether the skeleton was in the
 * page but hidden, whether the document was replaced, and where the page ended up.
 */
async function tapUntilSkeleton(target: Locator, skeleton: string): Promise<TapOutcome> {
  const page = target.page();
  // Where a finger would land: visible, still, enabled and not covered (nothing is clicked).
  await target.click({ trial: true });
  await page.evaluate((selector) => {
    const w = window as unknown as {
      __skeletonAt?: number | null;
      __tapAt?: number;
      __tapTrace?: { click: string | null; hidden: boolean };
    };
    w.__skeletonAt = null;
    w.__tapTrace = { click: null, hidden: false };
    const poll = () => {
      const element = document.querySelector<HTMLElement>(selector);
      if (element?.checkVisibility()) {
        w.__skeletonAt = performance.now() - w.__tapAt!;
        return;
      }
      if (element) w.__tapTrace!.hidden = true;
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
    window.addEventListener(
      "click",
      (event) => {
        const at = event.target instanceof Element ? event.target : null;
        const link = at?.closest("a");
        w.__tapTrace!.click = link
          ? `a[href="${link.getAttribute("href")}"]`
          : `${at?.tagName.toLowerCase() ?? "?"}${at?.getAttribute("data-slot") ? `[data-slot="${at.getAttribute("data-slot")}"]` : ""}`;
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
    const w = window as unknown as {
      __skeletonAt?: number | null;
      __tapAt?: number;
      __tapTrace?: { click: string | null; hidden: boolean };
    };
    const at = w.__skeletonAt;
    const trace = w.__tapTrace
      ? `touch ${w.__tapAt == null ? "never seen" : "seen"}; click ${w.__tapTrace.click ?? "none"}; skeleton ${w.__tapTrace.hidden ? "in the page but hidden" : "never in the page"}; now at ${location.pathname}`
      : `the document was replaced (now at ${location.pathname})`;
    return { ms: at == null ? null : Math.round(at), trace };
  });
}

function expectInstant(name: string, { ms, trace }: TapOutcome) {
  test.info().annotations.push({ type: "tap to skeleton", description: `${name}: ${ms} ms` });
  expect(ms, `${name}: the traced skeleton after the tap (${trace})`).not.toBeNull();
  expect(ms!, `${name}: within ${INSTANT_MS} ms of the tap`).toBeLessThanOrEqual(INSTANT_MS);
}

/**
 * Each role's taps on a cold Worker (X3 (d): "the service-worker outlines hold for every role"):
 * a bottom-bar tab (Tasks), a task's row, and a second destination the worker keeps: the More
 * sheet's Clients for the Owner and an Admin (the client is the Admin's), Calendar on the Crew
 * member's bar (Crew have no More sheet). The Admin and the Crew member are their project's own
 * (seeded `skel-<role>-<project>`): a notification re-reads the viewer's open screen (the live
 * bell), and another test's task for the shared seeded people, landing mid-flow, undid "back
 * from memory" on a cold Worker. The Admin makes their fixture task for their Crew member.
 */
const skel = (role: "admin" | "staff", project: string): Person => ({
  email: `skel-${role}-${project}@maxoff.local`,
  password: "skel-local-password",
});
const COLD_TAPS: Record<
  SessionRole,
  {
    /** Who taps: null for the seeded session of the role. */
    viewer: (project: string) => Person | null;
    /** Who makes the fixture tasks, and for whom. */
    fixture: (project: string) => { creator: Person; assignee: string; clientAdmin: string };
    second: { href: string; skeleton: string; viaMore: boolean };
  }
> = {
  owner: {
    viewer: () => null,
    fixture: () => ({
      creator: OWNER,
      assignee: USERS.staff.email,
      clientAdmin: USERS.admin.email,
    }),
    second: { href: "/clients", skeleton: '[data-slot="loading-toolbar"]', viaMore: true },
  },
  admin: {
    viewer: (project) => skel("admin", project),
    fixture: (project) => ({
      creator: skel("admin", project),
      assignee: skel("staff", project).email,
      clientAdmin: skel("admin", project).email,
    }),
    second: { href: "/clients", skeleton: '[data-slot="loading-toolbar"]', viaMore: true },
  },
  staff: {
    viewer: (project) => skel("staff", project),
    fixture: (project) => ({
      creator: OWNER,
      assignee: skel("staff", project).email,
      clientAdmin: USERS.admin.email,
    }),
    second: { href: "/calendar", skeleton: '[data-slot="loading-calendar"]', viaMore: false },
  },
};

// One role after another: each holds every server answer `COLD_MS`, and side by side the three
// crowded the box and the Owner's list (the Owner sees every role's fixtures).
test.describe("a tap on a cold Worker shows its skeleton at once, every role", () => {
  test.describe.configure({ mode: "serial" });
  for (const role of ["owner", "admin", "staff"] as const satisfies readonly SessionRole[]) {
    test.describe(`a tap on a cold Worker shows its skeleton at once (${role})`, () => {
      test.use({
        storageState: role === "owner" ? storageStateFor(role) : { cookies: [], origins: [] },
      });
      test.skip(({ isMobile }) => !isMobile, "the bar and the More sheet are the phone's");
      test.describe.configure({ mode: "serial" });
      const { viewer, fixture, second } = COLD_TAPS[role];

      let taskId = "";
      test.beforeAll(async ({}, info) => {
        // The phone projects only, as the test (their people are seeded for those alone).
        if (!info.project.use.isMobile) return;
        const { prefix, client: CLIENT, task: TASK } = fixtureNames(info.project.name, role);
        await removeClientFixture(CLIENT);
        await removeTasksTitled(prefix);
        const [org] = await serviceSelect<{ id: string }>("organizations?select=id&limit=1");
        const client = await serviceInsert<{ id: string }>("clients", {
          org_id: org?.id,
          name: CLIENT,
          admin_id: await memberIdOf(fixture(info.project.name).clientAdmin),
        });
        await rpcAs(USERS.owner.email, USERS.owner.password, "client_activate", {
          client_id: client.id,
        });
        taskId = await createTask(TASK, fixture(info.project.name));
      });
      test.afterAll(async ({}, info) => {
        if (!info.project.use.isMobile) return;
        const { prefix, client } = fixtureNames(info.project.name, role);
        await removeClientFixture(client);
        await removeTasksTitled(prefix);
      });

      test(`bar tab, task row, back and ${second.viaMore ? "a More-sheet destination" : "a second tab"}, installed`, async ({
        page,
        context,
        baseURL,
      }) => {
        test.setTimeout(120_000);
        const {
          client: CLIENT,
          task: TASK,
          fresh: FRESH_TASK,
        } = fixtureNames(test.info().project.name, role);
        const home = USERS[role].home;
        const person = viewer(test.info().project.name);
        if (person) await signIn(page, person.email, person.password);
        // The worker is in charge before the first page, as on any day after the first.
        const prep = await context.newPage();
        await prep.goto("/offline");
        await prep.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
        await prep.close();
        await runInstalled(page);

        // A warm visit: home, then Tasks, where the task's row is seen. Tasks' own row: home links
        // the task too, and stays on screen until Tasks commits (a row found there is gone a moment
        // later), so the row is found once Tasks is the page.
        await page.goto(home);
        await hydrated(page);
        await page.locator('[data-slot="bottom-nav"] a[href="/tasks"]').click();
        await expect(page).toHaveURL(/\/tasks$/);
        const row = page
          .locator('[data-slot="task-row"]')
          .getByRole("link", { name: new RegExp(TASK) })
          .first();
        await expect(row).toBeVisible();
        // Seen means on the screen: a row prefetches its skeleton when it comes into view, and a
        // run's overdue tasks under Needs you can hold the Open tasks below the fold.
        await row.scrollIntoViewIfNeeded();
        await expect(row).toBeInViewport();
        await expect
          .poll(async () => {
            const kept = await keptAddresses(page);
            const count = (path: string) => kept.filter((address) => address === path).length;
            // The route tree and the loading skeleton of each tab. A task's page differs from
            // another's by its id only, so the worker keeps one copy for every task (sw.js v12, the
            // id out of its key): a task page's route tree and its loading skeleton.
            return count("/tasks") >= 2 && count(second.href) >= 2 && count(SHELL_TASK_KEY) >= 2;
          })
          .toBe(true);
        await page.locator(`[data-slot="bottom-nav"] a[href="${home}"]`).click();
        await expect(page).toHaveURL(new RegExp(`${home}$`));

        // Later: the data changed, the Worker went cold, and the app is opened again.
        await createTask(FRESH_TASK, fixture(test.info().project.name));
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

        if (second.viaMore) {
          // A More-sheet destination.
          await page.locator('[data-slot="bottom-nav"] [data-nav="more"]').click();
          const sheet = page.locator('[data-slot="more-sheet"]');
          await expect(sheet).toBeVisible();
          expectInstant(
            "More sheet → Clients",
            await tapUntilSkeleton(
              sheet.getByRole("link", { name: "Clients", exact: true }),
              second.skeleton,
            ),
          );
          await expect(page.getByText(CLIENT).first()).toBeVisible({ timeout: COLD_MS * 4 });
        } else {
          // Another tab on the bar.
          expectInstant(
            `bar tab → ${second.href}`,
            await tapUntilSkeleton(
              page.locator(`[data-slot="bottom-nav"] a[href="${second.href}"]`),
              second.skeleton,
            ),
          );
          await expect(page).toHaveURL(new RegExp(`${second.href}$`));
          await expect(page.locator(second.skeleton)).toHaveCount(0, { timeout: COLD_MS * 4 });
        }

        // The tab history is the installed app's, as before (§14.2): Tasks took the place the warm
        // visit left above home and the task added one; the second destination replaced Tasks above
        // home (the sheet's entry backed out), so nothing was added and one back lands home.
        expect(historyAtTasks).toBe(historyAtHome + 1);
        expect(await page.evaluate(() => history.length)).toBe(historyAtTasks);
        await page.goBack();
        await expect(page).toHaveURL(new RegExp(`${home}$`));
      });

      // #143 (CI 43220640676, the Admin's task row at 3.2 s, twice; the advisor read the trace): a
      // tap that finds no loading boundary in the router waits for the server. Two ways there: right
      // after a cold reopen, before the row's prefetch has gone (only the finger's own goes, and its
      // second leg, the loading boundary, leaves after the click); and a live update's re-read
      // (`LiveUpdates`, `router.refresh()`), which empties the prefetched segments. The task page's
      // skeleton is drawn by the app on the tap instead (`TaskTapSkeleton`), prefetched or not.
      for (const trigger of ["as soon as it can be tapped", "after a live refresh"] as const) {
        test(`a task row tapped ${trigger} on a cold reopen shows its skeleton at once, installed`, async ({
          page,
          context,
          baseURL,
        }) => {
          test.setTimeout(120_000);
          const { task: TASK } = fixtureNames(test.info().project.name, role);
          const person = viewer(test.info().project.name);
          if (person) await signIn(page, person.email, person.password);
          const prep = await context.newPage();
          await prep.goto("/offline");
          await prep.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
          await prep.close();
          await runInstalled(page);

          // Tasks seen once: the worker keeps the task page's skeleton.
          await page.goto("/tasks");
          await hydrated(page);
          const row = page
            .locator('[data-slot="task-row"]')
            .getByRole("link", { name: new RegExp(TASK) })
            .first();
          await row.scrollIntoViewIfNeeded();
          await expect(row).toBeInViewport();
          await expect
            .poll(
              async () => (await keptAddresses(page)).filter((a) => a === SHELL_TASK_KEY).length,
            )
            .toBeGreaterThanOrEqual(2);

          // Reopened on a cold Worker.
          await coldWorker(context, baseURL!);
          if (trigger === "as soon as it can be tapped") {
            // CI's run: reopened on home, then the Tasks tab, then the row the moment the list is
            // there (on a CI runner the router had not prefetched it yet; the tab's own skeleton is
            // the other test's).
            await page.goto(USERS[role].home);
            await hydrated(page);
            await page.locator('[data-slot="bottom-nav"] a[href="/tasks"]').click();
            await expect(page).toHaveURL(/\/tasks$/);
          } else {
            await page.reload();
            await hydrated(page);
          }
          const historyAtTasks = await page.evaluate(() => history.length);
          if (trigger === "after a live refresh") {
            // The live channel joined, a notification for the viewer: the screen re-reads itself,
            // and the tap comes while that re-read is still on its way (held by the cold Worker).
            await expect(row).toBeVisible({ timeout: COLD_MS * 4 });
            await row.scrollIntoViewIfNeeded();
            await expect(page.locator("html")).toHaveAttribute("data-live", "on", {
              timeout: COLD_MS * 4,
            });
            const refreshed = page.waitForRequest(
              (request) => {
                const headers = request.headers();
                return (
                  headers.rsc === "1" &&
                  !headers["next-router-prefetch"] &&
                  new URL(request.url()).pathname === "/tasks"
                );
              },
              { timeout: COLD_MS * 4 },
            );
            await notify(person?.email ?? OWNER.email);
            await refreshed;
          }
          // The finger goes down as soon as the row can be tapped (`tapUntilSkeleton` waits for
          // exactly that, no longer).
          expectInstant(
            `task row, ${trigger}`,
            await tapUntilSkeleton(row, '[data-slot="loading-task"]'),
          );
          await expect(page).toHaveURL(new RegExp(`/tasks/${taskId}$`));
          await expect(page.locator('[data-slot="task-summary"]')).toBeVisible({
            timeout: COLD_MS * 4,
          });
          await expect(page.locator('[data-slot="loading-task"]')).toHaveCount(0);
          // A drill-down's one entry (§14.2), and back lands on Tasks.
          expect(await page.evaluate(() => history.length)).toBe(historyAtTasks + 1);
          await page.goBack();
          await expect(page).toHaveURL(/\/tasks$/);
        });
      }

      // §14.2 with the app's skeleton up: back closes it and Tasks is there as it was (#143).
      // Leaving while the copy waits for the router (§14.2): back returns to Tasks; a bar tab goes
      // where it goes from Tasks, and no entry is left at the task's address (review of 8706c3a0).
      for (const leave of ["back", "the home tab"] as const) {
        test(`${leave} while a tapped task's skeleton shows leaves no task entry, installed`, async ({
          page,
          context,
          baseURL,
        }) => {
          test.setTimeout(120_000);
          const { task: TASK } = fixtureNames(test.info().project.name, role);
          const person = viewer(test.info().project.name);
          if (person) await signIn(page, person.email, person.password);
          const prep = await context.newPage();
          await prep.goto("/offline");
          await prep.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
          await prep.close();
          await runInstalled(page);
          await page.goto(USERS[role].home);
          await hydrated(page);
          await page.locator('[data-slot="bottom-nav"] a[href="/tasks"]').click();
          await expect(page).toHaveURL(/\/tasks$/);
          const row = page
            .locator('[data-slot="task-row"]')
            .getByRole("link", { name: new RegExp(TASK) })
            .first();
          await row.scrollIntoViewIfNeeded();
          await expect(row).toBeInViewport();
          await expect
            .poll(
              async () => (await keptAddresses(page)).filter((a) => a === SHELL_TASK_KEY).length,
            )
            .toBeGreaterThanOrEqual(2);

          await coldWorker(context, baseURL!);
          // Reopened on home, then Tasks through its tab: the bar remembers it pushed Tasks over
          // home, so its home tab then goes back (the case a left-behind entry breaks).
          await page.goto(USERS[role].home);
          await hydrated(page);
          await page.locator('[data-slot="bottom-nav"] a[href="/tasks"]').click();
          await expect(page).toHaveURL(/\/tasks$/, { timeout: COLD_MS * 4 });
          await expect(row).toBeVisible({ timeout: COLD_MS * 4 });
          await row.scrollIntoViewIfNeeded();
          await expect(page.locator("html")).toHaveAttribute("data-live", "on", {
            timeout: COLD_MS * 4,
          });
          const entryAtTasks = await page.evaluate(() => navigation.currentEntry?.index);
          const refreshed = page.waitForRequest(
            (request) => {
              const headers = request.headers();
              return (
                headers.rsc === "1" &&
                !headers["next-router-prefetch"] &&
                new URL(request.url()).pathname === "/tasks"
              );
            },
            { timeout: COLD_MS * 4 },
          );
          await notify(person?.email ?? OWNER.email);
          await refreshed;
          expectInstant(
            `task row, then ${leave}`,
            await tapUntilSkeleton(row, '[data-slot="tap-skeleton"] [data-slot="loading-task"]'),
          );
          const home = USERS[role].home;
          if (leave === "back") {
            await page.goBack();
            await expect(page).toHaveURL(/\/tasks$/);
            await expect(page.locator('[data-slot="tap-skeleton"]')).toHaveCount(0);
            await expect(row).toBeVisible();
            // Back on Tasks' own entry, and it stays: the task's late answer is dropped.
            expect(await page.evaluate(() => navigation.currentEntry?.index)).toBe(entryAtTasks);
            await page.waitForTimeout(COLD_MS + 500);
            await expect(page).toHaveURL(/\/tasks$/);
          } else {
            await page.locator(`[data-slot="bottom-nav"] a[href="${home}"]`).click();
            await expect(page).toHaveURL(new RegExp(`${home}$`), { timeout: COLD_MS * 4 });
            await expect(page.locator('[data-slot="tap-skeleton"]')).toHaveCount(0);
            await page.waitForTimeout(COLD_MS + 500);
            await expect(page).toHaveURL(new RegExp(`${home}$`));
          }
          await expect(page.locator('[data-slot="task-page"]')).toHaveCount(0);
          // The task's address is nowhere at or behind the current entry: no entry a back would land
          // on (one ahead, a back's forward, is any drill-down's).
          expect(
            await page.evaluate(() =>
              navigation
                .entries()
                .slice(0, (navigation.currentEntry?.index ?? 0) + 1)
                .some((entry) => /\/tasks\/[0-9a-f-]{36}/.test(entry.url ?? "")),
            ),
          ).toBe(false);
        });
      }

      // A row whose task the router answers with another screen at its address (#89 6845781531):
      // the copy goes and that screen shows (a task gone since the list loaded: not found; a read
      // that fails: the error screen and its Try again), and nothing moves by itself.
      if (role === "owner") {
        for (const ending of ["is gone", "errors"] as const) {
          test(`a tapped task that ${ending} shows that screen, not the skeleton, installed`, async ({
            page,
            context,
            baseURL,
          }) => {
            test.setTimeout(120_000);
            const project = test.info().project.name;
            const title = `Tap ending ${ending === "errors" ? "error" : "gone"} ${project}`;
            await removeTasksTitled(title);
            const id = await createTask(title);
            const session =
              ending === "errors" ? await ownSession(page, OWNER.email, OWNER.password) : null;
            const prep = await context.newPage();
            await prep.goto("/offline");
            await prep.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
            await prep.close();
            await runInstalled(page);
            await page.goto("/tasks");
            await hydrated(page);
            const row = page
              .locator('[data-slot="task-row"]')
              .getByRole("link", { name: new RegExp(title) })
              .first();
            await row.scrollIntoViewIfNeeded();
            await expect(row).toBeInViewport();

            await coldWorker(context, baseURL!);
            await page.goto(USERS.owner.home);
            await hydrated(page);
            await page.locator('[data-slot="bottom-nav"] a[href="/tasks"]').click();
            await expect(page).toHaveURL(/\/tasks$/, { timeout: COLD_MS * 4 });
            await expect(row).toBeVisible({ timeout: COLD_MS * 4 });
            await row.scrollIntoViewIfNeeded();
            await expect(page.locator("html")).toHaveAttribute("data-live", "on", {
              timeout: COLD_MS * 4,
            });
            const failing =
              session === null
                ? null
                : await holdReads("/rest/v1/rpc/task_page", session, "jwt-expired");
            try {
              if (ending === "is gone") await removeTasksTitled(title);
              const refreshed = page.waitForRequest(
                (request) => {
                  const headers = request.headers();
                  return (
                    headers.rsc === "1" &&
                    !headers["next-router-prefetch"] &&
                    new URL(request.url()).pathname === "/tasks"
                  );
                },
                { timeout: COLD_MS * 4 },
              );
              await notify(OWNER.email);
              await refreshed;
              expectInstant(
                `task row that ${ending}`,
                await tapUntilSkeleton(
                  row,
                  '[data-slot="tap-skeleton"] [data-slot="loading-task"]',
                ),
              );
              const screen = page.locator('#main > [data-slot="route"] [data-slot="error-state"]');
              await expect(screen).toBeVisible({ timeout: COLD_MS * 4 });
              await expect(screen).toContainText(
                ending === "errors" ? "Try again" : "Page not found",
              );
              await expect(page.locator('[data-slot="tap-skeleton"]')).toHaveCount(0);
              await expect(page).toHaveURL(new RegExp(`/tasks/${id}$`));
              if (failing !== null) {
                await expect
                  .poll(() => failing.caught(), { message: "the task's read was refused" })
                  .toBe(true);
              }
            } finally {
              failing?.release();
            }
            await removeTasksTitled(title);
          });
        }
      }
    });
  }
});

/**
 * Every screen's skeleton on the tap, first set (v7.0, ROADMAP "The other screens' skeleton on the
 * tap"): the app draws a copy of the route's own loading screen when the router has not answered
 * in 120 ms (`core/ui/navigation/tap-skeleton.ts`, the drawings in `app/(app)/drawings/`), for
 * every bar tab of every role and its home, a client, a project, a person, and a task tapped from
 * the calendar or the end-of-day report on the first screen after a reopen. Cold Worker, installed,
 * every role, 375 and 430. The drawings load after the page: a tap waits for `data-tap-drawings`
 * ("ready": the screens are in the engine; a drawing not made yet is made on the finger going
 * down), which needs only the app's static files, never the cold server.
 */
const TAB_SKELETON: Record<string, string> = {
  "/today": '[data-slot="loading-today"]',
  "/my-day": '[data-slot="loading-my-day"]',
  "/approvals": '[data-slot="loading-approvals"]',
  "/tasks": '[data-slot="loading-tasks"]',
  "/calendar": '[data-slot="loading-calendar"]',
  "/leave": '[data-slot="loading-leave-balance"]',
  "/me": '[aria-label="Loading Me"]',
};

/** The drawings are in the engine (`TAP_DRAWINGS_ATTRIBUTE`). */
async function drawingsReady(page: Page): Promise<void> {
  await expect(page.locator("html")).toHaveAttribute("data-tap-drawings", /ready|done/, {
    timeout: 10_000,
  });
}

/** The viewer's open screen re-reads itself (a notification, `LiveUpdates`), held by the cold Worker. */
async function liveRefresh(page: Page, email: string): Promise<void> {
  await expect(page.locator("html")).toHaveAttribute("data-live", "on", { timeout: COLD_MS * 4 });
  const path = new URL(page.url()).pathname;
  const refreshed = page.waitForRequest(
    (request) => {
      const headers = request.headers();
      return (
        headers.rsc === "1" &&
        !headers["next-router-prefetch"] &&
        new URL(request.url()).pathname === path
      );
    },
    { timeout: COLD_MS * 4 },
  );
  await notify(email);
  await refreshed;
}

/** Signed in as the role's viewer, the worker in charge, the app installed. */
async function installedAs(page: Page, context: BrowserContext, person: Person | null) {
  if (person) await signIn(page, person.email, person.password);
  const prep = await context.newPage();
  await prep.goto("/offline");
  await prep.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
  await prep.close();
  await runInstalled(page);
}

const barLink = (page: Page, href: string) =>
  page.locator(`[data-slot="bottom-nav"] a[href="${href}"]`);

test.describe("every screen's skeleton on the tap (v7.0), every role", () => {
  test.describe.configure({ mode: "serial" });
  for (const role of ["owner", "admin", "staff"] as const satisfies readonly SessionRole[]) {
    test.describe(`every screen's skeleton on the tap (${role})`, () => {
      test.use({
        storageState: role === "owner" ? storageStateFor(role) : { cookies: [], origins: [] },
      });
      test.skip(({ isMobile }) => !isMobile, "the bar is the phone's");
      test.describe.configure({ mode: "serial" });
      const { viewer, fixture } = COLD_TAPS[role];
      const home = USERS[role].home;
      const tabs = mobileNavFor(role)
        .primary.map((item) => item.href)
        .filter((href) => href !== home);
      const names = (project: string) => ({
        prefix: `Every Tap ${project} ${role}:`,
        client: `Every Tap ${project} ${role}: Client`,
        gone: `Every Tap ${project} ${role}: Gone client`,
        project: `Every Tap ${project} ${role}: Project`,
        task: `Every Tap ${project} ${role}: Task due today`,
      });
      let clientId = "";
      let projectId = "";

      test.beforeAll(async ({}, info) => {
        if (!info.project.use.isMobile) return;
        const n = names(info.project.name);
        await removeClientFixture(n.client);
        await removeClientFixture(n.gone);
        await removeTasksTitled(n.prefix);
        if (role === "staff") return;
        const own = fixture(info.project.name);
        const admin = role === "owner" ? USERS.admin : own.creator;
        const [org] = await serviceSelect<{ id: string }>("organizations?select=id&limit=1");
        for (const name of [n.client, n.gone]) {
          const client = await serviceInsert<{ id: string }>("clients", {
            org_id: org?.id,
            name,
            admin_id: await memberIdOf(own.clientAdmin),
          });
          await rpcAs(USERS.owner.email, USERS.owner.password, "client_activate", {
            client_id: client.id,
          });
          if (name === n.client) clientId = client.id;
        }
        projectId = await rpcAs<string>(admin.email, admin.password, "project_create", {
          client_id: clientId,
          name: n.project,
          recurrence: "monthly",
          stages: [],
          items: ["Reel"],
        });
      });
      test.afterAll(async ({}, info) => {
        if (!info.project.use.isMobile) return;
        const n = names(info.project.name);
        await removeClientFixture(n.client);
        await removeClientFixture(n.gone);
        await removeTasksTitled(n.prefix);
      });

      for (const trigger of ["as soon as it can be tapped", "after a live refresh"] as const) {
        test(`each bar tab ${trigger} shows its skeleton at once; home → a tab is one entry, a tab → a tab none, installed`, async ({
          page,
          context,
          baseURL,
        }) => {
          test.setTimeout(240_000);
          const person = viewer(test.info().project.name);
          await installedAs(page, context, person);
          await page.goto(home);
          await hydrated(page);
          await coldWorker(context, baseURL!);
          await page.reload();
          await hydrated(page);
          await drawingsReady(page);
          const atHome = await page.evaluate(() => history.length);
          for (const href of tabs) {
            if (trigger === "after a live refresh")
              await liveRefresh(page, (person ?? OWNER).email);
            expectInstant(
              `bar tab → ${href}`,
              await tapUntilSkeleton(barLink(page, href), TAB_SKELETON[href]!),
            );
            await expect(page).toHaveURL(new RegExp(`${href}$`), { timeout: COLD_MS * 4 });
            await expect(page.locator(TAB_SKELETON[href]!)).toHaveCount(0, {
              timeout: COLD_MS * 4,
            });
            await expect(page.locator('[data-slot="tap-skeleton"]')).toHaveCount(0);
            // [home, tab] (§14.2): the first tab pushed, every later one replaced it.
            expect(await page.evaluate(() => history.length)).toBe(atHome + 1);
          }
          await page.goBack();
          await expect(page).toHaveURL(new RegExp(`${home}$`));
        });
      }

      test("the home tab, from a tab the app was reopened on, shows home's skeleton at once and adds no entry, installed", async ({
        page,
        context,
        baseURL,
      }) => {
        test.setTimeout(120_000);
        await installedAs(page, context, viewer(test.info().project.name));
        await page.goto(tabs[0]!);
        await hydrated(page);
        await coldWorker(context, baseURL!);
        await page.reload();
        await hydrated(page);
        await drawingsReady(page);
        const atTab = await page.evaluate(() => history.length);
        expectInstant(
          `bar tab → ${home}`,
          await tapUntilSkeleton(barLink(page, home), TAB_SKELETON[home]!),
        );
        await expect(page).toHaveURL(new RegExp(`${home}$`), { timeout: COLD_MS * 4 });
        await expect(page.locator(TAB_SKELETON[home]!)).toHaveCount(0, { timeout: COLD_MS * 4 });
        // Reopened on the tab, home was not beneath: the bar replaced it.
        expect(await page.evaluate(() => history.length)).toBe(atTab);
      });

      test("back while a tab's skeleton shows goes home and stays there, installed", async ({
        page,
        context,
        baseURL,
      }) => {
        test.setTimeout(120_000);
        const person = viewer(test.info().project.name);
        await installedAs(page, context, person);
        await page.goto(home);
        await hydrated(page);
        await coldWorker(context, baseURL!);
        await page.reload();
        await hydrated(page);
        await drawingsReady(page);
        await barLink(page, tabs[0]!).click();
        await expect(page).toHaveURL(new RegExp(`${tabs[0]}$`), { timeout: COLD_MS * 4 });
        await expect(page.locator(TAB_SKELETON[tabs[0]!]!)).toHaveCount(0, {
          timeout: COLD_MS * 4,
        });
        await liveRefresh(page, (person ?? OWNER).email);
        expectInstant(
          `bar tab → ${tabs[1]}, then back`,
          await tapUntilSkeleton(
            barLink(page, tabs[1]!),
            `[data-slot="tap-skeleton"] ${TAB_SKELETON[tabs[1]!]}`,
          ),
        );
        await page.goBack();
        await expect(page).toHaveURL(new RegExp(`${home}$`));
        await expect(page.locator('[data-slot="tap-skeleton"]')).toHaveCount(0);
        // The tab's late answer is dropped: home stays.
        await page.waitForTimeout(COLD_MS + 500);
        await expect(page).toHaveURL(new RegExp(`${home}$`));
      });

      if (role !== "staff") {
        test("a client and its project (and for the Owner a person), tapped on a reopened list, show their skeleton at once, one entry each, installed", async ({
          page,
          context,
          baseURL,
        }) => {
          test.setTimeout(180_000);
          const n = names(test.info().project.name);
          await installedAs(page, context, viewer(test.info().project.name));
          await page.goto("/clients");
          await hydrated(page);
          await coldWorker(context, baseURL!);
          await page.reload();
          await hydrated(page);
          await drawingsReady(page);
          const atList = await page.evaluate(() => history.length);
          expectInstant(
            "client row",
            await tapUntilSkeleton(
              page.getByRole("link", { name: new RegExp(n.client) }).first(),
              '[data-slot="loading-client-overview"]',
            ),
          );
          await expect(page).toHaveURL(new RegExp(`/clients/${clientId}$`));
          await expect(page.locator('[data-slot="client-overview"]')).toBeVisible({
            timeout: COLD_MS * 4,
          });
          expect(await page.evaluate(() => history.length)).toBe(atList + 1);

          // The client's Projects (its own tab: the router's, no copy), then the project's row.
          await page.locator('[data-slot="client-tabs"] a', { hasText: "Projects" }).click();
          const projectRow = page.locator(`a[href="/clients/${clientId}/projects/${projectId}"]`);
          await expect(projectRow.first()).toBeVisible({ timeout: COLD_MS * 4 });
          expectInstant(
            "project row",
            await tapUntilSkeleton(projectRow.first(), '[data-slot="loading-project"]'),
          );
          await expect(page).toHaveURL(new RegExp(`/projects/${projectId}$`));
          await expect(page.locator('[data-slot="project-page"]')).toBeVisible({
            timeout: COLD_MS * 4,
          });
          expect(await page.evaluate(() => history.length)).toBe(atList + 2);

          if (role !== "owner") {
            // Not applicable for an Admin on a phone (the advisor, 25 Nov 2026): their People list
            // opens a person's sheet, not their page, and Everyone today is the Owner's, so a
            // phone gives an Admin no row that opens a person's page. Their person drawing is
            // checked by the unit test (`tap-drawings.test.tsx`); recorded here, not skipped.
            test.info().annotations.push({
              type: "not applicable",
              description:
                "an Admin's person tap: on a phone the People list opens a sheet (no person page row)",
            });
            return;
          }
          // A person, from Everyone today (the Owner's: on a phone the People list opens a sheet,
          // and the board's rows open a person's Leave).
          await page.goto("/today/people");
          await hydrated(page);
          await drawingsReady(page);
          const atBoard = await page.evaluate(() => history.length);
          const crewId = await memberIdOf(skel("staff", test.info().project.name).email);
          expectInstant(
            "person row",
            await tapUntilSkeleton(
              page.locator(`#main a[href="/people/${crewId}/leave"]:visible`).first(),
              '[data-slot="loading-comp-leave-card"]',
            ),
          );
          await expect(page).toHaveURL(new RegExp(`/people/${crewId}/leave$`));
          await expect(page.locator('[data-slot="person-tabs"]')).toBeVisible({
            timeout: COLD_MS * 4,
          });
          expect(await page.evaluate(() => history.length)).toBe(atBoard + 1);
          await page.goBack();
          await expect(page).toHaveURL(/\/today\/people$/);
        });
      }

      if (role === "owner") {
        test("a client gone since the list loaded shows its own screen, not the skeleton, installed", async ({
          page,
          context,
          baseURL,
        }) => {
          test.setTimeout(120_000);
          const n = names(test.info().project.name);
          await installedAs(page, context, null);
          await page.goto("/clients");
          await hydrated(page);
          await coldWorker(context, baseURL!);
          await page.reload();
          await hydrated(page);
          await drawingsReady(page);
          const row = page.getByRole("link", { name: new RegExp(n.gone) }).first();
          await expect(row).toBeVisible({ timeout: COLD_MS * 4 });
          await removeClientFixture(n.gone);
          expectInstant(
            "gone client row",
            await tapUntilSkeleton(
              row,
              '[data-slot="tap-skeleton"] [data-slot="loading-client-overview"]',
            ),
          );
          const screen = page.locator('#main > [data-slot="route"] [data-slot="error-state"]');
          await expect(screen).toBeVisible({ timeout: COLD_MS * 4 });
          await expect(screen).toContainText("Page not found");
          await expect(page.locator('[data-slot="tap-skeleton"]')).toHaveCount(0);
        });

        test("a task tapped on the calendar or the end-of-day report, the first screen after a reopen, shows its skeleton at once, installed", async ({
          page,
          context,
          baseURL,
        }) => {
          test.setTimeout(150_000);
          const n = names(test.info().project.name);
          // Due today in IST, so the calendar's day and the day's report both list it.
          const staff = await memberIdOf(USERS.staff.email);
          await rpcAs<string>(OWNER.email, OWNER.password, "task_create", {
            title: n.task,
            description: null,
            task_type_id: await taskTypeId("Normal"),
            client_id: null,
            priority: "medium",
            due_at: `${todayIST()}T23:30:00+05:30`,
            assignee_ids: [staff],
            primary_owner_id: staff,
            approving_admin_id: null,
            stages: [],
          });
          await installedAs(page, context, null);
          await page.goto("/calendar");
          await hydrated(page);
          await coldWorker(context, baseURL!);
          await page.reload();
          await hydrated(page);
          await calendarReady(page);
          await drawingsReady(page);
          expectInstant(
            "a task on the calendar's day",
            await tapUntilSkeleton(
              page.locator('[data-slot="calendar-detail"]:visible a[href^="/tasks/"]').first(),
              '[data-slot="loading-task"]',
            ),
          );
          await expect(page.locator('[data-slot="task-summary"]')).toBeVisible({
            timeout: COLD_MS * 4,
          });

          await page.goto(`/reports/end-of-day/${todayIST()}`);
          await hydrated(page);
          await drawingsReady(page);
          expectInstant(
            "a task on the end-of-day report",
            await tapUntilSkeleton(
              page.locator('[data-slot="eod-task"]').first(),
              '[data-slot="loading-task"]',
            ),
          );
          await expect(page.locator('[data-slot="task-summary"]')).toBeVisible({
            timeout: COLD_MS * 4,
          });
        });

        test("the drawings are made one per idle slice, none a long task at 4x CPU", async ({
          page,
        }, info) => {
          test.skip(info.project.name !== "mobile", "one width measures it");
          test.setTimeout(120_000);
          await page.addInitScript(() => {
            const w = window as unknown as { __long: { start: number; end: number }[] };
            w.__long = [];
            new PerformanceObserver((list) => {
              for (const entry of list.getEntries()) {
                w.__long.push({ start: entry.startTime, end: entry.startTime + entry.duration });
              }
            }).observe({ type: "longtask", buffered: true });
          });
          const cdp = await page.context().newCDPSession(page);
          await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
          try {
            await page.goto(USERS.owner.home);
            await hydrated(page);
            await expect(page.locator("html")).toHaveAttribute("data-tap-drawings", "done", {
              timeout: 60_000,
            });
            const { slices, long } = await page.evaluate(() => ({
              slices: performance
                .getEntriesByType("measure")
                .filter((entry) => entry.name.startsWith("tap-drawing:"))
                .map((entry) => ({
                  name: entry.name,
                  start: entry.startTime,
                  end: entry.startTime + entry.duration,
                  duration: entry.duration,
                })),
              long: (window as unknown as { __long: { start: number; end: number }[] }).__long,
            }));
            test.info().annotations.push({
              type: "drawing slices at 4x CPU",
              description: slices.map((s) => `${s.name} ${Math.round(s.duration)} ms`).join(", "),
            });
            expect(slices.length, "every drawing was made in a slice").toBeGreaterThanOrEqual(10);
            for (const slice of slices) {
              expect(slice.duration, `${slice.name} within 50 ms`).toBeLessThanOrEqual(50);
              const overlapping = long.filter(
                (task) => task.start < slice.end && task.end > slice.start,
              );
              expect(overlapping, `${slice.name} is no long task`).toEqual([]);
            }
          } finally {
            await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
            await cdp.detach();
          }
        });
      }
    });
  }
});

// Offline the router waits for the connection (or falls back to loading the screen in full when
// its fetch fails, Next's own, hence the document load allowed here): the app draws no copy, so
// the screen tapped from stays with the progress bar, as before v7.0.
test.describe("offline, a tab's tap draws no copy (v7.0)", () => {
  test.use({ storageState: storageStateFor("owner"), documentLoads: "allowed" });
  test.skip(({ isMobile }) => !isMobile, "the bar is the phone's");

  test("the tap draws no copy while offline, installed", async ({ page, context }) => {
    await installedAs(page, context, null);
    await page.goto(USERS.owner.home);
    await hydrated(page);
    await drawingsReady(page);
    // Kept in the tab's session store, which outlives the document Next may load in full.
    await page.evaluate(() => {
      sessionStorage.setItem("tap-copy", "none");
      new MutationObserver(() => {
        if (document.querySelector('[data-slot="tap-skeleton"]')) {
          sessionStorage.setItem("tap-copy", "drawn");
        }
      }).observe(document.documentElement, { childList: true, subtree: true });
    });
    await context.setOffline(true);
    try {
      await fingerTap(barLink(page, "/approvals"));
      await page.waitForTimeout(800);
      // Read once the page settles (a document Next loads in full replaces the context).
      await expect
        .poll(() => page.evaluate(() => sessionStorage.getItem("tap-copy")).catch(() => null))
        .toBe("none");
    } finally {
      await context.setOffline(false);
    }
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
