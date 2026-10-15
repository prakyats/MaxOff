import type { Locator, Page, TestInfo } from "@playwright/test";

import { expect, test } from "./fixtures";
import {
  expectBackStack,
  expectNoHorizontalScroll,
  hydrated,
  insertAs,
  memberIdOf,
  runInstalled,
  serviceInsert,
  serviceRest,
  serviceSelect,
  storageStateFor,
  USERS,
} from "./helpers";

/**
 * The project template builder (phase 6b Release 1: ROADMAP 6b.13, 6b.16 (a)(b), 6b.18; DATA-MODEL
 * §5b): default stage groups, deliverables made with "× N" and stage presets, drag to reorder,
 * the live preview, a template from before groups opening in the new builder, and every layer's
 * back order installed at 375 and 430. Every name is neutral and made for the test.
 */

test.use({ storageState: storageStateFor("admin") });

const nameOf = (info: TestInfo, what: string) => `PT ${what} (${info.project.name})`;
const phone = (page: Page) => (page.viewportSize()?.width ?? 0) < 768;

type TemplateRow = {
  id: string;
  stages: string[];
  items: string[];
  stage_groups: { label: string | null; stages: string[] }[] | null;
  deliverables: {
    title: string;
    stage_groups: { label: string | null; stages: string[] }[] | null;
  }[];
};

async function removeTemplate(name: string): Promise<void> {
  await serviceRest(`project_templates?name=eq.${encodeURIComponent(name)}`, { method: "DELETE" });
}

async function removePresets(names: readonly string[]): Promise<void> {
  const list = names.map((name) => `"${name}"`).join(",");
  await serviceRest(`stage_presets?name=in.(${encodeURIComponent(list)})`, { method: "DELETE" });
}

async function addPresets(presets: readonly { name: string; stages: string[] }[]): Promise<void> {
  const [org] = await serviceSelect<{ id: string }>("organizations?select=id&limit=1");
  const createdBy = await memberIdOf(USERS.admin.email);
  for (const preset of presets) {
    await serviceInsert("stage_presets", { org_id: org?.id, created_by: createdBy, ...preset });
  }
}

async function boxOf(locator: Locator): Promise<{ x: number; y: number; w: number; h: number }> {
  const box = await locator.boundingBox();
  expect(box, "the element is laid out").not.toBeNull();
  const { x, y, width, height } = box as NonNullable<typeof box>;
  return { x, y, w: width, h: height };
}

/** Press a row's drag handle and drag it until the pointer is at `ratio` down the target row. */
async function dragTo(page: Page, handle: Locator, target: Locator, ratio: number): Promise<void> {
  await handle.scrollIntoViewIfNeeded();
  const from = await boxOf(handle);
  const to = await boxOf(target);
  await page.mouse.move(from.x + from.w / 2, from.y + from.h / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + from.w / 2, to.y + to.h * ratio, { steps: 12 });
  await expect(page.locator('[data-slot="reorder-indicator"]:visible')).toHaveCount(1);
  await page.mouse.up();
}

/** The values of the inputs a locator finds, in order. */
async function valuesOf(inputs: Locator): Promise<string[]> {
  return inputs.evaluateAll((nodes) => nodes.map((node) => (node as HTMLInputElement).value));
}

/**
 * The preview to check: a phone opens its Preview layer (6b.16 (a)), a laptop has it beside the
 * form. Resolves with the layer that holds it.
 */
async function openPreview(page: Page, form: Locator): Promise<Locator> {
  if (!phone(page)) return form;
  await form.getByRole("button", { name: "Preview" }).click();
  const preview = page.getByRole("dialog", { name: "Preview" });
  await expect(preview).toBeVisible();
  return preview;
}

/** The summary tiles read this line ("6 deliverables · 3 groups · 36 stages"). */
async function expectSummary(scope: Locator, line: string): Promise<void> {
  await expect(scope.locator('[data-slot="preview-counts"]')).toHaveAttribute("aria-label", line);
  await expect(scope.locator('[data-slot="preview-stat"]')).toHaveText(line.split(" · "));
}

/** The inputs a locator finds hold exactly these values, in this order. */
async function expectValues(inputs: Locator, values: readonly string[]): Promise<void> {
  await expect.poll(() => valuesOf(inputs)).toEqual(values);
}

