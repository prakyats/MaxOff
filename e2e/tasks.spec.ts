import { type Locator, type Page, type TestInfo } from "@playwright/test";

import { expect, test } from "./fixtures";

import { addISTDays, istInstant, istWeekday, todayIST } from "../src/core/time";

import {
  expectBackStack,
  memberIdOf,
  pageHeader,
  removeFieldDefinitions,
  removeTasksTitled,
  resetAttendanceAndLeave,
  rpcAs,
  runInstalled,
  serviceSelect,
  signIn,
  storageStateFor,
  taskTypeId,
  USERS,
} from "./helpers";

/**
 * Staff tasks, 4B (tasks 4.3 and 4.4; PRODUCT §4.6, WORKFLOWS §3, ADR-0013): the create dialog
 * with its warnings (workload, overlap, leave) kept and recorded; the task page's route from
 * "Task Noted" to the Owner's approval, a freelancer's coordinator acting for them ("for Asha"),
 * Done with a link and, past the deadline, a late reason; a change request and the resubmit; an
 * Admin's task routing to them; the Owner's edit, cancel and reopen; Staff kept out; and, installed
 * at 375 and 430px, the back order of every layer and the screens at large text.
 *
 * One set of people per project (`task-<kind>-<project>@maxoff.local` and a freelancer coordinated
 * by `task-coord-…`, `supabase/seed.sql`). Each test names its tasks with its own prefix and
 * removes them first, and each uses its own IST day, so the tests run in parallel and re-run
 * without `pnpm db:reset`.
 */

const PASSWORD = "task-local-password";
const LABELS = {
  staff: "Staff",
  helper: "Helper",
  away: "Away",
  coord: "Coordinator",
  admin: "Admin",
} as const;
type Kind = keyof typeof LABELS;

const FREELANCER_IDS: Record<string, string> = {
  desktop: "30000000-0000-4000-8000-000000000001",
  mobile: "30000000-0000-4000-8000-000000000002",
  "mobile-lg": "30000000-0000-4000-8000-000000000003",
};

function person(kind: Kind, info: TestInfo) {
  return {
    email: `task-${kind}-${info.project.name}@maxoff.local`,
    name: `Test Task ${LABELS[kind]} (${info.project.name})`,
  };
}

function freelancer(info: TestInfo) {
  return {
    id: FREELANCER_IDS[info.project.name] as string,
    name: `Test Task Freelancer (${info.project.name})`,
  };
}

/** A weekday (Mon–Fri) at least `offset` days from today, IST: a day anyone can take leave. */
function workingDay(offset: number): string {
  let day = addISTDays(todayIST(), offset);
  while (istWeekday(day) === 0 || istWeekday(day) === 6 || day === "2026-10-02") {
    day = addISTDays(day, 1);
  }
  return day;
}

type TaskArgs = {
  title: string;
  assignees: string[];
  primary: string;
  due: string;
  approver?: string | null;
  type?: string;
  stages?: string[];
  event?: { date: string; start: string; end: string };
};

/** Arranges a task through `task_create` as the Owner (what the spec is not about). */
async function ownerCreates(args: TaskArgs): Promise<string> {
  return rpcAs<string>(USERS.owner.email, USERS.owner.password, "task_create", {
    title: args.title,
    description: null,
    task_type_id: args.type ?? (await taskTypeId("Normal")),
    client_id: null,
    priority: "medium",
    due_at: args.due,
    assignee_ids: args.assignees,
    primary_owner_id: args.primary,
    approving_admin_id: args.approver ?? null,
    stages: args.stages ?? [],
    ...(args.event
      ? {
          event_date: args.event.date,
          event_start_at: istInstant(args.event.date, args.event.start),
          event_end_at: istInstant(args.event.date, args.event.end),
        }
      : {}),
  });
}

function summary(page: Page): Locator {
  return page.locator('[data-slot="task-summary"]');
}

function historyRows(page: Page): Locator {
  return page.locator('[data-slot="task-history-row"]');
}

function formDialog(page: Page): Locator {
  return page.locator('[data-slot="task-form-dialog"]');
}

async function pick(page: Page, trigger: Locator, option: string | RegExp): Promise<void> {
  await trigger.click();
  await page.getByRole("option", { name: option }).first().click();
}

const TASK_URL = /\/tasks\/[0-9a-f-]{36}$/;

