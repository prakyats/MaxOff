import type { Page, TestInfo } from "@playwright/test";

import { expect, test } from "./fixtures";

import { addISTDays, istInstant, todayIST } from "../src/core/time";

import {
  expectNoHorizontalScroll,
  hydrated,
  memberIdOf,
  removeClientFixture,
  removeTasksTitled,
  rpcAs,
  rpcRefusedAs,
  runInstalled,
  serviceInsert,
  serviceSelect,
  serviceUpdate,
  storageStateFor,
  taskTypeId,
  USERS,
} from "./helpers";

/**
 * On hold, the screens (v1.9 W8; ADR-0016, WORKFLOWS §3.1a and §5.5; the approved sample
 * `docs/design/v19-screens-sample.html` §1–2): a task put on hold from its ⋯ with a reason (the
 * amber chip and hold line, out of the to-do lists, "On hold · n" opening them), resumed in one
 * tap and, once its deadline has passed, with a new one; a Crew assignee reading the hold, with
 * Start and Done gone; a project put on hold (the banner, its deliverables On hold, Mark done
 * gone) and resumed with a new date and a carry choice in one go; the reports' count; and an
 * Admin outside the client never offered Hold. Every new sheet is a layer: installed, back closes
 * it (ARCHITECTURE §14.2), at the laptop width, 375 and 430 px.
 *
 * Each test names its rows for itself and its project and removes them first, so the projects run
 * in parallel and re-run without `pnpm db:reset`.
 */

const owner = USERS.owner;
const admin = USERS.admin;
const staff = USERS.staff;
const REASON = "Client hasn't sent the footage";

const nameOf = (info: TestInfo, what: string) => `OH ${what} (${info.project.name})`;

/** A task the Owner gives the seeded Crew member, due `days` from today (IST) at 6 pm. */
async function ownerTask(title: string, days: number, approver: string | null = null) {
  const staffId = await memberIdOf(staff.email);
  return rpcAs<string>(owner.email, owner.password, "task_create", {
    title,
    description: null,
    task_type_id: await taskTypeId("Normal"),
    client_id: null,
    priority: "medium",
    due_at: istInstant(addISTDays(todayIST(), days), "18:00"),
    assignee_ids: [staffId],
    primary_owner_id: staffId,
    approving_admin_id: approver,
    stages: ["Cut"],
  });
}

async function taskRow(id: string) {
  const [row] = await serviceSelect<{ held_at: string | null; due_at: string }>(
    `tasks?id=eq.${id}&select=held_at,due_at`,
  );
  return row;
}

/** The task page has hydrated and its views answer taps (`markLive`). */
async function taskReady(page: Page) {
  await hydrated(page);
  await expect(page.locator('[data-slot="task-tabs"]')).toHaveAttribute("data-live", /.*/);
}

async function openTaskMenu(page: Page) {
  await page.getByRole("button", { name: "Task actions" }).click();
}

