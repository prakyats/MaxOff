import { type Page, type TestInfo } from "@playwright/test";

import { expect, test } from "./fixtures";

import { addISTDays, istInstant, istWeekday, todayIST } from "../src/core/time";

import {
  dockTop,
  animationsSettled,
  expectBackStack,
  expectNoHorizontalScroll,
  hydrated,
  insertAs,
  memberIdOf,
  removeTasksTitled,
  rpcAs,
  runInstalled,
  signIn,
  storageStateFor,
  taskTypeId,
  USERS,
} from "./helpers";

/**
 * The task page as the owner reworked it (Kickoff 4 decisions 26–32, owner 2026-09-30): the
 * first glance with **only the next step** (Task Noted → Start work → Mark done, one at a time; a
 * sticky bar on a phone, hidden while the keyboard is open), the reviewer's Approve and Request
 * changes, the views as a **view control** (Work · Chat · Activity · Details: `?tab=` replaced,
 * one back leaves the task whatever was chosen, nothing switches by itself), the landing view,
 * **Chat** (the unread count, marking read per member, the phone's full-height sheet with its
 * composer above the keyboard), the lists' unread markers, **Activity** (the newest five, Show
 * all, collapsed ticks), the desktop's two columns, large text, and installed back orders.
 *
 * The people are `tasks.spec`'s (`task-<kind>-<project>@maxoff.local`), on IST days of their own
 * (31 days out and later, never a day `tasks.spec`'s warnings count), each test with its own title
 * prefix, removed first, so the tests run in parallel and re-run without `pnpm db:reset`.
 */

const PASSWORD = "task-local-password";
const LABELS = { staff: "Staff", helper: "Helper", admin: "Admin" } as const;
type Kind = keyof typeof LABELS;

function person(kind: Kind, info: TestInfo) {
  return {
    email: `task-${kind}-${info.project.name}@maxoff.local`,
    name: `Test Task ${LABELS[kind]} (${info.project.name})`,
  };
}

/** A weekday (Mon–Fri) at least `offset` days from today, IST. */
function workingDay(offset: number): string {
  let day = addISTDays(todayIST(), offset);
  while (istWeekday(day) === 0 || istWeekday(day) === 6) day = addISTDays(day, 1);
  return day;
}

async function ownerCreates(args: {
  title: string;
  assignees: string[];
  primary: string;
  day: number;
  approver?: string | null;
  stages?: string[];
  description?: string | null;
}): Promise<string> {
  return rpcAs<string>(USERS.owner.email, USERS.owner.password, "task_create", {
    title: args.title,
    description: args.description ?? null,
    task_type_id: await taskTypeId("Normal"),
    client_id: null,
    priority: "medium",
    due_at: istInstant(workingDay(args.day), "18:00"),
    assignee_ids: args.assignees,
    primary_owner_id: args.primary,
    approving_admin_id: args.approver ?? null,
    stages: args.stages ?? [],
  });
}

const step = (page: Page) => page.locator('[data-slot="task-next-step"]');
const tab = (page: Page, view: string) =>
  page.locator(`[data-slot="task-tab"][data-view-tab="${view}"]`);

/** The views' bar has hydrated: a tap on it is the app's from then on. */
async function live(page: Page): Promise<void> {
  await expect(page.locator('[data-slot="task-tabs"]')).toHaveAttribute("data-live", "");
}
const panel = (page: Page, view: string) => page.locator(`[data-slot="task-panel-${view}"]`);
const chatSheet = (page: Page) => page.locator('[data-slot="task-chat-sheet"]');
const historyRows = (page: Page) => page.locator('[data-slot="task-history-row"]:visible');
const phone = (page: Page) => (page.viewportSize()?.width ?? 1280) < 768;

/** Stands in for the on-screen keyboard: the visual viewport loses `cover` px at the bottom. */
async function openKeyboard(page: Page, cover: number): Promise<void> {
  await page.evaluate((px) => {
    const viewport = window.visualViewport as VisualViewport;
    const height = window.innerHeight - px;
    Object.defineProperty(viewport, "height", { configurable: true, get: () => height });
    viewport.dispatchEvent(new Event("resize"));
  }, cover);
}

