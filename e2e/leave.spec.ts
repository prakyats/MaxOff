import { expect, type Locator, type Page, type TestInfo, test } from "@playwright/test";

// The app's own IST clock (ADR-0008), so "today" here is the database's `app.today_ist()`.
import { addISTDays, todayIST } from "../src/core/time";
import { monthLabel, monthOf } from "../src/modules/attendance/domain/months";

import {
  resetAttendanceAndLeave,
  rpcAs,
  serviceSelect,
  signIn,
  storageStateFor,
  USERS,
} from "./helpers";

/**
 * Leave for employees (task 2.3, WORKFLOWS §2): request a range and a half day, the form's and
 * the database's refusals, withdraw, change and cancel approved leave, the Owner's reason on a
 * refusal, and the attendance history in the member's own words.
 *
 * Runs in `desktop`, `mobile` (375px) and `mobile-lg` (430px, as an Admin). Each project owns
 * one seeded person (`leave-self-<project>@…`) and clears that person's leave and attendance
 * first, so the spec re-runs without `pnpm db:reset`.
 */

const PASSWORD = "leave-local-password";
const MEMBER_IDS: Record<string, string> = {
  desktop: "20000000-0000-4000-8000-000000000013",
  mobile: "20000000-0000-4000-8000-000000000014",
  "mobile-lg": "20000000-0000-4000-8000-000000000015",
};

const person = (info: TestInfo) => `leave-self-${info.project.name}@maxoff.local`;
const memberId = (info: TestInfo) => MEMBER_IDS[info.project.name] as string;
const isPhone = (info: TestInfo) => info.project.name.startsWith("mobile");
const inDays = (n: number) => addISTDays(todayIST(), n);

test.use({ storageState: { cookies: [], origins: [] } });
test.describe.configure({ mode: "serial" });

test.beforeAll(async ({}, info) => {
  await resetAttendanceAndLeave(memberId(info));
});

/** A request's row: a table row on desktop, a card on a phone. */
function row(page: Page, info: TestInfo, ...texts: string[]): Locator {
  let found = isPhone(info) ? page.locator('[data-slot="data-card"]') : page.locator("tbody tr");
  for (const text of texts) found = found.filter({ hasText: text });
  return found.first();
}

/** Runs a row action: the row's own button on desktop, the detail sheet's on a phone. */
async function act(page: Page, info: TestInfo, action: string, ...texts: string[]) {
  const target = row(page, info, ...texts);
  if (isPhone(info)) {
    await target.click();
    await page.locator('[data-slot="detail-sheet"]').getByRole("button", { name: action }).click();
  } else {
    await target.getByRole("button", { name: action }).click();
  }
}

async function openLeave(page: Page) {
  await page.getByRole("link", { name: "Attendance & leave" }).first().click();
  await expect(page).toHaveURL(/\/leave$/);
  await expect(page.getByRole("heading", { name: "Attendance & leave" })).toBeVisible();
}

async function fillLeave(
  dialog: Locator,
  { kind, first, last, reason }: { kind?: string; first: string; last?: string; reason?: string },
) {
  if (kind) {
    await dialog.getByRole("combobox", { name: "Kind of leave" }).click();
    await dialog.page().getByRole("option", { name: kind, exact: true }).click();
  }
  await dialog.getByLabel(kind === "Half day" ? "Date" : "First day").fill(first);
  if (last) await dialog.getByLabel("Last day").fill(last);
  if (reason) await dialog.getByLabel("Reason (optional)").fill(reason);
}

