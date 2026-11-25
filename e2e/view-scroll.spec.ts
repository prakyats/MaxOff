import { type Page, type Request, type TestInfo } from "@playwright/test";

import { expect, test } from "./fixtures";

import { addISTDays, istInstant, istWeekday, systemClock, todayIST } from "../src/core/time";

import {
  hydrated,
  insertAs,
  memberIdOf,
  removeClientFixture,
  removeTasksTitled,
  rpcAs,
  serviceDelete,
  serviceInsert,
  serviceSelect,
  serviceUpdate,
  storageStateFor,
  taskTypeId,
  USERS,
} from "./helpers";

/**
 * A view control and the live refresh (ARCHITECTURE §14.2 d; v1.9, issue #89, the owner's option
 * (b) of 3 Nov 2026). A view control writes its view to the address by hand
 * (`replaceViewAddress` → `history.replaceState`); Next 16.3.5 then "restores" its router with the
 * tree it has, whose page segment is still keyed by the old query. The next refresh of the screen
 * (a notification for the reader, a return to the app) answers with the new key; Next takes that
 * for a tree mismatch and retries through its server-patch path, which scrolled the page to the
 * top although a refresh asks for no scroll (CI: "Expected 230 / 222, Received 0" at 1280/1440).
 * The fix is the patch of Next (`patches/next@16.3.5.patch`): the retry keeps the refresh's
 * no-scroll. These specs hold it, and hold what the owner made a condition of it: a view switch
 * still fetches nothing from the server and still works offline.
 *
 * The people are `tasks.spec`'s Crew (`task-staff-<project>@maxoff.local`) on IST days of their
 * own; the reader is the Owner. Service workers are blocked so every router fetch is in sight (and
 * an offline fetch fails as a page without one would).
 */

test.use({ storageState: storageStateFor("owner") });
test.use({ serviceWorkers: "block" });

const PASSWORD = "task-local-password";
const laptop = (info: TestInfo) => info.project.name === "desktop";

function staffOf(info: TestInfo): string {
  return `task-staff-${info.project.name}@maxoff.local`;
}

/** A weekday (Mon–Fri) at least `offset` days from today, IST. */
function workingDay(offset: number): string {
  let day = addISTDays(todayIST(), offset);
  while (istWeekday(day) === 0 || istWeekday(day) === 6) day = addISTDays(day, 1);
  return day;
}

const tab = (page: Page, view: string) =>
  page.locator(`[data-slot="task-tab"][data-view-tab="${view}"]`);
const panel = (page: Page, view: string) => page.locator(`[data-slot="task-panel-${view}"]`);

/** A task long enough to scroll: many stages and a 30-message chat, all read by the Owner. */
async function longTask(info: TestInfo, title: string, day: number): Promise<string> {
  await removeTasksTitled(title);
  const staff = staffOf(info);
  const staffId = await memberIdOf(staff);
  const taskId = await rpcAs<string>(USERS.owner.email, USERS.owner.password, "task_create", {
    title,
    description: Array.from({ length: 12 }, (_, i) => `Brief line ${i + 1}.`).join("\n"),
    task_type_id: await taskTypeId("Normal"),
    client_id: null,
    priority: "medium",
    due_at: istInstant(workingDay(day), "18:00"),
    assignee_ids: [staffId],
    primary_owner_id: staffId,
    approving_admin_id: null,
    stages: Array.from({ length: 14 }, (_, i) => `Stage ${i + 1}`),
  });
  for (let index = 0; index < 30; index += 1) {
    const comment = await insertAs<{ id: string }>(staff, PASSWORD, "task_comments", {
      task_id: taskId,
      body: `Cut note ${index + 1}`,
    });
    await serviceUpdate(`task_comments?id=eq.${comment.id}`, {
      created_at: istInstant(addISTDays(todayIST(), -1), `11:${String(index).padStart(2, "0")}`),
    });
  }
  await rpcAs(USERS.owner.email, USERS.owner.password, "task_mark_read", {
    task_id: taskId,
    up_to: istInstant(todayIST(), "00:00"),
  });
  await serviceUpdate(`notifications?entity_id=eq.${taskId}&read_at=is.null`, {
    read_at: systemClock().toISOString(),
  });
  return taskId;
}

/** A router fetch of a screen (not a prefetch), or a document load. */
function screenFetch(request: Request): boolean {
  if (request.resourceType() === "document") return true;
  const headers = request.headers();
  return headers["rsc"] === "1" && !headers["next-router-prefetch"];
}

