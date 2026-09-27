import { type Page, type TestInfo } from "@playwright/test";

import { expect, test } from "./fixtures";
import { wallClock } from "./run-state";

import {
  expectBackStack,
  hydrated,
  memberIdOf,
  pageHeader,
  patchAs,
  runInstalled,
  serviceInsert,
  serviceSelect,
  signIn,
  storageStateFor,
  USERS,
} from "./helpers";

/**
 * File storage (task 3.3, ARCHITECTURE §11, kickoff 3 decisions 11-14): the company logo and
 * a member's photo go from the picker straight to the bucket (MinIO in every e2e run) and back
 * through `/api/files/<id>`, which answers only whom the record allows; the wrong kind of file
 * is refused before a byte leaves; the upload sheet closes on back; the cron route refuses a
 * caller without the secret and, with it, deletes a stale upload and marks the row.
 *
 * The Owner's logo tests change the one organization row, so they run in order and end with
 * the logo removed; each project has its own person for the photo (`avatar-<project>@`), so
 * projects never race and the spec re-runs without a reset.
 */
const PASSWORD = "avatar-local-password";
const avatarPerson = (info: TestInfo) => `avatar-${info.project.name}@maxoff.local`;

/** A 2×2 PNG (red), enough for a real decode and a canvas preview. */
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEklEQVR4nGP4z8DwHwyBBAMDABbdBP38ONcyAAAAAElFTkSuQmCC",
  "base64",
);
const SVG = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 4 4"><script>alert(1)</script><rect width="4" height="4" fill="#e11d48"/></svg>',
);

const sheet = (page: Page) => page.locator('[data-slot="image-upload-sheet"]');
const fileInput = (page: Page) => page.locator('[data-slot="image-upload-input"]');

async function fileIdFrom(src: string): Promise<string> {
  const match = /\/api\/files\/([0-9a-f-]{36})/.exec(src);
  expect(match, `a file id in ${src}`).not.toBeNull();
  return match?.[1] ?? "";
}

