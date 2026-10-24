import type { Locator, Page, TestInfo } from "@playwright/test";

import { expect, test } from "./fixtures";
import {
  expectBackStack,
  expectNoHorizontalScroll,
  hydrated,
  insertAs,
  memberIdOf,
  removeClientFixture,
  rowAction,
  rpcAs,
  runInstalled,
  serviceInsert,
  serviceRest,
  serviceSelect,
  storageStateFor,
  USERS,
  templatesTab,
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
  await form.getByRole("button", { name: "Preview and save" }).click();
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

  await page.goto("/settings/templates#projects");
  await hydrated(page);
  await page.getByRole("button", { name: "Add project template" }).click();
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
    "Tick a preset to give these deliverables their own stages, or open a deliverable's row to edit its stages.",
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
  // The toast says what just happened and where it shows up.
  await expect(
    page.getByText(`Added ${name}: New project offers it under Start from`),
  ).toBeVisible();
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
  await rowAction(page, row, name, "Edit");
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

  await page.goto("/settings/templates#projects");
  await hydrated(page);
  const row = page.locator('[data-slot="project-template"]', { hasText: name });
  await expect(row).toContainText("2 deliverables · 4 stages");
  await rowAction(page, row, name, "Edit");
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
  // Twelve deliverables, no two neighbours identical, so none collapses and the list is long.
  const groups = [
    { label: "Phase A", stages: ["One", "Two", "Three"] },
    { label: "Phase B", stages: ["Four", "Five"] },
  ];
  const others = [
    { label: "Phase A", stages: ["One", "Two"] },
    { label: "Phase B", stages: ["Three", "Four", "Five"] },
  ];
  const titles = "ABCDEFGHIJKL".split("").map((letter) => `Item ${letter}`);
  await insertAs(USERS.admin.email, USERS.admin.password, "project_templates", {
    name,
    recurrence: "monthly",
    stage_groups: [],
    deliverables: titles.map((title, index) => ({
      title,
      stage_groups: index % 2 === 0 ? groups : others,
    })),
  });
  await page.goto("/settings/templates#projects");
  await hydrated(page);
  const row = page.locator('[data-slot="project-template"]', { hasText: name });
  await rowAction(page, row, name, "Edit");
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

test("the preview collapses identical neighbours, and a change highlights its own card (v1.7.1)", async ({
  page,
}, info) => {
  const name = nameOf(info, "identical");
  await removeTemplate(name);
  const own = [{ label: "Phase A", stages: ["One", "Two"] }];
  const banner = [{ label: "Phase B", stages: ["Three"] }];
  await insertAs(USERS.admin.email, USERS.admin.password, "project_templates", {
    name,
    recurrence: "monthly",
    stage_groups: [{ label: null, stages: ["One", "Two", "Three", "Four"] }],
    deliverables: [
      { title: "Teaser", stage_groups: null },
      { title: "Cutdown", stage_groups: null },
      { title: "Poster", stage_groups: own },
      { title: "Banner", stage_groups: banner },
    ],
  });
  await page.goto("/settings/templates#projects");
  await hydrated(page);
  const row = page.locator('[data-slot="project-template"]', { hasText: name });
  await rowAction(page, row, name, "Edit");
  const dialog = page.getByRole("dialog", { name: `Edit ${name}` });
  await expect(dialog).toBeVisible();
  const preview = await openPreview(page, dialog);
  const entries = preview.locator('[data-slot="preview-deliverable"]');

  // Identical neighbours that are not a numbered run: one entry, "Teaser, Cutdown" ×2.
  await expect(entries.locator('[data-slot="preview-deliverable-title"]')).toHaveText([
    "Teaser, Cutdown",
    "Poster",
    "Banner",
  ]);
  await expect(entries.locator('[data-slot="preview-quantity"]')).toHaveText(["×2"]);
  await expect(entries.locator('[data-slot="preview-entry-counts"]')).toHaveText([
    "4 stages each",
    "1 group · 2 stages",
    "1 group · 1 stage",
  ]);
  // Each card's stage dots, none ticked yet (the progress meter's language).
  await expect(entries.locator('[data-slot="preview-stage-dots"]')).toHaveCount(3);
  await expect(entries.first().locator('[data-slot="preview-stage-dots"]')).toHaveAttribute(
    "data-total",
    "4",
  );
  await entries.first().locator('[data-slot="preview-run-toggle"]').click();
  await expect(entries.first().locator('[data-slot="preview-run-names"] li')).toHaveText([
    "Teaser",
    "Cutdown",
  ]);
  await expectNoHorizontalScroll(page);

  if (!phone(page)) {
    // A laptop edits beside the preview: the cards are keyed to their deliverables. Banner's
    // card is marked, moved up a place, then renamed: it stays the same card (never Poster's),
    // and only it flashes.
    const card = (title: string) =>
      entries.filter({
        has: page.locator('[data-slot="preview-deliverable-title"]', { hasText: title }),
      });
    await card("Banner").evaluate((node) => {
      (node as HTMLElement).dataset.probe = "banner";
    });
    await dialog.getByRole("button", { name: "Actions for Banner" }).click();
    await page.getByRole("menuitem", { name: "Move up" }).click();
    await expect(entries.locator('[data-slot="preview-deliverable-title"]')).toHaveText([
      "Teaser, Cutdown",
      "Banner",
      "Poster",
    ]);
    await expect(card("Banner")).toHaveAttribute("data-probe", "banner");
    await expect(card("Poster")).not.toHaveAttribute("data-probe", "banner");
    const moved = dialog.locator('[data-slot="deliverable"]', { hasText: "Banner" });
    await moved.locator('[data-slot="deliverable-toggle"]').click();
    await moved.locator('[data-slot="deliverable-title-input"]').fill("Banner final");
    await expect(card("Banner final")).toHaveAttribute("data-probe", "banner");
    await expect(card("Banner final")).toHaveAttribute("data-changed", "");
    await expect(card("Poster")).not.toHaveAttribute("data-changed", "");
  }
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
    await page.goto("/settings/templates#projects");
    await hydrated(page);
    const here = /\/settings\/templates#projects$/;
    const open = page.getByRole("button", { name: "Add project template" });
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
      await dialog.getByRole("button", { name: "Preview and save" }).click();
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

/* -------------------------------------------------------------------------------------------------
 * Release 2 (v1.7.1; ROADMAP 6b.13 (2)(b), 6b.16 (f)): Save as template from a project, deliverable
 * templates in Settings, the library's search and preview, and who may edit which template.
 * ---------------------------------------------------------------------------------------------- */

async function removeDeliverableTemplate(name: string): Promise<void> {
  await serviceRest(`deliverable_templates?name=eq.${encodeURIComponent(name)}`, {
    method: "DELETE",
  });
}

/** An Active client run by the seeded Admin, removed first. */
async function workClient(name: string): Promise<string> {
  await removeClientFixture(name);
  const [org] = await serviceSelect<{ id: string }>("organizations?select=id&limit=1");
  const row = await serviceInsert<{ id: string }>("clients", {
    org_id: org?.id,
    name,
    admin_id: await memberIdOf(USERS.admin.email),
  });
  await rpcAs(USERS.owner.email, USERS.owner.password, "client_activate", { client_id: row.id });
  return row.id;
}

test("a today-shape project saved as a template: its deliverables and groups, the project unchanged", async ({
  page,
}, info) => {
  const client = nameOf(info, "save client");
  const template = nameOf(info, "saved month");
  await removeTemplate(template);
  const clientId = await workClient(client);
  const admin = USERS.admin;
  // As the team's projects are: plain stages, an item list, a tick, a date and a note.
  const projectId = await rpcAs<string>(admin.email, admin.password, "project_create", {
    client_id: clientId,
    name: "Existing work",
    recurrence: "monthly",
    stages: ["Stage 1", "Stage 2"],
    items: ["Item 1", "Item 2"],
  });
  const [one] = await serviceSelect<{ id: string }>(
    `project_items?project_id=eq.${projectId}&title=eq.Item%201&select=id`,
  );
  const [tick] = await serviceSelect<{ id: string }>(
    `project_item_stage_list?item_id=eq.${one!.id}&name=eq.Stage%201&select=id`,
  );
  await rpcAs(admin.email, admin.password, "item_stage_tick", { stage_id: tick!.id, done: true });
  await rpcAs(admin.email, admin.password, "item_update", {
    item_id: one!.id,
    changes: { notes: "Kept as it is" },
  });
  // One line with groups of its own (the Release 1 shape beside today's).
  const [line] = await serviceSelect<{ id: string }>(
    `project_item_blueprints?project_id=eq.${projectId}&title=eq.Item%202&select=id`,
  );
  await rpcAs(admin.email, admin.password, "project_blueprint_update", {
    blueprint_id: line!.id,
    changes: {
      stage_groups: [
        { label: null, stages: ["Stage 1"] },
        { label: "Phase A", stages: ["One", "Two"] },
      ],
    },
  });

  const of = (table: string, column = "project_id") =>
    serviceSelect<{ id: string }>(`${table}?${column}=eq.${projectId}&select=*&order=id`);
  const snapshot = async () => ({
    project: await of("projects", "id"),
    stages: await of("project_stages"),
    lines: await of("project_item_blueprints"),
    cycles: await of("project_cycles"),
    items: await of("project_items"),
    ticks: await of("project_item_stage_list"),
  });
  const before = await snapshot();
  const ids = [
    projectId,
    ...before.items.map((row) => row.id),
    ...before.lines.map((row) => row.id),
    ...before.stages.map((row) => row.id),
  ];
  const history = `activity_log?entity_id=in.(${ids.join(",")})&select=id,entity,entity_id,action,diff,meta,at&order=id`;
  const historyBefore = await serviceSelect<{ id: number }>(history);

  await page.goto(`/clients/${clientId}/projects/${projectId}`);
  await hydrated(page);
  await page.getByRole("button", { name: "Actions for Existing work" }).click();
  await page.getByRole("menuitem", { name: "Save as template" }).click();
  const dialog = page.getByRole("dialog", { name: "Save as template" });
  await expect(dialog.getByLabel("Template name")).toHaveValue("Existing work");
  await dialog.getByLabel("Template name").fill(template);
  await dialog.getByRole("button", { name: "Save template" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText(`Saved as the template ${template}`)).toBeVisible();

  const [saved] = await serviceSelect<TemplateRow & { recurrence: string }>(
    `project_templates?name=eq.${encodeURIComponent(template)}&archived_at=is.null&select=id,recurrence,stages,items,stage_groups,deliverables`,
  );
  expect(saved?.recurrence).toBe("monthly");
  expect(saved?.stage_groups).toEqual([{ label: null, stages: ["Stage 1", "Stage 2"] }]);
  expect(saved?.deliverables).toEqual([
    { title: "Item 1", stage_groups: [{ label: null, stages: ["Stage 1", "Stage 2"] }] },
    {
      title: "Item 2",
      stage_groups: [
        { label: null, stages: ["Stage 1"] },
        { label: "Phase A", stages: ["One", "Two"] },
      ],
    },
  ]);
  expect(saved?.stages).toEqual(["Stage 1", "Stage 2"]);
  expect(saved?.items).toEqual(["Item 1", "Item 2"]);

  // Nothing on the project changed: every tick, date, note, line and history row as it was, and
  // one new history row says what happened.
  expect(await snapshot()).toEqual(before);
  const historyAfter = await serviceSelect<{
    id: number;
    entity: string;
    action: string;
    meta: unknown;
  }>(history);
  expect(historyAfter.slice(0, historyBefore.length)).toEqual(historyBefore);
  expect(
    historyAfter.slice(historyBefore.length).map((row) => [row.entity, row.action, row.meta]),
  ).toEqual([["projects", "saved_as_template", { template_id: saved?.id, name: template }]]);

  // The toast leads to Settings → Templates, where it is listed with its counts.
  await page.getByRole("button", { name: "Open templates" }).click();
  await expect(page).toHaveURL(/\/settings\/templates$/);
  await expect(page.locator('[data-slot="project-template"]', { hasText: template })).toContainText(
    "2 deliverables · 5 stages",
  );
  await removeClientFixture(client);
  await removeTemplate(template);
});

test("the library's search narrows both lists; a preview opens and back closes it", async ({
  page,
}, info) => {
  const alpha = nameOf(info, "lib alpha");
  const beta = nameOf(info, "lib beta");
  const gamma = nameOf(info, "lib gamma");
  for (const name of [alpha, beta]) await removeTemplate(name);
  await removeDeliverableTemplate(gamma);
  const groups = [{ label: "Phase A", stages: ["One", "Two"] }];
  // A word only alpha's deliverable carries, made for this run.
  const word = `kite${info.project.name.replace(/[^a-z]/g, "")}`;
  await insertAs(USERS.admin.email, USERS.admin.password, "project_templates", {
    name: alpha,
    recurrence: "monthly",
    stage_groups: [],
    deliverables: [{ title: `Item ${word}`, stage_groups: groups }],
  });
  await insertAs(USERS.admin.email, USERS.admin.password, "project_templates", {
    name: beta,
    recurrence: "weekly",
    stage_groups: [],
    deliverables: [{ title: "Item", stage_groups: null }],
  });
  await insertAs(USERS.admin.email, USERS.admin.password, "deliverable_templates", {
    name: gamma,
    stage_groups: groups,
  });
  await runInstalled(page);
  await page.goto("/settings/templates#projects");
  await hydrated(page);
  const here = /\/settings\/templates#projects$/;
  const projectRow = (name: string) =>
    page.locator('[data-slot="project-template"]', { hasText: name });
  const deliverableRow = (name: string) =>
    page.locator('[data-slot="deliverable-template"]', { hasText: name });
  await expect(projectRow(alpha)).toBeVisible();
  await expect(projectRow(beta)).toBeVisible();
  // On a phone each section is a segment (6b.6 owner note): Deliverables shows its own.
  await templatesTab(page, "deliverables");
  await expect(deliverableRow(gamma)).toBeVisible();
  await templatesTab(page, "projects");

  // Each row says what its buttons do ("say what it does", v1.7.1): Preview in words, Edit and
  // Archive (D6, named Archive again 2026-10-21) named for the template (a tooltip on a laptop; in the row's ⋯ sheet on a phone).
  // V4: the shared Settings row actions, compact 32px icons on a laptop (DESIGN §6), Preview a
  // 44px labelled button at every width.
  for (const [row, name, tab] of [
    [projectRow(alpha), alpha, "projects"],
    [deliverableRow(gamma), gamma, "deliverables"],
  ] as const) {
    await templatesTab(page, tab);
    await expect(row.getByRole("button", { name: `Preview ${name}` })).toHaveText("Preview");
    expect(
      (await boxOf(row.getByRole("button", { name: `Preview ${name}` }))).h,
    ).toBeGreaterThanOrEqual(44);
    for (const verb of phone(page) ? [] : ["Edit", "Archive"]) {
      const button = row.getByRole("button", { name: `${verb} ${name}` });
      await expect(button).toHaveAttribute("title", `${verb} ${name}`);
      expect((await boxOf(button)).h).toBeGreaterThanOrEqual(32);
    }
  }
  await templatesTab(page, "projects");

  // A deliverable's title finds its template; the others leave, every list at once (the one
  // search over all four sections; on a phone each segment counts its matches).
  const search = page.getByRole("searchbox", { name: "Search stage presets and templates" });
  await search.fill(word);
  await expect(projectRow(alpha)).toBeVisible();
  await expect(projectRow(beta)).toHaveCount(0);
  await expect(deliverableRow(gamma)).toHaveCount(0);
  if (phone(page)) {
    await expect(page.locator("#tab-projects")).toContainText("1");
    await expect(page.locator("#tab-deliverables")).toContainText("0");
  }
  await templatesTab(page, "deliverables");
  await expect(page.locator('[data-slot="deliverable-templates-none"]')).toBeVisible();
  await search.fill(gamma);
  await expect(deliverableRow(gamma)).toBeVisible();
  await expect(projectRow(alpha)).toHaveCount(0);
  await templatesTab(page, "projects");
  await expectNoHorizontalScroll(page);

  // The preview: what a project from it gets; back closes it and only it (the search is a view
  // control: it added no history, so the page stays).
  await search.fill(word);
  await projectRow(alpha)
    .getByRole("button", { name: `Preview ${alpha}` })
    .click();
  const preview = page.getByRole("dialog", { name: `Preview ${alpha}` });
  await expect(preview).toBeVisible();
  await expect(preview.locator('[data-slot="preview-deliverable-title"]')).toHaveText([
    `Item ${word}`,
  ]);
  await expect(preview.locator('[data-slot="preview-group-label"]')).toHaveText(["Phase A"]);
  await expectBackStack(page, [{ closes: preview, url: here }]);
  await expect(search).toHaveValue(word);

  // A deliverable template's preview too.
  await search.fill(gamma);
  await templatesTab(page, "deliverables");
  await deliverableRow(gamma)
    .getByRole("button", { name: `Preview ${gamma}` })
    .click();
  const second = page.getByRole("dialog", { name: `Preview ${gamma}` });
  await expect(second.locator('[data-slot="preview-stage"]')).toHaveText(["One", "Two"]);
  await expectBackStack(page, [{ closes: second, url: here }]);
  for (const name of [alpha, beta]) await removeTemplate(name);
  await removeDeliverableTemplate(gamma);
});

test("deliverable templates: an Admin adds and archives their own, edits only theirs; the Owner any; the builder offers them", async ({
  page,
  browser,
}, info) => {
  const mine = nameOf(info, "dt mine");
  const theirs = nameOf(info, "dt owner");
  const other = nameOf(info, "dt other");
  for (const name of [mine, theirs, other]) await removeDeliverableTemplate(name);
  await insertAs(USERS.owner.email, USERS.owner.password, "deliverable_templates", {
    name: theirs,
    stage_groups: [{ label: null, stages: ["One"] }],
  });
  await insertAs(USERS.admin.email, USERS.admin.password, "deliverable_templates", {
    name: other,
    stage_groups: [{ label: "Phase B", stages: ["Three", "Four"] }],
  });

  await page.goto("/settings/templates#deliverables");
  await hydrated(page);
  // Add one: a typed group in the StageGroupsEditor, the live preview, then Add.
  await page.getByRole("button", { name: "Add deliverable template" }).click();
  const dialog = page.getByRole("dialog", { name: "Add a deliverable template" });
  await dialog.getByLabel("Name", { exact: true }).fill(mine);
  await dialog.getByRole("button", { name: "Add a group" }).click();
  await dialog.getByLabel("New group", { exact: true }).fill("Phase A");
  await dialog.getByLabel("Stages of the new group").fill("One\nTwo");
  await dialog.getByRole("button", { name: "Add group" }).click();
  await expectValues(dialog.locator('[data-slot="group-name"]'), ["Phase A"]);
  if (phone(page)) {
    await dialog.getByRole("button", { name: "Preview and save" }).click();
    const layer = page.getByRole("dialog", { name: "Preview" });
    await expect(layer.locator('[data-slot="preview-stage"]')).toHaveText(["One", "Two"]);
    await layer.getByRole("button", { name: "Add template" }).click();
  } else {
    await expect(
      dialog.locator('[data-slot="deliverable-template-preview"] [data-slot="preview-stage"]'),
    ).toHaveText(["One", "Two"]);
    await dialog.getByRole("button", { name: "Add template" }).click();
  }
  await expect(dialog).toBeHidden();
  const row = (name: string) =>
    page.locator('[data-slot="deliverable-template"]', { hasText: name });
  await expect(row(mine)).toContainText("1 group · 2 stages · by you");
  const [saved] = await serviceSelect<{ stage_groups: unknown }>(
    `deliverable_templates?name=eq.${encodeURIComponent(mine)}&select=stage_groups`,
  );
  expect(saved?.stage_groups).toEqual([{ label: "Phase A", stages: ["One", "Two"] }]);

  // The Owner's: previewed, never edited or archived by the Admin.
  await expect(row(theirs).getByRole("button", { name: `Preview ${theirs}` })).toBeVisible();
  await expect(row(theirs).getByRole("button", { name: `Edit ${theirs}` })).toHaveCount(0);
  await expect(row(theirs).getByRole("button", { name: `Archive ${theirs}` })).toHaveCount(0);

  // The project template builder's "Add deliverables" row offers them: the groups come along.
  await templatesTab(page, "projects");
  await page.getByRole("button", { name: "Add project template" }).click();
  const builder = page.getByRole("dialog", { name: "Add a project template" });
  const add = builder.locator('[data-slot="add-deliverables"]');
  await add.getByRole("combobox", { name: "From a deliverable template" }).click();
  await page.getByRole("option", { name: other }).click();
  await expect(add.getByLabel("Deliverable name")).toHaveValue(other);
  await add.getByLabel("How many").fill("2");
  await add.getByRole("button", { name: "Add", exact: true }).click();
  const made = builder.locator('[data-slot="deliverable"]');
  await expect(made.locator('[data-slot="deliverable-title"]')).toHaveText([
    `${other} 1`,
    `${other} 2`,
  ]);
  await expect(made.locator('[data-slot="deliverable-subtitle"]')).toHaveText([
    "Own stages · 1 group · 2 stages",
    "Own stages · 1 group · 2 stages",
  ]);
  await builder.getByRole("button", { name: "Cancel" }).click();
  await page
    .getByRole("alertdialog", { name: "Discard this template?" })
    .getByRole("button", { name: "Discard template" })
    .click();
  await expect(builder).toBeHidden();

  // Archive their own (D6: with its reason); Undo brings it back.
  await templatesTab(page, "deliverables");
  await rowAction(page, row(mine), mine, "Archive");
  const archive = page.getByRole("dialog", { name: `Archive ${mine}?` });
  await archive.getByLabel("Why archive it").fill("Not used any more");
  const commit = archive.getByRole("button", { name: `Archive ${mine}` });
  // Archive is never red (owner 2026-10-21): its named commit is the neutral primary.
  await expect(commit).toHaveAttribute("data-variant", "primary");
  await commit.click();
  await expect(archive).toBeHidden();
  await expect(row(mine)).toHaveCount(0);
  const [archived] = await serviceSelect<{ archived_reason: string | null }>(
    `deliverable_templates?name=eq.${encodeURIComponent(mine)}&select=archived_reason`,
  );
  expect(archived?.archived_reason).toBe("Not used any more");
  await expect(page.locator('[data-slot="archived-deliverable-template"]')).toHaveCount(0);
  await page
    .locator("[data-sonner-toast]", { hasText: `${mine} archived` })
    .getByRole("button", { name: "Undo" })
    .click();
  await expect(row(mine)).toBeVisible();

  // The Owner edits any template, an Admin's too.
  const context = await browser.newContext({ storageState: storageStateFor("owner") });
  const ownerPage = await context.newPage();
  await ownerPage.goto("/settings/templates#deliverables");
  await hydrated(ownerPage);
  const ownerRow = (name: string) =>
    ownerPage.locator('[data-slot="deliverable-template"]', { hasText: name });
  const editLabel = (name: string) => (phone(ownerPage) ? `Actions for ${name}` : `Edit ${name}`);
  await expect(ownerRow(other).getByRole("button", { name: editLabel(other) })).toBeVisible();
  await expect(ownerRow(theirs).getByRole("button", { name: editLabel(theirs) })).toBeVisible();
  await rowAction(ownerPage, ownerRow(other), other, "Edit");
  const edit = ownerPage.getByRole("dialog", { name: `Edit ${other}` });
  await edit.getByLabel("Name", { exact: true }).fill(`${other} v2`);
  if (phone(ownerPage)) {
    await edit.getByRole("button", { name: "Preview and save" }).click();
    await ownerPage
      .getByRole("dialog", { name: "Preview" })
      .getByRole("button", { name: "Save template" })
      .click();
  } else {
    await edit.getByRole("button", { name: "Save template" }).click();
  }
  await expect(edit).toBeHidden();
  await expect(ownerRow(`${other} v2`)).toBeVisible();
  await context.close();
  for (const name of [mine, theirs, other, `${other} v2`]) await removeDeliverableTemplate(name);
});

test.describe("the deliverable template builder's layers, installed (ARCHITECTURE §14.2)", () => {
  test("back closes the Preview, then asks before losing the typed template", async ({ page }) => {
    await runInstalled(page);
    await page.goto("/settings/templates#deliverables");
    await hydrated(page);
    const here = /\/settings\/templates#deliverables$/;
    await page.getByRole("button", { name: "Add deliverable template" }).click();
    const dialog = page.getByRole("dialog", { name: "Add a deliverable template" });
    await expect(dialog).toBeVisible();
    await expectBackStack(page, [{ closes: dialog, url: here }]);

    await page.getByRole("button", { name: "Add deliverable template" }).click();
    await dialog.getByLabel("Name", { exact: true }).fill("Half a template");
    if (phone(page)) {
      await dialog.getByRole("button", { name: "Preview and save" }).click();
      const preview = page.getByRole("dialog", { name: "Preview" });
      await expect(preview).toBeVisible();
      await expectBackStack(page, [{ closes: preview, url: here }]);
      await expect(dialog).toBeVisible();
    }
    const discard = page.getByRole("alertdialog", { name: "Discard this template?" });
    await page.goBack();
    await expect(discard).toBeVisible();
    await page.goBack();
    await expect(discard).toBeHidden();
    await expect(dialog.getByLabel("Name", { exact: true })).toHaveValue("Half a template");
    await page.goBack();
    await discard.getByRole("button", { name: "Discard template" }).click();
    await expect(dialog).toBeHidden();
    await expect(page).toHaveURL(here);
  });
});

test("the Owner deletes a used project template: the confirm says what happens, the projects keep everything and read “(deleted)”; an Admin has no Delete (V5a 6b)", async ({
  page,
  browser,
}, info) => {
  const client = nameOf(info, "delete client");
  const template = nameOf(info, "delete me");
  const clientId = await workClient(client);
  await removeTemplate(template);
  const admin = USERS.admin;
  const made = await insertAs<{ id: string }>(admin.email, admin.password, "project_templates", {
    name: template,
    recurrence: "monthly",
    stages: ["Shoot", "Edit"],
    items: ["Reel"],
  });
  const create = (name: string) =>
    rpcAs<string>(admin.email, admin.password, "project_create", {
      client_id: clientId,
      name,
      recurrence: "monthly",
      stages: ["Shoot", "Edit"],
      items: ["Reel"],
      template_id: made.id,
    });
  const openId = await create("Open from template");
  const closedId = await create("Closed from template");
  await rpcAs(admin.email, admin.password, "project_cancel", {
    project_id: closedId,
    reason: "Neutral reason",
  });
  const shape = async (projectId: string) => ({
    stages: await serviceSelect(`project_stages?project_id=eq.${projectId}&select=*&order=id`),
    lines: await serviceSelect(
      `project_item_blueprints?project_id=eq.${projectId}&select=*&order=id`,
    ),
    cycles: await serviceSelect(`project_cycles?project_id=eq.${projectId}&select=*&order=id`),
    items: await serviceSelect(`project_items?project_id=eq.${projectId}&select=*&order=id`),
  });
  const before = { open: await shape(openId), closed: await shape(closedId) };

  // An Admin (even its author) has no Delete: Edit and Archive only.
  await page.goto("/settings/templates#projects");
  await hydrated(page);
  const adminRow = page.locator('[data-slot="project-template"]', { hasText: template });
  await expect(adminRow).toBeVisible();
  if (phone(page)) {
    await adminRow.getByRole("button", { name: `Actions for ${template}` }).click();
    const sheet = page.getByRole("dialog", { name: template, exact: true });
    await expect(sheet.getByRole("button", { name: "Archive", exact: true })).toBeVisible();
    await expect(sheet.getByRole("button", { name: "Delete", exact: true })).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(sheet).toBeHidden();
  } else {
    await expect(adminRow.getByRole("button", { name: `Archive ${template}` })).toBeVisible();
    await expect(adminRow.getByRole("button", { name: `Delete ${template}` })).toHaveCount(0);
  }

  // The Owner: Edit · Archive · Delete; the confirm reads the use first and says what happens.
  const context = await browser.newContext({ storageState: storageStateFor("owner") });
  const ownerPage = await context.newPage();
  await ownerPage.goto("/settings/templates#projects");
  await hydrated(ownerPage);
  const row = ownerPage.locator('[data-slot="project-template"]', { hasText: template });
  await rowAction(ownerPage, row, template, "Delete");
  const confirm = ownerPage.getByRole("alertdialog", { name: `Delete template “${template}”?` });
  await expect(confirm).toContainText(
    `Used by 2 projects (1 still open). They keep all their deliverables, stages and months exactly as they are. Their details will show “Template: ${template} (deleted)”. New projects can't use it any more. This can't be undone.`,
  );
  await expect(confirm.getByRole("button", { name: "Keep it" })).toBeVisible();
  const commit = confirm.getByRole("button", { name: `Delete ${template}` });
  // Final, so red (ADR-0015): the named commit is the danger one.
  await expect(commit).toHaveAttribute("data-variant", "danger");
  await commit.click();
  await expect(confirm).toBeHidden();
  await expect(
    ownerPage.locator("[data-sonner-toast]", { hasText: `${template} deleted` }),
  ).toBeVisible();
  await expect(row).toHaveCount(0);

  const [stored] = await serviceSelect<{
    name: string;
    deleted_at: string | null;
    archived_at: string | null;
  }>(`project_templates?id=eq.${made.id}&select=name,deleted_at,archived_at`);
  expect(stored?.name).toBe(template);
  expect(stored?.deleted_at).not.toBeNull();
  expect(stored?.archived_at).not.toBeNull();
  const history = await serviceSelect<{ action: string; meta: unknown }>(
    `activity_log?entity=eq.project_templates&entity_id=eq.${made.id}&action=eq.deleted&select=action,meta`,
  );
  expect(history).toEqual([
    { action: "deleted", meta: { name: template, kind: "project", used: 2, open: 1 } },
  ]);
  // Nothing on either project changed.
  expect({ open: await shape(openId), closed: await shape(closedId) }).toEqual(before);

  // The project's Details read “‹name› (deleted)”; New project no longer offers it.
  await ownerPage.goto(`/clients/${clientId}/projects/${openId}`);
  await hydrated(ownerPage);
  await expect(ownerPage.locator('[data-slot="detail-template"] dd')).toHaveText(
    `${template} (deleted)`,
  );
  await context.close();

  await page.goto(`/clients/${clientId}/projects/${closedId}`);
  await hydrated(page);
  await expect(page.locator('[data-slot="detail-template"] dd')).toHaveText(
    `${template} (deleted)`,
  );

  await removeClientFixture(client);
  await removeTemplate(template);
});
