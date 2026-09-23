import { expect, test } from "@playwright/test";

import { storageStateFor } from "./helpers";

/**
 * Settings (task 1.4): the company profile, weekly off days, holidays, thresholds and the job
 * title list, plus who may open which section. The Owner tests change the one organization
 * row, so they run in order and put their changes back where a later test depends on them.
 */
const HOLIDAY = { date: "2026-10-02", name: "Gandhi Jayanti" };

// One organization, one job-title list: every test here writes to the same rows, so the file
// runs in order rather than racing itself (the Admin test would otherwise add a title while
// the Owner test is asserting the order of the list).
test.describe.configure({ mode: "serial" });

test.describe("Owner", () => {
  test.use({ storageState: storageStateFor("owner") });
  // Settings is a first-class phone screen since 1.5; these tests drive the desktop controls
  // (the four-icon list row, the wide forms). The phone shapes are in `mobile.spec.ts`.
  test.skip(({ isMobile }) => Boolean(isMobile), "these drive the desktop controls");

  test("opens every built section from the control centre", async ({ page }) => {
    await page.goto("/settings");
    await expect(page.getByRole("heading", { name: "Settings", exact: true })).toBeVisible();
    // Sections that are not built yet are cards, not links (they name the task instead).
    await expect(page.getByRole("link", { name: "Task types" })).toHaveCount(0);

    for (const [name, heading] of [
      ["Company", "Company"],
      ["Days off & holidays", "Days off & holidays"],
      ["Thresholds", "Thresholds"],
      ["Job titles", "Job titles"],
    ] as const) {
      await page.goto("/settings");
      await page.getByRole("link", { name, exact: true }).click();
      await expect(page.getByRole("heading", { name: heading, exact: true })).toBeVisible();
      await page.getByRole("link", { name: "Settings" }).first().click();
      await expect(page).toHaveURL(/\/settings$/);
    }
  });

  test("renames the company and refuses an empty name", async ({ page }) => {
    await page.goto("/settings/company");
    await expect(page.getByLabel("Timezone")).toBeDisabled();

    await page.getByLabel("Company name").fill("");
    await page.getByRole("button", { name: "Save company" }).click();
    await expect(page.locator('[data-slot="field-error"]')).toContainText("required");

    await page.getByLabel("Company name").fill("Pixora Clips (renamed)");
    await page.getByRole("button", { name: "Save company" }).click();
    await expect(page.getByText("Company profile saved")).toBeVisible();
    await page.reload();
    await expect(page.getByLabel("Company name")).toHaveValue("Pixora Clips (renamed)");
  });

  test("sets the weekly off days and refuses a week with no working day", async ({ page }) => {
    await page.goto("/settings/days-off");
    await expect(page.getByText("Currently Sunday.")).toBeVisible();

    for (const day of ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]) {
      await page.getByRole("checkbox", { name: day }).click();
    }
    await page.getByRole("button", { name: "Save days off" }).click();
    await expect(page.locator('[data-slot="field-error"]')).toContainText("working day");

    for (const day of ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"]) {
      await page.getByRole("checkbox", { name: day }).click();
    }
    await page.getByRole("button", { name: "Save days off" }).click();
    await expect(page.getByText("Weekly off days saved")).toBeVisible();
    await page.reload();
    await expect(page.getByText("Currently Saturday and Sunday.")).toBeVisible();

    // Back to the launch setting (PRODUCT §7), which the rest of the suite assumes.
    await page.getByRole("checkbox", { name: "Saturday" }).click();
    await page.getByRole("button", { name: "Save days off" }).click();
    await expect(page.getByText("Weekly off days saved")).toBeVisible();
    await page.reload();
    await expect(page.getByText("Currently Sunday.")).toBeVisible();
  });

  test("adds a holiday, refuses the same date twice, and removes it again", async ({ page }) => {
    await page.goto("/settings/days-off");
    await expect(page.getByText("No holidays yet")).toBeVisible();

    await page.getByLabel("Date").fill(HOLIDAY.date);
    await page.getByLabel("Name", { exact: true }).fill(HOLIDAY.name);
    await page.getByRole("button", { name: "Add holiday" }).click();
    await expect(page.getByText("Holiday added")).toBeVisible();
    const row = page.locator('[data-slot="holiday-row"]');
    await expect(row).toHaveCount(1);
    await expect(row).toContainText(HOLIDAY.name);
    await expect(row).toContainText("Friday");

    await page.getByLabel("Date").fill(HOLIDAY.date);
    await page.getByLabel("Name", { exact: true }).fill("Same date again");
    await page.getByRole("button", { name: "Add holiday" }).click();
    await expect(page.locator('[data-slot="form-alert"]')).toContainText(
      "already a holiday on that date",
    );

    await page.getByRole("button", { name: `Remove ${HOLIDAY.name}` }).click();
    await page.getByRole("button", { name: "Remove", exact: true }).click();
    await expect(page.getByText("Holiday removed")).toBeVisible();
    await expect(page.getByText("No holidays yet")).toBeVisible();
  });

  test("saves the thresholds and refuses an Owner escalation before the Admin one", async ({
    page,
  }) => {
    await page.goto("/settings/thresholds");
    await expect(page.getByLabel("Logout reminder")).toHaveValue("20:30");

    await page.getByLabel("Escalate to the Owner after (hours)").fill("2");
    await page.getByRole("button", { name: "Save thresholds" }).click();
    await expect(page.locator('[data-slot="field-error"]')).toContainText("second level");

    await page.getByLabel("Escalate to the Owner after (hours)").fill("8");
    await page.getByLabel("Logout reminder").fill("21:00");
    await page.getByRole("button", { name: "Save thresholds" }).click();
    await expect(page.getByText("Thresholds saved")).toBeVisible();
    await page.reload();
    await expect(page.getByLabel("Logout reminder")).toHaveValue("21:00");

    await page.getByLabel("Logout reminder").fill("20:30");
    await page.getByRole("button", { name: "Save thresholds" }).click();
    await expect(page.getByText("Thresholds saved")).toBeVisible();
  });

  test("adds, renames, reorders and archives a job title", async ({ page }) => {
    await page.goto("/settings/job-titles");
    const names = page.locator('[data-slot="list-item"]');
    await expect(names).toHaveText([/Video Editor/, /Graphic Designer/]);

    await page.getByLabel("Add a job title").fill("Colorist");
    await page.getByRole("button", { name: "Add", exact: true }).click();
    await expect(page.getByText("Job title added")).toBeVisible();
    await expect(names).toHaveText([/Video Editor/, /Graphic Designer/, /Colorist/]);

    // The same name again (case and spaces aside) is the unique index, said in plain words.
    await page.getByLabel("Add a job title").fill("  colorist ");
    await page.getByRole("button", { name: "Add", exact: true }).click();
    await expect(page.locator('[data-slot="form-alert"]')).toContainText(
      "already a job title with that name",
    );

    await page.getByRole("button", { name: "Move Colorist up" }).click();
    await expect(names).toHaveText([/Video Editor/, /Colorist/, /Graphic Designer/]);
    await page.getByRole("button", { name: "Move Colorist down" }).click();
    await expect(names).toHaveText([/Video Editor/, /Graphic Designer/, /Colorist/]);
    // The first entry cannot go further up.
    await expect(page.getByRole("button", { name: "Move Video Editor up" })).toBeDisabled();

    await page.getByRole("button", { name: "Rename Colorist" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Name", { exact: true }).fill("Colourist");
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("Job title renamed")).toBeVisible();
    await expect(names).toHaveText([/Video Editor/, /Graphic Designer/, /Colourist/]);

    await page.getByRole("button", { name: "Archive Colourist" }).click();
    await page.getByRole("button", { name: "Archive", exact: true }).click();
    await expect(page.getByText("Job title archived")).toBeVisible();
    await expect(names).toHaveText([/Video Editor/, /Graphic Designer/]);
    await expect(page.locator('[data-slot="archived-list-item"]')).toContainText("Colourist");

    // An archived title is not offered when someone is invited.
    await page.goto("/people");
    await page.getByRole("button", { name: "Invite", exact: true }).click();
    await page.getByLabel("Job title").click();
    await expect(page.getByRole("option", { name: "Colourist" })).toHaveCount(0);
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");

    await page.goto("/settings/job-titles");
    await page.getByRole("button", { name: "Restore" }).click();
    await expect(page.getByText("Job title restored")).toBeVisible();
    await expect(names).toHaveText([/Video Editor/, /Graphic Designer/, /Colourist/]);
  });
});