test.describe("Owner: the company logo", () => {
  test.use({ storageState: storageStateFor("owner") });
  test.describe.configure({ mode: "serial" });

  test("uploads, shows, serves to any member, refuses the wrong file, removes", async ({
    page,
    browser,
    isMobile,
  }) => {
    // One organization row: the three projects run at once, so only one of them writes it.
    test.skip(
      Boolean(isMobile),
      "the logo changes the one organization row; the desktop project owns it",
    );
    await page.goto("/settings/company");
    await expect(pageHeader(page)).toContainText("Company");
    await hydrated(page);

    // The wrong kind of file never leaves the phone.
    await page.getByRole("button", { name: /^(Add|Change) logo$/ }).click();
    await expect(sheet(page)).toBeVisible();
    await fileInput(page).setInputFiles({
      name: "notes.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("hi"),
    });
    await expect(sheet(page)).toContainText("Use PNG, JPEG, WebP, SVG.");
    await expect(sheet(page).getByRole("button", { name: "Save logo" })).toBeDisabled();

    // An SVG is accepted for a logo, sanitised on the way (the script is gone from the object).
    await fileInput(page).setInputFiles({
      name: "mark.svg",
      mimeType: "image/svg+xml",
      buffer: SVG,
    });
    await expect(sheet(page).locator('[data-slot="image-upload-preview"]')).toBeVisible();
    await sheet(page).getByRole("button", { name: "Save logo" }).click();
    await expect(page.getByText("Company logo saved")).toBeVisible();
    await expect(sheet(page)).toBeHidden();
    const logo = page.locator('[data-slot="company-logo"] [data-slot="file-image"]');
    await expect(logo).toBeVisible();
    const fileId = await fileIdFrom((await logo.getAttribute("src")) ?? "");

    // The preview (a browser-made JPEG) is what the route serves; the original SVG comes back
    // sanitised, sandboxed and as an attachment (never inline on a direct visit).
    const preview = await page.request.get(`/api/files/${fileId}?variant=preview`);
    expect(preview.status()).toBe(200);
    expect(preview.headers()["content-type"]).toBe("image/jpeg");
    expect(preview.headers()["cache-control"]).toContain("private");
    const original = await page.request.get(`/api/files/${fileId}`);
    expect(original.status()).toBe(200);
    expect(original.headers()["content-type"]).toBe("image/svg+xml");
    expect(original.headers()["content-security-policy"]).toContain("sandbox");
    expect(original.headers()["content-disposition"]).toMatch(/^attachment/);
    const body = await original.text();
    expect(body).not.toContain("script");
    expect(body).toContain('fill="#e11d48"');

    // Any member sees the company logo; a signed-out visitor does not.
    const staff = await browser.newContext({ storageState: storageStateFor("staff") });
    expect((await staff.request.get(`/api/files/${fileId}?variant=preview`)).status()).toBe(200);
    await staff.close();
    const nobody = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    expect((await nobody.request.get(`/api/files/${fileId}?variant=preview`)).status()).toBe(404);
    await nobody.close();

    // Replace it with a PNG: the old file is archived (the row stays; the job deletes it later).
    await page.getByRole("button", { name: "Change logo" }).click();
    await fileInput(page).setInputFiles({ name: "logo.png", mimeType: "image/png", buffer: PNG });
    await sheet(page).getByRole("button", { name: "Save logo" }).click();
    await expect(page.getByText("Company logo saved")).toBeVisible();
    await expect(logo).not.toHaveAttribute("src", new RegExp(fileId));
    const [archived] = await serviceSelect<{ archived_at: string | null; status: string }>(
      `files?id=eq.${fileId}&select=archived_at,status`,
    );
    expect(archived?.archived_at).toBeTruthy();
    expect(archived?.status).toBe("ready");

    // Remove: a destructive action with a named confirmation.
    await page.getByRole("button", { name: "Change logo" }).click();
    await sheet(page).getByRole("button", { name: "Remove logo" }).click();
    await page
      .getByRole("alertdialog", { name: "Remove logo?" })
      .getByRole("button", { name: "Remove logo" })
      .click();
    await expect(page.getByText("Company logo removed")).toBeVisible();
    await expect(logo).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Add logo" })).toBeVisible();
  });

  test("the upload sheet closes on back and leaves the screen in place", async ({
    page,
    isMobile,
  }) => {
    if (isMobile) await runInstalled(page);
    await page.goto("/settings");
    await expect(pageHeader(page)).toBeVisible();
    await page.getByRole("link", { name: "Company", exact: true }).click();
    await expect(page).toHaveURL(/\/settings\/company$/);
    await hydrated(page);
    await page.getByRole("button", { name: /^(Add|Change) logo$/ }).click();
    await expect(sheet(page)).toBeVisible();
    await expectBackStack(page, [
      { closes: sheet(page), url: /\/settings\/company$/ },
      { url: /\/settings$/ },
    ]);
  });
});

