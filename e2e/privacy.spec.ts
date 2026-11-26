import { expect, test } from "./fixtures";
import {
  expectBackStack,
  hydrated,
  memberIdOf,
  runInstalled,
  serviceDelete,
  serviceSelect,
  type SessionRole,
  storageStateFor,
  USERS,
} from "./helpers";

/**
 * The staff privacy notice (v7.5 Q1, owner 2026-11-26; docs/PRIVACY.md). Every role reads it at
 * Me → Your information; until they tap "Got it" a card at the end of their home screen asks them
 * to. Global setup marks the seeded people as having read it; each test here takes one person's
 * row away first. Each role runs on one project only (they share the person), so the three
 * projects never touch the same row: the Owner at 1280, an Admin at 375, Crew at 430.
 */
const CARD_FLOW: Record<SessionRole, string> = {
  owner: "desktop",
  admin: "mobile",
  staff: "mobile-lg",
};

async function unread(role: SessionRole): Promise<string> {
  const id = await memberIdOf(USERS[role].email);
  await serviceDelete(`privacy_notice_reads?member_id=eq.${id}`);
  return id;
}

for (const role of ["owner", "admin", "staff"] as const) {
  test.describe(`the privacy notice (${role})`, () => {
    test.use({ storageState: storageStateFor(role) });

    test("the home card until Got it, then never again", async ({ page }, info) => {
      test.skip(info.project.name !== CARD_FLOW[role], `${role}: run on ${CARD_FLOW[role]} only`);
      const id = await unread(role);
      await page.goto(USERS[role].home);
      await hydrated(page);
      const card = page.locator('[data-slot="privacy-card"]');
      await expect(card).toBeVisible();
      await expect(card).toContainText("Your information in MaxOff");

      await card.getByRole("link", { name: "Read it" }).click();
      await expect(page).toHaveURL(/\/me\/privacy$/);
      await hydrated(page);
      const notice = page.locator('[data-slot="privacy-notice"]');
      await expect(notice.getByRole("heading", { name: "How long" })).toBeVisible();
      await expect(notice).toContainText(
        "attendance, leave and expense records for 8 years, tasks and chat for 3 years, and sign-in records for 1 year",
      );
      await page.locator('[data-slot="privacy-got-it"]').click();
      await expect(page.locator('[data-slot="privacy-read-on"]')).toBeVisible();
      await expect(page.locator('[data-slot="privacy-got-it"]')).toHaveCount(0);
      const [row] = await serviceSelect<{ version: string }>(
        `privacy_notice_reads?member_id=eq.${id}&select=version`,
      );
      expect(row?.version, "the version on screen is recorded").toMatch(/^\d{4}-\d{2}-\d{2}$/);

      await page.goto(USERS[role].home);
      await hydrated(page);
      await expect(page.locator('[data-slot="privacy-card"]')).toHaveCount(0);
    });

    test("installed: Me → Your information, one back returns to Me", async ({ page, isMobile }) => {
      test.skip(!isMobile, "the installed back gesture is the phone's (375 and 430)");
      await runInstalled(page);
      await page.goto("/me");
      await hydrated(page);
      await page.locator('[data-slot="me-privacy-link"]').click();
      await expect(page).toHaveURL(/\/me\/privacy$/);
      await expect(page.getByRole("heading", { name: "Privacy", level: 1 })).toBeVisible();
      await expectBackStack(page, [{ url: /\/me$/ }]);
    });
  });
}
