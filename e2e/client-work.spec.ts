import { createClient } from "@supabase/supabase-js";
import type { Locator, Page, TestInfo } from "@playwright/test";

import { expect, test } from "./fixtures";
import { HOLD_PROXY_URL } from "./hold-proxy-config";
import {
  expectBackStack,
  expectNoHorizontalScroll,
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

/** Sends what waits for its Undo now: the app going to the background flushes it (as Approvals). */
async function flushSends(page: Page): Promise<void> {
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
  });
}

/**
 * §14.2 f on a form layer with a change typed: back asks first (the layer gives way to the
 * confirmation, the address stays), back on the confirmation keeps editing with the draft intact,
 * and the confirmation's named red button discards it.
 */
async function expectDiscardOnBack(
  page: Page,
  layer: Locator,
  confirmTitle: string,
  discardLabel: string,
  field: Locator,
  value: string,
  url: RegExp,
): Promise<void> {
  const confirm = page.getByRole("alertdialog", { name: confirmTitle });
  await page.goBack();
  await expect(confirm, "back asks before losing typed work").toBeVisible();
  await expect(layer).toBeHidden();
  await expect(page).toHaveURL(url);
  await page.goBack();
  await expect(confirm, "back on the confirmation keeps editing").toBeHidden();
  await expect(layer).toBeVisible();
  await expect(field, "the draft is kept").toHaveValue(value);
  await expect(page).toHaveURL(url);
  await page.goBack();
  await confirm.getByRole("button", { name: discardLabel }).click();
  await expect(confirm).toBeHidden();
  await expect(layer).toBeHidden();
  await expect(page).toHaveURL(url);
}

