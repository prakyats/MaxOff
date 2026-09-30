import { type Locator, type Page, type TestInfo } from "@playwright/test";

import { expect, test } from "./fixtures";

import { addISTDays, istInstant, istWeekday, systemClock, todayIST } from "../src/core/time";

import {
  expectBackStack,
  memberIdOf,
  pageHeader,
  removeClientFixture,
  removeTasksTitled,
  rpcAs,
  runInstalled,
  serviceInsert,
  serviceSelect,
  serviceUpdate,
  signIn,
  taskTypeId,
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
    await expect(rowOf(page, `${prefix}late`)).toContainText("Overdue");
    if (dueToday) {
      await expect(section(page, "tasks-group-due_today")).toContainText(`${prefix}today`);
    }
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
    await expect(rowOf(page, `${prefix}overdue`)).toContainText("Past its deadline");
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

    // Approve: the row fades with Undo, and the approval is sent after the Undo window.
    await row("one").getByRole("button", { name: "Approve" }).click();
    await expect(page.getByText(`Checked ${prefix}one: on to the Owner`)).toBeVisible();
    await expect.poll(() => stateOf(ids.one), { timeout: 15_000 }).toBe("admin_approved");

    // Approve all confirms with the count and approves only (decision 5).
    await expect(group.getByRole("button", { name: "Approve all 2" })).toBeVisible();
    await group.getByRole("button", { name: "Approve all 2" }).click();
    const confirm = page.getByRole("alertdialog", { name: "Approve all 2 tasks?" });
    await confirm.getByRole("button", { name: /^Approve 2/ }).click();
    await expect.poll(() => stateOf(ids["all a"])).toBe("admin_approved");
    await expect.poll(() => stateOf(ids["all b"])).toBe("admin_approved");
    await expect(page.getByText("Nothing waiting. You're clear.")).toBeVisible();
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
