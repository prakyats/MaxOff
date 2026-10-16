import type { Page, TestInfo } from "@playwright/test";

import { expect, test } from "./fixtures";
import {
  expectBackStack,
  expectNoHorizontalScroll,
  hydrated,
  memberIdOf,
  removeClientFixture,
  rpcAs,
  runInstalled,
  serviceInsert,
  serviceSelect,
  storageStateFor,
  USERS,
} from "./helpers";
import { istDate, wallClock } from "./run-state";

/**
 * Release 2 (v1.7.1; ROADMAP 6b.16 (c)(d)(e)(g); migration `client_work_bulk_and_rounds`): "+
 * Another revision round" on one deliverable; "Keep this month's extra deliverables next month?"
 * at the month's end (the ended cycle seeded directly); Select mode on the cycle's list (its
 * checkboxes only while on) and each bulk edit (set and move planned dates, add a stage group,
 * rename by a pattern with its preview); "Copy schedule as text" read back from the clipboard; and
 * the back order of Select mode and every new sheet, installed at 375 and 430 px (ARCHITECTURE
 * §14.2). Projects are made the old way (`project_create`, plain stages): today's data shape.
 * Nothing is pre-defined: every name is neutral and made here.
 */

const admin = USERS.admin;
const owner = USERS.owner;
const nameOf = (info: TestInfo, what: string) => `DB ${what} (${info.project.name})`;

test.use({ storageState: storageStateFor("admin") });

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

/** A monthly project in today's shape: plain stages, its deliverables from the list. */
async function project(clientId: string, name: string, items: string[]): Promise<string> {
  return rpcAs<string>(admin.email, admin.password, "project_create", {
    client_id: clientId,
    name,
    recurrence: "monthly",
    stages: ["Stage 1"],
    items,
  });
}

async function itemId(projectId: string, title: string): Promise<string> {
  const [row] = await serviceSelect<{ id: string }>(
    `project_items?project_id=eq.${projectId}&title=eq.${encodeURIComponent(title)}&select=id`,
  );
  return row?.id ?? "";
}

/** A project's deliverables by title, in the list's order, with their planned dates. */
async function itemsOf(
  projectId: string,
): Promise<{ title: string; planned_date: string | null }[]> {
  return serviceSelect(
    `project_items?project_id=eq.${projectId}&select=title,planned_date&order=position`,
  );
}

/** An item's active stages as "Group · Stage" (the untitled group plain), ticked ones with ✓. */
async function stagesOf(id: string): Promise<string[]> {
  const rows = await serviceSelect<{
    name: string;
    group_label: string | null;
    group_position: string | null;
    position: string;
    done_at: string | null;
  }>(`project_item_stage_list?item_id=eq.${id}&archived_at=is.null&select=*`);
  const key = (row: (typeof rows)[number]) =>
    `${row.group_label === null ? "0" : `1${row.group_position}`}|${row.position}`;
  return rows
    .sort((a, b) => (key(a) < key(b) ? -1 : 1))
    .map(
      (row) =>
        `${row.group_label === null ? "" : `${row.group_label} · `}${row.name}${row.done_at ? " ✓" : ""}`,
    );
}

const rows = (page: Page) => page.locator('[data-slot="item-row"]');
const boxes = (page: Page) => page.locator('[data-slot="item-row"] [role="checkbox"]');
const row = (page: Page, title: string) =>
  page.locator('[data-slot="item-row"]', { has: page.getByText(title, { exact: true }) });

test("+ Another revision round names the next round after the deliverable's own, ticks kept", async ({
  page,
}, info) => {
  test.skip(info.project.name === "mobile-lg", "the 375 and desktop runs cover the flow");
  const client = nameOf(info, "round");
  const clientId = await workClient(client);
  const projectId = await project(clientId, "Round work", ["Item 1"]);
  const id = await itemId(projectId, "Item 1");
  await rpcAs(admin.email, admin.password, "item_stage_group_add", {
    item_id: id,
    label: "Review",
    stages: ["Revision 1"],
  });
  const [tick] = await serviceSelect<{ id: string }>(
    `project_item_stage_list?item_id=eq.${id}&name=eq.Stage%201&select=id`,
  );
  await rpcAs(admin.email, admin.password, "item_stage_tick", { stage_id: tick!.id, done: true });

  await page.goto(`/clients/${clientId}/projects/${projectId}`);
  await hydrated(page);
  await row(page, "Item 1").locator('[data-slot="item-open"]').click();
  const sheet = page.locator('[data-slot="review-sheet"]').filter({ hasText: "Item 1" });
  await sheet.getByRole("button", { name: "More for Item 1" }).click();
  await page.getByRole("menuitem", { name: "Another revision round" }).click();
  await expect(page.getByText("Added Revision 2")).toBeVisible();
  await expect
    .poll(() => stagesOf(id))
    .toEqual(["Stage 1 ✓", "Review · Revision 1", "Review · Revision 2"]);
  await expect(sheet.getByRole("checkbox", { name: "Revision 2" })).toBeVisible();
  await removeClientFixture(client);
});

