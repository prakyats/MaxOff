import type { Browser, Page, TestInfo } from "@playwright/test";

import { expect, test } from "./fixtures";

import { encryptToken } from "../src/core/drive/token-crypto";
import { addISTDays, istInstant, systemClock, todayIST } from "../src/core/time";

import { E2E_DRIVE_TOKEN_KEY, FAKE_GOOGLE_URL } from "./fake-google-config";
import {
  hydrated,
  memberIdOf,
  removeTasksTitled,
  rpcAs,
  serviceDelete,
  serviceInsert,
  serviceSelect,
  storageStateFor,
  taskTypeId,
  USERS,
} from "./helpers";

/**
 * The upload flows end to end against the e2e's fake Google (v4.5, security plan §7.3;
 * `e2e/fake-google.ts`): the browser sends real bytes in chunks to the fake's resumable sessions
 * and the server checks them there. Organisation-wide (the Drive connection), so it runs in the
 * serial chain (`WORKING_HOURS_SPECS`).
 */
test.describe.configure({ mode: "serial" });

const owner = USERS.owner;
const admin = USERS.admin;
const staff = USERS.staff;
const ACCOUNT = "fake-account";

const titleOf = (info: TestInfo, what: string) => `UF ${what} (${info.project.name})`;

async function fake(path: string): Promise<unknown> {
  const response = await fetch(`${FAKE_GOOGLE_URL}/__fake/${path}`);
  return response.json();
}

type FakeState = {
  sessions: { name: string; size: number; received: number; twice: number; done: boolean }[];
  files: { id: string; name: string; size: number }[];
};

/** The studio's Drive, connected to the fake: a sealed refresh token, the root folder, a fresh quota. */
async function connectFakeDrive(): Promise<void> {
  const [org] = await serviceSelect<{ id: string }>("organizations?select=id&limit=1");
  await serviceDelete("upload_folders?id=not.is.null");
  await serviceDelete("drive_folders?id=not.is.null");
  await serviceDelete("drive_account?org_id=not.is.null");
  await serviceInsert("drive_account", {
    org_id: org!.id,
    google_email: "test-drive@example.com",
    google_sub: ACCOUNT,
    refresh_token_encrypted: await encryptToken("fake-refresh", E2E_DRIVE_TOKEN_KEY),
    state: "connected",
    connected_by: await memberIdOf(owner.email),
    connected_at: systemClock().toISOString(),
    quota_total_bytes: 2_000_000_000_000,
    quota_used_bytes: 1_000_000_000_000,
    quota_checked_at: systemClock().toISOString(),
  });
  await serviceInsert("drive_folders", {
    org_id: org!.id,
    account_sub: ACCOUNT,
    kind: "root",
    drive_folder_id: "fake-root",
    name: "MaxOff",
  });
}

async function removeUploadTasks(title: string): Promise<void> {
  const tasks = await serviceSelect<{ id: string }>(
    `tasks?title=eq.${encodeURIComponent(title)}&select=id`,
  );
  if (tasks.length > 0) {
    const ids = `in.(${tasks.map((task) => task.id).join(",")})`;
    const links = await serviceSelect<{ id: string }>(`upload_links?task_id=${ids}&select=id`);
    if (links.length > 0) {
      await serviceDelete(`upload_alerts?link_id=in.(${links.map((l) => l.id).join(",")})`);
    }
    await serviceDelete(`upload_folders?id=not.is.null`);
    await serviceDelete(`upload_files?task_id=${ids}`);
    await serviceDelete(`upload_uploaders?task_id=${ids}`);
    await serviceDelete(`upload_links?task_id=${ids}`);
    await serviceDelete(`drive_folders?task_id=${ids}`);
  }
  await removeTasksTitled(title);
}

