import { type Locator, type Page, type TestInfo } from "@playwright/test";

import { expect, test } from "./fixtures";

import { addISTDays, istInstant, istWeekday, todayIST } from "../src/core/time";

import {
  animationsSettled,
  expectBackStack,
  hydrated,
  memberIdOf,
  removeFieldDefinitions,
  removeTaskTypesNamed,
  removeTasksTitled,
  removeTemplatesNamed,
  rowAction,
  rpcAs,
  runInstalled,
  serviceInsert,
  serviceRest,
  serviceSelect,
  signIn,
  storageStateFor,
  taskTypeId,
  USERS,
  openMoreOptions,
  templatesTab,
} from "./helpers";

/**
 * Settings → Task types and per-type task fields, 4C (PRODUCT §4.6, Kickoff 4 decisions 14, 15):
 * the Owner adds an event type with its switches, edits it, moves it, archives it (the create
 * dialog stops offering it, an open task keeps it) and restores it; a task field for one type
 * shows in the create dialog for that type only; an Admin picks from the types but never opens
 * the editor. Installed at 375 and 430px: the new dialogs, the ⋯ sheet, the archive question and
 * the custom field's "Applies to" sheet close on back; the screens at 130% and 200% text.
 *
 * The flows run on the desktop project only: the order of the list is one shared thing, and two
 * projects moving their own new types at the end of it would swap each other's.
 */

test.describe.configure({ mode: "serial" });
test.use({ storageState: storageStateFor("owner") });

function prefixOf(info: TestInfo): string {
  return `Types ${info.project.name} `;
}

/** A weekday (Mon–Fri) at least `offset` days from today, IST, never 2 Oct (a seeded holiday). */
function workingDay(offset: number): string {
  let day = addISTDays(todayIST(), offset);
  while (istWeekday(day) === 0 || istWeekday(day) === 6 || day === "2026-10-02") {
    day = addISTDays(day, 1);
  }
  return day;
}

async function fresh(info: TestInfo): Promise<void> {
  const prefix = prefixOf(info);
  await removeTasksTitled(prefix);
  await removeTaskTypesNamed(prefix);
}

function rowOf(page: Page, name: string): Locator {
  return page.locator('[data-slot="task-type"]:visible').filter({ hasText: name });
}

async function typeNames(page: Page): Promise<string[]> {
  return page
    .locator('[data-slot="task-type"]:visible span.font-medium')
    .allTextContents()
    .then((names) => names.map((name) => name.trim()));
}

async function pick(page: Page, trigger: Locator, option: string | RegExp): Promise<void> {
  await trigger.click();
  await page.getByRole("option", { name: option }).first().click();
  // The list animates closed; until it has, it is the top layer and takes the next Escape.
  await expect(page.getByRole("listbox")).toHaveCount(0);
}

