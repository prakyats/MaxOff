import { expect, type Locator, type Page, type TestInfo, test } from "@playwright/test";

// The app's own IST clock (ADR-0008), so "today" here is the database's `app.today_ist()`.
import { addISTDays, todayIST } from "../src/core/time";

import {
  expectBackStack,
  resetAttendanceAndLeave,
  rpcAs,
  runInstalled,
  serviceInsert,
  serviceSelect,
  storageStateFor,
  USERS,
} from "./helpers";

/**
 * Owner review (task 2.4, WORKFLOWS §1/§2 "Settled in 2.4"): the Attendance and Leave groups of
 * Approvals (approve with Undo, which is a delayed send; Review → Correct or Reject with a
 * reason the member reads), the badge, today's card and people board, and a person's history
 * with Edit and Cancel. On a phone, the back order of every layer (ARCHITECTURE §14.2).
 *
 * Runs in `desktop`, `mobile` (375px) and `mobile-lg` (430px). Each project owns four seeded
 * people (`review-{day,fix,leave,absent}-<project>@…`) and arranges them itself, so it re-runs without
 * `pnpm db:reset`. Approve all is `owner-bulk.spec.ts`, which runs after every other project: it
 * acts on every row on screen, and other specs' rows are on the same screen.
 */

const PASSWORD = "review-local-password";
const IDS: Record<string, { day: string; fix: string; leave: string; absent: string }> = {
  desktop: {
    day: "20000000-0000-4000-8000-000000000018",
    fix: "20000000-0000-4000-8000-000000000019",
    leave: "20000000-0000-4000-8000-000000000020",
    absent: "20000000-0000-4000-8000-000000000029",
  },
  mobile: {
    day: "20000000-0000-4000-8000-000000000021",
    fix: "20000000-0000-4000-8000-000000000022",
    leave: "20000000-0000-4000-8000-000000000023",
    absent: "20000000-0000-4000-8000-000000000030",
  },
  "mobile-lg": {
    day: "20000000-0000-4000-8000-000000000024",
    fix: "20000000-0000-4000-8000-000000000025",
    leave: "20000000-0000-4000-8000-000000000026",
    absent: "20000000-0000-4000-8000-000000000031",
  },
};

type Who = "day" | "fix" | "leave" | "absent";
const ids = (info: TestInfo) => IDS[info.project.name] as (typeof IDS)["desktop"];
const email = (who: Who, info: TestInfo) => `review-${who}-${info.project.name}@maxoff.local`;
const NAMES: Record<Who, string> = {
  day: "Review Day",
  fix: "Review Fix",
  leave: "Review Leave",
  absent: "Review Absent",
};
const nameOf = (who: Who, info: TestInfo) => `Test ${NAMES[who]} (${info.project.name})`;
const isPhone = (info: TestInfo) => info.project.name.startsWith("mobile");
const inDays = (n: number) => addISTDays(todayIST(), n);

test.use({ storageState: storageStateFor("owner") });
test.describe.configure({ mode: "serial" });

/** Opens today's day for the person and answers the gate with `choice`. */
async function submitDay(who: Who, info: TestInfo, choice = "present") {
  await rpcAs(email(who, info), PASSWORD, "attendance_touch", {});
  await rpcAs(email(who, info), PASSWORD, "attendance_submit", { choice });
}

async function dayOf(memberId: string) {
  const [day] = await serviceSelect<{
    state: string;
    final_status: string | null;
    decision_reason: string | null;
  }>(
    `attendance_days?member_id=eq.${memberId}&work_date=eq.${todayIST()}&select=state,final_status,decision_reason`,
  );
  return day;
}

async function requestOf(id: string) {
  const [request] = await serviceSelect<{ state: string; decision_reason: string | null }>(
    `leave_requests?id=eq.${id}&select=state,decision_reason`,
  );
  return request;
}

let waitingLeaveId = "";
let approvedLeaveId = "";
let proposedDayId = "";

