import type { Page } from "@playwright/test";

import { expect, test } from "./fixtures";
import {
  hydrated,
  memberIdOf,
  rpcAs,
  runInstalled,
  storageStateFor,
  taskTypeId,
  USERS,
} from "./helpers";
import { addISTDays, istInstant, todayIST } from "../src/core/time";

const backLink = (page: Page) => page.locator('[data-slot="page-back"]:visible');

test.use({ storageState: storageStateFor("owner") });

test("probe: settings sub-page, dialog closed by its button, then back", async ({ page }, info) => {
  if (info.project.name !== "desktop") await runInstalled(page);
  await page.goto("/settings");
  await hydrated(page);
  await page.getByRole("link", { name: /Stage presets/ }).click();
  await expect(page).toHaveURL(/\/settings\/stage-presets$/);
  await hydrated(page);
  await page.getByRole("button", { name: "Add preset" }).first().click();
  const add = page.getByRole("dialog", { name: "Add a stage preset" });
  await expect(add).toBeVisible();
  await add
    .getByRole("button", { name: /Cancel|Close/ })
    .first()
    .click();
  await expect(add).toBeHidden();
  await backLink(page).click();
  await expect(page).toHaveURL(/\/settings$/);
});

test("probe: task edited from the calendar, then back", async ({ page }, info) => {
  if (info.project.name !== "desktop") await runInstalled(page);
  const staffId = await memberIdOf(USERS.staff.email);
  const later = addISTDays(todayIST(), 9);
  const earlier = addISTDays(todayIST(), 5);
  const title = `Probe ${info.project.name}`;
  const id = await rpcAs<string>(USERS.owner.email, USERS.owner.password, "task_create", {
    title,
    description: null,
    task_type_id: await taskTypeId("Normal"),
    client_id: null,
    priority: "medium",
    due_at: istInstant(later, "18:00"),
    assignee_ids: [staffId],
    primary_owner_id: staffId,
    approving_admin_id: null,
    stages: [],
  });
  await page.goto(`/calendar?view=day&date=${later}`);
  await hydrated(page);
  await page.locator(`[data-slot="calendar-due"][data-task="${id}"]:visible`).first().click();
  await expect(page).toHaveURL(new RegExp(`/tasks/${id}$`));
  await hydrated(page);
  await page.getByRole("button", { name: "Task actions" }).click();
  await page.getByRole("menuitem", { name: "Edit task" }).click();
  const dialog = page.getByRole("dialog").filter({ hasText: "Edit task" });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Priority").click();
  await page.getByRole("option", { name: "High" }).first().click();
  await dialog.getByLabel("Deadline").fill(earlier);
  await dialog.getByRole("button", { name: "Save changes" }).click();
  await expect(dialog).toBeHidden();
  await backLink(page).click();
  await expect(page).toHaveURL(new RegExp(`/calendar\\?view=day&date=${later}$`));
  await expect(page.locator(`[data-slot="calendar-due"][data-task="${id}"]:visible`)).toHaveCount(
    0,
  );
  await page.goto(`/calendar?view=day&date=${earlier}`);
  await expect(page.locator(`[data-slot="calendar-due"][data-task="${id}"]:visible`)).toHaveCount(
    1,
  );
});
