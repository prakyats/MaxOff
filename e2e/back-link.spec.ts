import type { Page } from "@playwright/test";

import { expect, test } from "./fixtures";
import {
  expectSettled,
  hydrated,
  memberIdOf,
  removeClientFixture,
  removeTasksTitled,
  rpcAs,
  runInstalled,
  serviceInsert,
  serviceSelect,
  storageStateFor,
  taskTypeId,
  USERS,
} from "./helpers";
import { addISTDays, istInstant, todayIST } from "../src/core/time";

/**
 * The header's back control, swept over every drill-down screen (ARCHITECTURE §14.2 k; the
 * owner's report of 15 Oct 2026: "‹ Settings sometimes does nothing"). **One tap always lands on
 * the page the label names**: back to it when it is the page beneath (over this screen's own
 * spent entries), otherwise the parent by replace. Never a no-op, never two taps.
 *
 * Every screen with a `PageHeader` `back`, as the Owner (who reaches all of them), arrived:
 * (a) by drilling in from its parent; (b) by a direct load (a new tab); (c) from Today, which is
 * not its parent; (d) after an overlay was opened and closed by hand (the spent entry the owner's
 * no-op came from: the More sheet's ✕ on a phone, the account menu dismissed by a click outside
 * on a laptop); and on the screens with a view control, (e) after a view change. Then (f) without
 * the Navigation API (Safari before 26.2): the API is removed before the page loads, and one tap
 * still lands on the parent. WebKit is not installed on this machine nor on CI, so (f) is how the
 * no-API path (an older installed iPhone) is proved, in Chromium.
 *
 * Installed at 375 and 430 (the `mobile` and `mobile-lg` projects), a browser at 1280.
 * A drill-in is the app's own push (`window.next.router.push`, what a link does), so the sweep
 * needs no knowledge of where each screen's link sits on its parent.
 */

test.use({ storageState: storageStateFor("owner") });

const PREFIX = "Back sweep ";

type Screen = {
  /** The screen's address. */
  path: string;
  /** The parent its back control names. */
  parent: string;
  /** Where one tap lands when the screen was opened from Today (the parent, unless Today is one of the screens it returns to). */
  fromToday?: string;
  /** A view control on the screen: one tap that replaces its address. */
  view?: (page: Page) => Promise<void>;
};

const STATIC_SCREENS: Screen[] = [
  ...[
    "days-off",
    "task-types",
    "job-titles",
    "expenses",
    "templates",
    "notifications",
    "company",
    "thresholds",
    "custom-fields",
    "stage-presets",
  ].map((section) => ({ path: `/settings/${section}`, parent: "/settings" })),
  { path: "/tasks/all", parent: "/tasks" },
  { path: "/tasks/requests", parent: "/tasks" },
  {
    path: "/today/people",
    parent: "/today",
    view: async (page) => {
      await page
        .locator('[data-slot="people-filter"]')
        .getByRole("link", { name: "Absent" })
        .click();
      await expect(page).toHaveURL(/\/today\/people\?group=absent$/);
    },
  },
  { path: "/clients/items", parent: "/today" },
  { path: "/clients/items/decide", parent: "/today" },
  { path: "/me/guide", parent: "/me" },
  { path: "/reports/month", parent: "/reports" },
  { path: "/reports/end-of-day", parent: "/reports" },
  { path: `/reports/end-of-day/${todayIST()}`, parent: "/reports/end-of-day" },
];

type RecordKind = "task" | "person" | "client" | "project" | "contact";

/** A client of this test's own (neutral name), active, with its Admin. */
async function ownClient(name: string): Promise<{ id: string; org: string }> {
  await removeClientFixture(name);
  const [org] = await serviceSelect<{ id: string }>("organizations?select=id&limit=1");
  const client = await serviceInsert<{ id: string }>("clients", {
    org_id: org?.id,
    name,
    admin_id: await memberIdOf(USERS.admin.email),
  });
  await rpcAs(USERS.owner.email, USERS.owner.password, "client_activate", {
    client_id: client.id,
  });
  return { id: client.id, org: org?.id ?? "" };
}

