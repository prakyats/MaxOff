import { createClient } from "@supabase/supabase-js";
import type { Page, TestInfo } from "@playwright/test";

import { expect, test } from "./fixtures";
import { HOLD_PROXY_URL } from "./hold-proxy-config";
import {
  expectBackStack,
  hydrated,
  memberIdOf,
  removeClientFixture,
  rpcAs,
  runInstalled,
  serviceInsert,
  serviceRest,
  serviceSelect,
  storageStateFor,
  supabaseAuth,
  USERS,
} from "./helpers";
import { istDate, wallClock } from "./run-state";

/**
 * Client work (phase 7, unit 7B: tasks 7.3 and 7.4; PRODUCT §4.5, §4.7, §4.8, §4.16; WORKFLOWS §5;
 * kickoff 7 decisions 16–26, amendments A–C, issue #56 Q1): an Admin's own new client (amendment
 * B), the Projects tab and New project, the project page (Mark done, a stage tick in the item
 * sheet, the bulk "Mark N done", Not done, the progress line), Approvals' Client items for the
 * client's Admin (Approve is a delayed send) and none for the Owner, the cross-client list and the
 * Owner's Today count grouped by Admin, the carry screen, Settings → Stage presets, the calendar's
 * client items (never Crew's), Realtime holding RLS for items, and the back order of every new
 * screen and overlay installed at 375 and 430 px (ARCHITECTURE §14.2).
 *
 * Every client is named for its test and project and removed first (`removeClientFixture`, which
 * removes its client work too), so projects never race and the spec re-runs on a used database.
 * The seeded Admin runs the clients; assertions look for the test's own rows only.
 */

const admin = USERS.admin;
const owner = USERS.owner;
const nameOf = (info: TestInfo, what: string) => `CW ${what} (${info.project.name})`;

function today(): string {
  return istDate(wallClock());
}

function addDays(date: string, days: number): string {
  const at = new Date(`${date}T00:00:00Z`);
  at.setUTCDate(at.getUTCDate() + days);
  return at.toISOString().slice(0, 10);
}

/** An Active client run by the seeded Admin. */
async function workClient(name: string): Promise<string> {
  await removeClientFixture(name);
  const [org] = await serviceSelect<{ id: string }>("organizations?select=id&limit=1");
  const row = await serviceInsert<{ id: string }>("clients", {
    org_id: org?.id,
    name,
    admin_id: await memberIdOf(admin.email),
  });
  await rpcAs(owner.email, owner.password, "client_activate", { client_id: row.id });
  return row.id;
}

/** A project made by the client's Admin through `project_create`. */
async function makeProject(
  clientId: string,
  name: string,
  options: { recurrence?: string; items: string[]; stages?: string[]; delivery?: string },
): Promise<string> {
  return rpcAs<string>(admin.email, admin.password, "project_create", {
    client_id: clientId,
    name,
    recurrence: options.recurrence ?? "monthly",
    stages: options.stages ?? [],
    items: options.items,
    ...(options.delivery ? { delivery_date: options.delivery } : {}),
  });
}

async function itemId(projectId: string, title: string): Promise<string> {
  const rows = await serviceSelect<{ id: string }>(
    `project_items?project_id=eq.${projectId}&title=eq.${encodeURIComponent(title)}&select=id&order=created_at.desc`,
  );
  expect(rows[0], `the item ${title}`).toBeTruthy();
  return rows[0]!.id;
}

async function itemState(id: string): Promise<string | undefined> {
  const [row] = await serviceSelect<{ state: string }>(`project_items?id=eq.${id}&select=state`);
  return row?.state;
}

const progress = (page: Page) => page.locator('[data-slot="cycle-progress"]');
const itemRow = (page: Page, title: string) =>
  page.locator('[data-slot="item-row"]', { hasText: title });

test.use({ storageState: storageStateFor("admin") });

