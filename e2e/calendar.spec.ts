import type { Locator, Page, TestInfo } from "@playwright/test";

import { expect, test } from "./fixtures";
import {
  calendarReady,
  animationsSettled,
  expectBackStack,
  expectNoHorizontalScroll,
  hydrated as hydratedShell,
  memberIdOf,
  pageHeader,
  removeClientFixture,
  removeFreelancersNamed,
  removeTasksTitled,
  resetAttendanceAndLeave,
  rpcAs,
  runInstalled,
  serviceDelete,
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
 * the day's action); a day of the full month opens the day sheet, which back closes.
 * **Laptop** (1280): Day · Week · Month, opening on Month; a day opens in a dialog with "Open day".
 * Crew see their own (no Busy, no Crew lists, "Suggest a task" with the day); an Admin sees the
 * tasks they can see; the Owner everything and "+ New task on <day>", the form opening with the
 * day as the deadline.
 *
 * **v6.0 "Admin calendar"** (the Owner and Admins; Crew unchanged): a day says who is **Busy**
 * ("Local Staff · Shoot / Site Visit · 10:00 am – 11:00 am · booked by Owner": the person, the
 * type, the time and who booked it, never a title, a client or a place), who is **On leave** and
 * who is **Free**; "Everyone is available" only when nobody is busy or on leave. No hour timeline:
 * the laptop's Day is the day beside a Crew card, its Week a table with one row a day, the phone's
 * day rows with "+ New task on ‹day›" pinned in a bar above the bottom bar. The size, the day and the filters are view
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

/**
 * Hydrated, and on the calendar its own JavaScript live too (`calendarReady`): the calendar's
 * chunk lands after the shell's, so a tap on a day box or the handle right after the shell had
 * hydrated could hit the server's markup and be lost (full CI 42155785736: :2692 [mobile-lg];
 * then :1474 on desktop and mobile, a day box's tap opening no sheet). Every test here waits on it.
 */
async function hydrated(page: Page): Promise<void> {
  await hydratedShell(page);
  if (new URL(page.url()).pathname === "/calendar") await calendarReady(page);
}

/** A tap on the phone's handle once the calendar's own JavaScript is live (`calendarReady`). */
async function tapHandle(page: Page): Promise<void> {
  await calendarReady(page);
  await page.locator('button[data-slot="calendar-handle"]').click();
}
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

/** "Fri 30 Oct", as a day's action names it (the approved v1.9 sample, W5). */
const shortDay = (date: string) => formatIST(istDayStart(date), "EEE d MMM");

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
 * The Crew on a day for the Owner and Admins (v6.0): "Busy · n", "On leave" and "Free"; or
 * "Everyone is available" alone, which shows only when nobody is busy or on leave. Never the
 * one-line "Who's free" of before.
 */
async function expectCrew(scope: Locator): Promise<void> {
  const everyone = scope.locator('[data-slot="calendar-everyone-available"]');
  const lists = scope.locator('[data-slot="calendar-away-free"]');
  await expect(everyone.or(lists).first()).toBeVisible();
  await expect(scope.locator('[data-slot="calendar-who-free"]')).toHaveCount(0);
  if ((await everyone.count()) > 0) {
    await expect(everyone).toHaveText("Everyone is available");
    await expect(scope.locator('[data-slot="calendar-booking"]')).toHaveCount(0);
    await expect(lists).toHaveCount(0);
    return;
  }
  await expect(scope.locator('[data-slot="calendar-bookings-title"]')).toHaveText(
    /^(Crew busy|Busy) · \d+$/,
  );
  await expect(lists.locator('[data-slot="calendar-on-leave"]')).toHaveText(/^On leave/);
  await expect(lists.locator('[data-slot="calendar-free"]')).toHaveText(/^Free/);
}

const SHOOT_TYPE = "Shoot / Site Visit";

/** The Crew on screen: the phone's day, or the laptop Day's card. */
const crewOnScreen = (page: Page, info: TestInfo) =>
  isPhone(info) ? detail(page) : page.locator('[data-slot="calendar-people-card"]');

/** A person's bookings in a Crew list (the popup's table, the card or the phone's day). */
const bookingsOf = (scope: Locator, memberId: string) =>
  scope.locator(`[data-slot="calendar-booking"][data-member="${memberId}"]`);

/** A two-line booking's exact words: the name and the time, then the type and who booked it. */
const bookingWords = (name: string, when: string, type: string, by: string) =>
  new RegExp(`^${[name, when, `${type} · booked by ${by}`].map(escapeRegExp).join("\\s*")}$`);

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
}

/** "Sat 14": a day as the Day's pills, the Week's rows and the Crew card name it. */
const dayName = (date: string) => formatIST(istDayStart(date), "EEE d");

/** "+ New task on ‹day›" where the Owner and Admins have it: the phone's bar, the Day's card. */
const dayButton = (page: Page, info: TestInfo) =>
  isPhone(info)
    ? page.locator('[data-slot="sticky-actions"] [data-slot="new-task-on-day"]')
    : page.locator('[data-slot="calendar-people-card"] [data-slot="new-task-on-day"]');

const RESET_ID = USERS.reset.id;

/**
 * A week of its own for the Crew lists, far from every other spec's days (half a year on, a week
 * a project), built afresh each time:
 * - **Mon**: the Admin's shoot for two people, 2:00 pm – 4:00 pm ("booked by you" to the Admin,
 *   "booked by Local Admin" to the Owner): the staging v2.0 bug said "Everyone is available" here;
 * - **Tue**: the Owner's date-only shoot for one person: "All day", "booked by Owner";
 * - **Wed**: nothing and nobody away: the only day that says "Everyone is available";
 * - **Thu**: approved comp leave and an approved half day.
 * (A leave request still waiting keeps its chip and is never "On leave": unit-tested,
 * `besideCrew`; a request here would sit in the Owner's Approvals while other specs count them.)
 */
