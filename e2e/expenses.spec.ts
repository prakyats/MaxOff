import { type Locator, type Page, type TestInfo } from "@playwright/test";

import { expect, test } from "./fixtures";

import { addISTDays, todayIST } from "../src/core/time";

import {
  expectBackStack,
  memberIdOf,
  resetAttendanceAndLeave,
  resetExpenseClaims,
  rpcAs,
  runInstalled,
  serviceSelect,
  signIn,
  USERS,
} from "./helpers";

/**
 * Expense claims (task 3b.3, PRODUCT §4.18, WORKFLOWS §2a): a member claims from Attendance &
 * leave → Expenses (validation, a receipt needed above the Owner's amount, uploaded through
 * `core/storage`) and from End day's "Any expenses to claim today?" → Yes (several, then Done);
 * the Owner approves one and rejects one with a reason from Approvals → Expenses (review-only,
 * the receipt in the sheet); an Admin sees none of it; the member reads the outcomes and
 * withdraws the claim still waiting. Settings → Expenses: the Owner's categories and receipt
 * amount. Installed, every new layer closes on back (ARCHITECTURE §14.2 a).
 *
 * Runs in `desktop`, `mobile` (375px) and `mobile-lg` (430px), one seeded person per project
 * (`expense-<project>@maxoff.local`), reset at the start so it re-runs without `pnpm db:reset`.
 */

const PASSWORD = "expense-local-password";
const person = (info: TestInfo) => `expense-${info.project.name}@maxoff.local`;
const personName = (info: TestInfo) => `Test Expenses (${info.project.name})`;

/** A 2×2 PNG (red): a real image to decode and preview, small enough to go up in one PUT. */
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEklEQVR4nGP4z8DwHwyBBAMDABbdBP38ONcyAAAAAElFTkSuQmCC",
  "base64",
);

function claimRows(page: Page): Locator {
  return page.locator('[data-slot="expense-claim"]');
}

function claimDialog(page: Page): Locator {
  return page.locator('[data-slot="expense-claim-dialog"]');
}

async function pickCategory(page: Page, dialog: Locator, name: string): Promise<void> {
  await dialog.getByLabel("Category").click();
  await page.getByRole("option", { name, exact: true }).click();
}

async function signInOwner(page: Page): Promise<void> {
  await page.context().clearCookies();
  await signIn(page, USERS.owner.email, USERS.owner.password);
}

function expenseRows(page: Page, info: TestInfo): Locator {
  return page
    .locator('[data-slot="approval-group"][data-group="expenses"] [data-slot="approval-row"]')
    .filter({ hasText: personName(info) });
}

test.describe.configure({ mode: "serial" });
test.use({ storageState: { cookies: [], origins: [] } });