test("a template of 6 deliverables × 3 groups from presets, reordered by drag, saved and reopened", async ({
  page,
}, info) => {
  const name = nameOf(info, "retainer");
  const [a, b, c] = ["Phase A", "Phase B", "Phase C"].map((phase) => nameOf(info, phase)) as [
    string,
    string,
    string,
  ];
  await removeTemplate(name);
  await removePresets([a, b, c]);
  await addPresets([
    { name: a, stages: ["One", "Two"] },
    { name: b, stages: ["Three", "Four"] },
    { name: c, stages: ["Five", "Six"] },
  ]);

  await page.goto("/settings/templates");
  await hydrated(page);
  await page.getByRole("button", { name: "Add a project template" }).click();
  const dialog = page.getByRole("dialog", { name: "Add a project template" });
  await dialog.getByLabel("Name", { exact: true }).fill(name);

  // "Item" × 6, each with the three presets as its groups, in the order they are ticked.
  const add = dialog.locator('[data-slot="add-deliverables"]');
  await add.getByLabel("Deliverable name").fill("Item");
  await add.getByLabel("How many").fill("6");
  for (const preset of [a, b, c]) await add.getByRole("checkbox", { name: preset }).check();
  await add.getByRole("button", { name: "Add", exact: true }).click();
  const deliverables = dialog.locator('[data-slot="deliverable"]');
  await expect(deliverables).toHaveCount(6);
  await expect(deliverables.locator('[data-slot="deliverable-title"]')).toHaveText([
    "Item 1",
    "Item 2",
    "Item 3",
    "Item 4",
    "Item 5",
    "Item 6",
  ]);
  await expectNoHorizontalScroll(page);

  // Open the first and reorder: a stage within its group, then a whole group.
  const first = deliverables.first();
  await first.locator('[data-slot="deliverable-toggle"]').click();
  const groups = first.locator('[data-slot="stage-group"]');
  await expectValues(groups.locator('[data-slot="group-name"]'), [a, b, c]);
  const stagesOfA = groups.nth(0).locator('[data-slot="stage-row"]');
  await dragTo(
    page,
    stagesOfA.nth(0).locator('[data-slot="reorder-handle"]'),
    stagesOfA.nth(1),
    0.8,
  );
  await expectValues(groups.nth(0).locator('[data-slot="stage-name"]'), ["Two", "One"]);
  await dragTo(
    page,
    groups.nth(1).locator('[data-slot="reorder-handle"]').first(),
    groups.nth(0),
    0.2,
  );
  await expectValues(groups.locator('[data-slot="group-name"]'), [b, a, c]);
  await expectValues(groups.nth(1).locator('[data-slot="stage-name"]'), ["Two", "One"]);

  // The row says the first has stages of its own; the hint says how to give them.
  await expect(first.locator('[data-slot="deliverable-subtitle"]')).toHaveText(
    "Own stages · 3 groups · 6 stages",
  );
  await expect(add.locator('[data-slot="add-deliverables-hint"]')).toHaveText(
    "Tick a preset to give these deliverables their own stages, or open a deliverable (⌄) to edit its stages.",
  );

  // The preview says what will be made: the five identical ones as one entry, the changed one
  // on its own; and saving makes it.
  const preview = await openPreview(page, dialog);
  await expectSummary(preview, "6 deliverables · 3 groups · 36 stages");
  const entries = preview.locator('[data-slot="preview-deliverable"]');
  await expect(entries.locator('[data-slot="preview-deliverable-title"]')).toHaveText([
    "Item 1",
    "Item 2–6",
  ]);
  await expect(entries.locator('[data-slot="preview-quantity"]')).toHaveText(["×5"]);
  await expect(entries.locator('[data-slot="preview-tag"]')).toHaveText([
    "Own stages",
    "Own stages",
  ]);
  await expect(entries.locator('[data-slot="preview-entry-counts"]')).toHaveText([
    "3 groups · 6 stages",
    "3 groups · 6 stages each",
  ]);
  await entries.nth(1).locator('[data-slot="preview-run-toggle"]').click();
  await expect(entries.nth(1).locator('[data-slot="preview-run-names"] li')).toHaveText([
    "Item 2",
    "Item 3",
    "Item 4",
    "Item 5",
    "Item 6",
  ]);
  await expect(entries.first().locator('[data-slot="preview-group-label"]')).toHaveText([b, a, c]);
  await preview.getByRole("button", { name: "Add template" }).click();
  await expect(preview).toBeHidden();
  await expect(dialog).toBeHidden();
  const row = page.locator('[data-slot="project-template"]', { hasText: name });
  await expect(row).toContainText("6 deliverables · 36 stages");

  const [saved] = await serviceSelect<TemplateRow>(
    `project_templates?name=eq.${encodeURIComponent(name)}&select=id,stages,items,stage_groups,deliverables`,
  );
  expect(saved?.items).toEqual(["Item 1", "Item 2", "Item 3", "Item 4", "Item 5", "Item 6"]);
  expect(saved?.deliverables[0]?.stage_groups).toEqual([
    { label: b, stages: ["Three", "Four"] },
    { label: a, stages: ["Two", "One"] },
    { label: c, stages: ["Five", "Six"] },
  ]);
  expect(saved?.deliverables[1]?.stage_groups?.map((group) => group.label)).toEqual([a, b, c]);

  // Reopened, it shows the order and the counts as saved.
  await row.getByRole("button", { name: `Edit ${name}` }).click();
  const edit = page.getByRole("dialog", { name: `Edit ${name}` });
  const reopened = edit.locator('[data-slot="deliverable"]');
  await expect(reopened).toHaveCount(6);
  await reopened.first().locator('[data-slot="deliverable-toggle"]').click();
  const again = reopened.first().locator('[data-slot="stage-group"]');
  await expectValues(again.locator('[data-slot="group-name"]'), [b, a, c]);
  expect(await valuesOf(again.nth(1).locator('[data-slot="stage-name"]'))).toEqual(["Two", "One"]);
  const shown = await openPreview(page, edit);
  await expectSummary(shown, "6 deliverables · 3 groups · 36 stages");
  await expect(
    shown
      .locator('[data-slot="preview-deliverable"]')
      .first()
      .locator('[data-slot="preview-group-label"]'),
  ).toHaveText([b, a, c]);
  if (phone(page)) {
    await shown.getByRole("button", { name: "Back to editing" }).click();
    await expect(shown).toBeHidden();
  }
  await edit.getByRole("button", { name: "Cancel" }).click();
  await expect(edit).toBeHidden();

  await removeTemplate(name);
  await removePresets([a, b, c]);
});

