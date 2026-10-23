import type { Locator, Page, TestInfo } from "@playwright/test";

import { expect, test } from "./fixtures";
import {
  animationsSettled,
  expectBackStack,
  expectNoHorizontalScroll,
  hydrated,
  memberIdOf,
  pageHeader,
  removeClientFixture,
  removeFreelancersNamed,
  removeTasksTitled,
  resetAttendanceAndLeave,
  rpcAs,
  runInstalled,
  serviceInsert,
  serviceSelect,
  storageStateFor,
  taskTypeId,
  USERS,
  openMoreOptions,
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
  // The project's earlier shoot goes first (PROGRESS 7B later item (g)): each test makes its own,
  // and five of them side by side at 10:00 today squeezed the timeline's blocks to 33 px for
  // mobile.spec's 44 px sweep when both specs ran. One shoot per project is all a test reads.
  await removeTasksTitled(title);
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

/**
 * All · Tasks · Client work (SCOPE §6) as the `All ▾` menu button (v1.8, owner 23 Oct: the laptop
 * toolbar and, option A, the phone header); it carries `data-current`.
 */
const showControl = (page: Page) => page.locator('[data-slot="calendar-show-menu"]:visible');

/** The words a button shows (the hidden wording of two left out). */
const shownLabel = (button: Locator) =>
  button.evaluate((element) => (element as HTMLElement).innerText.trim());

/** Chooses All, Tasks or Client work through the `All ▾` menu (the phone header or the laptop's toolbar). */
async function chooseShow(page: Page, show: "all" | "tasks" | "client") {
  await showControl(page).click();
  await page.getByRole("menu").locator(`[role="menuitemradio"][data-show="${show}"]`).click();
  await expect(page.getByRole("menu")).toHaveCount(0);
}

/** "8 Oct", as the New-task pill says it. */
const shortDay = (date: string) => formatIST(istDayStart(date), "d MMM");

/** The laptop month's "+" of a day (PP-calendar-13) and the box that shows or hides it. */
const plusOf = (page: Page, date: string) =>
  page.locator(`[data-slot="calendar-add-task"][data-date="${date}"]`);
const plusHolder = (page: Page, date: string) =>
  page.locator(`[data-slot="calendar-add"]:has([data-date="${date}"])`);

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
          .filter((span) => /^\d{1,2} (am|pm)$/.test(span.textContent ?? ""))
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

/**
 * The day's availability for the Owner and Admins: the "Busy all day" / "Everyone is available"
 * line, or, with someone on leave and nobody busy all day, no line beside the leave chip
 * (PP-phone-2 / PP-admin-1, V5b): the chip says it once.
 */
async function expectAvailability(scope: Locator): Promise<void> {
  const free = scope.locator('[data-slot="calendar-who-free"]');
  const leave = scope.locator('[data-slot="calendar-leave"]');
  await expect(free.or(leave).first()).toBeVisible();
  if ((await free.count()) > 0) await expect(free).not.toContainText("On leave");
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
      // The laptop's popup is a compact agenda (the owner, 2026-10-08) of the month's chips, the
      // title first (PP-calendar-2, 8, V5b): "title · 10:00 am – 11:00 am · people".
      await expect(row).toContainText(`${shoot.title} · 10:00 am – 11:00 am · Local Staff`);
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

    // A sideways drag moves a month; Today comes back. Today is inactive while today's month is
    // on screen (the owner, 22 Oct), and active once another month is.
    const label = page.locator('[data-slot="calendar-month-label"]');
    const thisMonth = formatIST(istDayStart(todayIST()), "MMM yyyy");
    const todayButton = page.locator('[data-slot="calendar-today"]');
    await expect(todayButton).toHaveAttribute("aria-disabled", "true");
    await expect(todayButton).toHaveAttribute("tabindex", "-1");
    await page.locator('[data-slot="calendar-next"]').click();
    await expect(label).not.toHaveText(thisMonth);
    await expect(todayButton).not.toHaveAttribute("aria-disabled");
    await todayButton.click();
    await expect(label).toHaveText(thisMonth);
    await expect(todayButton).toHaveAttribute("aria-disabled", "true");

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
    await expect(
      page.locator('[data-slot="calendar-filters-button"]:visible'),
    ).toHaveAccessibleName(/Filters · 1/);
    // Every move above was a view change: one back leaves the calendar for the home tab.
    await expectBackStack(page, [{ url: /\/my-day$/ }]);

    // An event is a real drill-down: back returns to the calendar, the day kept.
    await page.goto(`/calendar?date=${todayIST()}`);
    await hydrated(page);
    await eventOf(detail(page), shoot).click();
    await expect(page).toHaveURL(new RegExp(`/tasks/${shoot.id}$`));
    await expectBackStack(page, [{ url: new RegExp(`/calendar\\?date=${todayIST()}$`) }]);
  });

  test('no "+" in a day\'s box for Crew, who cannot create tasks (PP-calendar-13)', async ({
    page,
  }) => {
    await page.goto(`/calendar?date=${workingDay(21)}`);
    await hydrated(page);
    await expect(
      page.locator(`[data-slot="calendar-day"][data-date="${workingDay(21)}"]`),
    ).not.toHaveCount(0);
    await expect(page.locator('[data-slot="calendar-add"]')).toHaveCount(0);
    await expect(page.locator('[data-slot="calendar-add-task"]')).toHaveCount(0);
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
    // The day's availability (owner 2026-10-21): only who is away (Busy all day), never a free
    // list, never a part-day busy block (that one is on the timeline above), and never leave:
    // the "‹Name› · On leave" chip says it (PP-phone-2 / PP-admin-1, V5b). With someone on
    // leave and nobody busy all day the line is left out and the chip stands alone.
    const free = detail(page).locator('[data-slot="calendar-who-free"]');
    if ((await free.count()) === 0) {
      await expect(detail(page).locator('[data-slot="calendar-leave"]').first()).toBeVisible();
    } else {
      await expect(free).not.toContainText("Who's free");
      await expect(free).not.toContainText(/Busy 10:00 am/);
      await expect(free).not.toContainText("On leave");
      await expect(free).toContainText(/^(Busy all day: |Everyone is available$)/);
    }
    // An Admin creates tasks: the pill, not "Suggest a task".
    await expect(detail(page).locator('[data-slot="new-task-on-day"]')).toBeVisible();
    await expect(detail(page).locator('[data-slot="suggest-task"]')).toHaveCount(0);
    await page.locator('[data-slot="calendar-filters-button"]:visible').click();
    const sheet = page.locator('[data-calendar="filters-sheet"]');
    for (const kind of ["client", "person", "type", "status"]) {
      await expect(sheet.locator(`[data-field="calendar-filter-${kind}"]`)).toBeVisible();
    }
  });

  test('an Admin\'s laptop month has the "+" on a hovered day; a phone never shows it (PP-calendar-13)', async ({
    page,
  }, info) => {
    const day = workingDay(21);
    await page.goto(`/calendar?date=${day}`);
    await hydrated(page);
    if (isPhone(info)) {
      // A touch screen: the laptop's month is not shown, and its "+" exists for a mouse only.
      await expect(plusOf(page, day)).toBeHidden();
      return;
    }
    const box = dayBox(page, day);
    const size = await box.boundingBox();
    if (!size) throw new Error("the day is not on screen");
    await box.hover({ position: { x: size.width / 2, y: size.height - 8 } });
    await expect(plusHolder(page, day)).toHaveCSS("opacity", "1");
    await expect(plusOf(page, day)).toHaveAccessibleName(`New task on ${shortDay(day)}`);
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
      // A filled chip whose leading dot is the type's colour (the approved sample; V5b major change
      // 5: a leading dot plus its tint, no side stripe).
      await expect(strip).toHaveCSS("border-left-width", "0px");
      const dot = await strip
        .locator('[data-slot="calendar-type-dot"]')
        .evaluate((element) => getComputedStyle(element).backgroundColor);
      expect(dot).not.toMatch(/rgb\((19[0-9]|2\d\d), (\d|[1-5]\d), (\d|[1-5]\d)\)/);
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
    await openMoreOptions(form);
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
    await expect(
      page.locator('[data-slot="calendar-filters-button"]:visible'),
    ).toHaveAccessibleName(/Filters · 1/);
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
    await expectAvailability(daySheet(page));
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
    // The same chips as the month (PP-calendar-2, 8, V5b): the title first, then the time.
    await expect(eventOf(agenda, shoot)).toContainText(
      `${shootTitle} · 10:00 am – 11:00 am · Local Staff`,
    );
    await expect(eventOf(agenda, { id: longShoot })).toContainText(
      `${prefix}long shoot · 1:00 pm – 3:30 pm · Local Staff · ${clientName}`,
    );
    const order = await agenda
      .locator('[data-slot="calendar-event"]')
      .evaluateAll((rows) => rows.map((row) => row.getAttribute("data-task")));
    expect(order.indexOf(shoot.id), "time order").toBeLessThan(order.indexOf(longShoot));
    // SCOPE §6: the Owner's popup is in two parts, "Tasks · n" (the events and what is due) first.
    await expect(popup.locator('[data-slot="calendar-tasks-title"]')).toContainText("Tasks · ");
    await expect(popup.locator('[data-slot="calendar-due-list"]')).toBeVisible();
    await expectAvailability(popup);
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
    // Today is inactive on the week that holds today (the owner, 22 Oct), active a week later.
    const todayLaptop = page.locator('[data-slot="calendar-today-laptop"]');
    await expect(todayLaptop).toHaveAttribute("aria-disabled", "true");
    await page.keyboard.press("ArrowRight");
    await expect(page).toHaveURL(new RegExp(`date=${addISTDays(todayIST(), 7)}`));
    await expect(todayLaptop).not.toHaveAttribute("aria-disabled");
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
    // The Day of today: Today inactive; a day away from it, active (the owner, 22 Oct).
    await expect(todayLaptop).toHaveAttribute("aria-disabled", "true");
    const steps = Math.round(
      (Date.parse(`${day}T00:00:00Z`) - Date.parse(`${todayIST()}T00:00:00Z`)) / 86_400_000,
    );
    for (let step = 0; step < Math.abs(steps); step += 1) {
      await page.keyboard.press(steps > 0 ? "ArrowRight" : "ArrowLeft");
    }
    if (steps !== 0) {
      await expect(page).toHaveURL(new RegExp(`date=${day}`));
      await expect(todayLaptop).not.toHaveAttribute("aria-disabled");
    }
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

  test('laptop with a mouse: a day\'s empty part shows "+", which opens New task on that day; the keyboard reaches it (PP-calendar-13)', async ({
    page,
  }, info) => {
    test.skip(isPhone(info), "a mouse or trackpad's");
    await removeTasksTitled(prefixOf(info));
    const day = workingDay(21);
    // One deadline on the day: its chip is not the box's empty part.
    await ownerCreatesDue(info, day);
    await page.goto(`/calendar?date=${day}`);
    await hydrated(page);
    const box = dayBox(page, day);
    const plus = plusOf(page, day);
    const holder = plusHolder(page, day);
    const form = page.locator('[data-slot="task-form-dialog"]');
    await expect(plus).toHaveAccessibleName(`New task on ${shortDay(day)}`);
    // Hidden until the pointer is on the box's empty part; not on its chip.
    await page.mouse.move(0, 0);
    await expect(holder).toHaveCSS("opacity", "0");
    const size = await box.boundingBox();
    if (!size) throw new Error("the day is not on screen");
    const empty = { position: { x: size.width / 2, y: size.height - 8 } };
    await box.hover(empty);
    await expect(holder).toHaveCSS("opacity", "1");
    await box.locator('[data-slot="calendar-strip"]').first().hover();
    await expect(holder).toHaveCSS("opacity", "0");
    // At least 24 px, beside the box's button, never inside it.
    const target = await plus.boundingBox();
    expect(target?.width ?? 0).toBeGreaterThanOrEqual(24);
    expect(target?.height ?? 0).toBeGreaterThanOrEqual(24);
    expect(await box.locator('[data-slot="calendar-add-task"]').count()).toBe(0);

    // A click opens the existing New task form on that day, and no day dialog.
    await box.hover(empty);
    await plus.click();
    await expect(form).toBeVisible();
    await expect(form.locator('input[name="dueDate"]')).toHaveValue(day);
    await expect(daySheet(page)).toHaveCount(0);
    await form.getByRole("button", { name: "Cancel" }).click();
    await expect(form).toHaveCount(0);

    // The day itself still opens its dialog.
    await box.click(empty);
    await expect(daySheet(page)).toHaveAttribute("data-date", day);
    await expect(form).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(daySheet(page)).toHaveCount(0);

    // The keyboard: Tab from the day reaches its "+", shown with a focus ring; Enter opens the form.
    await page.mouse.move(0, 0);
    await box.focus();
    await page.keyboard.press("Tab");
    await expect(plus).toBeFocused();
    await expect(holder).toHaveCSS("opacity", "1");
    await expect(plus).not.toHaveCSS("box-shadow", "none");
    await page.keyboard.press("Enter");
    await expect(form).toBeVisible();
    await expect(form.locator('input[name="dueDate"]')).toHaveValue(day);
    await form.getByRole("button", { name: "Cancel" }).click();
    await expect(form).toHaveCount(0);
    await removeTasksTitled(prefixOf(info));
  });

  test('a day with more than its box holds ends in "+N more" on a laptop (PP-calendar-14); the phone counts it in one line (v1.7.1)', async ({
    page,
  }, info) => {
    const prefix = `${prefixOf(info)}crowd `;
    await removeTasksTitled(prefix);
    // Its own day per project, so the count is exactly this test's: five deadlines, two shown,
    // "+3 more". The offsets are reserved for this test (nine to eleven weeks on): the task
    // specs date their rows 52 days out or nearer, SCOPE §6's test 91 to 105. It used 35/42/49 until CI shard 2 (runs
    // 39720856747, 39730557999) put task-page's "Reorder … reel" (its day 42) on the phone's
    // 2026-12-03 first, and the box said "+4 more"; task-page and task-lists also use day 35.
    const offset = { desktop: 63, mobile: 70, "mobile-lg": 77 }[info.project.name] ?? 84;
    const day = workingDay(offset);
    // A collision names itself rather than miscounting: no other test's task is due that day.
    const others = await serviceSelect<{ title: string }>(
      `tasks?select=title&due_at=gte.${encodeURIComponent(istInstant(day, "00:00"))}` +
        `&due_at=lt.${encodeURIComponent(istInstant(addISTDays(day, 1), "00:00"))}`,
    );
    expect(
      others.map((task) => task.title),
      `${day} is this test's alone`,
    ).toEqual([]);
    const staffId = await memberIdOf(USERS.staff.email);
    const normal = await taskTypeId("Normal");
    for (const n of [1, 2, 3, 4, 5]) {
      await rpcAs<string>(USERS.owner.email, USERS.owner.password, "task_create", {
        title: `${prefix}${n}`,
        description: null,
        task_type_id: normal,
        client_id: null,
        priority: "medium",
        due_at: istInstant(day, "18:00"),
        assignee_ids: [staffId],
        primary_owner_id: staffId,
        approving_admin_id: null,
        stages: [],
      });
    }
    await page.goto(`/calendar?date=${day}`);
    await hydrated(page);
    if (isPhone(info)) {
      // The phone's full month draws the chips (the compact month only bars).
      await page.locator('button[data-slot="calendar-handle"]').click();
      await expect(phone(page)).toHaveAttribute("data-size", "3");
    }
    const box = dayBox(page, day);
    if (isPhone(info)) {
      // The phone's full month counts what is due (v1.7.1's day cells, the v1.8 fix round): five
      // deadlines are one "5 due" line, so the box never overflows and has no "+N more"; a tap
      // opens the day, which lists all five.
      const count = box.locator('[data-slot="calendar-strip"]');
      await expect(count).toHaveCount(1);
      await expect(count).toHaveAttribute("data-kind", "tasks");
      await expect(count).toHaveText("5 due");
      await expect(box.locator('[data-slot="calendar-more"]')).toHaveCount(0);
      expect(await count.evaluate((line) => line.scrollWidth <= line.clientWidth)).toBe(true);
      // A two-digit count reads whole too.
      expect(
        await count.evaluate((line) => {
          const words = line.textContent;
          line.textContent = "12 due";
          const fits = line.scrollWidth <= line.clientWidth;
          line.textContent = words;
          return fits;
        }),
        '"12 due" reads whole',
      ).toBe(true);
      await box.click();
      await expect(daySheet(page)).toBeVisible();
      await expect(daySheet(page)).toHaveAttribute("data-date", day);
      for (const n of [1, 2, 3, 4, 5]) {
        await expect(daySheet(page)).toContainText(`${prefix}${n}`);
      }
      await removeTasksTitled(prefix);
      return;
    }
    const more = box.locator('[data-slot="calendar-more"]');
    await expect(more).toBeVisible();
    await expect(more).toHaveText("+3 more");
    await expect(box.locator('[data-slot="calendar-strip"]')).toHaveCount(2);
    // Neither grown nor clipped: the line is whole inside its box, nothing hidden under it, and
    // the laptop's box keeps its 112 px.
    const fit = await box.evaluate((element) => {
      const line = element.querySelector('[data-slot="calendar-more"]') as HTMLElement;
      const list = line.parentElement as HTMLElement;
      const outer = element.getBoundingClientRect();
      const inner = line.getBoundingClientRect();
      return {
        inside: inner.top >= outer.top && inner.bottom <= outer.bottom,
        clipped: list.scrollHeight - list.clientHeight,
        height: outer.height,
      };
    });
    expect(fit.inside).toBe(true);
    expect(fit.clipped).toBeLessThanOrEqual(0);
    expect(fit.height).toBeCloseTo(112, 0);
    // "+3 more" is part of the box: it opens the day, which lists all five.
    await more.click();
    await expect(daySheet(page)).toBeVisible();
    await expect(daySheet(page)).toHaveAttribute("data-date", day);
    for (const n of [1, 2, 3, 4, 5]) {
      await expect(daySheet(page)).toContainText(`${prefix}${n}`);
    }
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
test.describe("the calendar on a phone, the owner's walk (2026-10-08; PP-light-4, V5b)", () => {
  test.use({ storageState: storageStateFor("owner") });

  test("week and compact month: the day is part of the page, which scrolls; the timeline has no scroll of its own and draws the hours around the events; the day's pill clears the bottom bar", async ({
    page,
  }, info) => {
    test.skip(!isPhone(info), "the phone's sizes");
    const prefix = `${prefixOf(info)}walk `;
    await removeTasksTitled(prefix);
    // A day of its own, weeks from the days the other specs fill, never today. An all-day event
    // (the owner's "Fire Chandan 2.0") and a timed shoot, 10:00 to 11:00.
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
    await expect(
      detail(page)
        .locator('[data-slot="calendar-all-day"] [data-slot="calendar-event"]')
        .filter({ hasText: allDay }),
    ).toBeVisible();
    const pill = detail(page).locator('[data-slot="new-task-on-day"]');

    for (const size of ["2", "1"] as const) {
      if (size === "1") {
        // A finger's swipe up on the handle shows less: the week.
        await touchDrag(page, handle, -100);
        await expect(phone(page)).toHaveAttribute("data-size", "1");
      }
      await animationsSettled(page);
      const fit = await phoneLayout(page);
      // No scroll inside the page: the timeline is as tall as its hours.
      expect.soft(fit.scrolls, `size ${size}: the timeline never scrolls inside`).toBe(0);
      // The hours around the shoot, an hour either side: 9 am to 12 pm (the first line unlabelled;
      // 12-hour labels, the owner 22 Oct).
      expect
        .soft(
          fit.labels.map((label) => label.text),
          `size ${size}: the hours around the shoot`,
        )
        .toEqual(["10 am", "11 am"]);
      // The page scrolls to the day's last row, which clears the bottom bar.
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      await expect(pill).toBeVisible();
      const end = await phoneLayout(page);
      const box = (await pill.boundingBox())!;
      expect
        .soft(end.dock - (box.y + box.height), `size ${size}: the pill sits above the bottom bar`)
        .toBeGreaterThanOrEqual(8);
      await page.evaluate(() => window.scrollTo(0, 0));
    }

    // Large text: nothing scrolls sideways, the timeline still has no scroll of its own.
    for (const scale of [130, 200]) {
      await page.evaluate((percent) => {
        document.documentElement.style.fontSize = `${percent}%`;
      }, scale);
      await animationsSettled(page);
      await expectNoHorizontalScroll(page);
      expect.soft((await phoneLayout(page)).scrolls, `${scale}%: no inner scroll`).toBe(0);
    }
    await page.evaluate(() => {
      document.documentElement.style.fontSize = "";
    });

    // The full month still fits the screen with no timeline: the handle just above the bottom bar.
    await handle.click();
    await expect(phone(page)).toHaveAttribute("data-size", "2");
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

    await removeTasksTitled(prefix);
  });
});

/**
 * 6b.12 (1) and (2), v1.7.1 (owner, 2026-10-12): **a deadline moved earlier moves on every
 * calendar view without a reload**, and **back at the top of a task opened from the calendar
 * returns to the view it came from** (§14.2 k). The owner's path, on each view: the calendar on
 * the old day, its task opened, the deadline moved two days earlier in the edit form (a select
 * picked on the way, which leaves its spent entry: the back control then did nothing), the back
 * control tapped once: the calendar's own address, the task gone from the old day and on the new
 * one, and still there after a reload. Installed on a phone (375 and 430); a browser on a laptop.
 */
/** Two days of one week and one month, in the future: the new deadline and the old one. */
function movedDays(): { earlier: string; later: string } {
  for (let offset = 4; offset < 60; offset += 1) {
    const later = addISTDays(todayIST(), offset);
    const earlier = addISTDays(later, -2);
    const weekday = istWeekday(later);
    if (weekday < 3 || weekday > 5) continue;
    if (later.slice(0, 7) !== earlier.slice(0, 7)) continue;
    if (later.endsWith("-10-02") || earlier.endsWith("-10-02")) continue;
    return { earlier, later };
  }
  throw new Error("no two days of one week and month in the next 60");
}

async function ownerCreatesDueOn(title: string, date: string): Promise<string> {
  await removeTasksTitled(title);
  const staffId = await memberIdOf(USERS.staff.email);
  return rpcAs<string>(USERS.owner.email, USERS.owner.password, "task_create", {
    title,
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

const dueOf = (scope: Locator, id: string) =>
  scope.locator(`[data-slot="calendar-due"][data-task="${id}"]`);
const backControl = (page: Page) => page.locator('[data-slot="page-back"]:visible');

/** The task page's edit form: the priority (a select) and the deadline, saved. */
async function moveDeadline(page: Page, to: string): Promise<void> {
  await page.getByRole("button", { name: "Task actions" }).click();
  await page.getByRole("menuitem", { name: "Edit task" }).click();
  const form = page.locator('[data-slot="task-form-dialog"]');
  await expect(form.getByRole("heading", { name: "Edit task" })).toBeVisible();
  await openMoreOptions(form);
  await form.getByLabel("Priority").click();
  await page.getByRole("option", { name: "High" }).first().click();
  await form.getByLabel("Deadline").fill(to);
  await form.getByRole("button", { name: "Save changes" }).click();
  await expect(form).toBeHidden();
}

async function phoneSize(page: Page, size: "1" | "2" | "3"): Promise<void> {
  const handle = page.locator('button[data-slot="calendar-handle"]');
  for (let tap = 0; tap < 3; tap += 1) {
    if ((await phone(page).getAttribute("data-size")) === size) return;
    const before = await phone(page).getAttribute("data-size");
    await handle.click();
    await expect(phone(page)).not.toHaveAttribute("data-size", before ?? "");
  }
  await expect(phone(page)).toHaveAttribute("data-size", size);
}

/** Closes the day's popup or sheet when the view shows the day in one. */
async function closeDay(page: Page): Promise<void> {
  if ((await daySheet(page).count()) === 0) return;
  await page.keyboard.press("Escape");
  await expect(daySheet(page)).toHaveCount(0);
}

test.describe("a deadline moved earlier, from a task opened on the calendar (6b.12)", () => {
  test.use({ storageState: storageStateFor("owner") });

  type View = {
    name: string;
    phone: boolean;
    address: (date: string) => string;
    size?: "1" | "2" | "3";
    /** Shows `date`'s day as this view does, and returns where its Due list is. */
    show: (page: Page, date: string) => Promise<Locator>;
  };

  const VIEWS: View[] = [
    {
      name: "laptop Month (the day's popup)",
      phone: false,
      address: (date) => `/calendar?date=${date}`,
      show: async (page, date) => {
        await dayBox(page, date).click();
        await expect(daySheet(page)).toHaveAttribute("data-date", date);
        return daySheet(page);
      },
    },
    {
      name: "laptop Week (a day's heading opens its popup)",
      phone: false,
      address: (date) => `/calendar?view=week&date=${date}`,
      show: async (page, date) => {
        await page.locator(`[data-slot="calendar-week-day"][data-date="${date}"]`).click();
        await expect(daySheet(page)).toHaveAttribute("data-date", date);
        return daySheet(page);
      },
    },
    {
      name: "laptop Day (the side column, the pager)",
      phone: false,
      address: (date) => `/calendar?view=day&date=${date}`,
      show: async (page, date) => {
        for (let step = 0; step < 3; step += 1) {
          const shown = await detail(page).getAttribute("data-date");
          if (shown === date) break;
          await page
            .getByRole("button", { name: shown && shown > date ? "Previous day" : "Next day" })
            .click();
          await expect(detail(page)).not.toHaveAttribute("data-date", shown ?? "");
        }
        await expect(detail(page)).toHaveAttribute("data-date", date);
        return detail(page);
      },
    },
    {
      name: "phone compact month (the day's detail)",
      phone: true,
      size: "2",
      address: (date) => `/calendar?date=${date}`,
      show: async (page, date) => {
        await dayBox(page, date).click();
        await expect(detail(page)).toHaveAttribute("data-date", date);
        return detail(page);
      },
    },
    {
      name: "phone week strip (the day's detail)",
      phone: true,
      size: "1",
      address: (date) => `/calendar?date=${date}`,
      show: async (page, date) => {
        await page.locator(`[data-slot="calendar-strip-day"][data-date="${date}"]`).click();
        await expect(detail(page)).toHaveAttribute("data-date", date);
        return detail(page);
      },
    },
    {
      name: "phone full month (the day sheet)",
      phone: true,
      size: "3",
      address: (date) => `/calendar?date=${date}`,
      show: async (page, date) => {
        await dayBox(page, date).click();
        await expect(daySheet(page)).toHaveAttribute("data-date", date);
        return daySheet(page);
      },
    },
  ];

  for (const view of VIEWS) {
    test(`${view.name}: back returns to the view, the task on its new day, after a reload too`, async ({
      page,
    }, info) => {
      test.skip(isPhone(info) !== view.phone, view.phone ? "a phone's view" : "a laptop's view");
      if (view.phone) await runInstalled(page);
      const { earlier, later } = movedDays();
      const id = await ownerCreatesDueOn(`${prefixOf(info)}moved ${view.size ?? view.name}`, later);
      const address = view.address(later);
      const here = new RegExp(`${address.replace(/[?]/g, "\\?")}$`);

      await page.goto(address);
      await hydrated(page);
      if (view.size) await phoneSize(page, view.size);
      await dueOf(await view.show(page, later), id).click();
      await expect(page).toHaveURL(new RegExp(`/tasks/${id}$`));
      await hydrated(page);
      await moveDeadline(page, earlier);

      // One tap: the calendar's own address (its view and day), nothing left beneath it.
      await backControl(page).click();
      await expect(page).toHaveURL(here);
      if (view.size) await phoneSize(page, view.size);
      await expect(dueOf(await view.show(page, later), id)).toHaveCount(0);
      await closeDay(page);
      await expect(dueOf(await view.show(page, earlier), id)).toBeVisible();
      await closeDay(page);

      await page.reload();
      await hydrated(page);
      if (view.size) await phoneSize(page, view.size);
      await expect(dueOf(await view.show(page, earlier), id)).toBeVisible();
      await closeDay(page);
      await expect(dueOf(await view.show(page, later), id)).toHaveCount(0);
      await removeTasksTitled(`${prefixOf(info)}moved ${view.size ?? view.name}`);
    });
  }
});

/**
 * 6b.12 (1), another person's change: the Crew member's calendar shows their task on its old
 * day; the Owner moves the deadline elsewhere; back on the calendar (the router's cached copy of
 * that address, which the router asks the server for again on the return) it is on its new day,
 * and after a reload.
 */
test.describe("a deadline moved earlier by someone else (6b.12)", () => {
  test.use({ storageState: storageStateFor("staff") });

  test("the Owner's move shows when the calendar is shown again, and after a reload", async ({
    page,
  }, info) => {
    const phoneRun = isPhone(info);
    if (phoneRun) await runInstalled(page);
    const { earlier, later } = movedDays();
    const title = `${prefixOf(info)}moved elsewhere ${info.repeatEachIndex}`;
    const id = await ownerCreatesDueOn(title, later);
    const show = async (date: string) => {
      if (!phoneRun) {
        await dayBox(page, date).click();
        await expect(daySheet(page)).toHaveAttribute("data-date", date);
        return daySheet(page);
      }
      await dayBox(page, date).click();
      await expect(detail(page)).toHaveAttribute("data-date", date);
      return detail(page);
    };

    await page.goto(`/calendar?date=${later}`);
    await hydrated(page);
    await expect(dueOf(await show(later), id)).toBeVisible();
    await closeDay(page);
    // Elsewhere in the app, by its own push (an installed tab would replace the calendar).
    await page.evaluate(() => {
      (
        window as unknown as { next: { router: { push: (href: string) => void } } }
      ).next.router.push("/my-day");
    });
    await expect(page).toHaveURL(/\/my-day$/);
    await hydrated(page);

    // The Owner moves it: another person's session, through the API (the same transition the edit
    // form calls), at once, so the return lands inside the router's 30 s cache window
    // (`staleTimes.dynamic`), where the cached copy still has the old day.
    await rpcAs(USERS.owner.email, USERS.owner.password, "task_update_assignment", {
      task_id: id,
      changes: { due_at: istInstant(earlier, "18:00") },
      warnings: [],
    });

    // Back to the calendar: the router shows its cached copy of that address at once and asks
    // the server for it again (Next's history restore); the move is there once that answer has
    // been read to the end.
    const reread = page.waitForResponse(
      (response) =>
        response.url().includes(`/calendar?date=${later}`) && response.url().includes("_rsc="),
    );
    await page.goBack();
    await expect(page).toHaveURL(new RegExp(`/calendar\\?date=${later}$`));
    await (await reread).finished();
    await expect(dueOf(await show(earlier), id)).toBeVisible();
    await closeDay(page);
    await expect(dueOf(await show(later), id)).toHaveCount(0);
    await closeDay(page);

    await page.reload();
    await hydrated(page);
    await expect(dueOf(await show(earlier), id)).toBeVisible();
    await removeTasksTitled(title);
  });
});

/**
 * Tasks vs client work (SCOPE §6, the approved calendar sample): a task is a filled chip, a client
 * deliverable an outlined one with the client first, after the tasks; every chip is one line,
 * however long its words (a 60-character title and client name); the Owner's All · Tasks · Client
 * work switch is a view control this device remembers, adding no history; the day popup is in two
 * parts, the full text in each.
 */
test.describe("the calendar's tasks vs client work (SCOPE §6)", () => {
  test.use({ storageState: storageStateFor("owner") });

  /** `words` padded with letters to exactly 60 characters. */
  const sixty = (words: string) => `${words} `.padEnd(60, "x");

  /** A day of its own with a 60-character shoot, a due task and a deliverable of a long-named client. */
  async function longDay(info: TestInfo) {
    const prefix = `${prefixOf(info)}scope6 `;
    await removeTasksTitled(prefix);
    const client = sixty(`Scope6 client ${info.project.name}`);
    await removeClientFixture(client);
    // A day of each project's own that no other spec dates a row on: a box holds three lines, so
    // one more task there puts the deliverable behind "+N more". The offsets are reserved for this
    // test (thirteen to fifteen weeks on). It used 44/51/58 until CI shard 2 (run 39978207656, a
    // Friday): the phone's day 51 fell on a Sunday and moved to day 52's Monday, where
    // task-page's "Chat view … promo" and "Phone same … reel" are due, and the item was gone.
    const offset = { desktop: 91, mobile: 98, "mobile-lg": 105 }[info.project.name] ?? 112;
    const day = workingDay(offset);
    // A collision names itself rather than hiding a chip: nothing else is on that day.
    const dayStart = encodeURIComponent(istInstant(day, "00:00"));
    const dayEnd = encodeURIComponent(istInstant(addISTDays(day, 1), "00:00"));
    const others = [
      ...(await serviceSelect<{ title: string }>(
        `tasks?select=title&or=(and(due_at.gte.${dayStart},due_at.lt.${dayEnd}),event_date.eq.${day})`,
      )),
      ...(await serviceSelect<{ title: string }>(
        `project_items?select=title&planned_date=eq.${day}`,
      )),
    ];
    expect(
      others.map((row) => row.title),
      `${day} is this test's alone`,
    ).toEqual([]);
    const staffId = await memberIdOf(USERS.staff.email);
    const shootTitle = sixty(`${prefix}shoot`);
    const dueTitle = sixty(`${prefix}due`);
    const base = {
      description: null,
      client_id: null,
      priority: "medium",
      due_at: istInstant(day, "18:00"),
      assignee_ids: [staffId],
      primary_owner_id: staffId,
      approving_admin_id: null,
      stages: [],
    };
    await rpcAs<string>(USERS.owner.email, USERS.owner.password, "task_create", {
      ...base,
      title: shootTitle,
      task_type_id: await taskTypeId("Shoot / Site Visit"),
      event_date: day,
      event_start_at: istInstant(day, "10:00"),
      event_end_at: istInstant(day, "11:00"),
      location: null,
    });
    await rpcAs<string>(USERS.owner.email, USERS.owner.password, "task_create", {
      ...base,
      title: dueTitle,
      task_type_id: await taskTypeId("Normal"),
    });
    const [org] = await serviceSelect<{ id: string }>("organizations?select=id&limit=1");
    const row = await serviceInsert<{ id: string }>("clients", {
      org_id: org?.id,
      name: client,
      admin_id: await memberIdOf(USERS.admin.email),
    });
    await rpcAs(USERS.owner.email, USERS.owner.password, "client_activate", { client_id: row.id });
    const item = sixty("Reel");
    const projectId = await rpcAs<string>(
      USERS.admin.email,
      USERS.admin.password,
      "project_create",
      {
        client_id: row.id,
        name: "Scope6 reels",
        recurrence: "one_time",
        stages: [],
        items: [item],
        delivery_date: addISTDays(day, 5),
      },
    );
    const [itemRow] = await serviceSelect<{ id: string }>(
      `project_items?project_id=eq.${projectId}&select=id&limit=1`,
    );
    await rpcAs(USERS.admin.email, USERS.admin.password, "item_update", {
      item_id: itemRow?.id,
      changes: { planned_date: day },
    });
    return { day, shootTitle, dueTitle, client, item };
  }

  /** Each chip of a box: its kind, whether it is one line, whether its words were cut. */
  async function chipLines(box: Locator) {
    return box.locator('[data-slot="calendar-strip"]').evaluateAll((chips) =>
      chips.map((chip) => {
        const style = getComputedStyle(chip);
        const inner =
          chip.getBoundingClientRect().height -
          parseFloat(style.borderTopWidth) -
          parseFloat(style.borderBottomWidth);
        return {
          kind: chip.getAttribute("data-kind"),
          oneLine: Math.abs(inner - parseFloat(style.lineHeight)) < 1,
          cut: chip.scrollWidth > chip.clientWidth,
          wraps: style.whiteSpace !== "nowrap",
          text: chip.textContent ?? "",
        };
      }),
    );
  }

  test("one line at 375, 430 and desktop; tasks then client work; the switch; the popup in two parts", async ({
    page,
  }, info) => {
    const fixture = await longDay(info);
    await page.goto(`/calendar?date=${fixture.day}`);
    await hydrated(page);
    // Every device starts on All (a fresh context's storage).
    const shows = showControl(page);
    await expect(shows).toHaveAttribute("data-current", "all");
    if (isPhone(info)) {
      // The phone's full month draws the chips (the compact month only bars).
      await page.locator('button[data-slot="calendar-handle"]').click();
      await expect(phone(page)).toHaveAttribute("data-size", "3");
    }
    const box = dayBox(page, fixture.day);
    const count = box.locator('[data-slot="calendar-strip"][data-kind="tasks"]');
    if (isPhone(info)) {
      // The phone's full month is v1.7.1's day cells (the v1.8 fix round): the timed task by its
      // title, then what is due as one count, the due task and the deliverable "2 due" in amber;
      // never a chip a task cut to its first letters.
      await expect(count).toHaveText("2 due");
      await expect(count).toHaveAttribute("data-tone", "due");
      const lines = await chipLines(box);
      expect(lines.map((line) => line.kind)).toEqual(["event", "tasks"]);
      for (const line of lines) {
        expect(line, `${line.kind} is one line`).toMatchObject({ oneLine: true, wraps: false });
      }
      expect(lines[0]?.cut, `the event's long title ends in "…"`).toBe(true);
      expect(lines[1]?.cut, "the count reads whole").toBe(false);
      await expect(
        box.locator(
          '[data-slot="calendar-strip"][data-kind="due"], [data-slot="calendar-strip"][data-kind="item"]',
        ),
      ).toHaveCount(0);
    } else {
      await expect(box.locator('[data-slot="calendar-strip"][data-kind="item"]')).toBeVisible();
      const lines = await chipLines(box);
      // The fixed order: the timed task, the due task, then the client work.
      expect(lines.map((line) => line.kind)).toEqual(["event", "due", "item"]);
      for (const line of lines) {
        expect(line, `${line.kind} is one line`).toMatchObject({ oneLine: true, wraps: false });
        expect(line.cut, `${line.kind}'s long words end in "…"`).toBe(true);
      }
      // The client first, outlined (not filled).
      const item = box.locator('[data-slot="calendar-strip"][data-kind="item"]');
      expect(lines[2]?.text.startsWith(fixture.client.trim().slice(0, 20))).toBe(true);
      await expect(item.locator('[data-slot="calendar-item-icon"]')).toHaveCount(1);
      expect(await item.evaluate((chip) => getComputedStyle(chip).backgroundColor)).toBe(
        "rgba(0, 0, 0, 0)",
      );
      await expect(count).toHaveCount(0);
    }
    await expectNoHorizontalScroll(page);

    // The switch is a view control: no history, remembered on this device; leave and holidays
    // always show (none on this day: the strips alone are checked).
    // The menu is a layer (its open adds an entry that its close spends), so the proof is the
    // address, and one back leaving the calendar (the toolbar's and the header's own tests).
    const address = page.url();
    await chooseShow(page, "tasks");
    await expect(box.locator('[data-slot="calendar-strip"][data-kind="item"]')).toHaveCount(0);
    await expect(box.locator('[data-slot="calendar-strip"][data-kind="event"]')).toHaveCount(1);
    // The phone counts the due task alone.
    if (isPhone(info)) await expect(count).toHaveText("1 due");
    await chooseShow(page, "client");
    await expect(box.locator('[data-slot="calendar-strip"][data-kind="item"]')).toHaveCount(
      isPhone(info) ? 0 : 1,
    );
    await expect(box.locator('[data-slot="calendar-strip"][data-kind="event"]')).toHaveCount(0);
    await expect(box.locator('[data-slot="calendar-strip"][data-kind="due"]')).toHaveCount(0);
    // The phone counts the deliverable alone.
    if (isPhone(info)) await expect(count).toHaveText("1 due");
    expect(page.url()).toBe(address);
    await page.reload();
    await hydrated(page);
    await expect(showControl(page)).toHaveAttribute("data-current", "client");
    await chooseShow(page, "all");
    if (isPhone(info)) {
      await page.locator('button[data-slot="calendar-handle"]').click();
      await expect(phone(page)).toHaveAttribute("data-size", "3");
    }

    // The popup: "Tasks · 2", then "Client work · 1" by client, the full text, wrapped.
    await dayBox(page, fixture.day).click();
    const popup = daySheet(page);
    await expect(popup.locator('[data-slot="calendar-tasks-title"]')).toContainText("Tasks · 2");
    const work = popup.locator('[data-slot="calendar-items-list"]');
    await expect(work.locator("h3")).toContainText("Client work · 1");
    const row = work.locator('[data-slot="calendar-item"]');
    await expect(row).toContainText(fixture.client);
    await expect(row).toContainText(fixture.item);
    expect(await row.evaluate((link) => link.scrollWidth <= link.clientWidth)).toBe(true);
    await expect(popup).toContainText(fixture.dueTitle);
    // Tasks come before the client work, who is away after both.
    const order = await popup
      .locator(
        '[data-slot="calendar-tasks-title"], [data-slot="calendar-items-list"], [data-slot="calendar-who-free"]',
      )
      .evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-slot")));
    expect(order).toEqual(["calendar-tasks-title", "calendar-items-list", "calendar-who-free"]);
    await page.keyboard.press("Escape");
    await expect(popup).toHaveCount(0);

    if (!isPhone(info)) {
      // The laptop's Week: every block's lines are one line, never wrapped.
      await page.goto(`/calendar?view=week&date=${fixture.day}`);
      await hydrated(page);
      const block = page.locator(
        `[data-slot="calendar-laptop"] [data-slot="calendar-event"]:has-text("${fixture.shootTitle.slice(0, 24)}")`,
      );
      await expect(block).toBeVisible();
      const wrapped = await block
        .locator("span")
        .evaluateAll(
          (spans) =>
            spans
              .filter((span) => getComputedStyle(span).display === "block")
              .filter((span) => getComputedStyle(span).whiteSpace !== "nowrap").length,
        );
      expect(wrapped).toBe(0);
    }
    await removeClientFixture(fixture.client);
  });

  test("phone, the live v1.7.1 structure (the owner's correction, 23 Oct): the full month is seven columns in the screen; a day opens a sheet with its timeline", async ({
    page,
  }, info) => {
    test.skip(!isPhone(info), "the phone");
    const fixture = await longDay(info);
    await page.goto(`/calendar?date=${fixture.day}`);
    await hydrated(page);
    await page.locator('button[data-slot="calendar-handle"]').click();
    await expect(phone(page)).toHaveAttribute("data-size", "3");
    // Seven boxes a row, Monday to Sunday, on one line: never the two-column day cards.
    const box = dayBox(page, fixture.day);
    const row = box.locator("xpath=ancestor::ol[1]");
    const tops = await row
      .locator('[data-slot="calendar-day"]')
      .evaluateAll((boxes) => boxes.map((day) => Math.round(day.getBoundingClientRect().top)));
    expect(tops).toHaveLength(7);
    expect(new Set(tops).size, "one row of seven").toBe(1);
    const width = (await box.boundingBox())?.width ?? 0;
    expect(width, "a seventh of the screen").toBeLessThan((page.viewportSize()?.width ?? 375) / 6);
    await expectNoHorizontalScroll(page);
    // The day sheet: the day's detail with its hour timeline, the day's action inside it; no
    // list-and-footer popup, and "Open day" is the laptop's alone.
    await box.click();
    const sheet = daySheet(page);
    await expect(sheet).toBeVisible();
    await expect(sheet.locator('[data-slot="calendar-hours"]')).toHaveCount(1);
    await expect(sheet.locator('[data-slot="calendar-day-footer"]')).toHaveCount(0);
    await expect(sheet.locator('[data-slot="calendar-open-day"]')).toBeHidden();
    await expect(sheet.locator('[data-slot="new-task-on-day"]')).toContainText(
      `New task on ${shortDay(fixture.day)}`,
    );
    await page.keyboard.press("Escape");
    await expect(sheet).toHaveCount(0);
    await removeClientFixture(fixture.client);
  });

  test("installed: All ▾ closes on back, the split day sheet closes on back, a choice adds no history, a deliverable is a drill-down", async ({
    page,
  }, info) => {
    test.skip(!isPhone(info), "the installed app is a phone");
    const fixture = await longDay(info);
    await runInstalled(page);
    await page.goto(`/calendar?date=${fixture.day}`);
    await hydrated(page);
    // The All ▾ menu is a layer: back closes it and stays on the calendar (§14.2 a); a choice
    // adds no history.
    await showControl(page).click();
    const menu = page.getByRole("menu");
    await expect(menu).toBeVisible();
    await expectBackStack(page, [{ closes: menu, url: /\/calendar\?date=/ }]);
    await chooseShow(page, "client");
    await chooseShow(page, "all");
    await page.locator('button[data-slot="calendar-handle"]').click();
    await expect(phone(page)).toHaveAttribute("data-size", "3");
    await dayBox(page, fixture.day).click();
    const sheet = daySheet(page);
    await expect(sheet.locator('[data-slot="calendar-items-list"]')).toBeVisible();
    await expect(sheet.locator('[data-slot="calendar-tasks-title"]')).toBeVisible();
    await expectNoHorizontalScroll(page);
    // The sheet is a layer: back closes it and stays on the calendar.
    await expectBackStack(page, [{ closes: sheet, url: /\/calendar\?date=/ }]);
    // A deliverable opens its record, the sheet backed out first: back returns to the calendar.
    await dayBox(page, fixture.day).click();
    await sheet.locator('[data-slot="calendar-item"]').first().click();
    await expect(page).toHaveURL(/\/clients\/[^/]+\/projects\//);
    await expectBackStack(page, [{ url: /\/calendar\?date=/ }]);
    await removeClientFixture(fixture.client);
  });
});

/**
 * Today on the calendar (the design gate, 23 Oct): the red circle on its date and a neutral tint
 * on its box, never also the selection's outline (the phone opens with today selected), in the
 * phone's compact and full months and the laptop's month.
 */
test.describe("today's mark", () => {
  test.use({ storageState: storageStateFor("owner") });

  async function look(box: Locator) {
    return box.evaluate((element) => {
      const style = getComputedStyle(element);
      const date = element.querySelector('[data-slot="calendar-date"]') as HTMLElement;
      return {
        border: style.borderTopColor,
        background: style.backgroundColor,
        circle: getComputedStyle(date).backgroundColor,
      };
    });
  }

  test("a red circle and a neutral tint, no outline, in every month", async ({ page }, info) => {
    const today = todayIST();
    const other = addISTDays(today, today.endsWith("-01") ? 1 : -1);
    await page.goto("/calendar");
    await hydrated(page);
    const sizes = isPhone(info) ? (["2", "3"] as const) : (["laptop"] as const);
    for (const size of sizes) {
      if (size !== "laptop") await phoneSize(page, size);
      const mine = await look(dayBox(page, today));
      const theirs = await look(dayBox(page, other));
      expect(mine.border, `${size}: today has no outline of its own`).toBe(theirs.border);
      expect(mine.background, `${size}: today's box is tinted`).not.toBe(theirs.background);
      expect(mine.circle, `${size}: the red circle`).not.toBe("rgba(0, 0, 0, 0)");
    }
  });
});

/**
 * The laptop's calendar toolbar (v1.8, owner 23 Oct): All · Tasks · Client work is one `All ▾`
 * menu beside Filters, the toolbar one row at every laptop width (Day/Week/Month · ‹ month › ·
 * Today · All ▾ · Filters), and a leave bar never truncates: "Name · On leave" where it fits, else
 * "Name · Leave", never "Name · On l…", else the photo and "Leave"; the phone's full-month bars the
 * same (owner, #89 comment 6370526089).
 */
test.describe("the laptop calendar toolbar and leave bars (v1.8, owner 23 Oct)", () => {
  test.use({ storageState: storageStateFor("owner") });

  const WIDTHS = [1024, 1280] as const;
  const PHONE_WIDTHS = [375, 430] as const;
  /** A long first name: the bar shows the first name only. */
  const FIRST = "Jayalakshmi";
  const surname = (info: TestInfo) => `Calv18 ${info.project.name}`;

  /** A freelancer with a long first name, on approved leave on a day of their own. */
  async function longNameOnLeave(info: TestInfo): Promise<{ day: string; id: string }> {
    const prefix = `${FIRST} ${surname(info)}`;
    const earlier = await serviceSelect<{ id: string }>(
      `members?full_name=like.${encodeURIComponent(`${prefix}*`)}&select=id`,
    );
    for (const { id } of earlier) await resetAttendanceAndLeave(id);
    await removeFreelancersNamed(prefix);
    const id = await rpcAs<string>(
      USERS.owner.email,
      USERS.owner.password,
      "member_add_freelancer",
      {
        full_name: prefix,
        coordinator_id: await memberIdOf(USERS.admin.email),
      },
    );
    // A day of each project's own, apart from the other describes' fixture days.
    const day = workingDay(72 + 7 * ["desktop", "mobile", "mobile-lg"].indexOf(info.project.name));
    const [owner] = await serviceSelect<{ id: string }>("members?role=eq.owner&select=id");
    await serviceInsert("leave_requests", {
      member_id: id,
      type: "leave",
      start_date: day,
      end_date: day,
      state: "approved",
      source: "owner",
      decided_by: owner?.id,
      decided_at: `${todayIST()}T00:00:00+05:30`,
    });
    return { day, id };
  }

  async function removeLongName(info: TestInfo, id: string) {
    await resetAttendanceAndLeave(id);
    await removeFreelancersNamed(`${FIRST} ${surname(info)}`);
  }

  /** The toolbar's parts on one row, inside its width (nothing wrapped, nothing pushed out). */
  async function expectOneRow(page: Page, label: string) {
    const bar = await page
      .locator('[data-slot="calendar-controls"]:visible')
      .evaluate((element) => {
        const box = element.getBoundingClientRect();
        return {
          overflows: element.scrollWidth > element.clientWidth,
          right: box.right,
          parts: [...element.children].map((child) => {
            const part = child.getBoundingClientRect();
            return { middle: part.top + part.height / 2, right: part.right };
          }),
        };
      });
    expect(bar.overflows, `${label}: the toolbar's parts fit its width`).toBe(false);
    const middle = bar.parts[0]?.middle ?? 0;
    for (const part of bar.parts) {
      expect(Math.abs(part.middle - middle), `${label}: one row`).toBeLessThan(2);
      expect(part.right, `${label}: inside the toolbar`).toBeLessThanOrEqual(bar.right + 0.5);
    }
  }

  /**
   * A leave label as drawn: its visible words, whether it is cut (an overflow or an ellipsis),
   * whether the long and the short wordings would have fitted where it is, and whether the
   * person's photo is showing (the last wording, `[photo] Leave`, owner 23 Oct).
   */
  async function leaveLabel(label: Locator) {
    return label.evaluate((element) => {
      const shown = element.getAttribute("data-leave-fit");
      const fits = (fit: string) => {
        element.setAttribute("data-leave-fit", fit);
        return element.scrollWidth <= element.clientWidth;
      };
      const longFits = fits("long");
      const shortFits = fits("short");
      // "[photo] Leave"; a label without it (several people) has no photo wording.
      const photoFits =
        element.querySelector('[data-leave-word="photo"]') !== null && fits("photo");
      if (shown !== null) element.setAttribute("data-leave-fit", shown);
      // The face shown: "[photo] Leave"'s, or the phone's photo alone (`face`).
      const photo =
        [
          ...element.querySelectorAll<HTMLElement>(
            '[data-leave-word="photo"] [data-slot="person-avatar"], [data-leave-word="face"] [data-slot="person-avatar"]',
          ),
        ].find((face) => face.checkVisibility()) ?? null;
      const photoBox = photo?.getBoundingClientRect();
      const labelBox = element.getBoundingClientRect();
      // The words, without the photo's initials (a decorative face beside "Leave").
      const display = photo?.style.display ?? "";
      if (photo) photo.style.display = "none";
      const text = (element as HTMLElement).innerText.trim();
      if (photo) photo.style.display = display;
      return {
        text,
        cut: element.scrollWidth > element.clientWidth,
        ellipsis: getComputedStyle(element).textOverflow === "ellipsis",
        longFits,
        shortFits,
        photoFits,
        photoShown: Boolean(photo && photo.checkVisibility() && (photoBox?.width ?? 0) > 0),
        photoInside: Boolean(
          photoBox &&
          photoBox.top >= labelBox.top - 0.5 &&
          photoBox.bottom <= labelBox.bottom + 0.5 &&
          photoBox.right <= labelBox.right + 0.5,
        ),
      };
    });
  }

  /**
   * The words a leave label should show: the first wording that fits; "" for the phone's last,
   * the photo alone, where even "[photo] Leave" has no room.
   */
  const fitted = (label: { longFits: boolean; shortFits: boolean; photoFits: boolean }) =>
    label.longFits
      ? `${FIRST} · On leave`
      : label.shortFits
        ? `${FIRST} · Leave`
        : label.photoFits
          ? "Leave"
          : "";

  test("All ▾ beside Filters: one row at 1024 and 1280 in every view; the menu ticks the choice; a view control, remembered", async ({
    page,
  }, info) => {
    test.skip(isPhone(info), "the laptop's toolbar (the phone keeps its switch)");
    const day = workingDay(2);
    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: 800 });
      for (const view of ["month", "week", "day"] as const) {
        await page.goto(`/calendar?view=${view}&date=${day}`);
        await hydrated(page);
        const trigger = page.locator('[data-slot="calendar-show-menu"]:visible');
        await expect.poll(() => shownLabel(trigger)).toBe("All");
        await expect(page.locator('[data-slot="calendar-show"]:visible')).toHaveCount(0);
        // Beside Filters, just before it.
        // Read together in the page: the button is swapped for the loaded menu's after the page.
        const gap = await page.evaluate(() => {
          const visible = (selector: string) =>
            [...document.querySelectorAll<HTMLElement>(selector)].find(
              (element) => element.getClientRects().length > 0,
            );
          const menu = visible('[data-slot="calendar-show-menu"]')?.getBoundingClientRect();
          const filters = visible('[data-slot="calendar-filters-button"]')?.getBoundingClientRect();
          return menu && filters ? filters.left - menu.right : null;
        });
        expect(gap, "just before Filters").not.toBeNull();
        expect(gap ?? -1).toBeGreaterThan(0);
        expect(gap ?? 99).toBeLessThan(12);
        await expectOneRow(page, `${view} at ${width}`);
      }
    }

    // The menu at the narrowest laptop: All · Tasks · Client work, the tick on the choice.
    await page.setViewportSize({ width: 1024, height: 800 });
    await page.goto("/today");
    await hydrated(page);
    await page.goto(`/calendar?date=${day}`);
    await hydrated(page);
    const address = page.url();
    const trigger = page.locator('[data-slot="calendar-show-menu"]:visible');
    await trigger.click();
    const menu = page.getByRole("menu");
    const items = menu.getByRole("menuitemradio");
    await expect(items).toHaveText(["All", "Tasks", "Client work"]);
    await expect(items.nth(0)).toHaveAttribute("aria-checked", "true");
    await expect(items.nth(0).locator("svg")).toBeVisible();
    await expect(items.nth(2).locator("svg")).toHaveCount(0);
    // The open menu is a layer: back closes it and stays on the calendar (§14.2 a).
    await expectBackStack(page, [{ closes: menu, url: /\/calendar\?date=/ }]);
    await trigger.click();
    await items.nth(2).click();
    await expect(menu).toHaveCount(0);
    await expect.poll(() => shownLabel(trigger)).toBe("Client work");
    await expect(trigger).toHaveAttribute("data-current", "client");
    // A subtle neutral selected state, never red: the Filters button's own active look.
    const look = await trigger.evaluate((element) => {
      const style = getComputedStyle(element);
      return { background: style.backgroundColor, border: style.borderTopColor, ink: style.color };
    });
    expect(look.background, "a neutral fill").not.toBe("rgba(0, 0, 0, 0)");
    for (const colour of Object.values(look)) {
      const [r = 0, g = 0, b = 0] = (colour.match(/[\d.]+/g) ?? []).map(Number);
      expect(Math.max(r, g, b) - Math.min(r, g, b), `${colour} is neutral`).toBeLessThan(24);
    }
    await expectOneRow(page, "Client work ▾ at 1024");
    // A view control: the address is the same, and one back still leaves the calendar.
    expect(page.url()).toBe(address);
    await trigger.click();
    await expect(items.nth(2)).toHaveAttribute("aria-checked", "true");
    await page.keyboard.press("Escape");
    await expect(menu).toHaveCount(0);
    // The views are view state too: one back still leaves the calendar.
    for (const view of ["week", "day"] as const) {
      await page
        .locator(`[data-slot="calendar-view"] a:has-text("${view === "week" ? "Week" : "Day"}")`)
        .click();
      await expect(page.locator('[data-slot="calendar-laptop"]')).toHaveAttribute(
        "data-view",
        view,
      );
      await expectOneRow(page, `Client work ▾, ${view} at 1024`);
    }
    await expectBackStack(page, [{ url: /\/today$/ }]);
    // Remembered on this device, as the switch was.
    await page.goto(`/calendar?date=${day}`);
    await hydrated(page);
    await expect.poll(() => shownLabel(trigger)).toBe("Client work");
    await chooseShow(page, "all");
    await expect.poll(() => shownLabel(trigger)).toBe("All");
  });

  test("a leave bar never truncates: a long name at 1024 and 1280 (the month and the week) and on a phone's full month at 375 and 430; with room it says On leave; with none, the photo and Leave", async ({
    page,
  }, info) => {
    const { day, id } = await longNameOnLeave(info);
    // The phone's full-month bars fit the same way (owner, #89 comment 6370526089).
    const phoneRun = isPhone(info);
    for (const width of phoneRun ? PHONE_WIDTHS : WIDTHS) {
      await page.setViewportSize({ width, height: phoneRun ? 900 : 800 });
      await page.goto(`/calendar?date=${day}`);
      await hydrated(page);
      if (phoneRun) {
        await page.locator('button[data-slot="calendar-handle"]').click();
        await expect(phone(page)).toHaveAttribute("data-size", "3");
      }
      const box = dayBox(page, day);
      const bar = box.locator('[data-slot="calendar-leave-bar"]');
      await expect(bar).toBeVisible();
      const barHeight = (await bar.boundingBox())?.height;
      const month = await leaveLabel(bar);
      expect(month.text, `month at ${width}`).toMatch(
        new RegExp(`^(${FIRST} · (On leave|Leave)|Leave${phoneRun ? "|" : ""})$`),
      );
      expect(month.cut, `month at ${width}: nothing cut`).toBe(false);
      expect(month.ellipsis, `month at ${width}: no ellipsis`).toBe(false);
      expect(month.text, `month at ${width}: the long wording wherever it fits`).toBe(
        fitted(month),
      );
      // The photo is the last wordings only: shown exactly when neither name wording fits.
      expect(month.photoShown, `month at ${width}: the photo only where no name fits`).toBe(
        month.text === "Leave" || month.text === "",
      );
      // The box's name says the first name in full, whichever wording the bar shows.
      await expect(box).toHaveAccessibleName(new RegExp(`, ${FIRST}, on leave(,|$)`));
      if (width === 1024 || phoneRun) {
        // Owner 23 Oct: "Jayalakshmi · Leave" has no room in a 1024 box, nor in a seventh of a
        // phone: [photo] Leave; on the phone, where even that has no room, the photo alone.
        expect(month.shortFits, `${width}: the short wording has no room`).toBe(false);
        expect(month.text, `${width}: Leave beside the photo`).toBe(
          phoneRun && !month.photoFits ? "" : "Leave",
        );
        expect(month.photoShown, `${width}: the photo`).toBe(true);
        expect(month.photoInside, `${width}: the photo inside the bar's line`).toBe(true);
        const rung = phoneRun && !month.photoFits ? "face" : "photo";
        await expect(bar).toHaveAttribute("data-leave-fit", rung);
        // The bar keeps its height with the photo: nothing moves.
        await bar.evaluate((element) => element.setAttribute("data-leave-fit", "long"));
        expect((await bar.boundingBox())?.height, `${width}: the bar's height, any wording`).toBe(
          barHeight,
        );
        await bar.evaluate((element, last) => element.setAttribute("data-leave-fit", last), rung);
      }
      await box.screenshot({ path: info.outputPath(`leave-bar-month-${width}.png`) });
      if (phoneRun) {
        await expectNoHorizontalScroll(page);
        continue;
      }

      await page.goto(`/calendar?view=week&date=${day}`);
      await hydrated(page);
      const chip = page
        .locator('[data-slot="calendar-laptop"] [data-slot="calendar-leave"]')
        .filter({ hasText: FIRST })
        .locator("[data-leave-fit]");
      await expect(chip).toBeVisible();
      const week = await leaveLabel(chip);
      expect(week.text, `week at ${width}`).toMatch(
        new RegExp(`^(${FIRST} · (On leave|Leave)|Leave)$`),
      );
      expect(week.cut, `week at ${width}: nothing cut`).toBe(false);
      expect(week.ellipsis, `week at ${width}: no ellipsis`).toBe(false);
      expect(week.text).toBe(fitted(week));
      expect(week.photoShown, `week at ${width}: the photo only where no name fits`).toBe(
        week.text === "Leave",
      );

      // The Day view's all-day line has the room: "On leave", in full.
      await page.goto(`/calendar?view=day&date=${day}`);
      await hydrated(page);
      const roomy = page
        .locator('[data-slot="calendar-laptop"] [data-slot="calendar-hours"]')
        .locator('xpath=ancestor::*[@data-slot="calendar-day-view"]')
        .locator('[data-slot="calendar-leave"] [data-leave-fit]')
        .filter({ hasText: FIRST })
        .first();
      // The words shown (the other wordings sit hidden beside them).
      await expect(roomy).toHaveText(`${FIRST} · On leave`, { useInnerText: true });
    }
    await removeLongName(info, id);
  });

  test("phone, option A (owner 23 Oct): one header row at 320, 360, 375 and 430 with Client work ▾ and a two-digit Today; 44 px targets; the leave bar fitted", async ({
    page,
  }, info) => {
    test.skip(!isPhone(info), "the phone");
    const { day, id } = await longNameOnLeave(info);
    await page.goto(`/calendar?date=${day}`);
    await hydrated(page);
    const header = phone(page).locator('[data-slot="calendar-header"]');
    const trigger = header.locator('[data-slot="calendar-show-menu"]');
    await expect.poll(() => shownLabel(trigger)).toBe("All");
    // No switch row of its own, no laptop toolbar.
    await expect(page.locator('[data-slot="calendar-show"]')).toHaveCount(0);
    await expect(page.locator('[data-slot="calendar-controls"]:visible')).toHaveCount(0);
    // Filters is an icon: its name says it; a dot while a filter is on.
    const filters = header.locator('[data-slot="calendar-filters-button"]');
    await expect(filters).toHaveAccessibleName("Filters");
    await expect(filters.locator('[data-slot="calendar-filters-dot"]')).toHaveCount(0);
    // The longest label.
    await chooseShow(page, "client");
    await expect(trigger).toHaveAttribute("data-current", "client");
    for (const width of [320, 360, 375, 430]) {
      await page.setViewportSize({ width, height: 800 });
      // A two-digit Today in the icon, whatever today is.
      await header.locator('[data-slot="calendar-today"] > span').evaluate((icon) => {
        const number = [...icon.childNodes].find((node) => node.nodeType === Node.TEXT_NODE);
        if (number) number.textContent = "28";
      });
      await expect
        .poll(() => header.evaluate((row) => row.scrollWidth <= row.clientWidth), {
          message: `${width}: nothing overflows the header`,
        })
        .toBe(true);
      const parts = await header.evaluate((row) => {
        const box = row.getBoundingClientRect();
        return {
          right: box.right,
          left: box.left,
          items: [...row.children].map((child) => {
            const part = child.getBoundingClientRect();
            return {
              slot: (child as HTMLElement).dataset.slot ?? child.tagName,
              button: child.tagName === "BUTTON",
              middle: part.top + part.height / 2,
              left: part.left,
              right: part.right,
              width: part.width,
              height: part.height,
            };
          }),
        };
      });
      const middle = parts.items[0]?.middle ?? 0;
      for (const item of parts.items) {
        expect(
          Math.abs(item.middle - middle),
          `${width}: ${item.slot} on the one row`,
        ).toBeLessThan(2);
        expect(item.left, `${width}: ${item.slot} not clipped`).toBeGreaterThanOrEqual(
          parts.left - 0.5,
        );
        expect(item.right, `${width}: ${item.slot} not clipped`).toBeLessThanOrEqual(
          parts.right + 0.5,
        );
        if (item.button) {
          expect(item.width, `${width}: ${item.slot} 44 px wide`).toBeGreaterThanOrEqual(44);
          expect(item.height, `${width}: ${item.slot} 44 px tall`).toBeGreaterThanOrEqual(44);
        }
      }
      // "Client work ▾", or "Client ▾" where that has no room: never an ellipsis.
      const label = await trigger.evaluate((button) => ({
        text: (button as HTMLElement).innerText.trim(),
        cut: button.scrollWidth > button.clientWidth,
      }));
      expect(label.text, `${width}: the choice named`).toMatch(/^Client( work)?$/);
      // The month stays named: "Oct 2026", or "Oct" at the narrowest (its name says it in full).
      await expect(header.locator('[data-slot="calendar-month-label"]')).toHaveAccessibleName(
        /^[A-Z][a-z]+ \d{4}$/,
      );
      expect(label.cut, `${width}: the label is whole`).toBe(false);
      // From 375 px the year stays in sight too ("Oct 2026"): only the narrower phones drop it.
      if (width >= 375) {
        const shown = await header
          .locator('[data-slot="calendar-month-label"]')
          .evaluate((heading) => (heading as HTMLElement).innerText.trim());
        expect(shown, `${width}: the month and its year`).toMatch(/^[A-Z][a-z]{2} \d{4}$/);
      }
      await expectNoHorizontalScroll(page);
    }
    await page.setViewportSize({ width: 430, height: 932 });
    await expect.poll(() => shownLabel(trigger)).toBe("Client work");
    await chooseShow(page, "all");
    // A filter on: the dot, and the name says how many.
    await page.goto(`/calendar?date=${day}&status=done`);
    await hydrated(page);
    await expect(filters).toHaveAccessibleName("Filters · 1 on");
    await expect(filters.locator('[data-slot="calendar-filters-dot"]')).toBeVisible();
    // The phone's full-month leave bar picks its wording as the laptop's does (owner, #89 comment
    // 6370526089; "a leave bar never truncates" checks each wording).
    await page.goto(`/calendar?date=${day}`);
    await hydrated(page);
    await page.locator('button[data-slot="calendar-handle"]').click();
    await expect(phone(page)).toHaveAttribute("data-size", "3");
    await expect(
      dayBox(page, day).locator('[data-slot="calendar-leave-bar"][data-leave-fit]'),
    ).toHaveCount(1);
    await removeLongName(info, id);
  });
});

/** Crew never see All · Tasks · Client work (no client work on their calendar), on any device. */
test.describe("the calendar's All ▾, as Crew", () => {
  test.use({ storageState: storageStateFor("staff") });

  test("no All ▾ and no switch for Crew; the toolbar is one row at 1024 and 1280", async ({
    page,
  }, info) => {
    if (!isPhone(info)) {
      for (const width of WIDTHS_CREW) {
        await page.setViewportSize({ width, height: 800 });
        await page.goto("/calendar");
        await hydrated(page);
        await expect(page.locator('[data-slot="calendar-filters-button"]:visible')).toBeVisible();
        // The parts are centred and of different heights (the view switch is taller), so one
        // row is the same middle for every part, as the Owner's check reads it.
        const bar = await page
          .locator('[data-slot="calendar-controls"]:visible')
          .evaluate((element) => ({
            overflows: element.scrollWidth > element.clientWidth,
            middles: [...element.children].map((child) => {
              const part = child.getBoundingClientRect();
              return part.top + part.height / 2;
            }),
          }));
        expect(bar.overflows, `nothing pushed out at ${width}`).toBe(false);
        const middle = bar.middles[0] ?? 0;
        for (const part of bar.middles) {
          expect(Math.abs(part - middle), `one row at ${width}`).toBeLessThan(2);
        }
      }
    } else {
      await page.goto("/calendar");
      await hydrated(page);
      await expect(page.locator('[data-slot="calendar-filters-button"]:visible')).toBeVisible();
    }
    await expect(page.locator('[data-slot="calendar-show-menu"]')).toHaveCount(0);
    await expect(page.locator('[data-slot="calendar-show"]')).toHaveCount(0);
  });
});

const WIDTHS_CREW = [1024, 1280] as const;
