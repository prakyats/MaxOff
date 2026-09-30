import { type Locator, type Page, type TestInfo } from "@playwright/test";

import { expect, test } from "./fixtures";

import { addISTDays, istWeekday, systemClock, todayIST } from "../src/core/time";

import {
  expectBackStack,
  memberIdOf,
  pageHeader,
  removeClientFixture,
  removeRequestsTitled,
  removeTasksTitled,
  removeTemplatesNamed,
  rpcAs,
  rpcRefusedAs,
  runInstalled,
  serviceInsert,
  serviceSelect,
  signIn,
  USERS,
} from "./helpers";

/**
 * Task requests and templates, 4C (task 4.6; PRODUCT §4.6, WORKFLOWS §3.4, §3.5, Kickoff 4
 * decisions 3, 19, 22): Staff suggest a task; the Owner makes it a task from the suggestion (an
 * Admin's suggestion with their client pre-selects that Admin as the first check); an Admin
 * declines one with a reason; the suggester withdraws one; nobody sees another Staff member's
 * suggestion; an Admin adds a template in Settings, starts a task from it, edits and archives
 * it, and another Admin may use it but not change it. Installed at 375 and 430px: the back order
 * of the new screens, dialogs, sheets and their "Discard?" questions; and the screens at 130% and
 * 200% text.
 *
 * One set of people per project (`req-staff-<project>`, and the task lists' Staff member and
 * Admin, `list-{staff,admin}-<project>`, `supabase/seed.sql`), one title prefix and one client
 * fixture, so the projects run side by side; the tests of a project run in order.
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
    otherStaff: { email: `list-staff-${project}@maxoff.local`, password: "list-local-password" },
    admin: {
      email: `list-admin-${project}@maxoff.local`,
      password: "list-local-password",
      name: `Test List Admin (${project})`,
    },
    otherAdmin: { email: `task-admin-${project}@maxoff.local`, password: "task-local-password" },
  };
}

function prefixOf(info: TestInfo): string {
  return `Req ${info.project.name} `;
}

function clientOf(info: TestInfo): string {
  return `Req client ${info.project.name}`;
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
  await removeClientFixture(clientOf(info));
}

async function signInAs(page: Page, who: { email: string; password: string }): Promise<void> {
  await page.context().clearCookies();
  await signIn(page, who.email, who.password);
}

function requestRow(page: Page, title: string): Locator {
  return page.locator('[data-slot="task-request"]:visible').filter({ hasText: title });
}

function templateRow(page: Page, name: string): Locator {
  return page.locator('[data-slot="task-template"]:visible').filter({ hasText: name });
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

/** The project's client, run by the project's Admin (an Admin labels only their own, decision 2). */
async function adminClient(info: TestInfo): Promise<string> {
  const [org] = await serviceSelect<{ id: string }>("organizations?select=id&limit=1");
  const client = await serviceInsert<{ id: string }>("clients", {
    org_id: org?.id,
    name: clientOf(info),
    admin_id: await memberIdOf(people(info).admin.email),
    state: "active",
    activated_at: systemClock().toISOString(),
  });
  return client.id;
}