test.beforeAll(async ({}, info) => {
  const people = ids(info);
  for (const id of Object.values(people)) await resetAttendanceAndLeave(id);
  await submitDay("day", info);
  await submitDay("fix", info);
  // The 23:59 job's proposed absence for yesterday (2.5), as `app.absent_check()` writes it: a
  // waiting day with no choice and no login. The job itself is pgTAP's (13, 14); the Owner's
  // path through it is this spec's.
  proposedDayId = (
    await serviceInsert<{ id: string }>("attendance_days", {
      member_id: people.absent,
      work_date: inDays(-1),
      state: "pending_review",
      final_status: "absent",
      proposed_by_system: true,
      is_day_off: false,
    })
  ).id;
  await serviceInsert("attendance_events", {
    attendance_day_id: proposedDayId,
    action: "proposed_absent",
    to_status: "absent",
  });
  // One request waiting for the Owner, and one already approved for the person's history.
  waitingLeaveId = await rpcAs<string>(email("leave", info), PASSWORD, "leave_submit", {
    type: "leave",
    start_date: inDays(10),
    end_date: inDays(11),
    reason: "Family function",
  });
  approvedLeaveId = await rpcAs<string>(email("leave", info), PASSWORD, "leave_submit", {
    type: "leave",
    start_date: inDays(20),
    end_date: inDays(21),
  });
  await rpcAs(USERS.owner.email, USERS.owner.password, "leave_decide", {
    request_id: approvedLeaveId,
    decision: "approve",
  });
});

const group = (page: Page, id: "attendance" | "leave") =>
  page.locator(`[data-slot="approval-group"][data-group="${id}"]`);
const approvalRow = (page: Page, id: "attendance" | "leave", text: string) =>
  group(page, id).locator('[data-slot="approval-row"]').filter({ hasText: text });

test("the Approvals badge counts what waits for the Owner", async ({ page }, info) => {
  await page.goto("/today");
  const nav = isPhone(info)
    ? page.locator('[data-slot="bottom-nav"] [data-nav="approvals"]')
    : page.locator('[data-slot="sidebar"] [data-nav="approvals"]');
  const badge = nav.locator('[data-slot="nav-badge"]');
  await expect(badge).toBeVisible();
  // At least this project's two days and one request; other specs may add more.
  const count = Number((await badge.innerText()).match(/\d+/)?.[0]);
  expect(count).toBeGreaterThanOrEqual(3);
});

test("installed: back closes the Approve all confirmation and nothing is approved", async ({
  page,
}, info) => {
  test.skip(!isPhone(info), "the installed app is a phone");
  await runInstalled(page);
  await page.goto("/today");
  await page.goto("/approvals");
  // This project's two days are waiting, so the group offers Approve all.
  await group(page, "attendance")
    .getByRole("button", { name: /^Approve all \d+$/ })
    .click();
  const confirm = page.getByRole("alertdialog");
  await expect(confirm).toContainText(/Approve all \d+ days\?/);

  await expectBackStack(page, [{ closes: confirm, url: /\/approvals$/ }]);
  expect((await dayOf(ids(info).day))?.state).toBe("pending_review");
  expect((await dayOf(ids(info).fix))?.state).toBe("pending_review");
});

test("approve is a delayed send: Undo means nothing was recorded", async ({ page }, info) => {
  await page.goto("/approvals");
  const row = approvalRow(page, "attendance", nameOf("day", info));
  await expect(row).toHaveAttribute("data-state", "waiting");

  await row.getByRole("button", { name: "Approve" }).click();
  await expect(row).toHaveAttribute("data-state", "approved");
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(row).toHaveAttribute("data-state", "waiting");
  // Past the six seconds: still waiting in the database, and no history row was written.
  await page.waitForTimeout(6_500);
  expect((await dayOf(ids(info).day))?.state).toBe("pending_review");

  // Approve again, then the app goes to the background: the send goes at once.
  await row.getByRole("button", { name: "Approve" }).click();
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect
    .poll(async () => (await dayOf(ids(info).day))?.state, { timeout: 4_000 })
    .toBe("approved");
  // Sent: the toast no longer offers an Undo that would do nothing.
  await expect(page.getByRole("button", { name: "Undo" })).toBeHidden();
});