/** An Active client run by the Admin `adminEmail`, removed first. */
async function workClient(name: string, adminEmail: string): Promise<string> {
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

/** An ended cycle (last month) of a project, with one open deliverable in it. */
async function endedCycleWith(projectId: string, title: string): Promise<string> {
  const [project] = await serviceSelect<{ org_id: string }>(
    `projects?id=eq.${projectId}&select=org_id`,
  );
  const first = `${todayIST().slice(0, 8)}01`;
  const end = addISTDays(first as ReturnType<typeof todayIST>, -1);
  const cycle = await serviceInsert<{ id: string }>("project_cycles", {
    org_id: project?.org_id,
    project_id: projectId,
    period_start: `${end.slice(0, 8)}01`,
    period_end: end,
    label: "Last month",
    generated_by: "schedule",
  });
  const item = await serviceInsert<{ id: string }>("project_items", {
    org_id: project?.org_id,
    project_id: projectId,
    cycle_id: cycle.id,
    origin_cycle_id: cycle.id,
    title,
    position: "a0",
  });
  return item.id;
}

async function itemId(projectId: string, title: string): Promise<string> {
  const [row] = await serviceSelect<{ id: string }>(
    `project_items?project_id=eq.${projectId}&title=eq.${encodeURIComponent(title)}&select=id`,
  );
  return row?.id ?? "";
}

test.describe("a task on hold", () => {
  test.use({ storageState: storageStateFor("owner") });

  test("hold with a reason, out of the lists, back in one tap; a passed deadline asks for a new one", async ({
    page,
  }, info) => {
    const prefix = `OH task ${info.project.name} `;
    await removeTasksTitled(prefix);
    const title = `${prefix}reel edit`;
    const taskId = await ownerTask(title, 3);
    const taskUrl = new RegExp(`/tasks/${taskId}$`);
    await runInstalled(page);
    await page.goto("/tasks");
    await page.goto(`/tasks/${taskId}`);
    await taskReady(page);

    // Put on hold… is in ⋯; its sheet is a layer: back closes it, the task stays.
    await openTaskMenu(page);
    // v2.0 X1: "Put on hold…" is the menu's own size and indent, as "Edit task" (it shrank on a
    // phone when its own data-slot replaced the item's).
    const looks = (name: string) =>
      page.getByRole("menuitem", { name }).evaluate((item) => {
        const style = getComputedStyle(item);
        return { size: style.fontSize, indent: style.paddingLeft, slot: item.dataset.slot };
      });
    expect(await looks("Put on hold…")).toEqual(await looks("Edit task"));
    await page.getByRole("menuitem", { name: "Put on hold…" }).click();
    const holdSheet = page.getByRole("dialog", { name: `Put "${title}" on hold?` });
    await expect(holdSheet).toBeVisible();
    await expect(holdSheet).toContainText("Reminders and the deadline pause");
    await page.goBack();
    await expect(holdSheet).toBeHidden();
    await expect(page).toHaveURL(taskUrl);

    await openTaskMenu(page);
    await page.getByRole("menuitem", { name: "Put on hold…" }).click();
    await holdSheet.getByLabel("Why").fill(REASON);
    await holdSheet.getByRole("button", { name: "Put on hold" }).click();
    await expect(holdSheet).toBeHidden();
    const line = page.locator('[data-slot="task-hold-line"]');
    await expect(line).toContainText("On hold since");
    await expect(line).toContainText(REASON);
    // v2.0 X1: why the work waits shows to everyone who opens it, the Owner included.
    await expect(page.locator('[data-slot="task-hold-note"]')).toHaveText(
      "Start, Done and the stage ticks wait until the task is resumed.",
    );
    await expect(page.locator('[data-status="on_hold"]:visible').first()).toHaveText("On hold");
    await expect(page.locator('[data-slot="task-deadline"]')).toHaveAttribute(
      "data-overdue",
      "false",
    );
    expect((await taskRow(taskId))?.held_at).not.toBeNull();

    // Out of the Tasks tab's lists; "On hold · n" opens the full list on its On hold state.
    await page.goto("/tasks");
    await hydrated(page);
    await expect(page.locator(`[data-slot="task-row"][data-task="${taskId}"]`)).toHaveCount(0);
    const onHold = page.locator('[data-slot="tasks-on-hold"]');
    await expect(onHold).toHaveText(/On hold · \d+/);
    await onHold.click();
    await expect(page).toHaveURL(/\/tasks\/all\?state=on_hold$/);
    await expect(page.getByText(title).locator("visible=true").first()).toBeVisible();

    // The deadline is still ahead: Resume works in one tap.
    await page.goto(`/tasks/${taskId}`);
    await taskReady(page);
    await expect(line).toBeVisible();
    await expectNoHorizontalScroll(page);
    await page.locator('[data-slot="task-resume"]').click();
    await expect(line).toBeHidden();
    await expect.poll(async () => (await taskRow(taskId))?.held_at ?? null).toBeNull();

    // On hold again, and the deadline passes meanwhile (an edit moves it): the sheet asks.
    await rpcAs(owner.email, owner.password, "task_hold", { task_id: taskId, reason: REASON });
    await rpcAs(owner.email, owner.password, "task_update_assignment", {
      task_id: taskId,
      changes: { due_at: istInstant(addISTDays(todayIST(), -1), "18:00") },
    });
    await page.reload();
    await taskReady(page);
    await expect(line).toBeVisible();
    await page.locator('[data-slot="task-resume"]').click();
    const resumeSheet = page.getByRole("dialog", { name: /^Resume/ });
    await expect(resumeSheet).toContainText("has passed. Set a new one.");
    await page.goBack();
    await expect(resumeSheet).toBeHidden();
    await expect(page).toHaveURL(taskUrl);

    await page.locator('[data-slot="task-resume"]').click();
    await resumeSheet.getByRole("button", { name: "Resume" }).click();
    await expect(resumeSheet).toContainText("Choose the new deadline's date.");
    const day = addISTDays(todayIST(), 2);
    await resumeSheet.getByLabel("New deadline").fill(day);
    await resumeSheet.getByLabel("Time").fill("17:30");
    await resumeSheet.getByRole("button", { name: "Resume" }).click();
    await expect(resumeSheet).toBeHidden();
    await expect(line).toBeHidden();
    await expect
      .poll(async () => {
        const row = await taskRow(taskId);
        return row && row.held_at === null ? Date.parse(row.due_at) : null;
      })
      .toBe(Date.parse(istInstant(day, "17:30")));
    await removeTasksTitled(prefix);
  });

  test("an approving Admin who did not create it is offered no Hold", async ({ browser }, info) => {
    const prefix = `OH approver ${info.project.name} `;
    await removeTasksTitled(prefix);
    const taskId = await ownerTask(`${prefix}check`, 3, await memberIdOf(admin.email));
    const context = await browser.newContext({ storageState: storageStateFor("admin") });
    const page = await context.newPage();
    await page.goto(`/tasks/${taskId}`);
    await taskReady(page);
    const menu = page.getByRole("button", { name: "Task actions" });
    await menu.click();
    await expect(page.getByRole("menuitem", { name: "Edit task" })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: "Put on hold…" })).toHaveCount(0);
    await page.keyboard.press("Escape");
    const refused = await rpcRefusedAs(admin.email, admin.password, "task_hold", {
      task_id: taskId,
      reason: REASON,
    });
    expect(refused.message).toBe("FORBIDDEN");
    // v2.0 X1: once the Owner holds it, the approving Admin reads it as held when it opens: the
    // chip, the line with the reason and why the work waits; no Resume.
    await rpcAs(owner.email, owner.password, "task_hold", { task_id: taskId, reason: REASON });
    await page.reload();
    await taskReady(page);
    const line = page.locator('[data-slot="task-hold-line"]');
    await expect(line).toContainText("On hold since");
    await expect(line).toContainText(REASON);
    await expect(page.locator('[data-slot="task-hold-note"]')).toBeVisible();
    await expect(page.locator('[data-status="on_hold"]:visible').first()).toHaveText("On hold");
    await expect(page.locator('[data-slot="task-resume"]')).toHaveCount(0);
    await context.close();
    await removeTasksTitled(prefix);
  });
});