/** A task by the Admin, a link from its card; returns the task id and the link's path. */
async function linkFor(
  browser: Browser,
  info: TestInfo,
  what: string,
): Promise<{ taskId: string; link: string }> {
  const title = titleOf(info, what);
  await removeUploadTasks(title);
  const staffId = await memberIdOf(staff.email);
  const taskId = await rpcAs<string>(admin.email, admin.password, "task_create", {
    title,
    description: null,
    task_type_id: await taskTypeId("Normal"),
    client_id: null,
    priority: "medium",
    due_at: istInstant(addISTDays(todayIST(), 3), "18:00"),
    assignee_ids: [staffId],
    primary_owner_id: staffId,
    approving_admin_id: null,
    stages: ["Shoot"],
  });
  const context = await browser.newContext({ storageState: storageStateFor("admin") });
  const page = await context.newPage();
  await page.goto(`/tasks/${taskId}`);
  await hydrated(page);
  const card = page.locator('[data-slot="uploads-card"][data-live]');
  await card.getByRole("button", { name: "Get upload link" }).click();
  const url = new URL(await card.getByRole("textbox", { name: "Upload link" }).inputValue());
  await context.close();
  return { taskId, link: `${url.pathname}${url.hash}` };
}

/** The uploader's page with a name typed: ready to choose files. */
async function asUploader(page: Page, link: string, name: string): Promise<void> {
  await page.goto(link);
  await page.getByLabel("Your name").fill(name);
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.locator('[data-slot="upload-name"]')).toHaveText(name);
}

const bytes = (size: number, seed: number) =>
  Buffer.from(Array.from({ length: size }, (_, i) => (i * 31 + seed) & 0xff));

test.beforeEach(async () => {
  await serviceDelete("upload_rate_hits?bucket=not.is.null");
  await fake("reset");
  await connectFakeDrive();
});

test("files go to Google in chunks, each checked by the server; I'm done thanks the uploader", async ({
  browser,
  page,
}, info) => {
  const { taskId, link } = await linkFor(browser, info, "flow");
  await asUploader(page, link, "Sam");
  await page.locator('input[aria-label="Choose files"]').setInputFiles([
    { name: "clip-a.mov", mimeType: "video/quicktime", buffer: bytes(300_000, 1) },
    { name: "still-b.jpg", mimeType: "image/jpeg", buffer: bytes(40_000, 2) },
  ]);
  await page.getByRole("button", { name: "Upload 2 files" }).click();
  await expect(page.locator('[data-slot="upload-received"]')).toContainText("All 2 files received");
  await page.getByRole("button", { name: "I'm done" }).click();
  await expect(page.locator('[data-slot="upload-thanks"]')).toContainText("Thanks, Sam");

  const rows = await serviceSelect<{
    state: string;
    check_kind: string;
    md5_page: string;
    md5_drive: string;
  }>(`upload_files?task_id=eq.${taskId}&select=state,check_kind,md5_page,md5_drive`);
  expect(rows).toHaveLength(2);
  for (const row of rows) {
    expect(row).toMatchObject({ state: "done", check_kind: "md5" });
    expect(row.md5_page).toBe(row.md5_drive);
  }
  const state = (await fake("state")) as FakeState;
  expect(state.sessions.every((s) => s.done && s.twice === 0)).toBe(true);
});

test("a connection lost mid-file: it carries on from Google's offset, no byte sent twice", async ({
  browser,
  page,
}, info) => {
  test.setTimeout(90_000);
  const { taskId, link } = await linkFor(browser, info, "resume");
  await asUploader(page, link, "Alex");
  // Two dropped chunk PUTs: the engine asks Google where it stands and sends only the rest.
  await fake("drop/2");
  await page.locator('input[aria-label="Choose files"]').setInputFiles([
    // Three 8 MiB chunks and a bit: several PUTs.
    {
      name: "long-take.mov",
      mimeType: "video/quicktime",
      buffer: bytes(25 * 1024 * 1024 + 123, 3),
    },
  ]);
  await page.getByRole("button", { name: "Upload 1 file" }).click();
  await expect(page.locator('[data-slot="upload-received"]')).toContainText("All 1 file received", {
    timeout: 60_000,
  });
  const state = (await fake("state")) as FakeState;
  expect(state.sessions).toEqual([
    expect.objectContaining({
      name: "long-take.mov",
      received: 25 * 1024 * 1024 + 123,
      twice: 0,
      done: true,
    }),
  ]);
  const [row] = await serviceSelect<{ state: string; md5_page: string; md5_drive: string }>(
    `upload_files?task_id=eq.${taskId}&select=state,md5_page,md5_drive`,
  );
  expect(row!.state).toBe("done");
  expect(row!.md5_page).toBe(row!.md5_drive);
});