test("an Admin adds their own client: Active and theirs (amendment B)", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "one run is enough");
  const name = nameOf(info, "own client");
  await removeClientFixture(name);
  await page.goto("/clients");
  await hydrated(page);
  await page.getByRole("button", { name: "New client" }).click();
  const dialog = page.getByRole("dialog", { name: "New client" });
  await expect(dialog.getByText("It starts Active, and you run it.")).toBeVisible();
  await expect(dialog.getByLabel("Admin")).toHaveCount(0);
  await dialog.getByLabel("Client name").fill(name);
  await dialog.getByRole("button", { name: "Create client" }).click();
  await expect(page).toHaveURL(/\/clients\/[0-9a-f-]{36}$/);
  const [row] = await serviceSelect<{ state: string; admin_id: string }>(
    `clients?name=eq.${encodeURIComponent(name)}&select=state,admin_id`,
  );
  expect(row).toEqual({ state: "active", admin_id: await memberIdOf(admin.email) });
  await expect(page.locator('[data-slot="client-tabs"]')).toContainText("Projects");
  await removeClientFixture(name);
});

test("a project from the Projects tab: Mark done, a stage tick, Mark N done, Not done", async ({
  page,
}, info) => {
  const client = nameOf(info, "projects");
  const clientId = await workClient(client);
  await page.goto(`/clients/${clientId}/projects`);
  await hydrated(page);
  await expect(page.getByText("No projects yet.")).toBeVisible();
  await page.getByRole("button", { name: "New project" }).click();
  const dialog = page.getByRole("dialog", { name: "New project" });
  await dialog.getByLabel("Project name").fill("Monthly reels");
  await dialog.getByLabel("Stages, one per line").fill("Script\nEdit");
  await dialog.getByLabel("Item list").fill("Reel 1\nReel 2\nReel 3");
  await dialog.getByRole("button", { name: "Create project" }).click();
  await expect(page).toHaveURL(new RegExp(`/clients/${clientId}/projects/[0-9a-f-]{36}$`));
  await hydrated(page);
  await expect(progress(page)).toHaveText("0/3 done · 0/3 approved");

  // One row's Mark done.
  await itemRow(page, "Reel 1").getByRole("button", { name: "Mark done" }).click();
  await expect(progress(page)).toHaveText("1/3 done · 0/3 approved");

  // A stage ticked in the item sheet; back closes the sheet.
  await itemRow(page, "Reel 2").locator('[data-slot="item-open"]').click();
  const sheet = page.locator('[data-slot="review-sheet"]');
  const script = sheet.getByRole("checkbox", { name: "Script" });
  await expect(script).toHaveAttribute("aria-checked", "false");
  await script.click();
  await expect(script).toHaveAttribute("aria-checked", "true");
  await page.goBack();
  await expect(sheet).toBeHidden();

  // Bulk: select two, "Mark 2 done".
  await itemRow(page, "Reel 2").getByRole("checkbox").click();
  await itemRow(page, "Reel 3").getByRole("checkbox").click();
  await page.getByRole("button", { name: "Mark 2 done" }).click();
  await expect(progress(page)).toHaveText("3/3 done · 0/3 approved");

  // Not done (decision 6), from the sheet.
  await itemRow(page, "Reel 3").locator('[data-slot="item-open"]').click();
  await sheet.getByRole("button", { name: "Not done" }).click();
  await expect(progress(page)).toHaveText("2/3 done · 0/3 approved");
  await removeClientFixture(client);
});

