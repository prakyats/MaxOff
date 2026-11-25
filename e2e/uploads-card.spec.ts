import type { Page, TestInfo } from "@playwright/test";

import { expect, test } from "./fixtures";

import { addISTDays, istInstant, systemClock, todayIST } from "../src/core/time";

import {
  expectBackStack,
  expectNoHorizontalScroll,
  hydrated,
  memberIdOf,
  removeTasksTitled,
  rpcAs,
  runInstalled,
  serviceDelete,
  serviceInsert,
  serviceSelect,
  storageStateFor,
  taskTypeId,
  USERS,
} from "./helpers";

/**
 * The Uploads card on a task's Work view (v4.5, WORKFLOWS §5B.1, §5B.3, §5B.5; the approved
 * sample §1, §5, §6). It needs the studio's Drive connection, one row per organisation, so this
 * file runs in the serial organisation-wide chain with drive-settings (`WORKING_HOURS_SPECS`,
 * playwright.config.ts). Nothing reaches Google: the stored token is a placeholder, the seeded
 * files were "checked in Drive" a moment ago (so the sheet's Drive check claims none of them),
 * and the link's key is the run's throwaway `UPLOAD_LINK_KEY`.
 */
test.describe.configure({ mode: "serial" });

const owner = USERS.owner;
const admin = USERS.admin;
const staff = USERS.staff;
const ACCOUNT = "e2e-account";
const LINK = /\/upload#[A-Za-z0-9_-]{43}$/;

const titleOf = (info: TestInfo, what: string) => `UL ${what} (${info.project.name})`;

/**
 * The tasks titled `title`, with their upload rows first (nothing is deleted in the app; a test's
 * own rows go, children before parents).
 */
async function removeUploadTasks(title: string): Promise<void> {
  const tasks = await serviceSelect<{ id: string }>(
    `tasks?title=eq.${encodeURIComponent(title)}&select=id`,
  );
  if (tasks.length > 0) {
    const ids = `in.(${tasks.map((task) => task.id).join(",")})`;
    const links = await serviceSelect<{ id: string }>(`upload_links?task_id=${ids}&select=id`);
    if (links.length > 0) {
      const linkIds = `in.(${links.map((link) => link.id).join(",")})`;
      await serviceDelete(`upload_alerts?link_id=${linkIds}`);
    }
    const uploaders = await serviceSelect<{ id: string }>(
      `upload_uploaders?task_id=${ids}&select=id`,
    );
    if (uploaders.length > 0) {
      await serviceDelete(
        `upload_folders?uploader_id=in.(${uploaders.map((u) => u.id).join(",")})`,
      );
    }
    await serviceDelete(`upload_files?task_id=${ids}`);
    await serviceDelete(`upload_uploaders?task_id=${ids}`);
    await serviceDelete(`upload_links?task_id=${ids}&renewed_from_id=not.is.null`);
    await serviceDelete(`upload_links?task_id=${ids}`);
  }
  await removeTasksTitled(title);
}

async function orgId(): Promise<string> {
  const [org] = await serviceSelect<{ id: string }>("organizations?select=id&limit=1");
  return org!.id;
}

async function connectDrive(): Promise<void> {
  await serviceDelete("drive_account?org_id=not.is.null");
  await serviceInsert("drive_account", {
    org_id: await orgId(),
    google_email: "studio-drive-test@example.com",
    google_sub: ACCOUNT,
    refresh_token_encrypted: "v1.placeholder.placeholder",
    state: "connected",
    connected_by: await memberIdOf(owner.email),
    connected_at: systemClock().toISOString(),
  });
}

/** The Admin makes a task for the seeded Crew member: the Admin is its creator (Q1). */
async function adminTask(title: string, days = 3): Promise<string> {
  const staffId = await memberIdOf(staff.email);
  return rpcAs<string>(admin.email, admin.password, "task_create", {
    title,
    description: null,
    task_type_id: await taskTypeId("Normal"),
    client_id: null,
    priority: "medium",
    due_at: istInstant(addISTDays(todayIST(), days), "18:00"),
    assignee_ids: [staffId],
    primary_owner_id: staffId,
    approving_admin_id: null,
    stages: ["Shoot"],
  });
}

/** A link on the task, made by the Admin (unsealed: nobody uploads through it here). */
async function linkOn(taskId: string): Promise<string> {
  return rpcAs<string>(admin.email, admin.password, "upload_link_create", { p_task_id: taskId });
}

const minutesAgo = (minutes: number) =>
  new Date(systemClock().getTime() - minutes * 60_000).toISOString();