async function closeKeyboard(page: Page): Promise<void> {
  await page.evaluate(() => {
    const viewport = window.visualViewport as VisualViewport;
    // The stand-in is an own property; removing it uncovers the real one again.
    Reflect.deleteProperty(viewport, "height");
    viewport.dispatchEvent(new Event("resize"));
  });
}

/** Signs in as one of the task people, on a clean cookie jar. */
async function as(page: Page, kind: Kind, info: TestInfo): Promise<void> {
  await page.context().clearCookies();
  await signIn(page, person(kind, info).email, PASSWORD);
}

test.describe("the task page, one step at a time (decision 26)", () => {
  test.skip(({ viewport }) => viewport?.width === 430, "the flows run at 375px and desktop");
  test.use({ storageState: { cookies: [], origins: [] } });

  test("Task Noted, then Start work, then Mark done; a sticky bar on a phone that steps aside for the keyboard", async ({
    page,
  }, info) => {
    const prefix = `Steps ${info.project.name} `;
    await removeTasksTitled(prefix);
    const staffId = await memberIdOf(person("staff", info).email);
    const taskId = await ownerCreates({
      title: `${prefix}reel`,
      assignees: [staffId],
      primary: staffId,
      day: 31,
      stages: ["Cut"],
    });
    await as(page, "staff", info);
    await page.goto(`/tasks/${taskId}`);
    await hydrated(page);
    await live(page);

    const needed = page.locator('[data-slot="task-needed"]');
    await expect(needed).toHaveText("Tap Task Noted to say you've seen it.");
    // Only the next step, the one solid button: nothing else is offered beside it.
    await expect(step(page).getByRole("button")).toHaveCount(1);
    await expect(step(page).getByRole("button", { name: "Task Noted" })).toHaveAttribute(
      "data-variant",
      "primary",
    );
    const bar = page.locator('[data-slot="sticky-actions"]');
    if (phone(page)) {
      // A sticky bar above the bottom bar (decision 32)…
      await expect(bar).toHaveCSS("position", "fixed");
      const box = await bar.boundingBox();
      // Directly on what is docked below it: the bottom bar, or the push band while it shows.
      expect(
        Math.abs((box?.y ?? 0) + (box?.height ?? 0) - (await dockTop(page))),
      ).toBeLessThanOrEqual(1);
      // …that steps aside while the keyboard is open, and comes back after.
      await openKeyboard(page, 320);
      await expect(bar).toBeHidden();
      await closeKeyboard(page);
      await expect(bar).toBeVisible();
    } else {
      await expect(bar).toHaveCSS("position", "static");
    }
    // Mark done waits under ⋯ meanwhile (Done may come straight from To do).
    await page.getByRole("button", { name: "Task actions" }).click();
    await expect(page.getByRole("menuitem", { name: "Mark done" })).toBeVisible();
    await page.keyboard.press("Escape");

    await step(page).getByRole("button", { name: "Task Noted" }).click();
    await expect(step(page).getByRole("button", { name: "Start work" })).toBeVisible();
    await expect(step(page).getByRole("button")).toHaveCount(1);
    await expect(needed).toHaveText("Start work when you begin.");

    await step(page).getByRole("button", { name: "Start work" }).click();
    await expect(step(page).getByRole("button", { name: "Mark done" })).toBeVisible();
    await expect(step(page).getByRole("button", { name: "Mark done" })).toHaveAttribute(
      "data-variant",
      "strong",
    );
    await expect(needed).toHaveText("Mark it done when the work is finished.");
    await expect(page.locator('[data-slot="task-glance"]')).toContainText("In progress");

    await step(page).getByRole("button", { name: "Mark done" }).click();
    const done = page.locator('[data-slot="task-done-dialog"]');
    await done.getByRole("button", { name: "Mark done" }).click();
    await expect(done).toBeHidden();
    await expect(step(page)).toHaveCount(0);
    await expect(needed).toHaveText(
      "Nothing needed from you now. Done. Waiting for the Owner's approval.",
    );
  });

  test("the reviewer lands on the hand-in: Approve the one solid action, Request changes a red outline", async ({
    page,
  }, info) => {
    const prefix = `Reviewer ${info.project.name} `;
    await removeTasksTitled(prefix);
    const staff = person("staff", info);
    const staffId = await memberIdOf(staff.email);
    const taskId = await ownerCreates({
      title: `${prefix}poster`,
      assignees: [staffId],
      primary: staffId,
      day: 32,
      stages: ["Layout"],
      description: "The spring poster.",
    });
    await rpcAs(staff.email, PASSWORD, "task_submit_done", {
      task_id: taskId,
      note: "Here: https://example.com/poster",
    });
    await page.context().clearCookies();
    await signIn(page, USERS.owner.email, USERS.owner.password);
    // From the Owner's Approvals row, as a reviewer meets it.
    await page.goto(`/tasks/${taskId}`);
    await expect(tab(page, "work")).toHaveAttribute("aria-current", "true");
    // The hand-in leads Work once the task is handed in (decision 32).
    await expect(panel(page, "work").locator("> section").first()).toHaveAttribute(
      "data-slot",
      "task-hand-in",
    );
    await expect(step(page).getByRole("button", { name: "Approve" })).toHaveAttribute(
      "data-variant",
      "strong",
    );
    await expect(step(page).getByRole("button", { name: "Request changes" })).toHaveAttribute(
      "data-variant",
      "destructive",
    );
    await expect(page.locator('[data-variant="primary"]:visible')).toHaveCount(0);
    await expect(page.locator('[data-slot="task-needed"]')).toHaveText(
      "Approve it to complete the task, or ask for changes.",
    );
  });
});