test("a send that fails puts the row back with its message; nothing disappears", async ({
  page,
}, info) => {
  await page.route("**/api/approvals/approve", (route) => route.abort("internetdisconnected"));
  await page.goto("/approvals");
  const row = approvalRow(page, "leave", nameOf("leave", info));
  await row.getByRole("button", { name: "Approve" }).click();
  await expect(row).toHaveAttribute("data-state", "approved");
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(row).toHaveAttribute("data-state", "waiting");
  await expect(row.locator('[data-slot="approval-error"]')).toContainText("not approved");
  expect((await requestOf(waitingLeaveId))?.state).toBe("submitted");
});

test("installed: back closes the correct dialog, then the review sheet, then the screen", async ({
  page,
}, info) => {
  test.skip(!isPhone(info), "the installed app is a phone");
  await runInstalled(page);
  await page.goto("/today");
  await page.locator('[data-slot="bottom-nav"] [data-nav="approvals"]').click();
  await expect(page).toHaveURL(/\/approvals$/);
  await approvalRow(page, "attendance", nameOf("fix", info))
    .getByRole("button", { name: "Review" })
    .click();
  const sheet = page.locator('[data-slot="review-sheet"]');
  await expect(sheet).toBeVisible();
  await sheet.getByRole("button", { name: "Correct…" }).click();
  const dialog = page.locator('[data-slot="dialog-content"]');
  await expect(dialog).toBeVisible();
  // The sheet stays under the dialog, so back closes them one at a time.
  await expect(sheet).toBeVisible();

  await expectBackStack(page, [
    { closes: dialog, url: /\/approvals$/ },
    { closes: sheet, url: /\/approvals$/ },
    { url: /\/today$/ },
  ]);
});

test("Review → Correct asks for a reason the person will read", async ({ page }, info) => {
  await page.goto("/approvals");
  await approvalRow(page, "attendance", nameOf("fix", info))
    .getByRole("button", { name: "Review" })
    .click();
  const sheet = page.locator('[data-slot="review-sheet"]');
  await expect(sheet).toContainText("chose");
  await sheet.getByRole("button", { name: "Correct…" }).click();

  const dialog = page.locator('[data-slot="dialog-content"]');
  await dialog.getByRole("combobox", { name: "The day was" }).click();
  await page.getByRole("option", { name: "Half day", exact: true }).click();
  await expect(dialog).toContainText(`${nameOf("fix", info)} will see this reason.`);
  await dialog.getByRole("button", { name: "Save correction" }).click();
  await expect(dialog.locator('[data-slot="field-error"]')).toBeVisible();

  await dialog.getByLabel("Reason").fill("Left at two for the shoot");
  await dialog.getByRole("button", { name: "Save correction" }).click();
  await expect(dialog).toBeHidden();
  await expect(sheet).toBeHidden();
  await expect
    .poll(async () => await dayOf(ids(info).fix))
    .toMatchObject({
      state: "corrected",
      final_status: "half_day",
      decision_reason: "Left at two for the shoot",
    });
});

test("Leave: Review → Reject with a reason", async ({ page }, info) => {
  await page.goto("/approvals");
  const row = approvalRow(page, "leave", nameOf("leave", info));
  await expect(row).toContainText("Leave · 2 days");
  await row.getByRole("button", { name: "Review" }).click();
  const sheet = page.locator('[data-slot="review-sheet"]');
  await expect(sheet).toContainText("Family function");
  await sheet.getByRole("button", { name: "Reject…" }).click();
  const dialog = page.locator('[data-slot="dialog-content"]');
  await expect(dialog).toContainText(`${nameOf("leave", info)} will see this reason.`);
  await dialog.getByLabel("Reason").fill("Client shoot that week");
  await dialog.getByRole("button", { name: "Reject" }).click();
  await expect(dialog).toBeHidden();
  await expect
    .poll(async () => await requestOf(waitingLeaveId))
    .toEqual({ state: "rejected", decision_reason: "Client shoot that week" });
});

/**
 * A request's row: a table row on desktop, a card on a phone. "Approved" is also inside "Not
 * approved" (text filters ignore case), so that state is matched without the other.
 */
function requestRow(page: Page, info: TestInfo, text: string): Locator {
  const rows = isPhone(info) ? page.locator('[data-slot="data-card"]') : page.locator("tbody tr");
  const matching = rows.filter({ hasText: text });
  return (text === "Approved" ? matching.filter({ hasNotText: "Not approved" }) : matching).first();
}

