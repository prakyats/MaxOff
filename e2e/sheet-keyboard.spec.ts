import { expect, test } from "./fixtures";
import { expectBackStack, expectSheetAboveKeyboard, hydrated, storageStateFor } from "./helpers";

/**
 * Bottom sheets follow the on-screen keyboard (ARCHITECTURE §14.1, owner's phone walk of phase 7,
 * 2026-10-09: the keyboard opened over the sheet and hid the field being typed in). The fix is in
 * the shared primitives (`core/ui/viewport/keyboard-lift`), so this checks the Crew's two most
 * used form sheets, both `Dialog`s, at 375 and 430 px; `client-work.spec` checks the `Sheet`s
 * (the item list, the default stages, the item's editor) and a reason dialog, and
 * `task-page.spec` the task's Chat composer, which places itself. The keyboard is the
 * `visualViewport` stand-in (`openKeyboard`): it only opens the dialogs, nothing is sent.
 */

test.use({ storageState: storageStateFor("staff") });

test.beforeEach(({}, info) => {
  test.skip(info.project.name === "desktop", "a bottom sheet is the phone's, 375 and 430");
});

test("Request leave: the reason stays above the keyboard", async ({ page }) => {
  await page.goto("/leave");
  await hydrated(page);
  await page.getByRole("button", { name: "Request leave" }).click();
  const dialog = page.getByRole("dialog", { name: "Request leave" });
  await expect(dialog).toBeVisible();
  await expectSheetAboveKeyboard(page, dialog, dialog.getByLabel("Reason (optional)"));
  await expectSheetAboveKeyboard(page, dialog, dialog.getByLabel("First day"));
  await expectBackStack(page, [{ closes: dialog, url: /\/leave$/ }]);
});

test("Add expense: what it was for stays above the keyboard", async ({ page }) => {
  await page.goto("/leave/expenses");
  await hydrated(page);
  await page.getByRole("button", { name: "Add expense" }).click();
  const dialog = page.locator('[data-slot="expense-claim-dialog"]');
  await expect(dialog).toBeVisible();
  await expectSheetAboveKeyboard(page, dialog, dialog.getByLabel("What was it for?"));
  await expectSheetAboveKeyboard(page, dialog, dialog.getByLabel("Amount (₹)"));
  await expectBackStack(page, [{ closes: dialog, url: /\/leave\/expenses$/ }]);
});