test("claims from the Expenses tab and End day, the Owner's decisions, and a withdrawal", async ({
  page,
}, info) => {
  const email = person(info);
  const memberId = await memberIdOf(email);
  await resetExpenseClaims(memberId);
  await resetAttendanceAndLeave(memberId);

  // The member opens Attendance & leave → Expenses: nothing yet.
  await signIn(page, email, PASSWORD);
  await page.goto("/leave/expenses");
  await expect(page.getByText("No expense claims yet")).toBeVisible();

  // A claim with nothing filled in: a message per field, nothing sent.
  await page.getByRole("button", { name: "Add expense" }).click();
  const dialog = claimDialog(page);
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Add claim" }).click();
  await expect(dialog.locator('[data-slot="field-error"]').first()).toContainText(
    "Enter the amount in rupees",
  );
  await expect(dialog).toContainText("Choose a category.");
  await expect(dialog).toContainText("Say what it was for.");

  // A small one: no receipt needed.
  await dialog.getByLabel("Amount (₹)").fill("250");
  await pickCategory(page, dialog, "Travel");
  await dialog.getByLabel("What was it for?").fill("Auto to the Koramangala shoot");
  await dialog.getByRole("button", { name: "Add claim" }).click();
  await expect(dialog).toBeHidden();
  await expect(claimRows(page)).toHaveCount(1);
  await expect(claimRows(page).first()).toContainText("₹250");
  await expect(claimRows(page).first()).toContainText("Waiting for the Owner");

  // Above the receipt amount: the photo is needed, then attached through storage.
  await page.getByRole("button", { name: "Add expense" }).click();
  await dialog.getByLabel("Amount (₹)").fill("1,200.50");
  await pickCategory(page, dialog, "Materials");
  await dialog.getByLabel("What was it for?").fill("Gaffer tape and gels");
  await dialog.getByRole("button", { name: "Add claim" }).click();
  await expect(dialog.locator('[data-slot="receipt-field"]')).toContainText(
    "Add a receipt photo: it's needed above ₹500",
  );
  await dialog
    .locator('[data-slot="receipt-input"]')
    .setInputFiles({ name: "receipt.png", mimeType: "image/png", buffer: PNG });
  await expect(dialog.getByRole("img", { name: "The receipt you chose" })).toBeVisible();
  await dialog.getByRole("button", { name: "Add claim" }).click();
  await expect(dialog).toBeHidden();
  await expect(claimRows(page)).toHaveCount(2);
  await expect(page.getByText("₹1,200.50")).toBeVisible();

  // End day → "Any expenses to claim today?" → Yes: the form opens for today, takes one, Done.
  await page.goto("/my-day");
  await page
    .locator('[data-slot="attendance-strip"]')
    .getByRole("button", { name: "End day" })
    .click();
  const confirm = page.getByRole("alertdialog", { name: "End your day?" });
  await expect(confirm.getByRole("radio", { name: "No" })).toBeChecked();
  await confirm.getByRole("radio", { name: "Yes" }).check();
  await confirm.getByRole("button", { name: "End day, add expenses" }).click();
  await expect(confirm).toBeHidden();
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("heading", { name: "Expenses to claim" })).toBeVisible();
  await dialog.getByLabel("Amount (₹)").fill("80");
  await pickCategory(page, dialog, "Food");
  await dialog.getByLabel("What was it for?").fill("Tea for the crew");
  await dialog.getByRole("button", { name: "Add claim" }).click();
  await expect(dialog.locator('[data-slot="claims-added"]')).toContainText("₹80 · Food");
  // Several per day: the form is empty again, ready for the next one.
  await expect(dialog.getByLabel("Amount (₹)")).toHaveValue("");
  await dialog.getByRole("button", { name: "Done" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.locator('[data-slot="attendance-strip"]')).toHaveAttribute(
    "data-kind",
    "ended",
  );

  // An Admin never sees anyone's claims: no Expenses group, and no way into the settings.
  await page.context().clearCookies();
  await signIn(page, USERS.admin.email, USERS.admin.password);
  await page.goto("/approvals");
  await expect(page.locator('[data-slot="approval-group"][data-group="expenses"]')).toHaveCount(0);
  await page.goto("/settings/expenses");
  await expect(page).toHaveURL(/\/forbidden$/);

  // The Owner: three claims waiting in Approvals → Expenses (review-only).
  await signInOwner(page);
  await page.goto("/approvals");
  const rows = expenseRows(page, info);
  await expect(rows).toHaveCount(3);
  await expect(rows.first().getByRole("button", { name: "Approve" })).toHaveCount(0);
  const withReceipt = rows.filter({ hasText: "₹1,200.50" });
  await expect(withReceipt).toContainText("Receipt");
  await withReceipt.getByRole("button", { name: "Review" }).click();
  const sheet = page.locator('[data-slot="review-sheet"]');
  await expect(sheet).toContainText("Gaffer tape and gels");
  await expect(sheet.locator('[data-slot="file-image"]')).toBeVisible();
  await sheet.getByRole("button", { name: "Approve" }).click();
  await expect(sheet).toBeHidden();
  await expect(rows).toHaveCount(2);

  await rows.filter({ hasText: "₹250" }).getByRole("button", { name: "Review" }).click();
  await sheet.getByRole("button", { name: "Reject…" }).click();
  const reject = page.getByRole("dialog", { name: /Reject .*'s claim\?/ });
  await reject.getByLabel("Reason").fill("Use the company cab next time");
  await reject.getByRole("button", { name: "Reject claim" }).click();
  await expect(reject).toBeHidden();
  await expect(rows).toHaveCount(1);

  // The member reads the outcomes and withdraws the one still waiting.
  await page.context().clearCookies();
  await signIn(page, email, PASSWORD);
  await page.goto("/leave/expenses");
  await expect(claimRows(page)).toHaveCount(3);
  const approved = claimRows(page).filter({ hasText: "Gaffer tape and gels" });
  await expect(approved).toContainText("Approved · not paid yet");
  const rejected = claimRows(page).filter({ hasText: "Auto to the Koramangala shoot" });
  await expect(rejected).toContainText("Rejected");
  await expect(rejected).toContainText("The Owner: Use the company cab next time");
  const waiting = claimRows(page).filter({ hasText: "Tea for the crew" });
  await waiting.getByRole("button", { name: "Withdraw" }).click();
  const withdraw = page.getByRole("alertdialog", { name: "Withdraw this claim?" });
  await withdraw.getByRole("button", { name: "Withdraw claim" }).click();
  await expect(withdraw).toBeHidden();
  await expect(waiting).toContainText("Withdrawn");
  await expect(waiting.getByRole("button", { name: "Withdraw" })).toHaveCount(0);
});

test("Settings → Expenses: the Owner's categories and receipt amount", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "one organization: the desktop project owns it");
  await signInOwner(page);
  await page.goto("/settings");
  await page.getByRole("link", { name: "Expenses" }).click();
  await expect(page).toHaveURL(/\/settings\/expenses$/);
  const list = page.locator('[data-slot="list-items"]');
  for (const name of ["Travel", "Food", "Materials", "Other"]) {
    await expect(list).toContainText(name);
  }
  // The receipt amount: changed and put back (the other projects' claims stay clear of both).
  const amount = page.getByLabel("Receipt photo needed above (₹)");
  await expect(amount).toHaveValue("500");
  await amount.fill("-4");
  await page.getByRole("button", { name: "Save receipt amount" }).click();
  await expect(page.locator('[data-slot="field-error"]')).toContainText("Enter an amount");
  await amount.fill("600");
  await page.getByRole("button", { name: "Save receipt amount" }).click();
  await expect(page.getByText("Receipt amount saved")).toBeVisible();
  await page.reload();
  await expect(amount).toHaveValue("600");
  await amount.fill("500");
  await page.getByRole("button", { name: "Save receipt amount" }).click();
  await expect(page.getByText("Receipt amount saved")).toBeVisible();
  await page.reload();
  await expect(amount).toHaveValue("500");
});

