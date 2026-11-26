import { type Page } from "@playwright/test";

import { expect, test } from "./fixtures";

import { addISTDays, istInstant, todayIST } from "../src/core/time";

import {
  holdReads,
  hydrated,
  memberIdOf,
  ownSession,
  removeTasksTitled,
  rpcAs,
  storageStateFor,
  taskTypeId,
  USERS,
} from "./helpers";

/**
 * A press the page swapped out from under the pointer still moves, once (fix-held-press-back,
 * 26 Nov 2026; the follow-up of fix-stable-back).
 *
 * Next swaps a route's `loading.tsx` for its page by replacing elements, so the back control the
 * loading screen drew is a new element once the page streams in. A mouse press that went down on
 * the old one and came up on the new one fired no click at all, and the press was lost: before
 * hydration and after it, on every screen whose loading screen draws its own back control (twenty
 * of them, the task page through its module skeleton too). The head script now replays such a
 * press as one click on the replacement (`press-replay.ts`, `pre-hydration.ts`); a touch, which
 * the browser answers itself at the finger's last place, still moves exactly once.
 *
 * The page's read is held at the e2e server's Supabase proxy (`holdReads`, this test's own
 * session) while the press goes down, and released before it comes up: the swap happens under
 * the pointer. One route per kind of header: a settings list (fixed title), a report day (a date),
 * a list view and a task (the module skeleton). A client's project is not covered: its loading
 * screen is not given the route's params, so its back names `/clients` while the page's names the
 * client's Projects, and a press across two addresses is never replayed (PROGRESS, Ideas).
 */
test.use({ storageState: storageStateFor("owner") });
// The scripts are held by `page.route`; a service worker serving `/_next/static` from its cache
// would answer them out of Playwright's sight (as in `pre-hydration.spec.ts`).
test.use({ serviceWorkers: "block" });
// Before hydration the held tap's fallback is a document load of the move (the scripts never come).
test.use({ documentLoads: "allowed" });

type Route = {
  name: string;
  /** The PostgREST path of a read only this page makes (as in `loading-screens.spec.ts`). */
  hold: string;
  url: (project: string) => Promise<string>;
};

/** A task of this test's own, per Playwright project. */
async function taskUrl(project: string): Promise<string> {
  const title = `Held press task (${project})`;
  await removeTasksTitled(title);
  const { owner, staff } = USERS;
  const staffId = await memberIdOf(staff.email);
  const id = await rpcAs<string>(owner.email, owner.password, "task_create", {
    title,
    description: null,
    task_type_id: await taskTypeId("Normal"),
    client_id: null,
    priority: "medium",
    due_at: istInstant(addISTDays(todayIST(), 3), "18:00"),
    assignee_ids: [staffId],
    primary_owner_id: staffId,
    approving_admin_id: null,
  });
  return `/tasks/${id}`;
}

const ROUTES: readonly Route[] = [
  {
    name: "a settings list",
    hold: "/rest/v1/task_types",
    url: async () => "/settings/task-types",
  },
  {
    name: "a report day",
    hold: "/rest/v1/rpc/eod_report_preview",
    url: async () => `/reports/end-of-day/${todayIST()}`,
  },
  { name: "a list view", hold: "/rest/v1/tasks", url: async () => "/tasks/all" },
  { name: "a task", hold: "/rest/v1/rpc/task_page", url: taskUrl },
];

const BACK = '[data-slot="page-back"]:visible';

/** The address of `path` on this origin, with or without a query. */
function atPath(path: string): RegExp {
  return new RegExp(`^https?://[^/]+${path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\?.*)?$`);
}

/** Notes the link each press goes down on, and every click that reaches a link. */
async function watchPresses(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __pressed?: Element | undefined; __clicks?: number };
    w.__clicks = 0;
    window.addEventListener(
      "pointerdown",
      (event) => {
        w.__pressed = (event.target as Element | null)?.closest("a[href]") ?? undefined;
      },
      true,
    );
    window.addEventListener(
      "click",
      (event) => {
        if ((event.target as Element | null)?.closest("a[href]"))
          w.__clicks = (w.__clicks ?? 0) + 1;
      },
      true,
    );
  });
}

/** Waits until the back control the press went down on has been swapped out by the page. */
async function swapped(page: Page) {
  await page.waitForFunction(
    () => {
      const w = window as unknown as { __pressed?: Element };
      return w.__pressed !== undefined && !w.__pressed.isConnected;
    },
    undefined,
    { timeout: 15_000 },
  );
}

