import { expect, test } from "./fixtures";

import {
  hydrated,
  memberIdOf,
  pageHeader,
  removeClientFixture,
  rpcAs,
  serviceInsert,
  serviceSelect,
  serviceUpdate,
  storageStateFor,
  USERS,
} from "./helpers";
import { todayIST } from "../src/core/time";

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

  test("a client's name opens the client at its top, from anywhere down the report (owner walk, step 8)", async ({
    page,
  }, info) => {
    const name = `Report scroll client ${info.project.name}`;
    await removeClientFixture(name);
    const [org] = await serviceSelect<{ id: string }>("organizations?select=id&limit=1");
    const client = await serviceInsert<{ id: string }>("clients", {
      org_id: org?.id,
      name,
      admin_id: await memberIdOf(USERS.admin.email),
    });
    await rpcAs(USERS.owner.email, USERS.owner.password, "client_activate", {
      client_id: client.id,
    });
    const project = await rpcAs<string>(USERS.admin.email, USERS.admin.password, "project_create", {
      client_id: client.id,
      name: "Report scroll project",
      recurrence: "monthly",
      stages: [],
      items: ["Report scroll reel"],
    });
    await serviceUpdate(`project_items?project_id=eq.${project}`, { planned_date: todayIST() });
    try {
      await page.goto("/reports/client-work?period=month");
      await hydrated(page);
      const link = page.locator(`[data-client="${client.id}"] a[href="/clients/${client.id}"]`);
      await expect(link).toBeVisible();
      // A report long enough to tap a client far down it (the walk's phone had many clients).
      await page.evaluate(() => {
        const main = document.getElementById("main");
        if (main) main.style.paddingBottom = "2000px";
      });
      await page.evaluate(() => window.scrollTo(0, 600));
      await link.click();
      await expect(page).toHaveURL(new RegExp(`/clients/${client.id}$`));
      await expect(pageHeader(page).getByRole("heading", { name })).toBeVisible();
      await expect.poll(() => page.evaluate(() => Math.round(window.scrollY))).toBe(0);
    } finally {
      await removeClientFixture(name);
    }
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
    // `:visible`: while the page streams, its loading screen's switch (which shows the period
    // from the address too, walk step 9) is still in the document beside it.
    await expect(
      page.locator('[data-slot="report-period"]:visible [aria-current="page"]'),
    ).toHaveText("Month");
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
    await expect(page.getByLabel("From", { exact: true })).toHaveValue("2026-10-01");
    await expect(page.getByLabel("To", { exact: true })).toHaveValue("2026-10-31");
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
