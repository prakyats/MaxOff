import type { Browser, BrowserContext, Page, TestInfo } from "@playwright/test";

import { generateReceiverKeys } from "../src/core/notifications/push/encrypt";
import { systemClock } from "../src/core/time";
import { expect, test } from "./fixtures";
import {
  acceptFixtureInvite,
  answerStartPrompt,
  followAuthLink,
  hydrated,
  inviteFixturePerson,
  removeFixturePerson,
  runInstalled,
  serviceDelete,
  serviceInsert,
  serviceSelect,
  serviceUpdate,
  signIn,
} from "./helpers";
import { fakePushService, type Receiver, stubPush } from "./push-shared";

/**
 * Onboarding for reachability (task 5.5; owner decisions 2026-10-03, PROGRESS "Slice 9"):
 *
 * - **A new joiner gets the steps** on the welcome screen (turn on, send a test, "Did it
 *   arrive?"; on an iPhone in Safari first the install steps, and the installed app's sign-in
 *   resumes at "Turn on"); **Later** ends it, the band keeps nudging.
 * - **Someone who joined before** (no walkthrough row) never sees it: with a working device,
 *   nothing new (no band, no walkthrough); without one, only the band.
 * - **The band** stays until a push has reached a device, and returns for a failing one.
 * - **Me's device list**: plain names, last notification, why one stopped, never an endpoint;
 *   Remove on another device behind a red button naming it.
 * - Installed, at 375 and 430: the Remove confirmation and the troubleshooting sheet close on
 *   back, and the walkthrough's steps add no history.
 * - **The owner's answers of 2026-10-06:** a removed device stays off when opened again, and
 *   "Turn on" tapped there (the band's, Me's) brings it back; any sign-in of a new joiner with an
 *   unfinished walkthrough lands on the welcome screen (a deep link still wins), until Later or
 *   a delivered test; a test from Me → Help that a device received finishes the walkthrough, one
 *   no device accepted does not.
 *
 * Every test makes its own people (`onboard-<what>-<project>`), so the projects and workers never
 * share one person's devices; the pushes go to a fake push service this file runs (push.spec.ts).
 */
const PASSWORD = "onboard-local-password";

const IPHONE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const FIREFOX_ANDROID_UA = "Mozilla/5.0 (Android 14; Mobile; rv:131.0) Gecko/131.0 Firefox/131.0";
const CHROME_ANDROID_UA =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36";
const EDGE_WINDOWS_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0";

function emailFor(info: TestInfo, what: string): string {
  return `onboard-${what}-${info.project.name}-r${info.repeatEachIndex}@maxoff.local`;
}

/** A new joiner who signed in through their invite link: on the welcome screen. */
async function joinThroughLink(page: Page, email: string, name: string): Promise<string> {
  const { id, link } = await inviteFixturePerson(email, name);
  await followAuthLink(page, link);
  await expect(page).toHaveURL(/\/set-password$/);
  await page.getByLabel("New password").fill(PASSWORD);
  await page.getByLabel("Repeat it").fill(PASSWORD);
  await page.getByRole("button", { name: "Save password and sign in" }).click();
  await expect(page).toHaveURL(/\/me\?welcome=1$/);
  await answerStartPrompt(page);
  return id;
}

/** Someone who joined before 5.5: accepted, and no walkthrough row (as everyone on 2026-10-01). */
async function existingMember(email: string, name: string): Promise<string> {
  const { id } = await inviteFixturePerson(email, name);
  await acceptFixtureInvite(id, email, PASSWORD);
  await serviceDelete(`member_onboarding?member_id=eq.${id}`);
  return id;
}

/** A device of theirs at the fake push service, written as the service role. */
async function device(
  memberId: string,
  endpoint: string,
  receiver: Receiver,
  more: Record<string, unknown> = {},
): Promise<string> {
  const row = await serviceInsert<{ id: string }>("push_subscriptions", {
    member_id: memberId,
    endpoint,
    p256dh: receiver.publicKey,
    auth: receiver.auth,
    platform: "android",
    ...more,
  });
  return row.id;
}

async function onboardingOf(memberId: string) {
  return serviceSelect<{ finished_via: string | null }>(
    `member_onboarding?member_id=eq.${memberId}&select=finished_via`,
  );
}

