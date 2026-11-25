import type { Locator, Page } from "@playwright/test";

import { expect, test } from "./fixtures";

import {
  acceptFixtureInvite,
  hydrated,
  inviteFixturePerson,
  memberIdOf,
  removeFixturePerson,
  removeTasksTitled,
  rpcAs,
  serviceSelect,
  serviceUpdate,
  signIn,
  startPrompt,
  storageStateFor,
  taskTypeId,
  USERS,
} from "./helpers";
import { addISTDays, istInstant, todayIST } from "../src/core/time";

/**
 * Weak network, the core flows (v7.0 unit 2; ROADMAP "(Now v6.0–v7.0)" unit 2, owner decision
 * sheet 14 Nov 2026): Start day, a leave request, Task Noted and Mark done, End day, and the
 * Owner's Approve, each on a phone at **Slow 4G and CPU ×4**. Each must finish, show no "didn't
 * save" state, and land **exactly once** in the database: the slow answer is never a second
 * write.
 *
 * Slow 4G is Lighthouse's mobile preset as DevTools applies it (562.5 ms round trip, 1.47 Mbps
 * down, 675 kbps up), with the CPU four times slower, set through the Chrome DevTools Protocol on
 * each page once it is signed in (`throttle`). Its own project (`slow-4g`, 375 px, Chromium,
 * playwright.config.ts) with its own budget: a step's answer within 15 s, which is the database
 * call's 10 s limit (`core/db/timeout.ts`) and the screen's refresh after it. A fixture Crew member
 * of its own, so no other spec's person is touched.
 */
const EMAIL = "slow-4g-crew@maxoff.local";
const NAME = "Slow Network Crew";
const PASSWORD = "slow-4g-local-password";
const TASK = "Slow 4G: cut the teaser";

/** DevTools' Slow 4G (Lighthouse mobile, "devtools" throttling) and CPU ×4. */
const SLOW_4G = {
  offline: false,
  latency: 562.5,
  downloadThroughput: (1474.56 * 1024) / 8,
  uploadThroughput: (675 * 1024) / 8,
};
const CPU_SLOWDOWN = 4;

async function throttle(page: Page): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Network.emulateNetworkConditions", SLOW_4G);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: CPU_SLOWDOWN });
}

function strip(page: Page): Locator {
  return page.locator('[data-slot="attendance-strip"]');
}

/** No "Couldn't reach MaxOff" / "may not have saved" anywhere on the screen. */
async function expectNoFailure(page: Page): Promise<void> {
  await expect(page.locator('[data-slot="action-failed"]:visible')).toHaveCount(0);
}

test.describe.configure({ mode: "serial" });

let memberId = "";
let taskId = "";

test.beforeAll(async () => {
  await removeTasksTitled(TASK);
  const { id } = await inviteFixturePerson(EMAIL, NAME);
  await acceptFixtureInvite(id, EMAIL, PASSWORD);
  memberId = await memberIdOf(EMAIL);
  // Joined yesterday: someone who joined today has "Attendance starts tomorrow".
  await serviceUpdate(`members?id=eq.${memberId}`, {
    joined_at: istInstant(addISTDays(todayIST(), -1), "10:00"),
  });
  taskId = await rpcAs<string>(USERS.owner.email, USERS.owner.password, "task_create", {
    title: TASK,
    description: null,
    task_type_id: await taskTypeId("Normal"),
    client_id: null,
    priority: "medium",
    due_at: istInstant(addISTDays(todayIST(), 10), "18:00"),
    assignee_ids: [memberId],
    primary_owner_id: memberId,
    approving_admin_id: null,
    stages: [],
  });
});

test.afterAll(async () => {
  await removeTasksTitled(TASK);
  await removeFixturePerson(EMAIL);
});