test.describe("Admin", () => {
  test.use({ storageState: storageStateFor("admin") });
  test.skip(({ isMobile }) => Boolean(isMobile), "these drive the desktop controls");

  test("gets the lists but none of the company settings", async ({ page }) => {
    await page.goto("/settings");
    await expect(page.getByRole("link", { name: "Job titles", exact: true })).toBeVisible();
    for (const ownerOnly of ["Company", "Days off & holidays", "Thresholds", "Google Drive"]) {
      await expect(page.getByText(ownerOnly, { exact: true })).toHaveCount(0);
    }

    for (const path of ["/settings/company", "/settings/days-off", "/settings/thresholds"]) {
      await page.goto(path);
      await expect(page, `${path} for an Admin`).toHaveURL(/\/forbidden$/);
    }
  });

  test("edits the job titles (lists.manage, PERMISSIONS §1)", async ({ page }) => {
    await page.goto("/settings/job-titles");
    await page.getByLabel("Add a job title").fill("Sound Engineer");
    await page.getByRole("button", { name: "Add", exact: true }).click();
    await expect(page.getByText("Job title added")).toBeVisible();
    await expect(page.locator('[data-slot="list-item"]')).toContainText(["Sound Engineer"]);

    // Put the list back as it was: an Admin may archive too.
    await page.getByRole("button", { name: "Archive Sound Engineer" }).click();
    await page.getByRole("button", { name: "Archive", exact: true }).click();
    await expect(page.getByText("Job title archived")).toBeVisible();
  });
});

test.describe("Staff", () => {
  test.use({ storageState: storageStateFor("staff") });

  test("cannot open Settings or any of its sections", async ({ page }) => {
    for (const path of ["/settings", "/settings/company", "/settings/job-titles"]) {
      await page.goto(path);
      await expect(page, `${path} for Staff`).toHaveURL(/\/forbidden$/);
    }
  });
});
