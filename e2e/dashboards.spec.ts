import { createClient } from "@supabase/supabase-js";
import type { Locator, Page, TestInfo } from "@playwright/test";

import { expect, test } from "./fixtures";
import { HOLD_PROXY_URL } from "./hold-proxy-config";
import {
  expectBackStack,
  holdNextRefresh,
  hydrated,
  memberIdOf,
  pageHeader,
  removeTasksTitled,
  resetAttendanceAndLeave,
  rpcAs,
  runInstalled,
  serviceDelete,
  serviceInsert,
  serviceSelect,
  serviceUpdate,
  signIn,
  storageStateFor,
  supabaseAuth,
  taskTypeId,
  USERS,
} from "./helpers";
import { addISTDays, istInstant, istWeekday, systemClock, todayIST } from "../src/core/time";

/**
 * The day screens (6A; Kickoff 6 decisions 1–12, 22, 23): Crew's My Day under the attendance
 * strip, the Owner's Today (counts → approvals → Needs you → the rest, the full board one tap
 * deeper), the Admin's Today and work report, the Owner's today line on a person, live updates
 * through the bell's Realtime client, and RLS holding for Realtime. Each project has its own Crew
 * member and Admin (`day-<role>-<project>`, the seed), so the projects never share one; the Owner
 * is shared, so the Owner's checks look for this project's own rows, never a count. On a phone
 * the installed back order of every new screen and view control (ARCHITECTURE §14.2) is checked
 * at 375 and 430px.
 */

const PASSWORD = "day-local-password";

function crew(info: TestInfo): string {
  return `day-staff-${info.project.name}@maxoff.local`;
}
function admin(info: TestInfo): string {
  return `day-admin-${info.project.name}@maxoff.local`;
}
function crewName(info: TestInfo): string {
  return `Test Day Crew (${info.project.name})`;
}
function prefixOf(info: TestInfo): string {
  return `Day ${info.project.name} `;
}

/** A weekday (Mon–Fri) at least `offset` days from today, IST, never 2 Oct (a seeded holiday). */
function workingDay(offset: number): string {
  let day = addISTDays(todayIST(), offset);
  while (istWeekday(day) === 0 || istWeekday(day) === 6 || day === "2026-10-02") {
    day = addISTDays(day, 1);
  }
  return day;
}

const isPhone = (info: TestInfo) => info.project.name !== "desktop";

/** `task_create` as this project's Admin (the task routes to them, kickoff 4 decision 2). */
async function adminCreates(
  info: TestInfo,
  args: {
    title: string;
    assignees: string[];
    due: string;
    type?: string;
    more?: Record<string, unknown>;
  },
): Promise<string> {
  return rpcAs<string>(admin(info), PASSWORD, "task_create", {
    title: args.title,
    description: null,
    task_type_id: args.type ?? (await taskTypeId("Normal")),
    client_id: null,
    priority: "medium",
    due_at: args.due,
    assignee_ids: args.assignees,
    primary_owner_id: args.assignees[0],
    approving_admin_id: null,
    ...(args.more ?? {}),
  });
}

/** Moves a task's deadline (an Admin edit, audited), e.g. into the past. */
async function moveDue(info: TestInfo, taskId: string, dueAt: string): Promise<void> {
  await rpcAs(admin(info), PASSWORD, "task_update_assignment", {
    task_id: taskId,
    changes: { due_at: dueAt },
  });
}

function hoursAgo(hours: number): string {
  return new Date(systemClock().getTime() - hours * 3_600_000).toISOString();
}

function section(page: Page, slot: string): Locator {
  return page.locator(`[data-slot="${slot}"]:visible`);
}

function taskRow(page: Page, title: string): Locator {
  return page.locator('[data-slot="task-row"]:visible').filter({ hasText: title });
}

/** The person's own reachability as the hourly job records it (5.4), set for a check. */
async function setReachability(memberId: string, state: string, sinceHours: number) {
  await serviceUpdate(`member_reachability?member_id=eq.${memberId}`, {
    state,
    since: hoursAgo(sinceHours),
  });
}

test.describe.configure({ mode: "serial" });

