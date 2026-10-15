import type { Locator, Page, TestInfo } from "@playwright/test";

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
  serviceRest,
  serviceSelect,
  storageStateFor,
  USERS,
} from "./helpers";
import { istDate, wallClock } from "./run-state";

/**
 * Deliverables and stage groups (6b Release 1, v1.7.0; ROADMAP 6b.13, 6b.16 (a)(b), 6b.18;
 * DATA-MODEL §5b): (a) New project from three stage presets, six deliverables × 3 groups in a few
 * taps, a stage dragged, the live preview, Create, and "Start next cycle" repeating the
 * deliverables with their groups; (b) a project in **today's shape** (made through
 * `project_create` with plain stages, a tick, a planned date and a note) taking a group, a drag
 * and a named default group without losing a tick, a date, a note or a history row; (c) the back
 * order of every new layer, installed at 375 and 430 px (ARCHITECTURE §14.2).
 *
 * Nothing is pre-defined: every preset, group, stage and deliverable has a neutral name made
 * here. Each client and preset is named for its test and project and removed first.
 */

const admin = USERS.admin;
const owner = USERS.owner;
const nameOf = (info: TestInfo, what: string) => `DL ${what} (${info.project.name})`;

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

/** A stage preset of the Admin's own, removed first. */
async function preset(name: string, stages: string[]): Promise<void> {
  await serviceRest(`stage_presets?name=eq.${encodeURIComponent(name)}`, { method: "DELETE" });
  const [org] = await serviceSelect<{ id: string }>("organizations?select=id&limit=1");
  await serviceInsert("stage_presets", {
    org_id: org?.id,
    name,
    stages,
    created_by: await memberIdOf(admin.email),
  });
}

async function removePresets(names: readonly string[]): Promise<void> {
  for (const name of names) {
    await serviceRest(`stage_presets?name=eq.${encodeURIComponent(name)}`, { method: "DELETE" });
  }
}

/** The client's newest project. */
async function projectOf(clientId: string): Promise<string> {
  const [row] = await serviceSelect<{ id: string }>(
    `projects?client_id=eq.${clientId}&select=id&order=created_at.desc&limit=1`,
  );
  return row?.id ?? "";
}

type StageRow = {
  id: string;
  name: string;
  group_label: string | null;
  group_position: string | null;
  position: string;
  done_at: string | null;
  done_by: string | null;
  archived_at: string | null;
};

/** An item's active stages in the screens' order ("Group · Stage", untitled plain). */
async function stagesOf(itemId: string): Promise<string[]> {
  const rows = await serviceSelect<StageRow>(
    `project_item_stage_list?item_id=eq.${itemId}&archived_at=is.null&select=*`,
  );
  return rows
    .sort(
      (a, b) =>
        Number(b.group_label === null) - Number(a.group_label === null) ||
        cmp(a.group_position ?? "", b.group_position ?? "") ||
        cmp(a.position, b.position),
    )
    .map((row) => (row.group_label === null ? row.name : `${row.group_label} · ${row.name}`));
}

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** A cycle's items, in their order. */
async function itemsOf(cycleId: string): Promise<{ id: string; title: string }[]> {
  return serviceSelect<{ id: string; title: string }>(
    `project_items?cycle_id=eq.${cycleId}&select=id,title&order=position`,
  );
}

/**
 * Drags the row `from` by its handle onto the row `onto`, at `at` of its height (past its middle
 * it lands after it, above its middle before it). A mouse drags at once; a touch would need the long press. Measures only visible
 * boxes and fails on a missing one.
 */
async function drag(page: Page, from: Locator, onto: Locator, at = 0.8): Promise<void> {
  const handle = from.locator('[data-slot="reorder-handle"]').first();
  const start = await handle.boundingBox();
  const target = await onto.boundingBox();
  expect(start, "the drag handle has a box").not.toBeNull();
  expect(target, "the target row has a box").not.toBeNull();
  const x = start!.x + start!.width / 2;
  await page.mouse.move(x, start!.y + start!.height / 2);
  await page.mouse.down();
  await page.mouse.move(x, target!.y + target!.height * at, { steps: 12 });
  await page.mouse.up();
}

