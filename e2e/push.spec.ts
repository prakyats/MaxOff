import { type Locator, type TestInfo } from "@playwright/test";

import { fromBase64Url } from "../src/core/notifications/push/base64url";
import { decryptPayload, generateReceiverKeys } from "../src/core/notifications/push/encrypt";
import { verifyVapidToken } from "../src/core/notifications/push/vapid";
import { expect, test } from "./fixtures";
import {
  expectBackStack,
  hydrated,
  memberIdOf,
  pageHeader,
  runInstalled,
  serviceDelete,
  serviceSelect,
  signIn,
  storageStateFor,
  USERS,
} from "./helpers";
import { addDevice, fakePushService, PUSH_PASSWORD, type Receiver, stubPush } from "./push-shared";

/**
 * Web Push (task 5.2, WORKFLOWS §9a, kickoff 5 decisions 1, 5 and 9). Headless Chromium has no
 * push service, so `PushManager.subscribe` and `Notification` are stubbed **in the browser**
 * (the platform's answer is faked); everything behind them is real: the subscription RPC, the
 * banner's per-member rule, Me's rows, the test push, VAPID and the RFC 8291 encryption. The
 * cron and after-action dispatch are push-cron.spec.ts's, in a serial project of their own
 * (owner decision 29): this file never runs the cron nor touches the organisation's settings. The pushes go to a fake push service this file runs on the loopback host, which
 * keeps every POST; the spec decrypts them with the throwaway receiver keys it made and
 * verifies the VAPID token with the run's throwaway public key (playwright.config.ts).
 *
 * Each project has its own Staff member (seeded `push-<project>@maxoff.local`): the banner is
 * judged per member, so the projects running side by side never share one person's
 * subscriptions. Their subscriptions are removed at the start and the end.
 */

/** This project's own Staff member. */
function pushPerson(info: TestInfo): string {
  return `push-${info.project.name}@maxoff.local`;
}

async function removeSubscriptionsOf(email: string): Promise<void> {
  const memberId = await memberIdOf(email);
  await serviceDelete(`push_subscriptions?member_id=eq.${memberId}`);
}

