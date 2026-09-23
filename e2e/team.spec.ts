import { expect, test } from "@playwright/test";

import {
  onBaseURL,
  refreshTokenFrom,
  signIn,
  storageStateFor,
  supabaseAuth,
  USERS,
} from "./helpers";

/**
 * Team (task 1.3): invite → one-time link → set password → profile; Copy invite link
 * invalidating the previous link; edit; deactivation killing a live session's refresh token;
 * reactivation; what Admins and Staff see. Desktop only: the row menus are the desktop path.
 */
const INVITEE = { email: "invitee@maxoff.local", name: "Invited Person" };
const INVITEE_PASSWORD = "invitee-chosen-password";
/** `browser.newContext()` inherits the test's storage state; these tabs must start signed out. */
const SIGNED_OUT = { storageState: { cookies: [], origins: [] } };

test.describe("Owner", () => {
  test.use({ storageState: storageStateFor("owner") });
  test.skip(({ isMobile }) => Boolean(isMobile), "the row menus are the desktop path");
  // Every test here changes the same rows, in order.
  test.describe.configure({ mode: "serial" });

  let firstLink = "";
  let secondLink = "";

  test("invites someone and gets a one-time link", async ({ page, baseURL }) => {
    await page.goto("/people");
    await expect(page.getByRole("heading", { name: "People", exact: true })).toBeVisible();

    await page.getByRole("button", { name: "Invite", exact: true }).click();
    await page.getByRole("button", { name: "Send invite" }).click();
    await expect(page.locator('[data-slot="field-error"]').first()).toBeVisible();

    await page.getByLabel("Email").fill(INVITEE.email);
    await page.getByLabel("Full name").fill(INVITEE.name);
    await page.getByLabel("Job title").click();
    await page.getByRole("option", { name: "Graphic Designer" }).click();
    await page.getByRole("button", { name: "Send invite" }).click();

    await expect(page.getByRole("heading", { name: `${INVITEE.name} is invited` })).toBeVisible();
    // No sending domain locally: the dialog says so and shows the link.
    await expect(page.getByText("Email is not set up yet")).toBeVisible();
    const shown = await page.locator('[data-slot="invite-link"]').inputValue();
    expect(shown).toContain("type=invite");
    firstLink = onBaseURL(shown, baseURL);
    await page.getByRole("button", { name: "Done" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);

    const row = page.getByRole("row", { name: new RegExp(INVITEE.name) });
    await expect(row).toContainText("Invited");
    await expect(row).toContainText("Graphic Designer");
    await expect(row).toContainText(INVITEE.email);
  });

  test("Copy invite link issues a fresh link; the earlier one stops working", async ({
    page,
    browser,
    baseURL,
  }) => {
    await page.goto("/people");
    await page.getByRole("button", { name: `Actions for ${INVITEE.name}` }).click();
    await page.getByRole("menuitem", { name: "Copy invite link" }).click();
    const input = page.locator('[data-slot="invite-link"]');
    await expect(input).toBeVisible();
    secondLink = onBaseURL(await input.inputValue(), baseURL);
    expect(secondLink).not.toBe(firstLink);
    await page.getByRole("button", { name: "Done" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);

    const invitee = await browser.newContext(SIGNED_OUT);
    try {
      const tab = await invitee.newPage();
      await tab.goto(firstLink);
      await expect(tab).toHaveURL(/\/login\?reason=link$/);

      await tab.goto(secondLink);
      await expect(tab).toHaveURL(/\/set-password$/);
      await tab.getByLabel("New password").fill(INVITEE_PASSWORD);
      await tab.getByLabel("Repeat it").fill(INVITEE_PASSWORD);
      await tab.getByRole("button", { name: "Save password and sign in" }).click();
      await expect(tab).toHaveURL(/\/me\?welcome=1$/);
      await expect(tab.locator('[data-slot="welcome"]')).toContainText(INVITEE.email);
      await expect(tab.getByRole("heading", { name: /Welcome, Invited/ })).toBeVisible();

      // The link was one-time.
      await tab.context().clearCookies();
      await tab.goto(secondLink);
      await expect(tab).toHaveURL(/\/login\?reason=link$/);

      await signIn(tab, INVITEE.email, INVITEE_PASSWORD);
      await expect(tab).toHaveURL(/\/my-day$/);
    } finally {
      await invitee.close();
    }

    await page.reload();
    await expect(page.getByRole("row", { name: new RegExp(INVITEE.name) })).toContainText("Active");
  });

  test("edits a member's name, role and job title", async ({ page }) => {
    await page.goto("/people");
    await page.getByRole("button", { name: `Actions for ${INVITEE.name}` }).click();
    await page.getByRole("menuitem", { name: "Edit" }).click();
    await page.getByLabel("Full name").fill("Invited Person Jr");
    await page.getByLabel("Role").click();
    await page.getByRole("option", { name: "Admin" }).click();
    await page.getByLabel("Job title").click();
    await page.getByRole("option", { name: "Video Editor" }).click();
    await page.getByRole("button", { name: "Save" }).click();

    const row = page.getByRole("row", { name: /Invited Person Jr/ });
    await expect(row).toContainText("Admin");
    await expect(row).toContainText("Video Editor");
  });

  test("revoking an invite closes its link; after reactivation a new link works even though the old one was opened", async ({
    page,
    browser,
    baseURL,
  }) => {
    await page.goto("/people");
    await page.getByRole("button", { name: "Invite", exact: true }).click();
    await page.getByLabel("Email").fill("pending@maxoff.local");
    await page.getByLabel("Full name").fill("Pending Person");
    await page.getByRole("button", { name: "Send invite" }).click();
    const pendingLink = onBaseURL(
      await page.locator('[data-slot="invite-link"]').inputValue(),
      baseURL,
    );
    await page.getByRole("button", { name: "Done" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);

    await page.getByRole("button", { name: "Actions for Pending Person" }).click();
    await page.getByRole("menuitem", { name: "Revoke invite" }).click();
    await expect(
      page.getByRole("heading", { name: "Revoke Pending Person's invite?" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Revoke invite", exact: true }).click();
    await expect(page.getByRole("row", { name: /Pending Person/ })).toContainText("Deactivated");

    const pending = await browser.newContext(SIGNED_OUT);
    try {
      const tab = await pending.newPage();
      // GoTrue verifies the token (and confirms the sign-in); the app ends the session at once.
      await tab.goto(pendingLink);
      await expect(tab).toHaveURL(/\/login\?reason=inactive$/);

      await page.getByRole("button", { name: "Actions for Pending Person" }).click();
      await page.getByRole("menuitem", { name: "Reactivate" }).click();
      await expect(page.getByRole("row", { name: /Pending Person/ })).toContainText("Invited");

      // The sign-in is confirmed now, so GoTrue issues a recovery token; same route, same accept step.
      await page.getByRole("button", { name: "Actions for Pending Person" }).click();
      await page.getByRole("menuitem", { name: "Copy invite link" }).click();
      const input = page.locator('[data-slot="invite-link"]');
      await expect(input).toBeVisible();
      const shown = await input.inputValue();
      expect(shown).toContain("type=recovery");
      await page.getByRole("button", { name: "Done" }).click();

      await tab.goto(onBaseURL(shown, baseURL));
      await expect(tab).toHaveURL(/\/set-password$/);
    } finally {
      await pending.close();
    }
  });

  test("deactivating someone kills their live session, refresh token included", async ({
    page,
    browser,
    request,
  }) => {
    const leaver = await browser.newContext(SIGNED_OUT);
    try {
      const tab = await leaver.newPage();
      await signIn(tab, USERS.leaver.email, USERS.leaver.password);
      await expect(tab).toHaveURL(/\/my-day$/);

      // Positive control: the captured refresh token works before the deactivation.
      const auth = supabaseAuth();
      const refresh = await request.post(`${auth.url}/token?grant_type=refresh_token`, {
        headers: { apikey: auth.apikey },
        data: { refresh_token: refreshTokenFrom(await leaver.cookies()) },
      });
      expect(refresh.ok(), "a live member's refresh token is accepted").toBe(true);
      const { refresh_token: liveToken } = (await refresh.json()) as { refresh_token: string };
      expect(liveToken).toBeTruthy();

      await page.goto("/people");
      await page.getByRole("button", { name: "Actions for Leaver Staff" }).click();
      await page.getByRole("menuitem", { name: "Deactivate" }).click();
      await expect(page.getByRole("heading", { name: "Deactivate Leaver Staff?" })).toBeVisible();
      await page.getByLabel("Reason (optional)").fill("Left the company");
      await page.getByRole("button", { name: "Deactivate", exact: true }).click();
      await expect(page.getByRole("row", { name: /Leaver Staff/ })).toContainText("Deactivated");

      // The open tab's next request ends at sign-in …
      await tab.goto("/my-day");
      await expect(tab).toHaveURL(/\/login\?reason=inactive$/);

      // … and the refresh token that worked a moment ago is gone at GoTrue itself.
      const refused = await request.post(`${auth.url}/token?grant_type=refresh_token`, {
        headers: { apikey: auth.apikey },
        data: { refresh_token: liveToken },
      });
      expect(refused.ok(), "the deactivated person's refresh token is refused").toBe(false);
      expect(await refused.text()).toContain("refresh_token_not_found");
    } finally {
      await leaver.close();
    }
  });

  test("reactivating brings them back, and they can sign in again", async ({ page, browser }) => {
    await page.goto("/people");
    await page.getByRole("button", { name: "Actions for Leaver Staff" }).click();
    await page.getByRole("menuitem", { name: "Reactivate" }).click();
    await expect(page.getByRole("row", { name: /Leaver Staff/ })).toContainText("Active");

    const leaver = await browser.newContext(SIGNED_OUT);
    try {
      const tab = await leaver.newPage();
      await signIn(tab, USERS.leaver.email, USERS.leaver.password);
      await expect(tab).toHaveURL(/\/my-day$/);
    } finally {
      await leaver.close();
    }
  });
});

test.describe("Admin", () => {
  test.use({ storageState: storageStateFor("admin") });
  test.skip(({ isMobile }) => Boolean(isMobile), "the table is the desktop path");

  test("sees the team without emails or actions", async ({ page }) => {
    await page.goto("/people");
    await expect(page.getByRole("heading", { name: "People", exact: true })).toBeVisible();
    await expect(page.getByRole("row", { name: /Local Staff/ })).toBeVisible();
    await expect(page.getByRole("button", { name: "Invite", exact: true })).toHaveCount(0);
    await expect(page.getByText(USERS.owner.email)).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^Actions for/ })).toHaveCount(0);
  });
});

test.describe("Staff", () => {
  test.use({ storageState: storageStateFor("staff") });
  // Runs on the phone project too: /me is a Staff screen (375px, CLAUDE.md Definition of Done).

  test("cannot open People, and edits their own profile on Me", async ({ page }) => {
    await page.goto("/people");
    await expect(page).toHaveURL(/\/forbidden$/);

    await page.goto("/me");
    await page.getByLabel("Phone").fill("9000000003");
    await page.getByRole("button", { name: "Save profile" }).click();
    await expect(page.getByText("Profile saved")).toBeVisible();
    await page.reload();
    await expect(page.getByLabel("Phone")).toHaveValue("9000000003");
  });
});
