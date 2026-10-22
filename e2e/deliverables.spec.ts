import type { Locator, Page, TestInfo } from "@playwright/test";

import { expect, test } from "./fixtures";
import {
  animationsSettled,
  createFromNewProject,
  expectBackStack,
  expectNoHorizontalScroll,
  hydrated,
  insertAs,
  memberIdOf,
  newProjectStep,
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

/** The values of some inputs, in order (a list of stage names). */
const valuesOf = (inputs: Locator) =>
  inputs.evaluateAll((elements) => elements.map((element) => (element as HTMLInputElement).value));

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

/**
 * Nothing in the layer reaches past the screen's right edge, and the page does not scroll
 * sideways (the mobile standard, ARCHITECTURE §14.1). Only visible elements are measured.
 */
async function expectLayerFits(page: Page, layer: Locator): Promise<void> {
  const wide = await layer.evaluate((root) => {
    const edge = document.documentElement.clientWidth + 1;
    return [...root.querySelectorAll<HTMLElement>("*")]
      .filter((element) => {
        const box = element.getBoundingClientRect();
        return box.width > 0 && box.height > 0 && box.right > edge;
      })
      .slice(0, 5)
      .map((element) => element.dataset.slot ?? element.tagName.toLowerCase());
  });
  expect(wide, "nothing in the layer reaches past the right edge").toEqual([]);
  const width = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(width.scrollWidth, "the page does not scroll sideways").toBeLessThanOrEqual(
    width.clientWidth,
  );
}

/** The preview's summary tiles read this line ("6 deliverables · 3 groups · 36 stages"). */
async function expectSummary(scope: Locator, line: string): Promise<void> {
  const counts = scope.locator('[data-slot="preview-counts"]:visible');
  await expect(counts).toHaveAttribute("aria-label", line);
  await expect(counts.locator('[data-slot="preview-stat"]')).toHaveText(line.split(" · "));
}

/** Create in the New project dialog (V5b PP-forms-7): Next to Preview & create, then Create. */
async function createFromDialog(_page: Page, dialog: Locator): Promise<void> {
  await createFromNewProject(dialog);
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
  // Step 2: "Item" × 6, each with the three presets as its groups, in the order ticked.
  await newProjectStep(dialog, 2);
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
  await expect
    .poll(() => valuesOf(body.locator('[data-slot="stage-name"]')))
    .toEqual(["A2", "A1", "A3", "B1", "B2", "C1"]);

  // The live preview counts what Create makes (beside the editors on a laptop, and step 3).
  const phone = (page.viewportSize()?.width ?? 1280) < 768;
  if (!phone) await expectSummary(dialog, "6 deliverables · 3 groups · 36 stages");
  await newProjectStep(dialog, 3);
  await expectSummary(dialog, "6 deliverables · 3 groups · 36 stages");
  await createFromDialog(page, dialog);
  const projectPage = new RegExp(`/clients/${clientId}/projects/[0-9a-f-]{36}$`);
  await expect(page).toHaveURL(projectPage);
  await hydrated(page);
  if (phone) {
    // Neither the Preview step's entry nor the dialog's is left under the new page: one back
    // returns to the Projects tab.
    const created = page.url();
    await page.goBack();
    await expect(page).toHaveURL(new RegExp(`/clients/${clientId}/projects$`));
    await page.goto(created);
    await hydrated(page);
  }

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
    `${a}0/3 stages ticked`,
    `${b}0/2 stages ticked`,
    `${c}0/1 stages ticked`,
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
  // The old rows are one untitled group: headed "Stages" with its count, as the list's strip.
  await row("Item 1").locator('[data-slot="item-open"]').click();
  const sheet = page.locator('[data-slot="review-sheet"]').filter({ hasText: "Item 1" });
  await expect(sheet.getByRole("checkbox", { name: "Script" })).toHaveAttribute(
    "aria-checked",
    "true",
  );
  await expect(sheet.locator('[data-slot="item-stage-group-heading"]')).toHaveText([
    "Stages1/2 stages ticked",
  ]);

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
  await expect
    .poll(() => valuesOf(untitled.locator('[data-slot="stage-name"]')))
    .toEqual(["Edit", "Script"]);
  await expect(stageRow("Script")).toHaveAttribute("data-done", "");
  await page.goBack();
  await expect(editor).toBeHidden();
  await expect(sheet.locator('[data-slot="item-stage-group-heading"]')).toHaveText([
    "Stages1/2 stages ticked",
    "Phase A0/2 stages ticked",
  ]);
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

  // Item 2 was never touched: still one untitled group, headed "Stages" as the list's strip.
  await row("Item 2").locator('[data-slot="item-open"]').click();
  const second = page.locator('[data-slot="review-sheet"]').filter({ hasText: "Item 2" });
  await expect(second.getByRole("checkbox", { name: "Script" })).toBeVisible();
  await expect(second.locator('[data-slot="item-stage-group-heading"]')).toHaveText([
    /^Stages\d\/2 stages ticked$/,
  ]);
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

    // New project's three steps are a stack (V5b PP-forms-7): each back returns to the step
    // before, then back from Basics asks (something typed).
    await page.getByRole("button", { name: "New project" }).click();
    const create = page.getByRole("dialog", { name: "New project" });
    await create.getByLabel("Project name").fill("Draft");
    await newProjectStep(create, 3);
    await expect(create.locator('[data-slot="deliverables-preview"]:visible')).toBeVisible();
    await expectNoHorizontalScroll(page);
    await page.goBack();
    await expect(create.getByLabel("Deliverable name")).toBeVisible();
    await expectNoHorizontalScroll(page);
    await page.goBack();
    await expect(create.getByLabel("Project name")).toBeVisible();
    await expect(create.getByLabel("Project name")).toHaveValue("Draft");
    await expect(page).toHaveURL(tab);
    // The Back button takes the same path.
    await newProjectStep(create, 2);
    await create.getByRole("button", { name: "Back", exact: true }).click();
    await expect(create.getByLabel("Project name")).toBeVisible();
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
    // Measured inside the layer: the toast that says so is the toaster's, sliding in.
    await animationsSettled(page);
    await expectLayerFits(page, defaults);
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
    await expectLayerFits(page, editor);
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
    await expectLayerFits(page, line);
    await line.getByLabel("Add a stage to Stages of Item").fill("Two");
    await line.getByLabel("Add a stage to Stages of Item").press("Enter");
    await page.goBack();
    const ask = page.getByRole("alertdialog", { name: "Discard your changes?" });
    await expect(ask).toBeVisible();
    await page.goBack();
    await expect(ask).toBeHidden();
    await expect
      .poll(() => valuesOf(line.locator('[data-slot="stage-name"]')))
      .toEqual(["Script", "Two"]);
    await page.goBack();
    await ask.getByRole("button", { name: "Discard changes" }).click();
    await expect(line).toBeHidden();
    await expectBackStack(page, [{ closes: list, url: here }]);

    // The Deliverables list takes "Name × N" (6b.16 (b)): Name 1 … Name N, one toast; the add
    // adds no history entry, so one back closes the list.
    await menu.click();
    await page.getByRole("menuitem", { name: "Deliverables list" }).click();
    await list.getByLabel("New deliverable").fill("Line");
    await list.getByLabel("How many").fill("3");
    await list.getByRole("button", { name: "Add", exact: true }).click();
    for (const title of ["Line 1", "Line 2", "Line 3"]) {
      await expect(list.getByLabel(`Name of ${title}`)).toBeVisible();
    }
    await expect(page.getByText(/^3 deliverables added from /)).toBeVisible();
    await expect(list.locator('[data-slot="list-editor-row"][data-pending]')).toHaveCount(0);
    expect(
      (
        await serviceSelect<{ title: string }>(
          `project_item_blueprints?project_id=eq.${projectId}&archived_at=is.null&select=title&order=position`,
        )
      ).map((line) => line.title),
    ).toEqual(["Item", "Line 1", "Line 2", "Line 3"]);
    // Out of range is refused under the field, nothing sent.
    await list.getByLabel("New deliverable").fill("Line");
    await list.getByLabel("How many").fill("0");
    await list.getByRole("button", { name: "Add", exact: true }).click();
    await expect(list.getByText("Add between 1 and 100 at a time.")).toBeVisible();
    await list.getByLabel("New deliverable").fill("");
    await expectBackStack(page, [{ closes: list, url: here }]);

    await removeClientFixture(client);
    await removePresets([presetName]);
  });
});

