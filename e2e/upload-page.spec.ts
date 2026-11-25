import type { Browser, Page, TestInfo } from "@playwright/test";

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
 * The uploader's page, `/upload#<token>` (v4.5, WORKFLOWS §5B.2; the sample §2, §3; security plan
 * A6, A8, B5, J). Organisation-wide like the card (the Drive connection), so it runs in the serial
 * chain (`WORKING_HOURS_SPECS`). No spec reaches Google: the studio's Drive is "needs
 * reconnecting", so the page shows screen R and a started file waits (§5B.6). The bad-link counter
 * is cleared before each test, so this file never blocks the run's network (plan C1).
 */
test.describe.configure({ mode: "serial" });

const owner = USERS.owner;
const admin = USERS.admin;
const staff = USERS.staff;
const BAD = "This upload link doesn't work any more";

const titleOf = (info: TestInfo, what: string) => `UP ${what} (${info.project.name})`;

async function orgId(): Promise<string> {
  const [org] = await serviceSelect<{ id: string }>("organizations?select=id&limit=1");
  return org!.id;
}

/** The studio's Drive, waiting to be reconnected: links can be made, no file starts. */
async function driveNeedsReconnect(): Promise<void> {
  await serviceDelete("drive_account?org_id=not.is.null");
  await serviceInsert("drive_account", {
    org_id: await orgId(),
    google_email: "studio-drive-test@example.com",
    google_sub: "e2e-account",
    refresh_token_encrypted: "v1.placeholder.placeholder",
    state: "needs_reconnect",
    last_error: "Token has been expired or revoked.",
    connected_by: await memberIdOf(owner.email),
    connected_at: systemClock().toISOString(),
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
    await serviceDelete(`upload_links?task_id=${ids}`);
  }
  await removeTasksTitled(title);
}

/** A link made the way the studio makes one: the Admin's Get upload link on the task. */
async function linkFor(browser: Browser, info: TestInfo, what: string): Promise<string> {
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
  // The link names the configured app origin; the run's server is on its own port.
  return `${url.pathname}${url.hash}`;
}

/** Every request the page made, to check no URL carries the token (plan A8). */
function watchUrls(page: Page): string[] {
  const urls: string[] = [];
  page.on("request", (request) => urls.push(request.url()));
  return urls;
}

test.beforeEach(async () => {
  await serviceDelete("upload_rate_hits?bucket=not.is.null");
  await driveNeedsReconnect();
});

test.describe("anyone with the link", () => {
  test("A → B: a name, then the files; the token leaves the address bar and every URL", async ({
    browser,
    page,
  }, info) => {
    const link = await linkFor(browser, info, "flow");
    const token = link.split("#")[1]!;
    const urls = watchUrls(page);
    await page.goto(link);

    await expect(page.locator('[data-slot="upload-task"]')).toHaveText(titleOf(info, "flow"));
    await expect(page.locator('[data-slot="upload-studio"]')).not.toBeEmpty();
    expect(new URL(page.url()).hash).toBe("");
    await expectNoHorizontalScroll(page);

    // Continue says what is missing, then takes the name.
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.locator("#upload-name-hint")).toHaveText("Type your name to continue");
    await page.getByLabel("Your name").fill("Sam");
    await page.getByRole("button", { name: "Continue" }).click();

    await expect(page.locator('[data-slot="upload-name"]')).toHaveText("Sam");
    // Screen R: the studio's Drive can't take files (it needs reconnecting).
    await expect(page.locator('[data-slot="upload-banner"]')).toHaveAttribute(
      "data-banner",
      "drive_unavailable",
    );
    await page
      .locator('input[type="file"]')
      .first()
      .setInputFiles({
        name: "IMG_0412.MOV",
        mimeType: "video/quicktime",
        buffer: Buffer.from("not really a video"),
      });
    const ready = page.locator('[data-slot="upload-ready"]');
    await expect(ready).toContainText("1 file · 18 bytes");
    await page.getByRole("button", { name: "Upload 1 file" }).click();
    // The start waits for the Drive; the file waits with it and starts by itself later.
    const row = page.locator('[data-slot="upload-files"] [data-slot="upload-file"]');
    await expect(row).toHaveAttribute("data-state", "Waiting");
    await expect(row).toContainText("starts by itself");

    for (const url of urls) expect(url).not.toContain(token);
    // The uploader is recorded with the name and nothing else of theirs is shown to the page.
    const [uploader] = await serviceSelect<{ name: string; on_task: boolean }>(
      `upload_uploaders?name=eq.Sam&select=name,on_task&order=created_at.desc&limit=1`,
    );
    expect(uploader).toEqual({ name: "Sam", on_task: false });

    // J: the same device comes back (a reload keeps the link in this tab).
    await page.reload();
    await expect(page.getByRole("heading", { name: "Welcome back, Sam" })).toBeVisible();
    // "Not Sam?" starts again with a new name on this device.
    await page.getByRole("button", { name: "Not Sam? Use another name" }).click();
    await expect(page.getByLabel("Your name")).toBeVisible();
  });

  test("L: a stopped, mistyped or missing link shows the one screen, naming nothing", async ({
    browser,
    page,
  }, info) => {
    const link = await linkFor(browser, info, "stopped");
    const [row] = await serviceSelect<{ id: string }>(
      `upload_links?task_id=in.(${(
        await serviceSelect<{ id: string }>(
          `tasks?title=eq.${encodeURIComponent(titleOf(info, "stopped"))}&select=id`,
        )
      )
        .map((task) => task.id)
        .join(",")})&select=id`,
    );
    await rpcAs(admin.email, admin.password, "upload_link_stop", { p_link_id: row!.id });

    const random = "A".repeat(43);
    for (const address of [link, "/upload#short", `/upload#${random}`, "/upload"]) {
      await page.goto(address);
      await expect(page.getByRole("heading", { name: BAD })).toBeVisible();
      await expect(page.locator('[data-slot="upload-bad"]')).not.toContainText(
        titleOf(info, "stopped"),
      );
      await expect(page.locator('[data-slot="upload-studio"]')).toHaveText("MaxOff");
    }
  });

  test("How we use this: back closes it, at a phone's size installed", async ({
    browser,
    page,
    isMobile,
  }, info) => {
    test.skip(!isMobile, "the installed back gesture is a phone's (375 and 430 px)");
    const link = await linkFor(browser, info, "privacy");
    await runInstalled(page);
    await page.goto(link);
    // The page's screens are drawn by its own code once the link answered: it is live by then.
    await expect(page.locator('[data-slot="upload-name-step"]')).toBeVisible();
    await page.getByRole("button", { name: "How we use this" }).click();
    const sheet = page.locator('[data-slot="upload-privacy"]');
    await expect(sheet).toContainText("erased");
    await expectBackStack(page, [{ closes: sheet, url: /\/upload$/ }]);
  });
});

