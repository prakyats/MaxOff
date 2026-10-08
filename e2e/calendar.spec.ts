import type { Locator, Page, TestInfo } from "@playwright/test";

import { expect, test } from "./fixtures";
import {
  expectBackStack,
  hydrated,
  memberIdOf,
  pageHeader,
  removeTasksTitled,
  rpcAs,
  runInstalled,
  serviceInsert,
  serviceSelect,
  storageStateFor,
  taskTypeId,
  USERS,
} from "./helpers";
import {
  addISTDays,
  formatIST,
  istDayStart,
  istInstant,
  istWeekday,
  systemClock,
  todayIST,
  toISTTime,
} from "../src/core/time";

/**
 * The calendar rework (6.4b; Kickoff 6 decisions 13, 14, 22 and 25; PERMISSIONS §2 "Calendar").
 *
 * **Phone** (375 and 430): one calendar in three sizes (the week strip, the compact month it opens
 * on with today selected, the full month), changed by a vertical drag on the calendar or by the
 * handle; the day's detail under the first two (the all-day line, the hour timeline, "Due · N",
 * "Who's free", the day's action); a day of the full month opens the day sheet, which back closes.
 * **Laptop** (1280): Day · Week · Month, opening on Month; a day opens in a dialog with "Open day".
 * Crew see their own (no Busy, no "Who's free", "Suggest a task" with the day); an Admin sees the
 * tasks they can see and everyone else as Busy; the Owner everything and "+ New task on <day>",
 * the form opening with the day as the deadline. The size, the day and the filters are view
 * state: on an installed phone none adds history (ARCHITECTURE §14.2 d). The fixture is one shoot
 * today on the seed's Crew member (10:00–11:00, Studio B) and an ordinary task due tomorrow.
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
const phone = (page: Page) => page.locator('[data-slot="calendar-phone"]');
/** The day's detail on screen: the phone's panel or the laptop Day's side column. */
const detail = (page: Page) => page.locator('[data-slot="calendar-detail"]:visible').first();
const daySheet = (page: Page) => page.locator('[data-calendar="day-sheet"]');
const eventIn = (scope: Locator, title: string) =>
  scope.locator('[data-slot="calendar-event"]').filter({ hasText: title });
/** One task's event by its id: the spec's own shoot, never an earlier test's of the same title. */
const eventOf = (scope: Locator, task: { id: string }) =>
  scope.locator(`[data-slot="calendar-event"][data-task="${task.id}"]`);
/** A day's box in the month on screen (the phone's or the laptop's). */
const dayBox = (page: Page, date: string) =>
  page.locator(`[data-slot="calendar-day"][data-date="${date}"]:visible`);

/** "8 Oct", as the New-task pill says it. */
const shortDay = (date: string) => formatIST(istDayStart(date), "d MMM");

/** A drag on the phone's calendar, `dy` px down (negative: up), as a finger would. */
async function dragCalendar(page: Page, dy: number): Promise<void> {
  const area = page.locator('[data-slot="calendar-area"]');
  const box = await area.boundingBox();
  if (!box) throw new Error("the calendar is not on screen");
  const x = box.x + box.width / 2;
  const y = dy > 0 ? box.y + 20 : box.y + box.height - 20;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y + dy, { steps: 6 });
  await page.mouse.up();
}

test.describe.configure({ mode: "serial" });

