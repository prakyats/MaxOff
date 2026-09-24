import { expect, type Locator, type Page, type TestInfo, test } from "@playwright/test";

// The app's own IST clock (ADR-0008), so "today" here is the database's `app.today_ist()`.
import { todayIST } from "../src/core/time";

import { chooseAttendance, rpcAs, signIn, USERS } from "./helpers";

/**
 * The day gate (task 2.2, WORKFLOWS §1, ARCHITECTURE §8): sign-in → gate → choice → home, for
 * Staff and Admins alike, the Owner never gated, approved leave with no gate at all, and the
 * attendance card with its first-class Log out.
 *
 * Runs in `desktop`, `mobile` (375px) and `mobile-lg` (430px). A person has one attendance day
 * per date, so each project signs in as its own seeded people (`gate-<kind>-<project>@…`,
 * supabase/seed.sql) and the suite needs `pnpm db:reset` before a re-run on the same day, like
 * the rest of it.
 */

const PASSWORD = "gate-local-password";
type GateKind = "staff" | "admin" | "leave" | "half";

function gateUser(kind: GateKind, info: TestInfo): string {
  return `gate-${kind}-${info.project.name}@maxoff.local`;
}

const isPhone = (info: TestInfo) => info.project.name.startsWith("mobile");

/** Today's attendance, one line at the top of the home screen (2.3 polish). */
function strip(page: Page): Locator {
  return page.locator('[data-slot="attendance-strip"]');
}

function stripStatus(page: Page): Locator {
  return strip(page).locator('[data-slot="attendance-status"]');
}

/** The quiet Log out row at the bottom of the home screen, then the confirmation. */
async function logOutFromHome(page: Page, overtimeNote?: string): Promise<void> {
  await page.locator('[data-slot="logout-row"]').getByRole("button", { name: "Log out" }).click();
  const confirm = page.getByRole("alertdialog");
  if (overtimeNote) {
    await confirm.getByRole("button", { name: "Worked late today? Add an overtime note" }).click();
    await confirm.getByLabel("Overtime note").fill(overtimeNote);
  }
  await confirm.getByRole("button", { name: "Log out" }).click();
  await expect(page).toHaveURL(/\/login\?reason=signed_out/);
}

/** Today's entry in the attendance history: a card on a phone, the first row on desktop. */
function todayEntry(page: Page, info: TestInfo): Locator {
  return isPhone(info)
    ? page.locator('[data-slot="data-card"]').first()
    : page.locator("tbody tr").first();
}