test.describe("Crew on a held task", () => {
  test.use({ storageState: storageStateFor("staff") });

  test("reads On hold and why; Start and Done wait; out of My tasks with its own line", async ({
    page,
  }, info) => {
    const prefix = `OH crew ${info.project.name} `;
    await removeTasksTitled(prefix);
    const title = `${prefix}caption pass`;
    const taskId = await ownerTask(title, 2);
    await rpcAs(staff.email, staff.password, "task_acknowledge", {
      task_id: taskId,
    });
    await rpcAs(owner.email, owner.password, "task_hold", { task_id: taskId, reason: REASON });

    await page.goto("/tasks");
    await hydrated(page);
    await expect(page.locator(`[data-slot="task-row"][data-task="${taskId}"]`)).toHaveCount(0);
    await expect(page.locator('[data-slot="tasks-on-hold"]')).toHaveText(/On hold · \d+/);
    // v2.0 X1: My Day says so too; the held task never just vanishes from home.
    await page.goto("/my-day");
    await hydrated(page);
    await expect(page.getByText(title)).toHaveCount(0);
    const myDayLine = page.locator('[data-slot="my-day-on-hold"]');
    await expect(myDayLine).toHaveText(/On hold · \d+/);
    await myDayLine.click();
    await expect(page).toHaveURL(/\/tasks\/all\?state=on_hold$/);
    await expect(page.getByText(title).locator("visible=true").first()).toBeVisible();

    await page.goto(`/tasks/${taskId}`);
    await taskReady(page);
    const line = page.locator('[data-slot="task-hold-line"]');
    await expect(line).toContainText("On hold since");
    await expect(line).toContainText(REASON);
    await expect(page.locator('[data-slot="task-hold-note"]')).toHaveText(
      "Start, Done and the stage ticks wait until the task is resumed.",
    );
    await expect(page.locator('[data-slot="task-resume"]')).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Start work" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^Mark done/ })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Task actions" })).toHaveCount(0);
    // The stage reads disabled: nobody taps a tick to be refused (the design pass).
    const stage = page.locator('[data-slot="task-stage"]').filter({ hasText: "Cut" });
    await expect(stage.locator("label")).toHaveAttribute("aria-disabled", "true");
    await expect(stage.getByRole("checkbox", { name: "Cut" })).toBeDisabled();
    await expect(page.locator('[data-slot="task-stages-locked"]')).toHaveText(
      "On hold: the stages wait until the task is resumed.",
    );
    await expectNoHorizontalScroll(page);
    const refused = await rpcRefusedAs(staff.email, staff.password, "task_start", {
      task_id: taskId,
    });
    expect(refused.message).toBe("INVALID_STATE");
    await removeTasksTitled(prefix);
  });
});