test.describe("the views are a view control (decisions 27, 32)", () => {
  test.skip(({ viewport }) => viewport?.width === 430, "the flows run at 375px and desktop");
  test.use({ storageState: { cookies: [], origins: [] } });

  test("the address keeps the view by replace; a refresh keeps it; one back leaves the task; nothing switches by itself", async ({
    page,
  }, info) => {
    const prefix = `Views ${info.project.name} `;
    await removeTasksTitled(prefix);
    const staffId = await memberIdOf(person("staff", info).email);
    const taskId = await ownerCreates({
      title: `${prefix}script`,
      assignees: [staffId],
      primary: staffId,
      day: 33,
      stages: ["Draft"],
    });
    await as(page, "staff", info);
    await page.goto("/tasks");
    // Opened from a list, a task lands on Work.
    await page.locator(`[data-slot="task-row"][data-task="${taskId}"] a`).click();
    await expect(page).toHaveURL(new RegExp(`/tasks/${taskId}$`));
    await live(page);
    await expect(tab(page, "work")).toHaveAttribute("aria-current", "true");
    await expect(panel(page, "work")).toBeVisible();

    await tab(page, "activity").click();
    await expect(page).toHaveURL(new RegExp(`/tasks/${taskId}\\?tab=activity$`));
    await expect(panel(page, "activity")).toBeVisible();
    await expect(panel(page, "work")).toBeHidden();
    // The views never switch by themselves: an action's answer leaves Activity where it is.
    await step(page).getByRole("button", { name: "Task Noted" }).click();
    await expect(step(page).getByRole("button", { name: "Start work" })).toBeVisible();
    await expect(historyRows(page).first()).toContainText("noted the task");
    await expect(tab(page, "activity")).toHaveAttribute("aria-current", "true");

    if (phone(page)) {
      await tab(page, "details").click();
      await expect(page).toHaveURL(new RegExp(`\\?tab=details$`));
      await expect(panel(page, "details")).toBeVisible();
    } else {
      // No Details view on a desktop: it is the right panel, always there.
      await expect(tab(page, "details")).toBeHidden();
      await expect(panel(page, "details")).toBeVisible();
    }
    // A refresh (or a shared link) keeps the view.
    await tab(page, "activity").click();
    await page.reload();
    await expect(tab(page, "activity")).toHaveAttribute("aria-current", "true");
    await expect(panel(page, "activity")).toBeVisible();
    await tab(page, "work").click();
    await expect(page).toHaveURL(new RegExp(`/tasks/${taskId}$`));

    // One back leaves the task, whatever was chosen.
    await page.goBack();
    await expect(page).toHaveURL(/\/tasks$/);
  });

  test("a desktop has two columns: the main one with the views, Details on the right, Chat inline", async ({
    page,
  }, info) => {
    test.skip(phone(page), "the desktop layout");
    const prefix = `Columns ${info.project.name} `;
    await removeTasksTitled(prefix);
    const staffId = await memberIdOf(person("staff", info).email);
    const taskId = await ownerCreates({
      title: `${prefix}layout`,
      assignees: [staffId],
      primary: staffId,
      day: 34,
    });
    await as(page, "staff", info);
    await page.goto(`/tasks/${taskId}`);
    await hydrated(page);
    await live(page);
    const main = await page.locator('[data-slot="task-tabs"]').boundingBox();
    const details = await panel(page, "details").boundingBox();
    expect(details?.x ?? 0).toBeGreaterThan((main?.x ?? 0) + (main?.width ?? 0));
    await expect(panel(page, "details")).toHaveCSS("position", "sticky");
    await expect(panel(page, "details")).toContainText(person("staff", info).name);
    await expect(tab(page, "details")).toBeHidden();
    await expect(page.locator('[data-slot="task-tab"]:visible')).toHaveText([
      "Work",
      "Chat",
      "Activity",
    ]);
    await tab(page, "chat").click();
    await expect(panel(page, "chat")).toBeVisible();
    await expect(panel(page, "chat").getByRole("textbox", { name: "Comment" })).toBeVisible();
    await expect(chatSheet(page)).toHaveCount(0);
    await expect(page).toHaveURL(new RegExp(`\\?tab=chat$`));
  });
});