test.describe("Crew: My Day (6.1)", () => {
  test("the strip first, then the exception rows, Upcoming as one line, events, Suggest a task", async ({
    page,
  }, info) => {
    test.skip(info.project.name === "mobile-lg", "the flow runs at 1280 and 375px");
    const prefix = prefixOf(info);
    await removeTasksTitled(prefix);
    const crewId = await memberIdOf(crew(info));
    const later = istInstant(workingDay(5), "18:00");

    const notNoted = await adminCreates(info, {
      title: `${prefix}not noted`,
      assignees: [crewId],
      due: later,
    });
    const overdue = await adminCreates(info, {
      title: `${prefix}overdue`,
      assignees: [crewId],
      due: later,
    });
    await rpcAs(crew(info), PASSWORD, "task_acknowledge", { task_id: overdue });
    await moveDue(info, overdue, istInstant(addISTDays(todayIST(), -1), "18:00"));
    const upcoming = await adminCreates(info, {
      title: `${prefix}upcoming`,
      assignees: [crewId],
      due: istInstant(addISTDays(todayIST(), 3), "18:00"),
    });
    await rpcAs(crew(info), PASSWORD, "task_acknowledge", { task_id: upcoming });
    const tomorrow = addISTDays(todayIST(), 1);
    const shoot = await adminCreates(info, {
      title: `${prefix}shoot`,
      assignees: [crewId],
      due: istInstant(addISTDays(todayIST(), 2), "18:00"),
      type: await taskTypeId("Shoot / Site Visit"),
      more: {
        event_date: tomorrow,
        event_start_at: istInstant(tomorrow, "10:00"),
        location: "Studio 3",
      },
    });
    await rpcAs(crew(info), PASSWORD, "task_acknowledge", { task_id: shoot });

    await signIn(page, crew(info), PASSWORD);
    await expect(page).toHaveURL(/\/my-day$/);
    await hydrated(page);

    // The strip is the first thing under the title bar (ROADMAP 6.1).
    const strip = page.locator('[data-slot="attendance-strip"]');
    await expect(strip).toBeVisible();
    const notNotedSection = section(page, "my-day-group-not_noted");
    const overdueSection = section(page, "my-day-group-overdue");
    await expect(notNotedSection).toContainText(`${prefix}not noted`);
    await expect(overdueSection).toContainText(`${prefix}overdue`);
    // In the Tasks tab's order: Not noted above Overdue, both under the strip.
    const stripBox = await strip.boundingBox();
    const notNotedBox = await notNotedSection.boundingBox();
    const overdueBox = await overdueSection.boundingBox();
    expect(stripBox!.y).toBeLessThan(notNotedBox!.y);
    expect(notNotedBox!.y).toBeLessThan(overdueBox!.y);
    // Upcoming is one line, never rows; it opens Tasks.
    await expect(taskRow(page, `${prefix}upcoming`)).toHaveCount(0);
    const upcomingLine = section(page, "my-day-upcoming-line").getByRole("link");
    await expect(upcomingLine).toHaveText(/\d+ more in the next 7 days/);
    await expect(upcomingLine).toHaveAttribute("href", "/tasks");
    // Tomorrow's shoot as an event row: the time, the title, the location.
    const event = page.locator(`[data-slot="event-row"][data-task="${shoot}"]`);
    await expect(event).toContainText("Tomorrow · 10:00 am");
    await expect(event).toContainText("Studio 3");
    // A neutral Suggest a task; no sign-out row (decision 3).
    await expect(page.locator('[data-slot="suggest-task"]')).toHaveAttribute(
      "data-variant",
      "secondary",
    );
    await expect(page.locator("main")).not.toContainText(/Sign out/i);

    // A row opens the task.
    await taskRow(page, `${prefix}not noted`).click();
    await expect(page).toHaveURL(new RegExp(`/tasks/${notNoted}$`));
  });

  test("nothing waiting: the empty line, and a holiday-free week says nothing more", async ({
    page,
  }, info) => {
    test.skip(info.project.name === "mobile-lg", "the flow runs at 1280 and 375px");
    // The Admin is never given a task in this file: their My Day has no exception rows.
    await removeTasksTitled(prefixOf(info));
    await signIn(page, admin(info), PASSWORD);
    await page.goto("/my-day");
    await expect(page.locator('[data-slot="my-day-empty"]')).toHaveText("Nothing needs you today.");
  });

  test("the Owner has no day: My Day is not theirs", async ({ page }, info) => {
    test.skip(info.project.name !== "desktop", "one check is enough");
    await signIn(page, USERS.owner.email, USERS.owner.password);
    await page.goto("/my-day");
    await expect(page).toHaveURL(/\/forbidden$/);
  });

  test("a tap while My Day re-reads moves to its screen without loading the page in full", async ({
    page,
  }, info) => {
    test.skip(!isPhone(info), "the title bar's bell is the phone's");
    const prefix = prefixOf(info);
    const crewId = await memberIdOf(crew(info));
    const id = await adminCreates(info, {
      title: `${prefix}heard`,
      assignees: [crewId],
      due: istInstant(workingDay(6), "18:00"),
    });
    await signIn(page, crew(info), PASSWORD);
    await expect(page).toHaveURL(/\/my-day$/);
    await hydrated(page);
    await expect(page.locator("html")).toHaveAttribute("data-live-dashboard", "on");
    const refresh = await holdNextRefresh(page, "/my-day");
    // A change to their own task lands: the screen re-reads, and that re-read is held.
    await rpcAs(crew(info), PASSWORD, "task_acknowledge", { task_id: id });
    await refresh.held;
    await page.locator('[data-slot="header-bell"]:visible').click();
    refresh.release();
    await expect(page).toHaveURL(/\/notifications$/);
    await expect(pageHeader(page)).toContainText(/alerts|notifications/i);
    await hydrated(page);
  });

  test("a change heard just before leaving My Day never re-reads the screen it moved to", async ({
    page,
  }, info) => {
    test.skip(info.project.name === "mobile-lg", "the flow runs at 1280 and 375px");
    const prefix = prefixOf(info);
    const crewId = await memberIdOf(crew(info));
    const id = await adminCreates(info, {
      title: `${prefix}left`,
      assignees: [crewId],
      due: istInstant(workingDay(6), "18:00"),
    });
    // The moment the page hears the change: Realtime's frame carrying it.
    let markHeard: () => void = () => undefined;
    const heard = new Promise<void>((resolve) => {
      markHeard = resolve;
    });
    page.on("websocket", (socket) => {
      socket.on("framereceived", ({ payload }) => {
        if (String(payload).includes("postgres_changes") && String(payload).includes(id)) {
          markHeard();
        }
      });
    });
    await signIn(page, crew(info), PASSWORD);
    await expect(page).toHaveURL(/\/my-day$/);
    await hydrated(page);
    await expect(page.locator("html")).toHaveAttribute("data-live-dashboard", "on");
    // Every screen fetch of /leave from the tap on: the move's own, and any re-read after it.
    const fetches: string[] = [];
    page.on("request", (request) => {
      const headers = request.headers();
      if (
        headers["rsc"] === "1" &&
        !headers["next-router-prefetch"] &&
        new URL(request.url()).pathname === "/leave"
      )
        fetches.push(request.url());
    });
    // A change to their own task is heard, and the screen is left before its re-read is due.
    await rpcAs(crew(info), PASSWORD, "task_acknowledge", { task_id: id });
    await heard;
    await page.locator('a[href="/leave"]:visible').first().click();
    await expect(page).toHaveURL(/\/leave$/);
    await expect(pageHeader(page)).toContainText(/leave/i);
    // Past the re-read's moment (400 ms after the event) and its answer.
    await page.waitForTimeout(1_500);
    if (fetches.length !== 1 || info.repeatEachIndex === 0) {
      const timeline = await page.evaluate(
        () => (window as unknown as { __diag?: unknown[] }).__diag ?? [],
      );
      console.log(
        `DIAG ${info.project.name} #${info.repeatEachIndex} fetches=${fetches.length} ${JSON.stringify(timeline)}`,
      );
    }
    expect(fetches, "the move's own fetch, and no re-read after it").toHaveLength(1);
  });

  test("installed: My Day → a task → one back lands on My Day", async ({ page }, info) => {
    test.skip(!isPhone(info), "the installed app is a phone");
    const prefix = prefixOf(info);
    await removeTasksTitled(`${prefix}back`);
    const crewId = await memberIdOf(crew(info));
    const id = await adminCreates(info, {
      title: `${prefix}back`,
      assignees: [crewId],
      due: istInstant(workingDay(6), "18:00"),
    });
    await runInstalled(page);
    await signIn(page, crew(info), PASSWORD);
    await expect(page).toHaveURL(/\/my-day$/);
    await hydrated(page);
    await taskRow(page, `${prefix}back`).click();
    await expect(page).toHaveURL(new RegExp(`/tasks/${id}$`));
    await expectBackStack(page, [{ url: /\/my-day$/ }]);
  });
});

