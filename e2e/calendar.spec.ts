import type { Page, TestInfo } from "@playwright/test";

import { expect, test } from "./fixtures";
import {
  expectBackStack,
  hydrated,
  memberIdOf,
  pageHeader,
  removeTasksTitled,
  rpcAs,
  runInstalled,
  signIn,
  storageStateFor,
  taskTypeId,
  USERS,
} from "./helpers";
import { addISTDays, istInstant, istWeekday, todayIST } from "../src/core/time";

/**
 * The calendar (6.4; Kickoff 6 decisions 13–15, 22; PERMISSIONS §2 "Calendar"): event tasks at
 * their date and time, other deadlines as a Due list, leave and holidays, by day, week and month.
 * Crew see their own; an Admin sees the tasks they can see in full and everyone else's events as
 * "Busy" blocks (a name and a time, nothing else); the Owner everything. The view, the day and the
 * filters are view state: on an installed phone none of them adds history (ARCHITECTURE §14.2 d),
 * checked at 375 and 430px. The fixture is one shoot today (the seed's Crew member, nobody else),
 * so the Admin, who is not on it and whose clients it does not carry, sees only a Busy block.
 */

function prefixOf(info: TestInfo): string {
  return `Cal ${info.project.name} `;
}

const isPhone = (info: TestInfo) => info.project.name !== "desktop";

/** A weekday (Mon–Fri) `offset` days from today, IST, never 2 Oct (a seeded holiday). */
function workingDay(offset: number): string {
  let day = addISTDays(todayIST(), offset);
  while (istWeekday(day) === 0 || istWeekday(day) === 6 || day.endsWith("-10-02")) {
    day = addISTDays(day, 1);
  }
  return day;
}

async function ownerCreatesShoot(info: TestInfo): Promise<{ id: string; title: string }> {
  const title = `${prefixOf(info)}shoot`;
  const staffId = await memberIdOf(USERS.staff.email);
  const today = todayIST();
  const id = await rpcAs<string>(USERS.owner.email, USERS.owner.password, "task_create", {
    title,
    description: null,
    task_type_id: await taskTypeId("Shoot / Site Visit"),
    client_id: null,
    priority: "medium",
    due_at: istInstant(workingDay(3), "18:00"),
    assignee_ids: [staffId],
    primary_owner_id: staffId,
    approving_admin_id: null,
    stages: [],
    event_date: today,
    event_start_at: istInstant(today, "10:00"),
    event_end_at: istInstant(today, "11:00"),
    location: "Studio B",
  });
  return { id, title };
}

async function ownerCreatesDue(info: TestInfo, date: string): Promise<string> {
  const staffId = await memberIdOf(USERS.staff.email);
  return rpcAs<string>(USERS.owner.email, USERS.owner.password, "task_create", {
    title: `${prefixOf(info)}edit`,
    description: null,
    task_type_id: await taskTypeId("Normal"),
    client_id: null,
    priority: "medium",
    due_at: istInstant(date, "18:00"),
    assignee_ids: [staffId],
    primary_owner_id: staffId,
    approving_admin_id: null,
    stages: [],
  });
}

const calendar = (page: Page) => page.locator('[data-slot="calendar"]');
const eventRow = (page: Page, title: string) =>
  page.locator('[data-slot="calendar-event"]:visible').filter({ hasText: title });

test.describe.configure({ mode: "serial" });