/** The mobile standard on the gate (ARCHITECTURE §14.1): 44px targets, Submit on screen, no sideways scroll. */
async function expectGateFitsThePhone(page: Page): Promise<void> {
  const viewport = page.viewportSize();
  expect(viewport).not.toBeNull();
  const submit = await page.getByRole("button", { name: "Submit" }).boundingBox();
  expect(submit).not.toBeNull();
  expect(submit!.height).toBeGreaterThanOrEqual(44);
  expect(submit!.y + submit!.height).toBeLessThanOrEqual(viewport!.height);
  for (const option of await page.locator('[data-slot="choice-option"]').all()) {
    expect((await option.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  }
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

test.use({ storageState: { cookies: [], origins: [] } });

test("Staff: gated at sign-in, a changed day is refused, Present lands where they were going", async ({
  page,
}, info) => {
  await signIn(page, gateUser("staff", info), PASSWORD, { gate: "stop" });
  await expect(page).toHaveURL(/\/attendance\?next=/);
  // "Good to see you, Test", or "Today is a day off" when the suite runs on one.
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  if (isPhone(info)) await expectGateFitsThePhone(page);

  // Nothing else opens while the day has no answer, and the gate remembers where you were going.
  await page.goto("/tasks");
  await expect(page).toHaveURL(/\/attendance\?next=%2Ftasks/);

  // No choice: a field message, nothing sent.
  await page.getByRole("button", { name: "Submit" }).click();
  await expect(page.locator('[data-slot="field-error"]')).toHaveText("Choose one.");

  // The screen was shown for another date (left open over midnight): refused, with the message.
  await page
    .locator('input[name="forDate"]')
    .evaluate((input: HTMLInputElement) => (input.value = "2000-01-01"));
  await page.getByRole("radio", { name: /^Present\b/ }).check();
  await page.getByRole("button", { name: "Submit" }).click();
  await expect(page.locator('[data-slot="form-alert"]')).toHaveText(
    "The day changed. Choose again for today.",
  );
  await expect(page).toHaveURL(/\/attendance/);

  // The gate for today, answered.
  await page.reload();
  await chooseAttendance(page, "Present", "In the studio all day");
  await expect(page).toHaveURL(/\/tasks$/);

  // Settled for the day: no gate on the way round, and My Day says where the day stands.
  await page.goto("/me");
  await expect(page).toHaveURL(/\/me$/);
  await page.goto("/my-day");
  await expect(stripStatus(page)).toHaveText("Present · waiting for approval");
  if (isPhone(info)) {
    // One line at the phone width (PRODUCT §4.10: My Day is mainly tasks).
    // Polled: the strip can re-render once as the page settles, and a detached node has no box.
    await expect
      .poll(async () => (await strip(page).boundingBox())?.height ?? Infinity)
      .toBeLessThanOrEqual(46);
  }

  // Overtime as they leave: a note too short is refused and nothing is signed out...
  await page.locator('[data-slot="logout-row"]').getByRole("button", { name: "Log out" }).click();
  const confirm = page.getByRole("alertdialog");
  await confirm.getByRole("button", { name: "Worked late today? Add an overtime note" }).click();
  await confirm.getByLabel("Overtime note").fill("ab");
  await confirm.getByRole("button", { name: "Log out" }).click();
  await expect(confirm.locator('[data-slot="field-error"]')).toHaveText(
    "Please write a few more words.",
  );
  await expect(page).toHaveURL(/\/my-day$/);
  await confirm.getByRole("button", { name: "Cancel" }).click();

  // ...a real note is flagged, then the logout happens.
  await logOutFromHome(page, "The shoot ran late");

  // It is on today's entry in the history.
  await signIn(page, gateUser("staff", info), PASSWORD);
  await page.goto("/leave/attendance");
  const today = todayEntry(page, info);
  await expect(today).toContainText("Overtime");
  if (isPhone(info)) await today.click();
  else await today.getByRole("button").first().click();
  await expect(page.locator('[data-slot="day-timeline"]').last()).toContainText(
    "Your note: The shoot ran late",
  );
});

test("Admin: gated too, a half day with a reason, Today shows the strip, back never returns to the gate", async ({
  page,
}, info) => {
  await signIn(page, gateUser("admin", info), PASSWORD, { gate: "stop" });
  await expect(page).toHaveURL(/\/attendance\?next=/);
  if (isPhone(info)) await expectGateFitsThePhone(page);

  await chooseAttendance(page, "Half day", "Dentist in the afternoon");
  await expect(page).toHaveURL(/\/today$/);
  await expect(stripStatus(page)).toHaveText("Half day · waiting for approval");

  // The choice replaced the gate in the history: back leaves Today without meeting the gate.
  await page.goBack();
  await page.waitForLoadState();
  await expect(page).not.toHaveURL(/\/attendance/);
  await page.goto("/today");

  // Overtime from today's entry in the history, the other way in.
  await strip(page).getByRole("link").click();
  await expect(page).toHaveURL(/\/leave\/attendance$/);
  const today = todayEntry(page, info);
  if (isPhone(info)) {
    await today.click();
    await page
      .locator('[data-slot="detail-sheet"]')
      .getByRole("button", { name: "Flag overtime" })
      .click();
  } else {
    await today.getByRole("button", { name: "Flag overtime" }).click();
  }
  await page.getByLabel("What kept you").fill("Client call ran over");
  await page.getByRole("dialog").getByRole("button", { name: "Flag overtime" }).click();
  await expect(today).toContainText("Overtime");

  await page.goto("/today");
  await logOutFromHome(page);
});

test("approved leave: no gate, and the strip offers I'm working today", async ({ page }, info) => {
  const email = gateUser("leave", info);
  const today = todayIST();
  const requestId = await rpcAs<string>(email, PASSWORD, "leave_submit", {
    type: "leave",
    start_date: today,
    end_date: today,
    reason: "Family function",
  });
  await rpcAs(USERS.owner.email, USERS.owner.password, "leave_decide", {
    request_id: requestId,
    decision: "approve",
  });

  await signIn(page, email, PASSWORD, { gate: "stop" });
  await expect(page).toHaveURL(/\/my-day$/);
  await expect(stripStatus(page)).toHaveText("On leave today");

  await strip(page).getByRole("button", { name: "I'm working today" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "I'm working today" }).click();
  await expect(stripStatus(page)).toHaveText("Present · waiting for approval");
});

test("approved half day: no gate, and the strip offers the full day", async ({ page }, info) => {
  const email = gateUser("half", info);
  const today = todayIST();
  const requestId = await rpcAs<string>(email, PASSWORD, "leave_submit", {
    type: "half_day",
    start_date: today,
    end_date: today,
  });
  await rpcAs(USERS.owner.email, USERS.owner.password, "leave_decide", {
    request_id: requestId,
    decision: "approve",
  });

  await signIn(page, email, PASSWORD, { gate: "stop" });
  await expect(page).toHaveURL(/\/my-day$/);
  await expect(stripStatus(page)).toHaveText("Half day today");
  await expect(strip(page).getByRole("button", { name: "I'm working the full day" })).toBeVisible();
  await expect(
    page.locator('[data-slot="logout-row"]').getByRole("button", { name: "Log out" }),
  ).toBeVisible();
});

test("the Owner is never gated and has no attendance strip", async ({ page }) => {
  await signIn(page, USERS.owner.email, USERS.owner.password, { gate: "stop" });
  await expect(page).toHaveURL(/\/today$/);
  await expect(page.getByRole("heading", { name: "Today" })).toBeVisible();
  await expect(strip(page)).toHaveCount(0);
  await expect(page.locator('[data-slot="logout-row"]')).toHaveCount(0);
  await page.goto("/attendance");
  await expect(page).toHaveURL(/\/today$/);
});