/** Every screen fetch the page sends from now on, and how many are still out. */
function watchScreenFetches(page: Page) {
  const sent: string[] = [];
  const out = new Set<Request>();
  page.on("request", (request) => {
    if (!screenFetch(request)) return;
    sent.push(`${request.resourceType()} ${new URL(request.url()).pathname}`);
    out.add(request);
  });
  const done = (request: Request) => out.delete(request);
  page.on("requestfinished", done);
  page.on("requestfailed", done);
  return { sent, out };
}

/** One notification arrives for the Owner (a message for the reader): Realtime refreshes the screen. */
async function notifyOwner(title: string): Promise<string> {
  const [owner] = await serviceSelect<{ id: string; org_id: string }>(
    `members?email=eq.${encodeURIComponent(USERS.owner.email)}&select=id,org_id`,
  );
  const row = await serviceInsert<{ id: string }>("notifications", {
    org_id: owner!.org_id,
    recipient_id: owner!.id,
    kind: "leave_decided",
    title,
    link: null,
  });
  return row.id;
}

/**
 * The live refresh has been answered and the router has committed what it brought: every screen
 * fetch it sent (the refresh and the retry Next sends after it) has finished and none has started
 * for two frames after the last one ended.
 */
async function refreshSettled(
  page: Page,
  fetches: ReturnType<typeof watchScreenFetches>,
  before: number,
) {
  await expect
    .poll(() => fetches.sent.length, { message: "the live refresh went out" })
    .toBeGreaterThan(before);
  await expect
    .poll(async () => {
      if (fetches.out.size > 0) return false;
      const count = fetches.sent.length;
      await page.evaluate(
        () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
      );
      return fetches.out.size === 0 && fetches.sent.length === count;
    })
    .toBe(true);
}

test.describe("a message arrives while scrolled: the page stays where it is", () => {
  for (const size of [
    { width: 1280, height: 720 },
    { width: 1440, height: 900 },
  ]) {
    test(`laptop ${size.width}: after Work → Chat, scrolled down, a notification refreshes the screen in place`, async ({
      page,
    }, info) => {
      test.skip(!laptop(info), "the laptop sizes run in the desktop project");
      const title = `Kept scroll ${size.width} ${info.project.name}`;
      const taskId = await longTask(info, title, 52 + (size.width === 1440 ? 1 : 0));
      await page.setViewportSize(size);
      await page.goto(`/tasks/${taskId}`);
      await hydrated(page);
      await expect(page.locator('[data-slot="task-tabs"]')).toHaveAttribute("data-live", "");
      await expect(page.locator("html")).toHaveAttribute("data-live", "on");

      await tab(page, "chat").click();
      await expect(panel(page, "chat")).toBeVisible();
      await expect(page).toHaveURL(new RegExp(`/tasks/${taskId}\\?tab=chat$`));
      await page.mouse.move(size.width - 40, 200);
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(100);
      const scrolled = await page.evaluate(() => window.scrollY);

      const fetches = watchScreenFetches(page);
      const id = await notifyOwner(`${title} message`);
      try {
        await refreshSettled(page, fetches, 0);
        expect(await page.evaluate(() => window.scrollY), fetches.sent.join(", ")).toBe(scrolled);
        await expect(panel(page, "chat")).toBeVisible();
        await expect(page).toHaveURL(new RegExp(`/tasks/${taskId}\\?tab=chat$`));
      } finally {
        await serviceDelete(`notifications?id=eq.${id}`);
      }
    });
  }

  test("phone: after Details → Work, scrolled down, a notification refreshes the screen in place", async ({
    page,
  }, info) => {
    test.skip(laptop(info), "the phone widths, 375 and 430px");
    const title = `Kept scroll ${info.project.name}`;
    const taskId = await longTask(info, title, 54);
    await page.goto(`/tasks/${taskId}?tab=details`);
    await hydrated(page);
    await expect(page.locator('[data-slot="task-tabs"]')).toHaveAttribute("data-live", "");
    await expect(page.locator("html")).toHaveAttribute("data-live", "on");

    await tab(page, "work").click();
    await expect(panel(page, "work")).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`/tasks/${taskId}$`));
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(100);
    const scrolled = await page.evaluate(() => window.scrollY);

    const fetches = watchScreenFetches(page);
    const id = await notifyOwner(`${title} message`);
    try {
      await refreshSettled(page, fetches, 0);
      expect(await page.evaluate(() => window.scrollY), fetches.sent.join(", ")).toBe(scrolled);
      await expect(panel(page, "work")).toBeVisible();
    } finally {
      await serviceDelete(`notifications?id=eq.${id}`);
    }
  });
});