test.describe("task types and per-type fields, the flows", () => {
  test.skip(
    ({ viewport }) => (viewport?.width ?? 1280) < 768,
    "one project: the list's order is shared",
  );

  test("the Owner adds, edits, moves, archives and restores a type; an open task keeps it", async ({
    page,
  }, info) => {
    const prefix = prefixOf(info);
    await fresh(info);
    const name = `${prefix}Recce`;

    await page.goto("/settings");
    await page.getByRole("link", { name: "Task types", exact: true }).click();
    await expect(page).toHaveURL(/\/settings\/task-types$/);
    await page.getByRole("button", { name: "Add task type" }).click();
    const add = page.getByRole("dialog", { name: "Add a task type" });
    await add.getByRole("button", { name: "Add task type" }).click();
    await expect(add.locator('[data-slot="field-error"]').first()).toBeVisible();
    await add.getByLabel("Name").fill(name);
    await add.getByRole("radio", { name: /^Event/ }).check();
    await add.getByLabel("Ask for a location").check();
    await add.getByRole("button", { name: "Add task type" }).click();
    await expect(page.getByText("Task type added")).toBeVisible();
    await expect(rowOf(page, name)).toContainText("Event · on the calendar · asks for a location");
    // A new type takes the palette's default colour (Kickoff 6 decision 25).
    await expect(rowOf(page, name)).toContainText("· Blue");
    // New types go last.
    expect((await typeNames(page)).at(-1)).toBe(name);

    // The kind stays; the name and the switches change.
    await page.getByRole("button", { name: `Edit ${name}` }).click();
    const edit = page.getByRole("dialog", { name: `Edit ${name}` });
    // No kind to choose on an edit (the colours are the only choice left to pick from).
    await expect(edit.locator('[data-slot="task-type-kind"]')).toHaveCount(0);
    await expect(edit.getByRole("radio", { name: /^Event/ })).toHaveCount(0);
    await edit.getByLabel("Name").fill(`${name} visit`);
    await edit.getByLabel("Show these tasks on the calendar").uncheck();
    // Its colour on the calendar: one of the palette, never red (Kickoff 6 decision 25).
    await expect(edit.locator("[data-color]")).toHaveCount(8);
    await expect(edit.locator('[data-color="#dc2626"]')).toHaveCount(0);
    await edit.locator('[data-color="#7c3aed"]').click();
    await expect(edit.getByRole("radio", { name: "Violet" })).toBeChecked();
    await edit.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("Task type saved")).toBeVisible();
    // The switches and the colour: still asks for a location, now off the calendar, violet.
    await expect(rowOf(page, `${name} visit`)).toContainText(
      "Event · not on the calendar · asks for a location · Violet",
    );

    const before = await typeNames(page);
    await page.getByRole("button", { name: `Move ${name} visit up` }).click();
    await expect
      .poll(() => typeNames(page))
      .toEqual([...before.slice(0, -2), `${name} visit`, before.at(-2) ?? ""]);

    // A task of this type, then the type archived: the task keeps it, new tasks are not offered it.
    const [type] = await serviceSelect<{ id: string }>(
      `task_types?name=eq.${encodeURIComponent(`${name} visit`)}&select=id`,
    );
    // Someone no flow counts the tasks of (the freelancers spec's second coordinator).
    const staffId = await memberIdOf(`people-coord2-${info.project.name}@maxoff.local`);
    const day = workingDay(22);
    const taskId = await rpcAs<string>(USERS.owner.email, USERS.owner.password, "task_create", {
      title: `${prefix}recce at the venue`,
      description: null,
      task_type_id: type!.id,
      client_id: null,
      priority: "medium",
      due_at: istInstant(day, "18:00"),
      assignee_ids: [staffId],
      primary_owner_id: staffId,
      approving_admin_id: null,
      event_date: day,
      event_start_at: istInstant(day, "10:00"),
      location: "Bandra",
    });

    await page.getByRole("button", { name: `Archive ${name} visit` }).click();
    await page
      .getByRole("alertdialog")
      .getByRole("button", { name: `Archive ${name} visit` })
      .click();
    // D6: Archive, Undo in its toast; no Archived list.
    await expect(page.getByText(`${name} visit archived`)).toBeVisible();
    await expect(rowOf(page, `${name} visit`)).toHaveCount(0);
    await expect(page.locator('[data-slot="archived-task-type"]')).toHaveCount(0);

    await page.goto(`/tasks/${taskId}`);
    await expect(page.locator("main")).toContainText(`${name} visit`);
    await page.goto("/tasks");
    await page.getByRole("button", { name: "New task" }).click();
    const dialog = page.locator('[data-slot="task-form-dialog"]');
    await openMoreOptions(dialog);
    await dialog.getByLabel("Type").click();
    await expect(page.getByRole("option", { name: "Normal", exact: true })).toBeVisible();
    await expect(page.getByRole("option", { name: `${name} visit` })).toHaveCount(0);
    await page.keyboard.press("Escape");

    await page.goto("/settings/task-types");
    await expect(rowOf(page, `${name} visit`)).toHaveCount(0);
    await removeTasksTitled(prefix);
  });

  test("a task field for one type shows in the create dialog for that type only", async ({
    page,
  }, info) => {
    await fresh(info);
    const key = `venue_notes_${info.project.name.replace("-", "_")}`;
    const label = `Venue notes ${info.project.name}`;
    await removeFieldDefinitions([key]);
    try {
      await page.goto("/settings/custom-fields?entity=task");
      await page.getByRole("button", { name: "Add field" }).first().click();
      const add = page.getByRole("dialog", { name: "Add a field" });
      await pick(page, add.getByLabel("Applies to"), "Meeting only");
      await add.getByLabel("Label").fill(label);
      await expect(add.getByLabel("Key")).toHaveValue(key);
      await add.getByRole("button", { name: "Add field" }).click();
      const group = page.locator('[data-slot="field-group"]').filter({ hasText: "Meeting only" });
      await expect(
        group.locator(`[data-slot="field-definition"][data-key="${key}"]`),
      ).toBeVisible();

      await page.goto("/tasks");
      await page.getByRole("button", { name: "New task" }).click();
      const dialog = page.locator('[data-slot="task-form-dialog"]');
      await expect(dialog.getByLabel("Title")).toBeVisible();
      await expect(dialog.getByLabel(label)).toHaveCount(0);
      await openMoreOptions(dialog);
      await pick(page, dialog.getByLabel("Type"), "Meeting");
      await expect(dialog.getByLabel(label)).toBeVisible();
      await openMoreOptions(dialog);
      await pick(page, dialog.getByLabel("Type"), "Normal");
      await expect(dialog.getByLabel(label)).toHaveCount(0);
    } finally {
      await removeFieldDefinitions([key]);
    }
  });

  test("a type's default reminders: set in its dialog, offered as a task's default, cleared to []", async ({
    page,
  }, info) => {
    await fresh(info);
    const name = `${prefixOf(info)}Reminded`;
    const stored = async () => {
      const [row] = await serviceSelect<{ default_reminders: unknown }>(
        `task_types?name=eq.${encodeURIComponent(name)}&select=default_reminders`,
      );
      return row?.default_reminders;
    };
    try {
      await page.goto("/settings/task-types");
      await page.getByRole("button", { name: "Add task type" }).click();
      const add = page.getByRole("dialog", { name: "Add a task type" });
      await add.getByLabel("Name").fill(name);
      // The same collapsed line as a task's; a type's default is the organisation's list.
      const summary = add.locator('[data-slot="reminder-summary"]');
      await expect(summary).toHaveText(
        "Reminders: 2 days before, 1 day before, when due · Using the default",
      );
      await expect(add.locator('[data-slot="reminder-row"]')).toHaveCount(0);
      await summary.click();
      await add.getByLabel("Reminder 1: how many").fill("5");
      await add.getByRole("button", { name: "Remove reminder 2" }).click();
      await expect(summary).toHaveText("Reminders: 5 days before, when due");
      await add.getByRole("button", { name: "Add task type" }).click();
      await expect(page.getByText("Task type added")).toBeVisible();
      expect(await stored()).toEqual([
        { before: 5, unit: "days" },
        { before: 0, unit: "minutes" },
      ]);

      // A task of that type with no list of its own follows it ("Using the default").
      await page.goto("/tasks");
      await page.getByRole("button", { name: "New task" }).click();
      const dialog = page.locator('[data-slot="task-form-dialog"]');
      await openMoreOptions(dialog);
      await pick(page, dialog.getByLabel("Type"), name);
      await openMoreOptions(dialog);
      await expect(dialog.locator('[data-slot="reminder-summary"]')).toHaveText(
        "Reminders: 5 days before, when due · Using the default",
      );
      await page.keyboard.press("Escape");
      await page
        .getByRole("alertdialog", { name: "Discard this task?" })
        .getByRole("button", { name: "Discard task" })
        .click();
      await expect(dialog).toBeHidden();

      // Use the default clears the type's own list.
      await page.goto("/settings/task-types");
      await page.getByRole("button", { name: `Edit ${name}` }).click();
      const edit = page.getByRole("dialog", { name: `Edit ${name}` });
      await expect(edit.locator('[data-slot="reminder-summary"]')).toHaveText(
        "Reminders: 5 days before, when due",
      );
      await edit.locator('[data-slot="reminder-summary"]').click();
      await edit.getByRole("button", { name: "Use the default" }).click();
      await edit.getByRole("button", { name: "Save" }).click();
      await expect(page.getByText("Task type saved")).toBeVisible();
      expect(await stored()).toEqual([]);
    } finally {
      await fresh(info);
    }
  });
});

