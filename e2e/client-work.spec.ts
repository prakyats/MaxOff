import { createClient } from "@supabase/supabase-js";
import type { Locator, Page, TestInfo } from "@playwright/test";

import { expect, test } from "./fixtures";
import { HOLD_PROXY_URL } from "./hold-proxy-config";
import {
  expectBackStack,
  expectNoHorizontalScroll,
  expectSheetAboveKeyboard,
  hydrated,
  memberIdOf,
  removeClientFixture,
  rpcAs,
  runInstalled,
  serviceInsert,
  serviceRest,
  serviceSelect,
  signIn,
  storageStateFor,
  supabaseAuth,
  USERS,
} from "./helpers";
import { istDate, wallClock } from "./run-state";

/**
 * Client work (phase 7, unit 7B: tasks 7.3 and 7.4; PRODUCT §4.5, §4.7, §4.8, §4.16; WORKFLOWS §5;
 * kickoff 7 decisions 16–26, amendments A–D, issue #56 Q1): an Admin's own new client (amendment
 * B), the Projects tab and New project, the project page (Mark done with its Undo, which approves
 * at once (D3), an item's own stages and its "Edit stages" (D2), the bulk "Mark N done" and "Tick
 * ‹stage› on N", the Admin's Reopen and the Owner's Send back, the progress line), no client items
 * in anyone's Approvals, the Activity panel (pages, chips) and an item's History, the cross-client
 * list and the Owner's Today count grouped by Admin, the carry screen, Settings → Stage presets,
 * the calendar's client items (never Crew's), Realtime holding RLS for items, and the back order of
 * every new screen and overlay installed at 375 and 430 px (ARCHITECTURE §14.2).
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

/**
 * This project's own Admin (`supabase/seed.sql`), for a flow that must not be re-read under its
 * hands: the seeded Admin is told of every parallel test's sent-back items, and each notification
 * re-reads whatever screen that Admin has open (the live bell, 5.1).
 */
const ownAdmin = (info: TestInfo) => ({
  email: `cw-admin-${info.project.name}@maxoff.local`,
  password: "cw-local-password",
});

