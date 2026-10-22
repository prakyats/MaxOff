import { type Locator, type Page, type Request, type TestInfo } from "@playwright/test";

import { expect, test } from "./fixtures";

import { addISTDays, istInstant, istWeekday, systemClock, todayIST } from "../src/core/time";

import {
  dockTop,
  animationsSettled,
  closeKeyboard,
  expectBackStack,
  expectNoHorizontalScroll,
  hydrated,
  insertAs,
  memberIdOf,
  openKeyboard,
  removeTasksTitled,
  rpcAs,
  rpcRefusedAs,
  runInstalled,
  serviceSelect,
  serviceUpdate,
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

/**
 * The task page sends read receipts in the background: the bell's (`/api/notifications/read-record`)
 * as it opens (kickoff 5 decision 4) and Chat's (`/api/tasks/read`) as Chat opens (decision 28),
 * plain requests since ARCHITECTURE §4.4, no longer server actions. They used to revalidate
 * the screen, and one answering while the view was being switched (`history.replaceState`) made
 * Next reload the page under the spec (5A review S4); since the owner's decision of 2026-10-01 no
 * read revalidates anything (`notifications.spec` proves the page is never reloaded). An action
 * still running at a test's end also raced the next repetition's cleanup (a `task_reads` row for
 * a task being deleted: 23503 → 409). So a spec lets the screen settle as a person would: every
 * server action and background call (`/api/`) this page sent has answered and the answer is
 * painted. Nothing is sent again; this only waits.
 */
const actionsInFlight = new WeakMap<Page, Set<Request>>();

function trackActions(page: Page): void {
  const pending = new Set<Request>();
  actionsInFlight.set(page, pending);
  page.on("request", (request) => {
    if (
      (request.method() === "POST" && request.headers()["next-action"]) ||
      new URL(request.url()).pathname.startsWith("/api/")
    ) {
      pending.add(request);
    }
  });
  // A new document (a reload, a back across a full load) ends the old one's requests: one still
  // out then never answers, and Chromium reports no failure for it. The new document's own
  // actions start after it has loaded (they are sent from effects).
  page.on("domcontentloaded", () => pending.clear());
  page.on("requestfinished", (request) => pending.delete(request));
  page.on("requestfailed", (request) => pending.delete(request));
}

async function receiptsSettled(page: Page): Promise<void> {
  const pending = actionsInFlight.get(page);
  expect(pending, "the page's server actions are tracked (beforeEach)").toBeTruthy();
  await expect
    .poll(() => pending!.size, { message: "every server action and background call answered" })
    .toBe(0);
  // The answer's re-render committed and painted.
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
}

/**
 * The fixture's notifications about this task, read before the page opens: they are not what a
 * layout spec is about, and an unread one makes the page send the bell's receipt, whose read then
 * comes back as a Realtime event seconds later (it asks the server for the bell's count), in the
 * middle of a measurement (5A review S4).
 */
async function fixtureNotificationsRead(taskId: string): Promise<void> {
  await serviceUpdate(`notifications?entity_id=eq.${taskId}&read_at=is.null`, {
    read_at: systemClock().toISOString(),
  });
}

test.beforeEach(({ page }) => {
  trackActions(page);
});

test.afterEach(async ({ page }) => {
  // No read receipt outlives its test (the next repetition deletes the task it is about).
  if (!page.isClosed()) await receiptsSettled(page);
});

/**
 * The views' bar has hydrated: a tap on it is the app's from then on. And the read receipt the
 * page sent on opening has answered (see `receiptsSettled`).
 */
async function live(page: Page): Promise<void> {
  await expect(page.locator('[data-slot="task-tabs"]')).toHaveAttribute("data-live", "");
  await receiptsSettled(page);
}
const panel = (page: Page, view: string) => page.locator(`[data-slot="task-panel-${view}"]`);
const chatSheet = (page: Page) => page.locator('[data-slot="task-chat-sheet"]');
const historyRows = (page: Page) => page.locator('[data-slot="task-history-row"]:visible');
/** The header's History sheet (the one History pattern, v1.8 consistency sweep). */
const historySheet = (page: Page) =>
  page.locator('[data-slot="review-sheet"]:has([data-slot="history-sheet"])');
/** Opens the task's History from the header's clock. */
async function openHistory(page: Page): Promise<void> {
  await page.locator('[data-slot="history-open"]:visible').click();
  await expect(historySheet(page)).toBeVisible();
}
const phone = (page: Page) => (page.viewportSize()?.width ?? 1280) < 768;

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
    // The colour plan (owner 2026-10-21): Mark done is the Forest green approve.
    await expect(step(page).getByRole("button", { name: "Mark done" })).toHaveAttribute(
      "data-variant",
      "approve",
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
    // The colour plan (owner 2026-10-21): Approve is the Forest green approve, Request changes a
    // quiet outline (a second choice).
    await expect(step(page).getByRole("button", { name: "Approve" })).toHaveAttribute(
      "data-variant",
      "approve",
    );
    await expect(step(page).getByRole("button", { name: "Request changes" })).toHaveAttribute(
      "data-variant",
      "secondary",
    );
    await expect(page.locator('[data-variant="primary"]:visible')).toHaveCount(0);
    await expect(page.locator('[data-slot="task-needed"]')).toHaveText(
      "Approve it to complete the task, or ask for changes.",
    );
  });

  test('a reopened task keeps its old hand-in as "Earlier hand-in · reopened …", collapsed (B5)', async ({
    page,
  }, info) => {
    const prefix = `Reopened ${info.project.name} `;
    await removeTasksTitled(prefix);
    const staff = person("staff", info);
    const staffId = await memberIdOf(staff.email);
    const taskId = await ownerCreates({
      title: `${prefix}edit`,
      assignees: [staffId],
      primary: staffId,
      day: 33,
    });
    await rpcAs(staff.email, PASSWORD, "task_submit_done", { task_id: taskId, note: "First cut" });
    await rpcAs(USERS.owner.email, USERS.owner.password, "task_review", {
      task_id: taskId,
      decision: "approved",
    });
    await rpcAs(USERS.owner.email, USERS.owner.password, "task_reopen", {
      task_id: taskId,
      reason: "simple",
    });
    const day = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Kolkata",
      day: "numeric",
      month: "short",
    }).format(systemClock());
    // The Owner and the Crew member see the same: the hand-in is earlier work, not the state.
    for (const who of [
      { email: USERS.owner.email, password: USERS.owner.password },
      { email: staff.email, password: PASSWORD },
    ]) {
      await page.context().clearCookies();
      await signIn(page, who.email, who.password);
      await page.goto(`/tasks/${taskId}?tab=work`);
      const earlier = panel(page, "work").locator('[data-slot="task-hand-in-earlier"]');
      await expect(earlier.locator("summary")).toHaveText(
        `Earlier hand-in · reopened ${day}: "simple"`,
      );
      await expect(earlier).not.toHaveAttribute("open", /.*/);
      await expect(earlier.getByText("First cut")).toBeHidden();
      await earlier.locator("summary").click();
      await expect(earlier.getByText("First cut")).toBeVisible();
      await expect(earlier).toContainText("Marked done by");
    }
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
    await hydrated(page);
    // Opened from a list, a task lands on Work.
    await page.locator(`[data-slot="task-row"][data-task="${taskId}"] a`).click();
    await expect(page).toHaveURL(new RegExp(`/tasks/${taskId}$`));
    await live(page);
    await expect(tab(page, "work")).toHaveAttribute("aria-current", "true");
    await expect(panel(page, "work")).toBeVisible();

    // Another view (V5a: Activity left the views for the header's History sheet): Chat on a
    // desktop, Details on a phone.
    const other = phone(page) ? "details" : "chat";
    await tab(page, other).click();
    await expect(page).toHaveURL(new RegExp(`/tasks/${taskId}\\?tab=${other}$`));
    await expect(panel(page, other)).toBeVisible();
    await expect(panel(page, "work")).toBeHidden();
    // The views never switch by themselves: an action's answer leaves the view where it is.
    await step(page).getByRole("button", { name: "Task Noted" }).click();
    await expect(step(page).getByRole("button", { name: "Start work" })).toBeVisible();
    await expect(tab(page, other)).toHaveAttribute("aria-current", "true");
    // The history is the header's History sheet, a layer over the view.
    await openHistory(page);
    await expect(historyRows(page).first()).toContainText("noted the task");
    await page.keyboard.press("Escape");
    await expect(historySheet(page)).toHaveCount(0);
    await expect(tab(page, other)).toHaveAttribute("aria-current", "true");

    if (phone(page)) {
      await tab(page, "details").click();
      await expect(page).toHaveURL(new RegExp(`\\?tab=details$`));
      await expect(panel(page, "details")).toBeVisible();
    } else {
      // No Details view on a desktop: it is the right panel, always there.
      await expect(tab(page, "details")).toBeHidden();
      await expect(panel(page, "details")).toBeVisible();
    }
    // A refresh (or a shared link) keeps the view: the address holds it (written once the
    // router has nothing in flight, `view-address.ts`), and a reload lands on it.
    await tab(page, other).click();
    await expect(page).toHaveURL(new RegExp(`/tasks/${taskId}\\?tab=${other}$`));
    await page.reload();
    await expect(tab(page, other)).toHaveAttribute("aria-current", "true");
    await expect(panel(page, other)).toBeVisible();
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
    // The browser tab names the task (v1.8 pull-in item 5), not "Task".
    await expect(page).toHaveTitle(`${prefix}layout · MaxOff`);
    const main = await page.locator('[data-slot="task-tabs"]').boundingBox();
    const details = await panel(page, "details").boundingBox();
    expect(details?.x ?? 0).toBeGreaterThan((main?.x ?? 0) + (main?.width ?? 0));
    await expect(panel(page, "details")).toHaveCSS("position", "sticky");
    await expect(panel(page, "details")).toContainText(person("staff", info).name);
    await expect(tab(page, "details")).toBeHidden();
    // Activity is the header's History now (V5a).
    await expect(page.locator('[data-slot="task-tab"]:visible')).toHaveText(["Work", "Chat"]);
    await tab(page, "chat").click();
    await expect(panel(page, "chat")).toBeVisible();
    await expect(panel(page, "chat").getByRole("textbox", { name: "Message" })).toBeVisible();
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
    await hydrated(page);
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
    await composer.getByRole("textbox", { name: "Message" }).fill("Got it, thanks.");
    // One solid commit per layer (decision 26, phase 4 review A-M1): Send is solid only in the
    // phone's sheet, its own layer; inline on desktop it sits beside the next step's solid button.
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

  test("keys: a laptop sends on Enter and Shift+Enter adds a line; a phone's Enter is a new line (§14.3 rule 1)", async ({
    page,
  }, info) => {
    const prefix = `Keys ${info.project.name} `;
    await removeTasksTitled(prefix);
    const staff = person("staff", info);
    const helper = person("helper", info);
    const [staffId, helperId] = await Promise.all([
      memberIdOf(staff.email),
      memberIdOf(helper.email),
    ]);
    const taskId = await ownerCreates({
      title: `${prefix}chat`,
      assignees: [staffId, helperId],
      primary: staffId,
      day: 41,
    });
    await fixtureNotificationsRead(taskId);

    await as(page, "staff", info);
    await page.goto(`/tasks/${taskId}`);
    await live(page);
    await tab(page, "chat").click();
    const chat = phone(page) ? chatSheet(page) : panel(page, "chat");
    const box = chat.getByRole("textbox", { name: "Message" });
    const own = chat.locator('[data-slot="task-comment"][data-own="true"]');
    const hint = chat.locator('[data-slot="composer-hint"]');
    await expect(box).toBeVisible();

    if (phone(page)) {
      // Touch: Enter is a new line and never sends; Send sends. No hint.
      expect(await page.evaluate(() => matchMedia("(any-pointer: coarse)").matches)).toBe(true);
      await box.click();
      await page.keyboard.type("First line");
      await page.keyboard.press("Enter");
      await page.keyboard.type("second line");
      await expect(box).toHaveValue("First line\nsecond line");
      await expect(own).toHaveCount(0);
      await expect(hint).toHaveCount(0);
      await chat.getByRole("button", { name: "Send" }).click();
      await expect(own).toHaveCount(1);
      await expect(own).toContainText("second line");
      await expect(box).toHaveValue("");
      await page.goBack();
      await expect(chatSheet(page)).toBeHidden();
      return;
    }

    // A laptop: the hint, quietly; Enter sends, Shift+Enter is a new line.
    expect(
      await page.evaluate(
        () =>
          matchMedia("(pointer: fine) and (hover: hover)").matches &&
          !matchMedia("(any-pointer: coarse)").matches,
      ),
    ).toBe(true);
    await expect(hint).toHaveText("Enter to send · Shift+Enter for a new line");
    await box.click();
    // Nothing to send: Enter neither sends nor makes a line (and says nothing).
    await page.keyboard.press("Enter");
    await expect(box).toHaveValue("");
    await page.keyboard.type("   ");
    await page.keyboard.press("Enter");
    await expect(box).toHaveValue("   ");
    await expect(chat.getByText("Write something first.")).toHaveCount(0);
    await box.fill("");
    await page.keyboard.type("First line");
    await page.keyboard.press("Shift+Enter");
    await page.keyboard.type("second line");
    await expect(box).toHaveValue("First line\nsecond line");
    await expect(own).toHaveCount(0);
    await page.keyboard.press("Enter");
    await expect(own).toHaveCount(1);
    await expect(own).toContainText("First line");
    await expect(own).toContainText("second line");
    // Sent once, emptied, and the focus stays in the composer for the next message.
    await expect(box).toHaveValue("");
    await expect(box).toBeFocused();
    await receiptsSettled(page);
    await expect(own).toHaveCount(1);
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

/**
 * Chat as a conversation (v1.8 V5b E, the approved sample `docs/design/v18-task-chat-sample.html`):
 * the latest 50 messages in their own scroller, day lines, grouped bubbles, the red "New" line it
 * opens at, "Load earlier" and "Jump to latest".
 */
test.describe("Chat as a conversation (v1.8 V5b E)", () => {
  test.skip(({ viewport }) => viewport?.width === 430, "the flows run at 375px and desktop");
  test.use({ storageState: { cookies: [], origins: [] } });

  test("opens at the first unread under day lines; Load earlier keeps the place; Jump to latest", async ({
    page,
  }, info) => {
    const prefix = `Conversation ${info.project.name} `;
    await removeTasksTitled(prefix);
    const staff = person("staff", info);
    const helper = person("helper", info);
    const [staffId, helperId] = await Promise.all([
      memberIdOf(staff.email),
      memberIdOf(helper.email),
    ]);
    const taskId = await ownerCreates({
      title: `${prefix}reel`,
      assignees: [staffId, helperId],
      primary: staffId,
      day: 47,
    });
    // 52 of the helper's yesterday, a minute apart; today the Crew member's "Morning", then two
    // of the helper's. 55 in all: the page holds the latest 50, "Load earlier" the five before.
    const yesterday = addISTDays(todayIST(), -1);
    const earlier = Array.from({ length: 52 }, (_, index) => ({
      body: `Earlier ${String(index + 1).padStart(2, "0")}`,
      at: istInstant(yesterday, `10:${String(index).padStart(2, "0")}`),
    }));
    await postComments(helper.email, taskId, earlier);
    await postComments(staff.email, taskId, [
      { body: "Morning", at: istInstant(todayIST(), "00:05") },
    ]);
    await postComments(helper.email, taskId, [
      { body: "On it", at: istInstant(todayIST(), "00:06") },
      { body: "Uploading now", at: istInstant(todayIST(), "00:07") },
    ]);
    // The Crew member read up to their own "Morning": the helper's two after it are new.
    await rpcAs(staff.email, PASSWORD, "task_mark_read", {
      task_id: taskId,
      up_to: istInstant(todayIST(), "00:05"),
    });
    await fixtureNotificationsRead(taskId);

    await as(page, "staff", info);
    await page.goto(`/tasks/${taskId}?tab=chat`);
    await live(page);
    const chat = phone(page) ? chatSheet(page) : panel(page, "chat");
    await expect(chat).toBeVisible();
    const thread = chat.locator('[data-slot="task-chat-thread"]');
    const bubbles = chat.locator('[data-slot="task-comment"]');
    await expect(bubbles).toHaveCount(50);

    // Day lines, the grouping, and the "New" line where the unread start, in view on opening.
    await expect(chat.locator('[data-slot="chat-day"]')).toHaveText(["Yesterday", "Today"]);
    const newLine = chat.locator('[data-slot="chat-new-line"]');
    await expect(newLine).toHaveText("New");
    await expect(newLine).toBeInViewport();
    await expect(bubbles.first()).not.toBeInViewport();
    const groups = chat.locator('[data-slot="chat-group"]');
    await expect(groups).toHaveCount(3);
    await expect(groups.nth(1)).toHaveAttribute("data-own", "true");
    await expect(groups.nth(2).locator('[data-slot="task-comment"]')).toHaveText([
      /On it$/,
      /Uploading now$/,
    ]);
    // A bubble fits its text: "Morning" is a small one on the right.
    const own = (await groups.nth(1).locator('[data-slot="task-comment"]').boundingBox())!;
    const feed = (await thread.boundingBox())!;
    expect(own.width).toBeLessThan(feed.width / 2);
    expect(own.x + own.width).toBeGreaterThan(feed.x + feed.width / 2);

    // Load earlier, at the top: the five before; the message that was first stays in view.
    await thread.evaluate((node) => {
      node.scrollTop = 0;
    });
    await chat.locator('[data-slot="chat-load-earlier"]').click();
    await expect(bubbles).toHaveCount(55);
    await expect(chat.locator('[data-slot="chat-load-earlier"]')).toHaveCount(0);
    await expect(bubbles.filter({ hasText: "Earlier 06" })).toBeInViewport();
    await expect(bubbles.first()).toContainText("Earlier 01");

    // Scrolled up, a new message arrives (its notification re-reads the page): Jump to latest.
    await expect(page.locator("html")).toHaveAttribute("data-live", "on");
    await insertAs(helper.email, PASSWORD, "task_comments", {
      task_id: taskId,
      body: "Fresh from the edit suite",
    });
    const fresh = bubbles.filter({ hasText: "Fresh from the edit suite" });
    await expect(fresh).toHaveCount(1);
    await expect(fresh).not.toBeInViewport();
    const jump = chat.locator('[data-slot="chat-jump"]');
    await expect(jump).toHaveText("Jump to latest");
    await jump.click();
    await expect(fresh).toBeInViewport();
    await expect(jump).toHaveCount(0);
    await receiptsSettled(page);
    if (phone(page)) {
      await page.goBack();
      await expect(chatSheet(page)).toBeHidden();
    }
  });
});

/** Posts comments as one person, then sets their times (the API stamps "now"). */
async function postComments(
  email: string,
  taskId: string,
  rows: readonly { body: string; at: string }[],
): Promise<void> {
  for (const row of rows) {
    const comment = await insertAs<{ id: string }>(email, PASSWORD, "task_comments", {
      task_id: taskId,
      body: row.body,
    });
    await serviceUpdate(`task_comments?id=eq.${comment.id}`, { created_at: row.at });
  }
}

test.describe("History (decision 29; the header's History sheet since V5a)", () => {
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
    await hydrated(page);
    await page.locator(`[data-slot="task-row"][data-task="${taskId}"] a`).click();
    await expect(page).toHaveURL(new RegExp(`/tasks/${taskId}$`));
    await live(page);
    for (const stage of ["Cut", "Grade", "Mix"]) {
      await page.getByRole("checkbox", { name: stage, exact: true }).click();
      await expect(
        page.locator('[data-slot="task-stage"]', { hasText: stage }).first(),
      ).toHaveAttribute("data-done", "true");
    }

    await openHistory(page);
    // Three ticks within ten minutes by the same person: one line (newest first). The reader's
    // own changes say "You" (v1.8 pull-in item 5).
    await expect(historyRows(page).first()).toContainText(`You ticked “Cut”, “Grade” and “Mix”`);
    // Created, assigned, four stages added, the ticks: more than five lines, five shown.
    await expect(historyRows(page)).toHaveCount(5);
    const all = page.locator('[data-slot="task-history-show-all"]');
    await expect(all).toHaveText(/^Show all \d+$/);
    const total = Number((await all.textContent())?.replace(/\D/g, ""));
    await all.click();
    await expect(historyRows(page)).toHaveCount(total);
    await expect(all).toHaveCount(0);
    await expect(historyRows(page).last()).toContainText("created the task");
    // Show all changed the sheet, not the page: back closes the sheet, the next leaves the task.
    await expect(page).toHaveURL(new RegExp(`/tasks/${taskId}$`));
    await expectBackStack(page, [
      { closes: historySheet(page), url: new RegExp(`/tasks/${taskId}$`) },
      { url: /\/tasks$/ },
    ]);
  });

  test("an old ?tab=activity link lands on Work with the History sheet open", async ({
    page,
  }, info) => {
    const prefix = `Old activity ${info.project.name} `;
    await removeTasksTitled(prefix);
    const staffId = await memberIdOf(person("staff", info).email);
    const taskId = await ownerCreates({
      title: `${prefix}link`,
      assignees: [staffId],
      primary: staffId,
      day: 37,
    });
    await as(page, "staff", info);
    await page.goto(`/tasks/${taskId}?tab=activity`);
    await live(page);
    await expect(historySheet(page)).toBeVisible();
    await expect(historyRows(page).last()).toContainText("created the task");
    await expect(tab(page, "work")).toHaveAttribute("aria-current", "true");
    // The address drops the old parameter (replaced).
    await expect(page).toHaveURL(new RegExp(`/tasks/${taskId}$`));
    await page.keyboard.press("Escape");
    await expect(historySheet(page)).toHaveCount(0);
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
    await fixtureNotificationsRead(taskId);
    await runInstalled(page);
    await as(page, "staff", info);
    await page.goto("/my-day");
    await page.locator('[data-slot="bottom-nav"] [data-nav="tasks"]').click();
    await expect(page).toHaveURL(/\/tasks$/);
    await hydrated(page);
    await page.locator(`[data-slot="task-row"][data-task="${taskId}"] a`).click();
    const url = new RegExp(`/tasks/${taskId}(\\?tab=\\w+)?$`);
    await expect(page).toHaveURL(url);
    await hydrated(page);
    await live(page);

    // Every view: replaced, so each back below leaves from wherever it was.
    for (const view of ["details", "work"]) {
      await tab(page, view).click();
      await expect(tab(page, view)).toHaveAttribute("aria-current", "true");
    }
    // The History sheet (V5a) is a layer: Show all inside it, back closes it.
    await openHistory(page);
    const showAll = historySheet(page).locator('[data-slot="task-history-show-all"]');
    const lines = Number((await showAll.textContent())?.match(/\d+/)?.[0]);
    await showAll.click();
    // The whole history is on screen before it is scrolled, as a person sees it open first. A
    // Show all tapped while the view switch's own page request is still out (Next re-requests
    // the page for the new `?tab=`) can paint a few hundred ms later, and a scroll made before
    // that moved a page that was still short (PROGRESS Ideas (h): the gap of 101–104 px).
    await expect(historyRows(page)).toHaveCount(lines);
    await expectBackStack(page, [{ closes: historySheet(page), url }]);
    // Scrolled down the whole page (the 14 stages), the views' bar sticks right under the title
    // bar.
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
    // Chat's read receipt (the helper's comment) has answered before anything is measured.
    await receiptsSettled(page);
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
    await expect(tab(page, "work")).toHaveAttribute("aria-current", "true");

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

  test("Chat is a full-height view: ‹ returns to the task, the gesture too, then one back leaves", async ({
    page,
  }, info) => {
    const prefix = `Chat view ${info.project.name} `;
    await removeTasksTitled(prefix);
    const staffId = await memberIdOf(person("staff", info).email);
    const helper = person("helper", info);
    const taskId = await ownerCreates({
      title: `${prefix}promo`,
      assignees: [staffId, await memberIdOf(helper.email)],
      primary: staffId,
      day: 52,
    });
    await insertAs(helper.email, PASSWORD, "task_comments", {
      task_id: taskId,
      body: "The first cut is up.",
    });
    await fixtureNotificationsRead(taskId);
    await runInstalled(page);
    await as(page, "staff", info);
    await page.goto("/tasks");
    await page.goto(`/tasks/${taskId}`);
    const url = new RegExp(`/tasks/${taskId}(\\?tab=\\w+)?$`);
    await live(page);

    // Full height, its own title with ‹, the composer at its foot.
    await tab(page, "chat").click();
    const sheet = chatSheet(page);
    await expect(sheet).toBeVisible();
    await receiptsSettled(page);
    await animationsSettled(page);
    const viewport = page.viewportSize() as { width: number; height: number };
    const box = (await sheet.boundingBox()) as { y: number; height: number };
    expect(box.y).toBe(0);
    expect(Math.round(box.y + box.height)).toBe(viewport.height);
    await expect(sheet.getByRole("heading", { name: `${prefix}promo · Chat` })).toBeVisible();
    const composer = (await sheet.locator('[data-slot="task-chat-composer-row"]').boundingBox())!;
    expect(Math.round(composer.y + composer.height)).toBe(viewport.height);
    await expect(sheet.locator('[data-slot="task-comment"]')).toContainText("The first cut is up.");

    // ‹ returns to the task (the layer's own back), the gesture too, then back leaves.
    await sheet.getByRole("button", { name: "Back to the task" }).click();
    await expect(sheet).toBeHidden();
    await expect(page).toHaveURL(url);
    await tab(page, "chat").click();
    await expect(chatSheet(page)).toBeVisible();
    await expectBackStack(page, [{ closes: chatSheet(page), url }, { url: /\/tasks$/ }]);
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
    await fixtureNotificationsRead(taskId);
    await page.goto(`/tasks/${taskId}`);
    await hydrated(page);
    await live(page);
    const scale = async (percent: number) =>
      page.evaluate((value) => {
        document.documentElement.style.fontSize = value ? `${value}%` : "";
      }, percent);

    for (const view of ["work", "details"]) {
      await tab(page, view).click();
      for (const percent of [130, 200]) {
        await scale(percent);
        await expectNoHorizontalScroll(page);
      }
      await scale(0);
    }
    // The History sheet (V5a, was the Activity view) fits too.
    await openHistory(page);
    for (const percent of [130, 200]) {
      await scale(percent);
      await expectNoHorizontalScroll(page);
    }
    await scale(0);
    await page.keyboard.press("Escape");
    await expect(historySheet(page)).toHaveCount(0);
    // At 200% the views' bar is wider than the phone: it scrolls, its targets stay 44px.
    await scale(200);
    const bar = page.locator('[data-slot="task-tabs"]');
    await expect.poll(() => bar.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
    for (const cell of await page.locator('[data-slot="task-tab"]:visible').all()) {
      await expect
        .poll(async () => (await cell.boundingBox())?.height ?? 0)
        .toBeGreaterThanOrEqual(44);
    }
    await scale(0);

    await tab(page, "chat").click();
    await expect(chatSheet(page)).toBeVisible();
    // Chat's read receipt (the Crew member's comment) has answered before anything is measured.
    await receiptsSettled(page);
    for (const percent of [130, 200]) {
      await scale(percent);
      await expectNoHorizontalScroll(page);
      await expect(chatSheet(page).getByRole("button", { name: "Send" })).toBeInViewport();
    }
    await scale(0);
  });
});

/** The checklist's stage names, in the order the page shows them. */
async function stageOrder(page: Page): Promise<(string | null)[]> {
  return page
    .locator('[data-slot="task-stage"] [role="checkbox"]')
    .evaluateAll((boxes) => boxes.map((box) => box.getAttribute("aria-label")));
}

/** A stage's row on the task page, by its name. */
const stageRow = (page: Page, name: string) =>
  page.locator('[data-slot="task-stage"]', { hasText: name });

/**
 * Drags the row `from` by its handle until the pointer is at `at` of the row `onto`'s height
 * (6b.18). A laptop's mouse drags at once; a phone's finger holds first: the long press is done
 * when the row lifts (`data-dragging`), so nothing here waits on a clock. Measures only visible
 * boxes and fails on a missing one.
 */
async function dragStage(page: Page, from: Locator, onto: Locator, at: number): Promise<void> {
  const handle = from.locator('[data-slot="reorder-handle"]');
  // In the middle of its scroller, as a person would have it, clear of a sticky footer or bar.
  await handle.evaluate((node) => node.scrollIntoView({ block: "center" }));
  const start = await handle.boundingBox();
  const target = await onto.boundingBox();
  expect(start, "the drag handle has a box").not.toBeNull();
  expect(target, "the target row has a box").not.toBeNull();
  const x = start!.x + start!.width / 2;
  const y = start!.y + start!.height / 2;
  const to = target!.y + target!.height * at;
  const indicator = page.locator('[data-slot="reorder-indicator"]:visible');
  if (!phone(page)) {
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x, to, { steps: 12 });
    await expect(indicator).toHaveCount(1);
    await page.mouse.up();
    return;
  }
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
  // The long press: held still until the row lifts.
  await expect(from).toHaveAttribute("data-dragging", "");
  for (let move = 1; move <= 12; move += 1) {
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x, y: y + ((to - y) * move) / 12 }],
    });
  }
  await expect(indicator).toHaveCount(1);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await cdp.detach();
}