test("a template from before groups opens with its stages on each item, and keeps its old columns", async ({
  page,
}, info) => {
  const name = nameOf(info, "existing");
  await removeTemplate(name);
  // Today's shape: shared stages and an item list, no groups or deliverables.
  await insertAs(USERS.admin.email, USERS.admin.password, "project_templates", {
    name,
    recurrence: "monthly",
    stages: ["One", "Two"],
    items: ["Item 1", "Item 2"],
  });

  await page.goto("/settings/templates");
  await hydrated(page);
  const row = page.locator('[data-slot="project-template"]', { hasText: name });
  await expect(row).toContainText("2 deliverables · 4 stages");
  await row.getByRole("button", { name: `Edit ${name}` }).click();
  const dialog = page.getByRole("dialog", { name: `Edit ${name}` });
  // The shared stages are one untitled group: no heading, only "Name this group".
  const defaults = dialog.locator('[data-slot="template-default-groups"]');
  await expect(defaults.locator('[data-slot="stage-group"][data-untitled]')).toHaveCount(1);
  await expect(defaults.locator('[data-slot="group-name"]')).toHaveCount(0);
  await expectValues(defaults.locator('[data-slot="stage-name"]'), ["One", "Two"]);

  const deliverables = dialog.locator('[data-slot="deliverable"]');
  await expect(deliverables.locator('[data-slot="deliverable-title"]')).toHaveText([
    "Item 1",
    "Item 2",
  ]);
  const first = deliverables.first();
  await expect(first.locator('[data-slot="deliverable-subtitle"]')).toHaveText(
    "Uses the default stages",
  );
  await first.locator('[data-slot="deliverable-toggle"]').click();
  // An old item followed the template's stages, so it keeps following them (the defaults) until
  // it is given stages of its own, which start as a copy of them: one untitled group.
  await expect(first.locator('[data-slot="uses-defaults"]')).toContainText(
    "Uses the default stages",
  );
  await first.getByRole("button", { name: "Give it its own stages" }).click();
  await expect(first.locator('[data-slot="stage-group"][data-untitled]')).toHaveCount(1);
  await expect(first.locator('[data-slot="name-group"]')).toBeVisible();
  await expectValues(first.locator('[data-slot="stage-name"]'), ["One", "Two"]);

  // One deliverable gains a group of its own.
  await first.locator('[data-slot="add-group"]').click();
  const form = first.locator('[data-slot="add-group-form"]');
  await form.getByPlaceholder("Group name").fill("Phase B");
  await form.getByPlaceholder("One stage per line").fill("Three\nFour");
  await form.getByRole("button", { name: "Add group" }).click();
  await expectValues(first.locator('[data-slot="group-name"]'), ["Phase B"]);
  await expect(first.locator('[data-slot="deliverable-subtitle"]')).toHaveText(
    "Own stages · 2 groups · 4 stages",
  );

  // Different stages never collapse: each keeps its entry, tagged own or default.
  const preview = await openPreview(page, dialog);
  await expectSummary(preview, "2 deliverables · 1 group · 6 stages");
  const entries = preview.locator('[data-slot="preview-deliverable"]');
  await expect(entries.locator('[data-slot="preview-deliverable-title"]')).toHaveText([
    "Item 1",
    "Item 2",
  ]);
  await expect(entries.locator('[data-slot="preview-quantity"]')).toHaveCount(0);
  await expect(entries.locator('[data-slot="preview-tag"]')).toHaveText([
    "Own stages",
    "Default stages",
  ]);
  await expect(entries.locator('[data-slot="preview-entry-counts"]')).toHaveText([
    "2 groups · 4 stages",
    "2 stages",
  ]);
  // The default one shows no group heading: the defaults are one untitled group.
  await expect(entries.nth(1).locator('[data-slot="preview-group-label"]')).toHaveCount(0);
  await preview.getByRole("button", { name: "Save template" }).click();
  await expect(preview).toBeHidden();
  await expect(dialog).toBeHidden();
  await expect(row).toContainText("2 deliverables · 6 stages");

  const [saved] = await serviceSelect<TemplateRow>(
    `project_templates?name=eq.${encodeURIComponent(name)}&select=id,stages,items,stage_groups,deliverables`,
  );
  // The old columns say what they said: the readers from before groups see no change.
  expect(saved?.stages).toEqual(["One", "Two"]);
  expect(saved?.items).toEqual(["Item 1", "Item 2"]);
  expect(saved?.stage_groups).toEqual([{ label: null, stages: ["One", "Two"] }]);
  expect(saved?.deliverables).toEqual([
    {
      title: "Item 1",
      stage_groups: [
        { label: null, stages: ["One", "Two"] },
        { label: "Phase B", stages: ["Three", "Four"] },
      ],
    },
    // The other item still follows the template's default stages.
    { title: "Item 2", stage_groups: null },
  ]);
  await removeTemplate(name);
});