/* -------------------------------------------------------------------------------------------------
 * Release 2 (v1.7.1; ROADMAP 6b.13 (2)(b), 6b.16 (f)): a deliverable saved as a deliverable
 * template and used in another project's "+ Add deliverable"; New project's template library.
 * ---------------------------------------------------------------------------------------------- */

async function removeDeliverableTemplate(name: string): Promise<void> {
  await serviceRest(`deliverable_templates?name=eq.${encodeURIComponent(name)}`, {
    method: "DELETE",
  });
}

test("a deliverable saved as a deliverable template, then used in another project's Add deliverable", async ({
  page,
}, info) => {
  const client = nameOf(info, "dt save");
  const template = nameOf(info, "Item kind");
  await removeDeliverableTemplate(template);
  const clientId = await workClient(client);
  // Today's shape, then a group added on the deliverable and a tick.
  const projectId = await rpcAs<string>(admin.email, admin.password, "project_create", {
    client_id: clientId,
    name: "Source work",
    recurrence: "monthly",
    stages: ["Stage 1"],
    items: ["Item 1"],
  });
  const [one] = await serviceSelect<{ id: string }>(
    `project_items?project_id=eq.${projectId}&title=eq.Item%201&select=id`,
  );
  const itemId = one!.id;
  await rpcAs(admin.email, admin.password, "item_stage_group_add", {
    item_id: itemId,
    label: "Phase A",
    stages: ["One", "Two"],
  });
  const [tick] = await serviceSelect<{ id: string }>(
    `project_item_stage_list?item_id=eq.${itemId}&name=eq.Stage%201&select=id`,
  );
  await rpcAs(admin.email, admin.password, "item_stage_tick", { stage_id: tick!.id, done: true });
  const stageColumns = "id,name,done_at,done_by,group_label,position,archived_at";
  const ticksBefore = await serviceSelect<StageRow>(
    `project_item_stage_list?item_id=eq.${itemId}&select=${stageColumns}&order=id`,
  );

  await page.goto(`/clients/${clientId}/projects/${projectId}`);
  await hydrated(page);
  await page
    .locator('[data-slot="item-row"]', { hasText: "Item 1" })
    .locator('[data-slot="item-open"]')
    .click();
  const sheet = page.locator('[data-slot="review-sheet"]').filter({ hasText: "Item 1" });
  await sheet.getByRole("button", { name: "More for Item 1" }).click();
  await page.getByRole("menuitem", { name: "Save as template" }).click();
  const save = page.getByRole("dialog", { name: "Save as template" });
  await expect(save.getByLabel("Template name")).toHaveValue("Item 1");
  await save.getByLabel("Template name").fill(template);
  await save.getByRole("button", { name: "Save template" }).click();
  await expect(save).toBeHidden();
  await expect(page.getByText(`Saved as the template ${template}`)).toBeVisible();
  const [saved] = await serviceSelect<{ stage_groups: unknown }>(
    `deliverable_templates?name=eq.${encodeURIComponent(template)}&select=stage_groups`,
  );
  expect(saved?.stage_groups).toEqual([
    { label: null, stages: ["Stage 1"] },
    { label: "Phase A", stages: ["One", "Two"] },
  ]);
  // The deliverable keeps every stage and its tick.
  expect(
    await serviceSelect<StageRow>(
      `project_item_stage_list?item_id=eq.${itemId}&select=${stageColumns}&order=id`,
    ),
  ).toEqual(ticksBefore);
  await page.goBack();
  await expect(sheet).toBeHidden();

  // Another project: "+ Add deliverable" starts from it, its groups editable before adding.
  const otherId = await rpcAs<string>(admin.email, admin.password, "project_create", {
    client_id: clientId,
    name: "Other work",
    recurrence: "monthly",
    stages: ["Other"],
    items: [],
  });
  await page.goto(`/clients/${clientId}/projects/${otherId}`);
  await hydrated(page);
  await page.getByRole("button", { name: "Add deliverable" }).click();
  const dialog = page.getByRole("dialog", { name: "Add a deliverable" });
  await dialog.getByRole("combobox", { name: "Start from" }).click();
  await page.getByRole("option", { name: template }).click();
  await expect(dialog.getByLabel("Title")).toHaveValue(template);
  await expect
    .poll(() => valuesOf(dialog.locator('[data-slot="stage-name"]')))
    .toEqual(["Stage 1", "One", "Two"]);
  await dialog.getByLabel("Title").fill("Item from template");
  await dialog.getByRole("button", { name: "Add deliverable" }).click();
  await expect(dialog).toBeHidden();
  const [added] = await serviceSelect<{ id: string }>(
    `project_items?project_id=eq.${otherId}&title=eq.${encodeURIComponent("Item from template")}&select=id`,
  );
  expect(await stagesOf(added!.id)).toEqual(["Stage 1", "Phase A · One", "Phase A · Two"]);
  await removeClientFixture(client);
  await removeDeliverableTemplate(template);
});