async function requestAction(page: Page, info: TestInfo, text: string, action: string) {
  const row = requestRow(page, info, text);
  if (isPhone(info)) {
    await row.click();
    await page.locator('[data-slot="detail-sheet"]').getByRole("button", { name: action }).click();
  } else {
    await row.getByRole("button", { name: action }).click();
  }
}

test("Today: the card and the board, and a person's history with Edit and Cancel", async ({
  page,
}, info) => {
  await page.goto("/today");
  const card = page.locator('[data-slot="today-attendance-card"]');
  await expect(card).toBeVisible();
  await expect(card.locator('[data-slot="today-count"]')).toHaveCount(4);
  await expect(card).toHaveAttribute("href", "/approvals");

  // Approved this morning, so on the board as present; the board opens the person.
  const board = page.locator('[data-slot="people-board"]');
  await expect(
    board.locator('[data-slot="board-row"]').filter({ hasText: nameOf("day", info) }),
  ).toContainText("Present");
  await board
    .locator('[data-slot="board-row"]')
    .filter({ hasText: nameOf("leave", info) })
    .click();
  await expect(page).toHaveURL(new RegExp(`/people/${ids(info).leave}$`));
  await expect(page.getByRole("heading", { name: nameOf("leave", info) })).toBeVisible();

  // The rejected request carries the Owner's reason, in the Owner's words.
  await expect(requestRow(page, info, "Not approved")).toBeVisible();

  // Edit the approved leave: one more day.
  await requestAction(page, info, "Approved", "Edit");
  const edit = page.locator('[data-slot="dialog-content"]');
  await edit.getByLabel("Last day").fill(inDays(22));
  await edit.getByLabel("Reason (optional)").fill("Extended for travel");
  await edit.getByRole("button", { name: "Save leave" }).click();
  await expect(edit).toBeHidden();
  await expect
    .poll(async () =>
      serviceSelect<{ state: string; source: string; end_date: string }>(
        `leave_requests?member_id=eq.${ids(info).leave}&state=eq.approved&select=state,source,end_date`,
      ),
    )
    .toEqual([{ state: "approved", source: "owner", end_date: inDays(22) }]);

  // Cancel it, with a reason.
  await page.reload();
  await requestAction(page, info, "Approved", "Cancel leave");
  const cancel = page.locator('[data-slot="dialog-content"]');
  await expect(cancel).toContainText(`${nameOf("leave", info)} will see this reason.`);
  await cancel.getByLabel("Reason").fill("Trip called off");
  await cancel.getByRole("button", { name: "Cancel leave" }).click();
  await expect(cancel).toBeHidden();
  await expect
    .poll(async () =>
      serviceSelect<{ state: string }>(
        `leave_requests?member_id=eq.${ids(info).leave}&state=eq.approved&select=state`,
      ),
    )
    .toEqual([]);

  // The attendance tab shows the person's days in the Owner's words.
  await page.getByRole("link", { name: "Attendance", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/people/${ids(info).leave}/attendance$`));
});

test("a proposed absence from the nightly job: reviewed, approved, and read on the history", async ({
  page,
}, info) => {
  await page.goto("/approvals");
  const row = approvalRow(page, "attendance", nameOf("absent", info));
  await expect(row).toHaveAttribute("data-state", "waiting");
  await expect(row).toContainText("Absent (proposed)");

  // The review sheet says what the system proposed and that nobody signed in.
  await row.getByRole("button", { name: "Review" }).click();
  const sheet = page.locator('[data-slot="review-sheet"]');
  await expect(sheet).toContainText("Proposed");
  await expect(sheet).toContainText("Absent (proposed)");
  await expect(sheet).toContainText("Not recorded");
  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();

  // Approve through the existing path; the app goes to the background so the send goes at once.
  await row.getByRole("button", { name: "Approve" }).click();
  await expect(row).toHaveAttribute("data-state", "approved");
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect
    .poll(
      async () =>
        (
          await serviceSelect<{ state: string; final_status: string | null }>(
            `attendance_days?id=eq.${proposedDayId}&select=state,final_status`,
          )
        )[0],
      { timeout: 4_000 },
    )
    .toMatchObject({ state: "approved", final_status: "absent" });

  // The person's history for that month reads the outcome and its standing.
  await page.goto(`/people/${ids(info).absent}/attendance?month=${inDays(-1).slice(0, 7)}`);
  const day = isPhone(info)
    ? page.locator('[data-slot="data-card"]').first()
    : page.locator("tbody tr").first();
  await expect(day).toContainText("Absent");
  await expect(day).toContainText("Approved");
});

test("a corrected day reads in the Owner's words on the person's history", async ({
  page,
}, info) => {
  await page.goto(`/people/${ids(info).fix}/attendance`);
  const day = isPhone(info)
    ? page.locator('[data-slot="data-card"]').first()
    : page.locator("tbody tr").first();
  await expect(day).toContainText("Changed by you");
});

test("installed: board → person → tabs and months → one back lands on Today", async ({
  page,
}, info) => {
  test.skip(!isPhone(info), "the installed app is a phone");
  await runInstalled(page);
  await page.goto("/today");
  await page
    .locator('[data-slot="board-row"]')
    .filter({ hasText: nameOf("fix", info) })
    .click();
  await expect(page).toHaveURL(new RegExp(`/people/${ids(info).fix}$`));
  await page.getByRole("link", { name: "Attendance", exact: true }).click();
  await expect(page).toHaveURL(/\/attendance$/);
  await page.getByRole("link", { name: "Previous month" }).click();
  await expect(page).toHaveURL(/\?month=/);
  await page.getByRole("link", { name: "Leave requests", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/people/${ids(info).fix}$`));

  await expectBackStack(page, [{ url: /\/today$/ }]);
});

