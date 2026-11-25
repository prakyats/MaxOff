import { type Locator, type Page, type TestInfo } from "@playwright/test";

import { expect, test } from "./fixtures";

import { addISTDays, istInstant, istWeekday, systemClock, todayIST } from "../src/core/time";

import {
  expectBackStack,
  expectNoHorizontalScroll,
  memberIdOf,
  pageHeader,
  removeClientFixture,
  removeTasksTitled,
  rpcAs,
  runInstalled,
  serviceDelete,
  serviceInsert,
  serviceSelect,
  serviceUpdate,
  signIn,
  taskTypeId,
  USERS,
} from "./helpers";

/**
 * The task lists, 4C (task 4.5; PRODUCT §4.6 "Tasks tab, first glance", §4.7 "Approvals", Kickoff
 * 4 decisions 5, 16, 17, 18; ADR-0013): Staff "My tasks" in its five groups with the Tasks badge,
 * a coordinator's freelancer's task "for Asha"; the Admin's "Needs you" (overdue, not noted past
 * the escalation time, the approvals row), the open tasks and the full list with each filter;
 * the Admin's Approvals group (Approve with Undo, Approve all, a change request with a reason)
 * and the Approvals badge; installed at 375 and 430px, the back order of every new screen, sheet
 * and view control, and the screens at 130% and 200% text.
 *
 * One set of people per project (`list-{staff,coord,admin}-<project>@maxoff.local` and the list
 * coordinator's freelancer, `supabase/seed.sql`). The tests of a project share them, so they run
 * in order, and each one removes the project's tasks first (one title prefix).
 */

test.describe.configure({ mode: "serial" });

const PASSWORD = "list-local-password";
/** A late task's chip, in Today's words (PP-tasks-2): "3 h late", "2 days late". */
const LATE_CHIP = /\d+ (min|h|days?) late/;

const FREELANCER_IDS: Record<string, string> = {
  desktop: "40000000-0000-4000-8000-000000000004",
  mobile: "40000000-0000-4000-8000-000000000005",
  "mobile-lg": "40000000-0000-4000-8000-000000000006",
};

function people(info: TestInfo) {
  const project = info.project.name;
  return {
    staff: { email: `list-staff-${project}@maxoff.local`, name: `Test List Staff (${project})` },
    coord: {
      email: `list-coord-${project}@maxoff.local`,
      name: `Test List Coordinator (${project})`,
    },
    admin: { email: `list-admin-${project}@maxoff.local`, name: `Test List Admin (${project})` },
    freelancer: {
      id: FREELANCER_IDS[project] as string,
      name: `Test List Freelancer (${project})`,
    },
  };
}

function prefixOf(info: TestInfo): string {
  return `List ${info.project.name} `;
}

/** A weekday (Mon–Fri) at least `offset` days from today, IST, never 2 Oct (a seeded holiday). */
function workingDay(offset: number): string {
  let day = addISTDays(todayIST(), offset);
  while (istWeekday(day) === 0 || istWeekday(day) === 6 || day === "2026-10-02") {
    day = addISTDays(day, 1);
  }
  return day;
}

type Created = {
  title: string;
  assignees: string[];
  due: string;
  type?: string;
  clientId?: string;
  more?: Record<string, unknown>;
};

/** `task_create` as an Admin (the task routes to them, kickoff 4 decision 2). */
async function adminCreates(admin: string, args: Created): Promise<string> {
  return rpcAs<string>(admin, PASSWORD, "task_create", {
    title: args.title,
    description: null,
    task_type_id: args.type ?? (await taskTypeId("Normal")),
    client_id: args.clientId ?? null,
    priority: "medium",
    due_at: args.due,
    assignee_ids: args.assignees,
    primary_owner_id: args.assignees[0],
    approving_admin_id: null,
    ...(args.more ?? {}),
  });
}

function rowOf(page: Page, title: string): Locator {
  return page.locator(`[data-slot="task-row"]:visible`).filter({ hasText: title });
}

/** The header's back control (§14.2 k): "Back to Tasks" on a phone, the parent's name above. */
function backControl(page: Page): Locator {
  return page.locator('[data-slot="page-back"]:visible');
}

function section(page: Page, slot: string): Locator {
  return page.locator(`[data-slot="${slot}"]:visible`);
}

function navBadge(page: Page, info: TestInfo, key: string): Locator {
  const nav =
    info.project.name === "desktop"
      ? page.locator(`[data-slot="sidebar"] [data-nav="${key}"]`)
      : page.locator(`[data-slot="bottom-nav"] [data-nav="${key}"]`);
  return nav.locator('[data-slot="nav-badge"]');
}

async function pickFilter(page: Page, id: string, option: string): Promise<void> {
  await page.locator(`[data-filter="${id}"]:visible`).click();
  await page.getByRole("option", { name: option, exact: true }).click();
}

