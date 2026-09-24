import { expect, test } from "@playwright/test";

import { clearMailbox, confirmLinkFrom, latestEmailTo, passGate, signIn, USERS } from "./helpers";

/**
 * Sign in, sign out, the deactivated path and the recovery link (task 1.2), against
 * `next start` with the seeded local users. Every test here starts signed out.
 */
test.use({ storageState: { cookies: [], origins: [] } });

test.describe("signed out", () => {
  test("a shell route redirects to sign in and comes back afterwards", async ({ page }) => {
    await page.goto("/people");
    await expect(page).toHaveURL(/\/login\?next=%2Fpeople$/);
    await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();

    await page.getByLabel("Email").fill(USERS.owner.email);
    await page.getByLabel("Password", { exact: true }).fill(USERS.owner.password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/people$/);
    await expect(page.getByRole("heading", { name: "People", exact: true })).toBeVisible();
  });

  test("a wrong password stays on the page with one neutral message", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill(USERS.owner.email);
    await page.getByLabel("Password", { exact: true }).fill("definitely-not-the-password");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.locator('[data-slot="form-alert"]')).toContainText(
      "Email or password is incorrect.",
    );
    await expect(page).toHaveURL(/\/login$/);
  });

  test("an unknown email gets the same message", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill("nobody@maxoff.local");
    await page.getByLabel("Password", { exact: true }).fill("definitely-not-the-password");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.locator('[data-slot="form-alert"]')).toContainText(
      "Email or password is incorrect.",
    );
  });

  test("a deactivated member is refused even with the right password", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill(USERS.deactivated.email);
    await page.getByLabel("Password", { exact: true }).fill(USERS.deactivated.password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.locator('[data-slot="form-alert"]')).toContainText(
      "This account is not active. Ask the Owner.",
    );
    await expect(page).toHaveURL(/\/login$/);
    // The session Supabase opened was ended again: the shell is still closed.
    await page.goto("/my-day");
    await expect(page).toHaveURL(/\/login\?next=/);
  });

  test("an unsafe next value is ignored", async ({ page }) => {
    await page.goto("/login?next=https://evil.example/phish");
    await page.getByLabel("Email").fill(USERS.staff.email);
    await page.getByLabel("Password", { exact: true }).fill(USERS.staff.password);
    await page.getByRole("button", { name: "Sign in" }).click();
    // The same allowance as `signIn()`: the first server actions after boot can take a while
    // (2026-09-24: 5-6 s for every early desktop sign-in in one run, 2.6 s on mobile).
    await expect(page).toHaveURL(/\/my-day$/, { timeout: 15_000 });
  });
});

test.describe("signed in", () => {
  test.skip(({ isMobile }) => Boolean(isMobile), "the account menu is the desktop path");

  test("logging out records the time and closes the shell", async ({ page }) => {
    await signIn(page, USERS.admin.email, USERS.admin.password);
    await expect(page).toHaveURL(/\/today$/);

    await page.getByRole("button", { name: "Account menu" }).click();
    await page.getByRole("menuitem", { name: "Log out" }).click();
    // Logging out records the time, so it asks first (task 1.5).
    await expect(page.getByRole("alertdialog")).toContainText("records your logout time");
    await page.getByRole("button", { name: "Log out" }).click();
    await expect(page).toHaveURL(/\/login\?reason=signed_out$/);
    await expect(page.locator('[data-slot="form-alert"], [role="status"]').first()).toContainText(
      "You're logged out",
    );

    await page.goto("/today");
    await expect(page).toHaveURL(/\/login\?next=%2Ftoday$/);
  });

  test("the sign-in pages send a member home", async ({ page }) => {
    await signIn(page, USERS.owner.email, USERS.owner.password);
    await page.goto("/login");
    await expect(page).toHaveURL(/\/today$/);
    await page.goto("/forgot-password");
    await expect(page).toHaveURL(/\/today$/);
  });
});