test("Approvals lists attendance, leave, extra work, then expenses (kickoff 3b decision 29)", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "desktop", "the order is the same at every width");
  const email = person(info);
  const memberId = await memberIdOf(email);
  await resetExpenseClaims(memberId);
  await resetAttendanceAndLeave(memberId);
  // One row in each group, all this person's: the started day waits as Present, a leave
  // request, an overtime note and a claim.
  await signIn(page, email, PASSWORD);
  const today = todayIST();
  await rpcAs(email, PASSWORD, "leave_submit", {
    type: "leave",
    start_date: addISTDays(today, 20),
    end_date: addISTDays(today, 20),
  });
  await rpcAs(email, PASSWORD, "extra_work_note_submit", {
    kind: "overtime",
    work_date: today,
    note: "Late colour pass",
  });
  const [travel] = await serviceSelect<{ id: string }>(
    "list_items?list_key=eq.expense_category&name=eq.Travel&archived_at=is.null&select=id",
  );
  await rpcAs(email, PASSWORD, "expense_claim_submit", {
    expense_date: today,
    amount: 80,
    category_id: travel?.id,
    note: "Auto to the studio",
  });

  await signInOwner(page);
  await page.goto("/approvals");
  const groups = page.locator('[data-slot="approval-group"]');
  await expect(groups.filter({ hasText: personName(info) })).toHaveCount(4);
  const order = await groups.evaluateAll((nodes) =>
    nodes.map((node) => node.getAttribute("data-group")),
  );
  // Staff tasks (4.5) come after, when any wait for the Owner (other specs' tasks may).
  expect(order.filter((group) => group !== "tasks")).toEqual([
    "attendance",
    "leave",
    "extra-work",
    "expenses",
  ]);
  if (order.includes("tasks")) expect(order.at(-1)).toBe("tasks");
});