test("New project's template library: search, a preview that back closes, then Use this template", async ({
  page,
}, info) => {
  const client = nameOf(info, "library");
  const alpha = nameOf(info, "Library alpha");
  const beta = nameOf(info, "Library beta");
  for (const name of [alpha, beta]) {
    await serviceRest(`project_templates?name=eq.${encodeURIComponent(name)}`, {
      method: "DELETE",
    });
  }
  const groups = [{ label: "Phase A", stages: ["One", "Two"] }];
  await insertAs(admin.email, admin.password, "project_templates", {
    name: alpha,
    recurrence: "weekly",
    stage_groups: [],
    deliverables: [
      { title: "Item 1", stage_groups: groups },
      { title: "Item 2", stage_groups: groups },
    ],
  });
  await insertAs(admin.email, admin.password, "project_templates", {
    name: beta,
    recurrence: "monthly",
    stage_groups: [],
    deliverables: [{ title: "Item", stage_groups: null }],
  });
  const clientId = await workClient(client);
  const tab = new RegExp(`/clients/${clientId}/projects$`);
  await runInstalled(page);
  await page.goto(`/clients/${clientId}/projects`);
  await hydrated(page);
  await page.getByRole("button", { name: "New project" }).click();
  const create = page.getByRole("dialog", { name: "New project" });
  await create.getByRole("button", { name: "Start from a template" }).click();
  const library = page.getByRole("dialog", { name: "Start from a template" });
  await expect(library).toBeVisible();
  const rows = library.locator('[data-slot="template-library-row"]');
  await library.getByRole("searchbox", { name: "Search templates" }).fill(alpha);
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText("Weekly · 2 deliverables · 4 stages");
  await library
    .getByRole("searchbox", { name: "Search templates" })
    .fill(`${alpha} nothing-like-it`);
  await expect(library.locator('[data-slot="template-library-empty"]')).toBeVisible();
  await library.getByRole("searchbox", { name: "Search templates" }).fill(alpha);
  await expectNoHorizontalScroll(page);

  // The preview is its own layer: back closes it, the library stays.
  await rows
    .first()
    .getByRole("button", { name: `Preview ${alpha}` })
    .click();
  const preview = page.getByRole("dialog", { name: `Preview ${alpha}` });
  await expectSummary(preview, "2 deliverables · 1 group · 4 stages");
  await expectBackStack(page, [{ closes: preview, url: tab }]);
  await expect(library).toBeVisible();

  // Use this template: the form takes it, shown as a chip on Basics, still editable.
  await rows
    .first()
    .getByRole("button", { name: `Preview ${alpha}` })
    .click();
  await preview.getByRole("button", { name: "Use this template" }).click();
  await expect(preview).toBeHidden();
  await expect(library).toBeHidden();
  await expect(create.locator('[data-slot="new-project-basics"]')).toContainText(alpha);
  await expect(create.getByRole("button", { name: "Change template" })).toBeVisible();
  await create.getByLabel("Project name").fill("From the library");
  await newProjectStep(create, 2);
  await expect(create.locator('[data-slot="deliverable-title"]')).toHaveText(["Item 1", "Item 2"]);
  await page.goBack();
  await expect(create.getByLabel("Project name")).toBeVisible();

  // Back now asks before the picked template is lost.
  await page.goBack();
  const discard = page.getByRole("alertdialog", { name: "Discard this project?" });
  await discard.getByRole("button", { name: "Discard project" }).click();
  await expect(create).toBeHidden();
  await expect(page).toHaveURL(tab);
  await removeClientFixture(client);
  for (const name of [alpha, beta]) {
    await serviceRest(`project_templates?name=eq.${encodeURIComponent(name)}`, {
      method: "DELETE",
    });
  }
});

