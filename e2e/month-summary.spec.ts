import { type Page, type TestInfo } from "@playwright/test";

import { expect, test } from "./fixtures";

import { addISTDays, todayIST } from "../src/core/time";

import {
  expectBackStack,
  memberIdOf,
  resetAttendanceAndLeave,
  resetExpenseClaims,
  runInstalled,
  serviceInsert,
  serviceSelect,
  signIn,
  USERS,
} from "./helpers";

/**
 * The month summary (task 3b.4, PRODUCT §4.18, WORKFLOWS §2b; kickoff 3b decision 30): the Owner
 * reaches the team's month at More → Reports → Month, reads one person's row (days worked of the
 * working days, additional leave, a day waiting, approved expenses to pay), opens their month
 * (the Month tab of `/people/[id]`) and marks the month's approved claims paid. An Admin reaches
 * neither. Installed, the report and the person's month are drill-downs and the month switcher
 * and the tabs add no history (ARCHITECTURE §14.2 b, d).
 *
 * Runs in `desktop`, `mobile` (375px) and `mobile-lg` (430px), one seeded person per project
 * (`month-<project>@maxoff.local`) whose days and claims the spec arranges in **last month**
 * (always complete, and inside the pager: they joined 40 days ago).
 */

const person = (info: TestInfo) => `month-${info.project.name}@maxoff.local`;
const personName = (info: TestInfo) => `Test Month (${info.project.name})`;

/** `yyyy-MM` of last month, and a date in it. */
function lastMonth(): { month: string; day: (n: number) => string } {
  const firstOfThis = `${todayIST().slice(0, 7)}-01`;
  const month = addISTDays(firstOfThis, -1).slice(0, 7);
  return { month, day: (n) => `${month}-${String(n).padStart(2, "0")}` };
}

async function arrange(info: TestInfo): Promise<{ memberId: string; month: string }> {
  const memberId = await memberIdOf(person(info));
  const owner = await memberIdOf(USERS.owner.email);
  await resetExpenseClaims(memberId);
  await resetAttendanceAndLeave(memberId);
  const { month, day } = lastMonth();
  const decided = { decided_by: owner, decided_at: new Date(`${day(20)}T12:00:00Z`).toISOString() };
  const days: Array<Record<string, unknown>> = [
    { work_date: day(10), state: "approved", final_status: "present", ...decided },
    { work_date: day(11), state: "approved", final_status: "leave", ...decided },
    { work_date: day(12), state: "corrected", final_status: "absent", ...decided },
    { work_date: day(13), state: "pending_review", submitted_choice: "present" },
  ];
  for (const row of days) {
    await serviceInsert("attendance_days", { member_id: memberId, is_day_off: false, ...row });
  }
  const [travel] = await serviceSelect<{ id: string }>(
    "list_items?list_key=eq.expense_category&name=eq.Travel&archived_at=is.null&select=id",
  );
  for (const [amount, note] of [
    [300, "Bus to the site"],
    [120.5, "Parking"],
  ] as const) {
    await serviceInsert("expense_claims", {
      member_id: memberId,
      expense_date: day(10),
      amount,
      category_id: travel?.id,
      note,
      state: "approved",
      ...decided,
    });
  }
  return { memberId, month };
}

async function signInOwner(page: Page): Promise<void> {
  await page.context().clearCookies();
  await signIn(page, USERS.owner.email, USERS.owner.password);
}

test.describe.configure({ mode: "serial" });
test.use({ storageState: { cookies: [], origins: [] } });

