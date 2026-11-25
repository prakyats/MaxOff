import type { Page, TestInfo } from "@playwright/test";

import { expect, test } from "./fixtures";

import { addISTDays, istInstant, systemClock, todayIST } from "../src/core/time";

import {
  expectNoHorizontalScroll,
  hydrated,
  memberIdOf,
  removeTaskTypesNamed,
  removeTasksTitled,
  rowAction,
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
 * v5.0 Hand in work, the screens (WORKFLOWS §5C; the sample `docs/design/v50-hand-in-sample.html`,
 * approved on autopilot #89 7162602164): the Files card on the task page for the Crew primary (the
 * open version, Add, Leave out, no Drive link), the reviewer (the version handed in, Open in Drive
 * and the version's folder, Q6), the Mark done sheet's line, the Approvals row's "v1 · 2 files",
 * and Drive needing a reconnect. Files are recorded rows (nothing reaches Google in the run): the
 * upload itself is v4.5's engine's, tested there. The Drive connection is one row per
 * organisation, so this file runs in the serial organisation-wide chain (playwright.config.ts
 * `WORKING_HOURS_SPECS`: 1280, then 375, then 430 px). Leave out's confirm is a layer: installed,
 * back closes it (ARCHITECTURE §14.2).
 */
test.describe.configure({ mode: "serial" });

const owner = USERS.owner;
const staff = USERS.staff;
const ACCOUNT = "e2e-handin-account";

const prefixOf = (info: TestInfo) => `HI ${info.project.name} `;

async function orgId(): Promise<string> {
  const [org] = await serviceSelect<{ id: string }>("organizations?select=id&limit=1");
  return org!.id;
}

async function driveRow(state: "connected" | "needs_reconnect"): Promise<void> {
  await serviceDelete("drive_account?org_id=not.is.null");
  await serviceInsert("drive_account", {
    org_id: await orgId(),
    google_email: "studio-drive-test@example.com",
    google_sub: ACCOUNT,
    refresh_token_encrypted: "v1.placeholder.placeholder",
    state,
    connected_by: await memberIdOf(owner.email),
    connected_at: new Date("2026-11-18T04:30:00Z").toISOString(),
    quota_total_bytes: 2_000_000_000_000,
    quota_used_bytes: 1_000_000_000,
  });
}

/** A task the Owner gives the seeded Crew member, the seeded Admin approving it. */
async function handinTask(title: string): Promise<string> {
  const staffId = await memberIdOf(staff.email);
  return rpcAs<string>(owner.email, owner.password, "task_create", {
    title,
    description: null,
    task_type_id: await taskTypeId("Normal"),
    client_id: null,
    priority: "medium",
    due_at: istInstant(addISTDays(todayIST(), 3), "18:00"),
    assignee_ids: [staffId],
    primary_owner_id: staffId,
    approving_admin_id: await memberIdOf(USERS.admin.email),
  });
}

/** The Crew primary has noted and started it, so Mark done is the page's next step. */
async function started(taskId: string): Promise<void> {
  await rpcAs(staff.email, staff.password, "task_acknowledge", { task_id: taskId });
  await rpcAs(staff.email, staff.password, "task_start", { task_id: taskId });
}

/** A file already in Drive for the open version (what a finished upload leaves). */
async function fileInDrive(
  taskId: string,
  name: string,
  size: number,
  addedBy: string,
): Promise<void> {
  await serviceInsert("handin_files", {
    org_id: await orgId(),
    task_id: taskId,
    version: 1,
    added_by: await memberIdOf(addedBy),
    name,
    relative_path: "",
    size_bytes: size,
    state: "done",
    account_sub: ACCOUNT,
    drive_parent_id: "e2e-folder-v1",
    drive_file_id: `e2e-${taskId.slice(0, 8)}-${name.replace(/\W/g, "")}`,
    done_at: systemClock().toISOString(),
    check_kind: "size_only",
  });
}

async function taskReady(page: Page) {
  await hydrated(page);
  await expect(page.locator('[data-slot="task-tabs"]')).toHaveAttribute("data-live", /.*/);
}

const card = (page: Page) => page.locator('[data-slot="handin-card"]');

test.describe("the Crew primary", () => {
  test.use({ storageState: storageStateFor("staff") });

  test("the open version: files in Drive, Add, Leave out (back closes its confirm), Mark done's line", async ({
    page,
  }, info) => {
    await driveRow("connected");
    await removeTasksTitled(prefixOf(info));
    const taskId = await handinTask(`${prefixOf(info)}brand reel`);
    await fileInDrive(taskId, "C0041.MP4", 1_900_000_000, staff.email);
    await fileInDrive(taskId, "IMG_2210.HEIC", 3_200_000, staff.email);
    await started(taskId);
    await runInstalled(page);
    await page.goto("/my-day");
    await page.goto(`/tasks/${taskId}`);
    await taskReady(page);

    await expect(card(page).getByRole("heading", { name: "Files" })).toBeVisible();
    await expect(card(page)).toContainText("v1 · not handed in yet");
    await expect(card(page).locator('[data-slot="handin-file"]:visible')).toHaveCount(2);
    await expect(card(page).locator('[data-slot="handin-file"]').first()).toContainText("In Drive");
    // Q6: the Crew never get a Drive link.
    await expect(card(page).locator('[data-slot="handin-open-file"]')).toHaveCount(0);
    await expect(card(page).locator('[data-slot="handin-add"]')).toBeVisible();
    await expectNoHorizontalScroll(page);

    // Leave out: a layer; back closes it and the task stays.
    await card(page).getByRole("button", { name: "Leave out IMG_2210.HEIC" }).click();
    const confirm = page.getByRole("alertdialog", { name: "Leave out IMG_2210.HEIC?" });
    await expect(confirm).toBeVisible();
    await expect(confirm).toContainText("MaxOff never deletes files");
    await page.goBack();
    await expect(confirm).toBeHidden();
    await expect(page).toHaveURL(new RegExp(`/tasks/${taskId}$`));

    await card(page).getByRole("button", { name: "Leave out IMG_2210.HEIC" }).click();
    await confirm.getByRole("button", { name: "Leave it out" }).click();
    await expect(confirm).toBeHidden();
    await expect(card(page).locator('[data-slot="handin-file"]:visible')).toHaveCount(1);
    await expect(card(page).locator('[data-slot="handin-show-all"]')).toHaveText("1 left out");
    const [row] = await serviceSelect<{ state: string }>(
      `handin_files?task_id=eq.${taskId}&name=eq.IMG_2210.HEIC&select=state`,
    );
    expect(row?.state).toBe("left_out");

    // Mark done says what is handed in.
    await page.getByRole("button", { name: "Mark done" }).first().click();
    const done = page.getByRole("dialog", { name: "Mark done" });
    await expect(done.locator('[data-slot="handin-done-line"]')).toContainText(
      "Hand-in v1 · 1 file",
    );
    await page.goBack();
    await expect(done).toBeHidden();
  });

  test("Drive needing a reconnect: no Add, the reason, Mark done still works", async ({
    page,
  }, info) => {
    await driveRow("needs_reconnect");
    await removeTasksTitled(prefixOf(info));
    const taskId = await handinTask(`${prefixOf(info)}menu photos`);
    await started(taskId);
    await page.goto(`/tasks/${taskId}`);
    await taskReady(page);
    await expect(card(page).locator('[data-slot="handin-drive-off"]')).toContainText(
      "Handing in files is off until the Owner reconnects Google Drive",
    );
    await expect(card(page).locator('[data-slot="handin-add"]')).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Mark done" }).first()).toBeVisible();
    await driveRow("connected");
  });
});

test.describe("Has hand-in, the Owner's per-type setting", () => {
  test.use({ storageState: storageStateFor("owner") });

  test("turned off in Settings → Task types, its tasks show no Files card and still mark done", async ({
    page,
    browser,
  }, info) => {
    // v5.0 "Has hand-in" (owner 25 Nov 2026): on for every type to start with; the Owner turns it
    // off for a type with nothing to hand in.
    await driveRow("connected");
    await removeTasksTitled(prefixOf(info));
    const typeName = `${prefixOf(info)}Call`;
    await removeTaskTypesNamed(typeName);
    await serviceInsert("task_types", {
      org_id: await orgId(),
      name: typeName,
      kind: "normal",
      position: "z9",
    });
    const [created] = await serviceSelect<{ id: string; has_handin: boolean }>(
      `task_types?name=eq.${encodeURIComponent(typeName)}&select=id,has_handin`,
    );
    expect(created?.has_handin).toBe(true);

    await page.goto("/settings/task-types");
    await hydrated(page);
    const row = page.locator('[data-slot="task-type"]', { hasText: typeName });
    // On a phone a Settings row's Edit sits in its ⋯ sheet (V2, P2).
    await rowAction(page, row, typeName, "Edit");
    const edit = page.getByRole("dialog", { name: `Edit ${typeName}` });
    const box = edit.getByRole("checkbox", { name: "Has hand-in" });
    await expect(box).toBeChecked();
    await box.click();
    await edit.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("Task type saved")).toBeVisible();
    await expect(row).toContainText("Normal · no hand-in");

    const staffId = await memberIdOf(staff.email);
    const taskId = await rpcAs<string>(owner.email, owner.password, "task_create", {
      title: `${prefixOf(info)}weekly call`,
      description: null,
      task_type_id: created?.id,
      client_id: null,
      priority: "medium",
      due_at: istInstant(addISTDays(todayIST(), 3), "18:00"),
      assignee_ids: [staffId],
      primary_owner_id: staffId,
      approving_admin_id: null,
    });
    await started(taskId);
    const crew = await browser.newContext({ storageState: storageStateFor("staff") });
    try {
      const crewPage = await crew.newPage();
      await crewPage.goto(`/tasks/${taskId}`);
      await taskReady(crewPage);
      await expect(crewPage.getByRole("button", { name: "Mark done" }).first()).toBeVisible();
      await expect(card(crewPage)).toHaveCount(0);
      await crewPage.getByRole("button", { name: "Mark done" }).first().click();
      const done = crewPage.getByRole("dialog", { name: "Mark done" });
      await expect(done).toBeVisible();
      await expect(done.locator('[data-slot="handin-done-line"]')).toHaveCount(0);
    } finally {
      await crew.close();
      await removeTasksTitled(prefixOf(info));
      await removeTaskTypesNamed(typeName);
    }
  });
});

test.describe("the approving Admin", () => {
  test.use({ storageState: storageStateFor("admin") });

  test("the version handed in: Open in Drive and the folder, and Approvals says v1 · 2 files", async ({
    page,
  }, info) => {
    await driveRow("connected");
    await removeTasksTitled(prefixOf(info));
    const title = `${prefixOf(info)}cafe reel`;
    const taskId = await handinTask(title);
    await fileInDrive(taskId, "C0061.MP4", 2_400_000_000, staff.email);
    await fileInDrive(taskId, "preview.html", 18_000, staff.email);
    await serviceInsert("handin_folders", {
      org_id: await orgId(),
      task_id: taskId,
      version: 1,
      account_sub: ACCOUNT,
      relative_path: "",
      drive_folder_id: "e2e-folder-v1",
    });
    await rpcAs(staff.email, staff.password, "task_submit_done", {
      task_id: taskId,
      note: "Final cut is C0061",
    });

    await page.goto(`/tasks/${taskId}`);
    await taskReady(page);
    await expect(card(page)).toContainText("v1 handed in");
    await expect(card(page).locator('[data-slot="handin-latest"]')).toContainText("2 files");
    const open = card(page).getByRole("link", { name: "Open C0061.MP4 in Drive" });
    await expect(open).toHaveAttribute("href", /^https:\/\/drive\.google\.com\/file\/d\/e2e-/);
    await expect(open).toHaveAttribute("target", "_blank");
    await expect(card(page).locator('[data-slot="handin-folder-link"]')).toHaveAttribute(
      "href",
      "https://drive.google.com/drive/folders/e2e-folder-v1",
    );
    // A risky type is flagged, never blocked (v4.5 Q13, Q4).
    await expect(
      card(page).locator('[data-slot="handin-file"]', { hasText: "preview.html" }),
    ).toContainText("Check before opening");
    await expect(card(page).locator('[data-slot="handin-add"]')).toHaveCount(0);
    await expectNoHorizontalScroll(page);

    await page.goto("/approvals");
    await expect(page.getByText(title)).toBeVisible();
    await expect(page.locator("body")).toContainText("v1 · 2 files");
  });
});

test.describe("the Crew primary, uploading", () => {
  test.use({ storageState: storageStateFor("staff") });

  test("moving around MaxOff keeps an upload going; back on the task, the card shows it (fake Google)", async ({
    page,
  }, info) => {
    await driveRow("connected");
    await removeTasksTitled(prefixOf(info));
    const taskId = await handinTask(`${prefixOf(info)}footage`);
    await started(taskId);

    // MaxOff's own calls answered here (the session is a fake Google address)…
    const FAKE =
      "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=e2e";
    const fileId = "00000000-0000-4000-8000-00000000e2e5";
    await page.route("**/api/handin/start", (route) =>
      route.fulfill({
        json: {
          ok: true,
          data: { kind: "open", fileId, version: 1, sessionUrl: FAKE, resumed: false },
        },
      }),
    );
    let finished = false;
    await page.route("**/api/handin/progress", (route) =>
      route.fulfill({ json: { ok: true, data: null } }),
    );
    await page.route("**/api/handin/finish", (route) => {
      finished = true;
      return route.fulfill({ json: { ok: true, data: { state: "done" } } });
    });
    // …and Google's side by a fake that holds the first chunk until the test lets it go.
    const size = 10 * 1024 * 1024;
    let received = 0;
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let firstChunk: () => void = () => undefined;
    const sawFirst = new Promise<void>((resolve) => {
      firstChunk = resolve;
    });
    const cors = {
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "*",
      "access-control-allow-methods": "PUT, POST, OPTIONS",
      "access-control-expose-headers": "range",
    };
    await page.route("https://www.googleapis.com/upload/**", async (route) => {
      const request = route.request();
      if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
      const range = request.headers()["content-range"] ?? "";
      const chunk = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(range);
      if (!chunk) {
        // "How far did it get?"
        return route.fulfill({
          status: 308,
          headers: received > 0 ? { ...cors, range: `bytes=0-${received - 1}` } : cors,
        });
      }
      if (Number(chunk[1]) === 0) {
        firstChunk();
        await held;
      }
      received = Number(chunk[2]) + 1;
      if (received >= size) {
        return route.fulfill({
          status: 200,
          headers: cors,
          json: {
            id: "e2e-drive-file",
            name: "long-take.mov",
            size: String(size),
            mimeType: "video/quicktime",
          },
        });
      }
      return route.fulfill({ status: 308, headers: { ...cors, range: `bytes=0-${received - 1}` } });
    });

    await page.goto(`/tasks/${taskId}`);
    await taskReady(page);
    await expect(card(page).locator('[data-slot="handin-add"]')).toBeVisible();
    // A marker that a full reload would wipe.
    await page.evaluate(() => {
      (window as unknown as { __stay?: boolean }).__stay = true;
    });
    await card(page)
      .locator('[data-slot="handin-file-input"]')
      .setInputFiles({
        name: "long-take.mov",
        mimeType: "video/quicktime",
        buffer: Buffer.alloc(size, 7),
      });
    await sawFirst;
    await expect(card(page).locator('[data-slot="handin-keep-open"]')).toBeVisible();

    // Away to another screen inside MaxOff (a client navigation, the app's own link), then the
    // held chunk goes through.
    await page.locator('a[href="/my-day"]:visible').first().click();
    await expect(page).toHaveURL(/\/my-day$/);
    release();
    await expect.poll(() => finished, { message: "the upload finished while away" }).toBe(true);
    expect(received).toBe(size);

    // Back on the task (history back, still a client navigation): the card re-attaches to the
    // running engine and shows the file.
    await page.goBack();
    await taskReady(page);
    await expect(
      card(page).locator('[data-slot="handin-local-file"]', { hasText: "long-take.mov" }),
    ).toHaveAttribute("data-state", "done");
    expect(await page.evaluate(() => (window as unknown as { __stay?: boolean }).__stay)).toBe(
      true,
    );
  });
});
