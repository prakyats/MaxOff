import { type Locator, type Page, type TestInfo } from "@playwright/test";

import { expect, test } from "./fixtures";

import { addISTDays, todayIST } from "../src/core/time";

import {
  expectBackStack,
  memberIdOf,
  resetAttendanceAndLeave,
  runInstalled,
  serviceSelect,
  signIn,
  USERS,
} from "./helpers";

/**
 * Extra work and comp leave (task 3b.2, PRODUCT §4.3a, WORKFLOWS §2 "Settled in 3b.2"): a member
 * notes overtime, the Owner grants comp leave from Approvals → Extra work, the member requests
 * comp leave (offered only with the credit, one date, use-by date shown), the Owner rejects and
 * the credit comes back, then revokes it with a reason the member reads, after which the leave
 * form offers no comp leave. Installed, the note dialog and the Owner's sheet-then-dialog follow
 * the back order (ARCHITECTURE §14.2 a).
 *
 * Runs in `desktop`, `mobile` (375px) and `mobile-lg` (430px), one seeded person per project
 * (`extra-<project>@maxoff.local`), reset at the start so it re-runs without `pnpm db:reset`.
 */

const PASSWORD = "extra-local-password";
const person = (info: TestInfo) => `extra-${info.project.name}@maxoff.local`;
const personName = (info: TestInfo) => `Test Extra Work (${info.project.name})`;
const isPhone = (info: TestInfo) => info.project.name.startsWith("mobile");

