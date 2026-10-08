import { type Page, type Route } from "@playwright/test";

import { expect, test } from "./fixtures";

import { addISTDays, istInstant, istWeekday, todayIST } from "../src/core/time";

import {
  hydrated,
  memberIdOf,
  removeTasksTitled,
  rpcAs,
  storageStateFor,
  taskTypeId,
  USERS,
} from "./helpers";

/**
 * A view's address while the screen refreshes (ARCHITECTURE §14.2 d, found on main CI
 * 2026-10-02): Next turns a hand-written address into a router "restore", and one that landed
 * while a refresh of the screen was in flight made Next load the page in full. Every view control
 * now writes its address through `replaceViewAddress`, which holds it until the router's fetches
 * have completed. Each test holds a real refresh (refresh on return) at the network, switches the
 * view during it, and lets it go: the view changes on the tap, the address follows when the
 * refresh ends, and the reload guard (the fixtures) fails any document load. No timers: the held
 * answer is released by the test itself.
 */

test.use({ storageState: storageStateFor("owner") });
// The service worker, once it controls the page, takes the router's fetches out of Playwright's
// sight (as in `pull-to-refresh.spec`): the held refresh would go round it.
test.use({ serviceWorkers: "block" });
test.skip(({ viewport }) => (viewport?.width ?? 1280) >= 768, "the phone widths, 375 and 430px");

/** A weekday (Mon–Fri) at least `offset` days from today, IST. */
function workingDay(offset: number): string {
  let day = addISTDays(todayIST(), offset);
  while (istWeekday(day) === 0 || istWeekday(day) === 6) day = addISTDays(day, 1);
  return day;
}

/**
 * Holds the next refresh of `path` (an RSC request for it that is not a prefetch) until the test
 * lets it go. `held` resolves once the refresh has reached the network and is waiting;
 * `answered` once the released answer has been read by the page.
 */
async function holdNextRefresh(page: Page, path: string) {
  let reached: () => void = () => undefined;
  const held = new Promise<void>((resolve) => {
    reached = resolve;
  });
  let let_go: () => void = () => undefined;
  const released = new Promise<void>((resolve) => {
    let_go = resolve;
  });
  let caught = false;
  const handler = async (route: Route) => {
    const request = route.request();
    const headers = request.headers();
    const refresh =
      headers["rsc"] === "1" &&
      !headers["next-router-prefetch"] &&
      new URL(request.url()).pathname === path;
    if (!refresh || caught) return route.fallback();
    caught = true;
    reached();
    await released;
    await route.continue();
  };
  await page.route(`**${path}?*`, handler);
  await page.route(`**${path}`, handler);
  const answered = page.waitForEvent("requestfinished", {
    predicate: (request) =>
      request.headers()["rsc"] === "1" &&
      !request.headers()["next-router-prefetch"] &&
      new URL(request.url()).pathname === path,
    timeout: 0,
  });
  return { held, release: () => let_go(), answered };
}

/** The app coming back after more than refresh on return's throttle: one refresh in place. */
async function returnToApp(page: Page): Promise<void> {
  await page.clock.fastForward(31_000);
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
}

const tab = (page: Page, view: string) =>
  page.locator(`[data-slot="task-tab"][data-view-tab="${view}"]`);
const panel = (page: Page, view: string) => page.locator(`[data-slot="task-panel-${view}"]`);

async function taskOpened(page: Page, title: string): Promise<string> {
  await removeTasksTitled(title);
  const staffId = await memberIdOf(USERS.staff.email);
  const taskId = await rpcAs<string>(USERS.owner.email, USERS.owner.password, "task_create", {
    title,
    description: null,
    task_type_id: await taskTypeId("Normal"),
    client_id: null,
    priority: "medium",
    due_at: istInstant(workingDay(46), "18:00"),
    assignee_ids: [staffId],
    primary_owner_id: staffId,
    approving_admin_id: null,
    stages: [],
  });
  await page.clock.install();
  await page.goto(`/tasks/${taskId}`);
  await hydrated(page);
  await expect(page.locator('[data-slot="task-tabs"]')).toHaveAttribute("data-live", "");
  return taskId;
}

test("the task page: views switched during a refresh change at once; the address follows the last when it ends", async ({
  page,
}, info) => {
  const taskId = await taskOpened(page, `View address ${info.project.name} during`);
  const refresh = await holdNextRefresh(page, `/tasks/${taskId}`);
  await returnToApp(page);
  await refresh.held;

  await tab(page, "activity").click();
  await expect(tab(page, "activity")).toHaveAttribute("aria-current", "true");
  await expect(panel(page, "activity")).toBeVisible();
  await tab(page, "details").click();
  await expect(tab(page, "details")).toHaveAttribute("aria-current", "true");
  await expect(panel(page, "details")).toBeVisible();
  // Only the address waits, for the refresh in flight.
  await expect(page).toHaveURL(new RegExp(`/tasks/${taskId}$`));

  refresh.release();
  await refresh.answered;
  await expect(page).toHaveURL(new RegExp(`/tasks/${taskId}\\?tab=details$`));
  await expect(panel(page, "details")).toBeVisible();
});

test("the task page: a view switched before a refresh is written at once and stays through it", async ({
  page,
}, info) => {
  const taskId = await taskOpened(page, `View address ${info.project.name} before`);
  await tab(page, "activity").click();
  await expect(page).toHaveURL(new RegExp(`/tasks/${taskId}\\?tab=activity$`));

  const refresh = await holdNextRefresh(page, `/tasks/${taskId}`);
  await returnToApp(page);
  await refresh.held;
  refresh.release();
  await refresh.answered;
  await expect(page).toHaveURL(new RegExp(`/tasks/${taskId}\\?tab=activity$`));
  await expect(tab(page, "activity")).toHaveAttribute("aria-current", "true");

  // With nothing in flight, a switch writes its address at once.
  await tab(page, "details").click();
  await expect(page).toHaveURL(new RegExp(`/tasks/${taskId}\\?tab=details$`));
});

