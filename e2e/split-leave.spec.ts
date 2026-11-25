import { type Locator, type Page, type TestInfo } from "@playwright/test";

import { expect, test } from "./fixtures";

import {
  expectBackStack,
  memberIdOf,
  resetAttendanceAndLeave,
  rpcAs,
  runInstalled,
  serviceSelect,
  signIn,
  USERS,
} from "./helpers";

/**
 * v2.0.1 "Flexible comp leave" (owner 23 and 25 Nov 2026; WORKFLOWS §2 "Settled in v2.0.1"): a
 * Crew member with half a day of comp leave asks for "Full day: ½ comp + ½ leave" in one go; the
 * Owner sees ONE row in Approvals and approves both halves with it; the member then asks to cancel
 * only the ordinary half, and the comp half stays. Installed, the form's kind select and the form
 * close on back, then the page is left (ARCHITECTURE §14.2 a).
 *
 * Runs in `desktop`, `mobile` (375px) and `mobile-lg` (430px), one seeded person per project
 * (`split-<project>@maxoff.local`), reset at the start so it re-runs without `pnpm db:reset`.
 */

const PASSWORD = "split-local-password";
const person = (info: TestInfo) => `split-${info.project.name}@maxoff.local`;
const personName = (info: TestInfo) => `Test Split Leave (${info.project.name})`;
const isPhone = (info: TestInfo) => info.project.name.startsWith("mobile");

/** A request row: a card on a phone, a table row on a laptop. */
function row(page: Page, info: TestInfo, ...texts: string[]): Locator {
  let found = isPhone(info) ? page.locator('[data-slot="data-card"]') : page.locator("tbody tr");
  for (const text of texts) found = found.filter({ hasText: text });
  return found.first();
}

type Half = {
  id: string;
  half: string;
  state: string;
  credit_days: number | null;
  pair_id: string;
};

async function halves(memberId: string): Promise<Half[]> {
  return serviceSelect<Half>(
    `leave_requests?member_id=eq.${memberId}&pair_id=not.is.null&select=id,half,state,credit_days,pair_id&order=half`,
  );
}

/** Half a day of comp leave, granted by the Owner, valid to the month's end. */
async function freshPersonWithHalfCredit(info: TestInfo): Promise<string> {
  const memberId = await memberIdOf(person(info));
  await resetAttendanceAndLeave(memberId);
  await rpcAs(USERS.owner.email, USERS.owner.password, "comp_leave_grant", {
    member_id: memberId,
    days: 0.5,
  });
  return memberId;
}

/** The leave form with the split kind chosen and the first comp date picked. */
async function openSplitForm(page: Page): Promise<Locator> {
  await page.getByRole("button", { name: "Request leave" }).click();
  const form = page.getByRole("dialog", { name: "Request leave" });
  await form.getByLabel("Kind of leave").click();
  await page.getByRole("option", { name: "Full day: ½ comp + ½ leave" }).click();
  return form;
}

test.describe.configure({ mode: "serial" });
test.use({ storageState: { cookies: [], origins: [] } });

let memberId = "";

test("the member asks for a full day: ½ comp + ½ leave, in one go", async ({ page }, info) => {
  memberId = await freshPersonWithHalfCredit(info);
  await signIn(page, person(info), PASSWORD);
  await page.goto("/leave");
  const form = await openSplitForm(page);
  // The comp half is asked for, nothing is chosen for them; the other half says what it becomes.
  await expect(form.getByRole("group", { name: "Comp half" })).toBeVisible();
  await form.getByLabel("Date").click();
  await page.getByRole("option").first().click();
  await form.getByRole("button", { name: "Request full day" }).click();
  await expect(form.locator('[data-slot="field-error"]').first()).toBeVisible();
  await form.getByLabel("Comp in the morning").check();
  await expect(form).toContainText("The afternoon is ordinary leave.");
  await form.getByRole("button", { name: "Request full day" }).click();
  await expect(form).toBeHidden();

  // One card for the two halves, waiting.
  const pair = row(page, info, "Full day · ½ comp + ½ leave");
  await expect(pair).toContainText("Waiting");
  await expect
    .poll(async () =>
      (await halves(memberId)).map((h) => `${h.half}:${h.state}:${h.credit_days ?? "-"}`),
    )
    .toEqual(["afternoon:submitted:-", "morning:submitted:0.5"]);
});