/**
 * The owner's condition on the patch: a view switch is still the page's own state and its
 * hand-written address, never a server fetch, so it still works offline. Laptop and phone, on the
 * task page's views and on a list's filter (Clients' state).
 */
test.describe("a view switch fetches nothing and works offline", () => {
  // No Realtime here (as `prefetch-likely.spec`'s quiet background): a notification for the
  // shared Owner from another spec would refresh the screen, and a refresh is a server fetch
  // (offline, Next's own fallback for it is a page load), not the view switch this proves.
  test.beforeEach(async ({ page }) => {
    await page.routeWebSocket(/\/realtime\/v1\/websocket/, () => {});
  });

  /** Counts document loads from now on (the reload guard fails any the test did not ask for). */
  function countLoads(page: Page) {
    const loads = { count: 0 };
    page.on("load", () => {
      loads.count += 1;
    });
    return loads;
  }

  test("the task page's views", async ({ page, context }, info) => {
    const title = `Offline views ${info.project.name}`;
    const taskId = await longTask(info, title, 55);
    const [first, second] = laptop(info) ? ["work", "chat"] : ["work", "details"];
    await page.goto(`/tasks/${taskId}`);
    await hydrated(page);
    await expect(page.locator('[data-slot="task-tabs"]')).toHaveAttribute("data-live", "");
    const fetches = watchScreenFetches(page);
    const loads = countLoads(page);

    // Online: each switch shows its view and writes its address; nothing is fetched.
    await tab(page, second).click();
    await expect(panel(page, second)).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`/tasks/${taskId}\\?tab=${second}$`));
    await tab(page, first).click();
    await expect(panel(page, first)).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`/tasks/${taskId}$`));
    expect(fetches.sent, "no screen fetch on a view switch").toEqual([]);

    // Offline: the same switches, no page load, no offline page.
    await context.setOffline(true);
    try {
      await tab(page, second).click();
      await expect(panel(page, second)).toBeVisible();
      await expect(page).toHaveURL(new RegExp(`/tasks/${taskId}\\?tab=${second}$`));
      await tab(page, first).click();
      await expect(panel(page, first)).toBeVisible();
      await expect(page).toHaveURL(new RegExp(`/tasks/${taskId}$`));
      await tab(page, second).click();
      await expect(panel(page, second)).toBeVisible();
      await expect(page).toHaveURL(new RegExp(`/tasks/${taskId}\\?tab=${second}$`));
      expect(fetches.sent, "no screen fetch on a view switch, offline").toEqual([]);
      expect(loads.count, "no page load").toBe(0);
      await expect(page.locator('[data-slot="task-tabs"]')).toBeVisible();
    } finally {
      await context.setOffline(false);
    }
  });

  test("a list's filter (Clients' state)", async ({ page, context }, info) => {
    // A client of the test's own, so the list (and its filters) shows on a fresh database.
    const name = `Offline filter (${info.project.name})`;
    await removeClientFixture(name);
    const [org] = await serviceSelect<{ id: string }>("organizations?select=id&limit=1");
    await serviceInsert("clients", { org_id: org?.id, name, admin_id: null });
    await page.goto("/clients");
    await hydrated(page);
    const fetches = watchScreenFetches(page);
    const loads = countLoads(page);
    const state = page.locator('[data-filter="state"]');
    const choose = async (option: string) => {
      await state.click();
      await page.getByRole("option", { name: option, exact: true }).click();
      await expect(state).toHaveText(option);
      // The rows follow: the draft client shows under All states only.
      const row = page.locator("main").getByText(name, { exact: true }).filter({ visible: true });
      if (option === "All states") await expect(row).toBeVisible();
      else await expect(row).toHaveCount(0);
    };

    // Searched first (search never enters the address), so the row is on the phone's first page
    // whatever other specs have added.
    await page.locator('[data-slot="data-search"] input').fill(name);
    await choose("All states");
    await expect(page).toHaveURL(/\/clients\?state=all$/);
    await choose("Active");
    await expect(page).toHaveURL(/\/clients$/);
    expect(fetches.sent, "no screen fetch on a filter switch").toEqual([]);

    await context.setOffline(true);
    try {
      await choose("All states");
      await expect(page).toHaveURL(/\/clients\?state=all$/);
      await choose("Active");
      await expect(page).toHaveURL(/\/clients$/);
      expect(fetches.sent, "no screen fetch on a filter switch, offline").toEqual([]);
      expect(loads.count, "no page load").toBe(0);
      await expect(state).toBeVisible();
    } finally {
      await context.setOffline(false);
    }
  });
});