test.describe("Chat and the unread comments (decision 28)", () => {
  test.skip(({ viewport }) => viewport?.width === 430, "the flows run at 375px and desktop");
  test.use({ storageState: { cookies: [], origins: [] } });

  test("another member's comment is new to each reader until they open Chat; one's own never is", async ({
    page,
  }, info) => {
    const prefix = `Unread ${info.project.name} `;
    await removeTasksTitled(prefix);
    const staff = person("staff", info);
    const helper = person("helper", info);
    const [staffId, helperId] = await Promise.all([
      memberIdOf(staff.email),
      memberIdOf(helper.email),
    ]);
    const taskId = await ownerCreates({
      title: `${prefix}teaser`,
      assignees: [staffId, helperId],
      primary: staffId,
      day: 35,
    });
    await insertAs(helper.email, PASSWORD, "task_comments", {
      task_id: taskId,
      body: "The music file is in the shared folder.",
    });
    // The writer's own comment is never new to them.
    const helperCounts = await rpcAs<{ task_id: string; unread: number }[]>(
      helper.email,
      PASSWORD,
      "task_unread_counts",
      { task_ids: [taskId] },
    );
    expect(helperCounts).toEqual([]);

    await as(page, "staff", info);
    await page.goto("/tasks");
    const row = page.locator(`[data-slot="task-row"][data-task="${taskId}"]`);
    await expect(row.locator('[data-slot="task-unread"]')).toHaveText(/1\s*1 new comment/);
    await row.locator("a").click();
    await live(page);
    await expect(tab(page, "chat")).toHaveText("Chat · 1 new");

    // Opening Chat marks it read: the count goes at once, and stays gone.
    const chat = phone(page) ? chatSheet(page) : panel(page, "chat");
    await tab(page, "chat").click();
    await expect(chat.locator('[data-slot="task-comment"]')).toContainText(helper.name);
    await expect(tab(page, "chat")).toHaveText("Chat");
    await expect
      .poll(
        async () =>
          (
            await rpcAs<{ task_id: string }[]>(staff.email, PASSWORD, "task_unread_counts", {
              task_ids: [taskId],
            })
          ).length,
      )
      .toBe(0);
    if (phone(page)) await page.goBack();
    await expect(chatSheet(page)).toBeHidden();

    // Staff's own reply is not new to them; to the helper it is.
    const composer = phone(page) ? chatSheet(page) : panel(page, "chat");
    await tab(page, "chat").click();
    await composer.getByRole("textbox", { name: "Comment" }).fill("Got it, thanks.");
    // One solid red per layer (decision 26, phase 4 review A-M1): Send is red only in the phone's
    // sheet, its own layer; inline on desktop it sits beside the next step's solid button.
    await expect(composer.getByRole("button", { name: "Send" })).toHaveAttribute(
      "data-variant",
      phone(page) ? "primary" : "secondary",
    );
    await composer.getByRole("button", { name: "Send" }).click();
    await expect(composer.locator('[data-slot="task-comment"][data-own="true"]')).toContainText(
      "Got it, thanks.",
    );
    await expect(tab(page, "chat")).toHaveText("Chat");
    const counts = await rpcAs<{ task_id: string; unread: number }[]>(
      helper.email,
      PASSWORD,
      "task_unread_counts",
      { task_ids: [taskId] },
    );
    expect(counts).toEqual([{ task_id: taskId, unread: 1 }]);

    // Back on the list through the page's back control: the marker is gone for them.
    if (phone(page)) await page.goBack();
    await expect(chatSheet(page)).toBeHidden();
    await page.locator('[data-slot="page-back"]:visible').first().click();
    await expect(page).toHaveURL(/\/tasks$/);
    await expect(row).toBeVisible();
    await expect(row.locator('[data-slot="task-unread"]')).toHaveCount(0);
  });

  test("the marker is on All tasks and on Approvals' task rows too", async ({ page }, info) => {
    const prefix = `Markers ${info.project.name} `;
    await removeTasksTitled(prefix);
    const staff = person("staff", info);
    const staffId = await memberIdOf(staff.email);
    const taskId = await ownerCreates({
      title: `${prefix}banner`,
      assignees: [staffId],
      primary: staffId,
      day: 36,
    });
    await rpcAs(staff.email, PASSWORD, "task_submit_done", { task_id: taskId });
    await insertAs(staff.email, PASSWORD, "task_comments", {
      task_id: taskId,
      body: "Two sizes are in the note.",
    });

    await page.context().clearCookies();
    await signIn(page, USERS.owner.email, USERS.owner.password);
    await page.goto("/approvals");
    const approval = page.locator('[data-slot="approval-row"]', { hasText: `${prefix}banner` });
    await expect(approval.locator('[data-slot="task-unread"]')).toContainText("1 new comment");

    await page.goto("/tasks/all?state=review");
    const listed = page
      .locator('[data-slot="data-card"]:visible, [data-slot="table-row"]:visible')
      .filter({ hasText: `${prefix}banner` });
    await expect(listed.locator('[data-slot="task-unread"]')).toContainText("1 new comment");
  });
});

