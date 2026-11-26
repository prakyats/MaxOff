import type { Page } from "@playwright/test";

import { expect, test } from "./fixtures";
import { hydrated, type SessionRole, storageStateFor } from "./helpers";

/**
 * The report-only CSP (v7.5 Q7, owner 2026-11-26: a week of reports, then enforced) must fit the
 * app before the week starts: each role's main screens, opened and used as usual, make the
 * browser report **nothing**. A report is a `securitypolicyviolation` event, recorded from the
 * first script on the page (the browser blocks nothing while the policy is report-only). The
 * policy's sources are unit-tested (`core/http/response-headers.test.ts`).
 */
const SCREENS: Record<SessionRole, readonly string[]> = {
  owner: [
    "/today",
    "/approvals",
    "/tasks",
    "/clients",
    "/people",
    "/calendar",
    "/notifications",
    "/me",
  ],
  admin: ["/today", "/tasks", "/clients", "/calendar", "/me"],
  staff: ["/my-day", "/tasks", "/leave", "/me"],
};

type Violation = { directive: string; blocked: string; source: string };

async function recordViolations(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const seen: Violation[] = [];
    (window as unknown as { __csp: Violation[] }).__csp = seen;
    document.addEventListener("securitypolicyviolation", (event) => {
      seen.push({
        directive: event.effectiveDirective,
        blocked: event.blockedURI,
        source: `${event.sourceFile}:${event.lineNumber}`,
      });
    });
  });
}

const violations = (page: Page) =>
  page.evaluate(() => (window as unknown as { __csp: Violation[] }).__csp);

for (const role of ["owner", "admin", "staff"] as const) {
  test.describe(`the report-only CSP reports nothing (${role})`, () => {
    test.use({ storageState: storageStateFor(role) });

    test(`each main screen, opened and moved between in the app`, async ({ page }) => {
      await recordViolations(page);
      const [first, ...rest] = SCREENS[role];
      await page.goto(first!);
      await hydrated(page);
      // The page's own policy is the report-only one (the header is checked in production.spec).
      const policy = await page.evaluate(async () => {
        const response = await fetch(location.href, { method: "HEAD" });
        return response.headers.get("content-security-policy-report-only");
      });
      expect(policy, "the report-only policy is served").toMatch(/^default-src 'self'/);
      for (const path of rest) {
        // In-app moves, as a person makes them: the router's fetches, Realtime, the service worker.
        await page.evaluate((to) => {
          (
            window as unknown as { next: { router: { push: (href: string) => void } } }
          ).next.router.push(to);
        }, path);
        await expect(page).toHaveURL(new RegExp(`${path}$`));
        await hydrated(page);
      }
      expect(await violations(page), "no CSP report while moving").toEqual([]);
      // A full load of the last one too: the document's own first scripts and styles.
      await page.reload();
      await hydrated(page);
      expect(await violations(page), "no CSP report on a full load").toEqual([]);
      // And the recorder hears a report when there is one: an image from a host the policy
      // does not name (nothing loads: the host does not exist).
      await page.evaluate(() => {
        new Image().src = "https://csp-check.invalid/x.png";
      });
      await expect
        .poll(async () => (await violations(page)).map((violation) => violation.directive))
        .toEqual(["img-src"]);
    });
  });
}