test("Keep this month's extra deliverables next month? Yes adds them to the deliverables list", async ({
  page,
}, info) => {
  test.skip(info.project.name === "mobile-lg", "the 375 and desktop runs cover the flow");
  const client = nameOf(info, "extras");
  const clientId = await workClient(client);
  const projectId = await project(clientId, "Extras work", ["Item 1"]);
  // A month that ended yesterday (IST), as the nightly run leaves it: one deliverable from the
  // list, one added during the month with a stage of its own.
  const today = istDate(wallClock());
  const end = new Date(`${today}T00:00:00Z`);
  end.setUTCDate(end.getUTCDate() - 1);
  const periodEnd = end.toISOString().slice(0, 10);
  const start = new Date(`${today.slice(0, 8)}01T00:00:00Z`);
  start.setUTCMonth(start.getUTCMonth() - 1);
  const [projectRow] = await serviceSelect<{ org_id: string }>(
    `projects?id=eq.${projectId}&select=org_id`,
  );
  const cycle = await serviceInsert<{ id: string }>("project_cycles", {
    org_id: projectRow?.org_id,
    project_id: projectId,
    period_start: start.toISOString().slice(0, 10),
    period_end: periodEnd,
    label: "Seeded month",
    generated_by: "schedule",
  });
  const by = await memberIdOf(admin.email);
  for (const [position, title] of [
    ["a0", "Item 1"],
    ["a1", "Extra A"],
  ] as const) {
    const item = await serviceInsert<{ id: string }>("project_items", {
      org_id: projectRow?.org_id,
      project_id: projectId,
      cycle_id: cycle.id,
      origin_cycle_id: cycle.id,
      title,
      position,
      created_by: by,
    });
    await serviceInsert("project_item_stage_list", {
      org_id: projectRow?.org_id,
      project_id: projectId,
      item_id: item.id,
      name: title === "Extra A" ? "Own stage" : "Stage 1",
      position: "a0",
    });
  }

  await page.goto(`/clients/${clientId}/projects/${projectId}`);
  await hydrated(page);
  const card = page.locator('[data-slot="keep-extras"]');
  await expect(card).toContainText("Keep Seeded month's extra deliverables next month?");
  await expect(card.locator('[data-slot="keep-extras-titles"]')).toHaveText(
    "Extra A. Added this cycle, not on the deliverables list.",
  );
  await expectNoHorizontalScroll(page);
  await card.getByRole("button", { name: "Yes, keep it" }).click();
  await expect(page.getByText(/^1 deliverable added to the deliverables list/)).toBeVisible();
  await expect(card).toBeHidden();
  const lines = await serviceSelect<{ title: string; stage_groups: unknown }>(
    `project_item_blueprints?project_id=eq.${projectId}&archived_at=is.null&select=title,stage_groups&order=position`,
  );
  expect(lines.map((line) => line.title)).toEqual(["Item 1", "Extra A"]);
  expect(lines[1]?.stage_groups).toEqual([{ label: null, stages: ["Own stage"] }]);
  // Asked once: it does not come back.
  await page.reload();
  await hydrated(page);
  await expect(page.locator('[data-slot="cycle-items"]')).toBeVisible();
  await expect(card).toHaveCount(0);
  await removeClientFixture(client);
});