test("the preview's summary stays in view while its list scrolls", async ({ page }, info) => {
  const name = nameOf(info, "long");
  await removeTemplate(name);
  // Twelve deliverables whose names form no run, so none collapses and the list is long.
  const groups = [
    { label: "Phase A", stages: ["One", "Two", "Three"] },
    { label: "Phase B", stages: ["Four", "Five"] },
  ];
  const titles = "ABCDEFGHIJKL".split("").map((letter) => `Item ${letter}`);
  await insertAs(USERS.admin.email, USERS.admin.password, "project_templates", {
    name,
    recurrence: "monthly",
    stage_groups: [],
    deliverables: titles.map((title) => ({ title, stage_groups: groups })),
  });
  await page.goto("/settings/templates");
  await hydrated(page);
  const row = page.locator('[data-slot="project-template"]', { hasText: name });
  await row.getByRole("button", { name: `Edit ${name}` }).click();
  const dialog = page.getByRole("dialog", { name: `Edit ${name}` });
  await expect(dialog).toBeVisible();
  const preview = await openPreview(page, dialog);
  await expectSummary(preview, "12 deliverables · 2 groups · 60 stages");
  const entries = preview.locator('[data-slot="preview-deliverable"]');
  await expect(entries).toHaveCount(12);
  const scroller = phone(page)
    ? preview
    : preview.locator('[data-slot="template-preview-scroller"]');
  await scroller.evaluate((node) => {
    node.scrollTop = node.scrollHeight;
  });
  await expect(entries.last()).toBeInViewport();
  await expect(entries.first()).not.toBeInViewport();
  const summary = preview.locator('[data-slot="preview-summary"]');
  await expect(summary).toBeInViewport();
  // Pinned to the top of the scrolling area, not scrolled away with the list.
  await expect
    .poll(async () => {
      const area = await boxOf(scroller);
      const pinned = await boxOf(summary);
      return pinned.y >= area.y - 1 && pinned.y <= area.y + 24;
    })
    .toBe(true);
  await removeTemplate(name);
});