async function crewWeek(info: TestInfo) {
  const prefix = `${prefixOf(info)}crew `;
  await removeTasksTitled(prefix);
  const index = ["desktop", "mobile", "mobile-lg"].indexOf(info.project.name);
  const monday = addISTDays(todayIST(), 7 * (26 + index) - ((istWeekday(todayIST()) + 6) % 7));
  const [mon, tue, wed, thu, fri] = [0, 1, 2, 3, 4].map((offset) => addISTDays(monday, offset));
  if (!mon || !tue || !wed || !thu || !fri) throw new Error("the week has five days");
  const staffId = await memberIdOf(USERS.staff.email);
  const ownerId = await memberIdOf(USERS.owner.email);
  const shootType = await taskTypeId(SHOOT_TYPE);
  const leaveOn = `leave_requests?start_date=gte.${mon}&end_date=lte.${fri}&member_id=in.(${staffId},${RESET_ID})`;
  await serviceDelete(leaveOn);
  const own = `${prefix}two people`;
  const ownId = await rpcAs<string>(USERS.admin.email, USERS.admin.password, "task_create", {
    title: own,
    description: null,
    task_type_id: shootType,
    client_id: null,
    priority: "medium",
    due_at: istInstant(fri, "18:00"),
    assignee_ids: [staffId, RESET_ID],
    primary_owner_id: staffId,
    approving_admin_id: null,
    stages: [],
    event_date: mon,
    event_start_at: istInstant(mon, "14:00"),
    event_end_at: istInstant(mon, "16:00"),
    location: "Crew Hall",
  });
  const allDay = `${prefix}owner all day`;
  const allDayId = await rpcAs<string>(USERS.owner.email, USERS.owner.password, "task_create", {
    title: allDay,
    description: null,
    task_type_id: shootType,
    client_id: null,
    priority: "medium",
    due_at: istInstant(fri, "18:00"),
    assignee_ids: [staffId],
    primary_owner_id: staffId,
    approving_admin_id: null,
    stages: [],
    event_date: tue,
    event_start_at: null,
    event_end_at: null,
    location: "Owner Yard",
  });
  const decided = { decided_by: ownerId, decided_at: `${todayIST()}T00:00:00+05:30` };
  await serviceInsert("leave_requests", {
    member_id: staffId,
    type: "comp_leave",
    start_date: thu,
    end_date: thu,
    state: "approved",
    source: "owner",
    ...decided,
  });
  await serviceInsert("leave_requests", {
    member_id: RESET_ID,
    type: "half_day",
    start_date: thu,
    end_date: thu,
    state: "approved",
    source: "owner",
    ...decided,
  });
  return {
    prefix,
    staffId,
    mon,
    tue,
    wed,
    thu,
    fri,
    own: { id: ownId, title: own, place: "Crew Hall" },
    allDay: { id: allDayId, title: allDay, place: "Owner Yard" },
    remove: async () => {
      await removeTasksTitled(prefix);
      await serviceDelete(leaveOn);
    },
  };
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
    await calendarReady(page);
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
    await calendarReady(page);
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

  test("someone else's shoot is Busy: the person, the type, the time and who booked it, never its title or place; On leave and Free; every filter", async ({
    page,
  }, info) => {
    const shoot = await ownerCreatesShoot(info);
    const staffId = await memberIdOf(USERS.staff.email);
    const words = bookingWords("Local Staff", "10:00 am – 11:00 am", SHOOT_TYPE, "Owner");
    await page.goto(`/calendar?view=day&date=${todayIST()}`);
    await hydrated(page);
    const crew = crewOnScreen(page, info);
    // The Owner's shoot for someone else: who, the type, when, and who booked it (the other
    // projects' shoots are the same words at the same time, so the first of them is read).
    const booking = bookingsOf(crew, staffId).filter({ hasText: "10:00 am – 11:00 am" }).first();
    await expect(booking).toHaveText(words);
    await expectCrew(crew);
    await expect(crew.locator('[data-slot="calendar-everyone-available"]')).toHaveCount(0);
    await expect(crew.locator('[data-slot="calendar-free"]')).not.toContainText("Local Staff");
    // Never the task's title or its place: not on the screen, not anywhere in the page.
    await expect(calendar(page)).not.toContainText(shoot.title);
    await expect(calendar(page)).not.toContainText("Studio B");
    const html = await page.content();
    expect(html, "the title is not in the page").not.toContain(shoot.title);
    expect(html, "the place is not in the page").not.toContain("Studio B");
    // No hour timeline and none of the old "‹Name› busy" blocks (v6.0).
    await expect(page.locator('[data-slot="calendar-timeline"]')).toHaveCount(0);
    await expect(page.locator('[data-slot="calendar-busy"]')).toHaveCount(0);
    // An Admin creates tasks: "+ New task on ‹day›" (the phone's pinned bar, the laptop Day's
    // Crew card), not "Suggest a task".
    await expect(dayButton(page, info)).toBeVisible();
    await expect(page.locator('[data-slot="suggest-task"]')).toHaveCount(0);

    if (!isPhone(info)) {
      // The Week's row for today: one line a booking, the same four facts.
      await page.goto(`/calendar?view=week&date=${todayIST()}`);
      await hydrated(page);
      const row = page.locator(`[data-slot="calendar-week-row"][data-date="${todayIST()}"]`);
      await expect(
        row.locator('[data-slot="calendar-booking"]').filter({ hasText: "Local Staff" }).first(),
      ).toHaveText(`Local Staff · ${SHOOT_TYPE} · 10:00 am – 11:00 am · booked by Owner`);
      await expect(row).not.toContainText(shoot.title);
      // The Month's day popup: the bordered table, a row a booking, a column a fact.
      await page.goto("/calendar");
      await hydrated(page);
      await dayBox(page, todayIST()).click();
      const popup = daySheet(page);
      await expect(popup).toHaveAttribute("data-layout", "laptop");
      await expectCrew(popup);
      const cells = bookingsOf(popup, staffId)
        .filter({ hasText: "10:00 am – 11:00 am" })
        .first()
        .locator("th, td");
      await expect(cells).toHaveText([
        "Local Staff",
        SHOOT_TYPE,
        "10:00 am – 11:00 am",
        "booked by Owner",
      ]);
      await expect(popup.getByRole("columnheader")).toHaveText([
        "Person",
        "Type",
        "Time",
        "Booked by",
      ]);
      await expect(popup).not.toContainText(shoot.title);
      await expect(popup.locator('[data-slot="calendar-open-day"]')).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(popup).toHaveCount(0);
    }
    await page.locator('[data-slot="calendar-filters-button"]:visible').click();
    const sheet = page.locator('[data-calendar="filters-sheet"]');
    for (const kind of ["client", "person", "type", "status"]) {
      await expect(sheet.locator(`[data-field="calendar-filter-${kind}"]`)).toBeVisible();
    }
  });

  test("the Admin's own bookings for others count (the 'Everyone is available' bug); a date-only event is All day, booked by Owner; everyone is available only on a quiet day; leave is the fact, never its type", async ({
    page,
  }, info) => {
    const week = await crewWeek(info);
    const open = async (date: string) => {
      await page.goto(`/calendar?view=day&date=${date}`);
      await hydrated(page);
      await expect(detail(page)).toHaveAttribute("data-date", date);
      return crewOnScreen(page, info);
    };

    // Monday: the Admin booked two people. Both are Busy, "booked by you"; nobody is "available".
    let crew = await open(week.mon);
    await expect(crew.locator('[data-slot="calendar-everyone-available"]')).toHaveCount(0);
    await expect(crew.locator('[data-slot="calendar-bookings-title"]')).toHaveText(
      isPhone(info) ? "Crew busy · 2" : "Busy · 2",
    );
    await expect(crew.locator('[data-slot="calendar-booking"]')).toHaveText([
      bookingWords("Local Staff", "2:00 pm – 4:00 pm", SHOOT_TYPE, "you"),
      bookingWords("Reset Staff", "2:00 pm – 4:00 pm", SHOOT_TYPE, "you"),
    ]);
    const free = crew.locator('[data-slot="calendar-free"]');
    await expect(free).not.toContainText("Local Staff");
    await expect(free).not.toContainText("Reset Staff");
    // The Admin is free that day, and named in full.
    await expect(free).toContainText("Local Admin");
    await expect(crew.locator('[data-slot="calendar-on-leave"]')).toHaveText(
      /^On leave( · )?Nobody$/,
    );
    // Their own task is on the day in full: its title, its place and its people.
    const own = eventOf(detail(page), week.own);
    await expect(own).toContainText(week.own.title);
    await expect(own).toContainText(week.own.place);
    await expect(own).toContainText("2:00 pm – 4:00 pm");
    // Both people, in whichever order the task holds them.
    await expect(own).toContainText(/(Local Staff, Reset Staff|Reset Staff, Local Staff)$/);
    if (isPhone(info)) {
      await expect(detail(page).locator('[data-slot="calendar-tasks-title"]')).toHaveText(
        /^Your tasks · \d+$/,
      );
    } else {
      await expect(detail(page).locator('[data-slot="calendar-events-title"]')).toHaveText(
        "Your events",
      );
      await expect(page.locator('[data-slot="calendar-people-card"] h2')).toHaveText(
        `Crew · ${dayName(week.mon)}`,
      );
    }

    // Tuesday: the Owner's date-only shoot for someone else: "All day", "booked by Owner", and
    // nothing of the task itself anywhere in the page.
    crew = await open(week.tue);
    await expect(crew.locator('[data-slot="calendar-booking"]')).toHaveText([
      bookingWords("Local Staff", "All day", SHOOT_TYPE, "Owner"),
    ]);
    await expect(crew.locator('[data-slot="calendar-everyone-available"]')).toHaveCount(0);
    const html = await page.content();
    expect(html).not.toContain(week.allDay.title);
    expect(html).not.toContain(week.allDay.place);
    // Nothing of the Admin's own is on that day; the Crew still shows.
    await expect(detail(page).locator('[data-slot="calendar-empty-day"]')).toHaveText(
      "Nothing on this day.",
    );

    // Wednesday: nobody busy, nobody on leave: the one day that says "Everyone is available".
    crew = await open(week.wed);
    await expect(crew.locator('[data-slot="calendar-everyone-available"]')).toHaveText(
      "Everyone is available",
    );
    await expect(crew.locator('[data-slot="calendar-booking"]')).toHaveCount(0);
    await expect(crew.locator('[data-slot="calendar-away-free"]')).toHaveCount(0);

    // Thursday: leave is a fact to an Admin, never its type; a half day says so. No leave chip
    // beside the list: "On leave" says it once.
    crew = await open(week.thu);
    await expect(crew.locator('[data-slot="calendar-on-leave"]')).toHaveText(
      /^On leave( · )?Local Staff, Reset Staff · Half day$/,
    );
    await expect(crew.locator('[data-slot="calendar-bookings-title"]')).toHaveText(
      isPhone(info) ? "Crew busy · 0" : "Busy · 0",
    );
    await expect(crew.locator('[data-slot="calendar-nobody-busy"]')).toHaveText("Nobody busy");
    await expect(crew.locator('[data-slot="calendar-free"]')).not.toContainText("Local Staff");
    await expect(
      page.locator('[data-slot="calendar-detail"] [data-slot="calendar-leave"]'),
    ).toHaveCount(0);
    // An Admin never reads the leave's type (the data holds none: unit-tested, `buildCrew`).
    await expect(calendar(page)).not.toContainText(/comp leave/i);

    // "+ New task on ‹day›" (the Day's Crew card, outlined; the phone's bar, the screen's one
    // solid) opens the form on that day.
    crew = await open(week.mon);
    const button = dayButton(page, info);
    await expect(button).toHaveText(`New task on ${shortDay(week.mon)}`);
    await expect(button).toHaveAttribute("data-variant", isPhone(info) ? "strong" : "secondary");
    await button.click();
    const form = page.locator('[data-slot="task-form-dialog"]');
    await expect(form).toBeVisible();
    await expect(form.locator('input[name="dueDate"]')).toHaveValue(week.mon);
    await page.keyboard.press("Escape");
    await expect(form).toHaveCount(0);

    if (isPhone(info)) {
      // The phone's day sheet (the full month): the same rows and lists, no hour timeline.
      await page.goto(`/calendar?date=${week.mon}`);
      await hydrated(page);
      await phoneSize(page, "3");
      await dayBox(page, week.mon).click();
      const sheet = daySheet(page);
      await expect(sheet).toHaveAttribute("data-date", week.mon);
      await expect(sheet.locator('[data-slot="calendar-hours"]')).toHaveCount(0);
      await expect(sheet.locator('[data-slot="calendar-booking"]')).toHaveText([
        bookingWords("Local Staff", "2:00 pm – 4:00 pm", SHOOT_TYPE, "you"),
        bookingWords("Reset Staff", "2:00 pm – 4:00 pm", SHOOT_TYPE, "you"),
      ]);
      await expectCrew(sheet);
      await expect(eventOf(sheet, week.own)).toBeVisible();
      await expectNoHorizontalScroll(page);
      await page.keyboard.press("Escape");
      await expect(sheet).toHaveCount(0);
      await week.remove();
      return;
    }

    // The Month's day popup: the same, as a table; a quiet day says "Everyone is available".
    await page.goto(`/calendar?date=${week.mon}`);
    await hydrated(page);
    await dayBox(page, week.mon).click();
    const popup = daySheet(page);
    await expect(popup).toHaveAttribute("data-date", week.mon);
    await expect(popup.locator('[data-slot="calendar-bookings-title"]')).toHaveText("Busy · 2");
    const rows = popup.locator('[data-slot="calendar-booking"]');
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(0).locator("th, td")).toHaveText([
      "Local Staff",
      SHOOT_TYPE,
      "2:00 pm – 4:00 pm",
      "booked by you",
    ]);
    await expect(rows.nth(1).locator("th, td")).toHaveText([
      "Reset Staff",
      SHOOT_TYPE,
      "2:00 pm – 4:00 pm",
      "booked by you",
    ]);
    await expect(popup.locator('[data-slot="calendar-everyone-available"]')).toHaveCount(0);
    // Tasks, then the Crew, in that order; "Open day" stays.
    const order = await popup
      .locator(
        '[data-slot="calendar-tasks-title"], [data-slot="calendar-bookings"], [data-slot="calendar-away-free"]',
      )
      .evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-slot")));
    expect(order).toEqual(["calendar-tasks-title", "calendar-bookings", "calendar-away-free"]);
    await expect(popup.locator('[data-slot="calendar-open-day"]')).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(popup).toHaveCount(0);
    await dayBox(page, week.wed).click();
    await expect(popup).toHaveAttribute("data-date", week.wed);
    await expect(popup.locator('[data-slot="calendar-everyone-available"]')).toHaveText(
      "Everyone is available",
    );
    await expect(popup.locator('[data-slot="calendar-booking"]')).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(popup).toHaveCount(0);

    // The Week: a real table, a row a day.
    await page.goto(`/calendar?view=week&date=${week.mon}`);
    await hydrated(page);
    const laptop = page.locator('[data-slot="calendar-laptop"]');
    const table = page.getByRole("table", { name: /^Week of / });
    await expect(table).toBeVisible();
    await expect(table.getByRole("columnheader")).toHaveText([
      "Day",
      "Events · due",
      "Crew busy",
      "On leave",
      "Free",
    ]);
    await expect(table.locator("tbody tr")).toHaveCount(7);
    await expect(page.locator('[data-slot="calendar-timeline"]')).toHaveCount(0);
    const rowOf = (date: string) =>
      table.locator(`[data-slot="calendar-week-row"][data-date="${date}"]`);
    const cell = (date: string, slot: string) =>
      rowOf(date).locator(`[data-slot="calendar-week-${slot}"]`);
    await expect(rowOf(week.mon).getByRole("rowheader")).toHaveText(dayName(week.mon));
    await expect(cell(week.mon, "events")).toContainText(week.own.title);
    await expect(cell(week.mon, "busy").locator('[data-slot="calendar-booking"]')).toHaveText([
      `Local Staff · ${SHOOT_TYPE} · 2:00 pm – 4:00 pm · booked by you`,
      `Reset Staff · ${SHOOT_TYPE} · 2:00 pm – 4:00 pm · booked by you`,
    ]);
    await expect(cell(week.mon, "free")).toHaveText(/^(Nobody|\d+ people|[^,]+(, [^,]+)?)$/);
    await expect(cell(week.mon, "free")).not.toHaveText("Everyone");
    await expect(cell(week.tue, "busy").locator('[data-slot="calendar-booking"]')).toHaveText([
      `Local Staff · ${SHOOT_TYPE} · All day · booked by Owner`,
    ]);
    await expect(cell(week.tue, "events")).not.toContainText(week.allDay.title);
    await expect(cell(week.wed, "busy")).toHaveText("Nobody busy");
    await expect(cell(week.wed, "free")).toHaveText("Everyone");
    await expect(cell(week.thu, "leave")).toHaveText("Local Staff, Reset Staff · Half day");
    await expect(page.locator('[data-slot="calendar-week-help"]')).toHaveText(
      "Click a day to open it with every detail. Busy shows the type, the time and who booked it, nothing else.",
    );
    await expectNoHorizontalScroll(page);

    // A click on a row opens that day's Day view: view state, the address replaced, no history.
    const historyLength = () => page.evaluate(() => window.history.length);
    const before = await historyLength();
    await cell(week.tue, "busy").click();
    await expect(laptop).toHaveAttribute("data-view", "day");
    await expect(page).toHaveURL(new RegExp(`view=day&date=${week.tue}`));
    await expect(detail(page)).toHaveAttribute("data-date", week.tue);
    // The Day: the week's seven pills, the one on screen pressed; the day on the left, the Crew's
    // card on its right.
    const pills = page.locator('[data-slot="calendar-day-pill"]');
    await expect(pills).toHaveText(
      [0, 1, 2, 3, 4, 5, 6].map((offset) => dayName(addISTDays(week.mon, offset))),
    );
    await expect(pills.and(page.locator('[aria-pressed="true"]'))).toHaveText(dayName(week.tue));
    const sides = await page.evaluate(() => {
      const left = document
        .querySelector('[data-slot="calendar-day-view"] [data-slot="calendar-detail"]')
        ?.getBoundingClientRect();
      const card = document
        .querySelector('[data-slot="calendar-people-card"]')
        ?.getBoundingClientRect();
      return {
        leftEnd: left?.right ?? 0,
        cardStart: card?.left ?? 0,
        cardTop: card?.top ?? 0,
        leftTop: left?.top ?? -1,
      };
    });
    expect(sides.cardStart, "the Crew card is beside the day").toBeGreaterThan(sides.leftEnd);
    expect(Math.abs(sides.cardTop - sides.leftTop), "the two columns start together").toBeLessThan(
      2,
    );
    // A pill shows its day: view state too.
    await pills.filter({ hasText: dayName(week.mon) }).click();
    await expect(detail(page)).toHaveAttribute("data-date", week.mon);
    await expect(page).toHaveURL(new RegExp(`view=day&date=${week.mon}`));
    await expect(pills.and(page.locator('[aria-pressed="true"]'))).toHaveText(dayName(week.mon));
    // Back in the Week (W), Enter on a day opens it as a click does.
    await page.keyboard.press("w");
    await expect(laptop).toHaveAttribute("data-view", "week");
    await rowOf(week.wed).getByRole("button").focus();
    await page.keyboard.press("Enter");
    await expect(laptop).toHaveAttribute("data-view", "day");
    await expect(detail(page)).toHaveAttribute("data-date", week.wed);
    expect(await historyLength(), "rows, pills and views add no history").toBe(before);
    await expectNoHorizontalScroll(page);
    await week.remove();
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

/**
 * A day of this project's own in today's week and month (never today, nor a day the other specs
 * fill), with a shoot 10:00–11:00, a long shoot 1:00–3:30 pm for a client, both on the seed's
 * Crew member at "Studio C", and an ordinary task due on it. The laptop's views read it: the
 * Owner's (the popup, the Week table, the Day) and Crew's (the hour timelines).
 */
async function agendaDay(info: TestInfo) {
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

  return { prefix, day, shoot, shootTitle, longShoot, clientName };
}

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
    await expect(row.first()).toContainText("10:00 am – 11:00 am");
    await expect(row.first()).toContainText("Studio B");
    await expect(page.locator('[data-slot="calendar-busy"]')).toHaveCount(0);
    // The Owner's own booking is in the Crew's Busy too (v6.0): "booked by you".
    await expect(
      bookingsOf(crewOnScreen(page, info), await memberIdOf(USERS.staff.email))
        .filter({ hasText: "10:00 am – 11:00 am" })
        .first(),
    ).toHaveText(bookingWords("Local Staff", "10:00 am – 11:00 am", SHOOT_TYPE, "you"));

    // The email's link (`?view=day&date=`) opens that day: the laptop's Day, the phone's detail.
    await page.goto(`/calendar?view=day&date=${day}`);
    await hydrated(page);
    await expect(detail(page)).toHaveAttribute("data-date", day);
    if (!isPhone(info)) {
      await expect(page.locator('[data-slot="calendar-day-view"]')).toBeVisible();
    }
    // + New task on that day: the form opens with the deadline on it (decision 25 D); since v6.0
    // it is the bar pinned above the phone's bottom bar, and in the laptop Day's Crew card.
    const pill = dayButton(page, info);
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

  test("laptop: Month → a day's dialog → Open day; Week is a table whose row opens the Day", async ({
    page,
  }, info) => {
    test.skip(isPhone(info), "the laptop's views");
    const shoot = await ownerCreatesShoot(info);
    await page.goto("/calendar");
    await hydrated(page);
    await dayBox(page, todayIST()).click();
    await expect(daySheet(page)).toBeVisible();
    await expectCrew(daySheet(page));
    await daySheet(page).locator('[data-slot="calendar-open-day"]').click();
    await expect(daySheet(page)).toHaveCount(0);
    await expect(page.locator('[data-slot="calendar-laptop"]')).toHaveAttribute("data-view", "day");
    await expect(page).toHaveURL(/view=day/);
    await page.locator('[data-slot="calendar-view"]').getByRole("link", { name: "Week" }).click();
    await expect(page.locator('[data-slot="calendar-laptop"]')).toHaveAttribute(
      "data-view",
      "week",
    );
    // The Owner's Week (v6.0): a table, never the seven-column timeline.
    const week = page.locator('[data-slot="calendar-week-table"]');
    await expect(week).toBeVisible();
    await expect(page.locator('[data-slot="calendar-timeline"]')).toHaveCount(0);
    const today = week.locator(`[data-slot="calendar-week-row"][data-date="${todayIST()}"]`);
    await expect(today).toHaveAttribute("data-today", "");
    await expect(today.getByRole("rowheader")).toHaveText(`${dayName(todayIST())}Today`);
    await expect(today.locator('[data-slot="calendar-week-events"]')).toContainText(shoot.title);
    await expect(
      today.locator('[data-slot="calendar-booking"]').filter({ hasText: "Local Staff" }).first(),
    ).toHaveText(`Local Staff · ${SHOOT_TYPE} · 10:00 am – 11:00 am · booked by you`);
    await today.locator('[data-slot="calendar-week-events"]').click();
    await expect(page.locator('[data-slot="calendar-laptop"]')).toHaveAttribute("data-view", "day");
    await expect(detail(page)).toHaveAttribute("data-date", todayIST());
    await expect(eventOf(detail(page), shoot)).toBeVisible();

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

  test("laptop: the day popup's agenda with the Crew's table, the keyboard, the Week table and the Day beside its Crew card (v6.0)", async ({
    page,
  }, info) => {
    test.skip(isPhone(info), "the laptop's views");
    const { prefix, day, shoot, shootTitle, longShoot, clientName } = await agendaDay(info);

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
    // Then the Crew (v6.0): the two shoots as Busy rows, a table of person · type · time · booked by.
    await expectCrew(popup);
    const staffId = await memberIdOf(USERS.staff.email);
    const at = (when: string) => bookingsOf(popup, staffId).filter({ hasText: when }).first();
    await expect(at("10:00 am – 11:00 am").locator("th, td")).toHaveText([
      "Local Staff",
      SHOOT_TYPE,
      "10:00 am – 11:00 am",
      "booked by you",
    ]);
    await expect(at("1:00 pm – 3:30 pm").locator("th, td")).toHaveText([
      "Local Staff",
      SHOOT_TYPE,
      "1:00 pm – 3:30 pm",
      "booked by you",
    ]);
    // A Busy row never names the task, its client or its place.
    await expect(popup.locator('[data-slot="calendar-bookings"]')).not.toContainText(prefix);
    await expect(popup.locator('[data-slot="calendar-bookings"]')).not.toContainText("Studio C");
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

    // 3. The Week (v6.0) is a table, part of the page: one row a day, nothing sideways.
    const week = page.locator('[data-slot="calendar-week-table"]');
    await expect(week).toBeVisible();
    await expect(page.locator('[data-slot="calendar-timeline"]')).toHaveCount(0);
    await expect(page.locator('[data-fit-viewport="laptop"]')).toHaveCount(0);
    const row = week.locator(`[data-slot="calendar-week-row"][data-date="${day}"]`);
    const events = row.locator('[data-slot="calendar-week-events"]');
    // The events the Owner sees, by title in time order, then how many are due (the Owner sees
    // every spec's tasks, so the count is this test's one at least).
    await expect(events).toContainText(`${shootTitle}, ${prefix}long shoot`);
    await expect(events).toHaveText(/ · [1-9]\d* due$/);
    for (const when of ["10:00 am – 11:00 am", "1:00 pm – 3:30 pm"]) {
      await expect(
        row.locator('[data-slot="calendar-booking"]').filter({ hasText: when }).first(),
      ).toHaveText(`Local Staff · ${SHOOT_TYPE} · ${when} · booked by you`);
    }
    await expect(row.locator('[data-slot="calendar-week-free"]')).not.toHaveText("Everyone");
    await expectNoHorizontalScroll(page);
    // Today's row is marked, "Today" under its day.
    const todayRow = week.locator(`[data-slot="calendar-week-row"][data-date="${todayIST()}"]`);
    await expect(todayRow).toHaveAttribute("data-today", "");
    await expect(todayRow.getByRole("rowheader")).toContainText("Today");

    // 4. → moves a week; T comes back; D is the Day; ← and → step a day there.
    const beforeMoves = await historyLength();
    // Today is inactive on the week that holds today (the owner, 22 Oct), active a week later.
    const todayLaptop = page.locator('[data-slot="calendar-today-laptop"]');
    await expect(todayLaptop).toHaveAttribute("aria-disabled", "true");
    await page.keyboard.press("ArrowRight");
    await expect(page).toHaveURL(new RegExp(`date=${addISTDays(todayIST(), 7)}`));
    await expect(todayLaptop).not.toHaveAttribute("aria-disabled");
    await expect(
      week.locator(`[data-slot="calendar-week-row"][data-date="${addISTDays(todayIST(), 7)}"]`),
    ).toBeVisible();
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

    // 5. The Day (v6.0): the day on the left, the Crew's card on the right, no timeline; part
    // of the page.
    const dayView = page.locator('[data-slot="calendar-day-view"]');
    await expect(dayView).toBeVisible();
    await expect(dayView.locator('[data-slot="calendar-timeline"]')).toHaveCount(0);
    await expect(detail(page)).toHaveAttribute("data-date", day);
    await expect(detail(page).locator('[data-slot="calendar-events-title"]')).toHaveText("Events");
    // A row: the time, the title with its place, then the client and the people; in time order.
    const events2 = detail(page).locator('[data-slot="calendar-events"]');
    const first = eventOf(events2, shoot);
    const second = eventOf(events2, { id: longShoot });
    await expect(first).toContainText(`${shootTitle} · Studio C`);
    await expect(first).toContainText("10:00 am – 11:00 am");
    await expect(first).toContainText("Local Staff");
    await expect(second).toContainText(`${prefix}long shoot · Studio C`);
    await expect(second).toContainText("1:00 pm – 3:30 pm");
    await expect(second).toContainText(`${clientName} · Local Staff`);
    const dayOrder = await events2
      .locator('[data-slot="calendar-event"]')
      .evaluateAll((links) => links.map((link) => link.getAttribute("data-task")));
    expect(dayOrder.indexOf(shoot.id), "time order").toBeLessThan(dayOrder.indexOf(longShoot));
    const rows = events2.locator(
      `[data-slot="calendar-event"][data-task="${shoot.id}"], [data-slot="calendar-event"][data-task="${longShoot}"]`,
    );
    await expect(rows).toHaveCount(2);
    // The time leads the row, in one column down the list.
    const lefts = await rows.evaluateAll((links) =>
      links.map((link) => {
        // The spans that draw a box of their own (a wrapper with `display: contents` has none).
        const drawn = [...link.querySelectorAll("span")].filter(
          (span) => span.getClientRects().length > 0,
        );
        const time = drawn.find((span) => /^\d{1,2}:\d\d [ap]m – /.test(span.textContent ?? ""));
        const title = drawn.find((span) => (span.textContent ?? "").includes("Studio C"));
        return {
          time: Math.round(time?.getBoundingClientRect().left ?? -1),
          title: Math.round(title?.getBoundingClientRect().left ?? -1),
        };
      }),
    );
    expect(lefts[0]?.time ?? -1, "the time is drawn").toBeGreaterThan(0);
    expect(lefts[0]?.time, "the times line up").toBe(lefts[1]?.time);
    expect(lefts[0]?.title, "the titles line up").toBe(lefts[1]?.title);
    expect(lefts[0]?.time ?? 0, "the time comes first").toBeLessThan(lefts[0]?.title ?? 0);
    await expect(detail(page).locator('[data-slot="calendar-due-title"]')).toHaveText(
      /^Due · [1-9]\d*$/,
    );
    const due = detail(page)
      .locator('[data-slot="calendar-due"]')
      .filter({ hasText: `${prefix}edit` });
    await expect(due).toContainText(`${prefix}edit`);
    await expect(due).toContainText("6:00 pm");
    await expect(due).toContainText("Local Staff");
    const card = page.locator('[data-slot="calendar-people-card"]');
    await expect(card.locator("h2")).toHaveText(`Crew · ${dayName(day)}`);
    for (const when of ["10:00 am – 11:00 am", "1:00 pm – 3:30 pm"]) {
      await expect(bookingsOf(card, staffId).filter({ hasText: when }).first()).toHaveText(
        bookingWords("Local Staff", when, SHOOT_TYPE, "you"),
      );
    }
    await expectCrew(card);
    await expect(card.locator('[data-slot="new-task-on-day"]')).toHaveText(
      `New task on ${shortDay(day)}`,
    );
    await expectNoHorizontalScroll(page);
    // M back to Month, as view state too (§14.2 d).
    const beforeMonth = await historyLength();
    await page.keyboard.press("m");
    await expect(laptop).toHaveAttribute("data-view", "month");
    await expect(page).toHaveURL(/view=month/);
    expect(await historyLength()).toBe(beforeMonth);
    // The Week's row opens the Day, where an event's row opens its task.
    await page.keyboard.press("w");
    await expect(laptop).toHaveAttribute("data-view", "week");
    await row.getByRole("button").click();
    await expect(laptop).toHaveAttribute("data-view", "day");
    await eventOf(detail(page), shoot).click();
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
      await tapHandle(page);
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

test.describe("the laptop's hour timelines, Crew's (the owner's 2026-10-08 changes; v6.0: the Owner and Admins have the Week table and the Day beside its Crew card instead)", () => {
  test.use({ storageState: storageStateFor("staff") });

  test("Week and Day fit the screen, the columns line up, they open at now, hover, Due · N, the keyboard; no Crew lists", async ({
    page,
  }, info) => {
    test.skip(isPhone(info), "the laptop's views");
    const { prefix, day, shoot, shootTitle, longShoot, clientName } = await agendaDay(info);

    await page.goto("/calendar");
    await hydrated(page);
    const laptop = page.locator('[data-slot="calendar-laptop"]');
    await expect(laptop).toHaveAttribute("data-view", "month");
    const historyLength = () => page.evaluate(() => window.history.length);
    const popup = daySheet(page);

    // 1. Crew's Day and Week are still the hour timelines: no Crew lists, and nothing of them
    // in the page.
    await page.keyboard.press("w");
    await expect(laptop).toHaveAttribute("data-view", "week");
    await expect(page).toHaveURL(/view=week/);
    await expect(page.locator("[data-people-part]")).toHaveCount(0);
    await expect(page.locator('[data-slot="calendar-week-table"]')).toHaveCount(0);
    await expect(page.locator('[data-slot="calendar-booking"]')).toHaveCount(0);
    const html = await page.content();
    expect(html, "no Busy row is sent to Crew").not.toContain("booked by");
    expect(html).not.toContain("Everyone is available");

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
    // Every block's lines are one line, never wrapped.
    const wrapped = await long
      .locator("span")
      .evaluateAll(
        (spans) =>
          spans
            .filter((span) => getComputedStyle(span).display === "block")
            .filter((span) => getComputedStyle(span).whiteSpace !== "nowrap").length,
      );
    expect(wrapped).toBe(0);
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
    // A day's heading opens its popup too: the compact agenda, never a Crew list.
    await week.locator(`[data-slot="calendar-week-day"][data-date="${day}"]`).click();
    await expect(popup).toHaveAttribute("data-date", day);
    await expect(popup).toHaveAttribute("data-layout", "laptop");
    await expect(eventOf(popup, shoot)).toContainText(`${shootTitle} · 10:00 am – 11:00 am`);
    await expect(popup.locator('[data-slot="calendar-bookings"]')).toHaveCount(0);
    await expect(popup.locator('[data-slot="calendar-everyone-available"]')).toHaveCount(0);
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
});

/**
 * The owner's phone walk (2026-10-08, note 1): in the week and the compact month the page never
 * scrolls; the header, the grid or strip, the handle, the day's title and its all-day chips stay
 * put, and the timeline fills what is left down to the bottom bar as the one scroll, opening 8 px
 * above its first hour so that label is whole. A finger on the timeline scrolls it; one on the
 * grid or the handle resizes. The full month fits with no timeline.
 */
test.describe("the calendar on a phone, the owner's walk (2026-10-08; PP-light-4, V5b): Crew's day, the one with a timeline since v6.0", () => {
  test.use({ storageState: storageStateFor("staff") });

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
    await calendarReady(page);
    await expect(
      detail(page)
        .locator('[data-slot="calendar-all-day"] [data-slot="calendar-event"]')
        .filter({ hasText: allDay }),
    ).toBeVisible();
    // Crew's action for the day (the Owner's and Admins' is a pinned bar since v6.0: below).
    const pill = detail(page).locator('[data-slot="suggest-task"]');

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
 * The Owner's and Admins' phone day (v6.0 "Admin calendar"; the approved sample `PhoneDay`): under
 * the week strip or the compact month, no hour timeline: "Tasks · n" as rows (the time, the place,
 * the people), "Crew busy · n" as a card, "On leave" and "Free", and "+ New task on ‹day›" pinned
 * in a bar above the bottom bar: the screen's one solid action, never over the day's last row.
 */
test.describe("the Owner's phone day (v6.0): rows, the Crew, the pinned bar", () => {
  test.use({ storageState: storageStateFor("owner") });

  /** A day of its own with an all-day shoot and a timed one, both on the seed's Crew member. */
  async function phoneDay(info: TestInfo) {
    const prefix = `${prefixOf(info)}v6 day `;
    await removeTasksTitled(prefix);
    const day = workingDay(43);
    const staffId = await memberIdOf(USERS.staff.email);
    const create = async (title: string, from: string | null, to: string | null) =>
      rpcAs<string>(USERS.owner.email, USERS.owner.password, "task_create", {
        title,
        description: null,
        task_type_id: await taskTypeId(SHOOT_TYPE),
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
        location: "Phone Studio",
      });
    const allDay = { id: await create(`${prefix}all day`, null, null), title: `${prefix}all day` };
    const shoot = { id: await create(`${prefix}shoot`, "10:00", "11:00"), title: `${prefix}shoot` };
    return { prefix, day, staffId, allDay, shoot };
  }

  /** The bar, the bottom bar's top and the day's last row, as the screen draws them. */
  async function barLayout(page: Page) {
    const dock = (await phoneLayout(page)).dock;
    return page.evaluate((dockTop) => {
      const bar = document.querySelector<HTMLElement>('[data-slot="sticky-actions"]');
      const rows = document.querySelectorAll<HTMLElement>(
        '[data-slot="calendar-phone"] [data-slot="calendar-detail"] > *',
      );
      const last = rows[rows.length - 1];
      const box = bar?.getBoundingClientRect();
      return {
        dock: dockTop,
        position: bar ? getComputedStyle(bar).position : "",
        top: box?.top ?? 0,
        bottom: box?.bottom ?? 0,
        lastBottom: last?.getBoundingClientRect().bottom ?? 0,
        pageOverflow: document.documentElement.scrollHeight - document.documentElement.clientHeight,
      };
    }, dock);
  }

  test("week and compact month: no timeline; the events and what is due as rows; Crew busy, On leave and Free; the bar is pinned above the bottom bar and never covers the last row, at large text too", async ({
    page,
  }, info) => {
    test.skip(!isPhone(info), "the phone's day");
    const { prefix, day, staffId, allDay, shoot } = await phoneDay(info);
    await page.goto(`/calendar?date=${day}`);
    await hydrated(page);
    await expect(phone(page)).toHaveAttribute("data-size", "2");
    const handle = page.locator('button[data-slot="calendar-handle"]');
    const body = detail(page);
    await expect(body).toHaveAttribute("data-date", day);
    // No hour timeline anywhere on the Owner's phone (v6.0).
    await expect(page.locator('[data-slot="calendar-hours"]')).toHaveCount(0);
    await expect(page.locator('[data-slot="calendar-timeline"]')).toHaveCount(0);
    // "Tasks · n": the events first (the all-day one, then by time), then what is due; a row says
    // its time, its place and its people, and opens its task.
    await expect(body.locator('[data-slot="calendar-tasks-title"]')).toHaveText(
      /^Tasks · [2-9]\d*$/,
    );
    const first = eventOf(body, allDay);
    const second = eventOf(body, shoot);
    await expect(first).toContainText(`${allDay.title} · Phone Studio`);
    await expect(first).toContainText("All day");
    await expect(first).toContainText("Local Staff");
    await expect(second).toContainText(`${shoot.title} · Phone Studio`);
    await expect(second).toContainText("10:00 am – 11:00 am");
    const order = await body
      .locator('[data-slot="calendar-event"]')
      .evaluateAll((links) => links.map((link) => link.getAttribute("data-task")));
    expect(order.indexOf(allDay.id), "the all-day one first").toBeLessThan(order.indexOf(shoot.id));
    for (const row of [first, second]) {
      expect((await row.boundingBox())?.height ?? 0, "a 44 px target").toBeGreaterThanOrEqual(44);
    }
    // "Crew busy · n": the card's rows, the all-day booking first.
    await expectCrew(body);
    await expect(body.locator('[data-slot="calendar-bookings-title"]')).toHaveText(
      /^Crew busy · [2-9]\d*$/,
    );
    await expect(bookingsOf(body, staffId).filter({ hasText: "All day" }).first()).toHaveText(
      bookingWords("Local Staff", "All day", SHOOT_TYPE, "you"),
    );
    await expect(
      bookingsOf(body, staffId).filter({ hasText: "10:00 am – 11:00 am" }).first(),
    ).toHaveText(bookingWords("Local Staff", "10:00 am – 11:00 am", SHOOT_TYPE, "you"));
    await expect(body.locator('[data-slot="calendar-bookings"]')).not.toContainText(prefix);
    await expect(body.locator('[data-slot="calendar-bookings"]')).not.toContainText("Phone Studio");
    await expect(body.locator('[data-slot="calendar-on-leave"]')).toHaveText(/^On leave · /);
    await expect(body.locator('[data-slot="calendar-free"]')).toHaveText(/^Free · /);
    await expect(body.locator('[data-slot="calendar-free"]')).not.toContainText("Local Staff");

    // The bar: one button, solid neutral (the screen's one solid), as wide as the screen's
    // content, 44 px at least; no pill in the day any more.
    const bar = page.locator('[data-slot="sticky-actions"]');
    const button = bar.locator('[data-slot="new-task-on-day"]');
    await expect(button).toHaveText(`New task on ${shortDay(day)}`);
    await expect(button).toHaveAttribute("data-variant", "strong");
    await expect(body.locator('[data-slot="new-task-on-day"]')).toHaveCount(0);
    await expect(
      page.locator('main [data-variant="strong"]:visible, main [data-variant="primary"]:visible'),
    ).toHaveCount(1);
    const buttonBox = (await button.boundingBox())!;
    expect(buttonBox.height).toBeGreaterThanOrEqual(44);
    expect(buttonBox.width).toBeGreaterThan((page.viewportSize()?.width ?? 375) - 40);

    // The bar and the band under it measure themselves again when the text size changes (as
    // every sticky bar: sticky-actions.spec), so each reading is taken once they have settled.
    const expectPinned = async (label: string) => {
      await animationsSettled(page);
      await expect(async () => {
        const top = await barLayout(page);
        expect(top.position, `${label}: the bar is fixed`).toBe("fixed");
        // Flush on the bottom bar (or the band above it): never under it, never floating away.
        expect(Math.abs(top.dock - top.bottom), `${label}: on the bottom bar`).toBeLessThanOrEqual(
          1,
        );
      }).toPass();
      // The page reserves the bar's height: at the page's end the last row is above the bar.
      await expect(async () => {
        await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
        const end = await barLayout(page);
        expect(
          Math.abs(end.dock - end.bottom),
          `${label}: still on the bottom bar`,
        ).toBeLessThanOrEqual(1);
        expect(
          end.top - end.lastBottom,
          `${label}: the last row clears the bar`,
        ).toBeGreaterThanOrEqual(8);
      }).toPass();
      await page.evaluate(() => window.scrollTo(0, 0));
    };
    for (const size of ["2", "1"] as const) {
      if (size === "1") {
        await touchDrag(page, handle, -100);
        await expect(phone(page)).toHaveAttribute("data-size", "1");
        await expect(body).toHaveAttribute("data-date", day);
      }
      await expectPinned(`size ${size}`);
      await expectNoHorizontalScroll(page);
    }
    // Large text: nothing sideways, nothing cut, the bar still clear of the last row.
    for (const scale of [130, 200]) {
      await page.evaluate((percent) => {
        document.documentElement.style.fontSize = `${percent}%`;
      }, scale);
      await expectPinned(`${scale}%`);
      await expectNoHorizontalScroll(page);
      const cut = await body.evaluate(
        (section) =>
          [...section.querySelectorAll<HTMLElement>("a, li, dd, h3")].filter(
            (element) => element.scrollWidth > element.clientWidth + 1,
          ).length,
      );
      expect(cut, `${scale}%: no text is cut`).toBe(0);
    }
    await page.evaluate(() => {
      document.documentElement.style.fontSize = "";
    });

    // The bar opens New task on the day.
    await button.click();
    const form = page.locator('[data-slot="task-form-dialog"]');
    await expect(form).toBeVisible();
    await expect(form.locator('input[name="dueDate"]')).toHaveValue(day);
    await page.keyboard.press("Escape");
    await expect(form).toHaveCount(0);

    // The full month has no day under it and so no bar: the day opens in a sheet, the same rows
    // and lists, its action in the sheet's own pinned row (v1.9 W5).
    await phoneSize(page, "3");
    await expect(bar).toHaveCount(0);
    await animationsSettled(page);
    const full = await phoneLayout(page);
    const handleBox = await handle.boundingBox();
    expect.soft(full.pageOverflow, "size 3: the page does not scroll").toBeLessThanOrEqual(1);
    expect
      .soft((handleBox?.y ?? 0) + (handleBox?.height ?? 0), "size 3: above the bottom bar")
      .toBeLessThanOrEqual(full.dock + 1);
    await dayBox(page, day).click();
    const sheet = daySheet(page);
    await expect(sheet).toHaveAttribute("data-date", day);
    await expect(sheet.locator('[data-slot="calendar-hours"]')).toHaveCount(0);
    await expect(sheet.locator('[data-slot="calendar-tasks-title"]')).toHaveText(
      /^Tasks · [2-9]\d*$/,
    );
    await expect(eventOf(sheet, shoot)).toContainText("10:00 am – 11:00 am");
    await expectCrew(sheet);
    await expect(bookingsOf(sheet, staffId).filter({ hasText: "All day" }).first()).toHaveText(
      bookingWords("Local Staff", "All day", SHOOT_TYPE, "you"),
    );
    await expect(sheet.locator('[data-row][data-slot="new-task-on-day"]')).toHaveText(
      `New task on ${shortDay(day)}`,
    );
    await expectNoHorizontalScroll(page);
    await page.keyboard.press("Escape");
    await expect(sheet).toHaveCount(0);

    // A past day has no action, so no bar; the Crew still shows.
    const past = addISTDays(todayIST(), -1);
    await page.goto(`/calendar?date=${past}`);
    await hydrated(page);
    await expect(detail(page)).toHaveAttribute("data-date", past);
    await expect(page.locator('[data-slot="sticky-actions"]')).toHaveCount(0);
    await expect(page.locator('[data-slot="new-task-on-day"]')).toHaveCount(0);
    await expectCrew(detail(page));
    await removeTasksTitled(prefix);
  });

  test("installed: a day, a size and a booking add no history; back closes New task opened from the bar, then leaves; the day sheet's Crew lists close with it on back; a row is a drill-down", async ({
    page,
  }, info) => {
    test.skip(!isPhone(info), "the installed app is a phone");
    const { prefix, day, staffId, shoot } = await phoneDay(info);
    await runInstalled(page);
    await page.goto("/today");
    await hydrated(page);
    await page.goto(`/calendar?date=${day}`);
    await hydrated(page);
    const here = /\/calendar\?date=/;
    // View state: another day of the strip, the sizes. None adds history.
    await phoneSize(page, "1");
    const other = addISTDays(day, istWeekday(day) === 1 ? 1 : -1);
    await page.locator(`[data-slot="calendar-strip-day"][data-date="${other}"]`).click();
    await expect(detail(page)).toHaveAttribute("data-date", other);
    await page.locator(`[data-slot="calendar-strip-day"][data-date="${day}"]`).click();
    await expect(detail(page)).toHaveAttribute("data-date", day);
    await expect(bookingsOf(detail(page), staffId).first()).toBeVisible();
    // The bar opens New task: a layer, closed by back, which stays on the calendar.
    const bar = page.locator('[data-slot="sticky-actions"]');
    await bar.locator('[data-slot="new-task-on-day"]').click();
    const form = page.locator('[data-slot="task-form-dialog"]');
    await expect(form).toBeVisible();
    await expectBackStack(page, [{ closes: form, url: here }]);
    await expect(bar).toBeVisible();
    // The day sheet (the full month) with its Crew lists: back closes it and stays.
    await phoneSize(page, "3");
    await dayBox(page, day).click();
    const sheet = daySheet(page);
    await expect(sheet).toHaveAttribute("data-date", day);
    await expectCrew(sheet);
    await expect(bookingsOf(sheet, staffId).first()).toBeVisible();
    await expectNoHorizontalScroll(page);
    await expectBackStack(page, [{ closes: sheet, url: here }]);
    // A row of the day is a drill-down: back from the task returns to the calendar, and one more
    // back leaves it (nothing above added history).
    await phoneSize(page, "2");
    await eventOf(detail(page), shoot).click();
    await expect(page).toHaveURL(new RegExp(`/tasks/${shoot.id}$`));
    await expectBackStack(page, [{ url: here }, { url: /\/today$/ }]);
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
  await calendarReady(page);
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
    /** Where showing a day leaves the address, when the view replaces it (the Week's row). */
    landed?: (date: string) => string;
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
      // v6.0: the Owner's Week is a table whose row opens the Day view on that day (view state:
      // the address is replaced), so the task is opened from, and back returns to, that Day.
      name: "laptop Week (a day's row opens its Day)",
      phone: false,
      address: (date) => `/calendar?view=week&date=${date}`,
      landed: (date) => `/calendar?view=day&date=${date}`,
      show: async (page, date) => {
        const laptop = page.locator('[data-slot="calendar-laptop"]');
        await expect(laptop).toHaveAttribute("data-view", /^(week|day)$/);
        if ((await laptop.getAttribute("data-view")) === "week") {
          await page
            .locator(`[data-slot="calendar-week-row"][data-date="${date}"]`)
            .getByRole("button")
            .click();
          await expect(laptop).toHaveAttribute("data-view", "day");
        }
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
      name: "laptop Day (the day's column, the pager)",
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
      const here = new RegExp(`${(view.landed ?? view.address)(later).replace(/[?]/g, "\\?")}$`);

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
          // How many "…" the chip draws: itself and every part inside it cut with an ellipsis
          // (v1.9 W10: one at most, never "Ya… …").
          ellipses: [chip, ...chip.querySelectorAll<HTMLElement>("*")].filter(
            (part) =>
              getComputedStyle(part).textOverflow === "ellipsis" &&
              part.scrollWidth > part.clientWidth,
          ).length,
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
      await tapHandle(page);
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
      for (const line of lines)
        expect(line.ellipses, `${line.kind}: one "…" at most`).toBeLessThanOrEqual(1);
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
        // One ellipsis at most (v1.9 W10), its own text never a typed "…".
        expect(line.ellipses, `${line.kind} draws one "…"`).toBe(1);
        expect(line.text, `${line.kind}'s words are whole`).not.toContain("…");
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
      await tapHandle(page);
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
    // Tasks come before the client work, the Crew (v6.0: Busy, then On leave and Free; or
    // "Everyone is available" alone) after both.
    const order = await popup
      .locator(
        '[data-slot="calendar-tasks-title"], [data-slot="calendar-items-list"], [data-slot="calendar-bookings"], [data-slot="calendar-away-free"], [data-slot="calendar-everyone-available"]',
      )
      .evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-slot")));
    expect(order).toEqual([
      "calendar-tasks-title",
      "calendar-items-list",
      "calendar-bookings",
      "calendar-away-free",
    ]);
    await expectCrew(popup);
    await page.keyboard.press("Escape");
    await expect(popup).toHaveCount(0);

    if (!isPhone(info)) {
      // The laptop's Week (v6.0, the Owner's table): the day's row names the shoot in full, its
      // sixty characters wrapped inside the cell, never cut and never past the table. (Crew's
      // Week is still the timeline, whose blocks stay one line: the Crew's laptop test.)
      await page.goto(`/calendar?view=week&date=${fixture.day}`);
      await hydrated(page);
      const cell = page.locator(
        `[data-slot="calendar-week-row"][data-date="${fixture.day}"] [data-slot="calendar-week-events"]`,
      );
      await expect(cell).toContainText(fixture.shootTitle.trim());
      expect(
        await cell.evaluate((td) => td.scrollWidth <= td.clientWidth + 1),
        "the title is whole inside its cell",
      ).toBe(true);
      await expectNoHorizontalScroll(page);
    }
    await removeClientFixture(fixture.client);
  });

  test("phone, the live v1.7.1 structure (the owner's correction, 23 Oct): the full month is seven columns in the screen; a day opens a sheet with its rows and the Crew (v6.0: no timeline)", async ({
    page,
  }, info) => {
    test.skip(!isPhone(info), "the phone");
    const fixture = await longDay(info);
    await page.goto(`/calendar?date=${fixture.day}`);
    await hydrated(page);
    await tapHandle(page);
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
    // The day sheet: the day's rows and the Crew's lists (v6.0: the Owner's has no hour timeline;
    // Crew's keeps it, their own tests), the day's action pinned under it (v1.9 W5); no
    // list-and-footer popup, and "Open day" is the laptop's alone.
    await box.click();
    const sheet = daySheet(page);
    await expect(sheet).toBeVisible();
    await expect(sheet.locator('[data-slot="calendar-hours"]')).toHaveCount(0);
    await expect(sheet.locator('[data-slot="calendar-tasks-title"]')).toHaveText("Tasks · 2");
    await expect(eventIn(sheet, fixture.shootTitle.trim())).toBeVisible();
    await expectCrew(sheet);
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
    await tapHandle(page);
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
 * The laptop toolbar as drawn (v1.8, owner #89): one row where it fits, else two (row 1 Day ·
 * Week · Month, "‹ month ›" and Today; row 2 All ▾ and Filters). Every control is fully visible
 * at its own width (nothing shrinks: the view control keeps its 288 px and each segment its word,
 * never "DWMonth"), no two controls' boxes overlap, nothing reaches past the toolbar or is
 * clipped inside its own box, the laptop's 32 px controls keep their height, and the controls are
 * neutral (the colour rule: no red in the toolbar but the outline of a view that hides work, v1.9
 * W9, whose fill and words stay neutral). The rows are read by measurement: a row break
 * is allowed only where the parts on either side of it would not have fitted the toolbar's width
 * together. Returns how many rows it found.
 */
async function expectToolbar(page: Page, label: string): Promise<number> {
  const bar = await page.locator('[data-slot="calendar-controls"]:visible').evaluate((element) => {
    const box = (node: Element) => {
      const rect = node.getBoundingClientRect();
      return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
    };
    const one = (selector: string) => element.querySelector(selector);
    const main = one('[data-slot="calendar-controls-main"]');
    const side = one('[data-slot="calendar-controls-side"]');
    const view = one('[data-slot="calendar-view"]');
    const pager = one('[data-slot="calendar-pager"]');
    const named: [string, Element | null][] = [
      ["view", view],
      ...[...element.querySelectorAll('[data-slot="calendar-view"] > *')].map(
        (segment, index) => [`segment ${index + 1}`, segment] as [string, Element],
      ),
      ["previous", one('[data-slot="calendar-pager"] button[aria-label^="Previous"]')],
      ["label", one('[data-slot="calendar-pager-label"]')],
      ["next", one('[data-slot="calendar-pager"] button[aria-label^="Next"]')],
      ["today", one('[data-slot="calendar-today-laptop"]')],
      ["show", one('[data-slot="calendar-show-menu"]')],
      ["filters", one('[data-slot="calendar-filters-button"]')],
    ];
    const controls = named
      .filter((entry): entry is [string, HTMLElement] => entry[1] instanceof HTMLElement)
      .map(([name, node]) => {
        const style = getComputedStyle(node);
        return {
          name,
          ...box(node),
          visible: node.checkVisibility({ opacityProperty: false }),
          clipped: node.scrollWidth > node.clientWidth + 0.5,
          // A view that hides work is outlined red (v1.9 W9, the ADR-0015 amendment of
          // 2026-10-23): its border is checked by the W9 spec; its fill and words stay neutral.
          colours: node.hasAttribute("data-narrowed")
            ? [style.backgroundColor, style.color]
            : [style.backgroundColor, style.borderTopColor, style.color],
        };
      });
    const gap = parseFloat(getComputedStyle(element).columnGap) || 0;
    const width = (node: Element | null) => (node ? node.getBoundingClientRect().width : 0);
    return {
      ...box(element),
      width: element.clientWidth,
      overflows: element.scrollWidth > element.clientWidth,
      gap,
      mainGap: main ? parseFloat(getComputedStyle(main).columnGap) || 0 : 0,
      main: main ? box(main) : null,
      side: side ? box(side) : null,
      view: view ? box(view) : null,
      pager: pager ? box(pager) : null,
      widths: { view: width(view), pager: width(pager), side: width(side) },
      controls,
    };
  });
  expect(bar.main, `${label}: row 1's group`).not.toBeNull();
  expect(bar.side, `${label}: row 2's group`).not.toBeNull();
  expect(bar.overflows, `${label}: nothing pushed out of the toolbar`).toBe(false);
  const names = bar.controls.map((control) => control.name);
  expect(names, `${label}: every control drawn`).toEqual(
    expect.arrayContaining(["view", "previous", "label", "next", "today", "filters"]),
  );
  for (const control of bar.controls) {
    const what = `${label}: ${control.name}`;
    expect(control.visible, `${what} visible`).toBe(true);
    expect(control.right - control.left, `${what} has a width`).toBeGreaterThan(0);
    expect(control.clipped, `${what} not clipped inside its box`).toBe(false);
    expect(control.left, `${what} inside the toolbar`).toBeGreaterThanOrEqual(bar.left - 0.5);
    expect(control.right, `${what} inside the toolbar`).toBeLessThanOrEqual(bar.right + 0.5);
    expect(control.top, `${what} inside the toolbar`).toBeGreaterThanOrEqual(bar.top - 0.5);
    expect(control.bottom, `${what} inside the toolbar`).toBeLessThanOrEqual(bar.bottom + 0.5);
    if (control.name !== "label" && !control.name.startsWith("segment")) {
      expect(control.bottom - control.top, `${what} keeps its height`).toBeGreaterThanOrEqual(31.5);
    }
    for (const colour of control.colours) {
      const [r = 0, g = 0, b = 0] = (colour.match(/[\d.]+/g) ?? []).map(Number);
      expect(Math.max(r, g, b) - Math.min(r, g, b), `${what}: ${colour} is neutral`).toBeLessThan(
        24,
      );
    }
  }
  // The view control at its own width, never squeezed.
  expect(bar.widths.view, `${label}: the view control keeps its width`).toBeGreaterThanOrEqual(
    287.5,
  );
  // No two controls overlap (a segment sits inside the view control; the label between the arrows).
  const flat = bar.controls.filter((control) => !control.name.startsWith("segment"));
  for (const [index, a] of flat.entries()) {
    for (const b of flat.slice(index + 1)) {
      const overlaps =
        a.left < b.right - 0.5 &&
        b.left < a.right - 0.5 &&
        a.top < b.bottom - 0.5 &&
        b.top < a.bottom - 0.5;
      expect(overlaps, `${label}: ${a.name} and ${b.name} do not overlap`).toBe(false);
    }
  }
  const middle = (box: { top: number; bottom: number }) => (box.top + box.bottom) / 2;
  const view = bar.view!;
  const pager = bar.pager!;
  const main = bar.main!;
  const side = bar.side!;
  // Row 1: the pager beside the view control, unless the two would not fit side by side.
  const pagerBeside = Math.abs(middle(pager) - middle(view)) < 2;
  if (!pagerBeside) {
    expect(pager.top, `${label}: the pager under the view control`).toBeGreaterThanOrEqual(
      view.bottom - 0.5,
    );
    expect(
      bar.widths.view + bar.mainGap + bar.widths.pager,
      `${label}: the pager wraps only when it would not fit beside the view control`,
    ).toBeGreaterThan(bar.width);
  }
  // All ▾ and Filters: on row 1 at its right, or on a row of their own under it.
  const sideBeside = Math.abs(middle(side) - middle(main)) < 2 && pagerBeside;
  if (sideBeside) {
    expect(side.left, `${label}: All ▾ and Filters after the pager`).toBeGreaterThanOrEqual(
      pager.right,
    );
  } else {
    expect(side.top, `${label}: All ▾ and Filters on a row under row 1`).toBeGreaterThanOrEqual(
      main.bottom - 0.5,
    );
    if (pagerBeside) {
      expect(
        main.right - main.left + bar.gap + bar.widths.side,
        `${label}: a second row only when one row would not fit`,
      ).toBeGreaterThan(bar.width);
    }
    // At the right of their row, as on one row.
    expect(Math.abs(side.right - bar.right), `${label}: Filters at the right`).toBeLessThan(1);
  }
  return sideBeside ? 1 : pagerBeside ? 2 : 3;
}

/**
 * The laptop's calendar toolbar (v1.8, owner 23 Oct): All · Tasks · Client work is one `All ▾`
 * menu beside Filters, the toolbar one row where it fits (Day/Week/Month · ‹ month › · Today ·
 * All ▾ · Filters), else All ▾ and Filters on a second row (owner #89, `expectToolbar`), and a
 * leave bar never truncates: "Name · On leave" where it fits, else "Name · Leave", never
 * "Name · On l…", else the photo and "Leave"; the phone's full-month bars the same, down to the
 * photo alone (owner, #89 comment 6370526089).
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

  /**
   * A leave label as drawn: its visible words, whether it is cut (an overflow or an ellipsis),
   * whether the long and the short wordings would have fitted where it is, and whether the
   * person's photo is showing (the last wording, `[photo] Leave`, owner 23 Oct).
   */
  async function leaveLabel(label: Locator) {
    // The server's HTML says `long` on every label until the calendar's own JavaScript has
    // measured, which lands after the shell's `hydrated()`: on a slow machine the bar is visible,
    // and still the server's default, when it is read (CI run 40050701307, the week at 1024:
    // "long", cut; 12 of 12 locally at a 6× CPU throttle). The area says when it has measured.
    await expect(label.locator("xpath=ancestor::*[@data-leave-fitted]")).toHaveCount(1);
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

  test("All ▾ beside Filters: whole at 1024 and 1280 in every view (one row, or two where one does not fit); the menu ticks the choice; a view control, remembered", async ({
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
        await expectToolbar(page, `${view} at ${width}`);
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
    // A view that hides work is outlined red (v1.9 W9, the ADR-0015 amendment of 2026-10-23,
    // replacing v1.8's neutral selected look); its fill and words stay neutral. The colours ease
    // for 120 ms (`pressable`): read once they have settled.
    const lookOf = () =>
      trigger.evaluate((element) => {
        const probe = document.createElement("span");
        probe.style.color = "var(--destructive)";
        document.body.append(probe);
        const red = getComputedStyle(probe).color;
        probe.remove();
        const style = getComputedStyle(element);
        return {
          red,
          border: style.borderTopColor,
          background: style.backgroundColor,
          ink: style.color,
        };
      });
    await expect
      .poll(async () => {
        const drawn = await lookOf();
        return drawn.border === drawn.red;
      })
      .toBe(true);
    const look = await lookOf();
    expect(look.border, "the red outline").toBe(look.red);
    for (const colour of [look.background, look.ink]) {
      const [r = 0, g = 0, b = 0] = (colour.match(/[\d.]+/g) ?? []).map(Number);
      expect(Math.max(r, g, b) - Math.min(r, g, b), `${colour} is neutral`).toBeLessThan(24);
    }
    await expectToolbar(page, "Client work ▾ at 1024");
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
      await expectToolbar(page, `Client work ▾, ${view} at 1024`);
    }
    await expectBackStack(page, [{ url: /\/today$/ }]);
    // Remembered on this device, as the switch was.
    await page.goto(`/calendar?date=${day}`);
    await hydrated(page);
    await expect.poll(() => shownLabel(trigger)).toBe("Client work");
    await chooseShow(page, "all");
    await expect.poll(() => shownLabel(trigger)).toBe("All");
  });

  test("a leave bar never truncates: a long name at 1024 and 1280 (the month) and on a phone's full month at 375 and 430; with room it says On leave; with none, the photo and Leave; the Week's and the Day's On leave name them in full (v6.0)", async ({
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
        await tapHandle(page);
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

      // The Owner's Week (v6.0) is a table: its "On leave" cell names them in full, the whole
      // name wrapped inside the cell, never cut.
      const fullName = `${FIRST} ${surname(info)} (freelancer)`;
      await page.goto(`/calendar?view=week&date=${day}`);
      await hydrated(page);
      const cell = page.locator(
        `[data-slot="calendar-week-row"][data-date="${day}"] [data-slot="calendar-week-leave"]`,
      );
      await expect(cell).toContainText(fullName);
      const week = await cell.evaluate((td) => ({
        cut: td.scrollWidth > td.clientWidth + 1,
        ellipsis: getComputedStyle(td).textOverflow === "ellipsis",
      }));
      expect(week.cut, `week at ${width}: nothing cut`).toBe(false);
      expect(week.ellipsis, `week at ${width}: no ellipsis`).toBe(false);
      await expectNoHorizontalScroll(page);

      // The Day (v6.0): the Crew card's "On leave" names them in full, and no leave chip says
      // it a second time beside it.
      await page.goto(`/calendar?view=day&date=${day}`);
      await hydrated(page);
      const onLeave = page.locator(
        '[data-slot="calendar-people-card"] [data-slot="calendar-on-leave"]',
      );
      await expect(onLeave).toContainText(fullName);
      expect(
        await onLeave.locator("dd").evaluate((dd) => dd.scrollWidth <= dd.clientWidth + 1),
        `day at ${width}: the name is whole`,
      ).toBe(true);
      await expect(
        page.locator('[data-slot="calendar-day-view"] [data-slot="calendar-leave"]'),
      ).toHaveCount(0);
      await expectNoHorizontalScroll(page);
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
    // Filters is an icon: its name says it; "·n" beside it while a filter is on (v1.9 W9).
    const filters = header.locator('[data-slot="calendar-filters-button"]');
    await expect(filters).toHaveAccessibleName("Filters");
    await expect(filters.locator('[data-slot="calendar-filters-count"]')).toHaveCount(0);
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
    // A filter on: "·1" beside the icon (v1.9 W9, which replaced v1.8's dot), and the name says how many.
    await page.goto(`/calendar?date=${day}&status=done`);
    await hydrated(page);
    await expect(filters).toHaveAccessibleName("Filters · 1 on");
    await expect(filters.locator('[data-slot="calendar-filters-count"]')).toHaveText("·1");
    // The phone's full-month leave bar picks its wording as the laptop's does (owner, #89 comment
    // 6370526089; "a leave bar never truncates" checks each wording).
    await page.goto(`/calendar?date=${day}`);
    await hydrated(page);
    await tapHandle(page);
    await expect(phone(page)).toHaveAttribute("data-size", "3");
    await expect(
      dayBox(page, day).locator('[data-slot="calendar-leave-bar"][data-leave-fit]'),
    ).toHaveCount(1);
    await removeLongName(info, id);
  });
});

/**
 * The laptop toolbar where one row does not fit (v1.8, owner on #89: it overlapped, "DWMonth", at
 * a window of about 1180 px): from 768 to 1440 px, in both themes and every view, the toolbar
 * wraps instead of squeezing. Where one row fits it is one row; where it does not, row 1 is
 * Day · Week · Month, "‹ month ›" and Today and row 2 is All ▾ and Filters (at the narrowest, where
 * even row 1 is wider than the content, the pager under the view control). Nothing shrinks,
 * overlaps or is clipped (`expectToolbar`). The phone is unchanged (its own header specs).
 */
test.describe("the laptop calendar toolbar wraps, never squeezes (v1.8, owner #89)", () => {
  test.use({ storageState: storageStateFor("owner") });

  const WRAP_WIDTHS = [768, 900, 1024, 1180, 1280, 1440] as const;

  for (const theme of ["light", "dark"] as const) {
    for (const width of WRAP_WIDTHS) {
      test(`${theme} at ${width}: every control whole in every view`, async ({ page }, info) => {
        test.skip(isPhone(info), "the laptop's toolbar (the phone's header is unchanged)");
        await page.setViewportSize({ width, height: 800 });
        await page.goto("/calendar");
        await page.evaluate((value) => {
          window.localStorage.setItem("theme", value);
          window.localStorage.removeItem("maxoff.calendar.show");
        }, theme);
        const today = todayIST();
        for (const view of ["month", "week", "day"] as const) {
          await page.goto(`/calendar?view=${view}&date=${today}`);
          await hydrated(page);
          if (theme === "dark") await expect(page.locator("html")).toHaveClass(/\bdark\b/);
          else await expect(page.locator("html")).not.toHaveClass(/\bdark\b/);
          await expect.poll(() => shownLabel(showControl(page))).toBe("All");
          const rows = await expectToolbar(page, `${theme} ${view} at ${width}`);
          // The widest laptop's month keeps one row; the narrowest wraps; 1180 (the owner's
          // window) is whole either way (`expectToolbar`).
          if (view === "month" && width === 1440) expect(rows, "one row at 1440").toBe(1);
          if (width === 768) expect(rows, "wrapped at 768").toBeGreaterThan(1);
        }
      });
    }
  }

  test("Client work ▾, the longest choice, wraps the same way at every laptop width", async ({
    page,
  }, info) => {
    test.skip(isPhone(info), "the laptop's toolbar");
    await page.goto("/calendar");
    // This test's own browser context: the choice is gone with it.
    await page.evaluate(() => window.localStorage.setItem("maxoff.calendar.show", "client"));
    for (const width of WRAP_WIDTHS) {
      await page.setViewportSize({ width, height: 800 });
      await page.goto(`/calendar?view=day&date=${todayIST()}`);
      await hydrated(page);
      await expect.poll(() => shownLabel(showControl(page))).toBe("Client work");
      await expectToolbar(page, `Client work, day at ${width}`);
    }
  });
});

/** Crew never see All · Tasks · Client work (no client work on their calendar), on any device. */
test.describe("the calendar's All ▾, as Crew", () => {
  test.use({ storageState: storageStateFor("staff") });

  test("no All ▾ and no switch for Crew; the toolbar whole from 768 to 1440", async ({
    page,
  }, info) => {
    if (!isPhone(info)) {
      for (const width of WIDTHS_CREW) {
        await page.setViewportSize({ width, height: 800 });
        await page.goto("/calendar");
        await hydrated(page);
        await expect(page.locator('[data-slot="calendar-filters-button"]:visible')).toBeVisible();
        await expectToolbar(page, `Crew at ${width}`);
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

const WIDTHS_CREW = [768, 900, 1024, 1180, 1280, 1440] as const;

/**
 * v1.9 W5 (6b.4 (1), the approved v1.9 sample §4): "+ New task on ‹day›" pinned at the foot of a
 * day, in the laptop's Day (under the timeline's one scroll) and a phone's day sheet (under the
 * sheet's one scroll): the Owner's and an Admin's opens New task on that date, Crew's reads
 * "Suggest a task on ‹day›" and opens a suggestion with the day in its details. None on a day before
 * today (nor on today from 11:59 pm IST: `canStartTaskOnDate`, unit-tested).
 */
test.describe('v1.9 W5: "+ New task on ‹day›" at the foot of a day', () => {
  /**
   * The pinned row (the button is the row): the foot of Crew's laptop Day timeline, or the phone
   * sheet's foot. Since v6.0 the Owner's and Admins' laptop Day has the action in its Crew card
   * instead (`card`), outlined: the card's one action.
   */
  const pinned = (page: Page) => page.locator("[data-row]:visible");
  const card = (page: Page) =>
    page.locator('[data-slot="calendar-people-card"] [data-slot="new-task-on-day"]');

  /** The Day's card button: the card's last row, as wide as the card, a quiet outlined trigger. */
  async function expectInCard(page: Page) {
    const button = card(page);
    await expect(button).toHaveCount(1);
    await expect(button).toHaveAttribute("data-variant", "secondary");
    await expect(page.locator("[data-row]")).toHaveCount(0);
    const boxes = await page.evaluate(() => {
      const aside = document.querySelector<HTMLElement>('[data-slot="calendar-people-card"]');
      const action = aside?.querySelector<HTMLElement>('[data-slot="new-task-on-day"]');
      const style = aside ? getComputedStyle(aside) : null;
      return {
        last: aside?.lastElementChild === action,
        inner:
          (aside?.clientWidth ?? 0) -
          parseFloat(style?.paddingLeft ?? "0") -
          parseFloat(style?.paddingRight ?? "0"),
        width: action?.getBoundingClientRect().width ?? 0,
        height: action?.getBoundingClientRect().height ?? 0,
      };
    });
    expect(boxes.last, "the card's last row").toBe(true);
    expect(Math.abs(boxes.inner - boxes.width), "as wide as the card").toBeLessThan(2);
    expect(boxes.height).toBeGreaterThanOrEqual(44);
  }

  /** Opens `date` where its pinned row lives: the laptop's Day, or the phone's full month's sheet. */
  async function openDay(page: Page, info: TestInfo, date: string) {
    if (!isPhone(info)) {
      await page.goto(`/calendar?view=day&date=${date}`);
      await hydrated(page);
      await expect(page.locator('[data-slot="calendar-day-view"]')).toBeVisible();
      return;
    }
    await page.goto(`/calendar?date=${date}`);
    await hydrated(page);
    await tapHandle(page);
    await expect(phone(page)).toHaveAttribute("data-size", "3");
    await dayBox(page, date).click();
    await expect(daySheet(page)).toHaveAttribute("data-date", date);
    // The sheet slides up for 200 ms: its row is where it rests only once that is over (CI run
    // 41524114062 measured it 19 px low, mid-slide; at rest it ends 16 px above a 932 px screen).
    await animationsSettled(page);
  }

  /** The row is the last thing in its layer, under the scroll, and on screen. */
  async function expectPinnedAtFoot(page: Page, info: TestInfo) {
    const row = pinned(page);
    await expect(row).toHaveCount(1);
    const box = await row.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.y + box!.height, "the row is on screen").toBeLessThanOrEqual(
      page.viewportSize()!.height + 1,
    );
    // 44 px target (ARCHITECTURE §14.1).
    expect(box!.height).toBeGreaterThanOrEqual(44);
    const layer = isPhone(info)
      ? daySheet(page)
      : page.locator('[data-slot="calendar-day-view"] [data-slot="calendar-timeline"]');
    const foot = await layer.evaluate((element) => {
      const scroll = element.querySelector<HTMLElement>(
        '[data-slot="calendar-day-body"], [data-slot="calendar-hours"]',
      );
      const action = element.querySelector<HTMLElement>("[data-row]");
      return {
        below:
          (action?.getBoundingClientRect().top ?? 0) -
          (scroll?.getBoundingClientRect().bottom ?? 0),
      };
    });
    expect(foot.below, "under the day's scroll, never in it").toBeGreaterThanOrEqual(-1);
  }

  test.describe("the Owner", () => {
    test.use({ storageState: storageStateFor("owner") });

    test("a later day's row opens New task on that date; none on a past day", async ({
      page,
    }, info) => {
      const day = workingDay(3);
      await openDay(page, info, day);
      // The phone's sheet pins the row at its foot; the laptop's Day has it in the Crew card.
      if (isPhone(info)) await expectPinnedAtFoot(page, info);
      else await expectInCard(page);
      const button = isPhone(info)
        ? pinned(page).and(page.locator('[data-slot="new-task-on-day"]'))
        : card(page);
      await expect(button).toHaveText(`New task on ${shortDay(day)}`);
      // A trigger that opens a form: quiet, never a second solid on the layer (ADR-0015).
      await expect(button).toHaveAttribute("data-variant", isPhone(info) ? "ghost" : "secondary");
      await expect(page.locator('[data-slot="suggest-task"]')).toHaveCount(0);
      await button.click();
      const form = page.locator('[data-slot="task-form-dialog"]');
      await expect(form).toBeVisible();
      await expect(form.locator('input[name="dueDate"]')).toHaveValue(day);
      await expect(form.locator('input[name="dueTime"]')).toHaveValue("18:00");
      await page.keyboard.press("Escape");
      await expect(form).toHaveCount(0);

      const past = addISTDays(todayIST(), -1);
      await openDay(page, info, past);
      await expect(page.locator("[data-row]")).toHaveCount(0);
      await expect(page.locator('[data-slot="new-task-on-day"]')).toHaveCount(0);
    });

    test("installed: back closes New task, then the day sheet, then leaves the calendar", async ({
      page,
    }, info) => {
      test.skip(!isPhone(info), "the installed app is a phone");
      const day = workingDay(3);
      await runInstalled(page);
      await page.goto("/today");
      await hydrated(page);
      await page.locator('[data-slot="bottom-nav"] [data-nav="calendar"]').click();
      await expect(page).toHaveURL(/\/calendar$/);
      await hydrated(page);
      // The real handle is a button: the loading skeleton draws a div with the same slot, and
      // after a client-side move from Today a tap could land on it (CI 41635363757).
      await tapHandle(page);
      await expect(phone(page)).toHaveAttribute("data-size", "3");
      if (!(await dayBox(page, day).isVisible())) {
        await page.locator('[data-slot="calendar-next"]').click();
      }
      await dayBox(page, day).click();
      await expect(daySheet(page)).toHaveAttribute("data-date", day);
      await pinned(page).and(page.locator('[data-slot="new-task-on-day"]')).click();
      const form = page.locator('[data-slot="task-form-dialog"]');
      await expect(form).toBeVisible();
      await expectBackStack(page, [
        { closes: form, url: /\/calendar(\?.*)?$/ },
        { closes: daySheet(page), url: /\/calendar(\?.*)?$/ },
        { url: /\/today$/ },
      ]);
    });
  });

  test.describe("an Admin", () => {
    test.use({ storageState: storageStateFor("admin") });

    test("today's row opens New task on today", async ({ page }, info) => {
      const today = todayIST();
      test.skip(
        toISTTime(systemClock().toISOString()) >= "23:59",
        "from 11:59 pm IST today has no row (the rule under test elsewhere)",
      );
      await openDay(page, info, today);
      if (isPhone(info)) await expectPinnedAtFoot(page, info);
      else await expectInCard(page);
      const button = isPhone(info)
        ? pinned(page).and(page.locator('[data-slot="new-task-on-day"]'))
        : card(page);
      await expect(button).toHaveText(`New task on ${shortDay(today)}`);
      await button.click();
      const form = page.locator('[data-slot="task-form-dialog"]');
      await expect(form).toBeVisible();
      await expect(form.locator('input[name="dueDate"]')).toHaveValue(today);
      await page.keyboard.press("Escape");
      await expect(form).toHaveCount(0);
    });
  });

  test.describe("Crew", () => {
    test.use({ storageState: storageStateFor("staff") });

    test("Suggest a task on ‹day› with the day in its details; none on a past day", async ({
      page,
    }, info) => {
      const day = workingDay(3);
      await openDay(page, info, day);
      await expectPinnedAtFoot(page, info);
      const button = pinned(page).and(page.locator('[data-slot="suggest-task"]'));
      await expect(button).toHaveText(`Suggest a task on ${shortDay(day)}`);
      await expect(pinned(page).and(page.locator('[data-slot="new-task-on-day"]'))).toHaveCount(0);
      await button.click();
      const dialog = page.getByRole("dialog", { name: "Suggest a task" });
      await expect(dialog).toBeVisible();
      await expect(dialog.getByRole("textbox", { name: /Details/ })).toHaveValue(
        `For ${shortDay(day)}.`,
      );
      await page.keyboard.press("Escape");
      await expect(dialog).toHaveCount(0);

      const past = addISTDays(todayIST(), -1);
      await openDay(page, info, past);
      await expect(page.locator("[data-row]")).toHaveCount(0);
      await expect(page.locator('[data-slot="suggest-task"]')).toHaveCount(0);
    });
  });
});

/**
 * v1.9 W9 (owner 2026-10-23; the ADR-0015 amendment of that day; the approved v1.9 sample §9): a
 * view that hides work is outlined red. `All ▾` on Tasks or Client work, and Filters with real
 * filters on ("Filters · 2" on a laptop, "·2" beside the phone's icon), take the thin
 * `--destructive` outline, their text neutral; All and no filters stay neutral. At 375, 430 and
 * 1280 (the three projects), in both themes. View controls: the address never changes for All ▾
 * (the toolbar's and header's own tests prove they add no history).
 */
test.describe("v1.9 W9: a narrowed calendar view is outlined red", () => {
  test.use({ storageState: storageStateFor("owner") });

  const filtersButton = (page: Page) =>
    page.locator('[data-slot="calendar-filters-button"]:visible');

  /** The outline as drawn: its colour, `--destructive` resolved, and the text's colour. */
  async function outline(button: Locator) {
    return button.evaluate((element) => {
      const probe = document.createElement("span");
      probe.style.color = "var(--destructive)";
      document.body.append(probe);
      const red = getComputedStyle(probe).color;
      probe.remove();
      const style = getComputedStyle(element);
      return {
        narrowed: element.hasAttribute("data-narrowed"),
        red,
        border: style.borderTopColor,
        width: parseFloat(style.borderTopWidth),
        text: style.color,
      };
    });
  }

  // The border's colour eases for 120 ms (`pressable`): polled until it settles.
  async function expectRed(button: Locator, what: string) {
    await expect
      .poll(
        async () => {
          const drawn = await outline(button);
          return drawn.border === drawn.red;
        },
        { message: `${what}: the red outline` },
      )
      .toBe(true);
    const drawn = await outline(button);
    expect(drawn.narrowed, `${what}: marked narrowed`).toBe(true);
    expect(drawn.width, `${what}: a thin outline`).toBeGreaterThanOrEqual(1);
    expect(drawn.text, `${what}: the words stay neutral`).not.toBe(drawn.red);
  }

  async function expectNeutral(button: Locator, what: string) {
    await expect
      .poll(
        async () => {
          const drawn = await outline(button);
          return drawn.border !== drawn.red;
        },
        { message: `${what}: no red outline` },
      )
      .toBe(true);
    expect((await outline(button)).narrowed, `${what}: not narrowed`).toBe(false);
  }

  for (const theme of ["light", "dark"] as const) {
    test(`${theme}: All neutral, Tasks and Client work outlined; Filters · n outlined, none neutral`, async ({
      page,
    }, info) => {
      if (!isPhone(info)) await page.setViewportSize({ width: 1280, height: 800 });
      await page.goto("/calendar");
      await page.evaluate((value) => {
        window.localStorage.setItem("theme", value);
        window.localStorage.removeItem("maxoff.calendar.show");
      }, theme);
      await page.goto("/calendar");
      await hydrated(page);
      if (theme === "dark") await expect(page.locator("html")).toHaveClass(/\bdark\b/);
      else await expect(page.locator("html")).not.toHaveClass(/\bdark\b/);

      const shows = showControl(page);
      const filters = filtersButton(page);
      await expect(shows).toHaveAttribute("data-current", "all");
      await expectNeutral(shows, "All");
      await expectNeutral(filters, "no filters");
      if (isPhone(info)) {
        await expect(filters).toHaveAccessibleName("Filters");
        await expect(filters.locator('[data-slot="calendar-filters-count"]')).toHaveCount(0);
      } else {
        await expect.poll(() => shownLabel(filters)).toBe("Filters");
      }

      const address = page.url();
      for (const show of ["tasks", "client"] as const) {
        await chooseShow(page, show);
        await expect(showControl(page)).toHaveAttribute("data-current", show);
        await expectRed(showControl(page), show);
      }
      expect(page.url(), "a view control: the address is unchanged").toBe(address);
      await chooseShow(page, "all");
      await expectNeutral(showControl(page), "All again");

      // Two real filters: a status and a type.
      const type = await taskTypeId("Normal");
      for (const [query, count] of [
        [`status=done&type=${type}`, 2],
        ["status=open", 1],
      ] as const) {
        await page.goto(`/calendar?${query}`);
        await hydrated(page);
        const on = filtersButton(page);
        await expect(on).toHaveAttribute("data-count", String(count));
        await expectRed(on, `${count} filters`);
        if (isPhone(info)) {
          await expect(on).toHaveAccessibleName(`Filters · ${count} on`);
          await expect(on.locator('[data-slot="calendar-filters-count"]')).toHaveText(`·${count}`);
          // The same 44 px icon button, on the header's one row.
          const box = await on.boundingBox();
          expect(box?.width).toBeGreaterThanOrEqual(44);
          expect(box?.height).toBeGreaterThanOrEqual(44);
          const header = phone(page).locator('[data-slot="calendar-header"]');
          expect(await header.evaluate((row) => row.scrollWidth <= row.clientWidth)).toBe(true);
        } else {
          await expect.poll(() => shownLabel(on)).toBe(`Filters · ${count}`);
        }
        // All ▾ keeps its own state: All is neutral with filters on.
        await expectNeutral(showControl(page), `All with ${count} filters`);
        await expectNoHorizontalScroll(page);
      }
    });
  }
});