/** A cycle of last month for a project: the pager's previous one, or an ended cycle to decide. */
async function lastMonthCycle(projectId: string): Promise<string> {
  const [project] = await serviceSelect<{ org_id: string }>(
    `projects?id=eq.${projectId}&select=org_id`,
  );
  const end = addDays(`${today().slice(0, 8)}01`, -1);
  const cycle = await serviceInsert<{ id: string }>("project_cycles", {
    org_id: project?.org_id,
    project_id: projectId,
    period_start: `${end.slice(0, 8)}01`,
    period_end: end,
    label: "Last month",
    generated_by: "schedule",
  });
  return cycle.id;
}

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
  const row = page.locator('[data-slot="approval-row"]', { hasText: nameOf(info, "cut") });
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: "Approve" }).click();
  await expect(page.getByText(`Approved ${nameOf(info, "cut")}`)).toBeVisible();
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect.poll(() => itemState(id)).toBe("approved");

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
  await expect(ownerPage.locator('[data-slot="page-header"]').first()).toBeVisible();
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
  const [named] = await serviceSelect<{ full_name: string }>(
    `members?email=eq.${encodeURIComponent(admin.email)}&select=full_name`,
  );
  await expect(group.locator("h2")).toContainText(named?.full_name ?? "admin");
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
  await row.getByRole("button", { name: `Edit ${name}` }).click();
  const edit = page.getByRole("dialog", { name: `Edit ${name}` });
  await edit.getByLabel("Stages").fill("Brief\nShoot\nEdit\nDeliver");
  await edit.getByRole("button", { name: "Save preset" }).click();
  await expect(row).toContainText("Brief → Shoot → Edit → Deliver · by you");
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
  await expect(crew.locator('[data-slot="page-header"]').first()).toBeVisible();
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
    const [current] = await serviceSelect<{ id: string; label: string }>(
      `project_cycles?project_id=eq.${projectId}&select=id,label`,
    );
    // Last month's cycle: the pager's previous one.
    const previous = await lastMonthCycle(projectId);
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
    await page.goBack();
    await expect(sheet).toBeHidden();
    await expect(page).toHaveURL(new RegExp(`/projects/${projectId}$`));

    // The pager is a view control: Previous, then Next, change `?cycle=` and add no history.
    await page.getByRole("link", { name: "Previous: Last month" }).click();
    await expect(page).toHaveURL(new RegExp(`/projects/${projectId}\\?cycle=${previous}$`));
    await expect(page.locator('[data-slot="cycle-label"]')).toHaveText("Last month");
    await page.getByRole("link", { name: `Next: ${current!.label}` }).click();
    await expect(page).toHaveURL(new RegExp(`/projects/${projectId}\\?cycle=${current!.id}$`));
    await expect(page.locator('[data-slot="cycle-label"]')).toHaveText(current!.label);
    await expectBackStack(page, [
      { url: new RegExp(`/clients/${clientId}/projects$`) },
      { url: /\/today$/ },
    ]);
    await removeClientFixture(client);
  });

  test("the Projects tab, a project and its item sheet fit at 130% and 200% text", async ({
    page,
  }, info) => {
    const client = nameOf(info, "large text");
    const clientId = await workClient(client);
    const projectId = await makeProject(clientId, "A long project name for large text", {
      items: ["An item with a rather long title to wrap"],
      stages: ["Script", "Shoot", "Edit", "Posted"],
    });
    for (const path of [
      `/clients/${clientId}/projects`,
      `/clients/${clientId}/projects/${projectId}`,
    ]) {
      await page.goto(path);
      await hydrated(page);
      for (const scale of [130, 200]) {
        await page.evaluate((percent) => {
          document.documentElement.style.fontSize = `${percent}%`;
        }, scale);
        await expectNoHorizontalScroll(page);
      }
      await page.evaluate(() => {
        document.documentElement.style.fontSize = "";
      });
    }
    await itemRow(page, "An item with a rather long title")
      .locator('[data-slot="item-open"]')
      .click();
    await expect(page.locator('[data-slot="review-sheet"]')).toBeVisible();
    await page.evaluate(() => {
      document.documentElement.style.fontSize = "200%";
    });
    await expectNoHorizontalScroll(page);
    await removeClientFixture(client);
  });

  test("New project, ⋯ Edit details, Item list, Add item and the item's Edit: back asks before losing typed work", async ({
    page,
  }, info) => {
    const client = nameOf(info, "dialogs");
    const clientId = await workClient(client);
    const projectId = await makeProject(clientId, "Dialog reels", {
      items: ["Reel"],
      stages: ["Script"],
    });
    const tab = new RegExp(`/clients/${clientId}/projects$`);
    const here = new RegExp(`/projects/${projectId}$`);
    await runInstalled(page);
    await page.goto(`/clients/${clientId}/projects`);
    await hydrated(page);

    // New project: nothing typed, one back closes it; typed, back asks "Discard this project?".
    await page.getByRole("button", { name: "New project" }).click();
    const create = page.getByRole("dialog", { name: "New project" });
    await expect(create).toBeVisible();
    await expectBackStack(page, [{ closes: create, url: tab }]);
    await page.getByRole("button", { name: "New project" }).click();
    await create.getByLabel("Project name").fill("Half-typed");
    await expectDiscardOnBack(
      page,
      create,
      "Discard this project?",
      "Discard project",
      create.getByLabel("Project name"),
      "Half-typed",
      tab,
    );

    await page.goto(`/clients/${clientId}/projects/${projectId}`);
    await hydrated(page);
    const menu = page.getByRole("button", { name: "Actions for Dialog reels" });

    // ⋯ Edit details.
    await menu.click();
    await page.getByRole("menuitem", { name: "Edit details" }).click();
    const edit = page.getByRole("dialog", { name: "Edit details" });
    await expect(edit).toBeVisible();
    await expectBackStack(page, [{ closes: edit, url: here }]);
    await menu.click();
    await page.getByRole("menuitem", { name: "Edit details" }).click();
    await edit.getByLabel("Project name").fill("Dialog reels, renamed");
    await expectDiscardOnBack(
      page,
      edit,
      "Discard your changes?",
      "Discard changes",
      edit.getByLabel("Project name"),
      "Dialog reels, renamed",
      here,
    );

    // ⋯ Stages and Item list: sheets; a name typed and not added asks first.
    await menu.click();
    await page.getByRole("menuitem", { name: "Stages" }).click();
    const stages = page.locator('[data-slot="review-sheet"]', { hasText: "Stages" });
    await expect(stages).toBeVisible();
    await expectBackStack(page, [{ closes: stages, url: here }]);
    await menu.click();
    await page.getByRole("menuitem", { name: "Item list" }).click();
    const list = page.locator('[data-slot="review-sheet"]', { hasText: "Item list" });
    await expect(list).toBeVisible();
    await expectBackStack(page, [{ closes: list, url: here }]);
    await menu.click();
    await page.getByRole("menuitem", { name: "Item list" }).click();
    await list.getByLabel("New item").fill("Reel 2");
    await expectDiscardOnBack(
      page,
      list,
      "Discard what you typed?",
      "Discard changes",
      list.getByLabel("New item"),
      "Reel 2",
      here,
    );

    // Add item.
    await page.getByRole("button", { name: "Add item" }).click();
    const add = page.getByRole("dialog", { name: "Add an item" });
    await expect(add).toBeVisible();
    await expectBackStack(page, [{ closes: add, url: here }]);
    await page.getByRole("button", { name: "Add item" }).click();
    await add.getByLabel("Title").fill("Extra reel");
    await expectDiscardOnBack(
      page,
      add,
      "Discard this item?",
      "Discard item",
      add.getByLabel("Title"),
      "Extra reel",
      here,
    );

    // The item sheet's Edit: back asks, then keeps editing; Discard closes the sheet.
    await itemRow(page, "Reel").locator('[data-slot="item-open"]').click();
    const sheet = page.locator('[data-slot="review-sheet"]');
    await sheet.getByRole("button", { name: "Edit" }).click();
    await sheet.getByLabel("Title").fill("Reel, retitled");
    await expectDiscardOnBack(
      page,
      sheet,
      "Discard your changes?",
      "Discard changes",
      sheet.getByLabel("Title"),
      "Reel, retitled",
      here,
    );
    expect(
      (
        await serviceSelect<{ title: string }>(
          `project_items?project_id=eq.${projectId}&select=title`,
        )
      ).map((row) => row.title),
    ).toEqual(["Reel"]);
    await removeClientFixture(client);
  });

  test("⋯ Complete, Cancel, Reopen and the bulk Tick a stage menu close on back", async ({
    page,
  }, info) => {
    const client = nameOf(info, "lifecycle back");
    const clientId = await workClient(client);
    const projectId = await makeProject(clientId, "Layer reels", {
      items: ["Reel 1", "Reel 2"],
      stages: ["Script", "Edit"],
    });
    const here = new RegExp(`/projects/${projectId}$`);
    await runInstalled(page);
    await page.goto(`/clients/${clientId}/projects/${projectId}`);
    await hydrated(page);
    const menu = page.getByRole("button", { name: "Actions for Layer reels" });
    for (const [entry, layer] of [
      ["Complete project", page.getByRole("alertdialog", { name: "Complete Layer reels?" })],
      ["Cancel project…", page.getByRole("dialog", { name: "Cancel Layer reels?" })],
    ] as const) {
      await menu.click();
      await page.getByRole("menuitem", { name: entry }).click();
      await expect(layer).toBeVisible();
      await expectBackStack(page, [{ closes: layer, url: here }]);
    }
    // The bulk Tick a stage menu is a layer too.
    await itemRow(page, "Reel 1").getByRole("checkbox").click();
    await page.getByRole("button", { name: "Tick a stage on 1" }).click();
    const tickMenu = page.getByRole("menu");
    await expect(tickMenu).toBeVisible();
    await expectBackStack(page, [{ closes: tickMenu, url: here }]);

    // Reopen, on a cancelled project.
    await rpcAs(admin.email, admin.password, "project_cancel", {
      project_id: projectId,
      reason: "Fixture",
    });
    await page.reload();
    await hydrated(page);
    await menu.click();
    await page.getByRole("menuitem", { name: "Reopen project…" }).click();
    const reopen = page.getByRole("dialog", { name: "Reopen Layer reels?" });
    await expect(reopen).toBeVisible();
    await expectBackStack(page, [{ closes: reopen, url: here }]);
    await removeClientFixture(client);
  });

  test("Approvals' Client items Review sheet and its Send back, Today's item sheet, the carry screen's Close…", async ({
    page,
  }, info) => {
    const client = nameOf(info, "approval back");
    const clientId = await workClient(client);
    const projectId = await makeProject(clientId, "Sheet film", {
      recurrence: "one_time",
      delivery: addDays(today(), 10),
      items: [nameOf(info, "to approve"), nameOf(info, "due")],
    });
    await rpcAs(admin.email, admin.password, "item_mark_done", {
      item_id: await itemId(projectId, nameOf(info, "to approve")),
    });
    await rpcAs(admin.email, admin.password, "item_update", {
      item_id: await itemId(projectId, nameOf(info, "due")),
      changes: { planned_date: today() },
    });
    await runInstalled(page);
    await page.goto("/today");
    await hydrated(page);

    // Today's Client work: a row opens the item sheet; back closes it.
    await page
      .locator('[data-slot="today-client-item"]', { hasText: nameOf(info, "due") })
      .getByRole("button")
      .first()
      .click();
    const sheet = page.locator('[data-slot="review-sheet"]');
    await expect(sheet).toBeVisible();
    await expectBackStack(page, [{ closes: sheet, url: /\/today$/ }]);

    // Approvals → Client items → Review → Send back…: one layer per back.
    await page.goto("/approvals");
    await hydrated(page);
    await page
      .locator('[data-slot="approval-row"]', { hasText: nameOf(info, "to approve") })
      .getByRole("button", { name: "Review" })
      .click();
    await expect(sheet).toBeVisible();
    await sheet.getByRole("button", { name: "Send back…" }).click();
    const sendBack = page.getByRole("dialog", {
      name: `Send back ${nameOf(info, "to approve")}?`,
    });
    await expect(sendBack).toBeVisible();
    await expectBackStack(page, [
      { closes: sendBack, url: /\/approvals$/ },
      { closes: sheet, url: /\/approvals$/ },
    ]);

    // The carry screen's Close… dialog: last month's cycle of a monthly project, one item left.
    const monthly = await makeProject(clientId, "Carry posts", { items: ["Post"] });
    const ended = await lastMonthCycle(monthly);
    const [project] = await serviceSelect<{ org_id: string }>(
      `projects?id=eq.${monthly}&select=org_id`,
    );
    await serviceInsert("project_items", {
      org_id: project?.org_id,
      project_id: monthly,
      cycle_id: ended,
      origin_cycle_id: ended,
      title: nameOf(info, "left"),
      position: "a0",
    });
    await page.goto(`/clients/items/decide?project=${monthly}`);
    await hydrated(page);
    await page
      .locator('[data-slot="carry-row"]', { hasText: nameOf(info, "left") })
      .getByRole("button", { name: "Close…" })
      .click();
    const close = page.getByRole("dialog", { name: `Close ${nameOf(info, "left")}?` });
    await expect(close).toBeVisible();
    await expectBackStack(page, [
      { closes: close, url: new RegExp(`/clients/items/decide\\?project=${monthly}$`) },
    ]);
    await removeClientFixture(client);
  });

  test("the Admin's New client dialog closes on back", async ({ page }) => {
    await runInstalled(page);
    await page.goto("/clients");
    await hydrated(page);
    await page.getByRole("button", { name: "New client" }).click();
    const dialog = page.getByRole("dialog", { name: "New client" });
    await expect(dialog).toBeVisible();
    await expectBackStack(page, [{ closes: dialog, url: /\/clients$/ }]);
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

test.describe("approving on the project page, as the Owner (the 7B review's S1)", () => {
  test.use({ storageState: storageStateFor("owner") });

  test("a row's Approve and the sheet's have the 6-second Undo; Approve N asks first", async ({
    page,
  }, info) => {
    test.skip(info.project.name === "mobile-lg", "the 375 and desktop runs cover the flow");
    const client = nameOf(info, "owner approves");
    const clientId = await workClient(client);
    const titles = ["Reel 1", "Reel 2", "Reel 3", "Reel 4"];
    const projectId = await makeProject(clientId, "Approve reels", { items: titles });
    for (const title of titles) {
      await rpcAs(admin.email, admin.password, "item_mark_done", {
        item_id: await itemId(projectId, title),
      });
    }
    await page.goto(`/clients/${clientId}/projects/${projectId}`);
    await hydrated(page);
    await expect(progress(page)).toHaveText("4/4 done · 0/4 approved");

    // The row's Approve: held with an Undo; Undo sends nothing.
    const first = await itemId(projectId, "Reel 1");
    await itemRow(page, "Reel 1").getByRole("button", { name: "Approve", exact: true }).click();
    await expect(itemRow(page, "Reel 1")).toHaveAttribute("data-held", "");
    await expect(page.getByText("Approved Reel 1")).toBeVisible();
    await page.getByRole("button", { name: "Undo" }).click();
    await expect(itemRow(page, "Reel 1")).not.toHaveAttribute("data-held", "");
    expect(await itemState(first)).toBe("done");
    // Kept: sent when the Undo window ends, or at once when the app goes to the background.
    await itemRow(page, "Reel 1").getByRole("button", { name: "Approve", exact: true }).click();
    await flushSends(page);
    await expect.poll(() => itemState(first)).toBe("approved");
    await expect(progress(page)).toHaveText("4/4 done · 1/4 approved");

    // The sheet's Approve: the sheet closes, the Undo is offered, then it is sent.
    await itemRow(page, "Reel 2").locator('[data-slot="item-open"]').click();
    const sheet = page.locator('[data-slot="review-sheet"]');
    await sheet.getByRole("button", { name: "Approve", exact: true }).click();
    await expect(sheet).toBeHidden();
    await expect(page.getByText("Approved Reel 2")).toBeVisible();
    await flushSends(page);
    const second = await itemId(projectId, "Reel 2");
    await expect.poll(() => itemState(second)).toBe("approved");

    // Approve N: a trigger; the confirmation's red button names it.
    await itemRow(page, "Reel 3").getByRole("checkbox").click();
    await itemRow(page, "Reel 4").getByRole("checkbox").click();
    await page.getByRole("button", { name: "Approve 2", exact: true }).click();
    const confirm = page.getByRole("alertdialog", { name: "Approve 2 items?" });
    await expect(confirm).toBeVisible();
    await confirm.getByRole("button", { name: "Approve 2 items" }).click();
    await expect(confirm).toBeHidden();
    await expect(progress(page)).toHaveText("4/4 done · 4/4 approved");
    await removeClientFixture(client);
  });
});

test("⋯ Complete (refused while items are left), Reopen, Cancel, and Reopen refused on a closed client", async ({
  page,
}, info) => {
  test.skip(info.project.name === "mobile-lg", "the 375 and desktop runs cover the flow");
  const client = nameOf(info, "lifecycle");
  const clientId = await workClient(client);
  const projectId = await makeProject(clientId, "Brand film", {
    recurrence: "one_time",
    delivery: addDays(today(), 10),
    items: ["Final cut"],
  });
  await page.goto(`/clients/${clientId}/projects/${projectId}`);
  await hydrated(page);
  const menu = page.getByRole("button", { name: "Actions for Brand film" });

  // Complete is refused while an item is open or done: the dialog says what is left.
  await menu.click();
  await page.getByRole("menuitem", { name: "Complete project" }).click();
  const complete = page.getByRole("alertdialog", { name: "Complete Brand film?" });
  await expect(complete).toContainText("1 item is still open or done");
  await expect(complete.getByRole("button", { name: "Complete project" })).toBeDisabled();
  await complete.getByRole("button", { name: "Cancel" }).click();

  const item = await itemId(projectId, "Final cut");
  await rpcAs(admin.email, admin.password, "item_mark_done", { item_id: item });
  await rpcAs(owner.email, owner.password, "item_approve", { item_ids: [item] });
  await page.reload();
  await hydrated(page);
  await menu.click();
  await page.getByRole("menuitem", { name: "Complete project" }).click();
  await complete.getByRole("button", { name: "Complete project" }).click();
  await expect(page.locator('[data-slot="project-read-only"]')).toContainText("Completed");

  // Reopen with a reason.
  await menu.click();
  await page.getByRole("menuitem", { name: "Reopen project…" }).click();
  const reopen = page.getByRole("dialog", { name: "Reopen Brand film?" });
  await reopen.getByLabel("Why reopen it").fill("One more version");
  await reopen.getByRole("button", { name: "Reopen project" }).click();
  await expect(page.locator('[data-slot="project-read-only"]')).toHaveCount(0);

  // Cancel with a reason.
  await menu.click();
  await page.getByRole("menuitem", { name: "Cancel project…" }).click();
  const cancel = page.getByRole("dialog", { name: "Cancel Brand film?" });
  await cancel.getByLabel("Why cancel it").fill("The client stopped the film");
  await cancel.getByRole("button", { name: "Cancel project" }).click();
  await expect(page.locator('[data-slot="project-read-only"]')).toContainText("Cancelled");

  // Q6: a closed client's project is not reopened; the refusal says why.
  await rpcAs(owner.email, owner.password, "client_close", { client_id: clientId });
  await page.reload();
  await hydrated(page);
  await menu.click();
  await page.getByRole("menuitem", { name: "Reopen project…" }).click();
  await reopen.getByLabel("Why reopen it").fill("Back on");
  await reopen.getByRole("button", { name: "Reopen project" }).click();
  await expect(page.getByText(`${client} is closed. Reactivate the client first.`)).toBeVisible();
  await removeClientFixture(client);
});

test("⋯ Start ‹next week› starts the next cycle early", async ({ page }, info) => {
  test.skip(info.project.name === "mobile-lg", "the 375 and desktop runs cover the flow");
  const client = nameOf(info, "next cycle");
  const clientId = await workClient(client);
  const projectId = await makeProject(clientId, "Weekly posts", {
    recurrence: "weekly",
    items: ["Post"],
  });
  await page.goto(`/clients/${clientId}/projects/${projectId}`);
  await hydrated(page);
  await page.getByRole("button", { name: "Actions for Weekly posts" }).click();
  const start = page.getByRole("menuitem", { name: /^Start / });
  const label = ((await start.textContent()) ?? "").replace(/^Start /, "");
  await start.click();
  const confirm = page.getByRole("alertdialog", { name: `Start ${label} now?` });
  await confirm.getByRole("button", { name: `Start ${label}` }).click();
  await expect(page.getByText(`${label} started`)).toBeVisible();
  await expect(page.getByRole("link", { name: `Next: ${label}` })).toBeVisible();
  const cycles = await serviceSelect<{ id: string }>(
    `project_cycles?project_id=eq.${projectId}&select=id`,
  );
  expect(cycles).toHaveLength(2);
  await removeClientFixture(client);
});

test("a project template from Settings → Templates starts a New project", async ({
  page,
}, info) => {
  test.skip(info.project.name === "mobile-lg", "the 375 and desktop runs cover the flow");
  const name = nameOf(info, "template");
  await serviceRest(`project_templates?name=eq.${encodeURIComponent(name)}`, {
    method: "DELETE",
  });
  const client = nameOf(info, "from template");
  const clientId = await workClient(client);
  await page.goto("/settings/templates");
  await hydrated(page);
  await page.getByRole("button", { name: "Add a project template" }).click();
  const dialog = page.getByRole("dialog", { name: "Add a project template" });
  await dialog.getByLabel("Name").fill(name);
  await dialog.getByLabel("Stages", { exact: true }).fill("Script\nEdit");
  await dialog.getByLabel("Item list").fill("Reel 1\nReel 2");
  await dialog.getByRole("button", { name: "Add template" }).click();
  await expect(page.locator('[data-slot="project-template"]', { hasText: name })).toBeVisible();

  await page.goto(`/clients/${clientId}/projects`);
  await hydrated(page);
  await page.getByRole("button", { name: "New project" }).click();
  const create = page.getByRole("dialog", { name: "New project" });
  await create.getByRole("combobox", { name: "Start from" }).click();
  await page.getByRole("option", { name }).click();
  await expect(create.getByLabel("Item list")).toHaveValue("Reel 1\nReel 2");
  await expect(create.getByLabel("Stages, one per line")).toHaveValue("Script\nEdit");
  await create.getByLabel("Project name").fill("From the template");
  await create.getByRole("button", { name: "Create project" }).click();
  await expect(page).toHaveURL(new RegExp(`/clients/${clientId}/projects/[0-9a-f-]{36}$`));
  await expect(progress(page)).toHaveText("0/2 done · 0/2 approved");
  await removeClientFixture(client);
  await serviceRest(`project_templates?name=eq.${encodeURIComponent(name)}`, {
    method: "DELETE",
  });
});

test.describe("Settings layers, installed (ARCHITECTURE §14.2)", () => {
  test.beforeEach(({}, info) => {
    test.skip(info.project.name === "desktop", "the phone widths, 375 and 430");
  });

  test("stage presets: add, edit and the archive confirm close on back", async ({ page }, info) => {
    const name = nameOf(info, "back preset");
    await serviceRest(`stage_presets?name=eq.${encodeURIComponent(name)}`, { method: "DELETE" });
    const [org] = await serviceSelect<{ id: string }>("organizations?select=id&limit=1");
    await serviceInsert("stage_presets", {
      org_id: org?.id,
      name,
      stages: ["Brief", "Shoot"],
      created_by: await memberIdOf(admin.email),
    });
    await runInstalled(page);
    await page.goto("/settings/stage-presets");
    await hydrated(page);
    const here = /\/settings\/stage-presets$/;
    await page.getByRole("button", { name: "Add preset" }).click();
    const add = page.getByRole("dialog", { name: "Add a stage preset" });
    await expect(add).toBeVisible();
    await expectBackStack(page, [{ closes: add, url: here }]);
    const row = page.locator('[data-slot="stage-preset"]', { hasText: name });
    await row.getByRole("button", { name: `Edit ${name}` }).click();
    const edit = page.getByRole("dialog", { name: `Edit ${name}` });
    await expect(edit).toBeVisible();
    await expectBackStack(page, [{ closes: edit, url: here }]);
    await row.getByRole("button", { name: `Archive ${name}` }).click();
    const archive = page.getByRole("alertdialog");
    await expect(archive).toBeVisible();
    await expectBackStack(page, [{ closes: archive, url: here }]);
    await serviceRest(`stage_presets?name=eq.${encodeURIComponent(name)}`, { method: "DELETE" });
  });

  test("the project template dialog closes on back, and asks before losing typed work", async ({
    page,
  }) => {
    await runInstalled(page);
    await page.goto("/settings/templates");
    await hydrated(page);
    const here = /\/settings\/templates$/;
    await page.getByRole("button", { name: "Add a project template" }).click();
    const dialog = page.getByRole("dialog", { name: "Add a project template" });
    await expect(dialog).toBeVisible();
    await expectBackStack(page, [{ closes: dialog, url: here }]);
    await page.getByRole("button", { name: "Add a project template" }).click();
    await dialog.getByLabel("Name").fill("Half a template");
    await expectDiscardOnBack(
      page,
      dialog,
      "Discard this template?",
      "Discard template",
      dialog.getByLabel("Name"),
      "Half a template",
      here,
    );
  });
});