/** An Active client run by the seeded Admin (or by `adminEmail`). */
async function workClient(name: string, adminEmail: string = admin.email): Promise<string> {
  await removeClientFixture(name);
  const [org] = await serviceSelect<{ id: string }>("organizations?select=id&limit=1");
  const row = await serviceInsert<{ id: string }>("clients", {
    org_id: org?.id,
    name,
    admin_id: await memberIdOf(adminEmail),
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

/** The client's newest project (a test's own). */
async function projectOf(clientId: string): Promise<string> {
  const [row] = await serviceSelect<{ id: string }>(
    `projects?client_id=eq.${clientId}&select=id&order=created_at.desc&limit=1`,
  );
  return row?.id ?? "";
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

test("a project from the Projects tab: per-item stages, Mark done with Undo, Mark N done, Reopen", async ({
  page,
}, info) => {
  const client = nameOf(info, "projects");
  const own = ownAdmin(info);
  const clientId = await workClient(client, own.email);
  // This project's own Admin: no other test's notification re-reads the page mid-flow.
  await page.context().clearCookies();
  await signIn(page, own.email, own.password);
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
  // Amendment D3: one figure, done (= approved).
  await expect(progress(page)).toHaveText("0/3 done");

  // One row's Mark done: instant with the 6-second Undo, then it counts.
  await itemRow(page, "Reel 1").getByRole("button", { name: "Mark done" }).click();
  await expect(page.getByText("Marked Reel 1 done")).toBeVisible();
  await expect(itemRow(page, "Reel 1")).toHaveAttribute("data-held", "");
  await flushSends(page);
  await expect(progress(page)).toHaveText("1/3 done");

  // The item sheet: its own stages (the defaults to start), a tick, and a stage of its own (D2).
  const sheet = page.locator('[data-slot="review-sheet"]').filter({ hasText: "Reel 2" });
  await itemRow(page, "Reel 2").locator('[data-slot="item-open"]').click();
  const script = sheet.getByRole("checkbox", { name: "Script" });
  await expect(script).toHaveAttribute("aria-checked", "false");
  await script.click();
  await expect(script).toHaveAttribute("aria-checked", "true");
  await expect(sheet.locator('[data-slot="item-last-change"]')).toContainText(
    "Last change: ticked Script on Reel 2 by",
  );
  await sheet.getByRole("button", { name: "Edit stages" }).click();
  const stages = page.getByRole("dialog", { name: "Stages of Reel 2" });
  await stages.getByLabel("New stage").fill("Colour");
  await stages.getByRole("button", { name: "Add", exact: true }).click();
  await expect(stages.getByLabel("Name of Colour")).toBeVisible();
  await page.goBack();
  await expect(stages).toBeHidden();
  await expect(sheet.getByRole("checkbox", { name: "Colour" })).toBeVisible();
  await page.goBack();
  await expect(sheet).toBeHidden();
  // Only that item has it.
  await itemRow(page, "Reel 3").locator('[data-slot="item-open"]').click();
  const third = page.locator('[data-slot="review-sheet"]').filter({ hasText: "Reel 3" });
  await expect(third.getByRole("checkbox", { name: "Edit" })).toBeVisible();
  await expect(third.getByRole("checkbox", { name: "Colour" })).toHaveCount(0);
  await page.goBack();
  await expect(third).toBeHidden();

  // Bulk: select two; "Tick Edit on 2" ticks each one's own Edit; "Mark 2 done" asks first.
  await itemRow(page, "Reel 2").getByRole("checkbox").click();
  await itemRow(page, "Reel 3").getByRole("checkbox").click();
  await page.getByRole("button", { name: "Tick a stage" }).click();
  await page.getByRole("menuitem", { name: "Tick Colour on 1" }).waitFor();
  await page.getByRole("menuitem", { name: "Tick Edit on 2" }).click();
  await expect(page.getByText("2 ticked Edit")).toBeVisible();
  const ticked = await serviceSelect<{ done_at: string | null }>(
    `project_item_stage_list?name=eq.Edit&item_id=in.(${await itemId(await projectOf(clientId), "Reel 2")},${await itemId(await projectOf(clientId), "Reel 3")})&select=done_at`,
  );
  expect(ticked.every((row) => row.done_at !== null)).toBe(true);
  // A bulk change clears the selection it succeeded on: choose the two again.
  await itemRow(page, "Reel 2").getByRole("checkbox").click();
  await itemRow(page, "Reel 3").getByRole("checkbox").click();
  await page.getByRole("button", { name: "Mark 2 done" }).click();
  const confirm = page.getByRole("alertdialog", { name: "Mark 2 items done?" });
  await confirm.getByRole("button", { name: "Mark 2 items done" }).click();
  await expect(progress(page)).toHaveText("3/3 done");

  // The client's Admin reopens a done item with a reason: it no longer counts.
  await itemRow(page, "Reel 3").locator('[data-slot="item-open"]').click();
  await expect(third.getByRole("checkbox", { name: "Edit" })).toBeDisabled();
  await third.getByRole("button", { name: "Reopen…" }).click();
  const reopen = page.getByRole("dialog", { name: "Reopen Reel 3?" });
  await reopen.getByLabel("What needs to change").fill("The client asked for a new cut");
  await reopen.getByRole("button", { name: "Reopen", exact: true }).click();
  await expect(progress(page)).toHaveText("2/3 done");
  await expect(itemRow(page, "Reel 3")).toContainText("Reopened: The client asked for a new cut");
  await removeClientFixture(client);
});

test("done is approved: no Client items in Approvals; the Owner sends back from the project page", async ({
  page,
  browser,
}, info) => {
  const client = nameOf(info, "sendback");
  const clientId = await workClient(client);
  const projectId = await makeProject(clientId, "Brand film", {
    recurrence: "one_time",
    delivery: addDays(today(), 10),
    items: [nameOf(info, "cut")],
  });
  const id = await itemId(projectId, nameOf(info, "cut"));
  await rpcAs(admin.email, admin.password, "item_mark_done", { item_id: id });
  expect(await itemState(id)).toBe("approved");

  // The Admin's Approvals hold no client items any more (D3).
  await page.goto("/approvals");
  await hydrated(page);
  await expect(page.getByText(nameOf(info, "cut"))).toHaveCount(0);

  const context = await browser.newContext({ storageState: storageStateFor("owner") });
  const ownerPage = await context.newPage();
  await ownerPage.goto("/approvals");
  await expect(ownerPage.locator('[data-slot="page-header"]').first()).toBeVisible();
  await expect(ownerPage.getByText(nameOf(info, "cut"))).toHaveCount(0);
  await ownerPage.goto(`/clients/${clientId}/projects/${projectId}`);
  await hydrated(ownerPage);
  await expect(progress(ownerPage)).toHaveText("1/1 done");
  await itemRow(ownerPage, nameOf(info, "cut")).locator('[data-slot="item-open"]').click();
  const sheet = ownerPage.locator('[data-slot="review-sheet"]');
  await sheet.getByRole("button", { name: "Send back…" }).click();
  const dialog = ownerPage.getByRole("dialog", { name: `Send back ${nameOf(info, "cut")}?` });
  await dialog.getByLabel("What needs to change").fill("The logo is wrong");
  await dialog.getByRole("button", { name: "Send back", exact: true }).click();
  await expect(progress(ownerPage)).toHaveText("0/1 done");
  await expect.poll(() => itemState(id)).toBe("open");
  const adminId = await memberIdOf(admin.email);
  const told = await serviceSelect<{ title: string }>(
    `notifications?recipient_id=eq.${adminId}&kind=eq.item_rejected&entity_id=eq.${id}&select=title`,
  );
  expect(told.map((row) => row.title)).toEqual([`Sent back: ${nameOf(info, "cut")}`]);
  await context.close();
  await removeClientFixture(client);
});

/** "October 2026": a monthly cycle's label (`cycleLabel`), `months` after this IST month. */
function monthLabel(months: number): string {
  const [year, month] = today().split("-").map(Number);
  return new Date(Date.UTC(year!, month! - 1 + months, 1)).toLocaleString("en-GB", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

test("⋯ Item list: a new line starts next month; this month's items don't change (amendment D4)", async ({
  page,
}, info) => {
  const client = nameOf(info, "item list");
  const clientId = await workClient(client);
  const projectId = await makeProject(clientId, "Monthly stories", { items: ["Story 1"] });
  const [current, next] = [monthLabel(0), monthLabel(1)];
  await page.goto(`/clients/${clientId}/projects/${projectId}`);
  await hydrated(page);
  await expect(page.locator('[data-slot="cycle-label"]')).toHaveText(current);

  // The sheet says where a line goes, and where something for this month goes instead.
  await page.getByRole("button", { name: "Actions for Monthly stories" }).click();
  await page.getByRole("menuitem", { name: "Item list" }).click();
  const list = page.locator('[data-slot="review-sheet"]', { hasText: "Item list" });
  await expect(list).toContainText(
    `Every month starts with these, from ${next}. To add something to ${current}, use + Add item on the project page.`,
  );

  // A line added: the toast names the month it starts from; this month's list is unchanged.
  await list.getByLabel("New item").fill("Story 2");
  await list.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.getByText(`Story 2 added from ${next}`)).toBeVisible();
  await expect(list.getByLabel("Name of Story 2")).toBeVisible();
  await expect(list.locator('[data-slot="list-editor-row"][data-pending]')).toHaveCount(0);

  // Removing a line asks in the same words, and leaves this month's item in place.
  await list.getByRole("button", { name: "Remove Story 1" }).click();
  const remove = page.getByRole("alertdialog", { name: "Remove the item Story 1?" });
  await expect(remove).toContainText(`${next} starts without it. ${current}'s items don't change.`);
  await remove.getByRole("button", { name: "Remove item" }).click();
  await expect(remove).toBeHidden();
  await expect(list.getByLabel("Name of Story 1")).toHaveCount(0);
  await page.goBack();
  await expect(list).toBeHidden();
  await expect(itemRow(page, "Story 1")).toBeVisible();
  await expect(itemRow(page, "Story 2")).toHaveCount(0);
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
  await rpcAs(owner.email, owner.password, "item_reopen", {
    item_id: back,
    reason: "The logo is wrong",
  });

  await page.goto("/today");
  await hydrated(page);
  await expect(
    page.locator('[data-slot="today-sent-back-row"]', { hasText: nameOf(info, "back") }),
  ).toContainText("The logo is wrong");
  // The rows come in their own chunk after the page: a tap before it hydrates reaches nothing.
  await expect(page.locator('[data-slot="today-client-work-rows"]')).toHaveAttribute(
    "data-ready",
    "",
  );
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
  // Done is approved in the same step (amendment D3).
  await expect.poll(() => itemState(due)).toBe("approved");
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

    // A line's own stages (amendment D2): a sheet over the item list; one back each.
    await menu.click();
    await page.getByRole("menuitem", { name: "Item list" }).click();
    await list.getByRole("button", { name: "Stages of Reel" }).click();
    const lineStages = page.getByRole("dialog", { name: "Stages of Reel" });
    await expect(lineStages.getByLabel("Name of Script")).toBeVisible();
    await lineStages.getByLabel("New stage").fill("Post");
    await lineStages.getByRole("button", { name: "Add", exact: true }).click();
    await expect(lineStages.getByLabel("Name of Post")).toBeVisible();
    await expect
      .poll(async () => {
        const [line] = await serviceSelect<{ stages: string[] }>(
          `project_item_blueprints?project_id=eq.${projectId}&title=eq.Reel&select=stages`,
        );
        return line?.stages;
      })
      .toEqual(["Script", "Post"]);
    await expectBackStack(page, [
      { closes: lineStages, url: here },
      { closes: list, url: here },
    ]);

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

    // The item sheet's Edit is a layer of its own (§14.2 f, owner's walk 2026-10-09): back asks
    // over the sheet, back on the confirmation keeps editing, Discard returns to the item's facts,
    // and one more back closes the sheet.
    await itemRow(page, "Reel").locator('[data-slot="item-open"]').click();
    const sheet = page.locator('[data-slot="review-sheet"]');
    await sheet.getByRole("button", { name: "Edit", exact: true }).click();
    await sheet.getByLabel("Title").fill("Reel, retitled");
    const discard = page.getByRole("alertdialog", { name: "Discard your changes?" });
    await page.goBack();
    await expect(discard, "back asks before losing typed work").toBeVisible();
    await expect(page).toHaveURL(here);
    await page.goBack();
    await expect(discard, "back on the confirmation keeps editing").toBeHidden();
    await expect(sheet.getByLabel("Title"), "the draft is kept").toHaveValue("Reel, retitled");
    await page.goBack();
    await discard.getByRole("button", { name: "Discard changes" }).click();
    await expect(discard).toBeHidden();
    await expect(sheet.getByLabel("Title"), "Discard returns to the facts").toHaveCount(0);
    await expect(sheet.getByRole("button", { name: "Edit", exact: true })).toBeVisible();
    await expectBackStack(page, [{ closes: sheet, url: here }]);
    expect(
      (
        await serviceSelect<{ title: string }>(
          `project_items?project_id=eq.${projectId}&select=title`,
        )
      ).map((row) => row.title),
    ).toEqual(["Reel"]);
    await removeClientFixture(client);
  });

  test("the item sheet's Edit is a layer: back and Cancel return to the facts, the sheet always opens on them, History stays on its row", async ({
    page,
  }, info) => {
    const client = nameOf(info, "item edit");
    const clientId = await workClient(client);
    const projectId = await makeProject(clientId, "Edit reels", {
      items: ["Reel 1"],
      stages: ["Script"],
    });
    const here = new RegExp(`/projects/${projectId}$`);
    await runInstalled(page);
    await page.goto(`/clients/${clientId}/projects`);
    await page.goto(`/clients/${clientId}/projects/${projectId}`);
    await hydrated(page);
    const sheet = page.locator('[data-slot="review-sheet"]');
    const open = async () => {
      await itemRow(page, "Reel 1").locator('[data-slot="item-open"]').click();
      await expect(sheet).toBeVisible();
    };
    const edit = sheet.getByRole("button", { name: "Edit", exact: true });
    const title = sheet.getByLabel("Title");
    const discard = page.getByRole("alertdialog", { name: "Discard your changes?" });
    const onFacts = async (why: string) => {
      await expect(title, why).toHaveCount(0);
      await expect(edit, why).toBeVisible();
    };

    // "Last change: … History" is one row: the text wraps on its own, History (44 px, no "·")
    // sits at the row's end on the text's line.
    await open();
    const row = sheet.locator('[data-slot="item-last-change"]');
    const history = row.getByRole("button", { name: "History" });
    await expect(row).not.toContainText("·");
    const rowBox = (await row.boundingBox())!;
    const historyBox = (await history.boundingBox())!;
    const textBox = (await row.locator("p").boundingBox())!;
    expect(historyBox.height).toBeGreaterThanOrEqual(44);
    expect(historyBox.width).toBeGreaterThanOrEqual(44);
    expect(
      Math.abs(historyBox.x + historyBox.width - (rowBox.x + rowBox.width)),
    ).toBeLessThanOrEqual(1);
    expect(historyBox.x).toBeGreaterThanOrEqual(textBox.x + textBox.width);
    expect(historyBox.y, "History on the text's line").toBeLessThan(textBox.y + textBox.height);
    expect(textBox.y).toBeLessThan(historyBox.y + historyBox.height);

    // Back from Edit returns to the facts; a second back closes the sheet.
    await edit.click();
    await expect(title).toBeVisible();
    await page.goBack();
    await onFacts("back from Edit returns to the facts");
    await expect(sheet).toBeVisible();
    await expect(page).toHaveURL(here);
    await expectBackStack(page, [{ closes: sheet, url: here }]);

    // Cancel does the same as back, and leaves no extra back press behind.
    await open();
    await edit.click();
    await sheet.getByRole("button", { name: "Cancel" }).click();
    await onFacts("Cancel returns to the facts");
    await expectBackStack(page, [{ closes: sheet, url: here }]);

    // Cancel with a change typed asks first: Keep editing keeps the draft; Discard returns to the
    // facts, the sheet still open.
    await open();
    await edit.click();
    await title.fill("Reel 1, retitled");
    await sheet.getByRole("button", { name: "Cancel" }).click();
    await expect(discard).toBeVisible();
    await discard.getByRole("button", { name: "Keep editing" }).click();
    await expect(discard).toBeHidden();
    await expect(title).toHaveValue("Reel 1, retitled");
    await sheet.getByRole("button", { name: "Cancel" }).click();
    await discard.getByRole("button", { name: "Discard changes" }).click();
    await onFacts("Discard returns to the facts");
    await expect(sheet).toContainText("Reel 1");
    await expectBackStack(page, [{ closes: sheet, url: here }]);

    // Closed while editing (its ✕), the sheet reopens on the facts, never on the editor.
    await open();
    await edit.click();
    await expect(title).toBeVisible();
    await sheet.getByRole("button", { name: "Close", exact: true }).click();
    await expect(sheet).toBeHidden();
    await open();
    await onFacts("the sheet reopens on the facts");
    // With a change typed, ✕ asks first; Discard closes the sheet, and it reopens on the facts.
    await edit.click();
    await title.fill("Reel 1, half-typed");
    await sheet.getByRole("button", { name: "Close", exact: true }).click();
    await expect(discard).toBeVisible();
    await discard.getByRole("button", { name: "Discard changes" }).click();
    await expect(sheet).toBeHidden();
    await open();
    await onFacts("the sheet reopens on the facts after a discard");
    await page.goBack();
    await expect(sheet).toBeHidden();
    expect(
      (
        await serviceSelect<{ title: string }>(
          `project_items?project_id=eq.${projectId}&select=title`,
        )
      ).map((item) => item.title),
    ).toEqual(["Reel 1"]);
    await removeClientFixture(client);
  });

  test("the keyboard never covers a sheet's field: Item list, Default stages, the item's Edit and Close…", async ({
    page,
  }, info) => {
    const client = nameOf(info, "keyboard");
    const clientId = await workClient(client);
    const projectId = await makeProject(clientId, "Keyboard reels", {
      items: ["Reel 1"],
      stages: ["Script"],
    });
    const here = new RegExp(`/projects/${projectId}$`);
    await runInstalled(page);
    await page.goto(`/clients/${clientId}/projects/${projectId}`);
    await hydrated(page);
    const menu = page.getByRole("button", { name: "Actions for Keyboard reels" });

    await menu.click();
    await page.getByRole("menuitem", { name: "Item list" }).click();
    const list = page.locator('[data-slot="review-sheet"]', { hasText: "Item list" });
    await expectSheetAboveKeyboard(page, list, list.getByLabel("New item"));
    await expectBackStack(page, [{ closes: list, url: here }]);

    await menu.click();
    await page.getByRole("menuitem", { name: "Default stages" }).click();
    const stages = page.locator('[data-slot="review-sheet"]', { hasText: "Default stages" });
    await expectSheetAboveKeyboard(page, stages, stages.getByLabel("New stage"));
    await expectBackStack(page, [{ closes: stages, url: here }]);

    await itemRow(page, "Reel 1").locator('[data-slot="item-open"]').click();
    const sheet = page.locator('[data-slot="review-sheet"]');
    await sheet.getByRole("button", { name: "Edit", exact: true }).click();
    await expectSheetAboveKeyboard(page, sheet, sheet.getByLabel("Notes"));
    await expectSheetAboveKeyboard(page, sheet, sheet.getByLabel("Title"));
    await page.goBack();
    await expect(sheet.getByLabel("Title")).toHaveCount(0);

    await sheet.getByRole("button", { name: "Close item…" }).click();
    const close = page.getByRole("dialog", { name: "Close Reel 1?" });
    await expectSheetAboveKeyboard(page, close, close.getByLabel("Why close it"));
    await expectBackStack(page, [
      { closes: close, url: here },
      { closes: sheet, url: here },
    ]);
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
    await page.getByRole("button", { name: "Tick a stage" }).click();
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

  test("the Activity panel and its chips, the item sheet's Reopen…, Edit stages and History, Today's item sheet, the carry screen's Close…", async ({
    page,
  }, info) => {
    const client = nameOf(info, "sheet back");
    const clientId = await workClient(client);
    const projectId = await makeProject(clientId, "Sheet film", {
      recurrence: "one_time",
      delivery: addDays(today(), 10),
      items: [nameOf(info, "sheet done"), nameOf(info, "sheet due")],
      stages: ["Script"],
    });
    await rpcAs(admin.email, admin.password, "item_mark_done", {
      item_id: await itemId(projectId, nameOf(info, "sheet done")),
    });
    await rpcAs(admin.email, admin.password, "item_update", {
      item_id: await itemId(projectId, nameOf(info, "sheet due")),
      changes: { planned_date: today() },
    });
    await runInstalled(page);
    await page.goto("/today");
    await hydrated(page);

    // Today's Client work: a row opens the item sheet; back closes it. The rows come in their
    // own chunk after the page: a tap before it hydrates reaches nothing.
    await expect(page.locator('[data-slot="today-client-work-rows"]')).toHaveAttribute(
      "data-ready",
      "",
    );
    await page
      .locator('[data-slot="today-client-item"]', { hasText: nameOf(info, "sheet due") })
      .getByRole("button")
      .first()
      .click();
    const sheet = page.locator('[data-slot="review-sheet"]').first();
    await expect(sheet).toBeVisible();
    await expectBackStack(page, [{ closes: sheet, url: /\/today$/ }]);

    // The project page's Activity: an overlay layer; its chips are view state (no history).
    const here = new RegExp(`/projects/${projectId}$`);
    await page.goto(`/clients/${clientId}/projects/${projectId}`);
    await hydrated(page);
    await page.getByRole("button", { name: "Activity" }).click();
    const panel = page.locator('[data-slot="review-sheet"]', {
      has: page.locator('[data-slot="activity-panel"]'),
    });
    await expect(panel.locator('[data-slot="activity-line"]').first()).toBeVisible();
    await panel.getByRole("button", { name: "Items", exact: true }).click();
    await expect(panel.getByRole("button", { name: "Items", exact: true })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await panel.getByRole("button", { name: "Project", exact: true }).click();
    await expect(
      panel.locator('[data-slot="activity-line"]', { hasText: "created the project" }),
    ).toBeVisible();
    await expect(panel.locator('[data-slot="activity-line"]', { hasText: /marked/ })).toHaveCount(
      0,
    );
    await expectBackStack(page, [{ closes: panel, url: here }]);

    // A done item's Reopen…: the dialog, then the sheet, one back each.
    const doneSheet = page.locator('[data-slot="review-sheet"]', {
      hasText: nameOf(info, "sheet done"),
    });
    await itemRow(page, nameOf(info, "sheet done")).locator('[data-slot="item-open"]').click();
    await doneSheet.getByRole("button", { name: "Reopen…" }).click();
    const reopen = page.getByRole("dialog", { name: `Reopen ${nameOf(info, "sheet done")}?` });
    await expect(reopen).toBeVisible();
    await expectBackStack(page, [
      { closes: reopen, url: here },
      { closes: doneSheet, url: here },
    ]);

    // An open item's Edit stages and History: each a layer over the sheet.
    const dueSheet = page.locator('[data-slot="review-sheet"]', {
      has: page.locator('[data-slot="item-sheet"]'),
      hasText: nameOf(info, "sheet due"),
    });
    await itemRow(page, nameOf(info, "sheet due")).locator('[data-slot="item-open"]').click();
    await dueSheet.getByRole("button", { name: "Edit stages" }).click();
    const editor = page.getByRole("dialog", { name: `Stages of ${nameOf(info, "sheet due")}` });
    await expect(editor).toBeVisible();
    await expectBackStack(page, [{ closes: editor, url: here }]);
    await dueSheet.getByRole("button", { name: "History" }).click();
    const history = page.getByRole("dialog", { name: `History of ${nameOf(info, "sheet due")}` });
    await expect(history.locator('[data-slot="activity-line"]').first()).toBeVisible();
    await expectBackStack(page, [
      { closes: history, url: here },
      { closes: dueSheet, url: here },
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
    await page.getByRole("option", { name: "Overdue", exact: true }).click();
    await expect(page).toHaveURL(/\/clients\/items\?filter=overdue$/);
    await expectBackStack(page, [{ url: /\/clients$/ }, { url: /\/today$/ }]);
    await removeClientFixture(client);
  });
});

test.describe("marking done on the project page, as the Owner (amendment D3; the 7B review's S1)", () => {
  test.use({ storageState: storageStateFor("owner") });

  test("a row's Mark done and the sheet's have the 6-second Undo; Mark N done asks first", async ({
    page,
  }, info) => {
    test.skip(info.project.name === "mobile-lg", "the 375 and desktop runs cover the flow");
    const client = nameOf(info, "owner marks");
    const clientId = await workClient(client);
    const titles = ["Reel 1", "Reel 2", "Reel 3", "Reel 4"];
    const projectId = await makeProject(clientId, "Done reels", { items: titles });
    await page.goto(`/clients/${clientId}/projects/${projectId}`);
    await hydrated(page);
    await expect(progress(page)).toHaveText("0/4 done");

    // The row's Mark done: held with an Undo; Undo sends nothing.
    const first = await itemId(projectId, "Reel 1");
    await itemRow(page, "Reel 1").getByRole("button", { name: "Mark done", exact: true }).click();
    await expect(itemRow(page, "Reel 1")).toHaveAttribute("data-held", "");
    await expect(page.getByText("Marked Reel 1 done")).toBeVisible();
    await page.getByRole("button", { name: "Undo" }).click();
    await expect(itemRow(page, "Reel 1")).not.toHaveAttribute("data-held", "");
    expect(await itemState(first)).toBe("open");
    // Kept: sent when the Undo window ends, or at once when the app goes to the background; it
    // is approved in the same step.
    await itemRow(page, "Reel 1").getByRole("button", { name: "Mark done", exact: true }).click();
    await flushSends(page);
    await expect.poll(() => itemState(first)).toBe("approved");
    await expect(progress(page)).toHaveText("1/4 done");

    // The sheet's Mark done: the sheet closes, the Undo is offered, then it is sent.
    await itemRow(page, "Reel 2").locator('[data-slot="item-open"]').click();
    const sheet = page.locator('[data-slot="review-sheet"]');
    await sheet.getByRole("button", { name: "Mark done", exact: true }).click();
    await expect(sheet).toBeHidden();
    await expect(page.getByText("Marked Reel 2 done")).toBeVisible();
    await flushSends(page);
    const second = await itemId(projectId, "Reel 2");
    await expect.poll(() => itemState(second)).toBe("approved");

    // Mark N done: a trigger; the confirmation's red button names it.
    await itemRow(page, "Reel 3").getByRole("checkbox").click();
    await itemRow(page, "Reel 4").getByRole("checkbox").click();
    await page.getByRole("button", { name: "Mark 2 done", exact: true }).click();
    const confirm = page.getByRole("alertdialog", { name: "Mark 2 items done?" });
    await expect(confirm).toBeVisible();
    await confirm.getByRole("button", { name: "Mark 2 items done" }).click();
    await expect(confirm).toBeHidden();
    await expect(progress(page)).toHaveText("4/4 done");
    await removeClientFixture(client);
  });

  test("the Activity panel pages: the latest 20, then Show older; the chips narrow it", async ({
    page,
  }, info) => {
    test.skip(info.project.name === "mobile-lg", "the 375 and desktop runs cover the flow");
    const client = nameOf(info, "activity");
    const clientId = await workClient(client);
    const projectId = await makeProject(clientId, "Busy reels", {
      items: ["Reel 1"],
      stages: ["Script"],
    });
    const reel = await itemId(projectId, "Reel 1");
    const [script] = await serviceSelect<{ id: string }>(
      `project_item_stage_list?item_id=eq.${reel}&name=eq.Script&select=id`,
    );
    // 24 ticks and unticks: more than one page of the item's history.
    for (let n = 0; n < 12; n += 1) {
      await rpcAs(admin.email, admin.password, "item_stage_tick", {
        stage_id: script!.id,
        done: true,
      });
      await rpcAs(admin.email, admin.password, "item_stage_tick", {
        stage_id: script!.id,
        done: false,
      });
    }
    await page.goto(`/clients/${clientId}/projects/${projectId}`);
    await hydrated(page);
    await page.getByRole("button", { name: "Activity" }).click();
    const panel = page.locator('[data-slot="activity-panel"]');
    const lines = panel.locator('[data-slot="activity-line"]');
    await expect(lines).toHaveCount(20);
    await expect(lines.first()).toContainText("unticked Script on Reel 1");
    await panel.getByRole("button", { name: "Show older" }).click();
    await expect(lines.last()).toContainText("created the project");
    await expect(panel.getByRole("button", { name: "Show older" })).toHaveCount(0);
    const count = await lines.count();
    expect(count).toBeGreaterThan(24);
    // Stages: ticks only; Project: the project's own entries.
    await panel.getByRole("button", { name: "Stages", exact: true }).click();
    await expect(lines.first()).toContainText("Script");
    await expect(panel.getByText("created the project")).toHaveCount(0);
    await panel.getByRole("button", { name: "Project", exact: true }).click();
    await expect(lines.last()).toContainText("created the project");
    await expect(panel.getByText(/ticked/)).toHaveCount(0);
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

  // Complete is refused while an item is open: the dialog says what is left.
  await menu.click();
  await page.getByRole("menuitem", { name: "Complete project" }).click();
  const complete = page.getByRole("alertdialog", { name: "Complete Brand film?" });
  await expect(complete).toContainText("1 item is still open");
  await expect(complete.getByRole("button", { name: "Complete project" })).toBeDisabled();
  await complete.getByRole("button", { name: "Cancel" }).click();

  const item = await itemId(projectId, "Final cut");
  await rpcAs(admin.email, admin.password, "item_mark_done", { item_id: item });
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
  await dialog.getByLabel("Default stages", { exact: true }).fill("Script\nEdit");
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
  await expect(progress(page)).toHaveText("0/2 done");
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
