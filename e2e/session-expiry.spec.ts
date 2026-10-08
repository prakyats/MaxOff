import { expect, test } from "./fixtures";

import { expectSettled, holdReads, ownSession, storageStateFor, USERS } from "./helpers";

/**
 * A server read whose access token PostgREST refuses as expired (`401`, `PGRST303` "JWT
 * expired"; Sentry MAXOFF-3/-6 on `GET /today`, 6.6) ends on 2.6's retryable screen, "Can't reach
 * the server. You're still signed in.", never on the generic "This page couldn't load", and never
 * signs the person out. **Try again** asks the server again (`retry()`), and once PostgREST takes
 * the token the page loads, still signed in.
 *
 * The Owner's Today with a session of the test's own (`ownSession`): the e2e server's Supabase
 * proxy answers that session's `emails_held_today` read (one only this page makes) the way
 * PostgREST answers an expired JWT (`holdReads(…, "jwt-expired")`, `e2e/hold-proxy.ts`), so no
 * other test, the Owner's saved session included, is touched.
 */
test.use({ storageState: storageStateFor("owner") });

test("an expired-JWT read shows 'still signed in, try again', and Try again loads the page", async ({
  page,
}) => {
  const owner = USERS.owner;
  const session = await ownSession(page, owner.email, owner.password);
  const expired = await holdReads("/rest/v1/rpc/emails_held_today", session, "jwt-expired");
  try {
    await page.goto("/today");
    const screen = page.locator('[data-slot="error-state"]');
    await expect(screen).toBeVisible();
    await expect(screen).toContainText("Can't reach the server.");
    await expect(screen).toContainText("You're still signed in. Try again in a moment.");
    await expect(screen).not.toContainText("This page couldn't load");
    await expect
      .poll(() => expired.caught(), { message: "the page's read reached PostgREST, refused" })
      .toBe(true);
    await expect(page).toHaveURL(/\/today$/);
  } finally {
    expired.release();
  }
  await expect.poll(() => expired.active(), { message: "the proxy has let the read go" }).toBe(0);

  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.locator('[data-slot="owner-today"]')).toBeVisible();
  await expectSettled(page);
  await expect(page.locator('[data-slot="error-state"]')).toHaveCount(0);
  await expect(page).toHaveURL(/\/today$/);
});