/** The pressed back control's address, as a path. */
async function backPath(page: Page): Promise<string> {
  const href = await page.locator(BACK).first().getAttribute("href");
  if (!href) throw new Error("the back control has no address");
  return new URL(href, "http://x").pathname;
}

async function pressPoint(page: Page) {
  const box = await page.locator(BACK).first().boundingBox();
  if (!box) throw new Error("the back control is not on screen");
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** A fresh tab whose app never hydrates (its scripts are never answered). */
async function unhydrated(page: Page) {
  const fresh = await page.context().newPage();
  await fresh.route(/\/_next\/static\/chunks\/.+\.js/, () => {});
  await watchPresses(fresh);
  return fresh;
}

test.describe("before hydration, a mouse press across the loading screen's swap moves", () => {
  for (const route of ROUTES) {
    test(`${route.name}: back pressed on the loading screen, released on the page`, async ({
      page,
    }, info) => {
      const url = await route.url(info.project.name);
      const session = await ownSession(page, USERS.owner.email, USERS.owner.password);
      const fresh = await unhydrated(page);
      const hold = await holdReads(route.hold, session);
      try {
        await fresh.goto(url, { waitUntil: "commit" });
        await expect(fresh.locator(BACK)).toBeVisible();
        await expect(fresh.locator(BACK), "before hydration").not.toHaveAttribute("data-live");
        const parent = await backPath(fresh);
        const at = await pressPoint(fresh);
        await fresh.mouse.move(at.x, at.y);
        await fresh.mouse.down();
        hold.release();
        await swapped(fresh);
        await fresh.mouse.up();
        // Held for the app, which never comes: the head script makes the move itself.
        await expect(fresh, "the press moved").toHaveURL(atPath(parent), { timeout: 10_000 });
      } finally {
        hold.release();
        await fresh.close();
      }
    });
  }
});

test.describe("after hydration, a mouse press across the loading screen's swap moves", () => {
  const ENTERED = [
    { route: ROUTES[0]!, from: "/settings" },
    { route: ROUTES[2]!, from: "/tasks" },
  ] as const;
  for (const { route, from } of ENTERED) {
    test(`${route.name}: opened in the app, back pressed while it loads`, async ({
      page,
    }, info) => {
      const url = await route.url(info.project.name);
      const session = await ownSession(page, USERS.owner.email, USERS.owner.password);
      await watchPresses(page);
      await page.goto(from);
      await hydrated(page);
      const hold = await holdReads(route.hold, session);
      try {
        await page.locator(`a[href="${url}"]`).first().click();
        await expect(page).toHaveURL(atPath(url));
        await expect(page.locator(BACK)).toHaveAttribute("data-live");
        const parent = await backPath(page);
        const at = await pressPoint(page);
        await page.mouse.move(at.x, at.y);
        await page.mouse.down();
        hold.release();
        await swapped(page);
        await page.mouse.up();
        await expect(page, `the press moved to ${parent}`).toHaveURL(atPath(parent));
      } finally {
        hold.release();
      }
    });
  }
});

test.describe("a touch across the swap moves exactly once", () => {
  test.skip(({ hasTouch }) => !hasTouch, "a touch screen");
  test("a settings list: back touched on the loading screen, lifted on the page", async ({
    page,
  }) => {
    const route = ROUTES[0]!;
    const session = await ownSession(page, USERS.owner.email, USERS.owner.password);
    const fresh = await unhydrated(page);
    const hold = await holdReads(route.hold, session);
    try {
      await fresh.goto(await route.url(""), { waitUntil: "commit" });
      await expect(fresh.locator(BACK)).toBeVisible();
      const parent = await backPath(fresh);
      const at = await pressPoint(fresh);
      const cdp = await fresh.context().newCDPSession(fresh);
      await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [at] });
      await fresh.waitForFunction(() => "__pressed" in window);
      hold.release();
      await swapped(fresh);
      const moves: string[] = [];
      fresh.on("framenavigated", (frame) => {
        if (frame === fresh.mainFrame()) moves.push(frame.url());
      });
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      await expect(fresh, `the touch moved to ${parent}`).toHaveURL(atPath(parent), {
        timeout: 10_000,
      });
      // Well past the replay's wait and the held tap's: nothing moves again.
      await fresh.waitForTimeout(1_500);
      expect(
        moves.map((m) => new URL(m).pathname),
        "one move",
      ).toEqual([parent]);
    } finally {
      hold.release();
      await fresh.close();
    }
  });
});