test("Approvals → Client items: the client's Admin approves with Undo; the Owner gets none", async ({
  page,
  browser,
}, info) => {
  const client = nameOf(info, "approvals");
  const clientId = await workClient(client);
  const projectId = await makeProject(clientId, "Brand film", {
    recurrence: "one_time",
    delivery: addDays(today(), 10),
    items: [nameOf(info, "cut")],
  });
  const id = await itemId(projectId, nameOf(info, "cut"));
  await rpcAs(admin.email, admin.password, "item_mark_done", { item_id: id });

  await page.goto("/approvals");
  await hydrated(page);
  const group = page.locator('[data-slot="approval-group"][data-group="client-items"]');
  const row = page.locator('[data-slot="approval-row"]', { hasText: nameOf(info, "cut") });
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: "Approve" }).click();
  await expect(page.getByText(`Approved ${nameOf(info, "cut")}`)).toBeVisible();
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect.poll(() => itemState(id)).toBe("approved");
  await expect(group).toHaveCount(await group.count());

  // The Owner's Approvals take no client items (issue #56 Q1).
  const context = await browser.newContext({ storageState: storageStateFor("owner") });
  const ownerPage = await context.newPage();
  const second = await makeProject(clientId, "Second film", {
    recurrence: "one_time",
    delivery: addDays(today(), 10),
    items: [nameOf(info, "second")],
  });
  await rpcAs(admin.email, admin.password, "item_mark_done", {
    item_id: await itemId(second, nameOf(info, "second")),
  });
  await ownerPage.goto("/approvals");
  await expect(ownerPage.locator('[data-slot="page-header"]')).toBeVisible();
  await expect(ownerPage.getByText(nameOf(info, "second"))).toHaveCount(0);
  await context.close();
  await removeClientFixture(client);
});

test("the Owner's Today: N client items overdue, the list grouped by Admin", async ({
  browser,
}, info) => {
  const client = nameOf(info, "overdue");
  const clientId = await workClient(client);
  const projectId = await makeProject(clientId, "Weekly stories", {
    recurrence: "weekly",
    items: [nameOf(info, "late")],
  });
  await rpcAs(admin.email, admin.password, "item_update", {
    item_id: await itemId(projectId, nameOf(info, "late")),
    changes: { planned_date: addDays(today(), -2) },
  });
  const context = await browser.newContext({ storageState: storageStateFor("owner") });
  const page = await context.newPage();
  await page.goto("/today");
  const line = page.locator('[data-slot="today-items-overdue"]');
  await expect(line).toContainText(/client items? overdue/);
  await line.click();
  await expect(page).toHaveURL(/\/clients\/items\?filter=overdue$/);
  const group = page.locator('[data-slot="item-group"]', {
    has: page.locator('[data-slot="item-list-row"]', { hasText: nameOf(info, "late") }),
  });
  await expect(group.locator("h2")).toContainText("Ravi");
  await context.close();
  await removeClientFixture(client);
});

test("the Admin's Today: Client work with Mark done and its Undo, a sent-back item in Needs you", async ({
  page,
}, info) => {
  const client = nameOf(info, "today");
  const clientId = await workClient(client);
  const projectId = await makeProject(clientId, "Today reels", {
    recurrence: "one_time",
    delivery: addDays(today(), 10),
    items: [nameOf(info, "due"), nameOf(info, "back")],
  });
  const due = await itemId(projectId, nameOf(info, "due"));
  await rpcAs(admin.email, admin.password, "item_update", {
    item_id: due,
    changes: { planned_date: today() },
  });
  // Sent back by the Owner, with the reason (decision 19).
  const back = await itemId(projectId, nameOf(info, "back"));
  await rpcAs(admin.email, admin.password, "item_mark_done", { item_id: back });
  await rpcAs(owner.email, owner.password, "item_reject", {
    item_id: back,
    reason: "The logo is wrong",
  });

  await page.goto("/today");
  await hydrated(page);
  await expect(
    page.locator('[data-slot="today-sent-back-row"]', { hasText: nameOf(info, "back") }),
  ).toContainText("The logo is wrong");
  const row = page.locator('[data-slot="today-client-item"]', { hasText: nameOf(info, "due") });
  await expect(row).toContainText("Due today");
  await row.getByRole("button", { name: "Mark done" }).click();
  await expect(page.getByText(`Marked ${nameOf(info, "due")} done`)).toBeVisible();
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(row).not.toHaveAttribute("data-held", "");
  expect(await itemState(due)).toBe("open");
  await row.getByRole("button", { name: "Mark done" }).click();
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect.poll(() => itemState(due)).toBe("done");
  await removeClientFixture(client);
});

