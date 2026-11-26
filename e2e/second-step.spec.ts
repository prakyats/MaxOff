import { expect, test } from "./fixtures";
import { expectBackStack, hydrated, runInstalled, signIn, storageStateFor, USERS } from "./helpers";
import { answerSecondStep, codeFor } from "./totp";

/**
 * Two-step sign-in (v7.5 Q2, owner 2026-11-26): **required for the Owner** (the e2e server runs with
 * OWNER_MFA_REQUIRED=on, as production), **optional for Admins**, not offered to Crew. The Owner's
 * authenticator was set up by the setup project (`e2e/totp.ts` keeps its key). Each project has
 * its own Admin for turning it on and off (seed: twostep-admin-<project>), so no other test's Admin
 * session is ever asked for a code. Every path of the database switch is pgTAP 178.
 */
test.use({ storageState: { cookies: [], origins: [] } });
// The on/off test and the installed one share the project's Admin.
test.describe.configure({ mode: "serial" });

const twoStepAdmin = (project: string) => ({
  email: `twostep-admin-${project}@maxoff.local`,
  password: "twostep-local-password",
});

test.describe("the Owner must pass the second step", () => {
  test("a password alone is not a sign-in; a wrong code says so; the right one goes on", async ({
    page,
  }, info) => {
    // One Owner for every project, and two browsers verifying one factor at the same moment can
    // clash inside GoTrue: once, at 1280.
    test.skip(info.project.name !== "desktop", "one Owner: run once");
    await page.goto("/login?next=%2Fapprovals");
    await page.getByLabel("Email").fill(USERS.owner.email);
    await page.getByLabel("Password", { exact: true }).fill(USERS.owner.password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/second-step\?next=%2Fapprovals$/);
    await expect(page.getByRole("heading", { name: "Enter your code" })).toBeVisible();

    // Nothing of the app is theirs yet: any screen sends them back here.
    await page.goto("/today");
    await expect(page).toHaveURL(/\/second-step$/);
    await page.goBack();
    await expect(page).toHaveURL(/\/second-step\?next=%2Fapprovals$/);
    // The sign-in screens have no app shell: the page itself, not its loading screen.
    await expect(page.locator('[data-slot="second-step-loading"]')).toHaveCount(0);
    await expect(page.locator('[data-slot="second-step-code"]')).toBeEnabled();

    const wrong = codeFor(USERS.owner.email) === "000000" ? "111111" : "000000";
    await page.locator('[data-slot="second-step-code"]').fill(wrong);
    await page.locator('[data-slot="second-step-continue"]').click();
    await expect(page.getByText("That code didn't work.")).toBeVisible();
    await expect(page).toHaveURL(/\/second-step/);

    await page.locator('[data-slot="second-step-code"]').fill(codeFor(USERS.owner.email));
    await page.locator('[data-slot="second-step-continue"]').click();
    await expect(page).toHaveURL(/\/approvals$/);
  });

  test.describe("signed in", () => {
    test.use({ storageState: storageStateFor("owner") });

    test("Me says it is required, with nothing to turn off", async ({ page }) => {
      await page.goto("/me");
      await hydrated(page);
      const row = page.locator('[data-slot="me-second-step"]');
      await expect(row.locator('[data-slot="me-second-step-status"]')).toHaveText(
        "· On · required for the Owner",
      );
      await expect(row.getByRole("button")).toHaveCount(0);
      await expect(row.getByRole("link")).toHaveCount(0);
    });
  });
});

test.describe("an Admin may turn it on, and off", () => {
  test("on: every sign-in then asks; off: it no longer does", async ({ page }, info) => {
    const admin = twoStepAdmin(info.project.name);
    await signIn(page, admin.email, admin.password);
    await page.goto("/me");
    await hydrated(page);
    const status = page.locator('[data-slot="me-second-step-status"]');
    await expect(status).toHaveText("· Off");

    await page.locator('[data-slot="me-second-step-on"]').click();
    await expect(page).toHaveURL(/\/second-step\?setup=1$/);
    await expect(page.getByRole("heading", { name: "Set up two-step sign-in" })).toBeVisible();
    await answerSecondStep(page, admin.email);
    await page.goto("/me");
    await hydrated(page);
    await expect(status).toHaveText("· On");

    // A new sign-in now asks for the code.
    await page.context().clearCookies();
    await page.goto("/login");
    await page.getByLabel("Email").fill(admin.email);
    await page.getByLabel("Password", { exact: true }).fill(admin.password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/second-step$/);
    await expect(page.getByRole("heading", { name: "Enter your code" })).toBeVisible();
    await answerSecondStep(page, admin.email);

    await page.goto("/me");
    await hydrated(page);
    await page.locator('[data-slot="me-second-step-off"]').click();
    await expect(status).toHaveText("· Off");
    await page.context().clearCookies();
    await page.goto("/login");
    await page.getByLabel("Email").fill(admin.email);
    await page.getByLabel("Password", { exact: true }).fill(admin.password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).not.toHaveURL(/\/login/);
    await expect(page).not.toHaveURL(/\/second-step/);
  });
});

test.describe("Crew is not offered it", () => {
  test.use({ storageState: storageStateFor("staff") });

  test("no Sign-in section on Me, and the set-up screen sends them home", async ({
    page,
    reloadGuard,
  }) => {
    // The sign-in screens are their own layout: leaving one for home is a document load.
    reloadGuard.allow(/\/my-day$/);
    await page.goto("/me");
    await hydrated(page);
    await expect(page.locator('[data-slot="me-sign-in"]')).toHaveCount(0);
    await page.goto("/second-step?setup=1");
    await expect(page).toHaveURL(/\/my-day$/);
  });
});

test.describe("installed: the set-up screen is one back from Me", () => {
  test("Me → Turn on → back returns to Me, nothing set up", async ({ page, isMobile }, info) => {
    test.skip(!isMobile, "the installed back gesture is the phone's (375 and 430)");
    const admin = twoStepAdmin(info.project.name);
    await signIn(page, admin.email, admin.password);
    await runInstalled(page);
    await page.goto("/me");
    await hydrated(page);
    await page.locator('[data-slot="me-second-step-on"]').click();
    await expect(page).toHaveURL(/\/second-step\?setup=1$/);
    await expectBackStack(page, [{ url: /\/me$/ }]);
    await expect(page.locator('[data-slot="me-second-step-status"]')).toHaveText("· Off");
  });
});