test.describe("the page and its API (plan B5, J)", () => {
  test("the page: never cached, indexed or referred; no session read or cookie set", async ({
    browser,
  }) => {
    // A signed-in member opening it: the page still sets no cookie and keeps no session.
    const context = await browser.newContext({ storageState: storageStateFor("owner") });
    const page = await context.newPage();
    const response = await page.goto("/upload");
    const headers = response!.headers();
    expect(headers["cache-control"]).toContain("no-store");
    expect(headers["referrer-policy"]).toBe("no-referrer");
    expect(headers["x-robots-tag"]).toBe("noindex, nofollow");
    expect(headers["cross-origin-opener-policy"]).toBe("same-origin");
    expect(headers["set-cookie"]).toBeUndefined();
    await context.close();
  });

  test("J1: the page sends its own nonce CSP", async ({ page }) => {
    // Red until the page has its own root layout (the commit after the `(main)` move, PROGRESS):
    // under today's root layout its inline scripts carry no nonce. That commit flips this test.
    test.fail();
    const response = await page.goto("/upload");
    const csp = response!.headers()["content-security-policy"] ?? "";
    expect(csp).toMatch(/script-src 'self' 'nonce-[^']+' 'strict-dynamic'/);
    expect(csp).toContain("connect-src 'self' https://www.googleapis.com");
    expect(csp).toContain("frame-ancestors 'none'");
  });

  test("the API: POST of JSON only, the one bad-link answer, nothing from another origin", async ({
    page,
  }) => {
    // A browser's POST always names its origin; the API refuses one that doesn't (below).
    const origin = new URL(test.info().project.use.baseURL ?? "http://localhost:3100").origin;
    const post = (path: string, init: { headers?: Record<string, string>; data?: unknown }) =>
      page.request.post(path, {
        failOnStatusCode: false,
        ...init,
        headers: { origin, ...init.headers },
      });

    const noToken = await post("/api/upload/resolve", { data: { deviceKey: null } });
    expect(noToken.status()).toBe(404);
    const badLink = {
      ok: false,
      error: { code: "NOT_FOUND", message: "This upload link doesn't work any more." },
    };
    expect(await noToken.json()).toEqual(badLink);
    expect(noToken.headers()["cache-control"]).toContain("no-store");
    expect(noToken.headers()["set-cookie"]).toBeUndefined();
    expect(noToken.headers()["access-control-allow-origin"]).toBeUndefined();

    const unknown = await post("/api/upload/resolve", {
      headers: { authorization: `UploadLink ${"B".repeat(43)}` },
      data: { deviceKey: null },
    });
    // An unknown link gets the very same answer as no link at all (plan A6).
    expect(unknown.status()).toBe(404);
    expect(await unknown.json()).toEqual(badLink);

    const foreign = await post("/api/upload/resolve", {
      headers: {
        origin: "https://elsewhere.example",
        authorization: `UploadLink ${"B".repeat(43)}`,
      },
      data: { deviceKey: null },
    });
    expect(foreign.status()).toBe(403);

    const noOrigin = await page.request.post("/api/upload/resolve", {
      failOnStatusCode: false,
      data: { deviceKey: null },
    });
    expect(noOrigin.status()).toBe(403);

    const notJson = await page.request.post("/api/upload/resolve", {
      failOnStatusCode: false,
      headers: { origin, "content-type": "text/plain" },
      data: "hello",
    });
    expect(notJson.status()).toBe(415);

    const big = await post("/api/upload/register", {
      headers: { authorization: `UploadLink ${"B".repeat(43)}` },
      data: { deviceKey: "C".repeat(43), name: "x".repeat(70_000) },
    });
    expect(big.status()).toBe(413);

    const get = await page.request.get("/api/upload/resolve", { failOnStatusCode: false });
    expect(get.status()).toBe(405);
  });
});
