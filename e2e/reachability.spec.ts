import { readFileSync } from "node:fs";
import { join } from "node:path";

import { type Page, type Request, type TestInfo } from "@playwright/test";

import { expect, test } from "./fixtures";

import { generateReceiverKeys } from "../src/core/notifications/push/encrypt";
import { addISTDays, istInstant, systemClock, todayIST } from "../src/core/time";

import {
  expectNoHorizontalScroll,
  expectSettled,
  hydrated,
  memberIdOf,
  removeTasksTitled,
  rpcAs,
  serviceDelete,
  serviceInsert,
  serviceSelect,
  signIn,
  storageStateFor,
  taskTypeId,
} from "./helpers";

/**
 * Reachability (task 5.4; WORKFLOWS §9a, PERMISSIONS `notifications.reachability`).
 *
 * - **The app's report** (owner decision 2026-10-03): opening the app sends one report of its
 *   platform and installed state; an in-app navigation sends none; the next open sends again.
 * - **Settings → Notifications**: the Owner sees who can't be reached and everyone, with the device
 *   and the last delivery, never an endpoint; an Admin sees only the people on their own open
 *   tasks, status and reason only, and the empty state when there are none; Staff are refused.
 *
 * Each project has its own Admin and Staff member (`reach-<role>-<project>`, seed.sql), and the
 * file runs in order: the Owner's check gives the Admin a device for a moment.
 */
test.describe.configure({ mode: "serial" });

const PASSWORD = "reach-local-password";

function person(info: TestInfo, role: "admin" | "staff"): string {
  return `reach-${role}-${info.project.name}@maxoff.local`;
}

function name(info: TestInfo, role: "admin" | "staff"): string {
  return `Test Reach ${role === "admin" ? "Admin" : "Staff"} (${info.project.name})`;
}

/** The build's id for one server action, so only that action's calls are counted. */
function actionId(filename: string, exportedName: string): string {
  const manifest = JSON.parse(
    readFileSync(join(process.cwd(), ".next/server/server-reference-manifest.json"), "utf8"),
  ) as { node: Record<string, { filename: string; exportedName: string }> };
  const ids = Object.entries(manifest.node)
    .filter(([, entry]) => entry.filename === filename && entry.exportedName === exportedName)
    .map(([id]) => id);
  if (ids.length !== 1) throw new Error(`${filename} ${exportedName}: ${ids.length} action ids`);
  return ids[0]!;
}

/** Counts this page's calls to `reportAppOpen`. */
function countReports(page: Page): () => number {
  const id = actionId("src/core/notifications/app-report-actions.ts", "reportAppOpen");
  let count = 0;
  page.on("request", (request: Request) => {
    if (request.method() === "POST" && request.headers()["next-action"] === id) count += 1;
  });
  return () => count;
}

test.describe("the app's report about itself", () => {
  test("one report per open, none on an in-app navigation", async ({ page, isMobile }, info) => {
    const email = person(info, "staff");
    const memberId = await memberIdOf(email);
    await serviceDelete(`member_app_reports?member_id=eq.${memberId}`);
    const reports = countReports(page);

    await signIn(page, email, PASSWORD);
    await expect.poll(reports, { message: "the open sends its report" }).toBe(1);
    await expect
      .poll(async () =>
        serviceSelect<{ platform: string; is_standalone: boolean }>(
          `member_app_reports?member_id=eq.${memberId}&select=platform,is_standalone`,
        ),
      )
      .toEqual([{ platform: isMobile ? "android" : "desktop", is_standalone: false }]);

    // Two in-app navigations: the layout and its report stay where they were.
    await hydrated(page);
    await page.locator('a[href="/tasks"]:visible').first().click();
    await expect(page).toHaveURL(/\/tasks$/);
    await expectSettled(page);
    await page.locator('a[href="/me"]:visible').first().click();
    await expect(page).toHaveURL(/\/me$/);
    await expectSettled(page);
    expect(reports(), "no report on an in-app navigation").toBe(1);

    // A new open (a reload is a new document) reports again.
    await page.reload();
    await expect.poll(reports, { message: "the next open reports again" }).toBe(2);
  });
});