/** Create in the New project dialog: a phone goes through its Preview step first. */
async function createFromDialog(page: Page, dialog: Locator): Promise<void> {
  if ((page.viewportSize()?.width ?? 1280) < 768) {
    await dialog.getByRole("button", { name: "Preview", exact: true }).click();
    await expect(dialog.locator('[data-slot="deliverables-preview"]:visible')).toBeVisible();
  }
  await dialog.getByRole("button", { name: "Create project" }).click();
}

test("New project: six deliverables × three preset groups, a drag, the preview, and the next cycle repeats them", async ({
  page,
}, info) => {
  test.skip(info.project.name === "mobile-lg", "the 375 and desktop runs cover the flow");
  const client = nameOf(info, "build");
  const presets = [nameOf(info, "Phase A"), nameOf(info, "Phase B"), nameOf(info, "Phase C")];
  await preset(presets[0]!, ["A1", "A2", "A3"]);
  await preset(presets[1]!, ["B1", "B2"]);
  await preset(presets[2]!, ["C1"]);
  const clientId = await workClient(client);
  await page.goto(`/clients/${clientId}/projects`);
  await hydrated(page);

  await page.getByRole("button", { name: "New project" }).click();
  const dialog = page.getByRole("dialog", { name: "New project" });
  await dialog.getByLabel("Project name").fill("Weekly set");
  await dialog.getByRole("combobox", { name: "Repeats" }).click();
  await page.getByRole("option", { name: "Weekly" }).click();
  // "Item" × 6, each with the three presets as its groups, in the order ticked.
  await dialog.getByLabel("Deliverable name").fill("Item");
  await dialog.getByLabel("How many").fill("6");
  const add = dialog.locator('[data-slot="add-deliverables"]');
  for (const name of presets) await add.getByLabel(name).check();
  await add.getByRole("button", { name: "Add", exact: true }).click();
  await expect(dialog.locator('[data-slot="deliverable-title"]')).toHaveText([
    "Item 1",
    "Item 2",
    "Item 3",
    "Item 4",
    "Item 5",
    "Item 6",
  ]);

  // Item 1: drag its first stage below the second.
  await dialog.locator('[data-slot="deliverable-toggle"]').first().click();
  const body = dialog.locator('[data-slot="deliverable-body"]');
  const rows = body.locator('[data-slot="stage-row"]');
  await expect(rows.first().locator('[data-slot="stage-name"]')).toHaveValue("A1");
  await drag(page, rows.nth(0), rows.nth(1));
  await expect(body.locator('[data-slot="stage-name"]')).toHaveValues([
    "A2",
    "A1",
    "A3",
    "B1",
    "B2",
    "C1",
  ]);

  // The live preview counts what Create makes (beside the form, or on the phone's step).
  if ((page.viewportSize()?.width ?? 1280) >= 768) {
    await expect(dialog.locator('[data-slot="preview-counts"]:visible')).toHaveText(
      "6 deliverables · 36 stages",
    );
  } else {
    await dialog.getByRole("button", { name: "Preview", exact: true }).click();
    await expect(dialog.locator('[data-slot="preview-counts"]:visible')).toHaveText(
      "6 deliverables · 36 stages",
    );
    await dialog.getByRole("button", { name: "Back to edit" }).click();
  }
  await createFromDialog(page, dialog);
  await expect(page).toHaveURL(new RegExp(`/clients/${clientId}/projects/[0-9a-f-]{36}$`));
  await hydrated(page);

  const projectId = await projectOf(clientId);
  const [first] = await serviceSelect<{ id: string }>(
    `project_cycles?project_id=eq.${projectId}&select=id&order=period_start`,
  );
  const items = await itemsOf(first!.id);
  expect(items.map((item) => item.title)).toEqual([
    "Item 1",
    "Item 2",
    "Item 3",
    "Item 4",
    "Item 5",
    "Item 6",
  ]);
  const [a, b, c] = presets;
  expect(await stagesOf(items[0]!.id)).toEqual([
    `${a} · A2`,
    `${a} · A1`,
    `${a} · A3`,
    `${b} · B1`,
    `${b} · B2`,
    `${c} · C1`,
  ]);
  const plain = [`${a} · A1`, `${a} · A2`, `${a} · A3`, `${b} · B1`, `${b} · B2`, `${c} · C1`];
  expect(await stagesOf(items[1]!.id)).toEqual(plain);

  // The sheet shows each group under its heading with its own count.
  await page
    .locator('[data-slot="item-row"]', { hasText: "Item 1" })
    .locator('[data-slot="item-open"]')
    .click();
  const sheet = page.locator('[data-slot="review-sheet"]').filter({ hasText: "Item 1" });
  await expect(sheet.locator('[data-slot="item-stage-group-heading"]')).toHaveText([
    `${a}0/3`,
    `${b}0/2`,
    `${c}0/1`,
  ]);
  await page.goBack();
  await expect(sheet).toBeHidden();

  // "Start next cycle" repeats the deliverables with their groups, the drag included.
  await page.getByRole("button", { name: "Actions for Weekly set" }).click();
  const start = page.getByRole("menuitem", { name: /^Start / });
  const label = ((await start.textContent()) ?? "").replace(/^Start /, "");
  await start.click();
  await page
    .getByRole("alertdialog", { name: `Start ${label} now?` })
    .getByRole("button", { name: `Start ${label}` })
    .click();
  await expect(page.getByText(`${label} started`)).toBeVisible();
  const cycles = await serviceSelect<{ id: string }>(
    `project_cycles?project_id=eq.${projectId}&select=id&order=period_start`,
  );
  expect(cycles).toHaveLength(2);
  const next = await itemsOf(cycles[1]!.id);
  expect(next.map((item) => item.title)).toEqual(items.map((item) => item.title));
  expect(await stagesOf(next[0]!.id)).toEqual(await stagesOf(items[0]!.id));
  expect(await stagesOf(next[1]!.id)).toEqual(plain);

  await removeClientFixture(client);
  await removePresets(presets);
});