/**
 * Three uploaders, as on the sample's card: Sam (on the task, uploading), Alex (a new name, one
 * file stalled for 18 minutes, one received file since removed in Drive, a risky double name) and
 * Jordan (said "I'm done").
 */
async function seedUploaders(taskId: string, linkId: string): Promise<void> {
  const org = await orgId();
  const staffId = await memberIdOf(staff.email);
  const base = { org_id: org, link_id: linkId, task_id: taskId };
  const ids = await Promise.all(
    [
      {
        name: "Sam",
        name_key: "sam",
        folder_name: "Sam",
        on_task: true,
        matched_member_id: staffId,
      },
      {
        name: "Alex",
        name_key: "alex",
        folder_name: "Alex",
        device_label: "phone · Android",
        first_file_at: minutesAgo(40),
        last_activity_at: minutesAgo(18),
      },
      {
        name: "Jordan",
        name_key: "jordan",
        folder_name: "Jordan",
        said_done_at: minutesAgo(30),
        last_activity_at: minutesAgo(30),
      },
    ].map((row) =>
      serviceInsert<{ id: string }>("upload_uploaders", { ...base, ...row }).then((r) => r.id),
    ),
  );
  const [sam, alex, jordan] = ids as [string, string, string];
  const file = (uploader: string, row: Record<string, unknown>) => ({
    ...base,
    uploader_id: uploader,
    account_sub: ACCOUNT,
    drive_checked_at: systemClock().toISOString(),
    ...row,
  });
  const done = (uploader: string, name: string, size: number) =>
    file(uploader, {
      name,
      size_bytes: size,
      state: "done",
      drive_file_id: `drive-${uploader}-${name}`,
      done_at: minutesAgo(35),
      check_kind: "md5",
    });
  const files = [
    done(sam, "IMG_0419.MOV", 720_000_000),
    file(sam, {
      name: "IMG_0420.MOV",
      size_bytes: 980_000_000,
      state: "uploading",
      session_uri_encrypted: "v1.placeholder.placeholder",
      session_opened_at: minutesAgo(1),
      last_moved_at: minutesAgo(0),
      bytes_at_google: 410_000_000,
    }),
    done(alex, "VID_2026_1118_01.mp4", 2_100_000_000),
    file(alex, {
      name: "VID_2026_1118_02.mp4",
      size_bytes: 1_800_000_000,
      state: "missing_in_drive",
      drive_file_id: `drive-${alex}-removed`,
      done_at: minutesAgo(36),
      check_kind: "md5",
      missing_seen_at: minutesAgo(20),
    }),
    file(alex, {
      name: "VID_2026_1118_05.mp4",
      size_bytes: 1_400_000_000,
      state: "uploading",
      session_uri_encrypted: "v1.placeholder.placeholder",
      session_opened_at: minutesAgo(30),
      last_moved_at: minutesAgo(18),
      bytes_at_google: 500_000_000,
    }),
    file(alex, {
      name: "VID_2026_1118_06.mp4",
      size_bytes: 900_000_000,
      state: "failed",
      failed_reason: "gave_up",
      bytes_reported: 40_000_000,
    }),
    done(alex, "clip_final.mp4.exe", 312_000),
    done(jordan, "A001_C001.MP4", 3_200_000_000),
  ];
  for (const row of files) await serviceInsert("upload_files", row);
}

async function openTask(page: Page, taskId: string): Promise<void> {
  await page.goto(`/tasks/${taskId}`);
  await hydrated(page);
}

/** The card's own code arrives after the page (`UploadsCardLazy`): its controls answer then. */
async function cardLive(page: Page): Promise<void> {
  await expect(page.locator('[data-slot="uploads-card"][data-live]')).toBeVisible();
}

const card = (page: Page) => page.locator('[data-slot="uploads-card"]');

