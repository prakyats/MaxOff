import AxeBuilder from "@axe-core/playwright";
import type { Page, TestInfo } from "@playwright/test";

import { expect, test } from "./fixtures";

import { expectSettled, storageStateFor } from "./helpers";
import { routesFor, SIGNED_OUT_ROUTES } from "./routes";

/**
 * Accessibility in CI (v7.0 unit 4, "Reliable anywhere"; ROADMAP v2.1 unit 4): axe-core on every
 * screen, for each role that opens it (`routes.ts`), at 1280 and 375, in light and dark. **Zero
 * serious and zero critical violations** of WCAG 2.1 A and AA. Lesser findings (moderate, minor) go
 * into the test's annotations, so they are seen without failing the run.
 *
 * Each screen is checked once it has streamed in (`expectSettled`: its title bar up, no skeleton
 * left), so axe reads the screen people use, never its loading state (the skeletons have their
 * own checks). The theme follows the device (`prefers-color-scheme`), which is the default for a
 * member who never picked one, so emulating the scheme draws each theme.
 */
const WCAG = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];
const BLOCKING = new Set(["serious", "critical"]);
const SCHEMES = ["light", "dark"] as const;

async function checkScreen(page: Page, path: string, info: TestInfo): Promise<void> {
  const failures: string[] = [];
  for (const scheme of SCHEMES) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto(path);
    if (!path.startsWith("/login") && !path.startsWith("/forgot-password")) {
      await expectSettled(page);
    }
    const results = await new AxeBuilder({ page }).withTags(WCAG).analyze();
    for (const violation of results.violations) {
      const where = violation.nodes
        .slice(0, 3)
        .map((node) => node.target.join(" "))
        .join(" | ");
      const line = `${scheme} ${violation.impact ?? "?"} ${violation.id}: ${violation.help} (${violation.nodes.length}×: ${where})`;
      if (BLOCKING.has(violation.impact ?? "")) failures.push(line);
      else info.annotations.push({ type: "axe", description: `${path} ${line}` });
    }
  }
  expect(failures, `${path}: no serious or critical accessibility violation`).toEqual([]);
}

const skipOtherWidths = (info: TestInfo) =>
  test.skip(!["desktop", "mobile"].includes(info.project.name), "1280 and 375 only");

for (const role of ["owner", "admin", "staff"] as const) {
  test.describe(`accessibility, as ${role}`, () => {
    test.use({ storageState: storageStateFor(role) });
    for (const route of routesFor(role)) {
      test(`${route.name} (${role})`, async ({ page }, info) => {
        skipOtherWidths(info);
        await checkScreen(page, await route.path(role), info);
      });
    }
  });
}

test.describe("accessibility, signed out", () => {
  test.use({ storageState: { cookies: [], origins: [] } });
  for (const path of SIGNED_OUT_ROUTES) {
    test(path, async ({ page }, info) => {
      skipOtherWidths(info);
      await checkScreen(page, path, info);
    });
  }
});