test.describe("staff tasks, the flows", () => {
  // The flows prove behaviour, which 55px of width does not change: 1280 and 375px only.
  test.skip(({ viewport }) => viewport?.width === 430, "flows run at 1280 and 375px");

  test.describe("as the Owner", () => {
    test.use({ storageState: storageStateFor("owner") });

    test("creates a task with each warning kind kept, and the overrides are recorded", async ({
      page,
    }, info) => {
      const prefix = `Warn ${info.project.name} `;
      await removeTasksTitled(prefix);
      const helper = person("helper", info);
      const staff = person("staff", info);
      const away = person("away", info);
      const [helperId, staffId, awayId] = await Promise.all([
        memberIdOf(helper.email),
        memberIdOf(staff.email),
        memberIdOf(away.email),
      ]);
      await resetAttendanceAndLeave(awayId);
      const day = workingDay(15);
      // Four open tasks due that day (the threshold, kickoff 4 decision 11), a shoot 10–12, and a
      // pending leave request (decision 13: "Leave requested").
      for (const n of [1, 2, 3, 4]) {
        await ownerCreates({
          title: `${prefix}load ${n}`,
          assignees: [helperId],
          primary: helperId,
          due: istInstant(day, "17:00"),
        });
      }
      await ownerCreates({
        title: `${prefix}shoot`,
        assignees: [staffId],
        primary: staffId,
        due: istInstant(day, "18:00"),
        type: await taskTypeId("Shoot / Site Visit"),
        event: { date: day, start: "10:00", end: "12:00" },
      });
      await rpcAs(away.email, PASSWORD, "leave_submit", {
        type: "leave",
        start_date: day,
        end_date: day,
      });

      await page.goto("/tasks");
      await page.getByRole("button", { name: "New task" }).click();
      const dialog = formDialog(page);
      await expect(dialog).toBeVisible();

      // Nothing filled in: a message per field, nothing sent.
      await dialog.getByRole("button", { name: "Create task" }).click();
      await expect(dialog).toContainText("Give the task a title.");
      await expect(dialog).toContainText("Assign at least one person.");
      await expect(dialog).toContainText("Pick the deadline's date.");

      await dialog.getByLabel("Title").fill(`${prefix}main`);
      await pick(page, dialog.getByLabel("Type"), "Shoot / Site Visit");
      await dialog.getByLabel("Event date").fill(day);
      await dialog.getByLabel("Starts").fill("11:00");
      for (const one of [helper, staff, away]) {
        await pick(page, dialog.getByLabel("Add a person"), new RegExp(`^${escape(one.name)}`));
      }
      // The Owner is never offered (kickoff 4 decision 1).
      await dialog.getByLabel("Add a person").click();
      await expect(page.getByRole("option", { name: /Prishit Shetty/ })).toHaveCount(0);
      await page.keyboard.press("Escape");
      await dialog.getByLabel("Deadline").fill(day);
      await expect(dialog.getByLabel("Time (IST)")).toHaveValue("18:00");

      const warning = (id: string, kind: string) =>
        dialog.locator(
          `[data-slot="task-assignee"][data-member="${id}"] [data-slot="task-warning"][data-kind="${kind}"]`,
        );
      await expect(warning(helperId, "workload")).toContainText("4 tasks already due");
      await expect(warning(staffId, "overlap")).toContainText("Busy 10:00 AM–12:00 PM");
      await expect(warning(awayId, "on_leave")).toContainText("Leave requested");
      await expect(dialog.locator('[data-slot="task-warning-summary"]')).toContainText(
        "3 warnings",
      );

      await dialog.getByRole("button", { name: "Create task" }).click();
      await expect(page).toHaveURL(TASK_URL);
      await expect(pageHeader(page)).toContainText(`${prefix}main`);
      const taskId = page.url().split("/").at(-1) as string;
      const warnings = await serviceSelect<{ kind: string; member_id: string }>(
        `task_warnings?task_id=eq.${taskId}&select=kind,member_id&order=kind`,
      );
      expect(warnings).toEqual([
        { kind: "on_leave", member_id: awayId },
        { kind: "overlap", member_id: staffId },
        { kind: "workload", member_id: helperId },
      ]);
      // The history shows the Owner the warnings kept (availability.view, 4A review M1).
      await expect(historyRows(page).filter({ hasText: "despite a heavy day" })).toHaveCount(1);
      await expect(historyRows(page).filter({ hasText: "despite leave that day" })).toHaveCount(1);
      await expect(summary(page)).toContainText("Shoot / Site Visit");
    });

    test("a task field defined in Settings is filled in the dialog and read on the page", async ({
      page,
    }, info) => {
      const prefix = `Fields ${info.project.name} `;
      const label = `Reel length ${info.project.name.replace("-", " ")}`;
      const key = `reel_length_${info.project.name.replace("-", "_")}`;
      await removeTasksTitled(prefix);
      await removeFieldDefinitions([key]);
      try {
        // Settings → Custom fields → Tasks (4B): company-wide task fields.
        await page.goto("/settings/custom-fields?entity=task");
        await page.getByRole("button", { name: "Add field" }).first().click();
        const add = page.getByRole("dialog", { name: "Add a field" });
        await add.getByLabel("Label").fill(label);
        await expect(add.getByLabel("Key")).toHaveValue(key);
        await pick(page, add.getByLabel("Type"), "Number");
        await add.getByRole("button", { name: "Add field" }).click();
        await expect(
          page.locator(`[data-slot="field-definition"][data-key="${key}"]`),
        ).toBeVisible();

        await page.goto("/tasks");
        await page.getByRole("button", { name: "New task" }).click();
        const dialog = formDialog(page);
        await dialog.getByLabel("Title").fill(`${prefix}reel`);
        await pick(
          page,
          dialog.getByLabel("Add a person"),
          new RegExp(`^${escape(person("staff", info).name)}`),
        );
        await dialog.getByLabel("Deadline").fill(workingDay(21));
        await dialog.getByLabel(label).fill("45");
        await dialog.getByRole("button", { name: "Create task" }).click();
        await expect(page).toHaveURL(TASK_URL);
        await expect(page.locator('[data-slot="task-details"]')).toContainText(label);
        await expect(page.locator('[data-slot="task-details"]')).toContainText("45");
      } finally {
        await removeTasksTitled(prefix);
        await removeFieldDefinitions([key]);
      }
    });

    test("decides past a waiting Admin: removes the approver, then approves", async ({
      page,
    }, info) => {
      const prefix = `Take ${info.project.name} `;
      await removeTasksTitled(prefix);
      const staff = person("staff", info);
      const admin = person("admin", info);
      const [staffId, adminId] = await Promise.all([
        memberIdOf(staff.email),
        memberIdOf(admin.email),
      ]);
      const taskId = await ownerCreates({
        title: `${prefix}poster`,
        assignees: [staffId],
        primary: staffId,
        approver: adminId,
        due: istInstant(workingDay(11), "18:00"),
      });
      await rpcAs(staff.email, PASSWORD, "task_submit_done", { task_id: taskId });

      await page.goto(`/tasks/${taskId}`);
      await expect(summary(page)).toContainText(`Waiting for ${admin.name} to check it`);
      // The Owner never decides at the Admin step (4A mechanics 5): no Approve here.
      await expect(summary(page).getByRole("button", { name: "Approve" })).toHaveCount(0);
      await summary(page).getByRole("button", { name: "Decide it yourself" }).click();
      await page
        .getByRole("alertdialog")
        .getByRole("button", { name: `Remove ${admin.name} as approver` })
        .click();
      await expect(summary(page)).toContainText("Waiting for approval");
      await summary(page).getByRole("button", { name: "Approve" }).click();
      await page.getByRole("alertdialog").getByRole("button", { name: "Approve task" }).click();
      await expect(summary(page)).toContainText("Completed");
      await expect(historyRows(page).first()).toContainText("approved it: the task is complete");
      await expect(
        historyRows(page).filter({ hasText: `removed ${admin.name} as approver` }),
      ).toHaveCount(1);
    });

    test("edits, cancels and reopens a task; the history names each change", async ({
      page,
    }, info) => {
      const prefix = `Edit ${info.project.name} `;
      await removeTasksTitled(prefix);
      const staffId = await memberIdOf(person("staff", info).email);
      const day = workingDay(12);
      const taskId = await ownerCreates({
        title: `${prefix}brief`,
        assignees: [staffId],
        primary: staffId,
        due: istInstant(day, "18:00"),
      });

      await page.goto(`/tasks/${taskId}`);
      await page.getByRole("button", { name: "Task actions" }).click();
      await page.getByRole("menuitem", { name: "Edit task" }).click();
      const dialog = formDialog(page);
      await expect(dialog.getByRole("heading", { name: "Edit task" })).toBeVisible();
      // Nothing changed yet: nothing to save.
      await expect(dialog.getByRole("button", { name: "Save changes" })).toBeDisabled();
      await pick(page, dialog.getByLabel("Priority"), "High");
      await dialog.getByLabel("Time (IST)").fill("19:00");
      await dialog.getByRole("button", { name: "Save changes" }).click();
      await expect(dialog).toBeHidden();
      await expect(summary(page)).toContainText("High");
      await expect(summary(page)).toContainText("7:00 PM");
      await expect(
        historyRows(page).filter({ hasText: "changed the priority from Medium to High" }),
      ).toHaveCount(1);
      await expect(historyRows(page).filter({ hasText: "moved the deadline from" })).toHaveCount(1);

      await page.getByRole("button", { name: "Task actions" }).click();
      await page.getByRole("menuitem", { name: "Cancel task" }).click();
      const cancel = page.getByRole("dialog", { name: "Cancel this task?" });
      await cancel.getByRole("button", { name: "Cancel task" }).click();
      await expect(cancel).toContainText("A reason is required.");
      await cancel.getByLabel("Reason").fill("The client moved the launch");
      await cancel.getByRole("button", { name: "Cancel task" }).click();
      await expect(cancel).toBeHidden();
      await expect(summary(page)).toContainText("Cancelled: The client moved the launch");

      await page.getByRole("button", { name: "Task actions" }).click();
      await page.getByRole("menuitem", { name: "Reopen task" }).click();
      const reopen = page.getByRole("dialog", { name: "Reopen this task?" });
      await reopen.getByLabel("Reason").fill("The launch is back on");
      await reopen.getByRole("button", { name: "Reopen task" }).click();
      await expect(reopen).toBeHidden();
      await expect(summary(page)).toContainText("To do");
      await expect(historyRows(page).first()).toContainText("reopened the task");
    });
  });

  test.describe("signed in as each person", () => {
    test.use({ storageState: { cookies: [], origins: [] } });

    test("the coordinator notes, starts, ticks and marks done for the freelancer, with a link", async ({
      page,
    }, info) => {
      const prefix = `Route ${info.project.name} `;
      await removeTasksTitled(prefix);
      const coord = person("coord", info);
      const staffId = await memberIdOf(person("staff", info).email);
      const adminId = await memberIdOf(person("admin", info).email);
      const asha = freelancer(info);
      const taskId = await ownerCreates({
        title: `${prefix}reel`,
        assignees: [asha.id, staffId],
        primary: asha.id,
        approver: adminId,
        due: istInstant(workingDay(10), "18:00"),
        stages: ["Rough cut", "Colour grade"],
      });

      await page.context().clearCookies();
      await signIn(page, coord.email, PASSWORD);
      await page.goto(`/tasks/${taskId}`);
      const card = summary(page);
      await card.getByRole("button", { name: `Noted for ${asha.name}` }).click();
      await expect(card.getByRole("button", { name: `Noted for ${asha.name}` })).toHaveCount(0);
      const row = page.locator(`[data-slot="task-person"][data-member="${asha.id}"]`);
      await expect(row).toContainText(`Noted by ${coord.name} for ${asha.name}`);

      await card.getByRole("button", { name: `Start for ${asha.name}` }).click();
      await expect(card).toContainText("In progress");

      await page.getByRole("checkbox", { name: "Rough cut" }).click();
      await expect(
        page.locator('[data-slot="task-stage"]', { hasText: "Rough cut" }),
      ).toContainText(`Ticked by ${coord.name} for ${asha.name}`);

      await card.getByRole("button", { name: `Mark done for ${asha.name}` }).click();
      const done = page.locator('[data-slot="task-done-dialog"]');
      await done
        .getByLabel("Note (optional)")
        .fill("Final cut: https://drive.google.com/drive/folders/abc123 please check.");
      await done.getByRole("button", { name: `Mark done for ${asha.name}` }).click();
      await expect(done).toBeHidden();
      await expect(card).toContainText("Waiting for check");

      const link = page.locator('[data-slot="task-hand-in-note"] a');
      await expect(link).toHaveAttribute("href", "https://drive.google.com/drive/folders/abc123");
      await expect(link).toHaveAttribute("rel", "noopener noreferrer");
      await expect(link).toHaveAttribute("target", "_blank");
      // Locked from Done on (WORKFLOWS §3.1): no more ticks; comments stay open.
      await expect(page.getByRole("checkbox", { name: "Colour grade" })).toBeDisabled();
      await expect(page.locator('[data-slot="task-stages-locked"]')).toBeVisible();
      await expect(
        historyRows(page).filter({ hasText: `${coord.name} for ${asha.name} noted the task` }),
      ).toHaveCount(1);
      await expect(
        historyRows(page).filter({ hasText: `${coord.name} for ${asha.name} marked it done` }),
      ).toHaveCount(1);

      // A comment for the freelancer, named as the pair.
      await page.getByRole("button", { name: "Add a comment" }).click();
      const comment = page.locator('[data-slot="task-comment-dialog"]');
      await expect(comment.getByLabel("Writing as")).toContainText(`For ${asha.name}`);
      await comment.getByLabel("Comment").fill("Uploaded the final cut.");
      await comment.getByRole("button", { name: "Post comment" }).click();
      await expect(comment).toBeHidden();
      await expect(page.locator('[data-slot="task-comment"]')).toContainText(
        `${coord.name} for ${asha.name}`,
      );
    });

    test("the approving Admin checks it and the Owner gives the final approval", async ({
      page,
    }, info) => {
      const prefix = `Review ${info.project.name} `;
      await removeTasksTitled(prefix);
      const staff = person("staff", info);
      const admin = person("admin", info);
      const [staffId, adminId] = await Promise.all([
        memberIdOf(staff.email),
        memberIdOf(admin.email),
      ]);
      const taskId = await ownerCreates({
        title: `${prefix}carousel`,
        assignees: [staffId],
        primary: staffId,
        approver: adminId,
        due: istInstant(workingDay(13), "18:00"),
      });
      await rpcAs(staff.email, PASSWORD, "task_submit_done", {
        task_id: taskId,
        note: "Slides: https://example.com/carousel",
      });

      await page.context().clearCookies();
      await signIn(page, admin.email, PASSWORD);
      await page.goto(`/tasks/${taskId}`);
      await expect(page.locator('[data-slot="task-hand-in-note"] a')).toHaveAttribute(
        "href",
        "https://example.com/carousel",
      );
      await summary(page).getByRole("button", { name: "Approve" }).click();
      await page.getByRole("alertdialog").getByRole("button", { name: "Approve task" }).click();
      await expect(summary(page)).toContainText("Checked. Waiting for the Owner's approval.");

      await page.context().clearCookies();
      await signIn(page, USERS.owner.email, USERS.owner.password);
      await page.goto(`/tasks/${taskId}`);
      await summary(page).getByRole("button", { name: "Approve" }).click();
      await page.getByRole("alertdialog").getByRole("button", { name: "Approve task" }).click();
      await expect(summary(page)).toContainText("Completed");
      await expect(
        historyRows(page).filter({
          hasText: `${admin.name} checked it and passed it to the Owner`,
        }),
      ).toHaveCount(1);
    });

    test("changes requested with a reason, then Done again past the deadline with a late reason", async ({
      page,
    }, info) => {
      const prefix = `Rework ${info.project.name} `;
      await removeTasksTitled(prefix);
      const staff = person("staff", info);
      const staffId = await memberIdOf(staff.email);
      const taskId = await ownerCreates({
        title: `${prefix}logo`,
        assignees: [staffId],
        primary: staffId,
        due: istInstant(workingDay(14), "18:00"),
      });
      await rpcAs(staff.email, PASSWORD, "task_submit_done", { task_id: taskId });

      await page.context().clearCookies();
      await signIn(page, USERS.owner.email, USERS.owner.password);
      await page.goto(`/tasks/${taskId}`);
      await summary(page).getByRole("button", { name: "Request changes" }).click();
      const reject = page.getByRole("dialog", { name: "Request changes" });
      await reject.getByLabel("What needs to change?").fill("Use the new logo colours");
      await reject.getByRole("button", { name: "Request changes" }).click();
      await expect(reject).toBeHidden();
      await expect(summary(page)).toContainText("Changes requested");

      // The deadline moves into the past (an edit may move it anywhere, kickoff 4 decision 4).
      await rpcAs(USERS.owner.email, USERS.owner.password, "task_update_assignment", {
        task_id: taskId,
        changes: { due_at: istInstant(addISTDays(todayIST(), -1), "18:00") },
      });

      await page.context().clearCookies();
      await signIn(page, staff.email, PASSWORD);
      await page.goto(`/tasks/${taskId}`);
      const card = summary(page);
      await expect(card.locator('[data-slot="task-change-request"]')).toContainText(
        "Use the new logo colours",
      );
      await expect(card).toContainText("Overdue");
      await card.getByRole("button", { name: "Mark done again" }).click();
      const done = page.locator('[data-slot="task-done-dialog"]');
      await done.getByRole("button", { name: "Mark done" }).click();
      await expect(done).toContainText("Say why it's late");
      await done.getByLabel("Why is it late?").fill("Waited for the new brand kit");
      await done.getByRole("button", { name: "Mark done" }).click();
      await expect(done).toBeHidden();
      await expect(card).toContainText("Waiting for approval");
      await expect(page.locator('[data-slot="task-late-reason"]')).toContainText(
        "Waited for the new brand kit",
      );
    });

    test("an Admin's task routes to them; Staff see no New task and not someone else's task", async ({
      page,
    }, info) => {
      const prefix = `Admin ${info.project.name} `;
      await removeTasksTitled(prefix);
      const admin = person("admin", info);
      const staff = person("staff", info);

      await page.context().clearCookies();
      await signIn(page, admin.email, PASSWORD);
      await page.goto("/tasks");
      await page.getByRole("button", { name: "New task" }).click();
      const dialog = formDialog(page);
      await expect(dialog.locator('[data-slot="task-route"]')).toContainText(
        "You check it when it's done",
      );
      await expect(dialog.getByLabel("Checked first by")).toHaveCount(0);
      await dialog.getByLabel("Title").fill(`${prefix}thumbnail`);
      await pick(page, dialog.getByLabel("Add a person"), new RegExp(`^${escape(staff.name)}`));
      await dialog.getByLabel("Deadline").fill(workingDay(16));
      await dialog.getByRole("button", { name: "Create task" }).click();
      await expect(page).toHaveURL(TASK_URL);
      await expect(summary(page)).toContainText(
        `${admin.name} checks it, then the Owner approves it`,
      );
      const url = page.url();

      // A Staff member who is not on it: no New task, and the task is not there for them.
      await page.context().clearCookies();
      await signIn(page, person("helper", info).email, PASSWORD);
      await page.goto("/tasks");
      await expect(pageHeader(page)).toContainText("Tasks");
      await expect(page.getByRole("button", { name: "New task" })).toHaveCount(0);
      await page.goto(url);
      await expect(page.getByText("Page not found")).toBeVisible();
    });
  });
});