test("today's shape: a group, a drag and a named default group keep every tick, date, note and history row", async ({
  page,
}, info) => {
  test.skip(info.project.name === "mobile-lg", "the 375 and desktop runs cover the flow");
  const client = nameOf(info, "today shape");
  const clientId = await workClient(client);
  // As the team's projects are: plain stages, deliverables with a tick, a date and a note.
  const projectId = await rpcAs<string>(admin.email, admin.password, "project_create", {
    client_id: clientId,
    name: "Existing work",
    recurrence: "monthly",
    stages: ["Script", "Edit"],
    items: ["Item 1", "Item 2"],
  });
  const [one] = await serviceSelect<{ id: string }>(
    `project_items?project_id=eq.${projectId}&title=eq.Item%201&select=id`,
  );
  const itemId = one!.id;
  const [script] = await serviceSelect<{ id: string }>(
    `project_item_stage_list?item_id=eq.${itemId}&name=eq.Script&select=id`,
  );
  await rpcAs(admin.email, admin.password, "item_stage_tick", {
    stage_id: script!.id,
    done: true,
  });
  const at = new Date(`${istDate(wallClock())}T00:00:00Z`);
  at.setUTCDate(at.getUTCDate() + 10);
  const planned = at.toISOString().slice(0, 10);
  await rpcAs(admin.email, admin.password, "item_update", {
    item_id: itemId,
    changes: { planned_date: planned, notes: "Kept as it is" },
  });

  const stageColumns = "id,item_id,name,done_at,done_by,group_label,archived_at";
  const stagesBefore = await serviceSelect<StageRow & { item_id: string }>(
    `project_item_stage_list?project_id=eq.${projectId}&select=${stageColumns}&order=id`,
  );
  const itemsBefore = await serviceSelect<Record<string, unknown>>(
    `project_items?project_id=eq.${projectId}&select=id,title,planned_date,notes,state&order=id`,
  );
  const ids = [...stagesBefore.map((row) => row.id), ...itemsBefore.map((row) => row.id)];
  const activity = `activity_log?entity_id=in.(${ids.join(",")})&select=id,entity,entity_id,action,diff,meta,at&order=id`;
  const historyBefore = await serviceSelect<{ id: number }>(activity);
  expect(stagesBefore.every((row) => row.group_label === null)).toBe(true);

  await page.goto(`/clients/${clientId}/projects/${projectId}`);
  await hydrated(page);
  const row = (title: string) => page.locator('[data-slot="item-row"]', { hasText: title });
  // The old rows are one untitled group: no heading.
  await row("Item 1").locator('[data-slot="item-open"]').click();
  const sheet = page.locator('[data-slot="review-sheet"]').filter({ hasText: "Item 1" });
  await expect(sheet.getByRole("checkbox", { name: "Script" })).toHaveAttribute(
    "aria-checked",
    "true",
  );
  await expect(sheet.locator('[data-slot="item-stage-group-heading"]')).toHaveCount(0);

  // Edit stages: add a group, then drag Edit above Script; the tick stays shown.
  await sheet.getByRole("button", { name: "Edit stages" }).click();
  const editor = page.getByRole("dialog", { name: "Stages of Item 1" });
  await editor.getByRole("button", { name: "Add a group" }).click();
  await editor.getByLabel("Name of the new group").fill("Phase A");
  await editor.getByLabel("Stages of the new group").fill("One\nTwo");
  await editor.getByRole("button", { name: "Add group" }).click();
  await expect(editor.getByLabel("Name of the group Phase A")).toBeVisible();
  const untitled = editor.locator('[data-slot="stage-group"][data-untitled]');
  const stageRow = (name: string) =>
    untitled.locator('[data-slot="stage-row"]', { has: page.getByLabel(`Name of ${name}`) });
  await drag(page, stageRow("Edit"), stageRow("Script"), 0.2);
  await expect(untitled.locator('[data-slot="stage-name"]')).toHaveValues(["Edit", "Script"]);
  await expect(stageRow("Script")).toHaveAttribute("data-done", "");
  await page.goBack();
  await expect(editor).toBeHidden();
  await expect(sheet.locator('[data-slot="item-stage-group-heading"]')).toHaveText(["Phase A0/2"]);
  await page.goBack();
  await expect(sheet).toBeHidden();

  // Default stages: name the untitled group.
  await page.getByRole("button", { name: "Actions for Existing work" }).click();
  await page.getByRole("menuitem", { name: "Default stages" }).click();
  const defaults = page.getByRole("dialog", { name: "Default stages" });
  await defaults.getByRole("button", { name: "Name this group" }).click();
  await defaults.getByLabel("Name of this group").fill("Phase B");
  await defaults.getByRole("button", { name: "Name it" }).click();
  await expect(defaults.getByLabel("Name of the group Phase B")).toBeVisible();
  await expect
    .poll(async () =>
      (
        await serviceSelect<{ group_label: string | null }>(
          `project_stages?project_id=eq.${projectId}&archived_at=is.null&select=group_label`,
        )
      ).map((stage) => stage.group_label),
    )
    .toEqual(["Phase B", "Phase B"]);
  await page.goBack();
  await expect(defaults).toBeHidden();

  // Every earlier tick, date, note and history row is as it was; the old rows are still the
  // untitled group (the new group's two stages are new rows).
  const stagesAfter = await serviceSelect<StageRow & { item_id: string }>(
    `project_item_stage_list?project_id=eq.${projectId}&select=${stageColumns}&order=id`,
  );
  const old = new Set(stagesBefore.map((stage) => stage.id));
  expect(stagesAfter.filter((stage) => old.has(stage.id))).toEqual(stagesBefore);
  expect(
    stagesAfter.filter((stage) => !old.has(stage.id)).map((stage) => stage.group_label),
  ).toEqual(["Phase A", "Phase A"]);
  expect(
    await serviceSelect<Record<string, unknown>>(
      `project_items?project_id=eq.${projectId}&select=id,title,planned_date,notes,state&order=id`,
    ),
  ).toEqual(itemsBefore);
  const historyAfter = await serviceSelect<{ id: number }>(activity);
  expect(historyAfter.slice(0, historyBefore.length)).toEqual(historyBefore);

  // Item 2 was never touched: still one untitled group, no heading.
  await row("Item 2").locator('[data-slot="item-open"]').click();
  const second = page.locator('[data-slot="review-sheet"]').filter({ hasText: "Item 2" });
  await expect(second.getByRole("checkbox", { name: "Script" })).toBeVisible();
  await expect(second.locator('[data-slot="item-stage-group-heading"]')).toHaveCount(0);
  await page.goBack();
  await expect(second).toBeHidden();
  await removeClientFixture(client);
});