/** A task made by the test Admin (so they are its creator, within its edit scope). */
async function adminCreates(
  info: TestInfo,
  args: { title: string; assignees: string[]; primary: string; day: number; stages: string[] },
): Promise<string> {
  return rpcAs<string>(person("admin", info).email, PASSWORD, "task_create", {
    title: args.title,
    description: null,
    task_type_id: await taskTypeId("Normal"),
    client_id: null,
    priority: "medium",
    due_at: istInstant(workingDay(args.day), "18:00"),
    assignee_ids: args.assignees,
    primary_owner_id: args.primary,
    approving_admin_id: null,
    stages: args.stages,
  });
}

test.describe("drag to reorder a task's stages (6b.18, owner 2026-10-15: the editors, never Crew)", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("the approving Admin drags a stage on an existing task: the tick stays, the order is saved, the history says so; the Crew on it get no handle", async ({
    page,
  }, info) => {
    const prefix = `Reorder ${info.project.name} `;
    await removeTasksTitled(prefix);
    const admin = person("admin", info);
    const [staffId, helperId, adminId] = await Promise.all([
      memberIdOf(person("staff", info).email),
      memberIdOf(person("helper", info).email),
      memberIdOf(admin.email),
    ]);
    const taskId = await ownerCreates({
      title: `${prefix}reel`,
      assignees: [staffId, helperId],
      primary: staffId,
      day: 42,
      approver: adminId,
      stages: ["Stage 1", "Stage 2", "Stage 3", "Stage 4"],
    });
    await fixtureNotificationsRead(taskId);
    // The helper is on the task (Crew): they tick, and see no handle and no ⋯ menu.
    await as(page, "helper", info);
    await page.goto(`/tasks/${taskId}`);
    await hydrated(page);
    await live(page);
    await expect(page.getByRole("button", { name: "Add stage" })).toHaveCount(0);
    await page.getByRole("checkbox", { name: "Stage 1", exact: true }).click();
    await expect(stageRow(page, "Stage 1")).toHaveAttribute("data-done", "true");
    await receiptsSettled(page);
    await expect(page.locator('[data-slot="task-stage"]')).toHaveCount(4);
    await expect(page.locator('[data-slot="reorder-handle"]')).toHaveCount(0);
    await expect(page.locator('[data-slot="task-stage-menu"]')).toHaveCount(0);

    // The approving Admin (within the task's edit scope) has a 44 px handle on every row.
    await as(page, "admin", info);
    await page.goto(`/tasks/${taskId}`);
    await hydrated(page);
    await live(page);
    await expect(page.locator('[data-slot="reorder-handle"]')).toHaveCount(4);
    const handle = stageRow(page, "Stage 4").locator('[data-slot="reorder-handle"]');
    const box = await handle.boundingBox();
    expect(box, "the handle has a box").not.toBeNull();
    expect(Math.round(box!.width)).toBe(44);
    expect(Math.round(box!.height)).toBe(44);

    // "Audio is for later": Stage 4 dragged up above Stage 2. No layout jump: the list keeps its
    // height through the drag, the new order and the saved one.
    const list = page.getByRole("list", { name: "Stages" });
    const before = await list.boundingBox();
    expect(before, "the list has a box").not.toBeNull();
    await dragStage(page, stageRow(page, "Stage 4"), stageRow(page, "Stage 2"), 0.2);
    await expect.poll(() => stageOrder(page)).toEqual(["Stage 1", "Stage 4", "Stage 2", "Stage 3"]);
    await receiptsSettled(page);
    const after = await list.boundingBox();
    expect(after, "the list has a box").not.toBeNull();
    expect(Math.round(after!.height)).toBe(Math.round(before!.height));
    await expect(stageRow(page, "Stage 1")).toHaveAttribute("data-done", "true");

    // Saved: in the database (the tick untouched) and after a reload.
    const saved = await serviceSelect<{ name: string; done_at: string | null }>(
      `task_stages?task_id=eq.${taskId}&select=name,done_at&order=position`,
    );
    expect(saved.map((stage) => stage.name)).toEqual(["Stage 1", "Stage 4", "Stage 2", "Stage 3"]);
    expect(saved.map((stage) => stage.done_at !== null)).toEqual([true, false, false, false]);
    await page.reload();
    await hydrated(page);
    await live(page);
    await expect.poll(() => stageOrder(page)).toEqual(["Stage 1", "Stage 4", "Stage 2", "Stage 3"]);
    await expect(stageRow(page, "Stage 1")).toHaveAttribute("data-done", "true");

    // Move down from the row's ⋯ menu: the keyboard and screen-reader way.
    await stageRow(page, "Stage 4").getByRole("button", { name: "Move Stage 4" }).click();
    await page.getByRole("menuitem", { name: "Move down" }).click();
    await expect.poll(() => stageOrder(page)).toEqual(["Stage 1", "Stage 2", "Stage 4", "Stage 3"]);
    await receiptsSettled(page);

    // The history: each move, by the Admin reading it ("You", v1.8 pull-in item 5), newest first.
    await openHistory(page);
    await expect(historyRows(page).first()).toContainText(
      `You moved the stage “Stage 4” to position 3 of 4`,
    );
    await expect(historyRows(page).nth(1)).toContainText(
      `You moved the stage “Stage 4” to position 2 of 4`,
    );
  });

  test("Crew never reorder: the database refuses an assignee, the primary owner and a Crew member not on the task; the Owner keeps the handle while the task is with its reviewers", async ({
    page,
  }, info) => {
    test.skip(info.project.name === "mobile-lg", "the flows run at 375px and desktop");
    const prefix = `Reorder locked ${info.project.name} `;
    await removeTasksTitled(prefix);
    const staff = person("staff", info);
    const helper = person("helper", info);
    const [staffId, helperId] = await Promise.all([
      memberIdOf(staff.email),
      memberIdOf(helper.email),
    ]);
    const handedIn = await ownerCreates({
      title: `${prefix}handed in`,
      assignees: [staffId, helperId],
      primary: staffId,
      day: 43,
      stages: ["Stage 1", "Stage 2"],
    });
    const notTheirs = await ownerCreates({
      title: `${prefix}not theirs`,
      assignees: [staffId],
      primary: staffId,
      day: 43,
      stages: ["Stage 1", "Stage 2"],
    });
    await rpcAs(staff.email, PASSWORD, "task_submit_done", { task_id: handedIn });
    await fixtureNotificationsRead(handedIn);

    const stagesOf = (taskId: string) =>
      serviceSelect<{ id: string }>(`task_stages?task_id=eq.${taskId}&select=id&order=position`);
    const [first] = await stagesOf(notTheirs);
    const refusedAssignee = await rpcRefusedAs(helper.email, PASSWORD, "task_stage_move", {
      task_id: handedIn,
      stage_id: (await stagesOf(handedIn))[1]!.id,
    });
    expect(refusedAssignee.message).toBe("FORBIDDEN");
    const refusedPrimary = await rpcRefusedAs(staff.email, PASSWORD, "task_stage_move", {
      task_id: notTheirs,
      stage_id: first!.id,
      after_stage_id: (await stagesOf(notTheirs))[1]!.id,
    });
    expect(refusedPrimary.message).toBe("FORBIDDEN");
    const refusedStranger = await rpcRefusedAs(helper.email, PASSWORD, "task_stage_move", {
      task_id: notTheirs,
      stage_id: first!.id,
    });
    expect(refusedStranger.message).toBe("NOT_FOUND");
    for (const taskId of [handedIn, notTheirs]) {
      const unchanged = await serviceSelect<{ name: string }>(
        `task_stages?task_id=eq.${taskId}&select=name&order=position`,
      );
      expect(unchanged.map((stage) => stage.name)).toEqual(["Stage 1", "Stage 2"]);
    }

    // The primary owner (Crew) sees the checklist with no handle and no ⋯ menu, before and after
    // handing in.
    await as(page, "staff", info);
    for (const taskId of [notTheirs, handedIn]) {
      await page.goto(`/tasks/${taskId}`);
      await hydrated(page);
      await live(page);
      await expect(page.locator('[data-slot="task-stage"]')).toHaveCount(2);
      await expect(page.locator('[data-slot="reorder-handle"]')).toHaveCount(0);
      await expect(page.locator('[data-slot="task-stage-menu"]')).toHaveCount(0);
    }

    // The Owner (the creator here) still has the handle and the menu while it is with the reviewers.
    await page.context().clearCookies();
    await signIn(page, USERS.owner.email, USERS.owner.password);
    await page.goto(`/tasks/${handedIn}`);
    await hydrated(page);
    await live(page);
    await expect(page.locator('[data-slot="reorder-handle"]')).toHaveCount(2);
    await expect(page.locator('[data-slot="task-stage-menu"]')).toHaveCount(2);
  });

  test("installed on a phone: back closes a stage's ⋯ menu for the Admin who made the task, and the task stays", async ({
    page,
  }, info) => {
    test.skip(!phone(page), "the installed back gesture is a phone's");
    const prefix = `Reorder back ${info.project.name} `;
    await removeTasksTitled(prefix);
    const staffId = await memberIdOf(person("staff", info).email);
    const taskId = await adminCreates(info, {
      title: `${prefix}promo`,
      assignees: [staffId],
      primary: staffId,
      day: 44,
      stages: ["Stage 1", "Stage 2"],
    });
    await fixtureNotificationsRead(taskId);
    await runInstalled(page);
    await as(page, "admin", info);
    await page.goto("/today");
    await page.locator('[data-slot="bottom-nav"] [data-nav="tasks"]').click();
    await expect(page).toHaveURL(/\/tasks$/);
    await hydrated(page);
    await page.locator(`[data-slot="task-row"][data-task="${taskId}"] a`).click();
    const url = new RegExp(`/tasks/${taskId}$`);
    await expect(page).toHaveURL(url);
    await hydrated(page);
    await live(page);

    await stageRow(page, "Stage 2").getByRole("button", { name: "Move Stage 2" }).click();
    const menu = page.getByRole("menu");
    await expect(menu).toBeVisible();
    await expect(menu.getByRole("menuitem", { name: "Move down" })).toBeDisabled();
    await expectBackStack(page, [{ closes: menu, url }]);
    await expect.poll(() => stageOrder(page)).toEqual(["Stage 1", "Stage 2"]);
    await expectBackStack(page, [{ url: /\/tasks$/ }, { url: /\/today$/ }]);
  });
});
