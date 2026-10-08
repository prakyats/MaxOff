import type { TestInfo } from "@playwright/test";

import { expect, test } from "./fixtures";
import {
  expectBackStack,
  hydrated,
  pageHeader,
  runInstalled,
  serviceDelete,
  serviceInsert,
  serviceSelect,
  storageStateFor,
} from "./helpers";
import { addISTDays, istInstant, todayIST } from "../src/core/time";

/**
 * The end-of-day report (6.5; Kickoff 6 decisions 16–18; WORKFLOWS §8a): Reports → End of day
 * lists today (live, so far) and yesterday (live until the End-day cutoff, then its saved row),
 * then the saved history; a day's report shows attendance, decisions, tasks, approvals and
 * tomorrow's events, never money. The job that saves a day runs in pg_cron, not in this stack
 * (pgTAP 64 proves it), so the saved path is checked with a row the spec writes itself. The Owner
 * only (`reports.all`); on an installed phone the list is a drill-down from Reports and a report
 * from the list (ARCHITECTURE §14.2 b, k), checked at 375 and 430px.
 */

const isPhone = (info: TestInfo) => info.project.name !== "desktop";

/** A past date of this project's own, so the parallel projects never write the same row. */
function savedDate(info: TestInfo): string {
  const offset = { desktop: 20, mobile: 21, "mobile-lg": 22 }[info.project.name] ?? 23;
  return addISTDays(todayIST(), -offset);
}

const KIRAN = "10000000-0000-4000-8000-000000000003";

/** A saved report as the job writes it: counts, names, times and titles, no amount anywhere. */
function savedReport(date: string) {
  return {
    date,
    day_off: { holiday: null, weekly_off: false },
    attendance: {
      counts: {
        present: 1,
        on_leave: 0,
        absent: 0,
        proposed_absent: 0,
        waiting: 0,
        end_not_recorded: 1,
        overtime: 0,
      },
      people: [
        {
          member_id: KIRAN,
          name: "Local Staff",
          status: "present",
          waiting: false,
          proposed: false,
          started_at: istInstant(date, "09:30"),
          ended_at: null,
          end_not_recorded: true,
          overtime: false,
          overtime_reason: null,
        },
      ],
    },
    decisions: {
      attendance: 1,
      leave: { approved: 0, rejected: 0 },
      comp_leave: { granted: 0, revoked: 0, reviewed: 0 },
      expense_claims: 2,
    },
    tasks: {
      completed: { count: 0, freelance: 0, more: 0, items: [] },
      handed_in: { count: 0, freelance: 0, more: 0, items: [] },
      overdue: { count: 0, freelance: 0, more: 0, items: [] },
      cancelled: { count: 0, freelance: 0, more: 0, items: [] },
      created: { count: 0, freelance: 0, more: 0, items: [] },
    },
    approvals: [],
    tomorrow: { date: addISTDays(date, 1), events: [] },
  };
}

async function writeSavedReport(date: string): Promise<void> {
  await serviceDelete(`eod_reports?report_date=eq.${date}`);
  const [org] = await serviceSelect<{ id: string }>("organizations?select=id&limit=1");
  await serviceInsert("eod_reports", {
    org_id: org?.id,
    report_date: date,
    data: savedReport(date),
    generated_at: istInstant(addISTDays(date, 1), "05:00"),
  });
}