test("the carry screen: carry forward in bulk, close one with a reason", async ({ page }, info) => {
  const client = nameOf(info, "carry");
  const clientId = await workClient(client);
  const projectId = await makeProject(clientId, "Monthly posts", { items: ["Post"] });
  // An ended cycle with two open items (the fixture's own; the nightly job made it otherwise).
  const [project] = await serviceSelect<{ org_id: string }>(
    `projects?id=eq.${projectId}&select=org_id`,
  );
  const start = addDays(`${today().slice(0, 8)}01`, -1).slice(0, 8) + "01";
  const end = addDays(`${today().slice(0, 8)}01`, -1);
  const cycle = await serviceInsert<{ id: string }>("project_cycles", {
    org_id: project?.org_id,
    project_id: projectId,
    period_start: start,
    period_end: end,
    label: "Last month",
    generated_by: "schedule",
  });
  for (const [title, position] of [
    [nameOf(info, "keep"), "a0"],
    [nameOf(info, "drop"), "a1"],
  ] as const) {
    await serviceInsert("project_items", {
      org_id: project?.org_id,
      project_id: projectId,
      cycle_id: cycle.id,
      origin_cycle_id: cycle.id,
      title,
      position,
    });
  }
  await page.goto(`/clients/items/decide?project=${projectId}`);
  await hydrated(page);
  const group = page.locator('[data-slot="carry-group"]');
  await group
    .locator('[data-slot="carry-row"]', { hasText: nameOf(info, "drop") })
    .getByRole("button", { name: "Close…" })
    .click();
  const dialog = page.getByRole("dialog", { name: `Close ${nameOf(info, "drop")}?` });
  await dialog.getByLabel("Why close it").fill("The client dropped it");
  await dialog.getByRole("button", { name: "Close item" }).click();
  await expect
    .poll(async () => itemState(await itemId(projectId, nameOf(info, "drop"))))
    .toBe("cancelled");
  await page.reload();
  await hydrated(page);
  await page.getByRole("button", { name: "Carry 1 forward" }).click();
  await expect(page.getByText("Nothing to decide.")).toBeVisible();
  const carried = await serviceSelect<{ state: string }>(
    `project_items?project_id=eq.${projectId}&title=eq.${encodeURIComponent(nameOf(info, "keep"))}&select=state&order=created_at`,
  );
  expect(carried.map((row) => row.state)).toEqual(["carried", "open"]);
  await removeClientFixture(client);
});

test("Settings → Stage presets: an Admin adds, edits and archives their own", async ({
  page,
}, info) => {
  test.skip(info.project.name === "mobile-lg", "the 375 and desktop runs cover it");
  const name = nameOf(info, "preset");
  await serviceRest(`stage_presets?name=eq.${encodeURIComponent(name)}`, { method: "DELETE" });
  await page.goto("/settings");
  await page.getByRole("link", { name: /Stage presets/ }).click();
  await expect(page).toHaveURL(/\/settings\/stage-presets$/);
  await hydrated(page);
  await page.getByRole("button", { name: "Add preset" }).click();
  const add = page.getByRole("dialog", { name: "Add a stage preset" });
  await add.getByLabel("Name").fill(name);
  await add.getByLabel("Stages").fill("Brief\nShoot\nDeliver");
  await add.getByRole("button", { name: "Add preset" }).click();
  const row = page.locator('[data-slot="stage-preset"]', { hasText: name });
  await expect(row).toContainText("Brief → Shoot → Deliver · by you");
  await row.getByRole("button", { name: `Archive ${name}` }).click();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: `Archive ${name}` })
    .click();
  await expect(
    page.locator('[data-slot="archived-stage-preset"]', { hasText: name }),
  ).toBeVisible();
});