test.describe("Save as template's layers, installed (ARCHITECTURE §14.2)", () => {
  test.beforeEach(({}, info) => {
    test.skip(info.project.name === "desktop", "the phone widths, 375 and 430");
  });

  test("the project's and a deliverable's Save as template close one per back", async ({
    page,
  }, info) => {
    const client = nameOf(info, "save layers");
    const clientId = await workClient(client);
    const projectId = await rpcAs<string>(admin.email, admin.password, "project_create", {
      client_id: clientId,
      name: "Layer work",
      recurrence: "monthly",
      stages: ["Stage 1"],
      items: ["Item 1"],
    });
    const here = new RegExp(`/projects/${projectId}$`);
    await runInstalled(page);
    await page.goto(`/clients/${clientId}/projects/${projectId}`);
    await hydrated(page);

    await page.getByRole("button", { name: "Actions for Layer work" }).click();
    await page.getByRole("menuitem", { name: "Save as template" }).click();
    const save = page.getByRole("dialog", { name: "Save as template" });
    await expect(save).toBeVisible();
    await expectLayerFits(page, save);
    await expectBackStack(page, [{ closes: save, url: here }]);

    await page
      .locator('[data-slot="item-row"]', { hasText: "Item 1" })
      .locator('[data-slot="item-open"]')
      .click();
    const sheet = page.locator('[data-slot="review-sheet"]').filter({ hasText: "Item 1" });
    await sheet.getByRole("button", { name: "More for Item 1" }).click();
    const menu = page.getByRole("menu");
    await expect(menu).toBeVisible();
    await expectBackStack(page, [{ closes: menu, url: here }]);
    await expect(sheet).toBeVisible();
    await sheet.getByRole("button", { name: "More for Item 1" }).click();
    await page.getByRole("menuitem", { name: "Save as template" }).click();
    await expect(save).toBeVisible();
    await expectBackStack(page, [
      { closes: save, url: here },
      { closes: sheet, url: here },
    ]);

    // "+ Add deliverable": its Start from adds no layer of its own; back closes the dialog.
    await page.getByRole("button", { name: "Add deliverable" }).click();
    const add = page.getByRole("dialog", { name: "Add a deliverable" });
    await expect(add).toBeVisible();
    await expectBackStack(page, [{ closes: add, url: here }]);
    await removeClientFixture(client);
  });
});