test.describe("the Owner's Today (6.2)", () => {
  test.use({ storageState: storageStateFor("owner") });

  test("the card, then exceptions only: approvals, today's tasks, risks and the week, in that order (decision 24)", async ({
    page,
  }, info) => {
    test.skip(info.project.name === "mobile-lg", "the flow runs at 1280 and 375px");
    const prefix = prefixOf(info);
    await removeTasksTitled(prefix);
    const crewId = await memberIdOf(crew(info));
    const late = await adminCreates(info, {
      title: `${prefix}late for the Owner`,
      assignees: [crewId],
      due: istInstant(workingDay(5), "18:00"),
    });
    await rpcAs(crew(info), PASSWORD, "task_acknowledge", { task_id: late });
    await moveDue(info, late, istInstant(addISTDays(todayIST(), -1), "18:00"));
    // A task due today, so "Today's tasks" has something to show (hidden when empty, decision 24).
    const dueToday = await adminCreates(info, {
      title: `${prefix}due today`,
      assignees: [crewId],
      due: istInstant(workingDay(5), "18:00"),
    });
    await moveDue(info, dueToday, istInstant(todayIST(), "23:00"));

    await page.goto("/today");
    await hydrated(page);
    // The card and the risks (the overdue task) are always there; the other sections only when
    // they have something (decision 24), so the order is checked over whichever are drawn.
    const order = [
      '[data-slot="today-attendance-card"]',
      '[data-slot="today-approvals"]',
      '[data-slot="today-tasks"]',
      '[data-slot="today-risks"]',
      '[data-slot="today-events"]',
    ];
    const always = ['[data-slot="today-attendance-card"]', '[data-slot="today-risks"]'];
    await expect(page.locator('[data-slot="today-risks"]:visible').first()).toBeVisible();
    let previous = -1;
    for (const selector of order) {
      // The shown copy: React reveals a streamed section in batches, and until then the only
      // copy is the hidden one it streamed in (see `pageHeader`).
      const shown = page.locator(`${selector}:visible`).first();
      if (!always.includes(selector) && (await shown.count()) === 0) continue;
      await expect(shown, selector).toBeVisible();
      const box = await shown.boundingBox();
      expect(box, selector).not.toBeNull();
      expect(box!.y, `${selector} comes after the one before`).toBeGreaterThan(previous);
      previous = box!.y;
    }
    // No "Needs you" list of people: the card's counts carry them (decision 24).
    await expect(page.locator('[data-slot="today-needs-you"]')).toHaveCount(0);
    await expect(page.locator("main")).not.toContainText("Everyone's in.");
    // A risk's "overdue by …" reads red, with its red dot and "Overdue" label beside it.
    await expect(page.locator('[data-slot="risk-row"] [data-tone="danger"]').first()).toContainText(
      "overdue by",
    );
    // Nothing that has no data yet (decision 4): no item approvals, client progress or revenue.
    await expect(page.locator("main")).not.toContainText(/revenue|client progress|coming soon/i);

    // The overdue task is a risk row (the first five, or behind "See all").
    const risk = page
      .locator('[data-slot="risk-row"]')
      .filter({ hasText: `${prefix}late for the Owner` });
    await expect(risk).toHaveCount(1);
    await expect(risk).toContainText(crewName(info));
    await expect(risk).toContainText("overdue by");

    // Today's tasks is one line opening All tasks on today.
    const tasksLine = section(page, "today-tasks-due").getByRole("link");
    await expect(tasksLine).toHaveAttribute("href", "/tasks/all?overdue=today");
    await tasksLine.click();
    await expect(page).toHaveURL(/\/tasks\/all\?overdue=today$/);
    await expect(page.locator('[data-filter="overdue"]:visible')).toContainText("Due today");
  });

  test("a count opens the full board on its group; Waiting opens Approvals", async ({
    page,
  }, info) => {
    test.skip(info.project.name === "mobile-lg", "the flow runs at 1280 and 375px");
    await page.goto("/today");
    await hydrated(page);
    const card = page.locator('[data-slot="today-attendance-card"]');
    await expect(card.locator('[data-bucket="waiting"]')).toHaveAttribute("href", "/approvals");
    await card.locator('[data-bucket="not_chosen"]').click();
    await expect(page).toHaveURL(/\/today\/people\?group=not_chosen$/);
    await expect(pageHeader(page)).toContainText("Everyone today");
    await expect(page.locator('[data-slot="people-filter"] [aria-current="page"]')).toHaveText(
      "Not started",
    );
    await expect(
      page.locator('[data-slot="people-board"] h2, [data-slot="people-board-empty"]').first(),
    ).toBeVisible();
  });

  test("yesterday's End day not recorded: the red count from the cutoff, the board with yesterday's state (decision 24, amended)", async ({
    page,
  }, info) => {
    test.skip(info.project.name === "mobile-lg", "the flow runs at 1280 and 375px");
    const crewId = await memberIdOf(crew(info));
    const yesterday = addISTDays(todayIST(), -1);
    await resetAttendanceAndLeave(crewId);
    // Yesterday this project's Crew member started and never ended; the Owner has not decided it.
    await serviceInsert("attendance_days", {
      member_id: crewId,
      work_date: yesterday,
      state: "pending_review",
      submitted_choice: "present",
      submitted_at: istInstant(yesterday, "09:00"),
      started_at: istInstant(yesterday, "09:00"),
      end_not_recorded: true,
    });
    // The count shows from the End-day cutoff (the Owner's setting) through the rest of today;
    // before it yesterday can still be ended. Both sides are the rule, so the check follows the
    // clock it runs at.
    const [settings] = await serviceSelect<{ end_day_cutoff_time: string }>(
      "org_settings?select=end_day_cutoff_time",
    );
    const nowIST = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Kolkata",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    }).format(systemClock());
    const afterCutoff = nowIST >= (settings?.end_day_cutoff_time ?? "05:00:00");
    const row = page.locator('[data-slot="board-row"]').filter({ hasText: crewName(info) });

    await page.goto("/today");
    await hydrated(page);
    const count = page.locator(
      '[data-slot="today-attendance-card"] [data-slot="today-count"][data-bucket="end_not_recorded"]',
    );
    if (afterCutoff) {
      await expect(count).toBeVisible();
      await expect(count.locator('[data-tone="danger"]')).toHaveText(/^[1-9]\d*$/);
      await expect(count).toContainText("End of day not recorded");
      await count.click();
      await expect(page).toHaveURL(/\/today\/people\?group=end_not_recorded$/);
      await expect(page.locator('[data-slot="people-yesterday"]')).toContainText("Yesterday");
      // Yesterday's state: waiting for the Owner, Present, started and no end.
      await expect(row).toContainText("Started 9:00 am");
      await expect(row).toContainText("End not recorded");
      await expect(row).toContainText("Present");
      await expect(
        page.locator('[data-slot="people-board"] section').filter({ has: row }).locator("h2"),
      ).toContainText("Waiting for a decision");
      // Once the Owner decides the day it drops off.
      const [day] = await serviceSelect<{ id: string }>(
        `attendance_days?member_id=eq.${crewId}&work_date=eq.${yesterday}&select=id`,
      );
      await rpcAs(USERS.owner.email, USERS.owner.password, "attendance_decide", {
        day_id: day?.id,
        decision: "approve",
      });
      await page.reload();
      await expect(page.locator('[data-slot="people-filter"]')).toBeVisible();
      await expect(row).toHaveCount(0);
    } else {
      await page.goto("/today/people?group=end_not_recorded");
      await expect(page.locator('[data-slot="people-yesterday"]')).toContainText("Yesterday");
      await expect(row).toHaveCount(0);
    }
    await resetAttendanceAndLeave(crewId);
  });

  test("emails held back today name their limit and open Thresholds (decision 23)", async ({
    page,
  }, info) => {
    test.skip(info.project.name !== "desktop", "one check is enough: the Owner is shared");
    const crewId = await memberIdOf(crew(info));
    const [member] = await serviceSelect<{ org_id: string }>(
      `members?id=eq.${crewId}&select=org_id`,
    );
    const notification = await serviceInsert<{ id: string }>("notifications", {
      org_id: member!.org_id,
      recipient_id: crewId,
      kind: "end_day_reminder",
      title: "Held back for the dashboards spec",
    });
    await serviceInsert("notification_deliveries", {
      notification_id: notification.id,
      channel: "email",
      state: "skipped_cap",
      last_error: "member_cap",
    });
    try {
      await page.goto("/today");
      const row = page.locator('[data-slot="risk-emails-held"]');
      await expect(row).toContainText(/emails? held back today by the daily limit/);
      await expect(row).toContainText("per-person limit, which you can change in Thresholds");
      await expect(row.getByRole("link")).toHaveAttribute("href", "/settings/thresholds");
    } finally {
      await serviceDelete(`notification_deliveries?notification_id=eq.${notification.id}`);
      await serviceDelete(`notifications?id=eq.${notification.id}`);
    }
  });

  test("a Crew member who can't be reached on open work is a risk row (5.4's 48 hours)", async ({
    page,
  }, info) => {
    test.skip(info.project.name === "mobile-lg", "the flow runs at 1280 and 375px");
    const prefix = prefixOf(info);
    const crewId = await memberIdOf(crew(info));
    await adminCreates(info, {
      title: `${prefix}unreachable work`,
      assignees: [crewId],
      due: istInstant(workingDay(5), "18:00"),
    });
    await setReachability(crewId, "no_subscription", 72);
    try {
      await page.goto("/today");
      const row = page.locator('[data-slot="risk-row"]').filter({
        hasText: `${crewName(info)} can't be reached`,
      });
      await expect(row).toHaveCount(1);
      await expect(row.getByRole("link")).toHaveAttribute("href", "/settings/notifications");
    } finally {
      await setReachability(crewId, "no_subscription", 0);
    }
  });

  test("live: a task going overdue elsewhere appears without a reload", async ({ page }, info) => {
    test.skip(info.project.name === "mobile-lg", "the flow runs at 1280 and 375px");
    const prefix = prefixOf(info);
    const crewId = await memberIdOf(crew(info));
    await page.goto("/today");
    await hydrated(page);
    await expect(page.locator("html")).toHaveAttribute("data-live-dashboard", "on");
    await page.evaluate(() => {
      (window as unknown as { stayed?: boolean }).stayed = true;
    });
    const id = await adminCreates(info, {
      title: `${prefix}live overdue`,
      assignees: [crewId],
      due: istInstant(workingDay(5), "18:00"),
    });
    await rpcAs(crew(info), PASSWORD, "task_acknowledge", { task_id: id });
    await moveDue(info, id, istInstant(addISTDays(todayIST(), -1), "18:00"));
    await expect(
      page.locator('[data-slot="risk-row"]').filter({ hasText: `${prefix}live overdue` }),
    ).toHaveCount(1);
    expect(
      await page.evaluate(() => (window as unknown as { stayed?: boolean }).stayed),
      "the page was never reloaded",
    ).toBe(true);
  });

  test("installed: a count → the board → a filter → one back lands on Today", async ({
    page,
  }, info) => {
    test.skip(!isPhone(info), "the installed app is a phone");
    await runInstalled(page);
    await page.goto("/today");
    await hydrated(page);
    await page.locator('[data-slot="today-count"][data-bucket="present"]').click();
    await expect(page).toHaveURL(/\/today\/people\?group=present$/);
    await hydrated(page);
    // A filter is a view control: it replaces the entry.
    await page
      .locator('[data-slot="people-filter"]')
      .getByRole("link", { name: "Everyone" })
      .click();
    await expect(page).toHaveURL(/\/today\/people$/);
    await page.locator('[data-slot="people-filter"]').getByRole("link", { name: "Absent" }).click();
    await expect(page).toHaveURL(/\/today\/people\?group=absent$/);
    await expectBackStack(page, [{ url: /\/today$/ }]);
  });

  test("installed: See all N people → the board → the on-screen back → Today", async ({
    page,
  }, info) => {
    test.skip(!isPhone(info), "the installed app is a phone");
    await runInstalled(page);
    await page.goto("/today");
    await hydrated(page);
    await page.locator('[data-slot="today-see-all-people"] a').click();
    await expect(page).toHaveURL(/\/today\/people$/);
    await hydrated(page);
    await page.locator('[data-slot="page-back"]:visible').click();
    await expect(page).toHaveURL(/\/today$/);
    // The back control went back: nothing of the board is left beneath Today.
    await page.goForward();
    await expect(page).toHaveURL(/\/today\/people$/);
  });

  test("a person's page starts with their today, for the Owner only (decision 7)", async ({
    page,
  }, info) => {
    test.skip(info.project.name === "mobile-lg", "the flow runs at 1280 and 375px");
    const crewId = await memberIdOf(crew(info));
    await page.goto(`/people/${crewId}/leave`);
    const line = page.locator('[data-slot="person-today"]');
    await expect(line).toBeVisible();
    await expect(line).toContainText(/Today|Not expected today/);
    // Above the tabs.
    const tabs = page.locator('[data-slot="person-tabs"]:visible');
    await expect(tabs).toBeVisible();
    const lineBox = await line.boundingBox();
    const tabsBox = await tabs.boundingBox();
    expect(lineBox!.y).toBeLessThan(tabsBox!.y);
  });
});