/** The last day of this IST month, as "use by d MMM" shows it. */
function monthEnd(today: string): string {
  const [y, m] = today.split("-").map(Number) as [number, number, number];
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${today.slice(0, 7)}-${String(last).padStart(2, "0")}`;
}

function noteRows(page: Page): Locator {
  return page.locator('[data-slot="extra-work-note"]');
}

async function signInOwner(page: Page): Promise<void> {
  await page.context().clearCookies();
  await signIn(page, USERS.owner.email, USERS.owner.password);
}

test.describe.configure({ mode: "serial" });
test.use({ storageState: { cookies: [], origins: [] } });

test("a note, a grant, a comp leave request, a rejection and a revoke", async ({ page }, info) => {
  const email = person(info);
  const memberId = await memberIdOf(email);
  await resetAttendanceAndLeave(memberId);
  const today = todayIST();

  // The member notes overtime from the Extra work tab.
  await signIn(page, email, PASSWORD);
  await page.goto("/leave/extra-work");
  await expect(page.locator('[data-slot="comp-balance"]')).toHaveText("No comp leave available");
  await expect(page.getByText("No extra work noted yet")).toBeVisible();
  await page.getByRole("button", { name: "Add note" }).click();
  const dialog = page.locator('[data-slot="extra-work-note-dialog"]');
  await expect(dialog).toBeVisible();
  // Too short: a field message, nothing sent.
  await dialog.getByLabel("What you worked on").fill("ab");
  await dialog.getByRole("button", { name: "Send note" }).click();
  await expect(dialog.locator('[data-slot="field-error"]')).toContainText("Say what you worked on");
  await dialog.getByLabel("What you worked on").fill("Colour grade for the Sharma wedding");
  await dialog.getByRole("button", { name: "Send note" }).click();
  await expect(dialog).toBeHidden();
  await expect(noteRows(page)).toHaveCount(1);
  await expect(noteRows(page).first()).toContainText("Waiting for the Owner");
  // One note per day and kind.
  await page.getByRole("button", { name: "Add note" }).click();
  await dialog.getByLabel("What you worked on").fill("Another one");
  await dialog.getByRole("button", { name: "Send note" }).click();
  await expect(dialog.locator('[data-slot="form-alert"]')).toContainText("already added a note");
  await dialog.getByRole("button", { name: "Cancel" }).click();

  // The Owner grants a day from Approvals → Extra work (review-only: no Approve button).
  await signInOwner(page);
  await page.goto("/approvals");
  const group = page.locator('[data-slot="approval-group"][data-group="extra-work"]');
  const row = group.locator('[data-slot="approval-row"]').filter({ hasText: personName(info) });
  await expect(row).toContainText("Overtime");
  await expect(row.getByRole("button", { name: "Approve" })).toHaveCount(0);
  await row.getByRole("button", { name: "Review" }).click();
  const sheet = page.locator('[data-slot="review-sheet"]');
  await expect(sheet).toContainText("Colour grade for the Sharma wedding");
  await sheet.getByRole("button", { name: "Decide…" }).click();
  const decide = page.locator('[data-slot="decide-note-dialog"]');
  await expect(decide.getByRole("button", { name: "Grant comp leave" })).toBeDisabled();
  await decide.getByRole("radio", { name: "Grant 1 day of comp leave" }).check();
  await decide.getByLabel("A note for them (optional)").fill("Thanks for the late night");
  await decide.getByRole("button", { name: "Grant comp leave" }).click();
  await expect(decide).toBeHidden();
  await expect(row).toHaveCount(0);

  // The member sees the outcome and the credit, and comp leave appears in the leave form.
  await page.context().clearCookies();
  await signIn(page, email, PASSWORD);
  await page.goto("/leave/extra-work");
  const useBy = monthEnd(today);
  await expect(noteRows(page).first()).toContainText("1 comp leave granted");
  await expect(page.locator('[data-slot="comp-balance"]')).toContainText("1 day of comp leave");
  const creditRow = page.locator('[data-slot="comp-credit"]').first();
  await expect(creditRow).toContainText("Available");
  await expect(creditRow).toContainText("The Owner's note: Thanks for the late night");

  await page.getByRole("button", { name: "Request leave" }).click();
  const form = page.getByRole("dialog", { name: "Request leave" });
  await form.getByLabel("Kind of leave").click();
  await page.getByRole("option", { name: "Comp leave (1 day)" }).click();
  await expect(form).toContainText("1 day of comp leave");
  // On or before the use-by date: the day after the month's end is refused by the form.
  const date = today <= useBy ? today : useBy;
  await form.getByLabel("Date").fill(addISTDays(useBy, 1));
  await form.getByRole("button", { name: "Request leave" }).click();
  await expect(form.locator('[data-slot="field-error"]')).toContainText("use-by date");
  await form.getByLabel("Date").fill(date);
  await form.getByRole("button", { name: "Request leave" }).click();
  await expect(form).toBeHidden();
  await expect(page).toHaveURL(/\/leave\/extra-work$/);
  // Requested: the credit waits on it and the balance is spent.
  await page.reload();
  await expect(page.locator('[data-slot="comp-balance"]')).toHaveText("No comp leave available");
  await expect(creditRow).toContainText("Waiting on a request");
  await page.getByRole("link", { name: "Leave requests", exact: true }).click();
  const requestRow = isPhone(info)
    ? page.locator('[data-slot="data-card"]').filter({ hasText: "Comp leave · 1 day" })
    : page.locator("tbody tr").filter({ hasText: "Comp leave · 1 day" });
  await expect(requestRow).toContainText("Waiting");

  // The Owner rejects: the credit comes back. Then revokes it with a reason.
  await signInOwner(page);
  await page.goto("/approvals");
  const leaveGroup = page.locator('[data-slot="approval-group"][data-group="leave"]');
  const leaveRow = leaveGroup
    .locator('[data-slot="approval-row"]')
    .filter({ hasText: personName(info) });
  await expect(leaveRow).toContainText("Comp leave · 1 day");
  await leaveRow.getByRole("button", { name: "Review" }).click();
  await page.locator('[data-slot="review-sheet"]').getByRole("button", { name: "Reject…" }).click();
  await page.getByLabel("Reason").fill("A shoot that day");
  await page.getByRole("button", { name: "Reject request" }).click();
  await expect(leaveRow).toHaveCount(0);

  await page.goto(`/people/${memberId}/leave`);
  const card = page.locator('[data-slot="comp-leave-card"]');
  await expect(card.locator('[data-slot="comp-balance"]')).toContainText("1 day of comp leave");
  await card.getByRole("button", { name: "Revoke" }).click();
  await page.getByLabel("Reason").fill("Granted by mistake");
  await page.getByRole("button", { name: "Revoke comp leave" }).click();
  await expect(card.locator('[data-slot="comp-credit"]').first()).toContainText("Revoked");
  await expect(card.locator('[data-slot="comp-balance"]')).toHaveText("No comp leave available");

  // A standalone grant, half a day, from the same card.
  await card.getByRole("button", { name: "Grant comp leave" }).click();
  const grant = page.locator('[data-slot="grant-comp-leave-dialog"]');
  await grant.getByRole("radio", { name: "½ day" }).check();
  await grant.getByRole("button", { name: "Grant ½ day" }).click();
  await expect(grant).toBeHidden();
  await expect(card.locator('[data-slot="comp-balance"]')).toContainText("½ day of comp leave");

  // The member reads the revoke reason, and the form offers only the half day now.
  await page.context().clearCookies();
  await signIn(page, email, PASSWORD);
  await page.goto("/leave/extra-work");
  await expect(page.locator('[data-slot="comp-credit"][data-status="revoked"]')).toContainText(
    "The Owner's reason: Granted by mistake",
  );
  await page.getByRole("button", { name: "Request leave" }).click();
  await form.getByLabel("Kind of leave").click();
  await expect(page.getByRole("option", { name: "Comp leave (1 day)" })).toHaveCount(0);
  await expect(page.getByRole("option", { name: "Comp leave, half day (½)" })).toBeVisible();
  await page.keyboard.press("Escape");
});

test("a day off worked: the note, and the Owner counts the day as worked", async ({
  page,
}, info) => {
  const email = person(info);
  const memberId = await memberIdOf(email);
  await resetAttendanceAndLeave(memberId);

  // The dialog offers the last 7 days, each with the note the calendar gives it: one of them is
  // a weekly day off (the suite pins today as a working day, so the off day is in the past).
  await signIn(page, email, PASSWORD);
  await page.goto("/leave/extra-work");
  await page.getByRole("button", { name: "Add note" }).click();
  const dialog = page.locator('[data-slot="extra-work-note-dialog"]');
  await dialog.getByLabel("Day").click();
  await page.getByRole("option").filter({ hasText: "worked on a day off" }).first().click();
  await expect(dialog).toContainText("I worked on a day off");
  await expect(dialog.getByLabel("Roughly how long (optional)")).toHaveCount(0);
  await dialog.getByLabel("What you worked on").fill("Covered the Mehta engagement shoot");
  await dialog.getByRole("button", { name: "Send note" }).click();
  await expect(dialog).toBeHidden();
  const [note] = await serviceSelect<{ work_date: string; kind: string }>(
    `extra_work_notes?member_id=eq.${memberId}&select=work_date,kind`,
  );
  expect(note?.kind).toBe("day_off");

  // The Owner reviews it: no comp leave, and the day counts as worked (never ticked for them).
  await signInOwner(page);
  await page.goto("/approvals");
  const row = page
    .locator('[data-slot="approval-group"][data-group="extra-work"] [data-slot="approval-row"]')
    .filter({ hasText: personName(info) });
  await expect(row).toContainText("Day off worked");
  await row.getByRole("button", { name: "Review" }).click();
  await page.locator('[data-slot="review-sheet"]').getByRole("button", { name: "Decide…" }).click();
  const decide = page.locator('[data-slot="decide-note-dialog"]');
  const worked = decide.getByRole("checkbox");
  await expect(worked).not.toBeChecked();
  await decide.getByRole("radio", { name: "No comp leave" }).check();
  await worked.check();
  await decide.getByRole("button", { name: "Mark reviewed" }).click();
  await expect(decide).toBeHidden();
  await expect(row).toHaveCount(0);
  const [day] = await serviceSelect<{ state: string; final_status: string; is_day_off: boolean }>(
    `attendance_days?member_id=eq.${memberId}&work_date=eq.${note?.work_date}&select=state,final_status,is_day_off`,
  );
  expect(day).toEqual({ state: "corrected", final_status: "present", is_day_off: true });

  // The member reads the neutral outcome on the note.
  await page.context().clearCookies();
  await signIn(page, email, PASSWORD);
  await page.goto("/leave/extra-work");
  await expect(noteRows(page).first()).toContainText(
    "Reviewed by the Owner · Counted as a day worked",
  );
});

test.describe("installed: the back order of the note dialog and the Owner's decision", () => {
  test.skip(({ isMobile }) => !isMobile, "the installed app is a phone");

  test("back closes the note dialog and leaves the Extra work tab in one more back", async ({
    page,
  }, info) => {
    await runInstalled(page);
    await signIn(page, person(info), PASSWORD);
    await page.goto("/my-day");
    await page.goto("/leave/extra-work");
    await page.getByRole("button", { name: "Add note" }).click();
    const dialog = page.locator('[data-slot="extra-work-note-dialog"]');
    await expect(dialog).toBeVisible();
    await expectBackStack(page, [
      { closes: dialog, url: /\/leave\/extra-work$/ },
      { url: /\/my-day$/ },
    ]);
  });

  test("back closes the decide dialog, then the review sheet, then leaves Approvals", async ({
    page,
  }, info) => {
    const memberId = await memberIdOf(person(info));
    await resetAttendanceAndLeave(memberId);
    await runInstalled(page);
    await signIn(page, person(info), PASSWORD);
    await page.goto("/leave/extra-work");
    await page.getByRole("button", { name: "Add note" }).click();
    const dialog = page.locator('[data-slot="extra-work-note-dialog"]');
    await dialog.getByLabel("What you worked on").fill("Late render for the reel");
    await dialog.getByRole("button", { name: "Send note" }).click();
    await expect(dialog).toBeHidden();

    await page.context().clearCookies();
    await signIn(page, USERS.owner.email, USERS.owner.password);
    await page.goto("/today");
    await page.goto("/approvals");
    const row = page
      .locator('[data-slot="approval-group"][data-group="extra-work"] [data-slot="approval-row"]')
      .filter({ hasText: personName(info) });
    await row.getByRole("button", { name: "Review" }).click();
    const sheet = page.locator('[data-slot="review-sheet"]');
    await sheet.getByRole("button", { name: "Decide…" }).click();
    const decide = page.locator('[data-slot="decide-note-dialog"]');
    await expect(decide).toBeVisible();
    await expectBackStack(page, [
      { closes: decide, url: /\/approvals$/ },
      { closes: sheet, url: /\/approvals$/ },
      { url: /\/today$/ },
    ]);
  });
});