/** A browser context of its own that presents itself as an iPhone (Chromium, the iPhone's agent). */
async function iphoneContext(browser: Browser, page: Page): Promise<BrowserContext> {
  return browser.newContext({
    storageState: { cookies: [], origins: [] },
    userAgent: IPHONE_UA,
    viewport: page.viewportSize() ?? { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
}

test.describe("onboarding for reachability", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  let service: Awaited<ReturnType<typeof fakePushService>>;
  let receiver: Receiver;

  test.beforeAll(async () => {
    service = await fakePushService();
    receiver = await generateReceiverKeys();
  });

  test.afterAll(async () => {
    await new Promise<void>((resolve) => service.server.close(() => resolve()));
  });

  test("a new joiner gets the steps: turn on, send a test, did it arrive", async ({
    page,
  }, info) => {
    const email = emailFor(info, "joiner");
    await stubPush(page, {
      permission: "default",
      endpoint: `${service.url}/ok/joiner-${info.project.name}`,
      receiver,
    });
    const id = await joinThroughLink(page, email, "Onboard Joiner");
    const card = page.locator('[data-slot="onboarding"]');
    await expect(card).toHaveAttribute("data-ready", "true");
    // Not an iPhone: no install step; turn on first.
    await expect(card.locator('[data-slot="onboarding-step"]')).toHaveCount(2);
    await expect(card.locator('[data-step="enable"][data-slot="onboarding-step"]')).toHaveAttribute(
      "data-state",
      "current",
    );
    await expect(card.getByRole("button", { name: "Later" })).toBeVisible();
    // The band nudges too: nothing is on yet.
    await expect(page.locator('[data-slot="push-banner"]')).toHaveAttribute("data-reason", "off");

    await card.locator('[data-slot="onboarding-enable-button"]').click();
    await expect(card).toHaveAttribute("data-step", "test");
    await card.locator('[data-slot="onboarding-test-button"]').click();
    await expect(card).toHaveAttribute("data-step", "done");
    await expect(card).toContainText("You're set: notifications reach you.");
    expect(await onboardingOf(id)).toEqual([{ finished_via: "test" }]);
    // The push reached the device: the band is gone.
    await expect(page.locator('[data-slot="push-banner"]')).toHaveCount(0);

    // Did it arrive? No → what to check here; nothing is stored.
    const arrived = card.locator('[data-slot="did-it-arrive"]');
    await arrived.locator('[data-slot="arrived-no"]').click();
    const sheet = page.locator('[data-slot="troubleshooting-sheet"]');
    await expect(sheet.locator('[data-slot="troubleshooting-steps"] li').first()).toBeVisible();
    await expect(sheet).toContainText(info.project.use.isMobile ? "Battery" : "Site settings");
    await page.keyboard.press("Escape");
    await expect(sheet).toHaveCount(0);
    await arrived.locator('[data-slot="arrived-yes"]').click();
    await expect(card.locator('[data-slot="did-it-arrive"]')).toHaveText(
      "Good: notifications reach you.",
    );

    // Finished: Later is gone for good, and the welcome screen shows it done.
    await page.reload();
    await expect(page.locator('[data-slot="onboarding"]')).toHaveAttribute("data-step", "done");
    await expect(page.getByRole("button", { name: "Later" })).toHaveCount(0);
    await removeFixturePerson(email);
  });

  test("Later ends the walkthrough for good; the band keeps nudging", async ({ page }, info) => {
    const email = emailFor(info, "later");
    const { id } = await inviteFixturePerson(email, "Onboard Later");
    await acceptFixtureInvite(id, email, PASSWORD);
    await signIn(page, email, PASSWORD);
    await page.goto("/me?welcome=1");
    const card = page.locator('[data-slot="onboarding"]');
    // The card is live once it has read this device.
    await expect(card).toHaveAttribute("data-ready", "true");
    await card.getByRole("button", { name: "Later" }).click();
    await expect(card).toHaveCount(0);
    expect(await onboardingOf(id)).toEqual([{ finished_via: "later" }]);
    await page.goto("/me?welcome=1");
    await expect(page.locator('[data-slot="welcome"]')).toBeVisible();
    await expect(page.locator('[data-slot="onboarding"]')).toHaveCount(0);
    await page.goto("/my-day");
    await expect(page.locator('[data-slot="push-banner"]')).toHaveAttribute("data-reason", "off");
    await removeFixturePerson(email);
  });

  test("an iPhone: install steps in Safari, then the installed app resumes at Turn on", async ({
    browser,
    page,
  }, info) => {
    test.skip(!info.project.use.isMobile, "the iPhone's flow, at the phone widths");
    const email = emailFor(info, "iphone");
    const safari = await iphoneContext(browser, page);
    let installed: BrowserContext | null = null;
    try {
      // In Safari: the invite link, then the install steps with their pictures.
      const tab = await safari.newPage();
      const id = await joinThroughLink(tab, email, "Onboard iPhone");
      const card = tab.locator('[data-slot="onboarding"]');
      await expect(card).toHaveAttribute("data-ready", "true");
      await expect(card.locator('[data-slot="onboarding-step"]')).toHaveCount(3);
      await expect(card).toHaveAttribute("data-step", "install");
      const steps = card.locator('[data-slot="install-steps"] li');
      await expect(steps).toHaveCount(4);
      await expect(steps.nth(0)).toContainText("Share");
      await expect(steps.nth(1)).toContainText("Add to Home Screen");
      await expect(card.getByRole("img", { name: /Share button/ })).toBeVisible();
      await expect(card.locator('[data-slot="onboarding-enable-button"]')).toHaveCount(0);
      // The band says the same: install.
      const band = tab.locator('[data-slot="push-banner"]');
      await expect(band).toHaveAttribute("data-reason", "install");
      await expect(
        band.getByText("Install MaxOff to get notifications").filter({ visible: true }),
      ).toBeVisible();
      await band.click();
    await diagCdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
      await expect(
        tab.locator('[data-slot="push-sheet"] [data-slot="install-steps"]'),
      ).toBeVisible();
      await tab.keyboard.press("Escape");

      // The installed app keeps its own sign-in: a new context, signed out, standalone.
      installed = await iphoneContext(browser, page);
      const app = await installed.newPage();
      await runInstalled(app);
      await stubPush(app, {
        permission: "default",
        endpoint: `${service.url}/ok/iphone-${info.project.name}`,
        receiver,
      });
      await app.goto("/login");
      await app.getByLabel("Email").fill(email);
      await app.getByLabel("Password", { exact: true }).fill(PASSWORD);
      await app.getByRole("button", { name: "Sign in" }).click();
      // Decision 4: the first open of the installed app with the walkthrough unfinished resumes it.
      await expect(app).toHaveURL(/\/me\?welcome=1$/);
      await answerStartPrompt(app);
      const resumed = app.locator('[data-slot="onboarding"]');
      await expect(resumed).toHaveAttribute("data-ready", "true");
      await expect(resumed).toHaveAttribute("data-step", "enable");
      await expect(
        resumed.locator('[data-step="install"][data-slot="onboarding-step"]'),
      ).toHaveAttribute("data-state", "done");
      await resumed.locator('[data-slot="onboarding-enable-button"]').click();
      await resumed.locator('[data-slot="onboarding-test-button"]').click();
      await expect(resumed).toHaveAttribute("data-step", "done");
      expect(await onboardingOf(id)).toEqual([{ finished_via: "test" }]);
      await expect(
        resumed.locator('[data-slot="did-it-arrive"] [data-slot="arrived-yes"]'),
      ).toBeVisible();
    } finally {
      await safari.close();
      await installed?.close();
      await removeFixturePerson(email);
    }
  });

  test("someone who joined before with a working device sees nothing new", async ({
    page,
  }, info) => {
    const email = emailFor(info, "existing-ok");
    const id = await existingMember(email, "Onboard Existing");
    await device(id, `${service.url}/ok/existing-${info.project.name}`, receiver, {
      last_success_at: systemClock().toISOString(),
    });
    await signIn(page, email, PASSWORD);
    await hydrated(page);
    await expect(page.locator('[data-slot="push-banner"]')).toHaveCount(0);
    await page.goto("/me?welcome=1");
    await expect(page.locator('[data-slot="welcome"]')).toBeVisible();
    await expect(page.locator('[data-slot="onboarding"]')).toHaveCount(0);
    await expect(page.locator('[data-slot="push-banner"]')).toHaveCount(0);
    expect(await onboardingOf(id)).toEqual([]);
    await removeFixturePerson(email);
  });

  test("someone who joined before with no working device sees only the band", async ({
    page,
  }, info) => {
    const email = emailFor(info, "existing-none");
    const id = await existingMember(email, "Onboard Unreached");
    await signIn(page, email, PASSWORD);
    await expect(page.locator('[data-slot="push-banner"]')).toHaveAttribute("data-reason", "off");
    await page.goto("/me?welcome=1");
    await expect(page.locator('[data-slot="welcome"]')).toBeVisible();
    await expect(page.locator('[data-slot="onboarding"]')).toHaveCount(0);
    // A device turned on but never delivered to: still the band, now asking for a test.
    await device(id, `${service.url}/ok/unreached-${info.project.name}`, receiver);
    await page.reload();
    await expect(page.locator('[data-slot="push-banner"]')).toHaveAttribute(
      "data-reason",
      "unconfirmed",
    );
    await expect(page.locator('[data-slot="onboarding"]')).toHaveCount(0);
    await removeFixturePerson(email);
  });

  test("the band returns for a failing device, and a test that gets through ends it", async ({
    page,
  }, info) => {
    const email = emailFor(info, "failing");
    const id = await existingMember(email, "Onboard Failing");
    const deviceId = await device(id, `${service.url}/ok/failing-${info.project.name}`, receiver, {
      last_success_at: systemClock().toISOString(),
    });
    await signIn(page, email, PASSWORD);
    await hydrated(page);
    const band = page.locator('[data-slot="push-banner"]');
    await expect(band).toHaveCount(0);
    // Two failed deliveries in a row: failing (5.4), still an active device.
    await serviceUpdate(`push_subscriptions?id=eq.${deviceId}`, { failure_count: 2 });
    const diagCdp = await page.context().newCDPSession(page);
    await diagCdp.send("Emulation.setCPUThrottlingRate", { rate: 12 });
    await page.reload();
    // The reloaded page answers a tap only once hydrated (main CI run 37792867778: the band's tap
    // before hydration opened nothing).
    await hydrated(page);
    await expect(band).toHaveAttribute("data-reason", "failing");
    await expect(
      band.getByText("Notifications aren't reaching you").filter({ visible: true }),
    ).toBeVisible();
    await band.click();
    const sheet = page.locator('[data-slot="push-sheet"]');
    await expect(
      sheet.getByRole("heading", { name: "Notifications aren't reaching you" }),
    ).toBeVisible();
    await sheet.locator('[data-slot="push-band-test"]').click();
    await expect(band).toHaveCount(0);
    expect(
      await serviceSelect<{ failure_count: number }>(
        `push_subscriptions?id=eq.${deviceId}&select=failure_count`,
      ),
    ).toEqual([{ failure_count: 0 }]);
    await removeFixturePerson(email);
  });

  test("Me lists every device in plain words; Remove another one behind a red button naming it", async ({
    page,
  }, info) => {
    const email = emailFor(info, "devices");
    const id = await existingMember(email, "Onboard Devices");
    const here = `${service.url}/ok/devices-here-${info.project.name}`;
    await device(id, `${service.url}/ok/devices-firefox-${info.project.name}`, receiver, {
      user_agent: FIREFOX_ANDROID_UA,
      last_success_at: new Date(systemClock().getTime() - 2 * 3600 * 1000).toISOString(),
    });
    await device(id, `${service.url}/gone/devices-edge-${info.project.name}`, receiver, {
      user_agent: EDGE_WINDOWS_UA,
      platform: "desktop",
      disabled_at: systemClock().toISOString(),
      disabled_reason: "gone",
    });
    await stubPush(page, { permission: "granted", endpoint: here, receiver });
    await signIn(page, email, PASSWORD);
    await page.goto("/me");
    const list = page.locator('[data-slot="device-list"]');
    // This browser is stored on load (PushSync), then listed as this device.
    await expect(list.locator('[data-slot="device-row"]')).toHaveCount(3);
    const firefox = list.locator('[data-slot="device-row"]', { hasText: "Firefox on Android" });
    await expect(firefox).toContainText("Android · browser");
    await expect(firefox).toContainText("Last notification 2 h ago");
    const edge = list.locator('[data-slot="device-row"]', { hasText: "Edge on Windows" });
    await expect(edge).toContainText("Notifications were turned off on this device");
    await expect(edge).toHaveAttribute("data-active", "false");
    const mine = list.locator('[data-slot="device-row"][data-here="true"]');
    await expect(mine).toContainText("This device");
    await expect(mine).toContainText("No notification yet");
    await expect(mine.locator('[data-slot="device-remove"]')).toHaveCount(0);
    // Never an endpoint or an id on screen.
    const words = await page.locator("main").innerText();
    expect(words).not.toContain("127.0.0.1");
    expect(words).not.toContain(id);

    await firefox.getByRole("button", { name: "Remove Firefox on Android" }).click();
    const dialog = page.getByRole("alertdialog", { name: "Remove Firefox on Android?" });
    await expect(dialog).toContainText("It stays signed in");
    const confirm = dialog.getByRole("button", { name: "Remove Firefox on Android" });
    // The one solid red commit of the layer (ARCHITECTURE §14.1).
    await expect(confirm).toHaveClass(/bg-primary/);
    await confirm.click();
    await expect(dialog).toHaveCount(0);
    await expect(list.locator('[data-slot="device-row"]')).toHaveCount(2);
    await expect(firefox).toHaveCount(0);
    // Remove sticks (owner 2026-10-06): the row is kept, marked, so it stays off when opened again.
    const left = await serviceSelect<{ endpoint: string; disabled_reason: string | null }>(
      `push_subscriptions?member_id=eq.${id}&select=endpoint,disabled_reason&order=endpoint`,
    );
    expect(left).toEqual([
      {
        endpoint: `${service.url}/gone/devices-edge-${info.project.name}`,
        disabled_reason: "gone",
      },
      {
        endpoint: `${service.url}/ok/devices-firefox-${info.project.name}`,
        disabled_reason: "removed",
      },
      { endpoint: here, disabled_reason: null },
    ]);

    // Help → Send a test → "Did it arrive?": nothing stored either way.
    await page.locator('[data-slot="push-test"]').click();
    await expect(page.locator('[data-slot="push-test-outcome"]')).toHaveText("Sent to 1 device");
    const arrived = page.locator('[data-slot="push-test-row"] [data-slot="did-it-arrive"]');
    await arrived.locator('[data-slot="arrived-no"]').click();
    await expect(page.locator('[data-slot="troubleshooting-sheet"]')).toBeVisible();
    await page.keyboard.press("Escape");
    await arrived.locator('[data-slot="arrived-yes"]').click();
    await expect(arrived).toHaveText("Good: notifications reach you.");
    await removeFixturePerson(email);
  });

  test("any sign-in of an unfinished new joiner lands on the welcome screen; after Later, home", async ({
    page,
  }, info) => {
    const email = emailFor(info, "landing");
    const existing = emailFor(info, "landing-existing");
    const { id } = await inviteFixturePerson(email, "Onboard Landing");
    await acceptFixtureInvite(id, email, PASSWORD);
    try {
      // On a computer (or a phone's browser): not only the installed iPhone app.
      await signIn(page, email, PASSWORD);
      await expect(page).toHaveURL(/\/me\?welcome=1$/);
      await expect(page.locator('[data-slot="onboarding"]')).toHaveAttribute("data-ready", "true");

      // A sign-in that asked to go somewhere specific (a deep link) still goes there.
      await page.context().clearCookies();
      await page.goto("/notifications");
      await expect(page).toHaveURL(/\/login\?next=%2Fnotifications$/);
      await page.getByLabel("Email").fill(email);
      await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
      await page.getByRole("button", { name: "Sign in" }).click();
      await expect(page).toHaveURL(/\/notifications$/);

      // Later: from now on a sign-in lands as normal.
      await page.goto("/me?welcome=1");
      const card = page.locator('[data-slot="onboarding"]');
      await expect(card).toHaveAttribute("data-ready", "true");
      await card.getByRole("button", { name: "Later" }).click();
      await expect(card).toHaveCount(0);
      await page.context().clearCookies();
      await signIn(page, email, PASSWORD);
      await expect(page).toHaveURL(/\/my-day$/);

      // Someone who joined before (no walkthrough) is never sent there.
      await existingMember(existing, "Onboard Landing Existing");
      await page.context().clearCookies();
      await signIn(page, existing, PASSWORD);
      await expect(page).toHaveURL(/\/my-day$/);
    } finally {
      await removeFixturePerson(email);
      await removeFixturePerson(existing);
    }
  });

  test("a test from Me → Help that a device received finishes the walkthrough; one nobody accepted does not", async ({
    page,
  }, info) => {
    const email = emailFor(info, "help-test");
    const { id } = await inviteFixturePerson(email, "Onboard Help Test");
    await acceptFixtureInvite(id, email, PASSWORD);
    try {
      // Their only device answers 500: the push service refuses the test.
      await device(id, `${service.url}/down/help-test-${info.project.name}`, receiver);
      await signIn(page, email, PASSWORD);
      await page.goto("/me");
      const outcome = page.locator('[data-slot="push-test-outcome"]');
      await page.locator('[data-slot="push-test"]').click();
      await expect(outcome).toHaveText(
        "No device accepted it. Check the device's notification settings, then try again.",
      );
      expect(await onboardingOf(id)).toEqual([{ finished_via: null }]);

      // A device that works, and the half-minute between tests spent.
      await device(id, `${service.url}/ok/help-test-${info.project.name}`, receiver);
      await serviceUpdate(`push_subscriptions?member_id=eq.${id}`, { last_test_at: null });
      await page.reload();
      await hydrated(page);
      await page.locator('[data-slot="push-test"]').click();
      await expect(outcome).toHaveText("Sent to 1 device");
      await expect.poll(() => onboardingOf(id)).toEqual([{ finished_via: "test" }]);

      // Finished: the next sign-in lands as normal.
      await page.context().clearCookies();
      await signIn(page, email, PASSWORD);
      await expect(page).toHaveURL(/\/my-day$/);
    } finally {
      await removeFixturePerson(email);
    }
  });

  test("Remove sticks: a removed device stays off when opened again; Turn on there brings it back", async ({
    browser,
    page,
  }, info) => {
    const email = emailFor(info, "sticks");
    const id = await existingMember(email, "Onboard Sticks");
    const endpoint = `${service.url}/ok/sticks-phone-${info.project.name}`;
    const rowsOf = () =>
      serviceSelect<{ id: string; disabled_reason: string | null }>(
        `push_subscriptions?member_id=eq.${id}&select=id,disabled_reason`,
      );
    // The phone: notifications allowed, so every open re-subscribes it automatically (PushSync).
    const phone = await browser.newContext({
      storageState: { cookies: [], origins: [] },
      userAgent: CHROME_ANDROID_UA,
      viewport: page.viewportSize() ?? { width: 390, height: 844 },
    });
    try {
      const tab = await phone.newPage();
      await stubPush(tab, { permission: "granted", endpoint, receiver });
      await signIn(tab, email, PASSWORD);
      await expect.poll(rowsOf).toEqual([{ id: expect.any(String), disabled_reason: null }]);
      const phoneId = (await rowsOf())[0]!.id;
      // The automatic subscribe of this phone, seen by its payload (the endpoint).
      const automaticAttempt = () =>
        tab.waitForResponse(
          (response) =>
            response.request().method() === "POST" &&
            (response.request().postData() ?? "").includes(`sticks-phone-${info.project.name}`),
        );

      // The laptop (no notifications of its own) removes the phone.
      await signIn(page, email, PASSWORD);
      await page.goto("/me");
      const list = page.locator('[data-slot="device-list"]');
      await list.getByRole("button", { name: "Remove Chrome on Android" }).click();
      await page
        .getByRole("alertdialog", { name: "Remove Chrome on Android?" })
        .getByRole("button", { name: "Remove Chrome on Android" })
        .click();
      await expect(page.locator('[data-slot="device-list-empty"]')).toBeVisible();
      expect(await rowsOf()).toEqual([{ id: phoneId, disabled_reason: "removed" }]);

      // Opened again: the automatic re-subscribe is refused; it stays off.
      const refused = automaticAttempt();
      await tab.reload();
      await refused;
      expect(await rowsOf()).toEqual([{ id: phoneId, disabled_reason: "removed" }]);
      const band = tab.locator('[data-slot="push-banner"]');
      await expect(band).toHaveAttribute("data-reason", "off");
      const refusedOnMe = automaticAttempt();
      await tab.goto("/me");
      await refusedOnMe;
      await expect(tab.locator('[data-slot="push-device-row"]')).toHaveAttribute(
        "data-state",
        "none",
      );
      await expect(tab.locator('[data-slot="device-list-empty"]')).toBeVisible();
      expect(await rowsOf()).toEqual([{ id: phoneId, disabled_reason: "removed" }]);

      // The way back: "Turn on" tapped on the phone, in the band's sheet. The same row.
      await band.click();
      await tab.locator('[data-slot="push-sheet"] [data-slot="push-enable"]').click();
      await expect(band).toHaveAttribute("data-reason", "unconfirmed");
      expect(await rowsOf()).toEqual([{ id: phoneId, disabled_reason: null }]);

      // Removed again; Me's own "Turn on" brings it back too.
      await page.reload();
      await hydrated(page);
      await list.getByRole("button", { name: "Remove Chrome on Android" }).click();
      await page
        .getByRole("alertdialog", { name: "Remove Chrome on Android?" })
        .getByRole("button", { name: "Remove Chrome on Android" })
        .click();
      await expect(page.locator('[data-slot="device-list-empty"]')).toBeVisible();
      const refusedAgain = automaticAttempt();
      await tab.reload();
      await refusedAgain;
      const row = tab.locator('[data-slot="push-device-row"]');
      await expect(row).toHaveAttribute("data-state", "none");
      await row.locator('[data-slot="push-enable"]').click();
      await expect(row).toHaveAttribute("data-state", "here");
      expect(await rowsOf()).toEqual([{ id: phoneId, disabled_reason: null }]);
    } finally {
      await phone.close();
      await removeFixturePerson(email);
    }
  });
});

test.describe("installed: the new layers close on back, the steps add no history", () => {
  test.use({ storageState: { cookies: [], origins: [] } });
  test.skip(({ isMobile }) => !isMobile, "installed-mode back is a phone rule (375 and 430)");

  let service: Awaited<ReturnType<typeof fakePushService>>;
  let receiver: Receiver;

  test.beforeAll(async () => {
    service = await fakePushService();
    receiver = await generateReceiverKeys();
  });

  test.afterAll(async () => {
    await new Promise<void>((resolve) => service.server.close(() => resolve()));
  });

  test("the Remove confirmation and the troubleshooting sheet: back closes each, then Me leaves", async ({
    page,
  }, info) => {
    const email = emailFor(info, "back");
    const id = await existingMember(email, "Onboard Back");
    await device(id, `${service.url}/ok/back-other-${info.project.name}`, receiver, {
      user_agent: FIREFOX_ANDROID_UA,
    });
    await runInstalled(page);
    await stubPush(page, {
      permission: "granted",
      endpoint: `${service.url}/ok/back-here-${info.project.name}`,
      receiver,
    });
    await signIn(page, email, PASSWORD);
    await expect(page).toHaveURL(/\/my-day$/);
    await hydrated(page);
    await page.locator("[data-slot='bottom-nav']").getByRole("link", { name: "Me" }).click();
    await expect(page).toHaveURL(/\/me$/);

    // The Remove confirmation is a layer.
    await page.getByRole("button", { name: "Remove Firefox on Android" }).click();
    const dialog = page.getByRole("alertdialog", { name: "Remove Firefox on Android?" });
    await expect(dialog).toBeVisible();
    await page.goBack();
    await expect(dialog).toHaveCount(0);
    await expect(page).toHaveURL(/\/me$/);

    // The troubleshooting sheet too; the test and the answer add nothing.
    await page.locator('[data-slot="push-test"]').click();
    await page.locator('[data-slot="arrived-no"]').click();
    const sheet = page.locator('[data-slot="troubleshooting-sheet"]');
    await expect(sheet).toBeVisible();
    await page.goBack();
    await expect(sheet).toHaveCount(0);
    await expect(page).toHaveURL(/\/me$/);

    // Me is a tab above home: back returns to My Day.
    await page.goBack();
    await expect(page).toHaveURL(/\/my-day$/);
    await removeFixturePerson(email);
  });

  test("a new joiner's steps are view state: turning on and testing add no history", async ({
    page,
  }, info) => {
    const email = emailFor(info, "back-steps");
    await runInstalled(page);
    await stubPush(page, {
      permission: "default",
      endpoint: `${service.url}/ok/back-steps-${info.project.name}`,
      receiver,
    });
    await joinThroughLink(page, email, "Onboard Steps");
    await hydrated(page);
    const card = page.locator('[data-slot="onboarding"]');
    await expect(card).toHaveAttribute("data-ready", "true");
    const before = await page.evaluate(() => history.length);
    await card.locator('[data-slot="onboarding-enable-button"]').click();
    await card.locator('[data-slot="onboarding-test-button"]').click();
    await expect(card).toHaveAttribute("data-step", "done");
    await expect(page).toHaveURL(/\/me\?welcome=1$/);
    expect(await page.evaluate(() => history.length)).toBe(before);
    await removeFixturePerson(email);
  });
});
