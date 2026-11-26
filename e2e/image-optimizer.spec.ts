import { expect, test } from "./fixtures";

/**
 * The image optimizer is closed (v2.0.1, `src/core/http/image-optimizer.ts`): MaxOff serves no
 * next/image, and next ≤ 16.4.0 had a remote code execution and an SSRF in `/_next/image`. This
 * checks the `next start` side (`images.unoptimized`, so Next answers 404) for a local image, a
 * remote one and an SVG, and that the files the optimizer would have read are still served as
 * they are. The Worker's own refusal is `worker/index.js` (unit test beside the helper); the
 * deployed answer is read by the Preview workflow's dispatch-only `image-probe` job.
 */
test.describe("the image optimizer is closed", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  for (const query of [
    "url=%2Ficons%2Ficon-192.png&w=64&q=75",
    "url=https%3A%2F%2Fexample.com%2Fa.png&w=64&q=75",
    "url=%2Ficons%2Ficon.svg&w=64&q=75",
  ]) {
    test(`/_next/image?${query} is refused`, async ({ request }) => {
      const response = await request.get(`/_next/image?${query}`, { maxRedirects: 0 });
      expect(response.status()).toBeGreaterThanOrEqual(400);
      expect(response.status()).toBeLessThan(500);
      expect(response.headers()["content-type"] ?? "").not.toMatch(/^image\//);
    });
  }

  test("the icon itself is still served as a file", async ({ request }) => {
    const response = await request.get("/icons/icon-192.png");
    expect(response.ok()).toBeTruthy();
    expect(response.headers()["content-type"]).toMatch(/^image\/png/);
  });
});