test.describe("the task lists, the flows", () => {
  // The flows prove behaviour, which 55px of width does not change: 1280 and 375px only.
  test.skip(({ viewport }) => viewport?.width === 430, "flows run at 1280 and 375px");

  test("Staff: My tasks in its groups, the Tasks badge, and a row opens the task", async ({
    page,
  }, info) => {
    const prefix = prefixOf(info);
    await removeTasksTitled(prefix);
    const who = people(info);
    const [staffId, adminEmail] = [await memberIdOf(who.staff.email), who.admin.email];
    const later = istInstant(workingDay(30), "18:00");
    const noted = async (taskId: string) =>
      rpcAs(who.staff.email, PASSWORD, "task_acknowledge", { task_id: taskId });

    const notNoted = await adminCreates(adminEmail, {
      title: `${prefix}to note`,
      assignees: [staffId],
      due: later,
    });
    const changes = await adminCreates(adminEmail, {
      title: `${prefix}to fix`,
      assignees: [staffId],
      due: later,
    });
    await rpcAs(who.staff.email, PASSWORD, "task_submit_done", { task_id: changes });
    await rpcAs(adminEmail, PASSWORD, "task_review", {
      task_id: changes,
      decision: "rejected",
      reason: "Brighter colours",
    });
    const upcoming = await adminCreates(adminEmail, {
      title: `${prefix}upcoming`,
      assignees: [staffId],
      due: istInstant(workingDay(31), "18:00"),
    });
    await noted(upcoming);
    const overdue = await adminCreates(adminEmail, {
      title: `${prefix}late`,
      assignees: [staffId],
      due: later,
    });
    await noted(overdue);
    // A later edit may move the deadline anywhere (kickoff 4 decision 4): into the past.
    await rpcAs(adminEmail, PASSWORD, "task_update_assignment", {
      task_id: overdue,
      changes: { due_at: istInstant(addISTDays(todayIST(), -2), "18:00") },
    });
    const reviewing = await adminCreates(adminEmail, {
      title: `${prefix}handed in`,
      assignees: [staffId],
      due: later,
    });
    await rpcAs(who.staff.email, PASSWORD, "task_submit_done", { task_id: reviewing });
    // Due today: only while today still has a deadline ahead (never within a run's last hour).
    const tonight = istInstant(todayIST(), "23:30");
    const dueToday = Date.parse(tonight) - systemClock().getTime() > 3_600_000;
    if (dueToday) {
      const today = await adminCreates(adminEmail, {
        title: `${prefix}today`,
        assignees: [staffId],
        due: tonight,
      });
      await noted(today);
    }

    await signIn(page, who.staff.email, PASSWORD);
    await page.goto("/tasks");
    await expect(pageHeader(page)).toHaveText(/My tasks/);
    await expect(section(page, "tasks-group-not_noted")).toContainText(`${prefix}to note`);
    await expect(section(page, "tasks-group-changes_requested")).toContainText(`${prefix}to fix`);
    await expect(section(page, "tasks-group-upcoming")).toContainText(`${prefix}upcoming`);
    await expect(section(page, "tasks-group-overdue")).toContainText(`${prefix}late`);
    await expect(rowOf(page, `${prefix}late`)).toContainText(LATE_CHIP);
    if (dueToday) {
      await expect(section(page, "tasks-group-due_today")).toContainText(`${prefix}today`);
    }
    // The groups in the owner's order (Kickoff 4 decision 25): Overdue before Due today.
    await expect
      .poll(() =>
        page
          .locator('[data-slot^="tasks-group-"]:visible')
          .evaluateAll((groups) => groups.map((group) => group.getAttribute("data-slot"))),
      )
      .toEqual([
        "tasks-group-not_noted",
        "tasks-group-changes_requested",
        "tasks-group-overdue",
        ...(dueToday ? ["tasks-group-due_today"] : []),
        "tasks-group-upcoming",
      ]);
    // Handed in: one count row into the full list, not a group of rows.
    await expect(rowOf(page, `${prefix}handed in`)).toHaveCount(0);
    await expect(section(page, "tasks-with-reviewers")).toHaveText(/1 task with the reviewers/);
    // The badge (decision 16): not noted + changes requested, each task once.
    await expect(navBadge(page, info, "tasks")).toHaveText(/2/);
    // No New task for Staff; the rows open the task (a drill-down) and back returns.
    await expect(page.getByRole("button", { name: "New task" })).toHaveCount(0);
    await rowOf(page, `${prefix}to note`).click();
    await expect(page).toHaveURL(new RegExp(`/tasks/${notNoted}$`));
    await page.getByRole("button", { name: "Task Noted" }).click();
    await expect(page.getByRole("button", { name: "Task Noted" })).toHaveCount(0);
    await backControl(page).click();
    await expect(page).toHaveURL(/\/tasks$/);
    await expect(section(page, "tasks-group-not_noted")).toHaveCount(0);
    await expect(navBadge(page, info, "tasks")).toHaveText(/1/);
    // The count row opens the full list on its filter.
    await section(page, "tasks-with-reviewers").click();
    await expect(page).toHaveURL(/\/tasks\/all\?state=review$/);
    await expect(pageHeader(page)).toHaveText(/All my tasks/);
    await expect(page.getByText(`${prefix}handed in`).filter({ visible: true })).toHaveCount(1);
    await expect(page.getByText(`${prefix}upcoming`).filter({ visible: true })).toHaveCount(0);
  });

  test("a coordinator's list mixes in their freelancer's task, for them", async ({
    page,
  }, info) => {
    const prefix = prefixOf(info);
    await removeTasksTitled(prefix);
    const who = people(info);
    await adminCreates(who.admin.email, {
      title: `${prefix}freelance edit`,
      assignees: [who.freelancer.id],
      due: istInstant(workingDay(30), "18:00"),
    });
    await signIn(page, who.coord.email, PASSWORD);
    await page.goto("/tasks");
    const row = rowOf(page, `${prefix}freelance edit`);
    await expect(section(page, "tasks-group-not_noted")).toContainText(`${prefix}freelance edit`);
    await expect(row).toContainText(`For ${who.freelancer.name}`);
    await expect(row).toContainText(`${who.freelancer.name} (freelancer)`);
    await expect(navBadge(page, info, "tasks")).toHaveText(/1/);
  });

  test("Upcoming shoots and visits: listed once, soonest first, the Crew their own", async ({
    page,
  }, info) => {
    // v6.5 unit 11 (owner 14 Nov 2026; the approved sample "3"): the open event tasks from today
    // to six days ahead, above the open tasks and left out of them (Q3); the Crew see their own.
    const prefix = prefixOf(info);
    await removeTasksTitled(prefix);
    const who = people(info);
    const [staffId, coordId] = [
      await memberIdOf(who.staff.email),
      await memberIdOf(who.coord.email),
    ];
    const today = todayIST();
    const tomorrow = addISTDays(today, 1);
    const due = istInstant(addISTDays(today, 3), "18:00");
    const shoot = await taskTypeId("Shoot / Site Visit");
    const brand = await adminCreates(who.admin.email, {
      title: `${prefix}brand shoot`,
      assignees: [staffId],
      due,
      type: shoot,
      more: {
        event_date: tomorrow,
        event_start_at: istInstant(tomorrow, "14:00"),
        event_end_at: istInstant(tomorrow, "16:00"),
        location: "Studio",
      },
    });
    await adminCreates(who.admin.email, {
      title: `${prefix}team meeting`,
      assignees: [staffId],
      due,
      type: await taskTypeId("Meeting"),
      more: { event_date: today },
    });
    await adminCreates(who.admin.email, {
      title: `${prefix}cafe visit`,
      assignees: [coordId],
      due,
      type: shoot,
      more: { event_date: tomorrow, location: "Coastal Cafe" },
    });
    await adminCreates(who.admin.email, {
      title: `${prefix}far shoot`,
      assignees: [staffId],
      due: istInstant(workingDay(30), "18:00"),
      type: shoot,
      more: { event_date: workingDay(30) },
    });
    // Noted, so without this section it would sit under the Crew's Upcoming group.
    await rpcAs(who.staff.email, PASSWORD, "task_acknowledge", { task_id: brand });
    const titles = (slot: string) =>
      section(page, slot)
        .locator('[data-slot="task-row-title"]')
        .allInnerTexts()
        .then((texts) => texts.filter((text) => text.startsWith(prefix)));

    await signIn(page, who.admin.email, PASSWORD);
    await page.goto("/tasks");
    const upcoming = section(page, "tasks-upcoming");
    await expect(upcoming).toBeVisible();
    await expect
      .poll(() => titles("tasks-upcoming"))
      .toEqual([`${prefix}team meeting`, `${prefix}cafe visit`, `${prefix}brand shoot`]);
    await expect(rowOf(page, `${prefix}brand shoot`)).toContainText("2:00 pm – 4:00 pm · Studio");
    await expect(rowOf(page, `${prefix}brand shoot`)).toContainText(who.staff.name);
    await expect(rowOf(page, `${prefix}team meeting`)).toContainText("All day");
    // Listed once (Q3): the open tasks keep only the shoot beyond the six days.
    const open = section(page, "tasks-open");
    await expect(open).toContainText(`${prefix}far shoot`);
    await expect(open).not.toContainText(`${prefix}brand shoot`);

    // The Crew: their own shoots and visits only, and not again under Due today or Upcoming.
    await page.context().clearCookies();
    await signIn(page, who.staff.email, PASSWORD);
    await page.goto("/tasks");
    await expect
      .poll(() => titles("tasks-upcoming"))
      .toEqual([`${prefix}team meeting`, `${prefix}brand shoot`]);
    for (const group of ["tasks-group-due_today", "tasks-group-upcoming"]) {
      await expect(
        page.locator(`[data-slot="${group}"]`).filter({ hasText: `${prefix}brand shoot` }),
      ).toHaveCount(0);
    }
    // My Day (Q6): their own event says its time and place in place of the deadline.
    await page.goto("/my-day");
    const meeting = rowOf(page, `${prefix}team meeting`);
    await expect(meeting).toContainText("All day");
    await expect(meeting.locator('[data-slot="task-row-meta"]')).not.toContainText("Due");
    await page.goto("/tasks");
    // A row is a drill-down to the task.
    await rowOf(page, `${prefix}brand shoot`).click();
    await expect(page).toHaveURL(/\/tasks\/[0-9a-f-]{36}$/);
  });

  test("Team today on Today: the counts, a booked line, Show all in place, and Book someone free", async ({
    page,
  }, info) => {
    // v6.5 unit 10 (owner 14 Nov 2026; the approved sample "2"): for the Owner and Admins, from
    // member_availability() only. The whole team is on it, so the test checks the person it books.
    const prefix = prefixOf(info);
    await removeTasksTitled(prefix);
    const who = people(info);
    const today = todayIST();
    await adminCreates(who.admin.email, {
      title: `${prefix}team shoot`,
      assignees: [who.freelancer.id],
      due: istInstant(addISTDays(today, 2), "18:00"),
      type: await taskTypeId("Shoot / Site Visit"),
      more: {
        event_date: today,
        event_start_at: istInstant(today, "14:00"),
        event_end_at: istInstant(today, "16:00"),
      },
    });
    // Noted for the freelancer, so it adds to nobody's badge.
    const [task] = await serviceSelect<{ id: string }>(
      `tasks?title=eq.${encodeURIComponent(`${prefix}team shoot`)}&select=id`,
    );
    await rpcAs(who.coord.email, PASSWORD, "task_acknowledge", {
      task_id: task?.id,
      on_behalf_of: who.freelancer.id,
    });
    const card = page.locator('[data-slot^="team-today"]:visible').first();
    const line = card
      .locator('[data-slot="team-today-line"]')
      .filter({ hasText: `${who.freelancer.name} (freelancer)` });

    await signIn(page, who.admin.email, PASSWORD);
    await page.goto("/today");
    await expect(card.getByRole("heading", { name: "Team today" })).toBeVisible();
    for (const label of ["Free now", "Booked today", "On leave"]) {
      await expect(card.locator('[data-slot="team-today-counts"]')).toContainText(label);
    }
    // Booked first: on a phone the line may sit under "Show all N"; open it in place.
    const more = card.locator('[data-slot="team-today-more"] summary');
    const before = await page.evaluate(() => history.length);
    if (await more.isVisible()) {
      await expect(more.locator("span:visible")).toHaveText(/^Show all \d+$/);
      await more.click();
      await expect(more.locator("span:visible")).toHaveText("Show fewer");
      expect(await page.evaluate(() => history.length)).toBe(before);
      await expect(page).toHaveURL(/\/today$/);
    }
    await expect(line).toContainText("Shoot / Site Visit 2:00 pm – 4:00 pm · you");

    // The Owner reads who booked it.
    await page.context().clearCookies();
    await signIn(page, USERS.owner.email, USERS.owner.password);
    await page.goto("/today");
    if (await more.isVisible()) await more.click();
    await expect(line).toContainText(
      `Shoot / Site Visit 2:00 pm – 4:00 pm · booked by ${who.admin.name}`,
    );
    // "+ Book someone free" opens Calendar → Day for today (Q5's alternative, a drill-down).
    await card.locator('[data-slot="team-today-book"]').click();
    await expect(page).toHaveURL(new RegExp(`/calendar\\?view=day&date=${today}$`));
    await removeTasksTitled(prefix);
  });

  test("People for an Admin: Today and Next booked; the Owner's People unchanged", async ({
    page,
  }, info) => {
    // v6.5 unit 13 (owner 14 Nov 2026; the sample "4"): an Admin's People gains Today (what each
    // person is on) and Next booked (the first booking after today, within 30 days).
    const prefix = prefixOf(info);
    await removeTasksTitled(prefix);
    const who = people(info);
    const today = todayIST();
    const later = addISTDays(today, 3);
    await adminCreates(who.admin.email, {
      title: `${prefix}people shoot`,
      assignees: [who.freelancer.id],
      due: istInstant(addISTDays(today, 5), "18:00"),
      type: await taskTypeId("Shoot / Site Visit"),
      more: {
        event_date: today,
        event_start_at: istInstant(today, "14:00"),
        event_end_at: istInstant(today, "16:00"),
      },
    });
    await adminCreates(who.admin.email, {
      title: `${prefix}people meeting`,
      assignees: [who.freelancer.id],
      due: istInstant(addISTDays(today, 5), "18:00"),
      type: await taskTypeId("Meeting"),
      more: { event_date: later, event_start_at: istInstant(later, "10:00") },
    });
    // The coordinator on a day's approved leave today: "On leave · back ‹day›" (the sample "4").
    const coordId = await memberIdOf(who.coord.email);
    await serviceDelete(`leave_requests?member_id=eq.${coordId}&start_date=eq.${today}`);
    await serviceInsert("leave_requests", {
      member_id: coordId,
      type: "leave",
      start_date: today,
      end_date: today,
      state: "approved",
      source: "owner",
      decided_by: await memberIdOf(USERS.owner.email),
      decided_at: systemClock().toISOString(),
    });
    const rowOfName = (name: string) =>
      page
        .locator('tr:visible, [data-slot="data-card"]:visible, li:visible')
        .filter({ hasText: name })
        .first();
    const row = rowOfName(who.freelancer.name);

    await signIn(page, who.admin.email, PASSWORD);
    await page.goto("/people");
    await expect(page.locator('[data-slot="next-booked"]:visible').first()).toBeVisible();
    // A phone lists ten cards at a time: "Show more" until the person is there.
    const showMore = page.locator('[data-slot="data-cards-more"]:visible');
    while ((await row.count()) === 0 && (await showMore.isVisible())) await showMore.click();
    await expect(row).toContainText("Shoot / Site Visit 2:00 pm – 4:00 pm · you");
    const coordRow = rowOfName(who.coord.name);
    while ((await coordRow.count()) === 0 && (await showMore.isVisible())) await showMore.click();
    await expect(coordRow).toContainText(/On leave · back \w{3} \d{1,2}/);
    await expect(row.locator('[data-slot="next-booked"]')).toContainText(
      /^(Next: )?\w{3} \d{1,2} · Meeting 10:00 am · you$/,
    );
    await expectNoHorizontalScroll(page);

    // The Owner's People page has neither column.
    await page.context().clearCookies();
    await signIn(page, USERS.owner.email, USERS.owner.password);
    await page.goto("/people");
    await expect(page.locator('[data-slot="next-booked"]')).toHaveCount(0);
    await expect(page.getByRole("columnheader", { name: "Next booked" })).toHaveCount(0);
    await removeTasksTitled(prefix);
    await serviceDelete(`leave_requests?member_id=eq.${coordId}&start_date=eq.${today}`);
  });

  test("an Admin: Needs you, the open tasks, the approvals row and every filter of the full list", async ({
    page,
  }, info) => {
    const prefix = prefixOf(info);
    await removeTasksTitled(prefix);
    const who = people(info);
    const clientName = `List client ${info.project.name}`;
    await removeClientFixture(clientName);
    const [staffId, adminId] = await Promise.all([
      memberIdOf(who.staff.email),
      memberIdOf(who.admin.email),
    ]);
    const [org] = await serviceSelect<{ id: string }>("organizations?select=id&limit=1");
    const client = await serviceInsert<{ id: string }>("clients", {
      org_id: org?.id,
      name: clientName,
      admin_id: adminId,
      state: "active",
      activated_at: systemClock().toISOString(),
    });
    const later = istInstant(workingDay(32), "18:00");
    const admin = who.admin.email;

    const late = await adminCreates(admin, {
      title: `${prefix}overdue`,
      assignees: [staffId],
      due: later,
    });
    await rpcAs(who.staff.email, PASSWORD, "task_acknowledge", { task_id: late });
    await rpcAs(admin, PASSWORD, "task_update_assignment", {
      task_id: late,
      changes: { due_at: istInstant(addISTDays(todayIST(), -1), "18:00") },
    });
    const quiet = await adminCreates(admin, {
      title: `${prefix}quiet`,
      assignees: [staffId],
      due: later,
    });
    // Assigned five hours ago, still not noted: past the Admin's escalation time (4 h).
    await serviceUpdate(`task_assignees?task_id=eq.${quiet}`, {
      assigned_at: new Date(systemClock().getTime() - 5 * 3_600_000).toISOString(),
    });
    const meeting = await adminCreates(admin, {
      title: `${prefix}meeting`,
      assignees: [staffId],
      due: later,
      type: await taskTypeId("Meeting"),
      more: { event_date: workingDay(32) },
    });
    await rpcAs(who.staff.email, PASSWORD, "task_acknowledge", { task_id: meeting });
    const handed = await adminCreates(admin, {
      title: `${prefix}to check`,
      assignees: [staffId],
      due: later,
    });
    await rpcAs(who.staff.email, PASSWORD, "task_submit_done", { task_id: handed, note: "Done" });
    await adminCreates(admin, {
      title: `${prefix}freelance`,
      assignees: [who.freelancer.id],
      due: later,
    });
    await rpcAs(who.coord.email, PASSWORD, "task_acknowledge", {
      task_id: (
        await serviceSelect<{ id: string }>(
          `tasks?title=eq.${encodeURIComponent(`${prefix}freelance`)}&select=id`,
        )
      )[0]?.id,
      on_behalf_of: who.freelancer.id,
    });
    const labelled = await adminCreates(admin, {
      title: `${prefix}labelled`,
      assignees: [staffId],
      due: later,
      clientId: client.id,
    });
    await rpcAs(who.staff.email, PASSWORD, "task_acknowledge", { task_id: labelled });

    await signIn(page, admin, PASSWORD);
    await page.goto("/tasks");
    await expect(pageHeader(page)).toHaveText(/Tasks/);
    const needs = section(page, "tasks-needs-you");
    await expect(needs).toContainText(`${prefix}overdue`);
    // W5 (V3): the Overdue chip alone says it; the row no longer repeats "Past its deadline".
    await expect(rowOf(page, `${prefix}overdue`)).toContainText(LATE_CHIP);
    await expect(rowOf(page, `${prefix}overdue`)).not.toContainText("Past its deadline");
    await expect(rowOf(page, `${prefix}quiet`)).toContainText(
      `${who.staff.name} hasn't noted it · 5 h`,
    );
    await expect(section(page, "tasks-to-approve")).toHaveText(/1 task waiting for your approval/);
    const open = section(page, "tasks-open");
    for (const title of ["meeting", "to check", "freelance", "labelled"]) {
      await expect(open).toContainText(`${prefix}${title}`);
    }
    // Listed once: a task under Needs you is not repeated among the open tasks.
    await expect(open).not.toContainText(`${prefix}overdue`);
    // The Approvals badge carries the task waiting for the Admin's check (decision 16).
    await expect(navBadge(page, info, "approvals")).toHaveText(/1/);

    // The full list, one tap deeper, with each filter (view controls: the URL is replaced).
    await section(page, "tasks-see-all").click();
    await expect(page).toHaveURL(/\/tasks\/all$/);
    await expect(pageHeader(page)).toHaveText(/All tasks/);
    const visibleTitles = async () =>
      (await page.getByRole("link").filter({ hasText: prefix }).allInnerTexts())
        .map((text) => text.split("\n")[0]?.replace(prefix, "").trim())
        .filter(Boolean)
        .sort();
    await expect
      .poll(visibleTitles)
      .toEqual(["freelance", "labelled", "meeting", "overdue", "quiet", "to check"].sort());
    await pickFilter(page, "state", "With the reviewers");
    await expect(page).toHaveURL(/\/tasks\/all\?state=review$/);
    await expect.poll(visibleTitles).toEqual(["to check"]);
    await pickFilter(page, "state", "Open");
    await pickFilter(page, "overdue", "Overdue");
    await expect.poll(visibleTitles).toEqual(["overdue"]);
    await pickFilter(page, "overdue", "Any deadline");
    await pickFilter(page, "person", who.freelancer.name);
    await expect.poll(visibleTitles).toEqual(["freelance"]);
    await pickFilter(page, "person", "Anyone");
    await pickFilter(page, "client", clientName);
    await expect.poll(visibleTitles).toEqual(["labelled"]);
    await pickFilter(page, "client", "Any client");
    await pickFilter(page, "type", "Meeting");
    await expect.poll(visibleTitles).toEqual(["meeting"]);
    await pickFilter(page, "type", "Any type");
    await pickFilter(page, "engagement", "Freelancers");
    await expect.poll(visibleTitles).toEqual(["freelance"]);
    await pickFilter(page, "engagement", "Employees and freelancers");
    await expect(page).toHaveURL(/\/tasks\/all$/);
    await backControl(page).click();
    await expect(page).toHaveURL(/\/tasks$/);

    // The approvals row opens Approvals, where the task waits for the Admin's check.
    await section(page, "tasks-to-approve").click();
    await expect(page).toHaveURL(/\/approvals$/);
    await expect(page.locator('[data-slot="approval-group"][data-group="tasks"]')).toContainText(
      `${prefix}to check`,
    );
  });

  test("an Admin's Approvals: Approve with Undo, Approve all, and a change request with a reason", async ({
    page,
  }, info) => {
    const prefix = prefixOf(info);
    await removeTasksTitled(prefix);
    const who = people(info);
    const staffId = await memberIdOf(who.staff.email);
    const due = istInstant(workingDay(33), "18:00");
    const ids: Record<string, string> = {};
    for (const name of ["fix", "one", "all a", "all b"]) {
      const id = await adminCreates(who.admin.email, {
        title: `${prefix}${name}`,
        assignees: [staffId],
        due,
      });
      await rpcAs(who.staff.email, PASSWORD, "task_submit_done", {
        task_id: id,
        note: `Cut: https://drive.example/${name.replace(" ", "-")}`,
      });
      ids[name] = id;
    }
    const stateOf = async (id: string | undefined) =>
      (await serviceSelect<{ state: string }>(`tasks?id=eq.${id}&select=state`))[0]?.state;

    await signIn(page, who.admin.email, PASSWORD);
    await page.goto("/approvals");
    const group = page.locator('[data-slot="approval-group"][data-group="tasks"]');
    await expect(group.locator('[data-slot="approval-count"]')).toHaveText("4");
    await expect(navBadge(page, info, "approvals")).toHaveText(/4/);

    // Review → the hand-in's link, then Request changes with a reason (one task, a reason).
    const row = (name: string) =>
      group.locator('[data-slot="approval-row"]').filter({ hasText: `${prefix}${name}` });
    await row("fix").getByRole("button", { name: "Review" }).click();
    const sheet = page.locator('[data-slot="review-sheet"]');
    await expect(sheet.getByRole("link", { name: "https://drive.example/fix" })).toBeVisible();
    await sheet.getByRole("button", { name: "Request changes…" }).click();
    const reason = page.getByRole("dialog", { name: /Request changes to/ });
    await reason.getByLabel("What needs to change").fill("The intro is too long");
    await reason.getByRole("button", { name: "Request changes" }).click();
    await expect(reason).toBeHidden();
    await expect.poll(() => stateOf(ids.fix)).toBe("changes_requested");
    await expect(row("fix")).toHaveCount(0);

    // Approve: the row fades with Undo. The send waits out the Undo window, or goes at once when
    // the app goes to the background (2.4's delayed send, as owner-review.spec proves): the spec
    // sends it that way instead of waiting on the clock (4C review S4).
    await row("one").getByRole("button", { name: "Approve" }).click();
    await expect(page.getByText(`Checked ${prefix}one: on to the Owner`)).toBeVisible();
    await page.evaluate(() => {
      Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await expect.poll(() => stateOf(ids.one)).toBe("admin_approved");
    await page.evaluate(() => {
      Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
      document.dispatchEvent(new Event("visibilitychange"));
    });

    // Approve all confirms with the count and approves only (decision 5).
    await expect(group.getByRole("button", { name: "Approve all 2" })).toBeVisible();
    await group.getByRole("button", { name: "Approve all 2" }).click();
    const confirm = page.getByRole("alertdialog", { name: "Approve all 2 tasks?" });
    await confirm.getByRole("button", { name: /^Approve 2/ }).click();
    await expect.poll(() => stateOf(ids["all a"])).toBe("admin_approved");
    await expect.poll(() => stateOf(ids["all b"])).toBe("admin_approved");
    await expect(page.getByText("Nothing waiting. You're clear.")).toBeVisible();
    // PP-admin-2: the Admin's empty state opens the tasks with the reviewers.
    const toCheck = page.getByRole("link", { name: "Tasks to check" });
    await expect(toCheck).toHaveAttribute("href", "/tasks/all?state=review");
    await toCheck.click();
    await expect(page).toHaveURL(/\/tasks\/all\?state=review$/);
  });
});

test.describe("the task lists, installed: back and large text", () => {
  test.skip(({ viewport }) => (viewport?.width ?? 1280) >= 768, "the installed app is a phone");

  test("Tasks: a row and the full list are drill-downs; a filter replaces; back goes home", async ({
    page,
  }, info) => {
    const prefix = prefixOf(info);
    await removeTasksTitled(prefix);
    const who = people(info);
    const staffId = await memberIdOf(who.staff.email);
    const taskId = await adminCreates(who.admin.email, {
      title: `${prefix}layers`,
      assignees: [staffId],
      due: istInstant(workingDay(34), "18:00"),
    });
    await runInstalled(page);
    await signIn(page, who.admin.email, PASSWORD);
    await expect(page).toHaveURL(/\/today$/);
    await page.locator('[data-slot="bottom-nav"] [data-nav="tasks"]').click();
    await expect(page).toHaveURL(/\/tasks$/);

    await rowOf(page, `${prefix}layers`).click();
    await expect(page).toHaveURL(new RegExp(`/tasks/${taskId}$`));
    await expectBackStack(page, [{ url: /\/tasks$/ }]);

    await section(page, "tasks-see-all").click();
    await expect(page).toHaveURL(/\/tasks\/all$/);
    await pickFilter(page, "state", "Any state");
    await expect(page).toHaveURL(/\/tasks\/all\?state=all$/);
    await pickFilter(page, "overdue", "Overdue");
    await expect(page).toHaveURL(/\/tasks\/all\?state=all&overdue=overdue$/);
    // The filters' select sheets and the view changes add nothing: one back leaves the list.
    await expectBackStack(page, [{ url: /\/tasks$/ }, { url: /\/today$/ }]);
  });

  test("Team today: Show all opens in place; Calendar and Book someone free are drill-downs", async ({
    page,
  }, info) => {
    // v6.5 unit 10 (ARCHITECTURE §14.2): the disclosure is a view control and adds no history.
    const who = people(info);
    await runInstalled(page);
    await signIn(page, who.admin.email, PASSWORD);
    await expect(page).toHaveURL(/\/today$/);
    const card = page.locator('[data-slot="team-today-narrow"]');
    await expect(card).toBeVisible();
    const more = card.locator('[data-slot="team-today-more"] summary');
    const before = await page.evaluate(() => history.length);
    if (await more.isVisible()) {
      await more.click();
      await expect(more.locator("span:visible")).toHaveText("Show fewer");
      expect(await page.evaluate(() => history.length)).toBe(before);
    }
    await card.locator('[data-slot="team-today-book"]').click();
    await expect(page).toHaveURL(/\/calendar\?view=day&date=/);
    // One back returns to Today: Calendar → Day is the one step Show all and the card added.
    await expectBackStack(page, [{ url: /\/today$/ }]);
  });

  test("Staff: the reviewers' count row and All my tasks are drill-downs; back goes to My Day", async ({
    page,
  }, info) => {
    const prefix = prefixOf(info);
    await removeTasksTitled(prefix);
    const who = people(info);
    const staffId = await memberIdOf(who.staff.email);
    const handed = await adminCreates(who.admin.email, {
      title: `${prefix}with the reviewers`,
      assignees: [staffId],
      due: istInstant(workingDay(34), "18:00"),
    });
    await rpcAs(who.staff.email, PASSWORD, "task_submit_done", { task_id: handed });
    await runInstalled(page);
    await signIn(page, who.staff.email, PASSWORD);
    await expect(page).toHaveURL(/\/my-day$/);
    await page.locator('[data-slot="bottom-nav"] [data-nav="tasks"]').click();
    const tasks = /\/tasks$/;
    await expect(page).toHaveURL(tasks);

    // The count row opens the full list on its filter: a drill-down, back returns to My tasks.
    await section(page, "tasks-with-reviewers").click();
    await expect(page).toHaveURL(/\/tasks\/all\?state=review$/);
    await expect(pageHeader(page)).toHaveText(/All my tasks/);
    await expectBackStack(page, [{ url: tasks }]);

    await section(page, "tasks-see-all").click();
    await expect(page).toHaveURL(/\/tasks\/all$/);
    await pickFilter(page, "state", "With the reviewers");
    await expect(page).toHaveURL(/\/tasks\/all\?state=review$/);
    await expectBackStack(page, [{ url: tasks }, { url: /\/my-day$/ }]);
  });

  test("Approvals: the task's Review sheet, its reason dialog and Approve all's question close on back", async ({
    page,
  }, info) => {
    const prefix = prefixOf(info);
    await removeTasksTitled(prefix);
    const who = people(info);
    const staffId = await memberIdOf(who.staff.email);
    for (const name of ["a", "b"]) {
      const id = await adminCreates(who.admin.email, {
        title: `${prefix}back ${name}`,
        assignees: [staffId],
        due: istInstant(workingDay(35), "18:00"),
      });
      await rpcAs(who.staff.email, PASSWORD, "task_submit_done", { task_id: id });
    }
    await runInstalled(page);
    await signIn(page, who.admin.email, PASSWORD);
    await page.goto("/approvals");
    const url = /\/approvals$/;
    const group = page.locator('[data-slot="approval-group"][data-group="tasks"]');

    await group.getByRole("button", { name: "Review" }).first().click();
    const sheet = page.locator('[data-slot="review-sheet"]');
    await expect(sheet).toBeVisible();
    await sheet.getByRole("button", { name: "Request changes…" }).click();
    const reason = page.getByRole("dialog", { name: /Request changes to/ });
    await expect(reason).toBeVisible();
    await expectBackStack(page, [
      { closes: reason, url },
      { closes: sheet, url },
    ]);

    await group.getByRole("button", { name: "Approve all 2" }).click();
    const confirm = page.getByRole("alertdialog", { name: "Approve all 2 tasks?" });
    await expect(confirm).toBeVisible();
    await expectBackStack(page, [{ closes: confirm, url }]);
    await expect(group.locator('[data-slot="approval-count"]')).toHaveText("2");
  });

  test("a row with two long chips keeps › on its title line, its chips on one line and its due time whole", async ({
    page,
  }, info) => {
    // The v1.8 design gate's follow-up (23 Oct): at 375 and 430 the chips cut the due time, a
    // chip's word wrapped and › dropped to a line of its own. The one row anatomy (`ListRow`).
    const prefix = prefixOf(info);
    await removeTasksTitled(prefix);
    const who = people(info);
    const staffId = await memberIdOf(who.staff.email);
    const title = `${prefix}handed in late, with a title long enough to be cut on a phone`;
    const late = await adminCreates(who.admin.email, {
      title,
      assignees: [staffId],
      due: istInstant(workingDay(30), "18:00"),
    });
    await rpcAs(who.staff.email, PASSWORD, "task_acknowledge", { task_id: late });
    await rpcAs(who.admin.email, PASSWORD, "task_update_assignment", {
      task_id: late,
      changes: { due_at: istInstant(addISTDays(todayIST(), -1), "18:00") },
    });
    await rpcAs(who.staff.email, PASSWORD, "task_submit_done", {
      task_id: late,
      note: "Done",
      late_reason: "Waited for the files",
    });
    await signIn(page, who.admin.email, PASSWORD);
    await page.goto("/tasks");
    const row = rowOf(page, title).first();
    await expect(row).toBeVisible();
    await expect(row.locator('[data-slot="badge"]')).toHaveCount(2);

    const geometry = await row.evaluate((li) => {
      const edges = (el: Element | null) => {
        const rect = el?.getBoundingClientRect();
        return rect ? { top: rect.top, bottom: rect.bottom } : null;
      };
      const meta = li.querySelector<HTMLElement>('[data-slot="task-row-meta"]');
      const text = meta?.firstChild ?? null;
      // The due time is the meta line's first part: "Due Mon 26 Oct, 6:00 pm".
      const due = (text?.textContent ?? "").split(" · ")[0] ?? "";
      const range = document.createRange();
      if (text) {
        range.setStart(text, 0);
        range.setEnd(text, due.length);
      }
      return {
        title: edges(li.querySelector('[data-slot="list-row-title"]')),
        open: edges(li.querySelector('[data-slot="list-row-open"]')),
        chips: [...li.querySelectorAll('[data-slot="badge"]')].map((el) => edges(el)),
        labelLines: [...li.querySelectorAll('[data-slot="status-badge-label"]')].map(
          (el) => new Set([...el.getClientRects()].map((rect) => Math.round(rect.top))).size,
        ),
        due,
        dueRight: range.getBoundingClientRect().right,
        metaRight: meta?.getBoundingClientRect().right ?? 0,
        metaTop: meta?.getBoundingClientRect().top ?? 0,
      };
    });
    const titleLine = geometry.title;
    const open = geometry.open;
    expect(titleLine, "the title").not.toBeNull();
    expect(open, "the ›").not.toBeNull();
    if (!titleLine || !open) return;
    const centre = (open.top + open.bottom) / 2;
    expect(centre, "› sits on the title's line").toBeGreaterThanOrEqual(titleLine.top);
    expect(centre, "› sits on the title's line").toBeLessThanOrEqual(titleLine.bottom);
    const [first, second] = geometry.chips;
    expect(
      Math.abs((first?.top ?? 0) - (second?.top ?? Number.NaN)),
      "the chips share one line",
    ).toBeLessThan(1);
    expect(geometry.labelLines, "each chip's word is one line").toEqual([1, 1]);
    for (const chip of geometry.chips) {
      expect(chip?.bottom ?? Infinity, "the chips sit above the meta line").toBeLessThanOrEqual(
        geometry.metaTop + 1,
      );
    }
    expect(geometry.due).toMatch(/^Due .*\d:\d\d [ap]m$/);
    expect(geometry.dueRight, `"${geometry.due}" is whole`).toBeLessThanOrEqual(
      geometry.metaRight + 0.5,
    );

    // The whole row opens, chips included (X3 (d)): a status chip is positioned (its dot), and
    // painted above the row's stretched link it took the tap, which then did nothing.
    const chipHits = await row.evaluate((li) =>
      [...li.querySelectorAll<HTMLElement>('[data-slot="badge"]')].flatMap((chip) => {
        const rect = chip.getBoundingClientRect();
        return [0.15, 0.5, 0.85].map((x) => {
          const hit = document.elementFromPoint(
            rect.left + rect.width * x,
            rect.top + rect.height / 2,
          );
          return hit?.closest('[data-slot="list-row-opener"]')
            ? "row"
            : (hit?.getAttribute("data-slot") ?? hit?.tagName ?? "nothing");
        });
      }),
    );
    expect(chipHits.length, "the row has chips to tap (not vacuous)").toBeGreaterThan(0);
    expect(chipHits, "a tap on a chip lands on the row").toEqual(chipHits.map(() => "row"));
    // A tap where the first chip's dot is: the point, not the element (the row's link is on top).
    const dot = await row.locator('[data-slot="status-badge-dot"]').first().boundingBox();
    expect(dot, "the chip's dot").not.toBeNull();
    await page.mouse.click(dot!.x + dot!.width / 2, dot!.y + dot!.height / 2);
    await expect(page).toHaveURL(new RegExp(`/tasks/${late}$`));
  });

  test("Tasks, the full list and Approvals fit at 130% and 200% text", async ({ page }, info) => {
    const prefix = prefixOf(info);
    await removeTasksTitled(prefix);
    const who = people(info);
    const staffId = await memberIdOf(who.staff.email);
    const id = await adminCreates(who.admin.email, {
      title: `${prefix}a long task title that has to wrap on a small phone, twice over`,
      assignees: [who.freelancer.id, staffId],
      due: istInstant(workingDay(36), "18:00"),
    });
    await adminCreates(who.admin.email, {
      title: `${prefix}handed in, with a title long enough to wrap`,
      assignees: [staffId],
      due: istInstant(workingDay(36), "18:00"),
    }).then((handed) => rpcAs(who.staff.email, PASSWORD, "task_submit_done", { task_id: handed }));
    await serviceUpdate(`task_assignees?task_id=eq.${id}`, {
      assigned_at: new Date(systemClock().getTime() - 30 * 3_600_000).toISOString(),
    });
    for (const [email, paths] of [
      [who.admin.email, ["/tasks", "/tasks/all", "/approvals"]],
      [who.coord.email, ["/tasks", "/tasks/all"]],
    ] as const) {
      await signIn(page, email, PASSWORD);
      for (const path of paths) {
        await page.goto(path);
        await expect(page.locator('[data-slot="skeleton"]')).toHaveCount(0);
        for (const scale of [130, 200]) {
          await page.evaluate((percent) => {
            document.documentElement.style.fontSize = `${percent}%`;
          }, scale);
          await expectFits(page);
        }
        await page.evaluate(() => {
          document.documentElement.style.fontSize = "";
        });
      }
      await page.context().clearCookies();
    }
  });
});

async function expectFits(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
    wide: [...document.querySelectorAll<HTMLElement>("body *")]
      .filter((el) => el.getBoundingClientRect().right > document.documentElement.clientWidth + 1)
      .slice(0, 5)
      .map((el) => `${el.tagName.toLowerCase()}${el.dataset.slot ? `[${el.dataset.slot}]` : ""}`),
  }));
  expect(overflow.wide, "nothing reaches past the right edge").toEqual([]);
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth);
}
