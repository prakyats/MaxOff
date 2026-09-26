import { expect, test as setup } from "@playwright/test";

import { serviceSelect, storageStateFor } from "./helpers";

/**
 * Warms every route once before the parallel projects start (2.6).
 *
 * `next start` renders each route for the first time on its first request, and that first
 * render costs about half a second alone (measured 2026-09-24: `/login` 505 ms then 46 ms, the
 * first sign-in 543 ms then 120 ms). The suite used to pay it all at once: the moment the
 * `setup` sign-ins finished, three projects' workers hit every screen, and the bottom bar
 * prefetches five more routes per page, so dozens of first renders queued on one server. In
 * that storm a request took 1.5–3.8 s and a logout action over 5 s — the "cold-start" timeouts
 * 2.2 and 2.3 met and papered over with 15 s allowances. Those allowances are gone; this step
 * is why they are not needed. It runs last in the serial `setup` project (file order), as the
 * Owner, who can open every screen; the gate and the sign-in action were just exercised by the
 * three sign-ins themselves.
 */
const ROUTES = [
  "/today",
  "/my-day",
  "/approvals",
  "/tasks",
  "/calendar",
  "/clients",
  "/people",
  "/reports",
  "/settings",
  "/settings/company",
  "/settings/days-off",
  "/settings/thresholds",
  "/settings/job-titles",
  "/me",
  "/leave",
  "/leave/attendance",
  "/notifications",
  "/forbidden",
  "/login",
  "/forgot-password",
  "/set-password",
  "/offline",
];

setup.use({ storageState: storageStateFor("owner") });

setup("warm every route once as the Owner", async ({ page, request }) => {
  const [someone] = await serviceSelect<{ id: string }>("members?select=id&limit=1");
  const routes = someone
    ? [...ROUTES, `/people/${someone.id}`, `/people/${someone.id}/attendance`]
    : ROUTES;
  for (const route of routes) {
    const response = await request.get(route, { maxRedirects: 3 });
    expect(response.status(), `${route} answers`).toBeLessThan(500);
  }
  // The client-navigation (RSC) render path once too: one real navigation through the shell,
  // which also prefetches what the bar links to.
  await page.goto("/today");
  await page.getByRole("link", { name: "Approvals" }).first().click();
  await expect(page).toHaveURL(/\/approvals$/);
});