test.describe("the template builder's layers, installed (ARCHITECTURE §14.2)", () => {
  test("back closes each layer of the builder, and asks before losing typed work", async ({
    page,
  }, info) => {
    const preset = nameOf(info, "back preset");
    await removePresets([preset]);
    await addPresets([{ name: preset, stages: ["One"] }]);
    await runInstalled(page);
    await page.goto("/settings/templates");
    await hydrated(page);
    const here = /\/settings\/templates$/;
    const open = page.getByRole("button", { name: "Add a project template" });
    const dialog = page.getByRole("dialog", { name: "Add a project template" });
    await open.click();
    await expect(dialog).toBeVisible();
    await expectBackStack(page, [{ closes: dialog, url: here }]);

    await open.click();
    await dialog.getByLabel("Name", { exact: true }).fill("Half a template");
    const add = dialog.locator('[data-slot="add-deliverables"]');
    await add.getByLabel("Deliverable name").fill("Item");
    await add.getByRole("checkbox", { name: preset }).check();
    await add.getByRole("button", { name: "Add", exact: true }).click();
    const first = dialog.locator('[data-slot="deliverable"]').first();

    // Opening a deliverable is a view control: it adds no history.
    await first.locator('[data-slot="deliverable-toggle"]').click();
    await expect(first.locator('[data-slot="deliverable-body"]')).toBeVisible();

    // The row's ⋯ menu closes on back, and only the menu.
    await first.locator('[data-slot="group-menu"]').click();
    const menu = page.getByRole("menu");
    await expect(menu).toBeVisible();
    await expectBackStack(page, [{ closes: menu, url: here }]);
    await expect(dialog).toBeVisible();

    // Removing a group with stages asks first; back closes the question, the form stays.
    await first.locator('[data-slot="group-menu"]').click();
    await page.getByRole("menuitem", { name: "Remove group" }).click();
    const confirm = page.getByRole("alertdialog", { name: `Remove ${preset}?` });
    await expect(confirm).toBeVisible();
    await expectBackStack(page, [{ closes: confirm, url: here }]);
    await expect(dialog).toBeVisible();
    await expectValues(first.locator('[data-slot="group-name"]'), [preset]);

    // A phone's Preview is its own layer: back returns to the form.
    if (phone(page)) {
      await dialog.getByRole("button", { name: "Preview" }).click();
      const preview = page.getByRole("dialog", { name: "Preview" });
      await expect(preview).toBeVisible();
      await expectBackStack(page, [{ closes: preview, url: here }]);
      await expect(dialog).toBeVisible();
    }

    // With typed work, back asks; back on the question keeps editing; Discard closes it all.
    const discard = page.getByRole("alertdialog", { name: "Discard this template?" });
    await page.goBack();
    await expect(discard).toBeVisible();
    await expect(page).toHaveURL(here);
    await page.goBack();
    await expect(discard).toBeHidden();
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel("Name", { exact: true })).toHaveValue("Half a template");
    await page.goBack();
    await discard.getByRole("button", { name: "Discard template" }).click();
    await expect(discard).toBeHidden();
    await expect(dialog).toBeHidden();
    await expect(page).toHaveURL(here);
    await removePresets([preset]);
  });
});