test.describe("the calendar, as Crew", () => {
  test.use({ storageState: storageStateFor("staff") });

  test("today's shoot at its time, a deadline as Due on its day, the type filter only, an empty day", async ({
    page,
  }, info) => {
    const prefix = prefixOf(info);
    await removeTasksTitled(prefix);
    const shoot = await ownerCreatesShoot(info);
    const dueDay = workingDay(1);
    await ownerCreatesDue(info, dueDay);

    await page.goto("/calendar");
    await expect(pageHeader(page)).toContainText("Calendar");
    // A phone opens on Day, a desktop on Week: the shoot is on today's rows either way.
    const row = eventRow(page, shoot.title);
    await expect(row).toBeVisible();
    await expect(row).toContainText("10:00 am – 11:00 am");
    await expect(row).toContainText("Studio B");
    await expect(page.locator('[data-slot="calendar-busy"]')).toHaveCount(0);
    // The strip marks today, and its chip carries the day's dot.
    const todayChip = page.locator(`[data-slot="calendar-strip-day"][data-date="${todayIST()}"]`);
    await expect(todayChip).toHaveAttribute("aria-current", "date");
    // Crew filter by type only (decision 15).
    await expect(page.locator('[data-slot="calendar-filter-type"]')).toBeVisible();
    await expect(page.locator('[data-slot="calendar-filter-client"]')).toHaveCount(0);
    await expect(page.locator('[data-slot="calendar-filter-person"]')).toHaveCount(0);
    await expect(page.locator('[data-slot="calendar-filter-status"]')).toHaveCount(0);

    // The deadline is a Due row on its day, never a block (decision 14).
    await page.goto(`/calendar?view=day&date=${dueDay}`);
    const due = page.locator('[data-slot="calendar-due"]').filter({ hasText: `${prefix}edit` });
    await expect(due).toBeVisible();
    await expect(page.locator('[data-slot="calendar-due-list"] h3')).toContainText("Due");
    await expect(eventRow(page, `${prefix}edit`)).toHaveCount(0);

    // A day with nothing on it says so (decision 22).
    await page.goto(`/calendar?view=day&date=${workingDay(400)}`);
    await expect(page.locator('[data-slot="calendar-empty-day"]')).toHaveText(
      "Nothing on this day.",
    );
  });

  test("installed: Day · Week · Month, the strip, a month day and the filter add no history; a task is a drill-down", async ({
    page,
  }, info) => {
    test.skip(!isPhone(info), "the installed app is a phone");
    const shoot = await ownerCreatesShoot(info);
    await runInstalled(page);
    await signIn(page, USERS.staff.email, USERS.staff.password);
    await expect(page).toHaveURL(/\/my-day$/);
    await hydrated(page);
    await page.locator('[data-slot="bottom-nav"] [data-nav="calendar"]').click();
    await expect(page).toHaveURL(/\/calendar$/);
    await hydrated(page);

    await page
      .locator('[data-slot="calendar-view"]:visible')
      .getByRole("link", { name: "Week" })
      .click();
    await expect(page).toHaveURL(/\/calendar\?view=week$/);
    await page
      .locator('[data-slot="calendar-view"]:visible')
      .getByRole("link", { name: "Month" })
      .click();
    await expect(page).toHaveURL(/\/calendar\?view=month$/);
    await page.locator(`[data-slot="calendar-month-day"][data-date="${todayIST()}"]`).click();
    await expect(page).toHaveURL(/\/calendar\?view=day$/);
    const tomorrow = addISTDays(todayIST(), 1);
    const chip = page.locator(`[data-slot="calendar-strip-day"][data-date="${tomorrow}"]`);
    if (await chip.isVisible()) {
      await chip.click();
      await expect(page).toHaveURL(new RegExp(`/calendar\\?view=day&date=${tomorrow}$`));
    }
    await page.locator('[data-slot="calendar-pager"] a[aria-label="Previous day"]').click();
    await page.locator('[data-slot="calendar-filter-type"]').click();
    await page.getByRole("option", { name: "Shoot / Site Visit" }).click();
    await expect(page).toHaveURL(/type=/);
    // Every move above was a view change: one back leaves the calendar for the home tab.
    await expectBackStack(page, [{ url: /\/my-day$/ }]);

    // An event row is a real drill-down: back returns to the calendar, the view kept.
    await page.goto(`/calendar?view=day&date=${todayIST()}`);
    await hydrated(page);
    await eventRow(page, shoot.title).click();
    await expect(page).toHaveURL(new RegExp(`/tasks/${shoot.id}$`));
    await expectBackStack(page, [{ url: new RegExp(`/calendar\\?view=day&date=${todayIST()}$`) }]);
  });
});

test.describe("the calendar, as an Admin", () => {
  test.use({ storageState: storageStateFor("admin") });

  test("someone else's shoot is a Busy block with the name and time only; every filter", async ({
    page,
  }, info) => {
    const shoot = await ownerCreatesShoot(info);
    await page.goto(`/calendar?view=day&date=${todayIST()}`);
    const busy = page.locator('[data-slot="calendar-busy"]').filter({ hasText: "Local Staff" });
    await expect(busy).toBeVisible();
    await expect(busy).toContainText("Busy");
    await expect(busy).toContainText("10:00 am – 11:00 am");
    await expect(calendar(page)).not.toContainText(shoot.title);
    await expect(calendar(page)).not.toContainText("Studio B");
    for (const kind of ["client", "person", "type", "status"]) {
      await expect(page.locator(`[data-slot="calendar-filter-${kind}"]`)).toBeVisible();
    }
  });
});

test.describe("the calendar, as the Owner", () => {
  test.use({ storageState: storageStateFor("owner") });

  test("everything in full; the month counts it; the status filter hides an open task", async ({
    page,
  }, info) => {
    const shoot = await ownerCreatesShoot(info);
    await page.goto(`/calendar?view=day&date=${todayIST()}`);
    const row = eventRow(page, shoot.title);
    await expect(row).toBeVisible();
    await expect(row).toContainText("Local Staff");
    await expect(page.locator('[data-slot="calendar-busy"]')).toHaveCount(0);

    await page.goto("/calendar?view=month");
    const cell = page.locator(`[data-slot="calendar-month-day"][data-date="${todayIST()}"]`);
    await expect(cell).toContainText(/\d+ events?/);

    await page.goto(`/calendar?view=day&date=${todayIST()}&status=done`);
    await expect(eventRow(page, shoot.title)).toHaveCount(0);
    await removeTasksTitled(prefixOf(info));
  });
});