test("the Owner sees one row and approves both halves with it", async ({ page }, info) => {
  await signIn(page, USERS.owner.email, USERS.owner.password);
  await page.goto("/approvals");
  const rows = page
    .locator('[data-slot="approval-group"][data-group="leave"] [data-slot="approval-row"]')
    .filter({ hasText: personName(info) });
  await expect(rows).toHaveCount(1);
  await expect(rows).toContainText("Full day · ½ comp (morning) + ½ leave");
  await rows.getByRole("button", { name: "Approve" }).click();
  await expect(rows).toHaveAttribute("data-state", "approved");
  // The delayed send goes at once when the app goes to the background.
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect
    .poll(async () => (await halves(memberId)).map((h) => `${h.half}:${h.state}`), {
      timeout: 10_000,
    })
    .toEqual(["afternoon:approved", "morning:approved"]);
});

test("the member asks to cancel only the leave half; the comp half stays", async ({
  page,
}, info) => {
  await signIn(page, person(info), PASSWORD);
  await page.goto("/leave");
  const pair = row(page, info, "Full day · ½ comp + ½ leave");
  await expect(pair).toContainText("Approved");
  if (isPhone(info)) {
    await pair.click();
    await page
      .locator('[data-slot="detail-sheet"]')
      .getByRole("button", { name: "Ask to cancel the afternoon" })
      .click();
  } else {
    await pair.getByRole("button", { name: "Ask to cancel the afternoon" }).click();
  }
  await page.getByRole("button", { name: "Ask to cancel", exact: true }).click();
  const [afternoon] = (await halves(memberId)).filter((h) => h.half === "afternoon");
  await expect
    .poll(
      async () =>
        (
          await serviceSelect<{ id: string }>(
            `leave_requests?supersedes_id=eq.${afternoon?.id}&requests_cancellation=is.true&state=eq.submitted&select=id`,
          )
        ).length,
    )
    .toBe(1);
  const [cancellation] = await serviceSelect<{ id: string; half: string }>(
    `leave_requests?supersedes_id=eq.${afternoon?.id}&requests_cancellation=is.true&select=id,half`,
  );
  expect(cancellation?.half).toBe("afternoon");
  await rpcAs(USERS.owner.email, USERS.owner.password, "leave_decide", {
    request_id: cancellation?.id,
    decision: "approve",
  });
  expect((await halves(memberId)).map((h) => `${h.half}:${h.state}`)).toEqual([
    "afternoon:cancelled",
    "morning:approved",
  ]);
  // The comp half keeps its credit: nothing comes back to the balance.
  const [credit] = await serviceSelect<{ used_days: number }>(
    `comp_leave_credits?member_id=eq.${memberId}&select=used_days`,
  );
  expect(Number(credit?.used_days)).toBe(0.5);
  await page.reload();
  await expect(row(page, info, "Full day · ½ comp + ½ leave")).toContainText("One half approved");
});

test.describe("installed: the back order of the split-day form", () => {
  test.skip(({ isMobile }) => !isMobile, "the installed app is a phone");

  test("back closes the kind select, then the form, then leaves", async ({ page }, info) => {
    await freshPersonWithHalfCredit(info);
    await runInstalled(page);
    await signIn(page, person(info), PASSWORD);
    await page.goto("/my-day");
    await page.goto("/leave");
    await page.getByRole("button", { name: "Request leave" }).click();
    const form = page.getByRole("dialog", { name: "Request leave" });
    await form.getByLabel("Kind of leave").click();
    const select = page.locator('[data-slot="select-sheet"]');
    await expect(select.getByRole("option", { name: "Full day: ½ comp + ½ leave" })).toBeVisible();
    await expectBackStack(page, [
      { closes: select, url: /\/leave$/ },
      { closes: form, url: /\/leave$/ },
      { url: /\/my-day$/ },
    ]);
  });
});
