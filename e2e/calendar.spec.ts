import type { Locator, Page, TestInfo } from "@playwright/test";

import { expect, test } from "./fixtures";
import {
  animationsSettled,
  expectBackStack,
  expectNoHorizontalScroll,
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

/** A real finger's drag (the phone projects have touch), `dy` px from the middle of `target`. */
async function touchDrag(page: Page, target: Locator, dy: number): Promise<void> {
  const box = await target.boundingBox();
  if (!box) throw new Error("nothing to drag on screen");
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
  for (let step = 1; step <= 8; step += 1) {
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x, y: y + (dy * step) / 8 }],
    });
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await cdp.detach();
}

/**
 * The phone's page, its timeline and what is docked at the bottom, as the screen draws them: the
 * page's own scroll, the timeline's box and scroll, the hour labels' boxes, and the top of what
 * the page sits on (the push band while it shows, else the bottom bar's content under its 1px
 * top border).
 */
async function phoneLayout(page: Page) {
  return page.evaluate(() => {
    const root = document.scrollingElement as HTMLElement;
    const hours = document.querySelector<HTMLElement>(
      '[data-slot="calendar-phone"] [data-slot="calendar-hours"]',
    );
    const box = hours?.getBoundingClientRect();
    const labels = hours
      ? [...hours.querySelectorAll("span")]
          .filter((span) => /^\d{2}:00$/.test(span.textContent ?? ""))
          .map((span) => {
            const rect = span.getBoundingClientRect();
            return { text: span.textContent ?? "", top: rect.top, bottom: rect.bottom };
          })
      : [];
    const band = document.querySelector<HTMLElement>('[data-slot="push-banner"]');
    const nav = document.querySelector<HTMLElement>('[data-slot="bottom-nav"]');
    const dock = band
      ? band.getBoundingClientRect().top
      : nav
        ? nav.getBoundingClientRect().top + parseFloat(getComputedStyle(nav).borderTopWidth)
        : window.innerHeight;
    return {
      pageOverflow: root.scrollHeight - root.clientHeight,
      pageTop: root.scrollTop,
      top: box?.top ?? 0,
      bottom: box?.bottom ?? 0,
      height: box?.height ?? 0,
      scrollTop: hours?.scrollTop ?? 0,
      scrolls: hours ? hours.scrollHeight - hours.clientHeight : 0,
      labels,
      dock,
    };
  });
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

  test("phone: Today while the next month is still on its way stays on today's month, and the bar ends", async ({
    page,
  }, info) => {
    test.skip(!isPhone(info), "the phone's header");
    // The next month's screen is held until Today has been tapped (main CI run 37792867778: it
    // arrived after Today and took the calendar back to the next month). Every router request for
    // another month is held from before the page loads, its prefetch included: a prefetch that had
    // already answered let the router move with no request at all (PR #57 run 37804856535).
    let release = () => {};
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    let held = 0;
    await page.route(/\/calendar\?date=/, async (route) => {
      if (route.request().headers()["rsc"] === "1") {
        held += 1;
        await released;
      }
      // The router may have given the held request up meanwhile.
      await route.continue().catch(() => undefined);
    });
    await page.goto("/calendar");
    await hydrated(page);
    const label = page.locator('[data-slot="calendar-month-label"]');
    const thisMonth = formatIST(istDayStart(todayIST()), "MMM yyyy");
    await page.locator('[data-slot="calendar-next"]').click();
    await expect(label).not.toHaveText(thisMonth);
    // The move is still on its way: a request for it is held and the address hasn't changed.
    await expect.poll(() => held).toBeGreaterThan(0);
    await expect(page).toHaveURL(/\/calendar$/);
    await page.locator('[data-slot="calendar-today"]').click();
    await expect(label).toHaveText(thisMonth);
    release();
    // The dropped month answers late: the navigation is over (the bar ends, §14.2 i) and today's
    // month stays.
    await expect(page.locator("html")).not.toHaveAttribute("data-nav-pending");
    await expect(label).toHaveText(thisMonth);
    await expect(page).toHaveURL(/\/calendar$/);
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

    // A day before today offers no "+ New task" (a new deadline is later than now, kickoff 4
    // decision 4): neither the month's day dialog nor the Day's side column.
    const past = addISTDays(todayIST(), -1);
    await page.goto(`/calendar?date=${past}`);
    await hydrated(page);
    await dayBox(page, past).click();
    await expect(daySheet(page)).toHaveAttribute("data-date", past);
    await expect(daySheet(page).locator('[data-slot="calendar-open-day"]')).toBeVisible();
    await expect(daySheet(page).locator('[data-slot="new-task-on-day"]')).toHaveCount(0);
    await page.goto(`/calendar?view=day&date=${past}`);
    await hydrated(page);
    await expect(detail(page)).toHaveAttribute("data-date", past);
    await expect(page.locator('[data-slot="new-task-on-day"]')).toHaveCount(0);
    await removeTasksTitled(prefixOf(info));
  });

  test("laptop (the owner's 2026-10-08 changes): the day popup's agenda, Week and Day fit the screen, the keyboard, hover", async ({
    page,
  }, info) => {
    test.skip(isPhone(info), "the laptop's views");
    const prefix = prefixOf(info);
    await removeTasksTitled(prefix);
    // This test's day: in today's week and month, never today or a day the other specs fill
    // (their shoots are today, their deadlines the next working days), so what it adds never
    // crowds a box or a "Who's free" another project is reading.
    const taken = new Set([todayIST(), workingDay(1), workingDay(2), workingDay(3)]);
    const week0 = Array.from({ length: 7 }, (_, offset) =>
      addISTDays(todayIST(), offset - ((istWeekday(todayIST()) + 6) % 7)),
    );
    const sameMonth = (date: string) => date.slice(0, 7) === todayIST().slice(0, 7);
    const free = week0.filter(
      (date) => !taken.has(date) && sameMonth(date) && !date.endsWith("-10-02"),
    );
    // A later day first: an earlier one would make its deadline overdue on everyone's Today.
    const later = free.filter((date) => date > todayIST());
    const day =
      later.find((date) => istWeekday(date) !== 0 && istWeekday(date) !== 6) ??
      later[0] ??
      free[0] ??
      todayIST();
    const staffId = await memberIdOf(USERS.staff.email);
    const event = async (title: string, from: string, to: string, clientId: string | null) =>
      rpcAs<string>(USERS.owner.email, USERS.owner.password, "task_create", {
        title,
        description: null,
        task_type_id: await taskTypeId("Shoot / Site Visit"),
        client_id: clientId,
        priority: "medium",
        due_at: istInstant(workingDay(3), "18:00"),
        assignee_ids: [staffId],
        primary_owner_id: staffId,
        approving_admin_id: null,
        stages: [],
        event_date: day,
        event_start_at: istInstant(day, from as "10:00"),
        event_end_at: istInstant(day, to as "11:00"),
        location: "Studio C",
      });
    const shoot = { id: await event(`${prefix}agenda shoot`, "10:00", "11:00", null) };
    const shootTitle = `${prefix}agenda shoot`;
    await ownerCreatesDue(info, day);
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
    const longShoot = await event(`${prefix}long shoot`, "13:00", "15:30", client.id);

    await page.goto("/calendar");
    await hydrated(page);
    const laptop = page.locator('[data-slot="calendar-laptop"]');
    await expect(laptop).toHaveAttribute("data-view", "month");
    const historyLength = () => page.evaluate(() => window.history.length);

    // 1. A Month day's popup: no timeline, the agenda in time order, the buttons pinned below.
    await dayBox(page, day).click();
    const popup = daySheet(page);
    await expect(popup).toHaveAttribute("data-layout", "laptop");
    await expect(popup.locator('[data-slot="calendar-timeline"]')).toHaveCount(0);
    const agenda = popup.locator('[data-slot="calendar-agenda-events"]');
    await expect(eventOf(agenda, shoot)).toContainText(`10:00–11:00 · ${shootTitle} · Local Staff`);
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
      `New task on ${shortDay(day)}`,
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
        mainPadding: parseFloat(
          getComputedStyle(document.querySelector("main") as Element).paddingBottom,
        ),
        hoursScroll: hours ? hours.scrollHeight - hours.clientHeight : 0,
      };
    });
    expect(fit.pageScroll, "the page does not scroll").toBeLessThanOrEqual(0);
    // Down to the bottom of the page's own area: the viewport less main's bottom padding (which
    // clears a band such as the push banner when one shows).
    expect(
      Math.abs(fit.viewport - fit.mainPadding - fit.bottom),
      "down to the bottom",
    ).toBeLessThan(2);
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
    // The mouse comes from outside the timeline, as a person's does.
    await page.mouse.move(2, 2);
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
        `[data-slot="calendar-all-day-row"] > [data-date="${day}"] [data-slot="calendar-due-chip"]`,
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
    // T comes back to today; D is the Day view, which fits too, its side panel beside it; ← and
    // → step a day there, to this test's day.
    await page.keyboard.press("t");
    await expect(page).not.toHaveURL(/date=/);
    await page.keyboard.press("d");
    await expect(laptop).toHaveAttribute("data-view", "day");
    const steps = Math.round(
      (Date.parse(`${day}T00:00:00Z`) - Date.parse(`${todayIST()}T00:00:00Z`)) / 86_400_000,
    );
    for (let step = 0; step < Math.abs(steps); step += 1) {
      await page.keyboard.press(steps > 0 ? "ArrowRight" : "ArrowLeft");
    }
    if (steps !== 0) await expect(page).toHaveURL(new RegExp(`date=${day}`));
    expect(await historyLength(), "moves and views add no history").toBe(beforeMoves);
    const dayView = page.locator('[data-slot="calendar-day-view"]');
    await expect(dayView).toBeVisible();
    const dayFit = await dayView.evaluate((view) => {
      const side = view.querySelector<HTMLElement>('[data-slot="calendar-day-side"]');
      const timeline = view.querySelector<HTMLElement>('[data-slot="calendar-timeline"]');
      return {
        pageScroll: document.documentElement.scrollHeight - window.innerHeight,
        timeline: timeline?.getBoundingClientRect().height ?? 0,
        side: side?.getBoundingClientRect().height ?? 0,
        bottom: view.getBoundingClientRect().bottom,
        viewport: window.innerHeight,
        mainPadding: parseFloat(
          getComputedStyle(document.querySelector("main") as Element).paddingBottom,
        ),
      };
    });
    expect(dayFit.pageScroll, "the page does not scroll").toBeLessThanOrEqual(0);
    expect(Math.abs(dayFit.timeline - dayFit.side), "the side panel is as tall").toBeLessThan(2);
    expect(Math.abs(dayFit.viewport - dayFit.mainPadding - dayFit.bottom)).toBeLessThan(2);
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
    // Clicking a block opens its task (the Week of this test's day).
    await page.keyboard.press("w");
    await expect(laptop).toHaveAttribute("data-view", "week");
    await eventOf(week, shoot).click();
    await expect(page).toHaveURL(new RegExp(`/tasks/${shoot.id}`));

    await removeTasksTitled(prefix);
  });
});

