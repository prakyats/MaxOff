import { test as setup } from "@playwright/test";

import { type SessionRole, signIn, storageStateFor, USERS } from "./helpers";

/**
 * Signs in once per role through the real form and saves the session cookies, so the flow
 * specs start signed in (`test.use({ storageState })`) instead of repeating the form. Admin and
 * Staff start their day from the prompt here (3b.1), so the saved sessions have a started day
 * and the prompt never opens over a flow spec's screen.
 */
for (const role of ["owner", "admin", "staff"] as const satisfies readonly SessionRole[]) {
  setup(`sign in as ${role}`, async ({ page }) => {
    const user = USERS[role];
    await signIn(page, user.email, user.password);
    await page.context().storageState({ path: storageStateFor(role) });
  });
}