test.describe("a project on hold", () => {
  test.use({ storageState: storageStateFor("admin") });

  test("hold: the banner and its deliverables On hold; resume with a new date and a carry choice in one go", async ({
    page,
  }, info) => {
    const client = nameOf(info, "client");
    const clientId = await workClient(client, admin.email);
    const name = "Monthly Social";
    const projectId = await rpcAs<string>(admin.email, admin.password, "project_create", {
      client_id: clientId,
      name,
      recurrence: "monthly",
      stages: ["Edit"],
      items: ["Reel 3", "Carousel 2"],
    });
    const reel3 = await itemId(projectId, "Reel 3");
    await serviceUpdate(`project_items?id=eq.${reel3}`, {
      planned_date: addISTDays(todayIST(), -1),
    });
    const reel2 = await endedCycleWith(projectId, "Reel 2");
    const here = new RegExp(`/projects/${projectId}$`);

    await runInstalled(page);
    await page.goto(`/clients/${clientId}/projects`);
    await page.goto(`/clients/${clientId}/projects/${projectId}`);
    await hydrated(page);
    // Before: Reel 3 is late, with Mark done on offer.
    const rows = page.locator('[data-slot="item-row"]');
    await expect(
      rows.filter({ hasText: "Reel 3" }).locator('[data-planned="late"]:visible').first(),
    ).toBeVisible();

    // X5+ L5 (as the task's menu above): every item of an open menu has the menu's own size,
    // indent and slot; X1's own data-slots once replaced them (the item row's Open, the
    // project's Copy schedule and Put on hold…).
    // `evaluateAll` does not wait: read the items only once the menu that was just opened shows
    // them (CI 43068303493 read the row's menu before it opened: 0 items).
    const menuLooks = async () => {
      await expect(page.getByRole("menuitem").first()).toBeVisible();
      return page.getByRole("menuitem").evaluateAll((items) =>
        items.map((item) => {
          const style = getComputedStyle(item);
          return `${style.fontSize} ${style.paddingLeft} ${(item as HTMLElement).dataset.slot}`;
        }),
      );
    };
    await rows
      .filter({ hasText: "Reel 3" })
      .getByRole("button", { name: "More for Reel 3" })
      .click();
    const rowMenu = await menuLooks();
    expect(rowMenu.length, "the row's menu has items").toBeGreaterThan(1);
    expect(new Set(rowMenu).size, `the row's menu items look alike: ${rowMenu.join(" | ")}`).toBe(
      1,
    );
    await page.keyboard.press("Escape");
    await expect(page.getByRole("menuitem")).toHaveCount(0);

    const menu = page.getByRole("button", { name: `Actions for ${name}` });
    await menu.click();
    const projectMenu = await menuLooks();
    expect(projectMenu.length, "the project's menu has items").toBeGreaterThan(1);
    expect(
      new Set(projectMenu).size,
      `the project's menu items look alike: ${projectMenu.join(" | ")}`,
    ).toBe(1);
    await page.getByRole("menuitem", { name: "Put on hold…" }).click();
    const holdSheet = page.getByRole("dialog", { name: `Put "${name}" on hold?` });
    await expect(holdSheet).toBeVisible();
    await page.goBack();
    await expect(holdSheet).toBeHidden();
    await expect(page).toHaveURL(here);
    await menu.click();
    await page.getByRole("menuitem", { name: "Put on hold…" }).click();
    await holdSheet.getByLabel("Why").fill("Client paused content for Diwali week");
    await holdSheet.getByRole("button", { name: "Put on hold" }).click();
    await expect(holdSheet).toBeHidden();

    const banner = page.locator('[data-slot="project-hold-banner"]');
    await expect(banner).toContainText("On hold since");
    await expect(banner).toContainText("Client paused content for Diwali week");
    // The ring claims no pace while held: the amber On hold chip, never On track (design pass).
    await expect(page.locator('[data-slot="cycle-pace"]')).toHaveText("On hold");
    await expect(page.locator('[data-slot="cycle-pace"]')).toHaveAttribute(
      "data-tone",
      "attention",
    );
    const reel3Row = rows.filter({ hasText: "Reel 3" });
    await expect(reel3Row.locator('[data-status="on_hold"]:visible').first()).toHaveText("On hold");
    await expect(reel3Row.locator('[data-planned="late"]')).toHaveCount(0);
    await expect(page.locator('[data-slot="item-row-done"]')).toHaveCount(0);
    // A fresh visit, once the toast has gone: the banner and chips fit the width.
    await page.goto(`/clients/${clientId}/projects/${projectId}`);
    await hydrated(page);
    await expect(banner).toBeVisible();
    await expectNoHorizontalScroll(page);

    // The resume sheet: back closes it; it lists the passed date and the ended month.
    await page.locator('[data-slot="project-resume"]').click();
    const resumeSheet = page.getByRole("dialog", { name: /^Resume/ });
    await expect(resumeSheet).toBeVisible();
    await expect(resumeSheet.locator('[data-slot="resume-row"]')).toHaveCount(2);
    await page.goBack();
    await expect(resumeSheet).toBeHidden();
    await expect(page).toHaveURL(here);

    await page.locator('[data-slot="project-resume"]').click();
    await resumeSheet.getByRole("button", { name: "Resume project" }).click();
    await expect(resumeSheet.locator('[data-slot="form-alert"]')).toHaveText(
      "2 deliverables still need an answer.",
    );
    const newDate = addISTDays(todayIST(), 2);
    await resumeSheet
      .locator(`[data-slot="resume-row"][data-item="${reel3}"]`)
      .getByLabel("New date")
      .fill(newDate);
    await resumeSheet
      .locator(`[data-slot="resume-row"][data-item="${reel2}"]`)
      .getByRole("radio", { name: "Carry forward" })
      .click();
    await resumeSheet.getByRole("button", { name: "Resume project" }).click();
    await expect(resumeSheet).toBeHidden();
    await expect(banner).toBeHidden();

    const [project] = await serviceSelect<{ held_at: string | null }>(
      `projects?id=eq.${projectId}&select=held_at`,
    );
    expect(project?.held_at).toBeNull();
    const [moved] = await serviceSelect<{ planned_date: string }>(
      `project_items?id=eq.${reel3}&select=planned_date`,
    );
    expect(moved?.planned_date).toBe(newDate);
    const [carried] = await serviceSelect<{ state: string }>(
      `project_items?id=eq.${reel2}&select=state`,
    );
    expect(carried?.state).toBe("carried");
    await removeClientFixture(client);
  });

  test("a project the Owner holds reads On hold up front for its Admin: the rows, the page, the deliverable", async ({
    page,
  }, info) => {
    // v2.0 X1 (the owner's walk, 2026-11-04): the Admin is told (project_held) and sees the hold
    // wherever the project shows, before any tick is tried.
    const client = nameOf(info, "owner-held");
    const clientId = await workClient(client, admin.email);
    const name = "Owner held";
    const projectId = await rpcAs<string>(admin.email, admin.password, "project_create", {
      client_id: clientId,
      name,
      recurrence: "monthly",
      stages: ["Edit"],
      items: ["Reel 9"],
    });
    await rpcAs(owner.email, owner.password, "project_hold", {
      project_id: projectId,
      reason: REASON,
    });
    const [told] = await serviceSelect<{ kind: string }>(
      `notifications?recipient_id=eq.${await memberIdOf(admin.email)}&kind=eq.project_held&entity_id=eq.${projectId}&select=kind`,
    );
    expect(told?.kind).toBe("project_held");

    await runInstalled(page);
    // The client's Overview and Projects tab: the row reads On hold, never Open.
    for (const path of [`/clients/${clientId}`, `/clients/${clientId}/projects`]) {
      await page.goto(path);
      await hydrated(page);
      const row = page.locator('[data-slot="project-row"]').filter({ hasText: name });
      await expect(row.locator('[data-status="on_hold"]')).toHaveText("On hold");
      await expect(row.getByText("Open", { exact: true })).toHaveCount(0);
    }
    await page.locator('[data-slot="project-row"]').filter({ hasText: name }).click();
    await expect(page).toHaveURL(new RegExp(`/projects/${projectId}$`));
    await hydrated(page);
    const banner = page.locator('[data-slot="project-hold-banner"]');
    await expect(banner).toContainText("On hold since");
    await expect(banner).toContainText(REASON);

    // The deliverable's sheet says it at once: the chip, why the ticks wait, the tick off.
    await page
      .locator('[data-slot="item-row"]', { hasText: "Reel 9" })
      .locator('[data-slot="item-open"]')
      .click();
    const sheet = page.locator('[data-slot="review-sheet"]').filter({ hasText: "Reel 9" });
    await expect(sheet).toBeVisible();
    await expect(sheet.locator('[data-status="on_hold"]')).toHaveText("On hold");
    await expect(sheet.locator('[data-slot="item-hold-note"]')).toHaveText(
      "The project is on hold: ticks and Mark done wait until it is resumed.",
    );
    await expect(sheet.getByRole("checkbox", { name: "Edit" })).toBeDisabled();
    // Dimmed once (owner, #89 6812253725): the held stages take the muted colour and are not
    // faded again, so their names read at about 6:1 on the sheet (3.1:1 when also faded).
    const held = await sheet.evaluate((element) => {
      const rgb = (value: string) => (value.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
      const luminance = (value: string) => {
        const [r, g, b] = rgb(value).map((channel) => {
          const c = channel / 255;
          return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
        });
        return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
      };
      const background = getComputedStyle(element).backgroundColor;
      return [...element.querySelectorAll<HTMLElement>('[data-slot="item-stage-tick"]')].map(
        (tick) => {
          const [light, dark] = [luminance(getComputedStyle(tick).color), luminance(background)]
            .sort((a, b) => b - a)
            .map(Number);
          return {
            opacity: getComputedStyle(tick).opacity,
            contrast: Math.round(((light! + 0.05) / (dark! + 0.05)) * 100) / 100,
          };
        },
      );
    });
    expect(held.length, "the held deliverable's stages").toBeGreaterThan(0);
    for (const stage of held) {
      expect(stage.opacity, "a held stage is not faded").toBe("1");
      expect(stage.contrast, "a held stage's name on the sheet").toBeGreaterThanOrEqual(4.5);
    }
    // Measured once the sheet has finished sliding in: on a laptop it enters from the right, and
    // mid-slide it reaches past the edge (full CI 42016075320).
    await sheet.evaluate((element) =>
      Promise.all(element.getAnimations({ subtree: true }).map((animation) => animation.finished)),
    );
    await expectNoHorizontalScroll(page);
    // A layer: back closes it, the project stays (§14.2).
    await page.goBack();
    await expect(sheet).toBeHidden();
    await expect(page).toHaveURL(new RegExp(`/projects/${projectId}`));
    await removeClientFixture(client);
  });

  test("the reports count held deliverables; an Admin outside the client is offered no Hold", async ({
    page,
  }, info) => {
    const client = nameOf(info, "report client");
    const clientId = await workClient(client, admin.email);
    const projectId = await rpcAs<string>(admin.email, admin.password, "project_create", {
      client_id: clientId,
      name: "Held posts",
      recurrence: "monthly",
      stages: [],
      items: ["Post 1", "Post 2"],
    });
    await rpcAs(admin.email, admin.password, "project_hold", {
      project_id: projectId,
      reason: "Client paused",
    });
    await page.goto("/reports");
    await hydrated(page);
    const line = page.locator('[data-slot="report-on-hold"]');
    await expect(line).toContainText(/On hold · \d+ deliverables?/);
    await expect(page.getByText("₹")).toHaveCount(0);
    await line.click();
    await expect(page).toHaveURL(
      /\/clients\/(items\?filter=on_hold|[0-9a-f-]{36}\/projects\/[0-9a-f-]{36})$/,
    );

    // A client another Admin runs: this Admin never reaches its project, and the function refuses.
    const other = nameOf(info, "other client");
    const otherId = await workClient(other, `gate-admin-${info.project.name}@maxoff.local`);
    const otherProject = await rpcAs<string>(owner.email, owner.password, "project_create", {
      client_id: otherId,
      name: "Owner's work",
      recurrence: "monthly",
      stages: [],
      items: ["Post"],
    });
    const refused = await rpcRefusedAs(admin.email, admin.password, "project_hold", {
      project_id: otherProject,
      reason: "Not mine",
    });
    expect(refused.message).toBe("NOT_FOUND");
    await page.goto(`/clients/${otherId}/projects/${otherProject}`);
    await expect(page.getByRole("button", { name: "Actions for Owner's work" })).toHaveCount(0);
    await expect(page.getByRole("menuitem", { name: "Put on hold…" })).toHaveCount(0);
    await removeClientFixture(client);
    await removeClientFixture(other);
  });
});

test.describe("a one-time project resumed after its delivery date", () => {
  test.use({ storageState: storageStateFor("admin") });

  test("a passed delivery date must move: the field is required, the database refuses without it", async ({
    page,
  }, info) => {
    const client = nameOf(info, "delivery client");
    const clientId = await workClient(client, admin.email);
    const name = "Launch film";
    const projectId = await rpcAs<string>(admin.email, admin.password, "project_create", {
      client_id: clientId,
      name,
      recurrence: "one_time",
      delivery_date: addISTDays(todayIST(), 10),
      stages: ["Edit"],
      items: ["Film"],
    });
    const passed = addISTDays(todayIST(), -1);
    await serviceUpdate(`projects?id=eq.${projectId}`, { delivery_date: passed });
    await rpcAs(admin.email, admin.password, "project_hold", {
      project_id: projectId,
      reason: "Client paused the launch",
    });
    // Owner 2026-11-03 (W7 Q5): the transaction refuses a resume that leaves the passed date.
    const refused = await rpcRefusedAs(admin.email, admin.password, "project_resume", {
      project_id: projectId,
      items: [],
    });
    expect(refused.message).toBe("VALIDATION");
    expect(refused.details).toMatch(
      /^The delivery date \(.+\) has passed: choose a new one from today on\.$/,
    );

    await runInstalled(page);
    await page.goto(`/clients/${clientId}/projects`);
    await page.goto(`/clients/${clientId}/projects/${projectId}`);
    await hydrated(page);
    await page.locator('[data-slot="project-resume"]').click();
    const sheet = page.getByRole("dialog", { name: `Resume “${name}”` });
    await expect(sheet).toBeVisible();
    // Required, so no "(optional)"; the hint says it passed.
    const field = sheet.getByLabel("New delivery date", { exact: true });
    await expect(field).toBeVisible();
    await expect(sheet.getByText("New delivery date (optional)")).toHaveCount(0);
    await expect(sheet).toContainText("now passed. Choose a date from today on.");
    await expectNoHorizontalScroll(page);

    // Sent empty: the field says why and the project stays on hold.
    await sheet.getByRole("button", { name: "Resume project" }).click();
    await expect(sheet).toContainText("has passed: choose a new one from today on.");
    await expect(sheet).toBeVisible();
    const [still] = await serviceSelect<{ held_at: string | null }>(
      `projects?id=eq.${projectId}&select=held_at`,
    );
    expect(still?.held_at).not.toBeNull();

    // Back closes the sheet (§14.2), the page stays.
    await page.goBack();
    await expect(sheet).toBeHidden();
    await expect(page).toHaveURL(new RegExp(`/projects/${projectId}$`));

    const day = addISTDays(todayIST(), 3);
    await page.locator('[data-slot="project-resume"]').click();
    await field.fill(day);
    await sheet.getByRole("button", { name: "Resume project" }).click();
    await expect(sheet).toBeHidden();
    await expect(page.locator('[data-slot="project-hold-banner"]')).toBeHidden();
    await expect
      .poll(async () => {
        const [row] = await serviceSelect<{ held_at: string | null; delivery_date: string }>(
          `projects?id=eq.${projectId}&select=held_at,delivery_date`,
        );
        return row && row.held_at === null ? row.delivery_date : null;
      })
      .toBe(day);
    await removeClientFixture(client);
  });
});