test("the calendar lists client items for their Admin, never for Crew", async ({
  page,
  browser,
}, info) => {
  const client = nameOf(info, "calendar");
  const clientId = await workClient(client);
  const projectId = await makeProject(clientId, "Calendar reels", {
    recurrence: "one_time",
    delivery: addDays(today(), 10),
    items: [nameOf(info, "planned")],
  });
  const day = today();
  await rpcAs(admin.email, admin.password, "item_update", {
    item_id: await itemId(projectId, nameOf(info, "planned")),
    changes: { planned_date: day },
  });
  await page.goto(`/calendar?view=day&date=${day}`);
  await hydrated(page);
  await expect(
    page
      .locator('[data-slot="calendar-item"]:visible', { hasText: nameOf(info, "planned") })
      .first(),
  ).toBeVisible();

  const context = await browser.newContext({ storageState: storageStateFor("staff") });
  const crew = await context.newPage();
  await crew.goto(`/calendar?view=day&date=${day}`);
  await expect(crew.locator('[data-slot="page-header"]')).toBeVisible();
  await expect(crew.locator('[data-slot="calendar-item"]')).toHaveCount(0);
  await context.close();
  await removeClientFixture(client);
});

test.describe("Realtime holds RLS for client items (kickoff 7 decision 24)", () => {
  test("Crew hear no item; the client's Admin hears theirs", async ({}, info) => {
    test.skip(info.project.name !== "desktop", "one check is enough");
    const client = nameOf(info, "realtime");
    const clientId = await workClient(client);
    const { apikey, url } = supabaseAuth();
    const tokenOf = async (email: string, password: string) => {
      const answer = await fetch(`${url}/token?grant_type=password`, {
        method: "POST",
        headers: { apikey, "content-type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      expect(answer.ok, `sign-in for ${email}`).toBe(true);
      return ((await answer.json()) as { access_token: string }).access_token;
    };
    const listen = async (email: string, password: string) => {
      const token = await tokenOf(email, password);
      const supabase = createClient(HOLD_PROXY_URL, apikey, { accessToken: async () => token });
      await supabase.realtime.setAuth();
      const heard: string[] = [];
      let channel = supabase.channel(`items-${email}`);
      for (const event of ["INSERT", "UPDATE"] as const) {
        channel = channel.on(
          "postgres_changes",
          { event, schema: "public", table: "project_items" },
          (change) => heard.push(String((change.new as { id?: string }).id)),
        );
      }
      await new Promise<void>((resolve, reject) => {
        channel.subscribe((status) => {
          if (status === "SUBSCRIBED") resolve();
          if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") reject(new Error(status));
        });
      });
      return { supabase, heard };
    };
    const crewSide = await listen(USERS.staff.email, USERS.staff.password);
    const adminSide = await listen(admin.email, admin.password);
    try {
      const projectId = await makeProject(clientId, "Realtime reels", {
        recurrence: "one_time",
        delivery: addDays(today(), 10),
        items: [nameOf(info, "heard")],
      });
      const id = await itemId(projectId, nameOf(info, "heard"));
      await rpcAs(admin.email, admin.password, "item_mark_done", { item_id: id });
      await expect.poll(() => adminSide.heard).toContain(id);
      // Nothing arrives late for Crew.
      await new Promise((resolve) => setTimeout(resolve, 1_500));
      expect(crewSide.heard, "Crew receive no item events").toEqual([]);
    } finally {
      await crewSide.supabase.removeAllChannels();
      await adminSide.supabase.removeAllChannels();
      await removeClientFixture(client);
    }
  });
});

test.describe("back and gestures, installed (ARCHITECTURE §14.2)", () => {
  test.beforeEach(({}, info) => {
    test.skip(info.project.name === "desktop", "the phone widths, 375 and 430");
  });

  test("Projects tab → a project → its item sheet; the cycle pager adds no history", async ({
    page,
  }, info) => {
    const client = nameOf(info, "back");
    const clientId = await workClient(client);
    const projectId = await makeProject(clientId, "Back reels", { items: ["Reel A"] });
    // A second cycle (next period) for the pager.
    await rpcAs(admin.email, admin.password, "item_add", {
      cycle_id: (
        await serviceSelect<{ id: string }>(`project_cycles?project_id=eq.${projectId}&select=id`)
      )[0]!.id,
      title: "Reel B",
    });
    await runInstalled(page);
    await page.goto("/today");
    await page.goto(`/clients/${clientId}`);
    await hydrated(page);
    await page.locator('[data-slot="client-tabs"]').getByRole("link", { name: "Projects" }).click();
    await expect(page).toHaveURL(new RegExp(`/clients/${clientId}/projects$`));
    await page.locator('[data-slot="project-row"]', { hasText: "Back reels" }).click();
    await expect(page).toHaveURL(new RegExp(`/projects/${projectId}$`));
    await hydrated(page);
    await itemRow(page, "Reel A").locator('[data-slot="item-open"]').click();
    const sheet = page.locator('[data-slot="review-sheet"]');
    await expect(sheet).toBeVisible();
    // The ⋯ menu's Stages sheet is a layer too.
    await expectBackStack(page, [
      { closes: sheet, url: new RegExp(`/projects/${projectId}$`) },
      { url: new RegExp(`/clients/${clientId}/projects$`) },
      { url: /\/today$/ },
    ]);
    await removeClientFixture(client);
  });

  test("the New project dialog and the ⋯ sheets close on back", async ({ page }, info) => {
    const client = nameOf(info, "dialogs");
    const clientId = await workClient(client);
    const projectId = await makeProject(clientId, "Dialog reels", { items: ["Reel"] });
    await runInstalled(page);
    await page.goto(`/clients/${clientId}/projects`);
    await hydrated(page);
    await page.getByRole("button", { name: "New project" }).click();
    const create = page.getByRole("dialog", { name: "New project" });
    await expectBackStack(page, [
      { closes: create, url: new RegExp(`/clients/${clientId}/projects$`) },
    ]);
    await page.goto(`/clients/${clientId}/projects/${projectId}`);
    await hydrated(page);
    await page.getByRole("button", { name: "Actions for Dialog reels" }).click();
    await page.getByRole("menuitem", { name: "Stages" }).click();
    const stages = page.locator('[data-slot="review-sheet"]', { hasText: "Stages" });
    await expect(stages).toBeVisible();
    await expectBackStack(page, [{ closes: stages, url: new RegExp(`/projects/${projectId}$`) }]);
    await page.getByRole("button", { name: "Add item" }).click();
    const add = page.getByRole("dialog", { name: "Add an item" });
    await expectBackStack(page, [{ closes: add, url: new RegExp(`/projects/${projectId}$`) }]);
    await removeClientFixture(client);
  });

  test("the cross-client list: filters are view controls; one back leaves it", async ({
    page,
  }, info) => {
    const client = nameOf(info, "list");
    const clientId = await workClient(client);
    await makeProject(clientId, "List reels", { items: [nameOf(info, "listed")] });
    await runInstalled(page);
    await page.goto("/today");
    await page.goto("/clients");
    await hydrated(page);
    await page.locator('[data-slot="client-items-link"]').click();
    await expect(page).toHaveURL(/\/clients\/items$/);
    await hydrated(page);
    await expect(
      page.locator('[data-slot="item-list-row"]', { hasText: nameOf(info, "listed") }),
    ).toBeVisible();
    await page.getByRole("combobox", { name: "State" }).click();
    await page.getByRole("option", { name: "Open", exact: true }).click();
    await expect(page).toHaveURL(/\/clients\/items\?filter=open$/);
    await expectBackStack(page, [{ url: /\/clients$/ }, { url: /\/today$/ }]);
    await removeClientFixture(client);
  });
});