test.describe("Reports → End of day, as the Owner", () => {
  test.use({ storageState: storageStateFor("owner") });

  test("lists today live and yesterday, opens today's report live, and a saved day as saved", async ({
    page,
  }, info) => {
    const date = savedDate(info);
    await writeSavedReport(date);
    try {
      await page.goto("/reports");
      await page.locator('[data-slot="report-link"]').filter({ hasText: "End of day" }).click();
      await expect(page).toHaveURL(/\/reports\/end-of-day$/);
      await expect(pageHeader(page)).toContainText("End of day");
      const today = page.locator(`[data-slot="eod-list-row"][data-date="${todayIST()}"]`);
      await expect(today).toContainText("Today");
      await expect(today).toContainText("Live");
      const yesterday = page.locator(
        `[data-slot="eod-list-row"][data-date="${addISTDays(todayIST(), -1)}"]`,
      );
      await expect(yesterday).toContainText("Yesterday");
      await expect(yesterday).toHaveAttribute("data-state", /yesterday_live|saved|missing/);
      const saved = page.locator(`[data-slot="eod-list-row"][data-date="${date}"]`);
      await expect(saved).toContainText("Saved");

      // Today, live: the note, the attendance line, no money anywhere.
      await today.click();
      await expect(page).toHaveURL(new RegExp(`/reports/end-of-day/${todayIST()}$`));
      await expect(page.locator('[data-slot="eod-date"]')).toContainText("Today");
      await expect(page.locator('[data-slot="eod-live-note"]')).toContainText("Live");
      await expect(
        page.locator('[data-slot="eod-attendance-line"], [data-slot="eod-quiet"]').first(),
      ).toBeVisible();
      expect(await page.locator("main").textContent()).not.toMatch(/₹|\d+\.\d{2}\b/);

      // A saved day shows its row as written: never recomputed, never money.
      await page.goto(`/reports/end-of-day/${date}`);
      await expect(page.locator('[data-slot="eod-live-note"]')).toHaveCount(0);
      await expect(page.locator('[data-slot="eod-saved-note"]')).toContainText("Saved");
      await expect(page.locator('[data-slot="eod-attendance-line"]')).toContainText(
        "1 present · 0 on leave · 0 absent · 1 end not recorded",
      );
      const person = page.locator('[data-slot="eod-person"]').filter({ hasText: "Local Staff" });
      await expect(person).toContainText("Started 9:30 am");
      await expect(person).toContainText("End of day not recorded");
      await expect(page.locator('[data-slot="eod-decision-lines"]')).toContainText(
        "2 expense claims decided",
      );
      expect(await page.locator("main").textContent()).not.toMatch(/₹|\d+\.\d{2}\b/);

      // A day that has not come.
      await page.goto(`/reports/end-of-day/${addISTDays(todayIST(), 3)}`);
      await expect(page.getByText("That day hasn't come yet")).toBeVisible();
    } finally {
      await serviceDelete(`eod_reports?report_date=eq.${date}`);
    }
  });

  test("installed: Reports → End of day → a day's report, one back each", async ({
    page,
  }, info) => {
    test.skip(!isPhone(info), "the installed app is a phone");
    await runInstalled(page);
    await page.goto("/reports");
    await hydrated(page);
    await page.locator('[data-slot="report-link"]').filter({ hasText: "End of day" }).click();
    await expect(page).toHaveURL(/\/reports\/end-of-day$/);
    await hydrated(page);
    await page.locator(`[data-slot="eod-list-row"][data-date="${todayIST()}"]`).click();
    await expect(page).toHaveURL(new RegExp(`/reports/end-of-day/${todayIST()}$`));
    await hydrated(page);
    await expectBackStack(page, [{ url: /\/reports\/end-of-day$/ }, { url: /\/reports$/ }]);
    // The on-screen back control (§14.2 k) goes back too, adding nothing.
    await page.goto(`/reports/end-of-day/${todayIST()}`);
    await hydrated(page);
    await page.locator('[data-slot="page-back"]:visible').click();
    await expect(page).toHaveURL(/\/reports\/end-of-day$/);
  });
});

for (const role of ["admin", "staff"] as const) {
  test.describe(`Reports → End of day, as ${role === "staff" ? "Crew" : "an Admin"}`, () => {
    test.use({ storageState: storageStateFor(role) });

    test("is not theirs to open", async ({ page }) => {
      await page.goto("/reports/end-of-day");
      await expect(page).toHaveURL(/\/forbidden$/);
      await page.goto(`/reports/end-of-day/${todayIST()}`);
      await expect(page).toHaveURL(/\/forbidden$/);
    });
  });
}