test.describe("task types, the Owner's only", () => {
  test.skip(({ viewport }) => viewport?.width === 430, "runs at 1280 and 375px");

  test("an Admin has no Task types row and is refused the editor (Kickoff 4 decision 15)", async ({
    page,
  }) => {
    await page.context().clearCookies();
    await signIn(page, USERS.admin.email, USERS.admin.password);
    await page.goto("/settings");
    await expect(page.locator('[data-slot="settings-list"]')).toContainText("Templates");
    await expect(page.locator('[data-slot="settings-list"]')).not.toContainText("Task types");
    await page.goto("/settings/task-types");
    await expect(page).toHaveURL(/\/forbidden$/);
  });
});

test.describe("task types, installed: back and large text", () => {
  test.skip(({ viewport }) => (viewport?.width ?? 1280) >= 768, "the installed app is a phone");

  test("the Add dialog, a type's ⋯ sheet and its Edit dialog close on back before the page", async ({
    page,
  }) => {
    await runInstalled(page);
    await page.goto("/settings");
    await page.locator('[data-slot="settings-section"]').filter({ hasText: "Task types" }).click();
    const url = /\/settings\/task-types$/;
    await expect(page).toHaveURL(url);

    // C4: "Add task type" sits on the list's heading (was the page's floating button).
    await page
      .locator('[data-slot="list-heading"]')
      .getByRole("button", { name: "Add task type" })
      .click();
    const add = page.getByRole("dialog", { name: "Add a task type" });
    await expect(add).toBeVisible();
    await expectBackStack(page, [{ closes: add, url }]);

    await page.getByRole("button", { name: "Actions for Meeting" }).click();
    const sheet = page.locator('[data-slot="task-type-actions"]');
    await expect(sheet).toBeVisible();
    await expectBackStack(page, [{ closes: sheet, url }]);

    await page.getByRole("button", { name: "Actions for Meeting" }).click();
    await sheet.getByRole("button", { name: "Edit" }).click();
    const edit = page.getByRole("dialog", { name: "Edit Meeting" });
    await expect(edit).toBeVisible();
    await expectBackStack(page, [{ closes: edit, url }]);

    // The sheet hands off to the archive question, which one back closes (nothing archived).
    await page.getByRole("button", { name: "Actions for Meeting" }).click();
    await sheet.getByRole("button", { name: "Archive" }).click();
    const archive = page.getByRole("alertdialog", { name: "Archive Meeting?" });
    await expect(archive).toBeVisible();
    await expectBackStack(page, [{ closes: archive, url }, { url: /\/settings$/ }]);
  });

  test("Custom fields → Tasks: the Add dialog's Applies to sheet, then the dialog, close on back", async ({
    page,
  }) => {
    await runInstalled(page);
    await page.goto("/settings/custom-fields?entity=task");
    const url = /\/settings\/custom-fields\?entity=task$/;
    await page.getByRole("button", { name: "Add field" }).first().click();
    const add = page.getByRole("dialog", { name: "Add a field" });
    await add.getByLabel("Applies to").click();
    const sheet = page.locator('[data-slot="select-sheet"]');
    await expect(sheet.getByRole("option", { name: "Meeting only" })).toBeVisible();
    await expectBackStack(page, [
      { closes: sheet, url },
      { closes: add, url },
    ]);
  });

  test("Task types, the Add dialog and task custom fields fit at 130% and 200% text", async ({
    page,
  }) => {
    for (const path of ["/settings/task-types", "/settings/custom-fields?entity=task"]) {
      await page.goto(path);
      await expect(page.locator('[data-slot="skeleton"]')).toHaveCount(0);
      for (const scale of [130, 200]) {
        await page.evaluate((percent) => {
          document.documentElement.style.fontSize = `${percent}%`;
        }, scale);
        await expectFits(page);
      }
      await page.evaluate(() => {
        document.documentElement.style.fontSize = "";
      });
    }
    await page.goto("/settings/task-types");
    // C4: "Add task type" sits on the list's heading (was the page's floating button).
    await page
      .locator('[data-slot="list-heading"]')
      .getByRole("button", { name: "Add task type" })
      .click();
    await page
      .getByRole("dialog", { name: "Add a task type" })
      .getByRole("radio", { name: /^Event/ })
      .check();
    for (const scale of [130, 200]) {
      await page.evaluate((percent) => {
        document.documentElement.style.fontSize = `${percent}%`;
      }, scale);
      await expectFits(page);
    }
  });
});