test("the team's month, one person's month, and the month's claims marked paid", async ({
  page,
}, info) => {
  const { memberId, month } = await arrange(info);
  await signInOwner(page);

  // More → Reports → Month (the sidebar on a desktop).
  if (info.project.name.startsWith("mobile")) {
    await page.locator('[data-slot="bottom-nav"] [data-nav="more"]').click();
    await page
      .locator('[data-slot="more-sheet"]')
      .getByRole("link", { name: "Reports", exact: true })
      .click();
  } else {
    await page.goto("/reports");
  }
  await expect(page).toHaveURL(/\/reports$/);
  await page.locator('[data-slot="report-link"]').filter({ hasText: "Month" }).click();
  await expect(page).toHaveURL(/\/reports\/month$/);

  // Last month, through the switcher: this person's row.
  await page.getByRole("link", { name: "Previous month" }).click();
  await expect(page).toHaveURL(new RegExp(`/reports/month\\?month=${month}$`));
  const row = page.locator('[data-slot="team-month-row"]').filter({ hasText: personName(info) });
  await expect(row).toContainText("Worked 1 of");
  await expect(row).toContainText("additional leave 2");
  await expect(row).toContainText("1 day waiting for your review");
  await expect(row.locator('[data-slot="team-month-unpaid"]')).toHaveText("₹420.50 to pay");

  // Their month: the lines, and the claims.
  await row.getByRole("link").click();
  await expect(page).toHaveURL(new RegExp(`/people/${memberId}/month\\?month=${month}$`));
  const summary = page.locator('[data-slot="month-summary"]');
  await expect(summary.locator('[data-line="worked"]')).toContainText("1");
  await expect(summary.locator('[data-line="additional"]')).toContainText("2");
  await expect(summary.locator('[data-line="leave"]')).toContainText("1 · 0 · 1");
  await expect(summary.locator('[data-slot="month-pending"]')).toContainText(
    "1 day waiting for your review",
  );
  const claims = page.locator('[data-slot="month-claims"]');
  await expect(claims.locator('[data-slot="unpaid-total"]')).toHaveText(
    "Approved, not paid: ₹420.50 · 2 claims",
  );
  await claims.getByRole("button", { name: "Mark all paid" }).click();
  const confirm = page.getByRole("alertdialog", { name: "Mark 2 claims paid?" });
  await expect(confirm).toContainText("₹420.50");
  await confirm.getByLabel("Paid on").fill(addISTDays(todayIST(), 1));
  await confirm.getByRole("button", { name: "Mark 2 paid" }).click();
  await expect(confirm).toContainText("Pick a payment date up to today.");
  await confirm.getByLabel("Paid on").fill(todayIST());
  await confirm.getByRole("button", { name: "Mark 2 paid" }).click();
  await expect(confirm).toBeHidden();
  await expect(claims.locator('[data-slot="unpaid-total"]')).toHaveText(
    "Nothing approved and unpaid",
  );
  await expect(claims.locator('[data-slot="month-claim"][data-state="paid"]')).toHaveCount(2);

  // The member sees their claims paid.
  await page.context().clearCookies();
  await signIn(page, person(info), "month-local-password");
  await page.goto("/leave/expenses");
  await expect(page.locator('[data-slot="expense-claim"]').first()).toContainText("Paid on");
});

test("an Admin reaches neither the team's month nor a person's", async ({ page }, info) => {
  const memberId = await memberIdOf(person(info));
  await signIn(page, USERS.admin.email, USERS.admin.password);
  await page.goto("/reports/month");
  await expect(page).toHaveURL(/\/forbidden$/);
  await page.goto(`/people/${memberId}/month`);
  await expect(page).toHaveURL(/\/forbidden$/);
  // Their Reports stays the placeholder.
  await page.goto("/reports");
  await expect(page.locator('[data-slot="report-link"]')).toHaveCount(0);
});

test.describe("installed: the report and the person's month are drill-downs", () => {
  test.skip(({ isMobile }) => !isMobile, "the installed app is a phone");

  test("the switcher and the tabs add nothing; back climbs one level at a time", async ({
    page,
  }, info) => {
    const { memberId, month } = await arrange(info);
    await runInstalled(page);
    await signInOwner(page);
    await page.goto("/reports");
    await page.locator('[data-slot="report-link"]').filter({ hasText: "Month" }).click();
    await expect(page).toHaveURL(/\/reports\/month$/);
    await page.getByRole("link", { name: "Previous month" }).click();
    await expect(page).toHaveURL(new RegExp(`/reports/month\\?month=${month}$`));
    await page
      .locator('[data-slot="team-month-row"]')
      .filter({ hasText: personName(info) })
      .getByRole("link")
      .click();
    await expect(page).toHaveURL(new RegExp(`/people/${memberId}/month\\?month=${month}$`));
    // Last month is behind this one: the switcher goes forward, then a tab.
    await page.getByRole("link", { name: "Next month" }).click();
    await expect(page).not.toHaveURL(new RegExp(`month=${month}`));
    await page.getByRole("link", { name: "Attendance", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/people/${memberId}/attendance`));
    await expectBackStack(page, [
      { url: new RegExp(`/reports/month\\?month=${month}$`) },
      { url: /\/reports$/ },
    ]);
  });

  test("back closes Mark all paid, then leaves the person's month", async ({ page }, info) => {
    const { memberId, month } = await arrange(info);
    await runInstalled(page);
    await signInOwner(page);
    await page.goto("/people");
    await page.goto(`/people/${memberId}/month?month=${month}`);
    await page
      .locator('[data-slot="month-claims"]')
      .getByRole("button", { name: "Mark all paid" })
      .click();
    const confirm = page.getByRole("alertdialog", { name: "Mark 2 claims paid?" });
    await expect(confirm).toBeVisible();
    await expectBackStack(page, [
      { closes: confirm, url: new RegExp(`/people/${memberId}/month`) },
      { url: /\/people$/ },
    ]);
  });
});
