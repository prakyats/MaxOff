import { type Locator, type Page, type TestInfo } from "@playwright/test";

import { expect, test } from "./fixtures";

import { addISTDays, istInstant, istWeekday, todayIST } from "../src/core/time";

import {
  expectBackStack,
  memberIdOf,
  removeFieldDefinitions,
  removeTaskTypesNamed,
  removeTasksTitled,
  rpcAs,
  runInstalled,
  serviceSelect,
  signIn,
  storageStateFor,
  USERS,
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
    await expect(rowOf(page, `${name} visit`)).toContainText(
      "Event · not on the calendar · Violet",
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
    await expect(page.getByText("Task type archived")).toBeVisible();
    await expect(
      page.locator('[data-slot="archived-task-type"]').filter({ hasText: `${name} visit` }),
    ).toBeVisible();

    await page.goto(`/tasks/${taskId}`);
    await expect(page.locator("main")).toContainText(`${name} visit`);
    await page.goto("/tasks");
    await page.getByRole("button", { name: "New task" }).click();
    const dialog = page.locator('[data-slot="task-form-dialog"]');
    await dialog.getByLabel("Type").click();
    await expect(page.getByRole("option", { name: "Normal", exact: true })).toBeVisible();
    await expect(page.getByRole("option", { name: `${name} visit` })).toHaveCount(0);
    await page.keyboard.press("Escape");

    await page.goto("/settings/task-types");
    await page
      .locator('[data-slot="archived-task-type"]')
      .filter({ hasText: `${name} visit` })
      .getByRole("button", { name: "Restore" })
      .click();
    await expect(page.getByText("Task type restored")).toBeVisible();
    await expect(rowOf(page, `${name} visit`)).toBeVisible();
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
      await pick(page, dialog.getByLabel("Type"), "Meeting");
      await expect(dialog.getByLabel(label)).toBeVisible();
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
      await pick(page, dialog.getByLabel("Type"), name);
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

    await page
      .locator('[data-slot="page-actions"]')
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
    await expect(
      page.locator('[data-slot="archived-task-type"]').filter({ hasText: "Meeting" }),
    ).toHaveCount(0);
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
    await page
      .locator('[data-slot="page-actions"]')
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