async function expectFits(page: Page): Promise<void> {
  // Polled: a sheet's padding transitions with the text size (its footer's negative margin does
  // not), so for a moment after the change the footer reaches past the edge; the settled layout
  // is what is checked.
  await expect
    .poll(
      () =>
        page.evaluate(() =>
          [...document.querySelectorAll<HTMLElement>("body *")]
            .filter(
              (el) => el.getBoundingClientRect().right > document.documentElement.clientWidth + 1,
            )
            .slice(0, 5)
            .map(
              (el) => `${el.tagName.toLowerCase()}${el.dataset.slot ? `[${el.dataset.slot}]` : ""}`,
            ),
        ),
      { message: "nothing reaches past the right edge" },
    )
    .toEqual([]);
  const widths = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(widths.scrollWidth).toBeLessThanOrEqual(widths.clientWidth);
}

// Drag to reorder before saving (6b.18): a task template's stages, a stage preset's, the New
// task form's. Each project names its own template and preset, removed first.

const isPhone = (page: Page) => (page.viewportSize()?.width ?? 1280) < 768;

/** The values of a form's stage inputs, in order. */
async function stageValues(rows: Locator): Promise<string[]> {
  return rows
    .locator("input")
    .evaluateAll((inputs) => inputs.map((input) => (input as HTMLInputElement).value));
}