/**
 * The owner's phone walk (2026-10-08, note 1): in the week and the compact month the page never
 * scrolls; the header, the grid or strip, the handle, the day's title and its all-day chips stay
 * put, and the timeline fills what is left down to the bottom bar as the one scroll, opening 8 px
 * above its first hour so that label is whole. A finger on the timeline scrolls it; one on the
 * grid or the handle resizes. The full month fits with no timeline.
 */
test.describe("the calendar on a phone, the owner's walk (2026-10-08)", () => {
  test.use({ storageState: storageStateFor("owner") });

  test("week and compact month: the page never scrolls, the timeline is the one scroll down to the bottom bar, its first hour is whole; the handle swipes", async ({
    page,
  }, info) => {
    test.skip(!isPhone(info), "the phone's sizes");
    const prefix = `${prefixOf(info)}walk `;
    await removeTasksTitled(prefix);
    // A day of its own, weeks from the days the other specs fill, never today: its timeline
    // opens at 08:00. An all-day event (the owner's "Fire Chandan 2.0") and a timed shoot.
    const day = workingDay(36);
    const staffId = await memberIdOf(USERS.staff.email);
    const create = async (title: string, from: string | null, to: string | null) =>
      rpcAs<string>(USERS.owner.email, USERS.owner.password, "task_create", {
        title,
        description: null,
        task_type_id: await taskTypeId("Shoot / Site Visit"),
        client_id: null,
        priority: "medium",
        due_at: istInstant(day, "18:00"),
        assignee_ids: [staffId],
        primary_owner_id: staffId,
        approving_admin_id: null,
        stages: [],
        event_date: day,
        event_start_at: from ? istInstant(day, from as "10:00") : null,
        event_end_at: to ? istInstant(day, to as "11:00") : null,
        location: null,
      });
    const allDay = `${prefix}all day`;
    await create(allDay, null, null);
    await create(`${prefix}shoot`, "10:00", "11:00");

    await page.goto(`/calendar?date=${day}`);
    await hydrated(page);
    await expect(phone(page)).toHaveAttribute("data-size", "2");
    const hours = page.locator('[data-slot="calendar-phone"] [data-slot="calendar-hours"]');
    await expect(hours).toBeVisible();
    const handle = page.locator('button[data-slot="calendar-handle"]');
    const chip = detail(page)
      .locator('[data-slot="calendar-all-day"] [data-slot="calendar-event"]')
      .filter({ hasText: allDay });
    await expect(chip).toBeVisible();
    // What stays put while the timeline scrolls (the owner's list).
    const fixed = [
      page.locator('[data-slot="calendar-phone"] [data-slot="calendar-header"]'),
      page.locator('[data-slot="calendar-area"]'),
      handle,
      detail(page).locator('[data-slot="calendar-day-title"]'),
      chip,
    ];
    const boxes = () => Promise.all(fixed.map((part) => part.boundingBox()));
    // The first hour in sight is 08:00, its label whole (it opened 8 px above the hour).
    const opensWhole = (layout: Awaited<ReturnType<typeof phoneLayout>>, where: string) => {
      const inSight = layout.labels
        .filter((label) => label.bottom > layout.top && label.top < layout.bottom)
        .sort((a, b) => a.top - b.top);
      expect.soft(inSight[0]?.text, `${where}: opens at 08:00`).toBe("08:00");
      expect
        .soft(inSight[0]?.top ?? 0, `${where}: the first hour's label is whole`)
        .toBeGreaterThanOrEqual(layout.top - 1);
    };
    const hourOf = (layout: Awaited<ReturnType<typeof phoneLayout>>) => {
      const at = (text: string) => layout.labels.find((label) => label.text === text)?.top ?? 0;
      return at("09:00") - at("08:00");
    };

    for (const size of ["2", "1"] as const) {
      if (size === "1") {
        // A finger's swipe up on the handle shows less: the week.
        await touchDrag(page, handle, -100);
        await expect(phone(page)).toHaveAttribute("data-size", "1");
      }
      await animationsSettled(page);
      await expect.poll(async () => (await phoneLayout(page)).scrollTop).toBeGreaterThan(0);
      const fit = await phoneLayout(page);
      expect
        .soft(fit.pageOverflow, `size ${size}: the page does not scroll`)
        .toBeLessThanOrEqual(1);
      expect
        .soft(Math.abs(fit.bottom - fit.dock), `size ${size}: the timeline ends at the bottom bar`)
        .toBeLessThanOrEqual(1);
      expect.soft(fit.scrolls, `size ${size}: the timeline scrolls inside`).toBeGreaterThan(0);
      // It opened at 08:00 (the week keeps the scroll the person left in the compact month: a
      // size is view state; a fresh week is checked at the end).
      if (size === "2") opensWhole(fit, "the compact month");

      // A finger on the timeline scrolls it: the calendar keeps its size and nothing else moves;
      // a wheel over it scrolls it too, and the page stays at its top.
      const before = await boxes();
      await touchDrag(page, hours, -160);
      await expect(phone(page)).toHaveAttribute("data-size", size);
      const from = (await phoneLayout(page)).scrollTop;
      await hours.hover();
      await page.mouse.wheel(0, 300);
      await expect.poll(async () => (await phoneLayout(page)).scrollTop).toBeGreaterThan(from);
      const after = await phoneLayout(page);
      expect.soft(after.pageTop, `size ${size}: the page stays at its top`).toBe(0);
      expect.soft(await boxes(), `size ${size}: the fixed parts stay put`).toEqual(before);
    }

    // Large text: the fixed parts may take more of the screen and the timeline what is left, never
    // less than two hours; the page scrolls only when even those two hours do not fit, and at its
    // end the timeline still ends at the bottom bar. Nothing scrolls sideways.
    for (const size of ["1", "2"] as const) {
      if (size === "2") {
        await touchDrag(page, handle, 100);
        await expect(phone(page)).toHaveAttribute("data-size", "2");
      }
      for (const scale of [130, 200]) {
        await page.evaluate((percent) => {
          document.documentElement.style.fontSize = `${percent}%`;
        }, scale);
        await animationsSettled(page);
        await expectNoHorizontalScroll(page);
        const large = await phoneLayout(page);
        const hour = hourOf(large);
        expect
          .soft(large.height, `size ${size} at ${scale}%: two hours at least`)
          .toBeGreaterThanOrEqual(2 * hour - 1);
        if (large.pageOverflow > 1) {
          expect
            .soft(
              Math.abs(large.height - 2 * hour),
              `size ${size} at ${scale}%: the page scrolls only for the timeline's two hours`,
            )
            .toBeLessThanOrEqual(1);
        }
        await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
        const end = await phoneLayout(page);
        expect
          .soft(Math.abs(end.bottom - end.dock), `size ${size} at ${scale}%: down to the bar`)
          .toBeLessThanOrEqual(1);
        await page.evaluate(() => window.scrollTo(0, 0));
      }
      await page.evaluate(() => {
        document.documentElement.style.fontSize = "";
      });
    }

    // The full month fits the screen with no timeline: the handle just above the bottom bar.
    await handle.click();
    await expect(phone(page)).toHaveAttribute("data-size", "3");
    await expect(hours).toHaveCount(0);
    await animationsSettled(page);
    const full = await phoneLayout(page);
    const handleBox = await handle.boundingBox();
    expect.soft(full.pageOverflow, "size 3: the page does not scroll").toBeLessThanOrEqual(1);
    expect
      .soft((handleBox?.y ?? 0) + (handleBox?.height ?? 0), "size 3: above the bottom bar")
      .toBeLessThanOrEqual(full.dock + 1);

    // "Show less" goes back to a fresh week: its timeline opens at 08:00, the label whole.
    await handle.click();
    await expect(phone(page)).toHaveAttribute("data-size", "1");
    await animationsSettled(page);
    await expect.poll(async () => (await phoneLayout(page)).scrollTop).toBeGreaterThan(0);
    opensWhole(await phoneLayout(page), "the week");

    await removeTasksTitled(prefix);
  });
});