test("installed: the on-screen back goes back after a drill-down, adding nothing", async ({
  page,
}, info) => {
  test.skip(!isPhone(info), "the installed app is a phone");
  await runInstalled(page);
  await page.goto("/today");
  await page.goto("/people");
  // People → the person's card: a real drill-down (the card opens their page since 2.9).
  // The seeded Staff member is among the first ten cards on a phone.
  await page
    .locator('[data-slot="data-card"]', { hasText: "Local Staff" })
    .locator('[data-slot="data-card-link"]')
    .click();
  await expect(page).toHaveURL(/\/people\/[0-9a-f-]{36}$/);
  await page.getByRole("link", { name: "Back to People" }).click();
  await expect(page).toHaveURL(/\/people$/);
  await expect(page.locator('[data-slot="detail-sheet"]')).toBeHidden();
  // It went back rather than pushing People again: the next back leaves People for Today.
  await expectBackStack(page, [{ url: /\/today$/ }]);
});

test("installed: opened directly, the on-screen back replaces it with People", async ({
  page,
}, info) => {
  test.skip(!isPhone(info), "the installed app is a phone");
  await runInstalled(page);
  // A deep link: the person is the first page of this window.
  await page.goto(`/people/${ids(info).fix}/attendance`);
  await page.getByRole("link", { name: "Back to People" }).click();
  await expect(page).toHaveURL(/\/people$/);
  // Replaced, not pushed: back never returns to the person (it leaves the window's history,
  // which starts with Playwright's own blank page or nothing at all).
  await expectBackStack(page, [{ url: /^(?!.*\/people\/)/ }]);
});

test.describe("who sees what", () => {
  test.describe("an Admin", () => {
    test.use({ storageState: storageStateFor("admin") });
    test("gets no attendance or leave groups and no person history", async ({ page }, info) => {
      await page.goto("/approvals");
      await expect(page.locator('[data-slot="approval-group"]')).toHaveCount(0);
      await expect(page.getByText("Approvals is filled in task")).toBeVisible();
      await page.goto(`/people/${ids(info).day}`);
      await expect(page).toHaveURL(/\/forbidden/);
    });
  });

  test.describe("Staff", () => {
    test.use({ storageState: storageStateFor("staff") });
    test("cannot open Approvals", async ({ page }) => {
      await page.goto("/approvals");
      await expect(page).toHaveURL(/\/forbidden/);
    });
  });
});