test.describe("Activity (decision 29)", () => {
  test.skip(({ viewport }) => viewport?.width === 430, "the flows run at 375px and desktop");
  test.use({ storageState: { cookies: [], origins: [] } });

  test("the newest five, Show all in place (no history), and ticks by one person in one line", async ({
    page,
  }, info) => {
    const prefix = `Activity ${info.project.name} `;
    await removeTasksTitled(prefix);
    const staffId = await memberIdOf(person("staff", info).email);
    const taskId = await ownerCreates({
      title: `${prefix}edit`,
      assignees: [staffId],
      primary: staffId,
      day: 37,
      stages: ["Cut", "Grade", "Mix", "Titles"],
    });
    await as(page, "staff", info);
    await page.goto("/tasks");
    await page.locator(`[data-slot="task-row"][data-task="${taskId}"] a`).click();
    await expect(page).toHaveURL(new RegExp(`/tasks/${taskId}$`));
    await live(page);
    for (const stage of ["Cut", "Grade", "Mix"]) {
      await page.getByRole("checkbox", { name: stage, exact: true }).click();
      await expect(
        page.locator('[data-slot="task-stage"]', { hasText: stage }).first(),
      ).toHaveAttribute("data-done", "true");
    }

    await tab(page, "activity").click();
    // Three ticks within ten minutes by the same person: one line (newest first).
    await expect(historyRows(page).first()).toContainText(
      `${person("staff", info).name} ticked “Cut”, “Grade” and “Mix”`,
    );
    // Created, assigned, four stages added, the ticks: more than five lines, five shown.
    await expect(historyRows(page)).toHaveCount(5);
    const all = page.locator('[data-slot="task-history-show-all"]');
    await expect(all).toHaveText(/^Show all \d+$/);
    const total = Number((await all.textContent())?.replace(/\D/g, ""));
    await all.click();
    await expect(historyRows(page)).toHaveCount(total);
    await expect(all).toHaveCount(0);
    await expect(historyRows(page).last()).toContainText("created the task");
    // Show all changed the view, not the page: one back returns to the list.
    await expect(page).toHaveURL(new RegExp(`\\?tab=activity$`));
    await page.goBack();
    await expect(page).toHaveURL(/\/tasks$/);
  });
});