/**
 * Drags `from` by its handle until the pointer is at `at` of `onto`'s height. A mouse drags at
 * once; on a phone a finger holds until the row lifts (`data-dragging`), so nothing waits on a
 * clock. Measures only visible boxes, once nothing is still moving (a phone's bottom sheet
 * slides in over 200 ms, and a row measured mid-slide drops in the wrong place), and fails on a
 * missing one.
 */
async function dragRow(page: Page, from: Locator, onto: Locator, at: number): Promise<void> {
  const handle = from.locator('[data-slot="reorder-handle"]');
  // In the middle of its scroller, as a person would have it, clear of a sticky footer or bar.
  await handle.evaluate((node) => node.scrollIntoView({ block: "center" }));
  await animationsSettled(page);
  const start = await handle.boundingBox();
  const target = await onto.boundingBox();
  expect(start, "the drag handle has a box").not.toBeNull();
  expect(target, "the target row has a box").not.toBeNull();
  const x = start!.x + start!.width / 2;
  const y = start!.y + start!.height / 2;
  const to = target!.y + target!.height * at;
  const indicator = page.locator('[data-slot="reorder-indicator"]:visible');
  if (!isPhone(page)) {
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x, to, { steps: 12 });
    await expect(indicator).toHaveCount(1);
    await page.mouse.up();
    return;
  }
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
  await expect(from).toHaveAttribute("data-dragging", "");
  for (let move = 1; move <= 12; move += 1) {
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x, y: y + ((to - y) * move) / 12 }],
    });
  }
  await expect(indicator).toHaveCount(1);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await cdp.detach();
}

/** A task template of the Owner's with these stages, removed first. */
async function ownerTemplate(name: string, stages: string[]): Promise<void> {
  await removeTemplatesNamed(name);
  const [org] = await serviceSelect<{ id: string }>("organizations?select=id&limit=1");
  await serviceInsert("task_templates", {
    org_id: org?.id,
    name,
    task_type_id: await taskTypeId("Normal"),
    stages,
    created_by: await memberIdOf(USERS.owner.email),
  });
}

/** A stage preset of the Owner's with these stages, removed first. */
async function ownerPreset(name: string, stages: string[]): Promise<void> {
  await serviceRest(`stage_presets?name=eq.${encodeURIComponent(name)}`, { method: "DELETE" });
  const [org] = await serviceSelect<{ id: string }>("organizations?select=id&limit=1");
  await serviceInsert("stage_presets", {
    org_id: org?.id,
    name,
    stages,
    created_by: await memberIdOf(USERS.owner.email),
  });
}

/** Opens a template's Edit dialog: on the row from `md` up, in its ⋯ sheet on a phone. */
async function editTemplate(page: Page, name: string): Promise<Locator> {
  if (isPhone(page)) {
    await page.getByRole("button", { name: `Actions for ${name}` }).click();
    await page
      .locator('[data-slot="task-template-actions"]')
      .getByRole("button", { name: "Edit" })
      .click();
  } else {
    await page
      .getByRole("button", { name: `Edit ${name}` })
      .filter({ visible: true })
      .click();
  }
  const dialog = page.getByRole("dialog", { name: `Edit ${name}` });
  await expect(dialog).toBeVisible();
  return dialog;
}

