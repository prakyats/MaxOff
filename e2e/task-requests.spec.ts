import { type Locator, type Page, type TestInfo } from "@playwright/test";

import { expect, test } from "./fixtures";

import { addISTDays, istWeekday, todayIST } from "../src/core/time";

import {
  expectBackStack,
  pageHeader,
  removeRequestsTitled,
  removeTasksTitled,
  removeTemplatesNamed,
  rpcAs,
  runInstalled,
  serviceSelect,
  signIn,
  USERS,
} from "./helpers";

/**
 * Task requests and templates, 4C (task 4.6; PRODUCT §4.6, WORKFLOWS §3.4, §3.5, Kickoff 4
 * decision 19): Staff suggest a task; the Owner makes it a task from the suggestion; an Admin
 * declines one with a reason; the suggester withdraws one; an Admin adds a template in Settings,
 * starts a task from it, edits and archives it. Installed at 375 and 430px: the back order of the
 * new screens, dialogs and sheets; and the screens at 130% and 200% text.
 *
 * One set of people per project (`req-staff-<project>` and the task lists' Admin,
 * `list-admin-<project>`, `supabase/seed.sql`) and one title prefix, so the projects run side by
 * side; the tests of a project run in order.
 */

test.describe.configure({ mode: "serial" });

function people(info: TestInfo) {
  const project = info.project.name;
  return {
    staff: {
      email: `req-staff-${project}@maxoff.local`,
      password: "req-local-password",
      name: `Test Request Staff (${project})`,
    },
    admin: {
      email: `list-admin-${project}@maxoff.local`,
      password: "list-local-password",
    },
  };
}

function prefixOf(info: TestInfo): string {
  return `Req ${info.project.name} `;
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
  await removeRequestsTitled(prefix);
  await removeTasksTitled(prefix);
  await removeTemplatesNamed(prefix);
}

async function signInAs(page: Page, who: { email: string; password: string }): Promise<void> {
  await page.context().clearCookies();
  await signIn(page, who.email, who.password);
}

function requestRow(page: Page, title: string): Locator {
  return page.locator('[data-slot="task-request"]:visible').filter({ hasText: title });
}

async function pick(page: Page, trigger: Locator, option: string | RegExp): Promise<void> {
  await trigger.click();
  await page.getByRole("option", { name: option }).first().click();
}

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** A template row's Edit or Archive: on the row from `md` up, in its ⋯ sheet on a phone. */
async function templateAction(page: Page, name: string, action: "Edit" | "Archive") {
  if ((page.viewportSize()?.width ?? 1280) >= 768) {
    await page
      .getByRole("button", { name: `${action} ${name}` })
      .filter({ visible: true })
      .click();
    return;
  }
  await page.getByRole("button", { name: `Actions for ${name}` }).click();
  await page
    .locator('[data-slot="task-template-actions"]')
    .getByRole("button", { name: action })
    .click();
}

async function suggest(info: TestInfo, title: string): Promise<string> {
  const { staff } = people(info);
  return rpcAs<string>(staff.email, staff.password, "task_request_create", { title });
}