test("Google's daily limit pauses new files (screen O); another device on the link sees none of them", async ({
  browser,
  page,
}, info) => {
  const { link } = await linkFor(browser, info, "limit");
  await asUploader(page, link, "Jordan");
  await page
    .locator('input[aria-label="Choose files"]')
    .setInputFiles([{ name: "first.jpg", mimeType: "image/jpeg", buffer: bytes(10_000, 4) }]);
  await page.getByRole("button", { name: "Upload 1 file" }).click();
  await expect(page.locator('[data-slot="upload-received"]')).toBeVisible();
  await page.getByRole("button", { name: "Send more files" }).click();

  await fake("daily-limit/on");
  await page
    .locator('input[aria-label="Choose files"]')
    .setInputFiles([{ name: "second.jpg", mimeType: "image/jpeg", buffer: bytes(10_000, 5) }]);
  await page.getByRole("button", { name: "Upload 1 file" }).click();
  await expect(page.locator('[data-slot="upload-banner"]')).toHaveAttribute(
    "data-banner",
    "daily_limit",
  );

  // Another browser (another device) with the same link: a name to type, no file of Jordan's.
  const other = await browser.newContext();
  const second = await other.newPage();
  await second.goto(link);
  await expect(second.getByLabel("Your name")).toBeVisible();
  await expect(second.getByText("first.jpg")).toHaveCount(0);
  await other.close();
});

test("a file deleted in Drive shows Removed in Drive on the uploader's sheet (Q7)", async ({
  browser,
  page,
}, info) => {
  const { taskId, link } = await linkFor(browser, info, "removed");
  await asUploader(page, link, "Rin");
  await page.locator('input[aria-label="Choose files"]').setInputFiles([
    { name: "gone.mov", mimeType: "video/quicktime", buffer: bytes(20_000, 6) },
    { name: "kept.mov", mimeType: "video/quicktime", buffer: bytes(20_000, 7) },
  ]);
  await page.getByRole("button", { name: "Upload 2 files" }).click();
  await expect(page.locator('[data-slot="upload-received"]')).toBeVisible();
  const [gone] = await serviceSelect<{ drive_file_id: string }>(
    `upload_files?task_id=eq.${taskId}&name=eq.gone.mov&select=drive_file_id`,
  );
  await fake(`remove/${encodeURIComponent(gone!.drive_file_id)}`);

  const context = await browser.newContext({ storageState: storageStateFor("admin") });
  const adminPage = await context.newPage();
  // The task page itself asks Google nothing (the check runs once a sheet is open).
  const before = ((await fake("state")) as FakeState).files.length;
  await adminPage.goto(`/tasks/${taskId}`);
  await hydrated(adminPage);
  await adminPage.locator('[data-slot="uploads-card"][data-live] [data-uploader="Rin"]').click();
  const sheet = adminPage.locator('[data-slot="uploader-sheet"]');
  await expect(sheet.locator('[data-slot="uploader-file"]', { hasText: "gone.mov" })).toContainText(
    "Removed in Drive",
  );
  await expect(sheet.locator('[data-slot="uploader-file"]', { hasText: "kept.mov" })).toContainText(
    "Done",
  );
  expect(((await fake("state")) as FakeState).files.length).toBe(before);
  await context.close();
});
