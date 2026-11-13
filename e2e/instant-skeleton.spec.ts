import { readFileSync } from "node:fs";
import { join } from "node:path";

import { type BrowserContext, type Locator, type Page, type TestInfo } from "@playwright/test";

import { systemClock } from "../src/core/time";
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
      test("back while a tapped task's skeleton shows keeps Tasks, installed", async ({
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
          .poll(async () => (await keptAddresses(page)).filter((a) => a === SHELL_TASK_KEY).length)
          .toBeGreaterThanOrEqual(2);

        await coldWorker(context, baseURL!);
        await page.reload();
        await hydrated(page);
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
          "task row, then back",
          await tapUntilSkeleton(row, '[data-slot="tap-skeleton"] [data-slot="loading-task"]'),
        );
        await page.goBack();
        await expect(page).toHaveURL(/\/tasks$/);
        await expect(page.locator('[data-slot="tap-skeleton"]')).toHaveCount(0);
        await expect(row).toBeVisible();
        // Back on Tasks' own entry, and it stays: the task's late answer is dropped.
        expect(await page.evaluate(() => navigation.currentEntry?.index)).toBe(entryAtTasks);
        await page.waitForTimeout(COLD_MS + 500);
        await expect(page).toHaveURL(/\/tasks$/);
        await expect(page.locator('[data-slot="task-page"]')).toHaveCount(0);
      });
    });
  }
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
