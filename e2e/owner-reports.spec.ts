import { expect, test } from "./fixtures";

import { hydrated, pageHeader, storageStateFor } from "./helpers";

/**
 * The Owner's reports (v3.0, 9.3; PRODUCT §4.13; kickoff 9 decisions 12–14, the refresh's R7 and
 * Q5): Reports lists People, Stage durations and Client work; each opens with the week, switches
 * to the month or a custom range, and shows its sections (People: the employees' block, and in the
 * Month view the attendance lines; the late tasks; Stage durations: every project; Client work:
 * the totals). Nothing is ranked: the person cards are in name order. An Admin and the Crew open
 * none of them (`reports.all`), and an Admin's own report is unchanged at /reports.
 */

test.describe("the Owner's reports", () => {
  test.use({ storageState: storageStateFor("owner") });

  test("Reports lists the three new reports, each opening its own screen", async ({ page }) => {
    await page.goto("/reports");
    const list = page.locator('[data-slot="reports-list"]');
    for (const [name, path] of [
      ["People", "/reports/people"],
      ["Stage durations", "/reports/stages"],
      ["Client work", "/reports/client-work"],
    ] as const) {
      await expect(list.getByRole("link", { name: new RegExp(`^${name}`) })).toHaveAttribute(
        "href",
        path,
      );
    }
    await hydrated(page);
    await list.getByRole("link", { name: /^People/ }).click();
    await expect(page).toHaveURL(/\/reports\/people$/);
    await expect(pageHeader(page).getByRole("heading", { name: "People" })).toBeVisible();
  });

  test("People: opens on the month with each employee's attendance; the week has none; cards by name", async ({
    page,
  }) => {
    await page.goto("/reports/people?period=week");
    const report = page.locator('[data-slot="people-report"]');
    await expect(report.getByRole("heading", { name: "Tasks by person" })).toBeVisible();
    await expect(report.getByRole("heading", { name: "Late and overdue tasks" })).toBeVisible();
    await expect(report.locator('[data-slot="person-attendance"]')).toHaveCount(0);

    await page.goto("/reports/people");
    await expect(page.locator('[data-slot="report-period"] [aria-current="page"]')).toHaveText(
      "Month",
    );
    const employees = page.locator('[data-slot="people-block"][data-engagement="permanent"]');
    await expect(employees).toBeVisible();
    const cards = employees.locator('[data-slot="person-card"]');
    if ((await cards.count()) > 0) {
      await expect(cards.first().locator('[data-slot="person-attendance"]')).toContainText(
        "Days worked",
      );
      const names = await cards.locator("h3").allInnerTexts();
      expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
    }
  });

  test("Stage durations and Client work open on their sections", async ({ page }) => {
    await page.goto("/reports/stages?period=month");
    await expect(page.getByRole("heading", { name: "Every project" })).toBeVisible();
    await page.goto("/reports/client-work?period=month");
    await expect(page.getByRole("heading", { name: "Totals" })).toBeVisible();
    await expect(page.locator('[data-slot="client-work-card"]').first()).toContainText(
      "All clients",
    );
  });

  test("a custom range keeps its own report's address", async ({ page }) => {
    await page.goto("/reports/stages?from=2026-10-01&to=2026-10-31");
    await expect(page.locator('[data-slot="custom-range"]')).toBeVisible();
    await expect(page.getByLabel("From")).toHaveValue("2026-10-01");
    await expect(page.getByLabel("To")).toHaveValue("2026-10-31");
  });
});

for (const role of ["admin", "staff"] as const) {
  test.describe(`the Owner's reports, as ${role === "staff" ? "Crew" : "an Admin"}`, () => {
    test.use({ storageState: storageStateFor(role) });

    test("are not theirs to open", async ({ page }) => {
      for (const path of ["/reports/people", "/reports/stages", "/reports/client-work"]) {
        await page.goto(path);
        await expect(page).toHaveURL(/\/forbidden(\?|$)/);
      }
    });
  });
}
