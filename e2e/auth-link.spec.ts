import { expect, test } from "./fixtures";

import { CONTINUE_BUTTON, followAuthLink, recoveryLinkFor } from "./helpers";

/**
 * The Continue page (3cB review fixes; ROADMAP 5.2's prerequisite, ADR-0012). A one-time invite
 * or recovery link lands on `/auth/confirm`, whose GET verifies **nothing**: WhatsApp drawing a
 * link preview on the sender's phone, or a mail scanner, fetches the page (a GET or a HEAD) and
 * leaves the token usable. The POST behind "Continue to MaxOff" is what spends it, once. Signed
 * out, at desktop, 375 and 430; each project has its own seeded person, whose recovery links are
 * all this spec issues (GoTrue keeps one per person, so nobody else may issue theirs).
 */
test.use({ storageState: { cookies: [], origins: [] } });

const PEOPLE: Record<string, string> = {
  desktop: "link-desktop@maxoff.local",
  mobile: "link-mobile@maxoff.local",
  "mobile-lg": "link-mobile-lg@maxoff.local",
};

/** Well-formed, never issued: the page shows it like any other, since a GET cannot tell. */
const UNISSUED_LINK = `/auth/confirm?token_hash=${"e".repeat(56)}&type=recovery`;

test.describe("a one-time link is spent by Continue, never by a fetch", () => {
  test("a GET and a HEAD leave the link usable; Continue verifies once; a second Continue is refused", async ({
    page,
    request,
  }, info) => {
    const link = await recoveryLinkFor(PEOPLE[info.project.name]!);

    // What a link preview or a scanner does: fetch the page, and nothing more.
    const fetched = await request.get(link, { maxRedirects: 0 });
    expect(fetched.status()).toBe(200);
    const body = await fetched.text();
    expect(body).toContain(CONTINUE_BUTTON);
    expect(body).toMatch(/<meta name="robots" content="noindex/);
    const headers = fetched.headers();
    expect(headers["cache-control"]).toContain("no-store");
    expect(headers["x-robots-tag"]).toContain("noindex");
    expect(headers["referrer-policy"]).toBe("no-referrer");
    const probed = await request.head(link, { maxRedirects: 0 });
    expect(probed.status()).toBe(200);
    // Neither opened a session: this request context's jar got no session cookie, so the page
    // a verified link lands on is still behind sign-in for it.
    const guarded = await request.get("/set-password", { maxRedirects: 0 });
    expect(guarded.status()).toBe(307);
    expect(guarded.headers().location).toMatch(/\/login\?next=%2Fset-password$/);

    // The person: the page, then Continue, which verifies the token and opens the session.
    await followAuthLink(page, link);
    await expect(page).toHaveURL(/\/set-password$/);
    await expect(page.getByRole("heading", { name: "Set your password" })).toBeVisible();

    // Spent. The page still shows (a GET cannot know), and the second Continue is refused.
    await page.context().clearCookies();
    await followAuthLink(page, link);
    await expect(page).toHaveURL(/\/login\?reason=link$/);
    await expect(page.locator('[data-slot="form-alert"]')).toContainText(
      "This link has expired or was already used.",
    );
  });

  test("a link with no usable token goes to sign in with the reason, with nothing to tap", async ({
    page,
  }) => {
    for (const path of [
      "/auth/confirm",
      "/auth/confirm?type=recovery",
      `/auth/confirm?token_hash=${"e".repeat(56)}&type=magiclink`,
    ]) {
      await page.goto(path);
      await expect(page, path).toHaveURL(/\/login\?reason=link$/);
      await expect(page.locator('[data-slot="form-alert"]'), path).toContainText(
        "expired or was already used",
      );
      await expect(page.getByRole("button", { name: CONTINUE_BUTTON }), path).toHaveCount(0);
    }
  });

  test("the page carries nothing but the link: no session, no member, one solid action", async ({
    page,
  }) => {
    await page.goto(UNISSUED_LINK);
    await expect(page.getByRole("heading", { name: "Continue to MaxOff" })).toBeVisible();
    await expect(page.getByRole("button", { name: CONTINUE_BUTTON })).toBeVisible();
    await expect(page.locator('[data-variant="primary"]')).toHaveCount(1);
    await expect(page.locator('input[name="token_hash"]')).toHaveAttribute("type", "hidden");
    await expect(page.locator('input[name="type"]')).toHaveAttribute("value", "recovery");
    await expect(page.locator("head meta[name='robots']")).toHaveAttribute("content", /noindex/);
  });
});

test.describe("the Continue page meets the mobile standard", () => {
  test.skip(({ isMobile }) => !isMobile, "phone widths only; desktop proves the flow");

  test("a 44px button and no sideways scroll, at 130% and 200% text too", async ({ page }) => {
    await page.goto(UNISSUED_LINK);
    const button = page.getByRole("button", { name: CONTINUE_BUTTON });
    await expect(button).toBeVisible();
    for (const scale of [100, 130, 200]) {
      await page.evaluate((percent) => {
        document.documentElement.style.fontSize = `${percent}%`;
      }, scale);
      const box = await button.boundingBox();
      expect(box?.height ?? 0, `${scale}%: the button is tall enough`).toBeGreaterThanOrEqual(44);
      expect(box?.width ?? 0, `${scale}%: the button is wide enough`).toBeGreaterThanOrEqual(44);
      const overflow = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }));
      expect(overflow.scrollWidth, `${scale}%: no sideways scroll`).toBeLessThanOrEqual(
        overflow.clientWidth,
      );
    }
  });
});