/** The mobile standard on the screen (ARCHITECTURE §14.1): 44px targets, no sideways scroll. */
async function expectFitsThePhone(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
  for (const target of await page.locator('[data-slot="leave-tabs"] a').all()) {
    expect((await target.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  }
  const fab = await page.getByRole("button", { name: "Request leave" }).boundingBox();
  expect(fab!.height).toBeGreaterThanOrEqual(44);
  expect(fab!.y + fab!.height).toBeLessThanOrEqual(page.viewportSize()!.height);
}

async function requestId(info: TestInfo, filter: string): Promise<string> {
  const rows = await serviceSelect<{ id: string }>(
    `leave_requests?member_id=eq.${memberId(info)}&${filter}&select=id&order=created_at.desc`,
  );
  expect(rows.length, filter).toBeGreaterThan(0);
  return rows[0]!.id;
}

test("request a range and a half day, the refusals, and withdraw", async ({ page }, info) => {
  await signIn(page, person(info), PASSWORD);
  await openLeave(page);
  await expect(page.getByText("No leave requests yet")).toBeVisible();
  if (isPhone(info)) await expectFitsThePhone(page);

  // A three-day range.
  await page.getByRole("button", { name: "Request leave" }).click();
  const dialog = page.getByRole("dialog");
  await fillLeave(dialog, { first: inDays(10), last: inDays(12), reason: "Family trip" });
  await dialog.getByRole("button", { name: "Request leave" }).click();
  await expect(dialog).toBeHidden();
  await expect(row(page, info, "Leave · 3 days")).toContainText("Waiting");

  // The form's own checks: a start in the past, a last day before the first.
  await page.getByRole("button", { name: "Request leave" }).click();
  await fillLeave(dialog, { first: inDays(-1), last: inDays(3) });
  await dialog.getByRole("button", { name: "Request leave" }).click();
  await expect(dialog.locator('[data-slot="field-error"]')).toHaveText(
    "Leave cannot start in the past.",
  );
  await fillLeave(dialog, { first: inDays(5), last: inDays(4) });
  // Picking a first day after the last moves the last day along; set it back by hand.
  await dialog.getByLabel("Last day").fill(inDays(4));
  await dialog.getByRole("button", { name: "Request leave" }).click();
  await expect(dialog.locator('[data-slot="field-error"]')).toHaveText(
    "The last day is before the first day.",
  );

  // The database's: a half day inside the waiting range.
  await fillLeave(dialog, { kind: "Half day", first: inDays(11) });
  await dialog.getByRole("button", { name: "Request leave" }).click();
  await expect(dialog.locator('[data-slot="form-alert"]')).toContainText(
    "You already have a request for these dates",
  );

  // A half day elsewhere, then withdrawn.
  await fillLeave(dialog, { kind: "Half day", first: inDays(20) });
  await dialog.getByRole("button", { name: "Request leave" }).click();
  await expect(dialog).toBeHidden();
  await expect(row(page, info, "Half day")).toContainText("Waiting");
  await act(page, info, "Withdraw", "Half day");
  await page.getByRole("alertdialog").getByRole("button", { name: "Withdraw" }).click();
  await expect(row(page, info, "Half day")).toContainText("Withdrawn");
});

test("approved leave can be changed or cancelled; a refusal shows the Owner's reason", async ({
  page,
}, info) => {
  const range = await requestId(info, `state=eq.submitted&start_date=eq.${inDays(10)}`);
  await rpcAs(USERS.owner.email, USERS.owner.password, "leave_decide", {
    request_id: range,
    decision: "approve",
  });

  await signIn(page, person(info), PASSWORD);
  await openLeave(page);
  await expect(row(page, info, "Leave · 3 days")).toContainText("Approved");

  // Ask for one more day.
  await act(page, info, "Change", "Leave · 3 days", "Approved");
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel("Last day")).toHaveValue(inDays(12));
  await dialog.getByLabel("Last day").fill(inDays(13));
  await dialog.getByRole("button", { name: "Send change" }).click();
  await expect(dialog).toBeHidden();
  await expect(row(page, info, "Leave · 4 days")).toContainText("Waiting");
  // One open change per request: the approved leave offers nothing while it waits.
  if (!isPhone(info)) {
    await expect(row(page, info, "Leave · 3 days", "Approved").getByRole("button")).toHaveCount(0);
  }

  // The Owner refuses it, with a reason the member sees.
  const change = await requestId(info, `state=eq.submitted&supersedes_id=eq.${range}`);
  await rpcAs(USERS.owner.email, USERS.owner.password, "leave_decide", {
    request_id: change,
    decision: "reject",
    reason: "Shoot that week",
  });
  await page.reload();
  const refused = row(page, info, "Leave · 4 days");
  await expect(refused).toContainText("Not approved");
  if (isPhone(info)) {
    await refused.click();
    await expect(page.locator('[data-slot="leave-decision-note"]')).toHaveText(
      "The Owner's reason: Shoot that week",
    );
    await page.keyboard.press("Escape");
    // The sheet closes through history (overlay-history); let it finish before the next tap.
    await expect(page.locator('[data-slot="detail-sheet"]')).toBeHidden();
  } else {
    await expect(refused).toContainText("The Owner's reason: Shoot that week");
  }

  // Then ask to cancel the leave altogether.
  await act(page, info, "Ask to cancel", "Leave · 3 days", "Approved");
  const confirm = page.getByRole("alertdialog");
  await confirm.getByLabel("Reason (optional)").fill("Trip called off");
  await confirm.getByRole("button", { name: "Ask to cancel" }).click();
  await expect(confirm).toBeHidden();
  if (!isPhone(info)) {
    await expect(row(page, info, "Cancellation of this leave")).toContainText("Waiting");
  }
  await expect(row(page, info, "Leave · 3 days", "Waiting")).toBeVisible();
});

test("the attendance history says how the day was recorded, in the member's words", async ({
  page,
}, info) => {
  // Present at the gate, then leave for today approved: the later leave wins (WORKFLOWS §1).
  await signIn(page, person(info), PASSWORD);
  const today = await rpcAs<string>(person(info), PASSWORD, "leave_submit", {
    type: "leave",
    start_date: todayIST(),
    end_date: todayIST(),
  });
  await rpcAs(USERS.owner.email, USERS.owner.password, "leave_decide", {
    request_id: today,
    decision: "approve",
  });

  await page.goto("/leave?tab=attendance");
  await expect(page.locator('[data-slot="leave-tabs"] [aria-current="page"]')).toHaveText(
    "Attendance",
  );
  await expect(page.locator('[data-slot="leave-pager"]')).toContainText(
    monthLabel(monthOf(todayIST())),
  );
  await expect(page.getByRole("link", { name: "Next month" })).toHaveCount(0);

  const day = isPhone(info)
    ? page.locator('[data-slot="data-card"]').first()
    : page.locator("tbody tr").first();
  await expect(day).toContainText("Leave");
  await expect(day).toContainText("Your leave was approved");

  if (isPhone(info)) {
    await day.click();
  } else {
    await day.getByRole("button").first().click();
  }
  const timeline = page.locator('[data-slot="day-timeline"]').last();
  await expect(timeline).toContainText("You chose present");
  await expect(timeline).toContainText("Changed to leave: your leave request was approved");
  await expect(timeline).not.toContainText("corrected");
});

test("the Owner has no leave of their own here", async ({ browser }) => {
  const context = await browser.newContext({ storageState: storageStateFor("owner") });
  const page = await context.newPage();
  await page.goto("/leave");
  await expect(page).toHaveURL(/\/forbidden/);
  await context.close();
});