test("Crew on Slow 4G: Start day, a leave request, Task Noted and Mark done, End day, each once", async ({
  page,
}) => {
  await signIn(page, EMAIL, PASSWORD, { day: "stop" });
  // The Start-day prompt, when the layout mounts it: "Just looking", so Start day is the strip's.
  if ((await page.locator('[data-slot="start-day-prompt-mount"]').count()) > 0) {
    await startPrompt(page).getByRole("button", { name: "Just looking" }).click();
    await expect(startPrompt(page)).toBeHidden();
  }
  await throttle(page);

  // Start day.
  await page.goto("/my-day");
  await hydrated(page);
  await strip(page)
    .getByRole("button", { name: /^Start day/ })
    .click();
  await expect(strip(page)).toHaveAttribute("data-kind", "started");
  await expectNoFailure(page);
  const days = await serviceSelect<{ id: string; started_at: string | null }>(
    `attendance_days?member_id=eq.${memberId}&work_date=eq.${todayIST()}&select=id,started_at`,
  );
  expect(days, "one day").toHaveLength(1);
  const dayId = days[0]!.id;
  const started = await serviceSelect<{ id: string }>(
    `attendance_events?attendance_day_id=eq.${dayId}&action=eq.started&select=id`,
  );
  expect(started, "one Start day").toHaveLength(1);

  // A leave request.
  const first = addISTDays(todayIST(), 14);
  await page.goto("/leave");
  await hydrated(page);
  await page.getByRole("button", { name: "Request leave" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("First day").fill(first);
  await dialog.getByLabel("Reason (optional)").fill("Slow network trip");
  await dialog.getByRole("button", { name: "Request leave" }).click();
  await expect(dialog).toBeHidden();
  await expectNoFailure(page);
  const requests = await serviceSelect<{ id: string; state: string }>(
    `leave_requests?member_id=eq.${memberId}&select=id,state`,
  );
  expect(requests, "one leave request").toHaveLength(1);
  expect(requests[0]?.state).toBe("submitted");

  // Task Noted, Start work, Mark done.
  await page.goto(`/tasks/${taskId}`);
  await hydrated(page);
  const next = page.locator('[data-slot="task-next-step"]');
  await next.getByRole("button", { name: "Task Noted" }).click();
  await next.getByRole("button", { name: "Start work" }).click();
  await next.getByRole("button", { name: "Mark done" }).click();
  const done = page.locator('[data-slot="task-done-dialog"]');
  await done.getByRole("button", { name: "Mark done" }).click();
  await expect(done).toBeHidden();
  await expectNoFailure(page);
  const [task] = await serviceSelect<{ state: string }>(`tasks?id=eq.${taskId}&select=state`);
  // No approving Admin: Done goes straight to the Owner's step (invariant 5).
  expect(task?.state).toBe("admin_approved");
  const [assignee] = await serviceSelect<{ acknowledged_at: string | null }>(
    `task_assignees?task_id=eq.${taskId}&member_id=eq.${memberId}&select=acknowledged_at`,
  );
  expect(assignee?.acknowledged_at, "Task Noted").not.toBeNull();
  const submissions = await serviceSelect<{ id: string }>(
    `task_submissions?task_id=eq.${taskId}&select=id`,
  );
  expect(submissions, "one hand-in").toHaveLength(1);

  // End day.
  await page.goto("/my-day");
  await hydrated(page);
  await strip(page).getByRole("button", { name: "End day" }).click();
  const confirm = page.getByRole("alertdialog", { name: "End your day?" });
  await confirm.getByRole("button", { name: "End day" }).click();
  await expect(confirm).toBeHidden();
  await expect(strip(page)).toHaveAttribute("data-kind", "ended");
  await expectNoFailure(page);
  const ended = await serviceSelect<{ id: string }>(
    `attendance_events?attendance_day_id=eq.${dayId}&action=eq.ended&select=id`,
  );
  expect(ended, "one End day").toHaveLength(1);
});

test("the Owner on Slow 4G approves the leave request, once", async ({ browser }) => {
  // A second approval of the same request is refused by the database, which would show as a
  // failure on the screen (`expectNoFailure`).
  const { viewport, hasTouch, isMobile } = test.info().project.use;
  const context = await browser.newContext({
    storageState: storageStateFor("owner"),
    ...(viewport ? { viewport } : {}),
    ...(hasTouch !== undefined ? { hasTouch } : {}),
    ...(isMobile !== undefined ? { isMobile } : {}),
  });
  const page = await context.newPage();
  try {
    await page.goto("/today");
    await hydrated(page);
    await throttle(page);
    await page.goto("/approvals");
    await hydrated(page);
    const row = page
      .locator('[data-slot="approval-group"][data-group="leave"] [data-slot="approval-row"]')
      .filter({ hasText: NAME });
    await row.getByRole("button", { name: "Approve" }).click();
    await expect(row).toHaveCount(0);
    await expectNoFailure(page);
    const [request] = await serviceSelect<{ state: string }>(
      `leave_requests?member_id=eq.${memberId}&select=state`,
    );
    expect(request?.state).toBe("approved");
  } finally {
    await context.close();
  }
});
