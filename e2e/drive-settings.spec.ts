import { expect, test } from "./fixtures";

import {
  expectBackStack,
  expectNoHorizontalScroll,
  hydrated,
  memberIdOf,
  runInstalled,
  serviceDelete,
  serviceInsert,
  serviceSelect,
  storageStateFor,
  USERS,
} from "./helpers";

/**
 * Settings → Google Drive (v4.0, ADR-0010, `drive.manage`). The connection is one row per
 * organisation, so this file runs in the serial organisation-wide chain
 * (`WORKING_HOURS_SPECS`, playwright.config.ts: 1280, then 375, then 430 px, one test at a time) and sets the row up
 * itself before each test. The run's server has throwaway Google settings, so the screen is
 * "set up"; nothing here ever reaches Google: Connect is checked by its redirect only, and the
 * stored tokens are placeholders the server cannot open (it never needs to).
 */
test.describe.configure({ mode: "serial" });

const CRON = { authorization: "Bearer e2e-only-cron-secret-not-used-anywhere-else" };
const ACCOUNT = "studio-drive-test@example.com";
const TB2 = 2_000_000_000_000;

async function orgId(): Promise<string> {
  const [org] = await serviceSelect<{ id: string }>("organizations?select=id&limit=1");
  return org!.id;
}

async function resetDrive(): Promise<void> {
  await serviceDelete("drive_account?org_id=not.is.null");
}

async function connectedDrive(
  state: "connected" | "needs_reconnect",
  usedBytes: number | null,
): Promise<void> {
  await resetDrive();
  await serviceInsert("drive_account", {
    org_id: await orgId(),
    google_email: ACCOUNT,
    google_sub: "e2e-account",
    refresh_token_encrypted: "v1.placeholder.placeholder",
    state,
    last_error: state === "needs_reconnect" ? "Token has been expired or revoked." : null,
    connected_by: await memberIdOf(USERS.owner.email),
    connected_at: new Date("2026-11-18T04:30:00Z").toISOString(),
    quota_total_bytes: usedBytes === null ? null : TB2,
    quota_used_bytes: usedBytes,
    quota_checked_at: usedBytes === null ? null : new Date("2026-11-18T03:35:00Z").toISOString(),
  });
}