test.describe("task requests and templates, the flows", () => {
  // The flows prove behaviour, which 55px of width does not change: 1280 and 375px only.
  test.skip(({ viewport }) => viewport?.width === 430, "flows run at 1280 and 375px");

  test("Staff suggest a task; the Owner makes it a task from the suggestion", async ({
    page,
  }, info) => {
    const prefix = prefixOf(info);
    await fresh(info);
    const { staff } = people(info);
    const title = `${prefix}reel for the launch`;

    await signInAs(page, staff);
    await page.goto("/tasks");
    await expect(pageHeader(page)).toHaveText(/My tasks/);
    await page.locator('[data-slot="suggest-task"]:visible').click();
    const dialog = page.getByRole("dialog", { name: "Suggest a task" });
    await dialog.getByRole("button", { name: "Send suggestion" }).click();
    await expect(dialog.locator('[data-slot="field-error"]').first()).toBeVisible();
    await dialog.getByLabel("What needs doing").fill(title);
    await dialog.getByLabel("Details (optional)").fill("The brief: https://example.com/brief");
    await dialog.getByRole("button", { name: "Send suggestion" }).click();
    await expect(page.getByText("Suggestion sent")).toBeVisible();
    await expect(dialog).toBeHidden();

    await page.locator('[data-slot="tasks-requests"]:visible').click();
    await expect(page).toHaveURL(/\/tasks\/requests$/);
    await expect(requestRow(page, title)).toContainText("Suggested by you");
    await expect(requestRow(page, title).getByRole("link", { name: /example\.com/ })).toBeVisible();
    await expect(requestRow(page, title).getByRole("button", { name: "Withdraw" })).toBeVisible();
    await expect(
      requestRow(page, title).getByRole("button", { name: "Make it a task" }),
    ).toHaveCount(0);

    // The Owner: no "Suggest a task" (task_requests.create is Staff's and Admins'), Make it a task.
    await signInAs(page, USERS.owner);
    await page.goto("/tasks/requests");
    await expect(page.locator('[data-slot="suggest-task"]')).toHaveCount(0);
    await expect(requestRow(page, title)).toContainText(`Suggested by ${staff.name}`);
    await requestRow(page, title).getByRole("button", { name: "Make it a task" }).click();
    const form = page.locator('[data-slot="task-form-dialog"]');
    await expect(form.getByRole("heading", { name: "Make it a task" })).toBeVisible();
    await expect(form.getByLabel("Title")).toHaveValue(title);
    await expect(form.getByLabel("Description")).toHaveValue(
      "The brief: https://example.com/brief",
    );
    await pick(page, form.getByLabel("Add a person"), new RegExp(`^${escape(staff.name)}`));
    await form.getByLabel("Deadline").fill(workingDay(24));
    await form.getByRole("button", { name: "Create task" }).click();
    await expect(page).toHaveURL(/\/tasks\/[0-9a-f-]{36}$/);
    await expect(pageHeader(page)).toContainText(title);
    const taskId = page.url().split("/").at(-1);
    const [row] = await serviceSelect<{ state: string; task_id: string }>(
      `task_requests?title=eq.${encodeURIComponent(title)}&select=state,task_id`,
    );
    expect(row).toEqual({ state: "converted", task_id: taskId });

    await signInAs(page, staff);
    await page.goto("/tasks/requests");
    await expect(requestRow(page, title)).toContainText("Made a task");
    await expect(requestRow(page, title).getByRole("button")).toHaveCount(0);
  });

  test("an Admin declines one with a reason; the suggester withdraws another", async ({
    page,
  }, info) => {
    const prefix = prefixOf(info);
    await fresh(info);
    const { staff, admin } = people(info);
    const declined = `${prefix}podcast teaser`;
    const withdrawn = `${prefix}new logo sting`;
    await suggest(info, declined);
    await suggest(info, withdrawn);

    await signInAs(page, admin);
    await page.goto("/tasks");
    await expect(page.locator('[data-slot="tasks-requests-waiting"]:visible')).toBeVisible();
    await page.goto("/tasks/requests");
    await requestRow(page, declined).getByRole("button", { name: "Decline…" }).click();
    const reason = page.getByRole("dialog", { name: /Decline/ });
    await reason.getByRole("button", { name: "Decline suggestion" }).click();
    await expect(reason).toBeVisible();
    await reason.getByLabel("Why not").fill("We did one last month");
    await reason.getByRole("button", { name: "Decline suggestion" }).click();
    await expect(page.getByText("Suggestion declined")).toBeVisible();
    await expect(
      page.locator('[data-slot="task-requests-decided"]:visible').filter({ hasText: declined }),
    ).toContainText("We did one last month");

    await signInAs(page, staff);
    await page.goto("/tasks/requests");
    await expect(requestRow(page, declined)).toContainText("Declined");
    await expect(requestRow(page, declined)).toContainText("We did one last month");
    await requestRow(page, withdrawn).getByRole("button", { name: "Withdraw" }).click();
    await page
      .getByRole("alertdialog")
      .getByRole("button", { name: "Withdraw suggestion" })
      .click();
    await expect(page.getByText("Suggestion withdrawn")).toBeVisible();
    await expect(requestRow(page, withdrawn)).toContainText("Withdrawn");
    await expect(requestRow(page, withdrawn).getByRole("button")).toHaveCount(0);
  });

  test("an Admin adds a template, starts a task from it, edits and archives it", async ({
    page,
  }, info) => {
    const prefix = prefixOf(info);
    await fresh(info);
    const { staff, admin } = people(info);
    const name = `${prefix}client call`;

    await signInAs(page, admin);
    await page.goto("/settings");
    await page.locator('[data-slot="settings-section"]').filter({ hasText: "Templates" }).click();
    await expect(page).toHaveURL(/\/settings\/templates$/);
    await page.locator('[data-slot="add-template"]:visible').click();
    const add = page.getByRole("dialog", { name: "Add a template" });
    await add.getByLabel("Name").fill(name);
    await pick(page, add.getByLabel("Type"), "Meeting");
    await pick(page, add.getByLabel("Priority"), "High");
    await add.getByLabel("Description").fill("Agenda first, then the notes.");
    await add.getByRole("button", { name: "Add stage" }).click();
    await add.getByLabel("Stage 1").fill("Send the agenda");
    await add.getByRole("button", { name: "Add template" }).click();
    await expect(page.getByText("Template added")).toBeVisible();
    const row = page.locator('[data-slot="task-template"]:visible').filter({ hasText: name });
    await expect(row).toContainText("Meeting · High · 1 stage · by you");

    // New task → Start from: the type, the priority, the stages and the description.
    await page.goto("/tasks");
    await page.locator('[data-slot="new-task"]:visible').click();
    const form = page.locator('[data-slot="task-form-dialog"]');
    await pick(page, form.getByLabel("Start from"), name);
    await expect(form.getByLabel("Type")).toHaveText("Meeting");
    await expect(form.getByLabel("Priority")).toHaveText("High");
    await expect(form.getByLabel("Stage 1")).toHaveValue("Send the agenda");
    await expect(form.getByLabel("Description")).toHaveValue("Agenda first, then the notes.");
    const day = workingDay(25);
    await form.getByLabel("Title").fill(`${prefix}call with Sharma`);
    await pick(page, form.getByLabel("Add a person"), new RegExp(`^${escape(staff.name)}`));
    await form.getByLabel("Deadline").fill(day);
    await form.getByLabel("Event date").fill(day);
    await form.getByLabel("Starts").fill("11:00");
    await form.getByRole("button", { name: "Create task" }).click();
    await expect(page).toHaveURL(/\/tasks\/[0-9a-f-]{36}$/);
    const [template] = await serviceSelect<{ id: string }>(
      `task_templates?name=eq.${encodeURIComponent(name)}&select=id`,
    );
    const [task] = await serviceSelect<{ template_id: string; priority: string }>(
      `tasks?id=eq.${page.url().split("/").at(-1)}&select=template_id,priority`,
    );
    expect(task).toEqual({ template_id: template!.id, priority: "high" });

    // Edit (renamed), then archive: New task stops offering it.
    await page.goto("/settings/templates");
    await templateAction(page, name, "Edit");
    const edit = page.getByRole("dialog", { name: `Edit ${name}` });
    await edit.getByLabel("Name").fill(`${name} (weekly)`);
    await edit.getByRole("button", { name: "Save template" }).click();
    await expect(page.getByText("Template saved")).toBeVisible();
    await templateAction(page, `${name} (weekly)`, "Archive");
    await page
      .getByRole("alertdialog")
      .getByRole("button", { name: `Archive ${name} (weekly)` })
      .click();
    await expect(page.getByText("Template archived")).toBeVisible();
    await expect(
      page.locator('[data-slot="archived-task-template"]').filter({ hasText: name }),
    ).toBeVisible();
    await page.goto("/tasks");
    await page.locator('[data-slot="new-task"]:visible').click();
    await expect(form.getByLabel("Title")).toBeVisible();
    const startFrom = form.getByLabel("Start from");
    if ((await startFrom.count()) > 0) {
      await startFrom.click();
      await expect(page.getByRole("option", { name })).toHaveCount(0);
    }
  });

  test("Staff cannot open Templates; Staff and the Owner see no one else's controls", async ({
    page,
  }, info) => {
    const { staff } = people(info);
    await signInAs(page, staff);
    await page.goto("/settings/templates");
    await expect(page).toHaveURL(/\/forbidden$/);
    await page.goto("/tasks/requests");
    await expect(page.locator('[data-slot="suggest-task"]:visible')).toBeVisible();
  });
});