test.describe("the Admin's Today (6.3)", () => {
  test("strip → Needs you → My tasks → the week → Issues, on the tasks they run", async ({
    page,
  }, info) => {
    test.skip(info.project.name === "mobile-lg", "the flow runs at 1280 and 375px");
    const prefix = prefixOf(info);
    await removeTasksTitled(prefix);
    const crewId = await memberIdOf(crew(info));
    await resetAttendanceAndLeave(crewId);
    const later = istInstant(workingDay(5), "18:00");
    const late = await adminCreates(info, {
      title: `${prefix}admin overdue`,
      assignees: [crewId],
      due: later,
    });
    await rpcAs(crew(info), PASSWORD, "task_acknowledge", { task_id: late });
    await moveDue(info, late, istInstant(addISTDays(todayIST(), -1), "18:00"));
    const quiet = await adminCreates(info, {
      title: `${prefix}admin not noted`,
      assignees: [crewId],
      due: later,
    });
    // Assigned five hours ago, still not noted: past the Admin's escalation time (4 h).
    await serviceUpdate(`task_assignees?task_id=eq.${quiet}`, { assigned_at: hoursAgo(5) });
    // The Crew member is on approved leave on another task's deadline day.
    const leaveDay = workingDay(9);
    await adminCreates(info, {
      title: `${prefix}admin on leave`,
      assignees: [crewId],
      due: istInstant(leaveDay, "18:00"),
    });
    const request = await rpcAs<string>(crew(info), PASSWORD, "leave_submit", {
      type: "leave",
      start_date: leaveDay,
      end_date: leaveDay,
    });
    await rpcAs(USERS.owner.email, USERS.owner.password, "leave_decide", {
      request_id: request,
      decision: "approve",
    });

    await signIn(page, admin(info), PASSWORD);
    await expect(page).toHaveURL(/\/today$/);
    await hydrated(page);
    await expect(page.locator('[data-slot="attendance-strip"]')).toBeVisible();
    const needs = section(page, "today-needs-you");
    await expect(
      needs.locator('[data-slot="task-row"]').filter({ hasText: `${prefix}admin overdue` }),
    ).toContainText("Overdue");
    await expect(
      needs.locator('[data-slot="task-row"]').filter({ hasText: `${prefix}admin not noted` }),
    ).toContainText("hasn't noted it");
    // Issues: the leave on a deadline day, on a task they created.
    const issue = page
      .locator('[data-slot="risk-row"]')
      .filter({ hasText: `${prefix}admin on leave` });
    await expect(issue).toHaveCount(1);
    await expect(issue).toContainText(`${crewName(info)} is on leave`);
    // Never money, never another person's attendance decision on this screen.
    await expect(page.locator("main")).not.toContainText(/₹|Revenue/);
    await resetAttendanceAndLeave(crewId);
  });
});