test.describe("staff tasks, installed: back closes each layer", () => {
  test.skip(({ isMobile }) => !isMobile, "the installed back gesture is a phone's");

  test.describe("as the Owner", () => {
    test.use({ storageState: storageStateFor("owner") });

    test("the create dialog: back closes it, asks before dropping what was typed, and a new task is a drill-down", async ({
      page,
    }, info) => {
      const prefix = `Back ${info.project.name} `;
      await removeTasksTitled(prefix);
      await runInstalled(page);
      await page.goto("/today");
      await page.locator('[data-slot="bottom-nav"] [data-nav="tasks"]').click();
      await expect(page).toHaveURL(/\/tasks$/);

      const dialog = formDialog(page);
      await page.getByRole("button", { name: "New task" }).click();
      await expect(dialog).toBeVisible();
      await expectBackStack(page, [{ closes: dialog, url: /\/tasks$/ }]);

      await page.getByRole("button", { name: "New task" }).click();
      await dialog.getByLabel("Title").fill(`${prefix}draft`);
      const discard = page.getByRole("alertdialog", { name: "Discard this task?" });
      await page.goBack();
      await expect(discard).toBeVisible();
      await expect(page).toHaveURL(/\/tasks$/);
      // One back on the question keeps editing, with what was typed.
      await page.goBack();
      await expect(discard).toBeHidden();
      await expect(dialog.getByLabel("Title")).toHaveValue(`${prefix}draft`);
      await page.goBack();
      await discard.getByRole("button", { name: "Discard task" }).click();
      await expect(discard).toBeHidden();
      await expect(dialog).toBeHidden();
      await expect(page).toHaveURL(/\/tasks$/);

      // A new task opens on its page; back returns to Tasks, never to the form, then home.
      await page.getByRole("button", { name: "New task" }).click();
      await dialog.getByLabel("Title").fill(`${prefix}drill`);
      await pick(
        page,
        dialog.getByLabel("Add a person"),
        new RegExp(`^${escape(person("staff", info).name)}`),
      );
      await dialog.getByLabel("Deadline").fill(workingDay(17));
      await expectTargets(page);
      await dialog.getByRole("button", { name: "Create task" }).click();
      await expect(page).toHaveURL(TASK_URL);
      await expectBackStack(page, [{ closes: dialog, url: /\/tasks$/ }, { url: /\/today$/ }]);
    });

    test("the task page's menu and dialogs close on back; its back control goes to Tasks", async ({
      page,
    }, info) => {
      const prefix = `Layers ${info.project.name} `;
      await removeTasksTitled(prefix);
      const staffId = await memberIdOf(person("staff", info).email);
      const taskId = await ownerCreates({
        title: `${prefix}menu`,
        assignees: [staffId],
        primary: staffId,
        due: istInstant(workingDay(18), "18:00"),
      });
      await runInstalled(page);
      // Opened directly (a deep link): the header's back replaces it with Tasks.
      await page.goto(`/tasks/${taskId}`);
      const url = new RegExp(`/tasks/${taskId}$`);

      await page.getByRole("button", { name: "Task actions" }).click();
      const menu = page.getByRole("menu");
      await expect(menu).toBeVisible();
      await expectBackStack(page, [{ closes: menu, url }]);

      await page.getByRole("button", { name: "Task actions" }).click();
      await page.getByRole("menuitem", { name: "Cancel task" }).click();
      const cancel = page.getByRole("dialog", { name: "Cancel this task?" });
      await expect(cancel).toBeVisible();
      await expectBackStack(page, [{ closes: cancel, url }]);

      await page.getByRole("button", { name: "Add a comment" }).click();
      const comment = page.locator('[data-slot="task-comment-dialog"]');
      await expect(comment).toBeVisible();
      await expectBackStack(page, [{ closes: comment, url }]);

      await page.getByRole("button", { name: "Task actions" }).click();
      await page.getByRole("menuitem", { name: "Edit task" }).click();
      await expect(formDialog(page)).toBeVisible();
      await expectBackStack(page, [{ closes: formDialog(page), url }]);

      await page.getByRole("button", { name: "Task actions" }).click();
      await page.getByRole("menuitem", { name: "Change approver" }).click();
      const approver = page.locator('[data-slot="task-approver-dialog"]');
      await expect(approver).toBeVisible();
      await expectBackStack(page, [{ closes: approver, url }]);

      await page.getByRole("button", { name: "Add stage" }).click();
      const stage = page.locator('[data-slot="task-stage-dialog"]');
      await expect(stage).toBeVisible();
      await expectBackStack(page, [{ closes: stage, url }]);

      // The mobile standard on the task page: 44px targets and 16px inputs.
      await expectTargets(page);

      await page.getByRole("link", { name: "Back to Tasks" }).click();
      await expect(page).toHaveURL(/\/tasks$/);
      await expect(page.getByRole("button", { name: "New task" })).toBeVisible();
    });

    test("the review's confirmation and reason dialogs close on back", async ({ page }, info) => {
      const prefix = `Review back ${info.project.name} `;
      await removeTasksTitled(prefix);
      const staff = person("staff", info);
      const staffId = await memberIdOf(staff.email);
      const taskId = await ownerCreates({
        title: `${prefix}task`,
        assignees: [staffId],
        primary: staffId,
        due: istInstant(workingDay(22), "18:00"),
        stages: ["Draft"],
      });
      await rpcAs(staff.email, PASSWORD, "task_submit_done", { task_id: taskId });
      await runInstalled(page);
      await page.goto(`/tasks/${taskId}`);
      const url = new RegExp(`/tasks/${taskId}$`);

      await summary(page).getByRole("button", { name: "Approve" }).click();
      const approve = page.getByRole("alertdialog", { name: "Approve this task?" });
      await expect(approve).toBeVisible();
      await expectBackStack(page, [{ closes: approve, url }]);

      await summary(page).getByRole("button", { name: "Request changes" }).click();
      const reject = page.getByRole("dialog", { name: "Request changes" });
      await expect(reject).toBeVisible();
      await expectBackStack(page, [{ closes: reject, url }]);

      // Removing an unticked stage asks first, and back closes the question.
      await page.getByRole("button", { name: "Remove stage Draft" }).click();
      const remove = page.getByRole("alertdialog", { name: "Remove this stage?" });
      await expect(remove).toBeVisible();
      await expectBackStack(page, [{ closes: remove, url }]);
      await expect(summary(page)).toContainText("Waiting for approval");
    });
  });

  test.describe("as the primary owner", () => {
    test.use({ storageState: { cookies: [], origins: [] } });

    test("the Done dialog closes on back", async ({ page }, info) => {
      const prefix = `Done back ${info.project.name} `;
      await removeTasksTitled(prefix);
      const staff = person("staff", info);
      const staffId = await memberIdOf(staff.email);
      const taskId = await ownerCreates({
        title: `${prefix}task`,
        assignees: [staffId],
        primary: staffId,
        due: istInstant(workingDay(19), "18:00"),
      });
      await runInstalled(page);
      await page.context().clearCookies();
      await signIn(page, staff.email, PASSWORD);
      await page.goto(`/tasks/${taskId}`);
      // The mobile standard on a worker's view: 44px targets and 16px inputs.
      await expectTargets(page);
      await summary(page).getByRole("button", { name: "Mark done" }).click();
      const done = page.locator('[data-slot="task-done-dialog"]');
      await expect(done).toBeVisible();
      await expectTargets(page);
      await expect(done).toBeVisible();
      await expectBackStack(page, [{ closes: done, url: new RegExp(`/tasks/${taskId}$`) }]);
      // Task Noted is the one commit on the screen.
      await summary(page).getByRole("button", { name: "Task Noted" }).click();
      await expect(summary(page).getByRole("button", { name: "Task Noted" })).toHaveCount(0);
    });
  });
});