test.describe("Staff on a phone", () => {
  test.skip(({ isMobile }) => !isMobile, "phone layout only");

  test("signs in and lands on My Day", async ({ page }) => {
    await signIn(page, USERS.staff.email, USERS.staff.password);
    await expect(page).toHaveURL(/\/my-day$/);
    await expect(page.locator("[data-slot='bottom-nav']")).toBeVisible();
  });

  test("logs out from the Me tab", async ({ page }) => {
    await signIn(page, USERS.staff.email, USERS.staff.password);
    await page.goto("/me");
    await page.getByRole("button", { name: "Log out" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Log out" }).click();
    await expect(page).toHaveURL(/\/login\?reason=signed_out$/);
  });
});

test.describe("recovery link", () => {
  test.skip(({ isMobile }) => Boolean(isMobile), "one run is enough");
  // Changes this user's password, so it must not share a worker with anything else.
  test.describe.configure({ mode: "serial" });

  test("forgot password → email link → set password → signed in", async ({ page, baseURL }) => {
    await clearMailbox();
    await page.goto("/forgot-password");
    await page.getByLabel("Email").fill(USERS.reset.email);
    await page.getByRole("button", { name: "Send me a link" }).click();
    await expect(page.locator('[data-slot="form-alert"], [role="status"]').first()).toContainText(
      "a link is on its way",
    );

    const link = confirmLinkFrom(await latestEmailTo(USERS.reset.email), baseURL);

    await page.goto(link);
    await expect(page).toHaveURL(/\/set-password$/);

    const newPassword = `reset-new-${crypto.randomUUID().slice(0, 8)}`;
    await page.getByLabel("New password").fill("short");
    await page.getByLabel("Repeat it").fill("short");
    await page.getByRole("button", { name: "Save password and sign in" }).click();
    await expect(page.locator('[data-slot="field-error"]').first()).toContainText(
      "at least 12 characters",
    );

    await page.getByLabel("New password").fill(newPassword);
    await page.getByLabel("Repeat it").fill(`${newPassword}x`);
    await page.getByRole("button", { name: "Save password and sign in" }).click();
    await expect(page.locator('[data-slot="field-error"]').first()).toContainText("don't match");

    await page.getByLabel("New password").fill(newPassword);
    await page.getByLabel("Repeat it").fill(newPassword);
    await page.getByRole("button", { name: "Save password and sign in" }).click();
    // First sign-in of the day for this person: the day gate (2.2) comes before My Day.
    await passGate(page);
    await expect(page).toHaveURL(/\/my-day$/);

    // The link was one-time: opening it again lands on sign in with the reason.
    await page.context().clearCookies();
    await page.goto(link);
    await expect(page).toHaveURL(/\/login\?reason=link$/);
    await expect(page.locator('[data-slot="form-alert"]')).toContainText(
      "expired or was already used",
    );

    await signIn(page, USERS.reset.email, newPassword);
    await expect(page).toHaveURL(/\/my-day$/);
  });

  test("a deactivated member's link opens nothing", async ({ page, baseURL }) => {
    await clearMailbox();
    await page.goto("/forgot-password");
    await page.getByLabel("Email").fill(USERS.deactivated.email);
    await page.getByRole("button", { name: "Send me a link" }).click();
    await expect(page.locator('[data-slot="form-alert"], [role="status"]').first()).toContainText(
      "a link is on its way",
    );

    const link = confirmLinkFrom(await latestEmailTo(USERS.deactivated.email), baseURL);

    // GoTrue issued the link (it knows nothing about members); the app ends the session at once.
    await page.goto(link);
    await expect(page).toHaveURL(/\/login\?reason=inactive$/);
    await expect(page.locator('[data-slot="form-alert"]')).toContainText("not active");
    await page.goto("/set-password");
    await expect(page).toHaveURL(/\/login\?next=%2Fset-password$/);
  });

  test("an unknown email gets the same answer", async ({ page }) => {
    await page.goto("/forgot-password");
    await page.getByLabel("Email").fill("nobody@maxoff.local");
    await page.getByRole("button", { name: "Send me a link" }).click();
    await expect(page.locator('[data-slot="form-alert"], [role="status"]').first()).toContainText(
      "a link is on its way",
    );
  });
});

test.describe("set password without a link", () => {
  test("goes back to sign in", async ({ page }) => {
    await page.goto("/set-password");
    await expect(page).toHaveURL(/\/login\?next=%2Fset-password$/);
  });
});