test.describe("the Owner", () => {
  test.use({ storageState: storageStateFor("owner") });

  test("not connected: one Connect, which leaves for Google with drive.file only", async ({
    page,
  }) => {
    await resetDrive();
    await page.goto("/settings/drive");
    await expect(page.getByRole("heading", { name: "Not connected" })).toBeVisible();
    const connect = page.getByRole("link", { name: "Connect Google Drive" });
    await expect(connect).toHaveAttribute("href", "/api/drive/connect");
    await expect(page.getByRole("button", { name: "Disconnect" })).toHaveCount(0);
    await expectNoHorizontalScroll(page);

    const start = await page.request.get("/api/drive/connect", { maxRedirects: 0 });
    expect(start.status()).toBe(303);
    const google = new URL(start.headers()["location"]!);
    expect(google.origin + google.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(google.searchParams.get("scope")).toBe("https://www.googleapis.com/auth/drive.file");
    expect(google.searchParams.get("access_type")).toBe("offline");
    expect(google.searchParams.get("redirect_uri")).toMatch(/\/api\/drive\/callback$/);
    expect(google.searchParams.get("state")).toMatch(/^[\w-]{40,}$/);
  });

  test("a callback without its own state is refused and says so", async ({ page }) => {
    await resetDrive();
    await page.goto("/api/drive/callback?state=forged&code=anything");
    await expect(page).toHaveURL(/\/settings\/drive\?drive=expired$/);
    await expect(page.locator('[data-slot="drive-outcome"]')).toContainText(
      "That sign-in took too long or came from another tab.",
    );
    await expect(page.getByRole("heading", { name: "Not connected" })).toBeVisible();
  });

  test("connected: the account, the space left, and Disconnect after a named red confirm", async ({
    page,
  }) => {
    // 85% used: the warning level.
    await connectedDrive("connected", 1_700_000_000_000);
    await page.goto("/settings/drive");
    await expect(page.getByRole("heading", { name: "Connected" })).toBeVisible();
    await expect(page.locator('[data-slot="drive-email"]')).toHaveText(ACCOUNT);
    const space = page.locator('[data-slot="drive-space"]');
    await expect(space).toContainText("300 GB free of 2 TB");
    await expect(space.getByRole("meter")).toHaveAttribute("aria-valuenow", "85");
    await expect(page.getByRole("link", { name: "Use another account" })).toBeVisible();
    await expectNoHorizontalScroll(page);

    await hydrated(page);
    await page.getByRole("button", { name: "Disconnect" }).click();
    const confirm = page.getByRole("alertdialog");
    await expect(confirm).toContainText("Everything already in Drive stays where it is.");
    await confirm.getByRole("button", { name: "Disconnect Drive" }).click();
    await expect(page.getByRole("heading", { name: "Not connected" })).toBeVisible();

    const [row] = await serviceSelect<{ state: string; refresh_token_encrypted: string | null }>(
      "drive_account?select=state,refresh_token_encrypted",
    );
    expect(row).toEqual({ state: "disconnected", refresh_token_encrypted: null });
  });

  test("needs reconnecting: says so, Reconnect is the one solid button", async ({ page }) => {
    await connectedDrive("needs_reconnect", null);
    await page.goto("/settings/drive");
    await expect(page.getByRole("heading", { name: "Needs reconnecting" })).toBeVisible();
    await expect(page.getByText("MaxOff can no longer reach this Google account.")).toBeVisible();
    await expect(page.getByRole("link", { name: "Reconnect" })).toHaveAttribute(
      "data-variant",
      "primary",
    );
    await expect(page.locator('[data-slot="drive-space"]')).toHaveCount(0);
  });

  test("installed: back from Google Drive returns to Settings, and closes Disconnect first", async ({
    page,
    isMobile,
  }) => {
    test.skip(!isMobile, "the installed back gesture is a phone's (375 and 430 px)");
    await connectedDrive("connected", 400_000_000_000);
    await runInstalled(page);
    await page.goto("/settings");
    await page
      .locator('[data-slot="settings-section"]')
      .filter({ hasText: "Google Drive" })
      .click();
    await expect(page).toHaveURL(/\/settings\/drive$/);
    await hydrated(page);
    await page.getByRole("button", { name: "Disconnect" }).click();
    const confirm = page.getByRole("alertdialog");
    await expect(confirm).toBeVisible();

    await expectBackStack(page, [
      { closes: confirm, url: /\/settings\/drive$/ },
      { url: /\/settings$/ },
    ]);
  });

  test("the daily space check runs for the cron only", async ({ page }) => {
    await resetDrive();
    expect((await page.request.post("/api/cron/drive-space-check")).status()).toBe(401);
    const run = await page.request.post("/api/cron/drive-space-check", { headers: CRON });
    expect(run.status()).toBe(200);
    const body = (await run.json()) as Record<string, unknown>;
    expect(body).toEqual({
      job: "drive_space_check",
      checked: 0,
      alerts: 0,
      needsReconnect: 0,
      failed: [],
      // v5.0: the daily "Removed in Drive" pass runs after it. With no Drive connected it reads
      // nothing (files other specs handed in are skipped, so their count is not pinned here).
      handin: { checked: 0, skipped: expect.any(Number) },
    });
  });
});

test.describe("Admins and Crew", () => {
  for (const role of ["admin", "staff"] as const) {
    test(`${role}: the screen and Connect are refused`, async ({ browser }) => {
      const context = await browser.newContext({ storageState: storageStateFor(role) });
      const page = await context.newPage();
      await page.goto("/settings/drive");
      await expect(page).toHaveURL(/\/forbidden(\?|$)/);
      const start = await page.request.get("/api/drive/connect", { maxRedirects: 0 });
      expect(start.headers()["location"]).toMatch(/\/forbidden\?for=drive\.manage$/);
      await context.close();
    });
  }
});