/** Adds a template through Settings as whoever is signed in (the screen is open). */
async function addTemplate(page: Page, name: string): Promise<void> {
  await page.locator('[data-slot="add-template"]:visible').click();
  const add = page.getByRole("dialog", { name: "Add a template" });
  await add.getByLabel("Name").fill(name);
  await pick(page, add.getByLabel("Type"), "Meeting");
  await pick(page, add.getByLabel("Priority"), "High");
  await add.getByLabel("Description").fill("Agenda first, then the notes.");
  await add.getByRole("button", { name: "Add stage" }).click();
  await add.getByLabel("Stage 1", { exact: true }).fill("Send the agenda");
  await add.getByRole("button", { name: "Add template" }).click();
  await expect(page.getByText("Template added")).toBeVisible();
  await expect(add).toBeHidden();
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
    await page.goto("/tasks");
    await expect(page.locator('[data-slot="tasks-requests-waiting"]:visible')).toBeVisible();
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
    // No client on the suggestion: nobody checks it first.
    await expect(form.getByLabel("Checked first by")).toContainText("Nobody");
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

  test("an Admin's suggestion with their client: the Owner's task is checked first by that Admin", async ({
    page,
  }, info) => {
    const prefix = prefixOf(info);
    await fresh(info);
    const { staff, admin } = people(info);
    const title = `${prefix}brand refresh`;
    const clientId = await adminClient(info);
    try {
      const requestId = await rpcAs<string>(admin.email, admin.password, "task_request_create", {
        title,
        client_id: clientId,
      });

      // Kickoff 4 decision 23: an Admin's own suggestion goes to the Owner; they may withdraw it,
      // never make it a task or decline it (the screen offers Withdraw only; the database refuses).
      await signInAs(page, admin);
      await page.goto("/tasks/requests");
      await expect(requestRow(page, title).getByRole("button")).toHaveText(["Withdraw"]);
      const refused = await rpcRefusedAs(admin.email, admin.password, "task_request_decline", {
        request_id: requestId,
        reason: "Not this month",
      });
      expect(refused.message).toBe("FORBIDDEN");

      await signInAs(page, USERS.owner);
      await page.goto("/tasks/requests");
      await expect(requestRow(page, title)).toContainText(`Suggested by ${admin.name}`);
      await expect(requestRow(page, title)).toContainText(clientOf(info));
      await requestRow(page, title).getByRole("button", { name: "Make it a task" }).click();
      const form = page.locator('[data-slot="task-form-dialog"]');
      await expect(form.getByLabel("Title")).toHaveValue(title);
      await expect(form.getByLabel("Client label")).toContainText(clientOf(info));
      // Kickoff 4 decision 3: the label pre-selects its Admin, as picking it does.
      await expect(form.getByLabel("Checked first by")).toContainText(admin.name);
      await pick(page, form.getByLabel("Add a person"), new RegExp(`^${escape(staff.name)}`));
      await form.getByLabel("Deadline").fill(workingDay(26));
      await form.getByRole("button", { name: "Create task" }).click();
      await expect(page).toHaveURL(/\/tasks\/[0-9a-f-]{36}$/);
      const [task] = await serviceSelect<{ approving_admin_id: string; client_id: string }>(
        `tasks?id=eq.${page.url().split("/").at(-1)}&select=approving_admin_id,client_id`,
      );
      expect(task).toEqual({
        approving_admin_id: await memberIdOf(admin.email),
        client_id: clientId,
      });

      // The Admin reads what became of it; a decided one offers nothing.
      await signInAs(page, admin);
      await page.goto("/tasks/requests");
      await expect(requestRow(page, title)).toContainText("Made a task");
      await expect(requestRow(page, title).getByRole("button")).toHaveCount(0);
    } finally {
      await removeTasksTitled(prefix);
      await removeRequestsTitled(prefix);
      await removeClientFixture(clientOf(info));
    }
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
    await page.locator('[data-slot="tasks-requests-waiting"]:visible a').click();
    await expect(page).toHaveURL(/\/tasks\/requests$/);
    await requestRow(page, declined).getByRole("button", { name: "Decline…" }).click();
    const reason = page.getByRole("dialog", { name: /Decline/ });
    await reason.getByRole("button", { name: "Decline suggestion" }).click();
    await expect(reason).toBeVisible();
    await expect(reason.locator('[data-slot="field-error"]')).toBeVisible();
    await reason.getByLabel("Why not").fill("We did one last month");
    await reason.getByRole("button", { name: "Decline suggestion" }).click();
    await expect(page.getByText("Suggestion declined")).toBeVisible();
    await expect(
      page.locator('[data-slot="task-requests-decided"]:visible').filter({ hasText: declined }),
    ).toContainText("We did one last month");
    const [row] = await serviceSelect<{ state: string; decision_reason: string }>(
      `task_requests?title=eq.${encodeURIComponent(declined)}&select=state,decision_reason`,
    );
    expect(row).toEqual({ state: "declined", decision_reason: "We did one last month" });

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
    const [gone] = await serviceSelect<{ state: string }>(
      `task_requests?title=eq.${encodeURIComponent(withdrawn)}&select=state`,
    );
    expect(gone).toEqual({ state: "withdrawn" });
  });

  test("an Admin adds a template, starts a task from it, edits and archives it", async ({
    page,
  }, info) => {
    const prefix = prefixOf(info);
    await fresh(info);
    const { staff, admin, otherAdmin } = people(info);
    const name = `${prefix}client call`;

    await signInAs(page, admin);
    await page.goto("/settings");
    await page.locator('[data-slot="settings-section"]').filter({ hasText: "Templates" }).click();
    await expect(page).toHaveURL(/\/settings\/templates$/);
    // A template needs a name (the form says so before anything is sent).
    await page.locator('[data-slot="add-template"]:visible').click();
    const empty = page.getByRole("dialog", { name: "Add a template" });
    await empty.getByRole("button", { name: "Add template" }).click();
    await expect(empty.locator('[data-slot="field-error"]').first()).toBeVisible();
    await empty.getByRole("button", { name: "Cancel" }).click();
    await expect(empty).toBeHidden();
    await addTemplate(page, name);
    await expect(templateRow(page, name)).toContainText("Meeting · High · 1 stage · by you");

    // New task → Start from: the type, the priority, the stages and the description.
    await page.goto("/tasks");
    await page.locator('[data-slot="new-task"]:visible').click();
    const form = page.locator('[data-slot="task-form-dialog"]');
    await pick(page, form.getByLabel("Start from"), name);
    await expect(form.getByLabel("Type")).toHaveText("Meeting");
    await expect(form.getByLabel("Priority")).toHaveText("High");
    await expect(form.getByLabel("Stage 1", { exact: true })).toHaveValue("Send the agenda");
    await expect(form.getByLabel("Description")).toHaveValue("Agenda first, then the notes.");
    // Never the people, the deadline or the client (PRODUCT §4.6).
    await expect(form.locator('[data-slot="task-assignee"]')).toHaveCount(0);
    await expect(form.getByLabel("Deadline")).toHaveValue("");
    await expect(form.getByLabel("Client label")).toContainText("No client");
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
    await expect(page.locator("main")).toContainText("Send the agenda");

    // Another Admin uses it but may not change it (Kickoff 4 decision 19: an Admin their own).
    await signInAs(page, otherAdmin);
    await page.goto("/settings/templates");
    await expect(templateRow(page, name)).toContainText(`by ${admin.name}`);
    await expect(page.getByRole("button", { name: `Edit ${name}` })).toHaveCount(0);
    await expect(page.getByRole("button", { name: `Archive ${name}` })).toHaveCount(0);
    await expect(page.getByRole("button", { name: `Actions for ${name}` })).toHaveCount(0);

    // Its author edits it (renamed), then archives it: New task stops offering it.
    await signInAs(page, admin);
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

  test("the Owner edits an Admin's template; restoring brings it back to New task", async ({
    page,
  }, info) => {
    const prefix = prefixOf(info);
    await fresh(info);
    const { admin } = people(info);
    const name = `${prefix}shoot day`;

    await signInAs(page, admin);
    await page.goto("/settings/templates");
    await addTemplate(page, name);

    // The Owner edits any template (decision 19); archive and restore are theirs too.
    await signInAs(page, USERS.owner);
    await page.goto("/settings/templates");
    await expect(templateRow(page, name)).toContainText(`by ${admin.name}`);
    await templateAction(page, name, "Edit");
    const edit = page.getByRole("dialog", { name: `Edit ${name}` });
    await pick(page, edit.getByLabel("Priority"), "Urgent");
    await edit.getByRole("button", { name: "Save template" }).click();
    await expect(page.getByText("Template saved")).toBeVisible();
    await expect(templateRow(page, name)).toContainText("Meeting · Urgent · 1 stage");
    await templateAction(page, name, "Archive");
    await page
      .getByRole("alertdialog")
      .getByRole("button", { name: `Archive ${name}` })
      .click();
    await expect(page.getByText("Template archived")).toBeVisible();
    await page
      .locator('[data-slot="archived-task-template"]')
      .filter({ hasText: name })
      .getByRole("button", { name: "Restore" })
      .click();
    await expect(page.getByText("Template restored")).toBeVisible();
    await expect(templateRow(page, name)).toBeVisible();

    await page.goto("/tasks");
    await page.locator('[data-slot="new-task"]:visible').click();
    const form = page.locator('[data-slot="task-form-dialog"]');
    await pick(page, form.getByLabel("Start from"), name);
    await expect(form.getByLabel("Priority")).toHaveText("Urgent");
  });

  test("permissions: Staff cannot open Templates or see another's suggestion; the Owner suggests nothing", async ({
    page,
  }, info) => {
    const prefix = prefixOf(info);
    await fresh(info);
    const { staff, otherStaff, admin } = people(info);
    const theirs = `${prefix}someone else's idea`;
    await rpcAs(otherStaff.email, otherStaff.password, "task_request_create", { title: theirs });

    await signInAs(page, staff);
    await page.goto("/settings/templates");
    await expect(page).toHaveURL(/\/forbidden$/);
    await page.goto("/tasks/requests");
    await expect(page.locator('[data-slot="suggest-task"]:visible')).toBeVisible();
    await expect(pageHeader(page)).toHaveText(/Suggested tasks/);
    // RLS: Staff read their own suggestions only (PERMISSIONS §2).
    await expect(requestRow(page, theirs)).toHaveCount(0);

    // An Admin sees it (no client) and may decide it; the Owner suggests nothing.
    await signInAs(page, admin);
    await page.goto("/tasks/requests");
    await expect(requestRow(page, theirs).getByRole("button", { name: "Decline…" })).toBeVisible();
    await expect(page.locator('[data-slot="suggest-task"]:visible')).toBeVisible();
    await signInAs(page, USERS.owner);
    await page.goto("/tasks/requests");
    await expect(requestRow(page, theirs)).toBeVisible();
    await expect(page.locator('[data-slot="suggest-task"]')).toHaveCount(0);
  });
});

test.describe("task requests and templates, installed: back and large text", () => {
  test.skip(({ viewport }) => (viewport?.width ?? 1280) >= 768, "the installed app is a phone");

  test("Staff: the Suggest dialog and its Discard question close on back; the Tasks links are drill-downs", async ({
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
    const tasks = /\/tasks$/;
    await expect(page).toHaveURL(tasks);

    await page.locator('[data-slot="suggest-task"]:visible').click();
    const dialog = page.getByRole("dialog", { name: "Suggest a task" });
    await expect(dialog).toBeVisible();
    await expectBackStack(page, [{ closes: dialog, url: tasks }]);

    // Typed text: back asks first; one back on the question keeps editing, with the text.
    await page.locator('[data-slot="suggest-task"]:visible').click();
    await dialog.getByLabel("What needs doing").fill(`${prefix}draft`);
    const discard = page.getByRole("alertdialog", { name: "Discard this suggestion?" });
    await page.goBack();
    await expect(discard).toBeVisible();
    await expect(page).toHaveURL(tasks);
    await page.goBack();
    await expect(discard).toBeHidden();
    await expect(dialog.getByLabel("What needs doing")).toHaveValue(`${prefix}draft`);
    await page.goBack();
    await discard.getByRole("button", { name: "Discard suggestion" }).click();
    await expect(discard).toBeHidden();
    await expect(dialog).toBeHidden();
    await expect(page).toHaveURL(tasks);

    // "Your suggestions" is a drill-down: its back goes to Tasks, then home.
    await page.locator('[data-slot="tasks-requests"]:visible').click();
    const url = /\/tasks\/requests$/;
    await expect(page).toHaveURL(url);
    await requestRow(page, title).getByRole("button", { name: "Withdraw" }).click();
    const confirm = page.getByRole("alertdialog", { name: "Withdraw your suggestion?" });
    await expect(confirm).toBeVisible();
    await expectBackStack(page, [{ closes: confirm, url }, { url: tasks }, { url: /\/my-day$/ }]);
  });

  test("an Admin: Make it a task, Decline and the Tasks count row close on back", async ({
    page,
  }, info) => {
    const prefix = prefixOf(info);
    await fresh(info);
    const { admin } = people(info);
    const title = `${prefix}layers`;
    await suggest(info, title);
    await runInstalled(page);
    await signInAs(page, admin);
    await page.locator('[data-slot="bottom-nav"] [data-nav="tasks"]').click();
    const tasks = /\/tasks$/;
    await expect(page).toHaveURL(tasks);
    // "N suggested tasks to decide" opens Suggested tasks, a drill-down.
    await page.locator('[data-slot="tasks-requests-waiting"]:visible a').click();
    const url = /\/tasks\/requests$/;
    await expect(page).toHaveURL(url);

    await requestRow(page, title).getByRole("button", { name: "Make it a task" }).click();
    const form = page.locator('[data-slot="task-form-dialog"]');
    await expect(form.getByLabel("Title")).toHaveValue(title);
    await expectBackStack(page, [{ closes: form, url }]);

    await requestRow(page, title).getByRole("button", { name: "Decline…" }).click();
    const reason = page.getByRole("dialog", { name: /Decline/ });
    await expect(reason).toBeVisible();
    await expectBackStack(page, [{ closes: reason, url }]);

    // A suggestion is only a request: nothing was decided on the way.
    await expect(requestRow(page, title).getByRole("button", { name: "Decline…" })).toBeVisible();
    await expectBackStack(page, [{ url: tasks }, { url: /\/today$/ }]);
  });

  test("Templates: the Add dialog, its select and Discard, the ⋯ sheet, Edit and Archive close on back", async ({
    page,
  }, info) => {
    const prefix = prefixOf(info);
    await fresh(info);
    const { admin } = people(info);
    const name = `${prefix}layers`;
    await runInstalled(page);
    await signInAs(page, admin);
    await page.goto("/settings");
    await page.locator('[data-slot="settings-section"]').filter({ hasText: "Templates" }).click();
    const url = /\/settings\/templates$/;
    await expect(page).toHaveURL(url);

    await page.locator('[data-slot="add-template"]:visible').click();
    const add = page.getByRole("dialog", { name: "Add a template" });
    await add.getByLabel("Type").click();
    const sheet = page.locator('[data-slot="select-sheet"]');
    await expect(sheet.getByRole("listbox")).toBeVisible();
    await expectBackStack(page, [
      { closes: sheet, url },
      { closes: add, url },
    ]);

    // Typed: back asks "Discard this template?"; one back on it keeps editing.
    await page.locator('[data-slot="add-template"]:visible').click();
    await add.getByLabel("Name").fill(name);
    const discard = page.getByRole("alertdialog", { name: "Discard this template?" });
    await page.goBack();
    await expect(discard).toBeVisible();
    await page.goBack();
    await expect(discard).toBeHidden();
    await expect(add.getByLabel("Name")).toHaveValue(name);
    await add.getByLabel("Description").fill("For the back spec.");
    await add.getByRole("button", { name: "Add template" }).click();
    await expect(page.getByText("Template added")).toBeVisible();
    await expect(add).toBeHidden();
    await expect(page).toHaveURL(url);

    await page.getByRole("button", { name: `Actions for ${name}` }).click();
    const actions = page.locator('[data-slot="task-template-actions"]');
    await expect(actions).toBeVisible();
    await expectBackStack(page, [{ closes: actions, url }]);

    await templateAction(page, name, "Edit");
    const edit = page.getByRole("dialog", { name: `Edit ${name}` });
    await expect(edit).toBeVisible();
    await expectBackStack(page, [{ closes: edit, url }]);

    await templateAction(page, name, "Archive");
    const archive = page.getByRole("alertdialog", { name: `Archive ${name}?` });
    await expect(archive).toBeVisible();
    await expectBackStack(page, [{ closes: archive, url }, { url: /\/settings$/ }]);
    // Back decided nothing: the template is still active.
    const [row] = await serviceSelect<{ archived_at: string | null }>(
      `task_templates?name=eq.${encodeURIComponent(name)}&select=archived_at`,
    );
    expect(row).toEqual({ archived_at: null });
  });

  test("New task's Start from: its select sheet, then Discard, close on back", async ({
    page,
  }, info) => {
    const prefix = prefixOf(info);
    await fresh(info);
    const { admin } = people(info);
    const name = `${prefix}start from`;
    await signInAs(page, admin);
    await page.goto("/settings/templates");
    await addTemplate(page, name);

    await runInstalled(page);
    await page.goto("/today");
    await page.locator('[data-slot="bottom-nav"] [data-nav="tasks"]').click();
    const tasks = /\/tasks$/;
    await expect(page).toHaveURL(tasks);
    await page.locator('[data-slot="new-task"]:visible').click();
    const form = page.locator('[data-slot="task-form-dialog"]');
    await form.getByLabel("Start from").click();
    const sheet = page.locator('[data-slot="select-sheet"]');
    await expect(sheet.getByRole("listbox")).toBeVisible();
    await expectBackStack(page, [{ closes: sheet, url: tasks }]);
    await expect(form).toBeVisible();

    // A template filled the form: back asks first, and Keep editing keeps what it gave.
    await pick(page, form.getByLabel("Start from"), name);
    await expect(form.getByLabel("Stage 1", { exact: true })).toHaveValue("Send the agenda");
    const discard = page.getByRole("alertdialog", { name: "Discard this task?" });
    await page.goBack();
    await expect(discard).toBeVisible();
    await page.goBack();
    await expect(discard).toBeHidden();
    await expect(form.getByLabel("Start from")).toContainText(name);
    await expect(form.getByLabel("Stage 1", { exact: true })).toHaveValue("Send the agenda");
    await page.goBack();
    await discard.getByRole("button", { name: "Discard task" }).click();
    await expect(form).toBeHidden();
    await expect(page).toHaveURL(tasks);
  });

  test("Suggested tasks, the Suggest dialog, Templates and its dialog fit at 130% and 200% text", async ({
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
    await page.locator('[data-slot="add-template"]:visible').click();
    const add = page.getByRole("dialog", { name: "Add a template" });
    await add.getByRole("button", { name: "Add stage" }).click();
    await expectFitsAtLargeText(page);

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
    const widths = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(widths.scrollWidth).toBeLessThanOrEqual(widths.clientWidth);
  }
  await page.evaluate(() => {
    document.documentElement.style.fontSize = "";
  });
}