test.describe("the task's Admin", () => {
  test.use({ storageState: storageStateFor("admin") });

  test.beforeEach(async () => {
    await connectDrive();
  });

  test("no link yet: one outline Get upload link, then the link with Copy link", async ({
    page,
    context,
  }, info) => {
    const title = titleOf(info, "get");
    await removeUploadTasks(title);
    const taskId = await adminTask(title);
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await openTask(page, taskId);
    await cardLive(page);

    const uploads = card(page);
    await expect(uploads).toHaveAttribute("data-state", "none");
    const get = uploads.getByRole("button", { name: "Get upload link" });
    // Never the page's solid action (the sample §1).
    await expect(get).toHaveAttribute("data-variant", "secondary");
    await expectNoHorizontalScroll(page);
    await get.click();

    await expect(uploads).toHaveAttribute("data-state", "active");
    await expect(uploads.locator('[data-slot="status-badge-label"]').first()).toHaveText(
      "Link active",
    );
    await expect(uploads.getByRole("textbox", { name: "Upload link" })).toHaveValue(LINK);
    await expect(uploads.locator('[data-slot="uploads-empty"]')).toContainText(
      "Send the link to whoever has the files.",
    );

    await uploads.getByRole("button", { name: "Copy link" }).click();
    await expect(page.getByText("Link copied")).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toMatch(LINK);
    // A copy leaves a history row (who copied it, to trace a leak); the link itself never does.
    const link = await uploads.getByRole("textbox", { name: "Upload link" }).inputValue();
    const token = link.split("#")[1]!;
    const [row] = await serviceSelect<{ id: string }>(
      `upload_links?task_id=eq.${taskId}&select=id`,
    );
    const history = await serviceSelect<{ action: string }>(
      `activity_log?entity=eq.upload_links&entity_id=eq.${row!.id}&select=action,diff,meta&order=at.asc`,
    );
    expect(history.map((entry) => entry.action)).toEqual(["created", "copied"]);
    expect(JSON.stringify(history)).not.toContain(token);
  });

  test("uploaders: chips, files and data; a row opens that uploader's sheet", async ({
    page,
  }, info) => {
    const title = titleOf(info, "rows");
    await removeUploadTasks(title);
    const taskId = await adminTask(title);
    await seedUploaders(taskId, await linkOn(taskId));
    await openTask(page, taskId);
    await cardLive(page);

    const uploads = card(page);
    await expect(uploads.locator('[data-slot="uploads-summary"]')).toHaveText(
      "3 people · 5 of 8 files · 7.8 GB",
    );
    const alex = uploads.locator('[data-uploader="Alex"]');
    await expect(alex).toContainText("Stuck 18 min");
    await expect(alex).toContainText("Not on this task · new name");
    await expect(alex).toContainText("3 of 5 done · 1 in progress · 1 failed");
    await expect(uploads.locator('[data-uploader="Sam"]')).toContainText("Uploading");
    await expect(uploads.locator('[data-uploader="Jordan"]')).toContainText('Said "I\'m done"');
    await expectNoHorizontalScroll(page);

    await alex.click();
    const sheet = page.locator('[data-slot="uploader-sheet"]');
    await expect(sheet.getByRole("heading", { name: "Alex · 5 files" })).toBeVisible();
    await expect(sheet.locator('[data-slot="uploader-line"]')).toContainText(
      "phone · Android. Name typed by the uploader, not checked.",
    );
    const removed = sheet.locator('[data-slot="uploader-file"]', {
      hasText: "VID_2026_1118_02.mp4",
    });
    await expect(removed).toHaveAttribute("data-state", "missing_in_drive");
    await expect(removed).toContainText("Removed in Drive");
    await expect(
      sheet.locator('[data-slot="uploader-file"]', { hasText: "clip_final.mp4.exe" }),
    ).toContainText("Check before opening");
    await expect(
      sheet.locator('[data-slot="uploader-file"]', { hasText: "VID_2026_1118_06.mp4" }),
    ).toContainText("Failed at 40 MB");
    // An Admin sees no IP: that is the Owner's (Q12).
    await expect(sheet.locator('[data-slot="uploader-network"]')).toHaveCount(0);
    // MaxOff has no Remove (Q7): a received file's ⋯ only opens it in Drive.
    await sheet
      .locator('[data-slot="uploader-file"]', { hasText: "VID_2026_1118_01.mp4" })
      .getByRole("button", { name: /Actions for/ })
      .click();
    const open = page.getByRole("menuitem", { name: "Open in Drive" });
    await expect(open).toHaveAttribute("href", /^https:\/\/drive\.google\.com\/file\/d\//);
    await expect(page.getByRole("menuitem")).toHaveCount(1);
  });

  test("Stop link: a named red confirm; the closed card offers Make a new link", async ({
    page,
  }, info) => {
    const title = titleOf(info, "stop");
    await removeUploadTasks(title);
    const taskId = await adminTask(title);
    await rpcAs(admin.email, admin.password, "upload_link_create", { p_task_id: taskId });
    await openTask(page, taskId);
    await cardLive(page);

    const uploads = card(page);
    await uploads.getByRole("button", { name: "Upload link actions" }).click();
    await page.getByRole("menuitem", { name: "Stop link" }).click();
    const confirm = page.getByRole("alertdialog");
    await expect(confirm).toContainText("Files already received stay in the folder.");
    await confirm.getByRole("button", { name: "Stop the link" }).click();

    await expect(uploads).toHaveAttribute("data-state", "stopped");
    await expect(uploads.locator('[data-slot="uploads-closed"]')).toContainText("Stopped by you");
    await uploads.getByRole("button", { name: "Make a new link" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Make a new link" }).click();
    await expect(uploads).toHaveAttribute("data-state", "active");
    await expect(uploads.getByRole("textbox", { name: "Upload link" })).toHaveValue(LINK);
  });

  test("All files received with a Crew primary: the link stops and the primary is told", async ({
    page,
  }, info) => {
    const title = titleOf(info, "received");
    await removeUploadTasks(title);
    const taskId = await adminTask(title);
    await seedUploaders(taskId, await linkOn(taskId));
    await openTask(page, taskId);
    await cardLive(page);

    const uploads = card(page);
    // The Admin has no other next step here, so it is the page's one solid button.
    const received = page.locator('[data-slot="uploads-received"]');
    await expect(received).toHaveAttribute("data-variant", "approve");
    await received.click();
    const sheet = page.getByRole("alertdialog");
    await expect(sheet).toContainText(
      `(the task's primary) gets "Files received for ${title}: mark it done".`,
    );
    await expect(sheet).toContainText("2 files are still uploading from Sam and Alex.");
    await sheet.getByRole("button", { name: "Files received" }).click();

    await expect(uploads).toHaveAttribute("data-state", "stopped");
    await expect(uploads.locator('[data-slot="status-badge-label"]').first()).toHaveText(
      "All files received",
    );
    const [task] = await serviceSelect<{ state: string }>(`tasks?id=eq.${taskId}&select=state`);
    expect(task!.state).toBe("todo");
    const told = await serviceSelect<{ id: string }>(
      `notifications?kind=eq.upload_files_received&recipient_id=eq.${await memberIdOf(staff.email)}&entity_id=eq.${taskId}&select=id`,
    );
    expect(told).toHaveLength(1);
  });

  test("installed: back closes the uploader's sheet, then ⋯ and Stop's confirm", async ({
    page,
    isMobile,
  }, info) => {
    test.skip(!isMobile, "the installed back gesture is a phone's (375 and 430 px)");
    const title = titleOf(info, "back");
    await removeUploadTasks(title);
    const taskId = await adminTask(title);
    await seedUploaders(taskId, await linkOn(taskId));
    await runInstalled(page);
    await page.goto("/tasks");
    await page.goto(`/tasks/${taskId}`);
    await hydrated(page);
    await cardLive(page);

    await card(page).locator('[data-uploader="Sam"]').click();
    const sheet = page.locator('[data-slot="uploader-sheet"]');
    await expect(sheet).toBeVisible();
    await expectBackStack(page, [{ closes: sheet, url: new RegExp(`/tasks/${taskId}$`) }]);

    await card(page).getByRole("button", { name: "Upload link actions" }).click();
    await page.getByRole("menuitem", { name: "Stop link" }).click();
    const confirm = page.getByRole("alertdialog");
    await expect(confirm).toBeVisible();
    await expectBackStack(page, [
      { closes: confirm, url: new RegExp(`/tasks/${taskId}$`) },
      { url: /\/tasks$/ },
    ]);
  });
});

test.describe("who sees the card", () => {
  test("the Owner sees it on any task; the IP is the Owner's to see", async ({ browser }, info) => {
    await connectDrive();
    const title = titleOf(info, "owner");
    await removeUploadTasks(title);
    const taskId = await adminTask(title);
    const linkId = await linkOn(taskId);
    const u = await serviceInsert<{ id: string }>("upload_uploaders", {
      org_id: await orgId(),
      link_id: linkId,
      task_id: taskId,
      name: "Sam",
      name_key: "sam",
      folder_name: "Sam",
      ip: "203.0.113.7",
      user_agent: "Mozilla/5.0 (Linux; Android 14) Mobile",
      device_label: "phone · Android",
    });
    const context = await browser.newContext({ storageState: storageStateFor("owner") });
    const page = await context.newPage();
    await openTask(page, taskId);
    await cardLive(page);
    await card(page).locator('[data-uploader="Sam"]').click();
    await expect(page.locator('[data-slot="uploader-network"]')).toContainText("IP 203.0.113.7");
    expect(u).toBeTruthy();
    await context.close();
  });

  test("Crew on the task see no card and no link", async ({ browser }, info) => {
    await connectDrive();
    const title = titleOf(info, "crew");
    await removeUploadTasks(title);
    const taskId = await adminTask(title);
    await linkOn(taskId);
    const context = await browser.newContext({ storageState: storageStateFor("staff") });
    const page = await context.newPage();
    await openTask(page, taskId);
    await expect(page.locator('[data-slot="task-page"]')).toBeVisible();
    await expect(card(page)).toHaveCount(0);
    await context.close();
  });
});