test("Select mode shows the checkboxes, and each bulk edit changes the selected deliverables", async ({
  page,
}, info) => {
  test.skip(info.project.name === "mobile-lg", "the 375 and desktop runs cover the flow");
  const client = nameOf(info, "bulk");
  const clientId = await workClient(client);
  const projectId = await project(clientId, "Bulk work", ["Item 1", "Item 2", "Item 3"]);
  await page.goto(`/clients/${clientId}/projects/${projectId}`);
  await hydrated(page);
  await expect(rows(page)).toHaveCount(3);
  // No checkbox until Select.
  await expect(boxes(page)).toHaveCount(0);
  await page.getByRole("button", { name: "Select", exact: true }).click();
  await expect(boxes(page)).toHaveCount(3);
  await page.getByRole("checkbox", { name: "Select Item 1" }).click();
  await page.getByRole("checkbox", { name: "Select Item 2" }).click();
  const bar = page.locator('[data-slot="bulk-bar"]');
  await expect(bar).toContainText("2 selected");
  // The earlier bulk actions are in the same bar.
  await expect(bar.getByRole("button", { name: "Mark 2 done" })).toBeVisible();
  await expect(bar.getByRole("button", { name: "Tick a stage" })).toBeVisible();

  const edit = async (label: string) => {
    await bar.getByRole("button", { name: "Edit 2" }).click();
    await page.getByRole("menuitem", { name: label }).click();
  };
  const sheet = page.locator('[data-slot="bulk-edit-sheet"]');

  // Set planned date.
  await edit("Set planned date…");
  await sheet.getByLabel("Planned date").fill("2030-01-25");
  await sheet.getByRole("button", { name: "Plan 2 deliverables" }).click();
  await expect(page.getByText("Planned 2 deliverables for Fri 25 Jan")).toBeVisible();
  await expect(sheet).toBeHidden();
  await expect
    .poll(() => itemsOf(projectId))
    .toEqual([
      { title: "Item 1", planned_date: "2030-01-25" },
      { title: "Item 2", planned_date: "2030-01-25" },
      { title: "Item 3", planned_date: null },
    ]);

  // Move planned dates: 10 days later, across the month.
  await edit("Move planned dates…");
  await sheet.getByLabel("By how many days").fill("10");
  await sheet.getByRole("button", { name: "Later" }).click();
  await sheet.getByRole("button", { name: "Move 2 deliverables" }).click();
  await expect(page.getByText("Moved 2 deliverables 10 days later")).toBeVisible();
  await expect
    .poll(async () => (await itemsOf(projectId)).map((item) => item.planned_date))
    .toEqual(["2030-02-04", "2030-02-04", null]);

  // Add a stage group, typed.
  await edit("Add a stage group…");
  await sheet.getByRole("button", { name: "Add a group" }).click();
  await sheet.getByRole("textbox", { name: "New group", exact: true }).fill("Phase A");
  await sheet.getByLabel("Stages of the new group").fill("One\nTwo");
  await sheet.getByRole("button", { name: "Add group", exact: true }).click();
  await sheet.getByRole("button", { name: "Add to 2 deliverables" }).click();
  await expect(page.getByText("Phase A added to 2 deliverables")).toBeVisible();
  for (const title of ["Item 1", "Item 2"]) {
    await expect
      .poll(async () => stagesOf(await itemId(projectId, title)))
      .toEqual(["Stage 1", "Phase A · One", "Phase A · Two"]);
  }
  expect(await stagesOf(await itemId(projectId, "Item 3"))).toEqual(["Stage 1"]);

  // Rename by a pattern: the preview first, in the list's order.
  await edit("Rename…");
  await sheet.getByLabel("New name", { exact: true }).fill("Piece {n}");
  await expect(sheet.locator('[data-slot="rename-preview-row"]')).toHaveText([
    "Item 1→Piece 1",
    "Item 2→Piece 2",
  ]);
  await sheet.getByLabel("Start at").fill("4");
  await expect(sheet.locator('[data-slot="rename-preview-row"]')).toHaveText([
    "Item 1→Piece 4",
    "Item 2→Piece 5",
  ]);
  await sheet.getByLabel("New name", { exact: true }).fill("Same");
  await expect(sheet.getByText("Add {n} so each deliverable gets its own number.")).toBeVisible();
  await sheet.getByLabel("New name", { exact: true }).fill("Piece {n}");
  await sheet.getByRole("button", { name: "Rename 2 deliverables" }).click();
  await expect(page.getByText("Renamed 2 deliverables")).toBeVisible();
  await expect
    .poll(async () => (await itemsOf(projectId)).map((item) => item.title))
    .toEqual(["Piece 4", "Piece 5", "Item 3"]);

  // Done leaves Select mode: the checkboxes go.
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await expect(boxes(page)).toHaveCount(0);
  await expect(bar).toBeHidden();
  await removeClientFixture(client);
});