test.describe("installed: the back order of the claim form and the Owner's review", () => {
  test.skip(({ isMobile }) => !isMobile, "the installed app is a phone");

  test("back closes the category select, then the claim form, then leaves Expenses", async ({
    page,
  }, info) => {
    await runInstalled(page);
    await signIn(page, person(info), PASSWORD);
    await page.goto("/leave/expenses");
    await page.getByRole("button", { name: "Add expense" }).click();
    const dialog = claimDialog(page);
    await dialog.getByLabel("Category").click();
    const select = page.locator('[data-slot="select-sheet"]');
    await expect(select).toBeVisible();
    await expectBackStack(page, [
      { closes: select, url: /\/leave\/expenses$/ },
      { closes: dialog, url: /\/leave\/expenses$/ },
      { url: /\/my-day$/ },
    ]);
  });

  test("back closes the Withdraw confirmation, then leaves Expenses", async ({ page }, info) => {
    await resetExpenseClaims(await memberIdOf(person(info)));
    await runInstalled(page);
    await signIn(page, person(info), PASSWORD);
    await page.goto("/leave/expenses");
    await page.getByRole("button", { name: "Add expense" }).click();
    const dialog = claimDialog(page);
    await dialog.getByLabel("Amount (₹)").fill("60");
    await pickCategory(page, dialog, "Food");
    await dialog.getByLabel("What was it for?").fill("Lunch at the shoot");
    await dialog.getByRole("button", { name: "Add claim" }).click();
    await expect(dialog).toBeHidden();
    // A dialog closed by its button leaves its entry spent (3.4 mechanics 5): start clean.
    await page.goto("/my-day");
    await page.goto("/leave/expenses");
    await claimRows(page).first().getByRole("button", { name: "Withdraw" }).click();
    const withdraw = page.getByRole("alertdialog", { name: "Withdraw this claim?" });
    await expect(withdraw).toBeVisible();
    await expectBackStack(page, [
      { closes: withdraw, url: /\/leave\/expenses$/ },
      { url: /\/my-day$/ },
    ]);
  });

  test("the tabs replace: one back from Expenses leaves Extra work & expenses", async ({
    page,
  }, info) => {
    await runInstalled(page);
    await signIn(page, person(info), PASSWORD);
    await page.goto("/leave/extra-work");
    await page.getByRole("link", { name: "Expenses", exact: true }).click();
    await expect(page).toHaveURL(/\/leave\/expenses$/);
    await page.getByRole("link", { name: "Extra work", exact: true }).click();
    await expect(page).toHaveURL(/\/leave\/extra-work$/);
    await expectBackStack(page, [{ url: /\/my-day$/ }]);
  });

  test("End day's Yes opens the form; back closes it and stays on My Day", async ({
    page,
  }, info) => {
    await resetAttendanceAndLeave(await memberIdOf(person(info)));
    await runInstalled(page);
    await signIn(page, person(info), PASSWORD);
    await expect(page).toHaveURL(/\/my-day$/);
    await page
      .locator('[data-slot="attendance-strip"]')
      .getByRole("button", { name: "End day" })
      .click();
    const confirm = page.getByRole("alertdialog", { name: "End your day?" });
    await confirm.getByRole("radio", { name: "Yes" }).check();
    await confirm.getByRole("button", { name: "End day, add expenses" }).click();
    const dialog = claimDialog(page);
    await expect(dialog).toBeVisible();
    await page.goBack();
    await expect(dialog).toBeHidden();
    await expect(page).toHaveURL(/\/my-day$/);
    await expect(page.locator('[data-slot="attendance-strip"]')).toHaveAttribute(
      "data-kind",
      "ended",
    );
  });

  test("Settings → Expenses: back closes a category's actions and its rename, then goes up", async ({
    page,
  }) => {
    await runInstalled(page);
    await signIn(page, USERS.owner.email, USERS.owner.password);
    await page.goto("/settings");
    await page.getByRole("link", { name: "Expenses" }).click();
    await expect(page).toHaveURL(/\/settings\/expenses$/);
    const actions = page.locator('[data-slot="list-item-actions"]');
    await page.getByRole("button", { name: "Actions for Travel" }).click();
    await expect(actions).toBeVisible();
    await expectBackStack(page, [{ closes: actions, url: /\/settings\/expenses$/ }]);
    await page.getByRole("button", { name: "Actions for Travel" }).click();
    await actions.getByRole("button", { name: "Rename" }).click();
    const rename = page.getByRole("dialog");
    await expect(rename).toBeVisible();
    await expectBackStack(page, [
      { closes: rename, url: /\/settings\/expenses$/ },
      { url: /\/settings$/ },
    ]);
  });

  test("back closes the reject dialog, then the review sheet, then leaves Approvals", async ({
    page,
  }, info) => {
    const memberId = await memberIdOf(person(info));
    await resetExpenseClaims(memberId);
    await runInstalled(page);
    await signIn(page, person(info), PASSWORD);
    await page.goto("/leave/expenses");
    await page.getByRole("button", { name: "Add expense" }).click();
    const dialog = claimDialog(page);
    await dialog.getByLabel("Amount (₹)").fill("40");
    await pickCategory(page, dialog, "Other");
    await dialog.getByLabel("What was it for?").fill("Parking at the venue");
    await dialog.getByRole("button", { name: "Add claim" }).click();
    await expect(dialog).toBeHidden();

    await signInOwner(page);
    await page.goto("/today");
    await page.goto("/approvals");
    await expenseRows(page, info).getByRole("button", { name: "Review" }).click();
    const sheet = page.locator('[data-slot="review-sheet"]');
    await sheet.getByRole("button", { name: "Reject…" }).click();
    const reject = page.getByRole("dialog", { name: /Reject .*'s claim\?/ });
    await expect(reject).toBeVisible();
    await expectBackStack(page, [
      { closes: reject, url: /\/approvals$/ },
      { closes: sheet, url: /\/approvals$/ },
      { url: /\/today$/ },
    ]);
  });
});