test.describe("the calendar, as Crew", () => {
  test.use({ storageState: storageStateFor("staff") });

  test("opens on today: the shoot at its time, a deadline as Due on its day, the type filter only, an empty day", async ({
    page,
  }, info) => {
    const prefix = prefixOf(info);
    await removeTasksTitled(prefix);
    const shoot = await ownerCreatesShoot(info);
    const dueDay = workingDay(1);
    await ownerCreatesDue(info, dueDay);

    await page.goto("/calendar");
    await expect(pageHeader(page)).toContainText("Calendar");
    await hydrated(page);
    if (isPhone(info)) {
      // The compact month, today selected, its detail under it (decision 25 A).
      await expect(phone(page)).toHaveAttribute("data-size", "2");
      await expect(page.locator('[data-slot="calendar-month"]:visible')).toHaveAttribute(
        "data-density",
        "compact",
      );
      await expect(dayBox(page, todayIST())).toHaveAttribute("data-selected", "");
      // The header is one compact row: the short month on one line ("Oct 2026", the owner's
      // review), the full name for a screen reader.
      const label = page.locator('[data-slot="calendar-month-label"]');
      await expect(label).toHaveText(formatIST(istDayStart(todayIST()), "MMM yyyy"));
      await expect(label).toHaveAttribute(
        "aria-label",
        formatIST(istDayStart(todayIST()), "MMMM yyyy"),
      );
      // Every item's middle on the same line: the header did not wrap.
      const spread = await page
        .locator('[data-slot="calendar-phone"] [data-slot="calendar-header"] > *')
        .evaluateAll((items) => {
          const middles = items.map((item) => {
            const box = item.getBoundingClientRect();
            return box.top + box.height / 2;
          });
          return Math.max(...middles) - Math.min(...middles);
        });
      expect(spread, "the header is one row").toBeLessThan(4);
    } else {
      // The laptop opens on Month; a day opens in the dialog.
      await expect(page.locator('[data-slot="calendar-laptop"]')).toHaveAttribute(
        "data-view",
        "month",
      );
      await expect(dayBox(page, todayIST())).toHaveAttribute("aria-label", new RegExp(shoot.title));
      await dayBox(page, todayIST()).click();
      await expect(daySheet(page)).toBeVisible();
    }
    const today = isPhone(info) ? detail(page) : daySheet(page);
    const row = eventOf(today, shoot);
    await expect(row).toBeVisible();
    if (isPhone(info)) {
      await expect(row).toContainText("10:00 am – 11:00 am");
      await expect(row).toContainText("Studio B");
    } else {
      // The laptop's popup is a compact agenda (the owner, 2026-10-08): "10:00–11:00 · title ·
      // people".
      await expect(row).toContainText(`10:00–11:00 · ${shoot.title} · Local Staff`);
    }
    await expect(page.locator('[data-slot="calendar-busy"]')).toHaveCount(0);
    // Crew: no "Who's free"; "Suggest a task" with the day in its details (decision 25 D, G).
    await expect(page.locator('[data-slot="calendar-who-free"]')).toHaveCount(0);
    await expect(page.locator('[data-slot="new-task-on-day"]')).toHaveCount(0);
    await today.locator('[data-slot="suggest-task"]').click();
    await expect(page.getByRole("textbox", { name: /Details/ })).toHaveValue(
      `For ${formatIST(istDayStart(todayIST()), "EEE d MMM")}.`,
    );
    await page.keyboard.press("Escape");
    await expect(page.getByRole("textbox", { name: /Details/ })).toHaveCount(0);
    if (!isPhone(info)) {
      await page.keyboard.press("Escape");
      await expect(daySheet(page)).toHaveCount(0);
    }

    // Crew filter by type only (decision 15), in the one Filters sheet (decision 25 F).
    await page.locator('[data-slot="calendar-filters-button"]:visible').click();
    const sheet = page.locator('[data-calendar="filters-sheet"]');
    await expect(sheet).toBeVisible();
    await expect(sheet.locator('[data-field="calendar-filter-type"]')).toBeVisible();
    await expect(sheet.locator('[data-field="calendar-filter-client"]')).toHaveCount(0);
    await expect(sheet.locator('[data-field="calendar-filter-person"]')).toHaveCount(0);
    await expect(sheet.locator('[data-field="calendar-filter-status"]')).toHaveCount(0);
    await sheet.locator('[data-slot="calendar-filters-done"]').click();
    await expect(sheet).toHaveCount(0);

    // The deadline is Due on its day, never a block or a strip (decision 14), and a day with only
    // a due task is not "Nothing on this day." (08 Oct bug (c)).
    await page.goto(`/calendar?view=day&date=${dueDay}`);
    await hydrated(page);
    const due = detail(page)
      .locator('[data-slot="calendar-due"]')
      .filter({ hasText: `${prefix}edit` });
    await expect(due).toBeVisible();
    await expect(detail(page).locator('[data-slot="calendar-due-list"] h3')).toContainText(
      "Due · ",
    );
    await expect(detail(page).locator('[data-slot="calendar-empty-day"]')).toHaveCount(0);
    await expect(eventIn(detail(page), `${prefix}edit`)).toHaveCount(0);

    // A day with nothing on it says so (decision 22).
    await page.goto(`/calendar?view=day&date=${workingDay(400)}`);
    await expect(detail(page).locator('[data-slot="calendar-empty-day"]')).toHaveText(
      "Nothing on this day.",
    );
  });

  test("phone: the three sizes by drag and by the handle; the full month opens the day sheet", async ({
    page,
  }, info) => {
    test.skip(!isPhone(info), "the sizes are the phone's");
    const shoot = await ownerCreatesShoot(info);
    await page.goto("/calendar");
    await hydrated(page);
    const handle = page.locator('button[data-slot="calendar-handle"]');
    await expect(phone(page)).toHaveAttribute("data-size", "2");
    await expect(handle).toHaveAccessibleName("Show more of the month");

    // By drag: down grows to the full month, up shrinks to the compact month and to the week.
    await dragCalendar(page, 140);
    await expect(phone(page)).toHaveAttribute("data-size", "3");
    await expect(page.locator('[data-slot="calendar-month"]:visible')).toHaveAttribute(
      "data-density",
      "full",
    );
    await expect(detail(page)).toHaveCount(0);
    await dragCalendar(page, -140);
    await expect(phone(page)).toHaveAttribute("data-size", "2");
    await dragCalendar(page, -100);
    await expect(phone(page)).toHaveAttribute("data-size", "1");
    await expect(page.locator('[data-slot="calendar-week-strip"]')).toBeVisible();
    await expect(
      page.locator(`[data-slot="calendar-strip-day"][data-date="${todayIST()}"]`),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(eventOf(detail(page), shoot)).toBeVisible();

    // By the handle: a 44px button that grows it, and at the full month shows less.
    const box = await handle.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
    await handle.click();
    await expect(phone(page)).toHaveAttribute("data-size", "2");
    await handle.click();
    await expect(phone(page)).toHaveAttribute("data-size", "3");
    await expect(handle).toHaveAccessibleName("Show less");
    await handle.focus();
    await page.keyboard.press("Enter");
    await expect(phone(page)).toHaveAttribute("data-size", "1");
    await handle.click();
    await expect(phone(page)).toHaveAttribute("data-size", "2");

    // A sideways drag moves a month; Today comes back.
    const label = page.locator('[data-slot="calendar-month-label"]');
    const thisMonth = formatIST(istDayStart(todayIST()), "MMM yyyy");
    await page.locator('[data-slot="calendar-next"]').click();
    await expect(label).not.toHaveText(thisMonth);
    await page.locator('[data-slot="calendar-today"]').click();
    await expect(label).toHaveText(thisMonth);

    // The full month: a day opens the day sheet with its detail.
    await handle.click();
    await expect(phone(page)).toHaveAttribute("data-size", "3");
    await dayBox(page, todayIST()).click();
    await expect(daySheet(page)).toBeVisible();
    await expect(eventOf(daySheet(page), shoot)).toBeVisible();
  });

  test("installed: sizes, days, a month and a filter add no history; the day sheet closes on back; a task is a drill-down", async ({
    page,
  }, info) => {
    test.skip(!isPhone(info), "the installed app is a phone");
    const shoot = await ownerCreatesShoot(info);
    await runInstalled(page);
    // Already signed in (the describe's storage state): the app opens on the home tab.
    await page.goto("/my-day");
    await expect(page).toHaveURL(/\/my-day$/);
    await hydrated(page);
    await page.locator('[data-slot="bottom-nav"] [data-nav="calendar"]').click();
    await expect(page).toHaveURL(/\/calendar$/);
    await hydrated(page);

    const handle = page.locator('button[data-slot="calendar-handle"]');
    await handle.click();
    await expect(phone(page)).toHaveAttribute("data-size", "3");
    // The day sheet is a layer: back closes it and stays on the calendar.
    await dayBox(page, todayIST()).click();
    await expect(daySheet(page)).toBeVisible();
    await expectBackStack(page, [{ closes: daySheet(page), url: /\/calendar(\?.*)?$/ }]);
    await expect(phone(page)).toHaveAttribute("data-size", "3");

    await handle.click();
    await expect(phone(page)).toHaveAttribute("data-size", "1");
    await handle.click();
    const tomorrow = addISTDays(todayIST(), 1);
    if (await dayBox(page, tomorrow).isVisible()) {
      await dayBox(page, tomorrow).click();
      await expect(detail(page)).toHaveAttribute("data-date", tomorrow);
    }
    await page.locator('[data-slot="calendar-next"]').click();
    await expect(page).toHaveURL(/date=/);
    await page.locator('[data-slot="calendar-today"]').click();
    await page.locator('[data-slot="calendar-filters-button"]:visible').click();
    const sheet = page.locator('[data-calendar="filters-sheet"]');
    await sheet.locator('[data-field="calendar-filter-type"]').click();
    await page.getByRole("option", { name: "Shoot / Site Visit" }).click();
    await sheet.locator('[data-slot="calendar-filters-done"]').click();
    await expect(page).toHaveURL(/type=/);
    await expect(page.locator('[data-slot="calendar-filters-button"]:visible')).toHaveText(
      /Filters · 1/,
    );
    // Every move above was a view change: one back leaves the calendar for the home tab.
    await expectBackStack(page, [{ url: /\/my-day$/ }]);

    // An event is a real drill-down: back returns to the calendar, the day kept.
    await page.goto(`/calendar?date=${todayIST()}`);
    await hydrated(page);
    await eventOf(detail(page), shoot).click();
    await expect(page).toHaveURL(new RegExp(`/tasks/${shoot.id}$`));
    await expectBackStack(page, [{ url: new RegExp(`/calendar\\?date=${todayIST()}$`) }]);
  });
});

test.describe("the calendar, as an Admin", () => {
  test.use({ storageState: storageStateFor("admin") });

  test("someone else's shoot is Busy with the name and time only; who's free; every filter", async ({
    page,
  }, info) => {
    const shoot = await ownerCreatesShoot(info);
    await page.goto(`/calendar?view=day&date=${todayIST()}`);
    await hydrated(page);
    const busy = page
      .locator('[data-slot="calendar-busy"]:visible')
      .filter({ hasText: "Local Staff" });
    await expect(busy.first()).toBeVisible();
    await expect(busy.first()).toContainText("busy");
    await expect(calendar(page)).not.toContainText(shoot.title);
    await expect(calendar(page)).not.toContainText("Studio B");
    // "Who's free" over the people the Admin can see (decision 25 D).
    const free = detail(page).locator('[data-slot="calendar-who-free"]');
    // "Who's free: …" once, then "Busy …" only when someone is (the owner's review).
    await expect(free).toContainText(/^Who's free: /);
    await expect(free).not.toContainText("Free:");
    await expect(free).toContainText(/Busy [^:]*10[^:]*: [^·]*Local Staff/);
    // An Admin creates tasks: the pill, not "Suggest a task".
    await expect(detail(page).locator('[data-slot="new-task-on-day"]')).toBeVisible();
    await expect(detail(page).locator('[data-slot="suggest-task"]')).toHaveCount(0);
    await page.locator('[data-slot="calendar-filters-button"]:visible').click();
    const sheet = page.locator('[data-calendar="filters-sheet"]');
    for (const kind of ["client", "person", "type", "status"]) {
      await expect(sheet.locator(`[data-field="calendar-filter-${kind}"]`)).toBeVisible();
    }
  });
});

test.describe("the calendar, as the Owner", () => {
  test.use({ storageState: storageStateFor("owner") });

  test("everything in full; the month's strip; + New task on the day opens the form on that day", async ({
    page,
  }, info) => {
    const shoot = await ownerCreatesShoot(info);
    const day = workingDay(2);
    await page.goto("/calendar");
    await hydrated(page);
    // The box tells what it holds; the shoot's strip is in its type's colour, never red.
    await expect(dayBox(page, todayIST())).toHaveAttribute("aria-label", new RegExp(shoot.title));
    if (!isPhone(info)) {
      const strip = dayBox(page, todayIST())
        .locator('[data-slot="calendar-strip"][data-kind="event"]')
        .first();
      await expect(strip).toBeVisible();
      const edge = await strip.evaluate((element) => getComputedStyle(element).borderLeftColor);
      expect(edge).not.toMatch(/rgb\((19[0-9]|2\d\d), (\d|[1-5]\d), (\d|[1-5]\d)\)/);
    }

    await page.goto(`/calendar?view=day&date=${todayIST()}`);
    await hydrated(page);
    const row = page.locator(`[data-slot="calendar-event"][data-task="${shoot.id}"]:visible`);
    await expect(row.first()).toBeVisible();
    await expect(row.first()).toContainText("Local Staff");
    await expect(page.locator('[data-slot="calendar-busy"]')).toHaveCount(0);

    // The email's link (`?view=day&date=`) opens that day: the laptop's Day, the phone's detail.
    await page.goto(`/calendar?view=day&date=${day}`);
    await hydrated(page);
    await expect(detail(page)).toHaveAttribute("data-date", day);
    if (!isPhone(info)) {
      await expect(page.locator('[data-slot="calendar-day-view"]')).toBeVisible();
    }
    // + New task on that day: the form opens with the deadline on it (decision 25 D).
    const pill = detail(page).locator('[data-slot="new-task-on-day"]');
    await expect(pill).toHaveText(`New task on ${shortDay(day)}`);
    await pill.click();
    const form = page.locator('[data-slot="task-form-dialog"]');
    await expect(form).toBeVisible();
    await expect(form.locator('input[name="dueDate"]')).toHaveValue(day);
    await expect(form.locator('input[name="dueTime"]')).toHaveValue("18:00");
    // An event type asks for its date, already the day.
    await form.getByLabel("Type").click();
    await page.getByRole("option", { name: "Shoot / Site Visit" }).first().click();
    await expect(form.locator('input[name="eventDate"]')).toHaveValue(day);
    // Picking a type changed the form, so leaving it asks first (§14.2 f); discard it.
    await form.getByRole("button", { name: "Cancel" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Discard task" }).click();
    await expect(form).toHaveCount(0);

    // The status filter (in the sheet) hides an open event.
    await page.goto(`/calendar?view=day&date=${todayIST()}&status=done`);
    await hydrated(page);
    await expect(page.locator('[data-slot="calendar-filters-button"]:visible')).toHaveText(
      /Filters · 1/,
    );
    await expect(eventOf(page.locator('[data-slot="calendar"]'), shoot)).toHaveCount(0);
  });

  test("laptop: Month → a day's dialog → Open day; Week is a 7-column timeline", async ({
    page,
  }, info) => {
    test.skip(isPhone(info), "the laptop's views");
    const shoot = await ownerCreatesShoot(info);
    await page.goto("/calendar");
    await hydrated(page);
    await dayBox(page, todayIST()).click();
    await expect(daySheet(page)).toBeVisible();
    await expect(daySheet(page).locator('[data-slot="calendar-who-free"]')).toBeVisible();
    await daySheet(page).locator('[data-slot="calendar-open-day"]').click();
    await expect(daySheet(page)).toHaveCount(0);
    await expect(page.locator('[data-slot="calendar-laptop"]')).toHaveAttribute("data-view", "day");
    await expect(page).toHaveURL(/view=day/);
    await page.locator('[data-slot="calendar-view"]').getByRole("link", { name: "Week" }).click();
    await expect(page.locator('[data-slot="calendar-laptop"]')).toHaveAttribute(
      "data-view",
      "week",
    );
    const week = page.locator('[data-slot="calendar-timeline"][data-days="7"]');
    await expect(week).toBeVisible();
    await expect(eventOf(week, shoot)).toBeVisible();
    await removeTasksTitled(prefixOf(info));
  });

  test("laptop (the owner's 2026-10-08 changes): the day popup's agenda, Week and Day fit the screen, the keyboard, hover", async ({
    page,
  }, info) => {
    test.skip(isPhone(info), "the laptop's views");
    const prefix = prefixOf(info);
    await removeTasksTitled(prefix);
    const shoot = await ownerCreatesShoot(info);
    await ownerCreatesDue(info, todayIST());
    // A long shoot with a client: room for the client under its title. The client is this
    // project's own, made once and kept (tasks once labelled with it keep their history).
    const clientName = `${prefix}client`;
    let [client] = await serviceSelect<{ id: string }>(
      `clients?name=eq.${encodeURIComponent(clientName)}&select=id`,
    );
    if (!client) {
      const [org] = await serviceSelect<{ id: string }>("organizations?select=id&limit=1");
      client = await serviceInsert<{ id: string }>("clients", {
        org_id: org?.id,
        name: clientName,
        admin_id: await memberIdOf(USERS.admin.email),
      });
      await rpcAs(USERS.owner.email, USERS.owner.password, "client_activate", {
        client_id: client.id,
      });
    }
    const staffId = await memberIdOf(USERS.staff.email);
    const longShoot = await rpcAs<string>(USERS.owner.email, USERS.owner.password, "task_create", {
      title: `${prefix}long shoot`,
      description: null,
      task_type_id: await taskTypeId("Shoot / Site Visit"),
      client_id: client.id,
      priority: "medium",
      due_at: istInstant(workingDay(3), "18:00"),
      assignee_ids: [staffId],
      primary_owner_id: staffId,
      approving_admin_id: null,
      stages: [],
      event_date: todayIST(),
      event_start_at: istInstant(todayIST(), "13:00"),
      event_end_at: istInstant(todayIST(), "15:30"),
      location: "Studio C",
    });

    await page.goto("/calendar");
    await hydrated(page);
    const laptop = page.locator('[data-slot="calendar-laptop"]');
    await expect(laptop).toHaveAttribute("data-view", "month");
    const historyLength = () => page.evaluate(() => window.history.length);

    // 1. A Month day's popup: no timeline, the agenda in time order, the buttons pinned below.
    await dayBox(page, todayIST()).click();
    const popup = daySheet(page);
    await expect(popup).toHaveAttribute("data-layout", "laptop");
    await expect(popup.locator('[data-slot="calendar-timeline"]')).toHaveCount(0);
    const agenda = popup.locator('[data-slot="calendar-agenda-events"]');
    await expect(eventOf(agenda, shoot)).toContainText(
      `10:00–11:00 · ${shoot.title} · Local Staff`,
    );
    await expect(eventOf(agenda, { id: longShoot })).toContainText(
      `1:00–3:30 · ${prefix}long shoot · Local Staff · ${clientName}`,
    );
    const order = await agenda
      .locator('[data-slot="calendar-event"]')
      .evaluateAll((rows) => rows.map((row) => row.getAttribute("data-task")));
    expect(order.indexOf(shoot.id), "time order").toBeLessThan(order.indexOf(longShoot));
    await expect(popup.locator('[data-slot="calendar-due-list"] h3')).toContainText("Due · ");
    await expect(popup.locator('[data-slot="calendar-who-free"]')).toBeVisible();
    const footer = popup.locator('[data-slot="calendar-day-footer"]');
    await expect(footer.locator('[data-slot="new-task-on-day"]')).toHaveText(
      `New task on ${shortDay(todayIST())}`,
    );
    await expect(footer.locator('[data-slot="calendar-open-day"]')).toBeVisible();
    // One scroll at most, the body's; the dialog itself never scrolls and the footer is its last
    // row, flush with its bottom.
    const box = await popup.evaluate((dialog) => {
      const body = dialog.querySelector<HTMLElement>('[data-slot="calendar-day-body"]');
      const foot = dialog.querySelector<HTMLElement>('[data-slot="calendar-day-footer"]');
      return {
        dialogScrolls: dialog.scrollHeight > dialog.clientHeight + 1,
        bodyOverflow: body ? getComputedStyle(body).overflowY : "",
        footBottom: foot?.getBoundingClientRect().bottom ?? 0,
        dialogBottom: dialog.getBoundingClientRect().bottom,
      };
    });
    expect(box.dialogScrolls, "the dialog never scrolls itself").toBe(false);
    expect(box.bodyOverflow).toBe("auto");
    expect(Math.abs(box.dialogBottom - box.footBottom), "the footer is pinned").toBeLessThan(2);
    // The keyboard is quiet while the popup is open.
    await page.keyboard.press("w");
    await expect(laptop).toHaveAttribute("data-view", "month");
    await page.keyboard.press("Escape");
    await expect(popup).toHaveCount(0);

    // 2. The keyboard: W to Week (view state: the address replaced, no history).
    const beforeKeys = await historyLength();
    await page.keyboard.press("w");
    await expect(laptop).toHaveAttribute("data-view", "week");
    await expect(page).toHaveURL(/view=week/);
    // Never with a modifier key.
    await page.keyboard.press("Shift+D");
    await expect(laptop).toHaveAttribute("data-view", "week");
    expect(await historyLength(), "a view switch adds no history").toBe(beforeKeys);

    // 3. Week fits the screen: no page scroll, the timeline down to the bottom, one scroll inside.
    const week = page.locator('[data-slot="calendar-timeline"][data-days="7"]');
    await expect(week).toBeVisible();
    const fit = await week.evaluate((timeline) => {
      const hours = timeline.querySelector<HTMLElement>('[data-slot="calendar-hours"]');
      return {
        pageScroll: document.documentElement.scrollHeight - window.innerHeight,
        bottom: timeline.getBoundingClientRect().bottom,
        viewport: window.innerHeight,
        hoursScroll: hours ? hours.scrollHeight - hours.clientHeight : 0,
      };
    });
    expect(fit.pageScroll, "the page does not scroll").toBeLessThanOrEqual(0);
    expect(fit.bottom).toBeLessThanOrEqual(fit.viewport);
    expect(fit.viewport - fit.bottom, "the timeline reaches the bottom").toBeLessThan(40);
    expect(fit.hoursScroll, "the hours scroll inside").toBeGreaterThan(0);
    // The day headings and the all-day row line up with the hours' columns exactly.
    const columns = await week.evaluate((timeline) => {
      const edges = (selector: string) =>
        [...timeline.querySelectorAll<HTMLElement>(selector)].map((cell) => {
          const rect = cell.getBoundingClientRect();
          return [Math.round(rect.left), Math.round(rect.right)];
        });
      return {
        header: edges('[data-slot="calendar-timeline-header"] > div'),
        allDay: edges('[data-slot="calendar-all-day-row"] > div'),
        hours: edges('[data-slot="calendar-hours-day"]'),
      };
    });
    expect(columns.hours).toHaveLength(7);
    for (const [index, [left, right]] of columns.hours.entries()) {
      for (const row of [columns.header, columns.allDay]) {
        expect(Math.abs((row[index]?.[0] ?? -99) - (left ?? 0))).toBeLessThanOrEqual(1);
        expect(Math.abs((row[index]?.[1] ?? -99) - (right ?? 0))).toBeLessThanOrEqual(1);
      }
    }
    // 4. It opened at now on today's week (an hour above it), never at midnight.
    const nowMinute = (() => {
      const [hours, minutes] = toISTTime(systemClock().toISOString()).split(":").map(Number);
      return (hours ?? 0) * 60 + (minutes ?? 0);
    })();
    const opened = await week.locator('[data-slot="calendar-hours"]').evaluate((hours) => ({
      top: hours.scrollTop,
      max: hours.scrollHeight - hours.clientHeight,
      hour: hours.scrollHeight / 24,
    }));
    const expectedNow = Math.min(
      opened.max,
      (Math.max(0, Math.min(nowMinute - 60, 21 * 60)) / 60) * opened.hour,
    );
    expect(Math.abs(opened.top - expectedNow), "scrolled to now").toBeLessThan(opened.hour);

    // 5. Hovering a block shows its details; the client sits under a long block's title.
    const long = eventOf(week, { id: longShoot });
    await expect(long.locator('[data-slot="calendar-event-client"]')).toHaveText(clientName);
    await long.scrollIntoViewIfNeeded();
    await page.evaluate(
      () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
    );
    await long.hover();
    const details = page.locator(`[data-slot="calendar-event-details"][data-task="${longShoot}"]`);
    await expect(details).toBeVisible();
    await expect(details).toContainText("Studio C");
    await expect(details).toContainText(clientName);
    await page.mouse.move(2, 2);
    await expect(details).toHaveCount(0);

    // 6. "Due · N" in the all-day row opens that day's popup.
    await week
      .locator(
        `[data-slot="calendar-all-day-row"] > [data-date="${todayIST()}"] [data-slot="calendar-due-chip"]`,
      )
      .click();
    await expect(popup).toBeVisible();
    await expect(
      popup.locator('[data-slot="calendar-due"]').filter({ hasText: `${prefix}edit` }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(popup).toHaveCount(0);

    // 7. → moves a week: a week without today opens at 08:00.
    const beforeMoves = await historyLength();
    await page.keyboard.press("ArrowRight");
    await expect(page).toHaveURL(new RegExp(`date=${addISTDays(todayIST(), 7)}`));
    await expect
      .poll(() =>
        week.locator('[data-slot="calendar-hours"]').evaluate((hours) => {
          const hour = hours.scrollHeight / 24;
          return Math.round(hours.scrollTop / hour);
        }),
      )
      .toBe(8);
    // T comes back to today; D is the Day view, which fits too, its side panel beside it.
    await page.keyboard.press("t");
    await expect(page).not.toHaveURL(/date=/);
    await page.keyboard.press("d");
    await expect(laptop).toHaveAttribute("data-view", "day");
    expect(await historyLength(), "moves and views add no history").toBe(beforeMoves);
    const day = page.locator('[data-slot="calendar-day-view"]');
    await expect(day).toBeVisible();
    const dayFit = await day.evaluate((view) => {
      const side = view.querySelector<HTMLElement>('[data-slot="calendar-day-side"]');
      const timeline = view.querySelector<HTMLElement>('[data-slot="calendar-timeline"]');
      return {
        pageScroll: document.documentElement.scrollHeight - window.innerHeight,
        timeline: timeline?.getBoundingClientRect().height ?? 0,
        side: side?.getBoundingClientRect().height ?? 0,
        bottom: view.getBoundingClientRect().bottom,
        viewport: window.innerHeight,
      };
    });
    expect(dayFit.pageScroll, "the page does not scroll").toBeLessThanOrEqual(0);
    expect(Math.abs(dayFit.timeline - dayFit.side), "the side panel is as tall").toBeLessThan(2);
    expect(dayFit.viewport - dayFit.bottom).toBeLessThan(40);
    // "Due · N" in the Day's all-day row opens the popup too.
    await page.locator('[data-slot="calendar-day-view"] [data-slot="calendar-due-chip"]').click();
    await expect(popup).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(popup).toHaveCount(0);
    // M back to Month, as view state too (§14.2 d).
    const beforeMonth = await historyLength();
    await page.keyboard.press("m");
    await expect(laptop).toHaveAttribute("data-view", "month");
    await expect(page).toHaveURL(/view=month/);
    expect(await historyLength()).toBe(beforeMonth);
    // Clicking a block opens its task.
    await page.keyboard.press("w");
    await expect(laptop).toHaveAttribute("data-view", "week");
    await eventOf(week, shoot).click();
    await expect(page).toHaveURL(new RegExp(`/tasks/${shoot.id}`));

    await removeTasksTitled(prefix);
  });
});