test.describe("Web Push", () => {
  test.describe.configure({ mode: "serial" });
  // Signed in as this project's own person in beforeEach, not from a saved session.
  test.use({ storageState: { cookies: [], origins: [] } });

  let service: Awaited<ReturnType<typeof fakePushService>>;
  let receiver: Receiver;

  test.beforeAll(async ({}, info) => {
    service = await fakePushService();
    receiver = await generateReceiverKeys();
    await removeSubscriptionsOf(pushPerson(info));
  });

  test.beforeEach(async ({ page }, info) => {
    await signIn(page, pushPerson(info), PUSH_PASSWORD);
  });

  test.afterAll(async ({}, info) => {
    await removeSubscriptionsOf(pushPerson(info));
    await new Promise<void>((resolve) => service.server.close(() => resolve()));
  });

  test("the banner asks on every screen, permission only on the tap; one device that received a push stops it everywhere", async ({
    page,
    isMobile,
  }) => {
    await stubPush(page, {
      permission: "default",
      endpoint: `${service.url}/ok/staff-phone`,
      receiver,
    });
    await page.goto("/my-day");
    const banner = page.locator('[data-slot="push-banner"]');
    await expect(banner).toBeVisible();
    await expect(banner).toHaveAttribute("data-state", "default");
    // One line above the bottom bar (5A decision 30): "Notifications are off · Turn on".
    await expect(banner.getByText("Notifications are off").filter({ visible: true })).toBeVisible();
    // Nothing was asked yet: permission is requested only on the tap (decision 9).
    expect(
      await page.evaluate(
        () => (window as unknown as { __permissionAsked?: boolean }).__permissionAsked,
      ),
    ).toBeUndefined();
    // On another screen too, and no dismiss anywhere.
    await page.goto("/tasks");
    await expect(page.locator('[data-slot="push-banner"]')).toBeVisible();
    await expect(
      page.locator('[data-slot="push-banner"]').getByRole("button", { name: /dismiss|close/i }),
    ).toHaveCount(0);

    // The band opens a sheet; opening it asks nothing yet, its button does.
    await page.locator('[data-slot="push-banner"]').click();
    const sheet = page.locator('[data-slot="push-sheet"]');
    await expect(sheet.getByRole("heading", { name: "Turn on notifications" })).toBeVisible();
    expect(
      await page.evaluate(
        () => (window as unknown as { __permissionAsked?: boolean }).__permissionAsked,
      ),
    ).toBeUndefined();
    await sheet.locator('[data-slot="push-enable"]').click();
    expect(
      await page.evaluate(
        () => (window as unknown as { __permissionAsked?: boolean }).__permissionAsked,
      ),
    ).toBe(true);
    // 5.5 (owner decision 2026-10-03): turned on is not yet working. The band stays until a push
    // has reached a device of theirs, and now asks for a test.
    await expect(sheet).toHaveCount(0);
    await expect(banner).toHaveAttribute("data-reason", "unconfirmed");
    await expect(
      banner.getByText("Check notifications reach you").filter({ visible: true }),
    ).toBeVisible();
    await banner.click();
    await expect(
      sheet.getByRole("heading", { name: "Check notifications reach you" }),
    ).toBeVisible();
    await sheet.locator('[data-slot="push-band-test"]').click();
    // The push service accepted the test: a delivery, so the band goes.
    await expect(page.locator('[data-slot="push-banner"]')).toBeHidden();
    await expect(sheet).toHaveCount(0);
    const staffId = await memberIdOf(pushPerson(test.info()));
    const rows = await serviceSelect<{
      endpoint: string;
      platform: string;
      disabled_at: string | null;
      delivered: boolean;
    }>(
      `push_subscriptions?member_id=eq.${staffId}&select=endpoint,platform,disabled_at,delivered:last_success_at`,
    );
    expect(rows.map((row) => ({ ...row, delivered: row.delivered !== null }))).toEqual([
      // The phone projects emulate an Android phone, so the platform follows the device.
      {
        endpoint: `${service.url}/ok/staff-phone`,
        platform: isMobile ? "android" : "desktop",
        disabled_at: null,
        delivered: true,
      },
    ]);

    // Judged per member: a second browser of theirs with no subscription sees no banner, and Me
    // shows the quiet row instead (decision 9).
    const other = await page
      .context()
      .browser()!
      .newContext({
        storageState: await page.context().storageState(),
        viewport: page.viewportSize(),
      });
    const second = await other.newPage();
    await stubPush(second, {
      permission: "default",
      endpoint: `${service.url}/ok/staff-laptop`,
      receiver,
    });
    await second.goto("/me");
    await expect(second.locator('[data-slot="push-banner"]')).toHaveCount(0);
    const row = second.locator('[data-slot="push-device-row"]');
    await expect(row).toHaveAttribute("data-state", "elsewhere");
    await expect(
      row.getByText("Notifications are on for your phone. Turn them on here too."),
    ).toBeVisible();
    await other.close();
    // The band's test stamped last_test_at: the next test's own test would be refused for 30 s
    // (5A review S2), so this device goes; the next test stores it again on load.
    await serviceDelete(`push_subscriptions?member_id=eq.${staffId}`);
  });

  test("Me: this device is on; Send a test reaches the device, encrypted and signed", async ({
    page,
  }) => {
    await stubPush(page, {
      permission: "granted",
      endpoint: `${service.url}/ok/staff-phone`,
      receiver,
    });
    await page.goto("/me");
    const row = page.locator('[data-slot="push-device-row"]');
    await expect(row).toHaveAttribute("data-state", "here");
    await expect(row.getByText("Notifications are on for this device.")).toBeVisible();

    const before = service.received.length;
    await page.locator('[data-slot="push-test"]').click();
    await expect(page.locator('[data-slot="push-test-outcome"]')).toHaveText("Sent to 1 device");
    const pushes = service.received.slice(before);
    expect(pushes).toHaveLength(1);
    const [push] = pushes;
    expect(push!.path).toBe("/ok/staff-phone");
    expect(push!.encoding).toBe("aes128gcm");
    // The VAPID token verifies with this run's public key and names the fake service's origin.
    const token = push!.authorization.slice("vapid t=".length, push!.authorization.indexOf(", k="));
    expect(await verifyVapidToken(process.env.E2E_VAPID_PUBLIC_KEY ?? "", token)).toBe(true);
    const claims = JSON.parse(Buffer.from(fromBase64Url(token.split(".")[1]!)).toString()) as {
      aud: string;
      sub: string;
    };
    expect(claims).toMatchObject({ aud: service.url, sub: "mailto:e2e@maxoff.local" });
    // Only the receiver's keys open it: the full text, no notifications row behind it.
    const opened = JSON.parse(
      Buffer.from(await decryptPayload(new Uint8Array(push!.body), receiver)).toString(),
    ) as {
      title: string;
      url: string;
      tag: string;
    };
    expect(opened).toMatchObject({ title: "MaxOff notifications are on", url: "/me", tag: "test" });
    const staffId = await memberIdOf(pushPerson(test.info()));
    const [sub] = await serviceSelect<{ last_test_at: string | null }>(
      `push_subscriptions?member_id=eq.${staffId}&select=last_test_at`,
    );
    expect(sub?.last_test_at, "last_test_at is stamped").toBeTruthy();
  });

  test("a device that answers gone is disabled and the test says so", async ({ page }) => {
    const staffId = await memberIdOf(pushPerson(test.info()));
    await serviceDelete(`push_subscriptions?member_id=eq.${staffId}`);
    await stubPush(page, {
      permission: "granted",
      endpoint: `${service.url}/down/staff-phone`,
      receiver,
    });
    await page.goto("/me");
    // Permission granted, no row on the server: PushSync stores this device on load.
    await expect(page.locator('[data-slot="push-device-row"]')).toHaveAttribute(
      "data-state",
      "here",
    );
    await page.locator('[data-slot="push-test"]').click();
    await expect(page.locator('[data-slot="push-test-outcome"]')).toHaveText(
      "No device accepted it. Check the device's notification settings, then try again.",
    );
  });

  test("Sign out of this device deletes this device's subscription", async ({ page }) => {
    const staffId = await memberIdOf(pushPerson(test.info()));
    await serviceDelete(`push_subscriptions?member_id=eq.${staffId}`);
    // Another device of theirs stays: only this one goes.
    await addDevice(staffId, `${service.url}/ok/other-device`, receiver);
    await stubPush(page, {
      permission: "granted",
      endpoint: `${service.url}/ok/signing-out`,
      receiver,
    });
    await page.goto("/me");
    // Permission granted and no row for this browser: PushSync stores it on load.
    await expect(page.locator('[data-slot="push-device-row"]')).toHaveAttribute(
      "data-state",
      "here",
    );
    await expect
      .poll(async () =>
        (
          await serviceSelect<{ endpoint: string }>(
            `push_subscriptions?member_id=eq.${staffId}&select=endpoint&order=endpoint`,
          )
        ).map((row) => row.endpoint),
      )
      .toEqual([`${service.url}/ok/other-device`, `${service.url}/ok/signing-out`]);

    await page.getByRole("button", { name: "Sign out" }).click();
    await page
      .getByRole("alertdialog", { name: "Sign out of this device?" })
      .getByRole("button", { name: "Sign out" })
      .click();
    await expect(page).toHaveURL(/\/login/);
    const left = await serviceSelect<{ endpoint: string }>(
      `push_subscriptions?member_id=eq.${staffId}&select=endpoint`,
    );
    expect(left.map((row) => row.endpoint)).toEqual([`${service.url}/ok/other-device`]);
    await serviceDelete(`push_subscriptions?member_id=eq.${staffId}`);
  });

  test("installed: the band's sheet closes on back; its Turn on and Send a test add no history; back from home leaves", async ({
    page,
    isMobile,
  }) => {
    test.skip(!isMobile, "installed-mode back is a phone rule (375 and 430)");
    const staffId = await memberIdOf(pushPerson(test.info()));
    await serviceDelete(`push_subscriptions?member_id=eq.${staffId}`);
    await runInstalled(page);
    await stubPush(page, {
      permission: "default",
      endpoint: `${service.url}/ok/installed-banner`,
      receiver,
    });
    await page.goto("/my-day");
    await hydrated(page);
    const band = page.locator('[data-slot="push-banner"]');
    const sheet = page.locator('[data-slot="push-sheet"]');
    // The sheet is a layer (§14.2 a): back closes it and the screen stays.
    await band.click();
    await expect(sheet).toBeVisible();
    await page.goBack();
    await expect(sheet).toHaveCount(0);
    await expect(page).toHaveURL(/\/my-day$/);
    await expect(band).toBeVisible();
    // Turned on from the sheet: the sheet's entry goes, the band asks for a test (5.5), and the
    // test from its sheet ends it; nothing is added.
    await band.click();
    await sheet.locator('[data-slot="push-enable"]').click();
    await expect(sheet).toHaveCount(0);
    await expect(band).toHaveAttribute("data-reason", "unconfirmed");
    await band.click();
    await sheet.locator('[data-slot="push-band-test"]').click();
    await expect(band).toBeHidden();
    await expect(sheet).toHaveCount(0);
    await expect(page).toHaveURL(/\/my-day$/);
    // The band is no drill-down: one back leaves the app.
    await expectBackStack(page, [{ url: /^about:blank$/ }]);
    await serviceDelete(`push_subscriptions?member_id=eq.${staffId}`);
  });

  test('installed: Me\'s "Turn them on here too" and Send test add no history; back returns home', async ({
    page,
    isMobile,
  }) => {
    test.skip(!isMobile, "installed-mode back is a phone rule (375 and 430)");
    const staffId = await memberIdOf(pushPerson(test.info()));
    await serviceDelete(`push_subscriptions?member_id=eq.${staffId}`);
    // On for another device of theirs: this one shows the quiet row (decision 9).
    await addDevice(staffId, `${service.url}/ok/installed-other`, receiver);
    await runInstalled(page);
    await stubPush(page, {
      permission: "default",
      endpoint: `${service.url}/ok/installed-me`,
      receiver,
    });
    await page.goto("/my-day");
    await hydrated(page);
    await page.locator("[data-slot='bottom-nav']").getByRole("link", { name: "Me" }).click();
    await expect(page).toHaveURL(/\/me$/);
    const row = page.locator('[data-slot="push-device-row"]');
    await expect(row).toHaveAttribute("data-state", "elsewhere");
    await row.locator('[data-slot="push-enable"]').click();
    await expect(row).toHaveAttribute("data-state", "here");
    await page.locator('[data-slot="push-test"]').click();
    await expect(page.locator('[data-slot="push-test-outcome"]')).toHaveText("Sent to 2 devices");
    await expect(page).toHaveURL(/\/me$/);
    // Me is a tab above home: back returns to My Day, the next back leaves.
    await expectBackStack(page, [{ url: /\/my-day$/ }, { url: /^about:blank$/ }]);
    await serviceDelete(`push_subscriptions?member_id=eq.${staffId}`);
  });

  test("denied: the band's sheet says how to re-enable and never asks again", async ({ page }) => {
    const staffId = await memberIdOf(pushPerson(test.info()));
    await serviceDelete(`push_subscriptions?member_id=eq.${staffId}`);
    await stubPush(page, { permission: "denied", endpoint: `${service.url}/ok/x`, receiver });
    await page.goto("/my-day");
    const banner = page.locator('[data-slot="push-banner"]');
    await expect(banner).toHaveAttribute("data-state", "denied");
    await expect(banner.getByText("Notifications are off").filter({ visible: true })).toBeVisible();
    await banner.click();
    const sheet = page.locator('[data-slot="push-sheet"]');
    await expect(
      sheet.getByRole("heading", { name: "Notifications are blocked on this device" }),
    ).toBeVisible();
    await expect(sheet.getByText(/site settings/)).toBeVisible();
    await expect(page.locator('[data-slot="push-enable"]')).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(sheet).toHaveCount(0);
    await page.goto("/me");
    await expect(page.locator('[data-slot="push-device-row"]')).toHaveAttribute(
      "data-state",
      "blocked",
    );
    await expect(page.locator('[data-slot="push-test"]')).toBeDisabled();
  });

  for (const browser of ["brave", "other"] as const) {
    test(`a subscribe the browser rejects after Allow (${browser}): the sheet explains it with Try again, never Retry`, async ({
      page,
    }) => {
      const staffId = await memberIdOf(pushPerson(test.info()));
      await serviceDelete(`push_subscriptions?member_id=eq.${staffId}`);
      await stubPush(page, {
        permission: "default",
        endpoint: `${service.url}/ok/rejected-${browser}`,
        receiver,
        rejectSubscribe: browser,
      });
      await page.goto("/my-day");
      await hydrated(page);
      const band = page.locator('[data-slot="push-banner"]');
      await band.click();
      const sheet = page.locator('[data-slot="push-sheet"]');
      await sheet.locator('[data-slot="push-enable"]').click();
      await expect(sheet).toHaveAttribute(
        "data-failure",
        browser === "brave" ? "brave" : "generic",
      );
      await expect(
        sheet.getByRole("heading", {
          name:
            browser === "brave"
              ? "Brave blocks notifications by default"
              : "This browser couldn't turn on notifications",
        }),
      ).toBeVisible();
      if (browser === "brave") {
        await expect(sheet).toContainText("Use Google services for push messaging");
      }
      // Not the network failure's Retry: the page is not broken, nothing was saved.
      await expect(page.getByRole("button", { name: "Retry" })).toHaveCount(0);
      await expect(page.locator('[data-slot="action-failed"]')).toHaveCount(0);
      const enable = sheet.locator('[data-slot="push-enable"]');
      await expect(enable).toHaveText("Try again");
      await expect(enable).toBeEnabled();
      await expect(band).toBeVisible();
      expect(
        await serviceSelect(`push_subscriptions?member_id=eq.${staffId}&select=endpoint`),
      ).toEqual([]);

      // Fixed in the browser (Brave's setting turned on), Try again goes through.
      await page.evaluate(() => {
        (window as unknown as { __subscribeFails: boolean }).__subscribeFails = false;
      });
      await enable.click();
      await expect(sheet).toHaveCount(0);
      // On now, nothing received yet: the band asks for a test (5.5).
      await expect(band).toHaveAttribute("data-reason", "unconfirmed");
      await serviceDelete(`push_subscriptions?member_id=eq.${staffId}`);
    });
  }

  test("the band fits a phone: 44px targets, no sideways scroll, nothing at the top moves, nothing hides behind it", async ({
    page,
    isMobile,
  }) => {
    test.skip(!isMobile, "the phone layout");
    const staffId = await memberIdOf(pushPerson(test.info()));
    await serviceDelete(`push_subscriptions?member_id=eq.${staffId}`);
    await stubPush(page, { permission: "default", endpoint: `${service.url}/ok/x`, receiver });
    await page.goto("/my-day");
    await hydrated(page);
    const band = page.locator('[data-slot="push-banner"]');
    const bandBox = await shownBox(band);
    expect(bandBox.height).toBeGreaterThanOrEqual(44);
    expect(bandBox.width).toBeLessThanOrEqual(page.viewportSize()!.width);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    // Never at the top (decision 30): the title bar sits right under the brand bar… Both are
    // measured as shown: React keeps a streamed section's copy hidden until it reveals it, and a
    // hidden copy has no box.
    const title = await shownBox(pageHeader(page));
    const brand = await shownBox(page.locator('[data-slot="top-bar"]:visible'));
    expect(Math.abs(title.y - (brand.y + brand.height))).toBeLessThanOrEqual(1);
    // …and its height is reserved: scrolled to the end, the last content ends above it.
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    const last = await shownBox(page.locator("main > *:visible").last());
    const bandNow = await shownBox(band);
    expect(last.y + last.height).toBeLessThanOrEqual(bandNow.y + 1);
    // The sheet's button is a 44px target too.
    await band.click();
    const button = await shownBox(page.locator('[data-slot="push-enable"]'));
    expect(button.height).toBeGreaterThanOrEqual(44);
  });
});