test("the app's report on opening never holds a view's address: after it, and while it is out", async ({
  page,
}, info) => {
  // 5.4 (owner, 2026-10-03): the app reports its platform and whether it runs installed once per
  // open, in the background. A view's address waits for the router's own fetches only, and the
  // report is not one: a plain request to a route handler (ARCHITECTURE §4.4), never a server
  // action. So a switch is written at once after the report has answered, and also while it is
  // still out (as a server action, it held the address until it answered).
  const isReport = (request: { method(): string; url(): string }) =>
    request.method() === "POST" && new URL(request.url()).pathname === "/api/app-report";
  const answered = page.waitForResponse((response) => isReport(response.request()));
  const taskId = await taskOpened(page, `View address ${info.project.name} report`);
  await answered;
  await tab(page, "activity").click();
  await expect(page).toHaveURL(new RegExp(`/tasks/${taskId}\\?tab=activity$`));

  // A new open, its report held until the switch has been made.
  let letGo: () => void = () => undefined;
  const released = new Promise<void>((resolve) => {
    letGo = resolve;
  });
  let caught: () => void = () => undefined;
  const held = new Promise<void>((resolve) => {
    caught = resolve;
  });
  let reportEnded = false;
  page.on("requestfinished", (request) => {
    if (isReport(request)) reportEnded = true;
  });
  await page.route("**/api/app-report", async (route) => {
    if (!isReport(route.request())) return route.fallback();
    caught();
    await released;
    await route.fallback();
  });
  await page.goto(`/tasks/${taskId}`);
  await hydrated(page);
  await held;
  // Work is the default view (no query): Details carries one, written while the report is out.
  await tab(page, "details").click();
  await expect(tab(page, "details")).toHaveAttribute("aria-current", "true");
  await expect(page).toHaveURL(new RegExp(`/tasks/${taskId}\\?tab=details$`));
  expect(reportEnded, "the report is still out").toBe(false);
  letGo();
  await expect(page).toHaveURL(new RegExp(`/tasks/${taskId}\\?tab=details$`));
});

test("a list's filter chosen during a refresh changes the list at once; the address follows when it ends", async ({
  page,
}) => {
  await page.clock.install();
  await page.goto("/tasks/all");
  await hydrated(page);
  const filter = page.locator('[data-filter="state"]:visible');
  await expect(filter).toBeVisible();
  const refresh = await holdNextRefresh(page, "/tasks/all");
  await returnToApp(page);
  await refresh.held;

  await filter.click();
  await page.getByRole("option", { name: "Any state", exact: true }).click();
  await expect(filter).toHaveText(/Any state/);
  await expect(page).toHaveURL(/\/tasks\/all$/);

  refresh.release();
  await refresh.answered;
  await expect(page).toHaveURL(/\/tasks\/all\?state=all$/);
  await expect(filter).toHaveText(/Any state/);
});

test.describe("as the Crew member", () => {
  test.use({ storageState: storageStateFor("staff") });

  /**
   * Also the check on Next's private marker: an action's answer that revalidates ends its hold
   * only when the router has committed it, which `NavProgress` reads from Next writing its own
   * history entry (`__NA`, `history-writes.ts`). Were Next to rename that marker, the hold would
   * never end and the address would never be written: this test turns red on its `toHaveURL`.
   */
  test("the task page: a view switched while an action's answer is being applied is written once committed; one back leaves", async ({
    page,
  }, info) => {
    const title = `View address ${info.project.name} action`;
    await removeTasksTitled(title);
    const staffId = await memberIdOf(USERS.staff.email);
    const taskId = await rpcAs<string>(USERS.owner.email, USERS.owner.password, "task_create", {
      title,
      description: null,
      task_type_id: await taskTypeId("Normal"),
      client_id: null,
      priority: "medium",
      due_at: istInstant(workingDay(46), "18:00"),
      assignee_ids: [staffId],
      primary_owner_id: staffId,
      approving_admin_id: null,
      stages: [],
    });
    await page.goto("/tasks");
    await hydrated(page);
    await page.goto(`/tasks/${taskId}`);
    await hydrated(page);
    await expect(page.locator('[data-slot="task-tabs"]')).toHaveAttribute("data-live", "");

    // Task Noted's answer (it revalidates the page) is held at the network.
    let reached: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      reached = resolve;
    });
    let letGo: () => void = () => undefined;
    const released = new Promise<void>((resolve) => {
      letGo = resolve;
    });
    await page.route(`**/tasks/${taskId}*`, async (route) => {
      const request = route.request();
      if (request.method() !== "POST" || !request.headers()["next-action"]) {
        return route.fallback();
      }
      reached();
      await released;
      await route.fallback();
    });
    const step = page.locator('[data-slot="task-next-step"]');
    await step.getByRole("button", { name: "Task Noted" }).click();
    await held;

    await tab(page, "activity").click();
    await expect(tab(page, "activity")).toHaveAttribute("aria-current", "true");
    await expect(page).toHaveURL(new RegExp(`/tasks/${taskId}$`));
    letGo();
    await expect(step.getByRole("button", { name: "Start work" })).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`/tasks/${taskId}\\?tab=activity$`));
    await expect(tab(page, "activity")).toHaveAttribute("aria-current", "true");
    // No second entry was pushed under the view: one back leaves the task.
    await page.goBack();
    await expect(page).toHaveURL(/\/tasks$/);
  });
});
