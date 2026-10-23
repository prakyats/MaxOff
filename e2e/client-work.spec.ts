import { createClient } from "@supabase/supabase-js";
import type { Locator, Page, Route, TestInfo } from "@playwright/test";

import { expect, test } from "./fixtures";
import { HOLD_PROXY_URL } from "./hold-proxy-config";
import {
  animationsSettled,
  expectBackStack,
  expectNoHorizontalScroll,
  expectSheetAboveKeyboard,
  hydrated,
  memberIdOf,
  removeClientFixture,
  rowAction,
  rpcAs,
  runInstalled,
  serviceInsert,
  serviceRest,
  serviceSelect,
  signIn,
  storageStateFor,
  supabaseAuth,
  USERS,
  pageHeader,
  createFromNewProject,
  newProjectStep,
} from "./helpers";
import { istDate, wallClock } from "./run-state";
import { NETWORK_ERROR_CREATE_MESSAGE } from "../src/core/ui/action/network-error";

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

/** The cycle's progress line under its ring (6b.11 (5)): stages ticked, then deliverables done. */
const progress = (page: Page) => page.locator('[data-slot="cycle-meter-line"]');

/** Opens the collapsed "Done and closed (N)" group (a view control: it adds no history). */
async function showFinished(page: Page): Promise<void> {
  const toggle = page.locator('[data-slot="finished-toggle"]');
  if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
}

/** The values of some inputs, in order (a list of stage names). */
const valuesOf = (inputs: Locator) =>
  inputs.evaluateAll((elements) => elements.map((element) => (element as HTMLInputElement).value));

/** Create in the New project dialog (V5b PP-forms-7): Next to Preview & create, then Create. */
async function createFromDialog(_page: Page, dialog: Locator): Promise<void> {
  await createFromNewProject(dialog);
}
const itemRow = (page: Page, title: string) =>
  page.locator('[data-slot="item-row"]', { hasText: title });

/**
 * Mark done from the row's ⋯, where it waits until every stage is ticked (unit U); with a stage
 * left it asks first, naming it (PP-sheet-2), and the confirmation's Mark done sends it.
 */
async function markDoneFromMenu(page: Page, title: string): Promise<void> {
  await itemRow(page, title)
    .getByRole("button", { name: `More for ${title}` })
    .click();
  await page.getByRole("menuitem", { name: "Mark done…" }).click();
  const ask = page.getByRole("alertdialog", { name: `Mark ${title} done?` });
  await expect(ask).toContainText(/\d+ stages? (isn't|aren't) ticked\./);
  await expect(ask.getByRole("button", { name: "Keep it open" })).toBeVisible();
  await ask.getByRole("button", { name: "Mark done", exact: true }).click();
}

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
  // The title names the client (the approved sample; the design gate, 23 Oct).
  await expect(dialog.getByRole("heading", { name: `New project · ${client}` })).toBeVisible();
  await dialog.getByLabel("Project name").fill("Monthly reels");
  // Step 2: the default stages as one untitled group (a group without a name), then "Reel" × 3.
  await newProjectStep(dialog, 2);
  if ((page.viewportSize()?.width ?? 1280) < 768) {
    // A phone: the steps on one line ("3 Preview"), Back and Next side by side.
    const steps = dialog.locator('[data-slot="new-project-steps"]');
    await expect(steps).toHaveText(/^1 Basics\s*2 Deliverables\s*3 Preview$/, {
      useInnerText: true,
    });
    const line = await steps.evaluate(
      (element) =>
        element.getBoundingClientRect().height / parseFloat(getComputedStyle(element).lineHeight),
    );
    expect(Math.round(line), "the stepper is one line").toBe(1);
    const back = await dialog.locator('[data-slot="new-project-back"]').boundingBox();
    const next = await dialog.locator('[data-slot="new-project-next"]').boundingBox();
    expect(Math.abs((back?.y ?? 0) - (next?.y ?? 99)), "Back and Next on one row").toBeLessThan(2);
    expect(back?.x ?? 0, "Back first").toBeLessThan(next?.x ?? 0);
  }
  await dialog.getByRole("button", { name: "Add a group" }).click();
  await dialog.getByLabel("Stages of the new group").fill("Script\nEdit");
  await dialog.getByRole("button", { name: "Add group" }).click();
  await dialog.getByLabel("Deliverable name").fill("Reel");
  await dialog.getByLabel("How many").fill("3");
  await dialog
    .locator('[data-slot="add-deliverables"]')
    .getByRole("button", { name: "Add", exact: true })
    .click();
  await createFromDialog(page, dialog);
  await expect(page).toHaveURL(new RegExp(`/clients/${clientId}/projects/[0-9a-f-]{36}$`));
  await hydrated(page);
  // Amendment D3: one figure, done (= approved).
  await expect(progress(page)).toHaveText("0 of 6 stages · 0 of 3 deliverables done");

  // One row's Mark done: instant with the 6-second Undo, then it counts. Its stages are not all
  // ticked, so it waits in the row's ⋯ (unit U).
  await markDoneFromMenu(page, "Reel 1");
  await expect(page.getByText("Marked Reel 1 done")).toBeVisible();
  await expect(itemRow(page, "Reel 1")).toHaveAttribute("data-held", "");
  await flushSends(page);
  // Done counts its stages too: the ring moves by Reel 1's two.
  await expect(progress(page)).toHaveText("2 of 6 stages · 1 of 3 deliverables done");

  // The item sheet: its own stages (the defaults to start), a tick, and a stage of its own (D2).
  const sheet = page.locator('[data-slot="review-sheet"]').filter({ hasText: "Reel 2" });
  await itemRow(page, "Reel 2").locator('[data-slot="item-open"]').click();
  const script = sheet.getByRole("checkbox", { name: "Script" });
  await expect(script).toHaveAttribute("aria-checked", "false");
  await script.click();
  await expect(script).toHaveAttribute("aria-checked", "true");
  // PP-sheet-1: short, "Last change · ‹who› ticked Script · 21 Oct" (the sheet is Reel 2's own).
  await expect(sheet.locator('[data-slot="item-last-change"]')).toHaveText(
    /^Last change · .+ ticked Script · \d{1,2} [A-Z][a-z]{2}$/,
  );
  await sheet.getByRole("button", { name: "Edit stages" }).click();
  const stages = page.getByRole("dialog", { name: "Stages of Reel 2" });
  await stages.getByLabel("Add a stage", { exact: true }).fill("Colour");
  await stages.getByRole("button", { name: "Add the stage", exact: true }).click();
  await expect(stages.getByLabel("Name of Colour")).toBeVisible();
  // The tick stays as it was, shown beside its stage while editing.
  await expect(
    stages.locator('[data-slot="stage-row"]', { has: page.getByLabel("Name of Script") }),
  ).toHaveAttribute("data-done", "");
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

  // Bulk: select two; "Tick Edit on 2" ticks each one's own Edit; "Mark 2 done" asks first. The
  // checkboxes show in Select mode only (6b.16 (e)).
  await expect(page.locator('[data-slot="item-row"] [role="checkbox"]')).toHaveCount(0);
  await page.getByRole("button", { name: "Select", exact: true }).click();
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
  const confirm = page.getByRole("alertdialog", { name: "Mark 2 deliverables done?" });
  await confirm.getByRole("button", { name: "Mark 2 deliverables done" }).click();
  await expect(progress(page)).toHaveText("7 of 7 stages · 3 of 3 deliverables done");
  await page.getByRole("button", { name: "Done", exact: true }).click();

  // The client's Admin reopens a done item with a reason: it no longer counts. Done ones wait in
  // the collapsed "Done and closed" group (6b.11 (1)).
  await showFinished(page);
  await itemRow(page, "Reel 3").locator('[data-slot="item-open"]').click();
  await expect(third.getByRole("checkbox", { name: "Edit" })).toBeDisabled();
  await third.getByRole("button", { name: "Reopen…" }).click();
  const reopen = page.getByRole("dialog", { name: "Reopen Reel 3?" });
  await reopen.getByLabel("What needs to change").fill("The client asked for a new cut");
  await reopen.getByRole("button", { name: "Reopen", exact: true }).click();
  // Its ticks stay: only its done share leaves the ring.
  await expect(progress(page)).toHaveText("6 of 7 stages · 2 of 3 deliverables done");
  await expect(itemRow(page, "Reel 3").locator('[data-slot="item-row-sent-back"]')).toHaveText(
    /^Reopened by .+, \d{1,2} [A-Z][a-z]{2}: The client asked for a new cut$/,
  );
  await removeClientFixture(client);
});