test.describe("staff tasks at large system text", () => {
  test.skip(({ isMobile }) => !isMobile, "phone widths");
  test.use({ storageState: storageStateFor("owner") });

  test("the task page and the create dialog fit at 130% and 200%", async ({ page }, info) => {
    const prefix = `Large ${info.project.name} `;
    await removeTasksTitled(prefix);
    const staffId = await memberIdOf(person("staff", info).email);
    const asha = freelancer(info);
    const day = workingDay(20);
    const taskId = await ownerCreates({
      title: `${prefix}a long task title that has to wrap on a small phone`,
      assignees: [asha.id, staffId],
      primary: asha.id,
      due: istInstant(day, "18:00"),
      stages: ["Rough cut with the music", "Colour grade"],
      type: await taskTypeId("Meeting"),
      event: { date: day, start: "10:00", end: "11:30" },
    });
    await page.goto(`/tasks/${taskId}`);
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
    await page.goto("/tasks");
    await page.getByRole("button", { name: "New task" }).click();
    const dialog = formDialog(page);
    await dialog.getByLabel("Title").fill(`${prefix}dialog`);
    await pick(page, dialog.getByLabel("Add a person"), new RegExp(`^${escape(asha.name)}`));
    for (const scale of [130, 200]) {
      await page.evaluate((percent) => {
        document.documentElement.style.fontSize = `${percent}%`;
      }, scale);
      // The sheet's surface eases its rem padding to the new size (MODAL_SURFACE's duration with
      // the default transition-property); measure the settled layout, not the frame in between.
      await dialog.evaluate((element) =>
        Promise.all(
          element.getAnimations({ subtree: true }).map((animation) => animation.finished),
        ),
      );
      await expectFits(page);
      // The commit stays reachable at the sheet's foot.
      await expect(dialog.getByRole("button", { name: "Create task" })).toBeInViewport();
    }
  });
});