test.describe("task templates: Archive, grey on the row and neutral in its question (the colour rule)", () => {
  test("the row's Archive (laptop) and the ⋯ sheet's Archive (phone) are grey; the question's named Archive is neutral", async ({
    page,
  }, info) => {
    const name = `Neutral archive (${info.project.name})`;
    await ownerTemplate(name, ["Stage 1"]);
    await page.goto("/settings/templates#tasks");
    await hydrated(page);
    const row = page.locator('[data-slot="task-template"]').filter({ hasText: name });
    const phone = (page.viewportSize()?.width ?? 1280) < 768;
    if (phone) {
      await row.getByRole("button", { name: `Actions for ${name}` }).click();
      const sheet = page.locator('[data-slot="task-template-actions"]');
      const archive = sheet.getByRole("button", { name: "Archive" });
      await expect(archive).toHaveAttribute("data-variant", "secondary");
      await archive.click();
    } else {
      const archive = row.getByRole("button", { name: `Archive ${name}` });
      await expect(archive).toHaveAttribute("data-variant", "ghost");
      await archive.click();
    }
    // The question confirms it with one named commit, the neutral primary: archive is never red
    // (owner 2026-10-21, ADR-0015); the row's own Archive stays grey.
    const question = page.getByRole("alertdialog", { name: `Archive ${name}?` });
    await expect(question.getByRole("button", { name: `Archive ${name}` })).toHaveAttribute(
      "data-variant",
      "primary",
    );
    await removeTemplatesNamed(name);
  });
});

test.describe("drag to reorder stages before saving (6b.18)", () => {
  test("a task template's stages: dragged, moved from ⋯, saved in that order", async ({
    page,
  }, info) => {
    const name = `Reorder template (${info.project.name})`;
    await ownerTemplate(name, ["Stage 1", "Stage 2", "Stage 3"]);
    await page.goto("/settings/templates#tasks");
    await hydrated(page);
    const dialog = await editTemplate(page, name);
    const rows = dialog.locator('[data-slot="template-stage"]');
    await expect(rows).toHaveCount(3);
    const handle = await rows.nth(0).locator('[data-slot="reorder-handle"]').boundingBox();
    expect(handle, "the handle has a box").not.toBeNull();
    expect(Math.round(handle!.width)).toBe(44);
    expect(Math.round(handle!.height)).toBe(44);

    // Stage 3 dragged above Stage 1.
    await dragRow(page, rows.nth(2), rows.nth(0), 0.2);
    await expect.poll(() => stageValues(rows)).toEqual(["Stage 3", "Stage 1", "Stage 2"]);
    // Move down from its ⋯ menu, the keyboard way.
    await rows.nth(0).getByRole("button", { name: "Actions for Stage 3" }).click();
    await page.getByRole("menuitem", { name: "Move down" }).click();
    await expect.poll(() => stageValues(rows)).toEqual(["Stage 1", "Stage 3", "Stage 2"]);

    await dialog.getByRole("button", { name: "Save template" }).click();
    await expect(dialog).toBeHidden();
    await expect
      .poll(async () => {
        const [row] = await serviceSelect<{ stages: string[] }>(
          `task_templates?name=eq.${encodeURIComponent(name)}&archived_at=is.null&select=stages`,
        );
        return row?.stages;
      })
      .toEqual(["Stage 1", "Stage 3", "Stage 2"]);
    // Opened again after a reload, it shows the saved order.
    await page.reload();
    await hydrated(page);
    const again = await editTemplate(page, name);
    await expect
      .poll(() => stageValues(again.locator('[data-slot="template-stage"]')))
      .toEqual(["Stage 1", "Stage 3", "Stage 2"]);
    await removeTemplatesNamed(name);
  });

  test("a stage preset's stages: dragged, one removed and one added, saved in that order", async ({
    page,
  }, info) => {
    const name = `Reorder preset (${info.project.name})`;
    await ownerPreset(name, ["Stage 1", "Stage 2", "Stage 3"]);
    await page.goto("/settings/templates#presets");
    await hydrated(page);
    const row = page.locator('[data-slot="stage-preset"]', { hasText: name });
    await expect(row).toContainText("Stage 1 → Stage 2 → Stage 3");
    // V2 (P2): on a phone a Settings row's Edit sits in its ⋯ sheet.
    await rowAction(page, row, name, "Edit");
    const dialog = page.getByRole("dialog", { name: `Edit ${name}` });
    const rows = dialog.locator('[data-slot="preset-stage"]');
    await expect(rows).toHaveCount(3);

    // Stage 1 dragged below Stage 3.
    await dragRow(page, rows.nth(0), rows.nth(2), 0.8);
    await expect.poll(() => stageValues(rows)).toEqual(["Stage 2", "Stage 3", "Stage 1"]);
    await rows.nth(1).getByRole("button", { name: "Actions for Stage 3" }).click();
    await page.getByRole("menuitem", { name: "Remove stage" }).click();
    await dialog.getByRole("button", { name: "Add stage" }).click();
    await dialog.getByLabel("Stage 3", { exact: true }).fill("Stage 4");
    await expect.poll(() => stageValues(rows)).toEqual(["Stage 2", "Stage 1", "Stage 4"]);

    await dialog.getByRole("button", { name: "Save preset" }).click();
    await expect(dialog).toBeHidden();
    await expect(row).toContainText("Stage 2 → Stage 1 → Stage 4");
    const [saved] = await serviceSelect<{ stages: string[] }>(
      `stage_presets?name=eq.${encodeURIComponent(name)}&select=stages`,
    );
    expect(saved?.stages).toEqual(["Stage 2", "Stage 1", "Stage 4"]);
    await serviceRest(`stage_presets?name=eq.${encodeURIComponent(name)}`, { method: "DELETE" });
  });

  test("the New task form's stages reorder before the task is made", async ({ page }, info) => {
    test.skip(info.project.name !== "desktop", "the same list as the template's, on a laptop");
    await page.goto("/tasks");
    await hydrated(page);
    await page.getByRole("button", { name: "New task" }).filter({ visible: true }).click();
    const form = page.getByRole("dialog", { name: "New task" });
    await expect(form).toBeVisible();
    for (const stage of ["Stage 1", "Stage 2"]) {
      await openMoreOptions(form);
      await form.getByRole("button", { name: "Add stage" }).click();
      await form.getByLabel(`Stage ${stage.slice(-1)}`, { exact: true }).fill(stage);
    }
    await openMoreOptions(form);
    const rows = form.locator('[data-slot="task-stage-field"]');
    await dragRow(page, rows.nth(1), rows.nth(0), 0.2);
    await expect.poll(() => stageValues(rows)).toEqual(["Stage 2", "Stage 1"]);
  });
});

