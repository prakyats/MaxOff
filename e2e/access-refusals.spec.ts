import { istDayStart, systemClock, todayIST, toISTDate } from "../src/core/time";

import { expect, test } from "./fixtures";
import {
  hydrated,
  memberIdOf,
  serviceDelete,
  serviceInsert,
  serviceRest,
  serviceSelect,
  storageStateFor,
  USERS,
} from "./helpers";

/**
 * v7.5 Q6 (owner 2026-11-26): a refusal is counted against the member it refuses, and the next
 * morning the Owner gets one note about anyone refused more than 20 times the day before
 * (migration v75_access_refusals; every path is in pgTAP 176). Here, the real app: a Crew
 * member's bounce to /forbidden counts, and the morning job's note reaches the Owner's Alerts and
 * opens that person's profile. Laptop only: the count and the note are the same on a phone, and
 * the Owner is one person for every project.
 */
test.describe.configure({ mode: "serial" });
test.skip(({ isMobile }) => Boolean(isMobile), "one Owner for every project: run once");

type Row = { refusals: number };
const today = () => todayIST();
const yesterday = () => toISTDate(new Date(istDayStart(todayIST()).getTime() - 12 * 3600 * 1000));

async function countFor(memberId: string, day: string): Promise<number> {
  const rows = await serviceSelect<Row>(
    `access_refusals?member_id=eq.${memberId}&day=eq.${day}&select=refusals`,
  );
  return rows[0]?.refusals ?? 0;
}

test.describe("a refusal is counted", () => {
  test.use({ storageState: storageStateFor("staff") });

  test("each bounce to No access counts once against the Crew member", async ({ page }) => {
    const staff = await memberIdOf(USERS.staff.email);
    const before = await countFor(staff, today());
    for (let i = 0; i < 2; i++) {
      // Clients are for the Owner and Admins.
      await page.goto("/clients");
      await expect(page).toHaveURL(/\/forbidden(\?|$)/);
    }
    // Other specs may refuse the same person meanwhile: at least these two, never fewer.
    await expect.poll(() => countFor(staff, today())).toBeGreaterThanOrEqual(before + 2);
  });
});

test.describe("the Owner's morning note", () => {
  test.use({ storageState: storageStateFor("owner") });

  test.afterAll(async () => {
    const staff = await memberIdOf(USERS.staff.email);
    await serviceDelete(`access_refusals?member_id=eq.${staff}&day=eq.${yesterday()}`);
    await serviceDelete(`notifications?kind=eq.access_refusals`);
  });

  test("more than 20 yesterday: one note that opens their profile", async ({ page }) => {
    const staff = await memberIdOf(USERS.staff.email);
    const [member] = await serviceSelect<{ org_id: string; full_name: string }>(
      `members?id=eq.${staff}&select=org_id,full_name`,
    );
    await serviceDelete(`access_refusals?day=eq.${yesterday()}`);
    await serviceDelete(`notifications?kind=eq.access_refusals`);
    await serviceInsert("access_refusals", {
      member_id: staff,
      org_id: member!.org_id,
      day: yesterday(),
      refusals: 21,
    });
    // The 08:11 IST job, run now (it reads the IST day before the moment it is given).
    const run = await serviceRest("rpc/access_refusals_daily", {
      method: "POST",
      body: JSON.stringify({ p_now: systemClock().toISOString() }),
    });
    expect(run.ok, await run.text()).toBe(true);

    await page.goto("/notifications");
    await hydrated(page);
    const title = `${member!.full_name} hit "No access" 21 times yesterday`;
    const row = page.locator('[data-slot="notification-row"]', { hasText: title });
    await expect(row).toHaveCount(1);
    await expect(row).toContainText("An old link or bookmark can do this");
    await row.click();
    await expect(page).toHaveURL(new RegExp(`/people/${staff}$`));
  });
});
