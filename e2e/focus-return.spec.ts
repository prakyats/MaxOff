import { expect, test } from "./fixtures";
import { hydrated, storageStateFor } from "./helpers";

/**
 * v7.5 keyboard audit K1 (docs/handoff/v7.5-plan.md §5.2): closing a dialog, an alert or a sheet
 * hands focus back to what opened it, so Tab carries on from there. Radix does this only for a
 * `*Trigger`; most layers open from state, and focus used to fall to `<body>`, the top of the page.
 * The primitives remember the opener (`useLayerReturnFocus`, `core/ui/keyboard/layer.ts`).
 * Laptop only: a keyboard's focus. Nothing is saved.
 */
test.describe("Closing a layer returns focus to its opener (K1)", () => {
  test.use({ storageState: storageStateFor("owner") });
  test.skip(({ isMobile }) => Boolean(isMobile), "a laptop keyboard's focus");

  test("a dialog and an alert opened from a row's button", async ({ page }) => {
    await page.goto("/settings/job-titles");
    await hydrated(page);

    // A dialog opened from state (the row's Rename): Escape, then Cancel.
    const rename = page.getByRole("button", { name: "Rename Video Editor" });
    await rename.focus();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel("Name", { exact: true })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(rename).toBeFocused();

    await page.keyboard.press("Enter");
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toBeHidden();
    await expect(rename).toBeFocused();

    // An alert opened from state (the row's Archive): its Cancel, by keyboard.
    const archive = page.getByRole("button", { name: "Archive Graphic Designer" });
    await archive.focus();
    await page.keyboard.press("Enter");
    const alert = page.getByRole("alertdialog");
    await expect(alert).toBeVisible();
    await expect(alert.getByRole("button", { name: "Cancel" })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(alert).toBeHidden();
    await expect(archive).toBeFocused();
    // Nothing changed.
    await expect(
      page.locator('[data-slot="list-item"]').filter({ hasText: "Graphic Designer" }),
    ).toHaveCount(1);
  });

  test("a dialog opened from a ⋯ menu returns focus to the menu's button", async ({ page }) => {
    await page.goto("/people");
    await hydrated(page);
    const actions = page.getByRole("button", { name: "Actions for Local Admin" });
    await actions.focus();
    await page.keyboard.press("Enter");
    await page.getByRole("menuitem", { name: "Change sign-in email" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(actions).toBeFocused();
  });
});