test.describe("the Owner", () => {
  test.use({ storageState: storageStateFor("owner") });

  test("sees who can't be reached and everyone, with the device; never an endpoint", async ({
    page,
  }, info) => {
    const staff = name(info, "staff");
    const admin = name(info, "admin");
    const adminId = await memberIdOf(person(info, "admin"));
    // The Admin's device for this check: Android, delivered today, no app report to prefer.
    await serviceDelete(`member_app_reports?member_id=eq.${adminId}`);
    await serviceDelete(`push_subscriptions?member_id=eq.${adminId}`);
    const keys = await generateReceiverKeys();
    const endpoint = `https://push.example/reach-${info.project.name}`;
    await serviceInsert("push_subscriptions", {
      member_id: adminId,
      endpoint,
      p256dh: keys.publicKey,
      auth: keys.auth,
      platform: "android",
      last_success_at: systemClock().toISOString(),
    });
    try {
      await page.goto("/settings");
      await page
        .locator('[data-slot="settings-section"]')
        .filter({ hasText: "Notifications" })
        .click();
      await expect(page).toHaveURL(/\/settings\/notifications$/);

      const unreachable = page.getByRole("list", { name: "Can't be reached" });
      const staffRow = unreachable
        .locator('[data-slot="reachability-row"]')
        .filter({ hasText: staff });
      await expect(staffRow).toContainText("Notifications never turned on");
      await expect(staffRow).toContainText("Nothing delivered yet");
      await expect(unreachable).not.toContainText(admin);

      const everyone = page.getByRole("list", { name: "Everyone" });
      const adminRow = everyone
        .locator('[data-slot="reachability-row"]')
        .filter({ hasText: admin });
      await expect(adminRow).toHaveAttribute("data-state", "ok");
      await expect(adminRow).toContainText("Reachable");
      await expect(adminRow).toContainText("Android");
      await expect(adminRow).toContainText("Last delivered");
      await expect(
        everyone.locator('[data-slot="reachability-row"]').filter({ hasText: staff }),
      ).toHaveCount(1);

      expect(await page.content(), "no endpoint on the page").not.toContain("push.example");
      await expectNoHorizontalScroll(page);
    } finally {
      await serviceDelete(`push_subscriptions?member_id=eq.${adminId}`);
    }
  });
});

test.describe("an Admin", () => {
  test("sees only the people on their own open tasks, status and reason only", async ({
    page,
  }, info) => {
    const email = person(info, "admin");
    const prefix = `Reach ${info.project.name} `;
    await removeTasksTitled(prefix);
    await signIn(page, email, PASSWORD);

    await page.goto("/settings/notifications");
    await expect(page.locator('[data-slot="empty-state"]')).toContainText(
      "Everyone on your open tasks can be reached.",
    );
    await expect(page.getByRole("list", { name: "Everyone" })).toHaveCount(0);
    await expect(page.locator('[data-slot="operational-warning"]')).toHaveCount(0);

    const staffId = await memberIdOf(person(info, "staff"));
    await rpcAs(email, PASSWORD, "task_create", {
      title: `${prefix}reel`,
      description: null,
      task_type_id: await taskTypeId("Normal"),
      client_id: null,
      priority: "medium",
      due_at: istInstant(addISTDays(todayIST(), 3), "18:00"),
      assignee_ids: [staffId],
      primary_owner_id: staffId,
      approving_admin_id: null,
    });
    try {
      await page.reload();
      const unreachable = page.getByRole("list", { name: "Can't be reached" });
      const rows = unreachable.locator('[data-slot="reachability-row"]');
      await expect(rows).toHaveCount(1);
      await expect(rows).toContainText(name(info, "staff"));
      await expect(rows).toContainText("Notifications never turned on");
      // Status and reason only: never the device or the last delivery.
      await expect(page.locator('[data-slot="reachability-device"]')).toHaveCount(0);
      await expectNoHorizontalScroll(page);
    } finally {
      await removeTasksTitled(prefix);
    }
  });
});

test.describe("Staff", () => {
  test.use({ storageState: storageStateFor("staff") });

  test("are refused (their own devices are on Me)", async ({ page }) => {
    await page.goto("/settings/notifications");
    await expect(page).toHaveURL(/\/forbidden$/);
  });
});
