import { type BrowserContext, type Locator, type Page, type TestInfo } from "@playwright/test";

import { expect, test } from "./fixtures";

// The app's own IST clock (ADR-0008), so "today" here is the database's `app.today_ist()`.
import { todayIST } from "../src/core/time";

import {
  animationsSettled,
  hydrated,
  resetAttendanceAndLeaveOf,
  rpcAs,
  signIn,
  startPrompt,
  USERS,
} from "./helpers";

/**
 * The working day (task 3b.1, PRODUCT §4.2, WORKFLOWS §1 "Settled in 3b.1"): the app opens
 * freely, the Start-day prompt asks until the day is started or leave chosen (and snoozes for 30
 * minutes on "Just looking"), Start day is the tap, End day is final, approved leave has no
 * prompt, a half day keeps Start and End available, and the Owner has none of it.
 *
 * Runs in `desktop`, `mobile` (375px) and `mobile-lg` (430px). A person has one attendance day
 * per date, so each project signs in as its own seeded people (`gate-<kind>-<project>@…`,
 * supabase/seed.sql, named for the 2.2 day gate this flow replaced); each test resets its
 * person first, so the suite re-runs without `pnpm db:reset`.
 */

const PASSWORD = "gate-local-password";
type Kind = "staff" | "admin" | "leave" | "half";

function person(kind: Kind, info: TestInfo): string {
  return `gate-${kind}-${info.project.name}@maxoff.local`;
}

const isPhone = (info: TestInfo) => info.project.name.startsWith("mobile");

/** Today's attendance, one line at the top of the home screen (2.3 polish, reworked in 3b.1). */
function strip(page: Page): Locator {
  return page.locator('[data-slot="attendance-strip"]');
}

function stripStatus(page: Page): Locator {
  return strip(page).locator('[data-slot="attendance-status"]');
}

/** Today's entry in the attendance history: a card on a phone, the first row on desktop. */
function todayEntry(page: Page, info: TestInfo): Locator {
  return isPhone(info)
    ? page.locator('[data-slot="data-card"]').first()
    : page.locator("tbody tr").first();
}

/** The hint as the server reads it (Next URL-encodes a cookie value it sets). */
async function homeHint(context: BrowserContext): Promise<string | undefined> {
  const value = (await context.cookies()).find((cookie) => cookie.name === "maxoff_home")?.value;
  return value === undefined ? undefined : decodeURIComponent(value);
}