/** One record screen, on a record this test makes (neutral names) or the seed's Crew member. */
async function recordScreen(kind: RecordKind, project: string): Promise<Screen> {
  const name = `${PREFIX}${project} ${kind}`;
  if (kind === "task") {
    await removeTasksTitled(name);
    const staffId = await memberIdOf(USERS.staff.email);
    const taskId = await rpcAs<string>(USERS.owner.email, USERS.owner.password, "task_create", {
      title: name,
      description: null,
      task_type_id: await taskTypeId("Normal"),
      client_id: null,
      priority: "medium",
      due_at: istInstant(addISTDays(todayIST(), 20), "18:00"),
      assignee_ids: [staffId],
      primary_owner_id: staffId,
      approving_admin_id: null,
      stages: [],
    });
    return {
      path: `/tasks/${taskId}`,
      parent: "/tasks",
      // Today lists tasks: the task page returns there and its control says "Today".
      fromToday: "/today",
      view: async (page) => {
        await expect(page.locator('[data-slot="task-tabs"]')).toHaveAttribute("data-live", "");
        await page.locator('[data-slot="task-tab"][data-view-tab="activity"]').click();
        await expect(page.locator('[data-slot="task-panel-activity"]')).toBeVisible();
      },
    };
  }
  if (kind === "person") {
    const staffId = await memberIdOf(USERS.staff.email);
    return { path: `/people/${staffId}`, parent: "/people", fromToday: "/today" };
  }
  const client = await ownClient(name);
  if (kind === "client") {
    return { path: `/clients/${client.id}`, parent: "/clients", fromToday: "/today" };
  }
  if (kind === "project") {
    const projectId = await rpcAs<string>(
      USERS.admin.email,
      USERS.admin.password,
      "project_create",
      {
        client_id: client.id,
        name: "Project",
        recurrence: "one_time",
        delivery_date: addISTDays(todayIST(), 30),
        stages: [],
        items: ["Item"],
      },
    );
    return {
      path: `/clients/${client.id}/projects/${projectId}`,
      parent: `/clients/${client.id}/projects`,
      fromToday: "/today",
    };
  }
  const contact = await serviceInsert<{ id: string }>("client_contacts", {
    org_id: client.org,
    client_id: client.id,
    name: "Contact",
  });
  return { path: `/clients/${client.id}/contacts/${contact.id}`, parent: `/clients/${client.id}` };
}

const exactly = (path: string) => new RegExp(`^[^?#]*//[^/]+${path.replace(/[.?]/g, "\\$&")}$`);
const backControl = (page: Page) => page.locator('[data-slot="page-back"]:visible');

/** The app's own push, as a link makes it. */
async function drillTo(page: Page, path: string): Promise<void> {
  await page.evaluate((href) => {
    (window as unknown as { next: { router: { push: (href: string) => void } } }).next.router.push(
      href,
    );
  }, path);
  await expect(page).toHaveURL(exactly(path));
  await hydrated(page);
}

async function open(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await expect(page).toHaveURL(exactly(path));
  await hydrated(page);
}

/** One tap on the back control: it lands on `parent`, in one tap. */
async function tapBack(
  page: Page,
  parent: string,
  why: string,
  /** The parent the screen's control links to, when it is not where the tap lands. */
  linksTo: string = parent,
): Promise<void> {
  // The screen itself is there, not the one before it (an address changes before its screen).
  await expect(backControl(page), `${why}: the screen's own back control`).toHaveAttribute(
    "href",
    linksTo,
  );
  await backControl(page).click();
  await expect(page, why).toHaveURL(exactly(parent));
  await hydrated(page);
}

/** An overlay opened and dismissed by hand, leaving its spent history entry (§14.2 a). */
async function openAndDismissOverlay(page: Page, phone: boolean): Promise<void> {
  if (phone) {
    await page.locator('[data-slot="bottom-nav"] [data-nav="more"]').click();
    const sheet = page.locator('[data-slot="more-sheet"]');
    await expect(sheet).toBeVisible();
    await sheet.getByRole("button", { name: "Close" }).click();
    await expect(sheet).toBeHidden();
    return;
  }
  // The screen itself has streamed in: a push lands on the route's loading skeleton first, and
  // its title bar is swapped for the screen's while the page arrives, so a title measured then
  // can be a detached node (CI, /reports/month at 1280, 2026-10-16).
  await expectSettled(page);
  await page.getByRole("button", { name: "Account menu" }).click();
  const menu = page.getByRole("menu");
  await expect(menu).toBeVisible();
  // A click outside it, on the title (the menu is modal: nothing under the click is hit).
  const title = await page.locator('[data-slot="page-header"] h1').boundingBox();
  if (!title) throw new Error("the title is not on screen");
  await page.mouse.click(title.x + title.width / 2, title.y + title.height / 2);
  await expect(menu).toBeHidden();
}

