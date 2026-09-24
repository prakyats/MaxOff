import { expect, test } from "@playwright/test";

import { addISTDays, todayIST } from "../src/core/time";

import {
  resetAttendanceAndLeave,
  rpcAs,
  serviceInsert,
  serviceSelect,
  storageStateFor,
} from "./helpers";

/**
 * "Approve all N" (task 2.4, WORKFLOWS §1 "Settled in 2.4"): a confirmation with the count, no
 * Undo, only the ids on screen, one call per row, and a clash reported on its own row, which
 * stays. Approve all acts on **every** row of a group, other specs' rows included, so this file
 * runs in its own project (`owner-bulk`) after `desktop`, `mobile` and `mobile-lg` have finished.
 */

const PASSWORD = "review-local-password";
const A = { id: "20000000-0000-4000-8000-000000000027", email: "review-bulk-a@maxoff.local" };
const B = { id: "20000000-0000-4000-8000-000000000028", email: "review-bulk-b@maxoff.local" };
const inDays = (n: number) => addISTDays(todayIST(), n);

test.use({ storageState: storageStateFor("owner") });
test.describe.configure({ mode: "serial" });

let requestA = "";
let clashing = "";

test.beforeAll(async () => {
  for (const person of [A, B]) {
    await resetAttendanceAndLeave(person.id);
    await rpcAs(person.email, PASSWORD, "attendance_touch", {});
    await rpcAs(person.email, PASSWORD, "attendance_submit", { choice: "present" });
  }
  requestA = await rpcAs<string>(A.email, PASSWORD, "leave_submit", {
    type: "leave",
    start_date: inDays(30),
    end_date: inDays(30),
  });
  // B asked for a day that the Owner has since covered with leave of their own: approving it
  // is CONFLICT (WORKFLOWS §2). No flow reaches this any more, so it is arranged directly.
  await serviceInsert("leave_requests", {
    member_id: B.id,
    type: "leave",
    start_date: inDays(31),
    end_date: inDays(31),
    state: "approved",
    source: "owner",
    decided_by: (await serviceSelect<{ id: string }>("members?role=eq.owner&select=id"))[0]?.id,
    decided_at: `${todayIST()}T00:00:00+05:30`,
  });
  clashing = (
    await serviceInsert<{ id: string }>("leave_requests", {
      member_id: B.id,
      type: "leave",
      start_date: inDays(31),
      end_date: inDays(31),
      state: "submitted",
      source: "form",
    })
  ).id;
});

test("Approve all days: confirmed with the count, every day approved", async ({ page }) => {
  await page.goto("/approvals");
  const days = page.locator('[data-slot="approval-group"][data-group="attendance"]');
  await days.getByRole("button", { name: /^Approve all \d+$/ }).click();
  const confirm = page.getByRole("alertdialog");
  await expect(confirm).toContainText(/Approve all \d+ days\?/);
  await expect(confirm).toContainText("no undo");
  await confirm.getByRole("button", { name: /^Approve \d+$/ }).click();
  await expect(confirm).toBeHidden();
  // Other specs' days are approved too; any of theirs that failed would add "· N need review".
  await expect(page.getByText(/^\d+ approved/)).toBeVisible();

  for (const person of [A, B]) {
    const [day] = await serviceSelect<{ state: string }>(
      `attendance_days?member_id=eq.${person.id}&work_date=eq.${todayIST()}&select=state`,
    );
    expect(day?.state).toBe("approved");
  }
});

test("Approve all requests: a clash stays on its row with the reason", async ({ page }) => {
  await page.goto("/approvals");
  const leave = page.locator('[data-slot="approval-group"][data-group="leave"]');
  await leave.getByRole("button", { name: /^Approve all \d+$/ }).click();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: /^Approve \d+$/ })
    .click();
  await expect(page.getByText(/^\d+ approved · \d+ needs? review$/)).toBeVisible();

  const stays = leave
    .locator('[data-slot="approval-row"]')
    .filter({ hasText: "Test Review Bulk B" });
  await expect(stays).toHaveAttribute("data-state", "waiting");
  await expect(stays.locator('[data-slot="approval-error"]')).toContainText(
    "already covers these dates",
  );

  const [a] = await serviceSelect<{ state: string }>(
    `leave_requests?id=eq.${requestA}&select=state`,
  );
  const [b] = await serviceSelect<{ state: string }>(
    `leave_requests?id=eq.${clashing}&select=state`,
  );
  expect(a?.state).toBe("approved");
  expect(b?.state).toBe("submitted");
});