test.describe("the task page on a phone, installed: back closes each layer, one back leaves", () => {
  test.skip(({ isMobile }) => !isMobile, "the installed back gesture is a phone's");
  test.use({ storageState: { cookies: [], origins: [] } });

  test("every view, the Chat sheet with its composer above the keyboard, Show all and ⋯", async ({
    page,
  }, info) => {
    const prefix = `Installed ${info.project.name} `;
    await removeTasksTitled(prefix);
    const staff = person("staff", info);
    const helper = person("helper", info);
    const [staffId, helperId] = await Promise.all([
      memberIdOf(staff.email),
      memberIdOf(helper.email),
    ]);
    const taskId = await ownerCreates({
      title: `${prefix}vlog`,
      assignees: [staffId, helperId],
      primary: staffId,
      day: 38,
      // A history long enough to scroll the page well past the views' bar, at 430px too.
      stages: Array.from({ length: 14 }, (_, index) => `Stage ${index + 1}`),
    });
    await insertAs(helper.email, PASSWORD, "task_comments", {
      task_id: taskId,
      body: "Starting on the b-roll.",
    });
    await runInstalled(page);
    await as(page, "staff", info);
    await page.goto("/my-day");
    await page.locator('[data-slot="bottom-nav"] [data-nav="tasks"]').click();
    await expect(page).toHaveURL(/\/tasks$/);
    await page.locator(`[data-slot="task-row"][data-task="${taskId}"] a`).click();
    const url = new RegExp(`/tasks/${taskId}(\\?tab=\\w+)?$`);
    await expect(page).toHaveURL(url);
    await hydrated(page);
    await live(page);

    // Every view: replaced, so each back below leaves from wherever it was.
    for (const view of ["activity", "details", "work"]) {
      await tab(page, view).click();
      await expect(tab(page, view)).toHaveAttribute("aria-current", "true");
    }
    await tab(page, "activity").click();
    await page.locator('[data-slot="task-history-show-all"]').click();
    // Scrolled down the whole history, the views' bar sticks right under the title bar.
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await expect
      .poll(async () => {
        const header = await page.locator('[data-slot="page-header"]:visible').boundingBox();
        const band = await page.locator('[data-slot="task-tabs-band"]').boundingBox();
        return header && band ? Math.round(band.y - (header.y + header.height)) : null;
      })
      .toBe(0);
    await expect(page.locator('[data-slot="task-tabs-band"]')).toBeInViewport();

    // The Chat sheet is a layer: full height, back closes it.
    await tab(page, "chat").click();
    const sheet = chatSheet(page);
    await expect(sheet).toBeVisible();
    // Measured once it has slid in.
    await animationsSettled(page);
    const viewport = page.viewportSize() as { width: number; height: number };
    const box = (await sheet.boundingBox()) as { y: number; height: number };
    expect(box.y).toBeLessThanOrEqual(24);
    expect(Math.round(box.y + box.height)).toBe(viewport.height);
    // The composer stays above the keyboard (visualViewport).
    await openKeyboard(page, 300);
    const composer = sheet.locator('[data-slot="task-chat-composer"]');
    await expect
      .poll(async () => {
        const rect = await composer.boundingBox();
        return rect ? Math.round(rect.y + rect.height) : Infinity;
      })
      .toBeLessThanOrEqual(viewport.height - 300);
    await expect(sheet.getByRole("heading", { name: "Chat" })).toBeInViewport();
    await closeKeyboard(page);
    await expectBackStack(page, [{ closes: sheet, url }]);
    await expect(tab(page, "activity")).toHaveAttribute("aria-current", "true");

    // ⋯ and a dialog it opens are layers too.
    await page.getByRole("button", { name: "Task actions" }).click();
    const menu = page.getByRole("menu");
    await expect(menu).toBeVisible();
    await expectBackStack(page, [{ closes: menu, url }]);
    await page.getByRole("button", { name: "Task actions" }).click();
    await page.getByRole("menuitem", { name: "Mark done" }).click();
    const done = page.locator('[data-slot="task-done-dialog"]');
    await expect(done).toBeVisible();
    await expectBackStack(page, [{ closes: done, url }]);

    // One back leaves the task for Tasks, then Tasks for home.
    await expectBackStack(page, [{ url: /\/tasks$/ }, { url: /\/my-day$/ }]);
  });

  test("arriving on the conversation opens the Chat sheet over Work; back closes it, then leaves", async ({
    page,
  }, info) => {
    const prefix = `Arrive ${info.project.name} `;
    await removeTasksTitled(prefix);
    const staffId = await memberIdOf(person("staff", info).email);
    const taskId = await ownerCreates({
      title: `${prefix}promo`,
      assignees: [staffId],
      primary: staffId,
      day: 39,
    });
    await runInstalled(page);
    await as(page, "staff", info);
    await page.goto("/tasks");
    await page.goto(`/tasks/${taskId}?tab=chat`);
    await live(page);
    await expect(chatSheet(page)).toBeVisible();
    await expect(tab(page, "work")).toHaveAttribute("aria-current", "true");
    await expect(chatSheet(page).locator('[data-slot="task-comments-empty"]')).toBeVisible();
    await expectBackStack(page, [
      { closes: chatSheet(page), url: new RegExp(`/tasks/${taskId}\\?tab=chat$`) },
      { url: /\/tasks$/ },
    ]);
  });
});

