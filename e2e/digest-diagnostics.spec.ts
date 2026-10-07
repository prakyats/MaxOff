import { expect, test } from "./fixtures";
import { serviceSelect, storageStateFor } from "./helpers";

/**
 * The digest sample (5B slice 7, owner decision 2026-10-03): `/diagnostics/digest` renders the
 * Owner's morning summary from live data on local and staging builds (this e2e build is a local
 * one; production's 404 is decided at runtime and unit-tested in route.test.ts). The Owner gets
 * the HTML, nothing is written or sent; an Admin, a Crew member and a signed-out visitor get 404.
 */
const digestRows = async () =>
  (await serviceSelect<{ id: string }>("notifications?kind=eq.owner_digest_weekly&select=id"))
    .length;

test.describe("the digest sample, as the Owner", () => {
  test.use({ storageState: storageStateFor("owner") });

  test("renders the email with its subject and text, writing nothing", async ({ page }) => {
    const before = await digestRows();
    const response = await page.goto("/diagnostics/digest");
    expect(response?.status()).toBe(200);
    expect(response?.headers()["cache-control"]).toBe("private, no-store");
    await expect(page.getByText("Sample only: nothing was sent or saved.")).toBeVisible();
    // The weekly summary since 6.5 (Kickoff 6 decision 23): "Your week · 5 – 11 Oct".
    await expect(
      page.getByText(/^Subject: Your week · \d{1,2}( \w{3})? – \d{1,2} \w{3}$/),
    ).toBeVisible();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      /^Your week · \d{1,2}( \w{3})? – \d{1,2} \w{3}$/,
    );
    expect(await page.content()).not.toMatch(/₹|\d+\.\d{2}\b/);
    expect(await digestRows()).toBe(before);
  });
});

for (const role of ["admin", "staff"] as const) {
  test.describe(`the digest sample, as ${role === "staff" ? "Crew" : "an Admin"}`, () => {
    test.use({ storageState: storageStateFor(role) });

    test("is refused (404)", async ({ request }) => {
      const response = await request.get("/diagnostics/digest", { maxRedirects: 0 });
      expect(response.status()).toBe(404);
      expect(await response.text()).not.toContain("Your week");
    });
  });
}

test.describe("the digest sample, signed out", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("is refused (404)", async ({ request }) => {
    const response = await request.get("/diagnostics/digest", { maxRedirects: 0 });
    expect(response.status()).toBe(404);
    expect(await response.text()).not.toContain("Your week");
  });
});
