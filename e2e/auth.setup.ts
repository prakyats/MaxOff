import { test as setup } from "@playwright/test";

import { type SessionRole, signIn, storageStateFor, USERS } from "./helpers";

/**
 * Signs in once per role through the real form and saves the session cookies, so the flow
 * specs start signed in (`test.use({ storageState })`) instead of repeating the form. Admin and
 * Staff answer the day gate (2.2) with Present here, so the saved state is past it: today's
 * pass cookie is in the state when `DAY_GATE_COOKIE_SECRET` is set, and without it the settled
 * day lets every page through anyway.
 */
for (const role of ["owner", "admin", "staff"] as const satisfies readonly SessionRole[]) {
  setup(`sign in as ${role}`, async ({ page }) => {
    const user = USERS[role];
    await signIn(page, user.email, user.password);
    await page.context().storageState({ path: storageStateFor(role) });
  });
}