test("a bulk edit is all or nothing: a done deliverable in the selection stops it, named", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "desktop", "one run is enough: the rule is the database's");
  const client = nameOf(info, "bulk refused");
  const clientId = await workClient(client);
  const projectId = await project(clientId, "Refused work", ["Item 1", "Item 2"]);
  await page.goto(`/clients/${clientId}/projects/${projectId}`);
  await hydrated(page);
  await page.getByRole("button", { name: "Select", exact: true }).click();
  await page.getByRole("checkbox", { name: "Select Item 1" }).click();
  await page.getByRole("checkbox", { name: "Select Item 2" }).click();
  // Done elsewhere meanwhile (another device): the page still shows it open.
  await rpcAs(admin.email, admin.password, "item_mark_done", {
    item_id: await itemId(projectId, "Item 2"),
  });
  await page.locator('[data-slot="bulk-bar"]').getByRole("button", { name: "Edit 2" }).click();
  await page.getByRole("menuitem", { name: "Set planned date…" }).click();
  const sheet = page.locator('[data-slot="bulk-edit-sheet"]');
  await sheet.getByLabel("Planned date").fill("2030-01-25");
  await sheet.getByRole("button", { name: "Plan 2 deliverables" }).click();
  await expect(sheet.locator('[data-slot="form-alert"]')).toContainText(
    "Item 2 is done: only open deliverables change together.",
  );
  expect((await itemsOf(projectId)).map((item) => item.planned_date)).toEqual([null, null]);
  await removeClientFixture(client);
});

test("Copy schedule as text puts the month on the clipboard, grouped by date", async ({
  page,
  context,
}, info) => {
  test.skip(info.project.name === "mobile-lg", "the 375 and desktop runs cover the flow");
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const client = nameOf(info, "schedule");
  const clientId = await workClient(client);
  const projectId = await project(clientId, "Schedule work", ["Item 1", "Item 2", "Item 3"]);
  await rpcAs(admin.email, admin.password, "items_set_planned_date", {
    item_ids: [await itemId(projectId, "Item 1")],
    planned_date: "2030-01-17",
  });
  await rpcAs(admin.email, admin.password, "items_set_planned_date", {
    item_ids: [await itemId(projectId, "Item 2")],
    planned_date: "2030-01-15",
  });
  const [cycle] = await serviceSelect<{ label: string }>(
    `project_cycles?project_id=eq.${projectId}&select=label`,
  );
  await page.goto(`/clients/${clientId}/projects/${projectId}`);
  await hydrated(page);
  await page.getByRole("button", { name: "Actions for Schedule work" }).click();
  await page.getByRole("menuitem", { name: "Copy schedule as text" }).click();
  await expect(page.getByText("Schedule copied: paste it into WhatsApp")).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    [
      `*Schedule work · ${cycle?.label}*`,
      "Tue 15 Jan\n• Item 2",
      "Thu 17 Jan\n• Item 1",
      "Not planned yet\n• Item 3",
    ].join("\n\n"),
  );
  await removeClientFixture(client);
});

test.describe("Select mode and the bulk sheets, installed (ARCHITECTURE §14.2)", () => {
  test.beforeEach(({}, info) => {
    test.skip(info.project.name === "desktop", "the phone widths, 375 and 430");
  });

  test("back closes each bulk sheet, then Select mode, and never leaves the page", async ({
    page,
  }, info) => {
    const client = nameOf(info, "layers");
    const clientId = await workClient(client);
    const projectId = await project(clientId, "Layer work", ["Item 1", "Item 2"]);
    const here = new RegExp(`/projects/${projectId}$`);
    await runInstalled(page);
    await page.goto(`/clients/${clientId}/projects/${projectId}`);
    await hydrated(page);

    // Select mode alone: one back leaves it, the page stays.
    await page.getByRole("button", { name: "Select", exact: true }).click();
    await expect(boxes(page)).toHaveCount(2);
    await expectBackStack(page, [{ closes: boxes(page).first(), url: here }]);
    await expect(boxes(page)).toHaveCount(0);
    await expect(rows(page)).toHaveCount(2);

    // Each sheet over Select mode: back closes the sheet, Select mode stays.
    await page.getByRole("button", { name: "Select", exact: true }).click();
    await page.getByRole("checkbox", { name: "Select Item 1" }).click();
    const bar = page.locator('[data-slot="bulk-bar"]');
    const sheet = page.locator('[data-slot="bulk-edit-sheet"]');
    for (const label of [
      "Set planned date…",
      "Move planned dates…",
      "Add a stage group…",
      "Rename…",
    ]) {
      await bar.getByRole("button", { name: "Edit 1" }).click();
      await page.getByRole("menuitem", { name: label }).click();
      await expect(sheet).toBeVisible();
      await expectNoHorizontalScroll(page);
      await expectBackStack(page, [{ closes: sheet, url: here }]);
      await expect(page.getByRole("checkbox", { name: "Select Item 1" })).toBeChecked();
    }
    // Then Select mode, then nothing is left open.
    await expectBackStack(page, [{ closes: boxes(page).first(), url: here }]);
    await expect(bar).toBeHidden();
    await removeClientFixture(client);
  });
});