test.describe("the Admin's work report (6.3)", () => {
  test("the task KPIs split by engagement, the period control and the load list", async ({
    page,
  }, info) => {
    test.skip(info.project.name === "mobile-lg", "the flow runs at 1280 and 375px");
    await signIn(page, admin(info), PASSWORD);
    await page.goto("/reports");
    for (const slot of ["kpi-rework", "kpi-turnaround", "kpi-overdue", "kpi-ack-lag"]) {
      const card = page.locator(`[data-slot="${slot}"]`);
      await expect(card).toBeVisible();
      await expect(card.locator('[data-engagement="permanent"]')).toContainText("Employees");
      await expect(card.locator('[data-engagement="freelance"]')).toContainText("Freelancers");
    }
    await expect(
      page.locator('[data-slot="kpi-rework"] [data-slot="kpi-before"]').first(),
    ).toContainText("Last period");
    await expect(page.locator('[data-slot="kpi-overdue"]')).toHaveAttribute(
      "href",
      "/tasks/all?overdue=overdue",
    );
    await expect(page.locator('[data-slot="report-period-label"]')).toHaveText("This week");
    await expect(page.locator('[data-slot="report-load"]')).toBeVisible();
    // The custom range: two dates and Show.
    await page.locator('[data-slot="report-period"]').getByRole("link", { name: "Custom" }).click();
    await expect(page.locator('[data-slot="custom-range"]')).toBeVisible();
  });

  test("installed: Month, a month back, a week: one back leaves the report", async ({
    page,
  }, info) => {
    test.skip(!isPhone(info), "the installed app is a phone");
    await runInstalled(page);
    await signIn(page, admin(info), PASSWORD);
    await page.goto("/reports");
    await hydrated(page);
    const period = page.locator('[data-slot="report-period"]');
    await period.getByRole("link", { name: "Month" }).click();
    await expect(page).toHaveURL(/period=month/);
    await page.getByRole("link", { name: "Previous month" }).click();
    await expect(page.locator('[data-slot="report-period-label"]')).not.toHaveText("This month");
    await period.getByRole("link", { name: "Week" }).click();
    await expect(page).toHaveURL(/period=week/);
    await expectBackStack(page, [{ url: /\/today$/ }]);
  });
});