test("done is approved: no client deliverables in Approvals; the Owner sends back from the project page", async ({
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
  await expect(pageHeader(ownerPage)).toBeVisible();
  await expect(ownerPage.getByText(nameOf(info, "cut"))).toHaveCount(0);
  await ownerPage.goto(`/clients/${clientId}/projects/${projectId}`);
  await hydrated(ownerPage);
  await expect(progress(ownerPage)).toHaveText("1 of 1 deliverable done");
  await showFinished(ownerPage);
  await itemRow(ownerPage, nameOf(info, "cut")).locator('[data-slot="item-open"]').click();
  const sheet = ownerPage.locator('[data-slot="review-sheet"]');
  await sheet.getByRole("button", { name: "Send back…" }).click();
  const dialog = ownerPage.getByRole("dialog", { name: `Send back ${nameOf(info, "cut")}?` });
  await dialog.getByLabel("What needs to change").fill("The logo is wrong");
  await dialog.getByRole("button", { name: "Send back", exact: true }).click();
  await expect(progress(ownerPage)).toHaveText("0 of 1 deliverable done");
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

test("⋯ Deliverables list: a new line starts next month; this month's deliverables don't change (amendment D4)", async ({
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
  await page.getByRole("menuitem", { name: "Deliverables list" }).click();
  const list = page.locator('[data-slot="review-sheet"]', { hasText: "Deliverables list" });
  await expect(list).toContainText(
    `Every month starts with these, from ${next}. To add something to ${current}, use + Add deliverable on the project page.`,
  );

  // A line added: the toast names the month it starts from; this month's list is unchanged.
  await list.getByLabel("New deliverable").fill("Story 2");
  await list.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.getByText(`Story 2 added from ${next}`)).toBeVisible();
  await expect(list.getByLabel("Name of Story 2")).toBeVisible();
  await expect(list.locator('[data-slot="list-editor-row"][data-pending]')).toHaveCount(0);

  // An add that never gets an answer (the connection dropped) takes its faded row back, returns
  // the name to the field with the reason, and leaves Add usable (the phase 7 review).
  const dropAdd = (route: Route) =>
    route.request().method() === "POST" && route.request().headers()["next-action"]
      ? route.abort("internetdisconnected")
      : route.fallback();
  await page.route("**/*", dropAdd);
  await list.getByLabel("New deliverable").fill("Story 3");
  await list.getByRole("button", { name: "Add", exact: true }).click();
  await expect(list.getByText(NETWORK_ERROR_CREATE_MESSAGE)).toBeVisible();
  await expect(list.getByLabel("New deliverable")).toHaveValue("Story 3");
  await expect(list.locator('[data-slot="list-editor-row"][data-pending]')).toHaveCount(0);
  await expect(list.getByRole("button", { name: "Add", exact: true })).toBeEnabled();
  await page.unroute("**/*", dropAdd);
  await list.getByLabel("New deliverable").fill("");

  // Removing a line asks in the same words, and leaves this month's item in place.
  await list.getByRole("button", { name: "Remove Story 1" }).click();
  const remove = page.getByRole("alertdialog", { name: "Remove the deliverable Story 1?" });
  await expect(remove).toContainText(
    `${next} starts without it. ${current}'s deliverables don't change.`,
  );
  await remove.getByRole("button", { name: "Remove deliverable" }).click();
  await expect(remove).toBeHidden();
  await expect(list.getByLabel("Name of Story 1")).toHaveCount(0);
  await page.goBack();
  await expect(list).toBeHidden();
  await expect(itemRow(page, "Story 1")).toBeVisible();
  await expect(itemRow(page, "Story 2")).toHaveCount(0);
  await removeClientFixture(client);
});

test("the Owner's Today: N deliverables overdue, the list grouped by Admin", async ({
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
  await expect(line).toContainText(/deliverables? overdue/);
  // Red for overdue with its dot, the line's one status signal (the Today refresh, 2026-10-09).
  await expect(line.locator('[data-slot="today-items-overdue-signal"]')).toHaveAttribute(
    "data-tone",
    "danger",
  );
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

  // N5 (V3): a deliverable with stages left offers "Next: ‹stage›", never Mark done at 0/1.
  const staged = await makeProject(clientId, "Today staged", {
    recurrence: "one_time",
    delivery: addDays(today(), 10),
    items: [nameOf(info, "staged")],
    stages: ["Stage 1"],
  });
  await rpcAs(admin.email, admin.password, "item_update", {
    item_id: await itemId(staged, nameOf(info, "staged")),
    changes: { planned_date: today() },
  });

  await page.goto("/today");
  await hydrated(page);
  const stagedRow = page.locator('[data-slot="today-client-item"]', {
    hasText: nameOf(info, "staged"),
  });
  await expect(stagedRow.locator('[data-slot="today-item-next"]')).toHaveText(/Next:\s*Stage 1/);
  await expect(stagedRow.getByRole("button", { name: "Mark done" })).toHaveCount(0);
  await expect(
    page.locator('[data-slot="today-sent-back-row"]', { hasText: nameOf(info, "back") }),
  ).toContainText("The logo is wrong");
  // The rows come in their own chunk after the page: a tap before it hydrates reaches nothing.
  await expect(page.locator('[data-slot="today-client-work-rows"]')).toHaveAttribute(
    "data-ready",
    "",
  );
  const row = page.locator('[data-slot="today-client-item"]', { hasText: nameOf(info, "due") });
  await expect(row).toContainText("Planned today");
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

test("the deliverable sheet from Today: the footer fits inside the sheet at every width, Planned reads once, Edit stages sits on the Stages row (owner walk 23 Oct)", async ({
  page,
}, info) => {
  const client = nameOf(info, "fit");
  const clientId = await workClient(client);
  const projectId = await makeProject(clientId, "Fit reels", {
    recurrence: "one_time",
    delivery: addDays(today(), 10),
    items: [nameOf(info, "fit reel")],
    stages: ["Posted"],
  });
  await rpcAs(admin.email, admin.password, "item_update", {
    item_id: await itemId(projectId, nameOf(info, "fit reel")),
    changes: { planned_date: today() },
  });
  // Laptop sheet widths on the desktop project; each phone project at its own width.
  const own = page.viewportSize() ?? { width: 1280, height: 800 };
  const widths = own.width >= 768 ? [1024, 1280, 1920] : [own.width];
  for (const width of widths) {
    await page.setViewportSize({ width, height: own.height });
    await page.goto("/today");
    await hydrated(page);
    await expect(page.locator('[data-slot="today-client-work-rows"]')).toHaveAttribute(
      "data-ready",
      "",
    );
    await page
      .locator('[data-slot="today-client-item"]', { hasText: nameOf(info, "fit reel") })
      .getByRole("button")
      .first()
      .click();
    const sheet = page.locator('[data-slot="review-sheet"]', {
      has: page.locator('[data-slot="item-sheet"]'),
    });
    await expect(sheet).toBeVisible();

    // (2) The label says Planned; the value is the date alone.
    await expect(sheet.locator("dl > div").first()).toHaveText("PlannedToday");

    // (3) Edit stages on the Stages heading row, beside the count; a 44 px target on a phone
    // (a laptop's pointer keeps the system's button height, as before).
    const heading = sheet.locator('[data-slot="item-stages-heading"]');
    await expect(heading.locator('[data-slot="item-stage-group-heading"]')).toHaveText(
      "Stages0/1 stages ticked",
    );
    const edit = heading.getByRole("button", { name: "Edit stages" });
    await expect(edit).toBeVisible();
    // Both boxes from one frame: the sheet is still sliding up (slide-in-from-bottom), so two
    // separate `boundingBox()` reads land a frame apart and differ by the sheet's own movement.
    const boxes = await heading.evaluate((row) => {
      const button = row.querySelector('[data-slot="item-stages-edit"]');
      const own = row.getBoundingClientRect();
      const edit = button?.getBoundingClientRect();
      return {
        row: { top: own.top, bottom: own.bottom },
        edit: edit ? { top: edit.top, bottom: edit.bottom, height: edit.height } : null,
      };
    });
    expect(boxes.edit).not.toBeNull();
    if (width < 768) expect(boxes.edit!.height).toBeGreaterThanOrEqual(44);
    expect(boxes.edit!.top).toBeGreaterThanOrEqual(boxes.row.top);
    expect(boxes.edit!.bottom).toBeLessThanOrEqual(boxes.row.bottom);
    await expect(sheet.locator('[data-slot="item-stage-group-heading"]')).toHaveCount(1);

    // (1) Every footer action whole and inside the sheet: never cut (the truncation rule).
    const footer = sheet.locator('[data-slot="review-sheet-actions"]');
    await expect(footer.getByRole("link", { name: "Open the project" })).toBeVisible();
    await expect(footer.getByRole("button", { name: "Close deliverable…" })).toBeVisible();
    await expect(footer.getByRole("button", { name: "Next: Posted" })).toBeVisible();
    const fit = await footer.evaluate((node) => {
      const box = node.getBoundingClientRect();
      return {
        overflow: node.scrollWidth - node.clientWidth,
        actions: [...node.querySelectorAll<HTMLElement>("a, button")].map((action) => {
          const own = action.getBoundingClientRect();
          return {
            label: action.textContent ?? "",
            inside: own.left >= box.left - 0.5 && own.right <= box.right + 0.5,
            clipped: action.scrollWidth > action.clientWidth + 1,
          };
        }),
      };
    });
    expect(fit.overflow, `the footer at ${width}px`).toBeLessThanOrEqual(0);
    expect(fit.actions).toHaveLength(3);
    for (const action of fit.actions) {
      expect(action.inside, `${action.label} inside the sheet at ${width}px`).toBe(true);
      expect(action.clipped, `${action.label} whole at ${width}px`).toBe(false);
    }
    // Next stays the last, rightmost action (the commit).
    const last = await footer.locator("a, button").last().textContent();
    expect(last).toContain("Next: Posted");
    await page.keyboard.press("Escape");
    await expect(sheet).toBeHidden();
  }
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
  await dialog.getByRole("button", { name: "Close deliverable" }).click();
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

test("Settings → Templates → Stage presets: an Admin adds, edits and deletes their own", async ({
  page,
}, info) => {
  test.skip(info.project.name === "mobile-lg", "the 375 and desktop runs cover it");
  const name = nameOf(info, "preset");
  await serviceRest(`stage_presets?name=eq.${encodeURIComponent(name)}`, { method: "DELETE" });
  await page.goto("/settings");
  // The Stage presets card left the Settings grid: they are the Templates page's first section
  // (6b.6 owner note).
  await page.getByRole("link", { name: "Templates", exact: true }).click();
  await expect(page).toHaveURL(/\/settings\/templates$/);
  await hydrated(page);
  await page.getByRole("button", { name: "Add preset" }).click();
  const add = page.getByRole("dialog", { name: "Add a stage preset" });
  await add.getByLabel("Name").fill(name);
  // One row per stage since 6b.18 (drag to reorder): the first row is there, Add stage adds one.
  await add.getByLabel("Stage 1", { exact: true }).fill("Brief");
  for (const [index, stage] of ["Shoot", "Deliver"].entries()) {
    await add.getByRole("button", { name: "Add stage" }).click();
    await add.getByLabel(`Stage ${index + 2}`, { exact: true }).fill(stage);
  }
  await add.getByRole("button", { name: "Add preset" }).click();
  const row = page.locator('[data-slot="stage-preset"]', { hasText: name });
  await expect(row).toContainText("Brief → Shoot → Deliver · by you");
  await rowAction(page, row, name, "Edit");
  const edit = page.getByRole("dialog", { name: `Edit ${name}` });
  await edit.getByLabel("Stage 3", { exact: true }).fill("Edit");
  await edit.getByRole("button", { name: "Add stage" }).click();
  await edit.getByLabel("Stage 4", { exact: true }).fill("Deliver");
  await edit.getByRole("button", { name: "Save preset" }).click();
  await expect(row).toContainText("Brief → Shoot → Edit → Deliver · by you");
  await rowAction(page, row, name, "Archive");
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: `Archive ${name}` })
    .click();
  // D6: Archive; the row leaves, no Archived list.
  await expect(row).toHaveCount(0);
  await expect(page.locator('[data-slot="archived-stage-preset"]')).toHaveCount(0);
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
  await expect(pageHeader(crew)).toBeVisible();
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

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "8 Oct": the screens' short date (`shortDate`) of an ISO date. */
function shortOf(date: string): string {
  const [, month, day] = date.split("-").map(Number);
  return `${day} ${MONTHS[month! - 1]}`;
}

/**
 * A project in today's shape for the 6b.11 page, made by `own` (the client's Admin) through the
 * transition functions: an overdue deliverable, a planned one with its first stage ticked, one
 * reopened with a reason (no date), one closed and one done; three stages each.
 */
async function pageProject(
  clientId: string,
  own: { email: string; password: string },
): Promise<{ projectId: string; ids: Record<string, string> }> {
  const titles = ["Late item", "Soon item", "Reopened item", "Closed item", "Done item"];
  const projectId = await rpcAs<string>(own.email, own.password, "project_create", {
    client_id: clientId,
    name: "Page work",
    recurrence: "monthly",
    stages: ["Stage 1", "Stage 2", "Stage 3"],
    items: titles,
  });
  const ids = Object.fromEntries(
    await Promise.all(titles.map(async (title) => [title, await itemId(projectId, title)])),
  ) as Record<string, string>;
  const call = (fn: string, args: Record<string, unknown>) =>
    rpcAs(own.email, own.password, fn, args);
  await call("item_update", {
    item_id: ids["Late item"],
    changes: { planned_date: addDays(today(), -2) },
  });
  await call("item_update", {
    item_id: ids["Soon item"],
    changes: { planned_date: addDays(today(), 3) },
  });
  const [first] = await serviceSelect<{ id: string }>(
    `project_item_stage_list?item_id=eq.${ids["Soon item"]}&name=eq.Stage%201&select=id`,
  );
  await call("item_stage_tick", { stage_id: first!.id, done: true });
  await call("item_mark_done", { item_id: ids["Reopened item"] });
  await call("item_reopen", { item_id: ids["Reopened item"], reason: "Needs another pass" });
  await call("item_cancel", { item_id: ids["Closed item"], reason: "Not needed" });
  await call("item_mark_done", { item_id: ids["Done item"] });
  return { projectId, ids };
}

test("the project page (6b.11): open first, Planned words, stage chips, the reopened note, the ring moving with a tick, and the miniatures", async ({
  page,
}, info) => {
  const client = nameOf(info, "page");
  const own = ownAdmin(info);
  const clientId = await workClient(client, own.email);
  const { projectId, ids } = await pageProject(clientId, own);
  await page.context().clearCookies();
  await signIn(page, own.email, own.password);
  const here = `/clients/${clientId}/projects/${projectId}`;
  await page.goto(here);
  await hydrated(page);

  // (1) Open ones first, the overdue at the top, then by date, undated last; done and closed
  // collapsed at the end with their count.
  await expect(page.locator('[data-slot="cycle-items"] > [data-slot="item-row"]')).toHaveText([
    /Late item/,
    /Soon item/,
    /Reopened item/,
  ]);
  const toggle = page.locator('[data-slot="finished-toggle"]');
  await expect(toggle).toHaveText("Done and closed (2)");
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(page.locator('[data-slot="finished-items"]')).toHaveCount(0);
  await toggle.click();
  await expect(page.locator('[data-slot="finished-items"] > [data-slot="item-row"]')).toHaveText([
    /Closed item/,
    /Done item/,
  ]);
  // A view control: the address stays as it was.
  await expect(page).toHaveURL(new RegExp(`${here}$`));
  await toggle.click();
  await expect(page.locator('[data-slot="finished-items"]')).toHaveCount(0);
  await expectNoHorizontalScroll(page);

  // (2) Planned: late in the overdue tone, planned, and "Not planned" muted.
  const planned = (title: string) =>
    itemRow(page, title).locator('[data-slot="item-planned"]:visible');
  // A laptop's Planned column drops the word (the approved sample): "15 Oct · 1 day late".
  const word = (page.viewportSize()?.width ?? 1280) >= 1024 ? "" : "Planned ";
  await expect(planned("Late item")).toHaveText(
    `${word}${shortOf(addDays(today(), -2))} · 2 days late`,
  );
  await expect(planned("Late item")).toHaveAttribute("data-tone", "danger");
  // The lateness is a red chip, never red text alone (the design gate, 23 Oct).
  await expect(planned("Late item").locator('[data-slot="badge"][data-tone="danger"]')).toHaveText(
    "2 days late",
  );
  await expect(planned("Soon item")).toHaveText(`${word}${shortOf(addDays(today(), 3))}`);
  await expect(planned("Reopened item")).toHaveText("Not planned");
  await expect(planned("Reopened item")).toHaveAttribute("data-planned", "none");

  // (3) V3 (the long-stage-list fixes A-C, F): the row is collapsed: one bar over every stage,
  // "1/3", with "Next: Stage 2"; the bar opens the row in place (a view control, the address
  // unchanged) to its checklist: ticked, next (bold, outlined), later.
  const soon = itemRow(page, "Soon item");
  const strip = soon.locator('[data-slot="item-progress"]');
  await expect(strip).toHaveCount(1);
  // The approved sample: a line per group (here the untitled "Stages"), its n/m.
  await expect(strip).toHaveText("Stages1/3 ticked");
  await expect(soon.locator('[data-slot="item-progress-bar"]')).toHaveAttribute("data-done", "1");
  await expect(soon.locator('[data-slot="item-progress-bar"]')).toHaveAttribute("data-next", "1");
  await expect(soon.locator('[data-slot="item-progress-bar"]')).toHaveAttribute("data-total", "3");
  await expect(soon.locator('[data-slot="item-next"]:visible')).toHaveText("Next: Stage 2");
  await expect(soon.locator('[data-slot="stage-check"]')).toHaveCount(0);
  await strip.click();
  await expect(strip).toHaveAttribute("aria-expanded", "true");
  const chips = soon.locator('[data-slot="stage-check"]');
  await expect(chips).toHaveText(["Stage 1, ticked", "Stage 2, next", "Stage 3, to do"]);
  expect(await chips.evaluateAll((nodes) => nodes.map((node) => node.dataset.check))).toEqual([
    "ticked",
    "next",
    "later",
  ]);
  // One untitled group: no group heading.
  await expect(soon.locator('[data-slot="item-stage-group-label"]')).toHaveCount(0);
  await expect(page).toHaveURL(new RegExp(`${here}$`));
  await strip.click();
  await expect(chips).toHaveCount(0);
  // Nothing ticked in full yet: Mark done waits in the row's ⋯ (unit U), not on the row.
  await expect(soon.locator('[data-slot="item-row-done"]')).toHaveCount(0);
  await expect(soon.getByRole("button", { name: "More for Soon item" })).toBeVisible();

  // (4) The reopened note: who, when and why, muted with its icon.
  await expect(
    itemRow(page, "Reopened item").locator('[data-slot="item-row-sent-back"]'),
  ).toHaveText(
    `Reopened by Test Client Work Admin (${info.project.name}), ${shortOf(today())}: Needs another pass`,
  );

  // (5) The ring: every stage across the cycle (the done one whole, the closed one left out).
  const line = page.locator('[data-slot="cycle-meter-line"]');
  const percent = page.locator('[data-slot="cycle-percent"]');
  const ring = page.locator('[data-slot="cycle-ring"]');
  await expect(line).toHaveText("4 of 12 stages · 1 of 4 deliverables done");
  await expect(percent).toHaveText("33%");
  await expect(ring).toHaveAttribute("data-done", "4");
  await expect(ring).toHaveAttribute("data-total", "12");
  await expect(page.locator('[data-slot="cycle-pace"]')).toHaveText("1 behind plan");
  await expect(page.locator('[data-slot="cycle-pace"]')).toHaveAttribute("data-tone", "danger");
  // A chip (the design gate, 23 Oct); and green is progress only: the ring's other segments, the
  // open deliverables' next stages and the rest, are grey.
  await expect(
    page.locator('[data-slot="cycle-pace"] [data-slot="badge"][data-tone="danger"]'),
  ).toHaveText("1 behind plan");
  const greens = await ring.locator("circle").evaluateAll((circles) => {
    const stroke = (tone: string) =>
      circles
        .filter((circle) => circle.getAttribute("data-tone") === tone)
        .map((circle) => getComputedStyle(circle).stroke);
    const [done] = stroke("done");
    return [...stroke("next"), ...stroke("rest")].filter((value) => value === done).length;
  });
  expect(greens, "only the done segments are green").toBe(0);
  // The deliverables' bars too: a not-done segment is the ring's neutral next or rest, never green.
  const neutral = await ring
    .locator("circle")
    .evaluateAll((circles) =>
      circles
        .filter((circle) => circle.getAttribute("data-tone") !== "done")
        .map((circle) => getComputedStyle(circle).stroke),
    );
  const barTints = await page
    .locator('[data-slot="item-progress-bar"]:visible > span:not([data-tone="done"])')
    .evaluateAll((segments) =>
      segments.map((segment) => getComputedStyle(segment).backgroundColor),
    );
  expect(barTints.length, "the bars have open segments").toBeGreaterThan(0);
  expect(
    barTints.filter((tint) => !neutral.includes(tint)),
    "the bars' open segments",
  ).toEqual([]);

  // A tick moves it at once, and after a reload.
  await itemRow(page, "Soon item").locator('[data-slot="item-open"]').click();
  const sheet = page.locator('[data-slot="review-sheet"]').filter({ hasText: "Soon item" });
  const second = sheet.getByRole("checkbox", { name: "Stage 2" });
  await second.click();
  await expect(second).toHaveAttribute("aria-checked", "true");
  await page.goBack();
  await expect(sheet).toBeHidden();
  await expect(line).toHaveText("5 of 12 stages · 1 of 4 deliverables done");
  await expect(percent).toHaveText("42%");
  await page.reload();
  await hydrated(page);
  await expect(line).toHaveText("5 of 12 stages · 1 of 4 deliverables done");
  await expect(percent).toHaveText("42%");

  // The miniature on the Projects tab: the same figure.
  await page.goto(`/clients/${clientId}/projects`);
  await hydrated(page);
  const projectRow = page.locator('[data-slot="project-row"]', { hasText: "Page work" });
  await expect(projectRow.locator('[data-slot="project-percent"]')).toHaveText("42%");
  await expect(projectRow.locator('[data-slot="project-meter-bar"]')).toHaveAttribute(
    "data-done",
    "5",
  );

  // Today's Client work and the cross-client list: each deliverable's own stages in miniature,
  // moving with a tick made elsewhere.
  await page.goto("/today");
  await hydrated(page);
  const todayRow = page.locator('[data-slot="today-client-item"]', { hasText: "Late item" });
  await expect(todayRow).toContainText(`Planned ${shortOf(addDays(today(), -2))} · 2 days late`);
  await expect(todayRow.locator('[data-slot="today-item-meter"]')).toHaveAttribute(
    "data-done",
    "0",
  );
  const [lateFirst] = await serviceSelect<{ id: string }>(
    `project_item_stage_list?item_id=eq.${ids["Late item"]}&name=eq.Stage%201&select=id`,
  );
  await rpcAs(own.email, own.password, "item_stage_tick", { stage_id: lateFirst!.id, done: true });
  await page.reload();
  await hydrated(page);
  await expect(todayRow.locator('[data-slot="today-item-meter"]')).toHaveAttribute(
    "data-done",
    "1",
  );
  await page.goto(`/clients/items?client=${clientId}`);
  await hydrated(page);
  const listRow = page.locator('[data-slot="item-list-row"]', { hasText: "Soon item" });
  await expect(listRow.locator('[data-slot="item-list-meter"]')).toHaveAttribute("data-done", "2");
  await expect(listRow.locator('[data-slot="item-list-meter"]')).toHaveAttribute("data-total", "3");
  await expectNoHorizontalScroll(page);
  await removeClientFixture(client);
});

test("the cycle's 100% moment plays once per cycle on this device", async ({ page }, info) => {
  const client = nameOf(info, "complete");
  const own = ownAdmin(info);
  const clientId = await workClient(client, own.email);
  const projectId = await rpcAs<string>(own.email, own.password, "project_create", {
    client_id: clientId,
    name: "Complete work",
    recurrence: "monthly",
    stages: ["Stage 1"],
    items: ["Only item"],
  });
  const [cycle] = await serviceSelect<{ label: string }>(
    `project_cycles?project_id=eq.${projectId}&select=label`,
  );
  await page.context().clearCookies();
  await signIn(page, own.email, own.password);
  await page.goto(`/clients/${clientId}/projects/${projectId}`);
  await hydrated(page);
  await expect(page.locator('[data-slot="cycle-percent"]')).toHaveText("0%");
  await expect(page.locator('[data-slot="cycle-complete"]')).toHaveCount(0);

  await markDoneFromMenu(page, "Only item");
  await flushSends(page);
  await expect(page.locator('[data-slot="cycle-percent"]')).toHaveText("100%");
  const moment = page.locator('[data-slot="cycle-complete"]');
  await expect(moment).toHaveText(`${cycle!.label} complete`);
  await expect(moment).toHaveAttribute("data-celebrated", "now");
  await expect(page.locator('[data-slot="cycle-meter-line"]')).toHaveText(
    "1 of 1 stage · 1 of 1 deliverable done",
  );

  // Once: back on the page it still says so, without playing again.
  await page.reload();
  await hydrated(page);
  await expect(moment).toHaveText(`${cycle!.label} complete`);
  await expect(moment).toHaveAttribute("data-celebrated", "before");
  await removeClientFixture(client);
});

test.describe("the project page's Done and closed group, installed (ARCHITECTURE §14.2)", () => {
  test.beforeEach(({}, info) => {
    test.skip(info.project.name === "desktop", "the phone widths, 375 and 430");
  });

  test("opening and closing the group adds no history; back leaves the page", async ({
    page,
  }, info) => {
    const client = nameOf(info, "finished back");
    const clientId = await workClient(client);
    const projectId = await makeProject(clientId, "Finished reels", {
      items: ["Reel open", "Reel done"],
    });
    await rpcAs(admin.email, admin.password, "item_mark_done", {
      item_id: await itemId(projectId, "Reel done"),
    });
    await runInstalled(page);
    await page.goto("/today");
    await page.goto(`/clients/${clientId}`);
    await hydrated(page);
    await page.locator('[data-slot="client-tabs"]').getByRole("link", { name: "Projects" }).click();
    // L6 (V3): the Overview lists the active projects too; take the row on the Projects tab.
    await expect(page).toHaveURL(new RegExp(`/clients/${clientId}/projects$`));
    await page
      .locator('[data-slot="client-projects"] [data-slot="project-row"]', {
        hasText: "Finished reels",
      })
      .click();
    await expect(page).toHaveURL(new RegExp(`/projects/${projectId}$`));
    await hydrated(page);
    const toggle = page.locator('[data-slot="finished-toggle"]');
    await toggle.click();
    await expect(itemRow(page, "Reel done")).toBeVisible();
    await toggle.click();
    await expect(itemRow(page, "Reel done")).toHaveCount(0);
    await toggle.click();
    await expect(itemRow(page, "Reel done")).toBeVisible();
    await expectNoHorizontalScroll(page);
    await expectBackStack(page, [
      { url: new RegExp(`/clients/${clientId}/projects$`) },
      { url: /\/today$/ },
    ]);
    await removeClientFixture(client);
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
    // L6 (V3): the Overview lists the active projects too; take the row on the Projects tab.
    await expect(page).toHaveURL(new RegExp(`/clients/${clientId}/projects$`));
    await page
      .locator('[data-slot="client-projects"] [data-slot="project-row"]', { hasText: "Back reels" })
      .click();
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
    // Months as tabs (V5a, the v1.8 sample): three cells (the first cycle has no previous tab,
    // its cell kept empty), the shown one current; Details names the client contact and the
    // template (this fixture has neither).
    await expect(page.locator('[data-slot="cycle-switcher"] > *')).toHaveCount(3);
    await expect(page.locator('[data-slot="cycle-switcher"] [aria-current="page"]')).toHaveText(
      "Last month",
    );
    await expect(page.locator('[data-slot="detail-contact"] dd')).toHaveText("Not added");
    await expect(page.locator('[data-slot="detail-template"] dd')).toHaveText("Not added");
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

  test("New project, ⋯ Edit details, Deliverables list, Add deliverable and the item's Edit: back asks before losing typed work", async ({
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

    // Its steps (V5b PP-forms-7): each later step is a layer over the one before, so back returns
    // one step at a time with what was typed intact, never leaving the tab; from step 1 it asks.
    await page.getByRole("button", { name: "New project" }).click();
    await create.getByLabel("Project name").fill("Stepped");
    const onStep = create.locator('[data-slot="new-project-steps"] [aria-current="step"]');
    await newProjectStep(create, 3);
    await page.goBack();
    await expect(onStep).toHaveText(/^2 /);
    await expect(page).toHaveURL(tab);
    await page.goBack();
    await expect(onStep).toHaveText(/^1 /);
    await expect(page).toHaveURL(tab);
    await expect(create.getByLabel("Project name")).toHaveValue("Stepped");
    await expectDiscardOnBack(
      page,
      create,
      "Discard this project?",
      "Discard project",
      create.getByLabel("Project name"),
      "Stepped",
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

    // ⋯ Default stages and Deliverables list: sheets; a name typed and not added asks first.
    await menu.click();
    await page.getByRole("menuitem", { name: "Stages" }).click();
    const stages = page.locator('[data-slot="review-sheet"]', { hasText: "Stages" });
    await expect(stages).toBeVisible();
    await expectBackStack(page, [{ closes: stages, url: here }]);
    await menu.click();
    await page.getByRole("menuitem", { name: "Deliverables list" }).click();
    const list = page.locator('[data-slot="review-sheet"]', { hasText: "Deliverables list" });
    await expect(list).toBeVisible();
    await expectBackStack(page, [{ closes: list, url: here }]);
    await menu.click();
    await page.getByRole("menuitem", { name: "Deliverables list" }).click();
    await list.getByLabel("New deliverable").fill("Reel 2");
    await expectDiscardOnBack(
      page,
      list,
      "Discard what you typed?",
      "Discard changes",
      list.getByLabel("New deliverable"),
      "Reel 2",
      here,
    );

    // A line's own stages (amendment D2): a sheet over the item list; one back each.
    await menu.click();
    await page.getByRole("menuitem", { name: "Deliverables list" }).click();
    await list.getByRole("button", { name: "Stages of Reel" }).click();
    const lineStages = page.getByRole("dialog", { name: "Stages of Reel" });
    // A line from before groups opens as one untitled group; the draft is saved in one change.
    await expect
      .poll(() => valuesOf(lineStages.locator('[data-slot="stage-name"]')))
      .toEqual(["Script"]);
    await lineStages.getByLabel("Add a stage to Stages of Reel").fill("Post");
    await lineStages.getByLabel("Add a stage to Stages of Reel").press("Enter");
    await expect
      .poll(() => valuesOf(lineStages.locator('[data-slot="stage-name"]')))
      .toEqual(["Script", "Post"]);
    await lineStages.getByRole("button", { name: "Save stages" }).click();
    await expect(lineStages).toBeHidden();
    await expect
      .poll(async () => {
        const [line] = await serviceSelect<{ stages: string[] }>(
          `project_item_blueprints?project_id=eq.${projectId}&title=eq.Reel&select=stages`,
        );
        return line?.stages;
      })
      .toEqual(["Script", "Post"]);
    await list.getByRole("button", { name: "Stages of Reel" }).click();
    await expect(lineStages).toBeVisible();
    await expectBackStack(page, [
      { closes: lineStages, url: here },
      { closes: list, url: here },
    ]);

    // Add deliverable.
    await page.getByRole("button", { name: "Add deliverable" }).click();
    const add = page.getByRole("dialog", { name: "Add a deliverable" });
    await expect(add).toBeVisible();
    await expectBackStack(page, [{ closes: add, url: here }]);
    await page.getByRole("button", { name: "Add deliverable" }).click();
    await add.getByLabel("Title").fill("Extra reel");
    await expectDiscardOnBack(
      page,
      add,
      "Discard this deliverable?",
      "Discard deliverable",
      add.getByLabel("Title"),
      "Extra reel",
      here,
    );

    // The item sheet's Edit is a layer of its own (§14.2 f, owner's walk 2026-10-09): back asks
    // over the sheet, back on the confirmation keeps editing, Discard returns to the item's facts,
    // and one more back closes the sheet.
    await itemRow(page, "Reel").locator('[data-slot="item-open"]').click();
    const sheet = page.locator('[data-slot="review-sheet"]');
    await sheet.getByRole("button", { name: "Edit details", exact: true }).click();
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
    await expect(sheet.getByRole("button", { name: "Edit details", exact: true })).toBeVisible();
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
    const edit = sheet.getByRole("button", { name: "Edit details", exact: true });
    const title = sheet.getByLabel("Title");
    const discard = page.getByRole("alertdialog", { name: "Discard your changes?" });
    const onFacts = async (why: string) => {
      await expect(title, why).toHaveCount(0);
      await expect(edit, why).toBeVisible();
    };

    // "Last change · …" and the History clock are one row (PP-sheet-1): the text wraps on its
    // own, the clock (44 px, no word in the sentence) sits at the row's end on the text's line.
    await open();
    const row = sheet.locator('[data-slot="item-last-change"]');
    const history = row.getByRole("button", { name: "History" });
    await expect(row.locator("p")).not.toContainText("History");
    // Measured once the sheet has finished opening: mid-slide its transform leaves the clock a
    // hair under 44 px (43.99997 at 430).
    await animationsSettled(page);
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

  test("the keyboard never covers a sheet's field: Deliverables list, Default stages, the item's Edit and Close…", async ({
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
    await page.getByRole("menuitem", { name: "Deliverables list" }).click();
    const list = page.locator('[data-slot="review-sheet"]', { hasText: "Deliverables list" });
    await expectSheetAboveKeyboard(page, list, list.getByLabel("New deliverable"));
    await expectBackStack(page, [{ closes: list, url: here }]);

    await menu.click();
    await page.getByRole("menuitem", { name: "Default stages" }).click();
    const stages = page.locator('[data-slot="review-sheet"]', { hasText: "Default stages" });
    await expectSheetAboveKeyboard(page, stages, stages.getByLabel("Add a stage", { exact: true }));
    await expectBackStack(page, [{ closes: stages, url: here }]);

    await itemRow(page, "Reel 1").locator('[data-slot="item-open"]').click();
    const sheet = page.locator('[data-slot="review-sheet"]');
    await sheet.getByRole("button", { name: "Edit details", exact: true }).click();
    await expectSheetAboveKeyboard(page, sheet, sheet.getByLabel("Notes"));
    await expectSheetAboveKeyboard(page, sheet, sheet.getByLabel("Title"));
    await page.goBack();
    await expect(sheet.getByLabel("Title")).toHaveCount(0);

    await sheet.getByRole("button", { name: "Close deliverable…" }).click();
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
    // The bulk Tick a stage menu is a layer too, over Select mode (6b.16 (e)), which the next
    // back closes.
    await page.getByRole("button", { name: "Select", exact: true }).click();
    await itemRow(page, "Reel 1").getByRole("checkbox").click();
    await page.getByRole("button", { name: "Tick a stage" }).click();
    const tickMenu = page.getByRole("menu");
    await expect(tickMenu).toBeVisible();
    await expectBackStack(page, [
      { closes: tickMenu, url: here },
      { closes: itemRow(page, "Reel 1").getByRole("checkbox"), url: here },
    ]);

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

  test("Mark done before every stage is ticked: the row's and the sheet's confirmations close on back; the sheet's action is Next (PP-sheet-2)", async ({
    page,
  }, info) => {
    const client = nameOf(info, "early done back");
    const clientId = await workClient(client);
    const projectId = await makeProject(clientId, "Early reels", {
      items: ["Reel 1"],
      stages: ["Script", "Edit"],
    });
    const here = new RegExp(`/projects/${projectId}$`);
    await runInstalled(page);
    await page.goto(`/clients/${clientId}/projects/${projectId}`);
    await hydrated(page);
    const ask = page.getByRole("alertdialog", { name: "Mark Reel 1 done?" });

    // The row's ⋯ → Mark done… → its confirmation: back closes it, then nothing is left open.
    await itemRow(page, "Reel 1").getByRole("button", { name: "More for Reel 1" }).click();
    await page.getByRole("menuitem", { name: "Mark done…" }).click();
    await expect(ask).toContainText("2 stages aren't ticked.");
    await expectBackStack(page, [{ closes: ask, url: here }]);

    // The sheet: Next ticks the stage it names; Mark done waits in its ⋯ behind the same question.
    await itemRow(page, "Reel 1").locator('[data-slot="item-open"]').click();
    const sheet = page.locator('[data-slot="review-sheet"]');
    await expect(sheet.getByRole("button", { name: "Mark done", exact: true })).toHaveCount(0);
    await sheet.getByRole("button", { name: "Next: Script" }).click();
    await expect(sheet.getByRole("checkbox", { name: "Script" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    await expect(sheet.getByRole("button", { name: "Next: Edit" })).toBeVisible();
    await sheet.getByRole("button", { name: "More for Reel 1" }).click();
    await page.getByRole("menuitem", { name: "Mark done…" }).click();
    await expect(ask).toContainText("1 stage isn't ticked.");
    await expectBackStack(page, [
      { closes: ask, url: here },
      { closes: sheet, url: here },
    ]);
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
    await page.getByRole("button", { name: "History" }).click();
    const panel = page.locator('[data-slot="review-sheet"]', {
      has: page.locator('[data-slot="activity-panel"]'),
    });
    await expect(panel.locator('[data-slot="activity-line"]').first()).toBeVisible();
    await panel.getByRole("button", { name: "Deliverables", exact: true }).click();
    await expect(panel.getByRole("button", { name: "Deliverables", exact: true })).toHaveAttribute(
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
    await showFinished(page);
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
    await expect(progress(page)).toHaveText("0 of 4 deliverables done");

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
    await expect(progress(page)).toHaveText("1 of 4 deliverables done");

    // The sheet's Mark done: the sheet closes, the Undo is offered, then it is sent.
    await itemRow(page, "Reel 2").locator('[data-slot="item-open"]').click();
    const sheet = page.locator('[data-slot="review-sheet"]');
    await sheet.getByRole("button", { name: "Mark done", exact: true }).click();
    await expect(sheet).toBeHidden();
    await expect(page.getByText("Marked Reel 2 done")).toBeVisible();
    await flushSends(page);
    const second = await itemId(projectId, "Reel 2");
    await expect.poll(() => itemState(second)).toBe("approved");

    // Mark N done (in Select mode, 6b.16 (e)): a trigger; the confirmation's red button names it.
    await page.getByRole("button", { name: "Select", exact: true }).click();
    await itemRow(page, "Reel 3").getByRole("checkbox").click();
    await itemRow(page, "Reel 4").getByRole("checkbox").click();
    await page.getByRole("button", { name: "Mark 2 done", exact: true }).click();
    const confirm = page.getByRole("alertdialog", { name: "Mark 2 deliverables done?" });
    await expect(confirm).toBeVisible();
    await confirm.getByRole("button", { name: "Mark 2 deliverables done" }).click();
    await expect(confirm).toBeHidden();
    await expect(progress(page)).toHaveText("4 of 4 deliverables done");
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
    await page.getByRole("button", { name: "History" }).click();
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
  await expect(complete).toContainText("1 deliverable is still open");
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
  // W3: the question's way out says "Keep project", never a second "Cancel".
  await expect(cancel.getByRole("button", { name: "Keep project" })).toBeVisible();
  await cancel.getByRole("button", { name: "Cancel project" }).click();
  await expect(page.locator('[data-slot="project-read-only"]')).toContainText("Cancelled");
  // B8: the progress says it was cancelled and what it holds (the done one stays done), never
  // "No deliverables in this cycle".
  await expect(page.locator('[data-slot="cycle-meter-line"]')).toHaveText(
    /^Cancelled \d{1,2} [A-Z][a-z]{2} · 1 deliverable done$/,
  );

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

test("a project template in today's shape starts a New project: its stages and deliverables", async ({
  page,
}, info) => {
  test.skip(info.project.name === "mobile-lg", "the 375 and desktop runs cover the flow");
  const name = nameOf(info, "template");
  await serviceRest(`project_templates?name=eq.${encodeURIComponent(name)}`, {
    method: "DELETE",
  });
  const client = nameOf(info, "from template");
  const clientId = await workClient(client);
  // A template as the team made them before groups: shared stages and an item list of names.
  const [org] = await serviceSelect<{ id: string }>("organizations?select=id&limit=1");
  await serviceInsert("project_templates", {
    org_id: org?.id,
    name,
    recurrence: "monthly",
    stages: ["Script", "Edit"],
    items: ["Item 1", "Item 2"],
    created_by: await memberIdOf(admin.email),
  });

  await page.goto(`/clients/${clientId}/projects`);
  await hydrated(page);
  await page.getByRole("button", { name: "New project" }).click();
  const create = page.getByRole("dialog", { name: "New project" });
  // One "Start from a template" button opens the library (V5b PP-forms-7).
  await create.getByRole("button", { name: "Start from a template" }).click();
  const library = page.getByRole("dialog", { name: "Start from a template" });
  await library.getByRole("button", { name: `Preview ${name}` }).click();
  await page.getByRole("button", { name: "Use this template" }).click();
  await expect(library).toBeHidden();
  await create.getByLabel("Project name").fill("From the template");
  // Its stages are the one untitled default group; its items the deliverables, on the defaults.
  await newProjectStep(create, 2);
  await expect
    .poll(() => valuesOf(create.locator('[data-slot="stage-name"]')))
    .toEqual(["Script", "Edit"]);
  await expect(create.locator('[data-slot="deliverable-title"]')).toHaveText(["Item 1", "Item 2"]);
  await createFromDialog(page, create);
  await expect(page).toHaveURL(new RegExp(`/clients/${clientId}/projects/[0-9a-f-]{36}$`));
  await expect(progress(page)).toHaveText("0 of 4 stages · 0 of 2 deliverables done");
  const projectId = await projectOf(clientId);
  const stages = await serviceSelect<{ name: string; group_label: string | null }>(
    `project_item_stage_list?item_id=eq.${await itemId(projectId, "Item 1")}&select=name,group_label&order=position`,
  );
  expect(stages).toEqual([
    { name: "Script", group_label: null },
    { name: "Edit", group_label: null },
  ]);
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
    await page.goto("/settings/templates#presets");
    await hydrated(page);
    const here = /\/settings\/templates#presets$/;
    await page.getByRole("button", { name: "Add preset" }).click();
    const add = page.getByRole("dialog", { name: "Add a stage preset" });
    await expect(add).toBeVisible();
    await expectBackStack(page, [{ closes: add, url: here }]);
    const row = page.locator('[data-slot="stage-preset"]', { hasText: name });
    // A phone row's Edit and Archive are in its ⋯ sheet (C4/P2: one 44px target per row).
    await row.getByRole("button", { name: `Actions for ${name}` }).click();
    const sheet = page.locator('[data-slot="stage-preset-actions"]');
    await expect(sheet).toBeVisible();
    await expectBackStack(page, [{ closes: sheet, url: here }]);
    // PP-templates-1: a preset's Preview, as every template row's, is a layer back closes.
    await row.getByRole("button", { name: `Preview ${name}` }).click();
    const preview = page.getByRole("dialog", { name: `Preview ${name}` });
    await expect(preview).toContainText("Brief");
    await expectBackStack(page, [{ closes: preview, url: here }]);
    await rowAction(page, row, name, "Edit");
    const edit = page.getByRole("dialog", { name: `Edit ${name}` });
    await expect(edit).toBeVisible();
    await expectBackStack(page, [{ closes: edit, url: here }]);
    await rowAction(page, row, name, "Archive");
    const archive = page.getByRole("alertdialog");
    await expect(archive).toBeVisible();
    await expectBackStack(page, [{ closes: archive, url: here }]);
    await serviceRest(`stage_presets?name=eq.${encodeURIComponent(name)}`, { method: "DELETE" });
  });

  test("the project template dialog closes on back, and asks before losing typed work", async ({
    page,
  }) => {
    await runInstalled(page);
    await page.goto("/settings/templates#projects");
    await hydrated(page);
    const here = /\/settings\/templates#projects$/;
    await page.getByRole("button", { name: "Add project template" }).click();
    const dialog = page.getByRole("dialog", { name: "Add a project template" });
    await expect(dialog).toBeVisible();
    await expectBackStack(page, [{ closes: dialog, url: here }]);
    await page.getByRole("button", { name: "Add project template" }).click();
    await dialog.getByLabel("Name", { exact: true }).fill("Half a template");
    await expectDiscardOnBack(
      page,
      dialog,
      "Discard this template?",
      "Discard template",
      dialog.getByLabel("Name", { exact: true }),
      "Half a template",
      here,
    );
  });
});