test.describe("A member's photo", () => {
  test("is their own to set, shown to team.view, never an SVG", async ({
    page,
    browser,
    isMobile,
  }, info) => {
    if (isMobile) await runInstalled(page);
    const email = avatarPerson(info);
    const memberId = await memberIdOf(email);
    // Start without a photo, whatever an earlier run left.
    await patchAs(email, PASSWORD, `members?id=eq.${memberId}`, { avatar_file_id: null });
    await signIn(page, email, PASSWORD);
    await page.goto("/me");
    await expect(pageHeader(page)).toContainText("Me");
    await hydrated(page);

    await page.getByRole("button", { name: "Add photo" }).click();
    await expect(sheet(page)).toBeVisible();
    await fileInput(page).setInputFiles({ name: "me.svg", mimeType: "image/svg+xml", buffer: SVG });
    await expect(sheet(page)).toContainText("SVG is not accepted for photos.");
    await fileInput(page).setInputFiles({ name: "me.png", mimeType: "image/png", buffer: PNG });
    await sheet(page).getByRole("button", { name: "Save photo" }).click();
    await expect(page.getByText("Your photo saved")).toBeVisible();
    const avatar = page.locator('[data-slot="avatar-image"]').first();
    await expect(avatar).toBeVisible();
    const fileId = await fileIdFrom((await avatar.getAttribute("src")) ?? "");
    const [row] = await serviceSelect<{ avatar_file_id: string | null }>(
      `members?id=eq.${memberId}&select=avatar_file_id`,
    );
    expect(row?.avatar_file_id).toBe(fileId);

    // The person and team.view (the Owner) see it; another Staff member does not.
    expect((await page.request.get(`/api/files/${fileId}?variant=preview`)).status()).toBe(200);
    const owner = await browser.newContext({ storageState: storageStateFor("owner") });
    expect((await owner.request.get(`/api/files/${fileId}?variant=preview`)).status()).toBe(200);
    await owner.close();
    const otherStaff = await browser.newContext({ storageState: storageStateFor("staff") });
    expect((await otherStaff.request.get(`/api/files/${fileId}?variant=preview`)).status()).toBe(
      404,
    );
    await otherStaff.close();

    await page.getByRole("button", { name: "Change photo" }).click();
    await sheet(page).getByRole("button", { name: "Remove photo" }).click();
    await page
      .getByRole("alertdialog", { name: "Remove photo?" })
      .getByRole("button", { name: "Remove photo" })
      .click();
    await expect(page.getByText("Your photo removed")).toBeVisible();
    await expect(page.getByRole("button", { name: "Add photo" })).toBeVisible();
  });
});

test.describe("storage_cleanup (the cron route)", () => {
  test.use({ storageState: storageStateFor("owner") });

  test("refuses without the secret and deletes a stale pending upload with it", async ({
    page,
  }, info) => {
    expect((await page.request.post("/api/cron/storage-cleanup")).status()).toBe(401);
    // A safe method never runs a job that deletes.
    expect((await page.request.get("/api/cron/storage-cleanup")).status()).toBe(405);
    expect(
      (
        await page.request.post("/api/cron/storage-cleanup", {
          headers: { authorization: "Bearer wrong" },
        })
      ).status(),
    ).toBe(401);

    const [org] = await serviceSelect<{ id: string }>("organizations?select=id&limit=1");
    const startedAt = wallClock().getTime();
    const stale = await serviceInsert<{ id: string }>("files", {
      org_id: org?.id,
      storage_key: `e2e/${info.project.name}/${startedAt}/stale.png`,
      name: "stale.png",
      mime: "image/png",
      size_bytes: 10,
      status: "pending",
      uploaded_by: await memberIdOf(USERS.staff.email),
      created_at: new Date(startedAt - 2 * 24 * 60 * 60 * 1000).toISOString(),
    });
    const run = await page.request.post("/api/cron/storage-cleanup", {
      headers: { authorization: "Bearer e2e-only-cron-secret-not-used-anywhere-else" },
    });
    expect(run.status()).toBe(200);
    const report = (await run.json()) as { job: string; deleted: number; failed: unknown[] };
    expect(report.job).toBe("storage_cleanup");
    expect(report.deleted).toBeGreaterThanOrEqual(1);
    expect(report.failed).toEqual([]);
    const [after] = await serviceSelect<{ status: string }>(
      `files?id=eq.${stale.id}&select=status`,
    );
    expect(after?.status).toBe("deleted");
    // Idempotent: a second run leaves the row as it is (other projects may add their own rows).
    const again = await page.request.post("/api/cron/storage-cleanup", {
      headers: { authorization: "Bearer e2e-only-cron-secret-not-used-anywhere-else" },
    });
    expect(again.status()).toBe(200);
    const [still] = await serviceSelect<{ status: string }>(
      `files?id=eq.${stale.id}&select=status`,
    );
    expect(still?.status).toBe("deleted");
  });
});