test.describe("Realtime holds RLS (Kickoff 6 decision 8)", () => {
  test("Crew hear only their own tasks; an Admin no one else's day or leave", async ({}, info) => {
    test.skip(info.project.name !== "desktop", "one check is enough");
    const prefix = prefixOf(info);
    await removeTasksTitled(`${prefix}rt `);
    const crewId = await memberIdOf(crew(info));
    const adminId = await memberIdOf(admin(info));
    await resetAttendanceAndLeave(crewId);
    await resetAttendanceAndLeave(adminId);
    const { apikey, url } = supabaseAuth();
    const tokenOf = async (email: string) => {
      const answer = await fetch(`${url}/token?grant_type=password`, {
        method: "POST",
        headers: { apikey, "content-type": "application/json" },
        body: JSON.stringify({ email, password: PASSWORD }),
      });
      expect(answer.ok, `sign-in for ${email}`).toBe(true);
      return ((await answer.json()) as { access_token: string }).access_token;
    };
    type Heard = { table: string; row: Record<string, unknown> };
    const listen = async (email: string, tables: string[]) => {
      const token = await tokenOf(email);
      const client = createClient(HOLD_PROXY_URL, apikey, { accessToken: async () => token });
      await client.realtime.setAuth();
      const heard: Heard[] = [];
      let channel = client.channel(`rls-${email}`);
      // Inserts and updates, what the app listens to (a DELETE is not checked against RLS by
      // Realtime and carries the id alone; nothing in these tables is ever deleted outside the
      // local fixtures, invariant 9).
      for (const table of tables) {
        for (const event of ["INSERT", "UPDATE"] as const) {
          channel = channel.on("postgres_changes", { event, schema: "public", table }, (change) =>
            heard.push({ table, row: change.new as Record<string, unknown> }),
          );
        }
      }
      await new Promise<void>((resolve, reject) => {
        channel.subscribe((status) => {
          if (status === "SUBSCRIBED") resolve();
          if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") reject(new Error(status));
        });
      });
      return { client, heard };
    };
    const crewSide = await listen(crew(info), ["tasks"]);
    const adminSide = await listen(admin(info), ["attendance_days", "leave_requests"]);
    try {
      // A task the Crew member is on, and one they are not (the Admin's own).
      const theirs = await adminCreates(info, {
        title: `${prefix}rt theirs`,
        assignees: [crewId],
        due: istInstant(workingDay(5), "18:00"),
      });
      const notTheirs = await adminCreates(info, {
        title: `${prefix}rt not theirs`,
        assignees: [await memberIdOf(USERS.staff.email)],
        due: istInstant(workingDay(5), "18:00"),
      });
      // The Admin's own day and leave, and the Crew member's.
      await rpcAs(admin(info), PASSWORD, "attendance_start_day", {});
      await rpcAs(crew(info), PASSWORD, "attendance_start_day", {});
      const day = workingDay(12);
      await rpcAs(crew(info), PASSWORD, "leave_submit", {
        type: "leave",
        start_date: day,
        end_date: day,
      });
      await rpcAs(admin(info), PASSWORD, "leave_submit", {
        type: "leave",
        start_date: day,
        end_date: day,
      });

      await expect.poll(() => crewSide.heard.map((event) => event.row.id)).toContain(theirs);
      await expect
        .poll(() => adminSide.heard.filter((event) => event.table === "attendance_days").length)
        .toBeGreaterThan(0);
      await expect
        .poll(() => adminSide.heard.filter((event) => event.table === "leave_requests").length)
        .toBeGreaterThan(0);
      // Nothing else arrives late.
      await new Promise((resolve) => setTimeout(resolve, 1_500));
      expect(crewSide.heard.map((event) => event.row.id)).not.toContain(notTheirs);
      expect(
        adminSide.heard.filter((event) => event.row.member_id !== adminId),
        "an Admin hears no one else's attendance or leave",
      ).toEqual([]);
    } finally {
      await crewSide.client.removeAllChannels();
      await adminSide.client.removeAllChannels();
      await resetAttendanceAndLeave(crewId);
      await resetAttendanceAndLeave(adminId);
    }
  });
});