test.describe("the task page at large system text (decision 31)", () => {
  test.skip(({ isMobile }) => !isMobile, "phone widths");
  test.use({ storageState: storageStateFor("owner") });

  test("each view and the Chat sheet fit at 130% and 200%; the views' bar scrolls instead of squeezing", async ({
    page,
  }, info) => {
    const prefix = `Large views ${info.project.name} `;
    await removeTasksTitled(prefix);
    const staffId = await memberIdOf(person("staff", info).email);
    const helperId = await memberIdOf(person("helper", info).email);
    const taskId = await ownerCreates({
      title: `${prefix}a task title long enough to wrap in the title bar`,
      assignees: [staffId, helperId],
      primary: staffId,
      day: 40,
      stages: ["A stage with a long name that wraps", "Two"],
      description: "A brief with a link: https://example.com/a/rather/long/path/to/the/brief",
    });
    await insertAs(person("staff", info).email, PASSWORD, "task_comments", {
      task_id: taskId,
      body: "A comment long enough to wrap onto a second line on a small phone, surely.",
    });
    await page.goto(`/tasks/${taskId}`);
    await hydrated(page);
    await live(page);
    const scale = async (percent: number) =>
      page.evaluate((value) => {
        document.documentElement.style.fontSize = value ? `${value}%` : "";
      }, percent);

    for (const view of ["work", "activity", "details"]) {
      await tab(page, view).click();
      for (const percent of [130, 200]) {
        await scale(percent);
        await expectNoHorizontalScroll(page);
      }
      await scale(0);
    }
    // At 200% the views' bar is wider than the phone: it scrolls, its targets stay 44px.
    await scale(200);
    const bar = page.locator('[data-slot="task-tabs"]');
    await expect.poll(() => bar.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
    for (const cell of await page.locator('[data-slot="task-tab"]:visible').all()) {
      const rect = await cell.boundingBox();
      expect(rect?.height ?? 0).toBeGreaterThanOrEqual(44);
    }
    await scale(0);

    await tab(page, "chat").click();
    await expect(chatSheet(page)).toBeVisible();
    for (const percent of [130, 200]) {
      await scale(percent);
      await expectNoHorizontalScroll(page);
      await expect(chatSheet(page).getByRole("button", { name: "Send" })).toBeInViewport();
    }
    await scale(0);
  });
});