/** The mobile standard on the prompt (ARCHITECTURE §14.1): 44px targets, all on screen, no sideways scroll. */
async function expectPromptFitsThePhone(page: Page): Promise<void> {
  // The prompt's sheet slides in: measure where it comes to rest.
  await animationsSettled(page);
  const viewport = page.viewportSize();
  expect(viewport).not.toBeNull();
  for (const name of ["Start day", "On leave today? Choose leave", "Just looking"]) {
    const box = await startPrompt(page).getByRole("button", { name }).boundingBox();
    expect(box, name).not.toBeNull();
    expect(box!.height, name).toBeGreaterThanOrEqual(44);
    expect(box!.y + box!.height, name).toBeLessThanOrEqual(viewport!.height);
  }
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

test.use({ storageState: { cookies: [], origins: [] } });

test("Staff: the prompt asks and snoozes, Start day is the tap, End day is final", async ({
  page,
  context,
}, info) => {
  await resetAttendanceAndLeaveOf(person("staff", info));
  await signIn(page, person("staff", info), PASSWORD, { day: "stop" });
  // The app opens freely (no gate, ADR-0012 amendment): My Day is on screen under the prompt.
  await expect(page).toHaveURL(/\/my-day$/);
  const prompt = startPrompt(page);
  await expect(prompt).toBeVisible();
  await expect(prompt).toContainText("Started working?");
  if (isPhone(info)) await expectPromptFitsThePhone(page);

  // Just looking: the prompt closes and stays away (30 minutes), the strip still offers the start.
  await prompt.getByRole("button", { name: "Just looking" }).click();
  await expect(prompt).toBeHidden();
  await page.goto("/tasks");
  await expect(page).toHaveURL(/\/tasks$/);
  await hydrated(page);
  await expect(prompt).toBeHidden();
  await page.goto("/my-day");
  await hydrated(page);
  await expect(prompt).toBeHidden();
  await expect(stripStatus(page)).toHaveText("Not started");
  if (isPhone(info)) {
    // One line at the phone width (PRODUCT §4.10: My Day is mainly tasks).
    await expect
      .poll(async () => (await strip(page).boundingBox())?.height ?? Infinity)
      .toBeLessThanOrEqual(46);
  }

  // Start day from the strip: the tap is the start, and the home hint's daily refresh rides on it.
  await context.clearCookies({ name: "maxoff_home" });
  await strip(page).getByRole("button", { name: "Start day" }).click();
  await expect(stripStatus(page)).toHaveText(
    /^Started \d{1,2}:\d{2} [ap]m · waiting for approval$/,
  );
  await expect(strip(page).getByRole("button", { name: "End day" })).toBeVisible();
  await expect.poll(() => homeHint(context)).toMatch(/\|\/my-day$/);

  // Started: the prompt has nothing to ask, on this open or the next.
  await page.reload();
  await hydrated(page);
  await expect(prompt).toBeHidden();

  // End day asks first (final, no resume), then the strip carries the end time. The confirmation
  // takes the optional overtime note (3b.2): too short is refused and nothing is ended.
  await strip(page).getByRole("button", { name: "End day" }).click();
  const confirm = page.getByRole("alertdialog", { name: "End your day?" });
  await expect(confirm).toContainText("no resume");
  await confirm.getByRole("button", { name: "Cancel" }).click();
  await expect(confirm).toBeHidden();
  await strip(page).getByRole("button", { name: "End day" }).click();
  await confirm.getByRole("button", { name: "Worked late? Add an overtime note" }).click();
  await confirm.getByLabel("Overtime note").fill("ab");
  await confirm.getByRole("button", { name: "End day" }).click();
  await expect(confirm.locator('[data-slot="error-text"], [role="alert"]').first()).toContainText(
    "Say what you worked on",
  );
  // Nothing ended (the confirmation is modal, so the strip is read by its text, not its role).
  await expect(stripStatus(page)).toHaveText(
    /^Started \d{1,2}:\d{2} [ap]m · waiting for approval$/,
  );
  await confirm.getByLabel("Overtime note").fill("The shoot ran late");
  await confirm.getByRole("button", { name: "End day" }).click();
  await expect(stripStatus(page)).toHaveText(
    /^Present · ended \d{1,2}:\d{2} [ap]m · waiting for approval$/,
  );
  await expect(strip(page).getByRole("button")).toHaveCount(0);

  // The day's history says how it went, in the member's words.
  await strip(page).getByRole("link").click();
  await expect(page).toHaveURL(/\/leave\/attendance$/);
  const today = todayEntry(page, info);
  await expect(today).toContainText("Waiting for the Owner");
  if (isPhone(info)) await today.click();
  else await today.getByRole("button").first().click();
  const timeline = page.locator('[data-slot="day-timeline"]').last();
  await expect(timeline).toContainText("You started your day");
  await expect(timeline).toContainText("You ended your day");
  // The day opens in a sheet (modal): close it before reaching for the tabs.
  await page.keyboard.press("Escape");
  await expect(timeline).toBeHidden();

  // The overtime note written with the end waits for the Owner on Extra work (3b.2), a page of
  // its own since 5B decision 3.
  await page.goto("/leave/extra-work");
  const noteRow = page.locator('[data-slot="extra-work-note"]').first();
  await expect(noteRow).toContainText("The shoot ran late");
  await expect(noteRow).toContainText("Waiting for the Owner");
});

test("Admin: leave chosen from the prompt, then the strip and Start day on a half day", async ({
  page,
}, info) => {
  await resetAttendanceAndLeaveOf(person("admin", info));
  await signIn(page, person("admin", info), PASSWORD, { day: "stop" });
  await expect(page).toHaveURL(/\/today$/);
  const prompt = startPrompt(page);
  await expect(prompt).toBeVisible();

  await prompt.getByRole("button", { name: "On leave today? Choose leave" }).click();
  await expect(prompt).toContainText("On leave today?");
  // Comp leave is not offered here (kickoff 3b decision 16): Leave and Half day only.
  await expect(prompt.getByRole("radio")).toHaveCount(2);
  await expect(prompt.getByRole("radio", { name: /Comp leave/ })).toHaveCount(0);
  // No choice: a field message, nothing sent.
  await prompt.getByRole("button", { name: "Record leave" }).click();
  await expect(prompt.locator('[data-slot="field-error"]')).toHaveText("Choose Leave or Half day.");
  // Back to the question is a view of the same layer, not a second sheet.
  await prompt.getByRole("button", { name: "Back" }).click();
  await expect(prompt).toContainText("Started working?");
  await prompt.getByRole("button", { name: "On leave today? Choose leave" }).click();
  await prompt.getByRole("radio", { name: /^Half day\b/ }).check();
  await prompt.getByLabel("Reason (optional)").fill("Dentist in the afternoon");
  await prompt.getByRole("button", { name: "Record leave" }).click();
  await expect(prompt).toBeHidden();

  // The strip: the half day waits for the Owner, and the half a day worked can still be started.
  await expect(stripStatus(page)).toHaveText("Half day · waiting for approval");
  await strip(page).getByRole("button", { name: "Start day" }).click();
  await expect(stripStatus(page)).toHaveText(
    /^Started \d{1,2}:\d{2} [ap]m · waiting for approval$/,
  );
  await page.reload();
  await hydrated(page);
  await expect(prompt).toBeHidden();

  // The Owner's Today reads the started day (the people board, 2.4 + 3b.1; one tap under Today
  // since 6.2).
  await page.context().clearCookies();
  await signIn(page, USERS.owner.email, USERS.owner.password);
  await page.goto("/today/people");
  const row = page
    .locator('[data-slot="board-row"]')
    .filter({ hasText: `Test Gate Admin (${info.project.name})` });
  await expect(row).toContainText(/Started \d{1,2}:\d{2} [ap]m/);
});

test("approved leave: no prompt, and the strip offers I'm working today", async ({
  page,
}, info) => {
  const email = person("leave", info);
  await resetAttendanceAndLeaveOf(email);
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

  await signIn(page, email, PASSWORD, { day: "stop" });
  await expect(page).toHaveURL(/\/my-day$/);
  await hydrated(page);
  await expect(startPrompt(page)).toBeHidden();
  await expect(stripStatus(page)).toHaveText("On leave today");

  // A Start day on a leave day: Present for the Owner to review, the leave untouched.
  await strip(page).getByRole("button", { name: "I'm working today" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "I'm working today" }).click();
  await expect(stripStatus(page)).toHaveText(
    /^Started \d{1,2}:\d{2} [ap]m · waiting for approval$/,
  );
});

test("approved half day: no prompt, Start day and End day stay available", async ({
  page,
}, info) => {
  const email = person("half", info);
  await resetAttendanceAndLeaveOf(email);
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

  await signIn(page, email, PASSWORD, { day: "stop" });
  await expect(page).toHaveURL(/\/my-day$/);
  await hydrated(page);
  await expect(startPrompt(page)).toBeHidden();
  await expect(stripStatus(page)).toHaveText("Half day today");
  await strip(page).getByRole("button", { name: "Start day" }).click();
  await expect(stripStatus(page)).toHaveText(/^Half day today · started \d{1,2}:\d{2} [ap]m$/);
  await strip(page).getByRole("button", { name: "End day" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "End day" }).click();
  await expect(stripStatus(page)).toHaveText(/^Half day today · ended \d{1,2}:\d{2} [ap]m$/);
  // Final: nothing left to tap.
  await expect(strip(page).getByRole("button")).toHaveCount(0);
});

test("the Owner is never prompted and has no attendance strip", async ({ page }) => {
  await signIn(page, USERS.owner.email, USERS.owner.password, { day: "stop" });
  await expect(page).toHaveURL(/\/today$/);
  await expect(page.getByRole("heading", { name: "Today", exact: true })).toBeVisible();
  await hydrated(page);
  await expect(startPrompt(page)).toHaveCount(0);
  await expect(strip(page)).toHaveCount(0);
});