/** 44px targets and 16px text inputs (ARCHITECTURE §14.1), as `mobile.spec.ts` checks them. */
async function expectTargets(page: Page): Promise<void> {
  const problems = await page.evaluate(() => {
    const found: string[] = [];
    const controls =
      'button, a[href], input:not([type="hidden"]), select, textarea, [role="button"]';
    for (const el of document.querySelectorAll<HTMLElement>(controls)) {
      const style = getComputedStyle(el);
      if (style.display === "none" || style.visibility === "hidden" || style.display === "inline") {
        continue;
      }
      const box = el.getBoundingClientRect();
      if (box.width <= 1 || box.height <= 1) continue;
      const label = el.closest("label")?.getBoundingClientRect();
      const reach = label && label.width >= 44 && label.height >= 44;
      if ((box.width < 44 || box.height < 44) && !reach) {
        found.push(
          `${el.tagName.toLowerCase()} "${el.getAttribute("aria-label") ?? el.textContent?.trim().slice(0, 24)}" ${Math.round(box.width)}x${Math.round(box.height)}`,
        );
      }
      if (el.matches("input:not([type=checkbox]):not([type=radio]), textarea, select")) {
        if (parseFloat(style.fontSize) < 16)
          found.push(`${el.tagName.toLowerCase()} font ${style.fontSize}`);
      }
    }
    return found;
  });
  expect(problems, "44px targets and 16px inputs").toEqual([]);
}

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

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