test.describe("task requests and templates, installed: back and large text", () => {
  test.skip(({ viewport }) => (viewport?.width ?? 1280) >= 768, "the installed app is a phone");

  test("Staff: the Suggest dialog closes on back; Suggested tasks is a drill-down from Tasks", async ({
    page,
  }, info) => {
    const prefix = prefixOf(info);
    await fresh(info);
    const { staff } = people(info);
    const title = `${prefix}back`;
    await suggest(info, title);
    await runInstalled(page);
    await signInAs(page, staff);
    await page.locator('[data-slot="bottom-nav"] [data-nav="tasks"]').click();
    await expect(page).toHaveURL(/\/tasks$/);

    await page.locator('[data-slot="suggest-task"]:visible').click();
    const dialog = page.getByRole("dialog", { name: "Suggest a task" });
    await expect(dialog).toBeVisible();
    await expectBackStack(page, [{ closes: dialog, url: /\/tasks$/ }]);

    await page.locator('[data-slot="tasks-requests"]:visible').click();
    const url = /\/tasks\/requests$/;
    await expect(page).toHaveURL(url);
    await requestRow(page, title).getByRole("button", { name: "Withdraw" }).click();
    const confirm = page.getByRole("alertdialog", { name: "Withdraw your suggestion?" });
    await expect(confirm).toBeVisible();
    await expectBackStack(page, [{ closes: confirm, url }, { url: /\/tasks$/ }]);
  });

  test("an Admin: Make it a task, Decline and the template screens close on back", async ({
    page,
  }, info) => {
    const prefix = prefixOf(info);
    await fresh(info);
    const { admin } = people(info);
    const title = `${prefix}layers`;
    await suggest(info, title);
    await runInstalled(page);
    await signInAs(page, admin);
    await page.goto("/tasks/requests");
    const url = /\/tasks\/requests$/;

    await requestRow(page, title).getByRole("button", { name: "Make it a task" }).click();
    const form = page.locator('[data-slot="task-form-dialog"]');
    await expect(form.getByLabel("Title")).toHaveValue(title);
    await expectBackStack(page, [{ closes: form, url }]);

    await requestRow(page, title).getByRole("button", { name: "Decline…" }).click();
    const reason = page.getByRole("dialog", { name: /Decline/ });
    await expect(reason).toBeVisible();
    await expectBackStack(page, [{ closes: reason, url }]);

    await page.goto("/settings/templates");
    await page.locator('[data-slot="add-template"]:visible').click();
    const add = page.getByRole("dialog", { name: "Add a template" });
    await add.getByLabel("Type").click();
    const sheet = page.locator('[data-slot="select-sheet"]');
    await expect(sheet.getByRole("listbox")).toBeVisible();
    await expectBackStack(page, [
      { closes: sheet, url: /\/settings\/templates$/ },
      { closes: add, url: /\/settings\/templates$/ },
    ]);
  });

  test("Suggested tasks, the Suggest dialog and Templates fit at 130% and 200% text", async ({
    page,
  }, info) => {
    const prefix = prefixOf(info);
    await fresh(info);
    const { staff, admin } = people(info);
    await suggest(
      info,
      `${prefix}a long suggestion title that has to wrap on a small phone, twice over`,
    );
    for (const [who, paths] of [
      [staff, ["/tasks/requests"]],
      [admin, ["/tasks/requests", "/settings/templates"]],
    ] as const) {
      await signInAs(page, who);
      for (const path of paths) {
        await page.goto(path);
        await expect(page.locator('[data-slot="skeleton"]')).toHaveCount(0);
        await expectFitsAtLargeText(page);
      }
    }
    await signInAs(page, staff);
    await page.goto("/tasks");
    await page.locator('[data-slot="suggest-task"]:visible').click();
    await expect(page.getByRole("dialog", { name: "Suggest a task" })).toBeVisible();
    await expectFitsAtLargeText(page);
  });
});

async function expectFitsAtLargeText(page: Page): Promise<void> {
  for (const scale of [130, 200]) {
    await page.evaluate((percent) => {
      document.documentElement.style.fontSize = `${percent}%`;
    }, scale);
    // Polled: a sheet's padding transitions with the text size, so the settled layout is checked.
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
                (el) =>
                  `${el.tagName.toLowerCase()}${el.dataset.slot ? `[${el.dataset.slot}]` : ""}`,
              ),
          ),
        { message: `nothing reaches past the right edge at ${scale}%` },
      )
      .toEqual([]);
  }
  await page.evaluate(() => {
    document.documentElement.style.fontSize = "";
  });
}