async function sweep(page: Page, screen: Screen, phone: boolean, fresh: () => Promise<Page>) {
  // (a) drilled in from the parent: back to it, the screen still ahead (nothing replaced).
  await open(page, screen.parent);
  await drillTo(page, screen.path);
  await tapBack(page, screen.parent, `${screen.path} (a) drilled in`);
  await page.goForward();
  await expect(page).toHaveURL(exactly(screen.path));
  await hydrated(page);
  await tapBack(page, screen.parent, `${screen.path} (a) again, after forward`);

  // (b) a direct load in a new tab: nothing of ours beneath, the parent by replace.
  const tab = await fresh();
  await open(tab, screen.path);
  await tapBack(tab, screen.parent, `${screen.path} (b) direct load`);
  await tab.close();

  // (c) from Today, not its parent (unless it is): the parent the label names, by replace.
  await open(page, "/today");
  await drillTo(page, screen.path);
  const landing = screen.fromToday ?? screen.parent;
  await tapBack(page, landing, `${screen.path} (c) from Today`, screen.parent);
  if (landing !== "/today") {
    // Replaced, not pushed: the next back is Today again.
    await page.goBack();
    await expect(page).toHaveURL(exactly("/today"));
    await hydrated(page);
  }

  // (d) an overlay opened and closed by hand first: still one tap (the owner's no-op).
  await open(page, screen.parent);
  await drillTo(page, screen.path);
  await openAndDismissOverlay(page, phone);
  await tapBack(page, screen.parent, `${screen.path} (d) after an overlay`);

  // (e) a view changed first: a replace, so one tap still lands on the parent.
  if (screen.view) {
    await open(page, screen.parent);
    await drillTo(page, screen.path);
    await screen.view(page);
    await tapBack(page, screen.parent, `${screen.path} (e) after a view change`);
  }
}

test.describe("the back control, every drill-down screen", () => {
  for (const screen of STATIC_SCREENS) {
    test(`${screen.path} → ${screen.parent}`, async ({ page, context }, info) => {
      const phone = info.project.name !== "desktop";
      if (phone) await runInstalled(page);
      await sweep(page, screen, phone, async () => {
        const tab = await context.newPage();
        if (phone) await runInstalled(tab);
        return tab;
      });
    });
  }

  for (const kind of ["task", "person", "client", "project", "contact"] as const) {
    test(`a ${kind}'s screen`, async ({ page, context }, info) => {
      const phone = info.project.name !== "desktop";
      if (phone) await runInstalled(page);
      const screen = await recordScreen(kind, info.project.name);
      await sweep(page, screen, phone, async () => {
        const tab = await context.newPage();
        if (phone) await runInstalled(tab);
        return tab;
      });
      if (kind === "task") await removeTasksTitled(`${PREFIX}${info.project.name} task`);
    });
  }
});

test.describe("without the Navigation API (an iPhone before Safari 26.2)", () => {
  test("one tap lands on the parent, by replace, after an overlay too", async ({ page }, info) => {
    const phone = info.project.name !== "desktop";
    if (phone) await runInstalled(page);
    await page.addInitScript(() => {
      Reflect.deleteProperty(window, "navigation");
      Reflect.deleteProperty(Object.getPrototypeOf(window) as object, "navigation");
    });
    await open(page, "/settings");
    expect(await page.evaluate(() => "navigation" in window)).toBe(false);
    await drillTo(page, "/settings/stage-presets");
    await tapBack(page, "/settings", "no API: the parent");
    await drillTo(page, "/settings/stage-presets");
    await openAndDismissOverlay(page, phone);
    await tapBack(page, "/settings", "no API, after an overlay: still one tap");
    // The overlay's spent entry was backed out first: the parent replaced the screen's own entry.
    await page.goBack();
    await expect(page).toHaveURL(exactly("/settings"));
  });
});

test.describe("the owner's report (15 Oct 2026), as it happened", () => {
  test("Settings → Stage presets → Add preset → Cancel → ‹ Settings: one tap", async ({
    page,
  }, info) => {
    if (info.project.name !== "desktop") await runInstalled(page);
    await open(page, "/settings");
    await page.getByRole("link", { name: /Stage presets/ }).click();
    await expect(page).toHaveURL(exactly("/settings/stage-presets"));
    await hydrated(page);
    await page.getByRole("button", { name: "Add preset" }).first().click();
    const add = page.getByRole("dialog", { name: "Add a stage preset" });
    await expect(add).toBeVisible();
    await add
      .getByRole("button", { name: /Cancel|Close/ })
      .first()
      .click();
    await expect(add).toBeHidden();
    await tapBack(page, "/settings", "one tap after the dialog's Cancel");
  });
});