test.describe("drag to reorder, installed (6b.18): a stage's ⋯ menu closes on back before its dialog", () => {
  test.skip(({ isMobile }) => !isMobile, "the installed back gesture is a phone's");

  test("in a task template's dialog and a stage preset's", async ({ page }, info) => {
    const template = `Reorder back template (${info.project.name})`;
    const preset = `Reorder back preset (${info.project.name})`;
    await ownerTemplate(template, ["Stage 1", "Stage 2"]);
    await ownerPreset(preset, ["Stage 1", "Stage 2"]);
    await runInstalled(page);

    await page.goto("/settings/templates#tasks");
    await hydrated(page);
    const templates = /\/settings\/templates#tasks$/;
    const edit = await editTemplate(page, template);
    await edit.getByRole("button", { name: "Actions for Stage 1" }).click();
    const menu = page.getByRole("menu");
    await expect(menu).toBeVisible();
    await expectBackStack(page, [
      { closes: menu, url: templates },
      { closes: edit, url: templates },
    ]);

    // The same page's Stage presets section: on a phone its segment (a view control, no load).
    await templatesTab(page, "presets");
    const presets = templates;
    // V2 (P2): on a phone a Settings row's Edit sits in its ⋯ sheet.
    await rowAction(
      page,
      page.locator('[data-slot="stage-preset"]', { hasText: preset }),
      preset,
      "Edit",
    );
    const dialog = page.getByRole("dialog", { name: `Edit ${preset}` });
    await dialog.getByRole("button", { name: "Actions for Stage 2" }).click();
    await expect(menu).toBeVisible();
    await expectBackStack(page, [
      { closes: menu, url: presets },
      { closes: dialog, url: presets },
    ]);
    await removeTemplatesNamed(template);
    await serviceRest(`stage_presets?name=eq.${encodeURIComponent(preset)}`, { method: "DELETE" });
  });
});