test.describe("the new layers, installed (ARCHITECTURE §14.2)", () => {
  test.beforeEach(({}, info) => {
    test.skip(info.project.name === "desktop", "the phone widths, 375 and 430");
  });

  test("New project's Preview step, Default stages, a deliverable's Edit stages and a line's stages close one per back", async ({
    page,
  }, info) => {
    const client = nameOf(info, "layers");
    const presetName = nameOf(info, "Layer preset");
    await preset(presetName, ["P1", "P2"]);
    const clientId = await workClient(client);
    const projectId = await rpcAs<string>(admin.email, admin.password, "project_create", {
      client_id: clientId,
      name: "Layer work",
      recurrence: "monthly",
      stages: ["Script"],
      items: ["Item"],
    });
    const tab = new RegExp(`/clients/${clientId}/projects$`);
    const here = new RegExp(`/projects/${projectId}$`);
    await runInstalled(page);
    await page.goto(`/clients/${clientId}/projects`);
    await hydrated(page);

    // New project → Preview: back returns to the form, a second back asks (something typed).
    await page.getByRole("button", { name: "New project" }).click();
    const create = page.getByRole("dialog", { name: "New project" });
    await create.getByLabel("Project name").fill("Draft");
    await create.getByRole("button", { name: "Preview", exact: true }).click();
    await expect(create.locator('[data-slot="deliverables-preview"]:visible')).toBeVisible();
    await expectNoHorizontalScroll(page);
    await page.goBack();
    await expect(create.getByLabel("Project name")).toBeVisible();
    await expect(create.getByLabel("Project name")).toHaveValue("Draft");
    await expect(page).toHaveURL(tab);
    await page.goBack();
    const discard = page.getByRole("alertdialog", { name: "Discard this project?" });
    await discard.getByRole("button", { name: "Discard project" }).click();
    await expect(create).toBeHidden();
    await expect(page).toHaveURL(tab);

    await page.goto(`/clients/${clientId}/projects/${projectId}`);
    await hydrated(page);
    const menu = page.getByRole("button", { name: "Actions for Layer work" });

    // Default stages: a preset added as a group; its remove confirmation, then the sheet.
    await menu.click();
    await page.getByRole("menuitem", { name: "Default stages" }).click();
    const defaults = page.getByRole("dialog", { name: "Default stages" });
    await defaults.getByRole("combobox", { name: "Add from a preset" }).click();
    await page.getByRole("option", { name: presetName }).click();
    await expect(defaults.getByLabel(`Name of the group ${presetName}`)).toBeVisible();
    await expectNoHorizontalScroll(page);
    await defaults.getByRole("button", { name: `Actions for the group ${presetName}` }).click();
    await page.getByRole("menuitem", { name: "Remove group" }).click();
    const remove = page.getByRole("alertdialog", { name: `Remove the group ${presetName}?` });
    await expect(remove).toBeVisible();
    await expectBackStack(page, [
      { closes: remove, url: here },
      { closes: defaults, url: here },
    ]);

    // A deliverable's Edit stages over its sheet.
    await page
      .locator('[data-slot="item-row"]', { hasText: "Item" })
      .locator('[data-slot="item-open"]')
      .click();
    const sheet = page.locator('[data-slot="review-sheet"]').filter({ hasText: "Item" });
    await sheet.getByRole("button", { name: "Edit stages" }).click();
    const editor = page.getByRole("dialog", { name: "Stages of Item" });
    await expect(editor).toBeVisible();
    await expectNoHorizontalScroll(page);
    await expectBackStack(page, [
      { closes: editor, url: here },
      { closes: sheet, url: here },
    ]);

    // A line's stages over the Deliverables list; a changed draft asks first.
    await menu.click();
    await page.getByRole("menuitem", { name: "Deliverables list" }).click();
    const list = page.getByRole("dialog", { name: "Deliverables list" });
    await list.getByRole("button", { name: "Stages of Item" }).click();
    const line = page.getByRole("dialog", { name: "Stages of Item" });
    await expect(line).toBeVisible();
    await expectNoHorizontalScroll(page);
    await line.getByLabel("Add a stage to Stages of Item").fill("Two");
    await line.getByLabel("Add a stage to Stages of Item").press("Enter");
    await page.goBack();
    const ask = page.getByRole("alertdialog", { name: "Discard your changes?" });
    await expect(ask).toBeVisible();
    await page.goBack();
    await expect(ask).toBeHidden();
    await expect(line.locator('[data-slot="stage-name"]')).toHaveValues(["Script", "Two"]);
    await page.goBack();
    await ask.getByRole("button", { name: "Discard changes" }).click();
    await expect(line).toBeHidden();
    await expectBackStack(page, [{ closes: list, url: here }]);

    await removeClientFixture(client);
    await removePresets([presetName]);
  });
});