test.describe("the deep-link entry (ARCHITECTURE §14.2 h)", () => {
  test.use({ storageState: storageStateFor("owner") });

  test("lands on the record with its list underneath: back goes to the list", async ({ page }) => {
    const staffId = await memberIdOf(USERS.staff.email);
    await page.goto(`/open?to=${encodeURIComponent(`/people/${staffId}`)}`);
    await expect(page).toHaveURL(new RegExp(`/people/${staffId}$`));
    // One back link per breakpoint (the header's on a phone, the text link from md up).
    await expect(page.locator('[data-slot="page-back"]:visible')).toBeVisible();
    await expectBackStack(page, [{ url: /\/people$/ }]);
  });

  test("a top-level screen sits on home; an outside or bad target goes home", async ({ page }) => {
    await page.goto("/open?to=%2Fapprovals");
    await expect(page).toHaveURL(/\/approvals$/);
    await expectBackStack(page, [{ url: /\/today$/ }]);
    await page.goto("/open?to=https%3A%2F%2Fevil.example%2Fx");
    await expect(page).toHaveURL(/\/today$/);
    await page.goto("/open");
    await expect(page).toHaveURL(/\/today$/);
  });

  test("installed: the same order on a phone", async ({ page, isMobile }) => {
    test.skip(!isMobile, "installed-mode back is a phone rule");
    await runInstalled(page);
    const staffId = await memberIdOf(USERS.staff.email);
    await page.goto(`/open?to=${encodeURIComponent(`/people/${staffId}`)}`);
    await expect(page).toHaveURL(new RegExp(`/people/${staffId}$`));
    await hydrated(page);
    await expectBackStack(page, [{ url: /\/people$/ }]);
  });
});

/** The box of what the user sees: waits for it to be shown, and fails loudly if it has none. */
async function shownBox(
  locator: Locator,
): Promise<{ x: number; y: number; width: number; height: number }> {
  await expect(locator).toBeVisible();
  const box = await locator.boundingBox();
  expect(box, "a shown element has a box").not.toBeNull();
  return box!;
}
